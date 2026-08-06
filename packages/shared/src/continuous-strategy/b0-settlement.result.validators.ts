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
  if (Array.isArray(value.intentOutcomes)) value.intentOutcomes.forEach((entry, index) => validateOutcome(entry, index, errors));
  if (Array.isArray(value.structuredResults)) value.structuredResults.forEach((entry, index) => validateResult(entry, index, errors));
  if (Array.isArray(value.causalEdges)) value.causalEdges.forEach((entry, index) => {
    const result = validateB0CausalEdgeV1(entry);
    if (!result.ok) errors.push(...result.errors.map((error) => `resolution.causalEdges[${index}]: ${error}`));
  });
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

function validateOutcome(value: unknown, index: number, errors: string[]): void {
  const path = `resolution.intentOutcomes[${index}]`;
  errors.push(...objectErrors(value, ["outcomeId", "intentId", "actorId", "status", "summary", "causalEdgeIds"], path));
  if (!isRecord(value)) return;
  requireStrings(value, ["outcomeId", "intentId", "actorId", "summary"], path, errors);
  if (!b0OutcomeStatuses.includes(value.status as never) || !stringArray(value.causalEdgeIds)) {
    errors.push(`${path}.status/causalEdgeIds is invalid`);
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
