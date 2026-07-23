import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { computeImmutableHash, readJson, repoRoot, validateWithSchema, writeJson } from "./lib/contract-utils.mjs";

const RELEASE_VERSION = "sangtian-part-one-authoring-v1.0.0";
const authoringRoot = resolve(repoRoot, "packages/templates/authoring/sangtian");
const releaseRoot = resolve(authoringRoot, "runtime-assets", RELEASE_VERSION);
const evidenceRoot = resolve(repoRoot, "docs/剧本/嘉靖财政危局/derived/evidence-v2/published/sangtian-part-one-evidence-v1.0.0");
const errors = [];
const fail = (code, detail) => errors.push({ code, detail });

const manifest = await readJson(resolve(releaseRoot, "manifest.json"));
const manifestHash = computeImmutableHash(manifest);
if (manifest.immutableHash !== manifestHash) fail("MANIFEST_HASH_INVALID", `${manifest.immutableHash} != ${manifestHash}`);

const requirementSet = await readJson(resolve(authoringRoot, "requirements/part-01.requirements.json"));
const requirements = new Map(requirementSet.requirements.map((item) => [item.requirementId, item]));
if (requirements.size !== 12) fail("REQUIREMENT_COUNT_INVALID", `expected 12, found ${requirements.size}`);
if (manifest.requirementSetHash !== computeImmutableHash(requirementSet)) fail("REQUIREMENT_HASH_INVALID", "manifest requirementSetHash does not match current requirement set");

const adaptations = await readJson(resolve(authoringRoot, "adaptation/approved/part-01-v3.adaptation-decisions.json"));
const adaptationIds = new Set(adaptations.adaptations.map((item) => item.adaptationDecisionId));
for (const item of adaptations.adaptations) {
  const schema = await validateWithSchema("adaptation-decision-v2", item);
  if (!schema.valid || item.reviewStatus !== "APPROVED") fail("ADAPTATION_NOT_APPROVED", item.adaptationDecisionId);
}

const claimIds = new Set();
const sourceFutureClaimIds = new Set();
const sourceFutureSceneIds = new Set((await readJson(resolve(evidenceRoot, "manifest.json"))).sourceFutureSceneIds ?? []);
for (const name of (await readdir(resolve(evidenceRoot, "claims"))).filter((entry) => entry.endsWith(".claims.json"))) {
  const claimSet = await readJson(resolve(evidenceRoot, "claims", name));
  for (const claim of claimSet.claims) {
    claimIds.add(claim.claimId);
    if (sourceFutureSceneIds.has(claim.validFromSceneId) || claim.runtimeAvailability === "EVIDENCE_ONLY") sourceFutureClaimIds.add(claim.claimId);
  }
}

const assets = [];
const assetFiles = (await readdir(resolve(releaseRoot, "assets"))).filter((entry) => entry.endsWith(".json")).sort();
for (const name of assetFiles) assets.push(await readJson(resolve(releaseRoot, "assets", name)));
const assetById = new Map(assets.map((item) => [item.assetId, item]));
if (assetById.size !== assets.length) fail("DUPLICATE_ASSET_ID", "runtime asset IDs are not unique");
if (assets.length !== manifest.assetCount) fail("ASSET_COUNT_INVALID", `${assets.length} != ${manifest.assetCount}`);
if (JSON.stringify([...assetById.keys()].sort()) !== JSON.stringify([...manifest.assetIds].sort())) fail("ASSET_SET_INVALID", "manifest assetIds differ from asset files");

const knownKernelIds = new Set(assets.filter((item) => item.assetType === "DECISION_KERNEL" && item.assetId.startsWith("DK-P1-")).map((item) => item.assetId));
const knownArcIds = new Set(assets.filter((item) => item.assetType === "CAUSAL_ARC").map((item) => item.assetId));
const forbiddenVisibleTokens = [/\b(?:REQ|DK|ARC|RTA|PCR)-P1-/u, /Adaptation/u, /(?:statePath|sourceClaimId|affordanceTemplateId)/u];
for (const asset of assets) {
  if (manifest.assetHashes?.[asset.assetId] !== computeImmutableHash(asset)) fail("ASSET_HASH_INVALID", asset.assetId);
  if (!Array.isArray(asset.requirementIds) || !asset.requirementIds.length) fail("ASSET_REQUIREMENT_MISSING", asset.assetId);
  if (!Array.isArray(asset.decisionKernelIds) || !asset.decisionKernelIds.length) fail("ASSET_KERNEL_MISSING", asset.assetId);
  if (!asset.sourceClaimIds.length && !asset.adaptationDecisionIds.length) fail("ASSET_PROVENANCE_MISSING", asset.assetId);
  asset.requirementIds.forEach((id) => { if (!requirements.has(id)) fail("ASSET_REQUIREMENT_UNKNOWN", `${asset.assetId}:${id}`); });
  asset.decisionKernelIds.forEach((id) => { if (!knownKernelIds.has(id)) fail("ASSET_KERNEL_UNKNOWN", `${asset.assetId}:${id}`); });
  asset.causalArcIds.forEach((id) => { if (!knownArcIds.has(id)) fail("ASSET_ARC_UNKNOWN", `${asset.assetId}:${id}`); });
  asset.sourceClaimIds.forEach((id) => { if (!claimIds.has(id)) fail("ASSET_CLAIM_UNKNOWN", `${asset.assetId}:${id}`); });
  asset.adaptationDecisionIds.forEach((id) => { if (!adaptationIds.has(id)) fail("ASSET_ADAPTATION_UNKNOWN", `${asset.assetId}:${id}`); });
  if (asset.assetType === "RUNTIME_FACT" && asset.sourceClaimIds.some((id) => sourceFutureClaimIds.has(id))) fail("SOURCE_FUTURE_IMPORTED_AS_FACT", asset.assetId);
  if (asset.assetType === "DECISION_KERNEL" && asset.assetId.startsWith("DK-P1-")) {
    const options = asset.payload?.options;
    if (!Array.isArray(options) || options.length < 3 || options.length > 4) fail("KERNEL_OPTION_COUNT_INVALID", asset.assetId);
    const titles = new Set();
    for (const option of options ?? []) {
      if (!option.title || !option.actionText || !option.visibleTradeoff || !option.targetRef || !option.method) fail("KERNEL_OPTION_INCOMPLETE", `${asset.assetId}:${option.affordanceTemplateId}`);
      if (titles.has(option.title)) fail("KERNEL_OPTION_TITLE_DUPLICATE", `${asset.assetId}:${option.title}`);
      titles.add(option.title);
      const visible = `${option.title}\n${option.actionText}\n${option.visibleTradeoff}`;
      if (forbiddenVisibleTokens.some((pattern) => pattern.test(visible))) fail("KERNEL_OPTION_INTERNAL_LANGUAGE", `${asset.assetId}:${option.affordanceTemplateId}`);
    }
  }
}

