import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isSha256,
  sha256Canonical,
  type ScalarFactValueV1,
} from "@ai-story/shared";
import {
  validatePressureChapterRouteRegistryV1,
  type PressureChapterRouteRegistrationV1,
} from "../../runtime-contract/pressure-chapter-registry";
import type {
  CompileSangtianActionBindingInputV1,
  CompileSangtianChapterActionEffectsInputV1,
  CompiledSangtianActionBindingV1,
  CompiledSangtianChapterActionEffectsV1,
  PublishedSangtianActionReleaseV1,
  ReadSangtianActionPresentationInputV1,
  SangtianActionEffectPolicyV1,
  SangtianActionPreferredEntryV1,
  SangtianActionPresentationCatalogV1,
  SangtianActionPresentationV1,
  SangtianActionEffectWorkingIntentV1,
} from "./types";

const DEFAULT_RELEASE_ROOT = resolve(
  __dirname,
  "../../../config/sangtian/pressure-chapter-v1/release",
);
const EXPECTED_ROUTE_KEY = "sangtian_pressure_chapter_v1" as const;
const EXPECTED_RUNTIME_PROFILE = "SANGTIAN_CONTINUOUS_CHAPTER_V1" as const;
const EXPECTED_CHAPTER_IDS = Object.freeze([
  "N1",
  "N2",
  "N3",
  "N4",
  "N5",
  "N6",
  "N7",
] as const);
const ACTION_PREFERRED_ENTRIES = Object.freeze([
  "TALK",
  "INVESTIGATE",
  "TOKEN",
  "PLAN",
  "DEFER",
] as const satisfies readonly SangtianActionPreferredEntryV1[]);
const ACTION_PREFERRED_ENTRY_SET = new Set<string>(ACTION_PREFERRED_ENTRIES);
const requireCjs = require as unknown as (moduleId: string) => unknown;
const EXPECTED_ROUTE_REGISTRY_HASH =
  "ed7b03f220fb6ba2e6b1b64d7e78bde7db8b20b0fd7499b9dc5d0dcbe48b40a6";
const EXPECTED_RELEASE_ARTIFACT_HASHES = Object.freeze({
  action_effect_compiler_core:
    "70a47dcb3a3e28e3c8261865f45a4c0834c22b261629a592a1bc4a3f7ea95f63",
  action_effect_compiler_esm_wrapper:
    "335ca5e0c134aa6d48a896d3bbcf06ba5a0ca3b95997bafee25381aefd234405",
  action_effect_policy:
    "a149635a1419ead43f1f18017adc279d18973de8b3d52bdea5debf5af114b807",
  action_presentation_catalog:
    "ab50754c4ef6419325b0f4c52fc1ede876701304c46edb322b0822e45152948a",
  ai_decision_policy:
    "b9d752ab8ab40cc5885ef43d04c8404f18e184198db8ce52fc95e0e0a6fa9231",
} as const);

interface ReleaseManifestV1 {
  schemaVersion: "sangtian_pressure_chapter_release_manifest_v1";
  routeRegistry: unknown;
  artifacts: ReleaseArtifactV1[];
}

interface ReleaseArtifactV1 {
  artifactId: string;
  path: string;
  version: string;
  sha256: string;
  hashMode: "RAW_BYTES" | "CANONICAL_JSON";
}

interface SangtianActionEffectCoreModuleV1 {
  SANGTIAN_ACTION_EFFECT_COMPILER_VERSION_V1: string;
  loadSangtianActionEffectPolicyV1(options: {
    releaseRoot: string;
  }): SangtianActionEffectPolicyV1;
  loadSangtianActionPresentationCatalogV1(options: {
    releaseRoot: string;
  }): SangtianActionPresentationCatalogV1;
  compileSangtianActionBindingV1(
    policy: SangtianActionEffectPolicyV1,
    input: Readonly<CompileSangtianActionBindingInputV1>,
  ): CompiledSangtianActionBindingV1;
  compileSangtianChapterActionEffectsV1(
    policy: SangtianActionEffectPolicyV1,
    input: Readonly<CompileSangtianChapterActionEffectsInputV1>,
  ): CompiledSangtianChapterActionEffectsV1;
}

