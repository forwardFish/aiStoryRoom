import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import type { LoadedRuntimeStoryPackage, RuntimeStoryPackage, StoryPackageManifest, StoryPackageSourceMap } from "./types";
import { validateRuntimeStoryPackage, validateStoryPackageManifest, validateStoryPackageSourceMap } from "./validation";

export const defaultStoryPackageConfigRoot = resolve(__dirname, "../../config");
const storyPackageCache = new Map<string, LoadedRuntimeStoryPackage>();

function parseJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`STORY_PACKAGE_JSON_INVALID:${path}:${error instanceof Error ? error.message : String(error)}`);
  }
}

function sha256Bytes(path: string): string {
  return createHash("sha256").update(readFileSync(path, "utf8")).digest("hex");
}

function resolveSafeRelativePath(root: string, relativePath: string): string {
  if (isAbsolute(relativePath)) throw new Error(`STORY_PACKAGE_PATH_INVALID:${relativePath}`);
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, relativePath);
  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${sep}`)) throw new Error(`STORY_PACKAGE_PATH_INVALID:${relativePath}`);
  return absolutePath;
}

function loadManifest(manifestPath: string): StoryPackageManifest {
  return validateStoryPackageManifest(parseJson(manifestPath));
}

function loadPackageJson(packagePath: string): RuntimeStoryPackage {
  return validateRuntimeStoryPackage(parseJson(packagePath));
}

function loadSourceMapJson(sourceMapPath: string): StoryPackageSourceMap {
  return validateStoryPackageSourceMap(parseJson(sourceMapPath));
}

function buildCacheKey(configRoot: string, worldId: string): string {
  return `${resolve(configRoot)}::${worldId}`;
}

export function clearStoryPackageCache() {
  storyPackageCache.clear();
}

export function getStoryPackageManifestPath(worldId: string, configRoot = defaultStoryPackageConfigRoot): string {
  return resolve(configRoot, worldId, "story-package", "manifest.json");
}

export function loadStoryPackage(worldId: string, configRoot = defaultStoryPackageConfigRoot): LoadedRuntimeStoryPackage {
  const cacheKey = buildCacheKey(configRoot, worldId);
  const cached = storyPackageCache.get(cacheKey);
  if (cached) return cached;
  const manifestPath = getStoryPackageManifestPath(worldId, configRoot);
  const manifestRoot = dirname(manifestPath);
  const manifest = loadManifest(manifestPath);
  if (manifest.worldId !== worldId) throw new Error(`STORY_PACKAGE_WORLD_ID_MISMATCH:${worldId}:${manifest.worldId}`);
  const storyPackagePath = resolveSafeRelativePath(manifestRoot, manifest.storyPackagePath);
  const sourceMapPath = resolveSafeRelativePath(manifestRoot, manifest.sourceMapPath);
  const storyPackageSha256 = sha256Bytes(storyPackagePath);
  const sourceMapSha256 = sha256Bytes(sourceMapPath);
  if (storyPackageSha256 !== manifest.storyPackageSha256) throw new Error(`STORY_PACKAGE_HASH_MISMATCH:${worldId}:story-package`);
  if (sourceMapSha256 !== manifest.sourceMapSha256) throw new Error(`STORY_SOURCE_MAP_HASH_MISMATCH:${worldId}:source-map`);
  const storyPackage = loadPackageJson(storyPackagePath);
  const sourceMap = loadSourceMapJson(sourceMapPath);
  if (storyPackage.worldId !== manifest.worldId || sourceMap.worldId !== manifest.worldId) throw new Error(`STORY_PACKAGE_MANIFEST_MISMATCH:${worldId}:worldId`);
  if (storyPackage.packageId !== manifest.packageId || sourceMap.packageId !== manifest.packageId) throw new Error(`STORY_PACKAGE_MANIFEST_MISMATCH:${worldId}:packageId`);
  if (storyPackage.packageVersion !== manifest.packageVersion || sourceMap.packageVersion !== manifest.packageVersion) throw new Error(`STORY_PACKAGE_MANIFEST_MISMATCH:${worldId}:packageVersion`);
  if (storyPackage.sourceMapSha256 !== manifest.sourceMapSha256) throw new Error(`STORY_SOURCE_MAP_HASH_MISMATCH:${worldId}:package-reference`);
  const loaded = { manifest, storyPackage, sourceMap, storyPackageSha256, sourceMapSha256 };
  storyPackageCache.set(cacheKey, loaded);
  return loaded;
}
