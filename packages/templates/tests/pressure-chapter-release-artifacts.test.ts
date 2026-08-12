import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  CHAPTER_IDS_V1,
  NARRATIVE_STATUSES_V1,
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  hashWithoutField,
  sha256Canonical,
} from "@ai-story/shared";
import {
  PRESSURE_CHAPTER_ROUTE_TUPLE_V1,
  PressureChapterRouteRegistry,
  PressureChapterRouteRegistryError,
  computePressureChapterRouteRegistryHash,
  validatePressureChapterRouteRegistryV1,
  type PressureChapterRouteRegistryV1,
} from "../src/runtime-contract/pressure-chapter-registry";
import {
  compileSangtianChapterPolicyMaterialV1,
  contentPolicyHashForChapterV1,
} from "../src/pressure-chapter/content/chapter-policy";
import { loadSangtianPressureChapterPackageV1 } from "../src/pressure-chapter/content/loader";
import { SANGTIAN_PRESSURE_CHAPTER_ROUTE_KEY_V1 } from "../src/pressure-chapter/content/registry";

type JsonObject = Record<string, any>;

interface ArtifactReference {
  artifactId: string;
  path: string;
  version: string;
  sha256: string;
  hashMode: "CANONICAL_JSON" | "RAW_BYTES";
}

interface ReleaseManifest extends JsonObject {
  routeRegistry: PressureChapterRouteRegistryV1;
  immutableInputs: ArtifactReference[];
  artifacts: ArtifactReference[];
  rejectedRouteCandidates: Array<{
    candidateId: string;
    routeMutation?: Record<string, string>;
    fixedPhases?: string[];
    reasonCode: string;
  }>;
}

interface ConfirmedAction {
  actionId: string;
  decisionPointKey: string;
  seatId: string;
  actionType: string;
}

interface ActionEffectCompilerModule {
  SANGTIAN_ACTION_EFFECT_COMPILER_VERSION_V1: string;
  loadSangtianActionEffectPolicyV1(): JsonObject;
  loadSangtianActionPresentationCatalogV1(): JsonObject;
  compileSangtianActionBindingV1(policy: JsonObject, input: {
    chapterId: string;
    decisionPointKey: string;
    seatId: string;
    actionType: string;
  }): JsonObject;
  compileSangtianChapterActionEffectsV1(policy: JsonObject, input: {
    chapterId: string;
    confirmedActions: ConfirmedAction[];
    defaultEvents: Array<{ eventId: string; eventType: "APPLY_DEFAULT_TRAJECTORY" }>;
  }): JsonObject;
}

const REPO_ROOT = path.resolve(__dirname, "../../..");
const RELEASE_ROOT = path.resolve(
  __dirname,
  "../config/sangtian/pressure-chapter-v1/release",
);
const PACKAGE_ROOT = path.resolve(RELEASE_ROOT, "..");
const RELEASE_MANIFEST_PATH = path.resolve(RELEASE_ROOT, "release-manifest.json");
const COMPILER_CORE_PATH = path.resolve(RELEASE_ROOT, "action-effect-compiler.cjs");
const COMPILER_PATH = path.resolve(RELEASE_ROOT, "action-effect-compiler.mjs");
const PLACEHOLDER = /^(?:TBD|TODO|UNKNOWN)$/iu;
const HAN = /\p{Script=Han}/u;

async function loadActionCompiler(): Promise<ActionEffectCompilerModule> {
  return await import(pathToFileURL(COMPILER_PATH).href) as ActionEffectCompilerModule;
}

function requireActionCompiler(): ActionEffectCompilerModule {
  return createRequire(path.resolve(RELEASE_ROOT, "production-require-probe.cjs"))(
    COMPILER_CORE_PATH,
  ) as ActionEffectCompilerModule;
}

function readJson<T = JsonObject>(absolutePath: string): T {
  return JSON.parse(readFileSync(absolutePath, "utf8")) as T;
}

function readReleaseArtifact(fileName: string): JsonObject {
  return readJson(path.resolve(RELEASE_ROOT, fileName));
}

function assertPackageLocal(referencePath: string): string {
  const resolved = path.resolve(RELEASE_ROOT, referencePath);
  const relative = path.relative(PACKAGE_ROOT, resolved);
  assert.equal(
    relative === ".." || relative.startsWith(`..${path.sep}`),
    false,
    `${referencePath} escapes the accepted package root`,
  );
  return resolved;
}

