import assert from "node:assert/strict";
import test from "node:test";
import {
  ContinuousStoryV2LegacyStorage,
  installOpenNovelManeuverStoragePatch,
} from "../public/continuous-story-v2-maneuver-client.js";

installOpenNovelManeuverStoragePatch();

function projection() {
  return {
    schemaVersion: "continuous_game_projection_v2",
    generatedAt: new Date().toISOString(),
    worldSequence: 0,
    room: { id: "solo_ovl_rejection", title: "Story", worldId: "sangtian", status: "playing", mode: "solo" },
    player: { userId: "u1", roleId: "r1", roleKey: "zhejiang_governor", roleName: "Governor", identity: "Governor", personalGoal: "Stabilize" },
    control: { mode: "HUMAN_ACTIVE", epoch: 1, canHumanAct: true },
    currentTurn: {
      id: "T01",
      revision: 0,
      stageIndex: 1,
      turnIndex: 1,
      baseWorldSequence: 0,
      status: "OPEN",
      title: "Decision",
      narrative: "Current scene",
      visibleFacts: [],
      framing: "Choose",
      decisions: [],
      availableTargets: [{ type: "PUBLIC_FRAME", id: "scene:1", label: "Scene" }],
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
    creditControl: { policyVersion: "active_action_v1", meteringMode: "OFF", available: 100, personalAvailable: 100, runAllowanceAvailable: 0, minimumActionCost: 1, standardActionCost: 1, customActionCost: 2, canRequestSponsor: false, sponsorshipRequestStatus: "NONE" },
    completed: false,
    resultUrl: null,
    maneuverVersion: 3,
    maneuverState: { schemaVersion: "openovel_maneuver_state_v1", usageDay: 1, sceneKey: "d1_1", maneuverOpportunitiesPerDay: 2, maneuversUsedToday: 0, maneuverOpportunitiesRemaining: 2, totalManeuversUsed: 0, usedTypesToday: [], usedLeverageKeys: [], discoveredFactKeys: [] },
    maneuverPanel: {
      sceneKey: "d1_1",
      enabled: true,
      disabledReason: null,
      quota: { perDay: 2, usedToday: 0, remaining: 2, usedTypesToday: [] },
      contact: { enabled: false, usedToday: false, count: 0, disabledReason: "none", options: [] },
      investigate: { enabled: false, usedToday: false, count: 0, disabledReason: "none", options: [] },
      leverage: { enabled: false, usedToday: false, count: 0, disabledReason: "none", options: [] },
      custom: { enabled: true, usedToday: false, disabledReason: null, maxLength: 200 },
    },
    leverageHand: { availableCount: 0, items: [] },
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("direct submission rejection remains visible and releases the idempotency key", async () => {
  const current = projection();
  const requests = [];
  const storage = new ContinuousStoryV2LegacyStorage({
    runId: current.room.id,
    initialProjection: current,
    fetchImpl: async (url) => {
      requests.push(String(url));
      return json({
        accepted: false,
        reason: "The context changed before execution.",
        suggestedRewrite: "Choose an available action.",
        gameProjection: current,
      });
    },
  });

  const before = await storage.restoreOrCreate();
  const rejected = await storage.submitManeuver(before, {
    maneuverType: "custom",
    customText: "Verify the route log",
  });

  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, "The context changed before execution.");
  assert.equal(rejected.suggestedRewrite, "Choose an available action.");
  assert.equal(storage.__openNovelManeuverKeys.size, 0);
  assert.equal(rejected.run.version, 3);
  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/game\/maneuvers$/);
});
