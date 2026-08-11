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
  aEmotionM1SemanticLeaks,
  validateAEmotionM1ProjectionV1,
  type AEmotionM1ProjectionV1
} from "./a-emotion-m1.schemas";
import { validateAEmotionKeyModalProjectionV1, type AEmotionKeyModalProjectionV1 } from "./a-emotion-m3.schemas";

export const A_EMOTION_M2_PROJECTION_SCHEMA_VERSION = "a_emotion_m2_projection_v1" as const;
export const A_EMOTION_M2_FEED_SCHEMA_VERSION = "a_emotion_m2_feed_v1" as const;
export const A_EMOTION_M2_EVENT_TYPE = "A_EMOTION_M2_DISCLOSURE" as const;
export const A_EMOTION_M2_EVENT_FAMILY = "LEDGER_DELIVERY" as const;
export const A_EMOTION_M2_SHARED_OBJECT_ID = "original-grain-ledger" as const;
export const A_EMOTION_M3_SHARED_OBJECT_ID = "metric-pressure" as const;
export const A_EMOTION_M3_EVENT_FAMILY = "METRIC_THRESHOLD" as const;
export const A_EMOTION_M4_SHARED_OBJECT_ID = "formal-promise" as const;
export const A_EMOTION_M4_EVENT_FAMILY = "PROMISE_LIFECYCLE" as const;
export const A_EMOTION_M5_SHARED_OBJECT_ID = "stage-milestone" as const;
export const A_EMOTION_M5_EVENT_FAMILY = "STAGE_MILESTONE" as const;

export type AEmotionM2DisclosureV1 = "HIDDEN" | "SUSPECTED" | "CONFIRMED";
export type AEmotionM2FeedCategoryV1 = "RELATED" | "PUBLIC" | "SUSPICIOUS";
export type AEmotionM2SeverityV1 = "MINOR" | "MAJOR" | "CRITICAL";
export type AEmotionM2CenterCardTypeV1 = "CROSS_IMPACT" | "SUSPICIOUS_TRACE" | "REVEAL" | "PUBLIC_EVENT" | "CRISIS" | "PROMISE_BROKEN" | "STAGE_VICTORY";
export type AEmotionM2SharedObjectIdV1 = typeof A_EMOTION_M2_SHARED_OBJECT_ID | typeof A_EMOTION_M3_SHARED_OBJECT_ID | typeof A_EMOTION_M4_SHARED_OBJECT_ID | typeof A_EMOTION_M5_SHARED_OBJECT_ID;
export type AEmotionM2EventFamilyV1 = typeof A_EMOTION_M2_EVENT_FAMILY | typeof A_EMOTION_M3_EVENT_FAMILY | typeof A_EMOTION_M4_EVENT_FAMILY | typeof A_EMOTION_M5_EVENT_FAMILY;
export type AEmotionM2PreferredEntryV1 = "INVESTIGATE" | "TALK" | "PLAN" | "DEFER";

export type AEmotionM2VisibleImpactV1 = {
  key: string;
  label: string;
  before: number;
  after: number;
  delta: number;
  suffix: string;
  safeReason: string;
};

export type AEmotionM2ResponseOptionV1 = {
  code: string;
  label: string;
  preferredEntry: AEmotionM2PreferredEntryV1;
  targetRoleKey: string | null;
  intentKey: string | null;
  prefillText: string | null;
};

/**
 * Viewer-safe aggregate projection. aggregateId is opaque and is not the
 * internal aggregate key. HIDDEN and SUSPECTED payloads contain no canonical
 * source identity; CONFIRMED requires durable evidence references.
 */
export type AEmotionM2ProjectionV1 = {
  schemaVersion: typeof A_EMOTION_M2_PROJECTION_SCHEMA_VERSION;
  projectionVersion: number;
  stateVersion: number;
  eventSequence: number;
  aggregateId: string;
  stageId: string;
  sharedObjectId: AEmotionM2SharedObjectIdV1;
  eventFamily: AEmotionM2EventFamilyV1;
  category: AEmotionM2FeedCategoryV1;
  disclosure: AEmotionM2DisclosureV1;
  severity: AEmotionM2SeverityV1;
  centerCardType: AEmotionM2CenterCardTypeV1;
  title: string;
  summary: string;
  sourceStatus: string;
  knownFacts: string[];
  visibleImpacts: AEmotionM2VisibleImpactV1[];
  responseOptions: AEmotionM2ResponseOptionV1[];
  visibleSuspectRoleIds?: string[];
  visibleSourceRoleId?: string;
  visibleSourceRoleKey?: string;
  evidenceRefs?: string[];
  keyModal?: AEmotionKeyModalProjectionV1;
  occurredAt: string;
};

