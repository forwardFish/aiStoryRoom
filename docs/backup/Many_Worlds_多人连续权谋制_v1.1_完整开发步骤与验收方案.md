# Many Worlds 多人连续权谋制 v1.1：完整开发步骤与验收方案

## 0A. 2026-07-16 中国大陆内置 Browser 验收覆盖条款（用户确认）

由于 Chrome 扩展在中国大陆不可用，最终 D10/D11 真实用户验收改用 Codex 内置 Browser。三个玩家必须分别运行在三个可见标签页和三个独立 origin：`http://one.localhost:5218`、`http://two.localhost:5218`、`http://three.localhost:5218`。HttpOnly Cookie 必须为 host-only，三页账号、角色和私人投影相互隔离。

该覆盖只替换“3 个 headed Chrome 独立进程/user-data-dir”这一浏览器载体；注册、邮箱验证、登录、创建/加入房间、选角、Ready、Start、七轮 MAIN/MANEUVER/REACTION、掉线接管与玩家回归仍必须通过可见页面纯 UI 完成。禁止 Token/Cookie 注入、页面内 fetch、直接接口代替点击、DOM 事件注入或单页切换角色。三个标签页仍须逐页截图、检查控制台与网络错误，并由 Supabase 在事后独立读回。


> 文档状态：PLANNED，不代表功能已经完成  
> 编制日期：2026-07-15  
> 适用仓库：`D:\lyh\agent\agent-frame\aiStoryRoom`  
> 源码基线：执行时动态冻结；不得把本文编制时的 branch/SHA 当作实施 SHA，见 0.1  
> 前置方案：`docs/Many_Worlds_多人连续权谋制_产品与工程改造方案_v1.0.md`  
> 配套测试：`docs/Many_Worlds_多人连续权谋制_v1.1_三真实玩家七轮功能测试方案.md`  
> 首个落地世界：《桑田诏：嘉靖财政危局》

## 0. 最终决策

v1.0 对问题判断正确，但不能原样作为 P0 开发基线。它同时引入行动窗口、主决策、谋划、回应、条件后手、承诺、证据、解释权、暗线、通用世界边界、五层 AI、分视角投影和实时事件，范围过大；同时仍可能把“空白等待”改成“用完一次谋划后的倒计时等待”。

v1.1 将 P0 收缩为一个可以用三个真实玩家验证的纵向产品闭环：

```text
三名真人、三个不同角色
→ 七个固定危局阶段
→ 每阶段三份私人简报和三组角色专属行动
→ 密封主决策
→ 立即收到确定性执行回执
→ 至少保留一次主动谋划机会
→ 必要时处理一次定向回应
→ 玩家明确退出或长时间断线时，角色不消失，转为受限的 AI 托管
→ 服务端自动收束，不依赖房主
→ 一次权威因果结算
→ 三份个人结果 + 一份公共结果
→ 自动进入下一阶段
```

P0 只在《嘉靖财政危局》的实时权谋房启用，允许 1—3 名真人开局；所有已加入真人必须各选不同角色并 Ready，空缺的可玩角色从第一窗口起就是 `AI_ACTIVE`。开局后可有 0—3 名真人继续在线，退出/断线角色由 AI 托管并把世界推到第 7 阶段结局。最终 D10 仍强制使用三名真人完整七轮，不能用开局补位路线代替。江南商会是固有系统行动者 `worldActor`，不是 `StoryRole`，不占第四个真人席位，也不与“可玩角色的 AI 托管”混为一类。长周期异步房、四真人房、完整承诺系统、条件后手编辑器和通用欺骗引擎进入 P1。

完成结论必须同时具备：

```text
实现代码
+ 自动测试
+ 三个隔离浏览器的真实页面操作
+ 明确退出、异常断线、返回接管，以及“本局已由真人完成必需授权/共享世界解锁后”全员 AI 托管到结局的证据；未解锁时稳定暂停并可由真人在同一 Run 恢复
+ 七轮角色级页面证据
+ API/事件流隐私审计
+ 声明且命中非生产 allowlist 的 Supabase 隔离 schema 独立读回；禁止本地 PostgreSQL 16、Docker PostgreSQL 或其他数据库替代
+ Worker 故障恢复证据
+ UI01—UI08 回归证据
```

仅有文档、接口 200、单浏览器切换角色、直接 API 推进、数据库计数或房主页面截图，均不能判定完成。

### 0.1 动态源码基线与 dirty worktree 保护

本文不再固定某个历史 SHA。每次开始或恢复实施时，必须先在同一工作目录只读采集并写入本次验收目录：

```text
sourceBranch
sourceHeadSha
sourceHeadCommitTime
gitStatusPorcelainV1WithUntracked
dirtyFileList
dirtyDigest = SHA-256(status 原文 + 每个 dirty/untracked 文件的相对路径、文件大小和内容 hash)
planHash / pairedTestPlanHash
prismaSchemaHash / migrationDirectoryHash
webRouteConfigHash / apiContractHash
capturedAt / timezone
```

执行器不得为了得到“干净基线”而自动 `reset --hard`、`checkout --`、删除 untracked、覆盖、移动或 stash 用户修改。若任务文件与已有 dirty 文件重叠，先记录 before hash 和最小修改范围；无法无损合并时停止为 `NEEDS_USER_COORDINATION`，不能把用户修改当成旧代码清理。实施期间发现 HEAD、migration 目录、两份 v1.1 文档或已声明输入文件发生变化，当前 checkpoint 标记 `SOURCE_DRIFT`，重新冻结新的 `attemptId`；旧证据保留但不得与新源码混成同一次 PASS。

`manifest.source` 中的 SHA/hash 才是最终报告的真实源码基线。文档中的文件行号只是编制时导航，执行时必须重新定位符号和路由，不能因行号漂移修改错误文件。

### 0.2 单一 Goal、checkpoint 和验收清单

完整交付只使用一个顶层 Goal：`continuous-strategy-v1.1`。checkpoint 固定为 `D00、D01、D02、D02A、D03、D04、D05、D06、D07、D08、D09、D10、D11`；它们属于同一 Goal，不是可以分别宣称产品完成的独立任务。每个 checkpoint 状态只允许：

```text
NOT_STARTED | IN_PROGRESS | PASS | FAIL | SOURCE_DRIFT | NEEDS_USER_COORDINATION | EXTERNAL_BLOCKED
```

证据真源固定为：

```text
docs/auto-execute/evidence/continuous-strategy/<attemptId>/acceptance-manifest.json
```

manifest 至少包含：

```json
{
  "schemaVersion": "continuous-strategy-acceptance-v1",
  "goalId": "continuous-strategy-v1.1",
  "attemptId": "<uuid-or-timestamp>",
  "startedAt": "<iso-8601>",
  "finishedAt": null,
  "source": {
    "branch": "<dynamic>",
    "headSha": "<dynamic>",
    "baselineSourceFingerprint": "<sha256>",
    "planHash": "<sha256>",
    "pairedTestPlanHash": "<sha256>",
    "buildArtifactSha256": null,
    "configFingerprint": "<sha256>",
    "strategyRegistryHash": "<sha256>",
    "strategyArtifactHashes": { "sangtian_v1_1": "<manifest-sha256>" }
  },
  "database": {
    "provider": "supabase",
    "projectRefRedacted": "<non-production-project>",
    "schema": "<isolated-non-public-schema>",
    "nonProductionAllowlistMatched": true,
    "schemaHash": "<sha256>",
    "migrationDirectoryHash": "<sha256>",
    "databaseFingerprintRedacted": "<value>",
    "appliedMigrations": []
  },
  "services": [],
  "browsers": [],
  "requiredCheckpointIds": ["D00", "D01", "D02", "D02A", "D03", "D04", "D05", "D06", "D07", "D08", "D09", "D10", "D11"],
  "checkpoints": [],
  "routes": [],
  "artifacts": [],
  "externalBlockers": [],
  "gates": {},
  "verdict": null
}
```

manifest 不再保留会与 verdict 冲突的顶层 `status`。唯一生命周期不变量是：执行中 `finishedAt=null && verdict=null`；终态 `finishedAt!=null && verdict in [PASS, FAIL, EXTERNAL_BLOCKED]`。其他组合（例如 verdict 已 PASS 但 finishedAt 为空）一律为 `FAIL/MANIFEST_LIFECYCLE_INVALID`。

`routes[]` 是 laneId→RunId 的唯一绑定真源，`artifacts[]` 是聚合器允许读取的唯一证据白名单；不得再维护另一个 `runIds` 副本。`requiredCheckpointIds` 与 `checkpoints[].checkpointId` 必须始终集合完全相等，缺失/多余/重复/skipped 均失败；只有最终 `verdict=PASS` 时才要求 13 项全部 PASS。合法 `EXTERNAL_BLOCKED` 可让命中外部依赖的 checkpoint 为 EXTERNAL_BLOCKED、仅因该依赖尚未执行的下游为 NOT_STARTED，但每项必须关联同一 `externalBlockers[]` 记录，且不得同时存在代码 FAIL、SOURCE_DRIFT 或 NEEDS_USER_COORDINATION。checkpoint 可使用上列七种内部状态，但 manifest 的最终 `verdict` 只允许 `PASS | FAIL | EXTERNAL_BLOCKED`：`SOURCE_DRIFT`、`NEEDS_USER_COORDINATION` 或任何代码/测试失败最终都归为 `FAIL`，不能形成第四种完成状态。

`EXTERNAL_BLOCKED` 只允许用于当前代码无法控制的外部依赖，例如已声明的 Supabase 验收项目/连接、DeepSeek、正式邮件投递或桌面内置 Browser 运行环境不可用；必须记录 provider、首次/末次失败时间、脱敏错误、已完成的本地替代验证和恢复后应重跑的 checkpoint。代码缺失、migration 不完整、测试失败、应用自身的 429、路由错误、cookie/SSE 错误和浏览器脚本缺陷均是 `FAIL`，不能包装成外部阻塞。只有 DeepSeek 上游明确返回 quota/rate-limit 429，且保留 requestId、脱敏响应头、当前模型和有界重试证据时，才允许 `EXTERNAL_BLOCKED:DEEPSEEK_QUOTA`；错误 key/model/base URL、响应解析、fallback 和本地 fault injection 产生的 429 都是 `FAIL`。任何 `EXTERNAL_BLOCKED`、limitation、未执行门禁或混用旧 RunId 时，最终 verdict 不得为 `PASS`。

## 1. 当前项目真实基线

### 1.1 可以复用的能力

| 能力 | 当前证据 | v1.1 判断 |
|---|---|---|
| `StoryRun` / `StoryRole` / `SceneNode` | `prisma/schema.prisma:111-176,220-328` | 继续作为房间、世界局、角色和阶段聚合根 |
| `DirectorResolution.nodeId @unique` | `prisma/schema.prisma:367-375` | 保留为一阶段一权威结算的最终防线 |
| `CanonFact` / `CharacterMind` / `StoryThread` | `prisma/schema.prisma:419-481` | 作为事实、角色知识和长期压力基础；当前并不等于私人投影已经完成 |
| `SceneSnapshot` / `NarrativeEntry` | `prisma/schema.prisma:485-529` | 复用为公私读模型，但必须增加稳定去重合同 |
| `StoryTaskOutbox` | `prisma/schema.prisma:657-680`、`apps/api/src/story-task-outbox.service.ts:47-138` | 复用租约、心跳和重试；补齐端到端可恢复结算 |
| 房间成员事件 API | `apps/api/src/rooms.controller.ts:22-23`、`rooms.service.ts:270-315` | 复用入口；改成每成员稠密的 deliverySequence 游标和真正的前端订阅 |
| 单人正式主游戏 UI | `apps/web/public/app.js`、`main-game.css` | 作为唯一多人游戏页面骨架，不新造仿制页 |
| 单人谋划与关键回应 UI | `apps/web/public/app.js:126-180,653-676` | 复用交互形态；数据必须改由多人私有投影提供 |
| 旧三浏览器脚本参考 | `scripts/e2e/many-worlds-v13-browser-three-player.mjs:34-180` | 只参考注册、邀请、选角、Ready、Start 的业务顺序；最终验收必须重新实现为内置 Browser 的三个获准 origin/可见标签页，禁止复用其 headless、Token 注入或页面内 fetch |

### 1.2 当前必须修正的事实

| ID | 当前事实 | 风险 |
|---|---|---|
| GAP-01 | 本地 `server.mjs` 已把 `/room-game` 重定向到 `/game`，但生产 `vercel.json` 仍可能 rewrite 到旧 `room-game.html` | 只验本地会让生产继续进入错误页面；必须验证 build 产物 |
| GAP-02 | `RoomStoryStorage` 在浏览器中硬编码世界数值、角色资源、关系和谋划额度，见 `room-story-storage.js:87-168` | 页面虽然复用 `app.js`，数据仍是假适配层 |
| GAP-03 | 多人模式在 `app.js:653-655` 直接禁用谋划；`app.js:732-749` 仍显示等待和房主结算 | 与连续权谋目标正面冲突 |
| GAP-04 | `GET /rooms/:id/game` 只返回公共节点和 `submittedRoleIds`，见 `rooms.service.ts:181-202` | 没有私人简报、行动窗口、可用谋划、回应和个人结果 |
| GAP-05 | 当前只有 `POST .../game/action`，见 `rooms.controller.ts:18` | MAIN/MANEUVER/REACTION 尚无权威合同 |
| GAP-06 | `requireResolvableNode()` 要求房主且全员提交，见 `rooms.service.ts:319-331` | 房主离线会卡住世界 |
| GAP-07 | 事件流实际路径是 `/:roomId/events/stream`，不是 v1.0 写的 `/game/events/stream` | 文档与代码不一致 |
| GAP-08 | 当前 SSE 以通知 `createdAt` 作游标并每秒查库，前端没有持续消费 | 可能丢事件、重复事件，无法支撑回应窗口 |
| GAP-09 | `PlayerAction` 仍是 `@@unique([nodeId, roleId])`，见 `schema.prisma:330-364` | 无法保存一轮中的主决策、谋划和回应 |
| GAP-10 | 旧 StoryController 可绕过房间私有投影读取/结算节点 | 私密行动上线前存在 P0 信息泄露通道 |
| GAP-11 | 当前模板七轮全部复用三个公共选项，见 `packages/templates/src/index.ts:273-281` | 角色只是换名字，不会形成真实角色策略 |
| GAP-12 | 现有 `room-main-game.test.mjs` 验收等待页和房主 Resolve | 测试正在把错误体验固定为 PASS |
| GAP-13 | 玩家/角色控制权没有持久化状态，浏览器关闭后只能等超时 | 一人退出会拖住每轮，无法让角色作为世界实体继续行动 |
| GAP-14 | schema 已声明 `CanonFact/CharacterMind/StoryThread/SceneSnapshot/NarrativeEntry/StoryTaskOutbox`，migration 目录却没有对应建表 SQL | 空库 `migrate deploy` 与开发库可能不是同一结构，P0 migration 会建立在漂移基线之上 |
| GAP-15 | Web/API 当前认证已转为 HttpOnly cookie，旧方案仍按 localStorage Bearer 设计 SSE | 浏览器无法/不应读取 cookie token；401 还可能误降级 SOLO |
| GAP-16 | 现代码以 `STORY_WORKER_ENABLED` 控制消费者，而测试拓扑使用 `STORY_WORKER_EMBEDDED` | 故障测试时 API 可能偷领任务，无法证明独立 Worker 恢复 |
| GAP-17 | heartbeat 每秒一次、三玩家合计约 180 POST/分钟，而通用写限流默认按 IP 120/分钟 | 同 NAT 的正常三浏览器会被 429 并误判离线 |
| GAP-18 | `StoryRun` 没有持久引擎版本，现有创建逻辑的 `mode` 又不足以区分连续权谋 | Feature Flag 关闭/重启后既有 Run 可能被路由到另一引擎 |

## 2. P0 产品合同

### 2.1 角色口径

```text
真人 1：浙江总督
真人 2：浙江巡抚
真人 3：清流县令
系统行动者：江南商会（`worldActor`，不创建 `StoryRole`）
```

生命周期固定为：`POST /api/v4/rooms` 在创建 `StoryRun` 的同一事务中只创建 3 个真人可选 `StoryRole`；三名成员 join/claim 时各创建或幂等绑定 1 个 `StoryPlayer`，因此选角和 Ready 均发生在 Start 前；Start 不得重建角色或玩家。每局 Start 前必须稳定读回 `StoryRole = 3`、真人 `StoryPlayer = 3`，且模板合同中恰有 1 个 `worldActor=江南商会`。江南商会没有 `StoryRole/StoryPlayer/participant/RoleControl`，大厅不得生成它的选角卡；任何以它的 actorKey/伪造 roleId 发起的 claim 都必须拒绝。它不 Ready、不 DONE、不占真人超时或完成计数。

