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

test("S4 scoring uses structured magnitude and metric impacts rather than wording", () => {
  const facts = routeFacts(neutral, "structured-score").filter((item) => item.category !== "ACHIEVEMENT");
  facts.push(fact(neutral, {
    factId: "achievement-metric-impact",
    category: "ACHIEVEMENT",
    title: "ordinary wording",
    text: "ordinary wording",
    magnitude: 1,
    metricImpacts: [{ metricId: "signal", delta: 50 }]
  }));
  facts.push(fact(neutral, {
    factId: "achievement-keyword-bait",
    category: "ACHIEVEMENT",
    title: "ULTIMATE PERFECT VICTORY",
    text: "BEST ENDING GUARANTEED",
    magnitude: 10,
    metricImpacts: []
  }));
  const { blueprint } = compileRoute(neutral, { runId: "run-structured-score", facts });
  assert.deepEqual(blueprint.slots.dominant_achievement[0].evidenceRefs, ["achievement-metric-impact"]);
});

test("S4 changing unselected narrative-like wording cannot change details or fingerprint", () => {
  const selected = routeFacts(neutral, "no-keyword");
  const extraA = fact(neutral, {
    factId: "unselected-relationship",
    category: "RELATIONSHIP",
    title: "victory victory victory",
    text: "a dramatic narration-like sentence",
    magnitude: 999
  });
  const extraB = { ...extraA, title: "defeat defeat defeat", text: "a different dramatic sentence" };
  const first = compileRoute(neutral, {
    runId: "run-no-keyword-a",
    facts: [...selected, extraA]
  });
  const second = compileRoute(neutral, {
    runId: "run-no-keyword-b",
    facts: [...selected, extraB]
  });
  assert.equal(first.blueprint.endingFingerprint, second.blueprint.endingFingerprint);
  assert.deepEqual(first.blueprint, second.blueprint);
});

test("S4 slot dedupe by sourceActionId prevents one action from filling repeated items", () => {
  const packageDocument = clone(neutral);
  const slot = packageDocument.detailCompilation.slots.find((item) => item.slotId === "decisive_causes");
  slot.dedupeBy = ["sourceActionId"];
  const facts = routeFacts(packageDocument, "dedupe");
  facts.push(fact(packageDocument, {
    factId: "dedupe-cause-two",
    sourceType: "PLAYER_ACTION",
    category: "ACTION",
    sourceActionId: "dedupe-action-c",
    stageIndex: 6,
    magnitude: 99
  }));
  facts.push(fact(packageDocument, {
    factId: "dedupe-cause-three",
    sourceType: "PLAYER_ACTION",
    category: "ACTION",
    sourceActionId: "dedupe-action-d",
    stageIndex: 7,
    magnitude: 2
  }));
  const { blueprint } = compileRoute(packageDocument, { runId: "run-dedupe", facts });
  const refs = blueprint.slots.decisive_causes.flatMap((item) => item.evidenceRefs);
  assert.equal(refs.includes("dedupe-cause-two") || refs.includes("dedupe-cause"), true);
  assert.equal(refs.includes("dedupe-cause-two") && refs.includes("dedupe-cause"), false);
  assert.ok(refs.includes("dedupe-cause-three"));
});

test("S4 score ties follow sourceRevision, stageIndex, sourceActionId, then factId", () => {
  const facts = routeFacts(neutral, "tie").filter((item) => item.category !== "ACHIEVEMENT");
  facts.push(fact(neutral, {
    factId: "tie-zulu",
    category: "ACHIEVEMENT",
    sourceActionId: "action-zulu",
    magnitude: 5,
    stageIndex: 4
  }));
  facts.push(fact(neutral, {
    factId: "tie-alpha",
    category: "ACHIEVEMENT",
    sourceActionId: "action-alpha",
    magnitude: 5,
    stageIndex: 4
  }));
  const { blueprint } = compileRoute(neutral, { runId: "run-tie", facts });
  assert.deepEqual(blueprint.slots.dominant_achievement[0].evidenceRefs, ["tie-alpha"]);
});

test("S4 scene fallback is deterministic and uses only matching anchors", () => {
  const facts = routeFacts(neutral, "scene-fallback", { sceneTag: "scene:gate" });
  const { blueprint } = compileRoute(neutral, { runId: "run-scene-fallback", facts });
  assert.equal(blueprint.scene.sceneId, "gate");
  assert.deepEqual(blueprint.scene.anchorFactRefs, ["scene-fallback-scene"]);
});

