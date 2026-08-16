import type { ParticipantModeV1, SeatIdV1 } from "@ai-story/shared";
import type { PressureChapterBeatAuthoringPackageV1 } from "@ai-story/templates";

export interface AcceptedMultiplayerSeatBeatActionV1 {
  decisionPointId: string;
  actionId: string;
}

export interface PlanMultiplayerSeatBeatCursorInputV1 {
  participantMode: ParticipantModeV1;
  chapterRuntimeId: string;
  seatId: SeatIdV1;
  package: PressureChapterBeatAuthoringPackageV1;
  acceptedActions: AcceptedMultiplayerSeatBeatActionV1[];
}

export type MultiplayerSeatBeatCursorPlanV1 = Readonly<{
  schemaVersion: "pressure_multiplayer_seat_beat_cursor_plan_v1";
  chapterRuntimeId: string;
  chapterId: string;
  seatId: SeatIdV1;
  completedDecisionPointIds: string[];
  completedActionIds: string[];
  status: "AWAITING_DECISION" | "CHAPTER_READY_FOR_CONVERGENCE";
  beatId: string | null;
  decisionPointId: string | null;
  closesChapter: boolean;
  planHash: string;
}>;
