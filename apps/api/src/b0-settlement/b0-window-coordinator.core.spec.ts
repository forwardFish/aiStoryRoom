import assert from "node:assert/strict";
import test from "node:test";
import type { B0ActionContractV1, B0SettlementWindowV1 } from "@ai-story/shared";
import { createB0RoomRulesetV1 } from "@ai-story/templates";
import {
  B0WindowCoordinatorErrorV1,
  b0FreezeReasonV1,
  confirmB0DraftRevisionV1,
  createB0WindowConfigV1,
  freezeB0WindowV1,
  lockB0IntentForActorV1,
  projectB0WindowV1,
  saveB0DraftRevisionV1,
  type B0FreezeEnvelopeV1,
  type B0StoredIntentEnvelopeV1,
  type B0WindowFreezeStoreV1,
  type B0WindowStoreRecordV1,
  type B0WindowWorldCaptureV1,
} from "./b0-window-coordinator.core";

const ruleset = createB0RoomRulesetV1({
  rulesetVersion: "b0-window-v1",
  settlementMode: "WINDOWED",
  totalWindows: 6,
  windowDurationSeconds: 300,
  maxHumanPlayers: 3,
});

function config() {
  return createB0WindowConfigV1({
    situationId: "situation.one",
    ruleset,
    expectedActorIds: ["actor.a", "actor.b", "actor.c"],
    roleBindings: ["actor.a", "actor.b", "actor.c"].map((actorId) => ({
      actorId,
      roleId: actorId,
      controlEpoch: 1,
      controlMode: "HUMAN_ACTIVE" as const,
    })),
    createdAt: "2026-08-06T00:00:00.000Z",
  });
}

function window(status: B0SettlementWindowV1["status"] = "OPEN"): B0SettlementWindowV1 {
  return {
    schemaVersion: "b0-settlement-window-v1",
    id: "window.one",
    roomId: "run.one",
    runId: "run.one",
    mode: "WINDOWED",
    ordinal: 1,
    situationId: "situation.one",
    baseWorldSequence: 7,
    expectedActorIds: ["actor.a", "actor.b", "actor.c"],
    readyActorIds: [],
    openedAt: "2026-08-06T00:00:00.000Z",
    locksAt: "2026-08-06T00:05:00.000Z",
    lockedAt: status === "OPEN" ? null : "2026-08-06T00:05:00.000Z",
    committedAt: null,
    completedAt: null,
    status,
    lockReason: status === "OPEN" ? null : "ALL_READY",
    rulesetVersion: "b0-window-v1",
    schemaRevision: 1,
  };
}

function candidate(actorId: string, requestId: string, id = `intent.${actorId}`): B0ActionContractV1 {
  return {
    schemaVersion: "b0-action-contract-v1",
    id,
    windowId: "window.one",
    roomId: "run.one",
    runId: "run.one",
    actorId,
    baseWorldSequence: 7,
    revision: 1,
    kind: "ACT",
    rawPlayerText: `Act for ${actorId}`,
    normalizedSummary: `Perform one bounded action for ${actorId}.`,
    targetRefs: [{ type: "PROPOSITION", id: "proposition.one" }],
    primaryEffect: { effectTypeId: "proposition.influence", direction: "INCREASE", requestedMagnitude: "MINOR" },
    method: { methodTypeId: "method.one", description: "Use one bounded method." },
    resourceCommitments: [],
    evidenceRefs: [],
    capabilityRefs: [],
    propositionRefs: ["proposition.one"],
    visibilityIntent: { type: "PRIVATE", declaredRecipientRefs: [actorId] },
    reactionPolicy: "NONE",
    requestedTiming: "CURRENT_WINDOW",
    riskTags: [],
    compilerVersion: "compiler.v1",
    validationVersion: "validator.v1",
    clientRequestId: requestId,
    status: "DRAFT",
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    confirmedAt: null,
    lockedAt: null,
  };
}

function confirmedEnvelope(actorId: string): B0StoredIntentEnvelopeV1 {
  const first = saveB0DraftRevisionV1({
    window: window(), config: config(), current: null, candidate: candidate(actorId, `request.${actorId}.1`),
    expectedRevision: 0, now: "2026-08-06T00:01:00.000Z",
  });
  return confirmB0DraftRevisionV1({
    window: window(), config: config(), current: first.envelope, expectedRevision: 1,
    now: "2026-08-06T00:01:10.000Z",
  }).envelope;
}

