import assert from 'node:assert/strict';
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

const ENV = [
  'PRESSURE_CHAPTER_ALLOW_MODAL_TRIGGER_TESTS',
  'PRESSURE_CHAPTER_TEST_SCOPE',
  'PRESSURE_CHAPTER_TEST_BASE_URL',
  'PRESSURE_MODAL_TRIGGER_LIVE_FIXTURE',
];

test('live game projection enforces four trigger contracts, priority and delivery dedupe', { timeout: 90_000 }, async (t) => {
  if (skipUnlessEnvironment(t, ENV)) return;
  assert.equal(process.env.PRESSURE_CHAPTER_ALLOW_MODAL_TRIGGER_TESTS, '1');
  assertNonProductionScope();
  const baseUrl = normalizeBaseUrl(process.env.PRESSURE_CHAPTER_TEST_BASE_URL);
  const fixture = await loadFixture();
  const projections = {};
  for (const name of ['crossMajor', 'crossMinor', 'promiseBroken', 'promiseRevealed', 'crisis', 'victory']) {
    projections[name] = await readScenarioProjection(baseUrl, fixture.scenarios?.[name], name);
  }

  assertEvent(projections.crossMajor, fixture.scenarios.crossMajor, {
    presentation: 'CENTER_CARD', cardType: 'CROSS_IMPACT', modalType: null,
  });
  assertEvent(projections.crossMinor, fixture.scenarios.crossMinor, {
    presentation: 'FEED_ONLY', cardType: null, modalType: null,
  });
  assertEvent(projections.promiseBroken, fixture.scenarios.promiseBroken, {
    cardType: null, modalType: null,
  });
  assertEvent(projections.promiseRevealed, fixture.scenarios.promiseRevealed, {
    presentation: 'KEY_MODAL', cardType: 'PROMISE_BROKEN', modalType: 'PROMISE_BROKEN', priority: 200,
  });
  assertEvent(projections.crisis, fixture.scenarios.crisis, {
    presentation: 'KEY_MODAL', cardType: 'CRISIS', modalType: 'CRISIS', priority: 300,
  });
  assertEvent(projections.victory, fixture.scenarios.victory, {
    presentation: 'KEY_MODAL', cardType: 'STAGE_VICTORY', modalType: 'STAGE_VICTORY', priority: 100,
  });
  assert.notEqual(projections.victory.chapter?.phase, 'FINALE_REQUESTED', 'stage victory must remain nonterminal');

  const modalEntries = [
    findEvent(projections.crisis, fixture.scenarios.crisis.eventId),
    findEvent(projections.promiseRevealed, fixture.scenarios.promiseRevealed.eventId),
    findEvent(projections.victory, fixture.scenarios.victory.eventId),
  ];
  assert.deepEqual(modalEntries.map((item) => item.keyModal.priority), [300, 200, 100]);
  for (const item of modalEntries) {
    const modal = item.keyModal;
    assert.equal(modal.triggerId.length > 0, true);
    assert.equal(Number.isInteger(modal.stateVersion) && modal.stateVersion > 0, true);
    assert.equal(typeof modal.dedupeKey === 'string' && modal.dedupeKey.length > 0, true);
    assert.equal(modal.card.sourceEventId, item.eventId);
  }
  assert.equal(new Set(modalEntries.map((item) => item.keyModal.dedupeKey)).size, 3);

  for (const [name, projection] of Object.entries(projections)) {
    assert.equal(projection.runId, fixture.scenarios[name].runId);
    assert.equal(projection.viewer?.seatId, fixture.scenarios[name].viewerSeatId);
    assert.equal(projection.feedPage?.runId, projection.runId);
    assert.equal(projection.feedPage?.viewerSeatId, projection.viewer?.seatId);
    const keys = projection.feedPage.items.flatMap((item) => item.keyModal ? [item.keyModal.dedupeKey] : []);
    assert.equal(keys.length, new Set(keys).size, `${name}: duplicate modal delivery`);
    const serialized = JSON.stringify(projection);
    for (const forbidden of ['issuerId', 'viewerId', 'privateEvidenceRefs', 'hiddenEvidenceRefs']) {
      assert.equal(serialized.includes(`\"${forbidden}\"`), false, `${name}: leaked ${forbidden}`);
    }
  }
});

