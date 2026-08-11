import { createHash } from "node:crypto";
import { ConflictException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type AEmotionMetricTransition } from "@prisma/client";
import {
  A_EMOTION_KEY_MODAL_SCHEMA_VERSION,
  A_EMOTION_M2_PROJECTION_SCHEMA_VERSION,
  A_EMOTION_M3_CRISIS_PRIORITY,
  A_EMOTION_M3_EVENT_TYPE,
  A_EMOTION_M3_TRANSITION_SCHEMA_VERSION,
  isDangerEntry,
  metricThresholdState,
  validateAEmotionKeyModalV1,
  validateAEmotionM2ProjectionV1,
  validateAEmotionMetricThresholdRuleV1,
  validateAEmotionMetricTransitionV1,
  type AEmotionKeyModalV1,
  type AEmotionM2ProjectionV1,
  type AEmotionMetricThresholdRuleV1,
  type AEmotionMetricTransitionV1
} from "@ai-story/shared";
import { ContinuousEventDeliveryService } from "../continuous-strategy/event-delivery.service";
import { PrismaService } from "../prisma.service";
import { aEmotionM3Rule, isAEmotionM3EnabledForRun, type AEmotionM3RunGate } from "../config/a-emotion-m3.config";

export const A_EMOTION_M3_TASK_TYPE = "A_EMOTION_M3_CRISIS_COMPILE" as const;
export const A_EMOTION_M3_SHARED_OBJECT_ID = "metric-pressure" as const;
export const A_EMOTION_M3_EVENT_FAMILY = "METRIC_THRESHOLD" as const;

export function crisisAggregateIdentity(runId: string, roleId: string, metricKey: string, triggerVersion: number) {
  if (!runId || !roleId || !metricKey || !Number.isInteger(triggerVersion) || triggerVersion < 1) {
    throw new Error("A_EMOTION_M3_AGGREGATE_IDENTITY_INVALID");
  }
  const aggregateKey = `aemotion:m3:${runId}:${roleId}:${metricKey}:trigger-${triggerVersion}`;
  return { aggregateKey, aggregateId: opaqueId("agg", aggregateKey) };
}

type Tx = Prisma.TransactionClient;

export type AEmotionM3MetricInput = {
  run: AEmotionM3RunGate & { id: string; currentNodeId: string | null };
  targetRoleId: string;
  targetUserId: string;
  sourceResolutionId: string;
  sourceActionId: string;
  stageIndex: number;
  before: number;
  after: number;
  stateVersion: number;
  metricKey?: string;
  occurredAt?: Date;
};

export function aEmotionThresholdState(rule: AEmotionMetricThresholdRuleV1, value: number) {
  const validated = validateAEmotionMetricThresholdRuleV1(rule);
  if (!validated.ok) throw new Error(`A_EMOTION_M3_RULE_INVALID:${validated.errors.join("|")}`);
  return metricThresholdState(validated.value, value);
}

export function evaluateAEmotionMetricTransition(input: {
  rule: AEmotionMetricThresholdRuleV1;
  before: number;
  after: number;
  stateVersion: number;
  nextTriggerVersion: number;
  occurredAt?: string;
}) {
  const validated = validateAEmotionMetricThresholdRuleV1(input.rule);
  if (!validated.ok) throw new Error(`A_EMOTION_M3_RULE_INVALID:${validated.errors.join("|")}`);
  if (!Number.isInteger(input.before) || !Number.isInteger(input.after) || !Number.isInteger(input.stateVersion) || input.stateVersion < 1 || !Number.isInteger(input.nextTriggerVersion) || input.nextTriggerVersion < 1) throw new Error("A_EMOTION_M3_TRANSITION_INPUT_INVALID");
  const thresholdBefore = metricThresholdState(validated.value, input.before);
  const thresholdAfter = metricThresholdState(validated.value, input.after);
  return {
    metricKey: validated.value.metricKey,
    metricLabel: validated.value.metricLabel,
    before: input.before,
    after: input.after,
    delta: input.after - input.before,
    thresholdBefore,
    thresholdAfter,
    triggerCode: validated.value.triggerCode,
    stateVersion: input.stateVersion,
    triggerVersion: isDangerEntry(thresholdBefore, thresholdAfter) ? input.nextTriggerVersion : null,
    occurredAt: input.occurredAt || new Date().toISOString()
  };
}

