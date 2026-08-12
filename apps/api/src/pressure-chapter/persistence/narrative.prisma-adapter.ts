import { Prisma } from "@prisma/client";
import {
  computeNarrativeArtifactContentHash,
  sha256Canonical,
  validateOpenNovelNarrativeArtifactV1,
  validateOpenNovelNarrativeProjectionJobV1,
  type OpenNovelNarrativeArtifactV1,
  type OpenNovelNarrativeProjectionJobV1,
} from "@ai-story/shared";
import type {
  AuthoritativeNarrativeSourceReaderPortV1,
  NarrativeOutboxClaimV1,
  NarrativeOutboxPortV1,
} from "../narrative/ports";
import type {
  NarrativeArtifactPublisherPortV1,
  NarrativeProjectionClaimRequestV1,
  NarrativeProjectionClaimV1,
  NarrativeProjectionStatePortV1,
  NarrativeProjectionTransitionV1,
} from "@apps/openovel-runtime/pressure-narrative/ports";
import type { PressureNarrativeErrorCode } from "@apps/openovel-runtime/pressure-narrative/errors";
import { projectWorkingLedger } from "../working-ledger/working-ledger";
import type { WorkingLedgerEventV1 } from "../working-ledger/contracts";
import { validateAtomicChapterCommitRecordV1 } from "../chapter-settlement";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "./errors";
import {
  pressureSerializableTransaction,
  type PressureSerializableClient,
} from "./transaction";

const NARRATIVE_TASKS = [
  "PROJECT_GENESIS_NARRATIVE",
  "PROJECT_BEAT_NARRATIVE",
  "PROJECT_CHAPTER_NARRATIVE",
  "PROJECT_FINALE_NARRATIVE",
] as const;

interface OutboxRow {
  id: string;
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

interface NarrativeOutboxTransaction {
  pressureOutboxTask: {
    findFirst(input: Record<string, unknown>): Promise<OutboxRow | null>;
    findUnique(input: Record<string, unknown>): Promise<OutboxRow | null>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
}

export type NarrativeOutboxPrismaClient =
  PressureSerializableClient<NarrativeOutboxTransaction>;

/** Lease/fence outbox capability. It cannot access authority tables. */
export class PrismaNarrativeOutboxRepository implements NarrativeOutboxPortV1 {
  constructor(private readonly prisma: NarrativeOutboxPrismaClient) {}

