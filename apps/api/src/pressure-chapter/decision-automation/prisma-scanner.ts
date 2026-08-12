import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  isSha256,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import { PRESSURE_ORCHESTRATOR_STATE_EVENT_TYPE } from "../persistence/orchestrator-state.prisma-adapter";
import { assertStoredRunRouteRecord } from "../run-router";
import type { SeatControlSnapshotV1 } from "../seat-control/types";
import { decodeSeatEnvelope } from "../seat-control-persistence/envelope";
import { validateOrchestratorStateV1 } from "../orchestrator/validation";
import {
  DECISION_AUTOMATION_ERROR_CODES as ERROR,
  failDecisionAutomation,
} from "./errors";
import type {
  ActivePressureDecisionScannerPortV1,
  DecisionAutomationTaskV1,
} from "./contracts";
import { withDecisionAutomationTaskHashV1 } from "./service";

interface ScannerRuntimeRowV1 {
  id: string;
  runId: string;
  chapterId: string;
  chapterSequence: number;
  routeHash: string;
  state: string;
  workingRevision: number;
  decisionStateJson: unknown;
}

interface ScannerRouteRowV1 {
  runId: string;
  routeHash: string;
  routeJson: unknown;
}

interface ScannerEventRowV1 {
  runId: string;
  type: string;
  payloadJson: unknown;
}

interface ScannerSeatSnapshotRowV1 {
  runId: string;
  stateRevision: number;
  stateHash: string;
  snapshotJson: unknown;
  version?: number;
}

export interface DecisionAutomationScannerPrismaClientV1 {
  pressureChapterRuntime: {
    findMany(input: Record<string, unknown>): Promise<ScannerRuntimeRowV1[]>;
  };
  pressureRunRouteSnapshot: {
    findUnique(input: Record<string, unknown>): Promise<ScannerRouteRowV1 | null>;
  };
  storyEvent: {
    findMany(input: Record<string, unknown>): Promise<ScannerEventRowV1[]>;
  };
  pressureSeatControlSnapshot: {
    findFirst(input: Record<string, unknown>): Promise<ScannerSeatSnapshotRowV1 | null>;
  };
}

/**
 * Production read-only scanner. It has no transaction/write delegate and does
 * not add a second task table. The selected facts are re-read by the runner
 * before execution; this scan is discovery, never authority by itself.
 */
