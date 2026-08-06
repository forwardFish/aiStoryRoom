# Our Many Worlds 四类谋划与调查证据系统

## 可执行 MVP 收敛版需求开发文档 v1.1

> 修订日期：2026-08-05  
> 仓库：`https://github.com/forwardFish/aiStoryRoom`  
> 冻结基线：`origin/main@1b750e56858dabefb0ddb8b922c6bdcbe0574e4c`  
> 唯一允许的新开发分支：`codex/chatgpt-pro-maneuver-evidence-v1`  
> 首个验收世界：《桑田诏：嘉靖财政危局》  
> 唯一产品入口：现有 `/game` 页面  
> 本轮目标：交付一个可操作、可结算、可验证的纵向 MVP，而不是一次完成完整博弈平台。

---

# 1. 本次修订为什么必须收敛

旧版文档同时要求：

- 四类谋划完整规则；
- 全套行动预演和状态机；
- 多种规则卡使用时机；
- 事实、痕迹、调查路线、三级证据和证据组合；
- 应变窗口、伏置牌、条件行动；
- 新数据库模型和复杂迁移；
- Continuous Story V2、Solo、OpenNovel Story V4 全部接入；
- 完整安全、性能、观测、灰度、回滚；
- 大量接口样例和全仓库验收。

这些内容适合作为长期产品蓝图，不适合作为一次 ChatGPT Pro 开发任务。它把一个可验证的纵向功能扩大成了多阶段平台重构，导致：

1. 实施时间不可控；
2. 很难形成真实业务提交；
3. 容易通过临时 Workflow、补丁文件或局部 Mock 冒充完成；
4. 测试范围远大于功能范围；
5. 任一底层冲突都会阻断整套交付。

因此，本版只保留能够让玩家在现有 `/game` 页面真实完成一次谋划循环的最小闭环：

```text
阅读局势
→ 选择人物交谈 / 派遣调查 / 使用筹码 / 自拟谋划
→ 服务端预演系统如何理解
→ 玩家确认
→ 服务端只提交一次
→ 页面显示行动正在推进或已经产生结果
→ 私人调查结果只进入调查者的证据区
→ 玩家仍可继续提交当前主线决策
```

本版完成后，再按真实玩家反馈决定是否开发应变、伏牌、证据组合和其他运行时接入。

---

# 2. Git 基线、全新分支与责任边界

## 2.1 冻结基线

本轮必须从以下远程基线重新开始：

```text
repository : forwardFish/aiStoryRoom
base ref   : origin/main
base SHA   : 1b750e56858dabefb0ddb8b922c6bdcbe0574e4c
```

如果 `origin/main` 已经不是该 SHA，必须停止并报告：

```text
BASELINE_MOVED
```

不得自行换用新的 `main`，也不得继续基于旧 SHA 开发。

## 2.2 唯一允许的新分支

仓库所有者已明确批准本次例外开发分支：

```text
codex/chatgpt-pro-maneuver-evidence-v1
```

ChatGPT Pro 必须从冻结的远程 `main` 创建并首次推送该分支。

以下分支只可作为历史或流程参考，严禁作为代码来源：

```text
feat/maneuver-rules-v1
feat/maneuver-rules-v1-20260805
feat/maneuver-rules-v1-full-implementation-20260805
feat/maneuver-rules-v1-gpt56-20260805
codex/chatgpt-pro-ai-story-convergence
```

禁止：

- 从上述分支 merge；
- 从上述分支 cherry-pick；
- 复制其未验证补丁；
- 以其测试报告替代当前分支验证；
- 继续使用其临时上传或源码导出 Workflow。

如果目标分支已经意外存在，必须停止并报告：

```text
TARGET_BRANCH_ALREADY_EXISTS
```

不得 force push 覆盖未知提交。

## 2.3 强制流程

```text
远程 main@1b750e56858dabefb0ddb8b922c6bdcbe0574e4c
        ↓
ChatGPT Pro 创建并推送全新分支
codex/chatgpt-pro-maneuver-evidence-v1
        ↓
ChatGPT Pro 只在该分支开发、测试、提交并推送
        ↓
输出 CANDIDATE_BRANCH_READY 与最终远程 SHA
        ↓
本地 Codex 执行 git fetch，不 pull 到脏 main
        ↓
在隔离验证环境检出远程精确 SHA
        ↓
审查代码、工程测试、真实页面和三角色验收
        ↓
通过后，仓库所有者另行授权是否合并 main
        ↓
合并并推送后核对本地 HEAD、origin/main、GitHub SHA 一致
```

## 2.4 ChatGPT Pro 的权限

ChatGPT Pro 可以：

- 读取仓库；
- 创建上述唯一新分支；
- 修改本轮范围内文件；
- 运行测试；
- 在该分支提交并推送。

ChatGPT Pro 不可以：

- 修改、提交、合并或推送 `main`；
- 创建指向 `main` 的 PR；
- 创建第二个开发分支；
- force push；
- 使用 `git add .`；
- 使用 `git reset --hard`、`git clean` 或广泛 stash；
- 修改登录、积分、Billing、部署、结尾系统或无关剧情代码；
- 宣称已经完成最终产品验收。

最终合并和正式 PASS 只能由本地 Codex完成。

## 2.5 分批交付与远程检查点

