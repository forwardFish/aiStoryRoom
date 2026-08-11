import { createHash } from "node:crypto";
import { ConflictException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type StoryRole } from "@prisma/client";
import {
  A_EMOTION_M1_PROJECTION_SCHEMA_VERSION,
  A_EMOTION_M2_EVENT_FAMILY,
  A_EMOTION_M2_EVENT_TYPE,
  A_EMOTION_M2_PROJECTION_SCHEMA_VERSION,
  A_EMOTION_M2_SHARED_OBJECT_ID,
  validateAEmotionM1ProjectionV1,
  validateAEmotionM2ProjectionV1,
  upgradeAEmotionM1ProjectionToM2,
  type AEmotionM1ProjectionV1,
  type AEmotionM2DisclosureV1,
  type AEmotionM2ProjectionV1
} from "@ai-story/shared";
import { ContinuousStrategyContentService } from "../continuous-strategy/content.service";
import { ContinuousEventDeliveryService } from "../continuous-strategy/event-delivery.service";
import { PrismaService } from "../prisma.service";
import {
  A_EMOTION_M2_CONFIRM_ACTION_KEY,
  A_EMOTION_M2_CONFIRM_EFFECT_KEY,
  A_EMOTION_M2_CONFIRM_FACT_KEY,
  A_EMOTION_M2_OTHER_SUSPECT_ROLE_KEY,
  A_EMOTION_M2_SOURCE_ROLE_KEY,
  A_EMOTION_M2_SUSPECT_ACTION_KEY,
  A_EMOTION_M2_SUSPECT_EFFECT_KEY,
  A_EMOTION_M2_SUSPECT_FACT_KEY,
  A_EMOTION_M2_VIEWER_ROLE_KEY,
  isAEmotionM2EnabledForRun
} from "../config/a-emotion-m2.config";
import type { PlannedIntentAction } from "./player-intent";

const M2_STATE_SCHEMA = "a_emotion_m2_state_v1" as const;
const M2_UPGRADE_SCHEMA = "a_emotion_m2_canonical_upgrade_v1" as const;
export const A_EMOTION_M2_TASK_TYPE = "INTERACTION_DISCLOSURE_COMPILE_REQUESTED" as const;

export type AEmotionM2CanonicalUpgrade = {
  schemaVersion: typeof M2_UPGRADE_SCHEMA;
  resolutionId: string;
  runId: string;
  viewerRoleId: string;
  baseEventId: string;
  aggregateKey: string;
  aggregateId: string;
  stageId: string;
  previousDisclosure: AEmotionM2DisclosureV1;
  nextDisclosure: Exclude<AEmotionM2DisclosureV1, "HIDDEN">;
  projectionVersion: number;
  stateVersion: number;
  actionKey: typeof A_EMOTION_M2_SUSPECT_ACTION_KEY | typeof A_EMOTION_M2_CONFIRM_ACTION_KEY;
  effectKey: typeof A_EMOTION_M2_SUSPECT_EFFECT_KEY | typeof A_EMOTION_M2_CONFIRM_EFFECT_KEY;
  factKey: typeof A_EMOTION_M2_SUSPECT_FACT_KEY | typeof A_EMOTION_M2_CONFIRM_FACT_KEY;
  createdAt: string;
};

type StoredM2State = {
  schemaVersion: typeof M2_STATE_SCHEMA;
  stateVersion: number;
  upgrades: Record<string, AEmotionM2CanonicalUpgrade>;
};

type LatestAggregateRow = {
  eventId: string;
  aggregateKey: string | null;
  aggregateId: string | null;
  stageId: string | null;
  sharedObjectId: string | null;
  eventFamily: string | null;
  disclosure: string | null;
  projectionVersion: number;
  stateVersion: number;
  payloadJson: unknown;
  event: { id: string; runId: string; type: string; sequence: number | null };
};

