import {
  Inject,
  Injectable,
  OnModuleDestroy,
  Optional,
} from "@nestjs/common";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { TextDecoder } from "node:util";
import { AuthenticatedUserResolver } from "../auth/authenticated-user-resolver";
import { sessionTokenFromRequest } from "../auth/auth-cookie";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { RoomsService } from "../rooms.service";
import {
  ROOM_LOBBY_CHANGE_MAX_ROOM_ID_LENGTH_V1,
  assertRoomLobbyChangeEventV1,
  type RoomLobbyChangeEventV1,
} from "./room-lobby-change.contract";

export const ROOM_LOBBY_SOCKET_OPTIONS_V1 = Symbol(
  "ROOM_LOBBY_SOCKET_OPTIONS_V1",
);
export const ROOM_LOBBY_SOCKET_SCHEMA_VERSION_V1 =
  "room_lobby_socket_v1" as const;
export const ROOM_LOBBY_SOCKET_DEFAULT_PATH_V1 =
  "/api/v4/room-lobby/socket" as const;

export interface RoomLobbyWebSocketOptionsV1 {
  readonly enabled: boolean;
  readonly path: string;
  readonly allowedOrigins: readonly string[];
  readonly maxConnections: number;
  readonly maxConnectionsPerUser: number;
  readonly maxConnectionsPerIp: number;
  readonly maxMessageBytes: number;
  readonly maxMessagesPerWindow: number;
  readonly messageWindowMs: number;
  readonly maxHandshakesPerWindow: number;
  readonly handshakeWindowMs: number;
  readonly pingIntervalMs: number;
  readonly pongTimeoutMs: number;
}

export interface RoomLobbyUpgradeServerV1 {
  on(
    event: "upgrade",
    listener: (
      request: IncomingMessage,
      socket: Socket,
      head: Buffer,
    ) => void,
  ): unknown;
  off?(
    event: "upgrade",
    listener: (
      request: IncomingMessage,
      socket: Socket,
      head: Buffer,
    ) => void,
  ): unknown;
  removeListener?(
    event: "upgrade",
    listener: (
      request: IncomingMessage,
      socket: Socket,
      head: Buffer,
    ) => void,
  ): unknown;
}

interface ConnectionV1 {
  readonly id: string;
  readonly socket: Socket;
  readonly user: AuthenticatedUser;
  readonly ip: string;
  roomId: string | null;
  readBuffer: Buffer;
  closed: boolean;
  messageWindowStartedAt: number;
  messageCount: number;
  awaitingPong: boolean;
  lastPingAt: number;
  tail: Promise<void>;
}

interface RateBucketV1 {
  startedAt: number;
  lastSeenAt: number;
  count: number;
}

type ClientCommandV1 = Readonly<{
  type: "room.subscribe" | "room.unsubscribe";
  schemaVersion: typeof ROOM_LOBBY_SOCKET_SCHEMA_VERSION_V1;
  roomId: string;
}>;

type SocketControlEventV1 =
  | Readonly<{
      type: "room.subscribed" | "room.unsubscribed" | "room.access_revoked";
      schemaVersion: typeof ROOM_LOBBY_SOCKET_SCHEMA_VERSION_V1;
      roomId: string;
    }>;

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const CLIENT_COMMAND_KEYS = new Set([
  "type",
  "schemaVersion",
  "roomId",
]);
const SAFE_ROOM_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const MAX_HANDSHAKE_BUCKETS = 4_096;
const MAX_WRITE_BUFFER_BYTES = 64 * 1_024;
const DEVELOPMENT_ORIGINS = Object.freeze([
  "http://localhost:5177",
  "http://127.0.0.1:5177",
  "http://localhost:3102",
  "http://127.0.0.1:3102",
]);

@Injectable()
export class RoomLobbyWebSocketGateway implements OnModuleDestroy {
  private readonly options: Readonly<RoomLobbyWebSocketOptionsV1>;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly connections = new Map<string, ConnectionV1>();
  private readonly subscriptions = new Map<string, Set<string>>();
  private readonly connectionCountByUser = new Map<string, number>();
  private readonly connectionCountByIp = new Map<string, number>();
  private readonly handshakeBuckets = new Map<string, RateBucketV1>();
  private server: RoomLobbyUpgradeServerV1 | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  private readonly upgradeListener = (
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ): void => {
    void this.acceptUpgrade(request, socket, head).catch(() => {
      this.rejectUpgrade(socket, 500);
    });
  };

