# RoomLobby 临时大厅与正式 StoryRun 生命周期重构

## ChatGPT Pro 完整开发任务书 v1.0

- 文档日期：2026-08-15
- 仓库：`forwardFish/aiStoryRoom`
- 本地仓库：`D:\lyh\agent\agent-frame\aiStoryRoom`
- 需求基线分支：`main`
- 需求基线提交：`a6426b20f5dd03701caa8b0016cef8932bb7b236`
- 文档状态：开发任务书；不是代码交付、迁移授权、部署授权或产品验收报告
- 目标协作者：网页版 ChatGPT Pro 普通 Chat 模式

---

## 1. 任务结论

当前多人房间不能继续以“创建大厅时就创建正式 `StoryRun`”作为核心模型。必须把两个生命周期拆开：

1. `RoomLobby` 是可过期、可硬删除、未收费的临时多人大厅，负责被发现、加入、选角、Ready、离开和启动协调。
2. `StoryRun` 是游戏真正启动后才创建的正式游戏记录，负责 Pressure 生命周期、Genesis、N1 以及后续正式游戏状态。

唯一允许的状态转换方向是：

```text
临时 RoomLobby
WAITING_PLAYERS
  -> STARTING
  -> 正式 StoryRun 初始化成功
  -> 删除临时 RoomLobby
  -> 进入 /game
```

不得把 `RoomLobby` 当作第二套游戏运行时，也不得继续让尚未启动的正式 `StoryRun` 兼任临时大厅。

---

## 2. 用户已经确认的产品规则

以下规则是本任务的产品事实来源。实现不能自行弱化、替换或重新解释。

### 2.1 创建房间

- Supabase 只创建临时 `RoomLobby`，因为其他真人和其他 Railway API 实例需要发现并加入它。
- 此时不创建永久 `StoryRun`、章节、Genesis、N1 或 AI 任务。
- 此时不扣除游戏费用。
- 同一用户、同一世界最多存在一个未开始的临时大厅。
- 用户重新创建时，服务端先硬删除该用户在该世界的旧临时大厅，再创建新大厅。
- 临时大厅默认 30 分钟过期；活跃房主可通过服务端租约机制续期，关闭页面或断网后不能无限存活。

### 2.2 房间列表

- `Open Rooms` 只显示其他用户创建、当前仍可加入的大厅。
- 用户自己创建或已经加入的大厅只显示在 `My Rooms`。
- `My Rooms` 的操作是 `Open`，不能显示 `Join`。
- 已过期、房主已经退出、已进入 `STARTING` 或已经启动的临时大厅不得继续出现在 `Open Rooms`。
- 列表中的人数只统计真人，不把 AI 席位加到真人数量中。

### 2.3 加入房间

- 仅允许加入状态为 `WAITING_PLAYERS`、未过期且真人席位未满的大厅。
- 重复 `Join` 必须幂等：同一真人不能被重复插入，也不能重复增加人数。
- 真人必须占用六个既有 AI 角色席位之一，不能形成“真人 Host + 六个 AI Agent”的第七名参与者。
- 加入大厅本身不应创建正式游戏数据或扣费。

### 2.4 选择角色与 Ready

- 角色选择和 Ready 只写入临时大厅成员记录。
- 真人选择一个六席角色后，该 AI 席位被真人占用。
- 换角色时必须原子释放原席位并占用新席位。
- 同一角色席位在同一大厅中最多被一个真人占用。
- 所有未被真人占用的角色继续由 AI 代表，不需要为 AI 创建大厅成员记录。

### 2.5 退出房间

- 普通成员退出：只删除自己的大厅成员记录，其角色席位恢复为 AI。
- 房主退出且游戏未开始：立即硬删除整个临时大厅及其全部成员。
- 房主关闭页面或断网：浏览器事件只能作为尽力通知；最终权威是服务端租约和超时清理器，租约到期后硬删除。
- 房主在同一世界创建另一间房：旧的未开始大厅先被硬删除。

### 2.6 开始游戏

- 只有房主可以启动。
- 至少 2 名真人已经完成选角并处于 Ready。
- 服务端使用原子比较并交换，把大厅从 `WAITING_PLAYERS` 切换为 `STARTING`。
- 进入 `STARTING` 后，禁止继续加入、退出后重新加入、换角色或修改 Ready。
- 冻结真人席位集合；其余六席分配给 AI。
- 只有此时才创建正式 `StoryRun`、Pressure 生命周期、Genesis 和 N1。
- 初始化成功后，正式游戏进入 `PLAYING`，临时 Lobby 被删除，真人进入现有 `/game` 页面。
- 启动失败必须可重试且幂等，不能生成重复 `StoryRun`，不能留下无人负责、不可恢复的半成品。

### 2.7 游戏开始以后

- `PLAYING`、`COMPLETED` 等正式游戏不再受临时大厅删除规则影响。
- 正式游戏开始后房主离开，只能走游戏内离线、AI 托管或恢复机制。
- 任何大厅清理任务都不得删除已经正式启动的游戏。

