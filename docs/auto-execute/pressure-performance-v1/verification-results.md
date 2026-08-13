# Verification Results

## Final offline gate

命令：`pnpm test:pressure-chapter:final`

- `@ai-story/shared` typecheck：PASS；
- `@ai-story/templates` typecheck：PASS；
- `@apps/api` typecheck：PASS；
- 17 个聚焦测试文件：132/132 PASS，0 fail；
- 总命令退出码：0。

该命令由 `scripts/acceptance/run-final-chapter.ps1` 固化，覆盖 snapshot、batch、transaction fences、Working Ledger、Settlement、recovery、Projection、HTTP 合同、观测以及 fixture 安全。

## Real non-production evidence

- P2.1 corrected：单次完整成功记录为 93 application SQL、123 协议往返、13 次事务，`PASS_CLEANED`；
- 对比完整成功参考 111/151/16，分别减少 18、28、3；
- P3.1：fixture `pc_1786620186639_1b57b13d2d07db95` 为 `PASS_CLEANED`，注册、鉴权、开局、提交、N1→N2 readback 与清理全部成功；
- P3.1 metrics 句柄失效，未取得可信 SQL 总数，未重跑。

成功样本的汇总数字来自当次执行记录并已写入主规范；当前工作树没有保留 111/151/16、102/134/13、93/123/13 的完整原始 metrics 日志。因此可以支持本轮工程结论，但不能宣称具备可从提交中独立重放的原始性能证据包。

## SQL7 focused verification

- API TypeScript：PASS（`pnpm exec tsc --noEmit -p apps/api/tsconfig.json`）。
- SQL7 service + snapshot：10/10 PASS；覆盖单次 snapshot、明确缺失回退、异常 fail-closed、零写入回退和 A-Emotion delivery 查询约束。
- Prisma commit：PASS；覆盖 6 个持久化语句组、CAS/计数失败回滚，以及 query-event 指标缺失或实际计数不等于 6 时 `QUERY_BUDGET_EXCEEDED`。
- Query-budget：PASS；逻辑提交预算固定为 6，BEGIN/COMMIT 不计 application SQL。
- Opening 根因修复：orchestrator 最小测试 11/11 PASS。
- 真实 Supabase：`FAIL_CLEANED`，失败发生在 SQL7 submit 之前的 N1 opening；没有实际 SQL7 数字，不补写、不推算、不立即重跑。
- 独立复核：3 个 P1 均已关闭；补充覆盖 detached query event 不依赖诊断开关、实际少计也回滚、service 拒绝 `verified=false` 回执。真实 Prisma callback 时序仍待一次真实运行证明。
- 冻结后单次真实运行：`FAIL_CLEANED`；SQL7 action 只完成 snapshot 1 SQL/1 roundtrip，0 transaction，随后因 private projection 缓存假设不成立 fail-closed。修复后仅运行受影响最小验证：read-through/captured-authority 深相等 1/1、snapshot 4/4、API typecheck，均 PASS；未再次运行 Supabase。
- private-projection 修复后的单次验证：`FAIL_CLEANED`；仍为 snapshot 1 SQL/1 roundtrip、0 transaction，失败为两种不同 authority envelope hash 被错误等同。修复后以不同 SQL7/convergence hash 运行 service、settlement、plan-builder 9/9 PASS，API typecheck PASS；未继续真实运行。

## SQL7 final evidence

- Real non-production fixture: `pc_1786635397341_5f2401cb25153e18`; run: `solo_8f1dd9646993d849e68bec33f3376e63`; result: `PASS_CLEANED`.
- Functional checks: registration, verification, authenticated session, solo start, N1 Projection, decision submit and N2 readback all PASS; fixture data and credentials cleaned.
- Action metrics: 7 application SQL, 10 protocol roundtrips, 1 transaction attempt, 1 commit, 0 rollback, 0 retry, 3,811 ms cumulative query duration.
- Offline final command: shared/templates/API typechecks PASS; first focused run 165/166 PASS. The only failure was a static test assuming one response literal; after updating it to validate both SQL7 and legacy response literals, the failed file passed 7/7. Previously passing tests were not rerun.
- Independent review: B0 hash semantics and transaction-control classification both APPROVE with no P0/P1.
- Verdict: `SQL7_PASS / ACCESS_REDUCTION_PASS / PERF_MEASURED / NOT_LATENCY_SLO_PASS`.
