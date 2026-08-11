import assert from "node:assert/strict";
import test from "node:test";
import {
  A_EMOTION_M4_COMMAND_SCHEMA_VERSION,
  A_EMOTION_M4_PROMISE_SCHEMA_VERSION,
  A_EMOTION_M4_TERMS_SCHEMA_VERSION,
  validateAEmotionSimplePromiseCommandV1,
  validateAEmotionSimplePromiseTermsV1,
  validateAEmotionSimplePromiseV1
} from "../src/continuous-strategy/a-emotion-m4.schemas";

const terms = {
  schemaVersion: A_EMOTION_M4_TERMS_SCHEMA_VERSION,
  obligationCode: "DELIVER_ORIGINAL_DOCUMENT",
  relatedObjectId: "original-grain-ledger",
  deadlineStage: 4,
  fulfillActionCodes: ["DELIVER_ORIGINAL_LEDGER"],
  fulfillEffectCodes: ["ORIGINAL_LEDGER_DELIVERED"],
  fulfillFactCodes: ["ORIGINAL_LEDGER_DELIVERY_CONFIRMED"],
  breakActionCodes: ["WITHHOLD_ORIGINAL_LEDGER"],
  breakEffectCodes: ["ORIGINAL_LEDGER_WITHHELD"],
  breakFactCodes: ["ORIGINAL_LEDGER_NOT_DELIVERED"],
  revealEvidenceFactCodes: ["PROMISE_LEDGER_BREACH_CONFIRMED"],
  expiryOutcome: "BROKEN"
};

test("M4 accepts only explicit preset promise commands", () => {
  const command = {
    schemaVersion: A_EMOTION_M4_COMMAND_SCHEMA_VERSION,
    idempotencyKey: "promise:request:0001",
    promiseCode: "DELIVER_ORIGINAL_LEDGER",
    targetRoleKey: "target",
    expectedStage: 2
  };
  assert.equal(validateAEmotionSimplePromiseCommandV1(command).ok, true);
  assert.equal(validateAEmotionSimplePromiseCommandV1({ ...command, promiseCode: "FREE_TEXT_PROMISE" }).ok, false);
  assert.equal(validateAEmotionSimplePromiseCommandV1({ ...command, idempotencyKey: "short" }).ok, false);
  assert.equal(validateAEmotionSimplePromiseCommandV1({ ...command, statement: "I promise anything" }).ok, false);
});

test("M4 terms use exact canonical codes and reject prose or regex rules", () => {
  assert.equal(validateAEmotionSimplePromiseTermsV1(terms).ok, true);
  assert.equal(validateAEmotionSimplePromiseTermsV1({ ...terms, fulfillActionCodes: [], fulfillEffectCodes: [], fulfillFactCodes: [] }).ok, false);
  assert.equal(validateAEmotionSimplePromiseTermsV1({ ...terms, unexpectedRegex: "承诺|答应" }).ok, false);
});

test("M4 revealed promise requires durable evidence", () => {
  const base = {
    schemaVersion: A_EMOTION_M4_PROMISE_SCHEMA_VERSION,
    promiseId: `prm_${"a".repeat(32)}`,
    roomId: "run-1",
    runId: "run-1",
    promiseCode: "DELIVER_ORIGINAL_LEDGER",
    issuerRoleId: "role-a",
    receiverRoleId: "role-b",
    relatedObjectId: "original-grain-ledger",
    visibility: "LIMITED",
    status: "REVEALED",
    deadlineStage: 4,
    stateVersion: 3,
    brokenByActionId: "action-1",
    evidenceRefs: ["fact:chain"],
    createdAt: "2026-08-10T00:00:00.000Z",
    fulfilledAt: null,
    breachedAt: "2026-08-10T00:02:00.000Z",
    revealedAt: "2026-08-10T00:03:00.000Z",
    expiredAt: null
  };
  assert.equal(validateAEmotionSimplePromiseV1(base).ok, true);
  assert.equal(validateAEmotionSimplePromiseV1({ ...base, evidenceRefs: [] }).ok, false);
  assert.equal(validateAEmotionSimplePromiseV1({ ...base, sourceRoleId: "role-a" }).ok, false);
});
