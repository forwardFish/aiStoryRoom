import "reflect-metadata";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import test from "node:test";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { AuthenticatedUserResolver } from "../auth/authenticated-user-resolver";
import { AUTH_SESSION_COOKIE } from "../auth/auth-cookie";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import type { RoomsService } from "../rooms.service";
import {
  RoomLobbyChangeContractError,
  createRoomLobbyChangeEventV1,
} from "./room-lobby-change.contract";
import {
  ROOM_LOBBY_SOCKET_SCHEMA_VERSION_V1,
  RoomLobbyWebSocketGateway,
  type RoomLobbyUpgradeServerV1,
  type RoomLobbyWebSocketOptionsV1,
} from "./room-lobby-websocket.gateway";

const SOCKET_PATH = "/api/v4/room-lobby/socket";
const ALLOWED_ORIGIN = "http://localhost:5177";
const SESSION_TOKEN = "module-b-cookie-session-token";
const ROOM_ID = "room_module_b_gateway";
const USER: AuthenticatedUser = Object.freeze({
  id: "user-module-b-gateway",
  openid: "openid-module-b-gateway",
  email: "module-b@example.test",
  emailVerifiedAt: new Date("2026-08-15T00:00:00.000Z"),
  nickname: "Module B",
  authMethod: "PASSWORD",
  authIdentityId: null,
});

test("authenticates only with the HttpOnly Cookie and rejects query tokens and unknown Origins", async () => {
  const state = harness();
  try {
    const accepted = await state.upgrade();
    assert.match(accepted.http(), /^HTTP\/1\.1 101 /);
    assert.deepEqual(state.tokens, [SESSION_TOKEN]);
    assert.equal(accepted.http().includes(SESSION_TOKEN), false);

    const missingCookie = await state.upgrade({
      cookie: null,
      ip: "127.0.0.2",
    });
    assert.match(missingCookie.http(), /^HTTP\/1\.1 401 /);
    assert.deepEqual(state.tokens, [SESSION_TOKEN, ""]);

    const queryToken = await state.upgrade({
      url: `${SOCKET_PATH}?token=${encodeURIComponent(SESSION_TOKEN)}`,
      ip: "127.0.0.3",
    });
    assert.match(queryToken.http(), /^HTTP\/1\.1 400 /);
    assert.deepEqual(state.tokens, [SESSION_TOKEN, ""]);

    const nullOrigin = await state.upgrade({
      origin: "null",
      ip: "127.0.0.4",
    });
    assert.match(nullOrigin.http(), /^HTTP\/1\.1 403 /);

    const unknownOrigin = await state.upgrade({
      origin: "https://unknown.example.test",
      host: "unknown.example.test",
      ip: "127.0.0.5",
    });
    assert.match(unknownOrigin.http(), /^HTTP\/1\.1 403 /);

    const mismatchedHost = await state.upgrade({
      host: "127.0.0.1:3102",
      ip: "127.0.0.6",
    });
    assert.match(mismatchedHost.http(), /^HTTP\/1\.1 403 /);
    assert.deepEqual(state.tokens, [SESSION_TOKEN, ""]);
  } finally {
    state.stop();
  }
});

test("uses RoomsService.get as the subscription authority and closes denied subscribers without disclosure", async () => {
  const state = harness({ denyRoomAccess: true });
  try {
    const socket = await state.upgrade();
    await sendCommand(socket, subscribeCommand());
    await waitFor(() => socket.closes().length > 0);

    assert.deepEqual(
      state.roomReads.map((entry) => [
        entry.user.id,
        entry.roomId,
      ]),
      [[USER.id, ROOM_ID]],
    );
    assert.deepEqual(socket.textMessages(), [{
      type: "room.access_revoked",
      schemaVersion: ROOM_LOBBY_SOCKET_SCHEMA_VERSION_V1,
      roomId: ROOM_ID,
    }]);
    assert.equal(socket.closes().at(-1)?.code, 1008);
    assert.equal(socket.http().includes("ROOM_ACCESS_DENIED"), false);
    assert.deepEqual(state.gateway.diagnostics(), {
      enabled: true,
      path: SOCKET_PATH,
      connections: 0,
      subscriptions: 0,
    });
  } finally {
    state.stop();
  }
});

