import { fail, integerAtLeast, isRecord, nonEmptyString, onlyKeys, pass, type ValidationResult } from "./schema-utils";

export const A_EMOTION_M6_POLICY_SCHEMA_VERSION = "a_emotion_m6_recovery_policy_v1" as const;
export const A_EMOTION_M6_FROZEN_FLAGS_SCHEMA_VERSION = "a_emotion_m6_frozen_flags_v1" as const;
export const A_EMOTION_M6_RECOVERY_RESULT_SCHEMA_VERSION = "a_emotion_m6_recovery_result_v1" as const;
export const A_EMOTION_M6_BOUNDARY_SCHEMA_VERSION = "a_emotion_m6_boundary_v1" as const;
export const A_EMOTION_M6_ROOM_POLICY_SCHEMA_VERSION = "a_emotion_m6_room_policy_v1" as const;
export const A_EMOTION_M6_PAUSE_STATE_SCHEMA_VERSION = "a_emotion_m6_pause_state_v1" as const;
export const A_EMOTION_M6_VIEWER_STATE_SCHEMA_VERSION = "a_emotion_m6_viewer_state_v1" as const;

export type AEmotionM6FrozenFlagsV1 = {
  schemaVersion: typeof A_EMOTION_M6_FROZEN_FLAGS_SCHEMA_VERSION;
  aEmotionEnabled: boolean;
  situationFeedEnabled: boolean;
  crossImpactCardEnabled: boolean;
  keyModalsEnabled: boolean;
  simplePromiseEnabled: boolean;
  interactionHistoryEnabled: boolean;
  recoveryEnabled: boolean;
  pollIntervalMs: number;
};
export type AEmotionM6RoomPolicyV1 = { schemaVersion: typeof A_EMOTION_M6_ROOM_POLICY_SCHEMA_VERSION; rulesetVersion: "a-emotion-v1"; frozenAt: string; flags: AEmotionM6FrozenFlagsV1 };
export type AEmotionM6PauseStateV1 = { schemaVersion: typeof A_EMOTION_M6_PAUSE_STATE_SCHEMA_VERSION; version: number; paused: boolean; reason: string; changedAt: string };
export type AEmotionM6ViewerStateV1 = { schemaVersion: typeof A_EMOTION_M6_VIEWER_STATE_SCHEMA_VERSION; features: AEmotionM6FrozenFlagsV1; paused: boolean; pauseVersion: number };
export type AEmotionM6RecoveryPolicyV1 = { schemaVersion: typeof A_EMOTION_M6_POLICY_SCHEMA_VERSION; maxAttempts: number; leaseMs: number; retryBaseMs: number; deadlineMs: number; deadLetterAfterAttempts: number; failClosed: true };
export type AEmotionM6RecoveryResultV1 = { schemaVersion: typeof A_EMOTION_M6_RECOVERY_RESULT_SCHEMA_VERSION; recoveredExpiredLeases: number; recoveredLegacyLeases: number; deadLetteredTasks: number; leftCompletedUntouched: number; recoveredAt: string };
export type AEmotionM6BoundaryV1 = { schemaVersion: typeof A_EMOTION_M6_BOUNDARY_SCHEMA_VERSION; roomId: string; runId: string; userId: string; roleId: string; runVersion: number; projectionVersion: number; stateVersion: number };

const FLAG_KEYS = ["schemaVersion", "aEmotionEnabled", "situationFeedEnabled", "crossImpactCardEnabled", "keyModalsEnabled", "simplePromiseEnabled", "interactionHistoryEnabled", "recoveryEnabled", "pollIntervalMs"] as const;
const POLICY_KEYS = ["schemaVersion", "maxAttempts", "leaseMs", "retryBaseMs", "deadlineMs", "deadLetterAfterAttempts", "failClosed"] as const;
const RESULT_KEYS = ["schemaVersion", "recoveredExpiredLeases", "recoveredLegacyLeases", "deadLetteredTasks", "leftCompletedUntouched", "recoveredAt"] as const;
const BOUNDARY_KEYS = ["schemaVersion", "roomId", "runId", "userId", "roleId", "runVersion", "projectionVersion", "stateVersion"] as const;
const ROOM_POLICY_KEYS = ["schemaVersion", "rulesetVersion", "frozenAt", "flags"] as const;
const PAUSE_KEYS = ["schemaVersion", "version", "paused", "reason", "changedAt"] as const;
const VIEWER_KEYS = ["schemaVersion", "features", "paused", "pauseVersion"] as const;

