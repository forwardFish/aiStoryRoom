# AI Story Room v1.2 开发步骤与验收步骤

> 文档状态：PLANNED
>
> 适用版本：当前 `docs` 根目录中的 v1.2 / v4.3 / v2.3 / v1.3 文档
>
> 目标：完成可本地运行、可真实游玩、可恢复、可验证的《桑田诏：嘉靖财政危局》Web MVP；`/`、`/role-select` 和 `/game` 必须按 10 张 Web UI 参考图真实 DOM/CSS 一比一复刻，并保留既有 `/trio` 三玩家七轮能力的独立回归门禁。

## 1. 最高优先级和范围

### 1.1 当前 MVP 必须完成

- Web 单人模式。
- 玩家角色固定为浙江总督。
- AI 角色：浙江巡抚、清流县令、江南商会、司礼监、内阁财政派、皇帝。
- 7 天故事局；第 1—6 天每天 2 次主线决策，共 12 次；第 7 天最终裁决。
- 第 1—6 天每天 2 次可选主动谋划；不结转、不替代主线决策。
- 主线决策、关键事件回应、主动谋划均支持 1—200 字最终文本。
- 持续叙事时间线，不分页、不跳独立结果页、不使用默认消息后台。
- 统一的 `StoryRun + StoryEvent` 运行态模型。
- `activePrompt`、`promptKind`、`NarrativeEntry[]`、`criticalEvent`、`changeSummary` 公共投影。
- `version` 乐观锁和 `idempotencyKey` 幂等。
- 规则引擎掌握状态权威；AI 不得直接修改数据库或状态。
- AI 超时、非法 JSON、Schema 失败、双失败 fallback。
- 页面刷新和服务重启后恢复 StoryRun、叙事时间线、活动 prompt、推演状态和延后关键事件。
- A/B/C 三条主路径可产生不同状态轨迹和结局。
- 至少 5 类全局结局、至少 5 个个人结局档位可达。
- 使用真实 UI 背景、人物图片和 icon 资源完成页面复刻。
- 10 张 UI 参考图全部逐图复刻：首页 1 张、角色选择 1 张、主游戏 UI 01—08 共 8 张。
- 每张图都必须经过多轮 `reference → actual → diff/metrics → repair → recapture`；不得以一次截图或主观目测代替。
- 禁止把参考图作为整页覆盖层、页面背景、Canvas 底图或透明热区底图来制造“像素一致”；验收截图必须来自真实可交互 DOM/CSS。
- 既有 `/trio` 三玩家入口、3 玩家 × 7 轮 × 21 次行动、跨玩家影响与通知不得回归，但它不能代替正式 `/game` 单人主流程。

### 1.2 明确不进入本轮 MVP

- 把 `/trio` 当作 10 张 UI 的视觉真源，或让 `/trio` 替代 `/game` 的正式验收。
- 小程序、支付、UGC、社区、公开故事池、多剧本市场、复杂地图、装备战斗。
- 把 AI 角色实现成拥有独立玩家操作权的真人玩家。

## 2. 开发输入源

### 2.1 需求与工程规范

| 来源 | 作用 |
|---|---|
| `docs/00_持续叙事流_UI系统_修订说明_v1.2.md` | 持续叙事流和 8 个 UI 状态的最高交互约束 |
| `docs/01_AI多人局_MVP唯一工程基线_v1.2.md` | 冲突裁决、MVP 范围、DoD |
| `docs/02_AI多人局_StoryRun状态机与API契约_v1.2.md` | 状态、API、并发、幂等、恢复 |
| `docs/03_桑田诏_剧本配置Schema_v1.2.md` | JSON 配置和跨文件静态校验 |
| `docs/04_AI多人局_MVP自动化验收矩阵_v1.2.md` | 自动化测试和发布退出标准 |
| `docs/05_AI多人局_部署日志与AI成本规范_v1.2.md` | AI 预算、fallback、日志、备份恢复 |
| `docs/06_AI多人局_MVP用户试玩与数据验证方案_v1.2.md` | 模拟玩家测试和产品指标 |
| `docs/07_AI多人局_Web_MVP_产品需求文档_v4.3_持续叙事流修订版.md` | 产品行为和实施路线 |
| `docs/08_AI多人局_数据库与存储架构设计文档_v2.3_持续叙事流修订版.md` | StoryRun、StoryEvent、AiTask 和事务 |
| `docs/09_AI多人局_游戏玩法说明文档_v2.3_持续叙事流修订版.md` | 玩家可理解的完整玩法 |
| `docs/10_桑田诏_完整故事局剧本_v1.3_持续叙事流修订版.md` | 7 天剧情、决策、角色、结局和 FateSeed |
| `docs/11_AI多人剧情推演_MVP主游戏页_UI交互设计_v1.1.md` | 页面状态、控件、滚动、弹窗和视觉要求 |

