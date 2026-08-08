import type {
  B0ActionContractV1,
  B0CausalEdgeV1,
  B0OutcomeStatusV1,
  B0SettlementResolutionV1,
  B0StateMutationV1,
  B0StructuredResultV1,
} from "@ai-story/shared";
import { validateB0SettlementResolutionV1 } from "@ai-story/shared";
import { hashResolutionPayload } from "./b0-batch-settlement";
import { hashCanonicalB0Value } from "./b0-settlement";
import {
  assertNoLegacyAudienceFields,
  buildB0ActorIndexV1,
  extractB0AudienceResolverMapsV1,
  mergeB0AudienceMapsV1,
  resolveB0TypedAudienceV1,
  sameStringSet,
  uniqueSorted,
  type B0ActorIndexV1,
} from "./b0-audience.resolve";
import {
  B0AudienceErrorV1,
  type B0AudienceResolverMapsV1,
  type B0CausalExplanationCardV1,
  type B0CausalExplanationReasonV1,
  type B0PublicationChangeV1,
  type B0PublicationDeliveryV1,
  type B0PublicationPlanV1,
  type BuildB0PublicationPlanInputV1,
} from "./b0-audience.types";

export function buildB0PublicationPlanV1(input: BuildB0PublicationPlanInputV1): B0PublicationPlanV1 {
  assertNoLegacyAudienceFields(input.resolution.structuredResults, "structuredResults");
  assertContext(input);
  const index = buildB0ActorIndexV1(input);
  const maps = mergeB0AudienceMapsV1(extractB0AudienceResolverMapsV1(input.snapshot), input.maps ?? {});
  validateAllResults(input, index);
  const deliveries: B0PublicationDeliveryV1[] = [];
  for (const result of [...input.resolution.structuredResults].sort((a, b) => a.resultId.localeCompare(b.resultId))) {
    const recipients = resolveB0TypedAudienceV1(result.audience, input);
    validateResolvedRecipients(result, recipients, index);
    for (const recipientActorId of recipients) {
      authorizeSecretRecipient(result, recipientActorId, index, maps);
      deliveries.push(buildDelivery(result, recipientActorId, input, index));
    }
  }
  deliveries.sort((a, b) => a.idempotencyKey.localeCompare(b.idempotencyKey));
  if (new Set(deliveries.map((entry) => entry.idempotencyKey)).size !== deliveries.length) {
    throw new B0AudienceErrorV1("AUDIENCE_OUTBOX_DUPLICATE", "Publication deliveries contain duplicate idempotency keys.");
  }
  const payload: Omit<B0PublicationPlanV1, "planHash"> = {
    schemaVersion: "b0-publication-plan-v1",
    batchId: input.resolution.batchId,
    roomId: input.resolution.roomId,
    runId: input.resolution.runId,
    windowId: input.resolution.windowId,
    baseWorldSequence: input.resolution.baseWorldSequence,
    resolutionHash: input.resolution.resolutionHash,
    deliveries,
  };
  return deepFreeze({ ...payload, planHash: hashCanonicalB0Value(payload) });
}

function validateAllResults(input: BuildB0PublicationPlanInputV1, index: B0ActorIndexV1): void {
  const resultIds = new Set<string>();
  const semanticUse = new Map<string, Set<string>>();
  for (const result of input.resolution.structuredResults) {
    if (resultIds.has(result.resultId)) throw new B0AudienceErrorV1("STRUCTURED_RESULT_DUPLICATE", `Duplicate result ${result.resultId}.`);
    resultIds.add(result.resultId);
    validateResult(result, input, index);
    if (["PERSONAL_OUTCOME", "CROSS_PLAYER_IMPACT", "WORLD_EVENT"].includes(result.resultKind)) {
      for (const mutationId of result.durableMutationIds) semanticUse.set(mutationId, new Set([...(semanticUse.get(mutationId) ?? []), result.resultKind]));
    }
  }
  for (const [mutationId, kinds] of semanticUse) {
    if (kinds.size > 1) throw new B0AudienceErrorV1("RESULT_CAUSAL_SOURCE_REUSED", `Durable mutation ${mutationId} was reused as ${[...kinds].sort().join(", ")}.`);
  }
}

