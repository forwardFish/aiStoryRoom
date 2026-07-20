# Many Worlds Solo Play：单次 DeepSeek 真实剧情与真实决策详细实现方案 v1.0

> 文档状态：待开发、待验收  
> 适用范围：`sangtian` 世界的 Solo Play，首要验收角色为“浙江总督”  
> 核心规则：**真实的剧情，真实的决策，不用等他人，也可以继续推进。**  
> 本期边界：只把 Solo Play 做到完整、稳定、可信；不继续开发多人流程；不改变已经确认的主游戏页面文字与布局。

---

## 0. 文档要解决的问题

这份方案不是继续修补现有五步模型流水线，而是重新明确 Solo Play 的正确生成合同：

```text
玩家看到一段真实、连续、符合浙江总督视角的故事
→ 玩家选择一个真实可执行的决策，或使用人物交谈/派遣调查/使用筹码/自拟谋划
→ 系统立即单独结算这项行动
→ 系统只调用一次 DeepSeek
→ DeepSeek 先写行动产生的下一段故事，再给出从故事末态出发的新决策
→ 本地硬规则校验
→ 原子写入数据库
→ 页面自动出现下一段剧情和决策
```

本方案必须同时解决以下现有问题：

1. 正常一轮存在 Writer、Decision Designer 等多次 DeepSeek 调用，等待时间过长。
2. 质量门禁可能让同一阶段多次重新生成，最终还可能长期停留在 `RESOLVING`。
3. 当前上下文虽然已有 P0/P1/P2/P3，但检索仍偏“把查询到的内容再筛选”，没有真正以剧情图和实体关联为中心。
4. 故事背景、宏观大纲、本轮模型上下文三者的边界不够清楚。
5. 正文和决策的语言容易成为规则摘要、制度术语或项目文档语言，而不是人类能读懂的故事和行动。
6. Solo 中其他角色被当作完整 Agent 任务排队，产生没有必要的调用和等待；本期它们应作为受剧本与状态约束的 NPC 参与故事。
7. 生成失败、上下文过期、请求超时与用户重试之间缺少简单、可恢复的产品合同。

---

## 1. 不可变产品合同

### 1.1 三条最高优先级规则

#### 规则一：真实的剧情

“真实”不是指历史纪录片，而是指玩家读到的是一段人类能够理解、能够相信、具有场景和因果的故事：

- 有明确时间、地点、在场人物和正在发生的事件。
- 人物通过动作、对话、迟疑、隐瞒、文书、脚步、差役回报等可观察方式推动故事。
- 玩家上一项行动必须真的发生，并在下一段剧情中产生结果或明确受阻。
- 故事从最近正文的最后一刻继续，不复述、不跳回、不突然换场。
- 浙江总督不知道的秘密不能被旁白直接告诉玩家。
- 不能把数据库状态、规则摘要、质量门禁、`assetKey`、`actionKey` 或项目术语写给玩家。
- 每段正文最后必须停在一个真实的新局面，而不是停在“系统正在整理”“请选择处理方式”之类的占位语。

#### 规则二：真实的决策

决策是浙江总督此刻真实能够下达、表达或安排的一项行动，不是后台概念的中文翻译。

合格示例：

```text
派亲随带上总督令牌，连夜赶往清流县封存田契档房。

先不惊动巡抚，只让书吏把两份县册的经手人逐一列出来。

请巡抚留下，当面问清他为何急着把复核责任推回总督府。
```

不合格示例：

```text
设立联合复核程序，把执行速度与证据复核同时纳入总督衙门控制。

推进本职方案并说明代价。

协调另一位角色的资源。
```

每个候选决策必须满足：

- 一眼能看懂“我要做什么”。
- 只有一个主要动作，不把三四件事塞进一项选择。
- 对象、方法和权限真实存在。
- 不预告成功、失败或奖励。
- 不把怀疑写成事实。
- 不使用玩家没有的证据、筹码或现代技术。
- 2～4 项之间在方向、风险、信息价值或承诺程度上确实不同。
- 不重复上一轮已经完成或玩家已经拒绝的方向。

#### 规则三：不用等他人，也可以继续推进

Solo Play 中：

- 浙江总督提交任何一种有效行动后立即单独结算。
- 不等待其他五个角色提交行动。
- 不等待其他五个 Agent 完成独立任务。
- 其他人物是当前故事中的 NPC，由同一次剧情生成表现其可观察反应。
- NPC 的秘密、资源和反应仍由数据库状态、剧情图和权限边界约束，不能由 Writer 随意决定世界事实。

### 1.2 四种谋划也是决策

以下四种操作不是旁支小游戏，也不是额外的聊天接口：

```text
人物交谈
派遣调查
使用筹码
自拟谋划
```

它们与页面中的推荐决策共同实现同一个 `PlayerIntent` 合同，并走同一条生成链：

```text
看剧情
→ 选择推荐决策，或使用四种谋划之一
→ 本地校验与确定性结算
→ 一次 DeepSeek
→ 下一剧情与下一组决策
```

不得为“人物交谈”再调用一次聊天模型、为“派遣调查”再调用一次调查模型。它们只是玩家行动的不同输入形式。

### 1.3 本期不改变主游戏页面

本方案只改变数据、生成、状态和恢复合同。

未经用户再次确认，不得改动：

- 页面三栏布局。
- 左侧身份、目标、资源区域的结构。
- 中间剧情与决策区域的结构。
- 右侧谋划中枢的四个入口及结构。
- 页面已有文字、按钮位置和交互顺序。
- 已确认的视觉样式与滚动结构。

若实现过程中发现必须新增可见状态或按钮，必须单独提出页面变更方案并获得确认；不能在本方案实施时顺手修改。

---

## 2. 当前代码事实与需要替换的部分

### 2.1 当前实现已经具备的正确基础

以下基础不应推倒重来：

1. `StoryContextSnapshotV2` 已经记录角色、用途、工作集、最近正文、上下文报告和快照哈希。  
   证据：`apps/api/src/continuous-story-v2/story-context.ts:128-149`。

2. 上下文编译器已经支持 P0/P1/P2/P3、角色可见性 ACL、必需来源类型和预算失败关闭。  
   证据：`apps/api/src/continuous-story-v2/story-context.ts:151-210`、`:213-325`。

3. P0 或 `mustPreserve` 内容超过预算时，当前代码会拒绝上下文，而不是静默截掉。  
   证据：`apps/api/src/continuous-story-v2/story-context.ts:256-305`。

4. `StoryContextComposerV2` 已经读取最近正文、事实、承诺、条件后手、交互、筹码、关系、开放线程和角色认知。  
   证据：`apps/api/src/continuous-story-v2/story-context.composer.ts:197-240`。

5. 最近正文已经作为 `RECENT_CANON` 进入工作集，当前玩家正在阅读的局势可被标为 P0。  
   证据：`apps/api/src/continuous-story-v2/story-context.composer.ts:332-360`。

6. 数据库已经有可承担大部分长期记忆的模型：

   - `CanonFact`：已确认事实与角色可见范围，`prisma/schema.prisma:920-940`。
   - `CharacterMind`：角色知道、相信和不知道什么，`prisma/schema.prisma:944-961`。
   - `StoryThread`：开放线索、压力和期限，`prisma/schema.prisma:965-982`。
   - `NarrativeEntry`：完整已发布正文，`prisma/schema.prisma:1009-1034`。
   - `ActorTurn`：当前角色的独立剧情轮次，`prisma/schema.prisma:1064-1099`。
   - `ActionResolution`：规则结果、状态补丁、结果正文和下一钩子，`prisma/schema.prisma:1160-1192`。
   - `StoryContextSnapshotV2`：每次生成使用的不可变角色工作集，`prisma/schema.prisma:1305-1333`。
   - `PromptExecutionRecord`：模型调用、耗时、Token 和问题码审计，`prisma/schema.prisma:1335-1375`。

这些模型已经接近“本地 Memory + 当前工作上下文”的正确方向。

### 2.2 当前热路径为什么仍然慢

正常生成目前并不是一次 DeepSeek：

1. Planner 已经是本地确定性步骤。  
   `apps/api/src/continuous-story-v2/story-generation.pipeline.ts:245-260`。

2. Writer 单独调用一次模型。  
   `apps/api/src/continuous-story-v2/story-generation.pipeline.ts:267-278`。

3. Writer 失败硬规则后会进入质量循环，重新调用 Writer。  
   `apps/api/src/continuous-story-v2/story-generation.pipeline.ts:262-333`。

