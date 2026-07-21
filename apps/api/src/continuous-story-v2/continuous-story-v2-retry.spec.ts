import assert from "node:assert/strict";
import test from "node:test";
import { ContinuousStoryV2Service } from "./continuous-story-v2.service";

function serviceForOpening(status: "FAILED" | "PENDING" | "RUNNING") {
  const updates: unknown[] = [];
  const prisma = {
    storyPlayer: { findFirst: async () => ({ roleId: "role-1" }) },
    actorTurn: { findFirst: async () => ({ id: "opening-turn-1" }) },
    storyTaskOutbox: {
      findUnique: async ({ where }: any) => {
        assert.equal(where.dedupeKey, "ACTOR_OPENING_V2:opening-turn-1");
        return { id: "opening-task-1", status };
      },
      updateMany: async (input: unknown) => { updates.push(input); return { count: 1 }; }
    },
    actionResolution: { findFirst: async () => { throw new Error("opening recovery must run before result recovery"); } }
  };
  return {
    service: new ContinuousStoryV2Service(prisma as any, null as any, null as any, null as any, null as any, null as any, null as any),
    updates
  };
}

test("explicit opening recovery requeues a failed publication task without creating a second task", async () => {
  const { service, updates } = serviceForOpening("FAILED");

  const result = await service.retryResultGeneration({ id: "user-1" } as any, "run-1");

  assert.deepEqual(result, { scheduled: true, status: "REQUEUED", taskId: "opening-task-1", kind: "OPENING" });
  assert.equal(updates.length, 1);
  assert.deepEqual((updates[0] as any).where, { id: "opening-task-1", status: "FAILED" });
  assert.equal((updates[0] as any).data.status, "PENDING");
  assert.equal((updates[0] as any).data.attempt, 0);
});

test("explicit opening recovery observes an existing task without mutating it", async () => {
  const { service, updates } = serviceForOpening("RUNNING");

  const result = await service.retryResultGeneration({ id: "user-1" } as any, "run-1");

  assert.deepEqual(result, { scheduled: true, status: "RUNNING", taskId: "opening-task-1", kind: "OPENING" });
  assert.equal(updates.length, 0);
});
