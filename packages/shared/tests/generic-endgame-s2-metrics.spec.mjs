import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EndgamePackageRegistryV1,
  freezeEndgamePackageForRunV1,
  loadEndgamePackageV1
} from "../src/endgame/endgame-package-loader-v1.mjs";
import {
  ENDGAME_METRIC_LEDGER_SCHEMA_VERSION,
  EndgameMetricLedgerError,
  applyEndgameMetricChangesV1,
  assertEndgameMetricLedgerV1,
  createEndgameMetricLedgerV1,
  formatMetricValueV1,
  projectEndgameMetricsForPlayerV1,
  projectEndgameTrajectoryForPlayerV1,
  replayEndgameMetricLedgerV1
} from "../src/endgame/endgame-metric-ledger-v1.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const neutral = JSON.parse(await readFile(resolve(root, "packages/templates/config/endgame/fixtures/neutral-synthetic.endgame.fixture.json"), "utf8"));
const clone = (value) => structuredClone(value);

function bindingFor(packageDocument = neutral, runId = "run-metrics") {
  const snapshot = loadEndgamePackageV1(packageDocument).snapshot;
  return freezeEndgamePackageForRunV1({ runId, packageSnapshot: snapshot });
}

function change(overrides = {}) {
  return {
    changeId: "change-signal-1",
    metricId: "signal",
    delta: 8,
    reasonCode: "settlement.signal",
    reasonText: "Committed internal reason; player projection must not expose it.",
    sourceFactIds: ["fact-signal-1"],
    ...overrides
  };
}

function apply(binding, ledger, overrides = {}) {
  return applyEndgameMetricChangesV1({
    runPackageBinding: binding,
    ledger,
    submissionId: "submission-1",
    expectedRevision: ledger.revision,
    stageIndex: 1,
    sourceActionId: "action-1",
    changes: [change()],
    ...overrides
  });
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof EndgameMetricLedgerError && error.code === code);
}

test("S2 creates Record<string, number> from package metrics", () => {
  const binding = bindingFor();
  const ledger = createEndgameMetricLedgerV1(binding);
  assert.equal(ledger.schemaVersion, ENDGAME_METRIC_LEDGER_SCHEMA_VERSION);
  assert.deepEqual(ledger.metrics, { cohesion: 60, exposure: 30, reserve: 50, signal: 40 });
  assert.equal(ledger.revision, 0);
  assert.deepEqual(ledger.trajectory, []);
  assert.equal(Object.isFrozen(ledger.metrics), true);
});

test("S2 applies a validated metric change and persists trajectory", () => {
  const binding = bindingFor();
  const initial = createEndgameMetricLedgerV1(binding);
  const result = apply(binding, initial);
  assert.equal(result.applied, true);
  assert.equal(result.idempotent, false);
  assert.equal(result.ledger.metrics.signal, 48);
  assert.equal(result.ledger.revision, 1);
  assert.equal(result.ledger.trajectory.length, 1);
  assert.deepEqual(result.records[0], result.ledger.trajectory[0]);
  assert.equal(result.records[0].before, 40);
  assert.equal(result.records[0].delta, 8);
  assert.equal(result.records[0].after, 48);
});

test("S2 retry with the same submission is idempotent", () => {
  const binding = bindingFor();
  const first = apply(binding, createEndgameMetricLedgerV1(binding));
  const retry = applyEndgameMetricChangesV1({
    runPackageBinding: binding,
    ledger: first.ledger,
    submissionId: "submission-1",
    expectedRevision: 0,
    stageIndex: 1,
    sourceActionId: "action-1",
    changes: [change()]
  });
  assert.equal(retry.applied, false);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.ledger, first.ledger);
  assert.equal(retry.ledger.trajectory.length, 1);
});

test("S2 idempotency key reuse with different payload fails closed", () => {
  const binding = bindingFor();
  const first = apply(binding, createEndgameMetricLedgerV1(binding));
  expectCode(() => applyEndgameMetricChangesV1({
    runPackageBinding: binding,
    ledger: first.ledger,
    submissionId: "submission-1",
    expectedRevision: 1,
    stageIndex: 1,
    sourceActionId: "action-1",
    changes: [change({ delta: 9 })]
  }), "ENDGAME_METRIC_IDEMPOTENCY_CONFLICT");
});

