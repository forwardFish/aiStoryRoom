import assert from "node:assert/strict";
import { normalizeStoryTaskLeaseMs, requiresOutboxHeartbeat, ROLE_AGENT_TASK_CONCURRENCY, StoryTaskOutboxService } from "./story-task-outbox.service";

function futureLease() {
  return new Date(Date.now() + 60_000);
}

function task(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: "task-1",
    runId: "run-1",
    nodeId: "node-1",
    windowId: "window-1",
    roleId: null,
    actionSlot: null,
    controlEpoch: null,
    dedupeKey: "RESOLVE:window-1",
    taskType: "RESOLVE_WINDOW",
    status: "running",
    outcome: null,
    inputRefId: null,
    checkpointKey: null,
    attempt: 1,
    maxAttempts: 3,
    nextRetryAt: now,
    leaseOwner: "pending-worker-id",
    leaseExpiresAt: futureLease(),
    leaseVersion: 7,
    startedAt: now,
    completedAt: null,
    resultJson: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function serviceWith(prisma: any, story: any = {}, resolution: any = {}, roleAgents: any = {}) {
  const service = new StoryTaskOutboxService(
    prisma as any,
    { resolveNode: async () => ({ outcome: "LEGACY" }), ...story } as any,
    { sweep: async () => undefined } as any,
    { resolve: async () => ({ outcome: "RESOLVED" }), ...resolution } as any,
    { execute: async () => ({ outcome: "SEALED_ACT" }), ...roleAgents } as any
  );
  return { service, workerId: (service as any).workerId as string };
}

async function claimUsesPostClaimFence() {
  const updates: any[] = [];
  const calls: any[] = [];
  let claimedTask: any;
  const candidate = task({ status: "pending", leaseOwner: null, leaseExpiresAt: null, leaseVersion: 3, attempt: 0 });
  const prisma = {
    storyTaskOutbox: {
      findFirst: async () => candidate,
      findUnique: async () => claimedTask,
      updateMany: async (args: any) => {
        updates.push(args);
        if (args.data.status === "running") {
          claimedTask = task({ leaseOwner: args.data.leaseOwner, leaseVersion: 4, attempt: 1 });
        }
        return { count: 1 };
      }
    },
    storyRun: { updateMany: async () => ({ count: 0 }) }
  };
  const { service, workerId } = serviceWith(prisma, {}, {
    resolve: async (windowId: string, fence: unknown) => {
      calls.push({ windowId, fence });
      return { outcome: "RESOLVED" };
    }
  });
  await service.drainOne();
  assert.deepEqual(calls, [{
    windowId: "window-1",
    fence: { taskId: "task-1", leaseOwner: workerId, leaseVersion: 4 }
  }]);
  const completed = updates.find((entry) => entry.data.status === "completed");
  assert.equal(completed.where.status, "running");
  assert.equal(completed.where.leaseOwner, workerId);
  assert.equal(completed.where.leaseVersion, 4);
  assert.ok(completed.where.leaseExpiresAt.gt instanceof Date);
}

async function retryBoundaryUsesIncrementedAttempt() {
  for (const scenario of [
    { attempt: 2, expected: "pending" },
    { attempt: 3, expected: "failed" }
  ]) {
    const updates: any[] = [];
    const current = task({ taskType: "resolve_node", windowId: null, attempt: scenario.attempt, maxAttempts: 3 });
    const prisma = {
      storyTaskOutbox: {
        findUnique: async () => current,
        updateMany: async (args: any) => { updates.push(args); return { count: 1 }; }
      },
      storyRun: { updateMany: async () => ({ count: 1 }) }
    };
    const { service, workerId } = serviceWith(prisma, { resolveNode: async () => { throw new Error("expected failure"); } });
    current.leaseOwner = workerId;
    await (service as any).process(current.id);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].data.status, scenario.expected);
    assert.equal(updates[0].where.leaseVersion, 7);
    assert.equal(updates[0].where.leaseOwner, workerId);
    assert.ok(updates[0].where.leaseExpiresAt.gt instanceof Date);
    if (scenario.expected === "pending") {
      const retryDelay = updates[0].data.nextRetryAt.getTime() - Date.now();
      assert.ok(retryDelay > 800 && retryDelay <= 1_000, `unexpected retry delay ${retryDelay}`);
    }
  }
}

async function staleLeaseCannotRecordFailure() {
  const updates: any[] = [];
  let runUpdates = 0;
  const current = task({ taskType: "resolve_node", windowId: null, attempt: 3, maxAttempts: 3 });
  const prisma = {
    storyTaskOutbox: {
      findUnique: async () => current,
      updateMany: async (args: any) => { updates.push(args); return { count: 0 }; }
    },
    storyRun: { updateMany: async () => { runUpdates += 1; return { count: 1 }; } }
  };
  const { service, workerId } = serviceWith(prisma, { resolveNode: async () => { throw new Error("late failure"); } });
  current.leaseOwner = workerId;
  await (service as any).process(current.id);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.status, "failed");
  assert.equal(runUpdates, 0, "a stale worker must not mutate its run after losing the task lease");
}

