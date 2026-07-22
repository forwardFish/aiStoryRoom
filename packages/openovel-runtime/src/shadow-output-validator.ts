import { materialChangeFromCategories } from "./causal-turn-engine";
import type {
  CompiledShadowContext,
  MaterialChangeCategory,
  MaterialChangeReport,
  ShadowDecisionClass,
  ShadowRuntimeFixture,
  ShadowStateLockValue,
  ValidationIssue
} from "./types";

export interface ShadowAffordance {
  affordanceId: string;
  actorRef: string;
  targetRef: string;
  actionClass: ShadowDecisionClass;
  description: string;
}

export interface ShadowEndingState {
  locationRef: string;
  presentEntityRefs: string[];
  visibleFacts: string[];
  unresolvedFacts: string[];
  relationshipDelta: string;
  availableObjectRefs: string[];
  affordances: ShadowAffordance[];
}

export interface ShadowEventDraft {
  eventDraftId: string;
  eventType: string;
  status: "RECORDED_NOT_ACCEPTED" | null;
  actorRefs: string[];
  targetRefs: string[];
  tactic: string | null;
  observableSummary: string;
  materialChangeCategories: MaterialChangeCategory[];
}

export interface ShadowTurnOutput {
  schemaVersion: "openovel-shadow-turn-v3";
  resultType: "PUBLISHED_SHADOW_TURN";
  narration: {
    title: string;
    body: string;
    endingState: ShadowEndingState;
  };
  eventDrafts: ShadowEventDraft[];
  materialChange: MaterialChangeReport;
  decisions: Array<{
    decisionId: string;
    text: string;
    decisionClass: ShadowDecisionClass;
    basisAffordanceId: string;
    targetRefs: string[];
  }>;
  grounding: {
    binding: "SERVER_COMPILED";
    usedEvidenceClaimIds: string[];
    usedRuntimeFactIds: string[];
    usedCardIds: string[];
    usedCausalArcIds: string[];
    sourceMapHash: string;
  };
}

interface WriterV4Output {
  schemaVersion: "openovel-shadow-writer-v4";
  resultType: "PUBLISHED_SHADOW_TURN";
  narration?: {
    title?: unknown;
    body?: unknown;
    endingState?: {
      visibleFacts?: unknown;
      unresolvedFacts?: unknown;
      relationshipDelta?: unknown;
    };
  };
  decisions?: unknown;
}

interface WriterV5Output extends Omit<WriterV4Output, "schemaVersion"> {
  schemaVersion: "openovel-shadow-writer-v5";
  eventDrafts?: unknown;
}

interface WriterV6Output extends Omit<WriterV4Output, "schemaVersion"> {
  schemaVersion: "openovel-shadow-writer-v6";
  eventDrafts?: unknown;
}

function bindWriterV4Output(
  raw: WriterV4Output,
  fixture: ShadowRuntimeFixture
): { output: Partial<ShadowTurnOutput> & Record<string, unknown>; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const ending = raw.narration?.endingState || {};
  const visibleFacts = stringArray(ending.visibleFacts, "narration.endingState.visibleFacts", issues);
  const unresolvedFacts = stringArray(ending.unresolvedFacts, "narration.endingState.unresolvedFacts", issues);
  const relationshipDelta = stringValue(ending.relationshipDelta);
  const rawDecisions = Array.isArray(raw.decisions) ? raw.decisions as Array<Record<string, unknown>> : [];
  const entrances = fixture.writerPlan?.decisionEntrances || [];
  const usedRoutes = new Set<string>();
  const immediateRefs = new Set([
    ...fixture.decisionAccess.presentEntityRefs,
    ...fixture.decisionAccess.controllableEntityRefs,
    ...fixture.decisionAccess.reachableInstitutionRefs,
    ...fixture.decisionAccess.availableObjectRefs
  ]);
  const affordances: ShadowAffordance[] = [];
  const decisions: ShadowTurnOutput["decisions"] = [];

  rawDecisions.forEach((rawDecision, index) => {
    const text = stringValue(rawDecision?.text);
    const unexpectedKeys = Object.keys(rawDecision || {}).filter((key) => key !== "text");
    if (unexpectedKeys.length) {
      issues.push(issue("WRITER_DECISION_METADATA_FORBIDDEN", `Writer decision ${index + 1} must contain text only; server binds ${unexpectedKeys.join(",")}.`));
    }
    const inferred = inferDecisionClasses(text);
    const candidates = entrances.filter((entry) => {
      const route = `${entry.actionClass}:${entry.targetRefs.join(",")}`;
      return inferred.includes(entry.actionClass) && !usedRoutes.has(route);
    });
    const ranked = [...candidates].sort((left, right) =>
      countMentionedTargets(text, right.targetRefs, fixture) - countMentionedTargets(text, left.targetRefs, fixture)
    );
    const unused = entrances.filter((entry) => !usedRoutes.has(`${entry.actionClass}:${entry.targetRefs.join(",")}`));
    const entrance = ranked[0] || unused[0];
    if (!entrance || !inferred.includes(entrance.actionClass)) {
      issues.push(issue("DECISION_ROUTE_UNBINDABLE", `Decision ${index + 1} does not express one available action entrance.`));
    }
    if (!entrance) return;
    const route = `${entrance.actionClass}:${entrance.targetRefs.join(",")}`;
    usedRoutes.add(route);
    const mentionedRefs = fixture.availableTargets
      .filter((target) => immediateRefs.has(target.id) && text.includes(target.label))
      .map((target) => target.id);
    const targetRefs = [...new Set([...entrance.targetRefs, ...mentionedRefs])];
    const affordanceId = `a${index + 1}`;
    affordances.push({
      affordanceId,
      actorRef: fixture.role.characterId,
      targetRef: entrance.targetRefs[0] || fixture.decisionAccess.locationRef,
      actionClass: entrance.actionClass,
      description: entrance.situation
    });
    decisions.push({
      decisionId: `d${index + 1}`,
      text,
      decisionClass: entrance.actionClass,
      basisAffordanceId: affordanceId,
      targetRefs
    });
  });

  return {
    output: {
      schemaVersion: "openovel-shadow-turn-v3",
      resultType: raw.resultType,
      narration: {
        title: raw.narration?.title,
        body: raw.narration?.body,
        endingState: {
          locationRef: fixture.decisionAccess.locationRef,
          presentEntityRefs: [...fixture.decisionAccess.presentEntityRefs],
          visibleFacts,
          unresolvedFacts,
          relationshipDelta,
          availableObjectRefs: [...fixture.decisionAccess.availableObjectRefs],
          affordances
        }
      },
      decisions
    } as Partial<ShadowTurnOutput> & Record<string, unknown>,
    issues
  };
}