每阶段由确定性世界规则为江南商会生成且仅生成一条 `SYSTEM_ACTION`，输入是上阶段已发布事实、市场状态和玩家对商会的真实影响；AI 只负责表述，不临时决定它有什么资源。七轮验收因此必须读到恰好 7 条 `SYSTEM_ACTION`。

### 2.2 玩家、角色和控制器

世界中永久存在的是角色，玩家只是当前控制器。`StoryPlayer` 保留开局成员和历史归属，不因退出而删除；每个可玩角色再有一个持久化控制状态：

```text
HUMAN_ACTIVE --心跳中断--> HUMAN_OFFLINE_GRACE
HUMAN_OFFLINE_GRACE --恢复心跳--> HUMAN_ACTIVE
HUMAN_OFFLINE_GRACE --恢复期到期，单事务递增 epoch + transition + 条件式 outbox--> AI_ACTIVE
HUMAN_ACTIVE --明确 HANDOFF_TO_AI，单事务递增 epoch + transition + 条件式 outbox--> AI_ACTIVE
AI_ACTIVE --存在已开放未密封安全槽位，CAS reclaim--> HUMAN_ACTIVE
AI_ACTIVE --R1—R6 当前无安全开放槽位，reclaim--> HUMAN_RECLAIM_PENDING
HUMAN_RECLAIM_PENDING --R1—R6 下一安全未密封槽位/窗口--> HUMAN_ACTIVE
AI_ACTIVE --R7 已进入 CLOSING/RESOLVING/PROJECTING，reclaim--> AI_ACTIVE（命令响应 FINALIZING，不写 transition）
```

控制规则：

1. 真人点击“退出本局并交给 AI”后，服务端在一个事务中递增 control epoch、记录 transition 并转 `AI_ACTIVE`；只有当前存在已开放且未终态的 MAIN/MANEUVER/REACTION 时，该事务才同时 enqueue 对应任务。若处于 CLOSING/RESOLVING/PROJECTING/RESOLVED，当前窗口任务数必须为 0，R1—R6 由下一窗口开放事务入队，R7 直接随终局完成；普通刷新、短断线或浏览器后台不能立即触发托管。
2. 心跳每 15 秒一次；生产 45 秒无心跳进入 `HUMAN_OFFLINE_GRACE`、60 秒后自动托管，自动故障测试分别为 3/8 秒。恢复期内窗口继续运行；若当前槽位先到期，本轮使用保守 fallback，但不因一次超时永久改为 AI。
3. 已密封的真人 action 永不被 AI 覆盖；AI 只处理尚未终态的 MAIN/MANEUVER/REACTION，每槽唯一约束不变。MAIN 必须密封 action；MANEUVER 可密封 action 或显式 `PASS`；已打开的 REACTION 必须选合法回应或确定性 fallback。`PASS` 只将 participant 槽位标为终态并写审计，不伪造 `PlayerAction`。
4. AI 只接收该角色的 `RoleAgentProjection`：私人简报、角色目标、已知事实、自有资产、可见痕迹和可用行动卡；不得接收其他角色私密投影、全量行动或裁决器内部状态。
5. AI 使用与真人相同的行动卡、Guard、资产账本和因果裁决；模型失败时使用该角色配置的确定性 `aiFallbackActionKey`，不能卡局。
6. 混合局中 AI 在可操作槽打开后 5 秒内提交，仍为在线真人保留 Grace。当三个可玩角色都为 `AI_ACTIVE` 时，所有当前可用的 MANEUVER/REACTION Agent task 必须先到达 `SEALED_ACT | SEALED_FALLBACK | PASS | STALE | NO_OP` 终态；`FAILED`、仍在租约中或待重试的任务不算队列清空。队列清空后再保留 `AI_ONLY_GRACE=3 秒` 静默期，若期间出现新请求则重置，队列再次清空后才自动收束。槽位额度保证该循环有限。
7. 原玩家返回时可先观看自己角色投影，但不能与 AI 并发操作同一槽位。若当前有任一已开放、未密封的安全槽位（例如 AI 已密封 MAIN，但 MANEUVER 仍 AVAILABLE），返回玩家可用 CAS 立即取回从该槽位开始的控制权，旧 epoch 的 Agent 任务无副作用结束。R1—R6 若正处于 CLOSING/RESOLVING/PROJECTING 而无安全槽位，转 `HUMAN_RECLAIM_PENDING`，从下一窗口生效。R7 的这些状态没有下一窗口，reclaim 返回 `FINALIZING` 并保持当前控制状态；终局发布后返回 `RUN_COMPLETED`，原玩家始终可查看自己的结果，不得留下永远无法生效的 pending。
8. `HANDOFF_TO_AI` 不删除 `RoomMember/StoryPlayer`、不释放已开局角色、不中断原玩家对自己投影的观看权；它只改变当前控制器。开局前的“离开房间”仍可释放角色；开局后的旧 leave-room 入口必须明确转入 handoff 语义或拒绝并引导二次确认，不得物理删除运行中的角色归属。

房主退出不改变房间生命周期，也不转移“结算权”，因为正常流程根本没有玩家结算权。

### 2.3 每阶段行动额度

```text
MAIN：每个可玩角色 1 次；由当前 HUMAN/AI 控制器提交，超时执行最小维持行为
MANEUVER：每个可玩角色最多 1 次；可选，但系统必须给当前控制器完整使用机会
REACTION：每个可玩角色最多 1 次；仅定向事件触发
READ/REVIEW：不限次数，不消耗行动额度
DONE：当前控制器可声明本阶段布局完成，只代表该角色，不替其他角色结束机会
LEAVE_STAGE：DONE 后可以暂时离开本阶段页面；当前 ActionWindow 内仍保持 HUMAN，不触发 AI
HANDOFF_TO_AI：明确退出本局并把该角色后续控制权交给角色 Agent
```

`LEAVE_STAGE` 写入当前 `stageLeaveWindowId`，并使本窗口豁免断线托管；不设置永久豁免。下一个 `MAIN_OPEN` 时，若玩家仍无新心跳，从新窗口的 `mainOpenedAt` 开始进入新的 offline grace；若在新窗口恢复期内返回则继续 HUMAN，只有再次超过托管阈值才切为 AI。因此“本轮完成后离开页面”不会破坏当前布局，也不会让后续轮永久卡住。

P0 主决策界面不展示九字段复杂表单，只展示：

```text
角色专属行动卡（3 选 1）
+ 目标（仅需要时）
+ 可选筹码
+ 一句可选补充
```

行动卡配置内部携带 `objective`、`visibility`、`risk` 和默认 fallback。高级“自拟行动”可以展开更多字段，但不作为首次玩家必经步骤。

### 2.4 行动窗口状态机

```text
PREPARING
  生成公共局势、三份私人简报、角色行动卡和行动额度
  ↓
MAIN_OPEN
  各自密封 MAIN；提交者立即进入自己的谋划区
  ↓ 三个可玩角色 MAIN 完成（HUMAN/AI/TIMEOUT 均可），或 mainClosesAt 到期
INTERACTION_GRACE
  固定保留谋划、定向请求和回应时间；不得被提前跳过
  ↓ graceClosesAt 到期，或 grace 最短时间已过且三个可玩角色都 DONE、无待回应
CLOSING
  CAS 关闭；在同一事务中过期所有 OPEN 回应、应用默认结果，并拒绝此后的 MAIN/MANEUVER/REACTION
  ↓
RESOLVING
  一个权威任务完成冲突、资源、证据和事实结算
  ↓
PROJECTING
  生成一份公共结果和三份隔离个人结果
  ↓
RESOLVED
  自动创建下一阶段；第 7 阶段转完成态
```

共享世界等需真人明确授权/消费的门槛是 Run 级暂停，不是 Role Agent 行动槽：未解锁时下一窗口可保持 `PREPARING` 且所有截止时间为空，`StoryRun.status=WAITING_FOR_HUMAN_UNLOCK`，不 enqueue Agent 行动任务。原玩家回来并通过正式 UI 解锁后，以同一 RunId 原子回到 PREPARING/开窗流程。Role Agent 不能自行选免费路径、扣 Credits 或伪造解锁。

时间配置：

| 场景 | `MAIN_OPEN` 最长 | `INTERACTION_GRACE` | 用途 |
|---|---:|---:|---|
| 正式实时房 | 180 秒 | 45 秒 | 三名真实同时在线玩家 |
| 本地人工三页面验收 | 1200 秒 | 900 秒 | 一个人依次逐屏阅读、截图并操作三个页面，覆盖谋划和定向回应；仅验收 profile，生产时序不变 |
| 自动七轮成功路线 | 60 秒 | 30 秒 | 能在剩余大于 20 秒时创建并完成强制回应 |
| 自动超时专用路线 | 15 秒 | 8 秒 | 只测超时、默认结果和自动推进，不测 REACTION |

服务端 `mainClosesAt` 和 `graceClosesAt` 是唯一权威时间。`GameProjection` 必须返回 `serverNow`，前端用 `serverNow ↔ receivedAt` 估算偏移并显示倒计时；刷新和 SSE 重连后必须重新校准，不允许浏览器时钟改变截止结果。

`graceMinClosesAt = min(graceOpenedAt + 20 秒, graceClosesAt)`。混合/真人局至少保留 20 秒交互期；`15/8` 超时专项保留全部 8 秒且不创建强制回应。只有到达 `graceMinClosesAt`、三个可玩角色都 DONE 且没有 OPEN 回应时才能早于 `graceClosesAt` 收束。

若三个可玩角色全部 `AI_ACTIVE`，不使用上述 20 秒真人保护期：当前全部 Agent 槽位任务进入终态的时刻记为 `aiQueueDrainedAt`，取 `graceMinClosesAt = min(aiQueueDrainedAt + AI_ONLY_GRACE, graceClosesAt)`。静默期内新建可执行请求时清空 `aiQueueDrainedAt`，直到新任务再次终态。

到 `graceClosesAt` 仍有租约中、待重试或 FAILED 的槽位时，不能绕过“FAILED 不算 queue drained”直接关窗。Scheduler 必须执行一个 `forceFinalizeAiSlots(windowId, closingVersion)` 事务：锁定窗口/participant；递增任务 leaseVersion 并使旧 Worker 失去写权；对每个未终态槽通过同一 ActionCommand/Guard/资产路径密封内容配置的确定性 fallback（可选 MANEUVER 也可按策略 PASS）；把对应 `RoleAgentDecision.status` 写为 `SEALED_FALLBACK/PASS`，已失效 decision 写 `STALE/NO_OP`；所有关联 Outbox 写 `status=COMPLETED` 且 `outcome=SEALED_FALLBACK|PASS|STALE|NO_OP`。确认 RoleAgentDecision 无 FAILED/PENDING、Outbox 无 FAILED/PENDING/RUNNING 后，才以同一 closingVersion CAS 进入 CLOSING。事务失败就保持窗口未关闭并重试，绝不留下“窗口已关但 Agent decision/task 仍失败”的中间态。

### 2.5 “无空白等待”的可测试定义

统一结算必然要等其他真人完成，因此 P0 不作“零墙钟等待”的虚假承诺。“无空白等待”是指玩家不被锁在一张没有操作价值的等待页上：

1. MAIN 提交后 2 秒内出现真实执行回执。
2. 回执后 2 秒内至少出现一个有效后续入口：谋划、回应、痕迹调查或历史复盘。
3. 系统不得以大型 `1/3 已提交、等待其他玩家` 页面覆盖游戏区。
4. 玩家完成自己的布局后可以点击 DONE，并选择继续查看局势或离开本阶段；不得要求页面保持打开。
5. 在玩家尚未点击 DONE 时，页面始终保留至少一种有效操作或信息活动；全屏硬阻塞时间为 0。
6. 已到 `graceMinClosesAt` 之后，最后一项必要角色动作/回应完成后 1 秒内进入 `CLOSING/RESOLVING`。
7. 体验指标使用 `avoidableIdle = closingAt - max(lastUsefulActionAt, graceMinClosesAt)`，目标 P95 < 2 秒、最大 ≤ 5 秒；强制 Grace 保护期的原始墙钟时间另行记录但不误判为可避免空闲。`manual-three-page` 的单人依次操作不纳入生产体验指标。
8. 明确退出后 2 秒内对其他玩家显示“AI 托管”；断线恢复期到期后 5 秒内完成控制权转换和本角色待填槽位调度。
9. AI 推演 3 秒内显示首段状态反馈，完整结算 P95 小于 30 秒。

### 2.6 回应并发规则

- 每个角色每阶段最多一个 `InteractionRequest` 进入强制回应槽。
- 多个请求同时命中同一角色时，按场景配置优先级合并为一个冲突事件；未入槽请求降级为普通压力或痕迹。
- 距离 `graceClosesAt` 不足 20 秒时，不再创建新的强制回应；转为下一阶段压力。
- MAIN 视为同时落子，不能按网络到达毫秒数判胜负。冲突优先级由角色权力、投入筹码、证据状态和阶段规则决定。
- 未回应时执行“保持现有持有/暂缓答复”，不得替玩家交出原件、公开秘密或改变阵营。

### 2.7 大厅 Ready / Start 权威状态

大厅不是本地按钮演示，而是同一房间的实时权威状态：

1. 三名真人都必须先领取一个不同的 `humanSelectable` 角色，自己的 `Ready` 才可点击；未选角色时 Ready disabled。
2. 每名玩家只拥有自己的 Ready。点击成功后服务端持久化，按钮立即显示已就绪并 disabled/灰化；重复点击幂等，不得替其他成员 Ready。P0 不提供误触式本地 toggle；若需要取消，必须使用单独、明确的 Unready 命令并让三页同步。
3. `Start Game` 只在房主页面出现；非房主页面既不显示可用按钮，也不能调用 Start API。房主按钮初始 disabled，只有三个真人均已选角、房主角色已锁定、三人 Ready 且 worldActor 未计入人数时才 enabled。
4. 任一 Ready/角色变化在 2 秒内同步到三页 roster 和房主 Start 状态。房主提前 Start 稳定返回 `ROOM_NOT_READY`，没有 Run 状态副作用。
5. 房主成功 Start 后，命令响应和 `ROOM_STARTED` 成员事件都返回权威 `{ roomId, runId, engineVersion, strategyVersion, status }`；三页只使用其中的 `runId=StoryRun.id`，在 3 秒内自动进入同一 `/game?runId=<runId>`，不得由前端猜测或拼装另一种 ID，也不要求另外两人刷新或点击“继续游戏”。当前实现可让 `roomId === runId`，但该等式必须由服务端合同保证。SSE 暂断时用成员状态补拉/受控轮询补偿，不能只有房主跳转。

## 3. 七阶段 × 三角色内容合同

先完成内容矩阵，再抽象通用引擎。每一格至少定义：私人简报、个人压力、三个主决策卡、即时回执、争夺对象、目标角色、可观察痕迹、可触发回应、下一阶段状态键。

| 阶段 | 共同争夺物 | 浙江总督 | 浙江巡抚 | 清流县令 | 必须形成的跨角色影响 |
|---|---|---|---|---|---|
| 1 改桑急令 | 执行边界、复核权 | 设复核程序 / 暂缓一县 / 支持强推 | 抢先催办 / 公开进度 / 压缩复核 | 留存底册 / 分批执行 / 请求保护 | 督抚的时限选择必须改变县令风险；县令证据必须反过来改变至少一方口径 |
| 2 县令密信 | 田契副本和保管权 | 私下接信 / 建双人核验 / 要求原件 | 追查泄密 / 收缴底稿 / 质疑密信 | 交副本 / 隐藏原件 / 交换保护 | 至少产生一次定向请求和一次真实回应 |
| 3 粮价失控 | 粮路、官仓、责任解释 | 调官仓 / 查商会 / 稳定公开口径 | 归责商会 / 召集米商 / 加速征收 | 公布粮田损失 / 组织民情 / 保护地方粮仓 | 一人的平粮或归责选择必须改变另外两人的资源或政治压力 |
| 4 暗账浮出 | 原件、副本、证人 | 封存证据 / 保护证人 / 控制接触 | 质疑完整性 / 抢原件 / 切割幕僚 | 交副本 / 转移原件 / 建证据目录 | 证据持有人由真实行动和账本决定；P3 保护请求必须触发 `R4:P1` 真实回应 |
| 5 相互弹劾 | 责任叙事、奏报先后 | 拆分责任 / 压下无证弹劾 / 公开复核 | 抢先弹劾 / 争夺政绩 / 反指拖延 | 反证越权 / 请求公开审计 / 保存来源 | P1 弹劾必须触发 `R5:P2` 真实辩驳；冲突叙事影响下阶段可用事实 |
| 6 京师回批 | 最终奏报、皇帝信任 | 汇总主奏 / 承担复核 / 保留地方弹性 | 密奏政绩 / 淡化暗账 / 要求强制结案 | 提交证据目录 / 附民情 / 请求保护来源 | 每份奏报必须引用并反驳至少一个其他可玩角色的前序选择 |
| 7 御前裁决 | 最终责任与个人命运 | 陈述稳局和责任 | 为执行路线辩护 | 为保民和证据链辩护 | 全局与三份个人结局必须引用前六轮真实事实和跨角色影响 |

