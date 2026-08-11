import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createStoryApp } from "../public/app.js";
import { createAEmotionM1Ui } from "../public/a-emotion-m1-ui.js";

function projection(value = 46) {
  return {
    world: { presentation: { statusMetrics: [{ key: "imperial_trust", label: "皇帝信任", value, suffix: "", tone: "crown" }] } }
  };
}

function payload(overrides = {}) {
  return {
    schemaVersion: "a_emotion_m1_projection_v1",
    projectionVersion: 1,
    stateVersion: 1,
    eventSequence: 4,
    category: "RELATED",
    disclosure: "HIDDEN",
    severity: "MAJOR",
    centerCardType: "CROSS_IMPACT",
    title: "他人的行动改变了你的处境",
    summary: "原始粮册的递送出现异常，部分底稿已经离开常规核验链。",
    sourceStatus: "来源未知",
    knownFacts: ["送达材料的编号与此前登记不一致", "多个经手渠道都曾接触相关材料"],
    visibleImpacts: [{ key: "imperial_trust", label: "皇帝信任", before: 52, after: 46, delta: -6, suffix: "", safeReason: "账册可信度受到质疑" }],
    responseOptions: [
      { code: "INVESTIGATE_LEDGER_ANOMALY", label: "派遣调查", preferredEntry: "INVESTIGATE", intentKey: "inspect_ledger_delivery", prefillText: "核对原始粮册的递送、编号和经手记录。" },
      { code: "QUESTION_DELIVERY_PUBLICLY", label: "公开质问", preferredEntry: "TALK", intentKey: "question_ledger_delivery", prefillText: "请相关经手方公开说明原始粮册为何未按登记送达。" },
      { code: "DEFER_RESPONSE", label: "暂不回应", preferredEntry: "DEFER", intentKey: null, prefillText: null }
    ],
    occurredAt: "2026-08-09T16:00:00.000Z",
    ...overrides
  };
}

async function harness(deliveryPayload = payload(), metric = 46, eventId = "evt_H4hJmUeXQ3aK7pT9vB2cD5fG") {
  const dom = new JSDOM('<!doctype html><main id="app"></main>', { url: "http://game.test/game?runId=run-m1&debug=1" });
  const storage = new M1Storage(metric);
  const root = dom.window.document.getElementById("app");
  const app = createStoryApp({ root, window: dom.window, storage });
  await app.boot();
  const response = {
    schemaVersion: "event_delivery_page_v1",
    deliveries: [{
      deliverySequence: 1,
      eventId,
      eventType: "A_EMOTION_M1_CROSS_IMPACT",
      payload: deliveryPayload,
      createdAt: "2026-08-09T16:00:00.000Z"
    }],
    nextAfterDeliverySequence: 1,
    hasMore: false
  };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
  };
  const ui = createAEmotionM1Ui({
    root,
    window: dom.window,
    runId: "run-m1",
    fetchImpl,
    getProjection: () => projection(metric),
    prefillWorkbench: ({ maneuverType, targetRoleKey, intentKey, prefillText }) => {
      app.chooseManeuver(maneuverType, targetRoleKey, "", intentKey);
      const textarea = root.querySelector("#maneuverCustomText");
      if (textarea && prefillText) {
        textarea.value = prefillText;
        textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      }
    }
  });
  await ui.refresh();
  return { dom, root, app, storage, ui, calls };
}

test("real /game DOM click opens the approved right-rail 世界局势 detail without replacing the current decision", async () => {
  const h = await harness();
  const feedButton = h.root.querySelector("[data-aemotion-open]");
  assert.ok(feedButton);
  feedButton.click();

  assert.ok(h.root.querySelector('[data-testid="decision-zone"]'), "existing /game decision content remains mounted");
  const feed = h.root.querySelector('[data-testid="aemotion-m1-feed"]');
  assert.ok(feed);
  assert.match(feed.querySelector(".aemotion-m1-feed-head")?.textContent || "", /世界局势/);
  const detail = h.root.querySelector('[data-testid="aemotion-m1-cross-impact"]');
  assert.ok(detail);
  assert.ok(detail.closest(".causal-right"), "A-Emotion detail stays inside the approved right rail");
  assert.equal(h.root.querySelector(".causal-center [data-aemotion-world-situation-detail]"), null);
  assert.equal(h.root.querySelector("[data-aemotion-m1-card]"), null);
  assert.equal(h.root.querySelector("[data-aemotion-m1-metric-hint]"), null);
  assert.match(detail.textContent, /来源未知/);
  assert.doesNotMatch(detail.textContent, /巡抚|xunfu/);
  assert.equal(h.calls.length, 1, "legacy M1 open remains local and does not call M2 detail or receipt APIs");
  h.ui.destroy();
  h.dom.window.close();
});

