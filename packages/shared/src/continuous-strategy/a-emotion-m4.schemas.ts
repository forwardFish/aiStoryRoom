import {
  fail,
  integerAtLeast,
  isRecord,
  nonEmptyString,
  onlyKeys,
  pass,
  stringArray,
  type ValidationResult
} from "./schema-utils";

export const A_EMOTION_M4_COMMAND_SCHEMA_VERSION = "a_emotion_m4_simple_promise_command_v1" as const;
export const A_EMOTION_M4_TERMS_SCHEMA_VERSION = "a_emotion_m4_simple_promise_terms_v1" as const;
export const A_EMOTION_M4_PROMISE_SCHEMA_VERSION = "a_emotion_m4_simple_promise_v1" as const;
export const A_EMOTION_M4_EVENT_TYPE = "A_EMOTION_M4_PROMISE_BROKEN" as const;
export const A_EMOTION_M4_PROMISE_BROKEN_PRIORITY = 200 as const;

export type AEmotionSimplePromiseCodeV1 =
  | "DELIVER_ORIGINAL_LEDGER"
  | "DO_NOT_PUBLICLY_BLAME"
  | "TESTIFY_FOR_TARGET";

export type AEmotionSimplePromiseStatusV1 =
  | "ACTIVE"
  | "FULFILLED"
  | "BROKEN"
  | "REVEALED"
  | "EXPIRED";

export type AEmotionPromiseObligationCodeV1 =
  | "DELIVER_ORIGINAL_DOCUMENT"
  | "AVOID_PUBLIC_BLAME"
  | "TESTIFY_FOR_TARGET";

/**
 * A promise can only be created from an already committed CONVERSATION
 * resolution. No player prose is interpreted as a formal promise.
 */
export type AEmotionSimplePromiseCommandV1 = {
  schemaVersion: typeof A_EMOTION_M4_COMMAND_SCHEMA_VERSION;
  idempotencyKey: string;
  promiseCode: AEmotionSimplePromiseCodeV1;
  targetRoleKey: string;
  expectedStage: number;
};

/** Deterministic rule terms. All matching happens on canonical codes. */
export type AEmotionSimplePromiseTermsV1 = {
  schemaVersion: typeof A_EMOTION_M4_TERMS_SCHEMA_VERSION;
  obligationCode: AEmotionPromiseObligationCodeV1;
  relatedObjectId: string | null;
  deadlineStage: number;
  fulfillActionCodes: string[];
  fulfillEffectCodes: string[];
  fulfillFactCodes: string[];
  breakActionCodes: string[];
  breakEffectCodes: string[];
  breakFactCodes: string[];
  revealEvidenceFactCodes: string[];
  expiryOutcome: "FULFILLED" | "BROKEN";
};

/** Viewer-safe promise state. Internal action and resolution payloads are absent. */
export type AEmotionSimplePromiseV1 = {
  schemaVersion: typeof A_EMOTION_M4_PROMISE_SCHEMA_VERSION;
  promiseId: string;
  roomId: string;
  runId: string;
  promiseCode: AEmotionSimplePromiseCodeV1;
  issuerRoleId: string;
  receiverRoleId: string;
  relatedObjectId: string | null;
  visibility: "LIMITED" | "PUBLIC";
  status: AEmotionSimplePromiseStatusV1;
  deadlineStage: number;
  stateVersion: number;
  brokenByActionId: string | null;
  evidenceRefs: string[];
  createdAt: string;
  fulfilledAt: string | null;
  breachedAt: string | null;
  revealedAt: string | null;
  expiredAt: string | null;
};

