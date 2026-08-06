import type {
  B0ActionContractV1,
  B0BatchCommitManifestV1,
  B0RoomRulesetV1,
  B0SettlementBatchV1,
  B0SettlementResolutionV1,
  B0SettlementSnapshotV1,
  B0StateMutationV1,
} from "@ai-story/shared";
import {
  validateB0ActionContractV1,
  validateB0BatchCommitManifestV1,
  validateB0RoomRulesetV1,
  validateB0SettlementBatchV1,
  validateB0SettlementResolutionV1,
  validateB0SettlementSnapshotV1,
} from "../../../shared/dist/index.js";
import { hashB0RoomRulesetV1, hashCanonicalB0Value } from "./b0-settlement";

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
  publicationOutboxKeys: string[];
};

export class B0SettlementErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "B0SettlementErrorV1";
  }
}

export function captureB0SettlementSnapshotV1(input: CaptureB0SnapshotInputV1): Readonly<B0SettlementSnapshotV1> {
  const rulesetValidation = validateB0RoomRulesetV1(input.ruleset);
  if (!rulesetValidation.ok) throw new B0SettlementErrorV1("ROOM_RULESET_MISMATCH", rulesetValidation.errors.join("; "));
  const candidate: B0SettlementSnapshotV1 = {
    schemaVersion: "b0-settlement-snapshot-v1",
    id: required(input.id, "snapshot.id"),
    windowId: required(input.windowId, "snapshot.windowId"),
    roomId: required(input.roomId, "snapshot.roomId"),
    runId: required(input.runId, "snapshot.runId"),
    baseWorldSequence: nonNegative(input.baseWorldSequence, "snapshot.baseWorldSequence"),
    rulesetVersion: rulesetValidation.value.rulesetVersion,
    rulesetHash: hashB0RoomRulesetV1(rulesetValidation.value),
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
  const validation = validateB0SettlementSnapshotV1(candidate);
  if (!validation.ok) throw new B0SettlementErrorV1("SETTLEMENT_SNAPSHOT_INVALID", validation.errors.join("; "));
  return deepFreeze(clone(validation.value));
}

export function computeB0BatchInputHashV1(input: {
  snapshot: B0SettlementSnapshotV1;
  intents: B0ActionContractV1[];
  dueSystemIntents?: B0ActionContractV1[];
}): string {
  const intents = stableActions(input.intents);
  const dueSystemIntents = stableActions(input.dueSystemIntents ?? []);
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
    intents,
    dueSystemIntents,
  });
}

export function prepareB0SettlementBatchV1(input: PrepareB0BatchInputV1): Readonly<B0SettlementBatchV1> {
  assertSnapshot(input.snapshot);
  const intents = stableActions(input.intents);
  const dueSystemIntents = stableActions(input.dueSystemIntents ?? []);
  if (intents.length === 0) throw new B0SettlementErrorV1("RESOLUTION_INPUT_INCOMPLETE", "A batch requires at least one locked intent.");
  const candidate: B0SettlementBatchV1 = {
    schemaVersion: "b0-settlement-batch-v1",
    id: required(input.id, "batch.id"),
    windowId: input.snapshot.windowId,
    snapshotId: input.snapshot.id,
    roomId: input.snapshot.roomId,
    runId: input.snapshot.runId,
    baseWorldSequence: input.snapshot.baseWorldSequence,
    lockedIntentIds: intents.map((intent) => intent.id),
    dueSystemIntentIds: dueSystemIntents.map((intent) => intent.id),
    status: "PREPARED",
    attempt: 0,
    inputHash: computeB0BatchInputHashV1({ snapshot: input.snapshot, intents, dueSystemIntents }),
    relationGraphHash: null,
    resolutionHash: null,
    createdAt: required(input.createdAt, "batch.createdAt"),
    resolvedAt: null,
    committedAt: null,
    completedAt: null,
  };
  const validation = validateB0SettlementBatchV1(candidate);
  if (!validation.ok) throw new B0SettlementErrorV1("SETTLEMENT_BATCH_INVALID", validation.errors.join("; "));
  return deepFreeze(clone(validation.value));
}

