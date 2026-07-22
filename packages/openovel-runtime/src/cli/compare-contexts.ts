import { writeContextComparison } from "../comparison";

const result = writeContextComparison();
const shadow = result.report.shadow;
if (
  !shadow.playerActionLast
  || shadow.forbiddenDisclosureMatches.length
  || shadow.validationPolicyLeakCount
  || shadow.presetDecisionAnswerCount
) {
  console.error(
    `CONTEXT_COMPARISON_FAIL playerActionLast=${shadow.playerActionLast}`
    + ` forbidden=${shadow.forbiddenDisclosureMatches.length}`
    + ` policyLeaks=${shadow.validationPolicyLeakCount}`
    + ` presetAnswers=${shadow.presetDecisionAnswerCount}`
  );
  process.exitCode = 1;
} else {
  console.log(
    `CONTEXT_COMPARISON_PASS writerClaims=${shadow.sourceClaimCitationCount}`
    + ` auditClaims=${shadow.auditSourceClaimCitationCount}`
    + ` canonEntries=${shadow.minimalCanonEntryCount}`
    + ` serverGroundingClaims=${shadow.serverGroundingClaimCount}`
    + ` report=${result.markdownPath}`
  );
}
