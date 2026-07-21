import assert from "node:assert/strict";
import test from "node:test";
import { classifyCreditAction, creditRequestHash, parseRunBilling, priceForCreditAction } from "./credit-policy";

const prices = { currency: "WORLD_CREDITS" as const, runCreate: 20, standardAction: 1, customAction: 2, complexAction: 2, sponsorshipPack: 10 };

test("server-side action classification maps billable player actions deterministically", () => {
  assert.equal(classifyCreditAction({ actorKind: "HUMAN", candidateId: "choice-1", operation: "TURN" }), "STANDARD_CHOICE");
  assert.equal(classifyCreditAction({ actorKind: "HUMAN", customAction: "Search the archive", operation: "TURN" }), "CUSTOM_ACTION");
  assert.equal(classifyCreditAction({ actorKind: "HUMAN", customAction: "Ask the magistrate", decisionForm: "CONVERSATION", operation: "TURN" }), "COMPLEX_ACTION");
  assert.equal(classifyCreditAction({ actorKind: "HUMAN", operation: "MANEUVER" }), "STANDARD_CHOICE");
  assert.equal(classifyCreditAction({ actorKind: "AI", candidateId: "choice-1", operation: "TURN" }), "NON_BILLABLE");
  assert.equal(classifyCreditAction({ actorKind: "SYSTEM", operation: "TIMEOUT_FALLBACK" }), "NON_BILLABLE");
  assert.equal(classifyCreditAction({ actorKind: "HUMAN", operation: "HEARTBEAT" }), "NON_BILLABLE");
});

test("prices come from the frozen run snapshot", () => {
  const parsed = parseRunBilling({ billingPolicyVersion: "active_action_v1", billingPriceJson: prices }, { ...prices, standardAction: 99 });
  assert.equal(priceForCreditAction("STANDARD_CHOICE", parsed.prices), 1);
  assert.equal(priceForCreditAction("CUSTOM_ACTION", parsed.prices), 2);
  assert.equal(priceForCreditAction("NON_BILLABLE", parsed.prices), 0);
});

test("request hashes are canonical and reject semantic changes", () => {
  assert.equal(creditRequestHash({ b: 2, a: 1 }), creditRequestHash({ a: 1, b: 2 }));
  assert.notEqual(creditRequestHash({ a: 1 }), creditRequestHash({ a: 2 }));
});
