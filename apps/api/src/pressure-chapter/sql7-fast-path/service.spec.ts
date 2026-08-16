import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  type PressureChapterSubmitDecisionCommandV1,
} from "@ai-story/shared";
import type { PreparedAutomationActionBatchV1 } from "../decision-automation/contracts";
import type { PressureChapterGameProjectionV1 } from "../game-projection";
import type { SubmitOrchestratedActionCommandV1 } from "../orchestrator/contracts";
import type { PressureSql7CommitPlanV1 } from "./commit-contract";
import type { PressureSql7CommitResultV1 } from "./prisma-commit";
import {
  PressureSql7FirstSubmitServiceV1,
  type PressureSql7CommandCompilerPortV1,
  type PressureSql7CommitRepositoryPortV1,
  type PressureSql7PreparedBatchPlannerPortV1,
  type PressureSql7ReceiptProjectionPortV1,
  type PressureSql7SettlementN2PlanBuilderPortV1,
} from "./service";
import type {
  DecisionToNextProjectionPriorActionSnapshotV1,
  DecisionToNextProjectionSnapshotCaptureV1,
  DecisionToNextProjectionSnapshotReaderPortV1,
  DecisionToNextProjectionSnapshotV1,
} from "./snapshot-contract";

const HASH = sha256Canonical({ service: "sql7" });
const CONVERGENCE_HASH = sha256Canonical({ service: "sql7-convergence" });
const RUN_ID = "run-1";
const RUNTIME_ID = "runtime-n1";
const NEXT_RUNTIME_ID = "runtime-n2";
const SUBJECT_ID = "user-1";
const HUMAN_SEAT = PRESSURE_CHAPTER_SEAT_IDS_V1[0];

const COMMAND: PressureChapterSubmitDecisionCommandV1 = {
  schemaVersion: "pressure_chapter_game_command_v1",
  commandType: "SUBMIT_DECISION",
  runId: RUN_ID,
  routeHash: HASH,
  chapterRuntimeId: RUNTIME_ID,
  chapterId: "N1",
  seatId: HUMAN_SEAT,
  controlEpoch: 1,
  expectedWorkingRevision: 1,
  decisionPointId: "N1.weir_crisis",
  submissionFenceToken: HASH,
  idempotencyKey: "submit-1",
  optionCode: "SUPPORT",
  customText: null,
  sourceEventId: null,
};

test("applicable N1 path calls snapshot once, commit once and returns receipt projection", async () => {
  const harness = createHarness();
  const result = await harness.service.submit(input());

  assert.equal(result.status, "COMMITTED");
  if (result.status !== "COMMITTED") return;
  assert.deepEqual(result.response.projection, harness.projection);
  assert.equal(result.response.idempotencyKey, COMMAND.idempotencyKey);
  assert.equal(result.applicationSqlCount, 7);
  assert.deepEqual(harness.calls, {
    snapshot: 1,
    compiler: 1,
    batch: 1,
    plan: 1,
    commit: 1,
    projection: 1,
  });
});

test("missing snapshot is NOT_APPLICABLE and performs zero commit", async () => {
  const harness = createHarness({ snapshot: null });
  const result = await harness.service.submit(input());

  assert.deepEqual(result, { status: "NOT_APPLICABLE", reason: "SNAPSHOT_UNAVAILABLE" });
  assert.equal(harness.calls.snapshot, 1);
  assert.equal(harness.calls.commit, 0);
  assert.equal(harness.calls.compiler, 0);
});

test("snapshot capture exception fails closed before any write", async () => {
  const harness = createHarness({ snapshotThrows: true });

  await assert.rejects(harness.service.submit(input()), /snapshot-read-failure/u);
  assert.deepEqual(harness.calls, {
    snapshot: 1,
    compiler: 0,
    batch: 0,
    plan: 0,
    commit: 0,
    projection: 0,
  });
});

test("completed same-key action replays after one snapshot and performs no write", async () => {
  const harness = createHarness({ snapshot: priorActionSnapshotFixture(true) });
  const result = await harness.service.submit(input());

  assert.deepEqual(result, {
    status: "REPLAYED",
    idempotencyKey: COMMAND.idempotencyKey,
    applicationSqlCount: 1,
  });
  assert.deepEqual(harness.calls, {
    snapshot: 1,
    compiler: 0,
    batch: 0,
    plan: 0,
    commit: 0,
    projection: 0,
  });
});

