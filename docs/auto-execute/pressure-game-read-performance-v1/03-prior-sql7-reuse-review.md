# 上一次 SQL7 优化复用审查

## 已核对的实现

- `ce2fd4da809a144ce08631aff875eda1bfc11f7c`：SQL7 decision fast path 主实现。
- `ce92e680c48c57c1b076a937f607b414af8d45fa`：观测证据与权威提交解耦修正。
- 当前基线 `b6f512442f7e67d6c6d0dcaa2e6449bdd849de44` 已包含两者。

核心代码证据：

- `sql7-fast-path/prisma-snapshot.ts`：一个 `$queryRaw` 内用 CTE/JSONB 聚合权威材料，decoder 在查询后验证唯一行和绑定。
- `sql7-fast-path/service.ts`：snapshot 是唯一读取能力；从进入提交阶段开始，错误不得回退 legacy。
- `sql7-fast-path/prisma-commit.ts`：一个 Serializable 事务内执行六个受本地预算保护的 application operations，并分别记录 transaction attempt/commit/rollback/retry。
- `sql7-fast-path/receipt-projection.ts`：提交回执调用既有 `projectFromResolvedSources()`，不做提交后完整 `game.read()`。
- `observability/pressure-db-metrics.ts`：Prisma query event 将 application SQL、BEGIN/COMMIT 等协议往返、事务结果和累计 query duration 分开。

## 上一次为什么能从 111 降到 7

关键不是“把所有数据放进内存缓存”，而是把一次请求中的数据库边界收敛：

1. 数据仍来自 PostgreSQL，一条 snapshot SQL 读取提交所需权威；
2. HUMAN + 5 AI、Beat、Settlement、N2 opening 在内存中生成一个完整 commit plan；
3. 批量写入取代逐席事务；
4. commit receipt 已包含下一投影所需权威，避免提交后重新读取；
5. 最终实测为 7 application SQL、10 protocol roundtrips、1 transaction，功能 fixture `PASS_CLEANED`。

3,811 ms 是该成功请求的数据库累计 query duration，不是完整 HTTP wall time，也不是 warm p95。

## 本次可直接复用

| 机制 | 复用方式 |
|---|---|
| 参数化 CTE/JSONB 聚合 | M2 参考 SQL7 snapshot 的单语句结构，但重新选择 GET 字段 |
| 严格 decoder | M1 复用 route、Working cache、hash/fence validator 的唯一实现 |
| 既有 Projector | M3 直接调用 `projectFromResolvedSources()` |
| query-event 指标 | M5 按单个 GET request scope 统计，排除 worker 污染 |
| fail-closed | M1/M4 区分明确缺失、数据损坏和模式选择 |
| 原始证据口径 | SQL、roundtrip、transaction、wall time、p50/p95 分开 |

## 本次不得复制

| SQL7 内容 | GET 中的处理 |
|---|---|
| N1 first-submit eligibility | GET 必须覆盖 P0/N1-N7、六席和全部决策模式 |
| action/settlement/commit 专用字段 | 不进入 `GameReadSnapshotV1`，除非是生成公开投影必需的既有权威字段 |
| Serializable 写事务 | 普通 GET 理想为 0 transaction |
| commit receipt | GET 使用只读 snapshot，不伪装成提交回执 |
| NOT_APPLICABLE legacy fallback | FAST snapshot 损坏必须 fail-closed；只有模式选择器明确 REPLAY 才走旧链路 |
| 大范围一次性交付 | 本次按 M1-M5 单模块交付、测试和回滚 |

## 对任务书的修订影响

主任务书已升级为 v1.1 实施修订：

- 删除“当前只写文档”的过期限制；
- 固定新的 Pro 开发分支、准确 main SHA 和普通 Chat 链接；
- 增加上一次 SQL7 的复用/禁用边界；
- 明确 query-event 只作观测证据；
- 记录当前 main 启动哈希阻塞和 G0 未重测状态；
- 固定小步测试，不反复跑真实 fixture；
- 保留最终只能在 SHADOW、FAST、真实 `/game` 和 warm 样本分别通过后声明整体 PASS。
