import assert from "node:assert/strict";
import test from "node:test";
import { CONTINUOUS_STORY_ENGINE_VERSION } from "@ai-story/shared";
import { isAEmotionM1EnabledForRun, readAEmotionM1Config, shouldFreezeAEmotionM1ForNewRun } from "./a-emotion-m1.config";

const run = {
  mode: "room",
  maxPlayers: 3,
  templateKey: "sangtian",
  engineVersion: CONTINUOUS_STORY_ENGINE_VERSION,
  stateJson: { featureFlags: { aEmotionM1: true } }
};

test("M1 defaults off and accepts only exact booleans", () => {
  assert.equal(readAEmotionM1Config({}).masterEnabled, false);
  assert.equal(readAEmotionM1Config({ A_EMOTION_M1_ENABLED: "true" }).masterEnabled, true);
  assert.throws(() => readAEmotionM1Config({ A_EMOTION_M1_ENABLED: "1" }), /exactly true or false/);
});

test("M1 requires process and room flags plus exact multiplayer world boundary", () => {
  const env = { A_EMOTION_M1_ENABLED: "true" };
  assert.equal(isAEmotionM1EnabledForRun(run, env), true);
  assert.equal(isAEmotionM1EnabledForRun({ ...run, stateJson: {} }, env), false);
  assert.equal(isAEmotionM1EnabledForRun({ ...run, maxPlayers: 1 }, env), false);
  assert.equal(isAEmotionM1EnabledForRun({ ...run, templateKey: "caesar" }, env), false);
  assert.equal(isAEmotionM1EnabledForRun({ ...run, engineVersion: "legacy_v1" }, env), false);
});


test("new-room snapshot flag is frozen only for explicitly enabled Sangtian multiplayer V2 runs", () => {
  const env = { A_EMOTION_M1_ENABLED: "true" };
  assert.equal(shouldFreezeAEmotionM1ForNewRun({ templateKey: "sangtian", mode: "room", maxPlayers: 3, engineVersion: CONTINUOUS_STORY_ENGINE_VERSION }, env), true);
  assert.equal(shouldFreezeAEmotionM1ForNewRun({ templateKey: "sangtian", mode: "room", maxPlayers: 1, engineVersion: CONTINUOUS_STORY_ENGINE_VERSION }, env), false);
  assert.equal(shouldFreezeAEmotionM1ForNewRun({ templateKey: "caesar", mode: "room", maxPlayers: 3, engineVersion: CONTINUOUS_STORY_ENGINE_VERSION }, env), false);
  assert.equal(shouldFreezeAEmotionM1ForNewRun({ templateKey: "sangtian", mode: "room", maxPlayers: 3, engineVersion: "legacy_v1" }, env), false);
  assert.equal(shouldFreezeAEmotionM1ForNewRun({ templateKey: "sangtian", mode: "room", maxPlayers: 3, engineVersion: CONTINUOUS_STORY_ENGINE_VERSION }, {}), false);
});
