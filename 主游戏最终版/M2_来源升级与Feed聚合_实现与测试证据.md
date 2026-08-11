# Our Many Worlds A-Emotion M2：来源升级与 Feed 聚合——实现与测试证据

> 阶段：M2 only
> 逻辑远程基线：`99585c7a3fe85321bf2f339baba8aa08f2b2be46`
> 父 Artifact：M1-rebased-on-23cd Overlay SHA-256 `d23b31dc1309b21bca7c60a824593b37b8859ea20300b655f8f58aa512dd553d`
> 状态：源码作者候选；未声明远程提交、部署或 Codex 独立通过。
> 最新远程合并：`packages/shared/package.json` 以 23cd 真实 S1–S5 脚本为 preimage，完整保留 `pregeneric-endgame:verify:s1-s4`、`generic-endgame:verify:s1-s4`、`pregeneric-endgame:verify:s5`、`generic-endgame:verify:s5`、`generic-endgame:verify:s1-s5`、`pretypecheck`、`posttypecheck` 和 `test:endgame`，并保留 `test:a-emotion-m1`、追加 `test:a-emotion-m2`。

## 0. Repair4 远程前进重放

- 精确远程 preimage：`99585c7a3fe85321bf2f339baba8aa08f2b2be46`。
- 精确父 Artifact：M1-rebased-on-23cd Overlay SHA-256 `d23b31dc1309b21bca7c60a824593b37b8859ea20300b655f8f58aa512dd553d`。
- 本层只包含 M2 Feed 聚合、disclosure、durable receipt、cursor、权限与右栏“世界局势”，不包含 M3–M6。
- Repair4 已保留 zero-row cursor 先校验、M1 public idempotency code、实际发送 `interactionCursor`、跨 run detail/seen/ack/resolved、seen/ack/resolved 独立幂等，以及 advisory-lock/current-stage 防护。
- Owner UI 许可：只有右栏“世界局势”和文档允许的弹窗；中央 A-Emotion 卡、顶部 metric hint 和“局势动向”标题不进入本 Overlay。
- 23cd S5 narrator 与测试文件不在本层变更清单中，不会被删除或覆盖。

## 1. 阶段边界

M2 只实现：

- `HIDDEN → SUSPECTED → CONFIRMED` 单调来源升级；
- 同一 viewer、同一 stage、同一 shared object、同一 event family 的持久聚合；
- viewer-safe `RELATED / PUBLIC / SUSPICIOUS` Feed 合同；
- durable `seenAt / acknowledgedAt / resolvedAt`；
- 详情、游标、limit、read receipt 与版本检查；
- 真实 `/game` 右栏默认 3 条、展开 6 条、最多 10 条、内部滚动；
- 7 秒轻量轮询，以及 focus / online 后增量刷新；
- 输入焦点、工作区草稿和 Feed scrollTop 保留。

本阶段不包含：

- M3 `CRISIS`、危险阈值或关键模态；
- M4 Promise / PromiseBroken；
- M5 StageMilestone / StageVictory / interaction summary；
- M6 灰度、恢复压力、三浏览器 E2E 或部署。

## 2. 权威接入链路

```text
已经提交的 ActionResolution
  + 精确 actionKey/effectKey/factKey
  + 已确认 CanonFact
        ↓
ContinuousStoryV2Service 的既有权威事务
        ↓
AEmotionM2Service.applyAuthoritativeUpgrade
        ↓
ActionResolution.statePatchJson + StoryRun.stateJson
        ↓
同事务写 INTERACTION_DISCLOSURE_COMPILE_REQUESTED
        ↓
StoryTaskOutbox leased worker
        ↓
校验 committed resolution / fact / run / viewer / stateVersion
        ↓
ContinuousEventDeliveryService.publishProjected
        ↓
服务端先生成每 viewer 安全投影
        ↓
StoryEvent canonical payload 与 EventDelivery viewer payload 分离
        ↓
生产 RoomsController.events → RoomsService.events → EventDeliveryService.page
        ↓
真实 /game Feed、详情和 read receipt
```

M2 不读取玩家自由文本，不使用剧情中文关键词或正则决定来源升级。结构化 basis 固定为已有 Sangtian action/effect/fact：

- `main_s2_governor_dual_verification` → `SUSPECTED`；
- `main_s4_governor_seal_evidence` → `CONFIRMED`。

## 3. 查看者安全不变量

### HIDDEN