---

## 3. 已知问题与开发前复核

基线 `a6426b20...` 上已经观察到以下结构性问题。ChatGPT Pro 必须先在所提供源码中逐项复核，给出文件和行号；如实际源码与本文不同，以准确源码证据为准并立即报告，不得凭本文臆造代码。

- 房间目录主要从 `StoryRun` 的 room/waiting 状态投影，临时大厅和正式游戏生命周期混在一起。
- 房间创建链可能在用户真正开始游戏前进入 Pressure/正式运行创建路径。
- `Open Rooms` 可能包含当前用户自己的大厅，前端对目录行统一呈现 `Join`。
- 前端的成功创建请求完成后缺少“同一用户同一世界只有一个临时大厅”的持久幂等约束。
- 过期投影存在 `lobbyDeadlineAt`、`roomExpiresAt` 或 `expired` 未形成真实数据库权威的问题。
- 现有离开链能删除成员，但未开始房主退出并不可靠地硬删除整个临时大厅。
- 旧关闭入口可能已禁用，不能把浏览器 unload 当作唯一清理保证。

这些现象说明需要生命周期重构，不能只改人数文字、按钮点击事件或把连接池上限调大。

---

## 4. 权威来源和不可破坏边界

### 4.1 单一权威

- Supabase PostgreSQL 是跨进程共享状态的唯一权威。
- 临时大厅权威：`RoomLobby` 与 `RoomLobbyMember` 数据及数据库约束。
- 正式游戏权威：现有 `StoryRun`、Pressure 生命周期及其 PostgreSQL 事件/状态链。
- 六个角色席位的定义继续来自现有世界/内容包权威；大厅只保存真人对角色标识的占用，不复制角色内容。
- AI 席位是“六席减去真人占用”的派生结果，不是另一组真人成员数据。

### 4.2 禁止第二权威

- 不得使用进程内 Map、前端 localStorage、Redis、Docker/Postgres 或本地文件作为大厅真相。
- 可以使用缓存加速读取，但缓存不得决定加入、选角、Ready、启动或删除结果。
- 页面不得重新实现容量、过期、角色唯一性、启动资格或房主权限规则。

### 4.3 正式游戏边界

- 必须复用并扩展现有 Pressure 正式启动权威链。
- 不得创建第二套 Story 引擎、平行 `/game` 页面、测试专用正式运行时或绕过 Genesis/N1 的快捷路径。
- Lobby 清理只能触达临时大厅表，不能级联删除正式 `StoryRun`。

### 4.4 玩家页面边界

- 保留现有房间列表、房间选角页面和真实 `/game` 路由。
- 不做整体 UI 重设计，不改变已批准的三栏 `/game` 信息架构。
- 只允许实现本需求直接要求的行为语义：`Open Rooms`/`My Rooms` 归属、`Join`/`Open` 操作、六席占用、退出、Ready 和启动反馈。
- 任何正式玩家可见文件在修改前，必须把准确文件、前后行为、数据合同、测试和回滚方案提交给项目所有者，并获得明确批准。

---

## 5. 状态机

### 5.1 RoomLobby 状态

最小状态集合：

| 状态 | 含义 | 允许操作 | 退出方式 |
|---|---|---|---|
| `WAITING_PLAYERS` | 可发现、可加入的临时大厅 | Join、选角、Ready、普通成员退出、房主关闭、Start | 删除、过期删除或 CAS 到 `STARTING` |
| `STARTING` | 真人席位已冻结，正式游戏正在幂等初始化 | 房主查询启动进度、相同启动键重试 | 初始化成功后删除 Lobby；可恢复失败回到受控重试 |

不要长期保留 Lobby 的 `PLAYING` 状态。正式游戏成功后，`StoryRun` 是唯一权威，Lobby 应在安全提交点删除。

### 5.2 状态转换约束

```text
create
  -> WAITING_PLAYERS

WAITING_PLAYERS
  -> hard delete        (owner leave / replacement / expiry)
  -> STARTING           (owner start + qualification + CAS)

STARTING
  -> retry same launch  (recoverable initialization failure)
  -> formal PLAYING StoryRun + hard delete Lobby
```

- 不允许 `STARTING -> WAITING_PLAYERS` 的无条件回退，否则已冻结席位可能被并发修改。
- 如果设计确需回退，必须定义启动代次、撤销全部副作用和数据库证明，并作为架构变更单独请示。
- 清理器遇到 `STARTING` 不得按普通过期大厅直接删除；必须检查启动 fence、更新时间和正式运行关联，交给专用恢复策略。

---

## 6. 数据模型要求

以下是必须满足的逻辑合同。字段命名可按仓库约定调整，但不能删除相应语义。

### 6.1 RoomLobby

建议字段：

