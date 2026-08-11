import {
  b0IntentRelationTypes,
  b0OutcomeStatuses,
  type B0CausalEdgeV1,
  type B0SettlementResolutionV1,
} from "./b0-settlement.schemas";
import {
  fail,
  integerAtLeast,
  isRecord,
  nonEmptyString,
  pass,
  stringArray,
  type ValidationResult,
} from "./schema-utils";
import { validateB0TypedAudienceSpecV1 } from "./b0-settlement.batch.validators";
import { objectErrors, requireStrings, validateObject, validateTypedRef } from "./b0-settlement.validation-utils";

export function validateB0CausalEdgeV1(value: unknown): ValidationResult<B0CausalEdgeV1> {
  const errors = objectErrors(value, ["schemaVersion", "id", "batchId", "from", "to", "relation"], "causal edge");
  if (!isRecord(value)) return fail(errors);
  if (value.schemaVersion !== "b0-causal-edge-v1") errors.push("causal edge.schemaVersion is invalid");
  requireStrings(value, ["id", "batchId"], "causal edge", errors);
  validateTypedRef(value.from, ["INTENT", "RESOURCE", "CAPABILITY", "WORLD_FACT", "RELATIONSHIP", "SYSTEM_INTENT"], "causal edge.from", errors);
  validateTypedRef(value.to, ["INTENT_OUTCOME", "WORLD_EVENT", "TRACE", "KNOWLEDGE_GRANT", "MUTATION"], "causal edge.to", errors);
  if (!["ENABLED", "SUPPORTED", "BLOCKED", "WEAKENED", "EXPOSED", "CAUSED", "LIMITED"].includes(String(value.relation ?? ""))) {
    errors.push("causal edge.relation is invalid");
  }
  return errors.length ? fail(errors) : pass(value as B0CausalEdgeV1);
}

export function validateB0SettlementResolutionV1(value: unknown): ValidationResult<B0SettlementResolutionV1> {
  const fields = [
    "schemaVersion", "batchId", "roomId", "runId", "windowId", "baseWorldSequence",
    "intentRelations", "conflictGroups", "intentOutcomes", "worldDelta",
    "structuredResults", "pendingEffects", "causalEdges", "resolutionVersion", "resolutionHash",
  ] as const;
  const errors = objectErrors(value, fields, "resolution");
  if (!isRecord(value)) return fail(errors);
  if (value.schemaVersion !== "b0-settlement-resolution-v1") errors.push("resolution.schemaVersion is invalid");
  requireStrings(value, ["batchId", "roomId", "runId", "windowId", "resolutionVersion", "resolutionHash"], "resolution", errors);
  if (!integerAtLeast(value.baseWorldSequence, 0)) errors.push("resolution.baseWorldSequence must be >= 0");
  for (const key of ["intentRelations", "conflictGroups", "intentOutcomes", "structuredResults", "pendingEffects", "causalEdges"] as const) {
    if (!Array.isArray(value[key])) errors.push(`resolution.${key} must be an array`);
  }
  validateObject(value.worldDelta, ["mutations"], "resolution.worldDelta", errors, (entry, path) => {
    if (!Array.isArray(entry.mutations)) errors.push(`${path}.mutations must be an array`);
  });
  if (Array.isArray(value.intentRelations)) value.intentRelations.forEach((entry, index) => validateRelation(entry, index, errors));
  if (Array.isArray(value.conflictGroups)) value.conflictGroups.forEach((entry, index) => validateConflictGroup(entry, index, errors));
  if (Array.isArray(value.intentOutcomes)) value.intentOutcomes.forEach((entry, index) => validateOutcome(entry, index, errors));
  if (isRecord(value.worldDelta) && Array.isArray(value.worldDelta.mutations)) {
    value.worldDelta.mutations.forEach((entry, index) => validateMutation(entry, index, errors));
  }
  if (Array.isArray(value.structuredResults)) value.structuredResults.forEach((entry, index) => validateResult(entry, index, errors));
  if (Array.isArray(value.pendingEffects)) value.pendingEffects.forEach((entry, index) => validatePendingEffect(entry, index, errors));
  if (Array.isArray(value.causalEdges)) value.causalEdges.forEach((entry, index) => {
    const result = validateB0CausalEdgeV1(entry);
    if (!result.ok) errors.push(...result.errors.map((error) => `resolution.causalEdges[${index}]: ${error}`));
  });
  validateResolutionReferences(value, errors);
  return errors.length ? fail(errors) : pass(value as B0SettlementResolutionV1);
}

