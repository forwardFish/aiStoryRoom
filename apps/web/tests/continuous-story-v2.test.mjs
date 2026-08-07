import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { roomSessionForView } from "../public/app.js";
import { bootGamePage } from "../public/game-bootstrap.js";
import { createContinuousStoryV2App } from "../public/continuous-story-v2-client.js";
import { ContinuousStoryV2LegacyStorage } from "../public/continuous-story-v2-legacy-storage.js";

function projection(overrides = {}) {
  return {
    schemaVersion: "continuous_game_projection_v2",
    generatedAt: new Date().toISOString(),
    worldSequence: 1,
    room: { id: "room-v2", title: "桑田诏：嘉靖财政危局", worldId: "sangtian", status: "playing", mode: "solo" },
    player: { userId: "u1", roleId: "r1", roleKey: "zhejiang_governor", roleName: "浙江总督", identity: "统筹浙江军政的封疆大吏", personalGoal: "稳住浙江，并查明粮价失控背后的真正力量。" },
    control: { mode: "HUMAN_ACTIVE", epoch: 1, canHumanAct: true },
    currentTurn: {
      id: "turn-1", revision: 1, stageIndex: 1, turnIndex: 1, baseWorldSequence: 1, status: "OPEN",
      title: "两册粮账在总督案前对不上数",
      narrative: "午后，巡抚亲自把两册粮账放到案上。城南已有三家米行闭门，门外却有人声称仓中仍有余粮。你必须在日落前决定先查账、查仓，还是先稳住会馆。",
      visibleFacts: [{ factKey: "ledger_conflict", content: "两册粮账对同一批存粮给出了相反数字。" }],
      framing: "日落前，你准备先从哪一处下手？",
      decisions: [
        { id: "d1", label: "先封存两册粮账，让经手人分别写下数字来源", description: "先固定原件和口供，代价是巡抚会立刻知道你不信任他的账。", intentDraft: { objective: "查清两册粮账矛盾的经手责任", target: { type: "ROLE", id: "r2", label: "浙江巡抚" }, method: "封存两册粮账，让经手人分别写下数字来源", leverageKeys: [], visibility: "LIMITED", riskTolerance: "MEDIUM", fallback: null, condition: null } },
        { id: "d2", label: "带巡抚直奔城南粮仓，当场清点", description: "把争论落到实物，但若仓中空虚，你要承担惊扰粮市的责任。", intentDraft: { objective: "核定城南粮仓实存", target: { type: "LOCATION", id: "granary", label: "城南粮仓" }, method: "与巡抚当场清点封条、仓单和实粮", leverageKeys: [], visibility: "PUBLIC", riskTolerance: "HIGH", fallback: null, condition: null } }
      ],
      availableTargets: [{ type: "ROLE", id: "r2", label: "浙江巡抚" }, { type: "LOCATION", id: "granary", label: "城南粮仓" }, { type: "PUBLIC_FRAME", id: "stage:1", label: "当前粮价危局" }],
      customActionAllowed: true
    },
    timeline: [],
    otherActors: [{ roleId: "r1", roleName: "浙江总督", controllerKind: "HUMAN", stageIndex: 1 }, { roleId: "r2", roleName: "浙江巡抚", controllerKind: "AI", stageIndex: 2 }],
    visibleAssets: [{ assetKey: "governor_seal", kind: "seal", label: "总督关防", quantity: 1, status: "ACTIVE" }],
    evidenceHoldings: [], commitments: [], armedConditions: [], pendingInteractions: [], observableTraces: [],
    access: { state: "FREE", requiredCredits: 100, canCurrentUserUnlock: false, unlockEndpoint: "/v4/story-runs/room-v2/unlock" },
    completed: false,
    resultUrl: null,
    ...overrides
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function page(url = "http://game.test/game?runId=room-v2") {
  const dom = new JSDOM('<main id="app"></main>', { url });
  dom.window.__STORY_STREAM_DELAY_MULTIPLIER__ = 0;
  dom.window.setTimeout = (callback) => { callback(); return 1; };
  dom.window.clearTimeout = () => {};
  dom.window.setInterval = () => 1;
  dom.window.clearInterval = () => {};
  return { dom, root: dom.window.document.getElementById("app") };
}

async function bootOldPage(value = projection(), fetchImpl = async () => json(value)) {
  const { dom, root } = page();
  const app = createContinuousStoryV2App({ root, window: dom.window, runId: value.room.id, initialProjection: value, fetchImpl });
  await app.boot();
  return { dom, root, app };
}

function enterSituation(root) {
  const button = root.querySelector("#beginStoryBtn");
  assert.ok(button, "the approved old opening page must lead into the situation");
  button.click();
}

test("reading a resolving Solo projection never triggers generation or retry", async () => {
  const calls = [];
  const resolving = projection({
    currentTurn: { ...projection().currentTurn, status: "RESOLVING" }
  });
  const storage = new ContinuousStoryV2LegacyStorage({
    runId: resolving.room.id,
    initialProjection: resolving,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), method: String(init.method || "GET").toUpperCase() });
      return json(resolving);
    }
  });

  await storage.getRun();

  assert.deepEqual(calls.map((call) => call.method), ["GET"]);
  assert.equal(calls.some((call) => call.url.includes("generation/retry")), false);
});

