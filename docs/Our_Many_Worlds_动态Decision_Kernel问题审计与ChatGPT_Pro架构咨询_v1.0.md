# Our Many Worlds 动态 Decision Kernel 问题审计与 ChatGPT Pro 架构咨询

版本：v1.0  
日期：2026-08-06  
项目：`D:\lyh\agent\agent-frame\aiStoryRoom`  
审计基线：`main@e60dfd8fc9dda0459edbd37fe6be52ecd8dff1d6`

---

## 一、本文目的

本文用于请 ChatGPT Pro 对《桑田诏》单人动态剧情系统中的 Decision Kernel 架构进行独立分析。

当前系统已经能够在第一部分约二十回合内：

- 保存结构化世界状态；
- 根据玩家选择执行 Settlement；
- 维护关键人物、证据、文书、粮食、土地、奏报和延迟后果；
- 从《大明王朝1566》拆解资产中检索剧情机制；
- 由 Narrator 将结构化剧情计划写成小说正文；
- 向玩家提供两个可执行选项并支持自由输入；
- 在 T20 根据权威状态生成第一部分结局。

但是当前 Decision Kernel 仍以“预写 Kernel 按固定顺序推进”为主。它适合验证第一部分闭环，却无法自然支撑几十回合、几百回合或其他世界中的长期开放剧情。

本次希望 ChatGPT Pro 重点判断：

> 如何把现有“状态适配的固定 Kernel”升级为“世界状态驱动的动态 Decision Instance”，同时保持主线、因果和关键事实稳定，并避免让大模型随意猜测下一步剧情。

本轮请先做架构审查和方案收敛，不要直接修改代码。

---

## 二、产品最终目标

系统不是要生成一部固定小说，而是要实现：

> 有原著依据、角色会主动行动、玩家能够真正改变局势、关键后果跨回合延续、长期剧情不会偏离世界主线的可玩文字剧情。

MVP阶段的验收优先级固定为：

1. 主线和人物行为合理；
2. 玩家选择真实改变后续；
3. 关键事实前后一致；
4. 决策清楚且确实不同；
5. 文本整体流畅，像小说场景而不是结算报告。

非关键叙事细节的小幅不一致可以记录，但暂时不阻断剧情。只有会改变世界走向的关键事实需要严格保存和约束。

---

## 三、当前真实实现

### 3.1 当前 Decision Kernel 的生成方式

目前《桑田诏》的推荐选项不是由 DeepSeek 每回合自由生成，而是来自已经编译进 Story Package 的 Decision Kernel。

当前流程为：

```text
当前 Section
→ 找到 activeDecisionKernelIds 中第一个尚未完成的 Kernel
→ 读取该 Kernel 的三个预写 Affordance
→ 根据部分世界状态调整选项文字和状态效果
→ 取第一个和最后一个作为两个玩家选项
→ 对选项执行预结算
→ 页面只显示 actionText
```

主要代码位置：

- `packages/templates/src/story-package/part-one-runtime-engine.ts:542`
  - 使用 `find` 选择当前 Section 中第一个未完成 Kernel；
- `packages/templates/src/story-package/part-one-runtime-engine.ts:571`
  - 三个候选通常只展示首尾两个；
- `packages/templates/src/story-package/part-one-runtime-engine.ts:631`
  - 追加决策主要按 continuation 数组索引继续；
- `apps/openovel-runtime/src/sangtian-decisions.ts:266`
  - 将 Affordance 转换为玩家选项，前端标签就是 `actionText`；
- `apps/openovel-runtime/src/runtime.ts:842`
  - 在本轮结算后生成下一组结构化选项。

### 3.2 当前已经具备的状态适配

系统不是完全静态，已经能够：

- 根据关键状态选择不同 `decisionPromptVariant`；
- 根据文书是否已经形成，修改后续行动文字和效果；
- 避免重复执行已经发生的命令；
- 根据延迟后果和 Section Floor 增加继续决策；
- 在 Section Exit Gate 满足后进入下一节；
- 对自由输入执行能力约束和结构化结算。

因此当前准确定位是：

> 状态适配的固定 Kernel，而不是真正的动态 Kernel。

