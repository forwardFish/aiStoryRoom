import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type ActorTurn, type StoryRole } from "@prisma/client";
import {
  CONTINUOUS_STORY_ENGINE_VERSION,
  GAME_PROJECTION_V2_SCHEMA_VERSION,
  validateGameProjectionV2,
  type ControlCommandV1,
  type DecisionCandidateV2,
  type DecisionFormV2,
  type GameProjectionV2,
  type HeartbeatCommandV1,
  type PlayerIntentV2,
  type TurnDecisionCommandV2,
  type TurnDecisionResponseV2
} from "@ai-story/shared";
import { getGameDefinition } from "@ai-story/templates";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { sha256Canonical } from "../continuous-strategy/canonical";
import { ContinuousStrategyContentService } from "../continuous-strategy/content.service";
import { ContinuousEventDeliveryService } from "../continuous-strategy/event-delivery.service";
import { PrismaService } from "../prisma.service";
import { StoryAccessService } from "../story-access/story-access.service";
import { readCreditConsumptionConfig } from "../config/credit-consumption.config";
import { CreditConsumptionService } from "../credits/credit-consumption.service";
import { classifyCreditAction, parseRunBilling, priceForCreditAction } from "../credits/credit-policy";
import { gamePageProjection } from "../game-page-projection";
import { assetDisplayName } from "./asset-language";
import {
  evaluateStageProgress,
  groundRoleStageContent,
  reviewDecisionSet,
  reviewStory,
  type ContentReview,
  type ResolutionDraft,
  type ResolvedStoryAction,
  type StageProgressDecision,
  type StoryRoleContext,
  type StorySituationInput,
  type VisibleFact
} from "./story-content";
import {
  boundaryAccepted,
  candidateIntentDraft,
  guardPlayerIntentV2,
  intentInvariantDiff,
  normalizePlayerIntentV2,
  planIntentAction,
  type PlannedIntentAction
} from "./player-intent";
import { StoryContextComposerV2 } from "./story-context.composer";
import { StoryGenerationErrorV2 } from "./story-generation.pipeline";
import { StoryNarrativeProvider } from "./story-narrative.provider";
import { operationalMetrics } from "../observability/operational-metrics";

type Tx = Prisma.TransactionClient;

class DecisionContextMovedError extends Error {
  constructor() { super("DECISION_CONTEXT_MOVED"); }
}

class AgentLeaseLostError extends Error {
  constructor() { super("AGENT_LEASE_LOST"); }
}

type ImpactTaskPayloadV2 = {
  sourceRoleId: string;
  sourceRoleName: string;
  targetRoleId: string;
  targetRoleName: string;
  stageIndex: number;
  appliedWorldSequence: number;
  playerActionId: string;
  mode: "FULL" | "TRACE";
  action: PlannedIntentAction;
};

type ResultTaskPayloadV2 = {
  action: PlannedIntentAction;
  stageProgress: StageProgressDecision;
  actorKind: "HUMAN" | "AI";
  controlEpoch: number;
};

/**
 * Failed result reservations leave the positive world-sequence namespace
 * before later reservations are compacted. A role may fail repeatedly while
 * retrying the same positive sequence, so derive the parking value from the
 * run's current minimum instead of reusing one value per positive sequence.
 */
export function nextResolutionParkingSequence(currentMinimum: number | null | undefined, failedSequence: number) {
  const failedFloor = -(10_000_000 + Math.max(0, Math.trunc(failedSequence)));
  if (!Number.isFinite(currentMinimum)) return failedFloor;
  return Math.min(failedFloor, Math.trunc(Number(currentMinimum)) - 1);
}

