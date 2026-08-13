import assert from "node:assert/strict";
import {
  compileB0ChapterSettlementInputV1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import type {
  BeatAppliedPayloadV1,
  WorkingLedgerEventV1,
  WorkingLedgerOpenedPayloadV1,
  WorkingLedgerProjectionV1,
} from "../working-ledger/contracts";
import { computePreparedAutomationActionBatchHashV1 } from "../decision-automation/prepared-action-batch";
import type { PreparedAutomationActionBatchV1 } from "../decision-automation/contracts";
import type { BuildPressureSql7CommitPlanInputV1 } from "./plan-builder";
import {
  PressureSql7SettlementN2PlanBuilderV1,
  buildPressureSql7CommitPlanV1,
} from "./plan-builder";
import { PressureSql7CommitErrorV1 } from "./commit-contract";

const RUN_ID = "run-1";
const N1_RUNTIME_ID = "runtime-n1";
const N2_RUNTIME_ID = "runtime-n2";
const ROUTE_HASH = hash("route");
const WORLD_N1_HASH = hash("world-n1");
const WORLD_N2_HASH = hash("world-n2");
const BUNDLE_HASH = hash("bundle");
const COMMIT_HASH = hash("commit");
const NOW = new Date("2026-08-13T12:00:00.000Z");

async function main(): Promise<void> {
  const input = fixture();
  const plan = buildPressureSql7CommitPlanV1(input);

  assert.deepEqual(
    plan.decisionActions.map((row) => row.id),
    input.batch.actions.map((item) => item.command.action.actionId),
  );
  assert.deepEqual(
    plan.decisionActions.map((row) => row.authorityEventHash),
    input.domain.actionLedger.events.map((event) => event.eventHash),
  );
  assert.ok(plan.storyEvents.some((row) =>
    row.payloadJson === row.payloadJson
    && (row.payloadJson as { eventHash?: string }).eventHash
      === input.domain.beat.event.eventHash));
  assert.ok(plan.storyEvents.some((row) => row.id === input.domain.settlementRecord.rootEvent.eventId));
  assert.ok(plan.storyEvents.some((row) =>
    (row.payloadJson as { chapterRuntimeId?: string }).chapterRuntimeId === N2_RUNTIME_ID));
  assert.equal(plan.settlement.id, input.domain.settlementRecord.receipt.settlementId);
  assert.equal(plan.settlement.commitHash, COMMIT_HASH);
  assert.equal(plan.worldTransition.nextRuntime.id, N2_RUNTIME_ID);
  assert.equal(plan.worldTransition.nextRuntime.chapterId, "N2");
  assert.equal(plan.worldTransition.nextRuntime.baseWorldStateHash, WORLD_N2_HASH);
  assert.equal(plan.receipt.nextChapterRuntimeId, N2_RUNTIME_ID);
  assert.equal(plan.receipt.commitHash, COMMIT_HASH);
  assert.deepEqual(plan.receipt.projectionAuthority, input.resolvedProjectionSources);
  assert.equal(
    plan.fence.submissionRequestFingerprint,
    input.batch.actions[0]!.command.action.requestFingerprint,
  );

  const adapter = new PressureSql7SettlementN2PlanBuilderV1({
    prepare: () => ({
      settlementSource: input.settlementSource,
      domain: input.domain,
      downstream: input.downstream,
      resolvedProjectionSources: input.resolvedProjectionSources,
    }),
  });
  const adapterPlan = await adapter.build({
    snapshot: input.snapshot,
    humanCommand: input.batch.actions[0]!.command,
    batch: input.batch,
    nowMs: input.committedAt.getTime(),
  });
  assert.equal(adapterPlan.receipt.nextChapterRuntimeId, N2_RUNTIME_ID);
  assert.deepEqual(
    adapterPlan.receipt.projectionAuthority,
    input.resolvedProjectionSources,
  );

  const broken = fixture();
  broken.resolvedProjectionSources.worldSource.worldStateHash = hash("wrong-world");
  assert.throws(
    () => buildPressureSql7CommitPlanV1(broken),
    (error: unknown) => error instanceof PressureSql7CommitErrorV1
      && error.code === "INVALID_PLAN",
  );
  const confusedB0Hash = fixture();
  confusedB0Hash.domain.settlementPolicyEvaluation = {
    ...confusedB0Hash.domain.settlementPolicyEvaluation,
    b0InputHash: confusedB0Hash.domain.settlementInput.inputHash,
  };
  assert.notEqual(
    confusedB0Hash.domain.settlementInput.inputHash,
    input.domain.settlementPolicyEvaluation.b0InputHash,
  );
  assert.throws(
    () => buildPressureSql7CommitPlanV1(confusedB0Hash),
    (error: unknown) => error instanceof PressureSql7CommitErrorV1
      && error.code === "INVALID_PLAN",
  );
  console.log("pressure SQL7 plan builder: PASS");
}

function fixture(): BuildPressureSql7CommitPlanInputV1 {
  const routeSnapshot = {
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId: RUN_ID,
    routeHash: ROUTE_HASH,
    participantMode: "SOLO",
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [PRESSURE_CHAPTER_SEAT_IDS_V1[0]],
    engineVersion: "pressure-v1",
    strategyVersion: "strategy-v1",
    runtimeProfile: "runtime-profile-v1",
    endgamePolicyVersion: "endgame-v1",
    resultSchemaVersion: "result-v1",
    contentPackageVersion: "content-v1",
    contentPackageSha256: hash("content"),
    orchestrationPackageVersion: "orchestration-v1",
    orchestrationPackageSha256: hash("orchestration"),
    runtimeContractVersion: "runtime-v1",
    runtimeContractSha256: hash("runtime"),
    testMatrixVersion: "matrix-v1",
    testMatrixSha256: hash("matrix"),
    runSeed: "seed-1",
    narrativeProfileVersion: "narrative-v1",
    featureSetVersion: "features-v1",
    resultContractRegistryVersion: "results-v1",
    controlTopologyVersion: "controls-v1",
    initialRoleControlSnapshotHash: hash("controls"),
  } as unknown as BuildPressureSql7CommitPlanInputV1["snapshot"]["routeSnapshot"];
  const n1State = workingState("N1", 0);
  const n1Projection = projection(N1_RUNTIME_ID, "N1", n1State, hash("n1-head"));
  const currentChapter = orchestrator("N1", N1_RUNTIME_ID, 1, "ACTIVE", null);
  const nextRecorded = orchestrator("N1", N1_RUNTIME_ID, 2, "RESOLVING_BEAT", null);
  const postBeatState = workingState("N1", 1);
  const postBeatOrchestrator = orchestrator("N1", N1_RUNTIME_ID, 3, "SETTLING", null);
  const frozenOrchestrator = orchestrator("N1", N1_RUNTIME_ID, 4, "FROZEN", BUNDLE_HASH);
  const actions = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => {
    const actionId = `action-${index + 1}`;
    const requestFingerprint = hash(`request-${index}`);
    const action = {
      schemaVersion: "sangtian_decision_action_v1",
      actionId,
      runId: RUN_ID,
      chapterRuntimeId: N1_RUNTIME_ID,
      chapterId: "N1",
      decisionPointId: "N1-D1",
      seatId,
      actionOrdinal: 1,
      actionType: "WAIT",
      status: "SEALED",
      controlEpoch: 1,
      expectedWorkingRevision: 0,
      actionRevision: 1,
      idempotencyKey: index === 0 ? "submit-key" : `ai-key-${index}`,
      requestFingerprint,
      payload: { source: index === 0 ? "HUMAN" : "CONTENT_OWNED_AI_POLICY" },
      payloadHash: hash(`payload-${index}`),
      sealedHash: hash(`sealed-${index}`),
    } as PreparedAutomationActionBatchV1["actions"][number]["command"]["action"];
    return {
      command: {
        routeSnapshot,
        subjectId: index === 0 ? "user-1" : `ai-${index}`,
        action,
        intent: {
          visibility: "PUBLIC",
          targetSeatIds: [],
          evidenceRefs: [],
          resourceReservations: [],
          commitmentMutations: [],
          knowledgeGrants: [],
          seatArcProgress: [],
        },
        inputFingerprint: hash(`input-${index}`),
        nowMs: NOW.getTime(),
      },
      authority: {
        actorKind: index === 0 ? "HUMAN" : "AI",
        snapshotHash: hash("convergence-snapshot"),
        expectedOrchestratorRevision: 1,
        expectedOrchestratorHash: currentChapter.orchestratorHash,
        expectedDescriptorHash: hash("descriptor-n1"),
        expectedDecisionPolicyHash: hash("decision-policy"),
        expectedWorkingRevision: 0,
        expectedWorkingStateHash: n1Projection.stateHash,
        expectedLedgerHeadHash: n1Projection.headHash,
        expectedSeatAuthorityStateHash: hash("seat-state"),
        expectedControllerId: index === 0 ? "user-1" : `ai-${index}`,
        expectedControlEpoch: 1,
        expectedSubmissionFenceToken: index === 0 ? "fence-human" : `fence-ai-${index}`,
        expectedAiPolicyHash: index === 0 ? null : hash("ai-policy"),
      },
    } as PreparedAutomationActionBatchV1["actions"][number];
  });
  const actionEvents = actions.map((item, index) => ledgerEvent(
    item.command.action.chapterRuntimeId,
    "N1",
    index + 1,
    index === 0 ? n1Projection.headHash : hash(`action-event-${index - 1}`),
    hash(`action-event-${index}`),
    {
      eventType: "FORMAL_ACTION_ACCEPTED",
      routeHash: ROUTE_HASH,
      inputFingerprint: item.command.inputFingerprint,
      action: item.command.action,
      intent: item.command.intent,
      audienceSeatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    },
  ));
  const beatPayload = {
    eventType: "BEAT_APPLIED",
    routeHash: ROUTE_HASH,
    commandFingerprint: hash("beat-command"),
    actionInputFingerprint: hash("beat-input"),
    beatResolution: {
      schemaVersion: "sangtian_beat_resolution_v1",
      runId: RUN_ID,
      chapterRuntimeId: N1_RUNTIME_ID,
      decisionPointId: "N1-D1",
      baseWorkingRevision: 0,
      committedWorkingRevision: 1,
      inputWorkingStateHash: n1Projection.stateHash,
      sealedActionIds: actions.map((item) => item.command.action.actionId),
      sealedActionsHash: hash("sealed-actions"),
      resolverVersion: "resolver-v1",
      workingDelta: {},
      reservationMutations: [],
      reactionContextRef: null,
      nextDecisionContextRef: null,
      resolutionHash: hash("resolution"),
    },
    authoredBeatResult: {},
    stateAfter: postBeatState,
    stateAfterHash: hash("post-beat-state"),
    nextDecisionPin: null,
  } as unknown as BeatAppliedPayloadV1;
  const beatEvent = ledgerEvent(
    N1_RUNTIME_ID,
    "N1",
    7,
    actionEvents.at(-1)!.eventHash,
    hash("beat-event"),
    beatPayload,
  );
  const postBeatProjection = projection(
    N1_RUNTIME_ID,
    "N1",
    postBeatState,
    beatEvent.eventHash,
    beatPayload.stateAfterHash,
  );
  const settlementInputBody = {
    schemaVersion: "sangtian_chapter_settlement_input_v1",
    runId: RUN_ID,
    chapterRuntimeId: N1_RUNTIME_ID,
    chapterId: "N1",
    baseWorldSequence: 0,
    baseWorldStateHash: WORLD_N1_HASH,
    runRouteHash: ROUTE_HASH,
    previousFrozenHash: hash("genesis"),
    decisionLedgerHash: beatEvent.eventHash,
    finalWorkingStateHash: postBeatProjection.stateHash,
    sealedDecisionActionIds: actions.map((item) => item.command.action.actionId),
    reservationLedgerHash: hash("reservations"),
    contentPolicyVersion: "policy-v1",
    contentPolicyHash: hash("policy"),
    settlementContractVersion: "settlement-v1",
    settlementContractHash: hash("settlement-contract"),
  };
  const settlementInput = {
    ...settlementInputBody,
    inputHash: sha256Canonical(settlementInputBody),
  };
  const seatParticipation = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
    seatId,
    requirement: "REQUIRED" as const,
    completion: "SEALED_ACTIONS" as const,
    defaultCodes: [],
  }));
  const settlementMaterial = {
    seats: seatParticipation,
    resources: [],
    actions: actions.map(({ command }) => ({
      actionId: command.action.actionId,
      decisionPointId: command.action.decisionPointId,
      seatId: command.action.seatId,
      source: "HUMAN" as const,
      actionType: command.action.actionType,
      payload: command.action.payload,
      resourceCommitments: [],
      evidenceRefs: [],
    })),
  };
  const source = {
    schemaVersion: "pressure_chapter_settlement_source_v1",
    closeFence: {},
    sealedInput: settlementInput,
    settlementMaterial,
    baseWorldState: { runId: RUN_ID, worldSequence: 0, stateHash: WORLD_N1_HASH },
    sourceHash: hash("source"),
  } as unknown as BuildPressureSql7CommitPlanInputV1["settlementSource"];
  const outbox = {
    schemaVersion: "pressure_chapter_handoff_outbox_v1",
    taskType: "OPEN_CHAPTER",
    status: "PENDING",
    dedupeKey: "open-n2",
    runId: RUN_ID,
    chapterRuntimeId: N1_RUNTIME_ID,
    sourceRootEventId: "root-event-1",
    sourceRootEventHash: hash("root-event"),
    sourceBundleHash: BUNDLE_HASH,
    target: { kind: "NEXT_CHAPTER", chapterId: "N2" },
    outboxHash: hash("outbox"),
  } as const;
  const record = {
    schemaVersion: "pressure_atomic_chapter_commit_v1",
    runId: RUN_ID,
    chapterRuntimeId: N1_RUNTIME_ID,
    chapterId: "N1",
    idempotencyKey: "settle-key",
    requestFingerprint: hash("settle-request"),
    sourceHash: source.sourceHash,
    commitFence: {},
    sealedInput: settlementInput,
    worldDelta: {},
    settlement: { schemaVersion: "sangtian_chapter_settlement_evaluation_v1", evaluationHash: hash("evaluation") },
    frozenChapterBundle: {
      bundleHash: BUNDLE_HASH,
      committedWorldStateHash: WORLD_N2_HASH,
      frozenWorldState: { runId: RUN_ID, worldSequence: 1, stateHash: WORLD_N2_HASH },
    },
    rootEvent: {
      eventId: "root-event-1",
      eventType: "CHAPTER_FROZEN",
      chapterSequence: 1,
      baseWorldSequence: 0,
      committedWorldSequence: 1,
    },
    outbox,
    receipt: {
      settlementId: "settlement-1",
      baseWorldSequence: 0,
      committedWorldSequence: 1,
      baseWorldStateHash: WORLD_N1_HASH,
      committedWorldStateHash: WORLD_N2_HASH,
      commitManifestHash: hash("manifest"),
      commitHash: COMMIT_HASH,
    },
    atomicRecordHash: hash("atomic"),
  } as unknown as BuildPressureSql7CommitPlanInputV1["domain"]["settlementRecord"];
  const n2State = workingState("N2", 0);
  const n2OpeningPayload = {
    eventType: "WORKING_LEDGER_OPENED",
    routeHash: ROUTE_HASH,
    chapterDefinitionHash: hash("n2-definition"),
    initialState: n2State,
    initialStateHash: hash("n2-state"),
    nextDecisionPin: decisionPin(),
  } as unknown as WorkingLedgerOpenedPayloadV1;
  const n2OpeningEvent = ledgerEvent(
    N2_RUNTIME_ID,
    "N2",
    0,
    null,
    hash("n2-opening-event"),
    n2OpeningPayload,
  );
  const n2Projection = projection(
    N2_RUNTIME_ID,
    "N2",
    n2State,
    n2OpeningEvent.eventHash,
    n2OpeningPayload.initialStateHash,
  );
  n2Projection.nextDecisionPin = decisionPin();
  const n2Orchestrator = orchestrator("N2", N2_RUNTIME_ID, 5, "ACTIVE", null);
  n2Orchestrator.authorityBase = {
    baseWorldSequence: 1,
    baseWorldStateHash: WORLD_N2_HASH,
    previousFrozenHash: BUNDLE_HASH,
  };
  n2Orchestrator.activeDecision = {
    decisionPointId: "N2-D1",
    policyHash: hash("n2-decision-policy"),
    openedAtMs: NOW.getTime(),
    deadlineAtMs: null,
    seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      requirement: "REQUIRED",
      completion: "PENDING",
      actionIds: [],
      actionCount: 0,
      defaultCode: null,
    })),
  };
  const nextChapter = {
    chapterId: "N2",
    descriptorHash: n2Orchestrator.descriptorHash,
  } as BuildPressureSql7CommitPlanInputV1["domain"]["nextChapter"];
  const batchBody = {
    schemaVersion: "pressure_prepared_automation_action_batch_v1" as const,
    batchId: "batch-1",
    snapshotHash: hash("convergence-snapshot"),
    runId: RUN_ID,
    routeHash: ROUTE_HASH,
    chapterRuntimeId: N1_RUNTIME_ID,
    chapterId: "N1" as const,
    decisionPointId: "N1-D1",
    expectedOrchestratorRevision: currentChapter.revision,
    expectedOrchestratorHash: currentChapter.orchestratorHash,
    expectedWorkingRevision: 0,
    expectedWorkingStateHash: n1Projection.stateHash,
    expectedLedgerHeadHash: n1Projection.headHash,
    expectedSeatAuthorityStateHash: hash("seat-state"),
    frozenSeatOrder: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    actions,
    chapterDescriptor: { chapterId: "N1", descriptorHash: hash("descriptor-n1") },
    nextOrchestratorState: nextRecorded,
    beatPlan: {
      event: beatEvent,
      resolution: beatPayload.beatResolution,
      postBeatOrchestratorState: postBeatOrchestrator,
      settlementInput,
      narrativeJobs: [],
      aEmotionEmissions: [],
      downstreamManifest: { authorityKind: "BEAT" },
    },
  } as unknown as Omit<PreparedAutomationActionBatchV1, "batchHash">;
  const batch: PreparedAutomationActionBatchV1 = {
    ...batchBody,
    batchHash: computePreparedAutomationActionBatchHashV1(batchBody),
  };
  const currentOrchestratorId = orchestratorEventId(currentChapter);
  const snapshot = {
    schemaVersion: "pressure_decision_to_next_projection_snapshot_v1",
    request: {
      roomId: RUN_ID,
      runId: RUN_ID,
      subjectId: "user-1",
      seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
      chapterRuntimeId: N1_RUNTIME_ID,
      decisionPointId: "N1-D1",
      expectedRouteHash: ROUTE_HASH,
      expectedWorkingRevision: 0,
      expectedControlEpoch: 1,
      expectedSubmissionFenceToken: "fence-human",
      idempotencyKey: "submit-key",
    },
    storedRoute: {},
    routeSnapshot,
    world: {
      runId: RUN_ID,
      version: 1,
      currentNodeId: "N1",
      worldSequence: 0,
      reservedWorldSequence: 0,
      state: source.baseWorldState,
    },
    chapter: currentChapter,
    runtime: {
      id: N1_RUNTIME_ID,
      runId: RUN_ID,
      chapterId: "N1",
      chapterSequence: 1,
      state: "DECISION_POINT_OPEN",
      baseWorldSequence: 0,
      baseWorldStateHash: WORLD_N1_HASH,
      previousFrozenHash: hash("genesis"),
      routeHash: ROUTE_HASH,
      contentPackageVersion: routeSnapshot.contentPackageVersion,
      contentHash: routeSnapshot.contentPackageSha256,
      orchestrationPackageVersion: routeSnapshot.orchestrationPackageVersion,
      orchestrationHash: routeSnapshot.orchestrationPackageSha256,
      runtimeContractVersion: routeSnapshot.runtimeContractVersion,
      runtimeContractHash: routeSnapshot.runtimeContractSha256,
      workingRevision: 0,
      workingStateHash: n1Projection.stateHash,
      workingState: n1State,
      decisionState: {},
      ledgerProjectionCache: { cache: "n1" },
      closeInputHash: null,
      lockVersion: 1,
    },
    workingProjection: n1Projection,
    seatAuthority: {
      stateRevision: 1,
      stateHash: hash("seat-state"),
    },
    submitSeat: {
      activeControllerId: "user-1",
    },
    viewer: {
      playerId: "player-1",
      runId: RUN_ID,
      subjectId: "user-1",
      playerType: "human",
      status: "active",
      roleId: "role-1",
      roleKey: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
      roleName: "户部",
    },
    viewerPrivateProjection: {},
    viewerPresence: null,
    persistenceFence: {
      orchestratorEventId: currentOrchestratorId,
      orchestratorDedupeKey: `pressure-orchestrator:${RUN_ID}:${currentChapter.revision}`,
      orchestratorPayload: currentChapter,
      seatStateRevision: 1,
      seatVersion: 1,
      seatStateHash: hash("seat-state"),
      seatSnapshotJson: { envelope: "seat" },
    },
    existingDecisionActionRows: [],
    projectionSeed: {
      narrativeProjectionRows: [],
      aEmotionAggregateRows: [],
      viewerDeliveryRows: [],
      aEmotionDeliveryMarkRows: [],
    },
    capturedAtMs: NOW.getTime(),
    snapshotHash: hash("snapshot"),
  } as unknown as BuildPressureSql7CommitPlanInputV1["snapshot"];
  const narrativeRow = {
    id: "narrative-1",
    runId: RUN_ID,
    projectionKind: "CHAPTER_NARRATIVE",
    sourceAuthority: "CHAPTER_FROZEN",
    sourceId: BUNDLE_HASH,
    sourceCommitHash: COMMIT_HASH,
    sourceContentHash: WORLD_N2_HASH,
    narrativeProfileVersion: "narrative-v1",
    projectorVersion: "projector-v1",
    audienceKind: "PUBLIC",
    audienceSeatId: null,
    audienceKey: "public",
    status: "PENDING",
    requestFingerprint: hash("narrative-request"),
    attempt: 0,
    maxAttempts: 3,
    checkpoint: "PERSISTED",
    artifactJson: null,
    artifactContentHash: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    leaseVersion: 0,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    publishedAt: null,
  } as const;
  const outboxRow = {
    id: "outbox-1",
    runId: RUN_ID,
    taskType: "OPEN_CHAPTER",
    status: "COMPLETED",
    checkpoint: "ACKNOWLEDGED",
    dedupeKey: outbox.dedupeKey,
    sourceAuthority: "CHAPTER_FROZEN",
    sourceId: BUNDLE_HASH,
    sourceCommitHash: COMMIT_HASH,
    payloadJson: outbox,
    payloadHash: outbox.outboxHash,
    attempt: 0,
    maxAttempts: 5,
    availableAt: NOW,
    leaseOwner: null,
    leaseExpiresAt: null,
    leaseVersion: 0,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: NOW,
  } as const;
  const resolvedProjectionSources = {
    roomId: RUN_ID,
    runId: RUN_ID,
    subjectId: "user-1",
    viewerSeatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
    routeSnapshot,
    chapter: n2Orchestrator,
    workingProjection: n2Projection,
    chapterDescriptor: nextChapter,
    viewerSource: {
      roomId: RUN_ID,
      runId: RUN_ID,
      routeHash: ROUTE_HASH,
      subjectId: "user-1",
      viewer: {
        seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
        roleName: "户部",
        control: {
          mode: "HUMAN_ACTIVE",
          controlEpoch: 1,
          canSubmit: true,
          canReclaim: false,
          submissionFenceToken: "n2-fence",
          reclaimFenceToken: null,
        },
      },
      situation: { goal: "goal", risk: "risk", judgment: "judgment" },
      resources: [],
      tokens: [],
    },
    worldSource: {
      runId: RUN_ID,
      routeHash: ROUTE_HASH,
      worldSequence: 1,
      worldStateHash: WORLD_N2_HASH,
      metrics: [],
    },
    narrativeSource: {
      runId: RUN_ID,
      routeHash: ROUTE_HASH,
      viewerSeatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
      chapterRuntimeId: N2_RUNTIME_ID,
      status: "PENDING",
      projectionKind: "CHAPTER_NARRATIVE",
      sourceAuthority: "CHAPTER_FROZEN",
      sourceId: BUNDLE_HASH,
      sourceCommitHash: COMMIT_HASH,
      text: null,
      contentHash: null,
      renderMode: null,
    },
    feedPage: {
      schemaVersion: "a_emotion_feed_page_v1",
      roomId: RUN_ID,
      runId: RUN_ID,
      viewerSeatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
      items: [],
      unreadCount: 0,
      nextCursor: null,
      serverSequence: 1,
    },
  } as BuildPressureSql7CommitPlanInputV1["resolvedProjectionSources"];
  return {
    snapshot,
    batch,
    settlementSource: source,
    domain: {
      actionLedger: {
        payloads: actionEvents.map((event) => event.payload as never),
        events: actionEvents,
        projection: n1Projection,
      },
      beat: {
        status: "PLANNED",
        commandFingerprint: beatPayload.commandFingerprint,
        actionInputFingerprint: beatPayload.actionInputFingerprint,
        resolution: beatPayload.beatResolution,
        payload: beatPayload,
        event: beatEvent,
      },
      beatInput: { resolverVersion: "resolver-v1" },
      postBeatProjection,
      settlementInput: settlementInput as never,
      seatParticipation: seatParticipation as never,
      settlementMaterial: settlementMaterial as never,
      settlementCommand: {
        authorityTrigger: "CHAPTER_CLOSE",
        runId: RUN_ID,
        chapterRuntimeId: N1_RUNTIME_ID,
        idempotencyKey: record.idempotencyKey,
        requestFingerprint: record.requestFingerprint,
      },
      settlementPolicyEvaluation: {
        b0InputHash: compileB0ChapterSettlementInputV1({
          wireInput: source.sealedInput,
          settlementMaterial: source.settlementMaterial,
        }).b0InputHash,
      } as never,
      settlementRecord: record,
      frozenOrchestratorState: frozenOrchestrator,
      nextChapter,
      nextWorkingSeed: n2State as never,
      nextOpeningNowMs: NOW.getTime(),
      nextOpening: {
        chapterRuntimeId: N2_RUNTIME_ID,
        state: n2Orchestrator,
        event: n2OpeningEvent,
        projection: n2Projection,
      },
    },
    downstream: {
      narrativeProjections: [narrativeRow],
      aEmotionStoryEvents: [],
      outboxTasks: [outboxRow],
      settlementDownstreamManifest: { dedupeKeys: [outbox.dedupeKey] },
    },
    committedAt: NOW,
    resolvedProjectionSources,
  };
}

