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
import type { ChapterOrchestratorStateV1 } from "../orchestrator/contracts";
import { withOrchestratorHashV1 } from "../orchestrator/validation";
import type { AcceptedFormalActionV1, WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import { MultiplayerChapterConvergenceServiceV1 } from "./service";

const ADMINISTRATION: SeatIdV1 = "zhejiang_administration";
const GOVERNOR: SeatIdV1 = "zhejiang_governor";
const humans = [ADMINISTRATION, GOVERNOR] as const;
const runtimeId = "runtime-m5";
const authoring = loadSangtianPressureChapterBeatAuthoringV1("N1");

test("M5 waits without reconciling or filling AI until every human is chapter-ready", async () => {
  const harness = createHarness(false);
  const result = await harness.service.convergeIfReady({
    routeSnapshot: harness.route,
    chapterRuntimeId: runtimeId,
    chapterId: "N1",
    nowMs: 10,
  });
  assert.equal(result.status, "WAITING_FOR_HUMANS");
  assert.deepEqual(result.waitingSeatIds, [GOVERNOR]);
  assert.equal(harness.reconciled.length, 0);
  assert.equal(harness.convergenceCalls, 0);
});

test("M5 reconciles preserved human actions and invokes existing AI convergence once per Beat", async () => {
  const harness = createHarness(true);
  const result = await harness.service.convergeIfReady({
    routeSnapshot: harness.route,
    chapterRuntimeId: runtimeId,
    chapterId: "N1",
    nowMs: 10,
  });
  assert.equal(result.status, "CONVERGED");
  assert.equal(harness.convergenceCalls, authoring.beats.length);
  assert.equal(harness.reconciled.length, authoring.beats.length * humans.length);
  assert.equal(harness.humanActionValues.every((value) => value === null), true);
  assert.equal(result.chapter?.phase, "FROZEN");
});

test("M5 replay after convergence does not run settlement again", async () => {
  const harness = createHarness(true);
  const command = {
    routeSnapshot: harness.route,
    chapterRuntimeId: runtimeId,
    chapterId: "N1" as const,
    nowMs: 10,
  };
  await harness.service.convergeIfReady(command);
  const before = harness.convergenceCalls;
  const replay = await harness.service.convergeIfReady(command);
  assert.equal(replay.status, "CONVERGED");
  assert.equal(harness.convergenceCalls, before);
});

test("M5 resumes an interrupted chapter-end convergence before continuing later Beats", async () => {
  const harness = createHarness(true, undefined, "RESOLVING_BEAT");
  const result = await harness.service.convergeIfReady({
    routeSnapshot: harness.route,
    chapterRuntimeId: runtimeId,
    chapterId: "N1",
    nowMs: 10,
  });
  assert.equal(result.status, "CONVERGED");
  assert.equal(result.chapter?.phase, "FROZEN");
  assert.equal(harness.convergenceCalls, authoring.beats.length - 1);
  assert.equal(harness.reconciled.length, (authoring.beats.length - 1) * humans.length);
});

test("M5 preserves actions submitted before a human seat hands off and lets AI fill only later gaps", async () => {
  const harness = createHarness(true, undefined, "ACTIVE", GOVERNOR);
  const result = await harness.service.convergeIfReady({
    routeSnapshot: harness.route,
    chapterRuntimeId: runtimeId,
    chapterId: "N1",
    nowMs: 10,
  });
  assert.equal(result.status, "CONVERGED");
  assert.equal(result.chapter?.phase, "FROZEN");
  assert.equal(harness.convergenceCalls, authoring.beats.length);
  assert.equal(harness.reconciled.length, authoring.beats.length + 2);
});

test("M5 cannot be entered by Solo", async () => {
  const harness = createHarness(true, routeFixture([GOVERNOR]));
  await assert.rejects(
    harness.service.convergeIfReady({
      routeSnapshot: harness.route,
      chapterRuntimeId: runtimeId,
      chapterId: "N1",
      nowMs: 10,
    }),
    /MULTIPLAYER_REQUIRED/u,
  );
});

function createHarness(
  allReady: boolean,
  routeValue?: RunRouteSnapshotV1,
  initialPhase: "ACTIVE" | "RESOLVING_BEAT" = "ACTIVE",
  handedOffSeatId?: SeatIdV1,
) {
  const route = routeValue ?? routeFixture(humans);
  const accepted = humans.flatMap((seatId) => authoring.beats.flatMap((beat, index) => (
    (allReady || seatId === ADMINISTRATION)
      && (seatId !== handedOffSeatId || index < 2)
      ? [acceptedFixture(route, seatId, beat.catalogDecisionPointRef, `action-${seatId}-${index}`)]
      : []
  )));
  const projection = projectionFixture(route, accepted);
  let state = initialPhase === "ACTIVE"
    ? activeState(route, 0)
    : withOrchestratorHashV1({
        ...withoutHash(activeState(route, 0)),
        phase: initialPhase,
      });
  const reconciled: string[] = [];
  const humanActionValues: Array<unknown> = [];
  let convergenceCalls = 0;
  const service = new MultiplayerChapterConvergenceServiceV1(
    { async read() { return state; } },
    { async load() { return projection; } },
    {
      async readSnapshot() {
        return {
          routeHash: route.routeHash,
          seatControls: humans.map((seatId) => ({
            seatId,
            mode: seatId === handedOffSeatId ? "AI_ACTIVE" : "HUMAN_ACTIVE",
            activeControllerId: seatId === handedOffSeatId ? `ai-${seatId}` : `human-${seatId}`,
            controlEpoch: seatId === handedOffSeatId ? 2 : 1,
          })),
        } as never;
      },
    },
    {
      async resume() {
        state = activeState(route, 1, state.revision + 1);
        return state;
      },
      async reconcileAcceptedMultiplayerAction(input) {
        reconciled.push(input.actionId);
        const seatId = input.actionId.includes(ADMINISTRATION)
          ? ADMINISTRATION
          : GOVERNOR;
        state = mutateActiveSeat(state, seatId, input.actionId);
        return state;
      },
    },
    {
      async converge(command) {
        convergenceCalls += 1;
        humanActionValues.push(command.humanAction);
        const currentPoint = state.activeDecision?.decisionPointId;
        const currentIndex = authoring.beats.findIndex(
          (beat) => beat.catalogDecisionPointRef === currentPoint,
        );
        const nextIndex = currentIndex + 1;
        state = nextIndex >= authoring.beats.length
          ? frozenState(route, state.revision + 1)
          : activeState(route, nextIndex, state.revision + 1);
        return {
          outcome: "BATCH_COMPLETED",
          chapter: state,
        } as never;
      },
      async recordHttpCompletion() {},
    },
  );
  return {
    route,
    service,
    reconciled,
    humanActionValues,
    get convergenceCalls() { return convergenceCalls; },
  };
}

function mutateActiveSeat(
  source: ChapterOrchestratorStateV1,
  seatId: SeatIdV1,
  actionId: string,
): ChapterOrchestratorStateV1 {
  return withOrchestratorHashV1({
    ...withoutHash(source),
    revision: source.revision + 1,
    activeDecision: source.activeDecision
      ? {
          ...source.activeDecision,
          seats: source.activeDecision.seats.map((seat) => seat.seatId === seatId
            ? {
                ...seat,
                completion: "SEALED_ACTIONS" as const,
                actionIds: [actionId],
                actionCount: 1,
              }
            : seat),
        }
      : null,
  });
}

function activeState(
  route: RunRouteSnapshotV1,
  beatIndex: number,
  revision = 1,
): ChapterOrchestratorStateV1 {
  const point = authoring.beats[beatIndex]!.catalogDecisionPointRef;
  return withOrchestratorHashV1({
    schemaVersion: "pressure_chapter_orchestrator_state_v1",
    runId: route.runId,
    routeHash: route.routeHash,
    revision,
    phase: "ACTIVE",
    currentChapterId: "N1",
    chapterRuntimeId: runtimeId,
    descriptorHash: digest("descriptor"),
    authorityBase: {
      baseWorldSequence: 0,
      baseWorldStateHash: digest("world"),
      previousFrozenHash: digest("previous"),
    },
    activeDecision: {
      decisionPointId: point,
      policyHash: digest(`policy-${point}`),
      openedAtMs: 1,
      deadlineAtMs: null,
      seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
        seatId,
        requirement: "REQUIRED" as const,
        completion: "PENDING" as const,
        actionIds: [],
        actionCount: 0,
        defaultCode: null,
      })),
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

function frozenState(route: RunRouteSnapshotV1, revision: number): ChapterOrchestratorStateV1 {
  return withOrchestratorHashV1({
    ...withoutHash(activeState(route, 0, revision)),
    phase: "FROZEN",
    activeDecision: null,
    frozenBundleHash: digest("frozen"),
  });
}

function withoutHash(state: ChapterOrchestratorStateV1) {
  const { orchestratorHash: _ignored, ...body } = state;
  return body;
}

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

function routeFixture(humanSeats: readonly SeatIdV1[]): RunRouteSnapshotV1 {
  const loaded = loadSangtianPressureChapterPackageV1();
  const orderedHumans = PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatId) => humanSeats.includes(seatId));
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
    runId: `run-m5-${participantMode.toLowerCase()}`,
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: loaded.manifest.packageVersion,
    contentPackageSha256: loaded.manifest.contentSha256,
    orchestrationPackageVersion: "pressure-orchestration-v1",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "pressure-runtime-v1",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "pressure-test-v1",
    testMatrixSha256: digest("test"),
    runSeed: "seed-m5",
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
