import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openovelPaths } from "../paths";
import { buildLandRecordReviewFixture, type PriorShadowArtifact } from "../selected-decision-transition";
import { runOneShadowTurn } from "../shadow-turn-runner";

async function main() {
  const decisionId = String(process.env.OPENOVEL_SELECTED_DECISION_ID || "").trim();
  if (decisionId !== "d1") throw new Error(`OPENOVEL_SELECTED_DECISION_ID must be d1, got ${decisionId || "empty"}.`);
  const paths = openovelPaths();
  const priorArtifactId = String(process.env.OPENOVEL_PRIOR_ARTIFACT_ID || "").trim();
  const priorPath = priorArtifactId
    ? join(paths.outputRoot, `${priorArtifactId}.json`)
    : join(paths.outputRoot, "shadow-turn-latest.json");
  const prior = JSON.parse(readFileSync(priorPath, "utf8")) as PriorShadowArtifact;
  const fixture = buildLandRecordReviewFixture(prior, decisionId);
  const result = await runOneShadowTurn(paths.repoRoot, fixture);
  if (!result.artifact.validation.ok || !result.artifact.qualityRubric.overallPassed) {
    console.error(`LAND_RECORD_SHADOW_TURN_FAIL calls=${result.artifact.provider.providerCallCount} artifact=${result.artifactPath}`);
    if (!result.artifact.validation.ok) {
      for (const issue of result.artifact.validation.issues) console.error(`${issue.code}: ${issue.message}`);
    }
    for (const [criterion, outcome] of Object.entries(result.artifact.qualityRubric.criteria)) {
      if (!outcome.passed) console.error(`RUBRIC_FAIL ${criterion}: ${outcome.failureCodes.join(",") || "required evidence missing"}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`LAND_RECORD_SHADOW_TURN_PASS calls=${result.artifact.provider.providerCallCount} artifact=${result.artifactPath}`);
  console.log("STAGE_GATE=AWAITING_USER_STORY_CONFIRMATION SOLO_TAKEOVER=false MULTIPLAYER=false");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
