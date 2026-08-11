import { createHash } from "node:crypto";
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type AEmotionStageMilestone } from "@prisma/client";
import {
  A_EMOTION_KEY_MODAL_SCHEMA_VERSION,
  A_EMOTION_M2_PROJECTION_SCHEMA_VERSION,
  A_EMOTION_M5_EVENT_FAMILY,
  A_EMOTION_M5_EVENT_TYPE,
  A_EMOTION_M5_MILESTONE_SCHEMA_VERSION,
  A_EMOTION_M5_SHARED_OBJECT_ID,
  A_EMOTION_M5_STAGE_VICTORY_PRIORITY,
  A_EMOTION_M5_SUMMARY_SCHEMA_VERSION,
  validateAEmotionInteractionSummaryV1,
  validateAEmotionKeyModalV1,
  validateAEmotionM2ProjectionV1,
  validateAEmotionStageMilestoneV1,
  type AEmotionInteractionSummaryEntryV1,
  type AEmotionInteractionSummaryV1,
  type AEmotionKeyModalV1,
  type AEmotionM2ProjectionV1,
  type AEmotionStageMilestoneRuleV1,
  type AEmotionStageMilestoneV1
} from "@ai-story/shared";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { aEmotionM5Rules, isAEmotionM5EnabledForRun, type AEmotionM5RunGate } from "../config/a-emotion-m5.config";
import { aEmotionSangtianLifecycleBridge } from "../config/a-emotion-sangtian-lifecycle.config";
import { ContinuousEventDeliveryService } from "../continuous-strategy/event-delivery.service";
import { PrismaService } from "../prisma.service";

export const A_EMOTION_M5_TASK_TYPE = "A_EMOTION_M5_STAGE_MILESTONE_COMPILE" as const;

type Tx = Prisma.TransactionClient;
type CanonicalCodes = { actionCodes: string[]; effectCodes: string[]; factCodes: string[] };
type RunInput = AEmotionM5RunGate & { id: string; currentNodeId: string | null; stateJson: unknown };

type StoredReward = {
  metricKey: string | null;
  metricDelta: number;
  metricBefore: number | null;
  metricAfter: number | null;
  capabilityCodes: string[];
  restrictionCodes: string[];
};

export function evaluateAEmotionStageMilestone(rule: AEmotionStageMilestoneRuleV1, codes: CanonicalCodes) {
  // Original-ledger control is intentionally excluded from the synthetic-code
  // evaluator. Its only production authority is the committed RoleAsset and
  // RoleAssetMutation state inspected by applyAuthoritativeMilestones().
  if (rule.milestoneCode === "CONTROL_ORIGINAL_LEDGER") return "UNCHANGED" as const;
  if (matchesRule(rule.revokeActionCodes, rule.revokeEffectCodes, rule.revokeFactCodes, codes)) return "REVOKE" as const;
  if (matchesRule(rule.requiredActionCodes, rule.requiredEffectCodes, rule.requiredFactCodes, codes)) return "ACHIEVE" as const;
  return "UNCHANGED" as const;
}

export function stageMilestoneIdentity(runId: string, stageId: string, milestoneCode: string, beneficiaryRoleId: string) {
  if (!runId || !stageId || !milestoneCode || !beneficiaryRoleId) throw new Error("A_EMOTION_M5_MILESTONE_IDENTITY_INVALID");
  const key = `aemotion:m5:${runId}:${stageId}:${milestoneCode}:${beneficiaryRoleId}`;
  return { milestoneId: opaqueId("ms", key), aggregateKey: key, aggregateId: opaqueId("agg", key) };
}

