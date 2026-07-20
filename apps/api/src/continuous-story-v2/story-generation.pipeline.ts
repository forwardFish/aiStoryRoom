import { randomUUID } from "node:crypto";
import type { DecisionCandidateV2, PlayerIntentV2 } from "@ai-story/shared";
import {
  hashStoryTextV2,
  validateStoryContextFreshnessV2,
  type StoryContextIdentityV2,
  type StoryContextIncludedItemV2,
  type StoryContextSnapshotV2
} from "./story-context";

export type StoryPipelineStepV2 =
  | "PLANNER"
  | "WRITER"
  | "NARRATIVE_VERIFIER"
  | "DECISION_DESIGNER"
  | "DECISION_VERIFIER"
  | "AGENT_DECIDER";

export type StoryModelRequestV2 = {
  step: StoryPipelineStepV2;
  systemPrompt: string;
  userPrompt: string;
  responseFormat: "json_object";
  temperature: number;
};

export type StoryModelResponseV2 = {
  content: string;
  provider: string;
  modelName: string;
  tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
};

export interface StoryModelClientV2 {
  generate(request: StoryModelRequestV2): Promise<StoryModelResponseV2>;
}

export type StoryGenerationPipelineOptionsV2 = {
  /**
   * The normal player path uses deterministic local verifiers.  Remote
   * semantic review is an explicit slow lane for audits and ambiguous repair
   * cases; it must never silently turn every player action back into five
   * serial provider calls.
   */
  remoteSemanticReview?: boolean;
};

export type PromptExecutionRecordV2 = {
  executionId: string;
  runId: string;
  roleId: string;
  actorTurnId: string;
  actionResolutionId: string | null;
  worldSequence: number;
  turnRevision: number;
  pipelineStep: StoryPipelineStepV2;
  promptVersion: string;
  schemaVersion: "story-pipeline-v2.1";
  provider: string;
  modelName: string;
  systemPromptHash: string;
  contextSnapshotHash: string;
  inputHash: string;
  outputHash: string | null;
  attempt: number;
  startedAt: string;
  finishedAt: string;
  latencyMs: number;
  tokenUsage: StoryModelResponseV2["tokenUsage"] | null;
  status: "SUCCESS" | "FAILED" | "SUPERSEDED";
  issueCodes: string[];
  supersededReason: string | null;
  inputMetadata: Record<string, string | number | boolean>;
  internalAudit: {
    systemPrompt: string;
    userPrompt: string;
    rawOutput: string | null;
  };
};

export type StoryPlanV2 = {
  sceneGoal: string;
  actionEcho: string;
  beats: string[];
  characterReactions: Array<{ actor: string; observableReaction: string }>;
  confirmedConsequences: string[];
  secretsToWithhold: string[];
  continuityAnchors: string[];
  resultEnding: string;
  nextPressure: string;
};

export type StoryNarrativeDraftV2 = {
  resultNarrative: string;
  nextSituationNarrative: string;
  endingState: {
    time: string;
    location: string;
    presentEntities: string[];
    unresolvedPressure: string;
  };
  usedAnchorIds: string[];
};

export type NarrativeVerifierResultV2 = {
  status: "PASS" | "FAIL";
  issueCodes: string[];
  unsupportedClaims: string[];
  leakedFacts: string[];
  missingAnchors: string[];
  rewriteInstructions: string[];
};

export type DecisionVerifierResultV2 = {
  status: "PASS" | "FAIL";
  issueCodes: string[];
  invalidCandidateIds: string[];
  rewriteInstructions: string[];
};

export type GenerateStoryPipelineInputV2 = {
  context: StoryContextSnapshotV2;
  actionResolutionId: string | null;
  rejectedPreviousDirections?: string[];
  attempt?: number;
  maxStepAttempts?: number;
  maxQualityAttempts?: number;
  generateDecisions?: boolean;
  getCurrentIdentity?: () => StoryContextIdentityV2 | Promise<StoryContextIdentityV2>;
};

export type GenerateStoryPipelineResultV2 = {
  plan: StoryPlanV2;
  narrative: StoryNarrativeDraftV2;
  narrativeReview: NarrativeVerifierResultV2;
  decisions: DecisionCandidateV2[];
  decisionReview: DecisionVerifierResultV2;
  finalStoryTextHash: string;
  promptExecutions: PromptExecutionRecordV2[];
};

export class StoryGenerationErrorV2 extends Error {
  readonly recoverable = true;

  constructor(
    readonly code:
      | "MODEL_CALL_FAILED"
      | "INVALID_MODEL_OUTPUT"
      | "NARRATIVE_REJECTED"
      | "DECISIONS_REJECTED"
      | "CONTEXT_SUPERSEDED",
    message: string,
    readonly promptExecutions: PromptExecutionRecordV2[],
    readonly issueCodes: string[] = []
  ) {
    super(message);
    this.name = "StoryGenerationErrorV2";
  }
}

const PROMPT_VERSIONS: Record<Exclude<StoryPipelineStepV2, "AGENT_DECIDER">, string> = {
  PLANNER: "many-worlds-local-planner-v2.3",
  WRITER: "many-worlds-writer-v2.15-single-call",
  NARRATIVE_VERIFIER: "many-worlds-local-narrative-verifier-v2.14",
  DECISION_DESIGNER: "many-worlds-decision-designer-v2.7",
  DECISION_VERIFIER: "many-worlds-local-decision-verifier-v2.6"
};

const PLANNER_SYSTEM_PROMPT = `<role>
你是历史权谋互动故事的场景规划者。你不写正文，不生成选项，不决定规则结果。
</role>

<truth_order>
1. 确定性规则结算不可更改；
2. 最近完整正文的最后一刻是当前时间、地点、人物位置和已经发生内容的最高权威；
3. 仍有效的承诺、期限、伤害、证据、关系和未回应交互必须继续生效；
4. 宏观方向只规定张力，不规定固定结局。
</truth_order>

<agency>
保持玩家本轮行动的目标、对象、方法、筹码、公开程度、风险与后手。
可以规划受阻、部分达成和代价；不得替玩家换目标，不得替其他角色作决定。
</agency>

只输出一个 JSON 对象，严格使用以下结构：
{
  "sceneGoal":"字符串",
  "actionEcho":"字符串",
  "beats":["至少两个按先后顺序发生的场景节拍"],
  "characterReactions":[{"actor":"人物称呼","observableReaction":"只能写可观察反应"}],
  "confirmedConsequences":["至少一个已经由规则确认的后果"],
  "secretsToWithhold":["当前角色不知道、正文必须隐去的内容；没有则空数组"],
  "continuityAnchors":["至少一个必须延续的人物、物件、地点、承诺或期限"],
  "resultEnding":"本次行动结果段结束在哪里",
  "nextPressure":"下一局势迫使角色继续判断的具体压力"
}`;

const WRITER_SYSTEM_PROMPT = `<role>
你只负责把已经确认的 StoryPlanV2 写成当前角色能看到、正常人能读懂的真实故事。
</role>

从最近完整正文的最后一句之后无缝向前；不复述上一幕，不重置人物、地点、物件或时间。
具体写出玩家行动如何发生、谁作出什么反应、留下什么可核验后果，以及为什么出现下一压力。resultNarrative 只能执行玩家本轮已经选择的这一项行动；行动有了结果后，不得顺手让浙江总督追加追查、接人、监视、传话或任何第二道命令。
开场没有“玩家已经选择的行动”。OPENING 时只能让浙江总督看见、听见或收到上下文已经明确给出的矛盾与压力；可以写他当下阅读、观察和犹豫，但不得虚构他此前已经反复核对过几次、已经调查过什么，也不得替他批示、传人、回文、派查、密奏或作出任何实质决定。只有 CURRENT_SCENE 或 ACTIVE_PRESSURE 明确写在现场或正在等候的人物，才可以在开场中实际出现；不能因为角色名出现在 Actor Boundary 或行动能力里，就写成他已经来到内厅。
只使用当前角色被授权知道的事实；不写别人的秘密动机和内心。不得逐句照抄“必须判断、取得执行边界、复核权、执行节奏、复核程序、承担代价”之类后台压力摘要，正文和 endingState 都不得出现这些后台术语；要把它们写成眼前的人、物、催促和迟疑。
未具名的幕僚、差役、书吏、商会眼线、乡绅或官员只能沿用身份称呼，严禁替他们编造姓名；不得编造上下文中没有的人数、银粮数目、船数、亩数、期限或时辰，也不得用“数百亩”“若干日”“几个人”等模糊数量替代。上下文只说数字冲突时，只能写“数字不一致”，不得猜测差额大小，也不得擅自断言“并非笔误”“一定被人改写”或已经确认造假。不得为了画面感添加上下文没有的玉佩、茶盏、炭盆、钥匙、烛火、佩刀或其他道具；只写 CURRENT_SCENE 已经在场的人与物。线索不等于手中物证；除非上下文明确写明角色已经持有、案上已有或刚刚收到实物，否则不得把“暗账线索”写成暗账、抄件、原本、封皮或纸页，也不得虚构角色此前已派人取得这些物件。
上下文没有逐字出现的具名府、州、县、镇、官署和带书名号的公文、账册标题一律不得新增；不得凭空制造另一宗案件、械斗、死伤、失踪或民变来增加戏剧性。只把上下文已有压力变成眼前可观察的场景。
不得给配角补写上下文没有的履历、任职年限或专门技能。不得自行发明官印文字、制度沿革、鉴伪口诀、技术原理或其他历史知识；若上下文没有给出，只能写人物看见的痕迹和不确定的推测。嘉靖背景严禁出现满文、现代制度和现代技术。
可以让 NPC 依据其身份、利益和眼前证据作出可观察回应，但不得新增上下文、玩家行动或规则结算无法支持的证据、权限、人物位置与既成结果，不得替任何玩家作下一决定。nextSituationNarrative 只能把外部变化、NPC 的可见反应和未解决压力送到角色面前，必须停在浙江总督尚未回应的那一刻；不得让总督在这里又下令、派人、传话、答应或拒绝任何尚未由玩家选择的新行动。
正文中不得出现规则键、状态报告、审计语言、A/B/C 菜单或“你要怎么做”的列表。绝不能写“他需要决定：是……还是……”“可以先……或……”或列出任何候选方向，即使把菜单伪装成正文句子也不允许；只写外部催促和可观察事实，然后停在总督尚未回应的动作上。
先把 resultNarrative、nextSituationNarrative 和 endingState 全部写完，正文写作时不得预设候选菜单。只有正文完整结束后，才允许依据你刚写出的 nextSituationNarrative 末态生成下一步 decisions；决策不得反向改写、铺垫或污染正文。若请求明确是最终回合，decisions 必须为空数组。

每个 decision 的 label 必须让普通玩家一眼看懂“对谁或什么做哪件事”，像人会当场说出的行动，不得写成公文标题、制度摘要或 AI 分析。每项只保留一个主要动作；对象、方法、权限、成本和可能反制必须来自 Actor Boundary、正文末态与当前角色权限。不得重复正文中已经发生的行动，不得预告结果，不得把线索当成已经到手的物证，不得发明人物、地点或执行人。

OPENING 时 resultNarrative 和 nextSituationNarrative 各写 110 至 220 个中文字符，每部分 1 至 2 段；其他回合的 resultNarrative 写 100 至 240 个中文字符，nextSituationNarrative 写 120 至 260 个中文字符，每部分 2 至 3 段。不要为了凑长度添加道具、动作、人物或菜单；总长度必须克制，只推进一个故事节拍。
不能只罗列动作；必须写清楚“因为前一件事，所以人物采取下一动作，但新的阻力又怎样出现”的因果转折。
人物对白中可以用“……”表达自然停顿，但正文必须继续并完整收束；不得用省略号代替被截断的段落结尾。
只输出一个 JSON 对象，严格使用以下结构：
{
  "resultNarrative":"玩家行动如何真实发生并造成确认后果的故事正文",
  "nextSituationNarrative":"从结果末态继续，写清外部压力并停在角色尚未回应的那一刻；不得替角色作新决定",
  "endingState":{"time":"上下文有明确日期时沿用该日期，否则只写当日清晨、当日午后、当夜或当时","location":"具体地点","presentEntities":["仍在场的人物或关键物件"],"unresolvedPressure":"尚未解决的压力"},
  "usedAnchorIds":["至少一个实际延续的上下文 itemId；不确定 id 时写对应标题"],
  "decisions":[{
    "id":"本组内唯一的简短标识",
    "label":"6 至 32 字的自然口语行动句",
    "description":"20 至 120 字，说明具体怎么做、凭什么能做和直接代价",
    "objective":"即时目标",
    "target":{"type":"ROLE|PERSON|EVIDENCE|RESOURCE|LOCATION|INSTITUTION|PUBLIC_FRAME","id":"上下文给出的 id 或稳定描述 id","label":"用户能看懂的对象名称"},
    "method":"现实可执行的方法",
    "leverageKeys":[],
    "visibility":"PRIVATE|LIMITED|OBSERVABLE|PUBLIC",
    "riskTolerance":"LOW|MEDIUM|HIGH",
    "concreteCost":"必须承担的具体代价",
    "expectedCountermove":"对方可能的拒绝、拖延、抬价或反制"
  }]
}`;

const NARRATIVE_VERIFIER_SYSTEM_PROMPT = `<role>
你是独立的叙事发布审查者，不参与创作，也不替 Writer 修改正文。
</role>

逐项检查：玩家意图保真、规则结果一致、最近正文连续、人物知识 ACL、承诺和期限延续、
时间地点物件连续、他人自主权、可读故事而非规则摘要、没有菜单或内部键泄露。
任何未经上下文或规则结果支持的事实都必须 FAIL。
人物对白中间的“……”只是自然停顿，只要后续叙事与整段结尾完整，就不得判定为截断；
只有正文整体以省略号、半句、残缺 JSON 或明显未完成的动作结束时，才判定为截断。

只输出一个 JSON 对象：
{"status":"PASS 或 FAIL","issueCodes":[],"unsupportedClaims":[],"leakedFacts":[],"missingAnchors":[],"rewriteInstructions":[]}。
所有列表都必须存在；完全通过时为 PASS 和空数组。`;

