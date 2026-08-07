import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createContinuousStoryV2App } from "../public/continuous-story-v2-maneuver-client.js";

function maneuverPanel({ remaining = 2, usedTypesToday = [] } = {}) {
  const used = new Set(usedTypesToday);
  return {
    sceneKey: "d1_1",
    enabled: remaining > 0,
    disabledReason: remaining > 0 ? null : "今日谋划机会已用完",
    quota: { perDay: 2, usedToday: 2 - remaining, remaining, usedTypesToday: [...used] },
    contact: {
      enabled: remaining > 0 && !used.has("contact"),
      usedToday: used.has("contact"),
      count: 1,
      disabledReason: used.has("contact") ? "今日已使用人物交谈" : null,
      options: [{
        roleKey: "county_magistrate",
        displayName: "卢象升",
        publicIdentity: "清流县令",
        relevance: "掌管当前原始名册",
      }],
    },
    investigate: {
      enabled: remaining > 0 && !used.has("investigate"),
      usedToday: used.has("investigate"),
      count: 1,
      disabledReason: used.has("investigate") ? "今日已使用派遣调查" : null,
      options: [{
        intentKey: "inspect_first_register_timing",
        title: "核对首批名册形成时间",
        summary: "首批名册形成得过早。",
      }],
    },
    leverage: {
      enabled: false,
      usedToday: used.has("leverage"),
      count: 0,
      disabledReason: "当前剧情没有合适的出牌时机",
      options: [],
    },
    custom: {
      enabled: remaining > 0 && !used.has("custom"),
      usedToday: used.has("custom"),
      disabledReason: used.has("custom") ? "今日已使用自拟谋划" : null,
      maxLength: 200,
    },
  };
}

function projection(overrides = {}) {
  return {
    schemaVersion: "continuous_game_projection_v2",
    generatedAt: new Date().toISOString(),
    worldSequence: 0,
    prologueNarrative: "这是尚未点击进入局势的开场白。",
    room: {
      id: "solo_ovl_opening_result",
      title: "Opening result lifecycle",
      worldId: "sangtian",
      status: "playing",
      mode: "solo",
    },
    player: {
      userId: "user-1",
      roleId: "role-governor",
      roleKey: "zhejiang_governor",
      roleName: "浙江总督",
      identity: "浙江总督",
      personalGoal: "稳住局势",
    },
    control: { mode: "HUMAN_ACTIVE", epoch: 1, canHumanAct: true },
    currentTurn: {
      id: "T01",
      revision: 0,
      stageIndex: 1,
      turnIndex: 1,
      baseWorldSequence: 0,
      status: "OPEN",
      title: "第一项主线决策",
      narrative: "正文已经加载，但玩家还没有点击进入局势。",
      visibleFacts: [],
      framing: "你要如何应对？",
      decisions: [{
        id: "G00_A",
        label: "先查验原册",
        description: "",
        intentDraft: {
          objective: "先查验原册",
          target: { type: "PUBLIC_FRAME", id: "scene:1", label: "当前局势" },
          method: "先查验原册",
          leverageKeys: [],
          visibility: "PRIVATE",
          riskTolerance: "MEDIUM",
          fallback: null,
          condition: null,
        },
      }],
      availableTargets: [{ type: "PUBLIC_FRAME", id: "scene:1", label: "当前局势" }],
      customActionAllowed: true,
    },
    timeline: [],
    otherActors: [],
    visibleAssets: [],
    evidenceHoldings: [],
    commitments: [],
    armedConditions: [],
    pendingInteractions: [],
    observableTraces: [],
    access: {
      state: "UNLOCKED",
      requiresUnlock: false,
      requiredCredits: 0,
      canCurrentUserUnlock: false,
      unlockEndpoint: null,
    },
    creditControl: {
      policyVersion: "active_action_v1",
      meteringMode: "OFF",
      available: 100,
      personalAvailable: 100,
      runAllowanceAvailable: 0,
      minimumActionCost: 1,
      standardActionCost: 1,
      customActionCost: 2,
      canRequestSponsor: false,
      sponsorshipRequestStatus: "NONE",
    },
    completed: false,
    resultUrl: null,
    maneuverVersion: 1,
    maneuverState: {
      schemaVersion: "openovel_maneuver_state_v1",
      usageDay: 1,
      sceneKey: "d1_1",
      maneuverOpportunitiesPerDay: 2,
      maneuversUsedToday: 0,
      maneuverOpportunitiesRemaining: 2,
      totalManeuversUsed: 0,
      usedTypesToday: [],
      usedLeverageKeys: [],
      discoveredFactKeys: [],
    },
    maneuverPanel: maneuverPanel(),
    leverageHand: { availableCount: 0, items: [] },
    ...overrides,
  };
}

