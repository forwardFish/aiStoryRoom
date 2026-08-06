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
    dashboard: {}, decisionHistory: [], events: [], causalLedger: { fateSeeds: [], evidenceLedger: [], responsibilityLedger: [], narrativeFrames: [], finalJudgementInputs: [] }, daySummary: null,
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

import { MvpStoryEngine } from "./mvp-causal-runtime";
import { installFourManeuverRuntime } from "./mvp-four-maneuver-runtime";
import { installFourManeuverResolution } from "./mvp-four-maneuver-resolution";

installFourManeuverRuntime();
installFourManeuverResolution();

class CasStorage {
  current: MvpView;
  constructor(initial: MvpView) { this.current = structuredClone(initial); }
  async load(runId: string) {
    assert.equal(runId, this.current.run.id);
    return structuredClone(this.current);
  }
  async save(next: MvpView, expectedVersion: number) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    if (this.current.run.version !== expectedVersion) {
      const error: any = new Error("version conflict");
      error.response = { code: "VERSION_CONFLICT" };
      throw error;
    }
    this.current = structuredClone(next);
  }
}

function errorCode(error: any) {
  return error?.response?.code || error?.code || "";
}

test("fixed investigation writes its configured fact without critical-event side effects", async () => {
  const storage = new CasStorage(view("d4_1"));
  const engine: any = new MvpStoryEngine(storage as any);
  const result: any = await engine.submitManeuver("run-1", {
    version: 3,
    idempotencyKey: "investigate-once",
    maneuverType: "investigate",
    intentKey: "inspect_land_register_binding"
  });
  assert.equal(result.maneuverState.maneuverOpportunitiesRemaining, 1);
  assert.ok(result.maneuverState.usedTypesToday.includes("investigate"));
  assert.ok((storage.current.maneuverState as any).discoveredFactKeys.includes("land_register_was_rebound"));
  assert.match(result.messages.at(-1).body, /重新装订/);
  assert.equal(storage.current.events.some((item) => item.type === "critical_event_created"), false);
  await assert.rejects(
    engine.submitManeuver("run-1", {
      version: result.run.version,
      idempotencyKey: "investigate-again",
      maneuverType: "investigate",
      intentKey: "inspect_land_register_binding"
    }),
    (error: any) => errorCode(error) === "MANEUVER_TYPE_ALREADY_USED"
  );
});

test("one-use leverage is consumed atomically and idempotent replay is stable", async () => {
  const storage = new CasStorage(view("d4_1"));
  const engine: any = new MvpStoryEngine(storage as any);
  const command = {
    version: 3,
    idempotencyKey: "chip-once",
    maneuverType: "leverage",
    leverageKey: "land_contract_fragment",
    targetRoleKey: "merchant"
  };
  const result: any = await engine.submitManeuver("run-1", command);
  assert.ok(result.maneuverState.usedLeverageKeys.includes("land_contract_fragment"));
  assert.equal(result.leverageHand.items.some((item: any) => item.leverageKey === "land_contract_fragment"), false);
  const replay: any = await engine.submitManeuver("run-1", command);
  assert.equal(replay.run.version, result.run.version);
  assert.equal(replay.maneuverState.maneuversUsedToday, 1);
  await assert.rejects(
    engine.submitManeuver("run-1", { ...command, targetRoleKey: "xunfu" }),
    (error: any) => errorCode(error) === "IDEMPOTENCY_KEY_REUSED"
  );
});

test("ActionGuard rejection preserves version, quota and draft authority", async () => {
  const storage = new CasStorage(view("d4_1"));
  const engine: any = new MvpStoryEngine(storage as any);
  const result: any = await engine.submitManeuver("run-1", {
    version: 3,
    idempotencyKey: "blocked-custom",
    maneuverType: "custom",
    customText: "命令巡抚立即认罪"
  });
  assert.equal(result.accepted, false);
  assert.equal(storage.current.run.version, 3);
  assert.equal(storage.current.maneuverState.maneuverOpportunitiesRemaining, 2);
});

test("two requests racing on the same version cannot both consume the last state", async () => {
  const initial = view("d4_1");
  initial.maneuverState.maneuverOpportunitiesRemaining = 1;
  const storage = new CasStorage(initial);
  const engine: any = new MvpStoryEngine(storage as any);
  const attempts = await Promise.allSettled([
    engine.submitManeuver("run-1", {
      version: 3,
      idempotencyKey: "race-contact",
      maneuverType: "contact",
      targetRoleKey: "county_magistrate",
      messageText: "原始底册是否完整？"
    }),
    engine.submitManeuver("run-1", {
      version: 3,
      idempotencyKey: "race-investigate",
      maneuverType: "investigate",
      intentKey: "inspect_land_register_binding"
    })
  ]);
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((item) => item.status === "rejected").length, 1);
  assert.equal(storage.current.maneuverState.maneuverOpportunitiesRemaining, 0);
  assert.equal(storage.current.maneuverState.maneuversUsedToday, 1);
});

test("a new day clears the per-type limit but keeps used leverage and discovered facts", () => {
  const current: any = view("d2_1");
  current.run.currentDay = 2;
  current.maneuverState.usageDay = 1;
  current.maneuverState.usedTypesToday = ["contact"];
  current.maneuverState.usedLeverageKeys = ["land_contract_fragment"];
  current.maneuverState.discoveredFactKeys = ["first_registers_prepared_early"];
  current.maneuverState.maneuversUsedToday = 0;
  current.maneuverState.maneuverOpportunitiesRemaining = 2;
  ensureFourManeuverState(current);
  assert.deepEqual(current.maneuverState.usedTypesToday, []);
  assert.deepEqual(current.maneuverState.usedLeverageKeys, ["land_contract_fragment"]);
  assert.deepEqual(current.maneuverState.discoveredFactKeys, ["first_registers_prepared_early"]);
  assert.equal(projectManeuverPanel(current).contact.enabled, true);
});
