import { compareCanonicalText } from "@ai-story/shared";
import { stableSha256 } from "./canonical";
import { resolveRequirementDependencyBlock } from "./requirement-dependency";
import type {
  ChapterWorkingState,
  DecisionEvaluation,
  DecisionPointDefinition,
  KernelSelectionTrace,
  PressureChapterDefinition,
} from "./types";

export const PRESSURE_KERNEL_SELECTOR_VERSION = "pressure_kernel_selector_v1" as const;

export const PRESSURE_KERNEL_WEIGHTS = {
  DUE_PRESSURE: 60,
  UNMET_EXIT_GATE: 40,
  UNMET_MUST_ESTABLISH: 30,
  PENDING_PRESSURE: 20,
  ACTIVE_ARC: 10,
  PRESENT_PRESSURE_ACTOR: 4,
  RECENT_REQUIREMENT_CONTINUITY: 20,
} as const;

export type KernelSelectionResult = {
  selected: DecisionPointDefinition | null;
  trace: KernelSelectionTrace;
};

const SELECTION_RUNTIME_IDENTITY_KEYS = new Set([
  "runId",
  "eventId",
  "lastCommittedEventId",
  "causedByEventId",
  "transferId",
  "consequenceId",
  "beatId",
  "lastBeatId",
  "reactionId",
  "reactionEventId",
  "sourceEventId",
]);

export function fingerprintChapterWorkingState(state: ChapterWorkingState): string {
  return stableSha256({
    schemaVersion: state.schemaVersion,
    runId: state.runId,
    chapterId: state.chapterId,
    revision: state.revision,
    facts: state.facts,
    counters: state.counters,
    satisfiedRequirementIds: [...state.satisfiedRequirementIds].sort(),
    completedDecisionPointIds: [...state.completedDecisionPointIds].sort(),
    settledReactions: state.settledReactions,
    lastBeatId: state.lastBeatId,
  });
}

/**
 * Fingerprint used only to break equal-score Kernel selections. Recovery,
 * command fencing and audit traces continue to use fingerprintChapterWorkingState.
 * Runtime identities and presentation prose cannot change the selected Kernel,
 * while structured causal state remains part of the selection fingerprint.
 */
export function fingerprintChapterSelectionState(state: ChapterWorkingState): string {
  return stableSha256({
    schemaVersion: state.schemaVersion,
    chapterId: state.chapterId,
    revision: state.revision,
    facts: stripRuntimeIdentityFields(state.facts),
    counters: state.counters,
    satisfiedRequirementIds: [...state.satisfiedRequirementIds].sort(compareCanonicalText),
    completedDecisionPointIds: [...state.completedDecisionPointIds].sort(compareCanonicalText),
    settledReactions: state.settledReactions.map((reaction) => ({
      sourceDecisionPointId: reaction.sourceDecisionPointId,
      sourceOptionId: reaction.sourceOptionId,
      kind: reaction.kind,
      audience: reaction.audience,
      causalFactIds: [...reaction.causalFactIds].sort(compareCanonicalText),
    })),
  });
}

export function scoreDecisionPoint(point: DecisionPointDefinition): number {
  const priority = point.priority || {};
  return Number(priority.duePressureCount || 0) * PRESSURE_KERNEL_WEIGHTS.DUE_PRESSURE
    + Number(priority.unmetExitGateCount || 0) * PRESSURE_KERNEL_WEIGHTS.UNMET_EXIT_GATE
    + Number(priority.unmetMustEstablishCount || 0) * PRESSURE_KERNEL_WEIGHTS.UNMET_MUST_ESTABLISH
    + Number(priority.pendingPressureCount || 0) * PRESSURE_KERNEL_WEIGHTS.PENDING_PRESSURE
    + Number(priority.activeArcCount || 0) * PRESSURE_KERNEL_WEIGHTS.ACTIVE_ARC
    + Math.min(Number(priority.availablePressureActorCount || 0), 3)
      * PRESSURE_KERNEL_WEIGHTS.PRESENT_PRESSURE_ACTOR
    + Number(priority.recentRequirementContinuityCount || 0)
      * PRESSURE_KERNEL_WEIGHTS.RECENT_REQUIREMENT_CONTINUITY;
}