function assertNoPlaceholders(value: unknown, at = "$release"): void {
  if (typeof value === "string") {
    assert.equal(PLACEHOLDER.test(value.trim()), false, `${at} contains a placeholder`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPlaceholders(item, `${at}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertNoPlaceholders(item, `${at}.${key}`);
    }
  }
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key);
      collectKeys(item, keys);
    }
  }
  return keys;
}

function sha256Bytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function expectRegistryCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.equal(error instanceof PressureChapterRouteRegistryError, true);
    assert.equal((error as PressureChapterRouteRegistryError).code, code);
    return true;
  });
}

function expectActionPolicyCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: any) => {
    assert.equal(error?.code, code);
    return true;
  });
}

function outcomeBandForFacts(chapterId: string, settlementFacts: JsonObject): string {
  const loaded = loadSangtianPressureChapterPackageV1(PACKAGE_ROOT);
  const chapter = loaded.content.chapters.find((candidate) => candidate.chapterId === chapterId)!;
  const base = {
    schemaVersion: "sangtian_chapter_settlement_input_v1" as const,
    runId: `release-artifact-${chapterId}`,
    chapterRuntimeId: `release-runtime-${chapterId}`,
    chapterId: chapterId as any,
    baseWorldSequence: Number(chapterId.slice(1)) - 1,
    baseWorldStateHash: sha256Canonical({ chapterId, kind: "world" }),
    runRouteHash: sha256Canonical({ chapterId, kind: "route" }),
    previousFrozenHash: sha256Canonical({ chapterId, kind: "previous" }),
    decisionLedgerHash: sha256Canonical({ chapterId, kind: "ledger" }),
    finalWorkingStateHash: sha256Canonical({ chapterId, kind: "working" }),
    sealedDecisionActionIds: [],
    reservationLedgerHash: sha256Canonical({ chapterId, kind: "reservations" }),
    contentPolicyVersion: chapter.settlementPolicy.policyVersion,
    contentPolicyHash: contentPolicyHashForChapterV1(chapterId as any, loaded),
    settlementContractVersion: "sangtian-action-effect-1.0.0",
    settlementContractHash: sha256Canonical({ chapterId, kind: "action-effect" }),
  };
  const settlementInput = {
    ...base,
    inputHash: sha256Canonical(base),
  };
  return compileSangtianChapterPolicyMaterialV1({
    settlementInput,
    settlementFacts,
    package: loaded,
  }).outcomeBand;
}

function fixtureActions(chapterPolicy: JsonObject, tokens: string[]): ConfirmedAction[] {
  const cursorByDecision = new Map<string, number>();
  return tokens.map((token, index) => {
    const [actionType, explicitSeat] = token.split("@");
    const decision = chapterPolicy.decisions.find((candidate: JsonObject) =>
      candidate.actions.some((action: JsonObject) => action.actionType === actionType));
    assert.ok(decision, `${chapterPolicy.chapterId}:${actionType}`);
    const cursor = cursorByDecision.get(decision.decisionPointKey) ?? 0;
    cursorByDecision.set(decision.decisionPointKey, cursor + 1);
    const seatId = explicitSeat ?? decision.requiredSeatIds[cursor % decision.requiredSeatIds.length];
    return {
      actionId: `fixture.${chapterPolicy.chapterId}.${index}.${actionType}.${seatId}`,
      decisionPointKey: decision.decisionPointKey,
      seatId,
      actionType,
    };
  });
}

function permutations<T>(values: T[]): T[][] {
  if (values.length <= 1) return [[...values]];
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += 1) {
    const head = values[index]!;
    const tail = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const permutation of permutations(tail)) output.push([head, ...permutation]);
  }
  return output;
}

function normalizeSourceDefault(chapterId: string, raw: JsonObject): JsonObject {
  if (chapterId === "N5") {
    return {
      reliefUsePct: raw.reliefUsePct,
      landPurchaseUsePct: raw.landPurchaseUsePct,
      contractConsistency: raw.contractConsistency,
      landSaleStopped: raw.landSaleStopped,
      publicFrameFalse: raw.publicNameAuthorization === "FALSE_PUBLIC_FRAME",
    };
  }
  if (chapterId === "N6") {
    return {
      ledgerCount: raw.verifiableLedgerSetCount,
      merchantExplanationChainPreserved: raw.merchantExplanationChainPreserved,
      assetAuditGrade: raw.assetAuditGrade,
      soleScapegoat: raw.soleScapegoat,
    };
  }
  return structuredClone(raw);
}

test("release registry binds actual JSON or module bytes and the exact five-tuple", async () => {
  const manifest = readJson<ReleaseManifest>(RELEASE_MANIFEST_PATH);
  assertNoPlaceholders(manifest);
  assert.deepEqual(
    manifest.artifacts.map((reference) => reference.artifactId),
    [
      "a_emotion_lifecycle_bindings",
      "a_emotion_policy",
      "action_effect_compiler_core",
      "action_effect_compiler_esm_wrapper",
      "action_effect_policy",
      "action_presentation_catalog",
      "ai_decision_policy",
      "control_topology",
      "feature_set",
      "illegal_route_matrix",
      "legacy_route_mapping",
      "narrative_profile",
      "orchestration_package",
      "result_contract_registry",
      "runtime_contract",
      "source_regression_manifest",
      "test_matrix",
    ],
  );
  assert.equal(new Set(manifest.artifacts.map((reference) => reference.path)).size, 17);

  const versionFields: Record<string, string> = {
    a_emotion_lifecycle_bindings: "bindingVersion",
    a_emotion_policy: "policyVersion",
    action_effect_policy: "policyVersion",
    action_presentation_catalog: "catalogVersion",
    ai_decision_policy: "policyVersion",
    control_topology: "topologyVersion",
    feature_set: "featureSetVersion",
    illegal_route_matrix: "matrixVersion",
    legacy_route_mapping: "resolverVersion",
    narrative_profile: "profileVersion",
    orchestration_package: "packageVersion",
    result_contract_registry: "registryVersion",
    runtime_contract: "contractVersion",
    source_regression_manifest: "manifestVersion",
    test_matrix: "matrixVersion",
  };
  const artifactsById = new Map<string, JsonObject>();
  for (const reference of manifest.artifacts) {
    const absolutePath = assertPackageLocal(reference.path);
    assert.equal(existsSync(absolutePath), true, reference.path);
    const bytes = readFileSync(absolutePath);
    const actualHash = reference.hashMode === "RAW_BYTES"
      ? sha256Bytes(bytes)
      : sha256Canonical(JSON.parse(bytes.toString("utf8")));
    assert.equal(actualHash, reference.sha256, `${reference.artifactId} SHA-256 drifted`);
    if (reference.hashMode === "CANONICAL_JSON") {
      const artifact = JSON.parse(bytes.toString("utf8")) as JsonObject;
      artifactsById.set(reference.artifactId, artifact);
      assert.equal(
        artifact[versionFields[reference.artifactId]!],
        reference.version,
        `${reference.artifactId} version is not the artifact's own version`,
      );
      assertNoPlaceholders(artifact, `$${reference.artifactId}`);
    }
  }
  const compiler = await loadActionCompiler();
  const requiredCompiler = requireActionCompiler();
  assert.equal(
    compiler.SANGTIAN_ACTION_EFFECT_COMPILER_VERSION_V1,
    manifest.artifacts.find((item) => item.artifactId === "action_effect_compiler_esm_wrapper")!.version,
  );
  assert.equal(
    requiredCompiler.SANGTIAN_ACTION_EFFECT_COMPILER_VERSION_V1,
    manifest.artifacts.find((item) => item.artifactId === "action_effect_compiler_core")!.version,
  );

  const loadedContent = loadSangtianPressureChapterPackageV1(PACKAGE_ROOT);
  const inputById = new Map(manifest.immutableInputs.map((reference) => [reference.artifactId, reference]));
  for (const input of manifest.immutableInputs) {
    assert.equal(input.hashMode, "CANONICAL_JSON");
    assert.equal(
      sha256Canonical(readJson(assertPackageLocal(input.path))),
      input.sha256,
      input.artifactId,
    );
  }
  assert.equal(
    inputById.get("accepted_content_package")!.sha256,
    loadedContent.manifest.contentSha256,
  );

  const validated = validatePressureChapterRouteRegistryV1(manifest.routeRegistry);
  assert.equal(
    validated.registryHash,
    computePressureChapterRouteRegistryHash({
      schemaVersion: validated.schemaVersion,
      registryVersion: validated.registryVersion,
      defaultRouteKey: validated.defaultRouteKey,
      routes: validated.routes,
    }),
  );
  assert.equal(validated.defaultRouteKey, SANGTIAN_PRESSURE_CHAPTER_ROUTE_KEY_V1);
  const registry = new PressureChapterRouteRegistry(validated);
  const solo = registry.resolveCreate(null, "SOLO");
  const multiplayer = registry.resolveCreate(null, "MULTIPLAYER");
  assert.deepEqual(solo.route, PRESSURE_CHAPTER_ROUTE_TUPLE_V1);
  assert.deepEqual(multiplayer.route, PRESSURE_CHAPTER_ROUTE_TUPLE_V1);
  assert.deepEqual(PRESSURE_CHAPTER_ROUTE_TUPLE_V1, PRESSURE_CHAPTER_ROUTE_V1);
  assert.equal(solo.routeKey, multiplayer.routeKey);
  assert.equal(solo.status, "PUBLISHED");
  assert.equal(solo.createEnabled, true);
  assert.equal(
    solo.orchestrationPackageSha256,
    manifest.artifacts.find((item) => item.artifactId === "orchestration_package")!.sha256,
  );
  assert.equal(
    solo.runtimeContractSha256,
    manifest.artifacts.find((item) => item.artifactId === "runtime_contract")!.sha256,
  );
  assert.equal(
    solo.testMatrixSha256,
    manifest.artifacts.find((item) => item.artifactId === "test_matrix")!.sha256,
  );
  assert.equal(solo.narrativeProfileVersion, artifactsById.get("narrative_profile")!.profileVersion);
  assert.equal(solo.featureSetVersion, artifactsById.get("feature_set")!.featureSetVersion);
  assert.equal(
    solo.resultContractRegistryVersion,
    artifactsById.get("result_contract_registry")!.registryVersion,
  );
  assert.equal(solo.controlTopologyVersion, artifactsById.get("control_topology")!.topologyVersion);
});

