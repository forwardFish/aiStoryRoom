import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PRESSURE_GAME_READ_FIXED_FEED_LIMIT_V1,
  parseGameReadPerformanceAcceptanceConfiguration,
  runGameReadPerformanceAcceptance,
} from '../../game-read-performance-acceptance.mjs';
import {
  assertLocalAuthFixtureScope,
  pressureSoloRunId,
} from '../../fixtures/local-auth-fixture.mjs';

const IDENTITY = Object.freeze({
  marker: 'pc_1700000000000_0123456789abcdef',
  email: 'pressure-pc_1700000000000_0123456789abcdef@example.test',
  nickname: 'Pressure acceptance fixture',
  idempotencyKey: 'pc-smoke:pc_1700000000000_0123456789abcdef',
});
const USER_ID = 'fixture-user-m5c';
const RUN_ID = pressureSoloRunId(USER_ID, IDENTITY.idempotencyKey);
const PROJECT_FINGERPRINT = digest('fixture-project');
const scenarioDigest = (chapterId, mode) => digest(`scenario-${chapterId}-${mode}`);

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

test('default mail sink matches the runtime file-sink working-directory contract', () => {
  const projectRef = 'fixture-project';
  const scope = assertLocalAuthFixtureScope({
    testEnvironment: {
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'file-sink',
      DATABASE_URL: `postgresql://postgres.${projectRef}:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`,
      SUPABASE_PROJECT_REF: projectRef,
      API_PORT: '3113',
    },
    runtimeEnvironment: {
      PRESSURE_CHAPTER_ALLOW_AUTH_FIXTURE: '1',
      PRESSURE_CHAPTER_TEST_SCOPE: 'non-production',
      PRESSURE_CHAPTER_DB_SCOPE: 'non-production',
      PRESSURE_CHAPTER_DATABASE_PROVIDER: 'supabase',
      PRESSURE_CHAPTER_ALLOW_E2E_TESTS: '1',
      PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256: digest(projectRef),
      PRESSURE_CHAPTER_TEST_API_PORT: '3113',
    },
    operation: 'smoke',
  });

  assert.equal(scope.mailSink, path.resolve(process.cwd(), '.auth-mail-sink.ndjson'));
});

