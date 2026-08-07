import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { OpenNovelManeuverCommand } from "./openovel-maneuver";

export const OPENOVEL_MANEUVER_PREVIEW_SCHEMA = "openovel_maneuver_preview_v1" as const;

export type OpenNovelManeuverPreviewPayload = {
  schemaVersion: typeof OPENOVEL_MANEUVER_PREVIEW_SCHEMA;
  previewId: string;
  runId: string;
  userId: string;
  worldId: string;
  roleKey: string;
  expectedVersion: number;
  expectedTurnNumber: number;
  sceneKey: string;
  idempotencyKey: string;
  requestFingerprint: string;
  command: OpenNovelManeuverCommand;
  issuedAt: string;
  expiresAt: string;
};

export type OpenNovelManeuverPreviewCard = {
  previewId: string;
  maneuverType: string;
  decisionForm: string;
  sceneKey: string;
  usageDay: number;
  title: string;
  summary: string;
  targetLabel: string | null;
  costLabel: string;
  confirmLabel: string;
  expiresAt: string;
};

export function issueOpenNovelManeuverPreview(input: Omit<
  OpenNovelManeuverPreviewPayload,
  "schemaVersion" | "previewId" | "issuedAt" | "expiresAt"
>) {
  const issuedAtMs = Date.now();
  const payload: OpenNovelManeuverPreviewPayload = {
    schemaVersion: OPENOVEL_MANEUVER_PREVIEW_SCHEMA,
    previewId: `ovl_preview_${randomUUID()}`,
    ...structuredClone(input),
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(issuedAtMs + previewTtlMs()).toISOString(),
  };
  const encoded = encodePayload(payload);
  return {
    previewToken: `${encoded}.${signature(encoded)}`,
    payload,
  };
}

export function verifyOpenNovelManeuverPreview(tokenValue: unknown) {
  const token = String(tokenValue || "").trim();
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra !== undefined) {
    throw previewError("MANEUVER_PREVIEW_TOKEN_INVALID");
  }
  const expectedSignature = signature(encoded);
  if (!safeEqual(expectedSignature, suppliedSignature)) {
    throw previewError("MANEUVER_PREVIEW_TOKEN_TAMPERED");
  }
  let payload: OpenNovelManeuverPreviewPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw previewError("MANEUVER_PREVIEW_TOKEN_INVALID");
  }
  validatePayload(payload);
  if (Date.parse(payload.expiresAt) <= Date.now()) {
    throw previewError("MANEUVER_PREVIEW_EXPIRED");
  }
  return payload;
}

export function normalizePreviewCommand(
  command: OpenNovelManeuverCommand,
  version: number,
  idempotencyKey: string,
): OpenNovelManeuverCommand {
  const maneuverType = clean(command.maneuverType);
  const normalized: OpenNovelManeuverCommand = {
    version,
    idempotencyKey,
    maneuverType,
  };
  if (maneuverType === "contact") {
    normalized.targetRoleKey = clean(command.targetRoleKey);
    normalized.messageText = clean(command.messageText);
  } else if (maneuverType === "investigate") {
    normalized.intentKey = clean(command.intentKey);
  } else if (maneuverType === "leverage") {
    normalized.leverageKey = clean(command.leverageKey);
    const targetRoleKey = clean(command.targetRoleKey);
    if (targetRoleKey) normalized.targetRoleKey = targetRoleKey;
  } else if (maneuverType === "custom") {
    normalized.customText = clean(command.customText);
  }
  return normalized;
}

function validatePayload(value: unknown): asserts value is OpenNovelManeuverPreviewPayload {
  const payload = record(value);
  if (
    payload.schemaVersion !== OPENOVEL_MANEUVER_PREVIEW_SCHEMA
    || !clean(payload.previewId)
    || !clean(payload.runId)
    || !clean(payload.userId)
    || !clean(payload.worldId)
    || !clean(payload.roleKey)
    || !Number.isInteger(Number(payload.expectedVersion))
    || !Number.isInteger(Number(payload.expectedTurnNumber))
    || !clean(payload.sceneKey)
    || !clean(payload.idempotencyKey)
    || !clean(payload.requestFingerprint)
    || !record(payload.command).maneuverType
    || !Number.isFinite(Date.parse(clean(payload.issuedAt)))
    || !Number.isFinite(Date.parse(clean(payload.expiresAt)))
  ) {
    throw previewError("MANEUVER_PREVIEW_TOKEN_INVALID");
  }
}

function encodePayload(payload: OpenNovelManeuverPreviewPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function signature(encodedPayload: string) {
  return createHmac("sha256", previewSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function previewSecret() {
  const secret = String(
    process.env.OPENOVEL_MANEUVER_PREVIEW_SECRET
    || process.env.AUTH_TOKEN_SECRET
    || "",
  ).trim();
  if (secret.length >= 24) return secret;
  if (process.env.NODE_ENV !== "production") {
    return "openovel-maneuver-preview-development-secret-v1";
  }
  throw new Error("OPENOVEL_MANEUVER_PREVIEW_SECRET_REQUIRED");
}

function previewTtlMs() {
  const configured = Number(process.env.OPENOVEL_MANEUVER_PREVIEW_TTL_MS || 0);
  if (!Number.isFinite(configured) || configured <= 0) return 5 * 60_000;
  return Math.max(30_000, Math.min(configured, 10 * 60_000));
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

function previewError(code: string) {
  return Object.assign(new Error(code), { code });
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function clean(value: unknown) {
  return String(value || "").trim();
}
