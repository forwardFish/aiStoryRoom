import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  withRunRouteHash,
  type CanonicalJsonObject,
  type RunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  buildChapterWorkingSet,
  createChapterWorkingState,
  loadPublishedSangtianActionReleaseV1,
  loadSangtianPressureChapterPackageV1,
  pinChapterWorkingSet,
} from "@ai-story/templates";
import {
  withAiDecisionPolicySelectionHashV1,
} from "../decision-automation/service";
import type {
  AiDecisionPolicyInputV1,
  AiDecisionPolicySelectionV1,
  DecisionConvergenceDependenciesV1,
} from "../decision-automation/contracts";
import { SangtianAuthoredChapterContentAdapterV1 } from "../integration/content.adapters";
import { computeFormalInteractionInputFingerprint } from "../interaction/formal-interaction.service";
import type {
  AuthoredChapterRuntimeV1,
  ChapterOrchestratorStateV1,
  SubmitOrchestratedActionCommandV1,
} from "../orchestrator/contracts";
import { withOrchestratorHashV1 } from "../orchestrator/validation";
import type { SeatAuthorityRecordV1, SeatControlSnapshotV1 } from "../seat-control/types";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import { workingStateHash } from "../working-ledger/working-ledger";
import {
  planPressureSql7PreparedAutomationActionBatchV1,
  type PressureSql7BatchPlannerPortsV1,
} from "./batch-planner";
import type { DecisionToNextProjectionSnapshotV1 } from "./snapshot-contract";

const NOW = 1_900_000_000_000;
const POLICY_HASH = digest("sql7-published-ai-policy");
const loaded = loadSangtianPressureChapterPackageV1();

test("plans one canonical HUMAN + five AI actions and one deterministic Beat", async () => {
  const fixture = await makeFixture(PRESSURE_CHAPTER_SEAT_IDS_V1[2]!);
  const counters = { content: 0, policy: 0, compiler: 0 };
  const ports = makePorts(fixture, counters);

  const first = await planPressureSql7PreparedAutomationActionBatchV1({
    snapshot: fixture.snapshot,
    humanCommand: fixture.humanCommand,
    nowMs: NOW,
  }, ports);
  const second = await planPressureSql7PreparedAutomationActionBatchV1({
    snapshot: fixture.snapshot,
    humanCommand: fixture.humanCommand,
    nowMs: NOW,
  }, ports);

  assert.equal(first.actions.length, 6);
  assert.deepEqual(
    first.actions.map((item) => item.command.action.seatId),
    PRESSURE_CHAPTER_SEAT_IDS_V1,
  );
  assert.equal(first.actions.filter((item) => item.authority.actorKind === "HUMAN").length, 1);
  assert.equal(first.actions.filter((item) => item.authority.actorKind === "AI").length, 5);
  assert.equal(first.beatPlan.event.payload.eventType, "BEAT_APPLIED");
  assert.equal(first.beatPlan.resolution.sealedActionIds.length, 6);
  assert.equal(first.batchHash, second.batchHash);
  assert.deepEqual(first, second);
  assert.deepEqual(counters, { content: 2, policy: 10, compiler: 10 });
});

test("fails before content or AI work unless exactly one human and five AI are pending", async () => {
  const fixture = await makeFixture(
    PRESSURE_CHAPTER_SEAT_IDS_V1[0]!,
    [PRESSURE_CHAPTER_SEAT_IDS_V1[0]!, PRESSURE_CHAPTER_SEAT_IDS_V1[1]!],
  );
  const counters = { content: 0, policy: 0, compiler: 0 };

  await assert.rejects(
    planPressureSql7PreparedAutomationActionBatchV1({
      snapshot: fixture.snapshot,
      humanCommand: fixture.humanCommand,
      nowMs: NOW,
    }, makePorts(fixture, counters)),
    /PRESSURE_SQL7_BATCH_PLANNER_INVALID:pendingSeats:EXPECTED_1_HUMAN_5_AI:2:4/u,
  );
  assert.deepEqual(counters, { content: 0, policy: 0, compiler: 0 });
});