- `id`：UUID 主键，作为大厅 URL/接口身份。
- `joinCode`：用户可输入的加入码，唯一索引。
- `worldId`：世界/内容包标识，外键或稳定引用。
- `hostUserId`：房主用户标识。
- `status`：`WAITING_PLAYERS | STARTING`。
- `expiresAt`：当前服务端租约截止时间，创建时默认为当前时间加 30 分钟。
- `lastHostHeartbeatAt`：最近一次有效房主心跳时间。
- `startFence`：启动代次或不可猜测 token，用于 CAS 和重试隔离。
- `startIdempotencyKey`：一次启动的稳定幂等键。
- `formalStoryRunId`：可空、唯一；只用于完成正式启动期间的恢复和关联，不能让 Lobby 成为正式游戏权威。
- `createdAt`、`updatedAt`。

必须具备：

- `joinCode` 唯一约束。
- 同一 `hostUserId + worldId` 对活跃未开始大厅的数据库级唯一约束，优先使用 PostgreSQL 部分唯一索引。
- 对 `status + expiresAt`、`hostUserId` 和目录查询条件建立适用索引。
- 所有时间由服务端/数据库生成，不能信任浏览器时间。

### 6.2 RoomLobbyMember

建议字段：

- `lobbyId`。
- `userId`。
- `roleId`：可空；选角后指向六席之一。
- `ready`：布尔值；未选角时必须为 `false`。
- `isHost`：如可从 `RoomLobby.hostUserId` 唯一推导，可不冗余存储。
- `joinedAt`、`updatedAt`。
- 可选 `revision`：用于乐观并发控制。

必须具备：

- `(lobbyId, userId)` 唯一约束，保证 Join 幂等。
- `(lobbyId, roleId)` 对非空 `roleId` 的唯一约束，保证角色只能由一个真人占用。
- 删除 Lobby 时成员级联删除；删除成员不得级联删除 Lobby。
- 不为 AI 建立 `RoomLobbyMember` 行。

### 6.3 正式运行幂等关联

必须有数据库级机制证明一个 Lobby 最多生成一个正式运行，例如：

- 在正式 `StoryRun` 或专用启动记录上增加唯一 `sourceLobbyId`；或
- 使用现有可证明等价的唯一幂等键和事务 fence。

仅靠“先查询再创建”不合格，因为多个 Railway 实例可并发处理同一启动请求。

### 6.4 Migration 安全要求

- 提供 Prisma schema 变更和原生 SQL migration。
- Prisma 不便表达的部分唯一索引、检查约束或锁语义必须明确写在 SQL 中。
- migration 必须可重复审查、可回滚，并说明锁表范围和预计影响。
- 当前测试 Supabase 中 room `StoryRun` 已清为 0，但实现不能把“当前无旧数据”当作生产假设。
- migration 不得删除或改写 Solo、正式 `PLAYING`/`COMPLETED` StoryRun、账单、订单、用户、世界模板或正式事件。
- Pro 只能交付 migration 文件；没有项目所有者的单独明确授权，不得应用到 Supabase。

---

## 7. 模块清单

一次只实现和验收一个模块。模块通过聚焦测试后再进入下一个。

### M1：Lobby 数据权威与约束

- 职责：定义临时大厅、真人成员、角色占用、过期、启动 fence 和唯一约束。
- 非职责：HTTP、页面、Pressure 初始化、收费。
- 输入：用户、世界、六席稳定角色标识。
- 输出：可事务读写的 Lobby/Member 数据合同。
- 依赖：Prisma、Supabase PostgreSQL。
- 预计文件：`prisma/schema.prisma`、新的 `prisma/migrations/<timestamp>_room_lobby_lifecycle/migration.sql`。
- 测试：约束、级联、部分唯一索引、过期查询和 rollback SQL 审查。
- 回滚：回退新表/索引；不得触碰正式 StoryRun 数据。
- 玩家节点：无直接渲染。
- 失败归属：数据库/迁移层。

### M2：Lobby 领域服务与 Repository

- 职责：创建/替换、列表资格、幂等 Join、原子选角、Ready、退出、租约和清理。
- 非职责：页面渲染、正式 StoryRun 初始化。
- 输入：认证用户、Lobby 命令、数据库时间。
- 输出：领域结果或玩家安全错误码。
- 依赖：M1；不得直接依赖页面或 Provider。
- 预计文件：
  - `apps/api/src/room-lobby/room-lobby.module.ts`
  - `apps/api/src/room-lobby/room-lobby.contracts.ts`
  - `apps/api/src/room-lobby/room-lobby.repository.ts`
  - `apps/api/src/room-lobby/room-lobby.service.ts`
  - `apps/api/src/room-lobby/room-lobby-cleanup.service.ts`
- 测试：领域单测、真实 PostgreSQL/Supabase 测试库并发集成测试、假时钟过期测试。
- 回滚：API 不接入时新模块无外部影响。
- 玩家节点：创建、目录、加入、选角、Ready、退出。
- 失败归属：Lobby 领域或持久化层。

### M3：正式启动协调器

