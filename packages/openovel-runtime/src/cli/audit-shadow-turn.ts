import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prettyJson, sha256Canonical } from "../canonical";
import { compareContexts } from "../comparison";
import { openovelPaths } from "../paths";
import { parseAndValidateShadowOutput } from "../shadow-output-validator";
import { buildShadowQualityRubric } from "../shadow-quality-rubric";

const paths = openovelPaths();
const latestPath = join(paths.outputRoot, "shadow-turn-latest.json");
const artifact = JSON.parse(readFileSync(latestPath, "utf8")) as any;
const fixture = artifact.fixtureSnapshot;
if (!fixture) throw new Error(`AUDIT_FIXTURE_SNAPSHOT_MISSING: ${artifact.artifactId}`);
if (artifact.fixtureId !== fixture.fixtureId || artifact.fixtureSnapshotHash !== sha256Canonical(fixture)) {
  throw new Error(`AUDIT_FIXTURE_SNAPSHOT_DRIFT: ${artifact.artifactId}`);
}
const comparison = compareContexts(paths.repoRoot, fixture);
const validation = parseAndValidateShadowOutput(String(artifact.normalizedText || artifact.rawText || ""), comparison.shadow, comparison.fixture);
const qualityRubric = buildShadowQualityRubric(validation, comparison.fixture);
artifact.validation = validation;
artifact.qualityRubric = qualityRubric;
artifact.auditedAt = new Date().toISOString();
artifact.gates.stageStatus = qualityRubric.overallPassed
  ? "AWAITING_USER_STORY_CONFIRMATION"
  : validation.ok
    ? "REJECTED_QUALITY_GATE"
    : "REJECTED_HARD_CONTRACT";
artifact.gates.soloTakeoverEligible = false;
artifact.gates.multiplayerEligible = false;
const artifactPath = join(paths.outputRoot, `${artifact.artifactId}.json`);
writeFileSync(artifactPath, prettyJson(artifact), "utf8");
writeFileSync(latestPath, prettyJson(artifact), "utf8");
console.log(`${qualityRubric.overallPassed ? "SHADOW_AUDIT_PASS" : "SHADOW_AUDIT_REJECT"} artifact=${artifactPath}`);
if (!qualityRubric.overallPassed) {
  for (const issue of "issues" in validation ? validation.issues : []) console.log(`${issue.code}: ${issue.message}`);
  for (const [criterion, outcome] of Object.entries(qualityRubric.criteria)) {
    if (!outcome.passed) console.log(`QUALITY_${criterion.toUpperCase()}_FAILED: ${outcome.failureCodes.join(",") || "criterion not satisfied"}`);
  }
  process.exitCode = 2;
}
