import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const runtimePath = resolve(root, "packages/templates/config/sangtian/story-package/part-one-runtime.json");
const runtime = readJson(runtimePath);
const authoringRoot = resolve(root, "packages/templates/authoring/sangtian");
const evidenceProfiles = readJson(resolve(authoringRoot, "evidence/approved/part-01-v3.evidence-profiles.json"));
const sourceFiles = {
  adapter: readText("apps/openovel-runtime/src/decision-adapter.ts"),
  resolver: readText("apps/openovel-runtime/src/intent-resolver.ts"),
  decisions: readText("apps/openovel-runtime/src/sangtian-decisions.ts"),
  engine: readText("packages/templates/src/story-package/part-one-runtime-engine.ts"),
  reviewer: readText("apps/openovel-runtime/src/scene-review-modules.ts"),
  foreground: readText("apps/openovel-runtime/src/foreground.ts"),
  atomic: readText("apps/openovel-runtime/src/atomic-turn.ts"),
};
const failures = [];
const pass = (condition, code, details = null) => {
  if (!condition) failures.push({ code, details });
};

const assets = array(runtime.assets);
const sections = array(runtime.sections);
const requirements = array(runtime.requirements);
const patterns = assets.filter((asset) => asset.assetType === "NARRATIVE_SCENE_PATTERN");
const evidenceAssets = assets.filter((asset) => asset.assetType === "EVIDENCE_PROFILE");
const kernels = assets.filter((asset) => asset.assetType === "DECISION_KERNEL");
const consequences = assets.filter((asset) => asset.assetType === "PENDING_CONSEQUENCE_RULE");
const floors = assets.filter((asset) => asset.assetType === "SECTION_FLOOR_OBLIGATION");
const arcs = assets.filter((asset) => asset.assetType === "CAUSAL_ARC");
const sourceScenes = assets.filter((asset) => asset.assetType === "SOURCE_SCENE_EVIDENCE");
const adaptations = array(runtime.approvedAdaptations);
const continuationDecisions = floors.flatMap((floor) => array(floor.payload?.continuationDecisions));

pass(sections.length === 4, "P3_SECTION_COUNT", sections.length);
pass(requirements.length === 12, "P3_REQUIREMENT_COUNT", requirements.length);
pass(assets.length === 74, "P3_ASSET_COUNT", assets.length);
pass(patterns.length === 12, "P3_PATTERN_COUNT", patterns.length);
pass(evidenceAssets.length === 1, "P3_EVIDENCE_PROFILE_ASSET_COUNT", evidenceAssets.length);
pass(kernels.length === 15, "P1_KERNEL_COUNT", kernels.length);
pass(consequences.length === 12, "P5_CONSEQUENCE_RULE_COUNT", consequences.length);
pass(floors.length === 4, "P4_FLOOR_COUNT", floors.length);
pass(arcs.length === 4, "P4_CAUSAL_ARC_COUNT", arcs.length);
pass(sourceScenes.length === 10, "P3_SOURCE_SCENE_COUNT", sourceScenes.length);
pass(adaptations.length === 7, "P3_ADAPTATION_COUNT", adaptations.length);
pass(continuationDecisions.length === 5, "P4_CONTINUATION_DECISION_COUNT", continuationDecisions.length);

for (const section of sections) {
  const sectionPatterns = patterns.filter((pattern) => array(pattern.sectionIds).includes(section.sectionId));
  pass(sectionPatterns.length === 3, "P3_SECTION_PATTERN_COVERAGE", { sectionId: section.sectionId, count: sectionPatterns.length });
  for (const pattern of sectionPatterns) {
    const payload = object(pattern.payload);
    pass(array(payload.orderedBeats).length >= 3, "P3_PATTERN_ORDERED_BEATS", pattern.assetId);
    pass(array(payload.dialogueTactics).length >= 2, "P3_PATTERN_DIALOGUE_TACTICS", pattern.assetId);
    pass(array(payload.blockingPrinciples).length >= 3, "P3_PATTERN_BLOCKING", pattern.assetId);
    pass(array(payload.transferableTechniques).length >= 3, "P3_PATTERN_TRANSFER", pattern.assetId);
    pass(array(payload.forbiddenFlattening).length >= 3, "P3_PATTERN_FLATTENING_GUARDS", pattern.assetId);
    pass(payload.reviewStatus === "APPROVED", "P3_PATTERN_APPROVAL", pattern.assetId);
    pass(payload.verbatimPolicy === "MECHANISM_ONLY_NO_VERBATIM_REUSE", "P3_PATTERN_COPYRIGHT_BOUNDARY", pattern.assetId);
  }
}