@Injectable()
export class AEmotionM3Service {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ContinuousEventDeliveryService) private readonly deliveries: ContinuousEventDeliveryService
  ) {}

  /** Called inside the authoritative result transaction after the metric write. */
  async recordMetricTransition(tx: Tx, input: AEmotionM3MetricInput) {
    if (!isAEmotionM3EnabledForRun(input.run)) return { outcome: "FLAG_DISABLED" as const };
    if (!input.run.currentNodeId) throw new ConflictException({ code: "CURRENT_NODE_REQUIRED", message: "The run has no causal node" });
    assertMetricInput(input);
    const metricKey = input.metricKey || "imperial_trust";
    const rule = aEmotionM3Rule(metricKey);
    if (!rule) return { outcome: "NO_THRESHOLD_RULE" as const };
    const stageId = `stage-${Math.max(1, Math.trunc(input.stageIndex))}`;
    await lockMetric(tx, input.run.id, input.targetRoleId, metricKey);

    const existing = await tx.aEmotionMetricTransition.findUnique({
      where: { runId_viewerRoleId_metricKey_sourceResolutionId: {
        runId: input.run.id,
        viewerRoleId: input.targetRoleId,
        metricKey,
        sourceResolutionId: input.sourceResolutionId
      } }
    });
    if (existing) {
      assertSameTransition(existing, input, rule, stageId);
      return { outcome: "REPLAY" as const, transition: transitionContract(existing) };
    }

    const latest = await tx.aEmotionMetricTransition.findFirst({
      where: { runId: input.run.id, viewerRoleId: input.targetRoleId, metricKey },
      orderBy: { stateVersion: "desc" }
    });
    if (latest && latest.stateVersion >= input.stateVersion) throw new ConflictException({ code: "A_EMOTION_M3_STALE_STATE_VERSION", message: "Metric transition state version is stale" });
    if (latest && latest.currentValue !== input.before) throw new ConflictException({ code: "A_EMOTION_M3_METRIC_CHAIN_MISMATCH", message: "Metric transition does not continue the authoritative ledger" });

    const thresholdBefore = metricThresholdState(rule, input.before);
    const thresholdAfter = metricThresholdState(rule, input.after);
    let triggerVersion: number | null = null;
    if (isDangerEntry(thresholdBefore, thresholdAfter)) {
      const prior = await tx.aEmotionMetricTransition.findFirst({
        where: { runId: input.run.id, viewerRoleId: input.targetRoleId, metricKey, triggerCode: rule.triggerCode, triggerVersion: { not: null } },
        orderBy: { triggerVersion: "desc" },
        select: { triggerVersion: true }
      });
      triggerVersion = Number(prior?.triggerVersion || 0) + 1;
    }

    const transitionId = opaqueId("mtr", `${input.run.id}:${input.targetRoleId}:${metricKey}:${input.stateVersion}:${input.sourceResolutionId}`);
    const occurredAt = input.occurredAt || new Date();
    const transition = await tx.aEmotionMetricTransition.create({
      data: {
        id: transitionId,
        roomId: input.run.id,
        runId: input.run.id,
        viewerRoleId: input.targetRoleId,
        viewerUserId: input.targetUserId,
        metricKey,
        metricLabel: rule.metricLabel,
        previousValue: input.before,
        currentValue: input.after,
        delta: input.after - input.before,
        thresholdBefore,
        thresholdAfter,
        triggerCode: rule.triggerCode,
        sourceResolutionId: input.sourceResolutionId,
        sourceEventId: null,
        stateVersion: input.stateVersion,
        triggerVersion,
        stageId,
        occurredAt
      }
    });
    if (triggerVersion === null) return { outcome: "RECORDED" as const, transition: transitionContract(transition), taskId: null };

    const dedupeKey = `${A_EMOTION_M3_TASK_TYPE}:${transition.id}:${triggerVersion}`;
    const existingTask = await tx.storyTaskOutbox.findUnique({ where: { dedupeKey }, select: { id: true } });
    const task = existingTask || await tx.storyTaskOutbox.create({
      data: {
        runId: input.run.id,
        nodeId: input.run.currentNodeId,
        roleId: input.targetRoleId,
        inputRefId: transition.id,
        actionSlot: "A_EMOTION_M3",
        taskType: A_EMOTION_M3_TASK_TYPE,
        status: "PENDING",
        dedupeKey,
        maxAttempts: 5,
        resultJson: {
          schemaVersion: "a_emotion_m3_compile_requested_v1",
          transitionId: transition.id,
          stageId,
          stageIndex: Math.max(1, Math.trunc(input.stageIndex)),
          viewerUserId: input.targetUserId,
          sourceActionId: input.sourceActionId,
          triggerVersion
        } as Prisma.InputJsonValue
      }
    });
    return { outcome: "TRIGGERED" as const, transition: transitionContract(transition), taskId: task.id };
  }

  async executeCompileTask(taskId: string, fence: { taskId: string; leaseOwner: string; leaseVersion: number }) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.storyTaskOutbox.findFirst({
        where: { id: taskId, taskType: A_EMOTION_M3_TASK_TYPE, status: "RUNNING", leaseOwner: fence.leaseOwner, leaseVersion: fence.leaseVersion, leaseExpiresAt: { gt: new Date() } }
      });
      if (!task) return { outcome: "LEASE_LOST" as const };
      const request = compileRequest(task.resultJson);
      const [run, transition, player] = await Promise.all([
        tx.storyRun.findUnique({ where: { id: task.runId }, select: { id: true, mode: true, maxPlayers: true, templateKey: true, engineVersion: true, stateJson: true } }),
        tx.aEmotionMetricTransition.findUnique({ where: { id: request.transitionId } }),
        tx.storyPlayer.findFirst({ where: { runId: task.runId, roleId: task.roleId || "", userId: request.viewerUserId, playerType: "human", status: "active" }, select: { userId: true } })
      ]);
      const resolution = transition
        ? await tx.actionResolution.findUnique({ where: { id: transition.sourceResolutionId }, select: { id: true, runId: true, qualityStatus: true } })
        : null;
      if (!run || !transition || !player?.userId || !resolution
        || resolution.runId !== run.id || resolution.qualityStatus !== "PASS"
        || transition.runId !== run.id || transition.roomId !== run.id
        || transition.viewerRoleId !== task.roleId || transition.viewerUserId !== player.userId
        || transition.id !== task.inputRefId || transition.triggerVersion !== request.triggerVersion
        || transition.stateVersion < 1 || transition.stageId !== request.stageId) {
        throw new ServiceUnavailableException({ code: "A_EMOTION_M3_CANONICAL_CONTEXT_MISMATCH", message: "Crisis canonical context is inconsistent" });
      }
      if (!isAEmotionM3EnabledForRun(run)) return { outcome: "FLAG_DISABLED" as const };
      const rule = aEmotionM3Rule(transition.metricKey);
      if (!rule || rule.triggerCode !== transition.triggerCode) throw new ServiceUnavailableException({ code: "A_EMOTION_M3_RULE_MISMATCH", message: "Metric threshold rule is unavailable" });

      const { aggregateKey, aggregateId } = crisisAggregateIdentity(
        run.id,
        transition.viewerRoleId,
        transition.metricKey,
        Number(transition.triggerVersion || 1)
      );
      const modalId = opaqueId("mdl", `${run.id}:${transition.viewerRoleId}:${transition.triggerCode}:${transition.triggerVersion}`);
      const eventId = opaqueId("evt", `aemotion:m3:${transition.id}:${transition.triggerVersion}`);
      const modalProjection = crisisModal(
        modalId,
        eventId,
        transition,
        rule,
        Number(transition.triggerVersion || 1),
        false,
        false
      );
      const event = await this.deliveries.publishProjected(tx, {
        runId: run.id,
        nodeId: task.nodeId,
        day: request.stageIndex,
        type: A_EMOTION_M3_EVENT_TYPE,
        messageType: "a_emotion_crisis",
        visibility: "PRIVATE",
        audienceType: "MEMBER",
        audienceRoleIds: [transition.viewerRoleId],
        canonicalPayload: {
          schemaVersion: "a_emotion_m3_canonical_v1",
          transitionId: transition.id,
          sourceResolutionId: transition.sourceResolutionId,
          metricKey: transition.metricKey,
          triggerCode: transition.triggerCode,
          triggerVersion: transition.triggerVersion,
          stateVersion: transition.stateVersion
        },
        deliveries: [{
          userId: player.userId,
          roleId: transition.viewerRoleId,
          aggregate: {
            aggregateKey,
            aggregateId,
            stageId: request.stageId,
            sharedObjectId: A_EMOTION_M3_SHARED_OBJECT_ID,
            eventFamily: A_EMOTION_M3_EVENT_FAMILY,
            category: "RELATED",
            disclosure: "CONFIRMED",
            projectionVersion: transition.triggerVersion || 1,
            stateVersion: transition.stateVersion
          },
          buildPayload: (eventSequence, publishedEventId) => {
            if (publishedEventId !== eventId) throw new ServiceUnavailableException({ code: "A_EMOTION_M3_EVENT_ID_MISMATCH", message: "Crisis event id is inconsistent" });
            return crisisFeedProjection(transition, rule, request, aggregateId, modalProjection, eventSequence) as unknown as Record<string, unknown>;
          }
        }],
        dedupeKey: `A_EMOTION_M3:${transition.id}:${transition.triggerVersion}`,
        sourceActionId: request.sourceActionId,
        eventId
      });
      if (event.id !== eventId) throw new ServiceUnavailableException({ code: "A_EMOTION_M3_EVENT_ID_MISMATCH", message: "Crisis event id is inconsistent" });

      const existingModal = await tx.aEmotionKeyModal.findUnique({ where: { id: modalId } });
      if (existingModal) {
        if (existingModal.runId !== run.id || existingModal.viewerUserId !== player.userId || existingModal.viewerRoleId !== transition.viewerRoleId
          || existingModal.eventId !== event.id || existingModal.triggerVersion !== transition.triggerVersion || existingModal.stateVersion !== transition.stateVersion) {
          throw new ServiceUnavailableException({ code: "A_EMOTION_M3_MODAL_IDEMPOTENCY_CONFLICT", message: "Crisis modal idempotency state is inconsistent" });
        }
      } else {
        await tx.aEmotionKeyModal.create({
          data: {
            id: modalId,
            roomId: run.id,
            runId: run.id,
            viewerUserId: player.userId,
            viewerRoleId: transition.viewerRoleId,
            eventId: event.id,
            modalType: "CRISIS",
            triggerCode: transition.triggerCode,
            triggerVersion: transition.triggerVersion || 1,
            projectionVersion: transition.triggerVersion || 1,
            stateVersion: transition.stateVersion,
            priority: A_EMOTION_M3_CRISIS_PRIORITY,
            projectionJson: modalProjection as unknown as Prisma.InputJsonValue
          }
        });
      }
      await tx.aEmotionMetricTransition.updateMany({ where: { id: transition.id, sourceEventId: null }, data: { sourceEventId: event.id } });
      return { outcome: "PUBLISHED" as const, eventId: event.id, modalId, triggerVersion: transition.triggerVersion };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function crisisFeedProjection(
  transition: AEmotionMetricTransition,
  rule: AEmotionMetricThresholdRuleV1,
  request: ReturnType<typeof compileRequest>,
  aggregateId: string,
  modal: AEmotionKeyModalV1,
  eventSequence: number
): AEmotionM2ProjectionV1 {
  const projection: AEmotionM2ProjectionV1 = {
    schemaVersion: A_EMOTION_M2_PROJECTION_SCHEMA_VERSION,
    projectionVersion: Number(transition.triggerVersion || 1),
    stateVersion: transition.stateVersion,
    eventSequence,
    aggregateId,
    stageId: request.stageId,
    sharedObjectId: A_EMOTION_M3_SHARED_OBJECT_ID,
    eventFamily: A_EMOTION_M3_EVENT_FAMILY,
    category: "RELATED",
    disclosure: "CONFIRMED",
    severity: "CRITICAL",
    centerCardType: "CRISIS",
    title: rule.modalTitle,
    summary: rule.modalSummaryTemplate,
    sourceStatus: "确定性阈值已触发",
    knownFacts: [`${rule.metricLabel}当前为 ${transition.currentValue}`, `危险线为 ${rule.dangerAtOrBelow}`],
    visibleImpacts: [{ key: transition.metricKey, label: rule.metricLabel, before: transition.previousValue, after: transition.currentValue, delta: transition.delta, suffix: "", safeReason: "指标进入危险区" }],
    responseOptions: [
      { code: "INVESTIGATE_PRESSURE_SOURCE", label: "派遣调查", preferredEntry: "INVESTIGATE", targetRoleKey: null, intentKey: "inspect_metric_pressure", prefillText: "核查导致当前风险指标进入危险区的已确认事件和记录。" },
      { code: "PLAN_PROTECTION", label: "准备保护行动", preferredEntry: "PLAN", targetRoleKey: null, intentKey: "protect_authority", prefillText: "拟定一项不依赖未知来源身份的保护行动。" },
      { code: "DEFER_RESPONSE", label: "稍后处理", preferredEntry: "DEFER", targetRoleKey: null, intentKey: null, prefillText: null }
    ],
    evidenceRefs: [`resolution:${transition.sourceResolutionId}`, `metric-transition:${transition.id}`],
    keyModal: modal,
    occurredAt: transition.occurredAt.toISOString()
  };
  const validation = validateAEmotionM2ProjectionV1(projection);
  if (!validation.ok) throw new ServiceUnavailableException({ code: "A_EMOTION_M3_PROJECTION_REJECTED", message: "Crisis viewer projection failed validation" });
  return validation.value;
}

