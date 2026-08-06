# Our Many Worlds — Dynamic Kernel Selector Lite
## 最终文档对照与执行门

**版本：** v1.2  
**日期：** 2026-08-07  
**基线：** `main@dc4a7cd10978fc3662edcb6f2cf3445c1393ddb0`  
**开发分支：** `codex/chatgpt-pro-dynamic-kernel-lite`  
**状态：** `CODE_COMPLETE_PENDING_EXECUTION_EVIDENCE`

---

# 1. 对照范围

本报告同时对照：

1. 《Our Many Worlds 动态 Decision Kernel 问题审计与 ChatGPT Pro 架构咨询 v1.0》；
2. 《Our Many Worlds — Dynamic Kernel Selector Lite ChatGPT Pro 开发实施、测试、Git 交付与 Codex 独立验收方案 v1.0》。

第一份文档描述长期完整 Dynamic Decision Instance 架构；第二份文档明确把当前里程碑裁剪为 Dynamic Kernel Selector Lite。因此：

```text
Pressure Producers
Decision Demand / Decision Frame
Action Operator
LLM Candidate Generator
Entity Admission
Player Thread
完整自由输入 ActionSpec
独立 DynamicDecisionInstance Repository
Floor Continuation 动态化
```

均是批准的下一阶段能力，不属于本轮 Lite 的遗漏。

---

# 2. 本轮生产流程

```text
当前 Section 的现有 Kernel
→ 只读取结构化权威状态
→ 计算 Rule Gap、Pending Pressure、Arc 与 Actor 相关性
→ 物化 Kernel 的全部现有 Affordance
→ 使用冻结 Settlement 做 Preview
→ 删除失败、无物质结果和重复 Outcome
→ 选择最大 Outcome Distance Pair
→ 按作者顺序显示两个行动
→ 事件保存 Kernel、Decision Point、Pair、Outcome Hash 与 State Fingerprint
→ 动态失败时回退 Legacy
```

Settlement 仍是唯一因果写入者。Selector、恢复和选项投影均不调用模型，也不解析剧情文案。

---

# 3. Lite 需求逐项结论

| 类别 | 要求 | 代码状态 |
|---|---|---|
| Kernel | 不再按数组首个未完成项选择 | 已实现 |
| Kernel | 同一 Section 不同状态可选不同 Kernel | 已实现并有 Gold Set |
| Kernel | 反转数组与 100 次重复执行稳定 | 已实现并有测试 |
| Kernel | Completed／Structurally Resolved 排除 | 已实现并有测试 |
| Pressure | Due／Pending Rule、Arc、Decision Point Actor 参与评分 | 已实现 |
| Preview | 所有现有 Affordance 先物化再 Preview | 已实现 |
| Preview | 单个坏 Affordance／Kernel 隔离 | 已实现 |
| Outcome | 实际 State Value、Durable Predicate、Pending Rule 与 Section 进入 Signature | 已实现 |
| Outcome | 运行时 ID、事件 ID、文案不制造假差异 | 已实现并有对抗测试 |
| Outcome | 重复 Outcome 不形成假选择 | 已实现 |
| Options | 只显示两个最大差异行动并保持作者顺序 | 已实现 |
| Fallback | Dynamic 无合格候选时回退 Legacy | 已实现 |
| Fallback | 已提交 Fallback 的非默认 Pair 可精确绑定和正式结算 | 已实现并有测试 |
| Settlement | provisional／final 因果结果必须一致 | 已实现硬门 |
| Finalization | 到期后果支付后再选择下一 Kernel | 已实现 |
| Finalization | Trace 指纹必须匹配最终 `PAID` 写盘状态 | 已实现硬门 |
| Options | 提交前生成下一组选项时使用最终状态投影 | 已实现并有测试 |
| Recovery | Primary、Continuation、Fallback、旧事件精确恢复 | 已实现 |
| Recovery | Affordance ID、Outcome Hash、Revision、Fingerprint 全部校验 | 已实现 |
| Recovery | 缺失／重复事件、篡改 Trace、陈旧选项 Fail Closed | 已实现 |
| Submission | 已恢复的非默认 Pair 提交时不重新选择 | 已实现 |
| Context | 精确 WorkingSet 贯穿绑定、正式 Settlement 和 Capability | 已实现 |
| Context | 并发运行的 Pin／WorkingSet 不串线 | 已实现并有 AsyncLocalStorage 测试 |
| Free Text | 等价表达与点击进入同一 Settlement | 已实现并有测试 |
| Capability | Observe-only 不完成 Kernel、不产生 Patch／Durable Effect | 已实现 |
| Capability | Capability 回合保存 Pair 并可 finalization 后恢复 | 已实现并有测试 |
| Models | 选项选择和恢复新增模型调用数为零 | 已实现测试合同 |
| Genericity | `neutral-port` 中性 Fixture | 已实现 |
| Genericity | 通用 Selector 禁止中文、故事 ID、`availableWhen`、Prompt、actionText | 已实现源码门 |
| Packaging | Production named/default namespace 使用同一 Dynamic 实现 | 已实现 |
| Packaging | 新 Runtime Namespace API 均有运行测试引用 | 已实现 |
| Tests | Template 新测试进入显式脚本 | 已实现 |
| Tests | OpenNovel 新测试由 `tests/*.spec.ts` 自动纳入 | 已实现 |
| Scope | 未修改 `apps/web/**`、数据库、Migration、Narrator Prompt、Ending、凯撒资产 | 已确认分支 Diff |
| Git | `main` 保持精确基线 | 已确认 |

