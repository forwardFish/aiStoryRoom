import assert from "node:assert/strict";
import test from "node:test";
import type {
  B0ActionContractV1,
  B0BatchCommitManifestV1,
  B0SettlementBatchV1,
  B0SettlementResolutionV1,
  B0SettlementSnapshotV1,
  B0StateMutationV1,
} from "@ai-story/shared";
import {
  captureB0SettlementSnapshotV1,
  createB0RoomRulesetV1,
  hashCanonicalB0Value,
  prepareB0SettlementBatchV1,
  settleB0BatchV1,
} from "@ai-story/templates";
import {
  B0CommitErrorV1,
  commitB0SettlementV1,
  type B0CommitContextV1,
  type B0CommitInputV1,
  type B0CommitTransactionV1,
} from "./b0-settlement-commit.core";

function fixture() {
  const ruleset = createB0RoomRulesetV1({
    rulesetVersion: "b0-rules-v1", settlementMode: "IMMEDIATE", totalWindows: 6,
    windowDurationSeconds: 1, maxHumanPlayers: 1,
  });
  const snapshot = captureB0SettlementSnapshotV1({
    id: "snapshot.c2", windowId: "window.c2", roomId: "run.c2", runId: "run.c2",
    baseWorldSequence: 7, ruleset, worldState: { sequence: 7 },
    actorStates: [{ actorId: "actor.a" }], roleBindings: [{ actorId: "actor.a", roleId: "role.a" }],
    knowledgeState: {}, relationshipState: {}, resourceState: { resources: [{ id: "resource.a", quantity: 2 }] },
    activeCapabilities: [], createdAt: "2026-08-06T00:00:00.000Z",
  });
  const intent: B0ActionContractV1 = {
    schemaVersion: "b0-action-contract-v1", id: "action.c2", windowId: "window.c2",
    roomId: "run.c2", runId: "run.c2", actorId: "actor.a", baseWorldSequence: 7,
    revision: 1, kind: "ACT", rawPlayerText: "Commit one bounded action.",
    normalizedSummary: "Commit one bounded action.", targetRefs: [{ type: "RESOURCE", id: "resource.a" }],
    primaryEffect: { effectTypeId: "resource.use", direction: "DECREASE", requestedMagnitude: "MINOR" },
    method: { methodTypeId: "method.bounded", description: "Use one owned resource." },
    resourceCommitments: [{ resourceId: "resource.a", amount: 1 }], evidenceRefs: [], capabilityRefs: [],
    propositionRefs: [], visibilityIntent: { type: "PRIVATE", declaredRecipientRefs: ["actor.a"] },
    reactionPolicy: "NONE", requestedTiming: "CURRENT_WINDOW", riskTags: [],
    compilerVersion: "compiler.v1", validationVersion: "validator.v1", clientRequestId: "client.c2",
    status: "LOCKED", createdAt: "2026-08-06T00:00:00.000Z", updatedAt: "2026-08-06T00:00:00.000Z",
    confirmedAt: "2026-08-06T00:00:00.000Z", lockedAt: "2026-08-06T00:00:00.000Z",
  };
  const batch = prepareB0SettlementBatchV1({
    id: "batch.c2", snapshot, intents: [intent], createdAt: "2026-08-06T00:00:01.000Z",
  });
  const resolution = settleB0BatchV1({ ruleset, snapshot, batch, intents: [intent] });
  return { snapshot, batch, resolution };
}

class MemoryCommitTx implements B0CommitTransactionV1 {
  worldSequence = 7;
  resourceQuantity = 2;
  manifest: B0BatchCommitManifestV1 | null = null;
  readonly applied = new Set<string>();
  readonly appliedState = new Map<string, B0StateMutationV1>();
  readonly outbox = new Set<string>();
  applyCount = 0;
  stateApplyCount = 0;
  persistCount = 0;

