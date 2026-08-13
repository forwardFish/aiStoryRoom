# P1.1 模块卡：下一章 WorkingLedger 原子打开

- 单一责任：在章节边界打开 N2-N7 时，消除 `read -> append -> read projection` 的重复数据库边界，并直接消费刚提交的 frozen bundle 生成 seed；一次 append 事务返回已校验的 opening event 与内存 projection。
- 非责任：不改变 Settlement/B0、章节内容、W4 状态机、Narrative/A-Emotion、Feed、HTTP Schema、玩家页面、Prisma Schema 或 migration。
- 权威输入：已校验 route、chapter descriptor、deterministic chapterRuntimeId、authoritative seed。
- 权威输出：持久化的 `WORKING_LEDGER_OPENED` event 及由同一 event 纯投影得到的 `WorkingLedgerProjectionV1`。
- 依赖：`WorkingLedgerPort.append` 的 `APPENDED/HEAD_MISMATCH` 原子语义；`projectWorkingLedger` 的确定性校验。
- 准确文件：
  - `apps/api/src/pressure-chapter/working-ledger/working-ledger.service.ts`
  - `apps/api/src/pressure-chapter/orchestrator/contracts.ts`
  - `apps/api/src/pressure-chapter/orchestrator/chapter-orchestrator.service.ts`
  - 对应 focused specs。
- 最小测试：首次 OPENED、并发/重放 REPLAYED、不同 opening 输入 fail closed、orchestrator 使用 opening 返回 projection 且不调用额外 projection reader。
- 失败所有者：WorkingLedger opening adapter；持久化冲突仍由 `WorkingLedgerPort.append` 返回当前 events。
- 回滚：恢复 open 前置 read 与 open 后 projection load；无数据迁移或不可逆状态。
- 静态预算：opening 自身消除 4 SQL/3 数据库事务/10 次含 BEGIN/COMMIT 的协议往返；请求内 committed opening authority 再消除最终 Projection 的 1 次 Working projection 读取。自定义事务指标未覆盖 seed adapter 内直接调用的 Prisma transaction，因此静态物理事务数与观测字段不能机械等同。
- 通过证据：3 个定向测试通过（N1-N7 及 N2-N7 frozen bundle seed、首次 OPEN、HEAD race）；API typecheck 通过；`git diff --check` 通过。
- 实测证据：同深度完整成功样本从 111 SQL/151 往返/16 次记录事务降至 102/134/13；next-open 从约 3,232 ms 降至 2,425 ms。端到端从约 17,988 ms 增至 19,620 ms，因此模块只证明结构和局部阶段改善，不证明整体时延改善。
- 通过门：focused tests、API typecheck、`git diff --check` 和一次同场景 `PASS_CLEANED` 已完成；整体仍为 `NOT PERF_PASS`。