@Injectable()
export class AEmotionM5Service {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ContinuousEventDeliveryService) private readonly deliveries: ContinuousEventDeliveryService
  ) {}

  /** Called inside the authoritative ActionResolution transaction. */
  async applyAuthoritativeMilestones(tx: Tx, input: {
    run: RunInput;
    beneficiaryRoleId: string;
    sourceResolutionId: string;
    sourceActionId: string;
    stageIndex: number;
    actionCodes: string[];
    effectCodes: string[];
    factCodes: string[];
  }) {
    if (!isAEmotionM5EnabledForRun(input.run)) return { outcome: "FLAG_DISABLED" as const, updated: [] as AEmotionStageMilestoneV1[] };
    if (!input.run.currentNodeId) throw new ConflictException({ code: "CURRENT_NODE_REQUIRED", message: "The run has no causal node" });
    if (!input.beneficiaryRoleId || !input.sourceResolutionId || !input.sourceActionId || !Number.isInteger(input.stageIndex) || input.stageIndex < 1) throw new Error("A_EMOTION_M5_INPUT_INVALID");
    const resolution = await tx.actionResolution.findUnique({ where: { id: input.sourceResolutionId }, select: { runId: true, roleId: true, playerActionId: true, qualityStatus: true } });
    if (!resolution || resolution.runId !== input.run.id || resolution.roleId !== input.beneficiaryRoleId || resolution.playerActionId !== input.sourceActionId || resolution.qualityStatus !== "PASS") throw new ServiceUnavailableException({ code: "A_EMOTION_M5_CANONICAL_CONTEXT_MISMATCH", message: "Milestone basis is not a committed canonical result" });

    const stageId = `stage-${Math.max(1, Math.trunc(input.stageIndex))}`;
    const codes = normalizedCodes(input);
    const updated: AEmotionStageMilestoneV1[] = [];
    const rules = aEmotionM5Rules();
    const controlRule = rules.find((rule) => rule.milestoneCode === "CONTROL_ORIGINAL_LEDGER");
    if (!controlRule) throw new ServiceUnavailableException({ code: "A_EMOTION_M5_CONTROL_RULE_MISSING", message: "Original-ledger control rule is missing" });

    const custody = await authoritativeOriginalLedgerCustodyMutation(tx, input.run.id, input.sourceActionId);
    if (custody) {
      if (custody.fromRoleId && custody.fromRoleId !== custody.toRoleId) {
        updated.push(...await this.revokeControlMilestones(tx, {
          runId: input.run.id,
          beneficiaryRoleId: custody.fromRoleId,
          sourceResolutionId: input.sourceResolutionId
        }));
      }
      if (custody.toRoleId
        && custody.ownerRoleId === custody.toRoleId
        && custody.status === "ACTIVE"
        && custody.quantity > 0) {
        const evidenceRefs = uniqueStrings([
          `role-asset:${custody.assetId}:${custody.assetKey}:v${custody.version}`,
          `asset-mutation:${custody.mutationId}:${input.sourceActionId}`,
          `action:${input.sourceActionId}`
        ]);
        const achieved = await this.achieveMilestone(tx, {
          run: input.run,
          stageId,
          stageIndex: input.stageIndex,
          rule: controlRule,
          beneficiaryRoleId: custody.toRoleId,
          sourceResolutionId: input.sourceResolutionId,
          evidenceRefs
        });
        if (achieved) updated.push(achieved);
      }
    }

    // CONTROL_ORIGINAL_LEDGER is state-authoritative. Other world-neutral
    // milestones continue to use exact canonical action/effect/fact contracts.
    for (const rule of rules) {
      if (rule.milestoneCode === "CONTROL_ORIGINAL_LEDGER") continue;
      const outcome = evaluateAEmotionStageMilestone(rule, codes);
      if (outcome === "UNCHANGED") continue;
      if (outcome === "REVOKE") {
        updated.push(...await this.revokeCurrentStageMilestone(tx, {
          runId: input.run.id,
          stageId,
          milestoneCode: rule.milestoneCode,
          beneficiaryRoleId: input.beneficiaryRoleId,
          sourceResolutionId: input.sourceResolutionId
        }));
        continue;
      }
      const evidenceRefs = evidenceRefsFor(rule, codes);
      if (!evidenceRefs.length) throw new ServiceUnavailableException({ code: "A_EMOTION_M5_EVIDENCE_REQUIRED", message: "Milestone achievement requires canonical evidence" });
      const achieved = await this.achieveMilestone(tx, {
        run: input.run,
        stageId,
        stageIndex: input.stageIndex,
        rule,
        beneficiaryRoleId: input.beneficiaryRoleId,
        sourceResolutionId: input.sourceResolutionId,
        evidenceRefs
      });
      if (achieved) updated.push(achieved);
    }
    return { outcome: updated.length ? "UPDATED" as const : "NO_MATCH" as const, updated };
  }

  private async achieveMilestone(tx: Tx, input: {
    run: RunInput;
    stageId: string;
    stageIndex: number;
    rule: AEmotionStageMilestoneRuleV1;
    beneficiaryRoleId: string;
    sourceResolutionId: string;
    evidenceRefs: string[];
  }): Promise<AEmotionStageMilestoneV1 | null> {
    const identity = stageMilestoneIdentity(input.run.id, input.stageId, input.rule.milestoneCode, input.beneficiaryRoleId);
    await advisoryLock(tx, identity.aggregateKey);
    const existing = await tx.aEmotionStageMilestone.findUnique({
      where: {
        runId_stageId_milestoneCode_beneficiaryRoleId: {
          runId: input.run.id,
          stageId: input.stageId,
          milestoneCode: input.rule.milestoneCode,
          beneficiaryRoleId: input.beneficiaryRoleId
        }
      }
    });
    if (existing) return milestoneContract(existing);
    if (!input.evidenceRefs.length) throw new ServiceUnavailableException({ code: "A_EMOTION_M5_EVIDENCE_REQUIRED", message: "Milestone achievement requires canonical evidence" });

    const reward = await applyRewardToRunState(tx, input.run.id, input.beneficiaryRoleId, input.rule);
    const milestone = await tx.aEmotionStageMilestone.create({ data: {
      id: identity.milestoneId,
      roomId: input.run.id,
      runId: input.run.id,
      stageId: input.stageId,
      milestoneCode: input.rule.milestoneCode,
      beneficiaryRoleId: input.beneficiaryRoleId,
      status: "ACHIEVED",
      stateVersion: 1,
      evidenceRefsJson: input.evidenceRefs as Prisma.InputJsonValue,
      rewardJson: reward as unknown as Prisma.InputJsonValue,
      sourceResolutionId: input.sourceResolutionId,
      achievedAt: new Date()
    } });

    const human = await tx.storyPlayer.findFirst({
      where: {
        runId: input.run.id,
        roleId: input.beneficiaryRoleId,
        playerType: "human",
        status: "active",
        userId: { not: null }
      },
      select: { userId: true }
    });
    if (human?.userId) {
      const dedupeKey = `${A_EMOTION_M5_TASK_TYPE}:${milestone.id}:1`;
      if (!await tx.storyTaskOutbox.findUnique({ where: { dedupeKey }, select: { id: true } })) {
        await tx.storyTaskOutbox.create({ data: {
          runId: input.run.id,
          nodeId: input.run.currentNodeId!,
          roleId: input.beneficiaryRoleId,
          inputRefId: milestone.id,
          actionSlot: "A_EMOTION_M5",
          taskType: A_EMOTION_M5_TASK_TYPE,
          status: "PENDING",
          dedupeKey,
          maxAttempts: 5,
          resultJson: {
            schemaVersion: "a_emotion_m5_compile_requested_v1",
            milestoneId: milestone.id,
            stageId: input.stageId,
            stageIndex: Math.max(1, Math.trunc(input.stageIndex)),
            stateVersion: 1,
            viewerUserId: human.userId,
            sourceResolutionId: input.sourceResolutionId
          } as Prisma.InputJsonValue
        } });
      }
    }
    return milestoneContract(milestone);
  }

  private async revokeControlMilestones(tx: Tx, input: {
    runId: string;
    beneficiaryRoleId: string;
    sourceResolutionId: string;
  }) {
    const existing = await tx.aEmotionStageMilestone.findMany({
      where: {
        runId: input.runId,
        milestoneCode: "CONTROL_ORIGINAL_LEDGER",
        beneficiaryRoleId: input.beneficiaryRoleId,
        status: "ACHIEVED"
      },
      orderBy: { achievedAt: "asc" }
    });
    const revoked: AEmotionStageMilestoneV1[] = [];
    for (const milestone of existing) {
      const identity = stageMilestoneIdentity(input.runId, milestone.stageId, milestone.milestoneCode, input.beneficiaryRoleId);
      await advisoryLock(tx, identity.aggregateKey);
      const current = await tx.aEmotionStageMilestone.findUnique({ where: { id: milestone.id } });
      if (!current || current.status !== "ACHIEVED") continue;
      const next = await tx.aEmotionStageMilestone.update({
        where: { id: current.id },
        data: { status: "REVOKED", stateVersion: { increment: 1 }, revokedAt: new Date(), sourceResolutionId: input.sourceResolutionId }
      });
      revoked.push(milestoneContract(next));
    }
    return revoked;
  }

  private async revokeCurrentStageMilestone(tx: Tx, input: {
    runId: string;
    stageId: string;
    milestoneCode: string;
    beneficiaryRoleId: string;
    sourceResolutionId: string;
  }) {
    const identity = stageMilestoneIdentity(input.runId, input.stageId, input.milestoneCode, input.beneficiaryRoleId);
    await advisoryLock(tx, identity.aggregateKey);
    const existing = await tx.aEmotionStageMilestone.findUnique({
      where: {
        runId_stageId_milestoneCode_beneficiaryRoleId: {
          runId: input.runId,
          stageId: input.stageId,
          milestoneCode: input.milestoneCode,
          beneficiaryRoleId: input.beneficiaryRoleId
        }
      }
    });
    if (!existing || existing.status !== "ACHIEVED") return [];
    const revoked = await tx.aEmotionStageMilestone.update({
      where: { id: existing.id },
      data: { status: "REVOKED", stateVersion: { increment: 1 }, revokedAt: new Date(), sourceResolutionId: input.sourceResolutionId }
    });
    return [milestoneContract(revoked)];
  }

  async executeCompileTask(taskId: string, fence: { taskId: string; leaseOwner: string; leaseVersion: number }) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.storyTaskOutbox.findFirst({ where: { id: taskId, taskType: A_EMOTION_M5_TASK_TYPE, status: "RUNNING", leaseOwner: fence.leaseOwner, leaseVersion: fence.leaseVersion, leaseExpiresAt: { gt: new Date() } } });
      if (!task) return { outcome: "LEASE_LOST" as const };
      const request = compileRequest(task.resultJson);
      const [run, milestone, player] = await Promise.all([
        tx.storyRun.findUnique({ where: { id: task.runId }, select: { id: true, mode: true, maxPlayers: true, templateKey: true, engineVersion: true, stateJson: true } }),
        tx.aEmotionStageMilestone.findUnique({ where: { id: request.milestoneId }, include: { beneficiaryRole: { select: { id: true, roleKey: true, roleName: true } } } }),
        tx.storyPlayer.findFirst({ where: { runId: task.runId, roleId: task.roleId || "", userId: request.viewerUserId, playerType: "human", status: "active" }, select: { userId: true } })
      ]);
      const resolution = milestone?.sourceResolutionId ? await tx.actionResolution.findUnique({ where: { id: milestone.sourceResolutionId }, select: { id: true, runId: true, qualityStatus: true } }) : null;
      if (!run || !milestone || !player?.userId || !resolution || !isAEmotionM5EnabledForRun(run)
        || resolution.runId !== run.id || resolution.qualityStatus !== "PASS"
        || milestone.runId !== run.id || milestone.roomId !== run.id || milestone.id !== task.inputRefId
        || milestone.beneficiaryRoleId !== task.roleId || milestone.status !== "ACHIEVED"
        || milestone.stateVersion !== request.stateVersion || milestone.stageId !== request.stageId
        || milestone.sourceResolutionId !== request.sourceResolutionId) {
        throw new ServiceUnavailableException({ code: "A_EMOTION_M5_CANONICAL_CONTEXT_MISMATCH", message: "Milestone compile context is inconsistent" });
      }
      const evidenceRefs = stringList(milestone.evidenceRefsJson);
      const reward = storedReward(milestone.rewardJson);
      if (!evidenceRefs.length) throw new ServiceUnavailableException({ code: "A_EMOTION_M5_EVIDENCE_REQUIRED", message: "Milestone evidence is missing" });
      const identity = stageMilestoneIdentity(run.id, milestone.stageId, milestone.milestoneCode, milestone.beneficiaryRoleId);
      const eventId = opaqueId("evt", `m5:${milestone.id}:${milestone.stateVersion}`);
      const modalId = opaqueId("mdl", `m5:${milestone.id}:${milestone.stateVersion}`);
      const modal = stageVictoryModal(modalId, eventId, milestone, reward, evidenceRefs);
      const event = await this.deliveries.publishProjected(tx, {
        runId: run.id,
        nodeId: task.nodeId,
        day: request.stageIndex,
        type: A_EMOTION_M5_EVENT_TYPE,
        messageType: "a_emotion_stage_victory",
        visibility: "PRIVATE",
        audienceType: "MEMBER",
        audienceRoleIds: [milestone.beneficiaryRoleId],
        eventId,
        canonicalPayload: {
          schemaVersion: "a_emotion_m5_stage_victory_canonical_v1",
          milestoneId: milestone.id,
          sourceResolutionId: milestone.sourceResolutionId,
          milestoneCode: milestone.milestoneCode,
          stateVersion: milestone.stateVersion
        },
        deliveries: [{
          userId: player.userId,
          roleId: milestone.beneficiaryRoleId,
          aggregate: { aggregateKey: identity.aggregateKey, aggregateId: identity.aggregateId, stageId: milestone.stageId, sharedObjectId: A_EMOTION_M5_SHARED_OBJECT_ID, eventFamily: A_EMOTION_M5_EVENT_FAMILY, category: "RELATED", disclosure: "CONFIRMED", projectionVersion: milestone.stateVersion, stateVersion: milestone.stateVersion },
          buildPayload: (eventSequence, publishedEventId) => stageVictoryProjection(milestone, reward, evidenceRefs, identity.aggregateId, modal, eventSequence, publishedEventId) as unknown as Record<string, unknown>
        }],
        dedupeKey: `A_EMOTION_M5:${milestone.id}:${milestone.stateVersion}`
      });
      if (!await tx.aEmotionKeyModal.findUnique({ where: { id: modalId } })) {
        await tx.aEmotionKeyModal.create({ data: { id: modalId, roomId: run.id, runId: run.id, viewerUserId: player.userId, viewerRoleId: milestone.beneficiaryRoleId, eventId: event.id, modalType: "STAGE_VICTORY", triggerCode: milestone.milestoneCode, triggerVersion: milestone.stateVersion, projectionVersion: milestone.stateVersion, stateVersion: milestone.stateVersion, priority: A_EMOTION_M5_STAGE_VICTORY_PRIORITY, projectionJson: modal as unknown as Prisma.InputJsonValue } });
      }
      await tx.aEmotionStageMilestone.updateMany({ where: { id: milestone.id, sourceEventId: null }, data: { sourceEventId: event.id } });
      return { outcome: "PUBLISHED" as const, eventId: event.id, modalId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async interactionSummary(user: AuthenticatedUser, roomId: string): Promise<AEmotionInteractionSummaryV1> {
    const member = await this.prisma.storyPlayer.findFirst({ where: { runId: roomId, userId: user.id, playerType: "human", status: "active", roleId: { not: null } }, select: { roleId: true } });
    if (!member?.roleId) throw new ForbiddenException({ code: "ROOM_MEMBERSHIP_REQUIRED", message: "Room membership required" });
    const run = await this.prisma.storyRun.findUnique({ where: { id: roomId }, select: { id: true, mode: true, maxPlayers: true, templateKey: true, engineVersion: true, stateJson: true } });
    if (!run || run.mode !== "room") throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    if (!isAEmotionM5EnabledForRun(run)) throw new NotFoundException({ code: "INTERACTION_HISTORY_DISABLED", message: "Interaction history is not enabled" });
    const [rows, milestoneRows] = await Promise.all([
      this.prisma.eventDelivery.findMany({ where: { roomId, userId: user.id, roleId: member.roleId }, orderBy: { deliverySequence: "desc" }, take: 40, select: { eventId: true, category: true, disclosure: true, payloadJson: true, deliveredAt: true } }),
      this.prisma.aEmotionStageMilestone.findMany({ where: { runId: roomId, beneficiaryRoleId: member.roleId }, orderBy: { createdAt: "desc" }, take: 20 })
    ]);
    const influencedMe: AEmotionInteractionSummaryEntryV1[] = [];
    const promiseResults: AEmotionInteractionSummaryEntryV1[] = [];
    for (const row of rows) {
      const projection = viewerProjection(row.payloadJson);
      if (!projection) continue;
      const entry: AEmotionInteractionSummaryEntryV1 = { eventId: row.eventId, category: projection.category, disclosure: projection.disclosure, title: projection.title, safeSummary: projection.summary, statusLabel: projection.sourceStatus, evidenceRefs: projection.disclosure === "CONFIRMED" ? [...(projection.evidenceRefs || [])] : [], occurredAt: projection.occurredAt || row.deliveredAt.toISOString() };
      if (projection.eventFamily === "PROMISE_LIFECYCLE") promiseResults.push(entry);
      else influencedMe.push(entry);
    }
    const summary: AEmotionInteractionSummaryV1 = {
      schemaVersion: A_EMOTION_M5_SUMMARY_SCHEMA_VERSION,
      roomId,
      runId: roomId,
      viewerRoleId: member.roleId,
      generatedAt: new Date().toISOString(),
      influencedMe: influencedMe.slice(0, 20),
      influencedOthers: [],
      promiseResults: promiseResults.slice(0, 20),
      milestones: milestoneRows.map(milestoneContract)
    };
    const validated = validateAEmotionInteractionSummaryV1(summary);
    if (!validated.ok) throw new ServiceUnavailableException({ code: "A_EMOTION_M5_SUMMARY_REJECTED", message: "Interaction summary failed viewer-safety validation" });
    return validated.value;
  }
}

