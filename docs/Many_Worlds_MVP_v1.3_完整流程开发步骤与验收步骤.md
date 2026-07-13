# Many Worlds MVP v1.3 完整流程开发步骤与验收步骤

> 文档状态：PLANNED
> 编制日期：2026-07-13
> 适用仓库：`D:\lyh\agent\agent-frame\aiStoryRoom`
> 目标版本：Many Worlds Web MVP v1.3
> 核心目标：在不改动《嘉靖财政危局》现有主游戏页面的前提下，用一次连续执行完成“注册/登录 → 浏览世界 → 世界详情 → 单人选角或多人房间 → 等待/选角/Ready → 开始游戏 → 三玩家共同决策 → AI 连续剧情推演 → 七轮结束 → 游戏结果 → 恢复或重玩”的真实产品闭环，并在同一 RunId 下持续修复、重测直到全部功能纯 `PASS`。

## 0. 文档用途与判定边界

本文是后续全部开发、测试、修复和最终验收的执行基线，不代表所列功能已经完成。

后续任何“完成”结论必须同时具备：

```text
实现代码
+ 自动测试
+ 真实浏览器流程
+ API transcript
+ 数据库独立读回
+ AI/规则任务证据
+ 同一 RunId 下的截图和报告
```

仅有页面截图、接口 200、旧报告、聊天结论、mock 结果或计划文档，均不得单独判定完成。

### 0.1 本轮必须遵守的产品边界

- 新增并开发 5 个平台通用页面：Login / Sign Up、World Details、Rooms、Room Waiting & Role Selection、Game Result。
- 复用现有 3 个页面：Home / World Lobby、Solo Role Selection、Main Game。
- 平台页面结构属于 Many Worlds，世界图片、角色、剧情、变量、任务和结局属于 World Package。
- 当前世界库只有两个正式内容源：《凯撒：共和国最后的春天》和《桑田诏：嘉靖财政危局》。不得用首页中的预览卡冒充可玩世界。
- 《嘉靖财政危局》当前已经可以玩，是本轮新增完整流程、三玩家七轮和 AI 连续推演的主验收世界。
- 《嘉靖财政危局》`/game` 的现有 UI01—UI08 页面布局、视觉、交互骨架和世界专属样式为冻结区，不做页面改版；允许为正式多人流程增加不改变页面外观的用户身份、角色投影、等待状态和 API 数据绑定。
- 《凯撒：共和国最后的春天》作为第二个正式可玩世界接入相同的注册登录、World Details、选角、Rooms、Game、Result 和恢复/重玩流程；它不承担本轮“三玩家七轮核心验收”的最终证明，但不得停留在预览卡或只读数据合同。
- 公共 Header、认证、World Package、Rooms、结果页和 API client 的改动可以服务两个世界，但必须对《嘉靖财政危局》运行现有回归，证明主游戏页没有被破坏。
- `/trio` 现有页面保留为开发/验收工具或兼容入口，不能替代正式产品的 `/rooms/:roomId → /game?runId=...` 多人流程。

### 0.2 一次性闭环执行合同

后续开发不得把本文拆成多个彼此独立、需要用户逐次确认才能继续的半成品阶段。执行者获得本轮开发授权后，必须按以下方式连续推进：

```text
扫描当前实现与 Supabase 状态
→ 实现全部范围内 P0/P1
→ 自动测试 + API + Supabase 独立读回
→ 真实浏览器完整流程
→ 《嘉靖财政危局》三玩家七轮
→ 故障注入、视觉和模拟玩家
→ 发现失败即最小修复
→ 重跑目标测试和影响面回归
→ 当前 RunId 全门禁纯 PASS
```

- 不得以“页面已写完”“核心可用”“本地可以”“支付以前测过”或 `PASS_WITH_LIMITATION` 结束执行。
- 任一可通过代码、配置、迁移、测试数据或重启修复的问题，都必须在同一连续执行中修复并复测；不把修复任务退回给用户。
- 用户已确认除 Railway 外其余所需环境应可用。执行者必须先使用现有 Supabase、DeepSeek、Web/API/Worker 环境完成全部产品功能；认证、房间、点数和普通测试失败都不是 blocker。Railway 只进入独立的生产发布判定，不阻止产品功能纯 `PASS`。
- 最终报告只接受纯 `PASS`；必须列出实现范围、测试总数、修复轮次、Supabase 读回、三玩家七轮计数、视觉证据和剩余问题数（必须为 0）。

### 0.3 已确认的基础设施与商业能力

- 数据库已经存在并使用 Supabase PostgreSQL。后续执行把当前配置的 Supabase 项目作为权威数据库，不再把“建设 Supabase 数据库”列为未完成功能。
- `DATABASE_URL` / `SUPABASE_DATABASE_URL` 只从本地或部署密钥注入；报告仅记录脱敏 project ref、schema、migration version 和连接模式，不记录连接串。
- 本地 Docker/PostgreSQL 只是可选的隔离单测或灾备演练工具，`127.0.0.1:55434` 未启动不得阻断最终验收；最终 HTTP、持久化、房间和七轮证据必须在现有 Supabase 非生产测试数据边界内重跑。
- 支付已由用户完成实际测试，本轮不重新设计或开发支付产品；只做账本、幂等、回调合同和世界解锁的非真实扣款回归，禁止为了验收再次发起真实付款。
- 用户已授权在测试阶段给本轮测试账号增加 World Credits。该授权只适用于受控测试账号和可审计测试入口，不得修改真实用户、伪造购买记录或把测试点数记为 `PURCHASED`。
- Railway 是当前唯一已知尚未就绪的部署环境。本轮必须完成可部署产物、环境合同、health/readiness 和本地/现有环境运行证据；若没有 Railway 授权，则把 `Railway Deployment Verdict` 单列为 `NOT_RUN_AWAITING_ENVIRONMENT`，不降低 `Product Functional Verdict=PASS`，也不把它混成产品 limitation。

