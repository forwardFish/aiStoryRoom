import assert from "node:assert/strict";
import { CONTINUOUS_ENGINE_VERSION } from "@ai-story/shared";
import { getGameDefinition } from "@ai-story/templates";
import { ActionWindowService, assignRoleControllers } from "./action-window.service";
import { ContinuousStrategyContentService } from "./content.service";

const game = getGameDefinition("sangtian");
const roleRows = game.roles.map((role, index) => ({ id: `role-${index + 1}`, roleKey: role.roleKey }));
const human = { id: "player-human", userId: "user-host", roleId: roleRows[0].id, playerType: "human", status: "active" };
const createdAiPlayers: Array<Record<string, unknown>> = [];
const controls: Array<Record<string, unknown>> = [];
const participants: Array<Record<string, unknown>> = [];
const systemActions: Array<Record<string, unknown>> = [];
const runUpdates: Array<Record<string, unknown>> = [];
let enqueuedWindowId: string | null = null;

const room = {
  id: "room-1",
  mode: "room",
  ownerUserId: human.userId,
  engineVersion: CONTINUOUS_ENGINE_VERSION,
  strategyVersion: game.engine.strategyVersion,
  templateKey: game.worldId,
  status: "waiting_players",
  stateJson: { room: { readyUserIds: [human.userId], hostRoleLocked: true, minPlayers: 1 } },
  roles: roleRows,
  players: [human],
  currentNodeId: "node-1",
  version: 7,
  currentDay: 1
};
const node = { id: "node-1", runId: room.id, nodeIndex: 1, chapterIndex: 1 };

const tx = {
  storyRun: {
    findUnique: async () => room,
    updateMany: async ({ data }: any) => { runUpdates.push(data); return { count: 1 }; }
  },
  sceneNode: {
    findUnique: async () => node,
    update: async () => node
  },
  actionWindow: {
    create: async ({ data }: any) => ({ id: "window-1", ...data })
  },
  storyPlayer: {
    upsert: async ({ create }: any) => { createdAiPlayers.push(create); return { id: `ai-${createdAiPlayers.length}`, ...create }; }
  },
  storyRole: { update: async ({ data }: any) => data },
  actionWindowOpeningProjection: { create: async ({ data }: any) => data },
  actionWindowParticipant: { create: async ({ data }: any) => { participants.push(data); return data; } },
  roleControl: { create: async ({ data }: any) => { controls.push(data); return data; } },
  roleAgentPolicy: { create: async ({ data }: any) => data },
  roleAsset: { create: async ({ data }: any) => data },
  playerAction: { create: async ({ data }: any) => { systemActions.push(data); return data; } }
};
const prisma = {
  $transaction: async (operation: (transaction: typeof tx) => Promise<unknown>) => operation(tx)
};
const deliveries = { publish: async () => undefined };
const roleAgents = { enqueueForWindow: async (_tx: unknown, windowId: string) => { enqueuedWindowId = windowId; return []; } };
const service = new ActionWindowService(
  prisma as never,
  new ContinuousStrategyContentService(),
  deliveries as never,
  roleAgents as never
);

async function main() {
  const realtimeTiming = service.timing({ CONTINUOUS_TIMING_PROFILE: "realtime" } as NodeJS.ProcessEnv);
  const manualTiming = service.timing({ CONTINUOUS_TIMING_PROFILE: "manual-three-page" } as NodeJS.ProcessEnv);
  const automatedTiming = service.timing({ CONTINUOUS_TIMING_PROFILE: "automated-success" } as NodeJS.ProcessEnv);
  const faultTiming = service.timing({ CONTINUOUS_TIMING_PROFILE: "fault-acceptance" } as NodeJS.ProcessEnv);
  assert.equal(realtimeTiming.graceSeconds, 45, "production realtime timing must remain unchanged");
  assert.deepEqual(manualTiming, {
    profile: "manual-three-page",
    mainSeconds: 1200,
    graceSeconds: 900,
    graceMinimumSeconds: 30,
    offlineGraceSeconds: 30,
    aiOnlyGraceSeconds: 2
  });
  assert.deepEqual(automatedTiming, {
    profile: "automated-success",
    mainSeconds: 240,
    graceSeconds: 120,
    graceMinimumSeconds: 20,
    offlineGraceSeconds: 30,
    aiOnlyGraceSeconds: 1
  });
  assert.deepEqual(faultTiming, {
    profile: "fault-acceptance",
    mainSeconds: 90,
    graceSeconds: 45,
    graceMinimumSeconds: 8,
    offlineGraceSeconds: 3,
    aiOnlyGraceSeconds: 1
  });

  const started = await service.start({ id: human.userId, openid: "openid-host" } as never, room.id);
  assert.equal(started.status, "playing");
  assert.equal(participants.length, game.roles.length);
  assert.equal(createdAiPlayers.length, game.roles.length - 1);
  assert.deepEqual(controls.map((control) => control.mode), [
    "HUMAN_ACTIVE",
    ...Array.from({ length: game.roles.length - 1 }, () => "AI_ACTIVE")
  ]);
  assert.equal(controls.some((control) => control.mode === "SYSTEM"), false, "worldActor must not become a player RoleControl");
  assert.equal(systemActions.length, 1);
  assert.equal(systemActions[0].roleId, null, "worldActor action must not reference a StoryRole");
  assert.equal(enqueuedWindowId, "window-1");
  assert.equal((runUpdates[0] as any).activeHumanCount, 1);
  assert.equal((runUpdates[0] as any).aiPlayerCount, game.roles.length - 1);

  const sixRoles = Array.from({ length: 6 }, (_, index) => ({ id: `six-role-${index + 1}` }));
  const threeHumans = sixRoles.slice(0, 3).map((role, index) => ({ roleId: role.id, id: `human-${index + 1}` }));
  const sixRolePlan = assignRoleControllers(sixRoles, threeHumans);
  assert.equal(sixRolePlan.filter((seat) => seat.humanPlayer).length, 3);
  assert.equal(sixRolePlan.filter((seat) => !seat.humanPlayer).length, 3);

  console.log("continuous action-window variable human/AI seat allocation: PASS");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