pass(evidenceProfiles.reviewStatus === "APPROVED", "P3_EVIDENCE_SET_APPROVAL");
pass(array(evidenceProfiles.profiles).length === 1, "P3_EVIDENCE_PROFILE_COUNT");
for (const profile of array(evidenceProfiles.profiles)) {
  pass(profile.openingReport?.statementClass === "ATTRIBUTED_UNVERIFIED_REPORT", "P3_REPORTED_FACT_CLASS");
  pass(array(profile.openingReport?.allowedAssertions).length >= 4, "P3_ALLOWED_ASSERTIONS");
  pass(array(profile.openingReport?.forbiddenAssertions).length >= 5, "P3_FORBIDDEN_ASSERTIONS");
  pass(array(profile.openingBeatContract?.moves).length >= 4, "P4_OPENING_BEAT_MOVES");
  pass(array(profile.openingBeatContract?.requiredAnchorGroups).length >= 5, "P4_OPENING_ANCHORS");
  pass(array(profile.revealPolicy?.tiers).length >= 2, "P3_REVEAL_TIERS");
  pass(array(profile.invariants).some((item) => /人物说法.*客观事实/u.test(String(item))), "P3_ATTRIBUTION_INVARIANT");
}

for (const kernel of kernels) {
  const payload = object(kernel.payload);
  const options = array(payload.options);
  pass(payload.allowFreeAction === true, "P1_FREE_ACTION_ENABLED", kernel.assetId);
  pass(options.length >= 2, "P1_VISIBLE_OPTION_FLOOR", kernel.assetId);
  pass(options.length <= 3, "P1_VISIBLE_OPTION_CEILING", kernel.assetId);
  pass(hasText(payload.decisionPrompt?.prompt), "P4_DECISION_PROMPT", kernel.assetId);
  pass(hasText(payload.decisionPrompt?.resultCeiling), "P4_DECISION_RESULT_CEILING", kernel.assetId);
  for (const option of options) {
    pass(hasText(option.actionText), "P1_OPTION_ACTION", option.affordanceTemplateId);
    pass(hasText(option.targetRef), "P1_OPTION_TARGET", option.affordanceTemplateId);
    pass(hasText(option.method), "P1_OPTION_METHOD", option.affordanceTemplateId);
    pass(hasText(option.visibleTradeoff), "P1_OPTION_TRADEOFF", option.affordanceTemplateId);
    pass(Object.keys(object(option.statePatch)).length > 0, "P1_OPTION_STATE_PATCH", option.affordanceTemplateId);
    pass(hasText(option.protectedNarrative), "P4_PROTECTED_NARRATIVE", option.affordanceTemplateId);
    pass(object(option.playerVisibleFallback) && Object.keys(option.playerVisibleFallback).length >= 3, "P4_PLAYER_FALLBACK", option.affordanceTemplateId);
    pass(array(option.protectedEffectRefs).length > 0, "P4_PROTECTED_EFFECT_REFS", option.affordanceTemplateId);
    pass(option.createsPendingConsequence === true, "P5_OPTION_PENDING_CONSEQUENCE", option.affordanceTemplateId);
  }
}

for (const rule of consequences) {
  const payload = object(rule.payload);
  const delayed = array(payload.consequences);
  const payoffBeats = array(payload.payoffBeats);
  pass(payload.createOnlyFromCommittedEvent === true, "P5_COMMIT_BOUND_CONSEQUENCE", rule.assetId);
  pass(payload.mayNotDisappearSilently === true, "P5_NO_SILENT_DISAPPEARANCE", rule.assetId);
  pass(delayed.length > 0, "P5_DELAYED_CONSEQUENCE", rule.assetId);
  pass(delayed.length === payoffBeats.length, "P5_PAYOFF_PARITY", rule.assetId);
  for (const beat of payoffBeats) {
    pass(hasText(beat.action), "P5_PAYOFF_ACTION", beat.beatId);
    pass(array(beat.actorRefs).length > 0, "P5_PAYOFF_ACTOR", beat.beatId);
    pass(array(beat.requiredTermGroups).length > 0, "P5_PAYOFF_ANCHORS", beat.beatId);
    pass(hasText(beat.resultCeiling), "P5_PAYOFF_CEILING", beat.beatId);
  }
}

