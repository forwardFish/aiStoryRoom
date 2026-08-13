# Pressure 单次决策约 10 次 Supabase 访问性能优化实施与验收规范 v1.0

> 状态：SQL7 本轮硬门已通过；当前 `PERF_MEASURED / SQL7_PASS / ACCESS_REDUCTION_PASS / NOT_LATENCY_SLO_PASS`
> 适用范围：Pressure 主游戏 `提交决策 → 下一可玩投影` 关键路径
> 数据库：获授权的非生产 Supabase
> 事实来源：当前 `main` 代码、Pressure 冻结发布包与本规范
> 本规范不授权修改玩家页面、Prisma Schema 或 migration

> 本次实施基线：从 `main` 的 `b5c3b95afc6b9994332cf6aed7928e9ce5a76ffd` 创建专用分支 `codex/pressure-phased-performance-v1`。现有工作树中的其他未提交改动不属于本性能任务，必须保留且不得被暂存、覆盖或清理。

## 1. 背景与问题

当前 Pressure 决策链首先保证了：

- Working Ledger 单一权威；
- route、revision、control epoch 和 fence 校验；
- 幂等、CAS、崩溃恢复与审计；
- 五个无人席位零大模型、零 Provider；
- Beat、Settlement、Narrative 与 A-Emotion 的权威边界。

但当前实现没有把一次玩家决策的数据库往返数量作为硬性设计约束。静态代码路径估算显示，一次跨章节决策可能触发约 170–210 条 SQL 命令。该数字只是待实测基线，不能作为最终证据；正式验收必须使用 Prisma 查询计数和真实非生产 Supabase 分阶段计时。

主要重复开销包括：

1. 提交前构造或读取超出命令校验所需的完整游戏投影；
2. 不同模块重复读取相同的 route、runtime、decision、seat、ledger 和 world 状态；
3. 五个无人席位各自重新校验并分别开启数据库事务；
4. Orchestrator、Beat、Settlement 在同一请求中重复读取刚刚产生的状态；
5. 提交完成后再次从数据库完整重建 `/game` 投影；
6. Narrative、A-Emotion、Feed 等非必要表现层工作进入玩家等待路径；
7. 为正常请求重复重放完整 StoryEvent 历史，而不是读取当前快照。

对于 MVP，这会造成明显的并发风险：玩家数量增加时，数据库连接、网络往返、事务竞争和尾延迟会同时上升。

## 2. 冻结目标

### 2.1 玩家体验目标

- 玩家点击“提交决策”到收到下一份页面数据：**最多 6 秒**；
- 后端从接收请求到生成“下一可玩投影”：非生产 Supabase **warm p95 ≤ 5 秒**；
- 超过 6 秒判定为失败，不得通过增加等待时间、轮询次数或重试次数掩盖。

### 2.2 数据库目标

- 普通 Beat 决策的应用 SQL ≤ 6、含 `BEGIN/COMMIT` 协议往返 ≤ 8；
- 章节结束并产生 Settlement 的应用 SQL ≤ 7、含 `BEGIN/COMMIT` 协议往返 ≤ 9；其中项目所有者已于 2026-08-13 将 application SQL ≤ 7 重新提升为本轮硬门；
- 本轮必要条件是：相同成功场景中数据库访问次数可信下降，且功能、幂等、并发、恢复和权威边界不退化；
- 只有 CAS 冲突调查、显式 recovery/audit、故障注入或数据修复可以超出；正常成功路径不得超出；
- “一次”指真实发往 Supabase/PostgreSQL 的数据库命令或批量命令；
- 把几十条 SQL 放进一个 `$transaction`，不能计为一次访问；
- 性能报告必须同时给出：
  - 数据库命令总数；
  - 事务次数；
  - 各命令耗时；
  - 后端端到端耗时；
  - 玩家端端到端耗时。

### 2.3 权威与安全目标

- Working Ledger 仍为唯一行动权威；
- Supabase 仍为运行状态唯一持久化权威；
- 不新增本地数据库，不形成双写或第二权威；
- 保留幂等、CAS、routeHash、revision、controlEpoch 与 fence；
- Solo 无人席位严格零 LLM、零 Provider、零模型网络；
- 无人席位确定性计算应在内存中毫秒级完成；
- 只有当前 authored Beat 确实需要的无人席位贡献才能进入关键路径；
- 不得为了凑齐六条记录而强制写入与当前剧情因果无关的行动；
- Narrative、A-Emotion、Feed 丰富化不得阻塞下一可玩投影；
- 不得修改 `apps/web/**`、正式玩家页面、路由或文案；
- 不得修改 `prisma/schema.prisma` 或 `prisma/migrations/**`。

## 3. 三类数据及存放位置

### 3.1 API 进程共享的版本化只读缓存

以下数据属于发布内容，而不是单个玩家的运行状态。它们可以由同一 API 进程内的全部玩家、全部房间共享：

- N1–N7 章节内容；
- 决策点、决策选项及展示映射；
- Action Effect Policy；
- 零模型 AI 确定性策略；
- Narrative 模板和叙事权威目录；
- 角色公开资料；
- 事实、规则、章节配置；
- 路由对应的冻结内容版本。

缓存规则：

1. 缓存键必须至少包含 `routeHash` 和/或 `contentHash`；
2. 缓存值加载后必须保持不可变，不允许请求内修改共享对象；
3. 首次加载时校验发布 manifest、自哈希和依赖哈希；
4. 同一哈希只加载一次，并共享同一个已解析结果或 Promise；
5. 加载失败必须 fail closed，不允许返回未校验内容；
6. 新旧 routeHash 可以同时存在，旧运行继续使用旧版本；
7. 可以设置有界 LRU/引用计数，但不得在运行仍引用某版本时误删；
8. 缓存只能减少文件解析或静态内容装载，不能绕过运行时权限过滤。

角色私密事实即使来自共享只读缓存，也必须在返回玩家前按服务器确认的 viewer seat 过滤，不能整体下发到浏览器。

### 3.2 单次请求共享的权威快照

玩家提交决策后，从 Supabase 集中读取本轮所需的最小运行时权威数据：

- StoryRun/房间与玩家成员关系；
- 玩家绑定席位；
- 当前 seat control、controlEpoch、submission fence；
- frozen route 与 routeHash；
- 当前 chapter runtime；
- 当前 decisionPoint、requiredSeatIds、allowedActionTypes；
- workingRevision；
- Ledger head 和当前投影；
- 当前世界指标、承诺状态及本轮必需事实；
- 请求幂等记录或已接受行动的最小信息。

这份快照只在当前请求内存在，必须：

- 深度只读或类型层面 readonly；
- 带有 snapshot hash；
- 记录读取时的 revision、ledger head、control epoch 和 routeHash；
- 被命令校验、无人席位计算、Beat、Settlement 和下一投影共同复用；
- 禁止各模块为了“确认一下”再次读取同一状态；
- 在最终提交时通过 CAS 条件验证仍未过期。

请求结束后快照自然释放，不跨请求作为权威复用。

### 3.3 必须保存在 Supabase 的权威数据

以下数据不能只存在 API 内存或浏览器存储：

- 当前 revision 与 Ledger head；
- 玩家已提交并被接受的行动；
- 席位控制权、epoch 与 fence；
- 请求幂等记录；
- 当前章节和决策运行状态；
- Settlement 与最终权威结果；
- 必要的 StoryEvent/Outbox 记录；
- 重启后必须继续存在的承诺、事实、资源和责任状态。