@Injectable()
export class AEmotionM2Service {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ContinuousStrategyContentService) private readonly content: ContinuousStrategyContentService,
    @Inject(ContinuousEventDeliveryService) private readonly deliveries: ContinuousEventDeliveryService
  ) {}

  /**
   * Called inside the existing authoritative mutation transaction. M2 never
   * reads player prose: only exact configured action/effect/fact tuples can
   * request a disclosure upgrade.
   */
  async applyAuthoritativeUpgrade(tx: Prisma.TransactionClient, input: {
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
  }): Promise<{ queued: boolean; nextDisclosure: AEmotionM2DisclosureV1 | null }> {
    if (!isAEmotionM2EnabledForRun(input.run)) return { queued: false, nextDisclosure: null };
    if (!input.run.currentNodeId) throw new ConflictException({ code: "CURRENT_NODE_REQUIRED", message: "The run has no causal node" });

    const viewerRole = input.allRoles.find((role) => role.roleKey === A_EMOTION_M2_VIEWER_ROLE_KEY);
    if (!viewerRole || input.sourceRole.id !== viewerRole.id) return { queued: false, nextDisclosure: null };
    const viewerPlayer = await tx.storyPlayer.findFirst({
      where: { runId: input.run.id, roleId: viewerRole.id, playerType: "human", status: "active", userId: { not: null } },
      select: { userId: true }
    });
    if (!viewerPlayer?.userId) return { queued: false, nextDisclosure: null };

    const expectedStageId = aEmotionM2StageId(input.stageIndex);
    const expectedAggregate = aEmotionM2AggregateIdentity({
      roomId: input.run.id,
      runId: input.run.id,
      viewerRoleId: viewerRole.id,
      stageId: expectedStageId
    });
    const latest = await this.latestAggregate(tx, input.run.id, viewerPlayer.userId, viewerRole.id, {
      stageId: expectedStageId,
      aggregateKey: expectedAggregate.aggregateKey,
      aggregateId: expectedAggregate.aggregateId
    });
    if (!latest) return { queued: false, nextDisclosure: null };
    const currentDisclosure = parseDisclosure(latest.disclosure);
    const nextDisclosure = this.nextDisclosureForAction(input, currentDisclosure);
    if (!nextDisclosure) return { queued: false, nextDisclosure: null };

    const latestRun = await tx.storyRun.findUnique({ where: { id: input.run.id }, select: { stateJson: true } });
    if (!latestRun) throw new Error("A_EMOTION_M2_RUN_STATE_MISSING");
    const root = record(latestRun.stateJson);
    const state = storedState(root.aEmotionM2);
    const existing = state.upgrades[input.resolutionId];
    if (existing) return { queued: true, nextDisclosure: existing.nextDisclosure };

    const basis = basisFor(nextDisclosure);
    const projectionVersion = latest.projectionVersion + 1;
    const stateVersion = Math.max(state.stateVersion, latest.stateVersion) + 1;
    const upgrade: AEmotionM2CanonicalUpgrade = {
      schemaVersion: M2_UPGRADE_SCHEMA,
      resolutionId: input.resolutionId,
      runId: input.run.id,
      viewerRoleId: viewerRole.id,
      baseEventId: latest.eventId,
      aggregateKey: expectedAggregate.aggregateKey,
      aggregateId: expectedAggregate.aggregateId,
      stageId: expectedStageId,
      previousDisclosure: currentDisclosure,
      nextDisclosure,
      projectionVersion,
      stateVersion,
      actionKey: basis.actionKey,
      effectKey: basis.effectKey,
      factKey: basis.factKey,
      createdAt: new Date().toISOString()
    };

    const resolution = await tx.actionResolution.findUnique({
      where: { id: input.resolutionId },
      select: { runId: true, playerActionId: true, appliedWorldSequence: true, statePatchJson: true }
    });
    if (!resolution
      || resolution.runId !== input.run.id
      || resolution.playerActionId !== input.playerActionId
      || resolution.appliedWorldSequence !== input.appliedWorldSequence) {
      throw new Error("A_EMOTION_M2_RESOLUTION_CONTEXT_MISMATCH");
    }
    await tx.actionResolution.update({
      where: { id: input.resolutionId },
      data: { statePatchJson: { ...record(resolution.statePatchJson), aEmotionM2CanonicalUpgrade: upgrade } as Prisma.InputJsonValue }
    });
    await tx.storyRun.update({
      where: { id: input.run.id },
      data: {
        stateJson: {
          ...root,
          aEmotionM2: {
            schemaVersion: M2_STATE_SCHEMA,
            stateVersion,
            upgrades: { ...state.upgrades, [input.resolutionId]: upgrade }
          }
        } as Prisma.InputJsonValue
      }
    });

    const dedupeKey = `${A_EMOTION_M2_TASK_TYPE}:${input.resolutionId}:${viewerRole.id}:${projectionVersion}`;
    const existingTask = await tx.storyTaskOutbox.findUnique({ where: { dedupeKey }, select: { id: true } });
    if (!existingTask) {
      await tx.storyTaskOutbox.create({
        data: {
          runId: input.run.id,
          nodeId: input.run.currentNodeId,
          roleId: viewerRole.id,
          inputRefId: input.resolutionId,
          actionSlot: "A_EMOTION_M2",
          taskType: A_EMOTION_M2_TASK_TYPE,
          status: "PENDING",
          dedupeKey,
          maxAttempts: 5,
          resultJson: {
            schemaVersion: "interaction_disclosure_compile_requested_v1",
            resolutionId: input.resolutionId,
            viewerRoleId: viewerRole.id,
            stageId: expectedStageId,
            aggregateKey: expectedAggregate.aggregateKey,
            aggregateId: expectedAggregate.aggregateId,
            projectionVersion,
            stateVersion
          } as Prisma.InputJsonValue
        }
      });
    }
    return { queued: true, nextDisclosure };
  }

  async executeCompileTask(taskId: string, fence: { taskId: string; leaseOwner: string; leaseVersion: number }) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.storyTaskOutbox.findFirst({
        where: {
          id: taskId,
          taskType: A_EMOTION_M2_TASK_TYPE,
          status: "RUNNING",
          leaseOwner: fence.leaseOwner,
          leaseVersion: fence.leaseVersion,
          leaseExpiresAt: { gt: new Date() }
        }
      });
      if (!task) return { outcome: "LEASE_LOST" as const };
      if (!task.inputRefId || !task.roleId) throw new Error("A_EMOTION_M2_TASK_CONTEXT_INVALID");
      const request = compileRequest(task.resultJson);
      if (request.resolutionId !== task.inputRefId || request.viewerRoleId !== task.roleId) throw new Error("A_EMOTION_M2_TASK_REQUEST_MISMATCH");

      const [run, resolution, node] = await Promise.all([
        tx.storyRun.findUnique({
          where: { id: task.runId },
          include: {
            roles: true,
            players: { where: { status: "active", playerType: "human" }, select: { userId: true, roleId: true } }
          }
        }),
        tx.actionResolution.findUnique({ where: { id: task.inputRefId }, include: { role: true, playerAction: true, turn: { select: { stageIndex: true } } } }),
        tx.sceneNode.findUnique({ where: { id: task.nodeId }, select: { runId: true } })
      ]);
      if (!run || !resolution || resolution.runId !== task.runId || node?.runId !== task.runId) throw new Error("A_EMOTION_M2_CANONICAL_CONTEXT_MISSING");
      if (resolution.qualityStatus !== "PASS") throw new Error("A_EMOTION_M2_RESOLUTION_NOT_COMMITTED");
      if (!isAEmotionM2EnabledForRun(run)) return { outcome: "FLAG_DISABLED" as const };

      const root = record(run.stateJson);
      const upgrade = parseUpgrade(resolution.id, record(resolution.statePatchJson).aEmotionM2CanonicalUpgrade);
      const state = storedState(root.aEmotionM2);
      const persisted = state.upgrades[resolution.id];
      if (!persisted || canonicalUpgradeHash(persisted) !== canonicalUpgradeHash(upgrade)
        || upgrade.projectionVersion !== request.projectionVersion
        || upgrade.stateVersion !== request.stateVersion) {
        throw new Error("A_EMOTION_M2_STATE_VERSION_MISMATCH");
      }

      const viewerRole = run.roles.find((role) => role.id === upgrade.viewerRoleId && role.roleKey === A_EMOTION_M2_VIEWER_ROLE_KEY);
      const sourceRole = run.roles.find((role) => role.roleKey === A_EMOTION_M2_SOURCE_ROLE_KEY);
      const otherSuspectRole = run.roles.find((role) => role.roleKey === A_EMOTION_M2_OTHER_SUSPECT_ROLE_KEY);
      const viewerPlayer = run.players.find((player) => player.roleId === viewerRole?.id && player.userId);
      if (!viewerRole || !sourceRole || !otherSuspectRole || !viewerPlayer?.userId) return { outcome: "NO_HUMAN_VIEWER" as const };
      if (!this.matchesCommittedBasis(run, resolution.role, resolution.playerAction.actionKey, resolution.turn.stageIndex, upgrade)) {
        throw new Error("A_EMOTION_M2_STRUCTURED_BASIS_MISMATCH");
      }
      const expectedStageId = aEmotionM2StageId(resolution.turn.stageIndex);
      const expectedAggregate = aEmotionM2AggregateIdentity({
        roomId: run.id,
        runId: run.id,
        viewerRoleId: viewerRole.id,
        stageId: expectedStageId
      });
      if (request.stageId !== expectedStageId
        || request.aggregateKey !== expectedAggregate.aggregateKey
        || request.aggregateId !== expectedAggregate.aggregateId
        || upgrade.stageId !== expectedStageId
        || upgrade.aggregateKey !== expectedAggregate.aggregateKey
        || upgrade.aggregateId !== expectedAggregate.aggregateId) {
        throw new Error("A_EMOTION_M2_TASK_AGGREGATE_MISMATCH");
      }

      const latest = await this.latestAggregate(tx, run.id, viewerPlayer.userId, viewerRole.id, {
        stageId: expectedStageId,
        aggregateKey: expectedAggregate.aggregateKey,
        aggregateId: expectedAggregate.aggregateId
      });
      if (!latest
        || latest.eventId !== upgrade.baseEventId
        || latest.aggregateKey !== upgrade.aggregateKey
        || latest.aggregateId !== upgrade.aggregateId
        || latest.projectionVersion + 1 !== upgrade.projectionVersion
        || parseDisclosure(latest.disclosure) !== upgrade.previousDisclosure) {
        throw new Error("A_EMOTION_M2_AGGREGATE_MOVED");
      }
      const previous = normalizePreviousProjection(latest);
      const evidenceFact = await tx.canonFact.findUnique({
        where: { runId_factKey: { runId: run.id, factKey: upgrade.factKey } },
        select: { id: true, status: true, sourceActionIdsJson: true, knownByRoleIdsJson: true }
      });
      if (!evidenceFact || evidenceFact.status !== "confirmed"
        || !stringArray(evidenceFact.sourceActionIdsJson).includes(resolution.playerActionId)
        || !stringArray(evidenceFact.knownByRoleIdsJson).includes(viewerRole.id)) {
        throw new Error("A_EMOTION_M2_EVIDENCE_FACT_MISSING");
      }

      const publication = await this.deliveries.publishProjected(tx, {
        runId: run.id,
        nodeId: task.nodeId,
        day: Math.max(1, run.currentDay),
        type: A_EMOTION_M2_EVENT_TYPE,
        messageType: "system",
        roleKey: viewerRole.roleKey,
        visibility: "LIMITED",
        audienceType: "ROLE",
        audienceRoleIds: [viewerRole.id],
        canonicalPayload: {
          schemaVersion: M2_UPGRADE_SCHEMA,
          resolutionId: resolution.id,
          baseEventId: upgrade.baseEventId,
          sourceRoleId: sourceRole.id,
          aggregateKey: upgrade.aggregateKey,
          projectionVersion: upgrade.projectionVersion,
          stateVersion: upgrade.stateVersion,
          nextDisclosure: upgrade.nextDisclosure,
          evidenceFactId: evidenceFact.id
        },
        deliveries: [{
          userId: viewerPlayer.userId,
          roleId: viewerRole.id,
          aggregate: {
            aggregateKey: upgrade.aggregateKey,
            aggregateId: upgrade.aggregateId,
            stageId: upgrade.stageId,
            sharedObjectId: A_EMOTION_M2_SHARED_OBJECT_ID,
            eventFamily: A_EMOTION_M2_EVENT_FAMILY,
            category: upgrade.nextDisclosure === "SUSPECTED" ? "SUSPICIOUS" : "RELATED",
            disclosure: upgrade.nextDisclosure,
            projectionVersion: upgrade.projectionVersion,
            stateVersion: upgrade.stateVersion
          },
          buildPayload: (eventSequence) => this.viewerProjection({
            previous,
            upgrade,
            eventSequence,
            sourceRoleId: sourceRole.id,
            suspectRoleIds: [sourceRole.id, otherSuspectRole.id],
            evidenceFactId: evidenceFact.id
          })
        }],
        dedupeKey: `A_EMOTION_M2:${resolution.id}:${viewerRole.id}:${upgrade.projectionVersion}`,
        sourceActionId: resolution.playerActionId
      });
      return { outcome: "PUBLISHED" as const, eventId: publication.id, projectionVersion: upgrade.projectionVersion };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  viewerProjection(input: {
    previous: AEmotionM2ProjectionV1;
    upgrade: AEmotionM2CanonicalUpgrade;
    eventSequence: number;
    sourceRoleId: string;
    suspectRoleIds: string[];
    evidenceFactId: string;
  }): AEmotionM2ProjectionV1 {
    const common = {
      schemaVersion: A_EMOTION_M2_PROJECTION_SCHEMA_VERSION,
      projectionVersion: input.upgrade.projectionVersion,
      stateVersion: input.upgrade.stateVersion,
      eventSequence: input.eventSequence,
      aggregateId: input.upgrade.aggregateId,
      stageId: input.upgrade.stageId,
      sharedObjectId: A_EMOTION_M2_SHARED_OBJECT_ID,
      eventFamily: A_EMOTION_M2_EVENT_FAMILY,
      visibleImpacts: input.previous.visibleImpacts.map((item) => ({ ...item })),
      occurredAt: input.upgrade.createdAt
    } as const;
    const projection: AEmotionM2ProjectionV1 = input.upgrade.nextDisclosure === "SUSPECTED"
      ? {
          ...common,
          category: "SUSPICIOUS",
          disclosure: "SUSPECTED",
          severity: "MAJOR",
          centerCardType: "SUSPICIOUS_TRACE",
          title: "粮册流转留下了可疑迹象",
          summary: "递送记录与复核时序存在冲突，但现有证据仍不足以确认由哪一名经手角色授意。",
          sourceStatus: "两名经手角色均有嫌疑",
          knownFacts: ["递送时间晚于原定登记", "异常发生在一次临时复核之后"],
          responseOptions: [
            { code: "CONTINUE_LEDGER_EVIDENCE_SEARCH", label: "继续追查", preferredEntry: "INVESTIGATE", targetRoleKey: null, intentKey: "inspect_ledger_authority_chain", prefillText: "继续核对复核手令、递送登记、装订编号和实际经手记录。" },
            { code: "QUESTION_LEDGER_HANDLERS", label: "公开质问", preferredEntry: "TALK", targetRoleKey: null, intentKey: "question_ledger_handlers", prefillText: "请相关经手方公开说明复核与递送记录为何不一致，并提交可核验文书。" },
            { code: "DEFER_RESPONSE", label: "保留证据", preferredEntry: "DEFER", targetRoleKey: null, intentKey: null, prefillText: null }
          ],
          visibleSuspectRoleIds: [...new Set(input.suspectRoleIds)]
        }
      : {
          ...common,
          category: "RELATED",
          disclosure: "CONFIRMED",
          severity: "CRITICAL",
          centerCardType: "REVEAL",
          title: "账册异常的来源已经确认",
          summary: "两份权威记录相互印证，异常递送已经能够归责到一名明确经手角色。",
          sourceStatus: "来源已确认",
          knownFacts: ["权威手令记录与递送登记相互印证", "装订编号与原始登记存在可核验差异"],
          responseOptions: [
            { code: "EXPOSE_CONFIRMED_LEDGER_ORDER", label: "公开揭露", preferredEntry: "PLAN", targetRoleKey: A_EMOTION_M2_SOURCE_ROLE_KEY, intentKey: "publish_confirmed_ledger_evidence", prefillText: "公开已经核验的手令与递送登记，要求责任方解释异常递送并交出原始材料。" },
            { code: "PRESSURE_CONFIRMED_SOURCE", label: "私下施压", preferredEntry: "TALK", targetRoleKey: A_EMOTION_M2_SOURCE_ROLE_KEY, intentKey: "pressure_confirmed_ledger_source", prefillText: "出示已核验证据，要求责任方立即配合原始粮册核验并停止控制递送口径。" },
            { code: "DEFER_RESPONSE", label: "暂时隐瞒", preferredEntry: "DEFER", targetRoleKey: null, intentKey: null, prefillText: null }
          ],
          visibleSourceRoleId: input.sourceRoleId,
          visibleSourceRoleKey: A_EMOTION_M2_SOURCE_ROLE_KEY,
          evidenceRefs: [`canon-fact:${input.evidenceFactId}`]
        };
    const validation = validateAEmotionM2ProjectionV1(projection);
    if (!validation.ok) throw new ServiceUnavailableException({ code: "A_EMOTION_M2_PROJECTION_REJECTED", message: "Viewer-safe disclosure projection failed validation" });
    return validation.value;
  }

  private nextDisclosureForAction(input: {
    run: { templateKey: string; strategyVersion: string };
    sourceRole: StoryRole;
    stageIndex: number;
    action: PlannedIntentAction;
  }, current: AEmotionM2DisclosureV1): Exclude<AEmotionM2DisclosureV1, "HIDDEN"> | null {
    if (current === "HIDDEN" && this.matchesBasis(input, "SUSPECTED")) return "SUSPECTED";
    if (current === "SUSPECTED" && this.matchesBasis(input, "CONFIRMED")) return "CONFIRMED";
    return null;
  }

  private matchesBasis(input: {
    run: { templateKey: string; strategyVersion: string };
    sourceRole: StoryRole;
    stageIndex: number;
    action: PlannedIntentAction;
  }, next: Exclude<AEmotionM2DisclosureV1, "HIDDEN">): boolean {
    if (input.sourceRole.roleKey !== A_EMOTION_M2_VIEWER_ROLE_KEY) return false;
    const basis = basisFor(next);
    if (input.action.actionKey !== basis.actionKey || !input.action.effectFactKeys.includes(basis.factKey)) return false;
    const stage = this.content.forGame(input.run.templateKey, input.run.strategyVersion).roleStage(input.stageIndex, input.sourceRole.roleKey);
    const card = stage.mainCards.find((candidate) => candidate.actionKey === basis.actionKey);
    return Boolean(card
      && card.effect.effectKey === basis.effectKey
      && card.effect.factKeys.includes(basis.factKey)
      && input.action.visibility === card.visibility);
  }

  private matchesCommittedBasis(run: { templateKey: string; strategyVersion: string }, role: StoryRole, actionKey: string | null, stageIndex: number, upgrade: AEmotionM2CanonicalUpgrade): boolean {
    if (role.roleKey !== A_EMOTION_M2_VIEWER_ROLE_KEY || actionKey !== upgrade.actionKey) return false;
    if (!Number.isInteger(stageIndex) || stageIndex < 1) return false;
    const stage = this.content.forGame(run.templateKey, run.strategyVersion).roleStage(stageIndex, role.roleKey);
    const card = stage.mainCards.find((candidate) => candidate.actionKey === upgrade.actionKey);
    return Boolean(card && card.effect.effectKey === upgrade.effectKey && card.effect.factKeys.includes(upgrade.factKey));
  }

  private latestAggregate(
    tx: Prisma.TransactionClient,
    roomId: string,
    userId: string,
    roleId: string,
    expected: { stageId: string; aggregateKey: string; aggregateId: string }
  ): Promise<LatestAggregateRow | null> {
    return tx.eventDelivery.findFirst({
      where: {
        roomId,
        userId,
        roleId,
        aggregateKey: expected.aggregateKey,
        aggregateId: expected.aggregateId,
        stageId: expected.stageId,
        sharedObjectId: A_EMOTION_M2_SHARED_OBJECT_ID,
        eventFamily: A_EMOTION_M2_EVENT_FAMILY
      },
      orderBy: [{ projectionVersion: "desc" }, { deliverySequence: "desc" }],
      select: {
        eventId: true,
        aggregateKey: true,
        aggregateId: true,
        stageId: true,
        sharedObjectId: true,
        eventFamily: true,
        disclosure: true,
        projectionVersion: true,
        stateVersion: true,
        payloadJson: true,
        event: { select: { id: true, runId: true, type: true, sequence: true } }
      }
    });
  }
}

