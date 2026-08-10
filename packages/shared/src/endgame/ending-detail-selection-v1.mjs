import {
  ConfigDrivenEndingDetailError,
  PLAYER_SAFE_VISIBILITIES,
  SCORE_FEATURES,
  TERMINAL_CATEGORIES,
  compareNullableText,
  compareText,
  deepFreeze,
  evaluateRule,
  isRecord,
  selectorMatches,
  sortRecord
} from "./ending-detail-common-v1.mjs";

export function compileSlot(slot, facts, scoringProfiles) {
  const profile = scoringProfiles.get(slot.scoringProfileId);
  if (!profile) {
    throw new ConfigDrivenEndingDetailError(
      "ENDGAME_DETAIL_SCORING_PROFILE_UNKNOWN",
      "Slot references an unknown scoring profile.",
      { slotId: slot.slotId, scoringProfileId: slot.scoringProfileId }
    );
  }
  const eligible = facts
    .filter((fact) => factAllowedForSlot(fact, slot))
    .map((fact) => ({ fact, score: scoreFact(fact, profile) }))
    .sort(compareScoredFacts);
  const selected = dedupeFacts(eligible, slot.dedupeBy, slot.maxItems);
  const items = selected.map(({ fact }) => deepFreeze({
    title: fact.title,
    text: fact.text,
    evidenceRefs: Object.freeze([fact.factId])
  }));
  const factRefs = new Set(selected.map(({ fact }) => fact.factId));

  if (items.length < slot.minItems) {
    if (slot.fallback === "USE_TEMPLATE") {
      if (!isRecord(slot.fallbackTemplate)) {
        throw new ConfigDrivenEndingDetailError(
          "ENDGAME_DETAIL_FALLBACK_TEMPLATE_MISSING",
          "USE_TEMPLATE requires a deterministic fallbackTemplate.",
          { slotId: slot.slotId }
        );
      }
      if (items.length < slot.maxItems) {
        items.push(deepFreeze({
          title: slot.fallbackTemplate.title,
          text: slot.fallbackTemplate.text,
          evidenceRefs: Object.freeze([])
        }));
      }
    } else if (slot.fallback === "FAIL" || slot.required) {
      throw new ConfigDrivenEndingDetailError(
        "ENDGAME_DETAIL_REQUIRED_SLOT_UNSATISFIED",
        "A required detail slot lacks enough committed player-safe facts.",
        { slotId: slot.slotId, selected: items.length, minItems: slot.minItems }
      );
    }
  }
  if (items.length < slot.minItems && slot.fallback !== "ALLOW_EMPTY") {
    throw new ConfigDrivenEndingDetailError(
      "ENDGAME_DETAIL_SLOT_MINIMUM_UNSATISFIED",
      "Slot fallback did not satisfy minItems.",
      { slotId: slot.slotId, selected: items.length, minItems: slot.minItems }
    );
  }
  if (slot.required && items.length === 0) {
    throw new ConfigDrivenEndingDetailError(
      "ENDGAME_DETAIL_REQUIRED_SLOT_EMPTY",
      "Required detail slots cannot be empty.",
      { slotId: slot.slotId }
    );
  }
  return deepFreeze({ items: Object.freeze(items), factRefs: Object.freeze([...factRefs].sort(compareText)) });
}

function factAllowedForSlot(fact, slot) {
  if (!PLAYER_SAFE_VISIBILITIES.has(fact.visibility)) return false;
  if (!selectorMatches(fact, slot.selector)) return false;
  if (fact.status === "PENDING" && slot.slotKind !== "UNRESOLVED_HOOK") return false;
  if (slot.slotKind === "UNRESOLVED_HOOK" && fact.status !== "PENDING") return false;
  return true;
}

export function buildScoringProfiles(definitions) {
  const profiles = new Map();
  for (const definition of definitions) {
    const weights = {};
    for (const [feature, weight] of Object.entries(definition.weights)) {
      if (!SCORE_FEATURES.includes(feature)) {
        throw new ConfigDrivenEndingDetailError(
          "ENDGAME_DETAIL_SCORE_FEATURE_UNKNOWN",
          "Scoring profile uses an unsupported generic feature.",
          { scoringProfileId: definition.scoringProfileId, feature }
        );
      }
      if (typeof weight !== "number" || !Number.isFinite(weight)) {
        throw new ConfigDrivenEndingDetailError(
          "ENDGAME_DETAIL_SCORE_WEIGHT_INVALID",
          "Scoring weights must be finite numbers.",
          { scoringProfileId: definition.scoringProfileId, feature }
        );
      }
      weights[feature] = weight;
    }
    profiles.set(definition.scoringProfileId, deepFreeze(sortRecord(weights)));
  }
  return profiles;
}

function scoreFact(fact, weights) {
  const features = {
    causalStrength: fact.magnitude,
    metricImpact: fact.metricImpacts.reduce((sum, impact) => sum + Math.abs(impact.delta), 0),
    relationshipImpact: fact.sourceType === "RELATIONSHIP_CHANGE" || fact.category === "RELATIONSHIP" ? fact.magnitude : 0,
    terminalRelevance: TERMINAL_CATEGORIES.has(fact.category) || fact.status === "PENDING" ? fact.magnitude : 0,
    recency: fact.sourceRevision + (fact.stageIndex ?? 0) / 1000,
    uniqueness: 1 + new Set([
      ...fact.actorIds,
      ...fact.targetIds,
      ...fact.locationIds,
      ...fact.objectIds,
      ...(fact.sourceActionId === null ? [] : [fact.sourceActionId])
    ]).size
  };
  let score = 0;
  for (const [feature, weight] of Object.entries(weights)) score += features[feature] * weight;
  if (!Number.isFinite(score)) {
    throw new ConfigDrivenEndingDetailError(
      "ENDGAME_DETAIL_SCORE_NON_FINITE",
      "Fact score must remain finite.",
      { factId: fact.factId }
    );
  }
  return score;
}

