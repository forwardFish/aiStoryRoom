import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import type {
  AEmotionInteractionEventPortV1,
  AEmotionAggregateRecordV1,
} from "../a-emotion/ports";
import { decodeAggregateEnvelope } from "../a-emotion-persistence/codec";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as PERSISTENCE_ERROR,
  PressurePersistenceError,
} from "../persistence/errors";
import {
  pressureSerializableTransaction,
  type PressureSerializableClient,
} from "../persistence/transaction";
import type { WorkingLedgerEventV1 } from "../working-ledger/contracts";
import { projectWorkingLedger } from "../working-ledger/working-ledger";
import { CanonicalAEmotionAuthorityEventCompilerV1 } from "./compiler";
import {
  createSangtianAEmotionContentSourceCompilerV1,
  type AEmotionAuthorityEmissionV1,
  type SangtianAEmotionContentSourceCompilerV1,
} from "./content-source";
import type {
  AEmotionAuthorityOutboxClaimV1,
  AEmotionAuthorityOutboxJobV1,
  AEmotionAuthorityOutboxPortV1,
  AEmotionAuthoritySourceKindV1,
  AEmotionCommittedAuthorityReaderPortV1,
  AEmotionViewerContextReaderPortV1,
  AEmotionViewerContextRequestV1,
} from "./contracts";
import {
  validateAEmotionAuthorityOutboxJobV1,
} from "./validation";
import { compileCommittedInvestigationLifecycleEmissionsV1 } from "./investigation-lifecycle.prisma-bridge";

const TASK_TYPE = "INTERACTION_COMPILE_REQUESTED" as const;
const LEDGER_EVENT_TYPE = "PRESSURE_WORKING_LEDGER_EVENT";
const AGGREGATE_EVENT_TYPE = "PRESSURE_A_EMOTION_AGGREGATE_V1";

interface OutboxRowV1 {
  id: string;
  taskType: string;
  status: string;
  payloadJson: unknown;
  payloadHash: string;
  attempt: number;
  maxAttempts: number;
  availableAt: Date;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  leaseVersion: number;
}

interface LedgerRowV1 {
  payloadJson: unknown;
  createdAt: Date;
}

