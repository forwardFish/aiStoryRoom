import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  assertNonProductionScope,
  encodeRoomPath,
  fetchWithTimeout,
  normalizeBaseUrl,
  readJsonFixture,
  requestJson,
  requireFixtureString,
  skipUnlessEnvironment,
} from '../../lib/live-fixture.mjs';

const REQUIRED_HUMAN_COUNTS = Object.freeze([2, 3, 4, 5, 6]);
const REQUIRED_CHAPTERS = Object.freeze(['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7']);
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
let assertSafePressureDatabaseScope;

test('real Pressure multiplayer fixtures cover 2-6 humans with deterministic AI fill', async (t) => {
  const context = await liveContext(t);
  if (!context) return;
  const runs = context.fixture.multiplayerRuns;
  assert.ok(Array.isArray(runs), 'E2E fixture must provide multiplayerRuns');
  assert.deepEqual(
    runs.map((entry) => entry.humanCount).sort((left, right) => left - right),
    REQUIRED_HUMAN_COUNTS,
    'multiplayerRuns must contain exactly one 2, 3, 4, 5, and 6-human fixture',
  );

  for (const entry of runs) {
    const runId = requireFixtureString(entry, 'runId', `multiplayer ${entry.humanCount}`);
    assert.ok(Array.isArray(entry.viewers), `multiplayer ${entry.humanCount}.viewers must be an array`);
    assert.equal(entry.viewers.length, entry.humanCount, 'each human seat requires an authenticated viewer fixture');
    const seats = new Set();
    for (const [index, viewer] of entry.viewers.entries()) {
      const cookie = requireFixtureString(viewer, 'cookie', `multiplayer ${entry.humanCount}.viewers[${index}]`);
      const expectedSeatId = requireFixtureString(viewer, 'seatId', `multiplayer ${entry.humanCount}.viewers[${index}]`);
      const game = await requestJson(context.baseUrl, encodeRoomPath(runId), { cookie, timeoutMs: 20_000 });
      assert.equal(game.response.status, 200, `GET multiplayer game failed with ${game.response.status}`);
      assert.equal(game.payload?.schemaVersion, 'pressure_chapter_game_projection_v1');
      assert.equal(game.payload?.route?.participantMode, 'MULTIPLAYER');
      assert.equal(game.payload?.viewer?.seatId, expectedSeatId);
      seats.add(game.payload.viewer.seatId);
    }
    assert.equal(seats.size, entry.humanCount, 'human viewers must receive distinct seat projections');
    const prisma = pressurePrisma();
    try {
      const controls = await latestSeatControls(prisma, runId);
      assert.equal(controls.length, 6, 'durable control snapshot does not contain exactly six seats');
      const humanSeats = controls.filter((seat) => seat.mode === 'HUMAN_ACTIVE');
      const aiSeats = controls.filter((seat) => seat.mode === 'AI_ACTIVE');
      assert.equal(humanSeats.length, entry.humanCount, 'durable human control count does not match fixture occupancy');
      assert.equal(aiSeats.length, 6 - entry.humanCount, 'durable AI control count does not fill only unclaimed seats');
      assert.deepEqual(
        humanSeats.map((seat) => seat.seatId).sort(),
        [...seats].sort(),
        'HTTP viewer seats and durable HUMAN_ACTIVE controls disagree',
      );
      assert.ok(aiSeats.every((seat) => seat.originalHumanControllerId === null), 'AI-filled seats must not displace a human controller');

      const genesisRows = await prisma.$queryRawUnsafe(
        `SELECT "sequence",
                "genesisHash",
                "commitManifestJson",
                "commitManifestHash",
                "commitHash"
           FROM "PressureGenesisCommit"
          WHERE "runId" = $1`,
        runId,
      );
      assert.equal(genesisRows.length, 1, `run ${runId} must have exactly one durable P0 commit`);
      const genesis = genesisRows[0];
      const manifest = genesis.commitManifestJson;
      assert.equal(genesis.sequence, 0);
      assert.equal(manifest.record.snapshot.nodeId, 'P0');
      assert.equal(manifest.record.snapshot.sequence, 0);
      assert.equal(
        manifest.record.snapshot.genesisHash,
        genesis.genesisHash,
        'P0 commit is not bound to its embedded genesis snapshot hash',
      );
      for (const [field, value] of Object.entries({
        genesisHash: genesis.genesisHash,
        commitManifestHash: genesis.commitManifestHash,
        commitHash: genesis.commitHash,
      })) {
        assert.match(value, /^[0-9a-f]{64}$/u, `P0 ${field} is not a sha256 digest`);
      }

      const chapters = await prisma.$queryRawUnsafe(
        'SELECT "chapterId", "state"::text AS state FROM "PressureChapterRuntime" WHERE "runId" = $1 ORDER BY "chapterSequence"',
        runId,
      );
      assert.deepEqual(chapters.map((chapter) => chapter.chapterId), REQUIRED_CHAPTERS, `run ${runId} did not traverse N1-N7 after durable P0 genesis`);
      assert.ok(chapters.every((chapter) => chapter.state === 'CHAPTER_FROZEN'), `run ${runId} contains an unfrozen chapter`);

      const actionCounts = await prisma.$queryRawUnsafe(
        `SELECT "seatId", COUNT(*)::int AS count
           FROM "PressureDecisionAction"
          WHERE "runId" = $1 AND "status" IN ('CONFIRMED', 'SEALED')
          GROUP BY "seatId"`,
        runId,
      );
      const countBySeat = new Map(actionCounts.map((row) => [row.seatId, row.count]));
      assert.ok(
        aiSeats.every((seat) => (countBySeat.get(seat.seatId) ?? 0) > 0),
        `run ${runId} has an AI_ACTIVE seat without a durable formal action`,
      );
    } finally {
      await prisma.$disconnect();
    }
  }
});

