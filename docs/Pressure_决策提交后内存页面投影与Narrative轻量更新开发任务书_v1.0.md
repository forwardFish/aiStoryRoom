# Pressure 决策提交后内存页面投影与 Narrative 轻量更新开发任务书 v1.1

> v1.1 修订：在原有“提交后内存页面投影＋Narrative 轻量更新”范围前增加通用 Beat 提交策略与身份化 NPC 章末决策。中间 Beat 不再强制生成五个 AI 正式行动，也不调用 Settlement；只有 `closesChapter=true` 的章末 Beat 才解析被触发的 NPC 行动并执行一次统一结算。

## 1. 文档用途

本文档用于指导**网页版 ChatGPT Pro 普通 Chat 模式**完成 Pressure 玩家决策提交链路的主要开发，将流程从：

```text
每个 Beat 都计算五个 AI 行动并完成六席收敛
→ 再次从 Supabase 读取完整 /game
→ 重新拼装玩家页面
→ 返回浏览器
```

改为：

```text
通用 Beat 提交策略
→ 中间 Beat 只保存真人行动，不生成 NPC 正式行动，不执行 Settlement
→ 章末 Beat 才按身份和权威事实解析 NPC 行动，并执行一次统一 Settlement
→ 提交前已取得的玩家页面权威快照
＋ 同一次提交产生的权威回执
→ 纯内存编译结算后的页面来源
→ 复用现有唯一 /game Projector
→ 立即返回浏览器
→ 后台 Narrative 完成后轻量更新
→ 后台完整回读只负责校验，不阻塞玩家
```

本文档是 ChatGPT Pro 开发与 Codex 独立验收任务书，不是完成声明。文档本身不授权提交、推送、部署、数据库迁移或玩家页面改版。

ChatGPT Pro 必须先阅读源码包中的：

- 仓库根目录 `AGENTS.md`
- `docs/standards/高内聚低耦合与模块化开发标准_v1.0.md`
- `docs/Pressure_GET_game_SQL7式聚合快照性能优化开发任务书_v1.0.md`

### 1.1 固定协作角色

```text
网页版 ChatGPT Pro 普通 Chat
→ 阅读脱敏源码和任务书
→ 研究方案
→ 编写主要产品代码与测试
→ 交付 patch、changed-files ZIP、manifest 和测试报告

Codex
→ 核对 main、基线和工作树
→ 准备并扫描脱敏源码包
→ 向 Pro 发送任务书并保存对话链接
→ 审查 Pro 工件并机械落地到经批准的专用分支
→ 独立运行聚焦测试、类型检查、构建、真实 Supabase 和真实 /game 验收
→ 发现问题后把准确失败证据退回原 Pro 对话修正
```

以下方式不得代替本任务所称的 ChatGPT Pro：

- Codex 自己编写主要产品代码；
- Codex 子代理或本地模型；
- API 模型；
- ChatGPT Deep Research、Work 或 Agent 模式；
- 只输出方案、伪代码或口头报告。

ChatGPT Pro 的自述、附件内报告或其声称的测试通过都不是验收结果。只有 Codex 在准确基线和完整仓库中的独立验证才可以把模块标记为 PASS。

### 1.2 Pro 对话与分支前置条件

本任务已经获得项目所有者批准使用独立 Pro 开发分支，准确分支名固定为：

```text
codex/chatgpt-pro-pressure-post-commit-projection-v1
```

该分支必须从**派发当时实时远程 `origin/main` 的准确 SHA** 创建，不得从当前脏工作树、本地过期 `main`、其他 feature 分支或已有 Pro 分支派生。

创建流程必须是：

```text
1. 当前 main 任务先完成收尾，释放 main-writer.lock
2. git fetch origin main
3. 读取并核对 local main、origin/main、git ls-remote origin main 三 SHA
4. 确认 main 工作树完全干净
5. 从准确 origin/main SHA 创建：
   codex/chatgpt-pro-pressure-post-commit-projection-v1
6. 普通非强制推送这个新分支
7. 回读本地分支、tracking ref、git ls-remote 三 SHA一致
8. 记录这个 SHA，作为给 ChatGPT Pro 的唯一源码基线
```

禁止把当前未提交性能修改顺手带入新分支。它们必须先由原任务完成范围化测试、提交和推送，或经项目所有者批准后备份移出；不能通过切分支掩盖脏工作树。

正式派发前，Codex 必须记录：

```text
repository: forwardFish/aiStoryRoom
exact main SHA: <派发时重新读取>
approved Pro branch: codex/chatgpt-pro-pressure-post-commit-projection-v1
source ZIP: <文件名>
source ZIP size: <字节>
source ZIP SHA-256: <哈希>
ChatGPT Pro conversation URL: <普通 Chat 对话链接>
```

本次分支创建已经获得批准；该批准只覆盖上述准确分支。Pro 不得直接写 `main` 或 `release`。Pro 的提交、推送、合并 `main` 和部署权限仍必须分别取得授权，不能从“允许创建分支”自动推导。

M1–M4 是连续依赖的同一性能纵切，优先在一个保存完整上下文的 Pro 普通 Chat 中顺序完成。M5 涉及 authenticated SSE、前端 storage 和间接玩家可见行为，只有取得对应页面/API边界批准后才可派发；如果拆到独立 Pro 对话，必须提供相同准确基线和前序已验收工件，禁止口头假设其已存在。

## 2. 当前基线与已知证据

本文档编写时的代码基线为：

```text
branch: main
local HEAD: 9194933e085e781d4b0908096f14aaf7d5f691cb
origin/main: 9194933e085e781d4b0908096f14aaf7d5f691cb
```

当前工作树另有正在进行的性能诊断与修正，ChatGPT Pro 工件不得直接应用到这个脏工作树。Codex 开始机械落地前必须重新确认：

```text
main writer lock 不存在
git status --porcelain 为空
local main = origin/main = 实时远程 main
```

已完成的一次真实 Solo N1 决策测量为：

