# AI 多人局｜MVP 自动化验收矩阵 v1.2

> 文档类型：测试计划 / 自动化验收矩阵 / CI 退出标准  
> 适用范围：《桑田诏》Web 单人 MVP  
> 核心原则：**不能只证明页面能点；必须证明 12 次主线决策、每日 2 次谋划机会、因果回溯、信息隔离、恢复能力和不同结局都成立。**

---

## 0. v1.2 修订说明

本版新增持续叙事流、统一决策输入、局势记录与关键事件弹窗测试。

测试必须证明：

```text
主页面只有一个路由
顶部、左栏、右栏始终不变
故事连续滚动而非分页
A/B/C 前台只显示标题
点击建议后写入统一输入框
输入最大 200 字
推演中只显示“AI 正在推演局势……”
结果故事与本次变化自动追加
局势记录默认隐藏且能恢复滚动位置
关键事件可立即处理或持久化延后
关键事件回应仍占用固定主线决策槽位
```

任何测试或 UI 中不得使用 `AP / 行动力 / 行动点 / 筹谋`。
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
run_day1_after_first_maneuver
run_day1_after_second_maneuver
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
| F-002 | 恢复新局 | 已有 runId | GET run | 返回相同状态与 activePrompt |
| F-003 | 第一次预设决策 | awaiting_decision | 选 A | 写入 1 次 decision；version+1；生成结果消息 |
| F-004 | 第二次决策 | 当日已完成 1 次 | 再选 | 当日完成 2 次；生成 day_end；进入 awaiting_day_advance |
| F-005 | 未完成当天推进 | 只完成 1 次 | advance-day | 409 DAY_NOT_COMPLETE |
| F-006 | 正常推进 | awaiting_day_advance | advance-day | 下一天；decision 计数清零；新 activePrompt |
| F-007 | 12 次决策闭环 | 第 1 天 | 连续完成 6 天 | 共 12 次；无丢失、无重复 |
| F-008 | 第 7 天状态 | 第 6 天完成并推进 | GET run | currentDay=7；awaiting_finalization；activePrompt=null |
| F-009 | 提前 finalize | 第 1—6 天 | finalize | 409 FINALIZATION_NOT_READY |
| F-010 | 正常 finalize | 第 7 天 ready | finalize | finished；完整 finalJudgement |
| F-011 | finished 后再决策 | finished | submit decision | 409 INVALID_RUN_STATE |
| F-012 | 重开一局 | 任意旧局 | create 新 run | 新 runId；旧局不被覆盖 |
| F-013 | 404 恢复 | localStorage 有不存在 runId | GET | 明确失败，不静默新建 |
| F-014 | 页面刷新 | 每种状态 | 重载页面 | 正确恢复对应 UI |
| F-015 | 浏览器仅保存 runId | 任意 | 检查 localStorage | 不包含 worldState / causalLedger |
| F-016 | 初始谋划机会 | 新建第 1 天 run | GET run | `maneuverOpportunitiesPerDay=2`、`remaining=2` |
| F-017 | 提交一次人物交谈谋划 | awaiting_decision | POST maneuver | 201；写入 maneuver/result；remaining=1；version+1 |
| F-018 | 提交第二次谋划 | 当日已用 1 次 | POST maneuver | 201；remaining=0；主线决策计数不变 |
| F-019 | 第三次谋划 | remaining=0 | POST maneuver | 409 MANEUVER_LIMIT_REACHED |
| F-020 | 不使用谋划推进 | 两次主线决策已完成、remaining=2 | advance-day | 成功；未用机会作废 |
| F-021 | 跨日重置 | 正常 advance-day | GET run | 新一天 used=0、remaining=2 |
| F-022 | 第 7 天谋划 | awaiting_finalization | POST maneuver | 409 INVALID_RUN_STATE / MANEUVER_NOT_AVAILABLE |
| F-023 | 谋划不替代主线决策 | 当日仅完成 2 次谋划 | advance-day | 409 DAY_NOT_COMPLETE |
| F-024 | 谋划结果入消息流 | 合法谋划 | GET messages | 出现 `maneuver_result` 玩家可见消息 |
| F-025 | 使用筹码 | leverage 可用 | POST leverage maneuver | 写入 `leverage_used`；筹码状态按规则变化 |

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
| G-009 | 主线决策超过 200 字 | `400 CUSTOM_TEXT_TOO_LONG` 或前端拒绝 |
| G-010 | 合法但高风险交易 | `soft_warn`，允许继续且提示风险 |
| G-011 | 尝试控制县令具体结论 | 规范化为“要求/试图”，不保证结果 |
| G-012 | 重复提交被拒行动 | 不消耗决策、不增加 version |
| G-013 | “派幕僚暗查驿站登记”作为自拟谋划 | `ok`；成功后消耗 1 次谋划机会 |
| G-014 | “命令巡抚立即认罪”作为自拟谋划 | `blocked`；不消耗谋划机会 |
| G-015 | 使用不存在的筹码 | `blocked` 或 409 LEVERAGE_NOT_AVAILABLE |
| G-016 | 尝试通过谋划直接跳过当前主线事件 | `blocked` |
| G-017 | 超过 200 字的自拟谋划 | 400 或在提交前拒绝 |
| G-018 | 被拒谋划重复提交 | 不消耗机会、不增加 version、不产生 FateSeed |

