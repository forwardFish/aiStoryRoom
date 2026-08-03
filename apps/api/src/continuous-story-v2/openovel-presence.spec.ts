import assert from "node:assert/strict";
import test from "node:test";
import { ContinuousStrategyContentService } from "../continuous-strategy/content.service";
import {
  ContinuousStoryV2Service,
  OPENOVEL_STANDING_POLICY_HASH,
  OPENOVEL_STANDING_POLICY_VERSION,
  isOpenNovelAgentTaskPolicySnapshotValid,
  openNovelAgentTaskDedupeKey,
  openNovelAgentTaskIdentity,
  openNovelPresencePhase,
  readOpenNovelAgentTaskIdentity,
  readOpenNovelPresenceTiming,
  shouldUseStandingPolicy
} from "./continuous-story-v2.service";

const OPENOVEL_ENGINE = "continuous_openovel_v1";

function serviceWith(prisma: any, published: any[]) {
  return new ContinuousStoryV2Service(
    prisma,
    new ContinuousStrategyContentService(),
    { publish: async (_tx: unknown, event: unknown) => { published.push(event); } } as any,
    null as any,
    null as any,
    null as any,
    { isOpenNovel: () => true } as any
  );
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    templateKey: "sangtian",
    strategyVersion: "sangtian_v1_2",
    engineVersion: OPENOVEL_ENGINE,
    mode: "room",
    status: "playing",
    currentNodeId: "node-1",
    currentDay: 1,
    totalDays: 7,
    worldSequence: 0,
    stateJson: {},
    players: [{ userId: "user-1" }, { userId: "user-2" }],
    ...overrides
  };
}

function role() {
  return {
    id: "role-1",
    roleKey: "county_magistrate",
    roleName: "County Magistrate",
    identity: "County magistrate",
    abilityText: "May verify county records",
    personalGoal: "Keep decisions auditable",
    status: "claimed"
  };
}

test("OpenNovel presence timing defaults to 15s stale plus 30s grace and uses exact boundaries", () => {
  const timing = readOpenNovelPresenceTiming({} as NodeJS.ProcessEnv);
  assert.deepEqual(timing, { heartbeatStaleMs: 15_000, offlineGraceMs: 30_000 });
  const createdAt = new Date(0);
  const active = { mode: "HUMAN_ACTIVE", lastHeartbeatAt: createdAt, offlineSince: null, createdAt };
  assert.equal(openNovelPresencePhase(active, new Date(14_999), timing), null);
  assert.equal(openNovelPresencePhase(active, new Date(15_000), timing), "HUMAN_OFFLINE_GRACE");
  const grace = { mode: "HUMAN_OFFLINE_GRACE", lastHeartbeatAt: createdAt, offlineSince: new Date(20_000), createdAt };
  assert.equal(openNovelPresencePhase(grace, new Date(49_999), timing), null);
  assert.equal(openNovelPresencePhase(grace, new Date(50_000), timing), "AI_ACTIVE");
});

test("disconnect takeover uses Standing Policy even when reviewed options exist", () => {
  assert.equal(shouldUseStandingPolicy({
    reviewedCandidateCount: 3,
    engineVersion: OPENOVEL_ENGINE,
    controlReason: "DISCONNECT_TIMEOUT"
  }), true);
});

test("explicit AI handoff may use reviewed options", () => {
  assert.equal(shouldUseStandingPolicy({
    reviewedCandidateCount: 3,
    engineVersion: OPENOVEL_ENGINE,
    controlReason: "EXPLICIT_HANDOFF"
  }), false);
});

test("AI control without reviewed options keeps the bounded Standing Policy fallback", () => {
  assert.equal(shouldUseStandingPolicy({
    reviewedCandidateCount: 0,
    engineVersion: OPENOVEL_ENGINE,
    controlReason: "INITIAL_AI_AGENT"
  }), true);
});

test("AI control with only one reviewed option uses Standing Policy instead of an invalid model decision", () => {
  assert.equal(shouldUseStandingPolicy({
    reviewedCandidateCount: 1,
    engineVersion: OPENOVEL_ENGINE,
    controlReason: "INITIAL_AI_AGENT"
  }), true);
});