function crisisModal(
  modalId: string,
  eventId: string,
  transition: AEmotionMetricTransition,
  rule: AEmotionMetricThresholdRuleV1,
  triggerVersion: number,
  shown: boolean,
  acknowledged: boolean
): AEmotionKeyModalV1 {
  const candidate: AEmotionKeyModalV1 = {
    schemaVersion: A_EMOTION_KEY_MODAL_SCHEMA_VERSION,
    modalId,
    eventId,
    modalType: "CRISIS",
    triggerCode: rule.triggerCode,
    triggerVersion,
    projectionVersion: triggerVersion,
    stateVersion: transition.stateVersion,
    priority: A_EMOTION_M3_CRISIS_PRIORITY,
    title: rule.modalTitle,
    summary: rule.modalSummaryTemplate,
    facts: [`${rule.metricLabel}当前为 ${transition.currentValue}`, `危险线为 ${rule.dangerAtOrBelow}`],
    responseOptions: [
      { code: "INVESTIGATE_PRESSURE_SOURCE", label: "派遣调查", preferredEntry: "INVESTIGATE", intentKey: "inspect_metric_pressure", prefillText: "核查导致当前风险指标进入危险区的已确认事件和记录。" },
      { code: "DEFER_RESPONSE", label: "稍后处理", preferredEntry: "DEFER", intentKey: null, prefillText: null }
    ],
    occurredAt: transition.occurredAt.toISOString(),
    ariaLive: "assertive",
    isShown: shown,
    isAcknowledged: acknowledged
  };
  const validation = validateAEmotionKeyModalV1(candidate);
  if (!validation.ok) throw new ServiceUnavailableException({ code: "A_EMOTION_M3_MODAL_REJECTED", message: "Crisis modal projection failed validation" });
  return validation.value;
}