function bindWriterV5Output(
  raw: WriterV5Output,
  context: CompiledShadowContext,
  fixture: ShadowRuntimeFixture,
  bindDecisionsByIndex = false
): { output: Partial<ShadowTurnOutput> & Record<string, unknown>; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const unexpectedTopLevel = Object.keys(raw as unknown as Record<string, unknown>)
    .filter((key) => !["schemaVersion", "resultType", "narration", "eventDrafts", "decisions"].includes(key));
  if (unexpectedTopLevel.length) {
    issues.push(issue("WRITER_TOP_LEVEL_METADATA_FORBIDDEN", `Writer output contains unsupported fields: ${unexpectedTopLevel.join(",")}.`));
  }
  const narrationObject = raw.narration && typeof raw.narration === "object" ? raw.narration as Record<string, unknown> : {};
  const unexpectedNarration = Object.keys(narrationObject).filter((key) => !["title", "body", "endingState"].includes(key));
  if (unexpectedNarration.length) {
    issues.push(issue("WRITER_NARRATION_METADATA_FORBIDDEN", `Writer narration contains unsupported fields: ${unexpectedNarration.join(",")}.`));
  }
  const ending = raw.narration?.endingState || {};
  const unexpectedEnding = ending && typeof ending === "object"
    ? Object.keys(ending as Record<string, unknown>).filter((key) => !["visibleFacts", "unresolvedFacts", "relationshipDelta"].includes(key))
    : [];
  if (unexpectedEnding.length) {
    issues.push(issue("WRITER_ENDING_METADATA_FORBIDDEN", `Writer endingState contains unsupported fields: ${unexpectedEnding.join(",")}.`));
  }
  const visibleFacts = stringArray(ending.visibleFacts, "narration.endingState.visibleFacts", issues);
  const unresolvedFacts = stringArray(ending.unresolvedFacts, "narration.endingState.unresolvedFacts", issues);
  const relationshipDelta = stringValue(ending.relationshipDelta);
  const rawEventDrafts = Array.isArray(raw.eventDrafts) ? raw.eventDrafts as Array<Record<string, unknown>> : [];
  if (!Array.isArray(raw.eventDrafts)) issues.push(issue("OUTPUT_ARRAY_REQUIRED", "eventDrafts must be an array."));
  const eventCatalog = new Map(context.causalTurn.allowedEventEnvelope.eventCatalog.map((event) => [event.eventType, event]));
  const eventDrafts: ShadowEventDraft[] = [];
  rawEventDrafts.forEach((rawEvent, index) => {
    const unexpectedKeys = Object.keys(rawEvent || {}).filter((key) => key !== "eventType");
    if (unexpectedKeys.length) {
      issues.push(issue("WRITER_EVENT_METADATA_FORBIDDEN", `Writer event ${index + 1} must contain eventType only; server binds ${unexpectedKeys.join(",")}.`));
    }
    const eventType = stringValue(rawEvent?.eventType);
    const definition = eventCatalog.get(eventType);
    if (!definition) {
      issues.push(issue("EVENT_TYPE_NOT_ALLOWED", `${eventType || "empty"} is not in the allowed event envelope.`));
      return;
    }
    eventDrafts.push({
      eventDraftId: `e${index + 1}`,
      eventType,
      status: definition.status || null,
      actorRefs: [...definition.actorRefs],
      targetRefs: [...definition.targetRefs],
      tactic: definition.tactic || null,
      observableSummary: definition.observableSummary,
      materialChangeCategories: [...definition.materialChangeCategories]
    });
  });

  const rawDecisions = Array.isArray(raw.decisions) ? raw.decisions as Array<Record<string, unknown>> : [];
  if (!Array.isArray(raw.decisions)) issues.push(issue("OUTPUT_ARRAY_REQUIRED", "decisions must be an array."));
  const affordanceSeeds = context.causalTurn.decisionAffordances;
  const usedAffordanceIds = new Set<string>();
  const immediateRefs = new Set([
    ...fixture.decisionAccess.presentEntityRefs,
    ...fixture.decisionAccess.controllableEntityRefs,
    ...fixture.decisionAccess.reachableInstitutionRefs,
    ...fixture.decisionAccess.availableObjectRefs
  ]);
  const affordances: ShadowAffordance[] = [];
  const decisions: ShadowTurnOutput["decisions"] = [];
  rawDecisions.forEach((rawDecision, index) => {
    const text = stringValue(rawDecision?.text);
    const unexpectedKeys = Object.keys(rawDecision || {}).filter((key) => key !== "text");
    if (unexpectedKeys.length) {
      issues.push(issue("WRITER_DECISION_METADATA_FORBIDDEN", `Writer decision ${index + 1} must contain text only; server binds ${unexpectedKeys.join(",")}.`));
    }
    const inferred = inferDecisionClasses(text);
    const candidates = affordanceSeeds.filter((affordance) =>
      inferred.includes(affordance.actionClass) && !usedAffordanceIds.has(affordance.affordanceId)
    );
    const ranked = [...candidates].sort((left, right) =>
      countMentionedTargets(text, [right.targetRef], fixture) - countMentionedTargets(text, [left.targetRef], fixture)
    );
    const unused = affordanceSeeds.filter((affordance) => !usedAffordanceIds.has(affordance.affordanceId));
    const affordance = bindDecisionsByIndex ? affordanceSeeds[index] : ranked[0] || unused[0];
    if (!affordance || !inferred.includes(affordance.actionClass)) {
      issues.push(issue("DECISION_ROUTE_UNBINDABLE", `Decision ${index + 1} does not express one available action entrance.`));
    }
    if (!affordance) return;
    usedAffordanceIds.add(affordance.affordanceId);
    const mentionedRefs = fixture.availableTargets
      .filter((target) => immediateRefs.has(target.id) && text.includes(target.label))
      .map((target) => target.id);
    const targetRefs = [...new Set([affordance.targetRef, ...mentionedRefs])];
    affordances.push({
      affordanceId: affordance.affordanceId,
      actorRef: affordance.actorRef,
      targetRef: affordance.targetRef,
      actionClass: affordance.actionClass,
      description: affordance.immediateGoal
    });
    decisions.push({
      decisionId: `d${index + 1}`,
      text,
      decisionClass: affordance.actionClass,
      basisAffordanceId: affordance.affordanceId,
      targetRefs
    });
  });

  return {
    output: {
      schemaVersion: "openovel-shadow-turn-v3",
      resultType: raw.resultType,
      narration: {
        title: raw.narration?.title,
        body: raw.narration?.body,
        endingState: {
          locationRef: fixture.decisionAccess.locationRef,
          presentEntityRefs: [...fixture.decisionAccess.presentEntityRefs],
          visibleFacts,
          unresolvedFacts,
          relationshipDelta,
          availableObjectRefs: [...fixture.decisionAccess.availableObjectRefs],
          affordances
        }
      },
      eventDrafts,
      decisions
    } as Partial<ShadowTurnOutput> & Record<string, unknown>,
    issues
  };
}

function bindWriterV6Output(
  raw: WriterV6Output,
  context: CompiledShadowContext,
  fixture: ShadowRuntimeFixture
): { output: Partial<ShadowTurnOutput> & Record<string, unknown>; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const decisionsObject = raw.decisions && typeof raw.decisions === "object" && !Array.isArray(raw.decisions)
    ? raw.decisions as Record<string, unknown>
    : null;
  const expectedKeys = context.causalTurn.decisionAffordances.map((_, index) => `decision${index + 1}`);
  if (!decisionsObject) {
    issues.push(issue("OUTPUT_OBJECT_REQUIRED", "decisions must be an object keyed by decision1, decision2, and decision3."));
  }
  const unexpectedKeys = decisionsObject ? Object.keys(decisionsObject).filter((key) => !expectedKeys.includes(key)) : [];
  if (unexpectedKeys.length) {
    issues.push(issue("WRITER_DECISION_ROUTE_KEYS_INVALID", `decisions contains unsupported keys: ${unexpectedKeys.join(",")}.`));
  }
  const rawDecisions = expectedKeys.map((key) => {
    const value = decisionsObject?.[key];
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  });
  const bound = bindWriterV5Output({
    ...raw,
    schemaVersion: "openovel-shadow-writer-v5",
    decisions: rawDecisions
  }, context, fixture, true);
  return { output: bound.output, issues: [...issues, ...bound.issues] };
}

function countMentionedTargets(text: string, refs: string[], fixture: ShadowRuntimeFixture): number {
  return refs.filter((ref) => {
    const label = fixture.availableTargets.find((target) => target.id === ref)?.label;
    return Boolean(label && text.includes(label));
  }).length;
}

