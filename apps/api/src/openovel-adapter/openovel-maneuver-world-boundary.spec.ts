import assert from "node:assert/strict";
import test from "node:test";
import { getGameDefinition, type StageDefinition } from "@ai-story/templates";
import { guardPlayerIntentV2 } from "../continuous-story-v2/player-intent";
import { compileGuardStages } from "./openovel-maneuver-guard-stages";
import { defineOpenNovelManeuverPackage } from "./openovel-maneuver-package";
import { sangtianOpenNovelManeuverPackage } from "./sangtian-openovel-maneuver.package";

const neutralPackage = defineOpenNovelManeuverPackage({
  packageVersion: "openovel_maneuver_package_v1",
  worldId: "neutral_technology_fixture",
  calendar: {
    expectedTurns: 1,
    turns: [{ sceneKey: "phase_alpha", usageDay: 1 }],
    scenes: [{ sceneKey: "phase_alpha", usageDay: 1 }],
  },
  quota: { opportunitiesPerDay: 2 },
  initialLeverageKeys: [],
  customPlan: {
    maxLength: 200,
    title: "Plan recorded",
    statePatch: {},
    factKeys: [],
    traces: [],
    fallbackNarrative: (text) => text,
  },
  scene(sceneKey) {
    return sceneKey === "phase_alpha" ? {
      sceneKey,
      contacts: [],
      investigations: [],
      playableLeverageKeys: [],
      customEnabled: true,
    } : null;
  },
  actor() { return null; },
  leverage() { return null; },
  surfaces: {
    contactFallback: () => "",
    contactTrace: () => "",
    leverageFallback: ({ response }) => response,
    leverageTrace: () => "",
    consumedLeverageLabel: "Consumed leverage",
  },
});

const game = getGameDefinition("sangtian");
const neutralStage = compileGuardStages(game, neutralPackage)[0];
const historicalStage = compileGuardStages(game, sangtianOpenNovelManeuverPackage)[0];

const intent = {
  objective: "核对电子记录",
  target: { type: "PUBLIC_FRAME" as const, id: "current-frame", label: "当前局势" },
  method: "使用电脑核对日志并保存回执",
  leverageKeys: [],
  visibility: "PRIVATE" as const,
  riskTolerance: "MEDIUM" as const,
  fallback: null,
  condition: null,
};

function context(stage: StageDefinition) {
  return {
    role: {
      id: "operator",
      roleKey: "operator",
      roleName: "Operator",
      identity: "Operations lead",
      publicInfo: "Coordinates the response",
      hiddenSecret: null,
      personalGoal: "Verify the record",
      currentState: "Active",
      abilityText: "Use available tools",
      cannotDo: [],
    },
    allRoles: [{ id: "operator", roleKey: "operator", roleName: "Operator" }],
    visibleFacts: [],
    allFacts: [],
    assets: [],
    stage,
  };
}

test("a neutral OpenNovel world does not inherit the legacy JiaJing technology boundary", () => {
  const result = guardPlayerIntentV2(intent, context(neutralStage));
  assert.equal(result.decision, "ACCEPT");
  assert.equal(
    (neutralStage as StageDefinition & { technologyBoundary?: unknown }).technologyBoundary,
    null,
  );
});

test("Sangtian technology restrictions are supplied by its world package", () => {
  const result = guardPlayerIntentV2(intent, context(historicalStage));
  assert.equal(result.decision, "REJECT_OUT_OF_WORLD");
  assert.match(result.reason, /嘉靖时代/);
  assert.match(result.suggestedRewrite?.method || "", /驿递|公文|耳目|当面查验/);
  assert.ok(
    (historicalStage as StageDefinition & { technologyBoundary?: unknown }).technologyBoundary,
  );
});
