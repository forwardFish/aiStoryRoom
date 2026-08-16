import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  validateFrozenChapterBundleV1,
  withRunRouteHash,
  type ParticipantModeV1,
  type RunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  buildChapterWorkingSet,
  compileInitialWorldState,
  createChapterWorkingState,
  loadPublishedSangtianActionReleaseV1,
  loadSangtianPressureChapterPackageV1,
  pinChapterWorkingSet,
} from "@ai-story/templates";
import { SangtianContentOwnedChapterPolicyAdapterV1 } from "../integration/content-policy.adapter";
import {
  SangtianAuthoredChapterContentAdapterV1,
  SangtianChapterWorkingSeedAdapterV1,
} from "../integration/content.adapters";
import { computeFormalInteractionInputFingerprint } from "../interaction/formal-interaction.service";
import {
  planBeatProgressionV1,
  planRecordedActionsV1,
} from "../orchestrator/chapter-orchestrator.service";
import { withOrchestratorHashV1 } from "../orchestrator/validation";
import { planBeatAuthorityDownstreamV1 } from "../projection-plan/authority-downstream";
import type { SeatControlSnapshotV1 } from "../seat-control/types";
import {
  appendBeatEventToWorkingLedgerProjection,
  workingStateHash,
} from "../working-ledger/working-ledger";
import { planWorkingLedgerOpeningV1 } from "../working-ledger/working-ledger.service";
import { workingLedgerProjectionCacheHashV1 } from "../working-ledger/projection-cache";
import {
  SangtianAuthoritativeBeatCompilerV1,
  planSynchronizedDecisionBeatV1,
} from "../integration/working-ledger.adapters";
import {
  createPreparedAutomationActionBatchV1,
  planPreparedActionLedgerV1,
} from "../decision-automation/prepared-action-batch";
import type {
  AppendPreparedAutomationActionCommandV1,
  PreparedAutomationActionBatchV1,
} from "../decision-automation/contracts";
import type { DecisionToNextProjectionSnapshotV1 } from "./snapshot-contract";
import {
  planN1DecisionToN2SettlementV1,
  type N2AuthoredChapterContentAuthorityPortV1,
  type N2ChapterWorkingSeedAuthorityPortV1,
} from "./settlement-planner";

const NOW = 1_900_000_000_000;
const loaded = loadSangtianPressureChapterPackageV1();
const digest = (label: unknown): string => sha256Canonical({ label });