### 2.2 UI 真源和资源真源

| 类型 | 路径 | 规划用途 |
|---|---|---|
| Web 首页 | `docs/UI/web/首页.png`，910×1729 | `/` 首页完整长页 |
| 角色选择 | `docs/UI/web/选择角色.png`，1448×1086 | `/role-select?story=sangtian` |
| UI 01 | `docs/UI/web/UI01_角色专属开场.png`，1672×941 | `/game?runId=<runId>` 开场故事 |
| UI 02 | `docs/UI/web/UI02_主线故事与决策.png`，1672×941 | 主线故事与决策 |
| UI 03 | `docs/UI/web/UI03_AI正在推演.png`，1672×941 | 已提交决定与推演中 |
| UI 04 | `docs/UI/web/UI04_推演结果故事与变化.png`，1672×941 | 结果故事与本次变化 |
| UI 05 | `docs/UI/web/UI05_局势记录展开.png`，1672×941 | 中间区域局势记录 |
| UI 06 | `docs/UI/web/UI06_关键事件弹窗.png`，1672×941 | 页面压暗与关键事件弹窗 |
| UI 07 | `docs/UI/web/UI07_他人影响故事与回应.png`，1672×941 | 他人影响与回应决策 |
| UI 08 | `docs/UI/web/UI08_主动谋划.png`，1672×941 | 主动谋划编辑状态 |
| 嘉靖财政局专属图片/icon | `docs/UI/web/game/嘉靖财政局/` | 《桑田诏》主游戏、角色、场景、状态和功能图标的优先资产真源 |
| 背景/人物图片 | `docs/UI/web/pic/` | 故事背景、角色头像、场景图片 |
| Web icon | `docs/UI/web/icon/` | Many Worlds 标志、功能 icon、状态 icon |
| Icon 说明 | `docs/UI/web/icon/many-worlds-icons-clean/manifest.json` | 46 个 icon 的名称和输出尺寸 |

`docs/UI/web/game/嘉靖财政局/` 当前静态盘点为 18 张 PNG，总计 21,174,228 字节：1 张 1448×1086、17 张 1254×1254。它们是嘉靖财政局专属资产，优先级高于通用 `pic` / `icon`；当前文件名仍是时间戳，开发前必须建立语义 manifest，禁止按时间顺序或肉眼猜测后直接引用。

`docs/UI/web/pic/` 当前静态盘点为 27 个文件，`docs/UI/web/icon/` 为 141 个文件，作为跨页面或通用风格资产。专属目录没有合适资产时才允许使用通用资产，并在 manifest 中记录 fallback 原因。

### 2.3 2026-07-12 当前实现静态差距审查

本节只表示源码与旧证据的只读盘点，不代表重新运行后的验收结论。

