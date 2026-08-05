import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defaultStoryPackageConfigRoot } from "./loader";
import type {
  LoadedPartOneRuntimePackage,
  PartOneNarrativeSupplement,
  PartOneRuntimeAsset,
  PartOneRuntimeIndex,
  PartOneRuntimePackage,
} from "./part-one-runtime-types";

const cache = new Map<string, LoadedPartOneRuntimePackage>();

export function getPartOneRuntimePackagePath(worldId: string, configRoot?: string) {
  const effectiveConfigRoot = configRoot || defaultStoryPackageConfigRoot;
  const runtimeEnv = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const shadowPath = worldId === "sangtian" && configRoot === undefined
    ? String(runtimeEnv?.SANGTIAN_RUNTIME_PACKAGE_PATH || "").trim()
    : "";
  if (shadowPath) return resolve(shadowPath);
  return resolve(effectiveConfigRoot, worldId, "story-package", "part-one-runtime.json");
}

export function getPartOneNarrativeSupplementPath(runtimePackagePath: string) {
  const runtimeEnv = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const shadowPath = String(runtimeEnv?.SANGTIAN_NARRATIVE_SUPPLEMENT_PATH || "").trim();
  if (shadowPath) return resolve(shadowPath);
  return resolve(dirname(runtimePackagePath), "part-one-narrative-supplement.json");
}

export function clearPartOneRuntimePackageCache() {
  cache.clear();
}