本任务不得等到所有功能完成后才第一次提交。C0—C5 是六个可观察检查点，ChatGPT Pro 必须在每个阶段完成后立即：

1. 只显式暂存该阶段拥有的文件；
2. 运行该阶段规定的聚焦测试；
3. 创建一个可独立审查的真实业务提交；
4. 推送到 `codex/chatgpt-pro-maneuver-evidence-v1`；
5. 使用 `git ls-remote` 回读远程 SHA；
6. 在同一会话输出阶段报告，然后继续下一阶段。

阶段报告采用固定格式：

```text
CHECKPOINT_C<n>_PUSHED
branch: codex/chatgpt-pro-maneuver-evidence-v1
baseSha: 1b750e56858dabefb0ddb8b922c6bdcbe0574e4c
commitSha: <本阶段提交>
remoteSha: <git ls-remote 回读>
files: <本阶段文件>
tests: <命令、总数、PASS、FAIL、SKIP、退出码、日志路径>
next: C<n+1>
```

检查点不是最终验收。`CHECKPOINT_C1_PUSHED` 只代表 C1 已经真实进入远程分支，不能写成整个功能已经完成。

默认在报告检查点后继续下一阶段，不要求仓库所有者逐次回复“继续”。只有出现以下情况才必须停止：

- 冻结基线变化；
- 目标分支属于其他任务或远程历史不兼容；
- 需要修改默认禁止文件；
- 同一阶段连续三次仍无法通过同一验收；
- 无法访问远程仓库、数据库或真实运行环境；
- 发现需求合同内部矛盾。

如果任务中断，恢复时允许目标分支已经存在，但必须先证明：

```text
merge-base(target, origin/main) = 1b750e56858dabefb0ddb8b922c6bdcbe0574e4c
目标分支只包含本任务已报告的 C0—C<n> 检查点提交
远程 HEAD 与上一次报告的 remoteSha 一致
工作区干净
```

任一条件不满足，输出 `TARGET_BRANCH_CONFLICT` 并停止；不得覆盖、重建或 force-push。

---

# 3. MVP 产品目标

## 3.1 玩家最终必须感知到什么

在真实 `/game` 页面中，玩家必须能够：

1. 看见本回合剩余谋划次数，例如 `2 / 2`；
2. 从现有四个入口选择一种做法；
3. 在提交前看见一张普通玩家能懂的行动预演卡；
4. 确认系统理解的对象、做法和立即开始的结果；
5. 确认后只消耗一次谋划；
6. 看见行动进入“正在推进”或“已获得结果”；
7. 调查成功后只在自己的证据区看见私人证据；
8. 其他角色看不见该私人证据，除非后续游戏明确公开；
9. 使用完谋划后仍能正常提交中央主线决策；
10. 刷新页面后仍能看到正确次数、行动和证据。

## 3.2 本轮保留的四个入口

为了复用当前页面并减少 UI 重构，本轮保留：

```text
人物交谈
派遣调查
使用筹码
自拟谋划
```

它们在后台并非四套独立引擎，而是同一个有限行动合同的四种输入方式。

### 人物交谈

玩家选择一个当前可接触角色，并说明要问、试探、说服、交换或施压什么。

MVP 能保证：

- 请求或话语被发送给目标角色；
- 记录可见范围；
- 目标可以在后续回应。

MVP 不保证：

- 对方相信；
- 对方说真话；
- 对方接受条件。

### 派遣调查

玩家从当前角色可见的痕迹中选择一条，并选择一个具体调查方向。

MVP 能保证：

- 调查只从已存在的痕迹开始；
- 调查结果有来源；
- 结果默认私密；
- 获得的证据不会自动升级成全部真相。

MVP 第一版只要求返回一种私人证据卡，不实现复杂调查树。

### 使用筹码

玩家选择自己实际持有的一项筹码，把它附加到一次交谈、调查或行动上。

MVP 只实现：

- 一项行动最多附加一个筹码；
- 只能使用当前角色持有的筹码；
- 筹码效果必须来自世界包或确定性规则；
- 页面说明筹码改变了什么边界。

本轮不实现主动牌、伏置牌、应变牌、冷却和复杂卡组。

### 自拟谋划

玩家使用自然语言说明一件要做的事。

系统只能返回四种编译结果：

```text
READY      可以形成一项有限行动；
REROUTE    实际属于交谈、调查或筹码使用；
CLARIFY    缺少目标或做法，需要玩家补充；
BLOCKED    越权、替别人决定或直接宣布结果。
```

本轮不自动执行多个主要效果。输入包含多件事时，返回 `CLARIFY`，要求玩家选择一件主要行动。

## 3.3 统一核心规则

每次正式谋划都必须满足：

```text
一个行动者；
一个主要目标；
一个主要效果；
零或一个附加筹码；
明确可见范围；
明确立即开始什么；
明确哪些结果仍有争议；
明确哪些结果不能保证。
```

禁止玩家通过长文本获得更多效果。

## 3.4 两阶段提交

流程固定为：

```text
编辑草稿
→ POST preview
→ 服务端编译和校验
→ 返回玩家安全预演卡
→ 玩家确认
→ POST commit
→ 服务端重新校验并原子提交
```

预演阶段不得：