test("S2 stale revision fails closed", () => {
  const binding = bindingFor();
  const ledger = createEndgameMetricLedgerV1(binding);
  expectCode(() => apply(binding, ledger, { expectedRevision: 4 }), "ENDGAME_METRIC_REVISION_CONFLICT");
});

test("S2 rejects unknown metric ids", () => {
  const binding = bindingFor();
  const ledger = createEndgameMetricLedgerV1(binding);
  expectCode(() => apply(binding, ledger, { changes: [change({ metricId: "unknown" })] }), "ENDGAME_METRIC_UNKNOWN");
});

test("S2 rejects non-finite deltas", () => {
  const binding = bindingFor();
  const ledger = createEndgameMetricLedgerV1(binding);
  expectCode(() => apply(binding, ledger, { changes: [change({ delta: Number.NaN })] }), "ENDGAME_METRIC_NON_FINITE");
});

test("S2 enforces maxAbsoluteDeltaPerSettlement", () => {
  const binding = bindingFor();
  const ledger = createEndgameMetricLedgerV1(binding);
  expectCode(() => apply(binding, ledger, { changes: [change({ delta: 16 })] }), "ENDGAME_METRIC_DELTA_LIMIT");
});

test("S2 clamps to package range only when configured", () => {
  const binding = bindingFor();
  let ledger = createEndgameMetricLedgerV1(binding);
  ledger = apply(binding, ledger, { changes: [change({ delta: 15 })] }).ledger;
  ledger = applyEndgameMetricChangesV1({
    runPackageBinding: binding,
    ledger,
    submissionId: "submission-2",
    expectedRevision: 1,
    stageIndex: 2,
    sourceActionId: "action-2",
    changes: [change({ changeId: "change-signal-2", delta: 15, sourceFactIds: ["fact-signal-2"] })]
  }).ledger;
  ledger = applyEndgameMetricChangesV1({
    runPackageBinding: binding,
    ledger,
    submissionId: "submission-3",
    expectedRevision: 2,
    stageIndex: 3,
    sourceActionId: "action-3",
    changes: [change({ changeId: "change-signal-3", delta: 15, sourceFactIds: ["fact-signal-3"] })]
  }).ledger;
  ledger = applyEndgameMetricChangesV1({
    runPackageBinding: binding,
    ledger,
    submissionId: "submission-4",
    expectedRevision: 3,
    stageIndex: 4,
    sourceActionId: "action-4",
    changes: [change({ changeId: "change-signal-4", delta: 15, sourceFactIds: ["fact-signal-4"] })]
  }).ledger;
  const final = applyEndgameMetricChangesV1({
    runPackageBinding: binding,
    ledger,
    submissionId: "submission-5",
    expectedRevision: 4,
    stageIndex: 5,
    sourceActionId: "action-5",
    changes: [change({ changeId: "change-signal-5", delta: 15, sourceFactIds: ["fact-signal-5"] })]
  });
  assert.equal(final.ledger.metrics.signal, 100);
  assert.equal(final.records[0].requestedDelta, 15);
  assert.equal(final.records[0].delta, 0);
  assert.equal(final.records[0].clamped, true);
});

test("S2 out-of-range change fails when clamp is disabled", () => {
  const packageDocument = clone(neutral);
  packageDocument.metrics.find((metric) => metric.metricId === "signal").initialValue = 95;
  packageDocument.metrics.find((metric) => metric.metricId === "signal").changePolicy.clamp = false;
  const binding = bindingFor(packageDocument, "run-no-clamp");
  const ledger = createEndgameMetricLedgerV1(binding);
  expectCode(() => apply(binding, ledger, { changes: [change({ delta: 10 })] }), "ENDGAME_METRIC_RANGE_VIOLATION");
});

test("S2 rejects duplicate metrics in one submission", () => {
  const binding = bindingFor();
  const ledger = createEndgameMetricLedgerV1(binding);
  expectCode(() => apply(binding, ledger, {
    changes: [change(), change({ changeId: "change-signal-2", delta: 2 })]
  }), "ENDGAME_METRIC_DUPLICATE_IN_SUBMISSION");
});

