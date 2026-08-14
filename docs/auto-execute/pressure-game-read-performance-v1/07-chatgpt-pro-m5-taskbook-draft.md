# ChatGPT Pro 普通 Chat 开发任务书草案：M5 请求观测与最终验收工具

> 状态：`DRAFT / M5B_DO_NOT_SEND_BEFORE_M4_ACCEPTED`。为满足 6 小时并行窗口，纯合同、纯统计和 evidence 构造已拆为独立 M5A（见 `21-chatgpt-pro-m5a-pure-observation-taskbook.md`）；本文件剩余的 request-scope/HTTP/selector/ProductRoot 接线属于 M5B，仍须等待 M4 接受。真实 Supabase、SHADOW、FAST 和玩家页面验收只能由 Codex 在既定非生产授权与玩家参与门下执行，Pro 不得自行访问。

## 背景与单一目标

M1-M4 完成后，需要用可信、可复算且不污染玩家响应的 request-scoped 证据回答两个问题：

1. 普通 GET 的 application SQL、协议往返和事务是否显著下降并满足预算；
2. 在功能完全一致的前提下，真实 wall time 和 warm p50/p95 是否改善。

M5 只补齐请求级观测、SHADOW/FAST acceptance harness 和证据汇总。它不能改变游戏规则、快照、SQL、Projector、selector 或页面。请实际阅读届时上传的脱敏源码并交付真实代码工件；只给方案、伪代码或口头说明不算交付。

## 发送前由 Codex 补齐的输入基线

- 仓库：`aiStoryRoom`。
- 远程 Git 基线：`origin/main@b6f512442f7e67d6c6d0dcaa2e6449bdd849de44`。
- 目标专用分支：`codex/chatgpt-pro-pressure-performance-v2`。
- M1-M4 独立验收状态及 filtered blob hashes：`<M1_M2_M3_M4_ACCEPTED_EVIDENCE>`。
- M5 源码 ZIP：`<M5_SOURCE_ZIP_NAME>`。
- ZIP 大小：`<M5_SOURCE_ZIP_SIZE>`。
- ZIP SHA-256：`<M5_SOURCE_ZIP_SHA256>`。

如果任一前置模块未标记为独立 `ACCEPTED`，请停止，不得开始 M5。

## 当前观测权威

- `PrismaService` 已通过 Prisma query event 调用 `recordPressureDbQueryV1(query, duration)`。
- `observability/pressure-db-metrics.ts` 已使用 `AsyncLocalStorage` 隔离 request scope，并分别记录：
  - `applicationSqlStatementCount`；
  - `databaseProtocolRoundtripCountIncludingBeginCommit`；
  - transaction attempt/commit/rollback/retry；
  - `queryDurationMs`；
  - 去敏 `queryHashes`。
- `pressureHttpBoundary()` 已用 `withPressureDbRequestMetricsV1()` 包裹 Pressure HTTP 请求，但当前普通 GET 的 mode、shadow status、HTTP wall time 和可持久化 acceptance sink 仍需收口。
- application SQL 定义必须保持：`BEGIN|COMMIT|ROLLBACK|SET TRANSACTION...` 不计入 application SQL，但必须计入协议往返；所有业务 `SELECT|INSERT|UPDATE|DELETE` 都计入。
- `queryDurationMs` 是 Prisma 事件累计数据库耗时，不是 HTTP wall time；两者必须分别报告。

## 本模块职责

1. 定义一个窄、内部、request-scoped 的普通 GET 观测快照，至少包含：
   - correlation/request id 的非敏感摘要；
   - `mode: REPLAY|SHADOW|FAST`；
   - `shadowStatus: NOT_RUN|MATCH|MISMATCH|ERROR`；
   - HTTP operation success/failure category；
   - `wallTimeMs`；
   - 完整 `PressureDbRequestMetricsV1`；
   - 不含 SQL text 的 query hashes；
   - started/finished timestamp 或 duration 所需的可测试 clock 数据。
2. 在现有 `pressureHttpBoundary()` request scope 内完成计时和 metrics capture；不得二次嵌套导致 Prisma query event 归到错误 scope。
3. 通过窄 observer/sink 把观测交给 acceptance harness；默认 production sink 必须为 no-op 或现有内部日志边界，不能写业务数据库、不能修改玩家响应。
4. 与 M4 selector 的 shadow diagnostic 通过窄合同关联；不得通过全局 mutable map 猜测请求，也不得把完整 Projection/私人 payload 写入证据。
5. 提供离线汇总纯函数：从原始样本计算 count、min/max、p50、p95，明确 percentile 算法和排序；输入样本不足时不得生成伪 p95 PASS。
6. 提供 acceptance harness/脚本入口，能够在 Codex 提供的固定 non-production fixture 下执行单个 REPLAY/SHADOW/FAST 请求并写出脱敏 JSON 证据；真实运行由 Codex 完成。
7. harness 必须记录环境/场景固定项：endpoint、run/viewer/seat 的去敏标识、章节、participant/decision mode、feed cursor/limit、Supabase region、连接池配置摘要、worker ownership、代码 branch/SHA、模式和样本序号。
8. harness 必须有显式清理步骤和清理结果；失败样本也要保留 error category、SQL/roundtrip/transaction、wall time 和 cleanup status。

