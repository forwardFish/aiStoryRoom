# Pressure 多人互动弹窗触发链选择性吸收与主流程保护合并方案 v1.0

## 1. 结论

本次不对 `codex/pressure-modal-trigger-chain` 做传统意义上的 merge、rebase 或整提交 cherry-pick。

采用的唯一方案是：

> 以完成独立验收的最新 `main` 精确 SHA 为受保护基线，只逐模块、逐代码段吸收多人互动弹窗与触发链；同时允许吸收不改变故事、决策、五个确定性 AI 策略和 Settlement 结果的通用后端修复。任何不能证明不影响主流程的修改都不进入 `main`。

本方案首先保护已经确定的 Solo 主流程，其次才增加多人可见反馈：

```text
开场白
→ 本章连续剧情与决策
→ 玩家提交行动
→ 六席权威结算
→ 一次 DeepSeek 生成下一段“剧情＋决策”
→ 本章最终结算
→ 一次 DeepSeek 生成章末文学收束与总结
→ 玩家点击“进入下一章”
```

弹窗是上述流程的“多人事件通知层”，不是新的剧情引擎、决策引擎或第二套结算系统。

## 2. 本文档的事实来源

### 2.1 玩家页面与产品行为规范

- `docs/主游戏最终版/Our_Many_Worlds_A-Emotion多人互动MVP_主游戏页面最终冻结规范_PRD与前端实现_vFinal.md`
- `docs/主游戏最终版/Our_Many_Worlds_A-Emotion多人互动MVP_最终上线实施_后端流程测试验收_vFinal.md`
- `docs/主游戏最终版/` 下的正式 `/game` 视觉参考图

### 2.2 当前 Git 快照（2026-08-14）

| 对象 | 精确状态 |
|---|---|
| 本地 `main` | `29b3b0ad7e5201f3592748c87a0ba78126669347` |
| 远程 `origin/main` | `29b3b0ad7e5201f3592748c87a0ba78126669347` |
| 本地与远程 | 完全一致 |
| 当前基线提交 | `fix(rooms): map pressure role ids to canonical seats` |
| 候选远程分支 | `origin/codex/pressure-modal-trigger-chain` |
| 候选远程分支 SHA | `ec262bdc463839edaf4318991e7c460d7f7620c8` |
| 两者 merge base | `b5c3b95afc6b9994332cf6aed7928e9ce5a76ffd` |
| 候选本地修复导出 | `D:\tmp\pressure-modal-natural-chain-scan-25e6` |

注意：`D:\tmp\pressure-modal-natural-chain-scan-25e6` 是本地导出的候选源码，不是当前仓库中的可验证 Git 提交。它只能作为代码来源和审查材料，不能直接被称为已交付分支。

开始正式整合前，必须重新确认：

1. N1 多 Beat 与章末总结开发已经完成独立验收；
2. 本地 `main` 与远程 `main` 已确定唯一、相同的受保护 SHA；
3. 工作树干净，或者全部未提交文件的归属和范围已明确；
4. 弹窗整合从这个精确 SHA 开始，不使用旧 merge base 代替当前主线。

## 3. 用户批准的吸收范围

### 3.1 必须吸收

1. 多人互动的三类关键弹窗：
   - `PROMISE_BROKEN`：承诺破裂；
   - `CRISIS`：危机发生；
   - `STAGE_VICTORY`：阶段胜利。
2. 弹窗的确定性触发、Viewer-safe 投影、持久化、投递、确认和重放保护。
3. 多个弹窗同时出现时的队列与优先级：

```text
CRISIS
→ PROMISE_BROKEN
→ STAGE_VICTORY
```

4. 玩家关闭弹窗后，相应事件仍以现有页面的中心卡片或事件记录保留。
5. 不改变故事、决策、确定性 AI 策略和 Settlement 结果的通用后端修复。
6. 候选实现中职责清晰、可以被 N1–N7、其他世界和未来多人玩法复用的“多人影响与触发核心”。

### 3.2 `CROSS_IMPACT` 的范围

`CROSS_IMPACT` 是多人行动影响的中心卡片或事件反馈，不是第四类关键弹窗。

本轮可以接通它所需的事件投影与持久化，但不把它改成强制遮挡玩家的弹窗。

### 3.3 暂不吸收

- Feed 全量产品扩建；
- 新页面或新路由；
- 新数据库表或 migration；
- 新状态机；
- 新的剧情、决策或 Settlement 权威；
- AI 决定是否触发弹窗；
- 为某个 N1 文本、人物或选项写专用触发补丁。

