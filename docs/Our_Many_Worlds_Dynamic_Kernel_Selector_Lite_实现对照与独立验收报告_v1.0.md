# Our Many Worlds — Dynamic Kernel Selector Lite
## 实现对照、架构偏差与独立验收报告

**版本：** v1.0  
**日期：** 2026-08-06  
**仓库：** `forwardFish/aiStoryRoom`  
**唯一基线：** `main@dc4a7cd10978fc3662edcb6f2cf3445c1393ddb0`  
**唯一开发分支：** `codex/chatgpt-pro-dynamic-kernel-lite`  
**当前裁决：** `CODE_COMPLETE_PENDING_EXECUTION_EVIDENCE`

---

# 1. 对照依据

本报告同时对照：

1. 《Our Many Worlds 动态 Decision Kernel 问题审计与 ChatGPT Pro 架构咨询 v1.0》；
2. 《Our Many Worlds — Dynamic Kernel Selector Lite ChatGPT Pro 开发实施、测试、Git 交付与 Codex 独立验收方案 v1.0》。

两份文档的职责不同：

- 第一份定义长期完整架构问题和未来演进方向；
- 第二份把本轮开发裁剪为 Dynamic Kernel Selector Lite。

因此，完整 Pressure Producer、Decision Demand、Action Operator、LLM Candidate Generator、Entity Admission、Player Thread 和完整 DynamicDecisionInstance Repository 不属于本轮 Lite 的未完成代码，而是玩家验证通过后的后续架构。

---

# 2. 本轮最终实现边界

本轮生产行为为：

```text
当前 Section 的现有 Decision Kernel
→ 结构化状态相关性评估
→ 对现有 Affordance 做权威 Settlement Preview
→ 过滤无物质结果和重复 Outcome
→ 选择最大 Outcome 距离的两个行动
→ 原子事件记录下一 Kernel 和 Affordance Pair
→ Dynamic 失败时回退审核过的 Legacy Kernel
```

明确没有实现：

```text
动态创造 Kernel
动态创造新关键实体
LLM 生成 statePatch / durableEffects
完整自由输入 ActionSpec 编译
Floor Continuation 动态化
新页面或新数据库
```

---

# 3. Lite 需求逐项对照

