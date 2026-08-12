import { Prisma } from "@prisma/client";
import { sha256Canonical, validateWorldStateV1 } from "@ai-story/shared";
import {
  validateAtomicChapterCommitRecordV1,
} from "../chapter-settlement/chapter-commit-record";
import {
  createSangtianAEmotionContentSourceCompilerV1,
  type SangtianAEmotionContentSourceCompilerV1,
} from "../a-emotion-production/content-source";
import type {
  AtomicChapterCommitRecordV1,
  AtomicChapterCommitterPort,
  ChapterSettlementKeyV1,
} from "../chapter-settlement/types";
import type { WorkingLedgerEventV1 } from "../working-ledger/contracts";
import { projectWorkingLedger } from "../working-ledger/working-ledger";
import type {
  ExtendedAuthoritativeNarrativeSnapshotCompilerPortV1,
} from "../narrative-authority/contracts";
import {
  buildAuthorityDownstreamManifestV1,
  downstreamDedupeKeysV1,
  insertAEmotionAuthorityEmissionsV1,
  insertNarrativeProjectionPlanV1,
  planNarrativeProjectionJobsV1,
  validateAuthorityDownstreamManifestV1,
} from "../projection-plan";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "./errors";
import {
  isUniqueConflict,
  pressureSerializableTransaction,
  type PressureSerializableClient,
} from "./transaction";

interface SettlementRow {
  id: string;
  runId: string;
  chapterRuntimeId: string;
  commitManifestJson: unknown;
  outboxDedupeKeysJson: unknown;
  commitHash: string;
}

interface ChapterRuntimeFenceRow {
  id: string;
  runId: string;
  chapterId: string;
  chapterSequence: number;
  state: string;
  routeHash: string;
  previousFrozenHash: string;
  workingRevision: number;
  workingStateHash: string;
  lockVersion: number;
}

interface RunFenceRow {
  id: string;
  worldSequence: number;
  reservedWorldSequence: number;
  stateJson: unknown;
}

