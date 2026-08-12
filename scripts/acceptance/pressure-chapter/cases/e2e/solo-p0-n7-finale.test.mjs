import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  assertNonProductionScope,
  encodeRoomPath,
  normalizeBaseUrl,
  readJsonFixture,
  requestJson,
  requireFixtureString,
  skipUnlessEnvironment,
} from '../../lib/live-fixture.mjs';

const CHAPTERS = Object.freeze(['P0', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7']);
const GAME_SCHEMA = 'pressure_chapter_game_projection_v1';
const TERMINAL_SCHEMA = 'pressure_chapter_game_terminal_v1';

test('real Pressure Solo route advances P0 through N7 and returns finalized Result', async (t) => {
  if (skipUnlessEnvironment(t, [
    'PRESSURE_CHAPTER_ALLOW_E2E_TESTS',
    'PRESSURE_CHAPTER_TEST_SCOPE',
    'PRESSURE_CHAPTER_TEST_BASE_URL',
    'PRESSURE_CHAPTER_E2E_AUTH_FIXTURE',
  ])) return;
  assert.equal(process.env.PRESSURE_CHAPTER_ALLOW_E2E_TESTS, '1');
  assertNonProductionScope();

  const baseUrl = normalizeBaseUrl(process.env.PRESSURE_CHAPTER_TEST_BASE_URL);
  const fixture = await readJsonFixture(
    process.env.PRESSURE_CHAPTER_E2E_AUTH_FIXTURE,
    'PRESSURE_CHAPTER_E2E_AUTH_FIXTURE',
  );
  const runId = requireFixtureString(fixture, 'runId');
  const cookie = requireFixtureString(fixture, 'cookie');
  const timeoutMs = boundedInteger(fixture.timeoutMs, 300_000, 30_000, 600_000);
  const optionCodes = fixture.optionCodes && typeof fixture.optionCodes === 'object'
    ? fixture.optionCodes
    : {};
  const customTextByChapter = fixture.customTextByChapter && typeof fixture.customTextByChapter === 'object'
    ? fixture.customTextByChapter
    : {};
  const visited = new Set();
  const submittedDecisionPoints = new Set();
  const deadline = Date.now() + timeoutMs;
  let terminal = null;
  let firstProjection = true;

  while (Date.now() < deadline) {
    const game = await requestJson(baseUrl, encodeRoomPath(runId), { cookie, timeoutMs: 20_000 });
    assert.notEqual(game.response.status, 401, 'E2E fixture authentication was rejected');
    assert.notEqual(game.response.status, 403, 'E2E fixture is not authorized for this run');
    assert.equal(game.response.status, 200, `GET game failed with ${game.response.status}`);

    if (game.payload?.schemaVersion === TERMINAL_SCHEMA) {
      terminal = game.payload;
      break;
    }
    const projection = game.payload;
    assert.equal(projection?.schemaVersion, GAME_SCHEMA, 'GET game did not return a Pressure projection');
    assert.equal(projection.runId, runId);
    assert.equal(projection.route?.participantMode, 'SOLO', 'formal route E2E requires a Solo fixture');
    assert.ok(CHAPTERS.includes(projection.chapter?.chapterId), 'unknown Pressure chapter');
    if (firstProjection) {
      assert.equal(projection.chapter.chapterId, 'P0', 'formal route E2E requires a fresh P0 fixture');
      firstProjection = false;
    }
    visited.add(projection.chapter.chapterId);

    const decision = projection.decision;
    const control = projection.viewer?.control;
    if (
      decision
      && projection.capabilities?.canSubmitDecision === true
      && control?.canSubmit === true
      && !submittedDecisionPoints.has(decision.decisionPointId)
    ) {
      const configuredCode = optionCodes[projection.chapter.chapterId];
      const optionCode = configuredCode ?? decision.options?.[0]?.code ?? null;
      const customText = optionCode === null
        ? String(customTextByChapter[projection.chapter.chapterId] ?? '').trim() || null
        : null;
      assert.ok(optionCode !== null || customText !== null, `no legal decision input at ${decision.decisionPointId}`);
      const command = {
        schemaVersion: 'pressure_chapter_game_command_v1',
        commandType: 'SUBMIT_DECISION',
        runId,
        routeHash: projection.route.routeHash,
        chapterRuntimeId: projection.chapter.chapterRuntimeId,
        chapterId: projection.chapter.chapterId,
        decisionPointId: decision.decisionPointId,
        seatId: projection.viewer.seatId,
        controlEpoch: control.controlEpoch,
        expectedWorkingRevision: decision.expectedWorkingRevision,
        submissionFenceToken: control.submissionFenceToken,
        idempotencyKey: `pressure-e2e:${randomUUID()}`,
        optionCode,
        customText,
      };
      const first = await requestJson(baseUrl, encodeRoomPath(runId, 'game/action'), {
        cookie,
        method: 'POST',
        body: command,
        timeoutMs: 30_000,
      });
      assert.equal(first.response.status, 200, `decision failed with ${first.response.status}`);
      assert.equal(first.payload?.schemaVersion, 'pressure_chapter_submit_decision_http_response_v1');
      assert.equal(first.payload?.idempotencyKey, command.idempotencyKey);

      const replay = await requestJson(baseUrl, encodeRoomPath(runId, 'game/action'), {
        cookie,
        method: 'POST',
        body: command,
        timeoutMs: 30_000,
      });
      assert.equal(replay.response.status, 200, 'same-command idempotency replay failed');
      assert.equal(replay.payload?.idempotencyKey, command.idempotencyKey);
      submittedDecisionPoints.add(decision.decisionPointId);
    }
    await delay(250);
  }

  assert.ok(terminal, `Pressure route did not reach Finale within ${timeoutMs}ms`);
  assert.deepEqual([...visited].sort(chapterOrder), CHAPTERS, 'E2E did not observe every P0/N1-N7 chapter');
  assert.equal(terminal.runId, runId);
  assert.equal(terminal.resultUrl, `/game/result?runId=${encodeURIComponent(runId)}`);

  const result = await requestJson(baseUrl, encodeRoomPath(runId, 'result'), { cookie, timeoutMs: 30_000 });
  assert.equal(result.response.status, 200, `GET result failed with ${result.response.status}`);
  assert.equal(result.payload?.envelopeSchemaVersion, 'endgame_result_envelope_v1');
  assert.equal(result.payload?.runId, runId);
  assert.equal(result.payload?.rendererKey, 'sangtian_pressure_endgame_v1');
  assert.equal(result.payload?.authoritativeResultStatus, 'FINALIZED');
  assert.equal(result.payload?.runtimeTerminalState, 'FINALE_FROZEN');
  assert.equal(result.payload?.payload?.schemaVersion, 'sangtian_pressure_result_v1');
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value ?? fallback);
  assert.ok(Number.isSafeInteger(number) && number >= minimum && number <= maximum, 'fixture.timeoutMs is invalid');
  return number;
}

function chapterOrder(left, right) {
  return CHAPTERS.indexOf(left) - CHAPTERS.indexOf(right);
}
