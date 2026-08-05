import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import {
  assemblePartOneRuntimePackage,
  clearPartOneRuntimePackageCache,
  loadPartOneRuntimePackage,
  validatePartOneNarrativeSupplement,
  validatePartOneRuntimePackage,
} from "../src/story-package/part-one-runtime-loader";
import type { PartOneNarrativeSupplement } from "../src/story-package/part-one-runtime-types";

const configRoot = resolve(__dirname, "../config");
const baseRuntimePath = resolve(configRoot, "sangtian/story-package/part-one-runtime.json");
const supplementPath = resolve(configRoot, "sangtian/story-package/part-one-narrative-supplement.json");

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function immutableHash(value: unknown) {
  return createHash("sha256")
    .update(canonical(withoutImmutableHash(value)))
    .digest("hex")
    .toUpperCase();
}

function withoutImmutableHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutImmutableHash);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "immutableHash")
      .map(([key, entry]) => [key, withoutImmutableHash(entry)]),
  );
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

test("the narrative supplement extends the frozen base without replacing its hash", () => {
  clearPartOneRuntimePackageCache();
  const loaded = loadPartOneRuntimePackage("sangtian", configRoot);
  const base = validatePartOneRuntimePackage(readJson(baseRuntimePath));

  assert.equal(base.assets.length, 65);
  assert.equal(base.contentCounts.narrativeScenePatterns, 3);
  assert.equal(loaded.package.assets.length, 76);
  assert.equal(loaded.package.contentCounts.narrativeScenePatterns, 14);
  assert.equal(loaded.package.narrativeSupplement?.assetCount, 11);
  assert.equal(
    loaded.package.narrativeSupplement?.baseRuntimeImmutableHash,
    base.immutableHash,
  );
  assert.notEqual(loaded.package.immutableHash, base.immutableHash);
});

test("every Section Two through Four Kernel retrieves at least one approved scene pattern", () => {
  clearPartOneRuntimePackageCache();
  const pkg = loadPartOneRuntimePackage("sangtian", configRoot).package;
  const requiredKernelIds = pkg.sections
    .filter((section) => ["SEC-P1-02", "SEC-P1-03", "SEC-P1-04"].includes(section.sectionId))
    .flatMap((section) => section.activeDecisionKernelIds);

  assert.equal(new Set(requiredKernelIds).size, 12);
  for (const kernelId of requiredKernelIds) {
    const assetIds = pkg.runtimeIndex.byDecisionKernel[kernelId] || [];
    const patterns = assetIds
      .map((assetId) => pkg.assets.find((asset) => asset.assetId === assetId))
      .filter((asset) => asset?.assetType === "NARRATIVE_SCENE_PATTERN");
    assert.ok(patterns.length >= 1, `${kernelId} has no NarrativeScenePattern`);
    assert.ok(patterns.every((asset) => asset?.payload.reviewStatus === "APPROVED"));
  }
});

test("supplement tampering and duplicate IDs fail closed", () => {
  const base = validatePartOneRuntimePackage(readJson(baseRuntimePath));
  const original = readJson(supplementPath) as PartOneNarrativeSupplement;

  const tampered = structuredClone(original);
  tampered.assets[0]!.payload.dramaticFunction = "tampered";
  assert.throws(
    () => validatePartOneNarrativeSupplement(tampered, base),
    /immutable hash/u,
  );

  const duplicate = structuredClone(original);
  duplicate.assets[1]!.assetId = duplicate.assets[0]!.assetId;
  duplicate.immutableHash = immutableHash(duplicate);
  assert.throws(
    () => validatePartOneNarrativeSupplement(duplicate, base),
    /duplicate assetId/u,
  );
});

test("a missing supplement is not silently treated as complete Sangtian assets", () => {
  const root = mkdtempSync(resolve(tmpdir(), "sangtian-supplement-missing-"));
  const target = resolve(root, "sangtian/story-package/part-one-runtime.json");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readFileSync(baseRuntimePath));
  clearPartOneRuntimePackageCache();

  assert.throws(
    () => loadPartOneRuntimePackage("sangtian", root),
    /PART_ONE_NARRATIVE_SUPPLEMENT_MISSING/u,
  );
});

test("assembling the same verified base and supplement is deterministic", () => {
  const base = validatePartOneRuntimePackage(readJson(baseRuntimePath));
  const supplement = validatePartOneNarrativeSupplement(readJson(supplementPath), base);
  const first = assemblePartOneRuntimePackage(base, supplement);
  const second = assemblePartOneRuntimePackage(base, supplement);

  assert.equal(first.immutableHash, second.immutableHash);
  assert.deepEqual(first.runtimeIndex, second.runtimeIndex);
  assert.deepEqual(first.assets, second.assets);
});
