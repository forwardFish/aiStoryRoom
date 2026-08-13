import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import {
  recordPressureDbQueryV1,
  withPressureDbRequestMetricsV1,
} from "../observability/pressure-db-metrics";
import {
  PressureSql7CommitErrorV1,
  type PressureSql7CommitPlanV1,
} from "./commit-contract";
import {
  PrismaPressureSql7CommitRepositoryV1,
  type PressureSql7CommitTransactionV1,
  type PressureSql7PrismaClientV1,
} from "./prisma-commit";

const HASH = "a".repeat(64);
const LATER_HASH = "b".repeat(64);

class FakePrisma implements PressureSql7PrismaClientV1 {
  readonly calls: string[] = [];
  rolledBack = false;
  transactionAttempts = 0;
  casCount = 1;
  actionCount = 1;
  emitQueryEvents = false;
  emitExtraApplicationQuery = false;
  omitOutboxQueryEvent = false;

  private query(sql: string): void {
    if (this.emitQueryEvents) recordPressureDbQueryV1(sql, 1);
  }

  async $transaction<TResult>(
    operation: (tx: PressureSql7CommitTransactionV1) => Promise<TResult>,
    _options: { isolationLevel: "Serializable"; maxWait: number; timeout: number },
  ): Promise<TResult> {
    this.transactionAttempts += 1;
    this.query("BEGIN");
    const tx: PressureSql7CommitTransactionV1 = {
      $queryRaw: async <TResult>(_query: Prisma.Sql) => {
        this.query("WITH authority AS (SELECT 1) UPDATE authority SET id = id");
        this.calls.push("AUTHORITY_CAS_AND_NEXT_RUNTIME");
        return [{
          authorityCount: this.casCount,
          frozenRuntimeCount: this.casCount,
          advancedWorldCount: this.casCount,
          nextRuntimeCount: this.casCount,
        }] as TResult;
      },
      pressureDecisionAction: {
        createMany: async () => {
          this.query('INSERT INTO "PressureDecisionAction" VALUES (1)');
          this.calls.push("DECISION_ACTIONS");
          return { count: this.actionCount };
        },
      },
      storyEvent: {
        createMany: async ({ data }) => {
          this.query('INSERT INTO "StoryEvent" VALUES (1)');
          this.calls.push("STORY_EVENTS");
          return { count: data.length };
        },
      },
      pressureChapterSettlement: {
        create: async ({ data }) => {
          this.query('INSERT INTO "PressureChapterSettlement" VALUES (1)');
          this.calls.push("CHAPTER_SETTLEMENT");
          return { id: data.id };
        },
      },
      pressureNarrativeProjection: {
        createMany: async ({ data }) => {
          this.query('INSERT INTO "PressureNarrativeProjection" VALUES (1)');
          this.calls.push("NARRATIVE_PROJECTIONS");
          return { count: data.length };
        },
      },
      pressureOutboxTask: {
        createMany: async ({ data }) => {
          if (!this.omitOutboxQueryEvent) {
            this.query('INSERT INTO "PressureOutboxTask" VALUES (1)');
          }
          if (this.emitExtraApplicationQuery) this.query("SELECT unexpected_extra_query");
          this.calls.push("OUTBOX_TASKS");
          return { count: data.length };
        },
      },
    };
    try {
      const result = await operation(tx);
      this.query("COMMIT");
      return result;
    } catch (error) {
      this.rolledBack = true;
      throw error;
    }
  }
}