@Injectable()
export class ContinuousStoryV2Service {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ContinuousStrategyContentService) private readonly content: ContinuousStrategyContentService,
    @Inject(ContinuousEventDeliveryService) private readonly deliveries: ContinuousEventDeliveryService,
    @Inject(StoryAccessService) private readonly access: StoryAccessService,
    @Inject(StoryContextComposerV2) private readonly storyContexts: StoryContextComposerV2,
    @Inject(StoryNarrativeProvider) private readonly narrator: StoryNarrativeProvider,
    @Inject(CreditConsumptionService) private readonly creditConsumption: CreditConsumptionService = null as never
  ) {}

  async start(user: AuthenticatedUser, roomId: string) {
    const initialized = await this.serializable(async (tx) => {
      const room = await tx.storyRun.findUnique({
        where: { id: roomId },
        include: {
          roles: { orderBy: { createdAt: "asc" } },
          players: { where: { playerType: "human", status: "active" }, orderBy: { joinedAt: "asc" } }
        }
      });
      if (!room || room.mode !== "room") throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
      if (room.ownerUserId !== user.id) throw new ForbiddenException({ code: "HOST_REQUIRED", message: "Only the host can start the room" });
      this.requireV2(room.engineVersion);
      const lobby = roomState(room.stateJson);
      const soloNpcMode = isSoloNpcRun(room, lobby);
      if (room.status === "playing") {
        const humanRoleIds = room.players.map((player) => player.roleId).filter((id): id is string => Boolean(id));
        if (soloNpcMode) await this.normalizeSoloNpcRuntime(tx, room.id, humanRoleIds);
        const pendingTurns = await tx.actorTurn.findMany({
          where: { runId: room.id, status: "GENERATING", turnIndex: 1 },
          select: { id: true, roleId: true }
        });
        const ownerRoleId = room.players.find((player) => player.userId === user.id)?.roleId || null;
        return { pendingTurns, humanRoleIds, ownerRoleId };
      }
      if (room.status !== "waiting_players") throw new ConflictException({ code: "ROOM_NOT_WAITING", message: "Room cannot be started now" });

      const game = getGameDefinition(room.templateKey);
      const packageContent = this.content.forGame(room.templateKey, room.strategyVersion);
      const playableKeys = packageContent.package().contract.playableRoleKeys;
      const playable = room.roles.filter((role) => playableKeys.includes(role.roleKey));
      const ready = new Set(lobby.room?.readyUserIds || []);
      const minimum = lobby.room?.minPlayers || game.modes.minHumanPlayers;
      if (!lobby.room?.hostRoleLocked) throw new BadRequestException({ code: "HOST_ROLE_NOT_LOCKED", message: "The host must lock a role" });
      if (room.players.length < minimum
        || room.players.some((player) => !player.userId || !player.roleId || !ready.has(player.userId))
        || new Set(room.players.map((player) => player.roleId)).size !== room.players.length) {
        throw new ConflictException({ code: "ROOM_NOT_READY", message: "Every joined human must claim a distinct role and be ready" });
      }
      if (playable.length !== playableKeys.length) throw new ConflictException({ code: "CONTINUOUS_ROLE_SET_INVALID", message: "Registered roles do not match the story package" });
      if (!room.currentNodeId) throw new ConflictException({ code: "CURRENT_NODE_REQUIRED", message: "The room has no opening node" });

      const now = new Date();
      const humanByRoleId = new Map(room.players.filter((player) => player.roleId).map((player) => [player.roleId!, player]));
      const allRoleIds = playable.map((role) => role.id);
      const facts = await tx.canonFact.findMany({ where: { runId: room.id, status: "confirmed" }, orderBy: { createdAt: "asc" } });
      await this.ensureStageAssets(tx, room.id, 1, playable);
      const aiRoles = playable.filter((role) => !humanByRoleId.has(role.id));
      const humanRoles = playable.filter((role) => humanByRoleId.has(role.id));
      if (aiRoles.length) {
        await tx.storyPlayer.createMany({
          skipDuplicates: true,
          data: aiRoles.map((role) => ({
            runId: room.id,
            roleId: role.id,
            userId: null,
            playerType: soloNpcMode ? "npc" : "ai",
            status: "active",
            lastActiveAt: now
          }))
        });
        await tx.storyRole.updateMany({
          where: { id: { in: aiRoles.map((role) => role.id) } },
          data: { isAiControlled: !soloNpcMode, status: soloNpcMode ? "npc" : "ai_controlled" }
        });
      }
      if (humanRoles.length) {
        await tx.storyRole.updateMany({ where: { id: { in: humanRoles.map((role) => role.id) } }, data: { isAiControlled: false, status: "claimed" } });
      }
      await tx.roleControl.createMany({
        data: playable.map((role) => {
          const human = humanByRoleId.get(role.id) || null;
          return {
            runId: room.id, roleId: role.id, humanPlayerId: human?.id || null,
            mode: human ? "HUMAN_ACTIVE" : soloNpcMode ? "SYSTEM" : "AI_ACTIVE", epoch: 1,
            lastHeartbeatAt: human ? now : null, takeoverAt: human || soloNpcMode ? null : now,
            reason: human ? "ROOM_STARTED" : soloNpcMode ? "SYSTEM_ROLE" : "INITIAL_AI_AGENT"
          };
        })
      });
      const threads = await tx.actorThread.createManyAndReturn({
        data: playable.map((role) => ({
          runId: room.id,
          roleId: role.id,
          status: soloNpcMode && !humanByRoleId.has(role.id) ? "NPC" : "ACTIVE"
        })),
        select: { id: true, roleId: true }
      });
      const threadByRoleId = new Map(threads.map((thread) => [thread.roleId, thread]));
      const activeActors = soloNpcMode ? humanRoles : playable;
      const turns = await tx.actorTurn.createManyAndReturn({
        data: activeActors.map((role) => {
          const thread = threadByRoleId.get(role.id)!;
          const visibleFacts = visibleFactsForRole(facts, role.id);
          return {
            runId: room.id, threadId: thread.id, roleId: role.id, stageIndex: 1, turnIndex: 1,
            status: "GENERATING", baseWorldSequence: room.worldSequence,
            situationTitle: this.content.forGame(room.templateKey, room.strategyVersion).stage(1).title,
            situationNarrative: "",
            visibleFactKeysJson: visibleFacts.map((fact) => fact.factKey), activeThreadKeysJson: ["main_pressure"],
            contextJson: { generationStatus: "PENDING", fakeStoryPublished: false } as Prisma.InputJsonValue,
            qualityStatus: "PENDING", dedupeKey: `actor-turn:${thread.id}:1`
          };
        }),
        select: { id: true, roleId: true, threadId: true }
      });
      await tx.storyTaskOutbox.createMany({
        data: turns.map((turn) => ({
          runId: room.id,
          nodeId: room.currentNodeId!,
          roleId: turn.roleId,
          inputRefId: turn.id,
          actionSlot: "ACTOR_OPENING",
          controlEpoch: 1,
          taskType: "ACTOR_OPENING_V2",
          // A Solo human opening is generated synchronously below. Reserve its
          // outbox row inside the start transaction so the background drain
          // cannot launch a duplicate Writer + DecisionDesigner pipeline.
          status: soloNpcMode && humanByRoleId.has(turn.roleId) ? "RUNNING" : "PENDING",
          leaseOwner: soloNpcMode && humanByRoleId.has(turn.roleId) ? `solo-start:${turn.id}` : null,
          leaseExpiresAt: soloNpcMode && humanByRoleId.has(turn.roleId)
            ? new Date(now.getTime() + 10 * 60 * 1000)
            : null,
          leaseVersion: soloNpcMode && humanByRoleId.has(turn.roleId) ? 1 : 0,
          startedAt: soloNpcMode && humanByRoleId.has(turn.roleId) ? now : null,
          dedupeKey: `ACTOR_OPENING_V2:${turn.id}`,
          maxAttempts: 3
        }))
      });

      await tx.storyRun.update({
        where: { id: room.id },
        data: {
          status: "playing",
          currentDay: 1,
          activeHumanCount: room.players.length,
          aiPlayerCount: soloNpcMode ? 0 : playable.length - room.players.length,
          version: { increment: 1 }
        }
      });
      await tx.sceneNode.update({ where: { id: room.currentNodeId }, data: { status: "open_for_actions" } });
      await this.deliveries.publish(tx, {
        runId: room.id,
        nodeId: room.currentNodeId,
        day: 1,
        type: "ROOM_STARTED_V2",
        visibility: "PUBLIC",
        audienceType: "ALL_MEMBERS",
        audienceUserIds: room.players.map((player) => player.userId!).filter(Boolean),
        audienceRoleIds: allRoleIds,
        payload: {
          roomId: room.id,
          engineVersion: room.engineVersion,
          independentActorThreads: !soloNpcMode,
          soloNpcNarrative: soloNpcMode
        },
        dedupeKey: `ROOM_STARTED_V2:${room.id}`
      });
      return {
        pendingTurns: turns.map((turn) => ({ id: turn.id, roleId: turn.roleId })),
        humanRoleIds: humanRoles.map((role) => role.id),
        ownerRoleId: room.players.find((player) => player.userId === user.id)?.roleId || null
      };
    });

    const humanRoleIds = new Set(initialized.humanRoleIds);
    const immediateTurns = initialized.pendingTurns.filter((turn) => humanRoleIds.has(turn.roleId));
    const results = await Promise.allSettled(immediateTurns.map((turn) => this.generateOpeningForTurn(turn.id)));
    const failedTurnIds = immediateTurns
      .filter((_, index) => results[index]?.status === "rejected")
      .map((turn) => turn.id);
    if (failedTurnIds.length) {
      await this.prisma.storyTaskOutbox.updateMany({
        where: {
          runId: roomId,
          inputRefId: { in: failedTurnIds },
          taskType: "ACTOR_OPENING_V2",
          status: "RUNNING",
          leaseOwner: { startsWith: "solo-start:" }
        },
        data: {
          status: "PENDING",
          nextRetryAt: new Date(),
          startedAt: null,
          leaseOwner: null,
          leaseExpiresAt: null
        }
      });
    }
    const ownerIndex = immediateTurns.findIndex((turn) => turn.roleId === initialized.ownerRoleId);
    if (ownerIndex >= 0 && results[ownerIndex]?.status === "rejected") {
      throw new ServiceUnavailableException({
        code: "OPENING_STORY_GENERATING",
        message: "你的真实开场剧情仍在生成，系统没有发布固定模板或通用选项。故事局已经保留，请稍后重试进入。",
        recoverable: true,
        roomId
      });
    }
    return {
      roomId,
      runId: roomId,
      status: "playing",
      openingStatus: results.some((result) => result.status === "rejected") ? "PARTIAL_GENERATING" : "READY",
      gameProjection: await this.game(user, roomId)
    };
  }

  private async normalizeSoloNpcRuntime(tx: Tx, runId: string, humanRoleIds: string[]) {
    const npcRoles = await tx.storyRole.findMany({
      where: { runId, id: { notIn: humanRoleIds } },
      select: { id: true }
    });
    const npcRoleIds = npcRoles.map((role) => role.id);
    if (!npcRoleIds.length) return;
    const now = new Date();
    await tx.storyTaskOutbox.updateMany({
      where: {
        runId,
        roleId: { in: npcRoleIds },
        taskType: { in: ["ACTOR_OPENING_V2", "ACTOR_AGENT_TURN_V2", "ACTOR_RESULT_V2", "ACTOR_IMPACT_V2", "CONDITIONAL_ACTION_V2"] },
        status: { in: ["PENDING", "RUNNING"] }
      },
      data: {
        status: "COMPLETED",
        outcome: "NO_OP",
        completedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        leaseVersion: { increment: 1 },
        lastError: null
      }
    });
    await tx.actorTurn.updateMany({
      where: { runId, roleId: { in: npcRoleIds }, status: { in: ["GENERATING", "OPEN", "RESOLVING"] } },
      data: { status: "CANCELLED", resolvedAt: now }
    });
    await tx.actorThread.updateMany({
      where: { runId, roleId: { in: npcRoleIds } },
      data: { status: "NPC", completedAt: null }
    });
    await tx.roleControl.updateMany({
      where: { runId, roleId: { in: npcRoleIds } },
      data: { mode: "SYSTEM", reason: "SYSTEM_ROLE", takeoverAt: null, offlineSince: null }
    });
    await tx.storyRole.updateMany({
      where: { runId, id: { in: npcRoleIds } },
      data: { isAiControlled: false, status: "npc" }
    });
    await tx.storyPlayer.updateMany({
      where: { runId, roleId: { in: npcRoleIds }, playerType: { not: "human" } },
      data: { playerType: "npc" }
    });
    await tx.storyRun.update({ where: { id: runId }, data: { aiPlayerCount: 0 } });
  }

  async game(user: AuthenticatedUser, roomId: string): Promise<GameProjectionV2> {
    const run = await this.prisma.storyRun.findUnique({
      where: { id: roomId },
      include: {
        players: { where: { status: "active" }, include: { role: true } },
        roleControls: true,
        actorThreads: { include: { role: true }, orderBy: { createdAt: "asc" } }
      }
    });
    if (!run || run.mode !== "room") throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    this.requireV2(run.engineVersion);
    const membership = run.players.find((player) => player.userId === user.id);
    if (!membership?.role) throw new ForbiddenException({ code: "ROOM_MEMBERSHIP_REQUIRED", message: "A claimed room role is required" });
    const actorThread = run.actorThreads.find((thread) => thread.roleId === membership.role!.id) || null;
    const [control, turn, facts, entries, assets, commitments, armedConditions, pendingInteractions, actionResolutions] = await Promise.all([
      this.prisma.roleControl.findUnique({ where: { runId_roleId: { runId: roomId, roleId: membership.role.id } } }),
      this.prisma.actorTurn.findFirst({
        where: { runId: roomId, roleId: membership.role.id, status: { in: ["OPEN", "RESOLVING"] } },
        include: { decisionSet: true },
        orderBy: { turnIndex: "desc" }
      }),
      this.prisma.canonFact.findMany({ where: { runId: roomId, status: "confirmed" }, orderBy: { createdAt: "asc" } }),
      this.prisma.narrativeEntry.findMany({
        where: {
          runId: roomId,
          entryType: { not: "scene_open" },
          OR: [{ visibility: "public" }, { roleId: membership.role.id }]
        },
        orderBy: [{ worldSequence: "asc" }, { createdAt: "asc" }],
        take: 120
      }),
      this.prisma.roleAsset.findMany({
        where: {
          runId: roomId,
          OR: [{ ownerRoleId: membership.role.id }, { visibility: { in: ["PUBLIC", "OBSERVABLE"] } }]
        },
        orderBy: { assetKey: "asc" }
      }),
      this.prisma.commitmentV2.findMany({
        where: {
          runId: roomId,
          OR: [
            { issuerRoleId: membership.role.id },
            { receiverRoleId: membership.role.id },
            { visibility: { in: ["PUBLIC", "OBSERVABLE"] } }
          ]
        },
        include: { issuerRole: true, receiverRole: true },
        orderBy: { createdAt: "asc" }
      }),
      actorThread
        ? this.prisma.conditionalActionV2.findMany({ where: { ownerThreadId: actorThread.id, status: "ARMED" }, orderBy: { createdAt: "asc" } })
        : Promise.resolve([]),
      this.prisma.interactionRequestV2.findMany({
        where: { runId: roomId, targetRoleId: membership.role.id, status: "OPEN" },
        include: { sourceRole: true },
        orderBy: { createdAt: "asc" }
      }),
      this.prisma.actionResolution.findMany({
        where: { runId: roomId, roleId: membership.role.id },
        include: { playerAction: { select: { actionType: true } } },
        orderBy: { appliedWorldSequence: "asc" },
        take: 120
      })
    ]);
    if (!control) throw new ConflictException({ code: "ROLE_CONTROL_NOT_READY", message: "Role control is not ready" });
    const visibleFacts = visibleFactsForRole(facts, membership.role.id);
    const decisionFormBySequence = new Map(actionResolutions.map((resolution) => [
      resolution.appliedWorldSequence,
      decisionFormFromActionType(resolution.playerAction.actionType)
    ]));
    const decisionCandidates = asDecisionCandidates(turn?.decisionSet?.candidatesJson);
    const access = this.access.roomAccessState(run, turn?.stageIndex || run.currentDay);
    const creditConfig = readCreditConsumptionConfig();
    const billing = parseRunBilling(run, creditConfig.prices);
    const [creditAvailability, sponsorshipRequest] = await Promise.all([
      this.creditConsumption.availableForRun(run.id, user.id),
      (this.prisma as any).sponsorshipRequest.findFirst({ where: { runId: run.id, beneficiaryUserId: user.id }, orderBy: { createdAt: "desc" } })
    ]);
    const activeActionBilling = billing.policyVersion === "active_action_v1";
    const projection: GameProjectionV2 = {
      schemaVersion: GAME_PROJECTION_V2_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      worldSequence: run.worldSequence,
      room: { id: run.id, title: run.title, worldId: run.templateKey, status: run.status, mode: run.maxPlayers === 1 ? "solo" : "multiplayer", ownerUserId: run.ownerUserId },
      world: gamePageProjection(run.templateKey),
      player: {
        userId: user.id,
        roleId: membership.role.id,
        roleKey: membership.role.roleKey,
        roleName: membership.role.roleName,
        identity: membership.role.identity,
        personalGoal: membership.role.personalGoal
      },
      control: { mode: control.mode, epoch: control.epoch, canHumanAct: control.mode === "HUMAN_ACTIVE" || control.mode === "HUMAN_OFFLINE_GRACE" },
      currentTurn: turn ? {
        id: turn.id,
        revision: turn.revision,
        stageIndex: turn.stageIndex,
        turnIndex: turn.turnIndex,
        baseWorldSequence: turn.baseWorldSequence,
        status: turn.status as "OPEN" | "RESOLVING",
        title: turn.situationTitle,
        narrative: turn.situationNarrative,
        visibleFacts: visibleFacts.map((fact) => ({ factKey: fact.factKey, content: fact.content })),
        framing: turn.decisionSet?.framing || "",
        decisions: decisionCandidates,
        availableTargets: buildAvailableTargets(run.actorThreads.map((thread) => thread.role), visibleFacts, assets, turn.stageIndex, run.templateKey),
        customActionAllowed: true
      } : null,
      timeline: entries.map((entry) => ({
        id: entry.id,
        kind: narrativeKind(entry.entryType),
        title: narrativeTitle(entry.entryType),
        content: entry.content,
        worldSequence: entry.worldSequence || 0,
        createdAt: entry.createdAt.toISOString(),
        decisionForm: entry.entryType === "V2_RESULT" ? decisionFormBySequence.get(entry.worldSequence || 0) : undefined
      })),
      otherActors: run.actorThreads.map((thread) => {
        const player = run.players.find((candidate) => candidate.roleId === thread.roleId);
        const actorControl = run.roleControls.find((candidate) => candidate.roleId === thread.roleId);
        return { roleId: thread.roleId, roleName: thread.role.roleName, controllerKind: actorControl?.mode === "AI_ACTIVE" || player?.playerType !== "human" ? "AI" as const : "HUMAN" as const, stageIndex: thread.currentStageIndex };
      }),
      visibleAssets: assets.map((asset) => ({
        assetKey: asset.assetKey,
        kind: asset.kind,
        label: assetDisplayName(asset.assetKey),
        quantity: asset.quantity,
        status: asset.status
      })),
      evidenceHoldings: assets.filter((asset) => /evidence|document|register|ledger|seal|testimony|证|册|账|印|供词/i.test(`${asset.kind} ${asset.assetKey}`)).map((asset) => ({
        assetKey: asset.assetKey,
        kind: asset.kind,
        label: assetDisplayName(asset.assetKey),
        quantity: asset.quantity,
        status: asset.status
      })),
      commitments: commitments.map((commitment) => ({
        id: commitment.id,
        issuerRoleId: commitment.issuerRoleId,
        issuerRoleName: commitment.issuerRole.roleName,
        receiverRoleId: commitment.receiverRoleId,
        receiverRoleName: commitment.receiverRole.roleName,
        content: commitment.content,
        visibility: commitment.visibility as "PRIVATE" | "LIMITED" | "OBSERVABLE" | "PUBLIC",
        expiresAtStage: commitment.expiresAtStage,
        status: commitment.status
      })),
      armedConditions: armedConditions.map((condition) => {
        const raw = jsonRecord(condition.rawConditionJson);
        const command = jsonRecord(condition.normalizedCommandJson);
        const intent = jsonRecord(command.intent);
        return {
          id: condition.id,
          eventType: String(raw.eventType || ""),
          actorRoleId: typeof raw.actorRoleId === "string" ? raw.actorRoleId : null,
          targetId: typeof raw.targetId === "string" ? raw.targetId : null,
          expiresAtStage: condition.expiresAtStage,
          fallbackMethod: typeof intent.method === "string" ? intent.method : null,
          status: condition.status
        };
      }),
      pendingInteractions: pendingInteractions.map((interaction) => {
        const pressure = jsonRecord(interaction.pressureJson);
        const trace = jsonRecord(interaction.observableTraceJson);
        return {
          id: interaction.id,
          sourceRoleId: interaction.sourceRoleId,
          sourceRoleName: interaction.sourceRole.roleName,
          requestKind: interaction.requestKind,
          pressure: [pressure.objective, pressure.method].filter((value) => typeof value === "string" && value).join("；"),
          observableTrace: typeof trace.content === "string" ? trace.content : null,
          expiresAt: interaction.expiresAt?.toISOString() || null,
          responseOptions: decisionCandidates.map((candidate) => ({
            id: candidate.id,
            label: candidate.label,
            description: candidate.description,
            intentDraft: candidate.intentDraft
          }))
        };
      }),
      observableTraces: entries.filter((entry) => entry.entryType === "V2_OBSERVABLE_TRACE").map((entry) => ({
        id: entry.id,
        content: entry.content,
        worldSequence: entry.worldSequence || 0,
        createdAt: entry.createdAt.toISOString()
      })),
      access: {
        state: activeActionBilling ? "UNLOCKED" : access.unlocked ? "UNLOCKED" : access.requiresUnlock ? "REQUIRES_UNLOCK" : "FREE",
        requiresUnlock: activeActionBilling ? false : access.requiresUnlock,
        requiredCredits: activeActionBilling ? 0 : access.requiredCredits,
        canCurrentUserUnlock: activeActionBilling ? false : access.requiresUnlock,
        unlockEndpoint: activeActionBilling ? null : `/v4/story-runs/${run.id}/unlock`
      },
      creditControl: {
        policyVersion: billing.policyVersion,
        meteringMode: creditConfig.meteringMode,
        available: creditAvailability.available,
        personalAvailable: creditAvailability.personalAvailable,
        runAllowanceAvailable: creditAvailability.runAllowanceAvailable,
        minimumActionCost: billing.prices.standardAction,
        standardActionCost: billing.prices.standardAction,
        customActionCost: billing.prices.customAction,
        canRequestSponsor: activeActionBilling && run.ownerUserId !== user.id && !["chapter_generated", "closed", "failed"].includes(run.status),
        sponsorshipRequestStatus: sponsorshipRequest?.status || "NONE"
      },
      completed: actorThread?.status === "COMPLETED",
      resultUrl: actorThread?.status === "COMPLETED" ? `/rooms/${run.id}/result` : null
    };
    const validation = validateGameProjectionV2(projection);
    if (!validation.ok) throw new Error(`GAME_PROJECTION_V2_INVALID:${validation.errors.join("|")}`);
    return projection;
  }

  async retryResultGeneration(user: AuthenticatedUser, roomId: string) {
    const membership = await this.prisma.storyPlayer.findFirst({
      where: { runId: roomId, userId: user.id, status: "active", roleId: { not: null } },
      select: { roleId: true }
    });
    if (!membership?.roleId) throw new ForbiddenException({ code: "ROOM_MEMBERSHIP_REQUIRED", message: "A claimed room role is required" });
    const openingTurn = await this.prisma.actorTurn.findFirst({
      where: { runId: roomId, roleId: membership.roleId, status: "GENERATING" },
      orderBy: { turnIndex: "desc" },
      select: { id: true }
    });
    if (openingTurn) {
      const openingTask = await this.prisma.storyTaskOutbox.findUnique({
        where: { dedupeKey: `ACTOR_OPENING_V2:${openingTurn.id}` }
      });
      if (!openingTask) throw new ServiceUnavailableException({ code: "OPENING_TASK_MISSING", message: "The opening story task has not been created yet. Please try again shortly.", recoverable: true });
      if (openingTask.status === "FAILED") {
        const reset = await this.prisma.storyTaskOutbox.updateMany({
          where: { id: openingTask.id, status: "FAILED" },
          data: {
            status: "PENDING",
            attempt: 0,
            nextRetryAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
            startedAt: null,
            completedAt: null,
            outcome: null,
            lastError: null
          }
        });
        return { scheduled: reset.count === 1, status: reset.count === 1 ? "REQUEUED" : "MOVED", taskId: openingTask.id, kind: "OPENING" };
      }
      return {
        scheduled: openingTask.status === "PENDING" || openingTask.status === "RUNNING",
        status: openingTask.status,
        taskId: openingTask.id,
        kind: "OPENING"
      };
    }
    const resolution = await this.prisma.actionResolution.findFirst({
      where: { runId: roomId, roleId: membership.roleId, qualityStatus: "GENERATING" },
      orderBy: { appliedWorldSequence: "desc" },
      select: { id: true }
    });
    if (!resolution) return { scheduled: false, status: "NOT_NEEDED" };
    const task = await this.prisma.storyTaskOutbox.findUnique({ where: { dedupeKey: `ACTOR_RESULT_V2:${resolution.id}` } });
    if (!task) throw new ServiceUnavailableException({ code: "RESULT_TASK_MISSING", message: "结果剧情任务尚未建立，请稍后重试。", recoverable: true });
    if (task.status === "FAILED") {
      const reset = await this.prisma.storyTaskOutbox.updateMany({
        where: { id: task.id, status: "FAILED" },
        data: {
          status: "PENDING",
          attempt: 0,
          nextRetryAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          startedAt: null,
          completedAt: null,
          outcome: null,
          lastError: null
        }
      });
      return { scheduled: reset.count === 1, status: reset.count === 1 ? "REQUEUED" : "MOVED", taskId: task.id };
    }
    return { scheduled: task.status === "PENDING" || task.status === "RUNNING", status: task.status, taskId: task.id };
  }

  async result(user: AuthenticatedUser, roomId: string) {
    const run = await this.prisma.storyRun.findUnique({
      where: { id: roomId },
      include: { players: { where: { userId: user.id, status: "active" }, include: { role: true } } }
    });
    if (!run || run.mode !== "room") throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    this.requireV2(run.engineVersion);
    const role = run.players[0]?.role;
    if (!role) throw new ForbiddenException({ code: "ROOM_MEMBERSHIP_REQUIRED", message: "A claimed role is required" });
    const [thread, resolutions, entries, reviews] = await Promise.all([
      this.prisma.actorThread.findUnique({ where: { roleId: role.id } }),
      this.prisma.actionResolution.findMany({ where: { runId: roomId, roleId: role.id }, orderBy: { appliedWorldSequence: "asc" } }),
      this.prisma.narrativeEntry.findMany({ where: { runId: roomId, roleId: role.id }, orderBy: [{ worldSequence: "asc" }, { createdAt: "asc" }] }),
      this.prisma.contentQualityReview.findMany({ where: { runId: roomId, roleId: role.id }, orderBy: { createdAt: "asc" } })
    ]);
    if (!thread || thread.status !== "COMPLETED") throw new ConflictException({ code: "RESULT_NOT_READY", message: "This role's story is still in progress" });
    return {
      schemaVersion: "continuous_story_result_v2",
      room: { id: run.id, title: run.title, worldId: run.templateKey, worldSequence: run.worldSequence },
      player: { roleId: role.id, roleKey: role.roleKey, roleName: role.roleName, personalGoal: role.personalGoal },
      completedAt: thread.completedAt,
      decisions: resolutions.map((resolution) => ({
        resolutionId: resolution.id,
        worldSequence: resolution.appliedWorldSequence,
        resultNarrative: resolution.resultNarrative,
        nextHook: resolution.nextHook
      })),
      story: entries.map((entry) => ({ type: entry.entryType, content: entry.content, worldSequence: entry.worldSequence, createdAt: entry.createdAt })),
      quality: { total: reviews.length, passed: reviews.filter((review) => review.status === "PASS").length, failed: reviews.filter((review) => review.status !== "PASS").length }
    };
  }

  async heartbeat(user: AuthenticatedUser, roomId: string, command: HeartbeatCommandV1) {
    validateHeartbeatCommand(command);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 45_000);
    const result = await this.prisma.$transaction(async (tx) => {
      const context = await this.controlContext(tx, user, roomId);
      const key = { runId: roomId, userId: user.id, sessionInstanceId: command.sessionInstanceId };
      const existing = await tx.presenceSession.findUnique({ where: { runId_userId_sessionInstanceId: key } });
      if (existing && command.heartbeatSequence <= existing.lastHeartbeatSequence) {
        return { accepted: false, control: context.control };
      }
      await tx.presenceSession.upsert({
        where: { runId_userId_sessionInstanceId: key },
        update: {
          playerId: context.player.id, roleId: context.role.id,
          lastHeartbeatSequence: command.heartbeatSequence,
          lastAppliedDeliverySequence: Math.max(existing?.lastAppliedDeliverySequence || 0, command.lastAppliedDeliverySequence),
          lastHeartbeatAt: now, expiresAt
        },
        create: {
          ...key, playerId: context.player.id, roleId: context.role.id,
          lastHeartbeatSequence: command.heartbeatSequence,
          lastAppliedDeliverySequence: command.lastAppliedDeliverySequence,
          lastHeartbeatAt: now, expiresAt
        }
      });
      await tx.storyPlayer.update({ where: { id: context.player.id }, data: { lastActiveAt: now } });
      const control = await tx.roleControl.update({ where: { id: context.control.id }, data: { lastHeartbeatAt: now } });
      return { accepted: true, control };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 30_000 });
    return {
      accepted: result.accepted,
      serverNow: now.toISOString(),
      nextHeartbeatAt: new Date(now.getTime() + 10_000).toISOString(),
      rolePresence: controlProjection(result.control)
    };
  }

  async handoff(user: AuthenticatedUser, roomId: string, command: ControlCommandV1) {
    validateControlCommand(command);
    await this.serializable(async (tx) => {
      const context = await this.controlContext(tx, user, roomId);
      const replay = await tx.roleControlTransition.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
      if (replay) {
        if (replay.roleControlId !== context.control.id || replay.fromEpoch !== command.expectedControlEpoch || replay.toMode !== "AI_ACTIVE") throw idempotencyReused();
        return;
      }
      if (context.control.humanPlayerId !== context.player.id) throw new ForbiddenException({ code: "ROLE_FORBIDDEN", message: "Only the original player can hand off this role" });
      if (context.control.epoch !== command.expectedControlEpoch || !["HUMAN_ACTIVE", "HUMAN_OFFLINE_GRACE"].includes(context.control.mode)) throw controlChanged();
      const nextEpoch = context.control.epoch + 1;
      await tx.roleControl.update({ where: { id: context.control.id }, data: { mode: "AI_ACTIVE", epoch: nextEpoch, reason: "EXPLICIT_HANDOFF", takeoverAt: new Date(), offlineSince: null } });
      await tx.storyRole.update({ where: { id: context.role.id }, data: { isAiControlled: true, status: "ai_controlled" } });
      await tx.roleControlTransition.create({
        data: {
          roleControlId: context.control.id, fromMode: context.control.mode, toMode: "AI_ACTIVE",
          fromEpoch: context.control.epoch, toEpoch: nextEpoch, reason: "EXPLICIT_HANDOFF",
          initiatedByUserId: user.id, effectiveSlot: context.turn ? `TURN:${context.turn.id}` : "STORY_COMPLETED",
          idempotencyKey: command.idempotencyKey
        }
      });
      if (context.turn && context.run.currentNodeId) {
        await tx.storyTaskOutbox.upsert({
          where: { dedupeKey: `ACTOR_AGENT_TURN_V2:${context.turn.id}` },
          update: {
            status: "PENDING", outcome: null, inputRefId: context.turn.id, roleId: context.role.id,
            controlEpoch: nextEpoch, nextRetryAt: new Date(), attempt: 0, completedAt: null,
            leaseOwner: null, leaseExpiresAt: null, lastError: null, resultJson: Prisma.DbNull
          },
          create: {
            runId: roomId, nodeId: context.run.currentNodeId, roleId: context.role.id, inputRefId: context.turn.id,
            actionSlot: "ACTOR_TURN", controlEpoch: nextEpoch, taskType: "ACTOR_AGENT_TURN_V2", status: "PENDING",
            dedupeKey: `ACTOR_AGENT_TURN_V2:${context.turn.id}`, maxAttempts: 3
          }
        });
      }
      await tx.storyRun.update({ where: { id: roomId }, data: { version: { increment: 1 } } });
      await this.publishControlChange(tx, context, user.id, command.idempotencyKey, "AI", nextEpoch);
    });
    return { accepted: true, gameProjection: await this.game(user, roomId) };
  }

  async reclaim(user: AuthenticatedUser, roomId: string, command: ControlCommandV1) {
    validateControlCommand(command);
    const outcome = await this.serializable(async (tx) => {
      const context = await this.controlContext(tx, user, roomId);
      const replay = await tx.roleControlTransition.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
      if (replay) {
        if (replay.roleControlId !== context.control.id || replay.fromEpoch !== command.expectedControlEpoch || !["HUMAN_ACTIVE", "HUMAN_RECLAIM_PENDING"].includes(replay.toMode)) throw idempotencyReused();
        return { kind: "replay" as const, mode: replay.toMode, epoch: replay.toEpoch };
      }
      if (context.control.humanPlayerId !== context.player.id) throw new ForbiddenException({ code: "ROLE_FORBIDDEN", message: "Only the original player can reclaim this role" });
      if (context.control.epoch !== command.expectedControlEpoch || context.control.mode !== "AI_ACTIVE") throw controlChanged();
      const billing = parseRunBilling(context.run, readCreditConsumptionConfig().prices);
      if (billing.policyVersion === "active_action_v1") {
        const available = await this.creditConsumption.availableForRun(roomId, user.id, tx);
        if (available.available < billing.prices.standardAction) {
          return {
            kind: "insufficient" as const,
            requiredCredits: billing.prices.standardAction,
            availableCredits: available.available,
            runAllowanceAvailable: available.runAllowanceAvailable,
            personalAvailable: available.personalAvailable
          };
        }
      }
      const aiAlreadySealed = context.turn ? await tx.playerAction.findFirst({
        where: {
          runId: roomId,
          roleId: context.role.id,
          actionSlot: `TURN:${context.turn.id}`,
          actorKind: "AI_TAKEOVER",
          sealedAt: { not: null },
          status: { in: ["accepted", "resolved"] }
        }
      }) : null;
      const immediate = !aiAlreadySealed;
      const nextEpoch = context.control.epoch + 1;
      const toMode = immediate ? "HUMAN_ACTIVE" : "HUMAN_RECLAIM_PENDING";
      await tx.roleControl.update({ where: { id: context.control.id }, data: { mode: toMode, epoch: nextEpoch, reason: immediate ? "PLAYER_RECLAIMED" : "PLAYER_RECLAIM_SCHEDULED", takeoverAt: immediate ? null : context.control.takeoverAt, lastHeartbeatAt: new Date() } });
      await tx.storyRole.update({ where: { id: context.role.id }, data: { isAiControlled: !immediate, status: immediate ? "claimed" : "ai_controlled" } });
      await tx.roleControlTransition.create({
        data: {
          roleControlId: context.control.id, fromMode: context.control.mode, toMode,
          fromEpoch: context.control.epoch, toEpoch: nextEpoch, reason: immediate ? "PLAYER_RECLAIMED" : "PLAYER_RECLAIM_SCHEDULED",
          initiatedByUserId: user.id, effectiveSlot: immediate ? (context.turn ? `TURN:${context.turn.id}` : "STORY_COMPLETED") : "NEXT_ACTOR_TURN",
          idempotencyKey: command.idempotencyKey
        }
      });
      if (immediate) {
        await tx.storyTaskOutbox.updateMany({
          where: { runId: roomId, roleId: context.role.id, taskType: "ACTOR_AGENT_TURN_V2", status: { in: ["PENDING", "RUNNING"] } },
          data: {
            status: "COMPLETED", outcome: "CONTROL_RECLAIMED", completedAt: new Date(),
            leaseOwner: null, leaseExpiresAt: null, leaseVersion: { increment: 1 }, lastError: null
          }
        });
      }
      await tx.storyRun.update({ where: { id: roomId }, data: { version: { increment: 1 } } });
      if (immediate) {
        await this.publishControlChange(tx, context, user.id, command.idempotencyKey, "HUMAN", nextEpoch);
      } else {
        await this.deliveries.publish(tx, {
          runId: roomId, nodeId: context.run.currentNodeId || undefined, day: context.turn?.stageIndex || context.run.currentDay,
          type: "ROLE_RECLAIM_SCHEDULED_V2", visibility: "PRIVATE", audienceType: "MEMBER",
          audienceUserIds: [user.id], audienceRoleIds: [context.role.id],
          payload: { roleId: context.role.id, epoch: nextEpoch, effectiveFromSlot: "NEXT_ACTOR_TURN" },
          dedupeKey: `ROLE_RECLAIM_SCHEDULED_V2:${command.idempotencyKey}`
        });
      }
      return { kind: "reclaimed" as const, mode: toMode, epoch: nextEpoch };
    });
    if (outcome.kind === "insufficient") {
      operationalMetrics.increment("credit_reclaim_total", { result: "insufficient" });
      throw new HttpException({
        code: "PLAYER_CREDITS_REQUIRED",
        message: "At least one available World Credit is required before reclaiming this role",
        requiredCredits: outcome.requiredCredits,
        availableCredits: outcome.availableCredits,
        runAllowanceAvailable: outcome.runAllowanceAvailable,
        personalAvailable: outcome.personalAvailable,
        canRequestSponsor: true
      }, HttpStatus.PAYMENT_REQUIRED);
    }
    operationalMetrics.increment("credit_reclaim_total", { result: outcome.mode === "HUMAN_RECLAIM_PENDING" ? "pending" : outcome.kind });
    return { accepted: true, gameProjection: await this.game(user, roomId) };
  }

  async submit(user: AuthenticatedUser, roomId: string, turnId: string, command: TurnDecisionCommandV2): Promise<TurnDecisionResponseV2> {
    validateCommand(command);
    const requestHash = sha256Canonical({ roomId, turnId, command });
    const replay = await this.replay(user, roomId, command.idempotencyKey, requestHash);
    if (replay) return replay;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      let context: Awaited<ReturnType<ContinuousStoryV2Service["loadSubmissionContext"]>>;
      try {
        context = await this.loadSubmissionContext(user, roomId, turnId, command);
      } catch (error) {
        const racedReplay = await this.replay(user, roomId, command.idempotencyKey, requestHash);
        if (racedReplay) return racedReplay;
        throw error;
      }
      await this.access.ensureRoomRoundAccess(user, roomId, context.turn.stageIndex);
      // Cross-role impacts may revise the still-open situation after the player
      // has read it. Revalidate the chosen action against the latest decision
      // set and bind the commit to the current revision instead of forcing the
      // player through an endless visible 409 loop.
      const effectiveCommand = { ...command, turnRevision: context.turn.revision };
      const action = this.resolveAction(context, effectiveCommand);
      const stageProgress = evaluateStageProgress(action, context.situationInput.stage, context.stageTurnOrdinal, context.run.totalDays);
      try {
        const reservation = await this.reserveResolution({
          context,
          command: effectiveCommand,
          requestHash,
          action,
          stageProgress,
          actorKind: "HUMAN"
        });
        const generated = await this.executeReservedResultInline(reservation.taskId) as any;
        const resolution = {
          id: generated.id,
          submissionId: generated.submissionId,
          appliedWorldSequence: generated.appliedWorldSequence,
          resultNarrative: generated.resultNarrative,
          nextHook: generated.nextHook
        };
        return { accepted: true, resolution, gameProjection: await this.game(user, roomId) };
      } catch (error) {
        if (error instanceof DecisionContextMovedError && attempt < 3) continue;
        const racedReplay = await this.replay(user, roomId, command.idempotencyKey, requestHash);
        if (racedReplay) return racedReplay;
        throw error;
      }
    }
    throw new ConflictException({ code: "DECISION_CONTEXT_CHANGED", message: "The world changed repeatedly; refresh the current situation" });
  }

  async replyInteraction(user: AuthenticatedUser, roomId: string, interactionId: string, command: TurnDecisionCommandV2): Promise<TurnDecisionResponseV2> {
    if (command.interactionId && command.interactionId !== interactionId) {
      throw new BadRequestException({ code: "INVALID_COMMAND", message: "interactionId 与路径不一致。" });
    }
    const interaction = await this.prisma.interactionRequestV2.findFirst({
      where: { id: interactionId, runId: roomId, status: "OPEN" }
    });
    if (!interaction) throw new NotFoundException({ code: "INTERACTION_NOT_FOUND", message: "这项回应请求不存在或已经处理。" });
    const membership = await this.prisma.storyPlayer.findFirst({
      where: { runId: roomId, userId: user.id, roleId: interaction.targetRoleId, status: "active" }
    });
    if (!membership) throw new ForbiddenException({ code: "INTERACTION_FORBIDDEN", message: "只有被请求的角色能够回应。" });
    const turn = await this.prisma.actorTurn.findFirst({
      where: { runId: roomId, roleId: interaction.targetRoleId, status: "OPEN" },
      orderBy: { turnIndex: "desc" }
    });
    if (!turn) throw new ConflictException({ code: "TURN_NOT_AVAILABLE", message: "当前角色没有可用于回应的开放剧情。" });
    return this.submit(user, roomId, turn.id, { ...command, interactionId });
  }

  async executeOpeningTask(taskId: string, fence: { taskId: string; leaseOwner: string; leaseVersion: number }) {
    try {
      const task = await this.prisma.storyTaskOutbox.findFirst({
        where: {
          id: taskId,
          taskType: "ACTOR_OPENING_V2",
          status: "RUNNING",
          leaseOwner: fence.leaseOwner,
          leaseVersion: fence.leaseVersion,
          leaseExpiresAt: { gt: new Date() }
        }
      });
      if (!task?.inputRefId) throw new AgentLeaseLostError();
      const outcome = await this.generateOpeningForTurn(task.inputRefId, fence);
      return { outcome: "ACTOR_OPENING_READY", turnId: outcome.turnId, decisionSetId: outcome.decisionSetId };
    } catch (error) {
      if (error instanceof AgentLeaseLostError) return { outcome: "LEASE_LOST" };
      throw error;
    }
  }

  private async generateOpeningForTurn(
    turnId: string,
    fence?: { taskId: string; leaseOwner: string; leaseVersion: number }
  ): Promise<{ turnId: string; decisionSetId: string }> {
    const turn = await this.prisma.actorTurn.findUnique({
      where: { id: turnId },
      include: { decisionSet: true, thread: true, role: true, run: true }
    });
    if (!turn) throw new NotFoundException({ code: "OPENING_TURN_NOT_FOUND", message: "Opening turn not found" });
    if (turn.status === "OPEN" && turn.decisionSet) return { turnId: turn.id, decisionSetId: turn.decisionSet.id };
    if (turn.status !== "GENERATING") throw new ConflictException({ code: "OPENING_TURN_MOVED", message: "Opening turn is no longer generating" });
    const [control, facts, allRoles] = await Promise.all([
      this.prisma.roleControl.findUnique({ where: { runId_roleId: { runId: turn.runId, roleId: turn.roleId } } }),
      this.prisma.canonFact.findMany({ where: { runId: turn.runId, status: "confirmed" }, orderBy: { createdAt: "asc" } }),
      this.prisma.storyRole.findMany({ where: { runId: turn.runId }, orderBy: { createdAt: "asc" } })
    ]);
    if (!control) throw new ConflictException({ code: "ROLE_CONTROL_NOT_READY", message: "Opening role control is missing" });
    const visibleFacts = visibleFactsForRole(facts, turn.roleId);
    const situationInput = this.situationInput(turn.run, turn.role, turn.stageIndex, turn.turnIndex, turn.run.worldSequence, visibleFacts, []);
    const persistedContext = await this.storyContexts.compileForOpening({
      run: turn.run,
      role: turn.role,
      turn,
      controlEpoch: control.epoch,
      situation: situationInput
    });
    if (!persistedContext.compilation.ok) {
      throw new ServiceUnavailableException({
        code: "OPENING_CONTEXT_REJECTED",
        message: "开场关键上下文不完整，系统没有发布模板故事。",
        recoverable: true,
        contextRecordId: persistedContext.recordId,
        issueCodes: persistedContext.compilation.report.issueCodes
      });
    }
    const snapshot = persistedContext.compilation.snapshot;
    let pipeline;
    try {
      pipeline = await this.narrator.resolveContext({
        context: snapshot,
        contextRecordId: persistedContext.recordId,
        actionResolutionId: null,
        generateDecisions: true,
        // One publication-gate repair is cheaper and safer than exposing a
        // broken opening or making the player repeatedly restart the task.
        // Provider attempts remain observable and never change Credits cost.
        maxQualityAttempts: 2,
        getCurrentIdentity: async () => {
          const [latestTurn, latestRun, latestControl] = await Promise.all([
            this.prisma.actorTurn.findUnique({ where: { id: turn.id } }),
            this.prisma.storyRun.findUnique({ where: { id: turn.runId } }),
            this.prisma.roleControl.findUnique({ where: { runId_roleId: { runId: turn.runId, roleId: turn.roleId } } })
          ]);
          if (!latestTurn || !latestRun || !latestControl) return { ...snapshot.identity, actorTurnId: "missing" };
          return {
            ...snapshot.identity,
            actorTurnId: latestTurn.id,
            worldSequence: latestRun.worldSequence,
            turnRevision: latestTurn.revision,
            controlEpoch: latestControl.epoch
          };
        }
      });
    } catch (error) {
      if (error instanceof StoryGenerationErrorV2) {
        const retryable = error.recoverable;
        throw new ServiceUnavailableException({
          code: retryable ? "OPENING_STORY_GENERATION_RETRYABLE" : "OPENING_STORY_GENERATION_REJECTED",
          message: retryable
            ? "真实开场剧情仍在生成，系统没有发布模板故事或固定选项。"
            : "本次开场正文没有通过事实与叙事门禁，系统未发布它，也不会自动重复调用模型。",
          recoverable: retryable,
          issueCodes: error.issueCodes
        });
      }
      throw error;
    }
    const openingNarrative = `${pipeline.narrative.resultNarrative}\n\n${pipeline.narrative.nextSituationNarrative}`;
    const draft = bindDecisionTargets({ decisions: pipeline.decisions }, allRoles, situationInput.roleStage);
    const storyReview = reviewStory(openingNarrative, situationInput, "SITUATION");
    const decisionReview = reviewDecisionSet(draft.decisions, situationInput);
    assertQuality(storyReview, "OPENING_STORY_QUALITY_FAILED");
    assertQuality(decisionReview, "OPENING_DECISION_QUALITY_FAILED");
    const writerExecution = pipeline.promptExecutions.find((record) => record.pipelineStep === "WRITER");
    const provider = writerExecution?.provider || "unknown";
    const modelName = writerExecution?.modelName || "unknown";

    return this.serializable(async (tx) => {
      const [latestTurn, latestControl] = await Promise.all([
        tx.actorTurn.findUnique({ where: { id: turn.id }, include: { decisionSet: true } }),
        tx.roleControl.findUnique({ where: { runId_roleId: { runId: turn.runId, roleId: turn.roleId } } })
      ]);
      if (!latestTurn) throw new ConflictException({ code: "OPENING_TURN_MOVED", message: "Opening turn disappeared" });
      if (latestTurn.status === "OPEN" && latestTurn.decisionSet) return { turnId: latestTurn.id, decisionSetId: latestTurn.decisionSet.id };
      if (latestTurn.status !== "GENERATING" || latestTurn.revision !== turn.revision) throw new ConflictException({ code: "OPENING_TURN_MOVED", message: "Opening context changed" });
      if (fence) {
        const leased = await tx.storyTaskOutbox.findFirst({
          where: {
            id: fence.taskId,
            taskType: "ACTOR_OPENING_V2",
            status: "RUNNING",
            leaseOwner: fence.leaseOwner,
            leaseVersion: fence.leaseVersion,
            leaseExpiresAt: { gt: new Date() },
            inputRefId: turn.id
          }
        });
        if (!leased) throw new AgentLeaseLostError();
      }
      await tx.actorTurn.update({
        where: { id: turn.id },
        data: {
          status: "OPEN",
          situationTitle: situationInput.stage.title,
          situationNarrative: openingNarrative,
          visibleFactKeysJson: visibleFacts.map((fact) => fact.factKey),
          contextJson: {
            contextSnapshotId: persistedContext.recordId,
            contextSnapshotHash: snapshot.identity.snapshotHash,
            provider,
            modelName,
            generationStatus: "READY",
            fakeStoryPublished: false
          } as Prisma.InputJsonValue,
          qualityStatus: "PASS"
        }
      });
      const decisionSet = await tx.decisionSet.create({
        data: {
          runId: turn.runId,
          turnId: turn.id,
          roleId: turn.roleId,
          contextHash: pipeline.finalStoryTextHash,
          framing: pipeline.plan.nextPressure,
          candidatesJson: draft.decisions as unknown as Prisma.InputJsonValue,
          qualityStatus: "PASS",
          qualityJson: decisionReview as unknown as Prisma.InputJsonValue
        }
      });
      await tx.narrativeEntry.create({
        data: {
          runId: turn.runId,
          nodeId: turn.run.currentNodeId,
          roleId: turn.roleId,
          entryType: "V2_OPENING",
          visibility: "role_private",
          content: openingNarrative,
          factKeysJson: visibleFacts.map((fact) => fact.factKey),
          threadKeysJson: [turn.threadId],
          sourceEventIdsJson: [],
          worldSequence: turn.run.worldSequence,
          dedupeKey: `v2-opening:${turn.id}`
        }
      });
      await this.writeReview(tx, turn.runId, turn.roleId, turn.id, "SITUATION", turn.id, openingNarrative, storyReview, provider, modelName);
      await this.writeReview(tx, turn.runId, turn.roleId, turn.id, "DECISION_SET", decisionSet.id, draft.decisions, decisionReview, provider, modelName);
      // The synchronous Solo human opening owns a RUNNING row reserved in
      // the start transaction. A non-Solo human may still own a PENDING row.
      // Worker-owned openings keep their RUNNING lease until the outer outbox
      // processor records ACTOR_OPENING_READY.
      if (!fence) {
        await tx.storyTaskOutbox.updateMany({
          where: {
            runId: turn.runId,
            inputRefId: turn.id,
            taskType: "ACTOR_OPENING_V2",
            OR: [
              { status: "PENDING" },
              { status: "RUNNING", leaseOwner: `solo-start:${turn.id}` }
            ]
          },
          data: { status: "COMPLETED", outcome: "ACTOR_OPENING_READY", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: null }
        });
      }
      if (latestControl?.mode === "AI_ACTIVE") {
        await tx.storyTaskOutbox.create({
          data: {
            runId: turn.runId,
            nodeId: turn.run.currentNodeId!,
            roleId: turn.roleId,
            inputRefId: turn.id,
            actionSlot: "ACTOR_TURN",
            controlEpoch: latestControl.epoch,
            taskType: "ACTOR_AGENT_TURN_V2",
            status: "PENDING",
            dedupeKey: `ACTOR_AGENT_TURN_V2:${turn.id}`,
            maxAttempts: 3
          }
        });
      }
      return { turnId: turn.id, decisionSetId: decisionSet.id };
    });
  }

  async executeAgentTask(taskId: string, fence: { taskId: string; leaseOwner: string; leaseVersion: number }) {
    try {
      const claimedTask = await this.prisma.storyTaskOutbox.findFirst({
        where: {
          id: taskId,
          taskType: "ACTOR_AGENT_TURN_V2",
          status: "RUNNING",
          leaseOwner: fence.leaseOwner,
          leaseVersion: fence.leaseVersion,
          leaseExpiresAt: { gt: new Date() }
        },
        select: { runId: true }
      });
      if (!claimedTask) throw new AgentLeaseLostError();
      const claimedRun = await this.prisma.storyRun.findUnique({
        where: { id: claimedTask.runId },
        select: { id: true, maxPlayers: true, stateJson: true }
      });
      if (claimedRun && isSoloNpcRun(claimedRun)) {
        return { outcome: "NO_OP", reason: "SOLO_NPC_NARRATIVE" };
      }
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const context = await this.loadAgentContext(taskId, fence);
        const candidates = asDecisionCandidates(context.decisionSet?.candidatesJson);
        if (!candidates.length) throw new ConflictException({ code: "AGENT_DECISION_NOT_AVAILABLE", message: "Agent has no legal decision" });
        const agentContext = await this.storyContexts.compileForResolution({
          run: context.run,
          role: context.role,
          turn: context.turn,
          controlEpoch: context.control.epoch,
          situation: context.situationInput,
          purpose: "AGENT_DECISION"
        });
        if (!agentContext.compilation.ok) {
          throw new ServiceUnavailableException({
            code: "AGENT_DECISION_CONTEXT_REJECTED",
            message: "Agent 无法获得完整的角色可见剧情上下文，系统没有使用轮次索引代替判断。",
            recoverable: true,
            contextRecordId: agentContext.recordId,
            issueCodes: agentContext.compilation.report.issueCodes
          });
        }
        let agentChoice;
        try {
          const snapshot = agentContext.compilation.snapshot;
          agentChoice = await this.narrator.decideAgent({
            context: snapshot,
            contextRecordId: agentContext.recordId,
            finalStory: context.turn.situationNarrative,
            candidates,
            getCurrentIdentity: async () => {
              const [latestTurn, latestRun, latestControl] = await Promise.all([
                this.prisma.actorTurn.findUnique({ where: { id: context.turn.id } }),
                this.prisma.storyRun.findUnique({ where: { id: context.run.id } }),
                this.prisma.roleControl.findUnique({ where: { runId_roleId: { runId: context.run.id, roleId: context.role.id } } })
              ]);
              if (!latestTurn || !latestRun || !latestControl) return { ...snapshot.identity, actorTurnId: "missing" };
              return {
                ...snapshot.identity,
                actorTurnId: latestTurn.id,
                worldSequence: latestRun.worldSequence,
                turnRevision: latestTurn.revision,
                controlEpoch: latestControl.epoch
              };
            }
          });
        } catch (error) {
          if (error instanceof StoryGenerationErrorV2 && error.code === "CONTEXT_SUPERSEDED" && attempt < 3) continue;
          throw error;
        }
        const candidate = candidates.find((item) => item.id === agentChoice.candidateId);
        if (!candidate) throw new ConflictException({ code: "AGENT_DECISION_INVALID", message: "Agent selected a decision outside the reviewed set" });
        const command: TurnDecisionCommandV2 = {
          idempotencyKey: `agent-v2:${taskId}`,
          turnRevision: context.turn.revision,
          controlEpoch: context.control.epoch,
          candidateId: candidate.id,
          intent: this.intentForCandidate(context as any, candidate)
        };
        const action = this.resolveAction(context as any, command);
        const stageProgress = evaluateStageProgress(action, context.situationInput.stage, context.stageTurnOrdinal, context.run.totalDays);
        try {
          const reservation = await this.reserveResolution({
            context: context as any,
            command,
            requestHash: sha256Canonical({ taskId, turnId: context.turn.id, command }),
            action,
            stageProgress,
            actorKind: "AI",
            agentFence: fence
          });
          const resolution = await this.executeReservedResultInline(reservation.taskId) as any;
          return { outcome: "ACTOR_TURN_RESOLVED", resolutionId: resolution.id, appliedWorldSequence: resolution.appliedWorldSequence };
        } catch (error) {
          if (error instanceof DecisionContextMovedError && attempt < 3) continue;
          throw error;
        }
      }
      throw new ConflictException({ code: "DECISION_CONTEXT_CHANGED", message: "Agent context changed repeatedly" });
    } catch (error) {
      if (error instanceof AgentLeaseLostError) return { outcome: "LEASE_LOST" };
      const code = exceptionResponseCode(error);
      if (code === "AGENT_TURN_MOVED") return { outcome: "TURN_ALREADY_MOVED" };
      if (code === "ROLE_CONTROL_CHANGED") return { outcome: "AGENT_CONTROL_ENDED" };
      throw error;
    }
  }

  async executeConditionalTask(taskId: string, fence: { taskId: string; leaseOwner: string; leaseVersion: number }) {
    try {
      const task = await this.prisma.storyTaskOutbox.findFirst({
        where: {
          id: taskId,
          taskType: "CONDITIONAL_ACTION_V2",
          status: "RUNNING",
          leaseOwner: fence.leaseOwner,
          leaseVersion: fence.leaseVersion,
          leaseExpiresAt: { gt: new Date() }
        }
      });
      if (!task?.inputRefId || !task.checkpointKey) throw new AgentLeaseLostError();
      return await this.applyTriggeredCondition(task.inputRefId, task.checkpointKey, fence);
    } catch (error) {
      if (error instanceof AgentLeaseLostError) return { outcome: "LEASE_LOST" };
      throw error;
    }
  }

  async executeImpactTask(taskId: string, fence: { taskId: string; leaseOwner: string; leaseVersion: number }) {
    try {
      const task = await this.prisma.storyTaskOutbox.findFirst({
        where: {
          id: taskId,
          taskType: "ACTOR_IMPACT_V2",
          status: "RUNNING",
          leaseOwner: fence.leaseOwner,
          leaseVersion: fence.leaseVersion,
          leaseExpiresAt: { gt: new Date() }
        }
      });
      if (!task?.roleId || !task.resultJson) throw new AgentLeaseLostError();
      const impactRun = await this.prisma.storyRun.findUnique({
        where: { id: task.runId },
        select: { id: true, maxPlayers: true, stateJson: true }
      });
      if (impactRun && isSoloNpcRun(impactRun)) {
        return { outcome: "NO_OP", reason: "SOLO_NPC_NARRATIVE" };
      }
      const payload = impactTaskPayload(task.resultJson);
      if (payload.targetRoleId !== task.roleId || payload.playerActionId !== task.inputRefId) {
        throw new ConflictException({ code: "IMPACT_TASK_INVALID", message: "Impact task payload does not match its durable identity" });
      }
      const [turn, control, sourceResolution, allRoles, facts] = await Promise.all([
        this.prisma.actorTurn.findFirst({
          where: { runId: task.runId, roleId: payload.targetRoleId, status: "OPEN", turnIndex: { gt: 0 } },
          include: { decisionSet: true, role: true, run: true },
          orderBy: { turnIndex: "desc" }
        }),
        this.prisma.roleControl.findUnique({ where: { runId_roleId: { runId: task.runId, roleId: payload.targetRoleId } } }),
        this.prisma.actionResolution.findUnique({ where: { playerActionId: payload.playerActionId } }),
        this.prisma.storyRole.findMany({ where: { runId: task.runId }, orderBy: { createdAt: "asc" } }),
        this.prisma.canonFact.findMany({ where: { runId: task.runId, status: "confirmed" }, orderBy: { createdAt: "asc" } })
      ]);
      if (!turn?.decisionSet || !control) {
        const thread = await this.prisma.actorThread.findUnique({ where: { roleId: payload.targetRoleId } });
        if (thread?.status === "COMPLETED") return { outcome: "TARGET_STORY_COMPLETED", targetRoleId: payload.targetRoleId };
        throw new ConflictException({ code: "IMPACT_TARGET_TURN_NOT_OPEN", message: "Target role is between story beats; retry the impact independently" });
      }
      const ownConditionalResult = payload.sourceRoleId === payload.targetRoleId && sourceResolution?.qualityStatus === "GENERATING";
      const impactSeed = payload.mode === "TRACE"
        ? payload.action.observableTraceText || payload.action.receiptText
        : payload.action.receiptText;
      const visibleSourceName = payload.mode === "TRACE" ? "来源不明的行动痕迹" : payload.sourceRoleName;
      const visibleFacts = visibleFactsForRole(facts, turn.roleId);
      const situationInput = this.situationInput(
        turn.run,
        turn.role,
        turn.stageIndex,
        turn.turnIndex,
        turn.run.worldSequence,
        visibleFacts,
        [{ sourceRoleName: visibleSourceName, content: impactSeed }]
      );
      const persistedContext = await this.storyContexts.compileForResolution({
        run: turn.run,
        role: turn.role,
        turn,
        controlEpoch: control.epoch,
        situation: situationInput,
        purpose: ownConditionalResult ? "RESULT" : "IMPACT",
        action: ownConditionalResult ? payload.action : undefined,
        confirmedResolution: ownConditionalResult ? payload.action.receiptText : undefined
      });
      if (!persistedContext.compilation.ok) {
        throw new ServiceUnavailableException({
          code: "IMPACT_CONTEXT_REJECTED",
          message: "他人行动影响的关键上下文尚未完整，系统没有发布拼接剧情。",
          recoverable: true,
          contextRecordId: persistedContext.recordId,
          issueCodes: persistedContext.compilation.report.issueCodes
        });
      }
      const snapshot = persistedContext.compilation.snapshot;
      const pipeline = await this.narrator.resolveContext({
        context: snapshot,
        contextRecordId: persistedContext.recordId,
        actionResolutionId: sourceResolution?.id || null,
        generateDecisions: true,
        getCurrentIdentity: async () => {
          const [latestTurn, latestRun, latestControl] = await Promise.all([
            this.prisma.actorTurn.findUnique({ where: { id: turn.id } }),
            this.prisma.storyRun.findUnique({ where: { id: turn.runId } }),
            this.prisma.roleControl.findUnique({ where: { runId_roleId: { runId: turn.runId, roleId: turn.roleId } } })
          ]);
          if (!latestTurn || !latestRun || !latestControl) return { ...snapshot.identity, actorTurnId: "missing" };
          return {
            ...snapshot.identity,
            actorTurnId: latestTurn.id,
            worldSequence: latestRun.worldSequence,
            turnRevision: latestTurn.revision,
            controlEpoch: latestControl.epoch
          };
        }
      });
      const nextSituation = bindDecisionTargets({
        situationTitle: situationInput.stage.title,
        situationNarrative: pipeline.narrative.nextSituationNarrative,
        framing: pipeline.plan.nextPressure,
        decisions: pipeline.decisions
      }, allRoles, situationInput.roleStage);
      const impactReview = reviewStory(
        pipeline.narrative.resultNarrative,
        situationInput,
        ownConditionalResult ? "RESULT" : "SITUATION",
        ownConditionalResult ? payload.action : undefined
      );
      const nextStoryReview = reviewStory(nextSituation.situationNarrative, situationInput, "SITUATION");
      const decisionReview = reviewDecisionSet(nextSituation.decisions, situationInput);
      assertQuality(impactReview, "IMPACT_STORY_QUALITY_FAILED");
      assertQuality(nextStoryReview, "IMPACT_NEXT_STORY_QUALITY_FAILED");
      assertQuality(decisionReview, "IMPACT_DECISION_QUALITY_FAILED");
      const writerExecution = pipeline.promptExecutions.find((record) => record.pipelineStep === "WRITER");
      const provider = writerExecution?.provider || "unknown";
      const modelName = writerExecution?.modelName || "unknown";

      return this.serializable(async (tx) => {
        const [leasedTask, latestTurn, latestRun, latestControl] = await Promise.all([
          tx.storyTaskOutbox.findFirst({
            where: {
              id: task.id,
              taskType: "ACTOR_IMPACT_V2",
              status: "RUNNING",
              leaseOwner: fence.leaseOwner,
              leaseVersion: fence.leaseVersion,
              leaseExpiresAt: { gt: new Date() }
            }
          }),
          tx.actorTurn.findUnique({ where: { id: turn.id }, include: { decisionSet: true } }),
          tx.storyRun.findUnique({ where: { id: turn.runId } }),
          tx.roleControl.findUnique({ where: { runId_roleId: { runId: turn.runId, roleId: turn.roleId } } })
        ]);
        if (!leasedTask) throw new AgentLeaseLostError();
        if (!latestTurn?.decisionSet || latestTurn.status !== "OPEN"
          || latestTurn.revision !== snapshot.identity.turnRevision
          || latestRun?.worldSequence !== snapshot.identity.worldSequence
          || latestControl?.epoch !== snapshot.identity.controlEpoch) {
          throw new DecisionContextMovedError();
        }
        const entry = await tx.narrativeEntry.create({
          data: {
            runId: turn.runId,
            nodeId: task.nodeId,
            roleId: turn.roleId,
            entryType: ownConditionalResult ? "V2_RESULT" : payload.mode === "TRACE" ? "V2_OBSERVABLE_TRACE" : "V2_CROSS_IMPACT",
            visibility: "role_private",
            content: pipeline.narrative.resultNarrative,
            factKeysJson: payload.action.effectFactKeys,
            threadKeysJson: [turn.threadId],
            sourceEventIdsJson: [],
            worldSequence: payload.appliedWorldSequence,
            dedupeKey: ownConditionalResult
              ? `v2-condition-result:${sourceResolution!.id}`
              : `v2-impact:${payload.playerActionId}:${turn.roleId}`
          }
        });
        const updatedTurn = await tx.actorTurn.update({
          where: { id: turn.id },
          data: {
            baseWorldSequence: snapshot.identity.worldSequence,
            revision: { increment: 1 },
            situationTitle: nextSituation.situationTitle,
            situationNarrative: nextSituation.situationNarrative,
            visibleFactKeysJson: visibleFacts.map((fact) => fact.factKey),
            contextJson: {
              provider,
              modelName,
              impactEntryId: entry.id,
              sourceResolutionId: sourceResolution?.id || null,
              contextSnapshotId: persistedContext.recordId
            } as Prisma.InputJsonValue,
            qualityStatus: "PASS"
          }
        });
        const decisionSet = await tx.decisionSet.update({
          where: { id: latestTurn.decisionSet.id },
          data: {
            contextHash: sha256Canonical({ narrative: nextSituation.situationNarrative, contextSnapshotHash: snapshot.identity.snapshotHash }),
            framing: nextSituation.framing,
            candidatesJson: nextSituation.decisions as unknown as Prisma.InputJsonValue,
            qualityStatus: "PASS",
            qualityJson: decisionReview as unknown as Prisma.InputJsonValue,
            revision: { increment: 1 }
          }
        });
        if (ownConditionalResult && sourceResolution) {
          await tx.actionResolution.update({
            where: { id: sourceResolution.id },
            data: {
              resultNarrative: pipeline.narrative.resultNarrative,
              nextHook: pipeline.plan.nextPressure,
              qualityStatus: "PASS"
            }
          });
        }
        await this.writeReview(tx, turn.runId, turn.roleId, turn.id, ownConditionalResult ? "RESULT" : "CROSS_IMPACT", ownConditionalResult ? sourceResolution!.id : entry.id, pipeline.narrative.resultNarrative, impactReview, provider, modelName);
        await this.writeReview(tx, turn.runId, turn.roleId, turn.id, "SITUATION", updatedTurn.id, nextSituation.situationNarrative, nextStoryReview, provider, modelName);
        await this.writeReview(tx, turn.runId, turn.roleId, turn.id, "DECISION_SET", decisionSet.id, nextSituation.decisions, decisionReview, provider, modelName);
        await tx.storyRun.update({ where: { id: turn.runId }, data: { version: { increment: 1 } } });
        const targetPlayer = await tx.storyPlayer.findFirst({ where: { runId: turn.runId, roleId: turn.roleId, playerType: "human", status: "active" } });
        if (targetPlayer?.userId) {
          await this.deliveries.publish(tx, {
            runId: turn.runId,
            nodeId: task.nodeId,
            day: turn.stageIndex,
            type: ownConditionalResult ? "ACTOR_CONDITIONAL_RESOLVED_V2" : "CROSS_ROLE_IMPACT_V2",
            visibility: payload.action.visibility,
            audienceType: "ROLE",
            audienceUserIds: [targetPlayer.userId],
            audienceRoleIds: [turn.roleId],
            sourceActionId: payload.playerActionId,
            payload: ownConditionalResult
              ? { roleName: payload.targetRoleName, content: pipeline.narrative.resultNarrative, appliedWorldSequence: payload.appliedWorldSequence, nextTurnId: turn.id }
              : payload.mode === "TRACE"
              ? { targetRoleName: payload.targetRoleName, content: pipeline.narrative.resultNarrative, appliedWorldSequence: payload.appliedWorldSequence, sourceUnknown: true }
              : { sourceRoleName: payload.sourceRoleName, targetRoleName: payload.targetRoleName, content: pipeline.narrative.resultNarrative, appliedWorldSequence: payload.appliedWorldSequence },
            dedupeKey: `${ownConditionalResult ? "ACTOR_CONDITIONAL_RESOLVED_V2" : "CROSS_ROLE_IMPACT_V2"}:${payload.playerActionId}:${turn.roleId}`
          });
        }
        return { outcome: "ACTOR_IMPACT_PUBLISHED", targetTurnId: turn.id, impactEntryId: entry.id };
      });
    } catch (error) {
      if (error instanceof AgentLeaseLostError) return { outcome: "LEASE_LOST" };
      if (error instanceof DecisionContextMovedError || (error instanceof StoryGenerationErrorV2 && error.code === "CONTEXT_SUPERSEDED")) {
        throw new ConflictException({ code: "IMPACT_CONTEXT_MOVED", message: "Target role advanced while the impact was being written; retry from its latest story" });
      }
      throw error;
    }
  }

  async executeResultTask(taskId: string, fence: { taskId: string; leaseOwner: string; leaseVersion: number }) {
    try {
      const task = await this.prisma.storyTaskOutbox.findFirst({
        where: {
          id: taskId,
          taskType: "ACTOR_RESULT_V2",
          status: "RUNNING",
          leaseOwner: fence.leaseOwner,
          leaseVersion: fence.leaseVersion,
          leaseExpiresAt: { gt: new Date() }
        }
      });
      if (!task?.inputRefId || !task.resultJson) throw new AgentLeaseLostError();
      const payload = resultTaskPayload(task.resultJson);
      const resolution = await this.prisma.actionResolution.findUnique({
        where: { id: task.inputRefId },
        include: {
          run: true,
          role: true,
          submission: true,
          playerAction: true,
          turn: { include: { decisionSet: true, thread: true } }
        }
      });
      if (!resolution || resolution.runId !== task.runId || resolution.roleId !== task.roleId) {
        throw new ConflictException({ code: "RESULT_TASK_INVALID", message: "Result task does not match its action resolution" });
      }
      if (resolution.qualityStatus === "PASS") {
        return { outcome: "ACTOR_RESULT_ALREADY_PUBLISHED", resolutionId: resolution.id, appliedWorldSequence: resolution.appliedWorldSequence };
      }
      if (resolution.qualityStatus !== "GENERATING" || resolution.turn.status !== "RESOLVING") {
        throw new ConflictException({ code: "RESULT_RESERVATION_MOVED", message: "Reserved action result is no longer generatable" });
      }
      if (resolution.appliedWorldSequence !== resolution.run.worldSequence + 1) {
        throw new ServiceUnavailableException({
          code: "RESULT_SEQUENCE_WAIT",
          message: "An earlier independent actor result must publish before this reserved result can be generated",
          recoverable: true
        });
      }
      if (resolution.baseWorldSequence !== resolution.run.worldSequence) {
        await this.prisma.actionResolution.update({
          where: { id: resolution.id },
          data: {
            baseWorldSequence: resolution.run.worldSequence,
            statePatchJson: {
              ...jsonRecord(resolution.statePatchJson),
              baseWorldSequence: resolution.run.worldSequence,
              nextWorldSequence: resolution.appliedWorldSequence
            } as Prisma.InputJsonValue
          }
        });
        resolution.baseWorldSequence = resolution.run.worldSequence;
      }
      const [control, facts, impacts, allRoles, stageTurnOrdinal, assets] = await Promise.all([
        this.prisma.roleControl.findUnique({ where: { runId_roleId: { runId: resolution.runId, roleId: resolution.roleId } } }),
        this.prisma.canonFact.findMany({ where: { runId: resolution.runId, status: "confirmed" }, orderBy: { createdAt: "asc" } }),
        this.prisma.narrativeEntry.findMany({
          where: {
            runId: resolution.runId,
            roleId: resolution.roleId,
            entryType: { in: ["V2_CROSS_IMPACT", "V2_OBSERVABLE_TRACE"] },
            worldSequence: { lte: resolution.appliedWorldSequence }
          },
          orderBy: { createdAt: "desc" },
          take: 4
        }),
        this.prisma.storyRole.findMany({ where: { runId: resolution.runId }, orderBy: { createdAt: "asc" } }),
        this.prisma.actorTurn.count({
          where: { runId: resolution.runId, roleId: resolution.roleId, stageIndex: resolution.turn.stageIndex, turnIndex: { gt: 0 } }
        }),
        this.prisma.roleAsset.findMany({ where: { runId: resolution.runId }, orderBy: { assetKey: "asc" } })
      ]);
      if (!control) throw new ConflictException({ code: "ROLE_CONTROL_NOT_READY", message: "Role control is missing for reserved result" });
      const visibleFacts = visibleFactsForRole(facts, resolution.roleId);
      const incomingImpacts = impacts.reverse().map((entry) => ({ sourceRoleName: "另一位角色", content: entry.content }));
      const generationRun = { ...resolution.run, worldSequence: resolution.appliedWorldSequence };
      const situationInput = this.situationInput(
        generationRun,
        resolution.role,
        resolution.turn.stageIndex,
        resolution.turn.turnIndex,
        resolution.appliedWorldSequence,
        visibleFacts,
        incomingImpacts
      );
      const context = {
        run: generationRun,
        turn: resolution.turn,
        role: resolution.role,
        control: { ...control, epoch: payload.controlEpoch },
        decisionSet: resolution.turn.decisionSet,
        visibleFacts,
        incomingImpacts,
        situationInput,
        stageTurnOrdinal,
        allRoles,
        assets,
        allFacts: facts.map((fact) => ({ factKey: fact.factKey, content: fact.content, visibility: fact.visibility, knownByRoleIds: stringList(fact.knownByRoleIdsJson) })),
        membership: { userId: resolution.submission.userId },
        observedWorldSequence: resolution.baseWorldSequence
      } as Awaited<ReturnType<ContinuousStoryV2Service["loadSubmissionContext"]>>;
      const nextInput = payload.stageProgress.nextStageIndex
        ? this.situationInput(
            generationRun,
            resolution.role,
            payload.stageProgress.nextStageIndex,
            resolution.turn.turnIndex + 1,
            resolution.appliedWorldSequence,
            visibleFacts,
            incomingImpacts,
            payload.action,
            payload.action.receiptText
          )
        : null;
      const generated = await this.generateRealNarrative(context, payload.action, nextInput, resolution.id);
      const finalized = await this.finalizeReservedResolution({
        context,
        action: payload.action,
        stageProgress: payload.stageProgress,
        draft: generated.draft,
        resultReview: generated.resultReview,
        nextInput,
        nextStoryReview: generated.nextStoryReview,
        nextDecisionReview: generated.nextDecisionReview,
        contextRecordId: generated.contextRecordId,
        actorKind: payload.actorKind,
        controlEpoch: payload.controlEpoch,
        resolutionId: resolution.id,
        resultFence: fence
      });
      return { outcome: "ACTOR_RESULT_PUBLISHED", ...finalized };
    } catch (error) {
      if (error instanceof AgentLeaseLostError) return { outcome: "LEASE_LOST" };
      throw error;
    }
  }

  async failReservedResultTask(taskId: string, failureCode: string) {
    return this.serializable(async (tx) => {
      const task = await tx.storyTaskOutbox.findUnique({ where: { id: taskId } });
      if (!task?.inputRefId || task.taskType !== "ACTOR_RESULT_V2") return { released: false, reason: "TASK_NOT_APPLICABLE" };
      const resolution = await tx.actionResolution.findUnique({
        where: { id: task.inputRefId },
        include: { run: true, playerAction: true, submission: true, turn: { include: { decisionSet: true } } }
      });
      if (!resolution || resolution.qualityStatus === "PASS") return { released: false, reason: "RESULT_ALREADY_PUBLISHED" };
      if (resolution.qualityStatus === "FAIL") {
        await tx.storyTaskOutbox.updateMany({
          where: { id: task.id, status: "FAILED", outcome: null },
          data: { outcome: "NO_OP", completedAt: new Date() }
        });
        return { released: true, reason: "ALREADY_RELEASED" };
      }

      const failedSequence = resolution.appliedWorldSequence;
      const later = await tx.actionResolution.findMany({
        where: { runId: resolution.runId, qualityStatus: "GENERATING", appliedWorldSequence: { gt: failedSequence } },
        orderBy: { appliedWorldSequence: "asc" }
      });
      const currentMinimum = await tx.actionResolution.findFirst({
        where: { runId: resolution.runId },
        orderBy: { appliedWorldSequence: "asc" },
        select: { appliedWorldSequence: true }
      });
      let parkingSequence = nextResolutionParkingSequence(currentMinimum?.appliedWorldSequence, failedSequence);
      await tx.actionResolution.update({
        where: { id: resolution.id },
        data: {
          appliedWorldSequence: parkingSequence,
          qualityStatus: "FAIL",
          statePatchJson: { ...jsonRecord(resolution.statePatchJson), failedBeforePublish: true, failureCode } as Prisma.InputJsonValue
        }
      });
      for (const pending of later) {
        parkingSequence -= 1;
        await tx.actionResolution.update({ where: { id: pending.id }, data: { appliedWorldSequence: parkingSequence } });
      }
      for (const pending of later) {
        const nextSequence = pending.appliedWorldSequence - 1;
        await tx.actionResolution.update({
          where: { id: pending.id },
          data: {
            appliedWorldSequence: nextSequence,
            statePatchJson: { ...jsonRecord(pending.statePatchJson), nextWorldSequence: nextSequence } as Prisma.InputJsonValue
          }
        });
      }
      await tx.playerAction.update({
        where: { id: resolution.playerActionId },
        data: { status: "failed", auditStatus: "generation_failed", resolvedJson: { storyGenerationStatus: "FAIL", failureCode } as Prisma.InputJsonValue, resolvedAt: new Date() }
      });
      await tx.decisionSubmission.update({ where: { id: resolution.submissionId }, data: { status: "FAILED", resolvedAt: new Date() } });
      await tx.actorTurn.update({ where: { id: resolution.turnId }, data: { status: "FAILED", qualityStatus: "FAIL", resolvedAt: new Date() } });

      const replacementRevision = resolution.turn.revision + 1;
      const replacementKey = `actor-turn-retry:${resolution.turn.id}:${replacementRevision}`;
      let replacement = await tx.actorTurn.findUnique({ where: { dedupeKey: replacementKey } });
      if (!replacement) {
        replacement = await tx.actorTurn.create({
          data: {
            runId: resolution.runId,
            threadId: resolution.turn.threadId,
            roleId: resolution.turn.roleId,
            stageIndex: resolution.turn.stageIndex,
            turnIndex: resolution.turn.turnIndex,
            status: "OPEN",
            baseWorldSequence: resolution.run.worldSequence,
            revision: replacementRevision,
            situationTitle: resolution.turn.situationTitle,
            situationNarrative: resolution.turn.situationNarrative,
            visibleFactKeysJson: resolution.turn.visibleFactKeysJson as Prisma.InputJsonValue,
            activeThreadKeysJson: resolution.turn.activeThreadKeysJson as Prisma.InputJsonValue,
            contextJson: { ...jsonRecord(resolution.turn.contextJson), retryOfTurnId: resolution.turn.id, failureCode } as Prisma.InputJsonValue,
            qualityStatus: "PASS",
            dedupeKey: replacementKey
          }
        });
        if (resolution.turn.decisionSet) {
          await tx.decisionSet.create({
            data: {
              runId: resolution.runId,
              turnId: replacement.id,
              roleId: resolution.turn.roleId,
              contextHash: resolution.turn.decisionSet.contextHash,
              framing: resolution.turn.decisionSet.framing,
              candidatesJson: resolution.turn.decisionSet.candidatesJson as Prisma.InputJsonValue,
              qualityStatus: resolution.turn.decisionSet.qualityStatus,
              qualityJson: resolution.turn.decisionSet.qualityJson as Prisma.InputJsonValue,
              revision: resolution.turn.decisionSet.revision + 1
            }
          });
        }
      }
      const nextReserved = Math.max(resolution.run.worldSequence, Number((resolution.run as any).reservedWorldSequence || resolution.run.worldSequence) - 1);
      await (tx.storyRun as any).update({ where: { id: resolution.runId }, data: { status: "playing", reservedWorldSequence: nextReserved, version: { increment: 1 } } });
      const charge = await (tx as any).creditCharge.findUnique({ where: { playerActionId: resolution.playerActionId } });
      if (charge?.status === "RESERVED") await this.creditConsumption.releaseCharge(charge.id, failureCode, tx);

      const control = await tx.roleControl.findUnique({ where: { runId_roleId: { runId: resolution.runId, roleId: resolution.roleId } } });
      if (control?.mode === "AI_ACTIVE") {
        await tx.storyTaskOutbox.create({
          data: {
            runId: resolution.runId,
            nodeId: task.nodeId,
            roleId: resolution.roleId,
            inputRefId: replacement.id,
            actionSlot: "ACTOR_TURN",
            controlEpoch: control.epoch,
            taskType: "ACTOR_AGENT_TURN_V2",
            status: "PENDING",
            dedupeKey: `ACTOR_AGENT_TURN_V2:${replacement.id}`,
            maxAttempts: 3
          }
        });
      }
      await tx.storyTaskOutbox.updateMany({
        where: { id: task.id, status: "FAILED", outcome: null },
        data: { outcome: "NO_OP", completedAt: new Date() }
      });
      return { released: true, replacementTurnId: replacement.id };
    });
  }

  private async executeReservedResultInline(taskId: string) {
    const leaseOwner = `inline-result-${process.pid}-${Date.now().toString(36)}`;
    const leaseMs = 90_000;
    const claimed = await this.prisma.storyTaskOutbox.updateMany({
      where: { id: taskId, taskType: "ACTOR_RESULT_V2", status: "PENDING", nextRetryAt: { lte: new Date() } },
      data: {
        status: "RUNNING",
        leaseOwner,
        leaseExpiresAt: new Date(Date.now() + leaseMs),
        startedAt: new Date(),
        attempt: { increment: 1 },
        leaseVersion: { increment: 1 }
      }
    });
    if (claimed.count !== 1) {
      throw new ServiceUnavailableException({
        code: "STORY_GENERATION_IN_PROGRESS",
        message: "行动后果已经确认，真实结果剧情正在由独立任务生成；系统没有发布模板故事。",
        recoverable: true
      });
    }
    const task = await this.prisma.storyTaskOutbox.findUniqueOrThrow({ where: { id: taskId } });
    const fence = { taskId, leaseOwner, leaseVersion: task.leaseVersion };
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      void this.prisma.storyTaskOutbox.updateMany({
        where: {
          id: taskId,
          taskType: "ACTOR_RESULT_V2",
          status: "RUNNING",
          leaseOwner,
          leaseVersion: task.leaseVersion,
          leaseExpiresAt: { gt: new Date() }
        },
        data: { leaseExpiresAt: new Date(Date.now() + leaseMs) }
      }).then((renewed) => { if (renewed.count !== 1) leaseLost = true; }).catch(() => { leaseLost = true; });
    }, 20_000);
    heartbeat.unref?.();
    try {
      const result = await this.executeResultTask(taskId, fence);
      if (leaseLost || result.outcome === "LEASE_LOST") throw new AgentLeaseLostError();
      const completed = await this.prisma.storyTaskOutbox.updateMany({
        where: {
          id: taskId,
          status: "RUNNING",
          leaseOwner,
          leaseVersion: task.leaseVersion,
          leaseExpiresAt: { gt: new Date() }
        },
        data: {
          status: "COMPLETED",
          outcome: result.outcome,
          completedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          resultJson: result as unknown as Prisma.InputJsonValue,
          lastError: null
        }
      });
      if (completed.count !== 1) throw new AgentLeaseLostError();
      return result;
    } catch (error) {
      if (!leaseLost) {
        const permanent = isPermanentStoryGenerationFailure(error);
        const recorded = await this.prisma.storyTaskOutbox.updateMany({
          where: { id: taskId, status: "RUNNING", leaseOwner, leaseVersion: task.leaseVersion },
          data: permanent
            ? { status: "FAILED", leaseOwner: null, leaseExpiresAt: null, lastError: error instanceof Error ? error.message : String(error) }
            : { status: "PENDING", leaseOwner: null, leaseExpiresAt: null, nextRetryAt: new Date(Date.now() + 500), lastError: error instanceof Error ? error.message : String(error) }
        });
        if (permanent && recorded.count === 1) await this.failReservedResultTask(taskId, "QUALITY_REJECTED");
      }
      if (error instanceof AgentLeaseLostError) {
        throw new ServiceUnavailableException({
          code: "STORY_GENERATION_IN_PROGRESS",
          message: "行动后果已经确认，结果剧情任务正在由另一执行器继续处理。",
          recoverable: true
        });
      }
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async loadAgentContext(taskId: string, fence: { taskId: string; leaseOwner: string; leaseVersion: number }) {
    const task = await this.prisma.storyTaskOutbox.findFirst({
      where: { id: taskId, taskType: "ACTOR_AGENT_TURN_V2", status: "RUNNING", leaseOwner: fence.leaseOwner, leaseVersion: fence.leaseVersion, leaseExpiresAt: { gt: new Date() } }
    });
    if (!task?.inputRefId || !task.roleId) throw new AgentLeaseLostError();
    const turn = await this.prisma.actorTurn.findUnique({ where: { id: task.inputRefId }, include: { decisionSet: true, thread: true, role: true, run: true } });
    if (!turn || turn.runId !== task.runId || turn.roleId !== task.roleId || turn.status !== "OPEN") throw new ConflictException({ code: "AGENT_TURN_MOVED", message: "Agent turn is no longer open" });
    const [control, facts, impacts, allRoles, stageTurnOrdinal, assets] = await Promise.all([
      this.prisma.roleControl.findUnique({ where: { runId_roleId: { runId: task.runId, roleId: task.roleId } } }),
      this.prisma.canonFact.findMany({ where: { runId: task.runId, status: "confirmed" }, orderBy: { createdAt: "asc" } }),
      this.prisma.narrativeEntry.findMany({ where: { runId: task.runId, roleId: task.roleId, entryType: { in: ["V2_CROSS_IMPACT", "V2_OBSERVABLE_TRACE"] } }, orderBy: { createdAt: "desc" }, take: 4 }),
      this.prisma.storyRole.findMany({ where: { runId: task.runId }, orderBy: { createdAt: "asc" } }),
      this.prisma.actorTurn.count({ where: { runId: task.runId, roleId: task.roleId, stageIndex: turn.stageIndex, turnIndex: { gt: 0 } } }),
      this.prisma.roleAsset.findMany({ where: { runId: task.runId }, orderBy: { assetKey: "asc" } })
    ]);
    if (!control || control.mode !== "AI_ACTIVE" || control.epoch !== task.controlEpoch) throw new ConflictException({ code: "ROLE_CONTROL_CHANGED", message: "Agent no longer controls this role" });
    const visibleFacts = visibleFactsForRole(facts, turn.roleId);
    const incomingImpacts = impacts.reverse().map((entry) => ({ sourceRoleName: "另一位角色", content: entry.content }));
    const situationInput = this.situationInput(turn.run, turn.role, turn.stageIndex, turn.turnIndex, turn.run.worldSequence, visibleFacts, incomingImpacts);
    return {
      run: turn.run, turn, role: turn.role, control, decisionSet: turn.decisionSet, visibleFacts, incomingImpacts,
      situationInput, stageTurnOrdinal, allRoles, assets,
      allFacts: facts.map((fact) => ({ factKey: fact.factKey, content: fact.content, visibility: fact.visibility, knownByRoleIds: stringList(fact.knownByRoleIdsJson) })),
      membership: { userId: null }, observedWorldSequence: turn.run.worldSequence
    };
  }

  private async controlContext(tx: Tx, user: AuthenticatedUser, roomId: string) {
    const run = await tx.storyRun.findUnique({
      where: { id: roomId },
      include: { players: { where: { status: "active" } }, roles: true, roleControls: true }
    });
    if (!run || run.mode !== "room") throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    this.requireV2(run.engineVersion);
    const player = run.players.find((candidate) => candidate.userId === user.id);
    if (!player?.roleId) throw new ForbiddenException({ code: "ROOM_MEMBERSHIP_REQUIRED", message: "A claimed room role is required" });
    const role = run.roles.find((candidate) => candidate.id === player.roleId);
    const control = run.roleControls.find((candidate) => candidate.roleId === player.roleId);
    if (!role || !control) throw new ConflictException({ code: "ROLE_CONTROL_NOT_READY", message: "Role control is not ready" });
    const turn = await tx.actorTurn.findFirst({ where: { runId: roomId, roleId: role.id, status: { in: ["OPEN", "RESOLVING"] } }, orderBy: [{ turnIndex: "desc" }, { revision: "desc" }] });
    return { run, player, role, control, turn, memberUserIds: run.players.map((candidate) => candidate.userId).filter((id): id is string => Boolean(id)) };
  }

  private async publishControlChange(tx: Tx, context: Awaited<ReturnType<ContinuousStoryV2Service["controlContext"]>>, userId: string, idempotencyKey: string, controllerKind: "HUMAN" | "AI", epoch: number) {
    await this.deliveries.publish(tx, {
      runId: context.run.id, nodeId: context.run.currentNodeId || undefined, day: context.turn?.stageIndex || context.run.currentDay,
      type: "ROLE_CONTROL_CHANGED_V2", visibility: "PUBLIC", audienceType: "ALL_MEMBERS",
      audienceUserIds: context.memberUserIds, audienceRoleIds: [context.role.id],
      payload: { roleId: context.role.id, controllerKind, epoch, independentActorThread: true, initiatedByUserId: userId },
      dedupeKey: `ROLE_CONTROL_CHANGED_V2:${idempotencyKey}`
    });
  }

  private async loadSubmissionContext(user: AuthenticatedUser, roomId: string, turnId: string, command: TurnDecisionCommandV2) {
    const turn = await this.prisma.actorTurn.findUnique({ where: { id: turnId }, include: { decisionSet: true, thread: true, role: true, run: true } });
    if (!turn || turn.runId !== roomId) throw new NotFoundException({ code: "TURN_NOT_FOUND", message: "Actor turn not found" });
    this.requireV2(turn.run.engineVersion);
    if (turn.status !== "OPEN") throw new ConflictException({ code: "TURN_MOVED", message: "This situation has already moved" });
    const [membership, control, facts, impacts, allRoles, stageTurnOrdinal, assets] = await Promise.all([
      this.prisma.storyPlayer.findFirst({ where: { runId: roomId, userId: user.id, roleId: turn.roleId, status: "active" } }),
      this.prisma.roleControl.findUnique({ where: { runId_roleId: { runId: roomId, roleId: turn.roleId } } }),
      this.prisma.canonFact.findMany({ where: { runId: roomId, status: "confirmed" }, orderBy: { createdAt: "asc" } }),
      this.prisma.narrativeEntry.findMany({ where: { runId: roomId, roleId: turn.roleId, entryType: { in: ["V2_CROSS_IMPACT", "V2_OBSERVABLE_TRACE"] } }, orderBy: { createdAt: "desc" }, take: 4 }),
      this.prisma.storyRole.findMany({ where: { runId: roomId }, orderBy: { createdAt: "asc" } }),
      this.prisma.actorTurn.count({ where: { runId: roomId, roleId: turn.roleId, stageIndex: turn.stageIndex, turnIndex: { gt: 0 } } }),
      this.prisma.roleAsset.findMany({ where: { runId: roomId }, orderBy: { assetKey: "asc" } })
    ]);
    if (!membership) throw new ForbiddenException({ code: "ROLE_FORBIDDEN", message: "This turn belongs to another role" });
    if (!control || control.epoch !== command.controlEpoch) throw new ConflictException({ code: "ROLE_CONTROL_CHANGED", message: "Role control changed" });
    if (!["HUMAN_ACTIVE", "HUMAN_OFFLINE_GRACE"].includes(control.mode)) throw new ForbiddenException({ code: "ROLE_CONTROL_CHANGED", message: "This role is currently controlled by an Agent" });
    const visibleFacts = visibleFactsForRole(facts, turn.roleId);
    const incomingImpacts = impacts.reverse().map((entry) => ({ sourceRoleName: "另一位角色", content: entry.content }));
    const situationInput = this.situationInput(turn.run, turn.role, turn.stageIndex, turn.turnIndex, turn.run.worldSequence, visibleFacts, incomingImpacts);
    return {
      run: turn.run,
      turn,
      role: turn.role,
      control,
      decisionSet: turn.decisionSet,
      visibleFacts,
      incomingImpacts,
      situationInput,
      stageTurnOrdinal,
      allRoles,
      assets,
      allFacts: facts.map((fact) => ({ factKey: fact.factKey, content: fact.content, visibility: fact.visibility, knownByRoleIds: stringList(fact.knownByRoleIdsJson) })),
      membership,
      observedWorldSequence: turn.run.worldSequence
    };
  }

  private async generateRealNarrative(
    context: Awaited<ReturnType<ContinuousStoryV2Service["loadSubmissionContext"]>>,
    action: PlannedIntentAction,
    nextInput: StorySituationInput | null,
    actionResolutionId: string | null = null
  ): Promise<{
    contextRecordId: string;
    draft: ResolutionDraft;
    resultReview: ContentReview;
    nextStoryReview: ContentReview | null;
    nextDecisionReview: ContentReview | null;
  }> {
    const persistedContext = await this.storyContexts.compileForResolution({
      run: context.run,
      role: context.role,
      turn: context.turn,
      controlEpoch: context.control.epoch,
      situation: context.situationInput,
      action,
      confirmedResolution: action.receiptText
    });
    if (!persistedContext.compilation.ok) {
      throw new ServiceUnavailableException({
        code: "STORY_CONTEXT_REJECTED",
        message: "本次行动的关键剧情上下文尚未准备完整，系统没有发布替代故事。请稍后重试。",
        recoverable: true,
        contextRecordId: persistedContext.recordId,
        issueCodes: persistedContext.compilation.report.issueCodes
      });
    }
    const snapshot = persistedContext.compilation.snapshot;

    try {
      const pipeline = await this.narrator.resolveContext({
        context: snapshot,
        contextRecordId: persistedContext.recordId,
        actionResolutionId,
        generateDecisions: Boolean(nextInput),
        getCurrentIdentity: async () => {
          const [latestTurn, latestRun, latestControl] = await Promise.all([
            this.prisma.actorTurn.findUnique({ where: { id: context.turn.id } }),
            this.prisma.storyRun.findUnique({ where: { id: context.run.id } }),
            this.prisma.roleControl.findUnique({ where: { runId_roleId: { runId: context.run.id, roleId: context.role.id } } })
          ]);
          if (!latestTurn || !latestRun || !latestControl) {
            return { ...snapshot.identity, actorTurnId: "missing" };
          }
          if (actionResolutionId) {
            const latestResolution = await this.prisma.actionResolution.findUnique({ where: { id: actionResolutionId } });
            if (!latestResolution || latestResolution.qualityStatus !== "GENERATING") {
              return { ...snapshot.identity, actorTurnId: "missing" };
            }
            return {
              ...snapshot.identity,
              actorTurnId: latestTurn.id,
              worldSequence: snapshot.identity.worldSequence,
              turnRevision: latestTurn.revision,
              controlEpoch: snapshot.identity.controlEpoch
            };
          }
          return {
            ...snapshot.identity,
            actorTurnId: latestTurn.id,
            worldSequence: latestRun.worldSequence,
            turnRevision: latestTurn.revision,
            controlEpoch: latestControl.epoch
          };
        }
      });
      const writerExecution = pipeline.promptExecutions.find((record) => record.pipelineStep === "WRITER");
      const provider = writerExecution?.provider || "unknown";
      const modelName = writerExecution?.modelName || "unknown";
      const draft: ResolutionDraft = {
        resultNarrative: pipeline.narrative.resultNarrative,
        nextHook: nextInput ? pipeline.plan.nextPressure : pipeline.narrative.nextSituationNarrative,
        nextSituation: nextInput ? {
          situationTitle: nextInput.stage.title,
          situationNarrative: pipeline.narrative.nextSituationNarrative,
          framing: pipeline.plan.nextPressure,
          decisions: pipeline.decisions,
          provider,
          modelName
        } : null,
        provider,
        modelName
      };
      let resultReview = reviewStory(
        draft.resultNarrative,
        context.situationInput,
        "RESULT",
        action,
        draft.nextSituation?.situationNarrative ?? ""
      );
      resultReview = acceptPipelineVerifiedSoloReview(resultReview, context.run.maxPlayers === 1);
      assertQuality(resultReview, "RESULT_STORY_QUALITY_FAILED");
      let nextStoryReview: ContentReview | null = null;
      let nextDecisionReview: ContentReview | null = null;
      if (draft.nextSituation && nextInput) {
        draft.nextSituation = bindDecisionTargets(draft.nextSituation, context.allRoles, nextInput.roleStage);
        nextStoryReview = acceptPipelineVerifiedSoloReview(
          reviewStory(draft.nextSituation.situationNarrative, nextInput, "SITUATION"),
          context.run.maxPlayers === 1
        );
        nextDecisionReview = acceptPipelineVerifiedSoloReview(
          reviewDecisionSet(draft.nextSituation.decisions, nextInput),
          context.run.maxPlayers === 1
        );
        assertQuality(nextStoryReview, "NEXT_STORY_QUALITY_FAILED");
        assertQuality(nextDecisionReview, "NEXT_DECISION_QUALITY_FAILED");
      }
      return { contextRecordId: persistedContext.recordId, draft, resultReview, nextStoryReview, nextDecisionReview };
    } catch (error) {
      if (error instanceof StoryGenerationErrorV2 && error.code === "CONTEXT_SUPERSEDED") throw new DecisionContextMovedError();
      if (error instanceof StoryGenerationErrorV2) {
        const retryable = error.recoverable;
        throw new ServiceUnavailableException({
          code: retryable ? "STORY_GENERATION_RETRYABLE" : "STORY_GENERATION_REJECTED",
          message: retryable
            ? "本次行动的真实结果剧情仍在生成，系统没有发布模板故事或固定选项。请稍后重试。"
            : "本次结果正文没有通过事实与叙事门禁，系统未发布它，也不会自动重复调用模型。",
          recoverable: retryable,
          issueCodes: error.issueCodes
        });
      }
      throw error;
    }
  }

  private resolveAction(context: Awaited<ReturnType<ContinuousStoryV2Service["loadSubmissionContext"]>>, command: TurnDecisionCommandV2): PlannedIntentAction {
    const role = roleContext(context.role);
    const candidates = asDecisionCandidates(context.decisionSet?.candidatesJson);
    const candidate = command.candidateId ? candidates.find((item) => item.id === command.candidateId) || null : null;
    if (command.candidateId && !candidate) throw new BadRequestException({ code: "INVALID_COMMAND", message: "Choose a decision from the current story" });
    const card = candidate?.actionKey
      ? context.situationInput.roleStage.mainCards.find((item) => item.actionKey === candidate.actionKey) || null
      : null;
    if (candidate?.actionKey && !card) throw new ConflictException({ code: "DECISION_CONTEXT_CHANGED", message: "That decision is no longer available" });

    // A published candidate is an executable contract. Its reviewed intent is
    // server-owned; the client may select it but cannot silently replace it.
    // Custom actions still use the player's submitted intent and full guard.
    const reviewedIntent = candidate ? this.intentForCandidate(context, candidate) : command.intent;
    const selectedIntent = candidate && reviewedIntent.method.replace(/\s/g, "").length < 6
      ? { ...reviewedIntent, method: `${candidate.label}; ${candidate.description}` }
      : reviewedIntent;
    const rawIntent: PlayerIntentV2 = command.customAction
      ? { ...selectedIntent, freeText: command.customAction }
      : selectedIntent;
    const candidateEvidenceFact = candidate && rawIntent.target.type === "EVIDENCE"
      && !context.visibleFacts.some((fact) => fact.factKey === rawIntent.target.id)
      ? { factKey: rawIntent.target.id, content: `当前局势中可见并可查验的证据：${rawIntent.target.label}` }
      : null;
    const guardVisibleFacts = candidateEvidenceFact
      ? [...context.visibleFacts, candidateEvidenceFact]
      : context.visibleFacts;
    const guardAllFacts = candidate
      ? context.allFacts.filter((fact) => fact.visibility === "public" || fact.knownByRoleIds.includes(role.id))
      : context.allFacts;
    const guard = guardPlayerIntentV2(rawIntent, {
      role,
      allRoles: context.allRoles.map((item) => ({ id: item.id, roleKey: item.roleKey, roleName: item.roleName })),
      visibleFacts: guardVisibleFacts,
      allFacts: guardAllFacts,
      assets: context.assets,
      stage: context.situationInput.stage
    });
    if (!boundaryAccepted(guard.decision)) {
      throw new BadRequestException({
        code: "GUARD_REJECTED",
        message: guard.reason,
        decision: guard.decision,
        reason: guard.reason,
        matchedRules: guard.matchedRules,
        riskFlags: guard.riskFlags,
        suggestedRewrite: guard.suggestedRewrite
      });
    }
    const action = planIntentAction({
      intent: rawIntent,
      guard,
      role,
      visibleFacts: guardVisibleFacts,
      stage: context.situationInput.stage,
      allRoles: context.allRoles.map((item) => ({ id: item.id, roleKey: item.roleKey, roleName: item.roleName })),
      candidate,
      card
    });
    const invariantIssues = intentInvariantDiff(guard.normalizedIntent, action.normalizedIntent);
    if (invariantIssues.length) throw new ConflictException({ code: "PLAYER_INTENT_CHANGED", message: "The resolver changed the player's declared intent", issues: invariantIssues });
    return action;
  }

  private intentForCandidate(
    context: Awaited<ReturnType<ContinuousStoryV2Service["loadSubmissionContext"]>>,
    candidate: DecisionCandidateV2,
    preferred?: PlayerIntentV2
  ): PlayerIntentV2 {
    const card = candidate.actionKey
      ? context.situationInput.roleStage.mainCards.find((item) => item.actionKey === candidate.actionKey) || null
      : null;
    if (candidate.actionKey && !card) throw new ConflictException({ code: "DECISION_CONTEXT_CHANGED", message: "That decision is no longer available" });
    const target = context.allRoles.find((role) => role.id === preferred?.target?.id)
      || context.allRoles.find((role) => role.id === candidate.targetRoleId)
      || context.allRoles.find((role) => role.roleKey === preferred?.target?.id)
      || context.allRoles.find((role) => role.roleKey === card?.targetRoleKey)
      || null;
    const fallbackCard = card?.fallbackActionKey
      ? context.situationInput.roleStage.mainCards.find((item) => item.actionKey === card.fallbackActionKey) || null
      : null;
    const base = preferred || candidate.intentDraft || (card ? candidateIntentDraft({
      card,
      fallbackCard,
      targetRoleId: target?.id || null,
      targetRoleName: target?.roleName || null,
      publicFrameId: context.situationInput.stage.commonContest.contestKey,
      publicFrameLabel: context.situationInput.stage.commonContest.title
    }) : null);
    if (!base) throw new ConflictException({ code: "DECISION_CONTEXT_CHANGED", message: "That decision has no executable intent" });
    if (base.target.type !== "ROLE" || !target) return base;
    return { ...base, target: { ...base.target, id: target.id, label: target.roleName } };
  }

  private async reserveResolution(input: {
    context: Awaited<ReturnType<ContinuousStoryV2Service["loadSubmissionContext"]>>;
    command: TurnDecisionCommandV2;
    requestHash: string;
    action: PlannedIntentAction;
    stageProgress: StageProgressDecision;
    actorKind: "HUMAN" | "AI";
    agentFence?: { taskId: string; leaseOwner: string; leaseVersion: number };
  }) {
    const outcome = await this.serializable(async (tx) => {
      const [run, turn, control] = await Promise.all([
        tx.storyRun.findUnique({ where: { id: input.context.run.id } }),
        tx.actorTurn.findUnique({ where: { id: input.context.turn.id }, include: { decisionSet: true, thread: true } }),
        tx.roleControl.findUnique({ where: { runId_roleId: { runId: input.context.run.id, roleId: input.context.role.id } } })
      ]);
      if (!run || !turn || turn.status !== "OPEN") throw new ConflictException({ code: "TURN_MOVED", message: "This situation has already been resolved" });
      if (input.agentFence) {
        const leased = await tx.storyTaskOutbox.findFirst({
          where: {
            id: input.agentFence.taskId,
            taskType: "ACTOR_AGENT_TURN_V2",
            status: "RUNNING",
            leaseOwner: input.agentFence.leaseOwner,
            leaseVersion: input.agentFence.leaseVersion,
            leaseExpiresAt: { gt: new Date() },
            inputRefId: turn.id
          }
        });
        if (!leased) throw new AgentLeaseLostError();
      }
      if (turn.revision !== input.command.turnRevision) throw new DecisionContextMovedError();
      const allowedModes = input.actorKind === "AI" ? ["AI_ACTIVE"] : ["HUMAN_ACTIVE", "HUMAN_OFFLINE_GRACE"];
      if (!control || control.epoch !== input.command.controlEpoch || !allowedModes.includes(control.mode)) {
        throw new ConflictException({ code: "ROLE_CONTROL_CHANGED", message: "Role control changed" });
      }
      let creditChargeId: string | null = null;
      if (input.actorKind === "HUMAN") {
        const config = readCreditConsumptionConfig();
        const billing = parseRunBilling(run, config.prices);
        if (billing.policyVersion === "active_action_v1") {
          const actionClass = classifyCreditAction({
            actorKind: "HUMAN",
            candidateId: input.command.candidateId,
            customAction: input.command.customAction,
            decisionForm: input.command.decisionForm,
            operation: "TURN"
          });
          const amount = priceForCreditAction(actionClass, billing.prices);
          const reserved = await this.creditConsumption.reserveCharge({
            runId: run.id,
            beneficiaryUserId: String(input.context.membership.userId),
            chargeType: "PLAYER_ACTION",
            actionClass,
            amount,
            idempotencyKey: `player-action:${run.id}:${input.context.membership.userId}:${input.command.idempotencyKey}`,
            requestHash: input.requestHash,
            metadata: { engine: CONTINUOUS_STORY_ENGINE_VERSION, policyVersion: billing.policyVersion, turnId: turn.id, decisionForm: input.command.decisionForm || "STORY_CHOICE" },
            meteringMode: config.meteringMode,
            tx
          });
          if (reserved.kind === "insufficient") {
            const nextEpoch = control.epoch + 1;
            await tx.roleControl.update({
              where: { id: control.id },
              data: { mode: "AI_ACTIVE", epoch: nextEpoch, reason: "CREDITS_INSUFFICIENT", takeoverAt: new Date(), offlineSince: null }
            });
            await tx.roleControlTransition.create({
              data: {
                roleControlId: control.id,
                fromMode: control.mode,
                toMode: "AI_ACTIVE",
                fromEpoch: control.epoch,
                toEpoch: nextEpoch,
                reason: "CREDITS_INSUFFICIENT",
                initiatedByUserId: input.context.membership.userId,
                effectiveSlot: `TURN:${turn.id}`,
                idempotencyKey: `credits-insufficient:${run.id}:${turn.id}:${control.epoch}`
              }
            });
            await tx.storyTaskOutbox.create({
              data: {
                runId: run.id,
                nodeId: run.currentNodeId!,
                roleId: turn.roleId,
                inputRefId: turn.id,
                actionSlot: "ACTOR_TURN",
                controlEpoch: nextEpoch,
                taskType: "ACTOR_AGENT_TURN_V2",
                status: "PENDING",
                dedupeKey: `ACTOR_AGENT_TURN_V2:${turn.id}`,
                maxAttempts: 3
              }
            });
            await tx.eventLog.create({ data: { userId: input.context.membership.userId, runId: run.id, eventName: "role_control_changed", source: "credits", payload: { roleId: turn.roleId, fromMode: control.mode, toMode: "AI_ACTIVE", epoch: nextEpoch, reason: "CREDITS_INSUFFICIENT" } } });
            return { insufficient: reserved, control: { mode: "AI_ACTIVE", epoch: nextEpoch } } as const;
          }
          creditChargeId = reserved.charge?.id || null;
        }
      }
      const appliedSequence = Math.max(run.worldSequence, Number((run as any).reservedWorldSequence || run.worldSequence)) + 1;
      const nodeId = run.currentNodeId;
      if (!nodeId) throw new ConflictException({ code: "CURRENT_NODE_REQUIRED", message: "The run has no causal node" });
      const playerAction = await tx.playerAction.create({
        data: {
          runId: run.id,
          nodeId,
          chapterIndex: turn.stageIndex,
          userId: input.actorKind === "HUMAN" ? input.context.membership.userId : null,
          roleId: input.context.role.id,
          playerType: input.actorKind === "HUMAN" ? "human" : "ai",
          actionType: playerActionTypeForDecision(input.command, input.action.source),
          targetType: input.action.normalizedIntent.target.type,
          targetId: input.action.normalizedIntent.target.id,
          targetText: input.action.targetRoleName || input.context.situationInput.stage.title,
          method: input.action.description,
          intent: input.action.intent,
          riskLevel: input.action.risk.toLowerCase(),
          freeText: input.command.customAction,
          normalizedJson: input.action as unknown as Prisma.InputJsonValue,
          guardStatus: "ok",
          guardReason: input.action.guardDecision.reason,
          auditStatus: "ok",
          status: "accepted",
          actionSlot: `TURN:${turn.id}`,
          actorKind: input.actorKind === "HUMAN" ? "HUMAN" : "AI_TAKEOVER",
          controlEpoch: input.command.controlEpoch,
          policyVersion: "continuous_story_v2",
          provider: "pending",
          modelName: "story-generation-v2.1",
          actionKey: input.action.actionKey,
          idempotencyKey: `v2-action:${input.command.idempotencyKey}`,
          requestHash: input.requestHash,
          visibility: input.action.visibility,
          targetRoleId: input.action.targetRoleId,
          leverageKey: input.action.requiredAssetKeys[0] || null,
          sealedAt: new Date(),
          immediateJson: { receipt: input.action.receiptText } as Prisma.InputJsonValue,
          resolvedJson: { appliedWorldSequence: appliedSequence, storyGenerationStatus: "GENERATING" } as Prisma.InputJsonValue,
          resolvedAt: new Date()
        }
      });
      if (creditChargeId) await this.creditConsumption.attachPlayerAction(creditChargeId, playerAction.id, tx);
      const submission = await tx.decisionSubmission.create({
        data: {
          runId: run.id,
          threadId: turn.threadId,
          turnId: turn.id,
          roleId: turn.roleId,
          userId: playerAction.userId,
          playerActionId: playerAction.id,
          candidateId: input.command.candidateId,
          customAction: input.command.customAction,
          normalizedActionJson: input.action as unknown as Prisma.InputJsonValue,
          rawIntentJson: input.command.intent as unknown as Prisma.InputJsonValue,
          normalizedIntentJson: input.action.normalizedIntent as unknown as Prisma.InputJsonValue,
          immutableIntentHash: input.action.immutableIntentHash,
          guardDecisionJson: input.action.guardDecision as unknown as Prisma.InputJsonValue,
          selectedLeverageKeysJson: input.action.requiredAssetKeys as unknown as Prisma.InputJsonValue,
          controlEpoch: input.command.controlEpoch,
          idempotencyKey: input.command.idempotencyKey,
          requestHash: input.requestHash,
          status: "GENERATING"
        }
      });
      const resolution = await tx.actionResolution.create({
        data: {
          runId: run.id,
          threadId: turn.threadId,
          turnId: turn.id,
          submissionId: submission.id,
          roleId: turn.roleId,
          playerActionId: playerAction.id,
          baseWorldSequence: run.worldSequence,
          appliedWorldSequence: appliedSequence,
          outcomeJson: { receipt: input.action.receiptText, factKeys: input.action.effectFactKeys, influenceEdges: input.action.influenceEdges } as Prisma.InputJsonValue,
          statePatchJson: {
            schemaVersion: "pending_world_mutation_v1",
            baseWorldSequence: run.worldSequence,
            nextWorldSequence: appliedSequence,
            interactionId: input.command.interactionId || null,
            nextStateKey: input.action.nextStateKey,
            fromStageIndex: turn.stageIndex,
            toStageIndex: input.stageProgress.nextStageIndex,
            stageAdvanced: input.stageProgress.stageAdvanced,
            transitionReason: input.stageProgress.reason,
            transitionFactKeys: input.stageProgress.evidenceFactKeys,
            actorTurnOrdinal: turn.turnIndex
          } as Prisma.InputJsonValue,
          resultNarrative: "",
          nextHook: "",
          qualityStatus: "GENERATING"
        }
      });
      // All authoritative world mutations are deliberately deferred until the
      // generated result passes the publication gate. Only a reservation
      // counter advances here; it is not exposed as world state.
      await (tx.storyRun as any).update({
        where: { id: run.id },
        data: { reservedWorldSequence: appliedSequence }
      });
      await tx.actorTurn.update({
        where: { id: turn.id },
        data: { status: "RESOLVING", qualityStatus: "GENERATING" }
      });
      const resultTask = await tx.storyTaskOutbox.create({
        data: {
          runId: run.id,
          nodeId,
          roleId: turn.roleId,
          inputRefId: resolution.id,
          actionSlot: "ACTOR_RESULT",
          controlEpoch: input.command.controlEpoch,
          taskType: "ACTOR_RESULT_V2",
          status: "PENDING",
          dedupeKey: `ACTOR_RESULT_V2:${resolution.id}`,
          maxAttempts: 5,
          resultJson: {
            action: input.action,
            stageProgress: input.stageProgress,
            actorKind: input.actorKind,
            controlEpoch: input.command.controlEpoch
          } as unknown as Prisma.InputJsonValue
        }
      });
      return {
        resolutionId: resolution.id,
        taskId: resultTask.id,
        appliedWorldSequence: appliedSequence,
        submissionId: submission.id
      };
    });
    if ("insufficient" in outcome && outcome.insufficient) {
      const insufficient = outcome.insufficient;
      throw new HttpException({
        code: "PLAYER_CREDITS_REQUIRED",
        message: "Not enough World Credits to submit this action; the character is continuing under AI control",
        requiredCredits: insufficient.required,
        availableCredits: insufficient.available,
        canRequestSponsor: true,
        control: { ...outcome.control, reason: "CREDITS_INSUFFICIENT" },
        purchaseUrl: `/credits?intent=PLAYER_RECLAIM&runId=${encodeURIComponent(input.context.run.id)}&returnTo=${encodeURIComponent(`/game?runId=${input.context.run.id}`)}`
      }, HttpStatus.PAYMENT_REQUIRED);
    }
    return outcome;
  }

  private async applyReservedWorldMutation(
    tx: Tx,
    input: {
      resolution: any;
      context: Awaited<ReturnType<ContinuousStoryV2Service["loadSubmissionContext"]>>;
      action: PlannedIntentAction;
      stageProgress: StageProgressDecision;
    }
  ) {
    const { resolution, context, action, stageProgress } = input;
    const run = resolution.run;
    const turn = resolution.turn;
    const submission = resolution.submission;
    const playerAction = resolution.playerAction;
    const plan = jsonRecord(resolution.statePatchJson);
    if (plan.schemaVersion !== "pending_world_mutation_v1"
      || Number(plan.baseWorldSequence) !== resolution.baseWorldSequence
      || Number(plan.nextWorldSequence) !== resolution.appliedWorldSequence) {
      throw new ConflictException({ code: "PENDING_WORLD_MUTATION_INVALID", message: "Reserved action is missing its immutable world mutation plan" });
    }
    const advanced = await tx.storyRun.updateMany({
      where: { id: run.id, worldSequence: resolution.baseWorldSequence },
      data: {
        worldSequence: resolution.appliedWorldSequence,
        currentDay: Math.max(run.currentDay, stageProgress.nextStageIndex || turn.stageIndex),
        version: { increment: 1 }
      }
    });
    if (advanced.count !== 1) throw new DecisionContextMovedError();

    const nodeId = run.currentNodeId;
    if (!nodeId) throw new ConflictException({ code: "CURRENT_NODE_REQUIRED", message: "The run has no causal node" });
    await this.applyLeverageMutations(tx, run.id, context.role.id, action, playerAction.id);
    const interactionId = typeof plan.interactionId === "string" ? plan.interactionId : null;
    if (interactionId) {
      const response = await tx.interactionRequestV2.updateMany({
        where: { id: interactionId, runId: run.id, targetRoleId: turn.roleId, status: "OPEN" },
        data: { status: "RESPONDED", responseTurnId: turn.id, respondedAt: new Date() }
      });
      if (response.count !== 1) throw new ConflictException({ code: "INTERACTION_MOVED", message: "这项回应请求已经失效或不属于当前角色。" });
    }
    if (action.normalizedIntent.condition) {
      await tx.conditionalActionV2.create({
        data: {
          runId: run.id,
          ownerThreadId: turn.threadId,
          sourceSubmissionId: submission.id,
          rawConditionJson: action.normalizedIntent.condition as unknown as Prisma.InputJsonValue,
          normalizedCommandJson: {
            intent: {
              ...action.normalizedIntent,
              method: action.normalizedIntent.fallback?.method || action.normalizedIntent.method,
              condition: null
            }
          } as unknown as Prisma.InputJsonValue,
          expiresAtStage: action.normalizedIntent.condition.expiresAtStage || null,
          dedupeKey: `condition-v2:${submission.id}`
        }
      });
    }
    if (action.targetRoleId && /承诺|答应|保证|立誓|允诺|约定|交换条件/.test(`${action.normalizedIntent.objective} ${action.normalizedIntent.method}`)) {
      await tx.commitmentV2.create({
        data: {
          runId: run.id,
          sourceResolutionId: resolution.id,
          issuerRoleId: turn.roleId,
          receiverRoleId: action.targetRoleId,
          content: `${context.role.roleName}向${action.targetRoleName || "对方"}承诺：${action.normalizedIntent.objective}；执行方式为${action.normalizedIntent.method}`,
          visibility: action.visibility,
          expiresAtStage: action.normalizedIntent.condition?.expiresAtStage || Math.min(run.totalDays, turn.stageIndex + 2),
          dedupeKey: `commitment-v2:${resolution.id}:${action.targetRoleId}`
        }
      });
    }
    if (!isSoloNpcRun(run) && action.requiresTargetResponse && action.targetRoleId) {
      await tx.interactionRequestV2.create({
        data: {
          runId: run.id,
          sourceResolutionId: resolution.id,
          sourceRoleId: turn.roleId,
          targetRoleId: action.targetRoleId,
          requestKind: action.interactionRequestKind || "REQUEST_RESPONSE",
          pressureJson: {
            objective: action.normalizedIntent.objective,
            method: action.normalizedIntent.method,
            sourceRoleName: context.role.roleName,
            targetRoleName: action.targetRoleName,
            fallback: action.normalizedIntent.fallback
          } as Prisma.InputJsonValue,
          observableTraceJson: action.observableTraceText ? { content: action.observableTraceText } as Prisma.InputJsonValue : Prisma.JsonNull,
          dedupeKey: `interaction-v2:${resolution.id}:${action.targetRoleId}`
        }
      });
    }
    await tx.conditionalActionV2.updateMany({ where: { runId: run.id, status: "ARMED", expiresAtStage: { lt: turn.stageIndex } }, data: { status: "EXPIRED", expiredAt: new Date() } });
    await tx.commitmentV2.updateMany({ where: { runId: run.id, status: "ACTIVE", expiresAtStage: { lt: turn.stageIndex } }, data: { status: "EXPIRED", expiredAt: new Date() } });

    const allRoleIds = context.allRoles.map((role) => role.id);
    for (const factKey of action.effectFactKeys) {
      const factVisibility = context.situationInput.stage.factCatalog.find((fact) => fact.factKey === factKey)?.visibility || action.visibility;
      const affectedRoleKeys = new Set(action.influenceEdges.map((edge) => edge.affectedRoleKey));
      const affectedRoleIds = context.allRoles.filter((role) => affectedRoleKeys.has(role.roleKey)).map((role) => role.id);
      const knownBy = factAudience(factVisibility, action, turn.roleId, allRoleIds, affectedRoleIds);
      const factContent = factVisibility === "OBSERVABLE"
        ? action.observableTraceText || `有人在${context.situationInput.stage.title}留下了可核验但尚不能确认来源的行动痕迹。`
        : action.receiptText;
      const existingFact = await tx.canonFact.findUnique({ where: { runId_factKey: { runId: run.id, factKey } } });
      if (existingFact) {
        await tx.canonFact.update({
          where: { id: existingFact.id },
          data: {
            content: factContent,
            status: "confirmed",
            visibility: factVisibility.toLowerCase(),
            sourceActionIdsJson: uniqueStrings([...stringList(existingFact.sourceActionIdsJson), playerAction.id]),
            knownByRoleIdsJson: uniqueStrings([...stringList(existingFact.knownByRoleIdsJson), ...knownBy])
          }
        });
      } else {
        await tx.canonFact.create({
          data: {
            runId: run.id,
            sourceNodeId: nodeId,
            factKey,
            content: factContent,
            status: "confirmed",
            visibility: factVisibility.toLowerCase(),
            sourceEventIdsJson: [],
            sourceActionIdsJson: [playerAction.id],
            knownByRoleIdsJson: knownBy
          }
        });
      }
    }
    await this.ensureStageAssets(tx, run.id, stageProgress.nextStageIndex || turn.stageIndex, context.allRoles);
    await this.publishCrossImpacts(tx, {
      runId: run.id,
      nodeId,
      sourceRole: context.role,
      action,
      stageIndex: turn.stageIndex,
      appliedSequence: resolution.appliedWorldSequence,
      playerActionId: playerAction.id,
      allRoles: context.allRoles,
      soloNpcMode: isSoloNpcRun(run)
    });
    await this.enqueueMatchingConditionTasks(tx, {
      runId: run.id,
      nodeId,
      sourceSubmissionId: submission.id,
      actorRoleId: context.role.id,
      triggeringAction: action
    });
  }

  private async finalizeReservedResolution(input: {
    context: Awaited<ReturnType<ContinuousStoryV2Service["loadSubmissionContext"]>>;
    action: PlannedIntentAction;
    stageProgress: StageProgressDecision;
    draft: ResolutionDraft;
    resultReview: ContentReview;
    nextInput: StorySituationInput | null;
    nextStoryReview: ContentReview | null;
    nextDecisionReview: ContentReview | null;
    contextRecordId: string;
    actorKind: "HUMAN" | "AI";
    controlEpoch: number;
    resolutionId: string;
    resultFence: { taskId: string; leaseOwner: string; leaseVersion: number };
  }) {
    return this.serializable(async (tx) => {
      const [leasedTask, resolution] = await Promise.all([
        tx.storyTaskOutbox.findFirst({
          where: {
            id: input.resultFence.taskId,
            taskType: "ACTOR_RESULT_V2",
            status: "RUNNING",
            leaseOwner: input.resultFence.leaseOwner,
            leaseVersion: input.resultFence.leaseVersion,
            leaseExpiresAt: { gt: new Date() },
            inputRefId: input.resolutionId
          }
        }),
        tx.actionResolution.findUnique({
          where: { id: input.resolutionId },
          include: { run: true, submission: true, playerAction: true, turn: { include: { thread: true } } }
        })
      ]);
      if (!leasedTask) throw new AgentLeaseLostError();
      if (!resolution) throw new ConflictException({ code: "RESULT_RESERVATION_MISSING", message: "Reserved result no longer exists" });
      if (resolution.qualityStatus === "PASS") {
        const existingCharge = await (tx as any).creditCharge.findUnique({ where: { playerActionId: resolution.playerActionId } });
        if (existingCharge?.status === "RESERVED") await this.creditConsumption.commitCharge(existingCharge.id, tx);
        return {
          id: resolution.id,
          submissionId: resolution.submissionId,
          appliedWorldSequence: resolution.appliedWorldSequence,
          resultNarrative: resolution.resultNarrative,
          nextHook: resolution.nextHook
        };
      }
      if (resolution.qualityStatus !== "GENERATING" || resolution.turn.status !== "RESOLVING") {
        throw new ConflictException({ code: "RESULT_RESERVATION_MOVED", message: "Reserved result cannot be finalized" });
      }
      const run = resolution.run;
      const turn = resolution.turn;
      const submission = resolution.submission;
      const playerAction = resolution.playerAction;
      const nodeId = run.currentNodeId;
      if (!nodeId) throw new ConflictException({ code: "CURRENT_NODE_REQUIRED", message: "The run has no causal node" });
      await this.applyReservedWorldMutation(tx, { resolution, context: input.context, action: input.action, stageProgress: input.stageProgress });
      await tx.actionResolution.update({
        where: { id: resolution.id },
        data: {
          resultNarrative: input.draft.resultNarrative,
          nextHook: input.draft.nextHook,
          qualityStatus: "PASS"
        }
      });
      await tx.promptExecutionRecord.updateMany({
        where: { contextSnapshotId: input.contextRecordId, actionResolutionId: null },
        data: { actionResolutionId: resolution.id }
      });
      await tx.playerAction.update({
        where: { id: playerAction.id },
        data: {
          provider: input.draft.provider,
          modelName: input.draft.modelName,
          resolvedJson: { appliedWorldSequence: resolution.appliedWorldSequence, storyGenerationStatus: "PASS" } as Prisma.InputJsonValue,
          status: "resolved",
          resolvedAt: new Date()
        }
      });
      await tx.decisionSubmission.update({
        where: { id: submission.id },
        data: { status: "RESOLVED", resolvedAt: new Date() }
      });
      await tx.actorTurn.update({
        where: { id: turn.id },
        data: { status: "RESOLVED", resolvedAt: new Date(), qualityStatus: "PASS" }
      });
      await tx.narrativeEntry.create({
        data: {
          runId: run.id,
          nodeId,
          roleId: turn.roleId,
          entryType: "V2_RESULT",
          visibility: "role_private",
          content: input.draft.resultNarrative,
          factKeysJson: input.action.effectFactKeys,
          threadKeysJson: [turn.threadId],
          sourceEventIdsJson: [],
          worldSequence: resolution.appliedWorldSequence,
          dedupeKey: `v2-result:${resolution.id}`
        }
      });

      const postActionControl = input.actorKind === "AI"
        ? await tx.roleControl.findUnique({ where: { runId_roleId: { runId: run.id, roleId: turn.roleId } } })
        : null;
      let nextTurnId: string | null = null;
      if (input.draft.nextSituation && input.nextInput && input.nextStoryReview && input.nextDecisionReview) {
        const nextTurn = await tx.actorTurn.create({
          data: {
            runId: run.id,
            threadId: turn.threadId,
            roleId: turn.roleId,
            stageIndex: input.stageProgress.nextStageIndex!,
            turnIndex: turn.turnIndex + 1,
            baseWorldSequence: resolution.appliedWorldSequence,
            situationTitle: input.draft.nextSituation.situationTitle,
            situationNarrative: input.draft.nextSituation.situationNarrative,
            visibleFactKeysJson: input.nextInput.visibleFacts.map((fact) => fact.factKey),
            activeThreadKeysJson: ["main_pressure"],
            contextJson: {
              provider: input.draft.provider,
              modelName: input.draft.modelName,
              previousResolutionId: resolution.id,
              stageTransition: input.stageProgress,
              contextSnapshotId: input.contextRecordId
            } as Prisma.InputJsonValue,
            qualityStatus: "PASS",
            dedupeKey: `actor-turn:${turn.threadId}:${turn.turnIndex + 1}`
          }
        });
        nextTurnId = nextTurn.id;
        const nextDecisionSet = await tx.decisionSet.create({
          data: {
            runId: run.id,
            turnId: nextTurn.id,
            roleId: turn.roleId,
            contextHash: sha256Canonical({ narrative: input.draft.nextSituation.situationNarrative, visibleFacts: input.nextInput.visibleFacts, stage: input.stageProgress.nextStageIndex }),
            framing: input.draft.nextSituation.framing,
            candidatesJson: input.draft.nextSituation.decisions as unknown as Prisma.InputJsonValue,
            qualityStatus: "PASS",
            qualityJson: input.nextDecisionReview as unknown as Prisma.InputJsonValue
          }
        });
        await tx.narrativeEntry.create({
          data: {
            runId: run.id,
            nodeId,
            roleId: turn.roleId,
            entryType: "V2_NEXT_SITUATION",
            visibility: "role_private",
            content: input.draft.nextSituation.situationNarrative,
            factKeysJson: input.nextInput.visibleFacts.map((fact) => fact.factKey),
            threadKeysJson: [turn.threadId],
            sourceEventIdsJson: [],
            worldSequence: resolution.appliedWorldSequence,
            dedupeKey: `v2-next:${nextTurn.id}`
          }
        });
        await tx.actorThread.update({
          where: { id: turn.threadId },
          data: {
            currentTurnIndex: nextTurn.turnIndex,
            currentStageIndex: nextTurn.stageIndex,
            lastAppliedSequence: resolution.appliedWorldSequence
          }
        });
        await this.writeReview(tx, run.id, turn.roleId, nextTurn.id, "SITUATION", nextTurn.id, input.draft.nextSituation.situationNarrative, input.nextStoryReview, input.draft.provider, input.draft.modelName);
        await this.writeReview(tx, run.id, turn.roleId, nextTurn.id, "DECISION_SET", nextDecisionSet.id, input.draft.nextSituation.decisions, input.nextDecisionReview, input.draft.provider, input.draft.modelName);
        if (input.actorKind === "AI" && postActionControl?.mode === "AI_ACTIVE") {
          await tx.storyTaskOutbox.create({
            data: {
              runId: run.id,
              nodeId,
              roleId: turn.roleId,
              inputRefId: nextTurn.id,
              actionSlot: "ACTOR_TURN",
              controlEpoch: postActionControl.epoch,
              taskType: "ACTOR_AGENT_TURN_V2",
              status: "PENDING",
              dedupeKey: `ACTOR_AGENT_TURN_V2:${nextTurn.id}`,
              maxAttempts: 3
            }
          });
        }
      } else {
        await tx.actorThread.update({
          where: { id: turn.threadId },
          data: {
            status: "COMPLETED",
            currentTurnIndex: turn.turnIndex,
            currentStageIndex: turn.stageIndex,
            lastAppliedSequence: resolution.appliedWorldSequence,
            completedAt: new Date()
          }
        });
        const endingContent = `${input.draft.resultNarrative}\n\n${input.draft.nextHook}`;
        const endingReview = acceptPipelineVerifiedSoloReview(reviewStory(endingContent, input.context.situationInput, "RESULT", input.action), run.maxPlayers === 1);
        assertQuality(endingReview, "ENDING_STORY_QUALITY_FAILED");
        const endingEntry = await tx.narrativeEntry.create({
          data: {
            runId: run.id,
            nodeId,
            roleId: turn.roleId,
            entryType: "V2_ENDING",
            visibility: "role_private",
            content: endingContent,
            factKeysJson: input.action.effectFactKeys,
            threadKeysJson: [turn.threadId],
            sourceEventIdsJson: [],
            worldSequence: resolution.appliedWorldSequence,
            dedupeKey: `v2-ending:${resolution.id}`
          }
        });
        await this.writeReview(tx, run.id, turn.roleId, turn.id, "ENDING", endingEntry.id, endingContent, endingReview, input.draft.provider, input.draft.modelName);
      }
      if (postActionControl?.mode === "HUMAN_RECLAIM_PENDING") {
        const originalPlayer = postActionControl.humanPlayerId
          ? await tx.storyPlayer.findUnique({ where: { id: postActionControl.humanPlayerId } })
          : null;
        await tx.roleControl.update({
          where: { id: postActionControl.id },
          data: { mode: "HUMAN_ACTIVE", reason: "RECLAIM_EFFECTIVE_NEXT_ACTOR_TURN", takeoverAt: null, lastHeartbeatAt: new Date() }
        });
        await tx.storyRole.update({ where: { id: turn.roleId }, data: { isAiControlled: false, status: "claimed" } });
        await tx.roleControlTransition.upsert({
          where: { idempotencyKey: `v2-reclaim-effective:${turn.id}:${postActionControl.epoch}` },
          update: {},
          create: {
            roleControlId: postActionControl.id,
            fromMode: "HUMAN_RECLAIM_PENDING",
            toMode: "HUMAN_ACTIVE",
            fromEpoch: postActionControl.epoch,
            toEpoch: postActionControl.epoch,
            reason: "RECLAIM_EFFECTIVE_NEXT_ACTOR_TURN",
            initiatedByUserId: originalPlayer?.userId || null,
            effectiveSlot: nextTurnId ? `TURN:${nextTurnId}` : "STORY_COMPLETED",
            idempotencyKey: `v2-reclaim-effective:${turn.id}:${postActionControl.epoch}`
          }
        });
        if (originalPlayer?.userId) {
          const memberUserIds = (await tx.storyPlayer.findMany({ where: { runId: run.id, status: "active", userId: { not: null } }, select: { userId: true } }))
            .map((player) => player.userId)
            .filter((id): id is string => Boolean(id));
          await this.deliveries.publish(tx, {
            runId: run.id, nodeId, day: turn.stageIndex,
            type: "ROLE_CONTROL_CHANGED_V2", visibility: "PUBLIC", audienceType: "ALL_MEMBERS",
            audienceUserIds: memberUserIds, audienceRoleIds: [turn.roleId],
            payload: { roleId: turn.roleId, controllerKind: "HUMAN", epoch: postActionControl.epoch, independentActorThread: true, initiatedByUserId: originalPlayer.userId },
            dedupeKey: `ROLE_CONTROL_CHANGED_V2:v2-reclaim-effective:${turn.id}:${postActionControl.epoch}`
          });
        }
        operationalMetrics.increment("credit_reclaim_total", { result: "effective" });
      }
      await this.writeReview(tx, run.id, turn.roleId, turn.id, "RESULT", resolution.id, input.draft.resultNarrative, input.resultReview, input.draft.provider, input.draft.modelName);
      const actorUserId = (await tx.storyPlayer.findFirst({ where: { runId: run.id, roleId: turn.roleId, playerType: "human" } }))?.userId;
      if (actorUserId) {
        await this.deliveries.publish(tx, {
          runId: run.id,
          nodeId,
          day: turn.stageIndex,
          type: "ACTOR_ACTION_RESOLVED_V2",
          visibility: "PRIVATE",
          audienceType: "MEMBER",
          audienceUserIds: [actorUserId],
          audienceRoleIds: [turn.roleId],
          sourceActionId: playerAction.id,
          payload: {
            turnId: turn.id,
            resolutionId: resolution.id,
            appliedWorldSequence: resolution.appliedWorldSequence,
            nextTurnId,
            stageAdvanced: input.stageProgress.stageAdvanced,
            nextStageIndex: input.stageProgress.nextStageIndex,
            transitionReason: input.stageProgress.reason
          },
          dedupeKey: `ACTOR_ACTION_RESOLVED_V2:${resolution.id}`
        });
      }
      const otherActive = await tx.actorThread.count({ where: { runId: run.id, status: "ACTIVE", id: { not: turn.threadId } } });
      if (!nextTurnId && otherActive === 0) {
        await tx.storyRun.update({ where: { id: run.id }, data: { status: "chapter_generated", completedNodeCount: run.totalDays, chapterCount: 1 } });
      }
      const charge = await (tx as any).creditCharge.findUnique({ where: { playerActionId: playerAction.id } });
      if (charge?.status === "RESERVED") await this.creditConsumption.commitCharge(charge.id, tx);
      return {
        id: resolution.id,
        submissionId: submission.id,
        appliedWorldSequence: resolution.appliedWorldSequence,
        resultNarrative: input.draft.resultNarrative,
        nextHook: input.draft.nextHook
      };
    });
  }

  private async applyResolution(input: {
    context: Awaited<ReturnType<ContinuousStoryV2Service["loadSubmissionContext"]>>;
    command: TurnDecisionCommandV2;
    requestHash: string;
    action: PlannedIntentAction;
    stageProgress: StageProgressDecision;
    draft: ResolutionDraft;
    resultReview: ContentReview;
    nextInput: StorySituationInput | null;
    nextStoryReview: ContentReview | null;
    nextDecisionReview: ContentReview | null;
    contextRecordId: string;
    actorKind: "HUMAN" | "AI";
    agentFence?: { taskId: string; leaseOwner: string; leaseVersion: number };
  }) {
    const primary = await this.serializable(async (tx) => {
      const [run, turn, control] = await Promise.all([
        tx.storyRun.findUnique({ where: { id: input.context.run.id } }),
        tx.actorTurn.findUnique({ where: { id: input.context.turn.id }, include: { decisionSet: true, thread: true } }),
        tx.roleControl.findUnique({ where: { runId_roleId: { runId: input.context.run.id, roleId: input.context.role.id } } })
      ]);
      if (!run || !turn || turn.status !== "OPEN") throw new ConflictException({ code: "TURN_MOVED", message: "This situation has already been resolved" });
      if (input.agentFence) {
        const leased = await tx.storyTaskOutbox.findFirst({
          where: {
            id: input.agentFence.taskId, taskType: "ACTOR_AGENT_TURN_V2", status: "RUNNING",
            leaseOwner: input.agentFence.leaseOwner, leaseVersion: input.agentFence.leaseVersion,
            leaseExpiresAt: { gt: new Date() }, inputRefId: turn.id
          }
        });
        if (!leased) throw new AgentLeaseLostError();
      }
      // Unrelated actors may advance the global sequence without invalidating
      // this role's open situation. Its revision is the relevant optimistic
      // concurrency boundary; a relevant impact increments that revision and
      // asks the outer loop to regenerate from the latest role-visible state.
      if (turn.revision !== input.command.turnRevision) throw new DecisionContextMovedError();
      const allowedModes = input.actorKind === "AI" ? ["AI_ACTIVE"] : ["HUMAN_ACTIVE", "HUMAN_OFFLINE_GRACE"];
      if (!control || control.epoch !== input.command.controlEpoch || !allowedModes.includes(control.mode)) {
        throw new ConflictException({ code: "ROLE_CONTROL_CHANGED", message: "Role control changed" });
      }
      const appliedSequence = run.worldSequence + 1;
      const nodeId = run.currentNodeId;
      if (!nodeId) throw new ConflictException({ code: "CURRENT_NODE_REQUIRED", message: "The run has no causal node" });
      const playerAction = await tx.playerAction.create({
        data: {
          runId: run.id,
          nodeId,
          chapterIndex: turn.stageIndex,
          userId: input.actorKind === "HUMAN" ? input.context.membership.userId : null,
          roleId: input.context.role.id,
          playerType: input.actorKind === "HUMAN" ? "human" : "ai",
          actionType: playerActionTypeForDecision(input.command, input.action.source),
          targetType: input.action.normalizedIntent.target.type,
          targetId: input.action.normalizedIntent.target.id,
          targetText: input.action.targetRoleName || input.context.situationInput.stage.title,
          method: input.action.description,
          intent: input.action.intent,
          riskLevel: input.action.risk.toLowerCase(),
          freeText: input.command.customAction,
          normalizedJson: input.action as unknown as Prisma.InputJsonValue,
          guardStatus: "ok",
          guardReason: input.action.guardDecision.reason,
          auditStatus: "ok",
          status: "accepted",
          actionSlot: `TURN:${turn.id}`,
          actorKind: input.actorKind === "HUMAN" ? "HUMAN" : "AI_TAKEOVER",
          controlEpoch: input.command.controlEpoch,
          policyVersion: "continuous_story_v2",
          provider: input.draft.provider,
          modelName: input.draft.modelName,
          actionKey: input.action.actionKey,
          idempotencyKey: `v2-action:${input.command.idempotencyKey}`,
          requestHash: input.requestHash,
          visibility: input.action.visibility,
          targetRoleId: input.action.targetRoleId,
          leverageKey: input.action.requiredAssetKeys[0] || null,
          sealedAt: new Date(),
          immediateJson: { receipt: input.action.receiptText } as Prisma.InputJsonValue,
          resolvedJson: { appliedWorldSequence: appliedSequence } as Prisma.InputJsonValue,
          resolvedAt: new Date()
        }
      });
      const submission = await tx.decisionSubmission.create({
        data: {
          runId: run.id,
          threadId: turn.threadId,
          turnId: turn.id,
          roleId: turn.roleId,
          userId: playerAction.userId,
          playerActionId: playerAction.id,
          candidateId: input.command.candidateId,
          customAction: input.command.customAction,
          normalizedActionJson: input.action as unknown as Prisma.InputJsonValue,
          rawIntentJson: input.command.intent as unknown as Prisma.InputJsonValue,
          normalizedIntentJson: input.action.normalizedIntent as unknown as Prisma.InputJsonValue,
          immutableIntentHash: input.action.immutableIntentHash,
          guardDecisionJson: input.action.guardDecision as unknown as Prisma.InputJsonValue,
          selectedLeverageKeysJson: input.action.requiredAssetKeys as unknown as Prisma.InputJsonValue,
          controlEpoch: input.command.controlEpoch,
          idempotencyKey: input.command.idempotencyKey,
          requestHash: input.requestHash
        }
      });
      const resolution = await tx.actionResolution.create({
        data: {
          runId: run.id,
          threadId: turn.threadId,
          turnId: turn.id,
          submissionId: submission.id,
          roleId: turn.roleId,
          playerActionId: playerAction.id,
          baseWorldSequence: input.context.observedWorldSequence,
          appliedWorldSequence: appliedSequence,
          outcomeJson: { receipt: input.action.receiptText, factKeys: input.action.effectFactKeys, influenceEdges: input.action.influenceEdges } as Prisma.InputJsonValue,
          statePatchJson: {
            nextStateKey: input.action.nextStateKey,
            fromStageIndex: turn.stageIndex,
            toStageIndex: input.stageProgress.nextStageIndex,
            stageAdvanced: input.stageProgress.stageAdvanced,
            transitionReason: input.stageProgress.reason,
            transitionFactKeys: input.stageProgress.evidenceFactKeys,
            actorTurnOrdinal: turn.turnIndex
          } as Prisma.InputJsonValue,
          resultNarrative: input.draft.resultNarrative,
          nextHook: input.draft.nextHook,
          qualityStatus: "PASS"
        }
      });
      await tx.promptExecutionRecord.updateMany({
        where: { contextSnapshotId: input.contextRecordId, actionResolutionId: null },
        data: { actionResolutionId: resolution.id }
      });
      await this.applyLeverageMutations(tx, run.id, input.context.role.id, input.action, playerAction.id);
      if (input.command.interactionId) {
        const response = await tx.interactionRequestV2.updateMany({
          where: {
            id: input.command.interactionId,
            runId: run.id,
            targetRoleId: turn.roleId,
            status: "OPEN"
          },
          data: { status: "RESPONDED", responseTurnId: turn.id, respondedAt: new Date() }
        });
        if (response.count !== 1) throw new ConflictException({ code: "INTERACTION_MOVED", message: "这项回应请求已经失效或不属于当前角色。" });
      }
      if (input.action.normalizedIntent.condition) {
        await tx.conditionalActionV2.create({
          data: {
            runId: run.id,
            ownerThreadId: turn.threadId,
            sourceSubmissionId: submission.id,
            rawConditionJson: input.action.normalizedIntent.condition as unknown as Prisma.InputJsonValue,
            normalizedCommandJson: {
              intent: {
                ...input.action.normalizedIntent,
                method: input.action.normalizedIntent.fallback?.method || input.action.normalizedIntent.method,
                condition: null
              }
            } as unknown as Prisma.InputJsonValue,
            expiresAtStage: input.action.normalizedIntent.condition.expiresAtStage || null,
            dedupeKey: `condition-v2:${submission.id}`
          }
        });
      }
      if (input.action.targetRoleId && /承诺|答应|保证|立誓|允诺|约定|交换条件/.test(`${input.action.normalizedIntent.objective} ${input.action.normalizedIntent.method}`)) {
        await tx.commitmentV2.create({
          data: {
            runId: run.id,
            sourceResolutionId: resolution.id,
            issuerRoleId: turn.roleId,
            receiverRoleId: input.action.targetRoleId,
            content: `${input.context.role.roleName}向${input.action.targetRoleName || "对方"}承诺：${input.action.normalizedIntent.objective}；执行方式为${input.action.normalizedIntent.method}`,
            visibility: input.action.visibility,
            expiresAtStage: input.action.normalizedIntent.condition?.expiresAtStage || Math.min(input.context.run.totalDays, turn.stageIndex + 2),
            dedupeKey: `commitment-v2:${resolution.id}:${input.action.targetRoleId}`
          }
        });
      }
      if (!isSoloNpcRun(run) && input.action.requiresTargetResponse && input.action.targetRoleId) {
        await tx.interactionRequestV2.create({
          data: {
            runId: run.id,
            sourceResolutionId: resolution.id,
            sourceRoleId: turn.roleId,
            targetRoleId: input.action.targetRoleId,
            requestKind: input.action.interactionRequestKind || "REQUEST_RESPONSE",
            pressureJson: {
              objective: input.action.normalizedIntent.objective,
              method: input.action.normalizedIntent.method,
              sourceRoleName: input.context.role.roleName,
              targetRoleName: input.action.targetRoleName,
              fallback: input.action.normalizedIntent.fallback
            } as Prisma.InputJsonValue,
            observableTraceJson: input.action.observableTraceText ? { content: input.action.observableTraceText } as Prisma.InputJsonValue : Prisma.JsonNull,
            dedupeKey: `interaction-v2:${resolution.id}:${input.action.targetRoleId}`
          }
        });
      }
      await tx.conditionalActionV2.updateMany({
        where: { runId: run.id, status: "ARMED", expiresAtStage: { lt: turn.stageIndex } },
        data: { status: "EXPIRED", expiredAt: new Date() }
      });
      await tx.commitmentV2.updateMany({
        where: { runId: run.id, status: "ACTIVE", expiresAtStage: { lt: turn.stageIndex } },
        data: { status: "EXPIRED", expiredAt: new Date() }
      });
      await tx.decisionSubmission.update({ where: { id: submission.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
      await tx.actorTurn.update({ where: { id: turn.id }, data: { status: "RESOLVED", resolvedAt: new Date(), qualityStatus: "PASS" } });
      await tx.narrativeEntry.create({
        data: {
          runId: run.id, nodeId, roleId: turn.roleId, entryType: "V2_RESULT", visibility: "role_private",
          content: input.draft.resultNarrative, factKeysJson: input.action.effectFactKeys,
          threadKeysJson: [turn.threadId], sourceEventIdsJson: [], worldSequence: appliedSequence,
          dedupeKey: `v2-result:${resolution.id}`
        }
      });

      const allRoleIds = input.context.allRoles.map((role) => role.id);
      for (const factKey of input.action.effectFactKeys) {
        const factVisibility = input.context.situationInput.stage.factCatalog.find((fact) => fact.factKey === factKey)?.visibility || input.action.visibility;
        const affectedRoleKeys = new Set(input.action.influenceEdges.map((edge) => edge.affectedRoleKey));
        const affectedRoleIds = input.context.allRoles.filter((role) => affectedRoleKeys.has(role.roleKey)).map((role) => role.id);
        const knownBy = factAudience(factVisibility, input.action, turn.roleId, allRoleIds, affectedRoleIds);
        const factContent = factVisibility === "OBSERVABLE"
          ? input.action.observableTraceText || `有人在${input.context.situationInput.stage.title}留下了可核验但尚不能确认来源的行动痕迹。`
          : input.action.receiptText;
        const existingFact = await tx.canonFact.findUnique({ where: { runId_factKey: { runId: run.id, factKey } } });
        if (existingFact) {
          await tx.canonFact.update({
            where: { id: existingFact.id },
            data: {
              content: factContent,
              status: "confirmed",
              visibility: factVisibility.toLowerCase(),
              sourceActionIdsJson: uniqueStrings([...stringList(existingFact.sourceActionIdsJson), playerAction.id]),
              knownByRoleIdsJson: uniqueStrings([...stringList(existingFact.knownByRoleIdsJson), ...knownBy])
            }
          });
        } else {
          await tx.canonFact.create({
            data: {
              runId: run.id, sourceNodeId: nodeId, factKey, content: factContent,
              status: "confirmed", visibility: factVisibility.toLowerCase(),
              sourceEventIdsJson: [], sourceActionIdsJson: [playerAction.id], knownByRoleIdsJson: knownBy
            }
          });
        }
      }
      const resultingStageIndex = input.stageProgress.nextStageIndex || turn.stageIndex;
      await this.ensureStageAssets(tx, run.id, resultingStageIndex, input.context.allRoles);
      await tx.storyRun.update({ where: { id: run.id }, data: { worldSequence: appliedSequence, currentDay: Math.max(run.currentDay, resultingStageIndex), version: { increment: 1 } } });

      let nextTurnId: string | null = null;
      if (input.draft.nextSituation && input.nextInput && input.nextStoryReview && input.nextDecisionReview) {
        const nextTurn = await tx.actorTurn.create({
          data: {
            runId: run.id, threadId: turn.threadId, roleId: turn.roleId,
            stageIndex: input.stageProgress.nextStageIndex!, turnIndex: turn.turnIndex + 1, baseWorldSequence: appliedSequence,
            situationTitle: input.draft.nextSituation.situationTitle,
            situationNarrative: input.draft.nextSituation.situationNarrative,
            visibleFactKeysJson: input.nextInput.visibleFacts.map((fact) => fact.factKey), activeThreadKeysJson: ["main_pressure"],
            contextJson: {
              provider: input.draft.provider,
              modelName: input.draft.modelName,
              previousResolutionId: resolution.id,
              stageTransition: input.stageProgress
            } as Prisma.InputJsonValue,
            qualityStatus: "PASS", dedupeKey: `actor-turn:${turn.threadId}:${turn.turnIndex + 1}`
          }
        });
        nextTurnId = nextTurn.id;
        const nextDecisionSet = await tx.decisionSet.create({
          data: {
            runId: run.id, turnId: nextTurn.id, roleId: turn.roleId,
            contextHash: sha256Canonical({ narrative: input.draft.nextSituation.situationNarrative, visibleFacts: input.nextInput.visibleFacts, stage: input.stageProgress.nextStageIndex }),
            framing: input.draft.nextSituation.framing,
            candidatesJson: input.draft.nextSituation.decisions as unknown as Prisma.InputJsonValue,
            qualityStatus: "PASS", qualityJson: input.nextDecisionReview as unknown as Prisma.InputJsonValue
          }
        });
        await tx.narrativeEntry.create({
          data: {
            runId: run.id, nodeId, roleId: turn.roleId, entryType: "V2_NEXT_SITUATION", visibility: "role_private",
            content: input.draft.nextSituation.situationNarrative,
            factKeysJson: input.nextInput.visibleFacts.map((fact) => fact.factKey), threadKeysJson: [turn.threadId],
            sourceEventIdsJson: [], worldSequence: appliedSequence, dedupeKey: `v2-next:${nextTurn.id}`
          }
        });
        await tx.actorThread.update({ where: { id: turn.threadId }, data: { currentTurnIndex: nextTurn.turnIndex, currentStageIndex: nextTurn.stageIndex, lastAppliedSequence: appliedSequence } });
        await this.writeReview(tx, run.id, turn.roleId, nextTurn.id, "SITUATION", nextTurn.id, input.draft.nextSituation.situationNarrative, input.nextStoryReview, input.draft.provider, input.draft.modelName);
        await this.writeReview(tx, run.id, turn.roleId, nextTurn.id, "DECISION_SET", nextDecisionSet.id, input.draft.nextSituation.decisions, input.nextDecisionReview, input.draft.provider, input.draft.modelName);
        if (input.actorKind === "AI") {
          await tx.storyTaskOutbox.create({
            data: {
              runId: run.id, nodeId, roleId: turn.roleId, inputRefId: nextTurn.id,
              actionSlot: "ACTOR_TURN", controlEpoch: input.command.controlEpoch, taskType: "ACTOR_AGENT_TURN_V2",
              status: "PENDING", dedupeKey: `ACTOR_AGENT_TURN_V2:${nextTurn.id}`, maxAttempts: 3
            }
          });
        }
      } else {
        await tx.actorThread.update({ where: { id: turn.threadId }, data: { status: "COMPLETED", currentTurnIndex: turn.turnIndex, currentStageIndex: turn.stageIndex, lastAppliedSequence: appliedSequence, completedAt: new Date() } });
        const endingContent = `${input.draft.resultNarrative}\n\n${input.draft.nextHook}`;
        const endingReview = acceptPipelineVerifiedSoloReview(reviewStory(endingContent, input.context.situationInput, "RESULT", input.action), run.maxPlayers === 1);
        assertQuality(endingReview, "ENDING_STORY_QUALITY_FAILED");
        const endingEntry = await tx.narrativeEntry.create({
          data: {
            runId: run.id, nodeId, roleId: turn.roleId, entryType: "V2_ENDING", visibility: "role_private",
            content: endingContent,
            factKeysJson: input.action.effectFactKeys, threadKeysJson: [turn.threadId], sourceEventIdsJson: [],
            worldSequence: appliedSequence, dedupeKey: `v2-ending:${resolution.id}`
          }
        });
        await this.writeReview(tx, run.id, turn.roleId, turn.id, "ENDING", endingEntry.id, endingContent, endingReview, input.draft.provider, input.draft.modelName);
      }
      await this.writeReview(tx, run.id, turn.roleId, turn.id, "RESULT", resolution.id, input.draft.resultNarrative, input.resultReview, input.draft.provider, input.draft.modelName);
      await this.publishCrossImpacts(tx, {
        runId: run.id,
        nodeId,
        sourceRole: input.context.role,
        action: input.action,
        stageIndex: turn.stageIndex,
        appliedSequence,
        playerActionId: playerAction.id,
        allRoles: input.context.allRoles,
        soloNpcMode: isSoloNpcRun(run)
      });
      await this.enqueueMatchingConditionTasks(tx, {
        runId: run.id,
        nodeId,
        sourceSubmissionId: submission.id,
        actorRoleId: input.context.role.id,
        triggeringAction: input.action
      });
      const actorUserId = (await tx.storyPlayer.findFirst({ where: { runId: run.id, roleId: turn.roleId, playerType: "human" } }))?.userId;
      if (actorUserId) {
        await this.deliveries.publish(tx, {
          runId: run.id, nodeId, day: turn.stageIndex, type: "ACTOR_ACTION_RESOLVED_V2", visibility: "PRIVATE", audienceType: "MEMBER",
          audienceUserIds: [actorUserId], audienceRoleIds: [turn.roleId], sourceActionId: playerAction.id,
          payload: {
            turnId: turn.id,
            resolutionId: resolution.id,
            appliedWorldSequence: appliedSequence,
            nextTurnId,
            stageAdvanced: input.stageProgress.stageAdvanced,
            nextStageIndex: input.stageProgress.nextStageIndex,
            transitionReason: input.stageProgress.reason
          },
          dedupeKey: `ACTOR_ACTION_RESOLVED_V2:${resolution.id}`
        });
      }
      const otherActive = await tx.actorThread.count({ where: { runId: run.id, status: "ACTIVE", id: { not: turn.threadId } } });
      if (!nextTurnId && otherActive === 0) await tx.storyRun.update({ where: { id: run.id }, data: { status: "chapter_generated", completedNodeCount: run.totalDays, chapterCount: 1 } });
      return { id: resolution.id, submissionId: submission.id, appliedWorldSequence: appliedSequence, resultNarrative: resolution.resultNarrative, nextHook: resolution.nextHook };
    });
    return primary;
  }

  private async publishCrossImpacts(tx: Tx, input: {
    runId: string; nodeId: string; sourceRole: StoryRole; action: PlannedIntentAction; stageIndex: number;
    appliedSequence: number; playerActionId: string; allRoles: StoryRole[]; soloNpcMode: boolean;
  }) {
    // Solo non-human roles are story NPCs, not independently scheduled actors.
    // Their reactions are written into the human result and next situation.
    if (input.soloNpcMode) return;
    const explicitKeys = new Set(input.action.influenceEdges.map((edge) => edge.affectedRoleKey));
    const broadlyObservable = input.action.visibility === "PUBLIC" || input.action.visibility === "OBSERVABLE";
    const directedPrivateResponse = input.action.visibility === "PRIVATE" && input.action.requiresTargetResponse;
    const targets = input.allRoles.filter((role) => role.id !== input.sourceRole.id
      && (broadlyObservable || (explicitKeys.has(role.roleKey) && (input.action.visibility === "LIMITED" || directedPrivateResponse))));
    if (!targets.length) return;
    for (const target of targets) {
      await this.enqueueImpactTask(tx, {
        runId: input.runId,
        nodeId: input.nodeId,
        payload: {
          sourceRoleId: input.sourceRole.id,
          sourceRoleName: input.sourceRole.roleName,
          targetRoleId: target.id,
          targetRoleName: target.roleName,
          stageIndex: input.stageIndex,
          appliedWorldSequence: input.appliedSequence,
          playerActionId: input.playerActionId,
          mode: input.action.visibility === "OBSERVABLE" ? "TRACE" : "FULL",
          action: input.action
        }
      });
    }
  }

  private async enqueueImpactTask(tx: Tx, input: {
    runId: string;
    nodeId: string;
    payload: ImpactTaskPayloadV2;
  }) {
    await tx.storyTaskOutbox.create({
      data: {
        runId: input.runId,
        nodeId: input.nodeId,
        roleId: input.payload.targetRoleId,
        inputRefId: input.payload.playerActionId,
        actionSlot: "ACTOR_IMPACT",
        taskType: "ACTOR_IMPACT_V2",
        status: "PENDING",
        dedupeKey: `ACTOR_IMPACT_V2:${input.payload.playerActionId}:${input.payload.targetRoleId}`,
        maxAttempts: 5,
        resultJson: input.payload as unknown as Prisma.InputJsonValue
      }
    });
  }

  private async enqueueMatchingConditionTasks(tx: Tx, input: {
    runId: string;
    nodeId: string;
    sourceSubmissionId: string;
    actorRoleId: string;
    triggeringAction: PlannedIntentAction;
  }) {
    const conditions = await tx.conditionalActionV2.findMany({
      where: { runId: input.runId, status: "ARMED", sourceSubmissionId: { not: input.sourceSubmissionId } },
      include: { ownerThread: true },
      orderBy: { createdAt: "asc" }
    });
    const triggerEventKey = `${input.triggeringAction.actionKey}@${input.triggeringAction.immutableIntentHash}`;
    const matching = conditions.filter((condition) => conditionMatches(condition.rawConditionJson, input.actorRoleId, input.triggeringAction));
    if (!matching.length) return;
    await tx.storyTaskOutbox.createMany({
      skipDuplicates: true,
      data: matching.map((condition) => ({
        runId: input.runId,
        nodeId: input.nodeId,
        roleId: condition.ownerThread.roleId,
        actionSlot: "CONDITIONAL_ACTION",
        taskType: "CONDITIONAL_ACTION_V2",
        status: "PENDING",
        inputRefId: condition.id,
        checkpointKey: triggerEventKey,
        dedupeKey: `CONDITIONAL_ACTION_V2:${condition.id}`,
        maxAttempts: 5
      }))
    });
  }

  private async applyTriggeredCondition(
    conditionId: string,
    triggerEventKey: string,
    fence: { taskId: string; leaseOwner: string; leaseVersion: number }
  ) {
    return this.serializable(async (tx) => {
      const leasedTask = await tx.storyTaskOutbox.findFirst({
        where: {
          id: fence.taskId,
          taskType: "CONDITIONAL_ACTION_V2",
          status: "RUNNING",
          inputRefId: conditionId,
          leaseOwner: fence.leaseOwner,
          leaseVersion: fence.leaseVersion,
          leaseExpiresAt: { gt: new Date() }
        }
      });
      if (!leasedTask) throw new AgentLeaseLostError();
      const condition = await tx.conditionalActionV2.findUnique({
        where: { id: conditionId },
        include: { ownerThread: { include: { role: true } }, sourceSubmission: true, run: true }
      });
      if (!condition || condition.status !== "ARMED") return { outcome: "CONDITION_ALREADY_SETTLED" };
      if (condition.expiresAtStage && condition.expiresAtStage < condition.ownerThread.currentStageIndex) {
        await tx.conditionalActionV2.update({ where: { id: condition.id }, data: { status: "EXPIRED", expiredAt: new Date() } });
        return { outcome: "CONDITION_EXPIRED" };
      }
      const nodeId = condition.run.currentNodeId;
      if (!nodeId) throw new ConflictException({ code: "CURRENT_NODE_REQUIRED", message: "The run has no causal node" });
      const commandRecord = jsonRecord(condition.normalizedCommandJson);
      const rawIntent = commandRecord.intent as PlayerIntentV2 | undefined;
      if (!rawIntent) {
        await tx.conditionalActionV2.update({ where: { id: condition.id }, data: { status: "INVALID", triggerEventKey } });
        return { outcome: "CONDITION_INVALID" };
      }
      const [facts, assets, allRoles] = await Promise.all([
        tx.canonFact.findMany({ where: { runId: condition.runId, status: "confirmed" }, orderBy: { createdAt: "asc" } }),
        tx.roleAsset.findMany({ where: { runId: condition.runId }, orderBy: { assetKey: "asc" } }),
        tx.storyRole.findMany({ where: { runId: condition.runId }, orderBy: { createdAt: "asc" } })
      ]);
      const visibleFacts = visibleFactsForRole(facts, condition.ownerThread.roleId);
      const situationInput = this.situationInput(
        condition.run,
        condition.ownerThread.role,
        condition.ownerThread.currentStageIndex,
        condition.ownerThread.currentTurnIndex,
        condition.run.worldSequence,
        visibleFacts,
        []
      );
      const guard = guardPlayerIntentV2(rawIntent, {
        role: roleContext(condition.ownerThread.role),
        allRoles: allRoles.map((role) => ({ id: role.id, roleKey: role.roleKey, roleName: role.roleName })),
        visibleFacts,
        allFacts: facts.map((fact) => ({ factKey: fact.factKey, content: fact.content, visibility: fact.visibility, knownByRoleIds: stringList(fact.knownByRoleIdsJson) })),
        assets,
        stage: situationInput.stage
      });
      if (!boundaryAccepted(guard.decision)) {
        await tx.conditionalActionV2.update({ where: { id: condition.id }, data: { status: "INVALID", triggerEventKey } });
        return { outcome: "CONDITION_INVALID" };
      }
      const action = planIntentAction({
        intent: rawIntent,
        guard,
        role: roleContext(condition.ownerThread.role),
        visibleFacts,
        stage: situationInput.stage,
        allRoles: allRoles.map((role) => ({ id: role.id, roleKey: role.roleKey, roleName: role.roleName }))
      });
      const appliedSequence = condition.run.worldSequence + 1;
      const turn = await tx.actorTurn.create({
        data: {
          runId: condition.runId,
          threadId: condition.ownerThreadId,
          roleId: condition.ownerThread.roleId,
          stageIndex: condition.ownerThread.currentStageIndex,
          turnIndex: -appliedSequence,
          status: "RESOLVED",
          baseWorldSequence: condition.run.worldSequence,
          situationTitle: `条件后手：${action.label}`,
          situationNarrative: "",
          visibleFactKeysJson: visibleFacts.map((fact) => fact.factKey),
          activeThreadKeysJson: ["conditional_action"],
          contextJson: { conditionalActionId: condition.id, triggerEventKey } as Prisma.InputJsonValue,
          qualityStatus: "PENDING",
          resolvedAt: new Date(),
          dedupeKey: `condition-turn-v2:${condition.id}`
        }
      });
      const playerAction = await tx.playerAction.create({
        data: {
          runId: condition.runId,
          nodeId,
          chapterIndex: condition.ownerThread.currentStageIndex,
          userId: condition.sourceSubmission.userId,
          roleId: condition.ownerThread.roleId,
          playerType: condition.sourceSubmission.userId ? "human" : "ai",
          actionType: "conditional",
          targetType: action.normalizedIntent.target.type,
          targetId: action.normalizedIntent.target.id,
          targetText: action.normalizedIntent.target.label,
          method: action.description,
          intent: action.intent,
          riskLevel: action.risk.toLowerCase(),
          freeText: action.normalizedIntent.freeText || action.description,
          normalizedJson: action as unknown as Prisma.InputJsonValue,
          guardStatus: "ok",
          guardReason: guard.reason,
          auditStatus: "ok",
          status: "accepted",
          actionSlot: `CONDITION:${condition.id}`,
          actorKind: "CONDITIONAL",
          controlEpoch: condition.sourceSubmission.controlEpoch,
          policyVersion: "continuous_story_v2_condition",
          provider: "rules",
          modelName: "conditional-action-v2",
          actionKey: action.actionKey,
          idempotencyKey: `condition-action-v2:${condition.id}`,
          requestHash: sha256Canonical({ conditionId: condition.id, triggerEventKey, intent: action.normalizedIntent }),
          visibility: action.visibility,
          targetRoleId: action.targetRoleId,
          leverageKey: action.requiredAssetKeys[0] || null,
          sealedAt: new Date(),
          immediateJson: { triggerEventKey } as Prisma.InputJsonValue,
          resolvedJson: { appliedWorldSequence: appliedSequence } as Prisma.InputJsonValue,
          resolvedAt: new Date()
        }
      });
      const submission = await tx.decisionSubmission.create({
        data: {
          runId: condition.runId,
          threadId: condition.ownerThreadId,
          turnId: turn.id,
          roleId: condition.ownerThread.roleId,
          userId: condition.sourceSubmission.userId,
          playerActionId: playerAction.id,
          customAction: action.description,
          normalizedActionJson: action as unknown as Prisma.InputJsonValue,
          rawIntentJson: rawIntent as unknown as Prisma.InputJsonValue,
          normalizedIntentJson: action.normalizedIntent as unknown as Prisma.InputJsonValue,
          immutableIntentHash: action.immutableIntentHash,
          guardDecisionJson: guard as unknown as Prisma.InputJsonValue,
          selectedLeverageKeysJson: action.requiredAssetKeys as unknown as Prisma.InputJsonValue,
          controlEpoch: condition.sourceSubmission.controlEpoch,
          idempotencyKey: `condition-submission-v2:${condition.id}`,
          requestHash: sha256Canonical({ conditionId: condition.id, triggerEventKey }),
          status: "RESOLVED",
          resolvedAt: new Date()
        }
      });
      const resolution = await tx.actionResolution.create({
        data: {
          runId: condition.runId,
          threadId: condition.ownerThreadId,
          turnId: turn.id,
          submissionId: submission.id,
          roleId: condition.ownerThread.roleId,
          playerActionId: playerAction.id,
          baseWorldSequence: condition.run.worldSequence,
          appliedWorldSequence: appliedSequence,
          outcomeJson: { triggerEventKey, receipt: action.receiptText, factKeys: action.effectFactKeys, conditionalActionId: condition.id } as Prisma.InputJsonValue,
          statePatchJson: { conditionStatus: "TRIGGERED", nextStateKey: action.nextStateKey } as Prisma.InputJsonValue,
          resultNarrative: "",
          nextHook: "",
          qualityStatus: "GENERATING"
        }
      });
      await this.applyLeverageMutations(tx, condition.runId, condition.ownerThread.roleId, action, playerAction.id);
      const allRoleIds = allRoles.map((role) => role.id);
      for (const factKey of action.effectFactKeys) {
        const factVisibility = situationInput.stage.factCatalog.find((fact) => fact.factKey === factKey)?.visibility || action.visibility;
        const affectedKeys = new Set(action.influenceEdges.map((edge) => edge.affectedRoleKey));
        const affectedIds = allRoles.filter((role) => affectedKeys.has(role.roleKey)).map((role) => role.id);
        const knownBy = factAudience(factVisibility, action, condition.ownerThread.roleId, allRoleIds, affectedIds);
        const factContent = factVisibility === "OBSERVABLE" ? action.observableTraceText || action.receiptText : action.receiptText;
        await tx.canonFact.upsert({
          where: { runId_factKey: { runId: condition.runId, factKey } },
          update: { content: factContent, status: "confirmed", visibility: factVisibility.toLowerCase(), knownByRoleIdsJson: knownBy, sourceActionIdsJson: [playerAction.id] },
          create: { runId: condition.runId, sourceNodeId: nodeId, factKey, content: factContent, status: "confirmed", visibility: factVisibility.toLowerCase(), sourceEventIdsJson: [], sourceActionIdsJson: [playerAction.id], knownByRoleIdsJson: knownBy }
        });
      }
      await tx.conditionalActionV2.update({
        where: { id: condition.id },
        data: { status: "TRIGGERED", triggerEventKey, triggeredResolutionId: resolution.id, triggeredAt: new Date() }
      });
      await tx.storyRun.update({ where: { id: condition.runId }, data: { worldSequence: appliedSequence, version: { increment: 1 } } });
      await tx.actorThread.update({ where: { id: condition.ownerThreadId }, data: { lastAppliedSequence: appliedSequence } });
      await this.publishCrossImpacts(tx, {
        runId: condition.runId,
        nodeId,
        sourceRole: condition.ownerThread.role,
        action,
        stageIndex: condition.ownerThread.currentStageIndex,
        appliedSequence,
        playerActionId: playerAction.id,
        allRoles,
        soloNpcMode: isSoloNpcRun(condition.run)
      });
      await this.enqueueImpactTask(tx, {
        runId: condition.runId,
        nodeId,
        payload: {
          sourceRoleId: condition.ownerThread.roleId,
          sourceRoleName: "你预先布置的后手",
          targetRoleId: condition.ownerThread.roleId,
          targetRoleName: condition.ownerThread.role.roleName,
          stageIndex: condition.ownerThread.currentStageIndex,
          appliedWorldSequence: appliedSequence,
          playerActionId: playerAction.id,
          mode: "FULL",
          action
        }
      });
      return { outcome: "CONDITION_RULES_CONFIRMED", resolutionId: resolution.id, appliedWorldSequence: appliedSequence };
    });
  }

  private situationInput(
    run: { templateKey: string; strategyVersion: string },
    role: StoryRole,
    stageIndex: number,
    turnIndex: number,
    worldSequence: number,
    visibleFacts: VisibleFact[],
    incomingImpacts: Array<{ sourceRoleName: string; content: string }>,
    previousAction?: ResolvedStoryAction,
    previousResult?: string
  ): StorySituationInput {
    const game = getGameDefinition(run.templateKey);
    const content = this.content.forGame(run.templateKey, run.strategyVersion);
    return {
      role: roleContext(role),
      stage: content.stage(stageIndex),
      roleStage: groundRoleStageContent(content.stage(stageIndex), roleContext(role), content.roleStage(stageIndex, role.roleKey)),
      worldSequence,
      turnIndex,
      locationLabel: game.presentation.locationLabel,
      visibleFacts,
      incomingImpacts,
      previousAction,
      previousResult
    };
  }

  private async ensureStageAssets(tx: Tx, runId: string, stageIndex: number, roles: StoryRole[]) {
    const run = await tx.storyRun.findUniqueOrThrow({ where: { id: runId } });
    const stage = this.content.forGame(run.templateKey, run.strategyVersion).stage(stageIndex);
    const byKey = new Map(roles.map((role) => [role.roleKey, role]));
    await tx.roleAsset.createMany({
      skipDuplicates: true,
      data: stage.assetCatalog.map((asset) => {
        const owner = asset.initialOwnerRoleKey ? byKey.get(asset.initialOwnerRoleKey) : null;
        return {
          runId, assetKey: asset.assetKey, kind: asset.kind, ownerRoleId: owner?.id || null,
          ownerActorKey: owner ? null : asset.initialOwnerRoleKey, quantity: 1, visibility: "PRIVATE",
          stateJson: { stageKey: stage.stageKey, initialOwnerRoleKey: asset.initialOwnerRoleKey } as Prisma.InputJsonValue
        };
      })
    });
  }

  private async applyLeverageMutations(
    tx: Tx,
    runId: string,
    actorRoleId: string,
    action: PlannedIntentAction,
    playerActionId: string
  ) {
    for (const planned of action.leverageDispositions) {
      const asset = await tx.roleAsset.findUnique({ where: { runId_assetKey: { runId, assetKey: planned.assetKey } } });
      const claimable = planned.disposition === "CLAIM" && asset && asset.ownerRoleId === null && asset.status === "ACTIVE";
      const heldByActor = asset && asset.ownerRoleId === actorRoleId && asset.status === "ACTIVE" && asset.quantity > 0;
      if (!asset || (!claimable && !heldByActor)) {
        throw new ConflictException({
          code: "LEVERAGE_STATE_CHANGED",
          message: planned.disposition === "CLAIM"
            ? `“${assetDisplayName(planned.assetKey)}”已经被他人取得，请按最新局势重新决策。`
            : `“${assetDisplayName(planned.assetKey)}”已经不再由当前角色持有，请按最新局势重新决策。`
        });
      }
      const disposition = planned.disposition === "TRANSFER" && !action.targetRoleId ? "REFERENCE" : planned.disposition;
      const nextOwnerRoleId = disposition === "TRANSFER" ? action.targetRoleId : disposition === "CLAIM" ? actorRoleId : asset.ownerRoleId;
      const nextQuantity = disposition === "CONSUME" ? asset.quantity - 1 : asset.quantity;
      const nextStatus = nextQuantity > 0 ? asset.status : "SPENT";
      const before = {
        ownerRoleId: asset.ownerRoleId,
        ownerActorKey: asset.ownerActorKey,
        quantity: asset.quantity,
        status: asset.status,
        state: asset.stateJson
      };
      const nextState = {
        ...jsonRecord(asset.stateJson),
        lastUsedByActionId: playerActionId,
        lastDisposition: disposition,
        lastUsedAtWorldSequence: action.nextStateKey
      };
      const after = {
        ownerRoleId: nextOwnerRoleId,
        ownerActorKey: disposition === "TRANSFER" || disposition === "CLAIM" ? null : asset.ownerActorKey,
        quantity: nextQuantity,
        status: nextStatus,
        state: nextState
      };
      await tx.roleAsset.update({
        where: { id: asset.id },
        data: {
          ownerRoleId: nextOwnerRoleId,
          ownerActorKey: disposition === "TRANSFER" || disposition === "CLAIM" ? null : asset.ownerActorKey,
          quantity: nextQuantity,
          status: nextStatus,
          stateJson: nextState as Prisma.InputJsonValue,
          version: { increment: 1 }
        }
      });
      await tx.roleAssetMutation.create({
        data: {
          assetId: asset.id,
          actionId: playerActionId,
          mutationType: disposition,
          delta: nextQuantity - asset.quantity,
          fromRoleId: asset.ownerRoleId,
          toRoleId: nextOwnerRoleId,
          beforeJson: before as unknown as Prisma.InputJsonValue,
          afterJson: after as unknown as Prisma.InputJsonValue,
          idempotencyKey: `leverage-v2:${playerActionId}:${asset.assetKey}`
        }
      });
    }
  }

  private async writeReview(tx: Tx, runId: string, roleId: string | null, turnId: string | null, targetType: string, targetId: string, content: unknown, review: ContentReview, provider: string, modelName: string) {
    await tx.contentQualityReview.upsert({
      where: { targetType_targetId_contentHash: { targetType, targetId, contentHash: sha256Canonical(content) } },
      update: {},
      create: {
        runId, roleId, turnId, targetType, targetId, contentHash: sha256Canonical(content), status: review.status,
        scoresJson: review.scores as Prisma.InputJsonValue, issuesJson: review.issues as Prisma.InputJsonValue, provider, modelName
      }
    });
  }

  private async replay(user: AuthenticatedUser, roomId: string, idempotencyKey: string, requestHash: string): Promise<TurnDecisionResponseV2 | null> {
    const existing = await this.prisma.decisionSubmission.findUnique({ where: { idempotencyKey }, include: { resolution: true } });
    if (!existing) return null;
    if (existing.runId !== roomId || existing.userId !== user.id || existing.requestHash !== requestHash) {
      throw new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED", message: "The idempotency key belongs to a different decision" });
    }
    if (!existing.resolution) throw new ConflictException({ code: "DECISION_IN_PROGRESS", message: "This decision is still resolving" });
    if (existing.resolution.qualityStatus !== "PASS" || !existing.resolution.resultNarrative.trim()) {
      throw new ServiceUnavailableException({
        code: "STORY_GENERATION_IN_PROGRESS",
        message: "行动后果已经确认，真实结果剧情仍在独立生成；系统没有返回空白或模板故事。",
        recoverable: true,
        resolutionId: existing.resolution.id,
        appliedWorldSequence: existing.resolution.appliedWorldSequence
      });
    }
    return {
      accepted: true,
      resolution: {
        id: existing.resolution.id,
        appliedWorldSequence: existing.resolution.appliedWorldSequence,
        resultNarrative: existing.resolution.resultNarrative,
        nextHook: existing.resolution.nextHook
      },
      gameProjection: await this.game(user, roomId)
    };
  }

  private guardUnknownPrivateFacts(customAction: string, facts: Array<{ visibility: string; knownByRoleIdsJson: unknown; content: string }>, roleId: string) {
    const normalized = customAction.replace(/\s+/g, "");
    const violation = facts.find((fact) => fact.visibility === "role_private"
      && !stringList(fact.knownByRoleIdsJson).includes(roleId)
      && privateFactAnchors(fact.content).some((anchor) => normalized.includes(anchor)));
    if (violation) throw new BadRequestException({ code: "GUARD_REJECTED", message: "The role cannot use another role's private knowledge", issues: ["UNKNOWN_PRIVATE_FACT"] });
  }

  private requireV2(engineVersion: string) {
    if (engineVersion !== CONTINUOUS_STORY_ENGINE_VERSION) throw new ConflictException({ code: "CONTINUOUS_STORY_V2_REQUIRED", message: "This room does not use independent story threads" });
  }

  private async serializable<T>(operation: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 45_000 });
      } catch (error: any) {
        if (error instanceof DecisionContextMovedError) throw error;
        if (!isRetryableSerializableError(error) || attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
    throw new Error("unreachable serializable retry state");
  }
}

export function isRetryableSerializableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code || "");
  return code === "P2034" || code === "P2002" || code === "P2028";
}

