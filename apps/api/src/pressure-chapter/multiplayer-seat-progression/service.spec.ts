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
  loadSangtianPressureChapterBeatAuthoringV1,
  loadSangtianPressureChapterPackageV1,
} from "@ai-story/templates";
import type { WorkingProjectionReaderPort } from "../orchestrator/contracts";
import type {
  AcceptedFormalActionV1,
  WorkingLedgerProjectionV1,
} from "../working-ledger/contracts";
import {
  readAcceptedMultiplayerSeatActionsV1,
} from "./accepted-actions";
import {
  MultiplayerSeatProgressionServiceV1,
  projectMultiplayerSeatProgressionV1,
} from "./service";

const GOVERNOR: SeatIdV1 = "zhejiang_governor";
const ADMINISTRATION: SeatIdV1 = "zhejiang_administration";
const runtimeId = "runtime-multiplayer-seat";
const authoring = loadSangtianPressureChapterBeatAuthoringV1("N1");

test("M2 reads one seat's contiguous durable prefix without another seat", () => {
  const route = routeFixture([GOVERNOR, ADMINISTRATION]);
  const firstDecision = authoring.beats[0]!.catalogDecisionPointRef;
  const projection = projectionFixture(route, [
    acceptedFixture(route, GOVERNOR, firstDecision, "action-governor-1"),
    acceptedFixture(route, ADMINISTRATION, firstDecision, "action-administration-1"),
  ]);
  const result = readAcceptedMultiplayerSeatActionsV1({
    routeSnapshot: route,
    chapterRuntimeId: runtimeId,
    chapterId: "N1",
    seatId: GOVERNOR,
    package: authoring,
    projection,
  });
  assert.deepEqual(result.actions, [{
    decisionPointId: firstDecision,
    actionId: "action-governor-1",
  }]);
});

test("M2 fails closed for a non-contiguous future action", () => {
  const route = routeFixture([GOVERNOR, ADMINISTRATION]);
  const projection = projectionFixture(route, [
    acceptedFixture(
      route,
      GOVERNOR,
      authoring.beats[1]!.catalogDecisionPointRef,
      "action-governor-2",
    ),
  ]);
  assert.throws(() => readAcceptedMultiplayerSeatActionsV1({
    routeSnapshot: route,
    chapterRuntimeId: runtimeId,
    chapterId: "N1",
    seatId: GOVERNOR,
    package: authoring,
    projection,
  }), /NON_CONTIGUOUS_PREFIX/u);
});

test("M3 advances only the submitted seat and rebuilds the cursor from durable state", async () => {
  const route = routeFixture([GOVERNOR, ADMINISTRATION]);
  const firstDecision = authoring.beats[0]!.catalogDecisionPointRef;
  const accepted = acceptedFixture(route, GOVERNOR, firstDecision, "action-governor-1");
  const before = projectionFixture(route, []);
  const after = projectionFixture(route, [accepted]);
  let reads = 0;
  let writes = 0;
  const working: WorkingProjectionReaderPort = {
    async load() {
      reads += 1;
      return reads === 1 ? before : after;
    },
  };
  const service = new MultiplayerSeatProgressionServiceV1(
    working,
    {
      async submit() {
        writes += 1;
        return { status: "ACCEPTED", event: {} } as never;
      },
    },
  );
  const result = await service.submit({
    routeSnapshot: route,
    subjectId: "human-governor",
    action: accepted.action,
    intent: accepted.intent,
    inputFingerprint: accepted.inputFingerprint,
    nowMs: 1,
  });
  const otherSeat = projectMultiplayerSeatProgressionV1(
    route,
    runtimeId,
    "N1",
    ADMINISTRATION,
    after,
    "NOT_SUBMITTED",
  );
  assert.equal(writes, 1);
  assert.equal(result.cursor.decisionPointId, authoring.beats[1]!.catalogDecisionPointRef);
  assert.equal(otherSeat.cursor.decisionPointId, firstDecision);
});

