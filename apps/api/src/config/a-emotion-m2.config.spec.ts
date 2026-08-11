import assert from "node:assert/strict";
import test from "node:test";
import { CONTINUOUS_STORY_ENGINE_VERSION } from "@ai-story/shared";
import {
  isAEmotionM2EnabledForRun,
  readAEmotionM2Config,
  shouldFreezeAEmotionM2ForNewRun
} from "./a-emotion-m2.config";

const run = {
  mode: "room",
  maxPlayers: 3,
  templateKey: "sangtian",
  engineVersion: CONTINUOUS_STORY_ENGINE_VERSION,
  stateJson: { featureFlags: { aEmotionM1: true, aEmotionM2: true } }
};

test("M2 defaults off and accepts only exact booleans", () => {
  assert.deepEqual(readAEmotionM2Config({}), { masterEnabled: false });
  assert.deepEqual(readAEmotionM2Config({ A_EMOTION_M2_ENABLED: "true" }), { masterEnabled: true });
  assert.throws(() => readAEmotionM2Config({ A_EMOTION_M2_ENABLED: "1" }), /exactly true or false/);
});

test("M2 freezes only for new eligible M1 multiplayer rooms and old rooms fail closed", () => {
  assert.equal(shouldFreezeAEmotionM2ForNewRun({ processEnabled: true, m1Enabled: true, templateKey: "sangtian", mode: "room", maxPlayers: 3 }), true);
  assert.equal(shouldFreezeAEmotionM2ForNewRun({ processEnabled: true, m1Enabled: false, templateKey: "sangtian", mode: "room", maxPlayers: 3 }), false);
  assert.equal(shouldFreezeAEmotionM2ForNewRun({ processEnabled: true, m1Enabled: true, templateKey: "caesar", mode: "room", maxPlayers: 3 }), false);
  assert.equal(shouldFreezeAEmotionM2ForNewRun({ processEnabled: true, m1Enabled: true, templateKey: "sangtian", mode: "solo", maxPlayers: 1 }), false);

  assert.equal(isAEmotionM2EnabledForRun(run, { A_EMOTION_M1_ENABLED: "true", A_EMOTION_M2_ENABLED: "true" }), true);
  assert.equal(isAEmotionM2EnabledForRun({ ...run, stateJson: { featureFlags: { aEmotionM1: true } } }, { A_EMOTION_M1_ENABLED: "true", A_EMOTION_M2_ENABLED: "true" }), false);
  assert.equal(isAEmotionM2EnabledForRun(run, { A_EMOTION_M1_ENABLED: "true", A_EMOTION_M2_ENABLED: "false" }), false);
  assert.equal(isAEmotionM2EnabledForRun({ ...run, mode: "solo", maxPlayers: 1 }, { A_EMOTION_M1_ENABLED: "true", A_EMOTION_M2_ENABLED: "true" }), false);
});
