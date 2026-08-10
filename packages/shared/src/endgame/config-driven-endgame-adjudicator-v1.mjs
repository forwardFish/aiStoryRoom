import { createHash } from "node:crypto";
import {
  canonicalizeJcs,
  evaluateBooleanExpression,
  evaluateNumericExpression
} from "./endgame-package-v1.contract.mjs";
import { resolveFrozenEndgamePackageForRunV1 } from "./endgame-package-loader-v1.mjs";

export const ENDGAME_CANDIDATE_PROJECTION_SCHEMA_VERSION = "endgame_candidate_projection_v1";
export const ENDGAME_ADJUDICATION_SCHEMA_VERSION = "endgame_adjudication_v3";

const PACKAGE_REF_KEYS = Object.freeze(["policyId", "policyVersion", "packageHash"]);
const ADJUDICATION_KEYS = Object.freeze([
  "schemaVersion",
  "packageRef",
  "scope",
  "finalMetrics",
  "resolvedAxes",
  "combinationId",
  "sourceRevision"
]);
const RESOLVED_AXIS_KEYS = Object.freeze(["axisId", "outcomeId"]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const FORBIDDEN_RECORD_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export class ConfigDrivenEndgameAdjudicationError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "ConfigDrivenEndgameAdjudicationError";
    this.code = code;
    this.details = deepFreeze(structuredClone(details));
  }
}

export function evaluateDerivedEndgameMetricsV1({ definitions, metrics, state = {}, facts = [] }) {
  if (!Array.isArray(definitions)) {
    throw new ConfigDrivenEndgameAdjudicationError(
      "ENDGAME_DERIVED_DEFINITIONS_INVALID",
      "Derived metric definitions must be an array."
    );
  }
  const baseMetrics = normalizeFiniteRecord(metrics, "metrics");
  const normalizedState = normalizeStateRecord(state);
  const normalizedFacts = normalizeRuleFacts(facts);
  const definitionById = new Map();
  for (const [index, definition] of definitions.entries()) {
    if (!isRecord(definition) || Object.keys(definition).sort(compareText).join("|") !== "derivedMetricId|expression") {
      throw new ConfigDrivenEndgameAdjudicationError(
        "ENDGAME_DERIVED_DEFINITION_SHAPE_INVALID",
        "Each derived metric definition must contain only derivedMetricId and expression.",
        { index }
      );
    }
    assertStableId(definition.derivedMetricId, `definitions[${index}].derivedMetricId`);
    if (definitionById.has(definition.derivedMetricId) || Object.hasOwn(baseMetrics, definition.derivedMetricId)) {
      throw new ConfigDrivenEndgameAdjudicationError(
        "ENDGAME_DERIVED_ID_DUPLICATE",
        "Derived metric ids must be unique and must not replace base metrics.",
        { derivedMetricId: definition.derivedMetricId }
      );
    }
    definitionById.set(definition.derivedMetricId, definition.expression);
  }

  const order = topologicalDerivedMetricOrder(definitionById, new Set(Object.keys(baseMetrics)));
  const resolvedMetrics = { ...baseMetrics };
  const derivedMetrics = {};
  for (const derivedMetricId of order) {
    const expression = definitionById.get(derivedMetricId);
    let value;
    try {
      value = evaluateNumericExpression(expression, {
        metrics: resolvedMetrics,
        state: normalizedState,
        facts: normalizedFacts,
        axisOutcomes: {}
      });
    } catch (error) {
      throw new ConfigDrivenEndgameAdjudicationError(
        "ENDGAME_DERIVED_EVALUATION_FAILED",
        "Derived metric evaluation failed closed.",
        { derivedMetricId, cause: errorMessage(error) }
      );
    }
    assertFiniteNumber(value, `derivedMetrics.${derivedMetricId}`);
    resolvedMetrics[derivedMetricId] = value;
    derivedMetrics[derivedMetricId] = value;
  }
  return deepFreeze({
    allMetrics: sortRecord(resolvedMetrics),
    derivedMetrics: sortRecord(derivedMetrics),
    evaluationOrder: Object.freeze([...order])
  });
}