test("partial same-key action delegates to the durable recovery path without a SQL7 write", async () => {
  const harness = createHarness({ snapshot: priorActionSnapshotFixture(false) });
  const result = await harness.service.submit(input());

  assert.deepEqual(result, {
    status: "NOT_APPLICABLE",
    reason: "PRIOR_ACTION_REQUIRES_RECOVERY",
  });
  assert.equal(harness.calls.commit, 0);
});

test("same idempotency key with different public input fails as an idempotency conflict", async () => {
  const prior = priorActionSnapshotFixture(true);
  prior.action = {
    ...prior.action,
    payload: { optionCode: "DIFFERENT", customText: null },
  } as typeof prior.action;
  const harness = createHarness({ snapshot: prior });

  await assert.rejects(harness.service.submit(input()), (error: unknown) => {
    assert.equal((error as { code?: unknown }).code, "PRESSURE_SQL7_IDEMPOTENCY_CONFLICT");
    return true;
  });
  assert.equal(harness.calls.commit, 0);
});

test("non-N1 command is NOT_APPLICABLE before snapshot and performs zero commit", async () => {
  const harness = createHarness();
  const result = await harness.service.submit(input({ command: { ...COMMAND, chapterId: "N2" } }));

  assert.deepEqual(result, { status: "NOT_APPLICABLE", reason: "INPUT_NOT_ELIGIBLE" });
  assert.equal(harness.calls.snapshot, 0);
  assert.equal(harness.calls.commit, 0);
});

test("after snapshot success an integrity failure throws instead of falling back", async () => {
  const harness = createHarness({ compilerThrows: true });

  await assert.rejects(harness.service.submit(input()), /compiler-integrity-failure/u);
  assert.equal(harness.calls.snapshot, 1);
  assert.equal(harness.calls.commit, 0);
});

test("commit receipt mismatch throws after one commit and performs no read", async () => {
  const harness = createHarness({ mismatchedReceipt: true });

  await assert.rejects(
    harness.service.submit(input()),
    /PRESSURE_SQL7_SERVICE_INTEGRITY:COMMITTED_RECEIPT_INCOMPLETE/u,
  );
  assert.equal(harness.calls.snapshot, 1);
  assert.equal(harness.calls.commit, 1);
  assert.equal(harness.calls.projection, 0);
});

test("unverified driver SQL evidence does not invalidate a committed authority receipt", async () => {
  const harness = createHarness({ unverifiedBudget: true });

  const result = await harness.service.submit(input());
  assert.equal(result.status, "COMMITTED");
  assert.equal(harness.calls.commit, 1);
  assert.equal(harness.calls.projection, 1);
});

test("later N1 Beat is NOT_APPLICABLE before snapshot and performs zero database work", async () => {
  const harness = createHarness();
  const result = await harness.service.submit(input({
    command: { ...COMMAND, decisionPointId: "N1.final_dispatch" },
  }));

  assert.deepEqual(result, { status: "NOT_APPLICABLE", reason: "INPUT_NOT_ELIGIBLE" });
  assert.equal(harness.calls.snapshot, 0);
  assert.equal(harness.calls.commit, 0);
});

function input(overrides: Partial<{
  command: PressureChapterSubmitDecisionCommandV1;
}> = {}) {
  return {
    principal: { subjectId: SUBJECT_ID, viewerId: SUBJECT_ID },
    roomId: RUN_ID,
    command: overrides.command ?? COMMAND,
    nowMs: 1_000,
  };
}

