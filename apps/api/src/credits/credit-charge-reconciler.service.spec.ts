import assert from "node:assert/strict";
import test from "node:test";
import { CreditChargeReconcilerService } from "./credit-charge-reconciler.service";

test("reconciler commits published work, releases orphans, and keeps reclaimable outbox work", async () => {
  const now = new Date("2026-07-21T05:00:00.000Z");
  const charges = [
    { id: "charge-orphan", chargeType: "RUN_CREATE", runId: "missing-run", playerActionId: null, status: "RESERVED" },
    { id: "charge-published", chargeType: "PLAYER_ACTION", runId: "run-published", playerActionId: "action-published", status: "RESERVED" },
    { id: "charge-live", chargeType: "PLAYER_ACTION", runId: "run-live", playerActionId: "action-live", status: "RESERVED" }
  ];
  const commits: string[] = [];
  const releases: Array<[string, string]> = [];
  const prisma: any = {
    creditCharge: { findMany: async () => charges },
    storyRun: {
      findUnique: async ({ where }: any) => where.id === "missing-run" ? null : { id: where.id, status: "playing", engineVersion: "continuous_story_v2", mode: "room" },
      findMany: async () => [{ id: "terminal-run" }]
    },
    playerAction: {
      findUnique: async ({ where }: any) => where.id === "action-published"
        ? { id: where.id, runId: "run-published", nodeId: "node-published", status: "accepted" }
        : { id: where.id, runId: "run-live", nodeId: "node-live", status: "accepted" }
    },
    actionResolution: { findUnique: async ({ where }: any) => where.playerActionId === "action-published" ? { qualityStatus: "PASSED" } : null },
    actionWindow: { findUnique: async () => null },
    storyTaskOutbox: { findFirst: async ({ where }: any) => where.nodeId === "node-live" ? { id: "task-live", status: "RUNNING", attempt: 1, maxAttempts: 3, leaseExpiresAt: new Date("2026-07-21T04:59:00.000Z") } : null },
    soloGenerationAttempt: { findFirst: async () => null },
    runCreditAllowance: { updateMany: async () => ({ count: 1 }) },
    sponsorshipRequest: { updateMany: async () => ({ count: 1 }) }
  };
  const consumption: any = {
    commitCharge: async (id: string) => { commits.push(id); },
    releaseCharge: async (id: string, reason: string) => { releases.push([id, reason]); }
  };
  const service = new CreditChargeReconcilerService(prisma, consumption);
  const result = await service.reconcileOnce({ now });
  assert.deepEqual(commits, ["charge-published"]);
  assert.deepEqual(releases, [["charge-orphan", "RUN_CREATE_ORPHANED"]]);
  assert.deepEqual(
    { inspected: result.inspected, committed: result.committed, released: result.released, kept: result.kept, errors: result.errors },
    { inspected: 3, committed: 1, released: 1, kept: 1, errors: 0 }
  );
  assert.equal(result.expiredAllowances, 2);
});

test("reconciler releases an unpublished charge after related worker attempts are exhausted", async () => {
  const releases: Array<[string, string]> = [];
  const prisma: any = {
    creditCharge: { findMany: async () => [{ id: "charge-failed", chargeType: "PLAYER_ACTION", runId: "run", playerActionId: "action", status: "RESERVED" }] },
    storyRun: { findUnique: async () => ({ id: "run", status: "playing" }), findMany: async () => [] },
    playerAction: { findUnique: async () => ({ id: "action", runId: "run", nodeId: "node", status: "accepted" }) },
    actionResolution: { findUnique: async () => ({ id: "resolution", qualityStatus: "FAIL" }) },
    actionWindow: { findUnique: async () => null },
    storyTaskOutbox: { findFirst: async () => ({ id: "task", status: "FAILED", attempt: 5, maxAttempts: 5 }) },
    soloGenerationAttempt: { findFirst: async () => null },
    runCreditAllowance: { updateMany: async () => ({ count: 0 }) },
    sponsorshipRequest: { updateMany: async () => ({ count: 0 }) }
  };
  const service = new CreditChargeReconcilerService(prisma, {
    commitCharge: async () => { throw new Error("must not commit"); },
    releaseCharge: async (id: string, reason: string) => { releases.push([id, reason]); }
  } as any);
  const result = await service.reconcileOnce({ now: new Date("2026-07-21T05:00:00.000Z") });
  assert.deepEqual(releases, [["charge-failed", "GENERATION_RETRY_EXHAUSTED"]]);
  assert.equal(result.released, 1);
});