| 阶段 | 实测耗时 |
|---|---:|
| SQL7 尝试及判定不适用 | 约 794 ms |
| 访问上下文读取 | 约 1,067 ms |
| 玩家行动编译 | 约 1,285 ms |
| 五席计算与六席收敛 | 约 2,895 ms |
| 提交后 `/game` 页面投影 | **约 14,597 ms** |
| 服务端总耗时 | 约 20,641 ms |
| 浏览器观测总耗时 | 约 20,978 ms |

另外，一次独立普通 `GET /game` 实测约为 15,575 ms。它不是上述 POST 的额外组成部分，但证明当前完整页面权威回读本身仍然很重。

这是一轮诊断证据，不代表稳定 p50 或 p95。实施后必须重新执行冷启动与多次 warm 测量。

## 3. 根因

### 3.1 当前提交回执不足以生成完整页面

现有 `DecisionSubmitSnapshotV1` 主要包含：

- 决策收敛权威快照；
- viewer 的 room、run、subject、seat 和 controller 绑定；
- submit snapshot hash。

它没有完整携带 `/game` 立即返回所需的玩家页面来源，例如：

- 玩家身份投影；
- 五项公开指标；
- 玩家资源与 Token；
- 当前 Narrative 投影；
- Feed 页；
- 章末总结与确认门所需来源。

现有 `DecisionConvergenceResultV1.committedAuthority` 只包含：

```text
chapter
workingProjection
chapterDescriptor
```

这能证明章节与 Working Ledger 已经真实提交，却不足以证明结算后的五项指标、玩家资源、章末总结或同次事件投影。

### 3.2 现有快速入口仍会访问数据库

`PressureChapterGameProjectionService.readFromCommittedAuthority()` 虽然接收了刚提交的章节权威，但仍需要读取 viewer、world、Narrative、Feed 等来源。因此它不是零数据库的内存投影。

### 3.3 不应再造第二个页面 Projector

仓库已经存在唯一正式投影入口：

```text
PressureChapterGameProjectionService.projectFromResolvedSources()
```

并且已有 `GameReadSnapshotV1` 与聚合快照读取基础。正确修复是把提交前来源和提交后回执编译成这个入口需要的 `resolved sources`，而不是复制一套 `/game` 拼装规则。

## 4. 目标与非目标

### 4.1 目标

1. 中间真人行动提交或章末统一结算成功后，响应关键路径都不再执行完整 `/game` 数据库回读。
2. 页面先收到的章节、决策、五项指标、资源等全部来自已提交的真实权威，不是预测值。
3. 复用现有唯一 `projectFromResolvedSources()`，不形成第二套页面规则。
4. Narrative 尚未发布时返回明确的 `PENDING` 投影；发布后只轻量更新 Narrative。
5. 使用 SHADOW 模式逐字段比较内存投影与数据库完整回读，通过后才切 FAST。
6. N1–N7、Solo 与多人共用相同机制，不写 N1 专用分支。
7. 中间 Beat 只持久化当前真人玩家的合法行动和 WorkingDelta，不自动补五个 NPC 行动。
8. 只有章末 Beat 才解析 AI 控制席位，并且 NPC 选择必须由身份规则和权威事实驱动；哈希只能用于最高分并列时打破平局。
9. Settlement 每章只执行一次；DeepSeek 不参与 NPC 行动、数值或结算裁定。

### 4.2 非目标

本任务不负责：

- 修改剧情内容或 Prompt；
- 修改玩家合法行动集合、Catalog 或 Action Guard 的语义；
- 修改 Settlement 的计算公式、HIGH/MID/LOW 条件或指标增减规则；
- 为单个 N1 输出编写硬编码剧情补丁或关键词策略；
- 修改 `/game` 三栏布局、CSS、视觉文案或交互设计；
- 新增数据库表或 migration；
- 用 DeepSeek 计算指标、资源、胜负或章节推进；
- 保证 DeepSeek 冷生成在 6 秒内完成；
- 优化普通初次 `GET /game` 的全部延迟，后者由既有 GET 聚合快照任务负责。

本任务**允许并要求**修改：Beat 提交时机、AI 自动行动调用时机、NPC 确定性选择算法、提交批次内容和 Settlement 调用时机。上述修改必须通过独立模块完成，不得把身份判断散落到页面、Prompt、数据库适配器或章节专用分支中。

## 5. 不可破坏的权威原则

### 5.1 Settlement 仍是唯一结果权威

所有会改变游戏状态的字段必须来自同一次成功提交产生的权威结果：

```text
章节与 revision
当前 Beat 与 decisionPoint
Working Ledger
五项公开指标
玩家资源与 Token
Capabilities
章末总结状态
同次提交产生的 Feed/A-Emotion 事件
```

纯内存模块只能应用权威回执，不能重新计算或推测这些字段。

### 5.2 DeepSeek 只负责文学表达

DeepSeek 不得参与：

- 数值增减；
- 是否进入下一 Beat 或下一章；
- 某个行动是否成功；
- 资源扣除；
- 事实、证据或权限裁定。

### 5.3 `PENDING` 不是假剧情

立即响应可以包含：

```text
narrative.status = PENDING
```

但不得填入预测的 Narrative 正文。后台完成后再用已校验、viewer-safe 的 Narrative 更新该区域。

### 5.4 同一规则只有一个实现

- 页面结构与字段规则：现有 `projectFromResolvedSources()`。
- 结算结果：Settlement 与提交事务回执。
- Narrative 内容：现有 Narrative 发布链。
- 快照解码与 viewer 隔离：现有 `GameReadSnapshotV1` 合同与验证器。

新增模块不得复制这些规则。

## 6. 总体数据流

