import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionFormV2, PlayerIntentV2, TurnDecisionCommandV2 } from "@ai-story/shared";
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
