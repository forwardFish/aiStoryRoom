import assert from "node:assert/strict";
import test from "node:test";
import {
  ContinuousStoryV2LegacyStorage,
  installOpenNovelManeuverStoragePatch,
} from "../public/continuous-story-v2-maneuver-client.js";

installOpenNovelManeuverStoragePatch();

function projection() {
  const panel = {
    sceneKey: "d1_1",
    enabled: true,
    disabledReason: null,
    quota: { perDay: 2, usedToday: 0, remaining: 2, usedTypesToday: [] },
    contact: {
      enabled: true,
      usedToday: false,
      count: 1,
      disabledReason: null,
      options: [{
        roleKey: "county_magistrate",
        displayName: "卢象升",
        publicIdentity: "清流县令",
        relevance: "掌管原册",
      }],
    },
    investigate: { enabled: false, usedToday: false, count: 0, disabledReason: "当前没有可调查事项", options: [] },
    leverage: { enabled: false, usedToday: false, count: 0, disabledReason: "当前剧情没有合适的出牌时机", options: [] },
    custom: { enabled: true, usedToday: false, disabledReason: null, maxLength: 200 },
  };
  return {
    schemaVersion: "continuous_game_projection_v2",
    generatedAt: "2026-08-07T00:00:00.000Z",
    worldSequence: 0,
    room: { id: "solo_ovl_preview_no_projection", title: "桑田诏", worldId: "sangtian", status: "playing", mode: "solo" },
    player: { userId: "u1", roleId: "r1", roleKey: "zhejiang_governor", roleName: "浙江总督", identity: "浙江总督", personalGoal: "稳住浙江" },
    control: { mode: "HUMAN_ACTIVE", epoch: 1, canHumanAct: true },
    currentTurn: {
      id: "T01",
      revision: 0,
      stageIndex: 1,
      turnIndex: 1,
      baseWorldSequence: 0,
      status: "OPEN",
      title: "两封文书，一道急令",
      narrative: "正文已经完成加载。",
      visibleFacts: [],
      framing: "你要如何应对？",
      decisions: [{
        id: "G00_A",
        label: "先封档房",
        description: "",
        intentDraft: {
          objective: "先封档房",
          target: { type: "PUBLIC_FRAME", id: "scene:1", label: "当前局势" },
          method: "先封档房",
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
    access: { state: "UNLOCKED", requiresUnlock: false, requiredCredits: 0, canCurrentUserUnlock: false, unlockEndpoint: null },
    creditControl: { policyVersion: "active_action_v1", meteringMode: "SHADOW", available: 100, personalAvailable: 100, runAllowanceAvailable: 0, minimumActionCost: 1, standardActionCost: 1, customActionCost: 2, canRequestSponsor: false, sponsorshipRequestStatus: "NONE" },
    completed: false,
    resultUrl: null,
    maneuverVersion: 11,
    maneuverState: { schemaVersion: "openovel_maneuver_state_v1", usageDay: 1, sceneKey: "d1_1", maneuverOpportunitiesPerDay: 2, maneuversUsedToday: 0, maneuverOpportunitiesRemaining: 2, totalManeuversUsed: 0, usedTypesToday: [], usedLeverageKeys: [], discoveredFactKeys: [] },
    maneuverPanel: panel,
    leverageHand: { availableCount: 3, items: [] },
  };
}

function json(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("direct maneuver submission rejects a response without an authoritative gameProjection", async () => {
  const current = projection();
  const requests = [];
  const storage = new ContinuousStoryV2LegacyStorage({
    runId: current.room.id,
    initialProjection: current,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body || "{}")) });
      return json({ accepted: true, resolution: { kind: "contact" } });
    },
  });

  const before = await storage.restoreOrCreate();
  await assert.rejects(
    storage.submitManeuver(before, {
      maneuverType: "contact",
      targetRoleKey: "county_magistrate",
      messageText: "原册是否完整？",
    }),
    (error) => error?.code === "MANEUVER_PROJECTION_INVALID",
  );

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/game\/maneuvers$/);
  assert.equal(requests[0].url.includes("/preview"), false);
  assert.equal(requests[0].url.includes("/confirm"), false);
});