test("planner source and port surface expose no database or Provider capability", () => {
  const source = readFileSync(resolve(__dirname, "batch-planner.ts"), "utf8");

  assert.doesNotMatch(source, /Prisma|\$queryRaw|\$transaction|createMany|updateMany/u);
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:provider|llm|narrative-model)[^"']*["']/iu);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.match(source, /PressureSql7BatchPlannerPortsV1/u);
  assert.match(source, /content: Pick<DecisionAutomationContentPortV1, "load">/u);
  assert.match(source, /policy: PublishedContentOwnedAiDecisionPolicyPortV1/u);
  assert.match(source, /compiler: Pick<DecisionAutomationCommandCompilerPortV1, "compile">/u);
});

interface FixtureV1 {
  route: RunRouteSnapshotV1;
  descriptor: AuthoredChapterRuntimeV1;
  chapter: ChapterOrchestratorStateV1;
  projection: WorkingLedgerProjectionV1;
  seatAuthority: SeatControlSnapshotV1;
  snapshot: DecisionToNextProjectionSnapshotV1;
  humanCommand: SubmitOrchestratedActionCommandV1;
}

async function makeFixture(
  submitSeatId: SeatIdV1,
  humanSeatIds: readonly SeatIdV1[] = [submitSeatId],
): Promise<FixtureV1> {
  const route = makeRoute(humanSeatIds);
  const content = new SangtianAuthoredChapterContentAdapterV1();
  const descriptor = await content.load({ routeSnapshot: route, chapterId: "N1" });
  const decision = descriptor.decisions.find((candidate) => (
    PRESSURE_CHAPTER_SEAT_IDS_V1.every(
      (seatId) => candidate.seatRequirements[seatId] === "REQUIRED",
    )
  ));
  assert.ok(decision);
  const working = createChapterWorkingState({
    runId: route.runId,
    chapterId: "N1",
    facts: loadPublishedSangtianActionReleaseV1().compileChapterActionEffects({
      chapterId: "N1",
      confirmedActions: [],
      defaultEvents: [],
    }).settlementFacts,
  });
  const workingSet = buildChapterWorkingSet(descriptor.definition, working);
  assert.ok(workingSet);
  assert.equal(workingSet.decisionPoint.decisionPointId, decision.decisionPointId);
  const chapter = withOrchestratorHashV1({
    schemaVersion: "pressure_chapter_orchestrator_state_v1",
    runId: route.runId,
    routeHash: route.routeHash,
    revision: 7,
    phase: "ACTIVE",
    currentChapterId: "N1",
    chapterRuntimeId: `chapter-N1-${digest(route.runId).slice(0, 12)}`,
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
      requirement: "REQUIRED" as const,
      sealedActionIds: [],
      defaultActionIds: [],
      defaultCodes: [],
    })),
    settlementInputHash: null,
    frozenBundleHash: null,
  });
  const projection: WorkingLedgerProjectionV1 = {
    key: { runId: route.runId, chapterRuntimeId: chapter.chapterRuntimeId },
    chapterId: "N1",
    routeHash: route.routeHash,
    chapterDefinitionHash: sha256Canonical(descriptor.definition),
    headHash: digest("opening-ledger-head"),
    headSequence: 0,
    state: working,
    stateHash: workingStateHash(working),
    nextDecisionPin: pinChapterWorkingSet(workingSet),
    acceptedActions: new Map(),
    actionsByIdempotencyKey: new Map(),
    commitmentActionsByIdempotencyKey: new Map(),
    appliedBeats: new Map(),
    pendingReservations: new Map(),
    commitments: new Map(),
    evidenceRefsByAction: new Map(),
    knowledgeBySeat: new Map(),
    seatArcProgressBySeat: new Map(),
  };
  const seatAuthority = makeSeatSnapshot(route, humanSeatIds);
  const submitSeat = seatAuthority.seatControls.find((seat) => seat.seatId === submitSeatId)!;
  const humanCommand = makeHumanCommand(route, chapter, projection, descriptor, submitSeat);
  const snapshotHash = digest({
    schemaVersion: "test_sql7_snapshot_v1",
    runId: route.runId,
    chapterRuntimeId: chapter.chapterRuntimeId,
    capturedAtMs: NOW,
  });
  const snapshot: DecisionToNextProjectionSnapshotV1 = {
    schemaVersion: "pressure_decision_to_next_projection_snapshot_v1",
    request: {
      roomId: route.runId,
      runId: route.runId,
      subjectId: submitSeat.activeControllerId,
      seatId: submitSeatId,
      chapterRuntimeId: chapter.chapterRuntimeId,
      decisionPointId: decision.decisionPointId,
      expectedRouteHash: route.routeHash,
      expectedWorkingRevision: projection.state.revision,
      expectedControlEpoch: submitSeat.controlEpoch,
      expectedSubmissionFenceToken: submitSeat.submissionFenceToken,
      idempotencyKey: humanCommand.action.idempotencyKey,
    },
    storedRoute: {} as DecisionToNextProjectionSnapshotV1["storedRoute"],
    routeSnapshot: route,
    world: {
      runId: route.runId,
      version: 1,
      currentNodeId: "N1",
      worldSequence: 0,
      reservedWorldSequence: 0,
      state: {} as DecisionToNextProjectionSnapshotV1["world"]["state"],
    },
    chapter,
    runtime: {
      id: chapter.chapterRuntimeId,
      runId: route.runId,
      chapterId: "N1",
      chapterSequence: 1,
      state: "DECISION_POINT_OPEN",
      baseWorldSequence: 0,
      baseWorldStateHash: chapter.authorityBase.baseWorldStateHash,
      previousFrozenHash: chapter.authorityBase.previousFrozenHash,
      routeHash: route.routeHash,
      contentPackageVersion: route.contentPackageVersion,
      contentHash: route.contentPackageSha256,
      orchestrationPackageVersion: route.orchestrationPackageVersion,
      orchestrationHash: route.orchestrationPackageSha256,
      runtimeContractVersion: route.runtimeContractVersion,
      runtimeContractHash: route.runtimeContractSha256,
      workingRevision: projection.state.revision,
      workingStateHash: projection.stateHash,
      workingState: projection.state,
      decisionState: chapter.activeDecision,
      ledgerProjectionCache: {},
      closeInputHash: null,
      lockVersion: 1,
    },
    workingProjection: projection,
    seatAuthority,
    submitSeat,
    viewer: {
      playerId: "player-1",
      runId: route.runId,
      subjectId: submitSeat.activeControllerId,
      playerType: "human",
      status: "active",
      roleId: submitSeatId,
      roleKey: submitSeatId,
      roleName: submitSeatId,
    },
    viewerPrivateProjection: {} as DecisionToNextProjectionSnapshotV1["viewerPrivateProjection"],
    viewerPresence: null,
    persistenceFence: {
      orchestratorEventId: "orchestrator-1",
      orchestratorDedupeKey: "orchestrator-dedupe-1",
      orchestratorPayload: chapter,
      seatStateRevision: seatAuthority.stateRevision,
      seatVersion: 1,
      seatStateHash: seatAuthority.stateHash,
      seatSnapshotJson: seatAuthority,
    },
    existingDecisionActionRows: [],
    projectionSeed: {
      narrativeProjectionRows: [],
      aEmotionAggregateRows: [],
      viewerDeliveryRows: [],
      aEmotionDeliveryMarkRows: [],
    },
    capturedAtMs: NOW,
    snapshotHash,
  };
  return { route, descriptor, chapter, projection, seatAuthority, snapshot, humanCommand };
}