async function main(): Promise<void> {
  const successPrisma = new FakePrisma();
  successPrisma.emitQueryEvents = true;
  const success = await withPressureDbRequestMetricsV1(
    () => new PrismaPressureSql7CommitRepositoryV1(successPrisma).commit(plan()),
  );
  assert.equal(success.status, "COMMITTED");
  assert.equal(success.authority.commitHash, LATER_HASH);
  assert.equal(success.queryBudget.applicationSqlCount, 6);
  assert.equal(success.queryBudget.actualApplicationSqlCount, 6);
  assert.equal(success.queryBudget.verifiedByPrismaQueryEvents, true);
  assert.deepEqual(successPrisma.calls, [
    "AUTHORITY_CAS_AND_NEXT_RUNTIME",
    "DECISION_ACTIONS",
    "STORY_EVENTS",
    "CHAPTER_SETTLEMENT",
    "NARRATIVE_PROJECTIONS",
    "OUTBOX_TASKS",
  ]);
  assert.equal(successPrisma.rolledBack, false);

  const stalePrisma = new FakePrisma();
  stalePrisma.casCount = 0;
  stalePrisma.emitQueryEvents = true;
  await assert.rejects(
    () => withPressureDbRequestMetricsV1(
      () => new PrismaPressureSql7CommitRepositoryV1(stalePrisma).commit(plan()),
    ),
    (error: unknown) => error instanceof PressureSql7CommitErrorV1
      && error.code === "AUTHORITY_FENCE_MISMATCH",
  );
  assert.equal(stalePrisma.rolledBack, true);
  assert.deepEqual(stalePrisma.calls, ["AUTHORITY_CAS_AND_NEXT_RUNTIME"]);

  const partialPrisma = new FakePrisma();
  partialPrisma.actionCount = 0;
  partialPrisma.emitQueryEvents = true;
  await assert.rejects(
    () => withPressureDbRequestMetricsV1(
      () => new PrismaPressureSql7CommitRepositoryV1(partialPrisma).commit(plan()),
    ),
    (error: unknown) => error instanceof PressureSql7CommitErrorV1
      && error.code === "PERSISTED_COUNT_MISMATCH",
  );
  assert.equal(partialPrisma.rolledBack, true);
  assert.deepEqual(partialPrisma.calls, [
    "AUTHORITY_CAS_AND_NEXT_RUNTIME",
    "DECISION_ACTIONS",
  ]);

  const invalidPrisma = new FakePrisma();
  const invalidPlan = plan();
  invalidPlan.fence.submissionIdempotencyKey = "different-key";
  await assert.rejects(
    () => new PrismaPressureSql7CommitRepositoryV1(invalidPrisma).commit(invalidPlan),
    (error: unknown) => error instanceof PressureSql7CommitErrorV1
      && error.code === "INVALID_PLAN",
  );
  assert.equal(invalidPrisma.transactionAttempts, 0);
  assert.deepEqual(invalidPrisma.calls, []);

  await assert.rejects(
    () => new PrismaPressureSql7CommitRepositoryV1(new FakePrisma()).commit(plan()),
    (error: unknown) => error instanceof PressureSql7CommitErrorV1
      && error.code === "QUERY_BUDGET_EXCEEDED",
  );

  const measuredPrisma = new FakePrisma();
  measuredPrisma.emitQueryEvents = true;
  const measured = await withPressureDbRequestMetricsV1(
    () => new PrismaPressureSql7CommitRepositoryV1(measuredPrisma).commit(plan()),
  );
  assert.equal(measured.queryBudget.actualApplicationSqlCount, 6);
  assert.equal(measured.queryBudget.verifiedByPrismaQueryEvents, true);

  const overBudgetPrisma = new FakePrisma();
  overBudgetPrisma.emitQueryEvents = true;
  overBudgetPrisma.emitExtraApplicationQuery = true;
  await assert.rejects(
    () => withPressureDbRequestMetricsV1(
      () => new PrismaPressureSql7CommitRepositoryV1(overBudgetPrisma).commit(plan()),
    ),
    (error: unknown) => error instanceof PressureSql7CommitErrorV1
      && error.code === "QUERY_BUDGET_EXCEEDED",
  );
  assert.equal(overBudgetPrisma.rolledBack, true);

  const underCountedPrisma = new FakePrisma();
  underCountedPrisma.emitQueryEvents = true;
  underCountedPrisma.omitOutboxQueryEvent = true;
  await assert.rejects(
    () => withPressureDbRequestMetricsV1(
      () => new PrismaPressureSql7CommitRepositoryV1(underCountedPrisma).commit(plan()),
    ),
    (error: unknown) => error instanceof PressureSql7CommitErrorV1
      && error.code === "QUERY_BUDGET_EXCEEDED",
  );
  assert.equal(underCountedPrisma.rolledBack, true);
  console.log("pressure SQL7 Prisma commit: PASS");
}