---

# 4. 本轮最终审计额外发现并修复的真实缺口

## 4.1 页面恢复正确但提交重新选择

旧实现只在 `currentSangtianOptions` 恢复 Pair；玩家提交后，基础绑定和正式 Settlement 会重新运行 Selector。

已修复：

```text
Committed Event
→ 精确 WorkingSet
→ AsyncLocalStorage 请求上下文
→ bindIncomingAction
→ formal Settlement
```

并增加非默认已提交 Pair 的正式提交测试。

## 4.2 Legacy Fallback 只能显示恢复，不能精确提交

已修复：`buildCommittedLegacyFallbackWorkingSet` 产生的精确 Pair 现在作为 WorkingSet Override 贯穿绑定与 Settlement。测试专门提交默认 Fallback 不会展示的中间 Affordance，确认没有重新退回首尾 Pair。

## 4.3 Capability 回合可能丢失已提交 Pair

已修复：Capability 脚手架使用精确 WorkingSet；回合结束时继承当前 Pair，并把新的 `nextKernelSelection` 写入事件。增加非默认 Pair、并发隔离及 finalization 后恢复测试。

## 4.4 Trace 基于中间 `DUE` 状态而非最终 `PAID` 状态

已修复：新增 `projectFinalizedPartOneSelectionState`。正式行动与 Capability 都先投影本轮会支付的 Consequence，再选择下一 Kernel。`finalizePartOneSettlement` 会验证最终状态 Revision 和 Fingerprint。

## 4.5 `nextSangtianOptions` 在 finalization 前读取中间状态

已修复：提交前生成 `TurnResult.options` 时使用同一最终状态投影，保证 Atomic Options 与最终写盘状态一致。

## 4.6 恢复只校验 ID，不校验 Outcome 语义

已修复：已有 Trace 时恢复和提交同时校验 Outcome Hash。新增同数量、同 Affordance ID、仅 Hash 被篡改的对抗测试。

## 4.7 新 API 只有 named export，没有进入默认 Runtime Namespace

已修复：最终状态投影、最终化、Pin 和精确 WorkingSet API 均进入 `@ai-story/templates` 默认 Runtime Namespace，并由 OpenNovel 测试实际调用。

---

# 5. 与原补丁说明的实现偏差

原补丁建议直接修改冻结 Engine，为 `settlePartOneAction` 增加：

```ts
{
  currentWorkingSetOverride,
  nextSelectionMode: "LEGACY_FIXED"
}
```

实际实现保留冻结 Engine，通过：

```text
dynamic-kernel-lite-runtime.ts
dynamic-kernel-lite-settlement.ts
runtime-entry.ts
```

建立外层协调器，以只读 Package Clone 把指定 Kernel／Affordance 暴露给冻结 Settlement。

