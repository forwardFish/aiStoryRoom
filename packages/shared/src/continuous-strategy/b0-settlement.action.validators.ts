import {
  b0IntentKinds,
  b0IntentStatuses,
  type B0ActionContractV1,
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
import {
  objectErrors,
  requireStrings,
  validateArrayObjects,
  validateObject,
} from "./b0-settlement.validation-utils";

export function validateB0ActionContractV1(value: unknown): ValidationResult<B0ActionContractV1> {
  const fields = [
    "schemaVersion", "id", "windowId", "roomId", "runId", "actorId",
    "baseWorldSequence", "revision", "kind", "rawPlayerText", "normalizedSummary",
    "targetRefs", "primaryEffect", "method", "resourceCommitments", "evidenceRefs",
    "capabilityRefs", "propositionRefs", "visibilityIntent", "reactionPolicy",
    "requestedTiming", "riskTags", "compilerVersion", "validationVersion",
    "clientRequestId", "status", "createdAt", "updatedAt", "confirmedAt", "lockedAt",
  ] as const;
  const errors = objectErrors(value, fields, "action");
  if (!isRecord(value)) return fail(errors);
  if (value.schemaVersion !== "b0-action-contract-v1") errors.push("action.schemaVersion is invalid");
  requireStrings(value, [
    "id", "windowId", "roomId", "runId", "actorId", "rawPlayerText",
    "normalizedSummary", "compilerVersion", "validationVersion", "clientRequestId",
    "createdAt", "updatedAt",
  ], "action", errors);
  if (!integerAtLeast(value.baseWorldSequence, 0) || !integerAtLeast(value.revision, 1)) {
    errors.push("action sequence/revision is invalid");
  }
  if (!b0IntentKinds.includes(value.kind as never) || !b0IntentStatuses.includes(value.status as never)) {
    errors.push("action kind/status is invalid");
  }
  validateArrayObjects(value.targetRefs, ["type", "id"], "action.targetRefs", errors, (entry, path) => {
    if (!["ACTOR", "GROUP", "LOCATION", "RESOURCE", "PROPOSITION", "EVIDENCE", "CAPABILITY"].includes(String(entry.type ?? ""))) {
      errors.push(`${path}.type is invalid`);
    }
    if (!nonEmptyString(entry.id)) errors.push(`${path}.id is required`);
  });
  validateObject(value.primaryEffect, ["effectTypeId", "direction", "requestedMagnitude"], "action.primaryEffect", errors, (entry, path) => {
    if (!nonEmptyString(entry.effectTypeId)) errors.push(`${path}.effectTypeId is required`);
    if (!["INCREASE", "DECREASE", "CREATE", "BLOCK", "PROTECT", "REVEAL", "CONCEAL", "MOVE", "TRANSFER", "VERIFY"].includes(String(entry.direction ?? ""))) {
      errors.push(`${path}.direction is invalid`);
    }
    if (!["MINOR", "MODERATE", "MAJOR"].includes(String(entry.requestedMagnitude ?? ""))) {
      errors.push(`${path}.requestedMagnitude is invalid`);
    }
  });
  validateObject(value.method, ["methodTypeId", "description"], "action.method", errors, (entry, path) => {
    requireStrings(entry, ["methodTypeId", "description"], path, errors);
  });
  validateArrayObjects(value.resourceCommitments, ["resourceId", "amount"], "action.resourceCommitments", errors, (entry, path) => {
    if (!nonEmptyString(entry.resourceId) || typeof entry.amount !== "number" || entry.amount <= 0) {
      errors.push(`${path} is invalid`);
    }
  });
  for (const key of ["evidenceRefs", "capabilityRefs", "propositionRefs", "riskTags"] as const) {
    if (!stringArray(value[key])) errors.push(`action.${key} must be an array`);
  }
  validateObject(value.visibilityIntent, ["type", "declaredRecipientRefs"], "action.visibilityIntent", errors, (entry, path) => {
    if (!["PUBLIC", "PRIVATE", "COVERT", "CONDITIONAL"].includes(String(entry.type ?? ""))) errors.push(`${path}.type is invalid`);
    if (entry.declaredRecipientRefs !== undefined && !stringArray(entry.declaredRecipientRefs)) {
      errors.push(`${path}.declaredRecipientRefs must be an array`);
    }
  });
  if (!["NONE", "IF_PUBLIC", "IF_OBSERVED"].includes(String(value.reactionPolicy ?? "")) || value.requestedTiming !== "CURRENT_WINDOW") {
    errors.push("action timing/reaction policy is invalid");
  }
  for (const key of ["confirmedAt", "lockedAt"] as const) {
    if (!nullableString(value[key])) errors.push(`action.${key} must be string|null`);
  }
  if (value.kind === "HOLD" && (
    (Array.isArray(value.targetRefs) && value.targetRefs.length > 0)
    || (Array.isArray(value.resourceCommitments) && value.resourceCommitments.length > 0)
  )) errors.push("HOLD cannot carry targets or resources");
  return errors.length ? fail(errors) : pass(value as B0ActionContractV1);
}