test("reconciler never commits a V2 Solo run before its playable opening is fully published", async () => {
  const commits: string[] = [];
  const releases: Array<[string, string]> = [];
  const charges = [
    { id: "charge-v2-published", chargeType: "RUN_CREATE", runId: "v2-published", status: "RESERVED" },
    { id: "charge-v2-pending", chargeType: "RUN_CREATE", runId: "v2-pending", status: "RESERVED" },
    { id: "charge-v2-failed", chargeType: "RUN_CREATE", runId: "v2-failed", status: "RESERVED" }
  ];
  const prisma: any = {
    creditCharge: { findMany: async () => charges },
    storyRun: {
      findUnique: async ({ where }: any) => ({
        id: where.id,
        status: "playing",
        engineVersion: "continuous_story_v2",
        mode: "room",
        maxPlayers: 1,
        stateJson: { room: { solo: true } }
      }),
      findMany: async () => []
    },
    actorTurn: {
      findFirst: async ({ where }: any) => where.runId === "v2-published" ? { id: "turn-v2-published" } : null
    },
    decisionSet: {
      findUnique: async ({ where }: any) => where.turnId === "turn-v2-published" ? { id: "decisions-v2-published" } : null
    },
    narrativeEntry: {
      findUnique: async ({ where }: any) => where.dedupeKey === "v2-opening:turn-v2-published" ? { id: "opening-v2-published" } : null
    },
    storyTaskOutbox: {
      findFirst: async ({ where }: any) => where.runId === "v2-pending"
        ? { id: "opening-task-pending", status: "PENDING", attempt: 0, maxAttempts: 3 }
        : where.runId === "v2-failed"
          ? { id: "opening-task-failed", status: "FAILED", attempt: 3, maxAttempts: 3 }
          : null
    },
    soloGenerationAttempt: { findFirst: async () => null },
    runCreditAllowance: { updateMany: async () => ({ count: 0 }) },
    sponsorshipRequest: { updateMany: async () => ({ count: 0 }) }
  };
  const service = new CreditChargeReconcilerService(prisma, {
    commitCharge: async (id: string) => { commits.push(id); },
    releaseCharge: async (id: string, reason: string) => { releases.push([id, reason]); }
  } as any);

  const result = await service.reconcileOnce({ now: new Date("2026-07-21T05:00:00.000Z") });

  assert.deepEqual(commits, ["charge-v2-published"]);
  assert.deepEqual(releases, [["charge-v2-failed", "V2_SOLO_OPENING_TERMINAL_FAILURE"]]);
  assert.deepEqual(
    { committed: result.committed, released: result.released, kept: result.kept, errors: result.errors },
    { committed: 1, released: 1, kept: 1, errors: 0 }
  );
});