function stageVictoryProjection(milestone: AEmotionStageMilestone, reward: StoredReward, evidenceRefs: string[], aggregateId: string, modal: AEmotionKeyModalV1, eventSequence: number, eventId: string): AEmotionM2ProjectionV1 {
  if (eventId !== modal.eventId) throw new ServiceUnavailableException({ code: "A_EMOTION_M5_EVENT_ID_MISMATCH", message: "Stage victory event id is inconsistent" });
  const visibleImpacts = reward.metricKey && reward.metricBefore !== null && reward.metricAfter !== null
    ? [{ key: reward.metricKey, label: reward.metricKey, before: reward.metricBefore, after: reward.metricAfter, delta: reward.metricDelta, suffix: "%", safeReason: "阶段里程碑的确定性收益" }]
    : [];
  const projection: AEmotionM2ProjectionV1 = {
    schemaVersion: A_EMOTION_M2_PROJECTION_SCHEMA_VERSION,
    projectionVersion: milestone.stateVersion,
    stateVersion: milestone.stateVersion,
    eventSequence,
    aggregateId,
    stageId: milestone.stageId,
    sharedObjectId: A_EMOTION_M5_SHARED_OBJECT_ID,
    eventFamily: A_EMOTION_M5_EVENT_FAMILY,
    category: "RELATED",
    disclosure: "CONFIRMED",
    severity: "MAJOR",
    centerCardType: "STAGE_VICTORY",
    title: "阶段胜利",
    summary: "一个由已确认行动与证据支持的阶段里程碑已经达成。",
    sourceStatus: "里程碑与收益已确认",
    knownFacts: ["里程碑首次从未达成进入已达成", ...reward.capabilityCodes.map((code) => `获得能力：${code}`), ...reward.restrictionCodes.map((code) => `对手受限：${code}`)].slice(0, 6),
    visibleImpacts,
    responseOptions: [
      { code: "CONTINUE_AFTER_MILESTONE", label: "继续推进", preferredEntry: "PLAN", targetRoleKey: null, intentKey: "continue_after_milestone", prefillText: "利用刚刚取得的确定性收益，规划下一步行动。" },
      { code: "DEFER_RESPONSE", label: "稍后查看", preferredEntry: "DEFER", targetRoleKey: null, intentKey: null, prefillText: null }
    ],
    evidenceRefs,
    keyModal: modal,
    occurredAt: (milestone.achievedAt || milestone.createdAt).toISOString()
  };
  const validated = validateAEmotionM2ProjectionV1(projection);
  if (!validated.ok) throw new ServiceUnavailableException({ code: "A_EMOTION_M5_PROJECTION_REJECTED", message: "Stage victory projection failed validation" });
  return validated.value;
}