test("Chinese action presentation is exact, complete and presentation-only", async () => {
  const compiler = await loadActionCompiler();
  const catalog = compiler.loadSangtianActionPresentationCatalogV1();
  const loaded = loadSangtianPressureChapterPackageV1(PACKAGE_ROOT);
  assert.equal(catalog.catalogSha256, hashWithoutField(catalog, "catalogSha256"));
  assert.equal(catalog.authorityBoundary.presentationOnly, true);
  assert.equal(catalog.authorityBoundary.mayCompileWorkingIntent, false);
  assert.equal(catalog.authorityBoundary.maySupplySettlementFacts, false);
  assert.equal(catalog.authorityBoundary.customTextMayChangeActionType, false);
  assert.equal(catalog.authorityBoundary.providerMayCreateOptions, false);
  assert.equal(catalog.defaultPassPresentation.preferredEntry, "DEFER");

  let decisionCount = 0;
  let pairCount = 0;
  const preferredEntryCounts = new Map<string, number>();
  for (const [chapterIndex, authoredChapter] of loaded.content.chapters.entries()) {
    const chapter = catalog.chapters[chapterIndex]!;
    assert.equal(chapter.chapterId, authoredChapter.chapterId);
    assert.equal(chapter.title, authoredChapter.title);
    for (const [decisionIndex, authoredDecision] of authoredChapter.decisionPoints.entries()) {
      const decision = chapter.decisions[decisionIndex]!;
      decisionCount += 1;
      pairCount += decision.actions.length;
      assert.equal(decision.decisionPointKey, authoredDecision.decisionPointKey);
      assert.equal(decision.purpose, authoredDecision.purpose);
      assert.deepEqual(
        decision.actions.map((action: JsonObject) => action.actionType),
        authoredDecision.allowedActionTypes,
      );
      for (const action of decision.actions) {
        assert.equal(
          ["TALK", "INVESTIGATE", "TOKEN", "PLAN", "DEFER"].includes(
            action.preferredEntry,
          ),
          true,
          `${decision.decisionPointKey}:${action.actionType}:preferredEntry`,
        );
        if (action.actionType === "DEFAULT_PASS") {
          assert.equal(action.preferredEntry, "DEFER");
        } else {
          assert.notEqual(action.preferredEntry, "DEFER");
        }
        preferredEntryCounts.set(
          action.preferredEntry,
          (preferredEntryCounts.get(action.preferredEntry) ?? 0) + 1,
        );
        assert.equal(action.label.trim().length > 1, true);
        assert.equal(action.description.trim().length > 8, true);
        assert.equal(HAN.test(action.label), true, `${decision.decisionPointKey}:${action.actionType}`);
        assert.equal(HAN.test(action.description), true, `${decision.decisionPointKey}:${action.actionType}`);
      }
    }
  }
  assert.equal(decisionCount, 26);
  assert.equal(pairCount, 72);
  assert.deepEqual(Object.fromEntries([...preferredEntryCounts].sort()), {
    DEFER: 26,
    INVESTIGATE: 17,
    PLAN: 13,
    TALK: 8,
    TOKEN: 8,
  });
  assert.deepEqual(catalog.completeness, {
    chapterCount: 7,
    decisionPointCount: 26,
    decisionActionPairCount: 72,
    coverageRule: "EXACT_ACCEPTED_CONTENT_DECISION_ACTION_PAIRS",
  });
});