### 0.4 明确不做

```text
房间聊天、语音、好友、排行榜、评论、观战
房主转让、踢人、审批加入、开始后加入
自定义房间规则、世界编辑器、UGC 剧本市场
复杂关系图、完整因果图、长篇小说下载
改造《嘉靖财政危局》主游戏 UI01—UI08
用参考图作为整页背景、覆盖层或透明热区
```

## 1. 输入真源与冲突优先级

### 1.1 主要真源

| 优先级 | 文档/资源 | 用途 |
|---:|---|---|
| 1 | `docs/16_Many_Worlds_MVP通用版_5页面产品与UI设计_v1.3.md` | 5 个新增页面、最小完整流程、通用页面和最小 API |
| 2 | `docs/16_AI剧情连续性与动态推演引擎完整方案_v1.0.md` | 连续性上下文、Planner/Writer、校验、NarrativeEntry 和 AI 任务链路 |
| 3 | `docs/10_桑田诏_完整故事局剧本_v1.3_持续叙事流修订版.md` | 三玩家七轮核心验收的世界、角色、7 天主线、决策和结局真源 |
| 4 | `docs/剧本/凯撒_共和国最后的春天/凯撒_共和国最后的春天_完整故事局剧本_v1.0.md` | 第二世界七幕、角色、知识边界和结果数据合同 |
| 5 | `docs/Our_Many_Worlds_架构完成度审计_20260713.md` | 当前生产架构缺口和上线阻断项 |
| 6 | `docs/AIStoryRoom_v1.2_开发步骤与验收步骤.md` | 既有任务拆分、证据和失败处理格式 |
| 7 | `docs/AIStoryRoom_v1.2_功能测试与模拟玩家测试.md` | 既有 FT/SP 分层、RunId 和报告格式 |

发生冲突时：本文件的本轮范围边界优先；游戏内规则由具体剧本文档决定；平台流程与 5 个页面由 v1.3 页面文档决定；AI 事实安全和连续性由动态推演引擎方案决定。

### 1.2 新增 UI 真源映射

新增 5 张图均为 1600×1000、英文、Many Worlds 浅色平台风格：

| UI ID | 原始文件 | 页面 | 路由 |
|---|---|---|---|
| UI-NEW-01 | `docs/UI/web/ChatGPT Image 2026年7月13日 22_31_44 (1).png` | Login / Sign Up | `/auth` |
| UI-NEW-02 | `docs/UI/web/ChatGPT Image 2026年7月13日 22_31_44 (2).png` | World Details | `/worlds/:worldId` |
| UI-NEW-03 | `docs/UI/web/ChatGPT Image 2026年7月13日 22_31_47 (3).png` | Rooms | `/rooms` |
| UI-NEW-04 | `docs/UI/web/ChatGPT Image 2026年7月13日 22_31_49 (4).png` | Room Waiting & Role Selection | `/rooms/:roomId` |
| UI-NEW-05 | `docs/UI/web/ChatGPT Image 2026年7月13日 22_31_50 (5).png` | Game Result | `/game/result?runId=<runId>` |

开发前必须为 5 张图建立稳定的语义 manifest，记录 `uiId`、原文件名、SHA-256、尺寸、路由、状态、可见控件、fixture 和证据目录。不得依赖时间戳文件名的排序推断页面身份。

新增 5 个平台页中需要头像、封面或背景时，允许先从 `docs/UI/web/pic/` 的 27 张现有 PNG 中选择语义接近的素材。临时素材必须通过 `assetKey` 和 manifest 引用，记录原文件、hash、尺寸、裁切方式、使用页面和 `replacementStatus=temporary_user_approved`；禁止把时间戳文件名散落硬编码到 HTML/CSS/JS。用户后续统一替图时只替换 manifest 映射，不修改页面结构和业务代码。该授权仅适用于新增平台页，不用于替换《嘉靖财政危局》冻结主游戏页的现有专属资产。

## 2. 2026-07-13 当前完成度扫描

本节是当前源码和本轮实际测试结果的快照，不可继承为未来 RunId 的 PASS。

### 2.1 已完成或已有可复用基础

| ID | 证据 | 当前判断 |
|---|---|---|
| BASE-001 | `apps/web/src/server.mjs` 已有 `/`、`/role-select`、`/game`、`/trio` | 旧页面入口已存在 |
| BASE-002 | `apps/api/src/auth/` 已有邮箱注册、验证、登录、`me` | 本地认证基础存在 |
| BASE-003 | Prisma 已有 `User`、`WorldTemplate`、`StoryRun`、`StoryPlayer`、`StoryRole`、`PlayerAction`、`DirectorResolution`、`Notification`、`AiTask` | 可扩展，不应另造平行运行模型 |
| BASE-004 | `StoryRun` 已有 owner、inviteCode、visibility、players、roles、status、version | 可以作为 Room 与 Game Session 的统一聚合根 |
| BASE-005 | `/trio`、`scripts/e2e/three-player-seven-round.ts` 和旧七轮证据存在 | 三玩家脚本基础可迁移到正式流程 |
| BASE-006 | 当前 `pnpm typecheck` 通过 | 当前 TypeScript/JS 语法基线健康 |
| BASE-007 | 当前 `pnpm lint:config` 通过：7 天、12 决策、4 类谋划、5 个全局结局、6 个个人档位 | 《嘉靖财政危局》配置基线健康 |
| BASE-008 | 当前 Web 17 项测试中 16 项通过 | 旧单人流程大部分仍工作 |
| BASE-009 | `.env.example`、`apps/api/src/main.ts` 和 Prisma 已支持 Supabase PostgreSQL 连接，用户确认现有数据库已在 Supabase | Supabase 是本轮权威数据库；只需验证连接、迁移、权限和读回，不重建数据库 |
| BASE-010 | Credits 账本已有事务化、幂等 `grantCredits`/`spendCredits`，支付流程已由用户实际测试通过 | 本轮补受控测试加点入口并做回归，不重新开发支付 |

