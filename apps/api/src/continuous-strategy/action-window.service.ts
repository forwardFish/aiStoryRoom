import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type StoryRun } from "@prisma/client";
import { CONTINUOUS_ENGINE_VERSION } from "@ai-story/shared";
import { getGameDefinition } from "@ai-story/templates";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { readContinuousStrategyConfig } from "../config/continuous-strategy.config";
import { PrismaService } from "../prisma.service";
import { sha256Canonical } from "./canonical";
import { ContinuousStrategyContentService } from "./content.service";
import { ContinuousEventDeliveryService } from "./event-delivery.service";
import { RoleAgentTaskService } from "./role-agent-task.service";

type Tx = Prisma.TransactionClient;

export function assignRoleControllers<TRole extends { id: string }, TPlayer extends { roleId: string | null }>(roles: TRole[], humanPlayers: TPlayer[]) {
  const humanByRoleId = new Map(humanPlayers.filter((player) => player.roleId).map((player) => [player.roleId, player]));
  return roles.map((role) => ({ role, humanPlayer: humanByRoleId.get(role.id) || null }));
}

export type ContinuousTiming = {
  profile: "realtime" | "manual-three-page" | "automated-success" | "timeout";
  mainSeconds: number;
  graceSeconds: number;
  graceMinimumSeconds: number;
  offlineGraceSeconds: number;
  aiOnlyGraceSeconds: number;
};