function stageVictoryModal(modalId: string, eventId: string, milestone: AEmotionStageMilestone, reward: StoredReward, evidenceRefs: string[]): AEmotionKeyModalV1 {
  const facts = [
    `里程碑：${milestone.milestoneCode}`,
    ...(reward.metricKey ? [`${reward.metricKey} ${reward.metricDelta >= 0 ? "+" : ""}${reward.metricDelta}`] : []),
    ...reward.capabilityCodes.map((code) => `获得：${code}`),
    ...reward.restrictionCodes.map((code) => `限制：${code}`),
    `已确认 ${evidenceRefs.length} 项证据`
  ].slice(0, 6);
  const candidate: AEmotionKeyModalV1 = {
    schemaVersion: A_EMOTION_KEY_MODAL_SCHEMA_VERSION,
    modalId,
    eventId,
    modalType: "STAGE_VICTORY",
    triggerCode: milestone.milestoneCode,
    triggerVersion: milestone.stateVersion,
    projectionVersion: milestone.stateVersion,
    stateVersion: milestone.stateVersion,
    priority: A_EMOTION_M5_STAGE_VICTORY_PRIORITY,
    title: "你夺回了主动权",
    summary: "已确认的行动和证据让你取得了一项具体、可继续利用的阶段收益。",
    facts,
    responseOptions: [
      { code: "CONTINUE_AFTER_MILESTONE", label: "继续推进", preferredEntry: "PLAN", intentKey: "continue_after_milestone", prefillText: "利用阶段收益规划下一步行动。" },
      { code: "DEFER_RESPONSE", label: "稍后查看", preferredEntry: "DEFER", intentKey: null, prefillText: null }
    ],
    ariaLive: "polite",
    occurredAt: (milestone.achievedAt || milestone.createdAt).toISOString(),
    isShown: false,
    isAcknowledged: false
  };
  const validated = validateAEmotionKeyModalV1(candidate);
  if (!validated.ok) throw new ServiceUnavailableException({ code: "A_EMOTION_M5_MODAL_REJECTED", message: "Stage victory modal failed validation" });
  return validated.value;
}

