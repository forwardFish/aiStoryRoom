import type {
  B0BatchCommitManifestV1,
  B0SettlementBatchV1,
  B0SettlementResolutionV1,
  B0SettlementSnapshotV1,
  B0StateMutationV1,
} from "@ai-story/shared";
import {
  validateB0BatchCommitManifestV1,
  validateB0SettlementBatchV1,
  validateB0SettlementResolutionV1,
  validateB0SettlementSnapshotV1,
} from "@ai-story/shared";
import {
  buildB0BatchCommitManifestV1,
  hashResolutionPayload,
} from "@ai-story/templates";

export type B0CommitInputV1 = {
  batch: B0SettlementBatchV1;
  snapshot: B0SettlementSnapshotV1;
  resolution: B0SettlementResolutionV1;
  committedAt: string;
};

export type B0CommitContextV1 = {
  roomId: string;
  runId: string;
  windowId: string;
  nodeId: string;
  currentWorldSequence: number;
};

export type B0CommitResultV1 = {
  status: "COMMITTED" | "ALREADY_COMMITTED";
  manifest: B0BatchCommitManifestV1;
};

export interface B0CommitTransactionV1 {
  readContext(input: B0CommitInputV1): Promise<B0CommitContextV1>;
  readManifest(batchId: string, windowId: string): Promise<B0BatchCommitManifestV1 | null>;
  applyResourceMutation(input: {
    batch: B0SettlementBatchV1;
    mutation: B0StateMutationV1;
  }): Promise<string>;
  applyStateMutation(input: {
    batch: B0SettlementBatchV1;
    mutation: B0StateMutationV1;
  }): Promise<string>;
  advanceWorldSequence(input: {
    runId: string;
    expected: number;
    next: number;
  }): Promise<boolean>;
  enqueuePublication(input: {
    context: B0CommitContextV1;
    batch: B0SettlementBatchV1;
    resolution: B0SettlementResolutionV1;
    outboxKey: string;
  }): Promise<void>;
  persistCommit(input: {
    context: B0CommitContextV1;
    batch: B0SettlementBatchV1;
    snapshot: B0SettlementSnapshotV1;
    resolution: B0SettlementResolutionV1;
    manifest: B0BatchCommitManifestV1;
  }): Promise<void>;
}

export class B0CommitErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "B0CommitErrorV1";
  }
}

export async function commitB0SettlementV1(
  tx: B0CommitTransactionV1,
  input: B0CommitInputV1,
): Promise<B0CommitResultV1> {
  assertInput(input);
  const existing = await tx.readManifest(input.batch.id, input.batch.windowId);
  if (existing) {
    if (existing.resolutionHash !== input.resolution.resolutionHash
      || existing.inputHash !== input.batch.inputHash
      || existing.runId !== input.batch.runId
      || existing.windowId !== input.batch.windowId) {
      throw new B0CommitErrorV1("BATCH_COMMIT_HASH_MISMATCH", "The batch was already committed with a different payload.");
    }
    return { status: "ALREADY_COMMITTED", manifest: existing };
  }

  const context = await tx.readContext(input);
  assertContext(context, input);
  if (context.currentWorldSequence !== input.batch.baseWorldSequence) {
    throw new B0CommitErrorV1("WORLD_SEQUENCE_MISMATCH", "The authoritative world sequence moved before commit.");
  }

  const resourceMutationKeys: string[] = [];
  const stateMutationKeys: string[] = [];
  for (const mutation of stableMutations(input.resolution.worldDelta.mutations)) {
    if (isResourceQuantityMutation(mutation)) {
      assertResourceMutation(mutation);
      resourceMutationKeys.push(await tx.applyResourceMutation({ batch: input.batch, mutation }));
    } else {
      assertStateMutation(mutation);
      stateMutationKeys.push(await tx.applyStateMutation({ batch: input.batch, mutation }));
    }
  }

  const advanced = await tx.advanceWorldSequence({
    runId: input.batch.runId,
    expected: input.batch.baseWorldSequence,
    next: input.batch.baseWorldSequence + 1,
  });
  if (!advanced) throw new B0CommitErrorV1("WORLD_SEQUENCE_MISMATCH", "The world sequence compare-and-set did not succeed.");

  const publicationOutboxKeys = [`b0-publication:${input.batch.id}`];
  await tx.enqueuePublication({
    context,
    batch: input.batch,
    resolution: input.resolution,
    outboxKey: publicationOutboxKeys[0],
  });
  const manifest = buildB0BatchCommitManifestV1({
    batch: input.batch,
    snapshot: input.snapshot,
    resolution: input.resolution,
    committedAt: input.committedAt,
    resourceMutationKeys,
    stateMutationKeys,
    publicationOutboxKeys,
  });
  await tx.persistCommit({
    context,
    batch: input.batch,
    snapshot: input.snapshot,
    resolution: input.resolution,
    manifest,
  });
  return { status: "COMMITTED", manifest };
}

function isResourceQuantityMutation(mutation: B0StateMutationV1): boolean {
  return mutation.entityType === "RESOURCE" && mutation.attribute === "quantity" && mutation.operation === "INCREMENT";
}

