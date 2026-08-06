import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureFourManeuverState,
  projectLeverageHand,
  projectManeuverPanel
} from "./mvp-four-maneuver-runtime";
import type { MvpView } from "./mvp-types";

function view(sceneKey = "d4_1"): MvpView {
  return {
    run: {
      id: "run-1", storyId: "sangtian", templateKey: "sangtian", mode: "single",
      selectedRoleKey: "zhejiang_governor", title: "桑田诏", location: "杭州",
      currentDay: 4, currentTime: "清晨", totalDays: 7, status: "awaiting_decision",
      version: 3, decisionsCompletedToday: 0, decisionsRequiredToday: 2,
      totalDecisionsCompleted: 6, totalDecisionsRequired: 12,
      createdAt: "2026-08-06T00:00:00.000Z", updatedAt: "2026-08-06T00:00:00.000Z"
    },
    player: {
      leverage: ["田契暗账（半页）", "清流县令密信", "巡抚与商会旧约传闻"]
    },
    messages: [],
    activeDecision: {
      messageId: "m-1", decisionKey: sceneKey, day: 4, index: 0,
      title: "如何使用暗账", help: "", reactionRoleKey: "county_magistrate", options: []
    },
    dashboard: {}, decisionHistory: [], events: [], causalLedger: {}, daySummary: null,
    daySummaries: {}, finalJudgement: null, outcome: null,
    runtime: {
      schemaVersion: "test", narrativeProvider: "rules", fallbackUsed: true,
      aiBudget: { maxCalls: 10, maxTotalTokens: 1000, costLimitMinor: null, calls: 0, totalTokens: 0, totalCostMinor: 0, exhausted: false, lastFallbackReason: null }
    },
    maneuverState: {
      maneuverOpportunitiesPerDay: 2, maneuversUsedToday: 0,
      maneuverOpportunitiesRemaining: 2, totalManeuversUsed: 0,
      usedLeverageKeys: []
    } as any
  };
}

test("scene projection only exposes current safe options", () => {
  const panel = projectManeuverPanel(view("d4_1"));
  assert.equal(panel.sceneKey, "d4_1");
  assert.deepEqual(panel.contact.options.map((item) => item.roleKey), ["county_magistrate", "merchant"]);
  assert.deepEqual(panel.investigate.options.map((item) => item.intentKey), ["inspect_land_register_binding"]);
  assert.deepEqual(panel.leverage.options.map((item) => item.leverageKey), ["land_contract_fragment", "xunfu_merchant_old_pact_rumor"]);
  assert.equal(JSON.stringify(panel).includes("statePatch"), false);
  assert.equal(JSON.stringify(panel).includes("resultText"), false);
});

test("legacy state reconstructs type usage and leverage ownership", () => {
  const legacy: any = view("d2_1");
  delete legacy.maneuverState.usedTypesToday;
  delete legacy.maneuverState.discoveredFactKeys;
  delete legacy.player.leverageKeys;
  legacy.events.push({ id: "e1", type: "maneuver", payload: { day: 2, maneuverType: "contact" }, createdAt: "2026-08-06T00:00:00.000Z" });
  legacy.run.currentDay = 2;
  ensureFourManeuverState(legacy);
  assert.deepEqual(legacy.maneuverState.usedTypesToday, ["contact"]);
  assert.deepEqual(legacy.player.leverageKeys, ["land_contract_fragment", "county_letter", "xunfu_merchant_old_pact_rumor"]);
});

test("used leverage disappears from hand and scene projection", () => {
  const current = view("d4_1");
  current.maneuverState.usedLeverageKeys = ["land_contract_fragment"];
  assert.deepEqual(projectLeverageHand(current).items.map((item) => item.leverageKey), ["county_letter", "xunfu_merchant_old_pact_rumor"]);
  assert.deepEqual(projectManeuverPanel(current).leverage.options.map((item) => item.leverageKey), ["xunfu_merchant_old_pact_rumor"]);
});

test("day end closes every maneuver without leaking stale quota", () => {
  const current = view("d4_1");
  current.run.status = "awaiting_day_advance";
  current.activeDecision = null;
  const panel = projectManeuverPanel(current);
  assert.equal(panel.enabled, false);
  assert.equal(panel.quota.remaining, 0);
  assert.equal(panel.contact.enabled, false);
  assert.equal(panel.custom.enabled, false);
});


test("a new day clears per-type usage while preserving durable facts", () => {
  const current: any = view("d4_1");
  current.maneuverState.usageDay = 3;
  current.maneuverState.usedTypesToday = ["contact"];
  current.maneuverState.discoveredFactKeys = ["prior_fact"];
  current.run.currentDay = 4;
  ensureFourManeuverState(current);
  assert.deepEqual(current.maneuverState.usedTypesToday, []);
  assert.equal(current.maneuverState.maneuverOpportunitiesRemaining, 2);
  assert.deepEqual(current.maneuverState.discoveredFactKeys, ["prior_fact"]);
});