### 3.3 当前剧情生成方式

当前剧情不是直接把原著全文交给大模型续写，而是：

```text
《大明王朝1566》原著
→ 章节、场景和 Claim 拆解
→ Source Scene Evidence
→ 原著冲突机制和人物施压方式
→ Actor Policy / Institution Capability / Causal Rule
→ Decision Kernel / Section Contract / Floor Obligation
→ Settlement 产生权威结果
→ Next Beat Planner 形成下一拍剧情
→ Narrator 写成小说正文
```

当前原著机制资产包含十个经过批准的来源场景，涉及 C01—C07、C13、C23，并保存：

- 原著章节和段落范围；
- 来源文本 SHA；
- Claim ID；
- 可复用的剧情机制；
- 不得写死的未知事实。

主要资产：

- `packages/templates/authoring/sangtian/source-evidence/section-one-scenes.approved.json`
- `packages/templates/authoring/sangtian/narrative/scene-patterns.section-01.approved.json`
- `packages/templates/config/sangtian/story-package/part-one-runtime.json`
- `scripts/story-decomposition/compile-sangtian-part-one-authoring.mjs`

运行时遵循：

```text
MECHANISM_ONLY_NO_VERBATIM_REUSE
```

也就是只复用原著的冲突结构、权力关系、人物策略、问话节奏和因果机制，不复制原著台词，也不把原著场景中的具体人物和物件未经授权地搬进当前世界。

---

## 四、已经暴露的核心问题

### 4.1 固定顺序无法适应长期分支

当前系统按 `activeDecisionKernelIds` 的顺序推进。

在前五到二十回合中，这能保证：

- 剧情不会跑偏；
- 所有关键剧情义务都能被覆盖；
- 测试结果可重复；
- 结局有足够状态输入。

但随着玩家长期选择，可能出现：

- 原册失踪，而系统仍要求决定原册如何封存；
- 玩家已与巡抚彻底决裂，系统仍给出联合具名；
- 商会已经被拒绝，系统仍要求为商会设置入场条件；
- 玩家通过自由输入开辟了新的证据来源，但固定 Kernel 不认识它；
- 某个 NPC 已失去职权或离场，后续 Kernel 仍把他当作当前对手；
- 前序选择已经消除了某项压力，后续菜单却重新提出同一问题。

固定 Kernel 数量如果不断增加，会形成组合爆炸，最终无法维护。

### 4.2 当前“动态”主要是局部补丁

现有 `adaptAffordanceForCurrentState` 会针对某些状态改写选项。这解决了第一部分的具体重复问题，但不适合作为长期通用方案。

如果每出现一个新故事状态，就增加一段故事专用判断，最终会变成：

```text
如果原册已封存，则改文字
如果回文已写成，则改文字
如果巡抚已离场，则再改文字
如果商会已被拒绝，则再加特殊分支
……
```

这与此前反复增加中文同义词、故事专用正则和 Prompt 例外的问题本质相同：只能修复一次失败，不能建立世界无关能力。

### 4.3 结构正确不等于玩家觉得合理

当前系统能够验证：

- 选项属于当前 Decision Point；
- 玩家拥有执行权限；
- 状态补丁合法；
- 两个选项会产生不同后果；
- 旧选项或篡改选项不能提交。

但它不能自动保证：

- 两个选项是当前人物最自然会想到的行动；
- 选项承接上一段正文的真实停止点；
- 选项不是行政命令或产品说明；
- 当前最迫切的问题确实是这个 Kernel；
- 选项能推动人物冲突，而不仅仅是改变后台数值。

因此“因果合法”和“玩家觉得真实”需要分开验收。

### 4.4 剧情资产接入不均衡

当前十个 Source Scene Evidence 已覆盖第一部分四节所需的主要原著机制。

但是 Narrative Scene Pattern 目前只有第一节的三套正式模式。第二至第四节虽然有原著机制、状态和因果资产，却缺少同等丰富的场景语法。

这会导致：

- 第一节较容易产生人物在场、问答、沉默和反制；
- 后续章节容易退化为“结算结果＋下一项命令”；
- Decision Kernel 继续正确推进，但正文越来越像政策工作流。

