import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

export const ROOM_LOBBY_CHANGE_EVENT_TYPE_V1 = "room.invalidated" as const;
export const ROOM_LOBBY_CHANGE_SCHEMA_VERSION_V1 = "room_lobby_changed_v1" as const;
export const ROOM_LOBBY_CHANGE_CONTRACT_ERROR_CODE_V1 = "EVENT_CONTRACT_INVALID" as const;
export const ROOM_LOBBY_CHANGE_MAX_MESSAGE_BYTES_V1 = 2_048;
export const ROOM_LOBBY_CHANGE_MAX_EVENT_ID_LENGTH_V1 = 160;
export const ROOM_LOBBY_CHANGE_MAX_ROOM_ID_LENGTH_V1 = 160;

export const ROOM_LOBBY_CHANGE_REASONS_V1 = Object.freeze([
  "ROOM_CREATED",
  "MEMBER_JOINED",
  "ROLE_CHANGED",
  "READY_CHANGED",
  "MEMBER_LEFT",
  "WAITING_EXTENDED",
  "ROOM_EXPIRED",
  "ROOM_CLOSED",
  "START_STATE_CHANGED",
  "GAME_STARTED",
] as const);

export type RoomLobbyChangeReasonV1 =
  (typeof ROOM_LOBBY_CHANGE_REASONS_V1)[number];

export interface RoomLobbyChangeEventV1 {
  readonly type: typeof ROOM_LOBBY_CHANGE_EVENT_TYPE_V1;
  readonly schemaVersion: typeof ROOM_LOBBY_CHANGE_SCHEMA_VERSION_V1;
  readonly eventId: string;
  readonly roomId: string;
  readonly reason: RoomLobbyChangeReasonV1;
  readonly occurredAt: string;
}

export interface CreateRoomLobbyChangeEventInputV1 {
  readonly roomId: string;
  readonly reason: RoomLobbyChangeReasonV1;
  readonly eventId?: string;
  readonly occurredAt?: string;
}

export interface RoomLobbyChangeEventFactoryOptionsV1 {
  readonly now?: () => Date;
  readonly randomId?: () => string;
}