function validateResult(result: B0StructuredResultV1, input: BuildB0PublicationPlanInputV1, index: B0ActorIndexV1): void {
  const allowed = ["resultId", "resultKind", "originIntentIds", "originActorIds", "targetActorIds", "summary", "durableMutationIds", "audience"];
  const unknown = Object.keys(result).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new B0AudienceErrorV1("STRUCTURED_RESULT_UNKNOWN_FIELD", `Result contains unknown fields: ${unknown.join(", ")}.`);
  if (!result.resultId || !result.summary) throw invalidResult("Result id and summary are required.");
  const originIds = uniqueSorted(result.originIntentIds);
  if (!originIds.length || originIds.length !== result.originIntentIds.length) throw invalidResult(`Result ${result.resultId} has invalid origin intents.`);
  const sourceActors = uniqueSorted(originIds.map((id) => {
    const intent = index.intentById.get(id);
    if (!intent) throw invalidResult(`Result ${result.resultId} references unknown intent ${id}.`);
    return intent.actorId;
  }));
  if (!sameStringSet(sourceActors, result.originActorIds)) throw invalidResult(`Result ${result.resultId} origin actors do not match its intents.`);
  for (const actorId of result.targetActorIds) if (!index.actorSet.has(actorId)) throw new B0AudienceErrorV1("AUDIENCE_RUN_SCOPE_VIOLATION", `Result ${result.resultId} targets actor ${actorId} outside the snapshot.`);
  for (const mutationId of result.durableMutationIds) {
    const mutation = index.mutationById.get(mutationId);
    if (!mutation) throw invalidResult(`Result ${result.resultId} references unknown mutation ${mutationId}.`);
    if (!mutation.originIntentIds.some((id) => originIds.includes(id))) throw invalidResult(`Mutation ${mutationId} has no causal origin for result ${result.resultId}.`);
  }
  switch (result.resultKind) {
    case "PERSONAL_OUTCOME":
      if (sourceActors.length !== 1 || result.targetActorIds.length !== 1 || result.targetActorIds[0] !== sourceActors[0]
        || result.audience.type !== "ACTOR_ONLY" || result.audience.actorRef !== sourceActors[0]) {
        throw new B0AudienceErrorV1("PERSONAL_OUTCOME_INVALID", `Result ${result.resultId} is not actor-scoped.`);
      }
      break;
    case "CROSS_PLAYER_IMPACT":
      if (!result.durableMutationIds.length || !result.targetActorIds.length || result.targetActorIds.every((id) => sourceActors.includes(id))) {
        throw new B0AudienceErrorV1("CROSS_PLAYER_IMPACT_INVALID", `Result ${result.resultId} lacks a different actor and durable impact.`);
      }
      break;
    case "WORLD_EVENT":
      if (result.audience.type !== "PUBLIC" || !result.durableMutationIds.length) throw new B0AudienceErrorV1("WORLD_EVENT_INVALID", `Result ${result.resultId} must be public and durable.`);
      requireCausalTarget(input.resolution.causalEdges, "WORLD_EVENT", result.resultId);
      break;
    case "OBSERVABLE_TRACE":
      if (result.audience.type !== "OBSERVERS_OF_TRACE") throw new B0AudienceErrorV1("OBSERVABLE_TRACE_INVALID", `Result ${result.resultId} must use OBSERVERS_OF_TRACE.`);
      requireCausalTarget(input.resolution.causalEdges, "TRACE", result.resultId);
      break;
    case "KNOWLEDGE_GRANT":
      if (!result.targetActorIds.length) throw new B0AudienceErrorV1("KNOWLEDGE_GRANT_INVALID", `Result ${result.resultId} has no recipient.`);
      requireCausalTarget(input.resolution.causalEdges, "KNOWLEDGE_GRANT", result.resultId);
      break;
  }
}

function validateResolvedRecipients(result: B0StructuredResultV1, recipients: string[], index: B0ActorIndexV1): void {
  if (["PERSONAL_OUTCOME", "CROSS_PLAYER_IMPACT", "OBSERVABLE_TRACE", "KNOWLEDGE_GRANT"].includes(result.resultKind)
    && !sameStringSet(recipients, result.targetActorIds)) {
    throw new B0AudienceErrorV1("AUDIENCE_TARGET_MISMATCH", `Result ${result.resultId} recipients do not match its authoritative targets.`);
  }
  if (result.resultKind === "WORLD_EVENT" && !sameStringSet(recipients, index.actorIds)) throw new B0AudienceErrorV1("WORLD_EVENT_INVALID", `World event ${result.resultId} is not visible to the complete actor set.`);
}