## 4. 必须保护、不得改变的主流程

### 4.1 剧情与决策

- N1–N7 的故事内容、节点顺序和章节推进条件不因弹窗整合改变；
- 已注册的决策点、选项集合、顺序、行动类型和自由输入能力不改变；
- DeepSeek 仍只负责文学表达和动态决策表达，不负责真实结算；
- 一次玩家决策最多只调用一次用于下一段“剧情＋决策”的 DeepSeek；
- 章末只在正式结算后调用一次，用于章末文学收束与总结；
- 弹窗不得额外触发 DeepSeek。

### 4.2 五个确定性 AI 席位

- 五个 AI 的身份、权限、策略、合法行动映射和选择结果不改变；
- 确定性 AI 选择过程中 Provider 调用数仍为 0；
- 同一权威输入下，整合前后的五席 action type、payload、policy ref 和 action hash 必须一致。

### 4.3 Settlement 与数值

- 弹窗只读取 Settlement 已经产生的权威事件或状态变化；
- 弹窗不得修改事实、资源、五项明面数值、隐藏数值、章节结果或下一节点；
- 弹窗失败不得回滚已经成功提交的 Settlement；
- Settlement 失败时不得提前展示声称结果已经发生的弹窗。

### 4.4 页面

- 继续使用正式 `/game` 三栏页面；
- 不引入 `pressure-chapter-game-v1` 平行页面；
- 不改总体布局、路由和导航；
- Solo 页面默认不出现无关的多人 Feed 或弹窗；
- 弹窗只能在当前 `app.js`、`main-game.css` 和正式页面数据合同内适配。

## 5. 候选分支审计结论

### 5.1 为什么禁止整分支合并

候选分支从较老的 merge base 演进，整分支差异同时包含：

- 旧的 Pressure 页面和并行游戏渲染器；
- 旧的 Solo 行动链；
- 剧情、内容包和运行时接线；
- 对当前动态 Narrative、自由输入、SQL7 等现有能力的覆盖或删除；
- 弹窗功能本身。

因此，传统 merge/rebase/cherry-pick 会把弹窗功能与旧主流程一起带入，无法证明不会破坏当前已经确定的体验。

### 5.2 当前 `main` 已经具备的部分

当前主线已经有：

- 正式 `/game` 中的通用关键弹窗容器；
- `critical-backdrop`、`critical-modal` 等基础样式；
- 游戏投影中的 modal queue 合同与类型校验；
- A-Emotion 投影的基础队列结构。

当前主要缺口不是重新制作一套页面，而是：

> 把权威 Settlement 事件稳定地派生为三类 Viewer-safe 弹窗事件，并完成可靠持久化、投递、确认、去重和刷新恢复。

## 6. 候选 12 文件修复的分类

`D:\tmp\pressure-modal-natural-chain-scan-25e6` 相对候选远程 SHA 的 12 个文件，不按整文件覆盖，而按以下分类逐段适配。

### 6.1 `ADAPT_REQUIRED`：弹窗闭环所需

| 文件族 | 可吸收行为 | 约束 |
|---|---|---|
| `a-emotion-persistence/prisma-adapters.ts` 及测试 | 使用现有 `StoryEvent` 与 `EventDelivery` 正确保存和路由弹窗事件 | 不新增表；必须 fail closed；不能扩大 audience |
| `persistence/working-ledger.prisma-adapter.ts` 及测试 | 弹窗/事件确认的幂等持久化和现有事件合同适配 | 不改变行动、结算或 Narrative 内容 |

### 6.2 `ADAPT_IF_REQUIRED`：只有触发链确实需要才吸收

| 文件族 | 候选行为 | 采用条件 |
|---|---|---|
| `packages/shared/src/pressure-chapter/b0/core.ts` | 允许同次裁决产生、且经过严格哈希密封的证据参与因果校验 | 必须证明 PromiseBroken 合法触发离不开它；非法引用测试必须全部继续拒绝 |
| `chapter-settlement/chapter-commit-record.ts` 及测试 | 当 `before === null` 时允许首次创建新事实 | 只修正首次合法事实写入；不得改变已有事实更新与章节胜负 |

### 6.3 `SEPARATE_OPTIONAL`：有价值，但不与弹窗功能绑在同一提交

