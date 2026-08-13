import assert from 'node:assert/strict';

import {
  assertLocalAuthFixtureScope,
  cleanupFixture,
  createFixtureIdentity,
  loadPinnedTestEnvironment,
  pressureSoloRunId,
  provisionVerifiedLocalAccount,
  safeFixtureRecord,
} from './fixtures/local-auth-fixture.mjs';

const STORY_COUNT = 5;
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
  const account = await provisionVerifiedLocalAccount({
    apiBase: scope.apiBase,
    mailSink: scope.mailSink,
    identity,
  });
  const runId = pressureSoloRunId(account.userId, identity.idempotencyKey);
  fixture = safeFixtureRecord({
    identity,
    userId: account.userId,
    runIds: [runId],
    projectFingerprint: scope.projectFingerprint,
    status: 'FIVE_STORY_RUNNING',
    createdAt,
  });
  const created = await request('/v4/rooms/solo', {
    method: 'POST',
    cookie: account.cookie,
    body: {
      worldId: 'sangtian',
      idempotencyKey: identity.idempotencyKey,
      resumeExisting: false,
    },
    statuses: [200, 201],
    timeoutMs: 90_000,
  });
  assert.equal(created.body?.runId ?? created.body?.roomId ?? created.body?.id, runId);

  const stories = [];
  let projection = await waitForPlayableProjection(account.cookie, runId, null, 120_000);
  for (let index = 0; index < STORY_COUNT; index += 1) {
    const before = projection;
    const selected = selectMeaningfulOption(before, index);
    const command = decisionCommand(before, runId, selected, identity.marker, index);
    const submitted = await request(`/v4/rooms/${encodeURIComponent(runId)}/game/action`, {
      method: 'POST',
      cookie: account.cookie,
      body: command,
      statuses: [200],
      timeoutMs: 120_000,
    });
    assert.equal(submitted.body?.schemaVersion, 'pressure_chapter_submit_decision_http_response_v1');
    projection = await waitForPlayableProjection(
      account.cookie,
      runId,
      before,
      180_000,
    );
    stories.push({
      sequence: index + 1,
      action: {
        chapterId: before.chapter.chapterId,
        decisionPointId: before.decision.decisionPointId,
        optionCode: selected.code,
        actionType: selected.actionType,
        label: selected.label,
      },
      result: {
        chapterId: projection.chapter.chapterId,
        workingRevision: projection.chapter.workingRevision,
        narrative: projection.narrative,
        decision: projection.decision,
        situation: projection.situation,
      },
    });
  }
  console.log(JSON.stringify({
    status: 'PASS',
    flow: 'REAL_HTTP_SOLO_SETTLEMENT_PROJECTION',
    storyCount: stories.length,
    stories,
    credentialsPersisted: false,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: 'FAIL',
    error: safeError(error),
    credentialsPersisted: false,
  }, null, 2));
  process.exitCode = 1;
} finally {
  if (fixture && process.env.PRESSURE_CHAPTER_ALLOW_FIXTURE_CLEANUP === '1') {
    await cleanupFixture({
      fixture,
      databaseUrl: scope.databaseUrl,
      mailSink: scope.mailSink,
    });
  }
}

function selectMeaningfulOption(projection, index) {
  const options = projection.decision?.options ?? [];
  assert.ok(options.length > 0, `chapter ${projection.chapter?.chapterId} has no options`);
  if (index === 0) {
    const support = options.find((option) => option.actionType === 'SUPPORT_WEIR');
    if (support) return support;
  }
  const meaningful = options.filter((option) => option.actionType !== 'DEFAULT_PASS');
  return meaningful[index % meaningful.length] ?? options[0];
}

function decisionCommand(projection, runId, option, marker, index) {
  return {
    schemaVersion: 'pressure_chapter_game_command_v1',
    commandType: 'SUBMIT_DECISION',
    runId,
    routeHash: projection.route.routeHash,
    chapterRuntimeId: projection.chapter.chapterRuntimeId,
    chapterId: projection.chapter.chapterId,
    decisionPointId: projection.decision.decisionPointId,
    seatId: projection.viewer.seatId,
    controlEpoch: projection.viewer.control.controlEpoch,
    expectedWorkingRevision: projection.decision.expectedWorkingRevision,
    submissionFenceToken: projection.viewer.control.submissionFenceToken,
    idempotencyKey: `pc-five:${marker}:${index + 1}`,
    optionCode: option.code,
    customText: null,
    sourceEventId: null,
  };
}

async function waitForPlayableProjection(cookie, runId, before, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const response = await request(`/v4/rooms/${encodeURIComponent(runId)}/game`, {
      cookie,
      statuses: [200, 404, 409, 503],
      timeoutMs: 25_000,
    });
    last = response;
    const body = response.body;
    const progressed = !before
      || body?.chapter?.chapterRuntimeId !== before.chapter.chapterRuntimeId
      || body?.chapter?.workingRevision > before.chapter.workingRevision
      || body?.decision?.decisionPointId !== before.decision?.decisionPointId;
    if (response.status === 200
      && body?.schemaVersion === 'pressure_chapter_game_projection_v1'
      && body?.viewer?.control?.canSubmit === true
      && body?.decision?.options?.length > 0
      && progressed) return body;
    await delay(500);
  }
  throw new Error(`projection timeout after ${timeoutMs}ms; last HTTP ${last?.status ?? 'none'}`);
}

async function request(pathname, { method = 'GET', body, cookie, statuses, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(`${scope.apiBase}${pathname}`, {
      method,
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const responseBody = await response.json().catch(() => ({}));
    if (!statuses.includes(response.status)) {
      throw new Error(`${method} ${pathname} HTTP ${response.status} ${String(responseBody?.code ?? '')}`);
    }
    return { status: response.status, body: responseBody };
  } finally {
    clearTimeout(timer);
  }
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/((?:token|password|cookie|authorization|secret)=)[^\s&]+/giu, '$1<redacted>')
    .slice(0, 800);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