function validateRelation(value: unknown, index: number, errors: string[]): void {
  const path = `resolution.intentRelations[${index}]`;
  const fields = [
    "schemaVersion", "id", "batchId", "leftIntentId", "rightIntentId", "type",
    "basis", "confidence", "classifierVersion", "evidenceRefs",
  ] as const;
  errors.push(...objectErrors(value, fields, path));
  if (!isRecord(value)) return;
  if (value.schemaVersion !== "b0-intent-relation-v1") errors.push(`${path}.schemaVersion is invalid`);
  requireStrings(value, ["id", "batchId", "leftIntentId", "rightIntentId", "classifierVersion"], path, errors);
  if (!b0IntentRelationTypes.includes(value.type as never)) errors.push(`${path}.type is invalid`);
  if (!["TARGET_OVERLAP", "PROPOSITION_OPPOSITION", "RESOURCE_CONTENTION", "LOCATION_CONTENTION", "PROTECT_VS_HARM", "REVEAL_VS_CONCEAL", "CAPABILITY_RULE", "WORLD_RULE", "MODEL_ASSISTED"].includes(String(value.basis ?? ""))) {
    errors.push(`${path}.basis is invalid`);
  }
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1 || !stringArray(value.evidenceRefs)) {
    errors.push(`${path}.confidence/evidenceRefs is invalid`);
  }
  if (nonEmptyString(value.leftIntentId) && nonEmptyString(value.rightIntentId) && value.leftIntentId.localeCompare(value.rightIntentId) >= 0) {
    errors.push(`${path} intent pair must be ascending`);
  }
}

function validateConflictGroup(value: unknown, index: number, errors: string[]): void {
  const path = `resolution.conflictGroups[${index}]`;
  errors.push(...objectErrors(value, ["conflictGroupId", "intentIds"], path));
  if (!isRecord(value)) return;
  if (!nonEmptyString(value.conflictGroupId)) errors.push(`${path}.conflictGroupId is required`);
  if (!stringArray(value.intentIds) || value.intentIds.length === 0) {
    errors.push(`${path}.intentIds must be non-empty`);
    return;
  }
  if (new Set(value.intentIds).size !== value.intentIds.length) errors.push(`${path}.intentIds contains duplicates`);
  if (value.intentIds.join("|") !== [...value.intentIds].sort().join("|")) errors.push(`${path}.intentIds must be stable-sorted`);
}

function validateOutcome(value: unknown, index: number, errors: string[]): void {
  const path = `resolution.intentOutcomes[${index}]`;
  errors.push(...objectErrors(value, ["outcomeId", "intentId", "actorId", "status", "summary", "causalEdgeIds"], path));
  if (!isRecord(value)) return;
  requireStrings(value, ["outcomeId", "intentId", "actorId", "summary"], path, errors);
  if (!b0OutcomeStatuses.includes(value.status as never) || !stringArray(value.causalEdgeIds)) {
    errors.push(`${path}.status/causalEdgeIds is invalid`);
  }
}