  async readContext(input: B0CommitInputV1): Promise<B0CommitContextV1> {
    return { roomId: input.batch.roomId, runId: input.batch.runId, windowId: input.batch.windowId, nodeId: "node.c2", currentWorldSequence: this.worldSequence };
  }
  async readManifest(_batchId: string, _windowId: string): Promise<B0BatchCommitManifestV1 | null> { return this.manifest; }
  async applyResourceMutation(input: { batch: B0SettlementBatchV1; mutation: B0StateMutationV1 }): Promise<string> {
    const key = `b0-resource:${input.batch.id}:${input.mutation.mutationId}`;
    if (!this.applied.has(key)) {
      this.resourceQuantity += Number(input.mutation.value);
      if (this.resourceQuantity < 0) throw new B0CommitErrorV1("INTENT_RESOURCE_INSUFFICIENT", "negative resource");
      this.applied.add(key); this.applyCount += 1;
    }
    return key;
  }
  async applyStateMutation(input: { batch: B0SettlementBatchV1; mutation: B0StateMutationV1 }): Promise<string> {
    const key = `b0:mutation:${input.batch.id}:${input.mutation.mutationId}`;
    const existing = this.appliedState.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(input.mutation)) {
      throw new B0CommitErrorV1("STATE_MUTATION_CONFLICT", "state mutation replay drift");
    }
    if (!existing) {
      this.appliedState.set(key, structuredClone(input.mutation));
      this.stateApplyCount += 1;
    }
    return key;
  }
  async advanceWorldSequence(input: { runId: string; expected: number; next: number }): Promise<boolean> {
    if (input.runId !== "run.c2" || this.worldSequence !== input.expected) return false;
    this.worldSequence = input.next; return true;
  }
  async enqueuePublication(input: {
    context: B0CommitContextV1;
    batch: B0SettlementBatchV1;
    resolution: B0SettlementResolutionV1;
    outboxKey: string;
  }): Promise<void> { this.outbox.add(input.outboxKey); }
  async persistCommit(input: {
    context: B0CommitContextV1;
    batch: B0SettlementBatchV1;
    snapshot: B0SettlementSnapshotV1;
    resolution: B0SettlementResolutionV1;
    manifest: B0BatchCommitManifestV1;
  }): Promise<void> { this.manifest = input.manifest; this.persistCount += 1; }
}

function commitInput(f: ReturnType<typeof fixture>): B0CommitInputV1 {
  return { ...f, committedAt: "2026-08-06T00:00:02.000Z" };
}

function rehash(resolution: B0SettlementResolutionV1): B0SettlementResolutionV1 {
  const { resolutionHash: _ignored, ...payload } = resolution;
  return { ...payload, resolutionHash: hashCanonicalB0Value(payload) };
}

test("C2 replay commits world sequence, resource and outbox exactly once", async () => {
  const f = fixture(); const tx = new MemoryCommitTx();
  const first = await commitB0SettlementV1(tx, commitInput(f));
  assert.equal(first.status, "COMMITTED");
  for (let index = 0; index < 10; index += 1) {
    const replay = await commitB0SettlementV1(tx, commitInput(f));
    assert.equal(replay.status, "ALREADY_COMMITTED");
    assert.equal(replay.manifest.commitHash, first.manifest.commitHash);
  }
  assert.equal(tx.worldSequence, 8);
  assert.equal(tx.resourceQuantity, 1);
  assert.equal(tx.applyCount, 1);
  assert.equal(tx.outbox.size, 1);
  assert.equal(tx.persistCount, 1);
});

test("C2 existing commit rejects a different resolution hash", async () => {
  const f = fixture(); const tx = new MemoryCommitTx();
  await commitB0SettlementV1(tx, commitInput(f));
  const changed = rehash({
    ...f.resolution,
    intentOutcomes: [{ ...f.resolution.intentOutcomes[0], summary: "changed" }],
  });
  await assert.rejects(() => commitB0SettlementV1(tx, { ...commitInput(f), resolution: changed }), (error: any) => error?.code === "BATCH_COMMIT_HASH_MISMATCH");
  assert.equal(tx.worldSequence, 8);
  assert.equal(tx.resourceQuantity, 1);
});

test("C2 stale world sequence fails closed without durable side effects", async () => {
  const f = fixture(); const tx = new MemoryCommitTx(); tx.worldSequence = 8;
  await assert.rejects(() => commitB0SettlementV1(tx, commitInput(f)), (error: any) => error?.code === "WORLD_SEQUENCE_MISMATCH");
  assert.equal(tx.resourceQuantity, 2);
  assert.equal(tx.applyCount, 0);
  assert.equal(tx.stateApplyCount, 0);
  assert.equal(tx.outbox.size, 0);
  assert.equal(tx.manifest, null);
});