  constructor(
    @Inject(AuthenticatedUserResolver)
    private readonly authenticatedUsers: AuthenticatedUserResolver,
    @Inject(RoomsService)
    private readonly rooms: RoomsService,
    @Optional()
    @Inject(ROOM_LOBBY_SOCKET_OPTIONS_V1)
    options?: Partial<RoomLobbyWebSocketOptionsV1>,
  ) {
    this.options = resolveRoomLobbyWebSocketOptionsV1(options, process.env);
    this.allowedOrigins = new Set(this.options.allowedOrigins);
  }

  attachToHttpServer(server: RoomLobbyUpgradeServerV1): void {
    if (!this.options.enabled) return;
    if (this.server === server) return;
    if (this.server) {
      throw new Error("ROOM_LOBBY_SOCKET_ALREADY_ATTACHED");
    }

    this.server = server;
    server.on("upgrade", this.upgradeListener);
    this.heartbeatTimer = setInterval(
      () => this.sweepHeartbeat(),
      Math.min(
        this.options.pingIntervalMs,
        this.options.pongTimeoutMs,
      ),
    );
    this.heartbeatTimer.unref?.();
  }

  forwardInvalidation(value: unknown): number {
    const event = assertRoomLobbyChangeEventV1(value);
    const connectionIds = this.subscriptions.get(event.roomId);
    if (!connectionIds) return 0;

    let sent = 0;
    for (const connectionId of [...connectionIds]) {
      const connection = this.connections.get(connectionId);
      if (
        !connection
        || connection.closed
        || connection.roomId !== event.roomId
      ) {
        connectionIds.delete(connectionId);
        continue;
      }
      if (this.sendJson(connection, event)) sent += 1;
    }

    if (connectionIds.size === 0) {
      this.subscriptions.delete(event.roomId);
    }
    return sent;
  }

  sweepHeartbeat(now = Date.now()): void {
    for (const connection of [...this.connections.values()]) {
      if (connection.closed) continue;
      if (
        connection.awaitingPong
        && now - connection.lastPingAt >= this.options.pongTimeoutMs
      ) {
        this.terminate(connection);
        continue;
      }
      if (
        !connection.awaitingPong
        && now - connection.lastPingAt >= this.options.pingIntervalMs
      ) {
        connection.awaitingPong = true;
        connection.lastPingAt = now;
        if (!this.sendFrame(connection, 0x09, Buffer.alloc(0))) {
          this.terminate(connection);
        }
      }
    }
    this.pruneHandshakeBuckets(now);
  }

  diagnostics(): Readonly<{
    enabled: boolean;
    path: string;
    connections: number;
    subscriptions: number;
  }> {
    let subscriptions = 0;
    for (const connectionIds of this.subscriptions.values()) {
      subscriptions += connectionIds.size;
    }
    return Object.freeze({
      enabled: this.options.enabled,
      path: this.options.path,
      connections: this.connections.size,
      subscriptions,
    });
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;

    if (this.server) {
      if (this.server.off) {
        this.server.off("upgrade", this.upgradeListener);
      } else {
        this.server.removeListener?.("upgrade", this.upgradeListener);
      }
    }
    this.server = null;

    for (const connection of [...this.connections.values()]) {
      this.close(connection, 1001, "server shutdown");
    }
    this.connections.clear();
    this.subscriptions.clear();
    this.connectionCountByUser.clear();
    this.connectionCountByIp.clear();
    this.handshakeBuckets.clear();
  }

