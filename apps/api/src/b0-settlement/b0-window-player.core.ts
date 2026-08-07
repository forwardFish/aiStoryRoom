import { createHash } from "node:crypto";
import type {
  B0ActionContractV1,
  B0SettlementWindowV1,
} from "@ai-story/shared";
import type {
  B0PublicationDeliveryV1,
  CompiledManeuverV1,
  ManeuverCompilerContextV1,
} from "@ai-story/templates";
import type { ManeuverPreviewTokenPayloadV1 } from "../maneuver-v1/maneuver-v1.core";
import type { B0WindowProjectionV1 } from "./b0-window-coordinator.core";

export type B0PlayerPlanPresentationV1 = {
  title: string;
  description: string;
  visibleEffect: string;
  visibleRisk: string | null;
  confirmLabel: string;
};

export type B0PlayerStructuredResultV1 = {
  resultId: string;
  resultKind: B0PublicationDeliveryV1["resultKind"];
  visibility: B0PublicationDeliveryV1["visibility"];
  summary: string;
  outcomeStatus: B0PublicationDeliveryV1["outcomeStatus"];
  changes: Array<{
    kind: B0PublicationDeliveryV1["changes"][number]["kind"];
    operation: B0PublicationDeliveryV1["changes"][number]["operation"];
    numericDelta: number | null;
  }>;
  reasons: Array<{ kind: string; summary: string }>;
};

export type B0PlayerNarrativeProjectionV1 = {
  status: "NOT_REQUESTED" | "PENDING" | "AVAILABLE" | "FAILED_RETRYABLE";
  content: string | null;
  updatedAt: string | null;
};

export type B0PlayerWindowProjectionV1 = {
  schemaVersion: "b0-player-window-projection-v1";
  serverNow: string;
  window: {
    id: string;
    ordinal: number;
    situationId: string;
    status: B0SettlementWindowV1["status"];
    openedAt: string;
    locksAt: string | null;
    lockedAt: string | null;
    committedAt: string | null;
    completedAt: string | null;
    lockReason: B0SettlementWindowV1["lockReason"];
    rulesetVersion: string;
  };
  actor: {
    ready: boolean;
    readyRevision: number;
  };
  readyCount: number;
  expectedCount: number;
  plan: null | {
    status: "DRAFT" | "CONFIRMED" | "LOCKED";
    revision: number;
    visibility: "PUBLIC" | "PRIVATE" | "COVERT" | "CONDITIONAL";
    presentation: B0PlayerPlanPresentationV1;
  };
  settlement: {
    status: "NOT_STARTED" | "PREPARED" | "RESOLVING" | "COMMITTED" | "PUBLISHED" | "COMPLETED" | "FAILED_RETRYABLE" | "FAILED_HARD";
  };
  structuredResults: B0PlayerStructuredResultV1[];
  narrative: B0PlayerNarrativeProjectionV1;
};

export class B0PlayerWindowErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "B0PlayerWindowErrorV1";
  }
}

