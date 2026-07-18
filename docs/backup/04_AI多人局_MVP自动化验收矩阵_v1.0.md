# AI 多人局｜MVP 自动化验收矩阵 v1.0

> 文档类型：测试计划 / 自动化验收矩阵 / CI 退出标准  
> 适用范围：《桑田诏》Web 单人 MVP  
> 核心原则：**不能只证明页面能点；必须证明 12 次决策、因果回溯、信息隔离、恢复能力和不同结局都成立。**

---

## 1. 测试层级

| 层级 | 目标 | 推荐工具 |
|---|---|---|
| Unit | 规则、状态补丁、ActionGuard、FateSeed、结局规则 | Node test / Vitest |
| Service | StoryRun 引擎、存储、幂等、version | Node test / Nest testing |
| HTTP | API 状态码、契约、恢复 | 启动 NestJS + fetch |
| Web DOM | 页面渲染、按钮状态、信息隔离 | jsdom |
| E2E | 大厅→选角→12 决策→结局 | Playwright（后续） |
| Config lint | JSON Schema 和跨文件可达性 | AJV + 自定义 lint |
| Resilience | AI 超时、非法 JSON、存储重启、重复提交 | mock provider + 临时目录 |

---

## 2. 测试数据夹具

必须准备以下固定夹具：

```text
run_initial
run_day1_after_first_decision
run_day1_complete
run_day3_secret_memorial
run_day5_backfire
run_day7_ready
run_finished_a
run_finished_b
```

固定路径：

```text
PATH_A = 每次选择 A
PATH_B = 每次选择 B
PATH_C = 每次选择 C
PATH_MIXED = C,B,C,B,B,C,A,B,C,A,B,B
```

---

## 3. 功能测试矩阵

| ID | 场景 | 前置 | 操作 | 预期 |
|---|---|---|---|---|
| F-001 | 创建新局 | 无 | POST create | 201；第 1 天；`awaiting_decision`；version=1 |
| F-002 | 恢复新局 | 已有 runId | GET run | 返回相同状态与 activeDecision |
| F-003 | 第一次预设决策 | awaiting_decision | 选 A | 写入 1 次 decision；version+1；生成结果消息 |
| F-004 | 第二次决策 | 当日已完成 1 次 | 再选 | 当日完成 2 次；生成 day_end；进入 awaiting_day_advance |
| F-005 | 未完成当天推进 | 只完成 1 次 | advance-day | 409 DAY_NOT_COMPLETE |
| F-006 | 正常推进 | awaiting_day_advance | advance-day | 下一天；decision 计数清零；新 activeDecision |
| F-007 | 12 次决策闭环 | 第 1 天 | 连续完成 6 天 | 共 12 次；无丢失、无重复 |
| F-008 | 第 7 天状态 | 第 6 天完成并推进 | GET run | currentDay=7；awaiting_finalization；activeDecision=null |
| F-009 | 提前 finalize | 第 1—6 天 | finalize | 409 FINALIZATION_NOT_READY |
| F-010 | 正常 finalize | 第 7 天 ready | finalize | finished；完整 finalJudgement |
| F-011 | finished 后再决策 | finished | submit decision | 409 INVALID_RUN_STATE |
| F-012 | 重开一局 | 任意旧局 | create 新 run | 新 runId；旧局不被覆盖 |
| F-013 | 404 恢复 | localStorage 有不存在 runId | GET | 明确失败，不静默新建 |
| F-014 | 页面刷新 | 每种状态 | 重载页面 | 正确恢复对应 UI |
| F-015 | 浏览器仅保存 runId | 任意 | 检查 localStorage | 不包含 worldState / causalLedger |

---

## 4. ActionGuard 测试矩阵