  private async acceptUpgrade(
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ): Promise<void> {
    const url = parseRequestUrl(request.url);
    if (!url || url.pathname !== this.options.path) {
      this.rejectUpgrade(socket, 404);
      return;
    }
    if (!this.options.enabled) {
      this.rejectUpgrade(socket, 404);
      return;
    }
    if (url.search || url.hash) {
      this.rejectUpgrade(socket, 400);
      return;
    }
    if (
      request.method !== "GET"
      || !headerTokens(request, "connection").includes("upgrade")
      || header(request, "upgrade").toLowerCase() !== "websocket"
      || header(request, "sec-websocket-version") !== "13"
      || header(request, "sec-websocket-protocol")
      || header(request, "authorization")
    ) {
      this.rejectUpgrade(socket, 400);
      return;
    }

    const host = header(request, "host");
    let origin: string;
    try {
      origin = normalizeAllowedOrigin(header(request, "origin"));
    } catch {
      this.rejectUpgrade(socket, 403);
      return;
    }
    if (
      !host
      || new URL(origin).host.toLowerCase() !== host.toLowerCase()
      || !this.allowedOrigins.has(origin)
    ) {
      this.rejectUpgrade(socket, 403);
      return;
    }

    const websocketKey = header(request, "sec-websocket-key");
    if (!isValidWebSocketKey(websocketKey)) {
      this.rejectUpgrade(socket, 400);
      return;
    }

    const ip = normalizeIp(socket.remoteAddress);
    if (!this.consumeHandshake(ip)) {
      this.rejectUpgrade(socket, 429);
      return;
    }

    let user: AuthenticatedUser;
    try {
      const token = sessionTokenFromRequest(request);
      user = (
        await this.authenticatedUsers.resolveAccessToken(token)
      ).user;
    } catch (error) {
      this.rejectUpgrade(
        socket,
        exceptionStatus(error) === 401 ? 401 : 500,
      );
      return;
    }

    if (!this.hasConnectionCapacity(user.id, ip)) {
      this.rejectUpgrade(socket, 429);
      return;
    }
    if (socket.destroyed) return;

    const accept = createHash("sha1")
      .update(`${websocketKey}${WEBSOCKET_GUID}`)
      .digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "Cache-Control: no-store",
      "",
      "",
    ].join("\r\n"));
    socket.setNoDelay(true);
    socket.setTimeout(0);

    const connection: ConnectionV1 = {
      id: `room-lobby-${randomUUID()}`,
      socket,
      user,
      ip,
      roomId: null,
      readBuffer: Buffer.alloc(0),
      closed: false,
      messageWindowStartedAt: Date.now(),
      messageCount: 0,
      awaitingPong: false,
      lastPingAt: Date.now(),
      tail: Promise.resolve(),
    };
    this.connections.set(connection.id, connection);
    increment(this.connectionCountByUser, user.id);
    increment(this.connectionCountByIp, ip);

    socket.on("data", (chunk: Buffer | Uint8Array) => {
      this.receive(connection, Buffer.from(chunk));
    });
    socket.once("error", () => this.terminate(connection));
    socket.once("end", () => this.terminate(connection));
    socket.once("close", () => this.terminate(connection));
    socket.resume();

    if (head.length) this.receive(connection, head);
  }

  private receive(connection: ConnectionV1, chunk: Buffer): void {
    if (connection.closed || chunk.length === 0) return;
    const combinedLength = connection.readBuffer.length + chunk.length;
    if (
      combinedLength
      > this.options.maxMessageBytes * 4 + 64
    ) {
      this.close(connection, 1009, "message too large");
      return;
    }
    connection.readBuffer = connection.readBuffer.length
      ? Buffer.concat([connection.readBuffer, chunk], combinedLength)
      : chunk;

    try {
      while (this.readFrame(connection)) {
        if (connection.closed) return;
      }
    } catch {
      this.close(connection, 1002, "protocol error");
    }
  }

  private readFrame(connection: ConnectionV1): boolean {
    const buffer = connection.readBuffer;
    if (buffer.length < 2) return false;

    const first = buffer[0]!;
    const second = buffer[1]!;
    const finalFrame = (first & 0x80) !== 0;
    const reservedBits = first & 0x70;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    const lengthMarker = second & 0x7f;

    if (!finalFrame || reservedBits !== 0 || !masked) {
      throw new Error("ROOM_LOBBY_SOCKET_FRAME_INVALID");
    }
    if (![0x01, 0x08, 0x09, 0x0a].includes(opcode)) {
      throw new Error("ROOM_LOBBY_SOCKET_OPCODE_INVALID");
    }

    let payloadLength = lengthMarker;
    let offset = 2;
    if (lengthMarker === 126) {
      if (buffer.length < 4) return false;
      payloadLength = buffer.readUInt16BE(2);
      offset = 4;
      if (payloadLength <= 125) {
        throw new Error("ROOM_LOBBY_SOCKET_LENGTH_NON_CANONICAL");
      }
    } else if (lengthMarker === 127) {
      throw new Error("ROOM_LOBBY_SOCKET_FRAME_TOO_LARGE");
    }

    if (opcode >= 0x08 && payloadLength > 125) {
      throw new Error("ROOM_LOBBY_SOCKET_CONTROL_FRAME_TOO_LARGE");
    }
    if (payloadLength > this.options.maxMessageBytes) {
      this.close(connection, 1009, "message too large");
      return false;
    }

    const required = offset + 4 + payloadLength;
    if (buffer.length < required) return false;
    const mask = buffer.subarray(offset, offset + 4);
    const payload = Buffer.from(
      buffer.subarray(offset + 4, required),
    );
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] = payload[index]! ^ mask[index % 4]!;
    }
    connection.readBuffer = buffer.subarray(required);

    if (opcode === 0x08) {
      if (payload.length === 1) {
        throw new Error("ROOM_LOBBY_SOCKET_CLOSE_FRAME_INVALID");
      }
      this.close(connection, 1000, "closed");
    } else if (opcode === 0x09) {
      this.sendFrame(connection, 0x0a, payload);
    } else if (opcode === 0x0a) {
      connection.awaitingPong = false;
      connection.lastPingAt = Date.now();
    } else {
      this.receiveText(connection, payload);
    }
    return true;
  }

  private receiveText(
    connection: ConnectionV1,
    payload: Buffer,
  ): void {
    if (!this.consumeMessage(connection)) {
      this.close(connection, 1008, "rate limit");
      return;
    }

    let command: ClientCommandV1;
    try {
      command = assertClientCommand(
        JSON.parse(UTF8.decode(payload)),
      );
    } catch {
      this.close(connection, 1008, "invalid command");
      return;
    }

    connection.tail = connection.tail
      .then(() => this.applyCommand(connection, command))
      .catch(() => {
        if (!connection.closed) {
          this.close(connection, 1011, "command failed");
        }
      });
  }

  private async applyCommand(
    connection: ConnectionV1,
    command: ClientCommandV1,
  ): Promise<void> {
    if (connection.closed) return;

    if (command.type === "room.unsubscribe") {
      if (connection.roomId === command.roomId) {
        this.unsubscribe(connection);
      }
      this.sendJson(connection, {
        type: "room.unsubscribed",
        schemaVersion: ROOM_LOBBY_SOCKET_SCHEMA_VERSION_V1,
        roomId: command.roomId,
      });
      return;
    }

    try {
      await this.rooms.get(connection.user, command.roomId);
    } catch (error) {
      const status = exceptionStatus(error);
      if (status === 403 || status === 404) {
        this.sendJson(connection, {
          type: "room.access_revoked",
          schemaVersion: ROOM_LOBBY_SOCKET_SCHEMA_VERSION_V1,
          roomId: command.roomId,
        });
        this.close(connection, 1008, "room access denied");
      } else {
        this.close(connection, 1011, "room authorization failed");
      }
      return;
    }

    if (connection.closed) return;
    if (
      connection.roomId
      && connection.roomId !== command.roomId
    ) {
      this.unsubscribe(connection);
    }

    connection.roomId = command.roomId;
    const connectionIds = this.subscriptions.get(command.roomId)
      ?? new Set<string>();
    connectionIds.add(connection.id);
    this.subscriptions.set(command.roomId, connectionIds);

    this.sendJson(connection, {
      type: "room.subscribed",
      schemaVersion: ROOM_LOBBY_SOCKET_SCHEMA_VERSION_V1,
      roomId: command.roomId,
    });
  }

  private unsubscribe(connection: ConnectionV1): void {
    const roomId = connection.roomId;
    if (!roomId) return;

    const connectionIds = this.subscriptions.get(roomId);
    connectionIds?.delete(connection.id);
    if (connectionIds && connectionIds.size === 0) {
      this.subscriptions.delete(roomId);
    }
    connection.roomId = null;
  }

  private sendJson(
    connection: ConnectionV1,
    value: RoomLobbyChangeEventV1 | SocketControlEventV1,
  ): boolean {
    return this.sendFrame(
      connection,
      0x01,
      Buffer.from(JSON.stringify(value), "utf8"),
    );
  }

  private sendFrame(
    connection: ConnectionV1,
    opcode: number,
    payload: Buffer,
  ): boolean {
    if (
      connection.closed
      || connection.socket.destroyed
      || !connection.socket.writable
    ) {
      return false;
    }
    if (payload.length > 0xffff) {
      this.terminate(connection);
      return false;
    }
    if (connection.socket.writableLength > MAX_WRITE_BUFFER_BYTES) {
      this.terminate(connection);
      return false;
    }

    const header = payload.length < 126
      ? Buffer.from([0x80 | opcode, payload.length])
      : Buffer.from([
          0x80 | opcode,
          126,
          (payload.length >>> 8) & 0xff,
          payload.length & 0xff,
        ]);
    try {
      connection.socket.write(
        payload.length
          ? Buffer.concat([header, payload])
          : header,
      );
      return true;
    } catch {
      this.terminate(connection);
      return false;
    }
  }

  private close(
    connection: ConnectionV1,
    code: number,
    reason: string,
  ): void {
    if (connection.closed) return;

    const reasonBytes = Buffer
      .from(reason, "utf8")
      .subarray(0, 123);
    const payload = Buffer.allocUnsafe(2 + reasonBytes.length);
    payload.writeUInt16BE(code, 0);
    reasonBytes.copy(payload, 2);
    this.sendFrame(connection, 0x08, payload);

    connection.closed = true;
    this.cleanup(connection);
    try {
      connection.socket.end();
    } catch {
      connection.socket.destroy();
      return;
    }
    const timer = setTimeout(() => {
      if (!connection.socket.destroyed) {
        connection.socket.destroy();
      }
    }, 1_000);
    timer.unref?.();
  }

  private terminate(connection: ConnectionV1): void {
    if (!connection.closed) {
      connection.closed = true;
      this.cleanup(connection);
    }
    if (!connection.socket.destroyed) {
      connection.socket.destroy();
    }
  }

  private cleanup(connection: ConnectionV1): void {
    this.unsubscribe(connection);
    if (this.connections.delete(connection.id)) {
      decrement(this.connectionCountByUser, connection.user.id);
      decrement(this.connectionCountByIp, connection.ip);
    }
    connection.readBuffer = Buffer.alloc(0);
  }

  private consumeMessage(connection: ConnectionV1): boolean {
    const now = Date.now();
    if (
      now - connection.messageWindowStartedAt
      >= this.options.messageWindowMs
    ) {
      connection.messageWindowStartedAt = now;
      connection.messageCount = 0;
    }
    connection.messageCount += 1;
    return connection.messageCount
      <= this.options.maxMessagesPerWindow;
  }

  private consumeHandshake(ip: string): boolean {
    const now = Date.now();
    this.pruneHandshakeBuckets(now);
    const previous = this.handshakeBuckets.get(ip);
    const bucket = !previous
      || now - previous.startedAt >= this.options.handshakeWindowMs
      ? { startedAt: now, lastSeenAt: now, count: 0 }
      : previous;
    bucket.count += 1;
    bucket.lastSeenAt = now;
    this.handshakeBuckets.set(ip, bucket);

    if (this.handshakeBuckets.size > MAX_HANDSHAKE_BUCKETS) {
      const excess = this.handshakeBuckets.size - MAX_HANDSHAKE_BUCKETS;
      const oldest = [...this.handshakeBuckets.entries()]
        .sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt)
        .slice(0, excess);
      for (const [key] of oldest) this.handshakeBuckets.delete(key);
    }

    return bucket.count <= this.options.maxHandshakesPerWindow;
  }

  private pruneHandshakeBuckets(now: number): void {
    for (const [ip, bucket] of this.handshakeBuckets) {
      if (
        now - bucket.lastSeenAt
        > this.options.handshakeWindowMs * 2
      ) {
        this.handshakeBuckets.delete(ip);
      }
    }
  }

  private hasConnectionCapacity(
    userId: string,
    ip: string,
  ): boolean {
    return this.connections.size < this.options.maxConnections
      && (this.connectionCountByUser.get(userId) ?? 0)
        < this.options.maxConnectionsPerUser
      && (this.connectionCountByIp.get(ip) ?? 0)
        < this.options.maxConnectionsPerIp;
  }

  private rejectUpgrade(socket: Socket, status: number): void {
    if (socket.destroyed) return;
    try {
      socket.end([
        `HTTP/1.1 ${status} ${httpReason(status)}`,
        "Connection: close",
        "Content-Length: 0",
        "Cache-Control: no-store",
        "",
        "",
      ].join("\r\n"));
      const timer = setTimeout(() => {
        if (!socket.destroyed) socket.destroy();
      }, 1_000);
      timer.unref?.();
    } catch {
      socket.destroy();
    }
  }
}

