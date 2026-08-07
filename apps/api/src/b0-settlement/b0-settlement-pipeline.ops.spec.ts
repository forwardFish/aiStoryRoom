import assert from "node:assert/strict";
import test from "node:test";
import { B0SettlementPipelineService } from "./b0-settlement-pipeline.service";

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
          participants: [{ roleId: "role.a", ready: true }],
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

test("C8 diagnostics is read-only and reports window, task, narrative and world sequence state", async () => {
  const { service, calls } = fixture();
  const result = await service.diagnostics("run.1");
  assert.equal(result.runId, "run.1");
  assert.equal(result.worldSequence, 11);
  assert.equal(result.windows.length, 1);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.narrativeCount, 1);
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

test("C8 deadline recovery delegates to the authoritative window coordinator", async () => {
  const { service, calls } = fixture();
  const result = await service.recover(new Date("2026-08-07T00:00:00.000Z"));
  assert.deepEqual(result, { recovered: 1 });
  assert.equal(calls.some((entry) => entry.method === "windows.recoverExpired"), true);
});