export function parseAndValidateShadowOutput(
  rawText: string,
  context: CompiledShadowContext,
  fixture: ShadowRuntimeFixture
): { ok: true; output: ShadowTurnOutput; warnings: ValidationIssue[] } | { ok: false; output: unknown; issues: ValidationIssue[]; warnings: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(rawText));
  } catch (error) {
    return { ok: false, output: null, issues: [issue("OUTPUT_JSON_INVALID", error instanceof Error ? error.message : String(error))], warnings: [] };
  }

  const rawOutput = parsed as Record<string, unknown> & {
    schemaVersion?: unknown;
    resultType?: unknown;
    narration?: any;
    eventDrafts?: unknown;
    decisions?: unknown;
  };
  const isWriterV6 = rawOutput.schemaVersion === "openovel-shadow-writer-v6";
  const isWriterV5 = rawOutput.schemaVersion === "openovel-shadow-writer-v5";
  const isWriterV4 = rawOutput.schemaVersion === "openovel-shadow-writer-v4";
  const bound = isWriterV6
    ? bindWriterV6Output(rawOutput as unknown as WriterV6Output, context, fixture)
    : isWriterV5
      ? bindWriterV5Output(rawOutput as unknown as WriterV5Output, context, fixture)
    : isWriterV4
      ? bindWriterV4Output(rawOutput as unknown as WriterV4Output, fixture)
      : { output: rawOutput as Partial<ShadowTurnOutput> & Record<string, unknown>, issues: [] as ValidationIssue[] };
  issues.push(...bound.issues);
  const output = bound.output;
  if (!isWriterV6 && !isWriterV5 && !isWriterV4 && output.schemaVersion !== "openovel-shadow-turn-v3") {
    issues.push(issue("OUTPUT_SCHEMA_VERSION_INVALID", "schemaVersion must equal openovel-shadow-writer-v6."));
  }
  if (output.resultType !== "PUBLISHED_SHADOW_TURN") {
    issues.push(issue("OUTPUT_RESULT_TYPE_INVALID", "resultType must equal PUBLISHED_SHADOW_TURN."));
  }
  if (Object.prototype.hasOwnProperty.call(rawOutput, "story") || Object.prototype.hasOwnProperty.call(rawOutput, "resolution") || Object.prototype.hasOwnProperty.call(rawOutput, "endingState")) {
    issues.push(issue("LEGACY_PREWRITTEN_SCHEMA_REJECTED", "The v3 Writer output must use narration plus a structured narration.endingState."));
  }

  const title = stringValue(output.narration?.title);
  const body = stringValue(output.narration?.body);
  if (!title) issues.push(issue("OUTPUT_FIELD_REQUIRED", "narration.title must be a non-empty string."));
  if (!body) issues.push(issue("OUTPUT_FIELD_REQUIRED", "narration.body must be a non-empty string."));
  if (title && (title.length < 4 || title.length > 10)) {
    issues.push(issue("NARRATIVE_TITLE_LENGTH_INVALID", "narration.title must contain 4 to 10 characters."));
  }
  if (body && (body.length < context.narrativeBudget.minChars || body.length > context.narrativeBudget.maxChars)) {
    issues.push(issue("NARRATIVE_LENGTH_INVALID", `narration.body must contain ${context.narrativeBudget.minChars} to ${context.narrativeBudget.maxChars} characters.`));
  }
  const paragraphs = body ? body.split(/\n\s*\n/u).map((item) => item.trim()).filter(Boolean) : [];
  if (body && (paragraphs.length < context.narrativeBudget.minParagraphs || paragraphs.length > context.narrativeBudget.maxParagraphs)) {
    issues.push(issue("NARRATIVE_PARAGRAPH_COUNT_INVALID", `narration.body must contain ${context.narrativeBudget.minParagraphs} to ${context.narrativeBudget.maxParagraphs} natural paragraphs.`));
  }
  if (body.includes(fixture.playerIntent.userFacingText)) {
    issues.push(issue("NARRATIVE_REPEATS_PLAYER_ACTION", "The story copied the submitted player action instead of starting from its consequence."));
  }
  if (body && replaysRecentCanon(body, fixture.recentCanon.map((entry) => entry.narrative).join("\n"))) {
    issues.push(issue("RECENT_CANON_REPLAY", "The story repeated a substantial sentence already present in Recent Canon."));
  }

  validateActionBoundary(body, fixture, issues);
  const endingState = validateEndingState(output.narration?.endingState, body, context, fixture, issues);
  validateUnacceptedResponsibilityProposal(body, endingState, fixture, issues);
  const endingVisibleText = endingState
    ? [...endingState.visibleFacts, endingState.relationshipDelta].join("\n")
    : "";
  const decisionTexts = Array.isArray(output.decisions)
    ? output.decisions.map((decision) => stringValue(decision?.text)).filter(Boolean)
    : [];
  const assertiveText = [body, endingVisibleText, ...decisionTexts].filter(Boolean).join("\n");
  const storyText = [body, endingVisibleText].filter(Boolean).join("\n");
  const factualStoryText = removeConditionalClauses(storyText);
  const factualAssertiveText = removeConditionalClauses(assertiveText);
  const narrationOnlyBody = body.replace(/“[^”]*”|‘[^’]*’/gu, "");
  const narrationOnlyStory = [narrationOnlyBody, endingVisibleText].filter(Boolean).join("\n");

  for (const requirement of fixture.narrativeFrame.requiredNarrativePatterns) {
    if (!new RegExp(requirement.pattern, "u").test(body)) issues.push(issue(requirement.code, requirement.message));
  }
  validateRequiredEndChange(body, fixture, issues);
  for (const forbiddenTerm of fixture.narrativeBoundary.resultNarrativeForbiddenTerms) {
    if (body.includes(forbiddenTerm)) {
      issues.push(issue("PLAYER_ACTION_SCOPE_EXPANDED", `Narration introduced a withheld or unsubmitted topic: ${forbiddenTerm}`));
    }
  }
  for (const outcomeTerm of fixture.narrativeBoundary.forbiddenStoryOutcomeTerms) {
    if (factualAssertiveText.includes(outcomeTerm)) {
      issues.push(issue("NARRATIVE_UNRESOLVED_OUTCOME_INVENTED", `Narration pre-wrote an unresolved outcome: ${outcomeTerm}`));
    }
  }
  if (/(?:若|如果)[^。！？!?\n]{0,40}(?:巡抚|朝廷)[^。！？!?\n]{0,32}(?:便|将|可能|或将|随之)|一旦[^。！？!?\n]{0,60}(?:就|便|将|成为|成了)/u.test(narrationOnlyStory)) {
    issues.push(issue("NARRATIVE_FUTURE_CONSEQUENCE", "Narration pre-wrote a consequence of a decision the player has not made."));
  }
  if (/(?:各怀心思|各有心思|心思各异|显然是要|分明想要|心里(?:想|盘算|认定))/u.test(storyText)) {
    issues.push(issue("UNCONFIRMED_OMNISCIENT_MENTAL_STATE", "Narration asserted unconfirmed private mental states."));
  }
  if (/(?:没有|并未)(?:提及?|重抄|添加)[^。]{0,20}(?:调取|核查|调册命令|评语|期限|数字|时限|执行安排)|没有碰案上任何文书|(?:没有|并未)出示[^。]{0,16}(?:公文|急令|文书)/u.test(body)) {
    issues.push(issue("NARRATIVE_RULE_COMPLIANCE_LEAK", "Narration exposed prompt-compliance checks instead of rendering the scene."));
  }
  if (/(?:^|[。！？!?\n])\s*我(?:站|坐|看|望|抬|伸|拿|走|开口|说|问|答|沉默|把|将)/u.test(narrationOnlyBody)) {
    issues.push(issue("NARRATIVE_PLAYER_FIRST_PERSON", "Narration must refer to the player role as 总督 rather than switching to first person."));
  }
  if (/(?:两个选择|两种选择|三条路|要么[\s\S]{0,80}要么|是接受[^。]{0,40}拒绝[^。]{0,40}(?:另作|其他|处置)|若(?:认可|接受|肯)[^。]{0,80}若不(?:认可|接受|肯)|(?:等待|等的是|只等)[^。]{0,30}(?:总督)?(?:示意|表态)[^。]{0,20}(?:是)[^。]{0,36}(?:还是))/u.test(storyText)) {
    issues.push(issue("NARRATIVE_DECISION_SUMMARY_LEAK", "Narration must render the scene instead of announcing the option list."));
  }
  if (/(?:巡抚的回应留下了一个具体问题|总督(?:现在)?需要决定|下一步(?:可以|决策)|现场留下了[^。]{0,20}问题|(?:条件|态度)已经摆明|条件[^。]{0,16}摆在了现场|意思很清楚|等待总督决定是否|或提出其他方案|让在场的人都明白|现在轮到总督表态|需要总督[^。]{0,16}(?:认可|接受|拒绝|反驳)|(?:认可|接受)[^。]{0,16}(?:反驳|拒绝))/u.test(body)) {
    issues.push(issue("NARRATIVE_EXPLANATORY_ENDING", "Narration ended with a system-style explanation instead of a visible dramatic state."));
  }

  validateStateLocks(factualAssertiveText, fixture, issues);
  const eventValidation = validateEventDrafts(output.eventDrafts, body, endingState, context, fixture, issues);
  validateDecisions(output.decisions, endingState, fixture, issues);

  const serializedAssertive = JSON.stringify({ body, endingVisibleText, decisions: decisionTexts });
  for (const forbidden of context.forbiddenDisclosures) {
    if (serializedAssertive.includes(forbidden)) issues.push(issue("FORBIDDEN_DISCLOSURE", `Output contains gated disclosure: ${forbidden}`));
  }
  for (const exclusion of fixture.currentStateExclusions) {
    // Most state exclusions inspect only factual clauses so an NPC may discuss a
    // hypothetical without turning it into world state. An execution promise is
    // different: even when phrased as an if/then bargain, it still adds an NPC
    // commitment that this scene has not authorized.
    const scopes = exclusion.code === "UNAUTHORIZED_NPC_EXECUTION_COMMITMENT"
      ? [storyText, ...decisionTexts]
      : [factualStoryText, ...decisionTexts.map((text) => removeConditionalClauses(text))];
    // Artifacts retain the fixture snapshot used for the provider call. Keep
    // this semantic expansion in the validator so an older snapshot cannot
    // hide a newly identified form of the same forbidden commitment.
    const pattern = exclusion.code === "UNAUTHORIZED_NPC_EXECUTION_COMMITMENT"
      ? `(?:${exclusion.pattern})|(?:(?:巡抚|下官)[^。！？\\n]{0,120}(?:即刻|立即|马上)[^。！？\\n]{0,48}(?:着手调册|开始调册|办理调册))`
      : exclusion.pattern;
    if (scopes.some((scope) => new RegExp(pattern, "u").test(scope))) {
      issues.push({ severity: exclusion.severity || "error", code: exclusion.code, message: exclusion.description });
    }
  }
  for (const timeConstraint of extractTimeConstraints(assertiveText)) {
    if (!fixture.allowedTimeConstraints.includes(timeConstraint)) {
      issues.push(issue("UNAUTHORIZED_TIME_CONSTRAINT", `Output invented an unapproved time constraint: ${timeConstraint}`));
    }
  }
  for (const quantitativeClaim of extractQuantitativeClaims(assertiveText)) {
    if (!fixture.allowedQuantitativeClaims.includes(quantitativeClaim)) {
      issues.push(issue("UNAUTHORIZED_QUANTITATIVE_CLAIM", `Output invented an unapproved quantitative claim: ${quantitativeClaim}`));
    }
  }

  const playerFacingText = [body, endingVisibleText, ...decisionTexts].join("\n");
  for (const characterName of fixture.narrativeBoundary.forbiddenCharacterNames) {
    if (playerFacingText.includes(characterName)) {
      issues.push(issue("SOURCE_CHARACTER_TRANSPOSED_TO_RUNTIME", `Output imported a source character name not present in this room: ${characterName}`));
    }
  }

  const warnings = issues.filter((item) => item.severity === "warning");
  const errors = issues.filter((item) => item.severity === "error");
  if (errors.length) return { ok: false, output: parsed, issues: errors, warnings };
  const sanitized = {
    schemaVersion: "openovel-shadow-turn-v3",
    resultType: "PUBLISHED_SHADOW_TURN",
    narration: output.narration,
    eventDrafts: eventValidation.eventDrafts,
    materialChange: eventValidation.materialChange,
    decisions: output.decisions,
    grounding: {
      binding: "SERVER_COMPILED",
      usedEvidenceClaimIds: context.serverGrounding.evidenceClaimIds,
      usedRuntimeFactIds: context.serverGrounding.runtimeFactIds,
      usedCardIds: context.serverGrounding.cardIds,
      usedCausalArcIds: context.causalTurn.arcsAfter.map((arc) => arc.arcId),
      sourceMapHash: context.serverGrounding.sourceMapHash
    }
  } as ShadowTurnOutput;
  return { ok: true, output: sanitized, warnings };
}

