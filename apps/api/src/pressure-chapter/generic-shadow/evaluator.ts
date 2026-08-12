import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  compareCanonicalText,
  computeFinaleSemanticOutcomeHash,
  isSha256,
  validateSangtianFinaleInputV1,
  validateSangtianPressureFinaleDecisionV1,
  type CausalEdgeV1,
  type SangtianFinaleInputV1,
  type SangtianPressureFinaleDecisionV1,
  type SeatIdV1,
  type TrackIdV1,
} from "@ai-story/shared";
import {
  compareGenericFinaleShadowV1,
  type FinaleShadowComparisonV1,
  type GenericFinaleShadowCandidateV1,
} from "@ai-story/templates";

export const PRESSURE_GENERIC_SHADOW_ENGINE_VERSION_V1 =
  "pressure-generic-shadow-v1" as const;

type TrackValuesV1 = Readonly<Record<TrackIdV1, number>>;

/**
 * Shadow-owned declarative projection copied from the accepted outcome
 * semantics, not from the authoritative evaluator. Deliberate drift between
 * the two tables is therefore visible in the comparison report.
 */
const PRESSURE_GENERIC_WORLD_RULES_V1 = Object.freeze([
  rule("EAST_SOUTH_COLLAPSE", 1, (tracks) => (
    tracks.civilian_land <= -2 && tracks.fiscal_military <= -2
  )),
  rule("TRUTH_WITH_POLITICAL_SHOCK", 2, (tracks) => (
    tracks.evidence_responsibility >= 2 && tracks.court_imperial_face <= -2
  )),
  rule("BALANCED_SURVIVAL", 3, (tracks) => (
    TRACK_IDS_V1.every((trackId) => tracks[trackId] >= 2)
  )),
  rule("FISCAL_ORDER_AT_CIVIL_COST", 4, (tracks) => (
    tracks.fiscal_military >= 2 && tracks.civilian_land <= -2
  )),
  rule("CIVIL_RELIEF_AT_WAR_COST", 5, (tracks) => (
    tracks.civilian_land >= 2 && tracks.fiscal_military <= -2
  )),
  rule("SCAPEGOAT_STABILITY", 6, (tracks) => (
    tracks.evidence_responsibility <= -2 && tracks.court_imperial_face >= 2
  )),
  rule("UNRESOLVED_COMPROMISE", 7, () => true),
]);

const PRESSURE_GENERIC_SEAT_RULES_V1: Readonly<Record<
  SeatIdV1,
  { ruleRef: string; scoreTrackIds: readonly TrackIdV1[] }
>> = Object.freeze({
  cabinet_finance: seatRule(
    "seat.cabinet_finance.fiscal_and_court_floor",
    ["fiscal_military", "court_imperial_face"],
  ),
  jiangnan_merchant: seatRule(
    "seat.jiangnan_merchant.civil_and_fiscal_floor",
    ["civilian_land", "fiscal_military"],
  ),
  qingliu_law: seatRule(
    "seat.qingliu_law.evidence_floor",
    ["evidence_responsibility"],
  ),
  sili_weaving: seatRule(
    "seat.sili_weaving.silk_and_court_floor",
    ["mulberry_silk", "court_imperial_face"],
  ),
  zhejiang_administration: seatRule(
    "seat.zhejiang_administration.civil_and_court_floor",
    ["civilian_land", "court_imperial_face"],
  ),
  zhejiang_governor: seatRule(
    "seat.zhejiang_governor.civil_and_fiscal_floor",
    ["civilian_land", "fiscal_military"],
  ),
});

export const PRESSURE_GENERIC_SHADOW_ERROR_CODES_V1 = Object.freeze({
  SOURCE_INPUT_HASH_INVALID: "PRESSURE_GENERIC_SHADOW_SOURCE_INPUT_HASH_INVALID",
  SOURCE_INPUT_HASH_MISMATCH: "PRESSURE_GENERIC_SHADOW_SOURCE_INPUT_HASH_MISMATCH",
  WORLD_OUTCOME_UNRESOLVED: "PRESSURE_GENERIC_SHADOW_WORLD_OUTCOME_UNRESOLVED",
} as const);

type PressureGenericShadowErrorCodeV1 =
  (typeof PRESSURE_GENERIC_SHADOW_ERROR_CODES_V1)[keyof typeof PRESSURE_GENERIC_SHADOW_ERROR_CODES_V1];

export class PressureGenericShadowEvaluationErrorV1 extends Error {
  constructor(
    readonly code: PressureGenericShadowErrorCodeV1,
    readonly path: string,
  ) {
    super(`${code}:${path}`);
    this.name = "PressureGenericShadowEvaluationErrorV1";
  }
}

