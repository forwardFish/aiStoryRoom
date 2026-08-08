import type {
  B0ActionContractV1,
  B0BatchCommitManifestV1,
  B0CausalEdgeV1,
  B0IntentOutcomeV1,
  B0IntentRelationV1,
  B0OutcomeStatusV1,
  B0RoomRulesetV1,
  B0SettlementBatchV1,
  B0SettlementResolutionV1,
  B0SettlementSnapshotV1,
  B0StateMutationV1,
  B0StructuredResultV1,
  B0TargetRefV1,
} from "@ai-story/shared";
import {
  validateB0ActionContractV1,
  validateB0BatchCommitManifestV1,
  validateB0RoomRulesetV1,
  validateB0SettlementBatchV1,
  validateB0SettlementResolutionV1,
  validateB0SettlementSnapshotV1,
} from "@ai-story/shared";
import { hashB0RoomRulesetV1, hashCanonicalB0Value } from "./b0-settlement";
import { extractB0AudienceResolverMapsV1 } from "./b0-audience.resolve";

export type CaptureB0SnapshotInputV1 = {
  id: string;
  windowId: string;
  roomId: string;
  runId: string;
  baseWorldSequence: number;
  ruleset: B0RoomRulesetV1;
  worldState: unknown;
  actorStates: unknown[];
  roleBindings: unknown[];
  knowledgeState: unknown;
  relationshipState: unknown;
  resourceState: unknown;
  activeCapabilities: unknown[];
  dueSystemIntents?: unknown[];
  createdAt: string;
};

export type PrepareB0BatchInputV1 = {
  id: string;
  snapshot: B0SettlementSnapshotV1;
  intents: B0ActionContractV1[];
  dueSystemIntents?: B0ActionContractV1[];
  createdAt: string;
};

export type SettleB0BatchInputV1 = {
  ruleset: B0RoomRulesetV1;
  snapshot: B0SettlementSnapshotV1;
  batch: B0SettlementBatchV1;
  intents: B0ActionContractV1[];
  dueSystemIntents?: B0ActionContractV1[];
};

export type SettleB0SingleIntentInputV1 = {
  batchId: string;
  ruleset: B0RoomRulesetV1;
  snapshot: B0SettlementSnapshotV1;
  intent: B0ActionContractV1;
  createdAt: string;
};

export type BuildB0CommitManifestInputV1 = {
  batch: B0SettlementBatchV1;
  snapshot: B0SettlementSnapshotV1;
  resolution: B0SettlementResolutionV1;
  committedAt: string;
  resourceMutationKeys: string[];
  stateMutationKeys?: string[];
  publicationOutboxKeys: string[];
};

export class B0SettlementErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "B0SettlementErrorV1";
  }
}

export function captureB0SettlementSnapshotV1(input: CaptureB0SnapshotInputV1): Readonly<B0SettlementSnapshotV1> {
  const rules = validateB0RoomRulesetV1(input.ruleset);
  if (!rules.ok) throw new B0SettlementErrorV1("ROOM_RULESET_MISMATCH", rules.errors.join("; "));
  const candidate: B0SettlementSnapshotV1 = {
    schemaVersion: "b0-settlement-snapshot-v1",
    id: required(input.id, "snapshot.id"),
    windowId: required(input.windowId, "snapshot.windowId"),
    roomId: required(input.roomId, "snapshot.roomId"),
    runId: required(input.runId, "snapshot.runId"),
    baseWorldSequence: nonNegative(input.baseWorldSequence, "snapshot.baseWorldSequence"),
    rulesetVersion: rules.value.rulesetVersion,
    rulesetHash: hashB0RoomRulesetV1(rules.value),
    worldState: clone(input.worldState),
    actorStates: clone(input.actorStates),
    roleBindings: clone(input.roleBindings),
    knowledgeState: clone(input.knowledgeState),
    relationshipState: clone(input.relationshipState),
    resourceState: clone(input.resourceState),
    activeCapabilities: clone(input.activeCapabilities),
    dueSystemIntents: clone(input.dueSystemIntents ?? []),
    worldStateHash: hashCanonicalB0Value(input.worldState),
    roleSetHash: hashCanonicalB0Value({ actorStates: input.actorStates, roleBindings: input.roleBindings }),
    knowledgeStateHash: hashCanonicalB0Value(input.knowledgeState),
    relationshipStateHash: hashCanonicalB0Value(input.relationshipState),
    createdAt: required(input.createdAt, "snapshot.createdAt"),
  };
  const checked = validateB0SettlementSnapshotV1(candidate);
  if (!checked.ok) throw new B0SettlementErrorV1("SETTLEMENT_SNAPSHOT_INVALID", checked.errors.join("; "));
  return deepFreeze(clone(checked.value));
}

export function computeB0BatchInputHashV1(input: {
  snapshot: B0SettlementSnapshotV1;
  intents: B0ActionContractV1[];
  dueSystemIntents?: B0ActionContractV1[];
}): string {
  return hashCanonicalB0Value({
    schemaVersion: "b0-batch-input-v1",
    snapshotId: input.snapshot.id,
    windowId: input.snapshot.windowId,
    roomId: input.snapshot.roomId,
    runId: input.snapshot.runId,
    baseWorldSequence: input.snapshot.baseWorldSequence,
    rulesetHash: input.snapshot.rulesetHash,
    worldStateHash: input.snapshot.worldStateHash,
    roleSetHash: input.snapshot.roleSetHash,
    knowledgeStateHash: input.snapshot.knowledgeStateHash,
    relationshipStateHash: input.snapshot.relationshipStateHash,
    intents: stableActions(input.intents),
    dueSystemIntents: stableActions(input.dueSystemIntents ?? []),
  });
}

