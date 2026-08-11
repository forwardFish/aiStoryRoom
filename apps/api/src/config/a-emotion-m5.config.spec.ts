import assert from "node:assert/strict";
import test from "node:test";
import { CONTINUOUS_STORY_ENGINE_VERSION } from "@ai-story/shared";
import { aEmotionM5Rules, isAEmotionM5EnabledForRun, readAEmotionM5Config, shouldFreezeAEmotionM5ForNewRun } from "./a-emotion-m5.config";

const baseEnv = {
  A_EMOTION_M1_ENABLED: "true",
  A_EMOTION_M2_ENABLED: "true",
  A_EMOTION_M4_ENABLED: "true",
  A_EMOTION_SIMPLE_PROMISE_ENABLED: "true",
  A_EMOTION_M5_ENABLED: "true",
  A_EMOTION_STAGE_MILESTONES_ENABLED: "true",
  A_EMOTION_INTERACTION_HISTORY_ENABLED: "true"
};

test("M5 flags default off and freeze only an eligible M4 multiplayer room", () => {
  assert.deepEqual(readAEmotionM5Config({}).masterEnabled, false);
  assert.equal(shouldFreezeAEmotionM5ForNewRun({ processEnabled: true, stageMilestonesEnabled: true, interactionHistoryEnabled: true, m4Enabled: true, templateKey: "sangtian", mode: "room", maxPlayers: 3 }), true);
  assert.equal(shouldFreezeAEmotionM5ForNewRun({ processEnabled: true, stageMilestonesEnabled: true, interactionHistoryEnabled: true, m4Enabled: true, templateKey: "sangtian", mode: "room", maxPlayers: 1 }), false);
});

test("M5 run gate is frozen and rules contain exact canonical codes only", () => {
  const run = { templateKey: "sangtian", mode: "room", maxPlayers: 3, engineVersion: CONTINUOUS_STORY_ENGINE_VERSION, stateJson: { featureFlags: { aEmotionM1: true, aEmotionM2: true, aEmotionM4: true, aEmotionSimplePromise: true, aEmotionM5: true, aEmotionStageMilestones: true, aEmotionInteractionHistory: true } } };
  assert.equal(isAEmotionM5EnabledForRun(run, baseEnv), true);
  assert.equal(isAEmotionM5EnabledForRun({ ...run, mode: "single" }, baseEnv), false);
  const rules = aEmotionM5Rules();
  assert.equal(rules.length, 3);
  assert.equal(JSON.stringify(rules).includes("regex"), false);
  assert.equal(JSON.stringify(rules).includes("关键词"), false);
});
