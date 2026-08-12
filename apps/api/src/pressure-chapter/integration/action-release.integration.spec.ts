import assert from "node:assert/strict";
import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
} from "@ai-story/shared";
import {
  SANGTIAN_ACTION_RELEASE_ERROR_CODES,
  SangtianActionReleaseError,
  createPublishedSangtianPressureChapterRegistryV1,
  loadPublishedSangtianActionReleaseV1,
  type ConfirmedSangtianChapterActionV1,
} from "@ai-story/templates";
import { SangtianReleaseActionPresentationCatalogAdapterV1 } from "./content.adapters";
import { PressureChapterIntegrationError } from "./errors";

const N1_DECISION = "N1.weir_crisis";

test("published loader pins the full route and rejects a tampered CJS core", (t) => {
  const release = loadPublishedSangtianActionReleaseV1();
  assert.equal(release.route.status, "PUBLISHED");
  assert.equal(release.route.createEnabled, true);
  assert.equal(release.routeRegistration.routeKey, "sangtian_pressure_chapter_v1");
  assert.equal(release.routeRegistration.status, "PUBLISHED");
  assert.equal(release.routeRegistration.createEnabled, true);
  assert.deepEqual(release.routeConfiguration, {
    registryVersion: "pressure-route-registry-1.0.0",
    orchestrationPackageVersion: release.routeRegistration.orchestrationPackageVersion,
    orchestrationPackageSha256: release.routeRegistration.orchestrationPackageSha256,
    runtimeContractVersion: release.routeRegistration.runtimeContractVersion,
    runtimeContractSha256: release.routeRegistration.runtimeContractSha256,
    testMatrixVersion: release.routeRegistration.testMatrixVersion,
    testMatrixSha256: release.routeRegistration.testMatrixSha256,
    narrativeProfileVersion: release.routeRegistration.narrativeProfileVersion,
    featureSetVersion: release.routeRegistration.featureSetVersion,
    resultContractRegistryVersion: release.routeRegistration.resultContractRegistryVersion,
    controlTopologyVersion: release.routeRegistration.controlTopologyVersion,
  });
  const reconstructedRegistry = createPublishedSangtianPressureChapterRegistryV1(
    release.routeConfiguration,
  );
  assert.deepEqual(reconstructedRegistry.routes, [release.routeRegistration]);
  assert.equal(
    reconstructedRegistry.registryHash,
    "ed7b03f220fb6ba2e6b1b64d7e78bde7db8b20b0fd7499b9dc5d0dcbe48b40a6",
  );

  const sourceRoot = resolve(
    __dirname,
    "../../../../../packages/templates/config/sangtian/pressure-chapter-v1/release",
  );
  const temporaryRoot = mkdtempSync(join(tmpdir(), "sangtian-action-release-"));
  const copiedReleaseRoot = join(temporaryRoot, "release");
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  cpSync(sourceRoot, copiedReleaseRoot, { recursive: true });
  appendFileSync(
    join(copiedReleaseRoot, "action-effect-compiler.cjs"),
    "\n// tampered after publication\n",
  );
  assert.throws(
    () => loadPublishedSangtianActionReleaseV1({ releaseRoot: copiedReleaseRoot }),
    (error: unknown) => (
      error instanceof SangtianActionReleaseError
      && error.code === SANGTIAN_ACTION_RELEASE_ERROR_CODES.ARTIFACT_HASH_MISMATCH
    ),
  );
});

test("published loader rejects a route that is no longer create-enabled", (t) => {
  const sourceRoot = resolve(
    __dirname,
    "../../../../../packages/templates/config/sangtian/pressure-chapter-v1/release",
  );
  const temporaryRoot = mkdtempSync(join(tmpdir(), "sangtian-route-release-"));
  const copiedReleaseRoot = join(temporaryRoot, "release");
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  cpSync(sourceRoot, copiedReleaseRoot, { recursive: true });
  const manifestPath = join(copiedReleaseRoot, "release-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    routeRegistry: {
      registryHash: string;
      routes: Array<{ createEnabled: boolean }>;
      [key: string]: unknown;
    };
  };
  manifest.routeRegistry.routes[0]!.createEnabled = false;
  const { registryHash: _registryHash, ...registryWithoutHash } = manifest.routeRegistry;
  manifest.routeRegistry.registryHash = sha256Canonical(registryWithoutHash);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  assert.throws(
    () => loadPublishedSangtianActionReleaseV1({ releaseRoot: copiedReleaseRoot }),
    (error: unknown) => (
      error instanceof SangtianActionReleaseError
      && error.code === SANGTIAN_ACTION_RELEASE_ERROR_CODES.MANIFEST_INVALID
    ),
  );
});

test("action binding compiler fails closed for an unpublished identity", () => {
  const release = loadPublishedSangtianActionReleaseV1();
  assert.throws(
    () => release.compileActionBinding({
      chapterId: "N1",
      decisionPointKey: N1_DECISION,
      seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
      actionType: "CLIENT_DEFINED_RULE",
    }),
    /SANGTIAN_ACTION_EFFECT_BINDING_NOT_FOUND/,
  );
});

