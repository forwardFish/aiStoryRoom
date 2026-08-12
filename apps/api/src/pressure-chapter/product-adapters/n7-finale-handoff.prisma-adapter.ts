import { Prisma } from "@prisma/client";
import { sha256Canonical } from "@ai-story/shared";
import type { PrismaService } from "../../prisma.service";
import { validateAtomicChapterCommitRecordV1 } from "../chapter-settlement";
import type { DurableN7FinaleHandoffReaderPort } from "../integration";
import {
  PRESSURE_PRODUCT_ADAPTER_ERROR_CODES_V1 as ERROR,
  failPressureProductAdapterV1,
} from "./errors";
import { readPinnedPressureRouteV1 } from "./route-authority";

export class PrismaDurableN7FinaleHandoffReaderV1
implements DurableN7FinaleHandoffReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async readCommittedN7Handoff(input: Readonly<{
    runId: string;
    n7FrozenBundleHash: string;
  }>): Promise<unknown | null> {
    return this.prisma.$transaction(async (tx) => {
      const route = await readPinnedPressureRouteV1(tx, input.runId);
      const row = await tx.pressureChapterSettlement.findUnique({
        where: { runId_chapterSequence: { runId: input.runId, chapterSequence: 7 } },
        select: { runId: true, chapterId: true, chapterSequence: true, commitManifestJson: true },
      });
      if (!row) return null;
      let record;
      try {
        record = validateAtomicChapterCommitRecordV1(row.commitManifestJson);
      } catch (cause) {
        return failPressureProductAdapterV1(ERROR.RECORD_INVALID, "PressureChapterSettlement.commitManifestJson", String(cause));
      }
      const outbox = await tx.pressureOutboxTask.findUnique({
        where: { dedupeKey: record.outbox.dedupeKey },
        select: {
          runId: true,
          taskType: true,
          dedupeKey: true,
          sourceAuthority: true,
          sourceId: true,
          sourceCommitHash: true,
          payloadJson: true,
          payloadHash: true,
        },
      });
      if (!outbox) return null;
      if (
        row.runId !== input.runId
        || row.chapterId !== "N7"
        || row.chapterSequence !== 7
        || record.runId !== input.runId
        || record.chapterId !== "N7"
        || record.sealedInput.runRouteHash !== route.snapshot.routeHash
        || record.frozenChapterBundle.committedWorldSequence !== 7
        || record.frozenChapterBundle.bundleHash !== input.n7FrozenBundleHash
        || record.outbox.taskType !== "COMPUTE_FINALE"
        || record.outbox.sourceBundleHash !== input.n7FrozenBundleHash
        || outbox.runId !== input.runId
        || outbox.taskType !== "COMPUTE_FINALE"
        || outbox.dedupeKey !== record.outbox.dedupeKey
        || outbox.sourceAuthority !== "CHAPTER_FROZEN"
        || outbox.sourceId !== input.n7FrozenBundleHash
        || outbox.sourceCommitHash !== record.receipt.commitHash
        || outbox.payloadHash !== record.outbox.outboxHash
        || sha256Canonical(outbox.payloadJson) !== sha256Canonical(record.outbox)
      ) {
        return failPressureProductAdapterV1(ERROR.AUTHORITY_MISMATCH, "PressureOutboxTask", "N7_HANDOFF_BINDING");
      }
      return structuredClone(record);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