| 编号 | Lite 要求 | 实现状态 | 代码／测试证据 |
|---|---|---|---|
| K00 | 精确基线和专用分支 | 已实现 | 分支只从 `dc4a7cd...` 前进；未修改 `main` |
| K01 | 不再取数组第一个未完成 Kernel | 已实现 | `kernel-selector-lite.ts` 与 `dynamic-kernel-lite-runtime.ts` |
| K02 | 相同 Section 的不同状态选择不同 Kernel | 已实现 | `part-one-dynamic-kernel-lite.test.ts` 的 Authority/Witness 状态 |
| K03 | 数组反转不改变选择 | 已实现 | 通用和 Part One 两层反转测试 |
| K04 | 相同输入运行 100 次稳定 | 已实现 | 通用 Selector 与 Part One 两层 100 次测试 |
| K05 | 状态绑定稳定 Tie-break | 已实现 | `kernelTieBreaker(stateFingerprint, kernelId)`；Trace 保存 `tieBreaker` |
| K06 | 已完成 Kernel 不再出现 | 已实现 | Completed Kernel 测试 |
| K07 | 已被状态解决的 Kernel 不再优先出现 | 已实现 | `structurallyResolved` 与 `OBLIGATION_ALREADY_SATISFIED` |
| K08 | 到期 Pending Pressure 改变 Kernel 相关性 | 已实现 | `part-one-dynamic-kernel-pressure.test.ts` |
| K09 | 所有现有 Affordance 先物化再 Preview | 已实现 | `evaluateKernel` 遍历全部 `payload.options` |
| K10 | 单个坏 Affordance／Kernel 不拖垮整轮 | 已实现 | 结构化失败原因与候选隔离测试 |
| K11 | 无物质结果不进入候选 | 已实现 | `NO_MATERIAL_OUTCOME` |
| K12 | 同 Outcome 不能制造假选择 | 已实现 | Hash 去重、`DUPLICATE_OUTCOME` Trace、Fallback 测试 |
| K13 | 最终仍显示两个行动 | 已实现 | 最大距离 Pair；恢复作者顺序 |
| K14 | Dynamic 失败回退 Legacy | 已实现 | `LEGACY_FALLBACK` 与回退测试 |
| K15 | 已提交 Legacy Fallback 可精确恢复 | 已实现 | `buildCommittedLegacyFallbackWorkingSet` 与专用测试 |
| K16 | Preview 与正式 Settlement 因果一致 | 已实现 | provisional/final causal parity 硬门 |
| K17 | 下一 Kernel 与正式 proposedState 一致 | 已实现 | 多状态、两条分支的 production/rebuild 测试 |
| K18 | Primary 恢复不漂移 | 已实现 | Kernel、Decision Point、Affordance IDs 和 Hash Pin |
| K19 | Floor Continuation 精确恢复 | 已实现 | `decisionKernelId + decisionPointId` 双字段 Pin |
| K20 | 旧事件没有 Trace 仍兼容 | 已实现 | Legacy event deterministic recovery 测试 |
| K21 | Trace 篡改／事件缺失／重复时 Fail Closed | 已实现 | Revision、数量、Fingerprint、Event tests |
| K22 | 上一 Revision 旧选项不能提交 | 已实现 | `sangtian-dynamic-kernel-stale.spec.ts` |
| K23 | 自由输入等价表达与点击进入同一 Settlement | 已实现 | production free-text/click parity test |
| K24 | Observe-only Capability 不完成 Kernel | 已实现 | 无 patch／durable effect／completed kernel 测试 |
| K25 | Capability 回合也冻结下一组选项 | 已实现 | `nextKernelSelection` 写入和恢复测试 |
| K26 | 选项选择阶段不增加模型调用 | 已实现测试合同 | 计数 Workspace；任何调用立即失败；期望 `0` |
| K27 | 世界无关 | 已实现 | `neutral-port` Fixture 与核心源码禁词门 |
| K28 | 不读取 `availableWhen`、Prompt 或 actionText 做选择 | 已实现 | 核心源码门；结构化输入限定 |
| K29 | 只改展示文案不改变 Kernel／Pair／Hash | 已实现 | prose-independence 测试 |
| K30 | 运行时 ID 不制造 Outcome 差异 | 已实现 | transfer/event/beat ID 规范化测试 |
| K31 | 状态指纹不受场景文案和运行时 ID 影响 | 已实现 | semantic fingerprint 测试 |
| K32 | 新测试进入正式 package scripts | 已实现 | `packages/templates/package.json` |
| K33 | 页面不修改 | 已实现 | 分支 Diff 无 `apps/web/**` |
| K34 | 数据库不修改 | 已实现 | 无 Prisma Schema／migration 变化 |
| K35 | 新模型调用不增加 | 代码和测试已实现；运行证据待独立环境 | 未修改 Provider 调用链 |
| K36 | G00—T20 deterministic 通过 | **NOT_RUN** | 需要执行 `pnpm test:story:options` |
| K37 | Templates/OpenNovel/API/Story v4 全量回归 | **NOT_RUN** | 需要完整仓库和依赖环境 |
| K38 | 真实模型 G00—T20 | **NOT_RUN** | 需要 DeepSeek 凭据和网络 |
| K39 | 真实玩家 40 样本质量验收 | **NOT_RUN** | 属于 Codex／产品所有者独立验收 |

---

# 4. 与原补丁方案的实现偏差

## 4.1 没有直接修改冻结的 `part-one-runtime-engine.ts`

原方案建议给基础 `settlePartOneAction` 增加：

```ts
{
  currentWorkingSetOverride,
  nextSelectionMode: "LEGACY_FIXED"
}
```

实际实现采用两个外层模块：

```text
dynamic-kernel-lite-runtime.ts
dynamic-kernel-lite-settlement.ts
```

通过只读 Package clone 调整当前 Kernel／Affordance 的作者顺序，让冻结 Settlement 继续成为唯一因果写入者。

为避免双 Settlement 成为双重权威，已增加：

```text
PART_ONE_DYNAMIC_PROVISIONAL_FINAL_CAUSAL_MISMATCH
```

比较正式状态、Patch、Durable Effects、Section、Pending Consequence 和 Changed Paths。只有叙事压力文本允许不同。

**裁决：** 等价实现，可接受；必须由完整回归继续验证。

## 4.2 类型集中在 Dynamic 模块

原方案建议把所有新类型放入 `part-one-runtime-types.ts`。实际类型位于 Dynamic 模块并通过 `runtime-entry.ts` 正式导出，避免基础冻结合同反向依赖 Dynamic 层。

**裁决：** 不影响运行合同；后续若 Dynamic Lite 成为长期默认，可再迁移到共享基础类型。

## 4.3 `sangtian-decisions.ts` 拆出 Base

为了避免复制并重写一千余行现有 Narrative Contract 逻辑，原实现保存为：

```text
sangtian-decisions-base.ts
```

新 `sangtian-decisions.ts` 只负责：

```text
Committed Pin
Recovery
Trace Validation
Option Surface Projection
```

**裁决：** 范围扩展有合理性；完整 OpenNovel 回归是合并前硬门。

## 4.4 修改 `runtime-entry.ts`