test("M3 replays an already persisted command before checking the advanced seat cursor", async () => {
  const route = routeFixture([GOVERNOR, ADMINISTRATION]);
  const firstDecision = authoring.beats[0]!.catalogDecisionPointRef;
  const accepted = acceptedFixture(route, GOVERNOR, firstDecision, "action-governor-replay");
  const projection = projectionFixture(route, [accepted]);
  let writes = 0;
  const service = new MultiplayerSeatProgressionServiceV1(
    { async load() { return projection; } },
    { async submit() { writes += 1; return { status: "ACCEPTED" } as never; } },
  );
  const result = await service.submit({
    routeSnapshot: route,
    subjectId: "human-governor",
    action: accepted.action,
    intent: accepted.intent,
    inputFingerprint: accepted.inputFingerprint,
    nowMs: 2,
  });
  assert.equal(writes, 0);
  assert.equal(result.submissionStatus, "REPLAYED");
  assert.equal(result.cursor.decisionPointId, authoring.beats[1]!.catalogDecisionPointRef);
});

test("M2/M3 advance a Solo human without writing AI seat actions", () => {
  const route = routeFixture([GOVERNOR]);
  const firstDecision = authoring.beats[0]!.catalogDecisionPointRef;
  const projection = projectionFixture(route, [
    acceptedFixture(route, GOVERNOR, firstDecision, "action-solo-governor-1"),
  ]);
  const result = projectMultiplayerSeatProgressionV1(
    route,
    runtimeId,
    "N1",
    GOVERNOR,
    projection,
    "NOT_SUBMITTED",
  );
  assert.equal(result.cursor.decisionPointId, authoring.beats[1]!.catalogDecisionPointRef);
  assert.equal(result.accepted.actions.length, 1);
});

test("M3 fast submit reuses the compiler projection and performs no progression reread", async () => {
  const route = routeFixture([GOVERNOR, ADMINISTRATION]);
  const firstDecision = authoring.beats[0]!.catalogDecisionPointRef;
  const accepted = acceptedFixture(route, GOVERNOR, firstDecision, "action-governor-fast");
  const before = projectionFixture(route, []);
  const after = projectionFixture(route, [accepted]);
  let reads = 0;
  let preparedWrites = 0;
  const service = new MultiplayerSeatProgressionServiceV1(
    {
      async load() {
        reads += 1;
        throw new Error("fast submit must not reload progression");
      },
    },
    {
      async submit() {
        throw new Error("fast submit must use submitPrepared");
      },
      async submitPrepared(_command, projection) {
        preparedWrites += 1;
        assert.equal(projection.headHash, before.headHash);
        return { status: "ACCEPTED", event: {} as never, projection: after };
      },
    },
  );

  const result = await service.submit({
    routeSnapshot: route,
    subjectId: "human-governor",
    action: accepted.action,
    intent: accepted.intent,
    inputFingerprint: accepted.inputFingerprint,
    nowMs: 1,
  }, before);

  assert.equal(reads, 0);
  assert.equal(preparedWrites, 1);
  assert.equal(result.cursor.decisionPointId, authoring.beats[1]!.catalogDecisionPointRef);
  assert.equal(result.accepted.actions.length, 1);
});

function projectionFixture(
  route: RunRouteSnapshotV1,
  accepted: AcceptedFormalActionV1[],
): WorkingLedgerProjectionV1 {
  return {
    key: { runId: route.runId, chapterRuntimeId: runtimeId },
    chapterId: "N1",
    routeHash: route.routeHash,
    chapterDefinitionHash: digest("definition"),
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
    runId: `run-${participantMode.toLowerCase()}`,
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: loaded.manifest.packageVersion,
    contentPackageSha256: loaded.manifest.contentSha256,
    orchestrationPackageVersion: "pressure-orchestration-v1",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "pressure-runtime-v1",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "pressure-test-v1",
    testMatrixSha256: digest("test"),
    runSeed: "seed",
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