- 扣除谋划次数；
- 修改世界状态；
- 创建正式互动；
- 创建证据；
- 扣除 Credits；
- 通知其他角色；
- 写入 Canon。

确认阶段必须：

- 校验角色控制权；
- 校验回合和状态 revision；
- 校验剩余机会；
- 校验目标、筹码、痕迹仍可用；
- 校验预演未过期且未被篡改；
- 使用 idempotencyKey 防止重复提交；
- 在同一事务内保存行动并占用一次机会。

## 3.5 服务端权威的 `2 / 2`

页面不能继续硬编码 `2 / 2`。

MVP 不新增专门计数表。服务端根据当前 `ActorTurn` 中已经提交的合法 `PlayerAction.actionSlot` 计算：

```text
MANEUVER_1
MANEUVER_2
```

规则：

- 预演不占槽；
- 确认成功占一个槽；
- 重复 idempotencyKey 不占第二个槽；
- 两个请求争抢最后一个槽时只能一个成功；
- 主线决策进入提交阶段后，新的谋划确认必须失败；
- 未使用机会不跨回合结转。

---

# 4. 调查与证据 MVP

## 4.1 最小链路

```text
权威事实
→ 对当前角色可见的痕迹
→ 一条可执行调查方向
→ 私人证据卡
```

AI 不得凭空生成调查事实。调查方向和可能获得的证据必须来自当前世界包、已有状态或明确 fixture。

## 4.2 痕迹最小合同

```ts
export interface ObservableTraceV1 {
  traceId: string;
  label: string;
  description: string;
  sourceKind: "DOCUMENT" | "PERSON" | "LOCATION" | "RESOURCE" | "EVENT";
  routeOptions: Array<{
    routeId: string;
    label: string;
    method: string;
  }>;
}
```

通用代码不得出现“巡抚、田契、粮册”等故事词。它们只能存在于《桑田诏》世界配置或测试 fixture。

## 4.3 私人证据卡最小合同

```ts
export interface PrivateEvidenceCardV1 {
  evidenceId: string;
  title: string;
  summary: string;
  supports: string;
  cannotProve: string;
  sourceKind: "DOCUMENT" | "TESTIMONY" | "OBSERVATION" | "RECORD";
  provenanceKey: string;
  obtainedFromActionId: string;
  visibility: "PRIVATE" | "PUBLIC";
}
```

MVP 规则：

- 新证据默认 `PRIVATE`；
- 只有拥有者投影包含完整证据；
- 其他角色最多看到调查造成的可观察痕迹；
- 同一 `provenanceKey` 重复获得不会升级证据；
- 证据明确显示“能支持什么”和“不能证明什么”；
- 本轮不实现证据组合、交换、伪造和三级升级。

## 4.4 复用现有持久化

MVP 优先复用：

- `PlayerAction.normalizedJson / immediateJson / resolvedJson`；
- `PlayerAction.actionSlot`；
- `RoleAsset / RoleAssetMutation`；
- `StoryEvent / EventDelivery`；
- `InteractionRequestV2`；
- 当前世界状态和投影中的 `observableTraces`、`evidenceHoldings`。

除非代码证明无法满足原子性，否则本轮禁止新增 Prisma 模型和数据库迁移。

---

# 5. 玩家安全的预演合同

## 5.1 草稿请求

```ts
export interface ManeuverDraftV1 {
  kind: "CONTACT" | "INVESTIGATE" | "LEVERAGE" | "CUSTOM";
  targetId?: string;
  intentKey?: string;
  traceId?: string;
  routeId?: string;
  leverageAssetId?: string;
  rawText?: string;
  expectedTurnRevision: number;
}
```

## 5.2 编译后的内部行动

```ts
export interface CompiledManeuverV1 {
  schemaVersion: "compiled_maneuver_v1";
  kind: "CONVERSATION" | "INVESTIGATION" | "ACTION";
  actorRoleId: string;
  targetRef: string;
  objective: string;
  method: string;
  primaryEffect: string;
  attachedLeverageId?: string;
  visibility: "PRIVATE" | "TARGETED" | "PUBLIC";
  guaranteedStart: string[];
  contestedOutcome: string[];
  notGuaranteed: string[];
  stateRevision: number;
  turnRevision: number;
}
```

`CompiledManeuverV1` 是后台合同，不直接完整展示给玩家。

## 5.3 玩家预演响应

```ts
export interface ManeuverPreviewV1 {
  previewToken: string;
  expiresAt: string;
  presentation: {
    title: string;
    description: string;
    visibleEffect: string;
    visibleRisk?: string;
    confirmLabel: string;
  };
  rerouteTo?: "CONTACT" | "INVESTIGATE" | "LEVERAGE" | "CUSTOM";
  clarificationPrompt?: string;
}
```

预演 Token 必须由服务端签名，至少绑定：

- Run；
- 角色；
- ActorTurn；
- stateRevision；
- turnRevision；
- 编译行动摘要；
- 过期时间。

MVP 使用签名 Token，避免新增 `ActionPreview` 数据表。

## 5.4 确认请求

```ts
export interface ManeuverCommitRequestV1 {
  previewToken: string;
  idempotencyKey: string;
  expectedStateRevision: number;
}
```

提交成功后返回更新后的玩家投影；提交失败返回玩家可恢复的错误，不把整个 Run 标记为失败。

