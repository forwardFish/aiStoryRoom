import { compileEvidencePackage } from "../evidence-compiler";
import { readEvidenceReviewQueue, validateEvidenceReviewQueue } from "../evidence-review";
import { openovelPaths } from "../paths";

const paths = openovelPaths();
const evidencePackage = compileEvidencePackage(paths.repoRoot);
const queue = readEvidenceReviewQueue(paths.reviewQueuePath);
if (!queue) throw new Error(`Evidence review queue is missing. Run evidence:review:init first: ${paths.reviewQueuePath}`);
const report = validateEvidenceReviewQueue(queue, evidencePackage, paths.reviewSchemaPath);
if (!report.valid) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  console.log(`${report.approvalComplete ? "EVIDENCE_REVIEW_APPROVED" : "EVIDENCE_REVIEW_PENDING"} approved=${report.counts.APPROVED} pending=${report.counts.PENDING} rejected=${report.counts.REJECTED}`);
}
