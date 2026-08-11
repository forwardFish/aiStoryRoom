import {
  fail,
  integerAtLeast,
  isRecord,
  nonEmptyString,
  onlyKeys,
  pass,
  type ValidationResult
} from "./schema-utils";

export const A_EMOTION_M1_PROJECTION_SCHEMA_VERSION = "a_emotion_m1_projection_v1" as const;
export const A_EMOTION_M1_EVENT_TYPE = "A_EMOTION_M1_CROSS_IMPACT" as const;

export type AEmotionM1VisibleImpact = {
  key: "imperial_trust";
  label: string;
  before: number;
  after: number;
  delta: number;
  suffix: string;
  safeReason: string;
};

export type AEmotionM1ResponseOption = {
  code: "INVESTIGATE_LEDGER_ANOMALY" | "QUESTION_DELIVERY_PUBLICLY" | "DEFER_RESPONSE";
  label: "派遣调查" | "公开质问" | "暂不回应";
  preferredEntry: "INVESTIGATE" | "TALK" | "DEFER";
  intentKey: string | null;
  prefillText: string | null;
};

/**
 * Strict, viewer-safe M1 payload delivered to a single affected role.
 * Canonical source identity, raw actions, raw audience and internal dedupe keys
 * intentionally do not exist in this contract.
 */
export type AEmotionM1ProjectionV1 = {
  schemaVersion: typeof A_EMOTION_M1_PROJECTION_SCHEMA_VERSION;
  projectionVersion: 1;
  stateVersion: number;
  eventSequence: number;
  category: "RELATED";
  disclosure: "HIDDEN";
  severity: "MAJOR";
  centerCardType: "CROSS_IMPACT";
  title: "他人的行动改变了你的处境";
  summary: string;
  sourceStatus: "来源未知";
  knownFacts: string[];
  visibleImpacts: AEmotionM1VisibleImpact[];
  responseOptions: AEmotionM1ResponseOption[];
  occurredAt: string;
};

const ROOT_KEYS = [
  "schemaVersion", "projectionVersion", "stateVersion", "eventSequence",
  "category", "disclosure", "severity", "centerCardType", "title",
  "summary", "sourceStatus", "knownFacts", "visibleImpacts",
  "responseOptions", "occurredAt"
] as const;
const IMPACT_KEYS = ["key", "label", "before", "after", "delta", "suffix", "safeReason"] as const;
const RESPONSE_KEYS = ["code", "label", "preferredEntry", "intentKey", "prefillText"] as const;

const FORBIDDEN_KEYS = new Set([
  "source", "sourceId", "sourceRole", "sourceRoleId", "sourceRoleKey", "sourceRoleName",
  "sourceActorId", "sourceActorName", "sourceActionId", "playerActionId", "targetRoleId",
  "targetRoleKey", "targetRoleName", "dedupeKey", "internalDedupeKey", "audience",
  "audienceRoleIds", "audienceUserIds", "rawAudience", "rawAction", "rawPayload",
  "privatePayload", "suspectedRoleIds", "canonicalPayload"
]);

const SOURCE_SEMANTIC_PATTERNS = [
  /\bxunfu\b/i,
  /zhejiang[_-]?xunfu/i,
  /浙江巡抚/,
  /巡抚衙门/,
  /巡抚(?:本人|玩家)?/,
  /命令?县令/,
  /要求县令/,
  /只(?:交|提交)(?:了)?(?:转抄)?副本/,
  /隐(?:藏|瞒)(?:了)?原(?:始)?粮册/
] as const;

const OPAQUE_EVENT_ID = /^evt_[A-Za-z0-9_-]{24,}$/;
const RAW_ID_HINT = /(playerAction|targetRole|sourceRole|dedupe|xunfu|governor|action[:_-]|role[:_-]|run[:_-])/i;

export function isOpaqueAEmotionM1EventId(value: unknown): value is string {
  return typeof value === "string"
    && OPAQUE_EVENT_ID.test(value)
    && !value.includes(":")
    && !RAW_ID_HINT.test(value);
}

export function aEmotionM1ForbiddenPaths(value: unknown, path = "$", output: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => aEmotionM1ForbiddenPaths(item, `${path}[${index}]`, output));
    return output;
  }
  if (!isRecord(value)) return output;
  for (const [key, item] of Object.entries(value)) {
    const next = `${path}.${key}`;
    if (FORBIDDEN_KEYS.has(key)) output.push(next);
    aEmotionM1ForbiddenPaths(item, next, output);
  }
  return output;
}

export function aEmotionM1SemanticLeaks(value: unknown, path = "$", output: string[] = []): string[] {
  if (typeof value === "string") {
    if (SOURCE_SEMANTIC_PATTERNS.some((pattern) => pattern.test(value))) output.push(path);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => aEmotionM1SemanticLeaks(item, `${path}[${index}]`, output));
    return output;
  }
  if (!isRecord(value)) return output;
  for (const [key, item] of Object.entries(value)) aEmotionM1SemanticLeaks(item, `${path}.${key}`, output);
  return output;
}