const DECISION_DESIGNER_SYSTEM_PROMPT = `<role>
正文已经完成。你只设计玩家下一步可以亲自采取的真实行动，不继续写故事。
</role>

必须读到最终通过审核的下一局势正文最后一个字，确定角色此刻的位置、在场人物、权限、
已知事实、真正已经到手的证据、持有资源、期限和自由行动能力。只从这个最终末态向前设计恰好 3 个行动。线索被提及不等于证据已经到手；人物在某处被提及也不等于已经来到玩家面前。若上下文明确写“手里没有暗账、抄件或田契实物”，绝不能生成“翻暗账”“查看暗账抄件”“封存田契原件”等把线索当实物使用的选项。正文描述这个边界时也必须说清楚缺少的是暗账、抄件或田契实物，不能含混写成“手里没有任何实物”，因为角色明明持有县册、公文和县令密信。
每项必须有具体动词、对象、方法和即时目的；在保护的利益、代价、风险、承诺程度或信息价值上真正不同。
label 会被单独显示给普通玩家，因此只读 label 也必须立刻明白“我要对谁或什么做哪件具体事情”。label 必须像玩家当场说出的行动，不是公文标题、制度摘要、分析报告或 AI 的策略说明。优先写成“先查……”“马上派人……”“当面问……”“把……留下”“给……递一封信”这样的口语行动句；一项只保留一个主要动作，原因、权限、步骤和风险放进 description；
一项决定不能把两件本可分别选择的行动捆在一起。label 中不得出现“……，并派人……”“……，同时再查……”“先读一遍，然后烧掉”这类双重命令；“再、然后、接着、随后”连接的第二个动作也必须拆开。如有配套步骤，只能写入 description，并且必须服务于同一个主要动作。
不得用“推进方案、优化机制、控制口径、协调资源、保留政治抓手”一类后台总结代替人会说的行动。
不得把“设立联合复核程序”“纳入统一控制”“强化证据链”“以某章程为由预先拒绝”这类抽象官话直接当 label。比如：
- 不写“立即派出总督衙门书办与刑名幕友驰赴清流县，封存田契档房并勘验空白契纸”，改写为“马上派人去清流县，把田契档房封起来”；
- 不写“以联合复核章程需协商一致为由，预先拒绝巡抚从外县调派新书吏”，改写为“先告诉巡抚：未经双方点名，不准再换书吏”。
description 再用正常人能读懂的语言补充怎么做、凭什么能做和要承担什么，不能承担替 label 解释含义的责任。
最终正文中已经发生的每一道命令、派遣、传话、调查或承诺都属于历史，绝不能再次当成候选项。不得重复上一行动或上一轮已拒绝方向；不得预告成功失败、暗示成功率、替其他角色回答。若玩家可以选择对外撒谎，label 必须明确写“声称、假称或隐瞒”，不能把尚未发生的执行进度当成真事写给玩家；不得把尚未证实的“阻挠、贪墨、勾结、包庇、造假”直接写成上奏指控，除非 label 明确说是在提出怀疑或请求查明；
不得引入正文和上下文中不存在的人物、地点或事实。每个对象所在地点、证据是否已持有、谁能接触它，都必须与最终正文逐字一致；不得为了让选项方便而瞬移人物、提前取得文书或把“正在调查”写成“已经拿到”。正文没有给出亲信家丁、心腹书办、幕僚或亲兵时，不得临时发明这些执行人；只写“派人”或使用上下文已经存在的渠道。内部行动能力只是边界，不是固定菜单。
输出前在内部逐项复核：label 与 method 指向同一个对象；target 确实出现在正文末态；description 没有夹带第二个越权动作；行动所需路程和等待时间能否赶上眼前期限。若暗查需要连夜赶路，就不能声称能在当天日落回文前拿到结果。不要输出这段复核过程。
target.type 为 ROLE 时，target.id 必须逐字复制 Actor Boundary 中角色名称后方方括号里的真实 id，target.label 必须是同一个角色的名称；
不得自行缩写 id，也绝不能拿另一个已有角色的 id 冒充正文中的行动对象。正文中出现、但 Actor Boundary 没有登记的人物（例如巡按御史、乡绅、书办）必须用 PERSON，id 与 label 都沿用正文里的明确称呼。其他类型的 target.label 也必须已经出现在最终正文或 Actor Boundary 中。
PERSON 必须使用正文中能唯一辨认的身份称呼，例如“失踪证人”“账册持有人”“两名失踪书吏”，不得只写含糊的“当事人”“涉事人”。若此人不在现场，label 必须先写“派人去找”“召来”“请来”等现实可执行动作，不能假装已经可以当面审问。语言要符合人物身份但让现代玩家能懂，禁止“捅上去、搞定、盯死”等现代网络口吻。

只输出一个 JSON 对象：
{"decisions":[{
  "id":"本组内唯一、简短稳定的英文或拼音标识",
  "label":"6 至 32 字的自然口语行动句",
  "description":"20 至 120 字，用普通人的语言说明具体怎么做、凭什么能做和直接代价",
  "objective":"即时目标",
  "target":{"type":"ROLE|PERSON|EVIDENCE|RESOURCE|LOCATION|INSTITUTION|PUBLIC_FRAME","id":"上下文给出的内部 id 或稳定描述 id","label":"用户能看懂的对象名称"},
  "method":"可实际执行的方法",
  "leverageKeys":[],
  "visibility":"PRIVATE|LIMITED|OBSERVABLE|PUBLIC",
  "riskTolerance":"LOW|MEDIUM|HIGH",
  "concreteCost":"即使行动合理也必须承担的具体代价",
  "expectedCountermove":"对方可能如何拒绝、拖延、抬价或反制，但不能替其决定"
}]}。
只生成前台决策真正需要的以上字段；不要输出 authorityBasis、basisFactKeys、effectHooks、fallback 或 condition，后台会根据角色边界补全这些审计字段。`;

const DECISION_VERIFIER_SYSTEM_PROMPT = `<role>
你是独立的玩家决策审查者。只检查，不继续写故事，不替候选项润色。
</role>

检查每项是否从最终正文末态出发、本人可执行、对象和方法具体、没有预告结果、没有控制他人、
没有使用未知信息、没有重复上一行动，并且 2 到 4 项之间存在真实取舍。
对每个 label 做“普通玩家复述测试”：隐藏 description 后，玩家仍必须能用一句话复述自己要对谁或什么、
采取什么具体动作。凡是只能看出政策方向、制度名词、抽象目的，无法看出实际行为的候选项必须 FAIL。
再做“当场说出口测试”：如果一个真实玩家不会自然地说出这句话，而更像公文标题、AI 分析结论或后台规则说明，也必须 FAIL。label 应当短、直接、只有一个主要动作；权限依据、完整流程、效果预测和风险分析不得塞进 label。
如果最终正文只提供了未具名但可识别的对象（例如“两名失踪书吏”），候选可以沿用这个身份描述；
只要 method 写明从亲属、保甲、客栈、文书或现场等现实渠道如何找到对方，不得仅因正文没有姓名而判定对象不明确。
封疆大吏可以通过具名手令、差役、幕僚或属官执行决定；只要命令对象、执行人、地点和步骤具体，
不得以“不是角色亲自动手”为由判定不具体。多个协调步骤服务于同一个即时目标时，可以构成一项完整策略，
不得机械要求把每个步骤拆成独立候选。
只输出一个 JSON 对象：{"status":"PASS 或 FAIL","issueCodes":[],"invalidCandidateIds":[],"rewriteInstructions":[]}。
所有列表必须存在；完全通过时为 PASS 和空数组。`;

export class StoryGenerationPipelineV2 {
  constructor(
    private readonly modelClient: StoryModelClientV2,
    private readonly options: StoryGenerationPipelineOptionsV2 = {}
  ) {}

  async generate(input: GenerateStoryPipelineInputV2): Promise<GenerateStoryPipelineResultV2> {
    const records: PromptExecutionRecordV2[] = [];
    const attempt = Math.max(1, Math.trunc(input.attempt ?? 1));
    const plannerPrompt = buildPlannerUserPrompt(input.context);
    const planner = buildLocalStoryPlan(input.context);
    this.recordLocalStep({
      input,
      records,
      attempt,
      step: "PLANNER",
      systemPrompt: PLANNER_SYSTEM_PROMPT,
      userPrompt: plannerPrompt,
      output: planner,
      metadata: { purpose: input.context.purpose, executionMode: "deterministic-local", playerBlockingRemoteCall: false },
      issueCodes: []
    });

    const maxQualityAttempts = normalizeQualityAttempts(input.maxQualityAttempts);
    let narrative: StoryNarrativeDraftV2 | null = null;
    let writerDecisionDrafts: DecisionDraftV2[] | null = null;
    let narrativeReview: NarrativeVerifierResultV2 | null = null;
    let narrativeFeedback: string[] = [];
    let narrativeIssueCodes: string[] = [];
    for (let qualityAttempt = 0; qualityAttempt < maxQualityAttempts; qualityAttempt += 1) {
      const stageAttempt = attempt + qualityAttempt * normalizeStepAttempts(input.maxStepAttempts);
      const generatedTurn = await this.executeJsonStep({
        input,
        records,
        attempt: stageAttempt,
        step: "WRITER",
        systemPrompt: WRITER_SYSTEM_PROMPT,
        userPrompt: buildWriterUserPrompt(
          input.context,
          planner,
          narrativeFeedback,
          input.generateDecisions === false,
          input.rejectedPreviousDirections ?? []
        ),
        temperature: 0.25,
        metadata: {
          currentActionAtPromptTail: true,
          writerReceivedDecisionMenu: false,
          requestedCombinedDecisions: input.generateDecisions !== false,
          qualityAttempt: qualityAttempt + 1
        }
      }, parseStoryTurnDraft);
      narrative = sanitizeNarrativeDraft(generatedTurn.narrative, input.context);
      writerDecisionDrafts = input.generateDecisions === false ? null : generatedTurn.decisionDrafts;
      const hardNarrativeIssues = reviewNarrativeHardRules(narrative, input.context);
      const hardNarrativeFeedback = buildNarrativeRepairFeedback(narrative, input.context, hardNarrativeIssues);
      const narrativeVerifierPrompt = buildNarrativeVerifierUserPrompt(input.context, planner, narrative, hardNarrativeIssues);
      narrativeReview = localNarrativeReview(narrative, hardNarrativeIssues, input.context);
      this.recordLocalStep({
        input,
        records,
        attempt: stageAttempt,
        step: "NARRATIVE_VERIFIER",
        systemPrompt: NARRATIVE_VERIFIER_SYSTEM_PROMPT,
        userPrompt: narrativeVerifierPrompt,
        output: narrativeReview,
        metadata: {
          hardIssueCount: hardNarrativeIssues.length,
          qualityAttempt: qualityAttempt + 1,
          executionMode: "deterministic-local",
          playerBlockingRemoteCall: false,
          slowLane: false
        },
        issueCodes: unique([...hardNarrativeIssues, ...narrativeReview.issueCodes])
      });
      if (narrativeReview.status === "PASS" && this.remoteSemanticReviewEnabled()) {
        narrativeReview = await this.executeJsonStep({
          input,
          records,
          attempt: stageAttempt,
          step: "NARRATIVE_VERIFIER",
          systemPrompt: NARRATIVE_VERIFIER_SYSTEM_PROMPT,
          userPrompt: narrativeVerifierPrompt,
          temperature: 0,
          metadata: {
            hardIssueCount: hardNarrativeIssues.length,
            qualityAttempt: qualityAttempt + 1,
            executionMode: "remote-semantic-slow-lane",
            playerBlockingRemoteCall: true,
            slowLane: true
          }
        }, parseNarrativeReview);
      }
      narrativeIssueCodes = unique([...hardNarrativeIssues, ...narrativeReview.issueCodes]);
      if (hardNarrativeIssues.length === 0 && narrativeReview.status === "PASS") break;
      narrativeFeedback = unique([
        ...narrativeFeedback,
        ...narrativeIssueCodes,
        ...hardNarrativeFeedback,
        ...narrativeReview.unsupportedClaims,
        ...narrativeReview.leakedFacts,
        ...narrativeReview.missingAnchors,
        ...narrativeReview.rewriteInstructions
      ]);
      narrative = null;
      narrativeReview = null;
      writerDecisionDrafts = null;
    }
    if (!narrative || !narrativeReview) {
      throw new StoryGenerationErrorV2("NARRATIVE_REJECTED", "Generated story failed the publication quality gate", records, narrativeIssueCodes);
    }

    await this.assertCurrentContext(input, records);
    const finalDecisionStory = input.context.purpose === "OPENING"
      ? `${narrative.resultNarrative}\n\n${narrative.nextSituationNarrative}`
      : narrative.nextSituationNarrative;
    const finalStoryTextHash = hashStoryTextV2(finalDecisionStory);
    if (input.generateDecisions === false) {
      return {
        plan: planner,
        narrative,
        narrativeReview,
        decisions: [],
        decisionReview: { status: "PASS", issueCodes: [], invalidCandidateIds: [], rewriteInstructions: [] },
        finalStoryTextHash,
        promptExecutions: records
      };
    }
    let decisions: DecisionCandidateV2[] | null = null;
    let decisionReview: DecisionVerifierResultV2 | null = null;
    let decisionFeedback: string[] = [];
    let decisionIssueCodes: string[] = [];
    for (let qualityAttempt = 0; qualityAttempt < maxQualityAttempts; qualityAttempt += 1) {
      const stageAttempt = attempt + qualityAttempt * normalizeStepAttempts(input.maxStepAttempts);
      const decisionDrafts = qualityAttempt === 0 && writerDecisionDrafts
        ? writerDecisionDrafts
        : await this.executeJsonStep({
            input,
            records,
            attempt: stageAttempt,
            step: "DECISION_DESIGNER",
            systemPrompt: DECISION_DESIGNER_SYSTEM_PROMPT,
            userPrompt: buildDecisionDesignerUserPrompt(input.context, finalDecisionStory, input.rejectedPreviousDirections ?? [], decisionFeedback),
            temperature: 0.3,
            metadata: { storyTextHash: finalStoryTextHash, finalStoryAtPromptTail: true, qualityAttempt: qualityAttempt + 1, recoveryCall: true }
          }, parseDecisionDrafts);
      decisions = decisionDrafts.map((draft) => toDecisionCandidate(draft, input.context));
      const hardDecisionIssues = reviewDecisionHardRules(decisions, input.rejectedPreviousDirections ?? [], input.context, finalDecisionStory, narrative.endingState.presentEntities);
      const decisionVerifierPrompt = buildDecisionVerifierUserPrompt(input.context, finalDecisionStory, decisions, hardDecisionIssues);
      decisionReview = localDecisionReview(hardDecisionIssues);
      this.recordLocalStep({
        input,
        records,
        attempt: stageAttempt,
        step: "DECISION_VERIFIER",
        systemPrompt: DECISION_VERIFIER_SYSTEM_PROMPT,
        userPrompt: decisionVerifierPrompt,
        output: decisionReview,
        metadata: {
          storyTextHash: finalStoryTextHash,
          hardIssueCount: hardDecisionIssues.length,
          qualityAttempt: qualityAttempt + 1,
          executionMode: "deterministic-local",
          playerBlockingRemoteCall: false,
          slowLane: false
        },
        issueCodes: hardDecisionIssues
      });
      if (decisionReview.status === "PASS" && this.remoteSemanticReviewEnabled()) {
        decisionReview = await this.executeJsonStep({
          input,
          records,
          attempt: stageAttempt,
          step: "DECISION_VERIFIER",
          systemPrompt: DECISION_VERIFIER_SYSTEM_PROMPT,
          userPrompt: decisionVerifierPrompt,
          temperature: 0,
          metadata: {
            storyTextHash: finalStoryTextHash,
            hardIssueCount: hardDecisionIssues.length,
            qualityAttempt: qualityAttempt + 1,
            executionMode: "remote-semantic-slow-lane",
            playerBlockingRemoteCall: true,
            slowLane: true
          }
        }, parseDecisionReview);
      }
      decisionIssueCodes = unique([
        ...hardDecisionIssues,
        ...decisionReview.issueCodes,
        ...decisionReview.invalidCandidateIds.map((id) => `INVALID_CANDIDATE:${id}`)
      ]);
      if (hardDecisionIssues.length === 0 && decisionReview.status === "PASS") break;
      const candidateIds = new Set(decisions.map((decision) => decision.id));
      const hardRejectedIds = hardDecisionIssues
        .map((issue) => issue.includes(":") ? issue.slice(issue.indexOf(":") + 1) : "")
        .filter((id) => candidateIds.has(id));
      const unscopedHardIssues = hardDecisionIssues.filter((issue) => {
        if (!issue.includes(":")) return true;
        return !candidateIds.has(issue.slice(issue.indexOf(":") + 1));
      });
      const verifierNamedItsFailures = decisionReview.status === "PASS" || decisionReview.invalidCandidateIds.length > 0;
      const rejectedIds = new Set([...hardRejectedIds, ...decisionReview.invalidCandidateIds]);
      const verifiedSurvivors = decisions.filter((decision) => !rejectedIds.has(decision.id));
      const minimumSurvivors = 2;
      if (unscopedHardIssues.length === 0 && verifierNamedItsFailures && verifiedSurvivors.length >= minimumSurvivors) {
        decisions = verifiedSurvivors;
        decisionReview = { status: "PASS", issueCodes: [], invalidCandidateIds: [], rewriteInstructions: [] };
        break;
      }
      decisionFeedback = unique([
        ...decisionFeedback,
        ...decisionIssueCodes,
        ...buildDecisionRepairFeedback(decisions, input.context, hardDecisionIssues),
        ...decisionReview.invalidCandidateIds,
        ...decisionReview.rewriteInstructions
      ]);
      decisions = null;
      decisionReview = null;
    }
    if (!decisions || !decisionReview) {
      throw new StoryGenerationErrorV2("DECISIONS_REJECTED", "Generated decisions failed the publication quality gate", records, decisionIssueCodes);
    }
    await this.assertCurrentContext(input, records);

    return { plan: planner, narrative, narrativeReview, decisions, decisionReview, finalStoryTextHash, promptExecutions: records };
  }

