import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createStoryApp } from "../public/app.js";

test("主游戏右栏可以执行主动谋划并把结果写回同一消息流", async () => {
  const dom = new JSDOM("<!doctype html><main id=app></main>", { url: "http://game.test/game" });
  const storage = new ManeuverStorage();
  const root = dom.window.document.getElementById("app");
  const app = createStoryApp({ root, window: dom.window, storage });

  await app.boot();
  assert.ok(root.querySelector('[data-testid="maneuver-panel"]'));
  assert.match(root.textContent, /今日谋划2 \/ 2/);
  assert.ok(root.querySelector('[data-testid="maneuver-custom-workbench"]'));
  assert.equal(root.querySelector('[data-testid="maneuver-contact-workbench"]'), null);
  assert.equal(root.querySelector('[data-testid="maneuver-leverage-workbench"]'), null);

  root.querySelector('[data-maneuver-type="contact"]').click();
  assert.equal(storage.calls.filter((item) => item.kind === "maneuver").length, 0);
  assert.ok(root.querySelector('[data-testid="maneuver-contact-workbench"]'));
  assert.equal(root.querySelector('[data-testid="maneuver-leverage-workbench"]'), null);

  root.querySelector('[data-maneuver-contact="county_magistrate"]').click();
  assert.equal(storage.calls.filter((item) => item.kind === "maneuver").length, 0, "selecting a person must not submit an action for the player");
  const contactIntent = root.querySelector("#maneuverCustomText");
  contactIntent.value = "Ask when the sealed copy arrived and who handled it.";
  contactIntent.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await app.submitManeuver();
  assert.equal(storage.calls.filter((item) => item.kind === "maneuver").length, 1);
  assert.equal(app.getState().resultStream.kind, "maneuver");
  assert.match(app.getState().resultStream.title, /私下接触了清流县令/);
  assert.match(app.getState().resultStream.text, /可核验线索/);
  assert.ok(root.querySelector('[data-testid="result-narrative"]'));
  assert.equal(root.querySelector('[data-testid="decision-zone"]'), null);
  assert.equal(storage.calls.filter((item) => item.kind === "maneuver").length, 1);

  root.querySelector('[data-maneuver-type="investigate"]').click();
  assert.equal(storage.calls.filter((item) => item.kind === "maneuver").length, 1);
  assert.ok(root.querySelector('[data-testid="maneuver-investigate-workbench"]'));
  assert.equal(root.querySelector('[data-testid="maneuver-contact-workbench"]'), null);

  root.querySelector('[data-maneuver-type="leverage"]').click();
  assert.equal(storage.calls.filter((item) => item.kind === "maneuver").length, 1);
  assert.ok(root.querySelector('[data-testid="maneuver-leverage-workbench"]'));
  assert.equal(root.querySelector('[data-testid="maneuver-contact-workbench"]'), null);
  const leverageChoice = root.querySelector('[data-maneuver-leverage]');
  leverageChoice.click();
  assert.equal(storage.calls.filter((item) => item.kind === "maneuver").length, 1, "selecting leverage must wait for a concrete demand");
  const leverageIntent = root.querySelector("#maneuverCustomText");
  leverageIntent.value = "Show the fragment and demand the matching ledger page.";
  leverageIntent.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await app.submitManeuver();
  assert.equal(storage.calls.filter((item) => item.kind === "maneuver").length, 2);
  assert.equal(storage.calls.filter((item) => item.kind === "maneuver").at(-1).input.maneuverType, "leverage");
  assert.equal(storage.calls.filter((item) => item.kind === "maneuver").at(-1).input.leverageKey, leverageChoice.dataset.maneuverLeverage);

  app.chooseManeuver("custom", "");
  const textarea = root.querySelector("#maneuverCustomText");
  textarea.value = "命令巡抚立即认罪";
  textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await app.submitManeuver();
  assert.ok(root.querySelector('[data-testid="maneuver-guard"]'));
  assert.match(root.textContent, /不能执行/);
  assert.match(root.textContent, /谋划0 \/ 2/);
});

