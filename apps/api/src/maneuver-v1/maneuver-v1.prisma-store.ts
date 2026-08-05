import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ManeuverDomainErrorV1,
  type AuthoritativeManeuverContextV1,
  type CreateCommittedManeuverV1,
  type ManeuverCommittedActionV1,
  type ManeuverImmediateReceiptV1,
  type ManeuverSlotV1,
  type ManeuverStoreV1,
  type ManeuverTransactionV1,
} from "./maneuver-v1.core";
import type {
  CustomManeuverAnalysisV1,
  ManeuverCompilerContextV1,
  ManeuverContactOptionV1,
  ManeuverLeverageAssetV1,
  ObservableTraceV1,
} from "@ai-story/templates";
import { PrismaService } from "../prisma.service";

type DatabaseClient = PrismaService | Prisma.TransactionClient;
type JsonRecord = Record<string, unknown>;

const MANEUVER_SLOTS: ManeuverSlotV1[] = ["MANEUVER_1", "MANEUVER_2"];
const COMMITTED_ACTION_STATUSES = ["PENDING", "RESOLVED", "COMMITTED", "IN_PROGRESS"];

@Injectable()
export class ManeuverV1PrismaStore implements ManeuverStoreV1 {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  readContext(userId: string, runId: string) {
    return readContext(this.prisma, userId, runId);
  }

  async serializable<T>(operation: (tx: ManeuverTransactionV1) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => operation(transactionAdapter(tx)), {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000,
        });
      } catch (error: any) {
        if (!isRetryableTransactionError(error) || attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1) ** 2));
      }
    }
    throw new Error("UNREACHABLE_MANEUVER_TRANSACTION_RETRY");
  }
}

function transactionAdapter(tx: Prisma.TransactionClient): ManeuverTransactionV1 {
  return {
    readContext: (userId, runId) => readContext(tx, userId, runId),
    findByIdempotencyKey: (userId, runId, key) => findCommittedAction(tx, userId, runId, key),
    createAction: (input) => createAction(tx, input),
  };
}