async function injectedExitLeavesLeaseUntouched() {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    FAIL_ROLE_AGENT_AT: process.env.FAIL_ROLE_AGENT_AT,
    FAIL_ROLE_AGENT_TASK_ID: process.env.FAIL_ROLE_AGENT_TASK_ID,
    STORY_WORKER_PROCESS: process.env.STORY_WORKER_PROCESS
  };
  process.env.NODE_ENV = "test";
  process.env.FAIL_ROLE_AGENT_AT = "TASK_LEASED";
  process.env.FAIL_ROLE_AGENT_TASK_ID = "task-1";
  delete process.env.STORY_WORKER_PROCESS;
  try {
    const updates: any[] = [];
    let executed = false;
    const current = task({ taskType: "ROLE_AGENT_DECISION", inputRefId: "decision-1" });
    const prisma = {
      storyTaskOutbox: {
        findUnique: async () => current,
        updateMany: async (args: any) => { updates.push(args); return { count: 1 }; }
      },
      storyRun: { updateMany: async () => ({ count: 0 }) }
    };
    const { service, workerId } = serviceWith(prisma, {}, {}, {
      execute: async () => { executed = true; return { outcome: "SEALED_ACT" }; }
    });
    current.leaseOwner = workerId;
    await (service as any).process(current.id);
    assert.equal(executed, false);
    assert.deepEqual(updates, [], "injected checkpoint exits must not complete, fail, or release the task");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

async function roleAgentProviderWaitsRunConcurrently() {
  const candidates = [1, 2, 3].map((index) => task({
    id: `agent-task-${index}`,
    roleId: `role-${index}`,
    dedupeKey: `ROLE_AGENT:window-1:role-${index}:MAIN:1`,
    taskType: "ROLE_AGENT_DECISION",
    status: "pending",
    leaseOwner: null,
    leaseExpiresAt: null,
    leaseVersion: 0,
    attempt: 0
  }));
  const claimed = new Map<string, any>();
  let active = 0;
  let maximumActive = 0;
  const executed: string[] = [];
  const prisma = {
    storyTaskOutbox: {
      findFirst: async () => candidates[0],
      findMany: async (args: any) => candidates.slice(0, args.take),
      findUnique: async ({ where }: any) => claimed.get(where.id),
      updateMany: async (args: any) => {
        if (args.data.status === "running") {
          const candidate = candidates.find((entry) => entry.id === args.where.id)!;
          claimed.set(candidate.id, { ...candidate, status: "running", leaseOwner: args.data.leaseOwner, leaseExpiresAt: futureLease(), leaseVersion: 1, attempt: 1 });
          return { count: 1 };
        }
        if (args.data.status === "completed") return { count: 1 };
        return { count: 0 };
      }
    },
    storyRun: { updateMany: async () => ({ count: 0 }) }
  };
  const { service } = serviceWith(prisma, {}, {}, {
    execute: async (taskId: string) => {
      executed.push(taskId);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return { outcome: "SEALED_ACT" };
    }
  });
  await service.drainReadyTasks();
  assert.equal(ROLE_AGENT_TASK_CONCURRENCY, 3);
  assert.equal(maximumActive, 3, "three role-provider waits must overlap instead of serializing");
  assert.deepEqual(executed.sort(), candidates.map((entry) => entry.id).sort());
}

async function roleAgentLeaseLossNeverCompletesTheOutboxTask() {
  const updates: any[] = [];
  const current = task({ taskType: "ROLE_AGENT_DECISION", inputRefId: "decision-lease-lost" });
  const prisma = {
    storyTaskOutbox: {
      findUnique: async () => current,
      updateMany: async (args: any) => { updates.push(args); return { count: 1 }; }
    },
    storyRun: { updateMany: async () => ({ count: 0 }) }
  };
  const { service, workerId } = serviceWith(prisma, {}, {}, {
    execute: async () => ({ outcome: "LEASE_LOST" })
  });
  current.leaseOwner = workerId;

  await (service as any).process(current.id);

  assert.deepEqual(updates, [], "a worker that lost its lease must not mark the outbox task completed");
}

function leaseConfigurationIsBounded() {
  assert.equal(normalizeStoryTaskLeaseMs(undefined), 30_000);
  assert.equal(normalizeStoryTaskLeaseMs(1_000), 5_000);
  assert.equal(normalizeStoryTaskLeaseMs(12_345.9), 12_345);
  assert.equal(normalizeStoryTaskLeaseMs(999_999), 300_000);
  assert.equal(normalizeStoryTaskLeaseMs('invalid'), 30_000);
  assert.equal(requiresOutboxHeartbeat('RESOLVE_WINDOW'), false);
  assert.equal(requiresOutboxHeartbeat('ROLE_AGENT_DECISION'), true);
  assert.equal(requiresOutboxHeartbeat('resolve_node'), true);
}

async function run() {
  leaseConfigurationIsBounded();
  await claimUsesPostClaimFence();
  await retryBoundaryUsesIncrementedAttempt();
  await staleLeaseCannotRecordFailure();
  await injectedExitLeavesLeaseUntouched();
  await roleAgentLeaseLossNeverCompletesTheOutboxTask();
  await roleAgentProviderWaitsRunConcurrently();
  console.log("story-task outbox lease fencing contracts: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