浏览器 `localStorage/sessionStorage` 只允许保存草稿、展开状态等非权威 UI 状态，不得保存已成功执行的行动或替代 Supabase 权威状态。

## 4. 目标关键路径

```mermaid
flowchart TD
    A["收到玩家提交"] --> B["读取最小权威快照"]
    B --> C["绑定版本化只读内容缓存"]
    C --> D["内存校验身份、权限、revision 与 fence"]
    D --> E["内存编译玩家正式行动"]
    E --> F["仅按剧情需要计算无人席位贡献"]
    F --> G["内存执行 reconciliation、Beat 与可选 Settlement"]
    G --> H["一个短事务批量提交权威变化"]
    H --> I["使用提交结果直接组合下一可玩投影"]
    I --> J["立即返回玩家"]
    H --> K["异步 Narrative / A-Emotion / Feed 丰富化"]
```

目标形态是：

> 一次集中读快照 → 整轮内存计算 → 一次短事务批量提交 → 直接返回下一可玩投影。

## 5. 目标数据库预算

以下是设计预算，不是要求机械制造固定十条 SQL。实现可以少于该预算，但不得通过隐式 N+1 或事务内大量命令规避计数。

| 序号 | 阶段 | 目标数据库命令 | 说明 |
|---:|---|---:|---|
| 1 | 请求上下文 | 1 | 合并读取 run、membership、viewer seat 与 frozen route |
| 2 | 权威快照 | 1 | 集中读取 runtime、decision、seat control、revision、ledger head、必要状态 |
| 3 | 幂等检查 | 0–1 | 可合并进快照；若独立查询则最多一次 |
| 4 | 权威事件批量写入 | 1 | 玩家行动与必要无人席位贡献使用批量/集合式写入 |
| 5 | Ledger/Runtime CAS | 1 | 条件更新 revision、head、runtime 状态 |
| 6 | Chapter/Settlement | 0–1 | 仅章节结束时写入 |
| 7 | StoryEvent | 1 | 写入本轮完整、可重放的权威事件 |
| 8 | Outbox | 1 | 使用 `createMany` 或等价集合写入，不能逐项 N+1 |
| 9 | 必要一致性校验 | 0–1 | 尽量依赖受影响行数和 RETURNING，禁止完整重读 |
| 10 | 投影兜底读取 | 0–1 | 首选使用提交返回值；只有不能安全构造时才轻量读取 |
|  | **合计** | **6–10** | 普通决策应靠近 6–8，跨章节决策不超过约 10 |

上述表是按职责拆分的上限预算。实现时应进一步合并：

- idempotency 进入 Authority Snapshot；
- player 与 required AI action 使用一次集合插入；
- Ledger 与 Orchestrator events 使用一次集合插入；
- Runtime、Working State、Decision State 与 Ledger Projection 使用一次 CAS 更新；
- PUBLIC + 六席 Narrative Projection 使用一次集合插入；
- Narrative + A-Emotion Outbox 使用一次集合插入；
- 章节边界可使用一个 writable CTE 原子完成 Settlement、World、当前 Runtime 与下一 Runtime 变化，但必须保持 SQL 可审查且不得复制领域规则到 SQL。

因此验收时同时报告两个数字：

```text
application_sql_statement_count
database_protocol_roundtrip_count_including_begin_commit
```

事务次数目标：

- 快照读取：最多一个只读一致性事务；
- 权威提交：一个短写事务；
- Narrative/A-Emotion worker：不计入玩家关键路径，在独立事务执行。

## 6. 具体实现要求

### 6.1 版本化只读内容缓存

建立进程级内容注册表，例如概念接口：

```ts
interface PressurePublishedContentCacheV1 {
  get(routeHash: string, contentHash: string): Promise<Readonly<PressurePublishedContentV1>>;
}
```

要求：

- 复用现有冻结 loader 和验证器；
- 不复制一套内容解析逻辑；
- 缓存成功验证后的不可变对象；
- 并发首次请求共享同一加载 Promise，避免缓存击穿；
- 记录 cache hit、miss、loadMs 和 hash；
- 测试 hash 漂移、加载失败、并发首次加载和多版本并存。

### 6.2 最小权威快照读取器

当前已有 decision convergence snapshot 思路，但必须扩展为整条提交链共享，而不是只供无人席位计算。

目标接口示意：

```ts
interface PressureDecisionRequestSnapshotReaderV1 {
  read(input: {
    runId: string;
    subjectId: string;
    expectedRouteHash: string;
  }): Promise<Readonly<PressureDecisionRequestSnapshotV1>>;
}
```

快照必须包含命令编译、权限、AI、Beat、Settlement 和下一投影真正需要的最小字段。不得把完整 Prisma row、Provider、Narrative 原文或其他玩家私密数据作为方便字段塞入快照。

为了让“一次读取”成为可证明的硬合同，优先采用一个参数化 PostgreSQL CTE/LATERAL JOIN 查询，返回一个严格解码的 JSON envelope。普通 Prisma `include` 只有在查询日志证明它确实生成单条 SQL 时才能接受。不得创建新 View、表或 migration。

Snapshot 可以直接读取并验证现有 `PressureChapterRuntime.ledgerProjectionJson`，把它作为正常运行时的 query-oriented cache。普通玩家请求不得每次 `StoryEvent.findMany()` 后从头执行完整 Ledger replay。只有以下显式路径允许重放历史：

- projection 缺失或 hash 无效；
- recovery、audit 或 repair 命令；
- replay/acceptance test。

正常路径发现 projection 损坏时应 fail closed，不得在玩家 POST 中静默执行昂贵恢复。

### 6.3 内存命令与结算计划

读取快照后，纯函数生成一个提交计划：

```ts
interface PressureDecisionCommitPlanV1 {
  snapshotHash: string;
  expectedWorkingRevision: number;
  expectedLedgerHeadHash: string;
  playerAction: DecisionActionV1;
  requiredAutomationActions: readonly DecisionActionV1[];
  beatEvent: WorkingLedgerEventV1;
  nextRuntime: PressureChapterRuntimeProjectionV1;
  settlement: PressureChapterSettlementV1 | null;
  storyEvents: readonly StoryEventWriteV1[];
  outboxMessages: readonly OutboxWriteV1[];
  playableProjection: PressurePlayableProjectionSeedV1;
}
```

计划生成阶段：

- 不访问 Prisma/Supabase；
- 不调用 Provider/LLM/OpenNovel 网络；
- 不执行 Narrative/A-Emotion 投影；
- 只使用请求快照和版本化内容缓存；
- 输出可哈希、可测试、确定性的完整计划；
- 相同输入必须产生相同 plan hash。

### 6.4 无人席位处理

不得再把五个无人席位模拟成五个独立在线玩家请求。

必须先读取 authored decision 的 `requiredSeatIds` 和因果依赖：

- 若本轮结果只依赖玩家席位，则不生成无关 AI 行动；
- 若确实依赖部分无人席位，只计算这些席位；
- 若 authored Beat 确实要求全部六席，则一次快照后在内存批量计算五席；
- 所有 AI 行动按稳定 seat order 生成；
- AI 计算阶段数据库访问数必须为零；
- AI Provider/LLM/model-network 调用数必须为零；
- 持久化必须使用批量或同一短事务内的集合式写入；
- 不允许每席重复 route、runtime、seat、ledger、content 校验；
- Ledger 顺序由提交计划提前确定，最终事务一次校验旧 head 并提交整段新链。

