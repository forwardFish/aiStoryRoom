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

export const A_EMOTION_M3_EVENT_TYPE = "A_EMOTION_M3_CRISIS" as const;
export const A_EMOTION_M3_THRESHOLD_RULE_SCHEMA_VERSION = "a_emotion_m3_threshold_rule_v1" as const;
export const A_EMOTION_M3_TRANSITION_SCHEMA_VERSION = "a_emotion_m3_metric_transition_v1" as const;
export const A_EMOTION_KEY_MODAL_SCHEMA_VERSION = "a_emotion_key_modal_v1" as const;
export const A_EMOTION_KEY_MODAL_LIST_SCHEMA_VERSION = "a_emotion_key_modal_list_v1" as const;
export const A_EMOTION_KEY_MODAL_RECEIPT_SCHEMA_VERSION = "a_emotion_key_modal_receipt_v1" as const;
export const A_EMOTION_M3_CRISIS_PRIORITY = 300 as const;

export type AEmotionMetricThresholdStateV1 = "NORMAL" | "WARNING" | "DANGER";
export type AEmotionMetricThresholdRuleV1 = {
  schemaVersion: typeof A_EMOTION_M3_THRESHOLD_RULE_SCHEMA_VERSION;
  metricKey: string;
  metricLabel: string;
  warningAtOrBelow: number;
  dangerAtOrBelow: number;
  triggerCode: string;
  modalTitle: string;
  modalSummaryTemplate: string;
};

export type AEmotionMetricTransitionV1 = {
  schemaVersion: typeof A_EMOTION_M3_TRANSITION_SCHEMA_VERSION;
  transitionId: string;
  roomId: string;
  runId: string;
  viewerRoleId: string;
  metricKey: string;
  metricLabel: string;
  previousValue: number;
  currentValue: number;
  delta: number;
  thresholdBefore: AEmotionMetricThresholdStateV1;
  thresholdAfter: AEmotionMetricThresholdStateV1;
  triggerCode: string;
  sourceResolutionId: string;
  sourceEventId: string | null;
  stateVersion: number;
  triggerVersion: number | null;
  stageId: string;
  occurredAt: string;
};

export type AEmotionKeyModalTypeV1 = "CRISIS" | "PROMISE_BROKEN" | "STAGE_VICTORY";
export type AEmotionKeyModalResponseOptionV1 = {
  code: string;
  label: string;
  preferredEntry: "INVESTIGATE" | "TALK" | "PLAN" | "DEFER";
  intentKey: string | null;
  prefillText: string | null;
};

/** Viewer-safe, durable modal projection. */
export type AEmotionKeyModalV1 = {
  schemaVersion: typeof A_EMOTION_KEY_MODAL_SCHEMA_VERSION;
  modalId: string;
  eventId: string;
  modalType: AEmotionKeyModalTypeV1;
  triggerCode: string;
  triggerVersion: number;
  projectionVersion: number;
  stateVersion: number;
  priority: number;
  title: string;
  summary: string;
  facts: string[];
  responseOptions: AEmotionKeyModalResponseOptionV1[];
  ariaLive: "assertive" | "polite";
  occurredAt: string;
  isShown: boolean;
  isAcknowledged: boolean;
};
export type AEmotionKeyModalProjectionV1 = AEmotionKeyModalV1;

export type AEmotionKeyModalListV1 = {
  schemaVersion: typeof A_EMOTION_KEY_MODAL_LIST_SCHEMA_VERSION;
  items: AEmotionKeyModalV1[];
};

export type AEmotionKeyModalReceiptV1 = {
  schemaVersion: typeof A_EMOTION_KEY_MODAL_RECEIPT_SCHEMA_VERSION;
  modalId: string;
  eventId: string;
  projectionVersion: number;
  stateVersion: number;
  triggerVersion: number;
  shownAt: string;
  acknowledgedAt: string | null;
};

