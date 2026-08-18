import { Prisma } from "@prisma/client";
import {
  isSha256,
  sha256Canonical,
  validateRunRouteSnapshotV1,
  type ChapterIdV1,
  type SeatIdV1,
} from "@ai-story/shared";
import { readCurrentOrchestratorState } from "../persistence/orchestrator-state.prisma-adapter";
import { assertStoredRunRouteRecord } from "../run-router";
import { decodeSeatEnvelope } from "../seat-control-persistence/envelope";
import { decodeWorkingLedgerProjectionCacheV1 } from "../working-ledger/projection-cache";
import { workingStateHash } from "../working-ledger/working-ledger";
import {
  recordPressureDbTransactionAttemptV1,
  recordPressureDbTransactionCommitV1,
  recordPressureDbTransactionRollbackV1,
} from "../observability/pressure-db-metrics";
import {
  DECISION_AUTOMATION_ERROR_CODES as ERROR,
  failDecisionAutomation,
} from "./errors";
import type {
  DecisionConvergenceAuthoritySnapshotV1,
  DecisionConvergenceSnapshotReaderPortV1,
  DecisionSubmitSnapshotV1,
} from "./contracts";
import { withDecisionConvergenceSnapshotHashV1 } from "./convergence.service";
import type {
  CaptureGameReadSnapshotV1,
  GameReadSnapshotPrismaClientV1,
} from "../persistence/game-read-snapshot.prisma-adapter";
import type { GameReadSnapshotV1 } from "../game-projection/game-read-snapshot";

interface SnapshotRouteRowV1 {
  runId: string;
  routeHash: string;
  routeJson: unknown;
}

interface SnapshotRuntimeRowV1 {
  id: string;
  runId: string;
  chapterId: string;
  routeHash: string;
  workingRevision: number;
  workingStateJson: unknown;
  workingStateHash: string;
  ledgerProjectionJson: unknown;
  state: string;
}

interface SnapshotViewerRowV1 {
  runId: string;
  userId: string | null;
  playerType: string;
  status: string;
  role: { roleKey: string } | null;
}

interface SnapshotSeatRowV1 {
  runId: string;
  stateRevision: number;
  snapshotJson: unknown;
  stateHash: string;
  version: number;
}

interface SnapshotOrchestratorEventRowV1 {
  id: string;
  runId: string;
  type: string;
  payloadJson: unknown;
  dedupeKey: string | null;
}

interface DecisionConvergenceSnapshotTransactionV1 {
  $queryRaw<TResult = unknown>(query: Prisma.Sql): Promise<TResult>;
  pressureRunRouteSnapshot: {
    findUnique(input: Record<string, unknown>): Promise<SnapshotRouteRowV1 | null>;
  };
  pressureChapterRuntime: {
    findUnique(input: Record<string, unknown>): Promise<SnapshotRuntimeRowV1 | null>;
  };
  pressureSeatControlSnapshot: {
    findUnique(input: Record<string, unknown>): Promise<SnapshotSeatRowV1 | null>;
  };
  storyEvent: {
    findMany(input: Record<string, unknown>): Promise<SnapshotOrchestratorEventRowV1[]>;
    findUnique(input: Record<string, unknown>): Promise<unknown>;
  };
  storyPlayer: {
    findUnique(input: Record<string, unknown>): Promise<SnapshotViewerRowV1 | null>;
  };
}

export interface DecisionSubmitPageSnapshotReaderPortV1 {
  captureWithClient(
    prisma: GameReadSnapshotPrismaClientV1,
    input: Readonly<CaptureGameReadSnapshotV1>,
  ): Promise<GameReadSnapshotV1>;
}

type CaptureInputV1 = Parameters<DecisionConvergenceSnapshotReaderPortV1["capture"]>[0];
type CaptureSubmitInputV1 = Parameters<
  NonNullable<DecisionConvergenceSnapshotReaderPortV1["captureSubmit"]>
>[0];

export interface DecisionConvergenceSnapshotPrismaClientV1 {
  $transaction<TResult>(
    operation: (tx: DecisionConvergenceSnapshotTransactionV1) => Promise<TResult>,
    options: typeof FAST_TRANSACTION_OPTIONS,
  ): Promise<TResult>;
}

const FAST_TRANSACTION_OPTIONS = Object.freeze({
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 500,
  timeout: 10_000,
});

