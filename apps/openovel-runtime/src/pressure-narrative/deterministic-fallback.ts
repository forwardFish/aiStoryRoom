import type {
  NarrativeCandidateClaimV1,
  NarrativeContextV1,
  NarrativeRenderCandidateV1,
} from "./contracts.js";

export class NarrativeFallbackRendererV1 {
  render(context: NarrativeContextV1, _templateVersion: string): NarrativeRenderCandidateV1 {
    const required = context.allowedClaims.filter((claim) => claim.required);
    const selected = required.length > 0
      ? required
      : context.allowedClaims.length > 0
        ? [context.allowedClaims[0]!]
        : [];
    const claims: NarrativeCandidateClaimV1[] = selected
      .map(({ kind, refId, statement }) => ({ kind, refId, statement }))
      .sort((left, right) => claimKey(left) < claimKey(right) ? -1 : claimKey(left) > claimKey(right) ? 1 : 0);
    const factRefs = new Set(
      claims.filter((claim) => claim.kind === "FACT").map((claim) => claim.refId),
    );
    let statements = claims.map((claim) => claim.statement);
    if (statements.length === 0) {
      const fact = context.facts[0];
      if (fact) {
        statements = [fact.text];
        factRefs.add(fact.factId);
      } else {
        statements = [fallbackBoundaryText(context)];
      }
    }
    return {
      // The template version is profile-bound internal metadata and must never
      // be rendered into player-visible prose.
      text: statements.join(" "),
      usedFactRefs: [...factRefs].sort(),
      claims,
    };
  }
}

function claimKey(claim: NarrativeCandidateClaimV1): string {
  return `${claim.kind}\u0000${claim.refId}`;
}

function fallbackBoundaryText(context: NarrativeContextV1): string {
  switch (context.projectionKind) {
    case "GENESIS_NARRATIVE": return "序章已建立。";
    case "BEAT_NARRATIVE": return "本章互动反馈已记录，尚未形成章末结算。";
    case "CHAPTER_NARRATIVE": return "本章唯一结算已经确认。";
    case "FINALE_NARRATIVE": return "权威结局已经确认。";
  }
}
