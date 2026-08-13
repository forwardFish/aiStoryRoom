import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createStoryApp } from "../public/app.js";
import { bootGamePage } from "../public/game-bootstrap.js";
import {
  PressureMainGameStorageV1,
  pressureProjectionToMainGameViewV1,
} from "../public/pressure-main-game-storage-v1.js";

function projection({ runId = "run-pressure-main-shell", optionCode = "SEAL_AND_REVIEW" } = {}) {
  return {
    schemaVersion: "pressure_chapter_game_projection_v1",
    projectionVersion: 1,
    roomId: runId,
    runId,
    route: {
      routeHash: "a".repeat(64),
      participantMode: "SOLO",
      runtimeProfile: "PRESSURE_CHAPTER_V1",
      contentPackageVersion: "sangtian-pressure-v1",
      controlTopologyVersion: "six-seat-control-v1",
    },
    chapter: {
      chapterRuntimeId: `${runId}:N1`, chapterId: "N1", chapterNumber: 1,
      title: "九垦将决", phase: "ACTIVE", workingRevision: 0,
    },
    viewer: {
      seatId: "zhejiang_governor", roleName: "浙江总督",
      control: {
        mode: "HUMAN_ACTIVE", controlEpoch: 1, canSubmit: true, canReclaim: false,
        submissionFenceToken: "b".repeat(64), reclaimFenceToken: null,
      },
    },
    metrics: [
      ["fiscal_military", 42], ["civilian_land", 55], ["evidence_responsibility", 72],
      ["mulberry_silk", 0], ["court_imperial_face", 43],
    ].map(([trackId, value]) => ({ trackId, label: trackId, value, displayValue: String(value), tone: "DEFAULT" })),
    situation: {
      goal: "稳定浙江局势", risk: "御史已关注改桑进度", judgment: "巡抚与县令都接触过账册",
    },
    resources: [
      { resourceId: "silver", label: "银两", value: 42, displayValue: "42 万两" },
      { resourceId: "grain", label: "粮草", value: 23, displayValue: "23 万石" },
    ],
    tokens: [{ tokenId: "seal", label: "田契图纸（半页）", description: "可作为田亩凭证", quantity: 1, available: true }],
    decision: {
      decisionPointId: `${runId}:decision:N1`, mode: "SOLO_BEAT", requirement: "REQUIRED",
      title: "你要如何应对？", summary: "你的选择会立即改变局势。", expectedWorkingRevision: 0,
      options: [
        { code: optionCode, label: "由总督府复核清单", description: "巡抚和县令只能派见证人参加。", actionType: optionCode, preferredEntry: "PLAN" },
        { code: "COUNTY_REVIEW", label: "先由县令核查", description: "暂缓只审其结果和原件。", actionType: "COUNTY_REVIEW", preferredEntry: "PLAN" },
      ],
      submitLabel: "提交决策", customActionAllowed: true,
    },
    capabilities: {
      canSubmitDecision: true, canTalk: false, canInvestigate: false, canUseToken: false,
      canPlan: false, canReclaimControl: false, allowedActionTypes: [optionCode, "COUNTY_REVIEW"],
    },
    narrative: {
      status: "PUBLISHED", projectionKind: "GENESIS_NARRATIVE", sourceAuthority: "GENESIS",
      sourceId: `${runId}:genesis`, sourceCommitHash: "c".repeat(64),
      text: "嘉靖三十五年，天下仍披着太平的外衣。京城的钟鼓按时响起，运河上的漕船一艘接一艘北去。",
      contentHash: "d".repeat(64), renderMode: "DETERMINISTIC_FALLBACK",
    },
    feedPage: {
      schemaVersion: "a_emotion_feed_page_v1", roomId: runId, runId,
      viewerSeatId: "zhejiang_governor", items: [], unreadCount: 0, nextCursor: null, serverSequence: 0,
    },
    projectionHash: "e".repeat(64),
  };
}