test("OpenNovel agent tasks have epoch-scoped dedupe identities and immutable policy snapshots", () => {
  const first = openNovelAgentTaskIdentity({
    controlEpoch: 8,
    controlReason: "DISCONNECT_TIMEOUT",
    controlTransitionId: "transition-8"
  });
  assert.equal(openNovelAgentTaskDedupeKey("turn-1", 8), "ACTOR_AGENT_TURN_V2:turn-1:8");
  assert.notEqual(openNovelAgentTaskDedupeKey("turn-1", 8), openNovelAgentTaskDedupeKey("turn-1", 10));
  assert.equal(first.decisionSourceRule, "STANDING_POLICY_REQUIRED");
  assert.equal(first.policyVersion, OPENOVEL_STANDING_POLICY_VERSION);
  assert.equal(first.policyHash, OPENOVEL_STANDING_POLICY_HASH);
  assert.deepEqual(readOpenNovelAgentTaskIdentity(first), first);
});

test("OpenNovel agent task identity fails closed when its policy snapshot is incomplete", () => {
  const valid = openNovelAgentTaskIdentity({ controlEpoch: 8, controlReason: "EXPLICIT_HANDOFF" });
  assert.equal(readOpenNovelAgentTaskIdentity({ ...valid, policyHash: null }), null);
  assert.equal(readOpenNovelAgentTaskIdentity({ ...valid, controlEpoch: 8.5 }), null);
  assert.equal(readOpenNovelAgentTaskIdentity({ ...valid, decisionSourceRule: "MODEL_ALWAYS" }), null);
  assert.equal(isOpenNovelAgentTaskPolicySnapshotValid(valid), true);
  assert.equal(isOpenNovelAgentTaskPolicySnapshotValid({ ...valid, policyHash: "tampered" }), false);
});

test("presence sweep moves only a due OpenNovel human into grace without changing epoch", async () => {
  const now = new Date(60_000);
  const published: any[] = [];
  const updates: any[] = [];
  const transitions: any[] = [];
  const control = {
    id: "control-1",
    runId: "run-1",
    roleId: "role-1",
    humanPlayerId: "player-1",
    mode: "HUMAN_ACTIVE",
    epoch: 7,
    lastHeartbeatAt: new Date(40_000),
    offlineSince: null,
    createdAt: new Date(0),
    run: run()
  };
  const tx = {
    roleControl: {
      findUnique: async () => control,
      updateMany: async (args: any) => { updates.push(args); return { count: 1 }; }
    },
    presenceSession: { findFirst: async () => null },
    actorTurn: { findFirst: async (args: any) => {
      assert.equal(args.where.status, "OPEN");
      return { id: "turn-1", stageIndex: 1 };
    } },
    roleControlTransition: { create: async (args: any) => { transitions.push(args); return { id: `transition-${transitions.length}` }; } },
    storyRun: { update: async () => undefined }
  };
  const prisma = {
    roleControl: { findMany: async (args: any) => {
      assert.deepEqual(args.where.run, { engineVersion: OPENOVEL_ENGINE, mode: "room", status: "playing" });
      return [{ id: control.id }];
    } },
    $transaction: async (operation: any) => operation(tx)
  };
  const result = await serviceWith(prisma, published).sweepOpenNovelPresence(now);

  assert.deepEqual(result, { scanned: 1, graceTransitions: 1, aiTransitions: 0 });
  assert.equal(updates[0].data.mode, "HUMAN_OFFLINE_GRACE");
  assert.equal(updates[0].where.AND[0].lastHeartbeatAt.getTime(), 40_000);
  assert.equal(updates[0].where.AND[1].OR[1].lastHeartbeatAt.lte.getTime(), 45_000);
  assert.equal("epoch" in updates[0].data, false);
  assert.equal(transitions[0].data.fromEpoch, 7);
  assert.equal(transitions[0].data.toEpoch, 7);
  assert.equal(transitions[0].data.reason, "DISCONNECT_DETECTED");
  assert.equal(published[0].type, "ROLE_PRESENCE_CHANGED_V2");
});

test("a newer heartbeat that wins the compare-and-set race prevents the grace transition", async () => {
  const now = new Date(60_000);
  const published: any[] = [];
  const updates: any[] = [];
  const control = {
    id: "control-1",
    runId: "run-1",
    roleId: "role-1",
    humanPlayerId: "player-1",
    mode: "HUMAN_ACTIVE",
    epoch: 7,
    lastHeartbeatAt: new Date(40_000),
    offlineSince: null,
    createdAt: new Date(0),
    run: run()
  };
  const tx = {
    roleControl: {
      findUnique: async () => control,
      updateMany: async (args: any) => {
        updates.push(args);
        // The database row now contains the concurrent 60s heartbeat, so the
        // exact 40s CAS predicate matches no row.
        return { count: 0 };
      }
    },
    presenceSession: { findFirst: async () => null }
  };
  const prisma = {
    roleControl: { findMany: async () => [{ id: control.id }] },
    $transaction: async (operation: any) => operation(tx)
  };

  const result = await serviceWith(prisma, published).sweepOpenNovelPresence(now);

  assert.deepEqual(result, { scanned: 1, graceTransitions: 0, aiTransitions: 0 });
  assert.equal(updates[0].where.AND[0].lastHeartbeatAt.getTime(), 40_000);
  assert.equal(published.length, 0);
});