- 职责：校验房主和至少两名 Ready 真人，CAS 到 `STARTING`，冻结席位，幂等创建并初始化唯一正式 StoryRun，成功后删除 Lobby。
- 非职责：重新实现 Pressure 引擎、页面路由或 Narrator。
- 输入：Lobby ID、房主身份、启动幂等键、冻结成员快照。
- 输出：唯一正式 StoryRun ID、启动进度或可重试错误。
- 依赖：M1、M2、现有 Pressure 正式启动入口和账务边界。
- 预计文件：
  - `apps/api/src/room-lobby/room-lobby-start.service.ts`
  - `apps/api/src/pressure-chapter/rooms-entry/adapter.ts`
  - `apps/api/src/pressure-chapter/product/rooms-gateway.ts`
  - `apps/api/src/pressure-chapter/production/production-bridge.ts`
  - 只有合同确实要求时，才修改最少数量的既有 Pressure Prisma adapter。
- 测试：双击启动、两实例并发启动、失败重试、席位冻结、唯一正式运行、无孤儿副作用。
- 回滚：关闭新启动接线，保留可识别的未完成 fence 供安全恢复；不得删除已正式启动游戏。
- 玩家节点：房主点击 Start，成功进入 `/game`。
- 失败归属：启动协调、Pressure 初始化或账务层，必须可区分。

### M4：现有 Rooms API 适配

- 职责：保持现有公开路由形态，改由 Lobby 领域提供临时房间行为，并提供玩家安全投影。
- 非职责：在 Controller 复制领域规则。
- 输入：认证上下文和 HTTP 请求。
- 输出：兼容页面所需的 Lobby DTO。
- 依赖：M2、M3。
- 预计文件：
  - `apps/api/src/app.module.ts`
  - `apps/api/src/rooms.controller.ts`
  - `apps/api/src/rooms.service.ts`
  - 相关 rooms presentation/projection contracts 与 tests。
- 测试：认证、归属、Open/My 分流、幂等错误映射、旧客户端兼容。
- 回滚：恢复旧适配层；不得回退已提交的正式游戏。
- 玩家节点：所有 Lobby HTTP 操作。
- 失败归属：API 适配/投影层。

### M5：现有页面最小行为接入

- 职责：让现有目录和选角页正确呈现 `Join`/`Open`、六席真人占用、Ready、退出、启动及安全错误。
- 非职责：重设计页面、修改 `/game`、在浏览器实现领域规则。
- 输入：M4 DTO。
- 输出：现有页面上的正确操作和反馈。
- 依赖：M4。
- 预计文件：
  - `apps/web/public/platform.js`
  - `apps/web/public/room-role-selection-view.js`
  - 对应的现有 CSS/测试文件仅在项目所有者逐项批准后允许修改。
- 测试：真实页面浏览器流程、窄屏/常规视口、重复点击、刷新恢复、跨账号流程。
- 回滚：回退这些准确玩家文件，不影响数据库权威。
- 玩家节点：完整大厅用户流程。
- 失败归属：前端交互/投影渲染层。

如果实现需要越过上述边界、修改公共 Pressure 合同、数据库正式游戏权威、路由结构或三个以上既有业务模块，必须停止并报告根因、准确扩展文件、替代方案和风险，等待项目所有者重新批准。

---

## 8. API 行为合同

优先保持现有路由，允许在不破坏客户端的前提下补充 heartbeat/查询接口。Pro 必须先列出现有准确路由和 DTO，再提交兼容方案。

### 8.1 创建

`POST /api/v4/rooms`

- 认证用户必需。
- 在一个短事务中锁定或串行化同一 `user + world` 的创建。
- 删除同一用户同一世界旧的 `WAITING_PLAYERS` Lobby 及成员。
- 创建新 Lobby 和房主 Member；不创建正式 StoryRun。
- 返回 Lobby ID、join code、expiry、viewer relation 和页面需要的安全投影。
- 请求超时重试不得留下两个活跃 Lobby。

### 8.2 列表

`GET /api/v4/rooms`

- `openRooms`：排除 viewer 已加入/拥有的 Lobby，只返回其他人的 `WAITING_PLAYERS`、未过期、未满大厅。
- `myRooms`：返回 viewer 创建或已加入的有效 Lobby，并提供 `action: OPEN`。
- 一次批量读取成员/世界投影，禁止对每行无上限 `Promise.all` 扇出数据库连接。
- 响应不得包含内部 fence、Provider 信息、原始数据库错误或敏感用户字段。

### 8.3 Join

保持现有 join-by-code 或 lobby ID 入口：

- 在事务内重查状态、expiry 和真人容量。
- `upsert`/唯一约束保证同一成员重复 Join 返回相同成员关系。
- 同一用户已是成员时返回成功或明确的幂等结果，不得增加人数。
- 加入后尚未选角；页面打开角色选择。

### 8.4 角色与 Ready

- `/api/v4/rooms/:roomId/role`：事务内确认 `WAITING_PLAYERS`、成员身份和角色属于该世界六席；通过唯一约束原子换座。
- `/api/v4/rooms/:roomId/ready`：只有已经选角的成员可以 Ready；取消 Ready 如现有 UI 支持，也必须只在 `WAITING_PLAYERS`。
- 角色冲突返回稳定业务错误，前端刷新最新占用，不显示内部唯一索引名。

