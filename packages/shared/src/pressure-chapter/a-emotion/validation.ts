import { hashWithoutField, isSha256 } from "../contracts/canonical";
import { validateSeatIdV1 } from "../contracts/domain";
import {
  A_EMOTION_CENTER_CARD_TYPES_V1,
  A_EMOTION_DISCLOSURE_LEVELS_V1,
  A_EMOTION_EVENT_KINDS_V1,
  A_EMOTION_FEED_CATEGORIES_V1,
  A_EMOTION_PRESENTATIONS_V1,
  A_EMOTION_SEVERITIES_V1,
  A_EMOTION_WORKBENCH_TYPES_V1,
  type AEmotionCenterCardV1,
  type AEmotionInteractionEventV1,
  type AEmotionKeyModalV1,
  type AEmotionViewerProjectionV1,
} from "./contracts";
import {
  A_EMOTION_CONTRACT_ERROR_CODES as ERROR,
  failAEmotionContract,
} from "./errors";

type RecordValue = Record<string, unknown>;

function object(value: unknown, path: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failAEmotionContract(ERROR.NOT_OBJECT, path);
  }
  return value as RecordValue;
}

function exactKeys(value: RecordValue, keys: readonly string[], path: string): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) failAEmotionContract(ERROR.UNKNOWN_FIELD, `${path}.${unknown}`);
  const missing = keys.find((key) => !(key in value));
  if (missing) failAEmotionContract(ERROR.MISSING_FIELD, `${path}.${missing}`);
}

function allowedKeys(
  value: RecordValue,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = [...required, ...optional];
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) failAEmotionContract(ERROR.UNKNOWN_FIELD, `${path}.${unknown}`);
  const missing = required.find((key) => !(key in value));
  if (missing) failAEmotionContract(ERROR.MISSING_FIELD, `${path}.${missing}`);
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    failAEmotionContract(ERROR.INVALID_FIELD, path, "NON_EMPTY_STRING");
  }
  return value;
}

function literal<T extends string>(value: unknown, expected: T, path: string): T {
  if (value !== expected) failAEmotionContract(ERROR.INVALID_FIELD, path, `EXPECTED_${expected}`);
  return expected;
}

function enumeration<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    failAEmotionContract(ERROR.INVALID_FIELD, path, `ALLOWED_${values.join("|")}`);
  }
  return value as T;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    failAEmotionContract(ERROR.INVALID_FIELD, path, `INTEGER_GTE_${minimum}`);
  }
  return Number(value);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") failAEmotionContract(ERROR.INVALID_FIELD, path, "BOOLEAN");
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : string(value, path);
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) failAEmotionContract(ERROR.INVALID_FIELD, path, "ARRAY");
  const values = value.map((item, index) => string(item, `${path}[${index}]`));
  if (new Set(values).size !== values.length) failAEmotionContract(ERROR.DUPLICATE_VALUE, path);
  return values;
}

function seatArray(value: unknown, path: string): ReturnType<typeof validateSeatIdV1>[] {
  if (!Array.isArray(value)) failAEmotionContract(ERROR.INVALID_FIELD, path, "ARRAY");
  const values = value.map((item, index) => validateSeatIdV1(item, `${path}[${index}]`));
  if (new Set(values).size !== values.length) failAEmotionContract(ERROR.DUPLICATE_VALUE, path);
  return values;
}

function timestamp(value: unknown, path: string): string {
  const result = string(value, path);
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) {
    failAEmotionContract(ERROR.INVALID_FIELD, path, "ISO_8601_UTC");
  }
  return result;
}

function sha(value: unknown, path: string): string {
  if (!isSha256(value)) failAEmotionContract(ERROR.INVALID_FIELD, path, "SHA256_LOWER_HEX");
  return value;
}

function assertSelfHash(value: RecordValue, field: string, path: string): void {
  sha(value[field], `${path}.${field}`);
  if (value[field] !== hashWithoutField(value, field)) {
    failAEmotionContract(ERROR.HASH_MISMATCH, `${path}.${field}`);
  }
}