### 2.2 已部分实现但不能满足本轮产品合同

| ID | 当前事实 | 缺口 |
|---|---|---|
| GAP-001 | 邮箱注册登录已存在 | 密码后端最短 6 位与产品 8 位冲突；无 `/auth` 正式页面、忘记密码、returnTo 恢复和安全会话 |
| GAP-002 | Bearer Token 直接使用 `User.openid` | 不是可过期、可撤销、可验证签名的 JWT；现有 Supabase PostgreSQL 不自动代表认证已产品化，仍需完成安全 AuthAdapter/JWT |
| GAP-003 | `StoryRun`/`StoryPlayer` 支持加入和认领角色 | 缺产品级房间列表、My Rooms、join-by-code、Ready、Host 优先锁角、关闭房间、状态投影和对象权限 |
| GAP-004 | `mvp-catalog.ts` 有首页故事卡 | 运行详情只允许 `sangtian`；凯撒没有运行时 World Package，其他预览卡不能玩 |
| GAP-004A | 《嘉靖财政危局》单人 catalog 只有浙江总督 `playable=true` | 三玩家核心验收需要为多人模式开放浙江总督、浙江巡抚、清流县令，同时保持单人可玩角色不变 |
| GAP-005 | `packages/templates` 有三个通用演示模板 | 与 `docs/剧本` 中的两个正式世界不一致，不能替代凯撒/桑田诏的正式配置 |
| GAP-006 | 当前 AI 可返回结构化叙事字段并有 fallback | 仍是单阶段润色；没有六层上下文、Planner/Writer、CanonFact、StoryThread、CharacterMind、SceneSnapshot 和连续性 repair |
| GAP-007 | 有 `NarrativeSegment`、`StoryEvent` | `StoryEvent` 无单局 sequence；还不是统一、可重放、按角色投影的 NarrativeEntry 链路 |
| GAP-008 | 有 `/trio` 浏览器入口 | 是开发控制台式入口，不是 `/rooms/:roomId` 正式等待/选角/Ready/Start 产品流 |
| GAP-009 | 现有 AI 在 API 请求中同步执行 | 无 202 Command、Outbox、Worker、租约、重试、自愈、SSE/Realtime 完整闭环 |

### 2.3 明确未完成

1. 5 个新增页面和其 Web 路由未实现。
2. 5 张新增 UI 没有 fixture、浏览器截图、diff、metrics 或真实交互证据。
3. 凯撒没有可运行 World Package 和 API catalog；《嘉靖财政危局》还缺正式多人角色开放与房间接入。
4. 正式 Rooms API 和 Room 等待/Ready/Start 流程未实现。
5. Game Result API 与页面未实现。
6. 登录前动作恢复、邀请链接登录后回房间、My Rooms 恢复未实现。
7. 三个独立登录玩家通过正式页面完成七轮、21 次行动的证据未实现。
8. 玩家决策相互影响、逐角色私有视角、知识边界和通知隔离没有正式产品流证据。
9. AI 连续性数据模型、Context Builder、Planner/Writer、Validator/repair 未实现。
10. 认证/Realtime 集成和生产 API base 尚未完成；Supabase PostgreSQL 数据库本身已存在。Railway 实际部署尚未执行，但不属于本轮本地产品功能验收范围，只需完成 deployment-ready 合同。

### 2.4 当前回归失败/环境阻塞

- 当前 Web 测试 `第七日前没有裁决入口，且版本冲突会刷新而不是覆盖` 失败：期望出现“已为你刷新到最新版本”，实际页面未出现该提示。
- API 的纯规则断言通过；一次旧的 HTTP/持久化尝试因可选本地 PostgreSQL `127.0.0.1:55434` 未启动而停止。该结果只说明旧命令使用了错误环境，不是当前 Supabase 的完成度结论，也不是最终 blocker。
- 正式开发 RunId 必须直接验证已配置 Supabase 的 `SELECT 1`、migration、API 写入和独立读回；不得用本地端口失败或 2026-07-11 的旧报告覆盖当前结果。

## 3. 目标产品流程与路由状态机

### 3.1 未登录入口恢复

```text
用户点击受保护动作
→ 保存 returnTo、worldId、roomCode、intendedAction（仅非敏感枚举）
→ /auth
→ 登录或注册成功
→ GET /api/v4/auth/me
→ 校验 returnTo 白名单
→ 恢复原动作或回到安全默认页
```

禁止把密码、完整 Bearer Token、私有角色目标、玩家行动正文写入 URL。

### 3.2 单人完整流程

```text
Home /
→ World Details /worlds/:worldId
→ Auth /auth（未登录）
→ Solo Role Selection /role-select?worldId=<worldId>&mode=solo
→ POST /api/v4/worlds/:worldId/runs
→ Main Game /game?runId=<runId>
→ AI 连续推演直到 finished
→ Game Result /game/result?runId=<runId>
```

### 3.3 多人完整流程

```text
Home
→ World Details
→ Auth（未登录）
→ Rooms /rooms?worldId=<worldId>
├─ Join Open Room
├─ Join with Code
└─ Create Room Modal
     → Room Waiting /rooms/:roomId
     → Host 先选并锁定角色
     → 其他玩家加入并选角
     → 所有真人 Ready
     → Host Start Game
     → Main Game /game?runId=<runId>
     → 每轮 3 人提交，AI/规则只结算一次
     → 七轮完成
     → Game Result
```

### 3.4 返回与恢复

```text
/rooms?tab=my
├─ waiting_players / role_selecting → Open Room
├─ in_progress / resolving → Continue
└─ finished → View Result
```

刷新和跨浏览器恢复必须以服务器数据为权威，浏览器只能保存 session 和非权威 UI 偏好。

## 4. 核心架构决策

