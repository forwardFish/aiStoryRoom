import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createAEmotionM1Ui } from "../public/a-emotion-m1-ui.js";

const RUN_ID = "room-m2";

function projection() {
  return {
    world: {
      presentation: {
        statusMetrics: [{ key: "imperial_trust", label: "皇帝信任", value: 46, suffix: "" }]
      }
    }
  };
}

function item(index, overrides = {}) {
  const suffix = String(index).padStart(32, "0");
  return {
    schemaVersion: "a_emotion_m2_projection_v1",
    projectionVersion: 2,
    stateVersion: 2,
    eventSequence: 30 - index,
    aggregateId: `agg_${suffix}`,
    stageId: `stage-${index}`,
    sharedObjectId: "original-grain-ledger",
    eventFamily: "LEDGER_DELIVERY",
    category: "SUSPICIOUS",
    disclosure: "SUSPECTED",
    severity: "MAJOR",
    centerCardType: "SUSPICIOUS_TRACE",
    title: `局势动向 ${index}`,
    summary: "递送记录与复核时序存在冲突，但现有证据仍不足以确认由哪一名经手角色授意。",
    sourceStatus: "两名经手角色均有嫌疑",
    knownFacts: ["递送时间晚于原定登记", "异常发生在一次临时复核之后"],
    visibleImpacts: [{ key: "imperial_trust", label: "皇帝信任", before: 52, after: 46, delta: -6, suffix: "", safeReason: "粮册异常引发朝廷质疑" }],
    responseOptions: [
      { code: "CONTINUE_LEDGER_EVIDENCE_SEARCH", label: "继续追查", preferredEntry: "INVESTIGATE", targetRoleKey: null, intentKey: "inspect_ledger_authority_chain", prefillText: "继续核对复核手令、递送登记、装订编号和实际经手记录。" },
      { code: "QUESTION_LEDGER_HANDLERS", label: "公开质问", preferredEntry: "TALK", targetRoleKey: null, intentKey: "question_ledger_handlers", prefillText: "请相关经手方说明复核与递送记录为何不一致。" },
      { code: "DEFER_RESPONSE", label: "保留证据", preferredEntry: "DEFER", targetRoleKey: null, intentKey: null, prefillText: null }
    ],
    visibleSuspectRoleIds: [`role-${index}-a`, `role-${index}-b`],
    occurredAt: "2026-08-10T05:10:00.000Z",
    eventId: `evt_${suffix}`,
    deliverySequence: 30 - index,
    isUnread: true,
    isAcknowledged: false,
    isResolved: false,
    ...overrides
  };
}

function feed(items, nextCursor = null, hasMore = false) {
  return {
    schemaVersion: "a_emotion_m2_feed_v1",
    items,
    unreadCount: items.filter((value) => value.isUnread).length,
    nextCursor,
    hasMore
  };
}

function page(items, nextAfterDeliverySequence = 30, nextCursor = null, hasMore = false) {
  return {
    schemaVersion: "event_delivery_page_v1",
    deliveries: [],
    nextAfterDeliverySequence,
    hasMore: false,
    interactionFeed: feed(items, nextCursor, hasMore)
  };
}

function fixture() {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root">
    <div class="status-strip"><span>皇帝信任 <b>46</b></span></div>
    <aside class="causal-right"><section class="maneuver-panel"><div class="maneuver-active-label">当前工作区</div><textarea id="maneuverCustomText"></textarea></section></aside>
    <main class="causal-center"><section data-testid="existing-center">现有决策</section></main>
  </div></body></html>`, { url: `http://game.test/game?runId=${RUN_ID}` });
  const root = dom.window.document.querySelector("#root");
  return { dom, root };
}