export function resolveRoomLobbyWebSocketOptionsV1(
  options: Partial<RoomLobbyWebSocketOptionsV1> | undefined,
  env: NodeJS.ProcessEnv,
): Readonly<RoomLobbyWebSocketOptionsV1> {
  const enabled = options?.enabled
    ?? booleanFlag(env.ROOM_LOBBY_SOCKET_ENABLED, false);
  const path = socketPath(
    options?.path
      ?? env.ROOM_LOBBY_SOCKET_PATH
      ?? ROOM_LOBBY_SOCKET_DEFAULT_PATH_V1,
  );

  const explicitOrigins = options?.allowedOrigins;
  const configuredOrigins = explicitOrigins
    ?? parseOrigins(
      env.ROOM_LOBBY_SOCKET_ALLOWED_ORIGINS
        ?? env.CORS_ALLOWED_ORIGINS,
    );
  const originValues = configuredOrigins.length
    ? configuredOrigins
    : explicitOrigins === undefined && env.NODE_ENV !== "production"
      ? DEVELOPMENT_ORIGINS
      : [];
  const allowedOrigins = Object.freeze([
    ...new Set(originValues.map(normalizeAllowedOrigin)),
  ]);
  if (enabled && allowedOrigins.length === 0) {
    throw new Error(
      "ROOM_LOBBY_SOCKET_ALLOWED_ORIGINS_REQUIRED",
    );
  }

  return Object.freeze({
    enabled,
    path,
    allowedOrigins,
    maxConnections: integer(
      options?.maxConnections,
      2_000,
      1,
      20_000,
    ),
    maxConnectionsPerUser: integer(
      options?.maxConnectionsPerUser,
      3,
      1,
      20,
    ),
    maxConnectionsPerIp: integer(
      options?.maxConnectionsPerIp,
      50,
      1,
      500,
    ),
    maxMessageBytes: integer(
      options?.maxMessageBytes,
      2_048,
      256,
      2_048,
    ),
    maxMessagesPerWindow: integer(
      options?.maxMessagesPerWindow,
      20,
      1,
      200,
    ),
    messageWindowMs: integer(
      options?.messageWindowMs,
      10_000,
      1_000,
      60_000,
    ),
    maxHandshakesPerWindow: integer(
      options?.maxHandshakesPerWindow,
      30,
      1,
      300,
    ),
    handshakeWindowMs: integer(
      options?.handshakeWindowMs,
      60_000,
      1_000,
      600_000,
    ),
    pingIntervalMs: integer(
      options?.pingIntervalMs,
      25_000,
      5_000,
      60_000,
    ),
    pongTimeoutMs: integer(
      options?.pongTimeoutMs,
      10_000,
      1_000,
      30_000,
    ),
  });
}

