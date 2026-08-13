# Pressure 性能分支阶段报告（已被 SQL7 硬门覆盖）

## Verdict

SQL7 本轮硬门已通过。最新业务标签为 `PERF_MEASURED / SQL7_PASS / ACCESS_REDUCTION_PASS / NOT_LATENCY_SLO_PASS`。

正常 N1→N2 成功路径已由 111 application SQL 降至 7、协议往返 151 降至 10、事务 16 降至 1；真实 fixture 功能和清理均通过。由于只有一个 SQL7 成功样本，没有 warm p50/p95，因此不宣称最终时延 SLO 通过。

## 已验证

- 普通提交移除 pre-submit 完整 `game.read()`，提交编译与 convergence 复用 authority snapshot。
- HUMAN + 五席 AI + Beat 使用一个 batch transaction，固定 route 席位顺序并复算 batch/hash chain。
- Narrative 与 A-Emotion downstream 改为集合写；N2 可玩投影不等待 Provider 生成 Narrative。
- N2 opening 与最终 Projection 复用刚提交的 committed authority。
- P3.1 复用 SETTLING state、descriptor、Working projection 与 sealed settlement input；实际 orchestrator 计数测试证明不再重复读取 N1 state/content/projection，durable settlement source fence 保持不变。
- 统一离线入口 `pnpm test:pressure-chapter:final`：shared/templates/API typecheck 全部通过，聚焦测试 132/132 通过。
- 真实 non-production Supabase fixture `PASS_CLEANED`：注册、鉴权、开局、N1 Projection、提交与 N2 readback 全部通过，凭据和测试数据已清理。
- 玩家可见文件、Prisma schema 与 migrations 均未修改。

## 性能证据

| 阶段 | SQL | 协议往返 | 事务 | 结果 |
|---|---:|---:|---:|---|
| 完整成功参考 | 111 | 151 | 16 | HTTP 201，业务成功 |
| P1.1 | 102 | 134 | 13 | `PASS_CLEANED` |
| P2.1 corrected | 93 | 123 | 13 | `PASS_CLEANED`，0 rollback/retry |
| P3.1 | 未取得 | 未取得 | 未取得 | `PASS_CLEANED`；metrics 输出句柄失效，不补写、不重跑 |

P3.1 的新增访问减少只报告定向计数证据，不伪造真实 SQL 数字。当前没有循环样本，因此没有合法 p50/p95；端到端时延 SLO 不在本轮通过结论内。

## Evidence

- 规范与完整阶段记录：`docs/Pressure_单次决策_10次Supabase访问性能优化实施与验收规范_v1.0.md`
- 模块卡：`module-p1-next-open.md`、`module-p2-final-projection.md`、`module-p3-settlement-source.md`
- P3 fixture：`scripts/acceptance/generated/pressure-chapter/local-auth-fixtures/pc_1786620186639_1b57b13d2d07db95.json`
- 代理审计：本目录 `agent-*.md`

generated 目录含本机 non-production 运行证据，不应默认提交；正式文档只保留去敏后的数字、run ID 与错误分类。

真实性限制：当前候选没有保留三个完整成功性能样本的原始 metrics 日志，111/151/16、102/134/13、93/123/13 为当次执行后写入规范的去敏汇总记录。P3.1 的 `PASS_CLEANED` JSON 仍在本机 ignored generated 目录，但没有 SQL metrics。故本报告支持“访问次数下降”的本轮工程验收，不宣称形成了可从 Git 提交独立复算的性能原始证据包。

## SQL7 覆盖记录（2026-08-13）

此前 111→93 的阶段结论已被新的 ≤7 硬门覆盖。SQL7 代码已接入且离线检查通过，但真实 after-run 在 N1 创建阶段失败，未进入 SQL7 submit，因此当前仍为 `SQL7_IN_PROGRESS / NOT_PERF_PASS`。不得使用逻辑上的“1+6”代替真实 Prisma query-event 计数。

唯一允许的下一次性能运行是在代码冻结和审查收口后执行一次相同 fixture。验收必须同时满足：业务 `PASS_CLEANED`、N1→N2 readback 正确、实际 application SQL ≤7、无未解释的 fallback、AI Provider 调用为 0。

该单次运行已执行，fixture 为 `pc_1786630126757_b09732f3cfbc9a4d`，结果 `FAIL_CLEANED`。SQL7 action 请求为 1 application SQL / 1 roundtrip / 0 transaction，失败点是 snapshot 对未持久化 read-through private projection 的错误假设。根因已修复并通过最小等价性/typecheck，但没有再次访问 Supabase。因此 ≤7 成功样本仍不存在，验收继续保持未通过。

修复后执行的一次针对性真实验证为 `pc_1786631128330_19575def06dcc6f7`，同样 `FAIL_CLEANED`，仍为 1 SQL / 1 roundtrip / 0 transaction；它确认 private projection 已通过，并暴露 SQL7 snapshot hash 与 Decision Convergence snapshot hash 被错误等同。该合同错误已按既有 batch authority 语义修复，刻意使用两种不同 hash 的 service/settlement/plan-builder 测试 9/9 PASS，API typecheck PASS。没有继续第三次真实运行。

## SQL7 最终验收

最终 fixture `pc_1786635397341_5f2401cb25153e18`（run `solo_8f1dd9646993d849e68bec33f3376e63`）为 `PASS_CLEANED`。N1→N2 提交与 readback 正确，action 请求实测为 **7 application SQL / 10 协议往返 / 1 事务 / 0 rollback / 0 retry**，数据库累计 query duration 3,811 ms。

相对 111/151/16 完整成功参考，SQL、往返、事务分别下降 93.7%、93.4%、93.8%。1 条 SQL 读取聚合权威快照，HUMAN + 5 AI、Beat、Settlement、N2 opening 在内存确定，6 条 SQL 在一个 Serializable 事务中原子持久化，事务回执直接形成 Projection。

统一离线门首次为 165/166；唯一失败是静态测试未识别新增 replay 返回分支，修复测试后失败文件 7/7 PASS。三层 typecheck 全部通过，独立复核无 P0/P1。玩家页面、Prisma Schema、migration 均未修改。

结论：本轮 SQL≤7 与功能正确性目标完成，标记 `SQL7_PASS`；稳定时延分位数仍未验收，保持 `NOT_LATENCY_SLO_PASS`。
