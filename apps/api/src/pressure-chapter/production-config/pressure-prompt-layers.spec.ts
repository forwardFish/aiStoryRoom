import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPressureStorySystemInstructionV1,
  buildPressureTurnPresentationSystemInstructionV1,
} from "./pressure-prompt-layers";

test("story prompt assigns one purpose to each layer and makes player action happen first", () => {
  const prompt = buildPressureStorySystemInstructionV1(true);
  assert.match(prompt, /真实当前状态最高/u);
  assert.match(prompt, /上一段剧情只负责连续/u);
  assert.match(prompt, /不是新的权威事实来源/u);
  assert.match(prompt, /示例对话只决定语气/u);
  assert.match(prompt, /玩家本轮原文/u);
  assert.match(prompt, /必须短暂而真实地发生/u);
  assert.match(prompt, /合理的相对时间过渡/u);
  assert.match(prompt, /普通工具、物资和执行动作/u);
  assert.match(prompt, /只有sealed action、currentState和authority\.allowedClaims/u);
  assert.match(prompt, /不得写决堤、死亡、抓捕/u);
  assert.match(prompt, /不得把.*玩家选择了.*系统结算/u);
});

test("one-call turn prompt binds literary story and decision to the same authority", () => {
  const prompt = buildPressureTurnPresentationSystemInstructionV1();
  assert.match(prompt, /一次完成本轮玩家可见的文学剧情/u);
  assert.match(prompt, /sceneText、question、options、usedFactRefs、claims/u);
  assert.match(prompt, /至少三个自然段/u);
  assert.match(prompt, /claims 必须返回空数组/u);
  assert.match(prompt, /authorityDraft\.currentAuthorityState/u);
  assert.match(prompt, /完全相同的 actionType/u);
  assert.match(prompt, /不得遗漏 actionType/u);
  assert.match(prompt, /身份背景、合法行动方向和抽象压力/u);
  assert.match(prompt, /临时人物、物件、时间和环境细节/u);
  assert.match(prompt, /CONTINUATION 必须承接 continuityExcerpt/u);
  assert.match(prompt, /不得替玩家角色下达/u);
  assert.match(prompt, /realTradeoff 非 null/u);
  assert.match(prompt, /为 null 时禁止提及其他选项/u);
  assert.match(prompt, /不能从身份背景、历史常识或想象推导新代价/u);
  assert.match(prompt, /像该角色在现场亲口下令/u);
  assert.match(prompt, /不得写成规则说明、流程说明、功能目录或公文摘要/u);
  assert.match(prompt, /不得保证结果已经发生/u);
});