function milestoneContract(value: AEmotionStageMilestone): AEmotionStageMilestoneV1 {
  const candidate: AEmotionStageMilestoneV1 = {
    schemaVersion: A_EMOTION_M5_MILESTONE_SCHEMA_VERSION,
    milestoneId: value.id,
    roomId: value.roomId,
    runId: value.runId,
    stageId: value.stageId,
    milestoneCode: value.milestoneCode as AEmotionStageMilestoneV1["milestoneCode"],
    beneficiaryRoleId: value.beneficiaryRoleId,
    status: value.status as AEmotionStageMilestoneV1["status"],
    stateVersion: value.stateVersion,
    evidenceRefs: stringList(value.evidenceRefsJson),
    reward: publicReward(value.rewardJson),
    achievedAt: value.achievedAt?.toISOString() || null,
    revokedAt: value.revokedAt?.toISOString() || null
  };
  const validated = validateAEmotionStageMilestoneV1(candidate);
  if (!validated.ok) throw new ServiceUnavailableException({ code: "A_EMOTION_M5_MILESTONE_REJECTED", message: "Milestone state failed validation" });
  return validated.value;
}

type AuthoritativeOriginalLedgerCustodyMutation = {
  mutationId: string;
  assetId: string;
  assetKey: string;
  ownerRoleId: string | null;
  fromRoleId: string | null;
  toRoleId: string | null;
  quantity: number;
  status: string;
  version: number;
};

