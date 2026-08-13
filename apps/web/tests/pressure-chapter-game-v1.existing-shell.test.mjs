/* UTF-8 source: keep approved Chinese copy readable on every platform. */
import assert from "node:assert/strict";
import test from "node:test";
let JSDOM;
let createStoryApp;
let fullRepositoryDependencyError = null;
try {
  ({ JSDOM } = await import("jsdom"));
  ({ createStoryApp } = await import("../public/app.js"));
} catch (error) {
  fullRepositoryDependencyError = error;
}
import {
  PressureMainGameStorageV1,
  attachPressureChapterEnhancementsV1,
  modalDedupeKeyV1
} from "../public/pressure-chapter-game-v1.js";

const HASH = "a".repeat(64);
const FENCE = "b".repeat(64);
const VIEWER = "zhejiang_governor";
const MOJIBAKE = /(?:\u951b|\u93c4|\u9428|\u7edb|\u6d5c|\u9359|\u6d63|\u93c8|\u7487|\u93b4|\u934f|\u7f01|\u68f0|\u95c4|\u9a73|\uFFFD)/u;

function action(code, label, preferredEntry, consumesManeuverOnSubmit = true) {
  return { code, label, preferredEntry, consumesManeuverOnSubmit };
}

function card(type, eventId) {
  const values = {
    CROSS_IMPACT: [
      "PURPLE", "他人的行动影响了你的处境", "送达总督府的粮册出现异常，部分页面可能被替换。",
      { title: "影响", lines: ["改桑进度暂时停滞", "皇帝信任下降 6"] },
      { title: "你知道", lines: ["来源尚未确认", "巡抚与县令都接触过账册"] },
      [action("INVESTIGATE_SOURCE", "派遣调查", "INVESTIGATE"), action("PUBLIC_QUESTION", "公开质问", "TALK"), action("DEFER", "暂不回应", "DEFER", false)]
    ],
    PROMISE_BROKEN: [
      "ORANGE_RED", "承诺破裂", "巡抚没有兑现承诺，县令只交出了转抄副本。",
      { title: "结果", lines: ["改革进度受阻", "皇帝信任风险上升"] },
      { title: "你获得", lines: ["巡抚手令抄录", "一次公开质问机会"] },
      [action("RETALIATE_NOW", "立即反击", "TALK"), action("HIDE_FOR_NOW", "暂时隐瞒", "PLAN"), action("HANDLE_LATER", "稍后处理", "DEFER", false)]
    ],
    CRISIS: [
      "ORANGE_RED", "你正在失去主持权", "皇帝信任已进入危险区间，再出现一次公开治理失败，你将失去改革主持权。",
      { title: "危险来源", lines: ["账册异常被朝廷注意", "巡抚提交的副本仍有疑点"] },
      { title: "你可以", lines: ["使用筹码稳定信任", "立即派遣调查"] },
      [action("RESPOND_NOW", "立刻应对", "TOKEN"), action("HANDLE_LATER", "稍后处理", "DEFER", false), action("VIEW_DETAILS", "查看详情", "INVESTIGATE", false)]
    ],
    STAGE_VICTORY: [
      "GREEN", "你夺回了主动权", "原始粮册已经落入你手中，巡抚暂时无法继续控制奏报口径。",
      { title: "收益", lines: ["改桑进度 +12", "你获得新的质问主动权"] },
      { title: "对手受限", lines: ["巡抚难以继续控制口径", "县令开始动摇"] },
      [action("CONTINUE_ADVANCE", "继续推进", "PLAN"), action("VIEW_LATER", "稍后查看", "DEFER", false), action("KEEP_LOW_PROFILE", "先保持低调", "DEFER", false)]
    ]
  }[type];
  return {
    id: `card:${eventId}:${type}`,
    type,
    accent: values[0],
    title: values[1],
    summary: values[2],
    blockA: values[3],
    blockB: values[4],
    primaryAction: values[5][0],
    secondaryAction: values[5][1],
    tertiaryAction: values[5][2],
    sourceEventId: eventId
  };
}