test("S2 rejects reusing a changeId across submissions", () => {
  const binding = bindingFor();
  const first = apply(binding, createEndgameMetricLedgerV1(binding));
  expectCode(() => applyEndgameMetricChangesV1({
    runPackageBinding: binding,
    ledger: first.ledger,
    submissionId: "submission-2",
    expectedRevision: 1,
    stageIndex: 2,
    sourceActionId: "action-2",
    changes: [change({ metricId: "reserve", delta: 1 })]
  }), "ENDGAME_METRIC_CHANGE_ID_REUSED");
});

test("S2 replay returns the exact durable metric snapshot", () => {
  const binding = bindingFor();
  const first = apply(binding, createEndgameMetricLedgerV1(binding));
  const second = applyEndgameMetricChangesV1({
    runPackageBinding: binding,
    ledger: first.ledger,
    submissionId: "submission-2",
    expectedRevision: 1,
    stageIndex: 2,
    sourceActionId: "action-2",
    changes: [change({ changeId: "change-reserve-1", metricId: "reserve", delta: -5, sourceFactIds: ["fact-reserve-1"] })]
  });
  const replayed = replayEndgameMetricLedgerV1(binding, second.ledger);
  assert.deepEqual(replayed.metrics, second.ledger.metrics);
  assert.equal(replayed.revision, 2);
});

test("S2 tampered trajectory before value fails replay", () => {
  const binding = bindingFor();
  const applied = apply(binding, createEndgameMetricLedgerV1(binding));
  const tampered = structuredClone(applied.ledger);
  tampered.trajectory[0].before = 999;
  expectCode(() => assertEndgameMetricLedgerV1(binding, tampered), "ENDGAME_METRIC_TRAJECTORY_BEFORE_MISMATCH");
});

test("S2 stored metric snapshot cannot diverge from trajectory", () => {
  const binding = bindingFor();
  const applied = apply(binding, createEndgameMetricLedgerV1(binding));
  const tampered = structuredClone(applied.ledger);
  tampered.metrics.signal = 49;
  expectCode(() => assertEndgameMetricLedgerV1(binding, tampered), "ENDGAME_METRIC_REPLAY_MISMATCH");
});

test("S2 player metric projection hides internal reasons and fact ids", () => {
  const binding = bindingFor();
  const applied = apply(binding, createEndgameMetricLedgerV1(binding));
  const projection = projectEndgameMetricsForPlayerV1({ runPackageBinding: binding, ledger: applied.ledger });
  const serialized = JSON.stringify(projection);
  assert.doesNotMatch(serialized, /reasonCode|reasonText|sourceFactIds|sourceActionId|fact-signal-1/u);
  assert.equal(projection.find((metric) => metric.metricId === "signal").trend.delta, 8);
});

test("S2 player trajectory projection exposes no internal state paths or secrets", () => {
  const binding = bindingFor();
  const applied = apply(binding, createEndgameMetricLedgerV1(binding));
  const projection = projectEndgameTrajectoryForPlayerV1({ runPackageBinding: binding, ledger: applied.ledger });
  assert.deepEqual(Object.keys(projection[0]), ["metricId", "label", "before", "delta", "after", "stageIndex", "committedRevision"]);
  assert.doesNotMatch(JSON.stringify(projection), /reason|source|action|fact/u);
});

test("S2 visibility is controlled by package display configuration", () => {
  const packageDocument = clone(neutral);
  packageDocument.metrics.find((metric) => metric.metricId === "reserve").display.visibleDuringRun = false;
  const binding = bindingFor(packageDocument, "run-hidden-metric");
  const ledger = createEndgameMetricLedgerV1(binding);
  const during = projectEndgameMetricsForPlayerV1({ runPackageBinding: binding, ledger, phase: "RUN" });
  const ending = projectEndgameMetricsForPlayerV1({ runPackageBinding: binding, ledger, phase: "ENDING" });
  assert.equal(during.some((metric) => metric.metricId === "reserve"), false);
  assert.equal(ending.some((metric) => metric.metricId === "reserve"), true);
});

test("S2 arbitrary three-metric package requires no runtime code change", () => {
  const packageDocument = clone(neutral);
  packageDocument.metrics = packageDocument.metrics.filter((metric) => metric.metricId !== "exposure");
  packageDocument.presentation.metricOrder = packageDocument.presentation.metricOrder.filter((metricId) => metricId !== "exposure");
  const binding = bindingFor(packageDocument, "run-three-metrics");
  const ledger = createEndgameMetricLedgerV1(binding);
  assert.deepEqual(Object.keys(ledger.metrics).sort(), ["cohesion", "reserve", "signal"]);
});

