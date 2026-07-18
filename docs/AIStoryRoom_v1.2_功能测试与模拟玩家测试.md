# AI Story Room v1.2 功能测试与模拟玩家测试

> 文档状态：PLANNED
>
> 测试目标：分别证明“系统按契约正确运行”和“真实玩家可以理解并完成游戏”。两类测试不得混为一个 PASS。

> UI 最高门槛：`首页.png`、`选择角色.png`、UI01—UI08 必须逐图、多轮、真实 DOM/CSS 一比一对比。不得通过显示参考图本身、整页背景、覆盖层或透明热区制造视觉 PASS。

## 1. 测试分层

### 1.1 功能测试 FT

功能测试由测试脚本、API client、数据库读回、DOM 断言和故障注入完成。测试人员可以读取后台状态、固定 fixture、直接调用 API、比较数据库事件和断言隐藏字段。

功能测试证明：

- API method/path/request/response/error 合同正确。
- 状态机、计数、版本、幂等、事务和恢复正确。
- 规则引擎在无 AI 时仍能完成一局。
- AI 输出经过 Schema/业务校验，失败时 fallback 正确。
- 公共投影不会泄露私密字段。
- 所有 UI 控件与 API、状态或可见变化正确连接。
- 数据库写入和独立读回一致。

### 1.2 模拟玩家测试 SP

模拟玩家测试从浏览器真实页面开始，只使用玩家能看到的内容，不读取数据库、不看后台日志、不接受测试人员解释，不直接调用 API 推进游戏。

模拟玩家证明：

- 玩家能否理解自己是谁、目标是什么、当前压力是什么。
- 玩家能否理解连续叙事流，而不是寻找“下一页/继续阅读”。
- 玩家能否区分主线决策与主动谋划。
- 玩家能否发现“本次变化”和前一个决定的关系。
- 玩家能否理解关键事件立即处理/稍后处理。
- 玩家能否从第 1 天玩到第 7 天并愿意重玩。
- 页面、文字、头像、背景、icon 和交互是否足够接近参考 UI。
- 玩家实际操作的页面是否与截图一致，而不是“截图外观层 + 另一套隐藏交互”。

## 2. 测试环境和证据

### 2.1 计划环境

| 环境 | 用途 | AI | 数据 | 状态 |
|---|---|---|---|---|
| test | 自动化功能测试 | deterministic mock | 每次隔离、可重置 | PLANNED |
| local | 开发和浏览器流程 | mock/fallback，授权时可 DeepSeek | 本地 PostgreSQL 或文件适配器 | PLANNED |
| staging | 模拟玩家和连续局 | 真实模型 + fallback | 独立持久化实例 | PLANNED |
| production | 本轮不执行 | 不触碰 | 不触碰生产数据 | OUT_OF_SCOPE_WITH_REASON |

### 2.2 计划命令

```powershell
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed
pnpm test:config
pnpm test:api
pnpm --filter @apps/web test
pnpm typecheck
pnpm test:causal
pnpm test:maneuver
pnpm test:paths
pnpm test:security-projection
pnpm test:concurrency
pnpm test:ai-failure
pnpm test:continuous
pnpm test:storage-recovery
pnpm test:provider-retry
pnpm test:story:e2e
pnpm test:story:v4-db
```

浏览器测试必须另外启动 `apps/api` 和 `apps/web`，使用 Playwright 或现有等价浏览器 harness，并保存截图、trace、console、network 和 API/DB 证据。视觉视口固定为：首页 `910×1729`、角色选择 `1448×1086`、UI01—UI08 `1672×941`，统一 DPR=1、固定字体、关闭动画、固定时间和 fixture。

### 2.3 证据目录

```text
docs/auto-execute/results/<RunId>/<TEST-ID>.json
docs/auto-execute/logs/<RunId>/<TEST-ID>/
docs/auto-execute/screenshots/<RunId>/<UI-ID>/round-<NN>/
docs/auto-execute/api/<RunId>/<TEST-ID>/
docs/auto-execute/db/<RunId>/<TEST-ID>/
docs/auto-execute/owner/<RunId>/<SP-ID>/
```

### 2.4 当前状态使用规则

- 本文档中的测试全部为 `PLANNED`；不得继承旧结果为当前 PASS。
- 旧首页 `changedPixels=0` 由 `home-reference-skin` 直接覆盖参考图产生，不能作为真实复刻证据。
- 旧主游戏结果引用已不存在的 `主游戏.png`，且 ratio=0.128077，仅能说明曾有明显差异。
- 旧 `/trio` 三玩家七轮证据可作为回归基线，但后续仍需在当前源码和当前 RunId 下重跑。
- 功能测试、视觉测试、模拟玩家测试必须分别出报告，最终门禁再聚合。

## 3. 功能测试夹具