for (const floor of floors) {
  const payload = object(floor.payload);
  pass(payload.mayOnlyMoveNpcOrWorld === true, "P4_FLOOR_NPC_WORLD_ONLY", floor.assetId);
  pass(payload.mayNotDecideForPlayer === true, "P4_FLOOR_PLAYER_AGENCY", floor.assetId);
  pass(payload.mayNotInventEvidence === true, "P4_FLOOR_EVIDENCE_BOUNDARY", floor.assetId);
  for (const decision of array(payload.continuationDecisions)) {
    pass(array(decision.options).length === 2, "P4_CONTINUATION_TWO_RESPONSES", decision.continuationDecisionId);
    pass(hasText(decision.worldPressure?.summary), "P4_CONTINUATION_PRESSURE", decision.continuationDecisionId);
    for (const option of array(decision.options)) {
      pass(Object.keys(object(option.statePatch)).length > 0, "P5_CONTINUATION_STATE_PATCH", option.affordanceTemplateId);
      pass(option.createsPendingConsequence === true, "P5_CONTINUATION_PENDING", option.affordanceTemplateId);
    }
  }
}

pass(sourceFiles.adapter.includes("DISPLAYED_OPTIONS"), "P1_DISPLAYED_AFFORDANCE_AUTHORITY");
pass(sourceFiles.adapter.includes("BOUND_CAPABILITY"), "P1_CAPABILITY_BINDING_ADAPTER");
pass(sourceFiles.resolver.includes("BOUND_CAPABILITY"), "P1_CAPABILITY_BINDING_RESOLVER");
pass(sourceFiles.resolver.includes("CAPABILITY_VARIANT"), "P1_CAPABILITY_VARIANT_CONTRACT");
pass(sourceFiles.decisions.includes("FREE_TEXT_CAPABILITY"), "P1_CAPABILITY_SETTLEMENT_BINDING");
pass(sourceFiles.engine.includes("OBSERVE_ONLY"), "P1_OBSERVE_ONLY_SETTLEMENT");
pass(sourceFiles.engine.includes("completedKernelIds") && sourceFiles.engine.includes("pendingConsequences"), "P5_DURABLE_BRANCH_STATE");
pass(sourceFiles.reviewer.includes("normalizeP0NoneSentinels"), "P2_NONE_NORMALIZATION");
pass(sourceFiles.reviewer.includes('"NONE"'), "P2_UNIQUE_NONE_SENTINEL");
pass(sourceFiles.foreground.includes("BeatManifest") || sourceFiles.foreground.includes("beatManifest"), "P4_FOREGROUND_BEAT_CONTRACT");
pass(sourceFiles.atomic.includes("AtomicTurn") || sourceFiles.atomic.includes("atomic"), "P6_ATOMIC_CANON_COMMIT");
pass(sourceFiles.decisions.includes("currentSangtianOptions"), "P6_SERVER_OPTIONS_SOURCE");
pass(sourceFiles.decisions.includes("buildPartOneRuntimeWorkingSet"), "P6_POST_CANON_WORKING_SET");

const evidence = {
  schemaVersion: "omw.ai-story-convergence-static-evidence.v1",
  verdict: failures.length ? "FAIL" : "PASS",
  counts: {
    sections: sections.length,
    requirements: requirements.length,
    assets: assets.length,
    narrativeScenePatterns: patterns.length,
    evidenceProfiles: evidenceAssets.length,
    decisionKernels: kernels.length,
    pendingConsequenceRules: consequences.length,
    floorObligations: floors.length,
    causalArcs: arcs.length,
    continuationDecisions: continuationDecisions.length,
    approvedAdaptations: adaptations.length,
    sourceSceneEvidence: sourceScenes.length,
  },
  sectionPatternCoverage: Object.fromEntries(sections.map((section) => [
    section.sectionId,
    patterns.filter((pattern) => array(pattern.sectionIds).includes(section.sectionId)).map((pattern) => pattern.assetId),
  ])),
  sourceHashes: Object.fromEntries(Object.entries(sourceFiles).map(([key, value]) => [key, sha256(value)])),
  runtimePackageHash: runtime.immutableHash,
  failures,
  generatedAt: new Date().toISOString(),
};
const outputPath = resolve(
  process.env.AI_STORY_CONVERGENCE_EVIDENCE_PATH
    || resolve(root, "docs/auto-execute/evidence/chatgpt-pro-convergence/static-convergence.json"),
);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
console.log(JSON.stringify(evidence, null, 2));
if (failures.length) process.exitCode = 1;

function readText(path) {
  return readFileSync(resolve(root, path), "utf8");
}
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function array(value) {
  return Array.isArray(value) ? value : [];
}
function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