function validateActionBoundary(body: string, fixture: ShadowRuntimeFixture, issues: ValidationIssue[]): void {
  if (!body) return;
  const firstParagraph = body.split(/\n\s*\n/u).map((item) => item.trim()).find(Boolean) || body;
  const presentLabels = fixture.decisionAccess.presentEntityRefs
    .map((ref) => fixture.availableTargets.find((target) => target.id === ref)?.label)
    .filter((value): value is string => Boolean(value));
  if (fixture.actionBoundary.stage === "ACTION_ALREADY_LANDED" && !presentLabels.some((label) => firstParagraph.includes(label))) {
    issues.push(issue("ACTION_BOUNDARY_FIRST_NEW_BEAT_MISSING", "The first paragraph must begin with a present NPC's reaction after the already-landed action."));
  }
  for (const rule of fixture.actionBoundary.validationPatterns) {
    const scope = rule.firstParagraphOnly ? firstParagraph : rule.firstCharacters ? body.slice(0, rule.firstCharacters) : body;
    if (new RegExp(rule.pattern, "u").test(scope)) issues.push(issue(rule.code, rule.description));
  }
}

function validateEndingState(
  value: unknown,
  body: string,
  context: CompiledShadowContext,
  fixture: ShadowRuntimeFixture,
  issues: ValidationIssue[]
): ShadowEndingState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(issue("ENDING_STATE_OBJECT_REQUIRED", "narration.endingState must be a structured object."));
    return null;
  }
  const ending = value as Partial<ShadowEndingState> & Record<string, unknown>;
  const locationRef = stringValue(ending.locationRef);
  if (locationRef !== fixture.decisionAccess.locationRef) {
    issues.push(issue("ENDING_STATE_LOCATION_INVALID", `endingState.locationRef must equal ${fixture.decisionAccess.locationRef}.`));
  }
  const presentEntityRefs = stringArray(ending.presentEntityRefs, "endingState.presentEntityRefs", issues);
  const visibleFacts = stringArray(ending.visibleFacts, "endingState.visibleFacts", issues);
  const unresolvedFacts = stringArray(ending.unresolvedFacts, "endingState.unresolvedFacts", issues);
  const relationshipDelta = stringValue(ending.relationshipDelta);
  const availableObjectRefs = stringArray(ending.availableObjectRefs, "endingState.availableObjectRefs", issues);
  if (visibleFacts.length < 2) issues.push(issue("ENDING_STATE_VISIBLE_FACTS_INSUFFICIENT", "endingState.visibleFacts must contain at least two visible facts from the body."));
  if (unresolvedFacts.length < 1) issues.push(issue("ENDING_STATE_UNRESOLVED_FACTS_REQUIRED", "endingState.unresolvedFacts must preserve at least one unknown fact."));
  if (relationshipDelta.length < 8) issues.push(issue("ENDING_STATE_RELATIONSHIP_DELTA_REQUIRED", "endingState.relationshipDelta must describe a visible power or responsibility change."));
  if (/若[^。]{0,30}则|需要总督[^。]{0,20}(?:另提|回应|决定)|总督[^。]{0,20}(?:必须|需)[^。]{0,16}(?:另提|回应|决定)|总督[^。]{0,24}面临[^。]{0,24}(?:或|两难)/u.test(relationshipDelta)) {
    issues.push(issue("ENDING_STATE_RELATIONSHIP_FORECAST", "endingState.relationshipDelta must describe the current relationship change without forecasting the player's response."));
  }
  validateVisibleFactsAgainstBody(visibleFacts, body, fixture, issues);
  validateUnresolvedFactsAgainstEnding(unresolvedFacts, body, visibleFacts, relationshipDelta, issues);
  for (const required of fixture.decisionAccess.presentEntityRefs) {
    if (!presentEntityRefs.includes(required)) issues.push(issue("ENDING_STATE_PRESENT_ENTITY_MISSING", `${required} must remain present at the end of this turn.`));
  }
  for (const ref of presentEntityRefs) {
    if (!fixture.decisionAccess.presentEntityRefs.includes(ref)) issues.push(issue("ENDING_STATE_ENTITY_NOT_PRESENT", `${ref} is not an allowed present entity.`));
  }
  for (const ref of availableObjectRefs) {
    if (!fixture.decisionAccess.availableObjectRefs.includes(ref)) issues.push(issue("ENDING_STATE_OBJECT_NOT_AVAILABLE", `${ref} is not an available ending-state object.`));
  }

  const affordances = validateAffordances(ending.affordances, context, fixture, issues);
  return { locationRef, presentEntityRefs, visibleFacts, unresolvedFacts, relationshipDelta, availableObjectRefs, affordances };
}

