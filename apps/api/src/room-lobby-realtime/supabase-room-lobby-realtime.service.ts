import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  assertRoomLobbyChangeEventV1,
  type RoomLobbyChangeEventV1,
} from "./room-lobby-change.contract";
import type { RoomLobbyRealtimeConfigV1 } from "./room-lobby-realtime.config";
import {
  RoomLobbyRealtimeMetricsV1,
  type RoomLobbyRealtimePublishFailureV1,
} from "./room-lobby-realtime.metrics";

export const ROOM_LOBBY_REALTIME_CONFIG_V1 = Symbol(
  "ROOM_LOBBY_REALTIME_CONFIG_V1",
);
export const ROOM_LOBBY_REALTIME_TRANSPORT_FACTORY_V1 = Symbol(
  "ROOM_LOBBY_REALTIME_TRANSPORT_FACTORY_V1",
);
export const ROOM_LOBBY_REALTIME_RUNTIME_V1 = Symbol(
  "ROOM_LOBBY_REALTIME_RUNTIME_V1",
);
export const ROOM_LOBBY_REALTIME_BROADCAST_EVENT_V1 =
  "room_lobby_changed_v1" as const;

export const ROOM_LOBBY_REALTIME_PRIVATE_CHANNEL_CONFIG_V1 = Object.freeze({
  config: Object.freeze({
    private: true,
    broadcast: Object.freeze({ ack: true, self: true }),
    presence: Object.freeze({ enabled: false }),
  }),
});

export type RoomLobbyLocalInvalidationForwarderV1 = (
  event: Readonly<RoomLobbyChangeEventV1>,
) => number;

