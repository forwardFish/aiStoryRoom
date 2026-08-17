# Pressure 多人每席独立推进与章末汇合：ChatGPT Pro 开发任务书 v1.0

## 1. 背景与唯一目标

桑田 Pressure 的多人模式应当是“多个独立的单人席位体验，在章末或明确多人触发点汇合”，而不是每次点击后等待所有真人，也不是每个中间 Beat 都进行六席统一结算。

本任务唯一目标：在不改变 Solo 主链、剧情内容、正式 `/game` 页面和数据库结构的前提下，完成多人模式的以下闭环：

```text
每名真人席位读取自己的剧情、事实和当前决策
→ 提交后立即幂等保存自己的行动
→ 只推进自己的 Beat 游标
→ 立即看到自己的下一段剧情和下一决策
→ 其他真人席位保持自己的进度
→ 所有真人完成本章后进入一次章末汇合门
→ AI 只补 AI 控制的空缺席位
→ 复用既有 Working Ledger、Beat、Settlement 和下一章权威链
→ 各真人读取各自可见的章末结果或下一章内容
```

## 2. 源码基线与专用分支

- 仓库：`forwardFish/aiStoryRoom`
- 基线分支：实时远程 `main`
- 本次审计时本地 tracking SHA：`6c75b21d4b27d6c419795cefde0dbf2bea190f44`
- Pro 专用分支：`codex/chatgpt-pro-multiplayer-seat-flow-v1`
- 已存在的前置模块：`apps/api/src/pressure-chapter/multiplayer-seat-beat/`
- 前置提交：`06112af2 feat(pressure): plan multiplayer seat beat cursors`

Pro 必须先核对源码包内 `BASELINE.txt`。如果分支基线、公共合同或以下依赖文件与任务书不一致，必须停止并报告，不能机械套用旧设计。

## 3. 当前状态（必须以源码复核）

| 能力 | 当前状态 | 说明 |
|---|---|---|
| 每席独立 Beat 游标纯函数 | 已实现 | 只根据作者 Beat 包与该席已接受行动前缀计算 |
| 第一名真人行动在等待前写入 | 部分实现 | 现有 convergence 仍围绕共享 activeDecision，不能支持真人连续多个 Beat |
| 真人连续行动持久化 | 未完成 | 第二 Beat 起仍可能被共享 decision pin 拒绝 |
| 每席独立 `/game` 决策投影 | 未完成 | 页面仍可能读取共享章节决策 |
| 中间 Beat 不做六席结算 | 未完成 | 需要独立提交策略 |
| 章末汇合和 AI 补空席 | 未完成 | 需要单一章末门与恢复语义 |
| 重复请求幂等重放 | 必须补齐 | 重放必须先于“当前 Beat 已变化”检查 |
| 崩溃恢复 | 必须补齐 | 章末处理中断后重试不能重复结算 |

## 4. 不可破坏的单一权威

1. Story Package / JSON：决定章节、Beat、人物材料和合法决策。
2. Working Ledger：保存真人和 AI 的正式行动；不得新增第二行动表或浏览器权威。
3. Beat 推进器：决定当前席位或章末汇合时走到哪一拍。
4. Settlement：唯一决定真实状态和数值变化；DeepSeek 不得计算数值或胜负。
5. Narrative：只把真实状态与合法决策写成文学剧情；不得反写 Settlement。
6. `/game` Projection：只投影当前真人可见内容；不得保存权威状态。

## 5. 模块清单

### M2 — Human Action Persistence

- **职责**：Multiplayer 真人每次提交后，先幂等写入既有 Working Ledger，再返回该席的新游标。
- **非职责**：不推进共享章节；不调用 AI；不执行 Settlement；不修改其他真人游标。
- **输入**：冻结 route、subject、seat authority、chapterRuntimeId、chapterId、decisionPointId、公开命令、当前该席游标。
- **输出**：`ACCEPTED | REPLAYED` 与持久化后该席 Beat 游标。
- **依赖**：既有 Formal Interaction、Working Ledger、Seat Control、M1 游标纯函数。
- **失败归属**：授权、旧游标、不同载荷复用幂等键、Working Ledger 冲突必须有明确内部错误码。
- **Solo 边界**：`participantMode !== MULTIPLAYER` 时必须委托现有 Solo 路径或拒绝进入本模块；绝不改变 Solo 事件合同。

### M3 — Viewer-Scoped Story and Decision Projection

