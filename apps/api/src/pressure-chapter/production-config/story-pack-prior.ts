import type { CompilePressureViewerStoryPackInputV1 } from "./viewer-story-pack-input";
import type { PressureViewerStoryPackIdentityV1 } from "./viewer-story-pack-output";
import { storyVisible } from "./story-pack-scope";
import { storyFail, storyText, storyUnique } from "./story-pack-validate";

export function compileStoryPackPriorV1(
  input: Readonly<CompilePressureViewerStoryPackInputV1>,
  identity: PressureViewerStoryPackIdentityV1,
) {
  if (input.previousBeatId === null) {
    if (input.sealedViewerAction !== null || input.visibleSeatResults.length !== 0) {
      storyFail("IDENTITY", "previousBeatId", "OPENING_HAS_PRIOR");
    }
    return { previousAction: null, visibleSeatResults: [] };
  }
  if (input.sealedViewerAction === null) {
    storyFail("INVALID", "sealedViewerAction", "REQUIRED");
  }
  bindPrior(input.sealedViewerAction, input, identity, "sealedViewerAction");
  if (input.sealedViewerAction.viewerSeatId !== identity.viewerSeatId) {
    storyFail("SCOPE", "sealedViewerAction.viewerSeatId", "OTHER_SEAT");
  }
  const previousAction = {
    actionId: storyText(input.sealedViewerAction.actionId, "sealedViewerAction.actionId"),
    actionType: storyText(input.sealedViewerAction.actionType, "sealedViewerAction.actionType"),
    summary: storyText(input.sealedViewerAction.summary, "sealedViewerAction.summary"),
  };
  if (input.visibleSeatResults.length > 6) {
    storyFail("INVALID", "visibleSeatResults", "MAX_SIX");
  }
  const visibleSeatResults = input.visibleSeatResults.map((item, index) => {
    const path = `visibleSeatResults[${index}]`;
    bindPrior(item, input, identity, path);
    storyVisible(item, identity.viewerSeatId, path);
    return {
      sourceSeatId: item.sourceSeatId,
      actionId: storyText(item.actionId, `${path}.actionId`),
      summary: storyText(item.summary, `${path}.summary`),
      resultFactRefs: storyUnique(item.resultFactRefs, `${path}.resultFactRefs`),
    };
  });
  storyUnique(
    visibleSeatResults.map((item) => `${item.sourceSeatId}:${item.actionId}`),
    "visibleSeatResults.identity",
  );
  return { previousAction, visibleSeatResults };
}

function bindPrior(
  value: { runId: string; chapterRuntimeId: string; sourceBeatId: string; authorityRevision: number },
  input: Readonly<CompilePressureViewerStoryPackInputV1>,
  identity: PressureViewerStoryPackIdentityV1,
  path: string,
): void {
  if (
    value.runId !== identity.runId
    || value.chapterRuntimeId !== identity.chapterRuntimeId
    || value.sourceBeatId !== input.previousBeatId
    || value.authorityRevision !== identity.authorityRevision
  ) {
    storyFail("IDENTITY", path, "RUN_CHAPTER_BEAT_REVISION");
  }
}
