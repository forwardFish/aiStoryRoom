import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import test from "node:test";
import { B0SettlementPipelineService, b0ExceptionCode, b0RunEnabled, b0RunPaused } from "./b0-settlement-pipeline.service";

type Json = Record<string, any>;

function fixture(overrides: Json = {}) {
  const calls: Array<{ method: string; input: unknown }> = [];
  const now = new Date("2026-08-07T00:00:00.000Z");
  const prisma: Json = {
    storyRun: {
      findUnique: async (input: unknown) => {
        calls.push({ method: "storyRun.findUnique", input });
        return {
          id: "run.1",
          status: "playing",
          worldSequence: 11,
          strategyVersion: "b0_windowed_v1",
          stateJson: { b0: { enabled: true, paused: false } },
        };
      },
      update: async (input: Json) => {
        calls.push({ method: "storyRun.update", input });
        return { id: "run.1", stateJson: input.data.stateJson };
      },
    },
    actionWindow: {
      findMany: async (input: unknown) => {
        calls.push({ method: "actionWindow.findMany", input });
        return [{
          id: "window.1",
          runId: "run.1",
          status: "COMPLETED",
          nodeId: "node.1",
          version: 7,
          projectionVersion: 5,
          configJson: { schemaVersion: "b0-window-config-v1" },
          participants: [{ roleId: "role.a", mainStatus: "B0_COMPLETED" }],
          resolutionWorkflow: { status: "B0_COMMITTED" },
          createdAt: now,
          updatedAt: now,
        }];
      },
      updateMany: async (input: Json) => {
        calls.push({ method: "actionWindow.updateMany", input });
        return { count: 1 };
      },
    },
    storyTaskOutbox: {
      findMany: async (input: unknown) => {
        calls.push({ method: "storyTaskOutbox.findMany", input });
        return [{
          id: "task.1",
          taskType: "B0_NARRATIVE_GENERATION",
          status: "failed",
          attempt: 1,
          maxAttempts: 4,
          windowId: "window.1",
          roleId: "role.a",
          lastError: "provider timeout",
          createdAt: now,
          updatedAt: now,
        }];
      },
      findUnique: async (input: unknown) => {
        calls.push({ method: "storyTaskOutbox.findUnique", input });
        return {
          id: "task.1",
          taskType: "B0_NARRATIVE_GENERATION",
          status: "failed",
          attempt: 1,
          maxAttempts: 4,
          windowId: "window.1",
        };
      },
      update: async (input: Json) => {
        calls.push({ method: "storyTaskOutbox.update", input });
        return { id: "task.1", ...input.data };
      },
    },
    narrativeEntry: {
      count: async (input: unknown) => {
        calls.push({ method: "narrativeEntry.count", input });
        return 1;
      },
    },
    ...overrides,
  };
  const windows = {
    recoverExpired: async (date: Date) => {
      calls.push({ method: "windows.recoverExpired", input: date.toISOString() });
      return { recovered: 1 };
    },
  };
  const service = new B0SettlementPipelineService(
    prisma as any,
    {} as any,
    windows as any,
    {} as any,
  );
  return { service, prisma, calls };
}

test("B0 structured delivery persists recipient routing with the durable ROLE audience vocabulary", async () => {
  const capture: { persisted?: Json } = {};
  const { service } = fixture({
    storyRole: {
      findUnique: async () => ({ id: "role.b", runId: "run.1", roleKey: "role-b" }),
    },
    storyRun: {
      findUnique: async () => ({ currentDay: 3 }),
    },
    storyEvent: {
      upsert: async (input: Json) => {
        capture.persisted = input;
        return { id: "event.1" };
      },
    },
    storyPlayer: {
      findMany: async () => [],
    },
  });

  await (service as any).persistStructuredDelivery({
    schemaVersion: "b0-publication-delivery-v1",
    idempotencyKey: "b0-publication:batch.1:result.1:role.b",
    batchId: "batch.1",
    runId: "run.1",
    windowId: "window.1",
    resultId: "result.1",
    resultKind: "CROSS_PLAYER_IMPACT",
    recipientActorId: "role.b",
    visibility: "TARGETED",
    sourceDisclosure: "HIDDEN",
    originActorIds: [],
    targetActorIds: ["role.b"],
    summary: "Another committed plan changed this role's position.",
    outcomeStatus: null,
    changes: [],
    explanation: {
      schemaVersion: "b0-causal-explanation-card-v1",
      resultId: "result.1",
      reasons: [{ kind: "OTHER_PLAN", summary: "Another committed plan changed your position." }],
    },
  });

  assert.ok(capture.persisted);
  const create = capture.persisted.create as Json;
  assert.equal(create.visibility, "targeted");
  assert.equal(create.audienceType, "ROLE");
  assert.deepEqual(create.audienceRoleIdsJson, ["role.b"]);
});