function makePorts(
  fixture: FixtureV1,
  counters: { content: number; policy: number; compiler: number },
): PressureSql7BatchPlannerPortsV1 {
  return {
    content: {
      load: async () => {
        counters.content += 1;
        return structuredClone(fixture.descriptor);
      },
    },
    policy: {
      artifactSha256: POLICY_HASH,
      select: (input) => {
        counters.policy += 1;
        return makeSelection(input);
      },
    },
    compiler: {
      compile: (input) => {
        counters.compiler += 1;
        return { kind: "COMMAND", command: makeAiCommand(input, fixture.route) };
      },
    },
  };
}

function makeRoute(humanSeatIds: readonly SeatIdV1[]): RunRouteSnapshotV1 {
  const topologyBody = {
    schemaVersion: "pressure_initial_role_control_topology_v1" as const,
    controlTopologyVersion: "pressure_control_topology_v1",
    participantMode: humanSeatIds.length === 1 ? "SOLO" as const : "MULTIPLAYER" as const,
    seatControls: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      mode: humanSeatIds.includes(seatId) ? "HUMAN_ACTIVE" as const : "AI_ACTIVE" as const,
    })),
  };
  return withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId: `run-sql7-${humanSeatIds.join("-")}`,
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: loaded.manifest.packageVersion,
    contentPackageSha256: loaded.manifest.contentSha256,
    orchestrationPackageVersion: "pressure-orchestration-v1",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "pressure-runtime-v1",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "pressure-test-v1",
    testMatrixSha256: digest("test"),
    runSeed: `seed-${humanSeatIds.join("-")}`,
    narrativeProfileVersion: "pressure-narrative-v1",
    featureSetVersion: "pressure-features-v1",
    resultContractRegistryVersion: "pressure-result-v1",
    participantMode: topologyBody.participantMode,
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [...humanSeatIds],
    controlTopologyVersion: topologyBody.controlTopologyVersion,
    initialRoleControlSnapshotHash: sha256Canonical(topologyBody),
  });
}

