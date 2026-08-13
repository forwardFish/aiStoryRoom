import { Prisma } from "@prisma/client";
import {
  chapterSequence,
  isSha256,
  validateRunRouteSnapshotV1,
  type ChapterIdV1,
} from "@ai-story/shared";
import { readCurrentOrchestratorState } from "../persistence/orchestrator-state.prisma-adapter";
import { assertStoredRunRouteRecord } from "../run-router";
import { decodeSeatEnvelope } from "../seat-control-persistence/envelope";
import type { WorkingLedgerEventV1 } from "../working-ledger/contracts";
import { projectWorkingLedger, workingStateHash } from "../working-ledger/working-ledger";
import {
  DECISION_AUTOMATION_ERROR_CODES as ERROR,
  failDecisionAutomation,
} from "./errors";
import type {
  DecisionConvergenceAuthoritySnapshotV1,
  DecisionConvergenceSnapshotReaderPortV1,
} from "./contracts";
import { withDecisionConvergenceSnapshotHashV1 } from "./convergence.service";

const LEDGER_EVENT_TYPE = "PRESSURE_WORKING_LEDGER_EVENT";

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
  workingStateHash: string;
}

interface SnapshotSeatRowV1 {
  runId: string;
  stateRevision: number;
  snapshotJson: unknown;
  stateHash: string;
  version: number;
}

interface SnapshotEventRowV1 {
  id: string;
  runId: string;
  type: string;
  payloadJson: unknown;
  dedupeKey: string | null;
}

interface DecisionConvergenceSnapshotTransactionV1 {
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
    findMany(input: Record<string, unknown>): Promise<SnapshotEventRowV1[]>;
  };
}

export interface DecisionConvergenceSnapshotPrismaClientV1 {
  $transaction<TResult>(
    operation: (tx: DecisionConvergenceSnapshotTransactionV1) => Promise<TResult>,
    options: typeof FAST_TRANSACTION_OPTIONS,
  ): Promise<TResult>;
}

const FAST_TRANSACTION_OPTIONS = Object.freeze({
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 500,
  timeout: 2_000,
});

function pressureFastSerializableTransaction<TResult>(
  prisma: DecisionConvergenceSnapshotPrismaClientV1,
  operation: (tx: DecisionConvergenceSnapshotTransactionV1) => Promise<TResult>,
): Promise<TResult> {
  return prisma.$transaction(operation, FAST_TRANSACTION_OPTIONS);
}

/**
 * Captures route, W4, W5 and SeatControl in one short Serializable snapshot.
 * Published content and policy execution remain outside this transaction.
 */
export class PrismaDecisionConvergenceSnapshotReaderV1
implements DecisionConvergenceSnapshotReaderPortV1 {
  constructor(
    private readonly prisma: DecisionConvergenceSnapshotPrismaClientV1,
  ) {}

  async capture(
    input: Parameters<DecisionConvergenceSnapshotReaderPortV1["capture"]>[0],
  ): Promise<DecisionConvergenceAuthoritySnapshotV1 | null> {
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

      const [runtime, seatRow, ledgerRows] = await Promise.all([
        tx.pressureChapterRuntime.findUnique({
          where: { id: chapter.chapterRuntimeId },
          select: {
            id: true,
            runId: true,
            chapterId: true,
            routeHash: true,
            workingRevision: true,
            workingStateHash: true,
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
        tx.storyEvent.findMany({
          where: {
            runId: input.runId,
            type: LEDGER_EVENT_TYPE,
            day: chapterSequence(chapter.currentChapterId),
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            runId: true,
            type: true,
            payloadJson: true,
            dedupeKey: true,
          },
        }),
      ]);
      if (!runtime || !seatRow) return null;
      if (
        runtime.id !== chapter.chapterRuntimeId
        || runtime.runId !== input.runId
        || runtime.chapterId !== chapter.currentChapterId
        || runtime.routeHash !== input.expectedRouteHash
      ) invalid("snapshot.runtime", "W4_W5_BINDING_MISMATCH", input.runId);

      const ledgerEvents = ledgerRows
        .filter((row) => row.runId === input.runId && row.type === LEDGER_EVENT_TYPE)
        .map((row) => {
          const event = structuredClone(row.payloadJson) as WorkingLedgerEventV1;
          if (
            event.schemaVersion !== "pressure_working_ledger_event_v1"
            || row.dedupeKey !== ledgerDedupeKey(event)
          ) invalid("snapshot.ledgerRow", "ROW_BINDING_MISMATCH", input.runId);
          return event;
        })
        .filter((event) => event.chapterRuntimeId === runtime.id)
        .sort((left, right) => left.sequence - right.sequence);
      if (!ledgerEvents.length) return null;
      const projection = projectWorkingLedger(ledgerEvents);
      if (
        projection.key.runId !== input.runId
        || projection.key.chapterRuntimeId !== runtime.id
        || projection.chapterId !== (runtime.chapterId as ChapterIdV1)
        || projection.routeHash !== runtime.routeHash
        || !isSha256(projection.headHash)
        || projection.state.revision !== runtime.workingRevision
        || projection.stateHash !== runtime.workingStateHash
        || projection.stateHash !== workingStateHash(projection.state)
      ) invalid("snapshot.working", "RUNTIME_LEDGER_MISMATCH", input.runId);

      const seatAuthority = decodeSeatEnvelope(seatRow).snapshot;
      if (
        seatAuthority.runId !== input.runId
        || seatAuthority.routeHash !== input.expectedRouteHash
        || seatAuthority.stateHash !== seatRow.stateHash
        || seatAuthority.stateRevision !== seatRow.stateRevision
      ) invalid("snapshot.seatAuthority", "ROW_BINDING_MISMATCH", input.runId);

      return withDecisionConvergenceSnapshotHashV1({
        schemaVersion: "pressure_decision_convergence_authority_snapshot_v1",
        routeSnapshot: route,
        chapter,
        projection,
        seatAuthority,
        aiPolicyArtifactHash: input.aiPolicyArtifactHash,
        capturedAtMs: input.capturedAtMs,
      });
    });
  }
}

export function createPrismaDecisionConvergenceSnapshotReaderV1(
  prisma: unknown,
): PrismaDecisionConvergenceSnapshotReaderV1 {
  return new PrismaDecisionConvergenceSnapshotReaderV1(
    prisma as DecisionConvergenceSnapshotPrismaClientV1,
  );
}

function ledgerDedupeKey(event: WorkingLedgerEventV1): string {
  return `pressure-ledger:${event.runId}:${event.chapterRuntimeId}:${event.eventHash}`;
}

function invalid(path: string, detail: string, runId: string): never {
  return failDecisionAutomation(
    ERROR.PORT_RESULT_INVALID,
    `Decision convergence snapshot failed at ${path}`,
    { path, detail, runId },
  );
}
