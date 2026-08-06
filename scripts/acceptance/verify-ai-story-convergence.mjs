import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const configRoot = resolve(root, "packages/templates/config");
const runtimeEntryPath = resolve(root, "packages/templates/dist/runtime-entry.js");
const frozenLoaderPath = resolve(
  root,
  "packages/templates/dist/story-package/part-one-runtime-loader.js",
);
const runtimeEntry = await import(pathToFileURL(runtimeEntryPath).href);
const frozenLoader = await import(pathToFileURL(frozenLoaderPath).href);
const frozen = frozenLoader.loadPartOneRuntimePackage("sangtian", configRoot).package;
const runtime = runtimeEntry.loadPartOneRuntimePackage("sangtian", configRoot).package;
const evidenceProfiles = readJson(resolve(
  root,
  "packages/templates/authoring/sangtian/evidence/approved/part-01-v3.evidence-profiles.json",
));
const sourceFiles = {
  adapter: readText("apps/openovel-runtime/src/decision-adapter.ts"),
  resolver: readText("apps/openovel-runtime/src/intent-resolver.ts"),
  decisions: readText("apps/openovel-runtime/src/sangtian-decisions.ts"),
  runtimeFacade: readText("packages/templates/src/runtime-facade.ts"),
  engine: readText("packages/templates/src/story-package/part-one-runtime-engine.ts"),
  runtimeEntry: readText("packages/templates/src/runtime-entry.ts"),
  playableLoader: readText("packages/templates/src/story-package/playable-part-one-runtime.ts"),
  reviewer: readText("apps/openovel-runtime/src/scene-review-modules.ts"),
  foreground: readText("apps/openovel-runtime/src/foreground.ts"),
  atomic: readText("apps/openovel-runtime/src/atomic-turn.ts"),
  options: readText("apps/openovel-runtime/src/options-memory-module.ts"),
};
const failures = [];
const pass = (condition, code, details = null) => {
  if (!condition) failures.push({ code, details });
};

const frozenAssets = array(frozen.assets);
const assets = array(runtime.assets);
const sections = array(runtime.sections);
const requirements = array(runtime.requirements);
const patterns = assets.filter((asset) => asset.assetType === "NARRATIVE_SCENE_PATTERN");
const evidenceAssets = assets.filter((asset) => asset.assetType === "EVIDENCE_PROFILE");
const kernels = assets.filter((asset) => (
  asset.assetType === "DECISION_KERNEL"
  && String(asset.assetId).startsWith("DK-P1-")
));
const consequences = assets.filter((asset) => asset.assetType === "PENDING_CONSEQUENCE_RULE");
const floors = assets.filter((asset) => asset.assetType === "SECTION_FLOOR_OBLIGATION");
const arcs = assets.filter((asset) => asset.assetType === "CAUSAL_ARC");
const sourceScenes = assets.filter((asset) => asset.assetType === "SOURCE_SCENE_EVIDENCE");
const adaptations = array(runtime.approvedAdaptations);
const continuationDecisions = floors.flatMap((floor) => array(floor.payload?.continuationDecisions));

pass(frozenAssets.length === 65, "P0_FROZEN_ASSET_COUNT", frozenAssets.length);
pass(frozen.contentCounts?.narrativeScenePatterns === 3, "P0_FROZEN_PATTERN_COUNT", frozen.contentCounts?.narrativeScenePatterns);
pass(frozen.immutableHash === runtime.narrativeSupplement?.baseRuntimeImmutableHash, "P3_FROZEN_HASH_BINDING");
pass(runtime.immutableHash !== frozen.immutableHash, "P3_PLAYABLE_HASH_NOT_DERIVED");
pass(runtime.narrativeSupplement?.assetCount === 11, "P3_SUPPLEMENT_ASSET_COUNT", runtime.narrativeSupplement?.assetCount);
pass(sections.length === 4, "P3_SECTION_COUNT", sections.length);
pass(requirements.length === 12, "P3_REQUIREMENT_COUNT", requirements.length);
pass(assets.length === 76, "P3_PLAYABLE_ASSET_COUNT", assets.length);
pass(patterns.length === 14, "P3_PLAYABLE_PATTERN_COUNT", patterns.length);
pass(evidenceAssets.length === 1, "P3_EVIDENCE_PROFILE_ASSET_COUNT", evidenceAssets.length);
pass(kernels.length === 15, "P1_KERNEL_COUNT", kernels.length);
pass(consequences.length === 12, "P5_CONSEQUENCE_RULE_COUNT", consequences.length);
pass(floors.length === 4, "P4_FLOOR_COUNT", floors.length);
pass(arcs.length === 4, "P4_CAUSAL_ARC_COUNT", arcs.length);
pass(sourceScenes.length === 10, "P3_SOURCE_SCENE_COUNT", sourceScenes.length);
pass(adaptations.length === 7, "P3_ADAPTATION_COUNT", adaptations.length);
pass(continuationDecisions.length === 5, "P6_CONTINUATION_DECISION_COUNT", continuationDecisions.length);