test("N1 SQL7 planner seals canonical settlement and opens N2 from committed authority", async () => {
  const fixture = await buildFixture();
  const content = new SangtianAuthoredChapterContentAdapterV1();
  const seedAdapter = new SangtianChapterWorkingSeedAdapterV1({
    readAuthorityBase: async () => {
      throw new Error("repository fallback must not be used");
    },
  });
  let contentAuthorityCalls = 0;
  let seedAuthorityCalls = 0;
  const nextContent: N2AuthoredChapterContentAuthorityPortV1 = {
    loadFromAuthority: async (input) => {
      contentAuthorityCalls += 1;
      assert.equal(input.chapterId, "N2");
      assert.equal(input.source.routeHash, fixture.route.routeHash);
      assert.equal(input.source.sourceFrozenHash, input.authorityBase.previousFrozenHash);
      assert.equal(input.source.worldState.stateHash, input.authorityBase.baseWorldStateHash);
      return content.load({ routeSnapshot: input.routeSnapshot, chapterId: input.chapterId });
    },
  };
  const nextSeed: N2ChapterWorkingSeedAuthorityPortV1 = {
    loadFromAuthority: async (input) => {
      seedAuthorityCalls += 1;
      return seedAdapter.loadFromAuthority(input);
    },
  };
  const result = await planN1DecisionToN2SettlementV1({
    snapshot: fixture.snapshot,
    batch: fixture.batch,
    settlementPolicy: new SangtianContentOwnedChapterPolicyAdapterV1(),
    nextContent,
    nextSeed,
  });

  const record = result.atomicRecord;
  const bundle = validateFrozenChapterBundleV1(
    record.frozenChapterBundle,
    fixture.snapshot.chapter.authorityBase.previousFrozenHash,
  );
  assert.equal(contentAuthorityCalls, 1);
  assert.equal(seedAuthorityCalls, 1);
  assert.equal(record.chapterId, "N1");
  assert.equal(record.runId, fixture.route.runId);
  assert.equal(record.sealedInput.inputHash, fixture.batch.beatPlan.settlementInput?.inputHash);
  assert.notEqual(record.sourceHash, record.atomicRecordHash);
  assert.equal(record.receipt.bundleHash, bundle.bundleHash);
  assert.equal(record.receipt.commitHash, record.receipt.commitHash.toLowerCase());
  assert.equal(bundle.decisionLedgerHash, result.postBeatProjection.headHash);
  assert.equal(bundle.finalWorkingStateHash, result.postBeatProjection.stateHash);
  assert.equal(bundle.frozenWorldState.stateHash, bundle.committedWorldStateHash);
  assert.equal(result.postBeatProjection.headHash, fixture.batch.beatPlan.event.eventHash);
  assert.equal(result.frozenOrchestratorState.phase, "FROZEN");
  assert.equal(result.frozenOrchestratorState.frozenBundleHash, bundle.bundleHash);
  assert.equal(
    result.frozenOrchestratorState.authorityBase.previousFrozenHash,
    bundle.bundleHash,
  );
  assert.equal(result.nextChapterDescriptor.chapterId, "N2");
  assert.equal(result.nextChapterOpening.state.currentChapterId, "N2");
  assert.equal(result.nextChapterOpening.state.phase, "ACTIVE");
  assert.equal(result.nextChapterOpening.projection.chapterId, "N2");
  assert.equal(
    result.nextChapterOpening.state.authorityBase.baseWorldStateHash,
    bundle.committedWorldStateHash,
  );
  assert.equal(
    sha256Canonical(result.beatPlan.narrativeJobs),
    sha256Canonical(fixture.batch.beatPlan.narrativeJobs),
  );
  assert.equal(
    sha256Canonical(result.beatPlan.aEmotionEmissions),
    sha256Canonical(fixture.batch.beatPlan.aEmotionEmissions),
  );
  assert.equal(
    sha256Canonical(result.beatPlan.downstreamManifest),
    sha256Canonical(fixture.batch.beatPlan.downstreamManifest),
  );
  assert.match(record.atomicRecordHash, /^[a-f0-9]{64}$/u);
  assert.match(record.sourceHash, /^[a-f0-9]{64}$/u);
  assert.match(record.receipt.commitHash, /^[a-f0-9]{64}$/u);
  assert.match(result.frozenOrchestratorState.orchestratorHash, /^[a-f0-9]{64}$/u);

  await assert.rejects(
    planN1DecisionToN2SettlementV1({
      snapshot: { ...fixture.snapshot, snapshotHash: digest("tampered-snapshot") },
      batch: fixture.batch,
      settlementPolicy: new SangtianContentOwnedChapterPolicyAdapterV1(),
      nextContent,
      nextSeed,
    }),
    /PRESSURE_SQL7_SETTLEMENT_PLANNER_INVALID:SNAPSHOT_HASH_MISMATCH/u,
  );
  assert.equal(contentAuthorityCalls, 1);
  assert.equal(seedAuthorityCalls, 1);
});