test('Pressure SSE, heartbeat, explicit AI takeover, and human reclaim are live-routed', async (t) => {
  const context = await liveContext(t);
  if (!context) return;
  const fixture = context.fixture.controlRun;
  assert.ok(fixture && typeof fixture === 'object', 'E2E fixture must provide controlRun');
  const runId = requireFixtureString(fixture, 'runId', 'controlRun');
  const cookie = requireFixtureString(fixture, 'cookie', 'controlRun');
  const transportPath = encodeRoomPath(runId, 'pressure-seat-transport');
  const initial = await requestJson(context.baseUrl, transportPath, { cookie, timeoutMs: 20_000 });
  assert.equal(initial.response.status, 200);
  assert.equal(initial.payload?.schemaVersion, 'pressure_seat_transport_snapshot_v1');
  const ownSeat = initial.payload.seatView?.ownSeat;
  const epoch = ownSeat?.controlEpoch;
  assert.ok(Number.isSafeInteger(epoch) && epoch >= 1, 'controlRun lacks a valid control epoch');
  assert.match(ownSeat?.submissionFenceToken ?? '', /^[0-9a-f]{64}$/u, 'controlRun lacks a valid submission fence');
  assert.ok(typeof initial.payload.cursor === 'string' && initial.payload.cursor.length > 0, 'controlRun lacks a transport cursor');

  const streamUrl = new URL(
    encodeRoomPath(runId, `pressure-seat-transport/events?afterCursor=${encodeURIComponent(initial.payload.cursor)}`),
    `${context.baseUrl}/`,
  ).href;
  const stream = await fetchWithTimeout(streamUrl, {
    headers: { accept: 'text/event-stream', cookie },
  }, 15_000);
  assert.equal(stream.status, 200, `Pressure SSE returned HTTP ${stream.status}`);
  assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/iu);
  await stream.body?.cancel();

  const sessionId = `pressure-e2e-${randomUUID()}`;
  const heartbeat = await requestJson(context.baseUrl, encodeRoomPath(runId, 'pressure-seat-transport/heartbeat'), {
    cookie,
    method: 'POST',
    body: {
      sessionId,
      signalSequence: 1,
      status: 'ONLINE',
      idempotencyKey: `${sessionId}:presence:1:ONLINE`,
    },
    timeoutMs: 20_000,
  });
  assert.ok(heartbeat.response.ok, `Pressure heartbeat returned HTTP ${heartbeat.response.status}`);

  const handoffKey = `pressure-e2e-handoff:${randomUUID()}`;
  const handoff = await requestJson(context.baseUrl, encodeRoomPath(runId, 'pressure-seat-transport/handoff'), {
    cookie,
    method: 'POST',
    body: {
      expectedControlEpoch: epoch,
      expectedSubmissionFenceToken: ownSeat.submissionFenceToken,
      idempotencyKey: handoffKey,
    },
    timeoutMs: 20_000,
  });
  assert.ok(handoff.response.ok, `Pressure handoff returned HTTP ${handoff.response.status}`);
  assert.equal(handoff.payload?.schemaVersion, 'pressure_seat_transport_authority_result_v1');
  const handedSeat = handoff.payload?.snapshot?.seatView?.ownSeat;
  assert.equal(handedSeat?.controllerKind, 'AI');
  assert.equal(handedSeat?.canReclaim, true);

  const reclaim = await requestJson(context.baseUrl, encodeRoomPath(runId, 'pressure-seat-transport/reclaim'), {
    cookie,
    method: 'POST',
    body: {
      expectedControlEpoch: handedSeat.controlEpoch,
      expectedReclaimFenceToken: handedSeat.reclaimFenceToken,
      idempotencyKey: `pressure-e2e-reclaim:${randomUUID()}`,
    },
    timeoutMs: 20_000,
  });
  assert.ok(reclaim.response.ok, `Pressure reclaim returned HTTP ${reclaim.response.status}`);
  assert.equal(reclaim.payload?.snapshot?.seatView?.ownSeat?.controllerKind, 'HUMAN');
});

