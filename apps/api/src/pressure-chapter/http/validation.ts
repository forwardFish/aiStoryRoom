import {
  PRESSURE_CHAPTER_GAME_COMMAND_SCHEMA_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  type PressureChapterSubmitDecisionCommandV1,
  type SeatIdV1,
} from "@ai-story/shared";
import type {
  LegacyPressureSlotEndpointV1,
  PressureChapterChatHttpBodyV1,
  PressureChapterGameHttpQueryV1,
  PressureChapterHttpAccessV1,
  PressureChapterHttpPrincipalV1,
} from "./contracts";
import {
  PRESSURE_CHAPTER_HTTP_ERROR_CODES as ERROR,
  failPressureChapterHttp,
} from "./errors";

const SUBMIT_DECISION_KEYS = [
  "schemaVersion",
  "commandType",
  "runId",
  "routeHash",
  "chapterRuntimeId",
  "chapterId",
  "decisionPointId",
  "seatId",
  "controlEpoch",
  "expectedWorkingRevision",
  "submissionFenceToken",
  "idempotencyKey",
  "optionCode",
  "customText",
  "sourceEventId",
] as const;
const CHAT_KEYS = [
  "schemaVersion",
  "chapterRuntimeId",
  "chapterId",
  "senderSeatId",
  "visibility",
  "targetSeatIds",
  "text",
  "idempotencyKey",
  "requestFingerprint",
] as const;
const CHAPTER_IDS = ["P0", "N1", "N2", "N3", "N4", "N5", "N6", "N7"] as const;
const PLAYABLE_CHAPTER_IDS = ["N1", "N2", "N3", "N4", "N5", "N6", "N7"] as const;

export function parsePrincipal(
  value: PressureChapterHttpPrincipalV1,
): PressureChapterHttpPrincipalV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failPressureChapterHttp(ERROR.ACCESS_DENIED, "principal");
  }
  return {
    subjectId: requiredString(value.subjectId, "principal.subjectId"),
    viewerId: requiredString(value.viewerId, "principal.viewerId"),
  };
}

export function parseAccess(
  value: PressureChapterHttpAccessV1,
  roomId: string,
  principal: PressureChapterHttpPrincipalV1,
): PressureChapterHttpAccessV1 {
  const access = record(value, "access");
  exact(access, ["schemaVersion", "roomId", "runId", "subjectId", "viewerId"], "access");
  if (
    access.schemaVersion !== "pressure_chapter_http_access_v1" ||
    access.roomId !== roomId ||
    access.subjectId !== principal.subjectId ||
    access.viewerId !== principal.viewerId
  ) {
    failPressureChapterHttp(ERROR.ACCESS_DENIED, "access");
  }
  requiredString(access.runId, "access.runId");
  return structuredClone(value);
}

export function parseGameQuery(
  value: PressureChapterGameHttpQueryV1,
): PressureChapterGameHttpQueryV1 {
  const query = record(value, "query");
  exact(query, ["feedCursor", "feedLimit"], "query", false);
  if (query.feedCursor !== undefined && query.feedCursor !== null) {
    requiredString(query.feedCursor, "query.feedCursor");
  }
  if (query.feedLimit !== undefined) {
    requiredInteger(query.feedLimit, "query.feedLimit", 1, 10);
  }
  return structuredClone(value);
}

export function parseSubmitDecisionCommand(
  value: unknown,
): PressureChapterSubmitDecisionCommandV1 {
  const body = record(value, "body");
  exact(body, SUBMIT_DECISION_KEYS, "body");
  literal(body.schemaVersion, PRESSURE_CHAPTER_GAME_COMMAND_SCHEMA_V1, "body.schemaVersion");
  literal(body.commandType, "SUBMIT_DECISION", "body.commandType");
  const runId = boundedString(body.runId, "body.runId", 200);
  const routeHash = requiredHash(body.routeHash, "body.routeHash");
  const chapterRuntimeId = boundedString(body.chapterRuntimeId, "body.chapterRuntimeId", 300);
  const chapterId = playableChapter(body.chapterId, "body.chapterId");
  const decisionPointId = boundedString(body.decisionPointId, "body.decisionPointId", 300);
  const seatId = seat(body.seatId, "body.seatId");
  const controlEpoch = requiredInteger(body.controlEpoch, "body.controlEpoch", 1);
  const expectedWorkingRevision = requiredInteger(
    body.expectedWorkingRevision,
    "body.expectedWorkingRevision",
    0,
  );
  const submissionFenceToken = requiredHash(
    body.submissionFenceToken,
    "body.submissionFenceToken",
  );
  const idempotencyKey = boundedString(body.idempotencyKey, "body.idempotencyKey", 200);
  const optionCode = nullableBoundedString(body.optionCode, "body.optionCode", 200);
  const customText = nullableBoundedString(body.customText, "body.customText", 500);
  const sourceEventId = nullableBoundedString(body.sourceEventId, "body.sourceEventId", 200);
  if (optionCode === null && customText === null) {
    failPressureChapterHttp(ERROR.INPUT_INVALID, "body.optionCode");
  }
  return {
    schemaVersion: PRESSURE_CHAPTER_GAME_COMMAND_SCHEMA_V1,
    commandType: "SUBMIT_DECISION",
    runId,
    routeHash,
    chapterRuntimeId,
    chapterId,
    decisionPointId,
    seatId,
    controlEpoch,
    expectedWorkingRevision,
    submissionFenceToken,
    idempotencyKey,
    optionCode,
    customText,
    sourceEventId,
  };
}

