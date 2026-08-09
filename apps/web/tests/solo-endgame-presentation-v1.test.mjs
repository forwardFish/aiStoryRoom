import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  adaptPresentationForExistingFinalRenderer,
  applyAuthoritativeSoloEndgame,
  enhanceSoloEndgamePage,
  installSoloEndgamePresentationV1,
  normalizeEndgamePresentationV1,
} from "../public/solo-endgame-presentation-v1.js";

const RUN_ID = "solo_ovl_0123456789abcdef0123456789abcdef";

function presentation(overrides = {}) {
  return {
    schemaVersion: "endgame_presentation_v1",
    resultType: "SOLO_PART_END",
    verdict: "COSTLY_WIN",
    verdictLabel: "你守住了底线，但承担了代价",
    title: "守土担责",
    verdictLine: "问责落到了你自己名下。",
    narrative: "驿骑带着首报离开杭州，总督仍站在签押房中。",
    gain: ["民田边界仍然有效。", "县册证据链仍可追索。"],
    loss: ["你失去了继续含混退让的余地。"],
    causes: [{
      stageIndex: 20,
      sourceActionId: "internal-action-id",
      sourceRoleName: "浙江总督",
      actionTitle: "签发分路奏报",
      factText: "首份奏报已经离开浙江。",
      direction: "DECISIVE",
    }],
    reveal: {
      title: "尚未解决",
      text: "京师将如何处理督抚分歧，仍要进入后续部分。",
    },
    replayHint: "下一局可以更早分配复核责任。",
    replayActions: [
      {
        type: "RESTART_SAME_STORY",
        label: "重新开始",
        href: "/role-select?story=sangtian&start=new",
        enabled: true,
        disabledReason: null,
      },
      {
        type: "CHANGE_ROLE",
        label: "换个角色",
        href: null,
        enabled: false,
        disabledReason: "当前运行时尚未开放其他可完整体验的单人角色。",
      },
      {
        type: "CONTINUE_NEXT_PART",
        label: "进入第二部分",
        href: null,
        enabled: false,
        disabledReason: "第二部分尚未开放。",
      },
      {
        type: "BACK_TO_WORLDS",
        label: "返回世界大厅",
        href: "/worlds",
        enabled: true,
        disabledReason: null,
      },
    ],
    ...overrides,
  };
}

test("web projection accepts only strict endgame_presentation_v1 and strips internal action IDs", () => {
  const normalized = normalizeEndgamePresentationV1(presentation());
  assert.ok(normalized);
  assert.equal(normalized.resultType, "SOLO_PART_END");
  assert.equal(normalized.causes[0].sourceActionId, null);
  assert.equal(JSON.stringify(normalized).includes("internal-action-id"), false);

  assert.equal(normalizeEndgamePresentationV1({
    ...presentation(),
    causes: [
      ...presentation().causes,
      ...presentation().causes,
      ...presentation().causes,
      ...presentation().causes,
    ],
  }), null);
  assert.equal(normalizeEndgamePresentationV1({
    ...presentation(),
    replayActions: [{
      type: "RESTART_SAME_STORY",
      label: "恶意外链",
      href: "//evil.example/path",
      enabled: true,
      disabledReason: null,
    }],
  }), null);
});

test("legacy renderer adapter contains display fields only", () => {
  const normalized = normalizeEndgamePresentationV1(presentation());
  const adapted = adaptPresentationForExistingFinalRenderer(normalized);
  assert.equal(adapted.globalEnding.title, "守土担责");
  assert.equal(adapted.personalEnding.rank, "你守住了底线，但承担了代价");
  const serialized = JSON.stringify(adapted);
  assert.doesNotMatch(serialized, /internal-action-id|sourceActionId|endingKey|factKey|score/);
});

test("completed OpenNovel projection reads Result API once and overwrites local placeholder", async () => {
  let resultReads = 0;
  class Storage {
    constructor() {
      this.projection = {
        room: { id: RUN_ID, mode: "solo" },
        completed: true,
      };
    }
    async restoreOrCreate() {
      return { run: { id: RUN_ID }, finalJudgement: { local: "placeholder" } };
    }
    async getRun() {
      return { run: { id: RUN_ID }, finalJudgement: { local: "placeholder-again" } };
    }
    async loadResult() {
      resultReads += 1;
      return { presentation: presentation() };
    }
  }
  installSoloEndgamePresentationV1(Storage, {});
  const storage = new Storage();
  const first = await storage.restoreOrCreate();
  const refreshed = await storage.getRun();
  assert.equal(resultReads, 1);
  assert.equal(first.endgamePresentation.title, "守土担责");
  assert.equal(first.finalJudgement.local, undefined);
  assert.equal(refreshed.finalJudgement.globalEnding.title, "守土担责");
});