const RULE_KEYS = ["schemaVersion", "metricKey", "metricLabel", "warningAtOrBelow", "dangerAtOrBelow", "triggerCode", "modalTitle", "modalSummaryTemplate"] as const;
const TRANSITION_KEYS = ["schemaVersion", "transitionId", "roomId", "runId", "viewerRoleId", "metricKey", "metricLabel", "previousValue", "currentValue", "delta", "thresholdBefore", "thresholdAfter", "triggerCode", "sourceResolutionId", "sourceEventId", "stateVersion", "triggerVersion", "stageId", "occurredAt"] as const;
const MODAL_KEYS = ["schemaVersion", "modalId", "eventId", "modalType", "triggerCode", "triggerVersion", "projectionVersion", "stateVersion", "priority", "title", "summary", "facts", "responseOptions", "ariaLive", "occurredAt", "isShown", "isAcknowledged"] as const;
const MODAL_RESPONSE_KEYS = ["code", "label", "preferredEntry", "intentKey", "prefillText"] as const;
const RECEIPT_KEYS = ["schemaVersion", "modalId", "eventId", "projectionVersion", "stateVersion", "triggerVersion", "shownAt", "acknowledgedAt"] as const;
const OPAQUE_EVENT_ID = /^evt_[A-Za-z0-9_-]{24,}$/u;
const OPAQUE_MODAL_ID = /^mdl_[A-Za-z0-9_-]{24,}$/u;
const OPAQUE_TRANSITION_ID = /^mtr_[A-Za-z0-9_-]{20,}$/u;
const RAW_ID_HINT = /(playerAction|sourceAction|sourceRole|targetRole|dedupe|canonical|rawAudience|run[:_-]|action[:_-])/iu;
const FORBIDDEN_SOURCE_KEYS = new Set(["sourceRoleId", "sourceRoleKey", "sourceActionId", "playerActionId", "rawAction", "rawAudience", "audienceRoleIds", "audienceUserIds", "dedupeKey", "canonicalPayload", "privatePayload", "visibleSourceRoleId", "visibleSourceRoleKey", "visibleSuspectRoleIds"]);

export function metricThresholdState(rule: AEmotionMetricThresholdRuleV1, value: number): AEmotionMetricThresholdStateV1 {
  if (value <= rule.dangerAtOrBelow) return "DANGER";
  if (value <= rule.warningAtOrBelow) return "WARNING";
  return "NORMAL";
}

export function isDangerEntry(before: AEmotionMetricThresholdStateV1, after: AEmotionMetricThresholdStateV1) {
  return before !== "DANGER" && after === "DANGER";
}

