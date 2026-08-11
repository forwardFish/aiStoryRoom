import { ConflictException, Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type StoryRole } from "@prisma/client";
import {
  A_EMOTION_M1_EVENT_TYPE,
  A_EMOTION_M1_PROJECTION_SCHEMA_VERSION,
  validateAEmotionM1ProjectionV1,
  type AEmotionM1ProjectionV1
} from "@ai-story/shared";
import type { GamePageProjection } from "../game-page-projection";
import { gamePageProjection } from "../game-page-projection";
import { ContinuousStrategyContentService } from "../continuous-strategy/content.service";
import { ContinuousEventDeliveryService } from "../continuous-strategy/event-delivery.service";
import { PrismaService } from "../prisma.service";
import {
  A_EMOTION_M1_ACTION_KEY,
  A_EMOTION_M1_EFFECT_KEY,
  A_EMOTION_M1_FACT_KEY,
  A_EMOTION_M1_IMPERIAL_TRUST_DELTA,
  A_EMOTION_M1_SHARED_OBJECT_KEY,
  A_EMOTION_M1_SOURCE_ROLE_KEY,
  A_EMOTION_M1_TARGET_ROLE_KEY,
  isAEmotionM1EnabledForRun,
  type AEmotionM1RunGate
} from "../config/a-emotion-m1.config";
import type { PlannedIntentAction } from "./player-intent";
import { isAEmotionM2EnabledForRun } from "../config/a-emotion-m2.config";
import { A_EMOTION_M2_EVENT_FAMILY, A_EMOTION_M2_SHARED_OBJECT_ID } from "@ai-story/shared";
import { aEmotionM2AggregateIdentity } from "./a-emotion-m2.service";
import { AEmotionM3Service } from "./a-emotion-m3.service";
import { isAEmotionM3EnabledForRun } from "../config/a-emotion-m3.config";

type Tx = Prisma.TransactionClient;

const M1_STATE_SCHEMA = "a_emotion_m1_state_v1";
const M1_IMPACT_SCHEMA = "a_emotion_m1_canonical_impact_v1";
const COMPILE_TASK_TYPE = "INTERACTION_COMPILE_REQUESTED";

export type AEmotionM1CanonicalImpact = {
  schemaVersion: typeof M1_IMPACT_SCHEMA;
  resolutionId: string;
  runId: string;
  targetRoleId: string;
  actionKey: typeof A_EMOTION_M1_ACTION_KEY;
  effectKey: typeof A_EMOTION_M1_EFFECT_KEY;
  factKey: typeof A_EMOTION_M1_FACT_KEY;
  sharedObjectKey: typeof A_EMOTION_M1_SHARED_OBJECT_KEY;
  appliedWorldSequence: number;
  stateVersion: number;
  imperialTrust: { before: number; after: number; delta: number };
  createdAt: string;
};

type StoredM1State = {
  schemaVersion: typeof M1_STATE_SCHEMA;
  stateVersion: number;
  metrics: Record<string, { imperial_trust: number }>;
  impacts: Record<string, AEmotionM1CanonicalImpact>;
};