function assertClientCommand(value: unknown): ClientCommandV1 {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || (
      Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null
    )
  ) {
    throw new Error("ROOM_LOBBY_SOCKET_COMMAND_OBJECT_REQUIRED");
  }

  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== CLIENT_COMMAND_KEYS.size
    || keys.some(
      (key) => typeof key !== "string"
        || !CLIENT_COMMAND_KEYS.has(key),
    )
  ) {
    throw new Error("ROOM_LOBBY_SOCKET_COMMAND_FIELDS_INVALID");
  }

  const record = value as Record<string, unknown>;
  if (
    record.type !== "room.subscribe"
    && record.type !== "room.unsubscribe"
  ) {
    throw new Error("ROOM_LOBBY_SOCKET_COMMAND_TYPE_INVALID");
  }
  if (
    record.schemaVersion
    !== ROOM_LOBBY_SOCKET_SCHEMA_VERSION_V1
  ) {
    throw new Error("ROOM_LOBBY_SOCKET_COMMAND_VERSION_INVALID");
  }

  return Object.freeze({
    type: record.type,
    schemaVersion: ROOM_LOBBY_SOCKET_SCHEMA_VERSION_V1,
    roomId: requireRoomId(record.roomId),
  });
}

function requireRoomId(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > ROOM_LOBBY_CHANGE_MAX_ROOM_ID_LENGTH_V1
    || value !== value.trim()
    || !SAFE_ROOM_ID.test(value)
  ) {
    throw new Error("ROOM_LOBBY_SOCKET_ROOM_ID_INVALID");
  }
  return value;
}