test("S4 deterministic templates fill configured fallback slots without inventing facts", () => {
  const facts = routeFacts(neutral, "template").filter((item) => !["SCENE_ANCHOR", "UNRESOLVED_HOOK"].includes(item.category));
  const { blueprint } = compileRoute(neutral, { runId: "run-template-fallback", facts });
  assert.deepEqual(blueprint.slots.scene_anchor[0].evidenceRefs, []);
  assert.deepEqual(blueprint.slots.unresolved_hooks[0].evidenceRefs, []);
  assert.equal(blueprint.allowedFactRefs.includes("template-scene"), false);
});

test("S4 missing required fact-backed slot fails closed", () => {
  const facts = routeFacts(neutral, "missing-required").filter((item) => item.category !== "ACHIEVEMENT");
  const binding = bindingFor(neutral, "run-missing-required");
  const store = storeFor(binding, facts, { submissionId: "submission-missing" });
  const committed = collectCommittedEndgameFactsV1({ runPackageBinding: binding, factStore: store });
  const state = completeState(neutral);
  const adjudication = finalizeEndgameAdjudicationV3({
    runPackageBinding: binding,
    sourceRevision: 1,
    metrics: initialMetrics(neutral),
    state,
    facts: committed
  });
  expectCode(() => compileConfigDrivenEndingDetailsV2({
    runPackageBinding: binding,
    adjudication,
    factStore: store,
    state
  }), "ENDGAME_DETAIL_REQUIRED_SLOT_UNSATISFIED");
});

test("S4 minimum distinct fact threshold fails closed", () => {
  const packageDocument = clone(neutral);
  packageDocument.detailCompilation.minimumVariation.minimumDistinctSourceFacts = 6;
  const binding = bindingFor(packageDocument, "run-min-facts");
  const facts = routeFacts(packageDocument, "min-facts");
  const store = storeFor(binding, facts, { submissionId: "submission-min-facts" });
  const committed = collectCommittedEndgameFactsV1({ runPackageBinding: binding, factStore: store });
  const state = completeState(packageDocument);
  const adjudication = finalizeEndgameAdjudicationV3({
    runPackageBinding: binding,
    sourceRevision: 1,
    metrics: initialMetrics(packageDocument),
    state,
    facts: committed
  });
  expectCode(() => compileConfigDrivenEndingDetailsV2({ runPackageBinding: binding, adjudication, factStore: store, state }), "ENDGAME_DETAIL_MINIMUM_FACTS");
});

test("S4 minimum distinct source-action threshold fails closed", () => {
  const packageDocument = clone(neutral);
  packageDocument.detailCompilation.minimumVariation.minimumDistinctSourceActions = 2;
  const facts = routeFacts(packageDocument, "min-actions").map((item) => ({
    ...item,
    sourceActionId: item.sourceActionId === null ? null : "one-action"
  }));
  const binding = bindingFor(packageDocument, "run-min-actions");
  const store = storeFor(binding, facts, { submissionId: "submission-min-actions" });
  const committed = collectCommittedEndgameFactsV1({ runPackageBinding: binding, factStore: store });
  const state = completeState(packageDocument);
  const adjudication = finalizeEndgameAdjudicationV3({
    runPackageBinding: binding,
    sourceRevision: 1,
    metrics: initialMetrics(packageDocument),
    state,
    facts: committed
  });
  expectCode(() => compileConfigDrivenEndingDetailsV2({ runPackageBinding: binding, adjudication, factStore: store, state }), "ENDGAME_DETAIL_MINIMUM_ACTIONS");
});

test("S4 compiler rejects narration, prompt, and reviewer inputs", () => {
  const prepared = compileRoute(neutral, { runId: "run-reject-inference", facts: routeFacts(neutral, "reject") });
  for (const field of ["narration", "prompt", "reviewer"]) {
    expectCode(() => compileConfigDrivenEndingDetailsV2({
      runPackageBinding: prepared.binding,
      adjudication: prepared.adjudication,
      factStore: prepared.factStore,
      state: prepared.state,
      [field]: "untrusted"
    }), "ENDGAME_DETAIL_CLOSED_OBJECT_VIOLATION");
  }
});

test("S4 facts newer than the final adjudication fail closed", () => {
  const binding = bindingFor(neutral, "run-future-fact");
  const initialFacts = routeFacts(neutral, "future", { sourceRevision: 1 });
  const firstStore = storeFor(binding, initialFacts, { submissionId: "submission-initial", sourceRevision: 1 });
  const committedInitial = collectCommittedEndgameFactsV1({ runPackageBinding: binding, factStore: firstStore });
  const state = completeState(neutral);
  const adjudication = finalizeEndgameAdjudicationV3({
    runPackageBinding: binding,
    sourceRevision: 1,
    metrics: initialMetrics(neutral),
    state,
    facts: committedInitial
  });
  const future = fact(neutral, { factId: "fact-future", sourceRevision: 2, sourceActionId: "future-action" });
  const secondStore = commitEndgameFactsV1({
    runPackageBinding: binding,
    factStore: firstStore,
    submissionId: "submission-future",
    expectedRevision: 1,
    sourceRevision: 2,
    facts: [future]
  }).factStore;
  expectCode(() => compileConfigDrivenEndingDetailsV2({ runPackageBinding: binding, adjudication, factStore: secondStore, state }), "ENDGAME_DETAIL_FUTURE_FACT");
});