test("mixed human/default actions aggregate contributions without a default event", () => {
  const release = loadPublishedSangtianActionReleaseV1();
  const actions = mixedActions();
  const compiled = release.compileChapterActionEffects({
    chapterId: "N1",
    confirmedActions: actions,
    defaultEvents: [],
  });
  assert.equal(compiled.aggregationMode, "ACTION_CONTRIBUTIONS");
  assert.equal(compiled.defaultTrajectoryEventId, null);
  assert.deepEqual(compiled.settlementFacts, {
    evacuationCoveragePct: 70,
    criticalWeirsSecuredCount: 2,
    verifiedBreachRecordCount: 1,
    disasterSeverity: 2,
  });
  assert.deepEqual(compiled.resourceReservationMutations, []);
  assert.deepEqual(compiled.chapterEndResourceDispositions, []);
});

test("all-default actions apply one trajectory and duplicate events fail closed", () => {
  const release = loadPublishedSangtianActionReleaseV1();
  const actions = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => ({
    actionId: `default-action-${index + 1}`,
    decisionPointKey: N1_DECISION,
    seatId,
    actionType: "DEFAULT_PASS",
  }));
  const event = {
    eventId: "default-trajectory-N1",
    eventType: "APPLY_DEFAULT_TRAJECTORY" as const,
  };
  const compiled = release.compileChapterActionEffects({
    chapterId: "N1",
    confirmedActions: actions,
    defaultEvents: [event],
  });
  assert.equal(compiled.aggregationMode, "DEFAULT_TRAJECTORY_ONCE");
  assert.equal(compiled.defaultTrajectoryEventId, event.eventId);
  assert.deepEqual(compiled.settlementFacts, {
    evacuationCoveragePct: 50,
    criticalWeirsSecuredCount: 1,
    verifiedBreachRecordCount: 1,
    disasterSeverity: 3,
  });
  assert.throws(
    () => release.compileChapterActionEffects({
      chapterId: "N1",
      confirmedActions: actions,
      defaultEvents: [event, { ...event, eventId: "duplicate-default-trajectory-N1" }],
    }),
    /SANGTIAN_ACTION_EFFECT_DEFAULT_TRAJECTORY_DUPLICATE/,
  );
});

test("whole-chapter compilation is permutation stable", () => {
  const release = loadPublishedSangtianActionReleaseV1();
  const actions = mixedActions();
  const first = release.compileChapterActionEffects({
    chapterId: "N1",
    confirmedActions: actions,
    defaultEvents: [],
  });
  const reversed = release.compileChapterActionEffects({
    chapterId: "N1",
    confirmedActions: [...actions].reverse(),
    defaultEvents: [],
  });
  assert.equal(first.compilationHash, reversed.compilationHash);
  assert.deepEqual(first, reversed);
});

test("release presentation catalog implements the game projection port", () => {
  const release = loadPublishedSangtianActionReleaseV1();
  const catalog = new SangtianReleaseActionPresentationCatalogAdapterV1(release);
  const presentation = catalog.read({
    contentPackageVersion: release.route.contentPackageVersion,
    contentPackageHash: release.route.contentPackageSha256,
    chapterId: "N1",
    decisionPointId: N1_DECISION,
    actionType: "EVACUATE_WEIRS",
  });
  assert.equal(presentation.actionType, "EVACUATE_WEIRS");
  assert.equal(presentation.preferredEntry, "PLAN");
  assert.equal(presentation.label, "组织堰区疏散");
  assert.ok(presentation.description.trim());
  assert.equal(catalog.read({
    contentPackageVersion: release.route.contentPackageVersion,
    contentPackageHash: release.route.contentPackageSha256,
    chapterId: "N1",
    decisionPointId: N1_DECISION,
    actionType: "DEFAULT_PASS",
  }).preferredEntry, "DEFER");
  assert.throws(
    () => catalog.read({
      contentPackageVersion: release.route.contentPackageVersion,
      contentPackageHash: release.route.contentPackageSha256,
      chapterId: "N1",
      decisionPointId: N1_DECISION,
      actionType: "CLIENT_DEFINED_RULE",
    }),
    (error: unknown) => (
      error instanceof PressureChapterIntegrationError
      && error.code === "INTEGRATION_CONTENT_MISMATCH"
    ),
  );
});

function mixedActions(): ConfirmedSangtianChapterActionV1[] {
  const actionTypes = [
    "EVACUATE_WEIRS",
    "SUPPORT_WEIR",
    "SEAL_BREACH_RECORD",
    "DEFAULT_PASS",
    "DEFAULT_PASS",
    "DEFAULT_PASS",
  ];
  return PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => ({
    actionId: `mixed-action-${index + 1}`,
    decisionPointKey: N1_DECISION,
    seatId,
    actionType: actionTypes[index]!,
  }));
}