### 8.5 Leave/Close

- `/api/v4/rooms/:roomId/leave`：普通成员删除自身；房主硬删除整个未开始 Lobby。
- 浏览器 unload/visibility 事件只能发送 `sendBeacon` 或等价尽力请求，不能作为唯一权威。
- 房主心跳只允许延长自己 `WAITING_PLAYERS` Lobby 的服务端租约。

### 8.6 Start

- `/api/v4/rooms/:roomId/start`：房主专用。
- 在同一一致性边界中校验 Lobby、房主、状态、expiry、至少两名真人、全部真人选角且 Ready。
- CAS `WAITING_PLAYERS -> STARTING` 并写入稳定 start fence/idempotency key。
- 后续重复相同请求返回同一启动结果或继续同一初始化，不创建第二个 StoryRun。
- 初始化完成后返回唯一正式 StoryRun ID 和现有 `/game` 路由所需信息。

### 8.7 玩家安全错误

至少定义并测试以下稳定错误语义，HTTP 状态按项目现有约定映射：

- `ROOM_NOT_FOUND`
- `ROOM_EXPIRED`
- `ROOM_NOT_JOINABLE`
- `ROOM_FULL`
- `ROOM_ALREADY_MEMBER`
- `ROOM_ROLE_TAKEN`
- `ROOM_ROLE_REQUIRED`
- `ROOM_NOT_HOST`
- `ROOM_NOT_READY`
- `ROOM_STARTING`
- `ROOM_START_RETRYABLE`

内部 Prisma、SQL、fence、堆栈、证据 ID 和 Provider 错误不得直接返回玩家。

---

## 9. 并发、幂等和失败恢复

必须通过数据库约束和事务证明以下竞态，不接受仅靠应用层 if 判断：

1. 同一用户同时发起两次 Create：最终只有一个活跃 Lobby。
2. 同一用户同时 Join 同一 Lobby：最终只有一条 Member。
3. 两名用户同时选择同一角色：只允许一名成功，另一名获得稳定冲突结果。
4. 最后一个真人席位被两人同时 Join：真人数量不能超过六。
5. Start 与 Join 并发：CAS 成功后 Join 不能进入冻结集合。
6. Start 与换角色/Ready 并发：冻结快照必须来自同一一致性边界。
7. 房主双击 Start 或两个 Railway 实例同时处理：最多一个正式 StoryRun。
8. 正式初始化在 Genesis/N1 中途失败：相同 fence 可以恢复或安全补偿，不产生第二个运行或不可识别孤儿。
9. 清理器与 Start 并发：清理器不能删除正在合法启动或已经关联正式运行的状态。
10. 房主 Leave 与普通成员操作并发：房主删除胜出后所有后续操作返回不存在/不可操作，不复活 Lobby。

事务必须短小，不在数据库事务中等待模型、网络 Provider、长时间 Genesis 生成或浏览器响应。需要异步初始化时，使用现有可靠任务/事件机制和唯一幂等 fence；不得新增第二事件权威。

---

## 10. 清理器与租约

- 创建时 `expiresAt = database_now + 30 minutes`。
- 只有经认证的房主心跳可以把自己的 `WAITING_PLAYERS` 租约续到新的 `database_now + 30 minutes`。
- 清理器按固定小批次处理过期 `WAITING_PLAYERS` Lobby，并用数据库条件删除避免与续租/启动竞态。
- 清理任务必须支持多个 Railway 实例并发运行，可使用 `FOR UPDATE SKIP LOCKED`、advisory lock 或项目已有等价机制。
- 清理批次、扫描频率和最大执行时间必须可配置，默认值写入非敏感配置文档。
- 每次运行记录结构化计数：扫描数、删除数、跳过 STARTING 数、失败数和耗时；不得记录 join code、用户隐私或连接串。
- 浏览器主动退出是优化，服务端租约清理才是最终保证。

---

## 11. 收费与资源规则

- Create、列表、Join、选角、Ready、Leave 和 Lobby 心跳均不扣游戏费用。
- 费用只能在正式启动边界发生，必须复用现有账务权威和幂等机制。
- 双击 Start、请求重试或两个实例并发不得重复扣费。
- 正式初始化失败时必须明确账务结果：未扣费、原子回滚，或按现有权威自动退款；不能留下“扣费但无可进入游戏”。
- Pro 必须先定位现有收费/信用实现，写出调用时序；不得在 Lobby 模块复制账务规则。

---

## 12. 性能和连接池要求

