import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ROOT,
  PATHS,
  neutral,
  sangtian,
  caesar,
  clone,
  bindingFor,
  initialMetrics,
  completeState,
  fact,
  routeFacts,
  storeFor,
  compileRoute,
  expectCode,
  evidenceRefs,
  compileConfigDrivenEndingDetailsV2,
  assertEndgameFactStoreV1,
  collectCommittedEndgameFactsV1,
  commitEndgameFactsV1,
  createEndgameFactStoreV1,
  normalizeEndgameFactV1,
  finalizeEndgameAdjudicationV3,
  freezeEndgamePackageForRunV1,
  loadEndgamePackageV1
} from "./generic-endgame-s4-details-fixture.mjs";

test("S4 creates a package-bound empty fact store", () => {
  const binding = bindingFor(neutral, "run-empty-store");
  const store = createEndgameFactStoreV1(binding);
  assert.equal(store.revision, 0);
  assert.deepEqual(store.facts, []);
  assert.equal(Object.isFrozen(store), true);
});

test("S4 writes and collects committed structured EndgameFact records", () => {
  const binding = bindingFor(neutral, "run-fact-write");
  const inputFacts = routeFacts(neutral, "write");
  const result = commitEndgameFactsV1({
    runPackageBinding: binding,
    factStore: createEndgameFactStoreV1(binding),
    submissionId: "submission-write",
    expectedRevision: 0,
    sourceRevision: 1,
    facts: inputFacts
  });
  assert.equal(result.committed, true);
  assert.equal(result.factStore.revision, 1);
  assert.equal(collectCommittedEndgameFactsV1({ runPackageBinding: binding, factStore: result.factStore }).length, 5);
});

test("S4 fact commit retry is idempotent", () => {
  const binding = bindingFor(neutral, "run-fact-idempotent");
  const facts = routeFacts(neutral, "idempotent");
  const request = {
    runPackageBinding: binding,
    factStore: createEndgameFactStoreV1(binding),
    submissionId: "submission-idempotent",
    expectedRevision: 0,
    sourceRevision: 1,
    facts
  };
  const first = commitEndgameFactsV1(request);
  const retry = commitEndgameFactsV1({ ...request, factStore: first.factStore, expectedRevision: 999 });
  assert.equal(retry.committed, false);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.factStore, first.factStore);
});

test("S4 fact idempotency key reuse with different facts fails closed", () => {
  const binding = bindingFor(neutral, "run-fact-conflict");
  const facts = routeFacts(neutral, "conflict");
  const first = commitEndgameFactsV1({
    runPackageBinding: binding,
    factStore: createEndgameFactStoreV1(binding),
    submissionId: "submission-conflict",
    expectedRevision: 0,
    sourceRevision: 1,
    facts
  });
  const changed = clone(facts);
  changed[0].text = "different committed fact";
  expectCode(() => commitEndgameFactsV1({
    runPackageBinding: binding,
    factStore: first.factStore,
    submissionId: "submission-conflict",
    expectedRevision: 1,
    sourceRevision: 1,
    facts: changed
  }), "ENDGAME_FACT_IDEMPOTENCY_CONFLICT");
});

test("S4 stale fact-store revision fails closed", () => {
  const binding = bindingFor(neutral, "run-fact-revision");
  expectCode(() => commitEndgameFactsV1({
    runPackageBinding: binding,
    factStore: createEndgameFactStoreV1(binding),
    submissionId: "submission-stale",
    expectedRevision: 2,
    sourceRevision: 1,
    facts: routeFacts(neutral, "stale")
  }), "ENDGAME_FACT_REVISION_CONFLICT");
});

test("S4 duplicate factId across durable commits fails closed", () => {
  const binding = bindingFor(neutral, "run-fact-duplicate");
  const firstFact = fact(neutral, { factId: "fact-reused", sourceRevision: 1 });
  const first = commitEndgameFactsV1({
    runPackageBinding: binding,
    factStore: createEndgameFactStoreV1(binding),
    submissionId: "submission-one",
    expectedRevision: 0,
    sourceRevision: 1,
    facts: [firstFact]
  });
  const secondFact = fact(neutral, { factId: "fact-reused", sourceRevision: 2, text: "new text" });
  expectCode(() => commitEndgameFactsV1({
    runPackageBinding: binding,
    factStore: first.factStore,
    submissionId: "submission-two",
    expectedRevision: 1,
    sourceRevision: 2,
    facts: [secondFact]
  }), "ENDGAME_FACT_ID_REUSED");
});

