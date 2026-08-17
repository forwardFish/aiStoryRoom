import assert from "node:assert/strict";
import test from "node:test";
import {
  RoomLobbyRealtimeMetricsV1,
  type RoomLobbyRealtimeMetricSinkV1,
} from "./room-lobby-realtime.metrics";

test("Realtime metrics expose required gauges and cumulative counters", () => {
  const samples: Array<{
    operation: "increment" | "set";
    name: string;
    labels: Readonly<Record<string, string>>;
    value: number;
  }> = [];
  const sink: RoomLobbyRealtimeMetricSinkV1 = {
    increment(name, labels = {}, amount = 1) {
      samples.push({
        operation: "increment",
        name,
        labels: { ...labels },
        value: amount,
      });
    },
    set(name, labels, value) {
      samples.push({
        operation: "set",
        name,
        labels: { ...labels },
        value,
      });
    },
  };
  const metrics = new RoomLobbyRealtimeMetricsV1(sink);

  metrics.setConnected(true);
  metrics.recordPublishAttempt();
  metrics.recordPublishAttempt();
  metrics.recordPublishFailure("timed_out");
  metrics.recordInvalidationsSent(3, "remote");
  metrics.recordReconnectScheduled();

  assert.deepEqual(samples, [
    {
      operation: "set",
      name: "room_lobby_realtime_connected",
      labels: { transport: "supabase" },
      value: 1,
    },
    {
      operation: "increment",
      name: "room_lobby_realtime_publish_total",
      labels: { transport: "supabase" },
      value: 1,
    },
    {
      operation: "increment",
      name: "room_lobby_realtime_publish_total",
      labels: { transport: "supabase" },
      value: 1,
    },
    {
      operation: "increment",
      name: "room_lobby_realtime_publish_failure_total",
      labels: { transport: "supabase", failure: "timed_out" },
      value: 1,
    },
    {
      operation: "increment",
      name: "room_lobby_socket_invalidations_sent_total",
      labels: { source: "remote" },
      value: 3,
    },
    {
      operation: "increment",
      name: "room_lobby_realtime_reconnect_total",
      labels: { transport: "supabase" },
      value: 1,
    },
  ]);
  assert.equal(
    metrics.readForTest(
      "room_lobby_realtime_publish_total",
      { transport: "supabase" },
    ),
    2,
  );
});

test("metric labels stay low-cardinality and exclude room, user, event, and credential data", () => {
  const labels: Array<Readonly<Record<string, string>>> = [];
  const metrics = new RoomLobbyRealtimeMetricsV1({
    increment(_name, sampleLabels = {}) {
      labels.push({ ...sampleLabels });
    },
    set(_name, sampleLabels) {
      labels.push({ ...sampleLabels });
    },
  });

  metrics.setConnected(false);
  metrics.recordPublishFailure("transport_error");
  metrics.recordInvalidationsSent(1, "local");
  metrics.recordRejectedInbound();
  metrics.recordForwardFailure();

  for (const sample of labels) {
    assert.equal("roomId" in sample, false);
    assert.equal("userId" in sample, false);
    assert.equal("eventId" in sample, false);
    assert.equal("email" in sample, false);
    assert.equal("key" in sample, false);
  }
});