function authorizeSecretRecipient(result: B0StructuredResultV1, recipient: string, index: B0ActorIndexV1, maps: B0AudienceResolverMapsV1): void {
  if (["WORLD_EVENT", "PERSONAL_OUTCOME", "OBSERVABLE_TRACE"].includes(result.resultKind)) return;
  for (const intentId of result.originIntentIds) {
    const intent = index.intentById.get(intentId) as B0ActionContractV1;
    if (intent.visibilityIntent.type === "PUBLIC" || recipient === intent.actorId) continue;
    if ((intent.visibilityIntent.declaredRecipientRefs ?? []).includes(recipient) || (maps.detectedIntentActors?.[intentId] ?? []).includes(recipient)) continue;
    throw new B0AudienceErrorV1("UNDISCOVERED_SECRET_RECIPIENT", `Secret intent ${intentId} cannot notify actor ${recipient} without declaration or detection.`);
  }
}

function buildDelivery(result: B0StructuredResultV1, recipient: string, input: BuildB0PublicationPlanInputV1, index: B0ActorIndexV1): B0PublicationDeliveryV1 {
  const disclosure = disclosureFor(result, recipient, index);
  if (disclosure !== "FULL") assertSummaryDoesNotRevealSource(result, index);
  const statuses = uniqueSorted(input.resolution.intentOutcomes.filter((entry) => result.originIntentIds.includes(entry.intentId)).map((entry) => entry.status)) as B0OutcomeStatusV1[];
  const changes = result.durableMutationIds.map((id) => index.mutationById.get(id) as B0StateMutationV1)
    .sort((a, b) => a.mutationId.localeCompare(b.mutationId))
    .map((mutation): B0PublicationChangeV1 => ({ kind: mutation.entityType, operation: mutation.operation, numericDelta: mutation.operation === "INCREMENT" && typeof mutation.value === "number" ? mutation.value : null }));
  return {
    schemaVersion: "b0-publication-delivery-v1",
    idempotencyKey: `b0-publication:${input.resolution.batchId}:${result.resultId}:${recipient}`,
    batchId: input.resolution.batchId,
    runId: input.resolution.runId,
    windowId: input.resolution.windowId,
    resultId: result.resultId,
    resultKind: result.resultKind,
    recipientActorId: recipient,
    visibility: result.resultKind === "WORLD_EVENT" ? "PUBLIC" : result.resultKind === "OBSERVABLE_TRACE" ? "TRACE" : result.resultKind === "CROSS_PLAYER_IMPACT" ? "TARGETED" : "PRIVATE",
    sourceDisclosure: disclosure,
    originActorIds: disclosure === "FULL" ? uniqueSorted(result.originActorIds) : [],
    targetActorIds: disclosure === "FULL" ? uniqueSorted(result.targetActorIds) : result.targetActorIds.includes(recipient) ? [recipient] : [],
    summary: result.summary,
    outcomeStatus: statuses.length === 1 ? statuses[0] : null,
    changes,
    explanation: buildExplanation(result, recipient, input.resolution, index),
  };
}

function disclosureFor(result: B0StructuredResultV1, recipient: string, index: B0ActorIndexV1): B0PublicationDeliveryV1["sourceDisclosure"] {
  if (result.resultKind === "OBSERVABLE_TRACE") return "TRACE_ONLY";
  const intents = result.originIntentIds.map((id) => index.intentById.get(id) as B0ActionContractV1);
  if (intents.every((intent) => intent.actorId === recipient || intent.visibilityIntent.type === "PUBLIC")) return "FULL";
  if (intents.every((intent) => intent.visibilityIntent.type === "PRIVATE" && (intent.visibilityIntent.declaredRecipientRefs ?? []).includes(recipient))) return "FULL";
  return "HIDDEN";
}