interface SettlementTransaction {
  pressureChapterSettlement: {
    findUnique(input: Record<string, unknown>): Promise<SettlementRow | null>;
    create(input: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
  pressureChapterRuntime: {
    findUnique(input: Record<string, unknown>): Promise<ChapterRuntimeFenceRow | null>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  storyRun: {
    findUnique(input: Record<string, unknown>): Promise<RunFenceRow | null>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  storyEvent: {
    findMany(input: Record<string, unknown>): Promise<Array<{
      runId: string;
      payloadJson: unknown;
    }>>;
    create(input: { data: Record<string, unknown> }): Promise<unknown>;
  };
  pressureOutboxTask: {
    create(input: { data: Record<string, unknown> }): Promise<unknown>;
  };
  pressureNarrativeProjection: {
    create(input: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
}

export type ChapterSettlementPrismaClient =
  PressureSerializableClient<SettlementTransaction>;

/**
 * B0 authority committer. Settlement, bundle, six seat arcs, root event,
 * handoff outbox, chapter freeze and StoryRun worldSequence+1 are one
 * Serializable transaction.
 */
export class PrismaAtomicChapterCommitter implements AtomicChapterCommitterPort {
  constructor(
    private readonly prisma: ChapterSettlementPrismaClient,
    private readonly narrativeCompiler?: ExtendedAuthoritativeNarrativeSnapshotCompilerPortV1,
    private readonly aEmotionCompiler?: Pick<
      SangtianAEmotionContentSourceCompilerV1,
      "compileChapter"
    >,
  ) {}

  async readCommitted(
    key: Readonly<ChapterSettlementKeyV1>,
  ): Promise<AtomicChapterCommitRecordV1 | null> {
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const row = await tx.pressureChapterSettlement.findUnique({
        where: { chapterRuntimeId: key.chapterRuntimeId },
        select: {
          id: true,
          runId: true,
          chapterRuntimeId: true,
          commitManifestJson: true,
          outboxDedupeKeysJson: true,
          commitHash: true,
        },
      });
      return row ? decodeSettlement(row, key) : null;
    });
  }

  async commitOnce(recordValue: Readonly<AtomicChapterCommitRecordV1>): Promise<{
    status: "COMMITTED" | "ALREADY_COMMITTED";
    record: AtomicChapterCommitRecordV1;
  }> {
    const record = structuredClone(validateAtomicChapterCommitRecordV1(recordValue));
    try {
      return await pressureSerializableTransaction(this.prisma, async (tx) => {
        const existing = await tx.pressureChapterSettlement.findUnique({
          where: { chapterRuntimeId: record.chapterRuntimeId },
          select: {
            id: true,
            runId: true,
            chapterRuntimeId: true,
            commitManifestJson: true,
            outboxDedupeKeysJson: true,
            commitHash: true,
          },
        });
        if (existing) {
          return {
            status: "ALREADY_COMMITTED" as const,
            record: assertSameSettlement(
              decodeSettlement(existing, record),
              record,
            ),
          };
        }

        const [runtime, run, ledgerEvents] = await Promise.all([
          tx.pressureChapterRuntime.findUnique({
            where: { id: record.chapterRuntimeId },
            select: {
              id: true,
              runId: true,
              chapterId: true,
              chapterSequence: true,
              state: true,
              routeHash: true,
              previousFrozenHash: true,
              workingRevision: true,
              workingStateHash: true,
              lockVersion: true,
            },
          }),
          tx.storyRun.findUnique({
            where: { id: record.runId },
            select: {
              id: true,
              worldSequence: true,
              reservedWorldSequence: true,
              stateJson: true,
            },
          }),
          readLedger(tx, record.runId, record.chapterRuntimeId),
        ]);
        assertChapterCommitFence(record, runtime, run, ledgerEvents);

        const settlementId = record.receipt.settlementId;
        const bundle = record.frozenChapterBundle;
        const rawNarrativeAuthority = {
          runId: record.runId,
          bundleHash: bundle.bundleHash,
          frozenWorldStateJson: bundle.frozenWorldState,
          causalEdgesJson: bundle.causalEdges,
          carryForwardJson: bundle.carryForward,
        };
        const narrativeJobs = planNarrativeProjectionJobsV1({
          runId: record.runId,
          projectionKind: "CHAPTER_NARRATIVE",
          sourceAuthority: "CHAPTER_FROZEN",
          sourceId: bundle.bundleHash,
          sourceCommitHash: bundle.bundleHash,
          sourceContentHash: bundle.frozenWorldState.stateHash,
        }, rawNarrativeAuthority, this.narrativeCompiler);
        const committedAtDate = new Date();
        const emissions = (this.aEmotionCompiler
          ?? createSangtianAEmotionContentSourceCompilerV1()).compileChapter({
          sourceKind: "CHAPTER_SETTLEMENT_COMMITTED",
          roomId: record.runId,
          committedAt: committedAtDate.toISOString(),
          record,
          ledgerEvents,
        });
        const downstreamManifest = buildAuthorityDownstreamManifestV1({
          authorityKind: "CHAPTER",
          sourceId: settlementId,
          sourceCommitHash: record.receipt.commitHash,
          dedupeKeys: downstreamDedupeKeysV1({
            existing: [record.outbox.dedupeKey],
            narrativeJobs,
            aEmotionEmissions: emissions,
          }),
        });
        await tx.pressureChapterSettlement.create({
          data: {
            id: settlementId,
            runId: record.runId,
            chapterRuntimeId: record.chapterRuntimeId,
            chapterId: record.chapterId,
            chapterSequence: record.rootEvent.chapterSequence,
            schemaVersion: record.settlement.schemaVersion,
            idempotencyKey: record.idempotencyKey,
            requestFingerprint: record.requestFingerprint,
            baseWorldSequence: record.rootEvent.baseWorldSequence,
            committedWorldSequence: record.rootEvent.committedWorldSequence,
            baseWorldStateHash: record.sealedInput.baseWorldStateHash,
            committedWorldStateHash: record.frozenChapterBundle.committedWorldStateHash,
            inputJson: json(record.sealedInput),
            inputHash: record.sealedInput.inputHash,
            evaluationJson: json(record.settlement),
            evaluationHash: record.settlement.evaluationHash,
            worldDeltaJson: json(record.worldDelta),
            worldDeltaHash: sha256Canonical(record.worldDelta),
            decisionLedgerHash: record.sealedInput.decisionLedgerHash,
            finalWorkingStateHash: record.sealedInput.finalWorkingStateHash,
            reservationLedgerHash: record.sealedInput.reservationLedgerHash,
            frozenBundleHash: record.frozenChapterBundle.bundleHash,
            commitManifestJson: json(record),
            commitManifestHash: record.receipt.commitManifestHash,
            rootEventId: record.rootEvent.eventId,
            outboxDedupeKeysJson: json(downstreamManifest),
            commitHash: record.receipt.commitHash,
            committedAt: committedAtDate,
          },
        });
        await tx.storyEvent.create({
          data: {
            id: record.rootEvent.eventId,
            runId: record.runId,
            day: record.rootEvent.chapterSequence,
            type: record.rootEvent.eventType,
            messageType: "system",
            visibility: "system",
            payloadJson: json(record.rootEvent),
            sequence: record.rootEvent.committedWorldSequence,
            dedupeKey: record.rootEvent.eventId,
          },
        });
        await tx.pressureOutboxTask.create({
          data: {
            runId: record.runId,
            taskType: record.outbox.taskType,
            status: record.outbox.status,
            checkpoint: "PERSISTED",
            dedupeKey: record.outbox.dedupeKey,
            sourceAuthority: "CHAPTER_FROZEN",
            sourceId: bundle.bundleHash,
            sourceCommitHash: record.receipt.commitHash,
            payloadJson: json(record.outbox),
            payloadHash: record.outbox.outboxHash,
          },
        });
        await insertNarrativeProjectionPlanV1(
          tx,
          "PROJECT_CHAPTER_NARRATIVE",
          narrativeJobs,
        );
        await insertAEmotionAuthorityEmissionsV1(tx, "CHAPTER_FROZEN", emissions);

        const runtimeAdvanced = await tx.pressureChapterRuntime.updateMany({
          where: {
            id: record.chapterRuntimeId,
            runId: record.runId,
            state: record.commitFence.expectedLifecycleState,
            workingRevision: record.commitFence.expectedWorkingRevision,
            workingStateHash: record.commitFence.expectedWorkingStateHash,
            lockVersion: runtime!.lockVersion,
          },
          data: {
            state: "CHAPTER_FROZEN",
            frozenAt: new Date(),
            lockVersion: { increment: 1 },
          },
        });
        if (runtimeAdvanced.count !== 1) throw fence("Chapter runtime CAS lost", record);

        const worldAdvanced = await tx.storyRun.updateMany({
          where: {
            id: record.runId,
            worldSequence: record.commitFence.expectedWorldSequence,
          },
          data: {
            worldSequence: bundle.committedWorldSequence,
            reservedWorldSequence: bundle.committedWorldSequence,
            stateJson: json(bundle.frozenWorldState),
            currentChapter: bundle.chapterSequence,
            currentNodeId: bundle.chapterId,
          },
        });
        if (worldAdvanced.count !== 1) throw fence("StoryRun worldSequence CAS lost", record);
        return { status: "COMMITTED" as const, record };
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const concurrent = await this.readCommitted(record);
      if (!concurrent) throw error;
      return {
        status: "ALREADY_COMMITTED",
        record: assertSameSettlement(concurrent, record),
      };
    }
  }
}

async function readLedger(
  tx: SettlementTransaction,
  runId: string,
  chapterRuntimeId: string,
): Promise<WorkingLedgerEventV1[]> {
  const rows = await tx.storyEvent.findMany({
    where: { runId, type: "PRESSURE_WORKING_LEDGER_EVENT" },
    select: { runId: true, payloadJson: true },
  });
  const events = rows.map((row) => row.payloadJson as WorkingLedgerEventV1)
    .filter((event) => event.chapterRuntimeId === chapterRuntimeId)
    .sort((left, right) => left.sequence - right.sequence);
  if (events.length) projectWorkingLedger(events);
  return events;
}

function assertChapterCommitFence(
  record: AtomicChapterCommitRecordV1,
  runtime: ChapterRuntimeFenceRow | null,
  run: RunFenceRow | null,
  ledgerEvents: WorkingLedgerEventV1[],
): void {
  if (
    !runtime || !run
    || runtime.runId !== record.runId
    || runtime.chapterId !== record.chapterId
    || runtime.chapterSequence !== record.rootEvent.chapterSequence
    || runtime.state !== record.commitFence.expectedLifecycleState
    || runtime.workingRevision !== record.commitFence.expectedWorkingRevision
    || runtime.workingStateHash !== record.commitFence.expectedWorkingStateHash
    || runtime.routeHash !== record.sealedInput.runRouteHash
    || runtime.previousFrozenHash !== record.sealedInput.previousFrozenHash
  ) throw fence("Chapter runtime authority fence mismatch", record);
  if (
    run.worldSequence !== record.commitFence.expectedWorldSequence
    || validateWorldStateV1(run.stateJson).stateHash
      !== record.commitFence.expectedWorldStateHash
  ) throw fence("StoryRun world authority fence mismatch", record);
  if (!ledgerEvents.length) throw fence("Working ledger is absent at settlement", record);
  const projection = projectWorkingLedger(ledgerEvents);
  const reservationLedger = [...projection.pendingReservations.values()]
    .map((item) => ({ ...item }))
    .sort((left, right) => left.reservationKey.localeCompare(right.reservationKey));
  if (
    projection.headHash !== record.commitFence.expectedDecisionLedgerHash
    || projection.stateHash !== record.commitFence.expectedWorkingStateHash
    || projection.acceptedActions.size !== record.commitFence.expectedActionCount
    || sha256Canonical(reservationLedger) !== record.sealedInput.reservationLedgerHash
  ) throw fence("Working ledger close fence mismatch", record);
}

function decodeSettlement(
  row: SettlementRow,
  key: Readonly<ChapterSettlementKeyV1>,
): AtomicChapterCommitRecordV1 {
  try {
    const record = validateAtomicChapterCommitRecordV1(row.commitManifestJson);
    if (
      record.receipt.settlementId !== row.id
      || record.runId !== row.runId
      || record.chapterRuntimeId !== row.chapterRuntimeId
      || record.receipt.commitHash !== row.commitHash
      || record.runId !== key.runId
      || record.chapterRuntimeId !== key.chapterRuntimeId
    ) throw new Error("ROW_BINDING_MISMATCH");
    const manifest = validateAuthorityDownstreamManifestV1(row.outboxDedupeKeysJson, {
      authorityKind: "CHAPTER",
      sourceId: row.id,
      sourceCommitHash: row.commitHash,
    });
    const requiredKeys = [
      record.outbox.dedupeKey,
      ...record.receipt.outboxDedupeKeys,
    ];
    if (requiredKeys.some((dedupeKey) => !manifest.dedupeKeys.includes(dedupeKey))) {
      throw new Error("DOWNSTREAM_MANIFEST_DEDUPE_MISMATCH");
    }
    return structuredClone(record);
  } catch (cause) {
    throw new PressurePersistenceError(
      ERROR.RECORD_INVALID,
      "Stored chapter settlement manifest is invalid",
      { cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }
}

function assertSameSettlement(
  stored: AtomicChapterCommitRecordV1,
  candidate: AtomicChapterCommitRecordV1,
): AtomicChapterCommitRecordV1 {
  if (
    stored.idempotencyKey !== candidate.idempotencyKey
    || stored.requestFingerprint !== candidate.requestFingerprint
    || stored.atomicRecordHash !== candidate.atomicRecordHash
  ) {
    throw new PressurePersistenceError(
      ERROR.FINGERPRINT_MISMATCH,
      "Chapter was already settled with a different command or record",
      { runId: candidate.runId, chapterRuntimeId: candidate.chapterRuntimeId },
    );
  }
  return structuredClone(stored);
}

function fence(
  message: string,
  record: Pick<AtomicChapterCommitRecordV1, "runId" | "chapterRuntimeId">,
): PressurePersistenceError {
  return new PressurePersistenceError(
    ERROR.AUTHORITY_FENCE_MISMATCH,
    message,
    { runId: record.runId, chapterRuntimeId: record.chapterRuntimeId },
  );
}

function json(value: unknown): Prisma.InputJsonValue {
  return structuredClone(value) as Prisma.InputJsonValue;
}