特别说明：本优化不擅自改变已发布决策的 `requiredSeatIds`。如果当前 authored decision 明确要求六席，则五个 AI 逻辑行动仍然存在；删除的是五次独立数据库工作流，而不是删除剧情所需的五方逻辑贡献。只有 authored contract 标记 `NOT_REQUIRED` 的席位才不生成、不写入。

### 6.5 一次短事务提交

提交器必须：

1. 校验 `routeHash`、`workingRevision`、`ledgerHeadHash`、`controlEpoch` 和 fence；
2. 校验幂等键是否已存在；
3. 批量写入玩家行动与必要无人席位行动；
4. 写入完整 Ledger/StoryEvent；
5. CAS 更新 runtime；
6. 仅在章节结束时写 Settlement；
7. 批量写最小 Outbox 信号；
8. 返回已提交的下一状态种子和受影响行数；
9. 任一条件失配则整笔零写入并返回明确冲突；
10. 不在事务内加载静态内容、调用网络、生成 Narrative 或重新构建完整投影。

事务应尽量短，不允许在持有数据库锁时进行大量纯计算。

### 6.6 直接生成下一可玩投影

提交计划已包含下一 runtime、当前 viewer 和已验证的冻结内容。提交成功后，应使用：

- commit 返回的权威字段；
- 请求内 viewer/seat；
- 版本化内容缓存；
- 下一决策的最小可玩状态；

直接组合响应，不再完整调用一次当前重型 `game.read()`。

若 Narrative 或 A-Emotion 新投影尚未完成：

- 返回上一份仍合法的已发布 Narrative，或冻结内容提供的安全基础叙事；
- 明确标识表现层状态，但不得暴露内部 debug 字段；
- 下一决策按钮和必要上下文必须可用；
- 不得因等待新 Narrative 而阻塞玩家。

公共 HTTP response schema 不得随意改变；需要调整合同时必须先提交独立审批。

### 6.7 异步表现层

权威事务只写最小 Outbox 信号。事务提交后由 worker 异步完成：

- Narrative 投影；
- A-Emotion 聚合与投递；
- Feed 丰富化；
- 非必要诊断与统计。

这些任务失败不得回滚已提交的玩家行动，也不得使下一决策不可玩。worker 必须保持幂等和可重试，但玩家 HTTP 请求不能等待它们完成。

Durable Outbox 本身不能异步丢失：最小 Outbox rows 必须与权威变更在同一事务中批量落库；异步的是消费 Outbox、Provider Narrative、A-Emotion 编译和 Feed hydrate。现有逐个创建七份 Narrative Projection 与七份 Outbox 的循环应在不改变 dedupeKey 和逻辑 job 数量的前提下合并为集合写入。

### 6.8 最小接入策略：不重构整个系统

为避免过度设计，本轮只优化 `POST 提交决策` 的关键路径：

- 保留现有普通 `GET /game` 读模型；
- 保留现有表结构、领域合同和 recovery/audit 路径；
- 不新建第二套长期并行的权威链；
- 可以新增窄的 snapshot reader、pure planner、unit of work 和 commit-receipt assembler，但它们必须复用现有权威类型与 reducers；
- 不复制 Orchestrator、Beat 或 Settlement 规则；
- 不以新目录数量、接口数量或抽象层数量作为完成指标；
- 若可在现有服务中以更少文件安全实现，应优先采用更少改动；
- 旧慢路径可留作显式 recovery/audit 工具，但不能与新路径同时拥有生产写权。

不采用“上线前必须积累 1000 次 shadow 普通决策和 100 次章节边界”的重型前置条件。MVP 采用确定性 parity fixtures、真实非生产 Supabase 小样本和用户参与首轮测试逐步放量；任何 shadow 验证都必须只读、不得双写，也不得成为长期维护的平行产品实现。

### 6.9 分阶段实施与多 ChatGPT Pro 协作

本任务必须采用“小步慢走、每次只改一个问题”的方式实施。14 个阶段的边界如下：

| 阶段 | 内容 | 通过条件 |
|---|---|---|
| S0.0 | 冻结基线：记录 `BASE_HEAD`、工作树状态、脏文件和允许修改文件 | 能证明后续没有污染其他改动 |
| S0.1 | 增加观测能力：阶段耗时、SQL 数、事务尝试/提交/重试次数 | 不改变业务行为 |
| S0.2 | 只跑基线：1 次真实提交、5 次冒烟、20 次暖机观察 | 找到真实热点；状态只能是 `PERF_MEASURED` |
| S1.1 | 实现 `WorkingProjectionFastReader` 数据契约和纯校验 | 字段、hash、revision、head 测试通过 |
| S1.2 | 接入 Fast Reader，先进行非生产 shadow compare | shadow 只读，返回结果仍使用旧逻辑 |
| S1.3 | 只替换 Projection-only 路径 | Beat、恢复、审计、修复、回放仍保留事件重放 |
| S2.1 | 定义 `DecisionSubmitSnapshotV1` | 权限、跨 run/seat、过期 revision、fence、幂等性 parity 通过 |
| S2.2 | 移除提交前完整 `game.read()` | 保留提交后的 `game.read()`，行为和错误边界正确 |
| S3A | AI 批量提交契约、排序、hash、链计算 | 纯函数测试通过；无数据库、Provider 或模型网络调用 |
| S3B | 批量持久化适配器，暂不接生产 | 一次事务具备原子性、幂等性和冲突处理 |
| S3C | 正式接入 AI 批量提交 | 5 个 AI 从 5 次事务变为 1 次事务 |
| S3.5 | 使用 S0 同场景立即重新测量 | 对比 p50/p95、SQL、事务、AI append 和总耗时 |
| S4 | 仅在测量证明仍有明显收益时处理 Outbox/Narrative 批量写入 | 不因方案中存在该项就提前实施 |
| P1 | 只选择一个最大剩余热点继续优化 | 不得同时改 Feed、Orchestrator 和最终 Projection |

阶段之间不得提前混合：S1 不顺便改提交逻辑，S2 不顺便做 AI 批量，S3A/S3B 不提前接生产，S4/P1 必须等待 S3.5 测量后决定。

每个阶段最多进行三类测试：

1. 一次问题定位，先确认唯一性能或正确性假设；
2. 一次最小正确性测试，覆盖本阶段新增或改变的边界；
3. 一次与基线同场景的性能对比。

若测试失败，必须先分类为代码错误、数据/环境错误、并发冲突、事务重试或观测错误，再只重跑失败的最小用例。不得在问题未分类前反复运行整套测试。

性能对比必须固定接口、数据规模、Supabase 区域、连接池和 AI 数量，保留失败、超时和事务重试，并同时报告绝对值、p50、p95、SQL 数、事务尝试数、提交数和重试数。

#### 多 ChatGPT Pro 并发边界

多个 ChatGPT Pro 可以并发工作，但只能并发处理互不重叠的工作包；生产链集成、真实数据库写入测试和性能验收必须由单一协调者串行执行。

允许并发的工作包括：

- 只读分析热点、SQL 调用链和现有测试覆盖；
- 盘点测试 fixture、基准脚本和验收数据；
- S1.1 的 Projection 契约、纯校验和测试；
- S3A 的 AI Batch 契约、排序、hash 和纯函数测试。

不允许并发修改或测试的工作包括：