```text
玩家 POST 决策
    │
    ├─ MA：BeatSubmitPolicyV1
    │      ├─ closesChapter=false → INTERMEDIATE_ACTION_ONLY
    │      └─ closesChapter=true  → CHAPTER_COUNCIL_COMMIT
    │
    ├─ M1：一次读取 SubmitPageAuthoritySnapshotV1
    │      ├─ 决策权威
    │      └─ viewer-scoped 页面来源
    │
    ├─ 玩家行动编译
    │
    ├─ INTERMEDIATE_ACTION_ONLY
    │      ├─ 只保存本次真人行动与 WorkingDelta
    │      ├─ AI 策略调用数 = 0
    │      ├─ Settlement 调用数 = 0
    │      └─ 推进下一 Beat
    │
    ├─ CHAPTER_COUNCIL_COMMIT
    │      ├─ MB：依据身份、权威事实和本章累计行动解析 NPC
    │      ├─ 无职责触发的 NPC → DEFAULT_PASS
    │      ├─ MC：一次批量提交章末真人/NPC行动
    │      └─ Settlement 只执行一次
    │
    ├─ M2：产生 PostCommitPageAuthorityReceiptV1
    │      └─ 只包含同次提交后的真实变化或完整已解析来源
    │
    ├─ M3：纯内存合并
    │      pre-submit sources + post-commit receipt
    │      → post-commit resolved sources
    │
    ├─ 现有唯一 Projector
    │      projectFromResolvedSources()
    │      → PressureChapterGameProjectionV1
    │
    ├─ 浏览器立即得到下一 Beat/决策/指标/PENDING Narrative
    │
    └─ M4：后台 Narrative 发布
           → 现有 authenticated SSE 推送 viewer-safe Narrative 更新
           → 前端只替换匹配 identity 的 Narrative 区域
```

## 7. 模块清单

## MA：Beat 提交策略

| 项目 | 内容 |
|---|---|
| 唯一职责 | 根据当前 Beat 是否关闭章节，决定本次只保存真人行动，还是执行章末 NPC 解析与统一 Settlement |
| 非职责 | 不读取数据库、不选择 NPC 行动、不计算 Settlement、不生成 Narrative |
| 输入 | beatId、`closesChapter`、participantMode、viewerSeatId、controllerTopology、authoring requiredSeatIds |
| 输出 | `BeatSubmitPlanV1` |
| 权威来源 | 已冻结 Beat authoring；`closesChapter` 是当前 MVP 唯一章末标记 |
| 依赖 | 现有 Beat progression 与控制权拓扑 |
| 测试 | N1.B01–B07 为中间模式，N1.B08 为章末模式；N2–N7 fixture 通用 |
| 回滚 | 切回旧收敛路径，不修改历史 Run |
| 问题归属 | Beat 分类或提交计划 |

建议新增：

```text
apps/api/src/pressure-chapter/beat-submit-policy/contracts.ts
apps/api/src/pressure-chapter/beat-submit-policy/policy.ts
apps/api/src/pressure-chapter/beat-submit-policy/policy.spec.ts
```

建议合同：

```ts
interface BeatSubmitPlanV1 {
  schemaVersion: "pressure_beat_submit_plan_v1";
  mode: "INTERMEDIATE_ACTION_ONLY" | "CHAPTER_COUNCIL_COMMIT";
  humanSubmissionSeatIds: readonly SeatIdV1[];
  npcResolutionSeatIds: readonly SeatIdV1[];
  invokeSettlement: boolean;
}
```

通用规则：

```text
closesChapter=false
→ INTERMEDIATE_ACTION_ONLY
→ npcResolutionSeatIds=[]
→ invokeSettlement=false

closesChapter=true
→ CHAPTER_COUNCIL_COMMIT
→ 只解析当前由 AI 控制且属于章末合同的席位
→ invokeSettlement=true
```

不得在代码中判断 `N1.B08`、`N1` 或具体剧情名称。未来 N2–N100 只要使用相同 Beat authoring 合同即可复用。

Solo 与多人共用相同规则：

```text
Solo：中间 Beat 只有真人席位行动；章末由五个 NPC 响应。
多人：真人控制席位提交自己的行动；AI 控制的空缺席位在章末才响应。
```

MA 不建立第二套 Settlement，也不改变任何席位行动的效果合同。

## MB：身份化 NPC 章末决策

| 项目 | 内容 |
|---|---|
| 唯一职责 | 章末根据身份规则、权威事实和本章累计行动，从合法 Catalog 中选择 NPC 行动 |
| 非职责 | 不写数据库、不调用 DeepSeek、不修改玩家行动、不决定 Settlement 结果 |
| 输入 | seatId、合法行动、WorkingDelta、权威 factRefs、席位承诺、资源与权限、冻结 NPC policy |
| 输出 | `NpcDecisionResolutionV1`，包含行动或 DEFAULT_PASS、得分依据与 policy hash |
| 权威来源 | 内容包中的席位策略与当前权威状态 |
| 依赖 | 现有 AI decision policy loader、Action Guard 合法行动集合 |
| 测试 | 确定性、身份差异、事实条件、越权拒绝、同分哈希、0 Provider |
| 回滚 | 使用 DEFAULT_PASS；不得恢复哈希取余作为主要策略 |
| 问题归属 | NPC 触发或选择策略 |

当前 `SHA256_CANONICAL_PREFIX_MODULO_RANKED_NON_DEFAULT_V1` 只能保留为**同分裁决器**。新的选择公式为：

```text
行动得分
= 身份优先级
+ 当前压力匹配
+ 职责与权限匹配
+ 已有承诺一致性
- 资源冲突
- 越权成本
```

建议把内容配置扩展为：

```json
{
  "seatId": "qingliu_law",
  "abstainThreshold": 10,
  "actionRules": [
    {
      "actionType": "SEAL_FINAL_WEIR_ORDERS",
      "baseScore": 20,
      "conditions": [
        {
          "factRef": "working.N1.review.unresolved_conflict_preserved",
          "operator": "EQ",
          "value": true,
          "scoreDelta": 30
        }
      ]
    }
  ]
}
```

允许读取：

- 当前合法行动；
- 本章累计 WorkingDelta；
- 当前权威事实；
- 席位身份规则和权限；
- 席位已有承诺；
- 可用资源。

禁止读取：

- DeepSeek 生成的文学文本；
- 中文关键词或同义词匹配；
- 玩家无权知道的秘密；
- 尚未结算的临时 Narrative 细节。

N1 内容配置应表达以下职责方向，但不得在 TypeScript 中硬编码：

