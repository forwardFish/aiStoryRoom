import { resolve } from "node:path";
import {
  compilePressureChapterBeatAuthoringPackageV1,
  type PressureActionCatalogReferenceV1,
  type PressureAuthorialMaterialReferenceV1,
  type PressureChapterBeatAuthoringPackageV1,
} from "./beat-authoring";
import { PressureSpineValidationError } from "./errors";
import {
  assertSangtianAuthorialSourceBindingV1,
  compileSangtianActionCatalogReferencesV1,
  compileSangtianMaterialReferencesV1,
  loadSangtianAuthorialContentV1,
  readSangtianAuthoringJsonV1,
} from "./sangtian-authorial-materials";

const CONFIG_ROOT = resolve(__dirname, "../../config/sangtian/pressure-chapter-v1");
const REGISTRY_PATH = "chapter-beat-authoring-registry-v1.json";
const ACTION_CATALOG_PATH = "release/action-presentation-catalog.json";

export interface SangtianPressureBeatAuthoringSourceV1 {
  package: Readonly<PressureChapterBeatAuthoringPackageV1>;
  authorialContent: Readonly<Record<string, unknown>>;
  referenceIndex: Readonly<{
    materials: readonly PressureAuthorialMaterialReferenceV1[];
    decisions: readonly PressureActionCatalogReferenceV1[];
  }>;
}

type RegistryEntry = {
  authoringPath: string;
  bindingsPath: string;
  authorialContentManifestPath: string;
  sourceBindingPaths: Record<string, string>;
};

const cache = new Map<string, SangtianPressureBeatAuthoringSourceV1>();

/**
 * Content-driven loader. Chapter registration selects files; the TypeScript
 * path has no chapter-specific branch and never reads runtime or database state.
 */
export function loadSangtianPressureChapterBeatAuthoringV1(
  chapterId: string,
): Readonly<PressureChapterBeatAuthoringPackageV1> {
  return loadSangtianPressureChapterBeatAuthoringSourceV1(chapterId).package;
}

export function loadSangtianPressureChapterBeatAuthoringSourceV1(
  chapterId: string,
): Readonly<SangtianPressureBeatAuthoringSourceV1> {
  const normalizedChapterId = text(chapterId, "chapterId");
  const cached = cache.get(normalizedChapterId);
  if (cached) return cached;
  const registry = record(
    readSangtianAuthoringJsonV1(CONFIG_ROOT, REGISTRY_PATH),
    "registry",
  );
  if (registry.schemaVersion !== "pressure_chapter_beat_authoring_registry_v1") {
    invalid("registry.schemaVersion", "UNSUPPORTED");
  }
  const chapters = record(registry.chapters, "registry.chapters");
  const entry = registryEntry(chapters[normalizedChapterId], normalizedChapterId);
  const authoring = readSangtianAuthoringJsonV1(CONFIG_ROOT, entry.authoringPath);
  const bindings = readSangtianAuthoringJsonV1(CONFIG_ROOT, entry.bindingsPath);
  const loadedAuthorial = loadSangtianAuthorialContentV1(
    CONFIG_ROOT,
    entry.authorialContentManifestPath,
  );
  const authorialContent = loadedAuthorial.content;
  if (authorialContent.nodeId !== normalizedChapterId) {
    invalid("authorialContent.nodeId", `EXPECTED_${normalizedChapterId}`);
  }
  assertSangtianAuthorialSourceBindingV1({
    configRoot: CONFIG_ROOT,
    sourceBinding: loadedAuthorial.sourceBinding,
    sourceBindingPaths: entry.sourceBindingPaths,
  });
  const referenceIndex = Object.freeze({
    materials: Object.freeze(compileSangtianMaterialReferencesV1(authorialContent)),
    decisions: Object.freeze(compileSangtianActionCatalogReferencesV1(
      readSangtianAuthoringJsonV1(CONFIG_ROOT, ACTION_CATALOG_PATH),
      normalizedChapterId,
    )),
  });
  const source = Object.freeze({
    package: compilePressureChapterBeatAuthoringPackageV1({
      authoring,
      bindings,
      referenceIndex,
    }),
    authorialContent,
    referenceIndex,
  });
  cache.set(normalizedChapterId, source);
  return source;
}

export function clearSangtianPressureBeatAuthoringCacheForTestsV1(): void {
  cache.clear();
}

function registryEntry(value: unknown, chapterId: string): RegistryEntry {
  const entry = record(value, `registry.chapters.${chapterId}`);
  exactKeys(entry, [
    "authoringPath",
    "bindingsPath",
    "authorialContentManifestPath",
    "sourceBindingPaths",
  ], `registry.chapters.${chapterId}`);
  const sourceBindingPaths = record(
    entry.sourceBindingPaths,
    `registry.chapters.${chapterId}.sourceBindingPaths`,
  );
  if (Object.keys(sourceBindingPaths).length === 0) {
    invalid(`registry.chapters.${chapterId}.sourceBindingPaths`, "NON_EMPTY");
  }
  return {
    authoringPath: text(entry.authoringPath, `registry.chapters.${chapterId}.authoringPath`),
    bindingsPath: text(entry.bindingsPath, `registry.chapters.${chapterId}.bindingsPath`),
    authorialContentManifestPath: text(
      entry.authorialContentManifestPath,
      `registry.chapters.${chapterId}.authorialContentManifestPath`,
    ),
    sourceBindingPaths: Object.fromEntries(Object.entries(sourceBindingPaths).map(([key, path]) => [
      text(key, `registry.chapters.${chapterId}.sourceBindingPaths.key`),
      text(path, `registry.chapters.${chapterId}.sourceBindingPaths.${key}`),
    ])),
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path, "OBJECT");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) invalid(`${path}.${unknown}`, "UNKNOWN_FIELD");
  const missing = keys.find((key) => !(key in value));
  if (missing) invalid(`${path}.${missing}`, "MISSING_FIELD");
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(path, "NON_EMPTY_STRING");
  return value.trim();
}

function invalid(path: string, detail: string): never {
  throw new PressureSpineValidationError(
    "PRESSURE_CHAPTER_BEAT_AUTHORING_SOURCE_INVALID",
    path,
    detail,
  );
}