function validateAffordances(
  values: unknown,
  context: CompiledShadowContext,
  fixture: ShadowRuntimeFixture,
  issues: ValidationIssue[]
): ShadowAffordance[] {
  if (!Array.isArray(values) || values.length < 3) {
    issues.push(issue("ENDING_STATE_AFFORDANCES_INSUFFICIENT", "endingState.affordances must contain at least three actionable entries."));
    return [];
  }
  const allowedRefs = new Set([
    ...context.allowedReferences.entityRefs,
    fixture.role.characterId,
    fixture.role.roleId,
    ...fixture.decisionAccess.presentEntityRefs,
    ...fixture.decisionAccess.controllableEntityRefs,
    ...fixture.decisionAccess.reachableInstitutionRefs,
    ...fixture.decisionAccess.availableObjectRefs
  ]);
  const immediateTargets = new Set([
    ...fixture.decisionAccess.presentEntityRefs,
    ...fixture.decisionAccess.controllableEntityRefs,
    ...fixture.decisionAccess.reachableInstitutionRefs,
    ...fixture.decisionAccess.availableObjectRefs
  ]);
  const ids = new Set<string>();
  const result: ShadowAffordance[] = [];
  for (const raw of values as Array<Record<string, unknown>>) {
    const affordanceId = stringValue(raw?.affordanceId);
    const actorRef = stringValue(raw?.actorRef);
    const targetRef = stringValue(raw?.targetRef);
    const actionClass = stringValue(raw?.actionClass) as ShadowDecisionClass;
    const description = stringValue(raw?.description);
    if (!affordanceId || ids.has(affordanceId)) issues.push(issue("AFFORDANCE_ID_INVALID", "Affordance IDs must be non-empty and unique."));
    ids.add(affordanceId);
    if (!allowedRefs.has(actorRef)) issues.push(issue("AFFORDANCE_ACTOR_NOT_ALLOWED", `${actorRef || "empty"} is not an allowed actor ref.`));
    if (!immediateTargets.has(targetRef)) issues.push(issue("AFFORDANCE_TARGET_NOT_IMMEDIATE", `${targetRef || "empty"} is not present, controllable, reachable, or available.`));
    if (!fixture.narrativeFrame.decisionPolicy.allowedClasses.includes(actionClass)) issues.push(issue("AFFORDANCE_CLASS_INVALID", `${actionClass || "empty"} is not an allowed action class.`));
    const entrances = fixture.writerPlan?.decisionEntrances || [];
    if (entrances.length && !entrances.some((entry) => entry.actionClass === actionClass && entry.targetRefs.includes(targetRef))) {
      issues.push(issue("AFFORDANCE_NOT_IN_DECISION_ACCESS", `${actionClass || "empty"}:${targetRef || "empty"} is not an available action entrance.`));
    }
    if (description.length < 8 || description.length > 80) issues.push(issue("AFFORDANCE_DESCRIPTION_INVALID", `${affordanceId || "affordance"}.description must contain 8 to 80 characters.`));
    result.push({ affordanceId, actorRef, targetRef, actionClass, description });
  }
  return result;
}

function validateRequiredEndChange(body: string, fixture: ShadowRuntimeFixture, issues: ValidationIssue[]): void {
  const requirement = fixture.writerPlan?.requiredEndChange || fixture.narrativeBoundary.turnEndsWhen;
  if (!/书记[^。]{0,40}(?:记录|记入|写入)|被书记记录/u.test(requirement)) return;
  if (!hasCompletedSecretaryRecord(body)) {
    issues.push(issue("FRAME_SECRETARY_NEW_DELTA_MISSING", "Narrative must show the secretary actually completing the new responsibility record."));
  }
}

function validateUnacceptedResponsibilityProposal(
  body: string,
  endingState: ShadowEndingState | null,
  fixture: ShadowRuntimeFixture,
  issues: ValidationIssue[]
): void {
  const proposalMustRemainPending = fixture.causalRuntime?.npcReactions.some((reaction) =>
    reaction.forbiddenOutcomes.some((outcome) => /总督自动接受条件|条件自动生效/u.test(outcome))
  ) || /总督尚未接受|尚待总督回应/u.test(fixture.writerPlan?.requiredEndChange || "");
  if (!proposalMustRemainPending) return;

  const actualizedResponsibility = /(?:总督|大人)(?:已经|已)?(?:承担|担负|担下|认下)[^。；\n]{0,18}暂缓落印|暂缓落印(?:之责|责任)?(?:已经|已)?(?:归|由)(?:总督|大人)(?:承担|担负|担下)?/u;
  const proposalMarkers = /(?:巡抚[^。]{0,24}(?:提出|主张|要求|请求)|请(?:总督|大人)|请求(?:总督|大人)|拟由总督|应由总督|尚未接受|尚未生效|未获接受|作为巡抚(?:陈述|主张))/u;
  const ledgerParagraphActualizes = body.split(/\n\s*\n/u).some((paragraph) =>
    /(?:书记[^。]{0,80}(?:记下|记入|写下|写入|录下|入册)|簿册[^。]{0,80}(?:写着|记着|载明))/u.test(paragraph)
      && actualizedResponsibility.test(paragraph)
      && !proposalMarkers.test(paragraph)
  );
  const narrationOnly = body.replace(/“[^”]*”|‘[^’]*’/gu, "");
  const narratorActualizes = actualizedResponsibility.test(narrationOnly) && !proposalMarkers.test(narrationOnly);
  const endingActualizes = endingState
    ? [...endingState.visibleFacts, endingState.relationshipDelta].some((fact) =>
      actualizedResponsibility.test(fact) && !proposalMarkers.test(fact)
    )
    : false;
  if (ledgerParagraphActualizes || narratorActualizes || endingActualizes) {
    issues.push(issue(
      "UNACCEPTED_NPC_PROPOSAL_ACTUALIZED",
      "Recording the xunfu's proposal must not state that the governor already accepted or assumed the proposed responsibility."
    ));
  }
}

