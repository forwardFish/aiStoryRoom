import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  compileConfigDrivenEndingDetailsV2
} from "../src/endgame/config-driven-ending-detail-compiler-v1.mjs";
import {
  assertEndgameFactStoreV1,
  collectCommittedEndgameFactsV1,
  commitEndgameFactsV1,
  createEndgameFactStoreV1,
  normalizeEndgameFactV1
} from "../src/endgame/endgame-fact-store-v1.mjs";
import {
  finalizeEndgameAdjudicationV3
} from "../src/endgame/config-driven-endgame-adjudicator-v1.mjs";
import {
  freezeEndgamePackageForRunV1,
  loadEndgamePackageV1
} from "../src/endgame/endgame-package-loader-v1.mjs";

export const ROOT = new URL("../../..", import.meta.url);
export const PATHS = {
  neutral: "packages/templates/config/endgame/fixtures/neutral-synthetic.endgame.fixture.json",
  sangtian: "packages/templates/config/endgame/examples/sangtian.endgame.example.json",
  caesar: "packages/templates/config/endgame/examples/caesar.endgame.example.json",
  compiler: "packages/shared/src/endgame/config-driven-ending-detail-compiler-v1.mjs",
  store: "packages/shared/src/endgame/endgame-fact-store-v1.mjs",
  genericSources: [
    "packages/shared/src/endgame/config-driven-ending-detail-compiler-v1.mjs",
    "packages/shared/src/endgame/ending-detail-common-v1.mjs",
    "packages/shared/src/endgame/ending-detail-selection-v1.mjs",
    "packages/shared/src/endgame/ending-detail-blueprint-support-v1.mjs",
    "packages/shared/src/endgame/endgame-fact-store-v1.mjs"
  ]
};
export const neutral = readJson(PATHS.neutral);
export const sangtian = readJson(PATHS.sangtian);
export const caesar = readJson(PATHS.caesar);

export function readJson(path) {
  return JSON.parse(readFileSync(new URL(path, ROOT), "utf8"));
}

export function clone(value) {
  return structuredClone(value);
}

export function bindingFor(packageDocument = neutral, runId = `run-${packageDocument.worldId}`) {
  const loaded = loadEndgamePackageV1(packageDocument, { sourceId: runId });
  return freezeEndgamePackageForRunV1({ runId, packageSnapshot: loaded.snapshot });
}

export function initialMetrics(packageDocument) {
  return Object.fromEntries(packageDocument.metrics.map((metric) => [metric.metricId, metric.initialValue]));
}

export function completeState(packageDocument, turnNumber = 999, emergency = false) {
  return Object.fromEntries(packageDocument.stateVariables.map((definition) => {
    if (definition.stateId === "turnNumber") return [definition.stateId, turnNumber];
    if (definition.stateId === "partCompletionStatus") return [definition.stateId, "HANDOFF_READY"];
    if (definition.stateId === "emergency") return [definition.stateId, emergency];
    if (definition.type === "NUMBER") return [definition.stateId, 0];
    if (definition.type === "BOOLEAN") return [definition.stateId, false];
    return [definition.stateId, ""];
  }));
}

export function fact(packageDocument, overrides = {}) {
  const factId = overrides.factId ?? "fact-default";
  const sourceType = overrides.sourceType ?? "CANON_FACT";
  const sourceActionId = Object.hasOwn(overrides, "sourceActionId")
    ? overrides.sourceActionId
    : `action-${factId}`;
  return {
    schemaVersion: "endgame_fact_v1",
    factId,
    sourceType,
    category: overrides.category ?? "CUSTOM",
    title: overrides.title ?? `Title ${factId}`,
    text: overrides.text ?? `Text ${factId}`,
    tags: overrides.tags ?? [],
    polarity: overrides.polarity ?? "NEUTRAL",
    status: overrides.status ?? "OCCURRED",
    magnitude: overrides.magnitude ?? 1,
    actorIds: overrides.actorIds ?? [],
    targetIds: overrides.targetIds ?? [],
    locationIds: overrides.locationIds ?? [],
    objectIds: overrides.objectIds ?? [],
    metricImpacts: overrides.metricImpacts ?? [],
    visibility: overrides.visibility ?? "PLAYER",
    stageIndex: Object.hasOwn(overrides, "stageIndex") ? overrides.stageIndex : 1,
    sourceActionId,
    sourceRevision: overrides.sourceRevision ?? 1
  };
}