### 4.1 统一聚合根

不新增平行 `Room` 业务系统。使用现有 `StoryRun` 作为房间与游戏局的统一聚合根：

```text
StoryRun waiting_players / role_selecting
  = Room

StoryRun in_progress / resolving
  = Active Game

StoryRun finished
  = Completed Session / Result
```

`StoryPlayer` 承担玩家加入、角色、Ready、在线/离线和最后活跃状态；`StoryRole` 承担 Available/Taken/Selected/AI-controlled 状态。

### 4.2 必要数据扩展

建议至少增加或规范：

```text
StoryRun.roomName
StoryRun.minHumanPlayers
StoryRun.startedAt
StoryRun.finishedAt
StoryRun.closedAt
StoryRun.currentRound
StoryRun.totalRounds
StoryRun.hostRoleLockedAt

StoryPlayer.readyAt
StoryPlayer.roleLockedAt
StoryPlayer.connectionState
StoryPlayer.lastSeenSequence

StoryEvent.sequence
StoryEvent.idempotencyKey

NarrativeEntry
CanonFact
CharacterMind
StoryThread
SceneSnapshot
AiTaskOutbox（或等价可靠任务表）
EventDelivery（按玩家投影/送达/已读）
```

必须建立：

```text
@@unique([runId, sequence])
@@unique([runId, userId])
@@unique([runId, roleId])
命令 idempotencyKey 唯一约束
同一 sourceEventId 只有一个 published NarrativeEntry
```

### 4.3 World Package

正式世界注册表只包含两个世界：

| worldId | 名称 | 当前用途 |
|---|---|---|
| `sangtian` | 嘉靖财政危局 | 本轮完整产品流、三玩家七轮主验收；现有主游戏页面冻结复用 |
| `caesar_last_spring` | Caesar: The Last Spring of the Republic | 第二个正式世界的通用平台页与内容合同接入 |

World Package 至少提供：

```ts
id, title, tagline, description, genreTags
minPlayers, maxPlayers, minHumanPlayers
durationLabel, creditCost, totalRounds
assets.cardCover, heroImage, roomThumbnail, narrativeBackground
roles[].key/name/portraitUrl/publicHook/playable
metrics[], modules, opening, roundArcs, endings
```

新增世界不得新增平台页面或复制 Rooms/Result 组件。

### 4.4 AI 连续推演链路

```text
3 名玩家提交行动
→ 身份/权限/资源/知识/轮次/幂等校验
→ 冲突与规则结算，生成权威 statePatch/facts
→ 更新 CanonFact / CharacterMind / StoryThread / SceneSnapshot
→ ContinuityContextBuilder 组装六层上下文
→ NarrativePlanner 生成结构化 beats
→ ContinuityValidator 硬校验
→ NarrativeWriter 生成各玩家视角正文
→ Output Sanitizer + Final Validator
→ NarrativeEntry + StoryEvent + EventDelivery 同事务发布
→ Realtime/SSE 通知
→ 三个玩家获得不同但相容的视角
```

AI 不得直接修改权威状态；失败时使用确定性连续叙事 fallback，流程不能卡死。

## 5. 开发阶段总表

| 顺序 | 阶段 | 主目标 | 前置门槛 | 主要产物 |
|---:|---|---|---|---|
| 00 | D00 基线接管 | 冻结真源、工作区和 RunId | 无 | inventory、gap matrix |
| 01 | D01 UI/资产映射 | 5 图语义化和视觉基线 | D00 | UI manifest、fixtures |
| 02 | D02 通用平台壳 | Header、route、token、API client | D01 | 可访问空壳路由 |
| 03 | D03 认证闭环 | 登录、注册、忘记密码、returnTo、JWT | D02 | auth API/UI/安全测试 |
| 04 | D04 World Package | 两世界注册、桑田诏多人角色、凯撒配置 | D00 | packages、lint、catalog |
| 05 | D05 Room 数据模型 | StoryRun/Player/Role 扩展 | D03—D04 | migration、seed、readback |
| 06 | D06 Room API | 列表、创建、邀请码、选角、Ready、Start | D05 | API/权限/并发合同 |
| 07 | D07 五个页面 | 真实 DOM/CSS 实现 | D02—D06 | 5 routes、DOM tests |
| 08 | D08 Solo 产品流 | 世界详情到现有选角/游戏/结果 | D03—D07 | solo E2E |
| 09 | D09 Multiplayer 产品流 | 3 人正式浏览器流 | D06—D07 | room→game E2E |
| 10 | D10 连续性领域层 | facts/minds/threads/scenes/entries | D04—D05 | schema、context tests |
| 11 | D11 Planner/Writer | AI 双阶段、校验、fallback | D10 | AI pipeline tests |
| 12 | D12 Worker/Realtime | 202、Outbox、Worker、恢复、推送 | D11 | worker/recovery evidence |
| 13 | D13 桑田诏七轮与结果 | 3×7×21、结局、Result | D09—D12 | seven-round report |
| 14 | D14 安全/运维/部署准备 | 权限、日志、健康、Supabase、Railway-ready 产物 | D03—D13 | runtime evidence + deploy contract |
| 15 | D15 视觉与模拟玩家 | 5 新图 + 冻结回归 | D07—D14 | diff/SP reports |
| 16 | D16 最终收口 | fail-closed 聚合 | 全部 P0 | final verdict |

## 6. 详细开发步骤

### D00：接管、冻结基线和证据命名

1. 读取本文件全部真源、`git status`、当前路由、API、Prisma、测试与历史报告。
2. 新建本轮 `RunId`；所有结果、截图、API、DB 和 AI 证据绑定同一 RunId、源码 SHA 和工作区摘要。
3. 不清理或覆盖当前大量用户修改、删除和未跟踪资源。
4. 标记《嘉靖财政危局》主游戏冻结文件及允许改动的公共边界。
5. 建立 requirement → route → UI → API → DB → test 的追踪矩阵。

