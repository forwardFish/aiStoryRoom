import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openovelPaths } from "../paths";
import { buildSelectedDecisionFixture, type PriorShadowArtifact } from "../selected-decision-transition";
import { runOneShadowTurn } from "../shadow-turn-runner";
import type { ShadowRuntimeFixture } from "../types";

async function main() {
  const decisionId = String(process.env.OPENOVEL_SELECTED_DECISION_ID || "").trim();
  if (decisionId !== "d1") throw new Error(`OPENOVEL_SELECTED_DECISION_ID must be d1 for this transition, got ${decisionId || "empty"}.`);
  const paths = openovelPaths();
  const base = JSON.parse(readFileSync(paths.fixturePath, "utf8")) as ShadowRuntimeFixture;
  const prior = JSON.parse(readFileSync(join(paths.outputRoot, "shadow-turn-latest.json"), "utf8")) as PriorShadowArtifact;
  const fixture = buildSelectedDecisionFixture(base, prior, decisionId);
  const result = await runOneShadowTurn(paths.repoRoot, fixture);
  if (!result.artifact.qualityRubric.overallPassed) {
    console.error(`SELECTED_SHADOW_TURN_FAIL decision=${decisionId} calls=${result.artifact.provider.providerCallCount} artifact=${result.artifactPath}`);
    for (const issue of "issues" in result.artifact.validation ? result.artifact.validation.issues : []) console.error(`${issue.code}: ${issue.message}`);
    for (const [criterion, outcome] of Object.entries(result.artifact.qualityRubric.criteria)) {
      if (!outcome.passed) console.error(`QUALITY_${criterion.toUpperCase()}_FAILED: ${outcome.failureCodes.join(",") || "criterion not satisfied"}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`SELECTED_SHADOW_TURN_PASS decision=${decisionId} calls=${result.artifact.provider.providerCallCount} artifact=${result.artifactPath}`);
  console.log("STAGE_GATE=AWAITING_USER_STORY_CONFIRMATION SOLO_TAKEOVER=false MULTIPLAYER=false");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
