import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  assertLocalAuthFixtureScope,
  cleanupFixture,
  createFixtureIdentity,
  defaultFixturePath,
  loadPinnedTestEnvironment,
  pressureSoloRunId,
  provisionVerifiedLocalAccount,
  readSafeFixture,
  runSoloN1Smoke,
  safeFixtureRecord,
  writeSafeFixture,
} from './fixtures/local-auth-fixture.mjs';

const repoRoot = process.cwd();
const [command = 'smoke', ...args] = process.argv.slice(2);

if (!['provision', 'smoke', 'cleanup'].includes(command)) {
  fail('usage: create-local-auth-fixture.mjs [provision|smoke|cleanup] [--fixture=<ignored-path>] [--cleanup]');
}

const pinned = await loadPinnedTestEnvironment(repoRoot);
const operation = command === 'cleanup' ? 'cleanup' : command === 'smoke' ? 'smoke' : 'provision';
const scope = assertLocalAuthFixtureScope({
  testEnvironment: pinned.values,
  runtimeEnvironment: process.env,
  operation,
});
if (args.includes('--cleanup') && command !== 'cleanup') {
  assertLocalAuthFixtureScope({
    testEnvironment: pinned.values,
    runtimeEnvironment: process.env,
    operation: 'cleanup',
  });
}

if (command === 'cleanup') {
  const fixturePath = requiredFixturePath(args);
  const fixture = await readSafeFixture(fixturePath);
  if (fixture.databaseProjectFingerprint !== scope.projectFingerprint) {
    fail('fixture belongs to a different allowlisted Supabase project');
  }
  try {
    const cleanup = await cleanupFixture({ fixture, databaseUrl: scope.databaseUrl, mailSink: scope.mailSink });
    const cleaned = { ...fixture, status: 'CLEANED', cleanup, updatedAt: new Date().toISOString() };
    await writeSafeFixture(fixturePath, cleaned);
    printSafeSummary(cleaned, fixturePath);
    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ status: 'CLEANUP_FAIL', fixturePath, error: redactError(error), credentialsPersisted: false }, null, 2));
    process.exit(1);
  }
}

const identity = createFixtureIdentity();
const createdAt = new Date().toISOString();
let fixturePath = optionValue(args, '--fixture=') || defaultFixturePath(repoRoot, identity.marker);
fixturePath = path.resolve(fixturePath);
await mkdir(path.dirname(fixturePath), { recursive: true });
let userId = '';
let runIds = [];
let fixture;

try {
  const account = await provisionVerifiedLocalAccount({
    apiBase: scope.apiBase,
    mailSink: scope.mailSink,
    identity,
  });
  userId = account.userId;
  fixture = safeFixtureRecord({
    identity,
    userId,
    runIds,
    projectFingerprint: scope.projectFingerprint,
    status: 'AUTH_READY',
    checks: { registered: true, verified: true, sessionAuthenticated: true },
    createdAt,
  });
  await writeSafeFixture(fixturePath, fixture);

  if (command === 'smoke') {
    const predictedRunId = pressureSoloRunId(userId, identity.idempotencyKey);
    runIds = [predictedRunId];
    fixture = safeFixtureRecord({
      identity,
      userId,
      runIds,
      projectFingerprint: scope.projectFingerprint,
      status: 'SOLO_STARTING',
      checks: fixture.checks,
      createdAt,
    });
    await writeSafeFixture(fixturePath, fixture);
    const smoke = await runSoloN1Smoke({
      apiBase: scope.apiBase,
      cookie: account.cookie,
      identity,
      userId,
    });
    fixture = safeFixtureRecord({
      identity,
      userId,
      runIds: [smoke.runId],
      projectFingerprint: scope.projectFingerprint,
      status: 'PASS',
      checks: { ...fixture.checks, ...smoke.checks },
      evidence: smoke.evidence,
      createdAt,
    });
    await writeSafeFixture(fixturePath, fixture);
  }
} catch (error) {
  if (userId) {
    fixture = safeFixtureRecord({
      identity,
      userId,
      runIds,
      projectFingerprint: scope.projectFingerprint,
      status: 'FAIL',
      checks: fixture?.checks || {},
      evidence: { failure: redactError(error) },
      createdAt,
    });
    await writeSafeFixture(fixturePath, fixture);
  }
  console.error(JSON.stringify({ status: 'FAIL', fixturePath, error: redactError(error), credentialsPersisted: false }, null, 2));
  process.exitCode = 1;
} finally {
  if (args.includes('--cleanup') && fixture && process.env.PRESSURE_CHAPTER_ALLOW_FIXTURE_CLEANUP === '1') {
    try {
      const cleanup = await cleanupFixture({ fixture, databaseUrl: scope.databaseUrl, mailSink: scope.mailSink });
      fixture = { ...fixture, status: fixture.status === 'PASS' ? 'PASS_CLEANED' : 'FAIL_CLEANED', cleanup, updatedAt: new Date().toISOString() };
      await writeSafeFixture(fixturePath, fixture);
    } catch (error) {
      console.error(JSON.stringify({ status: 'CLEANUP_FAIL', fixturePath, error: redactError(error), credentialsPersisted: false }, null, 2));
      process.exitCode = 1;
    }
  }
}

if (fixture) printSafeSummary(fixture, fixturePath);

function requiredFixturePath(values) {
  const value = optionValue(values, '--fixture=');
  if (!value) fail('cleanup requires --fixture=<path>');
  return path.resolve(value);
}

function optionValue(values, prefix) {
  return values.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
}

function printSafeSummary(value, filePath) {
  console.log(JSON.stringify({
    status: value.status,
    fixturePath: filePath,
    marker: value.marker,
    userId: value.userId,
    runIds: value.runIds,
    checks: value.checks,
    credentialsPersisted: false,
  }, null, 2));
}

function redactError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/((?:token|password|cookie|authorization|secret)=)[^\s&]+/giu, '$1<redacted>')
    .slice(0, 500);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