function item({ type = "CROSS_IMPACT", sequence = 1, severity = "MAJOR", modal = false } = {}) {
  const eventId = `evt-${type.toLowerCase()}-${sequence}`;
  const centerCard = card(type, eventId);
  const triggerId = `trigger-${type.toLowerCase()}`;
  return {
    schemaVersion: "a_emotion_viewer_projection_v1",
    eventId,
    projectionVersion: 1,
    roomId: "run-pressure",
    runId: "run-pressure",
    viewerSeatId: VIEWER,
    category: "RELATED",
    disclosure: modal ? "CONFIRMED" : "HIDDEN",
    severity,
    title: centerCard.title,
    safeSummary: centerCard.summary,
    statusLabel: modal ? "已确认" : "来源未知",
    visibleImpacts: [{ effectCode: "EMPEROR_TRUST_DELTA", label: "皇帝信任", value: "-6" }],
    knownFactRefs: ["fact.viewer.safe"],
    responseOptions: [centerCard.primaryAction, centerCard.secondaryAction, centerCard.tertiaryAction],
    recommendedPresentation: modal ? "KEY_MODAL" : "FEED_ONLY",
    centerCard,
    keyModal: modal ? {
      id: `modal:${eventId}`,
      type,
      priority: { CRISIS: 300, PROMISE_BROKEN: 200, STAGE_VICTORY: 100 }[type],
      triggerId,
      stateVersion: sequence,
      dedupeKey: modalDedupeKeyV1(VIEWER, type, triggerId, sequence),
      card: centerCard
    } : null,
    eventSequence: sequence,
    occurredAt: "2026-08-12T12:00:00.000Z",
    projectionHash: HASH,
    isUnread: true,
    isAcknowledged: false,
    isResolved: false
  };
}

function projection(items) {
  return {
    schemaVersion: "pressure_chapter_game_projection_v1",
    projectionVersion: 1,
    roomId: "run-pressure",
    runId: "run-pressure",
    route: { routeHash: HASH, participantMode: "SOLO", runtimeProfile: "PRESSURE_CHAPTER_V1", contentPackageVersion: "sangtian-pressure-v1", controlTopologyVersion: "six-seat-control-v1" },
    chapter: { chapterRuntimeId: "run-pressure:N1", chapterId: "N1", chapterNumber: 1, title: "九堰将决", phase: "ACTIVE", workingRevision: 0 },
    viewer: { seatId: VIEWER, roleName: "浙江总督", control: { mode: "HUMAN_ACTIVE", controlEpoch: 1, canSubmit: true, canReclaim: false, submissionFenceToken: FENCE, reclaimFenceToken: null } },
    metrics: [
      ["fiscal_military", "国库银两", 42, "42", "DEFAULT"],
      ["civilian_land", "民心", 55, "55", "GOOD"],
      ["evidence_responsibility", "粮价", 72, "72", "WARN"],
      ["mulberry_silk", "改桑进度", 0, "0%", "GOOD"],
      ["court_imperial_face", "皇帝信任", 43, "43", "DEFAULT"]
    ].map(([trackId, label, value, displayValue, tone]) => ({ trackId, label, value, displayValue, tone })),
    situation: { goal: "获取原始粮册，保全治理合法权", risk: "朝廷已关注账册异常", judgment: "巡抚与县令都接触过账册" },
    resources: [
      { resourceId: "silver", label: "银两", value: 42, displayValue: "42 万两" },
      { resourceId: "grain", label: "粮草", value: 23, displayValue: "23 万石" },
      { resourceId: "soldiers", label: "兵丁", value: 4, displayValue: "4/5" },
      { resourceId: "staff", label: "幕僚", value: 4, displayValue: "4 人" },
      { resourceId: "reports", label: "密报", value: 2, displayValue: "2 条" }
    ],
    tokens: [{ tokenId: "seal", label: "田契图纸（半页）", description: "可作为田亩凭证", quantity: 1, available: true }],
    decision: {
      decisionPointId: "run-pressure:decision:N1", mode: "SOLO_BEAT", requirement: "REQUIRED", title: "你要如何应对？", summary: "你的选择会立即改变局势。", expectedWorkingRevision: 0,
      options: [
        { code: "INVESTIGATE_SOURCE", label: "由总督府复核清单", description: "巡抚和县令只能派见证人参加。", actionType: "INVESTIGATE_SOURCE", preferredEntry: "INVESTIGATE" },
        { code: "PUBLIC_QUESTION", label: "先公开质问经手方", description: "要求相关方说明账册流转。", actionType: "PUBLIC_QUESTION", preferredEntry: "TALK" },
        { code: "RESPOND_NOW", label: "使用筹码稳定信任", description: "以现有凭证压住风险。", actionType: "RESPOND_NOW", preferredEntry: "TOKEN" },
        { code: "CONTINUE_ADVANCE", label: "继续推进", description: "利用阶段成果规划下一步。", actionType: "CONTINUE_ADVANCE", preferredEntry: "PLAN" }
      ], submitLabel: "提交决策", customActionAllowed: true
    },
    capabilities: { canSubmitDecision: true, canTalk: true, canInvestigate: true, canUseToken: true, canPlan: true, canReclaimControl: false, allowedActionTypes: ["INVESTIGATE_SOURCE", "PUBLIC_QUESTION", "RESPOND_NOW", "CONTINUE_ADVANCE", "RETALIATE_NOW", "HIDE_FOR_NOW", "VIEW_DETAILS"] },
    narrative: { status: "PUBLISHED", projectionKind: "GENESIS_NARRATIVE", sourceAuthority: "GENESIS", sourceId: "run-pressure:genesis", sourceCommitHash: HASH, text: "嘉靖三十五年，粮册风波已经进入总督府。", contentHash: HASH, renderMode: "AUTHORED_FALLBACK" },
    feedPage: { schemaVersion: "a_emotion_feed_page_v1", roomId: "run-pressure", runId: "run-pressure", viewerSeatId: VIEWER, items, unreadCount: items.length, nextCursor: null, serverSequence: Math.max(0, ...items.map((value) => value.eventSequence)) },
    projectionHash: HASH
  };
}

