import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { prettyJson, sha256Canonical } from "./canonical";
import type {
  EvidencePackage,
  EvidenceReviewItem,
  EvidenceReviewItemKind,
  EvidenceReviewQueue,
  EvidenceReviewReport,
  ValidationIssue
} from "./types";

export function reconcileEvidenceReviewQueue(
  evidencePackage: EvidencePackage,
  existing: EvidenceReviewQueue | null,
  updatedAt = new Date().toISOString()
): EvidenceReviewQueue {
  const existingByKey = new Map((existing?.items || []).map((item) => [reviewKey(item.itemKind, item.itemId), item]));
  const items = expectedReviewItems(evidencePackage).map((expected) => {
    const previous = existingByKey.get(reviewKey(expected.itemKind, expected.itemId));
    if (previous?.sourceHash === expected.sourceHash) return { ...previous };
    return expected;
  });
  return {
    schemaVersion: "evidence_review_queue_v1",
    packageId: evidencePackage.manifest.packageId,
    packageVersion: evidencePackage.manifest.packageVersion,
    sourceSha256: evidencePackage.manifest.source.sha256,
    updatedAt,
    items
  };
}

export function validateEvidenceReviewQueue(
  queue: EvidenceReviewQueue,
  evidencePackage: EvidencePackage,
  schemaPath: string
): EvidenceReviewReport {
  const issues: ValidationIssue[] = [];
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false, formats: { "date-time": true } });
  const validate = ajv.compile(schema);
  if (!validate(queue)) {
    for (const error of validate.errors || []) {
      issues.push(issue("REVIEW_SCHEMA_INVALID", `${error.instancePath || "/"} ${error.message || error.keyword}`));
    }
  }
  if (queue.packageId !== evidencePackage.manifest.packageId || queue.packageVersion !== evidencePackage.manifest.packageVersion) {
    issues.push(issue("REVIEW_PACKAGE_MISMATCH", "Review queue package identity does not match the compiled evidence package."));
  }
  if (queue.sourceSha256 !== evidencePackage.manifest.source.sha256) {
    issues.push(issue("REVIEW_SOURCE_HASH_MISMATCH", "Review queue points to a different original source hash."));
  }

  const expected = new Map(expectedReviewItems(evidencePackage).map((item) => [reviewKey(item.itemKind, item.itemId), item]));
  const seen = new Set<string>();
  for (const item of queue.items) {
    const key = reviewKey(item.itemKind, item.itemId);
    if (seen.has(key)) issues.push(issue("REVIEW_ITEM_DUPLICATE", `Duplicate review item ${key}.`, item.itemId));
    seen.add(key);
    const expectedItem = expected.get(key);
    if (!expectedItem) {
      issues.push(issue("REVIEW_ITEM_UNKNOWN", `Review item ${key} is not in the compiled evidence package.`, item.itemId));
      continue;
    }
    if (item.sourceHash !== expectedItem.sourceHash) {
      issues.push(issue("REVIEW_ITEM_STALE", `Review item ${key} changed after its review state was recorded.`, item.itemId));
    }
    if (item.status !== "PENDING" && (!item.reviewerId || !item.reviewedAt)) {
      issues.push(issue("REVIEW_AUDIT_FIELDS_MISSING", `${key} requires reviewerId and reviewedAt.`, item.itemId));
    }
    if (item.status === "REJECTED" && !item.rejectionReason) {
      issues.push(issue("REVIEW_REJECTION_REASON_MISSING", `${key} requires rejectionReason.`, item.itemId));
    }
  }
  for (const [key, expectedItem] of expected) {
    if (!seen.has(key)) issues.push(issue("REVIEW_ITEM_MISSING", `Missing review item ${key}.`, expectedItem.itemId));
  }
  const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
  for (const item of queue.items) counts[item.status] += 1;
  return {
    valid: !issues.some((item) => item.severity === "error"),
    approvalComplete: !issues.length && counts.PENDING === 0 && counts.REJECTED === 0,
    counts,
    issues
  };
}

export function readEvidenceReviewQueue(path: string): EvidenceReviewQueue | null {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as EvidenceReviewQueue : null;
}

export function writeEvidenceReviewQueue(path: string, queue: EvidenceReviewQueue): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, prettyJson(queue), "utf8");
}

function expectedReviewItems(evidencePackage: EvidencePackage): EvidenceReviewItem[] {
  return [
    ...evidencePackage.scenes.map((scene) => pending("SCENE", scene.sceneId, scene)),
    ...evidencePackage.claims.map((claim) => pending("CLAIM", claim.claimId, claim)),
    ...evidencePackage.continuity.map((continuity) => pending("CONTINUITY", continuity.chapterId, continuity))
  ];
}

function pending(itemKind: EvidenceReviewItemKind, itemId: string, value: unknown): EvidenceReviewItem {
  return { itemId, itemKind, sourceHash: sha256Canonical(value), status: "PENDING" };
}

function reviewKey(kind: EvidenceReviewItemKind, id: string): string {
  return `${kind}:${id}`;
}

function issue(code: string, message: string, itemId?: string): ValidationIssue {
  return { severity: "error", code, message, ...(itemId ? { itemId } : {}) };
}
