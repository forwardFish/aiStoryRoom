import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  clearPartOneRuntimePackageCache,
  loadPartOneRuntimePackage as loadFrozenPartOneRuntimePackage,
} from "../src/story-package/part-one-runtime-loader";
import {
  clearPlayablePartOneRuntimePackageCache,
  loadPlayablePartOneRuntimePackage,
} from "../src/story-package/playable-part-one-runtime";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configRoot = resolve(packageRoot, "config");
const authoringNarrativeRoot = resolve(packageRoot, "authoring/sangtian/narrative");
const approvalFiles = [
  "scene-patterns.section-02.approved.json",
  "scene-patterns.section-03.approved.json",
  "scene-patterns.section-04.approved.json",
];

test("the playable package extends but never replaces the frozen authoring release", () => {
  clearPartOneRuntimePackageCache();
  clearPlayablePartOneRuntimePackageCache();
  const frozen = loadFrozenPartOneRuntimePackage("sangtian", configRoot);
  const playable = loadPlayablePartOneRuntimePackage("sangtian", configRoot);

  assert.equal(frozen.package.assets.length, 65);
  assert.equal(frozen.package.contentCounts.narrativeScenePatterns, 3);
  assert.equal(frozen.package.authoringManifest.assetCount, 65);
  assert.equal(frozen.package.authoringManifest.narrativeScenePatternCount, 3);

  assert.equal(playable.package.assets.length, 76);
  assert.equal(playable.package.contentCounts.narrativeScenePatterns, 14);
  assert.equal(playable.package.authoringManifest.assetCount, 65);
  assert.equal(playable.package.authoringManifest.narrativeScenePatternCount, 3);
  assert.equal(playable.package.narrativeSupplement?.assetCount, 11);
  assert.equal(
    playable.package.narrativeSupplement?.baseRuntimeImmutableHash,
    frozen.package.immutableHash,
  );
  assert.notEqual(playable.package.immutableHash, frozen.package.immutableHash);
});

test("every Section Two through Four Kernel retrieves an approved scene pattern", () => {
  clearPartOneRuntimePackageCache();
  clearPlayablePartOneRuntimePackageCache();
  const pkg = loadPlayablePartOneRuntimePackage("sangtian", configRoot).package;
  const kernelIds = pkg.sections
    .filter((section) => ["SEC-P1-02", "SEC-P1-03", "SEC-P1-04"].includes(section.sectionId))
    .flatMap((section) => section.activeDecisionKernelIds);

  assert.equal(new Set(kernelIds).size, 12);
  assert.deepEqual(
    pkg.narrativeSupplement?.coveredDecisionKernelIds,
    [...new Set(kernelIds)].sort(),
  );
  for (const kernelId of kernelIds) {
    const patterns = (pkg.runtimeIndex.byDecisionKernel[kernelId] || [])
      .map((assetId) => pkg.assets.find((asset) => asset.assetId === assetId))
      .filter((asset) => asset?.assetType === "NARRATIVE_SCENE_PATTERN");
    assert.ok(patterns.length >= 1, `${kernelId} has no NarrativeScenePattern`);
    assert.ok(patterns.every((asset) => asset?.payload.reviewStatus === "APPROVED"));
  }
});

test("assembling the same frozen package and approvals is deterministic", () => {
  clearPartOneRuntimePackageCache();
  clearPlayablePartOneRuntimePackageCache();
  const first = loadPlayablePartOneRuntimePackage("sangtian", configRoot);
  clearPlayablePartOneRuntimePackageCache();
  const second = loadPlayablePartOneRuntimePackage("sangtian", configRoot);

  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.package.narrativeSupplement?.immutableHash, second.package.narrativeSupplement?.immutableHash);
  assert.deepEqual(first.package.runtimeIndex, second.package.runtimeIndex);
  assert.deepEqual(first.package.assets, second.package.assets);
});

test("a missing approval set fails closed before a model call", () => {
  const fixture = createFixture("missing");
  for (const fileName of approvalFiles.slice(0, 2)) {
    cpSync(
      resolve(authoringNarrativeRoot, fileName),
      resolve(fixture.narrativeRoot, fileName),
    );
  }
  clearPartOneRuntimePackageCache();
  clearPlayablePartOneRuntimePackageCache();

  assert.throws(
    () => loadPlayablePartOneRuntimePackage("sangtian", fixture.configRoot),
    /PART_ONE_NARRATIVE_APPROVAL_INVALID/u,
  );
});

test("a tampered source binding fails closed before a model call", () => {
  const fixture = createFixture("tampered");
  for (const fileName of approvalFiles) {
    cpSync(
      resolve(authoringNarrativeRoot, fileName),
      resolve(fixture.narrativeRoot, fileName),
    );
  }
  const target = resolve(fixture.narrativeRoot, approvalFiles[0]!);
  const document = JSON.parse(readFileSync(target, "utf8"));
  document.patterns[0].sourceRefs[0].sourceSha256 = "A".repeat(64);
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  clearPartOneRuntimePackageCache();
  clearPlayablePartOneRuntimePackageCache();

  assert.throws(
    () => loadPlayablePartOneRuntimePackage("sangtian", fixture.configRoot),
    /PART_ONE_NARRATIVE_SOURCE_REF_INVALID/u,
  );
});

test("a globally valid Claim from another source scene fails closed before a model call", () => {
  const fixture = createFixture("cross-scene-claim");
  for (const fileName of approvalFiles) {
    cpSync(
      resolve(authoringNarrativeRoot, fileName),
      resolve(fixture.narrativeRoot, fileName),
    );
  }
  const target = resolve(fixture.narrativeRoot, approvalFiles[0]!);
  const document = JSON.parse(readFileSync(target, "utf8")) as {
    patterns: Array<{
      patternId: string;
      sourceSceneId: string;
      sourceClaimIds: string[];
    }>;
  };
  const first = document.patterns[0]!;
  const otherScenePattern = document.patterns.find((pattern) => (
    pattern.sourceSceneId !== first.sourceSceneId
    && pattern.sourceClaimIds.length > 0
  ));
  assert.ok(otherScenePattern, "fixture requires two patterns bound to different source scenes");
  first.sourceClaimIds[0] = otherScenePattern.sourceClaimIds[0]!;
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  clearPartOneRuntimePackageCache();
  clearPlayablePartOneRuntimePackageCache();

  assert.throws(
    () => loadPlayablePartOneRuntimePackage("sangtian", fixture.configRoot),
    /PART_ONE_NARRATIVE_SOURCE_CLAIM_CROSS_SCENE/u,
  );
});

function createFixture(label: string) {
  const root = mkdtempSync(resolve(tmpdir(), `sangtian-narrative-${label}-`));
  const fixtureConfigRoot = resolve(root, "config");
  const runtimeRoot = resolve(fixtureConfigRoot, "sangtian/story-package");
  const narrativeRoot = resolve(root, "authoring/sangtian/narrative");
  mkdirSync(runtimeRoot, { recursive: true });
  mkdirSync(narrativeRoot, { recursive: true });
  cpSync(
    resolve(configRoot, "sangtian/story-package/part-one-runtime.json"),
    resolve(runtimeRoot, "part-one-runtime.json"),
  );
  return {
    configRoot: fixtureConfigRoot,
    narrativeRoot,
  };
}