function makeSeatSnapshot(
  route: RunRouteSnapshotV1,
  humanSeatIds: readonly SeatIdV1[],
): SeatControlSnapshotV1 {
  const humans = new Set(humanSeatIds);
  const frozenPolicyBody = {
    schemaVersion: "pressure_frozen_seat_control_policy_v1" as const,
    policyVersion: "pressure-seat-control-v1",
    disconnectPolicy: "PRESENCE_ADVISORY_ONLY" as const,
    takeoverDeadlinePolicyRef: "deadline-v1",
    takeoverDeadlinePolicyHash: digest("deadline-policy"),
    deterministicDefaultPolicyRef: "default-v1",
    deterministicDefaultPolicyHash: digest("default-policy"),
    humanReclaimAllowed: true,
  };
  const frozenPolicy = { ...frozenPolicyBody, policyHash: sha256Canonical(frozenPolicyBody) };
  const seatControls: SeatAuthorityRecordV1[] = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
    const human = humans.has(seatId);
    const designatedAiControllerId = `pressure-ai:${seatId}`;
    return {
      seatId,
      mode: human ? "HUMAN_ACTIVE" : "AI_ACTIVE",
      originalHumanControllerId: human ? `human:${seatId}` : null,
      designatedAiControllerId,
      activeControllerId: human ? `human:${seatId}` : designatedAiControllerId,
      controlEpoch: 1,
      submissionFenceToken: digest(`submit:${seatId}`),
      reclaimFenceToken: human ? digest(`reclaim:${seatId}`) : null,
      lastAuthorityEventHash: digest(`authority:${seatId}`),
    };
  });
  const body = {
    schemaVersion: "pressure_seat_control_snapshot_v1" as const,
    runId: route.runId,
    participantMode: route.participantMode,
    routeHash: route.routeHash,
    genesisHash: digest("genesis"),
    genesisAtomicRecordHash: digest("genesis-atomic"),
    initialTopologyHash: route.initialRoleControlSnapshotHash,
    controlTopologyVersion: route.controlTopologyVersion,
    frozenPolicy,
    stateRevision: 1,
    timelineLength: 6,
    timelineHeadHash: digest("timeline"),
    seatControls,
    initializationInputHash: digest("initialization"),
  };
  return { ...body, stateHash: sha256Canonical(body) };
}

function makeSelection(input: AiDecisionPolicyInputV1): AiDecisionPolicySelectionV1 {
  const actionType = input.eligibleActionTypes.find((item) => item !== "DEFAULT_PASS")
    ?? "DEFAULT_PASS";
  return withAiDecisionPolicySelectionHashV1({
    policyRef: "sangtian.ai.decision.v1",
    policyVersion: "sangtian-ai-decision-1.0.0",
    policyHash: POLICY_HASH,
    resolvedContentPackageVersion: input.contentPackageVersion,
    resolvedContentPackageSha256: input.contentPackageSha256,
    inputHash: input.inputHash,
    actionType,
  });
}