const patternById = new Map(patterns.map((pattern) => [pattern.assetId, pattern]));
const kernelPatternCoverage = {};
for (const section of sections) {
  const sectionPatterns = patterns.filter((pattern) => array(pattern.sectionIds).includes(section.sectionId));
  pass(sectionPatterns.length >= 2 && sectionPatterns.length <= 4, "P3_SECTION_PATTERN_COVERAGE", {
    sectionId: section.sectionId,
    count: sectionPatterns.length,
  });
  for (const pattern of sectionPatterns) {
    const payload = object(pattern.payload);
    pass(payload.patternId === pattern.assetId, "P3_PATTERN_ID_BINDING", pattern.assetId);
    pass(array(payload.orderedBeats).length >= 3, "P3_PATTERN_ORDERED_BEATS", pattern.assetId);
    pass(array(payload.dialogueTactics).length >= 1, "P3_PATTERN_DIALOGUE_TACTICS", pattern.assetId);
    pass(array(payload.blockingPrinciples).length >= 3, "P3_PATTERN_BLOCKING", pattern.assetId);
    pass(array(payload.transferableTechniques).length >= 3, "P3_PATTERN_TRANSFER", pattern.assetId);
    pass(array(payload.forbiddenFlattening).length >= 3, "P3_PATTERN_FLATTENING_GUARDS", pattern.assetId);
    pass(payload.reviewStatus === "APPROVED", "P3_PATTERN_APPROVAL", pattern.assetId);
    pass(payload.verbatimPolicy === "MECHANISM_ONLY_NO_VERBATIM_REUSE", "P3_PATTERN_COPYRIGHT_BOUNDARY", pattern.assetId);
  }
}
for (const kernel of kernels) {
  const indexedIds = array(runtime.runtimeIndex?.byDecisionKernel?.[kernel.assetId]);
  const covered = indexedIds.filter((id) => patternById.has(id));
  kernelPatternCoverage[kernel.assetId] = covered;
  pass(covered.length >= 1, "P3_KERNEL_PATTERN_COVERAGE", kernel.assetId);
  const payload = object(kernel.payload);
  const options = array(payload.options);
  pass(payload.allowFreeAction === true, "P1_FREE_ACTION_ENABLED", kernel.assetId);
  pass(options.length >= 2 && options.length <= 4, "P6_VISIBLE_OPTION_COUNT", {
    kernelId: kernel.assetId,
    count: options.length,
  });
  pass(hasText(payload.decisionPrompt?.prompt), "P4_DECISION_PROMPT", kernel.assetId);
  pass(hasText(payload.decisionPrompt?.resultCeiling), "P4_DECISION_RESULT_CEILING", kernel.assetId);
  validateOptionSet(options, kernel.assetId);
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
    pass(array(decision.options).length >= 2 && array(decision.options).length <= 4, "P6_CONTINUATION_OPTION_COUNT", decision.continuationDecisionId);
    pass(hasText(decision.worldPressure?.summary), "P4_CONTINUATION_PRESSURE", decision.continuationDecisionId);
    validateOptionSet(array(decision.options), decision.continuationDecisionId);
  }
}