test('live response target rejects invisible/stale/ACK/cross-run/allowed-set/fence failures and replays idempotently', { timeout: 90_000 }, async (t) => {
  if (skipUnlessEnvironment(t, ENV)) return;
  assert.equal(process.env.PRESSURE_CHAPTER_ALLOW_MODAL_TRIGGER_TESTS, '1');
  assertNonProductionScope();
  const baseUrl = normalizeBaseUrl(process.env.PRESSURE_CHAPTER_TEST_BASE_URL);
  const fixture = await loadFixture();
  const validation = fixture.responseValidation;
  const runId = requireFixtureString(validation, 'runId', 'responseValidation');
  const cookie = requireFixtureString(validation, 'cookie', 'responseValidation');
  const allowed = structuredClone(validation.allowedCommand);
  assert.equal(allowed.sourceEventId, validation.visibleLatestEventId);
  for (const forbidden of ['viewerId', 'issuerId', 'responseToEventId']) {
    assert.equal(Object.hasOwn(allowed, forbidden), false, `client command must not carry ${forbidden}`);
  }

  const path = encodeRoomPath(runId, 'game/action');
  const first = await requestJson(baseUrl, path, { cookie, method: 'POST', body: allowed, timeoutMs: 20_000 });
  assert.ok(first.response.ok, `valid response command failed HTTP ${first.response.status}: ${JSON.stringify(first.payload)}`);
  const replay = await requestJson(baseUrl, path, { cookie, method: 'POST', body: allowed, timeoutMs: 20_000 });
  assert.ok(replay.response.ok, `idempotent replay failed HTTP ${replay.response.status}`);
  assert.deepEqual(replay.payload, first.payload, 'same idempotency key returned a different receipt');

  const invalidCases = [
    ['MALFORMED_SOURCE', (command) => ({ ...command, sourceEventId: 42 })],
    ['MISSING_SOURCE', (command) => omit(command, 'sourceEventId')],
    ['MISSING_RESPONSE_CODE', (command) => omit(command, 'responseActionCode')],
    ['ACK', (command) => ({ ...command, sourceEventId: validation.acknowledgedEventId })],
    ['INVISIBLE', (command) => ({ ...command, sourceEventId: validation.invisibleEventId })],
    ['CROSS_RUN', (command) => ({ ...command, sourceEventId: validation.foreignEventId })],
    ['NOT_LATEST', (command) => ({ ...command, sourceEventId: validation.staleVisibleEventId })],
    ['STALE_REVISION', (command) => ({ ...command, expectedWorkingRevision: allowed.expectedWorkingRevision - 1 })],
    ['STALE_EPOCH', (command) => ({ ...command, controlEpoch: allowed.controlEpoch - 1 })],
    ['STALE_FENCE', (command) => ({ ...command, submissionFenceToken: `${allowed.submissionFenceToken}-stale` })],
    ['NOT_ALLOWED', (command) => ({ ...command, optionCode: '__NOT_SERVER_ALLOWED__' })],
  ];
  for (const [name, mutate] of invalidCases) {
    const before = await requestJson(baseUrl, encodeRoomPath(runId), { cookie, timeoutMs: 20_000 });
    assert.ok(before.response.ok, `${name}: cannot read pre-rejection delivery state`);
    const command = mutate({
      ...allowed,
      idempotencyKey: `${allowed.idempotencyKey}-${name.toLowerCase()}`,
    });
    const result = await requestJson(baseUrl, path, { cookie, method: 'POST', body: command, timeoutMs: 20_000 });
    assert.ok(result.response.status >= 400, `${name} command was accepted`);
    assert.ok(typeof result.payload?.code === 'string' && result.payload.code.length > 0, `${name} lacks stable error code`);
    const after = await requestJson(baseUrl, encodeRoomPath(runId), { cookie, timeoutMs: 20_000 });
    assert.ok(after.response.ok, `${name}: cannot read post-rejection delivery state`);
    assert.deepEqual(deliveryState(after.payload), deliveryState(before.payload), `${name} mutated ACK/MODAL_SHOWN/resolved delivery state`);
  }
});

