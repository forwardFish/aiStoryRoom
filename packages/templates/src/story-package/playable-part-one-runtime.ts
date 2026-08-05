import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import {
  loadPartOneRuntimePackage as loadFrozenPartOneRuntimePackage,
} from "./part-one-runtime-loader";
import type {
  LoadedPartOneRuntimePackage,
  PartOneRuntimeAsset,
  PartOneRuntimeIndex,
  PartOneRuntimePackage,
} from "./part-one-runtime-types";

const approvalFileNames = [
  "scene-patterns.section-02.approved.json",
  "scene-patterns.section-03.approved.json",
  "scene-patterns.section-04.approved.json",
] as const;
const requiredSectionIds = ["SEC-P1-02", "SEC-P1-03", "SEC-P1-04"] as const;
const ORIGINAL_SOURCE_SHA = "04D5E8D4533D86890A79058C25252D33E001668921A2BBD8FFDE401CDD2B6238";
const cache = new Map<string, LoadedPartOneRuntimePackage>();

export function clearPlayablePartOneRuntimePackageCache() {
  cache.clear();
}

/**
 * Production-facing Part One loader.
 *
 * The immutable 65-asset authoring release is always validated first by the
 * frozen loader. Sangtian then receives an independently hashed narrative
 * supplement compiled from three APPROVED source-grounded pattern sets. The
 * supplement cannot alter the authoring manifest, settlement rules or existing
 * assets; it only contributes NarrativeScenePattern assets and index entries.
 */
