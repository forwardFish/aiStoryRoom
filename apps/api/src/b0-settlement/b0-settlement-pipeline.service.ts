import { createHash } from "node:crypto";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  B0ActionContractV1,
  B0BatchCommitManifestV1,
  B0RoomRulesetV1,
  B0SettlementResolutionV1,
  B0SettlementSnapshotV1,
  B0SettlementWindowV1,
} from "@ai-story/shared";
import {
  buildB0PublicationPlanV1,
  createB0RoomRulesetV1,
  settleB0BatchV1,
  type B0PublicationDeliveryV1,
  type B0PublicationPlanV1,
} from "@ai-story/templates";
import { OpenNovelRuntimeClient } from "../openovel-adapter/openovel-runtime.client";
import { PrismaService } from "../prisma.service";
import { assertStoredManifestV1 } from "./b0-settlement-commit.core";
import { B0SettlementCommitService } from "./b0-settlement-commit.prisma";
import {
  assertB0StoredIntentEnvelopeV1,
  assertB0WindowConfigV1,
  type B0FreezeEnvelopeV1,
} from "./b0-window-coordinator.core";
import { B0WindowCoordinatorService } from "./b0-window-coordinator.prisma";

const ACTIVE_B0_WINDOW_STATUSES = [
  "OPEN",
  "LOCKED",
  "SETTLING",
  "COMMITTED",
  "PUBLISHING",
  "FAILED_RETRYABLE",
] as const;

const B0_STRATEGY_VERSIONS = new Set([
  "b0_windowed_v1",
  "openovel_role_v1",
  "OPENOVEL_ROLE_V1",
]);

export type B0TaskFenceV1 = {
  taskId: string;
  leaseOwner: string;
  leaseVersion: number;
};

type JsonRecord = Record<string, any>;

type B0CommitEnvelopeV1 = {
  schemaVersion: "b0-commit-envelope-v1";
  batchId: string;
  snapshot: B0SettlementSnapshotV1;
  resolution: B0SettlementResolutionV1;
  manifest: B0BatchCommitManifestV1;
};

export class B0PipelineErrorV1 extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recoverable = true,
  ) {
    super(message);
    this.name = "B0PipelineErrorV1";
  }
}