export function aEmotionM2StageId(stageIndex: number) {
  if (!Number.isInteger(stageIndex) || stageIndex < 1) throw new Error("A_EMOTION_M2_STAGE_INDEX_INVALID");
  return `stage-${stageIndex}`;
}

export function aEmotionM2AggregateIdentity(input: {
  roomId: string;
  runId: string;
  viewerRoleId: string;
  stageId: string;
  sharedObjectId?: string;
  eventFamily?: string;
}) {
  const raw = [input.roomId, input.runId, input.viewerRoleId, input.stageId, input.sharedObjectId || A_EMOTION_M2_SHARED_OBJECT_ID, input.eventFamily || A_EMOTION_M2_EVENT_FAMILY].join("\0");
  const digest = createHash("sha256").update(raw).digest("hex");
  return { aggregateKey: `aemotion:m2:${digest}`, aggregateId: `agg_${digest.slice(0, 32)}` };
}

export function normalizePreviousProjection(row: LatestAggregateRow): AEmotionM2ProjectionV1 {
  const envelope = record(row.payloadJson);
  const payload = record(envelope.payload);
  const m2 = validateAEmotionM2ProjectionV1(payload);
  if (m2.ok) return m2.value;
  const m1 = validateAEmotionM1ProjectionV1(payload);
  if (!m1.ok) throw new Error("A_EMOTION_M2_PREVIOUS_PROJECTION_INVALID");
  if (!row.aggregateId || !row.stageId || row.sharedObjectId !== A_EMOTION_M2_SHARED_OBJECT_ID || row.eventFamily !== A_EMOTION_M2_EVENT_FAMILY) {
    throw new Error("A_EMOTION_M2_PREVIOUS_METADATA_INVALID");
  }
  return upgradeAEmotionM1ProjectionToM2({ projection: m1.value, aggregateId: row.aggregateId, stageId: row.stageId });
}

