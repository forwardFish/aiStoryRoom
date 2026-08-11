import { createHash } from "node:crypto";
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type CommitmentV2 } from "@prisma/client";
import {
  A_EMOTION_KEY_MODAL_SCHEMA_VERSION,
  A_EMOTION_M2_PROJECTION_SCHEMA_VERSION,
  A_EMOTION_M4_EVENT_FAMILY,
  A_EMOTION_M4_EVENT_TYPE,
  A_EMOTION_M4_PROMISE_BROKEN_PRIORITY,
  A_EMOTION_M4_PROMISE_SCHEMA_VERSION,
  A_EMOTION_M4_SHARED_OBJECT_ID,
  validateAEmotionKeyModalV1,
  validateAEmotionM2ProjectionV1,
  validateAEmotionSimplePromiseCommandV1,
  validateAEmotionSimplePromiseTermsV1,
  validateAEmotionSimplePromiseV1,
  type AEmotionKeyModalV1,
  type AEmotionM2ProjectionV1,
  type AEmotionSimplePromiseCodeV1,
  type AEmotionSimplePromiseCommandV1,
  type AEmotionSimplePromiseTermsV1,
  type AEmotionSimplePromiseV1
} from "@ai-story/shared";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { ContinuousEventDeliveryService } from "../continuous-strategy/event-delivery.service";
import { PrismaService } from "../prisma.service";
import { aEmotionM4Terms, isAEmotionM4EnabledForRun } from "../config/a-emotion-m4.config";
import { aEmotionSangtianLifecycleBridge } from "../config/a-emotion-sangtian-lifecycle.config";

export const A_EMOTION_M4_TASK_TYPE = "A_EMOTION_M4_PROMISE_REVEAL_COMPILE" as const;

type Tx = Prisma.TransactionClient;
type RunGate = { id: string; templateKey: string; mode: string; maxPlayers: number; engineVersion: string; stateJson: unknown; currentNodeId: string | null };

export type AEmotionM4LifecycleCodes = {
  actionCodes: string[];
  effectCodes: string[];
  factCodes: string[];
};

export function evaluateAEmotionPromiseLifecycle(terms: AEmotionSimplePromiseTermsV1, codes: AEmotionM4LifecycleCodes) {
  const validated = validateAEmotionSimplePromiseTermsV1(terms);
  if (!validated.ok) throw new Error(`A_EMOTION_M4_TERMS_INVALID:${validated.errors.join("|")}`);
  const action = new Set(codes.actionCodes);
  const effect = new Set(codes.effectCodes);
  const fact = new Set(codes.factCodes);
  const broke = intersects(action, validated.value.breakActionCodes)
    || intersects(effect, validated.value.breakEffectCodes)
    || intersects(fact, validated.value.breakFactCodes);
  if (broke) return "BROKEN" as const;
  const fulfilled = intersects(action, validated.value.fulfillActionCodes)
    || intersects(effect, validated.value.fulfillEffectCodes)
    || intersects(fact, validated.value.fulfillFactCodes);
  return fulfilled ? "FULFILLED" as const : "UNCHANGED" as const;
}

export function promiseAggregateIdentity(runId: string, receiverRoleId: string, promiseId: string, stateVersion: number) {
  if (!runId || !receiverRoleId || !promiseId || !Number.isInteger(stateVersion) || stateVersion < 1) throw new Error("A_EMOTION_M4_AGGREGATE_IDENTITY_INVALID");
  const aggregateKey = `aemotion:m4:${runId}:${receiverRoleId}:${promiseId}`;
  return { aggregateKey, aggregateId: opaqueId("agg", `${aggregateKey}:v${stateVersion}`) };
}