function validateAudience(value: unknown, path: string): void {
  const record = object(value, path);
  const type = string(record.type, `${path}.type`);
  if (type === "OBSERVERS") {
    exactKeys(record, ["type", "resolverCode", "contextRefs"], path);
    string(record.resolverCode, `${path}.resolverCode`);
    stringArray(record.contextRefs, `${path}.contextRefs`);
    return;
  }
  if (!["PUBLIC_RELEVANT_SEATS", "AFFECTED_SEATS", "EXPLICIT"].includes(type)) {
    failAEmotionContract(ERROR.INVALID_FIELD, `${path}.type`);
  }
  exactKeys(record, ["type", "seatIds"], path);
  if (seatArray(record.seatIds, `${path}.seatIds`).length === 0) {
    failAEmotionContract(ERROR.INVALID_FIELD, `${path}.seatIds`, "NON_EMPTY_ARRAY");
  }
}

function validateResponseOptions(value: unknown, path: string): void {
  if (!Array.isArray(value)) failAEmotionContract(ERROR.INVALID_FIELD, path, "ARRAY");
  const codes: string[] = [];
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    const record = object(item, itemPath);
    exactKeys(record, ["code", "preferredEntry", "consumesManeuverOnSubmit"], itemPath);
    codes.push(string(record.code, `${itemPath}.code`));
    enumeration(record.preferredEntry, A_EMOTION_WORKBENCH_TYPES_V1, `${itemPath}.preferredEntry`);
    boolean(record.consumesManeuverOnSubmit, `${itemPath}.consumesManeuverOnSubmit`);
  });
  if (new Set(codes).size !== codes.length) failAEmotionContract(ERROR.DUPLICATE_VALUE, path);
}

function validateCardActions(value: unknown, path: string): void {
  if (!Array.isArray(value)) failAEmotionContract(ERROR.INVALID_FIELD, path, "ARRAY");
  const codes: string[] = [];
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    const record = object(item, itemPath);
    exactKeys(record, ["code", "label", "preferredEntry", "consumesManeuverOnSubmit"], itemPath);
    codes.push(string(record.code, `${itemPath}.code`));
    string(record.label, `${itemPath}.label`);
    enumeration(record.preferredEntry, A_EMOTION_WORKBENCH_TYPES_V1, `${itemPath}.preferredEntry`);
    boolean(record.consumesManeuverOnSubmit, `${itemPath}.consumesManeuverOnSubmit`);
  });
  if (new Set(codes).size !== codes.length) failAEmotionContract(ERROR.DUPLICATE_VALUE, path);
}

function validatePresentation(value: unknown, disclosure: string, promiseId: string | null, path: string): void {
  const record = object(value, path);
  exactKeys(record, ["recommendedPresentation", "centerCardType", "responseOptions", "modalTrigger"], path);
  const recommendation = enumeration(record.recommendedPresentation, A_EMOTION_PRESENTATIONS_V1, `${path}.recommendedPresentation`);
  const cardType = record.centerCardType === null
    ? null
    : enumeration(record.centerCardType, A_EMOTION_CENTER_CARD_TYPES_V1.filter((item) => item !== "DECISION"), `${path}.centerCardType`);
  validateResponseOptions(record.responseOptions, `${path}.responseOptions`);
  if (
    recommendation === "FEED_ONLY"
    && (record.modalTrigger !== null || (cardType !== null && cardType !== "CROSS_IMPACT"))
  ) {
    failAEmotionContract(ERROR.PRESENTATION_VIOLATION, path, "FEED_ONLY_SURFACE_INVALID");
  }
  if (recommendation !== "FEED_ONLY" && cardType === null) {
    failAEmotionContract(ERROR.PRESENTATION_VIOLATION, `${path}.centerCardType`, "CARD_REQUIRED");
  }
  if (recommendation === "KEY_MODAL") {
    const trigger = object(record.modalTrigger, `${path}.modalTrigger`);
    exactKeys(trigger, ["type", "triggerId", "stateVersion"], `${path}.modalTrigger`);
    const type = enumeration(trigger.type, ["PROMISE_BROKEN", "CRISIS", "STAGE_VICTORY"] as const, `${path}.modalTrigger.type`);
    if (type !== cardType) failAEmotionContract(ERROR.PRESENTATION_VIOLATION, path, "MODAL_CARD_MISMATCH");
    string(trigger.triggerId, `${path}.modalTrigger.triggerId`);
    integer(trigger.stateVersion, `${path}.modalTrigger.stateVersion`, 1);
  } else if (record.modalTrigger !== null) {
    failAEmotionContract(ERROR.PRESENTATION_VIOLATION, `${path}.modalTrigger`, "UNEXPECTED_MODAL");
  }
  if (cardType === "PROMISE_BROKEN" && promiseId === null) {
    failAEmotionContract(ERROR.PRESENTATION_VIOLATION, path, "PROMISE_ID_REQUIRED");
  }
  if (recommendation === "KEY_MODAL" && cardType === "PROMISE_BROKEN" && disclosure !== "CONFIRMED") {
    failAEmotionContract(ERROR.PRESENTATION_VIOLATION, path, "PROMISE_NOT_REVEALED");
  }
}

