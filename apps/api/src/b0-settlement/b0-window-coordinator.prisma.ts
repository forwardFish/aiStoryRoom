import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  B0ActionContractV1,
  B0RoomRulesetV1,
  B0SettlementWindowV1,
} from "@ai-story/shared";
import { validateB0SettlementWindowV1 } from "@ai-story/shared";
import { hashCanonicalB0Value } from "@ai-story/templates";
import { PrismaService } from "../prisma.service";
import {
  assertB0StoredIntentEnvelopeV1,
  assertB0WindowConfigV1,
  confirmB0DraftRevisionV1,
  createB0WindowConfigV1,
  freezeB0WindowV1,
  projectB0WindowV1,
  saveB0DraftRevisionV1,
  type B0FreezeEnvelopeV1,
  type B0ParticipantReadyStateV1,
  type B0StoredIntentEnvelopeV1,
  type B0WindowConfigV1,
  type B0WindowFreezeStoreV1,
  type B0WindowProjectionV1,
  type B0WindowStoreRecordV1,
  type B0WindowWorldCaptureV1,
} from "./b0-window-coordinator.core";

type Tx = Prisma.TransactionClient;

const B0_PROJECTION_STABILITY_ATTEMPTS = 4;

export type CreateB0WindowCommandV1 = {
  runId: string;
  nodeId: string;
  situationId: string;
  ruleset: B0RoomRulesetV1;
  expectedActorIds: string[];
  openedAt: string;
  locksAt: string;
};

export type SaveB0DraftCommandV1 = {
  windowId: string;
  actorId: string;
  controlEpoch: number;
  expectedRevision: number;
  candidate: B0ActionContractV1;
  now: string;
};

export type ConfirmB0DraftCommandV1 = {
  windowId: string;
  actorId: string;
  controlEpoch: number;
  expectedRevision: number;
  now: string;
};

export type SetB0ReadyCommandV1 = {
  windowId: string;
  actorId: string;
  controlEpoch: number;
  expectedParticipantVersion: number;
  now: string;
};