| ID | 输入 | 预期 |
|---|---|---|
| G-001 | “不拦急奏，另写密奏” | `ok` |
| G-002 | “派幕僚查驿站登记” | `ok` 或 `soft_warn` |
| G-003 | “命令皇帝立即处死巡抚” | `blocked`：越权且操控他人 |
| G-004 | “我宣布巡抚已经认罪” | `blocked`：直接宣布结果 |
| G-005 | “凭空拿出完整暗账” | `rewrite_needed`：不存在的证据 |
| G-006 | “跳到第 7 天直接裁决” | `blocked`：跳过阶段 |
| G-007 | “调一百万兵围困京师” | `blocked`：资源与时代权限不符 |
| G-008 | 空 customText | `400 CUSTOM_TEXT_REQUIRED` |
| G-009 | 超过 500 字 | `400` 或截断前拒绝 |
| G-010 | 合法但高风险交易 | `soft_warn`，允许继续且提示风险 |
| G-011 | 尝试控制县令具体结论 | 规范化为“要求/试图”，不保证结果 |
| G-012 | 重复提交被拒行动 | 不消耗决策、不增加 version |

断言：任何 Guard 拒绝都不能写入 decision、state_patch、FateSeed。

---

## 5. 因果测试矩阵

| ID | 场景 | 断言 |
|---|---|---|
| C-001 | 每次合法决策 | 生成 visibleCausalCard |
| C-002 | 可见因果结构 | 包含决定、个人、他人、世界、状态、痕迹、风险 |
| C-003 | 创建 FateSeed | 存在 originEventId、originDay、family、status |
| C-004 | help 触发 | 状态满足条件后 `activated_help`，生成回溯消息 |
| C-005 | backfire 触发 | 状态满足条件后 `activated_backfire`，生成回溯消息 |
| C-006 | 同一个 Seed 两面性 | 至少一个模板同时具备 help 与 backfire 条件 |
| C-007 | origin 回溯 | 每条 causalRecallMessage 引用有效 originEventIds |
| C-008 | 证据流 | EvidenceItem 有 holderRoles / knownByRoles / originEventId |
| C-009 | 责任流 | ResponsibilityNode 有 issue 与至少两个候选责任角色 |
| C-010 | 多方定性 | 同一事件至少存在 3 个角色 frame |
| C-011 | 角色反应 | 后台包含 privateReasoningSummary 与 sourceEventIds |
| C-012 | 日终摘要 | 包含关键决策、状态变化、活动 Seed、明日风险 |
| C-013 | 最终结局 | saved/hurt 步骤均引用真实 originEventId |
| C-014 | 无来源反噬 | 构造无 origin 的 AI 输出，Schema 校验必须拒绝 |
| C-015 | AI patch 不可解释 | statePatch 无对应因果解释，必须 fallback/拒绝 |

---

## 6. 信息隔离测试矩阵

| ID | 场景 | 前台不得出现 |
|---|---|---|
| I-001 | GET run | `hiddenMeaning` |
| I-002 | GET run | `privateReasoningSummary` |
| I-003 | GET run | `hiddenIntent` |
| I-004 | GET run | 完整 help/backfire trigger 条件 |
| I-005 | 消息列表 | `visibility=hidden` 事件 |
| I-006 | 角色行动 | 未公开的其他角色证据内容 |
| I-007 | 角色反应 | 角色引用其不可知事件时测试失败 |
| I-008 | debug query 参数 | URL 参数不得开启私密调试输出 |
| I-009 | HTML 源码 | 不嵌入服务器私密账本 |
| I-010 | 错误响应 | 不返回完整模型 prompt、密钥、后台状态 |

实现方式：对公共响应执行字段黑名单扫描，并进行角色知识集合校验。

---

## 7. 分支差异与结局可达测试

### 7.1 主路径差异

| ID | 路径 | 断言 |
|---|---|---|
| B-001 | 全 A | 生成状态签名 A 和结局 A |
| B-002 | 全 B | 生成状态签名 B 和结局 B |
| B-003 | 全 C | 生成状态签名 C 和结局 C |
| B-004 | A/B/C 对比 | 至少两个全局结局标题不同 |
| B-005 | A/B/C 对比 | 最终 worldState 或 roleState 不完全相同 |
| B-006 | A/B/C 对比 | 关键救命/伤害步骤不同 |

### 7.2 结局可达性

构建时运行路径搜索或有指导随机模拟：

```text
至少 5 类全局结局各有一条可达路径
至少 5 个个人结局档位各有一条可达路径
```