test("Pressure /game dispatches into the approved app.js main-game shell", async () => {
  const input = projection();
  const dom = new JSDOM('<!doctype html><main id="app"></main>', {
    url: `http://game.test/game?runId=${input.runId}`, pretendToBeVisual: true,
  });
  dom.window.__STORY_STREAM_DELAY_MULTIPLIER__ = 0;
  const root = dom.window.document.querySelector("#app");
  let storageConstructed = false;

  await bootGamePage({
    root,
    window: dom.window,
    fetchImpl: async () => new Response(JSON.stringify(input), { status: 200, headers: { "content-type": "application/json" } }),
    loadPressureMainGameStorage: async () => ({
      PressureMainGameStorageV1: class extends PressureMainGameStorageV1 {
        constructor(options) { super(options); storageConstructed = true; }
      },
    }),
    loadSolo: async () => ({ createStoryApp }),
  });

  assert.equal(storageConstructed, true);
  assert.ok(root.querySelector('[data-testid="story-shell"]'));
  assert.ok(root.querySelector(".causal-left"));
  assert.ok(root.querySelector(".causal-center"));
  assert.ok(root.querySelector(".causal-right"));
  assert.match(root.textContent, /Our Many Worlds/);
  assert.match(root.textContent, /我的身份/);
  assert.match(root.textContent, /浙江总督/);
  assert.match(root.textContent, /当前目标/);
  assert.match(root.textContent, /我的资源/);
  assert.match(root.textContent, /主动谋划/);
  assert.match(root.textContent, /剩余谋划/);
  assert.doesNotMatch(root.textContent, /Seat control|Hand off to AI|DEFAULT_PASS|submissionFenceToken/);
  assert.equal(root.querySelector('[data-testid="pressure-chapter-game-v1"]'), null);
  dom.window.close();
});

test("Pressure adapter preserves approved page data and server-sealed decision command", async () => {
  const input = projection();
  const view = pressureProjectionToMainGameViewV1(input);
  assert.equal(view.continuousV2, true);
  assert.equal(view.player.roleName, "浙江总督");
  assert.equal(view.presentation.playerPortrait, "/assets/game/sangtian/generated/role-governor-scene-v1.png");
  assert.deepEqual(view.dashboard.statusMetrics.map((item) => item.label), ["国库银两", "民心", "粮价", "改桑进度", "皇帝信任"]);
  assert.deepEqual(view.activeDecision.options.map((item) => item.key), ["A", "B"]);

  let request;
  const updated = projection({ optionCode: "NEXT_OPTION" });
  const storage = new PressureMainGameStorageV1({
    runId: input.runId,
    initialProjection: input,
    createIdempotencyKey: () => "idem-main-shell-1",
    fetchImpl: async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        schemaVersion: "pressure_chapter_submit_decision_http_response_v1",
        idempotencyKey: "idem-main-shell-1",
        projection: updated,
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const result = await storage.submitDecision(view, { optionKey: "A", customText: "" });
  assert.equal(request.url, `/api/v4/rooms/${input.runId}/game/action`);
  assert.deepEqual(Object.keys(request.body).sort(), [
    "chapterId", "chapterRuntimeId", "commandType", "controlEpoch", "customText",
    "decisionPointId", "expectedWorkingRevision", "idempotencyKey", "optionCode",
    "routeHash", "runId", "schemaVersion", "seatId", "sourceEventId", "submissionFenceToken",
  ].sort());
  assert.equal(request.body.optionCode, "SEAL_AND_REVIEW");
  assert.equal(request.body.sourceEventId, null);
  assert.equal(result.pressureProjection.decision.options[0].code, "NEXT_OPTION");
});

test("completed Pressure run uses the existing result route without mounting a parallel page", async () => {
  const runId = "run-pressure-complete";
  const dom = new JSDOM('<!doctype html><main id="app"></main>', { url: `http://game.test/game?runId=${runId}` });
  let navigated = null;
  const result = await bootGamePage({
    root: dom.window.document.querySelector("#app"),
    window: dom.window,
    fetchImpl: async () => new Response(JSON.stringify({
      schemaVersion: "pressure_chapter_game_terminal_v1", runId,
      resultUrl: `/game/result?runId=${runId}`,
    }), { status: 200, headers: { "content-type": "application/json" } }),
    navigate: (url) => { navigated = url; },
    loadPressureMainGameStorage: async () => { throw new Error("terminal must not mount live storage"); },
  });
  assert.equal(result, null);
  assert.equal(navigated, `/game/result?runId=${runId}`);
  dom.window.close();
});
