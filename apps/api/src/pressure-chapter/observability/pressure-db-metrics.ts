import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

export interface PressureDbRequestMetricsV1 {
  applicationSqlStatementCount: number;
  transactionAttemptCount: number;
  committedTransactionCount: number;
  rolledBackTransactionCount: number;
  queryDurationMs: number;
  queryHashes: string[];
}

interface MutablePressureDbRequestMetricsV1 extends PressureDbRequestMetricsV1 {
  queryHashesSet: Set<string>;
}

const storage = new AsyncLocalStorage<MutablePressureDbRequestMetricsV1>();

export async function withPressureDbRequestMetricsV1<T>(
  operation: () => Promise<T>,
  onComplete?: (metrics: PressureDbRequestMetricsV1) => void,
): Promise<T> {
  const metrics: MutablePressureDbRequestMetricsV1 = {
    applicationSqlStatementCount: 0,
    transactionAttemptCount: 0,
    committedTransactionCount: 0,
    rolledBackTransactionCount: 0,
    queryDurationMs: 0,
    queryHashes: [],
    queryHashesSet: new Set(),
  };
  return storage.run(metrics, async () => {
    try {
      return await operation();
    } finally {
      const snapshot = {
        applicationSqlStatementCount: metrics.applicationSqlStatementCount,
        transactionAttemptCount: metrics.transactionAttemptCount,
        committedTransactionCount: metrics.committedTransactionCount,
        rolledBackTransactionCount: metrics.rolledBackTransactionCount,
        queryDurationMs: metrics.queryDurationMs,
        queryHashes: [...metrics.queryHashes],
      };
      onComplete?.(snapshot);
    }
  });
}

/** Prisma query-event hook. SQL text is reduced to a hash before diagnostics. */
export function recordPressureDbQueryV1(query: string, durationMs: number): void {
  const metrics = storage.getStore();
  if (!metrics) return;
  const normalized = query.replace(/\s+/gu, " ").trim().toUpperCase();
  const hash = createHash("sha256").update(normalized, "utf8").digest("hex");
  metrics.applicationSqlStatementCount += 1;
  metrics.queryDurationMs += Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  if (!metrics.queryHashesSet.has(hash)) {
    metrics.queryHashesSet.add(hash);
    metrics.queryHashes.push(hash);
  }
  if (/^BEGIN\b/u.test(normalized)) metrics.transactionAttemptCount += 1;
  if (/^COMMIT\b/u.test(normalized)) metrics.committedTransactionCount += 1;
  if (/^ROLLBACK\b/u.test(normalized)) metrics.rolledBackTransactionCount += 1;
}
