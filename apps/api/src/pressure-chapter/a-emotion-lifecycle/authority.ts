import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  isSha256,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  PRESSURE_A_EMOTION_LIFECYCLE_AUTHORITY_SCHEMA_V1,
  type PressureAEmotionLifecycleAuthorityV1,
} from "./contracts";
import {
  A_EMOTION_LIFECYCLE_ERROR_CODES_V1 as ERROR,
  failAEmotionLifecycle,
} from "./errors";

const AUTHORITY_KEYS = new Set([
  "schemaVersion", "sourceKind", "sourceId", "sourceCommitHash", "runId",
  "stageId", "sourceActionId", "sourceSeatId", "actionCodes",
  "effectCodes", "factCodes", "evidenceRefs", "committedAt",
]);
const SOURCE_KINDS = new Set([
  "BEAT_COMMITTED",
  "FORMAL_COMMITMENT_COMMITTED",
  "CHAPTER_SETTLEMENT_COMMITTED",
  "FINALE_COMMITTED",
]);
const SEATS = new Set<string>(PRESSURE_CHAPTER_SEAT_IDS_V1);
const FORBIDDEN_KEYS = /(?:provider|prompt|narrative|completion|model|rawText|rawPayload|authorityWriter|repository)/iu;

export function validatePressureLifecycleAuthorityV1(
  value: unknown,
): PressureAEmotionLifecycleAuthorityV1 {
  const row = record(value, "authority");
  for (const key of Object.keys(row)) {
    if (FORBIDDEN_KEYS.test(key)) failAEmotionLifecycle(ERROR.FORBIDDEN_INPUT, `authority.${key}`);
    if (!AUTHORITY_KEYS.has(key)) failAEmotionLifecycle(ERROR.INVALID_AUTHORITY, `authority.${key}`, "UNKNOWN_FIELD");
  }
  if (row.schemaVersion !== PRESSURE_A_EMOTION_LIFECYCLE_AUTHORITY_SCHEMA_V1) {
    failAEmotionLifecycle(ERROR.INVALID_AUTHORITY, "authority.schemaVersion");
  }
  if (!SOURCE_KINDS.has(String(row.sourceKind))) failAEmotionLifecycle(ERROR.INVALID_AUTHORITY, "authority.sourceKind");
  for (const key of ["sourceId", "runId", "stageId", "sourceActionId"] as const) {
    if (!text(row[key])) failAEmotionLifecycle(ERROR.INVALID_AUTHORITY, `authority.${key}`);
  }
  if (!isSha256(row.sourceCommitHash)) failAEmotionLifecycle(ERROR.INVALID_AUTHORITY, "authority.sourceCommitHash");
  if (!SEATS.has(String(row.sourceSeatId))) failAEmotionLifecycle(ERROR.INVALID_AUTHORITY, "authority.sourceSeatId");
  for (const key of ["actionCodes", "effectCodes", "factCodes", "evidenceRefs"] as const) {
    validateCodes(row[key], `authority.${key}`);
  }
  if (!timestamp(row.committedAt)) failAEmotionLifecycle(ERROR.INVALID_AUTHORITY, "authority.committedAt");
  return structuredClone(row) as unknown as PressureAEmotionLifecycleAuthorityV1;
}

export function isPressureSeatId(value: unknown): value is SeatIdV1 {
  return typeof value === "string" && SEATS.has(value);
}

export function uniqueCodes(value: readonly string[]): string[] {
  return [...new Set(value)].sort((left, right) => left.localeCompare(right, "en"));
}

function validateCodes(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length > 32 || value.some((item) => !text(item))) {
    failAEmotionLifecycle(ERROR.INVALID_AUTHORITY, path);
  }
  if (new Set(value).size !== value.length) failAEmotionLifecycle(ERROR.INVALID_AUTHORITY, path, "DUPLICATE");
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failAEmotionLifecycle(ERROR.INVALID_AUTHORITY, path);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): value is string {
  return typeof value === "string" && /\S/u.test(value) && value.length <= 240;
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
