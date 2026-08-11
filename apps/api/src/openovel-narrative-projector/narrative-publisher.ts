import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { STORY_TASK_SOURCE_FINALIZATION_SCHEMA_V1 } from "../story-task-outbox.contract";
import type {
  NarrativePublicationInputV1,
  NarrativePublicationResultV1,
} from "./openovel-narrative-projector.contract";

@Injectable()
export class NarrativePublisher {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async markStatus(input: {
    taskId: string;
    leaseOwner: string;
    leaseVersion: number;
    status: "GENERATING" | "VALIDATING";
  }): Promise<void> {
    const task = await this.prisma.storyTaskOutbox.findUnique({
      where: { id: input.taskId },
      select: { resultJson: true },
    });
    const updated = await this.prisma.storyTaskOutbox.updateMany({
      where: {
        id: input.taskId,
        taskType: "B0_NARRATIVE_GENERATION",
        status: "running",
        leaseOwner: input.leaseOwner,
        leaseVersion: input.leaseVersion,
        leaseExpiresAt: { gt: new Date() },
      },
      data: {
        resultJson: {
          ...jsonRecord(task?.resultJson),
          schemaVersion: "openovel-narrative-task-result-v1",
          authoritativeResultStatus: "FINALIZED",
          structuredResultReady: true,
          narrativeStatus: input.status,
        } as Prisma.InputJsonValue,
      },
    });
    if (updated.count !== 1) throw new Error("NARRATIVE_PROJECTION_LEASE_LOST");
  }

  async publish(input: NarrativePublicationInputV1): Promise<NarrativePublicationResultV1> {
    const completedAt = new Date();
    const presentationHash = sha256(JSON.stringify({
      sourceCommitHash: input.source.sourceCommitHash,
      narrativeStatus: input.narrativeStatus,
      content: input.content,
    }));
    return this.prisma.$transaction(async (tx) => {
      const completed = await tx.storyTaskOutbox.updateMany({
        where: {
          id: input.taskId,
          taskType: "B0_NARRATIVE_GENERATION",
          status: "running",
          leaseOwner: input.leaseOwner,
          leaseVersion: input.leaseVersion,
          leaseExpiresAt: { gt: completedAt },
        },
        data: {
          status: "completed",
          outcome: input.narrativeStatus,
          completedAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: null,
        },
      });
      if (completed.count !== 1) return { outcome: "LEASE_LOST" as const };

      const entry = await tx.narrativeEntry.upsert({
        where: { dedupeKey: input.source.dedupeKey },
        update: {
          content: input.content,
          sourceCommitHash: input.source.sourceCommitHash,
          presentationHash,
          projectionStatus: input.narrativeStatus,
          failureCode: input.failureCode,
          projectionAttempt: { increment: 1 },
        },
        create: {
          runId: input.source.runId,
          nodeId: input.source.nodeId,
          roleId: input.source.roleId,
          entryType: input.source.entryType,
          visibility: input.source.visibility,
          content: input.content,
          factKeysJson: [] as Prisma.InputJsonValue,
          threadKeysJson: [] as Prisma.InputJsonValue,
          sourceEventIdsJson: [] as Prisma.InputJsonValue,
          worldSequence: input.source.worldSequence,
          dedupeKey: input.source.dedupeKey,
          sourceCommitHash: input.source.sourceCommitHash,
          presentationHash,
          projectionStatus: input.narrativeStatus,
          failureCode: input.failureCode,
          projectionAttempt: 1,
        },
      });
      const resultJson = {
        ...jsonRecord(input.source.sourceTaskResult),
        schemaVersion: "openovel-narrative-task-result-v1",
        authoritativeResultStatus: "FINALIZED",
        structuredResultReady: true,
        narrativeStatus: input.narrativeStatus,
        sourceCommitHash: input.source.sourceCommitHash,
        presentationHash,
        narrativeEntryId: entry.id,
        failureCode: input.failureCode,
        model: input.model,
        providerRequestId: input.providerRequestId,
        publishedAt: completedAt.toISOString(),
      };
      await tx.storyTaskOutbox.update({
        where: { id: input.taskId },
        data: { resultJson: resultJson as Prisma.InputJsonValue },
      });
      return {
        outcome: input.narrativeStatus,
        narrativeEntryId: entry.id,
        sourceCommitHash: input.source.sourceCommitHash,
        presentationHash,
        sourceFinalization: {
          schemaVersion: STORY_TASK_SOURCE_FINALIZATION_SCHEMA_V1,
          taskId: input.taskId,
          leaseOwner: input.leaseOwner,
          leaseVersion: input.leaseVersion,
        },
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 10_000,
      timeout: 30_000,
    });
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
