import {
  A_EMOTION_M6_POLICY_SCHEMA_VERSION,
  validateAEmotionM6RecoveryPolicyV1,
  type AEmotionM6RecoveryPolicyV1
} from "@ai-story/shared";
import { isAEmotionM5EnabledForRun, type AEmotionM5RunGate } from "./a-emotion-m5.config";
import {
  aEmotionViewerState,
  createAEmotionRoomPolicy,
  frozenAEmotionCapability,
  frozenAEmotionPollInterval,
  readAEmotionPauseState,
  readAEmotionRoomPolicy
} from "./a-emotion-room-flags";

export type AEmotionM6RunGate = AEmotionM5RunGate;

export function readAEmotionM6Config(env: NodeJS.ProcessEnv = process.env) {
  const policy: AEmotionM6RecoveryPolicyV1 = {
    schemaVersion: A_EMOTION_M6_POLICY_SCHEMA_VERSION,
    maxAttempts: integer(env.A_EMOTION_M6_MAX_ATTEMPTS, 5, 1, 20, "A_EMOTION_M6_MAX_ATTEMPTS"),
    leaseMs: integer(env.A_EMOTION_M6_LEASE_MS, 30_000, 5_000, 1_800_000, "A_EMOTION_M6_LEASE_MS"),
    retryBaseMs: integer(env.A_EMOTION_M6_RETRY_BASE_MS, 500, 100, 60_000, "A_EMOTION_M6_RETRY_BASE_MS"),
    deadlineMs: integer(env.A_EMOTION_M6_DEADLINE_MS, 300_000, 10_000, 86_400_000, "A_EMOTION_M6_DEADLINE_MS"),
    deadLetterAfterAttempts: integer(env.A_EMOTION_M6_DEAD_LETTER_ATTEMPTS, 5, 1, 20, "A_EMOTION_M6_DEAD_LETTER_ATTEMPTS"),
    failClosed: true
  };
  const validated = validateAEmotionM6RecoveryPolicyV1(policy);
  if (!validated.ok) throw new Error(`A_EMOTION_M6_POLICY_INVALID:${validated.errors.join("|")}`);
  return {
    masterEnabled: strictBoolean(env.A_EMOTION_M6_ENABLED, false, "A_EMOTION_M6_ENABLED"),
    recoveryEnabled: strictBoolean(env.A_EMOTION_M6_RECOVERY_ENABLED, false, "A_EMOTION_M6_RECOVERY_ENABLED"),
    e2eHarnessEnabled: strictBoolean(env.A_EMOTION_M6_E2E_HARNESS_ENABLED, false, "A_EMOTION_M6_E2E_HARNESS_ENABLED"),
    pollIntervalMs: integer(env.A_EMOTION_POLL_INTERVAL_MS, 7_000, 3_000, 30_000, "A_EMOTION_POLL_INTERVAL_MS"),
    policy: validated.value
  };
}

export function shouldFreezeAEmotionM6ForNewRun(input: {
  processEnabled: boolean;
  recoveryEnabled: boolean;
  m5Enabled: boolean;
  templateKey: string;
  mode: string;
  maxPlayers: number;
}) {
  return input.processEnabled
    && input.recoveryEnabled
    && input.m5Enabled
    && input.templateKey === "sangtian"
    && input.mode === "room"
    && input.maxPlayers > 1;
}

/**
 * M6 runtime state comes from the room-frozen snapshot. Environment variables
 * are consulted only when a new room is created, so a rolling deploy cannot
 * silently change the rules of an active room.
 */
export function isAEmotionM6EnabledForRun(run: AEmotionM6RunGate) {
  if (!isAEmotionM5EnabledForRun(run)) return false;
  return frozenAEmotionCapability(run.stateJson, "recoveryEnabled") === true;
}

export function buildAEmotionM6RoomPolicy(input: {
  m1Enabled: boolean;
  m2Enabled: boolean;
  m3Enabled: boolean;
  m4Enabled: boolean;
  m5Enabled: boolean;
  m6Enabled: boolean;
  pollIntervalMs: number;
  frozenAt?: Date;
}) {
  return createAEmotionRoomPolicy({
    aEmotionEnabled: input.m1Enabled,
    situationFeedEnabled: input.m2Enabled,
    // The compatibility flag enables interaction details, which the approved
    // renderer keeps inside the right-rail World Situation module.
    crossImpactCardEnabled: input.m1Enabled,
    keyModalsEnabled: input.m3Enabled || input.m4Enabled || input.m5Enabled,
    simplePromiseEnabled: input.m4Enabled,
    interactionHistoryEnabled: input.m5Enabled,
    recoveryEnabled: input.m5Enabled && input.m6Enabled,
    pollIntervalMs: input.pollIntervalMs,
    frozenAt: input.frozenAt
  });
}

export function frozenAEmotionM6Flags(run: AEmotionM6RunGate) {
  return readAEmotionRoomPolicy(run.stateJson)?.flags;
}

export function frozenAEmotionM6PollInterval(run: AEmotionM6RunGate) {
  return frozenAEmotionPollInterval(run.stateJson) ?? 7_000;
}

export function aEmotionM6ViewerProjection(run: AEmotionM6RunGate) {
  return aEmotionViewerState(run.stateJson);
}

export function isAEmotionRoomPaused(run: Pick<AEmotionM6RunGate, "stateJson">) {
  return readAEmotionPauseState(run.stateJson).paused;
}

function strictBoolean(raw: string | undefined, fallback: boolean, name: string) {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be exactly true or false`);
}

function integer(raw: string | undefined, fallback: number, min: number, max: number, name: string) {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/u.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`);
  return value;
}