| ID | 当前事实 | 判定 | 后续动作 |
|---|---|---|---|
| GAP-001 | `apps/web/src/server.mjs`、`run-web-cabin-smoke.ps1`、`run-web-cabin-visual-diff.ps1` 和旧结果仍指向已不存在的 `docs/UI/web/主游戏.png` | 未完成 | 全部改为 UI01—UI08 映射，不允许静默 fallback 到旧图 |
| GAP-002 | 首页在 910px 视口插入 `home-reference-skin`，直接显示 `首页.png`，再以透明 hitbox 接管点击 | 严重未完成 | 删除参考图覆盖与透明热区；用真实 DOM/CSS/图片资产实现并重新做像素对比 |
| GAP-003 | 旧首页视觉结果声称 `changedPixels=0`，但证据由参考图覆盖产生 | 旧证据无效 | 新视觉门禁增加 anti-cheat 检查，旧结果不得计入最终 PASS |
| GAP-004 | 旧主游戏参考尺寸为 1448×1086，当前 8 张主游戏真源均为 1672×941 | 未完成 | 捕获脚本、fixture、diff 和阈值全部更新到 1672×941 |
| GAP-005 | 旧主游戏 diff 比例为 0.128077，状态仅 `PASS_NEEDS_MANUAL_UI_REVIEW` | 明确未完成 | 分 UI01—UI08 单独比较并持续视觉修复，不允许继承旧 limitation 作为完成 |
| GAP-006 | `role-select` 有页面和 atlas 资源，但没有针对 `选择角色.png` 的独立 reference/actual/diff/metrics 闭环 | 部分实现 | 建立角色选择专属截图与点击验收 |
| GAP-007 | `/game` 已有决策、谋划、关键事件、恢复、结局等代码，但局势记录仍偏“十二步决策回顾”弹层，与 UI05 的中间区域覆盖、5 类筛选及滚动恢复不完全一致 | 部分实现 | 按 UI05 重构并补浏览器测试 |
| GAP-008 | `app.js` 同时保留旧消息流/因果卡样式与新持续叙事目标，存在信息架构和文案漂移风险 | 部分实现 | 以文档 00/07/11 和 UI01—UI08 为准收敛，删除不属于真源的旧卡片式表现 |
| GAP-009 | 配置目录只有 `days/decisions/maneuvers/leverage/endings`；缺 `story.json`、`roles.json`、`context-cards.json`，且 linter 只校验精简字段 | 部分实现 | 补齐 Schema v1.2 全配置、跨文件引用和可达性校验 |
| GAP-010 | Prisma 同时承载当前 `StoryRun + StoryEvent + AiTask` 与较大的历史多人模型，接口也同时存在 v4 与旧域 | 有能力但需收敛 | 明确正式 v4 合同，保留兼容接口但禁止前端混用 |
| GAP-011 | `/trio`、三玩家脚本和历史证据存在 | 已有基础，需回归 | 作为独立扩展轨道测试 3×7×21、跨玩家通知、隐私和 DeepSeek/mock 边界 |
| GAP-012 | 旧验收目录混有多轮 PASS/HARD_FAIL/limitation，时间与真源不一致 | 证据污染风险 | 新一轮使用 RunId、时间戳和独立目录；最终门禁只读当前 RunId 证据 |

## 3. 开发步骤

### 3.0 执行顺序、模板与依赖门槛

