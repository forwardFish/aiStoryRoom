import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';

const FIXTURE_SCHEMA = 'pressure_chapter_local_auth_fixture_v1';
const FIXTURE_MARKER = /^pc_[0-9]{13}_[0-9a-f]{16}$/u;
const SENSITIVE_KEY = /(?:password|token|cookie|authorization|secret)/iu;
const PRESSURE_TABLES = Object.freeze([
  'PressureRunLifecycle',
  'PressureRunRouteSnapshot',
  'PressureGenesisCommit',
  'PressureChapterRuntime',
  'PressureDecisionAction',
  'PressureChapterSettlement',
  'PressureFinaleDecision',
  'PressureLegacyTerminalCommit',
  'PressureNarrativeProjection',
  'PressureOutboxTask',
  'PressureReplayCommandReceipt',
  'PressureSeatControlSnapshot',
]);

export async function loadPinnedTestEnvironment(repoRoot = process.cwd()) {
  const envPath = path.resolve(repoRoot, '.env.test');
  const parsed = parseEnv(await readFile(envPath, 'utf8'));
  return { envPath, values: parsed };
}

export function assertLocalAuthFixtureScope({ testEnvironment, runtimeEnvironment = process.env, operation }) {
  assert.equal(runtimeEnvironment.PRESSURE_CHAPTER_ALLOW_AUTH_FIXTURE, '1', 'PRESSURE_CHAPTER_ALLOW_AUTH_FIXTURE must explicitly equal 1');
  assert.equal(runtimeEnvironment.PRESSURE_CHAPTER_TEST_SCOPE, 'non-production', 'PRESSURE_CHAPTER_TEST_SCOPE must explicitly equal non-production');
  assert.equal(runtimeEnvironment.PRESSURE_CHAPTER_DB_SCOPE, 'non-production', 'PRESSURE_CHAPTER_DB_SCOPE must explicitly equal non-production');
  assert.equal(runtimeEnvironment.PRESSURE_CHAPTER_DATABASE_PROVIDER, 'supabase', 'PRESSURE_CHAPTER_DATABASE_PROVIDER must explicitly equal supabase');
  assert.notEqual(testEnvironment.NODE_ENV, 'production', '.env.test must not select production');
  assert.equal(testEnvironment.EMAIL_PROVIDER, 'file-sink', '.env.test must use EMAIL_PROVIDER=file-sink');

  if (operation === 'smoke') {
    assert.equal(runtimeEnvironment.PRESSURE_CHAPTER_ALLOW_E2E_TESTS, '1', 'PRESSURE_CHAPTER_ALLOW_E2E_TESTS must explicitly equal 1');
  }
  if (operation === 'cleanup') {
    assert.equal(runtimeEnvironment.PRESSURE_CHAPTER_ALLOW_FIXTURE_CLEANUP, '1', 'PRESSURE_CHAPTER_ALLOW_FIXTURE_CLEANUP must explicitly equal 1');
  }

  const databaseUrl = String(testEnvironment.DATABASE_URL || '').trim();
  assert.ok(databaseUrl, '.env.test DATABASE_URL is required');
  const parsedDatabase = new URL(databaseUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(parsedDatabase.protocol), '.env.test DATABASE_URL must be PostgreSQL');
  const projectRef = extractSupabaseProjectRef(parsedDatabase);
  assert.ok(projectRef, '.env.test DATABASE_URL must identify an official Supabase project');
  assert.equal(String(testEnvironment.SUPABASE_PROJECT_REF || '').trim().toLowerCase(), projectRef, '.env.test SUPABASE_PROJECT_REF does not match DATABASE_URL');
  const fingerprint = createHash('sha256').update(projectRef, 'utf8').digest('hex');
  assert.match(String(runtimeEnvironment.PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256 || ''), /^[0-9a-f]{64}$/iu, 'PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256 is required');
  assert.equal(fingerprint, runtimeEnvironment.PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256.toLowerCase(), 'Supabase project is not explicitly allowlisted');

  // An explicit runtime-only port allows an isolated candidate API to run
  // beside a developer's existing server without weakening any DB scope gate.
  const apiPort = positivePort(
    runtimeEnvironment.PRESSURE_CHAPTER_TEST_API_PORT
      || testEnvironment.API_PORT,
  );
  const apiBase = `http://127.0.0.1:${apiPort}/api`;
  const mailSink = resolveMailSink(testEnvironment);
  return { apiBase, databaseUrl, mailSink, projectFingerprint: fingerprint };
}