function workingState(chapterId: "N1" | "N2", revision: number) {
  return { runId: RUN_ID, chapterId, revision } as never;
}

function decisionPin() {
  return {
    schemaVersion: "pressure_decision_pin_v1" as const,
    chapterId: "N2" as const,
    stateRevision: 0,
    stateFingerprint: hash("n2-state-fingerprint"),
    decisionPointId: "N2-D1",
    kernelId: "kernel-n2",
    optionIds: ["WAIT"],
  };
}

function projection(
  runtimeId: string,
  chapterId: "N1" | "N2",
  state: never,
  headHash: string,
  stateHash = hash(`${chapterId}-state`),
): WorkingLedgerProjectionV1 {
  return {
    key: { runId: RUN_ID, chapterRuntimeId: runtimeId },
    chapterId,
    routeHash: ROUTE_HASH,
    chapterDefinitionHash: hash(`${chapterId}-definition`),
    headHash,
    headSequence: 0,
    state,
    stateHash,
    nextDecisionPin: null,
    acceptedActions: new Map(),
    actionsByIdempotencyKey: new Map(),
    appliedBeats: new Map(),
    pendingReservations: new Map(),
    commitments: new Map(),
    evidenceRefsByAction: new Map(),
    knowledgeBySeat: new Map(),
    seatArcProgressBySeat: new Map(),
  };
}

