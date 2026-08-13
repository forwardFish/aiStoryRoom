import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  AtomicLedgerOutboxHarness,
  buildModalQueue,
  evaluateTrigger,
  projectVisibleEvent,
  runDeterministicSoloAi,
  validateResponseTarget,
} from '../../lib/modal-trigger-oracle.mjs';
import { fetchWithTimeout } from '../../lib/live-fixture.mjs';

const fixture = JSON.parse(await readFile(new URL('../../fixtures/modal-trigger-contract-v1.json', import.meta.url), 'utf8'));
const triggerBase = (item) => ({
  ...item,
  viewerSeatId: fixture.viewerSeatId,
  triggerId: `trigger-${item.id}`,
  stateVersion: 1,
});

test('four frozen trigger contracts map to center/feed/modal exactly', () => {
  for (const item of fixture.triggerCases) {
    const actual = evaluateTrigger(triggerBase(item));
    assert.equal(actual.center, item.center, `${item.id}: center`);
    assert.equal(actual.feed, item.feed, `${item.id}: feed`);
    assert.equal(actual.modal?.modalType ?? null, item.modalType, `${item.id}: modal`);
    assert.equal(actual.terminal, item.terminal ?? false, `${item.id}: terminal`);
  }
});

test('modal queue is priority 300 > 200 > 100 and exact-tuple deduped', () => {
  const crisis = evaluateTrigger(triggerBase(fixture.triggerCases.find((item) => item.id === 'crisis-entry')));
  const promise = evaluateTrigger(triggerBase(fixture.triggerCases.find((item) => item.id === 'promise-revealed')));
  const victory = evaluateTrigger(triggerBase(fixture.triggerCases.find((item) => item.id === 'victory-entry')));
  const queue = buildModalQueue([victory, promise, crisis, structuredClone(crisis)]);
  assert.deepEqual(queue.map((item) => item.priority), [300, 200, 100]);
  assert.equal(queue.length, 3);
  assert.deepEqual(queue[0].dedupeTuple, ['seat-viewer', 'CRISIS', 'trigger-crisis-entry', 1]);
  const nextVersion = evaluateTrigger({ ...triggerBase(fixture.triggerCases.find((item) => item.id === 'crisis-entry')), stateVersion: 2 });
  assert.equal(buildModalQueue([crisis, nextVersion]).length, 2, 'stateVersion is part of dedupe identity');
});

test('viewer/cross-seat/cross-room/hidden and unauthorized evidence fail closed', () => {
  const event = {
    eventId: 'event-1', roomId: 'room-1', runId: 'run-1', viewerSeatIds: ['seat-a'],
    disclosure: 'CONFIRMED', authorizedEvidence: true, title: 'safe', safeSummary: 'safe',
    sourceSeatId: 'secret-seat', evidenceRefs: ['secret-evidence'], eventSequence: 1, stateVersion: 1,
  };
  const context = { roomId: 'room-1', runId: 'run-1', viewerSeatId: 'seat-a' };
  const visible = projectVisibleEvent(event, context);
  assert.equal(visible.title, 'safe');
  assert.equal('sourceSeatId' in visible, false);
  assert.equal('evidenceRefs' in visible, false);
  assert.equal(projectVisibleEvent(event, { ...context, viewerSeatId: 'seat-b' }), null);
  assert.equal(projectVisibleEvent(event, { ...context, roomId: 'room-2' }), null);
  assert.equal(projectVisibleEvent({ ...event, disclosure: 'HIDDEN' }, context), null);
  assert.equal(projectVisibleEvent({ ...event, authorizedEvidence: false }, context), null);
});

test('responseToEventId is server-revalidated for visibility/latest/ACK/run/allowed set/fences/idempotency', () => {
  const server = {
    roomId: 'room-1', runId: 'run-1', latestVisibleEventId: 'event-1', workingRevision: 7,
    controlEpoch: 4, submissionFenceToken: 'fence-4', allowedResponseActionCodes: ['INVESTIGATE_LEDGER'],
    idempotencyReceipts: new Map(),
  };
  const event = { eventId: 'event-1', roomId: 'room-1', runId: 'run-1', visibleToViewer: true, acknowledged: false };
  const command = {
    actionCode: 'INVESTIGATE_LEDGER', expectedWorkingRevision: 7, controlEpoch: 4,
    submissionFenceToken: 'fence-4', idempotencyKey: 'idem-1',
  };
  assert.equal(validateResponseTarget({ event, command, server }).accepted, true);
  assert.equal(validateResponseTarget({ event, command, server }).replay, true);
  const cases = [
    [{ ...event, visibleToViewer: false }, command, 'EVENT_NOT_VISIBLE'],
    [{ ...event, eventId: 'old' }, command, 'EVENT_NOT_LATEST'],
    [{ ...event, acknowledged: true }, command, 'EVENT_ALREADY_ACKNOWLEDGED'],
    [{ ...event, runId: 'run-2' }, command, 'CROSS_RUN_EVENT'],
    [event, { ...command, actionCode: 'PLAN_ANYTHING' }, 'ACTION_NOT_ALLOWED'],
    [event, { ...command, expectedWorkingRevision: 6 }, 'STALE_WORKING_REVISION'],
    [event, { ...command, controlEpoch: 3 }, 'STALE_CONTROL_EPOCH'],
    [event, { ...command, submissionFenceToken: 'old' }, 'STALE_SUBMISSION_FENCE'],
  ];
  for (const [candidateEvent, candidateCommand, code] of cases) {
    assert.equal(validateResponseTarget({ event: candidateEvent, command: candidateCommand, server }).code, code);
  }
});

test('oracle-only atomicity model stays fail-closed; real transaction proof is live-only', () => {
  for (const faultAt of ['AFTER_LEDGER_BEFORE_OUTBOX', 'AFTER_OUTBOX_BEFORE_COMMIT']) {
    const harness = new AtomicLedgerOutboxHarness();
    assert.throws(() => harness.commit({ ledgerKey: 'ledger-1', outboxKey: 'outbox-1', payload: { event: 1 }, faultAt }));
    assert.deepEqual(harness.snapshot(), { ledger: [], outbox: [] });
    assert.equal(harness.commit({ ledgerKey: 'ledger-1', outboxKey: 'outbox-1', payload: { event: 1 } }).replay, false);
    assert.equal(harness.commit({ ledgerKey: 'ledger-1', outboxKey: 'outbox-1', payload: { event: 1 } }).replay, true);
    const snapshot = harness.snapshot();
    assert.equal(snapshot.ledger.length, 1);
    assert.equal(snapshot.outbox.length, 1);
  }
});

test('oracle-only 1+5 rule is deterministic; Provider=0 proof is DB live-only', async () => {
  const provider = { invocations: 0 };
  const seats = Array.from({ length: 5 }, (_, index) => `ai-seat-${index + 1}`);
  const first = await runDeterministicSoloAi({ seats, provider, decide: async (seat) => ({ seat, code: `RULE_${seat}` }) });
  const second = await runDeterministicSoloAi({ seats, provider, decide: async (seat) => ({ seat, code: `RULE_${seat}` }) });
  assert.deepEqual(first, second);
  assert.equal(first.length, 5);
  assert.equal(provider.invocations, 0);
});

test('unreachable live API is a hard failure, never a fixture PASS', async () => {
  await assert.rejects(
    fetchWithTimeout('http://127.0.0.1:1/api/health/ready', {}, 250),
    /was unreachable|timed out/u,
  );
});
