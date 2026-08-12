import { compareCanonicalText } from "@ai-story/shared";
import { cloneValue } from "./canonical";
import {
  evaluateDecisionPoints,
  fingerprintChapterWorkingState,
  selectNextDecisionPoint,
} from "./kernel-selector";
import type {
  ChapterWorkingSet,
  ChapterWorkingState,
  DecisionPin,
  PressureChapterDefinition,
} from "./types";

export function buildChapterWorkingSet(
  chapter: PressureChapterDefinition,
  state: ChapterWorkingState,
): ChapterWorkingSet | null {
  const selection = selectNextDecisionPoint(chapter, state);
  if (!selection.selected) return null;
  return materializeWorkingSet(selection.selected.decisionPointId, chapter, state, selection.trace);
}

export function pinChapterWorkingSet(workingSet: ChapterWorkingSet): DecisionPin {
  return {
    schemaVersion: "pressure_decision_pin_v1",
    chapterId: workingSet.chapterId,
    stateRevision: workingSet.stateRevision,
    stateFingerprint: workingSet.stateFingerprint,
    decisionPointId: workingSet.decisionPoint.decisionPointId,
    kernelId: workingSet.decisionPoint.kernelId,
    optionIds: [...workingSet.optionIds],
  };
}

export function recoverPinnedChapterWorkingSet(
  chapter: PressureChapterDefinition,
  state: ChapterWorkingState,
  pin: DecisionPin,
): ChapterWorkingSet {
  const fingerprint = fingerprintChapterWorkingState(state);
  if (
    pin.schemaVersion !== "pressure_decision_pin_v1"
    || pin.chapterId !== chapter.chapterId
    || state.chapterId !== chapter.chapterId
    || pin.stateRevision !== state.revision
    || pin.stateFingerprint !== fingerprint
  ) {
    throw new Error("PRESSURE_CHAPTER_PIN_STALE");
  }
  const point = chapter.decisionPoints.find((item) => item.decisionPointId === pin.decisionPointId);
  if (!point || point.kernelId !== pin.kernelId) {
    throw new Error("PRESSURE_CHAPTER_PIN_TARGET_MISMATCH");
  }
  const optionIds = orderedOptionIds(point);
  if (!sameStringArray(optionIds, pin.optionIds)) {
    throw new Error("PRESSURE_CHAPTER_PIN_OPTIONS_MISMATCH");
  }
  const evaluation = evaluateDecisionPoints(chapter, state)
    .find((item) => item.decisionPointId === point.decisionPointId);
  if (!evaluation?.eligible) throw new Error("PRESSURE_CHAPTER_PIN_NOT_ELIGIBLE");
  const normal = selectNextDecisionPoint(chapter, state);
  return materializeWorkingSet(point.decisionPointId, chapter, state, {
    ...normal.trace,
    selectedDecisionPointId: point.decisionPointId,
  });
}

function materializeWorkingSet(
  decisionPointId: string,
  chapter: PressureChapterDefinition,
  state: ChapterWorkingState,
  selection: ChapterWorkingSet["selection"],
): ChapterWorkingSet {
  const point = chapter.decisionPoints.find((item) => item.decisionPointId === decisionPointId);
  if (!point) throw new Error("PRESSURE_CHAPTER_SELECTED_POINT_MISSING");
  return {
    schemaVersion: "pressure_chapter_working_set_v1",
    chapterId: chapter.chapterId,
    stateRevision: state.revision,
    stateFingerprint: fingerprintChapterWorkingState(state),
    decisionPoint: cloneValue(point),
    optionIds: orderedOptionIds(point),
    selection: cloneValue(selection),
  };
}

function orderedOptionIds(point: ChapterWorkingSet["decisionPoint"]): string[] {
  return [...point.options]
    .sort((left, right) => (
      left.sourceOrder - right.sourceOrder
      || compareCanonicalText(left.optionId, right.optionId)
    ))
    .map((item) => item.optionId);
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}
