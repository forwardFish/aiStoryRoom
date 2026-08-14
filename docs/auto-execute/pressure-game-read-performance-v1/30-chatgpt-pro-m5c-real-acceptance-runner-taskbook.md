# ChatGPT Pro 普通 Chat 开发任务书：M5C 真实验收 Runner

日期：2026-08-15

## 唯一目标

新增一个 **non-production only** 的 Pressure GET `/game` 验收 runner，供 Codex 在三个隔离 API 进程（REPLAY、SHADOW、FAST）上只执行一次统一功能等价和性能采样。M5C 与正在开发的 M4C/M5B 不修改同一文件；它只提供验收脚本和聚焦测试，不改任何生产运行时代码。

## 模块卡

- 职责：创建一个临时已验证账号和 SOLO run；在同一 run/seat/query 上读取 REPLAY、SHADOW、FAST；逐字段比较；按固定样本数采集 wall time；执行一次 N1 SQL7 submit 和 N2 readback；生成脱敏 JSON；无论成功失败都清理 fixture。
- 非职责：不实现或修复生产读取、Projection、SQL 计数、observer、数据库规则或页面。
- 权威：复用现有 `scripts/acceptance/pressure-chapter/fixtures/local-auth-fixture.mjs` 的 scope、身份、鉴权和 cleanup 规则；不得复制第二套 fixture 安全规则。
- 失败归属：输出准确阶段（provision/start/replay/shadow/fast/compare/warm/submit/readback/cleanup）；只重跑失败的最小阶段由 Codex决定，runner 自身不得自动重试整个流程。
- 回滚：删除新增脚本/spec；无生产行为变化。

## 允许修改

只允许：

- `scripts/acceptance/pressure-chapter/game-read-performance-acceptance.mjs`（新增）
- `scripts/acceptance/pressure-chapter/cases/acceptance/game-read-performance-acceptance.test.mjs`（新增）
- 如确有必要，只能给现有 fixture helper 增加窄的无行为改变 export；不得改其安全/清理语义。

不得改 package scripts；Codex 会用准确命令直接运行。

## Runner 输入

通过环境变量或参数接收：

- `PRESSURE_GAME_READ_REPLAY_API_BASE`
- `PRESSURE_GAME_READ_SHADOW_API_BASE`
- `PRESSURE_GAME_READ_FAST_API_BASE`
- 可选三个 observation log 路径；日志文件由 Codex 在运行前创建为空文件。
- 固定 warm 样本数默认 10；不得低于 10，不接受无限循环或自动扩样。

继续由现有 pinned `.env.test` loader 验证 allowlisted non-production Supabase、mail sink 与 cleanup 权限。不得从命令行打印或写盘 cookie、密码、验证码、连接串或 authorization header。

## 固定流程

1. provision 一次临时账号，cookie 只保存在进程内；
2. 创建一次 SOLO 桑田 run；
3. 等待 N1 权威投影就绪，轮询只允许复用现有有界等待逻辑；
4. 对同一 run、同一身份和固定 feed query 分别请求 REPLAY、SHADOW、FAST；
5. 对三份公开 JSON 做完整深相等和 canonical JSON 相等，并明确检查 `projectionHash`、seat、routeHash、chapterRuntimeId、workingRevision、Narrative source、capabilities、resources、tokens、decision options 和 Feed audience；
6. 只有比较通过后，对 FAST 固定执行 1 个 cold + 10 个 warm GET；不得自动增加样本；
7. 使用初始 N1 projection 构造一次真实合法 SQL7 decision submit，并通过 FAST 读到 N2/新 revision；
8. 解析本次三个空白日志文件中的 M5B observation（若提供）；拒绝跨 mode、混合 scenario、少于 10 warm、observabilityFailure、SHADOW 非 MATCH；调用 M5A summary 计算 nearest-rank p50/p95；
9. finally 清理 run、账号、验证码记录和其他 fixture 数据；cleanup 失败使整体失败；
10. 只输出去敏 JSON，状态必须区分 `PASS_CLEANED`、`FAIL_CLEANED`、`CLEANUP_FAIL`。

不得在 REPLAY 与 FAST 各创建不同 run 后宣称等价；不得只比较 hash；不得忽略字段或过滤差异。

## 聚焦测试

使用本地 fake HTTP server/fixture stubs 覆盖：

- 三模式完全相等 PASS；任一深字段差异 FAIL；
- SHADOW observation 非 MATCH FAIL；
- 固定 1 cold + 10 warm，不多跑；
- 少于 10 warm、混合 scenario、observer failure FAIL；
- submit/readback success 与错误阶段归属；
- cookie/password/token/连接串不进入输出；
- success/failure 均执行 cleanup；cleanup failure 独立失败；
- 不自动重跑整个流程。

运行该新 spec、`git diff --check` 和密钥扫描。不得在 Pro 容器运行真实 Supabase、生产、浏览器、commit、push、deploy 或 migration；未运行项标记 `TESTS_NOT_RUN`。

## 交付

单个 ZIP，根目录含 `changed-files/`、`changes.patch`、`manifest.json`、`report.md`。manifest 记录输入 ZIP、准确基线、changed files、测试首轮/最终结果和未运行项。不得只给方案或伪代码。