export function createFixtureIdentity(now = Date.now()) {
  const marker = `pc_${now}_${randomBytes(8).toString('hex')}`;
  return {
    marker,
    email: `pressure-${marker}@example.test`,
    nickname: `Pressure acceptance ${marker.slice(-8)}`,
    idempotencyKey: `pc-smoke:${marker}`,
  };
}

export async function provisionVerifiedLocalAccount({ apiBase, mailSink, identity }) {
  assertFixtureIdentity(identity);
  const password = `Pc-${randomBytes(24).toString('base64url')}!`;
  const sinkOffset = await fileSize(mailSink);
  const registered = await apiRequest(apiBase, '/v4/auth/register', {
    method: 'POST',
    body: { email: identity.email, password, nickname: identity.nickname },
    expectedStatuses: [201],
  });
  assert.equal(registered.body?.accepted, true, 'registration was not accepted');
  assert.equal(registered.body?.verificationRequired, true, 'registration did not require verification');
  assert.equal(containsSensitiveResponseField(registered.body), false, 'registration response exposed an authentication secret');

  const verification = await waitForLatestVerificationMail({
    mailSink,
    email: identity.email,
    afterOffset: sinkOffset,
  });
  const verified = await apiRequest(apiBase, '/v4/auth/verify', {
    method: 'POST',
    body: { token: verification.token },
    expectedStatuses: [201],
  });
  assert.equal(verified.body?.verified, true, 'email verification was not accepted');
  assert.equal(containsSensitiveResponseField(verified.body), false, 'verification response exposed an authentication secret');
  const cookie = sessionCookie(verified.setCookies);
  const me = await apiRequest(apiBase, '/v4/auth/me', {
    cookie,
    expectedStatuses: [200],
  });
  assert.equal(me.body?.email, identity.email, 'verified session belongs to a different account');
  assert.equal(me.body?.emailVerified, true, 'verified session is not marked verified');
  assert.ok(typeof me.body?.id === 'string' && me.body.id, 'verified account id is missing');
  return { cookie, userId: me.body.id };
}

