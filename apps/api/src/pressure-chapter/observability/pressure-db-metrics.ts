import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

export interface PressureDbRequestMetricsV1 {
  applicationSqlStatementCount: number;
  databaseProtocolRoundtripCountIncludingBeginCommit: number;
  transactionAttemptCount: number;
  committedTransactionCount: number;
  rolledBackTransactionCount: number;
  transactionRetryCount: number;
  queryDurationMs: number;
  queryHashes: string[];
}

interface MutablePressureDbRequestMetricsV1 extends PressureDbRequestMetricsV1 {
  queryHashesSet: Set<string>;
}

const storage = new AsyncLocalStorage<MutablePressureDbRequestMetricsV1>();
const activeRequests = new Set<MutablePressureDbRequestMetricsV1>();
const TRANSACTION_CONTROL_SQL_V1 = /^(?:BEGIN|COMMIT|ROLLBACK|SET TRANSACTION\b)/u;

export async function withPressureDbRequestMetricsV1<T>(
  operation: () => Promise<T>,
  onComplete?: (metrics: PressureDbRequestMetricsV1) => void,
): Promise<T> {
  const metrics: MutablePressureDbRequestMetricsV1 = {
    applicationSqlStatementCount: 0,
    databaseProtocolRoundtripCountIncludingBeginCommit: 0,
    transactionAttemptCount: 0,
    committedTransactionCount: 0,
    rolledBackTransactionCount: 0,
    transactionRetryCount: 0,
    queryDurationMs: 0,
    queryHashes: [],
    queryHashesSet: new Set(),
  };
  activeRequests.add(metrics);
  try {
    return await storage.run(metrics, operation);
  } finally {
    try {
      const snapshot: PressureDbRequestMetricsV1 = {
        applicationSqlStatementCount: metrics.applicationSqlStatementCount,
        databaseProtocolRoundtripCountIncludingBeginCommit:
          metrics.databaseProtocolRoundtripCountIncludingBeginCommit,
        transactionAttemptCount: metrics.transactionAttemptCount,
        committedTransactionCount: metrics.committedTransactionCount,
        rolledBackTransactionCount: metrics.rolledBackTransactionCount,
        transactionRetryCount: metrics.transactionRetryCount,
        queryDurationMs: metrics.queryDurationMs,
        queryHashes: [...metrics.queryHashes],
      };
      onComplete?.(snapshot);
    } finally {
      activeRequests.delete(metrics);
    }
  }
}

/** Prisma query-event hook. SQL text is reduced to a hash before diagnostics. */
export function recordPressureDbQueryV1(query: string, durationMs: number): void {
  const metrics = currentMetrics();
  if (!metrics) return;
  const normalized = query.replace(/\s+/gu, " ").trim().toUpperCase();
  const hash = createHash("sha256").update(normalized, "utf8").digest("hex");
  metrics.databaseProtocolRoundtripCountIncludingBeginCommit += 1;
  if (!TRANSACTION_CONTROL_SQL_V1.test(normalized)) {
    metrics.applicationSqlStatementCount += 1;
  }
  metrics.queryDurationMs += Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  if (!metrics.queryHashesSet.has(hash)) {
    metrics.queryHashesSet.add(hash);
    metrics.queryHashes.push(hash);
  }
}

export function recordPressureDbTransactionAttemptV1(): void {
  const metrics = currentMetrics();
  if (metrics) metrics.transactionAttemptCount += 1;
}

export function recordPressureDbTransactionCommitV1(): void {
  const metrics = currentMetrics();
  if (metrics) metrics.committedTransactionCount += 1;
}

export function recordPressureDbTransactionRollbackV1(): void {
  const metrics = currentMetrics();
  if (metrics) metrics.rolledBackTransactionCount += 1;
}

export function recordPressureDbTransactionRetryV1(): void {
  const metrics = currentMetrics();
  if (metrics) metrics.transactionRetryCount += 1;
}

/** Read-only request-local snapshot for hard query-budget guards. */
export function readPressureDbRequestMetricsV1(): PressureDbRequestMetricsV1 | null {
  const metrics = currentMetrics();
  if (!metrics) return null;
  return {
    applicationSqlStatementCount: metrics.applicationSqlStatementCount,
    databaseProtocolRoundtripCountIncludingBeginCommit:
      metrics.databaseProtocolRoundtripCountIncludingBeginCommit,
    transactionAttemptCount: metrics.transactionAttemptCount,
    committedTransactionCount: metrics.committedTransactionCount,
    rolledBackTransactionCount: metrics.rolledBackTransactionCount,
    transactionRetryCount: metrics.transactionRetryCount,
    queryDurationMs: metrics.queryDurationMs,
    queryHashes: [...metrics.queryHashes],
  };
}

function currentMetrics(): MutablePressureDbRequestMetricsV1 | undefined {
  const scoped = storage.getStore();
  if (scoped) return scoped;
  if (activeRequests.size !== 1) return undefined;
  return activeRequests.values().next().value;
}