test("派遣调查只在选择该类型后展示，并携带明确调查方向执行", async () => {
  const dom = new JSDOM("<!doctype html><main id=app></main>", { url: "http://game.test/game" });
  const storage = new ManeuverStorage();
  const root = dom.window.document.getElementById("app");
  const app = createStoryApp({ root, window: dom.window, storage });

  await app.boot();
  root.querySelector('[data-maneuver-type="investigate"]').click();
  assert.ok(root.querySelector('[data-testid="maneuver-investigate-workbench"]'));
  assert.equal(root.querySelector('[data-testid="maneuver-contact-workbench"]'), null);
  const investigationChoice = root.querySelector('[data-maneuver-investigation]');
  investigationChoice.click();
  assert.equal(storage.calls.filter((item) => item.kind === "maneuver").length, 0, "selecting an inquiry must not execute it automatically");
  await app.submitManeuver();
  assert.equal(storage.calls.filter((item) => item.kind === "maneuver").length, 1);
  assert.equal(storage.calls.at(-1).input.maneuverType, "investigate");
  assert.equal(storage.calls.at(-1).input.intentKey, investigationChoice.dataset.maneuverInvestigation);
});

async function waitFor(predicate, timeout = 1000) {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(predicate(), "expected asynchronous action to complete");
}

class ManeuverStorage {
  constructor() {
    this.calls = [];
    this.view = {
      run: { id: "run-1", title: "桑田诏", location: "杭州总督府", currentDay: 3, currentTime: "午后", totalDays: 7, status: "awaiting_decision", version: 1, decisionsCompletedToday: 0, decisionsRequiredToday: 2, totalDecisionsCompleted: 4, totalDecisionsRequired: 12 },
      player: { roleName: "浙江总督", name: "郝帅彬", rank: "从四品", office: "兵部侍郎衔", fateQuestion: "保浙江，还是保自己？", goals: ["稳定浙江局势"], resources: [["银两", "42万两"]], leverage: ["半页田契暗账"] },
      messages: [{ id: "msg-1", day: 3, time: "午后", type: "system", label: "系统", title: "粮价三日连涨", body: "粮路出现压力。" }],
      activeDecision: { messageId: "decision-1", title: "如何应对眼前压力", help: "选择策略。", options: [{ key: "A", title: "截留奏疏", body: "阻止巡抚抢功。", gain: "保留解释权", risk: "巡抚反咬" }] },
      dashboard: { worldState: [["国库银两", 42], ["民心", 55], ["粮价", 72], ["改桑进度", 58], ["皇帝信任", 43]], risks: [["粮价失控", "中"]], relationships: [] },
      maneuverState: { maneuverOpportunitiesPerDay: 2, maneuversUsedToday: 0, maneuverOpportunitiesRemaining: 2 },
      decisionHistory: [], daySummary: null, daySummaries: {}, finalJudgement: null
    };
  }
  async restoreOrCreate() { return structuredClone(this.view); }
  async getRun() { return structuredClone(this.view); }
  async submitManeuver(view, input) {
    this.calls.push({ kind: "maneuver", input });
    if (input.customText.includes("立即认罪")) return { accepted: false, reason: "超出阶段边界", rewriteSuggestion: "改为派幕僚调查" };
    this.view = structuredClone(view);
    this.view.run.version += 1;
    this.view.maneuverState.maneuverOpportunitiesRemaining -= 1;
    this.view.maneuverState.maneuversUsedToday += 1;
    this.view.messages.push({ id: "maneuver-result", day: 3, time: "主动谋划", type: "maneuver_result", label: "主动谋划", title: "私下接触了清流县令", body: "对方留下可核验线索。" });
    return structuredClone(this.view);
  }
}