test("reconciler preserves Solo charges while stored provider output has a durable publish recovery task", async () => {
  const charges = [
    { id: "charge-solo-opening", chargeType: "RUN_CREATE", runId: "solo-opening", playerActionId: null, status: "RESERVED" },
    { id: "charge-solo-action", chargeType: "PLAYER_ACTION", runId: "solo-action", playerActionId: "action-solo", status: "RESERVED" },
    { id: "charge-solo-opening-after-publish-failure", chargeType: "RUN_CREATE", runId: "solo-opening-retry", playerActionId: null, status: "RESERVED" },
    { id: "charge-solo-action-after-publish-failure", chargeType: "PLAYER_ACTION", runId: "solo-action-retry", playerActionId: "action-solo-retry", status: "RESERVED" }
  ];
  const prisma: any = {
    creditCharge: { findMany: async () => charges },
    storyRun: {
      findUnique: async ({ where }: any) => ({ id: where.id, status: "playing", engineVersion: "solo_story_v2", mode: "room", maxPlayers: 1, stateJson: { room: { solo: true } } }),
      findMany: async () => []
    },
    actorTurn: { findFirst: async () => null },
    playerAction: { findUnique: async ({ where }: any) => ({ id: where.id, runId: where.id === "action-solo-retry" ? "solo-action-retry" : "solo-action", nodeId: `node-${where.id}`, status: "accepted" }) },
    actionResolution: { findUnique: async () => null },
    actionWindow: { findUnique: async () => null },
    soloGenerationAttempt: {
      findFirst: async ({ where }: any) => where.triggerType === "OPENING"
        ? { id: where.runId === "solo-opening-retry" ? "attempt-opening-retry" : "attempt-opening", status: where.runId === "solo-opening-retry" ? "FAILED_RETRYABLE" : "SUCCEEDED", leaseExpiresAt: null, updatedAt: new Date("2026-07-21T04:00:00.000Z") }
        : where.submission
          ? { id: where.submission.playerActionId === "action-solo-retry" ? "attempt-action-retry" : "attempt-action", status: where.submission.playerActionId === "action-solo-retry" ? "FAILED_RETRYABLE" : "SUCCEEDED", leaseExpiresAt: null, updatedAt: new Date("2026-07-21T04:00:00.000Z") }
          : null
    },
    storyTaskOutbox: {
      findFirst: async ({ where }: any) => where.inputRefId
        ? { id: `task-${where.inputRefId}`, status: "PENDING", attempt: 0, maxAttempts: 5 }
        : null
    },
    runCreditAllowance: { updateMany: async () => ({ count: 0 }) },
    sponsorshipRequest: { updateMany: async () => ({ count: 0 }) }
  };
  const service = new CreditChargeReconcilerService(prisma, {
    commitCharge: async () => { throw new Error("must not commit before publish"); },
    releaseCharge: async () => { throw new Error("must not release recoverable output"); }
  } as any);

  const result = await service.reconcileOnce({ now: new Date("2026-07-21T05:00:00.000Z") });

  assert.deepEqual(
    { inspected: result.inspected, committed: result.committed, released: result.released, kept: result.kept, errors: result.errors },
    { inspected: 4, committed: 0, released: 0, kept: 4, errors: 0 }
  );
});