const COMMAND_KEYS = [
  "schemaVersion", "idempotencyKey", "promiseCode", "targetRoleKey", "expectedStage"
] as const;
const TERMS_KEYS = [
  "schemaVersion", "obligationCode", "relatedObjectId", "deadlineStage",
  "fulfillActionCodes", "fulfillEffectCodes", "fulfillFactCodes",
  "breakActionCodes", "breakEffectCodes", "breakFactCodes",
  "revealEvidenceFactCodes", "expiryOutcome"
] as const;
const PROMISE_KEYS = [
  "schemaVersion", "promiseId", "roomId", "runId", "promiseCode",
  "issuerRoleId", "receiverRoleId", "relatedObjectId", "visibility", "status",
  "deadlineStage", "stateVersion", "brokenByActionId", "evidenceRefs", "createdAt",
  "fulfilledAt", "breachedAt", "revealedAt", "expiredAt"
] as const;

const CODES = new Set<AEmotionSimplePromiseCodeV1>([
  "DELIVER_ORIGINAL_LEDGER",
  "DO_NOT_PUBLICLY_BLAME",
  "TESTIFY_FOR_TARGET"
]);
const OBLIGATIONS = new Set<AEmotionPromiseObligationCodeV1>([
  "DELIVER_ORIGINAL_DOCUMENT",
  "AVOID_PUBLIC_BLAME",
  "TESTIFY_FOR_TARGET"
]);
const STATUSES = new Set<AEmotionSimplePromiseStatusV1>([
  "ACTIVE", "FULFILLED", "BROKEN", "REVEALED", "EXPIRED"
]);
const IDEMPOTENCY = /^[A-Za-z0-9._:-]{8,160}$/u;
const OPAQUE_PROMISE_ID = /^prm_[A-Za-z0-9_-]{24,}$/u;
const RAW_ID_HINT = /(playerAction|sourceRole|targetRole|dedupe|canonical|rawAudience|run[:_-]|action[:_-])/iu;

export function validateAEmotionSimplePromiseCommandV1(value: unknown): ValidationResult<AEmotionSimplePromiseCommandV1> {
  if (!isRecord(value)) return fail(["simple promise command must be an object"]);
  const errors = onlyKeys(value, COMMAND_KEYS);
  if (value.schemaVersion !== A_EMOTION_M4_COMMAND_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!nonEmptyString(value.idempotencyKey) || !IDEMPOTENCY.test(String(value.idempotencyKey))) errors.push("idempotencyKey is invalid");
  if (!CODES.has(value.promiseCode as AEmotionSimplePromiseCodeV1)) errors.push("invalid promiseCode");
  if (!nonEmptyString(value.targetRoleKey)) errors.push("targetRoleKey is required");
  if (!integerAtLeast(value.expectedStage, 1)) errors.push("expectedStage must be >= 1");
  return errors.length ? fail(errors) : pass(value as AEmotionSimplePromiseCommandV1);
}

export function validateAEmotionSimplePromiseTermsV1(value: unknown): ValidationResult<AEmotionSimplePromiseTermsV1> {
  if (!isRecord(value)) return fail(["simple promise terms must be an object"]);
  const errors = onlyKeys(value, TERMS_KEYS);
  if (value.schemaVersion !== A_EMOTION_M4_TERMS_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!OBLIGATIONS.has(value.obligationCode as AEmotionPromiseObligationCodeV1)) errors.push("invalid obligationCode");
  if (!(value.relatedObjectId === null || nonEmptyString(value.relatedObjectId))) errors.push("relatedObjectId must be null or non-empty");
  if (!integerAtLeast(value.deadlineStage, 1)) errors.push("deadlineStage must be >= 1");
  for (const key of [
    "fulfillActionCodes", "fulfillEffectCodes", "fulfillFactCodes",
    "breakActionCodes", "breakEffectCodes", "breakFactCodes",
    "revealEvidenceFactCodes"
  ] as const) {
    if (!stringArray(value[key]) || value[key].length > 16) errors.push(`${key} must contain at most sixteen strings`);
  }
  const hasFulfillment = stringArray(value.fulfillActionCodes) && value.fulfillActionCodes.length > 0
    || stringArray(value.fulfillEffectCodes) && value.fulfillEffectCodes.length > 0
    || stringArray(value.fulfillFactCodes) && value.fulfillFactCodes.length > 0;
  const hasBreach = stringArray(value.breakActionCodes) && value.breakActionCodes.length > 0
    || stringArray(value.breakEffectCodes) && value.breakEffectCodes.length > 0
    || stringArray(value.breakFactCodes) && value.breakFactCodes.length > 0;
  if (!hasFulfillment) errors.push("promise terms require at least one fulfillment code");
  if (!hasBreach) errors.push("promise terms require at least one breach code");
  if (!stringArray(value.revealEvidenceFactCodes) || value.revealEvidenceFactCodes.length < 1) errors.push("revealEvidenceFactCodes requires evidence codes");
  if (!(value.expiryOutcome === "FULFILLED" || value.expiryOutcome === "BROKEN")) errors.push("invalid expiryOutcome");
  return errors.length ? fail(errors) : pass(value as AEmotionSimplePromiseTermsV1);
}