test("C3 draft revisions are authoritative and confirmation is idempotent", () => {
  const first = saveB0DraftRevisionV1({
    window: window(), config: config(), current: null, candidate: candidate("actor.a", "request.a.1"),
    expectedRevision: 0, now: "2026-08-06T00:01:00.000Z",
  });
  assert.equal(first.envelope.latestRevision, 1);
  const replay = saveB0DraftRevisionV1({
    window: window(), config: config(), current: first.envelope, candidate: candidate("actor.a", "request.a.1"),
    expectedRevision: 0, now: "2026-08-06T00:01:01.000Z",
  });
  assert.equal(replay.replayed, true);
  const confirmed = confirmB0DraftRevisionV1({
    window: window(), config: config(), current: first.envelope, expectedRevision: 1,
    now: "2026-08-06T00:01:10.000Z",
  });
  assert.equal(confirmed.envelope.lastConfirmed?.status, "CONFIRMED");
  assert.equal(confirmB0DraftRevisionV1({
    window: window(), config: config(), current: confirmed.envelope, expectedRevision: 1,
    now: "2026-08-06T00:01:11.000Z",
  }).replayed, true);
});

test("C3 freeze selects last confirmed revision rather than a newer unconfirmed draft", () => {
  const confirmed = confirmedEnvelope("actor.a");
  const secondCandidate = { ...candidate("actor.a", "request.a.2"), normalizedSummary: "A newer unconfirmed plan." };
  const edited = saveB0DraftRevisionV1({
    window: window(), config: config(), current: confirmed, candidate: secondCandidate,
    expectedRevision: 1, now: "2026-08-06T00:02:00.000Z",
  }).envelope;
  const locked = lockB0IntentForActorV1({
    window: window(), config: config(), actorId: "actor.a", current: edited,
    lockedAt: "2026-08-06T00:05:00.000Z",
  });
  assert.equal(locked.source, "CONFIRMED");
  assert.equal(locked.intent.revision, 1);
  assert.equal(locked.intent.normalizedSummary, "Perform one bounded action for actor.a.");
});

test("C3 missing confirmation becomes HOLD and never executes a draft", () => {
  const draft = saveB0DraftRevisionV1({
    window: window(), config: config(), current: null, candidate: candidate("actor.b", "request.b.1"),
    expectedRevision: 0, now: "2026-08-06T00:01:00.000Z",
  }).envelope;
  const locked = lockB0IntentForActorV1({
    window: window(), config: config(), actorId: "actor.b", current: draft,
    lockedAt: "2026-08-06T00:05:00.000Z",
  });
  assert.equal(locked.source, "HOLD");
  assert.equal(locked.intent.kind, "HOLD");
  assert.notEqual(locked.intent.normalizedSummary, draft.latestDraft?.normalizedSummary);
});

test("C3 all-ready and server deadline are the only WINDOWED freeze triggers", () => {
  const participants = ["actor.a", "actor.b", "actor.c"].map((actorId) => ({ actorId, ready: true, version: 2 }));
  assert.equal(b0FreezeReasonV1({ window: window(), participants, now: "2026-08-06T00:04:00.000Z" }), "ALL_READY");
  assert.equal(b0FreezeReasonV1({ window: window(), participants: participants.map((entry, index) => ({ ...entry, ready: index < 2 })), now: "2026-08-06T00:04:00.000Z" }), null);
  assert.equal(b0FreezeReasonV1({ window: window(), participants: participants.map((entry) => ({ ...entry, ready: false })), now: "2026-08-06T00:05:00.000Z" }), "DEADLINE");
});

class MemoryFreezeStore implements B0WindowFreezeStoreV1 {
  record: B0WindowStoreRecordV1 = {
    window: window(),
    storageVersion: 4,
    config: config(),
    participants: ["actor.a", "actor.b", "actor.c"].map((actorId) => ({ actorId, ready: true, version: 2 })),
  };
  readonly intents = new Map<string, B0StoredIntentEnvelopeV1 | null>([
    ["actor.a", confirmedEnvelope("actor.a")],
    ["actor.b", null],
    ["actor.c", confirmedEnvelope("actor.c")],
  ]);
  freeze: B0FreezeEnvelopeV1 | null = null;
  claimCount = 0;
  persistCount = 0;
  lockedCount = 0;
  calls: string[] = [];