function createHarness(options: {
  snapshot?: DecisionToNextProjectionSnapshotCaptureV1 | null;
  snapshotThrows?: boolean;
  compilerThrows?: boolean;
  mismatchedReceipt?: boolean;
  unverifiedBudget?: boolean;
} = {}) {
  const calls = { snapshot: 0, compiler: 0, batch: 0, plan: 0, commit: 0, projection: 0 };
  const snapshot = options.snapshot === undefined ? snapshotFixture() : options.snapshot;
  const human = humanCommandFixture();
  const batch = batchFixture(human);
  const plan = planFixture(human);
  const projection = projectionFixture();

  const snapshots: DecisionToNextProjectionSnapshotReaderPortV1 = {
    capture: async () => {
      calls.snapshot += 1;
      if (options.snapshotThrows) throw new Error("snapshot-read-failure");
      return snapshot;
    },
  };
  const compiler: PressureSql7CommandCompilerPortV1 = {
    compile: () => {
      calls.compiler += 1;
      if (options.compilerThrows) throw new Error("compiler-integrity-failure");
      return human;
    },
  };
  const batches: PressureSql7PreparedBatchPlannerPortV1 = {
    plan: () => {
      calls.batch += 1;
      return batch;
    },
  };
  const settlementN2: PressureSql7SettlementN2PlanBuilderPortV1 = {
    build: () => {
      calls.plan += 1;
      return plan;
    },
  };
  const commits: PressureSql7CommitRepositoryPortV1 = {
    commit: async (): Promise<PressureSql7CommitResultV1> => {
      calls.commit += 1;
      return {
        status: "COMMITTED",
        authority: {
          ...plan.receipt,
          nextChapterRuntimeId: options.mismatchedReceipt ? "wrong-runtime" : NEXT_RUNTIME_ID,
        },
        queryBudget: {
          applicationSqlCount: 6,
          maxApplicationSql: 6,
          labels: [
            "AUTHORITY_CAS_AND_NEXT_RUNTIME",
            "DECISION_ACTIONS",
            "STORY_EVENTS",
            "CHAPTER_SETTLEMENT",
            "NARRATIVE_PROJECTIONS",
            "OUTBOX_TASKS",
          ],
          actualApplicationSqlCount: options.unverifiedBudget ? null : 6,
          verifiedByPrismaQueryEvents: !options.unverifiedBudget,
        },
      };
    },
  };
  const projections: PressureSql7ReceiptProjectionPortV1 = {
    project: () => {
      calls.projection += 1;
      return projection;
    },
  };
  return {
    calls,
    projection,
    service: new PressureSql7FirstSubmitServiceV1(
      snapshots,
      compiler,
      batches,
      settlementN2,
      commits,
      projections,
    ),
  };
}

function priorActionSnapshotFixture(
  settlementCompleted: boolean,
): DecisionToNextProjectionPriorActionSnapshotV1 {
  const human = humanCommandFixture().action;
  return {
    schemaVersion: "pressure_decision_to_next_projection_prior_action_snapshot_v1",
    request: structuredClone(snapshotFixture().request),
    action: {
      ...structuredClone(human),
      controlEpoch: COMMAND.controlEpoch,
      expectedWorkingRevision: COMMAND.expectedWorkingRevision,
      payload: {
        optionCode: COMMAND.optionCode,
        customText: COMMAND.customText,
      },
    } as DecisionToNextProjectionPriorActionSnapshotV1["action"],
    settlementCompleted,
    capturedAtMs: 1_000,
  };
}

function snapshotFixture(): DecisionToNextProjectionSnapshotV1 {
  return {
    schemaVersion: "pressure_decision_to_next_projection_snapshot_v1",
    request: {
      roomId: RUN_ID,
      runId: RUN_ID,
      subjectId: SUBJECT_ID,
      seatId: HUMAN_SEAT,
      chapterRuntimeId: RUNTIME_ID,
      decisionPointId: COMMAND.decisionPointId,
      expectedRouteHash: HASH,
      expectedWorkingRevision: 1,
      expectedControlEpoch: 1,
      expectedSubmissionFenceToken: HASH,
      idempotencyKey: COMMAND.idempotencyKey,
    },
    storedRoute: {} as DecisionToNextProjectionSnapshotV1["storedRoute"],
    routeSnapshot: {
      runId: RUN_ID,
      routeHash: HASH,
      seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    } as DecisionToNextProjectionSnapshotV1["routeSnapshot"],
    world: {
      runId: RUN_ID,
      version: 1,
      currentNodeId: "N1",
      worldSequence: 0,
      reservedWorldSequence: 0,
      state: { stateHash: HASH } as DecisionToNextProjectionSnapshotV1["world"]["state"],
    },
    chapter: {
      runId: RUN_ID,
      routeHash: HASH,
      currentChapterId: "N1",
      chapterRuntimeId: RUNTIME_ID,
    } as DecisionToNextProjectionSnapshotV1["chapter"],
    runtime: {
      id: RUNTIME_ID,
      runId: RUN_ID,
      chapterId: "N1",
      state: "DECISION_POINT_OPEN",
      workingRevision: 1,
      workingStateHash: HASH,
      orchestrationHash: HASH,
      lockVersion: 1,
    } as DecisionToNextProjectionSnapshotV1["runtime"],
    workingProjection: {
      state: { revision: 1 },
      stateHash: HASH,
      headHash: HASH,
      actionsByIdempotencyKey: new Map(),
    } as DecisionToNextProjectionSnapshotV1["workingProjection"],
    seatAuthority: { stateHash: HASH } as DecisionToNextProjectionSnapshotV1["seatAuthority"],
    submitSeat: {
      seatId: HUMAN_SEAT,
      activeControllerId: SUBJECT_ID,
      controlEpoch: 1,
      submissionFenceToken: HASH,
    } as DecisionToNextProjectionSnapshotV1["submitSeat"],
    viewer: {
      playerId: "player-1",
      runId: RUN_ID,
      subjectId: SUBJECT_ID,
      playerType: "human",
      status: "active",
      roleId: "role-1",
      roleKey: HUMAN_SEAT,
      roleName: "巡抚",
    },
    viewerPrivateProjection: {} as DecisionToNextProjectionSnapshotV1["viewerPrivateProjection"],
    viewerPresence: null,
    persistenceFence: {
      orchestratorEventId: "orch-1",
      orchestratorDedupeKey: "pressure-orchestrator:run-1:1",
      orchestratorPayload: {},
      seatStateRevision: 1,
      seatVersion: 1,
      seatStateHash: HASH,
      seatSnapshotJson: {},
    },
    existingDecisionActionRows: [],
    projectionSeed: {
      narrativeProjectionRows: [],
      aEmotionAggregateRows: [],
      viewerDeliveryRows: [],
      aEmotionDeliveryMarkRows: [],
    },
    capturedAtMs: 1_000,
    snapshotHash: HASH,
  };
}