通用内容/裁决合同是：每阶段至少两条不可伪造、且来自不同可玩角色 action 的 `originActionId → affectedRoleId` 影响边，`actorKind` 可为 HUMAN 或 AI_TAKEOVER。全真人成功路线另外要求这两个来源都是 HUMAN；接管路线则必须证明 Agent action 也能形成双向影响，不只是填 MAIN 计数。来源可以对目标玩家隐藏，但数据库中必须可追溯，不能为了“看起来像多人”生成没有 action 来源的文案。每阶段再单独配置江南商会的 `systemActionKey`、输入状态键、资产变更和可见压力，`SYSTEM_ACTION` 不计入这两条可玩角色影响边。

内容不能在实现阶段临时散落到 `app.js`、prompt 或数据库 seed。新增版本化真源 `packages/templates/config/sangtian/continuous-strategy-v1.1/`，至少包含 `manifest.json`、`stages.json`、`role-stage-content.json`、`system-actions.json`、`agent-policies.json` 和对应 JSON Schema。静态完整性门禁固定为：

```text
7 个 stage
21 个 role-stage 私人简报/压力配置
63 张角色专属 MAIN 卡（7×3×3）及 63 份确定性即时回执/效果定义
21 组可用 MANEUVER/目标/筹码策略（7×3；可以引用通用 maneuver 类型，但角色与阶段约束必须显式）
3 个固定强制 REACTION 场景：R2:P3、R4:P1、R5:P2
7 条确定性江南商会 system policy/systemActionKey
21 组 Role Agent 目标权重、风险偏好、资产优先级和每槽 fallback
7 份公共阶段结果规则、21 份个人阶段结果规则
1 份公共终局分类规则、3 份角色个人终局分类规则
```

所有 `actionKey/factKey/assetKey/targetRoleKey/nextStateKey/fallbackActionKey/systemActionKey` 必须跨文件可解析且唯一，规则效果必须能在不调用 LLM 时完整演算。AI 只在这些确定性结果之上做角色选择或叙事表达，不得补造缺失的内容键。内容 manifest 保存 `schemaVersion/contentVersion/文件 hash`；Run 在创建时把该 `contentVersion` 持久化为 `StoryRun.strategyVersion`。

`packages/templates/config/sangtian/strategy-registry.json` 是版本注册表，固定映射 `strategyVersion → manifestSha256` 并声明只影响新建 Run 的 `defaultStrategyVersion`。`sangtian_v1_1` 目录和 hash 发布后不可原地修改；启动/加载时实算 hash 不等于 registry 就 fail-fast 并记 `SOURCE_DRIFT`，绝不能继续给旧 Run 读变更后的字节。未来内容必须新增目录和新 strategyVersion，先以 migration 扩展数据库合法组合，再切 default 指针；旧 Run 永远按旧版本和旧 hash 加载。验收 manifest 同时保存 registry 与各策略 artifact hash。

## 4. 唯一正式页面与 UI 状态

### 4.1 唯一路由和文件边界

```text
唯一正式路由：/game?runId=<runId>
唯一页面骨架：apps/web/public/index.html
唯一渲染器：apps/web/public/app.js
唯一主样式：apps/web/public/main-game.css
启动适配：apps/web/public/game-bootstrap.js
多人客户端：apps/web/public/room-story-storage.js
```

`room-game.html/js/css` 标记为遗留删除项，不再作为开发目标。`RoomStoryStorage` 只负责鉴权请求、命令提交、事件订阅和投影缓存，不再拼造角色、资源、世界数值、头像、联系人或剧情。

路由合同必须同时覆盖本地开发服务器和生产构建产物，不能只在 `server.mjs` 中看起来正确：

```text
GET /game?runId=<runId>         → index.html，保留 query
GET /game/result?runId=<runId>  → platform.html 中的结果视图，保留 query
GET /room-game?<query>          → 30x /game?<query>，禁止 rewrite 到 room-game.html
```

`vercel.json`、本地 server、静态资源路径和 `pnpm build:vercel` 产物必须执行同一合同。生产产物 smoke test 必须证明 `/room-game` 的响应是重定向而非旧 HTML rewrite，`/game` 与 `/game/result` 深链刷新均为 2xx 且装载正式 bundle。

`game-bootstrap.js` 采用 fail-closed 分流：URL 存在 `runId` 时，必须完成房间投影鉴权后才能启动多人页面；`GET /rooms/:id/game` 的任何非 2xx 都进入明确的登录/无权限/房间不存在错误页，绝不能降级为单人数据。只有 URL 不含 `runId` 时才允许启动既有 SOLO 流程。

### 4.2 UI 真源

视觉回归继续使用：

| 状态 | 参考图 | SHA-256 |
|---|---|---|
| 角色私人开场 | `docs/UI/web/UI01_角色专属开场.png` | `fb3808b837230619465855c1e911ea120e2a0685fd7fd2fd36bfcaf9f02c834b` |
| 主决策 | `docs/UI/web/UI02_主线故事与决策.png` | `59b5259be53c4903a723701ca7eb03e26c3eb1a0e90d3189e7db834b05226bf7` |
| 收束/推演 | `docs/UI/web/UI03_AI正在推演.png` | `0085de9caee26e3ee2147609500f9a19967810a2ff04191efc1de1b508a6839d` |
| 个人结果 | `docs/UI/web/UI04_推演结果故事与变化.png` | `1f78ff24dc4b9ef83788f50de6e0a614c5af941d12c4f94edfe47f6b18bd5f2d` |
| 历史记录 | `docs/UI/web/UI05_局势记录展开.png` | `43b211565c73450f5d7db7c9c40d07ce9bfe1b7459e4f3de5d9c2fdfa8388258` |
| 定向事件 | `docs/UI/web/UI06_关键事件弹窗.png` | `a4564aea803a6ac32c2299b6487828919d7cd066d3b7af3ef7f65053d87611bc` |
| 回应 | `docs/UI/web/UI07_他人影响故事与回应.png` | `53041874200fba1f53f075edda570825308fb7014c193e24900fc81c42f35ca1` |
| 谋划 | `docs/UI/web/UI08_主动谋划.png` | `b92e4625da70e7ae64361ceedc9cde7129d28ac54a3e005af3f93002950b0b73` |

### 4.3 多人页面状态映射

| 服务端状态 | 页面表现 |
|---|---|
| `PREPARING` | 复用加载/开场骨架，不显示假数据 |
| `MAIN_OPEN` 且未提交 | UI01 私人简报 → UI02 角色专属行动卡 |
| `MAIN_OPEN` 且已提交 | 中央显示即时回执；右侧开启 UI08 谋划；顶部显示阶段时间，不显示谁没交；完成后可 DONE/离开本阶段 |
| `INTERACTION_GRACE` | 保持中央世界故事；右侧显示谋划、痕迹和待回应；UI06/07 处理定向事件 |
| `CLOSING/RESOLVING/PROJECTING` | UI03 推演状态；保留历史查看，不允许重复命令 |
| `RESOLVED` | UI04 个人结果、他人影响、公共变化；自动或明确进入下一阶段 |
| 第 7 阶段 MAIN 已齐 | 仍按普通阶段进入 MANEUVER 机会和可能的 REACTION；三条 MAIN 不能直接跳结果 |
| 第 7 阶段完成 | MAIN、MANEUVER、REACTION 均终态、结算与四份结果投影均发布后，三名玩家分别进入同一 `/game/result?runId=...`，公共结果一致、个人结局不同 |

页面必须同时表达“角色仍在行动”和“当前由谁控制”：

- 自己的身份卡显示 `你在操控 / 断线恢复期 / AI 托管中 / 接管待生效`，但不暴露心跳细节。
- 其他角色只显示“玩家操控”或“AI 代理”，不公开私密行动和断线时长。
- `完成并离开本阶段`只执行 `LEAVE_STAGE`；`退出本局并交给 AI`必须二次确认并明示不会停止故事。
- 返回玩家看到 AI 已完成的行动、时间线来源标签和准确接管点；不把已密封行动伪装成玩家本人决策。
- 若本局已由真人完成全部必需授权/共享世界解锁后三人全部交托，Rooms/继续游戏页显示“AI 正在代理此局”或“已推演至结局”；若尚未解锁，则显示“等待原玩家完成共享解锁”，不得伪装成仍在推演。任一原玩家都可回来完成解锁、继续接管或观看自己的角色结果。

明确禁止：

```text
大型“等待另外两名玩家”页面
把 X/3 提交人数作为主视觉
显示具体哪个玩家尚未提交
房主 Resolve/结算按钮
所有角色使用浙江总督头像、地点、资源或联系人
前端硬编码权威世界数值
```

## 5. 权威数据模型

以下为开发合同，字段名可在 migration 前微调，但能力和约束不得删除。

### 5.0 `StoryRun.engineVersion/strategyVersion` 是引擎与策略路由真源

不能用 `StoryRun.mode`、模板名、房间是否存在或当前环境变量倒推某个既有 Run 应走哪套引擎。现有创建路径可能把房间 Run 写成 `mode="room"`，它不等于连续权谋版本。`StoryRun` 必须持久化：

```prisma
engineVersion   String @default("legacy_v1")
strategyVersion String @default("legacy_v1")
// P0 合法组合：
// legacy_v1 / legacy_v1
// continuous_strategy_v1_1 / sangtian_v1_1
```

迁移时所有既有 Run（含仍在等待大厅的旧房）固定为 `engineVersion='legacy_v1', strategyVersion='legacy_v1'`。本项目的 `POST /api/v4/rooms` 会立即创建 `StoryRun`，因此版本必须在该创建事务中一次冻结：仅当 `MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED=true`、模板为《嘉靖财政危局》且房间规格为三个真人席位时，写 `engineVersion='continuous_strategy_v1_1'` 以及 registry 当前已注册的 default（本版为 `strategyVersion='sangtian_v1_1'`）；后者必须等于内容 manifest 的 `contentVersion` 且 hash 与 registry 一致。SOLO、新模板不自动继承。Start 只校验三名真人已加入/选角/Ready，并按已冻结版本原子创建 RoleControl、首窗和开场投影，绝不修改版本。Run 从创建成功起不得改版；即使等待大厅期间关闭 Feature Flag，该 Run 仍按持久化的 `engineVersion/strategyVersion` Start、恢复和完成。所有新表计数、回填、API 分流和验收 SQL 都以这两个字段为范围，禁止用当前环境变量、默认指针或全库总数证明本版本正确。

contract migration 必须在数据库增加合法组合 CHECK（当前仅允许 `legacy_v1/legacy_v1` 与 `continuous_strategy_v1_1/sangtian_v1_1`）并将两列收紧为 NOT NULL；新增引擎或策略版本必须通过新 migration 扩展 CHECK，不能只改应用枚举。任何直接 UPDATE 已存在 Run 版本的业务路径和管理接口均禁止。

### 5.1 `ActionWindow`

```prisma
model ActionWindow {
  id                 String   @id @default(cuid())
  runId              String
  nodeId             String   @unique
  status             String   @default("PREPARING")
  mainOpenedAt       DateTime?
  mainClosesAt       DateTime?
  graceOpenedAt      DateTime?
  graceMinClosesAt   DateTime?
  graceClosesAt      DateTime?
  aiQueueDrainedAt   DateTime?
  closingReason      String?
  resolutionTaskId   String?
  openingSnapshotVersion Int?
  projectionVersion Int      @default(0)
  version            Int      @default(1)
  resolvedAt         DateTime?
  configJson         Json
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@index([status, mainClosesAt])
  @@index([status, graceClosesAt])
  @@index([runId, status])
}
```

窗口可以先以 `PREPARING` 创建，所以开窗时间必须可空；内容就绪后一个事务原子地写入时间并转为 `MAIN_OPEN`。所有状态迁移使用 `id + version + status` 的 compare-and-swap。两个 scheduler 同时扫描同一窗口时，只允许一个进入 `CLOSING`。

`MAIN_OPEN` 事务同时为三个可玩角色写入不可变的开场投影：

```prisma
model ActionWindowOpeningProjection {
  id              String   @id @default(cuid())
  windowId        String
  roleId          String
  snapshotVersion Int
  projectionJson  Json     // 只含本角色开场可见事实/资产/行动卡
  contentHash     String
  createdAt       DateTime @default(now())

  @@unique([windowId, roleId])
  @@index([windowId, snapshotVersion])
}
```

同一窗口三行 `snapshotVersion` 必须与 `ActionWindow.openingSnapshotVersion` 相同，但私人 `projectionJson` 当然不同。未密封 MAIN 的真人页面和 Role Agent MAIN 都只读该开场投影；同轮先到的他人 MAIN/MANEUVER/痕迹/InteractionRequest 先缓存，直到本角色 MAIN 密封后才按 ACL 投递，避免真人或 AI 因网络顺序偷看同轮已交选择。

`closingReason` 只允许 `ALL_DONE`、`MAIN_TIMEOUT`、`GRACE_TIMEOUT` 或 `ADMIN_FORCE`；正常产品流程不得出现 `ADMIN_FORCE`。

### 5.2 `ActionWindowParticipant`

DONE 和每个真人的行动额度不存 JSON 大字段，以可并发、可约束的行数据持久化：

```prisma
model ActionWindowParticipant {
  id             String    @id @default(cuid())
  windowId       String
  roleId         String
  mainStatus     String    @default("PENDING") // PENDING | SUBMITTED | TIMED_OUT
  maneuverStatus String    @default("LOCKED")  // LOCKED | AVAILABLE | SUBMITTED | PASSED | EXPIRED
  reactionStatus String    @default("NOT_OPEN") // NOT_OPEN | PENDING | RESPONDED | FALLBACK | EXPIRED
  maneuverUsedAt DateTime?
  reactionUsedAt DateTime?
  doneAt         DateTime?
  version        Int       @default(1)

  @@unique([windowId, roleId])
  @@index([windowId, mainStatus, doneAt])
}
```

只为三个可玩角色创建 participant，与当前控制器是 HUMAN 还是 AI 无关；江南商会不创建 participant。MAIN 密封/超时后，该角色的 `maneuverStatus` 由 LOCKED 转 AVAILABLE；真人 DONE 或 Agent PASS 把 AVAILABLE 转 PASSED。DONE 只能在 MAIN 终态、MANEUVER 已 SUBMITTED/PASSED 且 REACTION 非 PENDING 时写入；若 HUMAN 直接 DONE，同一事务可将 AVAILABLE MANEUVER 转 PASSED，但遇到 PENDING REACTION 必须返回 `REACTION_REQUIRED`。定向请求将目标角色的 `reactionStatus` 从 NOT_OPEN 转 PENDING 并清空 `doneAt`，回应/fallback 后转 RESPONDED/FALLBACK。因此 Worker 重启后可仅根据持久状态重建未终态队列，不依赖内存标记。

进入 `CLOSING` 的事务必须同时：锁定窗口、把所有 `OPEN InteractionRequest` 转为 `EXPIRED`、写入默认结果、把非终态 maneuver/reaction 转为 EXPIRED/默认结果、封存 participant 额度。事务提交后到达的 REACTION 稳定返回 `WINDOW_CLOSED`，不得让窗口等待一个永不到来的回应。

### 5.3 `RoleControl` 与控制权日志

`StoryPlayer.status`、页面在线状态和 `StoryRole.isAiControlled` 不能同时作为控制权真源。新增每角色唯一的权威行：

```prisma
model RoleControl {
  id                   String   @id @default(cuid())
  runId                String
  roleId               String
  humanPlayerId        String?
  mode                 String   // HUMAN_ACTIVE | HUMAN_OFFLINE_GRACE | AI_ACTIVE | HUMAN_RECLAIM_PENDING | SYSTEM
  epoch                Int      @default(1)
  reason               String?  // EXPLICIT_EXIT | DISCONNECT_TIMEOUT | HUMAN_RECLAIM | SYSTEM
  lastHeartbeatAt      DateTime?
  offlineSince         DateTime?
  takeoverAt           DateTime?
  reclaimAfterWindowId String?
  stageLeaveWindowId   String?
  policyVersion        String?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@unique([runId, roleId])
  @@index([mode, lastHeartbeatAt])
}

model RoleControlTransition {
  id             String   @id @default(cuid())
  roleControlId  String
  fromMode       String
  toMode         String
  fromEpoch      Int
  toEpoch        Int
  reason         String
  initiatedByUserId String?
  effectiveWindowId String?
  effectiveSlot     String?
  idempotencyKey String   @unique
  createdAt      DateTime @default(now())
}
```