function makeAiCommand(
  input: Parameters<DecisionConvergenceDependenciesV1["compiler"]["compile"]>[0],
  route: RunRouteSnapshotV1,
): SubmitOrchestratedActionCommandV1 {
  const seatId = input.seatAuthority.seatId;
  const idempotencyKey = `pressure-ai-action-v1:${route.runId}:${input.chapter.chapterRuntimeId}:${input.chapter.activeDecision!.decisionPointId}:${seatId}:${input.seatAuthority.controlEpoch}`;
  const payload = {
    source: "CONTENT_OWNED_AI_POLICY" as const,
    policyRef: input.selection.policyRef,
    policyVersion: input.selection.policyVersion,
    policyHash: input.selection.policyHash,
    selectionHash: input.selection.selectionHash,
  };
  return sealCommand({
    route,
    subjectId: input.seatAuthority.activeControllerId,
    chapter: input.chapter,
    projection: input.projection,
    seatId,
    controlEpoch: input.seatAuthority.controlEpoch,
    actionType: input.selection.actionType,
    payload,
    idempotencyKey,
  });
}

function makeHumanCommand(
  route: RunRouteSnapshotV1,
  chapter: ChapterOrchestratorStateV1,
  projection: WorkingLedgerProjectionV1,
  descriptor: AuthoredChapterRuntimeV1,
  authority: SeatAuthorityRecordV1,
): SubmitOrchestratedActionCommandV1 {
  const decision = descriptor.decisions.find(
    (item) => item.decisionPointId === chapter.activeDecision!.decisionPointId,
  )!;
  const actionType = decision.execution.allowedActionTypes[0]!;
  return sealCommand({
    route,
    subjectId: authority.activeControllerId,
    chapter,
    projection,
    seatId: authority.seatId,
    controlEpoch: authority.controlEpoch,
    actionType,
    payload: { optionCode: actionType, customText: null },
    idempotencyKey: `human-action:${route.runId}:${authority.seatId}`,
  });
}

function sealCommand(input: Readonly<{
  route: RunRouteSnapshotV1;
  subjectId: string;
  chapter: ChapterOrchestratorStateV1;
  projection: WorkingLedgerProjectionV1;
  seatId: SeatIdV1;
  controlEpoch: number;
  actionType: string;
  payload: CanonicalJsonObject;
  idempotencyKey: string;
}>): SubmitOrchestratedActionCommandV1 {
  const actionBase = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId: `action_${digest(input.idempotencyKey)}`,
    runId: input.route.runId,
    chapterRuntimeId: input.chapter.chapterRuntimeId,
    chapterId: input.chapter.currentChapterId,
    decisionPointId: input.chapter.activeDecision!.decisionPointId,
    seatId: input.seatId,
    actionOrdinal: 1,
    actionRevision: 1,
    controlEpoch: input.controlEpoch,
    expectedWorkingRevision: input.projection.state.revision,
    status: "SEALED" as const,
    actionType: input.actionType,
    payload: input.payload,
    payloadHash: digest(input.payload),
    idempotencyKey: input.idempotencyKey,
  };
  const withRequest = {
    ...actionBase,
    requestFingerprint: computeDecisionActionRequestFingerprint(actionBase),
  };
  const action = { ...withRequest, sealedHash: digest(withRequest) };
  const intent = {
    visibility: "PRIVATE" as const,
    targetSeatIds: [],
    evidenceRefs: [],
    resourceReservations: [],
    commitmentMutations: [],
    knowledgeGrants: [],
    seatArcProgress: [],
  };
  const command = {
    routeSnapshot: input.route,
    subjectId: input.subjectId,
    action,
    intent,
    nowMs: NOW,
  };
  return { ...command, inputFingerprint: computeFormalInteractionInputFingerprint(command) };
}

function digest(value: unknown): string {
  return sha256Canonical(value);
}