export function routeFacts(packageDocument, prefix, {
  sceneTag = "scene:hub",
  strategyTags = [],
  sourceRevision = 1
} = {}) {
  const metricId = packageDocument.metrics[0].metricId;
  return [
    fact(packageDocument, {
      factId: `${prefix}-achievement`,
      category: "ACHIEVEMENT",
      title: `${prefix} achievement`,
      text: `${prefix} preserved a durable result`,
      polarity: "POSITIVE",
      magnitude: 5,
      metricImpacts: [{ metricId, delta: 5 }],
      stageIndex: 1,
      sourceActionId: `${prefix}-action-a`,
      sourceRevision
    }),
    fact(packageDocument, {
      factId: `${prefix}-cost`,
      category: "COST",
      title: `${prefix} cost`,
      text: `${prefix} paid a durable cost`,
      polarity: "NEGATIVE",
      magnitude: 4,
      metricImpacts: [{ metricId, delta: -3 }],
      stageIndex: 2,
      sourceActionId: `${prefix}-action-b`,
      sourceRevision
    }),
    fact(packageDocument, {
      factId: `${prefix}-cause`,
      sourceType: "PLAYER_ACTION",
      category: "ACTION",
      title: `${prefix} decisive action`,
      text: `${prefix} made a committed choice`,
      tags: strategyTags,
      magnitude: 3,
      stageIndex: 3,
      sourceActionId: `${prefix}-action-c`,
      sourceRevision
    }),
    fact(packageDocument, {
      factId: `${prefix}-scene`,
      category: "SCENE_ANCHOR",
      title: `${prefix} scene`,
      text: `${prefix} left a visible scene anchor`,
      tags: [sceneTag],
      magnitude: 2,
      visibility: "PUBLIC",
      locationIds: [`${prefix}-location`],
      stageIndex: 4,
      sourceActionId: `${prefix}-action-c`,
      sourceRevision
    }),
    fact(packageDocument, {
      factId: `${prefix}-hook`,
      sourceType: "DELAYED_EVENT",
      category: "UNRESOLVED_HOOK",
      title: `${prefix} unresolved`,
      text: `${prefix} remains unresolved`,
      status: "PENDING",
      magnitude: 2,
      stageIndex: 5,
      sourceActionId: null,
      sourceRevision
    })
  ];
}

export function storeFor(binding, facts, {
  submissionId = "submission-facts",
  sourceRevision = 1
} = {}) {
  const initial = createEndgameFactStoreV1(binding);
  return commitEndgameFactsV1({
    runPackageBinding: binding,
    factStore: initial,
    submissionId,
    expectedRevision: 0,
    sourceRevision,
    facts
  }).factStore;
}

export function compileRoute(packageDocument, {
  runId = `run-${packageDocument.worldId}-details`,
  facts = routeFacts(packageDocument, "route"),
  metrics = initialMetrics(packageDocument),
  state = completeState(packageDocument),
  sourceRevision = 1,
  submissionId = "submission-facts"
} = {}) {
  const binding = bindingFor(packageDocument, runId);
  const factStore = storeFor(binding, facts, { submissionId, sourceRevision });
  const committedFacts = collectCommittedEndgameFactsV1({ runPackageBinding: binding, factStore });
  const adjudication = finalizeEndgameAdjudicationV3({
    runPackageBinding: binding,
    sourceRevision,
    metrics,
    state,
    facts: committedFacts
  });
  const blueprint = compileConfigDrivenEndingDetailsV2({
    runPackageBinding: binding,
    adjudication,
    factStore,
    state
  });
  return { binding, factStore, adjudication, blueprint, state, metrics, facts: committedFacts };
}

export function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error?.code, code, error?.stack ?? String(error));
    return true;
  });
}

export function evidenceRefs(blueprint) {
  return Object.values(blueprint.slots)
    .flat()
    .flatMap((item) => item.evidenceRefs);
}

export {
  compileConfigDrivenEndingDetailsV2,
  assertEndgameFactStoreV1,
  collectCommittedEndgameFactsV1,
  commitEndgameFactsV1,
  createEndgameFactStoreV1,
  normalizeEndgameFactV1,
  finalizeEndgameAdjudicationV3,
  freezeEndgamePackageForRunV1,
  loadEndgamePackageV1
};