test("treats repeated subscriptions as idempotent while rechecking room access", async () => {
  const state = harness();
  try {
    const socket = await state.upgrade();
    await sendCommand(socket, subscribeCommand());
    await sendCommand(socket, subscribeCommand());
    await waitFor(() => socket.textMessages().length === 2);

    assert.equal(state.roomReads.length, 2);
    assert.deepEqual(socket.textMessages(), [
      {
        type: "room.subscribed",
        schemaVersion: ROOM_LOBBY_SOCKET_SCHEMA_VERSION_V1,
        roomId: ROOM_ID,
      },
      {
        type: "room.subscribed",
        schemaVersion: ROOM_LOBBY_SOCKET_SCHEMA_VERSION_V1,
        roomId: ROOM_ID,
      },
    ]);
    assert.deepEqual(state.gateway.diagnostics(), {
      enabled: true,
      path: SOCKET_PATH,
      connections: 1,
      subscriptions: 1,
    });
  } finally {
    state.stop();
  }
});

test("rejects business writes, unknown fields, overlong room ids, and oversized messages", async () => {
  const invalidCommands: Array<Record<string, unknown>> = [
    {
      type: "room.ready",
      schemaVersion: ROOM_LOBBY_SOCKET_SCHEMA_VERSION_V1,
      roomId: ROOM_ID,
      ready: true,
    },
    {
      ...subscribeCommand(),
      userId: USER.id,
    },
    {
      ...subscribeCommand(),
      roomId: `room_${"x".repeat(161)}`,
    },
  ];

  for (const [index, invalidCommand] of invalidCommands.entries()) {
    const state = harness();
    try {
      const socket = await state.upgrade({
        ip: `127.0.1.${index + 1}`,
      });
      await sendCommand(socket, invalidCommand);
      await waitFor(() => socket.closes().length > 0);

      assert.equal(socket.closes().at(-1)?.code, 1008);
      assert.deepEqual(state.roomReads, []);
      assert.deepEqual(state.gateway.diagnostics(), {
        enabled: true,
        path: SOCKET_PATH,
        connections: 0,
        subscriptions: 0,
      });
    } finally {
      state.stop();
    }
  }

  const oversized = harness();
  try {
    const socket = await oversized.upgrade({
      ip: "127.0.2.1",
    });
    socket.emit(
      "data",
      clientFrame("x".repeat(2_049)),
    );
    await waitFor(() => socket.closes().length > 0);

    assert.equal(socket.closes().at(-1)?.code, 1009);
    assert.deepEqual(oversized.roomReads, []);
  } finally {
    oversized.stop();
  }
});

test("disconnects a connection that does not answer the server heartbeat and releases its subscription", async () => {
  const state = harness({
    gatewayOptions: {
      pingIntervalMs: 5_000,
      pongTimeoutMs: 1_000,
    },
  });
  try {
    const socket = await state.upgrade();
    await sendCommand(socket, subscribeCommand());
    await waitFor(
      () => state.gateway.diagnostics().subscriptions === 1,
    );

    const pingAt = Date.now() + 5_001;
    state.gateway.sweepHeartbeat(pingAt);
    assert.equal(socket.opcodes().includes(0x09), true);

    state.gateway.sweepHeartbeat(pingAt + 1_001);
    assert.equal(socket.destroyed, true);
    assert.deepEqual(state.gateway.diagnostics(), {
      enabled: true,
      path: SOCKET_PATH,
      connections: 0,
      subscriptions: 0,
    });
    assert.equal(
      state.gateway.forwardInvalidation(invalidation()),
      0,
    );
  } finally {
    state.stop();
  }
});

test("cleans the subscription map when the transport closes", async () => {
  const state = harness();
  try {
    const socket = await state.upgrade();
    await sendCommand(socket, subscribeCommand());
    await waitFor(
      () => state.gateway.diagnostics().subscriptions === 1,
    );

    socket.destroy();
    await waitFor(
      () => state.gateway.diagnostics().connections === 0,
    );

    assert.deepEqual(state.gateway.diagnostics(), {
      enabled: true,
      path: SOCKET_PATH,
      connections: 0,
      subscriptions: 0,
    });
  } finally {
    state.stop();
  }
});

