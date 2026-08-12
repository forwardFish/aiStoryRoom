import assert from 'node:assert/strict';

import * as prismaModule from '../../../../apps/api/src/prisma.service';
import * as productRootModule from '../../../../apps/api/src/pressure-chapter/product/product-root';
import * as roomsEntryModule from '../../../../apps/api/src/pressure-chapter/rooms-entry/adapter';
import {
  assertLocalAuthFixtureScope,
  cleanupFixture,
  createFixtureIdentity,
  defaultFixturePath,
  loadPinnedTestEnvironment,
  pressureSoloRunId,
  provisionVerifiedLocalAccount,
  runSoloN1Smoke,
  safeDatabaseTransportSummary,
  safeErrorChain,
  safeFixtureRecord,
  singleConnectionDatabaseUrl,
  writeSafeFixture,
} from './local-auth-fixture.mjs';

const { PrismaService } = ((prismaModule as any).default ?? prismaModule) as typeof import('../../../../apps/api/src/prisma.service');
const { createPressureChapterProductRootV1 } = ((productRootModule as any).default ?? productRootModule) as typeof import('../../../../apps/api/src/pressure-chapter/product/product-root');
const { PressureRoomsEntryAdapter } = ((roomsEntryModule as any).default ?? roomsEntryModule) as typeof import('../../../../apps/api/src/pressure-chapter/rooms-entry/adapter');

const repoRoot = process.cwd();
const pinned = await loadPinnedTestEnvironment(repoRoot);
const scope = assertLocalAuthFixtureScope({
  testEnvironment: pinned.values,
  runtimeEnvironment: process.env,
  operation: 'smoke',
});
assertLocalAuthFixtureScope({
  testEnvironment: pinned.values,
  runtimeEnvironment: process.env,
  operation: 'cleanup',
});

const identity = createFixtureIdentity();
const createdAt = new Date().toISOString();
const account = await provisionVerifiedLocalAccount({ apiBase: scope.apiBase, mailSink: scope.mailSink, identity });
const runId = pressureSoloRunId(account.userId, identity.idempotencyKey);
const fixturePath = defaultFixturePath(repoRoot, identity.marker);
let fixture = safeFixtureRecord({
  identity,
  userId: account.userId,
  runIds: [runId],
  projectFingerprint: scope.projectFingerprint,
  status: 'DIAGNOSING',
  checks: { registered: true, verified: true, sessionAuthenticated: true },
  createdAt,
});
await writeSafeFixture(fixturePath, fixture);

const originalDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = singleConnectionDatabaseUrl(scope.databaseUrl);
process.env.PRESSURE_CHAPTER_WORKER_OWNER = 'independent_worker';
const prisma = new PrismaService();
let outcome = 'UNKNOWN';
let errorChain: ReturnType<typeof safeErrorChain> = [];
let connectionSnapshot: Record<string, number | string> = {};
const databaseTransport = safeDatabaseTransportSummary(scope.databaseUrl);

try {
  await prisma.onModuleInit();
  connectionSnapshot = await safeConnectionSnapshot(prisma);
  const root = await createPressureChapterProductRootV1({ prisma });
  const entry = new PressureRoomsEntryAdapter({ gateway: root.roomsGateway } as never);
  await entry.createSoloShell({
    userId: account.userId,
    worldId: 'sangtian',
    idempotencyKey: identity.idempotencyKey,
  });
  try {
    await entry.start({ runId, userId: account.userId });
    outcome = 'STARTED';
    const smoke = await runSoloN1Smoke({
      apiBase: scope.apiBase,
      cookie: account.cookie,
      identity,
      userId: account.userId,
    });
    assert.equal(smoke.runId, runId);
    fixture = safeFixtureRecord({
      identity,
      userId: account.userId,
      runIds: [runId],
      projectFingerprint: scope.projectFingerprint,
      status: 'PASS',
      checks: { ...fixture.checks, ...smoke.checks },
      evidence: { ...smoke.evidence, connectionSnapshot, databaseTransport },
      createdAt,
    });
  } catch (error) {
    outcome = 'START_FAILED';
    errorChain = safeErrorChain(error);
    fixture = safeFixtureRecord({
      identity,
      userId: account.userId,
      runIds: [runId],
      projectFingerprint: scope.projectFingerprint,
      status: 'DIAGNOSED_FAILURE',
      checks: fixture.checks,
      evidence: { connectionSnapshot, databaseTransport, errorChain },
      createdAt,
    });
  }
  await writeSafeFixture(fixturePath, fixture);
} finally {
  await prisma.onModuleDestroy().catch(() => undefined);
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  const cleanup = await cleanupFixture({ fixture, databaseUrl: scope.databaseUrl, mailSink: scope.mailSink });
  fixture = { ...fixture, status: `${fixture.status}_CLEANED`, cleanup, updatedAt: new Date().toISOString() };
  await writeSafeFixture(fixturePath, fixture);
}

console.log(JSON.stringify({
  status: fixture.status,
  outcome,
  fixturePath,
  runId,
  connectionSnapshot,
  databaseTransport,
  errorChain,
  credentialsPersisted: false,
}, null, 2));
if (outcome !== 'STARTED') process.exitCode = 1;

async function safeConnectionSnapshot(client: InstanceType<typeof PrismaService>): Promise<Record<string, number | string>> {
  const rows = await client.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT
       COUNT(*)::int AS visible_connections,
       COUNT(*) FILTER (WHERE state = 'active')::int AS active_connections,
       COUNT(*) FILTER (WHERE state = 'idle')::int AS idle_connections,
       current_setting('max_connections') AS server_max_connections
     FROM pg_stat_activity
     WHERE datname = current_database()`,
  );
  const row = rows[0] || {};
  return {
    visibleConnections: Number(row.visible_connections || 0),
    activeConnections: Number(row.active_connections || 0),
    idleConnections: Number(row.idle_connections || 0),
    serverMaxConnections: String(row.server_max_connections || 'unknown'),
    prismaConnectionLimit: 1,
    pressureTransactionMaxWaitMs: 10_000,
    pressureTransactionTimeoutMs: 30_000,
  };
}
