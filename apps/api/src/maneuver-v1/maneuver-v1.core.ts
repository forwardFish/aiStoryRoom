import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  compileManeuverV1,
  validateCustomManeuverAnalysisV1,
  validateManeuverCommitRequestV1,
  validateManeuverDraftV1,
  type CompiledManeuverV1,
  type CustomManeuverAnalysisV1,
  type ManeuverCompilerContextV1,
  type ManeuverDraftV1,
  type ManeuverDraftKindV1,
  type ManeuverPreviewPresentationV1,
} from "@ai-story/templates";

export const MANEUVER_MAX_PER_TURN_V1 = 2 as const;
export type ManeuverSlotV1 = "MANEUVER_1" | "MANEUVER_2";

export type ManeuverImmediateReceiptV1 = {
  title: string;
  narrative: string;
  visibility: "PRIVATE" | "TARGETED" | "PUBLIC";
};

export type ManeuverCommittedActionV1 = {
  actionId: string;
  slot: ManeuverSlotV1;
  status: "PENDING" | "RESOLVED";
  idempotencyKey: string;
  requestHash: string;
  immediateReceipt: ManeuverImmediateReceiptV1;
  remaining: number;
};

export type AuthoritativeManeuverContextV1 = {
  runId: string;
  userId: string;
  roleId: string;
  actorTurnId: string;
  nodeId: string;
  stageIndex: number;
  stateRevision: number;
  turnRevision: number;
  controlEpoch: number;
  windowState: "OPEN" | "CLOSED";
  mainlineLocked: boolean;
  usedSlots: ManeuverSlotV1[];
  compilerContext: ManeuverCompilerContextV1;
};

export type CreateCommittedManeuverV1 = {
  userId: string;
  context: AuthoritativeManeuverContextV1;
  slot: ManeuverSlotV1;
  draft: ManeuverDraftV1;
  compiled: CompiledManeuverV1;
  idempotencyKey: string;
  requestHash: string;
  immediateReceipt: ManeuverImmediateReceiptV1;
};

export interface ManeuverTransactionV1 {
  readContext(userId: string, runId: string): Promise<AuthoritativeManeuverContextV1>;
  findByIdempotencyKey(userId: string, runId: string, idempotencyKey: string): Promise<ManeuverCommittedActionV1 | null>;
  createAction(input: CreateCommittedManeuverV1): Promise<ManeuverCommittedActionV1>;
}

export interface ManeuverStoreV1 {
  readContext(userId: string, runId: string): Promise<AuthoritativeManeuverContextV1>;
  serializable<T>(operation: (tx: ManeuverTransactionV1) => Promise<T>): Promise<T>;
}

export type ManeuverPreviewTokenPayloadV1 = {
  schemaVersion: "maneuver_preview_token_v1";
  runId: string;
  userId: string;
  actorRoleId: string;
  actorTurnId: string;
  stateRevision: number;
  turnRevision: number;
  controlEpoch: number;
  slotVersion: number;
  draft: ManeuverDraftV1;
  compiled: CompiledManeuverV1;
  customAnalysis?: CustomManeuverAnalysisV1;
  issuedAt: string;
  expiresAt: string;
};

export type ManeuverPreviewEnvelopeV1 = {
  decision: "READY" | "REROUTE" | "CLARIFY" | "BLOCKED";
  previewToken?: string;
  expiresAt?: string;
  presentation?: ManeuverPreviewPresentationV1;
  rerouteTo?: ManeuverDraftKindV1;
  clarificationPrompt?: string;
  errorCode?: string;
  remaining: number;
  maxPerTurn: 2;
};

export type ManeuverCommitEnvelopeV1 = {
  accepted: true;
  action: {
    actionId: string;
    slot: ManeuverSlotV1;
    status: "PENDING" | "RESOLVED";
  };
  immediateReceipt: ManeuverImmediateReceiptV1;
  remaining: number;
  maxPerTurn: 2;
};

