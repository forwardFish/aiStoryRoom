import type { ActorTurnActionAvailabilityV2, DecisionCandidateV2 } from "@ai-story/shared";
import type { SoloAvailableTarget } from "./runtime-mapper";
import type { RawPlayerAction } from "./types";

export type SoloActionAffordances = {
  conversationTargetIds: string[];
  investigationTargetIds: string[];
  leverageAssetKeys: string[];
  customPlanPressureIds: string[];
};

type AvailabilityInput = {
  turnStatus: "OPEN" | "RESOLVING" | "RESOLVED" | "COMPLETED";
  canHumanAct: boolean;
  completed: boolean;
  storyPublished: boolean;
  decisions: DecisionCandidateV2[];
  availableTargets: SoloAvailableTarget[];
  activeAssetKeys: string[];
  affordances: SoloActionAffordances;
  storyChoiceOnly?: boolean;
};

export function buildActionAvailability(input: AvailabilityInput): ActorTurnActionAvailabilityV2 {
  const globalReason = globalLockReason(input);
  const authoredChoiceReason = input.storyChoiceOnly
    ? "《桑田诏》第一部分当前只开放经过剧情资产与因果规则审核的两项主决策。"
    : null;
  const existingTargetIds = new Set(input.availableTargets.map((target) => target.id));
  const conversationTargetIds = input.affordances.conversationTargetIds.filter((id) => existingTargetIds.has(id));
  const investigationTargetIds = input.affordances.investigationTargetIds.filter((id) => existingTargetIds.has(id));
  const heldAssetKeys = new Set(input.activeAssetKeys);
  const leverageAssetKeys = input.affordances.leverageAssetKeys.filter((key) => heldAssetKeys.has(key));

  return {
    storyChoice: globalReason
      ? locked(globalReason)
      : input.decisions.length
        ? available("当前剧情已经发布，可以选择其中一项真实决策。")
        : locked("当前剧情尚未形成可提交的主决策。"),
    conversation: globalReason
      ? locked(globalReason)
      : authoredChoiceReason
        ? locked(authoredChoiceReason)
      : conversationTargetIds.length
        ? available("当前剧情中有浙江总督能够联系、且与眼前矛盾有关的人物。", conversationTargetIds)
        : locked("当前剧情中没有浙江总督能够联系且与此事有关的人物。"),
    investigation: globalReason
      ? locked(globalReason)
      : authoredChoiceReason
        ? locked(authoredChoiceReason)
      : investigationTargetIds.length
        ? available("当前剧情中存在可核查的文书、地点、证据或矛盾线索。", investigationTargetIds)
        : locked("当前剧情尚未出现可核查的文书、地点、证人、账目或矛盾线索。"),
    leverage: globalReason
      ? locked(globalReason)
      : authoredChoiceReason
        ? locked(authoredChoiceReason)
      : leverageAssetKeys.length
        ? available("你持有能够作用于当前局势、且尚未消耗的真实筹码。", [], leverageAssetKeys)
        : locked("你当前没有与眼前局势相关、且尚未消耗的真实筹码。"),
    customPlan: globalReason
      ? locked(globalReason)
      : authoredChoiceReason
        ? locked(authoredChoiceReason)
      : input.affordances.customPlanPressureIds.length
        ? available("当前仍有未解决的压力，浙江总督可以提出一项符合身份与时代条件的具体行动。")
        : locked("当前没有尚待处理、且允许浙江总督自行采取行动的问题。")
  };
}

export function rawActionLockReason(
  raw: RawPlayerAction,
  availability: ActorTurnActionAvailabilityV2
): string | null {
  const item = raw.source === "RECOMMENDED"
    ? availability.storyChoice
    : raw.source === "TALK"
      ? availability.conversation
      : raw.source === "INVESTIGATE"
        ? availability.investigation
        : raw.source === "USE_LEVERAGE"
          ? availability.leverage
          : availability.customPlan;
  if (item.state !== "AVAILABLE") return item.reason;
  if (raw.source === "TALK" && !item.targetIds.includes(raw.personId)) return "这个人物不在当前剧情允许联系的范围内。";
  if (raw.source === "INVESTIGATE" && !item.targetIds.includes(raw.locationId)) return "这个调查对象不在当前剧情已经出现的线索范围内。";
  if (raw.source === "USE_LEVERAGE" && !item.assetKeys.includes(raw.leverageKey)) return "这项筹码当前并未持有、已经消耗，或与眼前局势无关。";
  return null;
}

function globalLockReason(input: AvailabilityInput): string | null {
  if (input.completed || input.turnStatus === "COMPLETED") return "这条故事已经结束。";
  if (!input.canHumanAct) return "你当前没有控制浙江总督。";
  if (!input.storyPublished) return "当前剧情尚未完整发布。";
  if (input.turnStatus === "RESOLVING") return "上一项行动正在推演，本回合不能再提交其他行动。";
  if (input.turnStatus !== "OPEN") return "当前回合尚未开放新的行动。";
  return null;
}

function available(reason: string, targetIds: string[] = [], assetKeys: string[] = []) {
  return { state: "AVAILABLE" as const, reason, targetIds, assetKeys };
}

function locked(reason: string) {
  return { state: "LOCKED" as const, reason, targetIds: [], assetKeys: [] };
}