### 4.5 大模型不能承担所有决策权

如果简单改成：

> 把正文和状态交给 DeepSeek，让它自己生成下一组决策。

则可能产生：

- 玩家没有权限执行的行动；
- 使用尚未发现的秘密；
- 操作不存在或不在场的关键物件；
- 替玩家作出额外承诺；
- 两个文字不同但后果相同的假选择；
- 为了制造戏剧性而偏离主线；
- 让临时叙事细节升级为权威事实。

因此不能采用纯 LLM 决策生成。

---

## 五、根因判断

当前问题不是单一模型、单一 Prompt 或某个中文表达造成的。

根因是当前 Decision Kernel 同时承担了三种不同职责：

1. 主线必须处理的剧情议题；
2. 当前这一回合的具体决策需求；
3. 玩家页面上显示的具体行动文字。

这三层变化速度不同：

- 主线义务相对稳定；
- 当前决策需求随世界状态变化；
- 玩家文字需要随当前场景自然表达。

把三层一起预写，前期稳定，后期必然僵化。

---

## 六、拟议解决方案：动态 Decision Instance

### 6.1 核心原则

保留 Decision Kernel，但改变它的职责：

> Decision Kernel 不再是一组预写菜单，而是一个可复用的冲突原型和决策约束。

每回合根据权威世界状态编译出一个 Dynamic Decision Instance。

### 6.2 三层结构

#### 第一层：Arc Obligation

只规定主线在某一部分结束前必须形成的状态，不规定具体路线。

例如第一部分必须形成：

- 改桑执行状态；
- 县册证据链状态；
- 粮食救急路径；
- 土地风险状态；
- 第一份奏报及叙述控制权。

这些是主线护栏，不是固定菜单。

#### 第二层：Decision Kernel Template

定义抽象冲突，而不是具体行动。

示例：

```json
{
  "kernelType": "EVIDENCE_CONTROL",
  "question": "如何在证据安全、调查效率和政治合作之间选择",
  "requiredCapabilities": [
    "INSPECT_EVIDENCE",
    "ORDER_CUSTODY",
    "REQUEST_WITNESS"
  ],
  "conflictAxes": [
    "SECURITY_VS_SPEED",
    "CONTROL_VS_COOPERATION"
  ],
  "mainlineContributions": [
    "EVIDENCE_CHAIN_ESTABLISHED"
  ]
}
```

#### 第三层：Dynamic Decision Instance

运行时根据当前状态生成本轮具体决策。

```json
{
  "decisionInstanceId": "ddi_run_turn_17",
  "kernelType": "EVIDENCE_CONTROL",
  "triggerFacts": [
    "原册仍在清流县档房",
    "巡抚要求共同复核",
    "关键书吏只向县令作过口头说明"
  ],
  "pressureActor": "actor.zhejiang_xunfu",
  "criticalEntities": [
    "document.qingliu_register_original",
    "actor.reform_clerk"
  ],
  "availableCapabilities": [
    "GOVERNOR_ARCHIVE_ORDER",
    "JOINT_REVIEW_REQUEST",
    "SEALED_TESTIMONY_REQUEST"
  ],
  "candidateActions": []
}
```

---

## 七、建议的运行时职责拆分

### 7.1 Pressure Detector

只负责从权威状态中找到当前最需要玩家处理的压力：

- 到期延迟后果；
- NPC主动反制；
- 关键证据危险；
- 主线义务缺口；
- 玩家此前选择造成的副作用；
- 当前场景留下的真实停止点。

输出结构化 `DecisionDemand`，不写玩家文字。

### 7.2 Kernel Retriever

根据 `DecisionDemand` 检索合适的抽象 Kernel Template。

Kernel选择不再使用“第一个未完成”，而应依据：

- 与当前压力的相关度；
- 对尚未完成主线义务的贡献；
- 当前人物和关键实体是否可用；
- 是否与最近决策重复；
- 是否有合法能力可以执行；
- 是否有原著机制或批准改编提供支撑。

### 7.3 Capability Enumerator