4. 正文通过后，Decision Designer 再单独调用一次模型。  
   `apps/api/src/continuous-story-v2/story-generation.pipeline.ts:352-367`。

5. 决策失败硬规则后也会重新调用 Decision Designer。  
   `apps/api/src/continuous-story-v2/story-generation.pipeline.ts:356-443`。

6. 每一个远程步骤内部还允许多次 `maxStepAttempts`。  
   `apps/api/src/continuous-story-v2/story-generation.pipeline.ts:490-535`。

7. 若打开远程语义审核，Narrative Verifier 和 Decision Verifier 还会增加远程调用。  
   `apps/api/src/continuous-story-v2/story-generation.pipeline.ts:300-316`、`:390-407`。

因此当前最坏情况不是“五个本地步骤”，而是多个串行远程请求与重试叠加。即使每次 DeepSeek 只用十几秒，总等待也会被放大到几十秒或一分钟。

### 2.3 当前上下文仍需收缩和重构

当前上下文编译已经有优先级，但数据选择仍存在两个问题：

1. `CanonFact` 和 `StoryThread` 先按整个 `runId` 查询，再交给通用预算筛选；它没有先通过“当前剧情节点 + 当前行动实体 + 一层因果关系”缩小候选集合。
2. 默认上下文预算可达到约 12,000 Token，且 Writer 与 Decision Designer 会分别获得自己的上下文，增加输入量和延迟。

目标不是简单把预算从 12,000 改成 6,000，而是先让检索只拿相关资料，再进行 P0/P1/P2/P3 装包。

### 2.4 当前需要废止的合同

Solo 热路径必须废止：

- `WRITER → NARRATIVE_VERIFIER → DECISION_DESIGNER → DECISION_VERIFIER` 作为多次远程模型流水线。
- 正常一次点击触发任何自动模型重写。
- 每个 Agent 角色都在 Solo 中排队独立决策。
- 把固定 `actionKey` 菜单改写成“看起来像新选项”的做法。
- 把完整故事圣经、全部人物或整个剧情大纲每轮直接塞进 Prompt。
- 模型失败时生成规则模板故事、固定选项或“局势暂歇”来伪装成功。

本地 Planner、本地硬规则、快照哈希、幂等与审计记录继续保留。

---

## 3. OpenNovel：直接借鉴与明确不照搬

### 3.1 借鉴一：前台模型只读取工作集

OpenNovel 的 `compileForegroundContext()` 只编译前台需要的：

- Foreground Guidance。
- Durable Memory。
- Story Memory。
- Recent Canon Excerpt。
- 当前 Reader Action。

证据：`D:/lyh/AI/openovel/src/context/contextCompiler.js:13-91`。

`Recent Canon` 从已发生正文的尾部保留，而不是把全部章节重新发送。  
证据：`D:/lyh/AI/openovel/src/context/contextCompiler.js:41-57`。

Many Worlds 直接借鉴这一原则，但把字符截断升级为确定性剧情图、实体关联、角色 ACL 和 P0 不可丢失门禁。

### 3.2 借鉴二：稳定内容在前，用户行动在最后

OpenNovel 的 `buildForegroundUserContext()` 把稳定工作集放前面，把 `Reader Action` 放在最后。  
证据：`D:/lyh/AI/openovel/src/context/contextCapsule.js:3-29`。

它还主动去掉每轮变化的时间戳，避免破坏 Prompt Cache 的公共前缀。  
证据：`D:/lyh/AI/openovel/src/context/contextCompiler.js:31-36`。

Many Worlds 应采用相同顺序：

```text
稳定 System Contract
→ 稳定世界/角色最小约束
→ 本轮剧情工作集
→ Recent Canon
→ Rule Resolution
→ Player Action（最后）
```

### 3.3 借鉴三：Recent Canon 是当前连续性的最高权威

OpenNovel 明确要求：如果异步维护的 Foreground Guidance 与最近正文冲突，当前时间、地点、人物位置和刚发生的事件以 Recent Canon 为准。  
证据：`D:/lyh/AI/openovel/src/lib/narrator.js:463-475`。

Many Worlds 同样规定：

> 已发布的最近完整正文代表玩家实际经历过的现在；剧情图和结构化状态控制边界，但不能让模型把已经读到的场景重置掉。

若 Recent Canon 与结构化世界事实发生真正冲突，不能让模型自行选择。上下文编译必须失败并记录 `CANON_STATE_CONFLICT`，由确定性修复任务解决后再生成。

### 3.4 借鉴四：完整 Brief 和 Arc 属于后台资料

OpenNovel 的 `BRIEF.md` 是原始长期意图，`ARC.md` 是后台节奏与伏笔账本；它们主要由初始化、Storykeeper、Director 使用，再转译成前台工作集，而不是每轮原样交给 Narrator。

相关证据：

- `D:/lyh/AI/openovel/src/workflows/storykeeperContext.js:207-217`。
- `D:/lyh/AI/openovel/src/workflows/storykeeperContext.js:253-255`。
- `D:/lyh/AI/openovel/src/workflows/storyInitWorkflow.js:1043-1044`。

Many Worlds 的完整故事圣经和剧情图同样只作为本地权威资料，由编译器选择当前节点和关联实体，不直接成为本轮 Prompt。

### 3.5 不照搬：OpenNovel 当前正文与选项是两次调用

OpenNovel 在正文生成完成后，使用独立 `generateForegroundOptions()` 再调用一次模型。  
证据：`D:/lyh/AI/openovel/src/lib/narrator.js:538-667`。

这一设计保证选项读取最终正文，但不符合 Many Worlds 当前对交互延迟的要求。

Many Worlds 的改进是：

```text
一次模型响应内部严格按顺序输出：
1. story
2. endingState
3. decisions
```

DeepSeek 在生成 `decisions` 时，已经能看到自己刚生成的 `story` 和 `endingState`，因此仍然满足“决策必须根据最终正文末态生成”，但只产生一次远程请求。

### 3.6 不照搬：OpenNovel 的后台 Agent 不进入玩家热路径

OpenNovel 的 Storykeeper、Director、Memory 等属于后台慢循环。Many Worlds 可以未来建设作者工具或离线剧本维护流程，但本期 Solo 玩家每次点击不得等待这些后台 Agent。

---

## 4. 目标总体架构

```text
┌─────────────────────────────────────────────────────────────┐
│ A. 静态故事资料库（本地剧本包，版本化、只读）              │
│ 故事圣经 / 剧情图 / 人物卡 / 地点卡 / 制度规则 / 风格合同  │
└──────────────────────────┬──────────────────────────────────┘
                           │ 当前节点与实体 ID
┌──────────────────────────▼──────────────────────────────────┐
│ B. 动态故事记忆（数据库，当前故事局的权威状态）             │
│ CanonFact / CharacterMind / StoryThread / NarrativeEntry    │
│ ActorTurn / ActionResolution / 资源 / 关系 / 承诺 / 期限    │
└──────────────────────────┬──────────────────────────────────┘
                           │ 确定性选择与 ACL
┌──────────────────────────▼──────────────────────────────────┐
│ C. StoryContextCompiler（本地代码，不调用模型）              │
│ 锚点提取 → 图邻接检索 → P0/P1/P2/P3 → Token 预算 → 快照哈希 │
└──────────────────────────┬──────────────────────────────────┘
                           │ 3k～6k Token 工作包
┌──────────────────────────▼──────────────────────────────────┐
│ D. StoryTurnGenerator（一次 DeepSeek）                       │
│ 正文 → 末态 → 2～4 个下一决策                               │
└──────────────────────────┬──────────────────────────────────┘
                           │ 结构化输出
┌──────────────────────────▼──────────────────────────────────┐
│ E. LocalPublicationGate（本地硬规则，不调用模型）            │
│ Schema / ACL / 因果锚点 / 决策可执行性 / 新鲜度 / 幂等      │
└──────────────────────────┬──────────────────────────────────┘
                           │ 同一数据库事务
┌──────────────────────────▼──────────────────────────────────┐
│ F. 发布下一剧情、下一决策与最新状态                          │
└─────────────────────────────────────────────────────────────┘
```

### 4.1 权威归属