export function validateAEmotionInteractionEventV1(
  value: unknown,
  path = "interactionEvent",
): AEmotionInteractionEventV1 {
  const record = object(value, path);
  exactKeys(record, [
    "schemaVersion", "eventId", "roomId", "runId", "stageId", "sourceCommitHash",
    "sourceActionId", "sourceSeatId", "kind", "eventCode", "eventFamily", "severity",
    "sharedObjectId", "factRefs", "publicFactRefs", "impacts", "audienceSpec", "disclosure",
    "suspectedSeatIds", "suspicionBasisRefs", "evidenceRefs", "revealOfEventId", "promiseId",
    "milestoneId", "metricTransitionId", "presentation", "occurredAt", "eventSequence",
    "stateVersion", "idempotencyKey", "eventHash",
  ], path);
  literal(record.schemaVersion, "a_emotion_interaction_event_v1", `${path}.schemaVersion`);
  ["eventId", "roomId", "runId", "stageId", "sourceActionId", "eventCode", "eventFamily", "idempotencyKey"]
    .forEach((key) => string(record[key], `${path}.${key}`));
  sha(record.sourceCommitHash, `${path}.sourceCommitHash`);
  validateSeatIdV1(record.sourceSeatId, `${path}.sourceSeatId`);
  const kind = enumeration(record.kind, A_EMOTION_EVENT_KINDS_V1, `${path}.kind`);
  enumeration(record.severity, A_EMOTION_SEVERITIES_V1, `${path}.severity`);
  nullableString(record.sharedObjectId, `${path}.sharedObjectId`);
  const facts = stringArray(record.factRefs, `${path}.factRefs`);
  const publicFacts = stringArray(record.publicFactRefs, `${path}.publicFactRefs`);
  if (publicFacts.some((fact) => !facts.includes(fact))) {
    failAEmotionContract(ERROR.INVALID_FIELD, `${path}.publicFactRefs`, "NOT_EVENT_FACT");
  }
  if (!Array.isArray(record.impacts)) failAEmotionContract(ERROR.INVALID_FIELD, `${path}.impacts`, "ARRAY");
  record.impacts.forEach((impact, index) => {
    const impactPath = `${path}.impacts[${index}]`;
    const item = object(impact, impactPath);
    exactKeys(item, ["targetSeatId", "visibility", "type", "key", "before", "after", "delta", "effectCode"], impactPath);
    validateSeatIdV1(item.targetSeatId, `${impactPath}.targetSeatId`);
    enumeration(item.visibility, ["TARGET_ONLY", "PUBLIC"] as const, `${impactPath}.visibility`);
    enumeration(item.type, ["STAT", "RESOURCE", "GOAL_PROGRESS", "ACTION_OPTION", "RISK", "SHARED_OBJECT"] as const, `${impactPath}.type`);
    string(item.key, `${impactPath}.key`);
    for (const key of ["before", "after"] as const) {
      if (item[key] !== null && typeof item[key] !== "string" && (typeof item[key] !== "number" || !Number.isFinite(item[key]))) {
        failAEmotionContract(ERROR.INVALID_FIELD, `${impactPath}.${key}`, "SCALAR");
      }
    }
    if (item.delta !== null && (typeof item.delta !== "number" || !Number.isFinite(item.delta))) {
      failAEmotionContract(ERROR.INVALID_FIELD, `${impactPath}.delta`, "FINITE_NUMBER_OR_NULL");
    }
    string(item.effectCode, `${impactPath}.effectCode`);
  });
  validateAudience(record.audienceSpec, `${path}.audienceSpec`);
  const disclosure = enumeration(record.disclosure, A_EMOTION_DISCLOSURE_LEVELS_V1, `${path}.disclosure`);
  const suspected = seatArray(record.suspectedSeatIds, `${path}.suspectedSeatIds`);
  const suspicionBasis = stringArray(record.suspicionBasisRefs, `${path}.suspicionBasisRefs`);
  const evidence = stringArray(record.evidenceRefs, `${path}.evidenceRefs`);
  if (disclosure === "HIDDEN" && (suspected.length > 0 || suspicionBasis.length > 0)) {
    failAEmotionContract(ERROR.DISCLOSURE_VIOLATION, path, "HIDDEN_HAS_SUSPECTS");
  }
  if (disclosure === "SUSPECTED" && (suspected.length === 0 || suspicionBasis.length === 0)) {
    failAEmotionContract(ERROR.DISCLOSURE_VIOLATION, path, "SUSPECTED_WITHOUT_BASIS");
  }
  if (disclosure === "CONFIRMED" && evidence.length === 0) {
    failAEmotionContract(ERROR.DISCLOSURE_VIOLATION, path, "CONFIRMED_WITHOUT_EVIDENCE");
  }
  const reveal = nullableString(record.revealOfEventId, `${path}.revealOfEventId`);
  if ((kind === "REVEAL") !== (reveal !== null)) {
    failAEmotionContract(ERROR.INVALID_FIELD, `${path}.revealOfEventId`, "REVEAL_LINK_MISMATCH");
  }
  const promiseId = nullableString(record.promiseId, `${path}.promiseId`);
  nullableString(record.milestoneId, `${path}.milestoneId`);
  nullableString(record.metricTransitionId, `${path}.metricTransitionId`);
  validatePresentation(record.presentation, disclosure, promiseId, `${path}.presentation`);
  timestamp(record.occurredAt, `${path}.occurredAt`);
  integer(record.eventSequence, `${path}.eventSequence`, 1);
  integer(record.stateVersion, `${path}.stateVersion`, 1);
  assertSelfHash(record, "eventHash", path);
  return structuredClone(record) as unknown as AEmotionInteractionEventV1;
}