test("T3 action-effect compiler expands every accepted decision-seat-action binding", async () => {
  const compiler = await loadActionCompiler();
  const policy = compiler.loadSangtianActionEffectPolicyV1();
  const loaded = loadSangtianPressureChapterPackageV1(PACKAGE_ROOT);
  assert.equal(policy.policySha256, hashWithoutField(policy, "policySha256"));
  assert.equal(
    sha256Bytes(readFileSync(COMPILER_CORE_PATH)),
    policy.compilerModule.coreSha256RawBytes,
  );
  assert.equal(
    sha256Bytes(readFileSync(COMPILER_PATH)),
    policy.compilerModule.esmWrapperSha256RawBytes,
  );
  assert.equal(policy.sourceBinding.sourceContainedExactActionEffectValues, false);
  assert.equal(
    policy.sourceBinding.derivationClass,
    "VERSIONED_T3_ADAPTATION_FROM_ACCEPTED_ACTION_SEMANTICS_AND_SELECTOR_BOUNDARIES",
  );
  assert.deepEqual(policy.route, PRESSURE_CHAPTER_ROUTE_TUPLE_V1);
  assert.equal(policy.resourcePolicy.mode, "NONE");

  let decisionCount = 0;
  let pairCount = 0;
  let expandedCount = 0;
  for (const authoredChapter of loaded.content.chapters) {
    const chapter = policy.chapterPolicies.find(
      (candidate: JsonObject) => candidate.chapterId === authoredChapter.chapterId,
    )!;
    for (const authoredDecision of authoredChapter.decisionPoints) {
      decisionCount += 1;
      pairCount += authoredDecision.allowedActionTypes.length;
      const decision = chapter.decisions.find(
        (candidate: JsonObject) => candidate.decisionPointKey === authoredDecision.decisionPointKey,
      )!;
      assert.deepEqual(decision.requiredSeatIds, authoredDecision.requiredSeatIds);
      assert.deepEqual(
        decision.actions.map((action: JsonObject) => action.actionType),
        authoredDecision.allowedActionTypes,
      );
      const selectorFacts = new Set(chapter.factAggregators.map((item: JsonObject) => item.factRef));
      for (const seatId of authoredDecision.requiredSeatIds) {
        for (const actionType of authoredDecision.allowedActionTypes) {
          expandedCount += 1;
          const compiled = compiler.compileSangtianActionBindingV1(policy, {
            chapterId: authoredChapter.chapterId,
            decisionPointKey: authoredDecision.decisionPointKey,
            seatId,
            actionType,
          });
          assert.equal(compiled.resourcePolicy, "NONE");
          assert.deepEqual(compiled.workingIntent.resourceReservations, []);
          assert.deepEqual(compiled.workingIntent.commitmentMutations, []);
          assert.deepEqual(compiled.workingIntent.knowledgeGrants, []);
          assert.deepEqual(compiled.workingIntent.seatArcProgress, []);
          if (actionType === "DEFAULT_PASS") {
            assert.equal(compiled.workingIntent.visibility, "PRIVATE");
            assert.deepEqual(compiled.workingIntent.targetSeatIds, []);
            assert.deepEqual(compiled.factContributions, []);
          } else {
            assert.equal(compiled.workingIntent.visibility, "PARTICIPANTS");
            assert.deepEqual(compiled.workingIntent.targetSeatIds, authoredDecision.requiredSeatIds);
          }
          for (const contribution of compiled.factContributions) {
            assert.equal(selectorFacts.has(contribution.factRef), true);
          }
        }
      }
    }
  }
  assert.deepEqual({ decisionCount, pairCount, expandedCount }, {
    decisionCount: 26,
    pairCount: 72,
    expandedCount: 288,
  });
  assert.equal(expandedCount, policy.bindingExpansion.expectedExpandedBindingCount);
  expectActionPolicyCode(
    () => compiler.compileSangtianActionBindingV1(policy, {
      chapterId: "N1",
      decisionPointKey: "N1.weir_crisis",
      seatId: "zhejiang_governor",
      actionType: "CUSTOM_TEXT",
    }),
    "SANGTIAN_ACTION_EFFECT_BINDING_NOT_FOUND",
  );
});