| 内容 | 权威位置 | DeepSeek 是否决定 |
|---|---|---:|
| 完整世界背景 | 本地剧本包 | 否 |
| 当前剧情节点与允许边界 | 剧情图 + 数据库 | 否 |
| 浙江总督的权限与认知 | StoryRole + CharacterMind | 否 |
| 资源、关系、期限、证据 | 数据库 | 否 |
| 玩家行动是否合法 | 本地 ActionGuard | 否 |
| 玩家行动的确定性结算 | RulesArbiter | 否 |
| 下一段如何写成人类故事 | DeepSeek | 是 |
| NPC 可观察反应的写法 | DeepSeek，在边界内 | 是 |
| 新决策的人类语言与差异 | DeepSeek，在边界内 | 是 |
| 是否发布 | 本地 PublicationGate | 否 |
| 持久记忆与存档 | 数据库 | 否 |

DeepSeek 是叙事者，不是数据库、规则引擎或世界管理员。

---

## 5. 静态故事资料：完整保存，但不整包发送

### 5.1 建议剧本包结构

在现有 `packages/templates/config/sangtian/` 下新增版本化故事包：

```text
packages/templates/config/sangtian/story-v2/
├─ manifest.json
├─ story-bible.md
├─ style-contract.md
├─ world-rules.json
├─ story-graph.json
├─ entities/
│  ├─ roles.json
│  ├─ characters.json
│  ├─ factions.json
│  ├─ locations.json
│  ├─ documents.json
│  └─ resources.json
└─ stage-packets/
   ├─ s1-reform-order.json
   ├─ s2-land-deed-case.json
   ├─ s3-grain-crisis.json
   ├─ s4-court-accountability.json
   └─ s5-final-fiscal-choice.json
```

### 5.2 各文件职责

#### `story-bible.md`

保存完整创作真相：历史背景、总冲突、所有秘密、人物真实动机、伏笔、结局可能性。

使用者：作者工具、离线校验器、剧本编译器。  
禁止：运行时每轮直接发送给 DeepSeek。

#### `story-graph.json`

控制当前允许发生什么，而不是提供固定选项。

建议节点结构：

```json
{
  "nodeId": "s2_land_deed_archive_breach",
  "stageId": "s2_land_deed_case",
  "title": "清流县田契档房疑案",
  "entryConditions": ["fact.archive_breach_reported"],
  "requiredFacts": ["fact.county_registers_conflict"],
  "allowedReveals": ["fact.archive_access_trace"],
  "forbiddenReveals": ["secret.capital_mastermind"],
  "activePressures": ["thread.three_day_review"],
  "entityRefs": [
    "role.zhejiang_governor",
    "role.zhejiang_xunfu",
    "location.governor_office",
    "location.qingliu_archive",
    "document.county_register"
  ],
  "adjacentNodeIds": [
    "s2_archive_sealed",
    "s2_evidence_moved",
    "s2_xunfu_countermove"
  ],
  "exitConditions": [
    "fact.archive_sealed",
    "fact.evidence_lost",
    "thread.three_day_review.expired"
  ]
}
```

剧情图只规定：

- 已进入哪个宏观节点。
- 该节点依赖哪些已发生事实。
- 哪些真相现在允许揭露。
- 哪些秘密现在禁止进入玩家视野。
- 哪些相邻节点已满足触发条件。
- 哪些压力必须继续存在或得到兑现。

剧情图不得预写 A/B/C 选项，也不得规定玩家必须按唯一顺序完成任务。

#### `entities/*.json`

每张卡只保存可复用的权威事实和关联 ID。例如人物卡区分：

- publicIdentity。
- authority。
- privateTruth。
- knowledgeByRole。
- currentState 的初始值。
- relationships。
- validNames 与称呼规则。
- relatedLocationIds / documentIds / factionIds。

运行时只加载当前节点或玩家行动涉及的实体卡。

#### `stage-packets/*.json`

这是由完整故事圣经离线编译出的“小型阶段约束包”，包含：

- 阶段目标与边界。
- 当前阶段可能使用的实体 ID。
- 允许揭露与禁止揭露。
- 关键期限和必须兑现的伏笔。
- 该阶段中文叙事风格提醒。

它不是剧情正文，也不是固定选项。

### 5.3 版本冻结

创建故事局时必须记录：

```text
storyPackageVersion
storyPackageHash
storyGraphVersion
promptContractVersion
```

同一故事局继续游戏时必须读取原版本，不能因为本地剧本包更新而悄悄改变已经进行一半的故事。

第一阶段可以把这些值记录在 `StoryRun.stateJson`；稳定后再评估是否升为显式字段。不得为了本方案先创建大量新表。

---

## 6. 动态故事记忆：数据库保存真正发生过的内容

### 6.1 数据分工

| 数据 | 使用模型/字段 | 写入时机 |
|---|---|---|
| 完整玩家可见正文 | `NarrativeEntry.content` | 发布成功时 |
| 当前局势正文 | `ActorTurn.situationNarrative` | 创建下一 Turn 时 |
| 已确认事实 | `CanonFact` | RulesArbiter 确认后 |
| 角色认知 | `CharacterMind` | 事实对该角色可见时 |
| 当前开放压力 | `StoryThread` | 进入、推进、解决或延期时 |
| 行动结算 | `ActionResolution.outcomeJson/statePatchJson` | 模型调用前完成 |
| 下一步必须兑现后果 | `ActionResolution.nextHook` + `StoryThread.stateJson` | 结算时产生 |
| 资源和证据 | `RoleAsset` | 规则事务中更新 |
| 承诺、条件后手、交互 | V2 对应模型 | 规则事务中更新 |
| 本轮工作集 | `StoryContextSnapshotV2` | 调用模型前冻结 |
| 模型调用审计 | `PromptExecutionRecord` | 调用结束后 |

### 6.2 Pending Consequence 合同

OpenNovel 最值得借鉴的不是“长期摘要”，而是上一项行动的后果不能消失。

Many Worlds 中，每个成功结算必须产生 0～N 个 `pendingConsequences`，最少包含：

```json
{
  "consequenceKey": "pc_archive_seal_01",
  "sourceResolutionId": "...",
  "threadKey": "three_day_review",
  "content": "亲随已经携总督令牌出发；巡抚有机会在命令抵达前传递消息。",
  "mustSurfaceByTurn": 1,
  "status": "PENDING"
}
```

实现初期存入 `StoryThread.stateJson.pendingConsequences`，并在下一次 Context Compiler 中作为 P0 `PENDING_CONSEQUENCE` 提取。

发布下一剧情时：

- 已经在正文中可观察兑现的后果标记为 `SURFACED`。
- 仍未到发生时机的后果保持 `PENDING`。
- 过期未兑现必须拒绝发布并记录 `PENDING_CONSEQUENCE_DROPPED`。

### 6.3 Recent Canon 合同

每轮只加载：

1. 当前 `ActorTurn.situationNarrative` 全文。
2. 与当前 Turn 紧邻的上一段结果正文。
3. 必要时再加载一段含当前开放线索起点的正文。

目标不是固定“最近三段”，而是保证：

- 当前场景末态完整。
- 本轮必须兑现的因果来源完整。
- 不让陈旧场景与当前场景竞争权威。

Recent Canon 不能从中间截断。若预算不足，优先减少 P2 历史背景；不能砍掉最新正文尾部或玩家正在阅读的局势。

---

## 7. StoryContextCompiler：像 Codex 一样按需打开相关资料

### 7.1 检索锚点

每轮先用本地代码确定：

```text
roleId              当前角色
currentNodeId       当前剧情节点
stageId             当前宏观阶段
locationId          当前地点
presentEntityIds    当前在场人物与物件
actionTargetIds     玩家行动目标
actionResourceIds   玩家投入的筹码、证据或权限
activeThreadKeys    当前开放压力
pendingConsequenceKeys 上一行动必须兑现的后果
```

推荐决策和四种谋划都有结构化字段，可以直接产生锚点。

自拟自由文本按以下顺序本地识别：

1. 与当前角色可见实体的名称/别名精确匹配。
2. 与当前地点、在场人物和持有资源的类型匹配。
3. 行动动词映射到 `TALK / INVESTIGATE / USE_LEVERAGE / COMMAND / WAIT / REPLY / CUSTOM`。
4. 无法确定目标或同时存在两个互斥解释时，不调用 DeepSeek，直接要求玩家改写为一项明确行动。

不得为自由文本预处理固定增加一次模型调用。

### 7.2 确定性关联检索

候选资料按以下顺序取得：

1. 当前剧情节点自身。
2. 当前节点显式引用的实体卡。
3. 玩家行动目标和资源对应的实体卡。
4. 当前节点中已经满足条件的相邻节点，只取其公开边界，不取未触发真相。
5. 当前 `activeThreadKeys` 对应的开放压力。
6. 上一项规则结果和 Pending Consequence。
7. 当前角色可见的相关 CanonFact、关系、承诺和证据。
8. 最近完整正文。

