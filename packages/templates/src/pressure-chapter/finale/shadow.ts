import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  sha256Canonical,
  validateSangtianPressureFinaleDecisionV1,
  type SangtianFinaleInputV1,
  type SangtianPressureFinaleDecisionV1,
} from "@ai-story/shared";
import type {
  FinaleShadowComparisonV1,
  FinaleShadowMismatchV1,
  GenericFinaleShadowCandidateV1,
} from "./types";

/**
 * Generic can only compare a shadow candidate. This function returns a report,
 * never a replacement decision and never mutates the authoritative object.
 */
export function compareGenericFinaleShadowV1(
  authoritative: SangtianPressureFinaleDecisionV1,
  input: Pick<SangtianFinaleInputV1, "inputHash">,
  shadow: GenericFinaleShadowCandidateV1,
): FinaleShadowComparisonV1 {
  validateSangtianPressureFinaleDecisionV1(authoritative);
  const mismatches: FinaleShadowMismatchV1[] = [];
  if (shadow.schemaVersion !== "generic_finale_shadow_candidate_v1") {
    mismatch(mismatches, "SHADOW_SCHEMA_INVALID", "schemaVersion", authoritative.schemaVersion, shadow.schemaVersion);
  }
  if (shadow.sourceInputHash !== input.inputHash) {
    mismatch(mismatches, "SOURCE_INPUT_HASH_MISMATCH", "sourceInputHash", input.inputHash, shadow.sourceInputHash);
  }
  if (shadow.worldOutcomeId !== authoritative.worldOutcome.outcomeId) {
    mismatch(
      mismatches,
      "WORLD_OUTCOME_MISMATCH",
      "worldOutcomeId",
      authoritative.worldOutcome.outcomeId,
      shadow.worldOutcomeId,
    );
  }
  if (shadow.semanticOutcomeHash !== authoritative.semanticOutcomeHash) {
    mismatch(
      mismatches,
      "SEMANTIC_OUTCOME_HASH_MISMATCH",
      "semanticOutcomeHash",
      authoritative.semanticOutcomeHash,
      shadow.semanticOutcomeHash,
    );
  }
  const shadowSeats = new Map<string, string>();
  for (const seat of shadow.seatVerdicts) {
    if (shadowSeats.has(seat.seatId)) {
      mismatch(mismatches, "SHADOW_DUPLICATE_SEAT", `seatVerdicts.${seat.seatId}`, null, seat.verdict);
      continue;
    }
    shadowSeats.set(seat.seatId, seat.verdict);
    if (!PRESSURE_CHAPTER_SEAT_IDS_V1.includes(seat.seatId as never)) {
      mismatch(mismatches, "SHADOW_UNKNOWN_SEAT", `seatVerdicts.${seat.seatId}`, null, seat.verdict);
    }
  }
  for (const seat of authoritative.seats) {
    const shadowVerdict = shadowSeats.get(seat.seatId) ?? null;
    if (shadowVerdict !== seat.verdict) {
      mismatch(
        mismatches,
        shadowVerdict === null ? "SHADOW_SEAT_MISSING" : "SEAT_VERDICT_MISMATCH",
        `seatVerdicts.${seat.seatId}`,
        seat.verdict,
        shadowVerdict,
      );
    }
  }
  mismatches.sort((left, right) => (
    compareCanonicalText(left.path, right.path) || compareCanonicalText(left.code, right.code)
  ));
  const withoutHash = {
    schemaVersion: "sangtian_finale_shadow_comparison_v1" as const,
    authoritativeExecutionFingerprint: authoritative.executionFingerprint,
    shadowEngineVersion: shadow.shadowEngineVersion,
    shadowDecisionHash: sha256Canonical(shadow),
    matches: mismatches.length === 0,
    mismatches,
  };
  return { ...withoutHash, reportHash: sha256Canonical(withoutHash) };
}

function mismatch(
  target: FinaleShadowMismatchV1[],
  code: string,
  path: string,
  authoritative: string | null,
  shadow: string | null,
): void {
  target.push({ code, path, authoritative, shadow });
}