| 席位 | 主要职责信号 | 可能优先方向 |
|---|---|---|
| 浙江巡抚 | 地方执行、调兵、疏散秩序 | 送达命令、增援、疏散 |
| 清流法司 | 证据、程序、责任链 | 封存、见证、追责 |
| 江南商会 | 船只、运输、粮食、商业风险 | 疏散运输、物资补位 |
| 司礼监织造 | 内廷命令、织造利益、宫廷责任 | 封缄、回执、限制暴露 |
| 内阁财政 | 国库、军饷、救济成本 | 资源分配、军饷保障、限制透支 |

没有相关事实触发或最高得分低于阈值时，必须选择 `DEFAULT_PASS`，不得为了凑齐六席强行行动。

## MC：中间行动与章末收敛接线

| 项目 | 内容 |
|---|---|
| 唯一职责 | 按 MA 计划组织玩家编译、NPC 解析、持久化批次、Beat 推进和 Settlement 调用 |
| 非职责 | 不拥有身份评分、不重新计算 Action Effect、不生成页面或 Narrative 文本 |
| 输入 | BeatSubmitPlanV1、玩家合法行动、MB NPC resolutions、提交快照 |
| 输出 | 中间 Beat 回执或章末统一提交回执 |
| 权威来源 | MA、MB、现有 Action Effect、Working Ledger 和 Settlement |
| 依赖 | convergence service、prepared action persistence、Beat progression |
| 测试 | 中间单行动、章末批量、幂等重放、失败原子性、Settlement exactly once |
| 回滚 | 切回 REPLAY/旧收敛入口；历史 Run 保持冻结 |
| 问题归属 | 收敛、持久化或调用时机 |

中间 Beat 原子批次只包含：

```text
1 条当前真人行动
+ 对应 WorkingDelta
+ 下一 Beat 指针
+ 1 个下一 Narrative outbox
```

中间 Beat 明确要求：

```text
AI policy calls = 0
generated NPC actions = 0
Settlement calls = 0
```

章末 Beat 原子批次包含：

```text
真人最后行动
+ MB 解析出的 NPC 行动或 DEFAULT_PASS
+ 章末封存
+ 唯一 Settlement
+ 章末 Narrative outbox
```

不新增数据库表或 migration。重复 submissionId 必须返回等价回执，不得重复产生 NPC 行动、Settlement 或 Narrative 任务。

## M0：基线冻结与可观测性

| 项目 | 内容 |
|---|---|
| 唯一职责 | 冻结修改前功能、查询数和阶段耗时证据 |
| 非职责 | 不修改业务行为 |
| 输入 | 真实 Solo Run、现有决策提交接口、Supabase 测试环境 |
| 输出 | 基线 JSON/日志、页面投影指纹、查询计数和耗时表 |
| 依赖 | 现有 timing log 与数据库查询统计 |
| 测试 | 一次 cold + 至少 10 次 warm；失败样本单独报告 |
| 回滚 | 无业务代码 |
| 问题归属 | 观测和验收证据 |

必须记录：

- runId、chapterRuntimeId、decisionPointId、revision；
- 提交前后 projectionHash 或规范化 JSON hash；
- 各阶段毫秒数；
- post-commit projection 阶段的应用 SQL、事务和协议往返；
- Narrative 的任务创建、发布和前端收到时间。

## M1：提交页面权威快照

| 项目 | 内容 |
|---|---|
| 唯一职责 | 在提交前同一次权威读取中取得生成当前玩家页面所需的不可变来源 |
| 非职责 | 不结算、不写库、不生成页面、不调用 Provider |
| 输入 | runId、roomId、subjectId、viewerSeatId、route/chapter/revision/fence |
| 输出 | `SubmitPageAuthoritySnapshotV1` |
| 权威来源 | 现有 Decision submit snapshot 与 `GameReadSnapshotV1.sources` |
| 依赖 | 现有聚合快照 decoder、viewer/route/chapter 绑定校验 |
| 测试 | 合同、严格解码、身份隔离、hash、一次读取证明 |
| 回滚 | 删除新合同字段并恢复旧 captureSubmit |
| 问题归属 | 快照输入、读取或绑定错误 |

### M1 合同建议

不得在 Decision 模块复制页面字段。优先复用现有已验证来源类型：

```ts
interface SubmitPageAuthoritySnapshotV1 {
  schemaVersion: "pressure_submit_page_authority_snapshot_v1";
  decision: DecisionSubmitSnapshotV1;
  pageSources: Readonly<GameReadSnapshotV1["sources"]>;
  capturedAtMs: number;
  snapshotHash: string;
}
```

如果直接复用 `GameReadSnapshotV1["sources"]` 会引入不合理依赖，应抽取一个更窄的共享合同，但不能复制 decoder 或投影规则。

### M1 必须满足

1. `decision.viewer` 与 `pageSources` 的 run、room、subject、seat 必须一致。
2. routeHash、chapterRuntimeId、decisionPointId、revision、controlEpoch、fence 必须一致。
3. 快照必须不可变并计算规范化 hash。
4. 任一错配 fail closed，不允许补默认值。
5. 读取不得在原提交快照之后再串行执行一次普通 `/game`。
6. 目标是同一个聚合读取取得决策权威和页面来源；如数据库实现暂时必须两条 SQL，也必须在同一快照事务内并行取得，且不得增加第二次远程完整回读。

### M1 预计文件

- `apps/api/src/pressure-chapter/decision-automation/contracts.ts`
- `apps/api/src/pressure-chapter/decision-automation/prisma-snapshot.ts`
- 对应 `*.spec.ts`
- 必要时复用 `apps/api/src/pressure-chapter/game-projection/game-read-snapshot.ts`

任何公共合同扩展超过上述范围必须先停止并重新说明。

## M2：提交后页面权威回执

