import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  CHAPTER_IDS_V1,
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  hashWithoutField,
  nextChapterId,
  sha256Canonical,
  validateTerminalResultContextV1,
  type FrozenChapterBundleV1,
  type SangtianFinaleInputV1,
  type SealedChapterSettlementInputV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  PressureChapterRouteRegistry,
  PRESSURE_CHAPTER_ROUTE_TUPLE_V1,
} from "../src/runtime-contract/pressure-chapter-registry";
import {
  SANGTIAN_DISCLOSURE_RULE_REFS_V1,
  expectedSeatVerdictRuleRefsV1,
  expectedWorldOutcomeRuleRefsV1,
} from "../src/pressure-chapter/finale/content-rules";
import { compileSangtianContentFinalePolicyV1 } from "../src/pressure-chapter/finale/policy";
import {
  contentPolicyHashForChapterV1,
  evaluateContentOwnedChapterPolicyV1,
} from "../src/pressure-chapter/content/chapter-policy";
import { selectAvailableSangtianDecisionPointsV1 } from "../src/pressure-chapter/content/decision-points";
import {
  SANGTIAN_CONTENT_ERROR_CODES_V1,
  SangtianPressureContentErrorV1,
} from "../src/pressure-chapter/content/errors";
import { compileP0GenesisSnapshotV1 } from "../src/pressure-chapter/content/genesis";
import {
  loadSangtianPressureChapterPackageV1,
  validateSangtianPressureChapterPackageV1,
} from "../src/pressure-chapter/content/loader";
import { createPublishedSangtianPressureChapterRegistryV1 } from "../src/pressure-chapter/content/registry";
import { compileTerminalResultContextV1 } from "../src/pressure-chapter/content/result-source";

const digest = (label: string): string => sha256Canonical({ label });

function acceptedFinaleInputFixture(): SangtianFinaleInputV1 {
  const loaded = loadSangtianPressureChapterPackageV1();
  const routeHash = digest("accepted-result-route");
  const genesis = compileP0GenesisSnapshotV1({
    runId: "run-accepted-result",
    routeHash,
    orchestrationPackageSha256: digest("accepted-result-orchestration"),
    package: loaded,
  });
  const bundles: FrozenChapterBundleV1[] = [];
  let previousFrozenHash = genesis.genesisHash;
  for (const [index, chapterId] of CHAPTER_IDS_V1.entries()) {
    const sequence = index + 1;
    const { stateHash: _oldStateHash, ...worldWithoutHash } = structuredClone(
      genesis.initialWorldState,
    );
    const nextWorldWithoutHash = {
      ...worldWithoutHash,
      worldSequence: sequence,
    };
    const frozenWorldState: WorldStateV1 = {
      ...nextWorldWithoutHash,
      stateHash: sha256Canonical(nextWorldWithoutHash),
    };
    const carryWithoutHash = {
      nextChapterId: nextChapterId(chapterId),
      unlockedContentRefs: [],
      unresolvedCommitmentRefs: [],
      pendingConsequenceRefs: [],
    };
    const carryForward = {
      ...carryWithoutHash,
      carryForwardHash: sha256Canonical(carryWithoutHash),
    };
    const bundleWithoutHash = {
      schemaVersion: "sangtian_frozen_chapter_bundle_v1" as const,
      runId: "run-accepted-result",
      chapterId,
      chapterSequence: sequence as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      baseWorldSequence: sequence - 1,
      committedWorldSequence: sequence,
      previousFrozenHash,
      decisionLedgerHash: digest(`accepted-ledger-${sequence}`),
      finalWorkingStateHash: digest(`accepted-working-${sequence}`),
      settlementPolicyVersion: loaded.chapters[index]!.closePolicy.settlementPolicyRef,
      worldDelta: { factMutations: [], resourceMutations: [] },
      committedWorldStateHash: frozenWorldState.stateHash,
      frozenWorldState,
      causalEdges: [],
      carryForward,
    };
    const bundle = {
      ...bundleWithoutHash,
      bundleHash: sha256Canonical(bundleWithoutHash),
    } as FrozenChapterBundleV1;
    bundles.push(bundle);
    previousFrozenHash = bundle.bundleHash;
  }
  const policy = compileSangtianContentFinalePolicyV1({
    contentPackageVersion: loaded.manifest.packageVersion,
    contentPackageSha256: loaded.manifest.contentSha256,
  });
  const withoutHash = {
    schemaVersion: "sangtian_finale_input_v1" as const,
    runId: "run-accepted-result",
    routeHash,
    runSeed: "accepted-result-seed",
    genesisHash: genesis.genesisHash,
    frozenChapterBundles: bundles,
    finalWorldState: bundles[6]!.frozenWorldState,
    causalEdges: [],
    policyVersion: policy.policyVersion,
    policyHash: policy.policyHash,
  };
  return { ...withoutHash, inputHash: sha256Canonical(withoutHash) };
}

function expectContentCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.equal(error instanceof SangtianPressureContentErrorV1, true);
    assert.equal((error as SangtianPressureContentErrorV1).code, code);
    return true;
  });
}

test("accepted source trace and immutable package hashes read back exactly", () => {
  const loaded = loadSangtianPressureChapterPackageV1();
  assert.equal(sha256Canonical(loaded.content), loaded.manifest.contentSha256);
  assert.equal(hashWithoutField(
    loaded.manifest as unknown as Record<string, unknown>,
    "manifestSha256",
  ), loaded.manifest.manifestSha256);
  for (const trace of loaded.manifest.sourceTrace) {
    const blob = execFileSync(
      "git",
      ["rev-parse", `${loaded.manifest.sourceCommitSha}:${trace.path}`],
      { encoding: "utf8" },
    ).trim();
    assert.equal(blob, trace.gitBlobSha1, trace.path);
  }
});

test("P0 is Genesis only with exact six seats, five tracks and source objects", () => {
  const loaded = loadSangtianPressureChapterPackageV1();
  assert.deepEqual(loaded.content.genesis.seats.map((seat) => seat.seatId), PRESSURE_CHAPTER_SEAT_IDS_V1);
  assert.deepEqual(loaded.content.genesis.tracks.map((track) => track.trackId), TRACK_IDS_V1);
  assert.deepEqual(
    loaded.content.genesis.resources.map((resource) => ({
      resourceId: resource.resourceId,
      label: resource.label,
      initialValue: resource.initialValue,
      displaySuffix: resource.displaySuffix,
    })),
    [
      { resourceId: "resource.silver", label: "银两", initialValue: 42, displaySuffix: " 万两" },
      { resourceId: "resource.grain", label: "粮草", initialValue: 23, displaySuffix: " 万石" },
      { resourceId: "resource.soldiers", label: "兵丁", initialValue: 4, displaySuffix: "/5" },
      { resourceId: "resource.advisers", label: "幕僚", initialValue: 4, displaySuffix: " 人" },
      { resourceId: "resource.intelligence", label: "密报", initialValue: 2, displaySuffix: " 条" },
    ],
  );
  assert.equal(loaded.content.genesis.objects.length, 38);
  const genesis = compileP0GenesisSnapshotV1({
    runId: "run-content-genesis",
    routeHash: digest("route"),
    orchestrationPackageSha256: digest("orchestration"),
    package: loaded,
  });
  assert.equal(genesis.nodeId, "P0");
  assert.equal(genesis.sequence, 0);
  assert.equal(genesis.initialWorldState.worldSequence, 0);
  assert.equal(genesis.initialWorldState.factValues["frozen.P0.LOCKED"], true);
  assert.equal("decisionPoints" in genesis, false);
  assert.equal("chapterSettlement" in genesis, false);
});

test("N1-N7 use content-driven 1/4/dynamic/2/7/3/5 point plans", () => {
  const loaded = loadSangtianPressureChapterPackageV1();
  assert.deepEqual(loaded.chapters.map((chapter) => chapter.chapterId), ["N1", "N2", "N3", "N4", "N5", "N6", "N7"]);
  assert.deepEqual(loaded.chapters.map((chapter) => chapter.decisionPoints.length), [1, 4, 4, 2, 7, 3, 5]);
  const dynamic = loaded.chapters[2]!;
  assert.equal(dynamic.decisionPlan, "DYNAMIC");
  assert.equal(selectAvailableSangtianDecisionPointsV1(dynamic, {}).length, 1);
  assert.equal(selectAvailableSangtianDecisionPointsV1(dynamic, {
    "chapter.N3.land_pressure_active": true,
    "chapter.N3.relief_gap_exists": true,
    "chapter.N3.need_price_floor_review": true,
  }).length, 4);
  assert.equal(loaded.chapters.every((chapter) =>
    chapter.decisionPoints.every((point) =>
      !Object.keys(point.definition).some((field) => /^(?:phase|window|slot)$/u.test(field)),
    )), true);
});