@Injectable()
export class B0WindowCoordinatorService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createWindow(command: CreateB0WindowCommandV1): Promise<B0SettlementWindowV1> {
    return this.serializable(async (tx) => {
      const openedAt = date(command.openedAt, "openedAt");
      const locksAt = date(command.locksAt, "locksAt");
      if (locksAt.getTime() < openedAt.getTime()) throw domain("WINDOW_LOCK_TIME_INVALID", "locksAt cannot precede openedAt.");
      const run = await tx.storyRun.findUnique({
        where: { id: command.runId },
        include: {
          roles: { orderBy: { id: "asc" } },
          roleControls: { orderBy: { roleId: "asc" } },
        },
      });
      if (!run) throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
      const node = await tx.sceneNode.findUnique({ where: { id: command.nodeId } });
      if (!node || node.runId !== run.id) throw domain("WINDOW_NOT_FOUND", "The requested scene node does not belong to the run.");
      const expectedActorIds = [...new Set(command.expectedActorIds)].sort();
      const roleById = new Map<string, any>(run.roles.map((role: any) => [role.id, role]));
      const controlByRoleId = new Map<string, any>(run.roleControls.map((control: any) => [control.roleId, control]));
      if (expectedActorIds.length === 0 || expectedActorIds.some((actorId) => !roleById.has(actorId) || !controlByRoleId.has(actorId))) {
        throw domain("ACTOR_NOT_EXPECTED", "The expected B0 actor set is invalid for this run.");
      }
      const existing = await tx.actionWindow.findFirst({
        where: {
          runId: run.id,
          status: { in: ["OPEN", "LOCKED", "SETTLING", "COMMITTED", "PUBLISHING"] },
        },
        include: { participants: true, node: true },
        orderBy: { createdAt: "desc" },
      });
      if (existing) throw domain("WINDOW_ALREADY_ACTIVE", `Run ${run.id} already has active window ${existing.id}.`);
      const config = createB0WindowConfigV1({
        situationId: command.situationId,
        ruleset: command.ruleset,
        expectedActorIds,
        roleBindings: expectedActorIds.map((actorId) => {
          const control = controlByRoleId.get(actorId)!;
          return {
            actorId,
            roleId: actorId,
            controlEpoch: control.epoch,
            controlMode: control.mode === "AI_ACTIVE" ? "AI_ACTIVE" : "HUMAN_ACTIVE",
          };
        }),
        createdAt: openedAt.toISOString(),
      });
      const window = await tx.actionWindow.create({
        data: {
          runId: run.id,
          nodeId: node.id,
          status: "OPEN",
          mainOpenedAt: openedAt,
          mainClosesAt: locksAt,
          openingSnapshotVersion: run.worldSequence,
          projectionVersion: 1,
          configJson: config as unknown as Prisma.InputJsonValue,
        },
      });
      for (const actorId of expectedActorIds) {
        await tx.actionWindowParticipant.create({
          data: {
            windowId: window.id,
            roleId: actorId,
            mainStatus: "B0_PENDING",
            maneuverStatus: "LOCKED",
            reactionStatus: "NOT_OPEN",
          },
        });
      }
      await enqueueWindowEvent(tx, {
        runId: run.id,
        nodeId: node.id,
        windowId: window.id,
        dedupeKey: `b0-window-opened:${window.id}`,
        eventType: "WINDOW_OPENED",
        payload: {
          windowId: window.id,
          situationId: config.situationId,
          expectedCount: expectedActorIds.length,
          locksAt: locksAt.toISOString(),
          rulesetVersion: config.ruleset.rulesetVersion,
        },
      });
      const participants = expectedActorIds.map((actorId) => ({ actorId, ready: false, version: 1 }));
      return mapWindow(window, config, participants);
    });
  }

  async saveDraft(command: SaveB0DraftCommandV1): Promise<{ envelope: B0StoredIntentEnvelopeV1; replayed: boolean }> {
    return this.serializable(async (tx) => {
      const context = await loadCoordinatorContext(tx, command.windowId, command.actorId, command.controlEpoch);
      const currentRow = await tx.playerAction.findUnique({
        where: { nodeId_roleId_actionSlot: { nodeId: context.dbWindow.nodeId, roleId: command.actorId, actionSlot: "B0_PRIMARY" } },
      });
      const current = currentRow?.normalizedJson ? assertB0StoredIntentEnvelopeV1(currentRow.normalizedJson) : null;
      const candidate = currentRow ? { ...command.candidate, id: currentRow.id } : command.candidate;
      const result = saveB0DraftRevisionV1({
        window: context.record.window,
        config: context.record.config,
        current,
        candidate,
        expectedRevision: command.expectedRevision,
        now: command.now,
      });
      if (!result.replayed) {
        await persistIntentEnvelope(tx, context, result.envelope, "b0_draft");
        await tx.actionWindow.update({ where: { id: command.windowId }, data: { projectionVersion: { increment: 1 } } });
      }
      return result;
    });
  }

  async confirmDraft(command: ConfirmB0DraftCommandV1): Promise<{ envelope: B0StoredIntentEnvelopeV1; replayed: boolean }> {
    return this.serializable(async (tx) => {
      const context = await loadCoordinatorContext(tx, command.windowId, command.actorId, command.controlEpoch);
      const row = await tx.playerAction.findUnique({
        where: { nodeId_roleId_actionSlot: { nodeId: context.dbWindow.nodeId, roleId: command.actorId, actionSlot: "B0_PRIMARY" } },
      });
      if (!row?.normalizedJson) throw domain("INTENT_NOT_FOUND", "No B0 draft exists for this actor.");
      const result = confirmB0DraftRevisionV1({
        window: context.record.window,
        config: context.record.config,
        current: assertB0StoredIntentEnvelopeV1(row.normalizedJson),
        expectedRevision: command.expectedRevision,
        now: command.now,
      });
      if (!result.replayed) {
        await persistIntentEnvelope(tx, context, result.envelope, "b0_confirmed");
        await tx.actionWindow.update({ where: { id: command.windowId }, data: { projectionVersion: { increment: 1 } } });
      }
      return result;
    });
  }

  async ready(command: SetB0ReadyCommandV1): Promise<B0WindowProjectionV1> {
    return this.serializable(async (tx) => {
      const context = await loadCoordinatorContext(tx, command.windowId, command.actorId, command.controlEpoch);
      const participant = context.dbWindow.participants.find((entry: any) => entry.roleId === command.actorId)!;
      if (participant.mainStatus === "B0_LOCKED") throw domain("WINDOW_ALREADY_LOCKED", "The B0 window is already locked.");
      if (participant.mainStatus !== "B0_READY") {
        const updated = await tx.actionWindowParticipant.updateMany({
          where: { id: participant.id, version: command.expectedParticipantVersion, mainStatus: "B0_PENDING" },
          data: { mainStatus: "B0_READY", doneAt: date(command.now, "now"), version: { increment: 1 } },
        });
        if (updated.count !== 1) throw domain("INTENT_STALE_REVISION", "The participant ready state changed.");
        await tx.actionWindow.update({ where: { id: command.windowId }, data: { projectionVersion: { increment: 1 } } });
      }
      const refreshed = await new PrismaB0WindowFreezeStoreV1(tx).readWindow(command.windowId);
      if (!refreshed) throw domain("WINDOW_NOT_FOUND", "The B0 window disappeared.");
      const readyCount = refreshed.participants.filter((entry) => entry.ready).length;
      await enqueueWindowEvent(tx, {
        runId: refreshed.window.runId,
        nodeId: context.dbWindow.nodeId,
        windowId: refreshed.window.id,
        dedupeKey: `b0-ready:${refreshed.window.id}:${command.actorId}:${readyCount}`,
        eventType: "WINDOW_READY_COUNT_CHANGED",
        payload: { windowId: refreshed.window.id, readyCount, expectedCount: refreshed.config.expectedActorIds.length },
      });
      const freeze = await freezeB0WindowV1(new PrismaB0WindowFreezeStoreV1(tx), {
        windowId: command.windowId,
        now: command.now,
      });
      const record = await new PrismaB0WindowFreezeStoreV1(tx).readWindow(command.windowId);
      if (!record) throw domain("WINDOW_NOT_FOUND", "The B0 window disappeared after ready.");
      return this.projectionInTx(tx, record, command.actorId, freeze.envelope);
    });
  }

  async unready(command: SetB0ReadyCommandV1): Promise<B0WindowProjectionV1> {
    return this.serializable(async (tx) => {
      const context = await loadCoordinatorContext(tx, command.windowId, command.actorId, command.controlEpoch);
      const participant = context.dbWindow.participants.find((entry: any) => entry.roleId === command.actorId)!;
      if (participant.mainStatus === "B0_READY") {
        const updated = await tx.actionWindowParticipant.updateMany({
          where: { id: participant.id, version: command.expectedParticipantVersion, mainStatus: "B0_READY" },
          data: { mainStatus: "B0_PENDING", doneAt: null, version: { increment: 1 } },
        });
        if (updated.count !== 1) throw domain("INTENT_STALE_REVISION", "The participant ready state changed.");
        await tx.actionWindow.update({ where: { id: command.windowId }, data: { projectionVersion: { increment: 1 } } });
      }
      const store = new PrismaB0WindowFreezeStoreV1(tx);
      const record = await store.readWindow(command.windowId);
      if (!record) throw domain("WINDOW_NOT_FOUND", "The B0 window disappeared after unready.");
      const readyCount = record.participants.filter((entry) => entry.ready).length;
      await enqueueWindowEvent(tx, {
        runId: record.window.runId,
        nodeId: context.dbWindow.nodeId,
        windowId: record.window.id,
        dedupeKey: `b0-unready:${record.window.id}:${command.actorId}:${readyCount}`,
        eventType: "WINDOW_READY_COUNT_CHANGED",
        payload: { windowId: record.window.id, readyCount, expectedCount: record.config.expectedActorIds.length },
      });
      return this.projectionInTx(tx, record, command.actorId, null);
    });
  }

  async freezeDeadline(windowId: string, now = new Date()): Promise<Awaited<ReturnType<typeof freezeB0WindowV1>>> {
    return this.serializable((tx) => freezeB0WindowV1(new PrismaB0WindowFreezeStoreV1(tx), {
      windowId,
      now: now.toISOString(),
      requestedReason: "DEADLINE",
    }));
  }

  async recoverExpired(now = new Date()): Promise<Array<{ windowId: string; status: string }>> {
    const windows = await this.prisma.actionWindow.findMany({
      where: { status: "OPEN", mainClosesAt: { lte: now } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    const results: Array<{ windowId: string; status: string }> = [];
    for (const window of windows) {
      const result = await this.freezeDeadline(window.id, now);
      results.push({ windowId: window.id, status: result.status });
    }
    return results;
  }

  async projection(windowId: string, actorId: string): Promise<B0WindowProjectionV1> {
    for (let attempt = 0; attempt < B0_PROJECTION_STABILITY_ATTEMPTS; attempt += 1) {
      const dbWindow = await this.prisma.actionWindow.findUnique({
        where: { id: windowId },
        include: {
          participants: true,
          node: true,
          resolutionWorkflow: { select: { rulesOutputJson: true } },
        },
      });
      if (!dbWindow) {
        throw new NotFoundException({ code: "WINDOW_NOT_FOUND", message: "B0 window not found" });
      }

      const record = mapWindowRecord(dbWindow);
      const row = await this.prisma.playerAction.findUnique({
        where: {
          nodeId_roleId_actionSlot: {
            nodeId: dbWindow.nodeId,
            roleId: actorId,
            actionSlot: "B0_PRIMARY",
          },
        },
      });
      const stable = await this.prisma.actionWindow.findUnique({
        where: { id: windowId },
        select: { version: true, projectionVersion: true },
      });
      if (!stable) {
        throw new NotFoundException({ code: "WINDOW_NOT_FOUND", message: "B0 window not found" });
      }
      if (stable.version !== dbWindow.version || stable.projectionVersion !== dbWindow.projectionVersion) {
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
        continue;
      }

      const output = jsonRecord(dbWindow.resolutionWorkflow?.rulesOutputJson);
      const freeze = output?.schemaVersion === "b0-freeze-envelope-v1"
        ? output as unknown as B0FreezeEnvelopeV1
        : null;
      return projectB0WindowV1({
        record,
        actorId,
        intent: row?.normalizedJson ? assertB0StoredIntentEnvelopeV1(row.normalizedJson) : null,
        freeze,
      });
    }
    throw new ConflictException({
      code: "PROJECTION_CHANGED_RETRY",
      message: "The synchronized window changed while it was being read. Retry the projection.",
      recoverable: true,
    });
  }

  private async projectionInTx(
    tx: Tx,
    record: B0WindowStoreRecordV1,
    actorId: string,
    freeze: B0FreezeEnvelopeV1 | null,
  ): Promise<B0WindowProjectionV1> {
    const window = await tx.actionWindow.findUnique({
      where: { id: record.window.id },
      select: { nodeId: true },
    });
    if (!window) throw domain("WINDOW_NOT_FOUND", "B0 window not found.");
    const row = await tx.playerAction.findUnique({
      where: { nodeId_roleId_actionSlot: {
        nodeId: window.nodeId,
        roleId: actorId,
        actionSlot: "B0_PRIMARY",
      } },
    });
    return projectB0WindowV1({
      record,
      actorId,
      intent: row?.normalizedJson ? assertB0StoredIntentEnvelopeV1(row.normalizedJson) : null,
      freeze,
    });
  }

  private async serializable<T>(operation: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000,
        });
      } catch (error: any) {
        if (!retryable(error) || attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1) ** 2));
      }
    }
    throw new Error("UNREACHABLE_B0_WINDOW_RETRY");
  }
}

