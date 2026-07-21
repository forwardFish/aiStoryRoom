import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  CONTINUOUS_ENGINE_VERSION,
  GAME_PROJECTION_SCHEMA_VERSION,
  RESULT_PROJECTION_SCHEMA_VERSION,
  validateGameProjectionV1,
  type GameProjectionV1,
  type PublicRoleControllerStateV1,
  type ResultProjectionV1,
  type RoleControlProjectionV1
} from "@ai-story/shared";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { CreditsService } from "../credits/credits.service";
import { CreditConsumptionService } from "../credits/credit-consumption.service";
import { readCreditConsumptionConfig } from "../config/credit-consumption.config";
import { parseRunBilling } from "../credits/credit-policy";
import { PrismaService } from "../prisma.service";
import { ContinuousStrategyContentService } from "./content.service";

@Injectable()
export class MemberProjectionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(CreditConsumptionService) private readonly creditConsumption: CreditConsumptionService,
    @Inject(ContinuousStrategyContentService) private readonly content: ContinuousStrategyContentService
  ) {}

  async game(user: AuthenticatedUser, roomId: string): Promise<GameProjectionV1> {
    const run = await this.prisma.storyRun.findUnique({
      where: { id: roomId },
      include: {
        roles: { orderBy: { createdAt: "asc" } },
        players: { where: { status: "active" }, include: { user: true, role: true }, orderBy: { joinedAt: "asc" } },
        roleControls: { include: { role: true }, orderBy: { createdAt: "asc" } },
        worldUnlock: true
      }
    });
    if (!run || run.mode !== "room") throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    if (run.engineVersion !== CONTINUOUS_ENGINE_VERSION) {
      throw new ConflictException({ code: "CONTINUOUS_ENGINE_REQUIRED", message: "This room uses the legacy projection" });
    }
    const gameContent = this.content.forGame(run.templateKey, run.strategyVersion);
    const membership = run.players.find((player) => player.userId === user.id);
    if (!membership?.roleId || !membership.role) throw new ForbiddenException({ code: "ROOM_MEMBERSHIP_REQUIRED", message: "Room membership and a playable role are required" });
    if (!gameContent.isPlayableRoleKey(membership.role.roleKey)) throw new ForbiddenException({ code: "ROLE_FORBIDDEN", message: "The assigned role is not a registered player role" });
    if (!["playing", "resolving", "chapter_generated", "WAITING_FOR_HUMAN_UNLOCK"].includes(run.status)) {
      throw new ConflictException({ code: "ROOM_NOT_STARTED", message: "The room has not started" });
    }

    const [node, window, cursor, myActions, recentDeliveries, latestPublicResult, latestPersonalResult] = await Promise.all([
      run.currentNodeId ? this.prisma.sceneNode.findUnique({ where: { id: run.currentNodeId } }) : null,
      this.prisma.actionWindow.findFirst({
        where: { runId: roomId },
        orderBy: { createdAt: "desc" },
        include: {
          participants: true,
          openingProjections: { where: { roleId: membership.roleId } },
          interactionRequests: {
            where: { targetRoleId: membership.roleId, status: "OPEN" },
            orderBy: { priority: "desc" },
            include: {
              sourceAction: {
                select: { method: true, role: { select: { roleName: true } } }
              }
            }
          }
        }
      }),
      this.prisma.eventDeliveryCursor.findUnique({ where: { roomId_userId: { roomId, userId: user.id } } }),
      this.prisma.playerAction.findMany({
        where: { runId: roomId, roleId: membership.roleId },
        orderBy: { createdAt: "desc" }, take: 30,
        select: {
          id: true, nodeId: true, actionSlot: true, actionKey: true, targetRoleId: true, leverageKey: true,
          status: true, actorKind: true, immediateJson: true, resolvedJson: true, sealedAt: true
        }
      }),
      this.prisma.eventDelivery.findMany({
        where: { roomId, userId: user.id }, orderBy: { deliverySequence: "desc" }, take: 20,
        select: { deliverySequence: true, payloadJson: true, deliveredAt: true }
      }),
      this.prisma.narrativeEntry.findFirst({
        where: { runId: roomId, entryType: { in: ["stage_public_result", "final_public_ending"] }, visibility: "public" },
        orderBy: { createdAt: "desc" }, select: { id: true, content: true, factKeysJson: true, createdAt: true }
      }),
      this.prisma.narrativeEntry.findFirst({
        where: { runId: roomId, roleId: membership.roleId, entryType: { in: ["stage_personal_result", "final_personal_ending"] } },
        orderBy: { createdAt: "desc" }, select: { id: true, content: true, factKeysJson: true, createdAt: true }
      })
    ]);
    if (!window || !node) throw new ConflictException({ code: "ACTION_WINDOW_NOT_READY", message: "The opening action window is not ready" });
    const stageIndex = node.nodeIndex;
    const stage = gameContent.stage(stageIndex);
    const roleStage = gameContent.roleStage(stageIndex, membership.role.roleKey);
    const participant = window.participants.find((entry) => entry.roleId === membership.roleId);
    const myControlRecord = run.roleControls.find((entry) => entry.roleId === membership.roleId);
    if (!participant || !myControlRecord) throw new ConflictException({ code: "ROLE_CONTROL_NOT_READY", message: "Role control is not initialized" });
    const roleIdByKey = new Map(run.roles.map((role) => [role.roleKey, role.id]));
    const myControl = roleControlProjection(myControlRecord);
    const canHumanAct = myControlRecord.mode === "HUMAN_ACTIVE" || myControlRecord.mode === "HUMAN_OFFLINE_GRACE";
    const availableMainActions = window.status === "MAIN_OPEN" && participant.mainStatus === "PENDING" && canHumanAct
      ? roleStage.mainCards.map((card) => ({
          actionKey: card.actionKey,
          title: card.title,
          description: card.objective,
          targetRoleIds: card.targetRoleKey ? [roleIdByKey.get(card.targetRoleKey)].filter(Boolean) as string[] : [],
          leverageKeys: card.assetMutations.map((mutation) => mutation.assetKey)
        }))
      : [];
    const maneuver = gameContent.maneuver(stageIndex, membership.role.roleKey);
    const availableManeuvers = window.status === "INTERACTION_GRACE" && participant.maneuverStatus === "AVAILABLE" && canHumanAct && maneuver
      ? [{
          actionKey: maneuver.maneuverStrategyKey,
          title: maneuver.title,
          description: maneuver.objective,
          targetRoleIds: maneuver.allowedTargetRoleKeys.map((key) => roleIdByKey.get(key)).filter(Boolean) as string[],
          leverageKeys: maneuver.leverageAssetKeys
        }]
      : [];
    const pendingRequest = window.interactionRequests[0];
    const reaction = pendingRequest ? gameContent.reaction(stageIndex, membership.role.roleKey) : undefined;
    const freeRounds = Number(process.env.CREDIT_FREE_DECISION_LIMIT || 3);
    const requiredCredits = Number(process.env.CREDIT_STANDARD_WORLD_COST || 100);
    const creditConfig = readCreditConsumptionConfig();
    const billing = parseRunBilling(run, creditConfig.prices);
    const activeActionBilling = billing.policyVersion === "active_action_v1";
    const unlocked = activeActionBilling || run.accessLevel === "UNLOCKED";
    const requiresUnlock = !activeActionBilling && !unlocked && stageIndex > freeRounds;
    const accessState = unlocked ? "UNLOCKED" : requiresUnlock ? "REQUIRES_UNLOCK" : "FREE";
    const [balance, creditAvailability, sponsorshipRequest] = await Promise.all([
      requiresUnlock ? this.credits.getBalance(user.id) : Promise.resolve(null),
      this.creditConsumption.availableForRun(run.id, user.id),
      (this.prisma as any).sponsorshipRequest.findFirst({ where: { runId: run.id, beneficiaryUserId: user.id }, orderBy: { createdAt: "desc" } })
    ]);
    const resultReady = run.status === "chapter_generated" && Boolean(latestPublicResult && latestPersonalResult);
    const projection: GameProjectionV1 = {
      schemaVersion: GAME_PROJECTION_SCHEMA_VERSION,
      projectionRevision: Math.max(1, run.version),
      appliedThroughDeliverySequence: Math.max(0, (cursor?.nextSequence || 1) - 1),
      generatedAt: run.updatedAt.toISOString(),
      roomSummary: {
        id: run.id,
        title: run.title,
        worldId: run.templateKey,
        ownerUserId: run.ownerUserId,
        players: run.players.map((player) => ({
          userId: player.userId,
          nickname: player.user?.nickname || "Player",
          roleId: player.roleId,
          roleKey: player.role?.roleKey || null,
          roleName: player.role?.roleName || null
        }))
      },
      run: {
        runId: run.id,
        engineVersion: run.engineVersion,
        strategyVersion: run.strategyVersion,
        status: run.status,
        stageIndex
      },
      currentNode: {
        id: node.id,
        stageIndex,
        stageKey: stage.stageKey,
        title: stage.title,
        publicNarration: node.publicNarration,
        commonContest: stage.commonContest
      },
      actionWindow: {
        id: window.id,
        status: window.status as GameProjectionV1["actionWindow"] extends infer T ? any : never,
        openingSnapshotVersion: window.openingSnapshotVersion,
        mainOpenedAt: window.mainOpenedAt?.toISOString() || null,
        mainClosesAt: window.mainClosesAt?.toISOString() || null,
        graceOpenedAt: window.graceOpenedAt?.toISOString() || null,
        graceMinClosesAt: window.graceMinClosesAt?.toISOString() || null,
        graceClosesAt: window.graceClosesAt?.toISOString() || null,
        myParticipant: {
          mainStatus: participant.mainStatus,
          maneuverStatus: participant.maneuverStatus,
          reactionStatus: participant.reactionStatus,
          doneAt: participant.doneAt?.toISOString() || null
        }
      },
      serverNow: new Date().toISOString(),
      player: {
        userId: user.id,
        playerId: membership.id,
        roleId: membership.roleId,
        roleKey: membership.role.roleKey,
        roleName: membership.role.roleName,
        identity: membership.role.identity,
        publicInfo: membership.role.publicInfo,
        personalGoal: membership.role.personalGoal,
        abilityText: membership.role.abilityText
      },
      myControl,
      roleControllerStates: run.roleControls.map((control) => publicRoleControllerState(control)),
      privateBrief: {
        text: roleStage.privateBrief,
        personalPressure: roleStage.personalPressure,
        openingSnapshotVersion: window.openingProjections[0]?.snapshotVersion || window.openingSnapshotVersion
      },
      availableMainActions,
      myActions: myActions.map((action) => ({
        id: action.id,
        nodeId: action.nodeId,
        actionSlot: action.actionSlot,
        actionKey: action.actionKey,
        targetRoleId: action.targetRoleId,
        leverageKey: action.leverageKey,
        status: action.status,
        actorKind: action.actorKind,
        immediateFeedback: action.immediateJson,
        resolved: action.resolvedJson,
        sealedAt: action.sealedAt?.toISOString() || null
      })),
      availableManeuvers,
      pendingReaction: pendingRequest && reaction ? {
        eventId: pendingRequest.id,
        sourceRoleName: pendingRequest.sourceAction.role?.roleName || "另一名角色",
        triggerActionTitle: playerFacingActionTitle(pendingRequest.sourceAction.method),
        expiresAt: pendingRequest.expiresAt.toISOString(),
        options: reaction.responseOptions.map((option) => ({ actionKey: option.actionKey, title: option.title }))
      } : null,
      observableTraces: recentDeliveries.map((delivery) => ({
        deliverySequence: delivery.deliverySequence,
        deliveredAt: delivery.deliveredAt.toISOString(),
        ...(delivery.payloadJson as Record<string, unknown>)
      })),
      observablePlayerStates: window.participants.map((entry) => ({
        roleId: entry.roleId,
        decisionState: entry.mainStatus === "PENDING" ? "THINKING" : "DECIDED",
        layoutDone: Boolean(entry.doneAt)
      })),
      latestPersonalResult: latestPersonalResult ? {
        id: latestPersonalResult.id,
        content: latestPersonalResult.content,
        factIds: latestPersonalResult.factKeysJson,
        createdAt: latestPersonalResult.createdAt.toISOString()
      } : null,
      latestPublicResult: latestPublicResult ? {
        id: latestPublicResult.id,
        content: latestPublicResult.content,
        factIds: latestPublicResult.factKeysJson,
        createdAt: latestPublicResult.createdAt.toISOString()
      } : null,
      access: {
        state: accessState,
        requiresUnlock,
        requiredCredits: activeActionBilling ? 0 : requiredCredits,
        canCurrentUserUnlock: requiresUnlock && Number(balance?.available || 0) >= requiredCredits,
        ...(unlocked && run.worldUnlock?.paidByUserId ? { payerUserId: run.worldUnlock.paidByUserId } : {}),
        unlockEndpoint: activeActionBilling ? null : `/api/v4/story-runs/${run.id}/unlock`
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
        canRequestSponsor: activeActionBilling && run.ownerUserId !== user.id && !resultReady,
        sponsorshipRequestStatus: sponsorshipRequest?.status || "NONE"
      },
      resultReady,
      resultUrl: resultReady ? `/game/result?runId=${encodeURIComponent(run.id)}` : null
    };
    const validation = validateGameProjectionV1(projection);
    if (!validation.ok) throw new Error(`GAME_PROJECTION_SCHEMA_VIOLATION:${validation.errors.join("|")}`);
    return projection;
  }

  async result(user: AuthenticatedUser, roomId: string): Promise<ResultProjectionV1> {
    const game = await this.game(user, roomId);
    if (!game.resultReady) throw new ConflictException({ code: "RESULT_NOT_READY", message: "The published result is not ready" });
    const roleId = String(game.player.roleId);
    const [publicEnding, personalEnding, actions, transitions] = await Promise.all([
      this.prisma.narrativeEntry.findFirstOrThrow({ where: { runId: roomId, entryType: "final_public_ending", visibility: "public" }, orderBy: { createdAt: "desc" } }),
      this.prisma.narrativeEntry.findFirstOrThrow({ where: { runId: roomId, roleId, entryType: "final_personal_ending" }, orderBy: { createdAt: "desc" } }),
      this.prisma.playerAction.findMany({
        where: { runId: roomId, roleId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          chapterIndex: true,
          node: { select: { nodeIndex: true } },
          actionSlot: true,
          method: true,
          actorKind: true,
          resolvedJson: true
        }
      }),
      this.prisma.roleControlTransition.findMany({ where: { roleControl: { runId: roomId, roleId } }, orderBy: { createdAt: "asc" } })
    ]);
    return {
      schemaVersion: RESULT_PROJECTION_SCHEMA_VERSION,
      roomSummary: game.roomSummary,
      run: {
        runId: roomId,
        engineVersion: game.run.engineVersion,
        strategyVersion: game.run.strategyVersion,
        completedAt: publicEnding.createdAt.toISOString()
      },
      publicEnding: { content: publicEnding.content, factIds: publicEnding.factKeysJson },
      personalEnding: { roleId, content: personalEnding.content, factIds: personalEnding.factKeysJson },
      myKeyDecisions: actions
        .filter((action) => ["MAIN", "MANEUVER", "REACTION"].includes(String(action.actionSlot)))
        .map(playerFacingResultDecision),
      authorizedCrossImpacts: actions.flatMap((action) => {
        const resolved = action.resolvedJson as Record<string, unknown> | null;
        return Array.isArray(resolved?.influenceEdges) ? resolved.influenceEdges as Record<string, unknown>[] : [];
      }),
      myControlTimeline: transitions
        .filter((entry) => isControllerChange(entry.fromMode, entry.toMode))
        .map((entry) => ({
          fromMode: entry.fromMode,
          toMode: entry.toMode,
          fromEpoch: entry.fromEpoch,
          toEpoch: entry.toEpoch,
          reason: entry.reason,
          createdAt: entry.createdAt.toISOString()
        })),
      creditsSummary: { accessState: game.access.state }
    };
  }
}