test("C4 commits the complete merged WorldDelta in the same manifest and transaction", async () => {
  const f = fixture(); const tx = new MemoryCommitTx();
  const mutation: B0StateMutationV1 = {
    mutationId: "mutation.world", entityType: "WORLD", entityId: "world.c2", attribute: "state",
    operation: "SET", value: "changed", originIntentIds: ["action.c2"],
  };
  const resolution = rehash({
    ...f.resolution,
    worldDelta: { mutations: [...f.resolution.worldDelta.mutations, mutation] },
    structuredResults: f.resolution.structuredResults.map((entry) => ({
      ...entry,
      durableMutationIds: [...entry.durableMutationIds, mutation.mutationId].sort(),
    })),
  });
  const committed = await commitB0SettlementV1(tx, { ...commitInput(f), resolution });
  assert.equal(committed.status, "COMMITTED");
  assert.equal(tx.worldSequence, 8);
  assert.equal(tx.resourceQuantity, 1);
  assert.equal(tx.applyCount, 1);
  assert.equal(tx.stateApplyCount, 1);
  assert.ok(committed.manifest.stateMutationKeys?.includes("b0:mutation:batch.c2:mutation.world"));
  assert.equal(committed.manifest.stateMutationKeys?.length, 1);
  assert.equal(committed.manifest.resourceMutationKeys.length, 1);
  assert.equal(committed.manifest.publicationOutboxKeys.length, 1);
});

test("C4 generic mutation replay remains idempotent after the commit manifest exists", async () => {
  const f = fixture(); const tx = new MemoryCommitTx();
  const mutation: B0StateMutationV1 = {
    mutationId: "mutation.relation", entityType: "RELATION", entityId: "relation.c2", attribute: "trust",
    operation: "INCREMENT", value: 1, originIntentIds: ["action.c2"],
  };
  const resolution = rehash({
    ...f.resolution,
    worldDelta: { mutations: [mutation] },
    structuredResults: f.resolution.structuredResults.map((entry) => ({
      ...entry,
      durableMutationIds: [mutation.mutationId],
    })),
    causalEdges: [
      ...f.resolution.causalEdges.filter((edge) => edge.to.type !== "MUTATION"),
      {
        schemaVersion: "b0-causal-edge-v1" as const,
        id: "edge.relation",
        batchId: f.resolution.batchId,
        from: { type: "INTENT" as const, id: "action.c2" },
        to: { type: "MUTATION" as const, id: mutation.mutationId },
        relation: "CAUSED" as const,
      },
    ],
  });
  const input = { ...commitInput(f), resolution };
  await commitB0SettlementV1(tx, input);
  for (let index = 0; index < 5; index += 1) {
    assert.equal((await commitB0SettlementV1(tx, input)).status, "ALREADY_COMMITTED");
  }
  assert.equal(tx.worldSequence, 8);
  assert.equal(tx.stateApplyCount, 1);
  assert.equal(tx.outbox.size, 1);
  assert.equal(tx.persistCount, 1);
});

test("C4 rejects a state mutation without a causal origin before advancing sequence", async () => {
  const f = fixture(); const tx = new MemoryCommitTx();
  const mutation: B0StateMutationV1 = {
    mutationId: "mutation.invalid", entityType: "WORLD", entityId: "world.c2", attribute: "state",
    operation: "SET", value: "changed", originIntentIds: [],
  };
  const resolution = rehash({
    ...f.resolution,
    worldDelta: { mutations: [mutation] },
    structuredResults: f.resolution.structuredResults.map((entry) => ({
      ...entry,
      durableMutationIds: [mutation.mutationId],
    })),
    causalEdges: [
      ...f.resolution.causalEdges.filter((edge) => edge.to.type !== "MUTATION"),
      {
        schemaVersion: "b0-causal-edge-v1" as const,
        id: "edge.relation",
        batchId: f.resolution.batchId,
        from: { type: "INTENT" as const, id: "action.c2" },
        to: { type: "MUTATION" as const, id: mutation.mutationId },
        relation: "CAUSED" as const,
      },
    ],
  });
  await assert.rejects(() => commitB0SettlementV1(tx, { ...commitInput(f), resolution }), (error: any) =>
    error?.code === "STATE_MUTATION_INVALID" || error?.code === "RESOLUTION_VALIDATION_FAILED");
  assert.equal(tx.worldSequence, 7);
  assert.equal(tx.stateApplyCount, 0);
  assert.equal(tx.persistCount, 0);
});