export interface RoomLobbyRealtimeRuntimeV1 {
  now(): number;
  random(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RoomLobbyRealtimeTransportCallbacksV1 {
  readonly onEvent: (value: unknown) => void;
  readonly onDisconnected: (
    reason: "closed" | "channel_error" | "timed_out",
  ) => void;
}

export type RoomLobbyRealtimeTransportPublishStatusV1 =
  | "ok"
  | "error"
  | "timed out";

export interface RoomLobbyRealtimeTransportV1 {
  connect(): Promise<void>;
  publish(
    event: Readonly<RoomLobbyChangeEventV1>,
  ): Promise<RoomLobbyRealtimeTransportPublishStatusV1>;
  close(): Promise<void>;
}

export interface RoomLobbyRealtimeTransportFactoryV1 {
  create(
    config: Readonly<RoomLobbyRealtimeConfigV1>,
    callbacks: Readonly<RoomLobbyRealtimeTransportCallbacksV1>,
  ): Promise<RoomLobbyRealtimeTransportV1>;
}

export type RoomLobbyRealtimePublishResultV1 = Readonly<{
  status:
    | "REALTIME_PUBLISHED"
    | "LOCAL_ONLY_DISABLED"
    | "LOCAL_ONLY_DEGRADED"
    | "LOCAL_ONLY_NOT_CONNECTED"
    | "LOCAL_ONLY_PUBLISH_FAILED";
  localRecipients: number;
  realtimePublished: boolean;
}>;

export type RoomLobbyRealtimeReadinessV1 = Readonly<{
  requestedEnabled: boolean;
  enabled: boolean;
  mode: RoomLobbyRealtimeConfigV1["mode"];
  state:
    | "disabled"
    | "degraded"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "disconnected";
  connected: boolean;
  instanceId: string;
  reconnectScheduled: boolean;
  dedupeEntries: number;
  localForwarders: number;
  lastFailure:
    | null
    | "connect_failed"
    | "channel_error"
    | "timed_out"
    | "closed"
    | "publish_failed";
}>;

const DEFAULT_RUNTIME: RoomLobbyRealtimeRuntimeV1 = Object.freeze({
  now: () => Date.now(),
  random: () => Math.random(),
  setTimeout(callback: () => void, delayMs: number) {
    const timer = setTimeout(callback, delayMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    return timer;
  },
  clearTimeout(handle: unknown) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
});

@Injectable()
export class SupabaseRoomLobbyRealtimeService
implements OnModuleInit, OnModuleDestroy {
  private readonly seenEvents: BoundedEventDedupeV1;
  private readonly localForwarders =
    new Set<RoomLobbyLocalInvalidationForwarderV1>();
  private transport: RoomLobbyRealtimeTransportV1 | null = null;
  private connectPromise: Promise<boolean> | null = null;
  private reconnectTimer: unknown = null;
  private connected = false;
  private stopped = false;
  private reconnectAttempt = 0;
  private transportGeneration = 0;
  private lastFailure: RoomLobbyRealtimeReadinessV1["lastFailure"] = null;

  constructor(
    @Inject(ROOM_LOBBY_REALTIME_CONFIG_V1)
    private readonly config: Readonly<RoomLobbyRealtimeConfigV1>,
    @Inject(ROOM_LOBBY_REALTIME_TRANSPORT_FACTORY_V1)
    private readonly transportFactory: RoomLobbyRealtimeTransportFactoryV1,
    @Inject(RoomLobbyRealtimeMetricsV1)
    private readonly metrics: RoomLobbyRealtimeMetricsV1,
    @Inject(ROOM_LOBBY_REALTIME_RUNTIME_V1)
    private readonly runtime: RoomLobbyRealtimeRuntimeV1 = DEFAULT_RUNTIME,
  ) {
    this.seenEvents = new BoundedEventDedupeV1(
      config.dedupeTtlMs,
      config.dedupeMaxEntries,
    );
  }

  registerLocalForwarder(
    forwarder: RoomLobbyLocalInvalidationForwarderV1,
  ): () => void {
    if (typeof forwarder !== "function") {
      throw new Error("ROOM_LOBBY_REALTIME_FORWARDER_INVALID");
    }
    this.localForwarders.add(forwarder);
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      this.localForwarders.delete(forwarder);
    };
  }

  async onModuleInit(): Promise<void> {
    this.metrics.setConnected(false);
    if (!this.config.enabled) return;
    await this.ensureConnected();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    this.clearReconnectTimer();
    await this.disposeCurrentTransport();
    this.localForwarders.clear();
    this.metrics.setConnected(false);
  }

  async publish(
    value: unknown,
  ): Promise<RoomLobbyRealtimePublishResultV1> {
    const event = assertRoomLobbyChangeEventV1(value);
    const localRecipients = this.deliverIfNew(event, "local");

    if (this.config.mode === "DISABLED") {
      return Object.freeze({
        status: "LOCAL_ONLY_DISABLED",
        localRecipients,
        realtimePublished: false,
      });
    }
    if (this.config.mode === "DEGRADED_MISSING_CONFIGURATION") {
      return Object.freeze({
        status: "LOCAL_ONLY_DEGRADED",
        localRecipients,
        realtimePublished: false,
      });
    }

    this.metrics.recordPublishAttempt();
    if (!this.connected || !this.transport) {
      await this.ensureConnected();
    }
    const transport = this.transport;
    if (!this.connected || !transport) {
      this.metrics.recordPublishFailure("not_connected");
      return Object.freeze({
        status: "LOCAL_ONLY_NOT_CONNECTED",
        localRecipients,
        realtimePublished: false,
      });
    }

    let status: RoomLobbyRealtimeTransportPublishStatusV1;
    try {
      status = await withTimeout(
        transport.publish(event),
        this.config.publishTimeoutMs,
        this.runtime,
      );
    } catch {
      status = "error";
    }

    if (status === "ok") {
      return Object.freeze({
        status: "REALTIME_PUBLISHED",
        localRecipients,
        realtimePublished: true,
      });
    }

    const failure: RoomLobbyRealtimePublishFailureV1 = status === "timed out"
      ? "timed_out"
      : "transport_error";
    this.metrics.recordPublishFailure(failure);
    this.markDisconnectedAndReconnect("channel_error", "publish_failed");
    return Object.freeze({
      status: "LOCAL_ONLY_PUBLISH_FAILED",
      localRecipients,
      realtimePublished: false,
    });
  }

  readiness(): RoomLobbyRealtimeReadinessV1 {
    const state: RoomLobbyRealtimeReadinessV1["state"] =
      this.config.mode === "DISABLED"
        ? "disabled"
        : this.config.mode === "DEGRADED_MISSING_CONFIGURATION"
          ? "degraded"
          : this.connected
            ? "connected"
            : this.connectPromise
              ? "connecting"
              : this.reconnectTimer
                ? "reconnecting"
                : "disconnected";

    return Object.freeze({
      requestedEnabled: this.config.requestedEnabled,
      enabled: this.config.enabled,
      mode: this.config.mode,
      state,
      connected: this.connected,
      instanceId: this.config.instanceId,
      reconnectScheduled: this.reconnectTimer !== null,
      dedupeEntries: this.seenEvents.size(this.runtime.now()),
      localForwarders: this.localForwarders.size,
      lastFailure: this.lastFailure,
    });
  }

  private async ensureConnected(): Promise<boolean> {
    if (this.stopped || !this.config.enabled) return false;
    if (this.connected && this.transport) return true;
    if (this.connectPromise) return this.connectPromise;

    this.clearReconnectTimer();
    this.connectPromise = this.connectOnce()
      .finally(() => {
        this.connectPromise = null;
      });
    return this.connectPromise;
  }

  private async connectOnce(): Promise<boolean> {
    const generation = ++this.transportGeneration;
    let transport: RoomLobbyRealtimeTransportV1 | null = null;
    try {
      transport = await this.transportFactory.create(
        this.config,
        Object.freeze({
          onEvent: (value: unknown) => {
            if (generation !== this.transportGeneration || this.stopped) return;
            this.receiveRemote(value);
          },
          onDisconnected: (
            reason: "closed" | "channel_error" | "timed_out",
          ) => {
            if (generation !== this.transportGeneration || this.stopped) return;
            this.markDisconnectedAndReconnect(reason);
          },
        }),
      );
      if (generation !== this.transportGeneration || this.stopped) {
        await safeClose(transport);
        return false;
      }

      this.transport = transport;
      await transport.connect();
      if (
        generation !== this.transportGeneration
        || this.stopped
        || this.transport !== transport
      ) {
        await safeClose(transport);
        return false;
      }

      this.connected = true;
      this.reconnectAttempt = 0;
      this.lastFailure = null;
      this.metrics.setConnected(true);
      return true;
    } catch {
      if (this.transport === transport) this.transport = null;
      this.connected = false;
      this.lastFailure = "connect_failed";
      this.metrics.setConnected(false);
      if (transport) await safeClose(transport);
      this.scheduleReconnect();
      return false;
    }
  }

  private receiveRemote(value: unknown): void {
    let event: Readonly<RoomLobbyChangeEventV1>;
    try {
      event = assertRoomLobbyChangeEventV1(value);
    } catch {
      this.metrics.recordRejectedInbound();
      return;
    }
    this.deliverIfNew(event, "remote");
  }

  private deliverIfNew(
    event: Readonly<RoomLobbyChangeEventV1>,
    source: "local" | "remote",
  ): number {
    if (!this.seenEvents.rememberIfNew(event.eventId, this.runtime.now())) {
      return 0;
    }

    let recipients = 0;
    for (const forwarder of [...this.localForwarders]) {
      try {
        const delivered = forwarder(event);
        if (Number.isSafeInteger(delivered) && delivered > 0) {
          recipients += delivered;
        }
      } catch {
        this.metrics.recordForwardFailure();
      }
    }
    this.metrics.recordInvalidationsSent(recipients, source);
    return recipients;
  }

  private markDisconnectedAndReconnect(
    reason: "closed" | "channel_error" | "timed_out",
    failure: RoomLobbyRealtimeReadinessV1["lastFailure"] = reason,
  ): void {
    this.connected = false;
    this.lastFailure = failure;
    this.metrics.setConnected(false);

    const transport = this.transport;
    this.transport = null;
    this.transportGeneration += 1;
    if (transport) void safeClose(transport);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (
      this.stopped
      || !this.config.enabled
      || this.reconnectTimer !== null
    ) {
      return;
    }

    this.reconnectAttempt += 1;
    const delayMs = reconnectDelayMs(
      this.reconnectAttempt,
      this.config.reconnectMinMs,
      this.config.reconnectMaxMs,
      this.runtime.random(),
    );
    this.metrics.recordReconnectScheduled();
    this.reconnectTimer = this.runtime.setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected();
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    this.runtime.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private async disposeCurrentTransport(): Promise<void> {
    const transport = this.transport;
    this.transport = null;
    this.connected = false;
    this.transportGeneration += 1;
    if (transport) await safeClose(transport);
  }
}

@Injectable()
export class SupabaseRoomLobbyRealtimeTransportFactoryV1
implements RoomLobbyRealtimeTransportFactoryV1 {
  async create(
    config: Readonly<RoomLobbyRealtimeConfigV1>,
    callbacks: Readonly<RoomLobbyRealtimeTransportCallbacksV1>,
  ): Promise<RoomLobbyRealtimeTransportV1> {
    if (
      !config.enabled
      || !config.supabaseUrl
      || !config.serviceRoleKey
    ) {
      throw new Error("ROOM_LOBBY_REALTIME_TRANSPORT_DISABLED");
    }

    const realtimeModule = await import("@supabase/realtime-js");
    const RealtimeClient = realtimeModule.RealtimeClient;
    const client = new RealtimeClient(
      `${config.supabaseUrl}/realtime/v1`,
      {
        params: { apikey: config.serviceRoleKey },
        timeout: config.connectTimeoutMs,
        heartbeatIntervalMs: config.heartbeatIntervalMs,
        reconnectAfterMs: (tries: number) => reconnectDelayMs(
          Math.max(1, tries),
          config.reconnectMinMs,
          config.reconnectMaxMs,
          0.5,
        ),
      },
    );
    await client.setAuth(config.serviceRoleKey);
    const channel = client.channel(
      config.topic,
      ROOM_LOBBY_REALTIME_PRIVATE_CHANNEL_CONFIG_V1,
    );
    channel.on(
      "broadcast",
      { event: ROOM_LOBBY_REALTIME_BROADCAST_EVENT_V1 },
      (message: { payload?: unknown }) => callbacks.onEvent(message.payload),
    );

    return new SupabaseSdkRoomLobbyRealtimeTransportV1(
      client,
      channel,
      callbacks,
      config.connectTimeoutMs,
    );
  }
}

class SupabaseSdkRoomLobbyRealtimeTransportV1
implements RoomLobbyRealtimeTransportV1 {
  private connected = false;
  private closed = false;

  constructor(
    private readonly client: {
      removeChannel(channel: unknown): Promise<unknown>;
      disconnect(): void | Promise<unknown>;
    },
    private readonly channel: {
      subscribe(
        callback: (status: string, error?: Error) => void,
        timeout?: number,
      ): unknown;
      send(input: {
        type: "broadcast";
        event: string;
        payload: unknown;
      }): Promise<string>;
    },
    private readonly callbacks: Readonly<RoomLobbyRealtimeTransportCallbacksV1>,
    private readonly connectTimeoutMs: number,
  ) {}

  connect(): Promise<void> {
    if (this.closed) {
      return Promise.reject(
        new Error("ROOM_LOBBY_REALTIME_TRANSPORT_CLOSED"),
      );
    }
    if (this.connected) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      this.channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          this.connected = true;
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }

        const reason = status === "TIMED_OUT"
          ? "timed_out"
          : status === "CLOSED"
            ? "closed"
            : "channel_error";
        this.connected = false;
        if (!settled) {
          settled = true;
          reject(new Error(`ROOM_LOBBY_REALTIME_${status}`));
        } else if (!this.closed) {
          this.callbacks.onDisconnected(reason);
        }
      }, this.connectTimeoutMs);
    });
  }

  async publish(
    event: Readonly<RoomLobbyChangeEventV1>,
  ): Promise<RoomLobbyRealtimeTransportPublishStatusV1> {
    if (this.closed || !this.connected) return "error";
    const status = await this.channel.send({
      type: "broadcast",
      event: ROOM_LOBBY_REALTIME_BROADCAST_EVENT_V1,
      payload: event,
    });
    if (status === "ok" || status === "timed out") return status;
    return "error";
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    try {
      await this.client.removeChannel(this.channel);
    } catch {
      // Best-effort shutdown; disconnect below is the final fence.
    }
    try {
      await this.client.disconnect();
    } catch {
      // Shutdown is idempotent and never exposes SDK errors or credentials.
    }
  }
}