test("action facts are permutation-invariant and every chapter reaches HIGH, MID, LOW and its source default", async () => {
  const compiler = await loadActionCompiler();
  const policy = compiler.loadSangtianActionEffectPolicyV1();
  const sourceCommit = policy.sourceBinding.sourceCommitSha;
  const allowedReducers = new Set([
    "MAX",
    "MIN",
    "BOOLEAN_OR",
    "BOOLEAN_AND",
    "ENUM_MAX",
    "COUNT_DISTINCT_SEATS",
  ]);

  for (const chapter of policy.chapterPolicies) {
    for (const aggregator of chapter.factAggregators) {
      assert.equal(allowedReducers.has(aggregator.reducer), true, aggregator.reducer);
      assert.equal("identity" in aggregator, true, `${chapter.chapterId}:${aggregator.factRef}`);
    }
    for (const band of ["HIGH", "MID", "LOW"]) {
      assert.equal(
        outcomeBandForFacts(chapter.chapterId, chapter.selectorWitnesses[band]),
        band,
        `${chapter.chapterId}:${band}:selector-witness`,
      );
      const actions = fixtureActions(chapter, chapter.reachabilityCases[band]);
      const canonical = compiler.compileSangtianChapterActionEffectsV1(policy, {
        chapterId: chapter.chapterId,
        confirmedActions: actions,
        defaultEvents: [],
      });
      assert.equal(
        outcomeBandForFacts(chapter.chapterId, canonical.settlementFacts),
        band,
        `${chapter.chapterId}:${band}:action-path`,
      );
      const inputs = actions.length <= 6 ? permutations(actions) : [actions, [...actions].reverse()];
      for (const permutation of inputs) {
        const candidate = compiler.compileSangtianChapterActionEffectsV1(policy, {
          chapterId: chapter.chapterId,
          confirmedActions: permutation,
          defaultEvents: [],
        });
        assert.equal(candidate.compilationHash, canonical.compilationHash);
        assert.deepEqual(candidate.settlementFacts, canonical.settlementFacts);
      }
    }

    const sourcePath = `packages/templates/config/sangtian/pressure-spine-v1.0/source/nodes/${chapter.chapterId}/settlement.json`;
    const source = JSON.parse(execFileSync("git", ["show", `${sourceCommit}:${sourcePath}`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })) as JsonObject;
    assert.deepEqual(
      chapter.defaultTrajectory.settlementFacts,
      normalizeSourceDefault(chapter.chapterId, source.defaultTrajectory.defaultInputState),
      `${chapter.chapterId}:source-default`,
    );
    const defaultResult = compiler.compileSangtianChapterActionEffectsV1(policy, {
      chapterId: chapter.chapterId,
      confirmedActions: [],
      defaultEvents: [{
        eventId: `default.${chapter.chapterId}`,
        eventType: "APPLY_DEFAULT_TRAJECTORY",
      }],
    });
    assert.equal(defaultResult.aggregationMode, "DEFAULT_TRAJECTORY_ONCE");
    assert.deepEqual(defaultResult.settlementFacts, chapter.defaultTrajectory.settlementFacts);
    assert.equal(
      outcomeBandForFacts(chapter.chapterId, defaultResult.settlementFacts),
      chapter.defaultTrajectory.expectedOutcomeBand,
    );
  }
});

test("mixed DEFAULT_PASS is legal while chapter default trajectory is exactly-once and conflict-closed", async () => {
  const compiler = await loadActionCompiler();
  const policy = compiler.loadSangtianActionEffectPolicyV1();
  const chapter = policy.chapterPolicies.find((candidate: JsonObject) => candidate.chapterId === "N1")!;
  const humanActions = fixtureActions(chapter, chapter.reachabilityCases.HIGH);
  const mixedActions = [
    ...humanActions,
    {
      actionId: "fixture.N1.mixed.default",
      decisionPointKey: "N1.weir_crisis",
      seatId: "cabinet_finance",
      actionType: "DEFAULT_PASS",
    },
  ];
  const human = compiler.compileSangtianChapterActionEffectsV1(policy, {
    chapterId: "N1",
    confirmedActions: humanActions,
    defaultEvents: [],
  });
  const mixed = compiler.compileSangtianChapterActionEffectsV1(policy, {
    chapterId: "N1",
    confirmedActions: mixedActions,
    defaultEvents: [],
  });
  assert.deepEqual(mixed.settlementFacts, human.settlementFacts);
  assert.equal(outcomeBandForFacts("N1", mixed.settlementFacts), "HIGH");

  const allDefault = fixtureActions(chapter, ["DEFAULT_PASS"]);
  const once = compiler.compileSangtianChapterActionEffectsV1(policy, {
    chapterId: "N1",
    confirmedActions: allDefault,
    defaultEvents: [{ eventId: "default.N1.once", eventType: "APPLY_DEFAULT_TRAJECTORY" }],
  });
  assert.deepEqual(once.settlementFacts, chapter.defaultTrajectory.settlementFacts);
  expectActionPolicyCode(
    () => compiler.compileSangtianChapterActionEffectsV1(policy, {
      chapterId: "N1",
      confirmedActions: allDefault,
      defaultEvents: [
        { eventId: "default.N1.1", eventType: "APPLY_DEFAULT_TRAJECTORY" },
        { eventId: "default.N1.2", eventType: "APPLY_DEFAULT_TRAJECTORY" },
      ],
    }),
    "SANGTIAN_ACTION_EFFECT_DEFAULT_TRAJECTORY_DUPLICATE",
  );
  expectActionPolicyCode(
    () => compiler.compileSangtianChapterActionEffectsV1(policy, {
      chapterId: "N1",
      confirmedActions: mixedActions,
      defaultEvents: [{ eventId: "default.N1.conflict", eventType: "APPLY_DEFAULT_TRAJECTORY" }],
    }),
    "SANGTIAN_ACTION_EFFECT_DEFAULT_TRAJECTORY_CONFLICT",
  );
});

