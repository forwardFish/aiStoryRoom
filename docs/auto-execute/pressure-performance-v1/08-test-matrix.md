# 测试矩阵与最终证据

| 范围 | 验证方式 | 当前证据 | 状态 |
|---|---|---|---|
| 类型边界 | shared、templates、API typecheck | `pnpm test:pressure-chapter:final` 三项全部通过 | PASS |
| 提交快照 | 权限、跨房间、revision、fence、幂等、hash | snapshot、HTTP facade、convergence 聚焦测试 | PASS |
| HUMAN + AI 批量 | 顺序、batch hash、Ledger chain、单事务与所有 fence | prepared batch、Prisma adapter、Working Ledger 测试 | PASS |
| Settlement / recovery | durable source、CAS、并发、崩溃恢复、P3 committed authority | settlement 与 orchestrator 测试 | PASS |
| 最终 Projection | viewer-safe、authority 绑定、PENDING Narrative、回退路径 | projection 与 HTTP facade 测试 | PASS |
| fixture 安全 | non-production 限制、凭据不落盘、清理 | fixture 单测及既有 `PASS_CLEANED` 真实样本 | PASS |
| 统一离线验收 | 固定入口执行以上关键合同 | 132/132，0 fail | PASS |
| 数据库访问减少 | 同场景单次成功样本的应用 SQL / 协议往返 / 事务 | 记录值 111/151/16 → 93/123/13 | ACCESS_REDUCTION_PASS |
| SQL7 硬门 | 同场景 N1→N2 完整成功路径 | application SQL ≤7 且保留原始 metrics | IN_PROGRESS |
| P3.1 实际 SQL | 真实 fixture 已成功，但 metrics 输出句柄失效 | 不补写、不推算、不为数字重跑 | NOT_MEASURED |
| 时延分位数 | warm p50/p95 | 本轮按要求未循环压测 | NOT_MEASURED |
| Fast Reader 放量 | 真实 SHADOW parity | 默认仍为 REPLAY，留作后续独立阶段 | DEFERRED |

执行纪律：先定位唯一失败原因，只重跑失败的最小用例；最终仅运行一次统一离线入口。真实 Supabase 不为补日志或刷数字重复执行。