- 不携带 source identity、suspect IDs、evidence refs；
- response option 不预选任何角色；
- 复用 M1 已通过的递归字段与语义泄漏扫描。

### SUSPECTED

- 至少两个不同且规则允许的嫌疑角色；
- 不存在 `visibleSourceRoleId / visibleSourceRoleKey`；
- 不存在 confirmation evidence；
- TALK / INVESTIGATE 工作区 `targetRoleKey=null`；
- 不允许降级回 HIDDEN。

### CONFIRMED

- 必须同时携带 viewer-safe source identity 与 `evidenceRefs`；
- 非 DEFER 的定向 response 只能指向已确认 source；
- 详情接口不得比 Feed 当前投影更宽。

浏览器只收到 viewer projection；canonical source、raw action、raw audience、internal aggregate key 和 dedupe key 不进入 EventDelivery JSON。

## 4. 聚合、排序和游标

内部 aggregate identity 绑定：

```text
roomId + runId + viewerRoleId + stageId + sharedObjectId + eventFamily
```

数据库保存内部 `aggregateKey` 与公开 opaque `aggregateId`；内部 key 不序列化。Feed 每个 aggregate 只返回最高 `projectionVersion`，并验证 disclosure 单调。

排序：

1. 未 resolved 的 `RELATED`；
2. 其余按 `eventSequence DESC`。

游标是服务端生成的 opaque SHA-256 scope token，绑定 room/run/user/role/aggregate/version/sequence。跨 viewer、跨 room、旧投影或不再存在的游标 fail-closed。

## 5. 持久化与 migration

M2 增加 EventDelivery viewer 状态和 aggregate metadata：

- `aggregateKey / aggregateId`；
- `stageId / sharedObjectId / eventFamily`；
- `category / disclosure`；
- `projectionVersion / stateVersion`；
- `seenAt / acknowledgedAt / resolvedAt`。

Migration：

```text
prisma/migrations/20260810143000_a_emotion_m2_feed_state/migration.sql
```

本 Artifact 只提交 migration 源码；没有连接、迁移或修改真实 Supabase 公共 Schema。

## 6. API

继续复用生产 `RoomsController`：

```text
GET  /v4/rooms/:roomId/events
GET  /v4/rooms/:roomId/events/:eventId
POST /v4/rooms/:roomId/events/:eventId/seen
POST /v4/rooms/:roomId/events/:eventId/ack
POST /v4/rooms/:roomId/events/:eventId/resolved
```

身份来自生产 `AuthGuard / CurrentUser`，不接受客户端 viewerRoleId。成员、角色、room、run、event、projectionVersion、stateVersion、eventSequence 任一不一致均 fail-closed。

## 7. 前端

M2 在现有 `a-emotion-m1-ui.js` 上原位扩展：

- 默认 3 条、展开 6 条、首次最多 10 条；
- Feed 内部 scrollbar；
- 向下滚动时新事件进入“n 条新动态”，不强制跳顶；
- 进入可视区域满 1 秒发送 `seen`；
- 打开卡片或暂不回应发送 `ack`；
- 已绑定工作区行动成功后发送 `resolved`；
- SUSPECTED 不预选来源；CONFIRMED 才允许定向回应；
- 轮询只刷新 Feed，不刷新整个游戏页面，不清空输入或抢焦点。

## 8. 测试源码

新增测试：

- Shared Schema：投影安全、单调 disclosure、opaque IDs/cursor、Feed receipts；
- Config：默认关闭、房间冻结、旧房间/Solo/非 Sangtian fail-closed；
- Service：结构化 basis、同事务 outbox、幂等、viewer projection；
- Event Delivery：真实 Prisma transaction、aggregate、cursor、receipts、跨 viewer 拒绝；
- HTTP：生产 AuthGuard / RoomsController / RoomsService / EventDeliveryService 链路；
- Web：jsdom 真实 DOM click/focus/scroll/read receipt，3/6 展示与草稿保留。

数据库测试只在显式提供 `A_EMOTION_M2_TEST_DATABASE_URL` 时运行，目标必须是隔离测试 PostgreSQL/Supabase 随机 Schema；没有凭据不得连接生产数据库。

## 9. 作者环境检查状态

实际作者检查和退出码以 Artifact Manifest 为准。当前环境可执行：

- JS/MJS `node --check`；
- TypeScript parser syntax check；
- JSON parse；
- migration/schema 静态一致性；
- `git diff --check`；
- patch apply 验证；
- high-confidence credential scan；
- M2—M6 范围扫描。