function transitionContract(value: AEmotionMetricTransition): AEmotionMetricTransitionV1 {
  const candidate: AEmotionMetricTransitionV1 = {
    schemaVersion: A_EMOTION_M3_TRANSITION_SCHEMA_VERSION,
    transitionId: value.id,
    roomId: value.roomId,
    runId: value.runId,
    viewerRoleId: value.viewerRoleId,
    metricKey: value.metricKey,
    metricLabel: value.metricLabel,
    previousValue: value.previousValue,
    currentValue: value.currentValue,
    delta: value.delta,
    thresholdBefore: value.thresholdBefore as AEmotionMetricTransitionV1["thresholdBefore"],
    thresholdAfter: value.thresholdAfter as AEmotionMetricTransitionV1["thresholdAfter"],
    triggerCode: value.triggerCode,
    sourceResolutionId: value.sourceResolutionId,
    sourceEventId: value.sourceEventId,
    stateVersion: value.stateVersion,
    triggerVersion: value.triggerVersion,
    stageId: value.stageId,
    occurredAt: value.occurredAt.toISOString()
  };
  const validation = validateAEmotionMetricTransitionV1(candidate);
  if (!validation.ok) throw new ServiceUnavailableException({ code: "A_EMOTION_M3_TRANSITION_REJECTED", message: "Metric transition failed validation" });
  return validation.value;
}

