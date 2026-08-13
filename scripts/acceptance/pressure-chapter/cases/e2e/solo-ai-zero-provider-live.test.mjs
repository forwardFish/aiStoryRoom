import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  encodeRoomPath, normalizeBaseUrl, readJsonFixture, requestJson, requireFixtureString, skipUnlessEnvironment,
} from '../../lib/live-fixture.mjs';

const ENV = [
  'PRESSURE_CHAPTER_ALLOW_MODAL_TRIGGER_TESTS', 'PRESSURE_CHAPTER_TEST_SCOPE',
  'PRESSURE_CHAPTER_TEST_BASE_URL', 'PRESSURE_MODAL_TRIGGER_LIVE_FIXTURE',
  'PRESSURE_MODAL_TRIGGER_PROVIDER_TRACE',
];

test('run-bound Solo 1+5 capability trace proves deterministic AI Provider/LLM/network invocation zero', { timeout: 30_000 }, async (t) => {
  if (skipUnlessEnvironment(t, ENV)) return;
  assert.equal(process.env.PRESSURE_CHAPTER_ALLOW_MODAL_TRIGGER_TESTS, '1');
  assert.equal(process.env.PRESSURE_CHAPTER_TEST_SCOPE, 'non-production');
  assert.notEqual(process.env.NODE_ENV, 'production');
  const trace = await readJsonFixture(process.env.PRESSURE_MODAL_TRIGGER_PROVIDER_TRACE, 'PRESSURE_MODAL_TRIGGER_PROVIDER_TRACE');
  assert.equal(trace.schemaVersion, 'pressure_solo_deterministic_ai_trace_v1');
  assert.equal(trace.humanSeatCount, 1);
  assert.equal(trace.aiSeatCount, 5);
  assert.equal(trace.capabilityDecisions?.length, 5);
  assert.equal(new Set(trace.capabilityDecisions.map((item) => item.seatId)).size, 5);
  assert.ok(trace.capabilityDecisions.every((item) => typeof item.decisionHash === 'string' && item.decisionHash.length > 0));
  assert.deepEqual(trace.providerInvocations, []);
  assert.deepEqual(trace.networkModelInvocations, []);
  const unsigned = structuredClone(trace);
  delete unsigned.traceHash;
  assert.equal(trace.traceHash, createHash('sha256').update(canonicalJson(unsigned)).digest('hex'), 'capability trace hash mismatch');

  const liveFixture = await readJsonFixture(process.env.PRESSURE_MODAL_TRIGGER_LIVE_FIXTURE, 'PRESSURE_MODAL_TRIGGER_LIVE_FIXTURE');
  const scenario = liveFixture.scenarios?.crossMajor;
  const cookie = requireFixtureString(scenario, 'cookie', 'scenarios.crossMajor');
  const baseUrl = normalizeBaseUrl(process.env.PRESSURE_CHAPTER_TEST_BASE_URL);
  const result = await requestJson(baseUrl, encodeRoomPath(trace.runId), { cookie, timeoutMs: 15_000 });
  assert.ok(result.response.ok, `traced Solo run is not readable: HTTP ${result.response.status}`);
  assert.equal(result.payload?.runId, trace.runId);
  assert.equal(result.payload?.route?.participantMode, 'SOLO');
  assert.equal(result.payload?.route?.routeHash, trace.routeHash);
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