test("a missing opening turn is not adapted as a completed story", async () => {
  const waitingForOpening = projection({ currentTurn: null, completed: false });
  const storage = new ContinuousStoryV2LegacyStorage({
    runId: waitingForOpening.room.id,
    initialProjection: waitingForOpening,
    fetchImpl: async () => json(waitingForOpening)
  });

  const adapted = await storage.restoreOrCreate();

  assert.equal(adapted.run.status, "playing");
  assert.equal(adapted.run.resultUrl, undefined);
});

test("opening recovery is visible but retries only after an explicit click", async () => {
  const calls = [];
  const waitingForOpening = projection({ currentTurn: null, completed: false });
  const { dom, app } = await bootOldPage(waitingForOpening, async (url, init = {}) => {
    calls.push({ url: String(url), method: String(init.method || "GET").toUpperCase() });
    if (String(url).includes("generation/retry")) return json({ scheduled: true, status: "REQUEUED", kind: "OPENING" }, 202);
    return json(waitingForOpening);
  });
  const retry = dom.window.document.querySelector("[data-v2-retry-opening]");
  assert.ok(retry, "opening recovery must be visible without inventing a completed result");
  assert.equal(calls.some((call) => call.url.includes("generation/retry")), false);

  retry.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls.filter((call) => call.url.includes("generation/retry")).length, 1);
  assert.match(dom.window.document.body.textContent, /Opening retry queued/);
  app.destroy(); dom.window.close();
});

test("Solo opening recovery stays explicit and does not poll the read projection", async () => {
  const waitingForOpening = projection({ currentTurn: null, completed: false });
  const { dom, root } = page();
  const intervals = [];
  dom.window.setInterval = (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; };
  let gameReads = 0;
  const app = createContinuousStoryV2App({
    root,
    window: dom.window,
    runId: waitingForOpening.room.id,
    initialProjection: waitingForOpening,
    fetchImpl: async (url) => {
      if (String(url).includes("/game")) { gameReads += 1; return json(waitingForOpening); }
      return json({});
    }
  });
  await app.boot();

  assert.deepEqual(intervals, []);
  assert.equal(gameReads, 0);
  assert.ok(dom.window.document.querySelector("[data-v2-opening-recovery]"));
  app.destroy(); dom.window.close();
});

test("a human-controlled Solo story does not render the internal World Credits banner", async () => {
  const withCredits = projection({
    creditControl: {
      policyVersion: "active_action_v1",
      available: 30,
      standardActionCost: 1,
      customActionCost: 2,
      canRequestSponsor: false
    }
  });
  const { dom, root, app } = await bootOldPage(withCredits);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const banner = dom.window.document.querySelector("[data-v2-credit-chrome]");

  assert.equal(banner, null);
  assert.ok(root.querySelector(".causal-center"), root.innerHTML.slice(0, 300));
  assert.ok(root.querySelector("#beginStoryBtn"));
  app.destroy(); dom.window.close();
});
test("Solo ignores stale multiplayer waiting state", () => {
  assert.equal(roomSessionForView({
    continuousV2: true,
    roomSession: { ownSubmitted: true, allSubmitted: true, resolving: true }
  }), null);
});