| Fixture ID | 内容 | 用途 |
|---|---|---|
| FX-001 | `templateKey=sangtian`、角色 `zhejiang_governor` | 建局和主流程 |
| FX-002 | 12 个主线决策、7 天配置 | 计数和推进 |
| FX-003 | A/B/C 三条预设路径 | 分支差异 |
| FX-004 | 200 字以内、201 字、空文本、HTML/脚本文本 | 输入和安全 |
| FX-005 | contact/investigate/leverage/custom | 四类主动谋划 |
| FX-006 | 可回应 critical event 和可 defer critical event | 关键事件 |
| FX-007 | provider timeout、非法 JSON、Schema 缺字段、双失败 | AI fallback |
| FX-008 | 正确 version、旧 version、重复 idempotencyKey | 并发幂等 |
| FX-009 | availableLeverage、已消费筹码、无来源筹码 | 筹码规则 |
| FX-010 | 第 1 天 FateSeed 在第 3—5 天 help/backfire | 延迟因果 |
| FX-011 | 快照损坏、事件尾部缺失、服务重启中的 resolving | 恢复 |
| FX-012 | 隐藏角色目标、privateReasoning、internalRisk/Gain | 信息隔离 |
| FX-013 | `docs/UI/web/game/嘉靖财政局/` 18 张 PNG 及其语义 manifest | 专属资产映射、优先级、完整性和视觉复刻 |

## 4. 功能测试总矩阵

### 4.1 环境、配置和资源

| ID | 测试点 | 操作 | 通过条件 | 证据 |
|---|---|---|---|---|
| FT-ENV-001 | 干净安装 | 删除临时依赖后安装 | lockfile 可复现，安装无隐藏下载要求 | 安装日志 |
| FT-ENV-002 | 数据库迁移 | migrate deploy + seed | schema、seed、版本可读回 | migration/readback |
| FT-ENV-003 | API health | 访问 health | 返回健康状态，不暴露密钥 | API transcript |
| FT-ENV-004 | Web 启动 | 启动 Web | `/`、`/role-select`、`/game` 可访问 | browser trace |
| FT-CONFIG-001 | 配置文件完整 | 扫描 story/roles/days/decisions/maneuvers/leverage/endings/context-cards | 文件齐全、JSON 合法、UTF-8 干净 | lint JSON |
| FT-CONFIG-002 | 7 天约束 | 运行 config lint | 7 天、前 6 天每天 2 个 prompt、第 7 天无普通 prompt | lint result |
| FT-CONFIG-003 | 选项投影规则 | 读取公共 prompt | 选项只含 `optionKey + title` | response scan |
| FT-CONFIG-004 | 资源索引 | 扫描 `game/嘉靖财政局`、`pic`、`icon` 和 manifest | 18 张专属 PNG、通用资源均存在、尺寸可读、引用不丢失 | asset manifest |
| FT-CONFIG-005 | 禁用术语扫描 | 扫描页面和日志 | 不出现 AP、行动力、行动点、筹谋 | grep report |
| FT-CONFIG-006 | 专属资产 manifest | 校验 assetKey、原文件、SHA-256、尺寸、语义、用途、页面、裁切与 alt | 字段完整，文件 hash/尺寸一致，无未映射文件和重复 assetKey | manifest validation JSON |
| FT-CONFIG-007 | 资产优先级 | 解析《桑田诏》页面所有图片/icon 请求 | 优先命中 `game/嘉靖财政局`；通用 fallback 必须有白名单原因 | network/asset resolution log |

### 4.2 页面和 UI 状态

| ID | 测试点 | 操作 | 通过条件 | 证据 |
|---|---|---|---|---|
| FT-UI-001 | 首页真实实现 | 打开 `/` | 可见页面由真实 DOM/CSS/资产构成，不加载 `/reference/home.png`，不存在 `home-reference-skin` 或整页透明 hitbox | DOM/network/screenshot |
| FT-UI-002 | 角色选择 | 从首页进入 `/role-select?story=sangtian` | 页面真实复刻 `选择角色.png`；浙江总督可确认进入，其他角色行为与产品规则一致 | screenshot/DOM/route |
| FT-UI-003 | UI 01 开场 | 创建新局 | 连续故事出现，无分页和继续阅读按钮 | DOM/screenshot |
| FT-UI-004 | UI 02 主线决策 | 等待 activePrompt | 三个建议只显示标题，统一输入框可见，最大 200 字 | DOM assertion |
| FT-UI-005 | 建议回填 | 点击 A/B/C | 标题进入输入框，可补充、改写、清空重写 | browser trace |
| FT-UI-006 | UI 03 推演 | 提交合法决定 | 只显示玩家最终文本和“AI 正在推演局势……” | screenshot/DOM |
| FT-UI-007 | UI 04 结果 | 等待推演完成 | 结果故事后自动接本次变化，不需要点击下一步 | DOM/scroll trace |
| FT-UI-008 | UI 05 局势记录 | 打开、筛选、关闭 | 显示全部/我的决策/他人影响/世界变化/数值变化，关闭恢复原滚动位置 | browser trace |
| FT-UI-009 | UI 06 关键事件 | 触发 critical event | 页面压暗、弹窗、立即处理和稍后处理出现 | screenshot |
| FT-UI-010 | UI 07 他人影响 | 立即处理或打开 deferred event | 角色视角故事和回应 prompt 进入中间时间线 | DOM/trace |
| FT-UI-011 | UI 08 主动谋划 | 点击人物/调查/筹码/自拟 | 内容进入中间区域，右栏仍固定，结果回到同一时间线 | browser trace |
| FT-UI-012 | 提交锁定 | 连续点击提交按钮 | 只产生一次请求和一次状态变化，按钮、输入和选项进入锁定 | network/API |
| FT-UI-013 | loading/error | 模拟网络失败/推演失败 | 页面显示用户可理解错误和重试入口，不泄露技术细节 | screenshot |
| FT-UI-014 | 响应式 | 1366×768、1448×900、1448×1086 | 核心输入、提交按钮和固定三栏不遮挡 | screenshots |
| FT-UI-015 | 安全渲染 | 输入 HTML/script | 页面只显示文本，不执行脚本、不插入 HTML | browser console |
| FT-UI-016 | 资产完整性 | 断开一张背景/头像/icon | 应显示可识别 fallback 或测试失败，不能静默使用随机占位 | asset test |
| FT-UI-017 | 参考图防作弊 | 监控 network、CSS 和 DOM | 产品页面不得把任一 UI reference 用作整页 img/background/canvas；参考图仅允许被 diff 工具读取 | network/DOM/style scan |
| FT-UI-018 | 固定骨架一致性 | 对 UI01—UI08 测量顶部、左栏、右栏 | 8 个状态几何坐标一致；只有中间区变化，UI06 仅增加遮罩/弹窗 | bounding-box JSON |
| FT-UI-019 | 真实控件覆盖 | 枚举按钮、链接、tab、input、textarea、modal | 每个 P0 控件有真实 click/type/submit 效果，不存在只为截图设置的空热区 | click matrix/trace |
| FT-UI-020 | 视觉修复回归 | 任一共享 CSS 修复后重截 10 张图 | 当前页改善且其他页面无 material regression | multi-page metrics |
| FT-UI-021 | 嘉靖专属资产语义 | 逐项核对角色头像、场景、印章、状态和功能 icon | 画面语义与参考图及 manifest 一致，不出现错角色、错时代或近似替代 | annotated asset review |
| FT-UI-022 | 专属资产加载失败 | 分别模拟 404、损坏图、hash 不一致 | 开发/测试环境明确失败并定位 assetKey；不得静默换成随机图 | network/error report |