| 文件族 | 价值 | 为什么拆开 |
|---|---|---|
| `projection-plan/authority-downstream.ts` 及测试 | 相同 NarrativeProjection 重放收敛；内容漂移继续拒绝 | 与 N1 Narrative 和投影链重叠，必须等 N1 独立验收后单独评估 |
| `seat-control/seat-control.service.ts` 及测试 | 加强默认行动重放对 run、seat、epoch、policy 和 hash 的绑定 | 属于 AI 行动安全加固，不是弹窗功能；必须单独证明五 AI 输出不变 |

### 6.4 `TEST_ONLY`

| 文件 | 处理方式 |
|---|---|
| `integration/production-composition.spec.ts` | 只提取仍适用于当前 main 的合同断言，不复制旧组合根 |

## 7. 明确拒绝吸收的内容

以下内容即使存在于候选分支，也不进入本次整合：

- `pressure-chapter-game-v1.js`；
- `pressure-chapter-game-v1.css` 的整文件导入；
- parallel workbench、测试产品页或替代 `/game` 页面；
- `index.html`、bootstrap 或路由对平行页面的引用；
- P0–N7 剧情、场景、人物资料和 Catalog 修改；
- 决策选项、自由输入、Action Guard 或决策呈现修改；
- 五个确定性 AI 的策略、动作预算或默认选择修改；
- Settlement 规则、章节关闭条件和数值规则修改；
- SQL7、聚合快照和性能链的删除或旧版回退；
- DeepSeek Provider、模型、Prompt 和调用次数修改；
- Prisma schema、migration、Supabase 表或生产数据修改；
- Run Router、Solo 创建入口或 `/game/action` 公共合同修改；
- 任何故事专用、角色专用、中文关键词专用的触发补丁。

候选 CSS 中三类弹窗的色彩和视觉层级可以作为参考，但必须重新适配到现有 `main-game.css`，不能启用整套候选页面。

## 8. 模块清单

### M0：受保护基线与行为指纹

| 项目 | 内容 |
|---|---|
| 职责 | 固化整合前的主流程、五 AI 行动和页面行为，作为不可回归基线 |
| 非职责 | 不修改任何产品代码 |
| 准确文件 | 新增测试证据与必要的聚焦测试；不修改正式页面 |
| 输入 | 精确 `main` SHA、N1 测试 Run、三玩家测试 Run |
| 输出 | 剧情/决策快照、五 AI action hash、Provider 调用数、Settlement 结果、页面截图 |
| 依赖 | 已验收的 N1 多 Beat 与章末总结 |
| 测试 | Solo N1→N2；三玩家同一节点；刷新/重试 |
| 回滚 | 无产品修改，无需回滚 |
| 玩家参与节点 | 基线完成后，玩家确认真实 `/game` 流程正确 |
| 问题归属 | 基线不正确则停止弹窗整合，先修原主流程 |

### M1：确定性触发派生器

| 项目 | 内容 |
|---|---|
| 职责 | 从 Settlement 权威事件派生 `PROMISE_BROKEN`、`CRISIS`、`STAGE_VICTORY` 和 `CROSS_IMPACT` |
| 非职责 | 不决定剧情、行动、结算、数值或页面样式 |
| 准确文件 | 当前 A-Emotion trigger/projector/contracts 相关文件及聚焦测试；实施前按最新 main 再列准确清单 |
| 输入 | Settlement 结果、授权事实、承诺关系、阈值迁移、里程碑状态、viewerSeatId |
| 输出 | 不含敏感信息的 `AEmotionEventV1` |
| 依赖 | Settlement、B0 allowed facts、席位可见性 |
| 测试 | 每类正例、反例、未知状态、未确认承诺、未授权 viewer、同次密封证据 |
| 回滚 | 单独回退 M1 提交，主流程继续运行但不产生弹窗 |
| 玩家参与节点 | M1 后先看三类事件是否在正确条件产生，不先改视觉 |
| 问题归属 | 触发错归 M1；事实错归 Settlement；可见性错归 Viewer Guard |

触发原则：

```text
Settlement 先产生真实结果
→ Trigger Deriver 只读取结果
→ Viewer Guard 过滤玩家可见内容
→ 生成弹窗事件
```

禁止：

```text
DeepSeek 判断是否触发
页面根据文字关键词猜测触发
前端自行比较隐藏状态
弹窗反向修改 Settlement
```

### M2：事件持久化、投递和确认