export function prepareB0SettlementBatchV1(input: PrepareB0BatchInputV1): Readonly<B0SettlementBatchV1> {
  assertSnapshot(input.snapshot);
  const intents = stableActions(input.intents);
  const due = stableActions(input.dueSystemIntents ?? []);
  if (intents.length === 0) throw new B0SettlementErrorV1("RESOLUTION_INPUT_INCOMPLETE", "A batch requires at least one locked intent.");
  const candidate: B0SettlementBatchV1 = {
    schemaVersion: "b0-settlement-batch-v1",
    id: required(input.id, "batch.id"),
    windowId: input.snapshot.windowId,
    snapshotId: input.snapshot.id,
    roomId: input.snapshot.roomId,
    runId: input.snapshot.runId,
    baseWorldSequence: input.snapshot.baseWorldSequence,
    lockedIntentIds: intents.map((entry) => entry.id),
    dueSystemIntentIds: due.map((entry) => entry.id),
    status: "PREPARED",
    attempt: 0,
    inputHash: computeB0BatchInputHashV1({ snapshot: input.snapshot, intents, dueSystemIntents: due }),
    relationGraphHash: null,
    resolutionHash: null,
    createdAt: required(input.createdAt, "batch.createdAt"),
    resolvedAt: null,
    committedAt: null,
    completedAt: null,
  };
  const checked = validateB0SettlementBatchV1(candidate);
  if (!checked.ok) throw new B0SettlementErrorV1("SETTLEMENT_BATCH_INVALID", checked.errors.join("; "));
  return deepFreeze(clone(checked.value));
}

export function settleB0SingleIntentV1(input: SettleB0SingleIntentInputV1): B0SettlementResolutionV1 {
  const batch = prepareB0SettlementBatchV1({ id: input.batchId, snapshot: input.snapshot, intents: [input.intent], createdAt: input.createdAt });
  return settleB0BatchV1({ ruleset: input.ruleset, snapshot: input.snapshot, batch, intents: [input.intent] });
}

export function settleB0BatchV1(input: SettleB0BatchInputV1): B0SettlementResolutionV1 {
  return settleDeterministic(input, false);
}

export function settleB0BatchConservativelyV1(input: SettleB0BatchInputV1): B0SettlementResolutionV1 {
  return settleDeterministic(input, true);
}

function settleDeterministic(input: SettleB0BatchInputV1, conservative: boolean): B0SettlementResolutionV1 {
  const rules = validateB0RoomRulesetV1(input.ruleset);
  if (!rules.ok) throw new B0SettlementErrorV1("ROOM_RULESET_MISMATCH", rules.errors.join("; "));
  assertSnapshot(input.snapshot);
  assertBatch(input.batch);
  const intents = stableActions(input.intents);
  const due = stableActions(input.dueSystemIntents ?? []);
  assertSharedContext(rules.value, input.snapshot, input.batch, intents, due);
  if (input.batch.inputHash !== computeB0BatchInputHashV1({ snapshot: input.snapshot, intents, dueSystemIntents: due })) {
    throw new B0SettlementErrorV1("BATCH_INPUT_HASH_MISMATCH", "The sealed batch input does not match its immutable hash.");
  }
  const all = [...intents, ...due];
  assertHardConstraints(input.snapshot, all, all.length > 1);
  const relations = classifyIntentRelations(input.batch.id, all);
  const conflictGroups = buildConflictGroups(input.batch.id, all, relations);
  const statusByIntent = conservative ? conservativeStatuses(all) : resolveStatuses(all, relations, conflictGroups);
  const worldDelta = mergeB0WorldDeltaV1(
    all.flatMap((intent) => candidateMutations(intent, statusByIntent.get(intent.id) ?? "FAILED", input.batch.id, all.length > 1)),
    input.batch.id,
  );
  const causalEdges = buildCausalEdges(input.batch.id, all, relations, statusByIntent, worldDelta);
  const intentOutcomes = buildOutcomes(input.batch.id, all, statusByIntent, causalEdges);
  const structuredResults = buildStructuredResults(input.batch.id, all, intentOutcomes, worldDelta, input.snapshot);
  const withoutHash: Omit<B0SettlementResolutionV1, "resolutionHash"> = {
    schemaVersion: "b0-settlement-resolution-v1",
    batchId: input.batch.id,
    roomId: input.batch.roomId,
    runId: input.batch.runId,
    windowId: input.batch.windowId,
    baseWorldSequence: input.batch.baseWorldSequence,
    intentRelations: relations,
    conflictGroups,
    intentOutcomes,
    worldDelta: { mutations: worldDelta },
    structuredResults,
    pendingEffects: [],
    causalEdges,
    resolutionVersion: conservative ? "b0-conservative-multi-intent-resolution-v1" : "b0-deterministic-multi-intent-resolution-v1",
  };
  const resolution = { ...withoutHash, resolutionHash: hashCanonicalB0Value(withoutHash) };
  const checked = validateB0SettlementResolutionV1(resolution);
  if (!checked.ok) throw new B0SettlementErrorV1("RESOLUTION_VALIDATION_FAILED", checked.errors.join("; "));
  return deepFreeze(clone(checked.value));
}