`epoch` 是控制器 fencing token，只在人类⇄AI 权威交接成功时递增：`HUMAN_ACTIVE/HUMAN_OFFLINE_GRACE → AI_ACTIVE` 的单事务接管，以及从 `AI_ACTIVE` reclaim CAS 成功进入 `HUMAN_ACTIVE/HUMAN_RECLAIM_PENDING` 时增加。R7 返回 `FINALIZING` 或已完成 Run 返回 `RUN_COMPLETED` 均不改变 mode/epoch、不写 transition。`HUMAN_ACTIVE ⇄ HUMAN_OFFLINE_GRACE` 只是 presence 变化，以及已完成 fencing 后的 `HUMAN_RECLAIM_PENDING → HUMAN_ACTIVE` 生效，都保留同一 epoch，避免短断线让正常页面无故失效。每次真实 mode 变化仍写 `RoleControlTransition`，因此 `fromEpoch/toEpoch` 允许相等。

真人命令、Role Agent 任务和 `PlayerAction` 都携带 `controlEpoch`；Worker 写入前再校验当前 epoch、window 和 slot，旧任务只能 no-op。AI 任务的唯一键为 `AI_TAKEOVER:<windowId>:<roleId>:<slot>:<epoch>`。权威交接 CAS 与 transition 必须在同一事务中；只有当前存在已开放未终态槽位时，该事务才必须同时写对应 outbox。无可执行槽位时 outbox=0，R1—R6 等下一窗口事件，R7 直接终局。

`StoryRole.isAiControlled` 在迁移后只能是兼容投影，禁止业务双写。`StoryPlayer`/原 user/角色历史关系一直保留，只有原玩家可请求 reclaim。

P0 不对全库旧 `StoryRole` 强制回填 `RoleControl`。`RoleControl` 只属于 `engineVersion=continuous_strategy_v1_1` 的 Run：Start 事务先 CAS 校验已经存在的 3 个 StoryRole，以及 1—3 个不同真人 StoryPlayer 均已认领不同可玩角色并 Ready，再与第一个窗口/三份 opening projection 原子创建恰好 3 个 RoleControl；它绝不重建 StoryRole。真人已认领角色为 `HUMAN_ACTIVE`，空缺角色原子 upsert 一个无 userId 的 AI StoryPlayer 并设为 `AI_ACTIVE/INITIAL_AI_AGENT`。江南商会只通过 `roleId=null, actorKind=SYSTEM` 的确定性 `SYSTEM_ACTION` 参与，不创建控制权。等待大厅和 legacy Run 继续走兼容读路径；显式《嘉靖财政危局》Solo 是同一连续引擎的“1 真人 + 2 AI”特例，其他 legacy Solo 不伪造 controller。任何全局断言都必须按持久 `engineVersion` 限定。

### 5.4 `PlayerAction`

保留现有 `userId`、`playerType`、`actionType` 等字段并增加；数据库中的真人身份真源仍是现有 `userId`，API/证据清单可把它映射为只读别名 `actorUserId`，不得新增第二个可写身份列：

```text
actionSlot       MAIN | MANEUVER | REACTION | SYSTEM_ACTION
actorKind        HUMAN | AI_TAKEOVER | SYSTEM | TIMEOUT_FALLBACK | LEGACY_AI
userId            真人行动记录现有 userId；AI/SYSTEM/TIMEOUT/LEGACY_AI 为 null
controlEpoch     写入时的控制权 epoch
policyVersion    AI 代管/系统行动的角色策略版本
provider         AI 代管 provider；真人/旧记录可空
modelName        AI 代管模型；fallback 记录 deterministic，真人/旧记录可空
actionKey        模板行动卡 key
idempotencyKey   客户端命令唯一键
requestHash      对 commandType + authenticatedUserId + roleId + canonical body 的 SHA-256
sourceInteractionRequestId  REACTION 的权威来源请求；不使用含义模糊的 sourceEventId
visibility       PUBLIC | OBSERVABLE | LIMITED | PRIVATE
targetRoleId
leverageKey
sealedAt
expiresAt
immediateJson    确定性执行回执
resolvedJson     结算结果
resolvedAt
```

`actorKind` 是新引擎身份真源；旧 `playerType` 只由它派生作兼容输出，禁止业务双写。`LEGACY_AI` 只用于无法可靠映射策略/模型的历史 AI 行动，新引擎绝不能产生该值。`sourceInteractionRequestId` 必须外键到 `InteractionRequest`，并保证一个请求最多关联一个 REACTION action。

MAIN 截止时的保守维持行为不是第二个逻辑槽：它以 `actionSlot=MAIN, actorKind=TIMEOUT_FALLBACK` 与真人/Agent MAIN 竞争同一唯一约束。截止时事务用 insert-on-conflict/CAS，若末秒 HUMAN/AI MAIN 已密封则 fallback 无副作用；若 fallback 先密封，随后 MAIN 稳定返回 `SLOT_SEALED`。

约束：

```text
@@unique([idempotencyKey])
@@unique([nodeId, roleId, actionSlot])
```

命中重复 `idempotencyKey` 时，服务端先比较认证用户、commandType、roleId、actionSlot 和 `requestHash`；完全一致才返回原结果，否则稳定返回 409 `IDEMPOTENCY_KEY_REUSED`。绝不能把另一用户或另一命令的历史响应返回给当前调用者。

P0 每个槽最多一条，不预先加入无实际用途的多次 `sequence`。若 P1 放开多次谋划，再通过 migration 扩展槽序号。

### 5.5 `InteractionRequest`

```text
id, runId, nodeId, sourceActionId
targetRoleId, eventType, priority
status = OPEN | RESPONDED | EXPIRED | DOWNGRADED
opensAt, expiresAt
defaultOutcomeJson
responseActionId
dedupeKey @unique
```

同一角色同一阶段最多一个 `OPEN` 强制回应。Supabase PostgreSQL migration 必须建立部分唯一索引 `UNIQUE(nodeId, targetRoleId) WHERE status = 'OPEN'`，不能只靠应用层先查后写。`PlayerAction.sourceInteractionRequestId` 指向该行且唯一；重复消费返回同一结果或稳定冲突。

### 5.6 权威资源与证据账本

新增最小 `RoleAsset` 与 `RoleAssetMutation`，不让 AI 直接决定筹码是否存在或是否已消耗：

```text
RoleAsset:
  runId, assetKey, kind, ownerRoleId, quantity, status, visibility, stateJson, version
  @@unique([runId, assetKey])

RoleAssetMutation:
  assetId, actionId, mutationType, delta, fromRoleId, toRoleId
  beforeJson, afterJson, idempotencyKey @unique
```

田契原件、田契副本、粮仓额度、密奏渠道和唯一筹码都由账本校验。Worker 重试不能重复扣除或转移。

### 5.7 事件、成员投递、投影和去重

- `StoryEvent` 增加每局单调的全局 `sequence`、`dedupeKey`、`audienceType`、`audienceRoleIdsJson`、`sourceActionId`；全局序号只用于审计和服务端生成投递，客户端不用它判断丢件。
- `StoryEventCursor(runId, nextSequence, version)` 是每局唯一的全局审计序号分配器；与事件写入同事务 CAS/原子递增，不允许 `MAX(sequence)+1`。
- `EventDelivery` 是真正的成员事件读模型：`eventId, roomId, userId, roleId, deliverySequence, payloadJson, deliveredAt`；对每个 `roomId + userId` 分配从 1 开始、无隐私过滤缺口的稠密 `deliverySequence`。
- `EventDeliveryCursor(roomId, userId, nextSequence, version)` 用唯一行 + 事务内原子递增为该成员分配序号；并发发布遇到唯一冲突时服务端重试，不用 `MAX()+1` 的无锁查询。
- 约束至少包含 `StoryEvent @@unique([runId, sequence])`、`StoryEvent @@unique([dedupeKey])`、`EventDelivery @@unique([roomId, userId, deliverySequence])` 和 `EventDelivery @@unique([eventId, userId])`。
- PRIVATE/LIMITED 事件可以让不同成员的全局 `StoryEvent.sequence` 出现合法跳号，但每名成员的 `deliverySequence` 必须连续。
- `NarrativeEntry` 和 `SceneSnapshot` 增加稳定 `dedupeKey` 或等价唯一投影键。
- `Notification` 只是用户可见读模型，不作为唯一权威事件源。
- `StoryTaskOutbox` 的唯一约束改为任务级去重键；一个节点未来可以拥有 `RESOLVE` 和 `PROJECT_REPAIR` 等不同任务，但同一种任务只能一条。

### 5.8 Role Agent、Outbox 与结算 checkpoint 的精确合同

以下字段、状态和唯一键是 P0 migration/API/E2E 的共同合同；实现可补充 Prisma relation 字段，但不得把其中任何一项退化为进程内对象或无约束 JSON。

```prisma
model RoleAgentPolicy {
  id                String   @id @default(cuid())
  runId             String
  roleId            String
  policyVersion     String
  promptVersion     String
  provider          String
  modelName         String
  goalsJson         Json
  riskProfileJson   Json
  assetPriorityJson Json
  actionWeightsJson Json
  fallbackBySlotJson Json
  status            String   @default("ACTIVE") // ACTIVE | SUPERSEDED
  createdAt         DateTime @default(now())
  supersededAt      DateTime?

  @@unique([runId, roleId, policyVersion])
  @@index([runId, roleId, status])
}

model RoleAgentProjection {
  id                     String   @id @default(cuid())
  runId                  String
  windowId               String
  roleId                 String
  actionSlot             String   // MAIN | MANEUVER | REACTION
  controlEpoch           Int
  policyVersion          String
  openingSnapshotVersion Int
  projectionJson         Json
  contentHash            String
  createdAt              DateTime @default(now())

  @@unique([windowId, roleId, actionSlot, controlEpoch])
  @@index([runId, roleId, createdAt])
}

model RoleAgentDecision {
  id                     String   @id @default(cuid())
  runId                  String
  windowId               String
  roleId                 String
  actionSlot             String
  controlEpoch           Int
  policyVersion          String
  openingSnapshotVersion Int
  taskDedupeKey          String   @unique
  projectionId           String
  status                 String   @default("PENDING")
  // PENDING | SEALED_ACT | SEALED_FALLBACK | PASS | STALE | NO_OP | FAILED
  visibleFactIdsJson     Json
  chosenActionKey        String?
  targetRoleId           String?
  leverageKey            String?
  shortRationale         String?
  provider               String?
  modelName              String?
  providerAttempts       Int      @default(0)
  providerResponseHash   String?
  guardDecisionJson      Json?
  playerActionId         String?  @unique
  lastError              String?
  startedAt              DateTime?
  completedAt            DateTime?
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  @@unique([windowId, roleId, actionSlot, controlEpoch])
  @@index([runId, roleId, createdAt])
}
```

`RoleAgentPolicy` 只为三个可玩角色创建；江南商会使用模板内确定性 System Policy，不调用 LLM。`RoleAgentProjection.projectionJson` 只能由 `PerspectiveProjectorService` 从已授权事实生成，不包含其他角色原始 action、全局 prompt、provider thread 或隐藏思维链。`RoleAgentDecision` 只保存结构化选择、短理由、输入事实 ID 和 response hash；原始 provider 响应/推理不落库。`FAILED` 不是“队列已清空”的终态：必须继续 Outbox 重试或写成 `SEALED_FALLBACK/PASS/STALE/NO_OP`；若仍 FAILED，窗口不得自动收束且验收失败。

现有 `StoryTaskOutbox` 改为下列任务级合同，不能继续以 `nodeId` 唯一：

```prisma
model StoryTaskOutbox {
  id           String   @id @default(cuid())
  dedupeKey    String   @unique
  runId        String
  nodeId       String
  windowId     String?
  roleId       String?
  actionSlot   String?
  controlEpoch Int?
  taskType     String   // RESOLVE_WINDOW | PROJECT_REPAIR | ROLE_AGENT_DECISION
  status       String   @default("PENDING") // PENDING | RUNNING | RETRY | COMPLETED | FAILED
  outcome      String?  // SEALED_ACT | SEALED_FALLBACK | PASS | STALE | NO_OP | RESOLVED | REPAIRED
  inputRefId   String?
  checkpointKey String?
  attempt      Int      @default(0)
  maxAttempts  Int
  nextRetryAt  DateTime @default(now())
  leaseOwner   String?
  leaseVersion Int      @default(0)
  leaseExpiresAt DateTime?
  startedAt    DateTime?
  completedAt  DateTime?
  resultJson   Json?
  lastError    String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([status, nextRetryAt])
  @@index([runId, taskType, status])
  @@index([leaseOwner, leaseExpiresAt])
}
```

`dedupeKey` 格式固定为：旧结算 `RESOLVE_LEGACY:<nodeId>`；新结算 `RESOLVE:<windowId>`；投影修复 `PROJECT_REPAIR:<windowId>:<checkpointKey>`；接管决策 `AI_TAKEOVER:<windowId>:<roleId>:<actionSlot>:<controlEpoch>`。领取/续租/完成都比较 `id + leaseVersion + leaseOwner`；租约失效的 Worker 不能落结果。

结算恢复使用显式 workflow/checkpoint，而不是拿“已有 `DirectorResolution`”代表完成：

```prisma
model ResolutionWorkflow {
  id              String   @id @default(cuid())
  runId           String
  windowId        String   @unique
  nodeId          String   @unique
  resolutionId    String?  @unique
  status          String   @default("RUNNING") // RUNNING | COMPLETED | FAILED
  rulesInputHash  String
  rulesOutputJson Json?
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  completedAt     DateTime?
}

model ResolutionCheckpoint {
  id            String   @id @default(cuid())
  workflowId    String
  checkpointKey String
  contentHash   String
  outputRefType String?
  outputRefId   String?
  completedAt   DateTime @default(now())

  @@unique([workflowId, checkpointKey])
}
```

`checkpointKey` 只允许 `RULES_APPLIED`、`PUBLIC_PROJECTED`、`ROLE_PROJECTED:<roleId>`（恰三项）、`PUBLISHED`，以及二选一的终端推进键：第 1—6 阶段为 `NEXT_WINDOW_OPENED`，第 7 阶段为 `RUN_COMPLETED`。每个 workflow 始终恰有七项，不允许第 7 阶段为了满足 checkpoint 创建第 8 个 ActionWindow。每个输出还必须有自身稳定 dedupe key。Worker 每次从缺失的最早 checkpoint 恢复；发现 `resolutionId` 已存在也不能提前 return。`COMPLETED` 只在本阶段应有的七项全部存在且哈希/引用可读回时写入。

## 6. 后端职责与 AI 边界

### 6.1 服务拆分

| 服务 | 权威职责 | 禁止职责 |
|---|---|---|
| `ActionWindowService` | 开窗、阶段转换、DONE、超时、CAS 关闭 | 不写剧情 |
| `ActionCommandService` | MAIN/MANEUVER/REACTION 鉴权、幂等、额度、资产校验 | 不直接宣布最终成功 |
| `ImmediateFeedbackService` | 按行动卡生成 2 秒内确定性回执和可见痕迹候选 | 不调用大模型决定最终结果 |
| `InteractionRequestService` | 定向请求、优先级、回应、过期默认结果 | 不允许来源角色替目标角色决定 |
| `PresenceService` | 心跳、离线恢复期和在线读模型 | 不直接写行动或把单次断线当作退出 |
| `RoleControlService` | HANDOFF/RECLAIM、epoch fencing、transition 与 AI outbox | 不读其他角色私密、不覆盖已密封 action |
| `RoleAgentService` | 基于单角色投影规划并选择结构化 MAIN/MANEUVER/REACTION | 不访问全量世界状态、不结算成败、不扣费 |
| `WorldBoundaryGuardService` | 时代、角色能力、知识、资源、控制他人、宣布结果检查 | 不做道德化拒绝 |
| `CausalArbiterService` | 根据行动卡、资产、事实和冲突规则产生权威 state patch | AI 文案不能覆盖规则结果 |
| `PerspectiveProjectorService` | 先按 ACL 生成 PUBLIC/OBSERVABLE/LIMITED/PRIVATE 结构化投影 | 不把可见性决定交给 Writer |
| `NarrativeWriterService` | 只把单一已经过滤的投影写成角色视角故事 | 不接收该角色无权知道的完整私密行动 |
| `ActionWindowScheduler` | 扫描到期窗口并幂等 enqueue | 不依赖任何浏览器或房主在线 |
| `StoryTaskOutboxService` | 租约、心跳、重试、恢复 | 不把“已有 Resolution”误判为全部后续投影已完成 |

### 6.2 持久角色 Agent 架构

可以使用 Agent，且应该以角色 Agent 作为以后的扩展真源，但必须保持“角色做决策”和“世界做裁决”的边界：

```text
浙江总督 Role Agent ─┐
浙江巡抚 Role Agent ─┼─→ 结构化角色行动 ─→ Guard/资产账本 ─→ CausalArbiter
清流县令 Role Agent ─┘                                      ↓
江南商会 System Policy ────→ 确定性 SYSTEM_ACTION(roleId=null) 公共事实 + 分角色投影
```

三个可玩 Role Agent 拥有持久 `roleKey`、角色设定、长期目标、风险偏好、关系立场、资产优先级、已知事实 ID 和 `policyVersion`。P0 在真人 `HUMAN_ACTIVE` 时使 Role Agent 休眠，不偷偷替玩家选择；只有 `AI_ACTIVE` 时才执行以下循环：