test("silent projection refresh preserves both sidebar scroll positions", async () => {
  const current = projection();
  const { dom, root, app } = await bootOldPage(current, async () => json(current));
  enterSituation(root);
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() { return this.matches?.(".causal-left, .causal-right") ? 1_200 : 0; }
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() { return this.matches?.(".causal-left, .causal-right") ? 300 : 0; }
  });
  const left = root.querySelector(".causal-left");
  const right = root.querySelector(".causal-right");
  left.scrollTop = 480;
  right.scrollTop = 620;

  await app.refresh(true);

  assert.equal(root.querySelector(".causal-left").scrollTop, 480);
  assert.equal(root.querySelector(".causal-right").scrollTop, 620);
  app.destroy();
  dom.window.close();
});


test("Story V2 uses the approved old main-game layout and shows story before decisions", async () => {
  const { dom, root, app } = await bootOldPage();
  const hiddenSituationSummaries = [...root.querySelectorAll(".v2-current-situation-summary")];
  assert.equal(hiddenSituationSummaries.length, 2);
  assert.ok(hiddenSituationSummaries.every((element) => element.hidden), "the saved current-situation summary must stay hidden in both top rows");
  assert.equal(root.querySelector(".top-day")?.textContent.trim(), "第 1 章");
  assert.ok(root.querySelector('[data-testid="story-shell"]'));
  assert.ok(root.querySelector('[data-testid="role-opening"]'));
  assert.equal(root.querySelector('[data-testid="continuous-story-v2-shell"]'), null);
  assert.match(root.textContent, /巡抚亲自把两册粮账放到案上/);
  assert.doesNotMatch(root.textContent, /决策后立即单独推演/);
  assert.match(root.textContent, /银两\s*42 万两/);
  assert.match(root.textContent, /粮草\s*23 万石/);
  assert.match(root.textContent, /兵丁\s*4\/5/);
  assert.match(root.textContent, /幕僚\s*4 人/);
  assert.match(root.textContent, /密报\s*2 条/);
  assert.match(root.textContent, /稳定浙江局势/);
  assert.match(root.textContent, /控制巡抚势力/);
  assert.match(root.textContent, /避免皇帝生疑/);

  enterSituation(root);
  assert.ok(root.querySelector('[data-testid="decision-zone"]'));
  assert.ok(root.querySelector('[data-testid="maneuver-panel"]'));
  assert.match(root.textContent, /人物交谈/);
  assert.match(root.textContent, /派遣调查/);
  assert.match(root.textContent, /使用筹码/);
  assert.match(root.textContent, /自拟谋划/);
  assert.match(root.textContent, /先封存两册粮账，让经手人分别写下数字来源/);
  assert.doesNotMatch(root.textContent, /保留证据并交叉核验|推进本职方案并说明代价|协调另一位角色的资源/);
  assert.doesNotMatch(root.textContent, /等待全部玩家|共同结算|角色控制|actionKey/);
  app.destroy(); dom.window.close();
});