export function playerFacingResultDecision(action: {
  chapterIndex: number;
  node?: { nodeIndex: number } | null;
  actionSlot: string | null;
  method: string | null;
  actorKind: string | null;
}) {
  const rawTitle = String(action.method || "").replace(/\s+/g, " ").trim().slice(0, 80);
  const internalKey = /\b(?:main|maneuver|reaction|system|state|asset|global|personal|internal)_[a-z0-9_]+\b/i;
  return {
    stageIndex: action.node?.nodeIndex ?? action.chapterIndex,
    slot: action.actionSlot,
    title: rawTitle && !internalKey.test(rawTitle) ? rawTitle : "已完成的角色行动",
    actorKind: action.actorKind || "SYSTEM"
  };
}

export function playerFacingActionTitle(value: unknown): string {
  const title = typeof value === "string" ? value.trim() : "";
  return title && !/\b(?:main|maneuver|reaction|system|state|asset|global|personal|internal)_[a-z0-9_]+\b/i.test(title)
    ? title
    : "一项需要你回应的行动";
}

export function isControllerChange(fromMode: string, toMode: string): boolean {
  return controllerKind(fromMode) !== controllerKind(toMode);
}

function controllerKind(mode: string): "HUMAN" | "AI" | "SYSTEM" | "UNKNOWN" {
  if (mode === "HUMAN_ACTIVE" || mode === "HUMAN_OFFLINE_GRACE") return "HUMAN";
  if (mode === "AI_ACTIVE" || mode === "HUMAN_RECLAIM_PENDING") return "AI";
  if (mode === "SYSTEM") return "SYSTEM";
  return "UNKNOWN";
}