  async readWindow(_windowId: string) { this.calls.push("readWindow"); return structuredClone(this.record); }
  async claimOpenWindow(input: { expectedVersion: number; lockedAt: string; lockReason: "ALL_READY" | "DEADLINE" | "IMMEDIATE" }) {
    this.calls.push("claimOpenWindow");
    if (this.record.window.status !== "OPEN" || this.record.storageVersion !== input.expectedVersion) return false;
    this.record.window = { ...this.record.window, status: "LOCKED", lockedAt: input.lockedAt, lockReason: input.lockReason };
    this.record.storageVersion += 1;
    this.claimCount += 1;
    await Promise.resolve();
    return true;
  }
  async readIntentEnvelope(_windowId: string, actorId: string) { this.calls.push("readIntentEnvelope"); return structuredClone(this.intents.get(actorId) ?? null); }
  async captureWorld(): Promise<B0WindowWorldCaptureV1> {
    this.calls.push("captureWorld");
    return {
      worldState: { sequence: 7 },
      actorStates: ["actor.a", "actor.b", "actor.c"].map((actorId) => ({ actorId })),
      roleBindings: ["actor.a", "actor.b", "actor.c"].map((actorId) => ({ actorId, roleId: actorId })),
      knowledgeState: {}, relationshipState: {}, resourceState: {}, activeCapabilities: [], dueSystemIntents: [],
    };
  }
  async persistLockedIntent(input: { actorId: string; envelope: B0StoredIntentEnvelopeV1 }) {
    this.calls.push("persistLockedIntent"); this.intents.set(input.actorId, structuredClone(input.envelope)); this.lockedCount += 1;
  }
  async persistFreeze(envelope: B0FreezeEnvelopeV1) { this.calls.push("persistFreeze"); this.freeze = structuredClone(envelope); this.persistCount += 1; }
  async readFreeze(_windowId: string) {
    this.calls.push("readFreeze");
    for (let attempt = 0; attempt < 20 && !this.freeze; attempt += 1) await Promise.resolve();
    return structuredClone(this.freeze);
  }
}

test("C3 concurrent Ready/deadline freeze requests create one snapshot and one batch", async () => {
  const store = new MemoryFreezeStore();
  const [left, right] = await Promise.all([
    freezeB0WindowV1(store, { windowId: "window.one", now: "2026-08-06T00:05:00.000Z" }),
    freezeB0WindowV1(store, { windowId: "window.one", now: "2026-08-06T00:05:00.000Z" }),
  ]);
  assert.deepEqual([left.status, right.status].sort(), ["ALREADY_FROZEN", "FROZEN"]);
  assert.equal(store.claimCount, 1);
  assert.equal(store.persistCount, 1);
  assert.equal(store.lockedCount, 3);
  assert.equal(store.freeze?.lockedIntents.find((entry) => entry.actorId === "actor.b")?.kind, "HOLD");
  assert.equal(store.freeze?.batch.snapshotId, store.freeze?.snapshot.id);
  assert.equal(new Set(store.freeze?.lockedIntents.map((entry) => entry.baseWorldSequence)).size, 1);
  assert.equal(store.calls.some((call) => /model|narrator|http|fetch/i.test(call)), false);
});

test("C3 refresh projection is reconstructed from server state", async () => {
  const store = new MemoryFreezeStore();
  const frozen = await freezeB0WindowV1(store, { windowId: "window.one", now: "2026-08-06T00:05:00.000Z" });
  const projection = projectB0WindowV1({
    record: await store.readWindow("window.one") as B0WindowStoreRecordV1,
    actorId: "actor.b",
    intent: store.intents.get("actor.b") ?? null,
    freeze: frozen.envelope,
  });
  assert.equal(projection.window.status, "LOCKED");
  assert.equal(projection.actorReady, true);
  assert.equal(projection.lockedIntent?.kind, "HOLD");
  assert.equal(projection.batch?.id, frozen.envelope?.batch.id);
});

test("C3 edits and confirmations are rejected after lock", () => {
  assert.throws(() => saveB0DraftRevisionV1({
    window: window("LOCKED"), config: config(), current: null,
    candidate: candidate("actor.a", "request.locked"), expectedRevision: 0,
    now: "2026-08-06T00:05:01.000Z",
  }), B0WindowCoordinatorErrorV1);
});
