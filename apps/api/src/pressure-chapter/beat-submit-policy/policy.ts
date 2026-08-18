import type { ParticipantModeV1 } from "@ai-story/shared";
import {
  isSangtianPressureChapterBeatAuthoringRegisteredV1,
} from "@ai-story/templates";

export type PressureBeatSubmitPolicyV1 =
  | "INDEPENDENT_SEAT_BEATS"
  | "SHARED_DECISION_CONVERGENCE";

export interface PressureBeatSubmitPolicyPortV1 {
  usesIndependentSeatBeats(input: Readonly<{
    participantMode: ParticipantModeV1;
    chapterId: string;
  }>): boolean;
}

/** Keeps existing isolated fixtures and legacy composition multiplayer-only. */
export const LEGACY_MULTIPLAYER_ONLY_BEAT_SUBMIT_POLICY_V1:
PressureBeatSubmitPolicyPortV1 = Object.freeze({
  usesIndependentSeatBeats(input: Readonly<{
    participantMode: ParticipantModeV1;
    chapterId: string;
  }>) {
    return input.participantMode === "MULTIPLAYER";
  },
});

export class SangtianRegisteredBeatSubmitPolicyV1
implements PressureBeatSubmitPolicyPortV1 {
  usesIndependentSeatBeats(input: Readonly<{
    participantMode: ParticipantModeV1;
    chapterId: string;
  }>): boolean {
    return usesIndependentSeatBeatFlowV1(input);
  }
}

/**
 * A registered multi-Beat package is the sole switch for per-seat progression.
 * Solo and multiplayer share the authored Beat semantics, while chapters that
 * have not yet been converted retain the legacy shared decision path.
 */
export function resolvePressureBeatSubmitPolicyV1(input: Readonly<{
  participantMode: ParticipantModeV1;
  chapterId: string;
}>): PressureBeatSubmitPolicyV1 {
  return isSangtianPressureChapterBeatAuthoringRegisteredV1(input.chapterId)
    ? "INDEPENDENT_SEAT_BEATS"
    : "SHARED_DECISION_CONVERGENCE";
}

export function usesIndependentSeatBeatFlowV1(input: Readonly<{
  participantMode: ParticipantModeV1;
  chapterId: string;
}>): boolean {
  return resolvePressureBeatSubmitPolicyV1(input) === "INDEPENDENT_SEAT_BEATS";
}
