import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertEndgameAdjudicationV3,
  canonicalizeEndgameAdjudicationV3,
  computeEndgameAdjudicationHashV3,
  evaluateDerivedEndgameMetricsV1,
  evaluateEndgameCandidateV1,
  finalizeEndgameAdjudicationV3
} from "../src/endgame/config-driven-endgame-adjudicator-v1.mjs";
import {
  freezeEndgamePackageForRunV1,
  loadEndgamePackageV1
} from "../src/endgame/endgame-package-loader-v1.mjs";

const ROOT = new URL("../../..", import.meta.url);
const paths = {
  neutral: "packages/templates/config/endgame/fixtures/neutral-synthetic.endgame.fixture.json",
  sangtian: "packages/templates/config/endgame/examples/sangtian.endgame.example.json",
  caesar: "packages/templates/config/endgame/examples/caesar.endgame.example.json",
  source: "packages/shared/src/endgame/config-driven-endgame-adjudicator-v1.mjs"
};
const neutral = readJson(paths.neutral);
const sangtian = readJson(paths.sangtian);
const caesar = readJson(paths.caesar);

function readJson(path) {
  return JSON.parse(readFileSync(new URL(path, ROOT), "utf8"));
}

function clone(value) {
  return structuredClone(value);
}

function bindingFor(packageDocument = neutral, runId = `run-${packageDocument.worldId}`) {
  const loaded = loadEndgamePackageV1(packageDocument, { sourceId: runId });
  return freezeEndgamePackageForRunV1({ runId, packageSnapshot: loaded.snapshot });
}

function initialMetrics(packageDocument) {
  return Object.fromEntries(packageDocument.metrics.map((metric) => [metric.metricId, metric.initialValue]));
}

function completeState(packageDocument, turnNumber) {
  return Object.fromEntries(packageDocument.stateVariables.map((state) => {
    if (state.stateId === "turnNumber") return [state.stateId, turnNumber];
    if (state.stateId === "partCompletionStatus") return [state.stateId, "HANDOFF_READY"];
    if (state.type === "BOOLEAN") return [state.stateId, false];
    if (state.type === "NUMBER") return [state.stateId, 0];
    return [state.stateId, ""];
  }));
}

function inputFor(packageDocument, {
  runId = `run-${packageDocument.worldId}`,
  metrics = initialMetrics(packageDocument),
  state = completeState(packageDocument, 999),
  facts = [],
  sourceRevision = 1
} = {}) {
  return {
    runPackageBinding: bindingFor(packageDocument, runId),
    sourceRevision,
    metrics,
    state,
    facts
  };
}

function axisMap(result) {
  return Object.fromEntries(result.resolvedAxes.map((axis) => [axis.axisId, axis.outcomeId]));
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error?.code, code, error?.stack ?? String(error));
    return true;
  });
}

test("S3 neutral candidate projects configured axes before completion", () => {
  const input = inputFor(neutral, { state: completeState(neutral, 5) });
  const candidate = evaluateEndgameCandidateV1(input);
  assert.equal(candidate.completionSatisfied, false);
  assert.deepEqual(axisMap(candidate), { protagonist_fate: "prepared", world_outcome: "stable" });
  assert.equal(candidate.schemaVersion, "endgame_candidate_projection_v1");
});

test("S3 final freeze rejects completion=false", () => {
  const input = inputFor(neutral, { state: completeState(neutral, 5) });
  expectCode(() => finalizeEndgameAdjudicationV3(input), "ENDGAME_COMPLETION_NOT_SATISFIED");
});

test("S3 neutral package produces deterministic multi-axis final result", () => {
  const input = inputFor(neutral, { state: completeState(neutral, 6) });
  const result = finalizeEndgameAdjudicationV3(input);
  assert.equal(result.schemaVersion, "endgame_adjudication_v3");
  assert.deepEqual(axisMap(result), { protagonist_fate: "prepared", world_outcome: "stable" });
  assert.equal(result.combinationId, null);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.finalMetrics), true);
});

