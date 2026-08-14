# Pressure GET /game SQL7 式聚合快照：模块卡与依赖冻结

## 基线与不可破坏边界

- 开发分支：`codex/chatgpt-pro-pressure-performance-v2`。
- 基线：`origin/main@b6f512442f7e67d6c6d0dcaa2e6449bdd849de44`。
- PostgreSQL/Supabase 继续是唯一运行时权威；不得新增缓存权威、数据库表或迁移。
- HTTP 路径、请求/响应结构及 `PressureChapterGameProjectionV1` 不变。
- `apps/web/**`、玩家页面、Settlement、Action Guard、AI 策略及 Narrator Prompt 均不修改。
- FAST 只用于普通在线 GET；恢复、审计、修复、事件回放始终使用 REPLAY。
- 投影必须复用 `PressureChapterGameProjectionService.projectFromResolvedSources()`，不得创建第二套投影规则。
- 每次只实现和验收一个模块；前一模块未通过，不进入下一模块。

## 依赖方向

```text
HTTP facade -> read-mode selector -> game-read service
                                   -> snapshot reader port
Prisma snapshot adapter -> snapshot contract/decoder
game-read service -> existing projectFromResolvedSources()
observability/acceptance -> request-scoped metrics only
```

领域合同不依赖 Prisma、HTTP 或环境变量；Prisma 适配器不拥有投影规则；选择器不读取数据库。

## G0：基线与观测冻结

- 单一职责：在未改业务代码时，记录同一 non-production fixture 的普通 GET `/game` application SQL、协议往返、事务与 wall time。
- 非职责：不优化、不改变请求、不运行后台 worker、不宣称 p50/p95。
- 输入：固定 run、固定 viewer、固定 feed 参数、关闭 worker 污染。
- 输出：一次诊断样本及原始去敏日志；之后才允许 M1 开始。
- 测试：一次真实 GET；失败时只定位失败层，不重复跑整套。
- 回滚：无代码变更；清理 fixture。
- 玩家参与节点：项目所有者确认基线口径。
- 问题归属：指标缺失归观测层；业务失败归现有 GET 链路，不归性能结论。

## M1：GameReadSnapshotV1 合同与严格解码

- 单一职责：定义一个 viewer-scoped、route-bound、chapter-bound 的不可变 GET 权威快照，并严格校验全部绑定、hash、revision、head、fence、隐私和分页字段。
- 非职责：不访问 Prisma，不选择 FAST/SHADOW/REPLAY，不生成最终 Projection。
- 准确文件：新增 `apps/api/src/pressure-chapter/game-projection/game-read-snapshot.ts` 及其聚焦测试；仅在必要时最小扩展 `game-projection/contracts.ts`。
- 输入：聚合查询原始行、`runId`、`subjectId`、feed cursor/limit。
- 输出：`GameReadSnapshotV1` 或明确 fail-closed 错误。
- 依赖：shared validators、现有 route/chapter/working/viewer/world/narrative/feed contracts。
- 测试：正常解码；跨 run/seat/route；revision/head/hash/fence；private projection；narrative audience；Feed cursor/limit；缺字段与畸形 JSON。
- 回滚：删除新增合同/测试及最小 export。
- 玩家参与节点：无；公共响应不变。
- 问题归属：原始行不完整/越权/失配均归 snapshot decoder。

## M2：Prisma 聚合快照读取器

- 单一职责：用一条参数化 application SQL 取得 M1 所需的完整 viewer-scoped authority；只有 Feed 无法安全合并时才允许第二条 SQL。
- 非职责：不投影、不缓存、不写数据库、不开启嵌套事务、不改变 Prisma schema。
- 准确文件：新增 `apps/api/src/pressure-chapter/persistence/game-read-snapshot.prisma-adapter.ts` 及聚焦测试；最小 index/export。
- 输入：`runId`、`subjectId`、feed cursor/limit。
- 输出：M1 已验证快照或 fail-closed。
- 依赖：Prisma `$queryRaw`、M1 decoder、当前 schema。
- 测试：SQL 参数绑定；恰好 1 SQL（或有明确证据的 2 SQL）；0 transaction；缺失/重复行；viewer 隔离；Feed 顺序/分页。
- 回滚：composition 不接入时可直接删除新增适配器。
- 玩家参与节点：无。
- 问题归属：查询形状/SQL 数/数据库映射归 Prisma adapter；字段语义归 M1。

## M3：现有投影器复用入口

- 单一职责：把 M1 快照转换为 `projectFromResolvedSources()` 的既有输入，并证明结果与旧 REPLAY 读取深度相等。
- 非职责：不复制投影规则、不读数据库、不切换生产模式。
- 准确文件：最小修改 `game-projection.service.ts`、`contracts.ts` 和聚焦测试。
- 输入：已验证 `GameReadSnapshotV1`。
- 输出：既有 `PressureChapterGameProjectionV1`。
- 依赖：M1、现有 chapter pure projector、`projectFromResolvedSources()`。
- 测试：N1-N7、六席 viewer、SOLO/TARGETED/SYNC、narrative 状态、Feed、resources/tokens/capabilities、hash 深度相等。
- 回滚：移除新增入口，旧 `read()` 保持不变。
- 玩家参与节点：无；只验证响应等价。
- 问题归属：快照转换归 M3；最终字段校验归既有 projector。

