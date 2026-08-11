import assert from "node:assert/strict";
import test from "node:test";
import {
  validateB0BatchCommitManifestV1,
  type B0ActionContractV1,
} from "@ai-story/shared";
import {
  buildB0BatchCommitManifestV1,
  captureB0SettlementSnapshotV1,
  computeB0BatchInputHashV1,
  hashResolutionPayload,
  prepareB0SettlementBatchV1,
  settleB0BatchV1,
  settleB0SingleIntentV1,
} from "../src/runtime-contract/b0-batch-settlement";
import { validAction, windowedRuleset } from "./b0-settlement.fixtures";

function snapshot() {
  return captureB0SettlementSnapshotV1({
    id: "snapshot.c2",
    windowId: "window.1",
    roomId: "room.1",
    runId: "run.1",
    baseWorldSequence: 7,
    ruleset: windowedRuleset(),
    worldState: { phase: "open", sequence: 7 },
    actorStates: [{ actorId: "actor.a" }, { actorId: "actor.b" }],
    roleBindings: [{ actorId: "actor.a", roleId: "role.a" }, { actorId: "actor.b", roleId: "role.b" }],
    knowledgeState: { actor: "actor.a", facts: [] },
    relationshipState: { edges: [] },
    resourceState: { resources: [{ id: "resource.a", quantity: 2 }] },
    activeCapabilities: [],
    createdAt: "2026-08-06T00:05:00.000Z",
  });
}

function lockedAction(resourceAmount = 0): B0ActionContractV1 {
  return {
    ...validAction(),
    id: "intent.c2",
    status: "LOCKED",
    resourceCommitments: resourceAmount > 0 ? [{ resourceId: "resource.a", amount: resourceAmount }] : [],
  };
}

test("C2 captures a detached immutable snapshot with canonical hashes", () => {
  const state = { phase: "open", sequence: 7 };
  const captured = captureB0SettlementSnapshotV1({
    id: "snapshot.c2", windowId: "window.1", roomId: "room.1", runId: "run.1",
    baseWorldSequence: 7, ruleset: windowedRuleset(), worldState: state,
    actorStates: [{ actorId: "actor.a" }], roleBindings: [], knowledgeState: {},
    relationshipState: {}, resourceState: {}, activeCapabilities: [],
    createdAt: "2026-08-06T00:05:00.000Z",
  });
  state.phase = "changed-after-capture";
  assert.deepEqual(captured.worldState, { phase: "open", sequence: 7 });
  assert.equal(Object.isFrozen(captured), true);
  assert.match(captured.worldStateHash, /^[a-f0-9]{64}$/);
  assert.match(captured.rulesetHash, /^[a-f0-9]{64}$/);
});

test("C2 prepares one immutable batch and binds the exact input hash", () => {
  const snap = snapshot();
  const intent = lockedAction();
  const batch = prepareB0SettlementBatchV1({
    id: "batch.c2", snapshot: snap, intents: [intent], createdAt: "2026-08-06T00:05:01.000Z",
  });
  assert.equal(batch.inputHash, computeB0BatchInputHashV1({ snapshot: snap, intents: [intent] }));
  assert.deepEqual(batch.lockedIntentIds, [intent.id]);
  assert.equal(Object.isFrozen(batch), true);
});

test("C2 single-intent adapter and batch entry produce the same deterministic resolution", () => {
  const snap = snapshot();
  const intent = lockedAction(1);
  const batch = prepareB0SettlementBatchV1({
    id: "batch.c2", snapshot: snap, intents: [intent], createdAt: "2026-08-06T00:05:01.000Z",
  });
  const throughBatch = settleB0BatchV1({ ruleset: windowedRuleset(), snapshot: snap, batch, intents: [intent] });
  const throughAdapter = settleB0SingleIntentV1({
    batchId: "batch.c2", ruleset: windowedRuleset(), snapshot: snap, intent,
    createdAt: "2026-08-06T00:05:01.000Z",
  });
  assert.deepEqual(throughBatch, throughAdapter);
  assert.equal(throughBatch.resolutionHash, hashResolutionPayload(throughBatch));
  assert.equal(throughBatch.worldDelta.mutations.length, 1);
  assert.deepEqual(throughBatch.worldDelta.mutations[0].value, -1);
});

test("C2 rejects unsealed inputs and context drift while C4 accepts a shared multi-intent batch", () => {
  const snap = snapshot(); const intent = lockedAction();
  const batch = prepareB0SettlementBatchV1({ id: "batch.c2", snapshot: snap, intents: [intent], createdAt: "2026-08-06T00:05:01.000Z" });
  assert.throws(() => settleB0BatchV1({ ruleset: windowedRuleset(), snapshot: snap, batch: { ...batch, inputHash: "0".repeat(64) }, intents: [intent] }), /BATCH_INPUT_HASH_MISMATCH|immutable hash/);
  assert.throws(() => settleB0BatchV1({ ruleset: windowedRuleset(), snapshot: snap, batch, intents: [{ ...intent, status: "CONFIRMED" }] }), /not locked/);
  const second = { ...intent, id: "intent.second", actorId: "actor.b", clientRequestId: "client.second", resourceCommitments: [] };
  const two = prepareB0SettlementBatchV1({ id: "batch.two", snapshot: snap, intents: [intent, second], createdAt: "2026-08-06T00:05:01.000Z" });
  const resolution = settleB0BatchV1({ ruleset: windowedRuleset(), snapshot: snap, batch: two, intents: [intent, second] });
  assert.equal(resolution.intentOutcomes.length, 2);
  assert.deepEqual(resolution.conflictGroups[0].intentIds, ["intent.c2", "intent.second"]);
});

test("C2 commit manifest binds snapshot, input, resolution and one sequence advance", () => {
  const snap = snapshot(); const intent = lockedAction(1);
  const batch = prepareB0SettlementBatchV1({ id: "batch.c2", snapshot: snap, intents: [intent], createdAt: "2026-08-06T00:05:01.000Z" });
  const resolution = settleB0BatchV1({ ruleset: windowedRuleset(), snapshot: snap, batch, intents: [intent] });
  const manifest = buildB0BatchCommitManifestV1({
    batch, snapshot: snap, resolution, committedAt: "2026-08-06T00:05:02.000Z",
    resourceMutationKeys: ["b0-resource:batch.c2:one"],
    publicationOutboxKeys: ["b0-publication:batch.c2"],
  });
  assert.equal(validateB0BatchCommitManifestV1(manifest).ok, true);
  assert.equal(manifest.baseWorldSequence, 7);
  assert.equal(manifest.committedWorldSequence, 8);
  assert.match(manifest.commitHash, /^[a-f0-9]{64}$/);
});