export function validateAEmotionSimplePromiseV1(value: unknown): ValidationResult<AEmotionSimplePromiseV1> {
  if (!isRecord(value)) return fail(["simple promise must be an object"]);
  const errors = onlyKeys(value, PROMISE_KEYS);
  if (value.schemaVersion !== A_EMOTION_M4_PROMISE_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!nonEmptyString(value.promiseId) || !OPAQUE_PROMISE_ID.test(String(value.promiseId)) || RAW_ID_HINT.test(String(value.promiseId))) errors.push("promiseId must be opaque");
  for (const key of ["roomId", "runId", "issuerRoleId", "receiverRoleId"] as const) if (!nonEmptyString(value[key])) errors.push(`${key} is required`);
  if (value.roomId !== value.runId) errors.push("roomId and runId must match");
  if (value.issuerRoleId === value.receiverRoleId) errors.push("issuerRoleId and receiverRoleId must differ");
  if (!CODES.has(value.promiseCode as AEmotionSimplePromiseCodeV1)) errors.push("invalid promiseCode");
  if (!(value.relatedObjectId === null || nonEmptyString(value.relatedObjectId))) errors.push("relatedObjectId must be null or non-empty");
  if (!(value.visibility === "LIMITED" || value.visibility === "PUBLIC")) errors.push("invalid visibility");
  if (!STATUSES.has(value.status as AEmotionSimplePromiseStatusV1)) errors.push("invalid status");
  if (!integerAtLeast(value.deadlineStage, 1)) errors.push("deadlineStage must be >= 1");
  if (!integerAtLeast(value.stateVersion, 1)) errors.push("stateVersion must be >= 1");
  if (!(value.brokenByActionId === null || nonEmptyString(value.brokenByActionId))) errors.push("brokenByActionId must be null or non-empty");
  const evidenceRefs = stringArray(value.evidenceRefs) ? value.evidenceRefs : [];
  if (!stringArray(value.evidenceRefs) || evidenceRefs.length > 12) errors.push("evidenceRefs must contain at most twelve strings");
  for (const key of ["createdAt", "fulfilledAt", "breachedAt", "revealedAt", "expiredAt"] as const) {
    const item = value[key];
    if (key === "createdAt") {
      if (!isIsoDate(item)) errors.push("createdAt must be an ISO date");
    } else if (!(item === null || isIsoDate(item))) errors.push(`${key} must be null or an ISO date`);
  }
  if (value.status === "FULFILLED" && value.fulfilledAt === null) errors.push("FULFILLED requires fulfilledAt");
  if ((value.status === "BROKEN" || value.status === "REVEALED") && (!value.brokenByActionId || value.breachedAt === null)) errors.push("broken promise requires action and breachedAt");
  if (value.status === "REVEALED" && (!evidenceRefs.length || value.revealedAt === null)) errors.push("REVEALED requires evidence and revealedAt");
  return errors.length ? fail(errors) : pass(value as AEmotionSimplePromiseV1);
}

function isIsoDate(value: unknown): value is string {
  return nonEmptyString(value) && !Number.isNaN(Date.parse(value));
}
