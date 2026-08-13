# Current Handoff

- Branch: `codex/pressure-phased-performance-v1`
- Base: `origin/main@b5c3b95afc6b9994332cf6aed7928e9ce5a76ffd`
- Business verdict: `PERF_MEASURED / SQL7_PASS / ACCESS_REDUCTION_PASS / NOT_LATENCY_SLO_PASS`
- Real database evidence: fixture `pc_1786635397341_5f2401cb25153e18`, run `solo_8f1dd9646993d849e68bec33f3376e63`, `PASS_CLEANED`
- Action metrics: 7 application SQL、10 protocol roundtrips、1 transaction attempt、1 commit、0 rollback、0 retry；cumulative query duration 3,811 ms
- Functional evidence: registration、verification、authenticated session、solo start、N1 Projection、decision submit、N2 readback 全部 PASS；测试数据与凭据已清理
- Offline evidence: shared/templates/API typecheck PASS；统一聚焦门首次 165/166，唯一静态 HTTP 合同测试修复后定向 7/7 PASS，未重复运行其余已通过用例
- Code review: final independent review `APPROVE`，无 P0/P1
- Forbidden scope: no `apps/web/**`、Prisma schema 或 migration diff；两个用户自有 dirty action-effect compiler 文件未纳入本任务
- Runtime cleanup: candidate API on port 3103 已关闭；主工作区 3102 未触碰

## Final SQL7 authority path

- 1 条聚合 SQL 捕获 room/run、route、world、chapter runtime、orchestrator、Working Ledger、SeatControl、viewer membership 与幂等状态。
- HUMAN + 5 AI、Beat、N1 Settlement、A-Emotion/downstream rows、N2 opening 和返回 Projection 均从该快照在内存规划；无 Provider/LLM/model-network capability。
- 1 个 Serializable 事务使用 6 条 application SQL 原子完成 authority CAS、批量 actions、批量 events、settlement、批量 narrative projections 与批量 outbox。
- `BEGIN`、`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`、`COMMIT` 保留在协议往返计数中，但不计 application SQL。
- 事务回执直接组装 N2 Projection，不再提交后完整重读数据库。
- same-key/same-payload replay 只读快照并返回当前授权投影；changed payload 冲突；部分提交状态进入 durable recovery；权限、revision、hash、seat fence、CAS 和计数均 fail closed。

## Evidence boundary

- 相对完整成功参考 111 SQL / 151 roundtrips / 16 transactions，本次为 7 / 10 / 1，分别下降 93.7% / 93.4% / 93.8%。
- 当前只有一个 SQL7 成功性能样本，不能计算 warm p50/p95，也没有独立玩家端时延分位数。因此不要把 `SQL7_PASS` 写成最终 `PERF_PASS`。
- 若下一阶段要关闭时延 SLO，只执行固定环境的少量 warm 分位数验收；不要继续改 SQL7 路径或重复当前功能测试，除非出现新的具体失败。
- 当前未创建提交、未推送、未部署。若要发布，只暂存本任务批准文件，继续排除用户自有 dirty 文件。