export function hasCompletedSecretaryRecord(body: string): boolean {
  const narrationOnly = body.replace(/“[^”]*”|‘[^’]*’/gu, "");
  const completedInOneSentence = narrationOnly
    .split(/[。！？!?\n]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .some((sentence) => {
      const hasCompletedAction = /书记[^。]{0,120}(?:(?:便|随即|当即)[^。]{0,32}(?:写|落笔)|记下|记入|记录|写下|写出|写完|写道|写入|录下|入册|誊入|誊写|落笔|落字)/u.test(sentence);
      const pendingBeforeAction = /书记[^。]{0,100}(?:等待|等候|准备|悬笔|笔悬|尚未|仍未|没有|未曾|是否|可否|只待|待[^。]{0,12}(?:表态|示下|吩咐))[^。]{0,60}(?:记下|记入|记录|写下|写出|写完|写入|录下|入册|落笔)/u.test(sentence);
      const requestedAction = /(?:请|让|命|要求|嘱咐)书记[^。]{0,80}(?:记下|记入|记录|写下|写出|写完|写入|录下|入册|落笔)/u.test(sentence);
      return hasCompletedAction && !pendingBeforeAction && !requestedAction;
    });
  if (completedInOneSentence) return true;
  return narrationOnly.split(/\n\s*\n/u).some((paragraph) => {
    const secretaryIndex = paragraph.indexOf("书记");
    const actionMatch = /(?:蘸墨|落笔|落字)/u.exec(paragraph.slice(Math.max(0, secretaryIndex)));
    if (secretaryIndex < 0 || !actionMatch) return false;
    const actionIndex = secretaryIndex + actionMatch.index;
    const recordMatch = /(?:记入|写入|记下|写下|写出|录下|原话)/u.exec(paragraph.slice(actionIndex));
    return Boolean(recordMatch && actionIndex - secretaryIndex <= 240 && recordMatch.index <= 120);
  });
}

function validateStateLocks(text: string, fixture: ShadowRuntimeFixture, issues: ValidationIssue[]): void {
  for (const assertion of fixture.stateLockAssertions) {
    const value = getPath(fixture.stateLocks, assertion.fieldPath);
    if (value === undefined) {
      issues.push(issue("STATE_LOCK_PATH_MISSING", `State lock path is missing: ${assertion.fieldPath}`));
      continue;
    }
    if (assertion.blockedWhen.some((blocked) => blocked === value) && new RegExp(assertion.pattern, "u").test(text)) {
      issues.push(issue(assertion.code, assertion.description));
    }
  }
}

function validateEventDrafts(
  values: unknown,
  body: string,
  endingState: ShadowEndingState | null,
  context: CompiledShadowContext,
  fixture: ShadowRuntimeFixture,
  issues: ValidationIssue[]
): { eventDrafts: ShadowEventDraft[]; materialChange: MaterialChangeReport } {
  const envelope = context.causalTurn.allowedEventEnvelope;
  const drafts = Array.isArray(values) ? values as ShadowEventDraft[] : [];
  if (fixture.causalRuntime && !Array.isArray(values)) {
    issues.push(issue("EVENT_DRAFTS_REQUIRED", "The causal Writer output must include eventDrafts."));
  }
  if (drafts.length > envelope.maxEventDrafts) {
    issues.push(issue("EVENT_DRAFT_LIMIT_EXCEEDED", `eventDrafts exceeds the allowed maximum of ${envelope.maxEventDrafts}.`));
  }
  const byType = new Map(envelope.eventCatalog.map((event) => [event.eventType, event]));
  const seen = new Set<string>();
  const accepted: ShadowEventDraft[] = [];
  const endingText = endingState
    ? [...endingState.visibleFacts, endingState.relationshipDelta].join("\n")
    : "";
  for (const draft of drafts) {
    const eventType = stringValue(draft?.eventType);
    if (!eventType || seen.has(eventType)) {
      issues.push(issue("EVENT_DRAFT_TYPE_INVALID", "eventDrafts must use unique non-empty event types."));
      continue;
    }
    seen.add(eventType);
    const definition = byType.get(eventType);
    if (!definition) {
      issues.push(issue("EVENT_TYPE_NOT_ALLOWED", `${eventType} is not in the allowed event envelope.`));
      continue;
    }
    const actorRefs = Array.isArray(draft.actorRefs) ? draft.actorRefs : definition.actorRefs;
    const targetRefs = Array.isArray(draft.targetRefs) ? draft.targetRefs : definition.targetRefs;
    if (!sameStrings(actorRefs, definition.actorRefs)) {
      issues.push(issue("EVENT_ACTOR_REFS_INVALID", `${eventType} actor refs do not match the server event definition.`));
    }
    if (!sameStrings(targetRefs, definition.targetRefs)) {
      issues.push(issue("EVENT_TARGET_REFS_INVALID", `${eventType} target refs do not match the server event definition.`));
    }
    const visibleInNarrative = eventType === "NPC_RESPONSIBILITY_PROPOSAL_RECORDED"
      ? hasCompletedSecretaryRecord(body)
      : definition.narrativeEvidencePatterns.some((pattern) => new RegExp(pattern, "u").test(body));
    if (!visibleInNarrative) {
      issues.push(issue("EVENT_DRAFT_NARRATIVE_MISMATCH", `${eventType} is listed in eventDrafts but is not observably completed in narration.body.`));
    }
    const pendingAtEnding = /书记[^。\n]{0,100}(?:等待|等候|准备|悬笔|只待|待[^。\n]{0,12}(?:表态|示下|吩咐))[^。\n]{0,60}(?:记下|记入|记录|写下|写入|录下|入册)/u.test(endingText);
    const visibleAtEnding = eventType === "NPC_RESPONSIBILITY_PROPOSAL_RECORDED"
      ? !pendingAtEnding && /书记(?=[^。\n]{0,160}(?:记下|记入|记录|写下|写入|录下|入册))(?=[^。\n]{0,160}(?:条件|责任|分责|具名|主张|请求|陈述|自陈))[^。\n]{0,160}|(?:条件|责任|分责|具名|主张|请求|陈述|自陈)[^。\n]{0,80}(?:已)?由书记[^。\n]{0,60}(?:记下|记入|记录|写下|写入|录下|入册)/u.test(endingText)
      : eventType.endsWith("CONDITION_PROPOSED")
        ? /巡抚[^。\n]{0,100}(?:提出|公开|留下)[^。\n]{0,80}(?:条件|责任|分责|担责|承担|担待|具名)|(?:条件|责任|分责|担责|承担|担待)[^。\n]{0,80}(?:巡抚|公开|留痕)/u.test(endingText)
        : true;
    if (!visibleAtEnding) {
      issues.push(issue("EVENT_DRAFT_ENDING_STATE_MISMATCH", `${eventType} occurred in narration but is absent from endingState.`));
    }
    accepted.push({
      eventDraftId: stringValue(draft.eventDraftId) || `e${accepted.length + 1}`,
      eventType,
      status: definition.status || null,
      actorRefs: [...definition.actorRefs],
      targetRefs: [...definition.targetRefs],
      tactic: definition.tactic || null,
      observableSummary: definition.observableSummary,
      materialChangeCategories: [...definition.materialChangeCategories]
    });
  }
  for (const required of envelope.requiredEventTypes) {
    if (!seen.has(required)) issues.push(issue("REQUIRED_EVENT_DRAFT_MISSING", `Required event draft is missing: ${required}`));
  }
  for (const definition of envelope.eventCatalog) {
    const appearsInNarrative = definition.eventType === "NPC_RESPONSIBILITY_PROPOSAL_RECORDED"
      ? hasCompletedSecretaryRecord(body)
      : definition.narrativeEvidencePatterns.some((pattern) => new RegExp(pattern, "u").test(body));
    if (appearsInNarrative && !seen.has(definition.eventType)) {
      issues.push(issue("EVENT_DRAFT_MISSING_FOR_NARRATIVE_CHANGE", `Narration shows ${definition.eventType}, but eventDrafts omits it.`));
    }
  }
  const materialChange = materialChangeFromCategories(
    accepted.flatMap((draft) => draft.materialChangeCategories),
    accepted.map((draft) => draft.eventType)
  );
  if (fixture.causalRuntime && !materialChange.anyMaterialChange) {
    issues.push(issue("MATERIAL_CHANGE_MISSING", "The generated turn does not contain a validated material change."));
  }
  return { eventDrafts: accepted, materialChange };
}

function sameStrings(left: string[], right: string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index]);
}