## 5.5 玩家可见错误

至少包括：

```text
MANEUVER_WINDOW_CLOSED
MANEUVER_LIMIT_REACHED
PREVIEW_EXPIRED
PREVIEW_STALE
PREVIEW_TAMPERED
TARGET_UNAVAILABLE
TRACE_UNAVAILABLE
LEVERAGE_UNAVAILABLE
ACTION_NEEDS_CLARIFICATION
ACTION_NOT_ALLOWED
REVISION_CONFLICT
```

页面只显示普通玩家语言，不显示内部 JSON、Predicate、entityId、ACL 或堆栈。

---

# 6. API 与运行链

## 6.1 外部 API

在现有 `/api/v4/rooms` 路径下增加：

```text
POST /api/v4/rooms/:runId/maneuvers/preview
POST /api/v4/rooms/:runId/maneuvers/commit
```

可选增加只读证据详情：

```text
GET /api/v4/rooms/:runId/evidence/:evidenceId
```

所有接口必须通过现有登录、Run 访问和角色控制权检查。

## 6.2 服务端模块

建议实现为一个聚合模块，避免本轮新增十几个服务：

```text
apps/api/src/maneuver-v1/
  maneuver-v1.controller.ts
  maneuver-v1.service.ts
  maneuver-v1.compiler.ts
  maneuver-v1.presentation.ts
  maneuver-v1.spec.ts
```

职责：

```text
Controller：认证、参数和响应；
Service：权威读取、预演、确认、幂等和事务；
Compiler：四入口映射到统一有限行动；
Presentation：生成玩家可读预演卡。
```

除非真实代码要求，不新增独立 Outbox、Reaction、RuleCard、EvidenceGraph 服务。

## 6.3 AI 的使用边界

结构化入口优先使用确定性编译。

自拟谋划可以调用现有模型进行语义解析，但必须：

- 输出固定 Schema；
- 只选择当前投影提供的目标和能力；
- 不得自行创造证据、权限、人物和结果；
- 解析失败返回 `CLARIFY`，不能让 Run 失败；
- 模型不可用时仍可使用结构化三个入口；
- 不写故事专用关键词或同义词规则。

本轮不要求新建一套 AI Agent 编排系统。

## 6.4 投影新增字段

现有 Game Projection 至少提供：

```ts
interface ManeuverProjectionV1 {
  maxPerTurn: 2;
  remaining: number;
  windowState: "OPEN" | "CLOSED";
  contacts: Array<{ id: string; label: string }>;
  traces: ObservableTraceV1[];
  leverageAssets: Array<{ id: string; label: string; effectSummary: string }>;
  inProgress: Array<{ actionId: string; label: string; status: string }>;
  privateEvidence: PrivateEvidenceCardV1[];
}
```

必须按当前角色过滤后再返回浏览器。

---

# 7. 现有 `/game` 页面设计

## 7.1 页面边界

不得创建新的游戏页、测试页或平行 Story V4 页面。

不得重做主页面布局。只允许修改现有谋划面板、预演卡、进行中行动和私人证据展示。

## 7.2 右栏

继续显示：

```text
今日谋划 2 / 2
人物交谈
派遣调查
使用筹码
自拟谋划
正在推进
```

但所有数据必须来自服务端投影，不得使用硬编码人物、调查方向、筹码、次数或进行中项目。

## 7.3 预演卡

玩家只看到：

```text
你准备做什么；
对谁或对什么；
行动确认后立即开始什么；
一个玩家能够理解的风险；
明确的确认按钮。
```

例如：

```text
派人核对商会底册

你将沿县令密信留下的经手记录，派一名可信幕僚核对底册来源。
确认后调查立即开始；结果需要等待结算，也可能惊动经手人。

[开始调查底册来源]
```

前端禁止显示：

- `primaryEffect`；
- `Predicate`；
- 内部代价字段；
- 调试说明；
- “系统将执行以下步骤”；
- Reviewer 或测试状态。

## 7.4 左栏证据

调查者自己的左栏增加或复用“情报与证据”区域，显示：

```text
证据标题；
来源类型；
支持什么；
不能证明什么；
私人 / 已公开。
```

其他角色不得收到完整证据 DOM、隐藏属性或 API 数据。

## 7.5 刷新与恢复

刷新页面后必须从服务端重新读取：

- 剩余机会；
- 已提交行动；
- 进行中状态；
- 私人证据。

不得依赖浏览器 LocalStorage 作为权威真源。

## 7.6 UI 验收要求

- 类型切换不能自动提交行动；
- 预演不能扣次数；
- 只有确认按钮提交；
- 按钮文字描述具体动作，不使用“执行谋划”这种抽象文案；
- 桌面和当前窄屏布局都可完成操作；
- 主游戏页面其他区域不发生无关视觉改造。

---

# 8. 明确不在本轮范围

以下内容全部延后，不得因为“以后可能需要”加入本分支：

1. 新 Prisma 模型和大规模迁移；
2. 主动牌、伏置牌、应变牌和完整卡组；
3. 事件驱动应变窗口；
4. 证据交换、伪造、组合和三级升级；
5. 无限调查树和复杂概率系统；
6. Credits 扣费；
7. 新的 Agent、Outbox 或后台调度框架；
8. Solo 和 OpenNovel Story V4 全量适配；
9. G00—T20 AI 剧情连续验收；
10. 第二个正式故事内容；
11. 登录、积分、Billing、部署；
12. 结尾系统；
13. 生产灰度、复杂 Metrics 和运营看板；
14. 全站 UI 重构；
15. 任何临时源码导出 Workflow、补丁下载说明或 GitHub Actions 上传通道。