| 顺序 | 阶段 | Task Template ID | 主验收面 | 前置门槛 | 阶段输出 |
|---:|---|---|---|---|---|
| 00 | D00 接管与冻结 | `TPL-INTAKE` | 真源、入口、现状、blocker | 无 | source inventory、当前 RunId、差距表 |
| 01 | D01 UI 映射 | `TPL-UI-MAP` | 10 张图到 route/state/fixture/token | D00 | UI map、asset map、anti-cheat 规则 |
| 02 | D02 配置 Schema | `TPL-BUSINESS-ENGINE` | 配置完整性与跨文件规则 | D00 | 8 类配置、lint、可达性结果 |
| 03 | D03 数据模型 | `TPL-DATA-MODEL-MIGRATION` | schema/migration/seed/readback | D02 | migration、seed、DB readback |
| 04 | D04 规则引擎 | `TPL-BUSINESS-ENGINE` | 7 天/12 决策/谋划/结局确定性规则 | D02—D03 | deterministic fixtures、规则测试 |
| 05 | D05 API | `TPL-API-DOMAIN` | v4 method/path/schema/error/DB 合同 | D03—D04 | API、负例、DB 读回、合同矩阵 |
| 06 | D06 AI Provider | `TPL-AI-PROVIDER` | schema、retry、fallback、AiTask、密钥边界 | D04—D05 | mock/failure/live-limitation 证据 |
| 07 | D07 前端壳 | `TPL-FRONTEND-SHELL` | route/layout/token/client/error 基础 | D01、D05 | 可启动路由、共享 token、API client |
| 08 | D08 首页 | `TPL-FRONTEND-PAGE` | `/` 真实 DOM 一比一 | D01、D07 | 页面测试、VT-001 实际图 |
| 09 | D08 角色选择 | `TPL-FRONTEND-PAGE` | `/role-select` 一比一与真实建局 | D01、D05、D07 | 页面测试、VT-002 实际图 |
| 10 | D08 主游戏 UI01—UI08 | `TPL-FRONTEND-PAGE` | `/game` 单路由 8 状态 | D04—D07 | 状态组件、点击测试、VT-003—010 实际图 |
| 11 | D09 点击/API 链路 | `TPL-PAGE-CLICK-API` | 每个 P0 控件到 API/DB/UI | D08 | control matrix、network、DB readback |
| 12 | D10 运维与可观测性 | `TPL-OBSERVABILITY` | 日志、指标、恢复、脱敏 | D03、D05、D06 | 运维测试、恢复与脱敏证据 |
| 13 | D11 视觉比较 | `TPL-VISUAL-COMPARE` | 10 图 reference/actual/diff/metrics | D08—D10 | 每图每轮五件套证据 |
| 14 | D11 视觉修复 | `TPL-VISUAL-REPAIR` | deviation 定点修复与重截 | 任一 VT 失败 | before/after metrics、剩余偏差 |
| 15 | D12 三玩家回归 | `TPL-TEST-E2E` | 3×7×21、通知、隐私、DB/AI | D05—D06 | trio E2E 报告 |
| 16 | D13 最终门禁 | `TPL-FINAL-GATE` | 当前 RunId 全证据 fail-closed 聚合 | 所有 P0 阶段 | 最终报告与机器 verdict |

每个阶段必须在进入下一阶段前写清：覆盖的需求/UI/API/DB/Test ID、允许改动范围、执行命令、结果证据、剩余 blocker 和最小修复路由。失败不能只留在聊天中。

### D00：接管、冻结基线和工作区边界

1. 读取当前 docs、UI、pic、icon、现有代码、测试和 `git status`。
2. 以当前 v1.2 文档为需求真源；旧版 `/trio` 证据只能标记为历史/非当前主验收目标。
3. 建立需求、UI、资源、API、数据库、测试追踪矩阵。
4. 记录当前代码缺口，不清理用户已有修改，不覆盖现有证据。
5. 建立后续 task 的 allowed files、result JSON、HANDOFF 和失败修复规则。

退出条件：所有 P0/P1 需求、UI 状态、资源目录和现有入口均有稳定 ID。

### D01：UI 资源归档和视觉基线

1. 为 10 张参考图建立稳定 UI ID、原始尺寸、目标路由、目标状态、可见控件、数据 fixture 和证据路径。
2. 对 `docs/UI/web/game/嘉靖财政局/` 的 18 张 PNG 建立专属资产清单：`assetKey`、原文件名、SHA-256、尺寸、透明通道、语义类型、角色/场景/功能、使用页面、裁切方式、替代文本和版权来源。
3. 为通用背景图、人物图和 46 个 icon 建立同样映射；嘉靖财政局页面必须先查专属 manifest，需要高分屏通用 icon 时再使用 `png-256`。
4. 分别提取首页、角色选择、主游戏的布局 token：画布、列宽、顶部栏、状态栏、间距、圆角、阴影、字体、颜色、渐变、边框、插画和纹样。
5. 固定截图 viewport：首页 `910×1729`；角色选择 `1448×1086`；UI01—UI08 均为 `1672×941`，DPR 固定为 1。
6. 为 UI 01—08 建立可重复进入的 fixture/state injector，禁止靠手工玩到随机状态后截图。
7. 增加 anti-cheat 校验：运行页面不得加载 `/reference/*.png`、不得包含 `reference-skin`/透明全页 hitbox、不得把参考图作为 CSS 背景。

退出条件：每个 P0 UI 状态都能对应到 route、fixture、资源、控件和截图/差异证据路径。

### D02：剧本配置和 Schema