function response(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

async function mounted(input, { installExistingFeed = null } = {}) {
  const dom = new JSDOM('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><main id="app" class="causal-player-root"></main></body></html>', {
    url: "http://game.test/game?runId=run-pressure&debug=1",
    pretendToBeVisual: true,
    contentType: "text/html"
  });
  dom.window.__STORY_STREAM_DELAY_MULTIPLIER__ = 0;
  const root = dom.window.document.querySelector("#app");
  let posts = 0;
  let submitted = null;
  const storage = new PressureMainGameStorageV1({
    runId: input.runId,
    initialProjection: input,
    createIdempotencyKey: () => "existing-shell-response",
    fetchImpl: async (_url, init = {}) => {
      if (String(init.method || "GET").toUpperCase() === "POST") {
        posts += 1;
        submitted = JSON.parse(init.body);
        return response({ schemaVersion: "pressure_chapter_submit_decision_http_response_v1", idempotencyKey: submitted.idempotencyKey, projection: input });
      }
      return response(input);
    }
  });
  const app = createStoryApp({ root, window: dom.window, storage });
  await app.boot();
  if (typeof installExistingFeed === "function") installExistingFeed({ dom, root });
  const beforeEnhancement = {
    topbar: root.querySelector(".causal-topbar")?.outerHTML || "",
    status: root.querySelector(".status-strip")?.outerHTML || "",
    left: root.querySelector(".causal-left")?.outerHTML || "",
    right: root.querySelector(".causal-right")?.outerHTML || "",
    decision: root.querySelector('[data-testid="decision-zone"]')?.outerHTML || ""
  };
  const enhancement = attachPressureChapterEnhancementsV1({ root, window: dom.window, storyApp: app, storage });
  enhancement.boot();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 5));
  return { dom, root, app, storage, enhancement, beforeEnhancement, get posts() { return posts; }, get submitted() { return submitted; } };
}

