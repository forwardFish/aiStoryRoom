import {
  fail,
  integerAtLeast,
  isRecord,
  nonEmptyString,
  onlyKeys,
  pass,
  stringArray,
  type ValidationResult
} from "./schema-utils";

import {
  A_EMOTION_M5_EVENT_FAMILY,
  A_EMOTION_M5_SHARED_OBJECT_ID
} from "./a-emotion-m2.schemas";

export {
  A_EMOTION_M5_EVENT_FAMILY,
  A_EMOTION_M5_SHARED_OBJECT_ID
} from "./a-emotion-m2.schemas";

export const A_EMOTION_M5_RULE_SCHEMA_VERSION = "a_emotion_m5_milestone_rule_v1" as const;
export const A_EMOTION_M5_MILESTONE_SCHEMA_VERSION = "a_emotion_m5_stage_milestone_v1" as const;
export const A_EMOTION_M5_SUMMARY_SCHEMA_VERSION = "a_emotion_m5_interaction_summary_v1" as const;
export const A_EMOTION_M5_EVENT_TYPE = "A_EMOTION_M5_STAGE_VICTORY" as const;
export const A_EMOTION_M5_STAGE_VICTORY_PRIORITY = 100 as const;

export type AEmotionStageMilestoneCodeV1 =
  | "CONTROL_ORIGINAL_LEDGER"
  | "BREAK_OPPONENT_REPORT_CONTROL"
  | "RESTORE_REFORM_MOMENTUM";

export type AEmotionStageMilestoneStatusV1 = "INACTIVE" | "ACHIEVED" | "REVOKED";

export type AEmotionStageMilestoneRewardV1 = {
  metricKey: string | null;
  metricDelta: number;
  capabilityCodes: string[];
  restrictionCodes: string[];
};

/** World-independent deterministic milestone rule. It matches exact canonical codes only. */
export type AEmotionStageMilestoneRuleV1 = {
  schemaVersion: typeof A_EMOTION_M5_RULE_SCHEMA_VERSION;
  milestoneCode: AEmotionStageMilestoneCodeV1;
  requiredActionCodes: string[];
  requiredEffectCodes: string[];
  requiredFactCodes: string[];
  revokeActionCodes: string[];
  revokeEffectCodes: string[];
  revokeFactCodes: string[];
  reward: AEmotionStageMilestoneRewardV1;
};

/** Viewer-safe durable milestone state. Canonical action and audience payloads are absent. */
export type AEmotionStageMilestoneV1 = {
  schemaVersion: typeof A_EMOTION_M5_MILESTONE_SCHEMA_VERSION;
  milestoneId: string;
  roomId: string;
  runId: string;
  stageId: string;
  milestoneCode: AEmotionStageMilestoneCodeV1;
  beneficiaryRoleId: string;
  status: AEmotionStageMilestoneStatusV1;
  stateVersion: number;
  evidenceRefs: string[];
  reward: AEmotionStageMilestoneRewardV1;
  achievedAt: string | null;
  revokedAt: string | null;
};

export type AEmotionInteractionSummaryEntryV1 = {
  eventId: string;
  category: "RELATED" | "PUBLIC" | "SUSPICIOUS";
  disclosure: "HIDDEN" | "SUSPECTED" | "CONFIRMED";
  title: string;
  safeSummary: string;
  statusLabel: string;
  evidenceRefs: string[];
  occurredAt: string;
};

/** Derived only from committed viewer deliveries and viewer-owned milestone rows. */
export type AEmotionInteractionSummaryV1 = {
  schemaVersion: typeof A_EMOTION_M5_SUMMARY_SCHEMA_VERSION;
  roomId: string;
  runId: string;
  viewerRoleId: string;
  generatedAt: string;
  influencedMe: AEmotionInteractionSummaryEntryV1[];
  influencedOthers: AEmotionInteractionSummaryEntryV1[];
  promiseResults: AEmotionInteractionSummaryEntryV1[];
  milestones: AEmotionStageMilestoneV1[];
};

