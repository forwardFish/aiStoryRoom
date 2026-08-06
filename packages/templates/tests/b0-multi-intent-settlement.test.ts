import assert from "node:assert/strict";
import test from "node:test";
import type { B0ActionContractV1 } from "@ai-story/shared";
import {
  captureB0SettlementSnapshotV1,
  mergeB0WorldDeltaV1,
  prepareB0SettlementBatchV1,
  settleB0BatchConservativelyV1,
  settleB0BatchV1,
} from "../src/runtime-contract/b0-batch-settlement";
import { createB0RoomRulesetV1 } from "../src/runtime-contract/b0-settlement";

const ruleset = createB0RoomRulesetV1({
  rulesetVersion: "b0-c4-v1",
  settlementMode: "WINDOWED",
  totalWindows: 6,
  windowDurationSeconds: 300,
  maxHumanPlayers: 5,
});

function snapshot(resourceQuantity = 3) {
  return captureB0SettlementSnapshotV1({
    id: "snapshot.c4",
    windowId: "window.c4",
    roomId: "run.c4",
    runId: "run.c4",
    baseWorldSequence: 11,
    ruleset,
    worldState: {
      propositions: [{ id: "proposition.shared" }, { id: "proposition.independent" }],
      locations: [{ id: "location.one" }],
      groups: [{ id: "group.one" }],
    },
    actorStates: ["a", "b", "c"].map((id) => ({ actorId: `actor.${id}`, roleId: `role.${id}` })),
    roleBindings: ["a", "b", "c"].map((id) => ({ actorId: `actor.${id}`, roleId: `role.${id}` })),
    knowledgeState: {
      byActor: {
        "actor.a": { evidenceIds: ["evidence.a"], propositionIds: ["proposition.shared"] },
        "actor.b": { evidenceIds: ["evidence.b"], propositionIds: ["proposition.shared"] },
        "actor.c": { evidenceIds: ["evidence.c"], propositionIds: ["proposition.shared"] },
      },
    },
    relationshipState: { edges: [] },
    resourceState: {
      resources: ["a", "b", "c"].map((id) => ({
        id: `resource.${id}`,
        ownerActorId: `actor.${id}`,
        quantity: resourceQuantity,
      })),
    },
    activeCapabilities: ["a", "b", "c"].map((id) => ({
      capabilityId: `capability.${id}`,
      ownerActorId: `actor.${id}`,
      active: true,
    })),
    createdAt: "2026-08-06T00:05:00.000Z",
  });
}

function intent(id: "a" | "b" | "c", direction: "INCREASE" | "DECREASE"): B0ActionContractV1 {
  return {
    schemaVersion: "b0-action-contract-v1",
    id: `intent.${id}`,
    windowId: "window.c4",
    roomId: "run.c4",
    runId: "run.c4",
    actorId: `actor.${id}`,
    baseWorldSequence: 11,
    revision: 1,
    kind: "ACT",
    rawPlayerText: `Action ${id}`,
    normalizedSummary: `Bounded action ${id}.`,
    targetRefs: [{ type: "PROPOSITION", id: "proposition.shared" }],
    primaryEffect: { effectTypeId: "stance.influence", direction, requestedMagnitude: "MODERATE" },
    method: { methodTypeId: `method.${id}`, description: `Method ${id}.` },
    resourceCommitments: [{ resourceId: `resource.${id}`, amount: 1 }],
    evidenceRefs: id === "c" ? [] : [`evidence.${id}`],
    capabilityRefs: [`capability.${id}`],
    propositionRefs: ["proposition.shared"],
    visibilityIntent: { type: "PRIVATE", declaredRecipientRefs: [`actor.${id}`] },
    reactionPolicy: "NONE",
    requestedTiming: "CURRENT_WINDOW",
    riskTags: [],
    compilerVersion: "compiler.v1",
    validationVersion: "validator.v1",
    clientRequestId: `request.${id}`,
    status: "LOCKED",
    createdAt: `2026-08-06T00:0${id === "a" ? 1 : id === "b" ? 2 : 3}:00.000Z`,
    updatedAt: `2026-08-06T00:0${id === "a" ? 1 : id === "b" ? 2 : 3}:10.000Z`,
    confirmedAt: "2026-08-06T00:04:00.000Z",
    lockedAt: "2026-08-06T00:05:00.000Z",
  };
}

function settle(intents: B0ActionContractV1[]) {
  const captured = snapshot();
  const batch = prepareB0SettlementBatchV1({
    id: "batch.c4",
    snapshot: captured,
    intents,
    createdAt: "2026-08-06T00:05:01.000Z",
  });
  return settleB0BatchV1({ ruleset, snapshot: captured, batch, intents });
}

test("C4 input permutations produce one identical authoritative resolution", () => {
  const a = intent("a", "INCREASE");
  const b = intent("b", "DECREASE");
  const c = intent("c", "INCREASE");
  const first = settle([a, b, c]);
  const second = settle([b, c, a]);
  const third = settle([c, a, b]);
  assert.equal(first.resolutionHash, second.resolutionHash);
  assert.equal(first.resolutionHash, third.resolutionHash);
  assert.deepEqual(first, second);
  assert.deepEqual(first, third);
});