作者环境已直接运行 Shared `tsc --noEmit`、Web package `typecheck` 与 Web `build`；API 正式 typecheck、完整 API/Web 运行测试、Prisma generate、隔离 PostgreSQL/Supabase 随机 Schema 和 Generic Endgame package gate 因依赖或完整基线缺失标记为 `NOT_RUN` 或环境阻塞，不得视为通过。


## 10. 验收重点

Codex 应在 `5ee862... + accepted M1 Overlay + repaired M2 Overlay` 的干净克隆中验证：

1. migration 空库与 M1 升级库；
2. HIDDEN/SUSPECTED/CONFIRMED 网络 JSON 安全；
3. 一个 aggregate 随 REVEAL 升级而不是重复 Feed 行；
4. county/unrelated viewer 零 delivery；
5. cross-room/run/user/role/cursor/version fail-closed；
6. seen/ack/resolved 幂等和旧 projection 拒绝；
7. 真实 `/game` 3/6 Feed、内部滚动和草稿/焦点保留；
8. Flag off、旧房间、Solo、Caesar、M1 回归不变；
9. API 全量、Web 全量、typecheck 和 build 不增加失败。

## 11. Repair 2：最新远程合并后的 P0/P1 修正

本候选在 `99585c7a3fe85321bf2f339baba8aa08f2b2be46 + accepted M1 Overlay` 的逻辑基线上修正以下问题：

1. **Feed DTO 分层校验**：`validateAEmotionM2FeedV1` 先以 `FEED_ITEM_KEYS` 严格拒绝未知字段，再显式抽取 `PROJECTION_KEYS` 交给 `validateAEmotionM2ProjectionV1`。合法的 `eventId / deliverySequence / isUnread / isAcknowledged / isResolved` 不再被 Projection 校验误判，同时 unknown-key 仍 fail-closed。
2. **Config 正常路径使用真实引擎版本**：测试 fixture 改用 `CONTINUOUS_STORY_ENGINE_VERSION`，不放宽生产门禁；旧房间、Solo、非 Sangtian、M1/M2 Flag 关闭继续 fail-closed。
3. **M1 Web 合同兼容**：legacy M1 item 点击时保持本地同步打开，不调用 M2 detail 或 M2 receipt；M1 `CROSS_IMPACT` 固定保留 `data-testid="aemotion-m1-cross-impact"`。只有 M2 item 才使用 detail、seen/ack/resolved receipt；M1 调查、公开质问、暂不回应与 HIDDEN 无来源预选合同保持不变。
4. **API malformed fixture 类型边界**：测试 helper 将 `actionKey` 参数显式扩宽为 `string`，从而构造非法 action key 并验证运行时 fail-closed；生产 `PlannedIntentAction`、精确 action/effect/fact 常量和业务门禁均未放宽。
5. **Generic Endgame 门禁保留**：`packages/shared/package.json` 同时保留 S1–S4 pre/post typecheck、verify、`test:endgame`，并保留 M1/M2 测试脚本。

作者侧实际执行：

- Node 22 experimental type-strip loader 直接运行 Shared M1 Schema：3/3 PASS；
- 同一 loader 直接运行 Shared M2 Schema：4/4 PASS；
- 同一 loader 直接运行 M2 Config：2/2 PASS；
- `tsc --noEmit -p packages/shared/tsconfig.json`：exit 0（作者环境全局 TypeScript 5.8.3，不替代锁定依赖下的正式 package gate）；
- `npm --prefix apps/web run typecheck`：exit 0；
- `npm --prefix apps/web run build`：exit 0；
- `git diff --check HEAD`：exit 0。

作者环境没有仓库依赖目录，API typecheck/build 因 Nest/Prisma/Node 类型缺失而不能形成有效产品门禁；Web M2 运行测试因 `jsdom` 未安装而未执行；真实 Prisma/PostgreSQL/Supabase 随机 Schema 门禁未执行。完整命令、退出码和原因以 Repair 2 Manifest 为准，不把语法检查或临时 loader 运行冒充 Codex 正式验收。

## 12. Repair 3：M1 Web 合同、receipt 原子性与 stage 聚合选择

Repair 3 继续以 `99585c7a3fe85321bf2f339baba8aa08f2b2be46 + accepted M1 Overlay` 为逻辑 preimage，只修正 M2，不包含 M3—M6。

### 12.1 M1 Web 合同完整保留