断言：任何 Guard 拒绝都不能写入 decision、maneuver、state_patch、FateSeed，也不能消耗主线决策或谋划机会。

---

## 5. 因果测试矩阵

| ID | 场景 | 断言 |
|---|---|---|
| C-001 | 每次合法决策 | 后台生成可追溯因果记录；前台生成结果故事 |
| C-002 | 存在玩家可见变化 | 自动生成 `change_summary`，只含玩家可见字段 |
| C-003 | 创建 FateSeed | 存在 originEventId、originDay、family、status |
| C-004 | help 触发 | 状态满足条件后 `activated_help`，生成回溯事件 |
| C-005 | backfire 触发 | 状态满足条件后 `activated_backfire`，生成回溯事件 |
| C-006 | 同一个 Seed 两面性 | 至少一个模板同时具备 help 与 backfire 条件 |
| C-007 | origin 回溯 | 每条 causalRecall 引用有效 originEventIds |
| C-008 | 证据流 | EvidenceItem 有 holderRoles / knownByRoles / originEventId |
| C-009 | 责任流 | ResponsibilityNode 有 issue 与至少两个候选责任角色 |
| C-010 | 多方定性 | 同一事件至少存在 3 个角色 frame |
| C-011 | 角色反应 | 后台包含 privateReasoningSummary 与 sourceEventIds，公共投影不得出现 |
| C-012 | 日终摘要 | 包含关键决策、状态变化、活动 Seed 与明日风险 |
| C-013 | 最终结局 | saved/hurt 步骤均引用真实 originEventId |
| C-014 | 无来源反噬 | 无 origin 的 AI 输出必须被 Schema 拒绝 |
| C-015 | AI patch 不可解释 | statePatch 无对应因果来源时必须 fallback/拒绝 |
| C-016 | 谋划创建 FateSeed | 运行态 Seed 引用 maneuver originEventId |
| C-017 | 谋划延迟帮助 | 后续触发时回溯到原谋划事件 |
| C-018 | 谋划延迟反噬 | 后续角色重新定性并引用原谋划事件 |
| C-019 | 谋划更新任务 | `pursuit_updated` 有前后进度和来源事件 |
| C-020 | 谋划使用筹码 | `leverage_used` 引用有效 leverageKey 和 originEventId |
| C-021 | 前台变化投影 | 不包含内部收益、风险、概率、隐藏状态或完整因果链 |
| C-022 | 局势记录 | 可从同一事件流重建我的决策、他人影响、世界变化和数值变化 |
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
第 7 天无 activePrompt
总决策不超过 12
最终必有候选结局
不存在死路
```

---

## 7A. 主动谋划路径测试

| ID | 路径 | 断言 |
|---|---|---|
| M-001 | 全程不使用谋划 | 仍可完成 12 次主线决策并到达结局 |
| M-002 | 每天使用 1 次人物交谈 | 关系轨迹与无谋划路径不同 |
| M-003 | 每天使用 1 次调查 | 线索、证据或 FateSeed 轨迹不同 |
| M-004 | 每天使用 1 次筹码 | 筹码状态、责任或叙事定性不同 |
| M-005 | 每天使用满 2 次 | 单局最多 12 次，无法超限 |
| M-006 | 谋划后提交当前主线决策 | 使用最新 version 后成功 |
| M-007 | 谋划与主线决策并发 | 只有一个写请求成功，另一个 VERSION_CONFLICT/RUN_BUSY |
| M-008 | 未使用谋划进入下一天 | 不阻塞推进，不结转 |
| M-009 | 谋划改变后续选项 | 允许影响后续 prompt，不允许解决当前 prompt |
| M-010 | 谋划结果差异 | 至少一类结局或关键因果因谋划路径发生变化 |

每条路径均断言：

```text
maneuversUsedToday ∈ [0, 2]
remaining = 2 - used
主线决策总数始终为 12
第 7 天 remaining = 0
```

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
| A-011 | 正确 version 提交谋划 | 成功，version+1，remaining-1 |
| A-012 | 旧 version 提交谋划 | 409 VERSION_CONFLICT，不扣机会 |
| A-013 | 同幂等键重复谋划 | 返回同一结果，不重复扣减 |
| A-014 | 同幂等键不同谋划内容 | 409 IDEMPOTENCY_KEY_REUSED |
| A-015 | 同时提交决策与谋划 | 只允许一个状态写入成功 |
| A-016 | 谋划上限后提交 | 409 MANEUVER_LIMIT_REACHED |
| A-017 | 已消耗筹码再次使用 | 409 LEVERAGE_NOT_AVAILABLE |
| A-018 | 延后关键事件 | 追加 `critical_event_deferred`，version+1，主线决策计数不变 |
| A-019 | 同幂等键重复延后 | 只追加一次 defer 事件 |
| A-020 | 已解决关键事件再次延后 | 409 CRITICAL_EVENT_ALREADY_RESOLVED |
| A-021 | critical_response 提交 | 成功后当日主线决策计数 +1 |
| A-022 | 同时存在两个 activePrompt | 状态校验失败，测试必须阻止发布 |
## 9. AI 失败与恢复测试

| ID | 注入故障 | 预期 |
|---|---|---|
| R-001 | AI 超时一次 | 自动重试 |
| R-002 | AI 超时两次 | 使用规则 fallback，正常落账 |
| R-003 | AI 返回非 JSON | 重试后 fallback |
| R-004 | AI JSON 缺 resultStory 或 visibleChanges 结构 | Schema 拒绝并 fallback |
| R-005 | AI 生成越界 patch | 规则裁剪或拒绝，不越界落账 |
| R-006 | AI 引用不存在 origin | 拒绝并 fallback |
| R-007 | 存储写入失败 | error_recoverable；重试不重复事件 |
| R-008 | 服务重启 | 已完成状态可恢复 |
| R-009 | 在 resolving 中重启 | 通过幂等账本恢复或 fallback |
| R-010 | fallback 也失败 | 明确 502/503，不伪造成功 |
| R-011 | 谋划 AI 超时两次 | 使用谋划规则 fallback，正常落账并扣 1 次 |
| R-012 | 谋划 fallback 持久化失败 | error_recoverable；恢复后只落账一次 |
| R-013 | 谋划输出引用不存在筹码 | Schema/业务校验拒绝并 fallback |

---

## 10. Web/UI 测试

| ID | 场景 | 断言 |
|---|---|---|
| W-001 | 正式游戏路由 | 只使用 `/game?runId=<runId>`，8 个状态不创建新路由 |
| W-002 | 固定页面骨架 | 顶部、左栏、右栏在所有状态中 DOM 结构与尺寸一致 |
| W-003 | 角色专属开场 | 中间只显示连续故事，无分页、无“继续阅读” |
| W-004 | 主线决策 | A/B/C 只显示编号与标题，不显示收益、风险、概率和数值预测 |
| W-005 | 统一输入框 | 输入框始终可见；不要求先点 CUSTOM |
| W-006 | 建议回填 | 点击 B 后，B 的标题自动写入输入框 |
| W-007 | 建议可编辑 | 回填文本可继续补充或完全改写 |
| W-008 | 长度限制 | 主线决策、回应、主动谋划均最大 200 字 |
| W-009 | 提交锁定 | 提交后输入框、建议和按钮禁用，防止重复 |
| W-010 | 推演状态 | 只显示玩家决定和“AI 正在推演局势……” |
| W-011 | 禁止技术信息 | 不出现模型、Token、权重、概率、步骤或进度百分比 |
| W-012 | 推演完成 | 新故事自动追加，无“查看结果/下一步” |
| W-013 | 本次变化 | 紧接结果故事自动展示，只含玩家可见变化 |
| W-014 | 无流程按钮 | 正常流程中不存在继续阅读、查看变化、返回局势、完成、下一步 |
| W-015 | 连续滚动 | 新内容按时间顺序追加；用户在底部时自动平滑滚动 |
| W-016 | 阅读旧内容 | 用户向上阅读时不强制跳底，只显示轻量新内容提示 |
| W-017 | 局势记录默认状态 | 默认关闭，不占据主页面 |
| W-018 | 局势记录展开 | 只覆盖中间区域，支持我的决策/他人影响/世界变化/数值变化 |
| W-019 | 滚动恢复 | 关闭局势记录后恢复原 narrativeScrollTop |
| W-020 | 关键事件弹窗 | 页面压暗，显示重要事件、立即处理、稍后处理 |
| W-021 | 关键事件频率 | 普通世界变化不弹窗 |
| W-022 | 稍后处理 | 关闭后显示待处理标记，刷新后仍存在 |
| W-023 | 立即处理 | 中间展示角色视角故事与回应决策 |
| W-024 | 视角隔离 | 不显示幕后角色真实选项、隐藏目标或隐藏数值 |
| W-025 | 关键回应计数 | 提交回应后当日主线决策计数 +1，不突破 12 次总数 |
| W-026 | 右侧谋划入口 | 点击人物/调查/筹码后，中间显示主动谋划模块 |
| W-027 | 主动谋划选项 | 建议只显示标题，自定义输入与提交位于中间 |
| W-028 | 谋划提交中 | 按钮禁用，结果故事与变化追加到中间时间线 |
| W-029 | 进入下一天 | 两次主线决策完成即可解锁，未用谋划不阻塞 |
| W-030 | 安全渲染 | 用户输入 HTML 转义，不执行脚本 |
| W-031 | 响应式 | 1366×768 与 1440×900 不遮挡核心输入和提交按钮 |
| W-032 | 禁词扫描 | 页面不存在 AP、行动力、行动点、筹谋 |
| W-033 | 公共字段扫描 | HTML/JSON 不包含 internalGain、internalRisk、statePatch 预测等字段 |
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
pnpm test:maneuver
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
服务重启后 StoryRun、叙事时间线、activePrompt 和关键事件可恢复
全 A/B/C 路径状态与结局有差异
无谋划、半量谋划、满量谋划路径均可完成
谋划次数、跨日重置、幂等和 ActionGuard 测试全部通过
连续叙事流、无分页、统一输入框、自动追加变化测试全部通过
关键事件立即处理、稍后处理和刷新恢复测试全部通过
局势记录默认隐藏与滚动恢复测试通过
公共选项只含标题，不泄露收益、风险或状态预测
至少 5 类全局结局可达
至少 5 个个人档位可达
AI 双失败时 fallback 仍能完成一局
前台不包含后台私密字段
```

体验是否成立仍需用户试玩，自动化测试只能证明系统符合设计。
