# ChatGPT Pro 普通 Chat 开发任务书：M4D2 FAST GET 边界去重

日期：2026-08-15

## 1. 唯一目标

在 `main@a98ef29c43545ebef985176e952fc756b33bcce1` 加当前已验收 I1/M2/M4A/M4C/M5A/M5B 组合上，只让 startup-selected `FAST` 的普通 GET `/game` 在权限通过后直接进入现有 M2 aggregate snapshot + M3 projector reader，不再执行旧 `resolveGame()` 与独立 `readStoredRoute()` 两次 route 预读取。

`REPLAY` 和 `SHADOW` 必须逐路径保留当前 route dispatch + stored route 校验；权限检查在所有模式中都必须最先发生，不能跳过或缓存。

## 2. 已确认根因

当前 `PressureChapterHttpFacade.getGame()` 对三种模式统一调用 `resolveContext(..., "GAME")`：

1. `access.authorize()`；
2. `routes.resolveGame()`；该实现内部执行一次 `readStoredRoute()`；
3. facade 又独立调用一次 `routes.readStoredRoute()`；
4. 才调用 mode-bound `gameRead.read()`。

FAST 的 M2 aggregate snapshot 已在同一 PostgreSQL statement 捕获并严格校验 route/run/chapter/viewer/head/hash/fence 权威，M3 只投影该快照。因此 FAST 前面的两个旧 route 读取是重复往返；REPLAY/SHADOW 仍依赖旧 projection 路径，不能删除。

## 3. 模块卡

- 职责：在 HTTP facade 内按既有 startup-fixed `gameReadMode` 选择 GAME 上下文边界；FAST 只做 access，REPLAY/SHADOW 继续完整 resolveContext。
- 非职责：不改 access adapter、不改 selector/M2/M3、不改 snapshot SQL、不改 M5B observer、不改路由服务、数据库、页面或公开合同。
- 权威：PostgreSQL/Supabase 仍是唯一运行时权威；FAST route 完整性由现有 M2 aggregate snapshot decoder/projector 链负责。
- 输入：现有 principal、roomId、query 与构造时固定 mode。
- 输出：现有 `PressureChapterGameProjectionV1` 或现有 HTTP error；对象/JSON 语义保持。
- 依赖：HTTP facade -> access port -> mode-bound game reader；FAST 不再依赖 route port，其他操作和模式仍依赖。
- 失败归属：HTTP GET game mode boundary。
- 回滚：还原 facade 与其 spec 即可；无数据/schema 回滚。

## 4. 允许修改

只允许：

- `apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.ts`
- `apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.spec.ts`

若确实需要第三个生产文件、公共合同、ProductRoot、selector、snapshot reader、数据库、schema/migration 或页面，立即停止并报告，不得扩大范围。

## 5. 实现约束

1. 不增加公开 constructor/API 参数；复用 M5B 已接入的 `gameReadMode`。
2. FAST 有效 GET 必须严格按：parse -> authorize once -> dedicated `gameRead.read()` once；`resolveGame/readStoredRoute` 均为 0。
3. FAST 权限拒绝必须在任何 route/snapshot/projection 前结束，保持现有 403/error 对象。
4. REPLAY 与 SHADOW 的调用顺序、两次旧 route 读取、dispatch/stored 交叉校验、错误映射和返回对象必须保持。
5. RESULT/ACTION/REPLAY/CHAT/legacy slot 等其他方法必须保持当前行为。
6. mode 只能来自 startup composition；客户端 query/body 不能选择 FAST。
7. FAST 不得新增 fallback：snapshot/projector 失败时不得回退 legacy 或重新读取 route。
8. 不新增缓存、全局状态、SQL、事务、网络、endpoint、日志中的原始 ID，或第二 route 权威。
9. 不修改 M5B observer：FAST 操作仍必须处于现有一次 request-local observer 包装内。

## 6. 必须测试

只运行聚焦门；失败先归属，只重跑失败的最小用例：

- 扩展 facade spec，断言 FAST success：access 1、resolveGame 0、readStoredRoute 0、dedicated game read 1；
- FAST access denied：access 1，其余 route/game 0，现有公开 403 保持；
- FAST snapshot/projector reader error：错误身份/映射保持，route 仍 0，不回退 legacy；
- REPLAY 与 SHADOW：旧 route 读取和 dispatch 校验次数、顺序及返回保持；
- 其他 HTTP 方法不受 mode 分支影响；
- M5B GET observer 仍只包一次；
- `pnpm --filter @apps/api typecheck`；
- `git diff --check`；
- 高特征密钥与禁止路径扫描。

不得运行真实 Supabase、浏览器、全量 suite、commit、push、deploy 或 migration；未运行项标 `TESTS_NOT_RUN`。

## 7. 交付

交付单个可下载 ZIP，根目录包含：

- `changed-files/`
- `changes.patch`
- `manifest.json`
- `report.md`

manifest 记录输入内联包/附件摘要、准确基线、changed files 大小/hash、每条测试首轮和最终结果、未运行项和回滚。只给方案、伪代码或自述不算交付。

本模块最多只能声明 `M4D2_CODE_ACCEPTED`。真实 FAST 总 SQL、协议往返、功能三模式等价、SQL7 POST+GET 和 warm p50/p95 由 Codex 后续统一验收。