test("invalid Result API data never restores local placeholder and is retried on refresh", async () => {
  let resultReads = 0;
  const storage = {
    projection: { room: { id: RUN_ID, mode: "solo" }, completed: true },
    async loadResult() {
      resultReads += 1;
      return resultReads === 1
        ? { presentation: { schemaVersion: "wrong" } }
        : { presentation: presentation() };
    },
  };
  const original = { run: { id: RUN_ID }, finalJudgement: { local: "placeholder" } };
  const failed = await applyAuthoritativeSoloEndgame(storage, original, {});
  assert.equal(failed.finalJudgement, null);
  assert.equal(failed.endgamePresentation, null);
  const retried = await applyAuthoritativeSoloEndgame(storage, original, {});
  assert.equal(resultReads, 2);
  assert.equal(retried.endgamePresentation.title, "守土担责");
});

test("unfinished and non-OpenNovel Solo projections keep their existing behavior", async () => {
  let resultReads = 0;
  const loadResult = async () => { resultReads += 1; return {}; };
  const unfinished = {
    projection: { room: { id: RUN_ID, mode: "solo" }, completed: false },
    loadResult,
  };
  const otherSolo = {
    projection: { room: { id: "solo_continuous_1", mode: "solo" }, completed: true },
    loadResult,
  };
  const view = { run: { id: RUN_ID }, finalJudgement: { legacy: true } };
  assert.equal(await applyAuthoritativeSoloEndgame(unfinished, view, {}), view);
  assert.equal(await applyAuthoritativeSoloEndgame(otherSolo, view, {}), view);
  assert.equal(resultReads, 0);
});

test("existing final judgement DOM shows Part ending, outcome, causes and server replay actions", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <section class="decision-zone final-judgement" data-testid="final-judgement">
      <div class="final-seal">裁</div>
      <p class="final-kicker">御前裁决 · 第七日</p>
      <h2>本地占位标题</h2>
      <p class="final-global">本地占位判词</p>
      <div class="final-grid"><article><h3>个人结局</h3><p>最后一幕</p></article></div>
      <button id="resetDecisionBtn">重开一局</button>
    </section>
  </body>`, { url: "https://ourmanyworlds.test/game?runId=" + RUN_ID });
  const normalized = normalizeEndgamePresentationV1(presentation());
  assert.equal(enhanceSoloEndgamePage(dom.window.document, normalized), true);

  const final = dom.window.document.querySelector('[data-testid="final-judgement"]');
  assert.equal(final.dataset.endgameSchema, "endgame_presentation_v1");
  assert.match(final.textContent, /《桑田诏》第一部分结局/);
  assert.match(final.textContent, /你守住了底线，但承担了代价/);
  assert.match(final.textContent, /守土担责/);
  assert.match(final.textContent, /问责落到了你自己名下/);
  assert.match(final.textContent, /民田边界仍然有效/);
  assert.match(final.textContent, /你失去了继续含混退让的余地/);
  assert.match(final.textContent, /第 20 回合 · 签发分路奏报/);
  assert.match(final.textContent, /尚未解决/);
  assert.match(final.textContent, /下一局值得尝试/);

  const restart = final.querySelector('[data-replay-action="RESTART_SAME_STORY"]');
  assert.equal(restart.getAttribute("href"), "/role-select?story=sangtian&start=new");
  const nextPart = final.querySelector('[data-replay-action="CONTINUE_NEXT_PART"]');
  assert.equal(nextPart.disabled, true);
  assert.match(nextPart.title, /第二部分尚未开放/);
  assert.equal(final.querySelector("#resetDecisionBtn").hidden, true);
  assert.doesNotMatch(final.innerHTML, /internal-action-id|endingKey|factKey|score/);
  dom.window.close();
});

test("DOM enhancement is idempotent and does not create a parallel page", () => {
  const dom = new JSDOM(`<!doctype html><body><main id="app">
    <section data-testid="final-judgement"><p class="final-kicker"></p><h2></h2><p class="final-global"></p><button id="resetDecisionBtn"></button></section>
  </main></body>`);
  const normalized = normalizeEndgamePresentationV1(presentation());
  enhanceSoloEndgamePage(dom.window.document, normalized);
  enhanceSoloEndgamePage(dom.window.document, normalized);
  assert.equal(dom.window.document.querySelectorAll('[data-testid="final-judgement"]').length, 1);
  assert.equal(dom.window.document.querySelectorAll('[data-solo-endgame-v1="details"]').length, 1);
  assert.equal(dom.window.document.querySelectoqAll('[data-solo-endgame-v1="replay-actions"]').length, 1);
  dom.window.close();
});
