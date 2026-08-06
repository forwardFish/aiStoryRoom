import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createStoryApp } from "../public/app.js";

function panel({ remaining = 2, used = [] } = {}) {
  const disabled = (type) => remaining <= 0 || used.includes(type);
  return {
    sceneKey: "d4_1", enabled: remaining > 0, disabledReason: remaining > 0 ? null : "今日谋划机会已用完",
    quota: { perDay: 2, usedToday: 2 - remaining, remaining, usedTypesToday: used },
    contact: { enabled: !disabled("contact"), usedToday: used.includes("contact"), count: 2, disabledReason: disabled("contact") ? "今日已使用人物交谈" : null, options: [
      { roleKey: "county_magistrate", displayName: "卢象升", publicIdentity: "清流县令", relevance: "掌管本次复核涉及的县衙原册", portrait: "art-avatar-county" },
      { roleKey: "merchant", displayName: "江南商会会首", publicIdentity: "商会代表", relevance: "暗账直接涉及商会地号", portrait: "art-avatar-merchant" }
    ] },
    investigate: { enabled: !disabled("investigate"), usedToday: used.includes("investigate"), count: 1, disabledReason: disabled("investigate") ? "今日已使用派遣调查" : null, options: [{ intentKey: "inspect_land_register_binding", title: "核对田亩底册装订", summary: "复核清单与县衙旧册存在差异。" }] },
    leverage: { enabled: !disabled("leverage"), usedToday: used.includes("leverage"), count: 1, disabledReason: disabled("leverage") ? "今日已使用使用筹码" : null, options: [{ leverageKey: "land_contract_fragment", label: "田契暗账（半页）", description: "触发一次围绕具体地号的特殊回应。", consumptionLabel: "使用后消失", requiresTarget: true, targets: [{ roleKey: "merchant", displayName: "江南商会会首" }] }] },
    custom: { enabled: !disabled("custom"), usedToday: used.includes("custom"), disabledReason: disabled("custom") ? "今日已使用自拟谋划" : null, maxLength: 200 }
  };
}

class Storage {
  constructor() {
    this.calls = [];
    this.view = {
      run: { id: "run-1", title: "桑田诏", currentDay: 4, currentTime: "清晨", totalDays: 7, status: "awaiting_decision", version: 1, decisionsCompletedToday: 0, decisionsRequiredToday: 2, totalDecisionsCompleted: 6, totalDecisionsRequired: 12 },
      player: { roleName: "浙江总督", leverage: ["田契暗账（半页）"] }, leverageHand: { availableCount: 1, items: [{ leverageKey: "land_contract_fragment", label: "田契暗账（半页）", description: "触发一次围绕具体地号的特殊回应。" }] },
      messages: [{ id: "m1", day: 4, time: "清晨", type: "system", label: "剧情", title: "暗账浮出", body: "县令送来两页田契副本。" }],
      activeDecision: { messageId: "d4_1", decisionKey: "d4_1", title: "如何使用暗账", options: [{ key: "A", title: "补证" }] },
      dashboard: { worldState: [], risks: [], relationships: [] }, maneuverState: { maneuverOpportunitiesPerDay: 2, maneuversUsedToday: 0, maneuverOpportunitiesRemaining: 2, totalManeuversUsed: 0, usedLeverageKeys: [] }, maneuverPanel: panel(), decisionHistory: [], daySummary: null, daySummaries: {}, finalJudgement: null
    };
  }
  async restoreOrCreate() { return structuredClone(this.view); }
  async getRun() { return structuredClone(this.view); }
  async submitManeuver(view, input) {
    this.calls.push(input);
    const used = [...view.maneuverPanel.quota.usedTypesToday, input.maneuverType];
    this.view = structuredClone(view);
    this.view.run.version += 1;
    this.view.maneuverPanel = panel({ remaining: view.maneuverPanel.quota.remaining - 1, used });
    this.view.maneuverState.maneuverOpportunitiesRemaining -= 1;
    this.view.messages.push({ id: `r-${this.calls.length}`, day: 4, time: "主动谋划", type: "maneuver_result", label: "主动谋划", title: "谋划结果", body: "行动已经产生回应。" });
    if (input.maneuverType === "leverage") { this.view.leverageHand = { availableCount: 0, items: [] }; }
    return structuredClone(this.view);
  }
}