export function mapManeuverPreviewToB0ActionV1(input: {
  payload: ManeuverPreviewTokenPayloadV1;
  window: B0SettlementWindowV1;
  compilerContext: ManeuverCompilerContextV1;
  clientRequestId: string;
  now: string;
}): B0ActionContractV1 {
  const { payload, window } = input;
  if (payload.runId !== window.runId
    || payload.actorRoleId !== payload.compiled.actorRoleId
    || payload.stateRevision !== window.baseWorldSequence) {
    throw new B0PlayerWindowErrorV1("PREVIEW_STALE", "The preview no longer matches the active settlement window.");
  }
  if (payload.compiled.stateRevision !== payload.stateRevision
    || payload.compiled.turnRevision !== payload.turnRevision) {
    throw new B0PlayerWindowErrorV1("PREVIEW_TAMPERED", "The compiled preview revision binding is invalid.");
  }
  const actorId = payload.actorRoleId;
  const target = targetFor(payload.compiled, input.compilerContext, actorId);
  const attached = payload.compiled.attachedLeverageId
    ? [payload.compiled.attachedLeverageId]
    : [];
  const visibility = visibilityFor(payload.compiled, actorId, target.actorRecipientId);
  const timestamp = iso(input.now, "now");
  const intentId = stableId("b0.intent", window.id, actorId);
  const propositionRefs = target.propositionRef ? [target.propositionRef] : [];
  return {
    schemaVersion: "b0-action-contract-v1",
    id: intentId,
    windowId: window.id,
    roomId: window.roomId,
    runId: window.runId,
    actorId,
    baseWorldSequence: window.baseWorldSequence,
    revision: 1,
    kind: maneuverKind(payload.compiled),
    rawPlayerText: rawText(payload),
    normalizedSummary: boundedText(payload.compiled.objective, "objective", 500),
    targetRefs: [target.ref],
    primaryEffect: {
      effectTypeId: stableSemanticId("effect", payload.compiled.kind, payload.compiled.primaryEffect),
      direction: effectDirection(payload.compiled),
      requestedMagnitude: "MODERATE",
    },
    method: {
      methodTypeId: stableSemanticId("method", payload.compiled.kind, payload.compiled.method),
      description: boundedText(payload.compiled.method, "method", 500),
    },
    resourceCommitments: attached.map((resourceId) => ({ resourceId, amount: 1 })),
    evidenceRefs: [],
    capabilityRefs: [],
    propositionRefs,
    visibilityIntent: visibility,
    reactionPolicy: payload.compiled.visibility === "PUBLIC" ? "IF_PUBLIC" : "IF_OBSERVED",
    requestedTiming: "CURRENT_WINDOW",
    riskTags: payload.compiled.contestedOutcome.length ? ["contested"] : [],
    compilerVersion: "maneuver-v1-to-b0-v1",
    validationVersion: "b0-action-contract-v1",
    clientRequestId: requiredIdentifier(input.clientRequestId, "clientRequestId"),
    status: "DRAFT",
    createdAt: timestamp,
    updatedAt: timestamp,
    confirmedAt: null,
    lockedAt: null,
  };
}

export function projectB0PlayerWindowV1(input: {
  projection: B0WindowProjectionV1;
  participantVersion: number;
  presentation: B0PlayerPlanPresentationV1 | null;
  structuredResults?: readonly B0PublicationDeliveryV1[];
  narrative?: B0PlayerNarrativeProjectionV1 | null;
  serverNow: string;
}): B0PlayerWindowProjectionV1 {
  const currentIntent = input.projection.lockedIntent
    ?? input.projection.lastConfirmed
    ?? input.projection.latestDraft;
  const planStatus = input.projection.lockedIntent
    ? "LOCKED"
    : input.projection.lastConfirmed
      ? "CONFIRMED"
      : input.projection.latestDraft
        ? "DRAFT"
        : null;
  const presentation = currentIntent
    ? normalizePresentation(input.presentation ?? fallbackPresentation(currentIntent))
    : null;
  return {
    schemaVersion: "b0-player-window-projection-v1",
    serverNow: iso(input.serverNow, "serverNow"),
    window: {
      id: input.projection.window.id,
      ordinal: input.projection.window.ordinal,
      situationId: input.projection.window.situationId,
      status: input.projection.window.status,
      openedAt: input.projection.window.openedAt,
      locksAt: input.projection.window.locksAt,
      lockedAt: input.projection.window.lockedAt,
      committedAt: input.projection.window.committedAt,
      completedAt: input.projection.window.completedAt,
      lockReason: input.projection.window.lockReason,
      rulesetVersion: input.projection.window.rulesetVersion,
    },
    actor: {
      ready: input.projection.actorReady,
      readyRevision: nonNegativeInteger(input.participantVersion, "participantVersion"),
    },
    readyCount: input.projection.readyCount,
    expectedCount: input.projection.expectedCount,
    plan: currentIntent && planStatus && presentation ? {
      status: planStatus,
      revision: currentIntent.revision,
      visibility: currentIntent.visibilityIntent.type,
      presentation,
    } : null,
    settlement: { status: settlementStatus(input.projection) },
    structuredResults: [...(input.structuredResults ?? [])]
      .filter((delivery) => delivery.recipientActorId === input.projection.actorId)
      .sort((left, right) => left.idempotencyKey.localeCompare(right.idempotencyKey))
      .map((delivery) => ({
        resultId: delivery.resultId,
        resultKind: delivery.resultKind,
        visibility: delivery.visibility,
        summary: delivery.summary,
        outcomeStatus: delivery.outcomeStatus,
        changes: delivery.changes.map((change) => ({
          kind: change.kind,
          operation: change.operation,
          numericDelta: change.numericDelta,
        })),
        reasons: delivery.explanation.reasons.map((reason) => ({ kind: reason.kind, summary: reason.summary })),
      })),
    narrative: input.narrative ?? {
      status: input.projection.window.status === "COMMITTED" || input.projection.window.status === "PUBLISHING" || input.projection.window.status === "COMPLETED"
        ? "PENDING"
        : "NOT_REQUESTED",
      content: null,
      updatedAt: null,
    },
  };
}