export type AEmotionM2FeedItemV1 = AEmotionM2ProjectionV1 & {
  eventId: string;
  deliverySequence: number;
  isUnread: boolean;
  isAcknowledged: boolean;
  isResolved: boolean;
};

export type AEmotionM2FeedV1 = {
  schemaVersion: typeof A_EMOTION_M2_FEED_SCHEMA_VERSION;
  items: AEmotionM2FeedItemV1[];
  unreadCount: number;
  nextCursor: string | null;
  hasMore: boolean;
};

const PROJECTION_KEYS = [
  "schemaVersion", "projectionVersion", "stateVersion", "eventSequence", "aggregateId",
  "stageId", "sharedObjectId", "eventFamily", "category", "disclosure", "severity",
  "centerCardType", "title", "summary", "sourceStatus", "knownFacts", "visibleImpacts",
  "responseOptions", "visibleSuspectRoleIds", "visibleSourceRoleId", "visibleSourceRoleKey", "evidenceRefs", "keyModal", "occurredAt"
] as const;
const IMPACT_KEYS = ["key", "label", "before", "after", "delta", "suffix", "safeReason"] as const;
const RESPONSE_KEYS = ["code", "label", "preferredEntry", "targetRoleKey", "intentKey", "prefillText"] as const;
const FEED_ITEM_KEYS = [...PROJECTION_KEYS, "eventId", "deliverySequence", "isUnread", "isAcknowledged", "isResolved"] as const;

const OPAQUE_EVENT_ID = /^evt_[A-Za-z0-9_-]{24,}$/u;
const OPAQUE_AGGREGATE_ID = /^agg_[A-Za-z0-9_-]{24,}$/u;
const OPAQUE_CURSOR = /^m2c_[A-Za-z0-9_-]{16,}$/u;
const RAW_ID_HINT = /(playerAction|sourceAction|sourceRole|targetRole|dedupe|canonical|rawAudience|run[:_-]|action[:_-])/iu;
const FORBIDDEN_KEYS = new Set([
  "source", "sourceId", "sourceRole", "sourceRoleKey", "sourceRoleName", "sourceActorId",
  "sourceActorName", "sourceActionId", "playerActionId", "dedupeKey", "internalDedupeKey",
  "audience", "audienceRoleIds", "audienceUserIds", "rawAudience", "rawAction", "rawPayload",
  "canonicalPayload", "privatePayload", "internalPayload", "aggregateKey", "viewerUserId"
]);


export function isOpaqueAEmotionM2EventId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_EVENT_ID.test(value) && !value.includes(":") && !RAW_ID_HINT.test(value);
}

export function isOpaqueAEmotionM2AggregateId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_AGGREGATE_ID.test(value) && !value.includes(":") && !RAW_ID_HINT.test(value);
}

export function isOpaqueAEmotionM2Cursor(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_CURSOR.test(value) && !value.includes(":") && !RAW_ID_HINT.test(value);
}

export function aEmotionM2ForbiddenPaths(value: unknown, path = "$", output: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => aEmotionM2ForbiddenPaths(item, `${path}[${index}]`, output));
    return output;
  }
  if (!isRecord(value)) return output;
  for (const [key, item] of Object.entries(value)) {
    const next = `${path}.${key}`;
    if (FORBIDDEN_KEYS.has(key)) output.push(next);
    aEmotionM2ForbiddenPaths(item, next, output);
  }
  return output;
}

/** Reuse the already accepted M1 semantic-source deny list instead of adding
 * new world-text matching or gameplay trigger regexes in M2. */
export function aEmotionM2SemanticLeaks(value: unknown, path = "$", output: string[] = []): string[] {
  return aEmotionM1SemanticLeaks(value, path, output);
}