@Injectable()
export class ActionWindowService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ContinuousStrategyContentService) private readonly content: ContinuousStrategyContentService,
    @Inject(ContinuousEventDeliveryService) private readonly deliveries: ContinuousEventDeliveryService,
    @Inject(RoleAgentTaskService) private readonly roleAgents: RoleAgentTaskService
  ) {}

  timing(env: NodeJS.ProcessEnv = process.env): ContinuousTiming {
    const profile = String(env.CONTINUOUS_TIMING_PROFILE || "realtime");
    const defaults: Record<string, Omit<ContinuousTiming, "profile">> = {
      realtime: { mainSeconds: 180, graceSeconds: 45, graceMinimumSeconds: 20, offlineGraceSeconds: 30, aiOnlyGraceSeconds: 2 },
      // The three-page profile is used for deliberate, screenshot-backed human
      // acceptance. One operator must read and act in three isolated origins,
      // so its windows must not expire while the other two viewpoints are being
      // inspected. Production realtime timing remains unchanged.
      "manual-three-page": { mainSeconds: 1200, graceSeconds: 900, graceMinimumSeconds: 30, offlineGraceSeconds: 30, aiOnlyGraceSeconds: 2 },
      // Supabase round trips and three parallel command transactions can take
      // materially longer than an in-memory test. Keep this success profile
      // bounded, but do not turn infrastructure latency into WINDOW_CLOSED.
      "automated-success": { mainSeconds: 240, graceSeconds: 120, graceMinimumSeconds: 20, offlineGraceSeconds: 30, aiOnlyGraceSeconds: 1 },
      timeout: { mainSeconds: 15, graceSeconds: 8, graceMinimumSeconds: 8, offlineGraceSeconds: 3, aiOnlyGraceSeconds: 1 }
    };
    if (!defaults[profile]) throw new Error(`Unsupported CONTINUOUS_TIMING_PROFILE: ${profile}`);
    return { profile: profile as ContinuousTiming["profile"], ...defaults[profile] };
  }

  async start(user: AuthenticatedUser, roomId: string) {
    return this.serializable(async (tx) => {
      const room = await tx.storyRun.findUnique({
        where: { id: roomId },
        include: {
          roles: { orderBy: { createdAt: "asc" } },
          players: { where: { playerType: "human", status: "active" }, orderBy: { joinedAt: "asc" } }
        }
      });
      if (!room || room.mode !== "room") throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
      if (room.ownerUserId !== user.id) throw new ForbiddenException({ code: "HOST_REQUIRED", message: "Only the host can start the room" });
      this.requireContinuousVersions(room);
      const gameContent = this.content.forGame(room.templateKey, room.strategyVersion);
      const contract = gameContent.package().contract;
      const playableRoleKeys = contract.playableRoleKeys;
      const playableRoleKeySet = new Set(playableRoleKeys);
      const game = getGameDefinition(room.templateKey);
      if (room.status === "playing") return this.startedProjection(tx, roomId);
      if (room.status !== "waiting_players") throw new ConflictException({ code: "ROOM_NOT_WAITING", message: "Room cannot be started in its current state" });

      const state = roomState(room.stateJson);
      const ready = new Set(state.room?.readyUserIds || []);
      const playableRoles = room.roles.filter((role) => playableRoleKeySet.has(role.roleKey));
      if (playableRoles.length !== playableRoleKeys.length
        || new Set(playableRoles.map((role) => role.roleKey)).size !== playableRoleKeys.length
        || room.roles.some((role) => role.roleKey !== contract.worldActorKey && !playableRoleKeySet.has(role.roleKey))) {
        throw new ConflictException({ code: "CONTINUOUS_ROLE_SET_INVALID", message: "The room role seats do not match the registered game contract" });
      }
      if (!state.room?.hostRoleLocked) throw new BadRequestException({ code: "HOST_ROLE_NOT_LOCKED", message: "The host must lock a playable role" });
      const minimumHumans = state.room?.minPlayers || game.modes.minHumanPlayers;
      if (room.players.length < minimumHumans
        || room.players.length > Math.min(game.modes.maxHumanPlayers, playableRoleKeys.length)
        || new Set(room.players.map((player) => player.userId)).size !== room.players.length
        || new Set(room.players.map((player) => player.roleId)).size !== room.players.length
        || room.players.some((player) => !player.userId || !player.roleId || !ready.has(player.userId))
        || room.players.some((player) => !playableRoles.some((role) => role.id === player.roleId))) {
        throw new ConflictException({ code: "ROOM_NOT_READY", message: "Every joined human must claim a distinct registered role and be ready" });
      }
      if (!room.currentNodeId) throw new ConflictException({ code: "CURRENT_NODE_REQUIRED", message: "The room has no opening node" });
      const node = await tx.sceneNode.findUnique({ where: { id: room.currentNodeId } });
      if (!node || node.runId !== room.id || node.nodeIndex !== 1) throw new ConflictException({ code: "OPENING_NODE_INVALID", message: "Opening node is invalid" });

      const timing = this.timing();
      const now = new Date();
      const mainClosesAt = new Date(now.getTime() + timing.mainSeconds * 1_000);
      const openingSnapshotVersion = room.version + 1;
      const stage = gameContent.stage(1);
      const window = await tx.actionWindow.create({
        data: {
          runId: room.id,
          nodeId: node.id,
          status: "MAIN_OPEN",
          mainOpenedAt: now,
          mainClosesAt,
          openingSnapshotVersion,
          projectionVersion: 1,
          configJson: {
            timing,
            stageKey: stage.stageKey,
            contentVersion: gameContent.package().manifest.contentVersion,
            artifactHashes: gameContent.package().artifactHashes
          } as Prisma.InputJsonValue
        }
      });

      if (!game.worldActor || game.worldActor.actorKey !== contract.worldActorKey) throw new Error(`GAME_WORLD_ACTOR_MISMATCH:${room.templateKey}`);
      const roleByKey = new Map(room.roles.map((role) => [role.roleKey, role]));
      const configuredRoles = playableRoleKeys.map((roleKey) => roleByKey.get(roleKey)!);
      for (const { role, humanPlayer } of assignRoleControllers(configuredRoles, room.players)) {
        const roleKey = role.roleKey;
        if (!humanPlayer) {
          await tx.storyPlayer.upsert({
            where: { runId_roleId: { runId: room.id, roleId: role.id } },
            update: { playerType: "ai", status: "active", userId: null },
            create: { runId: room.id, roleId: role.id, playerType: "ai", status: "active", lastActiveAt: now }
          });
        }
        await tx.storyRole.update({
          where: { id: role.id },
          data: { isAiControlled: !humanPlayer, status: humanPlayer ? "claimed" : "ai_controlled" }
        });
        const roleStage = gameContent.roleStage(1, roleKey);
        const projection = {
          schemaVersion: "continuous_opening_projection_v1",
          stageIndex: 1,
          stageKey: stage.stageKey,
          title: stage.title,
          roleId: role.id,
          roleKey,
          privateBrief: roleStage.privateBrief,
          personalPressure: roleStage.personalPressure,
          knownFactIds: [],
          mainCards: roleStage.mainCards.map((card) => ({
            actionKey: card.actionKey,
            title: card.title,
            description: card.objective,
            targetRoleKey: card.targetRoleKey,
            leverageKeys: card.assetMutations.map((mutation) => mutation.assetKey)
          }))
        };
        await tx.actionWindowOpeningProjection.create({
          data: {
            windowId: window.id,
            roleId: role.id,
            snapshotVersion: openingSnapshotVersion,
            projectionJson: projection as Prisma.InputJsonValue,
            contentHash: sha256Canonical(projection)
          }
        });
        await tx.actionWindowParticipant.create({ data: { windowId: window.id, roleId: role.id } });
        await tx.roleControl.create({
          data: {
            runId: room.id,
            roleId: role.id,
            humanPlayerId: humanPlayer?.id || null,
            mode: humanPlayer ? "HUMAN_ACTIVE" : "AI_ACTIVE",
            epoch: 1,
            lastHeartbeatAt: humanPlayer ? now : null,
            takeoverAt: humanPlayer ? null : now,
            reason: humanPlayer ? "ROOM_STARTED" : "INITIAL_AI_AGENT"
          }
        });
        const policy = gameContent.agentPolicy(1, roleKey);
        const provider = readContinuousStrategyConfig().roleAgentProvider;
        await tx.roleAgentPolicy.create({
          data: {
            runId: room.id,
            roleId: role.id,
            policyVersion: policy.policyVersion,
            promptVersion: "continuous_role_agent_prompt_v1",
            provider,
            modelName: provider === "deepseek" ? readContinuousStrategyConfig().roleAgentModel : "deterministic-rules-v1",
            goalsJson: policy.goals as Prisma.InputJsonValue,
            riskProfileJson: { profile: policy.riskProfile } as Prisma.InputJsonValue,
            assetPriorityJson: policy.assetPriority as Prisma.InputJsonValue,
            actionWeightsJson: policy.actionWeights as Prisma.InputJsonValue,
            fallbackBySlotJson: policy.fallbackBySlot as Prisma.InputJsonValue
          }
        });
      }
      for (const asset of stage.assetCatalog) {
        const owner = roleByKey.get(asset.initialOwnerRoleKey || contract.worldActorKey);
        await tx.roleAsset.create({
          data: {
            runId: room.id,
            assetKey: asset.assetKey,
            kind: asset.kind,
            ownerRoleId: owner?.id || null,
            ownerActorKey: owner ? null : contract.worldActorKey,
            quantity: 1,
            visibility: "PRIVATE",
            stateJson: { stageKey: stage.stageKey, initialOwnerRoleKey: asset.initialOwnerRoleKey } as Prisma.InputJsonValue
          }
        });
      }

      const systemAction = gameContent.package().systemActions.systemActions.find((entry) => entry.systemActionKey === stage.systemActionKey);
      if (!systemAction) throw new Error(`SYSTEM_ACTION_NOT_FOUND:${stage.systemActionKey}`);
      await tx.playerAction.create({
        data: {
          runId: room.id,
          nodeId: node.id,
          chapterIndex: node.chapterIndex,
          roleId: null,
          playerType: "ai",
          actionType: "system_policy",
          targetText: stage.commonContest.title,
          method: systemAction.visiblePressure,
          intent: systemAction.nextStateKey,
          riskLevel: "normal",
          normalizedJson: systemAction as Prisma.InputJsonValue,
          guardStatus: "ok",
          auditStatus: "ok",
          status: "accepted",
          actionSlot: "SYSTEM_ACTION",
          actorKind: "SYSTEM",
          controlEpoch: 1,
          actionKey: systemAction.systemActionKey,
          idempotencyKey: `system:${window.id}:${systemAction.systemActionKey}`,
          requestHash: sha256Canonical(systemAction),
          visibility: "OBSERVABLE",
          sealedAt: now,
          immediateJson: { pressure: systemAction.visiblePressure } as Prisma.InputJsonValue
        }
      });

      const transitioned = await tx.storyRun.updateMany({
        where: { id: room.id, status: "waiting_players", version: room.version },
        data: {
          status: "playing",
          currentDay: 1,
          activeHumanCount: room.players.length,
          aiPlayerCount: playableRoleKeys.length - room.players.length,
          version: { increment: 1 }
        }
      });
      if (transitioned.count !== 1) throw new ConflictException({ code: "ROOM_STATE_CONFLICT", message: "Room start lost a concurrent state transition" });
      await tx.sceneNode.update({ where: { id: node.id }, data: { status: "open_for_actions" } });
      await this.deliveries.publish(tx, {
        runId: room.id,
        day: 1,
        type: "ROOM_STARTED",
        visibility: "PUBLIC",
        audienceType: "ALL_MEMBERS",
        audienceUserIds: room.players.map((player) => player.userId!).filter(Boolean),
        payload: {
          roomId: room.id,
          runId: room.id,
          engineVersion: room.engineVersion,
          strategyVersion: room.strategyVersion,
          status: "playing",
          actionWindowId: window.id
        },
        dedupeKey: `ROOM_STARTED:${room.id}`
      });
      await this.roleAgents.enqueueForWindow(tx, window.id);
      return {
        roomId: room.id,
        runId: room.id,
        engineVersion: room.engineVersion,
        strategyVersion: room.strategyVersion,
        status: "playing",
        actionWindowId: window.id
      };
    });
  }

  async resumeAfterUnlock(tx: Tx, roomId: string, initiatedByUserId: string) {
    const run = await tx.storyRun.findUnique({
      where: { id: roomId },
      include: {
        players: { where: { status: "active" } },
        roleControls: true
      }
    });
    if (!run) throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    this.requireContinuousVersions(run);
    this.content.forGame(run.templateKey, run.strategyVersion);
    const window = await tx.actionWindow.findFirst({ where: { runId: roomId }, orderBy: { createdAt: "desc" } });
    if (!window) throw new ConflictException({ code: "ACTION_WINDOW_NOT_READY", message: "The unlock window is missing" });
    if (window.status !== "PREPARING") {
      if (["MAIN_OPEN", "INTERACTION_GRACE", "CLOSING", "RESOLVING", "PROJECTING", "RESOLVED"].includes(window.status)) return window;
      throw new ConflictException({ code: "WINDOW_MOVED", message: `The unlock window is ${window.status}` });
    }
    const timing = this.timing();
    const now = new Date();
    const opened = await tx.actionWindow.update({
      where: { id: window.id },
      data: {
        status: "MAIN_OPEN",
        mainOpenedAt: now,
        mainClosesAt: new Date(now.getTime() + timing.mainSeconds * 1_000),
        configJson: { ...(window.configJson as Record<string, unknown>), timing } as Prisma.InputJsonValue,
        version: { increment: 1 },
        projectionVersion: { increment: 1 }
      }
    });
    await tx.storyRun.update({ where: { id: roomId }, data: { status: "playing", version: { increment: 1 } } });
    await this.deliveries.publish(tx, {
      runId: roomId,
      day: run.currentDay,
      type: "WORLD_UNLOCKED",
      visibility: "PUBLIC",
      audienceType: "ALL_MEMBERS",
      audienceUserIds: run.players.map((player) => player.userId).filter((id): id is string => Boolean(id)),
      payload: { roomId, windowId: opened.id, initiatedByUserId },
      dedupeKey: `WORLD_UNLOCKED:${roomId}`
    });
    await this.roleAgents.enqueueForWindow(tx, opened.id);
    return opened;
  }

  private requireContinuousVersions(run: Pick<StoryRun, "engineVersion">) {
    if (run.engineVersion !== CONTINUOUS_ENGINE_VERSION) {
      throw new ConflictException({ code: "CONTINUOUS_ENGINE_REQUIRED", message: "This room belongs to the legacy engine" });
    }
  }

  private async startedProjection(tx: Tx, roomId: string) {
    const run = await tx.storyRun.findUniqueOrThrow({ where: { id: roomId } });
    this.requireContinuousVersions(run);
    this.content.forGame(run.templateKey, run.strategyVersion);
    const window = await tx.actionWindow.findFirst({ where: { runId: roomId }, orderBy: { createdAt: "desc" } });
    return {
      roomId,
      runId: roomId,
      engineVersion: run.engineVersion,
      strategyVersion: run.strategyVersion,
      status: run.status,
      actionWindowId: window?.id || null
    };
  }

  private async serializable<T>(operation: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000
        });
      } catch (error: any) {
        if ((error?.code !== "P2034" && error?.code !== "P2002") || attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
    throw new Error("unreachable serializable retry state");
  }
}

type RoomLobbyState = {
  room?: {
    readyUserIds?: string[];
    hostRoleLocked?: boolean;
    minPlayers?: number;
  };
};

function roomState(value: unknown): RoomLobbyState {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RoomLobbyState : {};
}
