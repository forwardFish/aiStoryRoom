import { Prisma } from "@prisma/client";
import {
  recordPressureDbTransactionAttemptV1,
  recordPressureDbTransactionCommitV1,
  recordPressureDbTransactionRollbackV1,
  readPressureDbRequestMetricsV1,
} from "../observability/pressure-db-metrics";
import {
  PRESSURE_SQL7_COMMIT_MAX_APPLICATION_SQL_V1,
  PressureSql7CommitErrorV1,
  type CommittedDecisionToNextProjectionAuthorityV1,
  type PressureSql7ChapterSettlementRowV1,
  type PressureSql7CommitPlanV1,
  type PressureSql7CommitQueryLabelV1,
  type PressureSql7DecisionActionRowV1,
  type PressureSql7NarrativeProjectionRowV1,
  type PressureSql7OutboxTaskRowV1,
  type PressureSql7StoryEventRowV1,
  validatePressureSql7CommitPlanV1,
} from "./commit-contract";

const SQL7_TRANSACTION_OPTIONS = Object.freeze({
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 500,
  timeout: 10_000,
});

interface CountResultV1 { count: number }

interface AuthorityCasResultV1 {
  authorityCount: number | bigint | string;
  frozenRuntimeCount: number | bigint | string;
  advancedWorldCount: number | bigint | string;
  nextRuntimeCount: number | bigint | string;
}

export interface PressureSql7CommitTransactionV1 {
  $queryRaw<TResult = unknown>(query: Prisma.Sql): Promise<TResult>;
  pressureDecisionAction: {
    createMany(input: { data: readonly PressureSql7DecisionActionRowV1[] }): Promise<CountResultV1>;
  };
  storyEvent: {
    createMany(input: { data: readonly PressureSql7StoryEventRowV1[] }): Promise<CountResultV1>;
  };
  pressureChapterSettlement: {
    create(input: { data: PressureSql7ChapterSettlementRowV1 }): Promise<{ id: string }>;
  };
  pressureNarrativeProjection: {
    createMany(input: { data: readonly PressureSql7NarrativeProjectionRowV1[] }): Promise<CountResultV1>;
  };
  pressureOutboxTask: {
    createMany(input: { data: readonly PressureSql7OutboxTaskRowV1[] }): Promise<CountResultV1>;
  };
}

export interface PressureSql7PrismaClientV1 {
  $transaction<TResult>(
    operation: (tx: PressureSql7CommitTransactionV1) => Promise<TResult>,
    options: typeof SQL7_TRANSACTION_OPTIONS,
  ): Promise<TResult>;
}

export interface PressureSql7QueryBudgetSnapshotV1 {
  applicationSqlCount: number;
  maxApplicationSql: number;
  labels: readonly PressureSql7CommitQueryLabelV1[];
  actualApplicationSqlCount: number | null;
  verifiedByPrismaQueryEvents: boolean;
}

export interface PressureSql7CommitResultV1 {
  status: "COMMITTED";
  authority: CommittedDecisionToNextProjectionAuthorityV1;
  queryBudget: PressureSql7QueryBudgetSnapshotV1;
}

export class PressureSql7ApplicationQueryCounterV1 {
  private readonly labels: PressureSql7CommitQueryLabelV1[] = [];

  async execute<TResult>(
    label: PressureSql7CommitQueryLabelV1,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    if (this.labels.length >= PRESSURE_SQL7_COMMIT_MAX_APPLICATION_SQL_V1) {
      throw new PressureSql7CommitErrorV1(
        "QUERY_BUDGET_EXCEEDED",
        "Pressure SQL7 commit exceeded its six-statement transaction budget",
        { attemptedLabel: label, labels: [...this.labels] },
      );
    }
    this.labels.push(label);
    return operation();
  }

  snapshot(actualApplicationSqlCount: number | null = null): PressureSql7QueryBudgetSnapshotV1 {
    return Object.freeze({
      applicationSqlCount: this.labels.length,
      maxApplicationSql: PRESSURE_SQL7_COMMIT_MAX_APPLICATION_SQL_V1,
      labels: Object.freeze([...this.labels]),
      actualApplicationSqlCount,
      verifiedByPrismaQueryEvents: actualApplicationSqlCount === this.labels.length,
    });
  }
}