export function upgradeAEmotionM1ProjectionToM2(input: {
  projection: AEmotionM1ProjectionV1;
  aggregateId: string;
  stageId: string;
}): AEmotionM2ProjectionV1 {
  const m1 = validateAEmotionM1ProjectionV1(input.projection);
  if (!m1.ok) throw new Error(`A_EMOTION_M2_M1_PROJECTION_INVALID:${m1.errors.join("|")}`);
  const projection: AEmotionM2ProjectionV1 = {
    schemaVersion: A_EMOTION_M2_PROJECTION_SCHEMA_VERSION,
    projectionVersion: 1,
    stateVersion: m1.value.stateVersion,
    eventSequence: m1.value.eventSequence,
    aggregateId: input.aggregateId,
    stageId: input.stageId,
    sharedObjectId: A_EMOTION_M2_SHARED_OBJECT_ID,
    eventFamily: A_EMOTION_M2_EVENT_FAMILY,
    category: "RELATED",
    disclosure: "HIDDEN",
    severity: "MAJOR",
    centerCardType: "CROSS_IMPACT",
    title: m1.value.title,
    summary: m1.value.summary,
    sourceStatus: m1.value.sourceStatus,
    knownFacts: [...m1.value.knownFacts],
    visibleImpacts: m1.value.visibleImpacts.map((item) => ({ ...item })),
    responseOptions: m1.value.responseOptions.map((item) => ({
      code: item.code,
      label: item.label,
      preferredEntry: item.preferredEntry,
      targetRoleKey: null,
      intentKey: item.intentKey,
      prefillText: item.prefillText
    })),
    occurredAt: m1.value.occurredAt
  };
  const validation = validateAEmotionM2ProjectionV1(projection);
  if (!validation.ok) throw new Error(`A_EMOTION_M2_M1_ADAPTER_INVALID:${validation.errors.join("|")}`);
  return validation.value;
}

export function validateAEmotionM2ProjectionV1(value: unknown): ValidationResult<AEmotionM2ProjectionV1> {
  if (!isRecord(value)) return fail(["M2 projection must be an object"]);
  const errors = onlyKeys(value, PROJECTION_KEYS);
  if (value.schemaVersion !== A_EMOTION_M2_PROJECTION_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!integerAtLeast(value.projectionVersion, 1)) errors.push("projectionVersion must be >= 1");
  if (!integerAtLeast(value.stateVersion, 1)) errors.push("stateVersion must be >= 1");
  if (!integerAtLeast(value.eventSequence, 1)) errors.push("eventSequence must be >= 1");
  if (!isOpaqueAEmotionM2AggregateId(value.aggregateId)) errors.push("aggregateId must be opaque");
  if (!nonEmptyString(value.stageId)) errors.push("stageId is required");
  if (!(value.sharedObjectId === A_EMOTION_M2_SHARED_OBJECT_ID || value.sharedObjectId === A_EMOTION_M3_SHARED_OBJECT_ID || value.sharedObjectId === A_EMOTION_M4_SHARED_OBJECT_ID || value.sharedObjectId === A_EMOTION_M5_SHARED_OBJECT_ID)) errors.push("invalid sharedObjectId");
  if (!(value.eventFamily === A_EMOTION_M2_EVENT_FAMILY || value.eventFamily === A_EMOTION_M3_EVENT_FAMILY || value.eventFamily === A_EMOTION_M4_EVENT_FAMILY || value.eventFamily === A_EMOTION_M5_EVENT_FAMILY)) errors.push("invalid eventFamily");
  if (!(value.category === "RELATED" || value.category === "PUBLIC" || value.category === "SUSPICIOUS")) errors.push("invalid category");
  if (!(value.disclosure === "HIDDEN" || value.disclosure === "SUSPECTED" || value.disclosure === "CONFIRMED")) errors.push("invalid disclosure");
  if (!(value.severity === "MINOR" || value.severity === "MAJOR" || value.severity === "CRITICAL")) errors.push("invalid severity");
  if (!(value.centerCardType === "CROSS_IMPACT" || value.centerCardType === "SUSPICIOUS_TRACE" || value.centerCardType === "REVEAL" || value.centerCardType === "PUBLIC_EVENT" || value.centerCardType === "CRISIS" || value.centerCardType === "PROMISE_BROKEN" || value.centerCardType === "STAGE_VICTORY")) errors.push("invalid centerCardType");
  for (const key of ["title", "summary", "sourceStatus"] as const) if (!nonEmptyString(value[key])) errors.push(`${key} is required`);
  if (!stringArray(value.knownFacts) || value.knownFacts.length < 1 || value.knownFacts.length > 6) errors.push("knownFacts must contain one to six safe facts");
  if (!Array.isArray(value.visibleImpacts) || value.visibleImpacts.length > 6) errors.push("visibleImpacts must contain zero to six entries");
  else value.visibleImpacts.forEach((impact, index) => validateImpact(impact, index, errors));
  if (!Array.isArray(value.responseOptions) || value.responseOptions.length < 1 || value.responseOptions.length > 3) errors.push("responseOptions must contain one to three entries");
  else value.responseOptions.forEach((option, index) => validateResponse(option, index, errors));
  if (value.keyModal !== undefined) {
    const modal = validateAEmotionKeyModalProjectionV1(value.keyModal);
    if (!modal.ok) errors.push(...modal.errors.map((error) => `keyModal: ${error}`));
    else if (modal.value.projectionVersion !== value.projectionVersion || modal.value.stateVersion !== value.stateVersion) errors.push("keyModal version mismatch");
  }
  if (!nonEmptyString(value.occurredAt) || Number.isNaN(Date.parse(String(value.occurredAt)))) errors.push("occurredAt must be an ISO date");
  const forbidden = aEmotionM2ForbiddenPaths(value);
  if (forbidden.length) errors.push(`forbidden viewer fields: ${forbidden.join(",")}`);
  validateDisclosure(value, errors);
  return errors.length ? fail(errors) : pass(value as AEmotionM2ProjectionV1);
}