- **职责**：Multiplayer `/game` 根据当前 viewer seat 的持久化行动前缀计算该席当前 Beat，并读取该席故事包、事实、Narrative 与合法决策。
- **非职责**：不推进别的席位；不写数据库；不重新实现决策规则；不修改正式页面。
- **输入**：run route、viewer/seat authority、当前章节、Working Ledger 投影、作者 Beat 包。
- **输出**：保持现有 `PressureChapterGameProjectionV1` 公共合同的 viewer-scoped 投影。
- **隐私**：不得泄漏其他席位私人事实、行动、Narrative 或下一决策。
- **页面**：`apps/web/public/**` 默认禁止修改；现有页面应只因后端返回不同合法数据而自然显示。

### M4 — Intermediate Beat Submission Policy

- **职责**：明确区分中间 Beat 与章末 Beat。
- **中间 Beat**：只保存当前真人行动并推进该席游标；共享 ChapterRuntime 保持未结算；五个或剩余 AI 不行动；不触发六席 convergence、Settlement 或章末 Narrative。
- **章末 Beat**：当前席进入 `CHAPTER_READY_FOR_CONVERGENCE`，但在其他真人未完成时仍不得汇合。
- **输出**：`AWAITING_DECISION | CHAPTER_READY_FOR_CONVERGENCE`。
- **禁止**：不得用 N1 专用判断；必须从任意章节作者 Beat 包的 `closesChapter` / 顺序合同得出。

### M5 — Chapter-End Convergence and Recovery

- **职责**：只有所有真人席位均为 `CHAPTER_READY_FOR_CONVERGENCE` 时，进入一次章末汇合门。
- **真人**：使用已经持久化的真实行动，不重新提交、不改写、不补默认行动。
- **AI**：只为 route 中 `AI_ACTIVE` 的席位按既有确定性策略补齐；禁止 Provider/LLM 选择 AI 行动。
- **结算**：复用既有 Beat / Settlement 权威链，不建立第二结算器。一次章末门可以在内部按作者 Beat 顺序折叠既有权威步骤，但不得对外暴露中间共享状态，不得重复进入章末门或重复结算。
- **恢复**：进程在 `RESOLVING_BEAT`、`SETTLING` 或章末提交后中断，GET/重试必须使用既有 durable resume 恢复；不得创建第二次行动、第二个 Settlement 或新的 Narrative 权威。
- **输出**：`WAITING_FOR_HUMANS | CONVERGED | ALREADY_PROGRESSED` 及权威章节状态。

## 6. 依赖方向

```text
作者 JSON / Beat Package
        ↓
M1 Seat Beat Cursor（已存在，纯函数）
        ↓
M2 Human Action Persistence
        ↓
M3 Viewer-Scoped Projection
        ↓
M4 Intermediate/Chapter-End Policy
        ↓
M5 Chapter-End Convergence
        ↓
既有 Beat → Settlement → Narrative → 下一章
```

领域模块不得依赖 Web 页面；页面不得计算 Beat、结算或权限。

## 7. 允许修改范围

必须先读源码再给出准确文件，原则上仅允许：

- `apps/api/src/pressure-chapter/multiplayer-seat-beat/**`
- 新增职责单一的 `multiplayer-seat-progression/**`
- 新增职责单一的 `multiplayer-chapter-convergence/**`
- `apps/api/src/pressure-chapter/integration/**` 中必要的窄适配器
- `apps/api/src/pressure-chapter/http/**` 中 Multiplayer 分流接线
- `apps/api/src/pressure-chapter/game-projection/**` 中 viewer-scoped 投影接线
- `apps/api/src/pressure-chapter/interaction/**` 中 Multiplayer 内部决策授权标记
- `apps/api/src/pressure-chapter/orchestrator/**` / `runtime/**` 中复用已持久化行动与 durable resume 的窄入口
- `apps/api/src/pressure-chapter/working-ledger/**` 中不改变 Solo 默认语义的可选内部事件标记
- `apps/api/src/pressure-chapter/persistence/**` 中确有测试证据的查询字段补齐
- 对应聚焦测试

如果需要修改三个以上既有模块、公共合同、数据库 schema、迁移或玩家页面，必须先暂停并提交准确扩展说明，不能自行扩大范围。

## 8. 明确禁止修改

- `apps/web/public/**`、正式 `/game` 三栏布局、文案、样式、路由和交互。
- 桑田 P0–N7 的故事、人物、决策选项、JSON 格式或内容。
- DeepSeek Provider、Prompt、模型配置与调用次数。
- Prisma schema、数据库迁移、Supabase 表、线上数据。
- Solo 的 SQL7/FAST/普通权威语义；不得让 Multiplayer 分流改变 Solo。
- 五个确定性 AI 的策略内容。
- 新页面、平行 Projection、第二 Working Ledger、第二 Settlement、浏览器状态权威。
- `main`、`release`、部署、迁移、PR 和真实用户数据。