export function roleControlProjection(control: {
  roleId: string;
  mode: string;
  epoch: number;
  reclaimAfterWindowId: string | null;
}): RoleControlProjectionV1 {
  const presence = control.mode === "SYSTEM"
    ? "SYSTEM"
    : control.mode === "AI_ACTIVE" || control.mode === "HUMAN_RECLAIM_PENDING"
      ? "AI_CONTROLLED"
      : control.mode === "HUMAN_ACTIVE"
        ? "ONLINE"
        : "ABSENT";
  return {
    roleId: control.roleId,
    mode: control.mode as RoleControlProjectionV1["mode"],
    presence,
    epoch: control.epoch,
    reclaimPolicy: control.mode === "AI_ACTIVE" ? "IMMEDIATE" : control.mode === "HUMAN_RECLAIM_PENDING" ? "NEXT_WINDOW" : "NOT_AVAILABLE",
    effectiveFromSlot: control.reclaimAfterWindowId
  };
}

export function publicRoleControllerState(control: { roleId: string; mode: string }): PublicRoleControllerStateV1 {
  if (control.mode === "SYSTEM") return { roleId: control.roleId, controllerKind: "SYSTEM", presence: "SYSTEM" };
  if (control.mode === "AI_ACTIVE" || control.mode === "HUMAN_RECLAIM_PENDING") {
    return { roleId: control.roleId, controllerKind: "AI", presence: "AI_CONTROLLED" };
  }
  return {
    roleId: control.roleId,
    controllerKind: "HUMAN",
    presence: control.mode === "HUMAN_OFFLINE_GRACE" ? "ABSENT" : "ONLINE"
  };
}
