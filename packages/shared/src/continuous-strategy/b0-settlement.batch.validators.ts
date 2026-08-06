import {
  b0BatchStatuses,
  type B0SettlementBatchV1,
  type B0SettlementSnapshotV1,
  type B0TypedAudienceSpecV1,
} from "./b0-settlement.schemas";
import {
  fail,
  integerAtLeast,
  isRecord,
  nonEmptyString,
  nullableString,
  pass,
  stringArray,
  type ValidationResult,
} from "./schema-utils";
import { objectErrors, requireStrings } from "./b0-settlement.validation-utils";

export function validateB0SettlementSnapshotV1(value: unknown): ValidationResult<B0SettlementSnapshotV1> {
  const fields = [
    "schemaVersion", "id", "windowId", "roomId", "runId", "baseWorldSequence",
    "rulesetVersion", "rulesetHash", "worldState", "actorStates", "roleBindings",
    "knowledgeState", "relationshipState", "resourceState", "activeCapabilities",
    "dueSystemIntents", "worldStateHash", "roleSetHash", "knowledgeStateHash",
    "relationshipStateHash", "createdAt",
  ] as const;
  const errors = objectErrors(value, fields, "snapshot");
  if (!isRecord(value)) return fail(errors);
  if (value.schemaVersion !== "b0-settlement-snapshot-v1") errors.push("snapshot.schemaVersion is invalid");
  requireStrings(value, [
    "id", "windowId", "roomId", "runId", "rulesetVersion", "rulesetHash",
    "worldStateHash", "roleSetHash", "knowledgeStateHash", "relationshipStateHash", "createdAt",
  ], "snapshot", errors);
  if (!integerAtLeast(value.baseWorldSequence, 0)) errors.push("snapshot.baseWorldSequence must be >= 0");
  for (const key of ["actorStates", "roleBindings", "activeCapabilities", "dueSystemIntents"] as const) {
    if (!Array.isArray(value[key])) errors.push(`snapshot.${key} must be an array`);
  }
  return errors.length ? fail(errors) : pass(value as B0SettlementSnapshotV1);
}

export function validateB0SettlementBatchV1(value: unknown): ValidationResult<B0SettlementBatchV1> {
  const fields = [
    "schemaVersion", "id", "windowId", "snapshotId", "roomId", "runId",
    "baseWorldSequence", "lockedIntentIds", "dueSystemIntentIds", "status", "attempt",
    "inputHash", "relationGraphHash", "resolutionHash", "createdAt", "resolvedAt",
    "committedAt", "completedAt",
  ] as const;
  const errors = objectErrors(value, fields, "batch");
  if (!isRecord(value)) return fail(errors);
  if (value.schemaVersion !== "b0-settlement-batch-v1") errors.push("batch.schemaVersion is invalid");
  requireStrings(value, ["id", "windowId", "snapshotId", "roomId", "runId", "inputHash", "createdAt"], "batch", errors);
  if (!integerAtLeast(value.baseWorldSequence, 0) || !integerAtLeast(value.attempt, 0)) errors.push("batch sequence/attempt is invalid");
  if (!stringArray(value.lockedIntentIds) || value.lockedIntentIds.length === 0) errors.push("batch.lockedIntentIds must be non-empty");
  if (!stringArray(value.dueSystemIntentIds) || !b0BatchStatuses.includes(value.status as never)) errors.push("batch due intents/status is invalid");
  for (const key of ["relationGraphHash", "resolutionHash", "resolvedAt", "committedAt", "completedAt"] as const) {
    if (!nullableString(value[key])) errors.push(`batch.${key} must be string|null`);
  }
  return errors.length ? fail(errors) : pass(value as B0SettlementBatchV1);
}

export function validateB0TypedAudienceSpecV1(value: unknown): ValidationResult<B0TypedAudienceSpecV1> {
  const allowed: Record<string, readonly string[]> = {
    PUBLIC: ["type"],
    ACTOR_ONLY: ["type", "actorRef"],
    DIRECT_TARGETS: ["type", "originIntentId"],
    OBSERVERS_OF_TRACE: ["type", "traceId"],
    RELATION_PARTICIPANTS: ["type", "relationId"],
    ROLE_SET: ["type", "roleSetId"],
    CONDITION_BASED: ["type", "conditionId"],
  };
  if (!isRecord(value) || typeof value.type !== "string" || !allowed[value.type]) {
    return fail(["typed audience.type is invalid"]);
  }
  const errors = objectErrors(value, allowed[value.type], "typed audience");
  const required: Record<string, string> = {
    ACTOR_ONLY: "actorRef",
    DIRECT_TARGETS: "originIntentId",
    OBSERVERS_OF_TRACE: "traceId",
    RELATION_PARTICIPANTS: "relationId",
    ROLE_SET: "roleSetId",
    CONDITION_BASED: "conditionId",
  };
  const field = required[value.type];
  if (field && !nonEmptyString(value[field])) errors.push(`typed audience.${field} is required`);
  return errors.length ? fail(errors) : pass(value as B0TypedAudienceSpecV1);
}
