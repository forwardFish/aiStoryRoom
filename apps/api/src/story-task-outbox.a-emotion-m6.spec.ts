import assert from "node:assert/strict";
import test from "node:test";
import { StoryTaskOutboxService } from "./story-task-outbox.service";

function fixture(pausedSequence: boolean[]) {
  const now = Date.now();
  const task: any = {
    id: "task-m6",
    runId: "room-m6",
    nodeId: "node-m6",
    windowId: null,
    taskType: "INTERACTION_COMPILE_REQUESTED",
    status: "PENDING",
    attempt: 0,
    maxAttempts: 5,
    nextRetryAt: new Date(now - 1_000),
    leaseOwner: null,
    leaseExpiresAt: null,
    leaseVersion: 0,
    createdAt: new Date(now - 5_000)
  };
  let compiled = 0;
  const prisma: any = {
    storyTaskOutbox: {
      updateMany: async ({ where, data }: any) => {
        if (where.id && where.id !== task.id) return { count: 0 };
        if (where.status && where.status !== task.status) return { count: 0 };
        if (where.leaseOwner !== undefined && where.leaseOwner !== task.leaseOwner) return { count: 0 };
        if (where.leaseVersion !== undefined && where.leaseVersion !== task.leaseVersion) return { count: 0 };
        if (data.status) task.status = data.status;
        if (data.leaseOwner !== undefined) task.leaseOwner = data.leaseOwner;
        if (data.leaseExpiresAt !== undefined) task.leaseExpiresAt = data.leaseExpiresAt;
        if (data.nextRetryAt) task.nextRetryAt = data.nextRetryAt;
        if (data.startedAt !== undefined) task.startedAt = data.startedAt;
        if (data.lastError !== undefined) task.lastError = data.lastError;
        if (data.attempt?.increment) task.attempt += data.attempt.increment;
        if (data.attempt?.decrement) task.attempt -= data.attempt.decrement;
        if (data.leaseVersion?.increment) task.leaseVersion += data.leaseVersion.increment;
        return { count: 1 };
      },
      findFirst: async ({ where }: any) => {
        if (where?.status && where.status !== task.status) return null;
        return task.nextRetryAt <= new Date() ? { ...task } : null;
      },
      findMany: async () => [{ ...task }],
      findUnique: async () => ({ ...task })
    },
    actionResolution: { findMany: async () => [] },
    storyRun: { updateMany: async () => ({ count: 0 }) }
  };
  const m6: any = {
    recoverStaleTasks: async () => ({ recoveredExpiredLeases: 0, recoveredLegacyLeases: 0, deadLetteredTasks: 0, leftCompletedUntouched: 0 }),
    isRunPaused: async () => pausedSequence.shift() ?? false
  };
  const m1: any = { executeCompileTask: async () => { compiled += 1; return { outcome: "COMPLETED" }; } };
  const service = new StoryTaskOutboxService(
    prisma,
    null as never,
    { sweep: async () => undefined } as never,
    null as never,
    null as never,
    { failReservedResultTask: async () => undefined } as never,
    { executePublishRecoveryTask: async () => undefined } as never,
    m1,
    null,
    null,
    null,
    null,
    m6
  );
  return { service, task, get compiled() { return compiled; } };
}

test("M6 paused room defers a pending interaction task before lease claim without spending an attempt", async () => {
  const value = fixture([true]);
  await value.service.drainOne();
  assert.equal(value.task.status, "PENDING");
  assert.equal(value.task.attempt, 0);
  assert.equal(value.task.lastError, "A_EMOTION_M6_ROOM_PAUSED");
  assert.ok(value.task.nextRetryAt.getTime() > Date.now());
  assert.equal(value.compiled, 0);
});

test("M6 pause racing after lease claim requeues the task and restores its retry budget", async () => {
  const value = fixture([false, true]);
  await value.service.drainOne();
  assert.equal(value.task.status, "PENDING");
  assert.equal(value.task.attempt, 0);
  assert.equal(value.task.lastError, "A_EMOTION_M6_ROOM_PAUSED");
  assert.equal(value.task.leaseOwner, null);
  assert.equal(value.task.leaseExpiresAt, null);
  assert.equal(value.compiled, 0);
});
