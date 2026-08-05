import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { ManeuverProjectionV1 } from "@ai-story/shared";
import type {
  ManeuverCompilerContextV1,
  ManeuverContactOptionV1,
  ObservableTraceV1,
} from "@ai-story/templates";
import type { AuthoritativeManeuverContextV1 } from "./maneuver-v1.core";
import {
  projectPrivateEvidenceV1,
  type InvestigationOutcomeDefinitionV1,
} from "./maneuver-v1.evidence";
import { parseManeuverContextV1 } from "./maneuver-v1.context-parser";
import {
  COMMITTED_ACTION_STATUSES,
  MANEUVER_SLOTS,
  domain,
  optionalRecord,
  uniqueSlots,
  uniqueStrings,
} from "./maneuver-v1.prisma-utils";
import type { PrismaService } from "../prisma.service";

type DatabaseClient = PrismaService | Prisma.TransactionClient;
type FallbackRoleRowV1 = { id: string; roleName: string; identity?: string | null; publicInfo?: string | null };
type FallbackFactRowV1 = {
  factKey: string;
  content: string;
  visibility?: string | null;
  knownByRoleIdsJson?: unknown;
  sourceEventIdsJson?: unknown;
  sourceActionIdsJson?: unknown;
};

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
      visibleFactKeysJson: true,
    },
  });
  if (!turn) throw domain("MANEUVER_WINDOW_CLOSED", "No active role turn is available.", 409);

  const [mainlineSubmission, actions, roleAssets, contactRoles, confirmedFacts] = await Promise.all([
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
    (db as any).storyRole.findMany({
      where: { runId, id: { not: player.roleId } },
      select: { id: true, roleName: true, identity: true, publicInfo: true },
      orderBy: { createdAt: "asc" },
    }),
    (db as any).canonFact.findMany({
      where: { runId, status: "confirmed" },
      select: {
        factKey: true,
        content: true,
        visibility: true,
        knownByRoleIdsJson: true,
        sourceEventIdsJson: true,
        sourceActionIdsJson: true,
      },
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
  const fallback = deriveFallbackManeuverContextV1({
    roleId: player.roleId,
    visibleFactKeys: stringList(turn.visibleFactKeysJson),
    roles: contactRoles,
    facts: confirmedFacts,
  });
  const contacts = parsed.compilerContext.contacts.length
    ? parsed.compilerContext.contacts
    : fallback.contacts;
  const useConfiguredInvestigations = parsed.compilerContext.traces.length > 0
    && parsed.investigationOutcomes.length > 0;
  const traces = useConfiguredInvestigations
    ? parsed.compilerContext.traces
    : fallback.traces;
  const investigationOutcomes = useConfiguredInvestigations
    ? parsed.investigationOutcomes
    : fallback.investigationOutcomes;
  const compilerContext: ManeuverCompilerContextV1 = {
    ...parsed.compilerContext,
    contacts,
    traces,
    legalTargetIds: uniqueStrings([
      ...parsed.compilerContext.legalTargetIds,
      ...contacts.map((contact) => contact.id),
      ...traces.map((trace) => trace.traceId),
    ]),
  };

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
    compilerContext,
    investigationOutcomes,
  };
}

export async function readManeuverProjectionV1(
  db: DatabaseClient,
  userId: string,
  runId: string,
): Promise<ManeuverProjectionV1> {
  const context = await readManeuverContextV1(db, userId, runId);
  const [actions, incomingRows, evidenceRows] = await Promise.all([
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
    (db as any).playerAction.findMany({
      where: {
        runId,
        nodeId: context.nodeId,
        targetRoleId: context.roleId,
        actionType: "CONVERSATION",
        actionKey: { startsWith: "maneuver:" },
        visibility: { in: ["TARGETED", "PUBLIC"] },
        status: { in: COMMITTED_ACTION_STATUSES },
      },
      select: {
        id: true,
        status: true,
        freeText: true,
        intent: true,
        visibility: true,
        role: { select: { roleName: true } },
      },
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
    inProgress: [
      ...actions.map((action: any) => ({
        actionId: String(action.id),
        label: actionLabel(action.normalizedJson),
        status: String(action.status || "PENDING"),
      })),
      ...projectIncomingContactProgressV1(incomingRows),
    ],
    privateEvidence: projectPrivateEvidenceV1(context.roleId, evidenceRows),
  };
}

export function deriveFallbackManeuverContextV1(input: {
  roleId: string;
  visibleFactKeys: string[];
  roles: FallbackRoleRowV1[];
  facts: FallbackFactRowV1[];
}): {
  contacts: ManeuverContactOptionV1[];
  traces: ObservableTraceV1[];
  investigationOutcomes: InvestigationOutcomeDefinitionV1[];
} {
  const contacts = input.roles
    .filter((role) => role.id && role.id !== input.roleId && role.roleName)
    .map((role) => ({
      id: role.id,
      label: role.roleName,
      method: "Send one bounded message about the current situation.",
      guaranteedStart: `${role.roleName} receives the message.`,
      contestedOutcome: `${role.roleName} may answer, refuse, delay, or give only a partial response.`,
      notGuaranteed: "The recipient is not forced to agree, disclose private information, or tell the truth.",
      visibility: "TARGETED" as const,
    }));
  const visibleKeys = new Set(input.visibleFactKeys);
  const visibleFacts = input.facts.filter((fact) => {
    if (!fact.factKey || !fact.content) return false;
    if (visibleKeys.has(fact.factKey)) return true;
    if (String(fact.visibility || "").toLowerCase() === "public") return true;
    return stringList(fact.knownByRoleIdsJson).includes(input.roleId);
  });
  const traces: ObservableTraceV1[] = [];
  const investigationOutcomes: InvestigationOutcomeDefinitionV1[] = [];
  for (const fact of visibleFacts) {
    const digest = createHash("sha256").update(fact.factKey).digest("hex").slice(0, 24);
    const traceId = `trace.canon.${digest}`;
    const routeId = `route.verify.${digest}`;
    const statement = clipped(fact.content, 480);
    const label = clipped(statement, 72);
    traces.push({
      traceId,
      label,
      description: statement,
      sourceKind: sourceKindForFact(fact),
      routeOptions: [{
        routeId,
        label: "Verify the recorded source",
        method: "Review the observable source record and compare it with the current scene.",
        guaranteedStart: "A bounded verification of the recorded source begins.",
        contestedOutcome: "The check may confirm the recorded statement or reveal a concrete inconsistency.",
        notGuaranteed: "The check cannot establish intent or any broader claim that the source does not contain.",
      }],
    });
    investigationOutcomes.push({
      routeId,
      factKey: fact.factKey,
      title: label,
      summary: statement,
      supports: statement,
      cannotProve: "Intent, authorship, and any broader claim not stated in this record.",
      sourceKind: "RECORD",
      provenanceKey: `canon:${fact.factKey}`,
    });
  }
  return { contacts, traces, investigationOutcomes };
}

function sourceKindForFact(fact: FallbackFactRowV1): ObservableTraceV1["sourceKind"] {
  if (stringList(fact.sourceActionIdsJson).length) return "PERSON";
  if (stringList(fact.sourceEventIdsJson).length) return "EVENT";
  return "DOCUMENT";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).map((entry) => entry.trim())
    : [];
}

function clipped(value: string, maximum: number): string {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function actionLabel(value: unknown): string {
  const normalized = optionalRecord(value);
  const compiled = normalized && optionalRecord(normalized.compiled);
  return typeof compiled?.objective === "string" && compiled.objective.trim()
    ? compiled.objective.trim()
    : "Maneuver in progress";
}


export function projectIncomingContactProgressV1(rows: unknown[]): ManeuverProjectionV1["inProgress"] {
  return rows.flatMap((rowInput) => {
    const row = optionalRecord(rowInput);
    const visibility = typeof row?.visibility === "string" ? row.visibility : "";
    const role = optionalRecord(row?.role);
    const actionId = typeof row?.id === "string" ? row.id.trim() : "";
    const fromLabel = typeof role?.roleName === "string" ? role.roleName.trim() : "";
    const message = typeof row?.freeText === "string" && row.freeText.trim()
      ? row.freeText.trim()
      : typeof row?.intent === "string" ? row.intent.trim() : "";
    const status = typeof row?.status === "string" ? row.status.trim() : "";
    if (!actionId || !fromLabel || !message || !status) return [];
    if (visibility !== "TARGETED" && visibility !== "PUBLIC") return [];
    return [{ actionId, label: `${fromLabel}: ${message}`, status }];
  });
}
