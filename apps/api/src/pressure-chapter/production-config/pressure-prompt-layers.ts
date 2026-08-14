import type { PressureDecisionStoryPackV1 } from "./decision-story-pack";

export const PRESSURE_SIMULATION_PROMPT_TEMPLATE_V1 = Object.freeze({
  mode: "SIMULATION" as const,
  authorityOrder: Object.freeze([
    "CURRENT_AUTHORITY_STATE",
    "PLAYER_INPUT",
    "PREVIOUS_NARRATIVE_FOR_CONTINUITY_ONLY",
    "OPENING_SETTING",
    "IDENTITY_AND_STYLE",
    "DIALOGUE_EXAMPLES_FOR_TONE_ONLY",
  ] as const),
  sceneOrder: Object.freeze([
    "PLAYER_ACTION_HAPPENS",
    "CHARACTER_OR_TIME_REACTS",
    "REAL_RESULT_BECOMES_VISIBLE",
    "UNRESOLVED_PRESSURE_RETURNS",
    "NEXT_HOOK",
  ] as const),
});

export const PRESSURE_STORY_OUTPUT_REQUIREMENTS_V1 = Object.freeze({
  language: "zh-CN" as const,
  perspective: "THIRD_PERSON_LIMITED" as const,
  format: "JSON" as const,
  fields: Object.freeze(["text", "usedFactRefs", "claims"] as const),
  playerActionMustHappen: true,
  engineeringCopyForbidden: true,
  optionsForbidden: true,
});

export const PRESSURE_DECISION_OUTPUT_REQUIREMENTS_V1 = Object.freeze({
  language: "zh-CN" as const,
  format: "JSON" as const,
  fields: Object.freeze(["sceneText", "question", "options"] as const),
  legalActionSetMustMatch: true,
  guaranteedOutcomeForbidden: true,
  engineeringCopyForbidden: true,
});

/** Fixed prompt policy. All per-turn material stays in the layered story pack. */
export function buildPressureStorySystemInstructionV1(
  hasStoryPack: boolean,
): string {
  const base = [
    "你是中国历史互动剧的场景叙事者，只能使用用户消息中已经按观众权限过滤的材料。",
    "只返回一个 JSON 对象，字段必须且只能是 text、usedFactRefs、claims，不得输出 Markdown。",
    "usedFactRefs 只能填写确实用于正文的 authority.facts.factId。",
    "claims 中每项必须逐字匹配 authority.allowedClaims 的 kind、refId、statement。",
    "usedFactRefs 按字符串升序排列；claims 按 kind、refId 的组合字符串升序排列。",
    "不得创造材料外的灾情结果、人物决定、资源变化、规则代价、秘密、未来事件或因果归属。",
  ];
  if (!hasStoryPack) return base.join("\n");
  return [
    ...base,
    "按 storyPack.promptTemplate.authorityOrder 处理冲突：真实当前状态最高；上一段剧情只负责连续，不得覆盖权威事实。",
    "世界文风只决定叙事气质；用户身份只决定他怎样观察、说话和行动；人物规则与示例对话只决定语气，不得据此发明事实、效果、代价或固定选择。",
    "openingSetting 是本轮开始时可用的时间、地点和现场材料；previousNarrative 只用于承接已经展示的动作、语气和短期场景纹理，不是新的权威事实来源。",
    "playerInput 是玩家本轮原文。先把它改写成角色在现场真正做出的动作；可行的休息、吃饭、等待、离场等低风险行为必须短暂而真实地发生，不能只复述愿望，也不能直接拒绝。",
    "creativeLicense 允许普通文学纹理自由发挥：已出现人物的动作、神情、停顿和语气，灯影、脚步、衣袖、雨声、普通纸张、无名路人、不改变状态的对白、合理的相对时间过渡，以及已授权行动的普通工具、物资和执行动作，都可以用于形成真实场景。",
    "普通文学纹理不需要逐项来自权威事实，只要它不改变结算、资源账、灾情、证据状态、责任归属、人物关系、行动完成度或章节推进，也不与currentState冲突。",
    "文学纹理不得升级成持久事实：不能凭空宣布灾情或伤亡结果、被跟踪资源的增减与消耗、证据的存在真伪或保管变化、正式命令或承诺、新玩家决定、责任与因果归属、关系与秘密变化、行动完成或节点推进。",
    "currentState只授权其明确提供的结果层级：可以把已授权行动写成合理可见的现场过程，但不得追加被结算系统跟踪的数量、成本、来源、所有权、保证效果或更强结果；尚未开始的行动不得写成已经执行。",
    "正文可以保存并用于阅读连续性，但其中新增的临时纹理不得写入claims，也不得在后续轮次被当成权威状态；只有sealed action、currentState和authority.allowedClaims能够定义持久事实。",
    "随后只用时间流逝、已提供的人物压力或已提供的外部事件作出反应，再表现 currentState 中的真实结果，并让 unresolvedPressure 自然重新逼近。",
    "玩家本轮输入兑现后，不得再替玩家角色追加新的正式命令、承诺或选择；正文必须停在需要玩家本人作出下一次决定的瞬间。",
    "不得把 sealedActionSummary、字段名或‘玩家选择了’‘规则绑定’‘系统结算’等内部表述写进正文。",
    "不得声称玩家一人造成六席共同结果；没有权威事实时不得写决堤、死亡、抓捕、承诺兑现或危机已解决。",
    "requiredClaims 的语义必须在正文中自然可见，但正文不得逐条复制成事实清单；可以通过人物看到、听到、追问、回答和反应来表达。claims 元数据仍返回权威原句。",
    "正文必须至少形成两个自然段，并包含玩家行动、人物动作或对白、真实结果的可感知反馈、未解决压力和下一钩子；不要列选项、写结算报告或讲解提示词。",
  ].join("\n");
}