export class PrismaB0WindowFreezeStoreV1 implements B0WindowFreezeStoreV1 {
  private cache = new Map<string, any>();
  constructor(private readonly tx: Tx | any) {}

  async readWindow(windowId: string): Promise<B0WindowStoreRecordV1 | null> {
    const dbWindow = await this.tx.actionWindow.findUnique({
      where: { id: windowId },
      include: { participants: true, node: true },
    });
    if (!dbWindow) return null;
    this.cache.set(windowId, dbWindow);
    return mapWindowRecord(dbWindow);
  }

  async claimOpenWindow(input: {
    windowId: string;
    expectedVersion: number;
    lockReason: "ALL_READY" | "DEADLINE" | "IMMEDIATE";
    lockedAt: string;
  }): Promise<boolean> {
    const updated = await this.tx.actionWindow.updateMany({
      where: { id: input.windowId, status: "OPEN", version: input.expectedVersion },
      data: {
        status: "LOCKED",
        closingReason: input.lockReason,
        graceOpenedAt: date(input.lockedAt, "lockedAt"),
        version: { increment: 1 },
        projectionVersion: { increment: 1 },
      },
    });
    return updated.count === 1;
  }

  async readIntentEnvelope(windowId: string, actorId: string): Promise<B0StoredIntentEnvelopeV1 | null> {
    const window = this.cache.get(windowId) || await this.tx.actionWindow.findUnique({ where: { id: windowId } });
    if (!window) return null;
    const row = await this.tx.playerAction.findUnique({
      where: { nodeId_roleId_actionSlot: { nodeId: window.nodeId, roleId: actorId, actionSlot: "B0_PRIMARY" } },
    });
    return row?.normalizedJson ? assertB0StoredIntentEnvelopeV1(row.normalizedJson) : null;
  }

