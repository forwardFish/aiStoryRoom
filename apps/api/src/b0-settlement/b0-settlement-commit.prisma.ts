import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  B0BatchCommitManifestV1,
  B0SettlementBatchV1,
  B0SettlementResolutionV1,
  B0SettlementSnapshotV1,
  B0StateMutationV1,
} from "@ai-story/shared";
import { PrismaService } from "../prisma.service";
import {
  assertStoredManifestV1,
  B0CommitErrorV1,
  commitB0SettlementV1,
  type B0CommitContextV1,
  type B0CommitInputV1,
  type B0CommitTransactionV1,
} from "./b0-settlement-commit.core";

type Tx = Prisma.TransactionClient;

@Injectable()
export class B0SettlementCommitService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async commit(input: B0CommitInputV1) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => commitB0SettlementV1(new PrismaB0CommitTransactionV1(tx), input),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 10_000,
            timeout: 30_000,
          },
        );
      } catch (error) {
        if (!retryable(error) || attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1) ** 2));
      }
    }
    throw new Error("UNREACHABLE_B0_COMMIT_RETRY");
  }
}

export class PrismaB0CommitTransactionV1 implements B0CommitTransactionV1 {
  constructor(private readonly tx: Tx | any) {}

  async readContext(input: B0CommitInputV1): Promise<B0CommitContextV1> {
    const window = await this.tx.actionWindow.findUnique({
      where: { id: input.batch.windowId },
      select: {
        id: true,
        runId: true,
        nodeId: true,
        run: { select: { id: true, worldSequence: true } },
      },
    });
    if (!window) throw new B0CommitErrorV1("WINDOW_NOT_FOUND", "The settlement window no longer exists.");
    return {
      roomId: window.runId,
      runId: window.run.id,
      windowId: window.id,
      nodeId: window.nodeId,
      currentWorldSequence: Number(window.run.worldSequence),
    };
  }

  async readManifest(batchId: string, windowId: string): Promise<B0BatchCommitManifestV1 | null> {
    const workflow = await this.tx.resolutionWorkflow.findUnique({
      where: { windowId },
      select: { rulesInputHash: true, rulesOutputJson: true },
    });
    if (!workflow) return null;
    const envelope = record(workflow.rulesOutputJson);
    if (!envelope) {
      throw new B0CommitErrorV1("B0_WORKFLOW_OCCUPIED", "The window already has a non-B0 resolution workflow.");
    }
    if (envelope.schemaVersion === "b0-freeze-envelope-v1") {
      if (envelope.batch?.id !== batchId || workflow.rulesInputHash !== envelope.batch?.inputHash) {
        throw new B0CommitErrorV1("BATCH_ALREADY_COMMITTED", "The window is already bound to another B0 batch.");
      }
      return null;
    }
    if (envelope.schemaVersion !== "b0-commit-envelope-v1") {
      throw new B0CommitErrorV1("B0_WORKFLOW_OCCUPIED", "The window already has an incompatible resolution workflow.");
    }
    if (envelope.batchId !== batchId) {
      throw new B0CommitErrorV1("BATCH_ALREADY_COMMITTED", "The window is already bound to another batch.");
    }
    return assertStoredManifestV1(envelope.manifest);
  }

  async applyResourceMutation(input: {
    batch: B0SettlementBatchV1;
    mutation: B0StateMutationV1;
  }): Promise<string> {
    const idempotencyKey = `b0-resource:${input.batch.id}:${input.mutation.mutationId}`;
    const existing = await this.tx.roleAssetMutation.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) return idempotencyKey;

    const originIntentId = input.mutation.originIntentIds[0];
    if (!originIntentId) throw new B0CommitErrorV1("RESOURCE_MUTATION_INVALID", "Resource mutation has no origin intent.");
    const action = await this.tx.playerAction.findFirst({
      where: { id: originIntentId, runId: input.batch.runId },
      select: { id: true, roleId: true },
    });
    if (!action) throw new B0CommitErrorV1("INTENT_NOT_FOUND", `Origin action ${originIntentId} was not found.`);