export const SANGTIAN_ACTION_RELEASE_ERROR_CODES = Object.freeze({
  MANIFEST_INVALID: "SANGTIAN_ACTION_RELEASE_MANIFEST_INVALID",
  ROUTE_NOT_PUBLISHED: "SANGTIAN_ACTION_RELEASE_ROUTE_NOT_PUBLISHED",
  ARTIFACT_HASH_MISMATCH: "SANGTIAN_ACTION_RELEASE_ARTIFACT_HASH_MISMATCH",
  CORE_MODULE_INVALID: "SANGTIAN_ACTION_RELEASE_CORE_MODULE_INVALID",
  COMPILED_RESULT_INVALID: "SANGTIAN_ACTION_RELEASE_COMPILED_RESULT_INVALID",
  PRESENTATION_NOT_FOUND: "SANGTIAN_ACTION_RELEASE_PRESENTATION_NOT_FOUND",
} as const);

export type SangtianActionReleaseErrorCode =
  (typeof SANGTIAN_ACTION_RELEASE_ERROR_CODES)[keyof typeof SANGTIAN_ACTION_RELEASE_ERROR_CODES];

export class SangtianActionReleaseError extends Error {
  readonly name = "SangtianActionReleaseError";

  constructor(
    readonly code: SangtianActionReleaseErrorCode,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
  }
}

export function loadPublishedSangtianActionReleaseV1(
  options: Readonly<{ releaseRoot?: string }> = {},
): PublishedSangtianActionReleaseV1 {
  const releaseRoot = resolve(options.releaseRoot ?? DEFAULT_RELEASE_ROOT);
  const manifest = readManifest(resolve(releaseRoot, "release-manifest.json"));
  const registry = validateRegistry(manifest.routeRegistry);
  const route = registry.routes.find(
    (candidate) => candidate.routeKey === EXPECTED_ROUTE_KEY,
  );
  if (
    !route
    || route.status !== "PUBLISHED"
    || route.createEnabled !== true
    || route.route.runtimeProfile !== EXPECTED_RUNTIME_PROFILE
  ) {
    fail("ROUTE_NOT_PUBLISHED", "releaseManifest.routeRegistry.routes");
  }
  if (registry.registryHash !== EXPECTED_ROUTE_REGISTRY_HASH) {
    fail("MANIFEST_INVALID", "releaseManifest.routeRegistry.registryHash");
  }

  const coreArtifact = verifyArtifact(
    manifest,
    releaseRoot,
    "action_effect_compiler_core",
    "action-effect-compiler.cjs",
    "RAW_BYTES",
    EXPECTED_RELEASE_ARTIFACT_HASHES.action_effect_compiler_core,
  );
  verifyArtifact(
    manifest,
    releaseRoot,
    "action_effect_compiler_esm_wrapper",
    "action-effect-compiler.mjs",
    "RAW_BYTES",
    EXPECTED_RELEASE_ARTIFACT_HASHES.action_effect_compiler_esm_wrapper,
  );
  verifyArtifact(
    manifest,
    releaseRoot,
    "action_effect_policy",
    "action-effect-policy.json",
    "CANONICAL_JSON",
    EXPECTED_RELEASE_ARTIFACT_HASHES.action_effect_policy,
  );
  verifyArtifact(
    manifest,
    releaseRoot,
    "action_presentation_catalog",
    "action-presentation-catalog.json",
    "CANONICAL_JSON",
    EXPECTED_RELEASE_ARTIFACT_HASHES.action_presentation_catalog,
  );
  verifyArtifact(
    manifest,
    releaseRoot,
    "ai_decision_policy",
    "ai-decision-policy.json",
    "CANONICAL_JSON",
    EXPECTED_RELEASE_ARTIFACT_HASHES.ai_decision_policy,
  );

  const core = requireCore(resolve(releaseRoot, coreArtifact.path));
  if (
    core.SANGTIAN_ACTION_EFFECT_COMPILER_VERSION_V1 !== coreArtifact.version
  ) {
    fail("CORE_MODULE_INVALID", "core.compilerVersion", coreArtifact.version);
  }
  const policy = core.loadSangtianActionEffectPolicyV1({ releaseRoot });
  const catalog = core.loadSangtianActionPresentationCatalogV1({ releaseRoot });
  assertPresentationCatalog(catalog);
  assertContentBinding(policy, catalog, route);

  const compileActionBinding = (
    input: Readonly<CompileSangtianActionBindingInputV1>,
  ): CompiledSangtianActionBindingV1 => assertCompiledBinding(
    core.compileSangtianActionBindingV1(policy, structuredClone(input)),
    input,
    policy,
  );
  const compileChapterActionEffects = (
    input: Readonly<CompileSangtianChapterActionEffectsInputV1>,
  ): CompiledSangtianChapterActionEffectsV1 => assertCompiledChapter(
    core.compileSangtianChapterActionEffectsV1(policy, structuredClone(input)),
    input,
    policy,
  );
  const readActionPresentation = (
    input: Readonly<ReadSangtianActionPresentationInputV1>,
  ): SangtianActionPresentationV1 => readPresentation(catalog, input);

  return deepFreeze({
    releaseRoot,
    route: {
      routeKey: EXPECTED_ROUTE_KEY,
      status: "PUBLISHED" as const,
      createEnabled: true as const,
      contentPackageVersion: route.contentPackageVersion,
      contentPackageSha256: route.contentPackageSha256,
    },
    routeRegistration: structuredClone(route),
    routeConfiguration: {
      registryVersion: registry.registryVersion,
      orchestrationPackageVersion: route.orchestrationPackageVersion,
      orchestrationPackageSha256: route.orchestrationPackageSha256,
      runtimeContractVersion: route.runtimeContractVersion,
      runtimeContractSha256: route.runtimeContractSha256,
      testMatrixVersion: route.testMatrixVersion,
      testMatrixSha256: route.testMatrixSha256,
      narrativeProfileVersion: route.narrativeProfileVersion,
      featureSetVersion: route.featureSetVersion,
      resultContractRegistryVersion: route.resultContractRegistryVersion,
      controlTopologyVersion: route.controlTopologyVersion,
    },
    policy: structuredClone(policy),
    catalog: structuredClone(catalog),
    compileActionBinding,
    compileChapterActionEffects,
    readActionPresentation,
  });
}

