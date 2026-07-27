import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionFormV2, PlayerIntentV2, TurnDecisionCommandV2 } from "@ai-story/shared";
import { normalizePlayerIntent } from "../player-intent";
import { commandToRawPlayerAction } from "../runtime-mapper";

function command(
  decisionForm: DecisionFormV2,
  intent: PlayerIntentV2,
  customAction: string
): TurnDecisionCommandV2 {
  return {
    idempotencyKey: `test-${decisionForm.toLowerCase()}`,
    turnRevision: 4,
    controlEpoch: 2,
    decisionForm,
    customAction,
    intent
  };
}

const baseIntent = {
  leverageKeys: [],
  visibility: "LIMITED" as const,
  riskTolerance: "MEDIUM" as const,
  fallback: null,
  condition: null
};

test("人物交谈保留玩家选择的人物和亲自填写的谈话内容", () => {
  const raw = commandToRawPlayerAction(command("CONVERSATION", {
    ...baseIntent,
    objective: "问清巡抚从何处得知田契副本已经封存",
    target: { type: "ROLE", id: "xunfu", label: "浙江巡抚" },
    method: "单独召见巡抚，让他说明消息由谁、在什么时辰送到。"
  }, "单独召见巡抚，让他说明消息由谁、在什么时辰送到。"), []);

  assert.deepEqual(raw, {
    source: "TALK",
    personId: "xunfu",
    personName: "浙江巡抚",
    prompt: "单独召见巡抚，让他说明消息由谁、在什么时辰送到。"
  });
});

test("派遣调查保留玩家选择的地点和具体调查任务", () => {
  const raw = commandToRawPlayerAction(command("INVESTIGATION", {
    ...baseIntent,
    objective: "查明田契档房昨夜被潜入的经过",
    target: { type: "LOCATION", id: "archive_room", label: "清流县田契档房" },
    method: "派两名亲随查门栓、脚印、封条和昨夜值守人的交接记录。"
  }, "派两名亲随查门栓、脚印、封条和昨夜值守人的交接记录。"), []);

  assert.deepEqual(raw, {
    source: "INVESTIGATE",
    locationId: "archive_room",
    locationName: "清流县田契档房",
    task: "派两名亲随查门栓、脚印、封条和昨夜值守人的交接记录。"
  });
});

test("使用筹码保留筹码、目标和玩家提出的具体要求", () => {
  const raw = commandToRawPlayerAction(command("LEVERAGE", {
    ...baseIntent,
    objective: "迫使巡抚交出往来副本",
    target: { type: "ROLE", id: "xunfu", label: "浙江巡抚" },
    method: "出示总督关防，限巡抚今日交出全部往来副本和经手名册。",
    leverageKeys: ["asset:governor_seal"]
  }, "出示总督关防，限巡抚今日交出全部往来副本和经手名册。"), []);

  assert.deepEqual(raw, {
    source: "USE_LEVERAGE",
    leverageKey: "asset:governor_seal",
    leverageLabel: "asset:governor_seal",
    targetId: "xunfu",
    targetLabel: "浙江巡抚",
    task: "出示总督关防，限巡抚今日交出全部往来副本和经手名册。"
  });
});

test("自拟谋划原样保留玩家写下的完整行动", () => {
  const text = "先把两个经手人分开候问，再核对第三笔入库日期、签押和驿站登记。";
  const raw = commandToRawPlayerAction(command("CUSTOM_PLAN", {
    ...baseIntent,
    objective: "拆开口供并核对原始记录",
    target: { type: "PUBLIC_FRAME", id: "public_frame", label: "当前局势" },
    method: text
  }, text), []);

  assert.deepEqual(raw, { source: "CUSTOM", text });
});

test("主线剧情选择用完整可见行动回绑当前决策内核，而不是只提交战术短标签", () => {
  const fullAction = "只准清流县先办一批，并在给巡抚的改桑放行回文里写明：不得趁急难压价买田。";
  const internalObjective = "用有限试办换取民田保护与可复核边界";
  const candidate = {
    id: "d1",
    label: "限定试办",
    description: fullAction,
    effectHooks: [
      "附条件签发：用较慢的进度换取民田保护与可复核边界",
      "decisionKernel:DK-P1-EXECUTION-SCOPE",
      "affordance:DK-P1-EXECUTION-SCOPE-OPT-01"
    ],
    intentDraft: {
      ...baseIntent,
      objective: internalObjective,
      target: { type: "ROLE", id: "actor.zhejiang_xunfu", label: "浙江巡抚" },
      method: "附条件签发"
    }
  } as any;
  const raw = commandToRawPlayerAction({
    idempotencyKey: "story-choice",
    turnRevision: 2,
    controlEpoch: 1,
    decisionForm: "STORY_CHOICE",
    candidateId: "d1",
    intent: candidate.intentDraft
  }, [candidate]);

  assert.deepEqual(raw, {
    source: "RECOMMENDED",
    decisionId: "d1",
    label: "限定试办",
    targetId: "actor.zhejiang_xunfu",
    targetLabel: "浙江巡抚",
    actionText: fullAction,
    decisionKernelId: "DK-P1-EXECUTION-SCOPE",
    affordanceTemplateId: "DK-P1-EXECUTION-SCOPE-OPT-01"
  });
  const normalized = normalizePlayerIntent(raw);
  assert.equal(normalized.ok, true);
  if (normalized.ok) assert.equal(normalized.intent.targetId, "actor.zhejiang_xunfu");
});

test("固定开场选择仍提交玩家看见的具体执行方法", () => {
  const method = "将总督封缄令牌交给清流县令亲随，命他向清流县传达封存档房之令；同时当面答复巡抚书吏：暂缓签发，三日内复核。";
  const candidate = {
    id: "opening_d2",
    label: "先封档房，再复巡抚",
    description: "动用总督封缄令牌，先保住清流县档房现场，再给巡抚一个暂缓签发的答复。",
    effectHooks: ["先保现场"],
    intentDraft: {
      ...baseIntent,
      objective: "阻止县册和田契证据在核验前被转移",
      target: { type: "EVIDENCE", id: "card_evidence_archive_seal_order", label: "总督封缄令牌" },
      method
    }
  } as any;
  const raw = commandToRawPlayerAction({
    idempotencyKey: "opening-choice",
    turnRevision: 1,
    controlEpoch: 1,
    decisionForm: "STORY_CHOICE",
    candidateId: "opening_d2",
    intent: candidate.intentDraft
  }, [candidate]);

  assert.equal(raw.source, "RECOMMENDED");
  if (raw.source === "RECOMMENDED") {
    assert.equal(raw.actionText, method);
    assert.equal(raw.decisionKernelId, null);
    assert.equal(raw.affordanceTemplateId, null);
  }
});
