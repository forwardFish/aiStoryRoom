# ChatGPT Pro 普通 Chat 开发任务书草案：M2 Prisma 聚合快照读取器

> 状态：`DRAFT / DO_NOT_SEND_BEFORE_M1_ACCEPTED`。本文件仅供 Codex 预备；M1 未独立验收通过前不得发送、实施或进入 M2 验收。

## 背景与单一目标

Pressure 普通 `GET /api/v4/rooms/:roomId/game` 后续 FAST 路径需要从 PostgreSQL 一次取得 M1 `GameReadSnapshotRawRowV1` 所需的完整 viewer-scoped 权威数据。本模块只实现 Prisma 读取适配器：执行一条参数化、只读的 application SQL，把结果交给既有 `decodeGameReadSnapshotV1()`；不生成最终 Projection，不接 HTTP，不选择 REPLAY/SHADOW/FAST。

必须实际阅读届时上传的完整脱敏源码并交付真实代码工件；只给方案、伪代码或口头说明不算交付。

## 发送前由 Codex 补齐的输入基线

- 仓库：`aiStoryRoom`。
- 远程 Git 基线：`origin/main@b6f512442f7e67d6c6d0dcaa2e6449bdd849de44`。
- 目标专用分支：`codex/chatgpt-pro-pressure-performance-v2`。
- M1 状态：`<M1_ACCEPTANCE_STATUS>`。
- M1 三个 filtered blob SHA-256：`<M1_BLOB_HASHES>`。
- M2 源码 ZIP：`<M2_SOURCE_ZIP_NAME>`。
- ZIP 大小：`<M2_SOURCE_ZIP_SIZE>`。
- ZIP SHA-256：`<M2_SOURCE_ZIP_SHA256>`。

如果 M1 未标记为 `M1_ACCEPTED`，请停止，不得开始 M2。

## 当前架构与唯一权威

- PostgreSQL/Supabase 继续是唯一运行时权威；不得引入内存缓存权威、本地数据库、第二份状态或预计算表。
- M1 `GameReadSnapshotRawRowV1` 和 `decodeGameReadSnapshotV1()` 是本模块唯一允许输出的合同和解码入口。
- 最终 Projection 仍只能由既有 `PressureChapterGameProjectionService.projectFromResolvedSources()` 生成；M2 不得复制或调用投影业务规则。
- Feed 排序、cursor、分页、flags、unread、serverSequence 继续由 `projectAEmotionFeedPageV1()` 唯一裁定。SQL 只取得精确的 aggregate/delivery 权威行，不得实现第二套 Feed 规则。
- route、membership、seat/private projection、chapter/orchestrator/descriptor/working cache、world、narrative、A-Emotion/Feed 的字段语义和 hash/revision/fence 校验归 M1 及既有领域 validator；M2 只负责查询形状、参数绑定和原始字段映射。
- 可借鉴现有 `sql7-fast-path/prisma-snapshot.ts` 的“一条 `Prisma.sql` + `$queryRaw`、不打开事务、返回后严格解码”模式，但不得把 N1 提交快照的业务假设复制进 GET reader。

## 本模块职责

实现一个窄的 reader port/adapter，输入：

- `roomId`；
- `runId`；
- `subjectId`；
- `feedCursor`；
- `feedLimit`；
- request-scoped `capturedAtMs`（若 M1 最终合同要求由调用方传入）。

适配器必须：

1. 在访问 Prisma 前验证基础请求绑定，至少保证 `roomId === runId`、非空 `subjectId`、合法 cursor/limit 形状；完整语义仍交给 M1。
2. 使用 `Prisma.sql` 参数插值和 `$queryRaw`，禁止字符串拼接、`$queryRawUnsafe` 或动态表/列名。
3. 正常路径只执行 **1 条 application SQL**，不开启 Prisma transaction，不写数据库。
4. SQL 返回恰好一条 `GameReadSnapshotRawRowV1` 聚合行；零行或多行必须按 M1/adapter 合同 fail-closed，不得静默拼接。
5. 聚合行必须完整提供 M1 当前字段：`routeRecord`、`membershipRows`、`seatAuthority`、`viewerPrivateProjection`、`viewerSource`、`chapterAuthority`、`worldAuthority`、`narrativeAuthority`、`feedAuthority`、`capturedAtMs`，以及 M1 v4 最终合同新增或调整的字段。
6. 所有子查询必须同时绑定请求中的 run/room/viewer；不得先读取全局数据再在 TypeScript 中按 viewer 过滤。
7. membership 必须只允许当前 run 中当前 `subjectId` 的活动 human viewer，并保留让 M1 识别缺失/重复/跨 seat 的原始证据。
8. 私人投影、resources/tokens/situation、narrative audience 和 Feed delivery 必须按当前 viewer 绑定；不得读取或返回其他席位的私人字段。
9. Feed SQL 只返回 M1 调用 `projectAEmotionFeedPageV1()` 所需的精确 aggregate/delivery rows。可以使用稳定的 JSON 聚合顺序保证可复现，但不得在 SQL 中重写 priority/cursor/page/flags/unread 规则。
10. 查询结果立即交给 `decodeGameReadSnapshotV1(rawRows, request)`；adapter 不补默认值、不修复畸形 JSON、不重算 hash、不推导 capability。

## 明确非职责

