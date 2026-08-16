import type { ParticipantModeV1, SeatIdV1 } from "@ai-story/shared";
import type { PressureChapterBeatClosureAuthorityV1 } from "@ai-story/templates";

export type BeatSubmitModeV1 =
  | "INTERMEDIATE_ACTION_ONLY"
  | "CHAPTER_COUNCIL_COMMIT";

export interface BeatSubmitControllerAuthorityV1 {
  seatId: SeatIdV1;
  mode: "HUMAN_ACTIVE" | "AI_ACTIVE";
  activeControllerId: string;
  controlEpoch: number;
  authorityStateHash: string;
  requiresResolution: boolean;
}

/**
 * Pure authority input. The caller must supply the already-frozen Beat closure
 * fact and the already-resolved control topology; this module never reads them.
 */
export interface BeatSubmitPolicyInputV1 {
  schemaVersion: "pressure_beat_submit_policy_input_v1";
  beat: PressureChapterBeatClosureAuthorityV1;
  participantMode: ParticipantModeV1;
  viewerSeatId: SeatIdV1;
  requiredSeatIds: readonly SeatIdV1[];
  controllerTopology: readonly BeatSubmitControllerAuthorityV1[];
  inputHash: string;
}

export interface BeatSubmitPlanV1 {
  schemaVersion: "pressure_beat_submit_plan_v1";
  policyVersion: "pressure-beat-submit-policy-1.0.0";
  beatId: string;
  participantMode: ParticipantModeV1;
  viewerSeatId: SeatIdV1;
  mode: BeatSubmitModeV1;
  humanSubmissionSeatIds: readonly SeatIdV1[];
  npcResolutionSeatIds: readonly SeatIdV1[];
  invokeSettlement: boolean;
  inputHash: string;
  planHash: string;
}