  async captureWorld(windowId: string): Promise<B0WindowWorldCaptureV1> {
    const window = this.cache.get(windowId) || await this.tx.actionWindow.findUnique({ where: { id: windowId } });
    if (!window) throw domain("WINDOW_NOT_FOUND", "Cannot capture a missing B0 window.");
    const run = await this.tx.storyRun.findUnique({
      where: { id: window.runId },
      include: {
        roles: { orderBy: { id: "asc" } },
        relations: { orderBy: { id: "asc" } },
        roleAssets: { orderBy: { assetKey: "asc" } },
        canonFacts: { orderBy: { factKey: "asc" } },
        roleControls: { orderBy: { roleId: "asc" } },
      },
    });
    if (!run) throw domain("ROOM_NOT_FOUND", "Cannot capture a missing run.");
    return {
      worldState: {
        runId: run.id,
        worldSequence: run.worldSequence,
        currentDay: run.currentDay,
        dangerLevel: run.dangerLevel,
        state: run.stateJson,
      },
      actorStates: run.roles.map((role: any) => ({
        actorId: role.id,
        roleKey: role.roleKey,
        roleName: role.roleName,
        currentState: role.currentState,
        status: role.status,
        aiControlled: role.isAiControlled,
      })),
      roleBindings: run.roleControls.map((control: any) => ({
        actorId: control.roleId,
        roleId: control.roleId,
        mode: control.mode,
        epoch: control.epoch,
      })),
      knowledgeState: {
        roleKnowledge: run.roles.map((role: any) => ({ actorId: role.id, knownInfo: role.knownInfoJson })),
        facts: run.canonFacts.map((fact: any) => ({
          factKey: fact.factKey,
          content: fact.content,
          visibility: fact.visibility,
          knownByRoleIds: jsonStrings(fact.knownByRoleIdsJson),
        })),
      },
      relationshipState: run.relations.map((relation: any) => ({
        id: relation.id,
        fromActorId: relation.fromRoleId,
        toActorId: relation.toRoleId,
        type: relation.relationType,
        score: relation.score,
      })),
      resourceState: run.roleAssets.map((asset: any) => ({
        id: asset.id,
        assetKey: asset.assetKey,
        kind: asset.kind,
        ownerActorId: asset.ownerRoleId,
        quantity: asset.quantity,
        status: asset.status,
        version: asset.version,
        state: asset.stateJson,
      })),
      activeCapabilities: run.roleAssets
        .filter((asset: any) => asset.status === "ACTIVE" && ["CAPABILITY", "LEVERAGE", "RULE_CARD"].includes(String(asset.kind)))
        .map((asset: any) => ({ id: asset.id, assetKey: asset.assetKey, actorId: asset.ownerRoleId, state: asset.stateJson })),
      dueSystemIntents: [],
    };
  }

