import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prettyJson } from "../canonical";
import { openovelPaths } from "../paths";

const paths = openovelPaths();
const latestPath = join(paths.outputRoot, "shadow-turn-latest.json");
const artifact = JSON.parse(readFileSync(latestPath, "utf8")) as any;
if (!artifact.validation?.ok || !artifact.qualityRubric?.overallPassed || artifact.gates?.stageStatus !== "AWAITING_USER_STORY_CONFIRMATION") {
  throw new Error(`STORY_APPROVAL_ARTIFACT_NOT_ELIGIBLE: ${artifact.artifactId || "unknown"}`);
}
artifact.userReview = {
  status: "APPROVED",
  reviewedAt: new Date().toISOString(),
  source: "explicit_user_confirmation_in_codex_thread"
};
artifact.gates.stageStatus = "USER_STORY_APPROVED_SHADOW_CONTINUATION";
artifact.gates.soloTakeoverEligible = false;
artifact.gates.multiplayerEligible = false;
const artifactPath = join(paths.outputRoot, `${artifact.artifactId}.json`);
writeFileSync(artifactPath, prettyJson(artifact), "utf8");
writeFileSync(latestPath, prettyJson(artifact), "utf8");
console.log(`STORY_APPROVAL_RECORDED artifact=${artifactPath} soloTakeover=false`);