function click(win, element) {
  assert.ok(element, "expected clickable DOM element");
  element.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

test("real DOM feed renders 3/6 rows, uses internal scroll and emits durable seen receipts", async () => {
  const { dom, root } = fixture();
  let serverItems = Array.from({ length: 7 }, (_, index) => item(index + 1));
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method || "GET", body: init.body || null });
    if (String(url).includes("/seen")) return jsonResponse({ eventId: String(url).split("/").at(-2), projectionVersion: 2, seenAt: new Date().toISOString(), acknowledgedAt: null, resolvedAt: null });
    if (/\/events\/evt_[^/?]+\?projectionVersion=/u.test(String(url))) {
      const id = decodeURIComponent(String(url).match(/\/events\/(evt_[^?]+)/u)?.[1] || "");
      return jsonResponse(serverItems.find((value) => value.eventId === id) || {}, serverItems.some((value) => value.eventId === id) ? 200 : 404);
    }
    return jsonResponse(page(serverItems));
  };
  const ui = createAEmotionM1Ui({ root, window: dom.window, runId: RUN_ID, fetchImpl, getProjection: projection, prefillWorkbench() {} });
  await ui.refresh();

  assert.equal(root.querySelectorAll("[data-aemotion-open]").length, 3);
  const worldSituation = root.querySelector('[data-testid="aemotion-m1-feed"]');
  assert.ok(worldSituation);
  assert.match(worldSituation.querySelector(".aemotion-m1-feed-head")?.textContent || "", /世界局势/);
  assert.ok(worldSituation.closest(".causal-right"));
  assert.equal(root.querySelector("[data-aemotion-m1-metric-hint]"), null);
  const list = root.querySelector("[data-aemotion-feed-list]");
  assert.ok(list);
  assert.match(list.className, /feed-list/u);
  click(dom.window, root.querySelector("[data-aemotion-expand]"));
  assert.equal(root.querySelectorAll("[data-aemotion-open]").length, 6);

  await wait(1_100);
  assert.ok(requests.filter((request) => request.url.includes("/seen")).length >= 3, "visible rows become seen after one second");
  ui.destroy();
  dom.window.close();
});

test("feed click opens the approved right-rail detail as read-only and never preselects a source role", async () => {
  const { dom, root } = fixture();
  const requests = [];
  const prefills = [];
  const values = [item(1)];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method || "GET", body: init.body || null });
    if (String(url).includes("/ack")) return jsonResponse({ eventId: values[0].eventId, projectionVersion: 2, seenAt: new Date().toISOString(), acknowledgedAt: new Date().toISOString(), resolvedAt: null });
    if (/\/events\/evt_[^/?]+\?projectionVersion=/u.test(String(url))) return jsonResponse(values[0]);
    return jsonResponse(page(values));
  };
  const ui = createAEmotionM1Ui({
    root,
    window: dom.window,
    runId: RUN_ID,
    fetchImpl,
    getProjection: projection,
    prefillWorkbench(value) { prefills.push(value); }
  });
  await ui.refresh();
  const centerBefore = root.querySelector(".causal-center")?.innerHTML;
  click(dom.window, root.querySelector(`[data-aemotion-open="${values[0].eventId}"]`));
  await wait(0);
  const detail = root.querySelector('[data-testid="aemotion-suspicious_trace"]');
  assert.ok(detail);
  assert.ok(detail.closest(".causal-right"), "M2 detail stays inside the approved 世界局势 right rail");
  assert.ok(root.querySelector('[data-testid="existing-center"]'), "existing /game center remains mounted");
  assert.equal(root.querySelector(".causal-center")?.innerHTML, centerBefore, "opening 世界局势 must not alter the center column");
  assert.equal(root.querySelector(".causal-center [data-aemotion-world-situation-detail]"), null);
  assert.equal(root.querySelector("[data-aemotion-m1-metric-hint]"), null);
  assert.equal(root.querySelector("[data-aemotion-response]"), null, "世界局势详情只读，不渲染回应按钮");
  assert.match(root.textContent, /两名经手角色均有嫌疑/u);
  assert.doesNotMatch(root.textContent, /xunfu|巡抚/iu);
  assert.equal(prefills.length, 0, "打开世界局势详情不得预填任何工作台");
  assert.ok(requests.some((request) => request.url.includes("/ack")), "打开 M2 详情仍会执行 durable ack 读回");
  ui.destroy();
  dom.window.close();
});