function projectionFor(chapterId = 'N1') {
  const isN1 = chapterId === 'N1';
  const seatId = 'zhejiang_governor';
  const decisionPointId = isN1 ? 'decision-n1' : 'decision-n2';
  const eventId = `event-${chapterId}`;
  return {
    schemaVersion: 'pressure_chapter_game_projection_v1',
    projectionVersion: 1,
    roomId: RUN_ID,
    runId: RUN_ID,
    route: {
      routeHash: digest('route'),
      participantMode: 'SOLO',
      runtimeProfile: 'SANGTIAN_CONTINUOUS_CHAPTER_V1',
      contentPackageVersion: 'content-v1',
      controlTopologyVersion: 'control-v1',
    },
    chapter: {
      chapterRuntimeId: isN1 ? 'runtime-n1' : 'runtime-n2',
      chapterId,
      chapterNumber: isN1 ? 1 : 2,
      title: isN1 ? 'N1' : 'N2',
      phase: 'ACTIVE',
      workingRevision: isN1 ? 1 : 2,
    },
    viewer: {
      seatId,
      roleName: '浙江总督',
      control: {
        mode: 'HUMAN_ACTIVE',
        controlEpoch: 1,
        canSubmit: true,
        canReclaim: false,
        submissionFenceToken: isN1 ? 'fence-n1' : 'fence-n2',
        reclaimFenceToken: null,
      },
    },
    metrics: [
      {
        trackId: 'fiscal_military',
        label: '财政军务',
        value: 50,
        displayValue: '50',
        tone: 'DEFAULT',
      },
    ],
    situation: {
      goal: '稳住浙江局势。',
      risk: '财政压力仍在上升。',
      judgment: '需要在本轮作出选择。',
    },
    resources: [
      { resourceId: 'resource-1', label: '官粮', value: 3, displayValue: '3' },
    ],
    tokens: [
      { tokenId: 'token-1', label: '密信', description: '一封密信。', quantity: 1, available: true },
    ],
    decision: {
      decisionPointId,
      mode: 'SOLO_BEAT',
      requirement: 'REQUIRED',
      title: '下一步',
      summary: '请选择下一步。',
      expectedWorkingRevision: isN1 ? 1 : 2,
      options: [
        {
          code: isN1 ? 'OPTION_N1_A' : 'OPTION_N2_A',
          label: '稳住局面',
          description: '先稳住局面。',
          actionType: 'POLICY',
          preferredEntry: 'DEFER',
        },
      ],
      submitLabel: '提交决策',
      customActionAllowed: false,
    },
    capabilities: {
      canSubmitDecision: true,
      canTalk: true,
      canInvestigate: true,
      canUseToken: true,
      canPlan: true,
      canReclaimControl: false,
      allowedActionTypes: ['POLICY'],
    },
    narrative: {
      status: 'PUBLISHED',
      projectionKind: 'CHAPTER_NARRATIVE',
      sourceAuthority: 'CHAPTER_WORKING',
      sourceId: `narrative-${chapterId}`,
      sourceCommitHash: digest(`narrative-commit-${chapterId}`),
      text: `Narrative ${chapterId}`,
      contentHash: digest(`narrative-content-${chapterId}`),
      renderMode: 'AUTHORED_FALLBACK',
    },
    feedPage: {
      schemaVersion: 'a_emotion_feed_page_v1',
      roomId: RUN_ID,
      runId: RUN_ID,
      viewerSeatId: seatId,
      items: [
        {
          schemaVersion: 'a_emotion_viewer_projection_v1',
          eventId,
          projectionVersion: 1,
          roomId: RUN_ID,
          runId: RUN_ID,
          viewerSeatId: seatId,
          category: 'RELATED',
          disclosure: 'CONFIRMED',
          severity: 'MINOR',
          title: '局势变化',
          safeSummary: '一项公开局势发生变化。',
          statusLabel: '已确认',
          visibleImpacts: [],
          knownFactRefs: [],
          responseOptions: [],
          recommendedPresentation: 'FEED_ONLY',
          centerCard: null,
          keyModal: null,
          eventSequence: 1,
          occurredAt: '2026-08-15T00:00:00.000Z',
          projectionHash: digest(`feed-${chapterId}`),
          isUnread: true,
          isAcknowledged: false,
          isResolved: false,
        },
      ],
      unreadCount: 1,
      nextCursor: null,
      serverSequence: 1,
    },
    projectionHash: digest(`projection-${chapterId}`),
  };
}

function observationFor({ mode, ordinal, submitted, options }) {
  const overrideMode = options.observationModeAt?.[ordinal] ?? mode;
  const observedScenarioDigest = options.mixedScenarioAt?.has(ordinal)
    ? digest(`mixed-${mode}-${ordinal}`)
    : scenarioDigest(submitted ? 'n2' : 'n1', mode);
  const wallTimeMs = 3 + ordinal;
  return {
    schemaVersion: 'pressure_game_read_observation_v1',
    mode: overrideMode,
    shadowStatus: overrideMode === 'SHADOW'
      ? options.shadowStatusAt?.[ordinal] ?? options.shadowStatus ?? 'MATCH'
      : 'NOT_RUN',
    outcome: 'SUCCESS',
    requestDigest: digest(`request-${mode}-${ordinal}`),
    scenarioDigest: observedScenarioDigest,
    startedAtMs: 1_000 + ordinal * 100,
    finishedAtMs: 1_000 + ordinal * 100 + wallTimeMs,
    wallTimeMs,
    metrics: {
      applicationSqlStatementCount: 1,
      databaseProtocolRoundtripCountIncludingBeginCommit: 1,
      transactionAttemptCount: 0,
      committedTransactionCount: 0,
      rolledBackTransactionCount: 0,
      transactionRetryCount: 0,
      queryDurationMs: wallTimeMs / 2,
      queryHashes: [digest(`query-${mode}-${ordinal}`)],
    },
    observabilityFailure: options.observabilityFailureAt?.has(ordinal) ?? false,
  };
}

