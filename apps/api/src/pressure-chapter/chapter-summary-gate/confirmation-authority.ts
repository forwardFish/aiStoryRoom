import type { PressureChapterSummaryConfirmationCommandV2 } from "./production";

interface ConfirmationProjectionV1 {
  roomId: string;
  runId: string;
  route: { routeHash: string };
  chapter: { workingRevision: number };
  viewer: {
    seatId: string;
    control: { controlEpoch: number; submissionFenceToken: string | null };
  };
  chapterSummary: null | {
    sourceChapterRuntimeId: string;
    chapterId: string;
    confirmationState: "AWAITING_CONFIRMATION" | "CONFIRMED";
  };
}

export function assertPressureChapterSummaryConfirmationAuthorityV2(
  roomId: string,
  command: PressureChapterSummaryConfirmationCommandV2,
  projection: ConfirmationProjectionV1,
): void {
  const summary = projection.chapterSummary;
  if (
    projection.roomId !== roomId
    || projection.runId !== command.runId
    || projection.route.routeHash !== command.routeHash
    || projection.viewer.seatId !== command.viewerSeatId
    || projection.viewer.control.controlEpoch !== command.controlEpoch
    || projection.viewer.control.submissionFenceToken !== command.submissionFenceToken
    || projection.chapter.workingRevision !== command.expectedWorkingRevision
    || (summary !== null && (
      summary.confirmationState !== "AWAITING_CONFIRMATION"
      || summary.sourceChapterRuntimeId !== command.chapterRuntimeId
      || summary.chapterId !== command.chapterId
    ))
  ) {
    throw new Error("PRESSURE_CHAPTER_SUMMARY_CONFIRMATION_AUTHORITY_MISMATCH");
  }
}