async function buildFixture(): Promise<{
  route: RunRouteSnapshotV1;
  snapshot: DecisionToNextProjectionSnapshotV1;
  batch: PreparedAutomationActionBatchV1;
}> {
  const route = makeRoute();
  const content = new SangtianAuthoredChapterContentAdapterV1();
  const descriptor = await content.load({ routeSnapshot: route, chapterId: "N1" });
  const decision = descriptor.decisions.find((candidate) =>
    PRESSURE_CHAPTER_SEAT_IDS_V1.every(
      (seatId) => candidate.seatRequirements[seatId] === "REQUIRED",
    ));
  assert.ok(decision, "N1 must expose an all-seat decision");
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
  const chapterRuntimeId = `chapter-N1-${digest(route.runId).slice(0, 24)}`;
  const opening = planWorkingLedgerOpeningV1({
    routeSnapshot: route,
    chapterRuntimeId,
    chapterDefinition: descriptor.definition,
    initialState: working,
  });
  assert.equal(opening.projection.nextDecisionPin?.decisionPointId, decision.decisionPointId);
  const world = compileInitialWorldState(loaded);
  const chapter = withOrchestratorHashV1({
    schemaVersion: "pressure_chapter_orchestrator_state_v1",
    runId: route.runId,
    routeHash: route.routeHash,
    revision: 7,
    phase: "ACTIVE",
    currentChapterId: "N1",
    chapterRuntimeId,
    descriptorHash: descriptor.descriptorHash,
    authorityBase: {
      baseWorldSequence: 0,
      baseWorldStateHash: world.stateHash,
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
  const seatAuthority = makeSeatSnapshot(route);
  const submitSeat = seatAuthority.seatControls[0]!;
  const request = {
    roomId: route.runId,
    runId: route.runId,
    subjectId: submitSeat.activeControllerId,
    seatId: submitSeat.seatId,
    chapterRuntimeId,
    decisionPointId: decision.decisionPointId,
    expectedRouteHash: route.routeHash,
    expectedWorkingRevision: opening.projection.state.revision,
    expectedControlEpoch: submitSeat.controlEpoch,
    expectedSubmissionFenceToken: submitSeat.submissionFenceToken,
    idempotencyKey: "submit-sql7-n1",
  };
  const privatePayload = { secretRefs: [] };
  const viewerPrivateProjection = {
    schemaVersion: "pressure_seat_private_projection_record_v1" as const,
    runId: route.runId,
    seatId: submitSeat.seatId,
    sourceAuthorityHash: seatAuthority.stateHash,
    projectionVersion: "private-v1",
    payload: privatePayload,
    payloadHash: sha256Canonical(privatePayload),
  };
  const runtime = {
    id: chapterRuntimeId,
    runId: route.runId,
    chapterId: "N1" as const,
    chapterSequence: 1,
    state: "DECISION_POINT_OPEN" as const,
    baseWorldSequence: 0,
    baseWorldStateHash: world.stateHash,
    previousFrozenHash: chapter.authorityBase.previousFrozenHash,
    routeHash: route.routeHash,
    contentPackageVersion: route.contentPackageVersion,
    contentHash: route.contentPackageSha256,
    orchestrationPackageVersion: route.orchestrationPackageVersion,
    orchestrationHash: route.orchestrationPackageSha256,
    runtimeContractVersion: route.runtimeContractVersion,
    runtimeContractHash: route.runtimeContractSha256,
    workingRevision: opening.projection.state.revision,
    workingStateHash: opening.projection.stateHash,
    workingState: opening.projection.state,
    decisionState: chapter.activeDecision,
    ledgerProjectionCache: {},
    closeInputHash: null,
    lockVersion: 1,
  };
  const persistenceFence = {
    orchestratorEventId: `orchestrator-${chapter.orchestratorHash}`,
    orchestratorDedupeKey: `orchestrator:${route.runId}:${chapter.revision}`,
    orchestratorPayload: chapter,
    seatStateRevision: seatAuthority.stateRevision,
    seatVersion: 1,
    seatStateHash: seatAuthority.stateHash,
    seatSnapshotJson: seatAuthority,
  };
  const storedRoute = {
    schemaVersion: "pressure_stored_run_route_v1" as const,
    runId: route.runId,
    routeKey: "pressure_chapter_v1",
    registryVersion: "registry-v1",
    registryHash: digest("registry"),
    handlerKey: "pressure_chapter_v1" as const,
    resultAdapterKey: "SangtianPressureResultV1Adapter" as const,
    presentationSchemaVersion: "sangtian_pressure_result_v1" as const,
    rendererKey: "sangtian_pressure_endgame_v1" as const,
    createRequestFingerprint: digest("create-route"),
    snapshot: route,
    controlTopology: {
      schemaVersion: "pressure_initial_role_control_topology_v1" as const,
      controlTopologyVersion: route.controlTopologyVersion,
      participantMode: route.participantMode,
      seatControls: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
        seatId,
        mode: route.humanSeatIdsAtStart.includes(seatId)
          ? "HUMAN_ACTIVE" as const
          : "AI_ACTIVE" as const,
      })),
      topologyHash: route.initialRoleControlSnapshotHash,
    },
    recordHash: digest("stored-route"),
  };
  const projectionSeed = {
    narrativeProjectionRows: [],
    aEmotionAggregateRows: [],
    viewerDeliveryRows: [],
    aEmotionDeliveryMarkRows: [],
  };
  const snapshotBody = {
    schemaVersion: "pressure_decision_to_next_projection_snapshot_v1" as const,
    request,
    storedRoute,
    routeSnapshot: route,
    world: {
      runId: route.runId,
      version: 1,
      currentNodeId: "N1",
      worldSequence: 0,
      reservedWorldSequence: 0,
      state: world,
    },
    chapter,
    runtime,
    workingProjection: opening.projection,
    seatAuthority,
    submitSeat,
    viewer: {
      playerId: "player-1",
      runId: route.runId,
      subjectId: submitSeat.activeControllerId,
      playerType: "human" as const,
      status: "active" as const,
      roleId: "role-1",
      roleKey: submitSeat.seatId,
      roleName: "Test role",
    },
    viewerPrivateProjection,
    viewerPresence: null,
    persistenceFence,
    existingDecisionActionRows: [],
    projectionSeed,
    capturedAtMs: NOW,
  };
  const snapshot: DecisionToNextProjectionSnapshotV1 = {
    ...snapshotBody,
    snapshotHash: sha256Canonical({
      schemaVersion: snapshotBody.schemaVersion,
      request: snapshotBody.request,
      storedRouteHash: storedRoute.recordHash,
      routeHash: route.routeHash,
      world: {
        version: snapshotBody.world.version,
        worldSequence: snapshotBody.world.worldSequence,
        reservedWorldSequence: snapshotBody.world.reservedWorldSequence,
        stateHash: world.stateHash,
      },
      chapter: { revision: chapter.revision, orchestratorHash: chapter.orchestratorHash },
      runtime,
      workingProjectionHash: workingLedgerProjectionCacheHashV1(opening.projection),
      seat: {
        stateRevision: seatAuthority.stateRevision,
        stateHash: seatAuthority.stateHash,
        seatId: submitSeat.seatId,
        controllerId: submitSeat.activeControllerId,
        controlEpoch: submitSeat.controlEpoch,
        submissionFenceToken: submitSeat.submissionFenceToken,
      },
      viewer: snapshotBody.viewer,
      viewerPrivateProjection,
      viewerPresence: null,
      persistenceFence,
      existingDecisionActionRowsHash: sha256Canonical([]),
      projectionSeedHash: sha256Canonical(projectionSeed),
      capturedAtMs: NOW,
    }),
  };
  const actions = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) =>
    preparedAction(snapshot, descriptor, decision, seatId, index));
  const recordedState = planRecordedActionsV1(
    chapter,
    actions.map(({ command }) => ({
      seatId: command.action.seatId,
      actionId: command.action.actionId,
      defaultCode: null,
      actionBudget: decision.execution.perSeatActionBudget[command.action.seatId]!,
    })),
    true,
  );
  const actionProjection = planPreparedActionLedgerV1({
    projection: opening.projection,
    actions,
  }).projection;
  const actionIds = [...new Set(
    recordedState.activeDecision?.seats.flatMap((seat) => seat.actionIds) ?? [],
  )].sort();
  const beat = planSynchronizedDecisionBeatV1({
    routeSnapshot: route,
    chapterDefinition: descriptor.definition,
    chapterRuntimeId,
    actionIds,
    resolverVersion: "pressure_orchestrated_beat_v1",
    projection: actionProjection,
    decisionPolicy: new SangtianAuthoritativeBeatCompilerV1(),
  });
  assert.equal(beat.status, "PLANNED");
  if (beat.status !== "PLANNED") throw new Error("Beat fixture was replayed");
  const postBeatProjection = appendBeatEventToWorkingLedgerProjection(
    actionProjection,
    beat.event,
  );
  const progression = planBeatProgressionV1({
    state: recordedState,
    descriptor,
    projection: postBeatProjection,
    resolution: beat.resolution,
    nowMs: NOW,
    participantMode: route.participantMode,
  });
  assert.equal(progression.nextState.phase, "SETTLING");
  assert.ok(progression.settlementInput);
  const downstream = planBeatAuthorityDownstreamV1({
    projection: postBeatProjection,
    beatEvent: beat.event,
    contentPackageSha256: route.contentPackageSha256,
    committedAt: new Date(NOW).toISOString(),
    humanSeatIds: route.humanSeatIdsAtStart,
  });
  const batch = createPreparedAutomationActionBatchV1({
    batchId: "batch-sql7-n1",
    snapshotHash: digest("convergence-snapshot"),
    routeSnapshot: route,
    chapterRuntimeId,
    chapterId: "N1",
    decisionPointId: decision.decisionPointId,
    expectedOrchestratorRevision: chapter.revision,
    expectedOrchestratorHash: chapter.orchestratorHash,
    expectedWorkingRevision: opening.projection.state.revision,
    expectedWorkingStateHash: opening.projection.stateHash,
    expectedLedgerHeadHash: opening.projection.headHash,
    expectedSeatAuthorityStateHash: seatAuthority.stateHash,
    actions,
    chapterDescriptor: descriptor,
    nextOrchestratorState: recordedState,
    beatPlan: {
      event: beat.event,
      resolution: beat.resolution,
      postBeatOrchestratorState: progression.nextState,
      settlementInput: progression.settlementInput,
      narrativeJobs: downstream.narrativeJobs,
      aEmotionEmissions: downstream.aEmotionEmissions,
      downstreamManifest: downstream.manifest,
    },
  });
  return { route, snapshot, batch };
}

