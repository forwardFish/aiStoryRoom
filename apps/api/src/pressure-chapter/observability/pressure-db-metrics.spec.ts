import assert from "node:assert/strict";
import test from "node:test";
import {
  recordPressureDbQueryV1,
  recordPressureDbTransactionAttemptV1,
  recordPressureDbTransactionCommitV1,
  recordPressureDbTransactionRetryV1,
  recordPressureDbTransactionRollbackV1,
  withPressureDbRequestMetricsV1,
  type PressureDbRequestMetricsV1,
} from "./pressure-db-metrics";

test("separates application SQL from transaction protocol and records retries", async () => {
  const captured: PressureDbRequestMetricsV1[] = [];
  await withPressureDbRequestMetricsV1(async () => {
    recordPressureDbTransactionAttemptV1();
    recordPressureDbQueryV1("BEGIN", 1);
    recordPressureDbQueryV1("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE", 1);
    recordPressureDbQueryV1("SELECT 1", 2);
    recordPressureDbQueryV1("ROLLBACK", 1);
    recordPressureDbTransactionRollbackV1();
    recordPressureDbTransactionRetryV1();
    recordPressureDbTransactionAttemptV1();
    recordPressureDbQueryV1("BEGIN", 1);
    recordPressureDbQueryV1("UPDATE x SET y = 1", 3);
    recordPressureDbQueryV1("COMMIT", 1);
    recordPressureDbTransactionCommitV1();
  }, (metrics) => {
    captured.push(metrics);
  });

  const metrics = captured[0];
  assert.ok(metrics);
  assert.equal(metrics.applicationSqlStatementCount, 2);
  assert.equal(metrics.databaseProtocolRoundtripCountIncludingBeginCommit, 7);
  assert.equal(metrics.transactionAttemptCount, 2);
  assert.equal(metrics.committedTransactionCount, 1);
  assert.equal(metrics.rolledBackTransactionCount, 1);
  assert.equal(metrics.transactionRetryCount, 1);
  assert.equal(metrics.queryDurationMs, 10);
  assert.equal(metrics.queryHashes.length, 6);
});

test("keeps concurrent request metrics isolated", async () => {
  const captured: number[] = [];
  await Promise.all([
    withPressureDbRequestMetricsV1(async () => {
      recordPressureDbQueryV1("SELECT 1", 1);
      await Promise.resolve();
      recordPressureDbQueryV1("SELECT 2", 1);
    }, (metrics) => captured.push(metrics.applicationSqlStatementCount)),
    withPressureDbRequestMetricsV1(async () => {
      recordPressureDbQueryV1("SELECT 3", 1);
    }, (metrics) => captured.push(metrics.applicationSqlStatementCount)),
  ]);
  assert.deepEqual(captured.sort((left, right) => left - right), [1, 2]);
});

test("attributes a detached Prisma query event when exactly one request is active", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let captured = -1;
  const request = withPressureDbRequestMetricsV1(async () => gate, (metrics) => {
    captured = metrics.applicationSqlStatementCount;
  });

  recordPressureDbQueryV1("SELECT detached", 4);
  release();
  await request;
  assert.equal(captured, 1);
});
