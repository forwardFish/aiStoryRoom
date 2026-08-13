# Pressure 单次决策性能优化目标

- 项目：`D:\tmp\aiStoryRoom-pressure-performance-v1`
- 分支：`codex/pressure-phased-performance-v1`
- 基线：`origin/main@b5c3b95afc6b9994332cf6aed7928e9ce5a76ffd`
- 事实来源：`docs/Pressure_单次决策_10次Supabase访问性能优化实施与验收规范_v1.0.md`

## 成功条件

1. 单次普通决策保持现有权限、幂等、并发、恢复和事件链语义。
2. Supabase 仍是唯一运行时权威；不修改 Prisma Schema、迁移和玩家页面。
3. 关键路径采用一次权威快照、请求内计算和一次短批量事务。
4. 最新必要条件是相同成功场景 application SQL ≤7；111→93 仅为中间测量。
5. 性能证据必须保留绝对 SQL、往返、事务、失败和重试；无有效样本时不得补写或推算。
6. warm p95 与玩家端时延属于独立 SLO；未测得时只报告 `ACCESS_REDUCTION_PASS`，不得报告 `PERF_PASS`。

## 时间预算

- 0.5 小时：隔离、基线和计划。
- 1 小时：观测与一次基线。
- 3.5 小时：核心实现。
- 1 小时：正确性测试。
- 1 小时：性能复测。
- 1 小时：审查、修复和缓冲。

## 禁止范围

- 不修改 `apps/web/**`。
- 不修改 Prisma schema 或 migrations。
- 不引入本地数据库、第二权威或长期双路径。
- 不把 Narrative、A-Emotion 或 Feed 丰富化放回下一可玩投影的阻塞路径。

当前裁定：`PERF_MEASURED / SQL7_IN_PROGRESS / NOT_PERF_PASS`。
