import assert from "node:assert/strict";
import test from "node:test";
import { CONTINUOUS_STORY_ENGINE_VERSION } from "@ai-story/shared";
import {
  aEmotionM6ViewerProjection,
  buildAEmotionM6RoomPolicy,
  frozenAEmotionM6Flags,
  frozenAEmotionM6PollInterval,
  isAEmotionM6EnabledForRun,
  readAEmotionM6Config,
  shouldFreezeAEmotionM6ForNewRun
} from "./a-emotion-m6.config";
import {
  createAEmotionRoomPolicy,
  defaultPauseState,
  disabledAEmotionRoomPolicy,
  frozenAEmotionCapability,
  nextAEmotionPauseState,
  readAEmotionPauseState,
  readAEmotionRoomPolicy
} from "./a-emotion-room-flags";

const eligibleRun = (stateJson: unknown) => ({
  templateKey: "sangtian",
  mode: "room",
  maxPlayers: 3,
  engineVersion: CONTINUOUS_STORY_ENGINE_VERSION,
  stateJson
});

function policyState() {
  const policy = buildAEmotionM6RoomPolicy({
    m1Enabled: true,
    m2Enabled: true,
    m3Enabled: true,
    m4Enabled: true,
    m5Enabled: true,
    m6Enabled: true,
    pollIntervalMs: 7_000,
    frozenAt: new Date("2026-08-10T00:00:00.000Z")
  });
  return { aEmotionRuleset: policy, aEmotionM6Recovery: defaultPauseState(new Date("2026-08-10T00:00:00.000Z")) };
}

test("M6 process configuration defaults off and freezes only after M5 for eligible rooms", () => {
  const config = readAEmotionM6Config({});
  assert.equal(config.masterEnabled, false);
  assert.equal(config.recoveryEnabled, false);
  assert.equal(config.e2eHarnessEnabled, false);
  assert.equal(config.pollIntervalMs, 7_000);
  assert.equal(config.policy.failClosed, true);

  assert.equal(shouldFreezeAEmotionM6ForNewRun({ processEnabled: true, recoveryEnabled: true, m5Enabled: true, templateKey: "sangtian", mode: "room", maxPlayers: 3 }), true);
  assert.equal(shouldFreezeAEmotionM6ForNewRun({ processEnabled: true, recoveryEnabled: true, m5Enabled: false, templateKey: "sangtian", mode: "room", maxPlayers: 3 }), false);
  assert.equal(shouldFreezeAEmotionM6ForNewRun({ processEnabled: true, recoveryEnabled: true, m5Enabled: true, templateKey: "sangtian", mode: "single", maxPlayers: 3 }), false);
  assert.equal(shouldFreezeAEmotionM6ForNewRun({ processEnabled: true, recoveryEnabled: true, m5Enabled: true, templateKey: "sangtian", mode: "room", maxPlayers: 1 }), false);
});

test("M6 reads only the room-frozen policy and old or malformed rooms fail closed", () => {
  const stateJson = policyState();
  const run = eligibleRun(stateJson);
  assert.equal(isAEmotionM6EnabledForRun(run), true);
  assert.equal(isAEmotionM6EnabledForRun({ ...run, mode: "single" }), false);
  assert.equal(isAEmotionM6EnabledForRun({ ...run, templateKey: "caesar" }), false);
  assert.equal(isAEmotionM6EnabledForRun(eligibleRun({ featureFlags: { aEmotionM6: true, aEmotionRecovery: true } })), false, "pre-M6 rooms must not inherit environment state");
  assert.equal(isAEmotionM6EnabledForRun(eligibleRun({ aEmotionRuleset: { broken: true } })), false);

  const flags = frozenAEmotionM6Flags(run);
  assert.equal(flags?.recoveryEnabled, true);
  assert.equal(frozenAEmotionM6PollInterval(run), 7_000);
  assert.equal(aEmotionM6ViewerProjection(run)?.paused, false);
  assert.equal(aEmotionM6ViewerProjection(run)?.features.situationFeedEnabled, true);
});

test("frozen capability, pause and rollback contracts preserve authority while disabling surfaces", () => {
  const stateJson = policyState();
  assert.equal(frozenAEmotionCapability(stateJson, "aEmotionEnabled"), true);
  assert.equal(frozenAEmotionCapability({}, "aEmotionEnabled"), null);
  const malformed = readAEmotionRoomPolicy({ aEmotionRuleset: { schemaVersion: "bad" } });
  assert.equal(malformed?.flags.aEmotionEnabled, false);

  const paused = nextAEmotionPauseState({ previous: readAEmotionPauseState(stateJson), paused: true, reason: "operator pause", changedAt: new Date("2026-08-10T00:00:01.000Z") });
  assert.equal(paused.version, 1);
  assert.equal(paused.paused, true);
  const resumed = nextAEmotionPauseState({ previous: paused, paused: false, reason: "", changedAt: new Date("2026-08-10T00:00:02.000Z") });
  assert.equal(resumed.version, 2);
  assert.equal(resumed.paused, false);

  const disabled = disabledAEmotionRoomPolicy(readAEmotionRoomPolicy(stateJson));
  assert.equal(disabled.flags.aEmotionEnabled, false);
  assert.equal(disabled.flags.situationFeedEnabled, false);
  assert.equal(disabled.flags.recoveryEnabled, false);
  assert.equal(disabled.flags.pollIntervalMs, 7_000);
});

test("room policy construction maintains capability dependency order", () => {
  const policy = createAEmotionRoomPolicy({
    aEmotionEnabled: true,
    situationFeedEnabled: false,
    crossImpactCardEnabled: true,
    keyModalsEnabled: true,
    simplePromiseEnabled: true,
    interactionHistoryEnabled: true,
    recoveryEnabled: true,
    pollIntervalMs: 9_000,
    frozenAt: new Date("2026-08-10T00:00:00.000Z")
  });
  assert.equal(policy.flags.aEmotionEnabled, true);
  assert.equal(policy.flags.situationFeedEnabled, false);
  assert.equal(policy.flags.crossImpactCardEnabled, false);
  assert.equal(policy.flags.keyModalsEnabled, false);
  assert.equal(policy.flags.interactionHistoryEnabled, false);
  assert.equal(policy.flags.simplePromiseEnabled, true);
  assert.equal(policy.flags.recoveryEnabled, true);
  assert.equal(policy.flags.pollIntervalMs, 9_000);
});

test("M6 environment parser rejects malformed values", () => {
  assert.throws(() => readAEmotionM6Config({ A_EMOTION_M6_ENABLED: "1" }), /exactly true or false/u);
  assert.throws(() => readAEmotionM6Config({ A_EMOTION_M6_MAX_ATTEMPTS: "0" }), /1\.\.20/u);
  assert.throws(() => readAEmotionM6Config({ A_EMOTION_M6_LEASE_MS: "4999" }), /5000\.\.1800000/u);
});