async function readContext(
  db: DatabaseClient,
  userId: string,
  runId: string,
): Promise<AuthoritativeManeuverContextV1> {
  const run = await (db as any).storyRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      ownerUserId: true,
      currentNodeId: true,
      currentChapter: true,
      worldSequence: true,
      status: true,
    },
  });
  if (!run) throw domain("RUN_NOT_FOUND", "The story run was not found.", 404, false);
  if (!run.currentNodeId) throw domain("MANEUVER_WINDOW_CLOSED", "The current scene is not available.", 409);

  const membership = await (db as any).storyPlayer.findFirst({
    where: { runId, userId, status: "active" },
    select: { id: true, roleId: true, userId: true },
  });
  if (!membership?.roleId) throw domain("ROLE_CONTROL_REQUIRED", "Choose and control a role before using a maneuver.", 403, false);

  const control = await (db as any).roleControl.findFirst({
    where: { runId, roleId: membership.roleId },
    select: { epoch: true, mode: true, humanPlayerId: true },
  });
  if (!control
    || control.mode !== "HUMAN_ACTIVE"
    || control.humanPlayerId !== membership.id) {
    throw domain("ROLE_CONTROL_REQUIRED", "The current user no longer controls this role.", 403, false);
  }

  const turn = await (db as any).actorTurn.findFirst({
    where: { runId, roleId: membership.roleId },
    orderBy: [{ stageIndex: "desc" }, { turnIndex: "desc" }, { revision: "desc" }],
    select: {
      id: true,
      runId: true,
      roleId: true,
      stageIndex: true,
      status: true,
      revision: true,
      contextJson: true,
    },
  });
  if (!turn) throw domain("MANEUVER_WINDOW_CLOSED", "No active role turn is available.", 409);

  const [mainlineSubmission, actions, roleAssets] = await Promise.all([
    (db as any).decisionSubmission.findUnique({ where: { turnId: turn.id }, select: { id: true } }),
    (db as any).playerAction.findMany({
      where: {
        runId,
        nodeId: run.currentNodeId,
        roleId: membership.roleId,
        actionKey: `maneuver:${turn.id}`,
        actionSlot: { in: MANEUVER_SLOTS },
        status: { in: COMMITTED_ACTION_STATUSES },
      },
      select: { actionSlot: true },
      orderBy: { createdAt: "asc" },
    }),
    (db as any).roleAsset.findMany({
      where: {
        runId,
        ownerRoleId: membership.roleId,
        status: "ACTIVE",
        quantity: { gt: 0 },
      },
      select: { id: true, assetKey: true, stateJson: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const usedSlots = uniqueSlots(actions.map((action: any) => action.actionSlot));
  const compilerContext = compilerContextFrom(turn.contextJson, roleAssets, {
    roleId: membership.roleId,
    stateRevision: Number(run.worldSequence || 0),
    turnRevision: Number(turn.revision || 0),
  });

  return {
    runId,
    userId,
    roleId: membership.roleId,
    actorTurnId: turn.id,
    nodeId: run.currentNodeId,
    stageIndex: Number(turn.stageIndex || run.currentChapter || 1),
    stateRevision: Number(run.worldSequence || 0),
    turnRevision: Number(turn.revision || 0),
    controlEpoch: Number(control.epoch || 0),
    windowState: run.status === "playing" && turn.status === "OPEN" ? "OPEN" : "CLOSED",
    mainlineLocked: Boolean(mainlineSubmission) || turn.status !== "OPEN",
    usedSlots,
    compilerContext,
  };
}

async function findCommittedAction(
  db: DatabaseClient,
  userId: string,
  runId: string,
  idempotencyKey: string,
): Promise<ManeuverCommittedActionV1 | null> {
  const action = await (db as any).playerAction.findFirst({
    where: {
      runId,
      userId,
      idempotencyKey,
      actionKey: { startsWith: "maneuver:" },
      actionSlot: { in: MANEUVER_SLOTS },
    },
    select: {
      id: true,
      actionSlot: true,
      status: true,
      idempotencyKey: true,
      requestHash: true,
      immediateJson: true,
      resolvedAt: true,
    },
  });
  if (!action) return null;
  return committedActionFromRow(action);
}

async function createAction(
  db: Prisma.TransactionClient,
  input: CreateCommittedManeuverV1,
): Promise<ManeuverCommittedActionV1> {
  const remaining = Math.max(0, 2 - (input.context.usedSlots.length + 1));
  const immediateJson = {
    schemaVersion: "maneuver_commit_receipt_v1",
    actorTurnId: input.context.actorTurnId,
    immediateReceipt: input.immediateReceipt,
    remaining,
  };
  const isConversation = input.compiled.kind === "CONVERSATION"
    && input.context.compilerContext.contacts.some((contact) => contact.id === input.compiled.targetRef);

  const action = await (db as any).playerAction.create({
    data: {
      runId: input.context.runId,
      nodeId: input.context.nodeId,
      chapterIndex: input.context.stageIndex,
      userId: input.userId,
      roleId: input.context.roleId,
      playerType: "human",
      actionType: input.compiled.kind,
      targetType: input.compiled.kind === "INVESTIGATION" ? "TRACE" : "MANEUVER_TARGET",
      targetId: input.compiled.targetRef,
      targetText: input.compiled.targetRef,
      method: input.compiled.method,
      intent: input.compiled.objective,
      riskLevel: "normal",
      freeText: input.draft.rawText || null,
      normalizedJson: {
        schemaVersion: "maneuver_action_v1",
        actorTurnId: input.context.actorTurnId,
        stateRevision: input.context.stateRevision,
        turnRevision: input.context.turnRevision,
        controlEpoch: input.context.controlEpoch,
        draft: input.draft,
        compiled: input.compiled,
      },
      guardStatus: "approved",
      guardReason: null,
      auditStatus: "pending",
      status: "PENDING",
      actionSlot: input.slot,
      actorKind: "HUMAN",
      controlEpoch: input.context.controlEpoch,
      policyVersion: "maneuver_v1",
      provider: "deterministic",
      modelName: "bounded-maneuver-v1",
      actionKey: `maneuver:${input.context.actorTurnId}`,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      visibility: input.compiled.visibility,
      targetRoleId: isConversation ? input.compiled.targetRef : null,
      leverageKey: input.compiled.attachedLeverageId || null,
      sealedAt: new Date(),
      immediateJson,
    },
    select: {
      id: true,
      actionSlot: true,
      status: true,
      idempotencyKey: true,
      requestHash: true,
      immediateJson: true,
      resolvedAt: true,
    },
  });
  return committedActionFromRow(action);
}

function committedActionFromRow(action: any): ManeuverCommittedActionV1 {
  const slot = action.actionSlot;
  if (!MANEUVER_SLOTS.includes(slot)) throw domain("MANEUVER_ACTION_CORRUPT", "The committed maneuver slot is invalid.", 500, false);
  const receiptRoot = record(action.immediateJson);
  const immediateReceipt = parseImmediateReceipt(receiptRoot.immediateReceipt);
  const remaining = nonNegativeInteger(receiptRoot.remaining, "immediateJson.remaining");
  if (typeof action.idempotencyKey !== "string" || typeof action.requestHash !== "string") {
    throw domain("MANEUVER_ACTION_CORRUPT", "The committed maneuver idempotency record is incomplete.", 500, false);
  }
  return {
    actionId: String(action.id),
    slot,
    status: action.status === "RESOLVED" || action.resolvedAt ? "RESOLVED" : "PENDING",
    idempotencyKey: action.idempotencyKey,
    requestHash: action.requestHash,
    immediateReceipt,
    remaining,
  };
}

function compilerContextFrom(
  contextJson: unknown,
  roleAssets: any[],
  revisions: { roleId: string; stateRevision: number; turnRevision: number },
): ManeuverCompilerContextV1 {
  const root = record(contextJson);
  const maneuver = optionalRecord(root.maneuverV1) || {};
  const source = optionalRecord(maneuver.compilerContext) || maneuver;
  const contacts = parseContacts(source.contacts);
  const traces = parseTraces(source.traces);
  const leverageAssets = roleAssets.flatMap((asset) => {
    const parsed = parseLeverageAsset(asset);
    return parsed ? [parsed] : [];
  });
  const legalTargetIds = uniqueStrings([
    ...stringArray(source.legalTargetIds),
    ...contacts.map((contact) => contact.id),
    ...traces.map((trace) => trace.traceId),
    ...leverageAssets.flatMap((asset) => asset.legalTargetIds),
  ]);
  const customAnalysis = source.customAnalysis === undefined
    ? undefined
    : parseCustomAnalysis(source.customAnalysis);
  return {
    actorRoleId: revisions.roleId,
    stateRevision: revisions.stateRevision,
    turnRevision: revisions.turnRevision,
    contacts,
    traces,
    leverageAssets,
    legalTargetIds,
    ...(customAnalysis ? { customAnalysis } : {}),
  };
}

function parseContacts(value: unknown): ManeuverContactOptionV1[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    const row = record(entry);
    return {
      id: text(row.id, `contacts[${index}].id`),
      label: text(row.label, `contacts[${index}].label`),
      method: text(row.method, `contacts[${index}].method`),
      guaranteedStart: text(row.guaranteedStart, `contacts[${index}].guaranteedStart`),
      contestedOutcome: text(row.contestedOutcome, `contacts[${index}].contestedOutcome`),
      notGuaranteed: text(row.notGuaranteed, `contacts[${index}].notGuaranteed`),
      visibility: row.visibility === "PUBLIC" ? "PUBLIC" : "TARGETED",
    };
  });
}

function parseTraces(value: unknown): ObservableTraceV1[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    const row = record(entry);
    const sourceKind = row.sourceKind;
    if (!["DOCUMENT", "PERSON", "LOCATION", "RESOURCE", "EVENT"].includes(String(sourceKind))) {
      throw domain("MANEUVER_CONTEXT_INVALID", `traces[${index}].sourceKind is invalid.`, 500, false);
    }
    if (!Array.isArray(row.routeOptions)) throw domain("MANEUVER_CONTEXT_INVALID", `traces[${index}].routeOptions is invalid.`, 500, false);
    return {
      traceId: text(row.traceId, `traces[${index}].traceId`),
      label: text(row.label, `traces[${index}].label`),
      description: text(row.description, `traces[${index}].description`),
      sourceKind: sourceKind as ObservableTraceV1["sourceKind"],
      routeOptions: row.routeOptions.map((routeInput, routeIndex) => {
        const route = record(routeInput);
        return {
          routeId: text(route.routeId, `traces[${index}].routeOptions[${routeIndex}].routeId`),
          label: text(route.label, `traces[${index}].routeOptions[${routeIndex}].label`),
          method: text(route.method, `traces[${index}].routeOptions[${routeIndex}].method`),
          guaranteedStart: text(route.guaranteedStart, `traces[${index}].routeOptions[${routeIndex}].guaranteedStart`),
          contestedOutcome: text(route.contestedOutcome, `traces[${index}].routeOptions[${routeIndex}].contestedOutcome`),
          notGuaranteed: text(route.notGuaranteed, `traces[${index}].routeOptions[${routeIndex}].notGuaranteed`),
        };
      }),
    };
  });
}

