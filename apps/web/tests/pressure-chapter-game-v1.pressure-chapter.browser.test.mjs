import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createStoryApp } from "../public/app.js";
import { bootGamePage } from "../public/game-bootstrap.js";
import {
  PressureMainGameStorageV1,
  pressureProjectionToMainGameViewV1,
} from "../public/pressure-main-game-storage-v1.js";

const N1_DECISION_NARRATIVE = [
  "驿卒刚跨进总督府内厅，第二封急报已经追到门外。\n“上游水位又涨了。”他扶着门框喘气，“乡民正在往高处逃。守堰的兵，有人离堰，有人还在等令，各处回报对不上。”\n幕僚展开河图，九处堰口被朱笔一一点亮。",
  "胡宗宪按住河图：“谁调的兵？”\n幕僚没有回答，只把最危险的一处圈住，低声道：“九处同时出事，不像寻常失修。可若现在抽兵守堰，海防就要露出缺口。”\n胡宗宪抬眼时，门外省府差役已捧着空白回令候着。",
  "窗外忽然响起奔马和更鼓。新来的差役连礼都顾不上行：“浑水越过第一道田埂了。”\n他身后还有三拨人在等：守堰官要兵，县里要先撤村民，见证人抱着调兵与毁堤记录不肯交给旁人。\n“大人，”差役望向案前，“第一道令先下给谁？”",
].join("\n\n");

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
      ["fiscal_military", "国库余裕", 35], ["civilian_land", "民心", 55], ["evidence_responsibility", "粮价压力", 60],
      ["mulberry_silk", "改桑进度", 8], ["court_imperial_face", "皇帝信任", 45],
    ].map(([trackId, label, value]) => ({ trackId, label, value, displayValue: String(value), tone: "DEFAULT" })),
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
      title: "九堰将决：你先下哪一道命令？", summary: N1_DECISION_NARRATIVE, expectedWorkingRevision: 0,
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

function n2Projection({ published = false } = {}) {
  const input = projection({ runId: "run-pressure-n2-narrative" });
  input.chapter = {
    ...input.chapter,
    chapterRuntimeId: `${input.runId}:N2`,
    chapterId: "N2",
    chapterNumber: 2,
    title: "第一道奏疏",
  };
  input.decision = {
    ...input.decision,
    decisionPointId: "N2.memorial_draft",
    title: "这份奏疏，现在最需要先补清楚什么？",
    summary: published
      ? "奏疏房里刚换过一轮灯油，灾后的名册、河图与待署名的奏稿已经摊满长案。胡宗宪翻到记载疏散结果的一页，门外又送来催问：这场灾究竟怎样写进朝廷的第一道奏疏。"
      : "起草救济请求与原因说明。",
    options: [
      { code: "ADD_CAUSE", label: "补入灾情原因", description: "在奏疏正文中补入可核验的灾情原因。", actionType: "ADD_CAUSE", preferredEntry: "TALK" },
      { code: "ADD_RELIEF_REQUEST", label: "补入救济请求", description: "在奏疏正文中加入明确的救济请求。", actionType: "ADD_RELIEF_REQUEST", preferredEntry: "TALK" },
    ],
  };
  input.capabilities.allowedActionTypes = ["ADD_CAUSE", "ADD_RELIEF_REQUEST"];
  input.narrative = published
    ? {
        status: "PUBLISHED",
        projectionKind: "CHAPTER_NARRATIVE",
        sourceAuthority: "CHAPTER_FROZEN",
        sourceId: `${input.runId}:n1-settlement`,
        sourceCommitHash: "f".repeat(64),
        text: "堰区的急报暂时告一段落，案头却很快多出了一份新文书。幕僚将奏疏草稿推到胡宗宪面前，朝廷正在等他写清灾情原因与所需救济。",
        contentHash: "1".repeat(64),
        renderMode: "PROVIDER",
      }
    : {
        status: "PENDING",
        projectionKind: "CHAPTER_NARRATIVE",
        sourceAuthority: "CHAPTER_FROZEN",
        sourceId: `${input.runId}:n1-settlement`,
        sourceCommitHash: "f".repeat(64),
        text: null,
        contentHash: null,
        renderMode: null,
      };
  return input;
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
  assert.equal(root.querySelector('[data-testid="story-shell"]')?.dataset.pressureChapter, "true");
  assert.ok(root.querySelector(".causal-left"));
  assert.ok(root.querySelector(".causal-center"));
  assert.ok(root.querySelector(".causal-right"));
  assert.match(root.textContent, /Our Many Worlds/);
  assert.match(root.textContent, /我的身份/);
  assert.match(root.textContent, /浙江总督/);
  assert.match(root.textContent, /当前目标/);
  assert.doesNotMatch(root.querySelector(".player")?.textContent || "", /稳定浙江局势/);
  assert.match(root.querySelector(".day-mission")?.textContent || "", /稳定浙江局势/);
  assert.doesNotMatch(
    root.querySelector(".day-mission")?.textContent || "",
    /巡抚与县令都接触过账册/,
  );
  assert.match(root.textContent, /我的资源/);
  assert.equal(root.querySelector('[data-resource-id="silver"]')?.textContent, "银两42 万两");
  assert.equal(root.querySelector('[data-resource-id="grain"]')?.textContent, "粮草23 万石");
  assert.match(root.textContent, /局势动向/);
  root.querySelector('[data-pressure-right-tab="maneuver"]')?.click();
  assert.match(root.textContent, /主动谋划/);
  assert.match(root.textContent, /剩余谋划/);
  assert.doesNotMatch(root.textContent, /Seat control|Hand off to AI|DEFAULT_PASS|submissionFenceToken/);
  assert.equal(root.querySelector('[data-testid="pressure-chapter-game-v1"]'), null);
  dom.window.close();
});