test("expired grace increments epoch, records takeover, and queues only the current OPEN turn", async () => {
  const now = new Date(60_000);
  const published: any[] = [];
  const tasks: any[] = [];
  const transitions: any[] = [];
  const roleUpdates: any[] = [];
  const control = {
    id: "control-1",
    runId: "run-1",
    roleId: "role-1",
    humanPlayerId: "player-1",
    mode: "HUMAN_OFFLINE_GRACE",
    epoch: 7,
    lastHeartbeatAt: new Date(10_000),
    offlineSince: new Date(30_000),
    createdAt: new Date(0),
    run: run()
  };
  const tx = {
    roleControl: { findUnique: async () => control, updateMany: async () => ({ count: 1 }) },
    presenceSession: { findFirst: async () => ({ lastHeartbeatAt: new Date(10_000) }) },
    storyRole: { update: async (args: any) => { roleUpdates.push(args); return role(); } },
    actorTurn: { findFirst: async (args: any) => {
      assert.equal(args.where.status, "OPEN");
      return { id: "turn-open", stageIndex: 2 };
    } },
    roleControlTransition: { create: async (args: any) => { transitions.push(args); return { id: `transition-${transitions.length}` }; } },
    storyTaskOutbox: { upsert: async (args: any) => { tasks.push(args); } },
    storyRun: { update: async () => undefined }
  };
  const prisma = {
    roleControl: { findMany: async () => [{ id: control.id }] },
    $transaction: async (operation: any) => operation(tx)
  };
  const result = await serviceWith(prisma, published).sweepOpenNovelPresence(now);

  assert.deepEqual(result, { scanned: 1, graceTransitions: 0, aiTransitions: 1 });
  assert.equal(transitions[0].data.fromEpoch, 7);
  assert.equal(transitions[0].data.toEpoch, 8);
  assert.equal(transitions[0].data.reason, "DISCONNECT_TIMEOUT");
  assert.deepEqual(roleUpdates[0].data, { isAiControlled: true, status: "ai_controlled" });
  assert.equal(tasks[0].create.inputRefId, "turn-open");
  assert.equal(tasks[0].create.controlEpoch, 8);
  assert.equal(tasks[0].create.taskType, "ACTOR_AGENT_TURN_V2");
  assert.equal(tasks[0].create.dedupeKey, "ACTOR_AGENT_TURN_V2:turn-open:8");
  assert.equal(tasks[0].create.identityJson.controlReason, "DISCONNECT_TIMEOUT");
  assert.equal(tasks[0].create.identityJson.controlTransitionId, "transition-1");
  assert.equal(tasks[0].create.identityJson.policyVersion, OPENOVEL_STANDING_POLICY_VERSION);
  assert.equal(published[0].payload.controllerKind, "AI");
});

test("heartbeat during grace restores human control without incrementing epoch", async () => {
  const published: any[] = [];
  const transitions: any[] = [];
  const updates: any[] = [];
  const control = {
    id: "control-1",
    runId: "run-1",
    roleId: "role-1",
    humanPlayerId: "player-1",
    mode: "HUMAN_OFFLINE_GRACE",
    epoch: 7,
    lastHeartbeatAt: new Date(0),
    offlineSince: new Date(1_000),
    takeoverAt: null
  };
  const storyRun = {
    ...run(),
    players: [{ id: "player-1", userId: "user-1", roleId: "role-1", status: "active" }],
    roles: [{ id: "role-1" }],
    roleControls: [control]
  };
  const recovered = { ...control, mode: "HUMAN_ACTIVE", reason: "HEARTBEAT_RECOVERED", offlineSince: null };
  const tx = {
    storyRun: {
      findUnique: async () => storyRun,
      update: async () => undefined
    },
    actorTurn: { findFirst: async () => ({ id: "turn-1", status: "OPEN", stageIndex: 1 }) },
    presenceSession: {
      findUnique: async () => null,
      upsert: async () => undefined
    },
    roleControl: {
      update: async () => control,
      updateMany: async (args: any) => { updates.push(args); return { count: 1 }; },
      findUniqueOrThrow: async () => recovered
    },
    storyPlayer: { update: async () => undefined },
    roleControlTransition: { create: async (args: any) => { transitions.push(args); return { id: `transition-${transitions.length}` }; } }
  };
  const prisma = { $transaction: async (operation: any) => operation(tx) };
  const result = await serviceWith(prisma, published).heartbeat(
    { id: "user-1" } as any,
    "run-1",
    { sessionInstanceId: "session-1", heartbeatSequence: 1, lastAppliedDeliverySequence: 0 }
  );

  assert.equal(result.accepted, true);
  assert.equal(result.rolePresence.mode, "HUMAN_ACTIVE");
  assert.equal(result.rolePresence.epoch, 7);
  assert.equal(updates[0].data.mode, "HUMAN_ACTIVE");
  assert.equal("epoch" in updates[0].data, false);
  assert.equal(transitions[0].data.fromEpoch, 7);
  assert.equal(transitions[0].data.toEpoch, 7);
  assert.equal(transitions[0].data.reason, "HEARTBEAT_RECOVERED");
  assert.equal(published[0].payload.presence, "ONLINE");
});