function assertMetricInput(input: AEmotionM3MetricInput) {
  if (!input.targetRoleId || !input.targetUserId || !input.sourceResolutionId || !input.sourceActionId) throw new Error("A_EMOTION_M3_INPUT_REQUIRED");
  if (!Number.isInteger(input.before) || !Number.isInteger(input.after) || !Number.isInteger(input.stateVersion) || input.stateVersion < 1) throw new Error("A_EMOTION_M3_INPUT_INVALID");
  if (input.before === input.after) throw new Error("A_EMOTION_M3_NOOP_TRANSITION");
}
function assertSameTransition(value: AEmotionMetricTransition, input: AEmotionM3MetricInput, rule: AEmotionMetricThresholdRuleV1, stageId: string) {
  if (value.runId !== input.run.id || value.roomId !== input.run.id || value.viewerRoleId !== input.targetRoleId || value.viewerUserId !== input.targetUserId
    || value.metricKey !== rule.metricKey || value.previousValue !== input.before || value.currentValue !== input.after
    || value.stateVersion !== input.stateVersion || value.stageId !== stageId) {
    throw new ServiceUnavailableException({ code: "A_EMOTION_M3_IDEMPOTENCY_CONFLICT", message: "Metric transition idempotency state is inconsistent" });
  }
}
function compileRequest(value: unknown) {
  const raw = record(value);
  if (raw.schemaVersion !== "a_emotion_m3_compile_requested_v1" || !text(raw.transitionId) || !text(raw.stageId)
    || !Number.isInteger(raw.stageIndex) || Number(raw.stageIndex) < 1 || !text(raw.viewerUserId) || !text(raw.sourceActionId)
    || !Number.isInteger(raw.triggerVersion) || Number(raw.triggerVersion) < 1) throw new Error("A_EMOTION_M3_TASK_REQUEST_INVALID");
  return { transitionId: String(raw.transitionId), stageId: String(raw.stageId), stageIndex: Number(raw.stageIndex), viewerUserId: String(raw.viewerUserId), sourceActionId: String(raw.sourceActionId), triggerVersion: Number(raw.triggerVersion) };
}
async function lockMetric(tx: Tx, runId: string, roleId: string, metricKey: string) {
  const name = `aemotion:m3:metric:${runId}:${roleId}:${metricKey}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${name}, 0))`;
}
function opaqueId(prefix: "mtr" | "mdl" | "agg" | "evt", value: string) { return `${prefix}_${createHash("sha256").update(value).digest("base64url").slice(0, 32)}`; }
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