test("zero-resource MVP conserves resources and rejects action-id double-spend conflicts", async () => {
  const compiler = await loadActionCompiler();
  const policy = compiler.loadSangtianActionEffectPolicyV1();
  assert.deepEqual(policy.resourcePolicy.chapterEndDisposition, {
    consume: "FORBIDDEN_WITHOUT_RESERVATION",
    release: "FORBIDDEN_WITHOUT_RESERVATION",
    expectedReservedAmount: 0,
    expectedConsumedAmount: 0,
    expectedReleasedAmount: 0,
  });
  for (const chapter of policy.chapterPolicies) {
    const actions = fixtureActions(chapter, chapter.reachabilityCases.HIGH);
    const result = compiler.compileSangtianChapterActionEffectsV1(policy, {
      chapterId: chapter.chapterId,
      confirmedActions: actions,
      defaultEvents: [],
    });
    assert.deepEqual(result.resourceReservationMutations, []);
    assert.deepEqual(result.chapterEndResourceDispositions, []);
    for (const entry of result.workingIntents) {
      assert.deepEqual(entry.workingIntent.resourceReservations, []);
    }
    const replay = compiler.compileSangtianChapterActionEffectsV1(policy, {
      chapterId: chapter.chapterId,
      confirmedActions: [...actions, structuredClone(actions[0]!)],
      defaultEvents: [],
    });
    assert.equal(replay.compilationHash, result.compilationHash);
  }

  const n1 = policy.chapterPolicies.find((candidate: JsonObject) => candidate.chapterId === "N1")!;
  const first = fixtureActions(n1, ["EVACUATE_WEIRS"])[0]!;
  expectActionPolicyCode(
    () => compiler.compileSangtianChapterActionEffectsV1(policy, {
      chapterId: "N1",
      confirmedActions: [first, { ...first, actionType: "SUPPORT_WEIR" }],
      defaultEvents: [],
    }),
    "SANGTIAN_ACTION_EFFECT_ACTION_CONFLICT",
  );
});

test("continuous runtime rejects the fixed PREPARE/COMMIT/REACTION route and every illegal mix", () => {
  const manifest = readJson<ReleaseManifest>(RELEASE_MANIFEST_PATH);
  const registry = new PressureChapterRouteRegistry(manifest.routeRegistry);
  const orchestration = readReleaseArtifact("orchestration-package.json");
  const runtime = readReleaseArtifact("runtime-contract.json");
  const illegal = readReleaseArtifact("illegal-route-matrix.json");
  const loaded = loadSangtianPressureChapterPackageV1(PACKAGE_ROOT);

  assert.deepEqual(orchestration.nodeOrder, ["P0", ...CHAPTER_IDS_V1]);
  assert.deepEqual(orchestration.chapterExecution.chapterIds, CHAPTER_IDS_V1);
  assert.equal(orchestration.genesis.decisionPointsAllowed, false);
  assert.equal(orchestration.genesis.chapterSettlementCount, 0);
  assert.equal(orchestration.chapterExecution.decisionPointCardinality, "CONTENT_DRIVEN");
  assert.equal(orchestration.chapterExecution.selectorFactSource, "ACTION_EFFECT_POLICY_AGGREGATION");
  assert.equal(orchestration.chapterExecution.beatAdvancesWorldSequence, false);
  assert.equal(orchestration.chapterExecution.chapterSettlementCountPerChapter, 1);
  assert.equal(orchestration.terminalTrigger.sourceChapterId, "N7");
  assert.equal(orchestration.terminalTrigger.terminalDecisionCount, 1);
  assert.equal(orchestration.contentPackage.contentSha256, loaded.manifest.contentSha256);
  assert.equal(orchestration.actionCompilation.expandedBindingCount, 288);
  assert.equal(orchestration.actionCompilation.resourcePolicy, "NONE");

  const contentCounts = loaded.content.chapters.map((chapter) => chapter.decisionPoints.length);
  assert.deepEqual(contentCounts, [1, 4, 4, 2, 7, 3, 5]);
  assert.equal(new Set(contentCounts).size > 1, true);
  const fixedPhases = ["PREPARE", "COMMIT", "REACTION"];
  assert.deepEqual(orchestration.legacyFixedPhaseRoute.fixedPhases, fixedPhases);
  assert.equal(orchestration.legacyFixedPhaseRoute.disposition, "REJECT");
  assert.deepEqual(runtime.legacyFixedPhaseRoute.fixedPhases, fixedPhases);
  assert.equal(runtime.legacyFixedPhaseRoute.accepted, false);
  assert.equal(runtime.legacyFixedPhaseRoute.failureMode, "FAIL_CLOSED");
  assert.equal(
    runtime.legacyFixedPhaseRoute.errorCode,
    "SANGTIAN_PRESSURE_CONTENT_LEGACY_FIXED_WINDOW_FORBIDDEN",
  );
  assert.deepEqual(
    runtime.commandVocabulary.map((item: JsonObject) => item.name),
    ["FREEZE_GENESIS", "DRAFT_DECISION_ACTION", "SEAL_DECISION_ACTION"],
  );
  assert.equal(runtime.commandVocabulary.every((item: JsonObject) => item.schemaVersion.endsWith("_v1")), true);
  assert.equal(runtime.eventVocabulary.every((item: JsonObject) => item.schemaVersion.endsWith("_v1")), true);
  assert.equal(runtime.actionCompilation.customTextMayAffectAuthority, false);
  assert.equal(runtime.actionCompilation.providerMayAffectAuthority, false);

  const executableOrchestration = structuredClone(orchestration);
  delete executableOrchestration.legacyFixedPhaseRoute;
  const executableRuntime = structuredClone(runtime);
  delete executableRuntime.legacyFixedPhaseRoute;
  const forbiddenKeys = new Set(loaded.manifest.forbiddenLegacyFields);
  assert.deepEqual([...collectKeys(executableOrchestration)].filter((key) => forbiddenKeys.has(key)), []);
  assert.deepEqual([...collectKeys(executableRuntime)].filter((key) => forbiddenKeys.has(key)), []);

  const routeMutations = manifest.rejectedRouteCandidates.filter((candidate) => candidate.routeMutation);
  assert.equal(routeMutations.length, 2);
  for (const candidate of routeMutations) {
    expectRegistryCode(
      () => registry.resolveStored(manifest.routeRegistry.defaultRouteKey, {
        ...PRESSURE_CHAPTER_ROUTE_TUPLE_V1,
        ...candidate.routeMutation,
      }),
      candidate.reasonCode,
    );
  }
  const fixedCandidate = manifest.rejectedRouteCandidates.find(
    (candidate) => candidate.candidateId === "legacy_fixed_phase_orchestration",
  )!;
  assert.deepEqual(fixedCandidate.fixedPhases, fixedPhases);
  assert.equal(
    fixedCandidate.reasonCode,
    "SANGTIAN_PRESSURE_CONTENT_LEGACY_FIXED_WINDOW_FORBIDDEN",
  );
  assert.deepEqual(
    illegal.cases.map((candidate: JsonObject) => candidate.mutationPath),
    [
      "route.engineVersion",
      "route.strategyVersion",
      "route.runtimeProfile",
      "route.endgamePolicyVersion",
      "route.resultSchemaVersion",
      "contentPackageSha256",
      "orchestrationPackageSha256",
      "runtimeContractSha256",
      "testMatrixSha256",
      "handlerKey",
      "resultAdapterKey",
      "presentationSchemaVersion",
      "rendererKey",
      "participantModes",
      "orchestration.fixedPhases",
    ],
  );
});

