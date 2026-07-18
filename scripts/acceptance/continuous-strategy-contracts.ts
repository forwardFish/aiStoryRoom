import assert from "node:assert/strict";
import {
  canApplyGameProjection,
  validateEventDeliveryPageV1,
  validateRoleAgentDecisionV1,
  type GameProjectionV1
} from "../../packages/shared/src";

const decisionContext = {
  taskDedupeKey: "AI_TAKEOVER:w1:r1:MAIN:2",
  slot: "MAIN" as const,
  availableActionKeys: ["main_keep_evidence"],
  authorizedTargetRoleIds: ["r2"],
  ownedLeverageKeys: ["sealed_channel"],
  visibleFactIds: ["fact-visible"]
};

assert.equal(validateRoleAgentDecisionV1({
  schemaVersion: "role_agent_decision_v1",
  taskDedupeKey: decisionContext.taskDedupeKey,
  decisionKind: "ACT",
  chosenActionKey: "main_keep_evidence",
  targetRoleId: "r2",
  leverageKey: "sealed_channel",
  visibleFactIds: ["fact-visible"],
  shortRationale: "保留证据，避免提前暴露底牌。"
}, decisionContext).ok, true);

assert.equal(validateRoleAgentDecisionV1({
  schemaVersion: "role_agent_decision_v1",
  taskDedupeKey: decisionContext.taskDedupeKey,
  decisionKind: "PASS",
  chosenActionKey: null,
  targetRoleId: null,
  leverageKey: null,
  visibleFactIds: [],
  shortRationale: "pass"
}, decisionContext).ok, false, "MAIN may not PASS");

assert.equal(validateEventDeliveryPageV1({
  schemaVersion: "continuous_event_delivery_page_v1",
  deliveries: [
    { deliverySequence: 4, eventId: "e4", eventType: "PUBLIC_RESULT", payload: {}, createdAt: new Date().toISOString() },
    { deliverySequence: 5, eventId: "e5", eventType: "PRIVATE_RESULT", payload: {}, createdAt: new Date().toISOString() }
  ],
  nextAfterDeliverySequence: 5,
  hasMore: false
}, 3).ok, true);

assert.equal(validateEventDeliveryPageV1({
  schemaVersion: "continuous_event_delivery_page_v1",
  deliveries: [{ deliverySequence: 5, eventId: "e5", eventType: "X", payload: {}, createdAt: "now" }],
  nextAfterDeliverySequence: 5,
  hasMore: false
}, 3).ok, false, "member delivery sequence must be dense");

assert.equal(canApplyGameProjection(
  { projectionRevision: 4, appliedThroughDeliverySequence: 8 },
  { projectionRevision: 5, appliedThroughDeliverySequence: 7 }
), false, "projection cannot roll back its cursor");

assert.equal(canApplyGameProjection(
  { projectionRevision: 4, appliedThroughDeliverySequence: 8 },
  { projectionRevision: 5, appliedThroughDeliverySequence: 9 }
), true);

void ({} as GameProjectionV1);
console.log("continuous-strategy shared contracts: PASS");
