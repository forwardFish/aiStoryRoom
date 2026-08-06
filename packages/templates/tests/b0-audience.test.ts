import assert from "node:assert/strict";
import test from "node:test";
import type {
  B0ActionContractV1,
  B0CausalEdgeV1,
  B0IntentRelationV1,
  B0SettlementResolutionV1,
  B0SettlementSnapshotV1,
  B0StateMutationV1,
  B0StructuredResultV1,
  B0TypedAudienceSpecV1,
} from "@ai-story/shared";
import { hashCanonicalB0Value } from "../src/runtime-contract/b0-settlement";
import {
  B0AudienceErrorV1,
  buildB0PublicationPlanV1,
  resolveB0TypedAudienceV1,
} from "../src/runtime-contract/b0-audience";

const actorIds = ["actor.a", "actor.b", "actor.c", "npc.x"];

function action(
  id: string,
  actorId: string,
  targetActorId: string,
  visibility: B0ActionContractV1["visibilityIntent"],
): B0ActionContractV1 {
  return {
    schemaVersion: "b0-action-contract-v1",
    id,
    windowId: "window.c5",
    roomId: "run.c5",
    runId: "run.c5",
    actorId,
    baseWorldSequence: 19,
    revision: 1,
    kind: "ACT",
    rawPlayerText: `Action ${id}`,
    normalizedSummary: `Perform bounded action ${id}.`,
    targetRefs: [{ type: "ACTOR", id: targetActorId }],
    primaryEffect: { effectTypeId: "position.change", direction: "INCREASE", requestedMagnitude: "MINOR" },
    method: { methodTypeId: "method.bounded", description: "Use one bounded method." },
    resourceCommitments: [],
    evidenceRefs: [],
    capabilityRefs: [],
    propositionRefs: [],
    visibilityIntent: visibility,
    reactionPolicy: "NONE",
    requestedTiming: "CURRENT_WINDOW",
    riskTags: [],
    compilerVersion: "compiler.v1",
    validationVersion: "validator.v1",
    clientRequestId: `request.${id}`,
    status: "LOCKED",
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    confirmedAt: "2026-08-06T00:00:00.000Z",
    lockedAt: "2026-08-06T00:05:00.000Z",
  };
}

function snapshot(): B0SettlementSnapshotV1 {
  return {
    schemaVersion: "b0-settlement-snapshot-v1",
    id: "snapshot.c5",
    windowId: "window.c5",
    roomId: "run.c5",
    runId: "run.c5",
    baseWorldSequence: 19,
    rulesetVersion: "b0-c5-v1",
    rulesetHash: "a".repeat(64),
    worldState: {},
    actorStates: [
      { actorId: "actor.a", roleName: "Alpha" },
      { actorId: "actor.b", roleName: "Beta" },
      { actorId: "actor.c", roleName: "Gamma" },
      { actorId: "npc.x", displayName: "Witness" },
    ],
    roleBindings: [
      { actorId: "actor.a", roleId: "role.a" },
      { actorId: "actor.b", roleId: "role.b" },
      { actorId: "actor.c", roleId: "role.c" },
    ],
    knowledgeState: {},
    relationshipState: {},
    resourceState: {},
    activeCapabilities: [],
    dueSystemIntents: [],
    worldStateHash: "b".repeat(64),
    roleSetHash: "c".repeat(64),
    knowledgeStateHash: "d".repeat(64),
    relationshipStateHash: "e".repeat(64),
    createdAt: "2026-08-06T00:05:00.000Z",
  };
}

function mutation(id: string, originIntentId: string, entityType: B0StateMutationV1["entityType"] = "ACTOR", entityId = "actor.b"): B0StateMutationV1 {
  return {
    mutationId: id,
    entityType,
    entityId,
    attribute: "state.position",
    operation: "SET",
    value: "changed",
    originIntentIds: [originIntentId],
  };
}