function humanCommandFixture(): SubmitOrchestratedActionCommandV1 {
  return {
    routeSnapshot: { runId: RUN_ID, routeHash: HASH } as SubmitOrchestratedActionCommandV1["routeSnapshot"],
    subjectId: SUBJECT_ID,
    action: {
      actionId: "action-human",
      runId: RUN_ID,
      chapterRuntimeId: RUNTIME_ID,
      chapterId: "N1",
      decisionPointId: COMMAND.decisionPointId,
      seatId: HUMAN_SEAT,
      idempotencyKey: COMMAND.idempotencyKey,
      requestFingerprint: HASH,
    } as SubmitOrchestratedActionCommandV1["action"],
    intent: {} as SubmitOrchestratedActionCommandV1["intent"],
    inputFingerprint: HASH,
    nowMs: 1_000,
  };
}

function batchFixture(human: SubmitOrchestratedActionCommandV1): PreparedAutomationActionBatchV1 {
  return {
    snapshotHash: CONVERGENCE_HASH,
    runId: RUN_ID,
    routeHash: HASH,
    chapterRuntimeId: RUNTIME_ID,
    chapterId: "N1",
    decisionPointId: COMMAND.decisionPointId,
    actions: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => ({
      command: index === 0 ? human : {
        ...human,
        subjectId: `ai-${index}`,
        action: { ...human.action, actionId: `action-ai-${index}`, seatId },
      },
      authority: { snapshotHash: CONVERGENCE_HASH },
    })),
    beatPlan: {
      settlementInput: { inputHash: HASH },
      postBeatOrchestratorState: {
        phase: "SETTLING",
        currentChapterId: "N1",
        chapterRuntimeId: RUNTIME_ID,
        activeDecision: null,
        settlementInputHash: HASH,
      },
    },
    batchHash: HASH,
  } as PreparedAutomationActionBatchV1;
}

