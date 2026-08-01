import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultStoryPackageConfigRoot } from "./loader";
import type { LoadedPartOneRuntimePackage, PartOneRuntimePackage } from "./part-one-runtime-types";

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

export function clearPartOneRuntimePackageCache() {
  cache.clear();
}

export function loadPartOneRuntimePackage(
  worldId: string,
  configRoot?: string
): LoadedPartOneRuntimePackage {
  const path = getPartOneRuntimePackagePath(worldId, configRoot);
  const cached = cache.get(path);
  if (cached) return cached;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`PART_ONE_RUNTIME_JSON_INVALID:${path}:${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = record(raw, "package");
  const expectedHash = hash(parsed.immutableHash, "immutableHash");
  const contentHash = immutableHash(parsed);
  if (contentHash !== expectedHash) {
    throw new Error(`PART_ONE_RUNTIME_HASH_MISMATCH:${worldId}`);
  }
  const value = validatePartOneRuntimePackage(parsed, worldId);
  const loaded = { package: value, contentHash, path };
  cache.set(path, loaded);
  return loaded;
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

  if (sections.length !== 4 || requirements.length !== 12 || assets.length !== 55 || kernelIds.length !== 15 || arcIds.length !== 4 || floorIds.length !== 4 || adaptations.length !== 7 || narrativePatternIds.length !== 3) {
    fail("frozen Part One cardinalities 4/12/55/15/4/4/7/3");
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

  equal(index.schemaVersion, "runtime-story-index-v1", "runtimeIndex.schemaVersion");
  const bySection = record(index.bySection, "runtimeIndex.bySection");
  for (const sectionId of sectionIds) {
    array(bySection[sectionId], `runtimeIndex.bySection.${sectionId}`).forEach((id) => member(String(id), assetIds, "indexed asset"));
  }
  return value as unknown as PartOneRuntimePackage;
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