## 9. 必须实现的真实流程

以两名真人 A/B、其余四席 AI、N1 八个 Beat 为验收样例：

1. A/B 初始都看到各自第一 Beat。
2. A 提交第一 Beat：行动立即持久化；A 看到第二 Beat；B 仍看到自己的第一 Beat。
3. A 可连续完成全部八个 Beat；期间 B 不被推进，共享 Working revision/Settlement 不应因中间 Beat 提前完成。
4. 同一 A 请求原样重放：返回相同结果，不新增 Working Ledger 事件。
5. B 再逐 Beat 完成；在 B 最终 Beat 前仍不汇合。
6. B 最终 Beat 后只进入一次章末汇合门；四个 AI 席位由既有确定性策略补齐。
7. 章末完成后 A/B 刷新得到各自可见结果或下一章；不得泄漏对方私有内容。
8. 重复 GET、重复最终提交和 Worker 恢复不得重复结算。
9. 新 Solo Run 的开场、第一次决策、一次提交、结果剧情、下一决策和刷新恢复必须与基线一致。

## 10. 必须执行的测试

### 聚焦测试

- M2：单席持久化、另一席不变、连续前缀、缺口拒绝、相同键重放、不同载荷冲突、Solo 拒绝进入。
- M3：两席同时读取不同当前 Beat；私人事实隔离；无写入；公共合同不变。
- M4：中间 Beat 不调用 convergence/Settlement/AI；最后 Beat 只标记 ready。
- M5：未全员 ready 时零 AI/Settlement；全员 ready 时 AI 只补 AI_ACTIVE；重复调用零重复结算；RESOLVING/SETTLING 可恢复。

### 仓库回归

必须运行并报告实际命令、tests/pass/fail/skip/todo：

```text
@apps/api typecheck
Pressure interaction / Working Ledger tests
Pressure decision convergence tests
Pressure game projection tests
Pressure HTTP facade tests
Pressure product/composition tests
Solo story engine regression
git diff --check
```

### 真实环境

使用测试 Supabase、两个真实认证会话、一个新 Multiplayer Run 执行第 9 节完整流程。只跑 mock 或内存测试不得声明整体通过。

## 11. 性能与日志

- 为真实双人流程记录：访问上下文、命令编译、真人持久化、每席投影、章末汇合、AI 补齐、Settlement、页面 GET 的分段耗时。
- 性能不是本任务的通过替代品；语义正确优先。
- 内部错误码、Provider、哈希、SQL 和诊断字段不得显示给玩家。

## 12. 必须交付

Pro 必须在同一普通 Chat 中提供可下载工件：

1. 基于准确基线的完整 patch。
2. changed-files ZIP（仅本任务文件）。
3. delivery ZIP，包含 patch、changed files、manifest、测试报告、架构说明。
4. `manifest.json`：基线 SHA、目标分支、每个文件路径/大小/SHA-256、工件 SHA-256。
5. 测试报告：实际运行与 `TESTS_NOT_RUN` 明确分开。
6. 修改文件清单、模块边界、已知风险、回滚方式。

只给计划、伪代码、代码片段、不可下载附件或自述“已完成”不算交付。

## 13. 禁止操作与禁止声称

- Pro 不得提交、推送、合并、建 PR、部署、迁移或操作真实用户数据。
- 未运行真实测试不得声称通过。
- HTTP 200、静态检查、单元测试或 Pro 自述不得冒充真实双人验收。
- 不得宣称 N2–N7 内容已经可玩；本任务只实现通用运行逻辑，不生成章节内容。

## 14. Codex 独立验收门

Codex 收到工件后必须：

1. 验证 ZIP、manifest、文件大小和 SHA-256。
2. 在准确远程基线的隔离验证树执行 patch apply check。
3. 审查所有文件是否越过 Solo、页面、数据库、故事内容和 Provider 边界。
4. 逐模块执行聚焦测试与仓库回归。
5. 使用真实双人新 Run 完成第 9 节流程。
6. 证明 Solo 黄金流程无回归。
7. 只有全部通过，才允许机械落地到专用分支；之后是否合并 `main` 必须另行取得项目所有者授权。

## 15. 回滚

- 每个模块独立提交、独立回滚。
- M2–M5 任一模块失败时，不得用页面回退、默认行动、跳过校验或改写故事掩盖。
- 回滚后 Multiplayer 恢复到基线行为；Solo 必须始终保持基线行为。