test("B0 narrative tasks use the durable b0 dedupe namespace for create and lookup", async () => {
  const captured: Json[] = [];
  const { service } = fixture({
    actionWindow: {
      findUnique: async () => ({ nodeId: "node.1" }),
    },
    storyTaskOutbox: {
      upsert: async (input: Json) => {
        captured.push(input);
        return input.create;
      },
    },
  });

  await (service as any).enqueueNarratives({
    batchId: "b0.batch.1",
    manifest: {
      runId: "run.1",
      windowId: "window.1",
      commitHash: "commit.1",
    },
  }, {
    planHash: "plan.1",
    deliveries: [
      { recipientActorId: "role.b" },
      { recipientActorId: "role.a" },
      { recipientActorId: "role.a" },
    ],
  });

  assert.equal(captured.length, 2);
  const keys = captured.map((entry) => String(entry.create.dedupeKey)).sort();
  assert.deepEqual(keys, [
    "b0-narrative:b0.batch.1:role.a:SETTLEMENT_ROLE_VIEW",
    "b0-narrative:b0.batch.1:role.b:SETTLEMENT_ROLE_VIEW",
  ]);
  for (const entry of captured) {
    assert.equal(entry.where.dedupeKey, entry.create.dedupeKey);
    assert.equal(entry.create.taskType, "B0_NARRATIVE_GENERATION");
    assert.equal(entry.create.checkpointKey, "B0_STRUCTURED_RESULTS_PUBLISHED");
  }
});

test("C8 diagnostics is read-only and reports window, task, narrative and world sequence state", async () => {
  const { service, calls } = fixture();
  const result = await service.diagnostics("run.1");
  assert.equal(result.run.id, "run.1");
  assert.equal(result.run.worldSequence, 11);
  assert.equal(result.windows.length, 1);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.metrics.narrativeCount, 1);
  assert.equal(result.metrics.completedWindowCount, 1);
  assert.equal(result.windows[0].readyCount, 1);
  assert.equal(calls.some((entry) => /\.update|\.create|\.delete/.test(entry.method)), false);
});

test("C8 retry only requeues a failed B0 task and clears its lease without resetting attempts", async () => {
  const { service, calls } = fixture();
  const result = await service.retryTask("task.1");
  assert.equal(result.status, "pending");
  const update = calls.find((entry) => entry.method === "storyTaskOutbox.update")?.input as Json;
  assert.equal(update.where.id, "task.1");
  assert.equal(update.data.status, "pending");
  assert.equal(update.data.leaseOwner, null);
  assert.equal(update.data.leaseExpiresAt, null);
  assert.equal(update.data.lastError, null);
  assert.equal("attempt" in update.data, false);
});

test("C8 retry rejects non-B0 task vocabulary", async () => {
  const { service } = fixture({
    storyTaskOutbox: {
      findUnique: async () => ({
        id: "task.legacy",
        taskType: "resolve_node",
        status: "failed",
        attempt: 1,
        maxAttempts: 4,
        windowId: null,
      }),
    },
  });
  await assert.rejects(() => service.retryTask("task.legacy"));
});

test("C8 pause preserves an active B0 window while preventing successor creation", () => {
  assert.equal(b0RunEnabled("b0_windowed_v1", { b0: { paused: true } }), true);
  assert.equal(b0RunEnabled("legacy_v1", { b0: { enabled: true, paused: true } }), true);
  assert.equal(b0RunPaused({ b0: { enabled: true, paused: true } }), true);
  assert.equal(b0RunPaused({ b0: { enabled: true, paused: false } }), false);
  assert.equal(b0RunPaused({}), false);
});

test("C8 pause is stored only in the run-scoped B0 control state", async () => {
  const { service, calls } = fixture();
  const result = await service.pauseRun("run.1", true);
  assert.equal(result.paused, true);
  const update = calls.find((entry) => entry.method === "storyRun.update")?.input as Json;
  assert.deepEqual(update.data.stateJson, { b0: { enabled: true, paused: true } });
});

