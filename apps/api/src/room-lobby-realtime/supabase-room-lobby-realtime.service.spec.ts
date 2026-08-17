import assert from "node:assert/strict";
import test from "node:test";
import {
  createRoomLobbyChangeEventV1,
  type RoomLobbyChangeEventV1,
} from "./room-lobby-change.contract";
import type { RoomLobbyRealtimeConfigV1 } from "./room-lobby-realtime.config";
import {
  RoomLobbyRealtimeMetricsV1,
  type RoomLobbyRealtimeMetricSinkV1,
} from "./room-lobby-realtime.metrics";
import {
  ROOM_LOBBY_REALTIME_PRIVATE_CHANNEL_CONFIG_V1,
  SupabaseRoomLobbyRealtimeService,
  type RoomLobbyRealtimeRuntimeV1,
  type RoomLobbyRealtimeTransportCallbacksV1,
  type RoomLobbyRealtimeTransportFactoryV1,
  type RoomLobbyRealtimeTransportPublishStatusV1,
  type RoomLobbyRealtimeTransportV1,
} from "./supabase-room-lobby-realtime.service";

const ROOM_ID = "room_module_c_realtime";
const URL_VALUE = "https://project.example.supabase.co";
const KEY_VALUE = "test-service-role-key-not-a-real-secret";

test("the SDK channel is private, acknowledged, self-echoing, and presence-free", () => {
  assert.deepEqual(ROOM_LOBBY_REALTIME_PRIVATE_CHANNEL_CONFIG_V1, {
    config: {
      private: true,
      broadcast: { ack: true, self: true },
      presence: { enabled: false },
    },
  });
  assert.equal(
    Object.isFrozen(ROOM_LOBBY_REALTIME_PRIVATE_CHANNEL_CONFIG_V1),
    true,
  );
  assert.equal(
    Object.isFrozen(ROOM_LOBBY_REALTIME_PRIVATE_CHANNEL_CONFIG_V1.config),
    true,
  );
});

test("enabled=false stays local-only and never creates a Supabase transport", async () => {
  const state = harness({
    config: config({
      mode: "DISABLED",
      enabled: false,
      requestedEnabled: false,
      supabaseUrl: null,
      serviceRoleKey: null,
    }),
  });
  await state.service.onModuleInit();

  const result = await state.service.publish(event(1));

  assert.deepEqual(result, {
    status: "LOCAL_ONLY_DISABLED",
    localRecipients: 1,
    realtimePublished: false,
  });
  assert.equal(state.factory.created, 0);
  assert.deepEqual(state.forwarded, [event(1)]);
  assert.deepEqual(state.service.readiness(), {
    requestedEnabled: false,
    enabled: false,
    mode: "DISABLED",
    state: "disabled",
    connected: false,
    instanceId: "module-c-instance",
    reconnectScheduled: false,
    dedupeEntries: 1,
    localForwarders: 1,
    lastFailure: null,
  });
  await state.service.onModuleDestroy();
});

test("two service instances exchange only the Module A event and suppress the sender echo", async () => {
  const hub = new FakeRealtimeHub();
  const left = harness({ hub, instanceId: "api-1" });
  const right = harness({ hub, instanceId: "api-2" });
  await Promise.all([
    left.service.onModuleInit(),
    right.service.onModuleInit(),
  ]);

  const value = event(2);
  const result = await left.service.publish(value);
  await settle();

  assert.equal(result.status, "REALTIME_PUBLISHED");
  assert.deepEqual(left.forwarded, [value]);
  assert.deepEqual(right.forwarded, [value]);
  assert.deepEqual(Object.keys(right.forwarded[0]!), [
    "type",
    "schemaVersion",
    "eventId",
    "roomId",
    "reason",
    "occurredAt",
  ]);
  assert.equal(JSON.stringify(right.forwarded).includes(KEY_VALUE), false);
  assert.equal(JSON.stringify(right.forwarded).includes(URL_VALUE), false);
  assert.equal(left.service.readiness().dedupeEntries, 1);
  assert.equal(right.service.readiness().dedupeEntries, 1);

  await Promise.all([
    left.service.onModuleDestroy(),
    right.service.onModuleDestroy(),
  ]);
});

test("duplicate broadcasts are safe and the dedupe cache remains bounded", async () => {
  const state = harness({
    config: config({ dedupeMaxEntries: 64 }),
  });
  await state.service.onModuleInit();

  const duplicate = event(3);
  state.hub.broadcastRaw(duplicate);
  state.hub.broadcastRaw(duplicate);
  await settle();
  assert.deepEqual(state.forwarded, [duplicate]);

  for (let index = 10; index < 90; index += 1) {
    state.hub.broadcastRaw(event(index));
  }
  await settle();

  assert.equal(state.service.readiness().dedupeEntries <= 64, true);
  assert.equal(state.forwarded.length, 81);
  await state.service.onModuleDestroy();
});