### 4.2A 一比一视觉测试矩阵

| Visual ID | Reference | Route/State | Viewport | 必需 fixture | 核心检查 |
|---|---|---|---|---|---|
| VT-001 | `首页.png` | `/` loaded | 910×1729 | 固定 8 个世界卡与资源 | 长页高度、导航、Hero、世界卡、说明、单人/多人入口、流程、创建区、结局区、FAQ、价格和 Footer；禁止 reference skin |
| VT-002 | `选择角色.png` | `/role-select?story=sangtian` | 1448×1086 | `sangtian` + 5 张角色卡 | 步骤条、剧本 Banner、角色卡、选中态、右侧摘要、返回/确认按钮、图像裁切 |
| VT-003 | `UI01_角色专属开场.png` | `/game` opening | 1672×941 | 新建第 1 天 run | 固定骨架、日期地点章节、连续故事、无决策按钮 |
| VT-004 | `UI02_主线故事与决策.png` | `/game` main_decision | 1672×941 | activePrompt main_decision | A/B/C、统一输入、200 字计数、提交按钮；无收益/风险 |
| VT-005 | `UI03_AI正在推演.png` | `/game` resolving | 1672×941 | 已提交决定、provider 延迟 | 最终决定文本、印章/水墨状态、唯一推演文案、提交锁定 |
| VT-006 | `UI04_推演结果故事与变化.png` | `/game` result | 1672×941 | resultStory + visibleChanges | 新剧情、本次变化、可选下个决策；无流程跳转按钮 |
| VT-007 | `UI05_局势记录展开.png` | `/game` situation record | 1672×941 | 多类型事件历史 | 中间区覆盖、5 类筛选、时间线、内部滚动、关闭恢复位置 |
| VT-008 | `UI06_关键事件弹窗.png` | `/game` critical modal | 1672×941 | pending criticalEvent | 页面压暗、中央弹窗、标题摘要、立即/稍后处理、焦点限制 |
| VT-009 | `UI07_他人影响故事与回应.png` | `/game` critical_response | 1672×941 | deferred/active critical response | 角色视角故事、三建议、自定义回应、提交回应、信息隔离 |
| VT-010 | `UI08_主动谋划.png` | `/game` maneuver composer | 1672×941 | remaining=2、目标和筹码可用 | 标题、目标、目的、建议、自拟输入、筹码、提交谋划 |

每个 Visual ID 必须执行以下循环，轮数不设上限：

1. 以确定性 fixture 进入准确状态，记录 route、runId、version、viewport、浏览器和 commit/worktree 标识。
2. anti-cheat 扫描 network/DOM/CSS；发现加载参考图或全页透明热区立即 `HARD_FAIL`。
3. 捕获 actual raster，并生成像素 diff、metrics 和分区 bounding-box 数据。
4. 对画布、骨架、字体、间距、颜色、边框、图片、icon、文字换行、遮挡和状态逐项判定；UI01—UI08 的角色、场景和功能图形必须同时对照 `game/嘉靖财政局` manifest。
5. material deviation 生成稳定 `DEV-<UI-ID>-<NNN>`，映射到具体组件/CSS 和最小修复。
6. 修复后重截本 Visual ID；若修改共享 token/骨架，必须重截 VT-001—VT-010。
7. 自动阈值建议：尺寸完全一致、changed-pixel ratio ≤ 0.01、mean RGB delta ≤ 0.01、关键几何偏差 ≤ 2px；人工复核仍为必需。
8. 缺任一 reference/actual/diff/metrics/summary，或仍有 P0 deviation，状态只能是 `REPAIR_REQUIRED` / `PASS_NEEDS_MANUAL_UI_REVIEW`，不能纯 PASS。

