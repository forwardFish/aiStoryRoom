import assert from "node:assert/strict";
import test from "node:test";
import { policyForNewRun, readCreditConsumptionConfig, supportsActiveActionBilling } from "./credit-consumption.config";

test("credit consumption defaults are safe and preserve legacy runs", () => {
  const config = readCreditConsumptionConfig({});
  assert.equal(config.defaultPolicy, "world_unlock_v1");
  assert.equal(config.meteringMode, "OFF");
  assert.deepEqual(config.prices, {
    currency: "WORLD_CREDITS",
    runCreate: 20,
    standardAction: 1,
    customAction: 2,
    complexAction: 2,
    sponsorshipPack: 10
  });
});

test("credit consumption config rejects unsafe values at startup", () => {
  assert.throws(() => readCreditConsumptionConfig({ CREDIT_ACTION_METERING_MODE: "ON" }), /OFF\|SHADOW\|ENFORCED/);
  assert.throws(() => readCreditConsumptionConfig({ CREDIT_RUN_SPONSORSHIP_AMOUNT: "0" }), /between 1/);
  assert.throws(() => readCreditConsumptionConfig({ AI_BATCH_MAX_WAIT_MS: "251" }), /between 1 and 250/);
  assert.throws(() => readCreditConsumptionConfig({ AI_BATCHING_ENABLED: "yes" }), /exactly true or false/);
});

test("active-action billing is only assigned to engines whose actions are metered", () => {
  assert.equal(supportsActiveActionBilling("continuous_strategy_v1_1"), true);
  assert.equal(supportsActiveActionBilling("continuous_story_v2"), true);
  assert.equal(supportsActiveActionBilling("solo_story_v2"), true);
  assert.equal(supportsActiveActionBilling("legacy_v1"), false);
  assert.equal(policyForNewRun("active_action_v1", "continuous_story_v2"), "active_action_v1");
  assert.equal(policyForNewRun("active_action_v1", "legacy_v1"), "world_unlock_v1");
  assert.equal(policyForNewRun("world_unlock_v1", "continuous_story_v2"), "world_unlock_v1");
});