test("refresh sends a validated interactionCursor and merges by eventId plus projectionVersion", async () => {
  const { dom, root } = fixture();
  const cursor = `m2c_${"c".repeat(43)}`;
  const firstItem = item(1);
  const upgraded = item(1, {
    projectionVersion: 3,
    stateVersion: 3,
    eventSequence: 41,
    deliverySequence: 41,
    title: "局势动向 1 已升级"
  });
  const secondItem = item(2, { eventSequence: 40, deliverySequence: 40 });
  const requests = [];
  let requestIndex = 0;
  const fetchImpl = async (url) => {
    requests.push(String(url));
    requestIndex += 1;
    return requestIndex === 1
      ? jsonResponse(page([firstItem], 30, cursor, true))
      : jsonResponse(page([upgraded, secondItem], 41, null, false));
  };
  const ui = createAEmotionM1Ui({ root, window: dom.window, runId: RUN_ID, fetchImpl, getProjection: projection, prefillWorkbench() {} });
  await ui.refresh();
  await ui.refresh();

  assert.equal(new URL(requests[0], "http://game.test").searchParams.has("interactionCursor"), false);
  assert.equal(new URL(requests[1], "http://game.test").searchParams.get("interactionCursor"), cursor);
  const state = ui.getState();
  assert.equal(state.items.filter((value) => value.eventId === firstItem.eventId).length, 1);
  assert.equal(state.items.find((value) => value.eventId === firstItem.eventId)?.projectionVersion, 3);
  assert.ok(state.items.some((value) => value.eventId === secondItem.eventId));
  assert.equal(root.querySelectorAll(`[data-aemotion-open="${firstItem.eventId}"]`).length, 1);
  ui.destroy();
  dom.window.close();
});

test("new events do not jump a scrolled feed or clear focus/draft until the user accepts them", async () => {
  const { dom, root } = fixture();
  let serverItems = Array.from({ length: 6 }, (_, index) => item(index + 1));
  const fetchImpl = async () => jsonResponse(page(serverItems, serverItems.length === 6 ? 30 : 31));
  const ui = createAEmotionM1Ui({ root, window: dom.window, runId: RUN_ID, fetchImpl, getProjection: projection, prefillWorkbench() {} });
  await ui.refresh();
  click(dom.window, root.querySelector("[data-aemotion-expand]"));
  const list = root.querySelector("[data-aemotion-feed-list]");
  list.scrollTop = 120;
  const textarea = root.querySelector("#maneuverCustomText");
  textarea.value = "保留正在输入的调查草稿";
  textarea.focus();
  textarea.setSelectionRange(3, 8);

  serverItems = [item(9, { eventSequence: 40, deliverySequence: 40 }), ...serverItems];
  await ui.refresh();
  assert.equal(list.isConnected, false, "render may replace the list but must preserve its logical scroll state");
  const replacement = root.querySelector("[data-aemotion-feed-list]");
  assert.equal(replacement.scrollTop, 120);
  assert.match(root.textContent, /1 条新动态/u);
  assert.equal(root.querySelector("#maneuverCustomText").value, "保留正在输入的调查草稿");
  assert.equal(dom.window.document.activeElement.id, "maneuverCustomText");
  assert.equal(dom.window.document.activeElement.selectionStart, 3);
  assert.equal(dom.window.document.activeElement.selectionEnd, 8);

  click(dom.window, root.querySelector("[data-aemotion-new-events]"));
  assert.equal(root.querySelector("[data-aemotion-feed-list]").scrollTop, 0);
  assert.doesNotMatch(root.textContent, /条新动态/u);
  assert.equal(root.querySelector("#maneuverCustomText").value, "保留正在输入的调查草稿");
  ui.destroy();
  dom.window.close();
});