export interface EvaluatePressureGenericShadowCandidateInputV1 {
  finaleInput: SangtianFinaleInputV1;
  sourceInputHash: string;
}

export interface EvaluatePressureGenericShadowComparisonInputV1
extends EvaluatePressureGenericShadowCandidateInputV1 {
  authoritativeDecision: SangtianPressureFinaleDecisionV1;
}

export interface PressureGenericShadowEvaluationV1 {
  candidate: GenericFinaleShadowCandidateV1;
  comparison: FinaleShadowComparisonV1;
}

export type PressureGenericShadowObservationV1 =
  | ({ status: "MATCH" | "MISMATCH" } & PressureGenericShadowEvaluationV1)
  | {
    status: "FAILED_ISOLATED";
    candidate: null;
    comparison: null;
    errorCode: string;
  };

/**
 * A deterministic, read-only Pressure projection into the Generic shadow
 * contract. It consumes only the frozen Finale input and never receives an
 * authority writer or the authoritative decision it is intended to shadow.
 */
export function evaluatePressureGenericShadowCandidateV1(
  value: Readonly<EvaluatePressureGenericShadowCandidateInputV1>,
): GenericFinaleShadowCandidateV1 {
  const input = validateSangtianFinaleInputV1(value.finaleInput);
  assertSourceInputHash(value.sourceInputHash, input.inputHash);
  const world = input.finalWorldState;
  const trackValues = world.tracks.values;
  const selectedOutcome = PRESSURE_GENERIC_WORLD_RULES_V1
    .slice()
    .sort((left, right) => left.priority - right.priority)
    .find((rule) => rule.matches(trackValues));
  if (!selectedOutcome) {
    throw new PressureGenericShadowEvaluationErrorV1(
      PRESSURE_GENERIC_SHADOW_ERROR_CODES_V1.WORLD_OUTCOME_UNRESOLVED,
      "finaleInput.finalWorldState.tracks",
    );
  }

  const allEdges = collectCausalEdges(input);
  const allEvidenceRefs = sortedUnique([
    ...allEdges.flatMap((edge) => edge.evidenceRefs),
    ...world.evidence.flatMap((item) => [item.evidenceId, ...item.supportsFactRefs]),
  ]);
  const tracks = TRACK_IDS_V1.map((trackId) => ({
    trackId,
    level: trackLevel(trackValues[trackId]),
    evidenceRefs: evidenceForTrack(trackId, allEdges, allEvidenceRefs),
  }));
  const seats = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
    const rule = PRESSURE_GENERIC_SEAT_RULES_V1[seatId];
    const score = Math.min(...rule.scoreTrackIds.map((trackId) => trackValues[trackId]));
    const arc = world.seatArcs[seatId];
    const responsibilityRefs = world.responsibilities
      .filter((item) => item.subjectSeatId === seatId)
      .flatMap((item) => [item.responsibilityId, ...item.sourceFactRefs]);
    const seatFacts = sortedUnique([
      ...arc.gainRefs,
      ...arc.lossRefs,
      ...arc.costRefs,
      ...responsibilityRefs,
    ]);
    return {
      seatId,
      verdict: seatVerdict(score),
      gainRefs: sortedUnique(arc.gainRefs),
      lossRefs: sortedUnique([...arc.lossRefs, ...arc.costRefs]),
      causeRefs: sortedUnique([
        rule.ruleRef,
        ...seatFacts,
        ...relatedCausalRefs(allEdges, seatFacts),
      ]),
    };
  });
  const semanticOutcomeHash = computeFinaleSemanticOutcomeHash({
    worldOutcome: {
      outcomeId: selectedOutcome.outcomeId,
      titleKey: `finale.world.${selectedOutcome.outcomeId}.title`,
      verdictLineKey: `finale.world.${selectedOutcome.outcomeId}.verdict_line`,
    },
    tracks,
    seats,
    objectOutcomeRefs: sortedUnique(world.objects.flatMap((item) => [
      `object.${item.objectId}.v${item.version}.${item.stateCode}`,
      ...item.factRefs,
    ])),
    evidenceAndResponsibilityRefs: sortedUnique([
      ...world.evidence.flatMap((item) => [item.evidenceId, ...item.supportsFactRefs]),
      ...world.responsibilities.flatMap((item) => [
        item.responsibilityId,
        ...item.sourceFactRefs,
      ]),
    ]),
  });
  return deepFreeze({
    schemaVersion: "generic_finale_shadow_candidate_v1",
    shadowEngineVersion: PRESSURE_GENERIC_SHADOW_ENGINE_VERSION_V1,
    sourceInputHash: value.sourceInputHash,
    worldOutcomeId: selectedOutcome.outcomeId,
    seatVerdicts: seats.map((seat) => ({ seatId: seat.seatId, verdict: seat.verdict })),
    semanticOutcomeHash,
  });
}