test("one decision resolves immediately and reveals its result plus the next real story", async () => {
  const initial = projection();
  const next = projection({
    worldSequence: 2,
    currentTurn: { ...initial.currentTurn, id: "turn-2", revision: 1, stageIndex: 2, turnIndex: 2, baseWorldSequence: 2, title: "粮仓门前出现了巡检司的封条", narrative: "天刚亮，粮仓门前已经钉上巡检司的封条。昨夜盘出的短缺数字被人提前送进了布政使司。" },
    timeline: [{ id: "result-1", kind: "RESULT", title: "封存粮账之后", content: "两名经手人的口供在第三笔入库日期上撞出了矛盾。", worldSequence: 2, createdAt: new Date().toISOString() }]
  });
  const requests = [];
  const fetchImpl = async (input, init = {}) => {
    const path = new URL(String(input), "http://game.test").pathname;
    requests.push({ path, body: init.body ? JSON.parse(init.body) : null });
    if (path.endsWith("/turns/turn-1/decision")) return json({ accepted: true, resolution: { id: "resolution-1", resultNarrative: "两名经手人的口供彼此矛盾。", nextHook: "巡检司抢先封仓。" }, gameProjection: next });
    return json(next);
  };
  const { dom, root, app } = await bootOldPage(initial, fetchImpl);
  enterSituation(root);
  root.querySelector('input[name="decision"][value="A"]').checked = true;
  await app.submitDecision();

  const submitted = requests.find((request) => request.path.endsWith("/turns/turn-1/decision"));
  assert.equal(submitted.body.candidateId, "d1");
  assert.equal(submitted.body.turnRevision, 1);
  assert.equal(submitted.body.controlEpoch, 1);
  assert.equal(submitted.body.intent.objective, "查清两册粮账矛盾的经手责任");
  assert.match(root.textContent, /第三笔入库日期上撞出了矛盾/);
  assert.match(root.textContent, /粮仓门前已经钉上巡检司的封条/);
  assert.doesNotMatch(root.textContent, /等待其他角色|等待全部玩家/);
  app.destroy(); dom.window.close();
});

test("legacy Continuous Story V2 projections keep the four-action surface fail-closed", async () => {
  const initial = projection();
  const requests = [];
  const { dom, root, app } = await bootOldPage(initial, async (input, init = {}) => {
    requests.push({ input: String(input), method: init.method || "GET" });
    return json(initial);
  });
  enterSituation(root);

  const actions = [...root.querySelectorAll("[data-maneuver-type]")];
  assert.equal(actions.length, 4);
  assert.ok(actions.every((button) => button.disabled));
  assert.equal(root.querySelector("#maneuverSubmit"), null);
  assert.equal(root.querySelector("[data-maneuver-contact]"), null);
  assert.equal(root.querySelector("#maneuverCustomText"), null);
  assert.equal(requests.length, 0);
  app.destroy();
  dom.window.close();
});

async function waitForTest(predicate, timeout = 1_000) {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(predicate(), "expected the independent story resolution to finish");
}
test("a resolving database turn never republishes stale choices", async () => {
  const resolving = projection({
    currentTurn: { ...projection().currentTurn, status: "RESOLVING" }
  });
  const { dom, root, app } = await bootOldPage(resolving);
  assert.ok(root.querySelector('[data-testid="ai-simulating"]'));
  assert.equal(root.querySelector(".narrative-idle"), null);
  assert.equal(root.querySelector('[data-testid="decision-zone"]'), null);
  assert.doesNotMatch(root.textContent, /先封存两册粮账，让经手人分别写下数字来源/);
  app.destroy(); dom.window.close();
});

test("refresh automatically reveals a result published after the resolving screen", async () => {
  const initial = projection();
  const resolving = projection({
    currentTurn: { ...initial.currentTurn, status: "RESOLVING" }
  });
  const published = projection({
    worldSequence: 2,
    currentTurn: {
      ...initial.currentTurn,
      id: "turn-2",
      revision: 1,
      stageIndex: 2,
      turnIndex: 2,
      baseWorldSequence: 2,
      title: "清流县田契档房留下了空白契纸",
      narrative: "亲随赶到清流县时，档房门锁尚新，案上却少了昨夜借出的县册。"
    },
    timeline: [{
      id: "result-after-resolving",
      kind: "RESULT",
      title: "封存现场之后",
      content: "亲随封住档房，并从窗下泥印里辨出了两个人的足迹。",
      worldSequence: 2,
      createdAt: new Date().toISOString()
    }]
  });
  const { dom, root, app } = await bootOldPage(resolving, async () => json(published));
  assert.ok(root.querySelector('[data-testid="ai-simulating"]'));
  assert.equal(root.querySelector('[data-testid="decision-zone"]'), null);

  await app.refresh();
  assert.ok(root.querySelector('[data-testid="result-narrative"]'));
  assert.match(root.textContent, /从窗下泥印里辨出了两个人的足迹/);
  assert.match(root.textContent, /档房门锁尚新/);

  root.querySelector("#continueStoryBtn")?.click();
  assert.ok(root.querySelector('[data-testid="decision-zone"]'));
  assert.match(root.textContent, /清流县田契档房留下了空白契纸/);
  app.destroy(); dom.window.close();
});

