import {
  A_EMOTION_M3_THRESHOLD_RULE_SCHEMA_VERSION,
  validateAEmotionMetricThresholdRuleV1,
  type AEmotionMetricThresholdRuleV1
} from "@ai-story/shared";
import { isAEmotionM2EnabledForRun } from "./a-emotion-m2.config";
import type { AEmotionM1RunGate } from "./a-emotion-m1.config";
import { frozenAEmotionCapability } from "./a-emotion-room-flags";

export type AEmotionM3RunGate = AEmotionM1RunGate;

export const A_EMOTION_M3_IMPERIAL_TRUST_RULE: AEmotionMetricThresholdRuleV1 = {
  schemaVersion: A_EMOTION_M3_THRESHOLD_RULE_SCHEMA_VERSION,
  metricKey: "imperial_trust",
  metricLabel: "皇帝信任",
  warningAtOrBelow: 25,
  dangerAtOrBelow: 20,
  triggerCode: "LOSE_REFORM_AUTHORITY_RISK",
  modalTitle: "你正在失去主持权",
  modalSummaryTemplate: "皇帝信任已进入危险区；下一次公开治理失败可能使你失去改革主持权。"
};

const RULES = new Map([[A_EMOTION_M3_IMPERIAL_TRUST_RULE.metricKey, A_EMOTION_M3_IMPERIAL_TRUST_RULE]]);

export function aEmotionM3Rule(metricKey: string): AEmotionMetricThresholdRuleV1 | null {
  const rule = RULES.get(metricKey) || null;
  if (!rule) return null;
  const validated = validateAEmotionMetricThresholdRuleV1(rule);
  if (!validated.ok) throw new Error(`A_EMOTION_M3_RULE_INVALID:${validated.errors.join("|")}`);
  return validated.value;
}

export function readAEmotionM3Config(env: NodeJS.ProcessEnv = process.env) {
  return {
    masterEnabled: strictBoolean(env.A_EMOTION_M3_ENABLED, false, "A_EMOTION_M3_ENABLED"),
    keyModalsEnabled: strictBoolean(env.A_EMOTION_KEY_MODALS_ENABLED, false, "A_EMOTION_KEY_MODALS_ENABLED"),
    rules: [...RULES.values()].map((rule) => ({ ...rule }))
  };
}

export function shouldFreezeAEmotionM3ForNewRun(input: {
  processEnabled: boolean;
  keyModalsEnabled: boolean;
  m2Enabled: boolean;
  templateKey: string;
  mode: string;
  maxPlayers: number;
}) {
  return input.processEnabled && input.keyModalsEnabled && input.m2Enabled
    && input.templateKey === "sangtian" && input.mode === "room" && input.maxPlayers > 1;
}

export function isAEmotionM3EnabledForRun(run: AEmotionM3RunGate, env: NodeJS.ProcessEnv = process.env) {
  if (!isAEmotionM2EnabledForRun(run, env)) return false;
  const frozen = frozenAEmotionCapability(run.stateJson, "keyModalsEnabled");
  if (frozen !== null) return frozen;
  const config = readAEmotionM3Config(env);
  if (!config.masterEnabled || !config.keyModalsEnabled) return false;
  const flags = record(record(run.stateJson).featureFlags);
  return flags.aEmotionM3 === true && flags.aEmotionKeyModals === true;
}

function strictBoolean(raw: string | undefined, fallback: boolean, name: string) {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be exactly true or false`);
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
