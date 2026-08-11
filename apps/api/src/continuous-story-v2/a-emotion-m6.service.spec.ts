import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { CONTINUOUS_STORY_ENGINE_VERSION } from "@ai-story/shared";
import { buildAEmotionM6RoomPolicy } from "../config/a-emotion-m6.config";
import { defaultPauseState } from "../config/a-emotion-room-flags";
import { PrismaService } from "../prisma.service";
import { A_EMOTION_M6_SERIALIZABLE_MAX_ATTEMPTS, AEmotionM6Service, aEmotionM6Boundary, aEmotionM6RetryDelay, assertAEmotionM6Boundary, evaluateAEmotionM6RecoveryAction, isAEmotionM6RetryableTransactionError, withAEmotionM6SerializableRetry } from "./a-emotion-m6.service";

const isolatedDatabaseUrl = safeTestDatabaseUrl(process.env.A_EMOTION_M6_TEST_DATABASE_URL);
const enabledEnv = { A_EMOTION_M1_ENABLED: "true", A_EMOTION_M2_ENABLED: "true", A_EMOTION_M4_ENABLED: "true", A_EMOTION_SIMPLE_PROMISE_ENABLED: "true", A_EMOTION_M5_ENABLED: "true", A_EMOTION_STAGE_MILESTONES_ENABLED: "true", A_EMOTION_INTERACTION_HISTORY_ENABLED: "true", A_EMOTION_M6_ENABLED: "true", A_EMOTION_M6_RECOVERY_ENABLED: "true", A_EMOTION_M6_DEADLINE_MS: "10000" };

const policy = { schemaVersion: "a_emotion_m6_recovery_policy_v1" as const, maxAttempts: 5, leaseMs: 30_000, retryBaseMs: 500, deadlineMs: 10_000, deadLetterAfterAttempts: 5, failClosed: true as const };

test("M6 recovery decision is deterministic and leaves unrelated or live tasks alone", () => {
  const now = new Date("2026-08-10T00:00:20.000Z");
  const task = { status: "RUNNING", attempt: 1, maxAttempts: 5, createdAt: new Date("2026-08-10T00:00:15.000Z"), leaseExpiresAt: new Date("2026-08-10T00:00:19.000Z") };
  assert.equal(evaluateAEmotionM6RecoveryAction({ task, enabledForRun: true, now, policy }), "RECOVER");
  assert.equal(evaluateAEmotionM6RecoveryAction({ task: { ...task, attempt: 5 }, enabledForRun: true, now, policy }), "DEAD_LETTER");
  assert.equal(evaluateAEmotionM6RecoveryAction({ task, enabledForRun: false, now, policy }), "RECOVER_LEGACY");
  assert.equal(evaluateAEmotionM6RecoveryAction({ task: { ...task, status: "COMPLETED" }, enabledForRun: true, now, policy }), "COMPLETED");
  assert.equal(evaluateAEmotionM6RecoveryAction({ task: { ...task, leaseExpiresAt: new Date("2026-08-10T00:00:21.000Z") }, enabledForRun: true, now, policy }), "IGNORE");
  assert.equal(aEmotionM6RetryDelay(500, 0), 500);
  assert.equal(aEmotionM6RetryDelay(500, 9), 32_000);
});

test("M6 serializable retry is bounded and retries only recognized transaction conflicts", async () => {
  const delays: number[] = [];
  let attempts = 0;
  const result = await withAEmotionM6SerializableRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error("write conflict"), { code: "P2034" });
    return "ok";
  }, { attempts: 4, sleep: async (milliseconds) => { delays.push(milliseconds); } });
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [25, 50]);

  let boundedAttempts = 0;
  const retryable = Object.assign(new Error("could not serialize access due to concurrent update"), { code: "40001" });
  await assert.rejects(() => withAEmotionM6SerializableRetry(async () => { boundedAttempts += 1; throw retryable; }, { attempts: 3, sleep: async () => undefined }), (error) => error === retryable);
  assert.equal(boundedAttempts, 3);
  assert.equal(isAEmotionM6RetryableTransactionError(retryable), true);
});

test("M6 serializable retry never retries authorization version or arbitrary errors", async () => {
  for (const error of [
    new ForbiddenException({ code: "ROOM_OWNER_REQUIRED", message: "owner required" }),
    new ConflictException({ code: "A_EMOTION_M6_RUN_VERSION_MISMATCH", message: "version changed" }),
    Object.assign(new Error("unique constraint"), { code: "P2002" }),
    new Error("arbitrary failure")
  ]) {
    let attempts = 0;
    await assert.rejects(() => withAEmotionM6SerializableRetry(async () => { attempts += 1; throw error; }, { attempts: 4, sleep: async () => { throw new Error("sleep must not run"); } }), (caught) => caught === error);
    assert.equal(attempts, 1);
    assert.equal(isAEmotionM6RetryableTransactionError(error), false);
  }
});