const RULE_KEYS = [
  "schemaVersion", "milestoneCode", "requiredActionCodes", "requiredEffectCodes", "requiredFactCodes",
  "revokeActionCodes", "revokeEffectCodes", "revokeFactCodes", "reward"
] as const;
const REWARD_KEYS = ["metricKey", "metricDelta", "capabilityCodes", "restrictionCodes"] as const;
const MILESTONE_KEYS = [
  "schemaVersion", "milestoneId", "roomId", "runId", "stageId", "milestoneCode", "beneficiaryRoleId",
  "status", "stateVersion", "evidenceRefs", "reward", "achievedAt", "revokedAt"
] as const;
const SUMMARY_KEYS = [
  "schemaVersion", "roomId", "runId", "viewerRoleId", "generatedAt", "influencedMe", "influencedOthers",
  "promiseResults", "milestones"
] as const;
const SUMMARY_ENTRY_KEYS = ["eventId", "category", "disclosure", "title", "safeSummary", "statusLabel", "evidenceRefs", "occurredAt"] as const;
const CODES = new Set<AEmotionStageMilestoneCodeV1>([
  "CONTROL_ORIGINAL_LEDGER", "BREAK_OPPONENT_REPORT_CONTROL", "RESTORE_REFORM_MOMENTUM"
]);
const STATUSES = new Set<AEmotionStageMilestoneStatusV1>(["INACTIVE", "ACHIEVED", "REVOKED"]);
const OPAQUE_MILESTONE_ID = /^ms_[A-Za-z0-9_-]{24,}$/u;
const OPAQUE_EVENT_ID = /^evt_[A-Za-z0-9_-]{24,}$/u;
const RAW_ID_HINT = /(playerAction|sourceAction|sourceRole|targetRole|dedupe|canonical|rawAudience|run[:_-]|action[:_-])/iu;
const FORBIDDEN_SUMMARY_KEYS = new Set([
  "sourceRoleId", "sourceRoleKey", "sourceActionId", "playerActionId", "rawAction", "rawAudience",
  "audienceRoleIds", "audienceUserIds", "dedupeKey", "canonicalPayload", "privatePayload", "aggregateKey"
]);

export function validateAEmotionStageMilestoneRuleV1(value: unknown): ValidationResult<AEmotionStageMilestoneRuleV1> {
  if (!isRecord(value)) return fail(["milestone rule must be an object"]);
  const errors = onlyKeys(value, RULE_KEYS);
  if (value.schemaVersion !== A_EMOTION_M5_RULE_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!CODES.has(value.milestoneCode as AEmotionStageMilestoneCodeV1)) errors.push("invalid milestoneCode");
  for (const key of ["requiredActionCodes", "requiredEffectCodes", "requiredFactCodes", "revokeActionCodes", "revokeEffectCodes", "revokeFactCodes"] as const) {
    if (!stringArray(value[key]) || value[key].length > 24) errors.push(`${key} must contain at most twenty-four exact codes`);
  }
  const achievementCount = [value.requiredActionCodes, value.requiredEffectCodes, value.requiredFactCodes]
    .filter(Array.isArray).reduce((total, items) => total + items.length, 0);
  if (achievementCount < 1) errors.push("milestone rule requires at least one achievement code");
  errors.push(...validateReward(value.reward).map((error) => `reward: ${error}`));
  return errors.length ? fail(errors) : pass(value as AEmotionStageMilestoneRuleV1);
}

export function validateAEmotionStageMilestoneV1(value: unknown): ValidationResult<AEmotionStageMilestoneV1> {
  if (!isRecord(value)) return fail(["stage milestone must be an object"]);
  const errors = onlyKeys(value, MILESTONE_KEYS);
  if (value.schemaVersion !== A_EMOTION_M5_MILESTONE_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!nonEmptyString(value.milestoneId) || !OPAQUE_MILESTONE_ID.test(String(value.milestoneId)) || RAW_ID_HINT.test(String(value.milestoneId))) errors.push("milestoneId must be opaque");
  for (const key of ["roomId", "runId", "stageId", "beneficiaryRoleId"] as const) if (!nonEmptyString(value[key])) errors.push(`${key} is required`);
  if (value.roomId !== value.runId) errors.push("roomId and runId must match");
  if (!CODES.has(value.milestoneCode as AEmotionStageMilestoneCodeV1)) errors.push("invalid milestoneCode");
  if (!STATUSES.has(value.status as AEmotionStageMilestoneStatusV1)) errors.push("invalid status");
  if (!integerAtLeast(value.stateVersion, 1)) errors.push("stateVersion must be >= 1");
  const evidenceRefs = stringArray(value.evidenceRefs) ? value.evidenceRefs : [];
  if (!stringArray(value.evidenceRefs) || evidenceRefs.length > 16) errors.push("evidenceRefs must contain at most sixteen entries");
  errors.push(...validateReward(value.reward).map((error) => `reward: ${error}`));
  if (!(value.achievedAt === null || isIsoDate(value.achievedAt))) errors.push("achievedAt must be null or an ISO date");
  if (!(value.revokedAt === null || isIsoDate(value.revokedAt))) errors.push("revokedAt must be null or an ISO date");
  if ((value.status === "ACHIEVED" || value.status === "REVOKED") && value.achievedAt === null) errors.push("achieved milestone requires achievedAt");
  if (value.status === "ACHIEVED" && evidenceRefs.length < 1) errors.push("ACHIEVED requires evidenceRefs");
  if (value.status === "REVOKED" && value.revokedAt === null) errors.push("REVOKED requires revokedAt");
  return errors.length ? fail(errors) : pass(value as AEmotionStageMilestoneV1);
}