test('live A-Emotion feed proves SUSPECTED to CONFIRMED and confirmed PromiseBroken', async (t) => {
  const context = await liveContext(t);
  if (!context) return;
  const fixture = context.fixture.aEmotionRun;
  assert.ok(fixture && typeof fixture === 'object', 'E2E fixture must provide aEmotionRun');
  const runId = requireFixtureString(fixture, 'runId', 'aEmotionRun');
  const cookie = requireFixtureString(fixture, 'cookie', 'aEmotionRun');
  const game = await requestJson(context.baseUrl, encodeRoomPath(runId), { cookie, timeoutMs: 20_000 });
  assert.equal(game.response.status, 200);
  assert.equal(game.payload?.schemaVersion, 'pressure_chapter_game_projection_v1');
  const items = game.payload.feedPage?.items;
  assert.ok(Array.isArray(items), 'Pressure projection did not include an A-Emotion feed');
  const suspected = items.find((item) => item.disclosure === 'SUSPECTED');
  assert.ok(suspected, 'live feed has no SUSPECTED event');
  const confirmed = items.find((item) => item.disclosure === 'CONFIRMED' && item.revealOfEventId === suspected.eventId);
  assert.ok(confirmed, 'live feed has no CONFIRMED reveal linked to the SUSPECTED event');
  const promiseBroken = items.find((item) => item.type === 'PROMISE_BROKEN');
  assert.ok(promiseBroken, 'live feed has no PROMISE_BROKEN event');
  assert.equal(promiseBroken.disclosure, 'CONFIRMED');
  assert.ok(typeof promiseBroken.promiseId === 'string' && promiseBroken.promiseId.length > 0);
});

