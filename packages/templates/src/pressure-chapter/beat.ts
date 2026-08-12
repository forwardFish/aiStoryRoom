import {
  assertWorkingOnly,
  cloneValue,
  sortedUnique,
  stableSha256,
} from "./canonical";
import { fingerprintChapterWorkingState } from "./kernel-selector";
import {
  buildChapterWorkingSet,
  pinChapterWorkingSet,
  recoverPinnedChapterWorkingSet,
} from "./working-set";
import type {
  BeatCommand,
  BeatResult,
  BeatTransition,
  ChapterWorkingSet,
  ChapterWorkingState,
  DecisionPin,
  PressureChapterDefinition,
  SettledReaction,
  WorkingDelta,
} from "./types";

export function resolvePressureBeat(
  workingSet: ChapterWorkingSet,
  command: BeatCommand,
): BeatResult {
  if (
    command.expectedRevision !== workingSet.stateRevision
    || command.expectedStateFingerprint !== workingSet.stateFingerprint
  ) {
    throw new Error("PRESSURE_CHAPTER_STALE_REVISION");
  }
  if (command.decisionPointId !== workingSet.decisionPoint.decisionPointId) {
    throw new Error("PRESSURE_CHAPTER_DECISION_POINT_MISMATCH");
  }
  const option = workingSet.decisionPoint.options.find((item) => item.optionId === command.optionId);
  if (!option || !workingSet.optionIds.includes(option.optionId)) {
    throw new Error("PRESSURE_CHAPTER_OPTION_NOT_AVAILABLE");
  }
  assertWorkingOnly(option.workingDelta, "authoredWorkingDelta");
  const reaction: SettledReaction | null = option.workingDelta.reaction
    ? {
      ...cloneValue(option.workingDelta.reaction),
      reactionId: `reaction_${stableSha256({
        actionId: command.actionId,
        decisionPointId: command.decisionPointId,
        optionId: command.optionId,
      }).slice(0, 24)}`,
      sourceDecisionPointId: command.decisionPointId,
      sourceOptionId: command.optionId,
      causalFactIds: sortedUnique(option.workingDelta.reaction.causalFactIds),
    }
    : null;
  const workingDelta: WorkingDelta = {
    schemaVersion: "pressure_working_delta_v1",
    baseRevision: workingSet.stateRevision,
    completeDecisionPointId: workingSet.decisionPoint.decisionPointId,
    setFacts: cloneValue(option.workingDelta.setFacts || {}),
    incrementCounters: cloneValue(option.workingDelta.incrementCounters || {}),
    satisfyRequirementIds: sortedUnique(option.workingDelta.satisfyRequirementIds || []),
    appendSettledReaction: reaction,
  };
  assertWorkingOnly(workingDelta);
  const body = {
    schemaVersion: "pressure_beat_result_v1" as const,
    beatId: `beat_${stableSha256({
      actionId: command.actionId,
      chapterId: workingSet.chapterId,
      decisionPointId: command.decisionPointId,
      optionId: command.optionId,
      baseRevision: workingSet.stateRevision,
      baseFingerprint: workingSet.stateFingerprint,
      workingDelta,
    }).slice(0, 24)}`,
    chapterId: workingSet.chapterId,
    decisionPointId: command.decisionPointId,
    optionId: command.optionId,
    baseRevision: workingSet.stateRevision,
    baseFingerprint: workingSet.stateFingerprint,
    workingDelta,
  };
  return { ...body, resultHash: stableSha256(body) };
}

export function applyPressureBeatResult(
  sourceState: ChapterWorkingState,
  result: BeatResult,
): ChapterWorkingState {
  assertWorkingOnly(sourceState, "workingState");
  assertWorkingOnly(result.workingDelta);
  if (
    result.chapterId !== sourceState.chapterId
    || result.baseRevision !== sourceState.revision
    || result.workingDelta.baseRevision !== sourceState.revision
    || result.baseFingerprint !== fingerprintChapterWorkingState(sourceState)
  ) {
    throw new Error("PRESSURE_CHAPTER_STALE_REVISION");
  }
  const body = { ...result, resultHash: undefined };
  delete (body as { resultHash?: string }).resultHash;
  if (stableSha256(body) !== result.resultHash) {
    throw new Error("PRESSURE_CHAPTER_BEAT_RESULT_HASH_MISMATCH");
  }
  if (sourceState.completedDecisionPointIds.includes(result.decisionPointId)) {
    throw new Error("PRESSURE_CHAPTER_DECISION_ALREADY_COMPLETED");
  }
  const next = cloneValue(sourceState);
  next.revision += 1;
  next.facts = { ...next.facts, ...cloneValue(result.workingDelta.setFacts) };
  for (const [counter, delta] of Object.entries(result.workingDelta.incrementCounters)) {
    if (!Number.isFinite(delta)) throw new Error(`PRESSURE_CHAPTER_COUNTER_DELTA_INVALID:${counter}`);
    next.counters[counter] = Number(next.counters[counter] || 0) + delta;
  }
  next.satisfiedRequirementIds = sortedUnique([
    ...next.satisfiedRequirementIds,
    ...result.workingDelta.satisfyRequirementIds,
  ]);
  next.completedDecisionPointIds = sortedUnique([
    ...next.completedDecisionPointIds,
    result.workingDelta.completeDecisionPointId,
  ]);
  if (result.workingDelta.appendSettledReaction) {
    next.settledReactions.push(cloneValue(result.workingDelta.appendSettledReaction));
  }
  next.lastBeatId = result.beatId;
  return next;
}

/**
 * Apply the current beat first, then plan the next decision independently.
 * The settled reaction and the next prompt have separate fields, so planning
 * cannot replace the reaction that belongs to the committed action.
 */
export function completePressureBeat(
  chapter: PressureChapterDefinition,
  sourceState: ChapterWorkingState,
  result: BeatResult,
  recoveryPin: DecisionPin | null = null,
): BeatTransition {
  const state = applyPressureBeatResult(sourceState, result);
  const currentReaction = result.workingDelta.appendSettledReaction
    ? cloneValue(result.workingDelta.appendSettledReaction)
    : null;
  const nextWorkingSet = recoveryPin
    ? recoverPinnedChapterWorkingSet(chapter, state, recoveryPin)
    : buildChapterWorkingSet(chapter, state);
  return {
    state,
    currentReaction,
    nextWorkingSet,
    nextDecisionPin: nextWorkingSet ? pinChapterWorkingSet(nextWorkingSet) : null,
  };
}