@Injectable()
export class AEmotionM1Service {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ContinuousStrategyContentService) private readonly content: ContinuousStrategyContentService,
    @Inject(ContinuousEventDeliveryService) private readonly deliveries: ContinuousEventDeliveryService,
    @Optional() @Inject(AEmotionM3Service) private readonly aEmotionM3?: AEmotionM3Service
  ) {}

  safeCanonicalFactContent(input: {
    run: AEmotionM1RunGate & { strategyVersion: string };
    sourceRole: StoryRole;
    stageIndex: number;
    action: PlannedIntentAction;
    factKey: string;
  }): string | null {
    if (!isAEmotionM1EnabledForRun(input.run)) return null;
    if (input.factKey !== A_EMOTION_M1_FACT_KEY || !this.matchesStructuredBasis(input)) return null;
    return "与原始粮册有关的部分底稿已离开常规核验链，总督可见的原始材料减少。";
  }

  /**
   * Runs inside the existing authoritative world-mutation transaction. It is
   * deterministic, derives from the exact structured card/effect/fact, persists
   * the metric change, and queues compilation in the same transaction.
   */
  async applyAuthoritativeImpact(tx: Tx, input: {
    run: {
      id: string;
      mode: string;
      maxPlayers: number;
      templateKey: string;
      strategyVersion: string;
      engineVersion: string;
      stateJson: unknown;
      currentNodeId: string | null;
    };
    sourceRole: StoryRole;
    allRoles: StoryRole[];
    resolutionId: string;
    playerActionId: string;
    stageIndex: number;
    appliedWorldSequence: number;
    action: PlannedIntentAction;
  }): Promise<{ handledTargetRoleIds: string[]; stateVersion: number | null }> {
    if (!isAEmotionM1EnabledForRun(input.run)) return { handledTargetRoleIds: [], stateVersion: null };
    if (!this.matchesStructuredBasis(input)) return { handledTargetRoleIds: [], stateVersion: null };
    if (!input.run.currentNodeId) throw new ConflictException({ code: "CURRENT_NODE_REQUIRED", message: "The run has no causal node" });

    const targetRole = input.allRoles.find((role) => role.roleKey === A_EMOTION_M1_TARGET_ROLE_KEY);
    if (!targetRole) throw new ConflictException({ code: "A_EMOTION_M1_TARGET_ROLE_MISSING", message: "M1 target role is missing" });

    // M1 replaces the legacy ACTOR_IMPACT_V2 path only when the affected role
    // is currently controlled by an active human. AI-controlled or unoccupied
    // roles must stay on the established legacy impact path and must not leave
    // an orphan interaction compile task that can only finish as NO_HUMAN_TARGET.
    const activeHumanTarget = await tx.storyPlayer.findFirst({
      where: {
        runId: input.run.id,
        roleId: targetRole.id,
        playerType: "human",
        status: "active",
        userId: { not: null }
      },
      select: { id: true, userId: true }
    });
    if (!activeHumanTarget) return { handledTargetRoleIds: [], stateVersion: null };

    const latestRunState = await tx.storyRun.findUnique({
      where: { id: input.run.id },
      select: { stateJson: true }
    });
    if (!latestRunState) throw new Error("A_EMOTION_M1_RUN_STATE_MISSING");
    const root = record(latestRunState.stateJson);
    const current = storedState(root.aEmotionM1);
    const existing = current.impacts[input.resolutionId];
    if (existing) return { handledTargetRoleIds: [existing.targetRoleId], stateVersion: existing.stateVersion };

    const configuredInitial = initialMetric(input.run.templateKey, "imperial_trust");
    if (configuredInitial === null) throw new Error("A_EMOTION_M1_IMPERIAL_TRUST_METRIC_MISSING");
    const before = current.metrics[targetRole.id]?.imperial_trust ?? configuredInitial;
    const after = Math.max(0, Math.min(100, before + A_EMOTION_M1_IMPERIAL_TRUST_DELTA));
    const stateVersion = current.stateVersion + 1;
    const impact: AEmotionM1CanonicalImpact = {
      schemaVersion: M1_IMPACT_SCHEMA,
      resolutionId: input.resolutionId,
      runId: input.run.id,
      targetRoleId: targetRole.id,
      actionKey: A_EMOTION_M1_ACTION_KEY,
      effectKey: A_EMOTION_M1_EFFECT_KEY,
      factKey: A_EMOTION_M1_FACT_KEY,
      sharedObjectKey: A_EMOTION_M1_SHARED_OBJECT_KEY,
      appliedWorldSequence: input.appliedWorldSequence,
      stateVersion,
      imperialTrust: { before, after, delta: after - before },
      createdAt: new Date().toISOString()
    };
    const nextState: StoredM1State = {
      schemaVersion: M1_STATE_SCHEMA,
      stateVersion,
      metrics: { ...current.metrics, [targetRole.id]: { imperial_trust: after } },
      impacts: { ...current.impacts, [input.resolutionId]: impact }
    };

    const resolutionRow = await tx.actionResolution.findUnique({
      where: { id: input.resolutionId },
      select: { runId: true, playerActionId: true, appliedWorldSequence: true, statePatchJson: true }
    });
    if (!resolutionRow
      || resolutionRow.runId !== input.run.id
      || resolutionRow.playerActionId !== input.playerActionId
      || resolutionRow.appliedWorldSequence !== input.appliedWorldSequence) {
      throw new Error("A_EMOTION_M1_RESOLUTION_CONTEXT_MISMATCH");
    }
    const authoritativePatch = record(resolutionRow.statePatchJson);
    await tx.actionResolution.update({
      where: { id: input.resolutionId },
      data: {
        statePatchJson: {
          ...authoritativePatch,
          aEmotionM1CanonicalImpact: impact
        } as Prisma.InputJsonValue
      }
    });
    await tx.storyRun.update({
      where: { id: input.run.id },
      data: { stateJson: { ...root, aEmotionM1: nextState } as Prisma.InputJsonValue }
    });
    const compileDedupeKey = `${COMPILE_TASK_TYPE}:${input.resolutionId}:${targetRole.id}`;
    const compileTask = await tx.storyTaskOutbox.findUnique({ where: { dedupeKey: compileDedupeKey }, select: { id: true } });
    if (!compileTask) {
      await tx.storyTaskOutbox.create({
        data: {
          runId: input.run.id,
          nodeId: input.run.currentNodeId,
          roleId: targetRole.id,
          inputRefId: input.resolutionId,
          actionSlot: "A_EMOTION_M1",
          taskType: COMPILE_TASK_TYPE,
          status: "PENDING",
          dedupeKey: compileDedupeKey,
          maxAttempts: 5,
          resultJson: {
            schemaVersion: "interaction_compile_requested_v1",
            resolutionId: input.resolutionId,
            targetRoleId: targetRole.id,
            stateVersion
          } as Prisma.InputJsonValue
        }
      });
    }
    if (isAEmotionM3EnabledForRun(input.run)) {
      if (!this.aEmotionM3 || !activeHumanTarget.userId) throw new Error("A_EMOTION_M3_SERVICE_UNAVAILABLE");
      await this.aEmotionM3.recordMetricTransition(tx, {
        run: input.run,
        targetRoleId: targetRole.id,
        targetUserId: activeHumanTarget.userId,
        sourceResolutionId: input.resolutionId,
        sourceActionId: input.playerActionId,
        stageIndex: Math.max(1, input.stageIndex),
        before,
        after,
        stateVersion
      });
    }
    return { handledTargetRoleIds: [targetRole.id], stateVersion };
  }

  async executeCompileTask(taskId: string, fence: { taskId: string; leaseOwner: string; leaseVersion: number }) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.storyTaskOutbox.findFirst({
        where: {
          id: taskId,
          taskType: COMPILE_TASK_TYPE,
          status: "RUNNING",
          leaseOwner: fence.leaseOwner,
          leaseVersion: fence.leaseVersion,
          leaseExpiresAt: { gt: new Date() }
        }
      });
      if (!task) return { outcome: "LEASE_LOST" as const };
      if (!task.inputRefId || !task.roleId) throw new Error("A_EMOTION_M1_TASK_CONTEXT_INVALID");

      const [run, resolution, taskNode, canonicalFact] = await Promise.all([
        tx.storyRun.findUnique({
          where: { id: task.runId },
          include: {
            roles: true,
            players: { where: { status: "active", playerType: "human" }, select: { userId: true, roleId: true } }
          }
        }),
        tx.actionResolution.findUnique({
          where: { id: task.inputRefId },
          include: { role: true, playerAction: true, turn: { select: { stageIndex: true } } }
        }),
        tx.sceneNode.findUnique({ where: { id: task.nodeId }, select: { runId: true } }),
        tx.canonFact.findUnique({
          where: { runId_factKey: { runId: task.runId, factKey: A_EMOTION_M1_FACT_KEY } },
          select: { status: true, visibility: true, sourceActionIdsJson: true, knownByRoleIdsJson: true, content: true }
        })
      ]);
      if (!run || !resolution || resolution.runId !== task.runId || taskNode?.runId !== task.runId) throw new Error("A_EMOTION_M1_CANONICAL_CONTEXT_MISSING");
      if (!isAEmotionM1EnabledForRun(run)) return { outcome: "FLAG_DISABLED" as const };

      const taskRequest = compileRequest(task.resultJson);
      if (resolution.qualityStatus !== "PASS") throw new Error("A_EMOTION_M1_RESOLUTION_NOT_COMMITTED");
      const state = storedState(record(run.stateJson).aEmotionM1);
      const impact = state.impacts[resolution.id];
      const resolutionImpact = parseCanonicalImpact(
        resolution.id,
        record(resolution.statePatchJson).aEmotionM1CanonicalImpact
      );
      if (!impact
        || JSON.stringify(impact) !== JSON.stringify(resolutionImpact)
        || impact.runId !== run.id
        || impact.targetRoleId !== task.roleId
        || impact.appliedWorldSequence !== resolution.appliedWorldSequence
        || impact.stateVersion > state.stateVersion
        || taskRequest.resolutionId !== resolution.id
        || taskRequest.targetRoleId !== impact.targetRoleId
        || taskRequest.stateVersion !== impact.stateVersion
        || resolution.role.roleKey !== A_EMOTION_M1_SOURCE_ROLE_KEY
        || resolution.playerAction.actionKey !== A_EMOTION_M1_ACTION_KEY
        || !canonicalFact
        || canonicalFact.status !== "confirmed"
        || canonicalFact.visibility !== "limited"
        || !stringArray(canonicalFact.sourceActionIdsJson).includes(resolution.playerActionId)
        || !stringArray(canonicalFact.knownByRoleIdsJson).includes(impact.targetRoleId)
        || aEmotionM1SemanticSourceLeak(canonicalFact.content)) {
        throw new Error("A_EMOTION_M1_STATE_VERSION_MISMATCH");
      }
      const targetRole = run.roles.find((role) => role.id === impact.targetRoleId);
      if (!targetRole || targetRole.roleKey !== A_EMOTION_M1_TARGET_ROLE_KEY) throw new Error("A_EMOTION_M1_TARGET_OWNERSHIP_INVALID");
      const targetPlayer = run.players.find((player) => player.roleId === targetRole.id && player.userId);
      if (!targetPlayer?.userId) return { outcome: "NO_HUMAN_TARGET" as const };

      const publication = await this.deliveries.publishProjected(tx, {
        runId: run.id,
        nodeId: task.nodeId,
        day: Math.max(1, run.currentDay),
        type: A_EMOTION_M1_EVENT_TYPE,
        messageType: "system",
        roleKey: targetRole.roleKey,
        visibility: "LIMITED",
        audienceType: "ROLE",
        audienceRoleIds: [targetRole.id],
        canonicalPayload: {
          schemaVersion: M1_IMPACT_SCHEMA,
          resolutionId: resolution.id,
          sharedObjectKey: impact.sharedObjectKey,
          stateVersion: impact.stateVersion
        },
        deliveries: [{
          userId: targetPlayer.userId,
          roleId: targetRole.id,
          ...(isAEmotionM2EnabledForRun(run) ? (() => {
            const stageId = `stage-${Math.max(1, resolution.turn.stageIndex)}`;
            return {
              aggregate: {
                ...aEmotionM2AggregateIdentity({ roomId: run.id, runId: run.id, viewerRoleId: targetRole.id, stageId }),
                stageId,
                sharedObjectId: A_EMOTION_M2_SHARED_OBJECT_ID,
                eventFamily: A_EMOTION_M2_EVENT_FAMILY,
                category: "RELATED" as const,
                disclosure: "HIDDEN" as const,
                projectionVersion: 1,
                stateVersion: impact.stateVersion
              }
            };
          })() : {}),
          buildPayload: (eventSequence) => this.viewerProjection(impact, eventSequence)
        }],
        dedupeKey: `A_EMOTION_M1:${resolution.id}:${targetRole.id}`,
        sourceActionId: resolution.playerActionId
      });
      return { outcome: "PUBLISHED" as const, eventId: publication.id, stateVersion: impact.stateVersion };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  applyMetricProjection(run: AEmotionM1RunGate, viewerRoleId: string, world: GamePageProjection): GamePageProjection {
    if (!isAEmotionM1EnabledForRun(run)) return world;
    const state = storedState(record(run.stateJson).aEmotionM1);
    const metric = state.metrics[viewerRoleId];
    if (!metric) return world;
    return {
      ...world,
      presentation: {
        ...world.presentation,
        statusMetrics: world.presentation.statusMetrics.map((item) => item.key === "imperial_trust"
          ? { ...item, value: metric.imperial_trust }
          : item)
      }
    };
  }

  viewerProjection(impact: AEmotionM1CanonicalImpact, eventSequence: number): AEmotionM1ProjectionV1 {
    const projection: AEmotionM1ProjectionV1 = {
      schemaVersion: A_EMOTION_M1_PROJECTION_SCHEMA_VERSION,
      projectionVersion: 1,
      stateVersion: impact.stateVersion,
      eventSequence,
      category: "RELATED",
      disclosure: "HIDDEN",
      severity: "MAJOR",
      centerCardType: "CROSS_IMPACT",
      title: "他人的行动改变了你的处境",
      summary: "原始粮册的递送出现异常，部分底稿已经离开常规核验链。",
      sourceStatus: "来源未知",
      knownFacts: ["送达材料的编号与此前登记不一致", "多个经手渠道都曾接触相关材料"],
      visibleImpacts: [{
        key: "imperial_trust",
        label: "皇帝信任",
        before: impact.imperialTrust.before,
        after: impact.imperialTrust.after,
        delta: impact.imperialTrust.delta,
        suffix: "",
        safeReason: "账册可信度受到质疑"
      }],
      responseOptions: [
        {
          code: "INVESTIGATE_LEDGER_ANOMALY",
          label: "派遣调查",
          preferredEntry: "INVESTIGATE",
          intentKey: "inspect_ledger_delivery",
          prefillText: "核对原始粮册的递送、编号和经手记录。"
        },
        {
          code: "QUESTION_DELIVERY_PUBLICLY",
          label: "公开质问",
          preferredEntry: "TALK",
          intentKey: "question_ledger_delivery",
          prefillText: "请相关经手方公开说明原始粮册为何未按登记送达。"
        },
        { code: "DEFER_RESPONSE", label: "暂不回应", preferredEntry: "DEFER", intentKey: null, prefillText: null }
      ],
      occurredAt: impact.createdAt
    };
    const validation = validateAEmotionM1ProjectionV1(projection);
    if (!validation.ok) throw new ServiceUnavailableException({ code: "A_EMOTION_M1_PROJECTION_REJECTED", message: "Viewer-safe interaction projection failed validation" });
    return projection;
  }

  private matchesStructuredBasis(input: {
    run: { templateKey: string; strategyVersion: string };
    sourceRole: StoryRole;
    stageIndex: number;
    action: PlannedIntentAction;
  }) {
    if (input.sourceRole.roleKey !== A_EMOTION_M1_SOURCE_ROLE_KEY) return false;
    if (input.action.actionKey !== A_EMOTION_M1_ACTION_KEY) return false;
    if (input.action.visibility !== "LIMITED") return false;
    const roleStage = this.content.forGame(input.run.templateKey, input.run.strategyVersion).roleStage(input.stageIndex, input.sourceRole.roleKey);
    const card = roleStage.mainCards.find((candidate) => candidate.actionKey === A_EMOTION_M1_ACTION_KEY);
    return Boolean(card
      && card.targetRoleKey === A_EMOTION_M1_TARGET_ROLE_KEY
      && card.effect.effectKey === A_EMOTION_M1_EFFECT_KEY
      && card.effect.factKeys.includes(A_EMOTION_M1_FACT_KEY)
      && card.effect.influenceEdges.some((edge) => edge.affectedRoleKey === A_EMOTION_M1_TARGET_ROLE_KEY && edge.visibility === "LIMITED")
      && input.action.effectFactKeys.includes(A_EMOTION_M1_FACT_KEY)
      && input.action.influenceEdges.some((edge) => edge.affectedRoleKey === A_EMOTION_M1_TARGET_ROLE_KEY && edge.visibility === "LIMITED"));
  }
}

