import { isAEmotionM1EnabledForRun, type AEmotionM1RunGate } from "./a-emotion-m1.config";
import { frozenAEmotionCapability } from "./a-emotion-room-flags";

export const A_EMOTION_M2_SUSPECT_ACTION_KEY = "main_s2_governor_dual_verification" as const;
export const A_EMOTION_M2_SUSPECT_EFFECT_KEY = "effect_main_s2_governor_dual_verification" as const;
export const A_EMOTION_M2_SUSPECT_FACT_KEY = "fact_s2_governor_dual_verification" as const;
export const A_EMOTION_M2_CONFIRM_ACTION_KEY = "main_s4_governor_seal_evidence" as const;
export const A_EMOTION_M2_CONFIRM_EFFECT_KEY = "effect_main_s4_governor_seal_evidence" as const;
export const A_EMOTION_M2_CONFIRM_FACT_KEY = "fact_s4_governor_seal_evidence" as const;
export const A_EMOTION_M2_VIEWER_ROLE_KEY = "zhejiang_governor" as const;
export const A_EMOTION_M2_SOURCE_ROLE_KEY = "xunfu" as const;
export const A_EMOTION_M2_OTHER_SUSPECT_ROLE_KEY = "county_magistrate" as const;

export type AEmotionM2Config = { masterEnabled: boolean };

export function readAEmotionM2Config(env: NodeJS.ProcessEnv = process.env): AEmotionM2Config {
  return { masterEnabled: strictBoolean(env.A_EMOTION_M2_ENABLED, false, "A_EMOTION_M2_ENABLED") };
}

export function shouldFreezeAEmotionM2ForNewRun(input: {
  processEnabled: boolean;
  m1Enabled: boolean;
  templateKey: string;
  mode: string;
  maxPlayers: number;
}): boolean {
  return input.processEnabled
    && input.m1Enabled
    && input.templateKey === "sangtian"
    && input.mode === "room"
    && input.maxPlayers > 1;
}

export function isAEmotionM2EnabledForRun(run: AEmotionM1RunGate, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isAEmotionM1EnabledForRun(run, env)) return false;
  const frozen = frozenAEmotionCapability(run.stateJson, "situationFeedEnabled");
  if (frozen !== null) return frozen;
  if (!readAEmotionM2Config(env).masterEnabled) return false;
  const root = record(run.stateJson);
  const flags = record(root.featureFlags);
  return flags.aEmotionM2 === true;
}

function strictBoolean(raw: string | undefined, fallback: boolean, name: string) {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be exactly true or false`);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
