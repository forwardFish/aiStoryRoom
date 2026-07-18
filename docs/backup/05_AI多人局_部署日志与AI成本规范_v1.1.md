# AI 多人局｜部署、日志与 AI 成本规范 v1.1

> 文档类型：部署规范 / 可观测性 / AI 调用治理 / 数据恢复  
> 适用范围：Web 单人 MVP  
> 核心原则：**规则引擎必须在没有 AI 的情况下完成游戏；AI 失败只能影响表现质量，不能破坏状态和因果账本。**

---

## 0. v1.1 修订说明

本版将“主动谋划”纳入 AI 调用预算、日志、fallback、告警和恢复规范。

主动谋划规则：

```text
第 1—6 天每天最多 2 次
单局最多 12 次
主动谋划可选
不影响 12 次主线决策数量
```

代码和日志统一使用 `maneuver`，前台显示“谋划”。

## 1. 环境分层

| 环境 | 用途 | 数据 | AI |
|---|---|---|---|
| local | 本地开发 | 临时目录或本地数据库 | rules/mock 优先 |
| test | 自动化测试 | 每次隔离重置 | 固定 mock |
| staging | 试玩验收 | 独立持久化实例 | 真实模型 + fallback |
| production | 正式 MVP | 生产数据库与备份 | 真实模型 + 限额 + 告警 |

不得让 staging 和 production 共用数据库、密钥或 AI 调用预算。

---

## 2. 环境变量

```bash
# Service
NODE_ENV=production
API_PORT=3001
WEB_PORT=5177
PUBLIC_API_BASE_URL=/api

# Storage
DATABASE_URL=postgresql://...
MVP_STORY_DATA_DIR=/data/mvp-story-runs
STORY_STORAGE_DRIVER=postgres
STORY_EVENT_RETENTION_DAYS=365

# AI provider
AI_CAUSAL_PROVIDER=rules|deepseek|openai|mock
AI_MODEL=<model-name>
AI_BASE_URL=<provider-base-url>
AI_API_KEY=<secret>
AI_TIMEOUT_MS=25000
AI_MAX_RETRIES=1
AI_TEMPERATURE=0.4
AI_DECISION_MAX_INPUT_TOKENS=6000
AI_DECISION_MAX_OUTPUT_TOKENS=1800
AI_MANEUVER_MAX_INPUT_TOKENS=4000
AI_MANEUVER_MAX_OUTPUT_TOKENS=1200
AI_DAY_END_MAX_INPUT_TOKENS=4000
AI_DAY_END_MAX_OUTPUT_TOKENS=1000
AI_FINAL_MAX_INPUT_TOKENS=12000
AI_FINAL_MAX_OUTPUT_TOKENS=2500
AI_RUN_MAX_CALLS=55
AI_RUN_MAX_TOTAL_TOKENS=260000
AI_RUN_COST_LIMIT_MINOR=<integer-minor-unit>

# Security / observability
LOG_LEVEL=info
LOG_REDACT_AI_PROMPTS=true
SENTRY_DSN=
ALERT_WEBHOOK_URL=
DATA_ENCRYPTION_KEY=
BACKUP_BUCKET=
BACKUP_RETENTION_DAYS=30
```

敏感变量只能由密钥管理系统提供，不得提交进 Git。

---

## 3. AI 调用预算

### 3.1 单局最大调用次数

标准 7 天局：

```text
12 次主线决策 resolve：最多 12 次主要调用
12 次主动谋划 resolve：最多 12 次主要调用
6 次日终摘要：最多 6 次
1 次最终裁决：最多 1 次
自定义主线决策 ActionGuard：最多 12 次轻量调用
自拟谋划 ActionGuard：最多 12 次轻量调用
------------------------------------------------
理论硬上限：55 次 provider 调用
```

推荐优先规则：

- 预设 A/B/C 不单独调用 ActionGuard；
- 结构化人物交谈、调查和筹码使用优先走确定性 Guard；
- 只有自定义文本或语义模糊时才调用轻量 AI Guard；
- 每个主线决策最多 1 次主要生成调用；
- 每个主动谋划最多 1 次主要生成调用；
- 一次谋划中的多个角色反应合并在同一结构化输出中；
- 谋划机会未使用时不得为了“补满内容”主动调用模型。

### 3.2 Token 硬限制

| 任务 | 最大输入 | 最大输出 |
|---|---:|---:|
| 主线决策推演 | 6,000 | 1,800 |
| 主动谋划推演 | 4,000 | 1,200 |
| 日终摘要 | 4,000 | 1,000 |
| 最终裁决 | 12,000 | 2,500 |
| ActionGuard 轻量调用 | 2,000 | 500 |