P0 的“本角色历史”严格限定为 `(runId, roleId)`：不复用另一 room/run 的 provider conversation/thread/cache，不把同一 `roleKey` 在其他局得到的秘密带入当前局。P0 模型调用使用无状态请求，所有可重建记忆来自本局权威投影；任何缓存键至少包含 `runId/roleId/policyVersion/openingSnapshotVersion`。跨局学习只属于表中 P2，不得提前混入接管首版。

```text
OBSERVE  只读 RoleAgentProjection 和本角色历史
→ PLAN   生成结构化目标/风险/所需资产，不保存隐藏思维链
→ ACT    从当前可用卡选择 actionKey/目标/筹码/简短理由
→ GUARD  走与真人相同的 ActionCommandService
→ SEAL   写入 actorKind=AI_TAKEOVER + controlEpoch
→ REVIEW 只在结果发布后吸收该角色允许知道的新事实
```

每个行动卡内部增加 `aiIntentTags`、`aiRiskWeight`、`aiFallbackActionKey` 和可选 `aiManeuverPolicy`。只保存可审计的 `visibleFactIds/chosenActionKey/shortRationale`，不保存或展示模型隐藏思维链。

Provider 合同必须在 `packages/shared/src/continuous-strategy/role-agent.schemas.ts` 定义并生成 JSON Schema，输入政策与输出决策分别固定为 `role_agent_policy_v1`、`role_agent_decision_v1`；两者均 `additionalProperties=false`。最小形状如下，枚举值必须来自该 Run 冻结的内容 manifest，不能让模型临时发明 key：

```json
{
  "schemaVersion": "role_agent_policy_v1",
  "roleKey": "<content roleKey>",
  "policyVersion": "<frozen>",
  "promptVersion": "<frozen>",
  "goals": [{ "goalKey": "<content key>", "weight": 0 }],
  "riskTolerance": 0,
  "assetPriorities": [{ "assetKey": "<content key>", "weight": 0 }],
  "actionTagWeights": [{ "tag": "<content tag>", "weight": 0 }],
  "fallbackBySlot": {
    "MAIN": "<actionKey>",
    "MANEUVER": "PASS|<actionKey>",
    "REACTION": "<actionKey>"
  }
}
```

```json
{
  "schemaVersion": "role_agent_decision_v1",
  "taskDedupeKey": "AI_TAKEOVER:<windowId>:<roleId>:<slot>:<epoch>",
  "decisionKind": "ACT|PASS",
  "chosenActionKey": "<available actionKey or null>",
  "targetRoleId": "<authorized target or null>",
  "leverageKey": "<owned leverage or null>",
  "visibleFactIds": ["<projection fact id>"],
  "shortRationale": "<1..160 chars, no hidden reasoning>"
}
```

服务端验证 `taskDedupeKey` 与当前任务相同、所有 key/target/fact 都属于本次 `RoleAgentProjection`。`ACT` 必须有合法 actionKey；`PASS` 只允许 MANEUVER 且 action/target/leverage 必须为 null；MAIN/REACTION 的 PASS 一律拒绝。第一次 schema/Guard 失败只允许一次带错误码的结构化 repair；再次失败不再询问模型，由服务端从 `fallbackBySlot` 生成 `SEALED_FALLBACK`。Provider 原始文本在计算脱敏 hash 后立即丢弃，不写 DB、日志或证据包。

Role Agent 对每个当前可用槽位必须产生 `ACT | PASS | FALLBACK` 中的一个结构化终态。MAIN 不允许 PASS；只有可选 MANEUVER 允许 PASS；强制 REACTION 在无模型结果时使用“保持现状” fallback。这些终态与 participant 状态一起用于判定 AI 队列真正清空。

一个窗口中多个 Role Agent 的 MAIN 必须基于同一 `openingSnapshotVersion` 并行规划，不得让后生成的 Agent 看到先生成者的密封选择。Agent 之间不直接共享 prompt/记忆，只通过权威事件、可见痕迹和 `InteractionRequest` 交互。

Director/Narrative Writer 不是角色控制器；`CausalArbiter` 和资产账本继续是确定性权威服务，不改造成可自由决定结果的 Agent。P1 可把休眠的 Role Agent 扩展为玩家主动点击的“角色顾问”，但不进入本次自动行动 P0。

建议的 Agent 演进路线是：

| 阶段 | Role Agent 职责 | 产品门禁 |
|---|---|---|
| P0（本方案） | 1—3 真人开局，空缺角色初始由 Agent 补位；玩家交托/长断线后接管同一角色；本局已由真人取得所需 entitlement/共享解锁后可全员托管到结局，未解锁时可恢复地暂停 | 角色投影隔离、epoch fencing、Guard/Arbiter、无支付工具、初始补位合同、TAKE-001—013 |
| P1 | 允许开局时用 Agent 填补未被真人领取的可玩角色；或作为不自动落子的角色顾问 | 大厅清楚显示人/AI 名额，开局授权和计费语义单独评审，不默认混入 P0 |
| P2 | 持久长期性格、关系和跨局策略评估，用多种政策回放做剧情平衡 | 记忆来源/保留期/删除机制、策略版本可回放、不将某位玩家的私密个性迁移给他人 |

这样 Agent 已经是首版的开局补位与中途接管引擎；P0 必须证明“补位/接管不卡局、不越权、不抢操作权”。玩家主动顾问、跨局学习和通用承诺规划仍留在后续版本。

#### 6.2.1 Role Agent 任务触发合同

Agent 任务不由页面在线事件临时拼凑，而是由以下权威领域事件与状态同事务产生 Outbox：

| 触发点 | 对 `AI_ACTIVE` 角色的动作 | 幂等/边界 |
|---|---|---|
| `ActionWindow → MAIN_OPEN` | 冻结三份 opening projection，为 MAIN 未终态的 AI 角色 enqueue MAIN task | 唯一键含 window/role/MAIN/epoch；全部 MAIN 只读同一 opening snapshot |
| HUMAN → AI 权威交接 | 在同一事务中检查当前窗口，只 enqueue 已开放且未终态的 MAIN、MANEUVER 或 REACTION | 若为 CLOSING/RESOLVING/PROJECTING/RESOLVED，不补写本窗口；R1—R6 由下一窗口开放事件触发，R7 不再产生 Agent task |
| 某角色 MAIN 进入 SUBMITTED/TIMED_OUT | 将本角色 MANEUVER 从 LOCKED 转 AVAILABLE，释放先前缓存的授权痕迹/请求；若当前为 AI，立即 enqueue MANEUVER 和已 PENDING 的 REACTION，不等其他 MAIN | 每角色 MANEUVER ACT 或 PASS；不因任务完成先后提前收束 |
| `MAIN_OPEN → INTERACTION_GRACE` | 做一次漏任务修复，为仍处 AVAILABLE 且当前为 AI 的 MANEUVER 补幂等 Outbox | 不重复任务；不重置已 SUBMITTED/PASSED/EXPIRED 槽位 |
| `InteractionRequest → OPEN` | 将目标 `reactionStatus=PENDING` 并清空 `doneAt`。只有目标 MAIN 已终态时，AI 才 enqueue REACTION、HUMAN 才收到可操作 UI；若 MAIN 未密封则缓存到该 MAIN 终态事件 | 每角色每窗口最多一个强制 REACTION；新请求可重置 AI-only 静默期，但不能泄露给未交 MAIN 的角色 |
| Agent 槽位进入 ACT/PASS/FALLBACK | 原子更新 participant 槽位终态；当前已开放槽位全部终态且无 OPEN 请求时写 `doneAt` | 之后出现合法强制 REACTION 会清空 `doneAt`，回应终态后再写回 |
| `NEXT_WINDOW_OPENED`（仅 R1—R6） | 在开窗事务中先将本角色 `HUMAN_RECLAIM_PENDING → HUMAN_ACTIVE`，再冻结 snapshot；只对仍为 AI_ACTIVE 的角色 enqueue MAIN | “生效 reclaim”与“判断是否 enqueue Agent”同事务；绝不修改上窗口已密封行动 |
| `RUN_COMPLETED`（仅 R7） | 不再开窗；原子冻结公共结局、三份个人结局、完成时间和最终投影引用 | 不创建 Window 8；重试只读回同一终局引用 |

Scheduler 可做漏任务修复扫描，但只能依照同一唯一键补 Outbox，不能绕过事件合同直接写 action。每次 `doneAt` 自动写入/清空都要有领域事件，以便恢复和时间线解释。

### 6.3 P0 AI 调用合同

每阶段：

```text
确定性规则：校验、资产、证据、冲突、状态补丁
→ 1 个公共叙事任务
→ 3 个隔离角色叙事任务，每个只接收该角色允许知道的投影
→ Validator 扫描事实、角色知识和内部键泄漏
→ 不合格则 repair；再次失败使用确定性 fallback
```

七阶段三真人成功路线的叙事逻辑任务固定为：公共叙事 7 个、隔离角色叙事 21 个。AI 托管路线另外增加每个实际 AI 槽位一个 `ROLE_AGENT_DECISION` logical task；provider 重试可以增加调用次数，但不能增加密封 action 或 published 结果数。最终报告必须同时列出 logical task、provider call、repair、fallback 和 duplicate 数。

AI 失败不得卡住窗口。AI 只能解释权威结果，不能创造未发生的资源转移、真人影响或私密事实。

### 6.4 端到端可恢复结算

当前 `resolveNode()` 可能在创建 `DirectorResolution` 后、写完投影前崩溃。v1.1 必须把结算拆成可恢复 checkpoint：

```text
RULES_APPLIED
PUBLIC_PROJECTED
ROLE_PROJECTED:<roleId> × 3
PUBLISHED
NEXT_WINDOW_OPENED（R1—R6） | RUN_COMPLETED（R7）
```

状态和唯一键以 5.8 的 `ResolutionWorkflow/ResolutionCheckpoint` 为准。每个输出有确定性 `dedupeKey`。Worker 重启后从缺失 checkpoint 继续，不能因为 `DirectorResolution` 已存在就整体返回；只有公共投影、三个角色投影、发布，以及本阶段应有的“下一窗口”或“Run 完成”终端推进均可读回，workflow 才能 COMPLETED。

### 6.5 Worker 拓扑、环境变量与故障开关

对外只保留一个是否让 API 进程消费任务的变量：

```text
STORY_WORKER_EMBEDDED=true|false
```

- API 进程只在 `STORY_WORKER_EMBEDDED=true` 时启动内嵌消费者；默认值必须在配置 schema 中显式声明并由启动日志打印，不能继续让 `STORY_WORKER_ENABLED` 和 `STORY_WORKER_EMBEDDED` 各自控制一半逻辑。
- 独立 `apps/api worker` 命令始终启动专用消费者，不读取 `STORY_WORKER_EMBEDDED` 来关闭自己。旧 `STORY_WORKER_ENABLED` 仅允许一个版本的兼容映射并打印 deprecation，D05 后代码、compose、测试和文档统一改用新变量。
- 正式验收固定以 `STORY_WORKER_EMBEDDED=false` 启动 API，再启动一个独立 Worker PID。这样故障注入时 API 不会偷领本应由崩溃 Worker 持有的任务。生产可采用同一拓扑；若选择 embedded，则报告必须明确说明。
- readiness/受保护的 worker health 必须返回 `topology, workerId, pid, lastHeartbeatAt, activeLeaseCount, oldestRunnableTaskAgeMs`。验收保存 API PID、Worker PID、Outbox `leaseOwner/leaseVersion` 读回，证明实际由独立进程完成。
- `FAIL_AFTER_CHECKPOINT`、provider 强制失败、固定租约/时间压缩等故障变量只在 `NODE_ENV=test` 或显式 `ALLOW_FAULT_INJECTION=true` 的非生产进程可用。生产发现任一故障变量时必须启动失败，不能静默忽略或意外启用。

## 7. API 与同步合同

### 7.1 私有游戏投影

```http
GET /api/v4/rooms/:roomId/game
```

返回当前用户可见的完整正式页面投影：

```text
schemaVersion = continuous_game_projection_v1
projectionRevision       当前成员单调递增的投影修订号
appliedThroughDeliverySequence  该投影已包含的成员投递序号
generatedAt
roomSummary
run                     至少含 runId/engineVersion/strategyVersion/status/stageIndex
currentNode
actionWindow
serverNow
player
myControl              mode/presence/epoch/reclaimPolicy/effectiveFromSlot
roleControllerStates   公开的在线/暂离/AI托管标记，不包含心跳细节和私密原因
privateBrief
availableMainActions
myActions
availableManeuvers
pendingReaction
observableTraces
observablePlayerStates
latestPersonalResult
latestPublicResult
access                  state/requiredCredits/canCurrentUserUnlock/payerUserId?/unlockEndpoint
resultReady
resultUrl
```

不得返回其他玩家的完整 `method`、`intent`、`objective`、fallback、筹码、隐藏事实或未授权结果。

`GameProjectionV1`、各命令 response envelope、`EventDeliveryPageV1` 和 `ResultProjectionV1` 必须在 `packages/shared/src/continuous-strategy/` 定义唯一 TypeScript schema，并生成可校验的 JSON Schema；API、Worker、`RoomStoryStorage`、`app.js` 和测试全部 import/验证同一版本，禁止各自复制接口。除 heartbeat 和 Credits 解锁外，游戏写命令成功响应统一为 `{ accepted, guardDecision?, immediateFeedback?, gameProjection }`；heartbeat 固定返回 `{ accepted, serverNow, nextHeartbeatAt, rolePresence }`，解锁使用下文独立 envelope。`RoomStoryStorage` 不再把旧 room model 拼成 FormalView。

同一 membership 的投影必须满足：`projectionRevision` 严格增长时，`appliedThroughDeliverySequence` 单调不降；同 revision 只能返回相同 payload/hash。客户端丢弃低 revision；若收到更高 revision 但其 appliedThrough 小于本地 `lastAppliedDeliverySequence`，也必须拒绝应用并先补拉/重取覆盖该序号的投影，不能回退 UI 后仍保留较大 cursor。合法投影应用后才将本地 cursor 更新为 `max(local, appliedThroughDeliverySequence)`；单个事件也只有在成功应用，或已被合法更高投影覆盖后，才能推进 cursor。

`access.state` 只允许 `FREE | REQUIRES_UNLOCK | UNLOCKED`。需要真人授权时，`StoryRun.status=WAITING_FOR_HUMAN_UNLOCK`，投影中的当前/下一窗口保持 `PREPARING`，`mainOpenedAt/mainClosesAt/grace*` 全部为 null，且不得 enqueue Role Agent/结算任务。`canCurrentUserUnlock` 由成员资格、余额和正式 Credits 规则计算；`payerUserId` 只在已解锁且对当前成员可披露时出现。

唯一正式解锁命令复用既有入口：

```http
POST /api/v4/story-runs/:runId/unlock
```

请求必须带 `idempotencyKey`；只有真人已认证成员可以调用，Role Agent/Worker 没有该工具。响应固定包含 `unlocked, alreadyUnlocked, creditsCharged, payerUserId, access, gameProjection`。并发/重试只能生成一笔 `WORLD_UNLOCK` 账本记录、扣一次余额，并在同一 RunId 上原子恢复 PREPARING/开窗；余额不足稳定返回业务错误且不产生部分状态。

最终结果只从成员投影读取：

```http
GET /api/v4/rooms/:roomId/result
```

```text
schemaVersion = continuous_result_projection_v1
roomSummary
run                     runId/engineVersion/strategyVersion/completedAt
publicEnding            endingKey/title/body/factIds
personalEnding          roleId/title/body/goalOutcomes/knownFactIds
myKeyDecisions          stageIndex/slot/title/actorKind；title 为玩家可读文本，不返回 actionKey
authorizedCrossImpacts
myControlTimeline
creditsSummary          仅本次解锁/本用户相关摘要，不含他人余额
```

只有 Run 已完成，且 `PUBLISHED` 后同一公共结局和三份个人结局都可读回时，`resultReady=true` 与 `resultUrl` 才出现。三个成员看到同一 `publicEnding`、各自不同的 `personalEnding`；接口不得返回原始共享 `Chapter` 全文、其他角色 private facts/actions 或他人余额。`/game/result` 只消费该投影，非 2xx/未就绪显示明确状态，禁止硬编码结局或回退单人结果。

`endingKey/factIds/knownFactIds` 是供合同校验与审计使用的机器字段，正式渲染器不得把它们直接插入标题、正文、行动历史或“为什么会得到这个结局”。`publicEnding.body` 与 `personalEnding.body` 必须由本 Run 已密封的真实行动生成：至少引用 1—3 个玩家可读的行动标题，并说明这些选择造成的资源、证据或跨角色影响如何累计形成结局。正文与 DOM 必须通过内部键泄漏扫描，禁止出现 `global_`、`personal_`、`state_`、`asset_`、`main_`、`maneuver_`、`reaction_`、`system_`、`internal_` 前缀；审计字段仍留在成员授权的 JSON 属性中，不能靠删除审计链来“修复”页面。