export function validateAEmotionMetricThresholdRuleV1(value: unknown): ValidationResult<AEmotionMetricThresholdRuleV1> {
  if (!isRecord(value)) return fail(["threshold rule must be an object"]);
  const errors = onlyKeys(value, RULE_KEYS);
  if (value.schemaVersion !== A_EMOTION_M3_THRESHOLD_RULE_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  for (const key of ["metricKey", "metricLabel", "triggerCode", "modalTitle", "modalSummaryTemplate"] as const) if (!nonEmptyString(value[key])) errors.push(`${key} is required`);
  if (!Number.isInteger(value.warningAtOrBelow)) errors.push("warningAtOrBelow must be an integer");
  if (!Number.isInteger(value.dangerAtOrBelow)) errors.push("dangerAtOrBelow must be an integer");
  if (Number.isInteger(value.warningAtOrBelow) && Number.isInteger(value.dangerAtOrBelow) && Number(value.dangerAtOrBelow) > Number(value.warningAtOrBelow)) errors.push("dangerAtOrBelow must be <= warningAtOrBelow");
  return errors.length ? fail(errors) : pass(value as AEmotionMetricThresholdRuleV1);
}

export function validateAEmotionMetricTransitionV1(value: unknown): ValidationResult<AEmotionMetricTransitionV1> {
  if (!isRecord(value)) return fail(["metric transition must be an object"]);
  const errors = onlyKeys(value, TRANSITION_KEYS);
  if (value.schemaVersion !== A_EMOTION_M3_TRANSITION_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  for (const key of ["transitionId", "roomId", "runId", "viewerRoleId", "metricKey", "metricLabel", "triggerCode", "sourceResolutionId", "stageId"] as const) if (!nonEmptyString(value[key])) errors.push(`${key} is required`);
  if (typeof value.transitionId === "string" && (!OPAQUE_TRANSITION_ID.test(value.transitionId) || RAW_ID_HINT.test(value.transitionId))) errors.push("transitionId must be opaque");
  if (value.roomId !== value.runId) errors.push("roomId and runId must match for the current room runtime");
  for (const key of ["previousValue", "currentValue", "delta"] as const) if (!Number.isInteger(value[key])) errors.push(`${key} must be an integer`);
  if (Number.isInteger(value.previousValue) && Number.isInteger(value.currentValue) && Number.isInteger(value.delta) && Number(value.currentValue) - Number(value.previousValue) !== Number(value.delta)) errors.push("delta must equal currentValue - previousValue");
  if (!(value.thresholdBefore === "NORMAL" || value.thresholdBefore === "WARNING" || value.thresholdBefore === "DANGER")) errors.push("invalid thresholdBefore");
  if (!(value.thresholdAfter === "NORMAL" || value.thresholdAfter === "WARNING" || value.thresholdAfter === "DANGER")) errors.push("invalid thresholdAfter");
  if (!(value.sourceEventId === null || (nonEmptyString(value.sourceEventId) && OPAQUE_EVENT_ID.test(String(value.sourceEventId)) && !RAW_ID_HINT.test(String(value.sourceEventId))))) errors.push("sourceEventId must be null or opaque");
  if (!integerAtLeast(value.stateVersion, 1)) errors.push("stateVersion must be >= 1");
  if (!(value.triggerVersion === null || integerAtLeast(value.triggerVersion, 1))) errors.push("triggerVersion must be null or >= 1");
  if (!nonEmptyString(value.occurredAt) || Number.isNaN(Date.parse(String(value.occurredAt)))) errors.push("occurredAt must be an ISO date");
  return errors.length ? fail(errors) : pass(value as AEmotionMetricTransitionV1);
}

export function validateAEmotionKeyModalV1(value: unknown): ValidationResult<AEmotionKeyModalV1> {
  if (!isRecord(value)) return fail(["key modal must be an object"]);
  const errors = onlyKeys(value, MODAL_KEYS);
  if (value.schemaVersion !== A_EMOTION_KEY_MODAL_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!nonEmptyString(value.modalId) || !OPAQUE_MODAL_ID.test(String(value.modalId)) || RAW_ID_HINT.test(String(value.modalId))) errors.push("modalId must be opaque");
  if (!nonEmptyString(value.eventId) || !OPAQUE_EVENT_ID.test(String(value.eventId)) || RAW_ID_HINT.test(String(value.eventId))) errors.push("eventId must be opaque");
  if (!(value.modalType === "CRISIS" || value.modalType === "PROMISE_BROKEN" || value.modalType === "STAGE_VICTORY")) errors.push("invalid modalType");
  if (value.modalType === "CRISIS" && value.priority !== 300) errors.push("CRISIS priority must be 300");
  if (value.modalType === "PROMISE_BROKEN" && value.priority !== 200) errors.push("PROMISE_BROKEN priority must be 200");
  if (value.modalType === "STAGE_VICTORY" && value.priority !== 100) errors.push("STAGE_VICTORY priority must be 100");
  for (const key of ["triggerCode", "title", "summary"] as const) if (!nonEmptyString(value[key])) errors.push(`${key} is required`);
  for (const key of ["triggerVersion", "projectionVersion", "stateVersion", "priority"] as const) if (!integerAtLeast(value[key], 1)) errors.push(`${key} must be >= 1`);
  if (!stringArray(value.facts) || value.facts.length < 1 || value.facts.length > 6) errors.push("facts must contain one to six safe strings");
  if (!Array.isArray(value.responseOptions) || value.responseOptions.length < 1 || value.responseOptions.length > 3) errors.push("responseOptions must contain one to three entries");
  else value.responseOptions.forEach((item, index) => validateModalResponse(item, index, errors));
  if (!(value.ariaLive === "assertive" || value.ariaLive === "polite")) errors.push("invalid ariaLive");
  if (!nonEmptyString(value.occurredAt) || Number.isNaN(Date.parse(String(value.occurredAt)))) errors.push("occurredAt must be an ISO date");
  if (typeof value.isShown !== "boolean") errors.push("isShown must be boolean");
  if (typeof value.isAcknowledged !== "boolean") errors.push("isAcknowledged must be boolean");
  if (value.isAcknowledged === true && value.isShown !== true) errors.push("acknowledged modal must already be shown");
  const forbidden = forbiddenPaths(value);
  if (forbidden.length) errors.push(`modal leaks private fields: ${forbidden.join(",")}`);
  return errors.length ? fail(errors) : pass(value as AEmotionKeyModalV1);
}

export function validateAEmotionKeyModalProjectionV1(value: unknown): ValidationResult<AEmotionKeyModalProjectionV1> {
  return validateAEmotionKeyModalV1(value);
}

export function validateAEmotionKeyModalListV1(value: unknown): ValidationResult<AEmotionKeyModalListV1> {
  if (!isRecord(value)) return fail(["key modal list must be an object"]);
  const errors = onlyKeys(value, ["schemaVersion", "items"]);
  if (value.schemaVersion !== A_EMOTION_KEY_MODAL_LIST_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!Array.isArray(value.items)) errors.push("items must be an array");
  else {
    if (value.items.length > 10) errors.push("items must contain at most ten entries");
    let lastPriority = Number.POSITIVE_INFINITY;
    const modalIds = new Set<string>();
    for (const [index, item] of value.items.entries()) {
      const validated = validateAEmotionKeyModalV1(item);
      if (!validated.ok) errors.push(...validated.errors.map((error) => `items[${index}]: ${error}`));
      if (isRecord(item) && typeof item.modalId === "string") {
        if (modalIds.has(item.modalId)) errors.push(`items[${index}].modalId must be unique`);
        modalIds.add(item.modalId);
      }
      if (isRecord(item) && Number.isInteger(item.priority)) {
        if (Number(item.priority) > lastPriority) errors.push("items must be ordered by priority descending");
        lastPriority = Number(item.priority);
      }
    }
  }
  return errors.length ? fail(errors) : pass(value as AEmotionKeyModalListV1);
}

export function validateAEmotionKeyModalReceiptV1(value: unknown): ValidationResult<AEmotionKeyModalReceiptV1> {
  if (!isRecord(value)) return fail(["modal receipt must be an object"]);
  const errors = onlyKeys(value, RECEIPT_KEYS);
  if (value.schemaVersion !== A_EMOTION_KEY_MODAL_RECEIPT_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!nonEmptyString(value.modalId) || !OPAQUE_MODAL_ID.test(String(value.modalId)) || RAW_ID_HINT.test(String(value.modalId))) errors.push("modalId must be opaque");
  if (!nonEmptyString(value.eventId) || !OPAQUE_EVENT_ID.test(String(value.eventId)) || RAW_ID_HINT.test(String(value.eventId))) errors.push("eventId must be opaque");
  if (!integerAtLeast(value.projectionVersion, 1)) errors.push("projectionVersion must be >= 1");
  if (!integerAtLeast(value.triggerVersion, 1)) errors.push("triggerVersion must be >= 1");
  if (!integerAtLeast(value.stateVersion, 1)) errors.push("stateVersion must be >= 1");
  if (!nonEmptyString(value.shownAt) || Number.isNaN(Date.parse(String(value.shownAt)))) errors.push("shownAt must be an ISO date");
  if (!(value.acknowledgedAt === null || (nonEmptyString(value.acknowledgedAt) && !Number.isNaN(Date.parse(String(value.acknowledgedAt)))))) errors.push("acknowledgedAt must be null or an ISO date");
  if (typeof value.shownAt === "string" && typeof value.acknowledgedAt === "string" && Date.parse(value.acknowledgedAt) < Date.parse(value.shownAt)) errors.push("acknowledgedAt cannot precede shownAt");
  return errors.length ? fail(errors) : pass(value as AEmotionKeyModalReceiptV1);
}

function validateModalResponse(value: unknown, index: number, errors: string[]) {
  const label = `responseOptions[${index}]`;
  if (!isRecord(value)) { errors.push(`${label} must be an object`); return; }
  errors.push(...onlyKeys(value, MODAL_RESPONSE_KEYS).map((error) => `${label}: ${error}`));
  if (!nonEmptyString(value.code)) errors.push(`${label}.code is required`);
  if (!nonEmptyString(value.label)) errors.push(`${label}.label is required`);
  if (!(value.preferredEntry === "INVESTIGATE" || value.preferredEntry === "TALK" || value.preferredEntry === "PLAN" || value.preferredEntry === "DEFER")) errors.push(`${label}.preferredEntry is invalid`);
  if (!(value.intentKey === null || nonEmptyString(value.intentKey))) errors.push(`${label}.intentKey must be null or a non-empty string`);
  if (!(value.prefillText === null || nonEmptyString(value.prefillText))) errors.push(`${label}.prefillText must be null or a non-empty string`);
}

function forbiddenPaths(value: unknown, path = "$", output: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item, index) => forbiddenPaths(item, `${path}[${index}]`, output));
  else if (isRecord(value)) for (const [key, item] of Object.entries(value)) {
    const next = `${path}.${key}`;
    if (FORBIDDEN_SOURCE_KEYS.has(key)) output.push(next);
    forbiddenPaths(item, next, output);
  }
  return output;
}