### 4.3 StoryRun 和状态机

| ID | 测试点 | 操作 | 通过条件 |
|---|---|---|---|
| FT-STATE-001 | 创建状态 | POST 创建 StoryRun | `created` 只短暂存在，最终进入 `awaiting_decision` |
| FT-STATE-002 | 唯一 activePrompt | 读取状态 | 同时最多一个 activePrompt |
| FT-STATE-003 | promptKind | 触发普通和关键回应 | 只允许 `main_decision/critical_response` |
| FT-STATE-004 | resolving | 提交主线或谋划 | 进入 resolving，禁止第二个写请求覆盖结果 |
| FT-STATE-005 | 日终 | 完成当天 2 次主线决策 | 进入 `awaiting_day_advance` 并写入 day_end |
| FT-STATE-006 | 进入下一天 | advance-day | 第 1—5 天进入下一天并重置谋划；未用机会作废 |
| FT-STATE-007 | 第 7 天 | 第 6 天 advance-day | `currentDay=7`、`awaiting_finalization`、无 activePrompt、谋划为 0 |
| FT-STATE-008 | finalization | 第 7 天 finalize | 进入 `finished`，存在 globalEnding、personalEnding、fateDebt |
| FT-STATE-009 | 已完成只读 | finished 后提交任何写操作 | 全部拒绝，不修改状态 |
| FT-STATE-010 | 可恢复错误 | 注入持久化失败 | 进入 `error_recoverable`，恢复后只落账一次 |
| FT-STATE-011 | 不变量 | 随机路径 1000 次 | 数值 0—100，总主线决策不超过 12，无死路 |

### 4.4 API 功能和错误

| ID | API | 必测成功 | 必测失败/边界 | DB/状态验证 |
|---|---|---|---|---|
| FT-API-001 | `GET /api/v4/stories` | 返回 sangtian | 服务器错误 envelope | 只读 |
| FT-API-002 | `GET /api/v4/stories/:templateKey` | 返回详情和版本 | 不存在返回 404 | 配置版本一致 |
| FT-API-003 | `GET /api/v4/stories/:templateKey/roles` | 返回玩家和 AI 角色 | 不存在模板 404 | 后台字段不泄露 |
| FT-API-004 | `POST /api/v4/story-runs` | 创建并返回公共视图 | 非法模板、非法角色、重复幂等键 | StoryRun + 初始事件读回 |
| FT-API-005 | `GET /api/v4/story-runs/:runId` | 返回完整公共视图 | 不存在 404，不静默新建 | snapshot/event 一致 |
| FT-API-006 | `GET /api/v4/story-runs/:runId/messages` | 返回有序 NarrativeEntry | after/limit 边界、隐藏事件过滤 | 事件顺序 |
| FT-API-007 | `GET /api/v4/story-runs/:runId/dashboard` | 返回公开 dashboard | 不返回隐藏账本 | 只读 |
| FT-API-008 | `POST .../decisions` | 正常落账 | 空文本、201 字、错误 eventId、旧 version、重复决策、RUN_BUSY | version +1、事件只一次 |
| FT-API-008A | `POST .../critical-events/:eventId/respond` | deferred/pending 事件进入回应 prompt | 非关键事件、已完成、旧 version、重复 key | promptKind=critical_response，主线尚未计数 |
| FT-API-009 | `POST .../defer` | 追加 defer 事件 | 非关键事件、已处理事件、旧 version | deferred 持久化、主线计数不变 |
| FT-API-010 | `POST .../maneuvers` | 四类谋划成功 | 机会耗尽、非法目标、无筹码、超长、越权 | 机会 -1、事件和结果读回 |
| FT-API-011 | `POST .../advance-day` | 正确推进 | 当天未完成、旧 version、第 6 天重复推进 | 日状态和机会重置 |
| FT-API-012 | `POST .../finalize` | 第 7 天结局 | 提前裁决、重复裁决、旧 version | finalJudgement 只写一次 |
| FT-API-013 | 所有写 API | 并发请求 | 只有一个成功，其他 409/幂等结果 | 无重复事件/补丁 |
| FT-API-014 | v4 错误 envelope | 触发 400/404/409/422/429/502/503 | code/message/details/currentVersion 结构稳定，不返回堆栈或密钥 | 无意外写入 |
| FT-API-015 | 身份与归属 | 无身份、错误用户、正确 owner（如当前部署启用 auth） | 401/403/成功符合合同；未启用 auth 时必须记录明确 local-only 边界 | 非 owner 不得读写私密局 |
| FT-API-016 | 公共投影 | 扫描所有成功响应 | 不含 internalGain/internalRisk/statePatch 预测/privateReasoning/hiddenMeaning/完整 prompt | DB 内部字段仍可审计 |
| FT-API-017 | CORS 与 API base | 从 Web origin 调用 API | 允许配置的本地 origin，拒绝异常 method/header；Web 不混用旧接口 | 只读/按请求写入 |