test("forwards only the exact Module A minimal invalidation event to local room subscribers", async () => {
  const state = harness();
  try {
    const socket = await state.upgrade();
    await sendCommand(socket, subscribeCommand());
    await waitFor(
      () => state.gateway.diagnostics().subscriptions === 1,
    );

    const event = invalidation();
    const before = socket.textMessages().length;
    assert.equal(state.gateway.forwardInvalidation(event), 1);

    const delivered = socket.textMessages().slice(before);
    assert.deepEqual(delivered, [event]);
    assert.deepEqual(Object.keys(delivered[0]!), [
      "type",
      "schemaVersion",
      "eventId",
      "roomId",
      "reason",
      "occurredAt",
    ]);
    const outward = JSON.stringify(delivered);
    assert.equal(outward.includes(SESSION_TOKEN), false);
    assert.equal(outward.includes(USER.email!), false);
    assert.equal(outward.includes("readyHumanCount"), false);
    assert.equal(outward.includes("startEnabled"), false);

    const otherRoom = createRoomLobbyChangeEventV1({
      eventId: "evt_00000000-0000-4000-8000-000000000202",
      roomId: "room_other_module_b",
      reason: "ROLE_CHANGED",
      occurredAt: "2026-08-15T00:00:02.000Z",
    });
    assert.equal(state.gateway.forwardInvalidation(otherRoom), 0);
    assert.equal(socket.textMessages().length, before + 1);

    assert.throws(
      () => state.gateway.forwardInvalidation({
        ...event,
        userId: USER.id,
      }),
      RoomLobbyChangeContractError,
    );
    assert.equal(socket.textMessages().length, before + 1);
  } finally {
    state.stop();
  }
});

type HarnessOptions = {
  denyRoomAccess?: boolean;
  gatewayOptions?: Partial<RoomLobbyWebSocketOptionsV1>;
};

type UpgradeInput = {
  url?: string;
  origin?: string;
  host?: string;
  cookie?: string | null;
  ip?: string;
};

function harness(options: HarnessOptions = {}) {
  const tokens: string[] = [];
  const roomReads: Array<{
    user: AuthenticatedUser;
    roomId: string;
  }> = [];

  const authenticatedUsers = {
    async resolveAccessToken(
      token: string | null | undefined,
    ) {
      const normalized = String(token ?? "");
      tokens.push(normalized);
      if (normalized !== SESSION_TOKEN) {
        throw new UnauthorizedException({ code: "INVALID_TOKEN" });
      }
      return {
        user: structuredClone(USER),
        claims: {
          sub: USER.id,
          openid: USER.openid,
          authMethod: "PASSWORD" as const,
        },
      };
    },
  } as unknown as AuthenticatedUserResolver;

  const rooms = {
    async get(user: AuthenticatedUser, roomId: string) {
      roomReads.push({
        user: structuredClone(user),
        roomId,
      });
      if (options.denyRoomAccess) {
        throw new ForbiddenException({ code: "ROOM_ACCESS_DENIED" });
      }
      return { id: roomId };
    },
  } as unknown as RoomsService;

  const gatewayOptions: Partial<RoomLobbyWebSocketOptionsV1> = {
    enabled: true,
    path: SOCKET_PATH,
    allowedOrigins: [ALLOWED_ORIGIN],
    maxConnections: 20,
    maxConnectionsPerUser: 10,
    maxConnectionsPerIp: 10,
    maxMessageBytes: 2_048,
    maxMessagesPerWindow: 20,
    messageWindowMs: 1_000,
    maxHandshakesPerWindow: 30,
    handshakeWindowMs: 1_000,
    pingIntervalMs: 60_000,
    pongTimeoutMs: 30_000,
    ...options.gatewayOptions,
  };
  const gateway = new RoomLobbyWebSocketGateway(
    authenticatedUsers,
    rooms,
    gatewayOptions,
  );
  const server = new FakeUpgradeServer();
  gateway.attachToHttpServer(server);

  return {
    gateway,
    tokens,
    roomReads,
    async upgrade(input: UpgradeInput = {}) {
      const socket = new FakeSocket(input.ip);
      server.emit(
        "upgrade",
        upgradeRequest(input),
        socket as unknown as Socket,
        Buffer.alloc(0),
      );
      await waitFor(() => socket.writes.length > 0);
      return socket;
    },
    stop() {
      gateway.onModuleDestroy();
    },
  };
}

function subscribeCommand(): Record<string, unknown> {
  return {
    type: "room.subscribe",
    schemaVersion: ROOM_LOBBY_SOCKET_SCHEMA_VERSION_V1,
    roomId: ROOM_ID,
  };
}

