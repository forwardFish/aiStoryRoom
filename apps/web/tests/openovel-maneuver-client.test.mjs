import assert from "node:assert/strict";
import test from "node:test";
import {
  augmentManeuverView,
  ContinuousStoryV2LegacyStorage,
  installOpenNovelManeuverStoragePatch,
  maneuverRequest,
} from "../public/continuous-story-v2-maneuver-client.js";

installOpenNovelManeuverStoragePatch();

function projection(overrides = {}) {
  const panel = {
    sceneKey: "d1_1",
    enabled: true,
    disabledReason: null,
    quota: { perDay: 2, usedToday: 0, remaining: 2, usedTypesToday: [] },
    contact: {
      enabled: true,
      usedToday: false,
      count: 2,
      disabledReason: null,
      options: [{ roleKey: "county_magistrate", displayName: "卢象升", publicIdentity: "清流县令", relevance: "掌管原册" }],
    },
    investigate: {
      enabled: true,
      usedToday: false,
      count: 1,
      disabledReason: null,
      options: [{ intentKey: "inspect_first_register_timing", title: "核对名册时间", summary: "名册形成过早" }],
    },
    leverage: {
      enabled: true,
      usedToday: false,
      count: 1,
      disabledReason: null,
      options: [{
        leverageKey: "county_letter",
        label: "清流县令密信",
        description: "触发一次特殊回应",
        consumptionLabel: "使用后消失",
        requiresTarget: true,
        targets: [{ roleKey: "xunfu", displayName: "浙江巡抚" }],
      }],
    },
    custom: { enabled: true, usedToday: false, disabledReason: null, maxLength: 200 },
  };
  return {
    schemaVersion: "continuous_game_projection_v2",
    generatedAt: new Date().toISOString(),
    worldSequence: 0,
    room: { id: "solo_ovl_web", title: "桑田诏", worldId: "sangtian", status: "playing", mode: "solo" },
    player: { userId: "u1", roleId: "r1", roleKey: "zhejiang_governor", roleName: "浙江总督", identity: "浙江总督", personalGoal: "稳住浙江" },
    control: { mode: "HUMAN_ACTIVE", epoch: 1, canHumanAct: true },
    currentTurn: {
      id: "T01", revision: 0, stageIndex: 1, turnIndex: 1, baseWorldSequence: 0, status: "OPEN",
      title: "两封文书，一道急令", narrative: "正文已经完成加载。", visibleFacts: [], framing: "你要如何应对？",
      decisions: [{ id: "G00_A", label: "先封档房", description: "", intentDraft: { objective: "先封档房", target: { type: "PUBLIC_FRAME", id: "scene:1", label: "当前局势" }, method: "先封档房", leverageKeys: [], visibility: "PRIVATE", riskTolerance: "MEDIUM", fallback: null, condition: null } }],
      availableTargets: [{ type: "PUBLIC_FRAME", id: "scene:1", label: "当前局势" }], customActionAllowed: true,
    },
    timeline: [], otherActors: [], visibleAssets: [], evidenceHoldings: [], commitments: [], armedConditions: [], pendingInteractions: [], observableTraces: [],
    access: { state: "UNLOCKED", requiresUnlock: false, requiredCredits: 0, canCurrentUserUnlock: false, unlockEndpoint: null },
    creditControl: { policyVersion: "active_action_v1", meteringMode: "SHADOW", available: 100, personalAvailable: 100, runAllowanceAvailable: 0, minimumActionCost: 1, standardActionCost: 1, customActionCost: 2, canRequestSponsor: false, sponsorshipRequestStatus: "NONE" },
    completed: false,
    resultUrl: null,
    maneuverVersion: 11,
    maneuverState: { schemaVersion: "openovel_maneuver_state_v1", usageDay: 1, sceneKey: "d1_1", maneuverOpportunitiesPerDay: 2, maneuversUsedToday: 0, maneuverOpportunitiesRemaining: 2, totalManeuversUsed: 0, usedTypesToday: [], usedLeverageKeys: [], discoveredFactKeys: [] },
    maneuverPanel: panel,
    leverageHand: { availableCount: 3, items: [{ leverageKey: "county_letter", label: "清流县令密信", description: "触发一次特殊回应" }] },
    ...overrides,
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function nextProjection(type) {
  const current = projection();
  const decisionForm = ({ contact: "CONVERSATION", investigate: "INVESTIGATION", leverage: "LEVERAGE", custom: "CUSTOM_PLAN" })[type];
  return projection({
    maneuverVersion: 12,
    maneuverState: { ...current.maneuverState, maneuversUsedToday: 1, maneuverOpportunitiesRemaining: 1, totalManeuversUsed: 1, usedTypesToday: [type] },
    maneuverPanel: {
      ...current.maneuverPanel,
      quota: { ...current.maneuverPanel.quota, usedToday: 1, remaining: 1, usedTypesToday: [type] },
      [type]: { ...current.maneuverPanel[type], enabled: false, usedToday: true, disabledReason: "今日已使用" },
    },
    timeline: [{ id: `result-${type}`, kind: "RESULT", title: "谋划结果", content: "谋划已经进入当前故事。", worldSequence: 0, createdAt: new Date().toISOString(), decisionForm }],
  });
}

test("OpenNovel view receives authoritative maneuver panel instead of the loading fallback", async () => {
  const current = projection();
  const storage = new ContinuousStoryV2LegacyStorage({ runId: current.room.id, initialProjection: current, fetchImpl: async () => json(current) });
  const view = await storage.restoreOrCreate();
  assert.equal(view.run.version, 11);
  assert.equal(view.run.currentDay, 1);
  assert.equal(view.maneuverPanel.contact.enabled, true);
  assert.equal(view.maneuverPanel.investigate.enabled, true);
  assert.equal(view.maneuverPanel.custom.enabled, true);
  assert.notEqual(view.maneuverPanel.contact.disabledReason, "主动谋划配置正在加载");
  assert.equal(view.leverageHand.availableCount, 3);
});

test("four OpenNovel forms preview without side effects and confirm through the dedicated endpoint", async () => {
  const cases = [
    ["contact", { maneuverType: "contact", targetRoleKey: "county_magistrate", messageText: "原册是否完整？" }, { targetRoleKey: "county_magistrate", messageText: "原册是否完整？" }],
    ["investigate", { maneuverType: "investigate", intentKey: "inspect_first_register_timing" }, { intentKey: "inspect_first_register_timing" }],
    ["leverage", { maneuverType: "leverage", leverageKey: "county_letter", targetRoleKey: "xunfu" }, { leverageKey: "county_letter", targetRoleKey: "xunfu" }],
    ["custom", { maneuverType: "custom", customText: "派幕僚核验驿站登记。" }, { customText: "派幕僚核验驿站登记。" }],
  ];
  for (const [type, draft, expected] of cases) {
    const requests = [];
    const current = projection();
    const token = `signed-preview-token-${type}`;
    const storage = new ContinuousStoryV2LegacyStorage({
      runId: current.room.id,
      initialProjection: current,
      fetchImpl: async (url, init = {}) => {
        const body = init.body ? JSON.parse(init.body) : null;
        requests.push({ url: String(url), body });
        if (String(url).endsWith("/preview")) {
          return json({
            accepted: true,
            previewed: true,
            previewToken: token,
            preview: {
              previewId: `preview-${type}`,
              maneuverType: type,
              decisionForm: "CUSTOM_PLAN",
              sceneKey: "d1_1",
              usageDay: 1,
              title: "确认主动谋划",
              summary: "服务端已理解这次行动。",
              targetLabel: null,
              costLabel: "确认后才消耗一次谋划。",
              confirmLabel: "确认执行",
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
            gameProjection: current,
          });
        }
        return json({
          accepted: true,
          replayed: false,
          result: { maneuverType: type },
          resolution: { id: `result-${type}`, resultNarrative: "谋划已经进入当前故事。", nextHook: "" },
          gameProjection: nextProjection(type),
        });
      },
    });
    const before = await storage.restoreOrCreate();
    const previewed = await storage.submitManeuver(before, draft);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/api/v4/rooms/solo_ovl_web/game/maneuvers/preview");
    assert.equal(requests[0].body.version, 11);
    assert.equal(requests[0].body.maneuverType, type);
    assert.match(requests[0].body.idempotencyKey, /^openovel-maneuver-/);
    for (const [key, value] of Object.entries(expected)) assert.equal(requests[0].body[key], value);
    if (type !== "contact") assert.equal("messageText" in requests[0].body, false);
    if (type !== "custom") assert.equal("customText" in requests[0].body, false);
    assert.equal(previewed.run.version, 11, "preview must not update the run version");
    assert.equal(previewed.v2Projection.currentTurn.id, "T01");
    assert.equal(previewed.messages.filter((item) => item.type === "maneuver_result").length, 0);
    assert.equal(previewed.maneuverPreview.previewToken, token);

    const confirmed = await storage.confirmManeuver(previewed, previewed.maneuverPreview);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].url, "/api/v4/rooms/solo_ovl_web/game/maneuvers/confirm");
    assert.deepEqual(requests[1].body, { previewToken: token });
    assert.equal(confirmed.run.version, 12);
    assert.equal(confirmed.v2Projection.currentTurn.id, "T01", "maneuver must not advance the main OpenNovel turn");
    assert.equal(confirmed.messages.at(-1).type, "maneuver_result");
    assert.equal(confirmed.maneuverPanel[type].enabled, false);
  }
});

test("preview response preserves the authoritative projection and does not invent a result", async () => {
  const current = projection();
  const storage = new ContinuousStoryV2LegacyStorage({
    runId: current.room.id,
    initialProjection: current,
    fetchImpl: async () => json({
      accepted: true,
      previewToken: "signed-preview-token",
      preview: { previewId: "p1", title: "确认", summary: "仅确认输入", confirmLabel: "确认", maneuverType: "custom" },
      gameProjection: current,
    }),
  });
  const before = await storage.restoreOrCreate();
  const after = await storage.submitManeuver(before, { maneuverType: "custom", customText: "核验登记" });
  assert.equal(after.run.version, before.run.version);
  assert.equal(after.messages.length, before.messages.length);
  assert.equal(after.maneuverState.maneuverOpportunitiesRemaining, 2);
});

test("maneuverRequest never invents client-side options", () => {
  const current = projection({
    maneuverPanel: {
      ...projection().maneuverPanel,
      contact: { ...projection().maneuverPanel.contact, enabled: false, disabledReason: "当前没有可交谈人物", options: [] },
    },
  });
  assert.throws(
    () => maneuverRequest(current, { maneuverType: "contact", targetRoleKey: "invented", messageText: "测试" }),
    (error) => error.code === "MANEUVER_WINDOW_CLOSED" && /当前没有可交谈人物/.test(error.message),
  );
});

test("augmentManeuverView keeps consumed leverage removed after refresh", () => {
  const current = projection({
    leverageHand: { availableCount: 0, items: [] },
    maneuverState: { ...projection().maneuverState, usedLeverageKeys: ["county_letter"] },
  });
  const view = augmentManeuverView({ run: {}, player: {} }, current);
  assert.deepEqual(view.player.leverage, []);
  assert.deepEqual(view.player.leverageKeys, []);
  assert.deepEqual(view.maneuverState.usedLeverageKeys, ["county_letter"]);
});