test("active read-only detail does not resolve an event or consume an action after ordinary maneuver", async () => {
  const { dom, root } = fixture();
  const values = [item(1)];
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method || "GET" });
    if (String(url).includes("/resolved")) return jsonResponse({ eventId: values[0].eventId, projectionVersion: 2, seenAt: new Date().toISOString(), acknowledgedAt: new Date().toISOString(), resolvedAt: new Date().toISOString() });
    if (String(url).includes("/ack")) return jsonResponse({ eventId: values[0].eventId, projectionVersion: 2, seenAt: new Date().toISOString(), acknowledgedAt: new Date().toISOString(), resolvedAt: null });
    if (/\/events\/evt_[^/?]+\?projectionVersion=/u.test(String(url))) return jsonResponse(values[0]);
    return jsonResponse(page(values));
  };
  const ui = createAEmotionM1Ui({ root, window: dom.window, runId: RUN_ID, fetchImpl, getProjection: projection, prefillWorkbench() {} });
  await ui.refresh();
  click(dom.window, root.querySelector(`[data-aemotion-open="${values[0].eventId}"]`));
  await wait(0);
  await ui.markResolvedIfPending();
  assert.equal(requests.some((request) => request.url.includes("/resolved")), false, "read-only 世界局势 must not mark events resolved from later ordinary actions");
  assert.equal(ui.getState().items[0].isResolved, false);
  assert.equal(requests.some((request) => /\/decision|\/actions\/maneuver/u.test(request.url)), false);
  ui.destroy();
  dom.window.close();
});

test("M2 detail and receipt failures remain fail-closed without opening cards or mutating receipts", async (t) => {
  const cases = [
    {
      name: "detail 409",
      fetchFor: (value) => async (url) => /\?projectionVersion=/u.test(String(url))
        ? jsonResponse({ code: "STALE_INTERACTION_PROJECTION" }, 409)
        : jsonResponse(page([value])),
      expectedAckCalls: 0
    },
    {
      name: "detail network failure",
      fetchFor: (value) => async (url) => {
        if (/\?projectionVersion=/u.test(String(url))) throw new Error("network down");
        return jsonResponse(page([value]));
      },
      expectedAckCalls: 0
    },
    {
      name: "stale detail projection",
      fetchFor: (value) => async (url) => /\?projectionVersion=/u.test(String(url))
        ? jsonResponse({ ...value, projectionVersion: value.projectionVersion + 1 })
        : jsonResponse(page([value])),
      expectedAckCalls: 0
    },
    {
      name: "ack 409",
      fetchFor: (value, requests) => async (url, init = {}) => {
        requests.push({ url: String(url), method: init.method || "GET" });
        if (String(url).includes("/ack")) return jsonResponse({ code: "STALE_INTERACTION_PROJECTION" }, 409);
        if (/\?projectionVersion=/u.test(String(url))) return jsonResponse(value);
        return jsonResponse(page([value]));
      },
      expectedAckCalls: 1
    },
    {
      name: "ack malformed receipt",
      fetchFor: (value, requests) => async (url, init = {}) => {
        requests.push({ url: String(url), method: init.method || "GET" });
        if (String(url).includes("/ack")) return jsonResponse({
          eventId: `${value.eventId}-wrong`,
          projectionVersion: value.projectionVersion,
          seenAt: "not-an-iso-date",
          acknowledgedAt: new Date().toISOString(),
          resolvedAt: null
        });
        if (/\?projectionVersion=/u.test(String(url))) return jsonResponse(value);
        return jsonResponse(page([value]));
      },
      expectedAckCalls: 1
    }
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const { dom, root } = fixture();
      const value = item(1);
      const requests = [];
      const baseFetch = scenario.fetchFor(value, requests);
      const fetchImpl = async (url, init = {}) => {
        if (!scenario.name.startsWith("ack ")) requests.push({ url: String(url), method: init.method || "GET" });
        return baseFetch(url, init);
      };
      const ui = createAEmotionM1Ui({ root, window: dom.window, runId: RUN_ID, fetchImpl, getProjection: projection, prefillWorkbench() {} });
      await ui.refresh();
      const before = structuredClone(ui.getState().items[0]);
      click(dom.window, root.querySelector(`[data-aemotion-open="${value.eventId}"]`));
      await wait(0);

      assert.equal(root.querySelector('[data-testid="aemotion-suspicious_trace"]'), null);
      assert.equal(root.querySelector("[data-aemotion-world-situation-detail]"), null);
      assert.equal(ui.getState().activeEventId, "");
      assert.equal(ui.getState().items[0].isUnread, before.isUnread);
      assert.equal(ui.getState().items[0].isAcknowledged, before.isAcknowledged);
      assert.equal(ui.getState().items[0].isResolved, before.isResolved);
      assert.equal(requests.filter((request) => request.url.includes("/ack")).length, scenario.expectedAckCalls);
      ui.destroy();
      dom.window.close();
    });
  }
});