function ledgerEvent(
  runtimeId: string,
  chapterId: "N1" | "N2",
  sequence: number,
  previousEventHash: string | null,
  eventHash: string,
  payload: WorkingLedgerEventV1["payload"],
): WorkingLedgerEventV1 {
  return {
    schemaVersion: "pressure_working_ledger_event_v1",
    runId: RUN_ID,
    chapterRuntimeId: runtimeId,
    chapterId,
    sequence,
    previousEventHash,
    payload,
    eventHash,
  };
}

function orchestrator(
  chapterId: "N1" | "N2",
  runtimeId: string,
  revision: number,
  phase: "ACTIVE" | "RESOLVING_BEAT" | "SETTLING" | "FROZEN",
  frozenBundleHash: string | null,
) {
  return {
    schemaVersion: "pressure_chapter_orchestrator_state_v1" as const,
    runId: RUN_ID,
    routeHash: ROUTE_HASH,
    revision,
    phase,
    currentChapterId: chapterId,
    chapterRuntimeId: runtimeId,
    descriptorHash: hash(`descriptor-${chapterId}`),
    authorityBase: {
      baseWorldSequence: chapterId === "N1" ? 0 : 1,
      baseWorldStateHash: chapterId === "N1" ? WORLD_N1_HASH : WORLD_N2_HASH,
      previousFrozenHash: chapterId === "N1" ? hash("genesis") : BUNDLE_HASH,
    },
    activeDecision: phase === "ACTIVE" ? {
      decisionPointId: `${chapterId}-D1`,
      policyHash: hash(`decision-${chapterId}`),
      openedAtMs: NOW.getTime(),
      deadlineAtMs: null,
      seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
        seatId,
        requirement: "REQUIRED" as const,
        completion: "PENDING" as const,
        actionIds: [],
        actionCount: 0,
        defaultCode: null,
      })),
    } : null,
    chapterSeatSummaries: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      requirement: "REQUIRED" as const,
      sealedActionIds: [],
      defaultActionIds: [],
      defaultCodes: [],
    })),
    settlementInputHash: phase === "SETTLING" || phase === "FROZEN"
      ? hash("settlement-input")
      : null,
    frozenBundleHash,
    orchestratorHash: hash(`orchestrator-${chapterId}-${revision}`),
  };
}

function orchestratorEventId(state: ReturnType<typeof orchestrator>): string {
  return `pc_orch_${sha256Canonical({
    runId: state.runId,
    revision: state.revision,
    stateHash: state.orchestratorHash,
  }).slice(0, 32)}`;
}

function hash(value: string): string {
  return sha256Canonical({ value });
}

void main();