为避免该偏差形成双重权威，已加入：

- Preview 使用冻结 Settlement；
- provisional／final Causal Snapshot 相等硬门；
- Production Entry／Coordinator 结果一致测试；
- 精确 WorkingSet Override；
- 最终化 State Fingerprint 硬门；
- 全部恢复与篡改测试。

**当前裁决：** 代码合同完整，但仍必须通过真实全量编译与回归后才能批准合并。

---

# 6. 明确延后的完整架构能力

| 长期模块 | Lite 当前处理 |
|---|---|
| Arc Obligation Evaluator | Section `mustEstablish`／`exitGates` |
| 多 Pressure Producers | Existing Pending Rule、Rule Gap、Arc、Actor |
| Pressure Arbiter | 确定性结构化 Score |
| Decision Demand／Frame | 复用已有 Decision Point |
| Action Operator | 复用 Authored Affordance |
| Capability Enumerator | 复用现有能力入口 |
| Candidate Generator | 只使用 Kernel `payload.options` |
| LLM Candidate | 明确延后 |
| Option Surface Writer | 复用 `actionText` |
| 新实体／新证据准入 | 明确延后 |
| Player Thread | 明确延后 |
| 完整自由输入 ActionSpec | 明确延后 |
| 独立 Decision Instance Repository | Event Trace + Atomic Options |
| Floor Continuation 动态化 | 明确延后，只做精确恢复 |

`selectionRules` 仍为：

```text
NOT_TRIGGERED
```

没有真实失败证明必须解析自然语言 `availableWhen`，因此未新增该字段，也未加入故事专用关键词、同义词或正则。

---

# 7. 已新增的自动测试层

## 通用 Selector

```text
neutral-port
数组反转
100 次稳定
状态绑定 Tie-break
重复 Outcome Trace
运行时 ID 规范化
状态／Outcome 文案独立
核心源码禁故事词
```

## Part One

```text
SEC-P1-02 Authority／Witness 状态分叉
Completed／Structurally Resolved
Structured Due Pressure
Malformed Candidate Isolation
No Material Outcome
Duplicate Outcome Fallback
Prose Independence
Production Settlement／Rebuild Parity
Continuation Settlement
Legacy Fallback 非默认 Pair 提交
最终 PAID 状态选择
```

## OpenNovel

```text
Production Entry Parity
Primary／Continuation／Fallback／旧事件恢复
Trace／Outcome Hash／Fingerprint 篡改
Missing／Duplicate Event
Equivalent Free Text vs Click
No Model Call
Capability Pair Preservation
Capability Finalization Recovery
Stale Revision Rejection
Exact WorkingSet Concurrency Isolation
Semantic State Drift Rejection
```

---

# 8. 仍必须由可执行环境产生的证据

当前工具环境无法解析 GitHub／npm DNS，且没有本地仓库或 `pnpm`。GitHub App 的 Contents API 提交没有触发分支 Push Workflow。因此以下命令仍是 `NOT_RUN`，不得写成 PASS：

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

分支已包含：

```text
.github/workflows/dynamic-kernel-lite-gates.yml
```

其会在真正执行时生成逐命令日志、非零测试计数、`summary.json`、SHA256、Workflow Artifact 和 `dynamic-kernel-lite/gates` Commit Status。

规则：

```text
未运行 = NOT_RUN
0 tests = FAIL
exitCode != 0 = FAIL
无真实模型凭据 = BLOCKED_ENV
真实玩家验收未做 = NOT_RUN
```

---

# 9. 最终 Gate

只有以下全部成立，才能输出：

```text
CANDIDATE_BRANCH_READY
```

1. Templates、OpenNovel、API、Story v4、Branch Persistence、Options 和 Convergence 全部真实 PASS；
2. 真实模型 G00—T20 PASS；
3. 远程 SHA 与证据 SHA 一致；
4. Codex／产品所有者完成玩家质量验收；
5. `main` 未修改、未 push、未 merge；
6. 未创建 PR，未主动部署，未修改数据库。

在这些外部证据产生之前，当前唯一诚实状态是：

```text
CODE_COMPLETE_PENDING_EXECUTION_EVIDENCE
```
