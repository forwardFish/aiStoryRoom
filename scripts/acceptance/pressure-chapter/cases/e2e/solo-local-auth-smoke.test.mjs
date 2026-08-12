import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertLocalAuthFixtureScope,
  cleanupFixture,
  createFixtureIdentity,
  loadPinnedTestEnvironment,
  pressureSoloRunId,
  provisionVerifiedLocalAccount,
  runSoloN1Smoke,
  safeFixtureRecord,
} from '../../fixtures/local-auth-fixture.mjs';

test('real local auth fixture starts Solo, reads N1, submits one option, and reads it back', async (t) => {
  if (process.env.PRESSURE_CHAPTER_ALLOW_AUTH_FIXTURE !== '1') {
    t.skip('requires explicit PRESSURE_CHAPTER_ALLOW_AUTH_FIXTURE=1');
    return;
  }
  const pinned = await loadPinnedTestEnvironment();
  const scope = assertLocalAuthFixtureScope({
    testEnvironment: pinned.values,
    runtimeEnvironment: process.env,
    operation: 'smoke',
  });
  const identity = createFixtureIdentity();
  const createdAt = new Date().toISOString();
  let fixture = null;
  try {
    const account = await provisionVerifiedLocalAccount({ apiBase: scope.apiBase, mailSink: scope.mailSink, identity });
    const predictedRunId = pressureSoloRunId(account.userId, identity.idempotencyKey);
    fixture = safeFixtureRecord({
      identity,
      userId: account.userId,
      runIds: [predictedRunId],
      projectFingerprint: scope.projectFingerprint,
      status: 'SOLO_STARTING',
      createdAt,
    });
    const smoke = await runSoloN1Smoke({
      apiBase: scope.apiBase,
      cookie: account.cookie,
      identity,
      userId: account.userId,
    });
    assert.equal(smoke.runId, predictedRunId);
    assert.deepEqual(smoke.checks, {
      startSolo: true,
      n1Projection: true,
      decisionSubmitted: true,
      decisionReadBack: true,
    });
  } finally {
    if (fixture && process.env.PRESSURE_CHAPTER_ALLOW_FIXTURE_CLEANUP === '1') {
      await cleanupFixture({ fixture, databaseUrl: scope.databaseUrl, mailSink: scope.mailSink });
    }
  }
});