  private remoteSemanticReviewEnabled(): boolean {
    if (typeof this.options.remoteSemanticReview === "boolean") return this.options.remoteSemanticReview;
    return /^(?:1|true|yes|on)$/i.test(String(process.env.STORY_PIPELINE_REMOTE_SEMANTIC_REVIEW || ""));
  }

  private recordLocalStep<T>(config: {
    input: GenerateStoryPipelineInputV2;
    records: PromptExecutionRecordV2[];
    attempt: number;
    step: Exclude<StoryPipelineStepV2, "AGENT_DECIDER">;
    systemPrompt: string;
    userPrompt: string;
    output: T;
    metadata: Record<string, string | number | boolean>;
    issueCodes: string[];
  }): void {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const rawOutput = JSON.stringify(config.output);
    const finished = Date.now();
    config.records.push(buildExecutionRecord({
      input: config.input,
      attempt: config.attempt,
      step: config.step,
      systemPrompt: config.systemPrompt,
      userPrompt: config.userPrompt,
      metadata: config.metadata,
      response: {
        content: rawOutput,
        provider: "deterministic-local",
        modelName: config.step === "PLANNER" ? "context-planner-v2.3" : "story-hard-gate-v2.3"
      },
      started,
      startedAt,
      finished,
      status: "SUCCESS",
      issueCodes: config.issueCodes
    }));
  }

  private async executeJsonStep<T>(
    config: {
      input: GenerateStoryPipelineInputV2;
      records: PromptExecutionRecordV2[];
      attempt: number;
      step: Exclude<StoryPipelineStepV2, "AGENT_DECIDER">;
      systemPrompt: string;
      userPrompt: string;
      temperature: number;
      metadata: Record<string, string | number | boolean>;
    },
    parser: (value: unknown) => T
  ): Promise<T> {
    const maxStepAttempts = normalizeStepAttempts(config.input.maxStepAttempts);
    let lastError: unknown = null;
    for (let localAttempt = 0; localAttempt < maxStepAttempts; localAttempt += 1) {
      const started = Date.now();
      const startedAt = new Date(started).toISOString();
      let response: StoryModelResponseV2 | null = null;
      try {
        response = await this.modelClient.generate({
          step: config.step,
          systemPrompt: config.systemPrompt,
          userPrompt: config.userPrompt,
          responseFormat: "json_object",
          temperature: config.temperature
        });
        const parsed = parser(parseJsonObject(response.content));
        const finished = Date.now();
        config.records.push(buildExecutionRecord({ ...config, attempt: config.attempt + localAttempt, response, started, startedAt, finished, status: "SUCCESS", issueCodes: [] }));
        return parsed;
      } catch (error) {
        lastError = error;
        const finished = Date.now();
        const issueCode = error instanceof InvalidModelOutputError ? "INVALID_MODEL_OUTPUT" : "MODEL_CALL_FAILED";
        config.records.push(buildExecutionRecord({ ...config, attempt: config.attempt + localAttempt, response, started, startedAt, finished, status: "FAILED", issueCodes: [issueCode] }));
        if (error instanceof StoryGenerationErrorV2) throw error;
      }
    }
    const issueCode = lastError instanceof InvalidModelOutputError ? "INVALID_MODEL_OUTPUT" : "MODEL_CALL_FAILED";
    throw new StoryGenerationErrorV2(
      issueCode,
      lastError instanceof Error ? lastError.message : String(lastError),
      config.records,
      [issueCode]
    );
  }

  private async assertCurrentContext(input: GenerateStoryPipelineInputV2, records: PromptExecutionRecordV2[]) {
    if (!input.getCurrentIdentity) return;
    const freshness = validateStoryContextFreshnessV2(input.context, await input.getCurrentIdentity());
    if (freshness.status === "CURRENT") return;
    const last = records.at(-1);
    if (last) {
      last.status = "SUPERSEDED";
      last.supersededReason = freshness.reasons.join(",");
      last.issueCodes = unique([...last.issueCodes, "CONTEXT_SUPERSEDED"]);
    }
    throw new StoryGenerationErrorV2(
      "CONTEXT_SUPERSEDED",
      "Story context changed before publication",
      records,
      freshness.reasons
    );
  }
}

type DecisionDraftV2 = {
  id: string;
  label: string;
  description: string;
  objective: string;
  target: PlayerIntentV2["target"];
  method: string;
  leverageKeys: string[];
  visibility: PlayerIntentV2["visibility"];
  riskTolerance: PlayerIntentV2["riskTolerance"];
  concreteCost: string;
  expectedCountermove: string;
};

function buildPlannerUserPrompt(context: StoryContextSnapshotV2): string {
  return [
    `<context_snapshot hash="${context.identity.snapshotHash}" world_sequence="${context.identity.worldSequence}" role_id="${context.identity.roleId}">`,
    context.renderedWorkingSet,
    "</context_snapshot>",
    "只规划从当前末态向前推进的一个完整故事节拍。"
  ].join("\n\n");
}

function buildLocalStoryPlan(context: StoryContextSnapshotV2): StoryPlanV2 {
  const playerIntent = itemText(context, ["PLAYER_INTENT"]);
  const compactIntent = compactPlayerIntentForNarrative(playerIntent);
  const currentSceneMetadata = context.items.find((item) => item.sourceType === "CURRENT_SCENE");
  const currentSceneItem = context.items.find((item) => item.sourceType === "RECENT_CANON")
    || currentSceneMetadata;
  const currentScene = currentSceneItem?.content || "";
  const immediateInteractionPressure = itemText(context, ["UNANSWERED_INTERACTION"]);
  const groundedContinuingPressure = itemText(context, ["DEADLINE", "UNANSWERED_INTERACTION"])
    || currentScene
    || itemText(context, ["ACTIVE_PRESSURE"]);
  const pressure = immediateInteractionPressure
    || (context.purpose === "OPENING"
      ? itemText(context, ["ACTIVE_PRESSURE", "OPEN_THREAD"])
      : groundedContinuingPressure)
    || "延续最近正文中已经出现、但尚未解决的眼前压力";
  const resolvedConsequences = itemContents(context, ["RULE_RESOLUTION", "INCOMING_IMPACT"]);
  const confirmed = resolvedConsequences.length
    ? resolvedConsequences
    : compactIntent
      ? [`玩家已经作出的行动必须被完整执行：${clipForPlan(compactIntent, 160)}`]
      : [];
  const actionEcho = compactIntent || (context.purpose === "OPENING"
    ? `把已经确认的矛盾与催促送到${context.audience.roleName}眼前，停在外厅再次催问而他仍未回答的时刻`
    : `把刚进入${context.audience.roleName}视野的影响写成可观察的事件`);
  const confirmedConsequences = (confirmed.length ? confirmed : [context.purpose === "OPENING" ? pressure : currentScene || pressure || actionEcho])
    .map((value) => clipForPlan(value, 220))
    .filter(Boolean)
    .slice(0, 2);
  const beats = context.purpose === "OPENING"
    ? [
        "从开场种子的当前地点开始，只把上下文已有矛盾变成浙江总督亲眼可见、亲耳可闻的场景",
        `让外部人物或既有文书把压力送到案前，但不替浙江总督下令或回答：${clipForPlan(pressure, 180)}`,
        "外厅差役再次催问，浙江总督仍未回话、未下令，故事就在这个动作上停住"
      ]
    : unique([
        "从最近完整正文的最后一句继续，不复述、不跳转到尚未进入眼前的宏观阶段",
        `只执行玩家本轮已经选择的行动，并写出可观察后果：${clipForPlan(actionEcho, 200)}`,
        `只延续最近正文或上下文已经确认的压力，不得另造公文、来人、命令或期限；停在浙江总督尚未回应的那一刻：${clipForPlan(pressure, 220)}`
      ]).filter(Boolean).slice(0, 3);
  const continuityItems = context.items.filter((item) => item.priority === "P0" || [
    "CURRENT_SCENE",
    "RECENT_CANON",
    "COMMITMENT",
    "DEADLINE",
    "ASSET_OR_EVIDENCE",
    "ACTIVE_CONDITION",
    "UNANSWERED_INTERACTION"
  ].includes(item.sourceType));
  const continuityAnchors = unique(continuityItems.map((item) => item.itemId)).slice(0, 6);
  if (!continuityAnchors.length && context.items[0]) continuityAnchors.push(context.items[0].itemId);
  const reactionItems = context.items.filter((item) => ["UNANSWERED_INTERACTION", "INCOMING_IMPACT", "RELATIONSHIP"].includes(item.sourceType));

  return {
    sceneGoal: clipForPlan(`让“${actionEcho}”在当前场景中产生真实后果，不跳到别的宏观议题`, 180),
    actionEcho: clipForPlan(actionEcho, 220),
    beats: beats.length >= 2 ? beats : [actionEcho, pressure || currentScene || "推进到下一个具体压力"],
    characterReactions: reactionItems.slice(0, 3).map((item) => ({
      actor: clipForPlan(item.title, 60),
      observableReaction: `只能依据这条已授权信息写可观察反应：${clipForPlan(item.content, 160)}`
    })),
    confirmedConsequences,
    secretsToWithhold: unique([...context.audience.cannotDo, ...context.audience.knowledgeBoundary.filter((entry) => /不知|不能|不得|只/.test(entry))]).slice(0, 6),
    continuityAnchors,
    resultEnding: context.purpose === "OPENING" ? "外厅差役再次催问，浙江总督仍未回话，也未下令" : "玩家所选行动已有可观察结果，但不得顺手替浙江总督再下第二道命令",
    nextPressure: clipForPlan(pressure || "延续最近正文中已经出现且尚未解决的压力", 220)
  };
}
function localNarrativeReview(
  narrative: StoryNarrativeDraftV2,
  hardIssues: string[],
  context: StoryContextSnapshotV2
): NarrativeVerifierResultV2 {
  const issueCodes = [...hardIssues];
  const missingAnchors: string[] = [];
  const knownAnchors = new Set(context.items.flatMap((item) => [item.itemId, item.title]));
  const isKnownAnchor = (anchor: string) => knownAnchors.has(anchor)
    || context.items.some((item) => item.itemId.endsWith(`:${anchor}`));
  if (!narrative.usedAnchorIds.length) {
    issueCodes.push("NARRATIVE_CONTINUITY_ANCHOR_MISSING");
    missingAnchors.push("至少延续一个当前上下文锚点");
  } else {
    for (const anchor of narrative.usedAnchorIds) {
      if (!isKnownAnchor(anchor)) missingAnchors.push(anchor);
    }
    if (missingAnchors.length) issueCodes.push("NARRATIVE_UNKNOWN_CONTINUITY_ANCHOR");
  }
  if (!narrative.endingState.time || !narrative.endingState.location || !narrative.endingState.unresolvedPressure) {
    issueCodes.push("NARRATIVE_ENDING_STATE_INCOMPLETE");
  }
  if (!narrative.endingState.presentEntities.length) issueCodes.push("NARRATIVE_PRESENT_ENTITIES_MISSING");
  const normalizedIssues = unique(issueCodes);
  return {
    status: normalizedIssues.length ? "FAIL" : "PASS",
    issueCodes: normalizedIssues,
    unsupportedClaims: [],
    leakedFacts: normalizedIssues.filter((issue) => issue.includes("LEAKED")),
    missingAnchors,
    rewriteInstructions: normalizedIssues
  };
}

