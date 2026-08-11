import {
  b0ErrorCodes,
  b0IntentRelationTypes,
  b0SettlementModes,
  b0WindowStatuses,
  type B0RoomRulesetV1,
  type B0SettlementWindowV1,
} from "./b0-settlement.schemas";
import {
  fail,
  integerAtLeast,
  isRecord,
  nullableString,
  pass,
  stringArray,
  type ValidationResult,
} from "./schema-utils";
import { exactTuple, objectErrors, requireStrings } from "./b0-settlement.validation-utils";

const ROOM_FIELDS = [
  "schemaVersion", "rulesetVersion", "settlementMode", "totalWindows",
  "windowDurationSeconds", "maxHumanPlayers", "maxPrimaryIntentsPerActor",
  "readyPolicy", "missingIntentPolicy", "supportedRelations", "reactionDepth",
  "playerAuthoredDelayedEffects", "structuredCommitmentsEnabled", "allowMidGameJoin",
  "allowRoleTransfer", "allowHumanToAiTransfer", "aiFillEnabled",
  "structuredResultRequired", "narrativeFailurePolicy", "featureFlags",
] as const;

const FLAG_FIELDS = [
  "windowedSettlementEnabled", "structuredActionPreviewEnabled",
  "typedAudienceV2Enabled", "structuredResultEnabled", "narrativeAsyncEnabled",
  "reactionWindowEnabled", "structuredCommitmentEnabled",
] as const;

export function validateB0RoomRulesetV1(value: unknown): ValidationResult<B0RoomRulesetV1> {
  const errors = objectErrors(value, ROOM_FIELDS, "ruleset");
  if (!isRecord(value)) return fail(errors);
  if (value.schemaVersion !== "b0-room-ruleset-v1") errors.push("ruleset.schemaVersion is invalid");
  requireStrings(value, ["rulesetVersion"], "ruleset", errors);
  if (!b0SettlementModes.includes(value.settlementMode as never)) errors.push("ruleset.settlementMode is invalid");
  for (const [key, minimum] of [["totalWindows", 1], ["windowDurationSeconds", 1], ["maxHumanPlayers", 1]] as const) {
    if (!integerAtLeast(value[key], minimum)) errors.push(`ruleset.${key} must be >= ${minimum}`);
  }
  if (value.maxPrimaryIntentsPerActor !== 1) errors.push("ruleset.maxPrimaryIntentsPerActor must be 1");
  if (value.readyPolicy !== "ALL_READY_OR_DEADLINE") errors.push("ruleset.readyPolicy is invalid");
  if (value.missingIntentPolicy !== "LAST_CONFIRMED_OR_HOLD") errors.push("ruleset.missingIntentPolicy is invalid");
  if (!exactTuple(value.supportedRelations, b0IntentRelationTypes)) errors.push("ruleset.supportedRelations is invalid");
  if (value.reactionDepth !== 0) errors.push("ruleset.reactionDepth must be 0");
  if (!["DISABLED", "NEXT_WINDOW_ONLY"].includes(String(value.playerAuthoredDelayedEffects ?? ""))) {
    errors.push("ruleset.playerAuthoredDelayedEffects is invalid");
  }
  for (const key of ["structuredCommitmentsEnabled", "allowMidGameJoin", "allowRoleTransfer", "allowHumanToAiTransfer"] as const) {
    if (value[key] !== false) errors.push(`ruleset.${key} must be false`);
  }
  for (const key of ["aiFillEnabled", "structuredResultRequired"] as const) {
    if (value[key] !== true) errors.push(`ruleset.${key} must be true`);
  }
  if (value.narrativeFailurePolicy !== "CONTINUE_WITH_STRUCTURED_RESULT") {
    errors.push("ruleset.narrativeFailurePolicy is invalid");
  }
  validateFlags(value.featureFlags, value.settlementMode, errors);
  return errors.length ? fail(errors) : pass(value as B0RoomRulesetV1);
}

export function validateB0SettlementWindowV1(value: unknown): ValidationResult<B0SettlementWindowV1> {
  const fields = [
    "schemaVersion", "id", "roomId", "runId", "mode", "ordinal", "situationId",
    "baseWorldSequence", "expectedActorIds", "readyActorIds", "openedAt", "locksAt",
    "lockedAt", "committedAt", "completedAt", "status", "lockReason",
    "rulesetVersion", "schemaRevision",
  ] as const;
  const errors = objectErrors(value, fields, "window");
  if (!isRecord(value)) return fail(errors);
  if (value.schemaVersion !== "b0-settlement-window-v1") errors.push("window.schemaVersion is invalid");
  requireStrings(value, ["id", "roomId", "runId", "situationId", "openedAt", "rulesetVersion"], "window", errors);
  if (!b0SettlementModes.includes(value.mode as never)) errors.push("window.mode is invalid");
  if (!integerAtLeast(value.ordinal, 1)) errors.push("window.ordinal must be >= 1");
  if (!integerAtLeast(value.baseWorldSequence, 0)) errors.push("window.baseWorldSequence must be >= 0");
  if (!stringArray(value.expectedActorIds) || value.expectedActorIds.length === 0) errors.push("window.expectedActorIds must be non-empty");
  if (!stringArray(value.readyActorIds)) errors.push("window.readyActorIds must be an array");
  for (const key of ["locksAt", "lockedAt", "committedAt", "completedAt"] as const) {
    if (!nullableString(value[key])) errors.push(`window.${key} must be string|null`);
  }
  if (!b0WindowStatuses.includes(value.status as never)) errors.push("window.status is invalid");
  if (value.lockReason !== null && !["ALL_READY", "DEADLINE", "IMMEDIATE"].includes(String(value.lockReason))) {
    errors.push("window.lockReason is invalid");
  }
  if (value.schemaRevision !== 1) errors.push("window.schemaRevision must be 1");
  if (stringArray(value.expectedActorIds) && stringArray(value.readyActorIds)) {
    const expected = new Set(value.expectedActorIds);
    if (value.readyActorIds.some((id) => !expected.has(id))) errors.push("window.readyActorIds contains an unexpected actor");
    if (expected.size !== value.expectedActorIds.length || new Set(value.readyActorIds).size !== value.readyActorIds.length) {
      errors.push("window actor ids must be unique");
    }
  }
  return errors.length ? fail(errors) : pass(value as B0SettlementWindowV1);
}

export function isB0ErrorCodeV1(value: unknown): value is (typeof b0ErrorCodes)[number] {
  return typeof value === "string" && b0ErrorCodes.includes(value as never);
}

function validateFlags(value: unknown, mode: unknown, errors: string[]): void {
  errors.push(...objectErrors(value, FLAG_FIELDS, "ruleset.featureFlags"));
  if (!isRecord(value)) return;
  for (const key of FLAG_FIELDS) {
    if (typeof value[key] !== "boolean") errors.push(`ruleset.featureFlags.${key} must be boolean`);
  }
  if (value.reactionWindowEnabled !== false || value.structuredCommitmentEnabled !== false) {
    errors.push("B0 reaction/commitment flags must be false");
  }
  if (mode === "WINDOWED" && (
    value.windowedSettlementEnabled !== true
    || value.structuredResultEnabled !== true
    || value.typedAudienceV2Enabled !== true
  )) errors.push("WINDOWED requires windowed settlement, structured result and typed audience");
  if (mode === "IMMEDIATE" && value.windowedSettlementEnabled !== false) {
    errors.push("IMMEDIATE requires windowedSettlementEnabled=false");
  }
}