test("S4 tampered durable fact content is detected by commit hash", () => {
  const binding = bindingFor(neutral, "run-fact-tamper");
  const store = storeFor(binding, routeFacts(neutral, "tamper"), { submissionId: "submission-tamper" });
  const tampered = clone(store);
  tampered.facts[0].text = "tampered";
  expectCode(() => assertEndgameFactStoreV1(binding, tampered), "ENDGAME_FACT_COMMIT_HASH_MISMATCH");
});

test("S4 fact contract rejects Narration/Prompt/Reviewer source types", () => {
  const binding = bindingFor(neutral, "run-fact-source-type");
  for (const sourceType of ["NARRATION", "PROMPT", "REVIEWER"]) {
    expectCode(() => normalizeEndgameFactV1(binding, fact(neutral, {
      factId: `fact-${sourceType.toLowerCase()}`,
      sourceType
    })), "ENDGAME_FACT_SOURCE_TYPE_INVALID");
  }
});

test("S4 fact contract rejects unknown fields", () => {
  const binding = bindingFor(neutral, "run-fact-unknown-field");
  const value = { ...fact(neutral, { factId: "fact-unknown-field" }), inferredFromNarration: true };
  expectCode(() => normalizeEndgameFactV1(binding, value), "ENDGAME_FACT_CLOSED_OBJECT_VIOLATION");
});

test("S4 fact contract rejects TRIGGERED delayed-event status", () => {
  const binding = bindingFor(neutral, "run-fact-triggered");
  expectCode(() => normalizeEndgameFactV1(binding, fact(neutral, {
    factId: "fact-triggered",
    sourceType: "DELAYED_EVENT",
    status: "TRIGGERED",
    sourceActionId: null
  })), "ENDGAME_FACT_STATUS_INVALID");
});

test("S4 fact contract rejects non-finite magnitude and metric deltas", () => {
  const binding = bindingFor(neutral, "run-fact-nonfinite");
  expectCode(() => normalizeEndgameFactV1(binding, fact(neutral, {
    factId: "fact-magnitude-nan",
    magnitude: Number.NaN
  })), "ENDGAME_FACT_NON_FINITE");
  expectCode(() => normalizeEndgameFactV1(binding, fact(neutral, {
    factId: "fact-delta-infinite",
    metricImpacts: [{ metricId: "signal", delta: Number.POSITIVE_INFINITY }]
  })), "ENDGAME_FACT_NON_FINITE");
});

test("S4 fact metric impacts must reference the frozen package", () => {
  const binding = bindingFor(neutral, "run-fact-metric-unknown");
  expectCode(() => normalizeEndgameFactV1(binding, fact(neutral, {
    factId: "fact-unknown-metric",
    metricImpacts: [{ metricId: "not-configured", delta: 1 }]
  })), "ENDGAME_FACT_METRIC_UNKNOWN");
});

test("S4 collector can project only player-safe committed facts", () => {
  const binding = bindingFor(neutral, "run-fact-visibility");
  const facts = [
    fact(neutral, { factId: "fact-player", visibility: "PLAYER" }),
    fact(neutral, { factId: "fact-public", visibility: "PUBLIC" }),
    fact(neutral, { factId: "fact-private", visibility: "PRIVATE_OTHER" }),
    fact(neutral, { factId: "fact-internal", visibility: "INTERNAL" })
  ];
  const store = storeFor(binding, facts, { submissionId: "submission-visibility" });
  const safe = collectCommittedEndgameFactsV1({
    runPackageBinding: binding,
    factStore: store,
    visibility: ["PLAYER", "PUBLIC"]
  });
  assert.deepEqual(safe.map((item) => item.factId), ["fact-player", "fact-public"]);
});

