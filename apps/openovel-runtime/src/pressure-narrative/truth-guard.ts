import { hashNarrativeValue } from "./canonical.js";
import type {
  AudienceSafeClaimV1,
  NarrativeContextV1,
  NarrativeRenderCandidateV1,
  NarrativeTruthReportV1,
} from "./contracts.js";
import { reviewPressureNarrativeOutputSurfaceV1 } from "./output-surface-guard.js";

export class NarrativeTruthGuardV1 {
  validate(
    context: NarrativeContextV1,
    candidate: NarrativeRenderCandidateV1,
    guardVersion: string,
  ): NarrativeTruthReportV1 {
    const issues = new Set<string>();
    const surfaceReview = reviewPressureNarrativeOutputSurfaceV1(candidate.text);
    for (const issueCode of surfaceReview.issueCodes) issues.add(issueCode);
    const allowedFactIds = new Set(context.facts.map((fact) => fact.factId));
    for (const ref of candidate.usedFactRefs) {
      if (!allowedFactIds.has(ref)) issues.add("FACT_REF_NOT_AUDIENCE_SAFE");
    }

    const allowedClaims = new Map(
      context.allowedClaims.map((claim) => [claimKey(claim), claim] as const),
    );
    const suppliedClaims = new Set<string>();
    for (const claim of candidate.claims) {
      const key = claimKey(claim);
      suppliedClaims.add(key);
      const allowed = allowedClaims.get(key);
      if (!allowed || allowed.statement !== claim.statement) {
        issues.add("CLAIM_NOT_AUDIENCE_SAFE");
      }
      if (!candidate.text.includes(claim.statement)) {
        issues.add("CLAIM_NOT_PRESENT_IN_TEXT");
      }
      if (claim.kind === "FACT" && !candidate.usedFactRefs.includes(claim.refId)) {
        issues.add("FACT_CLAIM_NOT_DECLARED_IN_USED_REFS");
      }
    }
    for (const claim of context.allowedClaims) {
      if (claim.required && !suppliedClaims.has(claimKey(claim))) {
        issues.add("REQUIRED_CLAIM_MISSING");
      }
    }

    const allowedVerdictWords = new Set(
      context.allowedClaims
        .filter((claim) => claim.kind === "VERDICT")
        .flatMap((claim) => claim.statement.match(/\b(?:WIN|COSTLY_WIN|LOSS)\b/g) ?? []),
    );
    for (const verdict of candidate.text.match(/\b(?:WIN|COSTLY_WIN|LOSS)\b/g) ?? []) {
      if (!allowedVerdictWords.has(verdict)) issues.add("FABRICATED_VERDICT");
    }

    const issueCodes = [...issues].sort();
    const reportContent = {
      accepted: issueCodes.length === 0,
      guardVersion,
      issueCodes,
      usedFactRefs: [...candidate.usedFactRefs],
    };
    return {
      ...reportContent,
      reportHash: hashNarrativeValue(reportContent),
    };
  }
}

function claimKey(claim: Pick<AudienceSafeClaimV1, "kind" | "refId">): string {
  return `${claim.kind}\u0000${claim.refId}`;
}