1. 建立 `story.json`、`roles.json`、`days.json`、`decisions.json`、`maneuvers.json`、`leverage.json`、`endings.json`、`context-cards.json`。
2. 把所有玩家可见选项改为 `optionKey + title`。
3. 把收益、风险、内部说明、state patch、FateSeed 触发条件放入后台字段。
4. 配置 `promptKind`、`countAsMainDecision`、`presentation.entryMode`、`resultStory` 和 `visibleChanges`。
5. 实现跨文件 lint：角色引用、变量引用、12 个决策槽位、7 天、结局可达、FateSeed、主动谋划、筹码来源和 200 字限制。

退出条件：运行时不再以 TypeScript 硬编码剧情为唯一来源，配置 lint 能阻止非法配置进入运行态。

### D03：运行态数据模型和持久化

1. 保留 `StoryRun` 当前快照和 `StoryEvent` append-only 事件流。
2. `StoryRun.stateJson` 增加 `activePrompt`、`pendingCriticalEvents`、`maneuverState`、`narrativeFrames`、`fateSeeds`、`evidenceLedger`、`responsibilityLedger`。
3. 接入 `AiTask` 调用账本，记录 provider、taskType、attempt、输入摘要、规范化结果、fallback、token 和错误。
4. 所有决策、谋划、延后、结果、变化、日终、结局写入事务。
5. 写入必须带 `version`，成功权威写入只增加 1；重复 `idempotencyKey` 不重复落账。
6. 实现快照损坏时从事件流恢复的最小能力，并验证事件尾部和 activePrompt 一致性。

退出条件：数据库读回能恢复同一局的权威状态、事件流、版本、活动 prompt 和待处理关键事件。

### D04：规则引擎和状态机

1. 实现 `created`、`awaiting_decision`、`resolving`、`awaiting_day_advance`、`awaiting_finalization`、`finished`、`abandoned`、`error_recoverable`。
2. 实现每日 2 次主线决策和每日 2 次主动谋划机会的独立计数。
3. 实现关键事件回应占用主线槽位；延后不完成 prompt、不增加主线计数。
4. 实现 ActionGuard：身份、时代、资源、阶段、自主权、长度、输入格式。
5. 实现状态值 0—100 clamp、statePatch 上限、FateSeed help/backfire、责任与证据回溯。
6. 实现全 A、全 B、全 C、无谋划/半量谋划/满量谋划路径的不同状态签名和可达结局。

退出条件：规则引擎在无 AI 时可以完整跑完 7 天，并且所有关键不变量有自动化断言。

### D05：后端 API 和公共投影

1. 实现剧本列表、详情、角色列表和创建 StoryRun。
2. 实现读取 StoryRun、叙事时间线、Dashboard。
3. 实现主线决策/关键回应、关键事件 defer、主动谋划、推进天数、最终裁决。
4. 公共响应统一返回 `narrativeEntries`、`activePrompt`、`criticalEvent`、`maneuverPanel`、`dashboard` 和 `meta`。
5. 公共投影禁止返回 `internalGain`、`internalRisk`、`statePatch` 预测、`hiddenMeaning`、`privateReasoningSummary` 和隐藏持有者信息。
6. 完成 400/404/409/422/429/502/503 错误码和统一错误 envelope。

退出条件：API 契约矩阵中每个接口都能被前端调用，并有成功、校验、冲突、幂等、失败和读回证明。

### D06：AI Provider、预算和 fallback

1. 定义主线决策、关键回应、主动谋划、日终摘要、最终裁决的结构化输入输出 Schema。
2. AI 输出必须经过 parse、normalize、Schema validate、业务校验、patch clamp 后才能落账。
3. 单次调用超时 20—30 秒，失败重试 1 次，双失败进入确定性 fallback。
4. 理论硬上限按文档控制为 55 次 provider 调用，单局 token 建议上限 260,000。
5. fallback 对玩家静默，仍生成 `resultStory`、`visibleChanges`、因果来源和必要角色反应。
6. 真实 DeepSeek smoke 只能使用本地已授权密钥；没有密钥时必须用本地 mock 和明确 limitation，不能伪造 live PASS。

退出条件：mock、超时、非法 JSON、Schema 失败、双失败 fallback 和 AiTask 账本测试均有执行入口。

### D07：Web 前端壳和页面路由