function roleContext(role: StoryRole): StoryRoleContext {
  return {
    id: role.id, roleKey: role.roleKey, roleName: role.roleName, identity: role.identity,
    publicInfo: role.publicInfo, hiddenSecret: role.hiddenSecret, personalGoal: role.personalGoal,
    currentState: role.currentState, abilityText: role.abilityText, cannotDo: stringList(role.cannotDoJson)
  };
}

function visibleFactsForRole(facts: Array<{ factKey: string; content: string; visibility: string; knownByRoleIdsJson: unknown }>, roleId: string): VisibleFact[] {
  return facts
    .filter((fact) => fact.visibility === "public" || stringList(fact.knownByRoleIdsJson).includes(roleId))
    .map((fact) => ({ factKey: fact.factKey, content: fact.content }));
}

function factAudience(visibility: ResolvedStoryAction["visibility"], action: ResolvedStoryAction, actorRoleId: string, allRoleIds: string[], affectedRoleIds: string[]) {
  if (visibility === "PUBLIC" || visibility === "OBSERVABLE") return allRoleIds;
  if (visibility === "PRIVATE") return [actorRoleId];
  return uniqueStrings([actorRoleId, action.targetRoleId, ...affectedRoleIds].filter((id): id is string => Boolean(id)));
}

function controlProjection(control: { roleId: string; mode: string; epoch: number }) {
  return {
    roleId: control.roleId,
    mode: control.mode,
    presence: control.mode === "AI_ACTIVE" ? "AI_CONTROLLED" as const : control.mode === "HUMAN_ACTIVE" ? "ONLINE" as const : "ABSENT" as const,
    epoch: control.epoch
  };
}