function outcomeEdge(batchId: string, intentId: string): B0CausalEdgeV1 {
  return {
    schemaVersion: "b0-causal-edge-v1",
    id: `edge.outcome.${intentId}`,
    batchId,
    from: { type: "INTENT", id: intentId },
    to: { type: "INTENT_OUTCOME", id: `outcome.${intentId}` },
    relation: "CAUSED",
  };
}

function mutationEdge(batchId: string, intentId: string, mutationId: string): B0CausalEdgeV1 {
  return {
    schemaVersion: "b0-causal-edge-v1",
    id: `edge.mutation.${intentId}.${mutationId}`,
    batchId,
    from: { type: "INTENT", id: intentId },
    to: { type: "MUTATION", id: mutationId },
    relation: "CAUSED",
  };
}

function semanticEdge(batchId: string, intentId: string, type: "WORLD_EVENT" | "TRACE" | "KNOWLEDGE_GRANT", id: string): B0CausalEdgeV1 {
  return {
    schemaVersion: "b0-causal-edge-v1",
    id: `edge.semantic.${type}.${id}`,
    batchId,
    from: { type: "INTENT", id: intentId },
    to: { type, id },
    relation: "CAUSED",
  };
}

function relation(id: string, leftIntentId: string, rightIntentId: string): B0IntentRelationV1 {
  return {
    schemaVersion: "b0-intent-relation-v1",
    id,
    batchId: "batch.c5",
    leftIntentId,
    rightIntentId,
    type: "CONFLICTS",
    basis: "TARGET_OVERLAP",
    confidence: 1,
    classifierVersion: "classifier.v1",
    evidenceRefs: [],
  };
}

function resolution(
  intents: B0ActionContractV1[],
  results: B0StructuredResultV1[],
  mutations: B0StateMutationV1[] = [],
  extraEdges: B0CausalEdgeV1[] = [],
  relations: B0IntentRelationV1[] = [],
): B0SettlementResolutionV1 {
  const batchId = "batch.c5";
  const outcomeEdges = intents.map((entry) => outcomeEdge(batchId, entry.id));
  const allEdges = [...outcomeEdges, ...mutations.flatMap((entry) => entry.originIntentIds.map((id) => mutationEdge(batchId, id, entry.mutationId))), ...extraEdges]
    .sort((a, b) => a.id.localeCompare(b.id));
  const withoutHash: Omit<B0SettlementResolutionV1, "resolutionHash"> = {
    schemaVersion: "b0-settlement-resolution-v1",
    batchId,
    roomId: "run.c5",
    runId: "run.c5",
    windowId: "window.c5",
    baseWorldSequence: 19,
    intentRelations: relations,
    conflictGroups: intents.map((entry) => ({ conflictGroupId: `group.${entry.id}`, intentIds: [entry.id] })),
    intentOutcomes: intents.map((entry) => ({
      outcomeId: `outcome.${entry.id}`,
      intentId: entry.id,
      actorId: entry.actorId,
      status: "SUCCESS",
      summary: `Outcome ${entry.id}`,
      causalEdgeIds: [`edge.outcome.${entry.id}`],
    })),
    worldDelta: { mutations },
    structuredResults: results,
    pendingEffects: [],
    causalEdges: allEdges,
    resolutionVersion: "resolution.c5.v1",
  };
  return { ...withoutHash, resolutionHash: hashCanonicalB0Value(withoutHash) };
}

function crossResult(
  intentId: string,
  originActorId: string,
  targetActorId: string,
  audience: B0TypedAudienceSpecV1,
  mutationId = "mutation.cross",
  summary = "A hidden plan changed your available position.",
): B0StructuredResultV1 {
  return {
    resultId: "result.cross",
    resultKind: "CROSS_PLAYER_IMPACT",
    originIntentIds: [intentId],
    originActorIds: [originActorId],
    targetActorIds: [targetActorId],
    summary,
    durableMutationIds: [mutationId],
    audience,
  };
}