退出条件：每个 P0 要求有稳定 ID、责任文件、测试 ID 和证据位置。

### D01：5 张新 UI 与资产基线

1. 为 UI-NEW-01—05 计算 SHA-256、尺寸和语义 manifest。
2. 分析 Global Header、Logo、字体、色板、按钮、卡片、表单、状态 badge、间距、圆角和阴影 token。
3. 从 `docs/UI/web/pic/` 建立平台页临时 `assetKey` 候选表；只选语义接近素材，记录裁切与后续替换状态。
4. 固定视觉 viewport `1600×1000`、DPR=1、字体、动画关闭、固定 fixture。
5. 为登录/注册、世界详情、Rooms 列表、房间等待和结果页建立确定性状态注入。
6. 视觉脚本只能读取 reference 做离线比较，产品运行页面禁止加载 reference。

退出条件：5 张图分别可映射到唯一 route/state/fixture/control list。

### D02：通用平台壳、路由和 API client

涉及建议：

```text
apps/web/src/server.mjs
apps/web/public/platform.css
apps/web/public/js/api-client.js
apps/web/public/js/session.js
apps/web/tests/lobby-navigation.test.mjs
```

1. 增加 `/auth`、`/worlds/:worldId`、`/rooms`、`/rooms/:roomId`、`/game/result` 路由。
2. 实现统一英文 Header：Explore Worlds、Rooms、World Credits、Help、English、Profile。
3. URL 参数和动态 segment 必须安全解析；未知 worldId/roomId/runId 返回明确 404 UI。
4. API base 由环境配置注入；本地代理允许全部正式 `/api/v4` 路由，生产接 Railway API。
5. 统一 loading、empty、error、expired session、network retry 和 aria-live。

退出条件：五个路由在无数据时仍能显示真实、可访问、可诊断的页面壳。

### D03：认证产品化

1. `/auth` 同页支持 Log in / Sign up tab；密码最短统一为 8 字符。
2. 增加 Forgot Password 请求、一次性 reset token 和设置新密码流程；如果 MVP 暂不发邮件，测试环境必须有受控的 mail sink，不能把 token 暴露给生产 UI。
3. 增加签名、过期、撤销的 session/JWT；生产使用 Supabase JWT 验证或等价 AuthAdapter，禁止继续把可猜 openid 当长期 Token。
4. 注册、登录、登出、session expired、email already registered、invalid credentials 状态与 UI 图一致。
5. 实现 `returnTo` 白名单与邀请链接恢复。
6. 所有私有 StoryRun/Room/Result API 使用统一 AuthGuard 和对象权限。

退出条件：匿名用户不能读取私有房间或结果；三个测试账号可独立登录，身份不会串号。

### D04：通用 World Package、桑田诏多人角色与凯撒内容接入

1. 把首页 catalog 从页面硬编码收敛为 World Registry。
2. 为 `sangtian` 建立通用平台适配 package，复用现有 7 天/12 决策配置；增加按模式区分的角色可玩性：单人仅浙江总督，多人至少开放浙江总督、浙江巡抚、清流县令，其余角色由 AI 托管。
3. 为 `caesar_last_spring` 建立第二世界 package：6 个核心角色、七幕、背景、变量、知识边界、结局和资源；完整接入 Solo、Multiplayer 房间、Game、Result、恢复与重玩。至少完成一局七幕单人 E2E 和多人房间创建/加入/选角/Ready/Start/首轮结算 E2E；不得停在预览或只读数据合同。三玩家七轮的重型核心证明仍由《嘉靖财政危局》承担。
4. 首页只把这两个世界标记为 playable；其他故事卡必须显示 Coming Soon 且不可进入运行态。
5. 静态 lint 验证角色唯一、3—6 玩家、七幕、前六幕关键决策、知识边界、结局可达和资源存在。

退出条件：`GET /api/v4/worlds` 和 `GET /api/v4/worlds/:worldId` 只返回真实运行时可支持的字段和状态。

### D05：Room/Run 数据模型和迁移

1. 扩展 `StoryRun`、`StoryPlayer`、`StoryRole`，不创建平行业务模型。
2. 定义合法状态迁移：

```text
waiting_host_role
→ waiting_players
→ ready_check
→ starting
→ in_progress
→ resolving
→ finished

任意等待状态 → closed
```

3. Host 创建后必须先锁角色，之后才开放邀请；角色唯一约束由数据库和事务共同保证。
4. Ready 只对真人玩家有效；更换角色后 Ready 自动清除。
5. 迁移在现有 Supabase 上可重复部署；seed/upsert 只创建两个世界和带 RunId 的三个独立测试账号，不清空或覆盖既有数据。

退出条件：数据库独立读回可证明 host、inviteCode、players、roles、ready、status、version 和 world 配置一致。

### D06：Room API、权限和并发

正式合同至少包括：

```text
GET  /api/v4/rooms
GET  /api/v4/rooms/mine
POST /api/v4/rooms
POST /api/v4/rooms/join-by-code
GET  /api/v4/rooms/:roomId
POST /api/v4/rooms/:roomId/role
POST /api/v4/rooms/:roomId/role/lock
POST /api/v4/rooms/:roomId/ready
POST /api/v4/rooms/:roomId/start
POST /api/v4/rooms/:roomId/close
```

1. Open Rooms 只返回公开、未满、未开始的房间。
2. My Rooms 按 waiting/in-progress/completed 投影，并返回 Open/Continue/View Result action。
3. join-by-code 对无效、已满、已开始、已关闭、已加入分别返回稳定错误码。
4. 只有 Host 可锁定首个角色、Start、Close；非 Host 返回 403。
5. Start 条件：真人数达到 world.minHumanPlayers、所有真人已选唯一角色、全部 Ready、Host 已锁角色。
6. 同时认领同一角色只能一个成功；重复命令按幂等键返回同一结果。