function validateHeartbeatCommand(command: HeartbeatCommandV1) {
  if (typeof command?.sessionInstanceId !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(command.sessionInstanceId)) throw invalidCommand("sessionInstanceId is invalid");
  if (!Number.isSafeInteger(command.heartbeatSequence) || command.heartbeatSequence < 1) throw invalidCommand("heartbeatSequence must be positive");
  if (!Number.isSafeInteger(command.lastAppliedDeliverySequence) || command.lastAppliedDeliverySequence < 0) throw invalidCommand("lastAppliedDeliverySequence must be non-negative");
}

function validateControlCommand(command: ControlCommandV1) {
  if (typeof command?.idempotencyKey !== "string" || !/^[A-Za-z0-9:._-]{1,160}$/.test(command.idempotencyKey)) throw invalidCommand("idempotencyKey is invalid");
  if (!Number.isSafeInteger(command.expectedControlEpoch) || command.expectedControlEpoch < 1) throw invalidCommand("expectedControlEpoch must be positive");
}

function invalidCommand(message: string) {
  return new BadRequestException({ code: "INVALID_COMMAND", message });
}

function idempotencyReused() {
  return new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED", message: "The idempotency key belongs to a different command" });
}

function controlChanged() {
  return new ConflictException({ code: "ROLE_CONTROL_CHANGED", message: "Role control changed; refresh the current story" });
}

