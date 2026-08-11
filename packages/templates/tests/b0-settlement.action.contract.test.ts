import assert from "node:assert/strict";
import test from "node:test";
import { validateB0ActionContractV1, validateB0SettlementBatchV1, validateB0SettlementSnapshotV1, validateB0TypedAudienceSpecV1 } from "@ai-story/shared";
import { assertB0BatchTransitionV1, B0ContractError } from "../src/runtime-contract/b0-settlement";
import { validAction, validBatch, validSnapshot } from "./b0-settlement.fixtures";

test("action contract validates one bounded effect and rejects nested unknown fields", () => {
  assert.equal(validateB0ActionContractV1(validAction()).ok, true);
  const candidate = { ...validAction(), primaryEffect: { ...validAction().primaryEffect, secondEffect: "forbidden" } };
  assert.equal(validateB0ActionContractV1(candidate).ok, false);
});

test("HOLD cannot smuggle targets or resources", () => {
  const hold = { ...validAction(), kind: "HOLD", targetRefs: [{ type: "ACTOR", id: "actor.b" }] };
  assert.equal(validateB0ActionContractV1(hold).ok, false);
});

test("snapshot and batch bind context and reject unknown fields", () => {
  assert.equal(validateB0SettlementSnapshotV1(validSnapshot()).ok, true);
  assert.equal(validateB0SettlementBatchV1(validBatch()).ok, true);
  assert.equal(validateB0SettlementSnapshotV1({ ...validSnapshot(), foreignRun: "run.2" }).ok, false);
  assert.equal(validateB0SettlementBatchV1({ ...validBatch(), lockedIntentIds: [] }).ok, false);
});

test("typed audience is a closed discriminated union", () => {
  assert.equal(validateB0TypedAudienceSpecV1({ type: "PUBLIC" }).ok, true);
  assert.equal(validateB0TypedAudienceSpecV1({ type: "ACTOR_ONLY", actorRef: "actor.a" }).ok, true);
  assert.equal(validateB0TypedAudienceSpecV1({ type: "ACTOR_ONLY", actorRef: "actor.a", actorIds: ["actor.b"] }).ok, false);
  assert.equal(validateB0TypedAudienceSpecV1({ type: "LEGACY_ACTORS", actorIds: ["actor.a"] }).ok, false);
});

test("batch state machine rejects illegal transition", () => {
  assert.doesNotThrow(() => assertB0BatchTransitionV1("PREPARED", "RESOLVING"));
  assert.throws(() => assertB0BatchTransitionV1("PREPARED", "COMMITTED"), B0ContractError);
});
