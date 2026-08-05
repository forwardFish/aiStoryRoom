import type { GameProjectionV2, ManeuverRulesProjectionV1, PlayerIntentV2, StoryTimelineEntryV2 } from "@ai-story/shared";
import type { GameDefinition } from "@ai-story/templates";
import { gamePageProjection } from "../game-page-projection";
import type { OpenNovelPublicRun, OpenNovelVisibleOption } from "./openovel-runtime.client";

export type OpenNovelProjectionRun = {
  id: string;
  title: string;
  templateKey: string;
  status: string;
  ownerUserId: string;
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

export function openNovelGameProjection(input: {
  userId: string;
  run: OpenNovelProjectionRun;
  runtimeRun: OpenNovelPublicRun;
  game: GameDefinition;
  nodes: OpenNovelProjectionNode[];
  maneuverRulesV1?: ManeuverRulesProjectionV1;
  maneuverTimeline?: StoryTimelineEntryV2[];
  credits: {
    policyVersion: "world_unlock_v1" | "active_action_v1";
    meteringMode: "OFF" | "SHADOW" | "ENFORCED";
    available: number;
    personalAvailable: number;
    runAllowanceAvailable: number;
    standardActionCost: number;
    customActionCost: number;
  };
}): GameProjectionV2 {
  const membership = input.run.players.find((player) => player.userId === input.userId);
  const role = membership?.role;
  if (!role) throw new Error("OPENOVEL_PRODUCT_ROLE_MISSING");

  const turnNumber = input.runtimeRun.turnNumber;
  const completed = input.runtimeRun.status === "COMPLETED";
  const stageIndex = Math.min(4, Math.floor(turnNumber / 5) + 1);
  const sceneTarget = {
    type: "PUBLIC_FRAME" as const,
    id: `scene:${turnNumber + 1}`,
    label: "当前局势",
  };
  const decisions = input.runtimeRun.options.map((option) => decisionCandidate(option, sceneTarget));
  const mainTimeline: StoryTimelineEntryV2[] = input.nodes
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
  const timeline = [...mainTimeline, ...(input.maneuverTimeline || [])]
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
    control: { mode: "HUMAN_ACTIVE", epoch: 1, canHumanAct: !completed },
    currentTurn: completed ? null : {
      id: `T${String(turnNumber + 1).padStart(2, "0")}`,
      revision: turnNumber,
      stageIndex,
      turnIndex: turnNumber + 1,
      baseWorldSequence: turnNumber,
      status: "OPEN",
      title: turnNumber === 0 ? "两封文书，一道急令" : `第 ${turnNumber + 1} 回合`,
      narrative: input.runtimeRun.recentCanon,
      visibleFacts: [],
      framing: "你要如何应对？",
      decisions,
      availableTargets: [sceneTarget],
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
    visibleAssets: [],
    evidenceHoldings: [],
    commitments: [],
    armedConditions: [],
    pendingInteractions: [],
    observableTraces: [],
    ...(input.maneuverRulesV1 ? { capabilities: { maneuverRulesV1: input.maneuverRulesV1 } } : {}),
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
  };
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