| 项目 | 内容 |
|---|---|
| 职责 | 通过现有 StoryEvent、EventDelivery、Outbox 保存、投递、确认和幂等重放 |
| 非职责 | 不派生事件语义，不渲染页面，不更改结算 |
| 准确文件 | `a-emotion-persistence/**`、必要的 Working Ledger ack 适配及聚焦测试 |
| 输入 | M1 的 Viewer-safe 事件、runId、viewerSeatId、幂等键 |
| 输出 | 可恢复的投递状态和已确认状态 |
| 依赖 | 现有 Prisma 模型和 Outbox，不新增数据库结构 |
| 测试 | 重复投递、刷新、网络重试、确认重试、同键内容漂移、错误 viewer |
| 回滚 | 单独回退 M2；保留 Settlement，停止弹窗投递 |
| 玩家参与节点 | 刷新页面后已确认弹窗不重放，未确认弹窗可恢复 |
| 问题归属 | 丢事件/重复事件归 M2；触发内容错误归 M1 |

必须满足：

- 同一事件的完全相同重放视为成功；
- 同一键但 payload、audience 或 authority 不同必须拒绝；
- 后台投递失败可以重试，但不得重复 Settlement；
- 未授权席位不得写入或读取对应 EventDelivery；
- 不使用 Narrative 文本作为幂等依据。

### M3：正式 `/game` 弹窗呈现

| 项目 | 内容 |
|---|---|
| 职责 | 在现有正式页面渲染三类关键弹窗、队列和关闭后的持久卡片 |
| 非职责 | 不推导触发，不读取隐藏权威，不重建页面布局 |
| 准确文件 | `apps/web/public/app.js`、`apps/web/public/main-game.css` 及对应浏览器测试 |
| 输入 | 正式 `/game` 投影中的 modal queue 和 Viewer-safe event card |
| 输出 | 三类弹窗、关闭/稍后处理、焦点恢复和中心卡片 |
| 依赖 | M2 投影；冻结三栏页面 |
| 测试 | 三类视觉、优先级、200ms 队列切换、键盘焦点、输入草稿保留、窄屏 |
| 回滚 | 单独回退 M3，后端事件仍保留但页面不弹窗 |
| 玩家参与节点 | 用户在真实 `/game` 亲自测试三类弹窗 |
| 问题归属 | 颜色/遮罩/按钮归 M3；弹错对象归 M1/M2 |

M3 是玩家可见改动。实施前必须再次提交准确文件、修改前后示意、测试与回滚说明，获得项目所有者批准。当前文档只批准范围，不等于批准未展示的具体视觉 diff。

### M4：主流程保护与多人验收

| 项目 | 内容 |
|---|---|
| 职责 | 证明弹窗功能有效且没有改变 Solo 主流程 |
| 非职责 | 不以测试失败为理由直接扩大产品范围 |
| 准确文件 | 聚焦合同测试、API 测试、真实 `/game` 浏览器测试和证据报告 |
| 输入 | M0 基线与 M1–M3 候选实现 |
| 输出 | 对照结果、截图、精确 SHA、失败归属 |
| 依赖 | M0–M3 |
| 测试 | 下文验收矩阵 |
| 回滚 | 任一主流程指纹变化，回退对应模块提交 |
| 玩家参与节点 | 三玩家和 Solo 真实页面最终验收 |
| 问题归属 | 按 M1 触发、M2 投递、M3 页面、原主流程四层分类 |

## 9. 依赖方向

```text
Settlement 权威结果
        ↓
M1 Trigger Deriver
        ↓
Viewer Guard
        ↓
M2 StoryEvent / EventDelivery / Outbox
        ↓
正式 /game 投影合同
        ↓
M3 现有三栏页面弹窗与事件卡片
```

依赖只能单向。页面、DeepSeek 或弹窗事件不得反向修改 Settlement。

## 10. 实际整合步骤

### Gate 0：完成并冻结 N1 主流程

1. 等待 N1 多 Beat 与章末总结专用 Pro 分支形成真实产品提交；
2. Codex 对精确远程 SHA 做独立审查和测试；
3. 用户在真实 `/game` 验收；
4. 合并并同步 `main` 后记录 `PROTECTED_MAIN_SHA`；
5. 只有 `local main = origin/main = PROTECTED_MAIN_SHA` 才进入弹窗工作。

不能在 N1 Pro 分支仍修改 Settlement、Working Ledger、Projection 的同时并行落地弹窗代码，否则双方会在同一权威链互相覆盖。

### Gate 1：建立 M0 基线

在 `PROTECTED_MAIN_SHA` 的干净验证副本中记录：