退出条件：API 并发测试与 DB 读回证明无重复玩家、重复角色、重复启动或越权。

### D07：实现 5 个新增页面

#### D07.1 Login / Sign Up

- 真实表单、label、错误、loading、password reveal、remember me、forgot password。
- 顶部显示 Continue to `<world>` 或 Log in to join this room。
- Terms 与 Privacy 使用现有 legal routes。

#### D07.2 World Details

- 动态显示世界 title/tagline/description/hero/meta/roles/creditCost。
- Solo 与 Multiplayer 根据 world 能力和登录状态导航。
- 角色预览不泄露 hiddenSecret/privateObjective。

#### D07.3 Rooms

- Open Rooms、My Rooms、All Worlds 单一筛选。
- Create Room 和 Join with Code 只使用 modal。
- 空、满、等待、进行中、已完成和网络错误状态齐全。

#### D07.4 Room Waiting & Role Selection

- 玩家列表、空位、角色 Available/Taken/Selected、邀请复制、Ready、Start。
- Host 首选锁角；非 Host 在开放前不可抢占。
- Start 按钮根据条件禁用并显示具体未满足原因。

#### D07.5 Game Result

- Ending title/summary、Your Role/Ending、最多 3 个 Key Decisions。
- World State/Goals Completed 仅有真实数据时显示。
- Play Again、Try Another Role、Back to Worlds 都产生正确新/旧 Run 行为。

退出条件：5 个页面均为真实 DOM/CSS、真实 API、真实键盘操作，不存在截图皮肤。

### D08：单人完整流程适配

1. World Details 的 Solo 进入通用选角，并按 `worldId` 动态加载角色。
2. 《嘉靖财政危局》单人保持浙江总督与原页面；凯撒单人默认布鲁图斯，其他角色由 AI 托管。
3. 创建 Run 后只通过 `runId` 恢复，不能静默创建新局。
4. 完成后生成 Result projection，并跳转 Game Result。
5. 重玩必须创建新 Run；查看结果不得修改 finished Run。

### D09：正式多人产品流

1. 三个独立浏览器 context 使用三个真实测试账号。
2. Host 创建《嘉靖财政危局》私有房间并选择浙江总督；复制邀请链接。
3. 玩家 2、3 登录后通过链接加入，分别选择浙江巡抚、清流县令。
4. 三人 Ready，Host Start；未选角色由 AI 接管。
5. `/game` 按当前用户投影角色视角，不允许切换身份查看他人私有信息。
6. 断线重连回到同一 run/round/sequence，已提交玩家显示 Waiting。

### D10：连续性数据和 Context Builder

1. 增加单调 sequence 与统一 NarrativeEntry。
2. 增加 CanonFact、CharacterMind、StoryThread、SceneSnapshot。
3. 建立六层上下文：World Bible、Run Canon、Scene State、Character Minds、Story Threads、Recent Narrative Window。
4. 先把《嘉靖财政危局》浙江总督、浙江巡抚、清流县令的知识边界写成机器可校验配置；每次行动后只更新角色实际可知事实。凯撒 package 使用同一合同。
5. 每轮至少触碰一个当前冲突线程；到期线程必须回收、升级或显式延期。

退出条件：同一状态重复构建上下文结果稳定；任何角色不能读取其未知事实。

### D11：NarrativePlanner / NarrativeWriter / Validator

1. 规则层先确定权威 outcome、statePatch、facts、relationships 和 requiredNextPressure。
2. Planner 只输出结构化 beats、事实引用、角色知识引用、线程和 next hook。
3. 硬校验：事实存在、patch 不冲突、知识不越界、时间地点一致、内部键不泄漏、下一压力相关。
4. Writer 只根据已批准计划写每个玩家的视角正文。
5. 硬校验失败回 Planner repair；软质量不足回 Writer repair；最多 2 次。
6. 仍失败使用确定性连续叙事 fallback，并记录 `narrative_quality_degraded`。

### D12：异步 Worker、任务恢复和推送

1. Command API 接受后返回 202、taskId、runVersion、status=resolving。
2. Outbox 与权威状态同事务写入；Worker 领取任务使用 lease、attempt、nextRetryAt、expiresAt。
3. Worker 重复消费不得重复应用 statePatch 或发布 NarrativeEntry。
4. Reconciler 回收超时任务；API/Worker 重启后可继续。
5. SSE 或 Supabase Realtime 按玩家私有 channel 发送可见事件；HTTP 增量读取作为断线补偿。

### D13：《嘉靖财政危局》三玩家七轮与结果页

1. 七天分别作为七个主轮次的验收 checkpoint；第 1—6 天使用现有主线压力与决策，第 7 天完成御前裁决。
2. 每轮三个真人各提交一次有效行动，共 21 次；该轮只产生一次权威 resolution。
3. 每轮至少产生：公共世界变化、三个个人投影、可追踪跨玩家影响和送达记录。
4. 全七轮必须有至少 4 次跨轮事实回收；第 7 轮结局引用至少 3 个历史事实。
5. finished 后生成全局结局、每个角色个人结局、最多 3 个关键决策摘要和可选 world state/goals。

### D14：安全、可观测性和生产部署准备

