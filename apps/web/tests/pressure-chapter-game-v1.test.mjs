import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { bootGamePage } from "../public/game-bootstrap.js";
import {
  PRESSURE_CHAPTER_PHASE1_SCOPE,
  PRESSURE_CHAPTER_PHASE1_ARTIFACT_VERSION,
  PressureMainGameStorageV1,
  buildPressureDecisionCommandV1,
  modalDedupeKeyV1,
  orderPressureModalQueueV1,
  pressureProjectionToMainGameViewV1,
  renderPressureKeyModalV1,
  renderPressureStateCardV1,
  selectPressureCenterCardV1,
  validatePressureProjectionV1
} from "../public/pressure-chapter-game-v1.js";
import {
  PRESSURE_WORKBENCH_BRIDGE_SCOPE_V1,
  buildPressureManeuverPanelV1,
  pressureWorkbenchToExistingManeuverTypeV1
} from "../public/pressure-chapter-workbench-v1.js";

const HASH = "a".repeat(64);
const FENCE = "b".repeat(64);
const VIEWER = "zhejiang_governor";

function action(code, label, preferredEntry, consumesManeuverOnSubmit = true) {
  return { code, label, preferredEntry, consumesManeuverOnSubmit };
}

function stateCard(type, eventId) {
  const catalog = {
    CROSS_IMPACT: {
      accent: "PURPLE",
      title: "他人的行动影响了你的处境",
      summary: "送达总督府的粮册出现异常，部分页面可能被替换。",
      blockA: { title: "影响", lines: ["改桑进度暂时停滞", "皇帝信任下降 6"] },
      blockB: { title: "你知道", lines: ["来源尚未确认", "巡抚与县令都接触过账册"] },
      actions: [
        action("INVESTIGATE_SOURCE", "派遣调查", "INVESTIGATE"),
        action("PUBLIC_QUESTION", "公开质问", "TALK"),
        action("DEFER", "暂不回应", "DEFER", false)
      ]
    },
    PROMISE_BROKEN: {
      accent: "ORANGE_RED",
      title: "承诺破裂",
      summary: "巡抚没有兑现承诺，县令只交出了转抄副本。",
      blockA: { title: "结果", lines: ["改革进度受阻", "皇帝信任风险上升"] },
      blockB: { title: "你获得", lines: ["巡抚手令抄录", "一次公开质问机会"] },
      actions: [
        action("RETALIATE_NOW", "立即反击", "TALK"),
        action("HIDE_FOR_NOW", "暂时隐瞒", "PLAN"),
        action("HANDLE_LATER", "稍后处理", "DEFER", false)
      ]
    },
    CRISIS: {
      accent: "ORANGE_RED",
      title: "你正在失去主持权",
      summary: "皇帝信任已进入危险区间，再出现一次公开治理失败，你将失去改革主持权。",
      blockA: { title: "危险来源", lines: ["账册异常被朝廷注意", "巡抚提交的副本仍有疑点"] },
      blockB: { title: "你可以", lines: ["使用筹码稳定信任", "立即派遣调查"] },
      actions: [
        action("RESPOND_NOW", "立刻应对", "TOKEN"),
        action("HANDLE_LATER", "稍后处理", "DEFER", false),
        action("VIEW_DETAILS", "查看详情", "INVESTIGATE", false)
      ]
    },
    STAGE_VICTORY: {
      accent: "GREEN",
      title: "你夺回了主动权",
      summary: "原始粮册已经落入你手中，巡抚暂时无法继续控制奏报口径。",
      blockA: { title: "收益", lines: ["改桑进度 +12", "你获得新的质问主动权"] },
      blockB: { title: "对手受限", lines: ["巡抚难以继续控制口径", "县令开始动摇"] },
      actions: [
        action("CONTINUE_ADVANCE", "继续推进", "PLAN"),
        action("VIEW_LATER", "稍后查看", "DEFER", false),
        action("KEEP_LOW_PROFILE", "先保持低调", "DEFER", false)
      ]
    }
  }[type];
  return {
    id: `card:${eventId}:${type}`,
    type,
    accent: catalog.accent,
    title: catalog.title,
    summary: catalog.summary,
    blockA: catalog.blockA,
    blockB: catalog.blockB,
    primaryAction: catalog.actions[0],
    secondaryAction: catalog.actions[1],
    tertiaryAction: catalog.actions[2],
    sourceEventId: eventId
  };
}

