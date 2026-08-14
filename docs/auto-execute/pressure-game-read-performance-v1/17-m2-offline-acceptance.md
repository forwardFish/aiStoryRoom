# M2 Prisma 聚合快照 Reader：离线验收

记录时间：2026-08-15

状态：`M2_OFFLINE_ACCEPTED_WITH_TEST_CORRECTION / REAL_POSTGRES_OPEN`。

## 工件

- 文件：`Pressure_GET_game_M2_PrismaAggregateSnapshotReader_b6f512_M1accepted.zip`
- 大小：53,550 bytes
- SHA-256：`8485CDCB02845316CE35BB02F5066F3C6C6DFCB2F8B2E0FE2927569C2F5274F2`
- manifest、报告、补丁、changed-files 齐全；允许文件集为 Reader、Reader spec 和 persistence export。
- 高特征密钥扫描无实际凭据命中。

## 独立复核

- 在干净 detached `b6f51244` 树机械应用 accepted M1 后，M2 patch 可无冲突应用。
- 生产 Reader 与工件的 Git 规范化 blob 完全一致；`persistence/index.ts` 亦一致。
- 静态结构保持一处参数化 `$queryRaw`、零 transaction、零 write、无 unsafe raw interpolation。
- 首次聚焦运行：M1+M2 共 32 项，31 PASS、1 FAIL。
- 唯一失败归属到测试自身：Prisma 6.19.3 的 `Prisma.Sql.sql` 是 `string`，测试错误调用 `query.sql.join("?")`；完整 API typecheck 也只报这一处。
- 最小修正为 `query.strings.join("?")`，不修改生产 Reader。
- 修正后只重跑失败用例：1/1 PASS；完整 `pnpm --filter @apps/api typecheck` PASS；`git diff --check` PASS。

## 证据边界

- 这证明离线参数绑定、viewer scope、fail-closed、Feed 委托和代码级单 statement 结构。
- 尚未在真实 PostgreSQL/Supabase 解析大型 CTE，也没有真实 query event、执行计划、roundtrip 或 wall-time 证据。
- 最终集成必须在最新 main 上运行一次真实最小 GET，真实 SQL 语法或 schema drift 失败时只回到 M2 修正。

## 集成约束

- 落地 M2 时必须保留上述一行测试兼容修正。
- 不得把 local authorities 接回数据库 Reader，否则一 SQL 预算失真。
- 在真实数据库门完成前不得标记 `ACCESS_REDUCTION_PASS` 或 `PERF_PASS`。