## 明确非职责

- 不修改 M1 decoder、M2 SQL、M3 Projector 或 M4 selector 的业务行为。
- 不新增数据库表、migration、持久化日志表、缓存或 worker。
- 不修改公开 endpoint/request/response/status code，不向玩家返回 metrics、hash、mode、SQL 或内部错误码。
- 不修改前端轮询、SSE、页面、文案、导航或 `apps/web/**`。
- 不修改 Settlement、Action Guard、AI 策略、Narrator、Provider、Prompt。
- 不把 query duration 当 wall time，不把 mock/static count 当真实数据库证据。
- 不访问真实 Supabase、不运行 SHADOW/FAST/浏览器、不修改 `.env`。
- 不 commit、push、创建 PR、部署或迁移。

## 允许修改

- 优先复用并最小扩展：
  - `apps/api/src/pressure-chapter/observability/pressure-db-metrics.ts`；
  - `apps/api/src/pressure-chapter/observability/pressure-db-metrics.spec.ts`。
- 新增窄的 GET 观测合同/汇总及聚焦测试，优先置于 `apps/api/src/pressure-chapter/observability/`。
- 为在同一 request scope 内输出观测，必要时最小修改：
  - `apps/api/src/pressure-chapter/http/errors.ts`；
  - 对应 HTTP boundary/facade 聚焦测试；
  - M4 selector 的 observer 接线文件；
  - `apps/api/src/pressure-chapter/product/product-root.ts` 的 no-op/acceptance sink 注入。
- 新增独立 acceptance harness/脚本及 README，优先使用仓库现有 `scripts/` 或 `apps/api/scripts/` 约定。
- 新增本任务的脱敏报告模板到 `docs/auto-execute/pressure-game-read-performance-v1/`。

如果需要修改公开 controller、M1-M4 权威合同、Prisma schema/migration、业务表或玩家页面，请停止并报告。

## 设计约束

- request scope 必须由现有 AsyncLocalStorage 权威承载；并发请求不得串计数。
- detached Prisma query event 只能在可证明唯一 request scope 时归属；并发不明确时必须不归属并显式报告污染/缺失风险，不能猜测。
- 观测 sink 必须窄、单向、失败不改变业务响应；sink error 应隔离并记录为 observability failure。
- SQL text 在进入报告前必须只保留 SHA-256；不得保存参数、连接串、私人 payload 或 Provider output。
- wall time 使用 monotonic clock（如 `performance.now()` 的注入边界），不能用累计 query duration替代。
- percentile 汇总必须是纯函数、确定性、可测试；报告样本数和算法。
- 生产代码不应硬编码性能阈值来改变业务结果；预算判定归 acceptance harness/report。
- 不使用 `as unknown as`、宽泛 `any`、TypeScript suppression、全局 mutable request registry 或 hidden retry loop。

## 必须测试

只运行 M5 聚焦测试、M1-M4 回归、HTTP/product composition 测试和 API typecheck；真实环境步骤全部标记 `TESTS_NOT_RUN` 交给 Codex。

1. 单请求：application SQL、协议往返、事务、query duration、query hashes 和 wall time 全部记录，定义正确。
2. transaction control SQL 不计 application SQL但计 roundtrip；业务 SELECT/INSERT/UPDATE/DELETE 均计 application SQL。
3. 并发 request scope 隔离；一个请求的 query/shadow/mode 不得进入另一个请求。
4. operation 成功、业务错误、candidate 错误、observer/sink 错误都能完成 metrics snapshot；观测失败不替换原业务结果/错误。
5. REPLAY/SHADOW/FAST mode 和 `NOT_RUN/MATCH/MISMATCH/ERROR` 准确关联。
6. 玩家响应对象与未接观测时深度/字节一致，不包含任何新增诊断字段。
7. 原始 SQL、参数、连接串、private payload、Provider raw output 不出现在 observer/report。
8. 汇总函数对固定样本给出确定的 min/max/p50/p95；空样本和不足 10 个 warm 样本不得标记 p95 PASS。
9. harness 单样本失败后不自动重试；只有显式场景表驱动下一次运行。
10. harness 输出包含 branch/SHA、模式、场景、raw metrics、wall time、cleanup status 和 evidence hash，可由独立脚本复算。
11. M1-M4 聚焦测试继续通过。
12. `pnpm --filter @apps/api typecheck` 通过。
13. `git diff --check` 通过。

## Codex 真实验收执行顺序（Pro 只提供工具，不执行）

遵循“先定位、一次最小正确性、一次同场景前后对比”，不得因为失败反复跑整套：

