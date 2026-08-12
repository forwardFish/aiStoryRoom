const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const RELEASE_ROOT = __dirname;
const SHA256 = /^[a-f0-9]{64}$/u;
const SANGTIAN_ACTION_EFFECT_COMPILER_VERSION_V1 =
  "sangtian-action-effect-compiler-1.0.0";
const EXACT_ROUTE = Object.freeze({
  engineVersion: "pressure_chapter_v1",
  strategyVersion: "sangtian_pressure_chapter_v1_0",
  runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1",
  endgamePolicyVersion: "sangtian_content_finale_v1",
  resultSchemaVersion: "sangtian_pressure_result_v1",
});

class SangtianActionEffectPolicyError extends Error {
  constructor(code, path, detail) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
    this.name = "SangtianActionEffectPolicyError";
    this.code = code;
    this.path = path;
    this.detail = detail;
  }
}

/**
 * @typedef {{
 *   actionId: string,
 *   decisionPointKey: string,
 *   seatId: string,
 *   actionType: string
 * }} ConfirmedActionV1
 *
 * @typedef {{
 *   eventId: string,
 *   eventType: "APPLY_DEFAULT_TRAJECTORY"
 * }} DefaultTrajectoryEventV1
 */

/** Load and fail-closed validate the frozen policy and its accepted content binding. */
function loadSangtianActionEffectPolicyV1(options = {}) {
  const policyPath = resolve(
    options.releaseRoot ?? RELEASE_ROOT,
    options.policyFile ?? "action-effect-policy.json",
  );
  const contentPath = resolve(
    options.releaseRoot ?? RELEASE_ROOT,
    options.contentFile ?? "../content.json",
  );
  const policy = readJson(policyPath, "policy");
  const content = readJson(contentPath, "content");
  validatePolicy(policy, content, options.releaseRoot ?? RELEASE_ROOT);
  return deepFreeze(structuredClone(policy));
}

/** Load and fail-closed validate the presentation-only catalog. */
function loadSangtianActionPresentationCatalogV1(options = {}) {
  const catalogPath = resolve(
    options.releaseRoot ?? RELEASE_ROOT,
    options.catalogFile ?? "action-presentation-catalog.json",
  );
  const contentPath = resolve(
    options.releaseRoot ?? RELEASE_ROOT,
    options.contentFile ?? "../content.json",
  );
  const catalog = readJson(catalogPath, "catalog");
  const content = readJson(contentPath, "content");
  validateSelfHash(catalog, "catalogSha256", "catalog");
  exactLiteral(catalog.schemaVersion, "sangtian_action_presentation_catalog_v1", "catalog.schemaVersion");
  exactLiteral(catalog.runtimeProfile, EXACT_ROUTE.runtimeProfile, "catalog.runtimeProfile");
  exactLiteral(
    catalog.sourceBinding?.contentPackageSha256,
    sha256Canonical(content),
    "catalog.sourceBinding.contentPackageSha256",
  );
  validateDecisionCoverage(catalog.chapters, content, "catalog", true);
  return deepFreeze(structuredClone(catalog));
}

/**
 * Compile one exact chapter/decision/seat/action binding into a server-owned
 * WorkingIntent plus selector-fact contributions. No client text is read.
 */
