# AI 多人局｜StoryRun 状态机与 API 契约 v1.1

> 文档类型：运行态状态机 / 后端 API 契约 / 并发与恢复规范  
> 适用范围：Web 单人 MVP  
> 依赖基线：《MVP 唯一工程基线 v1.1》  
> 核心原则：**任何一次玩家操作都必须由状态机许可、携带版本号、只落账一次、可以在刷新后恢复。**

---

## 0. v1.1 修订说明

本版新增“主动谋划”状态与 API 契约。主动谋划不属于主线决策，不改变每日 2 次主线决策计数。

统一前台术语：

```text
主线决策
主动谋划
谋划机会
自拟谋划
执行谋划
```

统一代码术语：

```text
maneuver
maneuverType
maneuverOpportunitiesPerDay
maneuversUsedToday
maneuverOpportunitiesRemaining
```

前台和接口中禁止使用 `AP / 行动力 / 行动点 / 筹谋`。

## 1. 统一术语

| 名称 | 类型 | 说明 |
|---|---|---|
| `templateKey` | string | 剧本键，MVP 固定为 `sangtian` |
| `roleKey` | string | 角色键，玩家固定为 `zhejiang_governor` |
| `runId` | string | 一局游戏唯一标识 |
| `eventId` | string | 一个 StoryEvent 唯一标识 |
| `version` | integer | StoryRun 乐观锁版本，任何写操作成功后 +1 |
| `optionKey` | string | 预设选择键，如 `A/B/C/D` |
| `customText` | string | 自定义决策文本，最大 500 字 |
| `idempotencyKey` | string | 客户端写请求唯一键，建议 UUID |
| `maneuverType` | string | 谋划类型：`contact / investigate / leverage / custom` |
| `targetRoleKey` | string? | 谋划目标角色 |
| `intentKey` | string? | 交谈或谋划意图，如 `probe / request_intel / pressure / trade` |
| `leverageKey` | string? | 本次谋划使用的筹码键 |
| `maneuverOpportunitiesPerDay` | integer | 每日谋划机会，MVP 固定为 2 |
| `maneuversUsedToday` | integer | 当日已成功执行的谋划次数 |
| `maneuverOpportunitiesRemaining` | integer | 当日剩余谋划机会 |

---

## 2. StoryRun 状态集合

```text
created
awaiting_decision
resolving
awaiting_day_advance
awaiting_finalization
finished
abandoned
error_recoverable
```

### 2.1 状态定义

#### created

StoryRun 已创建，但第 1 天开局事件尚未完全写入。

- 对用户通常不可见；
- 创建事务完成后应立即进入 `awaiting_decision`；
- 若创建中断，恢复任务可补齐开局事件。

#### awaiting_decision

当前存在一个未处理的 `decision_prompt`。

- 允许读取；
- 允许对唯一活动 `eventId` 提交一次主线决策；
- 若当日仍有谋划机会，允许提交主动谋划；
- 主动谋划不会解决 `activeDecision`，也不会增加 `decisionsCompletedToday`；
- 禁止推进天数；
- 禁止最终裁决。

#### resolving

服务器正在校验、调用 AI、规范化并落账。

公共视图应返回：

```text
resolvingKind = decision | maneuver | finalization
```

- 写入前必须已经通过 `version` 和幂等检查；
- 同一 `idempotencyKey` 重试只能返回同一结果；
- 新决策请求返回 `409 RUN_BUSY` 或已有结果；
- 页面刷新应显示“正在推演”，并轮询恢复。

#### awaiting_day_advance

当日两次关键决策均已完成，日终回响已写入。

- 允许读取；
- 若当日仍有谋划机会，允许继续提交主动谋划；
- 允许玩家放弃未使用的谋划机会并调用 `advance-day`；
- 未使用的谋划机会不结转；
- 禁止提交主线决策；
- 禁止提前 finalize。

#### awaiting_finalization

已进入第 7 天，前 6 天共 12 次关键决策完成。

- 允许读取；
- 允许 `finalize`；
- 禁止提交主线决策；
- 禁止提交主动谋划；
- 禁止再次 `advance-day`。