| 项目 | 内容 |
|---|---|
| 唯一职责 | 把同一次成功提交产生的页面相关真实结果封装为可验证回执 |
| 非职责 | 不读取数据库、不生成页面、不调用 DeepSeek、不重新结算 |
| 输入 | 中间真人行动提交结果，或章末统一提交与 Settlement 结果；以及 Beat 推进结果和同次事件输出 |
| 输出 | `PostCommitPageAuthorityReceiptV1` |
| 权威来源 | 已成功提交的 transaction result/commit receipt |
| 依赖 | Settlement、Beat、Working Ledger、指标与资源权威写入结果 |
| 测试 | 中间 Beat、章末、指标变化、资源变化、幂等重放、hash 校验 |
| 回滚 | 恢复现有 `committedAuthority` 最小合同 |
| 问题归属 | 提交回执缺字段或与事务不一致 |

### M2 为什么不能只使用当前 `committedAuthority`

当前只包含 chapter、workingProjection、chapterDescriptor。若最后一个 Beat 触发：

- 五项指标变化；
- 玩家资源或 Token 变化；
- 章末总结确认门；
- Feed/A-Emotion 事件；

只覆盖这三个字段会让内存页面显示旧数据。因此必须从同次事务/结算计划中取得其余真实结果。

### M2 合同建议

允许两种等价实现，优先选择 A：

#### A. 完整 resolved-source 回执（推荐）

```ts
interface PostCommitPageAuthorityReceiptV1 {
  schemaVersion: "pressure_post_commit_page_authority_receipt_v1";
  runId: string;
  routeHash: string;
  viewerSeatId: SeatIdV1;
  previousRevision: number;
  committedRevision: number;
  resolvedSourceOverrides: Readonly<Partial<GameReadSnapshotV1["sources"]>>;
  narrativeIdentity: Readonly<{
    status: "PENDING" | "PUBLISHED" | "FALLBACK_PUBLISHED";
    sourceId: string;
    projectionKind: string;
  }>;
  commitHash: string;
}
```

#### B. 窄 delta 回执

只输出 state-changing deltas，再由 M3 映射到 resolved sources。只有在 delta 已经是现有权威合同、且不会迫使 M3 复制 Settlement 规则时才允许使用。

### M2 必须满足

1. 回执只能在数据库提交成功后产生。
2. 回执必须与 transaction/commit batchId、runId、routeHash 和 revision 绑定。
3. 重复 submissionId 返回同一个等价回执。
4. 数据库提交失败时不得返回成功回执。
5. 回执不得包含另一个席位的私人信息。
6. 回执中的指标和资源必须是结算后的真实值，不是前端自行加减。
7. Narrative 尚未完成时只提供 `PENDING` identity，不提供预测正文。

### M2 预计文件

- `apps/api/src/pressure-chapter/decision-automation/contracts.ts`
- `apps/api/src/pressure-chapter/decision-automation/convergence.service.ts`
- Settlement/commit 现有回执适配器及对应测试

如果必须修改 Prisma schema、migration 或公共提交 API，立即停止并申请重新授权。

## M3：提交后 Resolved Sources 纯编译器

| 项目 | 内容 |
|---|---|
| 唯一职责 | 纯内存合并提交前页面来源与提交后权威回执 |
| 非职责 | 不访问数据库、不重新结算、不生成文学文本、不渲染 HTML |
| 输入 | `SubmitPageAuthoritySnapshotV1`、`PostCommitPageAuthorityReceiptV1` |
| 输出 | 现有 `projectFromResolvedSources()` 可直接消费的 sources |
| 权威来源 | M1 + M2 |
| 依赖 | 现有 resolved-source 类型和严格验证器 |
| 测试 | 纯函数矩阵、fail closed、无 I/O、输入不可变 |
| 回滚 | 删除新编译器并切回 REPLAY |
| 问题归属 | 合并/编译层 |

建议新增：

```text
apps/api/src/pressure-chapter/game-projection/post-commit-resolved-sources.ts
apps/api/src/pressure-chapter/game-projection/post-commit-resolved-sources.spec.ts
```

建议接口：

```ts
function compilePostCommitResolvedSourcesV1(input: Readonly<{
  before: SubmitPageAuthoritySnapshotV1;
  committed: PostCommitPageAuthorityReceiptV1;
}>): GameReadSnapshotV1["sources"];
```

### M3 合并规则

1. 先严格校验 before 与 committed 的 run、route、seat、revision 连续性。
2. 从 before 复制未变化的 viewer-scoped 来源。
3. 只应用 committed 明确提供、且经过验证的权威覆盖。
4. 章节、Beat、decision、Working Ledger 使用提交后来源。
5. 五项指标、资源、Capabilities、summary gate 使用提交后真实来源。
6. Narrative 未发布则替换为与新 chapter/beat/decision 绑定的 `PENDING` 来源。
7. Feed 不得丢失旧项；同次提交已密封的 viewer-safe 事件可以追加，未密封内容等待后台发布。
8. 输出后调用既有 resolved-source validator。
9. 不允许读取 Prisma、Reader port、HTTP context、全局缓存或当前时间。
10. 同一输入重复执行必须逐字节一致。

### M3 禁止做法

- 新写 `buildFastGameProjection()` 复制现有 Projector；
- 在编译器中按 actionType 写指标加减规则；
- 为 N1/N2 写章节特判；
- 给缺失字段补 0、空数组或旧值以掩盖回执缺口；
- 用 Narrative 文本反推游戏状态。

## M4：HTTP 接线、模式选择与 SHADOW

| 项目 | 内容 |
|---|---|
| 唯一职责 | 选择 REPLAY/SHADOW/FAST 并把 M3 输出送入现有 Projector |
| 非职责 | 不拥有投影规则，不改变结算，不操作 UI |
| 输入 | M1 快照、M2 回执、请求上下文 |
| 输出 | 现有 `PressureChapterGameProjectionV1` |
| 权威来源 | M1、M2、现有 Projector |
| 依赖 | HTTP facade、生产 composition、内部配置 |
| 测试 | 模式、降级、SHADOW 对比、零关键路径 DB 读取 |
| 回滚 | 环境变量切回 REPLAY |
| 问题归属 | 接线/模式选择 |

### M4 模式必须与普通 GET 模式分开

建议新增独立内部配置：

