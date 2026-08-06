import type { GameProjectionV2, PlayerIntentV2 } from "@ai-story/shared";
import type { GameDefinition } from "@ai-story/templates";
import { gamePageProjection } from "../game-page-projection";
import {
  projectOpenNovelManeuvers,
  type OpenNovelLeverageHandProjection,
  type OpenNovelManeuverPanelProjection,
  type OpenNovelManeuverProjection,
} from "./openovel-maneuver";
import { openNovelManeuverPackages } from "./openovel-maneuver-packages";
import type { OpenNovelPublicRun, OpenNovelVisibleOption } from "./openovel-runtime.client";

export type OpenNovelProjectionRun = {
  id: string;
  title: string;
  templateKey: string;
  status: string;
  ownerUserId: string;
  version: number;
  stateJson: unknown;
  billingPolicyVersion: string;
  billingPriceJson: unknown;
  players: Array<{
    userId: string | null;
    role: null | {
      id: string;
      roleKey: string;
      roleName: string;
      identity: string;
      personalGoal: string;
    };
  }>;
};

export type OpenNovelProjectionNode = {
  id: string;
  nodeIndex: number;
  title: string;
  publicNarration: string;
  resolvedAt: Date | null;
  createdAt: Date;
};

export type OpenNovelGameProjectionV2 = GameProjectionV2 & {
  maneuverVersion: number;
  maneuverState: OpenNovelManeuverProjection["maneuverState"];
  maneuverPanel: OpenNovelManeuverPanelProjection;
  leverageHand: OpenNovelLeverageHandProjection;
};

export function openNovelGameProjection(input: {
  userId: string;
  run: OpenNovelProjectionRun;
  runtimeRun: OpenNovelPublicRun;
  game: GameDefinition;
  nodes: OpenNovelProjectionNode[];
  credits: {
    policyVersion: "world_unlock_v1" | "active_action_v1";
    meteringMode: "OFF" | "SHADOW" | "ENFORCED";
    available: number;
    personalAvailable: number;
    runAllowanceAvailable: number;
    standardActionCost: number;
    customActionCost: number;
  };
}): OpenNovelGameProjectionV2 {
  const membership = input.run.players.find((player) => player.userId === input.userId);
  const role = membership?.role;
  if (!role) throw new Error("OPENOVEL_PRODUCT_ROLE_MISSING");
  if (input.runtimeRun.worldId !== input.run.templateKey) {
    throw new Error("OPENOVEL_MANEUVER_WORLD_MISMATCH");
  }

  const maneuverPackage = openNovelManeuverPackages.require(input.run.templateKey);
  const turnNumber = input.runtimeRun.turnNumber;
  const completed = input.runtimeRun.status === "COMPLETED";
  const canHumanAct = !completed;
  const decisionsOpen = canHumanAct && input.runtimeRun.options.length > 0;
  const maneuverProjection = projectOpenNovelManeuvers({
    stateJson: input.run.stateJson,
    turnNumber,
    runtimeStatus: input.runtimeRun.status,
    mainDecisionOpen: decisionsOpen,
    canHumanAct,
    maneuverPackage,
  });
  const stageIndex = maneuverProjection.state.usageDay;
  const sceneTarget = {
    type: "PUBLIC_FRAME" as const,
    id: `scene:${turnNumber + 1}`,
    label: "当前局势",
  };
  const decisions = input.runtimeRun.options.map((option) => decisionCandidate(option, sceneTarget));
  const availableTargets = uniqueTargets([
    sceneTarget,
    ...maneuverProjection.maneuverPanel.contact.options.map((option) => ({
      type: "ROLE" as const,
      id: option.roleKey,
      label: option.displayName,
    })),
    ...maneuverProjection.maneuverPanel.leverage.options.flatMap((option) =>
      option.targets.map((target) => ({
        type: "ROLE" as const,
        id: target.roleKey,
        label: target.displayName,
      })),
    ),
  ]);
  const nodeTimeline = input.nodes
    .filter((node) => Boolean(node.publicNarration))
    .sort((left, right) => left.nodeIndex - right.nodeIndex)
    .map((node, index) => ({
      id: node.id,
      kind: "RESULT" as const,
      title: node.title || `第 ${index + 1} 回合`,
      content: node.publicNarration,
      worldSequence: index + 1,
      createdAt: (node.resolvedAt || node.createdAt).toISOString(),
      decisionForm: "STORY_CHOICE" as const,
    }));
  const maneuverTimeline = maneuverProjection.state.results.map((result) => ({
    id: result.id,
    kind: "RESULT" as const,
    title: result.title,
    content: result.narrative,
    worldSequence: result.turnNumber,
    createdAt: result.createdAt,
    decisionForm: result.decisionForm,
  }));
  const timeline = [...nodeTimeline, ...maneuverTimeline]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));

  return {
    schemaVersion: "continuous_game_projection_v2",
    generatedAt: new Date().toISOString(),
    worldSequence: turnNumber,
    prologueNarrative: turnNumber === 0 ? input.runtimeRun.prologueNarrative : undefined,
    room: {
      id: input.run.id,
      title: input.run.title,
      worldId: input.run.templateKey,
      status: completed ? "chapter_generated" : "playing",
      mode: "solo",
      ownerUserId: input.run.ownerUserId,
    },
    world: gamePageProjection(input.run.templateKey),
    player: {
      userId: input.userId,
      roleId: role.id,
      roleKey: role.roleKey,
      roleName: role.roleName,
      identity: role.identity,
      personalGoal: role.personalGoal,
    },
    control: { mode: "HUMAN_ACTIVE", epoch: 1, canHumanAct },
    currentTurn: completed ? null : {
      id: `T${String(turnNumber + 1).padStart(2, "0")}`,
      revision: turnNumber,
      stageIndex,
      turnIndex: turnNumber + 1,
      baseWorldSequence: turnNumber,
      status: decisionsOpen ? "OPEN" : "RESOLVING",
      title: turnNumber === 0 ? "两封文书，一道急令" : `第 ${turnNumber + 1} 回合`,
      narrative: input.runtimeRun.recentCanon,
      visibleFacts: [],
      framing: "你要如何应对？",
      decisions,
      availableTargets,
      actionAvailability: actionAvailability(maneuverProjection.maneuverPanel, decisions.length > 0, sceneTarget.id),
      customActionAllowed: true,
    },
    timeline,
    otherActors: input.game.roles
      .filter((candidate) => candidate.roleKey !== role.roleKey)
      .map((candidate) => ({
        roleId: candidate.roleKey,
        roleName: candidate.roleName,
        controllerKind: "AI" as const,
        stageIndex,
      })),
    visibleAssets: maneuverProjection.leverageHand.items.map((item) => ({
      assetKey: item.leverageKey,
      kind: "LEVERAGE",
      label: item.label,
      quantity: 1,
      status: "ACTIVE",
    })),
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
      policyVersion: input.credits.policyVersion,
      meteringMode: input.credits.meteringMode,
      available: input.credits.available,
      personalAvailable: input.credits.personalAvailable,
      runAllowanceAvailable: input.credits.runAllowanceAvailable,
      minimumActionCost: input.credits.standardActionCost,
      standardActionCost: input.credits.standardActionCost,
      customActionCost: input.credits.customActionCost,
      canRequestSponsor: false,
      sponsorshipRequestStatus: "NONE",
    },
    completed,
    resultUrl: completed ? `/game/result?runId=${encodeURIComponent(input.run.id)}` : null,
    maneuverVersion: input.run.version,
    maneuverState: maneuverProjection.maneuverState,
    maneuverPanel: maneuverProjection.maneuverPanel,
    leverageHand: maneuverProjection.leverageHand,
  };
}