function validateCard(value: unknown, path: string): AEmotionCenterCardV1 {
  const record = object(value, path);
  exactKeys(record, ["id", "type", "accent", "title", "summary", "blockA", "blockB", "primaryAction", "secondaryAction", "tertiaryAction", "sourceEventId"], path);
  ["id", "title", "summary", "sourceEventId"].forEach((key) => string(record[key], `${path}.${key}`));
  enumeration(record.type, A_EMOTION_CENTER_CARD_TYPES_V1.filter((item) => item !== "DECISION"), `${path}.type`);
  enumeration(record.accent, ["PURPLE", "ORANGE_RED", "GREEN"] as const, `${path}.accent`);
  for (const key of ["blockA", "blockB"] as const) {
    const block = object(record[key], `${path}.${key}`);
    exactKeys(block, ["title", "lines"], `${path}.${key}`);
    string(block.title, `${path}.${key}.title`);
    if (stringArray(block.lines, `${path}.${key}.lines`).length === 0) failAEmotionContract(ERROR.INVALID_FIELD, `${path}.${key}.lines`, "NON_EMPTY_ARRAY");
  }
  for (const key of ["primaryAction", "secondaryAction", "tertiaryAction"] as const) {
    const action = object(record[key], `${path}.${key}`);
    exactKeys(action, ["code", "label", "preferredEntry", "consumesManeuverOnSubmit"], `${path}.${key}`);
    string(action.code, `${path}.${key}.code`);
    string(action.label, `${path}.${key}.label`);
    enumeration(action.preferredEntry, A_EMOTION_WORKBENCH_TYPES_V1, `${path}.${key}.preferredEntry`);
    boolean(action.consumesManeuverOnSubmit, `${path}.${key}.consumesManeuverOnSubmit`);
  }
  return record as unknown as AEmotionCenterCardV1;
}

function validateModal(value: unknown, card: AEmotionCenterCardV1 | null, path: string): AEmotionKeyModalV1 | null {
  if (value === null) return null;
  const record = object(value, path);
  exactKeys(record, ["id", "type", "priority", "serverSequence", "sourceEventId", "triggerId", "stateVersion", "dedupeKey", "card"], path);
  ["id", "sourceEventId", "triggerId", "dedupeKey"].forEach((key) => string(record[key], `${path}.${key}`));
  const type = enumeration(record.type, ["PROMISE_BROKEN", "CRISIS", "STAGE_VICTORY"] as const, `${path}.type`);
  const expectedPriority = type === "CRISIS" ? 300 : type === "PROMISE_BROKEN" ? 200 : 100;
  if (record.priority !== expectedPriority) failAEmotionContract(ERROR.PRESENTATION_VIOLATION, `${path}.priority`);
  integer(record.serverSequence, `${path}.serverSequence`, 1);
  integer(record.stateVersion, `${path}.stateVersion`, 1);
  const modalCard = validateCard(record.card, `${path}.card`);
  if (!card || modalCard.type !== type || modalCard.id !== card.id) {
    failAEmotionContract(ERROR.PRESENTATION_VIOLATION, path, "MODAL_CARD_MISMATCH");
  }
  return record as unknown as AEmotionKeyModalV1;
}