export function evaluateEndgameCandidateV1({
  runPackageBinding,
  sourceRevision,
  metrics,
  state,
  facts = []
}) {
  const snapshot = resolveFrozenEndgamePackageForRunV1(runPackageBinding);
  assertSourceRevision(sourceRevision);
  const packageDocument = snapshot.packageDocument;
  const finalMetrics = normalizePackageMetrics(packageDocument.metrics, metrics);
  const normalizedState = normalizePackageState(packageDocument.stateVariables, state);
  const normalizedFacts = normalizeRuleFacts(facts);
  const derived = evaluateDerivedEndgameMetricsV1({
    definitions: packageDocument.derivedMetrics,
    metrics: finalMetrics,
    state: normalizedState,
    facts: normalizedFacts
  });
  const evaluationContext = {
    metrics: derived.allMetrics,
    state: normalizedState,
    facts: normalizedFacts,
    axisOutcomes: {}
  };

  const completionSatisfied = evaluateBooleanFailClosed(
    packageDocument.completion.when,
    evaluationContext,
    "ENDGAME_COMPLETION_EVALUATION_FAILED"
  );
  const axisOrder = topologicalAxisOrder(packageDocument.outcomeAxes);
  const axisOutcomes = {};
  for (const axis of axisOrder) {
    axisOutcomes[axis.axisId] = resolveOutcomeForAxis(axis, {
      ...evaluationContext,
      axisOutcomes
    });
  }
  const combinationId = resolveCombinationId(packageDocument.combinationOverrides, {
    ...evaluationContext,
    axisOutcomes
  });
  const resolvedAxes = packageDocument.outcomeAxes
    .slice()
    .sort(compareAxisDefinitions)
    .map((axis) => deepFreeze({ axisId: axis.axisId, outcomeId: axisOutcomes[axis.axisId] }));

  return deepFreeze({
    schemaVersion: ENDGAME_CANDIDATE_PROJECTION_SCHEMA_VERSION,
    packageRef: structuredClone(runPackageBinding.packageRef),
    scope: packageDocument.scope,
    completionSatisfied,
    finalMetrics: sortRecord(finalMetrics),
    derivedMetrics: structuredClone(derived.derivedMetrics),
    resolvedAxes,
    combinationId,
    sourceRevision
  });
}

export function finalizeEndgameAdjudicationV3(input) {
  const candidate = evaluateEndgameCandidateV1(input);
  if (!candidate.completionSatisfied) {
    throw new ConfigDrivenEndgameAdjudicationError(
      "ENDGAME_COMPLETION_NOT_SATISFIED",
      "A final adjudication cannot be frozen before the configured completion rule is satisfied."
    );
  }
  const adjudication = JSON.parse(canonicalizeJcs({
    schemaVersion: ENDGAME_ADJUDICATION_SCHEMA_VERSION,
    packageRef: candidate.packageRef,
    scope: candidate.scope,
    finalMetrics: candidate.finalMetrics,
    resolvedAxes: candidate.resolvedAxes,
    combinationId: candidate.combinationId,
    sourceRevision: candidate.sourceRevision
  }));
  assertEndgameAdjudicationV3(input.runPackageBinding, adjudication);
  return deepFreeze(adjudication);
}