1. 保留 `apps/web`，正式页面路由为 `/`、`/role-select?story=sangtian`、`/game?runId=<runId>`。
2. `/game` 固定顶部、左栏、右栏，只有中间叙事区域改变或追加。
3. 接入 `ApiStoryStorage`，浏览器只保存 `currentRunId` 和非权威 UI 偏好。
4. 建立全局 token、资源加载、错误、loading、空状态、响应式和无障碍基础。
5. `/trio` 作为历史/非当前 MVP 验收面隔离，不得让它覆盖 `/game` 的正式契约。
6. 删除首页 `home-reference-skin` 和全页透明 hitbox；所有可见元素必须是真实组件，所有点击控件必须有可访问名称、键盘焦点和真实事件。
7. 更新 Web server 和所有视觉脚本的参考图路由，取消 `主游戏.png` 单图假设。

退出条件：干净启动后可以从首页进入选角，再创建并恢复 `/game`。

### D08：主游戏页面和 8 个 UI 状态

1. UI 01 对照 `UI01_角色专属开场.png`：角色专属日期、地点、章节标题、连续故事；无决策流程按钮。
2. UI 02 对照 `UI02_主线故事与决策.png`：故事后接 A/B/C 标题、统一输入框、200 字计数和提交决策；选项不泄露收益/风险。
3. UI 03 对照 `UI03_AI正在推演.png`：显示玩家最终文本和“AI 正在推演局势……”，隐藏技术日志、模型思考和百分比进度。
4. UI 04 对照 `UI04_推演结果故事与变化.png`：自动追加结果故事和本次变化；无“下一步/继续/查看变化”流程按钮。
5. UI 05 对照 `UI05_局势记录展开.png`：默认隐藏，只覆盖中间区域；提供全部/我的决策/他人影响/世界变化/数值变化，关闭后恢复滚动位置。
6. UI 06 对照 `UI06_关键事件弹窗.png`：完整页面压暗，支持立即处理和稍后处理，普通世界变化不得弹窗。
7. UI 07 对照 `UI07_他人影响故事与回应.png`：角色视角故事和回应 prompt，不暴露幕后身份与原始选项，回应占主线槽位。
8. UI 08 对照 `UI08_主动谋划.png`：目标人物、目的、AI 建议、自拟谋划、筹码使用与 200 字限制。
9. 《桑田诏》资产必须优先从 `docs/UI/web/game/嘉靖财政局/` 的语义 manifest 加载；通用 `pic`、`icon` 只能作有记录的 fallback，不用占位图、随机头像或语义错误的近似 icon。
10. 8 个状态共用同一顶部、左栏、右栏 DOM 骨架和尺寸；只允许中间区域改变，UI06 仅额外增加遮罩与弹窗。

退出条件：目标 viewport 的截图与参考图完成逐项比较；有差异必须进入视觉修复循环。

### D09：前后端合同和页面点击链路

逐个验证：页面控件 → route/state → API method/path → 请求体 → response/error → DB/state mutation → 页面可见结果。

重点覆盖：

- 建局按钮。
- 角色确认。
- A/B/C 选择。
- 建议标题回填和编辑。
- 自定义文本长度校验。
- 提交决策。
- 进入推演和自动追加。
- 人物交谈、调查、筹码、自拟谋划。
- 局势记录打开/关闭。
- 立即处理/稍后处理关键事件。
- 进入下一天。
- 第 7 天最终裁决。
- 刷新恢复和版本冲突重载。

### D10：部署、备份、恢复和可观测性

1. 配置 test/staging/production 的隔离规则。
2. 验证数据库迁移、备份、WAL/增量、保留和恢复演练。
3. 目标 RPO ≤ 15 分钟、RTO ≤ 2 小时。
4. 检查敏感变量、AI 原始输出、玩家完整自定义文本不得进入普通日志。
5. 检查 API、Web、数据库、AI fallback、恢复失败的结构化指标和告警。

### D11：一比一多轮视觉对比与修复