test("C5 PRIVATE direct target receives one idempotent targeted result without unrelated actors", () => {
  const source = action("intent.a", "actor.a", "actor.b", { type: "PRIVATE", declaredRecipientRefs: ["actor.b"] });
  const change = mutation("mutation.cross", source.id);
  const result = crossResult(source.id, source.actorId, "actor.b", { type: "DIRECT_TARGETS", originIntentId: source.id });
  const plan = buildB0PublicationPlanV1({ snapshot: snapshot(), resolution: resolution([source], [result], [change]), intents: [source] });
  assert.equal(plan.deliveries.length, 1);
  assert.equal(plan.deliveries[0].recipientActorId, "actor.b");
  assert.equal(plan.deliveries[0].visibility, "TARGETED");
  assert.equal(plan.deliveries[0].sourceDisclosure, "FULL");
  assert.equal(plan.deliveries[0].idempotencyKey, "b0-publication:batch.c5:result.cross:actor.b");
  assert.ok(!plan.deliveries.some((entry) => entry.recipientActorId === "actor.c"));
});

test("C5 PRIVATE NPC is a legal audience member even without a player role binding", () => {
  const source = action("intent.a", "actor.a", "npc.x", { type: "PRIVATE", declaredRecipientRefs: ["npc.x"] });
  const change = mutation("mutation.cross", source.id, "ACTOR", "npc.x");
  const result = crossResult(source.id, source.actorId, "npc.x", { type: "DIRECT_TARGETS", originIntentId: source.id });
  const plan = buildB0PublicationPlanV1({ snapshot: snapshot(), resolution: resolution([source], [result], [change]), intents: [source] });
  assert.deepEqual(plan.deliveries.map((entry) => entry.recipientActorId), ["npc.x"]);
});

test("C5 an undetected covert action cannot notify its potential target", () => {
  const source = action("intent.a", "actor.a", "actor.b", { type: "COVERT" });
  const change = mutation("mutation.cross", source.id);
  const result = crossResult(source.id, source.actorId, "actor.b", { type: "DIRECT_TARGETS", originIntentId: source.id });
  assert.throws(
    () => buildB0PublicationPlanV1({ snapshot: snapshot(), resolution: resolution([source], [result], [change]), intents: [source] }),
    (error: any) => error instanceof B0AudienceErrorV1 && error.code === "UNDISCOVERED_SECRET_RECIPIENT",
  );
});

test("C5 a detected covert impact reaches the target while hiding its source", () => {
  const source = action("intent.a", "actor.a", "actor.b", { type: "COVERT" });
  const change = mutation("mutation.cross", source.id);
  const result = crossResult(source.id, source.actorId, "actor.b", { type: "DIRECT_TARGETS", originIntentId: source.id });
  const plan = buildB0PublicationPlanV1({
    snapshot: snapshot(),
    resolution: resolution([source], [result], [change]),
    intents: [source],
    maps: { detectedIntentActors: { [source.id]: ["actor.b"] } },
  });
  assert.equal(plan.deliveries[0].sourceDisclosure, "HIDDEN");
  assert.deepEqual(plan.deliveries[0].originActorIds, []);
  assert.deepEqual(plan.deliveries[0].targetActorIds, ["actor.b"]);
});

test("C5 observable trace delivers only to declared observers with TRACE_ONLY disclosure", () => {
  const source = action("intent.a", "actor.a", "actor.b", { type: "COVERT" });
  const result: B0StructuredResultV1 = {
    resultId: "trace.one",
    resultKind: "OBSERVABLE_TRACE",
    originIntentIds: [source.id],
    originActorIds: [source.actorId],
    targetActorIds: ["actor.c"],
    summary: "You notice a bounded trace of activity, but not who caused it.",
    durableMutationIds: [],
    audience: { type: "OBSERVERS_OF_TRACE", traceId: "trace.one" },
  };
  const plan = buildB0PublicationPlanV1({
    snapshot: snapshot(),
    resolution: resolution([source], [result], [], [semanticEdge("batch.c5", source.id, "TRACE", result.resultId)]),
    intents: [source],
    maps: { traceObservers: { "trace.one": ["actor.c"] } },
  });
  assert.deepEqual(plan.deliveries.map((entry) => entry.recipientActorId), ["actor.c"]);
  assert.equal(plan.deliveries[0].visibility, "TRACE");
  assert.equal(plan.deliveries[0].sourceDisclosure, "TRACE_ONLY");
  assert.deepEqual(plan.deliveries[0].originActorIds, []);
});