test("Pressure /game renders viewer-scoped situation Feed and preserves the existing maneuver center behind a tab", async () => {
  const input = projection({ runId: "run-pressure-feed-rail" });
  input.feedPage.items = [
    pressureFeedItem("feed-related", "RELATED", "原始船队出现异常", true),
    pressureFeedItem("feed-public", "PUBLIC", "巡抚正式承诺提交原册", true),
    pressureFeedItem("feed-suspicious", "SUSPICIOUS", "有人正在接触你的幕僚", true),
    pressureFeedItem("feed-fourth", "PUBLIC", "第四条动态", false),
  ];
  input.feedPage.unreadCount = 3;
  input.feedPage.serverSequence = 4;
  const dom = new JSDOM('<!doctype html><main id="app"></main>', {
    url: `http://game.test/game?runId=${input.runId}`,
    pretendToBeVisual: true,
  });
  dom.window.__STORY_STREAM_DELAY_MULTIPLIER__ = 0;
  const root = dom.window.document.querySelector("#app");

  await bootGamePage({
    root,
    window: dom.window,
    fetchImpl: async () => new Response(JSON.stringify(input), { status: 200, headers: { "content-type": "application/json" } }),
    loadPressureMainGameStorage: async () => ({ PressureMainGameStorageV1 }),
    loadSolo: async () => ({ createStoryApp }),
  });

  assert.ok(root.querySelector('[data-testid="pressure-right-rail"]'));
  assert.ok(root.querySelector('[data-testid="pressure-situation-feed"]'));
  assert.match(root.querySelector(".causal-right")?.textContent || "", /局势动向/);
  assert.match(root.querySelector(".causal-right")?.textContent || "", /3 条未读/);
  assert.equal(root.querySelectorAll("[data-pressure-feed-event]").length, 3);
  assert.doesNotMatch(root.querySelector(".causal-right")?.textContent || "", /第四条动态/);

  root.querySelector('[data-pressure-feed-event="feed-related"]')?.click();
  assert.match(root.querySelector('[data-testid="pressure-feed-detail"]')?.textContent || "", /只显示当前席位可以知道的内容/);
  assert.doesNotMatch(root.querySelector(".causal-right")?.textContent || "", /fact\.private|seat\.private/);

  root.querySelector('[data-pressure-right-tab="maneuver"]')?.click();
  assert.ok(root.querySelector('[data-testid="maneuver-panel"]'));
  assert.equal(root.querySelector('[data-testid="pressure-situation-feed"]'), null);

  root.querySelector('[data-pressure-right-tab="feed"]')?.click();
  root.querySelector("[data-pressure-feed-expand]")?.click();
  assert.equal(root.querySelectorAll("[data-pressure-feed-event]").length, 4);
  assert.match(root.querySelector(".causal-right")?.textContent || "", /第四条动态/);
  dom.window.close();
});