1. 为每个 `UI-REF-001`—`UI-REF-010` 创建独立 fixture、捕获命令和证据目录。
2. 每轮固定浏览器版本、DPR=1、字体、动画关闭、时间与数据；不得用动态内容差异解释布局差异。
3. 每轮输出 `reference.png`、`actual.png`、`diff.png`、`metrics.json`、`visual-summary.json`。
4. 每轮同时输出 `asset-usage.json`，记录页面实际加载的 assetKey、源目录、SHA-256 和 DOM/CSS 使用位置，证明嘉靖财政局专属资产没有被错误替代。
5. `visual-summary.json` 必须按 deviation ID 记录区域、严重度、像素框、根因、目标 CSS/组件和修复任务。
6. 修复顺序：画布/骨架 → 列宽/高度 → 字体/行高 → 间距/边框/圆角 → 颜色/阴影 → 图片/icon → 文案与状态。
7. 每次只做最小定点修复，完成后重截本页，并回归共享骨架影响到的全部页面。
8. 不设置固定轮数；只要任一 P0 material deviation 存在，就继续下一轮。
9. 建议自动阈值：尺寸必须完全一致；changed-pixel ratio ≤ 0.01、mean RGB delta ≤ 0.01、关键区域几何偏差 ≤ 2px。阈值通过后仍需人工检查文字换行、图像语义、遮挡与交互状态。

### D12：三玩家扩展保留与回归

1. `/trio` 与 `/game` 使用独立入口、合同和测试，不相互污染 localStorage 或 API 状态。
2. 三个模拟玩家分别认领角色，每轮各提交一次行动，连续 7 轮共 21 次行动。
3. 每轮验证三人视角差异、跨玩家影响、通知、AI task、分辨率、数据库读回和隐私字段过滤。
4. 真实 DeepSeek 仅在用户授权密钥存在时执行；否则 mock/fallback 轨道通过不等于 live 轨道通过。

### D13：测试、审查、报告与最终收口

1. 单元、集成、功能浏览器、API/DB、恢复、安全、性能、视觉和模拟玩家测试分层执行。
2. 每个失败先生成最小修复项，修复后重跑目标测试和受影响回归集。
3. 新一轮证据必须绑定同一 `RunId`；禁止混用旧 PASS、旧截图和当前源码。
4. 最终报告逐项读取需求、UI、API、DB、AI、三玩家扩展和模拟玩家证据，不接受聊天结论或计划文档替代。

## 4. 验收步骤

### A00：源和配置验收

- 所有当前文档和 UI 资源路径存在且 UTF-8 可读。
- `docs/UI/web/game/嘉靖财政局/` 的 18 张专属 PNG 全部存在、可解码、尺寸与 manifest 一致、SHA-256 可复算，无重复/损坏/未映射资产。
- 每个 UI01—UI08 中出现的嘉靖财政局角色、场景和功能 icon 都能回溯到专属 manifest；使用通用 fallback 时有明确原因。
- `story.json` 等配置完整，跨文件 lint 通过。
- 不使用 `AP`、行动力、行动点、筹谋等禁用术语。
- 运行态和配置版本被 StoryRun 固定记录。

### A01：干净启动验收

后续执行命令至少包括：

```powershell
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed
pnpm dev:api
pnpm dev:web
```

必须证明：API health、Web 首页、角色选择、游戏页都能打开，且不依赖旧的临时进程或旧 localStorage 状态。

### A02：功能闭环验收

完成一次从首页到第 7 天结局的真实可玩流程，逐步读回：

- 12 次主线决策。
- 至少 1 次自定义主线决策。
- 至少 1 次人物交谈、调查、筹码、自拟谋划。
- 至少 1 次关键事件立即处理。
- 至少 1 次关键事件稍后处理后刷新恢复。
- 每次 version、idempotencyKey、事件数量和谋划配额变化。
- 第 7 天全局结局、个人结局、救命步骤、伤害步骤、命运债。

### A03：状态、恢复和安全验收

- 旧 version 返回 `409 VERSION_CONFLICT`，状态不变。
- 相同幂等键重试不重复落账。
- AI 双失败仍能正常进入下一个 prompt。
- 服务重启后可以恢复当前局，不静默新建。
- 公共 API 和 HTML 不包含隐藏收益、风险、内部 patch、私密推理和完整 AI prompt。
- 用户输入按文本安全渲染，不执行 HTML/脚本。

### A04：功能测试验收