### 4.5 主线决策和 ActionGuard

| ID | 测试点 | 输入 | 通过条件 |
|---|---|---|---|
| FT-GUARD-001 | 合法自定义 | 符合身份、时代、资源、阶段的处理方式 | `ok`，进入推演 |
| FT-GUARD-002 | 空文本 | 空白或 CUSTOM 无文本 | 400，不消耗决策、不改 version |
| FT-GUARD-003 | 超长文本 | 201 字 | 400/422，不消耗决策 |
| FT-GUARD-004 | 身份越权 | 命令皇帝/任免内阁等 | blocked，返回 rewriteSuggestion |
| FT-GUARD-005 | 时代越界 | 手机、无人机、互联网等 | blocked |
| FT-GUARD-006 | 资源不足 | 调用未持有银两、粮草、证据 | blocked |
| FT-GUARD-007 | 阶段越界 | 提前跳第 7 天/宣布结局 | blocked |
| FT-GUARD-008 | 操控他人 | 强迫他人认罪/服从 | blocked |
| FT-GUARD-009 | 拒绝回填 | Guard 拒绝后修改原文本重试 | 原输入保留，合法修改可再次提交 |

### 4.6 主动谋划

| ID | 测试点 | 通过条件 |
|---|---|---|
| FT-MAN-001 | 人物交谈 | 目标和 intent 有效，写 maneuver/result/role reaction |
| FT-MAN-002 | 派遣调查 | 写入线索、证据、任务或痕迹 |
| FT-MAN-003 | 使用筹码 | 仅可使用已获得且可用筹码，写 `leverage_used` |
| FT-MAN-004 | 自拟谋划 | 1—200 字，经过 Guard，结果回到时间线 |
| FT-MAN-005 | 机会扣减 | 成功一次 remaining -1，最多 2 次/天 |
| FT-MAN-006 | 拒绝不扣减 | Guard blocked/rewrite_needed 不改 version、不扣机会 |
| FT-MAN-007 | 不替代主线 | 谋划后 activePrompt 仍存在，主线计数不变 |
| FT-MAN-008 | 跨日清零 | 未使用机会不结转，下一天重置为 2 |
| FT-MAN-009 | 第 7 天禁用 | 第 7 天不可谋划 |
| FT-MAN-010 | 谋划幂等 | 重复 key 不重复扣机会、不重复事件 |
| FT-MAN-011 | 谋划因果 | 后续选项、关系、线索、风险、FateSeed 或结局发生可追踪影响 |

### 4.7 关键事件、连续叙事和信息隔离

| ID | 测试点 | 通过条件 |
|---|---|---|
| FT-NAR-001 | story 投影 | story_block/role_reaction/day_end 可投影为 story |
| FT-NAR-002 | result 投影 | 结果后自动有 story，存在可见变化时有 change_summary |
| FT-NAR-003 | 顺序 | NarrativeEntry 可直接按时间顺序渲染 |
| FT-NAR-004 | 关键事件队列 | 已有 activePrompt 时 critical event 进入 pending 队列 |
| FT-NAR-005 | 立即处理 | 进入角色视角故事和 critical_response prompt |
| FT-NAR-006 | 稍后处理 | 写 defer 事件，刷新后仍可恢复，不重复弹窗 |
| FT-NAR-007 | 关键回应计数 | critical_response 成功后主线计数 +1，不超过 12 |
| FT-NAR-008 | 公共投影安全 | 不含 hiddenMeaning、privateReasoning、内部 gain/risk、完整 patch、隐藏持有者 |
| FT-NAR-009 | 视角限制 | 玩家只能看到当前角色可感知事实 |
| FT-NAR-010 | 局势记录 | 从同一事件流重建我的决策、他人影响、世界变化、数值变化 |

### 4.8 AI、fallback 和成本

| ID | 测试点 | 操作 | 通过条件 |
|---|---|---|---|
| FT-AI-001 | 结构化输出 | mock 返回合法结果 | resultStory、visibleChanges、下一 prompt 可解析 |
| FT-AI-002 | timeout 一次 | 第一次超时，第二次正常 | 自动重试一次，最终正常落账 |
| FT-AI-003 | timeout 两次 | 两次超时 | deterministic fallback，玩家正常继续 |
| FT-AI-004 | 非法 JSON | provider 返回文本 | retry 后 fallback |
| FT-AI-005 | 缺 resultStory | Schema 缺字段 | reject/fallback，不写非法状态 |
| FT-AI-006 | 无来源 patch | AI patch 无 originEventId | reject/fallback |
| FT-AI-007 | provider secret | 扫描日志和结果 | 不出现 API key 或完整密钥 |
| FT-AI-008 | AiTask | 读取任务账本 | provider、taskType、attempt、status、fallback、token/error 可读 |
| FT-AI-009 | 预算 | 模拟达到调用/token/cost 上限 | 剩余步骤按规范降级，不改变已落账状态 |
| FT-AI-010 | live DeepSeek | 仅在授权和本地密钥存在时 | 真实结果必须有 live evidence；无密钥只能 limitation |