如果实现者认为某项延后内容是 MVP 的硬依赖，必须先报告：

```text
SCOPE_DEPENDENCY_CONFLICT
```

并给出具体代码证据，不能自行扩大范围。

---

# 9. 文件范围

## 9.1 允许修改

根据实际代码定位，可修改：

```text
packages/shared/src/continuous-strategy/story-v2.schemas.ts
packages/templates/config/*/maneuvers*.json
packages/templates/src/runtime-contract/*
apps/api/src/maneuver-v1/*
apps/api/src/rooms.controller.ts
apps/api/src/rooms.service.ts
apps/api/src/continuous-story-v2/*
apps/web/public/app.js
apps/web/public/main-game.css
apps/web/public/continuous-story-v2-client.js
apps/web/public/continuous-story-v2-legacy-storage.js
apps/web/tests/maneuver-ui.test.mjs
apps/web/tests/continuous-story-v2.test.mjs
scripts/e2e/mvp-acceptance-matrix.ts
与上述功能直接对应的新测试文件
package.json（仅在确有必要时增加聚焦测试命令）
```

## 9.2 默认禁止修改

```text
prisma/schema.prisma
prisma/migrations/**
apps/openovel-runtime/**
登录、Credits、Billing、部署代码
Story V4 Ending 代码
主游戏页面无关区域
无关文档、图片、视频和生成资产
.github/workflows/**
```

如果必须修改默认禁止文件，停止并报告具体依赖，不得直接越界。

---

# 10. 实施阶段与提交顺序

整个任务只有 C0—C5 六个阶段。禁止把它重新扩展成长期 P0—P8 项目，也禁止把六个阶段压成一个无法审查的大提交。

每个阶段都执行：

```text
实现
→ 聚焦测试
→ 显式暂存
→ 独立提交
→ 推送目标分支
→ git ls-remote 回读
→ 输出 CHECKPOINT_C<n>_PUSHED
→ 继续下一阶段
```

## C0：建立干净分支

1. 读取根目录 `AGENTS.md`；
2. `git fetch origin`；
3. 验证 `origin/main` 精确 SHA；
4. 首次启动时验证目标分支不存在；恢复任务时验证目标分支检查点历史；
5. 从 `origin/main` 创建目标分支；
6. 首次推送并设置 upstream；
7. 将本次随提示词附带的已批准需求文档保存到本文档路径；
8. 输出基线证据。

C0 必须提交本次批准的收敛版需求文档，便于确认远程分支确实属于本任务和防止后续需求漂移：

```text
docs(maneuver): freeze converged mvp delivery contract
```

推送后输出 `CHECKPOINT_C0_PUSHED`。

## C1：共享合同和编译器

实现：

- `ManeuverDraftV1`；
- `CompiledManeuverV1`；
- Preview / Commit 合同；
- 结构化入口确定性编译；
- 自拟谋划 READY / REROUTE / CLARIFY / BLOCKED；
- 第二世界 fixture，证明没有《桑田诏》专用关键词。

建议提交：

```text
feat(maneuver): add bounded maneuver contracts and compiler
```

提交并推送后输出 `CHECKPOINT_C1_PUSHED`。C1 未通过前禁止开始 C2。

## C2：API 预演与原子确认

实现：

- preview API；
- 签名预演 Token；
- preview 无副作用；
- commit revision 校验；
- 服务端 2 / 2；
- idempotency；
- 并发争抢最后机会只有一个成功。

建议提交：

```text
feat(maneuver): add preview and authoritative commit flow
```

提交并推送后输出 `CHECKPOINT_C2_PUSHED`。C2 必须能够独立证明 Preview 无副作用以及重复确认不重复扣次。

## C3：调查、私人证据与角色投影

实现：

- observable trace；
- 一条具体调查路线；
- 私人证据卡；
- 同源不升级；
- 其他角色投影和 API 不泄漏证据；
- 一项筹码附加规则。

建议提交：

```text
feat(maneuver): add trace investigation and private evidence
```

提交并推送后输出 `CHECKPOINT_C3_PUSHED`。C3 必须独立证明私人证据未进入其他角色投影。

## C4：真实 `/game` 页面

实现：

- 四入口读取服务端投影；
- 预演卡；
- 具体确认按钮；
- 正在推进；
- 私人证据区；
- 刷新恢复；
- 不影响中央主线决策。

建议提交：

```text
feat(web): connect maneuver preview and evidence to game
```

提交并推送后输出 `CHECKPOINT_C4_PUSHED`。C4 必须提供真实 `/game` 页面证据，不得使用另建的测试页面代替。

## C5：回归、真实验收和远程交付

1. 跑全部聚焦测试；
2. 跑相关现有回归；
3. 启动真实 API 和 Web；
4. 使用一个三角色 Run 完成纵向验收；
5. 推送所有提交；
6. `git ls-remote` 回读最终 SHA；
7. 输出 `CANDIDATE_BRANCH_READY`。