执行 [AIStoryRoom_v1.2_功能测试与模拟玩家测试.md](<D:\lyh\agent\agent-frame\aiStoryRoom\docs\AIStoryRoom_v1.2_功能测试与模拟玩家测试.md>) 中的 FT、API、DB、AI、恢复、安全、路径测试。所有 P0 项必须有日志、API transcript 或 DB readback。

### A05：模拟玩家验收

由模拟玩家按照该测试文档的 SP 场景，从第一次打开页面开始，不读取后台字段、不接受测试人员解释，完成至少两轮：

- 第一轮可理解性：身份、目标、决策、变化、谋划、局势记录、关键事件。
- 第二轮完整行为：从建局玩到结局，记录所有点击、停顿、误解、回退、刷新和重玩意愿。

### A06：UI 一比一验收

必须逐项验收 `首页.png`、`选择角色.png`、UI01—UI08，共 10 个视觉目标。每个目标每一轮必须具备：

```text
docs/auto-execute/screenshots/<RunId>/<UI-ID>/round-<NN>/reference.png
docs/auto-execute/screenshots/<RunId>/<UI-ID>/round-<NN>/actual.png
docs/auto-execute/screenshots/<RunId>/<UI-ID>/round-<NN>/diff.png
docs/auto-execute/screenshots/<RunId>/<UI-ID>/round-<NN>/metrics.json
docs/auto-execute/screenshots/<RunId>/<UI-ID>/round-<NN>/visual-summary.json
```

验收必须同时检查：

- 路由与 fixture 确实进入目标状态，不能截错状态后只比较风格。
- 页面没有加载参考图、整页覆盖层、透明热区或 screenshot-as-background。
- 顶部/左右栏、画布、列宽、滚动容器、弹窗、字体、行高、换行、颜色、边框、圆角、阴影、图片和 icon 与真源一致。
- 所有按钮、输入、筛选、弹窗和滚动不仅外观一致，而且真实可操作。
- 共享 CSS 修改后回归 10 张图，不允许修好一张破坏另外九张。

无真实 raster/pixel diff 时最多判定 `PASS_NEEDS_MANUAL_UI_REVIEW`；存在 material deviation 必须 `REPAIR_REQUIRED`。多轮对比持续到全部 10 张图通过，不设“一轮结束”条件。

### A07：最终门禁

只有以下条件全部满足才允许 `PASS`：

- 所有 P0/P1 需求有实现、测试和证据。
- 所有 P0 页面和 8 个 UI 状态可运行。
- 10 张参考图均有同一 RunId 下的真实 DOM 截图、diff、metrics 和人工复核记录；anti-cheat 检查通过。
- `game/嘉靖财政局` 18 张专属资产均已建立 manifest；所有实际使用均有 assetKey/hash/页面位置证据，未使用资产有明确说明。
- 所有 API 具备成功、校验、冲突、错误、fallback、DB 读回测试。
- 功能测试和模拟玩家测试均完成。
- 真实 UI 截图和 diff 通过。
- 数据库持久化、恢复、幂等和信息隔离通过。
- `/trio` 三玩家七轮扩展回归通过，且未替代或破坏 `/game`。
- 没有密钥泄露、真实生产副作用或未分类 blocker。

## 5. 失败处理

| 状态 | 处理 |
|---|---|
| `REPAIR_REQUIRED` | 建立最小修复任务，只修复失败断言并重跑相关测试 |
| `BLOCKED_BY_MISSING_SOURCE` | 记录缺失文档、资源、接口或配置，不得猜测 |
| `BLOCKED_BY_ENVIRONMENT` | 记录环境命令、错误和可替代验证方式 |
| `PASS_NEEDS_MANUAL_UI_REVIEW` | 功能可证但缺少真实像素证据，保留人工复核项 |
| `HARD_FAIL` | 涉及安全、数据破坏、真实外部副作用或不可接受 P0 失败 |

## 6. 当前状态

本文件是开发和验收计划，不代表任何产品功能已经完成。当前“已实现/部分实现/未完成”仅来自 2026-07-12 静态审查和历史证据读取，后续必须重新执行、逐项测试、多轮视觉修复，并写入同一 RunId 的机器可读证据。