test("all seven crash boundaries converge without duplicate charge transitions", async () => {
  const now = new Date("2026-07-21T05:00:00.000Z");
  const charges = [
    { id: "reserve-before-outbox", chargeType: "RUN_CREATE", runId: "missing-run", playerActionId: null, status: "RESERVED" },
    { id: "claimed-before-provider", chargeType: "PLAYER_ACTION", runId: "run-claimed", playerActionId: "action-claimed", status: "RESERVED" },
    { id: "provider-before-publish", chargeType: "PLAYER_ACTION", runId: "run-provider", playerActionId: "action-provider", status: "RESERVED" },
    { id: "publish-before-response", chargeType: "PLAYER_ACTION", runId: "run-published", playerActionId: "action-published", status: "RESERVED" },
    { id: "lease-expired", chargeType: "PLAYER_ACTION", runId: "run-lease", playerActionId: "action-lease", status: "RESERVED" },
    { id: "quality-rejected", chargeType: "PLAYER_ACTION", runId: "run-quality", playerActionId: "action-quality", status: "RESERVED" },
    { id: "attempts-exhausted", chargeType: "PLAYER_ACTION", runId: "run-exhausted", playerActionId: "action-exhausted", status: "RESERVED" }
  ];
  const transitions: Array<[string, "COMMITTED" | "RELEASED", string?]> = [];
  const actions = new Map([
    ["action-claimed", { id: "action-claimed", runId: "run-claimed", nodeId: "node-claimed", status: "accepted" }],
    ["action-provider", { id: "action-provider", runId: "run-provider", nodeId: "node-provider", status: "accepted" }],
    ["action-published", { id: "action-published", runId: "run-published", nodeId: "node-published", status: "resolved" }],
    ["action-lease", { id: "action-lease", runId: "run-lease", nodeId: "node-lease", status: "accepted" }],
    ["action-quality", { id: "action-quality", runId: "run-quality", nodeId: "node-quality", status: "rejected" }],
    ["action-exhausted", { id: "action-exhausted", runId: "run-exhausted", nodeId: "node-exhausted", status: "accepted" }]
  ]);
  const prisma: any = {
    creditCharge: { findMany: async () => charges.filter((charge) => charge.status === "RESERVED") },
    storyRun: {
      findUnique: async ({ where }: any) => where.id === "missing-run" ? null : ({ id: where.id, status: "playing", engineVersion: where.id === "run-provider" ? "solo_story_v2" : "continuous_story_v2", mode: "room" }),
      findMany: async () => []
    },
    playerAction: { findUnique: async ({ where }: any) => actions.get(where.id) || null },
    actionResolution: { findUnique: async ({ where }: any) => where.playerActionId === "action-published" ? { id: "resolution-published", qualityStatus: "PASSED" } : null },
    actionWindow: { findUnique: async () => null },
    storyTaskOutbox: {
      findFirst: async ({ where }: any) => {
        if (where.inputRefId === "attempt-provider") return { id: "recovery-provider", status: "PENDING", attempt: 0, maxAttempts: 5 };
        if (where.nodeId === "node-claimed") return { id: "task-claimed", status: "RUNNING", attempt: 1, maxAttempts: 3, leaseExpiresAt: new Date("2026-07-21T05:01:00.000Z") };
        if (where.nodeId === "node-lease") return { id: "task-lease", status: "RUNNING", attempt: 1, maxAttempts: 3, leaseExpiresAt: new Date("2026-07-21T04:59:00.000Z") };
        if (where.nodeId === "node-exhausted") return { id: "task-exhausted", status: "FAILED", attempt: 3, maxAttempts: 3, leaseExpiresAt: null };
        return null;
      }
    },
    soloGenerationAttempt: {
      findFirst: async ({ where }: any) => where.submission?.playerActionId === "action-provider"
        ? { id: "attempt-provider", status: "FAILED_RETRYABLE", leaseExpiresAt: null, updatedAt: new Date("2026-07-21T04:00:00.000Z") }
        : null
    },
    runCreditAllowance: { updateMany: async () => ({ count: 0 }) },
    sponsorshipRequest: { updateMany: async () => ({ count: 0 }) }
  };
  const service = new CreditChargeReconcilerService(prisma, {
    commitCharge: async (id: string) => {
      const charge = charges.find((entry) => entry.id === id)!;
      assert.equal(charge.status, "RESERVED", `commit must be a single state transition for ${id}`);
      charge.status = "COMMITTED";
      transitions.push([id, "COMMITTED"]);
    },
    releaseCharge: async (id: string, reason: string) => {
      const charge = charges.find((entry) => entry.id === id)!;
      assert.equal(charge.status, "RESERVED", `release must be a single state transition for ${id}`);
      charge.status = "RELEASED";
      transitions.push([id, "RELEASED", reason]);
    }
  } as any);

  const first = await service.reconcileOnce({ now });
  const replay = await service.reconcileOnce({ now });

  assert.deepEqual(
    { inspected: first.inspected, committed: first.committed, released: first.released, kept: first.kept, errors: first.errors },
    { inspected: 7, committed: 1, released: 3, kept: 3, errors: 0 }
  );
  assert.deepEqual(replay, { inspected: 3, committed: 0, released: 0, kept: 3, errors: 0, expiredAllowances: 0 });
  assert.deepEqual(transitions, [
    ["reserve-before-outbox", "RELEASED", "RUN_CREATE_ORPHANED"],
    ["publish-before-response", "COMMITTED"],
    ["quality-rejected", "RELEASED", "ACTION_REJECTED"],
    ["attempts-exhausted", "RELEASED", "GENERATION_RETRY_EXHAUSTED"]
  ]);
  assert.equal(transitions.filter(([id]) => id === "publish-before-response").length, 1, "HTTP replay must not duplicate a committed charge");
  assert.equal(charges.some((charge) => charge.status === "RESERVED" && !["claimed-before-provider", "provider-before-publish", "lease-expired"].includes(charge.id)), false, "only explicitly recoverable work may remain reserved");
});