function basisFor(next: Exclude<AEmotionM2DisclosureV1, "HIDDEN">) {
  return next === "SUSPECTED"
    ? { actionKey: A_EMOTION_M2_SUSPECT_ACTION_KEY, effectKey: A_EMOTION_M2_SUSPECT_EFFECT_KEY, factKey: A_EMOTION_M2_SUSPECT_FACT_KEY }
    : { actionKey: A_EMOTION_M2_CONFIRM_ACTION_KEY, effectKey: A_EMOTION_M2_CONFIRM_EFFECT_KEY, factKey: A_EMOTION_M2_CONFIRM_FACT_KEY };
}

function parseDisclosure(value: unknown): AEmotionM2DisclosureV1 {
  if (value === "HIDDEN" || value === "SUSPECTED" || value === "CONFIRMED") return value;
  throw new Error("A_EMOTION_M2_DISCLOSURE_INVALID");
}

function storedState(value: unknown): StoredM2State {
  if (value === undefined || value === null) return { schemaVersion: M2_STATE_SCHEMA, stateVersion: 0, upgrades: {} };
  const raw = record(value);
  if (raw.schemaVersion !== M2_STATE_SCHEMA || !Number.isInteger(raw.stateVersion) || Number(raw.stateVersion) < 0) throw new Error("A_EMOTION_M2_STORED_STATE_INVALID");
  const upgrades: Record<string, AEmotionM2CanonicalUpgrade> = {};
  for (const [resolutionId, candidate] of Object.entries(record(raw.upgrades))) upgrades[resolutionId] = parseUpgrade(resolutionId, candidate);
  return { schemaVersion: M2_STATE_SCHEMA, stateVersion: Number(raw.stateVersion), upgrades };
}