- 同时修改 `decision-command.compiler.ts`、`convergence.service.ts` 或 AI 持久化适配器；
- 同时接入 S1.2/S1.3、S2.2 或 S3C；
- 多个 Pro 同时对同一批 Supabase 数据执行写入性能测试；
- S4 与 P1 同时改持久化、Outbox、Feed 或 Orchestrator；
- 多个 Pro 同时提交、重写、覆盖或解决同一文件冲突。

每个 Pro 工作包必须明确提供：

- 基准提交 SHA；
- 唯一的允许修改文件清单；
- 明确的禁止修改范围；
- 输入、输出和完成条件；
- 测试命令、原始结果、失败分类和未解决风险。

本分支采用“一个集成者、多个工作者”模式。工作者不得自行 `git add -A`、reset、清理脏文件或宣布 `PERF_PASS`；集成者逐项审查 diff、文件范围、测试结果和准确 SHA 后，才能把工作包合入当前分支。若发生文件重叠或无法确认改动归属，必须停止该工作包，不得通过覆盖或强制合并解决。

推荐波次如下：

1. 协调者完成 S0.0；
2. 多个 Pro 并发做只读分析、测试盘点和 S1.1/S3A 纯契约准备；
3. 协调者串行集成 S0.1 并完成 S0.2 基线；
4. 按 S1 → S2 → S3A → S3B → S3C 顺序集成和验证；
5. 完成 S3.5 后，只选择 S4 或 P1 其中一个继续。

S0～S3 只能报告 `PERF_MEASURED`，不能提前报告 `PERF_PASS`。只有后端 warm p95 ≤ 5 秒、玩家端 ≤ 6 秒，且正确性、幂等、并发、隐私、恢复和下一投影可玩性全部通过，才允许报告最终 `PERF_PASS`。

项目所有者于 2026-08-13 收紧当前阶段验收口径：本轮必要条件是相同成功场景中数据库访问次数得到可信下降且功能正确；`≤ 7 SQL` 不再是当前阶段的硬门。达到该条件记为 `ACCESS_REDUCTION_PASS`。这不等于达到最终时延 SLO，也不允许省略绝对值、百分比、事务重试和端到端耗时。

## 7. 崩溃、重启与多实例

### 7.1 API 重启

API 进程崩溃后：

1. 内存中的只读内容缓存消失；
2. 服务启动或首次请求时从发布包重新加载并校验内容；
3. 玩家运行进度从 Supabase 的 runtime、Ledger、Settlement 等权威记录恢复；
4. 未完成的表现层任务从 Outbox 恢复；
5. 不丢失已提交行动，不需要本地数据库恢复。

### 7.2 提交中途崩溃

- 写事务提交前崩溃：整笔回滚，玩家可以使用相同幂等键安全重试；
- 写事务提交后响应前崩溃：相同幂等键必须返回原提交结果或可重建的等价结果；
- Outbox 尚未消费：worker 重启后继续处理，不影响权威进度；
- 不得产生“行动已写但 runtime 未推进”的部分成功状态。

### 7.3 多 API 实例

- 每个实例各自持有相同 hash 对应的只读缓存；
- 缓存之间不需要同步写入；
- Supabase 通过 CAS、唯一键和幂等记录处理并发；
- 任何实例都不能把内存快照当成跨请求锁；
- 快照过期时应快速返回冲突并让客户端刷新，不得盲目重试多次。

## 8. 阶段计时与查询计数

每次提交必须生成结构化、脱敏的阶段诊断：

```text
request_context_ms
authority_snapshot_ms
content_cache_ms
player_compile_ms
ai_compute_ms
commit_transaction_ms
orchestrator_ms
beat_ms
settlement_ms
projection_ms
backend_total_ms
db_command_count
db_transaction_count
provider_call_count
model_network_call_count
```

要求：

- 计时使用单调时钟；
- 不记录 cookie、token、DATABASE_URL、玩家私密内容或原始 Narrative；
- 查询计数必须覆盖 Prisma 产生的全部数据库命令；
- 标明命令发生在哪个阶段；
- 诊断写入不得阻塞玩家响应；
- 超过预算时报告最慢阶段和最重查询，而不是只给总时间；
- 生产环境可以采样，但验收环境必须 100% 记录。

## 9. 测试与验收方案

### 9.1 静态与类型门禁

- API full TypeScript 检查通过；
- 禁止范围 diff 为零：
  - `apps/web/**`
  - `prisma/schema.prisma`
  - `prisma/migrations/**`
- AI 依赖图中不存在 Provider、LLM、OpenAI、OpenNovel Narrative 或模型网络 capability；
- 缓存与快照类型保持 readonly；
- 提交计划生成器不导入 Prisma repository。

### 9.2 内容缓存测试

- 相同 routeHash/contentHash 的 100 个并发请求只加载一次；
- 缓存命中不访问 Supabase；
- 不同内容版本可以并存；
- hash 漂移立即拒绝；
- API 重启后能够重新加载；
- viewer 私密数据仍被正确过滤。

### 9.3 请求快照测试

- 整条命令、AI、Beat、Settlement 使用同一个 snapshot hash；
- 各阶段不会再次调用 snapshot reader；
- 快照与提交间 revision/head/epoch 变化时 CAS 零写入；
- 旧页面、跨 run、跨 seat、篡改 fence 全部 fail closed；
- 快照中不存在未授权其他席位私密字段。

### 9.4 无人席位测试

- 只需玩家席位的 Beat：AI 行动数为 0；
- 需要两个无人席位：只生成两条；
- 必须六席的 Beat：一次内存计算生成五条；
- AI compute 阶段数据库命令数为 0；
- Provider/LLM/model-network 调用数严格为 0；
- 相同快照重复计算得到相同 hash；
- seat order 改变不会改变最终确定性结果。

### 9.5 原子提交测试

- 玩家行动、必要 AI、Ledger、runtime、Settlement 和 Outbox 要么全部成功，要么全部失败；
- 相同 idempotencyKey 返回同一结果，不增加行；
- 相同 idempotencyKey 不同 payload 拒绝；
- 并发两个玩家提交时只有符合 revision/fence 的命令成功；
- 提交后响应前模拟崩溃，重试可恢复原结果；
- 不出现部分 Ledger 链或断裂 head。

### 9.6 数据库访问减少测试与长期参考预算

必须在真实 Prisma Client 上安装查询计数器，不得用 mock repository 证明数据库预算。

验收场景至少包括：

| 场景 | 数据库命令目标 | 事务目标 |
|---|---:|---:|
| Solo，当前 Beat 只需要玩家 | 应用 SQL ≤ 6；含 BEGIN/COMMIT 往返 ≤ 8（长期参考） | ≤ 2（长期参考） |
| Solo，当前 Beat 确实需要五个 AI | 应用 SQL ≤ 6；含 BEGIN/COMMIT 往返 ≤ 8（长期参考） | ≤ 2（长期参考） |
| 3 真人 + 3 无人席位 | 应用 SQL ≤ 6；含 BEGIN/COMMIT 往返 ≤ 8（长期参考） | ≤ 2（长期参考） |
| 6 真人并发提交 | 单请求应用 SQL ≤ 6；含事务往返 ≤ 8（长期参考） | 单请求 ≤ 2（长期参考） |
| 章节结算并打开下一章 | 应用 SQL ≤ 7；含 BEGIN/COMMIT 往返 ≤ 9（长期参考目标，非当前阶段硬门） | ≤ 2（长期参考目标） |

当前阶段的硬门是相同成功场景访问次数下降且不得引入新的 N+1。若数据库驱动因批量插入产生可证明不可合并的额外协议命令，必须在报告中单独列出；长期参考预算不得被静默改写。