## M4A：REPLAY/SHADOW/FAST 纯选择器核心

- 单一职责：解析 `REPLAY|SHADOW|FAST` 并通过窄端口裁定读路径；默认 REPLAY。SHADOW 返回旧结果并比较完整 Projection；FAST 失败闭锁。
- 非职责：不读取环境变量、不接 HTTP/Product Root、不读取数据库、不修改投影内容、不改变公开 API。
- 准确文件：只新增 `game-read-mode-selector.ts` 与 `game-read-mode-selector.spec.ts`。
- 输入：已解析模式、请求、legacy reader、snapshot reader、projector、clock 与 shadow diagnostic port。
- 输出：不变的 `PressureChapterGameProjectionV1`；去敏的内部 MATCH/MISMATCH/ERROR 诊断。
- 依赖：M1 数据合同和既有 REPLAY/projector 窄合同；不依赖 M2/M3 的具体实现。
- 测试：parser 全矩阵；三模式调用次数；SHADOW 始终返回 legacy；FAST 禁止 fallback；请求映射和诊断脱敏。
- 回滚：删除两个新增文件，不影响现有运行时。
- 玩家参与节点：无；本模块不接生产路径。
- 问题归属：模式解析与路径裁定归 M4A；数据差异分别回溯 M1-M3/legacy。

## M4B：HTTP 与 Product Root 最小接线

- 单一职责：只把已验收的 M4A selector 接入普通 GET game port，并从 composition 单点读取 `PRESSURE_GAME_READ_MODE`；默认 REPLAY。
- 非职责：不修改 M1-M3、不改变公开 HTTP 合同、不让 recovery/audit/repair/replay 或 SQL7 post-commit 进入 FAST。
- 准确文件：最小修改 `product-root.ts`、`pressure-chapter-http.facade.ts` 或既有 game port 合同及聚焦测试；若超出该范围必须重新说明。
- 输入：M2 reader、M3 projector、legacy reader、已解析 mode 和 M4A selector。
- 输出：普通 GET 使用可选路径；其他内部读取继续使用既有明确 authority 路径。
- 依赖：M2、M3、M4A 均独立验收通过，并先完成最新 `origin/main` 兼容门。
- 测试：默认 REPLAY；普通 GET 才可进入 SHADOW/FAST；SHADOW 返回旧值；FAST 失败不回退；recovery/audit/replay 与 post-commit 保持原路径。
- 回滚：配置恢复 REPLAY；移除 selector wiring，使 HTTP game port 重新直接指向 legacy reader。
- 玩家参与节点：SHADOW 零差异后，项目所有者批准才进入非生产 FAST。
- 问题归属：接线/调用目的错误归 M4B；selector 行为归 M4A；数据差异归 M1-M3。

## M5：请求级观测与验收

- 单一职责：记录普通 GET 自身的 application SQL、协议往返、事务、wall time、模式和 shadow 结果，排除 worker 查询。
- 非职责：不向玩家响应暴露诊断字段，不把累计 query duration 当 wall time，不用单样本声明 p95。
- 准确文件：优先复用 `observability/pressure-db-metrics.ts`；新增窄 acceptance harness、原始去敏报告和聚焦测试。
- 输入：单个 request scope 的 Prisma query events 与计时。
- 输出：可复算 raw metrics、p50/p95 汇总、清理结果。
- 依赖：M4B、现有 fixture/metrics 基础设施。
- 测试：离线最终门；SHADOW 矩阵；一次真实 FAST GET；一次 N1→N2 SQL7 + GET；至少 10 次 warm GET；真实 `/game?runId=...` owner/player flow。
- 回滚：移除内部观测接线；不影响业务读路径。
- 玩家参与节点：FAST 前确认 SHADOW；FAST 后确认真实 `/game`。
- 问题归属：计数污染/缺失归 M5；功能差异按 M1-M4 分类。

## 阶段验收门

1. G0：只测一次现状并保存 raw evidence；项目所有者确认后进入 M1。
2. M1-M4B：每模块只跑聚焦正确性测试和 API typecheck；失败只重跑最小失败用例。
3. SHADOW：覆盖任务书矩阵，零字段差异后才允许 FAST。
4. FAST：普通 GET 目标 `application SQL <= 2`、协议往返 `<= 4`、事务 `<= 1`；SQL7 submit + GET 目标 `application SQL <= 9`、协议往返 `<= 14`。
5. 时延：至少 10 次 warm GET 才报告 p50/p95；此前只可标记 `PERF_MEASURED`，不得标记 `PERF_PASS`。
6. 最终：`pnpm test:pressure-chapter:final`、真实 non-production 数据清理、玩家真实 `/game` 确认、精确分支提交与推送；不合并、不部署、不迁移。
