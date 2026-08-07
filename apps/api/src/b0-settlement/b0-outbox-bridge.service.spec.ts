import assert from "node:assert/strict";
import { B0OutboxBridgeService } from "./b0-outbox-bridge.service";

async function run() {
  const legacyCalls: string[] = [];
  const calls: string[] = [];
  const failures: string[] = [];
  const outbox = {
    executeTask: async (task: { taskType: string }) => {
      legacyCalls.push(task.taskType);
      return { outcome: "LEGACY" };
    },
  };
  const pipeline = {
    recover: async () => ({ recovered: 0 }),
    failTask: async (taskId: string) => { failures.push(taskId); },
    executeSettlementTask: async (taskId: string) => { calls.push(`settlement:${taskId}`); return { outcome: "COMMITTED" }; },
    executePublicationTask: async (taskId: string) => { calls.push(`publication:${taskId}`); return { outcome: "PUBLISHED" }; },
    executeNarrativeTask: async (taskId: string) => { calls.push(`narrative:${taskId}`); return { outcome: "NARRATED" }; },
    executeWindowEventTask: async (taskId: string) => { calls.push(`event:${taskId}`); return { outcome: "RECORDED" }; },
  };
  const bridge = new B0OutboxBridgeService(outbox as any, pipeline as any);
  bridge.onModuleInit();
  const fence = { taskId: "fence", leaseOwner: "worker", leaseVersion: 1 };
  for (const [taskType, expected] of [
    ["B0_SETTLEMENT_REQUESTED", "COMMITTED"],
    ["B0_PUBLISH_STRUCTURED_RESULTS", "PUBLISHED"],
    ["B0_NARRATIVE_GENERATION", "NARRATED"],
    ["B0_WINDOW_EVENT", "RECORDED"],
  ] as const) {
    const result = await (outbox as any).executeTask({ id: taskType, nodeId: "n", windowId: "w", taskType }, fence);
    assert.equal(result.outcome, expected);
  }
  const legacy = await (outbox as any).executeTask({ id: "legacy", nodeId: "n", windowId: null, taskType: "resolve_node" }, fence);
  assert.equal(legacy.outcome, "LEGACY");
  assert.deepEqual(legacyCalls, ["resolve_node"]);
  assert.deepEqual(calls, [
    "settlement:B0_SETTLEMENT_REQUESTED",
    "publication:B0_PUBLISH_STRUCTURED_RESULTS",
    "narrative:B0_NARRATIVE_GENERATION",
    "event:B0_WINDOW_EVENT",
  ]);
  assert.deepEqual(failures, []);
  bridge.onModuleDestroy();
  console.log("B0 outbox bridge contracts: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