class BoundedEventDedupeV1 {
  private readonly entries = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  rememberIfNew(eventId: string, now: number): boolean {
    this.prune(now);
    const expiresAt = this.entries.get(eventId);
    if (expiresAt !== undefined && expiresAt > now) return false;
    this.entries.delete(eventId);
    this.entries.set(eventId, now + this.ttlMs);

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return true;
  }

  size(now: number): number {
    this.prune(now);
    return this.entries.size;
  }

  private prune(now: number): void {
    for (const [eventId, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(eventId);
    }
  }
}

function reconnectDelayMs(
  attempt: number,
  minimum: number,
  maximum: number,
  randomValue: number,
): number {
  const exponent = Math.min(20, Math.max(0, attempt - 1));
  const base = Math.min(maximum, minimum * 2 ** exponent);
  const random = Number.isFinite(randomValue)
    ? Math.min(1, Math.max(0, randomValue))
    : 0.5;
  const jitter = 0.75 + random * 0.5;
  return Math.max(minimum, Math.min(maximum, Math.round(base * jitter)));
}

async function safeClose(
  transport: RoomLobbyRealtimeTransportV1,
): Promise<void> {
  try {
    await transport.close();
  } catch {
    // Transport cleanup is best effort and never changes room authority.
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  runtime: RoomLobbyRealtimeRuntimeV1,
): Promise<T | "timed out"> {
  let timer: unknown = null;
  const timeout = new Promise<"timed out">((resolve) => {
    timer = runtime.setTimeout(() => resolve("timed out"), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== null) runtime.clearTimeout(timer);
  }
}
