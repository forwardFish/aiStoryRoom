import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compileEvidencePackage } from "../src/evidence-compiler";
import { validateEvidenceAuthoringSchema } from "../src/evidence-schema-validator";
import { reconcileEvidenceReviewQueue, validateEvidenceReviewQueue } from "../src/evidence-review";
import { validateEvidencePackage } from "../src/evidence-validator";
import { openovelPaths } from "../src/paths";
import { compileWorldBible } from "../src/world-bible-compiler";

test("compiles the canonical source into a deterministic line-addressed evidence package", () => {
  const paths = openovelPaths();
  const first = compileEvidencePackage(paths.repoRoot);
  const second = compileEvidencePackage(paths.repoRoot);
  assert.deepEqual(second, first);
  assert.equal(first.manifest.source.sha256, "04d5e8d4533d86890a79058c25252d33e001668921a2bbd8ffde401cdd2b6238");
  assert.equal(first.chapterIndex.length, 39);
  assert.equal(first.manifest.source.lineCount, 30547);
  assert.equal(first.claims.length, 10);
  assert.deepEqual(first.manifest.coverage.chapterIds, ["DM1566-C01", "DM1566-C02", "DM1566-C03"]);
});

test("preserves epistemic boundaries and validates every source range", () => {
  const paths = openovelPaths();
  const evidencePackage = compileEvidencePackage(paths.repoRoot);
  const report = validateEvidencePackage(evidencePackage, paths.repoRoot);
  assert.equal(report.valid, true, JSON.stringify(report.issues, null, 2));
  for (const claim of evidencePackage.claims) {
    if (["character_statement", "character_belief", "character_intention", "rumor"].includes(claim.type)) {
      assert.notEqual(claim.truthStatus, "supported", claim.claimId);
    }
    assert.match(claim.evidence.excerptSha256, /^[a-f0-9]{64}$/);
  }
  const orderClaim = evidencePackage.claims.find((claim) => claim.claimId === "DM1566-C02-CL004");
  assert.equal(orderClaim?.content.includes("不自动证明执行完成"), true);
});

test("executes the full continuity JSON Schema before evidence compilation", () => {
  const paths = openovelPaths();
  const authoring = JSON.parse(readFileSync(paths.authoringPath, "utf8"));
  assert.doesNotThrow(() => validateEvidenceAuthoringSchema(authoring, paths.authoringSchemaPath));

  const missingConstraint = structuredClone(authoring);
  delete missingConstraint.continuity[0].nextChapterConstraints;
  assert.throws(
    () => validateEvidenceAuthoringSchema(missingConstraint, paths.authoringSchemaPath),
    /AUTHORING_JSON_SCHEMA_INVALID:[\s\S]*nextChapterConstraints/
  );

  const unknownContinuityField = structuredClone(authoring);
  unknownContinuityField.continuity[0].inventedFuture = "不得进入运行时";
  assert.throws(
    () => validateEvidenceAuthoringSchema(unknownContinuityField, paths.authoringSchemaPath),
    /AUTHORING_JSON_SCHEMA_INVALID/
  );
});

test("creates a source-hash-bound human review queue and resets stale approvals", () => {
  const paths = openovelPaths();
  const evidencePackage = compileEvidencePackage(paths.repoRoot);
  const queue = reconcileEvidenceReviewQueue(evidencePackage, null, "2026-07-22T00:00:00.000Z");
  assert.equal(queue.items.length, evidencePackage.scenes.length + evidencePackage.claims.length + evidencePackage.continuity.length);
  assert.ok(queue.items.every((item) => item.status === "PENDING"));
  const pendingReport = validateEvidenceReviewQueue(queue, evidencePackage, paths.reviewSchemaPath);
  assert.equal(pendingReport.valid, true, JSON.stringify(pendingReport.issues));
  assert.equal(pendingReport.approvalComplete, false);

  const approved = structuredClone(queue);
  approved.items[0] = {
    ...approved.items[0],
    status: "APPROVED",
    reviewerId: "reviewer-test",
    reviewedAt: "2026-07-22T00:01:00.000Z"
  };
  const unchanged = reconcileEvidenceReviewQueue(evidencePackage, approved, "2026-07-22T00:02:00.000Z");
  assert.equal(unchanged.items[0]?.status, "APPROVED");

  const changedPackage = structuredClone(evidencePackage);
  changedPackage.scenes[0]!.title += "（修订）";
  const reconciled = reconcileEvidenceReviewQueue(changedPackage, approved, "2026-07-22T00:03:00.000Z");
  assert.equal(reconciled.items[0]?.status, "PENDING");
  assert.equal(reconciled.items[0]?.reviewerId, undefined);
});

test("compiles a deterministic World Bible with future isolation and reverse Source Map", () => {
  const paths = openovelPaths();
  const evidencePackage = compileEvidencePackage(paths.repoRoot);
  const first = compileWorldBible(paths.repoRoot, evidencePackage);
  const second = compileWorldBible(paths.repoRoot, evidencePackage);
  assert.deepEqual(second, first);
  assert.equal(first.reviewGate, "PENDING");
  assert.equal(first.shadowOnly, true);
  assert.ok(first.historicalBaselineClaimIds.includes("DM1566-C01-CL002"));
  assert.ok(first.sourceFutureClaimIds.includes("DM1566-C03-CL002"));
  assert.ok(!first.historicalBaselineClaimIds.includes("DM1566-C03-CL002"));
  assert.equal(first.runtimeFacts.length, 4);
  assert.equal(first.contextCards.length, 2);
  assert.ok(first.sourceMap.some((item) => item.targetType === "RUNTIME_FACT" && item.targetId === "fact_grain_pressure" && item.sourceHashes.length === 3));
  assert.match(first.manifestHash, /^[a-f0-9]{64}$/);

  const fixture = JSON.parse(readFileSync(paths.fixturePath, "utf8"));
  assert.equal(Object.prototype.hasOwnProperty.call(fixture, "facts"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fixture, "relevantScriptCards"), false);
});