  async persistLockedIntent(input: {
    windowId: string;
    actorId: string;
    envelope: B0StoredIntentEnvelopeV1;
    intent: B0ActionContractV1;
  }): Promise<void> {
    const window = this.cache.get(input.windowId) || await this.tx.actionWindow.findUnique({
      where: { id: input.windowId },
      include: { node: true },
    });
    if (!window) throw domain("WINDOW_NOT_FOUND", "Cannot persist a locked intent for a missing window.");
    const node = window.node || await this.tx.sceneNode.findUnique({ where: { id: window.nodeId } });
    if (!node) throw domain("WINDOW_NOT_FOUND", "The B0 window node is missing.");
    const existing = await this.tx.playerAction.findUnique({
      where: { nodeId_roleId_actionSlot: { nodeId: window.nodeId, roleId: input.actorId, actionSlot: "B0_PRIMARY" } },
    });
    const data = {
      actionType: input.intent.kind.toLowerCase(),
      targetType: input.intent.targetRefs[0]?.type.toLowerCase() || "self",
      targetId: input.intent.targetRefs[0]?.id || input.actorId,
      targetText: input.intent.normalizedSummary,
      method: input.intent.method.description,
      intent: input.intent.normalizedSummary,
      riskLevel: input.intent.riskTags[0] || "normal",
      normalizedJson: input.envelope as unknown as Prisma.InputJsonValue,
      guardStatus: "ok",
      auditStatus: "ok",
      status: "b0_locked",
      actorKind: existing?.actorKind || "TIMEOUT_FALLBACK",
      controlEpoch: existing?.controlEpoch || 0,
      requestHash: hashCanonicalB0Value(input.intent),
      visibility: input.intent.visibilityIntent.type,
      sealedAt: date(input.intent.lockedAt, "lockedAt"),
    };
    if (existing) {
      await this.tx.playerAction.update({ where: { id: existing.id }, data });
    } else {
      await this.tx.playerAction.create({
        data: {
          id: input.intent.id,
          runId: window.runId,
          nodeId: window.nodeId,
          chapterIndex: node.chapterIndex,
          roleId: input.actorId,
          playerType: "system",
          actionSlot: "B0_PRIMARY",
          actionKey: "B0_HOLD",
          idempotencyKey: `b0-intent:${input.windowId}:${input.actorId}`,
          ...data,
        },
      });
    }
  }