function plan(): PressureSql7CommitPlanV1 {
  const now = new Date("2026-08-13T12:00:00.000Z");
  return {
    schemaVersion: "pressure_sql7_commit_plan_v1",
    fence: {
      runId: "run-1",
      routeHash: HASH,
      chapterRuntimeId: "runtime-n1",
      chapterId: "N1",
      chapterSequence: 1,
      expectedRuntimeState: "DECISION_POINT_OPEN",
      expectedRuntimeLockVersion: 3,
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
      expectedViewerUserId: "user-1",
      expectedViewerRoleId: "role-1",
      expectedViewerPlayerType: "human",
      expectedViewerStatus: "active",
      submissionActionId: "action-1",
      submissionIdempotencyKey: "action-key-1",
      submissionRequestFingerprint: HASH,
    },
    frozenRuntime: {
      workingRevision: 3,
      workingStateJson: { stateHash: LATER_HASH },
      workingStateHash: LATER_HASH,
      decisionStateJson: { state: "NONE" },
      ledgerProjectionJson: { headHash: LATER_HASH },
      closeInputHash: LATER_HASH,
      frozenAt: now,
    },
    worldTransition: {
      committedWorldSequence: 1,
      reservedWorldSequence: 1,
      committedWorldStateJson: { stateHash: LATER_HASH },
      currentChapter: 2,
      currentNodeId: "N2",
      nextRuntime: {
        id: "runtime-n2",
        runId: "run-1",
        chapterId: "N2",
        chapterSequence: 2,
        state: "CHAPTER_ACTIVE",
        baseWorldSequence: 1,
        baseWorldStateHash: LATER_HASH,
        previousFrozenHash: LATER_HASH,
        routeHash: HASH,
        contentPackageVersion: "content-v1",
        contentHash: HASH,
        orchestrationPackageVersion: "orchestration-v1",
        orchestrationHash: LATER_HASH,
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
      id: "action-1",
      runId: "run-1",
      chapterRuntimeId: "runtime-n1",
      decisionPointId: "decision-1",
      seatId: "P1",
      actionOrdinal: 1,
      actionType: "WAIT",
      status: "SEALED",
      controlEpoch: 1,
      expectedWorkingRevision: 1,
      currentRevision: 1,
      idempotencyKey: "action-key-1",
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
      runId: "run-1",
      day: 1,
      type: "PRESSURE_WORKING_LEDGER_EVENT",
      messageType: "system",
      roleKey: "P1",
      visibility: "system",
      payloadJson: {},
      sequence: null,
      dedupeKey: "event-1",
      audienceType: null,
      audienceRoleIdsJson: null,
      sourceActionId: null,
      createdAt: now,
    }],
    settlement: {
      id: "settlement-1",
      runId: "run-1",
      chapterRuntimeId: "runtime-n1",
      chapterId: "N1",
      chapterSequence: 1,
      schemaVersion: "settlement-v1",
      idempotencyKey: "settlement-key-1",
      requestFingerprint: HASH,
      baseWorldSequence: 0,
      committedWorldSequence: 1,
      baseWorldStateHash: HASH,
      committedWorldStateHash: LATER_HASH,
      inputJson: {},
      inputHash: HASH,
      evaluationJson: {},
      evaluationHash: HASH,
      worldDeltaJson: {},
      worldDeltaHash: HASH,
      decisionLedgerHash: HASH,
      finalWorkingStateHash: LATER_HASH,
      reservationLedgerHash: HASH,
      frozenBundleHash: LATER_HASH,
      commitManifestJson: {},
      commitManifestHash: HASH,
      rootEventId: "root-event-1",
      outboxDedupeKeysJson: [],
      commitHash: LATER_HASH,
      committedAt: now,
    },
    narrativeProjections: [{
      id: "projection-1",
      runId: "run-1",
      projectionKind: "CHAPTER_NARRATIVE",
      sourceAuthority: "CHAPTER_FROZEN",
      sourceId: "settlement-1",
      sourceCommitHash: LATER_HASH,
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
      runId: "run-1",
      taskType: "OPEN_CHAPTER",
      status: "PENDING",
      checkpoint: "PERSISTED",
      dedupeKey: "outbox-1",
      sourceAuthority: "CHAPTER_FROZEN",
      sourceId: "settlement-1",
      sourceCommitHash: LATER_HASH,
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
    receipt: {
      schemaVersion: "pressure_committed_decision_to_next_projection_authority_v1",
      runId: "run-1",
      previousChapterRuntimeId: "runtime-n1",
      nextChapterRuntimeId: "runtime-n2",
      settlementId: "settlement-1",
      committedWorldSequence: 1,
      commitHash: LATER_HASH,
      projectionAuthority: projectionAuthority(),
    },
  };
}

function projectionAuthority(): PressureSql7CommitPlanV1["receipt"]["projectionAuthority"] {
  const viewerSeatId = "cabinet_finance" as const;
  return {
    roomId: "run-1",
    runId: "run-1",
    subjectId: "user-1",
    viewerSeatId,
    routeSnapshot: {
      runId: "run-1",
      routeHash: HASH,
    } as PressureSql7CommitPlanV1["receipt"]["projectionAuthority"]["routeSnapshot"],
    chapter: {
      runId: "run-1",
      chapterRuntimeId: "runtime-n2",
      chapterId: "N2",
    } as unknown as PressureSql7CommitPlanV1["receipt"]["projectionAuthority"]["chapter"],
    workingProjection: {
      state: { revision: 0 },
      stateHash: HASH,
      headHash: HASH,
    } as PressureSql7CommitPlanV1["receipt"]["projectionAuthority"]["workingProjection"],
    chapterDescriptor: {
      chapterId: "N2",
    } as PressureSql7CommitPlanV1["receipt"]["projectionAuthority"]["chapterDescriptor"],
    viewerSource: {
      roomId: "run-1",
      runId: "run-1",
      routeHash: HASH,
      subjectId: "user-1",
      viewer: {
        seatId: viewerSeatId,
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
      runId: "run-1",
      routeHash: HASH,
      worldSequence: 1,
      worldStateHash: LATER_HASH,
      metrics: [],
    },
    narrativeSource: {
      runId: "run-1",
      routeHash: HASH,
      viewerSeatId,
      chapterRuntimeId: "runtime-n2",
      status: "PENDING",
      projectionKind: "CHAPTER_NARRATIVE",
      sourceAuthority: "CHAPTER_FROZEN",
      sourceId: "settlement-1",
      sourceCommitHash: LATER_HASH,
      text: null,
      contentHash: null,
      renderMode: null,
    },
    feedPage: {
      schemaVersion: "a_emotion_feed_page_v1",
      roomId: "run-1",
      runId: "run-1",
      viewerSeatId,
      items: [],
      unreadCount: 0,
      nextCursor: null,
      serverSequence: 1,
    },
  };
}

void main();
