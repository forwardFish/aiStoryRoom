import type { ContentReview } from "./story-content";

const HARD_PUBLICATION_ISSUES = new Set([
  "INTERNAL_ENGINE_TOKEN_LEAKED",
  "RULE_SUMMARY_LEAKED",
  "TRUNCATED_STORY_FRAGMENT",
  "DUPLICATE_SENTENCE_PUNCTUATION",
]);

/**
 * OPENOVEL_ROLE_V1 already validates provider output as story prose before it
 * commits role Canon. The legacy item scorer is useful telemetry, but its
 * literal role/scene/action overlap rules must not become a second publication
 * authority. P03 established the same boundary for Solo Story V2.
 */
export function acceptOpenNovelRolePublicationReview(
  review: ContentReview,
  runtimeVerified: boolean,
): ContentReview {
  if (!runtimeVerified || review.status === "PASS") return review;

  const hardIssues = review.issues.filter(isHardPublicationIssue);
  return {
    ...review,
    status: hardIssues.length ? "FAIL" : "PASS",
    scores: {
      ...review.scores,
      runtimeSurfaceContract: 5,
      legacyLexicalShadowCount: review.issues.length - hardIssues.length,
    },
    issues: review.issues.map((issue) => (
      isHardPublicationIssue(issue) ? issue : `SHADOW_LEGACY_LEXICAL:${issue}`
    )),
  };
}

function isHardPublicationIssue(issue: string) {
  return HARD_PUBLICATION_ISSUES.has(issue)
    || issue.startsWith("INTERNAL_ENGINE_TOKEN_LEAKED:")
    || issue.startsWith("RULE_SUMMARY_LEAKED:");
}