  async claimNext(request: {
    workerId: string;
    nowMs: number;
    leaseMs: number;
  }): Promise<NarrativeOutboxClaimV1> {
    if (!request.workerId.trim() || !safeMs(request.nowMs) || request.leaseMs <= 0) {
      throw invalid("Narrative outbox claim request is invalid");
    }
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const now = new Date(request.nowMs);
      const candidate = await tx.pressureOutboxTask.findFirst({
        where: {
          taskType: { in: [...NARRATIVE_TASKS] },
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
            taskType: { in: [...NARRATIVE_TASKS] },
            status: { in: ["PENDING", "RETRYABLE", "LEASED"] },
          },
          orderBy: [{ availableAt: "asc" }, { leaseExpiresAt: "asc" }],
          select: outboxSelect(),
        });
        if (!future) return { kind: "EMPTY" };
        const retryAtMs = Math.max(
          request.nowMs,
          future.status === "LEASED"
            ? future.leaseExpiresAt?.getTime() ?? request.nowMs
            : future.availableAt.getTime(),
        );
        return { kind: "BUSY", retryAtMs };
      }
      if (candidate.attempt >= candidate.maxAttempts) {
        const dead = await tx.pressureOutboxTask.updateMany({
          where: { id: candidate.id, leaseVersion: candidate.leaseVersion },
          data: {
            status: "DEAD_LETTER",
            checkpoint: "DEAD_LETTER",
            lastError: "ATTEMPTS_EXHAUSTED",
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        if (dead.count !== 1) return { kind: "BUSY", retryAtMs: request.nowMs };
        return { kind: "EMPTY" };
      }
      const previousStatus = candidate.status;
      const nextFence = candidate.leaseVersion + 1;
      const claimed = await tx.pressureOutboxTask.updateMany({
        where: {
          id: candidate.id,
          status: previousStatus,
          leaseVersion: candidate.leaseVersion,
          ...(previousStatus === "LEASED"
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
      if (claimed.count !== 1) return { kind: "BUSY", retryAtMs: request.nowMs };
      const job = decodeOutboxJob(candidate);
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

  async acknowledge(request: { outboxId: string; fence: number }): Promise<void> {
    await this.finishLease(request, {
      status: "COMPLETED",
      checkpoint: "ACKNOWLEDGED",
      completedAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
    });
  }

  async retry(request: {
    outboxId: string;
    fence: number;
    attemptCount: number;
    nextAttemptAtMs: number;
    reasonCode: string;
  }): Promise<void> {
    if (!safeMs(request.nextAttemptAtMs) || !positiveInteger(request.attemptCount)) {
      throw invalid("Narrative outbox retry request is invalid");
    }
    await this.finishLease(request, {
      status: "RETRYABLE",
      checkpoint: "FAILED_RETRYABLE",
      attempt: request.attemptCount,
      availableAt: new Date(request.nextAttemptAtMs),
      lastError: request.reasonCode,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  }

  async deadLetter(request: {
    outboxId: string;
    fence: number;
    attemptCount: number;
    reasonCode: string;
  }): Promise<void> {
    if (!positiveInteger(request.attemptCount)) {
      throw invalid("Narrative outbox dead-letter attempt is invalid");
    }
    await this.finishLease(request, {
      status: "DEAD_LETTER",
      checkpoint: "DEAD_LETTER",
      attempt: request.attemptCount,
      lastError: request.reasonCode,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  }

  private async finishLease(
    request: { outboxId: string; fence: number },
    data: Record<string, unknown>,
  ): Promise<void> {
    await pressureSerializableTransaction(this.prisma, async (tx) => {
      const committedAttempt = data.attempt;
      const updated = await tx.pressureOutboxTask.updateMany({
        where: {
          id: request.outboxId,
          status: "LEASED",
          leaseVersion: request.fence,
          ...(typeof committedAttempt === "number"
            ? { attempt: committedAttempt - 1 }
            : {}),
        },
        data,
      });
      if (updated.count !== 1) {
        throw new PressurePersistenceError(
          ERROR.OUTBOX_LEASE_LOST,
          "Narrative outbox lease fence was lost",
          { outboxId: request.outboxId, fence: request.fence },
        );
      }
    });
  }
}

interface ProjectionRow {
  id: string;
  runId: string;
  projectionKind: string;
  sourceAuthority: string;
  sourceId: string;
  sourceCommitHash: string;
  sourceContentHash: string;
  narrativeProfileVersion: string;
  projectorVersion: string;
  audienceKind: string;
  audienceSeatId: string | null;
  audienceKey: string;
  status: string;
  requestFingerprint: string;
  attempt: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  leaseVersion: number;
  lastError: string | null;
  artifactJson: unknown | null;
  artifactContentHash: string | null;
}

interface ProjectionTransaction {
  pressureNarrativeProjection: {
    findFirst(input: Record<string, unknown>): Promise<ProjectionRow | null>;
    findUnique(input: Record<string, unknown>): Promise<ProjectionRow | null>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
}

export type NarrativeProjectionPrismaClient =
  PressureSerializableClient<ProjectionTransaction>;

interface ProjectionMetaV1 {
  schemaVersion: "pressure_narrative_projection_meta_v1";
  logicalProjectionKey: string;
  jobId: string;
  providerAttemptCount: number;
  deliveryFailureCount: number;
  nextAttemptAtMs: number | null;
  pendingArtifact: OpenNovelNarrativeArtifactV1 | null;
  lastErrorCode: PressureNarrativeErrorCode | null;
  deliveryState: "ACTIVE" | "DEAD_LETTERED";
}

/**
 * Narrative-only state capability. Its transaction type deliberately exposes
 * no Run, Genesis, ChapterSettlement, Finale or Result authority delegate.
 */
export class PrismaNarrativeProjectionStateRepository
implements NarrativeProjectionStatePortV1, NarrativeArtifactPublisherPortV1 {
  constructor(private readonly prisma: NarrativeProjectionPrismaClient) {}

  async claim(request: NarrativeProjectionClaimRequestV1): Promise<NarrativeProjectionClaimV1> {
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const row = await tx.pressureNarrativeProjection.findFirst({
        where: { requestFingerprint: request.requestFingerprint },
        select: projectionSelect(),
      });
      if (!row) return { kind: "DEAD_LETTERED", reasonCode: "PROJECTION_DEAD_LETTERED" };
      const meta = decodeProjectionMeta(row);
      if (
        meta.logicalProjectionKey !== request.logicalProjectionKey
        || meta.jobId !== request.jobId
      ) {
        return { kind: "DEAD_LETTERED", reasonCode: "PROJECTION_DEAD_LETTERED" };
      }
      if (meta.deliveryState === "DEAD_LETTERED") {
        return {
          kind: "DEAD_LETTERED",
          reasonCode: meta.lastErrorCode ?? "PROJECTION_DEAD_LETTERED",
        };
      }
      if (row.status === "PUBLISHED" || row.status === "FALLBACK_PUBLISHED") {
        const artifact = await readPublishedArtifact(tx, row);
        return {
          kind: "ALREADY_PUBLISHED",
          projectionId: row.id,
          requestFingerprint: row.requestFingerprint,
          artifact,
        };
      }
      const now = request.nowMs;
      if (
        (row.leaseExpiresAt && row.leaseExpiresAt.getTime() > now)
        || (meta.nextAttemptAtMs !== null && meta.nextAttemptAtMs > now)
      ) {
        return {
          kind: "BUSY",
          retryAtMs: Math.max(
            row.leaseExpiresAt?.getTime() ?? 0,
            meta.nextAttemptAtMs ?? 0,
          ),
        };
      }
      const nextFence = row.leaseVersion + 1;
      const updated = await tx.pressureNarrativeProjection.updateMany({
        where: {
          id: row.id,
          requestFingerprint: request.requestFingerprint,
          leaseVersion: row.leaseVersion,
        },
        data: {
          status: "GENERATING",
          checkpoint: "HANDLER_STARTED",
          leaseOwner: request.workerId,
          leaseExpiresAt: new Date(now + request.leaseMs),
          leaseVersion: nextFence,
          lastError: encodeProjectionMeta({ ...meta, nextAttemptAtMs: null }),
        },
      });
      if (updated.count !== 1) return { kind: "BUSY", retryAtMs: now };
      return {
        kind: "CLAIMED",
        projectionId: row.id,
        fence: nextFence,
        requestFingerprint: row.requestFingerprint,
        providerAttemptCount: meta.providerAttemptCount,
        deliveryFailureCount: meta.deliveryFailureCount,
        pendingArtifact: structuredClone(meta.pendingArtifact),
      };
    });
  }

  async transition(request: NarrativeProjectionTransitionV1): Promise<void> {
    await pressureSerializableTransaction(this.prisma, async (tx) => {
      const row = await requireProjectionFence(tx, request.projectionId, request.fence);
      const meta = decodeProjectionMeta(row);
      const updated = await tx.pressureNarrativeProjection.updateMany({
        where: { id: row.id, leaseVersion: request.fence },
        data: {
          status: request.status,
          attempt: request.providerAttemptCount,
          checkpoint: request.status === "FAILED_RETRYABLE"
            ? "FAILED_RETRYABLE"
            : request.status === "VALIDATING"
              ? "HANDLER_COMMITTED"
              : "HANDLER_STARTED",
          lastError: encodeProjectionMeta({
            ...meta,
            providerAttemptCount: request.providerAttemptCount,
            deliveryFailureCount: request.deliveryFailureCount,
            nextAttemptAtMs: request.nextAttemptAtMs,
            pendingArtifact: structuredClone(request.pendingArtifact),
            lastErrorCode: request.lastErrorCode,
          }),
          ...(request.status === "FAILED_RETRYABLE"
            ? { leaseOwner: null, leaseExpiresAt: null }
            : {}),
        },
      });
      assertProjectionFence(updated.count, request.projectionId, request.fence);
    });
  }

  async publish(request: {
    logicalProjectionKey: string;
    requestFingerprint: string;
    projectionId: string;
    fence: number;
    artifact: OpenNovelNarrativeArtifactV1;
  }): Promise<OpenNovelNarrativeArtifactV1> {
    const artifact = structuredClone(validateOpenNovelNarrativeArtifactV1(request.artifact));
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const row = await requireProjectionFence(tx, request.projectionId, request.fence);
      const meta = decodeProjectionMeta(row);
      if (
        row.requestFingerprint !== request.requestFingerprint
        || meta.logicalProjectionKey !== request.logicalProjectionKey
        || meta.jobId !== artifact.jobId
      ) throw invalid("Narrative artifact is not bound to its projection");
      assertArtifactBoundToProjection(row, artifact);
      if (row.artifactJson !== null || row.artifactContentHash !== null) {
        const prior = decodeProjectionArtifact(row);
        if (sha256Canonical(prior) !== sha256Canonical(artifact)) {
          throw new PressurePersistenceError(
            ERROR.FINGERPRINT_MISMATCH,
            "Narrative projection already contains a different artifact",
            { projectionId: row.id, contentHash: artifact.contentHash },
          );
        }
        return prior;
      }
      const updated = await tx.pressureNarrativeProjection.updateMany({
        where: {
          id: row.id,
          leaseVersion: request.fence,
          artifactContentHash: null,
        },
        data: {
          artifactJson: json(artifact),
          artifactContentHash: artifact.contentHash,
        },
      });
      assertProjectionFence(updated.count, request.projectionId, request.fence);
      return structuredClone(artifact);
    });
  }

  async markPublished(request: {
    projectionId: string;
    fence: number;
    status: "PUBLISHED" | "FALLBACK_PUBLISHED";
    artifact: OpenNovelNarrativeArtifactV1;
  }): Promise<void> {
    const artifact = validateOpenNovelNarrativeArtifactV1(request.artifact);
    await pressureSerializableTransaction(this.prisma, async (tx) => {
      const row = await requireProjectionFence(tx, request.projectionId, request.fence);
      assertArtifactBoundToProjection(row, artifact);
      if (request.status !== artifact.status) {
        throw invalid("Narrative publication status does not match its artifact");
      }
      if (
        row.artifactContentHash !== artifact.contentHash
        || sha256Canonical(decodeProjectionArtifact(row)) !== sha256Canonical(artifact)
      ) {
        throw invalid("Published NarrativeArtifact was not durably staged");
      }
      const meta = decodeProjectionMeta(row);
      const updated = await tx.pressureNarrativeProjection.updateMany({
        where: { id: row.id, leaseVersion: request.fence },
        data: {
          status: request.status,
          checkpoint: "PUBLISHED",
          publishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: encodeProjectionMeta({
            ...meta,
            pendingArtifact: null,
            lastErrorCode: null,
            nextAttemptAtMs: null,
          }),
        },
      });
      assertProjectionFence(updated.count, request.projectionId, request.fence);
    });
  }

  async deadLetter(request: {
    projectionId: string;
    fence: number;
    reasonCode: PressureNarrativeErrorCode;
    pendingArtifact: OpenNovelNarrativeArtifactV1 | null;
  }): Promise<void> {
    await pressureSerializableTransaction(this.prisma, async (tx) => {
      const row = await requireProjectionFence(tx, request.projectionId, request.fence);
      const meta = decodeProjectionMeta(row);
      const updated = await tx.pressureNarrativeProjection.updateMany({
        where: { id: row.id, leaseVersion: request.fence },
        data: {
          status: "FAILED_RETRYABLE",
          checkpoint: "DEAD_LETTER",
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: encodeProjectionMeta({
            ...meta,
            deliveryState: "DEAD_LETTERED",
            pendingArtifact: structuredClone(request.pendingArtifact),
            lastErrorCode: request.reasonCode,
            nextAttemptAtMs: null,
          }),
        },
      });
      assertProjectionFence(updated.count, request.projectionId, request.fence);
    });
  }
}

interface AuthorityReadTransaction {
  pressureGenesisCommit: { findUnique(input: Record<string, unknown>): Promise<unknown | null> };
  storyEvent: { findMany(input: Record<string, unknown>): Promise<Array<{
    runId: string;
    type: string;
    payloadJson: unknown;
    dedupeKey: string | null;
  }>> };
  pressureRunRouteSnapshot: { findUnique(input: Record<string, unknown>): Promise<{
    runId: string;
    contentPackageSha256: string;
  } | null> };
  pressureChapterSettlement: { findFirst(input: Record<string, unknown>): Promise<{
    runId: string;
    commitManifestJson: unknown;
    commitHash: string;
  } | null> };
  pressureFinaleDecision: { findUnique(input: Record<string, unknown>): Promise<unknown | null> };
  pressureLegacyTerminalCommit: { findUnique(input: Record<string, unknown>): Promise<unknown | null> };
}

export interface AuthoritativeNarrativeSnapshotCompilerPortV1 {
  compile(
    job: Readonly<OpenNovelNarrativeProjectionJobV1>,
    rawAuthority: Readonly<unknown>,
  ): unknown;
}

export type NarrativeAuthorityReadPrismaClient =
  PressureSerializableClient<AuthorityReadTransaction>;

/** Read-only raw-authority reader plus pure snapshot compiler. */
export class PrismaAuthoritativeNarrativeSourceReader
implements AuthoritativeNarrativeSourceReaderPortV1 {
  constructor(
    private readonly prisma: NarrativeAuthorityReadPrismaClient,
    private readonly compiler: AuthoritativeNarrativeSnapshotCompilerPortV1,
  ) {}

  async readCommitted(jobValue: Readonly<OpenNovelNarrativeProjectionJobV1>): Promise<unknown | null> {
    const job = validateOpenNovelNarrativeProjectionJobV1(jobValue);
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const raw = await readNarrativeAuthority(tx, job);
      if (raw == null) return null;
      return structuredClone(this.compiler.compile(job, raw));
    });
  }
}

async function readNarrativeAuthority(
  tx: AuthorityReadTransaction,
  job: OpenNovelNarrativeProjectionJobV1,
): Promise<unknown | null> {
  if (job.sourceAuthority === "GENESIS_FROZEN") {
    return tx.pressureGenesisCommit.findUnique({
      where: { runId: job.runId },
      select: { runId: true, commitManifestJson: true, commitHash: true },
    });
  }
  if (job.sourceAuthority === "CHAPTER_WORKING") {
    return readCommittedBeatAuthority(tx, job);
  }
  if (job.sourceAuthority === "CHAPTER_FROZEN") {
    const row = await tx.pressureChapterSettlement.findFirst({
      where: { runId: job.runId, frozenBundleHash: job.sourceId },
      select: { runId: true, commitManifestJson: true, commitHash: true },
    });
    if (!row) return null;
    const record = validateAtomicChapterCommitRecordV1(row.commitManifestJson);
    const bundle = record.frozenChapterBundle;
    if (
      row.runId !== job.runId
      || record.runId !== row.runId
      || record.receipt.commitHash !== row.commitHash
      || bundle.bundleHash !== job.sourceId
    ) throw invalid("Committed Chapter narrative authority is invalid");
    return {
      runId: row.runId,
      bundleHash: bundle.bundleHash,
      frozenWorldStateJson: structuredClone(bundle.frozenWorldState),
      causalEdgesJson: structuredClone(bundle.causalEdges),
      carryForwardJson: structuredClone(bundle.carryForward),
    };
  }
  if (job.sourceAuthority === "FINALE_FROZEN") {
    return tx.pressureFinaleDecision.findUnique({
      where: { runId: job.runId },
      select: {
        runId: true,
        commitHash: true,
        commitManifestHash: true,
        executionFingerprint: true,
        semanticOutcomeHash: true,
        commitManifestJson: true,
      },
    });
  }
  return tx.pressureLegacyTerminalCommit.findUnique({
    where: { runId: job.runId },
    select: { runId: true, commitManifestJson: true, commitHash: true },
  });
}

async function readCommittedBeatAuthority(
  tx: AuthorityReadTransaction,
  job: OpenNovelNarrativeProjectionJobV1,
): Promise<unknown | null> {
  const [rows, route] = await Promise.all([
    tx.storyEvent.findMany({
      where: { runId: job.runId, type: "PRESSURE_WORKING_LEDGER_EVENT" },
      orderBy: { createdAt: "asc" },
      select: { runId: true, type: true, payloadJson: true, dedupeKey: true },
    }),
    tx.pressureRunRouteSnapshot.findUnique({
      where: { runId: job.runId },
      select: { runId: true, contentPackageSha256: true },
    }),
  ]);
  if (!route || route.runId !== job.runId) return null;
  const events = rows.map((row) => decodeWorkingLedgerStoryEvent(row, job.runId));
  const target = events.find((event) => (
    event.payload.eventType === "BEAT_APPLIED"
    && event.payload.beatResolution.resolutionHash === job.sourceId
  ));
  if (!target || target.payload.eventType !== "BEAT_APPLIED") return null;
  const chapterEvents = events
    .filter((event) => event.chapterRuntimeId === target.chapterRuntimeId)
    .sort((left, right) => left.sequence - right.sequence);
  let projection: ReturnType<typeof projectWorkingLedger>;
  try {
    projection = projectWorkingLedger(chapterEvents);
  } catch (cause) {
    throw invalid("Committed Working Ledger projection is invalid", {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
  const beat = target.payload.beatResolution;
  const applied = projection.appliedBeats.get(beat.sealedActionIds[0]!);
  if (!applied || applied.resolution.resolutionHash !== beat.resolutionHash) {
    throw invalid("Committed Beat is absent from the Working Ledger projection");
  }
  const sealedActions = beat.sealedActionIds.map((actionId) => {
    const action = projection.acceptedActions.get(actionId)?.action;
    if (!action) throw invalid("Committed Beat is missing a sealed action", { actionId });
    return structuredClone(action);
  }).sort((left, right) => left.actionId.localeCompare(right.actionId));
  return {
    schemaVersion: "pressure_committed_beat_narrative_authority_v1",
    runId: target.runId,
    chapterRuntimeId: target.chapterRuntimeId,
    chapterId: target.chapterId,
    decisionPointId: beat.decisionPointId,
    decisionPointKey: beat.decisionPointId,
    baseWorkingRevision: beat.baseWorkingRevision,
    committedWorkingRevision: beat.committedWorkingRevision,
    inputWorkingStateHash: beat.inputWorkingStateHash,
    sealedActionIds: [...beat.sealedActionIds].sort(),
    sealedActionsHash: beat.sealedActionsHash,
    sealedActions,
    resolverVersion: beat.resolverVersion,
    workingDelta: structuredClone(beat.workingDelta),
    workingDeltaHash: sha256Canonical(beat.workingDelta),
    reservationMutations: structuredClone(beat.reservationMutations),
    reactionContextRef: structuredClone(beat.reactionContextRef),
    nextDecisionContextRef: structuredClone(beat.nextDecisionContextRef),
    resolutionHash: beat.resolutionHash,
    contentPackageSha256: route.contentPackageSha256,
  };
}

function decodeWorkingLedgerStoryEvent(
  row: { runId: string; type: string; payloadJson: unknown; dedupeKey: string | null },
  runId: string,
): WorkingLedgerEventV1 {
  const event = structuredClone(row.payloadJson) as WorkingLedgerEventV1;
  const { eventHash, ...body } = event;
  if (
    row.runId !== runId
    || row.type !== "PRESSURE_WORKING_LEDGER_EVENT"
    || event.runId !== runId
    || event.schemaVersion !== "pressure_working_ledger_event_v1"
    || sha256Canonical(body) !== eventHash
    || row.dedupeKey !== `pressure-ledger:${runId}:${event.chapterRuntimeId}:${eventHash}`
  ) throw invalid("Committed Working Ledger StoryEvent is invalid");
  return event;
}

function decodeOutboxJob(row: OutboxRow): OpenNovelNarrativeProjectionJobV1 {
  try {
    if (sha256Canonical(row.payloadJson) !== row.payloadHash) {
      throw new Error("PAYLOAD_HASH_MISMATCH");
    }
    return structuredClone(validateOpenNovelNarrativeProjectionJobV1(row.payloadJson));
  } catch (cause) {
    throw invalid("Narrative outbox payload is invalid", {
      outboxId: row.id,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

async function requireProjectionFence(
  tx: ProjectionTransaction,
  projectionId: string,
  fence: number,
): Promise<ProjectionRow> {
  const row = await tx.pressureNarrativeProjection.findUnique({
    where: { id: projectionId },
    select: projectionSelect(),
  });
  if (!row || row.leaseVersion !== fence) {
    throw new PressurePersistenceError(
      ERROR.OUTBOX_LEASE_LOST,
      "Narrative projection fence was lost",
      { projectionId, fence },
    );
  }
  return row;
}

async function readPublishedArtifact(
  _tx: ProjectionTransaction,
  row: ProjectionRow,
): Promise<OpenNovelNarrativeArtifactV1> {
  const decoded = decodeProjectionArtifact(row);
  assertArtifactBoundToProjection(row, decoded);
  return decoded;
}

function assertArtifactBoundToProjection(
  row: ProjectionRow,
  artifact: OpenNovelNarrativeArtifactV1,
): void {
  const audienceKey = artifact.audience.kind === "PUBLIC"
    ? "public"
    : artifact.audience.seatId;
  if (
    row.runId !== artifact.runId
    || row.projectionKind !== artifact.projectionKind
    || row.sourceId !== artifact.sourceId
    || row.sourceCommitHash !== artifact.sourceCommitHash
    || row.sourceContentHash !== artifact.sourceContentHash
    || row.narrativeProfileVersion !== artifact.narrativeProfileVersion
    || row.projectorVersion !== artifact.projectorVersion
    || row.audienceKind !== artifact.audience.kind
    || row.audienceSeatId !== artifact.audience.seatId
    || row.audienceKey !== audienceKey
  ) {
    throw invalid("Narrative artifact is not bound to its projection", {
      projectionId: row.id,
      artifactJobId: artifact.jobId,
    });
  }
}

function decodeProjectionArtifact(row: ProjectionRow): OpenNovelNarrativeArtifactV1 {
  try {
    if (row.artifactJson === null || row.artifactContentHash === null) {
      throw new Error("ARTIFACT_MISSING");
    }
    const artifact = validateOpenNovelNarrativeArtifactV1(row.artifactJson);
    if (
      artifact.contentHash !== row.artifactContentHash
      || artifact.contentHash !== computeNarrativeArtifactContentHash({
        text: artifact.text,
        usedFactRefs: artifact.usedFactRefs,
      })
    ) throw new Error("ROW_HASH_MISMATCH");
    return structuredClone(artifact);
  } catch (cause) {
    throw invalid("Stored narrative projection artifact is invalid", {
      projectionId: row.id,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function decodeProjectionMeta(row: ProjectionRow): ProjectionMetaV1 {
  try {
    if (!row.lastError) throw new Error("META_MISSING");
    const value = JSON.parse(row.lastError) as ProjectionMetaV1;
    if (
      value.schemaVersion !== "pressure_narrative_projection_meta_v1"
      || !/^[a-f0-9]{64}$/.test(value.logicalProjectionKey)
      || !value.jobId
    ) throw new Error("META_INVALID");
    if (value.pendingArtifact) validateOpenNovelNarrativeArtifactV1(value.pendingArtifact);
    return value;
  } catch (cause) {
    throw invalid("Narrative projection metadata is invalid", {
      projectionId: row.id,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

export function createNarrativeProjectionMetaV1(input: {
  logicalProjectionKey: string;
  jobId: string;
}): string {
  return encodeProjectionMeta({
    schemaVersion: "pressure_narrative_projection_meta_v1",
    logicalProjectionKey: input.logicalProjectionKey,
    jobId: input.jobId,
    providerAttemptCount: 0,
    deliveryFailureCount: 0,
    nextAttemptAtMs: null,
    pendingArtifact: null,
    lastErrorCode: null,
    deliveryState: "ACTIVE",
  });
}

function encodeProjectionMeta(value: ProjectionMetaV1): string {
  return JSON.stringify(value);
}

function assertProjectionFence(count: number, projectionId: string, fence: number): void {
  if (count !== 1) {
    throw new PressurePersistenceError(
      ERROR.OUTBOX_LEASE_LOST,
      "Narrative projection fence was lost",
      { projectionId, fence },
    );
  }
}

function outboxSelect(): Record<string, true> {
  return {
    id: true,
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

function projectionSelect(): Record<string, true> {
  return {
    id: true,
    runId: true,
    projectionKind: true,
    sourceAuthority: true,
    sourceId: true,
    sourceCommitHash: true,
    sourceContentHash: true,
    narrativeProfileVersion: true,
    projectorVersion: true,
    audienceKind: true,
    audienceSeatId: true,
    audienceKey: true,
    status: true,
    requestFingerprint: true,
    attempt: true,
    maxAttempts: true,
    leaseOwner: true,
    leaseExpiresAt: true,
    leaseVersion: true,
    lastError: true,
    artifactJson: true,
    artifactContentHash: true,
  };
}

function safeMs(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function invalid(
  message: string,
  details: Record<string, unknown> = {},
): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.RECORD_INVALID, message, details);
}

function json(value: unknown): Prisma.InputJsonValue {
  return structuredClone(value) as Prisma.InputJsonValue;
}