function confirmedProjection() {
  return projection({
    maneuverVersion: 2,
    maneuverState: {
      ...projection().maneuverState,
      maneuversUsedToday: 1,
      maneuverOpportunitiesRemaining: 1,
      totalManeuversUsed: 1,
      usedTypesToday: ["contact"],
    },
    maneuverPanel: maneuverPanel({ remaining: 1, usedTypesToday: ["contact"] }),
    timeline: [{
      id: "maneuver-result-contact-1",
      kind: "RESULT",
      title: "清流县令的谨慎回应",
      content: "卢象升回道：原册大体还在，但明日能否全部送到，他现在不敢作保。",
      worldSequence: 0,
      createdAt: new Date().toISOString(),
      decisionForm: "CONVERSATION",
    }],
  });
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function waitForSelector(root, selector, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const node = root.querySelector(selector);
    if (node) return node;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`selector missing: ${selector}`);
}

async function waitForOpeningReady(root) {
  return waitForSelector(root, "#beginStoryBtn", 2_000);
}

test("confirmed maneuver result interrupts an unfinished prologue, then returns to opening lifecycle", async () => {
  const dom = new JSDOM("<!doctype html><main id=app></main>", {
    url: "http://game.test/game?runId=solo_ovl_opening_result",
    pretendToBeVisual: true,
  });
  dom.window.__STORY_STREAM_DELAY_MULTIPLIER__ = 0;
  const root = dom.window.document.getElementById("app");
  let current = projection();
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const path = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ path, method: init.method || "GET", body });
    if (path.endsWith("/maneuvers/preview")) {
      return json({
        accepted: true,
        previewed: true,
        previewToken: "signed-opening-contact-preview",
        preview: {
          previewId: "opening-contact-preview",
          maneuverType: "contact",
          decisionForm: "CONVERSATION",
          sceneKey: "d1_1",
          usageDay: 1,
          title: "准备与卢象升交谈",
          summary: body.messageText,
          targetLabel: "卢象升",
          costLabel: "确认后消耗 1 次主动谋划。",
          confirmLabel: "确认发送给卢象升",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        gameProjection: current,
      });
    }
    if (path.endsWith("/maneuvers/confirm")) {
      current = confirmedProjection();
      return json({
        accepted: true,
        replayed: false,
        result: { maneuverType: "contact" },
        resolution: {
          id: "maneuver-result-contact-1",
          resultNarrative: "卢象升回道：原册大体还在，但明日能否全部送到，他现在不敢作保。",
          nextHook: "",
        },
        gameProjection: current,
      });
    }
    return json(current);
  };

  const app = createContinuousStoryV2App({
    root,
    window: dom.window,
    runId: current.room.id,
    initialProjection: current,
    fetchImpl,
  });

  try {
    await app.boot();
    await waitForOpeningReady(root);
    assert.match(root.textContent, /这是尚未点击进入局势的开场白/);
    assert.equal(root.querySelector("#submitDecision"), null);

    root.querySelector('[data-maneuver-type="contact"]').click();
    root.querySelector('[data-contact-role="county_magistrate"]').click();
    const message = root.querySelector("#contactMessageText");
    message.value = "原始名册是否完整？";
    message.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    root.querySelector("#maneuverSubmit").click();

    const confirm = await waitForSelector(root, "#maneuverConfirm");
    assert.match(root.textContent, /准备与卢象升交谈/);
    assert.equal(current.maneuverVersion, 1, "preview must not mutate authority");
    confirm.click();

    const continueButton = await waitForSelector(root, "#continueStoryBtn");
    assert.match(root.textContent, /清流县令的谨慎回应/);
    assert.match(root.textContent, /原册大体还在/);
    assert.equal(root.querySelector("#beginStoryBtn"), null, "confirmed result must outrank the unfinished prologue");

    const stateAfterConfirm = app.getState();
    assert.equal(stateAfterConfirm.projection.worldSequence, 0, "maneuver must not advance the main story");
    assert.equal(stateAfterConfirm.projection.currentTurn.id, "T01");
    assert.equal(stateAfterConfirm.projection.maneuverVersion, 2);
    assert.equal(stateAfterConfirm.projection.maneuverState.maneuverOpportunitiesRemaining, 1);
    assert.deepEqual(stateAfterConfirm.projection.maneuverState.usedTypesToday, ["contact"]);

    continueButton.click();
    await waitForOpeningReady(root);
    assert.match(root.textContent, /这是尚未点击进入局势的开场白/);
    assert.equal(root.querySelector("#continueStoryBtn"), null);

    root.querySelector("#beginStoryBtn").click();
    await waitForSelector(root, "#submitDecision");
    assert.match(root.textContent, /第一项主线决策/);

    assert.equal(requests.filter((item) => item.path.endsWith("/maneuvers/preview")).length, 1);
    assert.equal(requests.filter((item) => item.path.endsWith("/maneuvers/confirm")).length, 1);
    assert.equal(requests.filter((item) => /\/game\/maneuvers$/.test(item.path)).length, 0);
  } finally {
    app.destroy();
    dom.window.close();
  }
});