### 9.7 真实非生产 Supabase 分阶段计时

执行顺序遵循“用户参与第一次测试”的要求：

1. 先由用户参与第一次真实后端提交；
2. 展示本次总耗时、数据库命令数和各阶段耗时；
3. 首次失败立即定位具体阶段，不先进行 30 次隐藏测试；
4. 修复并获得用户同意后，再进行 warm 样本统计；
5. p95 测试必须记录样本数量、每次耗时和环境；
6. 冷启动样本与 warm 样本分开；
7. 玩家端 ≤ 6 秒与后端 ≤ 5 秒分别报告。

正式性能通过条件：

- 后端 warm p95 ≤ 5,000 ms；
- 玩家端提交至收到响应 ≤ 6,000 ms；
- 数据库命令数符合场景预算；
- AI compute 为毫秒级且 DB/Provider/model-network 均为 0；
- Narrative/A-Emotion 不在阻塞阶段；
- 下一投影真实可玩，不是仅返回 HTTP 200；
- 数据库权威、幂等、隐私和恢复回归全部通过。

## 10. 不接受的伪优化

以下做法不能视为完成：

- 只给内容 loader 加缓存，但保留其他 150 多条 SQL；
- 把大量 SQL 放进一个事务后声称“只访问一次数据库”；
- 增大 timeout、轮询间隔或重试次数；
- 提前返回 202，但玩家仍无法看到并操作下一决策；
- 删除 fence、revision、幂等或 Ledger 校验来换速度；
- 在浏览器或 API 内存中保存玩家权威进度；
- 五个 AI 仍分别重新读取并各开事务；
- 将 Narrative/A-Emotion 错误吞掉，但下一投影仍依赖它们；
- 只用 mock、单元测试或本地 PostgreSQL 宣称 Supabase p95 通过；
- 只测平均值，不报告 p95 和最慢阶段；
- 为桑田 N1 写死捷径而破坏 Solo/2–6 人通用性。

## 11. 代码边界与预计改动

### 11.1 允许的主要后端范围

预计可能涉及：

- `apps/api/src/pressure-chapter/http/**`
- `apps/api/src/pressure-chapter/decision-command/**`
- `apps/api/src/pressure-chapter/decision-automation/**`
- `apps/api/src/pressure-chapter/orchestrator/**`
- `apps/api/src/pressure-chapter/working-ledger/**`
- `apps/api/src/pressure-chapter/persistence/**`
- `apps/api/src/pressure-chapter/game-projection/**`
- `apps/api/src/pressure-chapter/observability/**`
- `apps/api/src/pressure-chapter/product/**`
- `packages/templates/src/pressure-chapter/**` 中仅限通用只读缓存/loader，且不得改发布内容语义。

### 11.2 禁止范围

- `apps/web/**`
- 玩家页面、布局、路由、文案、图片和交互
- `prisma/schema.prisma`
- `prisma/migrations/**`
- N1–N7 剧情语义、决策文案和规则结果
- OpenNovel/Provider 权威边界
- `main` 之外未经批准的新开发分支

### 11.3 预计工作量

仅增加版本化内容缓存是小改动，预计 3–6 个文件、约 100–300 行，但无法单独解决性能问题。

完成请求级共享快照、内存提交计划、批量提交、直接投影和异步表现层属于中等偏大后端改造，预计：

- 约 8–15 个生产文件；
- 约 500–1,000 行生产与测试调整；
- 网页版 ChatGPT Pro 第一版约 1 个工作日；
- 本地审查、类型与回归测试、首次 Supabase 计时约半天；
- 若首次没有达到目标，再按分阶段耗时交回 Pro 修正。

上述数字是计划估算，不是完成证明。

范围控制原则：如果第一版超过约 15 个生产文件、引入新状态机、复制领域规则或要求修改 Schema，应立即暂停并重新审查是否发生过度设计。允许因为测试文件、类型合同或批量适配器造成合理的文件数增加，但必须逐项说明它如何直接减少关键路径数据库访问或保证等价性。

## 12. 交付与验证流程

1. 网页版 ChatGPT Pro 基于当前准确 `main` 实现生产代码；
2. 只提交到已批准的专用远程分支；
3. Pro 必须提供准确 commit SHA、parent、tree、文件清单和测试日志；
4. 本地只下载并审查该准确 SHA，不接受自述作为 PASS；
5. 检查禁止范围 diff；
6. 机械应用到本地 `main`；
7. 运行 API full typecheck 和定向/回归测试；
8. 与项目所有者共同执行第一次真实非生产 Supabase 提交；
9. 展示数据库命令数和全阶段耗时；
10. 未达标则把准确失败证据发回同一 Pro 对话继续修正；
11. 只有真实关键路径、性能、权威、隐私和恢复全部通过后，才允许声明完成。

## 13. 本轮完成定义与长期 SLO

本轮按项目所有者最新口径，在以下条件同时满足时完成：

- 相同真实成功场景中的数据库访问次数有可信下降；
- 功能、权限、幂等、CAS、fence、并发和崩溃恢复没有退化；
- Supabase 仍是唯一运行时权威；
- `apps/web/**`、Prisma Schema 和 migrations 均无改动；
- 报告保留绝对值、失败样本与不可用证据，不补写 p50/p95 或缺失 metrics。

以下是后续长期 SLO 与架构方向，不作为本轮 `ACCESS_REDUCTION_PASS` 的必要条件：

- 所有版本化静态内容可由全部玩家共享进程内缓存；
- API 重启后缓存可重建，玩家进度从 Supabase 恢复；
- 每次决策只读取一份请求级权威快照；
- 后续命令、AI、Beat、Settlement 和 Projection 复用该快照；
- AI 内存计算无数据库、Provider、LLM 和模型网络调用；
- 权威变化在一个短事务中批量、原子提交；
- 普通决策约 6–9 次、复杂跨章节决策约 10 次数据库命令；
- 长期参考口径为：普通 Beat 应用 SQL ≤ 6/含事务往返 ≤ 8，章节边界应用 SQL ≤ 7/含事务往返 ≤ 9；当前阶段以同场景成功样本的访问次数确实下降为必要通过条件；
- Narrative/A-Emotion/Feed 不阻塞下一可玩投影；
- 后端真实非生产 Supabase warm p95 ≤ 5 秒；
- 玩家提交至新页面数据 ≤ 6 秒；
- Working Ledger、幂等、CAS、fence、隐私和崩溃恢复没有退化；
- `apps/web/**`、Prisma Schema 和 migrations 均无改动；
- 项目所有者参与首次真实测试并看到完整分阶段证据。

## 14. 2026-08-13 分阶段实施记录

本节记录专用分支 `codex/pressure-phased-performance-v1` 的实际执行结果。它是证据记录，不改变前述完成定义。

### 14.1 基线与边界

- `BASE_HEAD`: `b5c3b95afc6b9994332cf6aed7928e9ce5a76ffd`（当时准确 `origin/main`）。
- 开发位置: `D:\tmp\aiStoryRoom-pressure-performance-v1` 隔离 worktree。
- 未修改 `apps/web/**`、Prisma Schema 或 migrations。
- 基线真实 non-production Supabase 提交只进入业务路径一次；在逐席 AI 写入期间以 Prisma `P2028` 失败，失败前观察到至少 16 次事务尝试。基线没有成功样本，因此没有合法 p50/p95，禁止补写或推算。