function validateMutation(value: unknown, index: number, errors: string[]): void {
  const path = `resolution.worldDelta.mutations[${index}]`;
  errors.push(...objectErrors(value, ["mutationId", "entityType", "entityId", "attribute", "operation", "value", "originIntentIds"], path));
  if (!isRecord(value)) return;
  requireStrings(value, ["mutationId", "entityId", "attribute"], path, errors);
  if (!["ACTOR", "LOCATION", "DOCUMENT", "EVIDENCE", "INSTITUTION", "RESOURCE", "RELATION", "WORLD"].includes(String(value.entityType ?? ""))) {
    errors.push(`${path}.entityType is invalid`);
  }
  if (!["SET", "INCREMENT", "ADD", "REMOVE"].includes(String(value.operation ?? ""))) errors.push(`${path}.operation is invalid`);
  if (!stringArray(value.originIntentIds) || value.originIntentIds.length === 0) errors.push(`${path}.originIntentIds must be non-empty`);
  if (stringArray(value.originIntentIds) && new Set(value.originIntentIds).size !== value.originIntentIds.length) errors.push(`${path}.originIntentIds contains duplicates`);
  if (value.value === undefined) errors.push(`${path}.value is required`);
  if (value.operation === "INCREMENT" && (typeof value.value !== "number" || !Number.isFinite(value.value))) {
    errors.push(`${path}.value must be finite for INCREMENT`);
  }
}

function validateResult(value: unknown, index: number, errors: string[]): void {
  const path = `resolution.structuredResults[${index}]`;
  errors.push(...objectErrors(value, [
    "resultId", "resultKind", "originIntentIds", "originActorIds", "targetActorIds",
    "summary", "durableMutationIds", "audience",
  ], path));
  if (!isRecord(value)) return;
  requireStrings(value, ["resultId", "summary"], path, errors);
  if (!["PERSONAL_OUTCOME", "CROSS_PLAYER_IMPACT", "WORLD_EVENT", "OBSERVABLE_TRACE", "KNOWLEDGE_GRANT"].includes(String(value.resultKind ?? ""))) {
    errors.push(`${path}.resultKind is invalid`);
  }
  for (const key of ["originIntentIds", "originActorIds", "targetActorIds", "durableMutationIds"] as const) {
    if (!stringArray(value[key])) errors.push(`${path}.${key} must be an array`);
  }
  const audience = validateB0TypedAudienceSpecV1(value.audience);
  if (!audience.ok) errors.push(...audience.errors.map((error) => `${path}.audience: ${error}`));
  const origins = stringArray(value.originActorIds) ? value.originActorIds : [];
  const targets = stringArray(value.targetActorIds) ? value.targetActorIds : [];
  const mutations = stringArray(value.durableMutationIds) ? value.durableMutationIds : [];
  if (value.resultKind === "CROSS_PLAYER_IMPACT" && (
    origins.length === 0
    || targets.length === 0
    || targets.every((id) => origins.includes(id))
    || mutations.length === 0
  )) errors.push(`${path} has no valid cross-player origin or durable impact`);
}

function validatePendingEffect(value: unknown, index: number, errors: string[]): void {
  const path = `resolution.pendingEffects[${index}]`;
  errors.push(...objectErrors(value, ["pendingEffectId", "sourceIntentId", "dueWindowOrdinal"], path));
  if (!isRecord(value)) return;
  requireStrings(value, ["pendingEffectId", "sourceIntentId"], path, errors);
  if (!integerAtLeast(value.dueWindowOrdinal, 1)) errors.push(`${path}.dueWindowOrdinal must be >= 1`);
}