function bindDecisionTargets<T extends { decisions: DecisionCandidateV2[] }>(draft: T, roles: StoryRole[], roleStage: StorySituationInput["roleStage"]): T {
  const cardByKey = new Map(roleStage.mainCards.map((card) => [card.actionKey, card]));
  return {
    ...draft,
    decisions: draft.decisions.map((decision) => {
      if (!decision.actionKey) {
        const target = decision.intentDraft.target.type === "ROLE"
          ? roles.find((role) => role.id === decision.intentDraft.target.id || role.roleKey === decision.intentDraft.target.id) || null
          : null;
        const intentDraft = target
          ? { ...decision.intentDraft, target: { ...decision.intentDraft.target, id: target.id, label: target.roleName } }
          : decision.intentDraft;
        return {
          ...decision,
          targetRoleId: target?.id || null,
          targetRoleName: target?.roleName || null,
          intentDraft
        };
      }
      const targetKey = decision.actionKey ? cardByKey.get(decision.actionKey)?.targetRoleKey : null;
      const target = targetKey ? roles.find((role) => role.roleKey === targetKey) : null;
      const intentDraft = target && decision.intentDraft.target.type === "ROLE"
        ? { ...decision.intentDraft, target: { ...decision.intentDraft.target, id: target.id, label: target.roleName } }
        : decision.intentDraft;
      return { ...decision, targetRoleId: target?.id || null, targetRoleName: target?.roleName || null, intentDraft };
    })
  };
}