export async function runSoloN1Smoke({ apiBase, cookie, identity, userId, timeoutMs = 90_000 }) {
  assertFixtureIdentity(identity);
  const predictedRunId = pressureSoloRunId(userId, identity.idempotencyKey);
  const created = await apiRequest(apiBase, '/v4/rooms/solo', {
    method: 'POST',
    cookie,
    body: {
      worldId: 'sangtian',
      idempotencyKey: identity.idempotencyKey,
      resumeExisting: false,
    },
    expectedStatuses: [200, 201],
    timeoutMs,
  });
  const runId = String(created.body?.runId || created.body?.roomId || created.body?.id || '');
  assert.equal(runId, predictedRunId, 'Solo start returned an unexpected run id');

  const n1 = await waitForProjection({ apiBase, cookie, runId, chapterId: 'N1', timeoutMs });
  assert.equal(n1.schemaVersion, 'pressure_chapter_game_projection_v1');
  assert.equal(n1.route?.participantMode, 'SOLO');
  assert.equal(n1.viewer?.control?.canSubmit, true, 'N1 viewer cannot submit');
  assert.equal(n1.capabilities?.canSubmitDecision, true, 'N1 decision capability is disabled');
  const decision = n1.decision;
  assert.ok(decision?.decisionPointId, 'N1 decision point is missing');
  const option = decision.options?.[0];
  assert.ok(option?.code, 'N1 has no legal option');
  const command = {
    schemaVersion: 'pressure_chapter_game_command_v1',
    commandType: 'SUBMIT_DECISION',
    runId,
    routeHash: n1.route.routeHash,
    chapterRuntimeId: n1.chapter.chapterRuntimeId,
    chapterId: n1.chapter.chapterId,
    decisionPointId: decision.decisionPointId,
    seatId: n1.viewer.seatId,
    controlEpoch: n1.viewer.control.controlEpoch,
    expectedWorkingRevision: decision.expectedWorkingRevision,
    submissionFenceToken: n1.viewer.control.submissionFenceToken,
    idempotencyKey: `pc-action:${identity.marker}`,
    optionCode: option.code,
    customText: null,
    sourceEventId: null,
  };
  const submitted = await apiRequest(apiBase, `/v4/rooms/${encodeURIComponent(runId)}/game/action`, {
    method: 'POST',
    cookie,
    body: command,
    // Nest POST handlers default to 201 when the controller does not override
    // the transport status. The response schema remains the acceptance fence.
    expectedStatuses: [200, 201],
    timeoutMs,
  });
  assert.equal(submitted.body?.schemaVersion, 'pressure_chapter_submit_decision_http_response_v1');
  assert.equal(submitted.body?.idempotencyKey, command.idempotencyKey);

  const readback = await waitForDecisionReadback({
    apiBase,
    cookie,
    runId,
    before: n1,
    timeoutMs,
  });
  return {
    runId,
    checks: {
      startSolo: true,
      n1Projection: true,
      decisionSubmitted: true,
      decisionReadBack: true,
    },
    evidence: {
      chapterBefore: n1.chapter.chapterId,
      workingRevisionBefore: n1.chapter.workingRevision,
      chapterAfter: readback.chapter?.chapterId ?? null,
      workingRevisionAfter: readback.chapter?.workingRevision ?? null,
      decisionPointChanged: readback.decision?.decisionPointId !== decision.decisionPointId,
    },
  };
}