function parseLeverageAsset(asset: any): ManeuverLeverageAssetV1 | null {
  const state = optionalRecord(asset.stateJson);
  const source = state && optionalRecord(state.maneuverV1);
  if (!source) return null;
  const legalTargetIds = stringArray(source.legalTargetIds);
  if (!legalTargetIds.length) return null;
  return {
    assetId: String(asset.id || asset.assetKey),
    label: text(source.label || asset.assetKey, "leverage.label"),
    effectSummary: text(source.effectSummary, "leverage.effectSummary"),
    primaryEffect: text(source.primaryEffect, "leverage.primaryEffect"),
    method: text(source.method, "leverage.method"),
    legalTargetIds,
    guaranteedStart: text(source.guaranteedStart, "leverage.guaranteedStart"),
    contestedOutcome: text(source.contestedOutcome, "leverage.contestedOutcome"),
    notGuaranteed: text(source.notGuaranteed, "leverage.notGuaranteed"),
    visibility: source.visibility === "PUBLIC" ? "PUBLIC" : source.visibility === "PRIVATE" ? "PRIVATE" : "TARGETED",
  };
}

function parseCustomAnalysis(value: unknown): CustomManeuverAnalysisV1 {
  // The runtime-contract validator remains the authority. Keeping the value as
  // unknown here prevents the database projection from bypassing validation.
  return value as CustomManeuverAnalysisV1;
}