export function classifyIntentRelations(batchId: string, intents: B0ActionContractV1[]): B0IntentRelationV1[] {
  const ordered = stableActions(intents);
  const result: B0IntentRelationV1[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const left = ordered[i];
      const right = ordered[j];
      const pair = classifyPair(left, right);
      result.push({
        schemaVersion: "b0-intent-relation-v1",
        id: stableId("relation", batchId, left.id, right.id),
        batchId,
        leftIntentId: left.id,
        rightIntentId: right.id,
        type: pair.type,
        basis: pair.basis,
        confidence: 1,
        classifierVersion: "b0-deterministic-relation-v1",
        evidenceRefs: [...new Set([...left.evidenceRefs, ...right.evidenceRefs])].sort(),
      });
    }
  }
  return result;
}

function classifyPair(left: B0ActionContractV1, right: B0ActionContractV1): Pick<B0IntentRelationV1, "type" | "basis"> {
  const sharedTarget = intersects(targetKeys(left), targetKeys(right));
  const sharedProposition = intersects(left.propositionRefs, right.propositionRefs);
  const sharedResource = intersects(left.resourceCommitments.map((entry) => entry.resourceId), right.resourceCommitments.map((entry) => entry.resourceId));
  if (sharedResource) return { type: "CONFLICTS", basis: "RESOURCE_CONTENTION" };
  if (!sharedTarget && !sharedProposition) return { type: "INDEPENDENT", basis: "WORLD_RULE" };
  if (directionsConflict(left.primaryEffect.direction, right.primaryEffect.direction)) {
    return { type: "CONFLICTS", basis: sharedProposition ? "PROPOSITION_OPPOSITION" : "TARGET_OVERLAP" };
  }
  if (left.primaryEffect.effectTypeId === right.primaryEffect.effectTypeId
    && left.primaryEffect.direction === right.primaryEffect.direction) {
    return { type: "SUPPORTS", basis: "TARGET_OVERLAP" };
  }
  return { type: "INDEPENDENT", basis: "WORLD_RULE" };
}

export function buildConflictGroups(
  batchId: string,
  intents: B0ActionContractV1[],
  relations: B0IntentRelationV1[],
): Array<{ conflictGroupId: string; intentIds: string[] }> {
  const ids = stableActions(intents).map((entry) => entry.id);
  const adjacency = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const relation of relations) {
    if (relation.type === "INDEPENDENT") continue;
    adjacency.get(relation.leftIntentId)?.add(relation.rightIntentId);
    adjacency.get(relation.rightIntentId)?.add(relation.leftIntentId);
  }
  const seen = new Set<string>();
  const groups: Array<{ conflictGroupId: string; intentIds: string[] }> = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const queue = [id];
    const component: string[] = [];
    seen.add(id);
    while (queue.length) {
      const current = queue.shift() as string;
      component.push(current);
      for (const neighbor of [...(adjacency.get(current) ?? [])].sort()) {
        if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); }
      }
    }
    component.sort();
    groups.push({ conflictGroupId: stableId("group", batchId, ...component), intentIds: component });
  }
  return groups.sort((a, b) => a.intentIds[0].localeCompare(b.intentIds[0]));
}

function resolveStatuses(
  intents: B0ActionContractV1[],
  relations: B0IntentRelationV1[],
  groups: Array<{ conflictGroupId: string; intentIds: string[] }>,
): Map<string, B0OutcomeStatusV1> {
  const byId = new Map(intents.map((entry) => [entry.id, entry]));
  const result = new Map<string, B0OutcomeStatusV1>();
  for (const group of groups) {
    const members = group.intentIds.map((id) => byId.get(id) as B0ActionContractV1);
    const related = relations.filter((entry) => group.intentIds.includes(entry.leftIntentId) && group.intentIds.includes(entry.rightIntentId));
    const support = related.filter((entry) => entry.type === "SUPPORTS");
    const conflict = related.filter((entry) => entry.type === "CONFLICTS");
    if (conflict.length === 0) {
      members.forEach((entry) => result.set(entry.id, "SUCCESS"));
      continue;
    }
    const coalitions = connectedComponents(group.intentIds, support);
    const scored = coalitions.map((ids) => ({ ids, score: ids.reduce((sum, id) => sum + strength(byId.get(id) as B0ActionContractV1), 0) }))
      .sort((a, b) => b.score - a.score || a.ids[0].localeCompare(b.ids[0]));
    const top = scored[0];
    const second = scored[1];
    if (!second || top.score === second.score) {
      members.forEach((entry) => result.set(entry.id, entry.kind === "HOLD" ? "SUCCESS" : "CONTESTED"));
    } else {
      const margin = top.score - second.score;
      for (const coalition of scored) {
        const winner = coalition === top;
        coalition.ids.forEach((id) => result.set(id, winner ? (margin >= 2 ? "SUCCESS" : "PARTIAL_SUCCESS") : "BLOCKED"));
      }
    }
  }
  return result;
}

function conservativeStatuses(intents: B0ActionContractV1[]): Map<string, B0OutcomeStatusV1> {
  return new Map(intents.map((entry) => [entry.id, entry.kind === "HOLD" || entry.kind === "OBSERVE" ? "SUCCESS" : "CONTESTED"]));
}