export async function writeSafeFixture(filePath, fixture) {
  assertSafeFixture(fixture);
  const absolute = path.resolve(filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(fixture, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { await chmod(absolute, 0o600); } catch { /* Windows ACLs are outside Node's portable chmod contract. */ }
  return absolute;
}

export async function readSafeFixture(filePath) {
  const fixture = JSON.parse(await readFile(path.resolve(filePath), 'utf8'));
  assertSafeFixture(fixture);
  return fixture;
}

export async function cleanupFixture({ fixture, databaseUrl, mailSink }) {
  assertCleanupFixture(fixture);
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: singleConnectionDatabaseUrl(databaseUrl) } } });
  try {
    const expectedRunId = pressureSoloRunId(fixture.userId, `pc-smoke:${fixture.marker}`);
    const declaredRunIds = [...new Set(fixture.runIds || [])];
    assert.ok(declaredRunIds.every((runId) => runId === expectedRunId), 'fixture declares a run that is not derived from its unique marker');
    const ownedRuns = await prisma.storyRun.findMany({
      where: { ownerUserId: fixture.userId },
      select: { id: true, templateKey: true, createdAt: true },
    });
    assert.ok(ownedRuns.every((run) => run.id === expectedRunId), 'fixture user owns a run outside this unique marker');
    const runIds = [...new Set([...declaredRunIds, ...ownedRuns.map((run) => run.id)])];
    assert.ok(ownedRuns.every((run) => run.templateKey === 'sangtian'), 'fixture user owns a non-Sangtian run');
    assert.ok(ownedRuns.every((run) => run.createdAt >= new Date(fixture.createdAt)), 'fixture user owns a run older than this fixture');

    const lifecycleRows = runIds.length
      ? await prisma.pressureRunLifecycle.findMany({ where: { runId: { in: runIds } }, select: { runId: true, idempotencyKey: true } })
      : [];
    assert.ok(lifecycleRows.every((row) => row.idempotencyKey === `pc-smoke:${fixture.marker}`), 'Pressure lifecycle marker mismatch');

    const user = await prisma.user.findUnique({ where: { id: fixture.userId }, select: { id: true, email: true, createdAt: true } });
    if (user) {
      assert.equal(user.email, fixture.email, 'fixture user email mismatch');
      assert.equal(user.email, `pressure-${fixture.marker}@example.test`, 'fixture user lacks the unique marker');
      assert.ok(user.createdAt >= new Date(fixture.createdAt), 'fixture user predates the fixture');
    }

    const deleted = await prisma.$transaction(async (tx) => {
      const counts = {};
      counts.PressureReplayCommandReceipt = (await tx.pressureReplayCommandReceipt.deleteMany({
        where: { sourceRunId: { in: runIds } },
      })).count;
      counts.PressureDecisionAction = (await tx.pressureDecisionAction.deleteMany({ where: { runId: { in: runIds } } })).count;
      counts.PressureChapterSettlement = (await tx.pressureChapterSettlement.deleteMany({ where: { runId: { in: runIds } } })).count;
      counts.PressureFinaleDecision = (await tx.pressureFinaleDecision.deleteMany({ where: { runId: { in: runIds } } })).count;
      counts.PressureChapterRuntime = (await tx.pressureChapterRuntime.deleteMany({ where: { runId: { in: runIds } } })).count;
      counts.PressureRunRouteSnapshot = (await tx.pressureRunRouteSnapshot.deleteMany({ where: { runId: { in: runIds } } })).count;
      counts.PressureGenesisCommit = (await tx.pressureGenesisCommit.deleteMany({ where: { runId: { in: runIds } } })).count;
      counts.PressureLegacyTerminalCommit = (await tx.pressureLegacyTerminalCommit.deleteMany({ where: { runId: { in: runIds } } })).count;
      counts.PressureNarrativeProjection = (await tx.pressureNarrativeProjection.deleteMany({ where: { runId: { in: runIds } } })).count;
      counts.PressureOutboxTask = (await tx.pressureOutboxTask.deleteMany({ where: { runId: { in: runIds } } })).count;
      counts.PressureSeatControlSnapshot = (await tx.pressureSeatControlSnapshot.deleteMany({ where: { runId: { in: runIds } } })).count;
      counts.PressureRunLifecycle = (await tx.pressureRunLifecycle.deleteMany({ where: { runId: { in: runIds } } })).count;
      counts.StoryRun = (await tx.storyRun.deleteMany({ where: { id: { in: runIds }, ownerUserId: fixture.userId } })).count;
      counts.User = (await tx.user.deleteMany({ where: { id: fixture.userId, email: fixture.email } })).count;
      return counts;
    }, { timeout: 60_000 });

    const [remainingUser, remainingRuns, remainingPressureRows] = await Promise.all([
      prisma.user.count({ where: { id: fixture.userId } }),
      prisma.storyRun.count({ where: { id: { in: runIds } } }),
      countPressureRows(prisma, runIds),
    ]);
    assert.equal(remainingUser, 0, 'fixture user remains after cleanup');
    assert.equal(remainingRuns, 0, 'fixture run remains after cleanup');
    assert.equal(Object.values(remainingPressureRows).reduce((sum, count) => sum + count, 0), 0, 'Pressure fixture rows remain after cleanup');
    await removeFixtureMailBestEffort(mailSink, fixture.email);
    return { runIds, deleted, pressureTables: [...PRESSURE_TABLES] };
  } finally {
    await prisma.$disconnect();
  }
}