test("missing schema, fixed-window fields and hash drift fail closed", () => {
  const loaded = loadSangtianPressureChapterPackageV1();
  const drifted = structuredClone(loaded.content);
  drifted.genesis.title = "tampered";
  expectContentCode(
    () => validateSangtianPressureChapterPackageV1(loaded.manifest, drifted),
    SANGTIAN_CONTENT_ERROR_CODES_V1.PACKAGE_HASH_MISMATCH,
  );

  const fixed = structuredClone(loaded.content) as unknown as Record<string, unknown>;
  const fixedChapters = fixed.chapters as Array<Record<string, unknown>>;
  const fixedPoints = fixedChapters[0]!.decisionPoints as Array<Record<string, unknown>>;
  fixedPoints[0]!.windowCount = 2;
  expectContentCode(
    () => validateSangtianPressureChapterPackageV1(loaded.manifest, fixed),
    SANGTIAN_CONTENT_ERROR_CODES_V1.LEGACY_FIXED_WINDOW_FORBIDDEN,
  );

  const unknown = structuredClone(loaded.content) as unknown as Record<string, unknown>;
  unknown.unknownField = true;
  const manifest = structuredClone(loaded.manifest);
  manifest.contentSha256 = sha256Canonical(unknown);
  manifest.manifestSha256 = hashWithoutField(
    manifest as unknown as Record<string, unknown>,
    "manifestSha256",
  );
  expectContentCode(
    () => validateSangtianPressureChapterPackageV1(manifest, unknown),
    SANGTIAN_CONTENT_ERROR_CODES_V1.PACKAGE_INVALID,
  );
});

test("content policy is permutation deterministic and emits canonical B0 material", () => {
  const loaded = loadSangtianPressureChapterPackageV1();
  const genesis = compileP0GenesisSnapshotV1({
    runId: "run-policy",
    routeHash: digest("route-policy"),
    orchestrationPackageSha256: digest("orchestration-policy"),
    package: loaded,
  });
  const base = {
    schemaVersion: "sangtian_chapter_settlement_input_v1" as const,
    runId: "run-policy",
    chapterRuntimeId: "runtime-N1",
    chapterId: "N1" as const,
    baseWorldSequence: 0,
    baseWorldStateHash: genesis.initialWorldState.stateHash,
    runRouteHash: digest("route-policy"),
    previousFrozenHash: digest("previous"),
    decisionLedgerHash: digest("ledger"),
    finalWorkingStateHash: digest("working"),
    sealedDecisionActionIds: [],
    reservationLedgerHash: digest("reservations"),
    contentPolicyVersion: "sangtian.N1.settlement_v1",
    contentPolicyHash: contentPolicyHashForChapterV1("N1", loaded),
    settlementContractVersion: "b0.settlement.v1",
    settlementContractHash: digest("b0-contract"),
  };
  const settlementInput: SealedChapterSettlementInputV1 = {
    ...base,
    inputHash: sha256Canonical(base),
  };
  const first = evaluateContentOwnedChapterPolicyV1({
    settlementInput,
    currentWorldState: genesis.initialWorldState,
    package: loaded,
    settlementFacts: {
      evacuationCoveragePct: 80,
      criticalWeirsSecuredCount: 2,
      verifiedBreachRecordCount: 1,
      disasterSeverity: 1,
    },
  });
  const second = evaluateContentOwnedChapterPolicyV1({
    settlementInput,
    currentWorldState: genesis.initialWorldState,
    package: loaded,
    settlementFacts: {
      disasterSeverity: 1,
      verifiedBreachRecordCount: 1,
      criticalWeirsSecuredCount: 2,
      evacuationCoveragePct: 80,
    },
  });
  assert.equal(first.evaluationHash, second.evaluationHash);
  assert.equal(first.worldDelta.factMutations[0]?.after, "HIGH");
  assert.equal("worldSequence" in first.worldDelta, false);
  assert.equal(first.carryForward.nextChapterId, "N2");
});