test("C4 builds SUPPORTS and CONFLICTS edges in one conflict group", () => {
  const resolution = settle([intent("a", "INCREASE"), intent("b", "DECREASE"), intent("c", "INCREASE")]);
  assert.equal(resolution.conflictGroups.length, 1);
  assert.deepEqual(resolution.conflictGroups[0].intentIds, ["intent.a", "intent.b", "intent.c"]);
  const relation = new Map(resolution.intentRelations.map((entry) => [`${entry.leftIntentId}|${entry.rightIntentId}`, entry.type]));
  assert.equal(relation.get("intent.a|intent.b"), "CONFLICTS");
  assert.equal(relation.get("intent.a|intent.c"), "SUPPORTS");
  assert.equal(relation.get("intent.b|intent.c"), "CONFLICTS");
  const outcome = new Map(resolution.intentOutcomes.map((entry) => [entry.intentId, entry.status]));
  assert.equal(outcome.get("intent.a"), "SUCCESS");
  assert.equal(outcome.get("intent.c"), "SUCCESS");
  assert.equal(outcome.get("intent.b"), "BLOCKED");
});

test("C4 merges supporters into one durable effect while preserving every origin", () => {
  const resolution = settle([intent("a", "INCREASE"), intent("b", "DECREASE"), intent("c", "INCREASE")]);
  const effect = resolution.worldDelta.mutations.find((entry) => entry.attribute === "effect.stance.influence");
  assert.ok(effect);
  assert.equal(effect?.operation, "INCREMENT");
  assert.equal(effect?.value, 4);
  assert.deepEqual(effect?.originIntentIds, ["intent.a", "intent.c"]);
  assert.equal(resolution.worldDelta.mutations.filter((entry) => entry.entityType === "RESOURCE").length, 3);
});

test("C4 rejects duplicate actor intents, unknown targets and foreign capabilities", () => {
  const captured = snapshot();
  const a = intent("a", "INCREASE");
  const duplicate = { ...intent("b", "DECREASE"), id: "intent.a.second", actorId: "actor.a", capabilityRefs: ["capability.a"], resourceCommitments: [] };
  const duplicateBatch = prepareB0SettlementBatchV1({ id: "batch.duplicate", snapshot: captured, intents: [a, duplicate], createdAt: "2026-08-06T00:05:01.000Z" });
  assert.throws(() => settleB0BatchV1({ ruleset, snapshot: captured, batch: duplicateBatch, intents: [a, duplicate] }), /multiple primary intents/);

  const unknown = { ...intent("b", "DECREASE"), targetRefs: [{ type: "PROPOSITION" as const, id: "proposition.missing" }] };
  const unknownBatch = prepareB0SettlementBatchV1({ id: "batch.unknown", snapshot: captured, intents: [a, unknown], createdAt: "2026-08-06T00:05:01.000Z" });
  assert.throws(() => settleB0BatchV1({ ruleset, snapshot: captured, batch: unknownBatch, intents: [a, unknown] }), /unknown PROPOSITION/);

  const foreign = { ...intent("b", "DECREASE"), capabilityRefs: ["capability.a"] };
  const foreignBatch = prepareB0SettlementBatchV1({ id: "batch.foreign", snapshot: captured, intents: [a, foreign], createdAt: "2026-08-06T00:05:01.000Z" });
  assert.throws(() => settleB0BatchV1({ ruleset, snapshot: captured, batch: foreignBatch, intents: [a, foreign] }), /does not own capability/);
});

test("C4 validates aggregate resource demand before producing a delta", () => {
  const captured = snapshot(1);
  const a = intent("a", "INCREASE");
  const c = { ...intent("c", "INCREASE"), resourceCommitments: [{ resourceId: "resource.a", amount: 1 }], capabilityRefs: ["capability.c"] };
  const batch = prepareB0SettlementBatchV1({ id: "batch.resource", snapshot: captured, intents: [a, c], createdAt: "2026-08-06T00:05:01.000Z" });
  assert.throws(() => settleB0BatchV1({ ruleset, snapshot: captured, batch, intents: [a, c] }), /does not own resource|requires 2/);
});

test("C4 text length and submission timestamps do not create priority", () => {
  const a = intent("a", "INCREASE");
  const b = intent("b", "DECREASE");
  const c = intent("c", "INCREASE");
  const baseline = settle([a, b, c]);
  const changed = settle([
    { ...a, rawPlayerText: "A ".repeat(500), createdAt: "2099-01-01T00:00:00.000Z", updatedAt: "2099-01-01T00:00:01.000Z" },
    { ...b, rawPlayerText: "B", createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:01.000Z" },
    c,
  ]);
  assert.deepEqual(changed.intentOutcomes, baseline.intentOutcomes);
  assert.deepEqual(changed.worldDelta, baseline.worldDelta);
});

test("C4 conservative fallback keeps costs but commits no contested proactive effect", () => {
  const captured = snapshot();
  const intents = [intent("a", "INCREASE"), intent("b", "DECREASE")];
  const batch = prepareB0SettlementBatchV1({ id: "batch.fallback", snapshot: captured, intents, createdAt: "2026-08-06T00:05:01.000Z" });
  const resolution = settleB0BatchConservativelyV1({ ruleset, snapshot: captured, batch, intents });
  assert.ok(resolution.intentOutcomes.every((entry) => entry.status === "CONTESTED"));
  assert.ok(resolution.worldDelta.mutations.every((entry) => entry.entityType === "RESOURCE"));
});

test("C4 merge rejects incompatible SET values instead of depending on array order", () => {
  assert.throws(() => mergeB0WorldDeltaV1([
    { mutationId: "m.1", entityType: "WORLD", entityId: "world", attribute: "state", operation: "SET", value: "A", originIntentIds: ["intent.a"] },
    { mutationId: "m.2", entityType: "WORLD", entityId: "world", attribute: "state", operation: "SET", value: "B", originIntentIds: ["intent.b"] },
  ], "batch.conflict"), /incompatible values/);
});