export function safeFixtureRecord({ identity, userId, runIds = [], projectFingerprint, status, checks = {}, evidence = {}, createdAt = new Date().toISOString() }) {
  const record = {
    schemaVersion: FIXTURE_SCHEMA,
    marker: identity.marker,
    email: identity.email,
    userId,
    runIds: [...new Set(runIds)],
    databaseProjectFingerprint: projectFingerprint,
    status,
    checks,
    evidence,
    createdAt,
    updatedAt: new Date().toISOString(),
    credentialsPersisted: false,
  };
  assertSafeFixture(record);
  return record;
}

export function assertSafeFixture(fixture) {
  assert.equal(fixture?.schemaVersion, FIXTURE_SCHEMA, 'fixture schema is invalid');
  assert.match(String(fixture.marker || ''), FIXTURE_MARKER, 'fixture marker is invalid');
  assert.equal(fixture.email, `pressure-${fixture.marker}@example.test`, 'fixture email does not match its marker');
  assert.ok(typeof fixture.userId === 'string' && fixture.userId, 'fixture userId is required');
  assert.ok(Array.isArray(fixture.runIds), 'fixture runIds must be an array');
  assert.match(String(fixture.databaseProjectFingerprint || ''), /^[0-9a-f]{64}$/u, 'fixture project fingerprint is invalid');
  assert.equal(fixture.credentialsPersisted, false, 'fixture must state that no credentials were persisted');
  assertNoSensitiveKeys(fixture);
  return fixture;
}

export function assertCleanupFixture(fixture) {
  assertSafeFixture(fixture);
  assert.ok(!Number.isNaN(Date.parse(fixture.createdAt)), 'fixture createdAt is invalid');
  const expectedRunId = pressureSoloRunId(fixture.userId, `pc-smoke:${fixture.marker}`);
  assert.ok(fixture.runIds.every((runId) => runId === expectedRunId), 'fixture runId is not marker-derived');
  return fixture;
}

export function pressureSoloRunId(userId, idempotencyKey) {
  return `solo_${createHash('sha256').update(`${userId}\0${idempotencyKey}`).digest('hex').slice(0, 32)}`;
}

export function singleConnectionDatabaseUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.set('connection_limit', '1');
  parsed.searchParams.set('pool_timeout', '30');
  return parsed.toString();
}

export function safeDatabaseTransportSummary(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const port = parsed.port ? Number(parsed.port) : 5432;
  const isSupabasePooler = /(?:^|\.)pooler\.supabase\.(?:com|co)$/iu.test(parsed.hostname);
  const explicitConnectionLimit = parsed.searchParams.get('connection_limit');
  const explicitPoolTimeoutSeconds = parsed.searchParams.get('pool_timeout');
  return {
    provider: 'supabase',
    transport: isSupabasePooler
      ? port === 6543 ? 'transaction-pooler' : port === 5432 ? 'session-pooler' : 'pooler-unknown-mode'
      : 'direct-or-unknown',
    port,
    explicitConnectionLimit: explicitConnectionLimit && /^[0-9]+$/u.test(explicitConnectionLimit)
      ? Number(explicitConnectionLimit)
      : null,
    explicitPoolTimeoutSeconds: explicitPoolTimeoutSeconds && /^[0-9]+$/u.test(explicitPoolTimeoutSeconds)
      ? Number(explicitPoolTimeoutSeconds)
      : null,
  };
}