function parseImmediateReceipt(value: unknown): ManeuverImmediateReceiptV1 {
  const row = record(value);
  const visibility = row.visibility;
  if (!["PRIVATE", "TARGETED", "PUBLIC"].includes(String(visibility))) {
    throw domain("MANEUVER_ACTION_CORRUPT", "The committed maneuver visibility is invalid.", 500, false);
  }
  return {
    title: text(row.title, "immediateReceipt.title"),
    narrative: text(row.narrative, "immediateReceipt.narrative"),
    visibility: visibility as ManeuverImmediateReceiptV1["visibility"],
  };
}

function uniqueSlots(values: unknown[]): ManeuverSlotV1[] {
  const result: ManeuverSlotV1[] = [];
  for (const value of values) {
    if (!MANEUVER_SLOTS.includes(value as ManeuverSlotV1)) continue;
    if (!result.includes(value as ManeuverSlotV1)) result.push(value as ManeuverSlotV1);
  }
  return result;
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw domain("MANEUVER_CONTEXT_INVALID", "A maneuver context object is invalid.", 500, false);
  }
  return value as JsonRecord;
}

function optionalRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw domain("MANEUVER_CONTEXT_INVALID", `${path} is required.`, 500, false);
  }
  return value.trim();
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).map((entry) => entry.trim());
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw domain("MANEUVER_ACTION_CORRUPT", `${path} is invalid.`, 500, false);
  }
  return Number(value);
}

function domain(code: string, message: string, status: number, recoverable = true) {
  return new ManeuverDomainErrorV1(code, message, status, recoverable);
}

function isRetryableTransactionError(error: any): boolean {
  const message = String(error?.message || error || "");
  return error?.code === "P2034"
    || error?.code === "P2028"
    || error?.code === "P2002"
    || /40001|40P01|deadlock detected|serialization failure|write conflict/i.test(message);
}