for (const requirement of requirementSet.requirements) {
  const schema = await validateWithSchema("story-capability-requirement-v1", requirement);
  if (!schema.valid) fail("REQUIREMENT_SCHEMA_INVALID", requirement.requirementId);
  if (!requirement.sourceSceneIds.length || !requirement.sourceClaimIds.length || !requirement.runtimeAssetIds.length) fail("REQUIREMENT_TRACE_INCOMPLETE", requirement.requirementId);
  requirement.runtimeAssetIds.forEach((id) => { if (!assetById.has(id)) fail("REQUIREMENT_ASSET_UNKNOWN", `${requirement.requirementId}:${id}`); });
  requirement.adaptationDecisionIds.forEach((id) => { if (!adaptationIds.has(id)) fail("REQUIREMENT_ADAPTATION_UNKNOWN", `${requirement.requirementId}:${id}`); });
}

const sections = [];
for (const name of (await readdir(resolve(authoringRoot, "sections/part-01"))).filter((entry) => entry.endsWith(".json")).sort()) {
  const section = await readJson(resolve(authoringRoot, "sections/part-01", name));
  sections.push(section);
  const schema = await validateWithSchema("section-contract-v1", section);
  if (!schema.valid) fail("SECTION_SCHEMA_INVALID", section.sectionId);
  section.activeDecisionKernelIds.forEach((id) => { if (!knownKernelIds.has(id)) fail("SECTION_KERNEL_UNKNOWN", `${section.sectionId}:${id}`); });
  section.activeCausalArcIds.forEach((id) => { if (!knownArcIds.has(id)) fail("SECTION_ARC_UNKNOWN", `${section.sectionId}:${id}`); });
  section.floorObligationIds.forEach((id) => { if (!assetById.has(id)) fail("SECTION_FLOOR_UNKNOWN", `${section.sectionId}:${id}`); });
}

const runtimeIndex = await readJson(resolve(releaseRoot, "runtime-index.json"));
if (manifest.runtimeIndexHash !== computeImmutableHash(runtimeIndex)) fail("RUNTIME_INDEX_HASH_INVALID", "runtime-index.json hash mismatch");
const indexBuckets = ["byPart", "bySection", "byRequirement", "byDecisionKernel", "byCausalArc", "byActor", "byLocation", "byStateDependency", "byRetrievalTag", "byVisibilityClass"];
for (const bucket of indexBuckets) {
  if (!runtimeIndex[bucket] || typeof runtimeIndex[bucket] !== "object") fail("RUNTIME_INDEX_BUCKET_MISSING", bucket);
  for (const [key, ids] of Object.entries(runtimeIndex[bucket] ?? {})) {
    if (!Array.isArray(ids) || ids.some((id) => !assetById.has(id))) fail("RUNTIME_INDEX_ASSET_UNKNOWN", `${bucket}:${key}`);
  }
}
for (const asset of assets) {
  for (const requirementId of asset.requirementIds) if (!(runtimeIndex.byRequirement[requirementId] ?? []).includes(asset.assetId)) fail("RUNTIME_INDEX_REQUIREMENT_MISSING", `${requirementId}:${asset.assetId}`);
  for (const kernelId of asset.decisionKernelIds) if (!(runtimeIndex.byDecisionKernel[kernelId] ?? []).includes(asset.assetId)) fail("RUNTIME_INDEX_KERNEL_MISSING", `${kernelId}:${asset.assetId}`);
}

const report = {
  schemaVersion: "sangtian-part-one-authoring-release-validation-v1",
  releaseVersion: RELEASE_VERSION,
  assetCount: assets.length,
  requirementCount: requirements.size,
  decisionKernelCount: knownKernelIds.size,
  causalArcCount: knownArcIds.size,
  sectionCount: sections.length,
  adaptationCount: adaptationIds.size,
  sourceClaimCount: claimIds.size,
  sourceFutureClaimCount: sourceFutureClaimIds.size,
  errors,
  verdict: errors.length ? "FAIL" : "PASS",
};
await writeJson(resolve(authoringRoot, "tests/part-01.authoring-release-validation.json"), report);
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
