import type {
  ChapterIdV1,
  RunRouteSnapshotV1,
  SeatIdV1,
} from "@ai-story/shared";
import type { PressureChapterBeatAuthoringPackageV1 } from "@ai-story/templates";
import type { SubmitOrchestratedActionCommandV1 } from "../orchestrator/contracts";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import type { MultiplayerSeatBeatCursorPlanV1 } from "../multiplayer-seat-beat/contracts";

export interface ReadAcceptedMultiplayerSeatActionsInputV1 {
  routeSnapshot: RunRouteSnapshotV1;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  seatId: SeatIdV1;
  package: PressureChapterBeatAuthoringPackageV1;
  projection: WorkingLedgerProjectionV1;
}

export interface DurableAcceptedMultiplayerSeatActionsV1 {
  schemaVersion: "pressure_durable_accepted_multiplayer_seat_actions_v1";
  runId: string;
  routeHash: string;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  seatId: SeatIdV1;
  actions: Array<{
    decisionPointId: string;
    actionId: string;
  }>;
  ledgerHeadHash: string;
  workingRevision: number;
  prefixHash: string;
}

export interface MultiplayerSeatProgressionResultV1 {
  schemaVersion: "pressure_multiplayer_seat_progression_result_v1";
  submissionStatus: "ACCEPTED" | "REPLAYED" | "NOT_SUBMITTED";
  cursor: MultiplayerSeatBeatCursorPlanV1;
  accepted: DurableAcceptedMultiplayerSeatActionsV1;
}

export interface MultiplayerSeatProgressionPortV1 {
  read(input: Readonly<{
    routeSnapshot: RunRouteSnapshotV1;
    chapterRuntimeId: string;
    chapterId: ChapterIdV1;
    seatId: SeatIdV1;
  }>): Promise<MultiplayerSeatProgressionResultV1>;
  submit(
    command: Readonly<SubmitOrchestratedActionCommandV1>,
    preparedProjection?: Readonly<WorkingLedgerProjectionV1> | null,
  ): Promise<MultiplayerSeatProgressionResultV1>;
}