### 4.9 路径、结局、恢复和运维

| ID | 测试点 | 通过条件 |
|---|---|---|
| FT-PATH-001 | 全 A | 可到第 7 天，状态签名和结局记录 |
| FT-PATH-002 | 全 B | 与全 A 状态或结局不同 |
| FT-PATH-003 | 全 C | 与全 A/B 状态或结局不同 |
| FT-PATH-004 | 无谋划 | 完成 12 次主线并结局 |
| FT-PATH-005 | 每天 1 次谋划 | 完成并与无谋划轨迹不同 |
| FT-PATH-006 | 每天 2 次谋划 | 不超过 12 次，总结局可达 |
| FT-PATH-007 | FateSeed help | 第 3—5 天满足条件触发 help，并回溯 origin |
| FT-PATH-008 | FateSeed backfire | 第 3—5 天满足条件触发 backfire，并回溯 origin |
| FT-PATH-009 | 多结局可达 | 至少 5 个全局结局和 5 个个人档位均有路径 |
| FT-REC-001 | 浏览器刷新 | 只用 runId 恢复，不静默新局 |
| FT-REC-002 | resolving 刷新 | 显示推演状态并轮询恢复，不重复落账 |
| FT-REC-003 | 服务重启 | StoryRun、事件流、prompt、defer 可恢复 |
| FT-REC-004 | 快照损坏 | 可从事件流恢复或明确失败，不伪造成功 |
| FT-OPS-001 | 备份 | 全量/增量/WAL 按计划生成 |
| FT-OPS-002 | 保留 | 过期备份按规则清理，不删业务事件 |
| FT-OPS-003 | 恢复演练 | RPO ≤ 15 分钟，RTO ≤ 2 小时，读回一致 |
| FT-OPS-004 | 日志脱敏 | 普通日志不包含密钥、完整 prompt、完整玩家文本 |

### 4.10 三玩家七轮扩展回归

| ID | 测试点 | 通过条件 |
|---|---|---|
| FT-TRIO-001 | `/trio` 独立入口 | 可访问且不改变 `/`、`/role-select`、`/game` 正式流程 |
| FT-TRIO-002 | 三玩家认领 | 3 个独立身份各认领 1 个角色，权限与视角不串号 |
| FT-TRIO-003 | 七轮行动 | 7 轮每轮 3 次有效行动，共 21 次；每轮仅结算一次 |
| FT-TRIO-004 | 跨玩家影响 | 每轮至少有可追踪影响进入另一玩家可见故事/通知 |
| FT-TRIO-005 | 隐私隔离 | 不泄露 privateReasoning、hiddenIntent、hiddenMeaning 和他人私密完整行动 |
| FT-TRIO-006 | AI task | 每轮结算和章节生成的 provider/status/attempt/fallback 可读回 |
| FT-TRIO-007 | 通知 | 每位玩家只读到授权通知，数量、runId、round/node 和已读状态正确 |
| FT-TRIO-008 | DB 独立读回 | StoryRun、StoryPlayer、Action、Resolution、Notification、AiTask、EventLog 数量与 UI/API 一致 |
| FT-TRIO-009 | live/mock 边界 | mock/fallback 不得标为 DeepSeek live；live 需真实 provider 证据且密钥不落盘 |
| FT-TRIO-010 | 主流程无回归 | 完成 trio 后单人 `/game` 仍可新建、决策、恢复、结局 |

### 4.11 可访问性、性能、兼容性和报告完整性

| ID | 测试点 | 通过条件 |
|---|---|---|
| FT-A11Y-001 | 键盘完整操作 | 首页、选角、决策、局势记录、关键弹窗、谋划可用 Tab/Enter/Space/Escape 操作 |
| FT-A11Y-002 | 焦点管理 | 弹窗打开聚焦弹窗、焦点不逃逸、关闭回到触发点 |
| FT-A11Y-003 | 语义与名称 | input 有 label，按钮/图标有可访问名称，状态使用合适 live region |
| FT-A11Y-004 | 对比与缩放 | 文本/按钮对比可读；200% 缩放不丢核心操作 |
| FT-PERF-001 | 首屏资源 | 无重复加载参考图、超大无用资源和阻塞错误；资源失败可诊断 |
| FT-PERF-002 | 长时间线 | 完整 7 天叙事下滚动、筛选、输入和弹窗保持可用，无明显内存增长 |
| FT-PERF-003 | 提交响应 | 本地 API 首次可见反馈及时；AI 慢响应立即进入 UI03，不呈现假死 |
| FT-COMPAT-001 | 浏览器 | 当前 Chrome/Edge 至少各跑核心流程；行为和视觉无 P0 差异 |
| FT-REPORT-001 | RunId 一致性 | 所有日志、截图、API transcript、DB readback 属于同一源码和 RunId |
| FT-REPORT-002 | 证据真实性 | 计划、旧截图、聊天文字和 reference overlay 均不能作为当前执行证据 |
| FT-REPORT-003 | 失败保留 | 每个失败、修复、重跑和剩余 limitation 都保留可追踪记录 |

## 5. 功能测试判定规则