#### finished

最终裁决已经写入。

- 只读；
- 所有普通写操作均拒绝；
- 用户可通过创建新局实现“重开”。

#### abandoned

用户主动放弃或系统按保留策略归档。

- 只读；
- 不允许继续推演；
- 可创建新局。

#### error_recoverable

AI 或持久化过程中出现可恢复异常，且规则 fallback 尚未完成。

- 只允许查询和恢复操作；
- 不允许重复决策；
- 恢复成功后回到原本的目标状态；
- 超过恢复次数后使用规则 fallback。

---

## 3. 状态转移图

```text
POST create
    │
    ▼
 created
    │ 初始化第 1 天和第 1 个 decision_prompt
    ▼
 awaiting_decision
    ├─ submit maneuver（可选，最多 2 次/日）
    │      ▼
    │   resolving
    │      ▼
    │   awaiting_decision
    │
    │ submit decision #1
    ▼
 resolving
    │ 成功落账并生成第 2 个 prompt
    ▼
 awaiting_decision
    │ submit decision #2
    ▼
 resolving
    │ 成功落账并生成 day_end
    ▼
 awaiting_day_advance
    ├─ submit maneuver（若仍有剩余机会）
    │      ▼
    │   resolving
    │      ▼
    │   awaiting_day_advance
    │
    │ advance-day（第 1—5 天）
    └───────────────────────────────┐
                                    ▼
                            awaiting_decision

第 6 天完成两次决策
    ▼
 awaiting_day_advance
    │ advance-day
    ▼
 awaiting_finalization
    │ finalize
    ▼
 resolving
    │ 最终裁决落账
    ▼
 finished
```

任何状态都可能因可恢复异常短暂进入：

```text
error_recoverable → 恢复原状态或 fallback 后进入目标状态
```

---

## 4. 状态许可矩阵

| 当前状态 | GET run/messages/dashboard | 提交主线决策 | 提交主动谋划 | advance-day | finalize | 创建新局 |
|---|---:|---:|---:|---:|---:|---:|
| created | 允许 | 禁止 | 禁止 | 禁止 | 禁止 | 允许 |
| awaiting_decision | 允许 | 允许（唯一活动事件） | 允许（有剩余谋划机会） | 禁止 | 禁止 | 允许 |
| resolving | 允许 | 禁止/幂等查询 | 禁止/幂等查询 | 禁止 | 禁止 | 允许 |
| awaiting_day_advance | 允许 | 禁止 | 允许（有剩余谋划机会） | 允许 | 禁止 | 允许 |
| awaiting_finalization | 允许 | 禁止 | 禁止 | 禁止 | 允许 | 允许 |
| finished | 允许 | 禁止 | 禁止 | 禁止 | 禁止 | 允许 |
| abandoned | 允许 | 禁止 | 禁止 | 禁止 | 禁止 | 允许 |
| error_recoverable | 允许 | 禁止 | 禁止 | 禁止 | 禁止 | 允许 |

---

## 5. 并发、version 与幂等规则

### 5.1 version

所有修改 StoryRun 的请求，包括主线决策、主动谋划、推进天数和最终裁决，必须携带当前 `version`：

```json
{ "version": 7 }
```

服务器仅在当前版本等于请求版本时执行。

成功后：

```text
nextVersion = request.version + 1
```

不匹配返回：