test("S4 neutral fixture compiles fact-traceable slots, style, scene, and fingerprint", () => {
  const result = compileRoute(neutral, {
    runId: "run-neutral-details",
    facts: routeFacts(neutral, "neutral")
  });
  assert.equal(result.blueprint.schemaVersion, "ending_detail_blueprint_v2");
  assert.match(result.blueprint.endingFingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(result.blueprint.style.styleId, "balancer");
  assert.deepEqual(result.blueprint.style.evidenceRefs, []);
  assert.equal(result.blueprint.scene.sceneId, "hub");
  assert.deepEqual(result.blueprint.scene.anchorFactRefs, ["neutral-scene"]);
  for (const ref of evidenceRefs(result.blueprint)) assert.ok(result.blueprint.allowedFactRefs.includes(ref));
});

test("S4 every selected non-template detail traces to a committed structured fact", () => {
  const result = compileRoute(neutral, {
    runId: "run-traceability",
    facts: routeFacts(neutral, "trace")
  });
  const committedIds = new Set(result.facts.map((item) => item.factId));
  for (const items of Object.values(result.blueprint.slots)) {
    for (const item of items) {
      for (const ref of item.evidenceRefs) assert.ok(committedIds.has(ref));
    }
  }
});

test("S4 same route repeated 100 times has identical fingerprint and details", () => {
  const prepared = compileRoute(neutral, {
    runId: "run-repeat-details",
    facts: routeFacts(neutral, "repeat")
  });
  const expected = JSON.stringify(prepared.blueprint);
  for (let index = 0; index < 100; index += 1) {
    const next = compileConfigDrivenEndingDetailsV2({
      runPackageBinding: prepared.binding,
      adjudication: prepared.adjudication,
      factStore: prepared.factStore,
      state: prepared.state
    });
    assert.equal(next.endingFingerprint, prepared.blueprint.endingFingerprint);
    assert.equal(JSON.stringify(next), expected);
  }
});

test("S4 three routes with the same macro axes produce at least three explainable detail differences", () => {
  const routes = ["alpha", "beta", "gamma"].map((prefix) => compileRoute(neutral, {
    runId: `run-route-${prefix}`,
    facts: routeFacts(neutral, prefix)
  }));
  assert.deepEqual(routes.map((route) => route.adjudication.resolvedAxes), [
    routes[0].adjudication.resolvedAxes,
    routes[0].adjudication.resolvedAxes,
    routes[0].adjudication.resolvedAxes
  ]);
  const slotIds = ["dominant_achievement", "dominant_cost", "decisive_causes", "scene_anchor", "unresolved_hooks"];
  const differing = slotIds.filter((slotId) => new Set(routes.map((route) => JSON.stringify(route.blueprint.slots[slotId]))).size === 3);
  assert.ok(differing.length >= 3, differing.join(","));
  assert.equal(new Set(routes.map((route) => route.blueprint.endingFingerprint)).size, 3);
});

test("S4 private and internal facts cannot win a player-visible slot", () => {
  const facts = routeFacts(neutral, "visibility-safe");
  facts.push(fact(neutral, {
    factId: "private-achievement",
    category: "ACHIEVEMENT",
    visibility: "PRIVATE_OTHER",
    magnitude: 999,
    title: "private",
    text: "private"
  }));
  facts.push(fact(neutral, {
    factId: "internal-achievement",
    category: "ACHIEVEMENT",
    visibility: "INTERNAL",
    magnitude: 999,
    title: "internal",
    text: "internal"
  }));
  const { blueprint } = compileRoute(neutral, { runId: "run-private-safe", facts });
  assert.deepEqual(blueprint.slots.dominant_achievement[0].evidenceRefs, ["visibility-safe-achievement"]);
  assert.doesNotMatch(JSON.stringify(blueprint), /private-achievement|internal-achievement/u);
});

test("S4 PENDING facts are selected only for unresolved-hook slots", () => {
  const facts = routeFacts(neutral, "pending-safe");
  facts.push(fact(neutral, {
    factId: "pending-achievement",
    category: "ACHIEVEMENT",
    status: "PENDING",
    magnitude: 999,
    title: "pending achievement",
    text: "not yet occurred"
  }));
  facts.push(fact(neutral, {
    factId: "occurred-unresolved",
    category: "UNRESOLVED_HOOK",
    status: "OCCURRED",
    magnitude: 999,
    title: "already happened",
    text: "already happened"
  }));
  const { blueprint } = compileRoute(neutral, { runId: "run-pending-safe", facts });
  assert.deepEqual(blueprint.slots.dominant_achievement[0].evidenceRefs, ["pending-safe-achievement"]);
  assert.deepEqual(blueprint.slots.unresolved_hooks[0].evidenceRefs, ["pending-safe-hook"]);
});

test("S4 CANCELLED and EXPIRED facts cannot become unresolved hooks", () => {
  const facts = routeFacts(neutral, "cancelled-safe");
  facts.push(fact(neutral, {
    factId: "cancelled-hook",
    sourceType: "DELAYED_EVENT",
    category: "UNRESOLVED_HOOK",
    status: "CANCELLED",
    magnitude: 999,
    sourceActionId: null
  }));
  facts.push(fact(neutral, {
    factId: "expired-hook",
    sourceType: "DELAYED_EVENT",
    category: "UNRESOLVED_HOOK",
    status: "EXPIRED",
    magnitude: 999,
    sourceActionId: null
  }));
  const { blueprint } = compileRoute(neutral, { runId: "run-cancelled-safe", facts });
  assert.deepEqual(blueprint.slots.unresolved_hooks[0].evidenceRefs, ["cancelled-safe-hook"]);
});