function parseUpgrade(resolutionId: string, value: unknown): AEmotionM2CanonicalUpgrade {
  const raw = record(value);
  const allowed = new Set(["schemaVersion", "resolutionId", "runId", "viewerRoleId", "baseEventId", "aggregateKey", "aggregateId", "stageId", "previousDisclosure", "nextDisclosure", "projectionVersion", "stateVersion", "actionKey", "effectKey", "factKey", "createdAt"]);
  if (!resolutionId || Object.keys(raw).some((key) => !allowed.has(key))
    || raw.schemaVersion !== M2_UPGRADE_SCHEMA
    || raw.resolutionId !== resolutionId
    || typeof raw.runId !== "string" || !raw.runId
    || typeof raw.viewerRoleId !== "string" || !raw.viewerRoleId
    || typeof raw.baseEventId !== "string" || !raw.baseEventId
    || typeof raw.aggregateKey !== "string" || !raw.aggregateKey
    || typeof raw.aggregateId !== "string" || !raw.aggregateId
    || typeof raw.stageId !== "string" || !raw.stageId
    || !(raw.previousDisclosure === "HIDDEN" || raw.previousDisclosure === "SUSPECTED")
    || !(raw.nextDisclosure === "SUSPECTED" || raw.nextDisclosure === "CONFIRMED")
    || !Number.isInteger(raw.projectionVersion) || Number(raw.projectionVersion) < 2
    || !Number.isInteger(raw.stateVersion) || Number(raw.stateVersion) < 1
    || typeof raw.createdAt !== "string" || Number.isNaN(Date.parse(raw.createdAt))) throw new Error("A_EMOTION_M2_STORED_STATE_INVALID");
  const basis = basisFor(raw.nextDisclosure);
  if (raw.actionKey !== basis.actionKey || raw.effectKey !== basis.effectKey || raw.factKey !== basis.factKey) throw new Error("A_EMOTION_M2_STORED_STATE_INVALID");
  if ((raw.previousDisclosure === "HIDDEN" && raw.nextDisclosure !== "SUSPECTED") || (raw.previousDisclosure === "SUSPECTED" && raw.nextDisclosure !== "CONFIRMED")) throw new Error("A_EMOTION_M2_DISCLOSURE_TRANSITION_INVALID");
  return {
    schemaVersion: M2_UPGRADE_SCHEMA,
    resolutionId,
    runId: raw.runId,
    viewerRoleId: raw.viewerRoleId,
    baseEventId: raw.baseEventId,
    aggregateKey: raw.aggregateKey,
    aggregateId: raw.aggregateId,
    stageId: raw.stageId,
    previousDisclosure: raw.previousDisclosure,
    nextDisclosure: raw.nextDisclosure,
    projectionVersion: Number(raw.projectionVersion),
    stateVersion: Number(raw.stateVersion),
    actionKey: basis.actionKey,
    effectKey: basis.effectKey,
    factKey: basis.factKey,
    createdAt: raw.createdAt
  };
}

