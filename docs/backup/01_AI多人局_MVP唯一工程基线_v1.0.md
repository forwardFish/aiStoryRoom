# AI 多人局｜MVP 唯一工程基线 v1.0

> 文档类型：唯一工程基线 / 冲突裁决文档  
> 适用范围：`forwardFish/aiStoryRoom` Web 单人 MVP  
> 首个故事局：《桑田诏：嘉靖财政危局》  
> 生效日期：2026-07-10  
> 最高原则：**当 PRD、玩法、剧本、数据库、AI 推演或代码实现出现冲突时，以本文档为准。**

---

## 1. 文档目的

本文档不重新描述产品愿景，只锁定当前 MVP 的唯一工程选择，防止开发过程中出现以下分叉：

- 单人 MVP 与真人多人同时开发；
- `StoryMessage / PlayerDecision` 与 `StoryRun / StoryEvent` 两套数据模型并行；
- 继续使用 `apps/web` 与重建 Next.js 项目同时进行；
- AI 直接修改状态与规则引擎掌握状态权威相互冲突；
- “每天 1—3 次决策”与固定 12 次决策不一致；
- `storyId / templateId / templateKey` 等字段混用。

本文档一经确认，任何偏离都必须先更新本文档版本，再进入开发。

---

## 2. 唯一工程选择

| 项目 | 最终选择 | 工程含义 |
|---|---|---|
| MVP 模式 | Web 单人 | 不开发真人多人、实时同步、异步多人结算 |
| 玩家角色 | 浙江总督 | 当前唯一可正式进入游戏的玩家角色 |
| AI 角色 | 浙江巡抚、清流县令、江南商会、司礼监、内阁财政派、皇帝 | AI 角色是局势参与者，不抢玩家主导权 |
| 游戏长度 | 7 天 | 第 1—6 天决策，第 7 天裁决 |
| 决策数量 | 第 1—6 天每天 2 次，共 12 次 | 不在 MVP 中动态增减每日决策数 |
| 每日消息 | 3—5 条核心剧情消息 | 包括开局、角色行动、私密情报、结果、日终回响 |
| 前端 | 继续使用 `apps/web` | 不新建 `apps/player-web`，不在 MVP 阶段迁移 Next.js |
| 后端 | NestJS，继续使用 `apps/api` | API 统一挂载在 `/api/v4` |
| 运行态存储 | `StoryRun + StoryEvent` | `StoryRun` 保存快照，`StoryEvent` 保存追加式事件流 |
| 浏览器存储 | 只允许保存 `runId` 和非权威 UI 偏好 | 不得把游戏权威状态放入 localStorage |
| AI 任务 | 接真实模型后增加 `AiTask` | 记录调用、输出、失败、重试、token 与 fallback |
| 状态权威 | 规则引擎 | 数值、阈值、合法性、状态转移、结局候选由规则系统裁决 |
| AI 职责 | 意图理解、角色反应、剧情表达、因果解释 | AI 不能直接写数据库，不能绕过规则引擎 |
| MVP 不做 | 真人多人、支付、UGC、小程序、社区、复杂地图、长篇小说 | 不得以“为以后预留”为由扩大当前范围 |

---

## 3. 核心产品闭环

唯一允许的核心闭环为：

```text
故事局大厅
→ 角色选择（浙江总督）
→ 创建 StoryRun
→ 第 1 天剧情消息
→ 第 1 个关键决策
→ ActionGuard / 规则校验
→ AI 生成候选叙事与角色反应
→ 规则引擎落账
→ 可见因果卡
→ 第 2 个关键决策
→ 日终回响
→ 进入下一天
→ 第 7 天最终裁决
→ 全局结局 + 个人结局 + 关键因果解释
```

MVP 验收的核心不是页面数量，而是该闭环可以稳定、可恢复、可解释地跑完。

---

## 4. 数据模型唯一方案

### 4.1 StoryRun：当前快照

`StoryRun` 是当前一局的权威快照，至少保存：

```text
id
userId（可空，MVP 可匿名）
templateKey
mode
selectedRoleKey
status
currentDay
totalDays
version
stateJson
createdAt
updatedAt
```

`stateJson` 最少包含：

```text
worldState
roleState
relationships
risks
clues
traces
fateSeeds
evidenceLedger
responsibilityLedger
narrativeFrames
roleDecisionModels
daySummaries
finalJudgementInputs
```

### 4.2 StoryEvent：追加式事件流

所有运行过程统一写为 `StoryEvent`：

```text
message
decision
decision_result
state_patch
role_reaction
visible_causal_card
fate_seed_created
fate_seed_triggered_help
fate_seed_triggered_backfire
evidence_updated
responsibility_updated
narrative_frame_updated
causal_recall
day_end
final_judgement
system
```

### 4.3 明确不做

MVP 不新增独立的：

```text
StoryMessage
PlayerDecision
RelationshipState
HiddenThread
EndingRecord
```

这些概念作为 `StoryEvent.type` 和 `payloadJson` 表达。只有在数据量、查询性能或多人权限确实需要时，才物理拆表。

### 4.4 AiTask

