import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createContinuousGameApp } from "../public/continuous-game-client.js";
import { bootGamePage } from "../public/game-bootstrap.js";
function projection(overrides = {}) {
  const base = {
    schemaVersion: "continuous_game_projection_v1",
    projectionRevision: 1,
    appliedThroughDeliverySequence: 0,
    generatedAt: new Date().toISOString(),
    roomSummary: {
      id: "room-1", title: "嘉靖财政危局", ownerUserId: "u1",
      players: [
        { userId: "u1", nickname: "one", roleId: "r1", roleKey: "zhejiang_governor", roleName: "浙江总督" },
        { userId: "u2", nickname: "two", roleId: "r2", roleKey: "xunfu", roleName: "浙江巡抚" },
        { userId: "u3", nickname: "three", roleId: "r3", roleKey: "county_magistrate", roleName: "清流县令" }
      ]
    },
    run: { runId: "room-1", engineVersion: "continuous_strategy_v1_1", strategyVersion: "sangtian_v1_1", status: "playing", stageIndex: 1 },
    currentNode: { id: "node-1", title: "改桑急令", publicNarration: "巡抚与县令的执行方案正面冲突。", commonContest: "证据与执行边界" },
    actionWindow: { id: "window-1", status: "MAIN_OPEN", openingSnapshotVersion: 1, mainClosesAt: new Date(Date.now() + 60_000).toISOString(), graceClosesAt: null, myParticipant: { mainStatus: "PENDING", maneuverStatus: "LOCKED", reactionStatus: "NOT_OPEN", doneAt: null } },
    serverNow: new Date().toISOString(),
    player: { userId: "u1", playerId: "p1", roleId: "r1", roleKey: "zhejiang_governor", roleName: "浙江总督", identity: "统筹皇权、财政、民心与海防", publicInfo: "总督", personalGoal: "稳定全局" },
    myControl: { roleId: "r1", mode: "HUMAN_ACTIVE", presence: "ONLINE", epoch: 1, reclaimPolicy: "NOT_AVAILABLE", effectiveFromSlot: null },
    roleControllerStates: [
      { roleId: "r1", controllerKind: "HUMAN", presence: "ONLINE" },
      { roleId: "r2", controllerKind: "HUMAN", presence: "ONLINE" },
      { roleId: "r3", controllerKind: "HUMAN", presence: "ONLINE" }
    ],
    privateBrief: { text: "你必须平衡财政与民心。", personalPressure: "御前期限逼近。" },
    availableMainActions: [
      { actionKey: "main-a", title: "保留证据并交叉核验", description: "先核验再推进。", targetRoleIds: ["r2"], leverageKeys: [] },
      { actionKey: "main-b", title: "推进本职方案", description: "承担推进代价。", targetRoleIds: ["r3"], leverageKeys: [] },
      { actionKey: "main-c", title: "协调另一角色", description: "交换资源。", targetRoleIds: ["r2"], leverageKeys: [] }
    ],
    myActions: [], availableManeuvers: [], pendingReaction: null, observableTraces: [],
    observablePlayerStates: [{ roleId: "r1", decisionState: "THINKING", layoutDone: false }, { roleId: "r2", decisionState: "THINKING", layoutDone: false }, { roleId: "r3", decisionState: "THINKING", layoutDone: false }],
    latestPersonalResult: null, latestPublicResult: null,
    access: { state: "FREE", requiredCredits: 100, canCurrentUserUnlock: false, unlockEndpoint: "/api/v4/story-runs/room-1/unlock" },
    resultReady: false, resultUrl: null
  };
  return structuredClone({ ...base, ...overrides });
}