test("C5 RELATION_PARTICIPANTS resolves only the two actual intent actors", () => {
  const left = action("intent.a", "actor.a", "actor.b", { type: "PUBLIC" });
  const right = action("intent.b", "actor.b", "actor.a", { type: "PUBLIC" });
  const rel = relation("relation.ab", left.id, right.id);
  const result: B0StructuredResultV1 = {
    resultId: "knowledge.ab",
    resultKind: "KNOWLEDGE_GRANT",
    originIntentIds: [left.id],
    originActorIds: [left.actorId],
    targetActorIds: ["actor.a", "actor.b"],
    summary: "The two relation participants gain bounded knowledge.",
    durableMutationIds: [],
    audience: { type: "RELATION_PARTICIPANTS", relationId: rel.id },
  };
  const plan = buildB0PublicationPlanV1({
    snapshot: snapshot(),
    resolution: resolution([left, right], [result], [], [semanticEdge("batch.c5", left.id, "KNOWLEDGE_GRANT", result.resultId)], [rel]),
    intents: [left, right],
  });
  assert.deepEqual(plan.deliveries.map((entry) => entry.recipientActorId), ["actor.a", "actor.b"]);
  assert.ok(!plan.deliveries.some((entry) => entry.recipientActorId === "actor.c"));
});

test("C5 ROLE_SET and CONDITION_BASED fail closed when their authoritative maps are absent", () => {
  const source = action("intent.a", "actor.a", "actor.b", { type: "PUBLIC" });
  const base = resolution([source], [], [], []);
  const input = { snapshot: snapshot(), resolution: base, intents: [source] };
  assert.throws(() => resolveB0TypedAudienceV1({ type: "ROLE_SET", roleSetId: "missing" }, input), /No recipients are defined/);
  assert.throws(() => resolveB0TypedAudienceV1({ type: "CONDITION_BASED", conditionId: "missing" }, input), /No recipients are defined/);
});

test("C5 PUBLIC world event reaches the whole snapshot actor set without revealing covert sources", () => {
  const source = action("intent.a", "actor.a", "actor.b", { type: "COVERT" });
  const change = mutation("mutation.world", source.id, "WORLD", "world.c5");
  const result: B0StructuredResultV1 = {
    resultId: "world.event.one",
    resultKind: "WORLD_EVENT",
    originIntentIds: [source.id],
    originActorIds: [source.actorId],
    targetActorIds: [],
    summary: "The shared situation changes in a way every participant can observe.",
    durableMutationIds: [change.mutationId],
    audience: { type: "PUBLIC" },
  };
  const plan = buildB0PublicationPlanV1({
    snapshot: snapshot(),
    resolution: resolution([source], [result], [change], [semanticEdge("batch.c5", source.id, "WORLD_EVENT", result.resultId)]),
    intents: [source],
  });
  assert.deepEqual(plan.deliveries.map((entry) => entry.recipientActorId), actorIds);
  assert.equal(plan.deliveries.find((entry) => entry.recipientActorId === "actor.a")?.sourceDisclosure, "FULL");
  assert.ok(plan.deliveries.filter((entry) => entry.recipientActorId !== "actor.a").every((entry) => entry.sourceDisclosure === "HIDDEN"));
});

test("C5 legacy affectedActorIds cannot bypass typed audience validation", () => {
  const source = action("intent.a", "actor.a", "actor.b", { type: "PRIVATE", declaredRecipientRefs: ["actor.b"] });
  const change = mutation("mutation.cross", source.id);
  const result = {
    ...crossResult(source.id, source.actorId, "actor.b", { type: "DIRECT_TARGETS", originIntentId: source.id }),
    affectedActorIds: ["actor.c"],
  } as B0StructuredResultV1;
  assert.throws(
    () => buildB0PublicationPlanV1({ snapshot: snapshot(), resolution: resolution([source], [result], [change]), intents: [source] }),
    (error: any) => error instanceof B0AudienceErrorV1 && error.code === "LEGACY_AUDIENCE_BYPASS",
  );
});