if (fullRepositoryDependencyError) {
  test("actual approved app.js shell seam regression", {
    skip: `BLOCKED_FULL_REPOSITORY_CHECKOUT: ${fullRepositoryDependencyError.code || fullRepositoryDependencyError.message}`
  }, () => {});
} else {
test("existing app.js shell and 03–06 enhancement keep UTF-8 Chinese readable", async () => {
  const cross = item({ severity: "MAJOR" });
  const h = await mounted(projection([cross]));
  const visibleText = h.root.textContent || "";
  assert.match(visibleText, /当前目标/);
  assert.match(visibleText, /我的资源/);
  assert.match(visibleText, /你要如何应对/);
  assert.match(visibleText, /他人的行动影响了你的处境/);
  assert.doesNotMatch(visibleText, MOJIBAKE);
  h.enhancement.destroy();
  h.dom.window.close();
});

test("actual approved app.js shell is retained while 03-06 mount only at center/modal seams", async () => {
  const major = item({ severity: "MAJOR" });
  const h = await mounted(projection([major]));
  assert.ok(h.root.querySelector('[data-testid="story-shell"]'));
  assert.ok(h.root.querySelector('[data-testid="decision-zone"]'));
  assert.ok(h.root.querySelector('[data-testid="maneuver-panel"]'));
  assert.ok(h.root.querySelector('[data-testid="pressure-center-card"]')?.closest(".causal-center"));
  assert.equal(h.root.querySelector(".causal-topbar")?.outerHTML, h.beforeEnhancement.topbar);
  assert.equal(h.root.querySelector(".status-strip")?.outerHTML, h.beforeEnhancement.status);
  assert.equal(h.root.querySelector(".causal-left")?.outerHTML, h.beforeEnhancement.left);
  assert.equal(h.root.querySelector(".causal-right")?.outerHTML, h.beforeEnhancement.right);
  assert.equal(h.root.querySelector('[data-testid="decision-zone"]')?.outerHTML, h.beforeEnhancement.decision);
  assert.equal(h.root.querySelector(".pc-left-rail, .pc-center-stage, .pc-right-rail"), null);
  assert.doesNotMatch(h.root.innerHTML, new RegExp(FENCE));
  assert.doesNotMatch(h.root.innerHTML, new RegExp(HASH));
  assert.doesNotMatch(h.root.textContent || "", MOJIBAKE);

  h.root.querySelector('[data-pressure-card-action="primary"]').click();
  await new Promise((resolve) => h.dom.window.setTimeout(resolve, 8));
  assert.ok(h.root.querySelector('[data-testid="maneuver-investigate-workbench"]'));
  assert.equal(h.root.querySelectorAll('[data-testid="maneuver-panel"]').length, 1);
  h.root.querySelector("#maneuverSubmit").click();
  h.root.querySelector("#maneuverSubmit").click();
  await new Promise((resolve) => h.dom.window.setTimeout(resolve, 30));
  assert.equal(h.posts, 1);
  assert.equal(h.submitted.sourceEventId, major.eventId);
  assert.equal(h.submitted.responseActionCode, major.responseOptions[0].code);
  h.enhancement.destroy();
  h.dom.window.close();
});

test("minor CROSS_IMPACT opens from an existing Feed seam without rewriting that Feed", async () => {
  const minor = item({ severity: "MINOR" });
  let feed;
  const h = await mounted(projection([minor]), {
    installExistingFeed({ dom, root }) {
      feed = dom.window.document.createElement("section");
      feed.dataset.testid = "situation-feed";
      feed.innerHTML = `<button type="button" data-pressure-feed-event-id="${minor.eventId}">既有 Feed 事件</button>`;
      root.querySelector(".causal-right").prepend(feed);
    }
  });
  assert.equal(h.root.querySelector("[data-pressure-center-enhancement]"), null);
  assert.equal(h.root.querySelector(".causal-right")?.outerHTML, h.beforeEnhancement.right);
  const before = feed.outerHTML;
  feed.querySelector("button").click();
  await new Promise((resolve) => h.dom.window.setTimeout(resolve, 5));
  assert.ok(h.root.querySelector('[data-testid="pressure-center-card"]'));
  assert.equal(feed.outerHTML, before);
  h.enhancement.destroy();
  h.dom.window.close();
});

test("each approved key modal hides the retained center surface and restores exactly one card when closed", async () => {
  const cases = [
    ["PROMISE_BROKEN", "pressure-modal-promise-broken", "tertiary"],
    ["CRISIS", "pressure-modal-crisis", "secondary"],
    ["STAGE_VICTORY", "pressure-modal-stage-victory", "secondary"]
  ];
  for (const [type, testId, closeSlot] of cases) {
    const event = item({ type, sequence: 1, severity: type === "STAGE_VICTORY" ? "MAJOR" : "CRITICAL", modal: true });
    const h = await mounted(projection([event]));
    assert.ok(h.root.querySelector(`[data-testid="${testId}"]`));
    assert.equal(h.enhancement.getState().activeCenterCard?.sourceEventId, event.eventId, `${type} retains center-card state`);
    assert.equal(h.root.querySelectorAll("[data-pressure-center-enhancement]").length, 0, `${type} must not mount a center enhancement beneath its modal`);
    assert.equal(h.root.querySelectorAll('[data-testid="pressure-center-card"]').length, 0, `${type} must not expose a duplicate center card while modal is active`);
    assert.equal(h.root.classList.contains("pressure-modal-active"), true);
    assert.equal(h.root.dataset.pressureModalActive, "true");
    assert.equal(h.root.querySelectorAll(".causal-topbar").length, 1);
    assert.equal(h.root.querySelectorAll(".causal-left").length, 1);
    assert.equal(h.root.querySelectorAll(".causal-center").length, 1);
    assert.equal(h.root.querySelectorAll(".causal-right").length, 1);
    assert.equal(h.root.querySelector(".causal-topbar")?.outerHTML, h.beforeEnhancement.topbar);
    assert.equal(h.root.querySelector(".causal-left")?.outerHTML, h.beforeEnhancement.left);
    assert.equal(h.root.querySelector(".causal-right")?.outerHTML, h.beforeEnhancement.right);

    h.root.querySelector(`[data-pressure-modal-action="${closeSlot}"]`).click();
    await new Promise((resolve) => h.dom.window.setTimeout(resolve, 5));
    assert.equal(h.root.querySelectorAll("[data-pressure-key-modal-layer]").length, 0);
    assert.equal(h.root.querySelectorAll("[data-pressure-center-enhancement]").length, 1);
    assert.equal(h.root.querySelectorAll('[data-testid="pressure-center-card"]').length, 1);
    assert.equal(h.root.querySelector('[data-testid="pressure-center-card"]')?.dataset.cardType, type);
    assert.equal(h.root.classList.contains("pressure-modal-active"), false);
    assert.equal(h.root.dataset.pressureModalActive, undefined);
    h.enhancement.destroy();
    h.dom.window.close();
  }
});

test("modal queue switches without center-card ghosting and restores only the final retained card", async () => {
  const crisis = item({ type: "CRISIS", sequence: 1, severity: "CRITICAL", modal: true });
  const promise = item({ type: "PROMISE_BROKEN", sequence: 2, severity: "CRITICAL", modal: true });
  const victory = item({ type: "STAGE_VICTORY", sequence: 3, severity: "MAJOR", modal: true });
  const h = await mounted(projection([victory, promise, crisis]));
  const transitions = [
    ["pressure-modal-crisis", "secondary", "pressure-modal-promise-broken"],
    ["pressure-modal-promise-broken", "tertiary", "pressure-modal-stage-victory"]
  ];
  for (const [currentTestId, closeSlot, nextTestId] of transitions) {
    assert.ok(h.root.querySelector(`[data-testid="${currentTestId}"]`));
    assert.equal(h.root.querySelectorAll("[data-pressure-key-modal-layer]").length, 1);
    assert.equal(h.root.querySelectorAll("[data-pressure-center-enhancement]").length, 0);
    assert.equal(h.root.querySelectorAll('[data-testid="pressure-center-card"]').length, 0);
    h.root.querySelector(`[data-pressure-modal-action="${closeSlot}"]`).click();
    await new Promise((resolve) => h.dom.window.setTimeout(resolve, 5));
    assert.ok(h.root.querySelector(`[data-testid="${nextTestId}"]`));
    assert.equal(h.root.querySelectorAll("[data-pressure-key-modal-layer]").length, 1);
    assert.equal(h.root.querySelectorAll("[data-pressure-center-enhancement]").length, 0);
    assert.equal(h.root.querySelectorAll('[data-testid="pressure-center-card"]').length, 0);
  }
  h.root.querySelector('[data-pressure-modal-action="secondary"]').click();
  await new Promise((resolve) => h.dom.window.setTimeout(resolve, 5));
  assert.equal(h.root.querySelectorAll("[data-pressure-key-modal-layer]").length, 0);
  assert.equal(h.root.querySelectorAll("[data-pressure-center-enhancement]").length, 1);
  assert.equal(h.root.querySelectorAll('[data-testid="pressure-center-card"]').length, 1);
  assert.equal(h.root.querySelector('[data-testid="pressure-center-card"]')?.dataset.cardType, "STAGE_VICTORY");
  h.enhancement.destroy();
  h.dom.window.close();
});

}