function storedState(value: unknown): StoredM1State {
  if (value === undefined || value === null) return { schemaVersion: M1_STATE_SCHEMA, stateVersion: 0, metrics: {}, impacts: {} };
  const raw = record(value);
  if (raw.schemaVersion !== M1_STATE_SCHEMA || !Number.isInteger(raw.stateVersion) || Number(raw.stateVersion) < 0) {
    throw new Error("A_EMOTION_M1_STORED_STATE_INVALID");
  }
  const metrics: StoredM1State["metrics"] = {};
  for (const [roleId, candidate] of Object.entries(record(raw.metrics))) {
    const metric = record(candidate);
    if (!roleId || !Number.isInteger(metric.imperial_trust)) throw new Error("A_EMOTION_M1_STORED_STATE_INVALID");
    metrics[roleId] = { imperial_trust: Number(metric.imperial_trust) };
  }
  const impacts: StoredM1State["impacts"] = {};
  for (const [resolutionId, candidate] of Object.entries(record(raw.impacts))) {
    impacts[resolutionId] = parseCanonicalImpact(resolutionId, candidate);
  }
  return { schemaVersion: M1_STATE_SCHEMA, stateVersion: Number(raw.stateVersion), metrics, impacts };
}

function parseCanonicalImpact(resolutionId: string, value: unknown): AEmotionM1CanonicalImpact {
  const raw = record(value);
  const allowed = new Set([
    "schemaVersion", "resolutionId", "runId", "targetRoleId", "actionKey", "effectKey",
    "factKey", "sharedObjectKey", "appliedWorldSequence", "stateVersion", "imperialTrust", "createdAt"
  ]);
  if (!resolutionId || Object.keys(raw).some((key) => !allowed.has(key))
    || raw.schemaVersion !== M1_IMPACT_SCHEMA
    || raw.resolutionId !== resolutionId
    || typeof raw.runId !== "string" || !raw.runId
    || typeof raw.targetRoleId !== "string" || !raw.targetRoleId
    || raw.actionKey !== A_EMOTION_M1_ACTION_KEY
    || raw.effectKey !== A_EMOTION_M1_EFFECT_KEY
    || raw.factKey !== A_EMOTION_M1_FACT_KEY
    || raw.sharedObjectKey !== A_EMOTION_M1_SHARED_OBJECT_KEY
    || !Number.isInteger(raw.appliedWorldSequence) || Number(raw.appliedWorldSequence) < 1
    || !Number.isInteger(raw.stateVersion) || Number(raw.stateVersion) < 1
    || typeof raw.createdAt !== "string" || Number.isNaN(Date.parse(raw.createdAt))) {
    throw new Error("A_EMOTION_M1_STORED_STATE_INVALID");
  }
  const transition = record(raw.imperialTrust);
  const transitionAllowed = new Set(["before", "after", "delta"]);
  if (Object.keys(transition).some((key) => !transitionAllowed.has(key))
    || !Number.isInteger(transition.before) || !Number.isInteger(transition.after) || !Number.isInteger(transition.delta)
    || Number(transition.before) < 0 || Number(transition.before) > 100
    || Number(transition.after) < 0 || Number(transition.after) > 100
    || Number(transition.after) - Number(transition.before) !== Number(transition.delta)) {
    throw new Error("A_EMOTION_M1_STORED_STATE_INVALID");
  }
  return {
    schemaVersion: M1_IMPACT_SCHEMA,
    resolutionId,
    runId: raw.runId,
    targetRoleId: raw.targetRoleId,
    actionKey: A_EMOTION_M1_ACTION_KEY,
    effectKey: A_EMOTION_M1_EFFECT_KEY,
    factKey: A_EMOTION_M1_FACT_KEY,
    sharedObjectKey: A_EMOTION_M1_SHARED_OBJECT_KEY,
    appliedWorldSequence: Number(raw.appliedWorldSequence),
    stateVersion: Number(raw.stateVersion),
    imperialTrust: {
      before: Number(transition.before),
      after: Number(transition.after),
      delta: Number(transition.delta)
    },
    createdAt: raw.createdAt
  };
}

function compileRequest(value: unknown): { resolutionId: string; targetRoleId: string; stateVersion: number } {
  const raw = record(value);
  if (raw.schemaVersion !== "interaction_compile_requested_v1"
    || typeof raw.resolutionId !== "string" || !raw.resolutionId
    || typeof raw.targetRoleId !== "string" || !raw.targetRoleId
    || !Number.isInteger(raw.stateVersion) || Number(raw.stateVersion) < 1) {
    throw new Error("A_EMOTION_M1_TASK_REQUEST_INVALID");
  }
  return { resolutionId: raw.resolutionId, targetRoleId: raw.targetRoleId, stateVersion: Number(raw.stateVersion) };
}

function initialMetric(worldId: string, key: string): number | null {
  const metric = gamePageProjection(worldId).presentation.statusMetrics.find((item) => item.key === key);
  return Number.isInteger(metric?.value) ? Number(metric?.value) : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function aEmotionM1SemanticSourceLeak(value: unknown): boolean {
  return typeof value === "string" && /xunfu|巡抚|命令县令|要求县令|只(?:交|提交)(?:了)?(?:转抄)?副本|隐(?:藏|瞒)(?:了)?原(?:始)?粮册/i.test(value);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
