import { Inject, Injectable } from "@nestjs/common";
import { operationalMetrics } from "../observability/operational-metrics";

export const ROOM_LOBBY_REALTIME_METRIC_SINK_V1 = Symbol(
  "ROOM_LOBBY_REALTIME_METRIC_SINK_V1",
);

type RoomLobbyRealtimeCounterMetricV1 =
  | "room_lobby_realtime_publish_total"
  | "room_lobby_realtime_publish_failure_total"
  | "room_lobby_socket_invalidations_sent_total"
  | "room_lobby_realtime_reconnect_total"
  | "room_lobby_realtime_inbound_rejected_total"
  | "room_lobby_realtime_forward_failure_total";

type RoomLobbyRealtimeGaugeMetricV1 =
  | "room_lobby_realtime_connected";

export interface RoomLobbyRealtimeMetricSinkV1 {
  increment(
    name: RoomLobbyRealtimeCounterMetricV1,
    labels?: Readonly<Record<string, string>>,
    amount?: number,
  ): void;
  set(
    name: RoomLobbyRealtimeGaugeMetricV1,
    labels: Readonly<Record<string, string>>,
    value: number,
  ): void;
}

export type RoomLobbyRealtimePublishFailureV1 =
  | "not_connected"
  | "transport_error"
  | "timed_out";

@Injectable()
export class RoomLobbyRealtimeMetricsV1 {
  private readonly values = new Map<string, number>();

  constructor(
    @Inject(ROOM_LOBBY_REALTIME_METRIC_SINK_V1)
    private readonly sink: RoomLobbyRealtimeMetricSinkV1,
  ) {}

  setConnected(connected: boolean): void {
    const labels = { transport: "supabase" } as const;
    const value = connected ? 1 : 0;
    this.values.set(metricKey("room_lobby_realtime_connected", labels), value);
    this.sink.set("room_lobby_realtime_connected", labels, value);
  }

  recordPublishAttempt(): void {
    this.increment(
      "room_lobby_realtime_publish_total",
      { transport: "supabase" },
    );
  }

  recordPublishFailure(
    failure: RoomLobbyRealtimePublishFailureV1,
  ): void {
    this.increment(
      "room_lobby_realtime_publish_failure_total",
      { transport: "supabase", failure },
    );
  }

  recordInvalidationsSent(
    count: number,
    source: "local" | "remote",
  ): void {
    if (!Number.isSafeInteger(count) || count <= 0) return;
    this.increment(
      "room_lobby_socket_invalidations_sent_total",
      { source },
      count,
    );
  }

  recordReconnectScheduled(): void {
    this.increment(
      "room_lobby_realtime_reconnect_total",
      { transport: "supabase" },
    );
  }

  recordRejectedInbound(): void {
    this.increment(
      "room_lobby_realtime_inbound_rejected_total",
      { reason: "contract_invalid" },
    );
  }

  recordForwardFailure(): void {
    this.increment(
      "room_lobby_realtime_forward_failure_total",
      { transport: "websocket" },
    );
  }

  readForTest(
    name: RoomLobbyRealtimeCounterMetricV1 | RoomLobbyRealtimeGaugeMetricV1,
    labels: Readonly<Record<string, string>>,
  ): number {
    return this.values.get(metricKey(name, labels)) ?? 0;
  }

  private increment(
    name: RoomLobbyRealtimeCounterMetricV1,
    labels: Readonly<Record<string, string>>,
    amount = 1,
  ): void {
    const key = metricKey(name, labels);
    const next = (this.values.get(key) ?? 0) + amount;
    this.values.set(key, next);
    this.sink.increment(name, labels, amount);
  }
}

export const ROOM_LOBBY_REALTIME_OPERATIONAL_METRIC_SINK_V1:
RoomLobbyRealtimeMetricSinkV1 = Object.freeze({
  increment(
    name: RoomLobbyRealtimeCounterMetricV1,
    labels: Readonly<Record<string, string>> = {},
    amount = 1,
  ) {
    operationalMetrics.increment(name, labels, amount);
  },
  set(
    name: RoomLobbyRealtimeGaugeMetricV1,
    labels: Readonly<Record<string, string>>,
    value: number,
  ) {
    operationalMetrics.set(name, labels, value);
  },
});

function metricKey(
  name: string,
  labels: Readonly<Record<string, string>>,
): string {
  const orderedLabels = Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right));
  return `${name}\0${JSON.stringify(orderedLabels)}`;
}
