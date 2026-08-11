import {
  A_EMOTION_M6_FROZEN_FLAGS_SCHEMA_VERSION,
  A_EMOTION_M6_PAUSE_STATE_SCHEMA_VERSION,
  A_EMOTION_M6_ROOM_POLICY_SCHEMA_VERSION,
  A_EMOTION_M6_VIEWER_STATE_SCHEMA_VERSION,
  validateAEmotionM6PauseStateV1,
  validateAEmotionM6RoomPolicyV1,
  validateAEmotionM6ViewerStateV1,
  type AEmotionM6FrozenFlagsV1,
  type AEmotionM6PauseStateV1,
  type AEmotionM6RoomPolicyV1,
  type AEmotionM6ViewerStateV1
} from "@ai-story/shared";

export type AEmotionFrozenCapability = Exclude<keyof AEmotionM6FrozenFlagsV1, "schemaVersion" | "pollIntervalMs">;

export function createAEmotionRoomPolicy(input: {
  aEmotionEnabled: boolean;
  situationFeedEnabled: boolean;
  crossImpactCardEnabled: boolean;
  keyModalsEnabled: boolean;
  simplePromiseEnabled: boolean;
  interactionHistoryEnabled: boolean;
  recoveryEnabled: boolean;
  pollIntervalMs: number;
  frozenAt?: Date;
}): AEmotionM6RoomPolicyV1 {
  const policy: AEmotionM6RoomPolicyV1 = {
    schemaVersion: A_EMOTION_M6_ROOM_POLICY_SCHEMA_VERSION,
    rulesetVersion: "a-emotion-v1",
    frozenAt: (input.frozenAt ?? new Date()).toISOString(),
    flags: {
      schemaVersion: A_EMOTION_M6_FROZEN_FLAGS_SCHEMA_VERSION,
      aEmotionEnabled: input.aEmotionEnabled,
      situationFeedEnabled: input.aEmotionEnabled && input.situationFeedEnabled,
      crossImpactCardEnabled: input.aEmotionEnabled && input.situationFeedEnabled && input.crossImpactCardEnabled,
      keyModalsEnabled: input.aEmotionEnabled && input.situationFeedEnabled && input.keyModalsEnabled,
      simplePromiseEnabled: input.aEmotionEnabled && input.simplePromiseEnabled,
      interactionHistoryEnabled: input.aEmotionEnabled && input.situationFeedEnabled && input.interactionHistoryEnabled,
      recoveryEnabled: input.aEmotionEnabled && input.recoveryEnabled,
      pollIntervalMs: input.pollIntervalMs
    }
  };
  const validated = validateAEmotionM6RoomPolicyV1(policy);
  if (!validated.ok) throw new Error(`A_EMOTION_ROOM_POLICY_INVALID:${validated.errors.join("|")}`);
  return validated.value;
}

/**
 * `null` means a pre-M6 room with no frozen policy. A malformed explicit M6
 * snapshot returns a disabled policy so it can never inherit a later process
 * environment.
 */
export function readAEmotionRoomPolicy(stateJson: unknown): AEmotionM6RoomPolicyV1 | null {
  const root = record(stateJson);
  if (!("aEmotionRuleset" in root)) return null;
  const validated = validateAEmotionM6RoomPolicyV1(root.aEmotionRuleset);
  return validated.ok ? validated.value : disabledPolicy();
}

export function frozenAEmotionCapability(stateJson: unknown, capability: AEmotionFrozenCapability): boolean | null {
  const policy = readAEmotionRoomPolicy(stateJson);
  return policy ? policy.flags[capability] === true : null;
}

export function frozenAEmotionPollInterval(stateJson: unknown): number | null {
  return readAEmotionRoomPolicy(stateJson)?.flags.pollIntervalMs ?? null;
}

export function readAEmotionPauseState(stateJson: unknown): AEmotionM6PauseStateV1 {
  const root = record(stateJson);
  if (!("aEmotionM6Recovery" in root)) return defaultPauseState();
  const validated = validateAEmotionM6PauseStateV1(root.aEmotionM6Recovery);
  return validated.ok ? validated.value : { ...defaultPauseState(), paused: true, reason: "MALFORMED_RECOVERY_STATE" };
}

export function nextAEmotionPauseState(input: { previous: AEmotionM6PauseStateV1; paused: boolean; reason: string; changedAt?: Date }): AEmotionM6PauseStateV1 {
  const candidate: AEmotionM6PauseStateV1 = {
    schemaVersion: A_EMOTION_M6_PAUSE_STATE_SCHEMA_VERSION,
    version: input.previous.version + 1,
    paused: input.paused,
    reason: input.paused ? input.reason.trim() : "",
    changedAt: (input.changedAt ?? new Date()).toISOString()
  };
  const validated = validateAEmotionM6PauseStateV1(candidate);
  if (!validated.ok) throw new Error(`A_EMOTION_PAUSE_STATE_INVALID:${validated.errors.join("|")}`);
  return validated.value;
}

export function aEmotionViewerState(stateJson: unknown): AEmotionM6ViewerStateV1 | undefined {
  const policy = readAEmotionRoomPolicy(stateJson);
  if (!policy) return undefined;
  const pause = readAEmotionPauseState(stateJson);
  const candidate: AEmotionM6ViewerStateV1 = { schemaVersion: A_EMOTION_M6_VIEWER_STATE_SCHEMA_VERSION, features: policy.flags, paused: pause.paused, pauseVersion: pause.version };
  const validated = validateAEmotionM6ViewerStateV1(candidate);
  return validated.ok ? validated.value : undefined;
}

export function defaultPauseState(now = new Date(0)): AEmotionM6PauseStateV1 {
  return { schemaVersion: A_EMOTION_M6_PAUSE_STATE_SCHEMA_VERSION, version: 0, paused: false, reason: "", changedAt: now.toISOString() };
}

export function disabledAEmotionRoomPolicy(previous?: AEmotionM6RoomPolicyV1 | null): AEmotionM6RoomPolicyV1 {
  return createAEmotionRoomPolicy({ aEmotionEnabled: false, situationFeedEnabled: false, crossImpactCardEnabled: false, keyModalsEnabled: false, simplePromiseEnabled: false, interactionHistoryEnabled: false, recoveryEnabled: false, pollIntervalMs: previous?.flags.pollIntervalMs ?? 7_000, frozenAt: previous ? new Date(previous.frozenAt) : new Date(0) });
}

function disabledPolicy(): AEmotionM6RoomPolicyV1 { return disabledAEmotionRoomPolicy(null); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