export class ManeuverDomainErrorV1 extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
    readonly recoverable = true,
  ) {
    super(message);
    this.name = "ManeuverDomainErrorV1";
  }
}

export class ManeuverPreviewTokenCodecV1 {
  constructor(
    private readonly secret: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (secret.length < 32) throw new Error("MANEUVER_PREVIEW_SECRET_TOO_SHORT");
  }

  sign(payload: ManeuverPreviewTokenPayloadV1): string {
    const encoded = Buffer.from(canonicalJson(payload), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.secret).update(encoded).digest("base64url");
    return `${encoded}.${signature}`;
  }

  verify(token: string): ManeuverPreviewTokenPayloadV1 {
    const [encoded, supplied, extra] = token.split(".");
    if (!encoded || !supplied || extra !== undefined) {
      throw new ManeuverDomainErrorV1("PREVIEW_TAMPERED", "The preview could not be verified.", 409);
    }
    const expected = createHmac("sha256", this.secret).update(encoded).digest();
    let received: Buffer;
    try {
      received = Buffer.from(supplied, "base64url");
    } catch {
      throw new ManeuverDomainErrorV1("PREVIEW_TAMPERED", "The preview could not be verified.", 409);
    }
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new ManeuverDomainErrorV1("PREVIEW_TAMPERED", "The preview could not be verified.", 409);
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      throw new ManeuverDomainErrorV1("PREVIEW_TAMPERED", "The preview could not be verified.", 409);
    }
    const payload = validateTokenPayload(value);
    if (new Date(payload.expiresAt).getTime() <= this.now().getTime()) {
      throw new ManeuverDomainErrorV1("PREVIEW_EXPIRED", "This preview expired before confirmation.", 410);
    }
    return payload;
  }
}

export class ManeuverEngineV1 {
  constructor(
    private readonly store: ManeuverStoreV1,
    private readonly tokens: ManeuverPreviewTokenCodecV1,
    private readonly now: () => Date = () => new Date(),
    private readonly previewTtlMs = 5 * 60 * 1000,
  ) {}

  async preview(
    userId: string,
    runId: string,
    input: { draft: unknown; expectedStateRevision: unknown },
  ): Promise<ManeuverPreviewEnvelopeV1> {
    const expectedStateRevision = revision(input?.expectedStateRevision, "expectedStateRevision");
    const draft = validateManeuverDraftV1(input?.draft);
    const context = await this.store.readContext(userId, runId);
    assertWindowOpen(context);
    if (context.stateRevision !== expectedStateRevision) {
      throw new ManeuverDomainErrorV1("REVISION_CONFLICT", "The situation changed. Refresh before previewing.", 409);
    }
    if (draft.expectedTurnRevision !== context.turnRevision) {
      throw new ManeuverDomainErrorV1("PREVIEW_STALE", "The turn changed. Refresh before previewing.", 409);
    }
    if (context.usedSlots.length >= MANEUVER_MAX_PER_TURN_V1) {
      throw new ManeuverDomainErrorV1("MANEUVER_LIMIT_REACHED", "No maneuver opportunities remain in this turn.", 409);
    }

    const result = compileManeuverV1(draft, context.compilerContext);
    const remaining = MANEUVER_MAX_PER_TURN_V1 - context.usedSlots.length;
    if (result.decision === "REROUTE") {
      return { decision: "REROUTE", rerouteTo: result.rerouteTo, clarificationPrompt: result.reason, remaining, maxPerTurn: 2 };
    }
    if (result.decision === "CLARIFY") {
      return { decision: "CLARIFY", clarificationPrompt: result.clarificationPrompt, errorCode: result.errorCode, remaining, maxPerTurn: 2 };
    }
    if (result.decision === "BLOCKED") {
      return { decision: "BLOCKED", clarificationPrompt: result.reason, errorCode: result.errorCode, remaining, maxPerTurn: 2 };
    }

    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + this.previewTtlMs);
    const payload: ManeuverPreviewTokenPayloadV1 = {
      schemaVersion: "maneuver_preview_token_v1",
      runId: context.runId,
      userId: context.userId,
      actorRoleId: context.roleId,
      actorTurnId: context.actorTurnId,
      stateRevision: context.stateRevision,
      turnRevision: context.turnRevision,
      controlEpoch: context.controlEpoch,
      slotVersion: context.usedSlots.length,
      draft,
      compiled: result.compiled,
      ...(context.compilerContext.customAnalysis
        ? { customAnalysis: validateCustomManeuverAnalysisV1(context.compilerContext.customAnalysis) }
        : {}),
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    return {
      decision: "READY",
      previewToken: this.tokens.sign(payload),
      expiresAt: payload.expiresAt,
      presentation: presentCompiledManeuverV1(result.compiled, draft.kind),
      remaining,
      maxPerTurn: 2,
    };
  }