单局总 token 建议硬限制：`260,000`。超过后，剩余主线决策和主动谋划均切换规则模板，不再调用模型。

### 3.3 成本计算

不把供应商价格写死在代码。运行时配置：

```text
inputPricePerMillion
outputPricePerMillion
currency
```

单次成本：

```text
cost = inputTokens / 1,000,000 × inputPrice
     + outputTokens / 1,000,000 × outputPrice
```

单局成本应分别聚合：

```text
decisionCost
maneuverCost
guardCost
dayEndCost
finalCost
totalCost
```

单局累计超过 `AI_RUN_COST_LIMIT_MINOR` 后，剩余步骤使用规则 fallback。

### 3.4 成本保护优先级

达到预算阈值时按以下顺序降级：

```text
1. 自拟谋划改用确定性 Guard + 规则结果
2. 结构化谋划完全使用规则模板
3. 日终摘要使用模板摘要
4. 主线决策保留 1 次主要调用
5. 最终裁决在规则候选内使用模板文案
```

任何降级都不得改变已落账状态或删除因果来源。

## 4. 调用超时与重试

```text
单次超时：25 秒（允许配置 20—30 秒）
主线决策或主动谋划解析 / Schema 失败：自动重试 1 次
第二次仍失败：规则模板 fallback
```

禁止：

- 无限重试；
- 因 AI 失败重复写 decision；
- 返回半成品状态；
- 让玩家一直停在 resolving。

重试必须复用同一个业务幂等键，并创建独立 AiTask attempt 记录。

---

## 5. AI 输出处理流水线

```text
buildContext
→ callProvider
→ captureRawResponse
→ parseJson
→ normalize
→ JSON Schema validate
→ business rule validate
→ clamp / approve state patch
→ apply transaction
→ append StoryEvents
→ mark AiTask success
```

任何一步失败：

```text
记录失败原因
→ 若可重试则重试 1 次
→ 使用 deterministic fallback
→ 继续正常落账
```

AI 原始输出永远不能直接修改 StoryRun。

---

## 6. fallback 规范

### 6.1 fallback 必须保证

- 保留玩家原始主线决策或主动谋划；
- 使用预设或规则计算的状态补丁；
- 主动谋划 fallback 仍需正确扣减 1 次谋划机会；
- 生成保守的结果消息；
- 生成可见因果卡；
- 创建必要 FateSeed，但不创建无法验证的复杂伏笔；
- 生成符合角色默认惯性的最小反应；
- 允许继续下一主线决策、下一次谋划和下一天；
- 最终裁决仍可完成。

### 6.2 fallback 标记

后台：

```json
{
  "provider": "rules",
  "fallbackUsed": true,
  "fallbackReason": "provider_timeout"
}
```

普通用户无需看到技术错误；管理后台必须可查。

---

## 7. AiTask 日志模型

至少记录：

```text
id
runId
eventId
taskType
attempt
status
provider
modelName
inputDigest
inputJson（按隐私配置）
rawResponse（可加密/脱敏）
normalizedJson
validationErrors
fallbackUsed
fallbackReason
inputTokens
outputTokens
estimatedCost
startedAt
completedAt
latencyMs
errorCode
errorMessage
```

状态：

```text
pending
running
retrying
success
failed
fallback_success
abandoned
```

---

### 7.1 新增 taskType

```text
maneuver_guard
resolve_maneuver
```

`resolve_maneuver` 必须记录：

```text
maneuverType
targetRoleKey
intentKey
leverageKey
opportunitiesBefore
opportunitiesAfter
```

禁止在普通应用日志中记录完整自拟谋划原文。

## 8. 应用日志

### 8.1 结构化日志字段

```json
{
  "timestamp": "",
  "level": "info",
  "service": "api",
  "environment": "production",
  "requestId": "",
  "userIdHash": "",
  "runId": "",
  "eventId": "",
  "action": "submit_decision | submit_maneuver",
  "status": "success",
  "durationMs": 532,
  "versionBefore": 7,
  "versionAfter": 8,
  "aiTaskId": "",
  "fallbackUsed": false,
  "errorCode": null
}
```

### 8.2 禁止写入普通日志

- AI API Key；
- 用户完整身份信息；
- 完整 Authorization header；
- 未脱敏的自定义决策；
- 完整后台私密角色推理；
- 数据库密码；
- provider 原始请求头。

完整模型输入输出只进入受控 AiTask 存储，并受权限、加密和保留期约束。