@Injectable()
export class AEmotionM4Service {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ContinuousEventDeliveryService) private readonly deliveries: ContinuousEventDeliveryService
  ) {}

  /** Sole M4 authority for a committed structured conversation action. */
  async createFromCommittedAction(tx: Tx, input: {
    run: RunGate;
    sourceResolutionId: string;
    sourceActionId: string;
    issuerRoleId: string;
    receiverRoleId: string;
    stageIndex: number;
    command: unknown;
  }) {
    const command = requirePromiseCommand(input.command);
    if (!isAEmotionM4EnabledForRun(input.run)) return { outcome: "FLAG_DISABLED" as const };
    if (command.expectedStage !== input.stageIndex) throw new ConflictException({ code: "PROMISE_COMMAND_CONTEXT_MISMATCH", message: "Promise command does not match its committed action" });
    const terms = aEmotionM4Terms(command.promiseCode);
    await advisoryLock(tx, `aemotion:m4:promise-slot:${input.run.id}:${input.issuerRoleId}`);
    const simplePromiseSlotKey = `aemotion:m4:${input.run.id}:${input.issuerRoleId}`;
    const existing = await tx.commitmentV2.findUnique({ where: { simplePromiseSlotKey } });
    if (existing) {
      if (existing.sourceResolutionId !== input.sourceResolutionId || existing.receiverRoleId !== input.receiverRoleId || existing.promiseCode !== command.promiseCode) throw new ConflictException({ code: "A_EMOTION_M4_PROMISE_SLOT_USED", message: "This player has already used the formal promise slot" });
      return { outcome: "REPLAY" as const, promise: promiseContract(existing) };
    }
    const promiseId = opaqueId("prm", `${input.run.id}:${input.issuerRoleId}:${command.idempotencyKey}`);
    const created = await tx.commitmentV2.create({ data: {
      id: promiseId,
      runId: input.run.id,
      sourceResolutionId: input.sourceResolutionId,
      issuerRoleId: input.issuerRoleId,
      receiverRoleId: input.receiverRoleId,
      content: terms.obligationCode,
      visibility: "LIMITED",
      expiresAtStage: terms.deadlineStage,
      status: "ACTIVE",
      dedupeKey: `commitment-v2:m4:${command.idempotencyKey}`,
      promiseCode: command.promiseCode,
      relatedObjectId: terms.relatedObjectId,
      termsJson: terms as unknown as Prisma.InputJsonValue,
      simplePromiseSlotKey,
      sourceActionId: input.sourceActionId,
      lifecycleVersion: 1,
      evidenceRefsJson: []
    } });
    return { outcome: "CREATED" as const, promise: promiseContract(created) };
  }

  /** Evaluate only exact codes from a committed canonical result. */
  async applyAuthoritativeLifecycle(tx: Tx, input: {
    run: RunGate;
    sourceRoleId: string;
    sourceResolutionId: string;
    sourceActionId: string;
    stageIndex: number;
    actionCodes: string[];
    effectCodes: string[];
    factCodes: string[];
  }) {
    if (!isAEmotionM4EnabledForRun(input.run)) return { outcome: "FLAG_DISABLED" as const, updated: [] };
    const resolution = await tx.actionResolution.findUnique({
      where: { id: input.sourceResolutionId },
      select: { runId: true, roleId: true, playerActionId: true, qualityStatus: true }
    });
    if (!resolution
      || resolution.runId !== input.run.id
      || resolution.roleId !== input.sourceRoleId
      || resolution.playerActionId !== input.sourceActionId
      || resolution.qualityStatus !== "PASS") {
      throw new ServiceUnavailableException({
        code: "A_EMOTION_M4_CANONICAL_CONTEXT_MISMATCH",
        message: "Promise lifecycle basis is not a committed canonical result"
      });
    }
    const custody = await authoritativeLedgerCustodyMutation(tx, input.run.id, input.sourceActionId);
    const updated: AEmotionSimplePromiseV1[] = [];

    // Deadline progression is run-wide. It must not depend on which issuer
    // happens to act after the stage boundary.
    const expiring = await tx.commitmentV2.findMany({
      where: {
        runId: input.run.id,
        promiseCode: { not: null },
        status: "ACTIVE",
        expiresAtStage: { lt: input.stageIndex }
      },
      orderBy: { createdAt: "asc" }
    });
    for (const promise of expiring) {
      await advisoryLock(tx, `aemotion:m4:promise:${promise.id}`);
      const current = await tx.commitmentV2.findUnique({ where: { id: promise.id } });
      if (!current || current.status !== "ACTIVE" || !current.promiseCode || Number(current.expiresAtStage || 0) >= input.stageIndex) continue;
      const terms = requireTerms(current.termsJson);
      const now = new Date();
      const next = await tx.commitmentV2.update({
        where: { id: current.id },
        data: terms.expiryOutcome === "FULFILLED"
          ? { status: "FULFILLED", fulfilledAt: now, expiredAt: now, lifecycleVersion: { increment: 1 } }
          : { status: "BROKEN", breachedAt: now, expiredAt: now, breachActionId: input.sourceActionId, lifecycleVersion: { increment: 1 } }
      });
      updated.push(promiseContract(next));
    }

    const promises = await tx.commitmentV2.findMany({
      where: {
        runId: input.run.id,
        promiseCode: { not: null },
        status: "ACTIVE"
      },
      orderBy: { createdAt: "asc" }
    });
    const bridge = aEmotionSangtianLifecycleBridge();
    for (const promise of promises) {
      await advisoryLock(tx, `aemotion:m4:promise:${promise.id}`);
      const current = await tx.commitmentV2.findUnique({ where: { id: promise.id } });
      if (!current || current.status !== "ACTIVE" || !current.promiseCode) continue;
      const terms = requireTerms(current.termsJson);
      const codeOutcome = current.issuerRoleId === input.sourceRoleId
        ? evaluateAEmotionPromiseLifecycle(terms, input)
        : "UNCHANGED" as const;
      const custodyFulfilled = current.promiseCode === bridge.promiseCode
        && current.relatedObjectId === bridge.sharedObjectId
        && custody?.toRoleId === current.receiverRoleId
        && custody.ownerRoleId === current.receiverRoleId
        && custody.status === "ACTIVE"
        && custody.quantity > 0;
      // Exact copy-only/withhold author codes take precedence. Otherwise the
      // authoritative custody transition can fulfill the promise even when the
      // receiver performed the action that brought the original into custody.
      const outcome = codeOutcome === "BROKEN"
        ? "BROKEN" as const
        : custodyFulfilled
          ? "FULFILLED" as const
          : codeOutcome;
      if (outcome === "UNCHANGED") continue;
      const now = new Date();
      const next = await tx.commitmentV2.update({
        where: { id: current.id },
        data: outcome === "FULFILLED"
          ? { status: "FULFILLED", fulfilledAt: now, fulfillmentActionId: input.sourceActionId, lifecycleVersion: { increment: 1 } }
          : { status: "BROKEN", breachedAt: now, breachActionId: input.sourceActionId, lifecycleVersion: { increment: 1 } }
      });
      updated.push(promiseContract(next));
    }
    await this.revealFromEvidence(tx, input);
    return { outcome: updated.length ? "UPDATED" as const : "UNCHANGED" as const, updated };
  }

  async revealFromEvidence(tx: Tx, input: { run: RunGate; sourceRoleId: string; sourceResolutionId: string; sourceActionId: string; stageIndex: number; factCodes: string[] }) {
    if (!isAEmotionM4EnabledForRun(input.run)) return [];
    const nodeId = input.run.currentNodeId;
    if (!nodeId) throw new ServiceUnavailableException({ code: "A_EMOTION_M4_NODE_REQUIRED", message: "Promise reveal requires the authoritative current node" });
    const candidates = await tx.commitmentV2.findMany({ where: { runId: input.run.id, promiseCode: { not: null }, status: "BROKEN" }, orderBy: { createdAt: "asc" } });
    const revealed: AEmotionSimplePromiseV1[] = [];
    for (const promise of candidates) {
      const terms = requireTerms(promise.termsJson);
      const matched = input.factCodes.filter((code) => terms.revealEvidenceFactCodes.includes(code));
      if (!matched.length) continue;
      const facts = await tx.canonFact.findMany({ where: { runId: input.run.id, factKey: { in: matched }, status: "confirmed" }, select: { id: true, factKey: true } });
      if (!facts.length) continue;
      await advisoryLock(tx, `aemotion:m4:promise:${promise.id}`);
      const current = await tx.commitmentV2.findUnique({ where: { id: promise.id } });
      if (!current || current.status !== "BROKEN") continue;
      const evidenceRefs = facts.map((fact) => `fact:${fact.id}:${fact.factKey}`);
      const next = await tx.commitmentV2.update({ where: { id: current.id }, data: { status: "REVEALED", revealedAt: new Date(), evidenceRefsJson: evidenceRefs, lifecycleVersion: { increment: 1 } } });
      const dedupeKey = `${A_EMOTION_M4_TASK_TYPE}:${next.id}:${next.lifecycleVersion}`;
      if (!await tx.storyTaskOutbox.findUnique({ where: { dedupeKey }, select: { id: true } })) {
        await tx.storyTaskOutbox.create({ data: { runId: input.run.id, nodeId, roleId: next.receiverRoleId, inputRefId: next.id, actionSlot: "A_EMOTION_M4", taskType: A_EMOTION_M4_TASK_TYPE, status: "PENDING", dedupeKey, maxAttempts: 5, resultJson: { schemaVersion: "a_emotion_m4_compile_requested_v1", promiseId: next.id, stageId: `stage-${Math.max(1, input.stageIndex)}`, stageIndex: Math.max(1, input.stageIndex), stateVersion: next.lifecycleVersion, sourceResolutionId: input.sourceResolutionId } as Prisma.InputJsonValue } });
      }
      revealed.push(promiseContract(next));
    }
    return revealed;
  }

  async listForViewer(user: AuthenticatedUser, roomId: string) {
    const membership = await this.prisma.storyPlayer.findFirst({ where: { runId: roomId, userId: user.id, playerType: "human", status: "active", roleId: { not: null } }, select: { roleId: true } });
    if (!membership?.roleId) throw new ForbiddenException({ code: "ROOM_MEMBERSHIP_REQUIRED", message: "Room membership required" });
    const rows = await this.prisma.commitmentV2.findMany({ where: { runId: roomId, promiseCode: { not: null }, OR: [{ issuerRoleId: membership.roleId }, { receiverRoleId: membership.roleId }, { visibility: "PUBLIC" }] }, orderBy: { createdAt: "desc" }, take: 20 });
    return { schemaVersion: "a_emotion_m4_promise_list_v1", items: rows.map(promiseContract) };
  }

  async executeCompileTask(taskId: string, fence: { taskId: string; leaseOwner: string; leaseVersion: number }) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.storyTaskOutbox.findFirst({ where: { id: taskId, taskType: A_EMOTION_M4_TASK_TYPE, status: "RUNNING", leaseOwner: fence.leaseOwner, leaseVersion: fence.leaseVersion, leaseExpiresAt: { gt: new Date() } } });
      if (!task) return { outcome: "LEASE_LOST" as const };
      const request = compileRequest(task.resultJson);
      const [run, promise, receiver] = await Promise.all([
        tx.storyRun.findUnique({ where: { id: task.runId }, select: { id: true, mode: true, maxPlayers: true, templateKey: true, engineVersion: true, stateJson: true, currentNodeId: true } }),
        tx.commitmentV2.findUnique({ where: { id: request.promiseId }, include: { issuerRole: { select: { id: true, roleKey: true, roleName: true } }, receiverRole: { select: { id: true, roleKey: true, roleName: true } } } }),
        tx.storyPlayer.findFirst({ where: { runId: task.runId, roleId: task.roleId || "", playerType: "human", status: "active", userId: { not: null } }, select: { userId: true } })
      ]);
      if (!run || !promise || !promise.promiseCode || !receiver?.userId || promise.runId !== run.id || promise.receiverRoleId !== task.roleId || promise.status !== "REVEALED" || promise.lifecycleVersion !== request.stateVersion || promise.id !== task.inputRefId || !isAEmotionM4EnabledForRun(run)) throw new ServiceUnavailableException({ code: "A_EMOTION_M4_CANONICAL_CONTEXT_MISMATCH", message: "Promise reveal context is inconsistent" });
      const evidenceRefs = stringList(promise.evidenceRefsJson);
      if (!evidenceRefs.length || !promise.breachActionId) throw new ServiceUnavailableException({ code: "A_EMOTION_M4_REVEAL_EVIDENCE_REQUIRED", message: "Promise reveal evidence is missing" });
      const { aggregateKey, aggregateId } = promiseAggregateIdentity(run.id, promise.receiverRoleId, promise.id, promise.lifecycleVersion);
      const eventId = opaqueId("evt", `m4:${promise.id}:${promise.lifecycleVersion}`);
      const modalId = opaqueId("mdl", `m4:${promise.id}:${promise.lifecycleVersion}`);
      const modal = promiseModal(modalId, eventId, promise, evidenceRefs);
      const event = await this.deliveries.publishProjected(tx, {
        runId: run.id, nodeId: task.nodeId, day: request.stageIndex, type: A_EMOTION_M4_EVENT_TYPE, messageType: "a_emotion_promise_broken", visibility: "PRIVATE", audienceType: "MEMBER", audienceRoleIds: [promise.receiverRoleId], eventId,
        canonicalPayload: { schemaVersion: "a_emotion_m4_promise_reveal_canonical_v1", promiseId: promise.id, sourceResolutionId: promise.sourceResolutionId, brokenByActionId: promise.breachActionId, lifecycleVersion: promise.lifecycleVersion, stateVersion: promise.lifecycleVersion },
        deliveries: [{ userId: receiver.userId, roleId: promise.receiverRoleId, aggregate: { aggregateKey, aggregateId, stageId: request.stageId, sharedObjectId: A_EMOTION_M4_SHARED_OBJECT_ID, eventFamily: A_EMOTION_M4_EVENT_FAMILY, category: "RELATED", disclosure: "CONFIRMED", projectionVersion: promise.lifecycleVersion, stateVersion: promise.lifecycleVersion }, buildPayload: (eventSequence, publishedEventId) => promiseProjection(promise, request, aggregateId, modal, eventSequence, publishedEventId) as unknown as Record<string, unknown> }],
        dedupeKey: `A_EMOTION_M4:${promise.id}:${promise.lifecycleVersion}`, sourceActionId: promise.breachActionId
      });
      if (event.id !== eventId) throw new ServiceUnavailableException({ code: "A_EMOTION_M4_EVENT_ID_MISMATCH", message: "Promise reveal event id is inconsistent" });
      if (!await tx.aEmotionKeyModal.findUnique({ where: { id: modalId } })) {
        await tx.aEmotionKeyModal.create({ data: { id: modalId, roomId: run.id, runId: run.id, viewerUserId: receiver.userId, viewerRoleId: promise.receiverRoleId, eventId, modalType: "PROMISE_BROKEN", triggerCode: "PROMISE_BROKEN_REVEALED", triggerVersion: promise.lifecycleVersion, projectionVersion: promise.lifecycleVersion, stateVersion: promise.lifecycleVersion, priority: A_EMOTION_M4_PROMISE_BROKEN_PRIORITY, projectionJson: modal as unknown as Prisma.InputJsonValue } });
      }
      return { outcome: "PUBLISHED" as const, eventId, modalId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function promiseProjection(promise: CommitmentV2 & { issuerRole: { id: string; roleKey: string; roleName: string }; receiverRole: { id: string; roleKey: string; roleName: string } }, request: ReturnType<typeof compileRequest>, aggregateId: string, modal: AEmotionKeyModalV1, eventSequence: number, eventId: string): AEmotionM2ProjectionV1 {
  if (eventId !== modal.eventId) throw new ServiceUnavailableException({ code: "A_EMOTION_M4_EVENT_ID_MISMATCH", message: "Promise event id is inconsistent" });
  const projection: AEmotionM2ProjectionV1 = {
    schemaVersion: A_EMOTION_M2_PROJECTION_SCHEMA_VERSION, projectionVersion: promise.lifecycleVersion, stateVersion: promise.lifecycleVersion, eventSequence, aggregateId, stageId: request.stageId, sharedObjectId: A_EMOTION_M4_SHARED_OBJECT_ID, eventFamily: A_EMOTION_M4_EVENT_FAMILY,
    category: "RELATED", disclosure: "CONFIRMED", severity: "CRITICAL", centerCardType: "PROMISE_BROKEN", title: "承诺破裂", summary: "一项正式承诺已被权威证据确认违背。", sourceStatus: "来源与违背事实已确认",
    knownFacts: ["正式承诺存在且仍在有效期限内", "已确认行动与承诺义务相冲突"], visibleImpacts: [],
    responseOptions: [
      { code: "RESPOND_TO_REVEALED_PROMISE", label: "立即回应", preferredEntry: "TALK", targetRoleKey: promise.issuerRole.roleKey, intentKey: "respond_to_revealed_promise", prefillText: "就已确认的承诺违背提出回应，并要求对方说明补救方案。" },
      { code: "PRESERVE_PROMISE_EVIDENCE", label: "暂时保留", preferredEntry: "PLAN", targetRoleKey: null, intentKey: "preserve_promise_evidence", prefillText: "暂不公开全部证据，把已确认记录保留为后续谈判筹码。" },
      { code: "DEFER_RESPONSE", label: "稍后处理", preferredEntry: "DEFER", targetRoleKey: null, intentKey: null, prefillText: null }
    ],
    visibleSourceRoleId: promise.issuerRoleId, visibleSourceRoleKey: promise.issuerRole.roleKey, evidenceRefs: stringList(promise.evidenceRefsJson), keyModal: modal, occurredAt: (promise.revealedAt || promise.updatedAt).toISOString()
  };
  const validated = validateAEmotionM2ProjectionV1(projection);
  if (!validated.ok) throw new ServiceUnavailableException({ code: "A_EMOTION_M4_PROJECTION_REJECTED", message: "Promise reveal projection failed validation" });
  return validated.value;
}

function promiseModal(modalId: string, eventId: string, promise: CommitmentV2, evidenceRefs: string[]): AEmotionKeyModalV1 {
  const value: AEmotionKeyModalV1 = { schemaVersion: A_EMOTION_KEY_MODAL_SCHEMA_VERSION, modalId, eventId, modalType: "PROMISE_BROKEN", triggerCode: "PROMISE_BROKEN_REVEALED", triggerVersion: promise.lifecycleVersion, projectionVersion: promise.lifecycleVersion, stateVersion: promise.lifecycleVersion, priority: A_EMOTION_M4_PROMISE_BROKEN_PRIORITY, title: "承诺破裂", summary: "权威证据确认一项正式承诺已被违背。", facts: ["承诺双方和期限已登记", `已确认 ${evidenceRefs.length} 项证据`], responseOptions: [{ code: "RESPOND_TO_REVEALED_PROMISE", label: "立即回应", preferredEntry: "TALK", intentKey: "respond_to_revealed_promise", prefillText: "就已确认的承诺违背提出回应。" }, { code: "DEFER_RESPONSE", label: "稍后处理", preferredEntry: "DEFER", intentKey: null, prefillText: null }], ariaLive: "assertive", occurredAt: (promise.revealedAt || promise.updatedAt).toISOString(), isShown: false, isAcknowledged: false };
  const validated = validateAEmotionKeyModalV1(value);
  if (!validated.ok) throw new ServiceUnavailableException({ code: "A_EMOTION_M4_MODAL_REJECTED", message: "Promise modal failed validation" });
  return validated.value;
}

function promiseContract(value: CommitmentV2): AEmotionSimplePromiseV1 {
  const contract: AEmotionSimplePromiseV1 = { schemaVersion: A_EMOTION_M4_PROMISE_SCHEMA_VERSION, promiseId: value.id, roomId: value.runId, runId: value.runId, promiseCode: value.promiseCode as AEmotionSimplePromiseCodeV1, issuerRoleId: value.issuerRoleId, receiverRoleId: value.receiverRoleId, relatedObjectId: value.relatedObjectId, visibility: value.visibility === "PUBLIC" ? "PUBLIC" : "LIMITED", status: value.status as AEmotionSimplePromiseV1["status"], deadlineStage: Number(value.expiresAtStage || 1), stateVersion: value.lifecycleVersion, brokenByActionId: value.breachActionId, evidenceRefs: stringList(value.evidenceRefsJson), createdAt: value.createdAt.toISOString(), fulfilledAt: value.fulfilledAt?.toISOString() || null, breachedAt: value.breachedAt?.toISOString() || null, revealedAt: value.revealedAt?.toISOString() || null, expiredAt: value.expiredAt?.toISOString() || null };
  const validated = validateAEmotionSimplePromiseV1(contract);
  if (!validated.ok) throw new ServiceUnavailableException({ code: "A_EMOTION_M4_PROMISE_REJECTED", message: "Promise state failed validation" });
  return validated.value;
}

function requirePromiseCommand(value: unknown): AEmotionSimplePromiseCommandV1 { const validated = validateAEmotionSimplePromiseCommandV1(value); if (!validated.ok) throw new ConflictException({ code: "SIMPLE_PROMISE_COMMAND_INVALID", message: "Formal promise command is invalid" }); return validated.value; }
type AuthoritativeLedgerCustodyMutation = {
  mutationId: string;
  assetId: string;
  ownerRoleId: string | null;
  fromRoleId: string | null;
  toRoleId: string | null;
  quantity: number;
  status: string;
  version: number;
};

async function authoritativeLedgerCustodyMutation(
  tx: Tx,
  runId: string,
  sourceActionId: string
): Promise<AuthoritativeLedgerCustodyMutation | null> {
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
      code: "A_EMOTION_M4_CUSTODY_STATE_MISMATCH",
      message: "Original-ledger custody mutation is inconsistent"
    });
  }
  return {
    mutationId: mutation.id,
    assetId: mutation.asset.id,
    ownerRoleId: mutation.asset.ownerRoleId,
    fromRoleId: mutation.fromRoleId,
    toRoleId: mutation.toRoleId,
    quantity: mutation.asset.quantity,
    status: mutation.asset.status,
    version: mutation.asset.version
  };
}

