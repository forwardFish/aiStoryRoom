import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import {
  assertIdempotencyFingerprint,
  assertSingleStepAdvance,
  casAdvanceWorkingRevision,
  casAdvanceWorldSequence,
  casAdvanceNarrativeProjection,
  casClaimOutboxTask,
  casCompleteOutboxTask,
} from "./cas";
import { PressurePersistenceError } from "./errors";

test("idempotency replays only the same canonical fingerprint", () => {
  assert.equal(assertIdempotencyFingerprint(null, "hash-1"), "CREATE");
  assert.equal(assertIdempotencyFingerprint({ requestFingerprint: "hash-1" }, "hash-1"), "REPLAY");
  assert.throws(
    () => assertIdempotencyFingerprint({ requestFingerprint: "hash-1" }, "hash-2"),
    (error: unknown) => error instanceof PressurePersistenceError
      && error.code === "PRESSURE_PERSISTENCE_FINGERPRINT_MISMATCH",
  );
});

test("working and world revisions advance exactly once", () => {
  assert.doesNotThrow(() => assertSingleStepAdvance(0, 1, "workingRevision"));
  assert.doesNotThrow(() => assertSingleStepAdvance(6, 7, "worldSequence", 7));
  assert.throws(() => assertSingleStepAdvance(0, 2, "worldSequence", 7));
  assert.throws(() => assertSingleStepAdvance(7, 8, "worldSequence", 7));
});

test("working-state CAS binds run, chapter, revision and state hash", async () => {
  let command: unknown;
  const tx = {
    pressureChapterRuntime: {
      updateMany: async (value: unknown) => {
        command = value;
        return { count: 1 };
      },
    },
  } as unknown as Prisma.TransactionClient;

  const committed = await casAdvanceWorkingRevision(tx, {
    runId: "run-1",
    chapterRuntimeId: "chapter-1",
    expectedWorkingRevision: 3,
    committedWorkingRevision: 4,
    expectedWorkingStateHash: "before-hash",
    committedWorkingStateHash: "after-hash",
    committedWorkingStateJson: { state: "after" },
  });
  assert.equal(committed, 4);
  assert.deepEqual(command, {
    where: {
      id: "chapter-1",
      runId: "run-1",
      workingRevision: 3,
      workingStateHash: "before-hash",
      state: { not: "CHAPTER_FROZEN" },
    },
    data: {
      workingRevision: 4,
      workingStateHash: "after-hash",
      workingStateJson: { state: "after" },
      lockVersion: { increment: 1 },
    },
  });
});

test("worldSequence CAS is Pressure-routed and cannot create sequence 8", async () => {
  let command: any;
  const tx = {
    storyRun: {
      updateMany: async (value: unknown) => {
        command = value;
        return { count: 1 };
      },
    },
  } as unknown as Prisma.TransactionClient;
  assert.equal(await casAdvanceWorldSequence(tx, {
    runId: "run-1",
    expectedWorldSequence: 0,
    committedWorldSequence: 1,
  }), 1);
  assert.deepEqual(command.where.pressureRouteSnapshot, { isNot: null });
  await assert.rejects(() => casAdvanceWorldSequence(tx, {
    runId: "run-1",
    expectedWorldSequence: 7,
    committedWorldSequence: 8,
  }));
});

test("Outbox lease uses leaseVersion as a fencing CAS", async () => {
  const commands: any[] = [];
  const tx = {
    pressureOutboxTask: {
      findUnique: async () => ({ attempt: 0, maxAttempts: 5 }),
      updateMany: async (value: unknown) => {
        commands.push(value);
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({ id: "task-1", leaseVersion: 5 }),
    },
  } as unknown as Prisma.TransactionClient;
  const now = new Date("2026-08-12T00:00:00.000Z");
  const leaseExpiresAt = new Date("2026-08-12T00:01:00.000Z");
  await casClaimOutboxTask(tx, {
    taskId: "task-1",
    workerId: "worker-1",
    now,
    leaseExpiresAt,
    expectedLeaseVersion: 4,
  });
  assert.equal(commands[0].where.leaseVersion, 4);
  assert.equal(commands[0].where.attempt, 0);
  assert.deepEqual(commands[0].data.leaseVersion, { increment: 1 });

  await casCompleteOutboxTask(tx, {
    taskId: "task-1",
    workerId: "worker-1",
    leaseVersion: 5,
    completedAt: new Date("2026-08-12T00:00:30.000Z"),
  });
  assert.equal(commands[1].where.leaseVersion, 5);
  assert.equal(commands[1].data.status, "COMPLETED");
});

test("Narrative published states require an immutable artifact reference", async () => {
  const tx = {
    pressureNarrativeProjection: {
      updateMany: async () => ({ count: 1 }),
    },
  } as unknown as Prisma.TransactionClient;
  await assert.rejects(() => casAdvanceNarrativeProjection(tx, {
    projectionId: "projection-1",
    expectedStatus: "VALIDATING",
    nextStatus: "PUBLISHED",
    expectedLeaseVersion: 1,
    workerId: "worker-1",
    now: new Date("2026-08-12T00:00:00.000Z"),
  }), /must reference its immutable artifact/);
});