async function authoritativeOriginalLedgerCustodyMutation(
  tx: Tx,
  runId: string,
  sourceActionId: string
): Promise<AuthoritativeOriginalLedgerCustodyMutation | null> {
  const bridge = aEmotionSangtianLifecycleBridge();
  const mutation = await tx.roleAssetMutation.findFirst({
    where: {
      actionId: sourceActionId,
      asset: { runId, assetKey: bridge.custodyAssetKey }
    },
    include: {
      asset: {
        select: {
          id: true,
          runId: true,
          assetKey: true,
          ownerRoleId: true,
          quantity: true,
          status: true,
          version: true
        }
      }
    }
  });
  if (!mutation) return null;
  if (mutation.asset.runId !== runId
    || mutation.asset.assetKey !== bridge.custodyAssetKey
    || mutation.asset.ownerRoleId !== mutation.toRoleId) {
    throw new ServiceUnavailableException({
      code: "A_EMOTION_M5_ASSET_STATE_MISMATCH",
      message: "Original-ledger custody mutation is inconsistent"
    });
  }
  return {
    mutationId: mutation.id,
    assetId: mutation.asset.id,
    assetKey: mutation.asset.assetKey,
    ownerRoleId: mutation.asset.ownerRoleId,
    fromRoleId: mutation.fromRoleId,
    toRoleId: mutation.toRoleId,
    quantity: mutation.asset.quantity,
    status: mutation.asset.status,
    version: mutation.asset.version
  };
}