const EVENT_KEYS = Object.freeze([
  "type",
  "schemaVersion",
  "eventId",
  "roomId",
  "reason",
  "occurredAt",
] as const);
const EVENT_KEY_SET = new Set<string>(EVENT_KEYS);
const REASON_SET = new Set<string>(ROOM_LOBBY_CHANGE_REASONS_V1);
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const CANONICAL_UTC_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class RoomLobbyChangeContractError extends Error {
  readonly code = ROOM_LOBBY_CHANGE_CONTRACT_ERROR_CODE_V1;

  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${ROOM_LOBBY_CHANGE_CONTRACT_ERROR_CODE_V1}:${path}:${reason}`);
    this.name = "RoomLobbyChangeContractError";
  }
}

export function isRoomLobbyChangeReasonV1(
  value: unknown,
): value is RoomLobbyChangeReasonV1 {
  return typeof value === "string" && REASON_SET.has(value);
}

export function createRoomLobbyChangeEventV1(
  input: Readonly<CreateRoomLobbyChangeEventInputV1>,
  options: Readonly<RoomLobbyChangeEventFactoryOptionsV1> = {},
): Readonly<RoomLobbyChangeEventV1> {
  const eventId = input.eventId
    ?? `evt_${(options.randomId ?? randomUUID)()}`;
  const occurredAt = input.occurredAt
    ?? (options.now ?? (() => new Date()))().toISOString();

  return assertRoomLobbyChangeEventV1({
    type: ROOM_LOBBY_CHANGE_EVENT_TYPE_V1,
    schemaVersion: ROOM_LOBBY_CHANGE_SCHEMA_VERSION_V1,
    eventId,
    roomId: input.roomId,
    reason: input.reason,
    occurredAt,
  });
}

export function assertRoomLobbyChangeEventV1(
  value: unknown,
): Readonly<RoomLobbyChangeEventV1> {
  const event = requireExactEventRecord(value);
  const type = readOwnField(event, "type");
  const schemaVersion = readOwnField(event, "schemaVersion");

  if (type !== ROOM_LOBBY_CHANGE_EVENT_TYPE_V1) {
    invalid("$.type", "UNSUPPORTED_TYPE");
  }
  if (schemaVersion !== ROOM_LOBBY_CHANGE_SCHEMA_VERSION_V1) {
    invalid("$.schemaVersion", "UNSUPPORTED_SCHEMA_VERSION");
  }

  const eventId = requireSafeIdentifier(
    readOwnField(event, "eventId"),
    "$.eventId",
    8,
    ROOM_LOBBY_CHANGE_MAX_EVENT_ID_LENGTH_V1,
  );
  const roomId = requireSafeIdentifier(
    readOwnField(event, "roomId"),
    "$.roomId",
    1,
    ROOM_LOBBY_CHANGE_MAX_ROOM_ID_LENGTH_V1,
  );
  const reason = readOwnField(event, "reason");
  if (!isRoomLobbyChangeReasonV1(reason)) {
    invalid("$.reason", "UNKNOWN_REASON");
  }
  const occurredAt = requireCanonicalInstant(
    readOwnField(event, "occurredAt"),
  );

  const normalized: RoomLobbyChangeEventV1 = {
    type: ROOM_LOBBY_CHANGE_EVENT_TYPE_V1,
    schemaVersion: ROOM_LOBBY_CHANGE_SCHEMA_VERSION_V1,
    eventId,
    roomId,
    reason,
    occurredAt,
  };
  if (
    Buffer.byteLength(JSON.stringify(normalized), "utf8")
      > ROOM_LOBBY_CHANGE_MAX_MESSAGE_BYTES_V1
  ) {
    invalid("$", "MESSAGE_TOO_LARGE");
  }
  return Object.freeze(normalized);
}

export function isRoomLobbyChangeEventV1(
  value: unknown,
): value is RoomLobbyChangeEventV1 {
  try {
    assertRoomLobbyChangeEventV1(value);
    return true;
  } catch {
    return false;
  }
}

function requireExactEventRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid("$", "OBJECT_REQUIRED");
  }

  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    invalid("$", "UNREADABLE_OBJECT");
  }

  if (prototype !== Object.prototype && prototype !== null) {
    invalid("$", "OBJECT_REQUIRED");
  }
  for (const key of keys) {
    if (typeof key !== "string" || !EVENT_KEY_SET.has(key)) {
      invalid(typeof key === "string" ? `$.${key}` : "$", "UNKNOWN_FIELD");
    }
  }
  for (const key of EVENT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      invalid(`$.${key}`, "FIELD_REQUIRED");
    }
  }
  if (keys.length !== EVENT_KEYS.length) {
    invalid("$", "FIELD_SET_INVALID");
  }
  return value as Record<string, unknown>;
}

function readOwnField(
  record: Record<string, unknown>,
  field: (typeof EVENT_KEYS)[number],
): unknown {
  try {
    return record[field];
  } catch {
    invalid(`$.${field}`, "UNREADABLE_FIELD");
  }
}

function requireSafeIdentifier(
  value: unknown,
  path: "$.eventId" | "$.roomId",
  minimumLength: number,
  maximumLength: number,
): string {
  if (typeof value !== "string") invalid(path, "STRING_REQUIRED");
  if (value.length < minimumLength) invalid(path, "TOO_SHORT");
  if (value.length > maximumLength) invalid(path, "TOO_LONG");
  if (value !== value.trim() || !SAFE_IDENTIFIER.test(value)) {
    invalid(path, "INVALID_IDENTIFIER");
  }
  return value;
}

function requireCanonicalInstant(value: unknown): string {
  if (typeof value !== "string") invalid("$.occurredAt", "STRING_REQUIRED");
  if (!CANONICAL_UTC_INSTANT.test(value)) {
    invalid("$.occurredAt", "UTC_ISO_MILLISECONDS_REQUIRED");
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    invalid("$.occurredAt", "INVALID_TIMESTAMP");
  }
  return value;
}

function invalid(path: string, reason: string): never {
  throw new RoomLobbyChangeContractError(path, reason);
}