```text
PRESSURE_POST_COMMIT_PROJECTION_MODE=REPLAY|SHADOW|FAST
```

不得复用 `PRESSURE_GAME_READ_MODE`，因为：

- 普通 GET 的聚合快照优化；
- 决策 POST 后复用提交权威；

是两个可以独立回滚的性能边界。

### M4 各模式行为

#### REPLAY

```text
继续执行现有数据库完整回读
```

#### SHADOW

```text
玩家仍收到 REPLAY 结果
同时生成内存候选结果
规范化比较两者
记录差异和字段路径
```

SHADOW 是验收模式，允许慢，但不改变玩家行为。

#### FAST

```text
立即返回内存投影
后台按采样率执行数据库完整回读
异步比较，不阻塞响应
```

FAST 的后台校验失败只记录诊断并触发告警/自动降级策略，不得撤销已经成功的 Settlement，也不得向玩家显示内部错误。

### M4 对比规则

以下字段必须完全一致：

- run、route、viewer、seat；
- chapterId、chapterRuntimeId、revision；
- current beat、decisionPoint、选项及合法行动；
- Working Ledger 可见投影；
- 五项指标；
- 玩家资源、Token 与 capabilities；
- 章末总结及确认门；
- 所有权限和隐私字段。

允许的异步差异只有：

- FAST 立即响应为 `PENDING`；
- 稍后的数据库回读为 `PUBLISHED` 或 `FALLBACK_PUBLISHED`；
- 与该 Narrative 发布同时产生、且尚未发布的 viewer-safe Feed 项。

不得把决策、指标或资源差异列为“允许异步差异”。

### M4 预计文件

- `apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.ts`
- `apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.spec.ts`
- `apps/api/src/pressure-chapter/production-config/`
- `apps/api/src/pressure-chapter/product/` 或 production composition 对应文件
- 现有 timing/diagnostics 模块

## M5：Narrative 轻量更新

| 项目 | 内容 |
|---|---|
| 唯一职责 | Narrative 发布后通知正确 viewer，并只更新 Narrative 投影 |
| 非职责 | 不重新读取完整 `/game`，不改变决策、结算或页面布局 |
| 输入 | 已发布 Narrative 的 viewer-safe projection 与 identity |
| 输出 | authenticated SSE 事件及前端局部状态更新 |
| 权威来源 | 现有 Narrative 发布链 |
| 依赖 | 现有 `/api/v4/rooms/:roomId/events/stream` 与页面 storage |
| 测试 | 权限、身份匹配、幂等、断线重连、过期事件拒绝 |
| 回滚 | 禁用事件消费；页面保留 PENDING 并允许手动刷新 |
| 问题归属 | Narrative 发布/通知/前端 storage |

### M5 推荐实现

优先复用现有 authenticated SSE：

```text
GET /api/v4/rooms/:roomId/events/stream
```

增加一个 viewer-safe 的 Narrative 发布事件类型，事件最少包含：

```ts
interface PressureNarrativePublishedEventV1 {
  schemaVersion: "pressure_narrative_published_event_v1";
  runId: string;
  chapterRuntimeId: string;
  decisionPointId: string | null;
  workingRevision: number;
  sourceId: string;
  projectionKind: string;
  status: "PUBLISHED" | "FALLBACK_PUBLISHED";
  narrative: ViewerSafeNarrativeProjectionV1;
  deliverySequence: number;
}
```

前端只有在以下 identity 全部匹配时才能应用：

```text
runId
chapterRuntimeId
workingRevision
sourceId / projection identity
viewer seat binding
```

重复事件必须幂等；旧 revision 事件必须忽略；断线后使用 `afterDeliverySequence` 恢复。

### M5 页面边界

只允许修改数据接收和 storage，不允许修改布局、CSS、组件结构或玩家可见文案。预计可能涉及：

- `apps/web/public/pressure-main-game-storage-v1.js`
- 现有 SSE client 接线文件
- 对应 browser test

这是玩家可见行为的间接变化。实际编辑前必须按照 `AGENTS.md` 提交准确审批说明并取得项目所有者批准。若现有 SSE 无法安全承载 Narrative，新增 endpoint 或改变公共 API 合同也必须先重新申请批准，不能擅自扩展范围。

## 8. 准确实施顺序

必须按模块顺序实施，每个模块独立测试、范围化提交和推送后才能进入下一模块：

```text
M0 基线冻结
→ MA Beat 提交策略
→ MB 身份化 NPC 章末决策
→ MC 中间行动/章末收敛接线
→ M1 提交页面权威快照
→ M2 提交后页面权威回执
→ M3 纯内存 resolved-source 编译器
→ M4 HTTP + SHADOW/FAST
→ 项目所有者批准 M5 的间接页面改动
→ M5 Narrative 轻量更新
→ 真实 /game 玩家验收
```

任何阶段如果需要修改数据库结构、公共路由、Settlement 规则、剧情内容、三个以上未声明模块或正式页面布局，必须停止并重新说明。

## 9. 测试方案

## 9.0 Beat 提交与 NPC 身份策略测试

### 中间 Beat

N1.B01–N1.B07 每轮必须满足：

```text
玩家行动写入数 = 1（Solo）
AI 策略调用数 = 0
AI 行动写入数 = 0
Settlement 调用数 = 0
DeepSeek 调用数 = 1（下一段剧情＋下一决策）
下一 Beat 与 nextDecisionPin 正确
```

### 章末 Beat

N1.B08 必须满足：

```text
只解析由 AI 控制且属于章末合同的席位
所有 NPC 行动来自合法 Catalog
无职责触发的 NPC = DEFAULT_PASS
章末批量提交 = 1
Settlement 调用数 = 1
DeepSeek 调用数 = 1（结尾剧情＋章末总结）
chapterSummary.confirmationState = AWAITING_CONFIRMATION
玩家确认后才进入 N2
```

### 身份与确定性

必须证明：