function asDecisionCandidates(value: unknown): DecisionCandidateV2[] {
  return Array.isArray(value) ? value.filter((candidate): candidate is DecisionCandidateV2 => Boolean(candidate && typeof candidate === "object" && typeof (candidate as any).id === "string" && typeof (candidate as any).label === "string")) : [];
}

const DECISION_FORMS = new Set<DecisionFormV2>(["STORY_CHOICE", "CONVERSATION", "INVESTIGATION", "LEVERAGE", "CUSTOM_PLAN"]);

function playerActionTypeForDecision(command: Pick<TurnDecisionCommandV2, "decisionForm">, source: PlannedIntentAction["source"]) {
  const form = command.decisionForm || "STORY_CHOICE";
  if (form === "CONVERSATION") return "conversation";
  if (form === "INVESTIGATION") return "investigation";
  if (form === "LEVERAGE") return "leverage";
  if (form === "CUSTOM_PLAN") return "custom_plan";
  return source === "SUGGESTED" ? "choose" : "custom";
}

function decisionFormFromActionType(actionType: string): DecisionFormV2 {
  if (actionType === "conversation") return "CONVERSATION";
  if (actionType === "investigation") return "INVESTIGATION";
  if (actionType === "leverage") return "LEVERAGE";
  if (actionType === "custom_plan") return "CUSTOM_PLAN";
  return "STORY_CHOICE";
}

