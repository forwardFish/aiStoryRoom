import assert from "node:assert/strict";
import test from "node:test";
import { getGameDefinition } from "@ai-story/templates";
import { validateGameProjectionV2 } from "@ai-story/shared";
import { openNovelGameProjection } from "./openovel-game-projection";

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "solo_ovl_test",
    title: "桑田诏",
    templateKey: "sangtian",
    status: "playing",
    ownerUserId: "user-1",
    version: 7,
    stateJson: {},
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
    ...overrides,
  };
}

function runtime(overrides: Record<string, unknown> = {}) {
  return {
    runId: "solo_ovl_test",
    worldId: "sangtian",
    roleId: "zhejiang_governor",
    runtimeMode: "OPENOVEL_V1" as const,
    turnNumber: 0,
    status: "READY",
    canon: "开场正文",
    recentCanon: "开场正文",
    prologueNarrative: "完整开场白",
    options: [{ id: "G00_B", label: "先封档房，再暂缓签发" }],
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const credits = {
  policyVersion: "active_action_v1" as const,
  meteringMode: "SHADOW" as const,
  available: 100,
  personalAvailable: 100,
  runAllowanceAvailable: 0,
  standardActionCost: 1,
  customActionCost: 2,
};

test("OpenNovel product projection exposes authoritative four-maneuver state without leaking option effects", () => {
  const projection = openNovelGameProjection({
    userId: "user-1",
    run: run(),
    runtimeRun: runtime(),
    game: getGameDefinition("sangtian"),
    nodes: [],
    credits,
  });

  assert.equal(projection.schemaVersion, "continuous_game_projection_v2");
  assert.equal(projection.currentTurn?.id, "T01");
  assert.equal(projection.currentTurn?.decisions[0]?.id, "G00_B");
  assert.equal(projection.currentTurn?.decisions[0]?.label, "先封档房，再暂缓签发");
  assert.equal(projection.currentTurn?.decisions[0]?.description, "");
  assert.equal(projection.prologueNarrative, "完整开场白");
  assert.equal(projection.currentTurn?.narrative, "开场正文");
  assert.equal(projection.maneuverVersion, 7);
  assert.equal(projection.maneuverPanel.sceneKey, "d1_1");
  assert.equal(projection.maneuverPanel.contact.enabled, true);
  assert.equal(projection.maneuverPanel.investigate.enabled, true);
  assert.equal(projection.maneuverPanel.custom.enabled, true);
  assert.equal(projection.maneuverPanel.leverage.enabled, false);
  assert.equal(projection.maneuverState.maneuverOpportunitiesRemaining, 2);
  assert.equal(projection.leverageHand.availableCount, 3);
  assert.equal(projection.currentTurn?.actionAvailability?.conversation.state, "AVAILABLE");
  assert.equal(validateGameProjectionV2(projection).ok, true);
});

test("persisted OpenNovel maneuver results enter the same player-visible timeline", () => {
  const createdAt = new Date("2026-08-06T12:00:00.000Z").toISOString();
  const projection = openNovelGameProjection({
    userId: "user-1",
    run: run({
      version: 8,
      stateJson: {
        openovelManeuver: {
          schemaVersion: "openovel_maneuver_state_v1",
          usageDay: 1,
          sceneKey: "d1_1",
          maneuverOpportunitiesPerDay: 2,
          maneuversUsedToday: 1,
          maneuverOpportunitiesRemaining: 1,
          totalManeuversUsed: 1,
          usedTypesToday: ["contact"],
          usedLeverageKeys: [],
          discoveredFactKeys: [],
          metrics: {},
          results: [{
            id: "maneuver-event-1",
            turnNumber: 0,
            usageDay: 1,
            sceneKey: "d1_1",
            maneuverType: "contact",
            decisionForm: "CONVERSATION",
            title: "卢象升作出回应",
            narrative: "卢象升给出了谨慎回应。",
            targetRoleKey: "county_magistrate",
            consumedLeverageKey: null,
            discoveredFactKeys: [],
            traces: ["卢象升交谈记录"],
            statePatch: {},
            idempotencyKey: "contact-test-key",
            requestFingerprint: "fingerprint",
            createdAt,
          }],
        },
      },
    }),
    runtimeRun: runtime(),
    game: getGameDefinition("sangtian"),
    nodes: [],
    credits,
  });

  const entry = projection.timeline.find((item) => item.id === "maneuver-event-1");
  assert.ok(entry);
  assert.equal(entry.kind, "RESULT");
  assert.equal(entry.decisionForm, "CONVERSATION");
  assert.equal(entry.content, "卢象升给出了谨慎回应。");
  assert.equal(projection.maneuverPanel.contact.enabled, false);
  assert.equal(projection.maneuverPanel.investigate.enabled, true);
  assert.equal(projection.maneuverPanel.quota.remaining, 1);
});
