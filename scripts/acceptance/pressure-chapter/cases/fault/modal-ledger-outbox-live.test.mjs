import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchWithTimeout, normalizeBaseUrl, readJsonFixture, requireFixtureString, skipUnlessEnvironment } from '../../lib/live-fixture.mjs';

const ENV = [
  'PRESSURE_CHAPTER_ALLOW_MODAL_TRIGGER_TESTS',
  'PRESSURE_CHAPTER_ALLOW_FAULT_TESTS',
  'PRESSURE_CHAPTER_TEST_SCOPE',
  'PRESSURE_CHAPTER_DB_SCOPE',
  'PRESSURE_CHAPTER_DATABASE_PROVIDER',
  'DATABASE_URL',
  'PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256',
  'PRESSURE_CHAPTER_TEST_BASE_URL',
  'PRESSURE_MODAL_TRIGGER_LIVE_FIXTURE',
];

test('real Serializable commit keeps Working Ledger and Pressure Outbox atomic under crash/retry/replay', { timeout: 120_000 }, async (t) => {
  if (skipUnlessEnvironment(t, ENV)) return;
  assert.equal(process.env.PRESSURE_CHAPTER_ALLOW_MODAL_TRIGGER_TESTS, '1');
  assert.equal(process.env.PRESSURE_CHAPTER_ALLOW_FAULT_TESTS, '1');
  assert.equal(process.env.PRESSURE_CHAPTER_TEST_SCOPE, 'non-production');
  assert.equal(process.env.PRESSURE_CHAPTER_DB_SCOPE, 'non-production');
  assert.equal(process.env.PRESSURE_CHAPTER_DATABASE_PROVIDER, 'supabase');
  assert.notEqual(process.env.NODE_ENV, 'production');
  const { assertSafePressureDatabaseScope } = await import('../../../../../apps/api/src/pressure-chapter/persistence/database-contract.ts');
  const scope = assertSafePressureDatabaseScope({
    databaseUrl: process.env.DATABASE_URL,
    explicitScope: process.env.PRESSURE_CHAPTER_DB_SCOPE,
    allowedSupabaseProjectSha256: process.env.PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256,
  });
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: scope.databaseUrl } } });
  t.after(async () => prisma.$disconnect());

  const fixture = await readJsonFixture(process.env.PRESSURE_MODAL_TRIGGER_LIVE_FIXTURE, 'PRESSURE_MODAL_TRIGGER_LIVE_FIXTURE');
  const transaction = fixture.faultTransaction;
  const runId = requireFixtureString(transaction, 'runId', 'faultTransaction');
  const cookie = requireFixtureString(transaction, 'cookie', 'faultTransaction');
  const command = structuredClone(transaction.command);
  assert.equal(command.runId, runId);
  requireFixtureString(command, 'idempotencyKey', 'faultTransaction.command');
  const baseUrl = normalizeBaseUrl(process.env.PRESSURE_CHAPTER_TEST_BASE_URL);
  const url = new URL(`/api/v4/rooms/${encodeURIComponent(runId)}/game/action`, `${baseUrl}/`).href;
  const baseline = await counts(prisma, runId, command.idempotencyKey);

  for (const faultPoint of ['AFTER_LEDGER_BEFORE_OUTBOX', 'AFTER_OUTBOX_BEFORE_COMMIT']) {
    const result = await post(url, cookie, command, { 'x-pressure-test-fault-point': faultPoint });
    assert.ok(result.response.status >= 500, `${faultPoint} did not crash the transaction`);
    assert.deepEqual(await counts(prisma, runId, command.idempotencyKey), baseline, `${faultPoint} left a partial commit`);
  }

  const committed = await post(url, cookie, command);
  assert.ok(committed.response.ok, `retry did not commit: HTTP ${committed.response.status} ${JSON.stringify(committed.payload)}`);
  const afterCommit = await counts(prisma, runId, command.idempotencyKey);
  assert.equal(afterCommit.actions, baseline.actions + 1, 'Working Ledger action was not committed exactly once');
  assert.equal(afterCommit.outbox, baseline.outbox + 1, 'Pressure Outbox event was not committed exactly once');

  const replay = await post(url, cookie, command);
  assert.ok(replay.response.ok, `replay failed: HTTP ${replay.response.status}`);
  assert.deepEqual(replay.payload, committed.payload, 'idempotent replay receipt changed');
  assert.deepEqual(await counts(prisma, runId, command.idempotencyKey), afterCommit, 'replay duplicated ledger/outbox rows');
});

async function counts(prisma, runId, idempotencyKey) {
  const actions = await prisma.pressureDecisionAction.findMany({
    where: { runId, idempotencyKey }, select: { id: true },
  });
  const actionIds = actions.map((item) => item.id);
  const outbox = actionIds.length === 0 ? 0 : await prisma.pressureOutboxTask.count({
    where: { runId, sourceId: { in: actionIds } },
  });
  return { actions: actions.length, outbox };
}

async function post(url, cookie, body, extraHeaders = {}) {
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', cookie, ...extraHeaders },
    body: JSON.stringify(body),
  }, 20_000);
  return { response, payload: await response.json().catch(() => null) };
}