function preparedAction(
  snapshot: DecisionToNextProjectionSnapshotV1,
  descriptor: PreparedAutomationActionBatchV1["chapterDescriptor"],
  decision: PreparedAutomationActionBatchV1["chapterDescriptor"]["decisions"][number],
  seatId: SeatIdV1,
  index: number,
): AppendPreparedAutomationActionCommandV1 {
  const seat = snapshot.seatAuthority.seatControls.find((candidate) => candidate.seatId === seatId)!;
  const actionType = decision.execution.allowedActionTypes[0]!;
  const idempotencyKey = `sql7-action:${snapshot.routeSnapshot.runId}:${seatId}`;
  const payload = { optionCode: actionType, customText: null };
  const actionBase = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId: `action_${digest(idempotencyKey)}`,
    runId: snapshot.routeSnapshot.runId,
    chapterRuntimeId: snapshot.chapter.chapterRuntimeId,
    chapterId: "N1" as const,
    decisionPointId: decision.decisionPointId,
    seatId,
    actionOrdinal: 1,
    actionRevision: 1,
    controlEpoch: seat.controlEpoch,
    expectedWorkingRevision: snapshot.workingProjection.state.revision,
    status: "SEALED" as const,
    actionType,
    payload,
    payloadHash: sha256Canonical(payload),
    idempotencyKey,
  };
  const requestFingerprint = computeDecisionActionRequestFingerprint(actionBase);
  const sealedBase = { ...actionBase, requestFingerprint };
  const action = { ...sealedBase, sealedHash: sha256Canonical(sealedBase) };
  const intent = {
    visibility: "PRIVATE" as const,
    targetSeatIds: [],
    evidenceRefs: [],
    resourceReservations: [],
    commitmentMutations: [],
    knowledgeGrants: [],
    seatArcProgress: [],
  };
  const commandBase = {
    routeSnapshot: snapshot.routeSnapshot,
    subjectId: seat.activeControllerId,
    action,
    intent,
    nowMs: NOW,
  };
  return {
    command: {
      ...commandBase,
      inputFingerprint: computeFormalInteractionInputFingerprint(commandBase),
    },
    authority: {
      actorKind: index === 0 ? "HUMAN" : "AI",
      snapshotHash: digest("convergence-snapshot"),
      expectedOrchestratorRevision: snapshot.chapter.revision,
      expectedOrchestratorHash: snapshot.chapter.orchestratorHash,
      expectedDescriptorHash: descriptor.descriptorHash,
      expectedDecisionPolicyHash: snapshot.chapter.activeDecision!.policyHash,
      expectedWorkingRevision: snapshot.workingProjection.state.revision,
      expectedWorkingStateHash: snapshot.workingProjection.stateHash,
      expectedLedgerHeadHash: snapshot.workingProjection.headHash,
      expectedSeatAuthorityStateHash: snapshot.seatAuthority.stateHash,
      expectedControllerId: seat.activeControllerId,
      expectedControlEpoch: seat.controlEpoch,
      expectedSubmissionFenceToken: seat.submissionFenceToken,
      expectedAiPolicyHash: index === 0 ? null : digest("ai-policy"),
    },
  };
}

