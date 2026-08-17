import assert from "node:assert/strict";
import test from "node:test";
import {
  ROOM_LOBBY_REALTIME_DEFAULT_TOPIC_V1,
  resolveRoomLobbyRealtimeConfigV1,
} from "./room-lobby-realtime.config";

const URL_VALUE = "https://project.example.supabase.co";
const KEY_VALUE = "test-service-role-key-not-a-real-secret";

test("enabled=false is an explicit configuration-safe degraded mode", () => {
  const config = resolveRoomLobbyRealtimeConfigV1(
    { NODE_ENV: "production", ROOM_LOBBY_REALTIME_ENABLED: "false" },
    { randomId: () => "disabled-instance" },
  );

  assert.equal(config.requestedEnabled, false);
  assert.equal(config.enabled, false);
  assert.equal(config.mode, "DISABLED");
  assert.equal(config.supabaseUrl, null);
  assert.equal(config.serviceRoleKey, null);
  assert.equal(config.topic, ROOM_LOBBY_REALTIME_DEFAULT_TOPIC_V1);
});

test("production fails closed when enabled without either server credential", () => {
  for (const env of [
    { SUPABASE_URL: URL_VALUE },
    { SUPABASE_SERVICE_ROLE_KEY: KEY_VALUE },
    {},
  ]) {
    assert.throws(
      () => resolveRoomLobbyRealtimeConfigV1({
        NODE_ENV: "production",
        ROOM_LOBBY_REALTIME_ENABLED: "true",
        ...env,
      }),
      /ROOM_LOBBY_REALTIME_CONFIGURATION_REQUIRED/,
    );
  }
});

test("non-production enabled without credentials reports an explicit degraded mode", () => {
  const config = resolveRoomLobbyRealtimeConfigV1({
    NODE_ENV: "test",
    ROOM_LOBBY_REALTIME_ENABLED: "true",
  });

  assert.equal(config.requestedEnabled, true);
  assert.equal(config.enabled, false);
  assert.equal(config.mode, "DEGRADED_MISSING_CONFIGURATION");
});

test("enabled production configuration normalizes only safe server-side values", () => {
  const config = resolveRoomLobbyRealtimeConfigV1({
    NODE_ENV: "production",
    ROOM_LOBBY_REALTIME_ENABLED: "true",
    SUPABASE_URL: `${URL_VALUE}/`,
    SUPABASE_SERVICE_ROLE_KEY: KEY_VALUE,
    ROOM_LOBBY_REALTIME_TOPIC: "room-lobby-private-v1",
    ROOM_LOBBY_REALTIME_INSTANCE_ID: "railway-replica-1",
    ROOM_LOBBY_REALTIME_RECONNECT_MIN_MS: "500",
    ROOM_LOBBY_REALTIME_RECONNECT_MAX_MS: "5000",
    ROOM_LOBBY_REALTIME_DEDUPE_MAX_ENTRIES: "128",
  });

  assert.equal(config.enabled, true);
  assert.equal(config.mode, "ENABLED");
  assert.equal(config.supabaseUrl, URL_VALUE);
  assert.equal(config.serviceRoleKey, KEY_VALUE);
  assert.equal(config.topic, "room-lobby-private-v1");
  assert.equal(config.instanceId, "railway-replica-1");
  assert.equal(config.reconnectMinMs, 500);
  assert.equal(config.reconnectMaxMs, 5_000);
  assert.equal(config.dedupeMaxEntries, 128);
});

test("configuration rejects unsafe topics, URLs, flags, and limits without echoing secrets", () => {
  const base = {
    NODE_ENV: "production",
    ROOM_LOBBY_REALTIME_ENABLED: "true",
    SUPABASE_URL: URL_VALUE,
    SUPABASE_SERVICE_ROLE_KEY: KEY_VALUE,
  };
  const invalid = [
    { ROOM_LOBBY_REALTIME_TOPIC: "*" },
    { ROOM_LOBBY_REALTIME_TOPIC: "realtime:public" },
    { SUPABASE_URL: "https://user:password@example.test" },
    { SUPABASE_URL: "http://project.example.supabase.co" },
    { ROOM_LOBBY_REALTIME_RECONNECT_MIN_MS: "0" },
    { ROOM_LOBBY_REALTIME_ENABLED: "sometimes" },
  ];

  for (const overrides of invalid) {
    assert.throws(
      () => resolveRoomLobbyRealtimeConfigV1({ ...base, ...overrides }),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        assert.equal((error as Error).message.includes(KEY_VALUE), false);
        return true;
      },
    );
  }
});

test("readiness-safe instance fallback is generated without deriving it from credentials", () => {
  const config = resolveRoomLobbyRealtimeConfigV1(
    {
      NODE_ENV: "test",
      ROOM_LOBBY_REALTIME_ENABLED: "true",
      SUPABASE_URL: URL_VALUE,
      SUPABASE_SERVICE_ROLE_KEY: KEY_VALUE,
    },
    { randomId: () => "00000000-0000-4000-8000-000000000001" },
  );

  assert.equal(
    config.instanceId,
    "local-00000000-0000-4000-8000-000000000001",
  );
  assert.equal(config.instanceId.includes(KEY_VALUE), false);
});