`apps/web/public/a-emotion-m1-ui.js` 将 M1 与 M2 校验边界分层：

- M1 使用已验收的 exact-key root / impact / response 校验；
- M1 固定验证 `RELATED / HIDDEN / MAJOR / CROSS_IMPACT`、固定标题、`来源未知`、三项固定 response code、数值算术与 ISO 时间；
- M1 递归禁止 source/actor/target/suspect/raw/dedupe/audience 字段，并扫描来源语义别名；
- legacy M1 Feed 保留 `data-testid="aemotion-m1-feed"`；
- legacy M1 CROSS_IMPACT 保留 `data-testid="aemotion-m1-cross-impact"`；
- legacy M1 点击、调查、公开质问和暂不回应仍为本地行为，不调用 M2 detail 或 receipt API。

M2 使用独立 exact-key 与 forbidden-key 集，只有 `CONFIRMED` 投影允许经过验证的 `visibleSourceRoleId / visibleSourceRoleKey / evidenceRefs`。

### 12.2 M2 detail 与 receipt fail-closed

M2 item 点击顺序为：

```text
读取生产 detail
→ 严格验证 Schema、eventId、aggregateId、stageId、sharedObjectId、eventFamily、projectionVersion、stateVersion、eventSequence、disclosure/category/card
→ 请求 ack
→ 严格验证 receipt 的 eventId、projectionVersion、ISO 时间与 seen≤ack≤resolved 状态顺序
→ 只有全部成功后才打开中央卡并更新本地 receipt
```

Detail 409、网络失败、stale projection、ack 409 或 receipt 内容不一致时，不打开卡片，也不修改 unread/ack/resolved。M2 DEFER 同样只有服务端返回有效 ack receipt 后才关闭卡片；M1 DEFER 继续保持本地、无消耗行为。

### 12.3 seen / ack / resolved 原子性

`ContinuousEventDeliveryService` 对同一内部 `aggregateKey` 的投影发布和 receipt 写入使用同一个 PostgreSQL transaction-scoped advisory lock。Receipt 路径使用 `READ COMMITTED` 事务，在等待锁之后重新读取目标 delivery 与 aggregate 最新投影，再执行 receipt 写入：

```text
读取目标 delivery 以取得 aggregateKey
→ 等待 aggregate advisory xact lock
→ 锁后重新读取目标 delivery
→ 查询同 viewer + aggregate 的最新 projection
→ 若目标已不是最新，409 STALE_INTERACTION_PROJECTION
→ 仅最新投影允许写 seen/ack/resolved
```

使用 `READ COMMITTED` 是必要边界：锁后每条语句获得新快照，能够看到等待期间已提交的新 projection；固定快照隔离级别会使锁后重读仍看不到并发升级。

真实 PostgreSQL 测试源码为 seen、ack、resolved 三条路径建立受控 barrier：升级事务先持有该 aggregate 的精确 advisory lock，receipt 请求进入同一精确 lock 的等待队列，再插入新 projection 并释放锁。测试断言旧 delivery 三个 receipt 字段均保持 `NULL`，且请求返回 `STALE_INTERACTION_PROJECTION`。Barrier 按 `hashtextextended(lockName, 0)` 对应的 `pg_locks.classid / objid / objsubid` 精确匹配，不接受任意无关 advisory waiter。

### 12.4 当前 stage 聚合身份

M2 queue 与 worker 都从 authoritative `stageIndex` 推导：

```text
stageId = stage-${stageIndex}
aggregate identity = roomId + runId + viewerRoleId + stageId + sharedObjectId + eventFamily
```

`latestAggregate` 必须同时匹配 `stageId + aggregateKey + aggregateId`。任务请求和持久 canonical upgrade 也携带相同身份；worker 根据 committed `ActionResolution.turn.stageIndex` 重算并逐项比较，任何不一致均 fail-closed 为 `A_EMOTION_M2_TASK_AGGREGATE_MISMATCH`。

新增测试覆盖：旧 stage 拥有更高 projectionVersion、当前 stage 版本较低时，服务仍只选择当前 stage；以及 task stage/aggregate 与 committed resolution stage 不一致时 worker 拒绝。

### 12.5 Repair 3 作者侧实际检查

已实际运行：