本期不把向量检索作为 P0 依赖。这个剧本是作者预先设计的结构化故事，ID 和图关系比相似度搜索更可控。未来只可用向量检索补充 P2 历史背景，不能决定事实、权限和剧情节点。

### 7.3 装包优先级

#### P0：缺失即拒绝调用

- 当前角色身份、权限、目标与认知边界。
- 当前节点的允许揭露和禁止揭露。
- 当前时间、地点、在场人物和当前局势全文。
- 玩家本轮行动。
- 已确认规则结算。
- Pending Consequence。
- 最近完整正文末态。

#### P1：行动直接相关

- 行动目标人物、地点、证据、文书、资源。
- 当前开放压力与期限。
- 一层关系和承诺。
- 已满足条件的相邻剧情节点边界。
- 本轮可实际使用的能力。

#### P2：相关长期背景

- 当前制度的简短解释。
- 当前人物过去的重要关系。
- 远期伏笔的非剧透约束。
- 相关历史背景摘要。

#### P3：通常不进入 Prompt

- 其他县、其他阶段、其他角色的无关资料。
- 尚未触发的秘密。
- 完整故事圣经原文。
- 完整事件日志。
- 作者讨论和测试说明。

### 7.4 Token 预算

正常目标：

| 区域 | 预算目标 |
|---|---:|
| 稳定 System Contract + 风格 | 600～1,000 Token |
| 角色与节点边界 | 500～900 Token |
| 当前状态、事实、压力、后果 | 800～1,500 Token |
| Recent Canon | 1,200～2,500 Token |
| 玩家行动与规则结果 | 200～500 Token |
| 总输入 | 通常 3,300～6,000 Token |

规则：

- P0 不能截断；P0 超预算时不调用模型，记录具体缺失项。
- 先丢 P3，再丢低相关 P2，再减少 P1 的非直接关系。
- Recent Canon 以完整段落和末态为单位保留，不按字符从中间切断。
- 编译报告必须记录 included/dropped/reason/tokenEstimate。
- Prompt 中不出现数据库内部 ID；ID 只保留在结构化审计和输出映射中。

### 7.5 DeepSeek 缓存使用方式

DeepSeek 官方说明 `/chat/completions` 是无状态 API；应用必须自己提供每轮上下文：  
<https://api-docs.deepseek.com/guides/multi_round_chat/>

上下文缓存只会复用完全匹配的前缀，属于性能优化，不是故事记忆：  
<https://api-docs.deepseek.com/guides/kv_cache/>

为提高命中率：

- System Prompt 使用固定版本文本。
- 稳定的时代规则、风格合同、浙江总督不变权限放前面。
- 时间戳、runId、turnId、快照哈希不要放在稳定前缀中。
- 动态节点、Recent Canon、规则结果和玩家行动放后面。
- `PromptExecutionRecord.tokenUsageJson` 增加 `promptCacheHitTokens` 与 `promptCacheMissTokens`。

缓存未命中不能影响正确性。

---

## 8. 玩家行动的本地预检与确定性结算

### 8.1 ActionGuard 只阻止真正非法的行动

提交前本地阻止：

- 超出世界观或时代技术。
- 超出浙江总督的制度、物理或资源权限。
- 使用角色不可能知道的信息。
- 直接控制其他人物替其作决定。
- 直接宣布行动结果。
- 同时提交多个相互独立的主要行动。
- 目标不明确到无法结算。
- 与当前已确认事实直接冲突。

允许但有代价：

- 欺骗、隐瞒、越级上奏、扣押、威胁、背叛、销毁证据等高风险行动。
- 只要在时代、身份和因果上可行，系统不以抽象道德规则阻止。

### 8.2 五种输入统一为 `PlayerIntent`

```ts
type PlayerIntent = {
  source: "RECOMMENDED" | "TALK" | "INVESTIGATE" | "LEVERAGE" | "CUSTOM";
  objective: string;
  target: { type: string; id: string; label: string };
  method: string;
  leverageKeys: string[];
  visibility: "PUBLIC" | "LIMITED" | "SECRET";
  riskTolerance: "LOW" | "MEDIUM" | "HIGH";
  fallback: null | { triggerOn: string; method: string };
  freeText: string;
};
```

推荐决策自带完整 `intentDraft`。  
人物交谈必须有目标人物和要问/要表达的内容。  
派遣调查必须有调查对象、范围和可用执行渠道。  
使用筹码必须引用实际持有的 `RoleAsset`。  
自拟谋划必须能归一化为一项主要行动。

### 8.3 RulesArbiter 在模型调用前完成

RulesArbiter 输出：

```ts
type ConfirmedResolution = {
  legality: "LEGAL";
  actionStarted: string;
  immediateObservableResult: string[];
  statePatch: StatePatch;
  spentOrReservedAssets: string[];
  createdCommitments: CommitmentDraft[];
  createdThreads: StoryThreadDraft[];
  pendingConsequences: PendingConsequenceDraft[];
  factsModelMayStateAsConfirmed: string[];
  factsStillUnknown: string[];
};
```

模型只能把这个结果写成故事，不得改写成功等级、资源消耗、已确认事实或玩家原始意图。

如果结果必须依赖尚未发生的远程调查，Arbiter 应确认“调查已经开始”和“何时/通过什么事件能收到结果”，而不是提前决定调查结果。

---

## 9. 单次 DeepSeek 生成合同

### 9.1 正常路径只有一次远程请求

```text
Local ActionGuard
→ Local RulesArbiter
→ Local StoryContextCompiler
→ DeepSeek StoryTurnGenerator × 1
→ Local PublicationGate
→ Database Transaction
```

以下均不得产生额外 DeepSeek：

- Planner。
- Narrative Verifier。
- Decision Verifier。
- 状态摘要。
- NPC 决策。
- 四种谋划输入。
- Prompt 修复。

### 9.2 一个响应内的生成顺序

输出固定顺序：

```json
{
  "schemaVersion": "story-turn-v1",
  "story": {
    "title": "...",
    "resultNarrative": "...",
    "nextSituationNarrative": "..."
  },
  "endingState": {
    "time": "...",
    "location": "...",
    "presentEntityRefs": ["..."],
    "unresolvedPressure": "...",
    "surfacedConsequenceKeys": ["..."]
  },
  "decisions": [
    {
      "id": "d1",
      "label": "...",
      "description": "...",
      "intentDraft": {
        "objective": "...",
        "targetRef": "...",
        "method": "...",
        "leverageKeys": [],
        "visibility": "LIMITED",
        "riskTolerance": "MEDIUM"
      },
      "concreteCost": "...",
      "expectedCountermove": "..."
    }
  ]
}
```

System Prompt 必须要求模型按 `story → endingState → decisions` 顺序输出。因为生成是自回归的，模型写 decisions 时已经看到了刚写完的正文与末态。

本地解析器同时检查原始响应中的键顺序；若 `decisions` 出现在 `story` 前，视为 `OUTPUT_ORDER_INVALID`。

### 9.3 System Prompt 核心合同

System Prompt 应保持短、稳定、版本化，核心内容如下：

```text
你是 Many Worlds 的前台历史权谋叙事者。

你的唯一任务是把已确认的玩家行动和规则结果，继续写成一段真实、连续、
人类能读懂的故事，然后从故事最后一刻生成 2～4 个真实可执行的下一行动。

规则：
1. Recent Canon 是已经真实发生的最高权威，从最后一句无缝继续。
2. 不得修改玩家行动，不得修改 Confirmed Resolution。
3. 只写当前角色能观察和知道的内容。
4. 不得泄露 forbiddenReveals，不得发明未授权具名人物、地点、证据或期限。
5. 正文必须是场景、动作、对话与可观察反应，不是规则摘要、工作报告或选项说明。
6. 先完成 story 和 endingState，再依据这个末态生成 decisions。
7. 每个 decision 是一句普通人能复述的单一行动；不得预告结果。
8. 只输出符合 story-turn-v1 的 JSON。
```

不应继续堆叠几十条为某一轮具体 Bug 编写的长篇规则。剧本特定事实进入本轮工作包；通用语言问题由少量稳定失败模式约束。

### 9.4 User Prompt 结构