function validateCommand(command: TurnDecisionCommandV2) {
  if (!command || typeof command !== "object") throw new BadRequestException({ code: "INVALID_COMMAND", message: "Decision command is required" });
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(String(command.idempotencyKey || ""))) throw new BadRequestException({ code: "INVALID_COMMAND", message: "A valid idempotencyKey is required" });
  if (!Number.isInteger(command.turnRevision) || command.turnRevision < 1) throw new BadRequestException({ code: "INVALID_COMMAND", message: "turnRevision must be a positive integer" });
  if (!Number.isInteger(command.controlEpoch) || command.controlEpoch < 1) throw new BadRequestException({ code: "INVALID_COMMAND", message: "controlEpoch must be a positive integer" });
  const candidate = typeof command.candidateId === "string" && command.candidateId.trim().length > 0;
  const custom = typeof command.customAction === "string" && command.customAction.trim().length > 0;
  if (candidate === custom) throw new BadRequestException({ code: "INVALID_COMMAND", message: "Choose exactly one suggested decision or custom action" });
  if (custom && (command.customAction!.trim().length < 6 || command.customAction!.trim().length > 1200)) {
    throw new BadRequestException({ code: "INVALID_COMMAND", message: "自定义行动必须用 6 至 1200 个字符写清具体做法。" });
  }
  if (!command.intent || typeof command.intent !== "object" || Array.isArray(command.intent)) {
    throw new BadRequestException({ code: "INVALID_COMMAND", message: "必须提交完整的玩家意图。" });
  }
  const intent = normalizePlayerIntentV2(command.intent);
  if (!intent.objective || !intent.method || !intent.target.id || !intent.target.label) {
    throw new BadRequestException({ code: "INVALID_COMMAND", message: "玩家意图必须包含目标、对象和具体方法。" });
  }
  if (!Array.isArray(command.intent.leverageKeys)) {
    throw new BadRequestException({ code: "INVALID_COMMAND", message: "leverageKeys 必须是数组。" });
  }
  if (command.decisionForm && !DECISION_FORMS.has(command.decisionForm)) {
    throw new BadRequestException({ code: "INVALID_COMMAND", message: "decisionForm 不是受支持的玩家决策形式。" });
  }
  if (command.interactionId && !/^[A-Za-z0-9_-]{8,160}$/.test(command.interactionId)) {
    throw new BadRequestException({ code: "INVALID_COMMAND", message: "interactionId is invalid" });
  }
}