export function safeErrorChain(error) {
  const chain = [];
  const seen = new Set();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current) && chain.length < 8) {
    seen.add(current);
    const message = current instanceof Error ? current.message : '';
    const code = typeof current.code === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/u.test(current.code)
      ? current.code
      : null;
    const classification = classifySafeDatabaseError(message, code);
    const summary = safePrismaMessageSummary(message);
    chain.push({
      name: safeDiagnostic(current.name || current.constructor?.name || 'Error'),
      code,
      category: classification.category,
      retryable: classification.retryable,
      ...(typeof current.failedStage === 'string' && /^[A-Z0-9_]{1,80}$/u.test(current.failedStage)
        ? { failedStage: current.failedStage }
        : {}),
      ...(Array.isArray(current.completedStages) && current.completedStages.every((stage) => typeof stage === 'string' && /^[A-Z0-9_]{1,80}$/u.test(stage))
        ? { completedStages: [...current.completedStages] }
        : {}),
      ...(classification.poolSize === null ? {} : { poolSize: classification.poolSize }),
      ...(summary.operation === null ? {} : { operation: summary.operation }),
      ...(summary.detail === null ? {} : { detail: summary.detail }),
      metaKeys: current.meta && typeof current.meta === 'object'
        ? Object.keys(current.meta).filter((key) => !SENSITIVE_KEY.test(key)).sort()
        : [],
    });
    current = current.cause;
  }
  return chain;
}

export function classifySafeDatabaseError(message, code = null) {
  const value = String(message || '');
  const poolSize = Number(/pool_size:\s*([0-9]+)/iu.exec(value)?.[1] || 0) || null;
  if (/EMAXCONNSESSION|max clients reached in session mode/iu.test(value)) {
    return { category: 'SUPABASE_SESSION_POOL_MAX_CLIENTS', retryable: true, poolSize };
  }
  if (code === 'P2028' || /transaction.*(?:closed|expired|timeout)/iu.test(value)) {
    return { category: 'PRISMA_INTERACTIVE_TRANSACTION_TIMEOUT', retryable: true, poolSize: null };
  }
  if (/timed out.*(?:pool|connection)|maxWait/iu.test(value)) {
    return { category: 'PRISMA_CONNECTION_ACQUIRE_TIMEOUT', retryable: true, poolSize: null };
  }
  if (/INTEGRATION_CONTENT_MISMATCH/iu.test(value)) {
    return { category: 'INTEGRATION_CONTENT_MISMATCH', retryable: false, poolSize: null };
  }
  if (/prepared statement.*already exists/iu.test(value)) {
    return { category: 'POOLER_PREPARED_STATEMENT_CONFLICT', retryable: true, poolSize: null };
  }
  if (/Transaction API error|Unable to start a transaction/iu.test(value)) {
    return { category: 'PRISMA_TRANSACTION_START_FAILURE', retryable: true, poolSize: null };
  }
  if (/column .* does not exist|relation .* does not exist/iu.test(value)) {
    return { category: 'DATABASE_SCHEMA_MISMATCH', retryable: false, poolSize: null };
  }
  return {
    category: code || 'UNCLASSIFIED_ERROR',
    retryable: false,
    poolSize: null,
  };
}

export function safePrismaMessageSummary(message) {
  const value = String(message || '');
  const invocation = /Invalid `prisma\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\(\)` invocation/u.exec(value);
  const operation = invocation ? `${invocation[1]}.${invocation[2]}` : null;
  const candidates = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('Invalid `prisma.'));
  const rawDetail = candidates.find((line) => (
    /Error in connector|Transaction API error|FATAL:|ERROR:|does not exist|prepared statement|timed out|closed/iu.test(line)
  )) || null;
  if (!rawDetail) return { operation, detail: null };
  const detail = rawDetail
    .replace(/(?:postgres|postgresql):\/\/[^\s]+/giu, '<redacted-db-url>')
    .replace(/[a-z0-9-]+\.(?:pooler\.)?supabase\.(?:co|com)/giu, '<redacted-supabase-host>')
    .replace(/postgres\.[a-z0-9-]+/giu, 'postgres.<redacted-project>')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '<redacted-email>')
    .replace(/((?:password|token|cookie|authorization|secret)\s*[=:]\s*)[^\s,;]+/giu, '$1<redacted>')
    .replace(/[A-Za-z0-9_-]{40,}/gu, '<redacted-long-value>')
    .slice(0, 400);
  return { operation, detail };
}