test("fresh Pressure N1 shows the complete scene before releasing explained decisions", async () => {
  const input = projection();
  const dom = new JSDOM('<!doctype html><main id="app"></main>', {
    url: `http://game.test/game?runId=${input.runId}`, pretendToBeVisual: true,
  });
  dom.window.__STORY_STREAM_DELAY_MULTIPLIER__ = 0;
  const nativeSetTimeout = dom.window.setTimeout.bind(dom.window);
  const root = dom.window.document.querySelector("#app");

  await bootGamePage({
    root,
    window: dom.window,
    fetchImpl: async () => new Response(JSON.stringify(input), { status: 200, headers: { "content-type": "application/json" } }),
    loadPressureMainGameStorage: async () => ({ PressureMainGameStorageV1 }),
    loadSolo: async () => ({ createStoryApp }),
  });

  await new Promise((resolve) => nativeSetTimeout(resolve, 700));
  assert.match(root.querySelector('[data-testid="role-opening"]')?.textContent ?? "", /嘉靖三十五年/);
  assert.ok(root.querySelector("#beginStoryBtn"));

  root.querySelector("#beginStoryBtn").click();
  const decisionNarrative = root.querySelector('[data-testid="decision-narrative"]');
  assert.match(decisionNarrative?.textContent ?? "", /驿卒刚跨进总督府内厅/);
  assert.match(decisionNarrative?.textContent ?? "", /胡宗宪按住河图：“谁调的兵？”/);
  assert.match(decisionNarrative?.textContent ?? "", /第一道令先下给谁/);
  assert.equal(root.querySelector('input[name="decision"]'), null);
  assert.ok(root.querySelector("#beginDecisionBtn"));

  root.querySelector("#beginDecisionBtn").click();
  assert.equal(root.querySelector('[data-testid="decision-narrative"]'), null);
  assert.ok(root.querySelector('input[name="decision"]'));
  assert.equal(root.querySelector(".decision-zone-head"), null);
  assert.doesNotMatch(root.textContent, new RegExp(input.decision.title));
  const firstOption = root.querySelector('input[name="decision"][value="A"]')?.closest("label");
  assert.match(firstOption?.querySelector(".option-copy span")?.textContent ?? "", /巡抚和县令只能派见证人参加/);
  assert.ok(root.querySelector("#reviewDecisionNarrativeBtn"));

  root.querySelector("#reviewDecisionNarrativeBtn").click();
  assert.ok(root.querySelector('[data-testid="decision-narrative"]'));
  assert.equal(root.querySelector('input[name="decision"]'), null);
  dom.window.close();
});

test("an advanced Pressure run resumes the current Beat without replaying Genesis", async () => {
  const input = projection({ runId: "run-pressure-resume-current-beat" });
  input.chapter.workingRevision = 2;
  input.decision.expectedWorkingRevision = 2;
  input.decision.decisionPointId = "N1.order_reconciliation";
  input.decision.title = "眼前这叠回执里，哪一道命令需要先处理？";
  input.narrative = {
    ...input.narrative,
    projectionKind: "BEAT_NARRATIVE",
    sourceAuthority: "CHAPTER_WORKING",
    sourceId: `${input.runId}:beat:2`,
    text: "第二批回执已经送到案前。此前发出的命令有的接上执行链，有的仍被压在驿路上，胡宗宪必须先处理眼前的冲突。",
  };
  input.decision.summary = "驿卒掀帘进来时，雨水正顺着斗笠往下淌。两封回执一前一后压上长案，送令的人却对不上同一条驿路。胡宗宪抬眼看向幕僚，门外又响起催问：已经落在人身上的命令，究竟还认不认原路？";
  const dom = new JSDOM('<!doctype html><main id="app"></main>', {
    url: `http://game.test/game?runId=${input.runId}`, pretendToBeVisual: true,
  });
  dom.window.__STORY_STREAM_DELAY_MULTIPLIER__ = 0;
  const root = dom.window.document.querySelector("#app");

  await bootGamePage({
    root,
    window: dom.window,
    fetchImpl: async () => new Response(JSON.stringify(input), { status: 200, headers: { "content-type": "application/json" } }),
    loadPressureMainGameStorage: async () => ({ PressureMainGameStorageV1 }),
    loadSolo: async () => ({ createStoryApp }),
  });

  assert.equal(root.querySelector('[data-testid="role-opening"]'), null);
  assert.equal(root.querySelector("#beginStoryBtn"), null);
  assert.match(root.querySelector('[data-testid="decision-narrative"]')?.textContent ?? "", /驿卒掀帘进来时/u);
  assert.doesNotMatch(root.querySelector('[data-testid="decision-narrative"]')?.textContent ?? "", /第二批回执已经送到案前/u);
  assert.ok(root.querySelector("#beginDecisionBtn"));
  dom.window.close();
});

