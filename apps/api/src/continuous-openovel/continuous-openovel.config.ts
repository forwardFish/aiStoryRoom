import { CONTINUOUS_OPENOVEL_ENGINE_VERSION } from "@ai-story/shared";

export type ContinuousOpenNovelConfig = {
  enabled: boolean;
  runtimeUrl: string;
  internalToken: string;
  roleRuntimeTimeoutMs: number;
  roomAllowlist: ReadonlySet<string>;
};

export function readContinuousOpenNovelConfig(env: NodeJS.ProcessEnv = process.env): ContinuousOpenNovelConfig {
  const enabled = strictBoolean(env.CONTINUOUS_OPENOVEL_V1_ENABLED, false, "CONTINUOUS_OPENOVEL_V1_ENABLED");
  const roomAllowlist = new Set(String(env.CONTINUOUS_OPENOVEL_ROOM_IDS || "").split(",").map((item) => item.trim()).filter(Boolean));
  if (enabled && roomAllowlist.size === 0) {
    throw new Error("CONTINUOUS_OPENOVEL_ROOM_IDS is required when continuous_openovel_v1 is enabled");
  }
  return {
    enabled,
    runtimeUrl: String(env.OPENOVEL_RUNTIME_URL || "http://127.0.0.1:3110").replace(/\/+$/, ""),
    internalToken: String(env.OPENOVEL_INTERNAL_TOKEN || "").trim(),
    roleRuntimeTimeoutMs: positiveInteger(env.OPENOVEL_ROLE_RUNTIME_TIMEOUT_MS, 30_000, "OPENOVEL_ROLE_RUNTIME_TIMEOUT_MS"),
    roomAllowlist
  };
}

function positiveInteger(raw: string | undefined, fallback: number, name: string) {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function isContinuousOpenNovelEnabledForRun(
  input: { id: string; engineVersion: string },
  env: NodeJS.ProcessEnv = process.env
) {
  if (input.engineVersion !== CONTINUOUS_OPENOVEL_ENGINE_VERSION) return false;
  const config = readContinuousOpenNovelConfig(env);
  return config.enabled && config.roomAllowlist.has(input.id);
}

function strictBoolean(raw: string | undefined, fallback: boolean, name: string) {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be exactly true or false`);
}
