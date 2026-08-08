import assert from "node:assert/strict";
import test from "node:test";
import { ContinuousStoryV2LegacyStorage } from "../public/continuous-story-v2-legacy-storage.js";

test("a fresh Solo run presents the authored prologue before the first actionable scene", async () => {
  const projection = {
    schemaVersion: "continuous_game_projection_v2",
    generatedAt: new Date().toISOString(),
    worldSequence: 0,
    prologueNarrative: "这是玩家已经确认的完整开场白。",
    room: { id: "fresh-run", title: "桑田诏", worldId: "sangtian", status: "playing", mode: "solo" },
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
      narrative: "杭州总督府内厅，两封文书同时压到了案前。",
      visibleFacts: [],
      framing: "你要如何应对？",
      decisions: [],
      availableTargets: [],
      customActionAllowed: true
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
    completed: false,
    resultUrl: null
  };
  const storage = new ContinuousStoryV2LegacyStorage({
    runId: projection.room.id,
    initialProjection: projection,
    fetchImpl: async () => new Response(JSON.stringify(projection), { status: 200, headers: { "content-type": "application/json" } })
  });

  const view = await storage.restoreOrCreate();
  const prologueIndex = view.openingNarrative.indexOf("完整开场白");
  const sceneIndex = view.openingNarrative.indexOf("杭州总督府内厅");

  assert.ok(prologueIndex >= 0);
  assert.ok(sceneIndex > prologueIndex);
});
