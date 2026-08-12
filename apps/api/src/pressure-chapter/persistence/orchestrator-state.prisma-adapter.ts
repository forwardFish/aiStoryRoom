import { Prisma } from "@prisma/client";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  chapterSequence,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import type {
  ChapterOrchestratorStatePort,
  ChapterOrchestratorStateV1,
} from "../orchestrator/contracts";
import { validateOrchestratorStateV1 } from "../orchestrator/validation";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "./errors";
import {
  isUniqueConflict,
  pressureSerializableTransaction,
  type PressureSerializableClient,
} from "./transaction";
import {
  buildPressureMvpDecisionStateV1,
  decodePressureMvpDecisionStateV1,
  type PressureMvpDecisionStateV1,
} from "./mvp-decision-state";

export const PRESSURE_ORCHESTRATOR_STATE_EVENT_TYPE =
  "PRESSURE_CHAPTER_ORCHESTRATOR_STATE";

interface OrchestratorEventRow {
  id: string;
  runId: string;
  type: string;
  payloadJson: unknown;
  dedupeKey: string | null;
}

interface OrchestratorRuntimeRow {
  id: string;
  runId: string;
  state: string;
  workingRevision: number;
  decisionStateJson: unknown;
  lockVersion: number;
}

interface OrchestratorStateTransaction {
  storyEvent: {
    findMany(input: Record<string, unknown>): Promise<OrchestratorEventRow[]>;
    create(input: { data: Record<string, unknown> }): Promise<OrchestratorEventRow>;
  };
  pressureChapterRuntime: {
    findUnique(input: Record<string, unknown>): Promise<OrchestratorRuntimeRow | null>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
}

export type OrchestratorStatePrismaClient =
  PressureSerializableClient<OrchestratorStateTransaction>;

/**
 * Durable W4 state. Every revision is append-only, while the chapter runtime
 * lifecycle transition is fenced in the same Serializable transaction.
 */
export class PrismaChapterOrchestratorStateRepository
implements ChapterOrchestratorStatePort {
  constructor(private readonly prisma: OrchestratorStatePrismaClient) {}

  async read(runId: string): Promise<ChapterOrchestratorStateV1 | null> {
    requireText(runId, "runId");
    return pressureSerializableTransaction(this.prisma, async (tx) =>
      readCurrentOrchestratorState(tx, runId));
  }

  async compareAndSwap(input: {
    runId: string;
    expectedRevision: number | null;
    next: ChapterOrchestratorStateV1;
  }): Promise<{
    status: "COMMITTED" | "CONFLICT";
    current: ChapterOrchestratorStateV1 | null;
  }> {
    requireText(input.runId, "runId");
    const next = validateOrchestratorStateV1(input.next);
    if (next.runId !== input.runId) {
      throw invalid("Orchestrator state is bound to a different Run");
    }
    try {
      return await pressureSerializableTransaction(this.prisma, async (tx) => {
        const current = await readCurrentOrchestratorState(tx, input.runId);
        if ((current?.revision ?? null) !== input.expectedRevision) {
          return { status: "CONFLICT" as const, current };
        }
        assertNextRevision(current, next);
        const runtime = await tx.pressureChapterRuntime.findUnique({
          where: { id: next.chapterRuntimeId },
          select: {
            id: true,
            runId: true,
            state: true,
            workingRevision: true,
            decisionStateJson: true,
            lockVersion: true,
          },
        });
        if (!runtime || runtime.runId !== next.runId) {
          throw missing("Chapter runtime", {
            runId: next.runId,
            chapterRuntimeId: next.chapterRuntimeId,
          });
        }
        await fenceRuntimeLifecycle(tx, runtime, next);
        const row = await tx.storyEvent.create({
          data: {
            id: orchestratorEventId(next),
            runId: next.runId,
            day: chapterSequence(next.currentChapterId),
            type: PRESSURE_ORCHESTRATOR_STATE_EVENT_TYPE,
            messageType: "system",
            visibility: "system",
            payloadJson: json(next),
            sequence: null,
            dedupeKey: orchestratorDedupeKey(next.runId, next.revision),
          },
        });
        const committed = decodeOrchestratorEvent(row);
        if (committed.orchestratorHash !== next.orchestratorHash) {
          throw invalid("Committed orchestrator state changed during persistence");
        }
        return { status: "COMMITTED" as const, current: committed };
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const current = await this.read(input.runId);
      return { status: "CONFLICT", current };
    }
  }
}

export async function readCurrentOrchestratorState(
  tx: Pick<OrchestratorStateTransaction, "storyEvent">,
  runId: string,
): Promise<ChapterOrchestratorStateV1 | null> {
  const rows = await tx.storyEvent.findMany({
    where: { runId, type: PRESSURE_ORCHESTRATOR_STATE_EVENT_TYPE },
    select: {
      id: true,
      runId: true,
      type: true,
      payloadJson: true,
      dedupeKey: true,
    },
  });
  if (!rows.length) return null;
  const states = rows.map(decodeOrchestratorEvent)
    .sort((left, right) => left.revision - right.revision);
  for (let index = 0; index < states.length; index += 1) {
    if (states[index]!.revision !== index) {
      throw invalid("Orchestrator revision history is not contiguous", {
        runId,
        observedRevision: states[index]!.revision,
        expectedRevision: index,
      });
    }
  }
  return structuredClone(states.at(-1)!);
}

function decodeOrchestratorEvent(row: OrchestratorEventRow): ChapterOrchestratorStateV1 {
  try {
    const state = validateOrchestratorStateV1(
      structuredClone(row.payloadJson) as ChapterOrchestratorStateV1,
    );
    if (
      row.type !== PRESSURE_ORCHESTRATOR_STATE_EVENT_TYPE
      || row.runId !== state.runId
      || row.dedupeKey !== orchestratorDedupeKey(state.runId, state.revision)
    ) throw new Error("ROW_BINDING_MISMATCH");
    return state;
  } catch (cause) {
    throw invalid("Stored orchestrator state event is invalid", {
      eventId: row.id,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function assertNextRevision(
  current: ChapterOrchestratorStateV1 | null,
  next: ChapterOrchestratorStateV1,
): void {
  const expected = current ? current.revision + 1 : 0;
  if (next.revision !== expected) {
    throw new PressurePersistenceError(
      ERROR.WORKING_REVISION_MISMATCH,
      "Orchestrator revision must advance exactly once",
      { expectedRevision: expected, receivedRevision: next.revision },
    );
  }
  if (!current) return;
  if (next.routeHash !== current.routeHash) {
    throw new PressurePersistenceError(
      ERROR.FINGERPRINT_MISMATCH,
      "Orchestrator routeHash is immutable",
      { runId: next.runId },
    );
  }
  const currentSequence = chapterSequence(current.currentChapterId);
  const nextSequence = chapterSequence(next.currentChapterId);
  if (
    nextSequence !== currentSequence
    && !(
      current.phase === "FROZEN"
      && nextSequence === currentSequence + 1
      && next.authorityBase.previousFrozenHash === current.frozenBundleHash
    )
  ) {
    throw new PressurePersistenceError(
      ERROR.INVALID_SEQUENCE_ADVANCE,
      "Orchestrator chapter transition is invalid",
      { currentChapterId: current.currentChapterId, nextChapterId: next.currentChapterId },
    );
  }
  if (
    nextSequence === currentSequence
    && next.chapterRuntimeId !== current.chapterRuntimeId
  ) {
    throw invalid("A chapter cannot replace its runtime identity");
  }
}

async function fenceRuntimeLifecycle(
  tx: Pick<OrchestratorStateTransaction, "pressureChapterRuntime">,
  runtime: OrchestratorRuntimeRow,
  next: ChapterOrchestratorStateV1,
): Promise<void> {
  const target = runtimeTargetState(next);
  const decisionStateJson = mergeRequiredSeatAuthority(runtime, next);
  if (!target) {
    if (
      (next.phase === "FROZEN" || next.phase === "FINALE_REQUESTED")
      && runtime.state !== "CHAPTER_FROZEN"
    ) throw fence("Frozen orchestrator state lacks a Frozen chapter runtime", {
      runId: next.runId,
      chapterRuntimeId: next.chapterRuntimeId,
      phase: next.phase,
    });
  } else if (!target.allowedFrom.includes(runtime.state)) {
    throw fence("Chapter runtime lifecycle cannot follow orchestrator CAS", {
      ...next,
      runtimeState: runtime.state,
    });
  }
  const updated = await tx.pressureChapterRuntime.updateMany({
    where: {
      id: runtime.id,
      runId: runtime.runId,
      state: runtime.state,
      lockVersion: runtime.lockVersion,
    },
    data: {
      ...(target && runtime.state !== target.state ? { state: target.state } : {}),
      decisionStateJson: json(decisionStateJson),
      lockVersion: { increment: 1 },
      ...(target?.state === "CHAPTER_SETTLING" && runtime.state !== target.state
        ? { closingAt: new Date() }
        : {}),
    },
  });
  if (updated.count !== 1) throw fence("Chapter runtime lifecycle CAS was lost", {
    runId: next.runId,
    chapterRuntimeId: next.chapterRuntimeId,
    phase: next.phase,
  });
}

/**
 * Working Ledger owns the decision pin, allowed options and working revision.
 * The orchestrator owns only the required-seat enrichment. The row lockVersion
 * fence makes the read/merge/write atomic with the orchestrator revision event.
 */
function mergeRequiredSeatAuthority(
  runtime: OrchestratorRuntimeRow,
  next: ChapterOrchestratorStateV1,
): PressureMvpDecisionStateV1 {
  const stored = decodePressureMvpDecisionStateV1(runtime.decisionStateJson);
  if (stored.workingRevision !== runtime.workingRevision) {
    throw invalid("Working Ledger decision revision does not match its runtime", {
      runId: next.runId,
      storedWorkingRevision: stored.workingRevision,
      runtimeWorkingRevision: runtime.workingRevision,
    });
  }
  const active = next.activeDecision;
  const expectsActive = next.phase === "ACTIVE" || next.phase === "RESOLVING_BEAT";
  if (expectsActive !== Boolean(active)) {
    throw invalid("Orchestrator phase and active decision disagree", {
      runId: next.runId,
      phase: next.phase,
    });
  }
  if (!active) {
    if (stored.state !== "NONE" || stored.activeDecisionPointId !== null) {
      throw invalid("Working Ledger decision state is not closed", {
        runId: next.runId,
        phase: next.phase,
      });
    }
    return buildPressureMvpDecisionStateV1({
      workingRevision: stored.workingRevision,
      pin: null,
    });
  }
  if (
    typeof active.decisionPointId !== "string"
    || !active.decisionPointId.trim()
    || !Array.isArray(active.seats)
    || !isHash(active.policyHash)
  ) throw invalid("Orchestrator active decision is invalid", { runId: next.runId });
  if (
    stored.state !== "OPEN"
    || stored.activeDecisionPointId !== active.decisionPointId
    || !stored.pin
    || stored.pin.stateRevision !== stored.workingRevision
  ) {
    throw invalid("Working Ledger and orchestrator decision pins disagree", {
      runId: next.runId,
      storedDecisionPointId: stored.activeDecisionPointId,
      orchestratorDecisionPointId: active.decisionPointId,
    });
  }
  const requirements = new Map<SeatIdV1, "REQUIRED" | "NOT_REQUIRED">();
  for (const seat of active.seats) {
    if (
      !seat
      || typeof seat !== "object"
      || !isSeatId(seat.seatId)
      || (seat.requirement !== "REQUIRED" && seat.requirement !== "NOT_REQUIRED")
      || requirements.has(seat.seatId)
    ) {
      throw invalid("Orchestrator active-decision seats are invalid", {
        runId: next.runId,
        decisionPointId: active.decisionPointId,
      });
    }
    requirements.set(seat.seatId, seat.requirement);
  }
  if (requirements.size !== PRESSURE_CHAPTER_SEAT_IDS_V1.length) {
    throw invalid("Orchestrator active-decision seat authority is incomplete", {
      runId: next.runId,
      decisionPointId: active.decisionPointId,
    });
  }
  const requiredSeatIds = PRESSURE_CHAPTER_SEAT_IDS_V1
    .filter((seatId) => requirements.get(seatId) === "REQUIRED");
  if (!requiredSeatIds.length) {
    throw invalid("Orchestrator active decision has no required seats", {
      runId: next.runId,
      decisionPointId: active.decisionPointId,
    });
  }
  return buildPressureMvpDecisionStateV1({
    workingRevision: stored.workingRevision,
    pin: stored.pin,
    requiredSeatIds,
    policyHash: active.policyHash,
    orchestratorHash: next.orchestratorHash,
  });
}

function isSeatId(value: unknown): value is SeatIdV1 {
  return typeof value === "string"
    && PRESSURE_CHAPTER_SEAT_IDS_V1.includes(value as SeatIdV1);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function runtimeTargetState(
  next: ChapterOrchestratorStateV1,
): { state: string; allowedFrom: string[] } | null {
  if (next.phase === "RESOLVING_BEAT") {
    return {
      state: "BEAT_RESOLVING",
      allowedFrom: ["CHAPTER_ACTIVE", "DECISION_POINT_OPEN", "ACTIONS_SEALED", "BEAT_RESOLVING"],
    };
  }
  if (next.phase === "SETTLING") {
    return {
      state: "CHAPTER_SETTLING",
      allowedFrom: ["BEAT_RESOLVED", "CHAPTER_CLOSING", "CHAPTER_SETTLING"],
    };
  }
  if (next.phase === "ACTIVE") {
    return {
      state: "DECISION_POINT_OPEN",
      allowedFrom: ["CHAPTER_ACTIVE", "DECISION_POINT_OPEN", "BEAT_RESOLVED"],
    };
  }
  return null;
}

function orchestratorDedupeKey(runId: string, revision: number): string {
  return `pressure-orchestrator:${runId}:${revision}`;
}

function orchestratorEventId(state: ChapterOrchestratorStateV1): string {
  return `pc_orch_${sha256Canonical({
    runId: state.runId,
    revision: state.revision,
    stateHash: state.orchestratorHash,
  }).slice(0, 32)}`;
}

function requireText(value: string, field: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw invalid(`${field} must be a non-empty string`);
  }
}

function missing(label: string, details: Record<string, unknown>): PressurePersistenceError {
  return new PressurePersistenceError(
    ERROR.RECORD_NOT_FOUND,
    `${label} was not found`,
    details,
  );
}

function fence(
  message: string,
  details: Record<string, unknown>,
): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.AUTHORITY_FENCE_MISMATCH, message, details);
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
