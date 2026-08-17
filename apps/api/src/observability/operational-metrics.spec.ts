import assert from "node:assert/strict";
import test from "node:test";
import { operationalMetrics } from "./operational-metrics";

test("Prometheus metrics keep business charges separate from provider attempts", () => {
  operationalMetrics.resetForTests();
  operationalMetrics.charge({
    type: "PLAYER_ACTION",
    actionClass: "CUSTOM_ACTION",
    status: "COMMITTED",
    policy: "active_action_v1",
    walletAmount: 2
  });
  operationalMetrics.providerAttempt({
    engine: "solo_story_v2",
    batchType: "SOLO_TURN",
    result: "success",
    inputTokens: 100,
    outputTokens: 40
  });
  const rendered = operationalMetrics.renderPrometheus();
  assert.match(rendered, /credit_charge_total\{type="PLAYER_ACTION",class="CUSTOM_ACTION",status="COMMITTED",policy="active_action_v1"\} 1/);
  assert.match(rendered, /credit_charge_amount_total\{type="PLAYER_ACTION",class="CUSTOM_ACTION",status="COMMITTED",source="PERSONAL_WALLET"\} 2/);
  assert.match(rendered, /ai_provider_attempt_total\{engine="solo_story_v2",batch_type="SOLO_TURN",result="success"\} 1/);
  assert.match(rendered, /ai_provider_tokens_total\{engine="solo_story_v2",batch_type="SOLO_TURN",token_type="input"\} 100/);
});

test("operational metrics expose rolling room p95, pool capacity, and timeout counters", () => {
  operationalMetrics.resetForTests();
  for (const value of [10, 20, 30, 40, 100]) {
    operationalMetrics.observeP95("room_api_latency_ms_p95", { operation: "list", status: "200" }, value);
  }
  operationalMetrics.set("prisma_pool_connection_limit", { process_role: "api" }, 5);
  operationalMetrics.increment("prisma_pool_timeout_total", { code: "P2024", operation: "list" });
  const rendered = operationalMetrics.renderPrometheus();
  assert.match(rendered, /room_api_latency_ms_p95\{operation="list",status="200"\} 100/);
  assert.match(rendered, /prisma_pool_connection_limit\{process_role="api"\} 5/);
  assert.match(rendered, /prisma_pool_timeout_total\{code="P2024",operation="list"\} 1/);
});

test("RoomLobby Realtime metrics use bounded labels and correct Prometheus kinds", () => {
  operationalMetrics.resetForTests();
  operationalMetrics.set("room_lobby_realtime_connected", { transport: "supabase" }, 1);
  operationalMetrics.increment("room_lobby_realtime_publish_total", { transport: "supabase" });
  operationalMetrics.increment("room_lobby_realtime_publish_failure_total", { transport: "supabase", failure: "timed_out" });
  operationalMetrics.increment("room_lobby_realtime_reconnect_total", { transport: "supabase" });
  operationalMetrics.increment("room_lobby_realtime_inbound_rejected_total", { reason: "contract_invalid" });
  operationalMetrics.increment("room_lobby_realtime_forward_failure_total", { transport: "websocket" });
  operationalMetrics.increment("room_lobby_socket_invalidations_sent_total", { source: "remote" }, 2);

  const rendered = operationalMetrics.renderPrometheus();
  assert.match(rendered, /# TYPE room_lobby_realtime_connected gauge/);
  assert.match(rendered, /room_lobby_realtime_connected\{transport="supabase"\} 1/);
  assert.match(rendered, /# TYPE room_lobby_realtime_publish_total counter/);
  assert.match(rendered, /room_lobby_realtime_publish_total\{transport="supabase"\} 1/);
  assert.match(rendered, /room_lobby_realtime_publish_failure_total\{transport="supabase",failure="timed_out"\} 1/);
  assert.match(rendered, /room_lobby_realtime_reconnect_total\{transport="supabase"\} 1/);
  assert.match(rendered, /room_lobby_realtime_inbound_rejected_total\{reason="contract_invalid"\} 1/);
  assert.match(rendered, /room_lobby_realtime_forward_failure_total\{transport="websocket"\} 1/);
  assert.match(rendered, /room_lobby_socket_invalidations_sent_total\{source="remote"\} 2/);
  assert.doesNotMatch(rendered, /room[_-]?id=|user[_-]?id=|event[_-]?id=|email=|service[_-]?role/i);
});
