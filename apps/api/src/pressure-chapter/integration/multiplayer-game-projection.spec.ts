import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  withRunRouteHash,
  type RunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  loadPublishedSangtianActionReleaseV1,
  loadSangtianPressureChapterBeatAuthoringV1,
  loadSangtianPressureChapterPackageV1,
} from "@ai-story/templates";
import { withOrchestratorHashV1 } from "../orchestrator/validation";
import type { AcceptedFormalActionV1, WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import {
  SangtianAuthoredChapterContentAdapterV1,
  SangtianPressureGameContentMapperV1,
  SangtianReleaseActionPresentationCatalogAdapterV1,
} from "./content.adapters";
import { SangtianPressureGameChapterReaderAdapterV1 } from "./game-projection.adapters";

const GOVERNOR: SeatIdV1 = "zhejiang_governor";
const ADMINISTRATION: SeatIdV1 = "zhejiang_administration";
const runtimeId = "runtime-m4";

test("M4 projects a different durable Beat decision for each viewer seat", async () => {
  const route = routeFixture([ADMINISTRATION, GOVERNOR]);
  const content = new SangtianAuthoredChapterContentAdapterV1();
  const chapter = await content.load({ routeSnapshot: route, chapterId: "N1" });
  const authoring = loadSangtianPressureChapterBeatAuthoringV1("N1");
  const first = authoring.beats[0]!.catalogDecisionPointRef;
  const second = authoring.beats[1]!.catalogDecisionPointRef;
  const projection = projectionFixture(route, chapter.definition, [
    acceptedFixture(route, GOVERNOR, first, "action-governor-1"),
  ]);
  const state = stateFixture(route, chapter, first);
  const mapper = new SangtianPressureGameContentMapperV1(
    new SangtianReleaseActionPresentationCatalogAdapterV1(
      loadPublishedSangtianActionReleaseV1(),
    ),
  );
  const reader = new SangtianPressureGameChapterReaderAdapterV1(
    null as never,
    null as never,
    null as never,
    null as never,
    mapper,
  );
  const governor = reader.projectMultiplayerCurrent({
    runId: route.runId,
    routeHash: route.routeHash,
    viewerSeatId: GOVERNOR,
    routeSnapshot: route,
    state,
    projection,
    chapter,
  });
  const administration = reader.projectMultiplayerCurrent({
    runId: route.runId,
    routeHash: route.routeHash,
    viewerSeatId: ADMINISTRATION,
    routeSnapshot: route,
    state,
    projection,
    chapter,
  });
  assert.equal(governor.decision?.decisionPointId, second);
  assert.equal(administration.decision?.decisionPointId, first);
  assert.equal(governor.viewerBeatContext?.previousPlayerAction?.decisionPointId, first);
  assert.equal(governor.viewerBeatContext?.previousPlayerAction?.actionType, "DEFAULT_PASS");
  assert.equal(
    governor.viewerBeatContext?.previousPlayerAction?.effectText,
    "不追加疏散、守堰或证据命令；水势、旧令和其他席位行动继续推进。",
  );
  assert.equal(governor.viewerBeatContext?.story?.beatId, authoring.beats[1]!.beatId);
  assert.ok((governor.viewerBeatContext?.story?.authorialMaterials.length ?? 0) > 0);
  assert.equal(administration.viewerBeatContext?.previousPlayerAction, null);
  assert.equal(administration.viewerBeatContext?.story?.beatId, authoring.beats[0]!.beatId);
  assert.equal(JSON.stringify(governor).includes("action-governor-1"), false);
  assert.equal(JSON.stringify(administration).includes("action-governor-1"), false);
});

test("M4 multiplayer projection rejects a Solo route", async () => {
  const route = routeFixture([GOVERNOR]);
  const content = new SangtianAuthoredChapterContentAdapterV1();
  const chapter = await content.load({ routeSnapshot: route, chapterId: "N1" });
  const first = loadSangtianPressureChapterBeatAuthoringV1("N1")
    .beats[0]!.catalogDecisionPointRef;
  const reader = new SangtianPressureGameChapterReaderAdapterV1(
    null as never,
    null as never,
    null as never,
    null as never,
    new SangtianPressureGameContentMapperV1(
      new SangtianReleaseActionPresentationCatalogAdapterV1(
        loadPublishedSangtianActionReleaseV1(),
      ),
    ),
  );
  assert.throws(() => reader.projectMultiplayerCurrent({
    runId: route.runId,
    routeHash: route.routeHash,
    viewerSeatId: GOVERNOR,
    routeSnapshot: route,
    state: stateFixture(route, chapter, first),
    projection: projectionFixture(route, chapter.definition, []),
    chapter,
  }), /CHAPTER_OR_WORKING_MISMATCH/u);
});

function stateFixture(
  route: RunRouteSnapshotV1,
  chapter: Awaited<ReturnType<SangtianAuthoredChapterContentAdapterV1["load"]>>,
  decisionPointId: string,
) {
  const decision = chapter.decisions.find((item) => item.decisionPointId === decisionPointId)!;
  return withOrchestratorHashV1({
    schemaVersion: "pressure_chapter_orchestrator_state_v1",
    runId: route.runId,
    routeHash: route.routeHash,
    revision: 1,
    phase: "ACTIVE",
    currentChapterId: "N1",
    chapterRuntimeId: runtimeId,
    descriptorHash: chapter.descriptorHash,
    authorityBase: {
      baseWorldSequence: 0,
      baseWorldStateHash: digest("world"),
      previousFrozenHash: digest("previous"),
    },
    activeDecision: {
      decisionPointId,
      policyHash: sha256Canonical(decision),
      openedAtMs: 1,
      deadlineAtMs: null,
      seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
        const requirement = decision.seatRequirements[seatId];
        return {
          seatId,
          requirement,
          completion: requirement === "REQUIRED" ? "PENDING" as const : "NOT_REQUIRED" as const,
          actionIds: [],
          actionCount: 0,
          defaultCode: null,
        };
      }),
    },
    chapterSeatSummaries: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      requirement: "NOT_REQUIRED" as const,
      sealedActionIds: [],
      defaultActionIds: [],
      defaultCodes: [],
    })),
    settlementInputHash: null,
    frozenBundleHash: null,
  });
}