export function validateAEmotionM6FrozenFlagsV1(value: unknown): ValidationResult<AEmotionM6FrozenFlagsV1> {
  if (!isRecord(value)) return fail(["M6 frozen flags must be an object"]);
  const errors = onlyKeys(value, FLAG_KEYS);
  if (value.schemaVersion !== A_EMOTION_M6_FROZEN_FLAGS_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  for (const key of ["aEmotionEnabled", "situationFeedEnabled", "crossImpactCardEnabled", "keyModalsEnabled", "simplePromiseEnabled", "interactionHistoryEnabled", "recoveryEnabled"] as const) if (typeof value[key] !== "boolean") errors.push(`${key} must be boolean`);
  if (!Number.isInteger(value.pollIntervalMs) || Number(value.pollIntervalMs) < 3_000 || Number(value.pollIntervalMs) > 30_000) errors.push("pollIntervalMs must be between 3000 and 30000");
  if (value.aEmotionEnabled === false) for (const key of ["situationFeedEnabled", "crossImpactCardEnabled", "keyModalsEnabled", "simplePromiseEnabled", "interactionHistoryEnabled", "recoveryEnabled"] as const) if (value[key] === true) errors.push(`${key} cannot be enabled when aEmotionEnabled is false`);
  if (value.situationFeedEnabled === false && (value.crossImpactCardEnabled === true || value.keyModalsEnabled === true || value.interactionHistoryEnabled === true)) errors.push("feed-dependent capabilities require situationFeedEnabled");
  return errors.length ? fail(errors) : pass(value as AEmotionM6FrozenFlagsV1);
}
export function validateAEmotionM6RecoveryPolicyV1(value: unknown): ValidationResult<AEmotionM6RecoveryPolicyV1> {
  if (!isRecord(value)) return fail(["M6 recovery policy must be an object"]);
  const errors = onlyKeys(value, POLICY_KEYS);
  if (value.schemaVersion !== A_EMOTION_M6_POLICY_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!integerAtLeast(value.maxAttempts, 1) || Number(value.maxAttempts) > 20) errors.push("maxAttempts must be 1..20");
  if (!integerAtLeast(value.leaseMs, 5_000) || Number(value.leaseMs) > 1_800_000) errors.push("leaseMs must be 5000..1800000");
  if (!integerAtLeast(value.retryBaseMs, 100) || Number(value.retryBaseMs) > 60_000) errors.push("retryBaseMs must be 100..60000");
  if (!integerAtLeast(value.deadlineMs, 10_000) || Number(value.deadlineMs) > 86_400_000) errors.push("deadlineMs must be 10000..86400000");
  if (!integerAtLeast(value.deadLetterAfterAttempts, 1) || Number(value.deadLetterAfterAttempts) < Number(value.maxAttempts)) errors.push("deadLetterAfterAttempts must be >= maxAttempts");
  if (value.failClosed !== true) errors.push("failClosed must be true");
  return errors.length ? fail(errors) : pass(value as AEmotionM6RecoveryPolicyV1);
}
export function validateAEmotionM6RecoveryResultV1(value: unknown): ValidationResult<AEmotionM6RecoveryResultV1> {
  if (!isRecord(value)) return fail(["M6 recovery result must be an object"]);
  const errors = onlyKeys(value, RESULT_KEYS);
  if (value.schemaVersion !== A_EMOTION_M6_RECOVERY_RESULT_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  for (const key of ["recoveredExpiredLeases", "recoveredLegacyLeases", "deadLetteredTasks", "leftCompletedUntouched"] as const) if (!integerAtLeast(value[key], 0)) errors.push(`${key} must be >= 0`);
  if (!iso(value.recoveredAt)) errors.push("recoveredAt must be an ISO date");
  return errors.length ? fail(errors) : pass(value as AEmotionM6RecoveryResultV1);
}
export function validateAEmotionM6BoundaryV1(value: unknown): ValidationResult<AEmotionM6BoundaryV1> {
  if (!isRecord(value)) return fail(["M6 boundary must be an object"]);
  const errors = onlyKeys(value, BOUNDARY_KEYS);
  if (value.schemaVersion !== A_EMOTION_M6_BOUNDARY_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  for (const key of ["roomId", "runId", "userId", "roleId"] as const) if (!nonEmptyString(value[key])) errors.push(`${key} is required`);
  if (value.roomId !== value.runId) errors.push("roomId and runId must match");
  for (const key of ["runVersion", "projectionVersion", "stateVersion"] as const) if (!integerAtLeast(value[key], 1)) errors.push(`${key} must be >= 1`);
  return errors.length ? fail(errors) : pass(value as AEmotionM6BoundaryV1);
}
export function validateAEmotionM6RoomPolicyV1(value: unknown): ValidationResult<AEmotionM6RoomPolicyV1> {
  if (!isRecord(value)) return fail(["M6 room policy must be an object"]);
  const errors = onlyKeys(value, ROOM_POLICY_KEYS);
  if (value.schemaVersion !== A_EMOTION_M6_ROOM_POLICY_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (value.rulesetVersion !== "a-emotion-v1") errors.push("invalid rulesetVersion");
  if (!iso(value.frozenAt)) errors.push("frozenAt must be an ISO date");
  const flags = validateAEmotionM6FrozenFlagsV1(value.flags); if (!flags.ok) errors.push(...flags.errors.map((error) => `flags: ${error}`));
  return errors.length ? fail(errors) : pass(value as AEmotionM6RoomPolicyV1);
}
export function validateAEmotionM6PauseStateV1(value: unknown): ValidationResult<AEmotionM6PauseStateV1> {
  if (!isRecord(value)) return fail(["M6 pause state must be an object"]);
  const errors = onlyKeys(value, PAUSE_KEYS);
  if (value.schemaVersion !== A_EMOTION_M6_PAUSE_STATE_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!integerAtLeast(value.version, 0)) errors.push("version must be >= 0");
  if (typeof value.paused !== "boolean") errors.push("paused must be boolean");
  if (typeof value.reason !== "string") errors.push("reason must be a string");
  if (value.paused === true && !nonEmptyString(value.reason)) errors.push("paused state requires a reason");
  if (!iso(value.changedAt)) errors.push("changedAt must be an ISO date");
  return errors.length ? fail(errors) : pass(value as AEmotionM6PauseStateV1);
}
export function validateAEmotionM6ViewerStateV1(value: unknown): ValidationResult<AEmotionM6ViewerStateV1> {
  if (!isRecord(value)) return fail(["M6 viewer state must be an object"]);
  const errors = onlyKeys(value, VIEWER_KEYS);
  if (value.schemaVersion !== A_EMOTION_M6_VIEWER_STATE_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  const flags = validateAEmotionM6FrozenFlagsV1(value.features); if (!flags.ok) errors.push(...flags.errors.map((error) => `features: ${error}`));
  if (typeof value.paused !== "boolean") errors.push("paused must be boolean");
  if (!integerAtLeast(value.pauseVersion, 0)) errors.push("pauseVersion must be >= 0");
  return errors.length ? fail(errors) : pass(value as AEmotionM6ViewerStateV1);
}
function iso(value: unknown) { return nonEmptyString(value) && !Number.isNaN(Date.parse(String(value))); }
