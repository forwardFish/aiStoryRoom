import assert from "node:assert/strict";
import test from "node:test";
import { B0OpsController } from "./b0-ops.controller";

test("C8 admin controller exposes only bounded recovery and read-only diagnostic operations", async () => {
  const calls: string[] = [];
  const pipeline = {
    diagnostics: async (runId: string) => { calls.push(`diagnostics:${runId}`); return { runId }; },
    recover: async () => { calls.push("recover"); return { recovered: 1 }; },
    replayWindow: async (windowId: string) => { calls.push(`replay:${windowId}`); return { windowId, matches: true }; },
    retryTask: async (taskId: string) => { calls.push(`retry:${taskId}`); return { taskId, status: "pending" }; },
    pauseRun: async (runId: string, paused: boolean) => { calls.push(`pause:${runId}:${paused}`); return { runId, paused }; },
    abortWindow: async (windowId: string) => { calls.push(habort:${windowId}`); return { windowId, status: "ABORTED" }; },
  };
  const controller = new B0OpsController(pipeline as any);

  assert.deepEqual(await controller.diagnostics("run.1"), { runId: "run.1" });
  assert.deepEqual(await controller.recover(), { recovered: 1 });
  assert.deepEqual(await controller.replay("window.1"), { windowId: "window.1", matches: true });
  assert.deepEqual(await controller.retry("task.1"), { taskId: "task.1", status: "pending" });
  assert.deepEqual(await controller.pause("run.1", { paused: true }), { runId: "run.1", paused: true });
  assert.deepEqual(await controller.abort("window.1"), { windowId: "window.1", status: "ABORTED" });
  assert.deepEqual(calls, [
    "diagnostics:run.1",
    "recover",
    "replay:window.1",
    "retry:task.1",
    "pause:run.1:true",
    "abort:window.1",
  ]);
});

test("C8 pause body is fail-closed to false unless paused is explicitly true", async () => {
  let received: boolean | null = null;
  const controller = new B0OpsController({
    pauseRun: async (_runId: string, paused: boolean) => { received = paused; return { paused }; },
  } as any);
  await controller.pause("run.1", { paused: "false" });
  assert.equal(received, false);
});