async function startModeServer({ mode, logPath = null, shared, options = {} }) {
  const counters = { solo: 0, game: 0, action: 0, gameQueries: [], cookies: [] };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'POST' && url.pathname === '/api/v4/rooms/solo') {
        counters.solo += 1;
        await readRequestBody(request);
        return json(response, 201, { runId: RUN_ID });
      }
      if (request.method === 'GET' && url.pathname === `/api/v4/rooms/${RUN_ID}/game`) {
        counters.game += 1;
        counters.gameQueries.push(url.search);
        counters.cookies.push(request.headers.cookie ?? null);
        const ordinal = counters.game;
        const status = options.gameStatusAt?.[ordinal] ?? 200;
        if (logPath && !options.omitObservationAt?.has(ordinal)) {
          const observation = observationFor({ mode, ordinal, submitted: shared.submitted, options });
          await appendFile(logPath, `${JSON.stringify(observation)}\n`, 'utf8');
        }
        if (status !== 200) return json(response, status, { code: `GAME_${status}` });
        const projection = structuredClone(projectionFor(shared.submitted ? 'N2' : 'N1'));
        options.mutateProjection?.({ projection, ordinal, submitted: shared.submitted });
        return json(response, 200, projection);
      }
      if (request.method === 'POST' && url.pathname === `/api/v4/rooms/${RUN_ID}/game/action`) {
        counters.action += 1;
        const body = await readRequestBody(request);
        if (options.submitStatus && options.submitStatus !== 201) {
          return json(response, options.submitStatus, { code: 'SUBMIT_REJECTED' });
        }
        shared.submitted = true;
        return json(response, 201, {
          schemaVersion: 'pressure_chapter_submit_decision_http_response_v1',
          idempotencyKey: body.idempotencyKey,
        });
      }
      return json(response, 404, { code: 'NOT_FOUND' });
    } catch (error) {
      return json(response, 500, { code: 'FAKE_SERVER_ERROR' });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    apiBase: `http://127.0.0.1:${address.port}/api`,
    counters,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

async function createHarness({
  replay = {},
  shadow = {},
  fast = {},
  withObservationLogs = true,
  warmSampleCount = 10,
  cleanupError = null,
  provisionError = null,
  timeoutMs = 2_000,
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pressure-m5c-'));
  const logPaths = {
    REPLAY: withObservationLogs ? path.join(directory, 'replay.ndjson') : null,
    SHADOW: withObservationLogs ? path.join(directory, 'shadow.ndjson') : null,
    FAST: withObservationLogs ? path.join(directory, 'fast.ndjson') : null,
  };
  if (withObservationLogs) {
    await Promise.all(Object.values(logPaths).map((filePath) => writeFile(filePath, '', 'utf8')));
  }
  const shared = { submitted: false };
  const servers = {
    REPLAY: await startModeServer({ mode: 'REPLAY', logPath: logPaths.REPLAY, shared, options: replay }),
    SHADOW: await startModeServer({ mode: 'SHADOW', logPath: logPaths.SHADOW, shared, options: shadow }),
    FAST: await startModeServer({ mode: 'FAST', logPath: logPaths.FAST, shared, options: fast }),
  };
  const calls = {
    loadScope: 0,
    provision: 0,
    cleanup: 0,
    provisionStartedAtMs: null,
    fixtureCreatedAtMs: null,
  };
  const secretCookie = 'session=secret-cookie-material';
  const secretPassword = 'secret-password-material';
  const secretVerificationToken = 'secret-verification-token-material';
  const secretDatabaseUrl = ['postgresql://', 'sensitive-user:sensitive-pass@db.example.test:5432/test'].join('');
  const dependencies = {
    async loadScope() {
      calls.loadScope += 1;
      return {
        databaseUrl: secretDatabaseUrl,
        mailSink: path.join(directory, 'mail.ndjson'),
        projectFingerprint: PROJECT_FINGERPRINT,
      };
    },
    createIdentity() {
      return { ...IDENTITY, nickname: `${IDENTITY.nickname}-${secretPassword.length}-${secretVerificationToken.length}` };
    },
    async provision() {
      calls.provision += 1;
      calls.provisionStartedAtMs = Date.now();
      if (provisionError) throw provisionError;
      return { cookie: secretCookie, userId: USER_ID };
    },
    makeFixture(input) {
      calls.fixtureCreatedAtMs = Date.parse(input.createdAt);
      return { ...input };
    },
    async cleanup() {
      calls.cleanup += 1;
      if (cleanupError) throw cleanupError;
    },
  };
  const configuration = {
    repoRoot: process.cwd(),
    apiBases: {
      REPLAY: servers.REPLAY.apiBase,
      SHADOW: servers.SHADOW.apiBase,
      FAST: servers.FAST.apiBase,
    },
    observationLogPaths: logPaths,
    warmSampleCount,
    timeoutMs,
    feedLimit: PRESSURE_GAME_READ_FIXED_FEED_LIMIT_V1,
  };
  return {
    configuration,
    dependencies,
    calls,
    servers,
    secrets: [secretCookie, secretPassword, secretVerificationToken, secretDatabaseUrl],
    async close() {
      await Promise.all(Object.values(servers).map((server) => server.close()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function runHarness(options) {
  const harness = await createHarness(options);
  try {
    const result = await runGameReadPerformanceAcceptance(harness.configuration, harness.dependencies);
    return { result, harness };
  } catch (error) {
    await harness.close();
    throw error;
  }
}

test('equal REPLAY/SHADOW/FAST passes, uses one run, exactly 1 cold + 10 warm, M5A nearest-rank summary, and cleanup', async () => {
  const { result, harness } = await runHarness();
  try {
    assert.equal(result.status, 'PASS_CLEANED');
    assert.equal(result.failedStage, null);
    assert.equal(result.equivalence.deepEqual, true);
    assert.equal(result.equivalence.canonicalJsonEqual, true);
    assert.deepEqual(result.equivalence.explicit, {
      projectionHash: true,
      seat: true,
      routeHash: true,
      chapterRuntimeId: true,
      workingRevision: true,
      narrativeSource: true,
      capabilities: true,
      resources: true,
      tokens: true,
      decisionOptions: true,
      feedAudience: true,
    });
    assert.equal(result.sampling.coldSampleCount, 1);
    assert.equal(result.sampling.warmSampleCount, 10);
    assert.equal(result.sampling.clientWarmWallTimeMs.count, 10);
    assert.equal(result.sampling.observation.provided, true);
    assert.equal(result.sampling.observation.summary.status, 'READY');
    assert.equal(result.sampling.observation.summary.percentileMethod, 'NEAREST_RANK');
    assert.equal(result.sampling.observation.summary.coldSampleCount, 1);
    assert.equal(result.sampling.observation.summary.warmSampleCount, 10);
    assert.equal(result.transition.decisionSubmitted, true);
    assert.equal(result.transition.decisionReadBack, true);
    assert.equal(harness.servers.REPLAY.counters.solo, 1);
    assert.equal(harness.servers.REPLAY.counters.game, 2, 'one bounded N1 wait + one comparison GET');
    assert.equal(harness.servers.SHADOW.counters.game, 1);
    assert.equal(harness.servers.FAST.counters.game, 13, 'one comparison + one cold + ten warm + one readback');
    assert.equal(harness.servers.FAST.counters.action, 1);
    assert.deepEqual(harness.servers.REPLAY.counters.gameQueries, ['', '?feedLimit=10']);
    assert.deepEqual(harness.servers.SHADOW.counters.gameQueries, ['?feedLimit=10']);
    assert.deepEqual(harness.servers.FAST.counters.gameQueries, [
      ...Array.from({ length: 12 }, () => '?feedLimit=10'),
      '',
    ]);
    const allCookies = Object.values(harness.servers).flatMap((server) => server.counters.cookies);
    assert.equal(new Set(allCookies).size, 1, 'every mode used the same in-memory identity cookie');
    assert.equal(harness.calls.provision, 1);
    assert.equal(harness.calls.cleanup, 1);
    assert.ok(
      harness.calls.fixtureCreatedAtMs <= harness.calls.provisionStartedAtMs,
      'fixture cleanup boundary must be captured before account provisioning starts',
    );
  } finally {
    await harness.close();
  }
});

test('any deep public field difference fails at compare and still cleans the fixture', async () => {
  const { result, harness } = await runHarness({
    shadow: {
      mutateProjection({ projection }) {
        projection.tokens[0].quantity = 2;
      },
    },
    withObservationLogs: false,
  });
  try {
    assert.equal(result.status, 'FAIL_CLEANED');
    assert.equal(result.failedStage, 'compare');
    assert.equal(result.failureCode, 'PROJECTION_COMPARISON_FAILED');
    assert.equal(harness.servers.FAST.counters.game, 1, 'sampling must not start after comparison failure');
    assert.equal(harness.calls.cleanup, 1);
  } finally {
    await harness.close();
  }
});

test('SHADOW observation other than MATCH fails at shadow and does not sample FAST', async () => {
  const { result, harness } = await runHarness({
    shadow: { shadowStatus: 'MISMATCH' },
  });
  try {
    assert.equal(result.status, 'FAIL_CLEANED');
    assert.equal(result.failedStage, 'shadow');
    assert.equal(result.failureCode, 'SHADOW_OBSERVATION_NOT_MATCH');
    assert.equal(harness.servers.FAST.counters.game, 0);
    assert.equal(harness.calls.cleanup, 1);
  } finally {
    await harness.close();
  }
});

test('fewer than ten configured warm samples fails at warm without any automatic expansion', async () => {
  const { result, harness } = await runHarness({
    withObservationLogs: false,
    warmSampleCount: 9,
  });
  try {
    assert.equal(result.status, 'FAIL_CLEANED');
    assert.equal(result.failedStage, 'warm');
    assert.equal(result.failureCode, 'INSUFFICIENT_WARM_SAMPLE_CONFIGURATION');
    assert.equal(harness.servers.FAST.counters.game, 1, 'only the FAST comparison GET may run');
    assert.equal(harness.calls.cleanup, 1);
  } finally {
    await harness.close();
  }
});

test('mixed FAST scenarios and observabilityFailure each fail at warm', async (t) => {
  await t.test('mixed scenario', async () => {
    const { result, harness } = await runHarness({
      fast: { mixedScenarioAt: new Set([5]) },
    });
    try {
      assert.equal(result.status, 'FAIL_CLEANED');
      assert.equal(result.failedStage, 'warm');
      assert.equal(result.failureCode, 'FAST_SAMPLING_FAILED');
      assert.ok(harness.servers.FAST.counters.game < 13, 'runner must stop at the failing sample');
      assert.equal(harness.calls.cleanup, 1);
    } finally {
      await harness.close();
    }
  });

  await t.test('observer failure', async () => {
    const { result, harness } = await runHarness({
      fast: { observabilityFailureAt: new Set([4]) },
    });
    try {
      assert.equal(result.status, 'FAIL_CLEANED');
      assert.equal(result.failedStage, 'warm');
      assert.equal(result.failureCode, 'FAST_SAMPLING_FAILED');
      assert.ok(harness.servers.FAST.counters.game < 13, 'runner must stop at the failing sample');
      assert.equal(harness.calls.cleanup, 1);
    } finally {
      await harness.close();
    }
  });

  await t.test('cross-mode observation', async () => {
    const { result, harness } = await runHarness({
      fast: { observationModeAt: { 4: 'REPLAY' } },
    });
    try {
      assert.equal(result.status, 'FAIL_CLEANED');
      assert.equal(result.failedStage, 'warm');
      assert.equal(result.failureCode, 'FAST_SAMPLING_FAILED');
      assert.ok(harness.servers.FAST.counters.game < 13, 'runner must stop at the cross-mode sample');
      assert.equal(harness.calls.cleanup, 1);
    } finally {
      await harness.close();
    }
  });

  await t.test('missing tenth warm observation', async () => {
    const { result, harness } = await runHarness({
      fast: { omitObservationAt: new Set([12]) },
      timeoutMs: 350,
    });
    try {
      assert.equal(result.status, 'FAIL_CLEANED');
      assert.equal(result.failedStage, 'warm');
      assert.equal(result.failureCode, 'FAST_SAMPLING_FAILED');
      assert.equal(harness.servers.FAST.counters.game, 12,
        'runner must not auto-add another GET to replace the missing tenth warm observation');
      assert.equal(result.sampling.warmSampleCount, 9);
      assert.equal(result.sampling.warmSampleCountConfigured, 10);
      assert.equal(harness.calls.cleanup, 1);
    } finally {
      await harness.close();
    }
  });
});

test('submit and readback errors retain exact stage ownership', async (t) => {
  await t.test('submit failure', async () => {
    const { result, harness } = await runHarness({
      fast: { submitStatus: 422 },
      withObservationLogs: false,
    });
    try {
      assert.equal(result.status, 'FAIL_CLEANED');
      assert.equal(result.failedStage, 'submit');
      assert.equal(result.failureCode, 'DECISION_SUBMIT_FAILED');
      assert.equal(harness.servers.FAST.counters.action, 1);
      assert.equal(harness.servers.FAST.counters.game, 12, 'no readback GET after submit rejection');
      assert.equal(harness.calls.cleanup, 1);
    } finally {
      await harness.close();
    }
  });

  await t.test('readback failure', async () => {
    const { result, harness } = await runHarness({
      fast: { gameStatusAt: { 13: 500 } },
      withObservationLogs: false,
    });
    try {
      assert.equal(result.status, 'FAIL_CLEANED');
      assert.equal(result.failedStage, 'readback');
      assert.equal(result.failureCode, 'DECISION_READBACK_FAILED');
      assert.equal(harness.servers.FAST.counters.action, 1);
      assert.equal(harness.servers.FAST.counters.game, 13);
      assert.equal(harness.calls.cleanup, 1);
    } finally {
      await harness.close();
    }
  });
});

test('sanitized result does not contain cookie, password, verification token, or connection string values', async () => {
  const { result, harness } = await runHarness({ withObservationLogs: false });
  try {
    const serialized = JSON.stringify(result);
    for (const secret of harness.secrets) {
      assert.equal(serialized.includes(secret), false, `secret leaked into result: ${secret.slice(0, 8)}`);
    }
    assert.equal(result.fixture.credentialsPersisted, false);
    assert.equal(result.fixture.cookiePersisted, false);
  } finally {
    await harness.close();
  }
});

test('cleanup failure independently changes the terminal status to CLEANUP_FAIL', async (t) => {
  await t.test('after an otherwise successful workflow', async () => {
    const { result, harness } = await runHarness({
      withObservationLogs: false,
      cleanupError: new Error('cleanup database unavailable'),
    });
    try {
      assert.equal(result.status, 'CLEANUP_FAIL');
      assert.equal(result.failedStage, 'cleanup');
      assert.equal(result.cleanupFailure.stage, 'cleanup');
      assert.equal(result.cleanupFailure.code, 'CLEANUP_FAILED');
      assert.equal(result.workflowFailure, null);
      assert.equal(harness.calls.cleanup, 1);
    } finally {
      await harness.close();
    }
  });

  await t.test('while preserving the original workflow failure stage', async () => {
    const { result, harness } = await runHarness({
      shadow: {
        mutateProjection({ projection }) {
          projection.tokens[0].quantity = 2;
        },
      },
      withObservationLogs: false,
      cleanupError: new Error('cleanup database unavailable'),
    });
    try {
      assert.equal(result.status, 'CLEANUP_FAIL');
      assert.equal(result.failedStage, 'cleanup');
      assert.deepEqual(result.workflowFailure, {
        stage: 'compare',
        code: 'PROJECTION_COMPARISON_FAILED',
      });
      assert.equal(result.cleanupFailure.code, 'CLEANUP_FAILED');
      assert.equal(harness.calls.cleanup, 1);
    } finally {
      await harness.close();
    }
  });
});

test('a failed replay stage is not retried as a whole workflow', async () => {
  const { result, harness } = await runHarness({
    replay: { gameStatusAt: { 2: 500 } },
    withObservationLogs: false,
  });
  try {
    assert.equal(result.status, 'FAIL_CLEANED');
    assert.equal(result.failedStage, 'replay');
    assert.equal(harness.calls.loadScope, 1);
    assert.equal(harness.calls.provision, 1);
    assert.equal(harness.servers.REPLAY.counters.solo, 1);
    assert.equal(harness.servers.REPLAY.counters.game, 2, 'failed replay comparison was not retried');
    assert.equal(harness.servers.SHADOW.counters.game, 0);
    assert.equal(harness.servers.FAST.counters.game, 0);
    assert.equal(harness.calls.cleanup, 1);
  } finally {
    await harness.close();
  }
});

test('configuration parser accepts env or arguments, requires isolated loopback APIs, and rejects warm samples below ten', () => {
  const parsed = parseGameReadPerformanceAcceptanceConfiguration({
    argv: [
      '--replay-api-base=http://127.0.0.1:3101/api',
      '--shadow-api-base=http://127.0.0.1:3102/api',
      '--fast-api-base=http://127.0.0.1:3103/api',
      '--warm-samples=10',
    ],
    environment: {},
    repoRoot: '/tmp/repo',
  });
  assert.equal(parsed.warmSampleCount, 10);
  assert.equal(parsed.feedLimit, 10);
  assert.throws(() => parseGameReadPerformanceAcceptanceConfiguration({
    argv: [
      '--replay-api-base=http://127.0.0.1:3101/api',
      '--shadow-api-base=http://127.0.0.1:3102/api',
      '--fast-api-base=http://127.0.0.1:3103/api',
      '--warm-samples=9',
    ],
    environment: {},
  }), /warm sample count/u);
  assert.throws(() => parseGameReadPerformanceAcceptanceConfiguration({
    argv: [
      '--replay-api-base=http://127.0.0.1:3101/api',
      '--shadow-api-base=http://127.0.0.1:3101/api',
      '--fast-api-base=http://127.0.0.1:3103/api',
    ],
    environment: {},
  }), /isolated origins/u);
});