function compileSangtianActionBindingV1(policy, input) {
  assertExactKeys(
    input,
    ["chapterId", "decisionPointKey", "seatId", "actionType"],
    "bindingInput",
  );
  const chapter = findChapter(policy, input.chapterId);
  const decision = chapter.decisions.find(
    (candidate) => candidate.decisionPointKey === input.decisionPointKey,
  );
  if (!decision) fail("SANGTIAN_ACTION_EFFECT_BINDING_NOT_FOUND", "bindingInput.decisionPointKey");
  if (!decision.requiredSeatIds.includes(input.seatId)) {
    fail("SANGTIAN_ACTION_EFFECT_BINDING_NOT_FOUND", "bindingInput.seatId");
  }
  const action = decision.actions.find((candidate) => candidate.actionType === input.actionType);
  if (!action) fail("SANGTIAN_ACTION_EFFECT_BINDING_NOT_FOUND", "bindingInput.actionType");
  const mode = policy.compilerContract.workingIntentExpansion[action.workingIntentMode];
  if (!mode) fail("SANGTIAN_ACTION_EFFECT_CONTENT_DRIFT", "binding.workingIntentMode");
  const factContributions = [
    ...action.factContributions,
    ...(action.seatFactContributions?.[input.seatId] ?? []),
  ].map((contribution) => structuredClone(contribution));
  const workingIntent = {
    visibility: mode.visibility,
    targetSeatIds: mode.targetSeatRule === "DECISION_REQUIRED_SEATS"
      ? [...decision.requiredSeatIds]
      : [],
    evidenceRefs: [...mode.evidenceRefs],
    resourceReservations: [],
    commitmentMutations: [...mode.commitmentMutations],
    knowledgeGrants: [...mode.knowledgeGrants],
    seatArcProgress: [...mode.seatArcProgress],
  };
  const compiled = {
    schemaVersion: "sangtian_compiled_action_effect_v1",
    policyVersion: policy.policyVersion,
    compilerVersion: policy.compilerVersion,
    chapterId: input.chapterId,
    decisionPointKey: input.decisionPointKey,
    seatId: input.seatId,
    actionType: input.actionType,
    workingIntent,
    factContributions,
    resourcePolicy: "NONE",
  };
  return deepFreeze({
    ...compiled,
    bindingHash: sha256Canonical(compiled),
  });
}

/**
 * Compile an order-independent chapter action set.
 *
 * @param {object} policy validated policy returned by the loader
 * @param {{
 *   chapterId: string,
 *   confirmedActions: ConfirmedActionV1[],
 *   defaultEvents: DefaultTrajectoryEventV1[]
 * }} input
 */
function compileSangtianChapterActionEffectsV1(policy, input) {
  assertExactKeys(input, ["chapterId", "confirmedActions", "defaultEvents"], "chapterInput");
  const chapter = findChapter(policy, input.chapterId);
  if (!Array.isArray(input.confirmedActions)) {
    fail("SANGTIAN_ACTION_EFFECT_CONTRIBUTION_INVALID", "chapterInput.confirmedActions", "ARRAY");
  }
  if (!Array.isArray(input.defaultEvents)) {
    fail("SANGTIAN_ACTION_EFFECT_CONTRIBUTION_INVALID", "chapterInput.defaultEvents", "ARRAY");
  }
  const defaultEvents = input.defaultEvents.map((event, index) => {
    assertExactKeys(event, ["eventId", "eventType"], `chapterInput.defaultEvents[${index}]`);
    nonEmpty(event.eventId, `chapterInput.defaultEvents[${index}].eventId`);
    exactLiteral(
      event.eventType,
      "APPLY_DEFAULT_TRAJECTORY",
      `chapterInput.defaultEvents[${index}].eventType`,
    );
    return structuredClone(event);
  });
  if (defaultEvents.length > 1) {
    fail("SANGTIAN_ACTION_EFFECT_DEFAULT_TRAJECTORY_DUPLICATE", "chapterInput.defaultEvents");
  }

  const uniqueActions = new Map();
  for (let index = 0; index < input.confirmedActions.length; index += 1) {
    const candidate = input.confirmedActions[index];
    assertExactKeys(
      candidate,
      ["actionId", "decisionPointKey", "seatId", "actionType"],
      `chapterInput.confirmedActions[${index}]`,
    );
    nonEmpty(candidate.actionId, `chapterInput.confirmedActions[${index}].actionId`);
    const prior = uniqueActions.get(candidate.actionId);
    if (prior && sha256Canonical(prior) !== sha256Canonical(candidate)) {
      fail("SANGTIAN_ACTION_EFFECT_ACTION_CONFLICT", `chapterInput.confirmedActions.${candidate.actionId}`);
    }
    if (!prior) uniqueActions.set(candidate.actionId, structuredClone(candidate));
  }
  const actions = [...uniqueActions.values()].sort((left, right) => {
    const leftOrdinal = decisionOrdinal(chapter, left.decisionPointKey);
    const rightOrdinal = decisionOrdinal(chapter, right.decisionPointKey);
    return leftOrdinal - rightOrdinal
      || compareText(left.seatId, right.seatId)
      || compareText(left.actionType, right.actionType)
      || compareText(left.actionId, right.actionId);
  });
  const compiledActions = actions.map((action) => ({
    actionId: action.actionId,
    ...compileSangtianActionBindingV1(policy, {
      chapterId: input.chapterId,
      decisionPointKey: action.decisionPointKey,
      seatId: action.seatId,
      actionType: action.actionType,
    }),
  }));

  if (defaultEvents.length === 1) {
    const nonDefault = actions.find((action) => action.actionType !== "DEFAULT_PASS");
    if (nonDefault) {
      fail(
        "SANGTIAN_ACTION_EFFECT_DEFAULT_TRAJECTORY_CONFLICT",
        `chapterInput.confirmedActions.${nonDefault.actionId}`,
      );
    }
    return freezeChapterResult(policy, chapter, compiledActions, {
      settlementFacts: structuredClone(chapter.defaultTrajectory.settlementFacts),
      defaultTrajectoryEventId: defaultEvents[0].eventId,
      aggregationMode: "DEFAULT_TRAJECTORY_ONCE",
    });
  }

  const accumulator = createAccumulator(chapter.factAggregators);
  for (const action of compiledActions) {
    for (const contribution of action.factContributions) {
      reduceContribution(accumulator, chapter.factAggregators, contribution, action.seatId);
    }
  }
  const settlementFacts = finalizeAccumulator(accumulator, chapter.factAggregators);
  return freezeChapterResult(policy, chapter, compiledActions, {
    settlementFacts,
    defaultTrajectoryEventId: null,
    aggregationMode: "ACTION_CONTRIBUTIONS",
  });
}