function connectedComponents(ids: string[], support: B0IntentRelationV1[]): string[][] {
  const adjacency = new Map(ids.map((id) => [id, new Set<string>()]));
  support.forEach((entry) => {
    adjacency.get(entry.leftIntentId)?.add(entry.rightIntentId);
    adjacency.get(entry.rightIntentId)?.add(entry.leftIntentId);
  });
  const seen = new Set<string>();
  const result: string[][] = [];
  for (const id of [...ids].sort()) {
    if (seen.has(id)) continue;
    const queue = [id];
    const component: string[] = [];
    seen.add(id);
    while (queue.length) {
      const current = queue.shift() as string;
      component.push(current);
      for (const next of [...(adjacency.get(current) ?? [])].sort()) {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    result.push(component.sort());
  }
  return result;
}

function candidateMutations(intent: B0ActionContractV1, status: B0OutcomeStatusV1, batchId: string, includeProactiveEffect: boolean): B0StateMutationV1[] {
  const costs = intent.resourceCommitments.map((entry) => ({
    mutationId: stableId("resource-cost", batchId, intent.id, entry.resourceId),
    entityType: "RESOURCE" as const,
    entityId: entry.resourceId,
    attribute: "quantity",
    operation: "INCREMENT" as const,
    value: -entry.amount,
    originIntentIds: [intent.id],
  }));
  if (!includeProactiveEffect || intent.kind === "HOLD" || intent.kind === "OBSERVE" || !["SUCCESS", "PARTIAL_SUCCESS"].includes(status)) return costs;
  const target = [...intent.targetRefs].sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`))[0];
  if (!target) return costs;
  const magnitude = magnitudeFor(intent.primaryEffect.requestedMagnitude, status);
  const direction = intent.primaryEffect.direction;
  const numeric = direction === "INCREASE" ? magnitude : direction === "DECREASE" ? -magnitude : null;
  return [...costs, {
    mutationId: stableId("effect", batchId, intent.id, target.type, target.id, intent.primaryEffect.effectTypeId),
    entityType: mutationEntityType(target),
    entityId: target.id,
    attribute: `effect.${intent.primaryEffect.effectTypeId}`,
    operation: numeric === null ? "SET" : "INCREMENT",
    value: numeric === null ? direction : numeric,
    originIntentIds: [intent.id],
  }];
}

export function mergeB0WorldDeltaV1(candidates: B0StateMutationV1[], batchId: string): B0StateMutationV1[] {
  const buckets = new Map<string, B0StateMutationV1[]>();
  for (const mutation of stableMutations(candidates)) {
    const key = [mutation.entityType, mutation.entityId, mutation.attribute, mutation.operation].join("|");
    buckets.set(key, [...(buckets.get(key) ?? []), mutation]);
  }
  const result: B0StateMutationV1[] = [];
  for (const [key, bucket] of [...buckets].sort(([a], [b]) => a.localeCompare(b))) {
    const [entityType, entityId, attribute, operation] = key.split("|") as [B0StateMutationV1["entityType"], string, string, B0StateMutationV1["operation"]];
    const origins = [...new Set(bucket.flatMap((entry) => entry.originIntentIds))].sort();
    let value: unknown;
    if (operation === "INCREMENT") {
      if (bucket.some((entry) => typeof entry.value !== "number" || !Number.isFinite(entry.value))) {
        throw new B0SettlementErrorV1("WORLD_DELTA_INVALID", `Increment mutation ${key} contains a non-finite value.`);
      }
      value = bucket.reduce((sum, entry) => sum + Number(entry.value), 0);
    } else {
      const hashes = new Set(bucket.map((entry) => hashCanonicalB0Value(entry.value)));
      if (hashes.size !== 1) throw new B0SettlementErrorV1("WORLD_DELTA_CONFLICT", `Mutation ${key} contains incompatible values.`);
      value = clone(bucket[0].value);
    }
    result.push({
      mutationId: stableId("mutation", batchId, entityType, entityId, attribute, operation, ...origins),
      entityType, entityId, attribute, operation, value, originIntentIds: origins,
    });
  }
  return result;
}

function buildCausalEdges(
  batchId: string,
  intents: B0ActionContractV1[],
  relations: B0IntentRelationV1[],
  statuses: Map<string, B0OutcomeStatusV1>,
  mutations: B0StateMutationV1[],
): B0CausalEdgeV1[] {
  const edges: B0CausalEdgeV1[] = intents.map((intent) => ({
    schemaVersion: "b0-causal-edge-v1",
    id: stableId("edge", batchId, intent.id, stableId("outcome", batchId, intent.id)),
    batchId,
    from: { type: "INTENT", id: intent.id },
    to: { type: "INTENT_OUTCOME", id: stableId("outcome", batchId, intent.id) },
    relation: "CAUSED",
  }));
  for (const relation of relations) {
    if (relation.type === "INDEPENDENT") continue;
    const relationName = relation.type === "SUPPORTS" ? "SUPPORTED" : "WEAKENED";
    edges.push(relationEdge(batchId, relation.leftIntentId, relation.rightIntentId,
      relation.type === "CONFLICTS" && statuses.get(relation.rightIntentId) === "BLOCKED" ? "BLOCKED" : relationName));
    edges.push(relationEdge(batchId, relation.rightIntentId, relation.leftIntentId,
      relation.type === "CONFLICTS" && statuses.get(relation.leftIntentId) === "BLOCKED" ? "BLOCKED" : relationName));
  }
  for (const mutation of mutations) {
    for (const origin of mutation.originIntentIds) {
      edges.push({
        schemaVersion: "b0-causal-edge-v1",
        id: stableId("edge", batchId, origin, mutation.mutationId),
        batchId,
        from: mutation.entityType === "RESOURCE" ? { type: "RESOURCE", id: mutation.entityId } : { type: "INTENT", id: origin },
        to: { type: "MUTATION", id: mutation.mutationId },
        relation: "CAUSED",
      });
    }
  }
  return edges.sort((a, b) => a.id.localeCompare(b.id));
}

function relationEdge(batchId: string, from: string, target: string, relation: B0CausalEdgeV1["relation"]): B0CausalEdgeV1 {
  return {
    schemaVersion: "b0-causal-edge-v1",
    id: stableId("edge", batchId, from, target, relation),
    batchId,
    from: { type: "INTENT", id: from },
    to: { type: "INTENT_OUTCOME", id: stableId("outcome", batchId, target) },
    relation,
  };
}

function buildOutcomes(
  batchId: string,
  intents: B0ActionContractV1[],
  statuses: Map<string, B0OutcomeStatusV1>,
  edges: B0CausalEdgeV1[],
): B0IntentOutcomeV1[] {
  return stableActions(intents).map((intent) => {
    const outcomeId = stableId("outcome", batchId, intent.id);
    const status = statuses.get(intent.id) ?? "FAILED";
    return {
      outcomeId,
      intentId: intent.id,
      actorId: intent.actorId,
      status,
      summary: outcomeSummary(intent, status),
      causalEdgeIds: edges.filter((edge) => edge.to.type === "INTENT_OUTCOME" && edge.to.id === outcomeId).map((edge) => edge.id).sort(),
    };
  });
}

function buildStructuredResults(
  batchId: string,
  intents: B0ActionContractV1[],
  outcomes: B0IntentOutcomeV1[],
  mutations: B0StateMutationV1[],
  snapshot: B0SettlementSnapshotV1,
): B0StructuredResultV1[] {
  const orderedIntents = stableActions(intents);
  const intentById = new Map(orderedIntents.map((entry) => [entry.id, entry]));
  const byIntent = new Map(outcomes.map((entry) => [entry.intentId, entry]));
  const actorIds = snapshotActorIds(snapshot);
  const detectedByIntent = extractB0AudienceResolverMapsV1(snapshot).detectedIntentActors ?? {};
  const crossResults: B0StructuredResultV1[] = [];
  const crossOwnedMutationIds = new Set<string>();

  for (const mutation of stableMutations(mutations)) {
    if (mutation.entityType !== "ACTOR" || !actorIds.has(mutation.entityId)) continue;
    const targetActorId = mutation.entityId;
    const externalOrigins = mutation.originIntentIds
      .map((intentId) => intentById.get(intentId))
      .filter((intent): intent is B0ActionContractV1 => intent !== undefined && intent.actorId !== targetActorId);
    if (!externalOrigins.length || !externalOrigins.every((intent) => intentTargetsActor(intent, targetActorId))) continue;
    if (!externalOrigins.every((intent) => canRecipientObserveImpact(intent, targetActorId, detectedByIntent))) continue;

    const originIntentIds = externalOrigins.map((entry) => entry.id).sort();
    const originActorIds = [...new Set(externalOrigins.map((entry) => entry.actorId))].sort();
    crossOwnedMutationIds.add(mutation.mutationId);
    crossResults.push({
      resultId: stableId("result", batchId, mutation.mutationId, "cross", targetActorId),
      resultKind: "CROSS_PLAYER_IMPACT",
      originIntentIds,
      originActorIds,
      targetActorIds: [targetActorId],
      summary: "The committed settlement changed your position in the shared situation.",
      durableMutationIds: [mutation.mutationId],
      audience: { type: "ACTOR_ONLY", actorRef: targetActorId },
    });
  }

  const personalResults: B0StructuredResultV1[] = orderedIntents.map((intent) => ({
    resultId: stableId("result", batchId, intent.id, "personal"),
    resultKind: "PERSONAL_OUTCOME",
    originIntentIds: [intent.id],
    originActorIds: [intent.actorId],
    targetActorIds: [intent.actorId],
    summary: (byIntent.get(intent.id) as B0IntentOutcomeV1).summary,
    durableMutationIds: mutations
      .filter((entry) => entry.originIntentIds.includes(intent.id) && !crossOwnedMutationIds.has(entry.mutationId))
      .map((entry) => entry.mutationId)
      .sort(),
    audience: { type: "ACTOR_ONLY", actorRef: intent.actorId },
  }));

  return [...personalResults, ...crossResults].sort((left, right) => left.resultId.localeCompare(right.resultId));
}

function snapshotActorIds(snapshot: B0SettlementSnapshotV1): Set<string> {
  const actorIds = new Set<string>();
  for (const raw of [...snapshot.actorStates, ...snapshot.roleBindings]) {
    const value = record(raw);
    const actorId = firstString(value, ["actorId", "id", "roleId"]);
    if (actorId) actorIds.add(actorId);
  }
  return actorIds;
}

function intentTargetsActor(intent: B0ActionContractV1, actorId: string): boolean {
  return intent.targetRefs.some((entry) => entry.type === "ACTOR" && entry.id === actorId);
}

function canRecipientObserveImpact(
  intent: B0ActionContractV1,
  recipientActorId: string,
  detectedByIntent: Readonly<Record<string, readonly string[]>>,
): boolean {
  if (intent.visibilityIntent.type === "PUBLIC") return true;
  if (intent.visibilityIntent.type === "PRIVATE") {
    return (intent.visibilityIntent.declaredRecipientRefs ?? []).includes(recipientActorId);
  }
  return (detectedByIntent[intent.id] ?? []).includes(recipientActorId);
}

export function buildB0BatchCommitManifestV1(input: BuildB0CommitManifestInputV1): B0BatchCommitManifestV1 {
  assertBatch(input.batch);
  assertSnapshot(input.snapshot);
  const checked = validateB0SettlementResolutionV1(input.resolution);
  if (!checked.ok) throw new B0SettlementErrorV1("RESOLUTION_VALIDATION_FAILED", checked.errors.join("; "));
  if (input.resolution.resolutionHash !== hashResolutionPayload(input.resolution)) {
    throw new B0SettlementErrorV1("RESOLUTION_HASH_MISMATCH", "The resolution payload does not match its hash.");
  }
  if (input.batch.id !== input.resolution.batchId || input.snapshot.id !== input.batch.snapshotId) {
    throw new B0SettlementErrorV1("BATCH_CONTEXT_MISMATCH", "Resolution, batch and snapshot context differ.");
  }
  const payload = {
    schemaVersion: "b0-batch-commit-manifest-v1" as const,
    batchId: input.batch.id,
    snapshotId: input.snapshot.id,
    windowId: input.batch.windowId,
    roomId: input.batch.roomId,
    runId: input.batch.runId,
    baseWorldSequence: input.batch.baseWorldSequence,
    committedWorldSequence: input.batch.baseWorldSequence + 1,
    rulesetHash: input.snapshot.rulesetHash,
    inputHash: input.batch.inputHash,
    resolutionHash: input.resolution.resolutionHash,
    resourceMutationKeys: [...new Set(input.resourceMutationKeys)].sort(),
    stateMutationKeys: [...new Set(input.stateMutationKeys ?? [])].sort(),
    publicationOutboxKeys: [...new Set(input.publicationOutboxKeys)].sort(),
    committedAt: required(input.committedAt, "manifest.committedAt"),
    authoritative: true as const,
  };
  const manifest = { ...payload, commitHash: hashCanonicalB0Value(payload) };
  const validated = validateB0BatchCommitManifestV1(manifest);
  if (!validated.ok) throw new B0SettlementErrorV1("COMMIT_MANIFEST_INVALID", validated.errors.join("; "));
  return deepFreeze(clone(validated.value));
}

export function hashResolutionPayload(resolution: B0SettlementResolutionV1): string {
  const { resolutionHash: _ignored, ...payload } = resolution;
  return hashCanonicalB0Value(payload);
}

function assertSharedContext(
  ruleset: B0RoomRulesetV1,
  snapshot: B0SettlementSnapshotV1,
  batch: B0SettlementBatchV1,
  intents: B0ActionContractV1[],
  due: B0ActionContractV1[],
): void {
  if (snapshot.rulesetHash !== hashB0RoomRulesetV1(ruleset) || snapshot.rulesetVersion !== ruleset.rulesetVersion) {
    throw new B0SettlementErrorV1("ROOM_RULESET_MISMATCH", "Snapshot ruleset binding is stale.");
  }
  const expected = [batch.windowId, batch.roomId, batch.runId, String(batch.baseWorldSequence), batch.snapshotId];
  const actual = [snapshot.windowId, snapshot.roomId, snapshot.runId, String(snapshot.baseWorldSequence), snapshot.id];
  if (expected.some((value, index) => value !== actual[index])) throw new B0SettlementErrorV1("BATCH_CONTEXT_MISMATCH", "Batch and snapshot context differ.");
  const actors = new Set<string>();
  for (const intent of [...intents, ...due]) {
    const checked = validateB0ActionContractV1(intent);
    if (!checked.ok) throw new B0SettlementErrorV1("INTENT_SCHEMA_INVALID", checked.errors.join("; "));
    if (intent.status !== "LOCKED") throw new B0SettlementErrorV1("INTENT_NOT_LOCKED", `Intent ${intent.id} is not locked.`);
    if (intent.windowId !== batch.windowId || intent.roomId !== batch.roomId || intent.runId !== batch.runId || intent.baseWorldSequence !== batch.baseWorldSequence) {
      throw new B0SettlementErrorV1("INTENT_CONTEXT_MISMATCH", `Intent ${intent.id} does not share the batch context.`);
    }
    if (actors.has(intent.actorId)) throw new B0SettlementErrorV1("ACTOR_INTENT_LIMIT_EXCEEDED", `Actor ${intent.actorId} has multiple primary intents.`);
    actors.add(intent.actorId);
  }
  if (intents.length > ruleset.maxHumanPlayers) throw new B0SettlementErrorV1("BATCH_ACTOR_LIMIT_EXCEEDED", "Batch exceeds the room actor limit.");
  if (batch.lockedIntentIds.join("|") !== intents.map((entry) => entry.id).join("|")) throw new B0SettlementErrorV1("BATCH_INTENT_SET_MISMATCH", "Locked intents do not match the batch.");
  if (batch.dueSystemIntentIds.join("|") !== due.map((entry) => entry.id).join("|")) throw new B0SettlementErrorV1("BATCH_SYSTEM_INTENT_SET_MISMATCH", "System intents do not match the batch.");
}

type Owned = { owners: Set<string>; quantity: number | null };
type RefIndex = {
  actors: Set<string>;
  actorRoles: Map<string, Set<string>>;
  groups: Set<string>;
  locations: Set<string>;
  propositions: Set<string>;
  evidence: Map<string, Set<string>>;
  resources: Map<string, Owned>;
  capabilities: Map<string, Owned>;
};

function assertHardConstraints(snapshot: B0SettlementSnapshotV1, intents: B0ActionContractV1[], strict: boolean): void {
  const index = buildRefIndex(snapshot);
  const demand = new Map<string, number>();
  for (const intent of intents) {
    if (intent.kind !== "HOLD" && intent.targetRefs.length !== 1) {
      throw new B0SettlementErrorV1("INTENT_EFFECT_UNSUPPORTED", `Intent ${intent.id} must have exactly one primary target.`);
    }
    for (const target of intent.targetRefs) {
      if (strict && !referenceExists(index, target)) throw new B0SettlementErrorV1("INTENT_TARGET_NOT_FOUND", `Intent ${intent.id} references unknown ${target.type}:${target.id}.`);
    }
    for (const resource of intent.resourceCommitments) {
      const found = index.resources.get(resource.resourceId);
      if (!found && strict) throw new B0SettlementErrorV1("INTENT_RESOURCE_INSUFFICIENT", `Resource ${resource.resourceId} is absent from the snapshot.`);
      if (found && found.owners.size && !ownedBy(index, intent.actorId, found.owners)) throw new B0SettlementErrorV1("ACTOR_OWNERSHIP_MISMATCH", `Actor ${intent.actorId} does not own resource ${resource.resourceId}.`);
      demand.set(resource.resourceId, (demand.get(resource.resourceId) ?? 0) + resource.amount);
    }
    for (const capabilityId of intent.capabilityRefs) {
      const found = index.capabilities.get(capabilityId);
      if (!found && strict) throw new B0SettlementErrorV1("INTENT_CAPABILITY_UNAVAILABLE", `Capability ${capabilityId} is absent from the snapshot.`);
      if (found && found.owners.size && !ownedBy(index, intent.actorId, found.owners)) throw new B0SettlementErrorV1("ACTOR_OWNERSHIP_MISMATCH", `Actor ${intent.actorId} does not own capability ${capabilityId}.`);
    }
    for (const evidenceId of intent.evidenceRefs) {
      const owners = index.evidence.get(evidenceId);
      if (!owners && strict) throw new B0SettlementErrorV1("INTENT_KNOWLEDGE_VIOLATION", `Evidence ${evidenceId} is absent from the knowledge snapshot.`);
      if (owners?.size && !ownedBy(index, intent.actorId, owners)) throw new B0SettlementErrorV1("INTENT_KNOWLEDGE_VIOLATION", `Actor ${intent.actorId} cannot use evidence ${evidenceId}.`);
    }
  }
  for (const [resourceId, requiredAmount] of demand) {
    const available = index.resources.get(resourceId)?.quantity;
    if (available !== null && available !== undefined && requiredAmount > available) {
      throw new B0SettlementErrorV1("INTENT_RESOURCE_INSUFFICIENT", `Resource ${resourceId} requires ${requiredAmount} but only ${available} is available.`);
    }
  }
}

function buildRefIndex(snapshot: B0SettlementSnapshotV1): RefIndex {
  const index: RefIndex = {
    actors: new Set(), actorRoles: new Map(), groups: new Set(), locations: new Set(), propositions: new Set(),
    evidence: new Map(), resources: new Map(), capabilities: new Map(),
  };
  visit(snapshot.actorStates, (value) => {
    const actorId = firstString(value, ["actorId", "id"]); if (actorId) index.actors.add(actorId);
  });
  visit(snapshot.roleBindings, (value) => {
    const actor = firstString(value, ["actorId"]); const role = firstString(value, ["roleId"]);
    if (actor) index.actors.add(actor);
    if (actor && role) index.actorRoles.set(actor, new Set([...(index.actorRoles.get(actor) ?? []), role]));
  });
  visit(snapshot.worldState, (value) => {
    const id = firstString(value, ["id"]); if (!id) return;
    const kind = firstString(value, ["type", "kind", "entityType"]);
    if (kind === "GROUP" || String(kind).toLowerCase().includes("group")) index.groups.add(id);
    if (kind === "LOCATION" || String(kind).toLowerCase().includes("location")) index.locations.add(id);
    if (kind === "PROPOSITION" || String(kind).toLowerCase().includes("proposition")) index.propositions.add(id);
  });
  const world = record(snapshot.worldState);
  for (const value of array(world?.groups)) { const id = firstString(record(value), ["id"]); if (id) index.groups.add(id); }
  for (const value of array(world?.locations)) { const id = firstString(record(value), ["id"]); if (id) index.locations.add(id); }
  for (const value of array(world?.propositions)) { const id = firstString(record(value), ["id"]); if (id) index.propositions.add(id); }
  collectOwned(snapshot.resourceState, index.resources, ["resourceId", "id", "assetKey"]);
  collectOwned(snapshot.activeCapabilities, index.capabilities, ["capabilityId", "id"]);
  collectEvidence(snapshot.knowledgeState, index.evidence);
  return index;
}

function collectOwned(source: unknown, target: Map<string, Owned>, keys: string[]): void {
  visit(source, (value) => {
    const id = firstString(value, keys); if (!id) return;
    const owners = new Set<string>();
    for (const key of ["ownerActorId", "actorId", "ownerRoleId", "roleId"]) {
      if (typeof value[key] === "string") owners.add(value[key] as string);
    }
    const quantity = typeof value.quantity === "number" && Number.isFinite(value.quantity) ? value.quantity : null;
    target.set(id, { owners, quantity });
  });
}

function collectEvidence(source: unknown, target: Map<string, Set<string>>): void {
  const root = record(source);
  const byActor = record(root?.byActor);
  if (byActor) {
    for (const [actorId, state] of Object.entries(byActor)) {
      const entry = record(state);
      for (const key of ["evidenceIds", "knownEvidenceIds"]) {
        for (const evidenceId of stringValues(entry?.[key])) target.set(evidenceId, new Set([...(target.get(evidenceId) ?? []), actorId]));
      }
    }
  }
  visit(source, (value) => {
    const id = firstString(value, ["evidenceId"]); if (!id) return;
    const owners = new Set<string>();
    for (const key of ["ownerActorId", "actorId", "ownerRoleId", "roleId"]) if (typeof value[key] === "string") owners.add(value[key] as string);
    target.set(id, new Set([...(target.get(id) ?? []), ...owners]));
  });
}

function referenceExists(index: RefIndex, ref: B0TargetRefV1): boolean {
  if (ref.type === "ACTOR") return index.actors.has(ref.id);
  if (ref.type === "GROUP") return index.groups.has(ref.id);
  if (ref.type === "LOCATION") return index.locations.has(ref.id);
  if (ref.type === "PROPOSITION") return index.propositions.has(ref.id);
  if (ref.type === "RESOURCE") return index.resources.has(ref.id);
  if (ref.type === "EVIDENCE") return index.evidence.has(ref.id);
  return index.capabilities.has(ref.id);
}

function ownedBy(index: RefIndex, actorId: string, owners: Set<string>): boolean {
  if (owners.has(actorId)) return true;
  return [...(index.actorRoles.get(actorId) ?? [])].some((roleId) => owners.has(roleId));
}

function strength(intent: B0ActionContractV1): number {
  if (intent.kind === "HOLD") return 0;
  const base = intent.kind === "OBSERVE" ? 1 : 2;
  const magnitude = { MINOR: 1, MODERATE: 2, MAJOR: 3 }[intent.primaryEffect.requestedMagnitude];
  const resources = Math.min(3, intent.resourceCommitments.reduce((sum, entry) => sum + entry.amount, 0));
  return base + magnitude + resources + intent.evidenceRefs.length + intent.capabilityRefs.length;
}

function magnitudeFor(value: "MINOR" | "MODERATE" | "MAJOR", status: B0OutcomeStatusV1): number {
  const magnitude = { MINOR: 1, MODERATE: 2, MAJOR: 3 }[value];
  return status === "PARTIAL_SUCCESS" ? Math.max(1, Math.floor(magnitude / 2)) : magnitude;
}

function mutationEntityType(target: B0TargetRefV1): B0StateMutationV1["entityType"] {
  if (target.type === "ACTOR" || target.type === "CAPABILITY") return "ACTOR";
  if (target.type === "GROUP") return "INSTITUTION";
  if (target.type === "LOCATION") return "LOCATION";
  if (target.type === "RESOURCE") return "RESOURCE";
  if (target.type === "EVIDENCE") return "EVIDENCE";
  return "WORLD";
}

function directionsConflict(left: B0ActionContractV1["primaryEffect"]["direction"], right: B0ActionContractV1["primaryEffect"]["direction"]): boolean {
  return [["INCREASE", "DECREASE"], ["CREATE", "BLOCK"], ["PROTECT", "BLOCK"], ["REVEAL", "CONCEAL"]]
    .some(([a, b]) => (left === a && right === b) || (left === b && right === a));
}

function targetKeys(intent: B0ActionContractV1): string[] {
  return intent.targetRefs.map((entry) => `${entry.type}:${entry.id}`).sort();
}

function intersects(left: string[], right: string[]): boolean {
  const set = new Set(right); return left.some((entry) => set.has(entry));
}

function outcomeSummary(intent: B0ActionContractV1, status: B0OutcomeStatusV1): string {
  if (intent.kind === "HOLD") return "The actor holds position without creating a proactive world change.";
  const prefix: Record<B0OutcomeStatusV1, string> = {
    SUCCESS: "Succeeded: ", PARTIAL_SUCCESS: "Partially succeeded: ", CONTESTED: "Remains contested: ", BLOCKED: "Was blocked: ", FAILED: "Failed: ",
  };
  return `${prefix[status]}${intent.normalizedSummary}`;
}

function stableActions(values: B0ActionContractV1[]): B0ActionContractV1[] {
  return values.map(clone).sort((a, b) => a.id.localeCompare(b.id));
}

function stableMutations(values: B0StateMutationV1[]): B0StateMutationV1[] {
  return [...values].sort((a, b) => a.entityType.localeCompare(b.entityType)
    || a.entityId.localeCompare(b.entityId) || a.attribute.localeCompare(b.attribute)
    || a.operation.localeCompare(b.operation) || a.mutationId.localeCompare(b.mutationId));
}

function assertSnapshot(value: B0SettlementSnapshotV1): void {
  const checked = validateB0SettlementSnapshotV1(value);
  if (!checked.ok) throw new B0SettlementErrorV1("SETTLEMENT_SNAPSHOT_INVALID", checked.errors.join("; "));
}

function assertBatch(value: B0SettlementBatchV1): void {
  const checked = validateB0SettlementBatchV1(value);
  if (!checked.ok) throw new B0SettlementErrorV1("SETTLEMENT_BATCH_INVALID", checked.errors.join("; "));
}

function stableId(kind: string, ...parts: string[]): string {
  return `b0.${kind}.${hashCanonicalB0Value(parts).slice(0, 24)}`;
}

function required(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new B0SettlementErrorV1("B0_REQUIRED_FIELD", `${path} is required.`);
  return value;
}

function nonNegative(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new B0SettlementErrorV1("B0_INVALID_INTEGER", `${path} must be >= 0.`);
  return Number(value);
}

function visit(source: unknown, visitor: (value: Record<string, unknown>) => void): void {
  if (Array.isArray(source)) { source.forEach((entry) => visit(entry, visitor)); return; }
  const value = record(source); if (!value) return;
  visitor(value);
  Object.values(value).forEach((entry) => visit(entry, visitor));
}

function firstString(value: Record<string, unknown> | null, keys: string[]): string | null {
  if (!value) return null;
  for (const key of keys) if (typeof value[key] === "string" && (value[key] as string).length) return value[key] as string;
  return null;
}

function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function stringValues(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []; }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, clone(entry)])) as T;
}
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) { value.forEach(deepFreeze); return Object.freeze(value); }
  if (value && typeof value === "object") { Object.values(value as Record<string, unknown>).forEach(deepFreeze); return Object.freeze(value); }
  return value;
}
