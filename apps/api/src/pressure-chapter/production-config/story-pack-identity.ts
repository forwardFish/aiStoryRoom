import type { SeatIdV1 } from "@ai-story/shared";
import type { CompilePressureViewerStoryPackInputV1 } from "./viewer-story-pack-input";
import type { PressureViewerStoryPackIdentityV1 } from "./viewer-story-pack-output";
import { storyFail, storyInteger, storySha, storyText } from "./story-pack-validate";

export function compileStoryPackIdentityV1(
  input: Readonly<CompilePressureViewerStoryPackInputV1>,
): PressureViewerStoryPackIdentityV1 {
  const identity = {
    runId: storyText(input.runId, "runId"),
    chapterRuntimeId: storyText(input.chapterRuntimeId, "chapterRuntimeId"),
    chapterId: storyText(input.chapterId, "chapterId"),
    beatId: storyText(input.beatId, "beatId"),
    viewerSeatId: storyText(input.viewerSeatId, "viewerSeatId") as SeatIdV1,
    authorityRevision: storyInteger(input.authorityRevision, "authorityRevision"),
  };
  storyInteger(input.ordinal, "ordinal", 1);
  if ((input.ordinal === 1) !== (input.previousBeatId === null)) {
    storyFail("IDENTITY", "previousBeatId", "OPENING_BOUNDARY");
  }
  if (input.previousBeatId !== null) storyText(input.previousBeatId, "previousBeatId");
  storySha(input.stateAfterHash, "stateAfterHash");
  storySha(input.authorityHash, "authorityHash");
  storySha(input.previousNarrative.sourceCommitHash, "previousNarrative.sourceCommitHash");
  if (input.previousNarrative.authority !== "CONTINUITY_ONLY") {
    storyFail("INVALID", "previousNarrative.authority", "CONTINUITY_ONLY");
  }
  storyText(input.previousNarrative.text, "previousNarrative.text");
  return identity;
}
