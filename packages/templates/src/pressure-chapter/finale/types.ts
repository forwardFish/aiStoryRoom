import type {
  FrozenFinalePolicyV1,
  SangtianFinaleInputV1,
  SangtianPressureFinaleDecisionV1,
  SeatIdV1,
  TrackIdV1,
} from "@ai-story/shared";

export type FinaleTrackLevelV1 = "LOW" | "MID" | "HIGH";
export type FinaleSeatVerdictV1 = "WIN" | "COSTLY_WIN" | "LOSS";

export interface CompileSangtianFinalePolicyRequestV1 {
  contentPackageVersion: string;
  contentPackageSha256: string;
}

export interface SangtianFinaleEvaluationRequestV1 {
  input: SangtianFinaleInputV1;
  policy: FrozenFinalePolicyV1;
  decidedAt: string;
  idempotencyKey: string;
}

export interface SangtianWorldOutcomeRuleV1 {
  ruleRef: string;
  outcomeId: string;
  priority: number;
  matches: (tracks: Readonly<Record<TrackIdV1, number>>) => boolean;
}

export interface SangtianSeatVerdictRuleV1 {
  ruleRef: string;
  seatId: SeatIdV1;
  scoreTrackIds: readonly TrackIdV1[];
}

export interface GenericFinaleShadowCandidateV1 {
  schemaVersion: "generic_finale_shadow_candidate_v1";
  shadowEngineVersion: string;
  sourceInputHash: string;
  worldOutcomeId: string;
  seatVerdicts: Array<{
    seatId: string;
    verdict: string;
  }>;
  semanticOutcomeHash: string;
}

export interface FinaleShadowMismatchV1 {
  code: string;
  path: string;
  authoritative: string | null;
  shadow: string | null;
}

export interface FinaleShadowComparisonV1 {
  schemaVersion: "sangtian_finale_shadow_comparison_v1";
  authoritativeExecutionFingerprint: string;
  shadowEngineVersion: string;
  shadowDecisionHash: string;
  matches: boolean;
  mismatches: FinaleShadowMismatchV1[];
  reportHash: string;
}

export type EvaluatedSangtianFinaleDecisionV1 = SangtianPressureFinaleDecisionV1;