export function settleB0SingleIntentV1(input: SettleB0SingleIntentInputV1): B0SettlementResolutionV1 {
  const batch = prepareB0SettlementBatchV1({
    id: input.batchId,
    snapshot: input.snapshot,
    intents: [input.intent],
    createdAt: input.createdAt,
  });
  return settleB0BatchV1({ ruleset: input.ruleset, snapshot: input.snapshot, batch, intents: [input.intent] });
}

export function settleB0BatchV1(input: SettleB0BatchInputV1): B0SettlementResolutionV1 {
  const rulesetValidation = validateB0RoomRulesetV1(input.ruleset);
  if (!rulesetValidation.ok) throw new B0SettlementErrorV1("ROOM_RULESET_MISMATCH", rulesetValidation.errors.join("; "));
  assertSnapshot(input.snapshot);
  assertBatch(input.batch);
  const intents = stableActions(input.intents);
  const dueSystemIntents = stableActions(input.dueSystemIntents ?? []);
  if (intents.length !== 1) {
    throw new B0SettlementErrorV1("B0_MULTI_INTENT_REQUIRES_C4", "C2 accepts exactly one primary intent; multi-intent resolution is introduced in C4.");
  }
  if (dueSystemIntents.length !== 0) {
    throw new B0SettlementErrorV1("B0_DUE_SYSTEM_INTENTS_REQUIRE_C4", "C2 does not yet merge due system intents.");
  }
  assertSharedContext(rulesetValidation.value, input.snapshot, input.batch, intents, dueSystemIntents);
  const expectedInputHash = computeB0BatchInputHashV1({ snapshot: input.snapshot, intents, dueSystemIntents });
  if (input.batch.inputHash !== expectedInputHash) {
    throw new B0SettlementErrorV1("BATCH_INPUT_HASH_MISMATCH", "The sealed batch input does not match its immutable hash.");
  }

  const intent = intents[0];
  const mutations = resourceMutations(intent, input.batch.id);
  const outcomeId = stableId("outcome", input.batch.id, intent.id);
  const resultId = stableId("result", input.batch.id, intent.id);
  const intentEdgeId = stableId("edge", input.batch.id, intent.id, outcomeId);
  const causalEdges = [{
    schemaVersion: "b0-causal-edge-v1" as const,
    id: intentEdgeId,
    batchId: input.batch.id,
    from: { type: "INTENT" as const, id: intent.id },
    to: { type: "INTENT_OUTCOME" as const, id: outcomeId },
    relation: "CAUSED" as const,
  }, ...mutations.map((mutation) => ({
    schemaVersion: "b0-causal-edge-v1" as const,
    id: stableId("edge", input.batch.id, intent.id, mutation.mutationId),
    batchId: input.batch.id,
    from: { type: "RESOURCE" as const, id: mutation.entityId },
    to: { type: "MUTATION" as const, id: mutation.mutationId },
    relation: "CAUSED" as const,
  }))];
  const status = intent.kind === "HOLD" || intent.kind === "OBSERVE" ? "SUCCESS" as const : "CONTESTED" as const;
  const resultWithoutHash: Omit<B0SettlementResolutionV1, "resolutionHash"> = {
    schemaVersion: "b0-settlement-resolution-v1",
    batchId: input.batch.id,
    roomId: input.batch.roomId,
    runId: input.batch.runId,
    windowId: input.batch.windowId,
    baseWorldSequence: input.batch.baseWorldSequence,
    intentRelations: [],
    conflictGroups: [{ conflictGroupId: stableId("group", input.batch.id, intent.id), intentIds: [intent.id] }],
    intentOutcomes: [{
      outcomeId,
      intentId: intent.id,
      actorId: intent.actorId,
      status,
      summary: intent.kind === "HOLD"
        ? "The actor holds position without creating a proactive world change."
        : intent.normalizedSummary,
      causalEdgeIds: causalEdges.map((edge) => edge.id),
    }],
    worldDelta: { mutations },
    structuredResults: [{
      resultId,
      resultKind: "PERSONAL_OUTCOME",
      originIntentIds: [intent.id],
      originActorIds: [intent.actorId],
      targetActorIds: [intent.actorId],
      summary: intent.kind === "HOLD" ? "No proactive action was committed." : intent.normalizedSummary,
      durableMutationIds: mutations.map((mutation) => mutation.mutationId),
      audience: { type: "ACTOR_ONLY", actorRef: intent.actorId },
    }],
    pendingEffects: [],
    causalEdges,
    resolutionVersion: "b0-single-intent-resolution-v1",
  };
  const resolution: B0SettlementResolutionV1 = {
    ...resultWithoutHash,
    resolutionHash: hashCanonicalB0Value(resultWithoutHash),
  };
  const validation = validateB0SettlementResolutionV1(resolution);
  if (!validation.ok) throw new B0SettlementErrorV1("RESOLUTION_VALIDATION_FAILED", validation.errors.join("; "));
  return deepFreeze(clone(validation.value));
}