class MockApi {
  constructor(initial) { this.value = structuredClone(initial); this.requests = []; this.fetch = this.fetch.bind(this); this.result = resultProjection(); }
  async fetch(input, init = {}) {
    const path = new URL(String(input), "http://game.test").pathname;
    const method = String(init.method || "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    this.requests.push({ path, search: new URL(String(input), "http://game.test").search, method, body, credentials: init.credentials, accept: init.headers?.accept });
    if (path.endsWith("/presence/heartbeat")) return json({ accepted: true, serverNow: new Date().toISOString(), nextHeartbeatAt: new Date(Date.now() + 2_000).toISOString(), rolePresence: this.value.myControl });
    if (method === "GET" && path.endsWith("/events")) return json({ schemaVersion: "event_delivery_page_v1", deliveries: [], nextAfterDeliverySequence: this.value.appliedThroughDeliverySequence, hasMore: false });
    if (method === "GET" && path.endsWith("/events/stream")) return new Response(new ReadableStream({ start(controller) { controller.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
    if (method === "GET" && path.endsWith("/result")) return json(this.result);
    if (method === "GET" && path.endsWith("/game")) return json(this.value);
    if (path.endsWith("/actions/main")) {
      this.value.projectionRevision += 1; this.value.availableMainActions = []; this.value.actionWindow.myParticipant.mainStatus = "SUBMITTED"; this.value.observablePlayerStates[0].decisionState = "DECIDED";
      return json({ accepted: true, gameProjection: this.value });
    }
    if (path.endsWith("/actions/maneuver")) { this.value.projectionRevision += 1; this.value.availableManeuvers = []; this.value.actionWindow.myParticipant.maneuverStatus = "SUBMITTED"; return json({ accepted: true, gameProjection: this.value }); }
    if (path.includes("/events/") && path.endsWith("/reaction")) { this.value.projectionRevision += 1; this.value.pendingReaction = null; this.value.actionWindow.myParticipant.reactionStatus = "RESPONDED"; return json({ accepted: true, gameProjection: this.value }); }
    if (path.endsWith("/layout/done") || path.endsWith("/layout/leave-stage")) { this.value.projectionRevision += 1; this.value.actionWindow.myParticipant.doneAt = new Date().toISOString(); return json({ accepted: true, gameProjection: this.value }); }
    if (path.endsWith("/control/handoff-to-ai")) { this.value.projectionRevision += 1; this.value.myControl = { ...this.value.myControl, mode: "AI_ACTIVE", presence: "AI_CONTROLLED", epoch: 2 }; return json({ accepted: true, gameProjection: this.value }); }
    if (path.endsWith("/control/reclaim")) { this.value.projectionRevision += 1; this.value.myControl = { ...this.value.myControl, mode: "HUMAN_ACTIVE", presence: "ONLINE", epoch: 3 }; return json({ accepted: true, gameProjection: this.value }); }
    if (path.endsWith("/unlock")) { this.value.projectionRevision += 1; this.value.access = { ...this.value.access, state: "UNLOCKED", canCurrentUserUnlock: false }; this.value.actionWindow.status = "MAIN_OPEN"; return json({ unlocked: true, creditsCharged: 100, gameProjection: this.value }); }
    return json({ code: "NOT_FOUND" }, 404);
  }
}

function harness(value = projection(), url = "http://game.test/game?runId=room-1") {
  const dom = new JSDOM('<!doctype html><main id="app"></main>', { url });
  dom.window.confirm = () => true;
  const api = new MockApi(value);
  const root = dom.window.document.getElementById("app");
  const app = createContinuousGameApp({ root, window: dom.window, runId: "room-1", initialProjection: value, fetchImpl: api.fetch, navigate: (target) => { dom.window.__navigationTarget = target; } });
  return { dom, api, root, app };
}

test("continuous projection renders the formal three-column game and submits MAIN without host resolve", async () => {
  const h = harness();
  await h.app.boot();
  assert.ok(h.root.querySelector('[data-testid="continuous-story-shell"]'));
  assert.ok(h.root.querySelector(".causal-left"));
  assert.ok(h.root.querySelector(".causal-center"));
  assert.ok(h.root.querySelector(".causal-right"));
  assert.equal(h.root.querySelectorAll("[data-main-key]").length, 3);
  assert.match(h.root.textContent, /浙江总督/);
  assert.equal(h.root.querySelector("[data-room-resolve]"), null);
  assert.equal(h.root.querySelector("[data-submit-main]").disabled, true);
  h.root.querySelector("[data-main-key]").click();
  assert.equal(h.root.querySelector("[data-submit-main]").disabled, false);
  await h.app.submitMain();
  const command = h.api.requests.find((item) => item.path.endsWith("/game/actions/main"));
  assert.ok(command);
  assert.equal(command.body.windowId, "window-1");
  assert.equal(command.body.controlEpoch, 1);
  assert.equal(command.credentials, "include");
  assert.equal(h.root.querySelectorAll("[data-main-key]").length, 0);
  await tick();
  const eventPull = h.api.requests.find((item) => item.path.endsWith("/events"));
  const stream = h.api.requests.find((item) => item.path.endsWith("/events/stream"));
  assert.ok(eventPull, "the client backfills member events before streaming");
  assert.ok(stream?.search.includes("afterDeliverySequence=0"));
  assert.equal(stream.credentials, "include");
  h.app.destroy(); h.dom.window.close();
});

test("reaction, maneuver, done and explicit AI handoff use separate commands", async () => {
  const value = projection({
    actionWindow: { ...projection().actionWindow, status: "INTERACTION_GRACE", mainClosesAt: null, graceClosesAt: new Date(Date.now() + 60_000).toISOString(), myParticipant: { mainStatus: "SUBMITTED", maneuverStatus: "AVAILABLE", reactionStatus: "PENDING", doneAt: null } },
    availableMainActions: [],
    availableManeuvers: [{ actionKey: "maneuver-a", title: "交叉核验", description: "核验两份账册。", targetRoleIds: ["r2"], leverageKeys: [] }],
    pendingReaction: { eventId: "event-1", sourceRoleName: "浙江总督", triggerActionTitle: "要求县令交出原件", expiresAt: new Date(Date.now() + 60_000).toISOString(), options: [{ actionKey: "reaction-a", title: "接受核验" }] }
  });
  const h = harness(value); await h.app.boot();
  const modal = h.root.querySelector('[data-testid="reaction-modal"]');
  assert.ok(modal);
  assert.equal(modal.querySelector('[role="dialog"]')?.getAttribute("aria-modal"), "true");
  assert.match(modal.textContent, /浙江总督/);
  assert.match(modal.textContent, /要求县令交出原件/);
  await h.app.submitReaction("reaction-a");
  h.root.querySelector("[data-maneuver-key]").click();
  await h.app.submitManeuver();
  await h.app.finishLayout(false);
  await h.app.handoff();
  const paths = h.api.requests.filter((item) => item.method === "POST").map((item) => item.path);
  assert.ok(paths.some((item) => item.endsWith("/events/event-1/reaction")));
  assert.ok(paths.some((item) => item.endsWith("/actions/maneuver")));
  assert.ok(paths.some((item) => item.endsWith("/layout/done")));
  assert.ok(paths.some((item) => item.endsWith("/control/handoff-to-ai")));
  assert.equal(h.app.getState().projection.myControl.mode, "AI_ACTIVE");
  h.app.destroy(); h.dom.window.close();
});

test("unlock gate is a human-only formal command and preserves the same run", async () => {
  const value = projection({ access: { state: "REQUIRES_UNLOCK", requiredCredits: 100, canCurrentUserUnlock: true, unlockEndpoint: "/api/v4/story-runs/room-1/unlock" }, actionWindow: { ...projection().actionWindow, status: "PREPARING" }, availableMainActions: [] });
  const h = harness(value); await h.app.boot();
  assert.ok(h.root.querySelector('[data-testid="unlock-gate"]'));
  await h.app.unlock();
  assert.ok(h.api.requests.some((item) => item.path === "/api/v4/story-runs/room-1/unlock"));
  assert.equal(h.app.getState().projection.run.runId, "room-1");
  assert.equal(h.app.getState().projection.access.state, "UNLOCKED");
  h.app.destroy(); h.dom.window.close();
});

test("bootstrap selects the continuous client without relying on readable auth tokens", async () => {
  const dom = new JSDOM('<!doctype html><main id="app"></main>', { url: "http://game.test/game?runId=room-1" });
  let received = null;
  const value = projection();
  await bootGamePage({ root: dom.window.document.getElementById("app"), window: dom.window, fetchImpl: async (_input, init) => { received = init; return json(value); }, loadContinuous: async () => ({ createContinuousGameApp: () => ({ boot: async () => {}, destroy() {} }) }), loadSolo: async () => { throw new Error("solo must not load"); } });
  assert.equal(received.credentials, "include");
  assert.equal(dom.window.document.cookie.includes("many_worlds_session"), false);
  dom.window.close();
});


test("bootstrap fails closed for 401, 403, 404 and never starts SOLO for a runId", async () => {
  for (const status of [401, 403, 404]) {
    const dom = new JSDOM('<!doctype html><main id="app"></main>', { url: "http://game.test/game?runId=room-secret&x=1" });
    let soloLoaded = false;
    let continuousLoaded = false;
    let navigationTarget = "";
    const result = await bootGamePage({
      root: dom.window.document.getElementById("app"), window: dom.window,
      fetchImpl: async (_input, init) => { assert.equal(init.credentials, "include"); return json({ code: status === 404 ? "ROOM_NOT_FOUND" : "DENIED" }, status); },
      loadContinuous: async () => { continuousLoaded = true; throw new Error("continuous must not load"); },
      loadSolo: async () => { soloLoaded = true; throw new Error("solo must not load"); },
      navigate: (target) => { navigationTarget = target; }
    });
    assert.equal(result, null);
    assert.equal(soloLoaded, false);
    assert.equal(continuousLoaded, false);
    assert.ok(dom.window.document.querySelector('[data-testid="fatal-error"]'));
    if (status === 401) assert.equal(navigationTarget, "/auth?returnTo=%2Fgame%3FrunId%3Droom-secret%26x%3D1");
    else assert.equal(navigationTarget, "");
    dom.window.close();
  }
});

test("only a /game URL without runId may start the existing SOLO game", async () => {
  const dom = new JSDOM('<!doctype html><main id="app"></main>', { url: "http://game.test/game" });
  let soloBooted = false;
  await bootGamePage({
    root: dom.window.document.getElementById("app"), window: dom.window,
    fetchImpl: async () => { throw new Error("room probe must not run"); },
    loadSolo: async () => ({ createStoryApp: () => ({ boot: async () => { soloBooted = true; } }) })
  });
  assert.equal(soloBooted, true);
  dom.window.close();
});

test("result route consumes only the member result projection", async () => {
  const value = projection({ resultReady: true, resultUrl: "/game/result?runId=room-1", run: { ...projection().run, status: "chapter_generated", stageIndex: 7 } });
  const h = harness(value, "http://game.test/game/result?runId=room-1");
  await h.app.boot();
  assert.ok(h.api.requests.some((item) => item.path.endsWith("/rooms/room-1/result")));
  assert.ok(h.root.querySelector('[data-testid="continuous-result"]'));
  assert.match(h.root.textContent, /国策缓行，清弊得名/);
  assert.match(h.root.textContent, /总督保住了财政解释权/);
  assert.doesNotMatch(h.root.textContent, /巡抚私密结局/);
  assert.ok(h.root.querySelector('[data-testid="terminal-summary-panel"]'));
  assert.match(h.root.textContent, /第 1 轮「封存县册并启动交叉复核」· 本人/);
  assert.match(h.root.textContent, /第 4 轮「建立双衙证人保护程序」· AI/);
  assert.match(h.root.textContent, /第 7 轮「将暗账与灾损一并上奏」· 本人/);
  assert.match(h.root.textContent, /杭州总督府 · 内厅/);
  assert.doesNotMatch(h.root.textContent, /谋划中枢|等待主决策|退出本局并交给 AI|你在操控/);
  h.app.destroy(); h.dom.window.close();
});

test("projection application rejects delivery cursor regression and ignores duplicate-cursor mutation", async () => {
  const h = harness();
  await h.app.boot();
  h.api.value = projection({ projectionRevision: 2, appliedThroughDeliverySequence: 5 });
  await h.app.refresh();
  assert.equal(h.app.getState().projection.projectionRevision, 2);
  assert.equal(h.app.getState().afterDeliverySequence, 5);

  h.api.value = projection({ projectionRevision: 3, appliedThroughDeliverySequence: 4, currentNode: { ...projection().currentNode, title: "倒退投影" } });
  await h.app.refresh();
  assert.equal(h.app.getState().projection.projectionRevision, 2);
  assert.doesNotMatch(h.root.textContent, /倒退投影/);

  h.api.value = projection({ projectionRevision: 2, appliedThroughDeliverySequence: 5, currentNode: { ...projection().currentNode, title: "同版本篡改" } });
  await h.app.refresh();
  assert.equal(h.app.getState().projection.currentNode.title, "改桑急令");
  assert.equal(h.app.getState().error, "");
  h.api.value = projection({ projectionRevision: 2, appliedThroughDeliverySequence: 6, currentNode: { ...projection().currentNode, title: "same-revision-new-delivery" } });
  await h.app.refresh();
  assert.equal(h.app.getState().projection.appliedThroughDeliverySequence, 6);
  assert.equal(h.app.getState().projection.currentNode.title, "same-revision-new-delivery");
  h.app.destroy(); h.dom.window.close();
});

test("peer delivery preserves an unsubmitted local MAIN draft across a transient empty card projection", async () => {
  const h = harness();
  await h.app.boot();

  const selectedKey = "main-b";
  h.root.querySelector(`[data-main-key="${selectedKey}"]`).click();
  assert.equal(h.app.getState().selectedMain, selectedKey);
  assert.ok(h.root.querySelector(`[data-main-key="${selectedKey}"]`).classList.contains("selected"));

  h.api.value = projection({
    projectionRevision: 2,
    appliedThroughDeliverySequence: 1,
    availableMainActions: []
  });
  await h.app.refresh();
  assert.equal(h.app.getState().selectedMain, selectedKey, "peer refresh must not discard the local draft while the same MAIN slot remains pending");

  h.api.value = projection({
    projectionRevision: 3,
    appliedThroughDeliverySequence: 2
  });
  await h.app.refresh();
  assert.equal(h.app.getState().selectedMain, selectedKey);
  assert.ok(h.root.querySelector(`[data-main-key="${selectedKey}"]`).classList.contains("selected"));
  assert.equal(h.root.querySelector("[data-submit-main]").disabled, false);

  h.app.destroy();
  h.dom.window.close();
});

test("peer delivery preserves a pending MAIN draft across a transient shared-window status", async () => {
  const h = harness();
  await h.app.boot();

  const selectedKey = "main-b";
  h.root.querySelector(`[data-main-key="${selectedKey}"]`).click();
  assert.equal(h.app.getState().selectedMain, selectedKey);

  h.api.value = projection({
    projectionRevision: 2,
    appliedThroughDeliverySequence: 1,
    actionWindow: {
      ...projection().actionWindow,
      status: "PREPARING",
      myParticipant: {
        ...projection().actionWindow.myParticipant,
        mainStatus: "PENDING"
      }
    },
    availableMainActions: []
  });
  await h.app.refresh();
  assert.equal(h.app.getState().selectedMain, selectedKey, "a peer's intermediate shared status must not seal my pending slot");

  h.api.value = projection({
    projectionRevision: 3,
    appliedThroughDeliverySequence: 2
  });
  await h.app.refresh();
  assert.equal(h.app.getState().selectedMain, selectedKey);
  assert.ok(h.root.querySelector(`[data-main-key="${selectedKey}"]`).classList.contains("selected"));
  assert.equal(h.root.querySelector("[data-submit-main]").disabled, false);

  h.app.destroy();
  h.dom.window.close();
});

test("an unsubmitted MAIN draft survives a tab close and reopen on the same origin", async () => {
  const draftKey = "many-worlds:draft:room-1:MAIN";
  const first = harness();
  await first.app.boot();

  first.root.querySelector('[data-main-key="main-b"]').click();
  const persisted = first.dom.window.localStorage.getItem(draftKey);
  assert.ok(persisted, "the draft must be durable beyond the current tab session");
  assert.equal(first.dom.window.sessionStorage.getItem(draftKey), null, "drafts must not remain tab-scoped");
  first.app.destroy();
  first.dom.window.close();

  const reopened = harness();
  reopened.dom.window.localStorage.setItem(draftKey, persisted);
  await reopened.app.boot();

  assert.equal(reopened.app.getState().selectedMain, "main-b");
  assert.ok(reopened.root.querySelector('[data-main-key="main-b"]').classList.contains("selected"));
  assert.equal(reopened.root.querySelector("[data-submit-main]").disabled, false);

  reopened.app.destroy();
  reopened.dom.window.close();
});

test("a durable draft from a stale action window is rejected and removed", async () => {
  const draftKey = "many-worlds:draft:room-1:MAIN";
  const h = harness();
  h.dom.window.localStorage.setItem(draftKey, JSON.stringify({
    runId: "room-1",
    windowId: "obsolete-window",
    roleId: "r1",
    controlEpoch: 1,
    actionKey: "main-b"
  }));

  await h.app.boot();

  assert.equal(h.app.getState().selectedMain, "");
  assert.equal(h.root.querySelector('[data-main-key="main-b"]').classList.contains("selected"), false);
  assert.equal(h.dom.window.localStorage.getItem(draftKey), null, "a context-mismatched draft must not leak into the active window");

  h.app.destroy();
  h.dom.window.close();
});

test("an unsubmitted MANEUVER draft survives a client reconnect in the same window and control epoch", async () => {
  const value = projection({
    actionWindow: {
      ...projection().actionWindow,
      status: "INTERACTION_GRACE",
      mainClosesAt: null,
      graceClosesAt: new Date(Date.now() + 60_000).toISOString(),
      myParticipant: { mainStatus: "SUBMITTED", maneuverStatus: "AVAILABLE", reactionStatus: "NOT_OPEN", doneAt: null }
    },
    availableMainActions: [],
    availableManeuvers: [{ actionKey: "maneuver-a", title: "交叉核验催办时限", description: "核对催办链条。", targetRoleIds: ["r2"], leverageKeys: [] }]
  });
  const h = harness(value);
  await h.app.boot();
  h.root.querySelector('[data-maneuver-key="maneuver-a"]').click();
  assert.equal(h.app.getState().selectedManeuver, "maneuver-a");
  assert.equal(h.root.querySelector("[data-submit-maneuver]").disabled, false);
  assert.ok(h.dom.window.localStorage.getItem("many-worlds:draft:room-1:MANEUVER"));
  assert.equal(h.dom.window.sessionStorage.getItem("many-worlds:draft:room-1:MANEUVER"), null);

  h.app.destroy();
  h.root.innerHTML = "";
  const reconnected = createContinuousGameApp({
    root: h.root,
    window: h.dom.window,
    runId: "room-1",
    initialProjection: value,
    fetchImpl: h.api.fetch,
    navigate: (target) => { h.dom.window.__navigationTarget = target; }
  });
  await reconnected.boot();

  assert.equal(reconnected.getState().selectedManeuver, "maneuver-a");
  assert.ok(h.root.querySelector('[data-maneuver-key="maneuver-a"]').classList.contains("selected"));
  assert.equal(h.root.querySelector("[data-submit-maneuver]").disabled, false);

  reconnected.destroy();
  h.dom.window.close();
});

test("result-ready game projection auto-loads the result and removes active controls", async () => {
  const value = projection({ resultReady: true, resultUrl: "/game/result?runId=room-1", run: { ...projection().run, status: "chapter_generated", stageIndex: 7 } });
  const h = harness(value, "http://game.test/game?runId=room-1");
  try {
    await h.app.boot();
    assert.ok(h.api.requests.some((item) => item.path.endsWith("/rooms/room-1/result")));
    assert.ok(h.root.querySelector('[data-testid="terminal-summary-panel"]'));
    assert.match(h.root.textContent, /本局已结束|七轮共同推演完成/);
    assert.doesNotMatch(h.root.textContent, /谋划中枢|等待主决策|退出本局并交给 AI|你在操控/);
  } finally {
    h.app.destroy(); h.dom.window.close();
  }
});

function resultProjection() {
  return {
    schemaVersion: "continuous_result_projection_v1",
    roomSummary: projection().roomSummary,
    run: { runId: "room-1", engineVersion: "continuous_strategy_v1_1", strategyVersion: "sangtian_v1_1", completedAt: new Date().toISOString() },
    publicEnding: { content: "国策缓行，清弊得名。" },
    personalEnding: { roleId: "r1", content: "总督保住了财政解释权。" },
    myKeyDecisions: [
      { stageIndex: 1, slot: "MAIN", title: "封存县册并启动交叉复核", actorKind: "HUMAN" },
      { stageIndex: 2, slot: "MANEUVER", title: "核对两衙灾损口径", actorKind: "HUMAN" },
      { stageIndex: 4, slot: "MAIN", title: "建立双衙证人保护程序", actorKind: "AI_TAKEOVER" },
      { stageIndex: 7, slot: "MAIN", title: "将暗账与灾损一并上奏", actorKind: "HUMAN" }
    ],
    authorizedCrossImpacts: [{ fromRoleId: "r2", summary: "巡抚的奏报改变了御前判断。" }],
    myControlTimeline: [{ fromMode: "HUMAN_ACTIVE", toMode: "AI_ACTIVE" }],
    creditsSummary: { accessState: "UNLOCKED" }
  };
}

function tick() { return new Promise((resolve) => setTimeout(resolve, 0)); }
function json(payload, status = 200) { return new Response(JSON.stringify(structuredClone(payload)), { status, headers: { "content-type": "application/json" } }); }