test('live viewer projection hides cross-seat evidence and denies cross-room reads', { timeout: 30_000 }, async (t) => {
  if (skipUnlessEnvironment(t, ENV)) return;
  assertNonProductionScope();
  const baseUrl = normalizeBaseUrl(process.env.PRESSURE_CHAPTER_TEST_BASE_URL);
  const fixture = await loadFixture();
  const privacy = fixture.privacy;
  const cookie = requireFixtureString(privacy, 'viewerCookie', 'privacy');
  const visibleRunId = requireFixtureString(privacy, 'visibleRunId', 'privacy');
  const crossRoomRunId = requireFixtureString(privacy, 'crossRoomRunId', 'privacy');
  assert.ok(Array.isArray(privacy.forbiddenMarkers) && privacy.forbiddenMarkers.length >= 2, 'privacy.forbiddenMarkers requires cross-seat and hidden-evidence markers');
  const visible = await requestJson(baseUrl, encodeRoomPath(visibleRunId), { cookie, timeoutMs: 15_000 });
  assert.ok(visible.response.ok, `authorized privacy probe failed HTTP ${visible.response.status}`);
  const serialized = JSON.stringify(visible.payload);
  for (const marker of privacy.forbiddenMarkers) assert.equal(serialized.includes(marker), false, `viewer projection leaked ${marker}`);
  const denied = await requestJson(baseUrl, encodeRoomPath(crossRoomRunId), { cookie, timeoutMs: 15_000 });
  assert.ok(denied.response.status === 403 || denied.response.status === 404, `cross-room read returned HTTP ${denied.response.status}`);
});

test('live DELIVERY_MARK derives scope server-side, rejects stale/cross-scope and persists MODAL_SHOWN once', { timeout: 90_000 }, async (t) => {
  if (skipUnlessEnvironment(t, ENV)) return;
  assertNonProductionScope();
  const baseUrl = normalizeBaseUrl(process.env.PRESSURE_CHAPTER_TEST_BASE_URL);
  const fixture = await loadFixture();
  const validation = fixture.deliveryValidation;
  const runId = requireFixtureString(validation, 'runId', 'deliveryValidation');
  const eventId = requireFixtureString(validation, 'eventId', 'deliveryValidation');
  const cookie = requireFixtureString(validation, 'cookie', 'deliveryValidation');
  const crossSeatCookie = requireFixtureString(validation, 'crossSeatCookie', 'deliveryValidation');
  const foreignRunId = requireFixtureString(validation, 'foreignRunId', 'deliveryValidation');
  const foreignEventId = requireFixtureString(validation, 'foreignEventId', 'deliveryValidation');
  assert.equal(Number.isSafeInteger(validation.projectionVersion), true);
  const command = {
    schemaVersion: 'pressure_chapter_delivery_mark_command_v1',
    commandType: 'DELIVERY_MARK',
    eventId,
    projectionVersion: validation.projectionVersion,
    operation: 'MODAL_SHOWN',
    idempotencyKey: validation.idempotencyKey,
  };
  assert.deepEqual(Object.keys(command).sort(), [
    'commandType', 'eventId', 'idempotencyKey', 'operation', 'projectionVersion', 'schemaVersion',
  ].sort());
  const path = encodeRoomPath(runId, 'game/action');
  const before = await requestJson(baseUrl, encodeRoomPath(runId), { cookie, timeoutMs: 20_000 });
  assert.ok(before.response.ok);
  const beforeItem = findEvent(before.payload, eventId);
  assert.ok(beforeItem.keyModal, 'delivery fixture event is not currently modal-eligible');
  assert.ok(beforeItem.centerCard, 'delivery fixture event has no retained center card');

  const rejected = [
    ['STALE_VERSION', path, cookie, { ...command, projectionVersion: command.projectionVersion - 1, idempotencyKey: `${command.idempotencyKey}-stale` }],
    ['CROSS_SEAT', path, crossSeatCookie, { ...command, idempotencyKey: `${command.idempotencyKey}-seat` }],
    ['CROSS_ROOM', encodeRoomPath(foreignRunId, 'game/action'), cookie, {
      ...command, eventId: foreignEventId, idempotencyKey: `${command.idempotencyKey}-room`,
    }],
  ];
  for (const [name, rejectedPath, rejectedCookie, body] of rejected) {
    const result = await requestJson(baseUrl, rejectedPath, {
      cookie: rejectedCookie, method: 'POST', body, timeoutMs: 20_000,
    });
    assert.ok(result.response.status >= 400, `${name} delivery mark was accepted`);
    const unchanged = await requestJson(baseUrl, encodeRoomPath(runId), { cookie, timeoutMs: 20_000 });
    assert.ok(unchanged.response.ok);
    assert.ok(findEvent(unchanged.payload, eventId).keyModal, `${name} mutated the authorized viewer delivery`);
  }

  const shown = await requestJson(baseUrl, path, { cookie, method: 'POST', body: command, timeoutMs: 20_000 });
  assert.ok(shown.response.ok, `MODAL_SHOWN failed HTTP ${shown.response.status}`);
  const replay = await requestJson(baseUrl, path, { cookie, method: 'POST', body: command, timeoutMs: 20_000 });
  assert.ok(replay.response.ok, `MODAL_SHOWN replay failed HTTP ${replay.response.status}`);
  assert.deepEqual(replay.payload, shown.payload, 'MODAL_SHOWN idempotent receipt changed');
  const after = await requestJson(baseUrl, encodeRoomPath(runId), { cookie, timeoutMs: 20_000 });
  assert.ok(after.response.ok);
  const afterItem = findEvent(after.payload, eventId);
  assert.equal(afterItem.keyModal, null, 'server still projects keyModal after MODAL_SHOWN');
  assert.equal(afterItem.centerCard?.id, beforeItem.centerCard.id, 'MODAL_SHOWN removed or replaced center state');
});