export function assertEndgameAdjudicationV3(runPackageBinding, adjudication) {
  const snapshot = resolveFrozenEndgamePackageForRunV1(runPackageBinding);
  assertExactObject(adjudication, ADJUDICATION_KEYS, "adjudication");
  if (adjudication.schemaVersion !== ENDGAME_ADJUDICATION_SCHEMA_VERSION) {
    throw new ConfigDrivenEndgameAdjudicationError(
      "ENDGAME_ADJUDICATION_VERSION_UNSUPPORTED",
      "Unknown adjudication version."
    );
  }
  assertExactObject(adjudication.packageRef, PACKAGE_REF_KEYS, "adjudication.packageRef");
  if (canonicalizeJcs(adjudication.packageRef) !== canonicalizeJcs(runPackageBinding.packageRef)) {
    throw new ConfigDrivenEndgameAdjudicationError(
      "ENDGAME_ADJUDICATION_PACKAGE_MISMATCH",
      "Adjudication packageRef does not match the frozen run package."
    );
  }
  if (adjudication.scope !== snapshot.packageDocument.scope) {
    throw new ConfigDrivenEndgameAdjudicationError(
      "ENDGAME_ADJUDICATION_SCOPE_MISMATCH",
      "Adjudication scope does not match the frozen package."
    );
  }
  normalizePackageMetrics(snapshot.packageDocument.metrics, adjudication.finalMetrics);
  assertSourceRevision(adjudication.sourceRevision);
  if (!Array.isArray(adjudication.resolvedAxes)) {
    throw new ConfigDrivenEndgameAdjudicationError(
      "ENDGAME_ADJUDICATION_AXES_INVALID",
      "resolvedAxes must be an array."
    );
  }
  const expectedAxes = snapshot.packageDocument.outcomeAxes.slice().sort(compareAxisDefinitions);
  if (adjudication.resolvedAxes.length !== expectedAxes.length) {
    throw new ConfigDrivenEndgameAdjudicationError(
      "ENDGAME_ADJUDICATION_AXES_INCOMPLETE",
      "resolvedAxes must contain every configured axis exactly once."
    );
  }
  for (const [index, resolved] of adjudication.resolvedAxes.entries()) {
    assertExactObject(resolved, RESOLVED_AXIS_KEYS, `adjudication.resolvedAxes[${index}]`);
    const expectedAxis = expectedAxes[index];
    if (resolved.axisId !== expectedAxis.axisId) {
      throw new ConfigDrivenEndgameAdjudicationError(
        "ENDGAME_ADJUDICATION_AXIS_ORDER_INVALID",
        "resolvedAxes must use the deterministic configured order."
      );
    }
    if (!expectedAxis.outcomes.some((outcome) => outcome.outcomeId === resolved.outcomeId)) {
      throw new ConfigDrivenEndgameAdjudicationError(
        "ENDGAME_ADJUDICATION_OUTCOME_UNKNOWN",
        "resolvedAxes contains an unknown outcome.",
        { axisId: resolved.axisId, outcomeId: resolved.outcomeId }
      );
    }
  }
  if (adjudication.combinationId !== null) {
    assertStableId(adjudication.combinationId, "adjudication.combinationId");
    if (!snapshot.packageDocument.combinationOverrides.some((item) => item.combinationId === adjudication.combinationId)) {
      throw new ConfigDrivenEndgameAdjudicationError(
        "ENDGAME_ADJUDICATION_COMBINATION_UNKNOWN",
        "combinationId is not defined by the frozen package."
      );
    }
  }
  canonicalizeJcs(adjudication);
  return adjudication;
}

export function canonicalizeEndgameAdjudicationV3(runPackageBinding, adjudication) {
  assertEndgameAdjudicationV3(runPackageBinding, adjudication);
  return canonicalizeJcs(adjudication);
}

export function computeEndgameAdjudicationHashV3(runPackageBinding, adjudication) {
  return createHash("sha256")
    .update(Buffer.from(canonicalizeEndgameAdjudicationV3(runPackageBinding, adjudication), "utf8"))
    .digest("hex");
}

function resolveOutcomeForAxis(axis, context) {
  const fallback = axis.outcomes.find((outcome) => outcome.fallback === true);
  if (!fallback) {
    throw new ConfigDrivenEndgameAdjudicationError(
      "ENDGAME_AXIS_FALLBACK_MISSING",
      "Every outcome axis requires one fallback.",
      { axisId: axis.axisId }
    );
  }
  const matches = axis.outcomes
    .filter((outcome) => outcome.fallback !== true)
    .filter((outcome) => evaluateBooleanFailClosed(
      outcome.when,
      context,
      "ENDGAME_OUTCOME_EVALUATION_FAILED",
      { axisId: axis.axisId, outcomeId: outcome.outcomeId }
    ))
    .sort((left, right) => right.priority - left.priority || compareText(left.outcomeId, right.outcomeId));
  return matches[0]?.outcomeId ?? fallback.outcomeId;
}

function resolveCombinationId(combinationOverrides, context) {
  const matches = combinationOverrides
    .filter((override) => evaluateBooleanFailClosed(
      override.when,
      context,
      "ENDGAME_COMBINATION_EVALUATION_FAILED",
      { combinationId: override.combinationId }
    ))
    .map((override) => override.combinationId)
    .sort(compareText);
  if (matches.length > 1) {
    throw new ConfigDrivenEndgameAdjudicationError(
      "ENDGAME_COMBINATION_AMBIGUOUS",
      "More than one combination override matched the same resolved axes.",
      { combinationIds: matches }
    );
  }
  return matches[0] ?? null;
}

