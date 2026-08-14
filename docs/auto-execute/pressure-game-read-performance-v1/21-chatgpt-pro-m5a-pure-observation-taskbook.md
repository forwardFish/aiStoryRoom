# ChatGPT Pro 普通 Chat 开发任务书：M5A 纯观测合同与离线汇总

> 状态：`READY_FOR_PARALLEL_PRO_CHAT`。本模块与 I1/M4B 并行，但不得接线到 HTTP、selector 或 ProductRoot；M5B 接线必须等 M4B 验收。

## 背景与唯一目标

Pressure GET `/game` 最终需要可信地比较 REPLAY、SHADOW、FAST 的 application SQL、协议往返、事务、query duration 和 HTTP wall time。现有 `pressure-db-metrics.ts` 已提供 request-scoped 数据库计数。本任务 M5A 只新增：

1. 窄、内部、可序列化的 GET 观测合同；
2. 固定样本的纯 percentile/统计汇总；
3. 脱敏 acceptance evidence 的纯构造与可复算 hash；
4. 聚焦测试。

不得做运行时接线、网络请求、真实 Supabase、配置开关或页面修改。

## 精确输入

- 仓库：`forwardFish/aiStoryRoom`。
- 远程 main 基线：`a98ef29c43545ebef985176e952fc756b33bcce1`。
- 目标专用分支：`codex/chatgpt-pro-pressure-performance-v2`；你不得 commit 或 push。
- 输入 ZIP 文件名、大小、SHA-256 以 Codex 上传消息为准；请自行复算并写入 manifest/report。
- 当前数据库指标权威：`apps/api/src/pressure-chapter/observability/pressure-db-metrics.ts`。

## 模块卡

### 职责

- 定义 `PressureGameReadObservationV1`：模式、shadow 状态、操作结果类别、wall time、完整 `PressureDbRequestMetricsV1`、去敏 request/scenario 标识、时间数据。
- 定义纯函数 summary：count/min/max/p50/p95，并明确 percentile 算法。
- 定义固定场景 evidence：branch/SHA、模式、章节、participant/decision mode、feed cursor/limit、Supabase region/连接池摘要、worker ownership、样本序号、cleanup status、raw observation、evidence hash。
- 对空样本、畸形样本、少于 10 个 warm 样本 fail-closed；不得生成伪 p95 PASS。

### 非职责

- 不读取数据库、环境变量、HTTP、selector、Projection、Provider 或页面。
- 不启动 AsyncLocalStorage scope，不修改现有 query-event 分类。
- 不实现 M5B observer/sink wiring，不执行 acceptance 脚本。
- 不判定完整 `PERF_PASS`；最多提供纯预算计算所需事实。

### 输入/输出/依赖

- 输入：普通 TypeScript 对象和 `PressureDbRequestMetricsV1`。
- 输出：冻结、可 JSON 序列化、无引用泄漏的 observation/summary/evidence。
- 依赖方向：M5A -> 现有 metrics type 与共享 canonical hash；运行时/HTTP 后续依赖 M5A，M5A 不反向依赖它们。

### 失败归属与回滚

- 合同/统计/evidence 输入错误必须使用稳定内部 error code/path，不包含原始 SQL、凭据、私人 payload。
- 回滚只删除 M5A 新文件和必要 export；现有运行时行为不变。

## 允许修改

优先只新增：

- `apps/api/src/pressure-chapter/observability/game-read-observation.ts`
- `apps/api/src/pressure-chapter/observability/game-read-observation.spec.ts`
- 如职责更清晰，可拆出同目录的 `game-read-acceptance-summary.ts`、`game-read-acceptance-evidence.ts` 及各自 spec。

只有在类型导出确有必要时，才可最小修改同目录现有文件；不得修改其运行行为。不要创建通用 Manager 或共享可变 registry。

## 禁止修改

