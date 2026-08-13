import assert from 'node:assert/strict';

export const MODAL_PRIORITY = Object.freeze({
  CRISIS: 300,
  PROMISE_BROKEN: 200,
  STAGE_VICTORY: 100,
});

export function modalDedupeTuple({ viewerSeatId, modalType, triggerId, stateVersion }) {
  for (const [name, value] of Object.entries({ viewerSeatId, modalType, triggerId })) {
    assert.ok(typeof value === 'string' && value.length > 0, `${name} is required`);
  }
  assert.ok(Number.isInteger(stateVersion) && stateVersion > 0, 'stateVersion must be a positive integer');
  return Object.freeze([viewerSeatId, modalType, triggerId, stateVersion]);
}

export function evaluateTrigger(input) {
  const common = {
    center: false,
    feed: true,
    modal: null,
    terminal: false,
  };
  if (input.contract === 'CROSS_IMPACT') {
    return {
      ...common,
      center: input.severity === 'MAJOR' || input.severity === 'CRITICAL',
    };
  }
  if (input.contract === 'PROMISE') {
    if (input.transition === 'BROKEN') return common;
    if (input.transition !== 'REVEALED' || input.disclosure !== 'CONFIRMED' || input.authorizedEvidence !== true) {
      return common;
    }
    return {
      ...common,
      center: true,
      modal: modal(input, 'PROMISE_BROKEN'),
    };
  }
  if (input.contract === 'CRISIS') {
    if (input.before === 'DANGER' || input.after !== 'DANGER') return common;
    return { ...common, center: true, modal: modal(input, 'CRISIS') };
  }
  if (input.contract === 'VICTORY') {
    if (input.before !== false || input.after !== true) return common;
    return { ...common, center: true, modal: modal(input, 'STAGE_VICTORY') };
  }
  throw new Error(`unknown trigger contract: ${input.contract}`);
}

function modal(input, modalType) {
  const tuple = modalDedupeTuple({
    viewerSeatId: input.viewerSeatId,
    modalType,
    triggerId: input.triggerId,
    stateVersion: input.stateVersion,
  });
  return Object.freeze({ modalType, priority: MODAL_PRIORITY[modalType], dedupeTuple: tuple });
}

export function buildModalQueue(candidates) {
  const unique = new Map();
  for (const candidate of candidates) {
    if (!candidate?.modal) continue;
    const key = JSON.stringify(candidate.modal.dedupeTuple);
    if (!unique.has(key)) unique.set(key, candidate.modal);
  }
  return [...unique.values()].sort((left, right) =>
    right.priority - left.priority
    || left.dedupeTuple[2].localeCompare(right.dedupeTuple[2], 'en')
    || left.dedupeTuple[3] - right.dedupeTuple[3]);
}

export function projectVisibleEvent(event, context) {
  const sameRoom = event.roomId === context.roomId && event.runId === context.runId;
  const addressed = event.viewerSeatIds?.includes(context.viewerSeatId) === true;
  if (!sameRoom || !addressed || event.disclosure === 'HIDDEN') return null;
  if (event.disclosure === 'CONFIRMED' && event.authorizedEvidence !== true) return null;
  const allowed = new Set([
    'eventId', 'roomId', 'runId', 'viewerSeatIds', 'disclosure', 'authorizedEvidence',
    'title', 'safeSummary', 'trigger', 'responseOptions', 'eventSequence', 'stateVersion',
  ]);
  const output = {};
  for (const [key, value] of Object.entries(event)) {
    if (allowed.has(key)) output[key] = structuredClone(value);
  }
  delete output.viewerSeatIds;
  delete output.authorizedEvidence;
  return output;
}

export function validateResponseTarget({ event, command, server }) {
  const reject = (code) => ({ accepted: false, code });
  if (!event || event.visibleToViewer !== true) return reject('EVENT_NOT_VISIBLE');
  if (event.roomId !== server.roomId || event.runId !== server.runId) return reject('CROSS_RUN_EVENT');
  if (event.eventId !== server.latestVisibleEventId) return reject('EVENT_NOT_LATEST');
  if (event.acknowledged === true) return reject('EVENT_ALREADY_ACKNOWLEDGED');
  if (!server.allowedResponseActionCodes.includes(command.actionCode)) return reject('ACTION_NOT_ALLOWED');
  if (command.expectedWorkingRevision !== server.workingRevision) return reject('STALE_WORKING_REVISION');
  if (command.controlEpoch !== server.controlEpoch) return reject('STALE_CONTROL_EPOCH');
  if (command.submissionFenceToken !== server.submissionFenceToken) return reject('STALE_SUBMISSION_FENCE');
  const prior = server.idempotencyReceipts.get(command.idempotencyKey);
  if (prior) return { accepted: true, replay: true, receipt: prior };
  const receipt = Object.freeze({ responseToEventId: event.eventId, actionCode: command.actionCode });
  server.idempotencyReceipts.set(command.idempotencyKey, receipt);
  return { accepted: true, replay: false, receipt };
}

export class AtomicLedgerOutboxHarness {
  #ledger = new Map();
  #outbox = new Map();

  commit({ ledgerKey, outboxKey, payload, faultAt = null }) {
    const existing = this.#ledger.get(ledgerKey);
    if (existing) return { replay: true, receipt: existing };
    const stagedLedger = new Map(this.#ledger);
    const stagedOutbox = new Map(this.#outbox);
    const receipt = Object.freeze({ ledgerKey, outboxKey, payload: structuredClone(payload) });
    stagedLedger.set(ledgerKey, receipt);
    if (faultAt === 'AFTER_LEDGER_BEFORE_OUTBOX') throw new Error('injected crash before atomic commit');
    stagedOutbox.set(outboxKey, Object.freeze({ outboxKey, ledgerKey, payload: structuredClone(payload) }));
    if (faultAt === 'AFTER_OUTBOX_BEFORE_COMMIT') throw new Error('injected crash before atomic commit');
    this.#ledger = stagedLedger;
    this.#outbox = stagedOutbox;
    return { replay: false, receipt };
  }

  snapshot() {
    return { ledger: [...this.#ledger.values()], outbox: [...this.#outbox.values()] };
  }
}

export async function runDeterministicSoloAi({ seats, decide, provider }) {
  const results = [];
  for (const seat of seats) results.push(await decide(seat));
  assert.equal(provider.invocations, 0, 'deterministic AI must never invoke a Provider/LLM');
  return results;
}