function compareScoredFacts(left, right) {
  return right.score - left.score
    || right.fact.sourceRevision - left.fact.sourceRevision
    || (right.fact.stageIndex ?? -1) - (left.fact.stageIndex ?? -1)
    || compareNullableText(left.fact.sourceActionId, right.fact.sourceActionId)
    || compareText(left.fact.factId, right.fact.factId);
}

function dedupeFacts(scoredFacts, dedupeBy, maxItems) {
  if (maxItems === 0) return [];
  const seenByDimension = new Map(dedupeBy.map((dimension) => [dimension, new Set()]));
  const selected = [];
  for (const candidate of scoredFacts) {
    const keys = dedupeBy.map((dimension) => [dimension, dedupeKey(candidate.fact, dimension)]);
    if (keys.some(([dimension, key]) => seenByDimension.get(dimension).has(key))) continue;
    selected.push(candidate);
    for (const [dimension, key] of keys) seenByDimension.get(dimension).add(key);
    if (selected.length >= maxItems) break;
  }
  return selected;
}

function dedupeKey(fact, dimension) {
  if (dimension === "factId") return fact.factId;
  if (dimension === "sourceActionId") return fact.sourceActionId ?? `fact:${fact.factId}`;
  if (dimension === "actorId") return fact.actorIds[0] ?? `fact:${fact.factId}`;
  if (dimension === "targetId") return fact.targetIds[0] ?? `fact:${fact.factId}`;
  if (dimension === "locationId") return fact.locationIds[0] ?? `fact:${fact.factId}`;
  throw new ConfigDrivenEndingDetailError(
    "ENDGAME_DETAIL_DEDUPE_DIMENSION_UNKNOWN",
    "Slot uses an unsupported dedupe dimension.",
    { dimension }
  );
}

export function resolveStyle(definitions, context, facts) {
  const matches = definitions
    .filter((definition) => evaluateRule(definition.when, context, "ENDGAME_DETAIL_STYLE_RULE_FAILED", {
      styleId: definition.styleId
    }))
    .sort((left, right) => right.priority - left.priority || compareText(left.styleId, right.styleId));
  const selected = matches[0];
  if (!selected) return null;
  return deepFreeze({
    styleId: selected.styleId,
    label: selected.label,
    evidenceRefs: evidenceFactIdsForExpression(selected.when, facts)
  });
}

export function resolveScene(definitions, context, facts) {
  const conditional = definitions
    .filter((definition) => definition.fallback !== true)
    .filter((definition) => evaluateRule(definition.when, context, "ENDGAME_DETAIL_SCENE_RULE_FAILED", {
      sceneId: definition.sceneId
    }))
    .sort((left, right) => right.priority - left.priority || compareText(left.sceneId, right.sceneId));
  const fallback = definitions.find((definition) => definition.fallback === true);
  const selected = conditional[0] ?? fallback;
  if (!selected) {
    throw new ConfigDrivenEndingDetailError("ENDGAME_DETAIL_SCENE_MISSING", "A deterministic scene or fallback is required.");
  }
  const anchors = facts
    .filter((fact) => selectorMatches(fact, selected.anchorSelector))
    .filter((fact) => PLAYER_SAFE_VISIBILITIES.has(fact.visibility))
    .filter((fact) => fact.status !== "PENDING")
    .sort(compareFactsForAnchor)
    .slice(0, 3)
    .map((fact) => fact.factId);
  return deepFreeze({
    sceneId: selected.sceneId,
    label: selected.label,
    anchorFactRefs: Object.freeze(anchors)
  });
}

function evidenceFactIdsForExpression(expression, facts) {
  const selectors = [];
  collectExpressionSelectors(expression, selectors);
  const ids = new Set();
  for (const entry of selectors) {
    for (const fact of facts) {
      if (!selectorMatches(fact, entry.selector)) continue;
      if (entry.tag !== null && !fact.tags.includes(entry.tag)) continue;
      ids.add(fact.factId);
    }
  }
  return Object.freeze([...ids].sort(compareText));
}

function collectExpressionSelectors(expression, output) {
  if (Array.isArray(expression)) {
    for (const child of expression) collectExpressionSelectors(child, output);
  } else if (isRecord(expression)) {
    if (isRecord(expression.tagCount)) {
      output.push({ selector: expression.tagCount.selector, tag: expression.tagCount.tag });
    }
    if (isRecord(expression.factCount)) output.push({ selector: expression.factCount, tag: null });
    if (isRecord(expression.factExists)) output.push({ selector: expression.factExists, tag: null });
    for (const value of Object.values(expression)) collectExpressionSelectors(value, output);
  }
}

function compareFactsForAnchor(left, right) {
  return right.magnitude - left.magnitude
    || right.sourceRevision - left.sourceRevision
    || (right.stageIndex ?? -1) - (left.stageIndex ?? -1)
    || compareNullableText(left.sourceActionId, right.sourceActionId)
    || compareText(left.factId, right.factId);
}