export function defaultFixturePath(repoRoot, marker) {
  return path.resolve(repoRoot, 'scripts/acceptance/generated/pressure-chapter/local-auth-fixtures', `${marker}.json`);
}

async function waitForLatestVerificationMail({ mailSink, email, afterOffset, timeoutMs = 15_000 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await readMailSuffix(mailSink, afterOffset);
    const candidates = messages.filter((message) => (
      message?.provider === 'file-sink'
      && message?.to === email
      && String(message?.subject || '').startsWith('Verify your email address')
    ));
    const latest = candidates.sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt))).at(-1);
    if (latest) {
      const match = String(latest.text || '').match(/https?:\/\/\S+/u);
      assert.ok(match, 'verification mail did not contain a URL');
      const token = new URL(match[0]).searchParams.get('token');
      assert.ok(token, 'verification mail did not contain a token');
      return { token };
    }
    await delay(100);
  }
  throw new Error('timed out waiting for the exact fixture verification email');
}

async function readMailSuffix(mailSink, afterOffset) {
  let handle;
  try {
    handle = await open(mailSink, 'r');
    const current = await handle.stat();
    if (current.size <= afterOffset) return [];
    const buffer = Buffer.alloc(current.size - afterOffset);
    await handle.read(buffer, 0, buffer.length, afterOffset);
    return buffer.toString('utf8').split(/\r?\n/u).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  } finally {
    await handle?.close();
  }
}

async function waitForProjection({ apiBase, cookie, runId, chapterId, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const response = await apiRequest(apiBase, `/v4/rooms/${encodeURIComponent(runId)}/game`, {
      cookie,
      expectedStatuses: [200, 404, 409, 503],
      timeoutMs: 20_000,
    });
    last = response;
    if (response.status === 200 && response.body?.chapter?.chapterId === chapterId) return response.body;
    await delay(250);
  }
  throw new Error(`timed out waiting for ${chapterId} projection (last HTTP ${last?.status ?? 'none'})`);
}

async function waitForDecisionReadback({ apiBase, cookie, runId, before, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await apiRequest(apiBase, `/v4/rooms/${encodeURIComponent(runId)}/game`, {
      cookie,
      expectedStatuses: [200],
      timeoutMs: 20_000,
    });
    const body = current.body;
    if (
      body?.chapter?.chapterRuntimeId !== before.chapter.chapterRuntimeId
      || body?.chapter?.workingRevision > before.chapter.workingRevision
      || body?.decision?.decisionPointId !== before.decision?.decisionPointId
    ) return body;
    await delay(250);
  }
  throw new Error('submitted N1 decision was not observable through a fresh game read');
}

async function apiRequest(apiBase, pathname, { method = 'GET', body, cookie, expectedStatuses, timeoutMs = 20_000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(`${apiBase}${pathname}`, {
      method,
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const responseBody = await response.json().catch(() => ({}));
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    if (!expectedStatuses.includes(response.status)) {
      const code = safeDiagnostic(responseBody?.code || responseBody?.error || 'UNEXPECTED_RESPONSE');
      throw new Error(`${method} ${pathname} returned HTTP ${response.status} (${code})`);
    }
    return { status: response.status, body: responseBody, setCookies };
  } finally {
    clearTimeout(timer);
  }
}

function sessionCookie(setCookies) {
  for (const line of setCookies) {
    const match = String(line).match(/(?:^|,\s*)(many_worlds_session=[^;,\s]+)/u);
    if (match) {
      assert.match(String(line), /HttpOnly/iu, 'session cookie is not HttpOnly');
      return match[1];
    }
  }
  throw new Error('verification did not issue the HttpOnly session cookie');
}

function containsSensitiveResponseField(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => SENSITIVE_KEY.test(key) || containsSensitiveResponseField(nested));
}

function assertNoSensitiveKeys(value, pathName = 'fixture') {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    assert.equal(SENSITIVE_KEY.test(key), false, `${pathName}.${key} is a forbidden sensitive field`);
    assertNoSensitiveKeys(nested, `${pathName}.${key}`);
  }
}