test('Solo five-AI fill has durable actions and zero run-bound model Provider traces', async (t) => {
  const context = await liveContext(t);
  if (!context) return;
  const solo = context.fixture.soloAiRun;
  assert.ok(solo && typeof solo === 'object', 'E2E fixture must provide soloAiRun');
  const runId = requireFixtureString(solo, 'runId', 'soloAiRun');
  const prisma = pressurePrisma();
  try {
    const controls = await latestSeatControls(prisma, runId);
    assert.equal(controls.length, 6);
    const humanSeats = controls.filter((seat) => seat.mode === 'HUMAN_ACTIVE');
    const aiSeats = controls.filter((seat) => seat.mode === 'AI_ACTIVE');
    assert.equal(humanSeats.length, 1);
    assert.equal(aiSeats.length, 5);

    const actionCounts = await prisma.$queryRawUnsafe(
      `SELECT "seatId", COUNT(*)::int AS count
         FROM "PressureDecisionAction"
        WHERE "runId" = $1 AND "status" IN ('CONFIRMED', 'SEALED')
        GROUP BY "seatId"`,
      runId,
    );
    const countBySeat = new Map(actionCounts.map((row) => [row.seatId, row.count]));
    assert.ok(aiSeats.every((seat) => (countBySeat.get(seat.seatId) ?? 0) > 0), 'one or more AI seats have no durable formal action');

    const providerTraces = await prisma.$queryRawUnsafe(
      'SELECT "id", "pipelineStep", "provider", "modelName" FROM "PromptExecutionRecord" WHERE "runId" = $1',
      runId,
    );
    assert.deepEqual(providerTraces, [], 'deterministic seat fill emitted one or more run-bound model Provider traces');

    const actionPayloads = await prisma.$queryRawUnsafe(
      'SELECT "seatId", "payloadJson"::text AS payload FROM "PressureDecisionAction" WHERE "runId" = $1',
      runId,
    );
    assert.ok(
      actionPayloads.every((row) => !/provider|model|prompt|deepseek|openai/iu.test(row.payload)),
      'formal AI action payloads contain a model/provider capability trace',
    );
  } finally {
    await prisma.$disconnect();
  }
});

async function liveContext(t) {
  if (skipUnlessEnvironment(t, [
    'PRESSURE_CHAPTER_ALLOW_E2E_TESTS',
    'PRESSURE_CHAPTER_TEST_SCOPE',
    'PRESSURE_CHAPTER_DB_SCOPE',
    'PRESSURE_CHAPTER_DATABASE_PROVIDER',
    'DATABASE_URL',
    'PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256',
    'PRESSURE_CHAPTER_TEST_BASE_URL',
    'PRESSURE_CHAPTER_E2E_AUTH_FIXTURE',
  ])) return null;
  assert.equal(process.env.PRESSURE_CHAPTER_ALLOW_E2E_TESTS, '1');
  assertNonProductionScope();
  assert.equal(process.env.PRESSURE_CHAPTER_DATABASE_PROVIDER, 'supabase');
  ({ assertSafePressureDatabaseScope } = await loadDatabaseContract());
  assertSafePressureDatabaseScope({
    databaseUrl: process.env.DATABASE_URL,
    explicitScope: process.env.PRESSURE_CHAPTER_DB_SCOPE,
    allowedSupabaseProjectSha256: process.env.PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256,
  });
  return {
    baseUrl: normalizeBaseUrl(process.env.PRESSURE_CHAPTER_TEST_BASE_URL),
    fixture: await readJsonFixture(
      process.env.PRESSURE_CHAPTER_E2E_AUTH_FIXTURE,
      'PRESSURE_CHAPTER_E2E_AUTH_FIXTURE',
    ),
  };
}

async function loadDatabaseContract() {
  const module = await import('../../../../../apps/api/src/pressure-chapter/persistence/database-contract.ts');
  return module.default ?? module;
}

function pressurePrisma() {
  const scope = assertSafePressureDatabaseScope({
    databaseUrl: process.env.DATABASE_URL,
    explicitScope: process.env.PRESSURE_CHAPTER_DB_SCOPE,
    allowedSupabaseProjectSha256: process.env.PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256,
  });
  assert.ok(scope.supabaseProjectFingerprint, 'formal E2E requires allowlisted Supabase, not local PostgreSQL');
  return new PrismaClient({ datasources: { db: { url: scope.databaseUrl } } });
}

async function latestSeatControls(prisma, runId) {
  return prisma.$queryRawUnsafe(
    `SELECT "seatId", "mode"::text AS mode, "originalHumanControllerId", "activeControllerId", "controlEpoch"
       FROM "PressureSeatControlSeatSnapshot"
      WHERE "runId" = $1
        AND "snapshotStateRevision" = (
          SELECT MAX("stateRevision") FROM "PressureSeatControlSnapshot" WHERE "runId" = $1
        )
      ORDER BY "seatId"`,
    runId,
  );
}