- Room 列表必须批量查询或有限并发投影，禁止随房间数增长而无上限 `Promise.all` 查询。
- 所有 Lobby 写操作使用短事务；事务内不得进行 LLM/Provider/外部 HTTP 调用。
- 明确 API 实例数、Prisma 每实例连接预算和 Supabase 套餐总连接预算的计算方式。
- 不得把 `connection_limit=2` 简单改大当作根因修复。
- 在真实测试 Supabase 压测列表、创建、Join、选角、Ready 和 Start 竞争路径。
- 验收至少记录：吞吐、p50、p95、p99、Prisma `P2024` 数、Supabase 活跃连接峰值、错误率和测试数据规模。
- 连接池超时必须为 0；若未运行真实 Supabase 压测，明确标记 `TESTS_NOT_RUN`，不能声称可上线。

---

## 13. 准确修改范围

### 13.1 预期允许修改

Pro 必须以真实源码为准，把最终范围缩到最小，并在动手前提交文件清单。

数据库：

- `prisma/schema.prisma`
- `prisma/migrations/<timestamp>_room_lobby_lifecycle/migration.sql`

新 Lobby 模块：

- `apps/api/src/room-lobby/room-lobby.module.ts`
- `apps/api/src/room-lobby/room-lobby.contracts.ts`
- `apps/api/src/room-lobby/room-lobby.repository.ts`
- `apps/api/src/room-lobby/room-lobby.service.ts`
- `apps/api/src/room-lobby/room-lobby-start.service.ts`
- `apps/api/src/room-lobby/room-lobby-cleanup.service.ts`
- 同目录聚焦测试。

现有 API 适配：

- `apps/api/src/app.module.ts`
- `apps/api/src/rooms.controller.ts`
- `apps/api/src/rooms.service.ts`
- `apps/api/src/rooms.pressure-routing.spec.ts`
- `apps/api/src/rooms.presentation.spec.ts`
- `apps/api/src/rooms-list-projection.spec.ts`

Pressure 启动边界：

- `apps/api/src/pressure-chapter/rooms-entry/adapter.ts`
- `apps/api/src/pressure-chapter/rooms-entry/projection.spec.ts`
- `apps/api/src/pressure-chapter/product/rooms-gateway.ts`
- `apps/api/src/pressure-chapter/production/production-bridge.ts`

玩家页面，仅在项目所有者对准确页面文件再次明确批准后：

- `apps/web/public/platform.js`
- `apps/web/public/room-role-selection-view.js`
- 与这两个页面行为直接对应的测试。

### 13.2 未经重新批准禁止修改

- `release` 分支、部署配置、生产环境变量或 Railway/Supabase 线上配置。
- 已批准的 `/game` 页面布局、主游戏路由和 `docs/主游戏最终版/` 视觉权威。
- Solo 生命周期、Solo StoryRun 或 Solo 结局。
- Pressure 裁决、Narrator、内容包和 N1-N7 故事规则，除非只是通过现有正式启动合同接入。
- 支付定价、信用规则、退款规则的权威实现。
- 用户、订单、支付、世界模板或正式游戏历史数据。
- Docker、本地 PostgreSQL、Redis 或第二套运行时依赖。
- 与本任务无关的格式化、重命名、依赖升级或大规模重构。

---

## 14. 必须执行的测试

Pro 应先读取 `package.json` 和现有测试约定，给出准确可执行命令。下列测试类别不得省略。

### 14.1 静态门

- 受影响 workspace 的 typecheck。
- lint 或仓库等价检查。
- `git diff --check`。
- Prisma schema validate/generate。
- migration SQL 静态审查和 rollback 说明。

### 14.2 领域与持久化测试

- 同用户同世界单 Lobby。
- Create 替换旧 Lobby。
- Join 幂等。
- 六真人容量上限。
- 角色原子唯一占用与换座。
- 未选角不能 Ready。
- 普通成员退出恢复 AI 席位。
- 房主退出硬删除 Lobby。
- 30 分钟租约、心跳续租和过期清理。
- 清理器多实例竞争。

### 14.3 启动测试

- 非房主禁止 Start。
- 少于 2 真人禁止 Start。
- 任一真人未选角或未 Ready 禁止 Start。
- CAS 后禁止 Join/角色/Ready 修改。
- 六席快照中真人占用正确，其余席位为 AI。
- 双击/并发 Start 只创建一个 StoryRun、只扣费一次。
- Genesis/N1 任一阶段失败后的同 fence 重试。
- 成功后 Lobby 删除，正式 StoryRun 可从现有 `/game` 读取。
- Lobby 清理器永不删除正式游戏。

### 14.4 API 合同测试

- `Open Rooms` 不包含自己的或已经加入的 Lobby。
- `My Rooms` 包含自己的/已加入 Lobby，动作是 `OPEN`。
- 已过期、已满、`STARTING` Lobby 不可 Join。
- 玩家安全错误不泄漏数据库/Provider 内部信息。
- 旧客户端所需字段保持兼容；任何破坏性合同变更必须先停止请示。

### 14.5 真实浏览器验收

使用至少两个真实测试账号和现有正式页面验证：

1. A 创建；A 只在 My Rooms 看到 Open。
2. B 在 Open Rooms 看到并 Join；B 再次 Join 不重复。
3. A/B 竞争同角色，只有一人成功。
4. 真人占用 AI 席位，参与者总席位始终为六，不出现 7/6。
5. A/B 选角并 Ready；只有 A 可 Start。
6. Start 后两人进入同一正式 `/game`。
7. 未启动时普通成员退出与房主退出行为正确。
8. 房主关闭/断网，租约到期后 Lobby 从目录消失。

