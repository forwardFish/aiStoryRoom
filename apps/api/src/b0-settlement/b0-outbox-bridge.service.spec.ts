import assert from "node:assert/strict";
import test from "node:test";
import { B0OutboxBridgeService } from "./b0-outbox-bridge.service";

function createFixture(overrides: Partial<Record<string, unknown>> = {}) {
  const legacyCalls: string[] = [];
  const calls: string[] = [];
  const failures: Array<{ taskId: string; reason: string }> = [];
  const outbox = {
    executeTask: async (task: { taskType: string }) => {
      legacyCalls.push(task.taskType);
      return { outcome: "LEGACY" };
    },
  };
  const pipeline = {
    recover: async () => ({ recovered: 0 }),
    failTask: async (taskId: string, reason: string) => {
      failures.push({ taskId, reason });
    },
    executeSettlementTask: async (taskId: string) => {
      calls.push(`settlement:${taskId}`);
      return { outcome: "COMMITTED" };
    },
    executePublicationTask: async (taskId: string) => {
      calls.push(`publication:${taskId}`);
      return { outcome: "PUBLISHED" };
    },
    executeNarrativeTask: async (taskId: string) => {
      calls.push(`narrative:${taskId}`);
      return { outcome: "NARRATED" };
    },
    executeWindowEventTask: async (taskId: string) => {
      calls.push(`event:${taskId}`);
      return { outcome: "RECORDED" };
    },
    ...overrides,
  };
  const bridge = new B0OutboxBridgeService(outbox as any, pipeline as any);
  bridge.onModuleInit();
  return { bridge, outbox, calls, failures, legacyCalls };
}

const fence = { taskId: "fence", leaseOwner: "worker", leaseVersion: 1 };

test("routes every B0 task through the existing leased outbox worker and preserves legacy tasks", async () => {
  const fixture = createFixture();
  try {
    for (const [taskType, expected] of [
      ["B0_SETTLEMENT_REQUESTED", "COMMITTED"],
      ["B0_PUBLISH_STRUCTURED_RESULTS", "PUBLISHED"],
      ["B0_NARRATIVE_GENERATION", "NARRATED"],
      ["B0_WINDOW_EVENT", "RECORDED"],
    ] as const) {
      const result = await (fixture.outbox as any).executeTask(
        { id: taskType, nodeId: "n", windowId: "w", taskType },
        fence,
      );
      assert.equal(result.outcome, expected);
    }

    const legacy = await (fixture.outbox as any).executeTask(
      { id: "legacy", nodeId: "n", windowId: null, taskType: "resolve_node" },
      fence,
    );
    assert.equal(legacy.outcome, "LEGACY");
    assert.deepEqual(fixture.legacyCalls, ["resolve_node"]);
    assert.deepEqual(fixture.calls, [
      "settlement:B0_SETTLEMENT_REQUESTED",
      "publication:B0_PUBLISH_STRUCTURED_RESULTS",
      "narrative:B0_NARRATIVE_GENERATION",
      "event:B0_WINDOW_EVENT",
    ]);
    assert.deepEqual(fixture.failures, []);
  } finally {
    fixture.bridge.onModuleDestroy();
  }
});

test("records a B0 task failure without consuming the legacy handler or hiding the original error", async () => {
  const fixture = createFixture({
    executeSettlementTask: async () => {
      throw new Error("SETTLEMENT_VALIDATION_FAILED");
    },
  });
  try {
    await assert.rejects(
      () => (fixture.outbox as any).executeTask(
        { id: "task.failed", nodeId: "n", windowId: "w", taskType: "B0_SETTLEMENT_REQUESTED" },
        fence,
      ),
      /SETTLEMENT_VALIDATION_FAILED/,
    );
    assert.deepEqual(fixture.failures, [{
      taskId: "task.failed",
      reason: "SETTLEMENT_VALIDATION_FAILED",
    }]);
    assert.deepEqual(fixture.legacyCalls, []);
  } finally {
    fixture.bridge.onModuleDestroy();
  }
});
