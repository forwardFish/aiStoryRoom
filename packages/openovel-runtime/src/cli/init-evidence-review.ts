import { compileEvidencePackage } from "../evidence-compiler";
import { readEvidenceReviewQueue, reconcileEvidenceReviewQueue, writeEvidenceReviewQueue } from "../evidence-review";
import { openovelPaths } from "../paths";

const paths = openovelPaths();
const evidencePackage = compileEvidencePackage(paths.repoRoot);
const queue = reconcileEvidenceReviewQueue(evidencePackage, readEvidenceReviewQueue(paths.reviewQueuePath));
writeEvidenceReviewQueue(paths.reviewQueuePath, queue);
console.log(`EVIDENCE_REVIEW_QUEUE_READY items=${queue.items.length} path=${paths.reviewQueuePath}`);
