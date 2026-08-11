import assert from "node:assert/strict";
import test from "node:test";
import { CONTINUOUS_STORY_ENGINE_VERSION } from "@ai-story/shared";
import { isAEmotionM3EnabledForRun, readAEmotionM3Config, shouldFreezeAEmotionM3ForNewRun } from "./a-emotion-m3.config";

test("M3 process and modal flags default off", () => {
  const config = readAEmotionM3Config({});
  assert.equal(config.masterEnabled, false);
  assert.equal(config.keyModalsEnabled, false);
  assert.equal(config.rules[0].dangerAtOrBelow, 20);
});

test("M3 freezes only behind M2 for eligible multiplayer rooms", () => {
  assert.equal(shouldFreezeAEmotionM3ForNewRun({ processEnabled: true, keyModalsEnabled: true, m2Enabled: true, templateKey: "sangtian", mode: "room", maxPlayers: 3 }), true);
  assert.equal(shouldFreezeAEmotionM3ForNewRun({ processEnabled: true, keyModalsEnabled: true, m2Enabled: false, templateKey: "sangtian", mode: "room", maxPlayers: 3 }), false);
});

test("M3 old, solo, other-world and flag-off runs fail closed", () => {
  const env = { A_EMOTION_M1_ENABLED: "true", A_EMOTION_M2_ENABLED: "true", A_EMOTION_M3_ENABLED: "true", A_EMOTION_KEY_MODALS_ENABLED: "true" };
  const base = { mode: "room", maxPlayers: 3, templateKey: "sangtian", engineVersion: CONTINUOUS_STORY_ENGINE_VERSION, stateJson: { featureFlags: { aEmotionM1: true, aEmotionM2: true, aEmotionM3: true, aEmotionKeyModals: true } } };
  assert.equal(isAEmotionM3EnabledForRun(base, env), true);
  assert.equal(isAEmotionM3EnabledForRun({ ...base, mode: "single" }, env), false);
  assert.equal(isAEmotionM3EnabledForRun({ ...base, templateKey: "caesar" }, env), false);
  assert.equal(isAEmotionM3EnabledForRun({ ...base, stateJson: { featureFlags: { aEmotionM1: true, aEmotionM2: true } } }, env), false);
});