function localDecisionReview(hardIssues: string[]): DecisionVerifierResultV2 {
  const issueCodes = unique(hardIssues);
  const invalidCandidateIds = unique(issueCodes
    .map((issue) => issue.includes(":") ? issue.slice(issue.indexOf(":") + 1) : "")
    .filter(Boolean));
  return {
    status: issueCodes.length ? "FAIL" : "PASS",
    issueCodes,
    invalidCandidateIds,
    rewriteInstructions: issueCodes
  };
}

function itemContents(context: StoryContextSnapshotV2, sourceTypes: StoryContextIncludedItemV2["sourceType"][]): string[] {
  return context.items.filter((item) => sourceTypes.includes(item.sourceType)).map((item) => item.content.trim()).filter(Boolean);
}

function itemText(context: StoryContextSnapshotV2, sourceTypes: StoryContextIncludedItemV2["sourceType"][]): string {
  return itemContents(context, sourceTypes).join("\n");
}

function compactPlayerIntentForNarrative(value: string): string {
  const usefulLines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(?:目标|对象|方法)：/.test(line));
  return usefulLines.length ? usefulLines.slice(0, 3).join("；") : clipForPlan(value, 150);
}

function clipForPlan(value: string, maxChars: number): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

function buildWriterUserPrompt(
  context: StoryContextSnapshotV2,
  plan: StoryPlanV2,
  repairFeedback: string[] = [],
  finalTurn = false,
  rejectedDirections: string[] = []
): string {
  const playerIntent = context.items.filter((item) => item.sourceType === "PLAYER_INTENT").map((item) => item.content).join("\n");
  const prompt = [
    "# 当前角色与紧邻正文",
    renderCompactWriterContext(context),
    "# 本轮因果计划",
    JSON.stringify(plan)
  ];
  if (finalTurn) {
    prompt.push(
      "# 这是本角色的最终回合",
      "resultNarrative 先完整兑现玩家刚才选择的行动；nextSituationNarrative 必须写成自然的结局余波，交代浙江总督此刻留下了什么成果、代价和仍无法确认之处。不得再抛出新选择、不得要求玩家继续行动、不得复述任何写作规则或内部指令。"
    );
  } else {
    prompt.push(
      "# 正文完成后生成决策的角色边界",
      renderDecisionCapabilityContext(context, false),
      `# 上一轮已拒绝的方向\n${JSON.stringify(rejectedDirections)}`,
      "先完成并固定本轮正文，再只根据自己刚写出的 nextSituationNarrative 最后状态生成 2 至 4 个真实决策。正文中的既成行动不能再次成为选项。"
    );
  }
  if (repairFeedback.length) {
    prompt.push("# 上一稿必须修复的问题", JSON.stringify(repairFeedback));
  }
  if (playerIntent) {
    prompt.push(
      "# 下一局势的事实边界",
      "下一局势不是另开一宗新事件。除非上面的上下文逐字确认，否则不得新增来信、公文、命令、使者、回报、证据、期限或精确时间。没有确认的新外部事件时，就让最近正文里已经在场的人继续等待、催问或显露反应，让原有期限继续逼近；必须停在浙江总督尚未采取第二项行动的时刻。",
      "# 玩家刚刚作出的行动——本轮直接指令",
      playerIntent
    );
  } else {
    prompt.push(
      "# 本轮直接指令",
      context.purpose === "OPENING"
        ? "从开场种子的当前地点开始，把县册正副本数字不一致、巡抚差役在外厅催问、日落期限和县令密信只提供暗账线索这些已知事实写成浙江总督正在亲历的场景。两份县册只能沿用上下文给出的具体身份；严禁另写仁和县、钱塘县或任何上下文没有的府县名称。只能使用上下文逐字存在的人物、地点、文书类别和事实；不得新增具名府县乡镇、公文标题、外部案件、死伤或民变。不要写浙江总督已经反复比对、重新核对、合上又翻开或查看了多少行页；只写两份县册已经在案上且数字不一致。绝不能补写差额、比例、亩数、行页、等待了几个时辰或任何新的精确与模糊数量。不得添加茶盏、钥匙等装饰道具。浙江总督可以阅读、观察和迟疑，但不得替他传人、批复、派查、密奏或作出第一项实质决定。nextSituationNarrative 只让外厅差役再次催问，并停在浙江总督仍未回话、未下令的动作上；任何句子都不得出现“决定、选择、是……还是……、可以先……或……”或列出候选方向，选项由正文通过后另行生成。不得写成背景摘要。"
        : "把刚进入本角色视野的影响写成连续故事，不得替本角色或其他角色作下一决定。"
    );
  }
  return prompt.join("\n\n");
}

