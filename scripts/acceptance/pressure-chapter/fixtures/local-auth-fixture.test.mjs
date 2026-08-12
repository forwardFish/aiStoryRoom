import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertCleanupFixture,
  assertLocalAuthFixtureScope,
  classifySafeDatabaseError,
  createFixtureIdentity,
  pressureSoloRunId,
  safeFixtureRecord,
  safeErrorChain,
  safeDatabaseTransportSummary,
  safePrismaMessageSummary,
  singleConnectionDatabaseUrl,
  writeSafeFixture,
} from './local-auth-fixture.mjs';

const projectRef = 'safe-test-project';
const projectFingerprint = (await import('node:crypto')).createHash('sha256').update(projectRef).digest('hex');
const testEnvironment = {
  NODE_ENV: 'development',
  API_PORT: '3102',
  DATABASE_URL: `postgresql://postgres:${encodeURIComponent('not-a-real-password')}@db.${projectRef}.supabase.co:5432/postgres`,
  SUPABASE_PROJECT_REF: projectRef,
  EMAIL_PROVIDER: 'file-sink',
};
const runtimeEnvironment = {
  PRESSURE_CHAPTER_ALLOW_AUTH_FIXTURE: '1',
  PRESSURE_CHAPTER_ALLOW_E2E_TESTS: '1',
  PRESSURE_CHAPTER_ALLOW_FIXTURE_CLEANUP: '1',
  PRESSURE_CHAPTER_TEST_SCOPE: 'non-production',
  PRESSURE_CHAPTER_DB_SCOPE: 'non-production',
  PRESSURE_CHAPTER_DATABASE_PROVIDER: 'supabase',
  PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256: projectFingerprint,
};

test('fixture scope requires explicit non-production Supabase and allow flags', () => {
  const scope = assertLocalAuthFixtureScope({ testEnvironment, runtimeEnvironment, operation: 'smoke' });
  assert.equal(scope.projectFingerprint, projectFingerprint);
  assert.match(scope.apiBase, /^http:\/\/127\.0\.0\.1:3102\/api$/u);
  assert.throws(() => assertLocalAuthFixtureScope({
    testEnvironment,
    runtimeEnvironment: { ...runtimeEnvironment, PRESSURE_CHAPTER_ALLOW_AUTH_FIXTURE: '0' },
    operation: 'smoke',
  }), /ALLOW_AUTH_FIXTURE/u);
  assert.throws(() => assertLocalAuthFixtureScope({
    testEnvironment: { ...testEnvironment, NODE_ENV: 'production' },
    runtimeEnvironment,
    operation: 'smoke',
  }), /must not select production/u);
  assert.throws(() => assertLocalAuthFixtureScope({
    testEnvironment: { ...testEnvironment, EMAIL_PROVIDER: 'resend' },
    runtimeEnvironment,
    operation: 'smoke',
  }), /file-sink/u);
});

test('database diagnostics classify pool exhaustion without persisting raw connection details', () => {
  const connection = singleConnectionDatabaseUrl(testEnvironment.DATABASE_URL);
  const parsed = new URL(connection);
  assert.equal(parsed.searchParams.get('connection_limit'), '1');
  assert.equal(parsed.searchParams.get('pool_timeout'), '30');
  const root = new Error('Error in connector: FATAL: (EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15');
  root.name = 'PrismaClientUnknownRequestError';
  const wrapped = new Error('PRESSURE_START_FAILED', { cause: root });
  const chain = safeErrorChain(wrapped);
  assert.equal(chain[1].category, 'SUPABASE_SESSION_POOL_MAX_CLIENTS');
  assert.equal(chain[1].poolSize, 15);
  assert.doesNotMatch(JSON.stringify(chain), /postgresql:\/\/|not-a-real-password/iu);
  assert.deepEqual(classifySafeDatabaseError('INTEGRATION_CONTENT_MISMATCH'), {
    category: 'INTEGRATION_CONTENT_MISMATCH',
    retryable: false,
    poolSize: null,
  });
  const summary = safePrismaMessageSummary('Invalid `prisma.pressureGenesisCommit.create()` invocation:\nError in connector: postgresql://user:password@db.safe-test-project.supabase.co/postgres token=raw-secret');
  assert.equal(summary.operation, 'pressureGenesisCommit.create');
  assert.doesNotMatch(JSON.stringify(summary), /safe-test-project|raw-secret|postgresql:\/\//iu);
});

test('database transport diagnostics expose pool mode without hostname or credentials', () => {
  assert.deepEqual(
    safeDatabaseTransportSummary('postgresql://user:password@aws-0-region.pooler.supabase.com:5432/postgres'),
    {
      provider: 'supabase',
      transport: 'session-pooler',
      port: 5432,
      explicitConnectionLimit: null,
      explicitPoolTimeoutSeconds: null,
    },
  );
  assert.deepEqual(
    safeDatabaseTransportSummary('postgresql://user:password@aws-0-region.pooler.supabase.com:6543/postgres?connection_limit=1&pool_timeout=30'),
    {
      provider: 'supabase',
      transport: 'transaction-pooler',
      port: 6543,
      explicitConnectionLimit: 1,
      explicitPoolTimeoutSeconds: 30,
    },
  );
});

test('safe fixture is marker-derived and cannot contain authentication secrets', async () => {
  const identity = createFixtureIdentity(1_723_456_789_012);
  const userId = 'fixture-user-1';
  const runId = pressureSoloRunId(userId, identity.idempotencyKey);
  const fixture = safeFixtureRecord({
    identity,
    userId,
    runIds: [runId],
    projectFingerprint,
    status: 'PASS',
  });
  assertCleanupFixture(fixture);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pc-safe-fixture-'));
  try {
    const file = await writeSafeFixture(path.join(directory, 'fixture.json'), fixture);
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /password|token|cookie|authorization|secret/iu);
    assert.throws(() => safeFixtureRecord({
      identity,
      userId,
      runIds: [runId],
      projectFingerprint,
      status: 'FAIL',
      evidence: { token: 'forbidden' },
    }), /forbidden sensitive field/u);
    assert.throws(() => assertCleanupFixture({ ...fixture, runIds: ['unrelated-run'] }), /marker-derived/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