export function normalizeB0PlayerPlanPresentationV1(input: unknown): B0PlayerPlanPresentationV1 {
  if (!record(input)) throw new B0PlayerWindowErrorV1("PLAN_PRESENTATION_INVALID", "Plan presentation must be an object.");
  const value = input as Record<string, unknown>;
  const allowed = ["title", "description", "visibleEffect", "visibleRisk", "confirmLabel"];
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new B0PlayerWindowErrorV1("PLAN_PRESENTATION_INVALID", `Plan presentation contains unknown fields: ${unknown.sort().join(", ")}.`);
  return normalizePresentation({
    title: text(value.title, "title", 500),
    description: text(value.description, "description", 1_000),
    visibleEffect: text(value.visibleEffect, "visibleEffect", 1_500),
    visibleRisk: optionalText(value.visibleRisk, "visibleRisk", 1_500),
    confirmLabel: text(value.confirmLabel, "confirmLabel", 160),
  });
}

function targetFor(
  compiled: CompiledManeuverV1,
  context: ManeuverCompilerContextV1,
  actorId: string,
): { ref: B0ActionContractV1["targetRefs"][number]; propositionRef: string | null; actorRecipientId: string | null } {
  const targetId = requiredIdentifier(compiled.targetRef, "compiled.targetRef");
  if (context.contacts.some((contact) => contact.id === targetId)) {
    return { ref: { type: "ACTOR", id: targetId }, propositionRef: null, actorRecipientId: targetId };
  }
  if (context.traces.some((trace) => trace.traceId === targetId)) {
    return { ref: { type: "ACTOR", id: actorId }, propositionRef: targetId, actorRecipientId: null };
  }
  if (!context.legalTargetIds.includes(targetId)) {
    throw new B0PlayerWindowErrorV1("TARGET_UNAVAILABLE", "The compiled target is no longer available.");
  }
  return { ref: { type: "ACTOR", id: actorId }, propositionRef: targetId, actorRecipientId: null };
}

function visibilityFor(
  compiled: CompiledManeuverV1,
  actorId: string,
  targetActorId: string | null,
): B0ActionContractV1["visibilityIntent"] {
  if (compiled.visibility === "PUBLIC") return { type: "PUBLIC" };
  const recipients = [...new Set([actorId, ...(targetActorId ? [targetActorId] : [])])].sort();
  return { type: "PRIVATE", declaredRecipientRefs: recipients };
}

function maneuverKind(compiled: CompiledManeuverV1): B0ActionContractV1["kind"] {
  if (compiled.kind === "CONVERSATION") return "INFLUENCE";
  if (compiled.kind === "INVESTIGATION") return "OBSERVE";
  return "ACT";
}

