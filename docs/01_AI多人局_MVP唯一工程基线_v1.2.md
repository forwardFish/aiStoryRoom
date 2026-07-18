# AI 多人局｜MVP 唯一工程基线 v1.2

> 文档类型：唯一工程基线 / 冲突裁决文档  
> 适用范围：`forwardFish/aiStoryRoom` Web 单人 MVP  
> 首个故事局：《桑田诏：嘉靖财政危局》  
> 生效日期：2026-07-10  
> 最高原则：**当 PRD、玩法、剧本、数据库、AI 推演或代码实现出现冲突时，以本文档为准。**

---

## 0. v1.2 修订说明

本版在 v1.1 主动谋划基线之上，正式锁定主游戏页的“持续叙事流”交互。

唯一前台体验：

```text
故事连续出现
→ AI 给出 3 个行动建议
→ 玩家选择建议或输入自己的方案
→ 提交
→ AI 正在推演局势……
→ 新故事自动追加
→ 可见变化自动追加
→ 如有新压力，继续出现下一次决策
```

工程约束：

```text
顶部、左栏、右栏固定
只有中间区域变化
主游戏只有一个路由
8 个 UI 只是状态，不是 8 个页面路由
默认不展示消息卡片后台
局势记录默认隐藏
选项前台只显示标题
主线决策和主动谋划输入上限均为 200 字
```

关键事件弹窗保留“立即处理 / 稍后处理”。MVP 中需要回应的关键事件占用当日 2 次主线决策中的一个槽位，不额外增加单局 12 次主线决策。
## 1. 文档目的

本文档不重新描述产品愿景，只锁定当前 MVP 的唯一工程选择，防止开发过程中出现以下分叉：

- 单人 MVP 与真人多人同时开发；
- `StoryMessage / PlayerDecision` 与 `StoryRun / StoryEvent` 两套数据模型并行；
- 继续使用 `apps/web` 与重建 Next.js 项目同时进行；
- AI 直接修改状态与规则引擎掌握状态权威相互冲突；
- “每天 1—3 次决策”与固定 12 次决策不一致；
- `storyId / templateId / templateKey` 等字段混用；
- 主线决策与右侧主动谋划混为同一套行动，导致次数、状态和接口不清。

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
| 主动谋划 | 第 1—6 天每天 2 次谋划机会，可选 | 不替代主线决策；未使用不结转；进入下一天时清零并重置 |
| 谋划类型 | 人物交谈、派遣调查、使用筹码、自拟谋划 | 每次成功谋划使用 1 次谋划机会；被 ActionGuard 拒绝不消耗 |
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
→ 中间区域连续展示第 1 天开场故事
→ 故事自然推进到主线决策
→ AI 提供 3 个行动建议
→ 玩家选择建议或输入自己的完整决定
→ ActionGuard / 规则校验
→ 中间区域显示“AI 正在推演局势……”
→ 规则引擎落账
→ AI 生成下一段角色视角故事
→ 中间区域自动追加结果故事与本次变化
→ 玩家可从右侧发起主动谋划
→ 谋划内容仍在中间区域确认和提交
→ 谋划结果继续追加到同一叙事时间线
→ 其他角色的行动按玩家视角转译为故事
→ 必要时触发关键事件弹窗
→ 第 2 个主线决策
→ 日终回响
→ 进入下一天
→ 第 7 天最终裁决
→ 全局结局 + 个人结局 + 关键因果解释
```

MVP 验收的核心不是页面数量，而是该闭环可以稳定、可恢复、可解释地跑完。

前台不再单独展示“可见因果卡”。因果账本、FateSeed 与 `originEventId` 继续作为后台权威；玩家通过“结果故事 + 本次变化 + 局势记录”理解因果。
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
maneuverState
pursuits
availableLeverage
finalJudgementInputs
```

### 4.2 StoryEvent：追加式事件流

所有运行过程统一写为 `StoryEvent`：

```text
story_block
decision_prompt
decision
decision_result
change_summary
maneuver
maneuver_result
leverage_used
pursuit_updated
state_patch
role_reaction
critical_event
critical_event_deferred
critical_response_prompt
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

前台通过公共投影把这些事件组合为 `NarrativeEntry[]`。浏览器不得直接读取隐藏事件或后台因果字段。

`critical_response_prompt` 在 MVP 中属于当日固定主线决策之一，必须设置：

```text
countAsMainDecision = true
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
- 正式游戏只有一个主路由：`/game?runId=<runId>`；
- 顶部、左栏、右栏在所有游戏状态中保持固定；
- 中间区域采用持续叙事时间线，不采用分页故事和默认消息卡片后台；
- 8 个 UI 状态只是同一主页面的投影状态；
- 选项前台只显示 A/B/C 与行动标题；
- 点击建议后写入统一输入框，玩家可继续修改；
- 主线决策、回应与主动谋划最大 200 字；
- AI 推演状态只显示“AI 正在推演局势……”；
- 推演完成后自动追加新故事与本次变化；
- 局势记录默认隐藏，只覆盖中间区域；
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
POST /api/v4/story-runs/:runId/messages/:eventId/defer
POST /api/v4/story-runs/:runId/maneuvers
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
| 主动谋划类型 | `maneuverType` |
| 谋划目标角色 | `targetRoleKey` |
| 谋划意图 | `intentKey` |
| 使用筹码 | `leverageKey` |
| 每日谋划次数 | `maneuverOpportunitiesPerDay` |
| 当日已用谋划 | `maneuversUsedToday` |