test("S3 same frozen input is byte-stable across 100 evaluations", () => {
  const input = inputFor(neutral, { state: completeState(neutral, 6) });
  const first = finalizeEndgameAdjudicationV3(input);
  const canonical = canonicalizeEndgameAdjudicationV3(input.runPackageBinding, first);
  const hash = computeEndgameAdjudicationHashV3(input.runPackageBinding, first);
  for (let index = 0; index < 100; index += 1) {
    const next = finalizeEndgameAdjudicationV3(input);
    assert.equal(canonicalizeEndgameAdjudicationV3(input.runPackageBinding, next), canonical);
    assert.equal(computeEndgameAdjudicationHashV3(input.runPackageBinding, next), hash);
  }
});

test("S3 Sangtian package resolves its configured axes and combination", () => {
  const metrics = initialMetrics(sangtian);
  metrics.reform_progress = 80;
  metrics.imperial_trust = 70;
  const result = finalizeEndgameAdjudicationV3(inputFor(sangtian, {
    runId: "run-config-one",
    metrics,
    state: completeState(sangtian, 20)
  }));
  assert.deepEqual(axisMap(result), { protagonist_fate: "trusted", world_outcome: "reform_formed" });
  assert.equal(result.combinationId, "formed_and_trusted");
});

test("S3 Caesar package resolves its configured multi-axis outcome", () => {
  const metrics = initialMetrics(caesar);
  metrics.republic_stability = 65;
  metrics.senate_support = 70;
  const result = finalizeEndgameAdjudicationV3(inputFor(caesar, {
    runId: "run-config-two",
    metrics,
    state: completeState(caesar, 12)
  }));
  assert.deepEqual(axisMap(result), { protagonist_fate: "trusted", world_outcome: "republic_preserved" });
});

test("S3 evaluates every configured numeric DSL form in derived metrics", () => {
  const fact = {
    sourceType: "PLAYER_ACTION",
    category: "ACHIEVEMENT",
    status: "OCCURRED",
    polarity: "POSITIVE",
    visibility: "PLAYER",
    tags: ["strategy:people_first"],
    magnitude: 1
  };
  const candidate = evaluateEndgameCandidateV1(inputFor(sangtian, {
    runId: "run-derived-probes",
    state: completeState(sangtian, 20),
    facts: [fact]
  }));
  assert.deepEqual(candidate.derivedMetrics, {
    bounded_probe: 0,
    difference_probe: 41,
    division_probe: 4,
    fact_probe: 1,
    livelihood: 41.5,
    lower_probe: 42,
    product_probe: 6,
    sum_probe: 45,
    tag_probe: 1,
    upper_probe: 43
  });
});

test("S3 topologically evaluates derived metric dependencies", () => {
  const result = evaluateDerivedEndgameMetricsV1({
    metrics: { base: 10 },
    definitions: [
      { derivedMetricId: "second", expression: { multiply: [{ metric: "first" }, { constant: 2 }] } },
      { derivedMetricId: "first", expression: { add: [{ metric: "base" }, { constant: 5 }] } }
    ]
  });
  assert.deepEqual(result.evaluationOrder, ["first", "second"]);
  assert.deepEqual(result.derivedMetrics, { first: 15, second: 30 });
});

test("S3 derived metric cycles fail closed", () => {
  expectCode(() => evaluateDerivedEndgameMetricsV1({
    metrics: { base: 1 },
    definitions: [
      { derivedMetricId: "first", expression: { add: [{ metric: "second" }, { constant: 1 }] } },
      { derivedMetricId: "second", expression: { add: [{ metric: "first" }, { constant: 1 }] } }
    ]
  }), "ENDGAME_DERIVED_CYCLE");
});

test("S3 unknown derived metric references fail closed", () => {
  expectCode(() => evaluateDerivedEndgameMetricsV1({
    metrics: { base: 1 },
    definitions: [
      { derivedMetricId: "first", expression: { add: [{ metric: "missing" }, { constant: 1 }] } }
    ]
  }), "ENDGAME_DERIVED_METRIC_UNKNOWN");
});

test("S3 non-finite derived evaluation fails closed", () => {
  expectCode(() => evaluateDerivedEndgameMetricsV1({
    metrics: { base: 1 },
    definitions: [
      { derivedMetricId: "broken", expression: { divide: [{ metric: "base" }, { constant: 0 }] } }
    ]
  }), "ENDGAME_DERIVED_EVALUATION_FAILED");
});

