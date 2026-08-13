# Total Task

在 `origin/main@b5c3b95afc6b9994332cf6aed7928e9ce5a76ffd` 上，以分阶段、一次只改一个问题的方式完成 Pressure 单次决策数据库访问优化，并在功能不退化的前提下证明访问次数减少。

当前项目所有者最新口径：章节边界完整成功路径 `application SQL ≤7` 是本轮硬门；同时必须功能正确，且权威/fence/幂等/恢复不退化。111→93 只是中间测量，不能作为完成。

禁止范围：玩家页面、Prisma schema/migrations、生产数据、共享 API 端口。开发分支为 `codex/pressure-phased-performance-v1`。

完成证据由以下文件组成：

- `09-acceptance-report.md`：最终结论与真实性限制；
- `verification-results.md`：统一测试与真实 fixture 证据；
- `10-code-review.md`：独立代码审查；
- `blockers.md`：未关闭但不属于当前硬门的限制；
- 主规范：阶段实现与逐次测量记录。
