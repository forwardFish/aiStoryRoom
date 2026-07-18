import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { sha256Canonical } from "./canonical";
import { ContinuousStrategyContentService, type BoundContinuousStrategyContent } from "./content.service";
import { ContinuousEventDeliveryService } from "./event-delivery.service";
import { RoleAgentTaskService } from "./role-agent-task.service";

type Tx = Prisma.TransactionClient;

@Injectable()
export class WindowLifecycleService {
  private readonly logger = new Logger(WindowLifecycleService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ContinuousStrategyContentService) private readonly content: ContinuousStrategyContentService,
    @Inject(ContinuousEventDeliveryService) private readonly deliveries: ContinuousEventDeliveryService,
    @Inject(RoleAgentTaskService) private readonly roleAgents: RoleAgentTaskService
  ) {}

  async sweep(limit = 25) {
    const windows = await this.prisma.actionWindow.findMany({
      where: { status: { in: ["MAIN_OPEN", "INTERACTION_GRACE", "CLOSING"] } },
      orderBy: { updatedAt: "asc" }, take: Math.max(1, Math.min(100, limit)), select: { id: true }
    });
    const results = [];
    for (const window of windows) {
      try { results.push(await this.advance(window.id)); }
      catch (error) { this.logger.warn(`Window lifecycle sweep failed for ${window.id}: ${String(error)}`); }
    }
    return results;
  }

  async advance(windowId: string, now = new Date()) {
    await this.applyPresenceTransitions(windowId, now);
    return this.lifecycleTransaction(async (tx) => {
      const window = await tx.actionWindow.findUnique({
        where: { id: windowId },
        include: {
          run: { include: { roles: true, players: { where: { status: "active" } }, roleControls: true } },
          node: true,
          participants: true,
          interactionRequests: { where: { status: "OPEN" } }
        }
      });
      if (!window) return { windowId, outcome: "MISSING" };
      const gameContent = this.content.forGame(window.run.templateKey, window.run.strategyVersion);
      if (window.status === "MAIN_OPEN") {
        await this.roleAgents.enqueueForWindow(tx, window.id);
        if (window.mainClosesAt && now >= window.mainClosesAt) {
          await this.finalizeMissingMains(tx, window, now, gameContent);
        }
        const pending = await tx.actionWindowParticipant.count({ where: { windowId, mainStatus: "PENDING" } });
        if (pending === 0) await this.openGrace(tx, window, now);
        return { windowId, outcome: pending === 0 ? "GRACE_OPENED" : "MAIN_REMAINS_OPEN" };
      }
      if (window.status === "INTERACTION_GRACE") {
        await this.roleAgents.enqueueForWindow(tx, window.id);
        const activeAgentTasks = await tx.storyTaskOutbox.count({
          where: {
            windowId,
            taskType: "ROLE_AGENT_DECISION",
            status: { in: ["pending", "running"] }
          }
        });
        if (activeAgentTasks === 0 && !window.aiQueueDrainedAt) {
          await tx.actionWindow.updateMany({
            where: { id: windowId, aiQueueDrainedAt: null },
            data: { aiQueueDrainedAt: now }
          });
        }
        const allDone = window.participants.every((participant) => Boolean(participant.doneAt));
        const minimumReached = Boolean(window.graceMinClosesAt && now >= window.graceMinClosesAt);
        const deadlineReached = Boolean(window.graceClosesAt && now >= window.graceClosesAt);
        // aiOnlyGraceSeconds is a presentation/timing deadline, not permission
        // to discard still-running role decisions. A game's bounded Agent
        // tasks can finish after that short deadline; wait for
        // the durable queue to drain (or exhaust) before applying fallbacks.
        if (deadlineReached && activeAgentTasks === 0) await this.finalizeGraceSlots(tx, window, now, gameContent);
        const openRequests = await tx.interactionRequest.count({ where: { windowId, status: "OPEN" } });
        const refreshed = await tx.actionWindowParticipant.findMany({ where: { windowId } });
        const eligible = activeAgentTasks === 0 && (deadlineReached || (minimumReached && allDone)) && openRequests === 0
          && refreshed.every((participant) => participant.maneuverStatus !== "AVAILABLE" && participant.reactionStatus !== "PENDING");
        if (eligible) {
          await tx.actionWindow.updateMany({
            where: { id: windowId, status: "INTERACTION_GRACE", version: window.version },
            data: { status: "CLOSING", closingReason: deadlineReached ? "GRACE_DEADLINE" : "ALL_LAYOUTS_DONE", version: { increment: 1 }, projectionVersion: { increment: 1 } }
          });
          return { windowId, outcome: "CLOSING" };
        }
        return { windowId, outcome: "GRACE_REMAINS_OPEN" };
      }
      if (window.status === "CLOSING") {
        const dedupeKey = `RESOLVE_WINDOW:${window.id}`;
        const task = await tx.storyTaskOutbox.upsert({
          where: { dedupeKey },
          update: {},
          create: {
            runId: window.runId,
            nodeId: window.nodeId,
            windowId: window.id,
            dedupeKey,
            taskType: "RESOLVE_WINDOW",
            status: "pending",
            outcome: null,
            maxAttempts: 5,
            checkpointKey: "RULES_APPLIED"
          }
        });
        await tx.actionWindow.update({
          where: { id: window.id },
          data: { status: "RESOLVING", resolutionTaskId: task.id, version: { increment: 1 }, projectionVersion: { increment: 1 } }
        });
        await tx.storyRun.update({ where: { id: window.runId }, data: { status: "resolving", version: { increment: 1 } } });
        return { windowId, outcome: "RESOLUTION_ENQUEUED", taskId: task.id };
      }
      return { windowId, outcome: "NO_OP", status: window.status };
    });
  }

  private async serializable<T>(operation: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000
        });
      } catch (error: any) {
        const message = String(error?.message || error);
        const transient = error?.code === "P2034" || /40P01|40001|deadlock detected|write conflict/i.test(message);
        if (!transient || attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
      }
    }
    throw new Error("unreachable serializable retry state");
  }

  private async lifecycleTransaction<T>(operation: (tx: Tx) => Promise<T>): Promise<T> {
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
    throw new Error("unreachable lifecycle transaction retry state");
  }

  private async finalizeMissingMains(tx: Tx, window: WindowContext, now: Date, content: BoundContinuousStrategyContent) {
    const pending = window.participants.filter((participant: any) => participant.mainStatus === "PENDING");
    for (const participant of pending) {
      const role = window.run.roles.find((candidate: any) => candidate.id === participant.roleId)!;
      const control = window.run.roleControls.find((candidate: any) => candidate.roleId === role.id)!;
      const policy = content.agentPolicy(window.node.nodeIndex, role.roleKey);
      const fallback = content.fallbackAction(window.node.nodeIndex, role.roleKey, policy.fallbackBySlot.MAIN);
      const actorKind = control.mode === "AI_ACTIVE" ? "AI_TAKEOVER" : "TIMEOUT_FALLBACK";
      const action = await tx.playerAction.upsert({
        where: { nodeId_roleId_actionSlot: { nodeId: window.nodeId, roleId: role.id, actionSlot: "MAIN" } },
        update: {},
        create: {
          runId: window.runId,
          nodeId: window.nodeId,
          chapterIndex: window.node.chapterIndex,
          roleId: role.id,
          playerType: actorKind === "AI_TAKEOVER" ? "ai" : "timeout",
          actionType: "role_fallback",
          targetText: fallback.objective,
          method: fallback.objective,
          intent: fallback.objective,
          riskLevel: "normal",
          normalizedJson: fallback as Prisma.InputJsonValue,
          guardStatus: "ok",
          auditStatus: "ok",
          status: "accepted",
          actionSlot: "MAIN",
          actorKind,
          controlEpoch: control.epoch,
          policyVersion: policy.policyVersion,
          provider: "rules",
          modelName: "deterministic-fallback-v1",
          actionKey: fallback.actionKey,
          idempotencyKey: `fallback:${window.id}:${role.id}:MAIN:${control.epoch}`,
          requestHash: sha256Canonical({ fallback, epoch: control.epoch }),
          visibility: "PRIVATE",
          sealedAt: now,
          immediateJson: { text: fallback.objective, fallback: true } as Prisma.InputJsonValue
        }
      });
      await this.applyAssetMutations(tx, window, action.id, role.id, fallback.assetMutations, content);
      await tx.actionWindowParticipant.update({
        where: { windowId_roleId: { windowId: window.id, roleId: role.id } },
        data: { mainStatus: actorKind === "AI_TAKEOVER" ? "SUBMITTED" : "TIMED_OUT", maneuverStatus: "AVAILABLE", version: { increment: 1 } }
      });
    }
  }

  private async openGrace(tx: Tx, window: WindowContext, now: Date) {
    const current = await tx.actionWindow.findUniqueOrThrow({ where: { id: window.id } });
    if (current.status !== "MAIN_OPEN") return;
    const config = current.configJson as Record<string, any>;
    const allAiControlled = window.participants.every((participant: any) =>
      window.run.roleControls.some((control: any) => control.roleId === participant.roleId && control.mode === "AI_ACTIVE")
    );
    const graceSeconds = Number(allAiControlled ? config?.timing?.aiOnlyGraceSeconds || 2 : config?.timing?.graceSeconds || 45);
    const minimumSeconds = Number(config?.timing?.graceMinimumSeconds || 20);
    const graceClosesAt = new Date(now.getTime() + graceSeconds * 1_000);
    const graceMinClosesAt = new Date(Math.min(now.getTime() + minimumSeconds * 1_000, graceClosesAt.getTime()));
    await tx.actionWindow.update({
      where: { id: current.id },
      data: { status: "INTERACTION_GRACE", graceOpenedAt: now, graceMinClosesAt, graceClosesAt, version: { increment: 1 }, projectionVersion: { increment: 1 } }
    });
    await tx.storyRun.update({ where: { id: window.runId }, data: { version: { increment: 1 } } });
    await this.deliveries.publish(tx, {
      runId: window.runId,
      day: window.node.nodeIndex,
      type: "INTERACTION_GRACE_OPENED",
      visibility: "PUBLIC",
      audienceType: "ALL_MEMBERS",
      audienceUserIds: window.run.players.map((player: any) => player.userId).filter((id: any): id is string => Boolean(id)),
      payload: { windowId: window.id, graceMinClosesAt: graceMinClosesAt.toISOString(), graceClosesAt: graceClosesAt.toISOString() },
      dedupeKey: `INTERACTION_GRACE_OPENED:${window.id}`
    });
    await this.roleAgents.enqueueForWindow(tx, window.id);
  }

  private async applyPresenceTransitions(windowId: string, now: Date) {
    const window = await this.prisma.actionWindow.findUnique({
      where: { id: windowId },
      include: {
        run: { include: { players: { where: { status: "active" } }, roleControls: true } },
        node: true,
        participants: true
      }
    });
    if (!window || !["MAIN_OPEN", "INTERACTION_GRACE"].includes(window.status)) return;
    const staleMs = this.heartbeatStaleMs();
    const config = window.configJson as Record<string, any>;
    const offlineGraceMs = Math.max(0, Number(config?.timing?.offlineGraceSeconds || 30) * 1_000);
    const audienceUserIds = window.run.players
      .map((player: any) => player.userId)
      .filter((userId: any): userId is string => Boolean(userId));
    const latestSessions = await this.prisma.presenceSession.groupBy({
      by: ["roleId"],
      where: { runId: window.runId },
      _max: { lastHeartbeatAt: true }
    });
    const heartbeatByRole = new Map(latestSessions.map((entry) => [entry.roleId, entry._max.lastHeartbeatAt]));
    const observedHeartbeat = (control: any) => {
      const sessionHeartbeat = heartbeatByRole.get(control.roleId);
      if (!sessionHeartbeat) return control.lastHeartbeatAt as Date | null;
      if (!control.lastHeartbeatAt) return sessionHeartbeat;
      return sessionHeartbeat > control.lastHeartbeatAt ? sessionHeartbeat : control.lastHeartbeatAt;
    };

    const controls = [...window.run.roleControls]
      .filter((control) => control.mode !== "SYSTEM")
      .sort((left, right) => (observedHeartbeat(left)?.getTime() || 0) - (observedHeartbeat(right)?.getTime() || 0));
    for (const control of controls) {
      if (control.mode === "SYSTEM") continue;
      const latestHeartbeatAt = observedHeartbeat(control);
      if (control.mode === "HUMAN_ACTIVE" && latestHeartbeatAt
        && now.getTime() - latestHeartbeatAt.getTime() >= staleMs) {
        try {
          await this.markRoleOffline(window, control, now, staleMs, audienceUserIds);
        } catch (error) {
          this.logger.warn(`Presence transition failed for role ${control.roleId} in ${window.id}: ${String(error)}`);
        }
        continue;
      }

      if (control.mode === "HUMAN_OFFLINE_GRACE" && control.offlineSince
        && now.getTime() - control.offlineSince.getTime() >= offlineGraceMs) {
        try {
          await this.activateRoleAgent(window, control, now, offlineGraceMs, audienceUserIds);
        } catch (error) {
          this.logger.warn(`AI takeover failed for role ${control.roleId} in ${window.id}: ${String(error)}`);
        }
      }
    }
  }

  private async markRoleOffline(window: WindowContext, control: any, now: Date, staleMs: number, audienceUserIds: string[]) {
    await this.serializable(async (tx) => {
      const fresh = await tx.roleControl.findUnique({ where: { id: control.id } });
      if (!fresh || fresh.mode !== "HUMAN_ACTIVE" || fresh.epoch !== control.epoch) return;
      const session = await tx.presenceSession.findFirst({
        where: { runId: window.runId, roleId: fresh.roleId },
        orderBy: { lastHeartbeatAt: "desc" },
        select: { lastHeartbeatAt: true }
      });
      const latestHeartbeatAt = !session?.lastHeartbeatAt
        ? fresh.lastHeartbeatAt
        : !fresh.lastHeartbeatAt || session.lastHeartbeatAt > fresh.lastHeartbeatAt
          ? session.lastHeartbeatAt
          : fresh.lastHeartbeatAt;
      if (!latestHeartbeatAt || now.getTime() - latestHeartbeatAt.getTime() < staleMs) return;
      const activeWindow = await tx.actionWindow.findUnique({ where: { id: window.id }, select: { status: true } });
      if (!activeWindow || !["MAIN_OPEN", "INTERACTION_GRACE"].includes(activeWindow.status)) return;
      const offlineSince = now;
      const transitionKey = `disconnect-detected:${window.id}:${fresh.id}:${fresh.epoch}:${latestHeartbeatAt.getTime()}`;
      const claimed = await tx.roleControl.updateMany({
        where: { id: fresh.id, mode: "HUMAN_ACTIVE", epoch: fresh.epoch },
        data: { mode: "HUMAN_OFFLINE_GRACE", offlineSince, reason: "DISCONNECT_DETECTED", lastHeartbeatAt: latestHeartbeatAt }
      });
      if (claimed.count !== 1) return;
      await tx.roleControlTransition.create({
        data: {
          roleControlId: fresh.id, fromMode: "HUMAN_ACTIVE", toMode: "HUMAN_OFFLINE_GRACE",
          fromEpoch: fresh.epoch, toEpoch: fresh.epoch, reason: "DISCONNECT_DETECTED",
          effectiveWindowId: window.id, effectiveSlot: this.nextOpenSlot(window, fresh.roleId), idempotencyKey: transitionKey
        }
      });
      await tx.storyRun.update({ where: { id: window.runId }, data: { version: { increment: 1 } } });
      await this.deliveries.publish(tx, {
        runId: window.runId, day: window.node.nodeIndex, type: "ROLE_PRESENCE_CHANGED", visibility: "OBSERVABLE",
        audienceType: "ALL_MEMBERS", audienceUserIds, audienceRoleIds: [fresh.roleId],
        payload: { roleId: fresh.roleId, controllerKind: "HUMAN", presence: "ABSENT" },
        dedupeKey: `ROLE_PRESENCE_CHANGED:${transitionKey}`
      });
    });
  }

  private async activateRoleAgent(window: WindowContext, control: any, now: Date, offlineGraceMs: number, audienceUserIds: string[]) {
    await this.serializable(async (tx) => {
      const fresh = await tx.roleControl.findUnique({ where: { id: control.id } });
      if (!fresh || fresh.mode !== "HUMAN_OFFLINE_GRACE" || fresh.epoch !== control.epoch || !fresh.offlineSince
        || now.getTime() - fresh.offlineSince.getTime() < offlineGraceMs) return;
      const recentSession = await tx.presenceSession.findFirst({
        where: { runId: window.runId, roleId: fresh.roleId, lastHeartbeatAt: { gt: fresh.offlineSince } },
        orderBy: { lastHeartbeatAt: "desc" },
        select: { lastHeartbeatAt: true }
      });
      if (recentSession && now.getTime() - recentSession.lastHeartbeatAt.getTime() < this.heartbeatStaleMs()) return;
      const activeWindow = await tx.actionWindow.findUnique({ where: { id: window.id }, select: { status: true } });
      if (!activeWindow || !["MAIN_OPEN", "INTERACTION_GRACE"].includes(activeWindow.status)) return;
      const nextEpoch = fresh.epoch + 1;
      const transitionKey = `disconnect-timeout:${window.id}:${fresh.id}:${fresh.epoch}:${fresh.offlineSince.getTime()}`;
      const claimed = await tx.roleControl.updateMany({
        where: { id: fresh.id, mode: "HUMAN_OFFLINE_GRACE", epoch: fresh.epoch, offlineSince: fresh.offlineSince },
        data: { mode: "AI_ACTIVE", epoch: nextEpoch, reason: "DISCONNECT_TIMEOUT", takeoverAt: now }
      });
      if (claimed.count !== 1) return;
      await tx.roleControlTransition.create({
        data: {
          roleControlId: fresh.id, fromMode: "HUMAN_OFFLINE_GRACE", toMode: "AI_ACTIVE",
          fromEpoch: fresh.epoch, toEpoch: nextEpoch, reason: "DISCONNECT_TIMEOUT",
          effectiveWindowId: window.id, effectiveSlot: this.nextOpenSlot(window, fresh.roleId), idempotencyKey: transitionKey
        }
      });
      await tx.storyRun.update({ where: { id: window.runId }, data: { version: { increment: 1 } } });
      await this.deliveries.publish(tx, {
        runId: window.runId, day: window.node.nodeIndex, type: "ROLE_CONTROL_CHANGED", visibility: "PUBLIC",
        audienceType: "ALL_MEMBERS", audienceUserIds, audienceRoleIds: [fresh.roleId],
        payload: { roleId: fresh.roleId, controllerKind: "AI", presence: "AI_CONTROLLED" },
        dedupeKey: `ROLE_CONTROL_CHANGED:${transitionKey}`
      });
    });
  }

  private nextOpenSlot(window: WindowContext, roleId: string): "MAIN" | "MANEUVER" | "REACTION" {
    const participant = window.participants.find((entry: any) => entry.roleId === roleId);
    if (!participant || participant.mainStatus === "PENDING") return "MAIN";
    if (participant.reactionStatus === "PENDING") return "REACTION";
    return "MANEUVER";
  }

  private heartbeatStaleMs(): number {
    const configured = Number(process.env.HEARTBEAT_STALE_MS || 15_000);
    return Number.isFinite(configured) && configured >= 500 ? Math.floor(configured) : 15_000;
  }

  private async finalizeGraceSlots(tx: Tx, window: WindowContext, now: Date, content: BoundContinuousStrategyContent) {
    for (const request of window.interactionRequests) {
      const role = window.run.roles.find((candidate: any) => candidate.id === request.targetRoleId)!;
      const control = window.run.roleControls.find((candidate: any) => candidate.roleId === role.id)!;
      const scenario = content.reaction(window.node.nodeIndex, role.roleKey);
      if (scenario) {
        const option = scenario.responseOptions.find((candidate) => candidate.actionKey === scenario.fallbackResponseActionKey) || scenario.responseOptions[0];
        const action = await tx.playerAction.upsert({
          where: { nodeId_roleId_actionSlot: { nodeId: window.nodeId, roleId: role.id, actionSlot: "REACTION" } },
          update: {},
          create: {
            runId: window.runId, nodeId: window.nodeId, chapterIndex: window.node.chapterIndex, roleId: role.id,
            playerType: control.mode === "AI_ACTIVE" ? "ai" : "timeout", actionType: "directed_reaction",
            targetText: option.title, method: option.title, intent: option.nextStateKey, riskLevel: "normal",
            normalizedJson: { reactionKey: scenario.reactionKey, option } as Prisma.InputJsonValue,
            guardStatus: "ok", auditStatus: "ok", status: "accepted", actionSlot: "REACTION",
            actorKind: control.mode === "AI_ACTIVE" ? "AI_TAKEOVER" : "TIMEOUT_FALLBACK", controlEpoch: control.epoch,
            actionKey: option.actionKey, idempotencyKey: `fallback:${window.id}:${role.id}:REACTION:${control.epoch}`,
            requestHash: sha256Canonical({ option, requestId: request.id }), sourceInteractionRequestId: request.id,
            visibility: "LIMITED", sealedAt: now, immediateJson: { text: option.title, fallback: true } as Prisma.InputJsonValue
          }
        });
        await tx.interactionRequest.update({ where: { id: request.id }, data: { status: "DEFAULTED", responseActionId: action.id } });
      } else {
        await tx.interactionRequest.update({ where: { id: request.id }, data: { status: "EXPIRED" } });
      }
      await tx.actionWindowParticipant.update({
        where: { windowId_roleId: { windowId: window.id, roleId: role.id } },
        data: { reactionStatus: "FALLBACK", reactionUsedAt: now, version: { increment: 1 } }
      });
    }
    for (const participant of window.participants.filter((entry: any) => entry.maneuverStatus === "AVAILABLE")) {
      await tx.actionWindowParticipant.update({
        where: { windowId_roleId: { windowId: window.id, roleId: participant.roleId } },
        data: { maneuverStatus: "EXPIRED", doneAt: participant.doneAt || now, version: { increment: 1 } }
      });
    }
    for (const participant of window.participants.filter((entry: any) => !entry.doneAt)) {
      await tx.actionWindowParticipant.update({
        where: { windowId_roleId: { windowId: window.id, roleId: participant.roleId } },
        data: { doneAt: now, version: { increment: 1 } }
      });
    }
  }

  private async applyAssetMutations(tx: Tx, window: WindowContext, actionId: string, roleId: string, mutations: Array<{ assetKey: string; mutationType: string; delta: number; toRoleKey: string | null }>, content: BoundContinuousStrategyContent) {
    for (const mutation of mutations) {
      const asset = await tx.roleAsset.findUnique({ where: { runId_assetKey: { runId: window.runId, assetKey: mutation.assetKey } } });
      if (!asset) continue;
      const target = mutation.toRoleKey ? window.run.roles.find((role: any) => role.roleKey === mutation.toRoleKey) : undefined;
      const nextQuantity = Math.max(0, asset.quantity + mutation.delta);
      const worldActorKey = content.package().contract.worldActorKey;
      const toWorldActor = mutation.toRoleKey === worldActorKey;
      const before = { ownerRoleId: asset.ownerRoleId, ownerActorKey: asset.ownerActorKey, quantity: asset.quantity };
      const after = {
        ownerRoleId: toWorldActor ? null : target?.id ?? asset.ownerRoleId,
        ownerActorKey: toWorldActor ? worldActorKey : target ? null : asset.ownerActorKey,
        quantity: nextQuantity
      };
      await tx.roleAsset.update({ where: { id: asset.id }, data: { ownerRoleId: after.ownerRoleId, ownerActorKey: after.ownerActorKey, quantity: nextQuantity, version: { increment: 1 } } });
      await tx.roleAssetMutation.upsert({
        where: { idempotencyKey: `asset:${actionId}:${mutation.assetKey}:${mutation.mutationType}` },
        update: {},
        create: {
          assetId: asset.id, actionId, mutationType: mutation.mutationType, delta: mutation.delta,
          fromRoleId: roleId, toRoleId: target?.id, beforeJson: before as Prisma.InputJsonValue, afterJson: after as Prisma.InputJsonValue,
          idempotencyKey: `asset:${actionId}:${mutation.assetKey}:${mutation.mutationType}`
        }
      });
    }
  }
}

type WindowContext = any;