### 14.2 阶段状态

| 阶段 | 状态 | 实际结果 |
|---|---|---|
| S0.0 | 完成 | 冻结分支、基线 SHA、隔离 worktree 和禁止范围。 |
| S0.1 | 完成 | 增加请求级 SQL、协议往返、事务尝试/提交/回滚/重试及 query duration 指标；查询仅记录 hash。 |
| S0.2 | 部分完成 | 保留一次真实失败基线；按“不盲目重复测试”要求没有执行 5/20 次循环。 |
| S1.1 | 完成 | 严格解码并校验 `ledgerProjectionJson` 与 runtime 的 run/runtime/chapter/route/revision/head/state hash。 |
| S1.2 | 已实现、未实测放量 | 提供 FAST/SHADOW/REPLAY 选择器；shadow hash 不一致 fail closed。 |
| S1.3 | 已接入、默认未放量 | 普通 chapter/compiler 可显式使用 Fast Reader；默认仍为 REPLAY，显式历史读取保留 replay 实现。 |
| S2.1 | 完成并进入真实路径 | `DecisionSubmitSnapshotV1` 在一次短事务中绑定 route、W4、W5、SeatControl 与当前用户 membership；HTTP HUMAN 编译和 convergence 复用同一 authority snapshot。外层 submit hash 绑定已验证的 authority snapshot hash，不再把 Projection 的内存 `Map` 直接交给 canonical JSON。 |
| S2.2 | 普通路径完成、调查路径部分完成 | 普通提交前完整 `game.read()` 与编译后的 convergence 二次 snapshot 已移除；提交后优先使用 committed authority 直接投影，不能安全构造时才回退 `game.read()`；调查动作仍需读取 feed witness。 |
| S3A | 完成 | AI 批次按冻结 route seat order 排序，固定 batch hash 和连续 Ledger hash chain。 |
| S3B | 完成 | 提交端复算 batch hash；正常批量写事务不再 `StoryEvent.findMany()` 全量重放。 |
| S3C | 完成并经真实路径验证 | HUMAN 与五席 AI、连续 action events、Beat、Beat 后 W4、runtime cache/CAS 和下游计划进入同一 batch transaction；真实路径已越过 batch、Beat 和 W4。 |
| S3.5 | 已测，性能未通过 | 事务超时、逐席写入和 N2 Narrative 阻塞均已消除；最新真实路径返回完整 HTTP 201 响应，但仍为 111 SQL、151 往返、16 事务、约 18 秒，远未达到性能门槛。 |
| S4 | 完成 | 七份 Narrative Projection、七份 Narrative Outbox 及 A-Emotion Outbox 改为集合写入。 |
| P1 | 第一轮完成、需重新选最大热点 | Settlement 正常路径由四个事务收敛为 source preparation + atomic commit 两个事务；提交结果携带最终 chapter、Working projection 和 descriptor。N2 开场通过 `previousFrozenHash` 精确读取已与 Settlement 原子持久化的席位绑定 `PENDING` narrative，不等待 Provider，也不合成文本。真实成功样本证明功能闭环，但表明事务收敛尚未转化为足够的 SQL/时延下降。 |
| P1.1 | 完成并已实测 | N2-N7 opening 不再执行“预读不存在→append→再读 projection”，直接消费刚提交的 frozen bundle 生成 seed，并把本请求刚提交的 opening authority 传给最终 Projection。相同完整业务深度的单次样本中，next-open 从约 3,232 ms 降到 2,425 ms（-25.0%）；整体 SQL/往返/事务从 111/151/16 降到 102/134/13。总耗时没有改善，故只记 `PERF_MEASURED`。 |
| P2.1 | 完成并已实测 | committed-authority 路径不再重复读取 Capability 的 viewer authority 与 chapter runtime；viewer/world/narrative/feed 独立读取并发执行。定向测试 12/12、API typecheck 和真实 `PASS_CLEANED` 通过；SQL 102→93、往返 134→123，最终 Projection 4,809→2,622 ms，满足当前 `ACCESS_REDUCTION_PASS`。 |
| P3.1 | 完成；功能实测通过，SQL 日志证据缺失 | batch transaction 返回完整 SETTLING authority 时，直接复用 state、descriptor、Working projection 和 sealed settlement input；普通 recovery 与 authority 缺失/冲突路径仍走 durable `resume()`。真实 fixture `PASS_CLEANED` 且 N1→N2 readback 通过；本次 API 启动日志句柄在请求前失效，未取得可信 SQL 总数，因此不补写、不推算，也不为刷数字重跑。定向计数测试证明快路不再读取 N1 state/content/Working projection，durable settlement source fence 保持不变。 |

### 14.3 真实 after-run 证据

使用同一 non-production Supabase、相同 N1 solo fixture、API port 和 AI 数量；P2.1 的有效样本通过 `PRESSURE_CHAPTER_WORKER_OWNER=independent_worker` 明确关闭候选 API 对 Pressure worker lane 的所有权。没有运行 broad suite 或暖机循环。

| 运行 | 结果 | application SQL | 含 BEGIN/COMMIT 往返 | 事务尝试 | 失败点 |
|---|---:|---:|---:|---:|---|
| after-1 | FAIL | 69 | 98 | 11 | batch 最后 runtime CAS 触发 `P2028`；定位到 2 秒事务上限和重复权威读取。 |
| after-fix | FAIL | 132 | 186 | 25 | batch 已成功；旧 `runtime.resume()` 在内容证据校验失败。 |
| after-S4 | FAIL | 116 | 170 | 25 | 下游集合写减少 16 SQL/往返；B0 对 evaluation 内新封存证据的绑定规则仍不一致。 |
| final-order-check | FAIL | 18 | 26 | 4 | submit snapshot canonical hash 已通过；发现 Beat 预计算使用“玩家先、AI 后”，而持久化使用冻结 route seat order。事务在首写前 fail closed。 |
| final-settlement-check | FAIL | 39 | 53 | 7 | batch/Beat 已通过；N1 Settlement 暴露 main 原有的稀疏事实 `undefined` 与策略 canonical `null` 不一致。 |
| final-response-check | FAIL | 102 | 140 | 15 | HUMAN+AI batch、Beat、N1 Settlement 和 N2 打开均成功；最终投影立即要求尚未由异步 Outbox 生成的 N2 Narrative，返回 `PRESSURE_GAME_NARRATIVE_NOT_FOUND`。 |
| completed-response-check | 业务成功，fixture 误判并已清理 | 111 | 151 | 16 | 服务器完成完整提交并返回 HTTP 201；fixture 仍只接受 200，因而在响应 schema/readback 前标记 `UNEXPECTED_RESPONSE`。服务端端到端约 17,988 ms，累计 query duration 18,195 ms；该脚本合同已修正为接受 200/201。 |
| after-P1.1 | PASS_CLEANED | 102 | 134 | 13 | 同一 non-production Supabase、同一 N1 solo fixture、同一 AI 数量，注册、鉴权、开局、N1 投影、提交和 readback 全部通过。next-open 约 2,425 ms；服务端端到端约 19,620 ms，累计 query duration 19,776 ms。 |
| after-P2.1-worker-contaminated | 功能 PASS_CLEANED，性能样本作废 | 200 | 269 | 31 | 候选 API 仍默认拥有 Pressure embedded worker；日志证明它同时重试另一旧 run，污染本请求指标。该样本仅保留审计，不参与前后比较。 |
| after-P2.1-corrected | PASS_CLEANED | 93 | 123 | 13 | 设置 `PRESSURE_CHAPTER_WORKER_OWNER=independent_worker` 隔离后台 lane 后的唯一纠正样本；0 rollback、0 retry。最终 Projection 约 2,622 ms，端到端约 16,459 ms，累计 query duration 17,394 ms。 |
| after-P3.1 | PASS_CLEANED | 未取得 | 未取得 | 未取得 | run `solo_ed71709c442576bb3072cd755d143eb4`；注册、鉴权、开局、N1 投影、提交、N2 readback 全部通过并完成清理。API metrics 输出句柄失效，故该样本只作为功能证据，不参与 SQL 百分比计算，也未重跑。 |