async function applyRewardToRunState(tx: Tx, runId: string, roleId: string, rule: AEmotionStageMilestoneRuleV1): Promise<StoredReward> {
  const run = await tx.storyRun.findUnique({ where: { id: runId }, select: { stateJson: true } });
  if (!run) throw new ServiceUnavailableException({ code: "A_EMOTION_M5_RUN_STATE_MISSING", message: "Run state is missing" });
  const root = record(run.stateJson);
  const m5 = record(root.aEmotionM5);
  const metrics = record(m5.metrics);
  const roleMetrics = record(metrics[roleId]);
  const capabilities = record(m5.capabilities);
  const restrictions = record(m5.restrictions);
  let metricBefore: number | null = null;
  let metricAfter: number | null = null;
  if (rule.reward.metricKey) {
    metricBefore = Number.isInteger(roleMetrics[rule.reward.metricKey]) ? Number(roleMetrics[rule.reward.metricKey]) : 0;
    metricAfter = Math.max(0, Math.min(100, metricBefore + rule.reward.metricDelta));
    metrics[roleId] = { ...roleMetrics, [rule.reward.metricKey]: metricAfter };
  }
  capabilities[roleId] = uniqueStrings([...stringList(capabilities[roleId]), ...rule.reward.capabilityCodes]);
  restrictions[roleId] = uniqueStrings([...stringList(restrictions[roleId]), ...rule.reward.restrictionCodes]);
  await tx.storyRun.update({ where: { id: runId }, data: { stateJson: { ...root, aEmotionM5: { schemaVersion: "a_emotion_m5_state_v1", stateVersion: Number(m5.stateVersion || 0) + 1, metrics, capabilities, restrictions } } as Prisma.InputJsonValue } });
  return { metricKey: rule.reward.metricKey, metricDelta: rule.reward.metricDelta, metricBefore, metricAfter, capabilityCodes: [...rule.reward.capabilityCodes], restrictionCodes: [...rule.reward.restrictionCodes] };
}

