# 任务分解

| ID | 阶段 | 负责人 | 写入范围 | 验证 | 并行 | 状态 |
|---|---|---|---|---|---|---|
| T0 | S0.0 | Orchestrator | 本目录、规范文档 | 分支/HEAD/白名单 | 否 | 完成 |
| T1 | S0.1-S0.2 | Metrics worker | observability、Prisma 观测、验收脚本 | 计数单测和固定场景基线 | 是 | 完成 |
| T2 | S1-S2 | Snapshot worker | projection reader、decision compiler、product wiring | parity、权限/过期/fence/幂等测试 | 是 | 完成；真实 shadow 放量为后续限制项 |
| T3 | S3A-S3C | Batch worker | automation contract、convergence、persistence | 原子性/排序/hash/重放/冲突测试 | 是 | 完成 |
| T4 | S3.5-P3.1 | Test engineer | 验收脚本和证据目录 | 同场景前后对比、结算快路 | 否 | 完成 |
| T5 | Final | Reviewer | 只读审查及报告 | typecheck、聚焦测试、真实 Supabase、diff 审查 | 否 | 进行中 |

并行规则：T1、T2、T3 写入集合互斥；共享契约变更由 Orchestrator 合并。测试失败时只重跑失败的最小用例。