function rollbackHarness(input: { transactionErrors?: unknown[]; version?: number } = {}) {
  const transactionErrors = [...(input.transactionErrors || [])];
  const stateJson = {
    aEmotionRuleset: buildAEmotionM6RoomPolicy({
      m1Enabled: true,
      m2Enabled: true,
      m3Enabled: true,
      m4Enabled: true,
      m5Enabled: true,
      m6Enabled: true,
      pollIntervalMs: 7_000,
      frozenAt: new Date("2026-08-10T00:00:00.000Z")
    }),
    featureFlags: {
      aEmotionM1: true,
      aEmotionM2: true,
      aEmotionM3: true,
      aEmotionKeyModals: true,
      aEmotionM4: true,
      aEmotionSimplePromise: true,
      aEmotionM5: true,
      aEmotionStageMilestones: true,
      aEmotionInteractionHistory: true,
      aEmotionM6: true,
      aEmotionRecovery: true
    },
    aEmotionM1: { schemaVersion: "a_emotion_m1_state_v1", stateVersion: 3, metrics: {}, impacts: {} }
  };
  let transactionCalls = 0;
  let updateCalls = 0;
  let writtenState: unknown = null;
  const tx = {
    storyRun: {
      findUnique: async () => ({ version: input.version || 7, stateJson }),
      updateMany: async ({ data }: { data: { stateJson: unknown } }) => {
        updateCalls += 1;
        writtenState = data.stateJson;
        return { count: 1 };
      }
    }
  };
  const prisma = {
    $transaction: async (operation: (client: typeof tx) => Promise<unknown>, options: { isolationLevel?: unknown }) => {
      transactionCalls += 1;
      assert.equal(String(options.isolationLevel), "Serializable");
      const error = transactionErrors.shift();
      if (error) throw error;
      return operation(tx);
    }
  };
  return {
    service: new AEmotionM6Service(prisma as never),
    transactionCalls: () => transactionCalls,
    updateCalls: () => updateCalls,
    writtenState: () => writtenState as Record<string, any> | null
  };
}

test("M6 rollback retries the whole Serializable transaction after a recognized write conflict", async () => {
  const retryable = Object.assign(new Error("Transaction failed due to a write conflict or a deadlock"), { code: "P2034" });
  const harness = rollbackHarness({ transactionErrors: [retryable], version: 7 });
  const result = await harness.service.rollbackRoomFeatures({ roomId: "room-rollback", expectedVersion: 7, reason: "TEST_ROLLBACK" });
  assert.equal(result.version, 8);
  assert.equal(harness.transactionCalls(), 2);
  assert.equal(harness.updateCalls(), 1);
  const state = harness.writtenState();
  assert.equal(state?.featureFlags.aEmotionM1, false);
  assert.equal(state?.featureFlags.aEmotionRecovery, false);
  assert.equal(state?.aEmotionRuleset.flags.aEmotionEnabled, false);
  assert.equal(state?.aEmotionRuleset.flags.recoveryEnabled, false);
  assert.equal(state?.aEmotionM1.stateVersion, 3, "rollback must preserve authoritative A-Emotion state");
});

test("M6 rollback retry is bounded and rethrows the final recognized transaction conflict", async () => {
  const retryable = Object.assign(new Error("could not serialize access due to concurrent update"), { code: "40001" });
  const harness = rollbackHarness({ transactionErrors: [retryable, retryable, retryable, retryable] });
  await assert.rejects(
    () => harness.service.rollbackRoomFeatures({ roomId: "room-rollback", expectedVersion: 7, reason: "TEST_ROLLBACK" }),
    (error) => error === retryable
  );
  assert.equal(harness.transactionCalls(), A_EMOTION_M6_SERIALIZABLE_MAX_ATTEMPTS);
  assert.equal(harness.updateCalls(), 0);
});

test("M6 rollback does not retry authorization version not-found or arbitrary errors", async () => {
  for (const error of [
    new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" }),
    new ForbiddenException({ code: "ROOM_OWNER_REQUIRED", message: "owner required" }),
    new ConflictException({ code: "A_EMOTION_M6_RUN_VERSION_MISMATCH", message: "version changed" }),
    new Error("arbitrary rollback failure")
  ]) {
    const harness = rollbackHarness({ transactionErrors: [error] });
    await assert.rejects(
      () => harness.service.rollbackRoomFeatures({ roomId: "room-rollback", expectedVersion: 7, reason: "TEST_ROLLBACK" }),
      (caught) => caught === error
    );
    assert.equal(harness.transactionCalls(), 1);
    assert.equal(harness.updateCalls(), 0);
  }
});