export function validateAEmotionM2FeedV1(value: unknown): ValidationResult<AEmotionM2FeedV1> {
  if (!isRecord(value)) return fail(["M2 feed must be an object"]);
  const errors = onlyKeys(value, ["schemaVersion", "items", "unreadCount", "nextCursor", "hasMore"]);
  if (value.schemaVersion !== A_EMOTION_M2_FEED_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!Array.isArray(value.items)) errors.push("items must be an array");
  if (!integerAtLeast(value.unreadCount, 0)) errors.push("unreadCount must be >= 0");
  if (!(value.nextCursor === null || isOpaqueAEmotionM2Cursor(value.nextCursor))) errors.push("nextCursor must be null or opaque");
  if (typeof value.hasMore !== "boolean") errors.push("hasMore must be boolean");
  if (Array.isArray(value.items)) {
    if (value.items.length > 10) errors.push("items must contain at most 10 entries");
    const eventIds = new Set<string>();
    const aggregateIds = new Set<string>();
    let unread = 0;
    for (const [index, item] of value.items.entries()) {
      if (!isRecord(item)) { errors.push(`items[${index}] must be an object`); continue; }
      errors.push(...onlyKeys(item, FEED_ITEM_KEYS).map((error) => `items[${index}]: ${error}`));
      const projection = validateAEmotionM2ProjectionV1(projectionRecordFromFeedItem(item));
      if (!projection.ok) errors.push(...projection.errors.map((error) => `items[${index}]: ${error}`));
      if (!isOpaqueAEmotionM2EventId(item.eventId)) errors.push(`items[${index}].eventId must be opaque`);
      else if (eventIds.has(item.eventId)) errors.push(`items[${index}].eventId must be unique`);
      else eventIds.add(item.eventId);
      if (typeof item.aggregateId === "string") {
        if (aggregateIds.has(item.aggregateId)) errors.push(`items[${index}].aggregateId must be unique`);
        else aggregateIds.add(item.aggregateId);
      }
      if (!integerAtLeast(item.deliverySequence, 1)) errors.push(`items[${index}].deliverySequence must be >= 1`);
      if (typeof item.isUnread !== "boolean") errors.push(`items[${index}].isUnread must be boolean`);
      else if (item.isUnread) unread += 1;
      if (typeof item.isAcknowledged !== "boolean") errors.push(`items[${index}].isAcknowledged must be boolean`);
      if (typeof item.isResolved !== "boolean") errors.push(`items[${index}].isResolved must be boolean`);
      if (item.isAcknowledged === true && item.isUnread === true) errors.push(`items[${index}] acknowledged item cannot be unread`);
    }
    if (typeof value.unreadCount === "number" && value.unreadCount !== unread) errors.push("unreadCount does not match items");
  }
  return errors.length ? fail(errors) : pass(value as AEmotionM2FeedV1);
}


function projectionRecordFromFeedItem(value: Record<string, unknown>): Record<string, unknown> {
  const projection: Record<string, unknown> = {};
  for (const key of PROJECTION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) projection[key] = value[key];
  }
  return projection;
}