test("published registry routes Solo and Multiplayer to one frozen Pressure profile", () => {
  const loaded = loadSangtianPressureChapterPackageV1();
  const value = createPublishedSangtianPressureChapterRegistryV1({
    registryVersion: "pressure-registry-1.0.0",
    orchestrationPackageVersion: "orchestration-1.0.0",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "runtime-contract-1.0.0",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "test-matrix-1.0.0",
    testMatrixSha256: digest("tests"),
    narrativeProfileVersion: "openovel-pressure-1.0.0",
    featureSetVersion: "pressure-feature-1.0.0",
    resultContractRegistryVersion: "result-registry-1.0.0",
    controlTopologyVersion: "six-seat-control-1.0.0",
    package: loaded,
  });
  const registry = new PressureChapterRouteRegistry(value);
  const solo = registry.resolveCreate(null, "SOLO");
  const multiplayer = registry.resolveCreate(null, "MULTIPLAYER");
  assert.deepEqual(solo.route, PRESSURE_CHAPTER_ROUTE_TUPLE_V1);
  assert.deepEqual(multiplayer.route, PRESSURE_CHAPTER_ROUTE_TUPLE_V1);
  assert.equal(solo.contentPackageSha256, loaded.manifest.contentSha256);
  assert.equal(multiplayer.routeKey, solo.routeKey);
});

test("N7 and Finale use the accepted content-owned rule references", () => {
  const loaded = loadSangtianPressureChapterPackageV1();
  assert.deepEqual(loaded.content.finale.worldOutcomeRuleRefs, expectedWorldOutcomeRuleRefsV1());
  assert.deepEqual(loaded.content.finale.seatVerdictRuleRefs, expectedSeatVerdictRuleRefsV1());
  assert.deepEqual(loaded.content.finale.disclosureRuleRefs, [...SANGTIAN_DISCLOSURE_RULE_REFS_V1]);
  assert.equal(loaded.content.chapters[6]!.closePolicy.settlementPolicyRef, "sangtian.N7.settlement_v1");
  assert.equal(loaded.content.chapters[6]!.sourceRefs.some((ref) => ref.includes("finale/ending-rules.json")), true);
});

test("accepted frozen catalog compiles a deterministic authority result context before commit", () => {
  const loaded = loadSangtianPressureChapterPackageV1();
  const finaleInput = acceptedFinaleInputFixture();
  const request = {
    roomId: "room-accepted-result",
    participantMode: "SOLO" as const,
    completedAt: "2026-08-12T04:00:00.000Z",
    frozenRoute: PRESSURE_CHAPTER_ROUTE_V1,
    resultContractRegistryVersion: "result-registry-1.0.0",
    narrativeProfileVersion: "openovel-pressure-1.0.0",
    finaleInput,
    package: loaded,
  };
  const first = compileTerminalResultContextV1(request);
  const replay = compileTerminalResultContextV1(structuredClone(request));

  assert.deepEqual(replay, first);
  assert.equal(validateTerminalResultContextV1(first).contextHash, first.contextHash);
  assert.equal(first.contentPackageSha256, loaded.manifest.contentSha256);
  assert.equal(first.frozenRouteHash, finaleInput.routeHash);
  assert.equal(first.catalog.worldOutcomes.length, 7);
  assert.deepEqual(first.catalog.seats.map((seat) => seat.seatId), PRESSURE_CHAPTER_SEAT_IDS_V1);
  assert.deepEqual(first.catalog.tracks.map((track) => track.trackId), TRACK_IDS_V1);
  assert.equal(first.catalog.references.length > loaded.content.genesis.objects.length, true);
  assert.equal(first.catalog.references.every((reference) => {
    if (reference.sourceKind === "GENESIS") {
      return reference.sourceStageId === "P0"
        && reference.chapterSettlementId === null
        && reference.frozenSourceHash === finaleInput.genesisHash;
    }
    const bundle = finaleInput.frozenChapterBundles.find(
      (item) => item.chapterId === reference.sourceStageId,
    );
    return Boolean(bundle)
      && reference.chapterSettlementId === bundle!.bundleHash
      && reference.frozenSourceHash === bundle!.bundleHash;
  }), true);
});