export function validateAEmotionM1ProjectionV1(value: unknown): ValidationResult<AEmotionM1ProjectionV1> {
  if (!isRecord(value)) return fail(["M1 projection must be an object"]);
  const errors = onlyKeys(value, ROOT_KEYS);
  if (value.schemaVersion !== A_EMOTION_M1_PROJECTION_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (value.projectionVersion !== 1) errors.push("projectionVersion must be 1");
  if (!integerAtLeast(value.stateVersion, 1)) errors.push("stateVersion must be >= 1");
  if (!integerAtLeast(value.eventSequence, 1)) errors.push("eventSequence must be >= 1");
  if (value.category !== "RELATED") errors.push("category must be RELATED");
  if (value.disclosure !== "HIDDEN") errors.push("disclosure must be HIDDEN");
  if (value.severity !== "MAJOR") errors.push("severity must be MAJOR");
  if (value.centerCardType !== "CROSS_IMPACT") errors.push("centerCardType must be CROSS_IMPACT");
  if (value.title !== "他人的行动改变了你的处境") errors.push("invalid title");
  if (!nonEmptyString(value.summary)) errors.push("summary is required");
  if (value.sourceStatus !== "来源未知") errors.push("sourceStatus must remain hidden");
  if (!Array.isArray(value.knownFacts) || value.knownFacts.length < 1 || value.knownFacts.some((item) => !nonEmptyString(item))) errors.push("knownFacts must contain safe facts");
  if (!Array.isArray(value.visibleImpacts) || value.visibleImpacts.length < 1) errors.push("visibleImpacts must not be empty");
  else value.visibleImpacts.forEach((impact, index) => validateImpact(impact, index, errors));
  if (!Array.isArray(value.responseOptions) || value.responseOptions.length !== 3) errors.push("responseOptions must contain exactly three M1 choices");
  else validateResponses(value.responseOptions, errors);
  if (!nonEmptyString(value.occurredAt) || Number.isNaN(Date.parse(String(value.occurredAt)))) errors.push("occurredAt must be an ISO date");
  const forbidden = aEmotionM1ForbiddenPaths(value);
  if (forbidden.length) errors.push(`forbidden hidden fields: ${forbidden.join(",")}`);
  const semanticLeaks = aEmotionM1SemanticLeaks(value);
  if (semanticLeaks.length) errors.push(`hidden source semantic leak: ${semanticLeaks.join(",")}`);
  return errors.length ? fail(errors) : pass(value as AEmotionM1ProjectionV1);
}

function validateImpact(value: unknown, index: number, errors: string[]) {
  const label = `visibleImpacts[${index}]`;
  if (!isRecord(value)) { errors.push(`${label} must be an object`); return; }
  errors.push(...onlyKeys(value, IMPACT_KEYS).map((error) => `${label}: ${error}`));
  if (value.key !== "imperial_trust") errors.push(`${label}.key must be imperial_trust`);
  if (!nonEmptyString(value.label)) errors.push(`${label}.label is required`);
  for (const key of ["before", "after", "delta"] as const) if (!Number.isInteger(value[key])) errors.push(`${label}.${key} must be an integer`);
  if (Number.isInteger(value.before) && Number.isInteger(value.after) && Number.isInteger(value.delta) && Number(value.after) - Number(value.before) !== Number(value.delta)) errors.push(`${label} delta does not match before/after`);
  if (typeof value.suffix !== "string") errors.push(`${label}.suffix must be a string`);
  if (!nonEmptyString(value.safeReason)) errors.push(`${label}.safeReason is required`);
}

function validateResponses(values: unknown[], errors: string[]) {
  const expected = new Map([
    ["INVESTIGATE_LEDGER_ANOMALY", ["派遣调查", "INVESTIGATE"]],
    ["QUESTION_DELIVERY_PUBLICLY", ["公开质问", "TALK"]],
    ["DEFER_RESPONSE", ["暂不回应", "DEFER"]]
  ] as const);
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const label = `responseOptions[${index}]`;
    if (!isRecord(value)) { errors.push(`${label} must be an object`); return; }
    errors.push(...onlyKeys(value, RESPONSE_KEYS).map((error) => `${label}: ${error}`));
    const rule = expected.get(String(value.code) as never);
    if (!rule) errors.push(`${label}.code is invalid`);
    else {
      if (seen.has(String(value.code))) errors.push(`${label}.code is duplicated`);
      seen.add(String(value.code));
      if (value.label !== rule[0] || value.preferredEntry !== rule[1]) errors.push(`${label} action mapping is invalid`);
    }
    if (!(value.intentKey === null || nonEmptyString(value.intentKey))) errors.push(`${label}.intentKey must be string or null`);
    if (!(value.prefillText === null || nonEmptyString(value.prefillText))) errors.push(`${label}.prefillText must be string or null`);
  });
  for (const code of expected.keys()) if (!seen.has(code)) errors.push(`missing response option ${code}`);
}