test("invalid inbound payloads are rejected before the Gateway forward port", async () => {
  const state = harness();
  await state.service.onModuleInit();

  state.hub.broadcastRaw({
    ...event(4),
    userId: "private-user-id",
  });
  state.hub.broadcastRaw({
    type: "room.invalidated",
    schemaVersion: "room_lobby_changed_v1",
    roomId: ROOM_ID,
  });
  await settle();

  assert.deepEqual(state.forwarded, []);
  assert.equal(
    state.metrics.readForTest(
      "room_lobby_realtime_inbound_rejected_total",
      { reason: "contract_invalid" },
    ),
    2,
  );
  await state.service.onModuleDestroy();
});

test("publish failure preserves local delivery, records failure, and schedules reconnect", async () => {
  const runtime = new FakeRuntime();
  const state = harness({ runtime });
  state.hub.nextPublishStatus = "error";
  await state.service.onModuleInit();

  const result = await state.service.publish(event(5));

  assert.deepEqual(result, {
    status: "LOCAL_ONLY_PUBLISH_FAILED",
    localRecipients: 1,
    realtimePublished: false,
  });
  assert.deepEqual(state.forwarded, [event(5)]);
  assert.equal(state.service.readiness().connected, false);
  assert.equal(state.service.readiness().reconnectScheduled, true);
  assert.equal(state.service.readiness().lastFailure, "publish_failed");
  assert.equal(
    state.metrics.readForTest(
      "room_lobby_realtime_publish_failure_total",
      { transport: "supabase", failure: "transport_error" },
    ),
    1,
  );
  await state.service.onModuleDestroy();
});

test("channel disconnection schedules bounded reconnect and restores readiness", async () => {
  const runtime = new FakeRuntime();
  const state = harness({ runtime });
  await state.service.onModuleInit();
  assert.equal(state.service.readiness().connected, true);
  assert.equal(state.factory.created, 1);

  state.hub.disconnectAll("channel_error");
  await settle();
  assert.equal(state.service.readiness().state, "reconnecting");
  assert.equal(runtime.pendingCount(), 1);
  assert.equal(runtime.lastDelay()! >= 100, true);
  assert.equal(runtime.lastDelay()! <= 1_000, true);

  runtime.runNext();
  await settle();
  await settle();

  assert.equal(state.factory.created, 2);
  assert.equal(state.service.readiness().connected, true);
  assert.equal(state.service.readiness().lastFailure, null);
  await state.service.onModuleDestroy();
});

test("local Gateway registration and unregistration are explicit and idempotent", async () => {
  const state = harness({ registerForwarder: false });
  const delivered: Readonly<RoomLobbyChangeEventV1>[] = [];
  const unregister = state.service.registerLocalForwarder((value) => {
    delivered.push(value);
    return 2;
  });
  await state.service.onModuleInit();

  const first = await state.service.publish(event(6));
  assert.equal(first.localRecipients, 2);
  assert.deepEqual(delivered, [event(6)]);

  unregister();
  unregister();
  const second = await state.service.publish(event(7));
  assert.equal(second.localRecipients, 0);
  assert.deepEqual(delivered, [event(6)]);
  assert.equal(state.service.readiness().localForwarders, 0);
  await state.service.onModuleDestroy();
});

