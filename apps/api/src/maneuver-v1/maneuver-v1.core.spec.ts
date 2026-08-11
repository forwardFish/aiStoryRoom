import assert from "node:assert/strict";
import test from "node:test";
import {
  ManeuverDomainErrorV1,
  ManeuverEngineV1,
  ManeuverPreviewTokenCodecV1,
  type AuthoritativeManeuverContextV1,
  type CreateCommittedManeuverV1,
  type ManeuverCommittedActionV1,
  type ManeuverStoreV1,
  type ManeuverTransactionV1,
} from "./maneuver-v1.core";
import type { ManeuverCompilerContextV1 } from "@ai-story/templates";

function compilerContext(): ManeuverCompilerContextV1 {
  return {
    actorRoleId: "role.operator",
    stateRevision: 7,
    turnRevision: 3,
    contacts: [{
      id: "role.coordinator",
      label: "Coordinator",
      method: "Send a direct bounded message.",
      guaranteedStart: "The coordinator receives the message.",
      contestedOutcome: "The coordinator may answer or decline.",
      notGuaranteed: "The coordinator is not forced to agree.",
      visibility: "TARGETED",
    }],
    traces: [{
      traceId: "trace.access_log",
      label: "Access log mismatch",
      description: "Two records disagree.",
      sourceKind: "DOCUMENT",
      routeOptions: [{
        routeId: "route.compare_records",
        label: "Compare records",
        method: "Compare the two signed records.",
        guaranteedStart: "The comparison begins.",
        contestedOutcome: "The mismatch may be narrowed to a time window.",
        notGuaranteed: "The comparison cannot prove intent.",
      }],
    }],
    leverageAssets: [],
    legalTargetIds: ["role.coordinator", "trace.access_log", "entity.archive"],
  };
}

function context(overrides: Partial<AuthoritativeManeuverContextV1> = {}): AuthoritativeManeuverContextV1 {
  return {
    runId: "run.alpha",
    userId: "user.alpha",
    roleId: "role.operator",
    actorTurnId: "turn.alpha",
    nodeId: "node.alpha",
    stageIndex: 1,
    stateRevision: 7,
    turnRevision: 3,
    controlEpoch: 2,
    windowState: "OPEN",
    mainlineLocked: false,
    usedSlots: [],
    compilerContext: compilerContext(),
    investigationOutcomes: [],
    ...overrides,
  };
}

class MemoryStore implements ManeuverStoreV1, ManeuverTransactionV1 {
  context: AuthoritativeManeuverContextV1;
  actions = new Map<string, ManeuverCommittedActionV1>();
  writeCount = 0;
  readCount = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(initial: AuthoritativeManeuverContextV1) {
    this.context = structuredClone(initial);
  }

  async readContext(userId: string, runId: string) {
    this.readCount += 1;
    assert.equal(userId, this.context.userId);
    assert.equal(runId, this.context.runId);
    return structuredClone(this.context);
  }

  async serializable<T>(operation: (tx: ManeuverTransactionV1) => Promise<T>): Promise<T> {
    const predecessor = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await predecessor;
    try {
      return await operation(this);
    } finally {
      release();
    }
  }

  async findByIdempotencyKey(userId: string, runId: string, key: string) {
    if (userId !== this.context.userId || runId !== this.context.runId) return null;
    return structuredClone(this.actions.get(key) || null);
  }

  async createAction(input: CreateCommittedManeuverV1) {
    this.writeCount += 1;
    const actionId = `action.${this.writeCount}`;
    this.context.usedSlots.push(input.slot);
    const action: ManeuverCommittedActionV1 = {
      actionId,
      slot: input.slot,
      status: "PENDING",
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      immediateReceipt: input.immediateReceipt,
      remaining: 2 - this.context.usedSlots.length,
    };
    this.actions.set(input.idempotencyKey, structuredClone(action));
    return action;
  }
}

function engine(store: ManeuverStoreV1, now = new Date("2026-08-05T00:00:00.000Z")) {
  const clock = () => new Date(now);
  return new ManeuverEngineV1(
    store,
    new ManeuverPreviewTokenCodecV1("test-secret-with-at-least-thirty-two-characters", clock),
    clock,
    60_000,
  );
}

const contactDraft = {
  kind: "CONTACT" as const,
  targetId: "role.coordinator",
  rawText: "Ask for the signed handoff record.",
  expectedTurnRevision: 3,
};

test("context-bound preview uses the same compiler and token path without a legacy ActorTurn store read", async () => {
  const supplied = context({
  actorTurnId: "b0-window:window.one",
  turnRevision: 1,
  compilerContext: { ...compilerContext(), turnRevision: 1 },
});
  const store = new MemoryStore(context());
  const result = await engine(store).previewWithContext("user.alpha", "run.alpha", {
    draft: { ...contactDraft, expectedTurnRevision: 1 },
    expectedStateRevision: 7,
  }, supplied);
  assert.equal(result.decision, "READY");
  assert.equal(result.remaining, 2);
  assert.equal(store.readCount, 0);
  assert.equal(store.writeCount, 0);
});