1. 相同身份、相同权威事实得到相同行动。
2. 改变 runSeed 不得改变明确最高分行动。
3. 只有最高分并列时才允许哈希改变结果。
4. 非法或越权行动永远不会被选中。
5. 清流法司在证据链危急且权限允许时优先证据类行动。
6. 江南商会只有运输、粮食或商业职责被触发时才正式行动。
7. 无职责信号时允许 DEFAULT_PASS。
8. NPC 决策过程 Provider 调用数必须为 0。
9. 按钮与自由输入经 Action Guard 映射后使用同一推进规则。
10. 重放不得重复 NPC 行动、Settlement 或 Narrative。

### 多人控制权

至少覆盖：

```text
2 个真人＋4 个 AI
中间 Beat 只接收真人行动，不自动补 4 个 AI
章末只为 4 个 AI 解析 NPC 响应
真人席位不得被自动策略覆盖
各 viewer 只能看到自身允许的信息
```

## 9.1 M1 合同与读取测试

必须覆盖：

1. 正常快照严格解码。
2. runId、roomId、subjectId、seatId 任一不一致即拒绝。
3. routeHash、chapterRuntimeId、decisionPointId、revision 不一致即拒绝。
4. controlEpoch、submission fence 不一致即拒绝。
5. 缺失五项指标、资源、Narrative identity、summary source 时 fail closed。
6. 快照 hash 可重复且输入突变会改变 hash。
7. 不允许另一个席位的 private source 混入。
8. 读取调用数满足合同；不能偷偷调用完整 `game.read()`。

## 9.2 M2 回执测试

至少覆盖：

- 中间 Beat：仍停在同一章节但 revision 和 decision 改变；
- 最后 Beat：关闭本章并打开章末总结确认门；
- 确认章末后进入下一章；
- 五项指标同时有增有减；
- 玩家资源和 Token 变化；
- 无指标变化的行动；
- 自由输入经 Action Guard 映射后的合法行动；
- submissionId 重放返回相同回执；
- 提交失败不产生回执；
- Narrative 只能是 PENDING identity 或已正式发布内容；
- 其他席位 private 结果不泄漏。

## 9.3 M3 纯函数测试

构造所有 I/O 依赖为“调用即抛错”，证明编译器：

```text
0 Prisma
0 transaction
0 Reader
0 Provider
0 clock
0 random
```

矩阵至少包含：

- N1 中间 Beat；
- N1 章末总结；
- N1 → N2；
- N2–N7 每章至少一个 fixture；
- Solo 六种 viewer seat；
- 多人六种 viewer seat；
- Narrative PENDING / PUBLISHED / FALLBACK_PUBLISHED；
- Feed 无新增 / 有同次安全新增；
- stale revision、错误 route、错误 seat、错误 hash 全部 fail closed。

## 9.4 SHADOW 等价测试

对同一次真实提交分别取得：

```text
A = 内存候选投影
B = 提交后数据库完整回读投影
```

先移除明确允许的异步 Narrative 差异，再验证：

```text
canonical(A) === canonical(B)
projectionHash(A) === projectionHash(B)
```

必须输出首个差异字段路径，禁止只给 `false`。

验收矩阵：

| 维度 | 最低覆盖 |
|---|---|
| 章节 | N1–N7 |
| 身份 | 6 席 |
| 模式 | Solo + 多人 |
| 节点 | 中间 Beat + 章末 + 下一章 |
| Narrative | PENDING + PUBLISHED + FALLBACK |
| 输入 | 按钮 + 自由输入 |

可先用 fixture 做完整矩阵，再选 N1、N2、N7 做真实 Supabase 流程；不得用 fixture 冒充真实环境通过。

## 9.5 Narrative 轻量更新测试

1. 当前 viewer 收到自己的 Narrative。
2. 其他席位 Narrative 不可见。
3. 过期 revision 不覆盖当前页面。
4. 重复事件只应用一次。
5. 断线重连从 delivery sequence 续传。
6. Narrative 更新不改变五项指标、资源、decision 或 capabilities。
7. 发布失败保持 PENDING 或显示既有安全 fallback，不出现裸内部错误。
8. 前端不再以 0.4 秒间隔轮询完整 `/game`。
9. 页面刷新后数据库投影与此前 FAST 页面一致。

## 9.6 性能测试

### 测量方法

每种模式都执行：

```text
1 次 cold run，仅单独报告
至少 10 次 warm run，推荐 20 次
报告 p50、p95、max 和失败数
```

每次必须记录：

| 阶段 | 指标 |
|---|---|
| 权威读取 | ms、SQL、事务、协议往返 |
| 玩家行动编译 | ms |
| Beat 提交模式 | INTERMEDIATE_ACTION_ONLY / CHAPTER_COUNCIL_COMMIT |
| NPC 行动计算 | ms、调用席位数、DEFAULT_PASS 数、Provider 调用数必须为 0 |
| 数据库提交 | ms、持久化真人/NPC行动数、SQL、事务 |
| Beat 推进 | ms |
| Settlement | ms |
| 回执生成 | ms |
| 内存 resolved-source 编译 | ms |
| 现有 Projector | ms |
| HTTP 返回 | ms |
| Worker 排队 | ms |
| DeepSeek | ms、attempt count |
| Narrative 保存/发布 | ms |
| SSE 到达前端 | ms |
| 点击到下一页面 | ms |
| 点击到最终 Narrative | ms |

中间 Beat 还必须记录并断言：

```text
generatedNpcActionCount = 0
persistedNpcActionCount = 0
settlementInvoked = false
```

### 性能硬门与目标

| 指标 | 硬门 | 理想目标 |
|---|---:|---:|
| M3 纯编译器 warm p95 | ≤ 100 ms | 10–50 ms |
| FAST post-commit 页面投影关键路径 DB 调用 | **0** | 0 |
| FAST 回执 + 编译 + Projector warm p95 | ≤ 250 ms | 10–100 ms |
| 点击到 PENDING 下一页面 warm p95 | ≤ 7,000 ms | ≤ 6,000 ms |
| 页面投影阶段相对 14.6 秒基线 | 降低 ≥ 95% | 约 10–100 ms |

