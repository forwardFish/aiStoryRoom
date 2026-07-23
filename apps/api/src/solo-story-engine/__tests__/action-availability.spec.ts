import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionCandidateV2 } from "@ai-story/shared";
import { buildActionAvailability, rawActionLockReason } from "../action-availability";

const decisions: DecisionCandidateV2[] = [
  {
    id: "decision-1",
    actionKey: null,
    label: "先封存往来文书，再当面询问巡抚",
    description: "先固定文书和口供，代价是巡抚会立即知道你在核查他。",
    intent: "查清消息递送经过",
    targetRoleId: "role-xunfu",
    targetRoleName: "浙江巡抚",
    risk: "NORMAL",
    basisFactKeys: ["fact-document-conflict"],
    requiredAssetKeys: [],
    authorityBasis: "浙江总督有权封存本署公文并召见属官",
    intendedOutcome: "固定递送时间和经手人口供",
    concreteCost: "暂缓发出一道催办公文",
    expectedCountermove: "巡抚可能解释、推诿或要求先看封存清单",
    visibility: "LIMITED",
    effectHooks: ["freeze-document-chain"],
    intentDraft: {
      objective: "查清消息递送经过",
      target: { type: "ROLE", id: "role-xunfu", label: "浙江巡抚" },
      method: "命书吏封存今日公文，并请巡抚留下说明递送经过。",
      leverageKeys: [],
      visibility: "LIMITED",
      riskTolerance: "MEDIUM",
      fallback: null,
      condition: null
    }
  }
];

const baseInput = {
  turnStatus: "OPEN" as const,
  canHumanAct: true,
  completed: false,
  storyPublished: true,
  decisions,
  availableTargets: [
    { id: "role-xunfu", type: "ROLE" as const, label: "浙江巡抚" },
    { id: "card-county-register", type: "EVIDENCE" as const, label: "清流县田契册" }
  ],
  activeAssetKeys: ["governor_archive_order"],
  affordances: {
    conversationTargetIds: ["role-xunfu"],
    investigationTargetIds: ["card-county-register"],
    leverageAssetKeys: ["governor_archive_order"],
    customPlanPressureIds: ["pressure-three-day-deadline"]
  }
};

test("已发布且处于 OPEN 的真实局势按当前人物、线索、筹码和压力开放四种行动", () => {
  const result = buildActionAvailability(baseInput);

  assert.equal(result.storyChoice.state, "AVAILABLE");
  assert.deepEqual(result.conversation.targetIds, ["role-xunfu"]);
  assert.deepEqual(result.investigation.targetIds, ["card-county-register"]);
  assert.deepEqual(result.leverage.assetKeys, ["governor_archive_order"]);
  assert.equal(result.customPlan.state, "AVAILABLE");
});

test("上一项行动正在推演时，主决策和四种行动同时关闭并给出原因", () => {
  const result = buildActionAvailability({ ...baseInput, turnStatus: "RESOLVING" });

  for (const item of Object.values(result)) {
    assert.equal(item.state, "LOCKED");
    assert.match(item.reason, /上一项行动正在推演/);
  }
});

test("剧情中没有对应对象时只关闭相应行动，不伪造人物、线索或筹码", () => {
  const result = buildActionAvailability({
    ...baseInput,
    availableTargets: [],
    activeAssetKeys: [],
    affordances: {
      conversationTargetIds: ["role-xunfu"],
      investigationTargetIds: ["card-county-register"],
      leverageAssetKeys: ["governor_archive_order"],
      customPlanPressureIds: []
    }
  });

  assert.equal(result.storyChoice.state, "AVAILABLE");
  assert.equal(result.conversation.state, "LOCKED");
  assert.equal(result.investigation.state, "LOCKED");
  assert.equal(result.leverage.state, "LOCKED");
  assert.equal(result.customPlan.state, "LOCKED");
});

test("服务端拒绝提交投影未开放的人物、调查对象和筹码", () => {
  const availability = buildActionAvailability(baseInput);

  assert.match(rawActionLockReason({
    source: "TALK",
    personId: "unknown-role",
    personName: "陌生人",
    prompt: "询问此事"
  }, availability) ?? "", /不在当前剧情允许联系/);

  assert.match(rawActionLockReason({
    source: "INVESTIGATE",
    locationId: "unknown-place",
    locationName: "未知地点",
    task: "前去调查"
  }, availability) ?? "", /不在当前剧情已经出现/);

  assert.match(rawActionLockReason({
    source: "USE_LEVERAGE",
    leverageKey: "invented-asset",
    leverageLabel: "虚构筹码",
    targetId: "public-frame",
    targetLabel: "当前局势",
    task: "使用筹码"
  }, availability) ?? "", /并未持有/);
});

test("服务端接受投影明确开放的四种行动", () => {
  const availability = buildActionAvailability(baseInput);

  assert.equal(rawActionLockReason({ source: "TALK", personId: "role-xunfu", personName: "浙江巡抚", prompt: "请他说明文书递送经过" }, availability), null);
  assert.equal(rawActionLockReason({ source: "INVESTIGATE", locationId: "card-county-register", locationName: "清流县田契册", task: "核对原件和经手人" }, availability), null);
  assert.equal(rawActionLockReason({ source: "USE_LEVERAGE", leverageKey: "governor_archive_order", leverageLabel: "总督封存令", targetId: "public-frame", targetLabel: "当前局势", task: "凭令封存文书" }, availability), null);
  assert.equal(rawActionLockReason({ source: "CUSTOM", text: "分开询问两名经手书吏并核对签押时间" }, availability), null);
});

test("《桑田诏》第一部分只开放审核过的两项主决策，不让自由行动绕过因果资产", () => {
  const availability = buildActionAvailability({ ...baseInput, storyChoiceOnly: true });

  assert.equal(availability.storyChoice.state, "AVAILABLE");
  for (const item of [availability.conversation, availability.investigation, availability.leverage, availability.customPlan]) {
    assert.equal(item.state, "LOCKED");
    assert.match(item.reason, /只开放经过剧情资产与因果规则审核的两项主决策/);
  }
  assert.match(rawActionLockReason({ source: "CUSTOM", text: "自行另定一策" }, availability) ?? "", /只开放/);
});
