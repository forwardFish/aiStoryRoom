import type {
  ReplayCreationReceiptV1,
  RunRouteSnapshotV1,
  SangtianPressureResultEnvelopeV1,
  SeatIdV1,
} from "@ai-story/shared";
import type {
  CommittedGenesisV1,
  InitializeGenesisCommandV1,
  InitializeGenesisResultV1,
} from "../genesis/types";
import type {
  ChapterOrchestratorStateV1,
  StartChapterRunCommandV1,
  SubmitOrchestratedActionCommandV1,
} from "../orchestrator/contracts";
import type {
  FinalizeN7PressureRunCommandV1,
} from "../finale/finale-application.service";
import type { FinalizePressureRunResultV1 } from "../terminal-commit/types";
import type { NarrativeOutboxConsumeResultV1 } from "../narrative/ports";
import type { PressureResultQueryV1 } from "../result/result-query.service";

/** W2 authority. The implementation is PressureChapterGenesisService. */
export interface RuntimeGenesisPortV1 {
  initialize(
    command: InitializeGenesisCommandV1,
  ): Promise<InitializeGenesisResultV1>;
}

/**
 * The only capability allowed to open N1. Its implementation must claim the
 * exact durable Genesis OPEN_CHAPTER row, invoke this idempotent start, and
 * acknowledge the same row. The runtime facade never receives this capability.
 */
export interface RuntimeChapterHandoffStartPortV1 {
  start(command: StartChapterRunCommandV1): Promise<ChapterOrchestratorStateV1>;
}

/**
 * W4 authority after N1 has been opened through the durable Genesis handoff.
 * Its concrete construction owns the only W5 interaction/ledger and W6
 * settlement adapters; the runtime facade deliberately cannot open N1 through
 * this port.
 */
export interface RuntimeChapterOrchestratorPortV1 {
  resume(
    routeSnapshot: RunRouteSnapshotV1,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1>;
  submitAction(
    command: SubmitOrchestratedActionCommandV1,
  ): Promise<ChapterOrchestratorStateV1>;
  advanceDeadline(
    routeSnapshot: RunRouteSnapshotV1,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1>;
  applyAiFailure(
    routeSnapshot: RunRouteSnapshotV1,
    seatId: SeatIdV1,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1>;
}

/** W8 authority-first terminal application service. */
export interface RuntimeFinalePortV1 {
  finalize(
    command: Readonly<FinalizeN7PressureRunCommandV1>,
  ): Promise<FinalizePressureRunResultV1>;
}

/** W9 post-commit OpenNovel narrative outbox consumer. */
export interface RuntimeNarrativePortV1 {
  consumeNext(workerId: string): Promise<NarrativeOutboxConsumeResultV1>;
}

/** W10 read-side query. It has no authority writer in its surface. */
export interface RuntimeResultQueryPortV1 {
  getResult(
    query: Readonly<PressureResultQueryV1>,
  ): Promise<SangtianPressureResultEnvelopeV1>;
}

/** W10 replay command. Its implementation can create only a new target. */
export interface RuntimeReplayCommandPortV1 {
  execute(viewerId: string, command: unknown): Promise<ReplayCreationReceiptV1>;
}

/** Immutable evidence identifying the N1 handoff persisted with Genesis. */
export interface PersistedGenesisN1HandoffV1 {
  schemaVersion: "pressure_genesis_n1_handoff_v1";
  taskType: "OPEN_CHAPTER";
  checkpoint: "PERSISTED";
  sourceAuthority: "GENESIS_FROZEN";
  runId: string;
  chapterId: "N1";
  genesisHash: string;
  sourceCommitHash: string;
  outboxDedupeKey: string;
}

export interface OpenPressureN1FromGenesisHandoffCommandV1 {
  routeSnapshot: RunRouteSnapshotV1;
  genesis: CommittedGenesisV1;
  handoff: PersistedGenesisN1HandoffV1;
  idempotencyKey: string;
  requestFingerprint: string;
  nowMs: number;
}

export interface OpenPressureN1FromGenesisHandoffResultV1 {
  status: "OPENED" | "REPLAYED";
  sourceTaskType: "OPEN_CHAPTER";
  sourceAuthority: "GENESIS_FROZEN";
  sourceDedupeKey: string;
  sourceCommitHash: string;
  outboxStatus: "ACKNOWLEDGED";
  chapter: ChapterOrchestratorStateV1;
}

/**
 * Durable transport boundary for Genesis -> N1. Implementations must claim by
 * the exact sourceDedupeKey, make `start` idempotent, and acknowledge only
 * after N1 is durably observable. A lease retry after start-before-ack must
 * replay the existing N1 and acknowledge the original row.
 */
export interface RuntimeGenesisN1HandoffPortV1 {
  openFromGenesisHandoff(
    command: Readonly<OpenPressureN1FromGenesisHandoffCommandV1>,
  ): Promise<OpenPressureN1FromGenesisHandoffResultV1>;
}

export interface InitializePressureChapterRunCommandV1 {
  routeSnapshot: RunRouteSnapshotV1;
  genesis: InitializeGenesisCommandV1;
}

export interface InitializePressureChapterRunResultV1 {
  genesis: InitializeGenesisResultV1;
  handoff: PersistedGenesisN1HandoffV1;
}

export interface PressureChapterRuntimeDependenciesV1 {
  genesis: RuntimeGenesisPortV1;
  genesisN1Handoff: RuntimeGenesisN1HandoffPortV1;
  chapters: RuntimeChapterOrchestratorPortV1;
  finale: RuntimeFinalePortV1;
  narrative: RuntimeNarrativePortV1;
  result: RuntimeResultQueryPortV1;
  replay: RuntimeReplayCommandPortV1;
}

export function buildGenesisOpenN1OutboxDedupeKeyV1(
  runId: string,
  sourceCommitHash: string,
): string {
  return `open_chapter:${runId}:N1:${sourceCommitHash}`;
}