export function evaluatePressureGenericShadowComparisonV1(
  value: Readonly<EvaluatePressureGenericShadowComparisonInputV1>,
): PressureGenericShadowEvaluationV1 {
  const input = validateSangtianFinaleInputV1(value.finaleInput);
  const authoritative = validateSangtianPressureFinaleDecisionV1(
    value.authoritativeDecision,
    input,
  );
  const candidate = evaluatePressureGenericShadowCandidateV1({
    finaleInput: input,
    sourceInputHash: value.sourceInputHash,
  });
  return deepFreeze({
    candidate,
    comparison: compareGenericFinaleShadowV1(authoritative, input, candidate),
  });
}

/** Converts every shadow failure into an observation; it cannot veto Finale. */
export function observePressureGenericShadowV1(
  value: Readonly<EvaluatePressureGenericShadowComparisonInputV1>,
): PressureGenericShadowObservationV1 {
  try {
    const evaluated = evaluatePressureGenericShadowComparisonV1(value);
    return {
      status: evaluated.comparison.matches ? "MATCH" : "MISMATCH",
      ...evaluated,
    };
  } catch (error) {
    return {
      status: "FAILED_ISOLATED",
      candidate: null,
      comparison: null,
      errorCode: error instanceof PressureGenericShadowEvaluationErrorV1
        ? error.code
        : "PRESSURE_GENERIC_SHADOW_EVALUATION_FAILED",
    };
  }
}

function assertSourceInputHash(sourceInputHash: string, expected: string): void {
  if (!isSha256(sourceInputHash)) {
    throw new PressureGenericShadowEvaluationErrorV1(
      PRESSURE_GENERIC_SHADOW_ERROR_CODES_V1.SOURCE_INPUT_HASH_INVALID,
      "sourceInputHash",
    );
  }
  if (sourceInputHash !== expected) {
    throw new PressureGenericShadowEvaluationErrorV1(
      PRESSURE_GENERIC_SHADOW_ERROR_CODES_V1.SOURCE_INPUT_HASH_MISMATCH,
      "sourceInputHash",
    );
  }
}

function rule(
  outcomeId: string,
  priority: number,
  matches: (tracks: TrackValuesV1) => boolean,
) {
  return Object.freeze({ outcomeId, priority, matches });
}

function seatRule(ruleRef: string, scoreTrackIds: readonly TrackIdV1[]) {
  return Object.freeze({ ruleRef, scoreTrackIds: Object.freeze(scoreTrackIds) });
}

function collectCausalEdges(input: SangtianFinaleInputV1): CausalEdgeV1[] {
  const byIdentity = new Map<string, CausalEdgeV1>();
  for (const edge of [
    ...input.causalEdges,
    ...input.frozenChapterBundles.flatMap((bundle) => bundle.causalEdges),
  ]) {
    const identity = `${edge.causeRef}\u0000${edge.effectRef}\u0000${edge.relation}`;
    if (!byIdentity.has(identity)) byIdentity.set(identity, edge);
  }
  return [...byIdentity.entries()]
    .sort(([left], [right]) => compareCanonicalText(left, right))
    .map(([, edge]) => edge);
}

function evidenceForTrack(
  trackId: TrackIdV1,
  edges: readonly CausalEdgeV1[],
  fallbackEvidenceRefs: readonly string[],
): string[] {
  const names = new Set([trackId, `track.${trackId}`]);
  const direct = edges
    .filter((edge) => names.has(edge.causeRef) || names.has(edge.effectRef))
    .flatMap((edge) => edge.evidenceRefs);
  return sortedUnique(direct.length ? direct : fallbackEvidenceRefs);
}

function relatedCausalRefs(
  edges: readonly CausalEdgeV1[],
  seatFacts: readonly string[],
): string[] {
  const facts = new Set(seatFacts);
  return edges
    .filter((edge) => (
      facts.has(edge.causeRef)
      || facts.has(edge.effectRef)
      || edge.evidenceRefs.some((ref) => facts.has(ref))
    ))
    .flatMap((edge) => [edge.causeRef, edge.effectRef, ...edge.evidenceRefs]);
}

function trackLevel(value: number): "LOW" | "MID" | "HIGH" {
  if (value >= 2) return "HIGH";
  if (value <= -2) return "LOW";
  return "MID";
}

function seatVerdict(value: number): "WIN" | "COSTLY_WIN" | "LOSS" {
  if (value >= 2) return "WIN";
  if (value <= -2) return "LOSS";
  return "COSTLY_WIN";
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCanonicalText);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