test("refresh automatically reveals a published maneuver result with its decision form", async () => {
  const initial = projection();
  const resolving = projection({ currentTurn: { ...initial.currentTurn, status: "RESOLVING" } });
  const published = projection({
    worldSequence: 2,
    currentTurn: { ...initial.currentTurn, id: "turn-after-investigation", stageIndex: 2, turnIndex: 2, baseWorldSequence: 2, title: "幕僚带回两份不同日期的仓单", narrative: "幕僚回府时，把两份盖着同一枚仓印、日期却相差三日的仓单放在案上。" },
    timeline: [{ id: "result-investigation-refresh", kind: "RESULT", title: "调查带回了实证", content: "幕僚在仓门账房找到了被撕下的存根。", worldSequence: 2, createdAt: new Date().toISOString(), decisionForm: "INVESTIGATION" }]
  });
  const { dom, root, app } = await bootOldPage(resolving, async () => json(published));
  assert.ok(root.querySelector('[data-testid="ai-simulating"]'));
  await app.refresh();
  assert.equal(app.getState().resultStream?.kind, "maneuver");
  assert.match(root.textContent, /被撕下的存根/);
  assert.match(root.textContent, /日期却相差三日/);
  app.destroy(); dom.window.close();
});
test("TURN_MOVED refreshes the authoritative database projection instead of showing a stale conflict", async () => {
  const initial = projection();
  const resolving = projection({
    worldSequence: 2,
    currentTurn: { ...initial.currentTurn, status: "RESOLVING", revision: 2, baseWorldSequence: 2 }
  });
  let reads = 0;
  const { dom, root, app } = await bootOldPage(initial, async (input) => {
    const path = new URL(String(input), "http://game.test").pathname;
    if (path.endsWith("/decision")) return json({ code: "TURN_MOVED", message: "This situation has already moved" }, 409);
    if (path.endsWith("/game")) { reads += 1; return json(resolving); }
    return json({ accepted: true });
  });
  enterSituation(root);
  root.querySelector('input[name="decision"][value="A"]').checked = true;
  await app.submitDecision();
  assert.equal(reads, 1);
  assert.equal(root.querySelector('[data-testid="decision-zone"]'), null);
  app.destroy(); dom.window.close();
});

test("refresh preserves a human-written custom decision without publishing it", async () => {
  const revised = projection({ currentTurn: { ...projection().currentTurn, revision: 2, baseWorldSequence: 2 } });
  const { dom, root, app } = await bootOldPage(projection(), async () => json(revised));
  enterSituation(root);
  const textarea = root.querySelector("#customDecision");
  const draft = "先扣住两册原账，再让两个经手人分开说明第三笔入库日期";
  textarea.value = draft;
  textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await app.refresh();
  assert.equal(root.querySelector("#customDecision").value, draft);
  assert.equal(app.getState().customAction, draft);
  app.destroy(); dom.window.close();
});