  async commit(userId: string, runId: string, input: unknown): Promise<ManeuverCommitEnvelopeV1> {
    const command = validateManeuverCommitRequestV1(input);
    const requestHash = sha256Canonical({
      runId,
      userId,
      idempotencyKey: command.idempotencyKey,
      previewToken: command.previewToken,
      expectedStateRevision: command.expectedStateRevision,
    });

    return this.store.serializable(async (tx) => {
      const existing = await tx.findByIdempotencyKey(userId, runId, command.idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ManeuverDomainErrorV1("IDEMPOTENCY_KEY_REUSED", "The idempotency key was already used for another request.", 409, false);
        }
        return commitEnvelope(existing);
      }

      const payload = this.tokens.verify(command.previewToken);
      if (payload.runId !== runId || payload.userId !== userId) {
        throw new ManeuverDomainErrorV1("PREVIEW_TAMPERED", "This preview does not belong to the current player.", 403, false);
      }
      if (command.expectedStateRevision !== payload.stateRevision) {
        throw new ManeuverDomainErrorV1("PREVIEW_STALE", "The preview was created for another situation revision.", 409);
      }

      const context = await tx.readContext(userId, runId);
      assertWindowOpen(context);
      if (
        context.actorTurnId !== payload.actorTurnId
        || context.roleId !== payload.actorRoleId
        || context.stateRevision !== payload.stateRevision
        || context.turnRevision !== payload.turnRevision
        || context.controlEpoch !== payload.controlEpoch
      ) {
        throw new ManeuverDomainErrorV1("PREVIEW_STALE", "The situation changed before this maneuver was confirmed.", 409);
      }
      if (context.usedSlots.length !== payload.slotVersion) {
        throw new ManeuverDomainErrorV1("PREVIEW_STALE", "Another maneuver changed the available opportunities.", 409);
      }
      if (context.usedSlots.length >= MANEUVER_MAX_PER_TURN_V1) {
        throw new ManeuverDomainErrorV1("MANEUVER_LIMIT_REACHED", "No maneuver opportunities remain in this turn.", 409);
      }

      const compilerContext = {
        ...context.compilerContext,
        ...(payload.customAnalysis ? { customAnalysis: payload.customAnalysis } : {}),
      };
      const recompiled = compileManeuverV1(payload.draft, compilerContext);
      if (recompiled.decision !== "READY" || canonicalJson(recompiled.compiled) !== canonicalJson(payload.compiled)) {
        throw new ManeuverDomainErrorV1("PREVIEW_STALE", "The target, trace, leverage, or action boundary changed.", 409);
      }

      const slot = selectManeuverSlotV1(context.usedSlots);
      const immediateReceipt = immediateReceiptV1(payload.compiled);
      const created = await tx.createAction({
        userId,
        context,
        slot,
        draft: payload.draft,
        compiled: payload.compiled,
        idempotencyKey: command.idempotencyKey,
        requestHash,
        immediateReceipt,
      });
      return commitEnvelope(created);
    });
  }
}