function assertFixtureIdentity(identity) {
  assert.match(identity.marker, FIXTURE_MARKER);
  assert.equal(identity.email, `pressure-${identity.marker}@example.test`);
  assert.equal(identity.idempotencyKey, `pc-smoke:${identity.marker}`);
}

function extractSupabaseProjectRef(url) {
  const direct = /^db\.([a-z0-9-]+)\.supabase\.co$/iu.exec(url.hostname)?.[1];
  if (direct) return direct.toLowerCase();
  if (/\.pooler\.supabase\.com$/iu.test(url.hostname)) {
    return /^postgres\.([a-z0-9-]+)$/iu.exec(decodeURIComponent(url.username))?.[1]?.toLowerCase() || null;
  }
  return null;
}

function resolveMailSink(testEnvironment) {
  const configured = String(testEnvironment.AUTH_MAIL_SINK_FILE || '.auth-mail-sink.ndjson');
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);
}

function positivePort(value) {
  const port = Number(value);
  assert.ok(Number.isSafeInteger(port) && port >= 1 && port <= 65_535, '.env.test API_PORT is invalid');
  return port;
}

async function fileSize(filePath) {
  try { return (await stat(filePath)).size; } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
}

async function removeFixtureMailBestEffort(mailSink, email) {
  // Do not rewrite the shared append-only sink: doing so could lose mail from
  // a concurrent test process. Tokens are one-time and the sink is gitignored.
  void mailSink;
  void email;
}

function safeDiagnostic(value) {
  return String(value).replace(/[^A-Za-z0-9_.:-]/gu, '_').slice(0, 120);
}

async function countPressureRows(prisma, runIds) {
  if (runIds.length === 0) return Object.fromEntries(PRESSURE_TABLES.map((table) => [table, 0]));
  // Session-mode Supabase pools are deliberately small. Keep cleanup
  // readback serial so the harness cannot consume a burst of 12 clients.
  const results = [];
  results.push(await prisma.pressureRunLifecycle.count({ where: { runId: { in: runIds } } }));
  results.push(await prisma.pressureRunRouteSnapshot.count({ where: { runId: { in: runIds } } }));
  results.push(await prisma.pressureGenesisCommit.count({ where: { runId: { in: runIds } } }));
  results.push(await prisma.pressureChapterRuntime.count({ where: { runId: { in: runIds } } }));
  results.push(await prisma.pressureDecisionAction.count({ where: { runId: { in: runIds } } }));
  results.push(await prisma.pressureChapterSettlement.count({ where: { runId: { in: runIds } } }));
  results.push(await prisma.pressureFinaleDecision.count({ where: { runId: { in: runIds } } }));
  results.push(await prisma.pressureLegacyTerminalCommit.count({ where: { runId: { in: runIds } } }));
  results.push(await prisma.pressureNarrativeProjection.count({ where: { runId: { in: runIds } } }));
  results.push(await prisma.pressureOutboxTask.count({ where: { runId: { in: runIds } } }));
  results.push(await prisma.pressureReplayCommandReceipt.count({ where: { sourceRunId: { in: runIds } } }));
  results.push(await prisma.pressureSeatControlSnapshot.count({ where: { runId: { in: runIds } } }));
  return Object.fromEntries(PRESSURE_TABLES.map((table, index) => [table, results[index]]));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Narrow acceptance-only exports. These preserve the existing bounded polling
// and HTTP safety behavior without creating a second fixture authority.
export {
  apiRequest as pressureFixtureApiRequest,
  waitForProjection as waitForPressureFixtureProjection,
  waitForDecisionReadback as waitForPressureFixtureDecisionReadback,
};