function requireTerms(value: unknown): AEmotionSimplePromiseTermsV1 { const validated = validateAEmotionSimplePromiseTermsV1(value); if (!validated.ok) throw new ServiceUnavailableException({ code: "A_EMOTION_M4_TERMS_CORRUPT", message: "Stored promise terms are invalid" }); return validated.value; }
function compileRequest(value: unknown) { const v = record(value); if (v.schemaVersion !== "a_emotion_m4_compile_requested_v1" || typeof v.promiseId !== "string" || typeof v.stageId !== "string" || !Number.isInteger(v.stageIndex) || !Number.isInteger(v.stateVersion) || typeof v.sourceResolutionId !== "string") throw new ServiceUnavailableException({ code: "A_EMOTION_M4_TASK_INVALID", message: "Promise compile task is invalid" }); return { promiseId: v.promiseId, stageId: v.stageId, stageIndex: Number(v.stageIndex), stateVersion: Number(v.stateVersion), sourceResolutionId: v.sourceResolutionId }; }
function decisionForm(value: unknown) { const v = record(value); return typeof v.decisionForm === "string" ? v.decisionForm : typeof record(v.intent).decisionForm === "string" ? String(record(v.intent).decisionForm) : ""; }
function stringList(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : []; }
function intersects(values: Set<string>, expected: string[]) { return expected.some((value) => values.has(value)); }
function record(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
async function advisoryLock(tx: Tx, key: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`; }
function opaqueId(prefix: string, value: string) { return `${prefix}_${createHash("sha256").update(value).digest("base64url").slice(0, 32)}`; }