export function selectManeuverSlotV1(usedSlots: readonly ManeuverSlotV1[]): ManeuverSlotV1 {
  if (!usedSlots.includes("MANEUVER_1")) return "MANEUVER_1";
  if (!usedSlots.includes("MANEUVER_2")) return "MANEUVER_2";
  throw new ManeuverDomainErrorV1("MANEUVER_LIMIT_REACHED", "No maneuver opportunities remain in this turn.", 409);
}

export function presentCompiledManeuverV1(
  compiled: CompiledManeuverV1,
  sourceKind: ManeuverDraftKindV1,
): ManeuverPreviewPresentationV1 {
  const visibleEffect = compiled.guaranteedStart.join(" ");
  const visibleRisk = [...compiled.contestedOutcome, ...compiled.notGuaranteed].join(" ");
  return {
    title: compiled.objective,
    description: compiled.method,
    visibleEffect,
    ...(visibleRisk ? { visibleRisk } : {}),
    confirmLabel: sourceKind === "CONTACT"
      ? "Start this conversation"
      : sourceKind === "INVESTIGATE"
        ? "Start this investigation"
        : sourceKind === "LEVERAGE"
          ? "Use this leverage"
          : "Confirm this action",
  };
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortCanonical(value));
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortCanonical(entry)]),
  );
}

function assertWindowOpen(context: AuthoritativeManeuverContextV1): void {
  if (context.windowState !== "OPEN" || context.mainlineLocked) {
    throw new ManeuverDomainErrorV1("MANEUVER_WINDOW_CLOSED", "The main decision is already being committed.", 409);
  }
}

function immediateReceiptV1(compiled: CompiledManeuverV1): ManeuverImmediateReceiptV1 {
  return {
    title: compiled.objective,
    narrative: compiled.guaranteedStart.join(" "),
    visibility: compiled.visibility,
  };
}

function commitEnvelope(action: ManeuverCommittedActionV1): ManeuverCommitEnvelopeV1 {
  return {
    accepted: true,
    action: { actionId: action.actionId, slot: action.slot, status: action.status },
    immediateReceipt: action.immediateReceipt,
    remaining: action.remaining,
    maxPerTurn: 2,
  };
}

function revision(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new ManeuverDomainErrorV1("REVISION_CONFLICT", `${path} must be a non-negative integer.`, 400, false);
  }
  return Number(value);
}

function validateTokenPayload(value: unknown): ManeuverPreviewTokenPayloadV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ManeuverDomainErrorV1("PREVIEW_TAMPERED", "The preview payload is invalid.", 409);
  }
  const raw = value as Record<string, unknown>;
  const allowed = [
    "schemaVersion", "runId", "userId", "actorRoleId", "actorTurnId", "stateRevision", "turnRevision",
    "controlEpoch", "slotVersion", "draft", "compiled", "customAnalysis", "issuedAt", "expiresAt",
  ];
  if (Object.keys(raw).some((key) => !allowed.includes(key))) {
    throw new ManeuverDomainErrorV1("PREVIEW_TAMPERED", "The preview payload contains unknown fields.", 409);
  }
  if (raw.schemaVersion !== "maneuver_preview_token_v1") {
    throw new ManeuverDomainErrorV1("PREVIEW_TAMPERED", "The preview payload version is invalid.", 409);
  }
  const requiredString = (key: string) => {
    const entry = raw[key];
    if (typeof entry !== "string" || !entry.trim()) throw new ManeuverDomainErrorV1("PREVIEW_TAMPERED", `Invalid ${key}.`, 409);
    return entry;
  };
  const payload: ManeuverPreviewTokenPayloadV1 = {
    schemaVersion: "maneuver_preview_token_v1",
    runId: requiredString("runId"),
    userId: requiredString("userId"),
    actorRoleId: requiredString("actorRoleId"),
    actorTurnId: requiredString("actorTurnId"),
    stateRevision: revision(raw.stateRevision, "stateRevision"),
    turnRevision: revision(raw.turnRevision, "turnRevision"),
    controlEpoch: revision(raw.controlEpoch, "controlEpoch"),
    slotVersion: revision(raw.slotVersion, "slotVersion"),
    draft: validateManeuverDraftV1(raw.draft),
    compiled: validateCompiled(raw.compiled),
    issuedAt: requiredString("issuedAt"),
    expiresAt: requiredString("expiresAt"),
  };
  if (raw.customAnalysis !== undefined) payload.customAnalysis = validateCustomManeuverAnalysisV1(raw.customAnalysis);
  const issuedAtMs = new Date(payload.issuedAt).getTime();
  const expiresAtMs = new Date(payload.expiresAt).getTime();
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= issuedAtMs) {
    throw new ManeuverDomainErrorV1("PREVIEW_TAMPERED", "The preview timestamps are invalid.", 409);
  }
  return payload;
}