1. 所有私有对象 API 做认证、成员关系、角色和 Host 权限检查。
2. 日志不记录密码、Token、完整 prompt、完整玩家私密行动或隐藏目标。
3. 增加 `/health/live`、`/health/ready`、Worker heartbeat、queue oldest age、AI latency/fallback/repair 指标。
4. 完成 API/Worker/Migration Service 的 Railway-ready 配置、启动命令、环境变量合同和 health/readiness；Railway 环境可用时部署并冒烟，不可用时保留可复现部署包与 `NOT_RUN_AWAITING_ENVIRONMENT` 证据。Web 在功能验收中连接当前真实 API base，不连接假服务。
5. 使用现有 Supabase PostgreSQL：验证脱敏 project ref、连接池/直连用途、已应用 migration、最小权限、对象隔离、并发事务和独立 SQL 读回；Realtime 私有频道与认证适配按正式合同接通。禁止把恢复演练写回权威数据库，restore smoke 必须使用独立目标。
6. 支付视为用户已验证能力，只运行非真实付款回归：checkout/webhook Schema、签名拒绝、重复 webhook 幂等、退款/争议账本合同和世界解锁扣点。不得为本轮验收发起真实支付，也不得伪造 `PURCHASED` 余额。
7. 增加测试专用加点脚本或管理端命令，必须同时满足：`NODE_ENV !== production`、`ALLOW_TEST_CREDIT_GRANT=true`、目标邮箱为本 RunId 创建的 `@example.test` 账号、单账号累计上限 1000、调用既有 `CreditsService.grantCredits`，并写入：

```text
kind = BONUS
source = ADMIN
reason = ADMIN_ADJUSTMENT
idempotencyKey = test-credit:<RunId>:<userId>:acceptance
metadata = { runId, purpose: "acceptance", grantedBy: "codex-test-harness" }
```

8. 默认每个测试账号增加 200 点；若两个世界实际解锁成本与重试储备超过 200，则按“本轮预计解锁总成本 + 一次重试储备”计算，但仍不得超过 1000。相同 RunId 重跑不得重复增加。
9. 加点后必须独立读回三名测试用户的余额和 ledger；随后通过正常 World Unlock API 消耗点数，验证余额扣减、解锁归属和重复解锁不重复扣费。测试入口不得出现在普通 Web UI，执行结束输出 grant ledgerId、spend ledgerId 和脱敏余额变化。

### D15：视觉、功能与模拟玩家闭环

1. 执行配套测试文档中全部 P0 FT、VT、SP。
2. UI-NEW-01—05 每轮输出 reference/actual/diff/metrics/summary。
3. 公共 CSS 改动后重跑《嘉靖财政危局》首页、选角和 UI01—UI08 冻结回归；该世界页面不进入主动改造。
4. 三个模拟玩家必须通过浏览器完成七轮，不得用直接 API 推进代替玩家流程。
5. 每个失败生成最小修复任务，修复后重跑目标测试和影响面回归。

### D16：最终收口

最终聚合器只读取当前 RunId：

```text
requirements
routes/UI
auth/security
world packages
rooms/concurrency
game/continuity
AI/worker/recovery
3-player-7-round
DB readback
credits/payment regression
visual diff
simulated players
deployment/observability
```

任一 P0/P1 缺实现或证据，最终状态不得为纯 PASS。聚合器发现失败后必须回到对应开发阶段修复并重跑，不得直接生成完成报告。

最终聚合同时输出两个互不替代的结论：

```text
Product Functional Verdict = PASS | REPAIR_REQUIRED
Railway Deployment Verdict = PASS | NOT_RUN_AWAITING_ENVIRONMENT | FAILED
```

本轮完成定义以 `Product Functional Verdict=PASS` 为准；Railway 未提供时不得把已通过的产品功能降级为 limitation，但也不得伪称已经完成 Railway 部署。

## 7. 验收步骤

### A00：真源与工作区验收

- 5 张新增图、两个剧本文档和指定方案文件均 UTF-8 可读。
- UI manifest 的 hash/尺寸可复算。
- 当前用户修改未被清理、覆盖或误提交。
- 当前 RunId、源码 SHA、环境摘要已记录。

### A01：干净启动与迁移验收

```powershell
pnpm install --frozen-lockfile
pnpm db:generate
# DATABASE_URL/SUPABASE_DATABASE_URL 由安全环境注入，禁止写入报告
pnpm db:migrate:deploy
pnpm db:seed
pnpm typecheck
pnpm dev:api
pnpm dev:web
```

必须证明当前 API 使用的是已确认 Supabase 项目而非本地 `55434` 或旧后台进程；完成 `SELECT 1`、migration table、两世界、测试用户、测试房间的写入与独立读回，并证明 API、Worker、Web、健康检查和 World Registry 均来自当前构建。日志和报告不得包含数据库连接串。

### A02：认证和导航验收

- 注册、验证、登录、登出、忘记密码和 session expired 通过。
- 未登录选择 Solo/Multiplayer、打开邀请链接后均能登录并恢复原动作。
- 非法 returnTo 不能开放重定向。
- 三个账号的 session、房间成员和角色完全隔离。

### A03：World Package 验收

- 首页只有凯撒与嘉靖财政危局可进入 World Details。
- 两世界共享页面代码但显示各自 title/assets/roles/metrics。
- 嘉靖财政危局 7 天、12 决策、多人三角色可玩性与知识边界 lint 通过；凯撒 6 角色和七幕 package lint 通过。
- 新增第二世界不需要新增平台页面代码。

### A04：Room 功能与并发验收

- 创建、公开列表、My Rooms、邀请码加入、Host 锁角、玩家选角、Ready、Start、Close 全部通过。
- 同时抢同一角色只有一个成功。
- 非 Host 不能 Start/Close；未 Ready、人数不足、重复角色不能 Start。
- 已开始/已满/已关闭房间不能被新成员加入。

### A05：单人闭环验收

- 嘉靖财政危局：Home → World Details → Auth → Role Selection → Game → Result；原有主游戏页面视觉与交互骨架不被改造。
- 凯撒：Home → World Details → Auth → Role Selection → 七幕 Game → Result 完整通过；另完成 Multiplayer 的创建/加入/选角/Ready/Start/首轮结算，证明通用房间和游戏合同真实复用。不得以 limitation、预览数据或只读详情替代。
- finished Run 只读，Play Again 创建新 Run。

### A05A：World Credits 与支付回归验收