不得再混用 `storyId / templateId / playerRoleKey / messageId / messageEventId` 作为新接口字段。旧代码可在适配层兼容，但对外契约只使用上表字段。

---

## 7. 规则引擎与 AI 的权责边界

### 7.1 规则引擎负责

- 当前状态是否合法；
- 当前阶段是否允许主线决策或主动谋划；
- `version` 校验与并发控制；
- ActionGuard 的硬性边界；
- 资源、权力、时间、阶段约束；
- 谋划机会的校验、扣减、每日重置与不结转；
- 数值补丁范围和最终落账；
- FateSeed 条件是否满足；
- 证据与责任是否存在可追溯来源；
- 可达结局集合；
- 最终状态写入与事件记录；
- AI 失败时的确定性 fallback。

### 7.2 AI 负责

- 理解合法的自定义决策与自拟谋划意图；
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
第 1—6 天：每天 2 次谋划机会，可选使用
第 7 天：0 个普通决策、0 次谋划机会，进入最终裁决
总关键决策数：12
单局主动谋划理论上限：12 次
```

需要回应的关键事件必须被编排进当日尚未完成的决策槽位，不得额外突破 12 次主线决策。

每日前台标准节奏：

```text
连续开场故事
→ 第一个决策模块
→ AI 正在推演
→ 结果故事 + 本次变化
→ 0—2 次主动谋划（按玩家选择）
→ 第二个决策模块
→ AI 正在推演
→ 结果故事 + 本次变化
→ 日终故事
```

后台仍保留明确事件类型，但前台不以卡片日志方式默认展示。
## 9. Definition of Done

MVP 只有同时满足以下条件才算完成：

1. 可以从大厅进入选角并创建新局；
2. 只能以浙江总督正式开局；
3. 正式游戏仅使用 `/game?runId=<runId>`；
4. 8 个 UI 状态下顶部、左栏、右栏尺寸和内容保持一致；
5. 中间区域为连续叙事时间线，不分页、不跳独立结果页；
6. 第 1—6 天每天严格完成 2 次主线决策；
7. 需要回应的关键事件占用主线决策槽位，不增加总数；
8. 前台选项只显示 A/B/C 与行动标题，不返回收益、风险、成功率和数值预测；
9. 点击建议会把标题写入统一输入框，玩家可修改或完全自定义；
10. 主线决策和主动谋划最大 200 字并经过 ActionGuard；
11. 提交后只显示“AI 正在推演局势……”，不显示技术过程；
12. 推演成功后自动追加结果故事与“本次变化”，无“继续”“下一步”“查看变化”等按钮；
13. 局势记录默认隐藏，只在中间区域展开，关闭后恢复原滚动位置；
14. 关键事件弹窗支持“立即处理 / 稍后处理”，稍后处理刷新后仍可恢复；
15. 每次关键决策后，后台因果账本与 `originEventId` 完整，前台只显示角色可见变化；
16. 至少一个第 1 天 FateSeed 能在第 3—5 天帮助或反噬玩家；
17. 页面刷新后可恢复当前叙事、activePrompt、推演状态和待处理关键事件；
18. 重复提交不会重复落账；
19. 第 7 天前不能调用最终裁决；
20. 第 7 天完成全局结局、个人结局、关键救命步骤、伤害步骤和命运债；
21. 全选 A、全选 B、全选 C 至少产生不同状态轨迹和不同结局；
22. 前台不泄露 `hiddenMeaning`、`privateReasoningSummary`、内部收益/风险和完整触发条件；
23. 第 1—6 天每天正确提供 2 次谋划机会，未使用不影响进入下一天；
24. 主动谋划不能替代主线决策；
25. 合法谋划写入事件流并影响关系、线索、任务、风险或 FateSeed；
26. 非法谋划不消耗机会、不增加 version、不产生状态补丁；
27. API、Web 自动化测试和主流程测试全部通过。
## 10. 变更控制

任何以下变更都必须升级本文档版本：

- 改为真人多人；
- 改变 7 天、12 次主线决策或每日 2 次谋划机会；
- 改变数据权威模型；
- 迁移前端技术栈；
- 允许 AI 直接决定状态；
- 增加支付、UGC、小程序或社区；
- 将单一剧本扩展为多剧本正式上线。

小范围文案、UI、数值平衡和剧情润色不需要升级本基线，但必须保持接口和状态机兼容。