  async persistFreeze(envelope: B0FreezeEnvelopeV1): Promise<void> {
    const window = this.cache.get(envelope.window.id) || await this.tx.actionWindow.findUnique({ where: { id: envelope.window.id } });
    if (!window) throw domain("WINDOW_NOT_FOUND", "Cannot persist a freeze for a missing window.");
    const existing = await this.tx.resolutionWorkflow.findUnique({ where: { windowId: envelope.window.id } });
    if (existing) {
      const output = jsonRecord(existing.rulesOutputJson);
      if (existing.rulesInputHash !== envelope.batch.inputHash
        || output?.schemaVersion !== "b0-freeze-envelope-v1"
        || output?.batch?.id !== envelope.batch.id) {
        throw domain("BATCH_ALREADY_COMMITTED", "The B0 window is already bound to another settlement workflow.");
      }
    } else {
      await this.tx.resolutionWorkflow.create({
        data: {
          runId: envelope.window.runId,
          windowId: envelope.window.id,
          nodeId: window.nodeId,
          status: "B0_PREPARED",
          rulesInputHash: envelope.batch.inputHash,
          rulesOutputJson: envelope as unknown as Prisma.InputJsonValue,
        },
      });
    }
    const task = await this.tx.storyTaskOutbox.upsert({
      where: { dedupeKey: `b0-settlement-requested:${envelope.batch.id}` },
      update: {},
      create: {
        runId: envelope.window.runId,
        nodeId: window.nodeId,
        windowId: envelope.window.id,
        dedupeKey: `b0-settlement-requested:${envelope.batch.id}`,
        taskType: "B0_SETTLEMENT_REQUESTED",
        status: "pending",
        inputRefId: envelope.batch.id,
        checkpointKey: "B0_BATCH_PREPARED",
        resultJson: {
          schemaVersion: "b0-settlement-request-v1",
          batchId: envelope.batch.id,
          snapshotId: envelope.snapshot.id,
          inputHash: envelope.batch.inputHash,
        } as Prisma.InputJsonValue,
      },
    });
    await this.tx.actionWindow.update({
      where: { id: envelope.window.id },
      data: { resolutionTaskId: task.id, projectionVersion: { increment: 1 } },
    });
    await this.tx.actionWindowParticipant.updateMany({
      where: { windowId: envelope.window.id },
      data: { mainStatus: "B0_LOCKED", version: { increment: 1 } },
    });
    await enqueueWindowEvent(this.tx, {
      runId: envelope.window.runId,
      nodeId: window.nodeId,
      windowId: envelope.window.id,
      dedupeKey: `b0-window-locked:${envelope.window.id}`,
      eventType: "WINDOW_LOCKED",
      payload: {
        windowId: envelope.window.id,
        lockReason: envelope.lockReason,
        lockedAt: envelope.lockedAt,
        batchId: envelope.batch.id,
      },
    });
  }

