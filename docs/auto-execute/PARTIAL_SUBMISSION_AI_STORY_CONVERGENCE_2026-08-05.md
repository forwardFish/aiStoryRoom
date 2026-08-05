# AI 剧情推演收敛：部分代码提交检查点

## 提交边界

- 仓库：`forwardFish/aiStoryRoom`
- 分支：`codex/chatgpt-pro-ai-story-convergence`
- 冻结基线：`1b750e56858dabefb0ddb8b922c6bdcbe0574e4c`
- `main`：未合并、未改写
- 状态：部分实现已提交；最终真实模型长局验收尚未宣告通过

## 本检查点已经纳入的实现

### 1. 自由输入与当前能力面绑定

- `apps/openovel-runtime/src/intent-resolver.ts`
  - 区分 `BOUND_AFFORDANCE`、`BOUND_CAPABILITY`、`CLARIFICATION_REQUIRED`、`OUT_OF_SCOPE`。
  - 自由输入只能绑定当前服务器发布的决策能力面，不能静默冒充某个现有选项。
- `apps/openovel-runtime/src/decision-adapter.ts`
  - 推荐选项与自由输入统一受当前 Decision Point / displayed affordances 约束。
- 对应意图解析、能力路由和 Canon 后 Options 测试已加入 `apps/openovel-runtime/tests/**`。

### 2. 第一部分四节叙事机制资产

- 保留第一节已批准资产。
- 新增第二、第三、第四节已批准 `NarrativeScenePattern`：
  - `scene-patterns.section-02.approved.json`
  - `scene-patterns.section-03.approved.json`
  - `scene-patterns.section-04.approved.json`
- 补充证据陈述等级、开场 beat 合同、人物说法与客观事实边界。
- 新增幂等资产生成与完整覆盖校验脚本。

### 3. P1—P6 结构与行为验收

- `scripts/acceptance/verify-ai-story-convergence.mjs`
  - 校验四节覆盖、决策核、延迟后果、章节 floor、因果弧与关键运行时合同。
- `scripts/acceptance/verify-part-one-branch-persistence.mjs`
  - 从同一 Canon 起点走两条分支，验证状态持续分化、已完成决策不消失、Pending Consequence 不静默丢失、后续 Options 从提交后状态生成。
- `scripts/acceptance/run-real-model-g00-t20.mjs`
  - 真实 DeepSeek G00—T20 的 fail-closed 验收入口已经提交，但真实长局结果仍需以流水线证据为准。

## 尚未作为最终完成宣告的事项

1. 在当前候选分支精确 HEAD 上完成全量类型检查、构建、V4、OpenNovel Runtime 和 HTTP 回归。
2. 使用真实 DeepSeek 提供方执行唯一一次 G00—T20 长局。
3. 校验每一回合具有玩家行动、Narrative、Canon 绑定和 Reviewer 结果，且不存在 fixture/mock 信号。
4. 清理临时探针与一次性工作流，生成最终 `CANDIDATE_BRANCH_READY` 证据。

本文件只标记“部分代码已经提交”，不代表最终验收已经通过，也不授权合并到 `main`。