function validateDecisions(
  values: unknown,
  endingState: ShadowEndingState | null,
  fixture: ShadowRuntimeFixture,
  issues: ValidationIssue[]
): void {
  const minimum = fixture.narrativeFrame.decisionPolicy.minimum;
  const maximum = fixture.narrativeFrame.decisionPolicy.maximum;
  if (!Array.isArray(values) || values.length < minimum || values.length > maximum) {
    issues.push(issue("DECISION_COUNT_INVALID", `The shadow turn must return exactly ${minimum} decisions.`));
    return;
  }
  const affordanceMap = new Map((endingState?.affordances || []).map((item) => [item.affordanceId, item]));
  const allowedTargets = new Set([
    ...(endingState?.presentEntityRefs || []),
    ...(endingState?.availableObjectRefs || []),
    ...fixture.decisionAccess.controllableEntityRefs,
    ...fixture.decisionAccess.reachableInstitutionRefs
  ]);
  const ids = new Set<string>();
  const texts: string[] = [];
  const declaredClasses = new Set<ShadowDecisionClass>();
  const derivedClasses = new Set<ShadowDecisionClass>();
  const routeKeys = new Set<string>();
  const basisIds = new Set<string>();
  for (const decision of values as Array<Record<string, unknown>>) {
    const id = stringValue(decision?.decisionId);
    const text = stringValue(decision?.text);
    const decisionClass = stringValue(decision?.decisionClass) as ShadowDecisionClass;
    const basisAffordanceId = stringValue(decision?.basisAffordanceId);
    const targetRefs = stringArray(decision?.targetRefs, `${id || "decision"}.targetRefs`, issues);
    if (!id || ids.has(id)) issues.push(issue("DECISION_ID_INVALID", "Decision IDs must be non-empty and unique."));
    ids.add(id);
    if (!text) issues.push(issue("DECISION_FIELD_REQUIRED", `${id || "decision"}.text is required.`));
    for (const forbiddenKey of ["label", "action", "risk", "distinctAxis", "groundingClaimIds", "outcome", "reason"]) {
      if (Object.prototype.hasOwnProperty.call(decision, forbiddenKey)) {
        issues.push(issue("DECISION_PLAYER_FACING_SCHEMA_LEAK", `${id || "decision"}.${forbiddenKey} must not be emitted.`));
      }
    }
    const affordance = affordanceMap.get(basisAffordanceId);
    if (!affordance) issues.push(issue("DECISION_AFFORDANCE_NOT_FOUND", `${id || "decision"}.basisAffordanceId does not exist in endingState.affordances.`));
    if (basisAffordanceId && basisIds.has(basisAffordanceId)) issues.push(issue("DECISION_AFFORDANCE_REUSED", `${id || "decision"}.basisAffordanceId must be unique across the three decisions.`));
    basisIds.add(basisAffordanceId);
    if (!fixture.narrativeFrame.decisionPolicy.allowedClasses.includes(decisionClass)) {
      issues.push(issue("DECISION_CLASS_INVALID", `${id || "decision"}.decisionClass is not allowed.`));
    } else {
      declaredClasses.add(decisionClass);
    }
    if (affordance && affordance.actionClass !== decisionClass) {
      issues.push(issue("DECISION_AFFORDANCE_CLASS_MISMATCH", `${id || "decision"}.decisionClass must match its affordance actionClass.`));
    }
    for (const ref of targetRefs) {
      if (!allowedTargets.has(ref)) issues.push(issue("DECISION_TARGET_NOT_IMMEDIATE", `${id || "decision"} targets unavailable ref ${ref}.`));
    }
    for (const target of fixture.availableTargets) {
      if (text.includes(target.label) && allowedTargets.has(target.id) && !targetRefs.includes(target.id)) {
        issues.push(issue("DECISION_TEXT_TARGET_UNBOUND", `${id || "decision"}.targetRefs must include ${target.id}, which is explicitly acted on in the decision text.`));
      }
    }
    if (affordance && !targetRefs.includes(affordance.targetRef)) {
      issues.push(issue("DECISION_TARGET_AFFORDANCE_MISMATCH", `${id || "decision"}.targetRefs must include the affordance target.`));
    }
    routeKeys.add(`${decisionClass}:${[...targetRefs].sort().join(",")}`);
    if (!text) continue;
    texts.push(text);
    if (text.length < 6 || text.length > 60) issues.push(issue("DECISION_TEXT_LENGTH_INVALID", `${id}.text must contain 6 to 60 characters.`));
    if (/(?:复核程序|列入复核范围|核验催办依据|执行边界|民生代价|政治代价|政治压力|是否合规|行使[^，。]{0,12}权|风险[:：]?)/u.test(text)) {
      issues.push(issue("DECISION_SYSTEM_JARGON", `${id}.text uses system or policy-summary language instead of a plain player action.`));
    }
    if (/(?:可能|也许|恐怕|一旦|风险[:：]|以免|否则)/u.test(text)) {
      issues.push(issue("DECISION_RISK_EXPOSED", `${id}.text exposes a risk judgment the player should make.`));
    }
    if (/(?:我|我们|本督|请巡抚|请书记)/u.test(text)) {
      issues.push(issue("DECISION_DIALOGUE_OR_INNER_VOICE", `${id}.text must be an action summary, not dialogue or inner voice.`));
    }
    if (/[“”"]|[？?]/u.test(text)) issues.push(issue("DECISION_DIALOGUE_PUNCTUATION", `${id}.text must not simulate spoken dialogue.`));
    if (/或/u.test(text)) issues.push(issue("DECISION_AMBIGUOUS_ALTERNATIVES", `${id}.text must contain one executable action rather than alternatives joined by 或.`));
    if (decisionClass === "authority" && /暂不回应|不作回应|先不回应/u.test(text)) {
      issues.push(issue("DECISION_MULTIPLE_ACTIONS", `${id}.text must state the authority action directly without a separate non-response action.`));
    }
    if (/[，；](?:并|再|同时|要求|下令|命令|命|让|停止|放弃|明确|确认|承担|承诺|接受|拒绝|提出|改为|直接|落印|盖印|换取|结束)/u.test(text)) {
      issues.push(issue("DECISION_MULTIPLE_ACTIONS", `${id}.text must contain one immediate action rather than a second commanded action.`));
    }
    if (/(?:这笔账|这件事|此事|眼前的事)/u.test(text)) issues.push(issue("DECISION_VAGUE_REFERENCE", `${id}.text must name the concrete object being handled.`));
    if (/(?:其他|其余)(?:官员|官吏|幕僚)|商会/u.test(text)) {
      issues.push(issue("DECISION_NEW_ACTOR_UNGROUNDED", `${id}.text introduced an actor absent from the working set.`));
    }
    if (similarity(text, fixture.playerIntent.userFacingText) >= 0.72) {
      issues.push(issue("DECISION_REPEATS_COMPLETED_ACTION", `${id}.text repeats the action that has already been submitted.`));
    }
    validateDecisionAgainstActionBoundary(text, fixture, id || "decision", issues);
    validateDecisionAgainstEndingState(text, endingState, id || "decision", issues);
    const inferred = inferDecisionClasses(text);
    for (const item of inferred) derivedClasses.add(item);
    if (!inferred.includes(decisionClass)) {
      issues.push(issue("DECISION_CLASS_UNSUPPORTED_BY_TEXT", `${id}.decisionClass is not supported by the player-facing action text.`));
    }
  }
  if (declaredClasses.size < 2 || derivedClasses.size < 2) {
    issues.push(issue("DECISION_POWER_PATHS_INSUFFICIENT", "The three decisions must cover at least two independently verified power paths."));
  }
  if (routeKeys.size !== values.length) {
    issues.push(issue("DECISION_ROUTES_NOT_DISTINCT", "Every decision must use a distinct class and target route."));
  }
  for (let left = 0; left < texts.length; left += 1) {
    for (let right = left + 1; right < texts.length; right += 1) {
      if (similarity(texts[left]!, texts[right]!) >= 0.68) {
        issues.push(issue("DECISIONS_NOT_DISTINCT", `Decisions ${left + 1} and ${right + 1} are wording variants of the same action.`));
      }
    }
  }
}

function inferDecisionClasses(text: string): ShadowDecisionClass[] {
  const result = new Set<ShadowDecisionClass>();
  if (/(?:下令|命令|责令|指定|派|调动|交由|令其|出具|签发|颁下|取印|落印|盖印|落[^，。]{0,8}印|盖[^，。]{0,8}印)/u.test(text)) result.add("authority");
  if (/(?:分责|具名|具名承担|共同具名|分别具名|共同承担|双方[^，。]{0,12}承担|承担[^，。]{0,20}(?:责任|暂缓落印)|由[^，。]{0,24}(?:承担|具名|暂缓落印|调册)|担责|押字|署名|签名担责|落款担责|暂缓落印[^，。]{0,24}总督之意|(?:写明|记明)[^，。]{0,32}(?:责任|具名|承担))/u.test(text)) result.add("responsibility");
  if (/(?:封存|抄录|记录|簿册|核验|查验|收存|保管|原册|粮册|册据|留底|划去|修改记录|更正记录)/u.test(text)) result.add("evidence_control");
  if (/(?:范围|首轮|首批|先查|只查|先调取|试点|全面|扩大|缩小|分批)/u.test(text)) result.add("scope_change");
  if (/(?:密令|密奏|不公开|封口|暗中|私下)/u.test(text)) result.add("secrecy");
  if (/(?:条件|承诺|交换|答应|同意|让步|各退一步|折中|商议|协商|重议|调整责任|联名|替代|回应巡抚|接受巡抚|驳回巡抚|要求巡抚|向巡抚提出|共同具名|重新约定|(?:接受|拒绝|修改|改为)[^，。]{0,24}(?:条件|责任|具名|约定)|(?:提出|提议)[^，。]{0,24}(?:共同|共担|各担|替代|责任))/u.test(text)) result.add("negotiation");
  return [...result];
}

function validateDecisionAgainstEndingState(
  text: string,
  endingState: ShadowEndingState | null,
  id: string,
  issues: ValidationIssue[]
): void {
  if (!endingState) return;
  const endingText = [...endingState.visibleFacts, endingState.relationshipDelta].join("\n");
  const secretaryAlreadyRecorded = /书记(?=[^。\n]{0,100}(?:已|已经))(?=[^。\n]{0,100}(?:记录|记入|写入|写下|录下|入簿|入册))(?=[^。\n]{0,100}(?:条件|责任|分歧|暂缓落印))[^。\n]{0,100}/u.test(endingText)
    && !/书记[^。\n]{0,40}(?:准备|等待|将要|将)[^。\n]{0,40}(?:记录|记入|写入|写下|录下)/u.test(endingText);
  const asksForFirstRecord = /(?:让|命令|指示|要求)?书记[^，。]{0,24}(?:先|再|重新)?[^，。]{0,16}(?:记录|记入|写入|写明)|(?:先|再|重新)[^，。]{0,20}(?:记录|记入|写入簿册)/u.test(text);
  const explicitlyChangesExistingRecord = /(?:更正|修改|改写|重写|划去|删去|补记|追加|封存|留底|确认|具名|押字)/u.test(text);
  if (secretaryAlreadyRecorded && asksForFirstRecord && !explicitlyChangesExistingRecord) {
    issues.push(issue("DECISION_REPEATS_ENDING_ACTION", `${id}.text repeats a ledger-recording action already completed in endingState.`));
  }
}

function validateDecisionAgainstActionBoundary(
  text: string,
  fixture: ShadowRuntimeFixture,
  id: string,
  issues: ValidationIssue[]
): void {
  const secretaryRecordedRegisterOrder = fixture.actionBoundary.alreadyOccurred.some((item) => /书记[^。]{0,20}(?:调取命令|原粮册|改桑申报册)[^。]{0,20}(?:记入|记录)|书记[^。]{0,20}(?:记入|记录)[^。]{0,20}(?:调取命令|原粮册|改桑申报册)/u.test(item));
  const repeatsRegisterOrderRecord = /(?:让|命令|指示|要求)?书记[^，。]{0,28}(?:(?:记录|记入|写入)[^，。]{0,24}(?:调册命令|调取命令|原粮册和改桑申报册)|(?:调册命令|调取命令|原粮册和改桑申报册)[^，。]{0,24}(?:记录|记入|写入))|(?:记录|记入|写入)[^，。]{0,24}(?:调册命令|调取命令)/u.test(text);
  const explicitlyChangesExistingRecord = /(?:更正|修改|改写|重写|划去|删去|补记|追加|封存|留底|确认)/u.test(text);
  if (secretaryRecordedRegisterOrder && repeatsRegisterOrderRecord && !explicitlyChangesExistingRecord) {
    issues.push(issue("DECISION_REPEATS_ACTION_BOUNDARY", `${id}.text repeats the register-order recording already completed before the first new beat.`));
  }
}

function validateVisibleFactsAgainstBody(
  visibleFacts: string[],
  body: string,
  fixture: ShadowRuntimeFixture,
  issues: ValidationIssue[]
): void {
  if (!body) return;
  const secretaryRecordClaim = /书记(?=[^。]{0,100}(?:已|已经))(?=[^。]{0,100}(?:记录|记入|写入|写下|录下|入簿|入册))(?=[^。]{0,100}(?:条件|责任|分歧|暂缓落印))[^。]{0,100}/u;
  for (const fact of visibleFacts) {
    const pendingRecordClaim = /书记[^。]{0,40}(?:准备|等待|将要|将)[^。]{0,40}(?:记录|记入|写入|写下|录下)/u.test(fact);
    if (secretaryRecordClaim.test(fact) && !pendingRecordClaim && !hasCompletedSecretaryRecord(body)) {
      issues.push(issue("ENDING_STATE_VISIBLE_FACT_UNGROUNDED", "endingState says the secretary recorded a new condition, but narration.body does not show that action."));
    }
    if (/墨迹[^。]{0,8}(?:已干|干透)/u.test(fact) && /墨迹[^。]{0,12}(?:未干|尚未干|墨色新润)/u.test(body)) {
      issues.push(issue("ENDING_STATE_VISIBLE_FACT_CONTRADICTS_BODY", "endingState says the fresh ink is dry, contradicting narration.body."));
    }
  }
  const checks: Array<{ code: "registers" | "review" | "document"; claim: RegExp; body: RegExp; message: string }> = [
    {
      code: "registers",
      claim: /(?:原粮册|改桑申报册|两类册据|册据)[^。]{0,24}(?:尚未|未曾|没有|仍未)(?:送达|送到)/u,
      body: /(?:原粮册|改桑申报册|两类册据|册据)[^。]{0,32}(?:(?:尚未|未曾|没有|仍未)(?:送达|送到)|未到)/u,
      message: "endingState says the registers have not arrived, but narration.body does not render that visible state."
    },
    {
      code: "review",
      claim: /(?:核对|查验)[^。]{0,16}(?:尚未开始|未开始)/u,
      body: /(?:核对|查验)[^。]{0,20}(?:尚未开始|未开始|未始)/u,
      message: "endingState says review has not begun, but narration.body does not render that visible state."
    },
    {
      code: "document",
      claim: /(?:放行文书|文书)[^。]{0,20}(?:仍未|尚未|没有)(?:落印|盖印)|印泥[^。]{0,12}(?:未启|尚未启)/u,
      body: /(?:放行文书|文书)[^。]{0,24}(?:仍未|仍然未|依旧未|依然未|尚未|没有)(?:落印|盖印)|(?:仍未|仍然未|依旧未|依然未|尚未|没有|未)落印的(?:放行文书|文书)|印泥[^。]{0,16}(?:未启|尚未启|未沾|未动|未用)|总督印[^。]{0,20}(?:静立|搁|放)[^。]{0,12}(?:一旁|旁边)[^。]{0,20}(?:无人触碰|未动)/u,
      message: "endingState states the document or seal-paste state without rendering it in narration.body."
    }
  ];
  for (const fact of visibleFacts) {
    for (const check of checks) {
      const confirmedCarryForward = check.code === "registers"
        ? fixture.stateLocks.registers?.originalGrainRegistersAtGovernorOffice === false
          && fixture.stateLocks.registers?.reformRegistersAtGovernorOffice === false
          && fixture.stateLocks.registers?.anyRegistersInTransit === false
        : check.code === "review"
          ? fixture.stateLocks.registers?.reviewStarted === false
          : fixture.stateLocks.scene?.releaseDocumentStamped === false;
      if (confirmedCarryForward) continue;
      if (check.claim.test(fact) && !check.body.test(body)) {
        issues.push(issue("ENDING_STATE_VISIBLE_FACT_UNGROUNDED", check.message));
      }
    }
  }
}

function validateUnresolvedFactsAgainstEnding(
  unresolvedFacts: string[],
  body: string,
  visibleFacts: string[],
  relationshipDelta: string,
  issues: ValidationIssue[]
): void {
  const resolvedText = [body, ...visibleFacts, relationshipDelta].join("\n");
  const xunfuConditionVisible = /巡抚[^。\n]{0,100}(?:提出|说出|给出|写下)[^。\n]{0,30}(?:条件|具名|担责)|(?:条件|具名责任)[^。\n]{0,40}(?:已经|已)[^。\n]{0,20}(?:提出|公开|写入)/u.test(resolvedText);
  if (xunfuConditionVisible && unresolvedFacts.some((fact) => /巡抚是否[^。]{0,30}提出条件|巡抚是否会[^。]{0,30}(?:提出条件|设置阻力)/u.test(fact))) {
    issues.push(issue("ENDING_STATE_UNRESOLVED_ALREADY_RESOLVED", "endingState keeps the xunfu's response unresolved after the body visibly shows his condition."));
  }
}

function validateAllowedIds(values: unknown, allowed: string[], code: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(values)) {
    issues.push(issue("GROUNDING_ARRAY_REQUIRED", `${code} field must be an array.`));
    return;
  }
  for (const value of values) {
    if (typeof value !== "string" || !allowed.includes(value)) issues.push(issue(code, `${String(value)} is not in the allowed set.`));
  }
}

function stringArray(value: unknown, label: string, issues: ValidationIssue[]): string[] {
  if (!Array.isArray(value)) {
    issues.push(issue("OUTPUT_ARRAY_REQUIRED", `${label} must be an array.`));
    return [];
  }
  const result = value.map((item) => stringValue(item)).filter(Boolean);
  if (result.length !== value.length || new Set(result).size !== result.length) {
    issues.push(issue("OUTPUT_ARRAY_VALUES_INVALID", `${label} must contain unique non-empty strings.`));
  }
  return result;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getPath(value: Record<string, Record<string, ShadowStateLockValue>>, path: string): ShadowStateLockValue | undefined {
  const [group, key] = path.split(".");
  if (!group || !key) return undefined;
  return value[group]?.[key];
}

function replaysRecentCanon(body: string, canon: string): boolean {
  if (!body || !canon) return false;
  const sentences = canon.split(/[。！？!?\n]+/u).map((item) => item.trim()).filter((item) => item.length >= 16);
  return sentences.some((sentence) => body.includes(sentence));
}

function similarity(left: string, right: string): number {
  const a = grams(left);
  const b = grams(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const gram of a) if (b.has(gram)) overlap += 1;
  return overlap / Math.max(a.size, b.size);
}

function grams(value: string): Set<string> {
  const normalized = value.replace(/[\s，。；、,.!?！？]/gu, "");
  const result = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2));
  return result;
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1]!.trim() : trimmed;
}