interface AEmotionAuthorityTransactionV1 {
  pressureOutboxTask: {
    findFirst(input: Record<string, unknown>): Promise<OutboxRowV1 | null>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  storyEvent: {
    findMany(input: Record<string, unknown>): Promise<LedgerRowV1[]>;
  };
  pressureChapterSettlement: {
    findUnique(input: Record<string, unknown>): Promise<unknown | null>;
    findMany(input: Record<string, unknown>): Promise<unknown[]>;
  };
  pressureFinaleDecision: {
    findFirst(input: Record<string, unknown>): Promise<unknown | null>;
  };
  storyRole: {
    findUnique(input: Record<string, unknown>): Promise<unknown | null>;
  };
  storyPlayer: {
    findUnique(input: Record<string, unknown>): Promise<unknown | null>;
  };
}

export type AEmotionAuthorityPrismaClientV1 =
  PressureSerializableClient<AEmotionAuthorityTransactionV1>;

/** Dedicated lease/fence lane; it can never claim Narrative or progress tasks. */
export class PrismaAEmotionAuthorityOutboxRepositoryV1
implements AEmotionAuthorityOutboxPortV1 {
  constructor(private readonly prisma: AEmotionAuthorityPrismaClientV1) {}

  async claimNext(request: {
    workerId: string;
    nowMs: number;
    leaseMs: number;
  }): Promise<AEmotionAuthorityOutboxClaimV1> {
    if (!request.workerId.trim() || !safeMs(request.nowMs) || !positive(request.leaseMs)) {
      throw invalid("A-Emotion outbox claim request is invalid");
    }
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const now = new Date(request.nowMs);
      const candidate = await tx.pressureOutboxTask.findFirst({
        where: {
          taskType: TASK_TYPE,
          OR: [
            { status: { in: ["PENDING", "RETRYABLE"] }, availableAt: { lte: now } },
            { status: "LEASED", leaseExpiresAt: { lte: now } },
          ],
        },
        orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: outboxSelect(),
      });
      if (!candidate) {
        const future = await tx.pressureOutboxTask.findFirst({
          where: {
            taskType: TASK_TYPE,
            status: { in: ["PENDING", "RETRYABLE", "LEASED"] },
          },
          orderBy: [{ availableAt: "asc" }, { leaseExpiresAt: "asc" }, { id: "asc" }],
          select: outboxSelect(),
        });
        if (!future) return { kind: "EMPTY" };
        return {
          kind: "BUSY",
          retryAtMs: Math.max(
            request.nowMs,
            future.status === "LEASED"
              ? future.leaseExpiresAt?.getTime() ?? request.nowMs
              : future.availableAt.getTime(),
          ),
        };
      }
      if (candidate.taskType !== TASK_TYPE) {
        throw invalid("A-Emotion outbox lane returned a foreign task");
      }
      if (candidate.attempt >= candidate.maxAttempts) {
        await tx.pressureOutboxTask.updateMany({
          where: { id: candidate.id, leaseVersion: candidate.leaseVersion },
          data: {
            status: "DEAD_LETTER",
            checkpoint: "DEAD_LETTER",
            lastError: "ATTEMPTS_EXHAUSTED",
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        return { kind: "EMPTY" };
      }
      let job: AEmotionAuthorityOutboxJobV1;
      try {
        job = decodeJob(candidate);
      } catch (error) {
        await tx.pressureOutboxTask.updateMany({
          where: { id: candidate.id, leaseVersion: candidate.leaseVersion },
          data: {
            status: "DEAD_LETTER",
            checkpoint: "DEAD_LETTER",
            lastError: `INVALID_A_EMOTION_JOB:${safeError(error)}`,
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        return { kind: "EMPTY" };
      }
      const priorStatus = candidate.status;
      const nextFence = candidate.leaseVersion + 1;
      const updated = await tx.pressureOutboxTask.updateMany({
        where: {
          id: candidate.id,
          taskType: TASK_TYPE,
          status: priorStatus,
          leaseVersion: candidate.leaseVersion,
          ...(priorStatus === "LEASED"
            ? { leaseExpiresAt: { lte: now } }
            : { availableAt: { lte: now } }),
        },
        data: {
          status: "LEASED",
          checkpoint: "LEASED",
          leaseOwner: request.workerId,
          leaseExpiresAt: new Date(request.nowMs + request.leaseMs),
          leaseVersion: nextFence,
        },
      });
      if (updated.count !== 1) return { kind: "BUSY", retryAtMs: request.nowMs };
      return {
        kind: "CLAIMED",
        outboxId: candidate.id,
        fence: nextFence,
        attemptCount: candidate.attempt,
        maxAttempts: candidate.maxAttempts,
        job,
      };
    });
  }

  acknowledge(request: { outboxId: string; fence: number }): Promise<void> {
    return this.finish(request, {
      status: "COMPLETED",
      checkpoint: "ACKNOWLEDGED",
      completedAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
    });
  }

  retry(request: {
    outboxId: string;
    fence: number;
    attemptCount: number;
    nextAttemptAtMs: number;
    reasonCode: string;
  }): Promise<void> {
    if (!positive(request.attemptCount) || !safeMs(request.nextAttemptAtMs)) {
      return Promise.reject(invalid("A-Emotion outbox retry request is invalid"));
    }
    return this.finish(request, {
      status: "RETRYABLE",
      checkpoint: "FAILED_RETRYABLE",
      attempt: request.attemptCount,
      availableAt: new Date(request.nextAttemptAtMs),
      lastError: request.reasonCode,
      leaseOwner: null,
      leaseExpiresAt: null,
    }, request.attemptCount);
  }

  deadLetter(request: {
    outboxId: string;
    fence: number;
    attemptCount: number;
    reasonCode: string;
  }): Promise<void> {
    if (!positive(request.attemptCount)) {
      return Promise.reject(invalid("A-Emotion outbox dead-letter request is invalid"));
    }
    return this.finish(request, {
      status: "DEAD_LETTER",
      checkpoint: "DEAD_LETTER",
      attempt: request.attemptCount,
      lastError: request.reasonCode,
      leaseOwner: null,
      leaseExpiresAt: null,
    }, request.attemptCount);
  }

  private async finish(
    request: { outboxId: string; fence: number },
    data: Record<string, unknown>,
    committedAttempt?: number,
  ): Promise<void> {
    await pressureSerializableTransaction(this.prisma, async (tx) => {
      const updated = await tx.pressureOutboxTask.updateMany({
        where: {
          id: request.outboxId,
          taskType: TASK_TYPE,
          status: "LEASED",
          leaseVersion: request.fence,
          ...(committedAttempt === undefined ? {} : { attempt: committedAttempt - 1 }),
        },
        data,
      });
      if (updated.count !== 1) {
        throw new PressurePersistenceError(
          PERSISTENCE_ERROR.OUTBOX_LEASE_LOST,
          "A-Emotion outbox lease fence was lost",
          { outboxId: request.outboxId, fence: request.fence },
        );
      }
    });
  }
}

class PrismaAEmotionCommittedAuthorityLoaderV1 {
  constructor(
    private readonly prisma: AEmotionAuthorityPrismaClientV1,
    private readonly compiler: SangtianAEmotionContentSourceCompilerV1,
  ) {}

  async load(input: Readonly<{
    sourceKind: AEmotionAuthoritySourceKindV1;
    sourceId: string;
    sourceCommitHash: string;
    runId: string;
  }>): Promise<AEmotionAuthorityEmissionV1[]> {
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      if (input.sourceKind === "BEAT_COMMITTED") {
        const rows = await readLedgerRows(tx, input.runId);
        const target = rows.find(({ event }) => event.eventHash === input.sourceId);
        if (!target || target.event.payload.eventType !== "BEAT_APPLIED") return [];
        if (target.event.eventHash !== input.sourceCommitHash) return [];
        const prefix = rows
          .filter(({ event }) => (
            event.chapterRuntimeId === target.event.chapterRuntimeId
            && event.sequence <= target.event.sequence
          ))
          .map(({ event }) => event);
        const projection = projectWorkingLedger(prefix);
        const standardEmissions = this.compiler.compileBeat({
          sourceKind: "BEAT_COMMITTED",
          roomId: input.runId,
          committedAt: target.createdAt.toISOString(),
          beatEventHash: target.event.eventHash,
          ledgerEvents: prefix,
        });
        const lifecycleEmissions = await compileCommittedInvestigationLifecycleEmissionsV1({
          tx,
          beatEvent: target.event,
          projection,
          committedAt: target.createdAt.toISOString(),
        });
        return [...standardEmissions, ...lifecycleEmissions];
      }
      if (input.sourceKind === "FORMAL_COMMITMENT_COMMITTED") {
        const rows = await readLedgerRows(tx, input.runId);
        const target = rows.find(({ event }) => event.eventHash === input.sourceId);
        if (!target || target.event.payload.eventType !== "FORMAL_COMMITMENT_APPLIED") return [];
        if (target.event.eventHash !== input.sourceCommitHash) return [];
        const prefix = rows
          .filter(({ event }) => (
            event.chapterRuntimeId === target.event.chapterRuntimeId
            && event.sequence <= target.event.sequence
          ))
          .map(({ event }) => event);
        projectWorkingLedger(prefix);
        return this.compiler.compileFormalCommitment({
          sourceKind: "FORMAL_COMMITMENT_COMMITTED",
          roomId: input.runId,
          committedAt: target.createdAt.toISOString(),
          commitmentEventHash: target.event.eventHash,
          ledgerEvents: prefix,
        });
      }
      if (input.sourceKind === "CHAPTER_SETTLEMENT_COMMITTED") {
        const row = await tx.pressureChapterSettlement.findUnique({
          where: { id: input.sourceId },
          select: {
            runId: true,
            chapterRuntimeId: true,
            commitManifestJson: true,
            commitHash: true,
            committedAt: true,
          },
        }) as SettlementAuthorityRowV1 | null;
        if (
          !row
          || row.runId !== input.runId
          || row.commitHash !== input.sourceCommitHash
        ) return [];
        const ledger = (await readLedgerRows(tx, input.runId))
          .filter(({ event }) => event.chapterRuntimeId === row.chapterRuntimeId)
          .map(({ event }) => event);
        projectWorkingLedger(ledger);
        return this.compiler.compileChapter({
          sourceKind: "CHAPTER_SETTLEMENT_COMMITTED",
          roomId: input.runId,
          committedAt: row.committedAt.toISOString(),
          record: structuredClone(row.commitManifestJson),
          ledgerEvents: ledger,
        });
      }
      const finale = await tx.pressureFinaleDecision.findFirst({
        where: { runId: input.runId, commitHash: input.sourceCommitHash },
        select: { runId: true, commitHash: true, commitManifestJson: true },
      }) as FinaleAuthorityRowV1 | null;
      if (!finale || finale.commitHash !== input.sourceId) return [];
      const settlements = await tx.pressureChapterSettlement.findMany({
        where: { runId: input.runId },
        select: { chapterRuntimeId: true, chapterSequence: true, commitManifestJson: true },
        orderBy: [{ chapterSequence: "asc" }, { id: "asc" }],
      }) as SettlementChapterRowV1[];
      const ledgerRows = await readLedgerRows(tx, input.runId);
      const chapters = settlements.map((settlement) => ({
        bundle: (settlement.commitManifestJson as { frozenChapterBundle?: unknown }).frozenChapterBundle,
        ledgerEvents: ledgerRows
          .filter(({ event }) => event.chapterRuntimeId === settlement.chapterRuntimeId)
          .map(({ event }) => event),
      }));
      return this.compiler.compileFinale({
        sourceKind: "FINALE_COMMITTED",
        roomId: input.runId,
        record: structuredClone(finale.commitManifestJson),
        chapters,
      });
    });
  }
}

export class PrismaAEmotionCommittedAuthorityReaderV1
implements AEmotionCommittedAuthorityReaderPortV1 {
  constructor(private readonly loader: PrismaAEmotionCommittedAuthorityLoaderV1) {}

  async readCommitted(jobValue: Readonly<AEmotionAuthorityOutboxJobV1>): Promise<unknown | null> {
    const job = validateAEmotionAuthorityOutboxJobV1(jobValue);
    const emissions = await this.loader.load(job);
    const matches = emissions.filter((emission) => (
      emission.job.jobHash === job.jobHash
      && emission.job.signalId === job.signalId
      && emission.job.sourceId === job.sourceId
      && emission.job.sourceCommitHash === job.sourceCommitHash
    ));
    if (matches.length === 0) return null;
    if (matches.length !== 1) throw invalid("Committed A-Emotion job is ambiguous");
    return structuredClone(matches[0]!.source);
  }
}

export class PrismaAEmotionViewerContextReaderV1
implements AEmotionViewerContextReaderPortV1 {
  constructor(
    private readonly prisma: AEmotionAuthorityPrismaClientV1,
    private readonly loader: PrismaAEmotionCommittedAuthorityLoaderV1,
    private readonly eventCompiler = new CanonicalAEmotionAuthorityEventCompilerV1(),
  ) {}

  async readForCommittedSource(
    request: Readonly<AEmotionViewerContextRequestV1>,
  ): Promise<unknown> {
    if (request.roomId !== request.runId) {
      throw invalid("A-Emotion viewer request room/run binding is invalid");
    }
    const emissions = await this.loader.load(request);
    const candidates = emissions.map((emission) => ({
      emission,
      event: this.eventCompiler.compile(emission.job, emission.source),
    })).filter(({ event }) => event.eventId === request.eventId);
    if (candidates.length !== 1) {
      throw invalid("A-Emotion viewer request does not resolve to one committed event");
    }
    const { emission, event } = candidates[0]!;
    assertViewerRequestBinding(request, event);
    const audience = event.audienceSpec.type === "OBSERVERS"
      ? failUnsupportedObservers()
      : [...event.audienceSpec.seatIds];
    const orderedSeats = PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatId) => audience.includes(seatId));
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const contexts = [];
      for (const seatId of orderedSeats) {
        const binding = await readActiveHumanBinding(tx, request.runId, seatId);
        if (!binding) continue;
        const prior = request.revealOfEventId === null
          ? null
          : await readPriorAggregateForReveal(tx, {
              roomId: request.roomId,
              runId: request.runId,
              viewerSeatId: seatId,
              latestEventId: request.revealOfEventId,
            });
        if (request.revealOfEventId !== null && prior === null) {
          throw invalid("A-Emotion reveal has no viewer-authorized prior aggregate");
        }
        const viewer = {
          subjectId: binding.userId,
          roomId: request.roomId,
          runId: request.runId,
          viewerSeatId: seatId,
          knownFactRefs: [...new Set([
            ...event.publicFactRefs,
            ...(event.disclosure === "SUSPECTED" ? event.suspicionBasisRefs : []),
          ])].sort(compare),
          authorizedEvidenceRefs: event.disclosure === "CONFIRMED"
            ? [...event.evidenceRefs].sort(compare)
            : [],
        };
        contexts.push({
          viewer,
          priorProjection: prior?.projection ?? null,
          priorAggregationKey: prior?.aggregationKey ?? null,
          contextHash: sha256Canonical({
            sourceCommitHash: request.sourceCommitHash,
            viewer,
            priorProjectionHash: prior?.projection.projectionHash ?? null,
            priorAggregationKey: prior?.aggregationKey ?? null,
          }),
        });
      }
      return contexts;
    });
  }
}