function compileRequest(value: unknown) {
  const raw = record(value);
  const allowed = new Set(["schemaVersion", "resolutionId", "viewerRoleId", "stageId", "aggregateKey", "aggregateId", "projectionVersion", "stateVersion"]);
  if (Object.keys(raw).some((key) => !allowed.has(key))
    || raw.schemaVersion !== "interaction_disclosure_compile_requested_v1"
    || typeof raw.resolutionId !== "string" || !raw.resolutionId
    || typeof raw.viewerRoleId !== "string" || !raw.viewerRoleId
    || typeof raw.stageId !== "string" || !raw.stageId
    || typeof raw.aggregateKey !== "string" || !raw.aggregateKey
    || typeof raw.aggregateId !== "string" || !raw.aggregateId
    || !Number.isInteger(raw.projectionVersion) || Number(raw.projectionVersion) < 2
    || !Number.isInteger(raw.stateVersion) || Number(raw.stateVersion) < 1) throw new Error("A_EMOTION_M2_TASK_REQUEST_INVALID");
  return {
    resolutionId: raw.resolutionId,
    viewerRoleId: raw.viewerRoleId,
    stageId: raw.stageId,
    aggregateKey: raw.aggregateKey,
    aggregateId: raw.aggregateId,
    projectionVersion: Number(raw.projectionVersion),
    stateVersion: Number(raw.stateVersion)
  };
}

function canonicalUpgradeHash(value: AEmotionM2CanonicalUpgrade) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}


function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