进入 `resultReady=true` 后，正式页面必须切换为终局语义：不得继续显示“等待主决策”“谋划中枢”“完成本阶段”或“退出本局并交给 AI”等进行中控件。终局因果区至少列出 2 条 `第 X 轮 + title + 本人/AI` 的 `myKeyDecisions`，计数只能作为补充，不能代替可追溯选择；顶栏世界/地点名称必须完整可读且不得残留截断分隔符。

### 7.2 写命令

```http
POST /api/v4/rooms/:roomId/game/actions/main
POST /api/v4/rooms/:roomId/game/actions/maneuver
POST /api/v4/rooms/:roomId/game/events/:eventId/reaction
POST /api/v4/rooms/:roomId/game/layout/done
POST /api/v4/rooms/:roomId/game/layout/leave-stage
POST /api/v4/rooms/:roomId/presence/heartbeat
POST /api/v4/rooms/:roomId/game/control/handoff-to-ai
POST /api/v4/rooms/:roomId/game/control/reclaim
```

不同命令使用不同信封，不强行让心跳携带业务窗口：

| 命令 | 必填字段 | 语义 |
|---|---|---|
| MAIN/MANEUVER/REACTION | `idempotencyKey, windowId, controlEpoch, actionKey` + 目标/筹码 | 写当前角色槽位，严格受窗口、epoch 和槽位 fencing |
| DONE/LEAVE_STAGE | `idempotencyKey, windowId, controlEpoch` | 只更新当前 participant/本窗口离开豁免，不写 action |
| heartbeat | `sessionInstanceId, heartbeatSequence, lastAppliedDeliverySequence` | 只更新认证成员的 presence；客户端时间不作权威，不要求 windowId/controlEpoch |
| HANDOFF_TO_AI | `idempotencyKey, expectedControlEpoch` | 服务端读取当前窗口和未终态槽位；不依赖客户端传入的旧 windowId |
| RECLAIM | `idempotencyKey, expectedControlEpoch` | 服务端返回实际立即/延后生效的 windowId/slot/newControlEpoch |

心跳不得与普通写接口共用“按 IP 120 次/分钟”的总桶，否则三个同 NAT、每秒一次的真实浏览器会稳定触发 429。`presence/heartbeat` 从通用写桶排除，改用认证后的专用双层限流：`userId + sessionInstanceId` 至少 90 次/分钟、`userId` 至少 240 次/分钟，并保留合理 IP 防滥用上限；`heartbeatSequence` 必须单调递增，乱序只幂等忽略。D05/D10 必须让三页连续心跳超过 60 秒并证明 heartbeat 429=0、三角色未误离线；其他业务写接口仍受通用限流保护。

玩家槽位写入只校验成员身份、角色归属、`windowId/nodeId`、窗口状态/截止时间、自己的 participant 和自己的槽位；不因另两名玩家提交而失效。玩家 action 不递增 `ActionWindow.version`，只有状态迁移递增它；`StoryRun.version` 不作为三个平级 MAIN 的互斥锁。

同一 `idempotencyKey` 返回原结果；当前用户不持有该角色时返回 403 `ROLE_FORBIDDEN`，窗口已迁移、本人槽位已封存或控制 epoch 已变更时返回稳定 409 `WINDOW_MOVED/SLOT_SEALED/ROLE_CONTROL_CHANGED`；不能因“别人刚提交了”返回版本冲突。服务端返回 `accepted/guardDecision/immediateFeedback/gameProjection`。

`handoff-to-ai` 只允许当前角色的原 StoryPlayer 调用，重试返回同一 transition；`reclaim` 携带 `expectedControlEpoch`，已密封槽位不回滚，返回实际生效槽/窗口。Role Agent 使用内部命令总线，不暴露可从浏览器伪造 `actorKind=AI_TAKEOVER` 的公开 API。

现有 room leave 命令必须按房间生命周期分流：开局前按大厅规则离开并释放角色；开局后不能删除成员/角色，只能在明确确认后执行与 `handoff-to-ai` 同一事务语义。这一入口同样纳入 idempotency、epoch 和 endpoint deny-matrix。

正常玩家不再拥有 Resolve API。管理员强制收束接口必须单独鉴权、默认关闭并写审计日志。Role Agent 没有 Credits/支付/同意条款工具，不得以托管名义花费玩家余额；“全员 AI 完成到结局”的 P0 验收必须在房间已经通过真人 UI 获得共享世界权限后开始。

### 7.3 事件同步

保留当前真实路径：

```http
GET /api/v4/rooms/:roomId/events?afterDeliverySequence=<n>
GET /api/v4/rooms/:roomId/events/stream?afterDeliverySequence=<n>
```

认证真源是现有 HttpOnly session cookie，不是 localStorage Token。正式 Web 客户端对同源 API/SSE 使用 `credentials: 'include'`；P0 继续使用 credentialed fetch-stream 以统一处理状态码、补拉和 abort，不读取 HttpOnly cookie、不在 URL/query/localStorage 复制 token、也不拼 Authorization Header。可选 Bearer 只服务 CLI/受控 API 测试，不能成为浏览器主路径。SSE/补拉返回 401/403 时必须停止流、清除本地多人投影并进入重新登录/无权限状态，禁止降级 SOLO。

增量补拉响应固定为 `{ deliveries, nextAfterDeliverySequence, hasMore }`。客户端从本地 `lastAppliedDeliverySequence` 循环补到 `hasMore=false` 后再打开 stream；stream 断开重复相同步骤。所有页面状态都持续订阅，不能只在“自己已经提交”后刷新。

断线重连要求：

```text
服务端为当前成员投递的 deliverySequence 从 1 稠密递增
客户端持久记录 lastAppliedDeliverySequence
重连先补 GET afterDeliverySequence，再恢复 stream
重复 deliverySequence 幂等忽略
只对当前成员的 deliverySequence 缺口补拉；全局 StoryEvent.sequence 因隐私过滤跳号是合法的
```

控制权事件也走同一投递链：`ROLE_PRESENCE_CHANGED` 是 OBSERVABLE，`ROLE_CONTROL_CHANGED` 发布不含私密原因的 PUBLIC 摘要，`ROLE_RECLAIM_SCHEDULED` 向原玩家发 PRIVATE 详情并可向房间发公开简版。其他玩家只看到“在线/暂离/AI 托管”，不看 lastHeartbeatAt、断线原因或原用户私密数据。

### 7.4 关闭旧泄漏通道

审计 `apps/api/src/story.controller.ts:69-315` 的全部敏感入口。涉及多人房间的接口必须转为内部接口、增加房间成员投影鉴权，或在正式环境移除。仅保护 RoomsController 不足以满足隐私验收。

必须维护 endpoint deny-matrix，至少覆盖：

| 入口类别 | 必须覆盖的路由 | 多人房期望 |
|---|---|---|
| 明确公开 | `/`、`health/live/ready`、`auth/wechat-login`、`world-templates[/templateId]` | 仅返回非私密能力；不接受 room/run/node 对象 ID 去读敏感数据 |
| 身份/用户私有 | `user/me`、`user/agree-policy`、`my/story-runs`、`notifications`、`feedback/report` | 必须 AuthGuard，只读/写当前用户；不得使用 `openid()` 的默认 mock 身份降级 |
| 直接创建 | `POST v4/story-runs`、`POST story-runs` | 仅可创建鉴权用户的 SOLO run；不能创建/绑定房间 run 或绕过 Rooms 大厅合同 |
| 旧加入/选角 | `POST story-runs/:runId/join`、`roles/:roleId/claim` | 对房间 run 关闭或路由到同一 Rooms 成员/选角规则；必须拒绝以江南商会 actorKey/伪造 roleId 发起的 claim |
| run/state/role | `story-runs/:runId`、`state`、`roles`、`my-role`、`current-node`、`nodes` | 匿名/非成员不可读；成员只读自己投影 |
| node/action | `nodes/:nodeId`、`GET/POST actions` | 不可读他人 method/intent，不可绕过新槽位命令 |
| 推进/结算 | `ai-fill-missing-actions`、`resolve`、`resolution`、`start`、`pause` | 普通玩家不可调用管理推进；结果只按成员投影返回 |
| 叙事/洞察 | `narrative-segments`、`generate-chapter`、`chapters/:chapterId`、`share`、`insights` | 成员身份、房间归属和投影 ACL 全部生效 |
| v4 旧单人读写 | `GET v4/story-runs/:runId`、`messages`、`dashboard`、`POST decisions/respond/defer/maneuvers/advance-day/finalize` | 不能接受房间 runId 绕过 Rooms 边界 |
| admin | `admin/dashboard`、`admin/story-runs[/runId]`、`admin/roles`、`admin/actions`、`admin/resolutions`、`admin/ai-tasks`、`admin/audit-logs`、`admin/event-logs`、`admin/action-guard` | 必须 AdminGuard + 审计；匿名、普通成员、非成员全部拒绝 |

每一行都用四种主体验证：匿名、非成员、当前成员、房间中的另一成员；admin 行再增加一名合法管理员作为第五种主体。对象存在性也不得通过错误差异泄漏。

## 8. 开发阶段

### D00：冻结真源和冲突裁决

1. 按 0.1 在 `attemptId` 开始时动态保存 branch/HEAD/commit time、`git status --porcelain=v1 -uall`、dirty digest、两份方案 hash、schema/migrations/API/Web 输入 hash 和现有服务状态；不使用本文编制时 SHA，不覆盖用户修改。
2. 把本 v1.1 标记为连续权谋 P0 的新执行基线；旧 v1.0 保留为设计来源，不再直接拆任务。
3. 锁定唯一正式 `/game` 路由和 UI01—UI08 hash。
4. 建立 requirement → content key → API → DB → UI state → test ID → evidence 跟踪矩阵，并创建 0.2 指定的唯一 `acceptance-manifest.json`；每个 Dxx 只更新同一 Goal 的 checkpoint。
5. 将 `room-game.*` 和旧房主结算测试标为遗留迁移项。
6. 预检三个可独立访问的邮箱、正式邮件 provider 或非生产 file-sink、Codex 内置 Browser 的三个可见标签页和三个获准 origin、声明且命中 allowlist 的非生产 Supabase 验收项目与隔离 schema、DeepSeek、Worker 和构建环境。验收数据库只允许 Supabase；禁止启动或连接本地 PostgreSQL 16、Docker PostgreSQL 或其他替代库。manifest 必须固定 Supabase project/host/database/schema 的脱敏 fingerprint，且不得连接生产项目或生产 schema。file-sink 只可替代投递通道，仍须由每个对应 origin 的页面打开自己的真实验证链接；不允许先造登录态。

退出条件：所有 P0 要求都有稳定 ID、责任文件、测试 ID 和证据目录；manifest 记录动态源码/数据库/外部依赖基线。当前无法控制的正式邮件、已声明 Supabase 验收项目/连接、DeepSeek 或桌面内置 Browser 缺失按 0.2 记录 `EXTERNAL_BLOCKED:<provider>`，但不得把 checkpoint 或最终 Goal 标 PASS。

### D01：先完成“改桑急令”内容纵切

涉及：

```text
packages/templates/src/index.ts
packages/templates/config/sangtian/
新增连续权谋配置 schema 与 lint
```

1. 完成第 1 阶段 × 三真人角色的私人简报和专属行动卡。
2. 定义一个共同争夺物、至少两条不同可玩角色的影响边、一条可观察痕迹和一条定向请求。
3. 为每张行动卡定义内部 objective/visibility/risk/fallback/asset mutations。
4. 静态 lint 检查 actionKey、角色、目标、资产和下一状态键引用。

退出条件：不调用 AI 也能用 fixture 完整演算第 1 阶段的三方冲突。

### D02：数据库与共享合同

涉及：

```text
prisma/schema.prisma
prisma/migrations/<timestamp>_foundation_current_schema/
prisma/migrations/<timestamp>_continuous_strategy_p0_expand/
prisma/migrations/<timestamp>_continuous_strategy_p0_contract/
packages/shared/src/
apps/api DTO/types
```

先处理当前 schema/migration/数据库三方漂移，再开发 P0。已知源码 schema 声明 `CanonFact`、`CharacterMind`、`StoryThread`、`SceneSnapshot`、`NarrativeEntry`、`StoryTaskOutbox`，但现有 `prisma/migrations/**/migration.sql` 中没有对应 `CREATE TABLE`；在空库和目标数据库实查未闭环前，这六项一律标为 drift，不能假定“Prisma generate 通过”等于可部署。

漂移门禁固定保存到 manifest：`prisma/schema.prisma` hash、migration 目录 hash、`prisma migrate status`、目标库 `_prisma_migrations` 列表、上述表/列/索引/FK 的 `information_schema` fingerprint，以及 `prisma migrate diff --from-migrations ... --to-schema-datamodel ...` 结果。禁止以 `prisma db push` 修生产/验收库，也禁止编辑已应用 migration。先写 `foundation_current_schema`：在全新 Supabase 隔离 schema 上执行 `prisma migrate deploy` 即可得到开发前 schema；Windows 沙箱若阻止 Prisma schema-engine，可由受控 SQL 客户端向同一 Supabase schema 逐 migration 部署并独立读回，仍不得启用本地 PostgreSQL 16；若目标库已手工存在同名对象，必须生成逐对象比对与受控 baseline/resolve 记录，不能重复创建或伪造 applied 状态。foundation 在空库、现有开发库和生产等价快照均通过后，才开始 P0 expand。

随后实现 `StoryRun.engineVersion/strategyVersion`、`ActionWindow`、`ActionWindowOpeningProjection`、带显式 main/maneuver/reaction 终态的 `ActionWindowParticipant`、`RoleControl/RoleControlTransition`、`InteractionRequest`、`RoleAgentPolicy/Projection/Decision`、`ResolutionWorkflow/Checkpoint`、行动槽、幂等键、`StoryEventCursor`、`EventDelivery/EventDeliveryCursor`、资产账本、投影去重键和新版 Outbox。migration 必须保留旧单人数据和旧多人历史记录，采用 expand → backfill/readback → contract，不允许一步直接将新字段设为非空。

在 D02 创建任何新房间 Run 之前，同时实现 `MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED` 的配置 schema、默认关闭、非法值 fail-fast 和启动日志；`POST /api/v4/rooms` 的创建事务只能在 flag=true、模板为《嘉靖财政危局》且 `maxPlayers` 位于模板声明的 1—3 人范围时原子写入 `engineVersion='continuous_strategy_v1_1', strategyVersion='sangtian_v1_1'`，否则写入 legacy 组合。Start 只读取并校验该组合，不得重算或改写。显式《嘉靖财政危局》Solo 由专用入口强制选择同一连续版本，其他 Solo 保持 legacy。该门控属于 D02 的写入前置条件，不得推迟到 D11。

`PlayerAction` 的可执行迁移顺序固定为：

1. expand migration 先增加可空 `actionSlot/actorKind/controlEpoch/policyVersion/provider/modelName/actionKey/idempotencyKey/requestHash/sourceInteractionRequestId/sealedAt` 等字段，不改旧唯一约束；同时增加可空 `StoryRun.engineVersion/strategyVersion`。
2. 旧 Run 全部回填 `engineVersion='legacy_v1', strategyVersion='legacy_v1'`。旧 action 回填 `actionSlot='MAIN'`、`controlEpoch=0`、`sealedAt=createdAt`、`actionKey='legacy:' + actionType`、`idempotencyKey='legacy:' + id` 和基于稳定旧字段的 `requestHash`。
3. `userId IS NOT NULL` 的旧 action 为 `HUMAN`；只有满足已书面冻结的模板/角色/actionType 谓词且读回无歧义的商会记录可为 `SYSTEM`；其他无真人身份的旧 AI/系统不明记录统一为 `LEGACY_AI`。旧记录的 policy/provider/model/sourceInteractionRequestId 保持 null，不能虚构模型版本或回应来源。
4. 逐类保存回填前后计数、null 数、重复键、抽样 ID 和 predicate SQL；新引擎写路径开始双读兼容但只写新真源，旧 writer 尚未下线前不执行 contract。
5. 建立 `@@unique([idempotencyKey])`、`@@unique([nodeId, roleId, actionSlot])`、InteractionRequest 部分唯一索引及所有 FK；全部成功后才在独立 contract migration 删除旧 `@@unique([nodeId, roleId])`、收紧 P0 必填列，并停止 `playerType/isAiControlled` 业务双写。
6. 对一个旧 SOLO、一个旧多人历史房和一个新连续权谋房分别读回；重复 idempotencyKey 还要验证同主体同请求返回原结果、换用户/命令/body 返回 `IDEMPOTENCY_KEY_REUSED`。

`RoleControl` 不做全库回填。只对 `engineVersion=continuous_strategy_v1_1` 的 Run 在成功 Start 事务中为三个可玩 `StoryRole` 写三行，验收等式为“每个该版本已 Start Run 恰三行”；系统行动者没有控制权行，legacy/SOLO/等待房为 0 合法。原 `StoryPlayer/user/role` 历史关系必须不变，`isAiControlled` 只在新引擎兼容投影中派生。