test("preview is side-effect free and keeps authoritative 2/2", async () => {
  const store = new MemoryStore(context());
  const result = await engine(store).preview("user.alpha", "run.alpha", { draft: contactDraft, expectedStateRevision: 7 });
  assert.equal(result.decision, "READY");
  assert.equal(result.remaining, 2);
  assert.equal(store.writeCount, 0);
  assert.deepEqual(store.context.usedSlots, []);
});

test("commit consumes one slot exactly once", async () => {
  const store = new MemoryStore(context());
  const subject = engine(store);
  const preview = await subject.preview("user.alpha", "run.alpha", { draft: contactDraft, expectedStateRevision: 7 });
  assert.ok(preview.previewToken);
  const first = await subject.commit("user.alpha", "run.alpha", {
    previewToken: preview.previewToken,
    idempotencyKey: "commit:alpha:0001",
    expectedStateRevision: 7,
  });
  assert.equal(first.remaining, 1);
  assert.equal(first.action.slot, "MANEUVER_1");
  assert.equal(store.writeCount, 1);
});

test("same idempotency key returns the same action even after the preview expires", async () => {
  const store = new MemoryStore(context());
  const subject = engine(store);
  const preview = await subject.preview("user.alpha", "run.alpha", { draft: contactDraft, expectedStateRevision: 7 });
  const request = { previewToken: preview.previewToken, idempotencyKey: "commit:alpha:0002", expectedStateRevision: 7 };
  const first = await subject.commit("user.alpha", "run.alpha", request);
  const replay = await subject.commit("user.alpha", "run.alpha", request);
  const lateReplay = await engine(store, new Date("2026-08-05T00:10:00.000Z")).commit("user.alpha", "run.alpha", request);
  assert.deepEqual(replay, first);
  assert.deepEqual(lateReplay, first);
  assert.equal(store.writeCount, 1);
});