- M1-M4A、M4B、game projection、HTTP、ProductRoot、production composition；
- `pressure-db-metrics.ts` 的计数、AsyncLocalStorage、detached event 行为；
- Prisma schema/migration、数据库表、配置和 `.env*`；
- Settlement、决策提交、AI、Narrator、Provider、Prompt；
- `apps/web/**`、玩家响应、页面和路由。

## 合同要求

观测至少包含：

- `schemaVersion`；
- `mode: REPLAY | SHADOW | FAST`；
- `shadowStatus: NOT_RUN | MATCH | MISMATCH | ERROR`；
- `outcome: SUCCESS | BUSINESS_ERROR | DEPENDENCY_ERROR | INTERNAL_ERROR`；
- 非敏感 `requestDigest`，必须是 SHA-256，不接受原始 runId/subjectId；
- `startedAtMs`、`finishedAtMs`、`wallTimeMs`，验证为安全整数且 `finished >= started`；
- 完整克隆的 `PressureDbRequestMetricsV1`；
- `observabilityFailure: boolean` 或等价固定字段，但不得保存异常 message/cause。

统计要求：

- 算法必须确定且在报告中说明；建议使用排序后线性插值或 nearest-rank，但测试必须固定准确结果。
- p50/p95 必须基于原始 wall-time samples，不能用 query duration 替代。
- 每个维度分别汇总 wall time、application SQL、roundtrip、transaction、query duration。
- 少于 10 个 warm 样本时返回明确 `INSUFFICIENT_SAMPLES`，不得产生 p95 pass/fail。

evidence 要求：

- 只接受预先去敏或枚举 metadata；run/viewer/seat 只允许 SHA-256 digest。
- 包含 endpoint、chapter、participantMode、decisionMode、feed cursor 是否存在和 limit、Supabase region、连接池配置摘要、worker ownership、branch、commit SHA、mode、sample index、cleanup status。
- `evidenceHash` 从不含自身的 canonical payload 计算，可独立复算。
- 输入和输出必须 structured-clone 安全，不能保留可变引用。

## 必须测试

只运行 M5A 聚焦测试和 API typecheck：

1. observation 成功/四类 outcome/四类 shadow status 合法矩阵。
2. REPLAY/FAST 的 shadow status 必须是 `NOT_RUN`；SHADOW 才能 MATCH/MISMATCH/ERROR。
3. wall time 与 timestamps 一致；NaN、负数、非安全整数、finished<started fail-closed。
4. metrics 数字、transaction 一致性、64 位小写 hash、重复/引用泄漏验证。
5. 空样本和少于 10 warm samples 显式不足；10 个固定样本的 min/max/p50/p95 结果准确可复算。
6. query duration 与 wall time 分开汇总。
7. evidence metadata、cleanup success/failure、sample index、branch/SHA 和 hash 复算通过。
8. 原始 SQL、参数、连接串、runId、subjectId、private payload、Provider output 不能出现在输出。
9. 并发构造没有全局 mutable state，也不串样本。
10. `pnpm --filter @apps/api typecheck` PASS。
11. `git diff --check` PASS。

不得运行完整 Pressure suite、真实数据库、HTTP、浏览器或性能样本；未运行项在报告中写 `TESTS_NOT_RUN`。

## 必须交付

生成一个可下载 ZIP：

- `changed-files/`：M5A 全部文件，保留仓库相对路径；
- `changes.patch`：相对精确 `a98ef29c` 的 unified diff，只含 M5A；
- `manifest.json`：输入 ZIP、基线、每个文件大小/SHA-256、测试状态；
- `report.md`：合同、算法、证据 hash、实际命令和首次结果、`TESTS_NOT_RUN`、风险、回滚。

ZIP 不得含 `.git`、`node_modules`、`.env*`、构建产物、日志、数据库、浏览器状态或凭据。

## 禁止声称

- M5A 通过不等于 M5B 已接线；
- mock/纯函数不能冒充真实 SQL、Supabase、HTTP wall time 或玩家验收；
- 不能声称 `ACCESS_REDUCTION_PASS`、warm p50/p95 或 `PERF_PASS`；
- 不得声称修改了玩家功能或提高了真实性能。
