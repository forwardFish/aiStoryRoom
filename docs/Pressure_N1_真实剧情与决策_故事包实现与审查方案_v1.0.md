# Pressure N1“真实剧情 + 决策”故事包实现与审查方案 v1.0

> 状态：IMPLEMENTED_AWAITING_PLAYER_RUN。聚焦类型检查与自动化已通过，真实玩家效果尚未验收。
>
> 目的：供项目所有者与 ChatGPT Pro 审查。本文不把“代码已写”误报为“效果已通过”。

## 1. 本轮只解决什么

在真实 `/game` 的 N1 最小纵切里完成一条连续体验：

1. 新 Run 先显示原有完整统一开场白；
2. 进入 N1 后显示公共现场、当前角色私人压力和迫近决策的事件；
3. 剧情与决策选项保持在同一页面上下文中；
4. 玩家选择后，Narrator 根据本轮真实六席行动和权威 Working 结果写下一段剧情；
5. 开发侧输出本次 Narrator 实际收到的“故事包”，项目所有者可以逐项核对数据来源。

本轮不新增剧情引擎、状态机、数据库表、migration、API endpoint、页面或公共 `TurnPresentation` 合同；不修改 Settlement 权威，不扩展 N2-N7。

## 2. 最重要的数据权威表

| 故事包内容 | 实际权威来源 | 当前代码怎样取 | 明确不能从哪里取 |
|---|---|---|---|
| 世界和文风 | 当前已校验的桑田 Pressure Story Package | `pressure-spine-v1.0/source/global/pressure-spine.json` 的 N1 pressure/invariants，加 `narrative-style.md` | 不由模型临时发明；不使用旧的双角色 `story-package.json` 代替六席内容 |
| 当前场景 | N1 `scene-flow.json` | 公共 `scene.n1.opening.public` + 当前席位唯一 `PRIVATE_OPENING` + `scene.n1.npc_urgent` | 不从决策按钮文案倒推剧情 |
| 玩家身份 | `viewerSeatId` + 六席目录 + N1 当前人物目录 | 按 viewer seat 读取 `seats.json`、`actors.json`、N1 `seat-content.json` | 不信任客户端传入的角色名称或身份描述 |
| 玩家行动 | 已提交且已封存的 `DecisionActionV1` | 从 Working Ledger 的 `acceptedActions` 按 `sealedActionIds`读取，再按 Catalog 将 `actionType` 翻译成人话 | 不把玩家点击前的按钮标题当成已经发生的行动 |
| 其他席位行动 | 同一 Beat 的六席真实 sealed actions，仅保留该玩家可见部分 | 读取每个 accepted action 的 `audienceSeatIds`；只有 viewer 在 audience 中时才进入故事包 | 不向玩家暴露 PRIVATE 或非参与者行动；不凭 AI 默认策略猜测 |
| 真实结果 | `WorkingDelta` + `stateAfter`，再编译成 viewer-safe facts/claims | 校验 WorkingDelta hash、sealed actions hash、stateAfter hash；N1 读取疏散、守堰、记录、灾情四个 stateAfter 事实 | 不在 Catalog 静态预写“最后发生了什么”；不把模型输出当结果权威 |
| allowedClaims | 由权威事实经过 Audience Projector 后生成的叙事许可 | 只允许 Provider 使用当前 audience context 内的 claims；关键短事实设为 required，Truth Guard 逐句核对 | `allowedClaims` 不是独立事实源；它是对上述权威事实的可说范围 |
| 人物规则 | N1 短人物表达规则 | 当前席位 `privatePressure`、`ruleHint`、`dialogueSeeds`，再叠加全局 narrative style | 不让模型自由改变人物立场、权限或已知信息 |
| 未解决压力 | 章内结算后的 `stateAfter` 剩余事实 + `nextDecisionPin` | 用 N1 正式阈值检查灾情、疏散、守堰与记录缺口，按固定优先级最多选择两条；next pin 决定后续是否仍有真实决策 | 不由模型决定，不从 Opening 静态复制，不提前写 N1 最终结果 |
| 下一方向 | 当前真实下一决策 + Action Presentation Catalog | next pin 存在时读取该 decision purpose 和 Catalog 的真实行动方向；没有 pin 时只说明进入章末结算 | 不让模型自创下一按钮或跳到不存在的决策 |

### 一个必须说明的权威区别

`WorkingDelta/stateAfter` 是本轮六席行动应用后的章内权威状态，不等于 `ChapterSettlement` 后的冻结世界。因此当前 BEAT Narrative 可以写：

> 六席合议后，本轮疏散、守堰和记录分别推进到真实数值；水势仍在推进。

但不能写：

> N1 的最终灾情已经确定，九堰危机结束。

章末最终结果仍必须来自 `CHAPTER_FROZEN` / Chapter Settlement。

