# ChatGPT Pro 普通 Chat 开发任务书：M4D1 权限检查单 SQL

日期：2026-08-15

## 1. 唯一目标

在 `origin/main@a98ef29c43545ebef985176e952fc756b33bcce1` 加当前已验收 Pressure GET `/game` 模块的源码组合上，仅把现有 `PrismaPressureChapterHttpAccessAdapterV1.authorize()` 从两个顺序 Prisma 读取改成一个参数化 PostgreSQL application statement，保持 `PressureChapterHttpAccessPort`、全部成功/拒绝行为和调用方完全不变。

本模块是 M4D1，只消除权限预检内部的一次重复数据库往返。它不负责改变 GET 路由流程、FAST selector、聚合快照、投影、观测、验收 runner 或任何玩家页面。

## 2. 已确认根因

当前 `apps/api/src/pressure-chapter/http-production/access.adapter.ts` 先执行：

1. `storyRun.findUnique()`，读取 StoryRun 与 Pressure route metadata；
2. `storyPlayer.findUnique()`，读取同一 run/subject 的 human active membership。

因此一次 `authorize()` 固定产生两条 application SQL。GET `/game` 的最终硬门是 FAST 总计不超过 2 条 application SQL；M4D1 必须让权限预检只占 1 条，且不得通过缓存、事务或弱化校验换取结果。

## 3. 模块卡

- 职责：用一条参数化只读 SQL 同时取得并绑定 StoryRun、Pressure route metadata 与精确 human active membership，返回现有 `PressureChapterHttpAccessV1 | null`。
- 非职责：不读取完整 route JSON；不读取 seat/private projection；不调用 GET snapshot；不改变 HTTP error mapping；不修改公开合同。
- 权威：PostgreSQL/Supabase 仍是唯一运行时权威；输入只来自 `roomId/subjectId/viewerId`。
- 输入：现有 `PressureChapterHttpAccessPort.authorize()` 输入。
- 输出：逐字段保持现有返回对象，所有拒绝条件仍返回 `null`。
- 依赖方向：HTTP production adapter -> Prisma `$queryRaw`/`Prisma.sql`；不得反向依赖 HTTP facade、FAST selector 或页面。
- 失败归属：HTTP production access persistence adapter。
- 回滚：恢复原 adapter/port/spec 文件即可；调用方和合同不变。

## 4. 允许修改

只允许：

- `apps/api/src/pressure-chapter/http-production/access.adapter.ts`
- `apps/api/src/pressure-chapter/http-production/ports.ts`
- `apps/api/src/pressure-chapter/http-production/http-production.spec.ts`
- `apps/api/src/pressure-chapter/http-production/index.ts`（仅确有 import/export 需要时）

若需要修改任何其他生产文件、Prisma schema/migration、公开合同、HTTP facade、ProductRoot、M1-M5 文件或页面，立即停止并报告，不得扩大范围。

## 5. 实现约束

1. 正常调用必须恰好执行一条 `$queryRaw` application statement，不得 `$transaction`。
2. 必须使用 `Prisma.sql` 参数绑定；禁止字符串拼接输入。
3. 查询必须把 `StoryRun.id == roomId`、canonical engine/strategy、Pressure route snapshot 的 run/schema/engine/strategy/runtime profile，以及精确 `StoryPlayer(runId,userId)` 的 `playerType=human/status=active` 绑定在同一语句中。
4. `subjectId !== viewerId`、空输入必须在查询前返回 `null`，SQL 为 0。
5. 缺失 run、缺失/重复或非 human/inactive membership、route metadata 不一致均返回 `null`；不得返回另一个 run 或用户的数据。
6. 返回对象 schema 和字段逐字保持现有实现：`roomId/runId/subjectId/viewerId`。
7. 不记录原始 ID、SQL 参数、连接串或凭据。
8. 不增加缓存、第二权威、事务、fallback 或新 endpoint。

## 6. 必须测试

只运行聚焦门，失败后只重跑失败最小用例：

- 扩展现有 `http-production.spec.ts`，覆盖当前所有成功/拒绝矩阵；
- 断言有效授权只调用一次 raw query，且没有事务；
- 断言无效输入 0 SQL；
- 断言 SQL 是参数化对象，输入未拼入 SQL 字符串；
- 断言行数 0、1、>1 均 fail-closed（只允许精确一行成功）；
- `pnpm --filter @apps/api typecheck`；
- `git diff --check`；
- 高特征密钥扫描。

不得运行真实 Supabase、生产、浏览器、全量 suite、commit、push、deploy 或 migration；未运行项标记 `TESTS_NOT_RUN`。

## 7. 交付

交付单个可下载 ZIP，根目录包含：

- `changed-files/`
- `changes.patch`
- `manifest.json`
- `report.md`

manifest 记录输入 ZIP 原始/实际文件名、大小、SHA-256、准确基线、全部 changed files 的大小/hash、每条测试首轮与最终结果、未运行项和回滚方式。只给方案、伪代码或自述不算交付。

M4D1 聚焦门通过后只能声明 `M4D1_CODE_ACCEPTED`；GET 总 SQL、功能一致性、真实 Supabase 和延迟仍由 Codex 在后续统一验收。