接入真实模型时增加 `AiTask`，但它不是故事状态权威，只是 AI 调用账本。

---

## 5. 前端唯一方案

### 5.1 当前目录

```text
apps/web/
  public/
    home.html
    role-select.html
    index.html
    *.js
    *.css
  src/server.mjs
  tests/
```

### 5.2 MVP 规则

- 继续维护当前 `apps/web`；
- 不新建 `apps/player-web`；
- 不因“长期架构更好”而重写 React / Next.js；
- 先验证用户是否愿意完成 7 天、是否理解因果、是否愿意重玩；
- 只有玩法指标达标后，才评估迁移到 Next.js。

### 5.3 页面路由

```text
/                          故事局大厅
/role-select?story=sangtian 角色选择
/game?runId=<runId>         正式游戏页
```

结局仍在游戏页内展示，MVP 不强制拆 `/ending/:runId`。

---

## 6. 后端唯一方案

### 6.1 API 路径

```text
GET  /api/v4/stories
GET  /api/v4/stories/:templateKey
GET  /api/v4/stories/:templateKey/roles
POST /api/v4/stories/:templateKey/runs

POST /api/v4/story-runs
GET  /api/v4/story-runs/:runId
GET  /api/v4/story-runs/:runId/messages
GET  /api/v4/story-runs/:runId/dashboard
POST /api/v4/story-runs/:runId/messages/:eventId/decisions
POST /api/v4/story-runs/:runId/advance-day
POST /api/v4/story-runs/:runId/finalize
```

### 6.2 唯一命名

| 概念 | 唯一字段名 |
|---|---|
| 剧本标识 | `templateKey` |
| 角色标识 | `roleKey` / `selectedRoleKey` |
| 故事局标识 | `runId` |
| 事件标识 | `eventId` |
| 乐观锁版本 | `version` |
| 选项标识 | `optionKey` |
| 自定义决策 | `customText` |

不得再混用 `storyId / templateId / playerRoleKey / messageId / messageEventId` 作为新接口字段。旧代码可在适配层兼容，但对外契约只使用上表字段。

---

## 7. 规则引擎与 AI 的权责边界

### 7.1 规则引擎负责

- 当前状态是否合法；
- 当前阶段是否允许操作；
- `version` 校验与并发控制；
- ActionGuard 的硬性边界；
- 资源、权力、时间、阶段约束；
- 数值补丁范围和最终落账；
- FateSeed 条件是否满足；
- 证据与责任是否存在可追溯来源；
- 可达结局集合；
- 最终状态写入与事件记录；
- AI 失败时的确定性 fallback。

### 7.2 AI 负责

- 理解合法的自定义决策意图；
- 根据角色已知信息、恐惧、欲望、误判生成角色反应；
- 将结构化结果转译为剧情消息；
- 生成个人回响、他人回响、世界回响；
- 生成日终摘要；
- 在规则允许的候选结果内生成最终裁决文案。

### 7.3 AI 明确禁止

- 直接更新数据库；
- 自行决定超出规则范围的数值；
- 让角色知道其不应知道的信息；
- 直接跳过天数或宣布结局；
- 临时编造没有 `originEventId` 的反噬；
- 把后台私密推理展示给玩家。

---

## 8. 固定节奏

```text
第 1—6 天：每天 2 个关键决策
第 7 天：0 个普通决策，进入最终裁决
总关键决策数：12
```

每日标准结构：

```text
1 条开局消息
1 条第一个待决策消息
1 条第一个结果 / 角色反应消息
1 条第二个待决策消息
1 条第二个结果 / 角色反应消息
1 条日终回响
```

页面可合并展示，但后台必须保留明确事件类型。

---

## 9. Definition of Done

MVP 只有同时满足以下条件才算完成：

1. 可以从大厅进入选角并创建新局；
2. 只能以浙江总督正式开局；
3. 第 1—6 天每天严格完成 2 次决策；
4. 自定义决策经过 ActionGuard；
5. 每次关键决策后显示：决定、个人回响、他人回响、世界回响、状态变化、痕迹、风险；
6. 至少一个第 1 天 FateSeed 能在第 3—5 天帮助或反噬玩家；
7. 每次回溯包含 `originEventId`；
8. 页面刷新后可恢复当前局，不丢状态；
9. 重复提交不会重复落账；
10. 第 7 天前不能调用最终裁决；
11. 第 7 天完成全局结局、个人结局、关键救命步骤、伤害步骤、命运债；
12. 全选 A、全选 B、全选 C 至少产生不同状态轨迹和不同结局；
13. 前台不泄露 `hiddenMeaning`、`privateReasoningSummary`、完整触发条件；
14. API、Web 自动化测试和主流程测试通过。

---

## 10. 变更控制

任何以下变更都必须升级本文档版本：

- 改为真人多人；
- 改变 7 天或 12 次决策；
- 改变数据权威模型；
- 迁移前端技术栈；
- 允许 AI 直接决定状态；
- 增加支付、UGC、小程序或社区；
- 将单一剧本扩展为多剧本正式上线。

小范围文案、UI、数值平衡和剧情润色不需要升级本基线，但必须保持接口和状态机兼容。