function issue(code: string, message: string): ValidationIssue {
  return { severity: "error", code, message };
}

function removeConditionalClauses(value: string): string {
  return value.replace(/(?:若|如果|一旦|倘若|假使)[^。！？!?\n]*(?:[。！？!?]|$)/gu, "");
}

function extractTimeConstraints(value: string): string[] {
  const dateDeadlines = value.match(/(?:正月|[一二三四五六七八九十百零〇两0-9]+月)[初一二三四五六七八九十廿卅0-9]+(?:日)?(?:前|内|之前|以前|截止)/gu) || [];
  const durationDeadlines = value.match(/[一二三四五六七八九十百零〇两0-9]+(?:日|天|月)内/gu) || [];
  const relativeDurations = value.match(/(?:近|前|过去|最近)[一二三四五六七八九十百零〇两0-9]+(?:年|月|日|天)/gu) || [];
  const relativeDeadlines = value.match(/明日|翌日|次日|今夜|今晚|一夜/gu) || [];
  return [...new Set([...dateDeadlines, ...durationDeadlines, ...relativeDurations, ...relativeDeadlines])];
}

function extractQuantitativeClaims(value: string): string[] {
  return [...new Set(value.match(/[零〇一二三四五六七八九十百千万两0-9]+(?:年|月|日|天|县|户|亩|顷|批)/gu) || [])];
}
