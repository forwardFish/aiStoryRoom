import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prettyJson, sha256Canonical } from "../canonical";
import { compareContexts } from "../comparison";
import { openovelPaths } from "../paths";
import { buildSelectedDecisionFixture, type PriorShadowArtifact } from "../selected-decision-transition";
import { parseAndValidateShadowOutput } from "../shadow-output-validator";
import { buildShadowQualityRubric } from "../shadow-quality-rubric";
import type { ShadowRuntimeFixture } from "../types";

const priorArtifactId = String(process.env.OPENOVEL_PRIOR_ARTIFACT_ID || "").trim();
if (!priorArtifactId) throw new Error("OPENOVEL_PRIOR_ARTIFACT_ID is required.");
const paths = openovelPaths();
const latestPath = join(paths.outputRoot, "shadow-turn-latest.json");
const artifact = JSON.parse(readFileSync(latestPath, "utf8")) as any;
if (artifact.provider?.providerCallCount !== 1 || artifact.provider?.responseStatus !== 200) {
  throw new Error("SELECTED_ARTIFACT_PROVIDER_PROOF_INVALID");
}
const prior = JSON.parse(readFileSync(join(paths.outputRoot, `${priorArtifactId}.json`), "utf8")) as PriorShadowArtifact;
const base = JSON.parse(readFileSync(paths.fixturePath, "utf8")) as ShadowRuntimeFixture;
const fixture = buildSelectedDecisionFixture(base, prior, "d1");
if (fixture.fixtureId !== artifact.fixtureId) throw new Error("SELECTED_ARTIFACT_FIXTURE_ID_MISMATCH");
const comparison = compareContexts(paths.repoRoot, fixture);
const validation = parseAndValidateShadowOutput(String(artifact.rawText || ""), comparison.shadow, fixture);
const qualityRubric = buildShadowQualityRubric(validation, fixture);
if (!qualityRubric.overallPassed) {
  throw new Error(`SELECTED_ARTIFACT_RECOVERY_REJECTED: ${[
    ...("issues" in validation ? validation.issues : []).map((item) => item.code),
    ...Object.entries(qualityRubric.criteria).filter(([, outcome]) => !outcome.passed).map(([criterion]) => `QUALITY_${criterion.toUpperCase()}`)
  ].join(",")}`);
}
artifact.fixtureSnapshot = fixture;
artifact.fixtureSnapshotHash = sha256Canonical(fixture);
artifact.validation = validation;
artifact.qualityRubric = qualityRubric;
artifact.auditedAt = new Date().toISOString();
artifact.gates.stageStatus = "AWAITING_USER_STORY_CONFIRMATION";
artifact.gates.soloTakeoverEligible = false;
artifact.gates.multiplayerEligible = false;
const artifactPath = join(paths.outputRoot, `${artifact.artifactId}.json`);
writeFileSync(artifactPath, prettyJson(artifact), "utf8");
writeFileSync(latestPath, prettyJson(artifact), "utf8");
console.log(`SELECTED_ARTIFACT_RECOVERY_PASS artifact=${artifactPath} fixtureHash=${artifact.fixtureSnapshotHash}`);