test("narrative, result, control and Legacy route artifacts preserve authority boundaries", () => {
  const narrative = readReleaseArtifact("narrative-profile.json");
  const resultRegistry = readReleaseArtifact("result-contract-registry.json");
  const topology = readReleaseArtifact("control-topology.json");
  const featureSet = readReleaseArtifact("feature-set.json");
  const legacy = readReleaseArtifact("legacy-route-mapping.json");
  const loaded = loadSangtianPressureChapterPackageV1(PACKAGE_ROOT);

  assert.deepEqual(narrative.statuses, NARRATIVE_STATUSES_V1);
  assert.equal(narrative.runtimeRole, "NON_AUTHORITATIVE_NARRATIVE_PROJECTOR");
  assert.deepEqual(narrative.authorityCapabilities, []);
  assert.equal(narrative.failurePolicy.mayBlockAuthorityCommit, false);
  assert.equal(narrative.failurePolicy.mayRollbackAuthorityCommit, false);
  assert.deepEqual(narrative.sourceBinding.idempotencyScope, [
    "projectionKind",
    "sourceCommitHash",
    "sourceContentHash",
    "narrativeProfileVersion",
    "projectorVersion",
    "audience",
  ]);

  assert.equal(resultRegistry.selectionAuthority, "FROZEN_RUN_ROUTE");
  assert.equal(resultRegistry.unknownSchemaPolicy, "FAIL_CLOSED");
  assert.equal(resultRegistry.inferFromPayloadShape, false);
  assert.equal(resultRegistry.mappings.length, 4);
  assert.equal(resultRegistry.mappings.some((mapping: JsonObject) => "createEligible" in mapping), false);
  const pressure = resultRegistry.mappings.find(
    (mapping: JsonObject) => mapping.runtimeProfile === PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile,
  );
  assert.deepEqual(pressure, {
    mappingKey: "sangtian_pressure_chapter_v1",
    runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1",
    endgamePolicyVersion: "sangtian_content_finale_v1",
    resultSchemaVersion: "sangtian_pressure_result_v1",
    payloadSchemaVersion: "sangtian_pressure_result_v1",
    presentationSchemaVersion: "sangtian_pressure_result_v1",
    rendererKey: "sangtian_pressure_endgame_v1",
  });

  assert.deepEqual(topology.seatIds, PRESSURE_CHAPTER_SEAT_IDS_V1);
  assert.deepEqual(topology.seatIds, loaded.content.genesis.seats.map((seat) => seat.seatId));
  assert.deepEqual(topology.participantModes.SOLO, {
    humanSeatCountMin: 1,
    humanSeatCountMax: 1,
    aiFillRemainingSeats: true,
  });
  assert.deepEqual(topology.participantModes.MULTIPLAYER, {
    humanSeatCountMin: 2,
    humanSeatCountMax: 6,
    aiFillRemainingSeats: true,
  });
  assert.equal(featureSet.capabilities.frozenActionEffectPolicy, true);
  assert.equal(featureSet.capabilities.localizedActionPresentationCatalog, true);
  assert.equal(featureSet.capabilities.createOpenNovelT20, false);
  assert.equal(featureSet.capabilities.legacyOpenNovelSameExperienceReplay, false);
  assert.equal(featureSet.artifactReleaseStage, "contract_shadow");

  assert.equal(legacy.ambiguityPolicy, "FAIL_CLOSED");
  assert.equal(legacy.unknownRoutePolicy, "FAIL_CLOSED");
  const legacyCommands = new Map(
    legacy.createAndReplayRules.map((rule: JsonObject) => [rule.command, rule]),
  );
  assert.equal(legacyCommands.get("CREATE_OPENNOVEL_T20")!.disposition, "REJECT_ZERO_WRITE");
  assert.equal(
    legacyCommands.get("LEGACY_OPENNOVEL_RESTART_SAME_EXPERIENCE")!.disposition,
    "REJECT_ZERO_WRITE",
  );
  assert.deepEqual(
    legacyCommands.get("LEGACY_OPENNOVEL_START_LATEST_EXPERIENCE")!.targetRoute,
    PRESSURE_CHAPTER_ROUTE_TUPLE_V1,
  );
  assert.equal(
    legacyCommands.get("LEGACY_CONTINUOUS_STORY_RESTART_SAME_EXPERIENCE")!.disposition,
    "RESOLVE_INDEPENDENT_CAPABILITY",
  );
});