C5 的回归或验收修复必须另建一个或多个范围清楚的提交并逐个推送。完成后先输出 `CHECKPOINT_C5_PUSHED`，只有全部最终门通过才再输出 `CANDIDATE_BRANCH_READY`。

如果测试修复只涉及测试本身，不得降低产品断言或删除失败用例。

---

# 11. 自动化测试门

## 11.1 必须首先核对命令真实存在

禁止把不存在的命令写成 PASS。当前仓库已存在的相关入口包括：

```text
pnpm --filter @ai-story/shared typecheck
pnpm --filter @ai-story/templates typecheck
pnpm --filter @ai-story/templates test:runtime-contract
pnpm --filter @apps/api typecheck
pnpm --filter @apps/api test:continuous-strategy
pnpm --filter @apps/web typecheck
pnpm test:maneuver
pnpm test:story:v4
pnpm build
```

如果实施增加了新的聚焦测试文件，可以直接使用 `node --test` 或 `node --import tsx --test` 运行；不强制为了命令名字新增包装脚本。

## 11.2 聚焦合同测试

必须证明：

1. 四入口都编译为统一有限行动；
2. 一项行动只有一个主要效果；
3. 自拟多动作返回 `CLARIFY`；
4. 越权输入返回 `BLOCKED`；
5. 第二世界 fixture 不依赖《桑田诏》词汇；
6. 筹码只能来自当前角色持有资产。

## 11.3 API 测试

必须证明：

1. preview 不改变数据库和剩余次数；
2. preview Token 篡改、过期和跨角色复用被拒绝；
3. commit 成功只消耗一次；
4. 相同 idempotencyKey 重试返回同一结果；
5. 两个确认争抢最后一个槽只有一个成功；
6. revision 过期返回可恢复冲突；
7. 主线锁定后不能确认新谋划；
8. 非拥有者不能读取私人证据。

## 11.4 Web 测试

至少运行并扩展：

```text
apps/web/tests/maneuver-ui.test.mjs
apps/web/tests/continuous-story-v2.test.mjs
```

必须证明：

1. 四入口存在；
2. 切换入口不提交；
3. 预演不扣次数；
4. 页面只显示玩家预演文字；
5. 确认后更新剩余次数；
6. 刷新后从服务端恢复；
7. 私人证据不会出现在其他角色 DOM；
8. 主线决策仍能提交。

## 11.5 回归边界

必须运行：

```text
pnpm --filter @ai-story/shared typecheck
pnpm --filter @ai-story/templates typecheck
pnpm --filter @apps/api typecheck
pnpm --filter @apps/web typecheck
pnpm test:maneuver
pnpm test:story:v4
pnpm build
```

`pnpm --filter @apps/api test:continuous-strategy` 和相关 Web 测试也必须运行。

如果全仓库存在与本分支无关的历史失败，必须：

- 提供基线同命令对照；
- 证明本分支没有增加失败；
- 不得把全量套件报告为纯 PASS；
- 不得因为历史失败跳过聚焦功能验收。

## 11.6 测试证据格式

每条命令记录：

```text
command
workspace
test total
pass
fail
skip / todo
exit code
log path
```

以下不算通过：

- 0 tests；
- No projects matched；
- only / skip / todo；
- 只跑类型检查；
- 只得到 HTTP 200；
- Mock 通过却声称真实页面通过；
- 包装脚本吞掉错误退出码。

---

# 12. 真实三角色纵向验收

本轮不要求二十回合。只要求一个真实三角色 Run 完成以下纵向闭环。

## 12.1 角色 A：人物交谈

1. A 打开人物交谈；
2. 选择 B 和一个当前局势相关意图；
3. 生成预演；
4. 证明次数仍为 2 / 2；
5. 确认；
6. 证明次数变为 1 / 2；
7. B 只能看见权限允许的互动信息。

## 12.2 角色 B：派遣调查

1. B 只能选择自己可见的痕迹；
2. 预演不扣次数；
3. 确认后获得或进入一项调查；
4. 结果产生一张私人证据卡；
5. B 能看到“支持什么、不能证明什么”；
6. A 和 C 的 API 响应及 DOM 都不包含该证据正文。

## 12.3 角色 C：筹码附加

1. C 选择自己持有的筹码；
2. 把筹码附加到一项允许的行动；
3. 预演说明筹码改变的直接边界；
4. 不产生牌面以外效果；
5. 非法使用他人筹码被拒绝。

## 12.4 自拟谋划

至少验证：

```text
能力内单一行动 → READY；
实质是调查 → REROUTE；
同时要求调查、抓捕和上奏 → CLARIFY；
替其他玩家决定或宣布成功 → BLOCKED。
```

不允许使用故事专用正则让测试通过。

## 12.5 可靠性

必须验证：

- 同一 commit 重试不会多扣一次；
- 两个请求争抢最后机会只有一个成功；
- 刷新后三名角色都恢复正确状态；
- 谋划完成后中央主线决策仍可提交；
- 页面没有显示测试说明、内部 JSON 或隐藏证据。

## 12.6 玩家标准

验收者必须以真实玩家视角判断：

1. 我是否明白自己准备做什么；
2. 我是否知道确认后立即开始什么；
3. 我是否能感到谋划机会有限；
4. 我刚才做的事是否留在世界中；
5. 调查证据是否真的只属于我；
6. 页面是否仍像游戏，而不是后台管理系统。