export function loadPlayablePartOneRuntimePackage(
  worldId: string,
  configRoot?: string,
): LoadedPartOneRuntimePackage {
  const base = loadFrozenPartOneRuntimePackage(worldId, configRoot);
  if (worldId !== "sangtian") return base;

  const templatesRoot = resolve(dirname(base.path), "..", "..", "..");
  const narrativeRoot = resolve(templatesRoot, "authoring", "sangtian", "narrative");
  const sourceRows = approvalFileNames.map((fileName) => {
    const path = resolve(narrativeRoot, fileName);
    let bytes: Buffer;
    let value: unknown;
    try {
      bytes = readFileSync(path);
      value = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      throw new Error(
        `PART_ONE_NARRATIVE_APPROVAL_INVALID:${path}:${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return {
      path,
      bytes,
      value,
      sha256: sha256(bytes),
    };
  });
  const cacheKey = [
    base.contentHash,
    ...sourceRows.map((row) => row.sha256),
  ].join(":");
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const pkg = assemblePlayablePackage(base.package, templatesRoot, sourceRows);
  const loaded = {
    package: pkg,
    contentHash: pkg.immutableHash,
    path: base.path,
  };
  cache.set(cacheKey, loaded);
  return loaded;
}

function assemblePlayablePackage(
  base: PartOneRuntimePackage,
  templatesRoot: string,
  sourceRows: Array<{ path: string; bytes: Buffer; value: unknown; sha256: string }>,
): PartOneRuntimePackage {
  if (
    base.assets.length !== 65
    || base.contentCounts.narrativeScenePatterns !== 3
    || base.authoringManifest.assetCount !== 65
    || base.authoringManifest.narrativeScenePatternCount !== 3
  ) {
    throw new Error("PART_ONE_NARRATIVE_BASE_CARDINALITY_MISMATCH");
  }

  const baseAssetIds = new Set(base.assets.map((asset) => asset.assetId));
  const baseKernelIds = new Set(
    base.assets.filter((asset) => asset.assetType === "DECISION_KERNEL").map((asset) => asset.assetId),
  );
  const baseClaimIds = new Set(base.assets.flatMap((asset) => asset.sourceClaimIds));
  const baseActorRefs = new Set(base.assets.flatMap((asset) => asset.actorRefs));
  const sourceSceneClaimIds = new Map(
    base.assets
      .filter((asset) => asset.assetType === "SOURCE_SCENE_EVIDENCE")
      .map((asset) => [
        asset.assetId.replace(/^SOURCE-SCENE-/u, ""),
        new Set(asset.sourceClaimIds),
      ] as const),
  );
  const sectionById = new Map(base.sections.map((section) => [section.sectionId, section]));
  const requiredKernelIds = new Set(
    requiredSectionIds.flatMap((sectionId) => {
      const section = sectionById.get(sectionId);
      if (!section) throw new Error(`PART_ONE_NARRATIVE_SECTION_MISSING:${sectionId}`);
      return section.activeDecisionKernelIds;
    }),
  );

  const supplementAssets: PartOneRuntimeAsset[] = [];
  const seenPatternIds = new Set<string>();
  const sourcePatternSets: Array<{
    path: string;
    sha256: string;
    scopeId: string;
    version: string;
    patternCount: number;
  }> = [];

  for (const sourceRow of sourceRows) {
    const set = asRecord(sourceRow.value, "patternSet");
    exact(set.schemaVersion, "narrative-scene-pattern-set-v1", "patternSet.schemaVersion");
    exact(set.worldId, "sangtian", "patternSet.worldId");
    const scopeId = requiredText(set.scopeId, "patternSet.scopeId");
    if (!requiredSectionIds.includes(scopeId as typeof requiredSectionIds[number])) {
      throw new Error(`PART_ONE_NARRATIVE_SCOPE_INVALID:${scopeId}`);
    }
    const version = requiredText(set.version, "patternSet.version");
    const patterns = asArray(set.patterns, "patternSet.patterns");
    if (patterns.length < 2) throw new Error(`PART_ONE_NARRATIVE_PATTERN_SET_EMPTY:${scopeId}`);
    sourcePatternSets.push({
      path: relative(templatesRoot, sourceRow.path).replaceAll("\\", "/"),
      sha256: sourceRow.sha256,
      scopeId,
      version,
      patternCount: patterns.length,
    });

    const section = sectionById.get(scopeId)!;
    const activeKernelIds = new Set(section.activeDecisionKernelIds);
    const allowedRequirementIds = new Set(section.requiredRequirementIds);
    const foregroundActorRefs = new Set(section.foregroundActorRefs);

    for (const rawPattern of patterns) {
      const pattern = asRecord(rawPattern, "pattern");
      const patternId = requiredText(pattern.patternId, "pattern.patternId");
      exact(pattern.schemaVersion, "narrative-scene-pattern-v1", `${patternId}.schemaVersion`);
      exact(pattern.reviewStatus, "APPROVED", `${patternId}.reviewStatus`);
      if (seenPatternIds.has(patternId) || baseAssetIds.has(patternId)) {
        throw new Error(`PART_ONE_NARRATIVE_PATTERN_DUPLICATE:${patternId}`);
      }
      seenPatternIds.add(patternId);
      const sectionIds = textArray(pattern.sectionIds, `${patternId}.sectionIds`);
      if (sectionIds.length !== 1 || sectionIds[0] !== scopeId) {
        throw new Error(`PART_ONE_NARRATIVE_PATTERN_SCOPE_MISMATCH:${patternId}`);
      }
      const sourceSceneId = requiredText(pattern.sourceSceneId, `${patternId}.sourceSceneId`);
      const allowedSourceSceneClaimIds = sourceSceneClaimIds.get(sourceSceneId);
      if (!allowedSourceSceneClaimIds) {
        throw new Error(`PART_ONE_NARRATIVE_SOURCE_SCENE_UNKNOWN:${patternId}:${sourceSceneId}`);
      }
      const decisionKernelIds = textArray(pattern.decisionKernelIds, `${patternId}.decisionKernelIds`);
      if (
        !decisionKernelIds.length
        || decisionKernelIds.some((id) => !baseKernelIds.has(id) || !activeKernelIds.has(id))
      ) {
        throw new Error(`PART_ONE_NARRATIVE_KERNEL_BINDING_INVALID:${patternId}`);
      }
      const requirementIds = textArray(pattern.requirementIds, `${patternId}.requirementIds`);
      if (!requirementIds.length || requirementIds.some((id) => !allowedRequirementIds.has(id))) {
        throw new Error(`PART_ONE_NARRATIVE_REQUIREMENT_BINDING_INVALID:${patternId}`);
      }
      const actorRefs = textArray(pattern.actorRefs, `${patternId}.actorRefs`);
      if (
        !actorRefs.length
        || actorRefs.some((id) => !baseActorRefs.has(id))
        || !actorRefs.some((id) => foregroundActorRefs.has(id))
      ) {
        throw new Error(`PART_ONE_NARRATIVE_ACTOR_BINDING_INVALID:${patternId}`);
      }
      const sourceClaimIds = textArray(pattern.sourceClaimIds, `${patternId}.sourceClaimIds`);
      if (!sourceClaimIds.length || sourceClaimIds.some((id) => !baseClaimIds.has(id))) {
        throw new Error(`PART_ONE_NARRATIVE_SOURCE_CLAIM_UNKNOWN:${patternId}`);
      }
      const crossSceneClaimIds = sourceClaimIds.filter((id) => !allowedSourceSceneClaimIds.has(id));
      if (crossSceneClaimIds.length) {
        throw new Error(
          `PART_ONE_NARRATIVE_SOURCE_CLAIM_CROSS_SCENE:${patternId}:${sourceSceneId}:${crossSceneClaimIds.join(",")}`,
        );
      }
      validateSourceRefs(pattern.sourceRefs, patternId);
      validatePatternShape(pattern, patternId);

      supplementAssets.push({
        schemaVersion: "runtime-story-asset-v1",
        assetId: patternId,
        assetType: "NARRATIVE_SCENE_PATTERN",
        partIds: ["PART-01"],
        sectionIds,
        requirementIds,
        decisionKernelIds,
        causalArcIds: [...section.activeCausalArcIds],
        actorRefs,
        stateDependencies: [...section.handoffStatePaths],
        visibilityRules: [{
          visibilityClass: "SERVER_AUTHORITATIVE",
          rule: "Project only the dramatic mechanism and current player-visible Canon; source claims remain attributed evidence.",
        }],
        sourceClaimIds,
        adaptationDecisionIds: [],
        retrievalTags: unique([
          "NARRATIVE_SCENE_PATTERN",
          scopeId,
          sourceSceneId,
          ...requirementIds,
          ...decisionKernelIds,
        ]),
        payload: pattern,
      });
    }
  }

  supplementAssets.sort((left, right) => left.assetId.localeCompare(right.assetId));
  if (supplementAssets.length !== 11) {
    throw new Error(`PART_ONE_NARRATIVE_PATTERN_CARDINALITY:${supplementAssets.length}`);
  }
  const coveredDecisionKernelIds = unique(
    supplementAssets.flatMap((asset) => asset.decisionKernelIds),
  ).sort();
  if (
    coveredDecisionKernelIds.length !== requiredKernelIds.size
    || [...requiredKernelIds].some((id) => !coveredDecisionKernelIds.includes(id))
  ) {
    throw new Error("PART_ONE_NARRATIVE_KERNEL_COVERAGE_INCOMPLETE");
  }

  const runtimeIndexDelta = buildRuntimeIndex(supplementAssets);
  const supplementEnvelope = {
    schemaVersion: "sangtian-part-one-narrative-supplement-v1",
    worldId: "sangtian",
    partId: "PART-01",
    baseRuntimeImmutableHash: base.immutableHash,
    sourcePatternSets,
    contentCounts: {
      assets: supplementAssets.length,
      narrativeScenePatterns: supplementAssets.length,
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
  assert(canonicalize(current) === canonicalize(supplement), "NARRATIVE_SUPPLEMENT_OUTPUT_STALE");
} else {
  await writeJson(outputPath, supplement);
}
process.stdout.write(`${JSON.stringify({
  status: "PASS",
  mode: checkOnly ? "CHECK" : "WRITE",
  outputPath: relative(repoRoot, outputPath).replaceAll("\\", "/"),
  immutableHash: supplement.immutableHash,
  assetCount: assets.length,
  coveredDecisionKernelCount: coveredKernelIds.size,
})}\n`);

function validSourceRef(ref) {
  return Boolean(
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
  );
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