function makeRoute(): RunRouteSnapshotV1 {
  const humanSeats: SeatIdV1[] = [PRESSURE_CHAPTER_SEAT_IDS_V1[0]!];
  const participantMode: ParticipantModeV1 = "SOLO";
  const topologyBody = {
    schemaVersion: "pressure_initial_role_control_topology_v1" as const,
    controlTopologyVersion: "pressure-control-v1",
    participantMode,
    seatControls: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      mode: humanSeats.includes(seatId) ? "HUMAN_ACTIVE" as const : "AI_ACTIVE" as const,
    })),
  };
  return withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId: "run-sql7-settlement-planner",
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: loaded.manifest.packageVersion,
    contentPackageSha256: loaded.manifest.contentSha256,
    orchestrationPackageVersion: "pressure-orchestration-v1",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "pressure-runtime-v1",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "pressure-tests-v1",
    testMatrixSha256: digest("tests"),
    runSeed: "seed-sql7",
    narrativeProfileVersion: "pressure-narrative-v1",
    featureSetVersion: "pressure-features-v1",
    resultContractRegistryVersion: "pressure-results-v1",
    participantMode,
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: humanSeats,
    controlTopologyVersion: topologyBody.controlTopologyVersion,
    initialRoleControlSnapshotHash: sha256Canonical(topologyBody),
  });
}