function projectionFixture(
  route: RunRouteSnapshotV1,
  definition: object,
  accepted: AcceptedFormalActionV1[],
): WorkingLedgerProjectionV1 {
  return {
    key: { runId: route.runId, chapterRuntimeId: runtimeId },
    chapterId: "N1",
    routeHash: route.routeHash,
    chapterDefinitionHash: sha256Canonical(definition),
    headHash: digest(`head-${accepted.length}`),
    headSequence: accepted.length,
    state: { revision: 0 } as never,
    stateHash: digest("working"),
    nextDecisionPin: null,
    acceptedActions: new Map(accepted.map((item) => [item.action.actionId, item])),
    actionsByIdempotencyKey: new Map(accepted.map((item) => [item.action.idempotencyKey, item])),
    appliedBeats: new Map(),
    pendingReservations: new Map(),
    commitments: new Map(),
    evidenceRefsByAction: new Map(),
    knowledgeBySeat: new Map(),
    seatArcProgressBySeat: new Map(),
  };
}

function acceptedFixture(
  route: RunRouteSnapshotV1,
  seatId: SeatIdV1,
  decisionPointId: string,
  actionId: string,
): AcceptedFormalActionV1 {
  return {
    action: {
      schemaVersion: "sangtian_decision_action_v1",
      actionId,
      runId: route.runId,
      chapterRuntimeId: runtimeId,
      chapterId: "N1",
      decisionPointId,
      seatId,
      actionOrdinal: 1,
      actionRevision: 1,
      controlEpoch: 1,
      expectedWorkingRevision: 0,
      status: "SEALED",
      actionType: "DEFAULT_PASS",
      payload: {},
      payloadHash: digest(`${actionId}-payload`),
      requestFingerprint: digest(`${actionId}-request`),
      idempotencyKey: `${actionId}-idem`,
      sealedHash: digest(`${actionId}-sealed`),
    },
    routeHash: route.routeHash,
    inputFingerprint: digest(`${actionId}-input`),
    intent: {
      visibility: "PRIVATE",
      targetSeatIds: [],
      evidenceRefs: [],
      resourceReservations: [],
      commitmentMutations: [],
      knowledgeGrants: [],
      seatArcProgress: [],
    },
    audienceSeatIds: [seatId],
    eventHash: digest(`${actionId}-event`),
  };
}

function routeFixture(humans: readonly SeatIdV1[]): RunRouteSnapshotV1 {
  const loaded = loadSangtianPressureChapterPackageV1();
  const orderedHumans = PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatId) => humans.includes(seatId));
  const participantMode = orderedHumans.length > 1 ? "MULTIPLAYER" : "SOLO";
  const topology = {
    schemaVersion: "pressure_initial_role_control_topology_v1" as const,
    controlTopologyVersion: "pressure_control_topology_v1",
    participantMode,
    seatControls: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      mode: orderedHumans.includes(seatId) ? "HUMAN_ACTIVE" as const : "AI_ACTIVE" as const,
    })),
  };
  return withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId: `run-m4-${participantMode.toLowerCase()}`,
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: loaded.manifest.packageVersion,
    contentPackageSha256: loaded.manifest.contentSha256,
    orchestrationPackageVersion: "pressure-orchestration-v1",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "pressure-runtime-v1",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "pressure-test-v1",
    testMatrixSha256: digest("test"),
    runSeed: "seed-m4",
    narrativeProfileVersion: "pressure-narrative-v1",
    featureSetVersion: "pressure-features-v1",
    resultContractRegistryVersion: "pressure-result-v1",
    participantMode,
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [...orderedHumans],
    controlTopologyVersion: topology.controlTopologyVersion,
    initialRoleControlSnapshotHash: sha256Canonical(topology),
  });
}

function digest(value: string): string {
  return sha256Canonical({ value });
}