function viewerProjection(value: unknown): AEmotionM2ProjectionV1 | null {
  const envelope = record(value);
  const payload = record(envelope.payload);
  const validated = validateAEmotionM2ProjectionV1(payload);
  return validated.ok ? validated.value : null;
}
function matchesRule(actions: string[], effects: string[], facts: string[], codes: CanonicalCodes) {
  const groups: Array<[string[], string[]]> = [[actions, codes.actionCodes], [effects, codes.effectCodes], [facts, codes.factCodes]];
  const active = groups.filter(([required]) => required.length > 0);
  return active.length > 0 && active.every(([required, actual]) => required.some((code) => actual.includes(code)));
}
function normalizedCodes(input: CanonicalCodes): CanonicalCodes { return { actionCodes: uniqueStrings(input.actionCodes), effectCodes: uniqueStrings(input.effectCodes), factCodes: uniqueStrings(input.factCodes) }; }
function evidenceRefsFor(rule: AEmotionStageMilestoneRuleV1, codes: CanonicalCodes) {
  const refs = [
    ...rule.requiredActionCodes.filter((code) => codes.actionCodes.includes(code)).map((code) => `action-code:${code}`),
    ...rule.requiredEffectCodes.filter((code) => codes.effectCodes.includes(code)).map((code) => `effect-code:${code}`),
    ...rule.requiredFactCodes.filter((code) => codes.factCodes.includes(code)).map((code) => `fact-code:${code}`)
  ];
  return uniqueStrings(refs);
}
function publicReward(value: unknown) { const reward = storedReward(value); return { metricKey: reward.metricKey, metricDelta: reward.metricDelta, capabilityCodes: reward.capabilityCodes, restrictionCodes: reward.restrictionCodes }; }
function storedReward(value: unknown): StoredReward { const v = record(value); return { metricKey: typeof v.metricKey === "string" ? v.metricKey : null, metricDelta: Number.isInteger(v.metricDelta) ? Number(v.metricDelta) : 0, metricBefore: Number.isInteger(v.metricBefore) ? Number(v.metricBefore) : null, metricAfter: Number.isInteger(v.metricAfter) ? Number(v.metricAfter) : null, capabilityCodes: stringList(v.capabilityCodes), restrictionCodes: stringList(v.restrictionCodes) }; }
function compileRequest(value: unknown) { const v = record(value); if (v.schemaVersion !== "a_emotion_m5_compile_requested_v1" || typeof v.milestoneId !== "string" || typeof v.stageId !== "string" || !Number.isInteger(v.stageIndex) || !Number.isInteger(v.stateVersion) || typeof v.viewerUserId !== "string" || typeof v.sourceResolutionId !== "string") throw new ServiceUnavailableException({ code: "A_EMOTION_M5_TASK_INVALID", message: "Milestone compile task is invalid" }); return { milestoneId: String(v.milestoneId), stageId: String(v.stageId), stageIndex: Number(v.stageIndex), stateVersion: Number(v.stateVersion), viewerUserId: String(v.viewerUserId), sourceResolutionId: String(v.sourceResolutionId) }; }
function stringList(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : []; }
function uniqueStrings(values: string[]) { return [...new Set(values.filter(Boolean))]; }
function record(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
async function advisoryLock(tx: Tx, key: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`; }
function opaqueId(prefix: string, value: string) { return `${prefix}_${createHash("sha256").update(value).digest("base64url").slice(0, 32)}`; }