function planFixture(human: SubmitOrchestratedActionCommandV1): PressureSql7CommitPlanV1 {
  const now = new Date("2026-08-13T12:00:00.000Z");
  const projectionAuthority: PressureSql7CommitPlanV1["receipt"]["projectionAuthority"] = {
    roomId: RUN_ID,
    runId: RUN_ID,
    subjectId: SUBJECT_ID,
    viewerSeatId: HUMAN_SEAT,
    routeSnapshot: snapshotFixture().routeSnapshot,
    chapter: {
      ...snapshotFixture().chapter,
      chapterRuntimeId: NEXT_RUNTIME_ID,
      currentChapterId: "N2",
    },
    workingProjection: snapshotFixture().workingProjection,
    chapterDescriptor: {
      chapterId: "N2",
    } as PressureSql7CommitPlanV1["receipt"]["projectionAuthority"]["chapterDescriptor"],
    viewerSource: {
      roomId: RUN_ID,
      runId: RUN_ID,
      routeHash: HASH,
      subjectId: SUBJECT_ID,
      viewer: {
        seatId: HUMAN_SEAT,
        roleName: "viewer",
        control: {
          mode: "HUMAN_ACTIVE",
          controlEpoch: 1,
          canSubmit: true,
          canReclaim: false,
          submissionFenceToken: HASH,
          reclaimFenceToken: null,
        },
      },
      situation: { goal: "goal", risk: "risk", judgment: "judgment" },
      resources: [],
      tokens: [],
    },
    worldSource: {
      runId: RUN_ID,
      routeHash: HASH,
      worldSequence: 1,
      worldStateHash: HASH,
      metrics: [],
    },
    narrativeSource: {
      runId: RUN_ID,
      routeHash: HASH,
      viewerSeatId: HUMAN_SEAT,
      chapterRuntimeId: NEXT_RUNTIME_ID,
      status: "PENDING",
      projectionKind: "CHAPTER_NARRATIVE",
      sourceAuthority: "CHAPTER_FROZEN",
      sourceId: "settlement-1",
      sourceCommitHash: HASH,
      text: null,
      contentHash: null,
      renderMode: null,
    },
    feedPage: {
      schemaVersion: "a_emotion_feed_page_v1",
      roomId: RUN_ID,
      runId: RUN_ID,
      viewerSeatId: HUMAN_SEAT,
      items: [],
      unreadCount: 0,
      nextCursor: null,
      serverSequence: 1,
    },
  };
  const receipt = {
    schemaVersion: "pressure_committed_decision_to_next_projection_authority_v1" as const,
    runId: RUN_ID,
    previousChapterRuntimeId: RUNTIME_ID,
    nextChapterRuntimeId: NEXT_RUNTIME_ID,
    settlementId: "settlement-1",
    committedWorldSequence: 1,
    commitHash: HASH,
    projectionAuthority,
  };
  return {
    schemaVersion: "pressure_sql7_commit_plan_v1",
    fence: {
      runId: RUN_ID,
      routeHash: HASH,
      chapterRuntimeId: RUNTIME_ID,
      chapterId: "N1",
      chapterSequence: 1,
      expectedRuntimeState: "DECISION_POINT_OPEN",
      expectedRuntimeLockVersion: 1,
      expectedWorkingRevision: 1,
      expectedWorkingStateHash: HASH,
      expectedWorkingStateJson: { stateHash: HASH },
      expectedLedgerProjectionJson: { headHash: HASH },
      expectedOrchestrationHash: HASH,
      expectedWorldSequence: 0,
      expectedReservedWorldSequence: 0,
      expectedWorldStateJson: { stateHash: HASH },
      expectedSeatStateRevision: 1,
      expectedSeatVersion: 1,
      expectedSeatStateHash: HASH,
      expectedSeatSnapshotJson: { stateHash: HASH },
      expectedOrchestratorEventId: "orchestrator-1",
      expectedOrchestratorDedupeKey: "orchestrator:run-1:1",
      expectedOrchestratorPayloadJson: { orchestratorHash: HASH },
      expectedViewerPlayerId: "player-1",
      expectedViewerUserId: SUBJECT_ID,
      expectedViewerRoleId: "role-1",
      expectedViewerPlayerType: "human",
      expectedViewerStatus: "active",
      submissionActionId: human.action.actionId,
      submissionIdempotencyKey: human.action.idempotencyKey,
      submissionRequestFingerprint: HASH,
    },
    frozenRuntime: {
      workingRevision: 2,
      workingStateJson: { stateHash: HASH },
      workingStateHash: HASH,
      decisionStateJson: { state: "NONE" },
      ledgerProjectionJson: { headHash: HASH },
      closeInputHash: HASH,
      frozenAt: now,
    },
    worldTransition: {
      committedWorldSequence: 1,
      reservedWorldSequence: 1,
      committedWorldStateJson: { stateHash: HASH },
      currentChapter: 2,
      currentNodeId: "N2",
      nextRuntime: {
        id: NEXT_RUNTIME_ID,
        runId: RUN_ID,
        chapterId: "N2",
        chapterSequence: 2,
        state: "CHAPTER_ACTIVE",
        baseWorldSequence: 1,
        baseWorldStateHash: HASH,
        previousFrozenHash: HASH,
        routeHash: HASH,
        contentPackageVersion: "content-v1",
        contentHash: HASH,
        orchestrationPackageVersion: "orchestration-v1",
        orchestrationHash: HASH,
        runtimeContractVersion: "runtime-v1",
        runtimeContractHash: HASH,
        workingRevision: 0,
        workingStateJson: { stateHash: HASH },
        workingStateHash: HASH,
        decisionStateJson: { state: "NONE" },
        ledgerProjectionJson: { headHash: HASH },
        closeInputHash: null,
        lockVersion: 0,
        openedAt: now,
      },
    },
    decisionActions: [{
      id: human.action.actionId,
      runId: RUN_ID,
      chapterRuntimeId: RUNTIME_ID,
      decisionPointId: COMMAND.decisionPointId,
      seatId: HUMAN_SEAT,
      actionOrdinal: 1,
      actionType: "DECIDE",
      status: "SEALED",
      controlEpoch: 1,
      expectedWorkingRevision: 1,
      currentRevision: 1,
      idempotencyKey: human.action.idempotencyKey,
      requestFingerprint: HASH,
      payloadJson: {},
      payloadHash: HASH,
      sealedHash: HASH,
      authorityEventHash: HASH,
      confirmedAt: now,
      sealedAt: now,
      createdAt: now,
      updatedAt: now,
    }],
    storyEvents: [{
      id: "event-1",
      runId: RUN_ID,
      day: 1,
      type: "PRESSURE_WORKING_LEDGER_EVENT",
      messageType: "system",
      roleKey: HUMAN_SEAT,
      visibility: "system",
      payloadJson: {},
      sequence: null,
      dedupeKey: "event-1",
      audienceType: null,
      audienceRoleIdsJson: null,
      sourceActionId: human.action.actionId,
      createdAt: now,
    }],
    settlement: {
      id: "settlement-1",
      runId: RUN_ID,
      chapterRuntimeId: RUNTIME_ID,
      chapterId: "N1",
      chapterSequence: 1,
      schemaVersion: "settlement-v1",
      idempotencyKey: "settlement-key-1",
      requestFingerprint: HASH,
      baseWorldSequence: 0,
      committedWorldSequence: 1,
      baseWorldStateHash: HASH,
      committedWorldStateHash: HASH,
      inputJson: {},
      inputHash: HASH,
      evaluationJson: {},
      evaluationHash: HASH,
      worldDeltaJson: {},
      worldDeltaHash: HASH,
      decisionLedgerHash: HASH,
      finalWorkingStateHash: HASH,
      reservationLedgerHash: HASH,
      frozenBundleHash: HASH,
      commitManifestJson: {},
      commitManifestHash: HASH,
      rootEventId: "root-event-1",
      outboxDedupeKeysJson: ["outbox-1"],
      commitHash: HASH,
      committedAt: now,
    },
    narrativeProjections: [{
      id: "projection-1",
      runId: RUN_ID,
      projectionKind: "CHAPTER_NARRATIVE",
      sourceAuthority: "CHAPTER_FROZEN",
      sourceId: "settlement-1",
      sourceCommitHash: HASH,
      sourceContentHash: HASH,
      narrativeProfileVersion: "profile-v1",
      projectorVersion: "projector-v1",
      audienceKind: "PUBLIC",
      audienceSeatId: null,
      audienceKey: "public",
      status: "PENDING",
      requestFingerprint: HASH,
      attempt: 0,
      maxAttempts: 3,
      checkpoint: "PERSISTED",
      artifactJson: null,
      artifactContentHash: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      leaseVersion: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
    }],
    outboxTasks: [{
      id: "outbox-1",
      runId: RUN_ID,
      taskType: "OPEN_CHAPTER",
      status: "PENDING",
      checkpoint: "PERSISTED",
      dedupeKey: "outbox-1",
      sourceAuthority: "CHAPTER_FROZEN",
      sourceId: "settlement-1",
      sourceCommitHash: HASH,
      payloadJson: {},
      payloadHash: HASH,
      attempt: 0,
      maxAttempts: 5,
      availableAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      leaseVersion: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    }],
    receipt,
  };
}

function projectionFixture(): PressureChapterGameProjectionV1 {
  return {
    schemaVersion: "pressure_chapter_game_projection_v1",
    roomId: RUN_ID,
    runId: RUN_ID,
    chapter: { chapterId: "N2", chapterRuntimeId: NEXT_RUNTIME_ID },
    projectionHash: HASH,
  } as PressureChapterGameProjectionV1;
}