export type PressureSql7QueryCounterFactoryV1 =
  () => PressureSql7ApplicationQueryCounterV1;

/**
 * P4 first-success-path committer. The caller supplies a fully precomputed,
 * validated plan. This adapter performs no reads and executes exactly six
 * application statements inside one Serializable transaction.
 */
export class PrismaPressureSql7CommitRepositoryV1 {
  constructor(
    private readonly prisma: PressureSql7PrismaClientV1,
    private readonly counterFactory: PressureSql7QueryCounterFactoryV1 =
      () => new PressureSql7ApplicationQueryCounterV1(),
  ) {}

  async commit(
    suppliedPlan: Readonly<PressureSql7CommitPlanV1>,
  ): Promise<PressureSql7CommitResultV1> {
    const plan = validatePressureSql7CommitPlanV1(suppliedPlan);
    const counter = this.counterFactory();
    const metricsBefore = readPressureDbRequestMetricsV1();
    if (!metricsBefore) {
      throw new PressureSql7CommitErrorV1(
        "QUERY_BUDGET_EXCEEDED",
        "Pressure SQL7 requires request-scoped Prisma query-event metrics",
      );
    }
    let actualApplicationSqlCount: number | null = null;
    recordPressureDbTransactionAttemptV1();
    let authority: CommittedDecisionToNextProjectionAuthorityV1;
    try {
      authority = await this.prisma.$transaction(async (tx) => {
      const casRows = await counter.execute(
        "AUTHORITY_CAS_AND_NEXT_RUNTIME",
        () => tx.$queryRaw<AuthorityCasResultV1[]>(authorityCasSql(plan)),
      );
      assertAuthorityCas(casRows, plan);

      const actions = await counter.execute(
        "DECISION_ACTIONS",
        () => tx.pressureDecisionAction.createMany({ data: plan.decisionActions }),
      );
      assertCount("DECISION_ACTIONS", actions.count, plan.decisionActions.length);

      const events = await counter.execute(
        "STORY_EVENTS",
        () => tx.storyEvent.createMany({ data: plan.storyEvents }),
      );
      assertCount("STORY_EVENTS", events.count, plan.storyEvents.length);

      const settlement = await counter.execute(
        "CHAPTER_SETTLEMENT",
        () => tx.pressureChapterSettlement.create({ data: plan.settlement }),
      );
      if (settlement.id !== plan.settlement.id) {
        throw countMismatch("CHAPTER_SETTLEMENT", plan.settlement.id, settlement.id);
      }

      const projections = await counter.execute(
        "NARRATIVE_PROJECTIONS",
        () => tx.pressureNarrativeProjection.createMany({ data: plan.narrativeProjections }),
      );
      assertCount(
        "NARRATIVE_PROJECTIONS",
        projections.count,
        plan.narrativeProjections.length,
      );

      const outbox = await counter.execute(
        "OUTBOX_TASKS",
        () => tx.pressureOutboxTask.createMany({ data: plan.outboxTasks }),
      );
      assertCount("OUTBOX_TASKS", outbox.count, plan.outboxTasks.length);
      const metricsAfterWrites = readPressureDbRequestMetricsV1();
      actualApplicationSqlCount = metricsAfterWrites
        ? metricsAfterWrites.applicationSqlStatementCount
          - metricsBefore.applicationSqlStatementCount
        : null;
      const logicalApplicationSqlCount = counter.snapshot().applicationSqlCount;
      if (actualApplicationSqlCount !== logicalApplicationSqlCount) {
        throw new PressureSql7CommitErrorV1(
          "QUERY_BUDGET_EXCEEDED",
          "Pressure SQL7 commit requires exactly six measured application statements",
          { actualApplicationSqlCount, logicalApplicationSqlCount },
        );
      }
      return structuredClone(plan.receipt);
      }, SQL7_TRANSACTION_OPTIONS);
      recordPressureDbTransactionCommitV1();
    } catch (cause) {
      recordPressureDbTransactionRollbackV1();
      throw cause;
    }

    return {
      status: "COMMITTED",
      authority,
      queryBudget: counter.snapshot(actualApplicationSqlCount),
    };
  }
}