```http
409 Conflict
```

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "StoryRun 已被更新，请刷新后重试。",
    "details": {
      "expectedVersion": 7,
      "currentVersion": 8
    }
  }
}
```

### 5.2 idempotencyKey

所有 POST 写请求建议携带：

```http
Idempotency-Key: <uuid>
```

或者请求体：

```json
{ "idempotencyKey": "uuid" }
```

规则：

- 同一 `runId + endpoint + idempotencyKey` 只能产生一次状态变更；
- 第一次成功后，重复请求返回第一次的相同成功结果；
- 第一次仍在执行时，重复请求返回 `202/409` 并附任务状态；
- 不同请求体复用同一个 key，返回 `409 IDEMPOTENCY_KEY_REUSED`。

### 5.3 重复决策

同一个 `decision_prompt eventId` 只能绑定一个已接受决策。

- 已完成后再次提交同一选项：返回已存在结果，不重复落账；
- 已完成后提交不同选项：返回 `409 DECISION_ALREADY_RESOLVED`；
- 使用旧 `version`：优先返回 `VERSION_CONFLICT`。

---

### 5.4 主动谋划计数与重复提交

```text
第 1—6 天 maneuverOpportunitiesPerDay = 2
第 7 天 maneuverOpportunitiesPerDay = 0
```

规则：

- 每次合法且成功落账的主动谋划使 `maneuversUsedToday + 1`；
- ActionGuard 返回 `blocked / rewrite_needed` 时不消耗谋划机会，不增加 `version`；
- 同一 `idempotencyKey` 重试返回第一次结果，不重复扣减；
- 当 `maneuverOpportunitiesRemaining = 0` 时返回 `409 MANEUVER_LIMIT_REACHED`；
- `advance-day` 成功后，上一日未使用机会作废，新一天重置为 2；
- 主动谋划不能解决 `activeDecision`，不能修改 `decisionsCompletedToday`；
- 谋划可影响关系、线索、筹码、任务、风险、FateSeed 和后续剧情，但不得直接跳过主线事件。

## 6. AI 超时与失败状态

### 6.1 超时策略

```text
规则预校验（主线决策或主动谋划）
→ 调用 AI（20—30 秒超时）
→ 解析 / Schema 校验
→ 失败重试 1 次
→ 仍失败则规则模板 fallback
→ 正常落账
```

### 6.2 状态处理

- AI 调用期间：`resolving`；
- AI 超时但可重试：仍为 `resolving`，AiTask 记录 `retrying`；
- 两次失败：不把 StoryRun 留在失败状态，立即执行 fallback；
- 持久化失败：进入 `error_recoverable`，保留幂等键和已计算结果；
- 恢复任务必须保证不产生重复事件。

### 6.3 玩家看到的内容

```text
正在推演这一步的影响……
```

若 fallback 生效：

```text
本次剧情由规则模板完成，决策与因果已经正常落账。
```

MVP 可以不向普通用户显示“AI 失败”技术细节，但后台必须记录。

---

## 7. 页面刷新与恢复

### 7.1 浏览器只保存

```text
currentRunId
```

### 7.2 刷新流程

```text
读取 runId
→ GET /story-runs/:runId
→ 根据 status 渲染
```

| 状态 | 页面表现 |
|---|---|
| awaiting_decision | 恢复当前消息、选项与剩余谋划机会 |
| resolving | 显示推演中并轮询 GET run |
| awaiting_day_advance | 显示日终回响、剩余谋划机会和“进入下一天” |
| awaiting_finalization | 显示“进入御前裁决” |
| finished | 显示最终结局 |
| 404 | 明确提示原局不存在，不静默新建 |
| version conflict | 自动刷新最新状态，让用户重新确认未落账输入 |

### 7.3 第 7 天约束

进入第 7 天后：

```text
currentDay = 7
status = awaiting_finalization
activeDecision = null
decisionsRequiredToday = 0
totalDecisionsCompleted = 12
maneuverOpportunitiesRemaining = 0
```

任何普通决策接口返回：

```http
409 FINALIZATION_ONLY
```

---

## 8. 通用响应格式

### 8.1 成功

读取接口直接返回资源；写接口返回最新完整公共视图：

```json
{
  "run": {},
  "player": {},
  "messages": [],
  "activeDecision": {},
  "maneuverPanel": {
    "opportunitiesPerDay": 2,
    "usedToday": 0,
    "remainingToday": 2,
    "contacts": [],
    "pursuits": [],
    "availableLeverage": [],
    "customEnabled": true
  },
  "dashboard": {},
  "daySummary": null,
  "finalJudgement": null,
  "meta": {
    "schemaVersion": "mvp-v1",
    "serverTime": "2026-07-10T12:00:00.000Z"
  }
}
```

### 8.2 错误

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "面向开发或用户的错误说明",
    "details": {}
  }
}
```

---

## 9. API 契约

