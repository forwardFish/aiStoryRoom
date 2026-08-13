# 验收清单

- [x] 基于准确 `origin/main@b5c3b95afc6b9994332cf6aed7928e9ce5a76ffd` 创建隔离分支 worktree。
- [x] SQL、协议往返、事务尝试/提交/回滚/重试和 query duration 可观测；SQL 文本只留 hash。
- [x] 固定数据集保留一次业务基线；基线失败，没有制造 p50/p95。
- [x] Projection Fast Reader 的代码和单元 parity 通过；真实 shadow 放量明确留在后续独立阶段，不作为当前访问减少硬门。
- [x] 普通提交移除 pre-submit 完整 `game.read()`，HTTP HUMAN 编译与 convergence 复用提交 authority snapshot。
- [x] AI 批次按冻结 route 席位顺序排序，提交端复算 batch hash，增量 chain 与完整 replay hash 一致。
- [x] HUMAN+AI+Beat 在一个 batch transaction 中提交；Settlement 保留独立 durable source fence，W4 recovery、并发冲突和幂等测试通过。
- [x] 下一可玩投影不等待 Provider 生成 Narrative；章节边界读取已持久化的 seat-bound `PENDING` narrative。
- [x] 同场景完整成功样本的执行记录为 111/151/16→102/134/13→93/123/13；完整原始成功 metrics 日志未纳入候选，已作为验收限制披露。未运行循环，因此不制造 p50/p95。
- [x] 最终统一入口通过：三个 typecheck 与 132/132 聚焦测试。
- [x] 玩家可见文件列表为空；Schema/migration 列表为空。
- [x] 真实 non-production Supabase N1 提交、N2 readback 与 fixture cleanup 成功。

新增硬门（未通过）：

- [ ] 同场景完整成功路径 application SQL ≤7，并保留原始 metrics 与 `PASS_CLEANED` 证据。

当前判定：`PERF_MEASURED / SQL7_IN_PROGRESS / NOT_PERF_PASS`。