test("C5 cross-player impact cannot point only back to the source actor", () => {
  const source = action("intent.a", "actor.a", "actor.a", { type: "PRIVATE", declaredRecipientRefs: ["actor.a"] });
  const change = mutation("mutation.cross", source.id, "ACTOR", "actor.a");
  const result = crossResult(source.id, source.actorId, "actor.a", { type: "ACTOR_ONLY", actorRef: "actor.a" });
  assert.throws(() => buildB0PublicationPlanV1({ snapshot: snapshot(), resolution: resolution([source], [result], [change]), intents: [source] }), /cross-player|different actor|valid cross-player/i);
});

test("C5 Personal, Cross-player and World results cannot reuse one mutation as three fake echoes", () => {
  const source = action("intent.a", "actor.a", "actor.b", { type: "PUBLIC" });
  const shared = mutation("mutation.shared", source.id);
  const personal: B0StructuredResultV1 = {
    resultId: "result.personal",
    resultKind: "PERSONAL_OUTCOME",
    originIntentIds: [source.id],
    originActorIds: [source.actorId],
    targetActorIds: [source.actorId],
    summary: "Your own bounded result is available.",
    durableMutationIds: [shared.mutationId],
    audience: { type: "ACTOR_ONLY", actorRef: source.actorId },
  };
  const cross = crossResult(source.id, source.actorId, "actor.b", { type: "DIRECT_TARGETS", originIntentId: source.id }, shared.mutationId);
  const world: B0StructuredResultV1 = {
    resultId: "result.world",
    resultKind: "WORLD_EVENT",
    originIntentIds: [source.id],
    originActorIds: [source.actorId],
    targetActorIds: [],
    summary: "A public change is visible.",
    durableMutationIds: [shared.mutationId],
    audience: { type: "PUBLIC" },
  };
  const edges = [semanticEdge("batch.c5", source.id, "WORLD_EVENT", world.resultId)];
  assert.throws(
    () => buildB0PublicationPlanV1({ snapshot: snapshot(), resolution: resolution([source], [personal, cross, world], [shared], edges), intents: [source] }),
    (error: any) => error instanceof B0AudienceErrorV1 && error.code === "RESULT_CAUSAL_SOURCE_REUSED",
  );
});

test("C5 hidden-source summaries cannot name the source actor or role label", () => {
  const source = action("intent.a", "actor.a", "actor.b", { type: "COVERT" });
  const change = mutation("mutation.cross", source.id);
  const result = crossResult(source.id, source.actorId, "actor.b", { type: "DIRECT_TARGETS", originIntentId: source.id }, change.mutationId, "Alpha changed your position.");
  assert.throws(
    () => buildB0PublicationPlanV1({
      snapshot: snapshot(),
      resolution: resolution([source], [result], [change]),
      intents: [source],
      maps: { detectedIntentActors: { [source.id]: ["actor.b"] } },
    }),
    (error: any) => error instanceof B0AudienceErrorV1 && error.code === "PRIVATE_SUMMARY_SOURCE_LEAK",
  );
});

test("C5 publication plan hashes and recipient outbox keys are deterministic", () => {
  const source = action("intent.a", "actor.a", "actor.b", { type: "PRIVATE", declaredRecipientRefs: ["actor.b"] });
  const change = mutation("mutation.cross", source.id);
  const result = crossResult(source.id, source.actorId, "actor.b", { type: "DIRECT_TARGETS", originIntentId: source.id });
  const input = { snapshot: snapshot(), resolution: resolution([source], [result], [change]), intents: [source] };
  const first = buildB0PublicationPlanV1(input);
  const second = buildB0PublicationPlanV1(input);
  assert.deepEqual(first, second);
  assert.match(first.planHash, /^[a-f0-9]{64}$/);
  assert.equal(new Set(first.deliveries.map((entry) => entry.idempotencyKey)).size, first.deliveries.length);
});
