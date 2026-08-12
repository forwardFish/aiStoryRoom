import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  type SeatIdV1,
  type TrackIdV1,
} from "@ai-story/shared";
import type {
  SangtianSeatVerdictRuleV1,
  SangtianWorldOutcomeRuleV1,
} from "./types";

export const SANGTIAN_CONTENT_FINALE_POLICY_VERSION_V1 =
  "sangtian_content_finale_v1" as const;
export const SANGTIAN_CONTENT_FINALE_RULE_SCHEMA_VERSION_V1 =
  "sangtian_five_track_finale_rules_v1" as const;

const CIVIL: TrackIdV1 = "civilian_land";
const SILK: TrackIdV1 = "mulberry_silk";
const FISCAL: TrackIdV1 = "fiscal_military";
const EVIDENCE: TrackIdV1 = "evidence_responsibility";
const COURT: TrackIdV1 = "court_imperial_face";

/**
 * This ordered table is the executable form of the accepted Sangtian content
 * rules. Priority is content-owned; the evaluator cannot add a Generic or
 * Provider-selected outcome before the DEFAULT rule.
 */
export const SANGTIAN_WORLD_OUTCOME_RULES_V1: readonly SangtianWorldOutcomeRuleV1[] =
  Object.freeze([
    {
      ruleRef: "world.01.east_south_collapse",
      outcomeId: "EAST_SOUTH_COLLAPSE",
      priority: 1,
      matches: (tracks) => tracks[CIVIL] <= -2 && tracks[FISCAL] <= -2,
    },
    {
      ruleRef: "world.02.truth_with_political_shock",
      outcomeId: "TRUTH_WITH_POLITICAL_SHOCK",
      priority: 2,
      matches: (tracks) => tracks[EVIDENCE] >= 2 && tracks[COURT] <= -2,
    },
    {
      ruleRef: "world.03.balanced_survival",
      outcomeId: "BALANCED_SURVIVAL",
      priority: 3,
      matches: (tracks) => TRACK_IDS_V1.every((trackId) => tracks[trackId] >= 2),
    },
    {
      ruleRef: "world.04.fiscal_order_at_civil_cost",
      outcomeId: "FISCAL_ORDER_AT_CIVIL_COST",
      priority: 4,
      matches: (tracks) => tracks[FISCAL] >= 2 && tracks[CIVIL] <= -2,
    },
    {
      ruleRef: "world.05.civil_relief_at_war_cost",
      outcomeId: "CIVIL_RELIEF_AT_WAR_COST",
      priority: 5,
      matches: (tracks) => tracks[CIVIL] >= 2 && tracks[FISCAL] <= -2,
    },
    {
      ruleRef: "world.06.scapegoat_stability",
      outcomeId: "SCAPEGOAT_STABILITY",
      priority: 6,
      matches: (tracks) => tracks[EVIDENCE] <= -2 && tracks[COURT] >= 2,
    },
    {
      ruleRef: "world.07.unresolved_compromise",
      outcomeId: "UNRESOLVED_COMPROMISE",
      priority: 7,
      matches: () => true,
    },
  ] satisfies SangtianWorldOutcomeRuleV1[]);

export const SANGTIAN_SEAT_VERDICT_RULES_V1: Readonly<
  Record<SeatIdV1, SangtianSeatVerdictRuleV1>
> = Object.freeze({
  cabinet_finance: Object.freeze({
    ruleRef: "seat.cabinet_finance.fiscal_and_court_floor",
    seatId: "cabinet_finance",
    scoreTrackIds: Object.freeze([FISCAL, COURT]),
  }),
  jiangnan_merchant: Object.freeze({
    ruleRef: "seat.jiangnan_merchant.civil_and_fiscal_floor",
    seatId: "jiangnan_merchant",
    scoreTrackIds: Object.freeze([CIVIL, FISCAL]),
  }),
  qingliu_law: Object.freeze({
    ruleRef: "seat.qingliu_law.evidence_floor",
    seatId: "qingliu_law",
    scoreTrackIds: Object.freeze([EVIDENCE]),
  }),
  sili_weaving: Object.freeze({
    ruleRef: "seat.sili_weaving.silk_and_court_floor",
    seatId: "sili_weaving",
    scoreTrackIds: Object.freeze([SILK, COURT]),
  }),
  zhejiang_administration: Object.freeze({
    ruleRef: "seat.zhejiang_administration.civil_and_court_floor",
    seatId: "zhejiang_administration",
    scoreTrackIds: Object.freeze([CIVIL, COURT]),
  }),
  zhejiang_governor: Object.freeze({
    ruleRef: "seat.zhejiang_governor.civil_and_fiscal_floor",
    seatId: "zhejiang_governor",
    scoreTrackIds: Object.freeze([CIVIL, FISCAL]),
  }),
});

export const SANGTIAN_DISCLOSURE_RULE_REFS_V1 = Object.freeze([
  "disclosure.authoritative_world_and_seat_projection",
] as const);

export function expectedWorldOutcomeRuleRefsV1(): string[] {
  return SANGTIAN_WORLD_OUTCOME_RULES_V1
    .map((rule) => rule.ruleRef)
    .sort();
}

export function expectedSeatVerdictRuleRefsV1(): Record<SeatIdV1, string[]> {
  return Object.fromEntries(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => [
    seatId,
    [SANGTIAN_SEAT_VERDICT_RULES_V1[seatId].ruleRef],
  ])) as Record<SeatIdV1, string[]>;
}
