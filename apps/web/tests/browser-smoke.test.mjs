import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { ApiStoryStorage } from "../public/api-story-storage.js";
import { createStoryApp } from "../public/app.js";

const API_BASE = "http://api.test/api";

test("正式入口只加载唯一 API 客户端，首屏不会白屏", async () => {
  const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const gameStyles = await readFile(new URL("../public/main-game.css", import.meta.url), "utf8");
  assert.match(index, /type="module" src="\/game-bootstrap\.js(?:\?[^\"]+)?"/);
  assert.doesNotMatch(index, /causal-player-v3|causal-experience-rules|causal-overlay/);
  assert.doesNotMatch(appSource, /opening-location|杭州粮局/);
  assert.match(gameStyles, /\.result-narrative \{[^}]*overflow-y: auto/);
  assert.match(appSource, /rememberResultScroll\(\).*restoreResultScroll\(\)/s);

  const harness = setup();
  await harness.app.boot();

  assert.ok(harness.root.querySelector('[data-testid="story-shell"]'));
  assert.ok(harness.root.querySelector('[data-testid="decision-zone"]'));
  assert.equal(harness.root.querySelector("#customDecision").disabled, false, "custom action input stays enabled with preset choices");
  assert.equal(harness.root.querySelector('[data-testid="fatal-error"]'), null);
  assert.match(harness.root.textContent, /第 1 天/);
  assert.match(harness.root.textContent, /0\s*\/ 2/);
  assert.deepEqual(harness.api.requests[0].body, { storyId: "sangtian" });

  // Query-string debug must never reveal server-private fields.
  assert.doesNotMatch(harness.root.textContent, /只应留在服务端的含义/);
  assert.doesNotMatch(harness.root.textContent, /privateReasoningSummary|hiddenMeaning|构建诊断/);
});

