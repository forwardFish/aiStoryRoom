import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createAEmotionM1Ui } from "../public/a-emotion-m1-ui.js";

function fixture(width) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root">
    <header class="causal-topbar" data-testid="existing-top">既有顶部</header>
    <main class="causal-center"><article data-testid="existing-center">既有中央剧情与决策</article><textarea id="customDecision">保留主决策草稿</textarea></main>
    <aside class="causal-right" style="height:220px;overflow:auto"><section class="maneuver-panel" data-testid="maneuver-panel"><textarea id="maneuverCustomText">保留工作区草稿</textarea></section></aside>
  </div></body></html>`, { url: "https://game.test/game?runId=room-m6" });
  Object.defineProperty(dom.window, "innerWidth", { configurable: true, value: width });
  const root = dom.window.document.querySelector("#root");
  return { dom, root };
}

function response(value, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }));
}

const emptyPage = {
  schemaVersion: "event_delivery_page_v1",
  deliveries: [],
  nextAfterDeliverySequence: 0,
  hasMore: false,
  interactionFeed: {
    schemaVersion: "a_emotion_m2_feed_v1",
    projectionVersion: 1,
    items: [],
    unreadCount: 0,
    nextCursor: null,
    hasMore: false
  },
  keyModals: []
};

test("M6 keeps all A-Emotion rendering inside one approved 世界局势 right-rail module", async () => {
  const { dom, root } = fixture(1440);
  const decision = root.querySelector("#customDecision");
  const workbench = root.querySelector("#maneuverCustomText");
  const rail = root.querySelector(".causal-right");
  decision.focus();
  rail.scrollTop = 23;

  const ui = createAEmotionM1Ui({
    root,
    window: dom.window,
    runId: "room-m6",
    fetchImpl: () => response(emptyPage),
    getProjection: () => ({ room: { id: "room-m6" }, player: { userId: "user-1", roleId: "role-1" } }),
    prefillWorkbench: () => undefined
  });

  await ui.refresh();
  await ui.refresh();

  assert.equal(root.querySelectorAll('[data-aemotion-world-situation="true"]').length <= 1, true);
  const surface = root.querySelector('[data-aemotion-world-situation="true"]');
  if (surface) assert.match(surface.textContent, /世界局势/u);
  assert.ok(root.querySelector('[data-testid="existing-top"]'));
  assert.ok(root.querySelector('[data-testid="existing-center"]'));
  assert.equal(root.querySelector("[data-aemotion-m1-card]"), null);
  assert.equal(root.querySelector("[data-aemotion-m1-metric-hint]"), null);
  assert.equal(decision.value, "保留主决策草稿");
  assert.equal(workbench.value, "保留工作区草稿");
  assert.equal(dom.window.document.activeElement, decision);
  assert.equal(rail.scrollTop, 23);

  ui.destroy();
  dom.window.close();
});

test("M6 390px verification is evidence-only and does not add an unapproved layout", async () => {
  const { dom, root } = fixture(390);
  const ui = createAEmotionM1Ui({
    root,
    window: dom.window,
    runId: "room-m6",
    fetchImpl: () => response(emptyPage),
    getProjection: () => ({ room: { id: "room-m6" }, player: { userId: "user-1", roleId: "role-1" } }),
    prefillWorkbench: () => undefined
  });
  await ui.refresh();
  assert.equal(dom.window.innerWidth, 390);
  assert.ok(root.querySelector('[data-testid="existing-top"]'));
  assert.ok(root.querySelector('[data-testid="existing-center"]'));
  assert.equal(root.querySelector("[data-aemotion-m1-card]"), null);
  assert.equal(root.querySelector("[data-aemotion-m1-metric-hint]"), null);
  assert.equal(root.querySelectorAll('[data-aemotion-world-situation="true"]').length <= 1, true);
  ui.destroy();
  dom.window.close();
});
