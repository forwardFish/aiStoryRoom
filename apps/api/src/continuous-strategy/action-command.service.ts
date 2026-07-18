import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CommandResponseV1,
  ControlCommandV1,
  HeartbeatCommandV1,
  HeartbeatResponseV1,
  LayoutCommandV1,
  SlotCommandV1
} from "@ai-story/shared";
import { CONTINUOUS_ENGINE_VERSION } from "@ai-story/shared";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { PrismaService } from "../prisma.service";
import { sha256Canonical } from "./canonical";
import { ContinuousStrategyContentService, type BoundContinuousStrategyContent } from "./content.service";
import { ContinuousEventDeliveryService } from "./event-delivery.service";
import { MemberProjectionService } from "./member-projection.service";
import { RoleAgentTaskService } from "./role-agent-task.service";
import { roomSerializableTransaction } from "./room-transaction";

type Tx = Prisma.TransactionClient;
type Slot = "MAIN" | "MANEUVER" | "REACTION";

@Injectable()
export class ActionCommandService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ContinuousStrategyContentService) private readonly content: ContinuousStrategyContentService,
    @Inject(ContinuousEventDeliveryService) private readonly deliveries: ContinuousEventDeliveryService,
    @Inject(MemberProjectionService) private readonly projections: MemberProjectionService,
    @Inject(RoleAgentTaskService) private readonly roleAgents: RoleAgentTaskService
  ) {}

  submitMain(user: AuthenticatedUser, roomId: string, command: SlotCommandV1): Promise<CommandResponseV1> {
    return this.submitSlot(user, roomId, "MAIN", command);
  }

  submitManeuver(user: AuthenticatedUser, roomId: string, command: SlotCommandV1): Promise<CommandResponseV1> {
    return this.submitSlot(user, roomId, "MANEUVER", command);
  }

  async submitReaction(user: AuthenticatedUser, roomId: string, eventId: string, command: SlotCommandV1): Promise<CommandResponseV1> {
    this.requireIdentifier(eventId, "eventId");
    return this.submitSlot(user, roomId, "REACTION", command, eventId);
  }

  async done(user: AuthenticatedUser, roomId: string, command: LayoutCommandV1): Promise<CommandResponseV1> {
    await this.submitLayout(user, roomId, command, false);
    return { accepted: true, gameProjection: await this.projections.game(user, roomId) };
  }

  async leaveStage(user: AuthenticatedUser, roomId: string, command: LayoutCommandV1): Promise<CommandResponseV1> {
    await this.submitLayout(user, roomId, command, true);
    return { accepted: true, gameProjection: await this.projections.game(user, roomId) };
  }

  async handoff(user: AuthenticatedUser, roomId: string, command: ControlCommandV1): Promise<CommandResponseV1> {
    this.requireIdempotencyKey(command.idempotencyKey);
    this.requireEpoch(command.expectedControlEpoch);
    await this.serializable(roomId, async (tx) => {
      const context = await this.context(tx, user, roomId);
      const existing = await tx.roleControlTransition.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
      if (existing) {
        if (existing.roleControlId !== context.control.id || existing.fromEpoch !== command.expectedControlEpoch || existing.toMode !== "AI_ACTIVE") {
          throw this.idempotencyReused();
        }
        return;
      }
      if (context.control.humanPlayerId !== context.player.id) throw new ForbiddenException({ code: "ROLE_FORBIDDEN", message: "Only the original player can hand off this role" });
      if (context.control.epoch !== command.expectedControlEpoch) throw this.controlChanged();
      if (context.control.mode === "SYSTEM") throw new ForbiddenException({ code: "ROLE_FORBIDDEN", message: "The legacy world actor cannot be handed off" });
      const nextEpoch = context.control.epoch + 1;
      await tx.roleControl.update({
        where: { id: context.control.id },
        data: { mode: "AI_ACTIVE", epoch: nextEpoch, reason: "EXPLICIT_HANDOFF", takeoverAt: new Date(), offlineSince: null }
      });
      await tx.roleControlTransition.create({
        data: {
          roleControlId: context.control.id,
          fromMode: context.control.mode,
          toMode: "AI_ACTIVE",
          fromEpoch: context.control.epoch,
          toEpoch: nextEpoch,
          reason: "EXPLICIT_HANDOFF",
          initiatedByUserId: user.id,
          effectiveWindowId: context.window.id,
          effectiveSlot: this.nextOpenSlot(context.participant),
          idempotencyKey: command.idempotencyKey
        }
      });
      await this.roleAgents.enqueueForWindow(tx, context.window.id, context.role.id);
      await tx.storyRun.update({ where: { id: roomId }, data: { version: { increment: 1 } } });
      await this.deliveries.publish(tx, {
        runId: roomId,
        day: context.node.nodeIndex,
        type: "ROLE_CONTROL_CHANGED",
        visibility: "PUBLIC",
        audienceType: "ALL_MEMBERS",
        audienceUserIds: context.memberUserIds,
        audienceRoleIds: [context.role.id],
        payload: { roleId: context.role.id, controllerKind: "AI", presence: "AI_CONTROLLED" },
        dedupeKey: `ROLE_CONTROL_CHANGED:${command.idempotencyKey}`
      });
    });
    return { accepted: true, gameProjection: await this.projections.game(user, roomId) };
  }

  async reclaim(user: AuthenticatedUser, roomId: string, command: ControlCommandV1): Promise<CommandResponseV1> {
    this.requireIdempotencyKey(command.idempotencyKey);
    this.requireEpoch(command.expectedControlEpoch);
    await this.serializable(roomId, async (tx) => {
      const context = await this.context(tx, user, roomId);
      const existing = await tx.roleControlTransition.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
      if (existing) {
        if (existing.roleControlId !== context.control.id || existing.fromEpoch !== command.expectedControlEpoch) throw this.idempotencyReused();
        return;
      }
      if (context.control.humanPlayerId !== context.player.id) throw new ForbiddenException({ code: "ROLE_FORBIDDEN", message: "Only the original player can reclaim this role" });
      if (context.control.epoch !== command.expectedControlEpoch) throw this.controlChanged();
      if (context.control.mode !== "AI_ACTIVE" && context.control.mode !== "HUMAN_RECLAIM_PENDING") {
        throw new ConflictException({ code: "ROLE_CONTROL_CHANGED", message: "The role is not currently AI controlled" });
      }
      const nextSlot = this.nextOpenSlot(context.participant);
      const aiAlreadySealed = await tx.playerAction.findFirst({
        where: { nodeId: context.node.id, roleId: context.role.id, actionSlot: nextSlot, actorKind: "AI_TAKEOVER", sealedAt: { not: null } }
      });
      const immediate = !aiAlreadySealed;
      const nextEpoch = context.control.epoch + 1;
      const toMode = immediate ? "HUMAN_ACTIVE" : "HUMAN_RECLAIM_PENDING";
      await tx.roleControl.update({
        where: { id: context.control.id },
        data: {
          mode: toMode,
          epoch: nextEpoch,
          reason: immediate ? "PLAYER_RECLAIMED" : "PLAYER_RECLAIM_SCHEDULED",
          reclaimAfterWindowId: immediate ? null : context.window.id,
          lastHeartbeatAt: new Date()
        }
      });
      await tx.roleControlTransition.create({
        data: {
          roleControlId: context.control.id,
          fromMode: context.control.mode,
          toMode,
          fromEpoch: context.control.epoch,
          toEpoch: nextEpoch,
          reason: immediate ? "PLAYER_RECLAIMED" : "PLAYER_RECLAIM_SCHEDULED",
          initiatedByUserId: user.id,
          effectiveWindowId: context.window.id,
          effectiveSlot: immediate ? nextSlot : "NEXT_WINDOW",
          idempotencyKey: command.idempotencyKey
        }
      });
      await tx.storyRun.update({ where: { id: roomId }, data: { version: { increment: 1 } } });
      if (immediate) {
        await this.deliveries.publish(tx, {
          runId: roomId,
          day: context.node.nodeIndex,
          type: "ROLE_CONTROL_CHANGED",
          visibility: "PUBLIC",
          audienceType: "ALL_MEMBERS",
          audienceUserIds: context.memberUserIds,
          audienceRoleIds: [context.role.id],
          payload: { roleId: context.role.id, controllerKind: "HUMAN", presence: "ONLINE" },
          dedupeKey: `ROLE_RECLAIM_PUBLIC:${command.idempotencyKey}`
        });
        await this.deliveries.publish(tx, {
          runId: roomId,
          day: context.node.nodeIndex,
          type: "ROLE_RECLAIM_EFFECTIVE",
          visibility: "PRIVATE",
          audienceType: "MEMBER",
          audienceUserIds: [user.id],
          audienceRoleIds: [context.role.id],
          payload: { roleId: context.role.id, mode: toMode, epoch: nextEpoch, effectiveFromSlot: nextSlot },
          dedupeKey: `ROLE_RECLAIM_PRIVATE:${command.idempotencyKey}`
        });
      } else {
        await this.deliveries.publish(tx, {
          runId: roomId,
          day: context.node.nodeIndex,
          type: "ROLE_RECLAIM_SCHEDULED",
          visibility: "PRIVATE",
          audienceType: "MEMBER",
          audienceUserIds: [user.id],
          audienceRoleIds: [context.role.id],
          payload: { roleId: context.role.id, mode: toMode, epoch: nextEpoch, effectiveFromSlot: "NEXT_WINDOW" },
          dedupeKey: `ROLE_RECLAIM_PRIVATE:${command.idempotencyKey}`
        });
      }
    });
    return { accepted: true, gameProjection: await this.projections.game(user, roomId) };
  }

  async heartbeat(user: AuthenticatedUser, roomId: string, command: HeartbeatCommandV1): Promise<HeartbeatResponseV1> {
    this.requireIdentifier(command.sessionInstanceId, "sessionInstanceId");
    if (!Number.isSafeInteger(command.heartbeatSequence) || command.heartbeatSequence < 1) throw this.invalid("heartbeatSequence must be a positive integer");
    if (!Number.isSafeInteger(command.lastAppliedDeliverySequence) || command.lastAppliedDeliverySequence < 0) throw this.invalid("lastAppliedDeliverySequence must be non-negative");
    const now = new Date();
    const minimumIntervalMs = this.heartbeatMinimumIntervalMs();
    const expiresAt = new Date(now.getTime() + Math.max(this.heartbeatStaleMs() * 3, 10_000));
    const result = await this.presenceTransaction(async (tx) => {
      const context = await this.presenceContext(tx, user, roomId);
      const sessionKey = {
        runId: roomId,
        userId: user.id,
        sessionInstanceId: command.sessionInstanceId
      };
      const existing = await tx.presenceSession.findUnique({
        where: { runId_userId_sessionInstanceId: sessionKey }
      });
      if (existing && command.heartbeatSequence <= existing.lastHeartbeatSequence) {
        return { accepted: false, rolePresence: this.controlProjection(context.control) };
      }
      if (existing && now.getTime() - existing.lastHeartbeatAt.getTime() < minimumIntervalMs) {
        throw new HttpException({
          code: "HEARTBEAT_RATE_LIMITED",
          message: "Heartbeat arrived before the independent presence interval elapsed",
          retryAfterMs: minimumIntervalMs - (now.getTime() - existing.lastHeartbeatAt.getTime())
        }, HttpStatus.TOO_MANY_REQUESTS);
      }

      await tx.presenceSession.upsert({
        where: { runId_userId_sessionInstanceId: sessionKey },
        update: {
          playerId: context.player.id,
          roleId: context.role.id,
          lastHeartbeatSequence: command.heartbeatSequence,
          lastAppliedDeliverySequence: Math.max(existing?.lastAppliedDeliverySequence || 0, command.lastAppliedDeliverySequence),
          lastHeartbeatAt: now,
          expiresAt
        },
        create: {
          ...sessionKey,
          playerId: context.player.id,
          roleId: context.role.id,
          lastHeartbeatSequence: command.heartbeatSequence,
          lastAppliedDeliverySequence: command.lastAppliedDeliverySequence,
          lastHeartbeatAt: now,
          expiresAt
        }
      });
      const recovering = context.control.mode === "HUMAN_OFFLINE_GRACE";
      let updated = context.control;
      // PresenceSession is the durable, high-frequency liveness cursor.  Do
      // not rewrite RoleControl/StoryPlayer on every heartbeat: action
      // commands read those authoritative rows under Serializable isolation,
      // and a two-second heartbeat loop otherwise creates a stable write/read
      // conflict on remote Supabase.  Authoritative rows only change when a
      // session is first established or a real control transition occurs.
      if (!existing) {
        await tx.storyPlayer.update({ where: { id: context.player.id }, data: { lastActiveAt: now } });
      }
      if (recovering) {
        const claimed = await tx.roleControl.updateMany({
          where: { id: context.control.id, mode: "HUMAN_OFFLINE_GRACE", epoch: context.control.epoch },
          data: { mode: "HUMAN_ACTIVE", offlineSince: null, reason: "HEARTBEAT_RECOVERED", lastHeartbeatAt: now }
        });
        if (claimed.count === 1) {
          await tx.storyRun.update({ where: { id: roomId }, data: { version: { increment: 1 } } });
          const transitionKey = `heartbeat-recovered:${user.id}:${command.sessionInstanceId}:${command.heartbeatSequence}`;
          await tx.roleControlTransition.create({
            data: {
              roleControlId: context.control.id,
              fromMode: context.control.mode,
              toMode: "HUMAN_ACTIVE",
              fromEpoch: context.control.epoch,
              toEpoch: context.control.epoch,
              reason: "HEARTBEAT_RECOVERED",
              initiatedByUserId: user.id,
              effectiveWindowId: context.window?.id,
              effectiveSlot: context.participant ? this.nextOpenSlot(context.participant) : undefined,
              idempotencyKey: transitionKey
            }
          });
          await this.deliveries.publish(tx, {
            runId: roomId,
            day: context.window?.node.nodeIndex || context.run.currentDay,
            type: "ROLE_CONTROL_CHANGED",
            visibility: "PUBLIC",
            audienceType: "ALL_MEMBERS",
            audienceUserIds: context.memberUserIds,
            audienceRoleIds: [context.role.id],
            payload: { roleId: context.role.id, controllerKind: "HUMAN", presence: "ONLINE" },
            dedupeKey: `ROLE_CONTROL_CHANGED:${transitionKey}`
          });
        }
        updated = await tx.roleControl.findUniqueOrThrow({ where: { id: context.control.id } });
      } else if (!existing && context.control.mode === "HUMAN_ACTIVE") {
        updated = await tx.roleControl.update({
          where: { id: context.control.id },
          data: { lastHeartbeatAt: now }
        });
      }
      return { accepted: true, rolePresence: this.controlProjection(updated) };
    });
    return {
      accepted: result.accepted,
      serverNow: now.toISOString(),
      nextHeartbeatAt: new Date(now.getTime() + Math.max(1_000, minimumIntervalMs)).toISOString(),
      rolePresence: result.rolePresence
    };
  }

  private async submitSlot(user: AuthenticatedUser, roomId: string, slot: Slot, command: SlotCommandV1, eventId?: string): Promise<CommandResponseV1> {
    this.validateSlotCommand(command);
    const immediateFeedback = await this.serializable(roomId, async (tx) => {
      const context = await this.context(tx, user, roomId);
      this.assertWindowAndControl(context, command.windowId, command.controlEpoch);
      this.assertSlotOpen(context, slot, eventId);
      const requestHash = sha256Canonical({ commandType: slot, roomId, eventId: eventId || null, ...command, userId: user.id });
      const replay = await tx.playerAction.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
      if (replay) {
        if (replay.userId !== user.id || replay.roleId !== context.role.id || replay.actionSlot !== slot || replay.requestHash !== requestHash) throw this.idempotencyReused();
        return replay.immediateJson as Record<string, unknown> | undefined;
      }

      const selected = this.selectConfiguredAction(context.gameContent, context.node.nodeIndex, context.role.roleKey, slot, command.actionKey);
      const targetRole = command.targetRoleId
        ? context.roles.find((role) => role.id === command.targetRoleId)
        : selected.targetRoleKey
          ? context.roles.find((role) => role.roleKey === selected.targetRoleKey)
          : undefined;
      if (selected.targetRoleKey && targetRole?.roleKey !== selected.targetRoleKey) throw this.invalid("targetRoleId is not allowed for this action");
      if (targetRole?.id === context.role.id) throw this.invalid("a role cannot target itself");
      if (command.leverageKey && !(selected.leverageKeys as readonly string[]).includes(command.leverageKey)) throw this.invalid("leverageKey is not allowed for this action");
      const now = new Date();
      const action = await tx.playerAction.create({
        data: {
          runId: roomId,
          nodeId: context.node.id,
          chapterIndex: context.node.chapterIndex,
          userId: user.id,
          roleId: context.role.id,
          playerType: "human",
          actionType: selected.actionType,
          targetType: targetRole ? "role" : "contest",
          targetId: targetRole?.id,
          targetText: targetRole?.roleName || selected.targetText,
          method: selected.method,
          intent: selected.intent,
          riskLevel: selected.riskLevel,
          normalizedJson: selected.normalized as Prisma.InputJsonValue,
          guardStatus: "ok",
          auditStatus: "ok",
          status: "accepted",
          actionSlot: slot,
          actorKind: "HUMAN",
          controlEpoch: context.control.epoch,
          actionKey: command.actionKey,
          idempotencyKey: command.idempotencyKey,
          requestHash,
          sourceInteractionRequestId: slot === "REACTION" ? eventId : undefined,
          visibility: selected.visibility,
          targetRoleId: targetRole?.id,
          leverageKey: command.leverageKey,
          sealedAt: now,
          expiresAt: context.window.graceClosesAt || context.window.mainClosesAt,
          immediateJson: selected.immediateFeedback as Prisma.InputJsonValue
        }
      });
      await this.applyAssetMutations(tx, context, action.id, selected.assetMutations);
      if (slot === "MAIN") {
        await tx.actionWindowParticipant.update({
          where: { windowId_roleId: { windowId: context.window.id, roleId: context.role.id } },
          data: { mainStatus: "SUBMITTED", maneuverStatus: "AVAILABLE", version: { increment: 1 } }
        });
        await this.createInteractionRequests(tx, context, action.id, selected.interactionRequestKeys);
        await this.enterGraceWhenMainComplete(tx, context);
      } else if (slot === "MANEUVER") {
        await tx.actionWindowParticipant.update({
          where: { windowId_roleId: { windowId: context.window.id, roleId: context.role.id } },
          data: { maneuverStatus: "SUBMITTED", maneuverUsedAt: now, version: { increment: 1 } }
        });
      } else {
        await tx.interactionRequest.update({ where: { id: eventId! }, data: { status: "RESPONDED", responseActionId: action.id } });
        await tx.actionWindowParticipant.update({
          where: { windowId_roleId: { windowId: context.window.id, roleId: context.role.id } },
          data: { reactionStatus: "RESPONDED", reactionUsedAt: now, version: { increment: 1 } }
        });
      }
      await tx.storyRun.update({ where: { id: roomId }, data: { version: { increment: 1 } } });
      await this.deliveries.publish(tx, {
        runId: roomId,
        day: context.node.nodeIndex,
        type: "ROLE_DECISION_STATUS_CHANGED",
        visibility: "OBSERVABLE",
        audienceType: "ALL_MEMBERS",
        audienceUserIds: context.memberUserIds,
        audienceRoleIds: [context.role.id],
        sourceActionId: action.id,
        payload: { roleId: context.role.id, slot, status: "SEALED" },
        dedupeKey: `ROLE_DECISION_STATUS:${action.id}`
      });
      await this.deliveries.publish(tx, {
        runId: roomId,
        day: context.node.nodeIndex,
        type: "ACTION_RECEIPT",
        visibility: "PRIVATE",
        audienceType: "MEMBER",
        audienceUserIds: [user.id],
        audienceRoleIds: [context.role.id],
        sourceActionId: action.id,
        payload: { actionId: action.id, slot, actionKey: command.actionKey, feedback: selected.immediateFeedback },
        dedupeKey: `ACTION_RECEIPT:${action.id}`
      });
      return selected.immediateFeedback;
    });
    return {
      accepted: true,
      guardDecision: { status: "ok" },
      immediateFeedback,
      gameProjection: await this.projections.game(user, roomId)
    };
  }

  private async submitLayout(user: AuthenticatedUser, roomId: string, command: LayoutCommandV1, leaveStage: boolean) {
    this.requireIdempotencyKey(command.idempotencyKey);
    this.requireIdentifier(command.windowId, "windowId");
    this.requireEpoch(command.controlEpoch);
    await this.serializable(roomId, async (tx) => {
      const context = await this.context(tx, user, roomId);
      this.assertWindowAndControl(context, command.windowId, command.controlEpoch);
      const commandHash = sha256Canonical({ commandType: leaveStage ? "LEAVE_STAGE" : "DONE", roomId, ...command, userId: user.id });
      const eventKey = `${leaveStage ? "LEAVE_STAGE" : "DONE"}:${command.idempotencyKey}`;
      const existing = await tx.storyEvent.findUnique({ where: { dedupeKey: eventKey } });
      if (existing) {
        const payload = existing.payloadJson as Record<string, unknown>;
        if (payload.commandHash !== commandHash || payload.roleId !== context.role.id) throw this.idempotencyReused();
        return;
      }
      if (context.participant.mainStatus === "PENDING") throw new ConflictException({ code: "SLOT_SEALED", message: "Submit MAIN before finishing the layout" });
      if (context.participant.reactionStatus === "PENDING") {
        const request = await tx.interactionRequest.findFirst({
          where: { windowId: context.window.id, targetRoleId: context.role.id, status: "OPEN" }
        });
        // A historical/content-mismatch request must never strand a human on
        // a layout that has no response controls.  Keep genuinely configured
        // reactions mandatory; downgrade only the unanswerable request.
        if (request && !context.gameContent.reaction(context.node.nodeIndex, context.role.roleKey)) {
          await tx.interactionRequest.update({ where: { id: request.id }, data: { status: "DOWNGRADED" } });
          await tx.actionWindowParticipant.update({
            where: { windowId_roleId: { windowId: context.window.id, roleId: context.role.id } },
            data: { reactionStatus: "EXPIRED", version: { increment: 1 } }
          });
          context.participant.reactionStatus = "EXPIRED";
        } else {
          throw new ConflictException({ code: "REACTION_REQUIRED", message: "A directed response is still required" });
        }
      }
      const now = new Date();
      await tx.actionWindowParticipant.update({
        where: { windowId_roleId: { windowId: context.window.id, roleId: context.role.id } },
        data: {
          doneAt: now,
          ...(context.participant.maneuverStatus === "AVAILABLE" ? { maneuverStatus: "PASSED" } : {}),
          version: { increment: 1 }
        }
      });
      if (leaveStage) {
        await tx.roleControl.update({ where: { id: context.control.id }, data: { stageLeaveWindowId: context.window.id, reason: "PLAYER_LEFT_STAGE_AFTER_DONE" } });
      }
      await tx.storyRun.update({ where: { id: roomId }, data: { version: { increment: 1 } } });
      await this.deliveries.publish(tx, {
        runId: roomId,
        day: context.node.nodeIndex,
        type: leaveStage ? "ROLE_LEFT_STAGE" : "ROLE_LAYOUT_DONE",
        visibility: "OBSERVABLE",
        audienceType: "ALL_MEMBERS",
        audienceUserIds: context.memberUserIds,
        audienceRoleIds: [context.role.id],
        payload: { roleId: context.role.id, commandHash },
        dedupeKey: eventKey
      });
      await this.closeIfEligible(tx, context.window.id);
    });
  }

  private async presenceContext(tx: Tx, user: AuthenticatedUser, roomId: string) {
    const run = await tx.storyRun.findUnique({
      where: { id: roomId },
      include: {
        roles: true,
        players: { where: { status: "active" } },
        roleControls: true
      }
    });
    if (!run || run.mode !== "room") throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    if (run.engineVersion !== CONTINUOUS_ENGINE_VERSION) {
      throw new ConflictException({ code: "CONTINUOUS_ENGINE_REQUIRED", message: "Legacy room presence is not accepted here" });
    }
    const gameContent = this.content.forGame(run.templateKey, run.strategyVersion);
    const player = run.players.find((candidate) => candidate.userId === user.id);
    if (!player?.roleId) throw new ForbiddenException({ code: "ROOM_MEMBERSHIP_REQUIRED", message: "Room membership and a role are required" });
    const role = run.roles.find((candidate) => candidate.id === player.roleId)!;
    if (!role || !gameContent.isPlayableRoleKey(role.roleKey)) throw new ForbiddenException({ code: "ROLE_FORBIDDEN", message: "Only registered player roles may send presence" });
    const control = run.roleControls.find((candidate) => candidate.roleId === role.id);
    if (!control) throw new ConflictException({ code: "ROLE_CONTROL_CHANGED", message: "Role control is not initialized" });
    // Presence is independent from the action-window checkpoint.  Resolution
    // deliberately commits PROJECTING/currentNodeId/next-window in stages;
    // requiring those pointers to match would drop otherwise healthy
    // heartbeats and falsely hand an online role to AI.
    const window = await tx.actionWindow.findFirst({
      where: { runId: roomId },
      orderBy: { createdAt: "desc" },
      include: { participants: true, node: true }
    });
    const participant = window?.participants.find((entry) => entry.roleId === role.id) || null;
    return {
      run,
      player,
      role,
      control,
      window,
      participant,
      gameContent,
      memberUserIds: run.players.map((candidate) => candidate.userId).filter((value): value is string => Boolean(value))
    };
  }

  private async context(tx: Tx, user: AuthenticatedUser, roomId: string) {
    const run = await tx.storyRun.findUnique({
      where: { id: roomId },
      include: {
        roles: true,
        players: { where: { status: "active" } },
        roleControls: true
      }
    });
    if (!run || run.mode !== "room") throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    if (run.engineVersion !== CONTINUOUS_ENGINE_VERSION) throw new ConflictException({ code: "CONTINUOUS_ENGINE_REQUIRED", message: "Legacy room commands are not accepted here" });
    const gameContent = this.content.forGame(run.templateKey, run.strategyVersion);
    if (!["playing", "resolving", "WAITING_FOR_HUMAN_UNLOCK"].includes(run.status)) throw new ConflictException({ code: "ROOM_NOT_STARTED", message: "Room is not accepting game commands" });
    const player = run.players.find((candidate) => candidate.userId === user.id);
    if (!player?.roleId) throw new ForbiddenException({ code: "ROOM_MEMBERSHIP_REQUIRED", message: "Room membership and a role are required" });
    const role = run.roles.find((candidate) => candidate.id === player.roleId)!;
    if (!role || !gameContent.isPlayableRoleKey(role.roleKey)) throw new ForbiddenException({ code: "ROLE_FORBIDDEN", message: "Only registered player roles may receive commands" });
    const control = run.roleControls.find((candidate) => candidate.roleId === role.id);
    if (!control) throw new ConflictException({ code: "ROLE_CONTROL_CHANGED", message: "Role control is not initialized" });
    if (!run.currentNodeId) throw new ConflictException({ code: "WINDOW_MOVED", message: "No current node is active" });
    const node = await tx.sceneNode.findUnique({ where: { id: run.currentNodeId } });
    const window = await tx.actionWindow.findFirst({
      where: { runId: roomId },
      orderBy: { createdAt: "desc" },
      include: { participants: true, interactionRequests: { where: { status: "OPEN" } } }
    });
    if (!node || !window || window.nodeId !== node.id) throw new ConflictException({ code: "WINDOW_MOVED", message: "The action window moved" });
    const participant = window.participants.find((entry) => entry.roleId === role.id);
    if (!participant) throw new ForbiddenException({ code: "ROLE_FORBIDDEN", message: "The role is not an active player seat" });
    const freeRounds = Number(process.env.CREDIT_FREE_DECISION_LIMIT || 3);
    if (run.accessLevel !== "UNLOCKED" && node.nodeIndex > freeRounds) {
      throw new HttpException({ code: "ACCESS_REQUIRES_UNLOCK", message: "A human member must unlock the shared world" }, HttpStatus.PAYMENT_REQUIRED);
    }
    return {
      run, node, window, participant, player, role, control, roles: run.roles, gameContent,
      memberUserIds: run.players.map((candidate) => candidate.userId).filter((value): value is string => Boolean(value))
    };
  }

  private assertWindowAndControl(context: Awaited<ReturnType<ActionCommandService["context"]>>, windowId: string, epoch: number) {
    if (context.window.id !== windowId) throw new ConflictException({ code: "WINDOW_MOVED", message: "The action window moved" });
    if (context.control.epoch !== epoch || !["HUMAN_ACTIVE", "HUMAN_OFFLINE_GRACE"].includes(context.control.mode)) throw this.controlChanged();
  }

  private assertSlotOpen(context: Awaited<ReturnType<ActionCommandService["context"]>>, slot: Slot, eventId?: string) {
    const now = Date.now();
    if (slot === "MAIN") {
      if (context.window.status !== "MAIN_OPEN" || !context.window.mainClosesAt || now >= context.window.mainClosesAt.getTime()) throw new ConflictException({ code: "WINDOW_CLOSED", message: "MAIN is closed" });
      if (context.participant.mainStatus !== "PENDING") throw new ConflictException({ code: "SLOT_SEALED", message: "MAIN is already sealed" });
    } else if (slot === "MANEUVER") {
      if (context.window.status !== "INTERACTION_GRACE" || !context.window.graceClosesAt || now >= context.window.graceClosesAt.getTime()) throw new ConflictException({ code: "WINDOW_CLOSED", message: "MANEUVER is closed" });
      if (context.participant.maneuverStatus !== "AVAILABLE") throw new ConflictException({ code: "SLOT_SEALED", message: "MANEUVER is not available" });
    } else {
      if (!eventId) throw this.invalid("eventId is required for REACTION");
      const request = context.window.interactionRequests.find((candidate) =>
        candidate.id === eventId && candidate.targetRoleId === context.role.id
      );
      if (
        !isReactionCommandWindowOpen(context.window.status)
        || context.participant.reactionStatus !== "PENDING"
        || !request
      ) {
        throw new ConflictException({ code: "SLOT_SEALED", message: "REACTION is not available" });
      }
      if (now >= request.expiresAt.getTime()) {
        throw new ConflictException({ code: "WINDOW_CLOSED", message: "REACTION is closed" });
      }
    }
  }

  private selectConfiguredAction(content: BoundContinuousStrategyContent, stageIndex: number, roleKey: string, slot: Slot, actionKey: string) {
    if (slot === "MAIN") {
      const card = content.roleStage(stageIndex, roleKey).mainCards.find((candidate) => candidate.actionKey === actionKey);
      if (!card) throw new ForbiddenException({ code: "GUARD_REJECTED", message: "That MAIN action is not available to this role" });
      return {
        targetRoleKey: card.targetRoleKey,
        leverageKeys: card.assetMutations.map((mutation) => mutation.assetKey),
        actionType: "role_card",
        targetText: card.title,
        method: card.title,
        intent: card.objective,
        riskLevel: card.risk.toLowerCase(),
        normalized: card,
        visibility: card.visibility,
        immediateFeedback: { receiptKey: card.receipt.receiptKey, text: card.receipt.text },
        assetMutations: card.assetMutations,
        interactionRequestKeys: card.effect.interactionRequestKeys
      };
    }
    if (slot === "MANEUVER") {
      const maneuver = content.maneuver(stageIndex, roleKey, actionKey);
      if (!maneuver) throw new ForbiddenException({ code: "GUARD_REJECTED", message: "That MANEUVER is not available to this role" });
      return {
        targetRoleKey: "",
        leverageKeys: maneuver.leverageAssetKeys,
        actionType: maneuver.allowedTypes[0] || "maneuver",
        targetText: maneuver.title,
        method: maneuver.title,
        intent: maneuver.objective,
        riskLevel: "normal",
        normalized: maneuver,
        visibility: "LIMITED",
        immediateFeedback: { text: `谋划已封存：${maneuver.title}` },
        assetMutations: [],
        interactionRequestKeys: []
      };
    }
    const reaction = content.reaction(stageIndex, roleKey, actionKey);
    const option = reaction?.responseOptions.find((candidate) => candidate.actionKey === actionKey);
    if (!reaction || !option) throw new ForbiddenException({ code: "GUARD_REJECTED", message: "That REACTION is not available to this role" });
    return {
      targetRoleKey: reaction.sourceRoleKey,
      leverageKeys: [],
      actionType: "directed_reaction",
      targetText: option.title,
      method: option.title,
      intent: option.nextStateKey,
      riskLevel: "normal",
      normalized: { reactionKey: reaction.reactionKey, option },
      visibility: "LIMITED",
      immediateFeedback: { text: `回应已封存：${option.title}` },
      assetMutations: [],
      interactionRequestKeys: []
    };
  }

  private async createInteractionRequests(tx: Tx, context: Awaited<ReturnType<ActionCommandService["context"]>>, actionId: string, requestKeys: string[]) {
    if (!requestKeys.length) return;
    const stage = context.gameContent.stage(context.node.nodeIndex);
    const timing = context.window.configJson as Record<string, any>;
    const graceSeconds = Number(timing?.timing?.graceSeconds || 45);
    const expiresAt = context.window.graceClosesAt || new Date((context.window.mainClosesAt?.getTime() || Date.now()) + graceSeconds * 1_000);
    for (const requestKey of requestKeys) {
      const definition = stage.interactionRequestCatalog.find((candidate) => candidate.requestKey === requestKey);
      if (!definition) throw new Error(`INTERACTION_REQUEST_NOT_CONFIGURED:${requestKey}`);
      const target = context.roles.find((role) => role.roleKey === definition.targetRoleKey)!;
      // Only a configured target-role scenario may become a blocking request.
      // Other content effects remain causal/observable but cannot create a UI
      // state for which the player has no legal response.
      if (!context.gameContent.reaction(context.node.nodeIndex, target.roleKey)) continue;
      const alreadyOpen = await tx.interactionRequest.findFirst({ where: { nodeId: context.node.id, targetRoleId: target.id, status: "OPEN" } });
      if (alreadyOpen) continue;
      const request = await tx.interactionRequest.create({
        data: {
          runId: context.run.id,
          nodeId: context.node.id,
          windowId: context.window.id,
          sourceActionId: actionId,
          targetRoleId: target.id,
          eventType: definition.eventType,
          priority: 100,
          expiresAt,
          defaultOutcomeJson: { outcomeKey: definition.defaultOutcomeKey, principle: "PRESERVE_CURRENT_HOLDING" } as Prisma.InputJsonValue,
          dedupeKey: `INTERACTION:${context.window.id}:${requestKey}`
        }
      });
      await tx.actionWindowParticipant.update({
        where: { windowId_roleId: { windowId: context.window.id, roleId: target.id } },
        data: { reactionStatus: "PENDING", version: { increment: 1 } }
      });
      const targetPlayer = context.run.players.find((player) => player.roleId === target.id);
      if (targetPlayer?.userId) {
        await this.deliveries.publish(tx, {
          runId: context.run.id,
          day: context.node.nodeIndex,
          type: "REACTION_REQUESTED",
          visibility: "PRIVATE",
          audienceType: "MEMBER",
          audienceUserIds: [targetPlayer.userId],
          audienceRoleIds: [target.id],
          sourceActionId: actionId,
          payload: { eventId: request.id, eventType: definition.eventType, expiresAt: expiresAt.toISOString() },
          dedupeKey: `REACTION_REQUESTED:${request.id}`
        });
      }
    }
  }

  private async enterGraceWhenMainComplete(tx: Tx, context: Awaited<ReturnType<ActionCommandService["context"]>>) {
    const pending = await tx.actionWindowParticipant.count({ where: { windowId: context.window.id, mainStatus: "PENDING" } });
    if (pending > 0) return;
    const current = await tx.actionWindow.findUniqueOrThrow({ where: { id: context.window.id } });
    if (current.status !== "MAIN_OPEN") return;
    const now = new Date();
    const config = current.configJson as Record<string, any>;
    const graceSeconds = Number(config?.timing?.graceSeconds || 45);
    const minimumSeconds = Number(config?.timing?.graceMinimumSeconds || 20);
    const graceClosesAt = new Date(now.getTime() + graceSeconds * 1_000);
    const graceMinClosesAt = new Date(Math.min(now.getTime() + minimumSeconds * 1_000, graceClosesAt.getTime()));
    await tx.actionWindow.update({
      where: { id: current.id },
      data: {
        status: "INTERACTION_GRACE",
        graceOpenedAt: now,
        graceMinClosesAt,
        graceClosesAt,
        version: { increment: 1 },
        projectionVersion: { increment: 1 }
      }
    });
    await this.deliveries.publish(tx, {
      runId: context.run.id,
      day: context.node.nodeIndex,
      type: "INTERACTION_GRACE_OPENED",
      visibility: "PUBLIC",
      audienceType: "ALL_MEMBERS",
      audienceUserIds: context.memberUserIds,
      payload: { windowId: current.id, graceMinClosesAt: graceMinClosesAt.toISOString(), graceClosesAt: graceClosesAt.toISOString() },
      dedupeKey: `INTERACTION_GRACE_OPENED:${current.id}`
    });
  }

  private async closeIfEligible(tx: Tx, windowId: string) {
    const window = await tx.actionWindow.findUnique({ where: { id: windowId }, include: { participants: true, interactionRequests: { where: { status: "OPEN" } } } });
    if (!window || window.status !== "INTERACTION_GRACE" || !window.graceMinClosesAt) return;
    if (Date.now() < window.graceMinClosesAt.getTime() || window.interactionRequests.length || window.participants.some((entry) => !entry.doneAt)) return;
    await tx.actionWindow.updateMany({
      where: { id: window.id, status: "INTERACTION_GRACE", version: window.version },
      data: { status: "CLOSING", closingReason: "ALL_LAYOUTS_DONE", version: { increment: 1 }, projectionVersion: { increment: 1 } }
    });
  }

  private async applyAssetMutations(tx: Tx, context: Awaited<ReturnType<ActionCommandService["context"]>>, actionId: string, mutations: Array<{ assetKey: string; mutationType: string; delta: number; toRoleKey: string | null }>) {
    for (const mutation of mutations) {
      const asset = await tx.roleAsset.findUnique({ where: { runId_assetKey: { runId: context.run.id, assetKey: mutation.assetKey } } });
      if (!asset) throw new ConflictException({ code: "GUARD_REJECTED", message: `Required asset is unavailable: ${mutation.assetKey}` });
      const target = mutation.toRoleKey ? context.roles.find((role) => role.roleKey === mutation.toRoleKey) : undefined;
      const nextQuantity = asset.quantity + mutation.delta;
      if (nextQuantity < 0) throw new ConflictException({ code: "GUARD_REJECTED", message: `Asset quantity would become negative: ${mutation.assetKey}` });
      const worldActorKey = context.gameContent.package().contract.worldActorKey;
      const toWorldActor = mutation.toRoleKey === worldActorKey;
      const before = { ownerRoleId: asset.ownerRoleId, ownerActorKey: asset.ownerActorKey, quantity: asset.quantity, state: asset.stateJson };
      const after = {
        ownerRoleId: toWorldActor ? null : target?.id ?? asset.ownerRoleId,
        ownerActorKey: toWorldActor ? worldActorKey : target ? null : asset.ownerActorKey,
        quantity: nextQuantity,
        state: asset.stateJson
      };
      await tx.roleAsset.update({ where: { id: asset.id }, data: { ownerRoleId: after.ownerRoleId, ownerActorKey: after.ownerActorKey, quantity: nextQuantity, version: { increment: 1 } } });
      await tx.roleAssetMutation.create({
        data: {
          assetId: asset.id,
          actionId,
          mutationType: mutation.mutationType,
          delta: mutation.delta,
          fromRoleId: asset.ownerRoleId,
          toRoleId: target?.id,
          beforeJson: before as Prisma.InputJsonValue,
          afterJson: after as Prisma.InputJsonValue,
          idempotencyKey: `asset:${actionId}:${mutation.assetKey}:${mutation.mutationType}`
        }
      });
    }
  }

  private nextOpenSlot(participant: { mainStatus: string; maneuverStatus: string; reactionStatus: string }): Slot {
    if (participant.mainStatus === "PENDING") return "MAIN";
    if (participant.reactionStatus === "PENDING") return "REACTION";
    return "MANEUVER";
  }

  private controlProjection(control: { roleId: string; mode: string; epoch: number }): HeartbeatResponseV1["rolePresence"] {
    return {
      roleId: control.roleId,
      mode: control.mode as HeartbeatResponseV1["rolePresence"]["mode"],
      presence: control.mode === "AI_ACTIVE" ? "AI_CONTROLLED" : control.mode === "HUMAN_ACTIVE" ? "ONLINE" : control.mode === "SYSTEM" ? "SYSTEM" : "ABSENT",
      epoch: control.epoch
    };
  }

  private heartbeatMinimumIntervalMs(): number {
    const configured = Number(process.env.HEARTBEAT_MIN_INTERVAL_MS || 500);
    return Number.isFinite(configured) && configured >= 100 ? Math.floor(configured) : 500;
  }

  private heartbeatStaleMs(): number {
    const configured = Number(process.env.HEARTBEAT_STALE_MS || 15_000);
    return Number.isFinite(configured) && configured >= 500 ? Math.floor(configured) : 15_000;
  }

  private validateSlotCommand(command: SlotCommandV1) {
    this.requireIdempotencyKey(command.idempotencyKey);
    this.requireIdentifier(command.windowId, "windowId");
    this.requireEpoch(command.controlEpoch);
    this.requireIdentifier(command.actionKey, "actionKey");
    if (command.targetRoleId !== undefined) this.requireIdentifier(command.targetRoleId, "targetRoleId");
    if (command.leverageKey !== undefined) this.requireIdentifier(command.leverageKey, "leverageKey");
  }

  private requireIdempotencyKey(value: string) {
    this.requireIdentifier(value, "idempotencyKey");
  }

  private requireIdentifier(value: string, name: string) {
    if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(value)) throw this.invalid(`${name} is invalid`);
  }

  private requireEpoch(value: number) {
    if (!Number.isSafeInteger(value) || value < 1) throw this.invalid("control epoch must be a positive integer");
  }

  private invalid(message: string) {
    return new BadRequestException({ code: "INVALID_COMMAND", message });
  }

  private idempotencyReused() {
    return new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED", message: "The idempotency key belongs to a different command" });
  }

  private controlChanged() {
    return new ConflictException({ code: "ROLE_CONTROL_CHANGED", message: "Role control changed; refresh the current projection" });
  }

  private async serializable<T>(roomId: string, operation: (tx: Tx) => Promise<T>): Promise<T> {
    return roomSerializableTransaction(this.prisma, roomId, operation);
  }

  private async presenceTransaction<T>(operation: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 10_000,
          timeout: 30_000
        });
      } catch (error: any) {
        const message = String(error?.message || error);
        const transient = error?.code === "P2034" || /40P01|40001|deadlock detected|write conflict/i.test(message);
        if (!transient || attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(500, 40 * 2 ** attempt)));
      }
    }
    throw new Error("unreachable presence transaction retry state");
  }
}

export function isReactionCommandWindowOpen(status: string): boolean {
  // A directed request is created as soon as its source MAIN action is
  // accepted. The target player's modal intentionally blocks their own MAIN
  // choice until they respond, so waiting for INTERACTION_GRACE would create a
  // client/server deadlock while the window is still MAIN_OPEN.
  return status === "MAIN_OPEN" || status === "INTERACTION_GRACE";
}