async function readPriorAggregateForReveal(
  tx: AEmotionAuthorityTransactionV1,
  input: {
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
    latestEventId: string;
  },
): Promise<AEmotionAggregateRecordV1 | null> {
  const rows = await tx.storyEvent.findMany({
    where: { runId: input.runId, type: AGGREGATE_EVENT_TYPE },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const matches = rows
    .map((row) => decodeAggregateEnvelope(row.payloadJson).commit.aggregate)
    .filter((aggregate) => (
      aggregate.roomId === input.roomId
      && aggregate.runId === input.runId
      && aggregate.viewerSeatId === input.viewerSeatId
      && aggregate.latestEventId === input.latestEventId
    ));
  if (matches.length > 1) throw invalid("A-Emotion reveal prior aggregate is ambiguous");
  return matches[0] ? structuredClone(matches[0]) : null;
}

export interface PrismaAEmotionAuthorityBundleV1 {
  outbox: PrismaAEmotionAuthorityOutboxRepositoryV1;
  authority: PrismaAEmotionCommittedAuthorityReaderV1;
  viewers: PrismaAEmotionViewerContextReaderV1;
}

export function createPrismaAEmotionAuthorityBundleV1(
  prisma: AEmotionAuthorityPrismaClientV1,
  options: Readonly<{
    contentCompiler?: SangtianAEmotionContentSourceCompilerV1;
    eventCompiler?: CanonicalAEmotionAuthorityEventCompilerV1;
  }> = {},
): PrismaAEmotionAuthorityBundleV1 {
  const loader = new PrismaAEmotionCommittedAuthorityLoaderV1(
    prisma,
    options.contentCompiler ?? createSangtianAEmotionContentSourceCompilerV1(),
  );
  return Object.freeze({
    outbox: new PrismaAEmotionAuthorityOutboxRepositoryV1(prisma),
    authority: new PrismaAEmotionCommittedAuthorityReaderV1(loader),
    viewers: new PrismaAEmotionViewerContextReaderV1(
      prisma,
      loader,
      options.eventCompiler ?? new CanonicalAEmotionAuthorityEventCompilerV1(),
    ),
  });
}

interface SettlementAuthorityRowV1 {
  runId: string;
  chapterRuntimeId: string;
  commitManifestJson: unknown;
  commitHash: string;
  committedAt: Date;
}

interface FinaleAuthorityRowV1 {
  runId: string;
  commitHash: string;
  commitManifestJson: unknown;
}

interface SettlementChapterRowV1 {
  chapterRuntimeId: string;
  chapterSequence: number;
  commitManifestJson: unknown;
}

async function readLedgerRows(
  tx: AEmotionAuthorityTransactionV1,
  runId: string,
): Promise<Array<{ event: WorkingLedgerEventV1; createdAt: Date }>> {
  const rows = await tx.storyEvent.findMany({
    where: { runId, type: LEDGER_EVENT_TYPE },
    select: { payloadJson: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    event: structuredClone(row.payloadJson) as WorkingLedgerEventV1,
    createdAt: row.createdAt,
  })).sort((left, right) => (
    compare(left.event.chapterRuntimeId, right.event.chapterRuntimeId)
    || left.event.sequence - right.event.sequence
    || compare(left.event.eventHash, right.event.eventHash)
  ));
}

async function readActiveHumanBinding(
  tx: AEmotionAuthorityTransactionV1,
  runId: string,
  seatId: SeatIdV1,
): Promise<{ userId: string } | null> {
  const role = await tx.storyRole.findUnique({
    where: { runId_roleKey: { runId, roleKey: seatId } },
    select: { id: true, runId: true, roleKey: true },
  }) as { id: string; runId: string; roleKey: string } | null;
  if (!role || role.runId !== runId || role.roleKey !== seatId) return null;
  const player = await tx.storyPlayer.findUnique({
    where: { runId_roleId: { runId, roleId: role.id } },
    select: { runId: true, roleId: true, userId: true, playerType: true, status: true },
  }) as {
    runId: string;
    roleId: string;
    userId: string | null;
    playerType: string;
    status: string;
  } | null;
  if (
    !player
    || player.runId !== runId
    || player.roleId !== role.id
    || player.playerType !== "human"
    || player.status !== "active"
    || !player.userId?.trim()
  ) return null;
  return { userId: player.userId };
}

function assertViewerRequestBinding(
  request: Readonly<AEmotionViewerContextRequestV1>,
  event: Readonly<AEmotionInteractionEventPortV1>,
): void {
  if (
    request.roomId !== event.roomId
    || request.runId !== event.runId
    || request.stageId !== event.stageId
    || request.eventFamily !== event.eventFamily
    || request.sharedObjectId !== event.sharedObjectId
    || request.revealOfEventId !== event.revealOfEventId
    || sha256Canonical(request.audienceSpec) !== sha256Canonical(event.audienceSpec)
  ) throw invalid("A-Emotion viewer request binding drifted");
}

function failUnsupportedObservers(): never {
  throw invalid("Observer audience requires a frozen resolver result");
}

function decodeJob(row: OutboxRowV1): AEmotionAuthorityOutboxJobV1 {
  if (sha256Canonical(row.payloadJson) !== row.payloadHash) {
    throw invalid("A-Emotion outbox payload hash mismatch");
  }
  return validateAEmotionAuthorityOutboxJobV1(row.payloadJson);
}

function outboxSelect(): Record<string, true> {
  return {
    id: true,
    taskType: true,
    status: true,
    payloadJson: true,
    payloadHash: true,
    attempt: true,
    maxAttempts: true,
    availableAt: true,
    leaseOwner: true,
    leaseExpiresAt: true,
    leaseVersion: true,
  };
}

function invalid(message: string): PressurePersistenceError {
  return new PressurePersistenceError(PERSISTENCE_ERROR.RECORD_INVALID, message);
}

function safeMs(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function positive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.name : "UNKNOWN";
}
