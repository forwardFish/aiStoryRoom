import type { SeatIdV1 } from "@ai-story/shared";
import type { AEmotionAuthoritySignalV1 } from "./contracts";
import {
  A_EMOTION_PRODUCTION_ERROR_CODES as ERROR,
  failAEmotionProduction,
} from "./errors";

export type AEmotionMetricToneV1 = "DEFAULT" | "GOOD" | "WARN" | "DANGER";
export type AEmotionMilestoneStateV1 = "INACTIVE" | "ACHIEVED";

export interface AEmotionMetricTransitionV1 {
  metricTransitionId: string;
  beforeTone: AEmotionMetricToneV1;
  afterTone: AEmotionMetricToneV1;
}

export interface AEmotionMilestoneTransitionV1 {
  milestoneId: string;
  beforeState: AEmotionMilestoneStateV1;
  afterState: AEmotionMilestoneStateV1;
}

const CROSS_IMPACT_ACTIONS = Object.freeze([
  { code: "VIEW_DETAILS", preferredEntry: "INVESTIGATE", consumesManeuverOnSubmit: false },
  { code: "RESPOND_NOW", preferredEntry: "PLAN", consumesManeuverOnSubmit: false },
  { code: "VIEW_LATER", preferredEntry: "DEFER", consumesManeuverOnSubmit: false },
] as const);

/**
 * Classifies only direct, cross-seat committed impacts.  It cannot create a
 * modal: major/critical impacts become center cards and minor impacts remain
 * feed signals.  Same-seat effects and events that already own a key-modal
 * transition are deliberately left unchanged.
 */
export function deriveCrossImpactPresentationV1(input: Readonly<{
  sourceSeatId: SeatIdV1;
  signal: AEmotionAuthoritySignalV1;
}>): AEmotionAuthoritySignalV1 {
  const signal = structuredClone(input.signal);
  const hasCrossSeatImpact = signal.impacts.some(
    (impact) => impact.targetSeatId !== input.sourceSeatId,
  );
  if (!hasCrossSeatImpact || signal.presentation.modalTrigger !== null) return signal;

  signal.kind = "DIRECT_IMPACT";
  signal.presentation = signal.severity === "MINOR"
    ? {
        recommendedPresentation: "FEED_ONLY",
        centerCardType: null,
        responseOptions: [],
        modalTrigger: null,
      }
    : {
        recommendedPresentation: "CENTER_CARD",
        centerCardType: "CROSS_IMPACT",
        responseOptions: CROSS_IMPACT_ACTIONS.map((option) => ({ ...option })),
        modalTrigger: null,
      };
  return signal;
}

/** First non-DANGER -> DANGER crossing only. */
export function isFirstDangerCrossingV1(
  transition: Readonly<AEmotionMetricTransitionV1>,
): boolean {
  validateMetricTransition(transition);
  return transition.beforeTone !== "DANGER" && transition.afterTone === "DANGER";
}

/** First INACTIVE -> ACHIEVED transition only. */
export function isFirstMilestoneAchievementV1(
  transition: Readonly<AEmotionMilestoneTransitionV1>,
): boolean {
  validateMilestoneTransition(transition);
  return transition.beforeState === "INACTIVE" && transition.afterState === "ACHIEVED";
}

/**
 * Applies one committed state transition to an already compiled signal.  A
 * non-edge (including DANGER -> DANGER and ACHIEVED -> ACHIEVED) strips a
 * template-suggested modal and leaves an ordinary center-card signal.
 */
export function deriveStateTransitionPresentationV1(input: Readonly<{
  signal: AEmotionAuthoritySignalV1;
  stateVersion: number;
  metric?: AEmotionMetricTransitionV1 | null;
  milestone?: AEmotionMilestoneTransitionV1 | null;
}>): AEmotionAuthoritySignalV1 {
  if (!Number.isSafeInteger(input.stateVersion) || input.stateVersion < 1) {
    return failAEmotionProduction(ERROR.AUTHORITY_SOURCE_INVALID, "trigger.stateVersion", "POSITIVE_INTEGER");
  }
  if (Boolean(input.metric) === Boolean(input.milestone)) {
    return failAEmotionProduction(ERROR.AUTHORITY_SOURCE_INVALID, "trigger.transition", "EXACTLY_ONE");
  }
  const signal = structuredClone(input.signal);
  const trigger = input.metric
    ? isFirstDangerCrossingV1(input.metric)
      ? { type: "CRISIS" as const, triggerId: input.metric.metricTransitionId }
      : null
    : isFirstMilestoneAchievementV1(input.milestone!)
      ? { type: "STAGE_VICTORY" as const, triggerId: input.milestone!.milestoneId }
      : null;

  signal.metricTransitionId = trigger?.type === "CRISIS" ? trigger.triggerId : null;
  signal.milestoneId = trigger?.type === "STAGE_VICTORY" ? trigger.triggerId : null;
  if (trigger) {
    signal.presentation = {
      ...signal.presentation,
      recommendedPresentation: "KEY_MODAL",
      centerCardType: trigger.type,
      modalTrigger: {
        type: trigger.type,
        triggerId: trigger.triggerId,
        stateVersion: input.stateVersion,
      },
    };
  } else {
    signal.presentation = {
      ...signal.presentation,
      recommendedPresentation: signal.presentation.centerCardType === null
        ? "FEED_ONLY"
        : "CENTER_CARD",
      modalTrigger: null,
    };
  }
  return signal;
}

function validateMetricTransition(value: Readonly<AEmotionMetricTransitionV1>): void {
  nonEmpty(value.metricTransitionId, "metricTransition.metricTransitionId");
  if (!["DEFAULT", "GOOD", "WARN", "DANGER"].includes(value.beforeTone)
    || !["DEFAULT", "GOOD", "WARN", "DANGER"].includes(value.afterTone)) {
    failAEmotionProduction(ERROR.AUTHORITY_SOURCE_INVALID, "metricTransition.tone", "ENUM");
  }
}

function validateMilestoneTransition(value: Readonly<AEmotionMilestoneTransitionV1>): void {
  nonEmpty(value.milestoneId, "milestoneTransition.milestoneId");
  if (!["INACTIVE", "ACHIEVED"].includes(value.beforeState)
    || !["INACTIVE", "ACHIEVED"].includes(value.afterState)) {
    failAEmotionProduction(ERROR.AUTHORITY_SOURCE_INVALID, "milestoneTransition.state", "ENUM");
  }
}

function nonEmpty(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !/\S/u.test(value)) {
    failAEmotionProduction(ERROR.AUTHORITY_SOURCE_INVALID, path, "NON_EMPTY_STRING");
  }
}
