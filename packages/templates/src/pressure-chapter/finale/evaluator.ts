import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  compareCanonicalText,
  computeFinaleExecutionFingerprint,
  computeFinaleSemanticOutcomeHash,
  validateSangtianPressureFinaleDecisionV1,
  type CausalEdgeV1,
  type SangtianPressureFinaleDecisionV1,
  type TrackIdV1,
} from "@ai-story/shared";
import {
  SANGTIAN_SEAT_VERDICT_RULES_V1,
  SANGTIAN_WORLD_OUTCOME_RULES_V1,
} from "./content-rules";
import {
  SANGTIAN_FINALE_DOMAIN_ERROR_CODES as ERROR,
  failSangtianFinaleDomain,
} from "./errors";
import type {
  FinaleSeatVerdictV1,
  FinaleTrackLevelV1,
  SangtianFinaleEvaluationRequestV1,
} from "./types";
import { validateSangtianFinaleEvaluationRequestV1 } from "./validator";

export const SANGTIAN_FINALE_AUTHORITY_V1 = "SANGTIAN_CONTENT_RULES" as const;

/**
 * Pure deterministic evaluator. It has no Provider/DB/Generic parameter and
 * performs no persistence; only a validated Frozen content policy may select
 * the authoritative result.
 */
export function evaluateSangtianPressureFinaleV1(
  value: SangtianFinaleEvaluationRequestV1,
): SangtianPressureFinaleDecisionV1 {
  const request = validateSangtianFinaleEvaluationRequestV1(value);
  const world = request.input.finalWorldState;
  const trackValues = world.tracks.values;
  const selectedOutcomeRule = SANGTIAN_WORLD_OUTCOME_RULES_V1
    .filter((rule) => request.policy.compiledRules.worldOutcomeRuleRefs.includes(rule.ruleRef))
    .sort((left, right) => left.priority - right.priority)
    .find((rule) => rule.matches(trackValues));
  if (!selectedOutcomeRule) {
    failSangtianFinaleDomain(ERROR.NO_WORLD_OUTCOME, "finaleEvaluation.worldOutcome");
  }

  const allEdges = collectCausalEdges(request.input);
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
    const rule = SANGTIAN_SEAT_VERDICT_RULES_V1[seatId];
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
  const objectOutcomeRefs = sortedUnique(world.objects.flatMap((item) => [
    `object.${item.objectId}.v${item.version}.${item.stateCode}`,
    ...item.factRefs,
  ]));
  const evidenceAndResponsibilityRefs = sortedUnique([
    ...world.evidence.flatMap((item) => [item.evidenceId, ...item.supportsFactRefs]),
    ...world.responsibilities.flatMap((item) => [
      item.responsibilityId,
      ...item.sourceFactRefs,
    ]),
  ]);
  const base = {
    schemaVersion: "sangtian_pressure_finale_decision_v1" as const,
    runId: request.input.runId,
    runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1" as const,
    policyVersion: request.policy.policyVersion,
    packageSha256: request.policy.contentPackageSha256,
    routeHash: request.input.routeHash,
    genesisHash: request.input.genesisHash,
    frozenChapterBundleHashes: request.input.frozenChapterBundles.map(
      (bundle) => bundle.bundleHash,
    ),
    worldOutcome: {
      outcomeId: selectedOutcomeRule.outcomeId,
      titleKey: `finale.world.${selectedOutcomeRule.outcomeId}.title`,
      verdictLineKey: `finale.world.${selectedOutcomeRule.outcomeId}.verdict_line`,
    },
    tracks,
    seats,
    objectOutcomeRefs,
    evidenceAndResponsibilityRefs,
    decidedAt: request.decidedAt,
  };
  const semanticOutcomeHash = computeFinaleSemanticOutcomeHash(base);
  const withSemantic = { ...base, semanticOutcomeHash };
  const decision: SangtianPressureFinaleDecisionV1 = {
    ...withSemantic,
    executionFingerprint: computeFinaleExecutionFingerprint(withSemantic),
  };
  return validateSangtianPressureFinaleDecisionV1(
    decision,
    request.input,
    request.policy,
  );
}

function trackLevel(value: number): FinaleTrackLevelV1 {
  if (value >= 2) return "HIGH";
  if (value <= -2) return "LOW";
  return "MID";
}

function seatVerdict(score: number): FinaleSeatVerdictV1 {
  if (score >= 2) return "WIN";
  if (score <= -2) return "LOSS";
  return "COSTLY_WIN";
}

function collectCausalEdges(
  input: SangtianFinaleEvaluationRequestV1["input"],
): CausalEdgeV1[] {
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

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCanonicalText);
}