---

# 13. MVP Definition of Done

全部满足才能输出 `CANDIDATE_BRANCH_READY`：

- 分支直接继承冻结的 `origin/main@1b750e5`；
- 目标远程分支只有本任务真实业务提交；
- 没有从旧分支 merge 或 cherry-pick；
- 没有临时源码导出 Workflow、补丁下载文件或仅用于上传的提交；
- 四入口在现有 `/game` 页面可操作；
- 预演没有副作用；
- 确认只提交一次；
- `2 / 2` 为服务端权威；
- 私人调查证据不会泄漏；
- 筹码只能附加一个且不能越权；
- 自拟谋划不会绕过有限主要效果；
- 刷新可以恢复；
- 主线决策没有回归；
- 聚焦合同、API、Web 和并发测试通过；
- 相关 Story V4 回归没有新增失败；
- 真实三角色纵向验收完成；
- 最终提交已经推送到远程并通过 `git ls-remote` 回读；
- 已知限制和延后范围完整报告；
- 没有修改、提交、合并或推送 `main`。

任一项缺失，只能输出：

```text
CANDIDATE_BRANCH_INCOMPLETE
```

不得使用“核心实现已在本地形成”代替远程业务提交。

---

# 14. 本地 Codex 最终验收流程

ChatGPT Pro 输出候选分支后，本地 Codex 才开始：

1. `git fetch origin --prune`；
2. 核对远程分支精确 SHA；
3. 验证 merge-base 为冻结基线；
4. 验证没有混入旧分支、临时 Workflow 或无关改动；
5. 不在脏 `main` 上直接 pull；
6. 在隔离验证工作区检出远程精确 SHA；
7. 审查全部 diff；
8. 独立重跑聚焦测试和相关回归；
9. 独立启动 API/Web；
10. 以三名角色完成真实纵向验收；
11. 输出 `PASS`、`REPAIR_REQUIRED` 或 `HARD_FAIL`。

失败时：

```text
禁止合并 main
→ 报告失败命令、日志、最小复现和影响
→ ChatGPT Pro 只在同一目标分支修复并推送
→ 本地 Codex 对新 SHA 重新验证
```

同类问题最多往返三轮。第三轮仍失败，停止该方案，不增加故事专用正则、同义词或临时测试例外。

只有本地 Codex 独立 PASS 且仓库所有者另行授权，才可合并 `main`。

---

# 15. 可直接发送给 ChatGPT Pro 的完整提示词