test("source regression entries read back real Git blobs and the matrix closes every release artifact gate", () => {
  const sourceManifest = readReleaseArtifact("source-regression-manifest.json");
  assert.deepEqual(sourceManifest.sourceInventoryContract, {
    selectorEngine: "ECMASCRIPT_REGEXP_UNICODE_V1",
    treeListingSemantics: "GIT_LS_TREE_RECURSIVE_NAME_ONLY_AT_PINNED_SHA",
    pathNormalization: "GIT_FORWARD_SLASH_PATHS",
    pathOrdering: "UNICODE_CODE_POINT_ASC",
    inventoryItemFields: ["path", "sourceGitBlobSha1", "sourceFileSha256"],
    inventoryHashAlgorithm: "SHA-256_CANONICAL_JSON_ARRAY",
    emptyScopePolicy: "FAIL_CLOSED",
  });
  assert.equal(sourceManifest.targetFileHashAlgorithm, "SHA-256_RAW_BYTES");
  assert.equal(sourceManifest.entries.length, 5);
  assert.equal(new Set(sourceManifest.entries.map((entry: JsonObject) => entry.sourceCommitSha)).size, 5);
  assert.deepEqual(
    sourceManifest.entries.map((entry: JsonObject) => entry.sourceScope.resolvedFileCount),
    [5, 15, 20, 16, 27],
  );
  for (const entry of sourceManifest.entries as JsonObject[]) {
    assert.equal("sourcePath" in entry, false);
    assert.equal("sourceFileSha256" in entry, false);
    assert.equal(entry.sourceScope.reason.length > 40, true);
    const treePaths = execFileSync("git", [
      "ls-tree",
      "-r",
      "--name-only",
      entry.sourceCommitSha,
    ], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).split(/\r?\n/u).filter(Boolean);
    const selectors = entry.sourceScope.includePathPatterns.map((pattern: string) => {
      assert.equal(pattern.startsWith("^") && pattern.endsWith("$"), true, pattern);
      return new RegExp(pattern, "u");
    });
    for (const selector of selectors) {
      assert.equal(treePaths.some((candidate) => selector.test(candidate)), true, selector.source);
    }
    const resolvedPaths = [...new Set(
      treePaths.filter((candidate) => selectors.some((selector: RegExp) => selector.test(candidate))),
    )].sort();
    assert.equal(resolvedPaths.length, entry.sourceScope.resolvedFileCount);
    const inventory = resolvedPaths.map((sourcePath) => {
      const objectSpec = `${entry.sourceCommitSha}:${sourcePath}`;
      const blobSha1 = execFileSync("git", ["rev-parse", objectSpec], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      }).trim();
      const sourceBytes = execFileSync("git", ["cat-file", "blob", blobSha1], {
        cwd: REPO_ROOT,
      });
      return {
        path: sourcePath,
        sourceGitBlobSha1: blobSha1,
        sourceFileSha256: sha256Bytes(sourceBytes),
      };
    });
    assert.equal(
      sha256Canonical(inventory),
      entry.sourceScope.inventorySha256,
      entry.sourceCommitSha,
    );
    assert.equal(entry.reason.length > 20, true);
    assert.equal(entry.targetTests.length > 0, true);
    for (const target of entry.targetTests) {
      const targetPath = path.resolve(REPO_ROOT, target.path);
      const relative = path.relative(REPO_ROOT, targetPath);
      assert.equal(relative === ".." || relative.startsWith(`..${path.sep}`), false, target.path);
      assert.equal(existsSync(targetPath), true, target.path);
      assert.equal(sha256Bytes(readFileSync(targetPath)), target.sha256RawBytes, target.path);
    }
  }

  const matrix = readReleaseArtifact("test-matrix.json");
  const expectedGates = [
    "RUN-ROUTE-001",
    "PRESSURE-AUTH-001",
    "GENESIS-001",
    "CHAPTER-001",
    "SETTLEMENT-001",
    "B0-CORE-001",
    "TERMINAL-001",
    "AUTHORITY-FIRST-001",
    "ADJUDICATOR-001",
    "GENERIC-SHADOW-001",
    "NARRATIVE-001",
    "PRIVACY-001",
    "RESULT-001",
    "RECOVERY-001",
    "LEGACY-001",
    "REPLAY-001",
    "ROLLOUT-001",
  ];
  assert.deepEqual(matrix.gates.map((gate: JsonObject) => gate.gateId), expectedGates);
  assert.equal(matrix.rangeSemantics, "INCLUSIVE_NO_SAMPLING");
  const selectorPattern = /^([A-Z0-9]+)-(\d{3})([A-Z]?)(?:\.\.(\d{3})([A-Z]?))?$/u;
  for (const gate of matrix.gates) {
    for (const selector of gate.testIdSelectors) {
      const match = selectorPattern.exec(selector);
      assert.notEqual(match, null, selector);
      if (match![4]) {
        assert.equal(match![3], "", selector);
        assert.equal(match![5], "", selector);
        assert.equal(Number(match![2]) <= Number(match![4]), true, selector);
      }
    }
  }
  assert.deepEqual(
    matrix.releaseArtifactCases.map((item: JsonObject) => item.caseId),
    [
      "PC-W0-FIVE-TUPLE",
      "PC-W0-CANONICAL-HASHES",
      "PC-W0-LEGACY-FIXED-PHASE-REJECTED",
      "PC-W0-SOURCE-REGRESSION",
      "PC-W0-RESULT-REGISTRY",
      "PC-W0-CONTROL-TOPOLOGY",
      "PC-W0-ACTION-PRESENTATION",
      "PC-W0-ACTION-EFFECT-COVERAGE",
      "PC-W0-ACTION-EFFECT-REACHABILITY",
      "PC-W0-ACTION-EFFECT-CONSERVATION",
    ],
  );
});
