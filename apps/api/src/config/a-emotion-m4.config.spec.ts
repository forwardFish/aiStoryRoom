import assert from "node:assert/strict";
import test from "node:test";
import { CONTINUOUS_STORY_ENGINE_VERSION } from "@ai-story/shared";
import { aEmotionM4Terms, isAEmotionM4EnabledForRun, readAEmotionM4Config, shouldFreezeAEmotionM4ForNewRun } from "./a-emotion-m4.config";

test("M4 flags default off and freeze only an eligible M2 multiplayer run", () => {
  assert.deepEqual(readAEmotionM4Config({}), { masterEnabled: false, simplePromiseEnabled: false });
  assert.equal(shouldFreezeAEmotionM4ForNewRun({ processEnabled: true, simplePromiseEnabled: true, m2Enabled: true, templateKey: "sangtian", mode: "room", maxPlayers: 3 }), true);
  assert.equal(shouldFreezeAEmotionM4ForNewRun({ processEnabled: true, simplePromiseEnabled: true, m2Enabled: false, templateKey: "sangtian", mode: "room", maxPlayers: 3 }), false);
  assert.equal(shouldFreezeAEmotionM4ForNewRun({ processEnabled: true, simplePromiseEnabled: true, m2Enabled: true, templateKey: "sangtian", mode: "single", maxPlayers: 1 }), false);
});

test("M4 lifecycle terms are exact structured codes and the run gate is frozen", () => {
  const terms = aEmotionM4Terms("DELIVER_ORIGINAL_LEDGER");
  assert.deepEqual(terms.breakActionCodes.slice(0, 2), ["WITHHOLD_ORIGINAL_LEDGER", "DELIVER_LEDGER_COPY_ONLY"]);
  assert.ok(terms.breakActionCodes.includes("main_s2_xunfu_seize_drafts"));
  assert.ok(terms.breakActionCodes.includes("main_s2_magistrate_send_copy"));
  assert.ok(terms.breakActionCodes.includes("main_s2_magistrate_hide_original"));
  assert.ok(terms.breakEffectCodes.includes("effect_main_s2_xunfu_seize_drafts"));
  assert.ok(terms.breakFactCodes.includes("fact_s2_xunfu_seize_drafts"));
  assert.ok(terms.revealEvidenceFactCodes.includes("fact_s4_clerk_certify_transfer_chain"));
  assert.equal(terms.expiryOutcome, "BROKEN");
  const run = {
    templateKey: "sangtian",
    mode: "room",
    maxPlayers: 3,
    engineVersion: CONTINUOUS_STORY_ENGINE_VERSION,
    stateJson: { featureFlags: { aEmotionM1: true, aEmotionM2: true, aEmotionM4: true, aEmotionSimplePromise: true } }
  };
  const env = {
    A_EMOTION_M1_ENABLED: "true",
    A_EMOTION_M2_ENABLED: "true",
    A_EMOTION_M4_ENABLED: "true",
    A_EMOTION_SIMPLE_PROMISE_ENABLED: "true"
  };
  assert.equal(isAEmotionM4EnabledForRun(run, env), true);
  assert.equal(isAEmotionM4EnabledForRun({ ...run, stateJson: { featureFlags: { aEmotionM4: false } } }, env), false);
});
