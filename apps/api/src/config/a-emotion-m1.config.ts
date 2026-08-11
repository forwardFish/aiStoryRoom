import { CONTINUOUS_STORY_ENGINE_VERSION } from "@ai-story/shared";
import { frozenAEmotionCapability } from "./a-emotion-room-flags";

export const A_EMOTION_M1_WORLD_ID = "sangtian" as const;
export const A_EMOTION_M1_SOURCE_ROLE_KEY = "xunfu" as const;
export const A_EMOTION_M1_TARGET_ROLE_KEY = "zhejiang_governor" as const;
export const A_EMOTION_M1_ACTION_KEY = "main_s2_xunfu_seize_drafts" as const;
export const A_EMOTION_M1_EFFECT_KEY = "effect_main_s2_xunfu_seize_drafts" as const;
export const A_EMOTION_M1_FACT_KEY = "fact_s2_xunfu_seize_drafts" as const;
export const A_EMOTION_M1_SHARED_OBJECT_KEY = "original-grain-ledger" as const;
export const A_EMOTION_M1_IMPERIAL_TRUST_DELTA = -6 as const;

export type AEmotionM1Config = {
  masterEnabled: boolean;
};

export type AEmotionM1RunGate = {
  mode: string;
  maxPlayers: number;
  templateKey: string;
  engineVersion: string;
  stateJson: unknown;
};

export function readAEmotionM1Config(env: NodeJS.ProcessEnv = process.env): AEmotionM1Config {
  return { masterEnabled: strictBoolean(env.A_EMOTION_M1_ENABLED, false, "A_EMOTION_M1_ENABLED") };
}

/**
 * M1 is opt-in at both process and room level. Solo, legacy, other worlds and
 * existing rooms without the exact room flag remain byte-compatible.
 */

export function shouldFreezeAEmotionM1ForNewRun(input: {
  templateKey: string;
  mode: string;
  maxPlayers: number;
  engineVersion: string;
}, env: NodeJS.ProcessEnv = process.env): boolean {
  return readAEmotionM1Config(env).masterEnabled
    && input.templateKey === A_EMOTION_M1_WORLD_ID
    && input.mode === "room"
    && input.maxPlayers > 1
    && input.engineVersion === CONTINUOUS_STORY_ENGINE_VERSION;
}

export function isAEmotionM1EnabledForRun(run: AEmotionM1RunGate, env: NodeJS.ProcessEnv = process.env): boolean {
  if (run.mode !== "room" || run.maxPlayers <= 1) return false;
  if (run.templateKey !== A_EMOTION_M1_WORLD_ID) return false;
  if (run.engineVersion !== CONTINUOUS_STORY_ENGINE_VERSION) return false;
  const frozen = frozenAEmotionCapability(run.stateJson, "aEmotionEnabled");
  if (frozen !== null) return frozen;
  if (!readAEmotionM1Config(env).masterEnabled) return false;
  const state = record(run.stateJson);
  const flags = record(state.featureFlags);
  return flags.aEmotionM1 === true;
}

function strictBoolean(raw: string | undefined, fallback: boolean, name: string): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be exactly true or false`);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