`约 21 秒 → 约 6–7 秒` 是工程目标，不是预先保证。只有真实 Supabase warm p95 达标才可宣称性能通过。

点击到文学 Narrative 的时间另行报告，不能把 PENDING 页面返回冒充 DeepSeek 完成。

## 9.7 真实 `/game` 页面验收

必须由项目所有者参与，使用正式三栏 `/game`，不得用测试页面代替。

测试顺序：

1. 创建全新隔离 Solo Run。
2. 查看开场和 N1 第一段剧情。
3. 进入决策并提交按钮选择。
4. 计时点击到下一 Beat 页面出现。
5. 确认下一 Beat、选项、五项指标和资源正确。
6. 等待 Narrative 轻量更新，确认无需刷新完整页面。
7. 手动刷新，确认完整数据库回读结果与先前页面一致。
8. 使用自由输入再测试一次。
9. 测试章末总结与“进入下一章”。
10. 至少推进到 N2，确认没有 N1 专用行为。

玩家只需要判断：

- 是否在合理时间内看到下一页面；
- 剧情和决策是否连贯；
- 页面是否出现旧决策、空白、跳章或错误指标；
- 后台 Narrative 到达时是否平滑更新；
- 刷新后结果是否稳定。

## 10. 回滚方案

### 10.1 代码回滚

每个模块独立提交，可单独回退。不得把 M1–M5 压成一个无法定位的提交。

### 10.2 运行时回滚

```text
PRESSURE_POST_COMMIT_PROJECTION_MODE=REPLAY
```

即可恢复旧的数据库完整回读路径，不影响 Settlement、Narrative Worker 或数据库内容。

### 10.3 自动降级条件

以下任一出现时不得使用 FAST：

- M1/M2 identity 或 hash 校验失败；
- committed revision 不连续；
- 缺失任何 state-changing 页面来源；
- SHADOW 出现非 Narrative 异步字段差异；
- private data 泄漏；
- 内存投影器抛出严格验证错误。

降级只能切回 REPLAY，不能补默认值或返回猜测页面。

## 11. 提交与交付要求

### 11.1 ChatGPT Pro 必须交付

每个模块必须交付：

```text
1. 基于准确父 SHA 的完整 patch
2. changed-files ZIP
3. manifest.json（文件路径、大小、SHA-256）
4. test-report.txt（准确命令、PASS/FAIL/TESTS_NOT_RUN）
5. architecture-and-risk-report.md
6. 全部工件 SHA-256
```

未真实运行的测试必须标记 `TESTS_NOT_RUN`。Pro 不得自行声明真实 Supabase、浏览器、性能 p95、远程交付或玩家验收通过，除非它确实获得对应环境并提供可复核原始证据。

### 11.2 Codex 落地与 Git

1. 新任务开始前必须是干净的准确目标分支，且不存在其他 writer。
2. Codex 必须先在隔离的准确基线验证副本中执行 patch apply check、范围审查和密钥扫描。
3. Codex 只可机械落地 Pro 工件；若需改变其架构、公共合同、数据库、路由、权威链或主要实现，必须把问题退回原 Pro 对话修正。
4. 每个模块只暂存准确文件，不得 `git add .`。
5. 每个模块经 Codex 独立聚焦测试通过后才可提交；是否推送专用分支、是否合并 `main` 分别按项目所有者的当前授权执行。
6. 每次提交前列出玩家可见文件；M5 未获批准前该列表必须为空。
7. 每次获准推送后回读本地、tracking、实时远程三个 SHA。
8. 最终必须报告：
   - 每个模块提交 SHA；
   - 修改文件；
   - 测试命令与结果；
   -真实 Supabase p50/p95/max；
   - 数据库访问计数；
   - SHADOW 差异数；
   - 真实 `/game` 验收结果；
   - `CLEAN=true/false`。

## 12. 最终验收标准

只有同时满足以下条件，任务才可判定完成：

### 架构

- Settlement 仍是唯一结果权威；
- 中间 Beat 不生成 NPC 正式行动、不调用 Settlement；
- 章末 Beat 只执行一次身份化 NPC 解析和一次 Settlement；
- 哈希仅用于最高分并列，不再作为主要 NPC 选择算法；
- 现有 `projectFromResolvedSources()` 仍是唯一页面 Projector；
- M3 是纯函数且无数据库/Provider 依赖；
- 没有 N1 专用补丁；
- 没有新增数据库结构或平行页面。

### 正确性

- N1–N7、六席、Solo/多人合同矩阵通过；
- N1.B01–B07 每轮 AI 行动数和 Settlement 调用数均为 0；
- N1.B08 只产生一次章末批次、一次 Settlement 和一次章末 Narrative；
- 真人控制席位永远不会被 NPC policy 自动覆盖；
- SHADOW 除明确允许的 Narrative 异步字段外 0 差异；
- 刷新后数据库完整回读与 FAST 页面一致；
- 无旧 decision、跳章、指标漂移、资源漂移或私人信息泄漏。

### 性能

- post-commit 页面投影关键路径数据库调用为 0；
- 内存编译 + Projector warm p95 不超过 250 ms；
- 点击到 PENDING 下一页面 warm p95 不超过 7 秒；
- 点击到最终 Narrative 单独测量和报告。

### 玩家体验

- 正式 `/game` 页面能先显示真实下一状态；
- Narrative 完成后轻量更新，无完整 `/game` 高频轮询；
- 页面布局、剧情内容和决策规则没有意外变化；
- 项目所有者完成一次真实参与式验收。

## 13. 一句话实施边界

> 中间 Beat 只保存真人行动并推进剧情，章末 Beat 才依据身份规则和权威事实解析 NPC、执行唯一 Settlement；随后复用提交前已验证的 viewer 页面来源和同次提交的真实回执，纯内存编译现有 Projector 所需 sources，先返回真实的 PENDING 下一页面，再通过既有 authenticated SSE 轻量更新 Narrative。任何强制中间五席行动、用哈希代替身份决策、重新计算结果、猜测缺失字段、复制 Projector、轮询完整 `/game` 或改版页面的实现都不属于本方案。