@Injectable()
export class B0SettlementPipelineService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(B0SettlementCommitService) private readonly commits: B0SettlementCommitService,
    @Inject(B0WindowCoordinatorService) private readonly windows: B0WindowCoordinatorService,
    @Inject(OpenNovelRuntimeClient) private readonly openNovel: OpenNovelRuntimeClient,
  ) {}

  /**
   * Window deadline recovery is intentionally separate from settlement work.
   * It only freezes expired OPEN windows and creates durable outbox commands;
   * model calls and world writes remain outside the freeze transaction.
   */
  async recover(now = new Date()) {
    await this.recoverActiveAiPlans();
    return this.windows.recoverExpired(now);
  }

  async executeSettlementTask(taskId: string, _fence: B0TaskFenceV1) {
    const task = await this.loadTask(taskId, "B0_SETTLEMENT_REQUESTED");
    const workflow = await this.prisma.resolutionWorkflow.findUnique({
      where: { windowId: required(task.windowId, "windowId") },
      select: { rulesOutputJson: true },
    });
    const stored = jsonRecord(workflow?.rulesOutputJson);
    if (stored?.schemaVersion === "b0-commit-envelope-v1") {
      const committed = assertCommitEnvelope(stored);
      return {
        outcome: "ALREADY_COMMITTED",
        batchId: committed.batchId,
        resolutionHash: committed.resolution.resolutionHash,
        commitHash: committed.manifest.commitHash,
      };
    }
    const freeze = assertFreezeEnvelope(stored);
    if (freeze.batch.id !== task.inputRefId) {
      throw hard("BATCH_CONTEXT_MISMATCH", "The settlement task does not reference the frozen batch.");
    }

    const claimed = await this.prisma.actionWindow.updateMany({
      where: {
        id: freeze.window.id,
        status: { in: ["LOCKED", "SETTLING", "FAILED_RETRYABLE"] },
      },
      data: {
        status: "SETTLING",
        projectionVersion: { increment: 1 },
        version: { increment: 1 },
      },
    });
    if (claimed.count !== 1) {
      const current = await this.prisma.actionWindow.findUnique({
        where: { id: freeze.window.id },
        select: { status: true },
      });
      if (current?.status === "COMMITTED" || current?.status === "PUBLISHING" || current?.status === "COMPLETED") {
        return { outcome: "ALREADY_COMMITTED", batchId: freeze.batch.id };
      }
      throw new B0PipelineErrorV1(
        "WINDOW_NOT_SETTLEABLE",
        `Window ${freeze.window.id} is ${current?.status ?? "missing"}.`,
      );
    }

    await this.prisma.resolutionWorkflow.update({
      where: { windowId: freeze.window.id },
      data: { status: "B0_RESOLVING", version: { increment: 1 } },
    });

    const resolution = settleB0BatchV1({
      ruleset: freeze.config.ruleset,
      snapshot: freeze.snapshot,
      batch: freeze.batch,
      intents: freeze.lockedIntents,
    });
    const committed = await this.commits.commit({
      batch: freeze.batch,
      snapshot: freeze.snapshot,
      resolution,
      committedAt: new Date().toISOString(),
    });
    return {
      outcome: committed.status,
      batchId: freeze.batch.id,
      resolutionHash: resolution.resolutionHash,
      commitHash: committed.manifest.commitHash,
      committedWorldSequence: committed.manifest.committedWorldSequence,
    };
  }

  async executePublicationTask(taskId: string, _fence: B0TaskFenceV1) {
    const task = await this.loadTask(taskId, "B0_PUBLISH_STRUCTURED_RESULTS");
    const envelope = await this.readCommitEnvelope(required(task.windowId, "windowId"));
    if (task.inputRefId !== envelope.batchId) {
      throw hard("BATCH_CONTEXT_MISMATCH", "The publication task references another batch.");
    }
    const plan = await this.publicationPlan(envelope);

    await this.prisma.actionWindow.updateMany({
      where: { id: envelope.manifest.windowId, status: { in: ["COMMITTED", "PUBLISHING"] } },
      data: { status: "PUBLISHING", projectionVersion: { increment: 1 }, version: { increment: 1 } },
    });

    for (const delivery of plan.deliveries) {
      await this.persistStructuredDelivery(delivery);
    }
    await this.enqueueNarratives(envelope, plan);

    await this.prisma.$transaction(async (tx) => {
      await tx.actionWindow.updateMany({
        where: { id: envelope.manifest.windowId, status: { in: ["COMMITTED", "PUBLISHING", "COMPLETED"] } },
        data: {
          status: "COMPLETED",
          resolvedAt: new Date(envelope.manifest.committedAt),
          projectionVersion: { increment: 1 },
          version: { increment: 1 },
        },
      });
      await tx.actionWindowParticipant.updateMany({
        where: { windowId: envelope.manifest.windowId },
        data: { mainStatus: "B0_COMPLETED", version: { increment: 1 } },
      });
      const window = await tx.actionWindow.findUnique({
        where: { id: envelope.manifest.windowId },
        select: { nodeId: true },
      });
      if (window) {
        await tx.sceneNode.updateMany({
          where: { id: window.nodeId, status: { not: "resolved" } },
          data: { status: "resolved", resolvedAt: new Date(envelope.manifest.committedAt) },
        });
      }
    });

    const next = await this.ensureRunWindow(envelope.manifest.runId);
    return {
      outcome: "PUBLISHED",
      batchId: envelope.batchId,
      publicationPlanHash: plan.planHash,
      deliveryCount: plan.deliveries.length,
      nextWindowId: next?.id ?? null,
    };
  }

  async executeNarrativeTask(taskId: string, _fence: B0TaskFenceV1) {
    const task = await this.loadTask(taskId, "B0_NARRATIVE_GENERATION");
    const roleId = required(task.roleId, "roleId");
    const windowId = required(task.windowId, "windowId");
    const existing = await this.prisma.narrativeEntry.findUnique({
      where: { dedupeKey: narrativeKey(required(task.inputRefId, "batchId"), roleId) },
    });
    if (existing) return { outcome: "ALREADY_PUBLISHED", narrativeEntryId: existing.id };

    const envelope = await this.readCommitEnvelope(windowId);
    const plan = await this.publicationPlan(envelope);
    if (!plan.deliveries.some((delivery) => delivery.recipientActorId === roleId)) {
      throw hard("NARRATIVE_RECIPIENT_HAS_NO_DELIVERIES", "The narrative recipient has no structured delivery.");
    }
    const [run, roles] = await Promise.all([
      this.prisma.storyRun.findUnique({
        where: { id: envelope.manifest.runId },
        select: { worldSequence: true, stateJson: true },
      }),
      this.prisma.storyRole.findMany({
        where: { runId: envelope.manifest.runId },
        select: { id: true, roleKey: true, roleName: true },
        orderBy: { id: "asc" },
      }),
    ]);
    if (!run) throw hard("ROOM_NOT_FOUND", "The narrative run no longer exists.");
    const actorLabels = Object.fromEntries(roles.map((role) => [role.id, [role.roleName, role.roleKey]]));
    const locale = b0Locale(run.stateJson);
    const response = await this.openNovel.generateB0Narrative({
      manifest: envelope.manifest,
      publicationPlan: plan,
      recipientActorId: roleId,
      appliedWorldSequence: run.worldSequence,
      guidance: {
        schemaVersion: "b0-narrative-guidance-v1",
        version: 1,
        locale,
        narrativeKind: "SETTLEMENT_ROLE_VIEW",
        styleDirectives: [
          "Write a concise role-scoped account of the committed settlement.",
          "Preserve the supplied outcome and changes exactly.",
          "Do not infer hidden actors or undisclosed causes.",
        ],
        allowedActorLabels: roles.flatMap((role) => [role.roleName, role.roleKey]),
        forbiddenPhrases: [],
      },
      actorLabels,
    });
    const publication = jsonRecord(response?.publication ?? response);
    const prose = String(publication?.prose ?? "").trim();
    if (!prose) throw new B0PipelineErrorV1("NARRATIVE_RUNTIME_EMPTY", "The narrative runtime returned no prose.");

    const entry = await this.prisma.narrativeEntry.upsert({
      where: { dedupeKey: narrativeKey(envelope.batchId, roleId) },
      update: {},
      create: {
        runId: envelope.manifest.runId,
        nodeId: task.nodeId,
        roleId,
        entryType: "B0_NARRATIVE",
        visibility: "private",
        content: prose,
        factKeysJson: [] as Prisma.InputJsonValue,
        threadKeysJson: [] as Prisma.InputJsonValue,
        sourceEventIdsJson: [] as Prisma.InputJsonValue,
        worldSequence: envelope.manifest.committedWorldSequence,
        dedupeKey: narrativeKey(envelope.batchId, roleId),
      },
    });
    return { outcome: "PUBLISHED", narrativeEntryId: entry.id };
  }

  async executeWindowEventTask(taskId: string, _fence: B0TaskFenceV1) {
    const task = await this.loadTask(taskId, "B0_WINDOW_EVENT");
    const payload = jsonRecord(task.resultJson) ?? {};
    const eventType = String(payload.type ?? task.checkpointKey ?? "B0_WINDOW_EVENT");
    await this.prisma.storyEvent.upsert({
      where: { dedupeKey: task.dedupeKey },
      update: {},
      create: {
        id: stableId("b0.window.event", task.dedupeKey),
        runId: task.runId,
        day: 0,
        type: eventType,
        messageType: "system",
        visibility: "internal",
        payloadJson: safeJson(payload),
        dedupeKey: task.dedupeKey,
        audienceType: "SYSTEM",
        audienceRoleIdsJson: [] as Prisma.InputJsonValue,
      },
    });
    return { outcome: "RECORDED", eventType };
  }

  async failTask(taskId: string, reason: string) {
    const task = await this.prisma.storyTaskOutbox.findUnique({
      where: { id: taskId },
      select: { windowId: true, taskType: true },
    });
    if (!task?.windowId || !task.taskType.startsWith("B0_")) return;
    const status = task.taskType === "B0_NARRATIVE_GENERATION" ? "COMPLETED" : "FAILED_RETRYABLE";
    await this.prisma.actionWindow.updateMany({
      where: { id: task.windowId, status: { notIn: ["COMPLETED", "FAILED_HARD", "ABORTED"] } },
      data: {
        status,
        projectionVersion: { increment: 1 },
        version: { increment: 1 },
      },
    });
    await this.prisma.storyEvent.upsert({
      where: { dedupeKey: `b0-task-failed:${taskId}` },
      update: {},
      create: {
        id: stableId("b0.failure", taskId),
        runId: await this.runIdForTask(taskId),
        day: 0,
        type: "B0_TASK_FAILED",
        messageType: "system",
        visibility: "internal",
        payloadJson: { taskId, taskType: task.taskType, reason } as Prisma.InputJsonValue,
        dedupeKey: `b0-task-failed:${taskId}`,
        audienceType: "SYSTEM",
        audienceRoleIdsJson: [] as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Lazily opens the first B0 window for an opted-in run and opens subsequent
   * windows after structured publication. This is safe under concurrent calls:
   * B0WindowCoordinatorService owns the active-window invariant and rejects a
   * second creator before any authoritative settlement state is written.
   */
  async ensureRunWindow(runId: string): Promise<B0SettlementWindowV1 | null> {
    const run = await this.prisma.storyRun.findUnique({
      where: { id: runId },
      include: {
        roles: { orderBy: { id: "asc" } },
        players: {
          where: { playerType: "human", status: "active" },
          orderBy: { joinedAt: "asc" },
        },
        nodes: { orderBy: { nodeIndex: "desc" }, take: 1 },
      },
    });
    if (!run) throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    if (!b0RunEnabled(run.strategyVersion, run.stateJson)) return null;
    if (run.status === "completed" || run.status === "aborted") return null;

    const storedWindows = await this.prisma.actionWindow.findMany({
      where: { runId },
      include: { node: true },
      orderBy: { createdAt: "asc" },
    });
    const b0Windows = storedWindows.filter((window) => jsonRecord(window.configJson)?.schemaVersion === "b0-window-config-v1");
    const active = [...b0Windows].reverse().find((window) =>
      ACTIVE_B0_WINDOW_STATUSES.includes(window.status as typeof ACTIVE_B0_WINDOW_STATUSES[number]));
    if (active) return mapStoredWindow(active);
    if (b0RunPaused(run.stateJson)) return null;

    const priorConfig = b0Windows.length
      ? assertB0WindowConfigV1(b0Windows[b0Windows.length - 1].configJson)
      : null;
    const ruleset = priorConfig?.ruleset ?? defaultRuleset(run.roles.length);
    if (b0Windows.length >= ruleset.totalWindows) {
      await this.finalizeRun(runId, ruleset.totalWindows);
      return null;
    }
    if (process.env.B0_NEW_WINDOWS_ENABLED === "false") {
      throw new ConflictException({
        code: "B0_NEW_WINDOWS_DISABLED",
        message: "Opening new synchronized settlement windows is temporarily disabled.",
      });
    }

    const expectedActorIds = run.roles.map((role) => role.id).sort();
    if (!expectedActorIds.length) throw hard("ACTOR_NOT_EXPECTED", "A B0 run requires at least one role.");

    // Prisma may emulate an empty-update upsert as SELECT + INSERT, which can
    // still surface P2002 under simultaneous /game projections. PostgreSQL's
    // INSERT .. ON CONFLICT DO NOTHING is the authoritative lazy initializer.
    // Bind control from the durable active StoryPlayer roster, not the role's
    // presentation flag: legacy rooms do not create RoleControl rows and may
    // leave every StoryRole.isAiControlled=false before B0 is enabled.
    const bindingTime = new Date();
    const humanPlayerByRoleId = new Map(
      run.players
        .filter((player) => Boolean(player.userId && player.roleId))
        .map((player) => [player.roleId!, player] as const),
    );
    await this.prisma.roleControl.createMany({
      data: run.roles.map((role) => {
        const humanPlayer = humanPlayerByRoleId.get(role.id) ?? null;
        return {
          runId,
          roleId: role.id,
          humanPlayerId: humanPlayer?.id ?? null,
          mode: humanPlayer ? "HUMAN_ACTIVE" : "AI_ACTIVE",
          epoch: 1,
          lastHeartbeatAt: humanPlayer ? bindingTime : null,
          takeoverAt: humanPlayer ? null : bindingTime,
          reason: "B0_INITIAL_ROLE_BINDING",
          policyVersion: "b0-role-control-v1",
        };
      }),
      skipDuplicates: true,
    });

    const ordinal = b0Windows.length + 1;
    const node = await this.nodeForWindow({
      runId,
      currentNodeId: run.currentNodeId,
      currentChapter: run.currentChapter,
      ordinal,
      latestNodeIndex: run.nodes[0]?.nodeIndex ?? 0,
      allowCurrentNode: b0Windows.length === 0,
    });
    let created: B0SettlementWindowV1;
    try {
      created = await this.windows.createWindow({
        runId,
        nodeId: node.id,
        situationId: node.title,
        ruleset,
        expectedActorIds,
        openedAt: new Date().toISOString(),
        locksAt: new Date(Date.now() + ruleset.windowDurationSeconds * 1_000).toISOString(),
      });
    } catch (error) {
      if (b0ExceptionCode(error) !== "WINDOW_ALREADY_ACTIVE") throw error;
      const concurrent = await this.prisma.actionWindow.findMany({
        where: { runId, status: { in: [...ACTIVE_B0_WINDOW_STATUSES] } },
        include: { node: true },
        orderBy: { createdAt: "desc" },
        take: 4,
      });
      const found = concurrent.find((window) => jsonRecord(window.configJson)?.schemaVersion === "b0-window-config-v1");
      if (!found) throw error;
      return mapStoredWindow(found);
    }
    await this.prisma.storyRun.update({
      where: { id: runId },
      data: { currentNodeId: node.id, currentDay: ordinal, version: { increment: 1 } },
    });
    await this.prepareAiPlans(created);
    return created;
  }

  async diagnostics(runId: string) {
    const [run, windows, tasks, narratives] = await Promise.all([
      this.prisma.storyRun.findUnique({
        where: { id: runId },
        select: { id: true, status: true, worldSequence: true, strategyVersion: true, stateJson: true },
      }),
      this.prisma.actionWindow.findMany({
        where: { runId },
        include: { participants: true, resolutionWorkflow: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.storyTaskOutbox.findMany({
        where: { runId, taskType: { startsWith: "B0_" } },
        select: {
          id: true,
          windowId: true,
          roleId: true,
          taskType: true,
          status: true,
          attempt: true,
          maxAttempts: true,
          lastError: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.narrativeEntry.count({ where: { runId, entryType: { in: ["B0_NARRATIVE", "B0_ENDING"] } } }),
    ]);
    if (!run) throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    const b0Windows = windows.filter((window) => jsonRecord(window.configJson)?.schemaVersion === "b0-window-config-v1");
    return {
      schemaVersion: "b0-diagnostics-v1",
      run,
      metrics: {
        windowCount: b0Windows.length,
        completedWindowCount: b0Windows.filter((window) => window.status === "COMPLETED").length,
        pendingTaskCount: tasks.filter((task) => ["pending", "PENDING", "running", "RUNNING"].includes(task.status)).length,
        failedTaskCount: tasks.filter((task) => ["failed", "FAILED", "dead_letter"].includes(task.status)).length,
        narrativeCount: narratives,
      },
      windows: b0Windows.map((window) => ({
        id: window.id,
        status: window.status,
        version: window.version,
        projectionVersion: window.projectionVersion,
        readyCount: window.participants.filter((participant) => ["B0_READY", "B0_LOCKED", "B0_COMMITTED", "B0_COMPLETED"].includes(participant.mainStatus)).length,
        expectedCount: window.participants.length,
        workflowStatus: window.resolutionWorkflow?.status ?? null,
        createdAt: window.createdAt,
        updatedAt: window.updatedAt,
      })),
      tasks,
    };
  }

  async replayWindow(windowId: string) {
    const workflow = await this.prisma.resolutionWorkflow.findUnique({
      where: { windowId },
      select: { rulesOutputJson: true },
    });
    const value = jsonRecord(workflow?.rulesOutputJson);
    if (!value) throw new NotFoundException({ code: "B0_WORKFLOW_NOT_FOUND", message: "B0 workflow not found" });
    if (value.schemaVersion === "b0-commit-envelope-v1") {
      const committed = assertCommitEnvelope(value);
      const intents = await this.readLockedIntents(committed.resolution);
      const replayed = settleB0BatchV1({
        ruleset: await this.rulesetForWindow(windowId),
        snapshot: committed.snapshot,
        batch: {
          schemaVersion: "b0-settlement-batch-v1",
          id: committed.batchId,
          windowId: committed.manifest.windowId,
          snapshotId: committed.manifest.snapshotId,
          roomId: committed.manifest.roomId,
          runId: committed.manifest.runId,
          baseWorldSequence: committed.manifest.baseWorldSequence,
          lockedIntentIds: intents.map((intent) => intent.id).sort(),
          dueSystemIntentIds: [],
          status: "PREPARED",
          attempt: 0,
          inputHash: committed.manifest.inputHash,
          relationGraphHash: null,
          resolutionHash: null,
          createdAt: committed.manifest.committedAt,
          resolvedAt: null,
          committedAt: null,
          completedAt: null,
        },
        intents,
      });
      return {
        schemaVersion: "b0-replay-result-v1",
        windowId,
        storedResolutionHash: committed.resolution.resolutionHash,
        replayedResolutionHash: replayed.resolutionHash,
        matches: replayed.resolutionHash === committed.resolution.resolutionHash,
      };
    }
    const freeze = assertFreezeEnvelope(value);
    const replayed = settleB0BatchV1({
      ruleset: freeze.config.ruleset,
      snapshot: freeze.snapshot,
      batch: freeze.batch,
      intents: freeze.lockedIntents,
    });
    return {
      schemaVersion: "b0-replay-result-v1",
      windowId,
      storedResolutionHash: null,
      replayedResolutionHash: replayed.resolutionHash,
      matches: null,
    };
  }

  async retryTask(taskId: string) {
    const task = await this.prisma.storyTaskOutbox.findUnique({ where: { id: taskId } });
    if (!task || !task.taskType.startsWith("B0_")) {
      throw new NotFoundException({ code: "B0_TASK_NOT_FOUND", message: "B0 task not found" });
    }
    if (!["failed", "FAILED", "dead_letter"].includes(task.status)) {
      throw new ConflictException({ code: "B0_TASK_NOT_RETRYABLE", message: "Only failed B0 tasks may be retried." });
    }
    return this.prisma.storyTaskOutbox.update({
      where: { id: task.id },
      data: {
        status: "pending",
        outcome: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextRetryAt: new Date(),
        lastError: null,
      },
    });
  }

  async pauseRun(runId: string, paused: boolean) {
    const run = await this.prisma.storyRun.findUnique({ where: { id: runId }, select: { stateJson: true } });
    if (!run) throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    const state = jsonRecord(run.stateJson) ?? {};
    const b0 = { ...(jsonRecord(state.b0) ?? {}), paused };
    await this.prisma.storyRun.update({
      where: { id: runId },
      data: { stateJson: { ...state, b0 } as Prisma.InputJsonValue, version: { increment: 1 } },
    });
    return { runId, paused };
  }

  async abortWindow(windowId: string) {
    const updated = await this.prisma.actionWindow.updateMany({
      where: { id: windowId, status: { in: ["OPEN", "LOCKED", "FAILED_RETRYABLE"] } },
      data: { status: "ABORTED", projectionVersion: { increment: 1 }, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: "B0_WINDOW_NOT_ABORTABLE",
        message: "Only an uncommitted B0 window may be safely aborted.",
      });
    }
    return { windowId, status: "ABORTED" };
  }

  private async loadTask(taskId: string, taskType: string) {
    const task = await this.prisma.storyTaskOutbox.findUnique({ where: { id: taskId } });
    if (!task || task.taskType !== taskType) {
      throw hard("B0_TASK_CONTEXT_MISMATCH", `Expected ${taskType} task ${taskId}.`);
    }
    return task;
  }

  private async readCommitEnvelope(windowId: string): Promise<B0CommitEnvelopeV1> {
    const workflow = await this.prisma.resolutionWorkflow.findUnique({
      where: { windowId },
      select: { rulesOutputJson: true },
    });
    return assertCommitEnvelope(jsonRecord(workflow?.rulesOutputJson));
  }

  private async publicationPlan(envelope: B0CommitEnvelopeV1): Promise<B0PublicationPlanV1> {
    const intents = await this.readLockedIntents(envelope.resolution);
    return buildB0PublicationPlanV1({
      snapshot: envelope.snapshot,
      resolution: envelope.resolution,
      intents,
    });
  }

  private async readLockedIntents(resolution: B0SettlementResolutionV1): Promise<B0ActionContractV1[]> {
    const intentIds = [...new Set(resolution.intentOutcomes.map((outcome) => outcome.intentId))].sort();
    const rows = await this.prisma.playerAction.findMany({
      where: { runId: resolution.runId, id: { in: intentIds } },
      select: { id: true, normalizedJson: true },
      orderBy: { id: "asc" },
    });
    const intents = rows.map((row) => {
      const envelope = row.normalizedJson ? assertB0StoredIntentEnvelopeV1(row.normalizedJson) : null;
      if (!envelope?.lockedIntent || envelope.lockedIntent.id !== row.id) {
        throw hard("STRUCTURED_RESULT_SOURCE_MISSING", `Committed intent ${row.id} is unavailable.`);
      }
      return envelope.lockedIntent;
    });
    if (intents.length !== intentIds.length) {
      throw hard("STRUCTURED_RESULT_SOURCE_MISSING", "The committed intent set is incomplete.");
    }
    return intents;
  }

  private async persistStructuredDelivery(delivery: B0PublicationDeliveryV1) {
    const role = await this.prisma.storyRole.findUnique({
      where: { id: delivery.recipientActorId },
      select: { id: true, runId: true, roleKey: true },
    });
    if (!role || role.runId !== delivery.runId) {
      throw hard("AUDIENCE_RUN_SCOPE_VIOLATION", `Recipient ${delivery.recipientActorId} is outside the run.`);
    }
    const run = await this.prisma.storyRun.findUnique({
      where: { id: delivery.runId },
      select: { currentDay: true },
    });
    if (!run) throw hard("ROOM_NOT_FOUND", "The publication run no longer exists.");
    const payload = safeDelivery(delivery);
    const event = await this.prisma.storyEvent.upsert({
      where: { dedupeKey: delivery.idempotencyKey },
      update: {},
      create: {
        id: stableId("b0.delivery.event", delivery.idempotencyKey),
        runId: delivery.runId,
        day: run.currentDay,
        type: `B0_${delivery.resultKind}`,
        messageType: delivery.resultKind === "CROSS_PLAYER_IMPACT" ? "impact" : "system",
        roleKey: role.roleKey,
        visibility: delivery.visibility.toLowerCase(),
        payloadJson: payload,
        dedupeKey: delivery.idempotencyKey,
        audienceType: "ROLE",
        audienceRoleIdsJson: [delivery.recipientActorId] as Prisma.InputJsonValue,
      },
    });
    const players = await this.prisma.storyPlayer.findMany({
      where: {
        runId: delivery.runId,
        roleId: delivery.recipientActorId,
        userId: { not: null },
        status: "active",
      },
      select: { userId: true },
    });
    for (const player of players) {
      if (!player.userId) continue;
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.eventDelivery.findUnique({
          where: { eventId_userId: { eventId: event.id, userId: player.userId! } },
        });
        if (existing) return;
        const cursor = await tx.eventDeliveryCursor.findUnique({
          where: { roomId_userId: { roomId: delivery.runId, userId: player.userId! } },
        });
        let deliverySequence = 1;
        if (cursor) {
          const advanced = await tx.eventDeliveryCursor.update({
            where: { roomId_userId: { roomId: delivery.runId, userId: player.userId! } },
            data: { nextSequence: { increment: 1 }, version: { increment: 1 } },
            select: { nextSequence: true },
          });
          deliverySequence = advanced.nextSequence - 1;
        } else {
          await tx.eventDeliveryCursor.create({
            data: { roomId: delivery.runId, userId: player.userId!, nextSequence: 2 },
          });
        }
        await tx.eventDelivery.create({
          data: {
            eventId: event.id,
            roomId: delivery.runId,
            userId: player.userId!,
            roleId: delivery.recipientActorId,
            deliverySequence,
            payloadJson: payload,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
  }

  private async enqueueNarratives(envelope: B0CommitEnvelopeV1, plan: B0PublicationPlanV1) {
    if (process.env.B0_NARRATIVE_ENABLED === "false") return;
    const roleIds = [...new Set(plan.deliveries.map((delivery) => delivery.recipientActorId))].sort();
    const window = await this.prisma.actionWindow.findUnique({
      where: { id: envelope.manifest.windowId },
      select: { nodeId: true },
    });
    if (!window) throw hard("WINDOW_NOT_FOUND", "The committed window no longer exists.");
    for (const roleId of roleIds) {
      await this.prisma.storyTaskOutbox.upsert({
        where: { dedupeKey: narrativeKey(envelope.batchId, roleId) },
        update: {},
        create: {
          runId: envelope.manifest.runId,
          nodeId: window.nodeId,
          windowId: envelope.manifest.windowId,
          roleId,
          dedupeKey: narrativeKey(envelope.batchId, roleId),
          taskType: "B0_NARRATIVE_GENERATION",
          status: "pending",
          inputRefId: envelope.batchId,
          checkpointKey: "B0_STRUCTURED_RESULTS_PUBLISHED",
          resultJson: {
            schemaVersion: "b0-narrative-request-v1",
            batchId: envelope.batchId,
            roleId,
            commitHash: envelope.manifest.commitHash,
            publicationPlanHash: plan.planHash,
          } as Prisma.InputJsonValue,
        },
      });
    }
  }

  private async recoverActiveAiPlans() {
    const storedWindows = await this.prisma.actionWindow.findMany({
      where: { status: "OPEN" },
      include: { node: true, participants: true },
      orderBy: { createdAt: "asc" },
    });
    for (const stored of storedWindows) {
      if (stored.status !== "OPEN" || jsonRecord(stored.configJson)?.schemaVersion !== "b0-window-config-v1") continue;
      await this.prepareAiPlans(mapStoredWindow(stored));
    }
  }

  private async prepareAiPlans(window: B0SettlementWindowV1) {
    const storedWindow = await this.prisma.actionWindow.findUnique({
      where: { id: window.id },
      select: { nodeId: true, status: true },
    });
    if (!storedWindow) throw hard("WINDOW_NOT_FOUND", "The synchronized window no longer exists.");
    if (storedWindow.status !== "OPEN") return;

    const controls = await this.prisma.roleControl.findMany({
      where: { runId: window.runId, roleId: { in: window.expectedActorIds }, mode: "AI_ACTIVE" },
      select: { roleId: true, epoch: true },
      orderBy: { roleId: "asc" },
    });
    for (const control of controls) {
      try {
        const participant = await this.prisma.actionWindowParticipant.findUnique({
          where: { windowId_roleId: { windowId: window.id, roleId: control.roleId } },
          select: { mainStatus: true, version: true },
        });
        if (!participant) throw hard("ACTOR_NOT_EXPECTED", "AI role has no window participant.");
        if (participant.mainStatus !== "B0_PENDING") continue;

        const row = await this.prisma.playerAction.findUnique({
          where: { nodeId_roleId_actionSlot: { nodeId: storedWindow.nodeId, roleId: control.roleId, actionSlot: "B0_PRIMARY" } },
          select: { normalizedJson: true },
        });
        const current = row?.normalizedJson ? assertB0StoredIntentEnvelopeV1(row.normalizedJson) : null;
        if (!current?.lastConfirmed) {
          const now = new Date().toISOString();
          const candidate = aiIntent(window, control.roleId, now);
          await this.windows.saveDraft({
            windowId: window.id,
            actorId: control.roleId,
            controlEpoch: control.epoch,
            expectedRevision: current?.latestRevision ?? 0,
            candidate,
            now,
          });
          const confirmedRevision = current?.latestDraft?.clientRequestId === candidate.clientRequestId
            ? current.latestRevision
            : (current?.latestRevision ?? 0) + 1;
          await this.windows.confirmDraft({
            windowId: window.id,
            actorId: control.roleId,
            controlEpoch: control.epoch,
            expectedRevision: confirmedRevision,
            now,
          });
        }

        const refreshed = await this.prisma.actionWindowParticipant.findUnique({
          where: { windowId_roleId: { windowId: window.id, roleId: control.roleId } },
          select: { mainStatus: true, version: true },
        });
        if (!refreshed) throw hard("ACTOR_NOT_EXPECTED", "AI role has no window participant.");
        if (refreshed.mainStatus !== "B0_PENDING") continue;
        await this.windows.ready({
          windowId: window.id,
          actorId: control.roleId,
          controlEpoch: control.epoch,
          expectedParticipantVersion: refreshed.version,
          now: new Date().toISOString(),
        });
      } catch (error) {
        const code = b0ExceptionCode(error);
        if (code === "WINDOW_NOT_OPEN" || code === "WINDOW_ALREADY_LOCKED") return;
        if (code === "INTENT_STALE_REVISION") continue;
        throw error;
      }
    }
  }

  private async nodeForWindow(input: {
    runId: string;
    currentNodeId: string | null;
    currentChapter: number;
    ordinal: number;
    latestNodeIndex: number;
    allowCurrentNode: boolean;
  }) {
    if (input.allowCurrentNode && input.currentNodeId) {
      const current = await this.prisma.sceneNode.findUnique({
        where: { id: input.currentNodeId },
        include: { actionWindow: true },
      });
      if (current && !current.actionWindow) return current;
    }
    const chapterIndex = Math.max(1, input.currentChapter);
    const nodeIndex = Math.max(1, input.latestNodeIndex + 1);
    const uniqueNode = { runId: input.runId, chapterIndex, nodeIndex };
    await this.prisma.sceneNode.createMany({
      data: [{
        ...uniqueNode,
        title: `Shared situation ${input.ordinal}`,
        publicNarration: "A new shared situation opens. Every role may negotiate, investigate, and commit one primary plan before the deadline.",
        nodeGoal: "Commit one bounded primary plan to the synchronized settlement.",
        actionOptionsJson: [] as Prisma.InputJsonValue,
        status: "open_for_actions",
      }],
      skipDuplicates: true,
    });
    const node = await this.prisma.sceneNode.findUnique({
      where: { runId_chapterIndex_nodeIndex: uniqueNode },
    });
    if (!node) throw hard("B0_NODE_INITIALIZATION_FAILED", "The synchronized window node could not be initialized.");
    return node;
  }

  private async finalizeRun(runId: string, totalWindows: number) {
    const run = await this.prisma.storyRun.findUnique({
      where: { id: runId },
      include: { roles: { orderBy: { id: "asc" } } },
    });
    if (!run || run.status === "completed") return;
    const latestWindow = await this.prisma.actionWindow.findFirst({
      where: { runId, status: "COMPLETED" },
      include: { resolutionWorkflow: true },
      orderBy: { createdAt: "desc" },
    });
    const value = jsonRecord(latestWindow?.resolutionWorkflow?.rulesOutputJson);
    const envelope = value?.schemaVersion === "b0-commit-envelope-v1" ? assertCommitEnvelope(value) : null;
    const plan = envelope ? await this.publicationPlan(envelope) : null;
    for (const role of run.roles) {
      const summaries = plan?.deliveries
        .filter((delivery) => delivery.recipientActorId === role.id)
        .map((delivery) => delivery.summary) ?? [];
      const content = [
        `The shared world closes after ${totalWindows} synchronized situations.`,
        ...summaries,
      ].join(" ").trim();
      await this.prisma.narrativeEntry.upsert({
        where: { dedupeKey: `b0-ending:${runId}:${role.id}` },
        update: {},
        create: {
          runId,
          nodeId: latestWindow?.nodeId ?? run.currentNodeId,
          roleId: role.id,
          entryType: "B0_ENDING",
          visibility: "private",
          content,
          factKeysJson: [] as Prisma.InputJsonValue,
          threadKeysJson: [] as Prisma.InputJsonValue,
          sourceEventIdsJson: [] as Prisma.InputJsonValue,
          worldSequence: run.worldSequence,
          dedupeKey: `b0-ending:${runId}:${role.id}`,
        },
      });
    }
    const state = jsonRecord(run.stateJson) ?? {};
    await this.prisma.storyRun.update({
      where: { id: runId },
      data: {
        status: "completed",
        currentDay: totalWindows,
        summary: `Completed ${totalWindows} synchronized settlement windows.`,
        stateJson: {
          ...state,
          b0: {
            ...(jsonRecord(state.b0) ?? {}),
            enabled: true,
            status: "COMPLETED",
            totalWindows,
            completedAt: new Date().toISOString(),
          },
        } as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
  }

  private async rulesetForWindow(windowId: string): Promise<B0RoomRulesetV1> {
    const window = await this.prisma.actionWindow.findUnique({
      where: { id: windowId },
      select: { configJson: true },
    });
    if (!window) throw new NotFoundException({ code: "WINDOW_NOT_FOUND", message: "Window not found" });
    return assertB0WindowConfigV1(window.configJson).ruleset;
  }

  private async runIdForTask(taskId: string) {
    const task = await this.prisma.storyTaskOutbox.findUnique({ where: { id: taskId }, select: { runId: true } });
    if (!task) throw hard("B0_TASK_NOT_FOUND", "B0 task not found.");
    return task.runId;
  }
}

function assertFreezeEnvelope(value: JsonRecord | null): B0FreezeEnvelopeV1 {
  if (!value || value.schemaVersion !== "b0-freeze-envelope-v1") {
    throw hard("B0_FREEZE_ENVELOPE_MISSING", "The settlement task has no immutable freeze envelope.");
  }
  if (!jsonRecord(value.window) || !jsonRecord(value.config) || !jsonRecord(value.snapshot)
    || !jsonRecord(value.batch) || !Array.isArray(value.lockedIntents)) {
    throw hard("B0_FREEZE_ENVELOPE_INVALID", "The settlement freeze envelope is incomplete.");
  }
  const config = assertB0WindowConfigV1(value.config);
  const freeze = value as unknown as B0FreezeEnvelopeV1;
  if (freeze.window.runId !== freeze.snapshot.runId
    || freeze.window.id !== freeze.snapshot.windowId
    || freeze.batch.snapshotId !== freeze.snapshot.id
    || freeze.batch.windowId !== freeze.window.id
    || freeze.config.rulesetHash !== config.rulesetHash) {
    throw hard("BATCH_CONTEXT_MISMATCH", "The frozen window, snapshot and batch do not share one context.");
  }
  return freeze;
}

function assertCommitEnvelope(value: JsonRecord | null): B0CommitEnvelopeV1 {
  if (!value || value.schemaVersion !== "b0-commit-envelope-v1") {
    throw hard("B0_COMMIT_ENVELOPE_MISSING", "The authoritative commit envelope is unavailable.");
  }
  const manifest = assertStoredManifestV1(value.manifest);
  const envelope = value as unknown as B0CommitEnvelopeV1;
  if (envelope.batchId !== manifest.batchId
    || envelope.snapshot.id !== manifest.snapshotId
    || envelope.resolution.resolutionHash !== manifest.resolutionHash) {
    throw hard("COMMIT_MANIFEST_INVALID", "The commit envelope does not match its manifest.");
  }
  return envelope;
}

function defaultRuleset(actorCount: number): B0RoomRulesetV1 {
  return createB0RoomRulesetV1({
    rulesetVersion: "b0-rules-v1",
    settlementMode: "WINDOWED",
    totalWindows: boundedInteger(process.env.B0_TOTAL_WINDOWS, 6, 1, 20),
    windowDurationSeconds: boundedInteger(process.env.B0_WINDOW_DURATION_SECONDS, 300, 5, 86_400),
    maxHumanPlayers: Math.max(1, actorCount),
  });
}

export function b0ExceptionCode(error: unknown): string {
  const candidate = error as any;
  const direct = String(candidate?.code ?? "").trim();
  if (direct) return direct;
  if (typeof candidate?.getResponse !== "function") return "";
  try {
    const response = candidate.getResponse();
    if (!response || typeof response !== "object" || Array.isArray(response)) return "";
    return String((response as Record<string, unknown>).code ?? "").trim();
  } catch {
    return "";
  }
}

export function b0RunEnabled(strategyVersion: string, stateValue: unknown): boolean {
  if (process.env.B0_ENABLED === "false") return false;
  if (B0_STRATEGY_VERSIONS.has(strategyVersion)) return true;
  const state = jsonRecord(stateValue);
  const b0 = jsonRecord(state?.b0);
  return b0?.enabled === true;
}

export function b0RunPaused(stateValue: unknown): boolean {
  const state = jsonRecord(stateValue);
  const b0 = jsonRecord(state?.b0);
  return b0?.paused === true;
}

function aiIntent(window: B0SettlementWindowV1, actorId: string, now: string): B0ActionContractV1 {
  return {
    schemaVersion: "b0-action-contract-v1",
    id: stableId("b0.ai.intent", window.id, actorId),
    windowId: window.id,
    roomId: window.roomId,
    runId: window.runId,
    actorId,
    baseWorldSequence: window.baseWorldSequence,
    revision: 1,
    kind: "ACT",
    rawPlayerText: "Protect the role's present position while the shared situation develops.",
    normalizedSummary: "Protect the current position without claiming control over another role.",
    targetRefs: [{ type: "ACTOR", id: actorId }],
    primaryEffect: {
      effectTypeId: "position.protect",
      direction: "PROTECT",
      requestedMagnitude: "MINOR",
    },
    method: {
      methodTypeId: "ai.conservative.plan",
      description: "Use a bounded, conservative plan that stays inside the role's authority.",
    },
    resourceCommitments: [],
    evidenceRefs: [],
    capabilityRefs: [],
    propositionRefs: [],
    visibilityIntent: { type: "PRIVATE", declaredRecipientRefs: [actorId] },
    reactionPolicy: "IF_OBSERVED",
    requestedTiming: "CURRENT_WINDOW",
    riskTags: ["conservative"],
    compilerVersion: "b0-ai-fallback-v1",
    validationVersion: "b0-action-contract-v1",
    clientRequestId: `ai-plan:${window.id}:${actorId}`,
    status: "DRAFT",
    createdAt: now,
    updatedAt: now,
    confirmedAt: null,
    lockedAt: null,
  };
}

function mapStoredWindow(window: any): B0SettlementWindowV1 {
  const config = assertB0WindowConfigV1(window.configJson);
  const participants = Array.isArray(window.participants) ? window.participants : [];
  return {
    schemaVersion: "b0-settlement-window-v1",
    id: window.id,
    roomId: window.runId,
    runId: window.runId,
    mode: config.ruleset.settlementMode,
    ordinal: Number(window.node?.nodeIndex ?? 1),
    situationId: config.situationId,
    baseWorldSequence: Number(window.openingSnapshotVersion ?? 0),
    expectedActorIds: [...config.expectedActorIds],
    readyActorIds: participants
      .filter((participant: any) => ["B0_READY", "B0_LOCKED", "B0_COMMITTED", "B0_COMPLETED"].includes(participant.mainStatus))
      .map((participant: any) => String(participant.roleId))
      .sort(),
    openedAt: (window.mainOpenedAt ?? window.createdAt).toISOString(),
    locksAt: window.mainClosesAt?.toISOString() ?? null,
    lockedAt: window.graceOpenedAt?.toISOString() ?? null,
    committedAt: ["COMMITTED", "PUBLISHING", "COMPLETED"].includes(window.status) && window.resolvedAt
      ? window.resolvedAt.toISOString()
      : null,
    completedAt: window.status === "COMPLETED" && window.resolvedAt ? window.resolvedAt.toISOString() : null,
    status: window.status,
    lockReason: window.closingReason ?? null,
    rulesetVersion: config.ruleset.rulesetVersion,
    schemaRevision: 1,
  };
}

function safeDelivery(delivery: B0PublicationDeliveryV1): Prisma.InputJsonValue {
  return {
    schemaVersion: "b0-player-structured-result-v1",
    resultId: delivery.resultId,
    resultKind: delivery.resultKind,
    visibility: delivery.visibility,
    sourceDisclosure: delivery.sourceDisclosure,
    summary: delivery.summary,
    outcomeStatus: delivery.outcomeStatus,
    changes: delivery.changes.map((change) => ({
      kind: change.kind,
      operation: change.operation,
      numericDelta: change.numericDelta,
    })),
    reasons: delivery.explanation.reasons.map((reason) => ({
      kind: reason.kind,
      summary: reason.summary,
    })),
  } as Prisma.InputJsonValue;
}

function safeJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function b0Locale(stateValue: unknown): string {
  const state = jsonRecord(stateValue);
  const b0 = jsonRecord(state?.b0);
  const locale = typeof b0?.locale === "string" ? b0.locale.trim() : "";
  return locale || String(process.env.B0_NARRATIVE_LOCALE || "en").trim() || "en";
}

function narrativeKey(batchId: string, roleId: string) {
  return `b0-narrative:${batchId}:${roleId}:SETTLEMENT_ROLE_VIEW`;
}

function jsonRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function required(value: string | null | undefined, label: string): string {
  const result = String(value ?? "").trim();
  if (!result) throw hard("B0_CONTEXT_REQUIRED", `${label} is required.`);
  return result;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function stableId(prefix: string, ...values: string[]): string {
  return `${prefix}.${createHash("sha256").update(JSON.stringify(values)).digest("hex").slice(0, 24)}`;
}

function hard(code: string, message: string): B0PipelineErrorV1 {
  return new B0PipelineErrorV1(code, message, false);
}