function validateImpact(value: unknown, index: number, errors: string[]) {
  const label = `visibleImpacts[${index}]`;
  if (!isRecord(value)) { errors.push(`${label} must be an object`); return; }
  errors.push(...onlyKeys(value, IMPACT_KEYS).map((error) => `${label}: ${error}`));
  for (const key of ["key", "label", "safeReason"] as const) if (!nonEmptyString(value[key])) errors.push(`${label}.${key} is required`);
  for (const key of ["before", "after", "delta"] as const) if (!Number.isInteger(value[key])) errors.push(`${label}.${key} must be an integer`);
  if (Number.isInteger(value.before) && Number.isInteger(value.after) && Number.isInteger(value.delta) && Number(value.after) - Number(value.before) !== Number(value.delta)) errors.push(`${label}.delta does not match before/after`);
  if (typeof value.suffix !== "string") errors.push(`${label}.suffix must be a string`);
}

function validateResponse(value: unknown, index: number, errors: string[]) {
  const label = `responseOptions[${index}]`;
  if (!isRecord(value)) { errors.push(`${label} must be an object`); return; }
  errors.push(...onlyKeys(value, RESPONSE_KEYS).map((error) => `${label}: ${error}`));
  if (!nonEmptyString(value.code)) errors.push(`${label}.code is required`);
  if (!nonEmptyString(value.label)) errors.push(`${label}.label is required`);
  if (!(value.preferredEntry === "INVESTIGATE" || value.preferredEntry === "TALK" || value.preferredEntry === "PLAN" || value.preferredEntry === "DEFER")) errors.push(`${label}.preferredEntry is invalid`);
  if (!(value.targetRoleKey === null || nonEmptyString(value.targetRoleKey))) errors.push(`${label}.targetRoleKey must be string or null`);
  if (!(value.intentKey === null || nonEmptyString(value.intentKey))) errors.push(`${label}.intentKey must be string or null`);
  if (!(value.prefillText === null || nonEmptyString(value.prefillText))) errors.push(`${label}.prefillText must be string or null`);
}