function actionAvailability(
  panel: OpenNovelManeuverPanelProjection,
  storyChoiceAvailable: boolean,
  sceneTargetId: string,
) {
  const item = (
    enabled: boolean,
    reason: string | null,
    targetIds: string[] = [],
    assetKeys: string[] = [],
  ) => ({
    state: enabled ? "AVAILABLE" as const : "LOCKED" as const,
    reason: enabled ? "" : reason || "当前不可用",
    targetIds,
    assetKeys,
  });
  return {
    storyChoice: item(storyChoiceAvailable, "当前主线决策尚未开放", [sceneTargetId]),
    conversation: item(
      panel.contact.enabled,
      panel.contact.disabledReason,
      panel.contact.options.map((option) => option.roleKey),
    ),
    investigation: item(
      panel.investigate.enabled,
      panel.investigate.disabledReason,
      panel.investigate.options.map((option) => option.intentKey),
    ),
    leverage: item(
      panel.leverage.enabled,
      panel.leverage.disabledReason,
      panel.leverage.options.flatMap((option) => option.targets.map((target) => target.roleKey)),
      panel.leverage.options.map((option) => option.leverageKey),
    ),
    customPlan: item(panel.custom.enabled, panel.custom.disabledReason, [sceneTargetId]),
  };
}

function uniqueTargets<T extends { type: string; id: string; label: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function decisionCandidate(
  option: OpenNovelVisibleOption,
  target: { type: "PUBLIC_FRAME"; id: string; label: string },
) {
  const intentDraft: PlayerIntentV2 = {
    objective: option.label,
    target,
    method: option.label,
    leverageKeys: [],
    visibility: "PRIVATE",
    riskTolerance: "MEDIUM",
    fallback: null,
    condition: null,
  };
  return {
    id: option.id,
    actionKey: option.id,
    label: option.label,
    description: "",
    intent: option.label,
    targetRoleId: null,
    targetRoleName: null,
    risk: "NORMAL" as const,
    basisFactKeys: [],
    requiredAssetKeys: [],
    authorityBasis: "当前 Story Package 与已结算状态",
    intendedOutcome: option.label,
    concreteCost: "由后续世界状态结算",
    expectedCountermove: "由相关人物依据自身目标作出回应",
    visibility: "PRIVATE" as const,
    effectHooks: [],
    intentDraft,
  };
}
