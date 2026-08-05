import type { Prisma } from "@prisma/client";
import type { ManeuverProjectionV1 } from "@ai-story/shared";
import type { AuthoritativeManeuverContextV1 } from "./maneuver-v1.core";
import { projectPrivateEvidenceV1 } from "./maneuver-v1.evidence";
import { parseManeuverContextV1 } from "./maneuver-v1.context-parser";
import {
  COMMITTED_ACTION_STATUSES,
  MANEUVER_SLOTS,
  domain,
  optionalRecord,
  uniqueSlots,
} from "./maneuver-v1.prisma-utils";
import type { PrismaService } from "../prisma.service";

type DatabaseClient = PrismaService | Prisma.TransactionClient;

export async function readManeuverContextV1(
  db: DatabaseClient,
  userId: string,
  runId: string,
): Promise<AuthoritativeManeuverContextV1> {
  const run = await (db as any).storyRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      currentNodeId: true,
      currentChapter: true,
      worldSequence: true,
      status: true,
    },
  });
  if (!run) throw domain("RUN_NOT_FOUND", "The story run was not found.", 404, false);
  if (!run.currentNodeId) throw domain("MANEUVER_WINDOW_CLOSED", "The current scene is not available.", 409);

  const player = await (db as any).storyPlayer.findFirst({
    where: { runId, userId, status: "active" },
    select: { id: true, roleId: true },
  });
  if (!player?.roleId) throw domain("ROLE_CONTROL_REQUIRED", "Choose and control a role before using a maneuver.", 403, false);

  const control = await (db as any).roleControl.findFirst({
    where: { runId, roleId: player.roleId },
    select: { epoch: true, mode: true, humanPlayerId: true },
  });
  if (!control || control.mode !== "HUMAN_ACTIVE" || control.humanPlayerId !== player.id) {
    throw domain("ROLE_CONTROL_REQUIRED", "The current user no longer controls this role.", 403, false);
  }

  const turn = await (db as any).actorTurn.findFirst({
    where: { runId, roleId: player.roleId },
    orderBy: [{ stageIndex: "desc" }, { turnIndex: "desc" }, { revision: "desc" }],
    select: {
      id: true,
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
        roleId: player.roleId,
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
        ownerRoleId: player.roleId,
        status: "ACTIVE",
        quantity: { gt: 0 },
      },
      select: { id: true, assetKey: true, stateJson: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const stateRevision = Number(run.worldSequence || 0);
  const turnRevision = Number(turn.revision || 0);
  const parsed = parseManeuverContextV1(turn.contextJson, roleAssets, {
    roleId: player.roleId,
    stateRevision,
    turnRevision,
  });

  return {
    runId,
    userId,
    roleId: player.roleId,
    actorTurnId: turn.id,
    nodeId: run.currentNodeId,
    stageIndex: Number(turn.stageIndex || run.currentChapter || 1),
    stateRevision,
    turnRevision,
    controlEpoch: Number(control.epoch || 0),
    windowState: run.status === "playing" && turn.status === "OPEN" ? "OPEN" : "CLOSED",
    mainlineLocked: Boolean(mainlineSubmission) || turn.status !== "OPEN",
    usedSlots: uniqueSlots(actions.map((action: any) => action.actionSlot)),
    compilerContext: parsed.compilerContext,
    investigationOutcomes: parsed.investigationOutcomes,
  };
}

export async function readManeuverProjectionV1(
  db: DatabaseClient,
  userId: string,
  runId: string,
): Promise<ManeuverProjectionV1> {
  const context = await readManeuverContextV1(db, userId, runId);
  const [actions, evidenceRows] = await Promise.all([
    (db as any).playerAction.findMany({
      where: {
        runId,
        roleId: context.roleId,
        actionKey: `maneuver:${context.actorTurnId}`,
        actionSlot: { in: MANEUVER_SLOTS },
        status: { in: ["PENDING", "COMMITTED", "IN_PROGRESS"] },
      },
      select: { id: true, status: true, normalizedJson: true },
      orderBy: { createdAt: "asc" },
    }),
    (db as any).roleAsset.findMany({
      where: {
        runId,
        ownerRoleId: context.roleId,
        kind: "PRIVATE_EVIDENCE_V1",
        status: "ACTIVE",
        visibility: "PRIVATE",
        quantity: { gt: 0 },
      },
      select: { id: true, ownerRoleId: true, visibility: true, stateJson: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return {
    schemaVersion: "maneuver_projection_v1",
    maxPerTurn: 2,
    remaining: Math.max(0, 2 - context.usedSlots.length),
    windowState: context.windowState === "OPEN" && !context.mainlineLocked ? "OPEN" : "CLOSED",
    stateRevision: context.stateRevision,
    turnRevision: context.turnRevision,
    contacts: context.compilerContext.contacts.map(({ id, label }) => ({ id, label })),
    traces: context.compilerContext.traces.map((trace) => ({
      traceId: trace.traceId,
      label: trace.label,
      description: trace.description,
      sourceKind: trace.sourceKind,
      routeOptions: trace.routeOptions.map(({ routeId, label, method }) => ({ routeId, label, method })),
    })),
    leverageAssets: context.compilerContext.leverageAssets.map(({ assetId, label, effectSummary }) => ({
      id: assetId,
      label,
      effectSummary,
    })),
    inProgress: actions.map((action: any) => ({
      actionId: String(action.id),
      label: actionLabel(action.normalizedJson),
      status: String(action.status || "PENDING"),
    })),
    privateEvidence: projectPrivateEvidenceV1(context.roleId, evidenceRows),
  };
}

function actionLabel(value: unknown): string {
  const normalized = optionalRecord(value);
  const compiled = normalized && optionalRecord(normalized.compiled);
  return typeof compiled?.objective === "string" && compiled.objective.trim()
    ? compiled.objective.trim()
    : "Maneuver in progress";
}
