import test from "node:test";
import assert from "node:assert/strict";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  withRunRouteHash,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  createChapterWorkingState,
  loadSangtianPressureChapterPackageV1,
} from "@ai-story/templates";
import { SangtianAuthoredChapterContentAdapterV1 } from "../integration/content.adapters";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import { workingStateHash } from "../working-ledger/working-ledger";
import { PressureChapterOrchestratorService } from "./chapter-orchestrator.service";
import type { ChapterOrchestratorStateV1 } from "./contracts";
import { withOrchestratorHashV1 } from "./validation";

const NOW = 1_900_000_000_000;
const loaded = loadSangtianPressureChapterPackageV1();

test("resume folds five missing W5 actions into one W4 CAS", async () => {
  const route = makeRoute();
  const content = new SangtianAuthoredChapterContentAdapterV1();
  const descriptor = await content.load({ routeSnapshot: route, chapterId: "N1" });
  const decision = descriptor.decisions.find((item) =>
    PRESSURE_CHAPTER_SEAT_IDS_V1.every((seatId) => item.seatRequirements[seatId] === "REQUIRED"),
  );
  assert.ok(decision, "N1 fixture must expose an all-seat decision");
  const working = createChapterWorkingState({ runId: route.runId, chapterId: "N1" });
  const workingHash = workingStateHash(working);
  const point = descriptor.definition.decisionPoints.find(
    (item) => item.decisionPointId === decision.decisionPointId,
  )!;
  let state = withOrchestratorHashV1({
    schemaVersion: "pressure_chapter_orchestrator_state_v1",
    runId: route.runId,
    routeHash: route.routeHash,
    revision: 3,
    phase: "ACTIVE",
    currentChapterId: "N1",
    chapterRuntimeId: "chapter-n1-reconcile",
    descriptorHash: descriptor.descriptorHash,
    authorityBase: {
      baseWorldSequence: 0,
      baseWorldStateHash: digest("world"),
      previousFrozenHash: digest("genesis"),
    },
    activeDecision: {
      decisionPointId: decision.decisionPointId,
      policyHash: sha256Canonical(decision),
      openedAtMs: NOW - 1_000,
      deadlineAtMs: NOW + 300_000,
      seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => ({
        seatId,
        requirement: decision.seatRequirements[seatId],
        completion: index === 0 ? "SEALED_ACTIONS" as const : "PENDING" as const,
        actionIds: index === 0 ? ["human-action"] : [],
        actionCount: index === 0 ? 1 : 0,
        defaultCode: null,
      })),
    },
    chapterSeatSummaries: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => ({
      seatId,
      requirement: decision.seatRequirements[seatId],
      sealedActionIds: index === 0 ? ["human-action"] : [],
      defaultActionIds: [],
      defaultCodes: [],
    })),
    settlementInputHash: null,
    frozenBundleHash: null,
  });
  const projection = makeProjection(route, state, working, workingHash, point, decision);
  let readCount = 0;
  let casCount = 0;
  const service = new PressureChapterOrchestratorService(
    {
      read: async () => {
        readCount += 1;
        return structuredClone(state);
      },
      compareAndSwap: async (input) => {
        casCount += 1;
        assert.equal(input.expectedRevision, state.revision);
        state = structuredClone(input.next);
        return { status: "COMMITTED" as const, current: structuredClone(state) };
      },
    },
    content,
    { load: async () => working },
    {
      open: async () => ({
        status: "OPENED" as const,
        event: null,
        projection: structuredClone(projection),
      }),
    },
    { load: async () => projection },
    { submit: async () => { throw new Error("formal submit not used"); } },
    { resolve: async () => { throw new Error("Beat must not run when close evaluator is false"); } },
    { isClosed: async () => false },
    { submit: async () => { throw new Error("default not used"); } },
    { settle: async () => { throw new Error("settlement not used"); } },
    { request: async () => { throw new Error("finale not used"); } },
  );

  const result = await service.resume(route, NOW);

  assert.equal(casCount, 1);
  assert.equal(readCount, 1);
  assert.equal(result.revision, 4);
  assert.ok(result.activeDecision?.seats.every((seat) => seat.completion !== "PENDING"));
  assert.deepEqual(
    result.activeDecision?.seats.slice(1).flatMap((seat) => seat.actionIds).sort(),
    PRESSURE_CHAPTER_SEAT_IDS_V1.slice(1).map((seatId) => `ai-${seatId}`).sort(),
  );
});