async function pressureFastSerializableTransaction<TResult>(
  prisma: DecisionConvergenceSnapshotPrismaClientV1,
  operation: (tx: DecisionConvergenceSnapshotTransactionV1) => Promise<TResult>,
): Promise<TResult> {
  recordPressureDbTransactionAttemptV1();
  try {
    const result = await prisma.$transaction(operation, FAST_TRANSACTION_OPTIONS);
    recordPressureDbTransactionCommitV1();
    return result;
  } catch (error) {
    recordPressureDbTransactionRollbackV1();
    throw error;
  }
}

/**
 * Captures route, W4, W5 and SeatControl in one short Serializable snapshot.
 * Published content and policy execution remain outside this transaction.
 */
export class PrismaDecisionConvergenceSnapshotReaderV1
implements DecisionConvergenceSnapshotReaderPortV1 {
  constructor(
    private readonly prisma: DecisionConvergenceSnapshotPrismaClientV1,
    private readonly submitPageSnapshots: DecisionSubmitPageSnapshotReaderPortV1 | null = null,
  ) {}

  async capture(input: CaptureInputV1): Promise<DecisionConvergenceAuthoritySnapshotV1 | null> {
    const result = await this.captureInternal(input, null);
    return result as DecisionConvergenceAuthoritySnapshotV1 | null;
  }

  async captureSubmit(input: CaptureSubmitInputV1): Promise<DecisionSubmitSnapshotV1 | null> {
    if (
      !input.roomId?.trim()
      || input.roomId !== input.runId
      || !input.subjectId?.trim()
      || !input.chapterRuntimeId?.trim()
      || !input.decisionPointId?.trim()
      || !Number.isSafeInteger(input.expectedWorkingRevision)
      || input.expectedWorkingRevision < 0
      || !Number.isSafeInteger(input.expectedControlEpoch)
      || input.expectedControlEpoch < 0
      || !isSha256(input.expectedSubmissionFenceToken)
      || !this.submitPageSnapshots
    ) invalid("submit.command", "INVALID_INPUT", input.runId);
    const result = await this.captureInternal(input, input);
    return result as DecisionSubmitSnapshotV1 | null;
  }

  async loadWorkingProjection(input: Readonly<{
    runId: string;
    routeHash: string;
    chapterRuntimeId: string;
    chapterId: ChapterIdV1;
  }>): Promise<ReturnType<NonNullable<
    DecisionConvergenceSnapshotReaderPortV1["loadWorkingProjection"]
  >> extends Promise<infer TValue> ? TValue : never> {
    if (
      !input.runId?.trim()
      || !isSha256(input.routeHash)
      || !input.chapterRuntimeId?.trim()
    ) invalid("projection.command", "INVALID_INPUT", input.runId);
    return pressureFastSerializableTransaction(this.prisma, async (tx) => {
      const runtime = await tx.pressureChapterRuntime.findUnique({
        where: { id: input.chapterRuntimeId },
        select: {
          id: true,
          runId: true,
          chapterId: true,
          routeHash: true,
          workingRevision: true,
          workingStateJson: true,
          workingStateHash: true,
          ledgerProjectionJson: true,
          state: true,
        },
      });
      if (!runtime) return null;
      if (
        runtime.id !== input.chapterRuntimeId
        || runtime.runId !== input.runId
        || runtime.chapterId !== input.chapterId
        || runtime.routeHash !== input.routeHash
      ) invalid("projection.runtime", "SOURCE_BINDING_MISMATCH", input.runId);
      return decodeBoundProjection(runtime, input.runId);
    });
  }

  private async captureInternal(
    input: CaptureInputV1,
    submit: CaptureSubmitInputV1 | null,
  ): Promise<DecisionConvergenceAuthoritySnapshotV1 | DecisionSubmitSnapshotV1 | null> {
    if (
      !input.runId?.trim()
      || !isSha256(input.expectedRouteHash)
      || !isSha256(input.aiPolicyArtifactHash)
      || !Number.isSafeInteger(input.capturedAtMs)
      || input.capturedAtMs < 0
    ) invalid("snapshot.command", "INVALID_INPUT", input.runId);

    return pressureFastSerializableTransaction(this.prisma, async (tx) => {
      const routeRow = await tx.pressureRunRouteSnapshot.findUnique({
        where: { runId: input.runId },
        select: { runId: true, routeHash: true, routeJson: true },
      });
      const chapter = await readCurrentOrchestratorState(tx, input.runId);
      if (!routeRow || !chapter) return null;
      const stored = assertStoredRunRouteRecord(
        structuredClone(routeRow.routeJson) as Parameters<typeof assertStoredRunRouteRecord>[0],
      );
      const route = validateRunRouteSnapshotV1(stored.snapshot);
      if (
        routeRow.runId !== input.runId
        || routeRow.routeHash !== input.expectedRouteHash
        || stored.runId !== input.runId
        || route.runId !== input.runId
        || route.routeHash !== input.expectedRouteHash
        || chapter.runId !== input.runId
        || chapter.routeHash !== input.expectedRouteHash
      ) invalid("snapshot.route", "ROUTE_BINDING_MISMATCH", input.runId);

      const [runtime, seatRow, viewerRow, page] = await Promise.all([
        tx.pressureChapterRuntime.findUnique({
          where: { id: chapter.chapterRuntimeId },
          select: {
            id: true,
            runId: true,
            chapterId: true,
            routeHash: true,
            workingRevision: true,
            workingStateJson: true,
            workingStateHash: true,
            ledgerProjectionJson: true,
            state: true,
          },
        }),
        tx.pressureSeatControlSnapshot.findUnique({
          where: { runId: input.runId },
          select: {
            runId: true,
            stateRevision: true,
            snapshotJson: true,
            stateHash: true,
            version: true,
          },
        }),
        submit
          ? tx.storyPlayer.findUnique({
              where: { runId_userId: { runId: input.runId, userId: submit.subjectId } },
              select: {
                runId: true,
                userId: true,
                playerType: true,
                status: true,
                role: { select: { roleKey: true } },
              },
            })
          : Promise.resolve(null),
        submit
          ? this.submitPageSnapshots!.captureWithClient(tx, {
              roomId: submit.roomId,
              runId: submit.runId,
              subjectId: submit.subjectId,
              feedCursor: null,
              feedLimit: 10,
              capturedAtMs: input.capturedAtMs,
            })
          : Promise.resolve(null),
      ]);
      if (!runtime || !seatRow) return null;
      if (
        runtime.id !== chapter.chapterRuntimeId
        || runtime.runId !== input.runId
        || runtime.chapterId !== chapter.currentChapterId
        || runtime.routeHash !== input.expectedRouteHash
      ) invalid("snapshot.runtime", "W4_W5_BINDING_MISMATCH", input.runId);

      const projection = decodeBoundProjection(runtime, input.runId);

      const seatAuthority = decodeSeatEnvelope(seatRow).snapshot;
      if (
        seatAuthority.runId !== input.runId
        || seatAuthority.routeHash !== input.expectedRouteHash
        || seatAuthority.stateHash !== seatRow.stateHash
        || seatAuthority.stateRevision !== seatRow.stateRevision
      ) invalid("snapshot.seatAuthority", "ROW_BINDING_MISMATCH", input.runId);

      const authority = withDecisionConvergenceSnapshotHashV1({
        schemaVersion: "pressure_decision_convergence_authority_snapshot_v1",
        routeSnapshot: route,
        chapter,
        projection,
        seatAuthority,
        aiPolicyArtifactHash: input.aiPolicyArtifactHash,
        capturedAtMs: input.capturedAtMs,
      });
      if (!submit) return authority;

      const active = chapter.activeDecision;
      const activeSeat = active?.seats.find((seat) => seat.seatId === submit.seatId);
      const seat = seatAuthority.seatControls.find((item) => item.seatId === submit.seatId);
      if (
        !viewerRow
        || !page
        || viewerRow.runId !== submit.runId
        || viewerRow.userId !== submit.subjectId
        || viewerRow.playerType !== "human"
        || viewerRow.status !== "active"
        || viewerRow.role?.roleKey !== submit.seatId
        || chapter.phase !== "ACTIVE"
        || chapter.chapterRuntimeId !== submit.chapterRuntimeId
        || active?.decisionPointId !== submit.decisionPointId
        || activeSeat?.requirement !== "REQUIRED"
        || activeSeat.completion !== "PENDING"
        || projection.state.revision !== submit.expectedWorkingRevision
        || runtime.state !== "DECISION_POINT_OPEN" && runtime.state !== "ACTION_DRAFTING"
        || !seat
        || seat.mode !== "HUMAN_ACTIVE"
        || seat.activeControllerId !== submit.subjectId
        || seat.controlEpoch !== submit.expectedControlEpoch
        || seat.submissionFenceToken !== submit.expectedSubmissionFenceToken
      ) invalid("submit.authority", "STALE_OR_NOT_AUTHORIZED", input.runId);

      assertSubmitPageAuthorityBindingV1(page, authority, submit);

      return withDecisionSubmitSnapshotHashV1({
        schemaVersion: "pressure_submit_page_authority_snapshot_v1",
        authority,
        viewer: {
          roomId: submit.roomId,
          runId: submit.runId,
          subjectId: submit.subjectId,
          seatId: submit.seatId as SeatIdV1,
          humanControllerId: submit.subjectId,
        },
        page,
      });
    });
  }
}