test("C8 safe abort changes only an uncommitted open/locked/retryable window", async () => {
  const { service, calls } = fixture();
  const result = await service.abortWindow("window.1");
  assert.equal(result.status, "ABORTED");
  const update = calls.find((entry) => entry.method === "actionWindow.updateMany")?.input as Json;
  assert.deepEqual(update.where.status.in, ["OPEN", "LOCKED", "FAILED_RETRYABLE"]);
  assert.equal(update.data.status, "ABORTED");
});

test("C8 recovery reconciles pending AI roles before deadline recovery", async () => {
  const { service, calls } = fixture();
  (service as any).recoverActiveAiPlans = async () => {
    calls.push({ method: "pipeline.recoverActiveAiPlans", input: null });
  };
  const result = await service.recover(new Date("2026-08-07T00:00:00.000Z"));
  assert.deepEqual(result, { recovered: 1 });
  assert.deepEqual(
    calls.filter((entry) => entry.method.startsWith("pipeline.") || entry.method === "windows.recoverExpired").map((entry) => entry.method),
    ["pipeline.recoverActiveAiPlans", "windows.recoverExpired"],
  );
});

test("C8 AI recovery creates, confirms, and readies the same ActionContract used by normal window creation", async () => {
  const calls: Array<{ method: string; input: any }> = [];
  let participantReads = 0;
  const prisma = {
    actionWindow: {
      findUnique: async () => ({ nodeId: "node.1", status: "OPEN" }),
    },
    roleControl: {
      findMany: async () => [{ roleId: "role.ai", epoch: 3 }],
    },
    actionWindowParticipant: {
      findUnique: async () => {
        participantReads += 1;
        return { mainStatus: "B0_PENDING", version: participantReads };
      },
    },
    playerAction: {
      findUnique: async () => null,
    },
  };
  const windows = {
    saveDraft: async (input: any) => { calls.push({ method: "saveDraft", input }); },
    confirmDraft: async (input: any) => { calls.push({ method: "confirmDraft", input }); },
    ready: async (input: any) => { calls.push({ method: "ready", input }); },
  };
  const service = new B0SettlementPipelineService(prisma as any, {} as any, windows as any, {} as any);
  await (service as any).prepareAiPlans(aiWindow());
  assert.deepEqual(calls.map((entry) => entry.method), ["saveDraft", "confirmDraft", "ready"]);
  assert.equal(calls[0].input.expectedRevision, 0);
  assert.equal(calls[0].input.candidate.clientRequestId, "ai-plan:window.ai:role.ai");
  assert.equal(calls[1].input.expectedRevision, 1);
  assert.equal(calls[2].input.controlEpoch, 3);
});

test("C8 AI recovery replays a persisted unconfirmed draft with its original expected revision", async () => {
  const calls: Array<{ method: string; input: any }> = [];
  const draft = {
    ...aiAction(),
    status: "DRAFT" as const,
    confirmedAt: null,
  };
  const prisma = {
    actionWindow: { findUnique: async () => ({ nodeId: "node.1", status: "OPEN" }) },
    roleControl: { findMany: async () => [{ roleId: "role.ai", epoch: 3 }] },
    actionWindowParticipant: { findUnique: async () => ({ mainStatus: "B0_PENDING", version: 4 }) },
    playerAction: { findUnique: async () => ({
      normalizedJson: {
        schemaVersion: "b0-intent-revision-envelope-v1",
        windowId: "window.ai",
        roomId: "run.1",
        runId: "run.1",
        actorId: "role.ai",
        latestRevision: 1,
        latestDraft: draft,
        lastConfirmed: null,
        lockedIntent: null,
        latestRequestHash: "a".repeat(64),
      },
    }) },
  };
  const windows = {
    saveDraft: async (input: any) => { calls.push({ method: "saveDraft", input }); },
    confirmDraft: async (input: any) => { calls.push({ method: "confirmDraft", input }); },
    ready: async (input: any) => { calls.push({ method: "ready", input }); },
  };
  const service = new B0SettlementPipelineService(prisma as any, {} as any, windows as any, {} as any);
  await (service as any).prepareAiPlans(aiWindow());
  assert.deepEqual(calls.map((entry) => entry.method), ["saveDraft", "confirmDraft", "ready"]);
  assert.equal(calls[0].input.expectedRevision, 0, "replay must reuse the revision that originally created the draft");
  assert.equal(calls[0].input.candidate.clientRequestId, "ai-plan:window.ai:role.ai");
  assert.equal(calls[1].input.expectedRevision, 1, "recovery confirms the already persisted revision");
  assert.equal(calls[2].input.controlEpoch, 3);
});