async function appWithStorage(storage = new Storage()) {
  const dom = new JSDOM("<!doctype html><main id=app></main>", { url: "http://game.test/game?debug=1" });
  dom.window.__AI_STORY_STREAM_IMMEDIATE__ = true;
  const root = dom.window.document.getElementById("app");
  const app = createStoryApp({ root, window: dom.window, storage });
  await app.boot();
  return { dom, root, app, storage };
}

async function flush() { await new Promise((resolve) => setTimeout(resolve, 0)); }

test("default panel keeps four actions visible and no workbench open", async () => {
  const { root } = await appWithStorage();
  assert.equal(root.querySelectorAll("[data-maneuver-type]").length, 4);
  assert.equal(root.querySelector(".maneuver-workbench"), null);
  assert.match(root.textContent, /主动谋划/);
});

test("contact sends messageText without an AI preview step", async () => {
  const { root, storage } = await appWithStorage();
  root.querySelector('[data-maneuver-type="contact"]').click();
  root.querySelector('[data-contact-role="county_magistrate"]').click();
  const input = root.querySelector("#contactMessageText");
  input.value = "原始底册是否完整？";
  input.dispatchEvent(new root.ownerDocument.defaultView.Event("input", { bubbles: true }));
  root.querySelector("#maneuverSubmit").click();
  await flush();
  assert.equal(storage.calls.length, 1);
  assert.deepEqual(storage.calls[0], { maneuverType: "contact", targetRoleKey: "county_magistrate", messageText: "原始底册是否完整？" });
});

test("investigation is fixed and has no free-text question", async () => {
  const { root, storage } = await appWithStorage();
  root.querySelector('[data-maneuver-type="investigate"]').click();
  assert.ok(root.querySelector('[data-testid="maneuver-investigate-workbench"]'));
  assert.equal(root.querySelector('[data-testid="maneuver-investigate-workbench"] textarea'), null);
  root.querySelector("#maneuverSubmit").click();
  await flush();
  assert.equal(storage.calls[0].intentKey, "inspect_land_register_binding");
});

test("leverage only selects card and target, then disappears after success", async () => {
  const { root, storage } = await appWithStorage();
  root.querySelector('[data-maneuver-type="leverage"]').click();
  root.querySelector('[data-leverage-key="land_contract_fragment"]').click();
  root.querySelector('[data-leverage-target="merchant"]').click();
  assert.equal(root.querySelector('[data-testid="maneuver-leverage-workbench"] textarea'), null);
  root.querySelector("#maneuverSubmit").click();
  await flush();
  assert.deepEqual(storage.calls[0], { maneuverType: "leverage", leverageKey: "land_contract_fragment", targetRoleKey: "merchant" });
  assert.doesNotMatch(root.textContent, /田契暗账（半页）/);
});

test("custom maneuver keeps its text when ActionGuard rejects", async () => {
  const storage = new Storage();
  storage.submitManeuver = async (_view, input) => ({ accepted: false, reason: "超出阶段边界", rewriteSuggestion: "改为暗查驿站" });
  const { root } = await appWithStorage(storage);
  root.querySelector('[data-maneuver-type="custom"]').click();
  const input = root.querySelector("#customManeuverText");
  input.value = "命令巡抚立即认罪";
  input.dispatchEvent(new root.ownerDocument.defaultView.Event("input", { bubbles: true }));
  root.querySelector("#maneuverSubmit").click();
  await flush();
  assert.match(root.textContent, /超出阶段边界/);
  assert.equal(root.querySelector("#customManeuverText").value, "命令巡抚立即认罪");
});