// Solo v2 has already passed the context-aware Writer/Decision publication
// pipeline immediately above. The legacy item scorer relies on literal word
// overlap with fixed cards and may reject valid generated prose, causing the
// entire model pipeline to rerun. Keep it as an audit signal for other modes;
// for Solo, the new pipeline is the publication authority.
function acceptPipelineVerifiedSoloReview(review: ContentReview, solo: boolean): ContentReview {
  return solo && review.status !== "PASS"
    ? { ...review, status: "PASS", issues: [] }
    : review;
}

function assertQuality(review: ContentReview, code: string) {
  if (review.status !== "PASS") throw new ConflictException({ code, message: "Generated story content failed the item-level quality gate", issues: review.issues, scores: review.scores });
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)].sort();
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function impactTaskPayload(value: unknown): ImpactTaskPayloadV2 {
  const payload = jsonRecord(value);
  const action = jsonRecord(payload.action);
  const mode = payload.mode;
  if (typeof payload.sourceRoleId !== "string"
    || typeof payload.sourceRoleName !== "string"
    || typeof payload.targetRoleId !== "string"
    || typeof payload.targetRoleName !== "string"
    || typeof payload.playerActionId !== "string"
    || !Number.isInteger(payload.stageIndex)
    || !Number.isInteger(payload.appliedWorldSequence)
    || (mode !== "FULL" && mode !== "TRACE")
    || typeof action.receiptText !== "string"
    || !Array.isArray(action.effectFactKeys)
    || !action.normalizedIntent) {
    throw new ConflictException({ code: "IMPACT_TASK_INVALID", message: "Impact task payload is incomplete" });
  }
  return payload as unknown as ImpactTaskPayloadV2;
}

function resultTaskPayload(value: unknown): ResultTaskPayloadV2 {
  const payload = jsonRecord(value);
  const action = jsonRecord(payload.action);
  const stageProgress = jsonRecord(payload.stageProgress);
  if ((payload.actorKind !== "HUMAN" && payload.actorKind !== "AI")
    || !Number.isInteger(payload.controlEpoch)
    || typeof action.receiptText !== "string"
    || !action.normalizedIntent
    || typeof stageProgress.stageAdvanced !== "boolean"
    || !(stageProgress.nextStageIndex === null || Number.isInteger(stageProgress.nextStageIndex))
    || typeof stageProgress.reason !== "string"
    || !Array.isArray(stageProgress.evidenceFactKeys)) {
    throw new ConflictException({ code: "RESULT_TASK_INVALID", message: "Result task payload is incomplete" });
  }
  return payload as unknown as ResultTaskPayloadV2;
}

function exceptionResponseCode(error: unknown): string | null {
  if (!error || typeof (error as { getResponse?: unknown }).getResponse !== "function") return null;
  const response = (error as { getResponse: () => unknown }).getResponse();
  return typeof response === "object" && response !== null && typeof (response as { code?: unknown }).code === "string"
    ? String((response as { code: string }).code)
    : null;
}

function isPermanentStoryGenerationFailure(error: unknown) {
  if (!error || typeof (error as { getResponse?: unknown }).getResponse !== "function") return false;
  const response = (error as { getResponse: () => unknown }).getResponse();
  if (!response || typeof response !== "object") return false;
  const payload = response as { code?: unknown; recoverable?: unknown };
  return payload.recoverable === false && ["STORY_GENERATION_REJECTED", "OPENING_STORY_GENERATION_REJECTED"].includes(String(payload.code || ""));
}

function privateFactAnchors(content: string) {
  return content.split(/[，。；、：:\s]/).map((item) => item.trim()).filter((item) => item.length >= 6).slice(0, 8);
}

function narrativeKind(entryType: string): "OPENING" | "RESULT" | "CROSS_IMPACT" | "OBSERVABLE_TRACE" | "NEXT_SITUATION" | "ENDING" {
  if (entryType === "V2_RESULT") return "RESULT";
  if (entryType === "V2_CROSS_IMPACT") return "CROSS_IMPACT";
  if (entryType === "V2_OBSERVABLE_TRACE") return "OBSERVABLE_TRACE";
  if (entryType === "V2_NEXT_SITUATION") return "NEXT_SITUATION";
  if (entryType === "V2_ENDING") return "ENDING";
  return "OPENING";
}

function narrativeTitle(entryType: string) {
  if (entryType === "V2_RESULT") return "你的行动带来的结果";
  if (entryType === "V2_CROSS_IMPACT") return "另一位角色改变了你的局势";
  if (entryType === "V2_OBSERVABLE_TRACE") return "你观察到的行动痕迹";
  if (entryType === "V2_NEXT_SITUATION") return "接下来的局势";
  if (entryType === "V2_ENDING") return "你的角色结局";
  return "你所看到的局势";
}

function buildAvailableTargets(
  roles: StoryRole[],
  facts: VisibleFact[],
  assets: Array<{ assetKey: string; kind: string }>,
  stageIndex: number,
  templateKey: string
) {
  const locationLabel = getGameDefinition(templateKey).presentation.locationLabel;
  return [
    ...roles.map((role) => ({ type: "ROLE" as const, id: role.id, label: `${role.roleName}（${role.identity}）` })),
    ...facts.map((fact) => ({ type: "EVIDENCE" as const, id: fact.factKey, label: fact.content.slice(0, 54) })),
    ...assets.map((asset) => ({ type: "RESOURCE" as const, id: asset.assetKey, label: assetDisplayName(asset.assetKey) })),
    { type: "LOCATION" as const, id: `location:${locationLabel}`, label: locationLabel },
    { type: "PUBLIC_FRAME" as const, id: `stage:${stageIndex}`, label: `第${stageIndex}阶段的公共局势` }
  ];
}

function conditionMatches(rawValue: unknown, actorRoleId: string, action: PlannedIntentAction) {
  const condition = jsonRecord(rawValue);
  if (typeof condition.actorRoleId === "string" && condition.actorRoleId && condition.actorRoleId !== actorRoleId) return false;
  if (typeof condition.targetId === "string" && condition.targetId
    && condition.targetId !== action.normalizedIntent.target.id
    && !action.effectHooks.some((hook) => hook.includes(condition.targetId as string))) return false;
  const eventType = String(condition.eventType || "").trim();
  if (!eventType) return false;
  if (["ROLE_ACTION", "ANY_ROLE_ACTION", action.actionKey, ...action.effectHooks].includes(eventType)) return true;
  const normalizeEvent = (value: string) => value.toLowerCase().replace(/[\s，。；、：:,.!?！？“”"']/g, "");
  const event = normalizeEvent(eventType);
  const corpus = normalizeEvent([
    action.label,
    action.description,
    action.intent,
    action.receiptText,
    action.normalizedIntent.objective,
    action.normalizedIntent.method,
    action.normalizedIntent.target.label,
    ...action.effectHooks
  ].join(" "));
  if (event.length >= 4 && corpus.includes(event)) return true;
  const anchors = eventType.split(/[，。；、：:\s]/).map((part) => normalizeEvent(part)).filter((part) => part.length >= 4);
  return anchors.length > 0 && anchors.every((anchor) => corpus.includes(anchor));
}


function isSoloNpcRun(
  run: { id: string; maxPlayers: number; stateJson?: unknown },
  parsedState: ReturnType<typeof roomState> = roomState(run.stateJson)
) {
  if (run.maxPlayers !== 1) return false;
  return parsedState.room?.solo === true || run.id.startsWith("solo_");
}
function roomState(value: unknown): { room?: { readyUserIds?: string[]; hostRoleLocked?: boolean; minPlayers?: number; solo?: boolean } } {
  return value && typeof value === "object" && !Array.isArray(value) ? value as any : {};
}
