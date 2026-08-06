# Our Many Worlds — Dynamic Kernel Selector Lite
## 最终文档对照与执行门

**版本：** v1.1  
**基线：** `main@dc4a7cd10978fc3662edcb6f2cf3445c1393ddb0`  
**开发分支：** `codex/chatgpt-pro-dynamic-kernel-lite`  
**状态：** `CODE_COMPLETE_PENDING_EXECUTION_EVIDENCE`

---

# 1. 对照文档

本清单逐项对照：

1. `Our Many Worlds 动态 Decision Kernel 问题审计与 ChatGPT Pro 架构咨询 v1.0`；
2. `Our Many Worlds — Dynamic Kernel Selector Lite ChatGPT Pro 开发实施、测试、Git 交付与 Codex 独立验收方案 v1.0`。

长期完整 Dynamic Decision Instance 中的 Pressure Producers、Decision Demand、Action Operator、LLM Candidate Generator、Entity Admission、Player Thread 与独立 Instance Repository 仍是明确延后能力，不属于本轮 Lite 的缺口。

---

# 2. 本轮 Lite 代码完成项

当前分支已实现并提供测试：

- 当前 Section 的现有 Kernel 按结构化权威状态选择，不使用数组位置决定结果；
- 相同 Section 的不同状态选择不同 Kernel；
- 数组反转与 100 次重复执行保持稳定；
- 状态绑定稳定 Tie-break；
- Completed 与 Structurally Resolved Kernel 排除；
- Due／Pending Consequence、Causal Arc 与 Decision Point Actor 参与结构化评分；
- 所有现有 Affordance 先物化，再执行权威 Settlement Preview；
- 单个坏 Affordance 或坏 Kernel 被隔离并记录结构化失败原因；
- 无物质 Outcome、重复 Outcome 和不足两个唯一结果的 Kernel 被拒绝；
- 最大 Outcome Distance Pair 按作者顺序展示；
- Dynamic 失败安全回退 Legacy；
- 已提交 Legacy Fallback 可精确恢复；
- provisional／final Settlement 通过因果一致性硬门；
- Primary、Continuation、旧事件和 Capability 回合均可精确恢复；
- 事件缺失、重复、Revision 漂移、Trace 篡改、Outcome Hash 漂移和陈旧选项均 Fail Closed；
- 自由输入等价表达与点击选项进入同一 Settlement；
- Observe-only Capability 不完成 Kernel，也不生成新的 Patch 或 Durable Effect；
- Selector、Preview、恢复与自由输入绑定阶段不新增模型调用；
- `neutral-port` 与源码禁词门证明通用 Selector 不依赖《桑田诏》中文、角色名、状态路径或自然语言 Prompt；
- Outcome Hash 与 State Fingerprint 排除运行时 ID 和展示文案；
- 新测试已进入 `@ai-story/templates` 和 `@apps/openovel-runtime` 的正式测试脚本；
- 未修改 `apps/web/**`、数据库 Schema、Migration、主游戏页面、Narrator Prompt、Ending 或《凯撒》资产。

---

# 3. 实现偏差裁决

原补丁建议直接向冻结的 `settlePartOneAction` 增加 Preview Override 参数。实际实现使用：

```text
dynamic-kernel-lite-runtime.ts
dynamic-kernel-lite-settlement.ts
```

并以只读 Package Clone 暴露指定 Kernel／Affordance 给冻结 Settlement。

该偏差只有在以下硬门全部成立时可接受：

1. 冻结 Settlement 仍是唯一权威状态写入者；
2. provisional 与 final 的状态、Patch、Durable Effects、Section 和 Pending Consequence 完全一致；
3. Production Entry 与正式 Settlement Coordinator 结果一致；
4. 全量 Templates、OpenNovel、API、Story v4 与 G00—T20 回归通过。

前三项已有代码和测试；第四项由分支专用工作流执行。

---

# 4. 尚未完成的不是功能代码，而是执行证据

必须由可执行环境产生真实结果：

```text
pnpm --filter @ai-story/templates typecheck
pnpm --filter @ai-story/templates test:runtime-contract
pnpm --filter @ai-story/templates test:story-package
pnpm --filter @ai-story/templates build
pnpm --filter @apps/openovel-runtime typecheck
pnpm --filter @apps/openovel-runtime test
pnpm --filter @apps/openovel-runtime build
pnpm --filter @apps/api test:solo-story-engine
pnpm --filter @apps/api test:solo-story-engine:legacy-sangtian
pnpm test:story:branch-persistence
pnpm test:story:options
pnpm test:story:convergence
pnpm test:story:v4
pnpm test:story:real-model:g00-t20
```

规则：

- 未运行：`NOT_RUN`；
- 0 tests：`FAIL`；
- 非零退出码：`FAIL`；
- 无真实模型凭据：`BLOCKED_ENV`，不得伪报 PASS；
- 真实玩家质量验收由 Codex／产品所有者独立完成。

---

# 5. 分支 Gate

`.github/workflows/dynamic-kernel-lite-gates.yml` 只监听本开发分支，负责：

- 基线、分支、修改范围和干净工作树检查；
- 完整确定性命令矩阵；
- 非零测试计数和结构化输出验证；
- 真实模型证据检查；
- 逐命令日志、`summary.json`、SHA256 和 Workflow Artifact；
- `dynamic-kernel-lite/gates` Commit Status。

本提交用于产生新的 Push Event。只有该 Gate 的真实结果被读取并审查后，才能更新最终裁决。

---

# 6. 最终裁决规则

只有以下全部成立才能输出：

```text
CANDIDATE_BRANCH_READY
```

- 确定性 Gate 全部 PASS；
- 真实模型 G00—T20 PASS；
- 远程精确 SHA 与证据一致；
- `main` 未修改、未 push、未 merge；
- PR 未创建；
- deployment 未执行；
- Codex 玩家验收无关键事实冲突、越权选项、重复问题或假选择。

在此之前，唯一诚实状态是：

```text
CODE_COMPLETE_PENDING_EXECUTION_EVIDENCE
```