function authorityCasSql(plan: PressureSql7CommitPlanV1): Prisma.Sql {
  const { fence, frozenRuntime, worldTransition } = plan;
  const next = worldTransition.nextRuntime;
  const now = frozenRuntime.frozenAt;
  return Prisma.sql`
    WITH authority AS MATERIALIZED (
      SELECT runtime.id AS "chapterRuntimeId"
      FROM "PressureChapterRuntime" AS runtime
      INNER JOIN "StoryRun" AS run ON run.id = runtime."runId"
      INNER JOIN "PressureRunRouteSnapshot" AS route
        ON route."runId" = runtime."runId" AND route."routeHash" = runtime."routeHash"
      INNER JOIN "PressureSeatControlSnapshot" AS seat ON seat."runId" = runtime."runId"
      INNER JOIN "StoryEvent" AS orchestrator ON orchestrator.id = ${fence.expectedOrchestratorEventId}
      INNER JOIN "StoryPlayer" AS viewer ON viewer.id = ${fence.expectedViewerPlayerId}
      WHERE runtime.id = ${fence.chapterRuntimeId}
        AND runtime."runId" = ${fence.runId}
        AND runtime."chapterId" = ${fence.chapterId}
        AND runtime."chapterSequence" = ${fence.chapterSequence}
        AND runtime.state::text = ${fence.expectedRuntimeState}
        AND runtime."routeHash" = ${fence.routeHash}
        AND runtime."lockVersion" = ${fence.expectedRuntimeLockVersion}
        AND runtime."workingRevision" = ${fence.expectedWorkingRevision}
        AND runtime."workingStateHash" = ${fence.expectedWorkingStateHash}
        AND runtime."workingStateJson" = ${jsonText(fence.expectedWorkingStateJson)}::jsonb
        AND runtime."ledgerProjectionJson" = ${jsonText(fence.expectedLedgerProjectionJson)}::jsonb
        AND runtime."orchestrationHash" = ${fence.expectedOrchestrationHash}
        AND run."worldSequence" = ${fence.expectedWorldSequence}
        AND run."reservedWorldSequence" = ${fence.expectedReservedWorldSequence}
        AND run."stateJson" = ${jsonText(fence.expectedWorldStateJson)}::jsonb
        AND route."routeHash" = ${fence.routeHash}
        AND seat."routeHash" = ${fence.routeHash}
        AND seat."stateRevision" = ${fence.expectedSeatStateRevision}
        AND seat.version = ${fence.expectedSeatVersion}
        AND seat."stateHash" = ${fence.expectedSeatStateHash}
        AND seat."snapshotJson" = ${jsonText(fence.expectedSeatSnapshotJson)}::jsonb
        AND orchestrator."runId" = ${fence.runId}
        AND orchestrator."dedupeKey" = ${fence.expectedOrchestratorDedupeKey}
        AND orchestrator."payloadJson" = ${jsonText(fence.expectedOrchestratorPayloadJson)}::jsonb
        AND viewer."runId" = ${fence.runId}
        AND viewer."userId" = ${fence.expectedViewerUserId}
        AND viewer."roleId" IS NOT DISTINCT FROM ${fence.expectedViewerRoleId}
        AND viewer."playerType" = ${fence.expectedViewerPlayerType}
        AND viewer.status = ${fence.expectedViewerStatus}
      FOR UPDATE OF runtime, run, route, seat, orchestrator, viewer
    ), frozen_runtime AS (
      UPDATE "PressureChapterRuntime" AS runtime
      SET state = 'CHAPTER_FROZEN'::"PressureChapterRuntimeState",
          "workingRevision" = ${frozenRuntime.workingRevision},
          "workingStateJson" = ${jsonText(frozenRuntime.workingStateJson)}::jsonb,
          "workingStateHash" = ${frozenRuntime.workingStateHash},
          "decisionStateJson" = ${jsonText(frozenRuntime.decisionStateJson)}::jsonb,
          "ledgerProjectionJson" = ${jsonText(frozenRuntime.ledgerProjectionJson)}::jsonb,
          "closeInputHash" = ${frozenRuntime.closeInputHash},
          "lockVersion" = runtime."lockVersion" + 1,
          "closingAt" = COALESCE(runtime."closingAt", ${now}),
          "frozenAt" = ${now},
          "updatedAt" = ${now}
      FROM authority
      WHERE runtime.id = authority."chapterRuntimeId"
      RETURNING runtime.id
    ), advanced_world AS (
      UPDATE "StoryRun" AS run
      SET "worldSequence" = ${worldTransition.committedWorldSequence},
          "reservedWorldSequence" = ${worldTransition.reservedWorldSequence},
          "stateJson" = ${jsonText(worldTransition.committedWorldStateJson)}::jsonb,
          "currentChapter" = ${worldTransition.currentChapter},
          "currentNodeId" = ${worldTransition.currentNodeId},
          "updatedAt" = ${now}
      FROM authority, frozen_runtime
      WHERE run.id = ${fence.runId}
      RETURNING run.id
    ), next_runtime AS (
      INSERT INTO "PressureChapterRuntime" (
        id, "runId", "chapterId", "chapterSequence", state,
        "baseWorldSequence", "baseWorldStateHash", "previousFrozenHash", "routeHash",
        "contentPackageVersion", "contentHash", "orchestrationPackageVersion",
        "orchestrationHash", "runtimeContractVersion", "runtimeContractHash",
        "workingRevision", "workingStateJson", "workingStateHash", "decisionStateJson",
        "ledgerProjectionJson", "closeInputHash", "lockVersion", "openedAt", "createdAt", "updatedAt"
      )
      SELECT
        ${next.id}, ${next.runId}, ${next.chapterId}, ${next.chapterSequence},
        ${next.state}::"PressureChapterRuntimeState", ${next.baseWorldSequence},
        ${next.baseWorldStateHash}, ${next.previousFrozenHash}, ${next.routeHash},
        ${next.contentPackageVersion}, ${next.contentHash},
        ${next.orchestrationPackageVersion}, ${next.orchestrationHash},
        ${next.runtimeContractVersion}, ${next.runtimeContractHash},
        ${next.workingRevision}, ${jsonText(next.workingStateJson)}::jsonb,
        ${next.workingStateHash}, ${jsonText(next.decisionStateJson)}::jsonb,
        ${jsonText(next.ledgerProjectionJson)}::jsonb, ${next.closeInputHash},
        ${next.lockVersion}, ${next.openedAt}, ${next.openedAt}, ${next.openedAt}
      FROM authority, frozen_runtime, advanced_world
      RETURNING id
    )
    SELECT
      (SELECT count(*) FROM authority) AS "authorityCount",
      (SELECT count(*) FROM frozen_runtime) AS "frozenRuntimeCount",
      (SELECT count(*) FROM advanced_world) AS "advancedWorldCount",
      (SELECT count(*) FROM next_runtime) AS "nextRuntimeCount"
  `;
}