test("readiness is safe and never contains the Supabase URL or service-role key", async () => {
  const state = harness();
  await state.service.onModuleInit();

  const outward = JSON.stringify(state.service.readiness());
  assert.equal(outward.includes(URL_VALUE), false);
  assert.equal(outward.includes(KEY_VALUE), false);
  assert.equal(outward.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
  assert.equal(outward.includes("SUPABASE_URL"), false);
  await state.service.onModuleDestroy();
});

function harness(options: {
  config?: Readonly<RoomLobbyRealtimeConfigV1>;
  runtime?: FakeRuntime;
  hub?: FakeRealtimeHub;
  instanceId?: string;
  registerForwarder?: boolean;
} = {}) {
  const forwarded: Readonly<RoomLobbyChangeEventV1>[] = [];
  const metricSink: RoomLobbyRealtimeMetricSinkV1 = { increment() {}, set() {} };
  const metrics = new RoomLobbyRealtimeMetricsV1(metricSink);
  const runtime = options.runtime ?? new FakeRuntime();
  const hub = options.hub ?? new FakeRealtimeHub();
  const factory = new FakeTransportFactory(hub);
  const configured = options.config ?? config({
    instanceId: options.instanceId ?? "module-c-instance",
  });
  const service = new SupabaseRoomLobbyRealtimeService(
    configured,
    factory,
    metrics,
    runtime,
  );
  if (options.registerForwarder !== false) {
    service.registerLocalForwarder((value) => {
      forwarded.push(value);
      return 1;
    });
  }
  return {
    service,
    factory,
    forwarded,
    metrics,
    runtime,
    hub,
  };
}

function config(
  overrides: Partial<RoomLobbyRealtimeConfigV1> = {},
): Readonly<RoomLobbyRealtimeConfigV1> {
  return Object.freeze({
    requestedEnabled: true,
    enabled: true,
    mode: "ENABLED",
    supabaseUrl: URL_VALUE,
    serviceRoleKey: KEY_VALUE,
    topic: "room-lobby-invalidation-v1",
    instanceId: "module-c-instance",
    connectTimeoutMs: 1_000,
    publishTimeoutMs: 1_000,
    heartbeatIntervalMs: 25_000,
    reconnectMinMs: 100,
    reconnectMaxMs: 1_000,
    dedupeTtlMs: 120_000,
    dedupeMaxEntries: 128,
    ...overrides,
  });
}

function event(index: number): Readonly<RoomLobbyChangeEventV1> {
  return createRoomLobbyChangeEventV1({
    eventId: `evt_00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    roomId: ROOM_ID,
    reason: index % 2 === 0 ? "READY_CHANGED" : "ROLE_CHANGED",
    occurredAt: `2026-08-15T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
  });
}

class FakeRealtimeHub {
  readonly transports = new Set<FakeTransport>();
  nextPublishStatus: RoomLobbyRealtimeTransportPublishStatusV1 = "ok";

  broadcastRaw(value: unknown): void {
    for (const transport of [...this.transports]) {
      transport.callbacks.onEvent(structuredClone(value));
    }
  }

  disconnectAll(reason: "closed" | "channel_error" | "timed_out"): void {
    for (const transport of [...this.transports]) {
      transport.connected = false;
      transport.callbacks.onDisconnected(reason);
    }
  }
}

class FakeTransportFactory implements RoomLobbyRealtimeTransportFactoryV1 {
  created = 0;

  constructor(private readonly hub: FakeRealtimeHub) {}

  async create(
    _config: Readonly<RoomLobbyRealtimeConfigV1>,
    callbacks: Readonly<RoomLobbyRealtimeTransportCallbacksV1>,
  ): Promise<RoomLobbyRealtimeTransportV1> {
    this.created += 1;
    return new FakeTransport(this.hub, callbacks);
  }
}

class FakeTransport implements RoomLobbyRealtimeTransportV1 {
  connected = false;
  closed = false;

  constructor(
    private readonly hub: FakeRealtimeHub,
    readonly callbacks: Readonly<RoomLobbyRealtimeTransportCallbacksV1>,
  ) {}

  async connect(): Promise<void> {
    if (this.closed) throw new Error("closed");
    this.connected = true;
    this.hub.transports.add(this);
  }

  async publish(
    value: Readonly<RoomLobbyChangeEventV1>,
  ): Promise<RoomLobbyRealtimeTransportPublishStatusV1> {
    const status = this.hub.nextPublishStatus;
    this.hub.nextPublishStatus = "ok";
    if (!this.connected || this.closed) return "error";
    if (status === "ok") this.hub.broadcastRaw(value);
    return status;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.connected = false;
    this.hub.transports.delete(this);
  }
}

class FakeRuntime implements RoomLobbyRealtimeRuntimeV1 {
  private currentTime = Date.parse("2026-08-15T00:00:00.000Z");
  private nextHandle = 1;
  private readonly timers = new Map<number, {
    callback: () => void;
    delayMs: number;
  }>();
  private latestDelay: number | null = null;

  now(): number {
    return this.currentTime;
  }

  random(): number {
    return 0.5;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const handle = this.nextHandle++;
    this.latestDelay = delayMs;
    this.timers.set(handle, { callback, delayMs });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(Number(handle));
  }

  pendingCount(): number {
    return this.timers.size;
  }

  lastDelay(): number | null {
    return this.latestDelay;
  }

  runNext(): void {
    const entry = this.timers.entries().next().value as
      | [number, { callback: () => void; delayMs: number }]
      | undefined;
    if (!entry) throw new Error("No scheduled timer");
    this.timers.delete(entry[0]);
    this.currentTime += entry[1].delayMs;
    entry[1].callback();
  }
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