test("repeated sweeps create each grace and AI takeover effect once and increment epoch once", async () => {
  const published: any[] = [];
  const transitions: any[] = [];
  const tasks: any[] = [];
  const roleUpdates: any[] = [];
  let runVersionUpdates = 0;
  let control: any = {
    id: "control-1",
    runId: "run-1",
    roleId: "role-1",
    humanPlayerId: "player-1",
    mode: "HUMAN_ACTIVE",
    epoch: 7,
    lastHeartbeatAt: new Date(0),
    offlineSince: null,
    takeoverAt: null,
    createdAt: new Date(0)
  };
  const tx = {
    roleControl: {
      findUnique: async () => ({ ...control, run: run() }),
      updateMany: async (args: any) => {
        if (args.data.mode === "HUMAN_OFFLINE_GRACE"
          && control.mode === "HUMAN_ACTIVE"
          && control.epoch === args.where.epoch
          && control.lastHeartbeatAt?.getTime() === args.where.AND[0].lastHeartbeatAt?.getTime()) {
          control = { ...control, ...args.data };
          return { count: 1 };
        }
        if (args.data.mode === "AI_ACTIVE"
          && control.mode === "HUMAN_OFFLINE_GRACE"
          && control.epoch === args.where.epoch
          && control.offlineSince?.getTime() === args.where.offlineSince?.getTime()) {
          control = { ...control, ...args.data };
          return { count: 1 };
        }
        return { count: 0 };
      }
    },
    presenceSession: { findFirst: async () => ({ lastHeartbeatAt: new Date(0) }) },
    actorTurn: { findFirst: async () => ({ id: "turn-open", stageIndex: 1, status: "OPEN" }) },
    roleControlTransition: { create: async (args: any) => { transitions.push(args); return { id: `transition-${transitions.length}` }; } },
    storyRole: { update: async (args: any) => { roleUpdates.push(args); return role(); } },
    storyTaskOutbox: { upsert: async (args: any) => { tasks.push(args); } },
    storyRun: { update: async () => { runVersionUpdates += 1; } }
  };
  const prisma = {
    roleControl: { findMany: async () => [{ id: control.id }] },
    $transaction: async (operation: any) => operation(tx)
  };
  const service = serviceWith(prisma, published);

  const grace = await service.sweepOpenNovelPresence(new Date(20_000));
  const duplicateGrace = await service.sweepOpenNovelPresence(new Date(20_000));
  const takeover = await service.sweepOpenNovelPresence(new Date(50_000));
  const duplicateTakeover = await service.sweepOpenNovelPresence(new Date(50_000));

  assert.equal(grace.graceTransitions, 1);
  assert.deepEqual(duplicateGrace, { scanned: 1, graceTransitions: 0, aiTransitions: 0 });
  assert.equal(takeover.aiTransitions, 1);
  assert.deepEqual(duplicateTakeover, { scanned: 1, graceTransitions: 0, aiTransitions: 0 });
  assert.equal(control.mode, "AI_ACTIVE");
  assert.equal(control.epoch, 8, "duplicate sweeps must not increment the epoch beyond the single takeover");
  assert.equal(transitions.length, 2, "one disconnect plus one takeover transition");
  assert.equal(published.length, 2, "one presence event plus one control event");
  assert.equal(tasks.length, 1, "the current OPEN turn is queued once");
  assert.equal(roleUpdates.length, 1, "the story role changes to AI once");
  assert.equal(runVersionUpdates, 2, "each real state transition increments the run version once");
});