async function loadFixture() {
  const fixture = await readJsonFixture(process.env.PRESSURE_MODAL_TRIGGER_LIVE_FIXTURE, 'PRESSURE_MODAL_TRIGGER_LIVE_FIXTURE');
  assert.equal(fixture.schemaVersion, 'pressure_modal_trigger_live_fixture_v1');
  return fixture;
}

function omit(value, key) {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function deliveryState(projection) {
  return (projection.feedPage?.items ?? []).map((item) => ({
    eventId: item.eventId,
    isUnread: item.isUnread,
    isAcknowledged: item.isAcknowledged,
    isResolved: item.isResolved,
    keyModalDedupeKey: item.keyModal?.dedupeKey ?? null,
  })).sort((left, right) => left.eventId.localeCompare(right.eventId, 'en'));
}

async function readScenarioProjection(baseUrl, scenario, name) {
  const runId = requireFixtureString(scenario, 'runId', name);
  const cookie = requireFixtureString(scenario, 'cookie', name);
  requireFixtureString(scenario, 'viewerSeatId', name);
  requireFixtureString(scenario, 'eventId', name);
  const result = await requestJson(baseUrl, encodeRoomPath(runId), { cookie, timeoutMs: 20_000 });
  assert.ok(result.response.ok, `${name}: real game API failed HTTP ${result.response.status}`);
  assert.equal(result.payload?.schemaVersion, 'pressure_chapter_game_projection_v1');
  return result.payload;
}

function findEvent(projection, eventId) {
  const matches = projection.feedPage?.items?.filter((item) => item.eventId === eventId) ?? [];
  assert.equal(matches.length, 1, `expected exactly one feed projection for ${eventId}`);
  return matches[0];
}

function assertEvent(projection, scenario, expected) {
  const item = findEvent(projection, scenario.eventId);
  if (expected.presentation !== undefined) assert.equal(item.recommendedPresentation, expected.presentation);
  assert.equal(item.centerCard?.type ?? null, expected.cardType);
  assert.equal(item.keyModal?.type ?? null, expected.modalType);
  if (expected.priority !== undefined) assert.equal(item.keyModal?.priority, expected.priority);
}