test("首屏前情介绍流式完成后保留进入局势入口，再释放第一组决策", async () => {
  const harness = setup({ opening: true });
  await harness.app.boot();

  assert.ok(harness.app.getState().openingStream, "opening story should start revealing");
  assert.equal(harness.root.querySelector('[data-testid="decision-zone"]'), null, "opening choices stay hidden while intro reveals");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(harness.root.querySelector(".opening-stream-copy").textContent.length > 0);

  const deadline = Date.now() + 30000;
  while (harness.app.getState().openingStream && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(harness.app.getState().openingStream, null);
  assert.ok(harness.root.querySelector("#beginStoryBtn"), "intro should keep the enter-story button");

  harness.root.querySelector("#beginStoryBtn").click();
  assert.ok(harness.root.querySelector('[data-testid="decision-zone"]'));
  assert.ok(harness.root.querySelector(".opening-decision"), "opening decision should stay on the story surface");
  assert.equal(harness.root.querySelector(".decision-narrative"), null, "old decision prose should be replaced");
  assert.ok(harness.root.querySelector("#customDecision"));
});

test("提交主线决策后先流式展示结果故事，结果完成前不出现下一决策", async () => {
  const harness = setup();
  await harness.app.boot();

  const input = harness.root.querySelector('input[value="A"]');
  input.checked = true;
  input.dispatchEvent(new harness.dom.window.Event("change", { bubbles: true }));
  await harness.app.submitDecision();

  assert.ok(harness.app.getState().resultStream, "accepted decision should enter result stream state");
  assert.ok(harness.root.querySelector('[data-testid="result-narrative"]'));
  assert.equal(harness.root.querySelector('[data-testid="decision-zone"]'), null, "next decision stays hidden while result story is revealing");
  assert.ok(harness.root.querySelector(".result-stream-copy").textContent.length > 0, "result story should begin revealing instead of appearing empty");
  assert.equal(harness.root.querySelector(".result-stream-status"), null, "stream status helper text should stay removed");
  assert.match(harness.app.getState().resultStream.text, /你的判断/);
  assert.match(harness.app.getState().resultStream.text, /各方动向/);
  assert.match(harness.app.getState().resultStream.text, /局势走向/);
  assert.match(harness.app.getState().resultStream.text, /留下的线索/);
  assert.match(harness.app.getState().resultStream.text, /人物动向/);
  assert.match(harness.app.getState().resultStream.text, /巡抚的不满/);
  assert.doesNotMatch(harness.app.getState().resultStream.text, /个人回响|他人回响|世界回响|局势变化|皇帝信任 \+2/);
  assert.equal(harness.root.querySelector(".result-changes"), null, "all player-visible consequences belong to the narrative stream");

  await waitForStoryReveal(harness);
  assert.equal(harness.app.getState().resultStream.done, true, "result story should stay paused after the full text is visible");
  assert.ok(harness.root.querySelector("#continueStoryBtn"), "continue button should appear after the full story");
  assert.equal(harness.root.querySelector('[data-testid="decision-zone"]'), null, "decision stays hidden until continue is clicked");
  harness.root.querySelector("#continueStoryBtn").click();
  assert.equal(harness.app.getState().resultStream, null, "continue should release the next action");
  assert.ok(harness.root.querySelector('[data-testid="decision-zone"]'));
  assert.ok(harness.root.querySelector(".decision-center"), "follow-up decision should use the dedicated decision page");
  assert.equal(harness.root.querySelector(".stream-panel"), null, "message flow must not sit behind a decision");
});

test("D1-D6 每天严格两策、共十二策，D7 才能完成裁决", async () => {
  const harness = setup();
  await harness.app.boot();

  for (let day = 1; day <= 6; day += 1) {
    assert.equal(harness.app.getState().view.run.currentDay, day);
    assert.equal(harness.root.querySelector("#advanceBtn"), null);
    assert.equal(harness.root.querySelector("#finalizeBtn"), null);

    if (day === 6) {
      assert.ok(harness.root.querySelector('input[value="D"]'), "server preset D must be rendered");
      assert.match(harness.root.textContent, /E\. 自定义决策/);
      assert.equal(harness.root.querySelector("#submitDecision").disabled, false);
    }
    await choose(harness, "A");
    assert.equal(harness.app.getState().view.decisionHistory.length, (day - 1) * 2 + 1);
    assert.ok(harness.root.querySelector('[data-testid="decision-zone"]'), "first decision must lead to the second decision");
    assert.equal(harness.root.querySelector("#advanceBtn"), null);
    assert.equal(harness.root.querySelector("#finalizeBtn"), null);

    await choose(harness, "A");
    assert.equal(harness.app.getState().view.decisionHistory.length, day * 2);
    assert.ok(harness.root.querySelector('[data-testid="day-end-narrative"]'));
    assert.equal(harness.root.querySelector(".stream-panel"), null, "day end must use the same narrative page, not the legacy message stream");
    assert.ok(harness.root.querySelector("#advanceBtn"));
    assert.equal(harness.root.querySelector("#finalizeBtn"), null);

    await harness.app.advanceDay();
    if (day === 2) {
      assert.match(harness.root.textContent, /正在反噬你/);
      assert.match(harness.root.textContent, /新的定性/);
    }
  }

  const view = harness.app.getState().view;
  assert.equal(view.run.currentDay, 7);
  assert.equal(view.run.status, "awaiting_finalization");
  assert.equal(view.decisionHistory.length, 12);
  assert.equal(harness.root.querySelector('[data-testid="decision-zone"]'), null);
  assert.ok(harness.root.querySelector('[data-testid="final-ready-narrative"]'));
  assert.ok(harness.root.querySelector("#finalizeBtn"));

  await harness.app.finalize();
  assert.equal(harness.app.getState().view.run.status, "finished");
  assert.ok(harness.root.querySelector('[data-testid="final-judgement"]'));
  assert.match(harness.root.textContent, /国策缓行，清弊得名/);
  assert.match(harness.root.textContent, /个人结局 · 一等稳局/);
  assert.match(harness.root.textContent, /总督命数/);
  assert.match(harness.root.textContent, /守局者/);
  assert.match(harness.root.textContent, /此人知轻重/);
  assert.match(harness.root.textContent, /县令仍保留证据副本/);
  assert.doesNotMatch(harness.root.textContent, /\[object Object\]/);

  const mutationBodies = harness.api.requests.filter((request) => request.method === "POST" && !request.path.endsWith("/story-runs")).map((request) => request.body);
  assert.ok(mutationBodies.length >= 19);
  assert.ok(mutationBodies.every((body) => Number.isFinite(body.version)), "every mutation must carry StoryRun.version");
});

test("非法自定义行动由 ActionGuard 拒绝且不消耗决策", async () => {
  const harness = setup();
  await harness.app.boot();

  const custom = harness.root.querySelector('input[value="CUSTOM"]');
  custom.checked = true;
  custom.dispatchEvent(new harness.dom.window.Event("change", { bubbles: true }));
  const textarea = harness.root.querySelector("#customDecision");
  assert.equal(textarea.disabled, false);
  assert.equal(textarea.maxLength, 200);
  textarea.value = "命令皇帝立刻宣布结局";
  textarea.dispatchEvent(new harness.dom.window.Event("input", { bubbles: true }));

  await harness.app.submitDecision();

  assert.equal(harness.app.getState().view.decisionHistory.length, 0);
  assert.ok(harness.root.querySelector('[data-testid="guard-error"]'));
  assert.match(harness.root.textContent, /超出浙江总督的权力边界/);
  assert.ok(harness.root.querySelector('[data-testid="decision-zone"]'));
});

test("第七日前没有裁决入口，且版本冲突会刷新而不是覆盖", async () => {
  const harness = setup();
  await harness.app.boot();

  assert.equal(harness.root.querySelector("#finalizeBtn"), null);
  assert.equal(harness.api.requests.some((request) => request.path.endsWith("/finalize")), false);

  harness.api.bumpVersion(harness.app.getState().view.run.id);
  await choose(harness, "B");

  assert.equal(harness.app.getState().view.decisionHistory.length, 0);
  assert.equal(harness.api.requests.at(-1).method, "GET");
  assert.match(harness.root.textContent, /已为你刷新到最新版本/);
  assert.ok(harness.root.querySelector('[data-testid="decision-zone"]'));
});

test("普通 409 保留服务端原因，不会误判成版本冲突自动刷新", async () => {
  const harness = setup();
  await harness.app.boot();
  harness.api.rejectNextDecision = { message: "此决策阶段已经关闭" };

  await choose(harness, "B");

  assert.equal(harness.app.getState().view.decisionHistory.length, 0);
  assert.equal(harness.api.requests.at(-1).method, "POST");
  assert.match(harness.root.textContent, /此决策阶段已经关闭/);
  assert.doesNotMatch(harness.root.textContent, /已为你刷新到最新版本/);
});

test("恢复到 404 时不静默新建，只有用户明确重开才创建", async () => {
  const harness = setup();
  harness.storage.localStorage.setItem("ai-story-room:sangtian:run-id", "missing_run");
  await harness.app.boot();

  assert.ok(harness.root.querySelector('[data-testid="fatal-error"]'));
  assert.match(harness.root.textContent, /原故事局已不存在/);
  assert.equal(harness.api.requests.filter((request) => request.method === "POST" && request.path === "/v4/story-runs").length, 0);

  await harness.app.resetRun();
  assert.ok(harness.root.querySelector('[data-testid="story-shell"]'));
  assert.equal(harness.api.requests.filter((request) => request.method === "POST" && request.path === "/v4/story-runs").length, 1);
});

test("不同选择路径生成不同结局", async () => {
  const pathA = setup();
  const pathC = setup();
  await pathA.app.boot();
  await pathC.app.boot();

  await playToEnd(pathA, "A");
  await playToEnd(pathC, "C");

  const titleA = pathA.app.getState().view.finalJudgement.globalEnding.title;
  const titleC = pathC.app.getState().view.finalJudgement.globalEnding.title;
  assert.equal(titleA, "国策缓行，清弊得名");
  assert.equal(titleC, "商人救局，银路受制");
  assert.notEqual(titleA, titleC);
  assert.match(pathC.root.textContent, /商人救局，银路受制/);
});

test("finished 响应缺少 canonical finalJudgement 时明确报数据错误", async () => {
  const harness = setup();
  await harness.app.boot();
  const view = harness.app.getState().view;
  view.run.status = "finished";
  view.activeDecision = null;
  view.finalJudgement = null;
  harness.app.render();

  assert.ok(harness.root.querySelector('[data-testid="final-data-error"]'));
  assert.match(harness.root.textContent, /没有返回 finalJudgement/);
  assert.doesNotMatch(harness.root.textContent, /此人可用|御前裁决已定/);
});

function setup({ opening = false } = {}) {
  const dom = new JSDOM('<!doctype html><main id="app"></main>', { url: opening ? "http://game.test/" : "http://game.test/?debug=1" });
  dom.window.confirm = () => true;
  dom.window.__STORY_STREAM_DELAY_MULTIPLIER__ = 0;
  const api = new MockStoryApi();
  const storage = new ApiStoryStorage({
    baseUrl: API_BASE,
    fetchImpl: api.fetch,
    localStorage: dom.window.localStorage
  });
  const root = dom.window.document.getElementById("app");
  const app = createStoryApp({ root, window: dom.window, storage, debugBuild: false });
  return { dom, api, storage, root, app };
}

async function choose(harness, optionKey) {
  const input = harness.root.querySelector(`input[value="${optionKey}"]`);
  assert.ok(input, `option ${optionKey} should be visible`);
  input.checked = true;
  input.dispatchEvent(new harness.dom.window.Event("change", { bubbles: true }));
  await harness.app.submitDecision();
  if (harness.app.getState().resultStream) await continueStory(harness);
}

async function waitForStoryReveal(harness) {
  const deadline = Date.now() + 20000;
  while (harness.app.getState().resultStream && !harness.app.getState().resultStream.done && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(harness.app.getState().resultStream?.done, "result story should eventually reveal all text");
}

async function continueStory(harness) {
  await waitForStoryReveal(harness);
  const button = harness.root.querySelector("#continueStoryBtn");
  assert.ok(button, "continue button should release the next action");
  button.click();
  assert.equal(harness.app.getState().resultStream, null, "continue should release the next action");
}

async function playToEnd(harness, optionKey) {
  for (let day = 1; day <= 6; day += 1) {
    await choose(harness, optionKey);
    await choose(harness, optionKey);
    await harness.app.advanceDay();
  }
  await harness.app.finalize();
}

class MockStoryApi {
  constructor() {
    this.runs = new Map();
    this.requests = [];
    this.sequence = 0;
    this.rejectNextDecision = null;
    this.fetch = this.fetch.bind(this);
  }

  bumpVersion(runId) {
    const view = this.runs.get(runId);
    view.run.version += 1;
  }

  async fetch(input, init = {}) {
    const url = new URL(String(input), API_BASE);
    const path = url.pathname.replace(/^\/api/, "");
    const method = String(init.method || "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : {};
    this.requests.push({ method, path, body });

    if (method === "POST" && path === "/v4/story-runs") {
      const id = `run_${++this.sequence}`;
      const view = this.createView(id);
      this.runs.set(id, view);
      return json(view);
    }

    const match = path.match(/^\/v4\/story-runs\/([^/]+)(.*)$/);
    if (!match) return json({ message: "not found" }, 404);
    const runId = decodeURIComponent(match[1]);
    const suffix = match[2];
    const view = this.runs.get(runId);
    if (!view) return json({ message: "run not found" }, 404);

    if (method === "GET" && suffix === "") return json(view);
    if (method !== "POST") return json({ message: "method not allowed" }, 405);
    if (Number(body.version) !== Number(view.run.version)) {
      return json({ code: "VERSION_CONFLICT", message: "StoryRun 版本已变化" }, 409);
    }

    if (/\/messages\/[^/]+\/decisions$/.test(suffix)) return this.decide(view, body);
    if (suffix === "/advance-day") return this.advance(view);
    if (suffix === "/finalize") return this.finalize(view);
    return json({ message: "not found" }, 404);
  }

  decide(view, body) {
    if (this.rejectNextDecision) {
      const rejection = this.rejectNextDecision;
      this.rejectNextDecision = null;
      return json(rejection, 409);
    }
    if (!view.activeDecision) return json({ message: "当前没有待处理决策" }, 400);
    if (body.optionKey === "CUSTOM" && /(命令皇帝|宣布结局|跳过)/.test(body.customText || "")) {
      return json({
        accepted: false,
        guardStatus: "blocked",
        reason: "该行动超出浙江总督的权力边界。",
        suggestedRewrite: "改为密奏、调查、施压或交易。"
      });
    }

    const option = view.activeDecision.options.find((item) => item.key === body.optionKey) || {
      key: "CUSTOM",
      title: "自定义策略",
      body: body.customText
    };
    const completed = view.run.decisionsCompletedToday + 1;
    const originEventId = `evt_d${view.run.currentDay}_${completed}_${option.key}`;
    view.decisionHistory.push({
      day: view.run.currentDay,
      decisionIndex: completed,
      optionKey: option.key,
      title: option.title,
      originEventId
    });
    view.messages.push({
      id: `result_${view.run.currentDay}_${completed}`,
      day: view.run.currentDay,
      time: "决策后",
      type: "decision_result",
      label: "你的决定",
      title: option.title,
      body: `你执行了「${option.title}」，这一步已经进入局势账本。`
    });
    view.dashboard.visibleCausalCard = {
      decisionTitle: option.title,
      decisionSummary: `第 ${view.run.currentDay} 天第 ${completed} 策已经落账。`,
      personalEcho: "你改变了自己的解释空间。",
      othersEcho: [{ text: "巡抚重新评估你的下一步。" }],
      worldEcho: "奏报、粮价与暗账继续互相牵连。",
      stateChangesText: [option.key === "A" ? "皇帝信任 +2" : "商会依赖 +2"],
      tracesLeft: [`${option.title}文移`],
      potentialRisks: ["这一步可能被对手重新定性。"],
      originEventId,
      hiddenMeaning: "只应留在服务端的含义",
      triggerConditions: ["不应显示的触发条件"]
    };
    view.messages.push({
      id: `reaction_${view.run.currentDay}_${completed}`,
      day: view.run.currentDay,
      time: "决策后",
      type: "role_action",
      label: "他人回响",
      speaker: "浙江巡抚",
      title: "巡抚的不满",
      body: "巡抚拱手道：‘总督大人谨慎，下官佩服。只是内阁催银甚急，三日之期恐生变数。’语气中带着明显的不快。"
    });
    view.dashboard.traces.push(`${option.title}文移`);
    view.run.decisionsCompletedToday = completed;
    view.run.totalDecisionsCompleted += 1;
    view.run.version += 1;

    if (completed < 2) {
      view.activeDecision = this.decision(view.run.currentDay, completed + 1);
      view.run.status = "awaiting_decision";
    } else {
      view.activeDecision = null;
      view.run.status = "awaiting_day_advance";
      view.daySummary = {
        day: view.run.currentDay,
        publicSummary: `第 ${view.run.currentDay} 天的两次选择已经扩散。`,
        playerKeyDecisions: view.decisionHistory.slice(-2).map((item) => ({ summary: item.title })),
        riskForTomorrow: "旧选择可能被重新解释"
      };
      view.daySummaries[view.run.currentDay] = view.daySummary;
      view.messages.push({
        id: `summary_${view.run.currentDay}`,
        day: view.run.currentDay,
        time: "日终",
        type: "day_summary",
        label: "日终回响",
        title: `第 ${view.run.currentDay} 天收束`,
        body: view.daySummary.publicSummary
      });
    }
    return json(view);
  }

  advance(view) {
    if (view.run.currentDay >= 7 || view.run.decisionsCompletedToday !== 2 || view.activeDecision) {
      return json({ message: "当日两次决策尚未完成" }, 400);
    }
    view.run.currentDay += 1;
    view.run.currentTime = view.run.currentDay === 7 ? "御前" : "清晨";
    view.run.location = view.run.currentDay === 7 ? "京师 · 御前" : "杭州总督府 · 内厅";
    view.run.decisionsCompletedToday = 0;
    view.run.version += 1;
    view.daySummary = null;
    if (view.run.currentDay === 7) {
      view.run.status = "awaiting_finalization";
      view.activeDecision = null;
    } else {
      view.run.status = "awaiting_decision";
      view.activeDecision = this.decision(view.run.currentDay, 1);
      view.messages.push({
        id: `opening_${view.run.currentDay}`,
        day: view.run.currentDay,
        time: "清晨",
        type: "system",
        label: "系统",
        title: `第 ${view.run.currentDay} 天局势`,
        body: "昨日的选择已经成为今天的新压力。"
      });
      if (view.run.currentDay >= 3) {
        view.dashboard.causalRecallMessages.push({
          visibility: "player_visible",
          title: "旧策回响",
          recallText: "这件事来自此前留下的一份文移。",
          reframedBy: "浙江巡抚",
          currentPressure: "巡抚开始争夺局势的解释权。",
          newFrame: "此前的谨慎被对手定性为拖延。",
          activation: "backfire",
          hiddenMeaning: "不显示"
        });
      }
    }
    return json(view);
  }

  finalize(view) {
    if (view.run.currentDay !== 7 || view.run.status !== "awaiting_finalization") {
      return json({ message: "只有第七日才能裁决" }, 400);
    }
    const allA = view.decisionHistory.every((item) => item.optionKey === "A");
    const title = allA ? "国策缓行，清弊得名" : "商人救局，银路受制";
    view.run.status = "finished";
    view.run.version += 1;
    view.finalJudgement = {
      globalEnding: { title, narrative: allA ? "浙江暂稳，清弊路线获得认可。" : "银粮暂稳，但商会控制力上升。" },
      personalEnding: { rank: allA ? "一等稳局" : "三等留任", title: "总督命数", archetype: allA ? "守局者" : "借势者", narrative: allA ? "你保住浙江，也保住了解释权。" : "你保住官位，却欠下商会一笔命运债。" },
      emperorJudgement: { comment: allA ? "此人知轻重，可留任观后。" : "能办事，但不可使其独掌银路。" },
      futureAftermath: [{ text: allA ? "暗账调查继续。" : "商会开始要求兑现旧诺。" }],
      causalExplanation: {
        keyMovesThatSavedYou: [{ text: "第 1 天的首策留下了可验证文移。" }],
        keyMovesThatHurtYou: [{ text: allA ? "巡抚仍在争功。" : "多次借用商会粮路。" }],
        fateDebts: [{ text: allA ? "县令仍保留证据副本。" : "商会会记住每一次口头承诺。" }]
      }
    };
    view.outcome = view.finalJudgement;
    view.messages.push({ id: "final", day: 7, time: "御前", type: "final", label: "最终裁决", title, body: view.finalJudgement.globalEnding.narrative });
    return json(view);
  }

  createView(id) {
    return {
      run: {
        id,
        storyId: "sangtian-zhao",
        title: "桑田诏：嘉靖财政危局",
        location: "杭州总督府 · 内厅",
        currentDay: 1,
        currentTime: "清晨",
        totalDays: 7,
        status: "awaiting_decision",
        version: 1,
        decisionsCompletedToday: 0,
        decisionsRequiredToday: 2,
        totalDecisionsCompleted: 0,
        totalDecisionsRequired: 12
      },
      player: {
        roleName: "浙江总督",
        name: "郝帅彬",
        rank: "从四品",
        office: "兵部侍郎衔",
        fateQuestion: "保浙江，还是保自己？",
        goals: ["稳定浙江局势", "控制巡抚势力", "避免皇帝生疑"],
        resources: [["粮银", "42万两"], ["幕僚", "4人"]],
        leverage: ["半页田契暗账", "县令密信渠道"]
      },
      messages: [{ id: "opening_1", day: 1, time: "清晨", type: "system", label: "系统", title: "改桑令下", body: "京师急诏抵达浙江。" }],
      activeDecision: this.decision(1, 1),
      dashboard: {
        worldState: [["国库银两", 42], ["民心", 55], ["粮价", 62], ["皇帝信任", 43]],
        relationships: [{ name: "浙江巡抚", person: "刘瑾", stance: "戒备", score: 35 }],
        risks: [["粮价失控", "中"], ["巡抚越级", "高"]],
        traces: [],
        visibleCausalCard: null,
        causalRecallMessages: []
      },
      publicRoleInferences: [{ publicIdentity: "浙江巡抚", publicGoal: "推进改桑", observableSignals: ["只报进度，不报风险"] }],
      decisionHistory: [],
      daySummary: null,
      daySummaries: {},
      causalLedger: { fateSeeds: [{ hiddenMeaning: "只应留在服务端的含义", triggerConditions: ["秘密条件"] }] }
    };
  }

  decision(day, index) {
    const options = [
      { key: "A", title: "稳局留证", body: "先稳住局势，并留下正式文移。", gain: "保留解释权", risk: "短期进度较慢" },
      { key: "B", title: "追加密奏", body: "将风险另写密奏送往京师。", gain: "皇帝提前知情", risk: "内阁怀疑越级" },
      { key: "C", title: "借商会平粮", body: "让商会先行放粮。", gain: "粮价暂缓", risk: "商会坐大" }
    ];
    if (day === 6) options.push({ key: "D", title: "御前对质", body: "带齐文书，请各方御前对质。", gain: "证据公开", risk: "胜负集中" });
    return {
      messageId: `decision_${day}_${index}`,
      title: index === 1 ? "如何应对眼前压力" : "如何处理随后的角色反应",
      help: "选择会改变状态、关系和后续因果。",
      options
    };
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(structuredClone(payload)), {
    status,
    headers: { "content-type": "application/json" }
  });
}
