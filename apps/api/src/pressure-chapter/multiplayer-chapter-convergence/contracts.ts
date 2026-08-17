import type {
  ChapterIdV1,
  RunRouteSnapshotV1,
  SeatIdV1,
} from "@ai-story/shared";
import type { ChapterOrchestratorStateV1 } from "../orchestrator/contracts";

export interface MultiplayerChapterConvergenceCommandV1 {
  routeSnapshot: RunRouteSnapshotV1;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  nowMs: number;
}

export interface MultiplayerChapterConvergenceResultV1 {
  schemaVersion: "pressure_multiplayer_chapter_convergence_result_v1";
  status: "WAITING_FOR_HUMANS" | "CONVERGED" | "ALREADY_PROGRESSED";
  waitingSeatIds: SeatIdV1[];
  chapter: ChapterOrchestratorStateV1 | null;
}

export interface MultiplayerChapterConvergencePortV1 {
  convergeIfReady(
    command: Readonly<MultiplayerChapterConvergenceCommandV1>,
  ): Promise<MultiplayerChapterConvergenceResultV1>;
}
