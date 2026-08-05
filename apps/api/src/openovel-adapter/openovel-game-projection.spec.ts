import assert from "node:assert/strict";
import test from "node:test";
import { getGameDefinition } from "@ai-story/templates";
import { validateGameProjectionV2 } from "@ai-story/shared";
import { openNovelGameProjection } from "./openovel-game-projection";

test("OpenNovel product projection uses the existing main-game schema without leaking option effects", () => {
  const projection = openNovelGameProjection({
    userId: "user-1",
    run: {
      id: "solo_ovl_test",
      title: "桑田诏",
      templateKey: "sangtian",
      status: "playing",
      ownerUserId: "user-1",
      billingPolicyVersion: "active_action_v1",
      billingPriceJson: {},
      players: [{
        userId: "user-1",
        role: {
          id: "role-governor",
          roleKey: "zhejiang_governor",
          roleName: "浙江总督",
          identity: "浙江总督",
          personalGoal: "稳住浙江",
        },
      }],
    },
    runtimeRun: {
      runId: "solo_ovl_test",
      worldId: "sangtian",
      roleId: "zhejiang_governor",
      runtimeMode: "OPENOVEL_V1",
      turnNumber: 0,
      status: "READY",
      canon: "开场正文",
      recentCanon: "开场正文",
      prologueNarrative: "完整开场白",
      options: [{ id: "G00_B", label: "先封档房，再暂缓签发" }],
      updatedAt: new Date().toISOString(),
    },
    game: getGameDefinition("sangtian"),
    nodes: [],
    credits: {
      policyVersion: "active_action_v1",
      meteringMode: "SHADOW",
      available: 100,
      personalAvailable: 100,
      runAllowanceAvailable: 0,
      standardActionCost: 1,
      customActionCost: 2,
    },
  });

  assert.equal(projection.schemaVersion, "continuous_game_projection_v2");
  assert.equal(projection.currentTurn?.id, "T01");
  assert.equal(projection.currentTurn?.decisions[0]?.id, "G00_B");
  assert.equal(projection.currentTurn?.decisions[0]?.label, "先封档房，再暂缓签发");
  assert.equal(projection.currentTurn?.decisions[0]?.description, "");
  assert.equal(projection.prologueNarrative, "完整开场白");
  assert.equal(projection.currentTurn?.narrative, "开场正文");
  assert.equal(validateGameProjectionV2(projection).ok, true);
});