function readManifest(path: string): ReleaseManifestV1 {
  const value = readJson(path, "releaseManifest") as Partial<ReleaseManifestV1>;
  if (
    value.schemaVersion !== "sangtian_pressure_chapter_release_manifest_v1"
    || !Array.isArray(value.artifacts)
    || !value.routeRegistry
  ) {
    fail("MANIFEST_INVALID", "releaseManifest");
  }
  return value as ReleaseManifestV1;
}

function validateRegistry(value: unknown) {
  try {
    return validatePressureChapterRouteRegistryV1(value);
  } catch (error) {
    fail(
      "MANIFEST_INVALID",
      "releaseManifest.routeRegistry",
      error instanceof Error ? error.message : "INVALID",
    );
  }
}

function verifyArtifact(
  manifest: ReleaseManifestV1,
  releaseRoot: string,
  artifactId: string,
  expectedPath: string,
  expectedMode: ReleaseArtifactV1["hashMode"],
  expectedSha256: string,
): ReleaseArtifactV1 {
  const matches = manifest.artifacts.filter(
    (candidate) => candidate.artifactId === artifactId,
  );
  const artifact = matches[0];
  if (
    matches.length !== 1
    || !artifact
    || artifact.path !== expectedPath
    || artifact.hashMode !== expectedMode
    || artifact.sha256 !== expectedSha256
    || !artifact.version.trim()
    || !isSha256(artifact.sha256)
  ) {
    fail("MANIFEST_INVALID", `releaseManifest.artifacts.${artifactId}`);
  }
  const artifactPath = resolve(releaseRoot, artifact.path);
  const actual = expectedMode === "RAW_BYTES"
    ? sha256Raw(artifactPath)
    : sha256Canonical(readJson(artifactPath, artifactId));
  if (actual !== artifact.sha256) {
    fail(
      "ARTIFACT_HASH_MISMATCH",
      `releaseManifest.artifacts.${artifactId}`,
      `EXPECTED_${artifact.sha256}`,
    );
  }
  return structuredClone(artifact);
}