每次真实失败后均先定位唯一根因并增加最小复现，再进行下一次修正验证，没有执行 5/20 次循环或 p95 压测。P1.1 后的最新一轮为正式 `PASS_CLEANED`。与 P1.1 前同样完成业务响应的样本相比，SQL 减少 9（-8.1%）、协议往返减少 17（-11.3%）、记录到的事务减少 3（-18.8%），next-open 阶段缩短约 807 ms（-25.0%）；但端到端从约 17,988 ms 增至 19,620 ms（+9.1%）。两边都只有一个样本，不能计算 p50/p95，也不能把结构性下降宣称为用户时延改善。

证据边界：上述三个完整成功样本的 SQL/往返/事务数字是在当次运行后写入本文的去敏汇总；当前候选没有保留对应的完整原始 metrics 日志。P3.1 的 `PASS_CLEANED` fixture JSON 保留在本机 ignored generated 目录，但其 API metrics 句柄失效。因此本轮可据此做工程验收和阶段决策，不应宣称存在可由 Git 候选独立重放的原始性能证据包。

### 14.4 当前判定

当前可以报告：`PERF_MEASURED / ACCESS_REDUCTION_PASS`。按项目所有者最新口径，数据库访问减少目标已经通过；由于没有 warm p50/p95 且端到端仍约 16.5 秒，不能报告最终时延 SLO 通过，状态为 `NOT_LATENCY_SLO_PASS`。

默认生产读取模式保持 `REPLAY`；只有显式设置 `PRESSURE_WORKING_PROJECTION_READ_MODE=SHADOW` 或 `FAST` 才启用新读取器。原因是既有 runtime cache 没有本轮新增的自校验 hash，尚未完成非生产 shadow parity 和旧运行迁移验证。

### 14.5 最新验收口径覆盖（2026-08-13）

项目所有者在 111→93 的结果后明确否决“仅减少即可”的完成判定，并要求把章节边界成功路径的 **application SQL ≤ 7** 从长期参考恢复为本轮硬门。因此：

- 14.4 的 `ACCESS_REDUCTION_PASS` 只保留为历史阶段判定，不是最终验收；
- 当前状态改为 `SQL7_IN_PROGRESS / NOT_PERF_PASS`；
- 必须在功能、权限、幂等、CAS、并发与恢复不退化的前提下，用一次同场景真实成功样本证明 application SQL ≤ 7；
- 在获得该证据前，不得把本任务写成完成，也不得提交最终验收结论。

原因：

- 当前阶段没有执行循环压测，不能报告合法的前后 p50/p95；
- P2.1 相对 P1.1 的同场景成功样本：SQL 102→93，减少 9（-8.8%）；协议往返 134→123，减少 11（-8.2%）；事务保持 13；
- P3.1 的定向计数测试证明快路消除了 request-scoped `resume()` 对刚提交的 N1 orchestrator state 与 Working projection 的重复读取；descriptor 读取也被复用，但它是否对应 Supabase SQL 取决于生产内容适配器，因此不计入数据库收益；
- P3.1 的真实业务样本功能通过但 metrics 缺失，不与 93 条样本做数值比较，也不据此宣称新增的真实 SQL 降幅；
- 最终 Projection 约 4,809→2,622 ms（-45.5%），端到端约 19,620→16,459 ms（-16.1%）；单样本只证明本轮方向和访问次数改善，不代表稳定分位数；
- `116/170/25`、`102/140/15` 都是不同失败深度的样本，不能与最新完整样本计算改善百分比。当前唯一可确认的是逐席 AI 事务已合并、旧事务超时根因已消失；不能据此宣称端到端性能提升；
- HUMAN/AI batch 与 Beat 已是一个权威事务；Settlement 正常路径已压缩为两个事务，并成功完成 N1 Settlement 与 N2 打开；
- HTTP 已接入 committed-authority 直接投影，不再完整重读 route/W4/Working；N2 开场可以读取 Settlement 已持久化的席位绑定 `PENDING` narrative，Provider/Narrative worker 不阻塞响应；
- P2.1 后 orchestrator 仍约 9,020 ms（其中 Settlement 约 4,742 ms、next open 约 2,604 ms），最终 Projection 已降至约 2,622 ms；下一阶段应重新选择 orchestrator 内唯一最大剩余数据库边界，不与其他模块混改。

下一阶段不得继续调大超时或用更多 smoke 掩盖当前数据。先静态拆解 orchestrator 中 Settlement 的 source preparation 与 atomic commit，只选择一个可独立验证的重复边界；不得同时改 Feed 或普通读取路径。

### 14.5 已进入真实路径的主要改动

下列改动已经通过定向测试和 API typecheck，并进入真实 Supabase 成功路径；各模块证据不自动等于最终时延 SLO 通过：

- HTTP 正常路径不再先单独持久化 HUMAN action，而是把该 HUMAN action 与五席 AI action 交给同一收敛批次；
- 批次在提交前纯计算下一 W4 orchestrator state，并在同一事务中写入 action events、W4 state event 和 runtime CAS；
- 增加 HUMAN/AI 不同 authority fence、batch hash 与下一 W4 state hash 的提交端复算；
- 增加“所有 action 已接受但投影恢复中”场景，禁止制造空批次，转由幂等 resume 继续；
- 增加共享 `DecisionSubmitSnapshotV1`，同一 snapshot 同时服务 HUMAN 编译和 AI convergence；recovery 仍强制读取当前 authority；
- Beat 与 Settlement 各自抽成 deterministic pure plan；Beat 由提交端复算并并入 HUMAN+AI batch transaction，Settlement adapter 可直接消费已准备的 sealed source，避免提交前再次重读；
- action/Beat 提交结果携带校验后的 Working projection；convergence 返回最终 chapter、Working projection 与 descriptor，HTTP 已使用它构造玩家投影并保留旧 `game.read()` 回退；
- batch planner 与持久化统一使用冻结 route seat order，避免非首席位玩家导致 Beat hash 漂移；
- 世界事实 CAS 把缺失值归一化为策略合同中的 canonical `null`，精确复现与生产组合测试通过；
- N2 已打开但 Narrative Outbox 尚未消费时，通过当前 runtime 的 `previousFrozenHash` 读取 Settlement 同事务持久化的上一章冻结、席位绑定 `PENDING` row；不合成文本、不放宽缺行/错 hash 的 fail-closed 行为。

按当前项目所有者确认的验收口径，“减少数据库访问次数且功能不退化”的实施目标已完成：完整成功样本由 111 SQL 降至 93，P3.1 又在代码与定向计数测试中去除 request-scoped settlement 的重复读取。当前范围工程与文档记录均记为 **100%**；未完成的是独立的稳定时延 SLO 与 Fast Reader 真实 shadow 放量，不影响本轮 `ACCESS_REDUCTION_PASS`，也不得被误报为 `PERF_PASS`。