- 三个本 RunId 测试账号通过受控入口各获得可审计 `BONUS/ADMIN/ADMIN_ADJUSTMENT` 测试点数；相同幂等键执行两次只产生一条 grant ledger。
- 普通用户和生产环境无法调用测试加点能力；非 `@example.test` 账号、超过上限或缺显式开关全部拒绝。
- 通过正式世界解锁 API 消耗测试点数，余额、ledger、Story Access/Run 归属一致；重复命令不重复扣费，余额不足稳定拒绝。
- 支付只做自动化合同和账本回归，复用用户已验证结论，不发起真实付款；伪造签名和重复 webhook 必须安全处理。

### A06：三玩家七轮验收

- 三个独立账号、三个独立浏览器 context、三个唯一角色。
- 7 轮 × 每轮 3 次 = 21 次真人有效行动。
- 7 个且仅 7 个权威 resolution。
- 每轮相互影响可追踪；每个玩家收到属于自己的叙事投影/通知。
- 隐藏知识、私密行动和幕后推理不串号。
- 刷新、断线、重复提交、一个 AI 超时均不造成重复结算或死局。

### A07：AI 连续性验收

- Action Coverage、Fact Grounding、Prompt Bridge 目标 100%。
- Knowledge Safety 和 Internal Key Leakage 目标 0。
- 至少 4 次跨轮因果回收；第 7 轮结局可追溯至少 3 个历史事实。
- 玩家能回答“我做了什么、谁受影响、世界如何变化、下一压力为什么出现”。
- AI 双失败时 fallback 仍能继续下一轮。

### A08：Game Result 验收

- 三名玩家看到相同全局结局、各自不同且正确的角色结局。
- Key Decisions 不超过 3 条且来自真实历史事件。
- World State/Goals 无数据时完全隐藏。
- Play Again、Try Another Role、Back to Worlds 行为正确。

### A09：视觉与交互验收

5 个新增页面分别具备：

```text
reference.png
actual.png
diff.png
metrics.json
visual-summary.json
interaction-trace.json
```

建议门槛：尺寸完全一致、changed-pixel ratio ≤ 0.01、mean RGB delta ≤ 0.01、关键几何偏差 ≤ 2px；阈值通过后仍需人工检查文案、换行、错图、遮挡、焦点和真实可点击性。

### A10：生产架构验收

- API/Worker/Migration 可独立启动，Railway 所需 build/start/migrate/health 合同完整且可复现。
- 202 + Outbox + Worker + Reconciler + 推送/补偿闭环通过。
- 现有 Supabase 和当前 Web/API/Worker 使用真实非生产测试账号和 RunId 数据完成验收；Supabase 连接、迁移、权限、并发和独立读回必须为当前证据。
- Railway 可用时增加部署和云端 smoke；不可用时只把 Railway 子结论标为 `NOT_RUN_AWAITING_ENVIRONMENT`，不进入产品功能失败数。
- readiness、Worker heartbeat、queue age、AI 超时和 fallback 指标可读。

### A11：最终门禁

只有以下全部满足才允许纯 `PASS`：

- P0 需求全部有实现、测试和同 RunId 证据。
- 5 个新页面全部真实可操作且视觉通过。
- 两个世界均来自真实 World Package 并能实际进入 Game 与 Result；嘉靖财政危局可完整玩并完成三玩家七轮，冻结主游戏页面回归通过；凯撒七幕单人闭环和多人首轮复用通过。
- 认证、对象权限、房间并发和私密投影通过。
- 三玩家七轮、21 行动、7 resolution、相互影响、结局通过。
- 连续性、AI fallback、幂等、重启恢复和当前 Supabase 数据库读回通过。
- 测试加点、世界解锁扣点、支付合同回归通过且无真实付款副作用。
- Supabase 与当前真实 Web/API/Worker 非生产链路有当前证据，不能用文件存储、旧报告或 limitation 替代；Railway 部署按独立子结论报告。

## 8. 失败处理

| 状态 | 含义 | 处理 |
|---|---|---|
| `REPAIR_REQUIRED` | 可修复断言失败 | 建立最小修复，重跑目标与影响面 |
| `BLOCKED_BY_ENVIRONMENT` | Supabase、浏览器、网络等外部依赖在排障后仍不可用 | 记录命令、错误和已尝试恢复动作；不等于完成；本地 Docker 缺失本身不是 blocker |
| `BLOCKED_BY_CREDENTIAL` | 现有环境意外缺少 Supabase/DeepSeek 等产品功能必需授权 | 精确指出缺哪一项；先排除配置错误；不等于完成。Railway 缺失只影响独立部署子结论 |
| `PASS_WITH_LIMITATION` | 中间检查发现证据或功能不全 | 仅可作为修复循环中的临时状态，禁止作为本轮最终状态 |
| `HARD_FAIL` | 权限泄漏、数据重复、参考图作弊、生产副作用 | 立即停止发布，修复后全量回归 |

## 9. 最终完成定义

最终完成不是“出现了 5 个页面”，而是以下闭环可由新玩家独立完成：

```text
注册或登录
→ 选择嘉靖财政危局
→ 创建/加入房间
→ 三人选择不同角色并 Ready
→ Host 开始
→ 三人连续七轮作出相互冲突或协作的决定
→ 系统以权威规则结算事实
→ AI 根据本局事实、角色知识和未完成线程生成连续剧情
→ 三人分别看到正确视角和他人影响
→ 第七轮形成可追溯结局
→ 每人看到自己的 Game Result
→ 可以恢复、重玩或换角色
```

同时，《嘉靖财政危局》的现有主游戏页必须保持原样可玩，不因平台公共改造发生视觉或交互骨架回归；第二个凯撒世界必须能实际完成同一套平台页、游戏与结果流程。现有 Supabase 中的迁移、房间、事件、AI 任务、Credits 账本和结局读回必须与 UI/API 证据一致。最终剩余功能缺口、失败测试、未处理 limitation 和测试数据越界均为 0，才算“一次性完成所有功能”。