function makeSeatSnapshot(route: RunRouteSnapshotV1): SeatControlSnapshotV1 {
  const policyBody = {
    schemaVersion: "pressure_frozen_seat_control_policy_v1" as const,
    policyVersion: "pressure-seat-policy-v1",
    disconnectPolicy: "PRESENCE_ADVISORY_ONLY" as const,
    takeoverDeadlinePolicyRef: "deadline-v1",
    takeoverDeadlinePolicyHash: digest("deadline"),
    deterministicDefaultPolicyRef: "default-v1",
    deterministicDefaultPolicyHash: digest("default"),
    humanReclaimAllowed: true,
  };
  const seatControls = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => ({
    seatId,
    mode: index === 0 ? "HUMAN_ACTIVE" as const : "AI_ACTIVE" as const,
    originalHumanControllerId: index === 0 ? `human:${seatId}` : null,
    designatedAiControllerId: `pressure-ai:${seatId}`,
    activeControllerId: index === 0 ? `human:${seatId}` : `pressure-ai:${seatId}`,
    controlEpoch: 1,
    submissionFenceToken: digest(`submit:${seatId}`),
    reclaimFenceToken: index === 0 ? digest(`reclaim:${seatId}`) : null,
    lastAuthorityEventHash: digest(`authority:${seatId}`),
  }));
  const body = {
    schemaVersion: "pressure_seat_control_snapshot_v1" as const,
    runId: route.runId,
    participantMode: route.participantMode,
    routeHash: route.routeHash,
    genesisHash: digest("genesis"),
    genesisAtomicRecordHash: digest("genesis-atomic"),
    initialTopologyHash: route.initialRoleControlSnapshotHash,
    controlTopologyVersion: route.controlTopologyVersion,
    frozenPolicy: { ...policyBody, policyHash: sha256Canonical(policyBody) },
    stateRevision: 1,
    timelineLength: seatControls.length,
    timelineHeadHash: digest("timeline"),
    seatControls,
    initializationInputHash: digest("seat-initialization"),
  };
  return { ...body, stateHash: sha256Canonical(body) };
}