function decodeBoundProjection(
  runtime: SnapshotRuntimeRowV1,
  runId: string,
) {
  const projection = decodeWorkingLedgerProjectionCacheV1(
    runtime.ledgerProjectionJson,
    {
      runId: runtime.runId,
      chapterRuntimeId: runtime.id,
      chapterId: runtime.chapterId,
      routeHash: runtime.routeHash,
      workingRevision: runtime.workingRevision,
      workingState: runtime.workingStateJson,
      workingStateHash: runtime.workingStateHash,
    },
  );
  if (
    projection.key.runId !== runId
    || projection.key.chapterRuntimeId !== runtime.id
    || projection.chapterId !== (runtime.chapterId as ChapterIdV1)
    || projection.routeHash !== runtime.routeHash
    || !isSha256(projection.headHash)
    || projection.state.revision !== runtime.workingRevision
    || projection.stateHash !== runtime.workingStateHash
    || projection.stateHash !== workingStateHash(projection.state)
  ) invalid("snapshot.working", "RUNTIME_LEDGER_MISMATCH", runId);
  return projection;
}

export function withDecisionSubmitSnapshotHashV1(
  input: Omit<DecisionSubmitSnapshotV1, "submitSnapshotHash">,
): DecisionSubmitSnapshotV1 {
  const body = structuredClone(input);
  // The authority snapshot already binds the full Working Projection through
  // snapshotHash. Hashing the whole envelope again would send its in-memory
  // Map indexes through canonical JSON, which intentionally rejects Maps.
  // Bind the outer submit envelope to that verified authority identity plus
  // the viewer authorization instead.
  return {
    ...body,
    submitSnapshotHash: sha256Canonical({
      schemaVersion: body.schemaVersion,
      authoritySnapshotHash: body.authority.snapshotHash,
      viewer: body.viewer,
      pageSnapshotHash: body.page.snapshotHash,
    }),
  };
}