function effectDirection(compiled: CompiledManeuverV1): B0ActionContractV1["primaryEffect"]["direction"] {
  if (compiled.kind === "INVESTIGATION") return "VERIFY";
  if (compiled.kind === "CONVERSATION") return "CREATE";
  return "INCREASE";
}

function rawText(payload: ManeuverPreviewTokenPayloadV1): string {
  return boundedText(payload.draft.rawText || payload.compiled.objective, "rawPlayerText", 2_000);
}

function fallbackPresentation(intent: B0ActionContractV1): B0PlayerPlanPresentationV1 {
  return {
    title: intent.normalizedSummary,
    description: intent.method.description,
    visibleEffect: intent.rawPlayerText,
    visibleRisk: intent.riskTags.length ? "The result remains contested until the shared settlement is complete." : null,
    confirmLabel: "Confirm this plan",
  };
}

function normalizePresentation(value: B0PlayerPlanPresentationV1): B0PlayerPlanPresentationV1 {
  return {
    title: boundedText(value.title, "title", 500),
    description: boundedText(value.description, "description", 1_000),
    visibleEffect: boundedText(value.visibleEffect, "visibleEffect", 1_500),
    visibleRisk: value.visibleRisk ? boundedText(value.visibleRisk, "visibleRisk", 1_500) : null,
    confirmLabel: boundedText(value.confirmLabel, "confirmLabel", 160),
  };
}

function settlementStatus(projection: B0WindowProjectionV1): B0PlayerWindowProjectionV1["settlement"]["status"] {
  const batchStatus = projection.batch?.status;
  if (batchStatus === "PREPARED") return "PREPARED";
  if (batchStatus === "RESOLVING" || batchStatus === "RESOLVED" || batchStatus === "COMMITTING") return "RESOLVING";
  if (batchStatus === "COMMITTED") return "COMMITTED";
  if (batchStatus === "PUBLISHED") return "PUBLISHED";
  if (batchStatus === "COMPLETED") return "COMPLETED";
  if (batchStatus === "FAILED_RETRYABLE") return "FAILED_RETRYABLE";
  if (batchStatus === "FAILED_HARD") return "FAILED_HARD";
  if (projection.window.status === "COMMITTED") return "COMMITTED";
  if (projection.window.status === "PUBLISHING") return "PUBLISHED";
  if (projection.window.status === "COMPLETED") return "COMPLETED";
  if (projection.window.status === "FAILED_RETRYABLE") return "FAILED_RETRYABLE";
  if (projection.window.status === "FAILED_HARD") return "FAILED_HARD";
  return "NOT_STARTED";
}

function stableSemanticId(prefix: string, kind: string, value: string): string {
  return `${prefix}.${kind.toLowerCase()}.${digest([kind, value]).slice(0, 20)}`;
}

function stableId(prefix: string, ...values: string[]): string {
  return `${prefix}.${digest(values).slice(0, 24)}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requiredIdentifier(value: unknown, label: string): string {
  const result = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,199}$/u.test(result)) {
    throw new B0PlayerWindowErrorV1("IDENTIFIER_INVALID", `${label} is invalid.`);
  }
  return result;
}

function boundedText(value: unknown, label: string, maximum: number): string {
  const result = String(value ?? "").trim();
  if (!result || result.length > maximum) throw new B0PlayerWindowErrorV1("TEXT_INVALID", `${label} is invalid.`);
  return result;
}

function text(value: unknown, label: string, maximum: number): string {
  return boundedText(value, label, maximum);
}

function optionalText(value: unknown, label: string, maximum: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return boundedText(value, label, maximum);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new B0PlayerWindowErrorV1("REVISION_INVALID", `${label} is invalid.`);
  return Number(value);
}

function iso(value: string, label: string): string {
  if (Number.isNaN(Date.parse(value))) throw new B0PlayerWindowErrorV1("TIMESTAMP_INVALID", `${label} is invalid.`);
  return new Date(value).toISOString();
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
