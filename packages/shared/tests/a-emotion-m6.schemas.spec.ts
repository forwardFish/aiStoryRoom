import assert from "node:assert/strict";
import test from "node:test";
import {
  A_EMOTION_M6_BOUNDARY_SCHEMA_VERSION,
  A_EMOTION_M6_FROZEN_FLAGS_SCHEMA_VERSION,
  A_EMOTION_M6_PAUSE_STATE_SCHEMA_VERSION,
  A_EMOTION_M6_POLICY_SCHEMA_VERSION,
  A_EMOTION_M6_RECOVERY_RESULT_SCHEMA_VERSION,
  A_EMOTION_M6_ROOM_POLICY_SCHEMA_VERSION,
  A_EMOTION_M6_VIEWER_STATE_SCHEMA_VERSION,
  validateAEmotionM6BoundaryV1,
  validateAEmotionM6FrozenFlagsV1,
  validateAEmotionM6PauseStateV1,
  validateAEmotionM6RecoveryPolicyV1,
  validateAEmotionM6RecoveryResultV1,
  validateAEmotionM6RoomPolicyV1,
  validateAEmotionM6ViewerStateV1
} from "../src/continuous-strategy/a-emotion-m6.schemas";

const flags = { schemaVersion: A_EMOTION_M6_FROZEN_FLAGS_SCHEMA_VERSION, aEmotionEnabled: true, situationFeedEnabled: true, crossImpactCardEnabled: true, keyModalsEnabled: true, simplePromiseEnabled: true, interactionHistoryEnabled: true, recoveryEnabled: true, pollIntervalMs: 7000 };

test("M6 frozen flags are explicit independently disableable and fail closed", () => {
  assert.equal(validateAEmotionM6FrozenFlagsV1(flags).ok, true);
  assert.equal(validateAEmotionM6FrozenFlagsV1({ ...flags, aEmotionEnabled: false }).ok, false);
  assert.equal(validateAEmotionM6FrozenFlagsV1({ ...flags, keyModalsEnabled: false }).ok, true);
  assert.equal(validateAEmotionM6FrozenFlagsV1({ ...flags, situationFeedEnabled: false, crossImpactCardEnabled: true }).ok, false);
  assert.equal(validateAEmotionM6FrozenFlagsV1({ ...flags, unknown: true }).ok, false);
});
test("M6 recovery policy enforces bounded retry lease and deadline", () => {
  const policy = { schemaVersion: A_EMOTION_M6_POLICY_SCHEMA_VERSION, maxAttempts: 5, leaseMs: 30_000, retryBaseMs: 500, deadlineMs: 300_000, deadLetterAfterAttempts: 5, failClosed: true };
  assert.equal(validateAEmotionM6RecoveryPolicyV1(policy).ok, true);
  assert.equal(validateAEmotionM6RecoveryPolicyV1({ ...policy, failClosed: false }).ok, false);
  assert.equal(validateAEmotionM6RecoveryPolicyV1({ ...policy, deadLetterAfterAttempts: 4 }).ok, false);
});
test("M6 recovery result is strict and non-negative", () => {
  const result = { schemaVersion: A_EMOTION_M6_RECOVERY_RESULT_SCHEMA_VERSION, recoveredExpiredLeases: 2, recoveredLegacyLeases: 1, deadLetteredTasks: 1, leftCompletedUntouched: 4, recoveredAt: "2026-08-10T00:00:00.000Z" };
  assert.equal(validateAEmotionM6RecoveryResultV1(result).ok, true);
  assert.equal(validateAEmotionM6RecoveryResultV1({ ...result, recoveredExpiredLeases: -1 }).ok, false);
  assert.equal(validateAEmotionM6RecoveryResultV1({ ...result, skippedUnrelatedTasks: 3 }).ok, false);
});
test("M6 request boundary binds room run user role and all versions", () => {
  const boundary = { schemaVersion: A_EMOTION_M6_BOUNDARY_SCHEMA_VERSION, roomId: "room-1", runId: "room-1", userId: "user-1", roleId: "role-1", runVersion: 8, projectionVersion: 3, stateVersion: 12 };
  assert.equal(validateAEmotionM6BoundaryV1(boundary).ok, true);
  assert.equal(validateAEmotionM6BoundaryV1({ ...boundary, runId: "run-other" }).ok, false);
  assert.equal(validateAEmotionM6BoundaryV1({ ...boundary, projectionVersion: 0 }).ok, false);
  assert.equal(validateAEmotionM6BoundaryV1({ ...boundary, rawAudience: ["role-secret"] }).ok, false);
});
test("M6 room policy pause and viewer states are strict frozen contracts", () => {
  const policy = { schemaVersion: A_EMOTION_M6_ROOM_POLICY_SCHEMA_VERSION, rulesetVersion: "a-emotion-v1", frozenAt: "2026-08-10T00:00:00.000Z", flags };
  const pause = { schemaVersion: A_EMOTION_M6_PAUSE_STATE_SCHEMA_VERSION, version: 1, paused: true, reason: "operator pause", changedAt: "2026-08-10T00:00:01.000Z" };
  const viewer = { schemaVersion: A_EMOTION_M6_VIEWER_STATE_SCHEMA_VERSION, features: flags, paused: true, pauseVersion: 1 };
  assert.equal(validateAEmotionM6RoomPolicyV1(policy).ok, true);
  assert.equal(validateAEmotionM6PauseStateV1(pause).ok, true);
  assert.equal(validateAEmotionM6ViewerStateV1(viewer).ok, true);
  assert.equal(validateAEmotionM6PauseStateV1({ ...pause, reason: "" }).ok, false);
  assert.equal(validateAEmotionM6RoomPolicyV1({ ...policy, extra: true }).ok, false);
});