  async readFreeze(windowId: string): Promise<B0FreezeEnvelopeV1 | null> {
    const workflow = await this.tx.resolutionWorkflow.findUnique({ where: { windowId } });
    const output = jsonRecord(workflow?.rulesOutputJson);
    if (output?.schemaVersion !== "b0-freeze-envelope-v1") return null;
    return output as unknown as B0FreezeEnvelopeV1;
  }
}

async function loadCoordinatorContext(tx: Tx | any, windowId: string, actorId: string, controlEpoch: number) {
  const store = new PrismaB0WindowFreezeStoreV1(tx);
  const record = await store.readWindow(windowId);
  if (!record) throw new NotFoundException({ code: "WINDOW_NOT_FOUND", message: "B0 window not found" });
  if (record.window.status !== "OPEN") throw domain("WINDOW_NOT_OPEN", `The B0 window is ${record.window.status}.`);
  if (!record.config.expectedActorIds.includes(actorId)) throw domain("ACTOR_NOT_EXPECTED", "Actor is not part of this window.");
  const dbWindow = await tx.actionWindow.findUnique({
    where: { id: windowId },
    include: { participants: true, node: true },
  });
  const control = await tx.roleControl.findUnique({ where: { runId_roleId: { runId: record.window.runId, roleId: actorId } } });
  if (!dbWindow || !control || control.epoch !== controlEpoch) throw domain("ACTOR_OWNERSHIP_MISMATCH", "Role control epoch is stale.");
  return { store, record, dbWindow, control };
}

async function persistIntentEnvelope(
  tx: Tx | any,
  context: Awaited<ReturnType<typeof loadCoordinatorContext>>,
  envelope: B0StoredIntentEnvelopeV1,
  status: string,
) {
  const draft = envelope.latestDraft;
  if (!draft) throw domain("INTENT_NOT_FOUND", "Intent envelope has no latest draft.");
  const firstTarget = draft.targetRefs[0];
  const data = {
    actionType: draft.kind.toLowerCase(),
    targetType: firstTarget?.type.toLowerCase() || "self",
    targetId: firstTarget?.id || draft.actorId,
    targetText: draft.normalizedSummary,
    method: draft.method.description,
    intent: draft.normalizedSummary,
    riskLevel: draft.riskTags[0] || "normal",
    normalizedJson: envelope as unknown as Prisma.InputJsonValue,
    guardStatus: "ok",
    auditStatus: "ok",
    status,
    actorKind: context.control.mode === "AI_ACTIVE" ? "AI" : "HUMAN",
    controlEpoch: context.control.epoch,
    requestHash: envelope.latestRequestHash,
    visibility: draft.visibilityIntent.type,
  };
  await tx.playerAction.upsert({
    where: { nodeId_roleId_actionSlot: { nodeId: context.dbWindow.nodeId, roleId: draft.actorId, actionSlot: "B0_PRIMARY" } },
    update: data,
    create: {
      id: draft.id,
      runId: draft.runId,
      nodeId: context.dbWindow.nodeId,
      chapterIndex: context.dbWindow.node.chapterIndex,
      roleId: draft.actorId,
      playerType: context.control.mode === "AI_ACTIVE" ? "ai" : "human",
      actionSlot: "B0_PRIMARY",
      actionKey: "B0_PRIMARY",
      idempotencyKey: `b0-intent:${draft.windowId}:${draft.actorId}`,
      ...data,
    },
  });
}