export function validateAEmotionViewerProjectionV1(
  value: unknown,
  path = "viewerProjection",
): AEmotionViewerProjectionV1 {
  const record = object(value, path);
  const required = [
    "schemaVersion", "eventId", "projectionVersion", "roomId", "runId", "viewerSeatId",
    "category", "disclosure", "severity", "title", "safeSummary", "statusLabel",
    "visibleImpacts", "knownFactRefs", "responseOptions", "recommendedPresentation",
    "centerCard", "keyModal", "eventSequence", "occurredAt", "projectionHash",
  ];
  allowedKeys(record, required, ["visibleSourceSeatId", "visibleSuspectedSeatIds"], path);
  literal(record.schemaVersion, "a_emotion_viewer_projection_v1", `${path}.schemaVersion`);
  ["eventId", "roomId", "runId", "title", "safeSummary", "statusLabel"].forEach((key) => string(record[key], `${path}.${key}`));
  integer(record.projectionVersion, `${path}.projectionVersion`, 1);
  validateSeatIdV1(record.viewerSeatId, `${path}.viewerSeatId`);
  enumeration(record.category, A_EMOTION_FEED_CATEGORIES_V1, `${path}.category`);
  const disclosure = enumeration(record.disclosure, A_EMOTION_DISCLOSURE_LEVELS_V1, `${path}.disclosure`);
  enumeration(record.severity, A_EMOTION_SEVERITIES_V1, `${path}.severity`);
  if (!Array.isArray(record.visibleImpacts)) failAEmotionContract(ERROR.INVALID_FIELD, `${path}.visibleImpacts`, "ARRAY");
  record.visibleImpacts.forEach((impact, index) => {
    const impactPath = `${path}.visibleImpacts[${index}]`;
    const item = object(impact, impactPath);
    exactKeys(item, ["effectCode", "label", "value"], impactPath);
    ["effectCode", "label", "value"].forEach((key) => string(item[key], `${impactPath}.${key}`));
  });
  stringArray(record.knownFactRefs, `${path}.knownFactRefs`);
  validateCardActions(record.responseOptions, `${path}.responseOptions`);
  enumeration(record.recommendedPresentation, A_EMOTION_PRESENTATIONS_V1, `${path}.recommendedPresentation`);
  const card = record.centerCard === null ? null : validateCard(record.centerCard, `${path}.centerCard`);
  const modal = validateModal(record.keyModal, card, `${path}.keyModal`);
  const eventSequence = integer(record.eventSequence, `${path}.eventSequence`, 1);
  if (modal && (
    modal.sourceEventId !== record.eventId
    || modal.serverSequence !== eventSequence
    || modal.dedupeKey !== [record.viewerSeatId, modal.type, modal.triggerId, modal.stateVersion].join(":")
  )) {
    failAEmotionContract(ERROR.PRESENTATION_VIOLATION, `${path}.keyModal`, "IDENTITY_MISMATCH");
  }
  timestamp(record.occurredAt, `${path}.occurredAt`);
  if (disclosure === "HIDDEN") {
    if ("visibleSourceSeatId" in record || "visibleSuspectedSeatIds" in record) {
      failAEmotionContract(ERROR.DISCLOSURE_VIOLATION, path, "HIDDEN_SOURCE_FIELD_PRESENT");
    }
  } else if (disclosure === "SUSPECTED") {
    if ("visibleSourceSeatId" in record || !("visibleSuspectedSeatIds" in record)) {
      failAEmotionContract(ERROR.DISCLOSURE_VIOLATION, path, "SUSPECTED_FIELD_MISMATCH");
    }
    seatArray(record.visibleSuspectedSeatIds, `${path}.visibleSuspectedSeatIds`);
  } else {
    validateSeatIdV1(record.visibleSourceSeatId, `${path}.visibleSourceSeatId`);
  }
  assertSelfHash(record, "projectionHash", path);
  return structuredClone(record) as unknown as AEmotionViewerProjectionV1;
}