pass(sourceFiles.adapter.includes("DISPLAYED_OPTIONS"), "P1_DISPLAYED_AFFORDANCE_AUTHORITY");
pass(sourceFiles.adapter.includes("BOUND_CAPABILITY"), "P1_CAPABILITY_BINDING_ADAPTER");
pass(sourceFiles.resolver.includes("BOUND_CAPABILITY"), "P1_CAPABILITY_BINDING_RESOLVER");
pass(sourceFiles.resolver.includes("CAPABILITY_VARIANT"), "P1_CAPABILITY_VARIANT_CONTRACT");
pass(sourceFiles.runtimeFacade.includes("FREE_TEXT_CAPABILITY"), "P1_CAPABILITY_SETTLEMENT_BINDING");
pass(sourceFiles.reviewer.includes("normalizeP0NoneSentinels"), "P2_NONE_NORMALIZATION");
pass(sourceFiles.reviewer.includes('"NONE"'), "P2_UNIQUE_NONE_SENTINEL");
pass(sourceFiles.runtimeEntry.includes("loadPlayablePartOneRuntimePackage"), "P3_PRODUCTION_PLAYABLE_LOADER");
pass(sourceFiles.playableLoader.includes("loadFrozenPartOneRuntimePackage"), "P3_FROZEN_BASE_FIRST");
pass(sourceFiles.engine.includes("patternId: pattern.patternId"), "P4_PATTERN_PROVENANCE_PROJECTED");
pass(sourceFiles.engine.includes("dramaticBeatPlan"), "P4_DRAMATIC_BEAT_PLAN");
pass(sourceFiles.foreground.includes("BeatManifest") || sourceFiles.foreground.includes("beatManifest"), "P4_FOREGROUND_BEAT_CONTRACT");
pass(sourceFiles.engine.includes("completedKernelIds") && sourceFiles.engine.includes("pendingConsequences"), "P5_DURABLE_BRANCH_STATE");
pass(sourceFiles.atomic.includes("AtomicTurn") || sourceFiles.atomic.includes("atomic"), "P6_ATOMIC_CANON_COMMIT");
pass(sourceFiles.options.includes("afterCommit"), "P6_OPTIONS_AFTER_COMMIT_MODULE");
pass(sourceFiles.options.includes("COMMITTED_WORLD_STATE"), "P6_OPTIONS_COMMITTED_STATE_SOURCE");
pass(sourceFiles.decisions.includes("currentSangtianOptions"), "P6_SERVER_OPTIONS_SOURCE");

const evidence = {
  schemaVersion: "omw.ai-story-convergence-static-evidence.v2",
  verdict: failures.length ? "FAIL" : "PASS",
  frozen: {
    immutableHash: frozen.immutableHash,
    assetCount: frozenAssets.length,
    narrativeScenePatternCount: frozen.contentCounts?.narrativeScenePatterns,
  },
  playable: {
    immutableHash: runtime.immutableHash,
    baseRuntimeImmutableHash: runtime.narrativeSupplement?.baseRuntimeImmutableHash || null,
    supplementImmutableHash: runtime.narrativeSupplement?.immutableHash || null,
  },
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
  kernelPatternCoverage,
  sourceHashes: Object.fromEntries(Object.entries(sourceFiles).map(([key, value]) => [key, sha256(value)])),
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

function validateOptionSet(options, label) {
  const ids = options.map((option) => String(option.affordanceTemplateId || option.id || "").trim());
  pass(ids.every(Boolean) && new Set(ids).size === ids.length, "P6_OPTION_IDS_UNIQUE", label);
  const surfaces = options.map((option) => ({
    action: String(option.actionText || option.label || "").trim(),
    target: String(option.targetRef || "").trim(),
    method: String(option.method || "").trim(),
  }));
  pass(surfaces.every((surface) => surface.action && surface.target && surface.method), "P6_OPTION_SURFACE_COMPLETE", label);
  for (let left = 0; left < surfaces.length; left += 1) {
    for (let right = left + 1; right < surfaces.length; right += 1) {
      pass(
        surfaces[left].target !== surfaces[right].target || surfaces[left].method !== surfaces[right].method,
        "P6_OPTION_MATERIAL_DISTINCTION",
        { label, left: ids[left], right: ids[right] },
      );
    }
  }
  const forbidden = /statePatch|pendingConsequence|decisionKernel|affordanceTemplate|resultCeiling|sourceRef|fixture|mock|测试|后台|内部字段/iu;
  pass(surfaces.every((surface) => !forbidden.test(surface.action)), "P6_OPTION_INTERNAL_LEAK", label);
}
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