function mapWindow(dbWindow: any, config: B0WindowConfigV1, participants: B0ParticipantReadyStateV1[]): B0SettlementWindowV1 {
  const value: B0SettlementWindowV1 = {
    schemaVersion: "b0-settlement-window-v1",
    id: dbWindow.id,
    roomId: dbWindow.runId,
    runId: dbWindow.runId,
    mode: config.ruleset.settlementMode,
    ordinal: Number(dbWindow.node?.nodeIndex || 1),
    situationId: config.situationId,
    baseWorldSequence: Number(dbWindow.openingSnapshotVersion ?? 0),
    expectedActorIds: [...config.expectedActorIds],
    readyActorIds: participants.filter((participant) => participant.ready).map((participant) => participant.actorId).sort(),
    openedAt: (dbWindow.mainOpenedAt || dbWindow.createdAt).toISOString(),
    locksAt: dbWindow.mainClosesAt ? dbWindow.mainClosesAt.toISOString() : null,
    lockedAt: dbWindow.graceOpenedAt ? dbWindow.graceOpenedAt.toISOString() : null,
    committedAt: ["COMMITTED", "PUBLISHING", "COMPLETED"].includes(dbWindow.status) && dbWindow.resolvedAt ? dbWindow.resolvedAt.toISOString() : null,
    completedAt: dbWindow.status === "COMPLETED" && dbWindow.resolvedAt ? dbWindow.resolvedAt.toISOString() : null,
    status: dbWindow.status as B0SettlementWindowV1["status"],
    lockReason: (dbWindow.closingReason || null) as B0SettlementWindowV1["lockReason"],
    rulesetVersion: config.ruleset.rulesetVersion,
    schemaRevision: 1,
  };
  const validation = validateB0SettlementWindowV1(value);
  if (!validation.ok) throw domain("WINDOW_STATE_INVALID", validation.errors.join("; "));
  return validation.value;
}

function mapWindowRecord(dbWindow: any): B0WindowStoreRecordV1 {
  const config = assertB0WindowConfigV1(dbWindow.configJson);
  const participants: B0ParticipantReadyStateV1[] = dbWindow.participants
    .map((participant: any) => ({
      actorId: participant.roleId,
      ready: participant.mainStatus === "B0_READY" || participant.mainStatus === "B0_LOCKED",
      version: participant.version,
    }))
    .sort((left: B0ParticipantReadyStateV1, right: B0ParticipantReadyStateV1) => left.actorId.localeCompare(right.actorId));
  return {
    window: mapWindow(dbWindow, config, participants),
    storageVersion: dbWindow.version,
    config,
    participants,
  };
}

async function enqueueWindowEvent(tx: Tx | any, input: {
  runId: string;
  nodeId: string;
  windowId: string;
  dedupeKey: string;
  eventType: string;
  payload: Record<string, unknown>;
}) {
  await tx.storyTaskOutbox.upsert({
    where: { dedupeKey: input.dedupeKey },
    update: {},
    create: {
      runId: input.runId,
      nodeId: input.nodeId,
      windowId: input.windowId,
      dedupeKey: input.dedupeKey,
      taskType: "B0_WINDOW_EVENT",
      status: "pending",
      inputRefId: input.windowId,
      checkpointKey: input.eventType,
      resultJson: {
        schemaVersion: "b0-window-event-v1",
        type: input.eventType,
        ...input.payload,
      } as Prisma.InputJsonValue,
    },
  });
}

function jsonStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function jsonRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function date(value: unknown, path: string): Date {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw domain("B0_TIMESTAMP_INVALID", `${path} must be an ISO timestamp.`);
  return new Date(value);
}

function domain(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

function retryable(error: unknown): boolean {
  const candidate = error as any;
  const code = String(candidate?.code || "");
  if (code === "P2034" || code === "40001" || code === "40P01") return true;
  if (code !== "P2002" || String(candidate?.meta?.modelName || "") !== "ActionWindow") return false;
  const target = candidate?.meta?.target;
  const fields = Array.isArray(target)
    ? target.map((entry: unknown) => String(entry))
    : typeof target === "string"
      ? [target]
      : [];
  return fields.length === 1 && (fields[0] === "nodeId" || fields[0].endsWith("_nodeId_key"));
}