test("M6 boundary guard rejects every room run viewer and version mismatch", () => {
  const expected = { roomId: "room-1", runId: "room-1", userId: "user-1", roleId: "role-1", runVersion: 8, projectionVersion: 4, stateVersion: 12 };
  assert.deepEqual(assertAEmotionM6Boundary(aEmotionM6Boundary(expected), expected), aEmotionM6Boundary(expected));
  for (const patch of [{ roomId: "room-2", runId: "room-2" }, { userId: "user-2" }, { roleId: "role-2" }, { runVersion: 9 }, { projectionVersion: 5 }, { stateVersion: 13 }]) {
    assert.throws(() => assertAEmotionM6Boundary(aEmotionM6Boundary({ ...expected, ...patch }), expected), /A_EMOTION_M6_BOUNDARY_MISMATCH|stale or belongs/u);
  }
});

test("real PostgreSQL M6 recovers expired leases, dead-letters bounded tasks, preserves old-room recovery and supports pause rollback", {
  skip: isolatedDatabaseUrl ? false : "A_EMOTION_M6_TEST_DATABASE_URL is not configured for an isolated test database"
}, async () => {
  Object.assign(process.env, enabledEnv, { DATABASE_URL: isolatedDatabaseUrl! });
  const suffix = randomUUID().replaceAll("-", "");
  const ids = { templateId: `m6-template-${suffix}`, userId: `m6-user-${suffix}`, flaggedRun: `m6-flagged-${suffix}`, legacyRun: `m6-legacy-${suffix}`, nodeFlagged: `m6-node-f-${suffix}`, nodeLegacy: `m6-node-l-${suffix}` };
  const prisma = new PrismaService();
  const service = new AEmotionM6Service(prisma);
  const now = new Date();
  try {
    await prisma.$connect();
    await prisma.worldTemplate.create({ data: { id: ids.templateId, name: "M6", genre: "test", hook: "test", worldBase: "test", status: "test", configJson: {} } });
    await prisma.user.create({ data: { id: ids.userId, openid: `openid-${ids.userId}`, email: `${ids.userId}@example.test`, emailVerifiedAt: now, status: "active" } });
    const common = { templateId: ids.templateId, ownerUserId: ids.userId, title: "M6", hook: "M6", mode: "room", templateKey: "sangtian", status: "playing", maxPlayers: 3, visibility: "private", engineVersion: CONTINUOUS_STORY_ENGINE_VERSION, strategyVersion: "sangtian_v1_2" };
    const frozenAt = new Date("2026-08-10T00:00:00.000Z");
    await prisma.storyRun.create({ data: { ...common, id: ids.flaggedRun, inviteCode: `F${suffix.slice(0, 9)}`, stateJson: { aEmotionRuleset: buildAEmotionM6RoomPolicy({ m1Enabled: true, m2Enabled: true, m3Enabled: true, m4Enabled: true, m5Enabled: true, m6Enabled: true, pollIntervalMs: 7_000, frozenAt }), aEmotionM6Recovery: defaultPauseState(frozenAt), featureFlags: { aEmotionM1: true, aEmotionM2: true, aEmotionM3: true, aEmotionKeyModals: true, aEmotionM4: true, aEmotionSimplePromise: true, aEmotionM5: true, aEmotionStageMilestones: true, aEmotionInteractionHistory: true, aEmotionM6: true, aEmotionRecovery: true }, aEmotionM1: { schemaVersion: "a_emotion_m1_state_v1", stateVersion: 1, metrics: {}, impacts: {} } } } });
    await prisma.storyRun.create({ data: { ...common, id: ids.legacyRun, inviteCode: `L${suffix.slice(0, 9)}`, stateJson: { featureFlags: { aEmotionM1: true } } } });
    await prisma.sceneNode.create({ data: { id: ids.nodeFlagged, runId: ids.flaggedRun, chapterIndex: 1, nodeIndex: 1, title: "M6", publicNarration: "M6", nodeGoal: "M6", actionOptionsJson: [] } });
    await prisma.sceneNode.create({ data: { id: ids.nodeLegacy, runId: ids.legacyRun, chapterIndex: 1, nodeIndex: 1, title: "M6", publicNarration: "M6", nodeGoal: "M6", actionOptionsJson: [] } });
    const expired = new Date(now.getTime() - 5_000); const old = new Date(now.getTime() - 20_000);
    await prisma.storyTaskOutbox.createMany({ data: [
      { runId: ids.flaggedRun, nodeId: ids.nodeFlagged, taskType: "INTERACTION_COMPILE_REQUESTED", status: "RUNNING", dedupeKey: `m6-recover-${suffix}`, maxAttempts: 5, attempt: 1, leaseOwner: "dead-worker", leaseExpiresAt: expired, createdAt: now },
      { runId: ids.flaggedRun, nodeId: ids.nodeFlagged, taskType: "A_EMOTION_M3_CRISIS_COMPILE", status: "RUNNING", dedupeKey: `m6-dead-${suffix}`, maxAttempts: 5, attempt: 5, leaseOwner: "dead-worker", leaseExpiresAt: expired, createdAt: old },
      { runId: ids.flaggedRun, nodeId: ids.nodeFlagged, taskType: "A_EMOTION_M5_STAGE_MILESTONE_COMPILE", status: "COMPLETED", dedupeKey: `m6-complete-${suffix}`, maxAttempts: 5, attempt: 1, completedAt: now },
      { runId: ids.legacyRun, nodeId: ids.nodeLegacy, taskType: "INTERACTION_COMPILE_REQUESTED", status: "RUNNING", dedupeKey: `m6-legacy-${suffix}`, maxAttempts: 5, attempt: 1, leaseOwner: "dead-worker", leaseExpiresAt: expired, createdAt: old }
    ] });
    const first = await service.recoverStaleTasks(undefined, now);
    assert.deepEqual({ recovered: first.recoveredExpiredLeases, legacy: first.recoveredLegacyLeases, dead: first.deadLetteredTasks, completed: first.leftCompletedUntouched }, { recovered: 1, legacy: 1, dead: 1, completed: 1 });
    const second = await service.recoverStaleTasks(undefined, now);
    assert.deepEqual({ recovered: second.recoveredExpiredLeases, legacy: second.recoveredLegacyLeases, dead: second.deadLetteredTasks }, { recovered: 0, legacy: 0, dead: 0 });
    const rows = await prisma.storyTaskOutbox.findMany({ where: { runId: { in: [ids.flaggedRun, ids.legacyRun] } }, orderBy: { dedupeKey: "asc" } });
    assert.equal(rows.find((row) => row.dedupeKey.startsWith("m6-recover"))?.status, "PENDING");
    assert.equal(rows.find((row) => row.dedupeKey.startsWith("m6-dead"))?.status, "FAILED");
    assert.equal(rows.find((row) => row.dedupeKey.startsWith("m6-complete"))?.status, "COMPLETED");
    assert.equal(rows.find((row) => row.dedupeKey.startsWith("m6-legacy"))?.status, "PENDING");
    const beforePause = await prisma.storyRun.findUniqueOrThrow({ where: { id: ids.flaggedRun } });
    const paused = await service.setRoomPaused({ id: ids.userId } as never, { roomId: ids.flaggedRun, expectedVersion: beforePause.version, paused: true, reason: "M6_TEST" });
    assert.equal(paused.paused, true);
    await prisma.$transaction((tx) => assert.rejects(() => service.assertRecoveryAllowed(tx, ids.flaggedRun), /A_EMOTION_M6_ROOM_PAUSED|paused/u));
    const resumed = await service.setRoomPaused({ id: ids.userId } as never, { roomId: ids.flaggedRun, expectedVersion: paused.runVersion, paused: false, reason: "M6_TEST_RESUME" });
    assert.equal(resumed.paused, false);
    const rolled = await service.rollbackRoomFeatures({ roomId: ids.flaggedRun, expectedVersion: resumed.runVersion, reason: "M6_TEST_ROLLBACK" });
    const rolledRun = await prisma.storyRun.findUniqueOrThrow({ where: { id: ids.flaggedRun } });
    assert.equal(rolled.version, rolledRun.version);
    assert.equal((rolledRun.stateJson as any).featureFlags.aEmotionM1, false);
    assert.ok((rolledRun.stateJson as any).aEmotionM1, "rollback must not delete authoritative feature state");
  } finally {
    await prisma.storyRun.deleteMany({ where: { id: { in: [ids.flaggedRun, ids.legacyRun] } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: ids.userId } }).catch(() => undefined);
    await prisma.worldTemplate.deleteMany({ where: { id: ids.templateId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});

function safeTestDatabaseUrl(value: string | undefined) { if (!value) return null; try { const parsed = new URL(value); const marker = `${parsed.hostname}/${parsed.pathname}?${parsed.searchParams.toString()}`.toLowerCase(); return /(?:^|[-_.])test(?:[-_.]|$)|aemotion/.test(marker) ? value : null; } catch { return null; } }
