import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createAEmotionM1Ui } from "../public/a-emotion-m1-ui.js";
import { createAEmotionM6Transport } from "../public/continuous-story-v2-client.js";

function setupUi() {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"><aside class="causal-right" style="height:200px;overflow:auto"><section data-testid="maneuver-panel"></section></aside><main class="causal-center"><textarea id="customDecision">保留主决策草稿</textarea><textarea id="maneuverCustomText">保留工作区草稿</textarea></main></div></body></html>`, { url: "https://game.test/game?runId=room-m6" });
  const root = dom.window.document.querySelector("#root");
  const projection = { room: { id: "room-m6" }, player: { userId: "user-1", roleId: "role-1" }, worldSequence: 10 };
  let calls = 0;
  let fail = true;
  const fetchImpl = async () => {
    calls += 1;
    if (fail) throw new TypeError("network offline");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        schemaVersion: "event_delivery_page_v1",
        deliveries: [],
        nextAfterDeliverySequence: 0,
        hasMore: false,
        interactionFeed: { schemaVersion: "a_emotion_m2_feed_v1", projectionVersion: 1, items: [], unreadCount: 0, nextCursor: null, hasMore: false },
        keyModals: []
      })
    };
  };
  const ui = createAEmotionM1Ui({ root, window: dom.window, runId: "room-m6", getProjection: () => projection, fetchImpl, prefillWorkbench: () => undefined });
  return { dom, root, ui, get calls() { return calls; }, online() { fail = false; } };
}

test("M6 feed failure is isolated to approved world-situation rail and preserves drafts focus and scroll", async () => {
  const value = setupUi();
  const custom = value.root.querySelector("#customDecision");
  const workbench = value.root.querySelector("#maneuverCustomText");
  custom.focus();
  custom.setSelectionRange(3, 3);
  const rail = value.root.querySelector(".causal-right");
  rail.scrollTop = 41;
  await value.ui.refresh();
  assert.equal(custom.value, "保留主决策草稿");
  assert.equal(workbench.value, "保留工作区草稿");
  assert.equal(value.dom.window.document.activeElement, custom);
  assert.equal(rail.scrollTop, 41);
  assert.match(rail.textContent, /世界局势暂未更新/u);
  assert.equal(value.root.querySelector(".causal-center").textContent.includes("世界局势"), false);
  value.online();
  await value.ui.refresh();
  assert.ok(value.calls >= 2);
  assert.equal(custom.value, "保留主决策草稿");
  assert.equal(workbench.value, "保留工作区草稿");
  value.ui.destroy();
  value.dom.window.close();
});

test("M6 transport prefers SSE then falls back to one bounded poller and never overlaps refresh", async () => {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`, { url: "https://game.test/game?runId=room-m6" });
  const timers = [];
  dom.window.setInterval = (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; };
  dom.window.clearInterval = (timer) => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); };
  let source = null;
  class TestEventSource {
    constructor(url) { this.url = url; this.closed = false; source = this; }
    close() { this.closed = true; }
  }
  dom.window.EventSource = TestEventSource;
  let refreshes = 0;
  const transport = createAEmotionM6Transport({ window: dom.window, runId: "room-m6", pollIntervalMs: 7000, onRefresh: async () => { refreshes += 1; } });
  transport.start();
  assert.equal(transport.getState().mode, "sse");
  assert.match(source.url, /\/api\/v4\/rooms\/room-m6\/events\/stream/u);
  source.onmessage({ data: "{}" });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(refreshes, 1);
  source.onerror(new dom.window.Event("error"));
  assert.equal(source.closed, true);
  assert.equal(transport.getState().mode, "poll");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 7000);
  timers[0].fn();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(refreshes, 2);
  transport.stop();
  assert.equal(timers.length, 0);
  dom.window.close();
});

test("M6 repeated refresh stays bounded and creates at most one right-rail module", async () => {
  const value = setupUi();
  value.online();
  for (let index = 0; index < 20; index += 1) await value.ui.refresh();
  assert.ok(value.root.querySelectorAll('[data-aemotion-world-situation="true"]').length <= 1);
  assert.ok(value.root.querySelectorAll(".aemotion-m1-feed-item").length <= 10);
  value.ui.destroy();
  value.dom.window.close();
});