## 9.1 获取剧本列表

```http
GET /api/v4/stories
```

成功：`200 OK`

```json
{
  "stories": [
    {
      "templateKey": "sangtian",
      "title": "桑田诏：嘉靖财政危局",
      "category": "历史权谋",
      "totalDays": 7,
      "status": "playable"
    }
  ]
}
```

幂等：天然幂等。

---

## 9.2 获取剧本详情

```http
GET /api/v4/stories/:templateKey
```

成功：`200 OK`；不存在：`404 TEMPLATE_NOT_FOUND`。

---

## 9.3 获取角色列表

```http
GET /api/v4/stories/:templateKey/roles
```

成功：`200 OK`

```json
{
  "roles": [
    {
      "roleKey": "zhejiang_governor",
      "name": "浙江总督",
      "playable": true,
      "mvpReason": null
    },
    {
      "roleKey": "xunfu",
      "name": "浙江巡抚",
      "playable": false,
      "mvpReason": "单人 MVP 暂由 AI 控制"
    }
  ]
}
```

---

## 9.4 创建 StoryRun

```http
POST /api/v4/story-runs
```

请求：

```json
{
  "templateKey": "sangtian",
  "mode": "single",
  "selectedRoleKey": "zhejiang_governor",
  "idempotencyKey": "uuid"
}
```

校验：

- `templateKey` 必须存在；
- MVP 只允许 `mode=single`；
- 只允许 `selectedRoleKey=zhejiang_governor`。

成功：`201 Created`

返回最新完整公共视图，初始状态应为：

```json
{
  "run": {
    "id": "run_xxx",
    "templateKey": "sangtian",
    "selectedRoleKey": "zhejiang_governor",
    "status": "awaiting_decision",
    "currentDay": 1,
    "totalDays": 7,
    "version": 1,
    "decisionsCompletedToday": 0,
    "decisionsRequiredToday": 2,
    "totalDecisionsCompleted": 0,
    "totalDecisionsRequired": 12,
    "maneuverOpportunitiesPerDay": 2,
    "maneuversUsedToday": 0,
    "maneuverOpportunitiesRemaining": 2
  }
}
```

错误：

- `400 INVALID_REQUEST`
- `404 TEMPLATE_NOT_FOUND`
- `422 ROLE_NOT_PLAYABLE`
- `409 IDEMPOTENCY_KEY_REUSED`

幂等：同一 key 返回同一 run。

---

## 9.5 获取 StoryRun

```http
GET /api/v4/story-runs/:runId
```

成功：`200 OK`；不存在：`404 RUN_NOT_FOUND`。

返回必须是前台公共投影，不得包含：

```text
hiddenMeaning
privateReasoningSummary
hiddenIntent
完整 helpTriggers / backfireTriggers
未公开证据 holder 信息
完整责任权重
```

---

## 9.6 获取消息流

```http
GET /api/v4/story-runs/:runId/messages?after=<eventId>&limit=50
```

成功：`200 OK`

```json
{
  "messages": [],
  "nextCursor": null
}
```

过滤规则：只返回玩家可见事件。

---

## 9.7 获取 Dashboard

```http
GET /api/v4/story-runs/:runId/dashboard
```

成功：`200 OK`

```json
{
  "worldState": {},
  "roleState": {},
  "relationships": [],
  "latestChanges": [],
  "risks": [],
  "clues": [],
  "traces": [],
  "visibleCausalCard": null,
  "causalRecallMessages": [],
  "maneuverPanel": {
    "opportunitiesPerDay": 2,
    "usedToday": 0,
    "remainingToday": 2,
    "contacts": [],
    "pursuits": [],
    "availableLeverage": []
  }
}
```

---

## 9.8 提交决策

```http
POST /api/v4/story-runs/:runId/messages/:eventId/decisions
```

预设选项请求：

```json
{
  "optionKey": "B",
  "customText": "",
  "version": 7,
  "idempotencyKey": "uuid"
}
```

自定义请求：

```json
{
  "optionKey": "CUSTOM",
  "customText": "我不拦截急奏，但另写密奏，并让县令整理粮价证据。",
  "version": 7,
  "idempotencyKey": "uuid"
}
```

