import type { Prisma } from "@prisma/client";
import type {
  CreateCommittedManeuverV1,
  ManeuverCommittedActionV1,
  ManeuverImmediateReceiptV1,
} from "./maneuver-v1.core";
import {
  createPrivateEvidenceCardV1,
  investigationOutcomesFromContextV1,
  preserveSameProvenanceEvidenceV1,
  privateEvidenceAssetKeyV1,
  readPrivateEvidenceCardV1,
} from "./maneuver-v1.evidence";
import {
  MANEUVER_SLOTS,
  domain,
  nonNegativeInteger,
  record,
} from "./maneuver-v1.prisma-utils";

export async function findCommittedManeuverV1(
  db: Prisma.TransactionClient | any,
  userId: string,
  runId: string,
  idempotencyKey: string,
): Promise<ManeuverCommittedActionV1 | null> {
  const action = await db.playerAction.findFirst({
    where: {
      runId,
      userId,
      idempotencyKey,
      actionKey: { startsWith: "maneuver:" },
      actionSlot: { in: MANEUVER_SLOTS },
    },
    select: actionSelect(),
  });
  return action ? committedFromRow(action) : null;
}

export async function createCommittedManeuverV1(
  db: Prisma.TransactionClient | any,
  input: CreateCommittedManeuverV1,
): Promise<ManeuverCommittedActionV1> {
  const remaining = Math.max(0, 2 - input.context.usedSlots.length - 1);
  const isConversation = input.compiled.kind === "CONVERSATION"
    && input.context.compilerContext.contacts.some((contact) => contact.id === input.compiled.targetRef);
  const action = await db.playerAction.create({
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
      immediateJson: {
        schemaVersion: "maneuver_commit_receipt_v1",
        actorTurnId: input.context.actorTurnId,
        immediateReceipt: input.immediateReceipt,
        remaining,
      },
    },
    select: actionSelect(),
  });

  if (input.compiled.kind !== "INVESTIGATION") return committedFromRow(action);
  if (!input.draft.routeId) throw domain("TRACE_UNAVAILABLE", "The investigation route is missing.", 409);

  const turn = await db.actorTurn.findUnique({
    where: { id: input.context.actorTurnId },
    select: { contextJson: true },
  });
  if (!turn) throw domain("PREVIEW_STALE", "The investigation turn no longer exists.", 409);
  const outcome = investigationOutcomesFromContextV1(turn.contextJson)
    .find((candidate) => candidate.routeId === input.draft.routeId);
  if (!outcome) throw domain("PREVIEW_STALE", "The investigation route no longer has an authoritative evidence binding.", 409);

  const fact = await db.canonFact.findFirst({
    where: {
      runId: input.context.runId,
      factKey: outcome.factKey,
      status: "confirmed",
    },
    select: { id: true },
  });
  if (!fact) throw domain("PREVIEW_STALE", "The fact behind this investigation is no longer confirmed.", 409);

  const proposed = createPrivateEvidenceCardV1({
    actionId: action.id,
    roleId: input.context.roleId,
    outcome,
  });
  const assetKey = privateEvidenceAssetKeyV1(input.context.roleId, outcome.provenanceKey);
  const existing = await db.roleAsset.findFirst({
    where: { runId: input.context.runId, assetKey },
    select: { id: true, ownerRoleId: true, kind: true, visibility: true, stateJson: true },
  });

  let evidence = proposed;
  let evidenceAssetId: string;
  if (existing) {
    if (existing.ownerRoleId !== input.context.roleId || existing.kind !== "PRIVATE_EVIDENCE_V1" || existing.visibility !== "PRIVATE") {
      throw domain("PRIVATE_EVIDENCE_CONFLICT", "The evidence provenance is already bound to another scope.", 409, false);
    }
    evidence = preserveSameProvenanceEvidenceV1(readPrivateEvidenceCardV1(existing.stateJson), proposed);
    evidenceAssetId = existing.id;
  } else {
    const asset = await db.roleAsset.create({
      data: {
        runId: input.context.runId,
        assetKey,
        kind: "PRIVATE_EVIDENCE_V1",
        ownerRoleId: input.context.roleId,
        quantity: 1,
        status: "ACTIVE",
        visibility: "PRIVATE",
        stateJson: evidence,
      },
      select: { id: true },
    });
    evidenceAssetId = asset.id;
    await db.roleAssetMutation.create({
      data: {
        assetId: asset.id,
        actionId: action.id,
        mutationType: "ACQUIRE",
        delta: 1,
        fromRoleId: null,
        toRoleId: input.context.roleId,
        beforeJson: { quantity: 0, status: "ABSENT" },
        afterJson: { quantity: 1, status: "ACTIVE", evidenceId: evidence.evidenceId },
        idempotencyKey: `maneuver-evidence:${action.id}`,
      },
    });
  }

  const resolved = await db.playerAction.update({
    where: { id: action.id },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedJson: {
        schemaVersion: "maneuver_investigation_result_v1",
        privateEvidenceAssetId: evidenceAssetId,
        provenanceKey: evidence.provenanceKey,
      },
    },
    select: actionSelect(),
  });
  return committedFromRow(resolved);
}

function actionSelect() {
  return {
    id: true,
    actionSlot: true,
    status: true,
    idempotencyKey: true,
    requestHash: true,
    immediateJson: true,
    resolvedAt: true,
  };
}

function committedFromRow(action: any): ManeuverCommittedActionV1 {
  if (!MANEUVER_SLOTS.includes(action.actionSlot)) {
    throw domain("MANEUVER_ACTION_CORRUPT", "The committed maneuver slot is invalid.", 500, false);
  }
  const receiptRoot = record(action.immediateJson, "immediateJson");
  const immediateReceipt = parseImmediateReceipt(receiptRoot.immediateReceipt);
  if (typeof action.idempotencyKey !== "string" || typeof action.requestHash !== "string") {
    throw domain("MANEUVER_ACTION_CORRUPT", "The committed maneuver idempotency record is incomplete.", 500, false);
  }
  return {
    actionId: String(action.id),
    slot: action.actionSlot,
    status: action.status === "RESOLVED" || action.resolvedAt ? "RESOLVED" : "PENDING",
    idempotencyKey: action.idempotencyKey,
    requestHash: action.requestHash,
    immediateReceipt,
    remaining: nonNegativeInteger(receiptRoot.remaining, "immediateJson.remaining"),
  };
}

function parseImmediateReceipt(value: unknown): ManeuverImmediateReceiptV1 {
  const row = record(value, "immediateReceipt");
  const visibility = String(row.visibility || "");
  if (!["PRIVATE", "TARGETED", "PUBLIC"].includes(visibility)) {
    throw domain("MANEUVER_ACTION_CORRUPT", "The committed maneuver visibility is invalid.", 500, false);
  }
  if (typeof row.title !== "string" || typeof row.narrative !== "string") {
    throw domain("MANEUVER_ACTION_CORRUPT", "The committed maneuver receipt is incomplete.", 500, false);
  }
  return {
    title: row.title,
    narrative: row.narrative,
    visibility: visibility as ManeuverImmediateReceiptV1["visibility"],
  };
}