### 14.6 SQL7 快速路径实施检查点（覆盖此前“100%”表述）

项目所有者随后把正常 N1→N2 成功路径的 application SQL ≤7 恢复为本轮硬门，因此上面的“100%”仅是 111→93 阶段历史记录，不再代表当前任务完成。

- 当前状态：`SQL7_IN_PROGRESS / OFFLINE_PASS / REAL_SQL_NOT_VERIFIED / NOT_PERF_PASS`。
- 已实现并接入：1 条聚合权威快照；HUMAN + 5 AI、Beat、N1 settlement、N2 opening 与玩家 Projection 内存规划；一个 Serializable 事务最多 6 个持久化语句组；事务回执直接生成 Projection，提交后零重读。
- 已增加真实计数防线：Prisma query-event 指标缺失、少计或事务内实际 application SQL 不等于 6 时，均在提交前以 `QUERY_BUDGET_EXCEEDED` 回滚；逻辑 repository-call 计数不能单独作为 SQL≤7 证据。
- 已修复审查问题：未知 snapshot 查询/解码异常 fail-closed，不再静默回退 93 SQL 路径；viewer delivery 只读取 A-Emotion aggregate 对应记录，保持旧路径精确语义。
- 离线证据：API typecheck PASS；SQL7 service/snapshot 10/10 PASS；Prisma commit 与 query-budget PASS；opening-owner 回归 11/11 PASS。
- 真实运行证据：一次 after-run 在 SQL7 submit 前的 N1 opening 失败并完成清理，错误为 `OPEN_N1:CANONICAL_JSON_UNSUPPORTED`。根因已定位并修复，但按“先定位、不要反复测试”要求未立即重跑。因此目前没有真实 7 SQL 样本。
- 最终门：代码审查收口后只运行一次同场景 non-production fixture；只有 `PASS_CLEANED`、完整 N1→N2 readback、AI Provider=0、真实 application SQL≤7 同时成立，才能写 `SQL7_PASS`。在此之前不得提交最终验收结论。

### 14.7 SQL7 单次真实运行与根因记录

- Fixture `pc_1786630126757_b09732f3cfbc9a4d`（run `solo_5260d476f204e69c46fbd09c01fcd2e6`）结果为 `FAIL_CLEANED`。
- action 请求命中 SQL7 后只执行 1 条 snapshot application SQL、1 次协议往返、0 次事务、0 rollback/retry，然后以 `PRIVATE_PROJECTION_INVALID` fail-closed。该数字只表示失败深度，不能作为成功路径性能结果。
- 唯一根因是 SQL7 把 content-bound read-through private projection 错当成 SeatControl envelope 的必有持久化字段；正式路径实际按 route、Genesis/world 与 seat authority 动态生成该私有投影。
- 修复后 SQL7 在内存调用同一 package-bound 纯编译器，以单条快照中的 route、seat authority、N1 world 生成 viewer private projection，不增加数据库访问。read-through 与 captured-authority 结果深相等测试 1/1 PASS，snapshot 合同 4/4 PASS，API typecheck PASS。
- 按“不反复测试”规则没有再次访问 Supabase。当前结论仍是 `SQL7_IN_PROGRESS / REAL_SQL_NOT_VERIFIED / NOT_PERF_PASS`，不创建最终候选提交。

### 14.8 private projection 修复后的单次验证

- Fixture `pc_1786631128330_19575def06dcc6f7`（run `solo_09ba3015a921d406256c281736a06db4`）结果为 `FAIL_CLEANED`。
- private projection 已通过；action 请求仍只执行 1 条 snapshot SQL、1 次往返、0 次事务，然后以 `PREPARED_BATCH_BINDING_MISMATCH` fail-closed。
- 根因是把外层 SQL7 authority snapshot hash 与既有 Decision Convergence authority snapshot hash 当成同一个值。后者还绑定 AI policy artifact，属于不同的权威 envelope；Prepared batch 的公开内部合同一直使用后者。
- 修复没有放宽 routeHash、orchestrator revision/hash、Working revision/state/head、SeatControl state/fence 或 batchHash。SQL7 现在验证所有这些具体权威字段，并要求六个 action 的 authority snapshotHash 与 batch convergence snapshotHash 一致。
- 使用刻意不同的两种 hash，service、settlement、plan-builder 定向测试 9/9 PASS，API typecheck PASS。没有继续第三次 Supabase 请求，故当前仍为 `REAL_SQL_NOT_VERIFIED / NOT_PERF_PASS`。

### 14.9 SQL7 最终真实验收（2026-08-13）

在每次失败后先定位唯一根因、只运行受影响最小测试，再进行下一次真实验证。最终成功样本如下：

- fixture：`pc_1786635397341_5f2401cb25153e18`；run：`solo_8f1dd9646993d849e68bec33f3376e63`；状态：`PASS_CLEANED`；
- 功能：注册、验证、会话鉴权、solo 开局、N1 Projection、决策提交、N2 readback 全部通过；章节 `N1→N2`，决策点变化正确；
- 清理：6 条 DecisionAction、1 条 ChapterSettlement、2 条 Runtime 及对应 Narrative/Outbox/Run/User 测试数据均已删除，凭据未持久化；
- 提交请求：**7 application SQL、10 次数据库协议往返、1 次事务尝试、1 次提交、0 回滚、0 重试**；累计数据库 query duration 为 **3,811 ms**；
- SQL 构成：事务外 1 条聚合权威快照；事务内 6 条 application SQL。Prisma 自动发送的 `BEGIN`、`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`、`COMMIT` 计入协议往返，不计入 application SQL；
- 相对完整成功参考 111/151/16，application SQL 减少 104 条（**-93.7%**），协议往返减少 141 次（**-93.4%**），事务减少 15 次（**-93.8%**）；相对上一成功样本 93/123/13，分别为 **-92.5% / -91.9% / -92.3%**；
- 5 个 AI 继续使用 content-owned deterministic policy；SQL7 依赖图和生产输入类型不具备 Provider/LLM/model-network capability，未把 Provider 调用放入玩家同步路径；
- 事务回执直接构造 N2 Projection，提交后没有为了响应再次读取数据库。

最终成功前定位并修复了三个真实集成问题：A-Emotion 增量事件被误当作完整 ledger、B0 policy hash 被误与外层 sealed-input hash 比较、`SET TRANSACTION` 被观测器误计为 application SQL。三项修复均保持单一权威、没有增加 SQL、没有修改玩家页面、Prisma Schema 或 migration。

离线统一验收首次运行中 165/166 通过，唯一失败是静态 HTTP 合同测试仍假定只有一个返回分支；SQL7 replay 增加了第二个同构返回对象。测试改为同时校验 SQL7 与 legacy 两个公开返回对象后，仅重跑该失败文件并得到 7/7 PASS。shared、templates、API typecheck 均 PASS。按“不反复跑整套”规则没有再次执行已通过的 165 项。

本轮判定为 `SQL7_PASS / ACCESS_REDUCTION_PASS / PERF_MEASURED`。由于只有一个 SQL7 成功性能样本，没有 warm p50/p95，也没有独立玩家端耗时分位数，因此不得标记最终 `PERF_PASS`；时延状态仍是 `NOT_LATENCY_SLO_PASS`。后续如需关闭最终 SLO，应另设阶段执行固定环境的少量 warm 分位数验收，不再改动本轮 SQL7 代码。
