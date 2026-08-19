import type { ChapterIdV1, SeatIdV1 } from "@ai-story/shared";
import type { PressureChapterGameProjectionV1 } from "../game-projection/contracts";

export interface PressurePostCommitTurnReceiptV1 {
  schemaVersion: "pressure_post_commit_turn_receipt_v1";
  updateKey: string;
  runId: string;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  viewerSeatId: SeatIdV1;
  savedActionId: string;
  nextBeatId: string | null;
  nextDecisionPointId: string | null;
  status: "ACTION_SAVED";
}

export type PressurePostCommitTurnUpdateV1 = Readonly<{
  schemaVersion: "pressure_post_commit_turn_update_v1";
  updateKey: string;
  runId: string;
  chapterRuntimeId: string;
  status: "PENDING" | "READY" | "FAILED" | "EXPIRED";
  projection: PressureChapterGameProjectionV1 | null;
}>;

export interface PressurePostCommitTurnUpdatePortV1 {
  start(input: Readonly<{
    runId: string;
    subjectId: string;
    idempotencyKey: string;
    chapterRuntimeId: string;
    chapterId: ChapterIdV1;
    viewerSeatId: SeatIdV1;
    savedActionId: string;
    nextBeatId: string | null;
    nextDecisionPointId: string | null;
    load: () => Promise<PressureChapterGameProjectionV1>;
  }>): PressurePostCommitTurnReceiptV1;
  read(input: Readonly<{
    runId: string;
    subjectId: string;
    updateKey: string;
    chapterRuntimeId: string;
  }>): PressurePostCommitTurnUpdateV1;
}