从玩家角色、机构权限、资源和现场实体中确定当前可以做什么。

它只能输出结构化能力，不写剧情，也不生成选项文案。

### 7.4 Candidate Generator

根据：

- Decision Demand；
- Kernel Template；
- 可用能力；
- 当前关键实体；
- Actor Policy；
- 原著机制；

提出 4—6 个结构化候选行动。

这一层可以使用大模型，但大模型只能在服务器给出的能力和实体范围内组合行动。

### 7.5 Settlement Preview

对每个候选行动执行不落盘的预结算，得到：

- 是否可执行；
- 会改变哪些关键状态；
- 哪个 NPC 会反制；
- 会产生什么即时、世界和延迟后果；
- 是否推进主线；
- 是否重复已经发生的行动。

Settlement Preview 是候选有效性的权威来源。

### 7.6 Candidate Filter and Ranker

删除：

- 越权行动；
- 使用未知秘密的行动；
- 操作不存在实体的行动；
- 不改变任何关键状态的假选择；
- 与最近选择重复的行动；
- 两个结果实质相同的同义选项；
- 提前完成禁止揭晓内容的行动。

再按照以下维度排序：

- 当前剧情相关性；
- 玩家可理解性；
- 后果差异；
- 主线贡献；
- 人物冲突强度；
- 可逆性和风险差异。

最终保留 2—4 个真实不同的行动。

### 7.7 Option Surface Writer

大模型只负责把通过验证的结构化行动写成自然玩家语言。

后台：

```json
{
  "intent": "保护证据链",
  "target": "document.qingliu_register_original",
  "method": "三方见证换封",
  "capability": "GOVERNOR_ARCHIVE_ORDER"
}
```

前端：

> 命清流县原册留在档房，待督、抚、县三方见证到场后重新换封。

Option Surface Writer 不得改变目标、方法、能力和已预结算效果。

### 7.8 Free Text Compiler

玩家自由输入需要编译为同一个结构化 Action Spec，再进入 Settlement Preview 和正式 Settlement。

自由输入不能拥有一套与推荐选项不同的世界规则。

### 7.9 Authored Fallback

如果动态候选生成失败、超时或全部被过滤，使用当前预写 Decision Kernel 作为安全 Fallback。

因此现有 Kernel 不需要删除，可以作为：

- Kernel Template 的来源；
- MVP期间的稳定路径；
- 模型不可用时的降级选项；
- 动态系统的对照测试基线。

---

## 八、示例：同一个 Kernel 如何随世界变化

抽象 Kernel：`EVIDENCE_CONTROL`

### 状态 A：原册安全，督抚仍合作

- 原地三方换封；
- 制作见证副本并共享；
- 县令先初核，总督只审结果。

### 状态 B：原册失踪

- 保护并单独询问经手书吏；
- 从田契、仓单和抄件重建证据链；
- 公开原册失踪并要求督抚共同担责。

### 状态 C：巡抚已经控制原册

- 正式要求共同启封质证；
- 暂不惊动巡抚，寻找第二独立证据源；
- 将保管权争议写入首份奏报。

### 状态 D：关键书吏已经被收买

- 以现有材料交叉核验其证词；
- 保护其家属换取重新作证；
- 放弃该证人，转查文书经手链。

四种状态使用同一个冲突原型，但不复用同一组菜单。

---

## 九、原著拆解资产在动态系统中的作用

动态 Kernel 不代表摆脱原著，更不能让模型自由创造主线。

原著拆解资产应提供：

- 当前冲突可参考的剧情机制；
- 人物在类似压力下如何行动；
- 官场、财政、粮食、土地和奏报之间的因果关系；
- 场景如何通过人物问答、沉默、物件和程序产生权力感；
- 哪些结论原著支持，哪些只是批准改编；
- 哪些事实仍然未知，不能提前写死。

动态 Kernel 使用的是：

> 原著冲突机制＋当前权威世界状态，而不是原著固定事件顺序。

原著决定“这种世界中的人为什么这样行动”，玩家决定“当前世界已经变成什么样”，动态 Kernel 决定“此刻真正需要处理什么”。

---

## 十、关键事实和非关键细节的边界