export function validateAEmotionInteractionSummaryV1(value: unknown): ValidationResult<AEmotionInteractionSummaryV1> {
  if (!isRecord(value)) return fail(["interaction summary must be an object"]);
  const errors = onlyKeys(value, SUMMARY_KEYS);
  if (value.schemaVersion !== A_EMOTION_M5_SUMMARY_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  for (const key of ["roomId", "runId", "viewerRoleId"] as const) if (!nonEmptyString(value[key])) errors.push(`${key} is required`);
  if (value.roomId !== value.runId) errors.push("roomId and runId must match");
  if (!isIsoDate(value.generatedAt)) errors.push("generatedAt must be an ISO date");
  for (const key of ["influencedMe", "influencedOthers", "promiseResults"] as const) {
    if (!Array.isArray(value[key])) errors.push(`${key} must be an array`);
    else {
      if (value[key].length > 20) errors.push(`${key} must contain at most twenty entries`);
      value[key].forEach((entry, index) => errors.push(...validateSummaryEntry(entry).map((error) => `${key}[${index}]: ${error}`)));
    }
  }
  if (!Array.isArray(value.milestones)) errors.push("milestones must be an array");
  else value.milestones.forEach((entry, index) => {
    const validated = validateAEmotionStageMilestoneV1(entry);
    if (!validated.ok) errors.push(...validated.errors.map((error) => `milestones[${index}]: ${error}`));
    else if (validated.value.beneficiaryRoleId !== value.viewerRoleId) errors.push(`milestones[${index}] belongs to another role`);
  });
  const forbidden = forbiddenPaths(value);
  if (forbidden.length) errors.push(`interaction summary leaks private fields: ${forbidden.join(",")}`);
  return errors.length ? fail(errors) : pass(value as AEmotionInteractionSummaryV1);
}

function validateReward(value: unknown): string[] {
  if (!isRecord(value)) return ["reward must be an object"];
  const errors = onlyKeys(value, REWARD_KEYS);
  if (!(value.metricKey === null || nonEmptyString(value.metricKey))) errors.push("metricKey must be null or non-empty");
  if (!Number.isInteger(value.metricDelta)) errors.push("metricDelta must be an integer");
  if (!stringArray(value.capabilityCodes) || value.capabilityCodes.length > 12) errors.push("capabilityCodes must contain at most twelve strings");
  if (!stringArray(value.restrictionCodes) || value.restrictionCodes.length > 12) errors.push("restrictionCodes must contain at most twelve strings");
  return errors;
}

function validateSummaryEntry(value: unknown): string[] {
  if (!isRecord(value)) return ["summary entry must be an object"];
  const errors = onlyKeys(value, SUMMARY_ENTRY_KEYS);
  if (!nonEmptyString(value.eventId) || !OPAQUE_EVENT_ID.test(String(value.eventId)) || RAW_ID_HINT.test(String(value.eventId))) errors.push("eventId must be opaque");
  if (!(value.category === "RELATED" || value.category === "PUBLIC" || value.category === "SUSPICIOUS")) errors.push("invalid category");
  if (!(value.disclosure === "HIDDEN" || value.disclosure === "SUSPECTED" || value.disclosure === "CONFIRMED")) errors.push("invalid disclosure");
  for (const key of ["title", "safeSummary", "statusLabel"] as const) if (!nonEmptyString(value[key])) errors.push(`${key} is required`);
  if (!stringArray(value.evidenceRefs) || value.evidenceRefs.length > 12) errors.push("evidenceRefs must contain at most twelve strings");
  if (value.disclosure !== "CONFIRMED" && Array.isArray(value.evidenceRefs) && value.evidenceRefs.length) errors.push("unconfirmed summary cannot expose evidence references");
  if (!isIsoDate(value.occurredAt)) errors.push("occurredAt must be an ISO date");
  return errors;
}

function forbiddenPaths(value: unknown, path = "$", output: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item, index) => forbiddenPaths(item, `${path}[${index}]`, output));
  else if (isRecord(value)) for (const [key, item] of Object.entries(value)) {
    const next = `${path}.${key}`;
    if (FORBIDDEN_SUMMARY_KEYS.has(key)) output.push(next);
    forbiddenPaths(item, next, output);
  }
  return output;
}
function isIsoDate(value: unknown): value is string { return nonEmptyString(value) && !Number.isNaN(Date.parse(value)); }