成功：`201 Created`，返回最新完整公共视图。

ActionGuard 拒绝：`200 OK` 或 `422` 均可，但全项目必须统一。推荐：

```http
422 Unprocessable Entity
```

```json
{
  "error": {
    "code": "ACTION_BLOCKED",
    "message": "该行动超出浙江总督的权力边界。",
    "details": {
      "severity": "blocked",
      "rewriteSuggestion": "改为调查、密奏、施压或请求问责。"
    }
  }
}
```

其他错误：

- `400 CUSTOM_TEXT_REQUIRED`
- `404 RUN_NOT_FOUND / EVENT_NOT_FOUND`
- `409 VERSION_CONFLICT`
- `409 DECISION_ALREADY_RESOLVED`
- `409 RUN_BUSY`
- `409 INVALID_RUN_STATE`
- `429 AI_BUDGET_EXCEEDED`

幂等：同一 key 返回第一次落账结果。

---

## 9.9 提交主动谋划

```http
POST /api/v4/story-runs/:runId/maneuvers
```

支持四种谋划类型：

```text
contact       主动接触人物
investigate   派遣调查
leverage      使用筹码
custom        自拟谋划
```

人物交谈请求：

```json
{
  "maneuverType": "contact",
  "targetRoleKey": "county_magistrate",
  "intentKey": "request_intel",
  "customText": "",
  "version": 7,
  "idempotencyKey": "uuid"
}
```

派遣调查请求：

```json
{
  "maneuverType": "investigate",
  "intentKey": "inspect_courier_registry",
  "customText": "",
  "version": 7,
  "idempotencyKey": "uuid"
}
```

使用筹码请求：

```json
{
  "maneuverType": "leverage",
  "targetRoleKey": "merchant",
  "leverageKey": "land_contract_fragment",
  "intentKey": "pressure",
  "customText": "",
  "version": 7,
  "idempotencyKey": "uuid"
}
```

自拟谋划请求：

```json
{
  "maneuverType": "custom",
  "customText": "派幕僚暗查驿站登记，确认巡抚急奏的经手人员。",
  "version": 7,
  "idempotencyKey": "uuid"
}
```

前置条件：

```text
currentDay ∈ [1, 6]
status = awaiting_decision 或 awaiting_day_advance
maneuverOpportunitiesRemaining > 0
run 不处于 resolving
```

成功：`201 Created`，返回最新完整公共视图。

成功落账必须：

```text
写入 maneuver 事件
写入 maneuver_result 结果消息
必要时写入 state_patch / role_reaction / leverage_used / pursuit_updated / fate_seed_created
maneuversUsedToday + 1
maneuverOpportunitiesRemaining - 1
version + 1
```

ActionGuard 拒绝：`422 ACTION_BLOCKED`。拒绝时：

```text
不消耗谋划机会
不增加 version
不写入状态补丁
可返回 rewriteSuggestion
```

其他错误：

- `400 MANEUVER_CUSTOM_TEXT_REQUIRED`
- `404 RUN_NOT_FOUND`
- `404 TARGET_ROLE_NOT_FOUND`
- `404 LEVERAGE_NOT_FOUND`
- `409 VERSION_CONFLICT`
- `409 RUN_BUSY`
- `409 INVALID_RUN_STATE`
- `409 MANEUVER_LIMIT_REACHED`
- `409 MANEUVER_NOT_AVAILABLE`
- `409 LEVERAGE_NOT_AVAILABLE`

幂等：同一 key 返回第一次落账结果，不重复扣减谋划机会。

## 9.10 推进到下一天

```http
POST /api/v4/story-runs/:runId/advance-day
```

请求：

```json
{
  "version": 9,
  "idempotencyKey": "uuid"
}
```

前置条件：

```text
status = awaiting_day_advance
activeDecision = null
decisionsCompletedToday = 2
```

`maneuverOpportunitiesRemaining` 可以大于 0。玩家允许放弃剩余谋划机会进入下一天。

成功：`201 Created`