export function createPrismaDecisionConvergenceSnapshotReaderV1(
  prisma: unknown,
  submitPageSnapshots: DecisionSubmitPageSnapshotReaderPortV1 | null = null,
): PrismaDecisionConvergenceSnapshotReaderV1 {
  return new PrismaDecisionConvergenceSnapshotReaderV1(
    prisma as DecisionConvergenceSnapshotPrismaClientV1,
    submitPageSnapshots,
  );
}

function assertSubmitPageAuthorityBindingV1(
  page: GameReadSnapshotV1,
  authority: DecisionConvergenceAuthoritySnapshotV1,
  submit: CaptureSubmitInputV1,
): void {
  const sources = page.sources;
  if (
    "chapterSource" in sources
    || page.request.roomId !== submit.roomId
    || page.request.runId !== submit.runId
    || page.request.subjectId !== submit.subjectId
    || page.request.feedCursor !== null
    || sources.roomId !== submit.roomId
    || sources.runId !== submit.runId
    || sources.subjectId !== submit.subjectId
    || sources.viewerSeatId !== submit.seatId
    || sources.routeSnapshot.routeHash !== authority.routeSnapshot.routeHash
    || page.capturedAtMs !== authority.capturedAtMs
    || page.authority.viewer.controlEpoch !== submit.expectedControlEpoch
    || page.authority.viewer.submissionFenceToken !== submit.expectedSubmissionFenceToken
    || page.authority.viewer.seatId !== submit.seatId
  ) invalid("submit.page", "PAGE_AUTHORITY_BINDING_MISMATCH", submit.runId);
  if ("chapterSource" in sources) return;
  if (
    sources.chapter.chapterRuntimeId !== submit.chapterRuntimeId
    || sources.chapter.activeDecision?.decisionPointId !== submit.decisionPointId
    || sources.chapter.orchestratorHash !== authority.chapter.orchestratorHash
    || sources.workingProjection.key.chapterRuntimeId !== submit.chapterRuntimeId
    || sources.workingProjection.state.revision !== submit.expectedWorkingRevision
    || sources.workingProjection.stateHash !== authority.projection.stateHash
    || sources.workingProjection.headHash !== authority.projection.headHash
    || sources.chapterDescriptor.descriptorHash !== authority.chapter.descriptorHash
  ) invalid("submit.page", "PAGE_SOURCE_BINDING_MISMATCH", submit.runId);
}

function invalid(path: string, detail: string, runId: string): never {
  return failDecisionAutomation(
    ERROR.PORT_RESULT_INVALID,
    `Decision convergence snapshot failed at ${path}`,
    { path, detail, runId },
  );
}