- P0 功能任一失败：`REPAIR_REQUIRED` 或 `HARD_FAIL`。
- 缺数据库、浏览器、AI 密钥或截图环境：必须写 `BLOCKED_BY_ENVIRONMENT`，不能假装通过。
- mock 通过不等于真实 DeepSeek 通过。
- 结构测试通过不等于 UI 一比一通过。
- 没有 DB readback 的写接口不能判定为完整通过。

## 6. 模拟玩家测试场景

模拟玩家每个场景都要记录：玩家编号、时间、viewport、点击顺序、停顿、误解、主动提问、回退、刷新、截图和最终判断。主持人只能介绍“你是浙江总督，目标是在七天内稳住局势并保住自己”，不得解释收益、风险、角色真实目标或正确策略。

### 6.1 首次理解和进入游戏

| ID | 玩家任务 | 观察点 | 通过标准 |
|---|---|---|---|
| SP-001 | 第一次打开首页，找到开始入口 | 是否能识别产品和入口 | 3 分钟内进入选角 |
| SP-002 | 进入角色选择 | 是否理解唯一可玩角色和 AI 角色 | 能说出自己是谁 |
| SP-003 | 创建第 1 局 | 是否理解 7 天和最终裁决 | 能复述目标和剩余天数 |
| SP-004 | 阅读开场故事 | 是否寻找下一页/继续阅读 | 能自然向下阅读，不要求额外按钮 |

### 6.2 主线决策和推演

| ID | 玩家任务 | 观察点 | 通过标准 |
|---|---|---|---|
| SP-005 | 阅读 UI 02 | 是否理解 A/B/C 只是行动方向 | 能说出准备采取的行动 |
| SP-006 | 点击建议 A | 是否发现标题回填输入框 | 能直接提交或修改文本 |
| SP-007 | 改写建议文本 | 是否理解最终提交的是自己的完整决定 | 能完成补充并提交 |
| SP-008 | 完全自定义 | 是否能在无建议时自行输入 | 不需要后台解释即可提交 |
| SP-009 | 等待 UI 03 | 是否误以为卡死、是否关注技术日志 | 能理解世界正在推演，不要求模型信息 |
| SP-010 | 阅读 UI 04 | 是否先看故事再看变化 | 能说出刚才决定带来的至少一个变化 |
| SP-011 | 连续阅读旧内容 | 是否被自动滚动打断 | 上滑时不强制跳底，能发现新内容提示 |

### 6.3 主动谋划

| ID | 玩家任务 | 观察点 | 通过标准 |
|---|---|---|---|
| SP-012 | 查看右栏 | 是否理解谋划与主线不同 | 能说出主动谋划是可选后手 |
| SP-013 | 人物交谈 | 是否能选择对象和意图 | 完成一次有效接触 |
| SP-014 | 派遣调查 | 是否理解调查可能获得线索或留下痕迹 | 能说出调查结果的影响 |
| SP-015 | 使用筹码 | 是否理解筹码不是无限资源 | 能选择已获得筹码和目标 |
| SP-016 | 自拟谋划 | 是否能写出不超过 200 字的主动安排 | 能完成一次有效自拟谋划 |
| SP-017 | 不使用谋划 | 是否感觉“不用就不能继续” | 能理解机会可放弃且不结转 |
| SP-018 | 谋划后推进主线 | 是否误以为谋划替代主线 | 能继续完成主线 prompt |

### 6.4 关键事件和局势记录

| ID | 玩家任务 | 观察点 | 通过标准 |
|---|---|---|---|
| SP-019 | 遇到关键事件弹窗 | 是否理解事件严重性和他人影响 | 能解释为什么需要处理 |
| SP-020 | 选择稍后处理 | 是否知道事件没有解决 | 刷新后能找到待处理事件 |
| SP-021 | 选择立即处理 | 是否理解回应仍是一项主线决策 | 能完成回应并继续故事 |
| SP-022 | 打开局势记录 | 是否理解回看而不是新功能页面 | 能找到自己的决策和世界变化 |
| SP-023 | 关闭局势记录 | 是否丢失阅读位置 | 回到原叙事滚动位置 |

### 6.5 完整游戏和结局

| ID | 玩家任务 | 观察点 | 通过标准 |
|---|---|---|---|
| SP-024 | 连续玩完第 1—3 天 | 文本密度、疲劳、因果理解 | 能继续并说出至少一次帮助/伤害 |
| SP-025 | 连续玩到第 6 天 | 决策重复感、剩余目标感 | 能理解接近御前裁决 |
| SP-026 | 进入第 7 天 | 是否知道不再普通决策 | 能找到最终裁决入口 |
| SP-027 | 阅读个人和全局结局 | 是否认为结局由自己推动 | 能指出至少两次关键选择 |
| SP-028 | 重新开局 | 是否愿意尝试另一条路径 | 愿意重玩并选择不同方向 |
| SP-029 | 刷新/离开后回来 | 是否相信局势仍然存在 | 能恢复原局，不认为数据丢失 |

### 6.6 UI 复刻与交互真实性观察