export function parseChatBody(value: unknown): PressureChapterChatHttpBodyV1 {
  const body = record(value, "body");
  exact(body, CHAT_KEYS, "body");
  literal(body.schemaVersion, "pressure_chapter_chat_http_v1", "body.schemaVersion");
  requiredString(body.chapterRuntimeId, "body.chapterRuntimeId");
  chapter(body.chapterId, "body.chapterId");
  seat(body.senderSeatId, "body.senderSeatId");
  if (
    body.visibility !== "PUBLIC" &&
    body.visibility !== "PARTICIPANTS" &&
    body.visibility !== "PRIVATE"
  ) {
    failPressureChapterHttp(ERROR.INPUT_INVALID, "body.visibility");
  }
  const targetSeatIds = seatArray(body.targetSeatIds, "body.targetSeatIds");
  const text = requiredString(body.text, "body.text");
  if (text.length > 4_000) failPressureChapterHttp(ERROR.INPUT_INVALID, "body.text");
  requiredString(body.idempotencyKey, "body.idempotencyKey");
  requiredHash(body.requestFingerprint, "body.requestFingerprint");
  return {
    ...(body as unknown as PressureChapterChatHttpBodyV1),
    targetSeatIds,
  };
}

export function parseLegacyEndpoint(
  value: unknown,
): LegacyPressureSlotEndpointV1 {
  if (value !== "MAIN" && value !== "MANEUVER" && value !== "REACTION") {
    failPressureChapterHttp(ERROR.INPUT_INVALID, "legacySlot.endpoint");
  }
  return value;
}

export function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    failPressureChapterHttp(ERROR.INPUT_INVALID, path);
  }
  return value;
}

export function requiredInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    failPressureChapterHttp(ERROR.INPUT_INVALID, path);
  }
  return value;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failPressureChapterHttp(ERROR.INPUT_INVALID, path);
  }
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  requireAll = true,
): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) failPressureChapterHttp(ERROR.INPUT_INVALID, path + "." + unknown);
  if (!requireAll) return;
  const missing = keys.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing) failPressureChapterHttp(ERROR.INPUT_INVALID, path + "." + missing);
}

function literal(value: unknown, expected: string, path: string): void {
  if (value !== expected) failPressureChapterHttp(ERROR.INPUT_INVALID, path);
}

function requiredHash(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    failPressureChapterHttp(ERROR.INPUT_INVALID, path);
  }
  return value;
}

function boundedString(value: unknown, path: string, maximumLength: number): string {
  const parsed = requiredString(value, path);
  if (parsed.length > maximumLength) {
    failPressureChapterHttp(ERROR.INPUT_INVALID, path);
  }
  return parsed;
}

function nullableBoundedString(
  value: unknown,
  path: string,
  maximumLength: number,
): string | null {
  if (value === null) return null;
  return boundedString(value, path, maximumLength);
}

function chapter(value: unknown, path: string): void {
  if (
    typeof value !== "string" ||
    !CHAPTER_IDS.includes(value as (typeof CHAPTER_IDS)[number])
  ) {
    failPressureChapterHttp(ERROR.INPUT_INVALID, path);
  }
}

function playableChapter(
  value: unknown,
  path: string,
): PressureChapterSubmitDecisionCommandV1["chapterId"] {
  if (
    typeof value !== "string" ||
    !PLAYABLE_CHAPTER_IDS.includes(value as (typeof PLAYABLE_CHAPTER_IDS)[number])
  ) {
    failPressureChapterHttp(ERROR.INPUT_INVALID, path);
  }
  return value as PressureChapterSubmitDecisionCommandV1["chapterId"];
}

function seat(value: unknown, path: string): SeatIdV1 {
  if (
    typeof value !== "string" ||
    !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(value as SeatIdV1)
  ) {
    failPressureChapterHttp(ERROR.INPUT_INVALID, path);
  }
  return value as SeatIdV1;
}

function seatArray(value: unknown, path: string): SeatIdV1[] {
  if (!Array.isArray(value)) failPressureChapterHttp(ERROR.INPUT_INVALID, path);
  const parsed = value.map((item, index) =>
    seat(item, path + "[" + index + "]"),
  );
  if (new Set(parsed).size !== parsed.length) {
    failPressureChapterHttp(ERROR.INPUT_INVALID, path);
  }
  return parsed;
}