生产入口必须让 Node ESM named import、default namespace 和构建后的 Package 都进入同一 Dynamic 实现，否则测试可能验证非生产路径。

**裁决：** 必要修改；已有 production entry/coordinator parity test。

---

# 5. 完整架构审计中明确延后的能力

下列项目属于完整 Dynamic Decision Instance，而不是本轮 Lite 未完成项：

| 完整架构模块 | Lite 处理方式 |
|---|---|
| Arc Obligation Evaluator | 复用 Section `mustEstablish`／`exitGates` |
| 多 Pressure Producers | 只使用现有 Pending Rule、Rule Gap、Arc 和 Actor |
| Pressure Arbiter | 合并进确定性 Selector Score |
| Decision Demand／Frame | 复用现有 Decision Point |
| Action Operator | 复用现有 Authored Affordance |
| Capability Enumerator | 不新增；使用现有能力入口 |
| Candidate Generator | 不新增；使用 Kernel `payload.options` |
| LLM Candidate Proposal | 明确延后 |
| Option Surface Writer | 复用现有 `actionText` |
| 新实体准入 | 明确延后 |
| Player Thread | 明确延后 |
| 完整自由输入 ActionSpec | 明确延后 |
| DynamicDecisionInstance Repository | Lite 使用 Event Trace + Atomic Options |
| Floor Continuation 动态化 | 明确延后，只做精确恢复 |

---

# 6. 新增测试门

## 通用 Selector

```text
neutral-port
数组反转
100 次稳定
状态绑定 Tie-break
重复 Outcome Trace
运行时身份字段剔除
状态展示文案剔除
核心源码禁故事词
```

## Part One

```text
SEC-P1-02 状态 A/B
Completed/Structurally Resolved
Structured Due Pressure
Malformed Candidate Isolation
No Material Outcome
Duplicate Outcome Fallback
Prose Independence
Production Settlement/Rebuild Parity
Continuation Settlement
Committed Legacy Fallback Recovery
```

## OpenNovel

```text
Production Entry Parity
Committed Primary Recovery
Old Event Recovery
Trace Tampering
Missing/Duplicate Event
Continuation Recovery
Equivalent Free Text vs Click
No Model Call
Capability Turn Trace
Stale Revision Rejection
```

---

# 7. 分支专用自动验收 Gate

新增：

```text
.github/workflows/dynamic-kernel-lite-gates.yml
```

该工作流只监听：

```text
codex/chatgpt-pro-dynamic-kernel-lite
```

计划执行：

```text
Templates typecheck / runtime-contract / story-package / build
OpenNovel typecheck / tests / build
API current solo / legacy Sangtian
Branch persistence
Deterministic G00—T20 options
Convergence
Story v4
Real DeepSeek G00—T20
```

并生成：

```text
逐命令日志
summary.json
SHA256SUMS
Commit Status
Workflow Artifact
```

工作流 YAML 已通过本地 YAML 解析，主 Bash Gate Block 已通过 `bash -n`。

但是当前 GitHub 写入连接没有触发该 Push Workflow，也没有提供手动 Workflow Dispatch 接口。因此，本报告不能把任何命令写为 PASS。

---

# 8. 仍需独立执行的命令

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

```text
未运行 = NOT_RUN
0 tests = FAIL
exitCode != 0 = FAIL
缺少真实模型凭据 = BLOCKED，不得写 PASS
```

---

# 9. `selectionRules` 裁决

```text
NOT_TRIGGERED
```

当前没有真实失败证据证明某个必要适用条件只能存在于自然语言 `payload.availableWhen` 中。

因此没有新增：

```ts
payload.selectionRules
```

也没有增加中文关键词、同义词、故事专用正则或 Prompt 特例。

---

# 10. 当前已知风险

1. 完整 TypeScript 编译和全量测试尚未在可执行仓库环境运行；
2. `forcePackage` 的生产安全依赖 causal parity gate 和全量回归；
3. 真实模型正文是否自然停在动态选中的 Decision Point 尚需 G00—T20 和玩家验收；
4. Vercel 状态不属于本功能验收；
5. 完整长期开放剧情仍需要后续 Pressure/Operator/Instance 架构，不应把 Lite 误称为最终动态平台。

---

# 11. 当前最终状态

```text
功能代码：已实现
代码级对抗测试：已补齐
远程功能分支：已提交
main：未修改
PR：未创建
merge：未发生
deployment：未执行
全量测试：NOT_RUN
真实模型：NOT_RUN
玩家验收：NOT_RUN
selectionRules：NOT_TRIGGERED
```

在所有独立 Gate 产生真实证据前，不得输出：

```text
CANDIDATE_BRANCH_READY
```

当前正确状态是：

```text
CODE_COMPLETE_PENDING_EXECUTION_EVIDENCE
```
