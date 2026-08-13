import assert from 'node:assert/strict';
import test from 'node:test';

import {
  encodeRoomPath,
  normalizeBaseUrl,
  readJsonFixture,
  requestJson,
  requireFixtureString,
  skipUnlessEnvironment,
} from '../../lib/live-fixture.mjs';

const ENV = [
  'PRESSURE_CHAPTER_ALLOW_MODAL_TRIGGER_TESTS',
  'PRESSURE_CHAPTER_TEST_SCOPE',
  'PRESSURE_CHAPTER_DB_SCOPE',
  'PRESSURE_CHAPTER_DATABASE_PROVIDER',
  'DATABASE_URL',
  'PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256',
  'PRESSURE_CHAPTER_TEST_BASE_URL',
  'PRESSURE_MODAL_TRIGGER_SOLO_AUTH_FIXTURE',
];

test('real Solo run proves five decision-automation actions and zero PromptExecutionRecord rows', { timeout: 60_000 }, async (t) => {
  if (skipUnlessEnvironment(t, ENV)) return;
  assert.equal(process.env.PRESSURE_CHAPTER_ALLOW_MODAL_TRIGGER_TESTS, '1');
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

  const fixture = await readJsonFixture(
    process.env.PRESSURE_MODAL_TRIGGER_SOLO_AUTH_FIXTURE,
    'PRESSURE_MODAL_TRIGGER_SOLO_AUTH_FIXTURE',
  );
  assert.deepEqual(
    Object.keys(fixture).sort(),
    ['cookie', 'runId', 'schemaVersion'],
    'Solo fixture may provide authentication and run identity only; counts/traces must be read from runtime and DB',
  );
  assert.equal(fixture.schemaVersion, 'pressure_modal_trigger_solo_auth_fixture_v1');
  const runId = requireFixtureString(fixture, 'runId');
  const cookie = requireFixtureString(fixture, 'cookie');

  const baseUrl = normalizeBaseUrl(process.env.PRESSURE_CHAPTER_TEST_BASE_URL);
  const live = await requestJson(baseUrl, encodeRoomPath(runId), { cookie, timeoutMs: 15_000 });
  assert.ok(live.response.ok, `authenticated Solo run is not readable: HTTP ${live.response.status}`);
  assert.equal(live.payload?.runId, runId);
  assert.equal(live.payload?.route?.participantMode, 'SOLO');

  const actions = await prisma.pressureDecisionAction.findMany({
    where: { runId },
    select: {
      id: true,
      decisionPointId: true,
      seatId: true,
      payloadJson: true,
      payloadHash: true,
      authorityEventHash: true,
      status: true,
    },
    orderBy: [{ decisionPointId: 'asc' }, { seatId: 'asc' }, { id: 'asc' }],
  });
  const automation = actions.filter((row) => row.payloadJson?.source === 'CONTENT_OWNED_AI_POLICY');
  assert.ok(automation.length >= 5, 'run has no complete five-seat decision automation trace');
  const byDecision = new Map();
  for (const row of automation) {
    const rows = byDecision.get(row.decisionPointId) ?? [];
    rows.push(row);
    byDecision.set(row.decisionPointId, rows);
  }
  const complete = [...byDecision.entries()].filter(([, rows]) => new Set(rows.map((row) => row.seatId)).size === 5);
  assert.ok(complete.length > 0, 'no decision point contains five distinct deterministic AI actions');
  for (const [, rows] of complete) {
    assert.equal(rows.length, 5, 'decision automation wrote duplicate actions for an AI seat');
    for (const row of rows) {
      assert.equal(row.status, 'SEALED');
      assert.match(row.payloadHash, /^[a-f0-9]{64}$/u);
      assert.match(row.authorityEventHash, /^[a-f0-9]{64}$/u);
      assert.equal(typeof row.payloadJson.policyRef, 'string');
      assert.match(String(row.payloadJson.policyHash ?? ''), /^[a-f0-9]{64}$/u);
      assert.match(String(row.payloadJson.selectionHash ?? ''), /^[a-f0-9]{64}$/u);
    }
  }

  const [promptExecutions, soloProviderCalls] = await Promise.all([
    prisma.promptExecutionRecord.count({ where: { runId } }),
    prisma.soloGenerationAttempt.aggregate({
      where: { runId },
      _sum: { providerCallCount: true },
      _count: { _all: true },
    }),
  ]);
  assert.equal(promptExecutions, 0, 'deterministic AI created PromptExecutionRecord rows');
  assert.equal(soloProviderCalls._sum.providerCallCount ?? 0, 0, 'deterministic AI incremented providerCallCount');
});