若某结局连续 10,000 次模拟无法触发，标记为不可达并阻止发布，除非明确声明为非 MVP 结局。

### 7.3 状态不变量

每条路径均断言：

```text
所有数值 0—100
第 1—6 天各 2 次决策
第 7 天无 activeDecision
总决策不超过 12
最终必有候选结局
不存在死路
```

---

## 8. API、并发和幂等测试

| ID | 场景 | 预期 |
|---|---|---|
| A-001 | 正确 version 写入 | 成功，version+1 |
| A-002 | 旧 version 写入 | 409 VERSION_CONFLICT，不改变状态 |
| A-003 | 同幂等键重复同请求 | 返回同一结果，不重复事件 |
| A-004 | 同幂等键不同请求体 | 409 IDEMPOTENCY_KEY_REUSED |
| A-005 | 同一 prompt 并发两次提交 | 只有一个成功 |
| A-006 | resolving 时再次提交 | RUN_BUSY 或返回已有任务 |
| A-007 | phase conflict | 不误报为 VERSION_CONFLICT |
| A-008 | 已完成 prompt 再选其他项 | DECISION_ALREADY_RESOLVED |
| A-009 | finalize 重复请求 | 幂等返回同一结局 |
| A-010 | advance-day 重复请求 | 只推进一次 |

---

## 9. AI 失败与恢复测试

| ID | 注入故障 | 预期 |
|---|---|---|
| R-001 | AI 超时一次 | 自动重试 |
| R-002 | AI 超时两次 | 使用规则 fallback，正常落账 |
| R-003 | AI 返回非 JSON | 重试后 fallback |
| R-004 | AI JSON 缺 visibleCausalCard | Schema 拒绝并 fallback |
| R-005 | AI 生成越界 patch | 规则裁剪或拒绝，不越界落账 |
| R-006 | AI 引用不存在 origin | 拒绝并 fallback |
| R-007 | 存储写入失败 | error_recoverable；重试不重复事件 |
| R-008 | 服务重启 | 已完成状态可恢复 |
| R-009 | 在 resolving 中重启 | 通过幂等账本恢复或 fallback |
| R-010 | fallback 也失败 | 明确 502/503，不伪造成功 |

---

## 10. Web/UI 测试

| ID | 场景 | 断言 |
|---|---|---|
| W-001 | 大厅首屏 | 《桑田诏》可进入，未来剧本不可误导为已上线 |
| W-002 | 角色页 | 浙江总督可选，其他角色显示 MVP 限制 |
| W-003 | 游戏布局 | 左身份、中消息与决策、右状态存在 |
| W-004 | 决策区 | A/B/C + 自定义可见 |
| W-005 | 自定义切换 | 文本框仅 CUSTOM 时可用 |
| W-006 | 提交中 | 按钮禁用，防重复 |
| W-007 | 日终 | 两策后显示日终回响和进入下一天 |
| W-008 | 第 7 天 | 无普通选项，显示最终裁决入口 |
| W-009 | finished | 显示全局、个人、救命、伤害、命运债 |
| W-010 | 错误状态 | 网络、404、冲突有明确提示 |
| W-011 | 安全渲染 | 用户自定义文本进行 HTML 转义 |
| W-012 | 响应式 | 1366×768 与 1440×900 不出现核心按钮遮挡 |

---

## 11. CI 必跑命令

建议根目录统一：

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm --filter @apps/api typecheck
pnpm --filter @apps/web typecheck
pnpm test:causal
pnpm test:config
pnpm test:story:e2e
```

发布前增加：

```bash
pnpm test:paths
pnpm test:security-projection
```

---

## 12. 发布退出标准

所有条件同时满足：

```text
P0 自动化测试 100% 通过
无未处理的高严重度信息泄露
全流程 20 次连续运行无死路
服务重启后 StoryRun 可恢复
全 A/B/C 路径状态与结局有差异
至少 5 类全局结局可达
至少 5 个个人档位可达
AI 双失败时 fallback 仍能完成一局
前台不包含后台私密字段
```

体验是否成立仍需要用户试玩，自动化测试只能证明系统符合设计，不能证明用户喜欢。