function sha256Canonical(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function hashWithoutField(value, field) {
  return sha256Canonical(Object.fromEntries(Object.entries(value).filter(([key]) => key !== field)));
}

function validatePolicy(policy, content, releaseRoot) {
  validateSelfHash(policy, "policySha256", "policy");
  exactLiteral(policy.schemaVersion, "sangtian_action_effect_policy_v1", "policy.schemaVersion");
  exactLiteral(policy.runtimeProfile, EXACT_ROUTE.runtimeProfile, "policy.runtimeProfile");
  for (const [key, expected] of Object.entries(EXACT_ROUTE)) {
    exactLiteral(policy.route?.[key], expected, `policy.route.${key}`);
  }
  exactLiteral(
    policy.sourceBinding?.contentPackageSha256,
    sha256Canonical(content),
    "policy.sourceBinding.contentPackageSha256",
  );
  exactLiteral(policy.resourcePolicy?.mode, "NONE", "policy.resourcePolicy.mode");
  exactLiteral(policy.compilerModule?.corePath, "action-effect-compiler.cjs", "policy.compilerModule.corePath");
  exactLiteral(policy.compilerModule?.coreModuleFormat, "COMMONJS", "policy.compilerModule.coreModuleFormat");
  exactLiteral(policy.compilerModule?.esmWrapperPath, "action-effect-compiler.mjs", "policy.compilerModule.esmWrapperPath");
  exactLiteral(policy.compilerModule?.esmWrapperFormat, "ESM", "policy.compilerModule.esmWrapperFormat");
  exactLiteral(
    policy.compilerModule?.coreSha256RawBytes,
    sha256RawFile(resolve(releaseRoot, policy.compilerModule.corePath)),
    "policy.compilerModule.coreSha256RawBytes",
  );
  exactLiteral(
    policy.compilerModule?.esmWrapperSha256RawBytes,
    sha256RawFile(resolve(releaseRoot, policy.compilerModule.esmWrapperPath)),
    "policy.compilerModule.esmWrapperSha256RawBytes",
  );
  if (
    policy.resourcePolicy.workingIntentResourceReservations.length !== 0
    || policy.resourcePolicy.beatReservationMutations.length !== 0
  ) {
    fail("SANGTIAN_ACTION_EFFECT_CONTENT_DRIFT", "policy.resourcePolicy", "NON_ZERO_RESOURCE_MVP");
  }
  validateDecisionCoverage(policy.chapterPolicies, content, "policy", false);
  let expandedCount = 0;
  const bindingKeys = new Set();
  for (const chapter of policy.chapterPolicies) {
    const factRefs = new Set();
    for (const [index, aggregator] of chapter.factAggregators.entries()) {
      nonEmpty(aggregator.factRef, `policy.${chapter.chapterId}.factAggregators[${index}].factRef`);
      if (factRefs.has(aggregator.factRef)) {
        fail("SANGTIAN_ACTION_EFFECT_CONTENT_DRIFT", `policy.${chapter.chapterId}.factAggregators`, "DUPLICATE_FACT");
      }
      factRefs.add(aggregator.factRef);
      validateReducer(aggregator, `policy.${chapter.chapterId}.factAggregators[${index}]`);
    }
    const defaultFacts = Object.keys(chapter.defaultTrajectory.settlementFacts).sort(compareText);
    if (sha256Canonical(defaultFacts) !== sha256Canonical([...factRefs].sort(compareText))) {
      fail("SANGTIAN_ACTION_EFFECT_FACT_MISSING", `policy.${chapter.chapterId}.defaultTrajectory`);
    }
    for (const [band, witness] of Object.entries(chapter.selectorWitnesses)) {
      const witnessFacts = Object.keys(witness).sort(compareText);
      if (sha256Canonical(witnessFacts) !== sha256Canonical([...factRefs].sort(compareText))) {
        fail("SANGTIAN_ACTION_EFFECT_FACT_MISSING", `policy.${chapter.chapterId}.selectorWitnesses.${band}`);
      }
    }
    for (const decision of chapter.decisions) {
      for (const action of decision.actions) {
        validateContributions(action.factContributions, factRefs, `${decision.decisionPointKey}.${action.actionType}`);
        for (const [seatId, contributions] of Object.entries(action.seatFactContributions ?? {})) {
          if (!decision.requiredSeatIds.includes(seatId)) {
            fail("SANGTIAN_ACTION_EFFECT_CONTENT_DRIFT", `${decision.decisionPointKey}.${action.actionType}.${seatId}`);
          }
          validateContributions(contributions, factRefs, `${decision.decisionPointKey}.${action.actionType}.${seatId}`);
        }
        for (const seatId of decision.requiredSeatIds) {
          const key = [chapter.chapterId, decision.decisionPointKey, seatId, action.actionType].join("|");
          if (bindingKeys.has(key)) {
            fail("SANGTIAN_ACTION_EFFECT_BINDING_DUPLICATE", key);
          }
          bindingKeys.add(key);
          expandedCount += 1;
        }
      }
    }
  }
  exactLiteral(
    expandedCount,
    policy.bindingExpansion.expectedExpandedBindingCount,
    "policy.bindingExpansion.expectedExpandedBindingCount",
  );
}

function validateDecisionCoverage(releaseChapters, content, path, presentation) {
  if (!Array.isArray(releaseChapters) || releaseChapters.length !== content.chapters.length) {
    fail("SANGTIAN_ACTION_EFFECT_CONTENT_DRIFT", `${path}.chapters`, "CHAPTER_COUNT");
  }
  for (let chapterIndex = 0; chapterIndex < content.chapters.length; chapterIndex += 1) {
    const authoredChapter = content.chapters[chapterIndex];
    const releaseChapter = releaseChapters[chapterIndex];
    exactLiteral(releaseChapter.chapterId, authoredChapter.chapterId, `${path}.chapters[${chapterIndex}].chapterId`);
    const decisions = presentation ? releaseChapter.decisions : releaseChapter.decisions;
    if (!Array.isArray(decisions) || decisions.length !== authoredChapter.decisionPoints.length) {
      fail("SANGTIAN_ACTION_EFFECT_CONTENT_DRIFT", `${path}.${authoredChapter.chapterId}.decisions`, "COUNT");
    }
    for (let decisionIndex = 0; decisionIndex < decisions.length; decisionIndex += 1) {
      const authored = authoredChapter.decisionPoints[decisionIndex];
      const release = decisions[decisionIndex];
      exactLiteral(release.decisionPointKey, authored.decisionPointKey, `${path}.decisionPointKey`);
      if (!presentation) {
        exactLiteral(
          sha256Canonical(release.requiredSeatIds),
          sha256Canonical(authored.requiredSeatIds),
          `${path}.${authored.decisionPointKey}.requiredSeatIds`,
        );
      }
      const actionTypes = release.actions.map((action) => action.actionType);
      exactLiteral(
        sha256Canonical(actionTypes),
        sha256Canonical(authored.allowedActionTypes),
        `${path}.${authored.decisionPointKey}.actions`,
      );
    }
  }
}

function validateSelfHash(value, field, path) {
  if (!SHA256.test(value?.[field])) fail("SANGTIAN_ACTION_EFFECT_HASH_INVALID", `${path}.${field}`);
  exactLiteral(value[field], hashWithoutField(value, field), `${path}.${field}`);
}

function validateReducer(aggregator, path) {
  const allowed = new Set([
    "MAX", "MIN", "BOOLEAN_OR", "BOOLEAN_AND", "ENUM_MAX", "COUNT_DISTINCT_SEATS",
  ]);
  if (!allowed.has(aggregator.reducer)) fail("SANGTIAN_ACTION_EFFECT_CONTRIBUTION_INVALID", `${path}.reducer`);
  if (!("identity" in aggregator)) fail("SANGTIAN_ACTION_EFFECT_FACT_MISSING", `${path}.identity`);
  if (aggregator.reducer === "ENUM_MAX" && (!Array.isArray(aggregator.enumOrder) || !aggregator.enumOrder.includes(aggregator.identity))) {
    fail("SANGTIAN_ACTION_EFFECT_CONTRIBUTION_INVALID", `${path}.enumOrder`);
  }
}

function validateContributions(contributions, factRefs, path) {
  if (!Array.isArray(contributions)) fail("SANGTIAN_ACTION_EFFECT_CONTRIBUTION_INVALID", path, "ARRAY");
  for (let index = 0; index < contributions.length; index += 1) {
    const contribution = contributions[index];
    assertExactKeys(contribution, ["factRef", "value"], `${path}.factContributions[${index}]`);
    if (!factRefs.has(contribution.factRef)) {
      fail("SANGTIAN_ACTION_EFFECT_CONTRIBUTION_INVALID", `${path}.${contribution.factRef}`, "UNKNOWN_FACT");
    }
  }
}

function createAccumulator(aggregators) {
  return new Map(aggregators.map((aggregator) => [
    aggregator.factRef,
    aggregator.reducer === "COUNT_DISTINCT_SEATS"
      ? { value: aggregator.identity, seats: new Set() }
      : { value: structuredClone(aggregator.identity), seats: null },
  ]));
}

function reduceContribution(accumulator, aggregators, contribution, seatId) {
  const aggregator = aggregators.find((candidate) => candidate.factRef === contribution.factRef);
  if (!aggregator) fail("SANGTIAN_ACTION_EFFECT_CONTRIBUTION_INVALID", contribution.factRef);
  const state = accumulator.get(contribution.factRef);
  switch (aggregator.reducer) {
    case "MAX":
      numeric(contribution.value, contribution.factRef);
      state.value = Math.max(state.value, contribution.value);
      break;
    case "MIN":
      numeric(contribution.value, contribution.factRef);
      state.value = Math.min(state.value, contribution.value);
      break;
    case "BOOLEAN_OR":
      boolean(contribution.value, contribution.factRef);
      state.value = state.value || contribution.value;
      break;
    case "BOOLEAN_AND":
      boolean(contribution.value, contribution.factRef);
      state.value = state.value && contribution.value;
      break;
    case "ENUM_MAX": {
      const rank = aggregator.enumOrder.indexOf(contribution.value);
      const currentRank = aggregator.enumOrder.indexOf(state.value);
      if (rank < 0 || currentRank < 0) {
        fail("SANGTIAN_ACTION_EFFECT_CONTRIBUTION_INVALID", contribution.factRef, "ENUM");
      }
      if (rank > currentRank) state.value = contribution.value;
      break;
    }
    case "COUNT_DISTINCT_SEATS":
      numeric(contribution.value, contribution.factRef);
      if (contribution.value !== 1) {
        fail("SANGTIAN_ACTION_EFFECT_CONTRIBUTION_INVALID", contribution.factRef, "DISTINCT_SEAT_VALUE_ONE");
      }
      state.seats.add(seatId);
      state.value = state.seats.size;
      break;
    default:
      fail("SANGTIAN_ACTION_EFFECT_CONTRIBUTION_INVALID", contribution.factRef, "REDUCER");
  }
}

function finalizeAccumulator(accumulator, aggregators) {
  return Object.fromEntries(
    aggregators.map((aggregator) => [aggregator.factRef, structuredClone(accumulator.get(aggregator.factRef).value)]),
  );
}

function freezeChapterResult(policy, chapter, compiledActions, facts) {
  const result = {
    schemaVersion: "sangtian_compiled_chapter_action_effects_v1",
    policyVersion: policy.policyVersion,
    compilerVersion: policy.compilerVersion,
    aggregationVersion: policy.aggregationVersion,
    chapterId: chapter.chapterId,
    aggregationMode: facts.aggregationMode,
    defaultTrajectoryEventId: facts.defaultTrajectoryEventId,
    confirmedActionIds: compiledActions.map((action) => action.actionId),
    workingIntents: compiledActions.map((action) => ({
      actionId: action.actionId,
      workingIntent: structuredClone(action.workingIntent),
    })),
    settlementFacts: structuredClone(facts.settlementFacts),
    resourceReservationMutations: [],
    chapterEndResourceDispositions: [],
  };
  return deepFreeze({ ...result, compilationHash: sha256Canonical(result) });
}

function findChapter(policy, chapterId) {
  const chapter = policy.chapterPolicies.find((candidate) => candidate.chapterId === chapterId);
  if (!chapter) fail("SANGTIAN_ACTION_EFFECT_BINDING_NOT_FOUND", "chapterId", chapterId);
  return chapter;
}

function decisionOrdinal(chapter, decisionPointKey) {
  const ordinal = chapter.decisions.findIndex((decision) => decision.decisionPointKey === decisionPointKey);
  if (ordinal < 0) fail("SANGTIAN_ACTION_EFFECT_BINDING_NOT_FOUND", "decisionPointKey", decisionPointKey);
  return ordinal;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail("SANGTIAN_ACTION_EFFECT_CONTENT_DRIFT", label, error instanceof Error ? error.message : "READ");
  }
}