### 14.6 真实 Supabase 测试

- migration 只能在获得明确授权的隔离测试 Supabase 执行。
- 运行数据库约束、并发、多实例/多连接、清理和压力测试。
- 验证 room 临时数据可清除，Solo 和正式 StoryRun 不受影响。
- 没有真实执行就标记 `TESTS_NOT_RUN`；本地 mock、SQLite、内存库或 HTTP 200 不能替代。

---

## 15. ChatGPT Pro 必须交付的工件

只有聊天说明、伪代码或“已经完成”的自述不算交付。必须提供：

1. 可审查的真实产品源码修改。
2. unified diff/patch。
3. 只包含本任务 changed files 的 ZIP。
4. `manifest.json`，逐文件记录路径、字节数和 SHA-256。
5. `implementation-report.md`，按 M1-M5 分别写职责、修改、未改范围、风险和回滚。
6. migration SQL、数据库约束说明和 rollback 方案。
7. 所有实际执行测试的完整命令、退出码和日志摘要。
8. 未运行项目逐项标记 `TESTS_NOT_RUN`。
9. 并发/失败注入测试证据。
10. 若获得远程分支授权：准确分支名、提交 SHA、推送回读 SHA 和干净状态。

changed-files ZIP 和报告不得包含 `.env`、连接串、密钥、Cookie、Token、数据库导出、浏览器状态、`node_modules` 或生成缓存。

---

## 16. Git、迁移和外部状态授权

- 本文只提供需求和开发合同，不授权在本地 `main` 直接开发。
- Pro 使用的准确开发分支必须由项目所有者在当前 Pro 对话中单独明确授权；未授权前不得创建或推送任何分支。
- 即使后续授权 Pro 分支，也不得直接修改或推送 `main`、`release`。
- 不得创建 PR、合并、部署、运行 migration、修改 Supabase/Railway 配置或操作真实用户数据，除非项目所有者对该项单独明确授权。
- Pro 的自述、沙箱提交、CI 工件或聊天附件不能替代可回读的准确远程 SHA。
- Codex 后续必须在准确基线/准确 Pro SHA 上独立审查和测试，才能区分“已开发”“已交付”“已验收”。

---

## 17. 验收标准

### 17.1 开发完成

- M1-M5 的代码和工件齐全。
- 没有越过批准文件和权威边界。
- 所有未运行测试诚实标记。

### 17.2 交付完成

- 真实产品源码、patch、changed-files ZIP、manifest、报告和测试证据齐全。
- 若授权远程分支，远程可回读准确提交和树。

### 17.3 Codex 独立验收完成

- 在准确 SHA 上重新计算 manifest。
- 独立完成静态、聚焦、数据库、API、并发和构建门。
- 获得授权后，在真实测试 Supabase 与真实浏览器完成跨账号流程。
- 没有 Prisma `P2024`、重复 StoryRun、重复收费、7/6 参与者或残留临时 Lobby。

### 17.4 玩家验收完成

- 项目所有者在现有正式页面亲自确认目录、Join/Open、选角、Ready、退出和 Start 行为。
- 玩家验收之前，不得把代码测试通过表述为整体产品 PASS。

---

## 18. 失败停止条件

遇到以下任一情况，Pro 必须停止主要实现并报告，不得用临时补丁绕过：

- 实际基线不是 `a6426b20f5dd03701caa8b0016cef8932bb7b236`，且未提供新的批准基线。
- 源码 ZIP 缺失关键文件、含密钥或与 manifest 不一致。
- 需要创建第二套运行时、第二数据权威或平行玩家页面。
- 需要改变现有正式 Pressure 裁决、事件权威或 `/game` 公共合同。
- 需要修改未在批准清单中的玩家可见文件。
- 需要运行 Supabase migration、清理数据、部署或修改生产配置但没有明确授权。
- 无法通过数据库约束证明唯一 Lobby、角色唯一占用或唯一正式 StoryRun。
- 启动失败只能通过删除正式游戏、吞掉错误或人工清库恢复。

报告必须包含根因、准确文件/合同、替代方案、风险和所需的最小新增授权。

---

## 19. 可直接发给网页版 ChatGPT Pro 的任务指令

复制以下内容到网页版 ChatGPT Pro 的普通 Chat 模式，并同时提供脱敏源码 ZIP 和 manifest。发送前必须填入尖括号中的实际值。