- 第 1—5 天推进后进入下一天 `awaiting_decision`，并将 `maneuversUsedToday` 重置为 0、`maneuverOpportunitiesRemaining` 重置为 2；
- 第 6 天推进后进入第 7 天 `awaiting_finalization`，谋划机会归零；
- 未使用的谋划机会不结转。

错误：

- `409 DAY_NOT_COMPLETE`
- `409 ALREADY_FINAL_DAY`
- `409 VERSION_CONFLICT`
- `409 INVALID_RUN_STATE`

---

## 9.11 最终裁决

```http
POST /api/v4/story-runs/:runId/finalize
```

请求：

```json
{
  "version": 19,
  "idempotencyKey": "uuid"
}
```

前置条件：

```text
currentDay = 7
status = awaiting_finalization
totalDecisionsCompleted = 12
activeDecision = null
```

成功：`201 Created`

```json
{
  "run": { "status": "finished", "currentDay": 7, "version": 20 },
  "finalJudgement": {
    "globalEnding": {},
    "personalEnding": {},
    "keyMovesThatSavedYou": [],
    "keyMovesThatHurtYou": [],
    "fateDebt": [],
    "emperorJudgement": "",
    "futureAftermath": ""
  }
}
```

错误：

- `409 FINALIZATION_NOT_READY`
- `409 ALREADY_FINISHED`
- `409 VERSION_CONFLICT`

---

## 10. HTTP 状态码与错误码总表

| HTTP | code | 说明 |
|---:|---|---|
| 400 | INVALID_REQUEST | 请求格式错误 |
| 400 | CUSTOM_TEXT_REQUIRED | 选择 CUSTOM 但未填写内容 |
| 404 | TEMPLATE_NOT_FOUND | 剧本不存在 |
| 404 | RUN_NOT_FOUND | StoryRun 不存在 |
| 404 | EVENT_NOT_FOUND | 事件不存在或不可见 |
| 409 | VERSION_CONFLICT | 版本冲突 |
| 409 | RUN_BUSY | 正在推演 |
| 409 | INVALID_RUN_STATE | 当前状态不允许此操作 |
| 409 | DECISION_ALREADY_RESOLVED | 决策已完成 |
| 409 | DAY_NOT_COMPLETE | 当天两次决策未完成 |
| 409 | FINALIZATION_NOT_READY | 尚未到第 7 天或不足 12 次决策 |
| 409 | MANEUVER_LIMIT_REACHED | 当日谋划机会已用尽 |
| 409 | MANEUVER_NOT_AVAILABLE | 当前阶段或目标不允许该谋划 |
| 409 | LEVERAGE_NOT_AVAILABLE | 筹码不存在、已使用或当前不可用 |
| 400 | MANEUVER_CUSTOM_TEXT_REQUIRED | 自拟谋划缺少文本 |
| 409 | IDEMPOTENCY_KEY_REUSED | 幂等键被不同请求复用 |
| 422 | ROLE_NOT_PLAYABLE | 角色当前不可玩 |
| 422 | ACTION_BLOCKED | 自定义行动被 ActionGuard 拒绝 |
| 429 | AI_BUDGET_EXCEEDED | 达到单局 AI 预算上限 |
| 502 | AI_INVALID_OUTPUT | AI 输出无法解析且 fallback 失败 |
| 503 | STORAGE_UNAVAILABLE | 存储不可用 |

---

## 11. 关键不变量

任何代码、测试和数据库实现都必须保证：

```text
currentDay ∈ [1, 7]
version 每次成功写入只增加 1
第 1—6 天 decisionsRequiredToday = 2
第 7 天 decisionsRequiredToday = 0
总决策数最多 12
第 1—6 天 maneuverOpportunitiesPerDay = 2
第 7 天 maneuverOpportunitiesPerDay = 0
0 <= maneuversUsedToday <= 2
maneuverOpportunitiesRemaining = maneuverOpportunitiesPerDay - maneuversUsedToday
主动谋划不能改变 decisionsCompletedToday
一个 decision_prompt 最多一个已接受决策
finished 时必须存在 finalJudgement
每个因果回溯必须引用 originEventIds
前台投影不得泄露后台私密字段
```