test("S3 outcome priority selects the highest matching rule", () => {
  const packageDocument = clone(neutral);
  const axis = packageDocument.outcomeAxes.find((item) => item.axisId === "world_outcome");
  const high = clone(axis.outcomes[0]);
  high.outcomeId = "high_priority";
  high.title = "high_priority";
  high.summary = "high_priority";
  high.priority = 200;
  axis.outcomes.unshift(high);
  const result = finalizeEndgameAdjudicationV3(inputFor(packageDocument, {
    runId: "run-priority",
    state: completeState(packageDocument, 6)
  }));
  assert.equal(axisMap(result).world_outcome, "high_priority");
});

test("S3 equal priority ties are resolved by stable outcomeId order", () => {
  const packageDocument = clone(neutral);
  const axis = packageDocument.outcomeAxes.find((item) => item.axisId === "world_outcome");
  const tie = clone(axis.outcomes[0]);
  tie.outcomeId = "alpha";
  tie.title = "alpha";
  tie.summary = "alpha";
  axis.outcomes.unshift(tie);
  const result = finalizeEndgameAdjudicationV3(inputFor(packageDocument, {
    runId: "run-priority-tie",
    state: completeState(packageDocument, 6)
  }));
  assert.equal(axisMap(result).world_outcome, "alpha");
});

test("S3 falls back when no conditional outcome matches", () => {
  const metrics = initialMetrics(neutral);
  metrics.cohesion = 1;
  metrics.reserve = 1;
  const result = finalizeEndgameAdjudicationV3(inputFor(neutral, {
    runId: "run-fallback",
    metrics,
    state: completeState(neutral, 6)
  }));
  assert.deepEqual(axisMap(result), { protagonist_fate: "fallback", world_outcome: "fallback" });
});

test("S3 axisOutcomeIs dependencies are evaluated topologically", () => {
  const packageDocument = clone(neutral);
  const world = packageDocument.outcomeAxes.find((axis) => axis.axisId === "world_outcome");
  world.outcomes[0].when = { axisOutcomeIs: ["protagonist_fate", "prepared"] };
  world.order = 0;
  const result = finalizeEndgameAdjudicationV3(inputFor(packageDocument, {
    runId: "run-axis-dependency",
    state: completeState(packageDocument, 6)
  }));
  assert.equal(axisMap(result).world_outcome, "stable");
});

test("S3 cyclic axis dependencies fail closed", () => {
  const packageDocument = clone(neutral);
  const world = packageDocument.outcomeAxes.find((axis) => axis.axisId === "world_outcome");
  const fate = packageDocument.outcomeAxes.find((axis) => axis.axisId === "protagonist_fate");
  world.outcomes[0].when = { axisOutcomeIs: ["protagonist_fate", "prepared"] };
  fate.outcomes[0].when = { axisOutcomeIs: ["world_outcome", "stable"] };
  const input = inputFor(packageDocument, {
    runId: "run-axis-cycle",
    state: completeState(packageDocument, 6)
  });
  expectCode(() => evaluateEndgameCandidateV1(input), "ENDGAME_AXIS_DEPENDENCY_CYCLE");
});

test("S3 multiple matching combination overrides fail closed", () => {
  const packageDocument = clone(sangtian);
  const duplicate = clone(packageDocument.combinationOverrides[0]);
  duplicate.combinationId = "also_formed_and_trusted";
  packageDocument.combinationOverrides.push(duplicate);
  const metrics = initialMetrics(packageDocument);
  metrics.reform_progress = 80;
  metrics.imperial_trust = 70;
  const input = inputFor(packageDocument, {
    runId: "run-combination-ambiguous",
    metrics,
    state: completeState(packageDocument, 20)
  });
  expectCode(() => evaluateEndgameCandidateV1(input), "ENDGAME_COMBINATION_AMBIGUOUS");
});

test("S3 state variables are a closed package-defined record", () => {
  const state = { ...completeState(neutral, 6), unexpected: true };
  expectCode(() => evaluateEndgameCandidateV1(inputFor(neutral, {
    runId: "run-state-extra",
    state
  })), "ENDGAME_STATE_SET_MISMATCH");
});