```text
你是本任务的外部高级工程师。请在网页版 ChatGPT Pro 普通 Chat 模式中完成真实产品源码开发，不要只给方案或伪代码。

背景与目标：
重构 aiStoryRoom 多人房间生命周期。临时 RoomLobby 只负责创建、发现、加入、六席选角、Ready、退出、租约和启动协调；只有房主启动成功时才创建正式 StoryRun、Pressure 生命周期、Genesis 和 N1。未启动 Lobby 可过期和硬删除，正式游戏绝不能被 Lobby 清理删除。

源码基线：
- 仓库：forwardFish/aiStoryRoom
- main 基线：a6426b20f5dd03701caa8b0016cef8932bb7b236
- 源码 ZIP：<SANITIZED_SOURCE_ZIP_NAME>
- ZIP 字节数：<ZIP_SIZE_BYTES>
- ZIP SHA-256：<ZIP_SHA256>
- 允许开发分支：<OWNER_APPROVED_BRANCH_OR_NOT_AUTHORIZED>

第一步：
1. 完整阅读仓库 AGENTS.md、README、package.json、Prisma schema，以及本 ZIP 中与 rooms、Pressure rooms-entry、billing 和页面直接相关的源码与测试。
2. 校验 ZIP manifest 和基线。
3. 先输出当前真实调用链、问题文件/行号、M1-M5 模块清单、准确修改文件、公共合同影响、测试和回滚方案。
4. 如果玩家可见文件尚未得到项目所有者对准确文件的明确批准，先停在审批说明，不要编辑这些文件；后端模块可否开始也以本对话授权为准。

唯一权威和核心规则：
- Supabase PostgreSQL 是唯一共享权威；不得引入 Docker/Postgres、Redis、内存 Map 或第二套运行时权威。
- RoomLobby/RoomLobbyMember 是临时大厅权威；StoryRun/Pressure 是正式游戏权威。
- 创建 Lobby 不创建 StoryRun/Genesis/N1/AI task，不扣费。
- 同一用户同一世界最多一个活跃 Lobby；新建先删旧。
- Lobby 默认 30 分钟租约；房主心跳续租，断网后由服务端清理。
- Open Rooms 只显示其他用户的可加入 Lobby；自己的/已加入的只在 My Rooms，操作为 Open。
- Join 幂等；真人占用六个 AI 角色席位之一，绝不能出现第七名参与者。
- 角色换座原子；同一角色最多一个真人；未占用席位继续由 AI 表示。
- 普通成员退出只删除自己；未开始房主退出硬删除整个 Lobby。
- 只有房主可 Start；至少 2 真人都已选角并 Ready。
- CAS WAITING_PLAYERS -> STARTING 后冻结席位，禁止 Join/换角/Ready。
- Start 必须在多实例并发下最多创建一个正式 StoryRun、最多扣费一次；失败可用同一 fence 重试且无孤儿半成品。
- 成功后正式 StoryRun 进入 PLAYING、删除 Lobby、进入现有 /game。
- 正式游戏不受 Lobby 删除规则影响。

开发方式：
- 严格按随附《RoomLobby 临时大厅与正式 StoryRun 生命周期重构 ChatGPT Pro 完整开发任务书 v1.0》的 M1-M5 顺序，一次只实现和验收一个模块。
- 复用现有 routes/UI/Pressure 正式启动链，不创建平行页面或第二引擎。
- 用数据库约束、短事务、CAS 和唯一幂等键处理并发；事务内禁止 LLM/Provider/外部 HTTP。
- Room 列表必须批量或有限并发读取，禁止无上限 Promise.all 扇出数据库连接。
- 如果需要越过文档允许文件、改公共合同/数据库正式权威/路由/玩家页面，立即停止并报告，不要自行扩大范围。

必须交付：
- 真实 product-source edits
- unified patch
- changed-files ZIP
- manifest.json（每个文件 path/bytes/SHA-256）
- implementation-report.md（按 M1-M5）
- Prisma schema、migration SQL、rollback 方案
- 实际测试命令、退出码和日志
- 并发及失败注入证据
- 未运行项逐项标记 TESTS_NOT_RUN

禁止操作与禁止声称：
- 没有明确授权不得创建/推送分支；不得直接提交 main/release。
- 不得创建 PR、合并、部署、执行 Supabase migration、改 Railway/Supabase 配置或清理真实数据。
- 不得上传 .env、连接串、Token、Cookie、密钥、数据库导出或浏览器状态。
- 本地 mock、HTTP 200、CI、自述或附件不等于真实 Supabase/浏览器/产品验收。
- 未真实运行的测试必须写 TESTS_NOT_RUN；不得声称可上线。

完成时请给出：
1. 基线与最终状态；
2. 所有 changed files；
3. 每个模块的输入/输出/权威/失败归属；
4. 测试证据和未验证风险；
5. patch、changed-files ZIP、manifest 和报告下载工件；
6. 如果获得远程分支授权，给出准确 branch、commit SHA 和远程回读证据。
```

---

## 20. 本文档不代表的事项

本文档的提交与推送只代表“ChatGPT Pro 开发任务书已生成”。它不代表：

- RoomLobby 代码已经实现；
- Supabase migration 已执行；
- 旧房间数据已迁移；
- ChatGPT Pro 已经交付代码；
- Codex 已独立验收；
- 页面已获得玩家验收；
- 功能已部署或可上线。