MVP阶段继续遵守：

### 必须严格保存

- 玩家作出的重大命令、签署和承诺；
- 关键文书和证据是否存在；
- 关键文书和证据的位置、保管人、公开状态；
- 谁知道某个秘密；
- 关键人物是否在场、离场、失去能力或死亡；
- 制度权限和重要关系变化；
- 已结算的即时、世界和延迟后果；
- 主线义务是否完成。

### 可以暂时宽松

- 普通纸张、灯火、衣袖、脚步、案几；
- 非关键路人和短暂环境描写；
- 不会进入后续因果的天气和空间纹理；
- 不改变人物能力、关系和证据状态的轻微叙事差异。

动态候选生成和审查不得重新退化为中文关键词、同义词表或故事专用正则。

---

## 十一、模块化和可插拔要求

以下职责必须可以独立启用、替换或关闭：

1. Source Retrieval；
2. Pressure Detector；
3. Kernel Retriever；
4. Capability Enumerator；
5. Candidate Generator；
6. Settlement Preview；
7. Candidate Filter；
8. Candidate Ranker；
9. Option Surface Writer；
10. Fact Settlement；
11. Next Beat Planner；
12. Narrator；
13. Truth Reviewer；
14. Storykeeper；
15. Ending Module。

任何环节失败时，系统应明确记录是哪个模块失败，不得把所有问题都归结为 Prompt 或模型。

同类方案最多真实失败三次。第三次仍失败时必须停止重复运行，报告该模块或合同为什么不成立，并重新裁决方案。

---

## 十二、建议的数据合同

### 12.1 DecisionDemand

```ts
type DecisionDemand = {
  demandId: string;
  sourcePressureIds: string[];
  unresolvedObligationIds: string[];
  activeActorIds: string[];
  criticalEntityIds: string[];
  urgency: "LOW" | "MEDIUM" | "HIGH" | "IMMEDIATE";
  requiredPlayerResponse: string;
  forbiddenAssumptions: string[];
};
```

### 12.2 DecisionKernelTemplate

```ts
type DecisionKernelTemplate = {
  kernelType: string;
  conflictAxes: string[];
  requiredCapabilities: string[];
  applicablePressureTypes: string[];
  mainlineContributionIds: string[];
  sourceMechanismIds: string[];
  candidateGenerationRules: string[];
};
```

### 12.3 DynamicDecisionInstance

```ts
type DynamicDecisionInstance = {
  instanceId: string;
  demandId: string;
  kernelType: string;
  stateRevision: number;
  triggerFactIds: string[];
  activeActorIds: string[];
  criticalEntityIds: string[];
  availableCapabilityIds: string[];
  candidateActions: ActionSpec[];
  selectedOptionIds: string[];
  fallbackKernelId?: string;
};
```

### 12.4 ActionSpec

```ts
type ActionSpec = {
  actionId: string;
  originActorId: string;
  intent: string;
  targetEntityIds: string[];
  method: string;
  capabilityId: string;
  requiredFactIds: string[];
  predictedChangedStatePaths: string[];
  predictedImmediateEffects: string[];
  predictedDelayedEffectIds: string[];
  predictedCountermoveActorIds: string[];
  sourceMechanismIds: string[];
};
```

---

## 十三、建议的验收标准

### 13.1 工程标准

- 同一状态和随机种子可以重放同一个 Decision Demand；
- 每个候选行动都能完成 Preview Settlement；
- 重复请求不产生第二份决策实例；
- 旧 Revision 的决策不能提交；
- 推荐选项和自由输入使用同一个 Settlement；
- 动态系统失败时能返回审核过的固定 Kernel Fallback；
- 不依赖《桑田诏》中文关键词才能工作；
- 使用第二世界样例证明合同世界无关。

### 13.2 玩家标准

逐回合像真实玩家一样检查：

- 当前为什么必须作决定，正文已经自然表现出来；
- 每个选项都是当前人物此刻真正能够执行的行动；
- 普通玩家可以直接看懂；
- 两个选项不是同义改写；
- 每个选项都有不同现实代价；
- 玩家此前的选择会改变本轮出现的选项；
- 已解决问题不会以原样再次出现；
- 关键事实不会因为动态生成而漂移；
- 选择之后下一段剧情能够自然承接；
- 主线义务仍在推进，但玩家路线不被强行拉回固定菜单。