- Shared M1 focused schema test：3/3 PASS；
- Shared M2 focused schema test：4/4 PASS；
- `tsc --noEmit -p packages/shared/tsconfig.json`：exit 0；
- `npm --prefix apps/web run typecheck`：exit 0；
- `npm --prefix apps/web run build`：exit 0；
- 修改后的 Web JS/MJS `node --check`：exit 0；
- 修改 API TypeScript 文件 parser/transpile syntax diagnostics：0；
- `git diff --check`：PASS；
- M3—M6 主动实现符号扫描：0；
- high-confidence credential scan：0。

Shared focused tests通过作者临时 TypeScript ESM loader直接运行源码；它们不冒充锁文件依赖下的正式 pnpm gate。

未运行并不得视为通过：

- API 正式 typecheck/build/test（作者目录缺少锁定 Nest/Prisma/Node 依赖与生成的 Prisma Client）；
- Web M1/M2 jsdom runtime tests（作者目录未安装 jsdom）；
- 隔离 PostgreSQL/Supabase 随机 Schema 测试（未配置测试数据库与 Prisma Client）；
- Generic Endgame S1—S4 package gate（逻辑 preimage 保留脚本，但作者合成目录不含远程并发新增的完整 Generic Endgame 源文件）。

完整命令、退出码、文件哈希与 NOT_RUN 原因以 Repair 3 Manifest 为准。没有声明 Codex 独立通过、远程提交、部署或真实 Supabase migration。

## 13. Repair 4：真实基线、游标、M1 兼容、跨 Run 与 Owner UI 权限

Repair 4 的 Patch preimage 不再使用预合并 Generic 脚本的 synthetic base，而是严格使用：

```text
99585c7a3fe85321bf2f339baba8aa08f2b2be46
+ accepted M1 Overlay
  a2c822e8822b8cee426f544123ad3692093bfe03d4bf5252e7a00e1b14739709
```

因此 `packages/shared/package.json` 的 preimage 是已验收 M1 文件，Generic Endgame S1–S4 门禁脚本在 Repair 4 的真实 diff 中显式恢复，并与 `test:a-emotion-m1`、`test:a-emotion-m2` 共存。

### 13.1 Zero-row cursor fail-closed

`ContinuousEventDeliveryService.interactionFeed` 在任何 `rows.length === 0` 返回之前完成：

1. cursor 格式验证；
2. 已认证 room/member/role 边界；
3. 有 cursor 但当前 viewer 无聚合行时，返回 `STALE_OR_SCOPED_INTERACTION_CURSOR`。

这防止将另一 viewer、另一 room/run 或已经失效的 opaque cursor 用在零行 viewer 上并被误判为“空 Feed”。真实 PostgreSQL 测试继续使用 county viewer 的零行场景验证跨 viewer cursor 被拒绝，并新增 malformed cursor 拒绝。

### 13.2 M1 idempotency error code compatibility

M1 与 M2 canonical publication 共用 `publishProjected`，但结构化冲突码分阶段保持稳定：

```text
M1 -> A_EMOTION_M1_IDEMPOTENCY_CONFLICT
M2 -> A_EMOTION_M2_IDEMPOTENCY_CONFLICT
```

用户 message 仍是普通描述，不嵌入机器码。真实 Prisma/PostgreSQL 测试对 M1 冲突重放检查 StoryEvent、EventDelivery 与两个 cursor 均不前进。

### 13.3 Durable receipt idempotency

Service 与生产 HTTP 测试分别对 `seen`、`ack`、`resolved` 做独立重复调用，断言：

- 返回 eventId/projectionVersion 不变；
- 已经写入的 seenAt/acknowledgedAt/resolvedAt 不变化；
- 每一层时间单调；
- 重复请求不产生额外事件、delivery 或 cursor 变化。

### 13.4 Cross-run HTTP fail-closed

HTTP fixture 在 `otherRunId` 中建立同一已认证 user 的真实 active human membership，但不复制源 run 的 interaction event。随后真实调用生产：

```text
GET  /v4/rooms/:otherRunId/events/:eventId
POST /v4/rooms/:otherRunId/events/:eventId/seen
POST /v4/rooms/:otherRunId/events/:eventId/ack
POST /v4/rooms/:otherRunId/events/:eventId/resolved
```

四条路径都必须返回 404，证明一个 run 的 opaque eventId 不能跨 run 重放。

### 13.5 Refresh/reconnect cursor transport

真实 UI 请求在持有并验证 `m2c_...` cursor 时，将其作为 `interactionCursor` 发给生产 `/events`。响应按 `eventId + projectionVersion` 去重，并进一步按 aggregateId 只保留最高 projectionVersion，防止 refresh/reconnect 重复 Feed 行。