`ActionWindowOpeningProjection` 只对 Feature Flag 下的新连续权谋窗口强制：新窗口从 PREPARING 转 MAIN_OPEN 前必须恰有三行且同一 snapshotVersion。旧已结束/旧模式窗口不伪造开场投影回填，由兼容读路径处理；不允许为了满足非空约束用当前世界状态倒推历史私密数据。

所有新表必须定义正式 Prisma relation 和删除策略：窗口/成员投递随所属测试房清理可 `Cascade`；`RoleAssetMutation` 对 action/asset 使用 `Restrict` 保留账本完整性；角色所有者的删除策略必须保留历史归属，不得留下孤儿记录。

退出条件：全新空库 `migrate deploy`、现有库 dry run、schema↔migration diff=0、目标 DB fingerprint、`pnpm db:generate`、schema 合同测试、三类旧/新数据读回和 expand/contract rollback 说明全部通过；任何 foundation drift 或 `db push` 遗留均阻止 PASS。

### D02A：在产生私密内容前关闭 ACL 绕过

该 checkpoint 必须先于 D03 的私人简报、Agent 投影、事件投递和 Writer 调用完成：

1. 按 7.4 deny-matrix 审计并保护旧 `StoryController` 全部 run/state/role/node/action/resolution/chapter/insight 入口；正式环境删除默认 mock openid/匿名身份降级。成员路由用 `AuthGuard + room membership/role ownership`，管理路由用 `AdminGuard + audit`。
2. 建立唯一 `MemberProjectionService`/`PerspectiveProjectorService` 边界。`GET game/events/result`、Writer 输入和 Role Agent 输入都只接受该边界输出，controller 不得直接序列化 `StoryService` 的 raw nodeActions/resolution/Chapter。
3. 发布顺序固定为“先按 ACL 过滤结构化 payload，再持久化 `EventDelivery`/调用 Writer”；不得先广播/生成全量正文后在前端隐藏。
4. 对 deny-matrix 每条路由用匿名、非成员、当前成员、房内另一成员测试；对象存在与否使用一致错误，不泄漏 ID。再做字段级 canary，证明 P1 私密 key/正文在 P2/P3 的 API、SSE、DOM、日志和 Writer/Agent 输入中均不存在。

退出条件：旧入口越权数、raw service 直出数、mock 身份降级数和 canary 泄漏数全部为 0；否则禁止进入 D03。

### D03：单轮后端纵向切片

1. 实现 `ActionWindowService` 和第 1 阶段开窗。
2. 实现 MAIN、MANEUVER、REACTION、DONE 四类命令。
3. 接入现有 ActionGuard，并增加模板 actionKey、角色能力、资产和知识边界校验。
4. 实现确定性即时回执。
5. 实现自动 CLOSING 和 Outbox enqueue，取消房主依赖。
6. 复用并校验 POST /rooms 已创建的 3 个可玩 `StoryRole` 和 join/claim 已绑定的 3 个 `StoryPlayer`；Start 后只为三个可玩角色创建 participant。江南商会不可 claim、不创建 `StoryRole/StoryPlayer/participant`，并在本阶段生成一条 `roleId=null` 的确定性 `SYSTEM_ACTION`。
7. 仅对持久化 `engineVersion=continuous_strategy_v1_1` 的已 Start Run 初始化 3 个唯一 `RoleControl`，三个可玩角色均为 `HUMAN_ACTIVE`；worldActor、legacy/等待房不补行，也不用 `StoryPlayer` 在线状态替代角色控制权。
8. 先用确定性叙事 fixture 生成三份个人结果和一份公共结果。

退出条件：三个不同账号可通过 API 完成第 1 阶段，房主不调用 Resolve，DB 只有一个结算。

### D04：正式 `/game` 单轮纵向切片

涉及：

```text
apps/web/public/app.js
apps/web/public/main-game.css
apps/web/public/game-bootstrap.js
apps/web/public/room-story-storage.js
apps/web/public/platform.js
apps/web/public/role-select.js
apps/web/tests/room-main-game.test.mjs
```

1. 大厅角色投影显式返回 `humanSelectable`；`platform.js:340` 和选角页只让总督/巡抚/县令可点击，江南商会 worldActor 不生成角色卡（若另有说明卡则必须 disabled），不计 Players/Ready。
2. 删除 `RoomStoryStorage` 中所有权威硬编码，直接消费服务端 `GameProjection`。
3. 清理 `apps/web/public/app.js:594`、`610-615`、`619-625`、`653-675` 的多人硬编码：总督府/内厅、总督头像、世界数值、联系人、调查项、筹码和推进项在多人模式全部来自 `GameProjection`；单人模式可保留既有默认值。
4. 使角色头像、地点、资源、筹码、联系人和世界状态按当前角色投影显示。
5. MAIN 提交后中央区显示即时回执，谋划中枢保持可用。
6. UI06/07 复用为定向请求和回应。
7. 删除等待主视觉、提交人数主视觉和房主 Resolve。
8. 三个浏览器全部进入 `/game?runId=...`，且看到不同角色内容。
9. 增加当前控制器标签、明确分开的 `LEAVE_STAGE`/`HANDOFF_TO_AI` 控件、二次确认、返回后的接管提示和 HUMAN/AI 时间线来源。
10. 同时修改/验证本地 server 与 `vercel.json`：`/room-game` 保 query 重定向到 `/game`，`/game` 与 `/game/result` 深链在 `pnpm build:vercel` 产物中可刷新；禁止生产 rewrite 回旧 `room-game.html`。
11. `runId` 存在时故意注入 401/403/404/500，页面必须 fail closed 到明确错误，不加载 SOLO；无 `runId` 才能启动 SOLO。
12. 实现 `continuous_game_projection_v1` 的 `access/resultReady/resultUrl` 与 `continuous_result_projection_v1`，`/game/result` 不读取 raw Chapter 或硬编码结果。

退出条件：大厅只有三个真人角色可选且 worldActor claim 被 API 拒绝；第 1 阶段由三个隔离浏览器纯 UI 完成，第一名提交后能继续谋划，自动进入结果；本地与 production-build 路由、投影 schema 和 fail-closed 用例全部通过。

### D05：事件流、倒计时和恢复

1. 保留全局 StoryEvent 序号用于审计，为每名成员生成隐私过滤后的稠密 `EventDelivery.deliverySequence`。
2. 基于 HttpOnly cookie 实现 `credentials:'include'` 的 fetch-stream SSE、`afterDeliverySequence` 分页补拉、重连和成员投递序号缺口修复；浏览器不读 token、不拼 Authorization，401/403 fail closed。
3. 所有页面状态持续订阅，不依赖手动刷新。
4. 刷新后恢复窗口、剩余行动、待回应和角色私有投影。
5. 测试模式支持人工 `1200/900`、自动成功路线 `60/30` 和自动超时路线 `15/8`，生产默认 `180/45`；投影带 `serverNow`。人工模式只用于三页逐屏验收，不得改写生产实时房时序。
6. 将 `ROLE_PRESENCE_CHANGED`/`ROLE_CONTROL_CHANGED`/`ROLE_RECLAIM_SCHEDULED` 通过同一成员投递链推送；心跳只更新存在性，不能直接写行动或触发结算。
7. 将 heartbeat 从按 IP 的通用写限流拆出，按 7.2 建立认证 user/session 专用桶；三个同 NAT 页面以 1 秒频率连续运行至少 70 秒，保存请求计数、429=0、presence 未误切换的证据。
8. 统一 `STORY_WORKER_EMBEDDED`，实现独立 Worker 命令与 worker health/readiness；验收拓扑固定 API embedded=false + 独立 PID，并保存真实 leaseOwner/leaseVersion。

退出条件：断线期间的 PRIVATE/LIMITED/PUBLIC/OBSERVABLE 事件和角色控制变更重连后不丢、不重、不乱序；cookie SSE 无 token 泄漏，70 秒心跳 429=0，独立 Worker health 与租约读回一致。

### D06：持久角色 Agent 与 AI 接管

1. 实现 `PresenceService`、`RoleControlService` 和生产/测试心跳阈值；短断线只进恢复期，明确交托可立即接管。
2. 实现控制 `epoch` fencing、`RoleControlTransition`、事务内 Outbox 和每槽位唯一 Agent task；人与 AI 竞争只允许一方密封。
3. 按 5.8 精确实现三个可玩角色的 `RoleAgentPolicy/RoleAgentProjection/RoleAgentDecision`、新版 `StoryTaskOutbox` 及所有 FK/唯一键；江南商会继续使用独立、确定性的 worldActor System Policy。
4. Agent 仅生成结构化 action，经同一 Guard、资产账本和 Arbiter 密封；不赋予世界观察全知、结算、Credits、支付或代替其他角色的工具。
5. Role Agent 默认使用低延迟 `deepseek-chat`，把 4500ms 作为同一决策全部 provider 尝试共享的总预算，而不是每次重试都重新计时；快速非法 JSON/guard reject 在剩余预算允许时 repair 一次，预算不足或仍失败立即使用角色确定性 fallback。任务重试不重复写槽位或扣资产，高质量长叙事模型不得阻塞实时接管。
6. Worker 对非 Agent/结算任务保持单任务顺序；同批 `ROLE_AGENT_DECISION` 最多并行三个 provider 等待，使三个可玩角色各自都能满足“槽位开放后 5 秒内含 fallback”的 SLA。领取仍逐条 CAS，执行并发不得改变 opening snapshot、epoch fencing 或最终裁决顺序。
7. 实现返回接管：AI 未密封时可立即 CAS 取回，已密封时从下一安全槽位生效；旧 epoch 任务必须 no-op。
8. 用已完成的第 1 阶段验证一人交托、房主交托、三人全交托、人/AI 竞争、返回接管和无浏览器/SSE 的自动收束；三人全交托 fixture 必须显式标记“无需解锁”或预置已由真人完成的非生产 entitlement，不能给 Agent 支付工具。再用不含正式剧情的合成多窗口 fixture 验证跨窗口任务触发/恢复。不在 D08 内容完成前要求真实第 7 阶段结局。
9. 分别读回 ACT、MANEUVER PASS、REACTION fallback、stale epoch 和租约重领；`FAILED` task 不得计入 queue drained，provider 原始响应/隐藏思维链不得落库或进入日志。

退出条件：第 1 阶段与合成多窗口 fixture 中，角色不因玩家退出消失；人/AI 同槽位双写、越权知识、重复 Agent task 和托管后卡局全部为 0。

### D07：权威因果与私人投影

1. 将现有 `resolveNode()` 拆为 5.8 定义的 `ResolutionWorkflow/ResolutionCheckpoint`；每步用稳定 dedupe key，已有 `DirectorResolution` 不得提前 return。
2. 资产、证据、角色权力和共同争夺物由规则先结算。
3. `PerspectiveProjector` 先过滤，再把单一角色投影交给 Writer。
4. 公共叙事不得收到不必要的私密正文。
5. `notifyOtherPlayers()` 不再广播其他玩家完整 method/intent。
6. 增加 prompt 注入与秘密泄露 Validator。
7. 对 `RoleAgentProjection`、Writer 投影和玩家 `GameProjection` 做三向字段/文本交叉审计；多个 AI 角色必须使用同一 `openingSnapshotVersion`，不得按任务完成顺序偷看同轮已密封决策。
8. `PUBLISHED` 前同时生成 `continuous_game_projection_v1` 的阶段结果；第 7 阶段还须生成一份公共、三份个人 `continuous_result_projection_v1`，全部引用可审计 fact/action ID。

退出条件：三份个人结果不同但事实相容；未经授权的私密正文不出现在其他角色的 API、事件或 DOM。

### D08：扩展到七阶段

1. 完成第 2—7 阶段 × 三角色内容矩阵。
2. 每阶段至少一个共同争夺物和两条真实跨玩家影响边。
3. 第 4、5、6、7 阶段分别回收前序证据、粮价、责任和奏报事实。
4. 第 7 阶段生成一个公共结局和三个个人结局。
5. 江南商会始终作为不可 claim 的 `worldActor` 参与世界规则，不创建玩家角色、不占真人完成计数，每阶段恰好一条 `roleId=null` 的 `SYSTEM_ACTION`。
6. 为三个 Role Agent 完成第 2—7 阶段的目标权重、风险偏好、资产优先级和 fallback actionKey，使其选择连续而不是随机填表。
7. 第 7 阶段与前六阶段使用完全相同的槽位状态机：三条 MAIN 之后必须分别给三名控制器 MANEUVER 机会，处理合法 REACTION，再进入 CLOSING。三个 MAIN 到齐时 `resultReady` 必须仍为 false。
8. 成功路线固定让三个角色七轮都提交真实 MANEUVER，因而总数为 21；PASS/EXPIRED 只用于专项/托管边界测试，不得拿 participant 终态冒充成功路线行动计数。第 7 轮必须读回三条 `actionSlot=MANEUVER`。

退出条件：确定性脚本和 API E2E 分别以全 HUMAN、单 Agent 接管和“模板无需解锁或已由真人解锁”的全 Agent 托管完成 7 窗口、21 MAIN、成功路线 21 MANEUVER、7 `SYSTEM_ACTION`、7 唯一结算和 21 阶段个人结果；第 7 轮三条 MANEUVER 均早于 `PUBLISHED/resultReady`。全 Agent fixture 无浏览器/SSE 仍到第 7 阶段结局；另有未解锁 fixture 稳定进入 `WAITING_FOR_HUMAN_UNLOCK`，真人在同一 Run 解锁后恢复。正式三浏览器证据留到 D10。

### D09：安全、幂等和故障恢复

1. 关闭旧 StoryController 绕过路径。
2. 并发密封、重复 idempotencyKey、已迁移 windowId、已封存槽位、末秒回应、双 scheduler 全部测试。
3. 增加仅非生产可用的 `FAIL_AFTER_CHECKPOINT=RULES_APPLIED|PUBLIC_PROJECTED|ROLE_PROJECTED:<roleId>|PUBLISHED|NEXT_WINDOW_OPENED|RUN_COMPLETED` ，并通过 `FAIL_AFTER_CHECKPOINT_RUN_ID/STAGE/WINDOW_ID` 明确绑定目标 RunId/stage/window；API 以 `STORY_WORKER_EMBEDDED=false`、Worker 作为独立 PID 启动，在指定 checkpoint 确定性退出，等待租约过期后用同一 RunId 重启，验证从缺失 checkpoint 续跑且不重复扣资产。故障矩阵固定覆盖 R3 的七项（含三个不同 roleId、PUBLISHED、NEXT_WINDOW_OPENED）以及 R7 的 `PUBLISHED/RUN_COMPLETED` 两项，共 9 个独立 RunId；`PUBLISHED@R7` 必须恢复为 `RUN_COMPLETED`，两个终端 checkpoint 重入均保持 Window 8 为 0。生产携带故障变量必须 fail-fast。
4. AI timeout、非法 JSON、知识越界和公共叙事泄密触发 repair/fallback。
5. 房主浏览器关闭后服务端继续自动推进。
6. 注入人类提交与自动接管、返回接管与 Agent 提交、两个接管 scheduler 的并发竞争，epoch/slot 只允许一个胜者。
7. 注入 Role Agent provider 失败、Worker 在 Agent task 领取后崩溃和旧标签页提交，验证 fallback、租约恢复和 stale epoch 拒绝。
8. 注入相同/不同用户、commandType 和 canonical body 复用同一个 idempotencyKey，只有完全相同请求可重放；其余必须 `IDEMPOTENCY_KEY_REUSED` 且不泄露原响应。
9. 故障报告必须包含 API/Worker PID、topology、worker heartbeat、Outbox leaseOwner/leaseVersion、checkpoint 前后表计数；不能用同进程快速重试替代租约恢复。

退出条件：隐私泄漏、重复 action、重复 resolution、重复资产扣除和半完成窗口全部为 0。

### D10：三个真实隔离玩家七轮

按配套测试文档执行：

```text
Codex 内置 Browser 的三个可见标签页
三个获准 origin，分别保持独立 Cookie session
三个独立注册并完成邮箱验证的真实账号
三个不同角色
只依据各自 DOM/截图作决策
全程 UI 点击和输入
七轮 MAIN/MANEUVER/REACTION
第 7 轮三名玩家均完成 MANEUVER 后才出现结果
第 4 轮通过正式 UI 完成一次共享世界解锁
无房主 Resolve
三个不同个人结局
```

账号前置本身属于正式 UI 验收：三个浏览器分别用唯一邮箱注册，各自打开邮件中的真实验证链接，再登录并访问大厅。非生产可使用 file-sink 捕获邮件，但每条链接仍只能由对应浏览器可见地打开；禁止直接改数据库 verified 字段、注入 cookie/token、调用页面内 fetch 或使用 `x-mock-openid`。若要求正式 provider 而邮件投递不可用，manifest 记录 `EXTERNAL_BLOCKED:EMAIL_DELIVERY` 及脱敏证据，D10/最终 verdict 不得 PASS。