test("read-only M2 detail stays open when ack fails and never renders defer controls", async () => {
  const { dom, root } = fixture();
  const value = item(1);
  let ackCount = 0;
  const second = createAEmotionM1Ui({
    root,
    window: dom.window,
    runId: RUN_ID,
    fetchImpl: async (url) => {
      if (String(url).includes("/ack")) {
        ackCount += 1;
        return ackCount === 1
          ? jsonResponse({ eventId: value.eventId, projectionVersion: 2, seenAt: new Date().toISOString(), acknowledgedAt: new Date().toISOString(), resolvedAt: null })
          : jsonResponse({ code: "STALE_INTERACTION_PROJECTION" }, 409);
      }
      if (/\?projectionVersion=/u.test(String(url))) return jsonResponse(value);
      return jsonResponse(page([value]));
    },
    getProjection: projection,
    prefillWorkbench() {}
  });
  await second.refresh();
  click(dom.window, root.querySelector(`[data-aemotion-open="${value.eventId}"]`));
  await wait(0);
  assert.equal(second.getState().activeEventId, value.eventId);
  assert.equal(root.querySelector('[data-aemotion-response="DEFER_RESPONSE"]'), null);
  click(dom.window, root.querySelector(`[data-aemotion-open="${value.eventId}"]`));
  await wait(0);
  assert.equal(second.getState().activeEventId, value.eventId, "failed ack on reopening must leave existing read-only detail unchanged");
  second.destroy();
  dom.window.close();
});

test("M2 seen and resolved receipts require valid monotonic server timestamps", async () => {
  const { dom, root } = fixture();
  const value = item(1);
  const ackTime = "2026-08-10T05:11:00.000Z";
  let resolvedRequested = false;
  const fetchImpl = async (url) => {
    if (String(url).includes("/seen")) return jsonResponse({
      eventId: value.eventId,
      projectionVersion: value.projectionVersion,
      seenAt: null,
      acknowledgedAt: null,
      resolvedAt: null
    });
    if (String(url).includes("/ack")) return jsonResponse({
      eventId: value.eventId,
      projectionVersion: value.projectionVersion,
      seenAt: ackTime,
      acknowledgedAt: ackTime,
      resolvedAt: null
    });
    if (String(url).includes("/resolved")) {
      resolvedRequested = true;
      return jsonResponse({
        eventId: value.eventId,
        projectionVersion: value.projectionVersion,
        seenAt: ackTime,
        acknowledgedAt: ackTime,
        resolvedAt: "2026-08-10T05:10:00.000Z"
      });
    }
    if (/\?projectionVersion=/u.test(String(url))) return jsonResponse(value);
    return jsonResponse(page([value]));
  };
  const ui = createAEmotionM1Ui({ root, window: dom.window, runId: RUN_ID, fetchImpl, getProjection: projection, prefillWorkbench() {} });
  await ui.refresh();
  await wait(1_100);
  assert.equal(ui.getState().items[0].isUnread, true, "invalid seen receipt must not update local unread state");

  click(dom.window, root.querySelector(`[data-aemotion-open="${value.eventId}"]`));
  await wait(0);
  assert.equal(ui.getState().activeEventId, value.eventId);
  await ui.markResolvedIfPending();
  assert.equal(resolvedRequested, false, "read-only 世界局势 must not request resolved receipts from open details");
  assert.equal(ui.getState().items[0].isResolved, false);
  ui.destroy();
  dom.window.close();
});
