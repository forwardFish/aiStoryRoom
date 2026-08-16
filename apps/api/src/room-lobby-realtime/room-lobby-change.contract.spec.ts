import assert from "node:assert/strict";
import test from "node:test";
import {
  ROOM_LOBBY_CHANGE_CONTRACT_ERROR_CODE_V1,
  ROOM_LOBBY_CHANGE_MAX_EVENT_ID_LENGTH_V1,
  ROOM_LOBBY_CHANGE_MAX_ROOM_ID_LENGTH_V1,
  ROOM_LOBBY_CHANGE_REASONS_V1,
  ROOM_LOBBY_CHANGE_SCHEMA_VERSION_V1,
  RoomLobbyChangeContractError,
  assertRoomLobbyChangeEventV1,
  createRoomLobbyChangeEventV1,
  isRoomLobbyChangeEventV1,
  isRoomLobbyChangeReasonV1,
} from "./room-lobby-change.contract";

const BASE_EVENT = Object.freeze({
  type: "room.invalidated",
  schemaVersion: ROOM_LOBBY_CHANGE_SCHEMA_VERSION_V1,
  eventId: "evt_00000000-0000-4000-8000-000000000001",
  roomId: "room_0123456789abcdef0123456789abcdef",
  reason: "READY_CHANGED" as const,
  occurredAt: "2026-08-15T00:00:00.000Z",
});

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...BASE_EVENT, ...overrides };
}

test("accepts every closed RoomLobby change reason", () => {
  for (const reason of ROOM_LOBBY_CHANGE_REASONS_V1) {
    const parsed = assertRoomLobbyChangeEventV1(event({ reason }));
    assert.deepEqual(parsed, { ...BASE_EVENT, reason });
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(isRoomLobbyChangeEventV1(parsed), true);
    assert.equal(isRoomLobbyChangeReasonV1(reason), true);
  }
});

test("creates a deterministic minimal invalidation event through injected clocks", () => {
  const parsed = createRoomLobbyChangeEventV1(
    { roomId: BASE_EVENT.roomId, reason: "ROLE_CHANGED" },
    {
      randomId: () => "00000000-0000-4000-8000-000000000002",
      now: () => new Date("2026-08-15T00:00:01.000Z"),
    },
  );

  assert.deepEqual(parsed, {
    type: "room.invalidated",
    schemaVersion: ROOM_LOBBY_CHANGE_SCHEMA_VERSION_V1,
    eventId: "evt_00000000-0000-4000-8000-000000000002",
    roomId: BASE_EVENT.roomId,
    reason: "ROLE_CHANGED",
    occurredAt: "2026-08-15T00:00:01.000Z",
  });
  assert.deepEqual(Object.keys(parsed), [
    "type",
    "schemaVersion",
    "eventId",
    "roomId",
    "reason",
    "occurredAt",
  ]);
});

test("does not invoke generators when the caller supplies eventId and occurredAt", () => {
  let calls = 0;
  const parsed = createRoomLobbyChangeEventV1(
    {
      eventId: BASE_EVENT.eventId,
      roomId: BASE_EVENT.roomId,
      reason: BASE_EVENT.reason,
      occurredAt: BASE_EVENT.occurredAt,
    },
    {
      randomId: () => { calls += 1; throw new Error("must not run"); },
      now: () => { calls += 1; throw new Error("must not run"); },
    },
  );

  assert.equal(calls, 0);
  assert.deepEqual(parsed, BASE_EVENT);
});

test("rejects unknown fields instead of forwarding privacy, credentials, or room state", () => {
  for (const [field, value] of [
    ["userId", "user-private"],
    ["email", "private@example.test"],
    ["sessionToken", "token-value"],
    ["cookie", "many_worlds_session=secret"],
    ["supabaseKey", "server-secret"],
    ["roomProjection", { players: [{ email: "private@example.test" }] }],
    ["pressureState", { readyUserIds: [] }],
  ] as const) {
    assertContractFailure(
      event({ [field]: value }),
      `$.${field}`,
      "UNKNOWN_FIELD",
    );
  }

  const prototypePayload = JSON.parse(
    `${JSON.stringify(BASE_EVENT).slice(0, -1)},"__proto__":{"polluted":true}}`,
  );
  assertContractFailure(prototypePayload, "$.__proto__", "UNKNOWN_FIELD");
  assertContractFailure(
    { ...BASE_EVENT, [Symbol("hidden")]: true },
    "$",
    "UNKNOWN_FIELD",
  );
});