### 13.6 Owner UI approval scope

本轮遵守用户最新明确 UI 边界：

```text
唯一预批准主页面可见改动：
右栏新增标题精确为“世界局势”的模块。
```

Repair 4 因此：

- Feed、来源状态、详情与合法回应入口全部位于右栏“世界局势”；
- 保留 legacy selector `data-testid="aemotion-m1-feed"`；
- M1 CROSS_IMPACT 详情的 selector 保留，但详情位于右栏；
- 不向 `.causal-center` 插入 A-Emotion 卡；
- 不向顶部指标添加 A-Emotion metric hint；
- 不改变中央剧情/决策、顶部指标、四个主按钮、工作区字段、其他右栏模块或整体布局；
- 当前不存在需要进入 Overlay 的未批准 UI 差异。

## 14. Repair 4 作者环境声明

Repair 4 作者侧仅声明实际执行的静态检查；不冒充 Codex 或数据库验收。正式 Shared/API/Web typecheck、M1/M2 测试、API/Web build、Generic Endgame 201/201 与隔离 PostgreSQL/Supabase 随机 Schema 门禁仍必须由 Codex 在完整仓库依赖环境执行。

## Repair 5：interactionCursor 错误优先级与稳定序列化

Codex 在真实非生产 Supabase 随机 Schema 上验证 M1 为 10/10、M2 为 12/13，唯一失败是：客户端携带旧 `interactionCursor` 时，普通 delivery 序列化先检测到 boundary row 的 projection metadata 被升级，返回 `A_EMOTION_M2_STATE_VERSION_MISMATCH`，而冻结合同要求 cursor 自身的 viewer/room/run/role/version 边界优先 fail-closed 为 `STALE_OR_SCOPED_INTERACTION_CURSOR`。

Repair 5 保持普通无 cursor 请求的 state/projection 一致性检查不变，只调整带 cursor 请求的验证顺序：

1. 查询当前 viewer 的 interaction rows；
2. 校验 opaque cursor 格式；
3. 在任何普通 delivery 映射前，用当前 raw aggregate identity、eventSequence、projectionVersion 验证 cursor；
4. 若 boundary 已被升级、跨 viewer/room/run/role 或不是该 aggregate 最新投影，稳定返回 HTTP 409 / `STALE_OR_SCOPED_INTERACTION_CURSOR`；
5. cursor 当前且合法后，再执行原有严格 projection/state/canonical metadata 校验，真实损坏仍返回 503，不被吞掉。

新增正式测试覆盖：

- 真实 Prisma/Supabase service test：篡改 cursor boundary projectionVersion 后，严格断言 Nest 结构化 response `code=STALE_OR_SCOPED_INTERACTION_CURSOR`、status 409；
- 真实生产 `AuthGuard → RoomsController.events → RoomsService.events → ContinuousEventDeliveryService.page` HTTP test：生产 controller 序列化稳定返回 HTTP 409 和同一 code；
- 原有 zero-row cursor、跨 viewer/room/run/role、seen/ack/resolved advisory-lock 原子性、M1 public idempotency code 与普通 503 数据一致性检查均保留。

本报告仅记录源码作者修复与 Codex 提供的真实非生产 Supabase发现；本 Artifact 环境未连接 Supabase，未声称 Repair 5 runtime PASS。


## 99585c7 精确远程基线重放说明

- `baseRemoteSha`: `99585c7a3fe85321bf2f339baba8aa08f2b2be46`
- `baseRemoteTreeSha`: `a765918caf2c0eecdb79249d45ed0a6873b237af`
- 本阶段逻辑父提交：`ddd595a850a7d7428800bdc4aa4b7b62739b894a`
- 已保留 23cd 之后的 Generic Endgame S6、最终故事文本生成、四轮验收和 OpenNovel 终局叙事改动。
- 远程并发重叠的 `package.json`、`apps/web/package.json`、`packages/shared/package.json` 均采用脚本级语义合并；未覆盖 Endgame/OpenNovel 既有门禁。
- 本报告中的运行门禁仅区分原候选作者检查与 Codex 历史证据；本次 99585c7 重放没有冒充新的 Codex 或真实 Supabase 验收。
- UI owner scope：`/game` 唯一新增常驻可见区域仍为右栏标题精确为“世界局势”的模块；只允许文档批准的关键模态。