    const asset = await this.tx.roleAsset.findFirst({
      where: {
        runId: input.batch.runId,
        status: "ACTIVE",
        OR: [{ id: input.mutation.entityId }, { assetKey: input.mutation.entityId }],
      },
      select: { id: true, ownerRoleId: true, quantity: true, status: true, version: true, stateJson: true },
    });
    if (!asset) throw new B0CommitErrorV1("INTENT_RESOURCE_INSUFFICIENT", `Resource ${input.mutation.entityId} is unavailable.`);
    if (asset.ownerRoleId && action.roleId && asset.ownerRoleId !== action.roleId) {
      throw new B0CommitErrorV1("ACTOR_OWNERSHIP_MISMATCH", `Action ${originIntentId} does not own resource ${asset.id}.`);
    }
    const delta = Number(input.mutation.value);
    if (!Number.isInteger(delta)) throw new B0CommitErrorV1("RESOURCE_MUTATION_INVALID", "Resource delta must be an integer.");
    const nextQuantity = Number(asset.quantity) + delta;
    if (nextQuantity < 0) throw new B0CommitErrorV1("INTENT_RESOURCE_INSUFFICIENT", `Resource ${asset.id} would become negative.`);
    const updated = await this.tx.roleAsset.updateMany({
      where: { id: asset.id, version: asset.version, quantity: asset.quantity },
      data: { quantity: nextQuantity, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new B0CommitErrorV1("RESOURCE_STATE_CONFLICT", `Resource ${asset.id} changed during commit.`);
    await this.tx.roleAssetMutation.create({
      data: {
        assetId: asset.id,
        actionId: action.id,
        mutationType: "B0_COMMIT",
        delta,
        fromRoleId: delta < 0 ? asset.ownerRoleId : null,
        toRoleId: delta > 0 ? asset.ownerRoleId : null,
        beforeJson: { quantity: asset.quantity, status: asset.status, state: asset.stateJson } as Prisma.InputJsonValue,
        afterJson: { quantity: nextQuantity, status: asset.status, state: asset.stateJson } as Prisma.InputJsonValue,
        idempotencyKey,
      },
    });
    return idempotencyKey;
  }

  async applyStateMutation(input: {
    batch: B0SettlementBatchV1;
    mutation: B0StateMutationV1;
  }): Promise<string> {
    const factKey = `b0:mutation:${input.batch.id}:${input.mutation.mutationId}`;
    const existing = await this.tx.canonFact.findUnique({
      where: { runId_factKey: { runId: input.batch.runId, factKey } },
      select: { id: true },
    });
    if (existing) return factKey;

    const originIds = [...new Set(input.mutation.originIntentIds)].sort();
    if (originIds.length === 0) {
      throw new B0CommitErrorV1("STATE_MUTATION_INVALID", `Mutation ${input.mutation.mutationId} has no origin intent.`);
    }
    const actions = await this.tx.playerAction.findMany({
      where: { id: { in: originIds }, runId: input.batch.runId },
      select: { id: true, nodeId: true },
    });
    if (actions.length !== originIds.length || actions.some((action: any) => !originIds.includes(action.id))) {
      throw new B0CommitErrorV1("INTENT_NOT_FOUND", `A causal origin for mutation ${input.mutation.mutationId} is missing.`);
    }
    const nodeIds = [...new Set(actions.map((action: any) => action.nodeId))];
    if (nodeIds.length !== 1) {
      throw new B0CommitErrorV1("BATCH_CONTEXT_MISMATCH", `Mutation ${input.mutation.mutationId} spans multiple scene nodes.`);
    }
    const content = JSON.stringify({
      schemaVersion: "b0-authoritative-mutation-v1",
      batchId: input.batch.id,
      windowId: input.batch.windowId,
      baseWorldSequence: input.batch.baseWorldSequence,
      committedWorldSequence: input.batch.baseWorldSequence + 1,
      mutation: input.mutation,
    });
    try {
      await this.tx.canonFact.create({
        data: {
          runId: input.batch.runId,
          sourceNodeId: nodeIds[0],
          factKey,
          content,
          status: "confirmed",
          visibility: "private",
          sourceEventIdsJson: [] as Prisma.InputJsonValue,
          sourceActionIdsJson: originIds as Prisma.InputJsonValue,
          knownByRoleIdsJson: [] as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      const code = String((error as any)?.code || "");
      if (code !== "P2002") throw error;
      const replay = await this.tx.canonFact.findUnique({
        where: { runId_factKey: { runId: input.batch.runId, factKey } },
        select: { id: true, content: true },
      });
      if (!replay || replay.content !== content) {
        throw new B0CommitErrorV1("STATE_MUTATION_CONFLICT", `Mutation ${input.mutation.mutationId} was committed with different content.`);
      }
    }
    return factKey;
  }

  async advanceWorldSequence(input: { runId: string; expected: number; next: number }): Promise<boolean> {
    const updated = await this.tx.storyRun.updateMany({
      where: { id: input.runId, worldSequence: input.expected },
      data: { worldSequence: input.next },
    });
    return updated.count === 1;
  }

  async enqueuePublication(input: {
    context: B0CommitContextV1;
    batch: B0SettlementBatchV1;
    resolution: B0SettlementResolutionV1;
    outboxKey: string;
  }): Promise<void> {
    await this.tx.storyTaskOutbox.upsert({
      where: { dedupeKey: input.outboxKey },
      update: {},
      create: {
        runId: input.context.runId,
        nodeId: input.context.nodeId,
        windowId: input.context.windowId,
        dedupeKey: input.outboxKey,
        taskType: "B0_PUBLISH_STRUCTURED_RESULTS",
        status: "pending",
        inputRefId: input.batch.id,
        checkpointKey: "B0_BATCH_COMMITTED",
        resultJson: {
          schemaVersion: "b0-publication-request-v1",
          batchId: input.batch.id,
          resolutionHash: input.resolution.resolutionHash,
          structuredResults: input.resolution.structuredResults,
        } as Prisma.InputJsonValue,
      },
    });
  }

  async persistCommit(input: {
    context: B0CommitContextV1;
    batch: B0SettlementBatchV1;
    snapshot: B0SettlementSnapshotV1;
    resolution: B0SettlementResolutionV1;
    manifest: B0BatchCommitManifestV1;
  }): Promise<void> {
    const envelope = {
      schemaVersion: "b0-commit-envelope-v1",
      batchId: input.batch.id,
      snapshot: input.snapshot,
      resolution: input.resolution,
      manifest: input.manifest,
    };
    const existing = await this.tx.resolutionWorkflow.findUnique({
      where: { windowId: input.context.windowId },
      select: { id: true, rulesInputHash: true },
    });
    if (existing && existing.rulesInputHash !== input.batch.inputHash) {
      throw new B0CommitErrorV1("RESOLUTION_INPUT_DRIFT", "The persisted workflow input hash differs from the sealed batch.");
    }
    const workflow = existing
      ? await this.tx.resolutionWorkflow.update({
          where: { id: existing.id },
          data: {
            status: "COMPLETED",
            rulesOutputJson: envelope as Prisma.InputJsonValue,
            completedAt: new Date(input.manifest.committedAt),
            version: { increment: 1 },
          },
          select: { id: true },
        })
      : await this.tx.resolutionWorkflow.create({
          data: {
            runId: input.context.runId,
            windowId: input.context.windowId,
            nodeId: input.context.nodeId,
            status: "COMPLETED",
            rulesInputHash: input.batch.inputHash,
            rulesOutputJson: envelope as Prisma.InputJsonValue,
            completedAt: new Date(input.manifest.committedAt),
          },
          select: { id: true },
        });
    await this.tx.resolutionCheckpoint.upsert({
      where: {
        workflowId_checkpointKey: {
          workflowId: workflow.id,
          checkpointKey: "B0_BATCH_COMMITTED",
        },
      },
      update: {},
      create: {
        workflowId: workflow.id,
        checkpointKey: "B0_BATCH_COMMITTED",
        contentHash: input.manifest.commitHash,
        outputRefType: "B0_BATCH_COMMIT",
        outputRefId: input.manifest.batchId,
        completedAt: new Date(input.manifest.committedAt),
      },
    });
    const committed = await this.tx.actionWindow.updateMany({
      where: { id: input.context.windowId, status: { in: ["LOCKED", "SETTLING", "COMMITTED"] } },
      data: {
        status: "COMMITTED",
        resolvedAt: new Date(input.manifest.committedAt),
        version: { increment: 1 },
        projectionVersion: { increment: 1 },
      },
    });
    if (committed.count !== 1) {
      throw new B0CommitErrorV1("WINDOW_NOT_COMMITTABLE", "The B0 window did not accept the authoritative commit transition.");
    }
    await this.tx.actionWindowParticipant.updateMany({
      where: { windowId: input.context.windowId },
      data: { mainStatus: "B0_COMMITTED", version: { increment: 1 } },
    });
  }
}

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function retryable(error: unknown): boolean {
  const code = String((error as any)?.code || "");
  return code === "P2034" || code === "40001" || code === "40P01";
}