function parseRequestUrl(value: string | undefined): URL | null {
  try {
    return new URL(
      value || "/",
      "http://room-lobby.invalid",
    );
  } catch {
    return null;
  }
}

function header(
  request: IncomingMessage,
  name: string,
): string {
  const value = request.headers[name];
  return Array.isArray(value)
    ? String(value[0] ?? "").trim()
    : String(value ?? "").trim();
}

function headerTokens(
  request: IncomingMessage,
  name: string,
): string[] {
  return header(request, name)
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isValidWebSocketKey(value: string): boolean {
  if (!/^[A-Za-z0-9+/]{22}==$/.test(value)) return false;
  try {
    return Buffer.from(value, "base64").length === 16;
  } catch {
    return false;
  }
}

function socketPath(value: unknown): string {
  const path = String(value || "").trim();
  if (
    !/^\/[A-Za-z0-9/_-]{1,200}$/.test(path)
    || path.includes("//")
    || path.endsWith("/")
  ) {
    throw new Error("ROOM_LOBBY_SOCKET_PATH_INVALID");
  }
  return path;
}

function parseOrigins(value: string | undefined): string[] {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeAllowedOrigin(value: string): string {
  if (value === "*") {
    throw new Error("ROOM_LOBBY_SOCKET_WILDCARD_FORBIDDEN");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("ROOM_LOBBY_SOCKET_ORIGIN_INVALID");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
    || !parsed.host
    || parsed.origin === "null"
  ) {
    throw new Error("ROOM_LOBBY_SOCKET_ORIGIN_INVALID");
  }
  return parsed.origin;
}

function booleanFlag(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined || value === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error("ROOM_LOBBY_SOCKET_FLAG_INVALID");
}

function integer(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const candidate = value ?? fallback;
  if (
    !Number.isSafeInteger(candidate)
    || candidate < minimum
    || candidate > maximum
  ) {
    throw new Error("ROOM_LOBBY_SOCKET_LIMIT_INVALID");
  }
  return candidate;
}

function normalizeIp(value: string | undefined): string {
  return String(value || "unknown").trim().slice(0, 128) || "unknown";
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function decrement(map: Map<string, number>, key: string): void {
  const next = (map.get(key) ?? 0) - 1;
  if (next > 0) map.set(key, next);
  else map.delete(key);
}

function exceptionStatus(error: unknown): number | null {
  if (
    !error
    || typeof error !== "object"
    || !("getStatus" in error)
    || typeof error.getStatus !== "function"
  ) {
    return null;
  }
  const status = Number(error.getStatus());
  return Number.isSafeInteger(status) ? status : null;
}

function httpReason(status: number): string {
  switch (status) {
    case 400: return "Bad Request";
    case 401: return "Unauthorized";
    case 403: return "Forbidden";
    case 404: return "Not Found";
    case 429: return "Too Many Requests";
    default: return "Internal Server Error";
  }
}
