export const CREDIT_POLICY_VERSIONS = ["world_unlock_v1", "active_action_v1"] as const;
export type CreditPolicyVersion = typeof CREDIT_POLICY_VERSIONS[number];

const ACTIVE_ACTION_ENGINE_VERSIONS = new Set([
  "continuous_strategy_v1_1",
  "continuous_story_v2",
  "solo_story_v2"
]);

export function supportsActiveActionBilling(engineVersion: string | null | undefined) {
  return ACTIVE_ACTION_ENGINE_VERSIONS.has(String(engineVersion || ""));
}

export function policyForNewRun(requestedPolicy: CreditPolicyVersion, engineVersion: string | null | undefined): CreditPolicyVersion {
  return requestedPolicy === "active_action_v1" && supportsActiveActionBilling(engineVersion)
    ? "active_action_v1"
    : "world_unlock_v1";
}

export const CREDIT_METERING_MODES = ["OFF", "SHADOW", "ENFORCED"] as const;
export type CreditMeteringMode = typeof CREDIT_METERING_MODES[number];

export type BillingPriceSnapshot = {
  currency: "WORLD_CREDITS";
  runCreate: number;
  standardAction: number;
  customAction: number;
  complexAction: number;
  sponsorshipPack: number;
};

export type CreditConsumptionConfig = {
  defaultPolicy: CreditPolicyVersion;
  meteringMode: CreditMeteringMode;
  prices: BillingPriceSnapshot;
  stuckAfterSeconds: number;
  aiBatchingEnabled: boolean;
  aiBatchMaxSize: number;
  aiBatchMaxWaitMs: number;
};

export function readCreditConsumptionConfig(env: NodeJS.ProcessEnv = process.env): CreditConsumptionConfig {
  const defaultPolicy = enumValue(env.CREDIT_DEFAULT_POLICY, "world_unlock_v1", CREDIT_POLICY_VERSIONS, "CREDIT_DEFAULT_POLICY");
  const meteringMode = enumValue(env.CREDIT_ACTION_METERING_MODE, "OFF", CREDIT_METERING_MODES, "CREDIT_ACTION_METERING_MODE");
  return {
    defaultPolicy,
    meteringMode,
    prices: {
      currency: "WORLD_CREDITS",
      runCreate: positiveInteger(env.CREDIT_RUN_CREATE_COST, 20, "CREDIT_RUN_CREATE_COST", 10_000),
      standardAction: positiveInteger(env.CREDIT_STANDARD_ACTION_COST, 1, "CREDIT_STANDARD_ACTION_COST", 100),
      customAction: positiveInteger(env.CREDIT_CUSTOM_ACTION_COST, 2, "CREDIT_CUSTOM_ACTION_COST", 100),
      complexAction: positiveInteger(env.CREDIT_COMPLEX_ACTION_COST, 2, "CREDIT_COMPLEX_ACTION_COST", 100),
      sponsorshipPack: positiveInteger(env.CREDIT_RUN_SPONSORSHIP_AMOUNT, 10, "CREDIT_RUN_SPONSORSHIP_AMOUNT", 10_000)
    },
    stuckAfterSeconds: positiveInteger(env.CREDIT_CHARGE_STUCK_AFTER_SECONDS, 900, "CREDIT_CHARGE_STUCK_AFTER_SECONDS", 86_400),
    aiBatchingEnabled: strictBoolean(env.AI_BATCHING_ENABLED, false, "AI_BATCHING_ENABLED"),
    aiBatchMaxSize: positiveInteger(env.AI_BATCH_MAX_SIZE, 6, "AI_BATCH_MAX_SIZE", 50),
    aiBatchMaxWaitMs: positiveInteger(env.AI_BATCH_MAX_WAIT_MS, 250, "AI_BATCH_MAX_WAIT_MS", 250)
  };
}

function enumValue<T extends string>(raw: string | undefined, fallback: T, allowed: readonly T[], name: string): T {
  const value = String(raw || fallback).trim() as T;
  if (!allowed.includes(value)) throw new Error(`${name} must be one of ${allowed.join("|")}`);
  return value;
}

function positiveInteger(raw: string | undefined, fallback: number, name: string, maximum: number) {
  const value = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function strictBoolean(raw: string | undefined, fallback: boolean, name: string) {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be exactly true or false`);
}