test("S3 missing state variables fail closed", () => {
  const state = completeState(neutral, 6);
  delete state.emergency;
  expectCode(() => evaluateEndgameCandidateV1(inputFor(neutral, {
    runId: "run-state-missing",
    state
  })), "ENDGAME_STATE_SET_MISMATCH");
});

test("S3 state types are enforced from configuration", () => {
  const state = completeState(neutral, 6);
  state.emergency = "false";
  expectCode(() => evaluateEndgameCandidateV1(inputFor(neutral, {
    runId: "run-state-type",
    state
  })), "ENDGAME_STATE_TYPE_INVALID");
});

test("S3 final metrics are a closed package-defined record", () => {
  const metrics = { ...initialMetrics(neutral), unexpected: 1 };
  expectCode(() => evaluateEndgameCandidateV1(inputFor(neutral, {
    runId: "run-metric-extra",
    metrics
  })), "ENDGAME_METRIC_SET_MISMATCH");
});

test("S3 non-finite final metrics fail closed", () => {
  const metrics = initialMetrics(neutral);
  metrics.signal = Number.NaN;
  expectCode(() => evaluateEndgameCandidateV1(inputFor(neutral, {
    runId: "run-metric-nan",
    metrics
  })), "ENDGAME_NON_FINITE");
});

test("S3 out-of-range final metrics fail closed", () => {
  const metrics = initialMetrics(neutral);
  metrics.signal = 1000;
  expectCode(() => evaluateEndgameCandidateV1(inputFor(neutral, {
    runId: "run-metric-range",
    metrics
  })), "ENDGAME_METRIC_RANGE_INVALID");
});

test("S3 sourceRevision must be a non-negative integer", () => {
  expectCode(() => evaluateEndgameCandidateV1(inputFor(neutral, {
    runId: "run-revision-invalid",
    sourceRevision: -1
  })), "ENDGAME_SOURCE_REVISION_INVALID");
});

test("S3 formal adjudication validator rejects unknown outcomes", () => {
  const input = inputFor(neutral, { runId: "run-tampered-outcome", state: completeState(neutral, 6) });
  const result = clone(finalizeEndgameAdjudicationV3(input));
  result.resolvedAxes[0].outcomeId = "not_configured";
  expectCode(() => assertEndgameAdjudicationV3(input.runPackageBinding, result), "ENDGAME_ADJUDICATION_OUTCOME_UNKNOWN");
});

test("S3 formal adjudication validator rejects a different frozen package", () => {
  const input = inputFor(neutral, { runId: "run-package-match", state: completeState(neutral, 6) });
  const result = finalizeEndgameAdjudicationV3(input);
  const otherBinding = bindingFor(caesar, "run-other-package");
  expectCode(() => assertEndgameAdjudicationV3(otherBinding, result), "ENDGAME_ADJUDICATION_PACKAGE_MISMATCH");
});

test("S3 insertion order does not change adjudication bytes", () => {
  const metrics = initialMetrics(neutral);
  const reversedMetrics = Object.fromEntries(Object.entries(metrics).reverse());
  const firstInput = inputFor(neutral, { runId: "run-order-one", metrics, state: completeState(neutral, 6) });
  const secondInput = {
    ...firstInput,
    metrics: reversedMetrics
  };
  const first = finalizeEndgameAdjudicationV3(firstInput);
  const second = finalizeEndgameAdjudicationV3(secondInput);
  assert.equal(
    canonicalizeEndgameAdjudicationV3(firstInput.runPackageBinding, first),
    canonicalizeEndgameAdjudicationV3(firstInput.runPackageBinding, second)
  );
});

test("S3 generic adjudicator has no I/O, time, randomness, eval, or world-specific branches", () => {
  const source = readFileSync(new URL(paths.source, ROOT), "utf8");
  for (const pattern of [
    /node:fs/u,
    /node:net/u,
    /node:http/u,
    /node:https/u,
    /Math\.random/u,
    /\bDate\b/u,
    /process\.env/u,
    /\beval\s*\(/u,
    /\bFunction\s*\(/u,
    /\bfetch\s*\(/u
  ]) assert.doesNotMatch(source, pattern);
  for (const token of [
    "sangtian",
    "zhejiang",
    "governor",
    "imperialTrust",
    "reformProgress",
    "grainPrice",
    "caesar",
    "senate"
  ]) assert.equal(source.includes(token), false, token);
});