function validateResolutionReferences(value: Record<string, unknown>, errors: string[]): void {
  const outcomes = Array.isArray(value.intentOutcomes) ? value.intentOutcomes.filter(isRecord) : [];
  const intentIds = new Set(outcomes.map((entry) => String(entry.intentId ?? "")).filter(Boolean));
  const outcomeIds = new Set(outcomes.map((entry) => String(entry.outcomeId ?? "")).filter(Boolean));
  const mutations = isRecord(value.worldDelta) && Array.isArray(value.worldDelta.mutations)
    ? value.worldDelta.mutations.filter(isRecord)
    : [];
  const mutationIds = new Set(mutations.map((entry) => String(entry.mutationId ?? "")).filter(Boolean));
  const edges = Array.isArray(value.causalEdges) ? value.causalEdges.filter(isRecord) : [];
  const edgeIds = new Set(edges.map((entry) => String(entry.id ?? "")).filter(Boolean));

  assertUnique(outcomes.map((entry) => String(entry.intentId ?? "")), "resolution.intentOutcomes intentId", errors);
  assertUnique(outcomes.map((entry) => String(entry.outcomeId ?? "")), "resolution.intentOutcomes outcomeId", errors);
  assertUnique(mutations.map((entry) => String(entry.mutationId ?? "")), "resolution.worldDelta mutationId", errors);
  assertUnique(edges.map((entry) => String(entry.id ?? "")), "resolution.causalEdges id", errors);

  if (Array.isArray(value.intentRelations)) value.intentRelations.filter(isRecord).forEach((entry, index) => {
    if (entry.batchId !== value.batchId) errors.push(`resolution.intentRelations[${index}].batchId mismatch`);
    if (!intentIds.has(String(entry.leftIntentId ?? "")) || !intentIds.has(String(entry.rightIntentId ?? ""))) {
      errors.push(`resolution.intentRelations[${index}] references an unknown intent`);
    }
  });
  if (Array.isArray(value.conflictGroups)) value.conflictGroups.filter(isRecord).forEach((entry, index) => {
    if (stringArray(entry.intentIds) && entry.intentIds.some((id) => !intentIds.has(id))) {
      errors.push(`resolution.conflictGroups[${index}] references an unknown intent`);
    }
  });
  outcomes.forEach((entry, index) => {
    if (stringArray(entry.causalEdgeIds) && entry.causalEdgeIds.some((id) => !edgeIds.has(id))) {
      errors.push(`resolution.intentOutcomes[${index}] references an unknown causal edge`);
    }
  });
  mutations.forEach((entry, index) => {
    if (stringArray(entry.originIntentIds) && entry.originIntentIds.some((id) => !intentIds.has(id))) {
      errors.push(`resolution.worldDelta.mutations[${index}] references an unknown origin intent`);
    }
  });
  if (Array.isArray(value.structuredResults)) value.structuredResults.filter(isRecord).forEach((entry, index) => {
    if (stringArray(entry.originIntentIds) && entry.originIntentIds.some((id) => !intentIds.has(id))) {
      errors.push(`resolution.structuredResults[${index}] references an unknown origin intent`);
    }
    if (stringArray(entry.durableMutationIds) && entry.durableMutationIds.some((id) => !mutationIds.has(id))) {
      errors.push(`resolution.structuredResults[${index}] references an unknown durable mutation`);
    }
  });
  edges.forEach((entry, index) => {
    if (entry.batchId !== value.batchId) errors.push(`resolution.causalEdges[${index}].batchId mismatch`);
    if (isRecord(entry.from) && (entry.from.type === "INTENT" || entry.from.type === "SYSTEM_INTENT") && !intentIds.has(String(entry.from.id ?? ""))) {
      errors.push(`resolution.causalEdges[${index}].from references an unknown intent`);
    }
    if (isRecord(entry.to) && entry.to.type === "INTENT_OUTCOME" && !outcomeIds.has(String(entry.to.id ?? ""))) {
      errors.push(`resolution.causalEdges[${index}].to references an unknown outcome`);
    }
    if (isRecord(entry.to) && entry.to.type === "MUTATION" && !mutationIds.has(String(entry.to.id ?? ""))) {
      errors.push(`resolution.causalEdges[${index}].to references an unknown mutation`);
    }
  });
}

function assertUnique(values: string[], path: string, errors: string[]): void {
  const present = values.filter(Boolean);
  if (new Set(present).size !== present.length) errors.push(`${path} contains duplicates`);
}