---

## 9. 日志保留

| 数据 | 建议保留 |
|---|---:|
| 请求访问日志 | 30 天 |
| 应用错误日志 | 90 天 |
| StoryRun / StoryEvent | 365 天或产品策略 |
| AiTask 摘要 | 90 天 |
| 原始模型响应 | 30 天，之后删除或仅留摘要 |
| 安全审计日志 | 180 天 |
| 聚合指标 | 长期保留，不含个人内容 |

试玩阶段可缩短，但必须能定位一局失败的完整原因。

---

## 10. 敏感内容与安全

### 10.1 输入处理

- 自定义文本最大 500 字；
- HTML 转义；
- 禁止脚本和富文本执行；
- 限制请求频率；
- 对明显违法、有害或越权内容先由 ActionGuard 处理；
- 用户输入不直接拼接到系统 Prompt 的高权限指令区。

### 10.2 Prompt 注入防护

模型上下文分层：

```text
system rules
story configuration
current authoritative state
role-visible facts
user decision as untrusted text
```

用户文本只能作为“行动意图”，不能改变输出 Schema、角色权限和系统规则。

### 10.3 输出处理

- 必须 JSON Schema 校验；
- 文本展示前 HTML escape；
- 删除系统 prompt 泄露；
- 前台公共投影删除私密字段；
- 不允许模型生成新的数据库字段。

---

## 11. 指标与告警

### 11.1 核心技术指标

```text
API 5xx 比例
决策提交 P50/P95 延迟
谋划提交 P50/P95 延迟
谋划 ActionGuard 拒绝率
谋划 fallback 使用率
AI 超时率
AI JSON 解析失败率
fallback 使用率
version conflict 率
重复提交拦截率
StoryRun 恢复失败率
第 7 天 finalize 失败率
单局平均调用数、token、成本，以及 decision/maneuver 成本占比
```

### 11.2 告警阈值建议

| 指标 | 告警 |
|---|---|
| 5xx > 2% 持续 5 分钟 | 高 |
| finalize 失败 > 1% | 高 |
| AI 超时率 > 15% 持续 10 分钟 | 中 |
| fallback 使用率 > 25% | 中 |
| 谋划 fallback 使用率 > 30% | 中 |
| 单局谋划调用超过 24 次 | 高并检查重复调用 |
| 存储写失败任意出现 | 高 |
| 单局成本超过硬上限 | 高并立即阻断后续 AI 调用 |
| 公共响应检测到私密字段 | 最高，停止发布 |

---

## 12. 数据备份与恢复

### 12.1 数据库方案

- 每日全量备份；
- 每 15 分钟增量或 WAL 归档；
- 备份保留至少 30 天；
- 每月至少一次恢复演练；
- StoryEvent 为 append-only，不做普通业务删除；
- StoryRun 可从事件流重建并校验快照。

### 12.2 文件存储 MVP

若仍使用文件存储：

- 数据目录必须挂载持久卷；
- 原子写：临时文件 + rename；
- 每个 run 使用锁；
- 每日打包备份；
- 不得写入仓库工作区或容器临时层；
- 恢复时校验 schemaVersion 和 event 序列。

### 12.3 恢复目标

建议 MVP：

```text
RPO ≤ 15 分钟
RTO ≤ 2 小时
```

---

## 13. StoryRun 恢复策略

```text
1. 读取 StoryRun 快照
2. 校验 version、状态和事件尾部
3. 若快照损坏，从 StoryEvent 重放
4. 若存在 running AiTask：
   - 有已规范化结果但未落账 → 幂等补写
   - 无有效结果 → 重试或 fallback
   - 若为主动谋划，恢复时必须保证谋划机会只扣减一次
5. 校验 activeDecision 与状态一致
6. 生成公共视图
```

恢复绝不能：

- 静默创建新局；
- 丢弃已提交决策；
- 重复生成结果；
- 改变已完成结局。

---

## 14. 部署检查表

发布前：

```text
[ ] 环境变量已配置且无密钥入库
[ ] 数据目录/数据库持久化已启用
[ ] 迁移与回滚脚本已验证
[ ] API health check 正常
[ ] Web 使用正确 API Base URL
[ ] 所有 P0 测试通过
[ ] AI 双失败 fallback 全流程通过
[ ] 备份任务已运行
[ ] 告警渠道已验证
[ ] 公共响应私密字段扫描通过
[ ] 单局调用和成本硬上限生效
[ ] 谋划调用上限、机会扣减和规则 fallback 已验证
[ ] staging 完成至少 20 局连续测试
```