function validateDisclosure(value: Record<string, unknown>, errors: string[]) {
  const suspects = value.visibleSuspectRoleIds;
  const source = value.visibleSourceRoleId;
  const sourceKey = value.visibleSourceRoleKey;
  const evidence = value.evidenceRefs;
  if (value.centerCardType === "PROMISE_BROKEN") {
    if (value.sharedObjectId !== A_EMOTION_M4_SHARED_OBJECT_ID || value.eventFamily !== A_EMOTION_M4_EVENT_FAMILY) errors.push("PROMISE_BROKEN requires formal-promise PROMISE_LIFECYCLE identity");
    if (value.category !== "RELATED" || value.disclosure !== "CONFIRMED" || value.severity !== "CRITICAL") errors.push("PROMISE_BROKEN must be RELATED CONFIRMED CRITICAL");
    if (!nonEmptyString(source) || !nonEmptyString(sourceKey)) errors.push("PROMISE_BROKEN requires confirmed source identity");
    if (!stringArray(evidence) || evidence.length < 1) errors.push("PROMISE_BROKEN requires evidenceRefs");
    if (!isRecord(value.keyModal) || value.keyModal.modalType !== "PROMISE_BROKEN") errors.push("PROMISE_BROKEN requires PROMISE_BROKEN keyModal");
    return;
  }
  if (value.centerCardType === "STAGE_VICTORY") {
    if (value.sharedObjectId !== A_EMOTION_M5_SHARED_OBJECT_ID || value.eventFamily !== A_EMOTION_M5_EVENT_FAMILY) errors.push("STAGE_VICTORY requires stage-milestone STAGE_MILESTONE identity");
    if (value.category !== "RELATED" || value.disclosure !== "CONFIRMED" || value.severity !== "MAJOR") errors.push("STAGE_VICTORY must be RELATED CONFIRMED MAJOR");
    if (suspects !== undefined || source !== undefined || sourceKey !== undefined) errors.push("STAGE_VICTORY cannot expose role source identity");
    if (!stringArray(evidence) || evidence.length < 1) errors.push("STAGE_VICTORY requires authoritative evidenceRefs");
    if (!isRecord(value.keyModal) || value.keyModal.modalType !== "STAGE_VICTORY") errors.push("STAGE_VICTORY requires STAGE_VICTORY keyModal");
    for (const option of Array.isArray(value.responseOptions) ? value.responseOptions : []) if (isRecord(option) && option.targetRoleKey !== null) errors.push("STAGE_VICTORY response cannot preselect a role");
    return;
  }
  if (value.centerCardType === "CRISIS") {
    if (value.sharedObjectId !== A_EMOTION_M3_SHARED_OBJECT_ID || value.eventFamily !== A_EMOTION_M3_EVENT_FAMILY) errors.push("CRISIS requires metric-pressure METRIC_THRESHOLD identity");
    if (value.category !== "RELATED" || value.disclosure !== "CONFIRMED" || value.severity !== "CRITICAL") errors.push("CRISIS must be RELATED CONFIRMED CRITICAL");
    if (suspects !== undefined || source !== undefined || sourceKey !== undefined) errors.push("CRISIS cannot expose role source identity");
    if (!stringArray(evidence) || evidence.length < 1) errors.push("CRISIS requires authoritative evidenceRefs");
    if (!isRecord(value.keyModal) || value.keyModal.modalType !== "CRISIS") errors.push("CRISIS requires CRISIS keyModal");
    for (const option of Array.isArray(value.responseOptions) ? value.responseOptions : []) if (isRecord(option) && option.targetRoleKey !== null) errors.push("CRISIS response cannot preselect a role");
    return;
  }
  if (value.disclosure === "HIDDEN") {
    if (suspects !== undefined || source !== undefined || sourceKey !== undefined || evidence !== undefined) errors.push("HIDDEN cannot expose suspects, source or evidence");
    if (value.category !== "RELATED" || value.centerCardType !== "CROSS_IMPACT") errors.push("HIDDEN must remain RELATED CROSS_IMPACT");
    if (!Array.isArray(value.visibleImpacts) || value.visibleImpacts.length < 1) errors.push("HIDDEN direct impact requires at least one visible impact");
    const leaks = aEmotionM2SemanticLeaks(value);
    if (leaks.length) errors.push(`HIDDEN source semantic leak: ${leaks.join(",")}`);
    for (const option of Array.isArray(value.responseOptions) ? value.responseOptions : []) if (isRecord(option) && option.targetRoleKey !== null) errors.push("HIDDEN response cannot preselect a role");
    return;
  }
  if (value.disclosure === "SUSPECTED") {
    if (!stringArray(suspects) || suspects.length < 2 || new Set(suspects).size !== suspects.length || suspects.some((item) => !nonEmptyString(item))) errors.push("SUSPECTED requires at least two distinct permitted suspects");
    if (source !== undefined || sourceKey !== undefined) errors.push("SUSPECTED cannot expose source identity");
    if (evidence !== undefined) errors.push("SUSPECTED cannot expose confirmation evidence");
    if (value.category !== "SUSPICIOUS" || value.centerCardType !== "SUSPICIOUS_TRACE") errors.push("SUSPECTED must use SUSPICIOUS_TRACE");
    for (const option of Array.isArray(value.responseOptions) ? value.responseOptions : []) if (isRecord(option) && option.targetRoleKey !== null) errors.push("SUSPECTED response cannot preselect a role");
    const leaks = aEmotionM2SemanticLeaks(value);
    if (leaks.length) errors.push(`SUSPECTED source semantic leak: ${leaks.join(",")}`);
    return;
  }
  if (!nonEmptyString(source)) errors.push("CONFIRMED requires visibleSourceRoleId");
  if (!nonEmptyString(sourceKey)) errors.push("CONFIRMED requires visibleSourceRoleKey");
  if (!stringArray(evidence) || evidence.length < 1) errors.push("CONFIRMED requires evidenceRefs");
  if (suspects !== undefined) errors.push("CONFIRMED cannot retain suspectedRoleIds");
  const publicAction = value.category === "PUBLIC" && value.centerCardType === "PUBLIC_EVENT";
  const relatedReveal = value.category === "RELATED" && value.centerCardType === "REVEAL";
  if (!publicAction && !relatedReveal) errors.push("CONFIRMED must use PUBLIC_EVENT or RELATED REVEAL");
  for (const option of Array.isArray(value.responseOptions) ? value.responseOptions : []) {
    if (isRecord(option) && option.preferredEntry !== "DEFER" && option.targetRoleKey !== null && option.targetRoleKey !== sourceKey) errors.push("CONFIRMED targeted response must use the confirmed source role");
  }
}