```text
请在具有 GitHub 仓库读写权限、可以真实检出代码、运行命令、提交并推送的编码环境中打开：

https://github.com/forwardFish/aiStoryRoom

我会把以下本地文件作为附件与本提示词一起发送：

Our_Many_Worlds_四类谋划与调查证据系统_完整需求开发文档_v1.0.md

该附件中的“可执行 MVP 收敛版需求开发文档 v1.1”是本任务唯一需求源。远程冻结基线可能尚未包含这份新版文件。若附件缺失、乱码、无法完整读取，立即停止并输出：

REQUIREMENT_DOC_MISSING

不得用同名旧版、其他需求文档或以前聊天中的摘要代替。

这是一次全新的开发任务。以前所有 maneuver 分支和 AI story convergence 分支均视为废弃代码来源，只能作为历史参考，禁止 merge、cherry-pick 或复制其补丁。

冻结基线：
origin/main@1b750e56858dabefb0ddb8b922c6bdcbe0574e4c

仓库所有者明确批准本次唯一新开发分支：
codex/chatgpt-pro-maneuver-evidence-v1

你必须先读取根目录 AGENTS.md，然后完整阅读附件并严格执行；创建目标分支后，将附件原样保存到：

docs/Our_Many_Worlds_四类谋划与调查证据系统_完整需求开发文档_v1.0.md

本任务只实现该文档的 MVP 纵向闭环。禁止把延后范围重新加入本轮。

开工前必须执行并报告：

git remote -v
git fetch origin --prune
git rev-parse origin/main
git ls-remote --heads origin refs/heads/codex/chatgpt-pro-maneuver-evidence-v1
git status --short

开工条件：

1. origin/main 必须精确等于 1b750e56858dabefb0ddb8b922c6bdcbe0574e4c；
2. 第一次开工时目标远程分支必须不存在；恢复中断任务时，目标分支必须只包含本任务已经报告的检查点提交，且远程 HEAD 与最后一次报告的 remoteSha 一致；
3. 当前仓库必须可以安全创建或检出该目标分支；
4. 必须拥有远程推送权限。

任一条件不满足，停止并输出对应错误：

BASELINE_MOVED
TARGET_BRANCH_ALREADY_EXISTS
TARGET_BRANCH_CONFLICT
WORKTREE_NOT_CLEAN
REPO_WRITE_ACCESS_MISSING

第一次开工满足后，从 origin/main 创建并首次推送；恢复中断任务时安全检出同一远程分支：

codex/chatgpt-pro-maneuver-evidence-v1

只能在这个分支开发、测试、提交和推送。

禁止：

- 修改、提交、合并或推送 main；
- 创建指向 main 的 PR；
- 创建第二个开发分支；
- 使用 feat/maneuver-rules-v1、feat/maneuver-rules-v1-20260805、feat/maneuver-rules-v1-full-implementation-20260805、feat/maneuver-rules-v1-gpt56-20260805 或 codex/chatgpt-pro-ai-story-convergence 作为代码来源；
- merge 或 cherry-pick 旧分支；
- force push、git add .、git reset --hard、git clean 或广泛 stash；
- 新增临时源码导出 Workflow、补丁上传通道或下载说明；
- 扩大到登录、积分、Billing、部署、Ending、G00—T20、完整卡牌、应变、证据组合、Solo 或 OpenNovel Story V4 全量接入。

必须按文档 C0—C5 实施：

C0 建立全新分支并回读远程基线；
C0 同时提交附带的已批准需求文档，冻结本任务范围；
C1 实现统一有限行动合同和四入口编译器；
C2 实现无副作用预演、签名 Token、权威 2 / 2、幂等和原子确认；
C3 实现真实痕迹、私人证据投影、同源不升级和单一筹码附加；
C4 接入现有 /game 页面，不重做主页面；
C5 跑工程测试和一个真实三角色纵向验收，然后推送最终提交。

必须分批实施、分批测试、分批提交和分批推送，禁止等全部完成后才第一次推送。每个阶段结束都必须：

1. 只显式暂存该阶段文件；
2. 运行该阶段聚焦测试；
3. 创建独立提交；
4. 推送同一目标分支；
5. 用 git ls-remote 回读远程 SHA；
6. 输出 CHECKPOINT_C0_PUSHED 至 CHECKPOINT_C5_PUSHED 的对应阶段报告；
7. 报告后继续下一阶段，除非遇到文档规定的停止条件。

每份阶段报告必须包含 branch、baseSha、commitSha、remoteSha、files、真实测试结果和 next。阶段检查点不等于最终完成，不得提前输出 CANDIDATE_BRANCH_READY。

核心规则：

1. 预演不扣次数、不改世界、不创建证据；
2. 确认成功只占一个 MANEUVER 槽；
3. 相同 idempotencyKey 不重复提交；
4. 两个请求争抢最后机会只能一个成功；
5. 调查只能沿当前角色可见痕迹进行；
6. 私人证据不能出现在其他角色 API、投影或 DOM；
7. 同源证据不能升级；
8. 一次自拟谋划只能有一个主要效果；
9. 筹码只能来自当前角色持有资产；
10. 谋划结束后中央主线决策仍可提交；
11. 通用代码不得包含《桑田诏》故事专用关键词或同义词补丁；
12. 不新增 Prisma 模型，除非先以 SCOPE_DEPENDENCY_CONFLICT 报告代码证据并停止扩大范围。

页面必须继续使用现有 /game。玩家只看到剧情化的行动预演卡、明确确认按钮、正在推进状态和自己的证据，不显示内部 JSON、Predicate、ACL、测试规则或后台步骤。

必须运行文档第 11 章列出的真实命令并记录：

command
workspace
test total
pass
fail
skip / todo
exit code
log path

不得把 0 tests、No projects matched、only/skip/todo、HTTP 200、单纯 typecheck 或 Mock 当作完整 PASS。

真实验收必须使用一个三角色 Run，证明：

- 人物交谈预演和确认；
- 调查产生私人证据；
- 其他角色看不到该证据；
- 筹码只能由拥有者使用；
- 自拟谋划分别出现 READY / REROUTE / CLARIFY / BLOCKED；
- 预演不扣次数；
- 确认只扣一次；
- 并发争抢最后机会只有一个成功；
- 刷新恢复正确；
- 主线决策仍可提交。

每个阶段都必须产生真实业务代码和对应测试提交。禁止只提交计划、文档、临时 Workflow 或补丁文件。

开发完成后显式暂存本任务文件、提交并推送同一分支。然后执行：

git status --short
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git ls-remote origin refs/heads/codex/chatgpt-pro-maneuver-evidence-v1

只有远程分支已经包含全部业务提交、测试通过且真实三角色验收完成，才能输出：

CANDIDATE_BRANCH_READY

最终报告必须包含：

- 仓库和分支；
- 冻结基线 SHA；
- 最终远程 SHA；
- 完整提交列表；
- 修改文件和 diff stat；
- C0—C5 完成矩阵；
- 所有测试命令和结果；
- 三角色真实验收证据；
- 已知限制和延后范围；
- git ls-remote 的最终 SHA 回读；
- 明确声明没有修改、合并或推送 main。

如果尚未把真实业务代码推送到远程，必须输出 CANDIDATE_BRANCH_INCOMPLETE，不能说“核心实现已在本地形成”。

最终验证和是否合并 main 由本地 Codex 负责。
```

---

# 16. 最终产品判断

本轮成功不代表完整谋划系统已经终结开发；它只代表最重要的纵向闭环已经真实可玩：

```text
有限机会
→ 玩家选择一种谋划
→ 预演
→ 确认
→ 权威结算
→ 私人调查证据
→ 页面恢复和继续主线
```

只有玩家实际体验这条闭环后，才有依据决定下一步优先实现：

- 应变；
- 复杂规则卡；
- 证据组合和公开；
- 更多运行时；
- 更多故事。

这样可以避免再次用一个超大文档阻塞第一轮真实测试。
