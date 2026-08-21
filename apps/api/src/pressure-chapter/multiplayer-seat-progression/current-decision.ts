import {
  validateRunRouteSnapshotV1,
  type ChapterIdV1,
  type RunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import { loadSangtianPressureChapterBeatAuthoringV1 } from "@ai-story/templates";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import { planMultiplayerSeatBeatCursorV1 } from "../multiplayer-seat-beat/plan";
import { readAcceptedMultiplayerSeatActionsV1 } from "./accepted-actions";

/**
 * Derives the current authored decision for one independently progressing seat
 * from the frozen route and durable Working projection only.
 */
export function currentIndependentSeatDecisionPointV1(input: Readonly<{
  routeSnapshot: RunRouteSnapshotV1;
  projection: WorkingLedgerProjectionV1;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  seatId: SeatIdV1;
}>): string | null {
  const route = validateRunRouteSnapshotV1(input.routeSnapshot);
  const authoring = loadSangtianPressureChapterBeatAuthoringV1(input.chapterId);
  const accepted = readAcceptedMultiplayerSeatActionsV1({
    routeSnapshot: route,
    chapterRuntimeId: input.chapterRuntimeId,
    chapterId: input.chapterId,
    seatId: input.seatId,
    package: authoring,
    projection: input.projection,
  });
  const plan = planMultiplayerSeatBeatCursorV1({
    participantMode: route.participantMode,
    chapterRuntimeId: input.chapterRuntimeId,
    seatId: input.seatId,
    package: authoring,
    acceptedActions: accepted.actions,
  });
  return plan.status === "AWAITING_DECISION" ? plan.decisionPointId : null;
}