test("a cross-role request is answered as its own immediate decision", async () => {
  const interaction = {
    id: "interaction-1", sourceRoleId: "r2", sourceRoleName: "浙江巡抚", requestKind: "REQUEST_TESTIMONY",
    pressure: "巡抚要你在日落前共同签押粮册", observableTrace: null, expiresAt: null,
    responseOptions: [{ id: "interaction-1:counter", label: "先要求巡抚交出原始仓单，再谈共同签押", description: "把交换条件说清楚。", intentDraft: { objective: "以原始仓单换取共同签押", target: { type: "ROLE", id: "r2", label: "浙江巡抚" }, method: "请巡抚先交出原始仓单，再讨论共同签押", leverageKeys: [], visibility: "LIMITED", riskTolerance: "HIGH", fallback: null, condition: null } }]
  };
  const initial = projection({ pendingInteractions: [interaction] });
  const requests = [];
  const { dom, root, app } = await bootOldPage(initial, async (input, init = {}) => {
    requests.push({ path: new URL(String(input), "http://game.test").pathname, body: init.body ? JSON.parse(init.body) : null });
    return json({ accepted: true, resolution: { id: "response-1", resultNarrative: "巡抚收到了你的条件。" }, gameProjection: projection() });
  });
  enterSituation(root);
  root.querySelector('input[name="decision"][value="A"]').checked = true;
  await app.submitDecision();
  const submitted = requests.find((request) => request.path.endsWith("/interactions/interaction-1/reply"));
  assert.equal(submitted.body.interactionId, "interaction-1");
  assert.equal(submitted.body.intent.objective, "以原始仓单换取共同签押");
  app.destroy(); dom.window.close();
});

test("Solo decisions do not start background polling during opening or resolution", async () => {
  const { dom, root } = page();
  const intervals = [];
  dom.window.setInterval = (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; };
  let gameReads = 0;
  let decisionStarted = false;
  let releaseDecision;
  const fetchImpl = async (input) => {
    const path = new URL(String(input), "http://game.test").pathname;
    if (path.endsWith("/game")) { gameReads += 1; return json(projection()); }
    if (path.includes("/decision")) {
      decisionStarted = true;
      await new Promise((resolve) => { releaseDecision = resolve; });
      return json({ accepted: true, resolution: { id: "r", resultNarrative: "结果" }, gameProjection: projection() });
    }
    return json({ accepted: true });
  };
  const app = createContinuousStoryV2App({ root, window: dom.window, runId: "room-v2", initialProjection: projection(), fetchImpl });
  await app.boot();
  assert.deepEqual(intervals, []);
  assert.equal(gameReads, 0, "opening narrative must not be replaced by polling");

  enterSituation(root);
  root.querySelector('input[name="decision"][value="A"]').checked = true;
  const submitted = app.submitDecision();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(decisionStarted, true);
  assert.equal(gameReads, 0, "polling must pause while a decision is resolving");
  releaseDecision();
  await submitted;
  app.destroy(); dom.window.close();
});

test("a completed role story renders in the old final-judgement page", async () => {
  const completed = projection({
    currentTurn: null,
    completed: true,
    room: { ...projection().room, status: "chapter_generated" },
    timeline: [{ id: "final", kind: "RESULT", title: "最后一次行动", content: "你封存了两册互相矛盾的粮账，第三笔入库日期由此成为御前可以复核的证据。", worldSequence: 8, createdAt: new Date().toISOString() }]
  });
  const { dom, root, app } = await bootOldPage(completed);
  assert.ok(root.querySelector('[data-testid="final-judgement"]'));
  assert.match(root.textContent, /第三笔入库日期由此成为御前可以复核的证据/);
  assert.equal(root.querySelector('[data-testid="continuous-story-v2-shell"]'), null);
  app.destroy(); dom.window.close();
});

test("game bootstrap selects Story V2 while Story V2 itself renders through the old page", async () => {
  const { dom, root } = page();
  let v2Booted = false;
  let oldSharedRoundLoaded = false;
  await bootGamePage({
    root,
    window: dom.window,
    fetchImpl: async () => json(projection()),
    loadContinuousStoryV2: async () => ({ createContinuousStoryV2App: () => ({ boot: async () => { v2Booted = true; } }) }),
    loadContinuous: async () => { oldSharedRoundLoaded = true; throw new Error("old shared-round client must not load"); }
  });
  assert.equal(v2Booted, true);
  assert.equal(oldSharedRoundLoaded, false);
  dom.window.close();
});