test("heartbeat while AI_ACTIVE refreshes liveness but cannot reclaim or change the control epoch", async () => {
  const published: any[] = [];
  const controlUpdates: any[] = [];
  const sessionUpserts: any[] = [];
  const transitions: any[] = [];
  const control = {
    id: "control-1",
    runId: "run-1",
    roleId: "role-1",
    humanPlayerId: "player-1",
    mode: "AI_ACTIVE",
    epoch: 8,
    lastHeartbeatAt: new Date(0),
    offlineSince: new Date(1_000),
    takeoverAt: new Date(31_000)
  };
  const storyRun = {
    ...run(),
    players: [{ id: "player-1", userId: "user-1", roleId: "role-1", status: "active" }],
    roles: [{ id: "role-1" }],
    roleControls: [control]
  };
  const tx = {
    storyRun: { findUnique: async () => storyRun },
    actorTurn: { findFirst: async () => ({ id: "turn-1", status: "OPEN", stageIndex: 1 }) },
    presenceSession: {
      findUnique: async () => null,
      upsert: async (args: any) => { sessionUpserts.push(args); }
    },
    roleControl: {
      update: async (args: any) => {
        controlUpdates.push(args);
        return { ...control, lastHeartbeatAt: args.data.lastHeartbeatAt };
      },
      updateMany: async () => { throw new Error("AI heartbeat must not run human recovery"); }
    },
    storyPlayer: { update: async () => undefined },
    roleControlTransition: { create: async (args: any) => { transitions.push(args); return { id: `transition-${transitions.length}` }; } }
  };
  const prisma = { $transaction: async (operation: any) => operation(tx) };

  const result = await serviceWith(prisma, published).heartbeat(
    { id: "user-1" } as any,
    "run-1",
    { sessionInstanceId: "session-ai-return", heartbeatSequence: 1, lastAppliedDeliverySequence: 4 }
  );

  assert.equal(result.accepted, true);
  assert.equal(result.rolePresence.mode, "AI_ACTIVE");
  assert.equal(result.rolePresence.presence, "AI_CONTROLLED");
  assert.equal(result.rolePresence.epoch, 8);
  assert.equal(sessionUpserts.length, 1, "the returning browser still refreshes its durable presence session");
  assert.equal(controlUpdates.length, 1, "the control heartbeat timestamp is refreshed once");
  assert.deepEqual(Object.keys(controlUpdates[0].data), ["lastHeartbeatAt"]);
  assert.equal(transitions.length, 0, "only explicit reclaim may create the AI-to-human transition");
  assert.equal(published.length, 0, "a heartbeat alone must not publish a human control change");
});

test("immediate reclaim cancels only AI tasks fenced to the previous control epoch", async () => {
  const published: any[] = [];
  const taskUpdates: any[] = [];
  const context = {
    run: run({ currentNodeId: "node-1", currentDay: 2 }),
    role: role(),
    player: { id: "player-1", userId: "user-1", roleId: "role-1" },
    control: {
      id: "control-1",
      runId: "run-1",
      roleId: "role-1",
      humanPlayerId: "player-1",
      mode: "AI_ACTIVE",
      epoch: 8,
      takeoverAt: new Date(30_000)
    },
    turn: { id: "turn-open", stageIndex: 2, status: "OPEN" },
    memberUserIds: ["user-1", "user-2"]
  };
  const tx = {
    roleControlTransition: {
      findUnique: async () => null,
      create: async () => ({ id: "transition-reclaim" })
    },
    playerAction: { findFirst: async () => null },
    roleControl: { update: async () => undefined },
    storyRole: { update: async () => undefined },
    storyTaskOutbox: {
      updateMany: async (args: any) => {
        taskUpdates.push(args);
        return { count: 1 };
      }
    },
    storyRun: { update: async () => undefined }
  };
  const prisma = { $transaction: async (operation: any) => operation(tx) };
  const service = serviceWith(prisma, published) as any;
  service.controlContext = async () => context;
  service.creditConsumption = {
    availableForRun: async () => ({
      available: 10,
      runAllowanceAvailable: 10,
      personalAvailable: 0
    })
  };
  service.game = async () => ({ schemaVersion: "game_projection_v2" });

  const result = await service.reclaim(
    { id: "user-1" },
    "run-1",
    { idempotencyKey: "reclaim-epoch-8", expectedControlEpoch: 8 }
  );

  assert.equal(result.accepted, true);
  assert.equal(taskUpdates.length, 1);
  assert.deepEqual(taskUpdates[0].where, {
    runId: "run-1",
    roleId: "role-1",
    taskType: "ACTOR_AGENT_TURN_V2",
    controlEpoch: 8,
    status: { in: ["PENDING", "RUNNING"] }
  });
  assert.equal(published[0].payload.controllerKind, "HUMAN");
  assert.equal(published[0].payload.epoch, 9);
});
