import {
  A_EMOTION_M5_RULE_SCHEMA_VERSION,
  validateAEmotionStageMilestoneRuleV1,
  type AEmotionStageMilestoneCodeV1,
  type AEmotionStageMilestoneRuleV1
} from "@ai-story/shared";
import { isAEmotionM4EnabledForRun } from "./a-emotion-m4.config";
import type { AEmotionM1RunGate } from "./a-emotion-m1.config";
import { frozenAEmotionCapability } from "./a-emotion-room-flags";

export type AEmotionM5RunGate = AEmotionM1RunGate;

const RULES: Record<AEmotionStageMilestoneCodeV1, AEmotionStageMilestoneRuleV1> = {
  CONTROL_ORIGINAL_LEDGER: {
    schemaVersion: A_EMOTION_M5_RULE_SCHEMA_VERSION,
    milestoneCode: "CONTROL_ORIGINAL_LEDGER",
    requiredActionCodes: ["CONTROL_ORIGINAL_DOCUMENT"],
    requiredEffectCodes: ["ORIGINAL_DOCUMENT_CONTROL_ESTABLISHED"],
    requiredFactCodes: ["ORIGINAL_DOCUMENT_CONTROL_CONFIRMED"],
    revokeActionCodes: ["SURRENDER_ORIGINAL_DOCUMENT_CONTROL"],
    revokeEffectCodes: ["ORIGINAL_DOCUMENT_CONTROL_LOST"],
    revokeFactCodes: ["ORIGINAL_DOCUMENT_CONTROL_REVOKED"],
    reward: {
      metricKey: "reform_progress",
      metricDelta: 12,
      capabilityCodes: ["QUESTION_AUTHORITY"],
      restrictionCodes: ["OPPONENT_REPORT_CONTROL_RESTRICTED"]
    }
  },
  BREAK_OPPONENT_REPORT_CONTROL: {
    schemaVersion: A_EMOTION_M5_RULE_SCHEMA_VERSION,
    milestoneCode: "BREAK_OPPONENT_REPORT_CONTROL",
    requiredActionCodes: ["BREAK_REPORT_CONTROL"],
    requiredEffectCodes: ["REPORT_CONTROL_BROKEN"],
    requiredFactCodes: ["REPORT_CONTROL_BREAK_CONFIRMED"],
    revokeActionCodes: ["RESTORE_REPORT_CONTROL"],
    revokeEffectCodes: ["REPORT_CONTROL_RESTORED"],
    revokeFactCodes: ["REPORT_CONTROL_RESTORATION_CONFIRMED"],
    reward: {
      metricKey: null,
      metricDelta: 0,
      capabilityCodes: ["COUNTER_REPORT_AUTHORITY"],
      restrictionCodes: ["OPPONENT_REPORT_CONTROL_RESTRICTED"]
    }
  },
  RESTORE_REFORM_MOMENTUM: {
    schemaVersion: A_EMOTION_M5_RULE_SCHEMA_VERSION,
    milestoneCode: "RESTORE_REFORM_MOMENTUM",
    requiredActionCodes: ["RESTORE_REFORM_MOMENTUM"],
    requiredEffectCodes: ["REFORM_MOMENTUM_RESTORED"],
    requiredFactCodes: ["REFORM_MOMENTUM_RESTORATION_CONFIRMED"],
    revokeActionCodes: ["LOSE_REFORM_MOMENTUM"],
    revokeEffectCodes: ["REFORM_MOMENTUM_LOST"],
    revokeFactCodes: ["REFORM_MOMENTUM_LOSS_CONFIRMED"],
    reward: {
      metricKey: "reform_progress",
      metricDelta: 8,
      capabilityCodes: ["REFORM_INITIATIVE"],
      restrictionCodes: []
    }
  }
};

for (const rule of Object.values(RULES)) {
  const validated = validateAEmotionStageMilestoneRuleV1(rule);
  if (!validated.ok) throw new Error(`A_EMOTION_M5_RULE_INVALID:${validated.errors.join("|")}`);
}

export function readAEmotionM5Config(env: NodeJS.ProcessEnv = process.env) {
  return {
    masterEnabled: strictBoolean(env.A_EMOTION_M5_ENABLED, false, "A_EMOTION_M5_ENABLED"),
    stageMilestonesEnabled: strictBoolean(env.A_EMOTION_STAGE_MILESTONES_ENABLED, false, "A_EMOTION_STAGE_MILESTONES_ENABLED"),
    interactionHistoryEnabled: strictBoolean(env.A_EMOTION_INTERACTION_HISTORY_ENABLED, false, "A_EMOTION_INTERACTION_HISTORY_ENABLED"),
    rules: Object.values(RULES).map(cloneRule)
  };
}

export function aEmotionM5Rules(): AEmotionStageMilestoneRuleV1[] {
  return Object.values(RULES).map(cloneRule);
}

export function shouldFreezeAEmotionM5ForNewRun(input: {
  processEnabled: boolean;
  stageMilestonesEnabled: boolean;
  interactionHistoryEnabled: boolean;
  m4Enabled: boolean;
  templateKey: string;
  mode: string;
  maxPlayers: number;
}) {
  return input.processEnabled && input.stageMilestonesEnabled && input.interactionHistoryEnabled && input.m4Enabled
    && input.templateKey === "sangtian" && input.mode === "room" && input.maxPlayers > 1;
}

export function isAEmotionM5EnabledForRun(run: AEmotionM5RunGate, env: NodeJS.ProcessEnv = process.env) {
  if (!isAEmotionM4EnabledForRun(run, env)) return false;
  const frozen = frozenAEmotionCapability(run.stateJson, "interactionHistoryEnabled");
  if (frozen !== null) return frozen;
  const config = readAEmotionM5Config(env);
  if (!config.masterEnabled || !config.stageMilestonesEnabled || !config.interactionHistoryEnabled) return false;
  const flags = record(record(run.stateJson).featureFlags);
  return flags.aEmotionM5 === true && flags.aEmotionStageMilestones === true && flags.aEmotionInteractionHistory === true;
}

function cloneRule(rule: AEmotionStageMilestoneRuleV1): AEmotionStageMilestoneRuleV1 {
  return {
    ...rule,
    requiredActionCodes: [...rule.requiredActionCodes],
    requiredEffectCodes: [...rule.requiredEffectCodes],
    requiredFactCodes: [...rule.requiredFactCodes],
    revokeActionCodes: [...rule.revokeActionCodes],
    revokeEffectCodes: [...rule.revokeEffectCodes],
    revokeFactCodes: [...rule.revokeFactCodes],
    reward: { ...rule.reward, capabilityCodes: [...rule.reward.capabilityCodes], restrictionCodes: [...rule.reward.restrictionCodes] }
  };
}
function strictBoolean(raw: string | undefined, fallback: boolean, name: string) {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be exactly true or false`);
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
