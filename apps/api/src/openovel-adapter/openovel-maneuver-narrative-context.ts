import type { OpenNovelPublicRun } from "./openovel-runtime.client";
import { projectOpenNovelManeuverKnowledge } from "./openovel-maneuver-context";
import type {
  OpenNovelManeuverPlan,
  OpenNovelManeuverState,
} from "./openovel-maneuver";
import type { OpenNovelManeuverPackage } from "./openovel-maneuver-package";

export type OpenNovelManeuverNarrativeContext = {
  task: "character_response" | "leverage_character_response";
  scene: {
    sceneKey: string;
    whyRelevant: string;
  };
  maneuverType: OpenNovelManeuverPlan["maneuverType"];
  target: null | {
    roleKey: string;
    displayName: string;
    publicIdentity: string;
    publicGoal: string;
    informationStyle: string;
  };
  playerMessage: string;
  leverage: null | {
    leverageKey: string;
    label: string;
    description: string;
  };
  visibleFacts: Array<{
    factKey: string;
    content: string;
  }>;
  immutableRuleResult: {
    statePatchKeys: string[];
    factKeys: string[];
    traces: string[];
  };
};

export function buildOpenNovelManeuverNarrativeContext(input: {
  plan: OpenNovelManeuverPlan;
  state: OpenNovelManeuverState;
  runtimeRun: OpenNovelPublicRun;
  maneuverPackage: OpenNovelManeuverPackage;
}) {
  const target = input.plan.targetRoleKey
    ? input.maneuverPackage.actor(input.plan.targetRoleKey)
    : null;
  const leverage = input.plan.consumedLeverageKey
    ? input.maneuverPackage.leverage(input.plan.consumedLeverageKey)
    : null;
  const scene = input.maneuverPackage.scene(input.plan.sceneKey);
  const contact = input.plan.maneuverType === "contact" && input.plan.targetRoleKey
    ? scene?.contacts.find((item) => item.roleKey === input.plan.targetRoleKey) || null
    : null;
  const allowedFactKeys = new Set(contact?.allowedFactKeys || []);
  const knowledge = projectOpenNovelManeuverKnowledge(input.state);
  const visibleFacts = knowledge.visibleFacts
    .filter((fact) => allowedFactKeys.has(fact.factKey))
    .map((fact) => ({ factKey: fact.factKey, content: fact.content }));

  const context: OpenNovelManeuverNarrativeContext = {
    task: input.plan.maneuverType === "contact"
      ? "character_response"
      : "leverage_character_response",
    scene: {
      sceneKey: input.plan.sceneKey,
      whyRelevant: contact?.relevance || "",
    },
    maneuverType: input.plan.maneuverType,
    target: target ? {
      roleKey: target.roleKey,
      displayName: target.displayName,
      publicIdentity: target.publicIdentity,
      publicGoal: target.publicGoal,
      informationStyle: target.informationStyle,
    } : null,
    playerMessage: input.plan.maneuverType === "contact"
      ? input.plan.playerMessage
      : "",
    leverage: leverage ? {
      leverageKey: leverage.leverageKey,
      label: leverage.label,
      description: leverage.description,
    } : null,
    visibleFacts,
    immutableRuleResult: {
      statePatchKeys: Object.keys(input.plan.statePatch),
      factKeys: [...input.plan.factKeys],
      traces: [...input.plan.traces],
    },
  };

  return {
    context,
    targetName: target?.displayName || "对方",
    leverageLabel: leverage?.label || "",
  };
}