function feedItem({
  type = "CROSS_IMPACT",
  eventSequence = 1,
  severity = "MAJOR",
  presentation = "CENTER_CARD",
  modal = false,
  disclosure = modal ? "CONFIRMED" : "HIDDEN"
} = {}) {
  const eventId = `evt-${type.toLowerCase()}-${eventSequence}`;
  const centerCard = stateCard(type, eventId);
  const triggerId = `trigger-${type.toLowerCase()}`;
  const priority = modal ? { CRISIS: 300, PROMISE_BROKEN: 200, STAGE_VICTORY: 100 }[type] : null;
  return {
    schemaVersion: "a_emotion_viewer_projection_v1",
    eventId,
    projectionVersion: 1,
    roomId: "run-pressure",
    runId: "run-pressure",
    viewerSeatId: VIEWER,
    category: "RELATED",
    disclosure,
    severity,
    title: centerCard.title,
    safeSummary: centerCard.summary,
    statusLabel: disclosure === "CONFIRMED" ? "已确认" : "来源未知",
    visibleImpacts: [{ effectCode: "EMPEROR_TRUST_DELTA", label: "皇帝信任", value: "-6" }],
    knownFactRefs: ["fact.viewer.safe"],
    responseOptions: [centerCard.primaryAction, centerCard.secondaryAction, centerCard.tertiaryAction],
    recommendedPresentation: modal ? "KEY_MODAL" : presentation,
    centerCard,
    keyModal: modal ? {
      id: `modal:${eventId}`,
      type,
      priority,
      triggerId,
      stateVersion: eventSequence,
      dedupeKey: modalDedupeKeyV1(VIEWER, type, triggerId, eventSequence),
      card: centerCard
    } : null,
    eventSequence,
    occurredAt: "2026-08-12T12:00:00.000Z",
    projectionHash: HASH,
    isUnread: true,
    isAcknowledged: false,
    isResolved: false
  };
}

