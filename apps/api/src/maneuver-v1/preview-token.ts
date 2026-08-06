import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type {
  ActionPreviewPresentationV1,
  CompiledManeuverActionV1,
  ManeuverDraftV1,
} from "@ai-story/templates";

export interface ManeuverPreviewTokenPayloadV1 {
  schemaVersion: "maneuver_preview_token_v1";
  previewId: string;
  runId: string;
  actorTurnId: string;
  turnVersion: number;
  stateRevision: number;
  maneuverWindowVersion: number;
  controlEpoch: number;
  contextHash: string;
  requestHash: string;
  previewIdempotencyKey: string;
  expiresAt: string;
  draft: ManeuverDraftV1;
  compiledAction: CompiledManeuverActionV1;
  presentation: ActionPreviewPresentationV1;
}

const LOCAL_PREVIEW_SECRET = "local-development-maneuver-preview-secret-change-me";

function secret(): string {
  const configured = String(process.env.MANEUVER_PREVIEW_SECRET || "").trim();
  if (configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") {
    throw previewTokenError(
      "MANEUVER_PREVIEW_SECRET_REQUIRED",
      "MANEUVER_PREVIEW_SECRET must contain at least 32 characters in production.",
    );
  }
  return LOCAL_PREVIEW_SECRET;
}

function encryptionKey(): Buffer {
  return createHash("sha256").update(secret(), "utf8").digest();
}

const TOKEN_AAD = Buffer.from("maneuver-preview-token-v1", "utf8");

export function signManeuverPreviewTokenV1(payload: ManeuverPreviewTokenPayloadV1): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(TOKEN_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${tag.toString("base64url")}`;
}

export function verifyManeuverPreviewTokenV1(
  token: unknown,
  now = Date.now(),
): ManeuverPreviewTokenPayloadV1 {
  if (typeof token !== "string" || token.length < 40 || token.length > 64_000) {
    throw previewTokenError("ACTION_PREVIEW_TOKEN_INVALID", "行动预演凭证无效，请重新预演。");
  }
  const [version, ivText, ciphertextText, tagText, extra] = token.split(".");
  if (version !== "v1" || !ivText || !ciphertextText || !tagText || extra) {
    throw previewTokenError("ACTION_PREVIEW_TOKEN_INVALID", "行动预演凭证格式无效，请重新预演。");
  }

  let payload: ManeuverPreviewTokenPayloadV1;
  try {
    const iv = Buffer.from(ivText, "base64url");
    const ciphertext = Buffer.from(ciphertextText, "base64url");
    const tag = Buffer.from(tagText, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error("invalid token lengths");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAAD(TOKEN_AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    payload = JSON.parse(plaintext) as ManeuverPreviewTokenPayloadV1;
  } catch {
    throw previewTokenError("ACTION_PREVIEW_TOKEN_INVALID", "行动预演凭证签名无效，请重新预演。");
  }

  if (payload?.schemaVersion !== "maneuver_preview_token_v1"
      || !nonEmpty(payload.previewId)
      || !nonEmpty(payload.runId)
      || !nonEmpty(payload.actorTurnId)
      || !Number.isInteger(payload.turnVersion)
      || !Number.isInteger(payload.stateRevision)
      || !Number.isInteger(payload.maneuverWindowVersion)
      || !Number.isInteger(payload.controlEpoch)
      || !isSha256(payload.contextHash)
      || !isSha256(payload.requestHash)
      || !nonEmpty(payload.previewIdempotencyKey)
      || !nonEmpty(payload.expiresAt)
      || !payload.draft
      || !payload.compiledAction
      || !payload.presentation) {
    throw previewTokenError("ACTION_PREVIEW_TOKEN_INVALID", "行动预演凭证缺少必要字段，请重新预演。");
  }

  const expiry = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now) {
    throw previewTokenError("ACTION_PREVIEW_EXPIRED", "行动预演已经过期，请根据当前局势重新预演。");
  }
  return payload;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function previewTokenError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}