function invalidation() {
  return createRoomLobbyChangeEventV1({
    eventId: "evt_00000000-0000-4000-8000-000000000201",
    roomId: ROOM_ID,
    reason: "READY_CHANGED",
    occurredAt: "2026-08-15T00:00:01.000Z",
  });
}

function upgradeRequest(input: UpgradeInput): IncomingMessage {
  const headers: Record<string, string> = {
    host: input.host ?? "localhost:5177",
    connection: "Upgrade",
    upgrade: "websocket",
    origin: input.origin ?? ALLOWED_ORIGIN,
    "sec-websocket-version": "13",
    "sec-websocket-key": Buffer
      .alloc(16, 7)
      .toString("base64"),
  };
  if (input.cookie !== null) {
    headers.cookie = input.cookie
      ?? `${AUTH_SESSION_COOKIE}=${encodeURIComponent(SESSION_TOKEN)}`;
  }

  return {
    method: "GET",
    url: input.url ?? SOCKET_PATH,
    headers,
  } as unknown as IncomingMessage;
}

class FakeUpgradeServer extends EventEmitter
implements RoomLobbyUpgradeServerV1 {}

class FakeSocket extends EventEmitter {
  readonly writes: Buffer[] = [];
  readonly remoteAddress: string;
  destroyed = false;
  writable = true;
  writableLength = 0;

  constructor(ip = "127.0.0.1") {
    super();
    this.remoteAddress = ip;
  }

  write(value: string | Uint8Array): boolean {
    this.writes.push(Buffer.from(value));
    return true;
  }

  end(value?: string | Uint8Array): this {
    if (value !== undefined) {
      this.writes.push(Buffer.from(value));
    }
    this.writable = false;
    return this;
  }

  destroy(): this {
    if (!this.destroyed) {
      this.destroyed = true;
      this.writable = false;
      this.emit("close");
    }
    return this;
  }

  setNoDelay(): this {
    return this;
  }

  setTimeout(): this {
    return this;
  }

  resume(): this {
    return this;
  }

  http(): string {
    return this.writes
      .filter(isHttpResponse)
      .map((value) => value.toString("utf8"))
      .join("");
  }

  textMessages(): Array<Record<string, unknown>> {
    return this.frames()
      .filter((frame) => frame.opcode === 0x01)
      .map((frame) => JSON.parse(
        frame.payload.toString("utf8"),
      ) as Record<string, unknown>);
  }

  closes(): Array<{ code: number; reason: string }> {
    return this.frames()
      .filter((frame) => frame.opcode === 0x08)
      .map((frame) => ({
        code: frame.payload.length >= 2
          ? frame.payload.readUInt16BE(0)
          : 1005,
        reason: frame.payload
          .subarray(2)
          .toString("utf8"),
      }));
  }

  opcodes(): number[] {
    return this.frames().map((frame) => frame.opcode);
  }

  private frames(): Array<{
    opcode: number;
    payload: Buffer;
  }> {
    return this.writes
      .filter((value) => !isHttpResponse(value))
      .map(decodeServerFrame);
  }
}

function isHttpResponse(value: Buffer): boolean {
  return value
    .subarray(0, 5)
    .toString("ascii") === "HTTP/";
}

function decodeServerFrame(value: Buffer): {
  opcode: number;
  payload: Buffer;
} {
  assert.equal(value.length >= 2, true);
  const opcode = value[0]! & 0x0f;
  const marker = value[1]! & 0x7f;
  let length = marker;
  let offset = 2;
  if (marker === 126) {
    assert.equal(value.length >= 4, true);
    length = value.readUInt16BE(2);
    offset = 4;
  }
  assert.equal(value.length, offset + length);
  return {
    opcode,
    payload: value.subarray(offset),
  };
}

function clientFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  assert.equal(payload.length <= 0xffff, true);
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const header = payload.length < 126
    ? Buffer.from([0x81, 0x80 | payload.length])
    : Buffer.from([
        0x81,
        0xfe,
        (payload.length >>> 8) & 0xff,
        payload.length & 0xff,
      ]);
  const body = Buffer.allocUnsafe(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    body[index] = payload[index]! ^ mask[index % 4]!;
  }
  return Buffer.concat([header, mask, body]);
}

async function sendCommand(
  socket: FakeSocket,
  value: Record<string, unknown>,
): Promise<void> {
  socket.emit("data", clientFrame(JSON.stringify(value)));
  await settle();
}

async function waitFor(
  predicate: () => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await settle();
  }
  assert.fail("room lobby gateway test timed out");
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