function renderCompactWriterContext(context: StoryContextSnapshotV2): string {
  const selected: StoryContextIncludedItemV2[] = [];
  const seen = new Set<string>();
  const add = (items: StoryContextIncludedItemV2[], limit = items.length) => {
    for (const item of items) {
      const key = `${item.sourceType}:${item.content.replace(/\s+/g, " ").trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push(item);
      if (--limit <= 0) break;
    }
  };
  const byType = (type: StoryContextIncludedItemV2["sourceType"]) => context.items.filter((item) => item.sourceType === type);

  const recentCanon = byType("RECENT_CANON");
  add(recentCanon.length ? recentCanon : byType("CURRENT_SCENE"), 1);
  add(byType("RULE_RESOLUTION"), 1);
  add(byType("INCOMING_IMPACT"), 2);
  add(byType("ACTIVE_PRESSURE"), 1);
  add(byType("DEADLINE"), 1);
  add(byType("UNANSWERED_INTERACTION"), 2);
  add(byType("COMMITMENT"), 2);
  add(byType("VISIBLE_FACT").filter((item) => item.priority === "P0"), context.purpose === "OPENING" ? 4 : 2);
  add(byType("WORLD_BIBLE"), 1);

  return [
    `角色：${context.audience.roleName}（${context.audience.publicIdentity}）`,
    `权限：${context.audience.authority.join("；")}`,
    `不可越过：${context.audience.cannotDo.join("；")}`,
    `已知边界：${context.audience.knowledgeBoundary.join("；")}`,
    renderItems(selected)
  ].join("\n");
}
function buildNarrativeVerifierUserPrompt(
  context: StoryContextSnapshotV2,
  plan: StoryPlanV2,
  narrative: StoryNarrativeDraftV2,
  hardIssues: string[]
): string {
  return [
    `<context_snapshot hash="${context.identity.snapshotHash}">`,
    context.renderedWorkingSet,
    "</context_snapshot>",
    "# Story Plan",
    JSON.stringify(plan),
    "# Candidate Narrative",
    JSON.stringify(narrative),
    "# Deterministic Hard-Rule Findings",
    JSON.stringify(hardIssues)
  ].join("\n\n");
}

function buildDecisionDesignerUserPrompt(context: StoryContextSnapshotV2, finalStory: string, rejectedDirections: string[], repairFeedback: string[] = []): string {
  return [
    `# Actor Boundary\n${renderDecisionCapabilityContext(context)}`,
    `# Previously Rejected Directions\n${JSON.stringify(rejectedDirections)}`,
    ...(repairFeedback.length ? [`# Mandatory Repair Findings From The Previous Decision Set\n${JSON.stringify(repairFeedback)}`] : []),
    ...(context.purpose === "OPENING" ? [`# 本轮是浙江总督的开场决策
只给出此刻能够下达的一道命令或写出的一份回文，不得把查明、回文、封存、传唤两件事绑在同一项里。
角色目前只有案上两份县册、巡抚催办公文、锁在小匣里的县令密信和一条尚未证实的暗账线索；不得编造鱼鳞册、原始田契、田契档房、书办、亲信或任何已经到手的新物证。
不得把暗账一定存在、县令会销毁暗账、巡抚正在阻挠写成事实；只能把它们写成风险或待核实的怀疑。
三个 label 都必须是现代玩家一眼能复述的单一行动句。可让三项分别体现如实回应眼前催问、暂缓并处理手头文书、向上下文已有角色发出调查要求等不同取舍，但必须从最终正文末态重新生成，不能照抄这句话。`] : []),
    `# Final Verified Story\n<final_next_situation hash="${hashStoryTextV2(finalStory)}">\n${finalStory}`
  ].join("\n\n");
}

function renderDecisionCapabilityContext(context: StoryContextSnapshotV2, includeLegacyAffordance = true): string {
  const capabilityItems: StoryContextIncludedItemV2[] = [];
  const add = (sourceType: StoryContextIncludedItemV2["sourceType"], limit: number) => {
    capabilityItems.push(...context.items.filter((item) => item.sourceType === sourceType).slice(0, limit));
  };
  add("ROLE_AUTHORITY", 1);
  add("KNOWLEDGE_BOUNDARY", 1);
  if (includeLegacyAffordance) add("ACTION_AFFORDANCE", 1);
  add("ASSET_OR_EVIDENCE", 5);
  add("COMMITMENT", 2);
  add("DEADLINE", 1);
  add("ACTIVE_CONDITION", 2);
  add("UNANSWERED_INTERACTION", 1);
  return renderItems(capabilityItems);
}
function buildDecisionVerifierUserPrompt(
  context: StoryContextSnapshotV2,
  finalStory: string,
  decisions: DecisionCandidateV2[],
  hardIssues: string[]
): string {
  return [
    `<context_snapshot hash="${context.identity.snapshotHash}">`,
    renderItemsForPrompt(context, ["RECENT_CANON", "PLAYER_INTENT", "ARC_GUIDANCE"]),
    "</context_snapshot>",
    `# Final Verified Story\n<final_next_situation hash="${hashStoryTextV2(finalStory)}">\n${finalStory}\n</final_next_situation>`,
    `# Candidate Decisions\n${JSON.stringify(decisions)}`,
    `# Deterministic Hard-Rule Findings\n${JSON.stringify(hardIssues)}`
  ].join("\n\n");
}

function renderItemsForPrompt(context: StoryContextSnapshotV2, excluded: StoryContextIncludedItemV2["sourceType"][]): string {
  return [
    `角色：${context.audience.roleName}（${context.audience.publicIdentity}）`,
    `权限：${context.audience.authority.join("；")}`,
    `禁止越过：${context.audience.cannotDo.join("；")}`,
    `知识边界：${context.audience.knowledgeBoundary.join("；")}`,
    renderItems(context.items.filter((item) => !excluded.includes(item.sourceType)))
  ].join("\n");
}

function renderItems(items: StoryContextIncludedItemV2[]): string {
  return items.map((item) => `## ${item.title}\n${item.content}`).join("\n\n");
}

function parseStoryPlan(value: unknown): StoryPlanV2 {
  const object = record(value, "StoryPlanV2");
  return {
    sceneGoal: requiredText(object.sceneGoal, "sceneGoal"),
    actionEcho: requiredText(object.actionEcho, "actionEcho"),
    beats: textArray(object.beats, "beats", 2),
    characterReactions: objectArray(object.characterReactions, "characterReactions").map((entry) => ({
      actor: requiredText(entry.actor, "characterReactions.actor"),
      observableReaction: requiredText(entry.observableReaction, "characterReactions.observableReaction")
    })),
    confirmedConsequences: textArray(object.confirmedConsequences, "confirmedConsequences", 1),
    secretsToWithhold: textArray(object.secretsToWithhold, "secretsToWithhold", 0),
    continuityAnchors: textArray(object.continuityAnchors, "continuityAnchors", 1),
    resultEnding: requiredText(object.resultEnding, "resultEnding"),
    nextPressure: requiredText(object.nextPressure, "nextPressure")
  };
}

function parseNarrativeDraft(value: unknown): StoryNarrativeDraftV2 {
  const object = record(value, "StoryNarrativeDraftV2");
  const ending = record(object.endingState, "endingState");
  return {
    resultNarrative: requiredText(object.resultNarrative, "resultNarrative"),
    nextSituationNarrative: requiredText(object.nextSituationNarrative, "nextSituationNarrative"),
    endingState: {
      time: requiredText(ending.time, "endingState.time"),
      location: requiredText(ending.location, "endingState.location"),
      presentEntities: textArray(ending.presentEntities, "endingState.presentEntities", 1),
      unresolvedPressure: requiredText(ending.unresolvedPressure, "endingState.unresolvedPressure")
    },
    usedAnchorIds: textArray(object.usedAnchorIds, "usedAnchorIds", 1)
  };
}

function parseStoryTurnDraft(value: unknown): { narrative: StoryNarrativeDraftV2; decisionDrafts: DecisionDraftV2[] | null } {
  const object = record(value, "StoryTurnDraftV2");
  const decisionDrafts = Array.isArray(object.decisions) && object.decisions.length > 0
    ? parseDecisionDrafts(object)
    : null;
  return { narrative: parseNarrativeDraft(object), decisionDrafts };
}

function parseNarrativeReview(value: unknown): NarrativeVerifierResultV2 {
  const object = record(value, "NarrativeVerifierResultV2");
  const status = object.status === "PASS" || object.status === "FAIL" ? object.status : invalid("narrative status");
  return {
    status,
    issueCodes: textArray(object.issueCodes, "issueCodes", 0),
    unsupportedClaims: textArray(object.unsupportedClaims, "unsupportedClaims", 0),
    leakedFacts: textArray(object.leakedFacts, "leakedFacts", 0),
    missingAnchors: textArray(object.missingAnchors, "missingAnchors", 0),
    rewriteInstructions: textArray(object.rewriteInstructions, "rewriteInstructions", 0)
  };
}

function parseDecisionDrafts(value: unknown): DecisionDraftV2[] {
  const object = record(value, "DecisionSetDraftV2");
  const decisions = objectArray(object.decisions, "decisions");
  if (decisions.length < 2 || decisions.length > 4) invalid("decisions must contain 2 to 4 items");
  return decisions.map((entry, index) => {
    const target = record(entry.target, `decisions[${index}].target`);
    const targetType = requiredText(target.type, `decisions[${index}].target.type`) as PlayerIntentV2["target"]["type"];
    if (!["ROLE", "PERSON", "EVIDENCE", "RESOURCE", "LOCATION", "INSTITUTION", "PUBLIC_FRAME"].includes(targetType)) invalid("invalid target type");
    const visibility = requiredText(entry.visibility, `decisions[${index}].visibility`) as PlayerIntentV2["visibility"];
    if (!["PRIVATE", "LIMITED", "OBSERVABLE", "PUBLIC"].includes(visibility)) invalid("invalid visibility");
    const riskTolerance = requiredText(entry.riskTolerance, `decisions[${index}].riskTolerance`) as PlayerIntentV2["riskTolerance"];
    if (!["LOW", "MEDIUM", "HIGH"].includes(riskTolerance)) invalid("invalid risk tolerance");
    return {
      id: requiredText(entry.id, `decisions[${index}].id`),
      label: requiredText(entry.label, `decisions[${index}].label`),
      description: requiredText(entry.description, `decisions[${index}].description`),
      objective: requiredText(entry.objective, `decisions[${index}].objective`),
      target: { type: targetType, id: requiredText(target.id, "target.id"), label: requiredText(target.label, "target.label") },
      method: requiredText(entry.method, `decisions[${index}].method`),
      leverageKeys: textArray(entry.leverageKeys, "leverageKeys", 0),
      visibility,
      riskTolerance,
      concreteCost: requiredText(entry.concreteCost, "concreteCost"),
      expectedCountermove: requiredText(entry.expectedCountermove, "expectedCountermove")
    };
  });
}

function parseDecisionReview(value: unknown): DecisionVerifierResultV2 {
  const object = record(value, "DecisionVerifierResultV2");
  const status = object.status === "PASS" || object.status === "FAIL" ? object.status : invalid("decision status");
  return {
    status,
    issueCodes: textArray(object.issueCodes, "issueCodes", 0),
    invalidCandidateIds: textArray(object.invalidCandidateIds, "invalidCandidateIds", 0),
    rewriteInstructions: textArray(object.rewriteInstructions, "rewriteInstructions", 0)
  };
}

function toDecisionCandidate(draft: DecisionDraftV2, context: StoryContextSnapshotV2): DecisionCandidateV2 {
  const normalizedTarget = draft.target.type === "ROLE"
    ? draft.target
    : {
        ...draft.target,
        id: `${draft.target.type.toLowerCase()}:${hashStoryTextV2(draft.target.label).slice(0, 16)}`
      };
  const intentDraft: PlayerIntentV2 = {
    objective: draft.objective,
    target: normalizedTarget,
    method: draft.method,
    leverageKeys: draft.leverageKeys,
    visibility: draft.visibility,
    riskTolerance: draft.riskTolerance,
    fallback: null,
    condition: null,
    freeText: draft.description
  };
  return {
    id: draft.id,
    actionKey: null,
    label: draft.label,
    description: draft.description,
    intent: `${draft.objective}；${draft.method}`,
    targetRoleId: normalizedTarget.type === "ROLE" ? normalizedTarget.id : null,
    targetRoleName: normalizedTarget.type === "ROLE" ? normalizedTarget.label : null,
    risk: draft.riskTolerance === "LOW" ? "LOW" : draft.riskTolerance === "HIGH" ? "HIGH" : "NORMAL",
    basisFactKeys: [],
    requiredAssetKeys: draft.leverageKeys,
    authorityBasis: context.audience.authority.join("；") || `${context.audience.roleName}只能在当前身份权限内执行`,
    intendedOutcome: draft.objective,
    concreteCost: draft.concreteCost,
    expectedCountermove: draft.expectedCountermove,
    visibility: draft.visibility,
    effectHooks: [draft.objective],
    intentDraft
  };
}
function sanitizeNarrativeDraft(narrative: StoryNarrativeDraftV2, context: StoryContextSnapshotV2): StoryNarrativeDraftV2 {
  const specificityCorpus = buildAllowedSpecificityCorpus(context);
  const allowedNameCorpus = buildAllowedNameCorpus(context);
  const narrativeDerivedCorpus = context.items
    .filter((item) => ["RECENT_CANON", "CURRENT_SCENE", "PLAYER_INTENT", "RULE_RESOLUTION", "INCOMING_IMPACT"].includes(item.sourceType))
    .map((item) => item.content)
    .join("\n");
  const rawDraftCorpus = [
    narrative.resultNarrative,
    narrative.nextSituationNarrative,
    narrative.endingState.time,
    ...narrative.endingState.presentEntities,
    narrative.endingState.unresolvedPressure
  ].join("\n");
  const identityCorpus = `${rawDraftCorpus}\n${narrativeDerivedCorpus}`;
  const unsupportedNames = collectUnsupportedNamedCharacters(identityCorpus, allowedNameCorpus);
  const clarifyEvidencePossession = (value: string) => contextDeniesPhysicalLedgerEvidence(context)
    ? value
        .replace(/(?:手中|手里)(?:仍|尚|并)?(?:没有|无)(?:任何)?实物(?:凭证)?/g, "手中仍没有暗账、抄件或田契实物")
        .replace(/暗账线索但(?:仍|尚|并)?无实物/g, "暗账线索但尚无暗账、抄件或田契实物")
    : value;
  const cleanSpecificity = (value: string) => clarifyEvidencePossession(removeUnsupportedSpecificity(
    clarifyAnonymousIdentities(replaceUnsupportedNamedCharacters(value, unsupportedNames), identityCorpus),
    specificityCorpus,
    allowedNameCorpus
  ));
  const clean = (value: string) => ensureNarrativeParagraphs(cleanSpecificity(value));
  const cleanNextSituation = (value: string) => ensureNarrativeParagraphs(
    stripEmbeddedDecisionMenu(cleanSpecificity(value))
  );
  return {
    ...narrative,
    resultNarrative: clean(narrative.resultNarrative),
    nextSituationNarrative: cleanNextSituation(narrative.nextSituationNarrative),
    endingState: {
      time: sanitizeEndingTime(narrative.endingState.time, specificityCorpus, rawDraftCorpus),
      location: narrative.endingState.location,
      presentEntities: narrative.endingState.presentEntities.map(cleanSpecificity),
      unresolvedPressure: cleanSpecificity(narrative.endingState.unresolvedPressure)
    }
  };
}

const COMMON_CHINESE_SURNAMES = "赵钱孙李周吴郑王冯陈沈韩杨朱刘张何吕徐马郭林梁宋谢许邓曹彭曾萧田董袁潘于蒋蔡余杜叶程苏魏丁任姚崔钟谭陆汪范金石廖贾夏韦傅方白邹孟熊秦邱江尹薛阎雷侯龙史陶黎贺顾毛郝龚邵万覃武戴严莫孔向汤";
const SUPPORTING_NPC_ROLES = "亲信差役|贴身长随|长随|差役|师爷|老翁|老汉|头儿|邻居|掌柜|幕僚|会首|乡绅|书吏|书办|亲兵|眼线|管事|证人|当事人|办事人|涉事人";

type UnsupportedNamedCharacter = {
  name: string;
  fullText: string;
  fullReplacement: string;
  bareReplacement: string;
};

function buildAllowedSpecificityCorpus(context: StoryContextSnapshotV2): string {
  const groundedTypes: StoryContextIncludedItemV2["sourceType"][] = [
    "CURRENT_SCENE",
    "RECENT_CANON",
    "PLAYER_INTENT",
    "RULE_RESOLUTION",
    "WORLD_BIBLE",
    "KNOWLEDGE_BOUNDARY",
    "ACTIVE_PRESSURE",
    "ASSET_OR_EVIDENCE",
    "VISIBLE_FACT"
  ];
  return context.items.filter((item) => groundedTypes.includes(item.sourceType)).map((item) => item.content).join("\n");
}

function buildAllowedNameCorpus(context: StoryContextSnapshotV2): string {
  const authorizedTypes: StoryContextIncludedItemV2["sourceType"][] = [
    "ROLE_IDENTITY",
    "WORLD_BIBLE",
    "ACTION_AFFORDANCE",
    "RELATIONSHIP"
  ];
  return [
    context.audience.roleName,
    context.audience.publicIdentity,
    ...context.items.filter((item) => authorizedTypes.includes(item.sourceType)).flatMap((item) => [item.title, item.content])
  ].join("\n");
}

function naturalAnonymousRole(role: string): string {
  if (/邻居|老翁|老汉/.test(role)) return "那位邻居";
  if (role === "头儿") return "那名差役";
  if (role === "亲信差役") return "总督亲信差役";
  if (role === "贴身长随") return "总督贴身长随";
  if (role === "证人") return "关键证人";
  if (role === "账册持有人") return "账册持有人";
  return `那名${role}`;
}

function collectUnsupportedNamedCharacters(text: string, allowedNameCorpus: string): UnsupportedNamedCharacter[] {
  const collected: UnsupportedNamedCharacter[] = [];
  const add = (fullText: string, role: string, name: string, fullReplacement: string) => {
    const obviousNonPerson = /(?:册|簿|印|函|文|帖|令|房|府|县|州|局|账|银|粮|船|田|契|钥匙)$/.test(name);
    if (!name || name.endsWith("的") || obviousNonPerson || allowedNameCorpus.includes(name)) return;
    collected.push({ name, fullText, fullReplacement, bareReplacement: naturalAnonymousRole(role) });
  };
  const roleThenSurname = new RegExp(`(?:那|这)?(?:名|位)?(${SUPPORTING_NPC_ROLES})姓([${COMMON_CHINESE_SURNAMES}])`, "gu");
  for (const match of text.matchAll(roleThenSurname)) add(match[0], match[1], `姓${match[2]}`, naturalAnonymousRole(match[1]));
  const surnameThenRole = new RegExp(`姓([${COMMON_CHINESE_SURNAMES}])的?(${SUPPORTING_NPC_ROLES})`, "gu");
  for (const match of text.matchAll(surnameThenRole)) add(match[0], match[2], `姓${match[1]}`, naturalAnonymousRole(match[2]));
  const surnameFirst = new RegExp(`一名姓([${COMMON_CHINESE_SURNAMES}])的?(${SUPPORTING_NPC_ROLES})`, "gu");
  for (const match of text.matchAll(surnameFirst)) add(match[0], match[2], `姓${match[1]}`, naturalAnonymousRole(match[2]));
  const roleFirst = new RegExp(`(${SUPPORTING_NPC_ROLES})(?:名叫|叫)?([${COMMON_CHINESE_SURNAMES}][\\p{Script=Han}]{1,2})`, "gu");
  for (const match of text.matchAll(roleFirst)) add(match[0], match[1], match[2], match[1]);
  const nameFirst = new RegExp(`([${COMMON_CHINESE_SURNAMES}][\\p{Script=Han}]{0,2})(?:的)?(${SUPPORTING_NPC_ROLES})`, "gu");
  for (const match of text.matchAll(nameFirst)) add(match[0], match[2], match[1], naturalAnonymousRole(match[2]));
  const bareNameWithStoryCue = new RegExp(`([${COMMON_CHINESE_SURNAMES}][\\p{Script=Han}]{1,2})(?=(的(?:证词|口供|账册|禀帖|住处|家中|纸条|去向)|被|已经|已|尚未|仍|退下|进门|回来|说道|答道|点头|摇头|可能))`, "gu");
  for (const match of text.matchAll(bareNameWithStoryCue)) {
    const cue = match[2];
    const surroundings = text.slice(Math.max(0, (match.index ?? 0) - 50), (match.index ?? 0) + match[1].length + 50);
    const role = /退下|进门|回来|说道|答道/.test(cue)
      ? "差役"
      : /证词|口供|证人|保护/.test(`${cue}${surroundings}`)
        ? "证人"
        : /账册|禀帖/.test(`${cue}${surroundings}`)
          ? "账册持有人"
          : /尚未/.test(cue)
            ? "办事人"
            : "当事人";
    add(match[1], role, match[1], naturalAnonymousRole(role));
  }
  return collected.filter((entry, index, all) => all.findIndex((candidate) => candidate.fullText === entry.fullText && candidate.name === entry.name) === index);
}

function replaceUnsupportedNamedCharacters(text: string, replacements: UnsupportedNamedCharacter[]): string {
  let output = text;
  for (const entry of [...replacements]
    .filter((candidate) => candidate.fullText !== candidate.name)
    .sort((left, right) => right.fullText.length - left.fullText.length)) {
    output = output.split(entry.fullText).join(entry.fullReplacement);
  }
  const byName = new Map<string, string>();
  const preferredReplacements = [...replacements].sort((left, right) => Number(right.fullText !== right.name) - Number(left.fullText !== left.name));
  for (const entry of preferredReplacements) if (!byName.has(entry.name)) byName.set(entry.name, entry.bareReplacement);
  for (const [name, replacement] of [...byName.entries()].sort((left, right) => right[0].length - left[0].length)) {
    output = output.split(name).join(replacement);
  }
  return output
    .replace(/那名差役差役/g, "那名差役")
    .replace(/那位邻居邻居/g, "那位邻居")
    .replace(/那名([\p{Script=Han}]{1,8})\1/gu, "那名$1");
}

function clarifyAnonymousIdentities(text: string, identityCorpus: string): string {
  let output = text;
  if (/证人|口供|保护/.test(identityCorpus)) output = output.replace(/那名当事人/g, "关键证人");
  if (/账册|禀帖/.test(identityCorpus)) output = output.replace(/那名涉事人/g, "账册持有人");
  return output;
}

function removeUnsupportedSpecificity(text: string, contextCorpus: string, allowedNameCorpus: string): string {
  let output = replaceUnsupportedNamedCharacters(text, collectUnsupportedNamedCharacters(text, allowedNameCorpus));
  output = output.replace(/((?:已经|已|仍|又)?(?:等候|候|等))(?:了)?(?:\d+|[一二三四五六七八九十百千万两半余]+)(?:个)?时辰/g, (whole, verb: string) =>
    contextCorpus.includes(whole) ? whole : `${verb}了一阵`);
  const bareSurname = new RegExp(`(?:此人|那户人家)姓[${COMMON_CHINESE_SURNAMES}]`, "gu");
  output = output.replace(bareSurname, (whole) => allowedNameCorpus.includes(whole) ? whole : whole.startsWith("此人") ? "此人" : "那户邻居");
  output = output
    .replace(/显然已/g, "看起来很可能已")
    .replace(/显然是/g, "看起来像是")
    .replace(/第(?:二|两)日/g, (whole) => contextCorpus.includes(whole) ? whole : "次日")
    .replace(/第(?:三|四|五|六|七|八|九|十|\d+)日/g, (whole) => contextCorpus.includes(whole) ? whole : "数日后")
    .replace(/近(?:\d+|[一二三四五六七八九十百千万两半余]+)年/g, (whole) => contextCorpus.includes(whole) ? whole : "近年")
    .replace(/过去(?:\d+|[一二三四五六七八九十百千万两半余]+)年/g, (whole) => contextCorpus.includes(whole) ? whole : "过去几年");
  output = output
    .replace(/(?:至少|最快|尚需|还要)?(?:\d+|[一二三四五六七八九十百千万两半余]+)(?:个)?月/g, (whole) => contextCorpus.includes(whole) ? whole : "尚需时日")
    .replace(/第(?:\d+|[一二三四五六七八九十百千万两半余]+)(?:次|遍)/g, (whole) => contextCorpus.includes(whole) ? whole : "再次")
    .replace(/(?:\d+|[一二三四五六七八九十百千万两半余]+)百里加急/g, (whole) => contextCorpus.includes(whole) ? whole : "加急")
    .replace(/(?:直赴|送往|交给)?通政司(?:驻杭)?(?:密奏)?专差/g, (whole) => contextCorpus.includes("通政司") ? whole : "经既有密奏渠道递出")
    .replace(/从后衙角门出，?/g, (whole) => contextCorpus.includes("后衙角门") ? whole : "");
  const ordinalCounters = new Map<string, number>();
  output = output.replace(/第(?:\d+|[一二三四五六七八九十百千万两半余]+)(封|份|本|件)/g, (whole, unit: string) => {
    if (contextCorpus.includes(whole)) return whole;
    const seen = ordinalCounters.get(unit) || 0;
    ordinalCounters.set(unit, seen + 1);
    return seen === 0 ? `某${unit}` : "其余";
  });
  return output;
}
function sanitizeEndingTime(value: string, contextCorpus: string, narrativeCorpus: string): string {
  const cleaned = removeUnsupportedSpecificity(value, contextCorpus, contextCorpus);
  if (!introducedExactQuantities(cleaned, contextCorpus).length) return cleaned;
  if (/(?:清晨|破晓|天刚亮|晨光)/.test(narrativeCorpus)) return "当日清晨";
  if (/(?:午后|日影西斜|日头偏西|日落前|申时|未时)/.test(narrativeCorpus)) return "当日午后";
  if (/(?:入夜|当夜|夜色|掌灯|更鼓)/.test(narrativeCorpus)) return "当夜";
  return "当时";
}
function ensureNarrativeParagraphs(text: string): string {
  if (text.split(/\n\n+/).filter((paragraph) => paragraph.trim()).length >= 2) return text;
  const sentences = text.match(/[^。！？]+(?:[。！？](?:[”》】])?|$)/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
  if (sentences.length < 2) return text;
  const splitAt = Math.max(1, Math.ceil(sentences.length / 2));
  return `${sentences.slice(0, splitAt).join("")}\n\n${sentences.slice(splitAt).join("")}`;
}
function reviewNarrativeHardRules(narrative: StoryNarrativeDraftV2, context: StoryContextSnapshotV2): string[] {
  const issues: string[] = [];
  const allowedNameCorpus = buildAllowedNameCorpus(context);
  const allowedGroundingCorpus = context.items.flatMap((item) => [item.title, item.content]).join("\n");
  const resultMinimumLength = 80;
  const nextSituationMinimumLength = context.purpose === "OPENING" ? 80 : 60;
  const maximumLength = context.purpose === "OPENING" ? 420 : 900;
  for (const [field, text] of [["RESULT", narrative.resultNarrative], ["NEXT_SITUATION", narrative.nextSituationNarrative]] as const) {
    const minimumLength = field === "RESULT" ? resultMinimumLength : nextSituationMinimumLength;
    if (text.length < minimumLength) issues.push(`${field}_TOO_SHORT`);
    if (text.length > maximumLength) issues.push(`${field}_TOO_LONG`);
    if (text.split(/\n\n+/).filter((paragraph) => paragraph.trim()).length < 2) issues.push(`${field}_NOT_HUMAN_READABLE_PROSE`);
    if (!(context.purpose === "OPENING" && field === "NEXT_SITUATION") && !/(?:因此|于是|却|反而|迫使|让|使得|与此同时|由于|因而|故而|以致|从而|若|一旦|否则|但|既然|便|而)/.test(text)) {
      issues.push(`${field}_CAUSAL_LINK_MISSING`);
    }
    if (/(?:^|\n)\s*(?:[ABC]|[1-4])[.、)）]\s*/m.test(text) || /你要怎么做|请选择(?:你的)?决定/.test(text)) issues.push(`${field}_CONTAINS_MENU`);
    if (/\b(?:actionKey|factKey|effectKey|nextStateKey|worldSequence|deterministicSafetyDraft)\b/i.test(text)) issues.push(`${field}_LEAKED_ENGINE_TOKEN`);
    if (/(?:玩家|候选项|候选方向|选项)/.test(text)) issues.push(`${field}_LEAKED_PLAYER_INTERFACE`);
    if (endsWithTruncationMarker(text)) issues.push(`${field}_TRUNCATED_OR_ELLIPSIS`);
    if (/[。！？]{2,}/.test(text)) issues.push(`${field}_DUPLICATE_PUNCTUATION`);
    const contextCorpus = buildAllowedSpecificityCorpus(context);
    if (/玩家所选行动|不得顺手替|本轮直接指令|写作规则|内部指令/.test(text)) issues.push(`${field}_LEAKED_WRITING_INSTRUCTION`);
    if (/第(?:数|几|若干)(?:封|份|本|件|日)/.test(text)) issues.push(`${field}_MALFORMED_ORDINAL`);
    if (/(?:嘉靖|大明|明朝|明代)/.test(contextCorpus) && /满文/.test(text)) issues.push(`${field}_HISTORICAL_ANACHRONISM`);
    if (/(?:幕僚|差役|书吏|书办|长随|管事)[^。！？\n]{0,36}(?:执掌|任职|供职|掌管|从业)[^。！？\n]{0,20}(?:多年|数年|十余年|几十年)/.test(text)) {
      issues.push(`${field}_INTRODUCED_CHARACTER_BACKSTORY`);
    }
    if (introducedNamedCharacters(text, allowedNameCorpus).length) issues.push(`${field}_INTRODUCED_NAMED_CHARACTER`);
    if (introducedExactQuantities(text, contextCorpus).length) issues.push(`${field}_INTRODUCED_EXACT_QUANTITY`);
    if (introducedNamedLocationsOrDocuments(text, allowedGroundingCorpus).length) issues.push(`${field}_INTRODUCED_NAMED_LOCATION_OR_DOCUMENT`);
    if (contextDeniesPhysicalLedgerEvidence(context) && containsUnheldLedgerEvidence(text)) issues.push(`${field}_CONTRADICTS_EVIDENCE_POSSESSION`);
    if (containsMalformedPersonAsEvidence(text)) issues.push(`${field}_MALFORMED_PERSON_AS_EVIDENCE`);
    if (introducedUnsupportedProps(text, context).length) issues.push(`${field}_INTRODUCED_UNSUPPORTED_PROP`);
    if (containsUnsupportedCertainty(text, context)) issues.push(`${field}_UNSUPPORTED_CERTAINTY`);
    if (containsAmbiguousEvidenceDenial(text, context)) issues.push(`${field}_AMBIGUOUS_EVIDENCE_DENIAL`);
    if (containsLeakedAbstractPressure(text)) issues.push(`${field}_LEAKED_ABSTRACT_PRESSURE`);
    if (field === "NEXT_SITUATION" && containsUnchosenPlayerAction(text)) issues.push("NEXT_SITUATION_STEALS_PLAYER_DECISION");
    if (field === "NEXT_SITUATION" && containsEmbeddedDecisionMenu(text)) issues.push("NEXT_SITUATION_EMBEDS_DECISION_MENU");
    if (context.purpose === "OPENING" && containsUnchosenPlayerAction(text)) issues.push(`OPENING_${field}_STEALS_FIRST_DECISION`);
    if (context.purpose === "OPENING" && containsInventedOpeningPriorAction(text)) issues.push(`OPENING_${field}_INVENTED_PRIOR_ACTION`);
    if (context.purpose === "OPENING" && introducedOpeningActors(text, context).length) issues.push(`OPENING_${field}_INTRODUCED_UNPLACED_ACTOR`);
  }
  if (context.purpose !== "OPENING" && (narrative.resultNarrative.length + narrative.nextSituationNarrative.length) < 160) {
    issues.push("NARRATIVE_TOTAL_TOO_SHORT");
  }
  const endingStateText = [
    narrative.endingState.time,
    narrative.endingState.location,
    ...narrative.endingState.presentEntities,
    narrative.endingState.unresolvedPressure
  ].join("\n");
  const contextCorpus = buildAllowedSpecificityCorpus(context);
  if (introducedExactQuantities(endingStateText, contextCorpus).length) issues.push("ENDING_STATE_INTRODUCED_EXACT_QUANTITY");
  if (introducedNamedLocationsOrDocuments(endingStateText, allowedGroundingCorpus).length) issues.push("ENDING_STATE_INTRODUCED_NAMED_LOCATION_OR_DOCUMENT");
  if (contextDeniesPhysicalLedgerEvidence(context) && containsUnheldLedgerEvidence(endingStateText)) issues.push(`ENDING_STATE_CONTRADICTS_EVIDENCE_POSSESSION`);
  return unique(issues);
}

function buildNarrativeRepairFeedback(
  narrative: StoryNarrativeDraftV2,
  context: StoryContextSnapshotV2,
  issueCodes: string[]
): string[] {
  const feedback: string[] = [];
  const specificityCorpus = buildAllowedSpecificityCorpus(context);
  const groundingCorpus = context.items.flatMap((item) => [item.title, item.content]).join("\n");
  const addFieldFeedback = (scope: "RESULT" | "NEXT_SITUATION" | "ENDING_STATE", value: string) => {
    const quantities = introducedExactQuantities(value, specificityCorpus);
    if (issueCodes.includes(`${scope}_INTRODUCED_EXACT_QUANTITY`) && quantities.length) {
      feedback.push(`上一稿擅自增加了这些精确数字：${quantities.join("、")}。它们没有出现在上下文中；必须直接删除，不得换成另一组数字。`);
    }
    const locationsOrDocuments = introducedNamedLocationsOrDocuments(value, groundingCorpus);
    if (issueCodes.includes(`${scope}_INTRODUCED_NAMED_LOCATION_OR_DOCUMENT`) && locationsOrDocuments.length) {
      feedback.push(`上一稿擅自增加了这些具名地点或文书：${locationsOrDocuments.join("、")}。它们没有出现在上下文中；必须直接删除，不得换成别的府县或文书标题。`);
    }
  };
  addFieldFeedback("RESULT", narrative.resultNarrative);
  addFieldFeedback("NEXT_SITUATION", narrative.nextSituationNarrative);
  addFieldFeedback("ENDING_STATE", [
    narrative.endingState.time,
    narrative.endingState.location,
    ...narrative.endingState.presentEntities,
    narrative.endingState.unresolvedPressure
  ].join("\n"));
  if (issueCodes.some((code) => code.includes("STEALS_FIRST_DECISION") || code === "NEXT_SITUATION_STEALS_PLAYER_DECISION")) {
    feedback.push("上一稿替浙江总督采取了尚未由玩家选择的行动。删掉总督的命令、答复、派查、传人或密奏，停在他必须判断但尚未行动的时刻。");
  }
  if (issueCodes.some((code) => code.includes(`CONTRADICTS_EVIDENCE_POSSESSION`))) {
    feedback.push(`上下文明确说浙江总督手里没有暗账、抄件或田契实物。上一稿却把线索写成了可以翻看、拿起、封存或已经放在案上的物证；必须删除这些实物和虚构的取得经过，只保留“县令密信暗示存在暗账线索”这一已知事实。`);
  }
  if (issueCodes.some((code) => code.includes(`MALFORMED_PERSON_AS_EVIDENCE`))) {
    feedback.push(`上一稿把书吏、差役或幕僚写成了“实物”，这是病句且改变了事实。人物只能是人证或行动对象；“实物”只能指上下文明确持有的文书、物件或证据。`);
  }
  if (issueCodes.some((code) => code.includes(`INTRODUCED_UNSUPPORTED_PROP`))) {
    feedback.push(`上一稿为了画面感添加了上下文没有的玉佩、茶盏、炭盆、钥匙、烛火或其他道具。删掉这些装饰物，只保留 CURRENT_SCENE 已确认的人、文书和物件。`);
  }
  if (issueCodes.some((code) => code.includes(`UNSUPPORTED_CERTAINTY`))) {
    feedback.push(`上下文只确认两份县册数字冲突，并未确认一定有人改写或排除笔误。上一稿把怀疑写成了事实；必须改回角色能观察到的差异与不确定性。`);
  }
  if (issueCodes.some((code) => code.includes(`AMBIGUOUS_EVIDENCE_DENIAL`))) {
    feedback.push(`角色已经持有县册、公文和县令密信，不能含混写“手里没有任何实物”。必须明确写成“手里没有暗账、抄件或田契实物”。`);
  }
  if (issueCodes.some((code) => code.includes(`LEAKED_ABSTRACT_PRESSURE`))) {
    feedback.push(`上一稿把后台压力摘要“判断如何核实、取得执行边界与复核权”直接抄进正文。删掉策略术语，用眼前县册、公文、差役和期限把压力演出来。`);
  }
  if (issueCodes.some((code) => code.includes(`INVENTED_PRIOR_ACTION`))) {
    feedback.push(`上一稿虚构浙江总督在开场前已经反复核对、调查或询问过。开场必须从 CURRENT_SCENE 的当下开始，不得补写玩家没有做过的前置行动。`);
  }
  if (issueCodes.some((code) => code.includes(`INTRODUCED_UNPLACED_ACTOR`))) {
    feedback.push(`上一稿让 CURRENT_SCENE 没有写在现场的人物直接出现在内厅或外厅。删掉这些人的在场状态；角色登记和行动能力不等于此人已经来到现场。`);
  }
  return unique(feedback);
}
function containsEmbeddedDecisionMenu(text: string): boolean {
  return /(?:必须|需要|得|尚待)(?:在[^。！？\n]{0,30})?(?:先)?(?:决定|判断|选择)[^。！？\n]{0,40}(?:是|先)[^。！？\n]{0,100}(?:还是|或是|抑或)/.test(text)
    || /(?:第一步|下一步)[：:][^。！？\n]{0,100}(?:还是|或是|抑或)/.test(text)
    || /(?:可以|可)(?:先)?[^。！？\n]{0,50}(?:、|，)[^。！？\n]{0,80}(?:还是|或|抑或)/.test(text)
    || /若[^。！？\n]{0,100}[；;，,]\s*若[^。！？\n]{0,100}/.test(text)
    || /如果[^。！？\n]{0,100}[；;，,]\s*(?:如果|另一边|另一方面)[^。！？\n]{0,100}/.test(text);
}

function stripEmbeddedDecisionMenu(text: string): string {
  const sentences = text.match(/[^。！？]+(?:[。！？](?:[”》】])?|$)/g) ?? [text];
  const kept = sentences.filter((sentence) => !containsEmbeddedDecisionMenu(sentence));
  return kept.length ? kept.join("").trim() : text.trim();
}

function containsMalformedPersonAsEvidence(text: string): boolean {
  return /(?:那名|这名|一名|任何)?(?:书吏|幕僚|差役|县令|巡抚|证人)[^，。；！？\n]{0,4}实物/.test(text);
}

function introducedUnsupportedProps(text: string, context: StoryContextSnapshotV2): string[] {
  const contextCorpus = context.items.flatMap((item) => [item.title, item.content]).join("\n");
  const props = text.match(/玉佩|茶盏|炭盆|钥匙|烛火|佩刀|香炉|折扇/g) ?? [];
  return unique(props.filter((prop) => !contextCorpus.includes(prop)));
}

function containsUnsupportedCertainty(text: string, context: StoryContextSnapshotV2): boolean {
  const contextCorpus = context.items.flatMap((item) => [item.title, item.content]).join("\n");
  if (!/(?:数字|数目|田亩)[^。！？\n]{0,20}(?:冲突|不一致|对不上)/.test(contextCorpus)) return false;
  if (/(?:并非|绝非)(?:笔误|誊抄之误)|(?:已经|显然|必定|确定)(?:被人)?(?:改写|篡改|造假)/.test(contextCorpus)) return false;
  return /(?:并非|绝非)(?:笔误|誊抄之误)|(?:已经|显然|必定|确定)(?:被人)?(?:改写|篡改|造假)/.test(text);
}

function containsAmbiguousEvidenceDenial(text: string, context: StoryContextSnapshotV2): boolean {
  return contextDeniesPhysicalLedgerEvidence(context)
    && /(?:手里|手中)(?:仍|尚|并)?(?:没有|无)(?:任何)?实物(?:凭证)?/.test(text);
}

function containsLeakedAbstractPressure(text: string): boolean {
  return /(?:必须|需要)(?:先)?判断如何[^。！？\n]{0,60}(?:执行边界|复核权)/.test(text)
    || /执行边界|复核权|执行节奏|复核程序/.test(text);
}

function containsInventedOpeningPriorAction(text: string): boolean {
  return /反复(?:对照|比对|核对)/.test(text)
    || /(?:此前|先前|早已|已经)[^，。；！？\n]{0,16}(?:调查|询问|传唤|派人)[^，。；！？\n]{0,12}(?:过|了|遍|次)/.test(text)
    || /(?:对照|比对|核对|查验)[^，。；！？\n]{0,10}(?:第[一二三四五六七八九十\d]+遍|[一二三四五六七八九十\d]+次|过?再次)/.test(text);
}

function introducedOpeningActors(text: string, context: StoryContextSnapshotV2): string[] {
  const sceneCorpus = context.items
    .filter((item) => ["CURRENT_SCENE", "ACTIVE_PRESSURE", "THIS_TURN", "RECENT_CANON"].includes(item.sourceType))
    .flatMap((item) => [item.title, item.content])
    .join("\n");
  const assertedActors = [...text.matchAll(/(幕僚|书吏|差役|门房|长随|亲兵|县令|巡抚)(?:已|正|仍|就在|站|坐|走|候|等|递|咳|说|问|把|拿)/g)]
    .map((match) => match[1]);
  return unique(assertedActors.filter((actor) => !sceneCorpus.includes(actor)));
}

function containsUnchosenPlayerAction(text: string): boolean {
  if (/(?:浙江总督|总督)(?:当即|随即|旋即|马上|立即|径直|便)?(?:命|让|派|吩咐|传令|决定|答应|拒绝)/.test(text)) return true;
  return /总督[^。！？\n]{0,80}[：:][“"][^”"\n]{0,240}(?:你让|你去|你带|你派|你查|你把|来人|即刻|马上|立即)/.test(text);
}

function contextDeniesPhysicalLedgerEvidence(context: StoryContextSnapshotV2): boolean {
  const corpus = context.items.flatMap((item) => [item.title, item.content]).join(`\n`);
  return /(?:手里|手中|目前|尚未)[^。；\n]{0,24}(?:没有|并无|未有)[^。；\n]{0,16}(?:暗账|抄件|田契实物)/.test(corpus)
    || /没有暗账、抄件或田契实物/.test(corpus);
}

function containsUnheldLedgerEvidence(text: string): boolean {
  const assertedClauses = text
    .split(/[，。；！？\n]+/)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .filter((clause) => !/(?:没有|并无|未有|尚无|既无|也无|并未持有|未到手|尚未到手|不在手中|无)[^，。；！？\n]{0,24}(?:暗账|抄件|抄本|田契|原件|原本|实物)/.test(clause))
    .join("\n");
  return /(?:暗账|田契)(?:抄件|抄本|原件|原本|实物|封皮|纸页)/.test(assertedClauses)
    || /(?:翻开|翻阅|拿起|摊开|取出|封存|收好|查看)[^，。；！？\n]{0,12}(?:暗账|田契)(?!线索)/.test(assertedClauses)
    || /(?:暗账|田契)[^，。；！？\n]{0,12}(?:在手|在案|案上|手中|袖中)/.test(assertedClauses);
}
function introducedNamedCharacters(text: string, allowedNameCorpus: string): string[] {
  return unique(collectUnsupportedNamedCharacters(text, allowedNameCorpus).map((entry) => entry.name));
}

function introducedNamedLocationsOrDocuments(text: string, allowedCorpus: string): string[] {
  const locationPattern = /(?:^|[，。；：、“”\s《]|前往|赶赴|来到|送往|发往|抵达|返回|离开|进入|去往|到|在|去|往|赴|从|向)([\p{Script=Han}]{2,6}(?:府|县|州|镇))(?!令|册|官|丞|境|治)/gmu;
  const locationCandidates = [...text.matchAll(locationPattern)].map((match) => match[1]);
  const documentCandidates = [...text.matchAll(/《[^》\n]{2,40}》/g)].map((match) => match[0]);
  const plausibleLocations = locationCandidates.filter((candidate) => !/[把将让被由与的了向从在到去来赴进出看听说合放翻拿摊压份本册]/.test(candidate.slice(0, -1)));
  const allowedLocations = [...allowedCorpus.matchAll(/(?=([\p{Script=Han}]{2,10}(?:府|县|州|镇)(?!令|册|官|丞|境|治)))/gmu)].map((match) => match[1]);
  return unique([...plausibleLocations, ...documentCandidates].filter((candidate) => candidate
    && !allowedCorpus.includes(candidate)
    && !allowedLocations.some((allowed) => candidate.endsWith(allowed))));
}

function introducedExactQuantities(text: string, contextCorpus: string): string[] {
  const quantityScanText = text
    .replace(/(?:只有|独自|仅有|只剩)[^。！？\n]{0,8}一人/g, "")
    .replace(/(?:他|她|总督)一人/g, "")
    .replace(/(?:这一|那一|某一|一)(?:行|页)/g, "");
  const plainQuantities = quantityScanText.match(/(?:约|近|逾|不足|超过|多出|相差)?(?:数|几|若干)?(?:\d+|[一二三四五六七八九十百千万两半余]+)(?:石|两|亩|人|名|艘|日|年|月|刻|户|时辰|次|遍|行|页)/g) ?? [];
  const countedPeople = text.match(/(?:\d+|[一二三四五六七八九十百千万两半余]+)(?:个|名|位)(?:人|差役|书吏|亲兵|幕僚|长随|乡绅|管事)/g) ?? [];
  const countedHours = text.match(/(?:\d+|[一二三四五六七八九十百千万两半余]+)个时辰/g) ?? [];
  return unique([...plainQuantities, ...countedPeople, ...countedHours].filter((quantity) => !quantityIsGrounded(quantity, contextCorpus)));
}

function quantityIsGrounded(quantity: string, contextCorpus: string): boolean {
  if (contextCorpus.includes(quantity)) return true;
  const personCount = quantity.match(/^(?:约|近|逾|不足|超过|多出|相差)?(?:数|几|若干)?(\d+|[一二三四五六七八九十百千万两半余]+)(?:个|名|位)?(?:人|差役|书吏|亲兵|幕僚|长随|乡绅|管事)$/);
  if (!personCount) return false;
  const count = personCount[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${count}(?:个|名|位)?(?:人|差役|书吏|亲兵|幕僚|长随|乡绅|管事)`).test(contextCorpus);
}
function endsWithTruncationMarker(text: string) {
  return /(?:……+|\.\.\.+)[”’"']?\s*$/.test(text.trim());
}

function containsSequencedPrimaryActions(label: string): boolean {
  const actionVerbs = label.match(/(?:取出|调阅|读|烧掉|烧毁|毁掉|封存|传唤|召来|询问|盘问|回文|答复|批复|写信|递信|派人|调查|查验|核对|扣留|放走|公开|隐瞒|交出|送走|带回|监视|上奏|密奏|请求)/g) ?? [];
  return actionVerbs.length >= 2 && /(?:然后|接着|随后|再)/.test(label);
}

function introducedDecisionExecutors(text: string, groundingCorpus: string): string[] {
  const executors = text.match(/亲信家丁|心腹书办|亲信|书办|亲兵|幕僚|长随|家丁|巡按御史|钦差|锦衣卫/g) ?? [];
  return unique(executors.filter((executor) => !groundingCorpus.includes(executor)));
}

function containsUnmarkedDeception(decision: DecisionCandidateV2, groundingCorpus: string): boolean {
  const playerText = `${decision.label}\n${decision.description}`;
  if (!/(?:已按令执行|已经执行|已经办妥|已经完成|已完成)/.test(playerText)) return false;
  if (/(?:声称|假称|谎称|佯称|对外说|故意隐瞒)/.test(playerText)) return false;
  return !/(?:已按令执行|已经执行|已经办妥|已经完成|已完成)/.test(groundingCorpus);
}

function containsUnsupportedAccusation(decision: DecisionCandidateV2, groundingCorpus: string): boolean {
  const playerText = `${decision.label}\n${decision.description}`;
  const accusatoryText = playerText.replace(/(?:不算|并非|没有|避免|以免)[^，。；！？\n]{0,10}(?:阻挠|贪墨|勾结|包庇|造假|抗命)/g, "");
  const accusation = accusatoryText.match(/(?:阻挠|贪墨|勾结|包庇|造假|抗命)/)?.[0];
  if (!accusation || groundingCorpus.includes(accusation)) return false;
  return !/(?:怀疑|疑似|请求查明|查清是否|可能)/.test(accusatoryText);
}

function containsTemporalImpossibility(decision: DecisionCandidateV2): boolean {
  const text = `${decision.label}\n${decision.description}\n${decision.intentDraft.objective}\n${decision.intentDraft.method}`;
  const requiresTravelOrWaiting = /(?:连夜|赶往|赴|送往|前往)[^。！？\n]{0,24}(?:县|府|州|档房)|(?:召|传)[^。！？\n]{0,16}(?:来|到)/.test(text);
  const promisesBeforeImmediateDeadline = /(?:日落前|回文前|当即|立刻)[^。！？\n]{0,28}(?:拿到|取得|查清|问出|获得|完成)/.test(text)
    || /(?:拿到|取得|查清|问出|获得|完成)[^。！？\n]{0,28}(?:日落前|回文前)/.test(text);
  return requiresTravelOrWaiting && promisesBeforeImmediateDeadline;
}

function reviewDecisionHardRules(
  decisions: DecisionCandidateV2[],
  rejectedDirections: string[],
  context: StoryContextSnapshotV2,
  finalStory: string,
  presentEntities: string[]
): string[] {
  const issues: string[] = [];
  const groundingCorpus = `${finalStory}\n${context.items.map((item) => item.content).join("\n")}`;
  const allowedNameCorpus = buildAllowedNameCorpus(context);
  const roleRegistry = new Map<string, string>([[context.identity.roleId, context.audience.roleName]]);
  for (const item of context.items.filter((candidate) => candidate.sourceType === "ACTION_AFFORDANCE")) {
    for (const match of item.content.matchAll(/([^：；，、\n]{2,30})\[([^\]\r\n]{3,160})\]/g)) {
      roleRegistry.set(match[2].trim(), match[1].trim());
    }
  }
  if (decisions.length < 2 || decisions.length > 4) issues.push("DECISION_COUNT_INVALID");
  const labels = new Set<string>();
  for (const decision of decisions) {
    const normalizedLabel = decision.label.replace(/\s+/g, "").toLowerCase();
    if (labels.has(normalizedLabel)) issues.push("DUPLICATE_DECISION");
    labels.add(normalizedLabel);
    if (decision.actionKey !== null) issues.push("FIXED_ACTION_KEY_PRESENT");
    if (decision.label.length < 6 || decision.label.length > 32) issues.push(`DECISION_LABEL_LENGTH_INVALID:${decision.id}`);
    if (decision.description.length < 20 || decision.description.length > 160) issues.push(`DECISION_DESCRIPTION_LENGTH_INVALID:${decision.id}`);
    if (/(?:设立|建立|推进|优化|强化|纳入|统筹|协调)(?:[^，。；]{0,8})(?:程序|机制|方案|体系|章程|控制|闭环|证据链)/.test(decision.label)
      || /以[^，。；]{2,24}为由/.test(decision.label)
      || /(?:权限|风险|代价|执行边界|复核权|归属|口径)同时纳入/.test(decision.label)) {
      issues.push(`DECISION_LABEL_NOT_PLAIN_SPEECH:${decision.id}`);
    }
    if ((decision.label.match(/[，,；;：:]/g) ?? []).length > 2) issues.push(`DECISION_LABEL_COMPOUND_REPORT:${decision.id}`);
    if (/捅上去|搞定|盯死|拿捏|摊牌|硬刚|开摆/.test(decision.label)) issues.push(`DECISION_LABEL_MODERN_SLANG:${decision.id}`);
    if (/(?:，|,|；|;).*(?:并|同时|再|又|还)(?:派|让|命|查|问|催|封|扣|送|留|递|调|盯|传|写|召)/.test(decision.label)
      || containsSequencedPrimaryActions(decision.label)) {
      issues.push(`DECISION_MULTIPLE_PRIMARY_ACTIONS:${decision.id}`);
    }
    if (/必定|保证成功|一定成功|结果是|最终会/.test(`${decision.label}${decision.description}`)) issues.push("DECISION_PREVIEWS_RESULT");
    if (!decision.intentDraft.objective || !decision.intentDraft.method || !decision.intentDraft.target.id) issues.push("DECISION_NOT_ACTIONABLE");
    if (decision.intentDraft.method.replace(/\s/g, "").length < 6) issues.push(`DECISION_METHOD_TOO_VAGUE:${decision.id}`);
    const decisionText = `${decision.label}\n${decision.description}\n${decision.intentDraft.method}\n${decision.intentDraft.target.label}`;
    if (introducedDecisionExecutors(decisionText, groundingCorpus).length) issues.push(`DECISION_INTRODUCED_EXECUTOR:${decision.id}`);
    if (containsUnmarkedDeception(decision, groundingCorpus)) issues.push(`DECISION_UNMARKED_DECEPTION:${decision.id}`);
    if (containsUngroundedPretext(decision, groundingCorpus)) issues.push("DECISION_UNGROUNDED_PRETEXT:" + decision.id);
    if (containsTemporalImpossibility(decision)) issues.push(`DECISION_TEMPORALLY_IMPOSSIBLE:${decision.id}`);
    if (containsUnsupportedAccusation(decision, groundingCorpus)) issues.push(`DECISION_UNSUPPORTED_ACCUSATION:${decision.id}`);
    if (contextDeniesPhysicalLedgerEvidence(context) && containsUnheldLedgerEvidence(decisionText)) {
      issues.push(`DECISION_USES_UNHELD_EVIDENCE:${decision.id}`);
    }
    if (decision.intentDraft.target.type === "ROLE") {
      const registeredName = roleRegistry.get(decision.intentDraft.target.id);
      if (!registeredName) issues.push(`DECISION_ROLE_TARGET_NOT_IN_CONTEXT:${decision.id}`);
      else if (registeredName !== decision.intentDraft.target.label) issues.push(`DECISION_ROLE_TARGET_NAME_MISMATCH:${decision.id}`);
      else if (!isRoleTargetReflected(registeredName, `${decision.label}\n${decision.description}\n${decision.intentDraft.method}`)) {
        issues.push(`DECISION_ROLE_TARGET_NOT_REFLECTED_IN_ACTION:${decision.id}`);
      }
    } else {
      if (roleRegistry.has(decision.intentDraft.target.id)) {
        issues.push(`DECISION_NON_ROLE_TARGET_REUSES_ROLE_ID:${decision.id}`);
      }
      if (!isGroundedTargetLabel(decision.intentDraft.target.label, groundingCorpus)) {
        issues.push(`DECISION_TARGET_NOT_GROUNDED:${decision.id}`);
      }
      if (decision.intentDraft.target.type === "PERSON"
        && /^(?:那名)?(?:涉事人|当事人)$/.test(decision.intentDraft.target.label)) {
        issues.push(`DECISION_PERSON_TARGET_AMBIGUOUS:${decision.id}`);
      }
      if (decision.intentDraft.target.type === "PERSON"
        && looksLikeUnauthorizedChinesePersonalName(decision.intentDraft.target.label, allowedNameCorpus)) {
        issues.push(`DECISION_PERSON_TARGET_UNAUTHORIZED_NAME:${decision.id}`);
      }
      const targetIsPresent = presentEntities.some((entity) => isGroundedTargetLabel(decision.intentDraft.target.label, entity));
      const assumesFaceToFaceAccess = /(?:当面|亲自)(?:审问|盘问|询问|扣下|留下)/.test(decision.label);
      const firstObtainsAccess = /派人|召来|请来|带来|传来|去找|去请/.test(decision.label);
      if (decision.intentDraft.target.type === "PERSON" && !targetIsPresent && assumesFaceToFaceAccess && !firstObtainsAccess) {
        issues.push(`DECISION_PERSON_NOT_PRESENT:${decision.id}`);
      }
      if (decision.intentDraft.target.type === "PERSON"
        && !isGroundedTargetLabel(decision.intentDraft.target.label, `${decision.label}\n${decision.description}\n${decision.intentDraft.method}`)) {
        issues.push(`DECISION_PERSON_TARGET_NOT_REFLECTED_IN_ACTION:${decision.id}`);
      }
    }
    if (rejectedDirections.some((direction) => direction && `${decision.label}${decision.description}`.includes(direction))) issues.push("REJECTED_DIRECTION_REPEATED");
  }
  return unique(issues);
}

function buildDecisionRepairFeedback(
  decisions: DecisionCandidateV2[],
  context: StoryContextSnapshotV2,
  issueCodes: string[]
): string[] {
  const feedback: string[] = [];
  if (contextDeniesPhysicalLedgerEvidence(context)) {
    const invalidIds = new Set(issueCodes
      .filter((code) => code.startsWith(`DECISION_USES_UNHELD_EVIDENCE:`))
      .map((code) => code.slice(code.indexOf(`:`) + 1)));
    feedback.push(...decisions
      .filter((decision) => invalidIds.has(decision.id))
      .map((decision) => `${decision.id} 把只有消息线索的暗账写成了玩家手中的物证。删除“翻暗账、查看抄件、封存原件”等动作，改为从当前实际持有的县册、公文或县令密信渠道出发的真实行动。`));
  }
  for (const code of issueCodes) {
    const id = code.includes(":") ? code.slice(code.indexOf(":") + 1) : "";
    if (code.startsWith("DECISION_INTRODUCED_EXECUTOR:")) feedback.push(`${id} 发明了正文和上下文都没有的家丁、心腹书办、幕僚或亲兵。改用“派人”或现有渠道，不得为了选项方便临时造人。`);
    if (code.startsWith("DECISION_UNMARKED_DECEPTION:")) feedback.push(`${id} 把尚未发生的进度当成事实对外回复。若这是撒谎策略，label 必须明确写“声称、假称或隐瞒”，让玩家知道自己正在说谎。`);
    if (code.startsWith("DECISION_TEMPORALLY_IMPOSSIBLE:")) feedback.push(`${id} 所需赶路或等待时间超过眼前期限，却声称能在日落或回文前拿到结果。保留真实时间代价，不得让行动瞬间完成。`);
    if (code.startsWith("DECISION_UNSUPPORTED_ACCUSATION:")) feedback.push(`${id} 把尚未证实的阻挠、贪墨、勾结、包庇或造假直接写成指控。若要冒险上奏，必须明确这是怀疑或请求查明，不能把猜测伪装成事实。`);
  }
  return unique(feedback);
}


function parseFallback(value: unknown): PlayerIntentV2["fallback"] {
  if (value === null || value === undefined) return null;
  const object = record(value, "fallback");
  const triggerOn = requiredText(object.triggerOn, "fallback.triggerOn") as NonNullable<PlayerIntentV2["fallback"]>["triggerOn"];
  if (!["PRIMARY_BLOCKED", "PRIMARY_PARTIAL", "TARGET_REFUSED"].includes(triggerOn)) invalid("invalid fallback trigger");
  return { method: requiredText(object.method, "fallback.method"), triggerOn };
}

function parseCondition(value: unknown): PlayerIntentV2["condition"] {
  if (value === null || value === undefined) return null;
  const object = record(value, "condition");
  const condition: NonNullable<PlayerIntentV2["condition"]> = { eventType: requiredText(object.eventType, "condition.eventType") };
  if (typeof object.actorRoleId === "string" && object.actorRoleId.trim()) condition.actorRoleId = object.actorRoleId.trim();
  if (typeof object.targetId === "string" && object.targetId.trim()) condition.targetId = object.targetId.trim();
  if (typeof object.expiresAtStage === "number" && Number.isInteger(object.expiresAtStage)) condition.expiresAtStage = object.expiresAtStage;
  return condition;
}

function buildExecutionRecord(input: {
  input: GenerateStoryPipelineInputV2;
  attempt: number;
  step: Exclude<StoryPipelineStepV2, "AGENT_DECIDER">;
  systemPrompt: string;
  userPrompt: string;
  metadata: Record<string, string | number | boolean>;
  response: StoryModelResponseV2 | null;
  started: number;
  startedAt: string;
  finished: number;
  status: "SUCCESS" | "FAILED";
  issueCodes: string[];
}): PromptExecutionRecordV2 {
  const context = input.input.context;
  return {
    executionId: randomUUID(),
    runId: context.identity.runId,
    roleId: context.identity.roleId,
    actorTurnId: context.identity.actorTurnId,
    actionResolutionId: input.input.actionResolutionId,
    worldSequence: context.identity.worldSequence,
    turnRevision: context.identity.turnRevision,
    pipelineStep: input.step,
    promptVersion: PROMPT_VERSIONS[input.step],
    schemaVersion: "story-pipeline-v2.1",
    provider: input.response?.provider ?? "unknown",
    modelName: input.response?.modelName ?? "unknown",
    systemPromptHash: hashStoryTextV2(input.systemPrompt),
    contextSnapshotHash: context.identity.snapshotHash,
    inputHash: hashStoryTextV2(input.userPrompt),
    outputHash: input.response ? hashStoryTextV2(input.response.content) : null,
    attempt: input.attempt,
    startedAt: input.startedAt,
    finishedAt: new Date(input.finished).toISOString(),
    latencyMs: Math.max(0, input.finished - input.started),
    tokenUsage: input.response?.tokenUsage ?? null,
    status: input.status,
    issueCodes: input.issueCodes,
    supersededReason: null,
    inputMetadata: input.metadata,
    internalAudit: { systemPrompt: input.systemPrompt, userPrompt: input.userPrompt, rawOutput: input.response?.content ?? null }
  };
}

function parseJsonObject(content: string): unknown {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) invalid("model output must be a JSON object");
    return parsed;
  } catch (error) {
    if (error instanceof InvalidModelOutputError) throw error;
    throw new InvalidModelOutputError("model output was not valid JSON");
  }
}

class InvalidModelOutputError extends Error {}

function invalid(message: string): never {
  throw new InvalidModelOutputError(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function objectArray(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
  return value.map((entry, index) => record(entry, `${label}[${index}]`));
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(`${label} must be a non-empty string`);
  return value.trim();
}

function textArray(value: unknown, label: string, minimum: number): string[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
  const output = value.map((entry, index) => requiredText(entry, `${label}[${index}]`));
  if (output.length < minimum) invalid(`${label} must contain at least ${minimum} items`);
  return output;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizeStepAttempts(value: unknown): number {
  const parsed = Number(value ?? process.env.STORY_PIPELINE_STEP_MAX_ATTEMPTS ?? 2);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(3, Math.trunc(parsed))) : 2;
}

function normalizeQualityAttempts(value: unknown): number {
  const parsed = Number(value ?? process.env.STORY_PIPELINE_QUALITY_ATTEMPTS ?? 1);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(3, Math.trunc(parsed))) : 1;
}

function looksLikeUnauthorizedChinesePersonalName(label: string, allowedNameCorpus: string): boolean {
  const personalName = new RegExp(`^[${COMMON_CHINESE_SURNAMES}][\\p{Script=Han}]{1,2}$`, "u");
  return personalName.test(label) && !allowedNameCorpus.includes(label);
}

function isRoleTargetReflected(roleName: string, corpus: string): boolean {
  if (isGroundedTargetLabel(roleName, corpus)) return true;
  const naturalTitle = roleName.match(/(?:浙江)?(总督|巡抚|县令|织造使|书吏|会首|监织造使)$/)?.[1];
  return Boolean(naturalTitle && corpus.includes(naturalTitle));
}

function isGroundedTargetLabel(label: string, corpus: string): boolean {
  // Model output can contain invisible format characters or full-width
  // punctuation even when the player-visible label looks identical to the
  // story.  Grounding compares canonical human-readable text, not those
  // serialization differences.
  const normalizeGroundingText = (value: string) => value
    .normalize("NFKC")
    .replace(/[^\p{Script=Han}A-Za-z0-9]/gu, "")
    .toLowerCase();
  const normalizedLabel = normalizeGroundingText(label);
  const normalizedCorpus = normalizeGroundingText(corpus);
  if (!normalizedLabel) return false;
  if (normalizedCorpus.includes(normalizedLabel)) return true;
  const pairs = new Set<string>();
  for (let index = 0; index < normalizedLabel.length - 1; index += 1) {
    pairs.add(normalizedLabel.slice(index, index + 2));
  }
  const matchedPairs = [...pairs].filter((pair) => normalizedCorpus.includes(pair));
  if (matchedPairs.length >= 2) return true;
  const pieces = normalizedLabel
    .split(/(?:的|与|和|及|中|内|外|记录|登记|名册|簿册|账簿|底稿|原件|证词|来使|衙门|官署|人员)/)
    .map((piece) => piece.replace(/[^㐀-鿿A-Za-z0-9]/g, ""))
    .filter((piece) => piece.length >= 2)
    .sort((left, right) => right.length - left.length);
  return pieces.some((piece) => normalizedCorpus.includes(piece));
}

function containsUngroundedPretext(decision: DecisionCandidateV2, groundingCorpus: string): boolean {
  const playerText = decision.label + "\n" + decision.description;
  const inventedCondition = playerText.match(/(?:身体不适|头疾|抱恙|染病|病重|家中有事)/)?.[0];
  if (!inventedCondition || groundingCorpus.includes(inventedCondition)) return false;
  return !/(?:假称|佯称|谎称|故意声称)/.test(playerText);
}