function assertResourceMutation(mutation: B0StateMutationV1): void {
  if (typeof mutation.value !== "number" || !Number.isFinite(mutation.value) || mutation.value > 0) {
    throw new B0CommitErrorV1("RESOURCE_MUTATION_INVALID", `Resource mutation ${mutation.mutationId} must be a finite non-positive delta.`);
  }
  if (!Number.isInteger(mutation.value)) {
    throw new B0CommitErrorV1("RESOURCE_MUTATION_INVALID", `Resource mutation ${mutation.mutationId} must be an integer delta.`);
  }
  if (mutation.originIntentIds.length === 0) {
    throw new B0CommitErrorV1("RESOURCE_MUTATION_INVALID", `Resource mutation ${mutation.mutationId} has no causal origin.`);
  }
}

function assertStateMutation(mutation: B0StateMutationV1): void {
  if (mutation.originIntentIds.length === 0) {
    throw new B0CommitErrorV1("STATE_MUTATION_INVALID", `State mutation ${mutation.mutationId} has no causal origin.`);
  }
  if (mutation.operation === "INCREMENT" && (typeof mutation.value !== "number" || !Number.isFinite(mutation.value))) {
    throw new B0CommitErrorV1("STATE_MUTATION_INVALID", `State mutation ${mutation.mutationId} has a non-finite increment.`);
  }
  if (mutation.value === undefined) {
    throw new B0CommitErrorV1("STATE_MUTATION_INVALID", `State mutation ${mutation.mutationId} has no value.`);
  }
  try {
    JSON.stringify(mutation.value);
  } catch {
    throw new B0CommitErrorV1("STATE_MUTATION_INVALID", `State mutation ${mutation.mutationId} is not serializable.`);
  }
}

function assertInput(input: B0CommitInputV1): void {
  const batch = validateB0SettlementBatchV1(input.batch);
  const snapshot = validateB0SettlementSnapshotV1(input.snapshot);
  const resolution = validateB0SettlementResolutionV1(input.resolution);
  if (!batch.ok) throw new B0CommitErrorV1("SETTLEMENT_BATCH_INVALID", batch.errors.join("; "));
  if (!snapshot.ok) throw new B0CommitErrorV1("SETTLEMENT_SNAPSHOT_INVALID", snapshot.errors.join("; "));
  if (!resolution.ok) throw new B0CommitErrorV1("RESOLUTION_VALIDATION_FAILED", resolution.errors.join("; "));
  if (input.resolution.resolutionHash !== hashResolutionPayload(input.resolution)) {
    throw new B0CommitErrorV1("RESOLUTION_HASH_MISMATCH", "The resolution payload does not match its immutable hash.");
  }
  if (input.batch.id !== input.resolution.batchId
    || input.batch.snapshotId !== input.snapshot.id
    || input.batch.windowId !== input.snapshot.windowId
    || input.batch.windowId !== input.resolution.windowId
    || input.batch.roomId !== input.snapshot.roomId
    || input.batch.roomId !== input.resolution.roomId
    || input.batch.runId !== input.snapshot.runId
    || input.batch.runId !== input.resolution.runId
    || input.batch.baseWorldSequence !== input.snapshot.baseWorldSequence
    || input.batch.baseWorldSequence !== input.resolution.baseWorldSequence) {
    throw new B0CommitErrorV1("BATCH_CONTEXT_MISMATCH", "Batch, snapshot and resolution are not bound to one context.");
  }
  if (input.batch.status !== "PREPARED" && input.batch.status !== "RESOLVED" && input.batch.status !== "COMMITTING") {
    throw new B0CommitErrorV1("BATCH_NOT_COMMITTABLE", `Batch ${input.batch.id} is ${input.batch.status}.`);
  }
  if (typeof input.committedAt !== "string" || Number.isNaN(Date.parse(input.committedAt))) {
    throw new B0CommitErrorV1("COMMIT_TIMESTAMP_INVALID", "committedAt must be an ISO timestamp.");
  }
}

function assertContext(context: B0CommitContextV1, input: B0CommitInputV1): void {
  if (context.roomId !== input.batch.roomId
    || context.runId !== input.batch.runId
    || context.windowId !== input.batch.windowId
    || !context.nodeId) {
    throw new B0CommitErrorV1("RUN_ID_MISMATCH", "The persisted window context does not match the batch.");
  }
}

function stableMutations(mutations: B0StateMutationV1[]): B0StateMutationV1[] {
  return [...mutations].sort((left, right) =>
    left.entityType.localeCompare(right.entityType)
    || left.entityId.localeCompare(right.entityId)
    || left.attribute.localeCompare(right.attribute)
    || left.operation.localeCompare(right.operation)
    || left.mutationId.localeCompare(right.mutationId));
}

export function assertStoredManifestV1(value: unknown): B0BatchCommitManifestV1 {
  const validation = validateB0BatchCommitManifestV1(value);
  if (!validation.ok) throw new B0CommitErrorV1("COMMIT_MANIFEST_INVALID", validation.errors.join("; "));
  return validation.value;
}