```text
# 本轮剧情边界
当前节点：清流县田契档房疑案
本轮允许推进：档案封存、巡抚反应、证据转移风险
禁止揭露：京中幕后主使、尚未触发的商会最终交易

# 浙江总督当前处境
时间、地点、身份、真实权限、认知边界

# 本轮相关人物、物件与事实
只包含当前节点和本轮行动直接涉及的卡片

# 当前压力与必须兑现的后果
三日复核期限
亲随已经携令牌出发
巡抚可能在命令抵达前传递消息

# Recent Canon
最近完整正文，从玩家实际读到的场景末态结束

# Confirmed Resolution
行动合法；亲随出发；总督令牌暂时被占用；档房是否及时封存仍未知

# Player Action
派亲随携总督令牌赶赴清流县田契档房，封存现场并查勘潜入痕迹。
```

`Player Action` 必须是最后一个语义区块。

### 9.5 浙江总督示例输出

```json
{
  "schemaVersion": "story-turn-v1",
  "story": {
    "title": "令牌出府",
    "resultNarrative": "郑帅彬把令牌推到案边，亲随双手接过，没有多问，只把公文折进贴身的油布袋。院门开启时，巡抚立在廊下，看见那面令牌，目光在亲随腰间停了一瞬。",
    "nextSituationNarrative": "马蹄声出了总督府，巡抚却没有立刻告退。他回身问道：‘大人既已派人去清流县，三日后的复核，是仍按原议会同开册，还是由总督府独自具结？’外厅的书吏捧着两份数字不一的县册候在门边。亲随能否赶在消息之前封住档房，此刻还没有答案。"
  },
  "endingState": {
    "time": "当日傍晚",
    "location": "杭州总督府内厅",
    "presentEntityRefs": ["role.zhejiang_governor", "role.zhejiang_xunfu", "npc.office_clerk", "document.county_register"],
    "unresolvedPressure": "巡抚要求浙江总督当场表明三日复核由谁具结。",
    "surfacedConsequenceKeys": ["pc_archive_seal_01"]
  },
  "decisions": [
    {
      "id": "d1",
      "label": "请巡抚留下，把两份县册当面逐项核对。",
      "description": "先把眼前能确认的差异查清，也让巡抚无法立刻离开传话。",
      "intentDraft": {
        "objective": "拖住巡抚并核清县册差异",
        "targetRef": "role.zhejiang_xunfu",
        "method": "请他留在内厅，与书吏当面核对两份县册",
        "leverageKeys": [],
        "visibility": "LIMITED",
        "riskTolerance": "MEDIUM"
      },
      "concreteCost": "必须当场承担复核进度被拖慢的责任",
      "expectedCountermove": "巡抚可能拒绝留下，或要求总督先明确具结责任"
    },
    {
      "id": "d2",
      "label": "答应会同复核，但让巡抚先在催办公文上署名。",
      "description": "不给他公开翻脸的借口，同时留下他参与催办的书面痕迹。",
      "intentDraft": {
        "objective": "留下巡抚参与催办的书面责任",
        "targetRef": "role.zhejiang_xunfu",
        "method": "口头答应会同复核，请他先在现有催办公文上署名",
        "leverageKeys": [],
        "visibility": "PUBLIC",
        "riskTolerance": "MEDIUM"
      },
      "concreteCost": "浙江总督也公开承诺按期复核",
      "expectedCountermove": "巡抚可能以无此先例为由拒绝署名"
    },
    {
      "id": "d3",
      "label": "不谈具结，只问巡抚为何急着把责任推回总督府。",
      "description": "直接试探他的真实顾虑，但可能让双方当场撕破表面合作。",
      "intentDraft": {
        "objective": "试探巡抚急于划清责任的原因",
        "targetRef": "role.zhejiang_xunfu",
        "method": "当面追问他为何反复催促总督府独自具结",
        "leverageKeys": [],
        "visibility": "LIMITED",
        "riskTolerance": "HIGH"
      },
      "concreteCost": "双方互信可能立即下降",
      "expectedCountermove": "巡抚可能反指总督拖延朝廷急令"
    }
  ]
}
```

示例只展示语言和合同，不得在实际 Prompt 中作为固定菜单提供给模型。

---

## 10. 本地 PublicationGate：少而硬，不让门禁变成第二个作者

### 10.1 发布硬门禁

只把以下问题作为阻止发布的硬错误：

1. JSON 或 Schema 无法解析。
2. 缺少正文、末态或少于两项有效决策。
3. 玩家行动没有在 `resultNarrative` 中发生或明确受阻。
4. 与 Confirmed Resolution 直接冲突。
5. 泄露当前角色无权知道的精确秘密或禁揭露实体。
6. 使用当前不存在的具名角色、地点、证据、资源或文书。
7. 决策目标不在当前角色可见/可接触范围，且行动没有先取得接触。
8. 决策使用未持有筹码或越过身份权限。
9. Recent Canon 的时间、地点或在场人物被无解释重置。
10. 上一轮 P0 Pending Consequence 被完全丢失。
11. 上下文快照在提交前已过期。

### 10.2 软质量问题只记录，不自动重写

以下问题进入质量报告和人工测试，不应触发本轮再次调用 DeepSeek：

- 文风不够有感染力。
- 句式重复。
- 描写略显平淡。
- 决策差异还可以更强。
- 某些语言仍稍像公文。
- 标题不够好。

这些问题应通过修改故事包、工作集或稳定 Prompt，在下一轮/下一次测试中整体改进；不能让线上玩家等待模型反复改稿。

### 10.3 局部保留策略

若正文通过，但一项决策失败：

- 删除失败决策。
- 剩余有效决策不少于 2 项则发布。
- 少于 2 项则本轮标记为可重试失败。
- 绝不能用本地固定文字补出第三项。

### 10.4 禁止语义清洗正文

本地只能安全处理：

- 去掉意外 Markdown fence。
- 统一换行和首尾空白。
- 校验长度与编码。

不得用正则把人物、地点、证据替换成另一种叙事内容。正则“修故事”会让正文变得断裂，也会掩盖 Prompt 或故事包的真实问题。

---

## 11. 失败、超时、重试与状态机

### 11.1 状态机

```text
OPEN
→ ACTION_ACCEPTED
→ RESOLVING_LOCAL
→ GENERATING
→ VALIDATING_LOCAL
→ PUBLISHED
```

失败分支：

```text
RESOLVING_LOCAL
→ ACTION_REJECTED（玩家输入不合法，未调用 DeepSeek）

GENERATING / VALIDATING_LOCAL
→ GENERATION_FAILED_RETRYABLE
→ RETRY_QUEUED
→ GENERATING

任何阶段发现上下文过期
→ SUPERSEDED
→ 读取最新 Turn，不覆盖新状态
```

不得出现没有租约、没有超时、没有失败原因的永久 `RESOLVING`。

### 11.2 正常请求不自动多次调用

一次玩家请求的远程调用上限为 1。

只有以下极端情况允许另一轮调用，而且必须是新的、有审计记录的恢复任务，不是同一 HTTP 请求里静默重试：

- 网络连接中断。
- DeepSeek 429/5xx。
- 空响应或输出被截断。
- JSON 结构完全无法恢复。
- 本地硬门禁失败且没有可发布的正文/决策组合。

恢复规则：

- 自动恢复最多 1 次，指数退避后由 Outbox 执行。
- 使用相同 `contextSnapshotHash`、`submissionId` 和幂等键。
- 若世界状态已经变化，旧任务标记 `SUPERSEDED`，不再重试。
- 第二次仍失败则保持 `GENERATION_FAILED_RETRYABLE`，向用户提供明确重试，而不是无限循环。
- 不发布固定故事、固定选项或“局势暂歇”。

### 11.3 幂等键

```text
storyTurnGenerationKey =
sha256(runId + roleId + actorTurnId + submissionId + contextSnapshotHash + promptContractVersion)
```

相同键只能产生一个已发布结果。刷新页面、重复点击和 Outbox 重放只能读取同一结果，不能再次推进章节。

### 11.4 延迟目标

在本地网络与 DeepSeek 正常可用的测试环境：

| 指标 | 目标 |
|---|---:|
| DeepSeek 远程调用数/正常 Turn | 1 |
| Prompt 输入 | 通常 ≤ 6,000 Token |
| 输出 | 通常 ≤ 1,800 Token |
| p50 从提交到发布 | ≤ 12 秒 |
| p95 从提交到发布 | ≤ 25 秒 |
| 硬超时 | 30 秒 |
| 超时后状态落库 | ≤ 1 秒进入 `GENERATION_FAILED_RETRYABLE` |

