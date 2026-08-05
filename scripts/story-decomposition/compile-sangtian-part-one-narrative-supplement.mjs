import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  canonicalize,
  computeImmutableHash,
  readJson,
  repoRoot,
  sha256Bytes,
  validateWithSchema,
  writeJson,
} from "./lib/contract-utils.mjs";

const authoringRoot = resolve(repoRoot, "packages/templates/authoring/sangtian");
const baseRuntimePath = resolve(
  repoRoot,
  "packages/templates/config/sangtian/story-package/part-one-runtime.json",
);
const outputPath = resolve(
  process.env.SANGTIAN_NARRATIVE_SUPPLEMENT_PATH
    || resolve(
      repoRoot,
      "packages/templates/config/sangtian/story-package/part-one-narrative-supplement.json",
    ),
);
const patternSetPaths = [
  resolve(authoringRoot, "narrative/scene-patterns.section-02.approved.json"),
  resolve(authoringRoot, "narrative/scene-patterns.section-03.approved.json"),
  resolve(authoringRoot, "narrative/scene-patterns.section-04.approved.json"),
];
const checkOnly = process.argv.includes("--check");

const baseRuntime = await readJson(baseRuntimePath);
assert(
  baseRuntime.schemaVersion === "sangtian-part-one-runtime-package-v1"
  && baseRuntime.worldId === "sangtian"
  && baseRuntime.partId === "PART-01",
  "NARRATIVE_SUPPLEMENT_BASE_RUNTIME_INVALID",
);
assert(
  computeImmutableHash(baseRuntime) === baseRuntime.immutableHash,
  "NARRATIVE_SUPPLEMENT_BASE_HASH_INVALID",
);

const baseAssetIds = new Set(baseRuntime.assets.map((asset) => asset.assetId));
const baseDecisionKernelIds = new Set(
  baseRuntime.assets
    .filter((asset) => asset.assetType === "DECISION_KERNEL")
    .map((asset) => asset.assetId),
);
const baseSourceClaimIds = new Set(
  baseRuntime.assets.flatMap((asset) => asset.sourceClaimIds || []),
);
const sourceSceneAssetIds = new Set(
  baseRuntime.assets
    .filter((asset) => asset.assetType === "SOURCE_SCENE_EVIDENCE")
    .map((asset) => asset.assetId),
);
const sectionById = new Map(baseRuntime.sections.map((section) => [section.sectionId, section]));
const requiredSectionIds = ["SEC-P1-02", "SEC-P1-03", "SEC-P1-04"];
const requiredKernelIds = new Set(
  requiredSectionIds.flatMap((sectionId) => {
    const section = sectionById.get(sectionId);
    assert(section, `NARRATIVE_SUPPLEMENT_SECTION_MISSING:${sectionId}`);
    return section.activeDecisionKernelIds;
  }),
);