## 3. 模块拆分与职责

### 模块 A：冻结故事源读取器

准确文件：

- `packages/templates/src/pressure-spine/n1-decision-scene.ts`
- `packages/templates/src/pressure-spine/n1-story-source.ts`
- `packages/templates/src/pressure-spine/index.ts`

唯一职责：从 hash-verified Pressure Spine 读取 N1 世界、文风、现场、当前人物和人物表达规则。生产调用统一经 `n1-story-source.ts` 首次加载并缓存；`n1-decision-scene.ts` 只保留场景选择纯函数，不做数据库或事实判断。

不负责：读取数据库、判断六席结果、生成小说、决定玩家选项。

失败归因：找不到唯一场景/角色/人物时，直接报 `SANGTIAN_N1_STORY_SOURCE_INVALID`，不降级成拼凑内容。

### 模块 B：权威 Beat 故事实体编译

准确文件：

- `apps/api/src/pressure-chapter/persistence/narrative.prisma-adapter.ts`
- `apps/api/src/pressure-chapter/narrative-authority/contracts.ts`
- `apps/api/src/pressure-chapter/narrative-authority/compiler.ts`

唯一职责：把真实 Working Ledger 中与本次 Beat 有关的权威数据编译为带 ACL 的叙事事实。

当前增加的只读材料：

- `sealedActionAudiences`：每个 sealed action 的真实可见席位；
- `stateAfter/stateAfterHash`：本 Beat 应用后的真实工作态；
- `nextDecisionPin`：本 Beat 之后真实存在的下一决策；
- viewer-private `story.player_action.*`；
- viewer-safe `story.visible_action.*`；
- `story.result.evacuation/weirs/records/severity` 四条短结果事实；
- 最多两条 `story.unresolved_pressure.*`；
- `story.next_direction`。

不负责：改 Settlement、改行动效果、替其他席位选择、写文学正文。

### 模块 C：Provider-only 故事包编译器

准确文件：

- `apps/api/src/pressure-chapter/production-config/n1-story-pack.ts`

唯一职责：把“已通过 Audience Projector 的 viewer-safe context”和“冻结 N1 内容”组织成一个 Narrator 可直接使用的小型故事包。

故事包的准确结构：

```ts
{
  schemaVersion: "pressure_n1_narrative_story_pack_v1",
  worldAndStyle,
  currentScene: { title, sceneFrame },
  playerIdentity,
  playerAction,
  visibleOtherSeatActions,
  settledResult: string[],
  characterRules,
  unresolvedPressure: string[],
  nextDirection,
  requiredClaims
}
```

该模块只接收已经 audience-safe 的 `NarrativeContextV1`。它不能绕过 Audience Projector 回读数据库，因此即使编译器写错，也不能重新获得其他席位的私人行动。

### 模块 D：Narrator 表达与开发日志

准确文件：

- `apps/api/src/pressure-chapter/production-config/narrative-provider.ts`

唯一职责：

1. 对 N1 BEAT 将 `{ storyPack, authority }` 交给现有 DeepSeek Provider；`authority` 只保留来源哈希、Audience-safe facts/objects/knowledge/allowedClaims、variant 和时间边界，不重复整个 Context 外壳；
2. 要求正文按“玩家行动回显 → 六席真实结果 → 未解决压力”形成连续场景；
3. 允许人物动作、对白、雨势、传令和停顿；
4. 禁止写成选项列表、系统报告或夸大玩家单独贡献；
5. Provider 调用前按 `off|summary|full` 打印 viewer-safe 结构化故事包日志；默认 `off`，本地隔离测试才使用 `full`。

日志事件：

```text
PRESSURE_N1_STORY_PACK
```

`summary` 只含来源、hash、字节数和计数；`full` 才包含实际 viewer-safe 内容。日志不含 API key、数据库连接、控制权 fence 或其他席位不可见信息，不进入数据库和玩家 `/game` 页面。

### 模块 E：真实 `/game` 连续展示

准确文件：

- `apps/api/src/pressure-chapter/live-adapters/narrative.adapter.ts`
- `apps/api/src/pressure-chapter/integration/content.adapters.ts`
- `apps/web/public/pressure-main-game-storage-v1.js`
- `apps/web/public/app.js`

唯一可见变化：

- 保留原有四段完整统一开场白；
- 点击进入后显示 N1 三段现场；
- 决策卡出现在现场下方，不替换/清除现场；
- 每个选项同时显示标题与已有 description。

不改 `/game` 布局、CSS、路由、三栏信息架构和提交协议。

## 4. 从玩家点击到剧情出现的完整链路