1. **离线最终门一次**：M1-M5 聚焦测试、HTTP/product composition、`pnpm test:pressure-chapter:final`、API typecheck、build；失败先归属并只重跑最小失败用例。
2. **启动诊断一次**：若仍被 `SANGTIAN_ACTION_RELEASE_ARTIFACT_HASH_MISMATCH` 阻塞，在数据库访问前停止并保留证据；不得把范围外修复混入本任务。
3. **REPLAY 基线**：固定一个 non-production fixture、同一区域/连接池、关闭 Pressure worker ownership；运行 1 次诊断确认可用，然后恰好 10 次 warm GET，保存每次 raw metrics 和 wall time。
4. **SHADOW 功能矩阵**：固定数据，每个批准矩阵 cell 只运行一次；覆盖 P0、N1-N7、六席、SOLO/TARGETED/SYNC、narrative status、非空 Feed、cursor page、resources/tokens/capabilities。任何差异立即停止，归属 M1-M4，只重跑失败 cell。
5. **项目所有者参与门**：只有 SHADOW 零字段/hash/字节差异后，向项目所有者报告并等待明确批准在非生产启用 FAST。
6. **FAST 最小正确性**：批准后运行 1 次真实 GET；验证响应等价、`application SQL <= 2`、roundtrip `<= 4`、transaction `<= 1`。
7. **FAST warm 对比**：同一 fixture 恰好 10 次 warm GET；与第 3 步相同算法比较 p50/p95、raw access counts 和 wall time。
8. **组合路径一次**：运行 1 次真实 N1->N2 SQL7 submit + 第一次 FAST GET；目标总 application SQL `<= 9`、总 roundtrip `<= 14`，分别报告 submit、首次权威 N2 projection、Narrative wait 和玩家最终“剧情+决策”总耗时。
9. **真实玩家流程一次**：在正式 `/game?runId=...` owner/player flow 验证内容、席位隐私、刷新一致、决策到下一章节和无内部字段泄漏；不修改页面。
10. **清理与复核一次**：清理 fixture，读取确认；保存 raw evidence、SHA-256、branch/HEAD、配置摘要和最终状态。

如果真实阶段失败，只重跑对应最小 cell/sample，不重新运行此前已通过的整套或 10 次序列。

## 性能与状态口径

- FAST GET 硬门：application SQL `<= 2`、协议往返 `<= 4`、transaction `<= 1`。
- SQL7 submit + 一次 FAST GET：application SQL `<= 9`、协议往返 `<= 14`；事务实际值必须单列。
- 建议延迟目标：FAST GET warm p95 `<= 1.5s`；SQL7 submit 到首次权威投影 `<= 6s`。
- AI 冷生成不纳入 1.5s GET 硬门，但必须单列，不能从玩家总耗时中隐藏。
- 单个成功样本最多标记 `PERF_MEASURED`；只有固定场景至少 10 次 warm 样本才可计算并判断 p50/p95。
- SQL 预算通过可标记 `ACCESS_REDUCTION_PASS`，但不等于 `PERF_PASS`。
- 只有架构、功能等价、访问量、warm 延迟、真实玩家流程和清理分别通过，才能声明整体完成。

## 必须交付

生成一个可下载 ZIP，包含：

- `changed-files/`：M5 所有新增/修改文件，保留仓库相对路径；
- `changes.patch`：相对届时上传的**精确 M1-M4 accepted 输入树**的 unified diff，只含 M5；
- `manifest.json`：每个文件路径、大小、SHA-256，输入 ZIP 名称/大小/SHA-256、前置模块 filtered blob hashes；
- `report.md`：request scope、计数口径、wall/query time 区分、shadow 关联、percentile 算法、harness 使用、实际命令和首次结果、`TESTS_NOT_RUN`、风险与回滚。

ZIP 不得包含 `.git`、`node_modules`、`.env*`、key/token/cookie/password/connection string、构建产物、运行日志、数据库内容或浏览器状态。

## 禁止声称

- mock、静态 query count、fake Prisma 或工具自测不能冒充真实 Supabase。
- query duration 不能冒充 HTTP wall time。
- 单样本不能冒充 warm p50/p95。
- 未实际运行的真实步骤必须标记 `TESTS_NOT_RUN`。
- M5 工具通过不等于 SHADOW、FAST、真实玩家流程或整体性能 PASS。
- 不得声称修复了主线启动哈希阻塞。

## M5 代码验收标准

- request-scoped SQL/roundtrip/transaction/query duration/wall time/mode/shadow 证据准确、并发隔离且可复算。
- 玩家响应零变化，诊断不泄漏 SQL/凭据/私人数据。
- harness 不自动重试，固定场景和样本数，失败可精确归属。
- M1-M5 聚焦测试、HTTP/product composition、API typecheck、`git diff --check` 通过。
- Codex 能在精确前置输入树上机械应用 patch，逐文件匹配工件并独立复现测试。

## 回滚

移除 acceptance harness 和 observer sink 接线，恢复 `pressureHttpBoundary()` 只使用现有 metrics wrapper；M1-M4 业务读路径不受影响。真实模式保持/恢复 `REPLAY`。