- N1 每个 Beat 的剧情与决策；
- N1 章末总结与进入 N2；
- 五 AI 的确定性行动和 hash；
- Settlement 的事实、数值和下一节点；
- DeepSeek 调用次数；
- Solo 与三玩家的 `/game` 页面截图；
- 刷新、重复提交和网络重试行为。

### Gate 2：逐模块、逐 hunk 适配

顺序固定为：

```text
M1 触发派生
→ 聚焦测试与审查
→ M2 持久化投递
→ 聚焦测试与审查
→ M3 页面呈现
→ 用户真实页面测试
→ M4 全链回归
```

每次只从候选源码提取一个经过证明必要的代码段，不整文件覆盖，不 cherry-pick 旧组合根。

### Gate 3：暂存前审批

在任何提交前提供：

1. 全部 staged 文件；
2. 每个文件对应的已批准功能；
3. 全部玩家可见文件；
4. 整合前后主流程指纹对比；
5. 测试结果与已知问题；
6. 回滚提交边界。

未经确认不提交、不推送。

### Gate 4：范围化提交

建议拆成可独立回退的提交：

```text
feat(pressure): derive viewer-safe multiplayer modal events
fix(pressure): persist and acknowledge modal delivery idempotently
feat(game): render approved multiplayer critical modals
test(pressure): protect solo flow during modal integration
```

是否推送由项目所有者另行明确授权；不默认推送、部署或迁移。

## 11. 验收矩阵

### 11.1 弹窗功能

| 场景 | 期望 |
|---|---|
| 已承诺但尚未破裂 | 不弹 `PROMISE_BROKEN` |
| 承诺破裂但尚未被合法确认 | 不弹，避免提前泄密 |
| 承诺破裂且由调查、公开证据或授权事实确认 | 只向收件人或授权观察者弹窗 |
| 危险值跨过配置阈值 | 弹一次 `CRISIS` |
| 危险值已经在阈值内但没有发生新跨越 | 不重复弹窗 |
| 里程碑首次达成 | 弹一次 `STAGE_VICTORY` |
| 里程碑刷新或重放 | 不重复弹窗 |
| 三类事件同时到达 | 按 CRISIS → PROMISE_BROKEN → STAGE_VICTORY 展示 |
| 玩家关闭第一弹窗 | 约 200ms 后展示下一弹窗 |
| 玩家关闭全部弹窗 | 对应中心卡片仍可查看 |
| 刷新页面 | 已确认事件不重放，未确认事件可恢复 |
| 重试相同请求 | 不重复 Settlement、不重复 EventDelivery |

### 11.2 权限和隐私

- 未授权席位看不到事件、对象、证据和角色私密信息；
- `SUSPECTED`、隐藏承诺、调查中证据不会被弹窗提前确认；
- PUBLIC、PRIVATE、指定席位 audience 必须 fail closed；
- 页面只接收玩家可见文案，不显示 factId、evidenceId、hash、Provider、Prompt 或内部错误码。

### 11.3 Solo 不回归

整合前后必须相同：

- 开场白、N1 Beats、决策顺序和选项；
- 自由输入处理；
- 五 AI 行动及 action hash；
- Settlement 事实、数值和章节推进；
- DeepSeek 调用次数；
- 章末总结和“进入下一章”；
- 正式 `/game` 三栏布局；
- 当前已提交的窄屏资源显示行为。
- 当前已提交的 Pressure roleId → canonical seatId 房间路由行为。

### 11.4 多人真实流程

至少使用三个真实席位完成：

1. 同一事件对授权玩家弹窗、对未授权玩家不弹；
2. 三类弹窗各触发一次；
3. 同时触发时顺序正确；
4. 刷新和重新进入 Run 不重复；
5. 玩家输入框草稿、当前剧情和决策不被弹窗清空；
6. 关闭弹窗后可以继续正常提交决策。

## 12. 可以额外吸收的好能力

在不扩大产品范围的前提下，可以吸收以下工程能力：

- Viewer-safe、fail-closed 的 audience 校验；
- Outbox 失败重试，不回滚已成功 Settlement；
- 完全相同事件重放幂等，不同 payload 漂移拒绝；
- 弹窗只消费结构化权威事件，不解析 Narrative 文本；
- trigger scope oracle/guard 测试，防止触发器偷偷读取无关状态；
- 与现有 StoryEvent/EventDelivery 外键和 ID 约束兼容；
- 弹窗队列、确认和刷新恢复；
- 关闭后恢复键盘焦点并保留输入草稿；
- 关闭弹窗后中心卡片继续保留事件上下文。