test("S4 detail inputs must replay to the exact frozen adjudication", () => {
  const packageDocument = clone(neutral);
  const world = packageDocument.outcomeAxes.find((axis) => axis.axisId === "world_outcome");
  world.outcomes[0].when = {
    factExists: {
      includeTagsAny: ["route:qualifies"],
      statuses: ["OCCURRED"],
      visibility: ["PLAYER", "PUBLIC"]
    }
  };
  packageDocument.factTaxonomy.recommendedTags.push("route:qualifies");
  const qualifyingFacts = routeFacts(packageDocument, "replay");
  qualifyingFacts[2].tags.push("route:qualifies");
  const binding = bindingFor(packageDocument, "run-replay-mismatch");
  const goodStore = storeFor(binding, qualifyingFacts, { submissionId: "submission-good" });
  const goodCommitted = collectCommittedEndgameFactsV1({ runPackageBinding: binding, factStore: goodStore });
  const state = completeState(packageDocument);
  const adjudication = finalizeEndgameAdjudicationV3({
    runPackageBinding: binding,
    sourceRevision: 1,
    metrics: initialMetrics(packageDocument),
    state,
    facts: goodCommitted
  });
  const nonqualifyingFacts = clone(qualifyingFacts);
  nonqualifyingFacts[2].tags = [];
  const badStore = storeFor(binding, nonqualifyingFacts, { submissionId: "submission-bad" });
  expectCode(() => compileConfigDrivenEndingDetailsV2({ runPackageBinding: binding, adjudication, factStore: badStore, state }), "ENDGAME_DETAIL_ADJUDICATION_INPUT_MISMATCH");
});

test("S4 Sangtian configuration is compatible without a world-specific compiler", () => {
  const facts = routeFacts(sangtian, "config-one", {
    sceneTag: "scene:market",
    strategyTags: ["strategy:people_first"]
  });
  facts.push(fact(sangtian, {
    factId: "config-one-style-two",
    sourceType: "PLAYER_ACTION",
    category: "ACTION",
    tags: ["strategy:people_first"],
    sourceActionId: "config-one-action-d"
  }));
  facts.push(fact(sangtian, {
    factId: "config-one-style-three",
    sourceType: "PLAYER_ACTION",
    category: "ACTION",
    tags: ["strategy:people_first"],
    sourceActionId: "config-one-action-e"
  }));
  const metrics = initialMetrics(sangtian);
  metrics.reform_progress = 80;
  metrics.imperial_trust = 70;
  const { blueprint } = compileRoute(sangtian, {
    runId: "run-config-one-details",
    facts,
    metrics,
    state: completeState(sangtian, 20)
  });
  assert.equal(blueprint.style.styleId, "people_first");
  assert.equal(blueprint.scene.sceneId, "market");
  assert.equal(blueprint.resolvedAxes.length, 2);
});

test("S4 Caesar configuration is compatible without a world-specific compiler", () => {
  const facts = routeFacts(caesar, "config-two", {
    sceneTag: "scene:senate",
    strategyTags: ["strategy:mediation"]
  });
  facts.push(fact(caesar, {
    factId: "config-two-style-two",
    sourceType: "PLAYER_ACTION",
    category: "ACTION",
    tags: ["strategy:mediation"],
    sourceActionId: "config-two-action-d"
  }));
  const metrics = initialMetrics(caesar);
  metrics.republic_stability = 65;
  metrics.senate_support = 70;
  const { blueprint } = compileRoute(caesar, {
    runId: "run-config-two-details",
    facts,
    metrics,
    state: completeState(caesar, 12)
  });
  assert.equal(blueprint.style.styleId, "mediator");
  assert.equal(blueprint.scene.sceneId, "senate");
  assert.equal(blueprint.resolvedAxes.length, 2);
});

test("S4 generic sources contain no world-specific branches or inference inputs", () => {
  const source = PATHS.genericSources
    .map((path) => readFileSync(new URL(path, ROOT), "utf8"))
    .join("\n");
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
  for (const pattern of [
    /\bnarration\b/iu,
    /\bprompt\b/iu,
    /\breviewer\b/iu,
    /\beval\s*\(/u,
    /Math\.random/u,
    /process\.env/u,
    /node:fs/u,
    /node:net/u,
    /\bfetch\s*\(/u
  ]) assert.doesNotMatch(source, pattern);
});