test("rejects missing fields, wrong type, wrong schema, and unknown reasons", () => {
  const missingRoomId = event();
  delete missingRoomId.roomId;

  assertContractFailure(missingRoomId, "$.roomId", "FIELD_REQUIRED");
  assertContractFailure(event({ type: "room.ready" }), "$.type", "UNSUPPORTED_TYPE");
  assertContractFailure(
    event({ schemaVersion: "room_lobby_changed_v2" }),
    "$.schemaVersion",
    "UNSUPPORTED_SCHEMA_VERSION",
  );
  assertContractFailure(
    event({ reason: "PLAYER_PROFILE_CHANGED" }),
    "$.reason",
    "UNKNOWN_REASON",
  );
  assert.equal(isRoomLobbyChangeReasonV1("PLAYER_PROFILE_CHANGED"), false);
  assertContractFailure([], "$", "OBJECT_REQUIRED");
  assertContractFailure(null, "$", "OBJECT_REQUIRED");
  assertContractFailure(Object.assign(new Date(), BASE_EVENT), "$", "OBJECT_REQUIRED");
});

test("converts unreadable objects and fields into the safe contract error", () => {
  const unreadableObject = new Proxy({}, {
    getPrototypeOf() { throw new Error("private proxy failure"); },
  });
  assertContractFailure(unreadableObject, "$", "UNREADABLE_OBJECT");

  const unreadableField = event();
  Object.defineProperty(unreadableField, "roomId", {
    enumerable: true,
    get() { throw new Error("private getter failure"); },
  });
  assertContractFailure(unreadableField, "$.roomId", "UNREADABLE_FIELD");
});

test("rejects unsafe, too short, and overlong identifiers", () => {
  assertContractFailure(event({ eventId: "short" }), "$.eventId", "TOO_SHORT");
  assertContractFailure(
    event({ eventId: `e${"x".repeat(ROOM_LOBBY_CHANGE_MAX_EVENT_ID_LENGTH_V1)}` }),
    "$.eventId",
    "TOO_LONG",
  );
  assertContractFailure(event({ roomId: " room_1" }), "$.roomId", "INVALID_IDENTIFIER");
  assertContractFailure(
    event({ roomId: "room/1?token=secret" }),
    "$.roomId",
    "INVALID_IDENTIFIER",
  );
  assertContractFailure(
    event({ roomId: `r${"x".repeat(ROOM_LOBBY_CHANGE_MAX_ROOM_ID_LENGTH_V1)}` }),
    "$.roomId",
    "TOO_LONG",
  );
  assertContractFailure(
    event({ roomId: "room_ok\r\nupgrade:websocket" }),
    "$.roomId",
    "INVALID_IDENTIFIER",
  );
  assertContractFailure(event({ roomId: "房间一" }), "$.roomId", "INVALID_IDENTIFIER");
});

test("rejects malformed and non-canonical timestamps", () => {
  assertContractFailure(
    event({ occurredAt: "not-a-date" }),
    "$.occurredAt",
    "UTC_ISO_MILLISECONDS_REQUIRED",
  );
  assertContractFailure(
    event({ occurredAt: "2026-08-15T09:00:00.000+09:00" }),
    "$.occurredAt",
    "UTC_ISO_MILLISECONDS_REQUIRED",
  );
  assertContractFailure(
    event({ occurredAt: "2026-08-15T00:00:00Z" }),
    "$.occurredAt",
    "UTC_ISO_MILLISECONDS_REQUIRED",
  );
  assertContractFailure(
    event({ occurredAt: "2026-02-30T00:00:00.000Z" }),
    "$.occurredAt",
    "INVALID_TIMESTAMP",
  );
  assertContractFailure(
    event({ occurredAt: 1_786_752_000_000 }),
    "$.occurredAt",
    "STRING_REQUIRED",
  );
});

test("normalization returns a detached immutable event and the type guard fails closed", () => {
  const source = event();
  const parsed = assertRoomLobbyChangeEventV1(source);
  source.reason = "ROLE_CHANGED";

  assert.equal(parsed.reason, "READY_CHANGED");
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(isRoomLobbyChangeEventV1(parsed), true);
  assert.equal(isRoomLobbyChangeEventV1(event({ token: "secret" })), false);
  assert.equal(isRoomLobbyChangeEventV1(event({ roomId: "../other-room" })), false);
});

function assertContractFailure(
  value: unknown,
  path: string,
  reason: string,
): void {
  assert.throws(
    () => assertRoomLobbyChangeEventV1(value),
    (error: unknown) => {
      assert.equal(error instanceof RoomLobbyChangeContractError, true);
      const contractError = error as RoomLobbyChangeContractError;
      assert.equal(contractError.code, ROOM_LOBBY_CHANGE_CONTRACT_ERROR_CODE_V1);
      assert.equal(contractError.path, path);
      assert.equal(contractError.reason, reason);
      assert.equal(
        contractError.message,
        `${ROOM_LOBBY_CHANGE_CONTRACT_ERROR_CODE_V1}:${path}:${reason}`,
      );
      assert.doesNotMatch(
        contractError.message,
        /secret|token-value|private@example|proxy failure|getter failure/i,
      );
      return true;
    },
  );
}