这些能力必须进入相应模块，不能以“顺便优化”为由混入故事、决策、AI 或 Settlement 变更。

### 12.1 可复用多人影响核心

如果候选代码已经按下列职责分开，可以把对应模块作为通用能力适配到当前架构，而不是只复制三个弹窗的表面效果：

| 可复用模块 | 唯一职责 | 通用输入 | 通用输出 |
|---|---|---|---|
| `Impact Event Contract` | 描述“谁的行动对谁产生了什么可见影响” | 权威行动引用、结果引用、actorSeatId、targetSeatIds、visibility | 结构化、不可反写 Settlement 的影响事件 |
| `Trigger Rule Registry` | 根据配置和权威状态迁移判断事件类型 | before/after、承诺状态、阈值、里程碑、规则版本 | `CROSS_IMPACT` 或三类关键弹窗事件 |
| `Viewer Scope Guard` | 决定某个席位可以看到事件中的哪些字段 | event、viewerSeatId、knownBy、audience policy | Viewer-safe 事件投影或拒绝 |
| `Event Delivery` | 持久化、投递、去重、确认和刷新恢复 | Viewer-safe 事件、幂等键、run/seat 绑定 | StoryEvent、EventDelivery 和 ack 状态 |
| `Modal Queue Projector` | 把已授权关键事件排成页面队列 | 未确认事件、类型优先级 | 不含领域判断的 modal queue |

这些模块应当满足：

- 不出现 `N1`、胡宗宪、九堰等故事专用判断；
- 不依赖某一个世界的 JSON 路径或角色数量；
- 阈值、事件类型、可见性和展示优先级通过窄合同或配置输入；
- 不读取 Narrative 文本，不用中文关键词判断事实；
- 不直接调用 DeepSeek；
- 不直接写入资源、事实、章节状态或下一节点；
- 每个模块可以用不含桑田剧情的合成 fixture 单独测试；
- N1–N7 只提供不同权威输入，不复制七套触发代码。

### 12.2 复制方式

“可以复制”是指复制经过审查的通用模块或最小代码段，并适配当前 `main` 的窄合同；不代表保留候选分支的旧组合根和旧依赖。

执行时按以下顺序判断：

```text
当前 main 已经等价
→ 标记 ALREADY_EQUIVALENT，不复制

候选模块职责单一、依赖方向正确
→ 标记 ADAPT，复制通用核心并适配当前合同

候选模块混有旧剧情、旧页面或旧结算
→ 只提取可证明必要的纯函数/合同/测试

无法拆开或会形成第二权威
→ 标记 REJECT，不复制
```

适配完成后，其他世界要使用多人影响机制，只需提供：

```text
权威行动和结算结果
+ 事件规则配置
+ 席位可见性配置
+ 页面允许展示的安全文案
```

不需要重新开发新的弹窗触发系统。

## 13. 失败与停止条件

出现以下任一情况立即停止整合并报告：

- 需要修改 N1–N7 剧情或 Catalog 才能让弹窗工作；
- 需要改变五 AI 的动作或 Provider 调用；
- 需要改变 Settlement 结果、章节关闭条件或明暗数值；
- 需要新增数据库表、migration、路由或平行页面；
- 弹窗必须读取隐藏信息或 Narrative 文本才能触发；
- 需要修改三个以上既有业务模块但无法确定唯一失败归属；
- N1 Pro 工作仍在改同一文件或权威链；
- Solo 基线输出、action hash 或 DeepSeek 调用次数发生变化；
- 玩家可见 diff 超出事先批准的弹窗范围。

## 14. 最终交付判定

只有同时满足以下条件，才能说“弹窗触发链已安全吸收”：

1. 没有整分支 merge/rebase/cherry-pick；
2. 每个模块独立提交、独立测试、可以单独回退；
3. Solo 主流程与 M0 行为指纹一致；
4. 五 AI 策略和 Settlement 结果一致；
5. 三类弹窗在真实三玩家 `/game` 正确触发、排队、确认和恢复；
6. 权限、隐私、幂等和刷新测试通过；
7. 玩家确认视觉和交互；
8. 本地与远程精确 SHA 状态清楚；
9. 未经授权没有部署、迁移或操作真实用户数据。

在这些条件完成前，只能说“候选模块已适配”或“聚焦测试通过”，不能说整体合并完成。