export function buildB0BatchCommitManifestV1(input: BuildB0CommitManifestInputV1): B0BatchCommitManifestV1 {
  assertBatch(input.batch);
  assertSnapshot(input.snapshot);
  const resolutionValidation = validateB0SettlementResolutionV1(input.resolution);
  if (!resolutionValidation.ok) throw new B0SettlementErrorV1("RESOLUTION_VALIDATION_FAILED", resolutionValidation.errors.join("; "));
  if (input.resolution.resolutionHash !== hashResolutionPayload(input.resolution)) {
    throw new B0SettlementErrorV1("RESOLUTION_HASH_MISMATCH", "The resolution payload does not match its hash.");
  }
  if (input.batch.id !== input.resolution.batchId || input.batch.id === "") throw new B0SettlementErrorV1("BATCH_CONTEXT_MISMATCH", "Resolution batch mismatch.");
  if (input.snapshot.id !== input.batch.snapshotId) throw new B0SettlementErrorV1("SNAPSHOT_CONTEXT_MISMATCH", "Batch snapshot mismatch.");
  const withoutCommitHash = {
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
    publicationOutboxKeys: [...new Set(input.publicationOutboxKeys)].sort(),
    committedAt: required(input.committedAt, "manifest.committedAt"),
    authoritative: true as const,
  };
  const manifest: B0BatchCommitManifestV1 = {
    ...withoutCommitHash,
    commitHash: hashCanonicalB0Value(withoutCommitHash),
  };
  const validation = validateB0BatchCommitManifestV1(manifest);
  if (!validation.ok) throw new B0SettlementErrorV1("COMMIT_MANIFEST_INVALID", validation.errors.join("; "));
  return deepFreeze(clone(validation.value));
}

export function hashResolutionPayload(resolution: B0SettlementResolutionV1): string {
  const { resolutionHash: _ignored, ...payload } = resolution;
  return hashCanonicalB0Value(payload);
}

function resourceMutations(intent: B0ActionContractV1, batchId: string): B0StateMutationV1[] {
  return [...intent.resourceCommitments]
    .sort((left, right) => left.resourceId.localeCompare(right.resourceId) || left.amount - right.amount)
    .map((entry) => ({
      mutationId: stableId("mutation", batchId, intent.id, entry.resourceId),
      entityType: "RESOURCE" as const,
      entityId: entry.resourceId,
      attribute: "quantity",
      operation: "INCREMENT" as const,
      value: -entry.amount,
      originIntentIds: [intent.id],
    }));
}