function sha256RawFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function canonicalJson(value, path = "$", ancestors = new WeakSet()) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("SANGTIAN_ACTION_EFFECT_CONTRIBUTION_INVALID", path, "NON_FINITE_NUMBER");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (typeof value !== "object") fail("SANGTIAN_ACTION_EFFECT_CONTRIBUTION_INVALID", path, typeof value);
  if (ancestors.has(value)) fail("SANGTIAN_ACTION_EFFECT_CONTRIBUTION_INVALID", path, "CYCLE");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item, index) => canonicalJson(item, `${path}[${index}]`, ancestors)).join(",")}]`;
    }
    const keys = Object.keys(value).sort(compareText);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], `${path}.${key}`, ancestors)}`).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function assertExactKeys(value, fields, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("SANGTIAN_ACTION_EFFECT_CONTRIBUTION_INVALID", path, "OBJECT");
  }
  const actual = Object.keys(value).sort(compareText);
  const expected = [...fields].sort(compareText);
  if (sha256Canonical(actual) !== sha256Canonical(expected)) {
    fail("SANGTIAN_ACTION_EFFECT_CONTRIBUTION_INVALID", path, "EXACT_FIELDS");
  }
}

function nonEmpty(value, path) {
  if (typeof value !== "string" || !value.trim()) {
    fail("SANGTIAN_ACTION_EFFECT_CONTRIBUTION_INVALID", path, "NON_EMPTY_STRING");
  }
}

function numeric(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("SANGTIAN_ACTION_EFFECT_CONTRIBUTION_INVALID", path, "NUMBER");
  }
}

function boolean(value, path) {
  if (typeof value !== "boolean") {
    fail("SANGTIAN_ACTION_EFFECT_CONTRIBUTION_INVALID", path, "BOOLEAN");
  }
}

function exactLiteral(actual, expected, path) {
  if (actual !== expected) fail("SANGTIAN_ACTION_EFFECT_CONTENT_DRIFT", path, `EXPECTED_${expected}`);
}

function compareText(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function fail(code, path, detail) {
  throw new SangtianActionEffectPolicyError(code, path, detail);
}

module.exports = Object.freeze({
  SANGTIAN_ACTION_EFFECT_COMPILER_VERSION_V1,
  SangtianActionEffectPolicyError,
  loadSangtianActionEffectPolicyV1,
  loadSangtianActionPresentationCatalogV1,
  compileSangtianActionBindingV1,
  compileSangtianChapterActionEffectsV1,
  sha256Canonical,
  hashWithoutField,
});
