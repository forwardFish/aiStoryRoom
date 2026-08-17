import { randomUUID } from "node:crypto";

export const ROOM_LOBBY_REALTIME_DEFAULT_TOPIC_V1 =
  "room-lobby-invalidation-v1" as const;

export type RoomLobbyRealtimeModeV1 =
  | "ENABLED"
  | "DISABLED"
  | "DEGRADED_MISSING_CONFIGURATION";

export interface RoomLobbyRealtimeConfigV1 {
  readonly requestedEnabled: boolean;
  readonly enabled: boolean;
  readonly mode: RoomLobbyRealtimeModeV1;
  readonly supabaseUrl: string | null;
  readonly serviceRoleKey: string | null;
  readonly topic: string;
  readonly instanceId: string;
  readonly connectTimeoutMs: number;
  readonly publishTimeoutMs: number;
  readonly heartbeatIntervalMs: number;
  readonly reconnectMinMs: number;
  readonly reconnectMaxMs: number;
  readonly dedupeTtlMs: number;
  readonly dedupeMaxEntries: number;
}

export interface ResolveRoomLobbyRealtimeConfigOptionsV1 {
  readonly randomId?: () => string;
}

export function resolveRoomLobbyRealtimeConfigV1(
  env: Readonly<Record<string, string | undefined>>,
  options: Readonly<ResolveRoomLobbyRealtimeConfigOptionsV1> = {},
): Readonly<RoomLobbyRealtimeConfigV1> {
  const requestedEnabled = booleanFlag(
    env.ROOM_LOBBY_REALTIME_ENABLED,
    false,
    "ROOM_LOBBY_REALTIME_ENABLED",
  );
  const production = env.NODE_ENV === "production";
  const suppliedUrl = text(env.SUPABASE_URL);
  const suppliedKey = text(env.SUPABASE_SERVICE_ROLE_KEY);
  const missingConfiguration = requestedEnabled
    && (!suppliedUrl || !suppliedKey);

  if (production && missingConfiguration) {
    throw new Error(
      "ROOM_LOBBY_REALTIME_CONFIGURATION_REQUIRED",
    );
  }

  const mode: RoomLobbyRealtimeModeV1 = !requestedEnabled
    ? "DISABLED"
    : missingConfiguration
      ? "DEGRADED_MISSING_CONFIGURATION"
      : "ENABLED";
  const enabled = mode === "ENABLED";
  const supabaseUrl = requestedEnabled && suppliedUrl
    ? normalizeSupabaseUrl(suppliedUrl, production)
    : null;
  const serviceRoleKey = requestedEnabled && suppliedKey
    ? requireSecretShape(suppliedKey)
    : null;
  const reconnectMinMs = boundedInteger(
    env.ROOM_LOBBY_REALTIME_RECONNECT_MIN_MS,
    1_000,
    100,
    60_000,
    "ROOM_LOBBY_REALTIME_RECONNECT_MIN_MS",
  );
  const reconnectMaxMs = boundedInteger(
    env.ROOM_LOBBY_REALTIME_RECONNECT_MAX_MS,
    30_000,
    reconnectMinMs,
    300_000,
    "ROOM_LOBBY_REALTIME_RECONNECT_MAX_MS",
  );

  return Object.freeze({
    requestedEnabled,
    enabled,
    mode,
    supabaseUrl,
    serviceRoleKey,
    topic: requireTopic(
      env.ROOM_LOBBY_REALTIME_TOPIC
        ?? ROOM_LOBBY_REALTIME_DEFAULT_TOPIC_V1,
    ),
    instanceId: requireInstanceId(
      env.ROOM_LOBBY_REALTIME_INSTANCE_ID
        ?? env.RAILWAY_REPLICA_ID
        ?? env.RAILWAY_SERVICE_ID
        ?? env.HOSTNAME
        ?? `local-${(options.randomId ?? randomUUID)()}`,
    ),
    connectTimeoutMs: boundedInteger(
      env.ROOM_LOBBY_REALTIME_CONNECT_TIMEOUT_MS,
      10_000,
      1_000,
      60_000,
      "ROOM_LOBBY_REALTIME_CONNECT_TIMEOUT_MS",
    ),
    publishTimeoutMs: boundedInteger(
      env.ROOM_LOBBY_REALTIME_PUBLISH_TIMEOUT_MS,
      5_000,
      500,
      30_000,
      "ROOM_LOBBY_REALTIME_PUBLISH_TIMEOUT_MS",
    ),
    heartbeatIntervalMs: boundedInteger(
      env.ROOM_LOBBY_REALTIME_HEARTBEAT_INTERVAL_MS,
      25_000,
      5_000,
      60_000,
      "ROOM_LOBBY_REALTIME_HEARTBEAT_INTERVAL_MS",
    ),
    reconnectMinMs,
    reconnectMaxMs,
    dedupeTtlMs: boundedInteger(
      env.ROOM_LOBBY_REALTIME_DEDUPE_TTL_MS,
      120_000,
      5_000,
      600_000,
      "ROOM_LOBBY_REALTIME_DEDUPE_TTL_MS",
    ),
    dedupeMaxEntries: boundedInteger(
      env.ROOM_LOBBY_REALTIME_DEDUPE_MAX_ENTRIES,
      4_096,
      64,
      100_000,
      "ROOM_LOBBY_REALTIME_DEDUPE_MAX_ENTRIES",
    ),
  });
}

function normalizeSupabaseUrl(
  value: string,
  production: boolean,
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("ROOM_LOBBY_REALTIME_SUPABASE_URL_INVALID");
  }
  if (
    (parsed.protocol !== "https:"
      && (!(!production && parsed.protocol === "http:")))
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !parsed.host
    || (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new Error("ROOM_LOBBY_REALTIME_SUPABASE_URL_INVALID");
  }
  return parsed.origin;
}

function requireSecretShape(value: string): string {
  if (
    value.length < 20
    || value.length > 16_384
    || /[\r\n\0]/u.test(value)
  ) {
    throw new Error(
      "ROOM_LOBBY_REALTIME_SERVICE_ROLE_KEY_INVALID",
    );
  }
  return value;
}

function requireTopic(value: string): string {
  const topic = value.trim();
  if (
    topic.length < 3
    || topic.length > 120
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(topic)
    || topic === "*"
    || topic.startsWith("realtime:")
  ) {
    throw new Error("ROOM_LOBBY_REALTIME_TOPIC_INVALID");
  }
  return topic;
}

function requireInstanceId(value: string): string {
  const instanceId = value.trim();
  if (
    instanceId.length < 1
    || instanceId.length > 160
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(instanceId)
  ) {
    throw new Error("ROOM_LOBBY_REALTIME_INSTANCE_ID_INVALID");
  }
  return instanceId;
}

function booleanFlag(
  value: string | undefined,
  fallback: boolean,
  name: string,
): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name}_INVALID`);
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed)
    || parsed < minimum
    || parsed > maximum
  ) {
    throw new Error(`${name}_INVALID`);
  }
  return parsed;
}

function text(value: string | undefined): string {
  return String(value ?? "").trim();
}