test("world situation detail is read-only and preserves existing maneuver draft through refresh", async () => {
  const h = await harness();
  h.app.chooseManeuver("investigate", "", "", "manual-investigation");
  const textarea = h.root.querySelector("#maneuverCustomText");
  textarea.value = "保留现有工作区草稿";
  textarea.dispatchEvent(new h.dom.window.Event("input", { bubbles: true }));
  const beforeDraft = structuredClone(h.app.getState().maneuverDraft);
  const beforeTextarea = h.root.querySelector("#maneuverCustomText").value;
  const beforeCenter = h.root.querySelector(".causal-center")?.innerHTML || "";

  h.root.querySelector("[data-aemotion-open]").click();
  const detail = h.root.querySelector('[data-testid="aemotion-m1-cross-impact"]');
  assert.ok(detail);
  assert.ok(detail.closest(".causal-right"));
  assert.equal(h.root.querySelector("[data-aemotion-response]"), null, "世界局势详情只读，不渲染回应按钮");
  assert.equal(h.root.querySelector(".causal-center")?.innerHTML || "", beforeCenter, "打开详情不得改变中央区");
  assert.deepEqual(h.app.getState().maneuverDraft, beforeDraft, "打开详情不得改写工作台状态");
  assert.equal(h.root.querySelector("#maneuverCustomText").value, beforeTextarea, "打开详情不得改写 textarea");

  await h.app.refresh({ silent: true });
  await h.ui.refresh();
  assert.deepEqual(h.app.getState().maneuverDraft, beforeDraft, "刷新后仍保留工作台状态");
  assert.equal(h.root.querySelector("#maneuverCustomText").value, beforeTextarea, "刷新后仍保留 textarea");
  assert.equal(h.storage.calls.length, 0, "只读详情不得提交行动");
  h.ui.destroy();
  h.dom.window.close();
});

test("world situation open is local/no-cost while semantic source leaks or authoritative metric mismatches fail closed", async () => {
  const first = await harness();
  first.root.querySelector("[data-aemotion-open]").click();
  assert.ok(first.root.querySelector('[data-testid="aemotion-m1-cross-impact"]'));
  assert.equal(first.root.querySelector("[data-aemotion-response]"), null);
  assert.equal(first.storage.calls.length, 0);
  first.ui.destroy();
  first.dom.window.close();

  for (const [brokenPayload, metric, eventId] of [
    [payload({ summary: "巡抚衙门已经控制了原册" }), 46, "evt_H4hJmUeXQ3aK7pT9vB2cD5fG"],
    [payload({ knownFacts: [{ nested: { sourceRoleId: "hidden-source" } }] }), 46, "evt_H4hJmUeXQ3aK7pT9vB2cD5fG"],
    [payload(), 52, "evt_H4hJmUeXQ3aK7pT9vB2cD5fG"],
    [payload(), 46, "evt_playerAction_governor_role_sensitive"]
  ]) {
    const broken = await harness(brokenPayload, metric, eventId);
    assert.equal(broken.root.querySelector('[data-testid="aemotion-m1-feed"]'), null);
    assert.deepEqual(broken.ui.getState().items, []);
    broken.ui.destroy();
    broken.dom.window.close();
  }
});

class M1Storage {
  constructor(metric = 46) {
    this.calls = [];
    this.view = {
      run: { id: "run-m1", title: "桑田诏", location: "杭州总督府", currentDay: 2, currentTime: "午后", totalDays: 7, status: "awaiting_decision", version: 1, decisionsCompletedToday: 0, decisionsRequiredToday: 2, totalDecisionsCompleted: 2, totalDecisionsRequired: 12 },
      player: { roleName: "浙江总督", name: "总督", rank: "总督", office: "总督府", fateQuestion: "保住改革主持权", goals: ["取得可信原始粮册"], resources: [["银两", "42万两"]], leverage: ["半页田契暗账"] },
      messages: [{ id: "msg-1", day: 2, time: "午后", type: "system", label: "系统", title: "粮册核验", body: "原始材料正在递送。" }],
      activeDecision: { messageId: "decision-1", title: "如何核验原始粮册", help: "选择策略。", options: [{ key: "A", title: "逐项核验", body: "先查原件。", gain: "提高可信度", risk: "延误" }] },
      dashboard: { worldState: [["国库银两", 42], ["民心", 55], ["粮价", 72], ["改桑进度", 58], ["皇帝信任", metric]], risks: [["账册可信度", "中"]], relationships: [] },
      maneuverState: { maneuverOpportunitiesPerDay: 2, maneuversUsedToday: 0, maneuverOpportunitiesRemaining: 2 },
      decisionHistory: [], daySummary: null, daySummaries: {}, finalJudgement: null
    };
  }
  async restoreOrCreate() { return structuredClone(this.view); }
  async getRun() { return structuredClone(this.view); }
  async submitManeuver(_view, input) { this.calls.push(input); return structuredClone(this.view); }
}