function makeProjection(
  route: ReturnType<typeof makeRoute>,
  state: ChapterOrchestratorStateV1,
  working: ReturnType<typeof createChapterWorkingState>,
  stateHash: string,
  point: AuthoredPoint,
  decision: AuthoredDecision,
): WorkingLedgerProjectionV1 {
  const acceptedActions = new Map();
  for (const seatId of PRESSURE_CHAPTER_SEAT_IDS_V1.slice(1)) {
    const actionId = `ai-${seatId}`;
    const actionType = decision.execution.allowedActionTypes.find(
      (item: string) => item !== "DEFAULT_PASS",
    ) ?? "DEFAULT_PASS";
    acceptedActions.set(actionId, {
      action: {
        schemaVersion: "sangtian_decision_action_v1",
        actionId,
        runId: route.runId,
        chapterRuntimeId: state.chapterRuntimeId,
        chapterId: "N1",
        decisionPointId: decision.decisionPointId,
        seatId,
        actionOrdinal: 1,
        actionRevision: 1,
        controlEpoch: 1,
        expectedWorkingRevision: working.revision,
        status: "SEALED",
        actionType,
        payload: {},
        payloadHash: digest(`payload:${actionId}`),
        idempotencyKey: `pressure-ai-action-v1:${actionId}`,
        requestFingerprint: digest(`request:${actionId}`),
        sealedHash: digest(`sealed:${actionId}`),
      },
      routeHash: route.routeHash,
      inputFingerprint: digest(`input:${actionId}`),
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
      eventHash: digest(`event:${actionId}`),
    });
  }
  return {
    key: { runId: route.runId, chapterRuntimeId: state.chapterRuntimeId },
    chapterId: "N1",
    routeHash: route.routeHash,
    chapterDefinitionHash: state.descriptorHash,
    headHash: digest("ledger-head"),
    headSequence: 5,
    state: working,
    stateHash,
    nextDecisionPin: {
      schemaVersion: "pressure_decision_pin_v1",
      chapterId: "N1",
      stateRevision: working.revision,
      stateFingerprint: stateHash,
      decisionPointId: point.decisionPointId,
      kernelId: point.kernelId,
      optionIds: point.options.map((option: { optionId: string }) => option.optionId),
    },
    acceptedActions,
    actionsByIdempotencyKey: new Map(),
    commitmentActionsByIdempotencyKey: new Map(),
    appliedBeats: new Map(),
    pendingReservations: new Map(),
    commitments: new Map(),
    evidenceRefsByAction: new Map(),
    knowledgeBySeat: new Map(),
    seatArcProgressBySeat: new Map(),
  } as WorkingLedgerProjectionV1;
}

type AuthoredPoint = Awaited<ReturnType<SangtianAuthoredChapterContentAdapterV1["load"]>>["definition"]["decisionPoints"][number];
type AuthoredDecision = Awaited<ReturnType<SangtianAuthoredChapterContentAdapterV1["load"]>>["decisions"][number];

function makeRoute() {
  const topology = {
    schemaVersion: "pressure_initial_role_control_topology_v1" as const,
    controlTopologyVersion: "pressure_control_topology_v1",
    participantMode: "SOLO" as const,
    seatControls: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => ({
      seatId,
      mode: index === 0 ? "HUMAN_ACTIVE" as const : "AI_ACTIVE" as const,
    })),
  };
  return withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId: "run-reconcile",
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: loaded.manifest.packageVersion,
    contentPackageSha256: loaded.manifest.contentSha256,
    orchestrationPackageVersion: "pressure-orchestration-v1",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "pressure-runtime-v1",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "pressure-test-v1",
    testMatrixSha256: digest("tests"),
    runSeed: "reconcile-seed",
    narrativeProfileVersion: "pressure-narrative-v1",
    featureSetVersion: "pressure-feature-v1",
    resultContractRegistryVersion: "pressure-result-v1",
    participantMode: "SOLO",
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [PRESSURE_CHAPTER_SEAT_IDS_V1[0]!],
    controlTopologyVersion: topology.controlTopologyVersion,
    initialRoleControlSnapshotHash: sha256Canonical(topology),
  });
}

function digest(value: unknown): string {
  return sha256Canonical(value);
}
