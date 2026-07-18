import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ROLE_AGENT_DECISION_SCHEMA_VERSION,
  validateRoleAgentDecisionV1,
  type PlayerActionSlot,
  type RoleAgentDecisionV1,
  type RoleAgentDecisionValidationContext
} from "@ai-story/shared";
import { PrismaService } from "../prisma.service";
import { sha256Canonical } from "./canonical";
import { ContinuousStrategyContentService, type BoundContinuousStrategyContent } from "./content.service";
import {
  maybeInjectRoleAgentFault,
  normalizeRoleAgentAttemptTimeoutMs,
  ROLE_AGENT_PROVIDER_ATTEMPTS
} from "../config/continuous-strategy.config";
import { roomSerializableTransaction } from "./room-transaction";

export type RoleAgentTaskFence = {
  taskId: string;
  leaseOwner: string;
  leaseVersion: number;
};

type Tx = Prisma.TransactionClient;

@Injectable()
export class RoleAgentTaskService {
  private readonly logger = new Logger(RoleAgentTaskService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ContinuousStrategyContentService) private readonly content: ContinuousStrategyContentService
  ) {}

  async enqueueForWindow(tx: Tx, windowId: string, onlyRoleId?: string) {
    const window = await tx.actionWindow.findUnique({
      where: { id: windowId },
      include: {
        node: true,
        participants: true,
        openingProjections: true,
        interactionRequests: { where: { status: "OPEN" } },
        run: { include: { roles: true, roleControls: true, roleAssets: true } }
      }
    });
    if (!window || window.status === "PREPARING") return [];
    const gameContent = this.content.forGame(window.run.templateKey, window.run.strategyVersion);
    const created: string[] = [];
    for (const control of window.run.roleControls.filter((entry) => entry.mode === "AI_ACTIVE" && (!onlyRoleId || entry.roleId === onlyRoleId))) {
      const role = window.run.roles.find((entry) => entry.id === control.roleId);
      const participant = window.participants.find((entry) => entry.roleId === control.roleId);
      const opening = window.openingProjections.find((entry) => entry.roleId === control.roleId);
      if (!role || !participant || !opening) continue;
      const slot = this.openSlot(window.status, participant);
      if (!slot) continue;
      const taskDedupeKey = `ROLE_AGENT:${window.id}:${role.id}:${slot}:${control.epoch}`;
      const existing = await tx.storyTaskOutbox.findUnique({ where: { dedupeKey: taskDedupeKey } });
      if (existing) { created.push(existing.id); continue; }
      const context = this.decisionContext(gameContent, window, role, control.epoch, slot);
      const policy = gameContent.agentPolicy(window.node.nodeIndex, role.roleKey);
      const projectionPayload = {
        schemaVersion: "role_agent_projection_v1",
        runId: window.runId,
        windowId: window.id,
        stageIndex: window.node.nodeIndex,
        roleId: role.id,
        roleKey: role.roleKey,
        actionSlot: slot,
        controlEpoch: control.epoch,
        templateKey: window.run.templateKey,
        strategyVersion: window.run.strategyVersion,
        contentVersion: gameContent.package().manifest.contentVersion,
        openingSnapshotVersion: opening.snapshotVersion,
        openingProjection: opening.projectionJson,
        availableActionKeys: context.availableActionKeys,
        authorizedTargetRoleIds: context.authorizedTargetRoleIds,
        ownedLeverageKeys: context.ownedLeverageKeys,
        visibleFactIds: context.visibleFactIds
      };
      const projection = await tx.roleAgentProjection.create({
        data: {
          runId: window.runId,
          windowId: window.id,
          roleId: role.id,
          actionSlot: slot,
          controlEpoch: control.epoch,
          policyVersion: policy.policyVersion,
          openingSnapshotVersion: opening.snapshotVersion,
          projectionJson: projectionPayload as Prisma.InputJsonValue,
          contentHash: sha256Canonical(projectionPayload)
        }
      });
      const decision = await tx.roleAgentDecision.create({
        data: {
          runId: window.runId,
          windowId: window.id,
          roleId: role.id,
          actionSlot: slot,
          controlEpoch: control.epoch,
          policyVersion: policy.policyVersion,
          openingSnapshotVersion: opening.snapshotVersion,
          taskDedupeKey,
          projectionId: projection.id,
          visibleFactIdsJson: context.visibleFactIds as Prisma.InputJsonValue
        }
      });
      const task = await tx.storyTaskOutbox.create({
        data: {
          runId: window.runId,
          nodeId: window.nodeId,
          windowId: window.id,
          roleId: role.id,
          actionSlot: slot,
          controlEpoch: control.epoch,
          dedupeKey: taskDedupeKey,
          taskType: "ROLE_AGENT_DECISION",
          status: "pending",
          inputRefId: decision.id,
          maxAttempts: 3
        }
      });
      created.push(task.id);
    }
    return created;
  }

  async execute(taskId: string, fence: RoleAgentTaskFence) {
    const task = await this.prisma.storyTaskOutbox.findUnique({ where: { id: taskId } });
    if (!task || task.taskType !== "ROLE_AGENT_DECISION" || !task.inputRefId) return { outcome: "NO_OP" };
    if (task.status !== "running" || task.leaseOwner !== fence.leaseOwner || task.leaseVersion !== fence.leaseVersion
      || !task.leaseExpiresAt || task.leaseExpiresAt.getTime() <= Date.now()) {
      return { outcome: "LEASE_LOST" };
    }
    const decisionRecord = await this.prisma.roleAgentDecision.findUnique({
      where: { id: task.inputRefId },
      include: { projection: true, role: true, window: { include: { node: true, run: { select: { templateKey: true, strategyVersion: true } } } } }
    });
    if (!decisionRecord || decisionRecord.status !== "PENDING") return { outcome: decisionRecord?.status || "NO_OP" };
    const gameContent = this.content.forGame(decisionRecord.window.run.templateKey, decisionRecord.window.run.strategyVersion);
    const projection = decisionRecord.projection.projectionJson as Record<string, any>;
    const validationContext: RoleAgentDecisionValidationContext = {
      taskDedupeKey: decisionRecord.taskDedupeKey,
      slot: decisionRecord.actionSlot as PlayerActionSlot,
      availableActionKeys: stringArray(projection.availableActionKeys),
      authorizedTargetRoleIds: stringArray(projection.authorizedTargetRoleIds),
      ownedLeverageKeys: stringArray(projection.ownedLeverageKeys),
      visibleFactIds: stringArray(projection.visibleFactIds)
    };
    const selected = await this.choose(gameContent, decisionRecord.role.roleKey, decisionRecord.window.node.nodeIndex, validationContext, projection);
    maybeInjectRoleAgentFault("PROVIDER_RETURNED", taskId);
    const sealed = await roomSerializableTransaction(this.prisma, decisionRecord.runId, async (tx) => {
      // This is deliberately the first statement in the sealing transaction.
      // The conditional write both validates and locks the leased task row, so
      // a reclaimer cannot advance leaseVersion while this transaction seals.
      if (!await this.holdLease(tx, fence)) return { outcome: "LEASE_LOST" };
      const control = await tx.roleControl.findUnique({ where: { runId_roleId: { runId: decisionRecord.runId, roleId: decisionRecord.roleId } } });
      const participant = await tx.actionWindowParticipant.findUnique({ where: { windowId_roleId: { windowId: decisionRecord.windowId, roleId: decisionRecord.roleId } } });
      const window = await tx.actionWindow.findUnique({ where: { id: decisionRecord.windowId } });
      if (!control || control.mode !== "AI_ACTIVE" || control.epoch !== decisionRecord.controlEpoch
        || !participant || !window || !this.slotStillOpen(window.status, participant, decisionRecord.actionSlot as PlayerActionSlot)) {
        await tx.roleAgentDecision.update({ where: { id: decisionRecord.id }, data: { status: "STALE", completedAt: new Date(), lastError: "CONTROL_EPOCH_OR_SLOT_MOVED" } });
        if (!await this.holdLease(tx, fence)) throw new Error("ROLE_AGENT_TASK_LEASE_LOST");
        return { outcome: "STALE" };
      }
      if (selected.decision.decisionKind === "PASS") {
        const passedAt = new Date();
        await tx.actionWindowParticipant.update({
          where: { windowId_roleId: { windowId: window.id, roleId: decisionRecord.roleId } },
          data: { maneuverStatus: "PASSED", maneuverUsedAt: passedAt, doneAt: passedAt, version: { increment: 1 } }
        });
        await tx.roleAgentDecision.update({
          where: { id: decisionRecord.id },
          data: {
            status: "PASS", chosenActionKey: null, provider: selected.provider, modelName: selected.model,
            providerAttempts: selected.attempts, providerResponseHash: selected.responseHash,
            shortRationale: selected.decision.shortRationale, guardDecisionJson: { status: "ok" } as Prisma.InputJsonValue,
            lastError: selected.errorSummary,
            completedAt: new Date()
          }
        });
        await tx.storyRun.update({ where: { id: decisionRecord.runId }, data: { version: { increment: 1 } } });
        if (!await this.holdLease(tx, fence)) throw new Error("ROLE_AGENT_TASK_LEASE_LOST");
        return { outcome: "PASS" };
      }
      const action = this.configuredAction(gameContent, decisionRecord.role.roleKey, decisionRecord.window.node.nodeIndex, validationContext.slot, selected.decision.chosenActionKey!);
      const now = new Date();
      const playerAction = await tx.playerAction.create({
        data: {
          runId: decisionRecord.runId,
          nodeId: decisionRecord.window.node.id,
          chapterIndex: decisionRecord.window.node.chapterIndex,
          roleId: decisionRecord.roleId,
          playerType: "ai",
          actionType: action.actionType,
          targetType: selected.decision.targetRoleId ? "role" : "contest",
          targetId: selected.decision.targetRoleId,
          targetText: action.title,
          method: action.title,
          intent: action.objective,
          riskLevel: action.risk,
          normalizedJson: action.normalized as Prisma.InputJsonValue,
          guardStatus: "ok",
          auditStatus: "ok",
          status: "accepted",
          actionSlot: validationContext.slot,
          actorKind: "AI_TAKEOVER",
          controlEpoch: decisionRecord.controlEpoch,
          policyVersion: decisionRecord.policyVersion,
          provider: selected.provider,
          modelName: selected.model,
          actionKey: selected.decision.chosenActionKey,
          idempotencyKey: `agent-action:${decisionRecord.taskDedupeKey}`,
          requestHash: sha256Canonical({ decision: selected.decision, projectionHash: decisionRecord.projection.contentHash }),
          sourceInteractionRequestId: validationContext.slot === "REACTION" ? projection.pendingInteractionRequestId || undefined : undefined,
          visibility: action.visibility,
          targetRoleId: selected.decision.targetRoleId,
          leverageKey: selected.decision.leverageKey,
          sealedAt: now,
          immediateJson: { text: action.receipt, agent: true } as Prisma.InputJsonValue
        }
      });
      if (validationContext.slot === "MAIN") {
        await tx.actionWindowParticipant.update({
          where: { windowId_roleId: { windowId: window.id, roleId: decisionRecord.roleId } },
          data: { mainStatus: "SUBMITTED", maneuverStatus: "AVAILABLE", version: { increment: 1 } }
        });
        await this.createRequests(tx, gameContent, decisionRecord, playerAction.id, action.interactionRequestKeys);
      } else if (validationContext.slot === "MANEUVER") {
        await tx.actionWindowParticipant.update({
          where: { windowId_roleId: { windowId: window.id, roleId: decisionRecord.roleId } },
          data: { maneuverStatus: "SUBMITTED", maneuverUsedAt: now, doneAt: now, version: { increment: 1 } }
        });
      } else {
        const requestId = String(projection.pendingInteractionRequestId || "");
        if (requestId) await tx.interactionRequest.update({ where: { id: requestId }, data: { status: "RESPONDED", responseActionId: playerAction.id } });
        await tx.actionWindowParticipant.update({
          where: { windowId_roleId: { windowId: window.id, roleId: decisionRecord.roleId } },
          data: { reactionStatus: "RESPONDED", reactionUsedAt: now, version: { increment: 1 } }
        });
      }
      await tx.roleAgentDecision.update({
        where: { id: decisionRecord.id },
        data: {
          status: selected.fallback ? "SEALED_FALLBACK" : "SEALED_ACT",
          chosenActionKey: selected.decision.chosenActionKey,
          targetRoleId: selected.decision.targetRoleId,
          leverageKey: selected.decision.leverageKey,
          shortRationale: selected.decision.shortRationale,
          provider: selected.provider,
          modelName: selected.model,
          providerAttempts: selected.attempts,
          providerResponseHash: selected.responseHash,
          lastError: selected.errorSummary,
          guardDecisionJson: { status: "ok", visibleFactIds: selected.decision.visibleFactIds } as Prisma.InputJsonValue,
          playerActionId: playerAction.id,
          completedAt: now
        }
      });
      await tx.storyRun.update({ where: { id: decisionRecord.runId }, data: { version: { increment: 1 } } });
      if (!await this.holdLease(tx, fence)) throw new Error("ROLE_AGENT_TASK_LEASE_LOST");
      return { outcome: selected.fallback ? "SEALED_FALLBACK" : "SEALED_ACT", playerActionId: playerAction.id };
    });
    if (["PASS", "SEALED_FALLBACK", "SEALED_ACT"].includes(sealed.outcome)) {
      maybeInjectRoleAgentFault("ACTION_SEALED", taskId);
    }
    return sealed;
  }

  private async holdLease(tx: Tx, fence: RoleAgentTaskFence) {
    const held = await tx.storyTaskOutbox.updateMany({
      where: {
        id: fence.taskId,
        status: "running",
        leaseOwner: fence.leaseOwner,
        leaseVersion: fence.leaseVersion,
        leaseExpiresAt: { gt: new Date() }
      },
      data: { leaseOwner: fence.leaseOwner }
    });
    return held.count === 1;
  }

  private decisionContext(content: BoundContinuousStrategyContent, window: any, role: any, epoch: number, slot: PlayerActionSlot): RoleAgentDecisionValidationContext {
    const roleIdsByKey = new Map(window.run.roles.map((entry: any) => [entry.roleKey, entry.id]));
    const visibleFactIds = stringArray((window.openingProjections.find((entry: any) => entry.roleId === role.id)?.projectionJson as any)?.knownFactIds);
    if (slot === "MAIN") {
      const cards = content.roleStage(window.node.nodeIndex, role.roleKey).mainCards;
      return {
        taskDedupeKey: `ROLE_AGENT:${window.id}:${role.id}:${slot}:${epoch}`,
        slot,
        availableActionKeys: cards.map((card) => card.actionKey),
        authorizedTargetRoleIds: cards.map((card) => roleIdsByKey.get(card.targetRoleKey)).filter(Boolean) as string[],
        ownedLeverageKeys: window.run.roleAssets.filter((asset: any) => asset.ownerRoleId === role.id && asset.status === "ACTIVE").map((asset: any) => asset.assetKey),
        visibleFactIds
      };
    }
    if (slot === "MANEUVER") {
      const maneuver = content.maneuver(window.node.nodeIndex, role.roleKey)!;
      return {
        taskDedupeKey: `ROLE_AGENT:${window.id}:${role.id}:${slot}:${epoch}`,
        slot,
        availableActionKeys: [maneuver.maneuverStrategyKey],
        authorizedTargetRoleIds: maneuver.allowedTargetRoleKeys.map((key) => roleIdsByKey.get(key)).filter(Boolean) as string[],
        ownedLeverageKeys: maneuver.leverageAssetKeys.filter((key) => window.run.roleAssets.some((asset: any) => asset.assetKey === key && asset.ownerRoleId === role.id)),
        visibleFactIds
      };
    }
    const reaction = content.reaction(window.node.nodeIndex, role.roleKey);
    return {
      taskDedupeKey: `ROLE_AGENT:${window.id}:${role.id}:${slot}:${epoch}`,
      slot,
      availableActionKeys: reaction?.responseOptions.map((option) => option.actionKey) || [],
      authorizedTargetRoleIds: reaction ? [roleIdsByKey.get(reaction.sourceRoleKey)].filter(Boolean) as string[] : [],
      ownedLeverageKeys: [],
      visibleFactIds
    };
  }

  private async choose(content: BoundContinuousStrategyContent, roleKey: string, stageIndex: number, context: RoleAgentDecisionValidationContext, projection: Record<string, unknown>) {
    const fallback = this.fallbackDecision(content, roleKey, stageIndex, context);
    const provider = String(process.env.ROLE_AGENT_PROVIDER || (process.env.DEEPSEEK_API_KEY ? "deepseek" : "rules"));
    const model = provider === "deepseek" ? String(process.env.ROLE_AGENT_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat") : "deterministic-rules-v1";
    if (provider !== "deepseek" || !process.env.DEEPSEEK_API_KEY) {
      return { decision: fallback, provider: "rules", model, attempts: 0, responseHash: sha256Canonical(fallback), fallback: false, errorSummary: null };
    }
    let errors: string[] = [];
    let attempts = 0;
    // The timeout is a total provider budget, not a per-attempt multiplier.
    // A fast invalid response may still be repaired once; a slow response
    // falls back immediately so every role stays inside the five-second SLA.
    const providerDeadline = Date.now() + normalizeRoleAgentAttemptTimeoutMs(process.env.ROLE_AGENT_TIMEOUT_MS);
    for (let attempt = 1; attempt <= ROLE_AGENT_PROVIDER_ATTEMPTS; attempt += 1) {
      const remainingMs = providerDeadline - Date.now();
      if (remainingMs < 250) {
        errors = [...errors, "ROLE_AGENT_PROVIDER_BUDGET_EXHAUSTED"];
        break;
      }
      attempts = attempt;
      try {
        const candidate = await this.deepSeekDecision(roleKey, stageIndex, context, projection, errors, remainingMs);
        const validation = validateRoleAgentDecisionV1(candidate, context);
        if (validation.ok) return { decision: validation.value, provider: "deepseek", model, attempts: attempt, responseHash: sha256Canonical(validation.value), fallback: false, errorSummary: null };
        errors = validation.errors;
      } catch (error) {
        errors = [error instanceof Error ? error.message : String(error)];
      }
    }
    this.logger.warn(`Role Agent fell back for ${context.taskDedupeKey}: ${errors.join("|")}`);
    return { decision: fallback, provider: "deepseek", model, attempts, responseHash: sha256Canonical(fallback), fallback: true, errorSummary: (errors.join("|") || "PROVIDER_VALIDATION_FAILED").slice(0, 1_000) };
  }

  private async deepSeekDecision(roleKey: string, stageIndex: number, context: RoleAgentDecisionValidationContext, projection: Record<string, unknown>, priorErrors: string[], timeoutMs: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(250, Math.trunc(timeoutMs)));
    try {
      const response = await fetch(deepSeekChatCompletionsUrl(process.env.DEEPSEEK_BASE_URL), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: String(process.env.ROLE_AGENT_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat"),
          response_format: { type: "json_object" },
          temperature: 0.2,
          messages: [
            { role: "system", content: "You are one bounded game role. Return only the requested JSON. Never invent facts, tools, payments, outcomes, or another role's private state." },
            { role: "user", content: JSON.stringify({
                roleKey,
                stageIndex,
                contract: context,
                projection,
                priorValidationErrors: priorErrors,
                outputConstraints: {
                  exactSchemaVersion: ROLE_AGENT_DECISION_SCHEMA_VERSION,
                  exactTaskDedupeKey: context.taskDedupeKey,
                  decisionKind: context.availableActionKeys.length ? "ACT" : "PASS",
                  chosenActionKeyMustBeOneOf: context.availableActionKeys,
                  targetRoleIdMustBeNullOrOneOf: context.authorizedTargetRoleIds,
                  leverageKeyMustBeNullOrOneOf: context.ownedLeverageKeys,
                  visibleFactIdsMustBeSubsetOf: context.visibleFactIds,
                  requiredKeys: ["schemaVersion", "taskDedupeKey", "decisionKind", "chosenActionKey", "targetRoleId", "leverageKey", "visibleFactIds", "shortRationale"]
                }
              }) }
          ]
        })
      });
      if (!response.ok) throw new Error(`ROLE_AGENT_PROVIDER_HTTP_${response.status}`);
      const payload = await response.json() as any;
      const content = String(payload?.choices?.[0]?.message?.content || "");
      return JSON.parse(content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    } finally { clearTimeout(timer); }
  }

  private fallbackDecision(content: BoundContinuousStrategyContent, roleKey: string, stageIndex: number, context: RoleAgentDecisionValidationContext): RoleAgentDecisionV1 {
    if (context.slot === "MANEUVER" && context.availableActionKeys.length === 0) {
      return { schemaVersion: ROLE_AGENT_DECISION_SCHEMA_VERSION, taskDedupeKey: context.taskDedupeKey, decisionKind: "PASS", chosenActionKey: null, targetRoleId: null, leverageKey: null, visibleFactIds: [], shortRationale: "无合法谋划，保持角色立场。" };
    }
    const policy = content.agentPolicy(stageIndex, roleKey);
    const weighted = context.slot === "MAIN"
      ? [...policy.actionWeights].filter((entry) => context.availableActionKeys.includes(entry.actionKey)).sort((a, b) => b.weight - a.weight)[0]?.actionKey
      : context.availableActionKeys[0];
    return {
      schemaVersion: ROLE_AGENT_DECISION_SCHEMA_VERSION,
      taskDedupeKey: context.taskDedupeKey,
      decisionKind: "ACT",
      chosenActionKey: weighted || context.availableActionKeys[0],
      targetRoleId: context.authorizedTargetRoleIds[0] || null,
      leverageKey: context.ownedLeverageKeys[0] || null,
      visibleFactIds: [],
      shortRationale: "依据角色目标、风险偏好和当前可见局势行动。"
    };
  }

  private configuredAction(content: BoundContinuousStrategyContent, roleKey: string, stageIndex: number, slot: PlayerActionSlot, actionKey: string) {
    if (slot === "MAIN") {
      const card = content.roleStage(stageIndex, roleKey).mainCards.find((entry) => entry.actionKey === actionKey)!;
      return { title: card.title, objective: card.objective, risk: card.risk.toLowerCase(), visibility: card.visibility, normalized: card, receipt: card.receipt.text, interactionRequestKeys: card.effect.interactionRequestKeys, actionType: "role_card" };
    }
    if (slot === "MANEUVER") {
      const maneuver = content.maneuver(stageIndex, roleKey, actionKey)!;
      return { title: maneuver.title, objective: maneuver.objective, risk: "normal", visibility: "LIMITED", normalized: maneuver, receipt: `谋划已封存：${maneuver.title}`, interactionRequestKeys: [], actionType: maneuver.allowedTypes[0] || "maneuver" };
    }
    const reaction = content.reaction(stageIndex, roleKey, actionKey)!;
    const option = reaction.responseOptions.find((entry) => entry.actionKey === actionKey)!;
    return { title: option.title, objective: option.nextStateKey, risk: "normal", visibility: "LIMITED", normalized: { reactionKey: reaction.reactionKey, option }, receipt: `回应已封存：${option.title}`, interactionRequestKeys: [], actionType: "directed_reaction" };
  }

  private async createRequests(tx: Tx, content: BoundContinuousStrategyContent, decision: any, actionId: string, requestKeys: string[]) {
    if (!requestKeys.length) return;
    const stage = content.stage(decision.window.node.nodeIndex);
    const roles = await tx.storyRole.findMany({ where: { runId: decision.runId } });
    const window = await tx.actionWindow.findUniqueOrThrow({ where: { id: decision.windowId } });
    const config = window.configJson as Record<string, any>;
    const expiresAt = window.graceClosesAt || new Date((window.mainClosesAt?.getTime() || Date.now()) + Number(config?.timing?.graceSeconds || 45) * 1_000);
    for (const key of requestKeys) {
      const definition = stage.interactionRequestCatalog.find((entry) => entry.requestKey === key);
      const target = roles.find((entry) => entry.roleKey === definition?.targetRoleKey);
      if (!definition || !target) continue;
      if (!content.reaction(decision.window.node.nodeIndex, target.roleKey)) continue;
      const existing = await tx.interactionRequest.findFirst({ where: { nodeId: decision.window.node.id, targetRoleId: target.id, status: "OPEN" } });
      if (existing) continue;
      await tx.interactionRequest.create({
        data: { runId: decision.runId, nodeId: decision.window.node.id, windowId: decision.windowId, sourceActionId: actionId, targetRoleId: target.id, eventType: definition.eventType, priority: 100, expiresAt, defaultOutcomeJson: { outcomeKey: definition.defaultOutcomeKey, principle: "PRESERVE_CURRENT_HOLDING" } as Prisma.InputJsonValue, dedupeKey: `INTERACTION:${decision.windowId}:${key}` }
      });
      await tx.actionWindowParticipant.update({ where: { windowId_roleId: { windowId: decision.windowId, roleId: target.id } }, data: { reactionStatus: "PENDING", version: { increment: 1 } } });
    }
  }

  private openSlot(windowStatus: string, participant: any): PlayerActionSlot | null {
    if (windowStatus === "MAIN_OPEN" && participant.mainStatus === "PENDING") return "MAIN";
    if (windowStatus === "INTERACTION_GRACE" && participant.reactionStatus === "PENDING") return "REACTION";
    if (windowStatus === "INTERACTION_GRACE" && participant.maneuverStatus === "AVAILABLE") return "MANEUVER";
    return null;
  }

  private slotStillOpen(windowStatus: string, participant: any, slot: PlayerActionSlot) {
    return this.openSlot(windowStatus, participant) === slot;
  }
}


export function deepSeekChatCompletionsUrl(raw?: string) {
  const url = new URL(String(raw || "https://api.deepseek.com"));
  const path = url.pathname.replace(/\/+$/, "");
  if (!path || path === "/v1") url.pathname = `${path}/chat/completions`;
  return url.toString();
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
