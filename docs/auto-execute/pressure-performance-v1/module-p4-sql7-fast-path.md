# P4 模块卡：Decision-to-next-projection SQL≤7 快路径

- 当前状态：`IMPLEMENTED_AND_WIRED / OFFLINE_PASS / SQL7_PASS`；真实 non-production Supabase 已取得 7 application SQL 成功样本。
- 单一责任：把一次正常的首次 `submitDecision`（N1 HUMAN + 5 AI）从统一权威快照推进到已提交的 N2 可玩 Projection，并把 application SQL 控制在最多 7 条：事务外 1 条快照读取，Serializable 事务内最多 6 条持久化语句。
- 非责任：不修改 `apps/web/**`、玩家可见文案或交互、公开 HTTP response schema、内容包/release manifest、玩法与结算规则、Prisma Schema 或数据库表结构；不把 Narrative/A-Emotion Provider 调用重新放回玩家同步路径。
- 权威输入：单条 SQL 返回的 `DecisionToNextProjectionSnapshotV1`。它必须绑定 room、run、chapter、routeHash、world sequence/state hash、orchestrator revision/hash、Working revision/state hash/head、SeatControl controller/controlEpoch/submissionFence、viewer membership 与幂等键。
- 纯计算：HUMAN action、5 个 AI action、Beat、settlement source/commit、N2 opening 和玩家 Projection 全部由同一快照在内存中确定；5 个 AI 保持零 Provider/LLM/model-network。
- 持久化输出：一个 Serializable 事务返回 `CommittedDecisionToNextProjectionAuthorityV1`。成功事务最多使用 6 条 application SQL，并原子写入 action、ledger/event、Beat、downstream、settlement、outbox、world/runtime CAS 与 N2 opening 所需 durable 数据。
- SQL 预算：①统一快照读取；②权威 fence/CAS 与运行时推进；③批量 DecisionAction；④批量 StoryEvent/ledger；⑤ChapterSettlement；⑥批量 NarrativeProjection；⑦批量 durable outbox。BEGIN/COMMIT 不计入 application SQL。
- 安全边界：提交语句必须重新校验快照中的全部 revision/hash/fence；任一计数或返回 receipt 不满足合同即抛错并回滚。不得用请求内对象跳过提交时 CAS，也不得建立第二套长期事实来源。
- 正常路径：首次且未冲突的 N1→N2 提交使用 P4；最终 HTTP Projection 只由事务返回的已提交 authority 纯组装，不再查询数据库。
- 恢复与异常路径：幂等重放、冲突诊断、崩溃恢复、审计与修复继续使用 durable 数据和既有恢复路径；它们不共享首次成功路径的 7 SQL 性能声明，但业务结果必须保持一致。
- 失败所有者：快照读取失败归 P4 Snapshot；纯计划不确定或 hash 不一致归 P4 Planner；CAS、唯一约束、原子写入或 receipt 不完整归 P4 Commit；Projection 深相等失败归 P4 Projection bridge。
- 最小正确性测试：快照字段/跨房间/权限/过期 revision/fence；纯计划确定性、排序、hash 链；事务全有或全无、CAS 失败、幂等重放；P4 与旧路径的公开 response 深相等；5 AI Provider 调用数为 0。
- 性能验收：先完成静态 query-budget 与定向 SQL 计数测试；功能门通过后只执行一次与既有 fixture 同场景的真实 N1→N2 提交。只有原始 metrics 证明 application SQL≤7、fixture `PASS_CLEANED`，才可标记 `SQL7_PASS`。
- 回滚：移除正常提交对 P4 repository 的 wiring，恢复现有 durable pipeline；P4 不包含数据迁移，因此无不可逆数据回滚步骤。
- 审批门：当前用户已明确要求继续优化并把 ≤7 作为硬完成条件；该授权不包含数据库 migration、部署、推送或任何玩家页面改动。若实现必须增加 migration，必须停止并另行取得批准。

## 2026-08-13 实施检查点

- 状态：`IMPLEMENTED_AND_WIRED / OFFLINE_PASS / REAL_SQL_NOT_VERIFIED`，不得标记 `SQL7_PASS` 或 `PERF_PASS`。
- 生产组合已接入 SQL7：1 条聚合权威快照；HUMAN、5 AI、Beat、N1 settlement、N2 opening 与返回 Projection 在内存中规划；一个 Serializable 事务最多执行 6 个持久化语句组；事务回执直接生成 Projection，不再提交后重读。
- 驱动层预算：事务逻辑计数之外，Prisma query-event 指标现在会在事务内测量实际 application SQL；指标缺失、少计或多计都在提交前抛出 `QUERY_BUDGET_EXCEEDED` 并回滚。只有实际计数恰好等于 6 才允许 `verifiedByPrismaQueryEvents=true` 并提交；最终验收仍必须证明快照 1 + 提交 6 ≤ 7。
- Fail-closed：快照返回 `null` 才允许作为明确缺失而回退；查询、解码或完整性异常不再被吞掉，直接进入公开 dependency failure 边界。
- A-Emotion 等价性：聚合快照只读取与 `PRESSURE_A_EMOTION_AGGREGATE_V1` StoryEvent 精确关联的 viewer delivery，避免把同房间其他 EventDelivery payload 当作 A-Emotion 解码。
- 最小验证：SQL7 service/snapshot 10/10 PASS；Prisma commit、query-budget 与 request metrics 定向脚本 PASS；API TypeScript `tsc --noEmit` PASS。独立审查最初报告的 3 个 P1 已全部复核关闭；另有指标时序/并发可用性风险留给单次真实验收，不据此宣称性能通过。
- 真实数据库：只执行过一次 after-run；该样本在创建 N1 时因 `OPEN_N1:CANONICAL_JSON_UNSUPPORTED` 提前失败并清理，尚未进入 SQL7 submit。根因已改为使用 Working Ledger 专用 projection hash，最小 orchestrator 测试 11/11 PASS；按“不盲目重复测试”要求没有立即重跑 Supabase。
- 剩余唯一验收动作：代码冻结和复核后，执行一次相同 non-production fixture；必须同时得到 `PASS_CLEANED`、完整 N1→N2 readback、真实 request application SQL ≤ 7 与事务回滚/重试记录。

