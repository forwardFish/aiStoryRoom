import assert from "node:assert/strict";
import test from "node:test";
import { MvpStoryEngine } from "./mvp-causal-runtime";
import { installFourManeuverRuntime } from "./mvp-four-maneuver-runtime";
import { installFourManeuverResolution } from "./mvp-four-maneuver-resolution";
import type { MvpView } from "./mvp-types";

installFourManeuverRuntime();
installFourManeuverResolution();

function view(sceneKey = "d4_1"): MvpView {
  return {
    run: { id: "run-ai", storyId: "sangtian", templateKey: "sangtian", mode: "single", selectedRoleKey: "zhejiang_governor", title: "桑田诏", location: "杭州", currentDay: 4, currentTime: "清晨", totalDays: 7, status: "awaiting_decision", version: 3, decisionsCompletedToday: 0, decisionsRequiredToday: 2, totalDecisionsCompleted: 6, totalDecisionsRequired: 12, createdAt: "2026-08-06T00:00:00.000Z", updatedAt: "2026-08-06T00:00:00.000Z" },
    player: { leverage: ["田契暗账（半页）", "清流县令密信", "巡抚与商会旧约传闻"] },
    messages: [],
    activeDecision: { messageId: "m-1", decisionKey: sceneKey, day: 4, index: 0, title: "如何使用暗账", help: "", reactionRoleKey: "county_magistrate", options: [] },
    dashboard: { worldState: [["皇帝信任", 45]], roleState: {}, traces: [] }, decisionHistory: [], events: [], causalLedger: { fateSeeds: [], evidenceLedger: [], responsibilityLedger: [], narrativeFrames: [], finalJudgementInputs: [] }, daySummary: null, daySummaries: {}, finalJudgement: null, outcome: null,
    runtime: { schemaVersion: "test", narrativeProvider: "rules", fallbackUsed: true, aiBudget: { maxCalls: 20, maxTotalTokens: 100000, costLimitMinor: null, calls: 0, totalTokens: 0, totalCostMinor: 0, exhausted: false, lastFallbackReason: null } },
    maneuverState: { maneuverOpportunitiesPerDay: 2, maneuversUsedToday: 0, maneuverOpportunitiesRemaining: 2, totalManeuversUsed: 0, usedLeverageKeys: [] } as any
  };
}

class Storage {
  current: MvpView;
  aiTasks: any[] = [];
  constructor(initial: MvpView) { this.current = structuredClone(initial); }
  async load() { return structuredClone(this.current); }
  async save(next: MvpView, expectedVersion: number) { assert.equal(this.current.run.version, expectedVersion); this.current = structuredClone(next); }
  async recordAiTask(task: any) { this.aiTasks.push(structuredClone(task)); }
}

function provider({ fail = false } = {}) {
  const state = { calls: 0 };
  const instance: any = {
    name: "fake-maneuver-provider",
    lastCall: { attempts: 1, elapsedMs: 3, maxAttempts: 1, inputTokens: 80, outputTokens: 40 },
    async generateDecisionCandidate() { return {}; },
    async generateManeuverCandidate() {
      state.calls += 1;
      if (fail) throw new Error("injected maneuver provider failure");
      return { title: "对方终于回应", narrative: "对方沉默片刻，给出了一句带条件的答复。", replyText: "我可以回答，但你也要承担后果。", statePatch: { "皇帝信任": 99 } };
    }
  };
  return { instance, state };
}

test("contact uses exactly one AI call while rule state remains authoritative", async () => {
  const storage = new Storage(view("d4_1"));
  const fake = provider();
  const engine: any = new MvpStoryEngine(storage as any, fake.instance);
  const result: any = await engine.submitManeuver("run-ai", { version: 3, idempotencyKey: "ai-contact", maneuverType: "contact", targetRoleKey: "county_magistrate", messageText: "原始底册是否完整？" });
  assert.equal(fake.state.calls, 1);
  assert.match(result.messages.at(-1).body, /带条件的答复/);
  assert.equal(result.dashboard.worldState.find((item: any[]) => item[0] === "皇帝信任")[1], 45);
  assert.equal(storage.aiTasks.length, 1);
  assert.equal(storage.aiTasks[0].status, "completed");
});

test("fixed investigation remains zero AI", async () => {
  const storage = new Storage(view("d4_1"));
  const fake = provider();
  const engine: any = new MvpStoryEngine(storage as any, fake.instance);
  const result: any = await engine.submitManeuver("run-ai", { version: 3, idempotencyKey: "ai-investigate", maneuverType: "investigate", intentKey: "inspect_land_register_binding" });
  assert.equal(fake.state.calls, 0);
  assert.match(result.messages.at(-1).body, /重新装订/);
  assert.equal(storage.aiTasks.length, 0);
});

test("AI_REACTION leverage calls once and always records card consumption", async () => {
  const storage = new Storage(view("d4_1"));
  const fake = provider();
  const engine: any = new MvpStoryEngine(storage as any, fake.instance);
  const result: any = await engine.submitManeuver("run-ai", { version: 3, idempotencyKey: "ai-leverage", maneuverType: "leverage", leverageKey: "land_contract_fragment", targetRoleKey: "merchant" });
  assert.equal(fake.state.calls, 1);
  assert.match(result.messages.at(-1).body, /筹码已消耗：田契暗账/);
  assert.ok(result.maneuverState.usedLeverageKeys.includes("land_contract_fragment"));
});

test("provider failure falls back without consuming a second call", async () => {
  const storage = new Storage(view("d4_1"));
  const fake = provider({ fail: true });
  const engine: any = new MvpStoryEngine(storage as any, fake.instance);
  const result: any = await engine.submitManeuver("run-ai", { version: 3, idempotencyKey: "ai-fallback", maneuverType: "contact", targetRoleKey: "county_magistrate", messageText: "你是否保留了抄件？" });
  assert.equal(fake.state.calls, 1);
  assert.match(result.messages.at(-1).body, /卢象升/);
  assert.equal(storage.aiTasks[0].status, "fallback");
  assert.equal(result.maneuverState.maneuverOpportunitiesRemaining, 1);
});

test("budget rejection performs zero provider calls and keeps deterministic fallback", async () => {
  const initial = view("d4_1");
  initial.runtime.aiBudget.calls = initial.runtime.aiBudget.maxCalls;
  const storage = new Storage(initial);
  const fake = provider();
  const engine: any = new MvpStoryEngine(storage as any, fake.instance);
  const result: any = await engine.submitManeuver("run-ai", { version: 3, idempotencyKey: "ai-budget", maneuverType: "contact", targetRoleKey: "county_magistrate", messageText: "原始底册是否完整？" });
  assert.equal(fake.state.calls, 0);
  assert.equal(result.runtime.aiBudget.exhausted, true);
  assert.equal(storage.aiTasks[0].status, "fallback");
});