test("S2 arbitrary six-metric package requires no runtime code change", () => {
  const packageDocument = clone(neutral);
  for (const [metricId, label, initialValue] of [["momentum", "Momentum", 25], ["clarity", "Clarity", 75]]) {
    const definition = clone(packageDocument.metrics[0]);
    definition.metricId = metricId;
    definition.label = label;
    definition.description = label;
    definition.initialValue = initialValue;
    definition.display.order = packageDocument.metrics.length + 1;
    packageDocument.metrics.push(definition);
    packageDocument.presentation.metricOrder.push(metricId);
  }
  const binding = bindingFor(packageDocument, "run-six-metrics");
  const ledger = createEndgameMetricLedgerV1(binding);
  assert.equal(Object.keys(ledger.metrics).length, 6);
  assert.equal(ledger.metrics.clarity, 75);
});

test("S2 renaming a metric in JSON requires no engine branch", () => {
  const packageDocument = clone(neutral);
  const definition = packageDocument.metrics.find((metric) => metric.metricId === "signal");
  definition.metricId = "pulse";
  definition.label = "Pulse";
  packageDocument.presentation.metricOrder = packageDocument.presentation.metricOrder.map((metricId) => metricId === "signal" ? "pulse" : metricId);
  const binding = bindingFor(packageDocument, "run-renamed-metric");
  const ledger = createEndgameMetricLedgerV1(binding);
  const applied = applyEndgameMetricChangesV1({
    runPackageBinding: binding,
    ledger,
    submissionId: "submission-pulse",
    expectedRevision: 0,
    stageIndex: 1,
    sourceActionId: "action-pulse",
    changes: [change({ changeId: "change-pulse", metricId: "pulse" })]
  });
  assert.equal(applied.ledger.metrics.pulse, 48);
  assert.equal(Object.hasOwn(applied.ledger.metrics, "signal"), false);
});

test("S2 stable change ordering is independent of request array order", () => {
  const binding = bindingFor();
  const ledgerA = createEndgameMetricLedgerV1(binding);
  const ledgerB = createEndgameMetricLedgerV1(binding);
  const changes = [
    change({ changeId: "change-signal-order", delta: 2 }),
    change({ changeId: "change-reserve-order", metricId: "reserve", delta: 3, sourceFactIds: ["fact-reserve-order"] })
  ];
  const common = {
    runPackageBinding: binding,
    submissionId: "submission-order",
    expectedRevision: 0,
    stageIndex: 1,
    sourceActionId: "action-order"
  };
  const first = applyEndgameMetricChangesV1({ ...common, ledger: ledgerA, changes });
  const second = applyEndgameMetricChangesV1({ ...common, ledger: ledgerB, changes: [...changes].reverse() });
  assert.deepEqual(first.ledger, second.ledger);
});

test("S2 projection formatting is package-driven", () => {
  const percent = clone(neutral.metrics[0]);
  percent.metricId = "ratio";
  percent.format = { kind: "PERCENT", suffix: "%", decimals: 1 };
  const currency = clone(neutral.metrics[0]);
  currency.metricId = "balance";
  currency.format = { kind: "CURRENCY", suffix: "$", decimals: 2 };
  assert.equal(formatMetricValueV1(percent, 42.25), "42.3%");
  assert.equal(formatMetricValueV1(currency, 42.25), "$42.25");
});

test("S2 ledger from a different frozen package fails closed", () => {
  const binding = bindingFor(neutral, "run-package-a");
  const ledger = createEndgameMetricLedgerV1(binding);
  const changed = clone(neutral);
  changed.policyVersion = "1.0.1";
  const otherBinding = bindingFor(changed, "run-package-a");
  expectCode(() => assertEndgameMetricLedgerV1(otherBinding, ledger), "ENDGAME_METRIC_PACKAGE_MISMATCH");
});

test("S2 ledger run mismatch fails closed", () => {
  const binding = bindingFor(neutral, "run-one");
  const ledger = createEndgameMetricLedgerV1(binding);
  const otherBinding = bindingFor(neutral, "run-two");
  expectCode(() => assertEndgameMetricLedgerV1(otherBinding, ledger), "ENDGAME_METRIC_RUN_MISMATCH");
});