开始七轮前先对 `pnpm build:vercel` 产物执行生产路由 smoke：三页从 `/room-game?runId=...` 均被重定向并最终停留 `/game?runId=...`，第 7 轮进入 `/game/result?runId=...`；保留状态码、Location、最终 URL 和 bundle hash。最终证据不得只来自本地 `server.mjs`。

在创建房间/RunId 之前，可通过既有受保护测试命令，给三个 `@example.test` 账号增加幂等、可审计的 BONUS 点数；该 fixture 与玩家浏览器流分离并单独留证，局中不得直接改 DB/API，不得伪造 PURCHASED 余额或发起真实付款。全真人成功路线与全员托管路线的第 4 轮固定由 P1（房主）在正式 UI 点击共享世界解锁，另外两页通过事件同步继续同一房间；事后读回必须只有一笔 `WORLD_UNLOCK`，且 payerUserId、roomId/runId 与本次证据完全一致。

最终 MP/SP 必须使用 Codex 内置 Browser 的三个可见标签页、三个独立 origin 和三个独立盲决策上下文。Browser 控制只能通过可见 locator/坐标、真实键盘输入完成玩家操作，并采集截图、控制台和网络元数据；禁止 `HTMLElement.click()`、Runtime.evaluate 事件注入、页面内 fetch，也不得读取其他玩家私密响应替当前玩家决策。Headless 只能作为低层回归，不能生成最终 MP/SP PASS。

除全真人成功路线外，必须用独立 RunId 执行接管路线：P3 在第 3 轮明确交托后由 Agent 完成第 3—7 轮；P1 在第 2 轮交托后，第 4 轮由仍在线的 P2 以正式 UI 解锁，证明房主不再是授权/结算单点；三人在第 4 轮由 P1 通过真人 UI 完成共享世界解锁后全部交托，关闭三个浏览器与 SSE，服务端仍必须进入第 7 轮结局。三条路线都要保留 control transition、Agent 输入摘要、action actorKind、fallback 和最终 DB 读回。

退出条件：配套测试的邮箱验证、production-build 路由、UI、隐私、计时、R7 MANEUVER、结果投影、恢复、DB 读回和玩家理解门槛全部纯 PASS；每条路线只使用自身 RunId 并挂入同一 acceptance manifest。

### D11：回归、Feature Flag 和最终收口

1. 复核 D02 已实现的 `MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED`、默认关闭和创建房间时的版本冻结：只对新建《嘉靖财政危局》1—3 人实时房启用，并持久化 `StoryRun.engineVersion=continuous_strategy_v1_1, strategyVersion=sangtian_v1_1`；显式《嘉靖财政危局》Solo 也冻结为该连续版本，其他/既有 Run 为 `legacy_v1/legacy_v1`。Start 不改版本，D11 不再首次增加该能力。
2. 旧历史房间继续按旧模式只读/兼容，不能被新 migration 破坏。
3. 重跑单人 7 天/12 决策、Credits、认证、房间、凯撒和现有 `pnpm test:acceptance`。
4. 重跑 UI01—UI08 视觉/交互回归。
5. 聚合全真人成功 RunId 和各接管 RunId 的功能、浏览器、API、DB、Worker、Role Agent、隐私和体验报告，禁止混用计数。
6. 先在 flag=true 时创建一个仍在等待大厅的连续权谋 Run，再关闭 flag 并重启 API/Worker；该等待房 Start 后以及另一个已开始 Run 都必须继续按各自持久 `engineVersion/strategyVersion` 到结局。随后新建房间必须回到 legacy，证明 flag 只影响创建瞬间、不改写 waiting 或 started Run。另用 loader/构建 fixture 证明修改已注册 `sangtian_v1_1` 任一字节会因 registry hash 不符 fail-fast；不得在真实验收运行中原地替换版本包。
7. 对 manifest 中 source/database hashes 做结束时再采样；任何变化标 `SOURCE_DRIFT` 并新开 `attemptId`。逐项确认 `D00、D01、D02、D02A、D03—D11`、全部 gate、externalBlockers、limitation 与 RunId 集合，禁止把 D02A 或任何其他未跑项写成 pass/skipped。

退出条件：manifest 中 P0 未覆盖数、失败数、`EXTERNAL_BLOCKED` 数、`SOURCE_DRIFT` 数、`NEEDS_USER_COORDINATION` 数、limitation 数均为 0，源码/数据库指纹未漂移且所有必需 RunId 独立，才允许唯一 Goal 为纯 `PASS`。

## 9. 建议新增测试命令

以下脚本在开发阶段创建，不能在尚未实现时宣称已经存在：

```json
{
  "test:continuous-mp:migration": "foundation、空库 migrate deploy、schema/migration/DB 指纹和旧数据读回",
  "test:continuous-mp:unit": "ActionWindow/Guard/Arbiter/Projection 单元测试",
  "test:continuous-mp:api": "成员权限、命令、事件、并发和 DB 集成测试",
  "test:continuous-mp:browser": "邮箱验证 + production 路由 + 内置 Browser 三 origin/三可见标签页的七轮真实 UI 测试",
  "test:continuous-mp:takeover": "明确交托、断线自动接管、人类返回、已解锁全员 AI 到结局及未解锁暂停恢复",
  "test:continuous-mp:worker": "embedded=false 独立 Worker、租约、checkpoint 与 health 证据",
  "test:continuous-mp:fault": "窗口、Worker、AI、SSE 故障注入",
  "test:continuous-mp:privacy": "公私投影、旧 API 绕过和 prompt 泄漏测试",
  "test:continuous-mp:acceptance": "以上测试 + 现有回归的 fail-closed 聚合；headless 无法替代 browser 门禁"
}
```

最低回归命令：

```powershell
pnpm db:generate
pnpm typecheck
pnpm test:api
pnpm test:causal:web
pnpm test:acceptance
pnpm test:continuous-mp:acceptance
```

## 10. 风险与缓解

| 风险 | 触发方式 | 缓解 |
|---|---|---|
| 仍然不好玩但系统很复杂 | 先建通用引擎，最后才看三人体验 | 先做第 1 阶段三浏览器纵切，再扩七轮 |
| 固定 120 秒让真实玩家或单人三页测试超时 | 阅读、思考、滚动和截图时间不足 | 正式 180/45；人工 1200/900；自动成功路线 60/30；超时专项 15/8 |
| 三人快速提交吞掉谋划机会 | 直接按全员 MAIN 提前结算 | 强制 `INTERACTION_GRACE`，或三人 DONE 后才提前收束 |
| 私密行动被 Writer 泄露 | Writer 接收全量行动 | 先确定性 ACL 投影，Writer 只接收单一角色可见内容 |
| Worker 半完成 | Resolution 已写、投影未写时崩溃 | checkpoint + dedupeKey + 可恢复重入 |
| SSE 丢事件 | createdAt 游标、全局序号被隐私过滤 | 每成员稠密 deliverySequence + afterDeliverySequence 补偿 + 幂等应用 |
| 一个页面看起来像正式页但内容仍是假 | 前端拼装单人 View | 服务端直接返回 GameProjection，前端不硬编码权威状态 |
| 测试脚本自己知道三人秘密 | 一个 orchestrator 读取全部响应后写行动 | 三个盲模拟玩家只读各自 DOM；统一程序只调度，不参与决策 |
| 功能改造破坏单人游戏 | 直接替换单人领域引擎 | Feature Flag、共享渲染器、模式化投影、完整单人回归 |
| 短断线误触发永久托管 | 刷新、切后台或 SSE 抖动被当作退出 | 心跳恢复期与明确交托分离；阈值配置化；短断线回归不启动 Agent |
| 人类和 Agent 同时替角色下决策 | 自动接管与末秒提交、返回接管并发 | RoleControl epoch fencing + 槽位唯一约束 + 事务 Outbox，旧 epoch 任务 no-op |
| Role Agent 变成全知导演 | 直接把全局 state/prompt 交给角色模型 | 仅供给 `RoleAgentProjection`；同轮 AI 共用 opening snapshot；独立隐私扫描 |
| 全员 AI 托管意外花费或死锁 | Agent 遇到共享解锁/模型失败 | Agent 无 Credits/支付工具；托管路线先由真人解锁；repair + 确定性 fallback + AI-only grace |
| schema 与 migration/目标库漂移 | 本机曾用 db push 或表已手工创建 | foundation migration + 空库 deploy + 三方 fingerprint；漂移未清零不进入 P0 |
| cookie SSE 误沿用 localStorage Bearer | 客户端读不到 HttpOnly token 或 401 后降级 | 同源 credentials include + 401 fail closed + deliverySequence 补拉 |
| 三浏览器心跳被通用限流 | 同 NAT 每分钟约 180 次 heartbeat 超过 IP 桶 | user/session 专用桶 + 70 秒三页 429=0 门禁 |
| Feature Flag/内容发布改变既有局 | 重启后按当前 env/default pointer 或被篡改的同版本字节分流 | 持久 `StoryRun.engineVersion/strategyVersion`；版本目录不可变并校验 registry hash；新策略先注册+migration，再只影响新 Run |

## 11. 最终 Definition of Done

### 11.1 产品体验

- [ ] 三名玩家在同一阶段看到不同私人简报和不同角色行动卡。
- [ ] 第一名提交 MAIN 后仍可谋划，不出现大型等待页。
- [ ] MAIN 回执 P95 小于 2 秒。
- [ ] MAIN/Grace 期间全屏硬阻塞时间为 0；玩家 DONE 后可以离开并恢复。
- [ ] 每名玩家七轮中至少五轮受到另一真人的可识别影响。
- [ ] 至少一轮存在真实定向请求和目标玩家回应。
- [ ] 至少一轮 PRIVATE 行动只向他人展示痕迹。
- [ ] 房主关闭页面不阻塞自动收束。
- [ ] 任一玩家退出后角色仍持续行动，其他玩家 2 秒内看到“AI 代理”，不出现等待空位。
- [ ] 返回玩家能看清 AI 已完成的行动与接管生效点，不覆盖已密封行动。
- [ ] 本局已由真人完成全部必需授权/共享世界解锁（或模板明确无需解锁）后，三人全部退出时无浏览器/SSE 仍到达第 7 阶段和三个个人结局；未解锁局稳定暂停，原玩家返回后在同一 Run 解锁并恢复。
- [ ] 接管后的每阶段仍至少有两条来自不同可玩角色 action 的可追溯影响边；Agent 同时能影响别人、也会受别人影响。
- [ ] 三个个人结局不同，公共结局一致且可追溯。
- [ ] 第 4 轮共享世界解锁只扣一次，三名成员继续同一房间，未发生真实付款。
- [ ] 第 7 轮三个 MAIN 到齐后仍各有 MANEUVER 机会；三条 R7 MANEUVER 和所有强制 REACTION 终态前 `resultReady=false`。
- [ ] `/game`、`/game/result` 和 `/room-game → /game` 在 production build 深链/重定向合同通过；带无效 `runId` 时不降级 SOLO。
- [ ] 玩后“我的选择改变了局势”平均评分至少 4/5。

### 11.2 工程质量

- [ ] 7 个 ActionWindow 各只关闭和结算一次。
- [ ] 空库只执行 `prisma migrate deploy` 可得到与 schema 一致的结构；foundation 六表、migration diff、目标 DB fingerprint 和 `_prisma_migrations` 全部一致，未使用 `db push` 充当验收。
- [ ] 每个验收 Run 持久化正确且不可变的 `engineVersion/strategyVersion`；关闭 Feature Flag 并重启后既有 waiting/started 连续局仍按冻结版本完成，legacy/SOLO 不进入新引擎；同版本内容 hash 漂移会 fail-fast，不能原地替换。
- [ ] 每局恰有 3 个可玩 StoryRole、3 个真人 StoryPlayer，且模板恰有 1 个不可 claim、无 StoryRole 行的 worldActor；成功路线恰有 21 MAIN、21 MANEUVER、7 条 `roleId=null` 的 SYSTEM_ACTION 和 3 REACTION（R2:P3、R4:P1、R5:P2）。
- [ ] 7 个 `DirectorResolution`、7 个公共结果、21 个个人结果，无重复。
- [ ] 每个 `continuous_strategy_v1_1` 已 Start Run 恰有 3 个 `RoleControl`；worldActor、legacy/SOLO/等待房不被伪回填。每次接管/回归转换有连续 epoch 和审计记录，无孤儿、无回退。
- [ ] 混合接管 RunId 中 `HUMAN + AI_TAKEOVER + TIMEOUT_FALLBACK = 21 MAIN`，每槽位恰一条；与全真人成功 RunId 的 21 HUMAN 分开验证。
- [ ] Role Agent 只收到本角色知识，同轮多 Agent 使用同一 opening snapshot，无秘密、prompt 或隐藏思维链泄露。
- [ ] 资产、证据和唯一筹码不重复消耗。
- [ ] SSE/补拉按每成员的 `deliverySequence` 不丢、不重、不乱序，成员事件延迟 P95 小于 3 秒；全局 StoryEvent 隐私跳号不会触发无限补拉。
- [ ] PRIVATE/LIMITED/OBSERVABLE/PUBLIC 投影矩阵全部通过。
- [ ] 旧 API 无法绕过房间投影读取其他玩家秘密或触发结算。
- [ ] Worker 在任一 checkpoint 崩溃后可以恢复到完整状态。
- [ ] 正式故障证据来自 `STORY_WORKER_EMBEDDED=false` 的独立 Worker PID；health、leaseOwner/leaseVersion、checkpoint 和表计数一致，生产故障变量 fail-fast。
- [ ] 三个同 NAT 页面按 1 秒 heartbeat 连续至少 70 秒，heartbeat 429=0、无误接管；业务写限流仍有效。
- [ ] Web/SSE 全程使用 HttpOnly cookie + credentials include，不在 URL/localStorage/日志泄露 token；401/403 fail closed。
- [ ] `RoleAgentPolicy/Projection/Decision`、任务级 Outbox、ResolutionWorkflow/Checkpoint 的字段、唯一键和终态读回符合 5.8；无原始 provider 响应或隐藏思维链落库。
- [ ] 单人《嘉靖财政危局》7 天/12 决策和其他平台流程不回归。

### 11.3 真实用户证据

- [ ] 内置 Browser 三个可见标签页分别使用 `one/two/three.localhost:5218`，账号、角色、host-only Cookie 和私人投影完全隔离。
- [ ] 三个账号分别通过可见注册页面和各自邮箱验证链接建立；没有 DB verified 修改、cookie/token 注入或 mock openid。
- [ ] production-build 的 `/room-game` Location、`/game`、`/game/result` 最终 URL、状态码和 bundle hash 已留证。
- [ ] 大厅只有总督/巡抚/县令三个真人角色可选；江南商会不可点击、claim、Ready 或 DONE，不计入 Players/Ready。
- [ ] 创建房间、邀请加入、选角、Ready、Start 和七轮均由可见 UI 完成。
- [ ] 游戏脚本仅使用可见 locator/坐标和真实键盘输入；没有 `HTMLElement.click()`、事件注入、页面内 fetch，也没有直接 POST 行动、回应、结算或推进 API。
- [ ] 每轮保留三名玩家的决策前、MAIN 后、谋划/回应和个人结果页面证据。
- [ ] 第 7 轮保留三页 MAIN 后仍可谋划、三条 MANEUVER 提交和结果发布后的截图/网络/DB 时间顺序证据。
- [ ] DB verifier 只在事后读回，不参与玩家决策。
- [ ] 单人交托、浏览器异常断线、房主交托、返回接管和三人全交托均有独立 RunId、可见 UI 起点和服务端结局证据。
- [ ] 当前 RunId 的失败、隐私泄漏、重复写入、未覆盖 P0 和 limitation 全部为 0。
- [ ] 唯一 `acceptance-manifest.json` 记录动态 source/database hashes、`D00、D01、D02、D02A、D03—D11` 全部 checkpoint、每条路线独立 RunId 和所有 gates；`EXTERNAL_BLOCKED/SOURCE_DRIFT/NEEDS_USER_COORDINATION` 均为 0。

## 12. 最终判断标准

最终不是证明“系统可以让三个账号提交 21 次行动”，而是证明：

> 三个隔离浏览器中的三个玩家，只根据各自页面可见的信息扮演浙江总督、浙江巡抚和清流县令，连续完成七轮。任何玩家提交后都还能继续进行有价值的布局，房主不再控制结算，三人的选择形成真实、可追溯、彼此可感知但不泄密的因果影响。玩家中途退出时，持久角色 Agent 在相同权限、知识和资产边界内接续该角色，不阻塞剩余真人；本局已由真人完成全部必需授权/共享世界解锁（或模板无需解锁）后，即使三人全部离开，世界也能安全、可审计地推演到结局。尚未解锁时 Agent 不花费玩家资产，世界稳定暂停，原玩家返回后在同一 Run 解锁并恢复。