function topologicalDerivedMetricOrder(definitionById, baseMetricIds) {
  const temporary = new Set();
  const permanent = new Set();
  const order = [];
  function visit(derivedMetricId, path) {
    if (permanent.has(derivedMetricId)) return;
    if (temporary.has(derivedMetricId)) {
      throw new ConfigDrivenEndgameAdjudicationError(
        "ENDGAME_DERIVED_CYCLE",
        "Derived metrics contain a dependency cycle.",
        { path: [...path, derivedMetricId] }
      );
    }
    temporary.add(derivedMetricId);
    const references = collectMetricReferences(definitionById.get(derivedMetricId));
    for (const reference of references) {
      if (baseMetricIds.has(reference)) continue;
      if (!definitionById.has(reference)) {
        throw new ConfigDrivenEndgameAdjudicationError(
          "ENDGAME_DERIVED_METRIC_UNKNOWN",
          "Derived metric expression references an unknown metric.",
          { derivedMetricId, metricId: reference }
        );
      }
      visit(reference, [...path, derivedMetricId]);
    }
    temporary.delete(derivedMetricId);
    permanent.add(derivedMetricId);
    order.push(derivedMetricId);
  }
  for (const derivedMetricId of [...definitionById.keys()].sort(compareText)) visit(derivedMetricId, []);
  return order;
}

function topologicalAxisOrder(axes) {
  const axisById = new Map(axes.map((axis) => [axis.axisId, axis]));
  const dependencies = new Map();
  for (const axis of axes) {
    const references = new Set();
    for (const outcome of axis.outcomes) collectAxisReferences(outcome.when, references);
    dependencies.set(axis.axisId, references);
  }
  const temporary = new Set();
  const permanent = new Set();
  const order = [];
  function visit(axisId, path) {
    if (permanent.has(axisId)) return;
    if (temporary.has(axisId)) {
      throw new ConfigDrivenEndgameAdjudicationError(
        "ENDGAME_AXIS_DEPENDENCY_CYCLE",
        "Outcome axes contain an axisOutcomeIs dependency cycle.",
        { path: [...path, axisId] }
      );
    }
    temporary.add(axisId);
    for (const dependency of [...(dependencies.get(axisId) ?? [])].sort(compareText)) {
      if (!axisById.has(dependency)) {
        throw new ConfigDrivenEndgameAdjudicationError(
          "ENDGAME_AXIS_DEPENDENCY_UNKNOWN",
          "Outcome axis references an unknown axis.",
          { axisId, dependency }
        );
      }
      visit(dependency, [...path, axisId]);
    }
    temporary.delete(axisId);
    permanent.add(axisId);
    order.push(axisById.get(axisId));
  }
  for (const axis of axes.slice().sort(compareAxisDefinitions)) visit(axis.axisId, []);
  return order;
}

function collectMetricReferences(expression, output = new Set()) {
  if (Array.isArray(expression)) {
    for (const child of expression) collectMetricReferences(child, output);
  } else if (isRecord(expression)) {
    if (typeof expression.metric === "string") output.add(expression.metric);
    for (const value of Object.values(expression)) collectMetricReferences(value, output);
  }
  return output;
}

function collectAxisReferences(expression, output = new Set()) {
  if (Array.isArray(expression)) {
    for (const child of expression) collectAxisReferences(child, output);
  } else if (isRecord(expression)) {
    if (Array.isArray(expression.axisOutcomeIs) && typeof expression.axisOutcomeIs[0] === "string") {
      output.add(expression.axisOutcomeIs[0]);
    }
    for (const value of Object.values(expression)) collectAxisReferences(value, output);
  }
  return output;
}

function evaluateBooleanFailClosed(expression, context, code, details = {}) {
  try {
    return evaluateBooleanExpression(expression, context);
  } catch (error) {
    throw new ConfigDrivenEndgameAdjudicationError(code, "Rule expression evaluation failed closed.", {
      ...details,
      cause: errorMessage(error)
    });
  }
}

function normalizePackageMetrics(definitions, value) {
  const metrics = normalizeFiniteRecord(value, "metrics");
  const expectedIds = definitions.map((definition) => definition.metricId).sort(compareText);
  const actualIds = Object.keys(metrics).sort(compareText);
  if (canonicalizeJcs(expectedIds) !== canonicalizeJcs(actualIds)) {
    throw new ConfigDrivenEndgameAdjudicationError(
      "ENDGAME_METRIC_SET_MISMATCH",
      "Final metrics must exactly match the frozen package metric ids.",
      { expectedIds, actualIds }
    );
  }
  for (const definition of definitions) {
    const metricValue = metrics[definition.metricId];
    if (metricValue < definition.min || metricValue > definition.max) {
      throw new ConfigDrivenEndgameAdjudicationError(
        "ENDGAME_METRIC_RANGE_INVALID",
        "Final metric is outside the configured range.",
        { metricId: definition.metricId, value: metricValue }
      );
    }
  }
  return sortRecord(metrics);
}