const sourcePatternSets = [];
const assets = [];
const seenPatternIds = new Set();
for (const path of patternSetPaths) {
  const bytes = await readFile(path);
  const set = JSON.parse(bytes.toString("utf8"));
  const validation = await validateWithSchema("narrative-scene-pattern-set-v1", set);
  assert(
    validation.valid,
    `NARRATIVE_SUPPLEMENT_PATTERN_SET_INVALID:${relative(repoRoot, path)}:${JSON.stringify(validation.errors)}`,
  );
  assert(set.worldId === "sangtian", `NARRATIVE_SUPPLEMENT_WORLD_MISMATCH:${set.worldId}`);
  assert(requiredSectionIds.includes(set.scopeId), `NARRATIVE_SUPPLEMENT_SCOPE_INVALID:${set.scopeId}`);
  assert(Array.isArray(set.patterns) && set.patterns.length >= 2, `NARRATIVE_SUPPLEMENT_PATTERN_SET_EMPTY:${set.scopeId}`);
  sourcePatternSets.push({
    path: relative(repoRoot, path).replaceAll("\\", "/"),
    sha256: sha256Bytes(bytes),
    scopeId: set.scopeId,
    version: set.version,
    patternCount: set.patterns.length,
  });

  const section = sectionById.get(set.scopeId);
  assert(section, `NARRATIVE_SUPPLEMENT_SECTION_MISSING:${set.scopeId}`);
  const activeKernelIds = new Set(section.activeDecisionKernelIds);
  const allowedRequirementIds = new Set(section.requiredRequirementIds);
  const allowedActorRefs = new Set(section.foregroundActorRefs);

  for (const pattern of set.patterns) {
    assert(pattern.reviewStatus === "APPROVED", `NARRATIVE_SUPPLEMENT_PATTERN_NOT_APPROVED:${pattern.patternId}`);
    assert(!seenPatternIds.has(pattern.patternId), `NARRATIVE_SUPPLEMENT_PATTERN_DUPLICATE:${pattern.patternId}`);
    assert(!baseAssetIds.has(pattern.patternId), `NARRATIVE_SUPPLEMENT_ASSET_COLLISION:${pattern.patternId}`);
    seenPatternIds.add(pattern.patternId);
    assert(
      pattern.sectionIds.length === 1 && pattern.sectionIds[0] === set.scopeId,
      `NARRATIVE_SUPPLEMENT_PATTERN_SCOPE_MISMATCH:${pattern.patternId}`,
    );
    assert(
      sourceSceneAssetIds.has(`SOURCE-SCENE-${pattern.sourceSceneId}`),
      `NARRATIVE_SUPPLEMENT_SOURCE_SCENE_UNKNOWN:${pattern.patternId}:${pattern.sourceSceneId}`,
    );
    assert(
      pattern.decisionKernelIds.length > 0
      && pattern.decisionKernelIds.every((id) => baseDecisionKernelIds.has(id) && activeKernelIds.has(id)),
      `NARRATIVE_SUPPLEMENT_KERNEL_BINDING_INVALID:${pattern.patternId}`,
    );
    assert(
      pattern.requirementIds.length > 0
      && pattern.requirementIds.every((id) => allowedRequirementIds.has(id)),
      `NARRATIVE_SUPPLEMENT_REQUIREMENT_BINDING_INVALID:${pattern.patternId}`,
    );
    assert(
      pattern.actorRefs.length > 0
      && pattern.actorRefs.every((id) => allowedActorRefs.has(id)),
      `NARRATIVE_SUPPLEMENT_ACTOR_BINDING_INVALID:${pattern.patternId}`,
    );
    assert(
      pattern.sourceClaimIds.length > 0
      && pattern.sourceClaimIds.every((id) => baseSourceClaimIds.has(id)),
      `NARRATIVE_SUPPLEMENT_SOURCE_CLAIM_UNKNOWN:${pattern.patternId}`,
    );
    assert(
      pattern.sourceRefs.length > 0
      && pattern.sourceRefs.every((ref) => (
        ref.sourceId
        && ref.sourceSha256 === "04D5E8D4533D86890A79058C25252D33E001668921A2BBD8FFDE401CDD2B6238"
        && ref.chapterId
        && ref.paragraphStartId
        && ref.paragraphEndId
        && Number.isInteger(ref.lineStart)
        && Number.isInteger(ref.lineEnd)
        && ref.lineStart > 0
        && ref.lineEnd >= ref.lineStart
        && /^[A-F0-9]{64}$/u.test(ref.textSpanSha256)
      )),
      `NARRATIVE_SUPPLEMENT_SOURCE_REF_INVALID:${pattern.patternId}`,
    );

    assets.push({
      schemaVersion: "runtime-story-asset-v1",
      assetId: pattern.patternId,
      assetType: "NARRATIVE_SCENE_PATTERN",
      partIds: ["PART-01"],
      sectionIds: [...pattern.sectionIds],
      requirementIds: [...pattern.requirementIds],
      decisionKernelIds: [...pattern.decisionKernelIds],
      causalArcIds: [...section.activeCausalArcIds],
      actorRefs: [...pattern.actorRefs],
      stateDependencies: [...section.handoffStatePaths],
      visibilityRules: [{
        visibilityClass: "SERVER_AUTHORITATIVE",
        rule: "Project only the dramatic mechanism and current player-visible Canon; source claims remain attributed evidence.",
      }],
      sourceClaimIds: [...pattern.sourceClaimIds],
      adaptationDecisionIds: [],
      retrievalTags: unique([
        "NARRATIVE_SCENE_PATTERN",
        set.scopeId,
        pattern.sourceSceneId,
        ...pattern.requirementIds,
        ...pattern.decisionKernelIds,
      ]),
      payload: pattern,
    });
  }
}

assets.sort((left, right) => left.assetId.localeCompare(right.assetId));
const coveredKernelIds = new Set(assets.flatMap((asset) => asset.decisionKernelIds));
const missingKernelIds = [...requiredKernelIds].filter((id) => !coveredKernelIds.has(id)).sort();
assert(
  missingKernelIds.length === 0,
  `NARRATIVE_SUPPLEMENT_KERNEL_COVERAGE_MISSING:${missingKernelIds.join(",")}`,
);

const supplement = {
  schemaVersion: "sangtian-part-one-narrative-supplement-v1",
  worldId: "sangtian",
  partId: "PART-01",
  baseRuntimeImmutableHash: baseRuntime.immutableHash,
  sourcePatternSets,
  contentCounts: {
    assets: assets.length,
    narrativeScenePatterns: assets.length,
    coveredDecisionKernels: coveredKernelIds.size,
  },
  coveredDecisionKernelIds: [...coveredKernelIds].sort(),
  assets,
  runtimeIndexDelta: buildRuntimeIndex(assets),
  immutableHash: "",
};
supplement.immutableHash = computeImmutableHash(supplement);

if (checkOnly) {
  const current = await readJson(outputPath).catch(() => null);
  assert(current, "NARRATIVE_SUPPLEMENT_OUTPUT_MISSING");
  assert(
    canonicalize(current) === canonicalize(supplement),
    "NARRATIVE_SUPPLEMENT_OUTPUT_STALE",
  );
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    mode: "CHECK",
    outputPath: relative(repoRoot, outputPath).replaceAll("\\", "/"),
    immutableHash: supplement.immutableHash,
    assetCount: assets.length,
    coveredDecisionKernelCount: coveredKernelIds.size,
  })}\n`);
} else {
  await writeJson(outputPath, supplement);
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    mode: "WRITE",
    outputPath: relative(repoRoot, outputPath).replaceAll("\\", "/"),
    immutableHash: supplement.immutableHash,
    assetCount: assets.length,
    coveredDecisionKernelCount: coveredKernelIds.size,
  })}\n`);
}

function buildRuntimeIndex(runtimeAssets) {
  const index = {
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
  for (const asset of runtimeAssets) {
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
  for (const bucket of Object.values(index).filter((value) => value && typeof value === "object" && !Array.isArray(value))) {
    for (const values of Object.values(bucket)) values.sort();
  }
  return index;
}

function add(bucket, keys, assetId) {
  for (const key of keys || []) {
    if (!bucket[key]) bucket[key] = [];
    if (!bucket[key].includes(assetId)) bucket[key].push(assetId);
  }
}

function unique(values) {
  return [...new Set(values)];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
