import { sha256Canonical, type ChapterIdV1 } from "@ai-story/shared";
import {
  pressureSerializableTransaction,
  type PressureSerializableClient,
} from "../persistence/transaction";
import type { ProgressChapterHandoffAuthorityPortV1 } from "./runtime-adapters";

interface ProgressBundleAuthorityRowV1 {
  runId: string;
  chapterRuntimeId: string;
  frozenBundleHash: string;
  commitHash: string;
  commitManifestJson: unknown;
}

interface ProgressTargetChapterRowV1 {
  id: string;
  runId: string;
  chapterId: string;
  routeHash: string;
  previousFrozenHash: string;
}

interface ProgressChapterHandoffAuthorityTransactionV1 {
  pressureChapterSettlement: {
    findUnique(input: Record<string, unknown>): Promise<ProgressBundleAuthorityRowV1 | null>;
  };
  pressureChapterRuntime: {
    findFirst(input: Record<string, unknown>): Promise<ProgressTargetChapterRowV1 | null>;
  };
}

export type ProgressChapterHandoffAuthorityPrismaClientV1 =
  PressureSerializableClient<ProgressChapterHandoffAuthorityTransactionV1>;

/** Read-only immutable authority check used by the progress outbox runtime bridge. */
export class PrismaProgressChapterHandoffAuthorityV1
implements ProgressChapterHandoffAuthorityPortV1 {
  constructor(
    private readonly prisma: ProgressChapterHandoffAuthorityPrismaClientV1,
  ) {}

  async verifyCommittedSource(input: Readonly<{
    runId: string;
    chapterRuntimeId: string;
    sourceBundleHash: string;
    sourceCommitHash: string;
  }>): Promise<boolean> {
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const row = await tx.pressureChapterSettlement.findUnique({
        where: { frozenBundleHash: input.sourceBundleHash },
        select: {
          runId: true,
          chapterRuntimeId: true,
          frozenBundleHash: true,
          commitHash: true,
          commitManifestJson: true,
        },
      });
      if (
        !row
        || row.runId !== input.runId
        || row.chapterRuntimeId !== input.chapterRuntimeId
        || row.frozenBundleHash !== input.sourceBundleHash
        || row.commitHash !== input.sourceCommitHash
      ) return false;
      return embeddedAuthorityMatches(row.commitManifestJson, input);
    });
  }

  async readChapterRuntime(input: Readonly<{
    runId: string;
    chapterId: Exclude<ChapterIdV1, "N1">;
  }>) {
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const row = await tx.pressureChapterRuntime.findFirst({
        where: { runId: input.runId, chapterId: input.chapterId },
        select: {
          id: true,
          runId: true,
          chapterId: true,
          routeHash: true,
          previousFrozenHash: true,
        },
      });
      if (
        !row
        || row.runId !== input.runId
        || row.chapterId !== input.chapterId
      ) return null;
      return {
        chapterRuntimeId: row.id,
        routeHash: row.routeHash,
        previousFrozenHash: row.previousFrozenHash,
      };
    });
  }
}

function embeddedAuthorityMatches(
  value: unknown,
  expected: Readonly<{
    runId: string;
    chapterRuntimeId: string;
    sourceBundleHash: string;
    sourceCommitHash: string;
  }>,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const bundle = record.frozenChapterBundle;
  const receipt = record.receipt;
  if (
    !bundle || typeof bundle !== "object" || Array.isArray(bundle)
    || !receipt || typeof receipt !== "object" || Array.isArray(receipt)
    || typeof record.atomicRecordHash !== "string"
  ) return false;
  const bundleRecord = bundle as Record<string, unknown>;
  const receiptRecord = receipt as Record<string, unknown>;
  const { atomicRecordHash, ...recordBody } = record;
  const { bundleHash, ...bundleBody } = bundleRecord;
  return record.schemaVersion === "pressure_atomic_chapter_commit_v1"
    && bundleRecord.schemaVersion === "sangtian_frozen_chapter_bundle_v1"
    && receiptRecord.schemaVersion === "b0_settlement_commit_result_v1"
    && record.runId === expected.runId
    && record.chapterRuntimeId === expected.chapterRuntimeId
    && bundleRecord.runId === expected.runId
    && bundleHash === expected.sourceBundleHash
    && receiptRecord.runId === expected.runId
    && receiptRecord.chapterRuntimeId === expected.chapterRuntimeId
    && receiptRecord.bundleHash === expected.sourceBundleHash
    && receiptRecord.commitHash === expected.sourceCommitHash
    && bundleHash === sha256Canonical(bundleBody)
    && atomicRecordHash === sha256Canonical(recordBody);
}