function assertSharedContext(
  ruleset: B0RoomRulesetV1,
  snapshot: B0SettlementSnapshotV1,
  batch: B0SettlementBatchV1,
  intents: B0ActionContractV1[],
  dueSystemIntents: B0ActionContractV1[],
): void {
  if (snapshot.rulesetHash !== hashB0RoomRulesetV1(ruleset) || snapshot.rulesetVersion !== ruleset.rulesetVersion) {
    throw new B0SettlementErrorV1("ROOM_RULESET_MISMATCH", "Snapshot ruleset binding is stale.");
  }
  for (const [label, actual, expected] of [
    ["windowId", batch.windowId, snapshot.windowId],
    ["roomId", batch.roomId, snapshot.roomId],
    ["runId", batch.runId, snapshot.runId],
    ["baseWorldSequence", String(batch.baseWorldSequence), String(snapshot.baseWorldSequence)],
    ["snapshotId", batch.snapshotId, snapshot.id],
  ]) {
    if (actual !== expected) throw new B0SettlementErrorV1("BATCH_CONTEXT_MISMATCH", `${label} differs across batch and snapshot.`);
  }
  const actorIds = new Set<string>();
  for (const intent of [...intents, ...dueSystemIntents]) {
    const validation = validateB0ActionContractV1(intent);
    if (!validation.ok) throw new B0SettlementErrorV1("INTENT_SCHEMA_INVALID", validation.errors.join("; "));
    if (intent.status !== "LOCKED") throw new B0SettlementErrorV1("INTENT_NOT_LOCKED", `Intent ${intent.id} is not locked.`);
    if (intent.windowId !== batch.windowId || intent.roomId !== batch.roomId || intent.runId !== batch.runId
      || intent.baseWorldSequence !== batch.baseWorldSequence) {
      throw new B0SettlementErrorV1("INTENT_CONTEXT_MISMATCH", `Intent ${intent.id} does not share the batch context.`);
    }
    if (actorIds.has(intent.actorId)) throw new B0SettlementErrorV1("ACTOR_INTENT_LIMIT_EXCEEDED", `Actor ${intent.actorId} has multiple primary intents.`);
    actorIds.add(intent.actorId);
  }
  if (intents.length > ruleset.maxHumanPlayers) throw new B0SettlementErrorV1("BATCH_ACTOR_LIMIT_EXCEEDED", "Batch exceeds the frozen room actor limit.");
  if (batch.lockedIntentIds.join("|") !== intents.map((intent) => intent.id).join("|")) {
    throw new B0SettlementErrorV1("BATCH_INTENT_SET_MISMATCH", "Locked intent IDs do not match the batch input.");
  }
  if (batch.dueSystemIntentIds.join("|") !== dueSystemIntents.map((intent) => intent.id).join("|")) {
    throw new B0SettlementErrorV1("BATCH_SYSTEM_INTENT_SET_MISMATCH", "Due system intent IDs do not match the batch input.");
  }
}

function stableActions(actions: B0ActionContractV1[]): B0ActionContractV1[] {
  return actions.map((action) => clone(action)).sort((left, right) => left.id.localeCompare(right.id));
}

function assertSnapshot(value: B0SettlementSnapshotV1): void {
  const validation = validateB0SettlementSnapshotV1(value);
  if (!validation.ok) throw new B0SettlementErrorV1("SETTLEMENT_SNAPSHOT_INVALID", validation.errors.join("; "));
}

function assertBatch(value: B0SettlementBatchV1): void {
  const validation = validateB0SettlementBatchV1(value);
  if (!validation.ok) throw new B0SettlementErrorV1("SETTLEMENT_BATCH_INVALID", validation.errors.join("; "));
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

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => clone(entry)) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, clone(entry)])) as T;
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach((entry) => deepFreeze(entry));
    return Object.freeze(value);
  }
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((entry) => deepFreeze(entry));
    return Object.freeze(value);
  }
  return value;
}