function projection(items = [], overrides = {}) {
  const runId = overrides.runId || "run-pressure";
  const normalizedItems = items.map((item) => ({ ...item, roomId: runId, runId }));
  return {
    schemaVersion: "pressure_chapter_game_projection_v1",
    projectionVersion: overrides.projectionVersion || 1,
    roomId: runId,
    runId,
    route: {
      routeHash: HASH,
      participantMode: "SOLO",
      runtimeProfile: "PRESSURE_CHAPTER_V1",
      contentPackageVersion: "sangtian-pressure-v1",
      controlTopologyVersion: "six-seat-control-v1"
    },
    chapter: {
      chapterRuntimeId: `${runId}:N1`, chapterId: "N1", chapterNumber: 1,
      title: "九堰将决", phase: "ACTIVE", workingRevision: 0
    },
    viewer: {
      seatId: VIEWER, roleName: "浙江总督",
      control: {
        mode: "HUMAN_ACTIVE", controlEpoch: 1, canSubmit: true, canReclaim: false,
        submissionFenceToken: FENCE, reclaimFenceToken: null
      }
    },
    metrics: [
      ["fiscal_military", "国库银两", 42, "42", "DEFAULT"],
      ["civilian_land", "民心", 55, "55", "GOOD"],
      ["evidence_responsibility", "粮价", 72, "72", "WARN"],
      ["mulberry_silk", "改桑进度", overrides.progress ?? 0, `${overrides.progress ?? 0}%`, "GOOD"],
      ["court_imperial_face", "皇帝信任", overrides.trust ?? 43, String(overrides.trust ?? 43), overrides.trust === 18 ? "DANGER" : "DEFAULT"]
    ].map(([trackId, label, value, displayValue, tone]) => ({ trackId, label, value, displayValue, tone })),
    situation: {
      goal: "获取原始粮册，保全治理合法权",
      risk: "朝廷已关注账册异常",
      judgment: "巡抚与县令都接触过账册"
    },
    resources: [
      { resourceId: "silver", label: "银两", value: 42, displayValue: "42 万两" },
      { resourceId: "grain", label: "粮草", value: 23, displayValue: "23 万石" },
      { resourceId: "soldiers", label: "兵丁", value: 4, displayValue: "4/5" },
      { resourceId: "staff", label: "幕僚", value: 4, displayValue: "4 人" },
      { resourceId: "reports", label: "密报", value: 2, displayValue: "2 条" }
    ],
    tokens: [{ tokenId: "seal", label: "田契图纸（半页）", description: "可作为田亩凭证", quantity: 1, available: true }],
    decision: {
      decisionPointId: `${runId}:decision:N1`, mode: "SOLO_BEAT", requirement: "REQUIRED",
      title: "你要如何应对？", summary: "你的选择会立即改变局势。", expectedWorkingRevision: 0,
      options: [
        { code: "INVESTIGATE_SOURCE", label: "由总督府复核清单", description: "巡抚和县令只能派见证人参加。", actionType: "INVESTIGATE_SOURCE", preferredEntry: "INVESTIGATE" },
        { code: "PUBLIC_QUESTION", label: "先公开质问经手方", description: "要求相关方说明账册流转。", actionType: "PUBLIC_QUESTION", preferredEntry: "TALK" },
        { code: "RESPOND_NOW", label: "使用筹码稳定信任", description: "以现有凭证压住风险。", actionType: "RESPOND_NOW", preferredEntry: "TOKEN" },
        { code: "CONTINUE_ADVANCE", label: "继续推进", description: "利用阶段成果规划下一步。", actionType: "CONTINUE_ADVANCE", preferredEntry: "PLAN" }
      ],
      submitLabel: "提交决策", customActionAllowed: true
    },
    capabilities: {
      canSubmitDecision: true, canTalk: true, canInvestigate: true, canUseToken: true,
      canPlan: true, canReclaimControl: false,
      allowedActionTypes: ["INVESTIGATE_SOURCE", "PUBLIC_QUESTION", "RESPOND_NOW", "CONTINUE_ADVANCE", "RETALIATE_NOW", "HIDE_FOR_NOW", "VIEW_DETAILS"]
    },
    narrative: {
      status: "PUBLISHED", projectionKind: "GENESIS_NARRATIVE", sourceAuthority: "GENESIS",
      sourceId: `${runId}:genesis`, sourceCommitHash: HASH,
      text: "嘉靖三十五年，粮册风波已经进入总督府。",
      contentHash: HASH, renderMode: "AUTHORED_FALLBACK"
    },
    feedPage: {
      schemaVersion: "a_emotion_feed_page_v1", roomId: runId, runId,
      viewerSeatId: VIEWER, items: normalizedItems,
      unreadCount: normalizedItems.filter((item) => item.isUnread).length,
      nextCursor: null,
      serverSequence: Math.max(0, ...normalizedItems.map((item) => item.eventSequence))
    },
    projectionHash: HASH
  };
}

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("Phase 1 v4 is explicitly UI_ONLY and retains only the approved existing-shell enhancement", async () => {
  assert.equal(PRESSURE_CHAPTER_PHASE1_SCOPE, "UI_ONLY");
  assert.equal(PRESSURE_CHAPTER_PHASE1_ARTIFACT_VERSION, "phase1-v4");
  assert.equal(PRESSURE_WORKBENCH_BRIDGE_SCOPE_V1, "EXISTING_WORKBENCH_ONLY");
  const [gameSource, bridgeSource, css, bootstrap, index] = await Promise.all([
    readFile(new URL("../public/pressure-chapter-game-v1.js", import.meta.url), "utf8"),
    readFile(new URL("../public/pressure-chapter-workbench-v1.js", import.meta.url), "utf8"),
    readFile(new URL("../public/pressure-chapter-game-v1.css", import.meta.url), "utf8"),
    readFile(new URL("../public/game-bootstrap.js", import.meta.url), "utf8"),
    readFile(new URL("../public/index.html", import.meta.url), "utf8")
  ]);
  for (const forbidden of [
    "createPressureChapterGameV1", "renderPressureChapterGameHtmlV1",
    "pc-left-rail", "pc-center-stage", "pc-right-rail", "game-page-shell"
  ]) assert.doesNotMatch(gameSource, new RegExp(forbidden));
  assert.doesNotMatch(gameSource, /<aside|<header class="causal-topbar|class="status-strip|class="maneuver-panel/);
  assert.doesNotMatch(gameSource, /ROLE_PRESENTATION|METRIC_PRESENTATION|zhejiang_administration|qingliu_law|cabinet_finance|jiangnan_merchant|sili_weaving/);
  assert.doesNotMatch(bridgeSource, /innerHTML|createElement|<section|<aside|<main/);
  for (const forbiddenSelector of [".causal-left", ".causal-right", ".status-strip", ".maneuver-panel", ".situation-feed", ".aemotion-world-situation"]) {
    assert.doesNotMatch(css, new RegExp(forbiddenSelector.replace(".", "\\.")));
  }
  assert.match(css, /pressure-state-card--promise-broken[\s\S]*--pressure-accent:\s*#6a36d5/i);
  assert.match(css, /pressure-state-card--crisis[\s\S]*--pressure-accent:\s*#e24c2e/i);
  assert.match(css, /pressure-state-card--stage-victory[\s\S]*--pressure-accent:\s*#176b3a/i);
  assert.match(css, /pressure-center-enhancement\s*>\s*\.pressure-state-card[\s\S]*max-height:\s*calc\(100% - 2px\)/i);
  assert.match(bootstrap, /createStoryApp\(\{ root, window: win, storage \}\)/);
  assert.match(bootstrap, /attachPressureChapterEnhancementsV1/);
  assert.match(gameSource, /state\.activeCenterCard && !modalActive/);
  assert.match(gameSource, /root\.classList\.toggle\(MODAL_ACTIVE_CLASS, modalActive\)/);
  assert.match(css, /\.pressure-modal-active \[data-pressure-center-enhancement\][\s\S]*?display:\s*none !important/);
  assert.equal((index.match(/pressure-chapter-game-v1\.css/g) || []).length, 1);
  assert.doesNotMatch(index, /pressure-chapter-workbench-v1\.css/);
});

test("Pressure adapter preserves the approved app.js view contract without exposing authority fields", () => {
  const input = projection([]);
  const view = pressureProjectionToMainGameViewV1(input);
  assert.equal(view.continuousV2, true);
  assert.equal(view.player.roleName, "浙江总督");
  assert.deepEqual(view.player.resources.map(([label]) => label), ["银两", "粮草", "兵丁", "幕僚", "密报"]);
  assert.deepEqual(view.dashboard.statusMetrics.map((item) => item.label), ["国库银两", "民心", "粮价", "改桑进度", "皇帝信任"]);
  assert.equal(view.presentation.sceneBackground, "/assets/game/sangtian/background.png");
  assert.equal(Object.prototype.hasOwnProperty.call(view, "pressureProjection"), false);
  const visibleView = JSON.stringify(view);
  assert.doesNotMatch(visibleView, new RegExp(FENCE));
  assert.doesNotMatch(visibleView, /routeHash|submissionFenceToken|projectionHash/);
  assert.equal(buildPressureManeuverPanelV1(input).investigate.enabled, true);
  assert.equal(pressureWorkbenchToExistingManeuverTypeV1("INVESTIGATE"), "investigate");
});

test("major CROSS_IMPACT auto-selects while minor FEED_ONLY stays Feed-first", () => {
  const minor = feedItem({ severity: "MINOR", presentation: "FEED_ONLY" });
  const major = feedItem({ eventSequence: 2, severity: "MAJOR", presentation: "FEED_ONLY" });
  assert.equal(selectPressureCenterCardV1([minor]), null);
  assert.equal(selectPressureCenterCardV1([minor, major])?.sourceEventId, major.eventId);
  const hidden = new Set([major.eventId]);
  assert.equal(selectPressureCenterCardV1([major], new Set(), hidden), null);
});

test("modal priority and exact dedupe are CRISIS 300 > PROMISE 200 > STAGE 100", () => {
  const stage = feedItem({ type: "STAGE_VICTORY", eventSequence: 3, severity: "MAJOR", modal: true });
  const promise = feedItem({ type: "PROMISE_BROKEN", eventSequence: 2, severity: "CRITICAL", modal: true });
  const crisis = feedItem({ type: "CRISIS", eventSequence: 1, severity: "CRITICAL", modal: true });
  const queue = orderPressureModalQueueV1([stage, promise, crisis]);
  assert.deepEqual(queue.map((item) => item.type), ["CRISIS", "PROMISE_BROKEN", "STAGE_VICTORY"]);
  assert.equal(crisis.keyModal.dedupeKey, `${VIEWER}:CRISIS:trigger-crisis:1`);
  const presented = new Set([crisis.keyModal.dedupeKey]);
  assert.deepEqual(orderPressureModalQueueV1([stage, promise, crisis], presented).map((item) => item.type), ["PROMISE_BROKEN", "STAGE_VICTORY"]);
  assert.equal(selectPressureCenterCardV1([crisis], presented)?.sourceEventId, crisis.eventId);
});

test("approved 03-06 markup contains only center-card/modal UI and no internal identifiers", () => {
  const cross = feedItem({ severity: "MAJOR" });
  const crisis = feedItem({ type: "CRISIS", severity: "CRITICAL", modal: true });
  const centerHtml = renderPressureStateCardV1(cross.centerCard);
  const modalHtml = renderPressureKeyModalV1(crisis.keyModal);
  assert.match(centerHtml, /他人的行动影响了你的处境/);
  assert.match(centerHtml, /影响/);
  assert.match(centerHtml, /你知道/);
  assert.match(centerHtml, /派遣调查/);
  assert.match(centerHtml, /data-card-type="CROSS_IMPACT"/);
  assert.match(modalHtml, /你正在失去主持权/);
  assert.match(modalHtml, /data-modal-type="CRISIS"/);
  assert.match(centerHtml, /data-pressure-title-icon="CROSS_IMPACT"/);
  assert.match(modalHtml, /data-pressure-title-icon="CRISIS"/);
  assert.match(modalHtml, /pressure-title-decor--left/);
  assert.match(modalHtml, /pressure-title-decor--right/);
  for (const privateValue of [cross.eventId, crisis.eventId, crisis.keyModal.dedupeKey, crisis.keyModal.triggerId, HASH, FENCE]) {
    assert.doesNotMatch(centerHtml + modalHtml, new RegExp(privateValue));
  }
  assert.doesNotMatch(centerHtml + modalHtml, /causal-left|causal-right|status-strip|maneuver-panel/);
});

test("normal decision keeps sourceEventId null; response workbench carries the viewer-safe event exactly once", async () => {
  const cross = feedItem({ severity: "MAJOR", presentation: "FEED_ONLY" });
  const input = projection([cross]);
  const normal = buildPressureDecisionCommandV1({
    projection: input,
    optionCode: "INVESTIGATE_SOURCE",
    customText: null,
    sourceEventId: null,
    responseActionCode: null,
    idempotencyKey: "normal-decision-key"
  });
  assert.equal(normal.sourceEventId, null);
  assert.equal(normal.responseActionCode, null);

  let postCount = 0;
  let submitted = null;
  const storage = new PressureMainGameStorageV1({
    runId: input.runId,
    initialProjection: input,
    createIdempotencyKey: () => "response-action-key",
    fetchImpl: async (_url, init) => {
      postCount += 1;
      submitted = JSON.parse(init.body);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return response({
        schemaVersion: "pressure_chapter_submit_decision_http_response_v1",
        idempotencyKey: "response-action-key",
        projection: input
      });
    }
  });
  storage.setResponseContext(cross, cross.centerCard.primaryAction);
  const command = { maneuverType: "investigate", intentKey: "INVESTIGATE_SOURCE" };
  await Promise.all([
    storage.submitManeuver(storage.toView(), command),
    storage.submitManeuver(storage.toView(), command)
  ]);
  assert.equal(postCount, 1);
  assert.equal(submitted.sourceEventId, cross.eventId);
  assert.equal(submitted.optionCode, "INVESTIGATE_SOURCE");
  assert.equal(submitted.responseActionCode, "INVESTIGATE_SOURCE");
  assert.equal(storage.getResponseContext(), null);
});

test("invalid modal trigger projections fail closed on the UI boundary", () => {
  const hiddenPromise = feedItem({ type: "PROMISE_BROKEN", modal: true, disclosure: "HIDDEN", severity: "CRITICAL" });
  const nonCriticalCrisis = feedItem({ type: "CRISIS", modal: true, disclosure: "CONFIRMED", severity: "MAJOR" });
  assert.throws(() => validatePressureProjectionV1(projection([hiddenPromise])), /confirmed key-modal projection/);
  assert.throws(() => validatePressureProjectionV1(projection([nonCriticalCrisis])), /CRISIS must be critical/);
});

test("v4 source files are UTF-8 Chinese and contain no common mojibake sequences", async () => {
  const sources = await Promise.all([
    readFile(new URL("./pressure-chapter-game-v1.browser.py", import.meta.url), "utf8"),
    readFile(new URL("./pressure-chapter-game-v1.existing-shell.test.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/pressure-chapter-game-v1.js", import.meta.url), "utf8")
  ]);
  const joined = sources.join("\n");
  assert.match(joined, /他人的行动影响了你的处境/);
  assert.match(joined, /承诺破裂/);
  assert.match(joined, /你正在失去主持权/);
  assert.match(joined, /你夺回了主动权/);
  assert.doesNotMatch(joined, /(?:锛|鏄|鐨|绛|浜|鍙|浣|鏈|璇|鎴|鍏|缁|棰|闄|驳)/u);
  assert.doesNotMatch(joined, /\uFFFD/u);
});

test("game-bootstrap Pressure branch calls the existing createStoryApp renderer, then attaches enhancement", async () => {
  const input = projection([]);
  const calls = [];
  const root = { innerHTML: "", querySelector() { return null; } };
  const win = {
    location: { search: `?runId=${input.runId}`, pathname: "/game", hash: "", assign() {} },
    document: { cookie: "" },
    sessionStorage: { length: 0, key() { return null; }, removeItem() {} }
  };
  class StubStorage {
    constructor(options) { calls.push(["storage", options.runId]); }
  }
  const app = {
    async boot() { calls.push(["app.boot"]); },
    getState() { return {}; }
  };
  const result = await bootGamePage({
    root,
    window: win,
    fetchImpl: async () => response(input),
    loadPressureChapter: async () => ({
      PressureMainGameStorageV1: StubStorage,
      attachPressureChapterEnhancementsV1({ storyApp }) {
        calls.push(["enhancer.attach", storyApp === app]);
        return { boot() { calls.push(["enhancer.boot"]); } };
      }
    }),
    loadSolo: async () => ({
      createStoryApp({ storage }) {
        calls.push(["createStoryApp", storage instanceof StubStorage]);
        return app;
      }
    })
  });
  assert.equal(result, app);
  assert.deepEqual(calls, [
    ["storage", input.runId],
    ["createStoryApp", true],
    ["app.boot"],
    ["enhancer.attach", true],
    ["enhancer.boot"]
  ]);
});