test("Pressure adapter preserves approved page data and server-sealed decision command", async () => {
  const input = projection();
  const view = pressureProjectionToMainGameViewV1(input);
  assert.equal(view.continuousV2, true);
  assert.equal(view.player.roleName, "浙江总督");
  assert.equal(view.presentation.playerPortrait, "/assets/game/sangtian/generated/role-governor-scene-v1.png");
  assert.deepEqual(view.player.goals, [input.situation.goal, input.situation.risk]);
  assert.equal(view.player.goals.includes(input.situation.judgment), false);
  assert.equal(view.decisionNarrative, N1_DECISION_NARRATIVE);
  assert.deepEqual(view.dashboard.statusMetrics.map((item) => item.label), ["国库余裕", "民心", "粮价压力", "改桑进度", "皇帝信任"]);
  assert.deepEqual(view.dashboard.statusMetrics.map((item) => item.value), [35, 55, 60, 8, 45]);
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

test("pending Narrative uses only the lightweight update endpoint and becomes playable", async () => {
  const initial = projection({ runId: "run-pressure-n2-narrative" });
  const pending = n2Projection();
  const published = n2Projection({ published: true });
  const requests = [];
  const storage = new PressureMainGameStorageV1({
    runId: initial.runId,
    initialProjection: initial,
    narrativePollAttempts: 3,
    waitImpl: async () => {},
    createIdempotencyKey: () => "idem-light-narrative-1",
    fetchImpl: async (url) => {
      requests.push(url);
      if (String(url).endsWith("/game/action")) {
        return new Response(JSON.stringify({
          schemaVersion: "pressure_chapter_submit_decision_http_response_v1",
          idempotencyKey: "idem-light-narrative-1",
          projection: pending,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const ready = requests.filter((item) => String(item).includes("narrative-update")).length > 1;
      const source = ready ? published : pending;
      return new Response(JSON.stringify({
        schemaVersion: "pressure_game_narrative_update_v1",
        runId: source.runId,
        routeHash: source.route.routeHash,
        chapterRuntimeId: source.chapter.chapterRuntimeId,
        viewerSeatId: source.viewer.seatId,
        narrative: source.narrative,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const result = await storage.submitDecision(
    pressureProjectionToMainGameViewV1(initial),
    { optionKey: "A", customText: "" },
  );
  assert.equal(requests[0], `/api/v4/rooms/${initial.runId}/game/action`);
  assert.equal(requests.filter((item) => String(item).endsWith("/game")).length, 0);
  assert.equal(requests.filter((item) => String(item).includes("narrative-update")).length, 2);
  assert.match(result.decisionNarrative, /堰区的急报暂时告一段落/u);
  assert.ok(result.activeDecision);
  assert.equal(result.v2CurrentTurn.status, "OPEN");
});

test("saved intermediate Beat returns immediately and receives the completed turn asynchronously", async () => {
  const initial = projection({ runId: "run-pressure-immediate-receipt" });
  const ready = projection({
    runId: initial.runId,
    optionCode: "NEXT_AUTHORIZED_OPTION",
  });
  const updateKey = "a".repeat(64);
  const requests = [];
  const storage = new PressureMainGameStorageV1({
    runId: initial.runId,
    initialProjection: initial,
    turnPollAttempts: 3,
    waitImpl: async () => {},
    createIdempotencyKey: () => "idem-immediate-receipt-1",
    fetchImpl: async (url) => {
      requests.push(String(url));
      if (String(url).endsWith("/game/action")) {
        return new Response(JSON.stringify({
          schemaVersion: "pressure_chapter_submit_decision_http_response_v1",
          idempotencyKey: "idem-immediate-receipt-1",
          projection: null,
          receipt: {
            schemaVersion: "pressure_post_commit_turn_receipt_v1",
            updateKey,
            runId: initial.runId,
            chapterRuntimeId: initial.chapter.chapterRuntimeId,
            chapterId: initial.chapter.chapterId,
            viewerSeatId: initial.viewer.seatId,
            savedActionId: "saved-action-1",
            nextBeatId: "N1.B02",
            nextDecisionPointId: "N1.dispatch_route",
            status: "ACTION_SAVED",
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const readyNow = requests.filter((item) => item.includes("narrative-update")).length > 1;
      return new Response(JSON.stringify({
        schemaVersion: "pressure_post_commit_turn_update_v1",
        updateKey,
        runId: initial.runId,
        chapterRuntimeId: initial.chapter.chapterRuntimeId,
        status: readyNow ? "READY" : "STREAMING",
        sceneText: readyNow ? null : "第一句真正针对玩家行动的AI剧情。",
        projection: readyNow ? ready : null,
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const streamedViews = [];
  const asyncView = new Promise((resolve) => storage.subscribeAsyncUpdates((view) => {
    streamedViews.push(view);
    if (view.narrativeStreaming !== true) resolve(view);
  }));
  const pendingView = await storage.submitDecision(
    pressureProjectionToMainGameViewV1(initial),
    { optionKey: "A", customText: "" },
  );
  assert.equal(pendingView.v2CurrentTurn.status, "RESOLVING");
  assert.match(pendingView.v2CurrentTurn.title, /行动已保存/u);
  assert.equal(pendingView.activeDecision, null);

  const completedView = await asyncView;
  assert.equal(streamedViews[0].narrativeStreaming, true);
  assert.match(streamedViews[0].decisionNarrative, /真正针对玩家行动/u);
  assert.equal(streamedViews[0].activeDecision.options.length, 0);
  assert.equal(completedView.v2CurrentTurn.status, "OPEN");
  assert.equal(
    completedView.pressureProjection.decision.options[0].code,
    "NEXT_AUTHORIZED_OPTION",
  );
  assert.equal(requests.filter((item) => item.endsWith("/game")).length, 0);
  assert.equal(requests.filter((item) => item.includes("narrative-update")).length, 2);
});

test("stale Pressure decision reloads the latest projection instead of showing a generic failure", async () => {
  const initial = projection({ runId: "run-pressure-stale-decision" });
  const latest = projection({
    runId: initial.runId,
    optionCode: "LATEST_AUTHORIZED_OPTION",
  });
  const initialView = pressureProjectionToMainGameViewV1(initial);
  const latestView = pressureProjectionToMainGameViewV1(latest);
  let refreshes = 0;
  const storage = {
    savedRunId: initial.runId,
    async restoreOrCreate() { return initialView; },
    async submitDecision() {
      throw Object.assign(new Error("This decision has changed."), {
        status: 409,
        code: "PRESSURE_HTTP_STALE_DECISION",
      });
    },
    async getRun() {
      refreshes += 1;
      return latestView;
    },
  };
  const dom = new JSDOM('<!doctype html><main id="app"></main>', {
    url: `http://game.test/game?debug=1&runId=${initial.runId}`,
  });
  const app = createStoryApp({
    root: dom.window.document.querySelector("#app"),
    window: dom.window,
    storage,
  });

  await app.boot();
  await app.submitDecision();

  assert.equal(refreshes, 1);
  assert.equal(
    app.getState().view.pressureProjection.decision.options[0].code,
    "LATEST_AUTHORIZED_OPTION",
  );
  assert.match(app.getState().notice, /已为你刷新到最新版本/u);
  assert.equal(app.getState().error, "");
  dom.window.close();
});

test("ordinary game notices disappear automatically while errors remain persistent", async () => {
  const input = projection();
  const initialView = new PressureMainGameStorageV1({
    runId: input.runId,
    initialProjection: input,
    fetchImpl: async () => new Response(JSON.stringify(input), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  }).toView(input);
  const storage = {
    savedRunId: input.runId,
    async restoreOrCreate() { return initialView; },
    async getRun() { return initialView; },
  };
  const dom = new JSDOM('<!doctype html><main id="app"></main>', {
    url: `http://game.test/game?debug=1&runId=${input.runId}`,
  });
  const app = createStoryApp({
    root: dom.window.document.querySelector("#app"),
    window: dom.window,
    storage,
    noticeDurationMs: 10,
  });

  await app.boot();
  await app.refresh();
  assert.equal(app.getState().notice, "局势已刷新。");
  await new Promise((resolve) => dom.window.setTimeout(resolve, 25));
  assert.equal(app.getState().notice, "");

  app.getState().error = "需要用户处理的错误";
  app.render();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 25));
  assert.equal(app.getState().error, "需要用户处理的错误");
  dom.window.close();
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

function pressureFeedItem(eventId, category, title, isUnread) {
  return {
    schemaVersion: "a_emotion_viewer_projection_v1",
    eventId,
    projectionVersion: 1,
    roomId: "run-pressure-feed-rail",
    runId: "run-pressure-feed-rail",
    viewerSeatId: "zhejiang_governor",
    category,
    disclosure: category === "SUSPICIOUS" ? "SUSPECTED" : "CONFIRMED",
    severity: "MINOR",
    title,
    safeSummary: "只显示当前席位可以知道的内容",
    statusLabel: category === "PUBLIC" ? "尚未验证" : "来源可信",
    visibleImpacts: [{ effectCode: "VISIBLE", label: "当前影响", value: "需要关注" }],
    knownFactRefs: ["fact.private"],
    visibleSourceSeatId: "seat.private",
    responseOptions: [],
    recommendedPresentation: "FEED_ONLY",
    centerCard: null,
    keyModal: null,
    eventSequence: 1,
    occurredAt: new Date().toISOString(),
    projectionHash: "f".repeat(64),
    isUnread,
    isAcknowledged: false,
    isResolved: false,
  };
}