function validateCompiled(value: unknown): CompiledManeuverV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ManeuverDomainErrorV1("PREVIEW_TAMPERED", "The compiled maneuver is invalid.", 409);
  }
  const raw = value as Record<string, unknown>;
  const allowed = [
    "schemaVersion", "kind", "actorRoleId", "targetRef", "objective", "method", "primaryEffect",
    "attachedLeverageId", "visibility", "guaranteedStart", "contestedOutcome", "notGuaranteed",
    "stateRevision", "turnRevision",
  ];
  if (Object.keys(raw).some((key) => !allowed.includes(key)) || raw.schemaVersion !== "compiled_maneuver_v1") {
    throw new ManeuverDomainErrorV1("PREVIEW_TAMPERED", "The compiled maneuver contains invalid fields.", 409);
  }
  if (!["CONVERSATION", "INVESTIGATION", "ACTION"].includes(String(raw.kind))) {
    throw new ManeuverDomainErrorV1("PREVIEW_TAMPERED", "The compiled maneuver kind is invalid.", 409);
  }
  if (!["PRIVATE", "TARGETED", "PUBLIC"].includes(String(raw.visibility))) {
    throw new ManeuverDomainErrorV1("PREVIEW_TAMPERED", "The compiled visibility is invalid.", 409);
  }
  const text = (key: string) => {
    const entry = raw[key];
    if (typeof entry !== "string" || !entry.trim()) throw new ManeuverDomainErrorV1("PREVIEW_TAMPERED", `Invalid ${key}.`, 409);
    return entry;
  };
  const textArray = (key: string) => {
    const entry = raw[key];
    if (!Array.isArray(entry) || entry.some((item) => typeof item !== "string" || !item.trim())) {
      throw new ManeuverDomainErrorV1("PREVIEW_TAMPERED", `Invalid ${key}.`, 409);
    }
    return [...entry] as string[];
  };
  return {
    schemaVersion: "compiled_maneuver_v1",
    kind: raw.kind as CompiledManeuverV1["kind"],
    actorRoleId: text("actorRoleId"),
    targetRef: text("targetRef"),
    objective: text("objective"),
    method: text("method"),
    primaryEffect: text("primaryEffect"),
    ...(raw.attachedLeverageId === undefined ? {} : { attachedLeverageId: text("attachedLeverageId") }),
    visibility: raw.visibility as CompiledManeuverV1["visibility"],
    guaranteedStart: textArray("guaranteedStart"),
    contestedOutcome: textArray("contestedOutcome"),
    notGuaranteed: textArray("notGuaranteed"),
    stateRevision: revision(raw.stateRevision, "compiled.stateRevision"),
    turnRevision: revision(raw.turnRevision, "compiled.turnRevision"),
  };
}