function normalizePackageState(definitions, value) {
  const state = normalizeStateRecord(value);
  const expectedIds = definitions.map((definition) => definition.stateId).sort(compareText);
  const actualIds = Object.keys(state).sort(compareText);
  if (canonicalizeJcs(expectedIds) !== canonicalizeJcs(actualIds)) {
    throw new ConfigDrivenEndgameAdjudicationError(
      "ENDGAME_STATE_SET_MISMATCH",
      "State must exactly match the frozen package state variable ids.",
      { expectedIds, actualIds }
    );
  }
  for (const definition of definitions) {
    const stateValue = state[definition.stateId];
    if (definition.type === "NUMBER") assertFiniteNumber(stateValue, `state.${definition.stateId}`);
    else if (definition.type === "STRING" && typeof stateValue !== "string") {
      throw new ConfigDrivenEndgameAdjudicationError("ENDGAME_STATE_TYPE_INVALID", "State value must be a string.", {
        stateId: definition.stateId
      });
    } else if (definition.type === "BOOLEAN" && typeof stateValue !== "boolean") {
      throw new ConfigDrivenEndgameAdjudicationError("ENDGAME_STATE_TYPE_INVALID", "State value must be a boolean.", {
        stateId: definition.stateId
      });
    }
  }
  return sortRecord(state);
}

function normalizeFiniteRecord(value, label) {
  if (!isRecord(value)) {
    throw new ConfigDrivenEndgameAdjudicationError("ENDGAME_FINITE_RECORD_REQUIRED", `${label} must be an object.`);
  }
  const normalized = {};
  for (const [key, item] of Object.entries(value)) {
    assertStableId(key, `${label} key`);
    assertFiniteNumber(item, `${label}.${key}`);
    normalized[key] = Object.is(item, -0) ? 0 : item;
  }
  return sortRecord(normalized);
}

function normalizeStateRecord(value) {
  if (!isRecord(value)) {
    throw new ConfigDrivenEndgameAdjudicationError("ENDGAME_STATE_RECORD_REQUIRED", "state must be an object.");
  }
  const normalized = {};
  for (const [key, item] of Object.entries(value)) {
    assertStableId(key, "state key");
    if (!(typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item)))) {
      throw new ConfigDrivenEndgameAdjudicationError(
        "ENDGAME_STATE_VALUE_INVALID",
        "State values must be finite numbers, strings, or booleans.",
        { stateId: key }
      );
    }
    normalized[key] = Object.is(item, -0) ? 0 : item;
  }
  return sortRecord(normalized);
}

function normalizeRuleFacts(value) {
  if (!Array.isArray(value)) {
    throw new ConfigDrivenEndgameAdjudicationError("ENDGAME_RULE_FACTS_INVALID", "facts must be an array.");
  }
  try {
    const canonical = canonicalizeJcs(value);
    return deepFreeze(JSON.parse(canonical));
  } catch (error) {
    throw new ConfigDrivenEndgameAdjudicationError(
      "ENDGAME_RULE_FACTS_NOT_JSON",
      "facts must be deterministic JSON values.",
      { cause: errorMessage(error) }
    );
  }
}


function assertExactObject(value, allowedKeys, label) {
  if (!isRecord(value)) {
    throw new ConfigDrivenEndgameAdjudicationError("ENDGAME_CLOSED_OBJECT_REQUIRED", `${label} must be an object.`);
  }
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  const missing = allowedKeys.filter((key) => !(key in value));
  if (unknown.length > 0 || missing.length > 0) {
    throw new ConfigDrivenEndgameAdjudicationError(
      "ENDGAME_CLOSED_OBJECT_VIOLATION",
      `${label} has unknown or missing fields.`,
      { unknown, missing }
    );
  }
}

function assertStableId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value) || FORBIDDEN_RECORD_KEYS.has(value)) {
    throw new ConfigDrivenEndgameAdjudicationError("ENDGAME_ID_INVALID", `${label} must be a stable identifier.`);
  }
}

function assertFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ConfigDrivenEndgameAdjudicationError("ENDGAME_NON_FINITE", `${label} must be finite.`);
  }
}

function assertSourceRevision(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new ConfigDrivenEndgameAdjudicationError(
      "ENDGAME_SOURCE_REVISION_INVALID",
      "sourceRevision must be a non-negative integer."
    );
  }
}

function compareAxisDefinitions(left, right) {
  return left.order - right.order || compareText(left.axisId, right.axisId);
}

function sortRecord(record) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => compareText(left, right)));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