```text
玩家在真实 /game 选择行动
  → 服务端封存玩家 action
  → AI 席位沿现有确定性流程提交并封存 action
  → 六席真实 Beat Resolution
  → WorkingDelta 应用，产生 stateAfter 与 nextDecisionPin
  → Narrative Authority Reader 从 Working Ledger 回读同一 Beat
  → Authority Compiler 校验 hash 并生成带 ACL 的故事事实
  → Audience Projector 只保留当前玩家可见部分
  → N1 Story Pack Compiler 组织九类故事材料
  → 开发日志打印同一个 story pack
  → DeepSeek 一次调用写连续场景
  → Truth Guard 校验 required claims 和引用
  → 原有 Narrative Artifact 投影回真实 /game
```

## 5. 为什么这可能比当前剧情更好

当前问题不是只缺“更漂亮的 prompt”，而是 Narrator 收到的材料不完整：玩家行动、其他席位行动、结果数值、人物表达和下一压力没有被组织为同一个叙事上下文。

本方案的改善理由是：

- 真实性：行动和结果来自同一真实 Beat，不来自按钮或静态结局文案；
- 连续性：Narrator 同时知道上一现场、玩家刚做什么、六席做成什么、接下来为何不能停；
- 差异性：玩家选择疏散、封存或守堰，会改变 playerAction 和 stateAfter，正文材料实际不同；
- 人物感：Narrator 有当前人物的压力、权限边界和对白规则，而不是只看到规则字段；
- 可诊断：日志能逐项证明模型到底收到了什么；事实错查 Authority，泄密查 Audience，内容缺查 Story Pack，文笔差只查 Provider。

这只能提高成功概率，不能在真实试玩前保证文学质量。最终效果仍由项目所有者在第二个真实 Run 判断。

## 6. 已采纳的工程硬门

1. N1 Story Source 在 API 进程内首次加载后复用，不在每次 Narrative 重读完整内容包；
2. Beat Narrative 只使用 N1 `AFTER_PREPARE_COMMON` 短 `sceneFrame`，不重复完整 Opening；
3. 四项真实结果拆成短事实，核心 required 结果仅两条；
4. 未解决压力完全由真实 `stateAfter` 阈值确定性生成，最多两条；
5. N1 required claims 总数不超过 5，单条不超过 32 个字符；
6. 整个 story pack UTF-8 序列化后不超过 8 KB；
7. 其他席位行动仅依据 `audienceSeatIds`，不增加现场观察推断；
8. Provider 仍只调用一次；数据库查询、migration、新表、新 API、新 Worker、新 Settlement 均为零；
9. Web 只渲染服务端 Projection，不保存或补写 N1 权威结果；
10. 五个 AI 的决策策略本轮明确不改，避免把叙事改善与 AI 行动变化混在一起。

## 7. 验证与玩家参与顺序

### 自动化验证（不算真实试玩）

- Templates 类型检查和 N1 story source focused test；
- API 类型检查；
- Narrative Authority focused tests：hash、一致性、viewer action、其他席位可见性、required claims；
- Provider focused test：实际请求中含 storyPack，日志不含禁用字段；
- Web focused test：开场白 → N1 完整现场 → 同页剧情+决策+说明；
- 既有 Truth Guard / Audience Projector 回归。

### 第一次真实 Run（Codex 只做一次）

只验证工程链路：

- 新 Run 完整开场白；
- N1 现场与决策同时存在；
- 提交一次选择；
- 捕获 `PRESSURE_N1_STORY_PACK`；
- 核对日志九类数据与数据库/投影一致；
- 确认 Narrative 返回且 Truth Guard 没有因新增锚点失败。

这次不声称剧情质量 PASS，只排除断链、泄密和事实错位。

### 第二次真实 Run（项目所有者参与）

创建全新隔离 Solo Run，停在完整开场白，由项目所有者亲自：

1. 阅读完整开场；
2. 阅读 N1 现场；
3. 检查三个选择是否有真实取舍；
4. 作出选择；
5. 在下一段剧情出现后，查看 Codex 回传的同一份 story pack 日志；
6. 只按真实体验判断：是否真实、是否好玩、是否连贯、是否像人物和故事。

## 8. 停止条件

- 自动化未通过：不创建真实 Run；
- 第一次真实 Run 出现错误事实或可见性泄露：不交给玩家测试；
- 页面没有完整开场或 N1 现场：只修 Source/Projection，不调整模型文笔；
- 故事包数据正确但正文难看：只调故事包短锚点与 Provider 指令；
- 最多两轮玩家反馈仍无明显改善：停止 N1，不扩展 N2-N7，不继续堆系统。

## 9. 当前实施状态

已写入但尚未验收：模块 A-D 的第一版代码、原有开场恢复、N1 同页剧情与决策展示。

尚未完成：本轮类型检查（首次执行在无错误输出时达到 124 秒命令超时）、新增 focused tests、一次真实 Run 自测、第二个玩家 Run。

当前在 `main`，未提交、未推送、未部署；共享工作树中的其他任务修改未被清理或吸收。
