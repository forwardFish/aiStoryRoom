import {
  getLeverageDefinition,
  getManeuverActor,
  getManeuverSceneConfig,
  INITIAL_MVP_LEVERAGE_KEYS,
} from "../mvp-maneuver-config";
import {
  defineOpenNovelManeuverPackage,
  type OpenNovelContactDefinition,
  type OpenNovelLeverageDefinition,
  type OpenNovelManeuverActorDefinition,
} from "./openovel-maneuver-package";

const SANGTIAN_SCENE_KEYS = [
  "d1_1", "d1_2",
  "d2_1", "d2_2",
  "d3_1", "d3_2",
  "d4_1", "d4_2",
  "d5_1", "d5_2",
  "d6_1", "d6_2",
] as const;

export const sangtianOpenNovelManeuverPackage = defineOpenNovelManeuverPackage({
  packageVersion: "openovel_maneuver_package_v1",
  worldId: "sangtian",
  calendar: {
    expectedTurns: 20,
    scenes: SANGTIAN_SCENE_KEYS.map((sceneKey, index) => ({
      sceneKey,
      usageDay: Math.floor(index / 2) + 1,
    })),
  },
  quota: { opportunitiesPerDay: 2 },
  initialLeverageKeys: [...INITIAL_MVP_LEVERAGE_KEYS],
  customPlan: {
    maxLength: 200,
    title: "自拟谋划已执行",
    statePatch: { "总督权威": 2, "暗账完整度": 4, "清算风险": 1 },
    factKeys: [],
    traces: ["自拟谋划原文", "幕僚执行回执"],
    fallbackNarrative(customText) {
      return `你拟定的布局“${customText}”被拆成一项当前可执行的幕僚任务。它没有替代主线决策，但会成为后续剧情可引用的行动记录。`;
    },
  },
  scene(sceneKey) {
    return getManeuverSceneConfig(sceneKey);
  },
  actor(roleKey) {
    return getManeuverActor(roleKey);
  },
  leverage(leverageKey) {
    return getLeverageDefinition(leverageKey);
  },
  surfaces: {
    contactFallback(definition: OpenNovelContactDefinition) {
      return `你向${definition.displayName}说明了来意。\n\n${definition.displayName}回道：“${definition.fallbackReply}”`;
    },
    contactTrace(definition: OpenNovelContactDefinition) {
      return `${definition.displayName}交谈记录`;
    },
    leverageFallback(input: {
      definition: OpenNovelLeverageDefinition;
      target: OpenNovelManeuverActorDefinition | null;
      response: string;
    }) {
      const body = input.target
        ? `你向${input.target.displayName}打出了“${input.definition.label}”。\n\n${input.target.displayName}回应：“${input.response}”`
        : input.response;
      return `${body}\n\n筹码已消耗：${input.definition.label}`;
    },
    leverageTrace(definition: OpenNovelLeverageDefinition) {
      return `筹码使用记录：${definition.label}`;
    },
    consumedLeverageLabel: "筹码已消耗",
  },
});