| ID | 玩家任务 | 观察点 | 通过标准 |
|---|---|---|---|
| SP-030 | 在首页浏览并点击多个区域 | 是否只有透明热区可点、视觉与焦点是否错位 | 所见控件就是实际控件，键盘与鼠标均能命中 |
| SP-031 | 在角色选择切换角色卡 | 卡片选中、右侧摘要、确认按钮是否同步 | 不出现视觉选中与实际提交角色不一致 |
| SP-032 | 连续经历 UI01—UI04 | 页面是否突然换壳、列宽跳动或滚动丢失 | 固定骨架稳定，叙事自然追加 |
| SP-033 | 打开 UI05、UI06，再进入 UI07 | 覆盖层、焦点、关闭和恢复位置是否符合预期 | 不迷路、不误以为进入新页面、不丢阅读位置 |
| SP-034 | 使用 UI08 四类谋划 | 视觉入口是否与实际行为一致 | 每个可见入口都能完成对应行为并看到结果 |
| SP-035 | 在 1366×768 与 1672×941 各玩一段 | 核心输入、提交、弹窗是否遮挡 | 无横向误滚、核心操作始终可见 |

### 6.7 模拟玩家分轮执行

模拟玩家测试至少分三轮，且与自动功能测试分开出报告：

1. 第一轮“可理解性”：5—8 名首次玩家，重点看身份、目标、决策、谋划、关键事件与因果理解；主持人不得提示操作答案。
2. 第二轮“完整可玩性”：至少 3 名玩家独立从首页玩到第 7 天结局，记录所有点击、停顿、刷新、错误、放弃点和重玩意愿。
3. 第三轮“视觉与修复复测”：针对前两轮高频误解和视觉 deviation，让新玩家重复关键路径，确认修复没有引入新困惑。
4. 若任一轮出现 P0 阻断、高频误点或一比一 material deviation，进入修复并重跑受影响轮次；不限制总轮数。
5. 同一玩家的学习效应必须标记；验证首次理解时优先使用未参与前轮的新玩家。

## 7. 模拟玩家记录指标

第一轮阈值来自用户试玩方案，不是行业事实，试玩后允许调整：

| 指标 | 继续优化阈值 | 强信号 |
|---|---:|---:|
| 选角→开局 | ≥70% | ≥85% |
| 到达第 3 天 | ≥65% | ≥80% |
| 第 3 天→结局 | ≥50% | ≥65% |
| 整局完成率 | ≥40% | ≥55% |
| 日终继续率 | ≥70% | ≥85% |
| 自定义决策使用率 | ≥15% | ≥30% |
| 至少使用 1 次主动谋划 | ≥50% | ≥70% |
| 平均每局谋划次数 | ≥3 | ≥6 |
| 正确区分主线/谋划 | ≥70% | ≥85% |
| 能说出一次谋划后续影响 | ≥50% | ≥70% |
| 因果理解得分 ≥8/12 | ≥60% | ≥75% |
| 愿意重玩 | ≥35% | ≥50% |

若单局超过 45 分钟且完成率低，优先调整文本密度、消息数量和节奏，不先增加新功能。

## 8. 模拟玩家判定规则

- 模拟玩家无法完成功能，不等同于功能代码失败；记录为体验缺口并进入产品修复。
- 功能测试通过、模拟玩家无法理解：不能判定产品体验完成。
- 模拟玩家完成但发现隐藏信息泄露：安全功能测试仍判失败。
- 只有功能测试、UI 视觉测试、模拟玩家测试、数据库读回和报告完整性全部具备证据，最终门禁才允许纯 `PASS`。

## 9. 必须生成的测试文档与报告

后续执行阶段必须分别生成，禁止合并成一句“全部通过”：

| 报告 | 必须内容 |
|---|---|
| 功能测试报告 | FT 总数、执行数、通过/失败/阻塞、命令、日志、API/DB 读回、缺陷与回归 |
| UI 一比一报告 | VT-001—VT-010 每轮 reference/actual/diff/metrics、deviation、修复前后、anti-cheat 结果 |
| 嘉靖财政局资产报告 | 18 张专属 PNG 的 manifest、SHA-256、尺寸、语义、页面使用位置、未使用原因和 fallback 记录 |
| 模拟玩家报告 | 每位玩家匿名 ID、场景、点击序列、停顿、误解、完成情况、问卷、访谈与指标 |
| 三玩家七轮报告 | 3 玩家、7 轮、21 动作、每轮 resolution、通知、AI task、隐私和 DB 读回 |
| 最终聚合报告 | 当前 RunId 下需求/UI/API/DB/AI/功能/模拟玩家/安全/报告完整性门禁 |

## 10. 最终退出规则

- 功能测试 P0 全部通过，但模拟玩家或视觉未通过：不得纯 PASS。
- 10 张 UI 任一张缺 actual/diff/metrics/summary：不得纯 PASS。
- 任一页面通过加载参考图本身实现像素一致：`HARD_FAIL`，必须改为真实 DOM/CSS 后重测。
- 视觉自动阈值通过但人工发现错图、错字、遮挡、不可点击或状态错误：`REPAIR_REQUIRED`。
- mock AI 通过但 live DeepSeek 未授权/未执行：明确记录 live limitation，不伪造。
- 所有修复必须重跑目标测试，并按影响面回归共享前端骨架、API 合同、数据库不变量和完整玩家路径。