- 不修改或接入 HTTP facade、controller、route、公开请求/响应合同。
- 不修改 `PressureChapterGameProjectionService`，不生成 `PressureChapterGameProjectionV1`。
- 不实现或读取 `PRESSURE_GAME_READ_MODE`，不进入 REPLAY/SHADOW/FAST selector。
- 不增加缓存、重试、事务、锁、后台 worker 或写入逻辑。
- 不修改 Prisma schema、migration、数据库表/列/索引。
- 不修改 Settlement、Action Guard、AI 策略、Narrator、Provider、Prompt。
- 不修改 `apps/web/**` 或任何玩家可见页面、文案、路由和数据合同。
- 不修复 `SANGTIAN_ACTION_RELEASE_ARTIFACT_HASH_MISMATCH`；它仍是范围外启动阻塞。
- 不访问真实 Supabase，不重复运行真实 fixture。
- 不 commit、push、创建 PR、部署或迁移。

## 允许修改

- 新增 `apps/api/src/pressure-chapter/persistence/game-read-snapshot.prisma-adapter.ts`。
- 新增 `apps/api/src/pressure-chapter/persistence/game-read-snapshot.prisma-adapter.spec.ts`。
- 仅在编译必需时最小修改 `apps/api/src/pressure-chapter/persistence/index.ts`。

预期无需修改 M1 文件。若发现 M1 合同必须改变，或实现必须越过上述文件、公共合同、数据库、路由、权威链或三个以上既有模块，请停止并报告，不得自行扩展。

## 设计约束

- adapter 依赖方向只能是 Prisma/current schema -> M2 -> M1 decoder；M1 不得反向依赖 Prisma。
- Prisma client 以窄接口注入，便于测试真实 query call 次数；不得把整个 ProductRoot/HTTP service 注入 adapter。
- SQL 参数必须由 `Prisma.sql` 值插值绑定。禁止 `Prisma.raw()` 注入请求值。
- 除数据库列名到 M1 raw 字段的机械映射外，M2 不拥有领域枚举、hash 规则、排序规则、权限规则或 fallback。
- 正常缺失、重复或越权数据必须能由 adapter/M1 明确归属并 fail-closed；不得把错误 SQL、凭据、完整私人 payload 写入错误信息。
- 不使用 `as unknown as`、宽泛 `any`、TypeScript suppression 或 `eslint-disable` 掩盖不完整映射。
- production adapter 中只允许一次 `$queryRaw`；不得通过 helper 隐藏第二次查询。
- 如果证明 Feed 无法安全并入同一 SQL，必须先停止并提供数据库/schema/一致性证据；未经 Codex 重新批准，不得自行改成 2 SQL。

## 必须测试

只运行 M2 最小测试、M1 聚焦测试和 API typecheck；不运行真实数据库或完整 E2E。

1. 基础输入非法时在访问 Prisma 前失败，query count 为 0。
2. 正常 fixture 恰好调用一次 `$queryRaw`、0 transaction、0 write，并把返回行交给真实 `decodeGameReadSnapshotV1()`。
3. `$queryRaw` 接收 `Prisma.Sql` 参数化对象；请求值不得通过字符串拼接或 `$queryRawUnsafe` 进入 SQL。
4. SQL 源码静态检查只有一个 `$queryRaw`，不存在 `$transaction`、create/update/delete/upsert/write delegate。
5. 零聚合行、多聚合行、缺失 authority、重复 membership 必须 fail-closed，且只发生一次 query。
6. 改变 `runId`、`roomId`、`subjectId` 或 seat membership 后，不能返回原 viewer 的快照。
7. private projection、viewerSource、narrative audience、Feed delivery 的跨 viewer/cross-run fixture 必须被 M1 拒绝。
8. Feed fixture 证明 SQL 没有承担最终排序/分页规则：adapter 原始 aggregate/delivery rows 交给 M1 后，与直接调用既有 `projectAEmotionFeedPageV1()` 的结果一致。
9. M1 v4 聚焦测试继续通过。
10. `pnpm --filter @apps/api typecheck` 通过。
11. `git diff --check` 通过。

测试必须一次运行并报告首次结果；失败后先分类到输入、SQL/映射、M1 decoder 或环境，只重跑最小失败用例，不能反复跑整套。

## 必须交付

生成一个可下载 ZIP，包含：

- `changed-files/`：M2 所有新增/修改文件，保留仓库相对路径；
- `changes.patch`：相对届时上传的**精确 M1 accepted 输入树**的 unified diff，只含 M2；
- `manifest.json`：每个文件路径、大小、SHA-256，输入 ZIP 名称/大小/SHA-256、M1 filtered blob hashes；
- `report.md`：SQL 结构、参数绑定、viewer 隔离、M1 decoder 复用、query budget、实际命令和首次结果、`TESTS_NOT_RUN`、风险与回滚。

ZIP 不得包含 `.git`、`node_modules`、`.env*`、key/token/cookie/password/connection string、构建产物、运行日志、数据库内容或浏览器状态。

## 禁止声称

- fake Prisma 的一次调用只能证明 adapter query budget 合同，不能冒充真实 PostgreSQL/Supabase 的 SQL/往返/事务计数。
- 未实际运行的测试必须标记 `TESTS_NOT_RUN`。
- M2 通过不等于 M3-M5、SHADOW、FAST、功能等价、真实 SQL 预算、warm p50/p95、玩家页面或整体性能 PASS。
- 不得声称修复了主线启动哈希阻塞。

## M2 验收标准

- 修改范围严格在允许文件内。
- 一条参数化、只读 application SQL；0 transaction、0 write。
- 所有 request/run/room/viewer 私有权威在 SQL 层绑定，M1 继续负责字段语义和 fail-closed 解码。
- 未产生第二套 Feed、Projection、capability、权限或 hash 规则。
- 聚焦测试、M1 回归、API typecheck 和 `git diff --check` 通过。
- Codex 能在精确 M1 accepted 输入树上机械应用 patch，逐文件匹配工件并独立复现测试。

## 回滚

在 M3/M4 未接入时，删除新增 adapter/spec 和最小 export 即可；旧 GET 路径、公开响应和玩家页面完全不受影响。
