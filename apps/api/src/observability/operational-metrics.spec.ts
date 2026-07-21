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