性能报告必须拆分：

```text
actionGuardMs
rulesArbiterMs
contextCompileMs
deepSeekLatencyMs
localValidationMs
transactionMs
totalMs
promptTokens
completionTokens
promptCacheHitTokens
promptCacheMissTokens
```

不能只报告“总共 64 秒”，而不说明时间花在哪一步。

---

## 12. Solo 中 NPC 的实现

### 12.1 本期合同

浙江巡抚、清流县令、改桑书吏、江南商会会首、司礼监织造使等，在 Solo 中作为 NPC：

- 它们的身份、目标、秘密、资源和关系存于剧本包与数据库。
- 它们在当前场景中的可观察反应由同一次 StoryTurnGenerator 写出。
- 它们不能被玩家直接控制。
- 它们不能泄露浙江总督不应知道的内部动机。
- 它们的重要离场行动、资源变化和事实变化必须由 RulesArbiter/剧情图确认后才成为 Canon。

### 12.2 不再为 NPC 创建玩家阻塞任务

Solo 玩家热路径不得等待：

- 五个 Agent 各自生成候选行动。
- 五个 Agent 各自生成故事。
- Agent 决策队列清空。

若剧情图规定某个 NPC 必须在玩家行动后采取反制，本地规则先产生 `npcReactionBoundary`：

```json
{
  "npcRef": "role.zhejiang_xunfu",
  "allowedReaction": "追问具结责任，并尝试保留自身回旋余地",
  "cannotReveal": ["secret.capital_contact"],
  "mayChangeState": []
}
```

同一次 DeepSeek 把它写成自然对话或动作。只有未来重新开发多人模式时，才恢复独立 Agent 角色线程。

---

## 13. 具体代码改造清单

### 13.1 `story-generation.pipeline.ts`

文件：`apps/api/src/continuous-story-v2/story-generation.pipeline.ts`

改造：

1. 新增 `TURN_GENERATOR`，替代热路径中的 `WRITER` 与 `DECISION_DESIGNER`。
2. `buildLocalStoryPlan()` 保留，但只作为本地 Prompt 输入，不单独生成玩家可见内容。
3. 新建 `buildStoryTurnUserPrompt()`，将本轮小型工作集、Recent Canon、规则结果和玩家行动按固定顺序组装。
4. 新建 `parseStoryTurnOutput()`，一次解析 story、endingState、decisions。
5. 正常 `generate()` 只执行一次 `modelClient.generate()`。
6. 删除正常路径的 `qualityAttempt` 模型重写循环。
7. 本地硬规则检查保留并收缩为第 10 章的发布硬门禁。
8. 软质量分数写入 `ContentQualityReview`，不得再次调用模型。
9. `maxStepAttempts` 在热路径固定为 1；恢复任务在服务层创建新的 attempt。

### 13.2 新增 `story-turn.prompt.ts`

建议文件：`apps/api/src/continuous-story-v2/story-turn.prompt.ts`

职责：

- 稳定 System Prompt。
- Prompt 版本号。
- 动态 User Prompt 组装。
- 固定输出顺序合同。
- 不能包含固定决策菜单或故事示例。
- Prompt 单元测试可直接读取结构区块顺序。

### 13.3 新增 `story-turn.output.ts`

建议文件：`apps/api/src/continuous-story-v2/story-turn.output.ts`

职责：

- JSON Schema/运行时解析。
- 原始键顺序校验。
- 字段长度与枚举校验。
- `targetRef`、`leverageKeys` 与工作集实体映射。
- 有效决策局部保留。
- 生成 `ContentQualityReview`。

### 13.4 `story-narrative.provider.ts`

文件：`apps/api/src/continuous-story-v2/story-narrative.provider.ts`

改造：

- `TURN_GENERATOR` 使用 `deepseek-chat`，关闭 thinking。
- 单次最大输出约 1,800 Token，根据真实压测调整。
- 超时 30 秒。
- 正常路径不在 Provider 内自动重试。
- 记录 HTTP 状态、DeepSeek request id、缓存命中 Token 和实际 latency。
- 不提供 deterministic prose fallback。
- `PromptExecutionRecord` 每个正常 Turn 只允许一条 `provider=deepseek,pipelineStep=TURN_GENERATOR,status=SUCCESS`。

### 13.5 `story-context.composer.ts`

文件：`apps/api/src/continuous-story-v2/story-context.composer.ts`

改造：

- 查询前先取得当前 node、action target、resources、active thread keys。
- `CanonFact` 按 factKey/节点/角色已知集合查询，不再默认取得整个 run 的全部 confirmed facts。
- `StoryThread` 只取 `activeThreadKeys`、deadline 到期项和 Pending Consequence 来源。
- 加载当前节点显式引用的 entity cards 和已满足条件的邻接节点边界。
- Recent Canon 保留完整段落与末态，不简单按固定条数或字符截断。
- 新增 `STORY_NODE_BOUNDARY`、`PENDING_CONSEQUENCE`、`STYLE_CONTRACT` 来源类型。
- 编译结果继续持久化和哈希。

### 13.6 `story-context.ts`

文件：`apps/api/src/continuous-story-v2/story-context.ts`

改造：

- 扩展来源类型。
- 为每种生成用途定义更小的默认必需集合。
- 加入按关联距离排序：直接锚点 > 一层邻接 > P2 背景。
- P0 仍然 fail-closed。
- Report 增加 `retrievalAnchors`、`graphNodeIds`、`entityRefs`、`relevanceReason`。
- 增加 `stablePrefixHash`，用于审计 Prompt Cache 的稳定性。

### 13.7 `continuous-story-v2.service.ts`

文件：`apps/api/src/continuous-story-v2/continuous-story-v2.service.ts`

改造：

- 把 ActionGuard、RulesArbiter、Context、一次生成、校验、发布编排为清楚的状态机。
- 生成任务获得带过期时间的 lease。
- 捕获错误后必定离开 `RESOLVING`。
- 发布时使用事务和条件更新：仅当前 turn revision/context hash 一致才能提交。
- 下一 `ActorTurn` 与 `DecisionSet` 同一事务创建，避免“正文有了但下一步没有”。
- 四种谋划与推荐决策统一调用同一 `submitPlayerIntent()`。

### 13.8 `story-task-outbox.service.ts`

文件：`apps/api/src/story-task-outbox.service.ts`

改造：

- 只处理极端失败的恢复，不承担正常故事流水线的多 Agent 执行。
- 同一 generation key 自动恢复最多一次。
- lease 超时后可由另一个 Worker 接管。
- 状态过期则标记 `SUPERSEDED`，不再写回。

### 13.9 共享 Schema

文件：`packages/shared/src/continuous-strategy/story-v2.schemas.ts`

改造：

- 新增 `StoryTurnOutputV1`。
- 五种 `PlayerIntent.source`。
- `PendingConsequence`。
- `StoryGenerationStatus`。
- API 对外错误码与可重试标识。

### 13.10 剧本 Loader

文件：

- `packages/templates/src/continuous-strategy/loader.ts`
- `packages/templates/src/index.ts`

改造：

- 加载 `story-v2/manifest.json`。
- 校验故事图节点、边、实体引用和 reveal 边界。
- 提供 `getStoryNode()`、`getRelatedEntityCards()`、`getStagePacket()`。
- 启动时失败关闭，不能在缺失节点时临时用固定模板代替。

### 13.11 前端只做合同兼容，不改布局

只允许在现有数据客户端中：

- 读取新的失败状态。
- 发布成功后自动刷新现有剧情与决策数据。
- 刷新页面时读取数据库中的当前 Turn。

不得以本任务为由修改 CSS、卡片位置、标题、顶部指标或谋划中枢布局。

---

## 14. 开发步骤与停止条件

### 阶段 A：冻结 UI 与建立基线

任务：

1. 保存当前主游戏页面结构测试与截图哈希。
2. 记录当前浙江总督新局从开场到下一局势的 API/DB 基线。
3. 从 `PromptExecutionRecord` 统计当前一轮实际 DeepSeek 调用数与分步耗时。
4. 禁止在本任务中修改 UI 文件。

完成条件：

- 能指出当前一轮每次 DeepSeek 的 step、耗时和 Token。
- 页面结构测试作为后续回归门禁。

### 阶段 B：建立 `story-v2` 剧本包

任务：

1. 从现有桑田诏配置和完整故事文档抽取故事圣经。
2. 建立剧情图、实体卡、阶段约束包与风格合同。
3. Loader 校验所有引用和边界。
4. 为浙江总督第一至第二宏观阶段编写足够的图节点，先支持真实测试，不一次铺满所有无关资料。