export class PrismaActivePressureDecisionScannerV1
implements ActivePressureDecisionScannerPortV1 {
  constructor(
    private readonly prisma: DecisionAutomationScannerPrismaClientV1,
  ) {}

  async scanActive(): Promise<DecisionAutomationTaskV1[]> {
    const runtimes = await this.prisma.pressureChapterRuntime.findMany({
      where: {
        state: { in: ["CHAPTER_ACTIVE", "DECISION_POINT_OPEN"] },
      },
      select: {
        id: true,
        runId: true,
        chapterId: true,
        chapterSequence: true,
        routeHash: true,
        state: true,
        workingRevision: true,
        decisionStateJson: true,
      },
      orderBy: [
        { runId: "asc" },
        { chapterSequence: "asc" },
        { id: "asc" },
      ],
    });
    const tasks: DecisionAutomationTaskV1[] = [];
    for (const runtime of [...runtimes].sort(compareRuntimes)) {
      tasks.push(...await this.scanRuntime(runtime));
    }
    return tasks.sort(compareTasks);
  }

  private async scanRuntime(
    runtime: ScannerRuntimeRowV1,
  ): Promise<DecisionAutomationTaskV1[]> {
    assertRuntime(runtime);
    const [routeRow, eventRows, seatRow] = await Promise.all([
      this.prisma.pressureRunRouteSnapshot.findUnique({
        where: { runId: runtime.runId },
        select: { runId: true, routeHash: true, routeJson: true },
      }),
      this.prisma.storyEvent.findMany({
        where: {
          runId: runtime.runId,
          type: PRESSURE_ORCHESTRATOR_STATE_EVENT_TYPE,
        },
        select: { runId: true, type: true, payloadJson: true },
      }),
      this.prisma.pressureSeatControlSnapshot.findFirst({
        where: { runId: runtime.runId },
        orderBy: [{ stateRevision: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        select: {
          runId: true,
          stateRevision: true,
          stateHash: true,
          snapshotJson: true,
          version: true,
        },
      }),
    ]);
    if (!routeRow || !seatRow || eventRows.length === 0) {
      invalid("scanner.authority", "ACTIVE_RUNTIME_DEPENDENCY_MISSING", runtime);
    }
    const stored = assertStoredRunRouteRecord(
      structuredClone(routeRow.routeJson) as Parameters<typeof assertStoredRunRouteRecord>[0],
    );
    if (
      stored.runId !== runtime.runId
      || stored.snapshot.routeHash !== runtime.routeHash
      || routeRow.runId !== runtime.runId
      || routeRow.routeHash !== runtime.routeHash
    ) {
      invalid("scanner.route", "RUNTIME_ROUTE_MISMATCH", runtime);
    }
    const states = eventRows.map((row) => {
      if (row.runId !== runtime.runId || row.type !== PRESSURE_ORCHESTRATOR_STATE_EVENT_TYPE) {
        invalid("scanner.orchestratorEvent", "ROW_BINDING_MISMATCH", runtime);
      }
      return validateOrchestratorStateV1(
        structuredClone(row.payloadJson) as Parameters<typeof validateOrchestratorStateV1>[0],
      );
    }).sort((left, right) => left.revision - right.revision);
    for (let index = 0; index < states.length; index += 1) {
      if (states[index]!.revision !== index) {
        invalid("scanner.orchestrator", "REVISION_HISTORY_NOT_CONTIGUOUS", runtime);
      }
    }
    const state = states.at(-1)!;
    if (state.phase !== "ACTIVE") return [];
    if (
      state.runId !== runtime.runId
      || state.routeHash !== runtime.routeHash
      || state.chapterRuntimeId !== runtime.id
      || state.currentChapterId !== runtime.chapterId
      || !state.activeDecision
    ) {
      invalid("scanner.orchestrator", "ACTIVE_RUNTIME_MISMATCH", runtime);
    }
    const embeddedDecision = assertEmbeddedDecision(runtime);
    if (
      embeddedDecision.activeDecisionPointId !== state.activeDecision.decisionPointId
      || embeddedDecision.workingRevision !== runtime.workingRevision
    ) {
      invalid("scanner.decision", "EXACT_ACTIVE_OPEN_DECISION_REQUIRED", runtime);
    }
    const snapshot = assertScannerSeatSnapshot(seatRow, runtime);
    const tasks: DecisionAutomationTaskV1[] = [];
    for (const activeSeat of state.activeDecision.seats) {
      if (
        activeSeat.requirement !== "REQUIRED"
        || activeSeat.completion !== "PENDING"
        || activeSeat.actionCount !== 0
        || activeSeat.actionIds.length !== 0
      ) continue;
      const authority = snapshot.seatControls.find(
        (seat) => seat.seatId === activeSeat.seatId,
      );
      if (!authority) invalid("scanner.seatAuthority", "SEAT_MISSING", runtime);
      if (
        authority.mode === "AI_ACTIVE"
        && authority.activeControllerId !== authority.designatedAiControllerId
      ) {
        invalid("scanner.seatAuthority", "AI_CONTROLLER_MISMATCH", runtime);
      }
      tasks.push(withDecisionAutomationTaskHashV1({
        schemaVersion: "pressure_decision_automation_task_v1",
        runId: runtime.runId,
        routeHash: runtime.routeHash,
        chapterRuntimeId: runtime.id,
        chapterId: state.currentChapterId,
        decisionPointId: state.activeDecision.decisionPointId,
        seatId: activeSeat.seatId,
        expectedOrchestratorRevision: state.revision,
        expectedWorkingRevision: runtime.workingRevision,
        expectedControlEpoch: authority.controlEpoch,
        expectedControllerMode: authority.mode,
        expectedDeadlineAtMs: state.activeDecision.deadlineAtMs,
        expectedSeatAuthorityStateHash: snapshot.stateHash,
      }));
    }
    return tasks.sort(compareTasks);
  }
}

function assertEmbeddedDecision(runtime: ScannerRuntimeRowV1): {
  activeDecisionPointId: string;
  workingRevision: number;
} {
  if (!runtime.decisionStateJson || typeof runtime.decisionStateJson !== "object") {
    invalid("scanner.decisionStateJson", "OBJECT_REQUIRED", runtime);
  }
  const decision = runtime.decisionStateJson as Record<string, unknown>;
  if (
    decision.schemaVersion !== "pressure_mvp_decision_state_v1"
    || decision.state !== "OPEN"
    || typeof decision.activeDecisionPointId !== "string"
    || !decision.activeDecisionPointId.trim()
    || !Number.isSafeInteger(decision.workingRevision)
    || (decision.workingRevision as number) < 0
  ) invalid("scanner.decisionStateJson", "ACTIVE_DECISION_INVALID", runtime);
  return {
    activeDecisionPointId: decision.activeDecisionPointId as string,
    workingRevision: decision.workingRevision as number,
  };
}

/** Isolates the cast required by Prisma's generated generic client surface. */
export function createPrismaActivePressureDecisionScannerV1(
  prisma: unknown,
): PrismaActivePressureDecisionScannerV1 {
  return new PrismaActivePressureDecisionScannerV1(
    prisma as DecisionAutomationScannerPrismaClientV1,
  );
}

function assertRuntime(runtime: ScannerRuntimeRowV1): void {
  if (
    !runtime?.id?.trim()
    || !runtime.runId?.trim()
    || !runtime.chapterId?.trim()
    || !isSha256(runtime.routeHash)
    || !Number.isSafeInteger(runtime.chapterSequence)
    || runtime.chapterSequence < 1
    || !Number.isSafeInteger(runtime.workingRevision)
    || runtime.workingRevision < 0
    || (runtime.state !== "CHAPTER_ACTIVE" && runtime.state !== "DECISION_POINT_OPEN")
  ) invalid("scanner.runtime", "INVALID_ACTIVE_RUNTIME", runtime);
}

function assertScannerSeatSnapshot(
  row: ScannerSeatSnapshotRowV1,
  runtime: ScannerRuntimeRowV1,
): SeatControlSnapshotV1 {
  const snapshot = decodeSeatEnvelope({
    ...row,
    version: row.version ?? 1,
  }).snapshot;
  if (
    row.runId !== runtime.runId
    || snapshot?.schemaVersion !== "pressure_seat_control_snapshot_v1"
    || snapshot.runId !== runtime.runId
    || snapshot.routeHash !== runtime.routeHash
    || snapshot.stateRevision !== row.stateRevision
    || snapshot.stateHash !== row.stateHash
    || !isSha256(snapshot.stateHash)
    || snapshot.seatControls.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length
  ) invalid("scanner.seatSnapshot", "ROW_BINDING_MISMATCH", runtime);
  const { stateHash, ...body } = snapshot;
  if (sha256Canonical(body) !== stateHash) {
    invalid("scanner.seatSnapshot", "SELF_HASH_MISMATCH", runtime);
  }
  const ordered = snapshot.seatControls.map((seat) => seat.seatId);
  if (ordered.some((seatId, index) => seatId !== PRESSURE_CHAPTER_SEAT_IDS_V1[index])) {
    invalid("scanner.seatSnapshot", "EXACT_SIX_SEAT_ORDER_REQUIRED", runtime);
  }
  return snapshot;
}

function compareRuntimes(left: ScannerRuntimeRowV1, right: ScannerRuntimeRowV1): number {
  return compareCanonicalText(left.runId, right.runId)
    || left.chapterSequence - right.chapterSequence
    || compareCanonicalText(left.id, right.id);
}

function compareTasks(left: DecisionAutomationTaskV1, right: DecisionAutomationTaskV1): number {
  return Number(left.expectedControllerMode === "HUMAN_ACTIVE")
    - Number(right.expectedControllerMode === "HUMAN_ACTIVE")
    || deadlineSortValue(left.expectedDeadlineAtMs)
      - deadlineSortValue(right.expectedDeadlineAtMs)
    || compareCanonicalText(left.runId, right.runId)
    || Number(left.chapterId.slice(1)) - Number(right.chapterId.slice(1))
    || compareCanonicalText(left.decisionPointId, right.decisionPointId)
    || compareCanonicalText(left.seatId, right.seatId);
}

function deadlineSortValue(deadlineAtMs: number | null): number {
  return deadlineAtMs ?? Number.MAX_SAFE_INTEGER;
}

function invalid(
  path: string,
  detail: string,
  runtime: Partial<ScannerRuntimeRowV1>,
): never {
  return failDecisionAutomation(
    ERROR.PORT_RESULT_INVALID,
    `Prisma decision automation scanner failed at ${path}`,
    { path, detail, runId: runtime.runId, chapterRuntimeId: runtime.id },
  );
}