function requireCore(path: string): SangtianActionEffectCoreModuleV1 {
  let value: unknown;
  try {
    // CommonJS is the single production core. The ESM file is a verified wrapper only.
    value = requireCjs(path) as unknown;
  } catch (error) {
    fail(
      "CORE_MODULE_INVALID",
      "core.require",
      error instanceof Error ? error.message : "REQUIRE_FAILED",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("CORE_MODULE_INVALID", "core", "OBJECT");
  }
  const core = value as Partial<SangtianActionEffectCoreModuleV1>;
  for (const method of [
    "loadSangtianActionEffectPolicyV1",
    "loadSangtianActionPresentationCatalogV1",
    "compileSangtianActionBindingV1",
    "compileSangtianChapterActionEffectsV1",
  ] as const) {
    if (typeof core[method] !== "function") {
      fail("CORE_MODULE_INVALID", `core.${method}`, "FUNCTION");
    }
  }
  if (typeof core.SANGTIAN_ACTION_EFFECT_COMPILER_VERSION_V1 !== "string") {
    fail("CORE_MODULE_INVALID", "core.compilerVersion", "STRING");
  }
  return core as SangtianActionEffectCoreModuleV1;
}

function assertContentBinding(
  policy: SangtianActionEffectPolicyV1,
  catalog: SangtianActionPresentationCatalogV1,
  route: PressureChapterRouteRegistrationV1,
): void {
  if (
    policy.schemaVersion !== "sangtian_action_effect_policy_v1"
    || catalog.schemaVersion !== "sangtian_action_presentation_catalog_v1"
    || policy.runtimeProfile !== EXPECTED_RUNTIME_PROFILE
    || catalog.runtimeProfile !== EXPECTED_RUNTIME_PROFILE
    || policy.sourceBinding.contentPackageVersion !== route.contentPackageVersion
    || policy.sourceBinding.contentPackageSha256 !== route.contentPackageSha256
    || catalog.sourceBinding.contentPackageVersion !== route.contentPackageVersion
    || catalog.sourceBinding.contentPackageSha256 !== route.contentPackageSha256
  ) {
    fail("MANIFEST_INVALID", "release.contentBinding");
  }
}

function assertPresentationCatalog(
  catalog: SangtianActionPresentationCatalogV1,
): void {
  if (
    !catalog.defaultPassPresentation
    || catalog.defaultPassPresentation.preferredEntry !== "DEFER"
    || !catalog.defaultPassPresentation.label?.trim()
    || !catalog.defaultPassPresentation.description?.trim()
    || !Array.isArray(catalog.chapters)
    || catalog.chapters.length !== EXPECTED_CHAPTER_IDS.length
  ) {
    fail("MANIFEST_INVALID", "actionPresentationCatalog.identity");
  }

  let decisionCount = 0;
  let actionCount = 0;
  let defaultPassCount = 0;
  const chapterIds = new Set<string>();
  const bindingKeys = new Set<string>();
  const nonDefaultEntries = new Set<SangtianActionPreferredEntryV1>();

  for (const chapter of catalog.chapters) {
    if (
      !EXPECTED_CHAPTER_IDS.includes(chapter.chapterId)
      || chapterIds.has(chapter.chapterId)
      || !Array.isArray(chapter.decisions)
    ) {
      fail("MANIFEST_INVALID", "actionPresentationCatalog.chapters");
    }
    chapterIds.add(chapter.chapterId);

    for (const decision of chapter.decisions) {
      decisionCount += 1;
      if (!decision.decisionPointKey?.trim() || !Array.isArray(decision.actions)) {
        fail("MANIFEST_INVALID", "actionPresentationCatalog.decisions");
      }
      let decisionDefaultPassCount = 0;
      for (const action of decision.actions) {
        actionCount += 1;
        const bindingKey = [
          chapter.chapterId,
          decision.decisionPointKey,
          action.actionType,
        ].join("|");
        if (
          !action.actionType?.trim()
          || !action.label?.trim()
          || !action.description?.trim()
          || !isActionPreferredEntry(action.preferredEntry)
          || bindingKeys.has(bindingKey)
        ) {
          fail("MANIFEST_INVALID", "actionPresentationCatalog.actions");
        }
        bindingKeys.add(bindingKey);

        if (action.actionType === "DEFAULT_PASS") {
          defaultPassCount += 1;
          decisionDefaultPassCount += 1;
          if (action.preferredEntry !== "DEFER") {
            fail("MANIFEST_INVALID", "actionPresentationCatalog.defaultPass");
          }
        } else {
          if (action.preferredEntry === "DEFER") {
            fail("MANIFEST_INVALID", "actionPresentationCatalog.nonDefault");
          }
          nonDefaultEntries.add(action.preferredEntry);
        }
      }
      if (decisionDefaultPassCount !== 1) {
        fail("MANIFEST_INVALID", "actionPresentationCatalog.defaultPassCount");
      }
    }
  }

  if (
    chapterIds.size !== EXPECTED_CHAPTER_IDS.length
    || decisionCount !== 26
    || actionCount !== 72
    || defaultPassCount !== 26
    || nonDefaultEntries.size !== 4
    || catalog.completeness?.chapterCount !== 7
    || catalog.completeness?.decisionPointCount !== 26
    || catalog.completeness?.decisionActionPairCount !== 72
    || catalog.completeness?.coverageRule
      !== "EXACT_ACCEPTED_CONTENT_DECISION_ACTION_PAIRS"
  ) {
    fail("MANIFEST_INVALID", "actionPresentationCatalog.completeness");
  }
}

function assertCompiledBinding(
  value: CompiledSangtianActionBindingV1,
  input: Readonly<CompileSangtianActionBindingInputV1>,
  policy: SangtianActionEffectPolicyV1,
): CompiledSangtianActionBindingV1 {
  if (
    value.schemaVersion !== "sangtian_compiled_action_effect_v1"
    || value.policyVersion !== policy.policyVersion
    || value.compilerVersion !== policy.compilerVersion
    || value.chapterId !== input.chapterId
    || value.decisionPointKey !== input.decisionPointKey
    || value.seatId !== input.seatId
    || value.actionType !== input.actionType
    || value.resourcePolicy !== "NONE"
    || !isSha256(value.bindingHash)
  ) {
    fail("COMPILED_RESULT_INVALID", "actionBinding.identity");
  }
  assertWorkingIntent(value.workingIntent, "actionBinding.workingIntent");
  if (!Array.isArray(value.factContributions)) {
    fail("COMPILED_RESULT_INVALID", "actionBinding.factContributions");
  }
  for (const contribution of value.factContributions) {
    if (!contribution.factRef?.trim() || !isScalar(contribution.value)) {
      fail("COMPILED_RESULT_INVALID", "actionBinding.factContributions");
    }
  }
  const { bindingHash: _bindingHash, ...body } = value;
  if (sha256Canonical(body) !== value.bindingHash) {
    fail("COMPILED_RESULT_INVALID", "actionBinding.bindingHash");
  }
  return structuredClone(value);
}

function assertCompiledChapter(
  value: CompiledSangtianChapterActionEffectsV1,
  input: Readonly<CompileSangtianChapterActionEffectsInputV1>,
  policy: SangtianActionEffectPolicyV1,
): CompiledSangtianChapterActionEffectsV1 {
  if (
    value.schemaVersion !== "sangtian_compiled_chapter_action_effects_v1"
    || value.policyVersion !== policy.policyVersion
    || value.compilerVersion !== policy.compilerVersion
    || value.aggregationVersion !== policy.aggregationVersion
    || value.chapterId !== input.chapterId
    || (value.aggregationMode !== "ACTION_CONTRIBUTIONS"
      && value.aggregationMode !== "DEFAULT_TRAJECTORY_ONCE")
    || !Array.isArray(value.confirmedActionIds)
    || !Array.isArray(value.workingIntents)
    || !isEmptyArray(value.resourceReservationMutations)
    || !isEmptyArray(value.chapterEndResourceDispositions)
    || !isSha256(value.compilationHash)
  ) {
    fail("COMPILED_RESULT_INVALID", "chapterEffects.identity");
  }
  for (const item of value.workingIntents) {
    if (!item.actionId?.trim()) {
      fail("COMPILED_RESULT_INVALID", "chapterEffects.workingIntents.actionId");
    }
    assertWorkingIntent(item.workingIntent, "chapterEffects.workingIntents.intent");
  }
  if (!value.settlementFacts || typeof value.settlementFacts !== "object") {
    fail("COMPILED_RESULT_INVALID", "chapterEffects.settlementFacts");
  }
  for (const fact of Object.values(value.settlementFacts)) {
    if (!isScalar(fact)) {
      fail("COMPILED_RESULT_INVALID", "chapterEffects.settlementFacts");
    }
  }
  const { compilationHash: _compilationHash, ...body } = value;
  if (sha256Canonical(body) !== value.compilationHash) {
    fail("COMPILED_RESULT_INVALID", "chapterEffects.compilationHash");
  }
  return structuredClone(value);
}

function assertWorkingIntent(
  value: SangtianActionEffectWorkingIntentV1,
  path: string,
): void {
  if (
    !value
    || !["PUBLIC", "PARTICIPANTS", "PRIVATE"].includes(value.visibility)
    || !Array.isArray(value.targetSeatIds)
    || !Array.isArray(value.evidenceRefs)
    || !Array.isArray(value.resourceReservations)
    || !Array.isArray(value.commitmentMutations)
    || !Array.isArray(value.knowledgeGrants)
    || !Array.isArray(value.seatArcProgress)
    || value.resourceReservations.length !== 0
  ) {
    fail("COMPILED_RESULT_INVALID", path);
  }
}

function readPresentation(
  catalog: SangtianActionPresentationCatalogV1,
  input: Readonly<ReadSangtianActionPresentationInputV1>,
): SangtianActionPresentationV1 {
  if (
    input.contentPackageVersion !== catalog.sourceBinding.contentPackageVersion
    || input.contentPackageHash !== catalog.sourceBinding.contentPackageSha256
  ) {
    fail("PRESENTATION_NOT_FOUND", "presentation.contentBinding");
  }
  const action = catalog.chapters
    .find((chapter) => chapter.chapterId === input.chapterId)
    ?.decisions.find(
      (decision) => decision.decisionPointKey === input.decisionPointKey,
    )
    ?.actions.find((candidate) => candidate.actionType === input.actionType);
  if (
    !action
    || !action.label.trim()
    || !action.description.trim()
    || !isActionPreferredEntry(action.preferredEntry)
    || (action.actionType === "DEFAULT_PASS") !== (action.preferredEntry === "DEFER")
  ) {
    fail("PRESENTATION_NOT_FOUND", "presentation.binding");
  }
  return structuredClone(action);
}

function readJson(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    fail(
      "MANIFEST_INVALID",
      label,
      error instanceof Error ? error.message : "READ_FAILED",
    );
  }
}

function sha256Raw(path: string): string {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch (error) {
    fail(
      "ARTIFACT_HASH_MISMATCH",
      path,
      error instanceof Error ? error.message : "READ_FAILED",
    );
  }
}

function isScalar(value: unknown): value is ScalarFactValueV1 {
  return value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function isEmptyArray(value: unknown): value is [] {
  return Array.isArray(value) && value.length === 0;
}

function isActionPreferredEntry(
  value: unknown,
): value is SangtianActionPreferredEntryV1 {
  return typeof value === "string" && ACTION_PREFERRED_ENTRY_SET.has(value);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function fail(
  code: keyof typeof SANGTIAN_ACTION_RELEASE_ERROR_CODES,
  path: string,
  detail?: string,
): never {
  throw new SangtianActionReleaseError(
    SANGTIAN_ACTION_RELEASE_ERROR_CODES[code],
    path,
    detail,
  );
}
