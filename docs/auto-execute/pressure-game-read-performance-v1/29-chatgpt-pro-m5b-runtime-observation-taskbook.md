# ChatGPT Pro 普通 Chat 开发任务书：M5B 请求级观测最小接线

日期：2026-08-15

## 1. 唯一目标

在最新 `main@a98ef29c43545ebef985176e952fc756b33bcce1 + accepted I1/M2/M4A/M5A + accepted M4C` 上，把 M5A 的纯 observation 合同最小接入真实 Pressure 普通 GET `/api/v4/rooms/:roomId/game`。

接线必须得到每个请求隔离的、脱敏的完整 observation：读取模式、SHADOW 结果、成功/失败 outcome、请求与场景 digest、请求 wall time，以及现有 request-local Prisma metrics。观测失败、sink 失败或 diagnostics 失败都不得改变玩家响应、错误映射、数据库行为或读取模式。

本模块不负责修改 M1-M4 业务语义，不负责跑真实 Supabase 样本，也不得声称访问量或延迟 PASS。

## 2. 模块卡与依赖方向

### M5B-1 Runtime Observer

- 职责：在单次 GET operation 内创建请求隔离 context；生成安全 digest；接收 M4A SHADOW diagnostic；在 operation 结束前读取现有 request-local metrics；构造并投递 M5A observation。
- 非职责：不查询数据库、不修改 Projection、不比较业务字段、不重新计算 SQL 数、不保存原始 ID/SQL/异常文本。
- 权威：数据库计数唯一来自现有 `pressure-db-metrics.ts` 的 `readPressureDbRequestMetricsV1()`；M5B 不建立第二计数器。
- 并发：必须使用 request-local context，禁止共享 `lastDiagnostic`、全局 current request 或单例可变对象串请求。
- 失败：observer、digest、metrics snapshot、clock 或 sink 的任何错误全部隔离；业务 Promise 的 resolve/reject 值和时序不得改变。
- 回滚：撤掉 facade/ProductRoot 注入并删除 M5B 文件，M5A 与 M1-M4 保留。

### M5B-2 HTTP/Composition Injection

- 职责：只在 `getGame()` 的既有 `pressureHttpBoundary` callback 内、任何 parse/access/read 之前包一层 M5B observe operation；ProductRoot 把同一个 request-local observer 同时注入 facade 与 M4B composition 的既有 `diagnostics` 端口。
- 非职责：不改 route/controller/DTO/公开响应；不改 POST、Result、Chat、Replay；不改 selector、snapshot reader、Projector。
- 依赖方向：HTTP -> observer port；ProductRoot 只负责组合；observer 可实现 M4A 已有 diagnostic port，但 M4A 不反向依赖 observer。

## 3. 推荐实现形状

推荐新增一个窄的 `PressureGameReadRuntimeObserverV1`：

1. `observe(mode, safeRequestInput, operation)` 在 request-local context 中执行原 operation；
2. `report(diagnostic)` 实现既有 `PressureGameReadShadowDiagnosticPortV1`，只更新当前 request context；
3. REPLAY/FAST 的 `shadowStatus=NOT_RUN`；SHADOW 必须从当前请求的 diagnostic 得到 `MATCH/MISMATCH/ERROR`，缺失 diagnostic 时 fail-closed 为 `ERROR`；
4. `requestDigest` 每次请求唯一，可把安全随机 nonce 与规范化请求材料一起 hash；nonce 和原始材料不得输出；
5. `scenarioDigest` 对相同 run/viewer/query shape/mode 稳定，不含每次请求 nonce，使 10 个 warm 样本可归为同一场景；
6. wall time 从进入 observe 到 operation resolve/reject，使用非负安全整数并保证 `finished-started=wallTime`；
7. 在仍处于现有 `withPressureDbRequestMetricsV1` AsyncLocalStorage 内读取 metrics，所以必须把 observe 放在 `pressureHttpBoundary` callback 内；
8. sink 只接收已经通过 M5A validator 的冻结 observation；默认 no-op；启用诊断时可输出单行 JSON 到内部日志，但不得进入 HTTP response；
9. sink/diagnostic/observation 构造错误必须吞掉并保持业务结果；不得吞掉业务错误。

允许 Pro 提出更小且同样满足上述合同的实现；不得以修改 M4A selector 或公共响应换取接线便利。

## 4. 允许修改

优先且最多允许以下路径：

- `apps/api/src/pressure-chapter/observability/game-read-runtime-observer.ts`（新增）
- `apps/api/src/pressure-chapter/observability/game-read-runtime-observer.spec.ts`（新增）
- `apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.ts`
- `apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.spec.ts`
- `apps/api/src/pressure-chapter/product/product-root.ts`
- `apps/api/src/pressure-chapter/product/pressure-chapter-product.api.spec.ts`
- 既有窄 index 文件（仅确有 import/export 需要时）

如果必须修改 `pressure-db-metrics.ts`、M4A selector、M4B composition、公共合同、route、数据库、三个以上既有业务模块或任何未列生产文件，立即停止并在原对话报告根因与最小扩展范围，不得自行扩大。

## 5. 禁止修改

- `apps/web/**`、玩家页面、公开响应、controller route；
- M1 snapshot 合同、M2 SQL reader、M3 Projector、M4A selector 的业务代码；
- Prisma schema/migration、数据库对象或真实数据；
- Settlement、SQL7 submit、Action、Narrative、Provider、Prompt、内容包；
- 全局 Prisma 统计、后台 Worker 混合统计、原始 SQL/参数/ID/连接串日志；
- 新 API endpoint、第二 Projector、第二数据库计数器、缓存或回退 REPLAY。

## 6. 必须测试

只运行聚焦门，失败后只重跑失败的最小用例：

1. 新 M5B observer spec：成功、四类 outcome、REPLAY/FAST/SHADOW 状态、sink failure、metrics missing、digest 稳定/唯一、无敏感值、40 路并发隔离；
2. M5A spec：11/11 必须保持；
3. M4A selector spec 与 M4C composition spec：行为不变；
4. HTTP facade spec：GET 包装一次，其他方法不观测；原返回与错误对象逐字段一致；
5. ProductRoot 聚焦 spec：同一 observer 注入 facade 和 SHADOW diagnostic，默认 REPLAY 不变；
6. `pnpm --filter @apps/api typecheck`；
7. `git diff --check` 与高特征密钥扫描。

不得在 Pro 容器执行真实 Supabase、浏览器、全量 suite、commit、push、deploy 或 migration。未运行必须写 `TESTS_NOT_RUN`。

## 7. 交付物

交付单个可下载 ZIP，根目录必须包含：

- `changed-files/`
- `changes.patch`
- `manifest.json`
- `report.md`

manifest 必须记录输入 ZIP 原始名/实际名/大小/SHA-256、准确基线、所有 changed files 的大小/hash、每个测试命令与首轮/最终结果、未运行项、回滚方式。不要只给方案、伪代码或局部片段。

## 8. 验收边界

M5B 代码与聚焦门通过后，只能声明 `M5B_CODE_ACCEPTED`。之后由 Codex 执行：

1. 统一功能等价门；
2. 单线程真实 SHADOW 样本；
3. SHADOW 完全一致后，一次 FAST GET 与一次 SQL7 POST+GET；
4. 至少 10 条 warm FAST GET 计算 p50/p95；
5. 将 SQL、协议往返、事务、wall time 分别报告。

M5B 自身不得声明 `ACCESS_REDUCTION_PASS`、`SQL7_PASS` 或 `PERF_PASS`。
