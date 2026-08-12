import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPressureNarrativeTransition,
  assertPressureOutboxTaskType,
  assertPressureOutboxTransition,
  pressureAudienceKey,
} from "./vocabulary";

test("Outbox vocabulary fails closed", () => {
  assert.doesNotThrow(() => assertPressureOutboxTaskType("COMPUTE_FINALE"));
  assert.doesNotThrow(() => assertPressureOutboxTaskType("INTERACTION_COMPILE_REQUESTED"));
  assert.throws(() => assertPressureOutboxTaskType("CALL_PROVIDER_INSIDE_COMMIT"));
  assert.doesNotThrow(() => assertPressureOutboxTransition("PENDING", "LEASED"));
  assert.throws(() => assertPressureOutboxTransition("COMPLETED", "LEASED"));
});

test("Narrative publication is recoverable but a published provider artifact is terminal", () => {
  assert.doesNotThrow(() => assertPressureNarrativeTransition("PENDING", "GENERATING"));
  assert.throws(() => assertPressureNarrativeTransition("FALLBACK_PUBLISHED", "GENERATING"));
  assert.doesNotThrow(() => assertPressureNarrativeTransition("FALLBACK_PUBLISHED", "PUBLISHED"));
  assert.throws(() => assertPressureNarrativeTransition("PUBLISHED", "GENERATING"));
});

test("audience keys make PUBLIC nullable-seat uniqueness deterministic", () => {
  assert.equal(pressureAudienceKey("PUBLIC", null), "PUBLIC");
  assert.equal(pressureAudienceKey("SEAT", "cabinet_finance"), "cabinet_finance");
  assert.throws(() => pressureAudienceKey("PUBLIC", "cabinet_finance"));
  assert.throws(() => pressureAudienceKey("SEAT", "unknown-seat"));
});