完成条件：

- 所有节点引用存在。
- 每个节点有 allowed/forbidden reveals。
- 不存在固定 A/B/C 菜单。
- 完整 Bible 不进入运行时 Prompt 快照。

### 阶段 C：重构上下文编译

任务：

1. 实现锚点提取。
2. 实现剧情图邻接检索。
3. 增加 Pending Consequence。
4. 收缩查询与 Token 预算。
5. 建立 Prompt Cache 稳定前缀报告。

完成条件：

- 浙江总督第一轮工作包只含当前节点相关资料。
- 未触发秘密在 DB 中存在，但不进入快照。
- P0 超预算会拒绝，不会截断。
- 工作包通常不超过 6,000 Token。

### 阶段 D：合并为一次 DeepSeek

任务：

1. 实现 `StoryTurnOutputV1`。
2. 实现稳定 System Prompt 和动态 User Prompt。
3. 用 `TURN_GENERATOR` 替换 Writer + Decision Designer 热路径。
4. 删除热路径自动重写与远程 Verifier。
5. 本地硬门禁支持决策局部保留。

完成条件：

- Fake Client 测试证明每个正常 Turn 只调用 `generate()` 一次。
- `PromptExecutionRecord` 证明 live Turn 只有一次 DeepSeek。
- 正文在输出中先于 decisions。

### 阶段 E：状态机和原子发布

任务：

1. 落实失败状态、lease、幂等和恢复。
2. 同一事务发布正文、决策、下一 Turn 和状态补丁。
3. 处理刷新、重复点击和上下文过期。
4. Solo 不再排队五个 Agent 任务。

完成条件：

- 任何失败 1 秒内离开无期限 `RESOLVING`。
- 刷新后读取同一个当前 Turn。
- 重复提交不会生成第二段故事。
- NPC 队列不阻塞浙江总督。

### 阶段 F：四种谋划统一验收

分别建立四个独立新局或可重复 Fixture：

1. 人物交谈。
2. 派遣调查。
3. 使用筹码。
4. 自拟谋划。

每个必须完整通过：

```text
看剧情
→ 使用该谋划
→ 本地结算
→ 一次 DeepSeek
→ 自动出现真实下一剧情
→ 自动出现真实下一决策
```

完成条件：四条真实可见 UI 旅程全部通过，不接受直接 API 注入代替。

### 阶段 G：浙江总督多轮真人质量验收

至少完成：

- 3 个全新故事局。
- 每局至少 7 次连续真实行动。
- 推荐决策至少 8 次。
- 四种谋划每种至少 3 次。
- 合法自由输入至少 6 次。
- 非法/模糊自由输入至少 6 次。
- 至少一次 DeepSeek 超时恢复。
- 至少一次重复提交幂等验证。

停止条件：任何一轮出现 P0 问题，立即停止该验收局并修复根因后从新局重跑；不能跳过问题继续累计轮数。

---

## 15. 测试矩阵

### 15.1 单元测试

#### Context Compiler

- P0 全部保留。
- 当前角色看不到其他角色私密事实。
- 未触发剧情节点的 secret 不进入快照。
- 玩家行动实体自动进入 P1。
- 一层关系可进入，二层无关关系被丢弃。
- Recent Canon 末态完整保留。
- Pending Consequence 必须进入 P0。
- 完整 `story-bible.md` 内容不进入 Prompt。
- 稳定前缀不含 runId、turnId、时间戳。

#### Prompt

- `Player Action` 是最后语义区块。
- 不包含固定 `allowedNextDecisions`。
- 不包含 deterministic safety prose draft。
- 不包含未来 forbidden reveal。
- System Prompt 版本固定且可哈希。
- 输出顺序明确为 story → endingState → decisions。

#### Output Parser/Gate

- 正常 JSON 解析。
- Markdown fence 可安全剥离。
- 决策在 story 前时拒绝。
- 一项非法决策被删除、其余两项可发布。
- 少于两项有效决策时失败。
- 未持有筹码的决策失败。
- 具名未授权人物失败。
- 玩家行动消失时失败。
- Pending Consequence 消失时失败。

#### 状态机

- 每个状态有明确出边。
- timeout 必然进入 retryable。
- retry 上限为 1。
- stale context 只能 supersede。
- 重复请求返回同一结果。

### 15.2 集成测试

1. 新建浙江总督 Solo 局，Opening 工作包编译成功。
2. 推荐决策提交后只产生一次 provider 调用。
3. RulesArbiter 的 statePatch 与发布故事一致。
4. NarrativeEntry、DecisionSet、下一 ActorTurn 同事务存在。
5. 当前剧情节点按事实条件推进，不按固定轮数强行跳转。
6. DeepSeek 429/5xx 时恢复任务复用快照和幂等键。
7. 服务重启后能够继续同一局。
8. 其他 NPC 没有阻塞队列。

### 15.3 Live DeepSeek 内容测试

每次保存：

- 输入工作包快照。
- 原始模型输出。
- 发布后正文和决策。
- 调用数、延迟、Token、缓存命中。
- 本地质量报告。
- 真人审阅结论。

禁止只运行 Mock 后声称真实剧情已通过。

### 15.4 真人剧情评分表

每一段 0～2 分：

| 维度 | 0 分 | 1 分 | 2 分 |
|---|---|---|---|
| 连续性 | 重置/矛盾 | 基本衔接 | 从最后一刻自然继续 |
| 行动兑现 | 决策消失 | 提到但后果弱 | 行动清楚发生并改变局面 |
| 场景真实 | 规则摘要 | 有少量场景 | 人物、动作、对话、环境自然 |
| 身份真实 | 谁都能做 | 大致符合官职 | 明确利用浙江总督真实权限与困境 |
| 认知边界 | 泄露秘密 | 偶有上帝视角 | 只呈现可知与可观察内容 |
| 因果压力 | 没有后果 | 有泛化风险 | 代价、期限与他人反应具体 |
| 人类语言 | 项目/机制语言 | 略生硬 | 像人类历史故事正文 |

发布验收要求：

- 单段总分至少 12/14。
- 连续性、行动兑现、认知边界任一不得为 0。
- 3 局 × 7 次连续行动的平均分至少 12.5/14。

### 15.5 真人决策评分表

每一组 0～2 分：

| 维度 | 0 分 | 1 分 | 2 分 |
|---|---|---|---|
| 可理解 | 看不懂 | 勉强理解 | 一眼知道要做什么 |
| 可执行 | 越权/无对象 | 部分可行 | 此刻真实可执行 |
| 末态一致 | 落后/重做 | 大致对应 | 从正文最后一刻自然出发 |
| 差异性 | 同义改写 | 有部分差异 | 风险、方向、承诺明显不同 |
| 不剧透 | 直接写结果 | 有暗示 | 只写行动，不写结果 |
| 浙江总督视角 | 通用模板 | 大致符合 | 像该角色会认真考虑的选择 |

发布验收要求：

- 每组至少 10/12。
- 可理解、可执行、末态一致任一不得为 0。
- 不得出现本方案列出的机制语言反例。

### 15.6 可见 UI 旅程

必须通过真实浏览器：

```text
主页
→ 世界详情
→ Solo 新局
→ 默认选择第一个角色浙江总督
→ 看到开场剧情
→ 选择/输入行动
→ 看到推演状态
→ 自动看到下一剧情和决策
→ 刷新页面
→ 仍停在同一最新进度
```

不接受：

- 直接调用 API。
- 直接写数据库。
- DOM 注入点击。
- 用旧截图代替本次结果。
- 跳过第一个失败页面继续验证。

### 15.7 UI 不变验收

- 主页面三栏结构不变。
- 左侧既有资源指标仍显示。
- 右侧谋划中枢四个入口仍显示。
- 中间剧情和决策使用原布局。
- 页面滚动仍可用。
- 当前局势顶部隐藏规则保持现状。
- 结构截图与阶段 A 基线比较；差异只允许来自剧情文字和数据值。

---

## 16. 可观测性与问题定位

### 16.1 每轮审计记录