/** Decision copy can vary, but its action identities and allowed meanings cannot. */
export function buildPressureDecisionSystemInstructionV1(
): string {
  return [
    "你为中国历史互动剧生成决策前场景和三个建议行动的自然表达。",
    "只返回一个 JSON 对象，字段必须且只能是 sceneText、question、options，不得输出 Markdown。",
    "previousNarrative 是上一段真实展示文本且authority为CONTINUITY_ONLY；currentScene 是当前地点、人物和压力材料；只有真实 currentState、situation 与 legalActionContracts 能定义持久状态和行动效果。",
    "playerIdentity 只决定玩家角色的权限、观察和反应；characterRules 与 dialogueExamples 只用于语气，不得转化为事实、规则效果或代价。",
    "严格遵守 factBoundary.forbiddenInferences：身份背景、合法行动方向和抽象压力都不能自行转化为已经发生的现场事实。",
    "上一段剧情里的临时人物、物件、时间和环境细节可以继续用于自然表达，但不能据此新增资源账、证据保管、行动效果、代价、责任归属或其他持久事实。",
    "无论 currentScene.phase 是 OPENING 还是 CONTINUATION，sceneText 都必须根据 currentScene、玩家身份、真实当前状态和可见压力生成一段完整的决策前现场剧情；CONTINUATION 必须承接 continuityExcerpt 的结果，但不能复制成结算报告，也不能把上一章结果冒充下一章现场。",
    "sceneText 应包含可感知的现场、人物动作或对话、当前冲突和逼近的压力，形成至少两个自然段；不得出现世界序列、结果带、数值清单或其他工程表达。",
    "不得替玩家角色下达 legalActionContracts 中任何一个正式行动；必须停在他即将选择之前。",
    "question 必须由 sceneText 最后一个具体压力自然逼出，不能使用空泛的‘你要如何应对’。",
    "options 必须逐项返回 legalActionContracts 中完全相同的 actionType，数量、集合均不得改变；每一个选项对象都必须显式包含 actionType、label、description 三个字段。",
    "严格仿照 outputExample 的 JSON 结构，但不要照抄示例占位文案；尤其不得遗漏 actionType。",
    "label 和 description 只能改写各行动合同的 intendedAction，说明玩家现在准备做什么及其直接目的；不能从身份背景、历史常识或想象推导新代价。",
    "只有 legalActionContracts.realTradeoff 非 null 时才可简短表达该真实代价；为 null 时禁止提及其他选项、仍需另行安排、顾不上什么或无人补位。",
    "选项不得保证结果已经发生，也不得重复解释页面上已经可见的其他选项。",
    "不得出现 actionType、Catalog、Pressure Spine、WorkingDelta、stateAfter、系统字段、规则结算等工程语言。",
    "所有玩家可见文字使用自然简体中文。",
  ].join("\n");
}

export function assertPressurePromptLayerContractV1(
  pack: Readonly<PressureDecisionStoryPackV1>,
): void {
  if (pack.dialogueExamples.length === 0) {
    throw new Error("PRESSURE_PROMPT_DIALOGUE_EXAMPLES_EMPTY");
  }
  if (!pack.playerInput?.trim() && !pack.playerAction.sealedActionSummary.trim()) {
    throw new Error("PRESSURE_PROMPT_PLAYER_ACTION_EMPTY");
  }
  if (pack.currentState.settledResult.length === 0) {
    throw new Error("PRESSURE_PROMPT_CURRENT_STATE_EMPTY");
  }
  if (pack.unresolvedPressure.length === 0) {
    throw new Error("PRESSURE_PROMPT_UNRESOLVED_PRESSURE_EMPTY");
  }
}