test("C8 AI recovery preserves an already confirmed plan and only restores READY", async () => {
  const calls: string[] = [];
  const action = aiAction();
  const prisma = {
    actionWindow: { findUnique: async () => ({ nodeId: "node.1", status: "OPEN" }) },
    roleControl: { findMany: async () => [{ roleId: "role.ai", epoch: 1 }] },
    actionWindowParticipant: { findUnique: async () => ({ mainStatus: "B0_PENDING", version: 4 }) },
    playerAction: { findUnique: async () => ({
      normalizedJson: {
        schemaVersion: "b0-intent-revision-envelope-v1",
        windowId: "window.ai",
        roomId: "run.1",
        runId: "run.1",
        actorId: "role.ai",
        latestRevision: 1,
        latestDraft: action,
        lastConfirmed: action,
        lockedIntent: null,
        latestRequestHash: "a".repeat(64),
      },
    }) },
  };
  const windows = {
    saveDraft: async () => { calls.push("saveDraft"); },
    confirmDraft: async () => { calls.push("confirmDraft"); },
    ready: async () => { calls.push("ready"); },
  };
  const service = new B0SettlementPipelineService(prisma as any, {} as any, windows as any, {} as any);
  await (service as any).prepareAiPlans(aiWindow());
  assert.deepEqual(calls, ["ready"]);
});

function aiWindow() {
  return {
    schemaVersion: "b0-settlement-window-v1",
    id: "window.ai",
    roomId: "run.1",
    runId: "run.1",
    mode: "WINDOWED",
    ordinal: 1,
    situationId: "situation.1",
    baseWorldSequence: 0,
    expectedActorIds: ["role.ai"],
    readyActorIds: [],
    openedAt: "2026-08-07T00:00:00.000Z",
    locksAt: "2026-08-07T00:05:00.000Z",
    lockedAt: null,
    committedAt: null,
    completedAt: null,
    status: "OPEN",
    lockReason: null,
    rulesetVersion: "b0-rules-v1",
    schemaRevision: 1,
  } as const;
}

function aiAction() {
  return {
    schemaVersion: "b0-action-contract-v1",
    id: "intent.ai",
    windowId: "window.ai",
    roomId: "run.1",
    runId: "run.1",
    actorId: "role.ai",
    baseWorldSequence: 0,
    revision: 1,
    kind: "ACT",
    rawPlayerText: "Protect position.",
    normalizedSummary: "Protect position.",
    targetRefs: [{ type: "ACTOR", id: "role.ai" }],
    primaryEffect: { effectTypeId: "position.protect", direction: "PROTECT", requestedMagnitude: "MINOR" },
    method: { methodTypeId: "ai.conservative.plan", description: "Use a bounded plan." },
    resourceCommitments: [],
    evidenceRefs: [],
    capabilityRefs: [],
    propositionRefs: [],
    visibilityIntent: { type: "PRIVATE", declaredRecipientRefs: ["role.ai"] },
    reactionPolicy: "IF_OBSERVED",
    requestedTiming: "CURRENT_WINDOW",
    riskTags: ["conservative"],
    compilerVersion: "b0-ai-fallback-v1",
    validationVersion: "b0-action-contract-v1",
    clientRequestId: "ai-plan:window.ai:role.ai",
    status: "CONFIRMED",
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:01.000Z",
    confirmedAt: "2026-08-07T00:00:01.000Z",
    lockedAt: null,
  } as const;
}

test("C8 deadline recovery delegates to the authoritative window coordinator", async () => {
  const { service, calls } = fixture();
  const result = await service.recover(new Date("2026-08-07T00:00:00.000Z"));
  assert.deepEqual(result, { recovered: 1 });
  assert.equal(calls.some((entry) => entry.method === "windows.recoverExpired"), true);
});


test("concurrent B0 lazy creation recognizes the Nest WINDOW_ALREADY_ACTIVE response code", () => {
  const active = new ConflictException({
    code: "WINDOW_ALREADY_ACTIVE",
    message: "another request created the synchronized window",
  });
  assert.equal(b0ExceptionCode(active), "WINDOW_ALREADY_ACTIVE");
  assert.equal(b0ExceptionCode({ code: "P2002" }), "P2002");
  assert.equal(b0ExceptionCode(new ConflictException({ code: "OTHER_CONFLICT", message: "other" })), "OTHER_CONFLICT");
  assert.equal(b0ExceptionCode(new Error("WINDOW_ALREADY_ACTIVE")), "");
});