test("two confirmations racing for the last slot allow only one success", async () => {
  const store = new MemoryStore(context({ usedSlots: ["MANEUVER_1"] }));
  const subject = engine(store);
  const previewA = await subject.preview("user.alpha", "run.alpha", { draft: contactDraft, expectedStateRevision: 7 });
  const previewB = await subject.preview("user.alpha", "run.alpha", { draft: contactDraft, expectedStateRevision: 7 });
  const results = await Promise.allSettled([
    subject.commit("user.alpha", "run.alpha", { previewToken: previewA.previewToken, idempotencyKey: "commit:race:a", expectedStateRevision: 7 }),
    subject.commit("user.alpha", "run.alpha", { previewToken: previewB.previewToken, idempotencyKey: "commit:race:b", expectedStateRevision: 7 }),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
  assert.equal(store.writeCount, 1);
  assert.deepEqual([...store.context.usedSlots].sort(), ["MANEUVER_1", "MANEUVER_2"]);
});

test("mainline lock rejects new preview and a previously issued commit", async () => {
  const store = new MemoryStore(context());
  const subject = engine(store);
  const preview = await subject.preview("user.alpha", "run.alpha", { draft: contactDraft, expectedStateRevision: 7 });
  store.context.mainlineLocked = true;
  await assert.rejects(
    subject.preview("user.alpha", "run.alpha", { draft: contactDraft, expectedStateRevision: 7 }),
    (error: unknown) => error instanceof ManeuverDomainErrorV1 && error.code === "MANEUVER_WINDOW_CLOSED",
  );
  await assert.rejects(
    subject.commit("user.alpha", "run.alpha", { previewToken: preview.previewToken, idempotencyKey: "commit:locked:001", expectedStateRevision: 7 }),
    (error: unknown) => error instanceof ManeuverDomainErrorV1 && error.code === "MANEUVER_WINDOW_CLOSED",
  );
  assert.equal(store.writeCount, 0);
});

test("state and turn revisions produce recoverable stale errors", async () => {
  const store = new MemoryStore(context());
  const subject = engine(store);
  await assert.rejects(
    subject.preview("user.alpha", "run.alpha", { draft: contactDraft, expectedStateRevision: 6 }),
    (error: unknown) => error instanceof ManeuverDomainErrorV1 && error.code === "REVISION_CONFLICT" && error.recoverable,
  );
  const preview = await subject.preview("user.alpha", "run.alpha", { draft: contactDraft, expectedStateRevision: 7 });
  store.context.stateRevision = 8;
  await assert.rejects(
    subject.commit("user.alpha", "run.alpha", { previewToken: preview.previewToken, idempotencyKey: "commit:stale:001", expectedStateRevision: 7 }),
    (error: unknown) => error instanceof ManeuverDomainErrorV1 && error.code === "PREVIEW_STALE" && error.recoverable,
  );
  assert.equal(store.writeCount, 0);
});

test("tampered, expired, and cross-user preview tokens are rejected", async () => {
  const store = new MemoryStore(context());
  const subject = engine(store);
  const preview = await subject.preview("user.alpha", "run.alpha", { draft: contactDraft, expectedStateRevision: 7 });
  assert.ok(preview.previewToken);
  await assert.rejects(
    subject.commit("user.alpha", "run.alpha", { previewToken: `${preview.previewToken!.slice(0, -1)}x`, idempotencyKey: "commit:tampered:1", expectedStateRevision: 7 }),
    (error: unknown) => error instanceof ManeuverDomainErrorV1 && error.code === "PREVIEW_TAMPERED",
  );
  await assert.rejects(
    subject.commit("user.beta", "run.alpha", { previewToken: preview.previewToken, idempotencyKey: "commit:cross-user:1", expectedStateRevision: 7 }),
    (error: unknown) => error instanceof ManeuverDomainErrorV1 && error.code === "PREVIEW_TAMPERED",
  );
  await assert.rejects(
    engine(store, new Date("2026-08-05T00:02:00.000Z")).commit("user.alpha", "run.alpha", { previewToken: preview.previewToken, idempotencyKey: "commit:expired:1", expectedStateRevision: 7 }),
    (error: unknown) => error instanceof ManeuverDomainErrorV1 && error.code === "PREVIEW_EXPIRED",
  );
});

test("reusing an idempotency key with a different request is rejected", async () => {
  const store = new MemoryStore(context());
  const subject = engine(store);
  const preview = await subject.preview("user.alpha", "run.alpha", { draft: contactDraft, expectedStateRevision: 7 });
  await subject.commit("user.alpha", "run.alpha", { previewToken: preview.previewToken, idempotencyKey: "commit:reuse:001", expectedStateRevision: 7 });
  const otherPreview = await subject.preview("user.alpha", "run.alpha", {
    draft: { ...contactDraft, rawText: "Ask for a different record." },
    expectedStateRevision: 7,
  });
  await assert.rejects(
    subject.commit("user.alpha", "run.alpha", { previewToken: otherPreview.previewToken, idempotencyKey: "commit:reuse:001", expectedStateRevision: 7 }),
    (error: unknown) => error instanceof ManeuverDomainErrorV1 && error.code === "IDEMPOTENCY_KEY_REUSED",
  );
  assert.equal(store.writeCount, 1);
});


test("investigation preview requires and cryptographically binds an authoritative outcome", async () => {
  const outcome = {
    routeId: "route.compare_records",
    factKey: "fact.access_log_changed",
    title: "Signed record comparison",
    summary: "The signed timestamps differ.",
    supports: "A record changed after the first signature.",
    cannotProve: "Who intended the change.",
    sourceKind: "RECORD" as const,
    provenanceKey: "source.access_log.primary",
  };
  const store = new MemoryStore(context({ investigationOutcomes: [outcome] }));
  const subject = engine(store);
  const preview = await subject.preview("user.alpha", "run.alpha", {
    draft: {
      kind: "INVESTIGATE",
      traceId: "trace.access_log",
      routeId: "route.compare_records",
      expectedTurnRevision: 3,
    },
    expectedStateRevision: 7,
  });
  assert.equal(preview.decision, "READY");
  assert.ok(preview.previewToken);
  store.context.investigationOutcomes = [{ ...outcome, supports: "A broader claim." }];
  await assert.rejects(
    subject.commit("user.alpha", "run.alpha", {
      previewToken: preview.previewToken,
      idempotencyKey: "commit:investigation:binding",
      expectedStateRevision: 7,
    }),
    (error: unknown) => error instanceof ManeuverDomainErrorV1 && error.code === "PREVIEW_STALE",
  );
  assert.equal(store.writeCount, 0);
});

test("investigation route without an authoritative outcome is blocked before a token is issued", async () => {
  const store = new MemoryStore(context());
  const preview = await engine(store).preview("user.alpha", "run.alpha", {
    draft: {
      kind: "INVESTIGATE",
      traceId: "trace.access_log",
      routeId: "route.compare_records",
      expectedTurnRevision: 3,
    },
    expectedStateRevision: 7,
  });
  assert.equal(preview.decision, "BLOCKED");
  assert.equal(preview.errorCode, "TRACE_UNAVAILABLE");
  assert.equal(preview.previewToken, undefined);
  assert.equal(store.writeCount, 0);
});