### 13.3 对照实验

在相同起点分别运行：

1. 当前固定 Kernel；
2. 动态 Kernel；
3. 动态 Kernel 关闭 LLM，仅使用确定性候选；
4. 动态 Kernel 使用 LLM 候选＋Settlement过滤；
5. 动态系统故障后使用固定 Fallback。

比较：

- 决策与正文结尾的衔接；
- 玩家理解成本；
- 假选择比例；
- 重复问题比例；
- 关键事实冲突；
- 主线覆盖率；
- 模型调用次数、Token、延迟和费用。

---

## 十四、迁移边界

不建议一次删除当前固定 Kernel。

更安全的结构是：

```text
固定 Kernel
→ 抽取 Kernel Template
→ 增加 Pressure Detector
→ 增加 Capability Enumerator
→ 先使用确定性 Candidate Generator
→ 再允许 LLM 提出候选
→ Settlement Preview 统一验证
→ 动态失败时回退固定 Kernel
```

现有第一部分可以继续作为 Gold Set 和 Fallback，不需要全部推倒重写。

本架构必须通用于其他故事，例如《凯撒》。不得通过增加《桑田诏》专用条件来宣称动态系统完成。

---

## 十五、本轮非目标

本轮架构咨询暂不要求：

- 修改主游戏页面；
- 重新设计 UI；
- 完成多人运行时；
- 完成《凯撒》正式剧情资产；
- 对所有非关键叙事细节做强一致性审查；
- 立即废弃当前固定 Kernel；
- 让大模型自由决定世界事实。

---

## 十六、请 ChatGPT Pro 重点回答

请基于本文和仓库代码，逐项回答：

1. 对根因的判断是否成立：当前 Kernel 是否混合了主线义务、决策需求和玩家文案三种职责？
2. “Arc Obligation → Kernel Template → Dynamic Decision Instance”三层结构是否足够？是否缺少关键层？
3. Pressure Detector 应如何确定当前最值得玩家处理的压力，而不是重新形成固定优先级？
4. Candidate Generator 应以确定性规则为主，还是允许 LLM 先提出候选？两者如何组合？
5. Settlement Preview 是否足以过滤越权、假选择和无效行动？还需要哪些结构化检查？
6. 如何判断两个候选行动“本质不同”，而不是文案不同？
7. 如何让动态决策继续推进主线，但不把玩家强行拉回固定路线？
8. 如何处理自由输入产生的新剧情方向和新关键实体？
9. 当前固定 Kernel 应如何改造成 Template 和 Fallback，最小迁移范围是什么？
10. 当前建议的数据合同是否存在职责混淆、字段不足或过度设计？
11. 如何在不增加故事专用正则、中文同义词和 Prompt 例外的情况下完成通用验证？
12. 如何使用《桑田诏》与第二世界样例证明方案具有世界无关性？
13. MVP阶段最小可交付版本应该做到哪一步，哪些能力可以后续迭代？
14. 请指出本方案最可能失败的三个地方，并给出替代架构。
15. 请给出明确裁决：`APPROVE`、`APPROVE_WITH_CHANGES` 或 `REJECT`，并说明原因。

---

## 十七、期望 ChatGPT Pro 的输出格式

```text
一、架构裁决
APPROVE / APPROVE_WITH_CHANGES / REJECT

二、对当前根因的判断

三、推荐的最终模块边界

四、推荐的数据合同

五、每回合完整时序

六、固定 Kernel 到动态 Kernel 的最小迁移方案

七、MVP验收标准

八、三个最大风险与替代方案

九、需要 Codex 进一步提供的代码或运行证据
```

请明确区分：

- 仓库代码已经实现的事实；
- 根据代码得出的推断；
- 建议新增的能力；
- 当前无法判断、需要补充证据的内容。

不要把“修改 Prompt”作为主要解决方案，也不要为当前某一个《桑田诏》场景增加特殊语义规则。

