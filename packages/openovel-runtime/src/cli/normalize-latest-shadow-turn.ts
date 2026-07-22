import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prettyJson, sha256Canonical } from "../canonical";
import { compareContexts } from "../comparison";
import { normalizeAndValidateShadowOutput } from "../shadow-output-normalizer";
import { openovelPaths } from "../paths";
import { buildShadowQualityRubric } from "../shadow-quality-rubric";

const paths = openovelPaths();
const latestPath = join(paths.outputRoot, "shadow-turn-latest.json");
const artifact = JSON.parse(readFileSync(latestPath, "utf8")) as any;
const fixture = artifact.fixtureSnapshot;
if (!fixture || artifact.fixtureSnapshotHash !== sha256Canonical(fixture)) {
  throw new Error(`NORMALIZE_FIXTURE_SNAPSHOT_INVALID: ${artifact.artifactId || "unknown"}`);
}
if (artifact.provider?.providerCallCount !== 1 || artifact.provider?.responseStatus !== 200) {
  throw new Error(`NORMALIZE_PROVIDER_PROOF_INVALID: ${artifact.artifactId || "unknown"}`);
}
const comparison = compareContexts(paths.repoRoot, fixture);
const normalized = normalizeAndValidateShadowOutput(String(artifact.rawText || ""), comparison.shadow, fixture);
const qualityRubric = buildShadowQualityRubric(normalized.validation, fixture);
if (!qualityRubric.overallPassed || !normalized.normalization) {
  throw new Error(`NORMALIZE_NOT_APPLICABLE: ${artifact.artifactId || "unknown"}`);
}
artifact.normalizedText = normalized.normalizedText;
artifact.normalization = normalized.normalization;
artifact.validation = normalized.validation;
artifact.qualityRubric = qualityRubric;
artifact.auditedAt = new Date().toISOString();
artifact.gates.stageStatus = "AWAITING_USER_STORY_CONFIRMATION";
artifact.gates.soloTakeoverEligible = false;
artifact.gates.multiplayerEligible = false;
const artifactPath = join(paths.outputRoot, `${artifact.artifactId}.json`);
writeFileSync(artifactPath, prettyJson(artifact), "utf8");
writeFileSync(latestPath, prettyJson(artifact), "utf8");
console.log(`SHADOW_NORMALIZATION_PASS rule=${artifact.normalization.ruleId} artifact=${artifactPath}`);
