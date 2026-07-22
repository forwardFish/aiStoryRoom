import { runOneShadowTurn } from "../shadow-turn-runner";

async function main() {
  const result = await runOneShadowTurn();
  const validation = result.artifact.validation;
  const qualityRubric = result.artifact.qualityRubric;
  if (!qualityRubric.overallPassed) {
    console.error(`SHADOW_TURN_FAIL calls=${result.artifact.provider.providerCallCount} artifact=${result.artifactPath}`);
    for (const issue of "issues" in validation ? validation.issues : []) console.error(`${issue.code}: ${issue.message}`);
    for (const [criterion, outcome] of Object.entries(qualityRubric.criteria)) {
      if (!outcome.passed) console.error(`QUALITY_${criterion.toUpperCase()}_FAILED: ${outcome.failureCodes.join(",") || "criterion not satisfied"}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`SHADOW_TURN_PASS calls=${result.artifact.provider.providerCallCount} artifact=${result.artifactPath}`);
    console.log("STAGE_GATE=AWAITING_USER_STORY_CONFIRMATION SOLO_TAKEOVER=false MULTIPLAYER=false");
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