function assertAuthorityCas(
  rows: readonly AuthorityCasResultV1[],
  plan: PressureSql7CommitPlanV1,
): void {
  const row = rows[0];
  if (
    rows.length !== 1
    || !row
    || numericCount(row.authorityCount) !== 1
    || numericCount(row.frozenRuntimeCount) !== 1
    || numericCount(row.advancedWorldCount) !== 1
    || numericCount(row.nextRuntimeCount) !== 1
  ) {
    throw new PressureSql7CommitErrorV1(
      "AUTHORITY_FENCE_MISMATCH",
      "Pressure SQL7 authority fence or CAS did not advance exactly one row",
      {
        runId: plan.fence.runId,
        chapterRuntimeId: plan.fence.chapterRuntimeId,
        counts: row ? {
          authority: String(row.authorityCount),
          frozenRuntime: String(row.frozenRuntimeCount),
          advancedWorld: String(row.advancedWorldCount),
          nextRuntime: String(row.nextRuntimeCount),
        } : null,
      },
    );
  }
}

function assertCount(
  label: PressureSql7CommitQueryLabelV1,
  actual: number,
  expected: number,
): void {
  if (actual !== expected) throw countMismatch(label, expected, actual);
}

function countMismatch(
  label: PressureSql7CommitQueryLabelV1,
  expected: string | number,
  actual: string | number,
): PressureSql7CommitErrorV1 {
  return new PressureSql7CommitErrorV1(
    "PERSISTED_COUNT_MISMATCH",
    `Pressure SQL7 ${label} result did not match the precomputed plan`,
    { label, expected, actual },
  );
}

function numericCount(value: number | bigint | string): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function jsonText(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new PressureSql7CommitErrorV1(
      "INVALID_PLAN",
      "Pressure SQL7 raw SQL JSON parameter is undefined",
    );
  }
  return encoded;
}
