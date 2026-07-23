import { resolve } from "node:path";
import { readJson, repoRoot, validateWithSchema } from "./lib/contract-utils.mjs";

const profilePath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(repoRoot, "packages/templates/authoring/sangtian/narrative/style-profile.approved.json");
const profile = await readJson(profilePath);
const schema = await validateWithSchema("narrative-style-profile-v1", profile);
const errors = schema.errors.map((error) => `${error.instancePath || "/"} ${error.message}`);

if (profile.narrativeBudget?.minCharacters >= profile.narrativeBudget?.maxCharacters) {
  errors.push("narrativeBudget.minCharacters must be smaller than maxCharacters");
}

const requiredVoices = [
  "actor.zhejiang_governor",
  "actor.zhejiang_xunfu",
  "actor.qingliu_magistrate",
  "actor.jiangnan_merchant_head",
  "actor.reform_clerk",
];
for (const actorRef of requiredVoices) {
  if (!Array.isArray(profile.characterVoiceAnchors?.[actorRef]) || profile.characterVoiceAnchors[actorRef].length < 2) {
    errors.push(`Missing at least two voice anchors for ${actorRef}`);
  }
}

if (String(profile.version).includes("draft")) errors.push("style profile version is still draft");
if (String(profile.reviewerId).startsWith("PENDING")) errors.push("style profile has not passed independent review");

console.log(JSON.stringify({
  profilePath,
  profileId: profile.profileId,
  version: profile.version,
  schemaValid: schema.valid,
  errors,
  verdict: errors.length === 0 ? "PASS" : "FAIL",
}, null, 2));
if (errors.length > 0) process.exitCode = 1;