function buildExplanation(result: B0StructuredResultV1, recipient: string, resolution: B0SettlementResolutionV1, index: B0ActorIndexV1): B0CausalExplanationCardV1 {
  const reasons: B0CausalExplanationReasonV1[] = [];
  if (result.originActorIds.includes(recipient)) reasons.push({ kind: "OWN_PLAN", summary: "Your committed plan contributed to this result." });
  else if (result.resultKind === "CROSS_PLAYER_IMPACT") reasons.push({ kind: "OTHER_PLAN", summary: "Another committed plan changed your position." });
  if (result.resultKind === "WORLD_EVENT") reasons.push({ kind: "WORLD_CHANGE", summary: "The merged settlement produced a public world change." });
  if (result.resultKind === "OBSERVABLE_TRACE") reasons.push({ kind: "TRACE", summary: "You observed a trace without receiving its hidden source details." });
  if (result.resultKind === "KNOWLEDGE_GRANT") reasons.push({ kind: "KNOWLEDGE", summary: "The committed settlement granted role-scoped knowledge." });
  const outcomeIds = new Set(resolution.intentOutcomes.filter((entry) => result.originIntentIds.includes(entry.intentId)).map((entry) => entry.outcomeId));
  const edges = resolution.causalEdges.filter((edge) => (edge.to.type === "INTENT_OUTCOME" && outcomeIds.has(edge.to.id)) || (edge.to.type === "MUTATION" && result.durableMutationIds.includes(edge.to.id)));
  if (edges.some((edge) => edge.relation === "SUPPORTED")) reasons.push({ kind: "SUPPORT", summary: "A supporting action strengthened the result." });
  if (edges.some((edge) => ["WEAKENED", "BLOCKED", "LIMITED"].includes(edge.relation))) reasons.push({ kind: "CONFLICT", summary: "A conflicting action limited the result." });
  if (result.durableMutationIds.some((id) => index.mutationById.get(id)?.entityType === "RESOURCE")) reasons.push({ kind: "RESOURCE", summary: "A committed resource change was applied exactly once." });
  const unique = new Map(reasons.map((entry) => [`${entry.kind}:${entry.summary}`, entry]));
  if (!unique.size) unique.set("WORLD_CHANGE:default", { kind: "WORLD_CHANGE", summary: "The authoritative settlement produced this result." });
  return { schemaVersion: "b0-causal-explanation-card-v1", resultId: result.resultId, reasons: [...unique.values()] };
}

function assertContext(input: BuildB0PublicationPlanInputV1): void {
  const validation = validateB0SettlementResolutionV1(input.resolution);
  if (!validation.ok) throw new B0AudienceErrorV1("RESOLUTION_VALIDATION_FAILED", validation.errors.join("; "));
  if (input.resolution.resolutionHash !== hashResolutionPayload(input.resolution)) throw new B0AudienceErrorV1("RESOLUTION_HASH_MISMATCH", "Publication requires the immutable resolution payload.");
  if (input.snapshot.runId !== input.resolution.runId || input.snapshot.roomId !== input.resolution.roomId
    || input.snapshot.windowId !== input.resolution.windowId || input.snapshot.baseWorldSequence !== input.resolution.baseWorldSequence) {
    throw new B0AudienceErrorV1("AUDIENCE_RUN_SCOPE_VIOLATION", "Snapshot and resolution do not share one context.");
  }
  if (uniqueSorted(input.intents.map((entry) => entry.id)).length !== input.intents.length) throw invalidResult("Intent set contains duplicate ids.");
  for (const intent of input.intents) {
    if (intent.runId !== input.resolution.runId || intent.roomId !== input.resolution.roomId || intent.windowId !== input.resolution.windowId || intent.baseWorldSequence !== input.resolution.baseWorldSequence) {
      throw new B0AudienceErrorV1("AUDIENCE_RUN_SCOPE_VIOLATION", `Intent ${intent.id} belongs to another context.`);
    }
  }
}

function assertSummaryDoesNotRevealSource(result: B0StructuredResultV1, index: B0ActorIndexV1): void {
  const tokens = [...result.originIntentIds, ...result.originActorIds, ...result.originActorIds.flatMap((id) => index.actorLabels.get(id) ?? [])].filter((entry) => entry.length >= 2);
  if (tokens.some((token) => result.summary.includes(token))) throw new B0AudienceErrorV1("PRIVATE_SUMMARY_SOURCE_LEAK", `Result ${result.resultId} summary reveals a hidden source.`);
}

function requireCausalTarget(edges: B0CausalEdgeV1[], type: "WORLD_EVENT" | "TRACE" | "KNOWLEDGE_GRANT", id: string): void {
  if (!edges.some((edge) => edge.to.type === type && edge.to.id === id)) throw new B0AudienceErrorV1("STRUCTURED_RESULT_CAUSAL_EDGE_MISSING", `Result ${id} has no ${type} causal edge.`);
}

function invalidResult(message: string): B0AudienceErrorV1 {
  return new B0AudienceErrorV1("STRUCTURED_RESULT_INVALID", message);
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) { value.forEach(deepFreeze); return Object.freeze(value); }
  if (value && typeof value === "object") { Object.values(value as Record<string, unknown>).forEach(deepFreeze); return Object.freeze(value); }
  return value;
}