export function loadPartOneRuntimePackage(
  worldId: string,
  configRoot?: string
): LoadedPartOneRuntimePackage {
  const path = getPartOneRuntimePackagePath(worldId, configRoot);
  const supplementPath = getPartOneNarrativeSupplementPath(path);
  const cacheKey = `${path}::${supplementPath}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const parsed = parseJson(path, "PART_ONE_RUNTIME_JSON_INVALID");
  const expectedHash = hash(parsed.immutableHash, "immutableHash");
  const baseContentHash = immutableHash(parsed);
  if (baseContentHash !== expectedHash) {
    throw new Error(`PART_ONE_RUNTIME_HASH_MISMATCH:${worldId}`);
  }
  const basePackage = validatePartOneRuntimePackage(parsed, worldId);

  if (worldId !== "sangtian") {
    const loaded = { package: basePackage, contentHash: baseContentHash, path };
    cache.set(cacheKey, loaded);
    return loaded;
  }
  if (!existsSync(supplementPath)) {
    throw new Error(`PART_ONE_NARRATIVE_SUPPLEMENT_MISSING:${supplementPath}`);
  }
  const supplement = validatePartOneNarrativeSupplement(
    parseJson(supplementPath, "PART_ONE_NARRATIVE_SUPPLEMENT_JSON_INVALID"),
    basePackage,
  );
  const assembled = assemblePartOneRuntimePackage(basePackage, supplement);
  const loaded = { package: assembled, contentHash: assembled.immutableHash, path };
  cache.set(cacheKey, loaded);
  return loaded;
}

export function validatePartOneNarrativeSupplement(
  raw: unknown,
  basePackage: PartOneRuntimePackage,
): PartOneNarrativeSupplement {
  const value = record(raw, "narrativeSupplement");
  equal(value.schemaVersion, "sangtian-part-one-narrative-supplement-v1", "narrativeSupplement.schemaVersion");
  equal(value.worldId, basePackage.worldId, "narrativeSupplement.worldId");
  equal(value.partId, basePackage.partId, "narrativeSupplement.partId");
  equal(
    value.baseRuntimeImmutableHash,
    basePackage.immutableHash,
    "narrativeSupplement.baseRuntimeImmutableHash",
  );
  const expectedHash = hash(value.immutableHash, "narrativeSupplement.immutableHash");
  if (immutableHash(value) !== expectedHash) fail("narrativeSupplement immutable hash");

  const sourcePatternSets = array(value.sourcePatternSets, "narrativeSupplement.sourcePatternSets");
  if (sourcePatternSets.length !== 3) fail("narrativeSupplement sourcePatternSets cardinality");
  const sourceScopes = uniqueIds(sourcePatternSets, "scopeId", "narrativeSupplement.sourcePatternSets");
  for (const scopeId of ["SEC-P1-02", "SEC-P1-03", "SEC-P1-04"]) {
    member(scopeId, sourceScopes, "narrativeSupplement source scope");
  }
  for (const sourceSet of sourcePatternSets) {
    const row = record(sourceSet, "narrativeSupplement.sourcePatternSet");
    text(row.path, "narrativeSupplement.sourcePatternSet.path");
    hash(row.sha256, "narrativeSupplement.sourcePatternSet.sha256");
    text(row.version, "narrativeSupplement.sourcePatternSet.version");
    if (!Number.isInteger(row.patternCount) || Number(row.patternCount) < 2) {
      fail("narrativeSupplement.sourcePatternSet.patternCount");
    }
  }

  const assets = array(value.assets, "narrativeSupplement.assets");
  const counts = record(value.contentCounts, "narrativeSupplement.contentCounts");
  const assetIds = uniqueIds(assets, "assetId", "narrativeSupplement.assets");
  const baseAssetIds = new Set(basePackage.assets.map((asset) => asset.assetId));
  if (assetIds.some((id) => baseAssetIds.has(id))) fail("narrativeSupplement duplicate base assetId");
  count(counts.assets, assets.length, "narrativeSupplement.assets");
  count(counts.narrativeScenePatterns, assets.length, "narrativeSupplement.narrativeScenePatterns");
  if (assets.length !== 11) fail("narrativeSupplement frozen cardinality 11");

  const baseSectionIds = new Set(basePackage.sections.map((section) => section.sectionId));
  const baseRequirementIds = new Set(basePackage.requirements.map((requirement) => requirement.requirementId));
  const baseKernelIds = new Set(
    basePackage.assets
      .filter((asset) => asset.assetType === "DECISION_KERNEL")
      .map((asset) => asset.assetId),
  );
  const baseClaimIds = new Set(basePackage.assets.flatMap((asset) => asset.sourceClaimIds));
  const baseActorIds = new Set(basePackage.assets.flatMap((asset) => asset.actorRefs));
  const requiredKernelIds = new Set(
    basePackage.sections
      .filter((section) => ["SEC-P1-02", "SEC-P1-03", "SEC-P1-04"].includes(section.sectionId))
      .flatMap((section) => section.activeDecisionKernelIds),
  );
  const coveredKernelIds = new Set<string>();
  for (const assetValue of assets) {
    const asset = record(assetValue, "narrativeSupplement.asset");
    equal(asset.schemaVersion, "runtime-story-asset-v1", "narrativeSupplement.asset.schemaVersion");
    equal(asset.assetType, "NARRATIVE_SCENE_PATTERN", "narrativeSupplement.asset.assetType");
    array(asset.partIds, "narrativeSupplement.asset.partIds").forEach((id) => equal(id, "PART-01", "narrativeSupplement.asset.partId"));
    array(asset.sectionIds, "narrativeSupplement.asset.sectionIds").forEach((id) => {
      if (!baseSectionIds.has(String(id))) fail(`narrativeSupplement section:${String(id)}`);
    });
    array(asset.requirementIds, "narrativeSupplement.asset.requirementIds").forEach((id) => {
      if (!baseRequirementIds.has(String(id))) fail(`narrativeSupplement requirement:${String(id)}`);
    });
    array(asset.decisionKernelIds, "narrativeSupplement.asset.decisionKernelIds").forEach((id) => {
      const kernelId = String(id);
      if (!baseKernelIds.has(kernelId) || !requiredKernelIds.has(kernelId)) {
        fail(`narrativeSupplement kernel:${kernelId}`);
      }
      coveredKernelIds.add(kernelId);
    });
    array(asset.actorRefs, "narrativeSupplement.asset.actorRefs").forEach((id) => {
      if (!baseActorIds.has(String(id))) fail(`narrativeSupplement actor:${String(id)}`);
    });
    array(asset.sourceClaimIds, "narrativeSupplement.asset.sourceClaimIds").forEach((id) => {
      if (!baseClaimIds.has(String(id))) fail(`narrativeSupplement claim:${String(id)}`);
    });
    const payload = record(asset.payload, "narrativeSupplement.asset.payload");
    equal(payload.patternId, asset.assetId, "narrativeSupplement patternId binding");
    equal(payload.reviewStatus, "APPROVED", "narrativeSupplement reviewStatus");
    array(payload.orderedBeats, "narrativeSupplement.payload.orderedBeats");
    array(payload.dialogueTactics, "narrativeSupplement.payload.dialogueTactics");
    array(payload.blockingPrinciples, "narrativeSupplement.payload.blockingPrinciples");
    array(payload.objectPowerMoves, "narrativeSupplement.payload.objectPowerMoves");
    array(payload.forbiddenFlattening, "narrativeSupplement.payload.forbiddenFlattening");
  }

  const declaredCoveredKernelIds = array(
    value.coveredDecisionKernelIds,
    "narrativeSupplement.coveredDecisionKernelIds",
  ).map(String);
  const expectedCoveredKernelIds = [...coveredKernelIds].sort();
  if (canonical(declaredCoveredKernelIds) !== canonical(expectedCoveredKernelIds)) {
    fail("narrativeSupplement coveredDecisionKernelIds");
  }
  count(counts.coveredDecisionKernels, expectedCoveredKernelIds.length, "narrativeSupplement.coveredDecisionKernels");
  if (
    expectedCoveredKernelIds.length !== requiredKernelIds.size
    || [...requiredKernelIds].some((id) => !coveredKernelIds.has(id))
  ) {
    fail("narrativeSupplement complete kernel coverage");
  }

  const index = validateRuntimeIndex(value.runtimeIndexDelta, assetIds, "narrativeSupplement.runtimeIndexDelta");
  const rebuiltIndex = buildRuntimeIndex(assets as unknown as PartOneRuntimeAsset[]);
  if (canonical(index) !== canonical(rebuiltIndex)) fail("narrativeSupplement runtimeIndexDelta mismatch");
  return value as unknown as PartOneNarrativeSupplement;
}

export function assemblePartOneRuntimePackage(
  basePackage: PartOneRuntimePackage,
  supplement: PartOneNarrativeSupplement,
): PartOneRuntimePackage {
  const assets = [...basePackage.assets, ...supplement.assets];
  const runtimeIndex = mergeRuntimeIndexes(basePackage.runtimeIndex, supplement.runtimeIndexDelta);
  const narrativeScenePatterns = assets.filter((asset) => asset.assetType === "NARRATIVE_SCENE_PATTERN").length;
  const packageHash = createHash("sha256")
    .update(canonical({
      baseRuntimeImmutableHash: basePackage.immutableHash,
      narrativeSupplementImmutableHash: supplement.immutableHash,
    }))
    .digest("hex")
    .toUpperCase();
  return {
    ...basePackage,
    contentCounts: {
      ...basePackage.contentCounts,
      assets: assets.length,
      narrativeScenePatterns,
    },
    assets,
    runtimeIndex,
    narrativeSupplement: {
      baseRuntimeImmutableHash: supplement.baseRuntimeImmutableHash,
      immutableHash: supplement.immutableHash,
      assetCount: supplement.assets.length,
      coveredDecisionKernelIds: [...supplement.coveredDecisionKernelIds],
    },
    immutableHash: packageHash,
  };
}

export function validatePartOneRuntimePackage(raw: unknown, worldId = "sangtian"): PartOneRuntimePackage {
  const value = record(raw, "package");
  equal(value.schemaVersion, "sangtian-part-one-runtime-package-v1", "schemaVersion");
  equal(value.worldId, worldId, "worldId");
  equal(value.partId, "PART-01", "partId");
  equal(value.perspectiveRoleKey, "zhejiang_governor", "perspectiveRoleKey");
  text(value.authoringReleaseVersion, "authoringReleaseVersion");
  hash(value.authoringManifestHash, "authoringManifestHash");
  hash(value.immutableHash, "immutableHash");

  const authoringManifest = record(value.authoringManifest, "authoringManifest");
  equal(authoringManifest.immutableHash, value.authoringManifestHash, "authoringManifestHash binding");
  if (immutableHash(authoringManifest) !== value.authoringManifestHash) fail("authoringManifest immutable hash");

  const counts = record(value.contentCounts, "contentCounts");
  const sections = array(value.sections, "sections");
  const requirements = array(value.requirements, "requirements");
  const adaptations = array(value.approvedAdaptations, "approvedAdaptations");
  const assets = array(value.assets, "assets");
  const index = record(value.runtimeIndex, "runtimeIndex");
  const worldStart = record(value.worldStart, "worldStart");
  const style = record(value.styleProfile, "styleProfile");

  equal(worldStart.sectionId, "SEC-P1-01", "worldStart.sectionId");
  const worldStartState = record(worldStart.state, "worldStart.state");
  equal(worldStartState.sectionId, "SEC-P1-01", "worldStart.state.sectionId");
  const worldStartScene = record(worldStartState.scene, "worldStart.state.scene");
  text(worldStartScene.sceneId, "worldStart.state.scene.sceneId");
  text(worldStartScene.timeLabel, "worldStart.state.scene.timeLabel");
  text(worldStartScene.locationLabel, "worldStart.state.scene.locationLabel");
  array(worldStartScene.presentActorRefs, "worldStart.state.scene.presentActorRefs");
  text(worldStartScene.situation, "worldStart.state.scene.situation");
  equal(style.profileId, "STYLE-SANGTIAN-HISTORICAL-NOVEL", "styleProfile.profileId");
  const budget = record(style.narrativeBudget, "styleProfile.narrativeBudget");
  if (number(budget.minCharacters, "minCharacters") < 300 || number(budget.maxCharacters, "maxCharacters") > 1500) {
    fail("narrative budget must remain within approved 300-1500 range");
  }

  count(counts.assets, assets.length, "assets");
  count(counts.requirements, requirements.length, "requirements");
  count(counts.sections, sections.length, "sections");
  count(counts.approvedAdaptations, adaptations.length, "approvedAdaptations");
  count(authoringManifest.assetCount, assets.length, "authoringManifest.assetCount");
  count(authoringManifest.requirementCount, requirements.length, "authoringManifest.requirementCount");

  const assetIds = uniqueIds(assets, "assetId", "assets");
  const requirementIds = uniqueIds(requirements, "requirementId", "requirements");
  const sectionIds = uniqueIds(sections, "sectionId", "sections");
  const kernelIds = assets.map((entry) => record(entry, "asset")).filter((entry) => String(entry.assetId).startsWith("DK-P1-")).map((entry) => String(entry.assetId));
  const arcIds = assets.filter((entry) => record(entry, "asset").assetType === "CAUSAL_ARC").map((entry) => String(record(entry, "asset").assetId));
  const floorIds = assets.filter((entry) => record(entry, "asset").assetType === "SECTION_FLOOR_OBLIGATION").map((entry) => String(record(entry, "asset").assetId));
  count(counts.decisionKernels, kernelIds.length, "decisionKernels");
  count(counts.causalArcs, arcIds.length, "causalArcs");
  count(counts.floorObligations, floorIds.length, "floorObligations");
  const narrativePatternIds = assets.filter((entry) => record(entry, "asset").assetType === "NARRATIVE_SCENE_PATTERN").map((entry) => String(record(entry, "asset").assetId));
  count(counts.narrativeScenePatterns, narrativePatternIds.length, "narrativeScenePatterns");
  count(authoringManifest.narrativeScenePatternCount, narrativePatternIds.length, "authoringManifest.narrativeScenePatternCount");

  const sourceSceneEvidenceIds = assets
    .filter((entry) => record(entry, "asset").assetType === "SOURCE_SCENE_EVIDENCE")
    .map((entry) => String(record(entry, "asset").assetId));
  if (sections.length !== 4 || requirements.length !== 12 || assets.length !== 65 || kernelIds.length !== 15 || arcIds.length !== 4 || floorIds.length !== 4 || adaptations.length !== 7 || narrativePatternIds.length !== 3 || sourceSceneEvidenceIds.length !== 10) {
    fail("frozen Part One cardinalities 4/12/65/15/4/4/7/3/10");
  }
  for (const adaptation of adaptations) equal(record(adaptation, "adaptation").reviewStatus, "APPROVED", "adaptation.reviewStatus");
  for (const section of sections) {
    const row = record(section, "section");
    array(row.requiredRequirementIds, "requiredRequirementIds").forEach((id) => member(String(id), requirementIds, "section requirement"));
    array(row.activeDecisionKernelIds, "activeDecisionKernelIds").forEach((id) => member(String(id), assetIds, "section kernel"));
    array(row.activeCausalArcIds, "activeCausalArcIds").forEach((id) => member(String(id), assetIds, "section arc"));
  }
  for (const requirement of requirements) {
    const row = record(requirement, "requirement");
    array(row.sectionIds, "requirement.sectionIds").forEach((id) => member(String(id), sectionIds, "requirement section"));
    array(row.runtimeAssetIds, "requirement.runtimeAssetIds").forEach((id) => member(String(id), assetIds, "requirement runtime asset"));
  }
  for (const consequenceRule of assets.filter((entry) => record(entry, "asset").assetType === "PENDING_CONSEQUENCE_RULE")) {
    const row = record(consequenceRule, "consequenceRule");
    const payload = record(row.payload, "consequenceRule.payload");
    const consequences = array(payload.consequences, "consequenceRule.payload.consequences");
    const payoffBeats = array(payload.payoffBeats, "consequenceRule.payload.payoffBeats");
    count(payoffBeats.length, consequences.length, "consequenceRule payoff count");
    for (const payoff of payoffBeats) {
      const beat = record(payoff, "consequenceRule.payoffBeat");
      text(beat.beatId, "consequenceRule.payoffBeat.beatId");
      text(beat.action, "consequenceRule.payoffBeat.action");
      array(beat.actorRefs, "consequenceRule.payoffBeat.actorRefs");
      array(beat.requiredTermGroups, "consequenceRule.payoffBeat.requiredTermGroups");
      text(beat.resultCeiling, "consequenceRule.payoffBeat.resultCeiling");
    }
  }

  validateRuntimeIndex(index, assetIds, "runtimeIndex");
  return value as unknown as PartOneRuntimePackage;
}

function parseJson(path: string, code: string): Record<string, unknown> {
  try {
    return record(JSON.parse(readFileSync(path, "utf8")), path);
  } catch (error) {
    throw new Error(`${code}:${path}:${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateRuntimeIndex(raw: unknown, assetIds: string[], label: string): PartOneRuntimeIndex {
  const index = record(raw, label);
  equal(index.schemaVersion, "runtime-story-index-v1", `${label}.schemaVersion`);
  for (const field of [
    "byPart",
    "bySection",
    "byRequirement",
    "byDecisionKernel",
    "byCausalArc",
    "byActor",
    "byLocation",
    "byStateDependency",
    "byRetrievalTag",
    "byVisibilityClass",
  ]) {
    const bucket = record(index[field], `${label}.${field}`);
    for (const [key, values] of Object.entries(bucket)) {
      array(values, `${label}.${field}.${key}`).forEach((id) => member(String(id), assetIds, `${label} indexed asset`));
    }
  }
  return index as unknown as PartOneRuntimeIndex;
}

function buildRuntimeIndex(assets: PartOneRuntimeAsset[]): PartOneRuntimeIndex {
  const index: PartOneRuntimeIndex = {
    schemaVersion: "runtime-story-index-v1",
    byPart: {},
    bySection: {},
    byRequirement: {},
    byDecisionKernel: {},
    byCausalArc: {},
    byActor: {},
    byLocation: {},
    byStateDependency: {},
    byRetrievalTag: {},
    byVisibilityClass: {},
  };
  for (const asset of assets) {
    add(index.byPart, asset.partIds, asset.assetId);
    add(index.bySection, asset.sectionIds, asset.assetId);
    add(index.byRequirement, asset.requirementIds, asset.assetId);
    add(index.byDecisionKernel, asset.decisionKernelIds, asset.assetId);
    add(index.byCausalArc, asset.causalArcIds, asset.assetId);
    add(index.byActor, asset.actorRefs, asset.assetId);
    add(index.byStateDependency, asset.stateDependencies, asset.assetId);
    add(index.byRetrievalTag, asset.retrievalTags, asset.assetId);
    add(index.byVisibilityClass, asset.visibilityRules.map((rule) => rule.visibilityClass), asset.assetId);
  }
  sortIndex(index);
  return index;
}

function mergeRuntimeIndexes(base: PartOneRuntimeIndex, delta: PartOneRuntimeIndex): PartOneRuntimeIndex {
  const result = structuredClone(base);
  for (const field of [
    "byPart",
    "bySection",
    "byRequirement",
    "byDecisionKernel",
    "byCausalArc",
    "byActor",
    "byLocation",
    "byStateDependency",
    "byRetrievalTag",
    "byVisibilityClass",
  ] as const) {
    const destination = result[field];
    for (const [key, values] of Object.entries(delta[field])) {
      destination[key] = [...new Set([...(destination[key] || []), ...values])];
    }
  }
  sortIndex(result);
  return result;
}

function sortIndex(index: PartOneRuntimeIndex) {
  for (const field of [
    "byPart",
    "bySection",
    "byRequirement",
    "byDecisionKernel",
    "byCausalArc",
    "byActor",
    "byLocation",
    "byStateDependency",
    "byRetrievalTag",
    "byVisibilityClass",
  ] as const) {
    for (const values of Object.values(index[field])) values.sort();
  }
}

function add(bucket: Record<string, string[]>, keys: string[], assetId: string) {
  for (const key of keys) {
    if (!bucket[key]) bucket[key] = [];
    if (!bucket[key].includes(assetId)) bucket[key].push(assetId);
  }
}

function immutableHash(value: unknown) {
  return createHash("sha256").update(canonical(withoutImmutableHash(value))).digest("hex").toUpperCase();
}

function withoutImmutableHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutImmutableHash);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "immutableHash")
    .map(([key, entry]) => [key, withoutImmutableHash(entry)]));
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(label);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(label);
  return value as unknown[];
}

function text(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) fail(label);
  return value;
}

function hash(value: unknown, label: string) {
  const result = text(value, label);
  if (!/^[A-F0-9]{64}$/.test(result)) fail(label);
  return result;
}

function number(value: unknown, label: string) {
  if (!Number.isFinite(value)) fail(label);
  return Number(value);
}

function equal(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) fail(`${label}:${String(actual)}!=${String(expected)}`);
}

function count(actual: unknown, expected: number, label: string) {
  if (!Number.isInteger(actual) || actual !== expected) fail(`${label}:${String(actual)}!=${expected}`);
}

function uniqueIds(rows: unknown[], key: string, label: string) {
  const ids = rows.map((row) => text(record(row, label)[key], `${label}.${key}`));
  if (new Set(ids).size !== ids.length) fail(`${label} duplicate ${key}`);
  return ids;
}

function member(value: string, values: string[], label: string) {
  if (!values.includes(value)) fail(`${label}:${value}`);
}

function fail(label: string): never {
  throw new Error(`PART_ONE_RUNTIME_INVALID:${label}`);
}