## 单次 SQL7 after-run 结果

- Fixture：`pc_1786630126757_b09732f3cfbc9a4d`；run：`solo_5260d476f204e69c46fbd09c01fcd2e6`；结果 `FAIL_CLEANED`。
- 请求确实命中 SQL7，只执行了 1 条 snapshot application SQL、1 次协议往返、0 次事务、0 rollback/retry，随后以 `SQL7_SNAPSHOT_INVALID:seatRecord.privateProjections:PRIVATE_PROJECTION_INVALID` fail-closed；因此这不是成功路径的“1 SQL”性能结果。
- 根因：正式开局使用 content-bound read-through private projection，并不会把该 projection 持久化到 SeatControl envelope；SQL7 decoder 错误地假定 envelope 一定含该派生值。
- 修复：把原有 content-bound 编译逻辑提取为 package-only 纯函数；当 envelope 没有缓存记录时，SQL7 使用同一条快照已捕获的 route、seat authority 和 N1 world 在内存生成 viewer private projection，不增加 SQL，也不改变公开 Projection。
- 最小验证：原 read-through 与 captured-authority 纯编译结果深相等 1/1 PASS；snapshot 单 SQL/零写入合同 4/4 PASS；API typecheck PASS。
- 按测试纪律没有执行第二次真实运行。当前仍为 `REAL_SQL_NOT_VERIFIED / NOT_PERF_PASS`。

## private-projection 修复后的单次验证

- Fixture：`pc_1786631128330_19575def06dcc6f7`；run：`solo_09ba3015a921d406256c281736a06db4`；结果 `FAIL_CLEANED`。
- private projection 解码已经通过；请求仍严格停在 1 条 snapshot SQL、1 次往返、0 次事务，新的失败为 `PRESSURE_SQL7_SERVICE_INTEGRITY:PREPARED_BATCH_BINDING_MISMATCH`。
- 根因：`PreparedAutomationActionBatchV1.snapshotHash` 的既有语义是 Decision Convergence authority snapshot hash（包含冻结 AI policy artifact），而 SQL7 service/settlement/plan-builder 错误地要求它等于外层 `DecisionToNextProjectionSnapshotV1.snapshotHash`。两者绑定同一 route/chapter/Working/Seat authority，但不是同一种 envelope hash。
- 修复：保留既有 batch/convergence 权威语义；SQL7 改为验证 batch hash、全部 route/revision/state/head/seat fence 字段以及每个 action 的 authority snapshotHash 必须与 batch.snapshotHash 一致，不再混淆两种 envelope hash。
- 最小验证采用刻意不同的 SQL7 snapshot hash 与 convergence snapshot hash：service、settlement、plan-builder 共 9/9 PASS，API typecheck PASS。
- 没有再次执行真实请求；成功路径 SQL≤7 仍未取得。

## 最终 SQL7 验收

- fixture `pc_1786635397341_5f2401cb25153e18`、run `solo_8f1dd9646993d849e68bec33f3376e63`：`PASS_CLEANED`；N1→N2 提交与 readback 正确，测试数据完成清理。
- action 请求：7 application SQL、10 roundtrip、1 transaction attempt、1 commit、0 rollback、0 retry；数据库累计 query duration 3,811 ms。
- 预算实证：1 条聚合 snapshot + 6 条事务内 application SQL。`BEGIN`、`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`、`COMMIT` 仅计协议往返。
- 功能边界：HUMAN + 5 AI、Beat、Settlement、N2 opening 均由同一快照在内存确定；提交回执直接形成 Projection；Provider/LLM/model-network capability 为零。
- 真实集成修复：A-Emotion 改为从 post-Beat authority projection 编译；B0 比较其专用 `b0InputHash`；观测器正确分类 `SET TRANSACTION`。均未增加 SQL 或改变公开响应。
- 离线证据：统一门 165/166 初次通过；唯一静态合同测试修复后定向 7/7 PASS；三层 typecheck PASS。没有重复运行已通过的整套测试。
- 模块结论：`SQL7_PASS`。单样本不支持 p50/p95，因此整个性能项目仍是 `PERF_MEASURED / NOT_LATENCY_SLO_PASS`，不是最终时延 `PERF_PASS`。