```json
{
  "generationKey": "...",
  "runId": "...",
  "roleId": "...",
  "turnId": "...",
  "currentNodeId": "...",
  "contextSnapshotHash": "...",
  "storyPackageVersion": "...",
  "promptContractVersion": "story-turn-prompt-v1",
  "remoteCallCount": 1,
  "latency": {
    "contextCompileMs": 42,
    "deepSeekMs": 8420,
    "validationMs": 18,
    "transactionMs": 31,
    "totalMs": 8511
  },
  "tokens": {
    "prompt": 4310,
    "completion": 1230,
    "cacheHit": 780,
    "cacheMiss": 3530
  },
  "status": "PUBLISHED",
  "issueCodes": []
}
```

### 16.2 管理查询必须能回答

- 这一轮为什么用了 30 秒？
- DeepSeek 实际调用了几次？
- 哪一部分上下文占 Token 最多？
- 哪些资料因预算被丢弃？
- Prompt 是否含完整 Bible 或无关角色秘密？
- 玩家行动是否进入 Prompt 最后？
- 为什么某个决策被删除？
- 为什么进入 retryable？
- 刷新后为什么读取这个 Turn？

若日志不能回答这些问题，就不能称为可测试实现。

---

## 17. 风险与处理

### 风险一：一次输出同时包含正文和决策，JSON 更长

处理：

- 使用固定 Schema 和 `response_format=json_object`。
- 限制正文与决策字段长度。
- 关闭 thinking。
- 输出上限约 1,800 Token，压测后调整。
- 决策只保留玩家可见 label/description 与必要 intentDraft，不让模型输出整个世界状态。

### 风险二：决策可能没有真正依据刚生成的正文

处理：

- 强制 story 和 endingState 在 decisions 前输出。
- decisions 的 targetRef 必须来自 endingState 或工作集 affordance。
- 本地检查决策是否重做已完成行动。
- 真人验收末态一致性。

### 风险三：本地硬门禁仍可能误杀好内容

处理：

- 只保留事实、ACL、Schema、资源和时间连续性硬规则。
- 文风判断降为软评分。
- 删除“为了某个 Bug 不得出现某个普通词”的脆弱规则。
- 统计每个 issue code 的误杀率；误杀率高的规则下调为软规则。

### 风险四：故事图变成新的固定剧本

处理：

- 节点只定义边界、事实与邻接，不定义选项。
- 玩家可以产生新 StoryThread。
- 节点进入和退出由事实条件决定，不由“第几轮必须发生什么”决定。
- DeepSeek 仍负责当前节点内的具体人物互动和叙事表达。

### 风险五：完整故事资料更新后污染进行中的存档

处理：

- Run 固定 package version/hash。
- 新版本只用于新局。
- 旧局迁移必须是显式工具，不自动发生。

### 风险六：自由输入无法本地结构化

处理：

- 优先使用当前可见实体别名与行动类型解析。
- 无法唯一确定时要求用户写成一项明确行动，不消耗 DeepSeek。
- 不把“猜测用户意图”交给 Writer 后再让 RulesArbiter追认。

---

## 18. 架构决策记录（ADR）

### Decision

Solo 玩家热路径采用：

> 本地权威资料 + 确定性剧情图 + 角色工作集编译 + 一次 DeepSeek 同时生成正文与下一决策 + 本地硬门禁 + 原子持久化。

### Drivers

1. 真实剧情与真实决策必须同时从当前末态产生。
2. 玩家不能为多次模型流水线等待几十秒或一分钟。
3. 世界事实和存档不能依赖无状态模型或临时缓存。
4. 失败必须可恢复，不能伪造固定内容或永久卡住。

### Alternatives considered

#### 方案 A：保留 Writer 与 Decision Designer 两次调用

优点：边界清晰，Decision Designer 能读取最终正文。  
缺点：至少两次串行网络延迟，配合重试和 Verifier 容易达到几十秒。  
结论：不适合当前 Solo 热路径。

#### 方案 B：一次 DeepSeek 输出正文与决策（选定）

优点：延迟最低；模型生成决策时仍能读取自己刚生成的正文；结构可审计。  
缺点：需要更严格的单响应 Schema 和本地解析。  
结论：最符合当前产品目标。

#### 方案 C：把完整故事和会话交给 DeepSeek 记忆

优点：应用代码表面简单。  
缺点：DeepSeek chat API 无状态；缓存不保证命中且会过期；角色 ACL、存档与因果无法可靠控制。  
结论：不可作为产品架构。

#### 方案 D：每轮发送完整故事圣经

优点：模型表面上拥有全部背景。  
缺点：Token、延迟、秘密泄露和注意力污染严重，未来真相会提前进入当前角色上下文。  
结论：明确禁止。

### Consequences

- 剧本作者需要维护剧情图和实体引用，而不只是写一篇大纲。
- DeepSeek Prompt 变短，但本地 Context Compiler 和状态模型更重要。
- 质量改进主要通过剧本包、工作集和稳定 Prompt 迭代，而不是线上多次重写。
- Solo NPC 反应更快，但重要世界变化仍必须先经过规则层。

### Follow-ups

- Solo 完整验收通过前，不恢复多人开发。
- Solo 稳定后，再讨论多人独立异步线程如何复用同一 StoryContextCompiler 与单次生成合同。
- 后台 Storykeeper/Director 若未来引入，只能离线维护剧本包或异步生成作者建议，不能阻塞玩家热路径。

---

## 19. 最终验收门禁

以下全部满足，才能宣布本方案实现完成：

### 功能

- [ ] 新用户能创建全新 Solo 局。
- [ ] 老用户能继续数据库中的未完成局，也能明确新开。
- [ ] 浙江总督开场有真实完整剧情。
- [ ] 推荐决策是自然、可执行的人类语言。
- [ ] 人物交谈可完成完整下一剧情链。
- [ ] 派遣调查可完成完整下一剧情链。
- [ ] 使用筹码可完成完整下一剧情链。
- [ ] 自拟谋划可完成完整下一剧情链。
- [ ] 合法自由行动可推进。
- [ ] 非法或模糊行动在调用模型前阻止。
- [ ] Solo 不等待五个 NPC Agent。

### 模型调用

- [ ] 每个正常 Turn 恰好一次 DeepSeek。
- [ ] 没有远程 Narrative/Decision Verifier。
- [ ] 没有同一请求内的模型自动重写。
- [ ] Prompt 通常不超过 6,000 Token。
- [ ] 完整 Bible、完整大纲和无关秘密不进入 Prompt。
- [ ] 玩家行动位于 Prompt 最后。
- [ ] story 在 decisions 前生成。

### 质量

- [ ] 3 局 × 7 次浙江总督连续行动完成。
- [ ] 剧情平均至少 12.5/14。
- [ ] 决策每组至少 10/12。
- [ ] 玩家上一行动没有消失。
- [ ] 没有规则摘要、机制语言、固定通用选项。
- [ ] 没有越权、上帝视角或未触发秘密泄露。

### 稳定性

- [ ] p50 ≤ 12 秒、p95 ≤ 25 秒。
- [ ] 30 秒超时后进入 retryable，不永久 `RESOLVING`。
- [ ] 自动恢复最多一次。
- [ ] 重复点击与刷新不重复推进。
- [ ] 服务重启后继续同一数据库进度。
- [ ] 下一剧情、下一决策和下一 Turn 原子发布。

### UI

- [ ] 主游戏页面文字与布局未变。
- [ ] 左侧身份、目标、资源未消失。
- [ ] 右侧四种谋划未消失。
- [ ] 中间长剧情可以正常滚动阅读。
- [ ] 结构截图与开发前基线一致。

任何一项未通过，都必须明确报告为未完成；不得以单元测试、Mock、旧截图或直接 API 成功代替真人可见 Solo 闭环。

---

## 20. 实施结论

正确实现不是“继续把现有 Prompt 写得更长”，也不是“再增加一个质量 Agent”。

最终合同是：

```text
完整故事圣经负责长期权威，但不直接进 Prompt；
剧情图负责控制当前允许发生的范围，但不提供固定选项；
数据库保存真正发生的故事、事实、资源、关系和后果；
StoryContextCompiler 像 Codex 打开相关文件一样，只编译当前角色本轮需要的小型工作集；
RulesArbiter 先确定玩家行动的事实边界；
DeepSeek 每个正常 Turn 只调用一次，先写真实故事，再写基于故事末态的真实决策；
本地硬门禁负责安全和一致性，不负责反复重写文学；
发布结果原子写回数据库，下一轮从 Recent Canon 最后一刻继续。
```

这才是本期 Solo Play 的完成标准：

> 玩家以浙江总督的身份读到可信的故事，做出自己真正能够做出的决定，几秒到二十多秒内看到这个决定改变了什么，并立即面对新的、同样真实的局面。