export function evaluateDecisionPoints(
  chapter: PressureChapterDefinition,
  state: ChapterWorkingState,
): DecisionEvaluation[] {
  if (chapter.chapterId !== state.chapterId) {
    throw new Error("PRESSURE_CHAPTER_STATE_CHAPTER_MISMATCH");
  }
  const selectionFingerprint = fingerprintChapterSelectionState(state);
  const completed = new Set(state.completedDecisionPointIds);
  return chapter.decisionPoints.map((point) => {
    const reasonCodes: string[] = [];
    if (completed.has(point.decisionPointId)) reasonCodes.push("DECISION_POINT_COMPLETED");
    if (!activationSatisfied(point, state)) reasonCodes.push("DECISION_POINT_NOT_ACTIVE");
    if (!point.options.length) reasonCodes.push("DECISION_POINT_HAS_NO_OPTIONS");
    const dependency = resolveRequirementDependencyBlock(chapter, state, point);
    reasonCodes.push(...dependency.reasonCodes);
    return {
      decisionPointId: point.decisionPointId,
      kernelId: point.kernelId,
      eligible: reasonCodes.length === 0,
      score: scoreDecisionPoint(point),
      tieBreaker: stableSha256({
        stateFingerprint: selectionFingerprint,
        kernelId: point.kernelId,
        decisionPointId: point.decisionPointId,
      }),
      reasonCodes: [...new Set(reasonCodes)].sort(),
    };
  }).sort((left, right) => compareCanonicalText(left.decisionPointId, right.decisionPointId));
}

function stripRuntimeIdentityFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripRuntimeIdentityFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SELECTION_RUNTIME_IDENTITY_KEYS.has(key))
      .map(([key, entry]) => [key, stripRuntimeIdentityFields(entry)]),
  );
}

export function selectNextDecisionPoint(
  chapter: PressureChapterDefinition,
  state: ChapterWorkingState,
): KernelSelectionResult {
  const stateFingerprint = fingerprintChapterWorkingState(state);
  const evaluations = evaluateDecisionPoints(chapter, state);
  const selectedEvaluation = evaluations
    .filter((item) => item.eligible)
    .sort((left, right) => (
      right.score - left.score
      || compareCanonicalText(left.tieBreaker, right.tieBreaker)
      || compareCanonicalText(left.decisionPointId, right.decisionPointId)
    ))[0] || null;
  const selected = selectedEvaluation
    ? chapter.decisionPoints.find((point) => (
      point.decisionPointId === selectedEvaluation.decisionPointId
    )) || null
    : null;
  return {
    selected,
    trace: {
      schemaVersion: "pressure_kernel_selection_trace_v1",
      selectorVersion: PRESSURE_KERNEL_SELECTOR_VERSION,
      stateRevision: state.revision,
      stateFingerprint,
      selectedDecisionPointId: selected?.decisionPointId || null,
      evaluations,
    },
  };
}

function activationSatisfied(
  point: DecisionPointDefinition,
  state: ChapterWorkingState,
): boolean {
  const activation = point.activation;
  if (!activation) return true;
  const satisfied = new Set(state.satisfiedRequirementIds);
  if (activation.allSatisfiedRequirementIds?.some((id) => !satisfied.has(id))) return false;
  if (activation.noneSatisfiedRequirementIds?.some((id) => satisfied.has(id))) return false;
  if (activation.factEquals && Object.entries(activation.factEquals).some(
    ([key, expected]) => stableSha256(state.facts[key]) !== stableSha256(expected),
  )) return false;
  if (activation.minimumCounters && Object.entries(activation.minimumCounters).some(
    ([key, minimum]) => Number(state.counters[key] || 0) < minimum,
  )) return false;
  return true;
}
