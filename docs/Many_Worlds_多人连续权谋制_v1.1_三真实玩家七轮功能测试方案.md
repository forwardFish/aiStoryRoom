# Many Worlds 多人连续权谋制 v1.1：三真实玩家七轮功能测试方案

## 0A. 2026-07-16 中国大陆内置 Browser 验收覆盖条款（用户确认）

由于 Chrome 扩展在中国大陆不可用，最终 D10/D11 真实用户验收改用 Codex 内置 Browser。三个玩家必须分别运行在三个可见标签页和三个独立 origin：`http://one.localhost:5218`、`http://two.localhost:5218`、`http://three.localhost:5218`。HttpOnly Cookie 必须为 host-only，三页账号、角色和私人投影相互隔离。

该覆盖只替换“3 个 headed Chrome 独立进程/user-data-dir”这一浏览器载体；注册、邮箱验证、登录、创建/加入房间、选角、Ready、Start、七轮 MAIN/MANEUVER/REACTION、掉线接管与玩家回归仍必须通过可见页面纯 UI 完成。禁止 Token/Cookie 注入、页面内 fetch、直接接口代替点击、DOM 事件注入或单页切换角色。三个标签页仍须逐页截图、检查控制台与网络错误，并由 Supabase 在事后独立读回。


> 文档状态：PLANNED，不代表测试已经执行  
> 编制日期：2026-07-15  
> 适用仓库：`D:\lyh\agent\agent-frame\aiStoryRoom`  
> 主验收世界：《桑田诏：嘉靖财政危局》  
> 开发基线：`docs/Many_Worlds_多人连续权谋制_v1.1_完整开发步骤与验收方案.md`  
> 核心目标：先用三个完全隔离的真实浏览器用户，只依据各自页面可见信息完成创建房间、加入、选角、Ready、Start、七轮决策/谋划/回应、自动结算和三个个人结局；再用独立 RunId 验证任一玩家退出后 Role Agent 不阻塞剩余玩家，以及本局已由真人完成全部必需授权/共享世界解锁后全员退出仍完整推演到结局。未解锁的全员退出局必须稳定暂停、禁止 Agent 花费，并在真人返回同一 Run 解锁后恢复。发现失败立即修复并使用新 RunId 重跑，直到全部门禁纯 `PASS`。

## 0. 不可替代原则

本测试最高门槛是“真实玩家页面体验”，不是 API 冒烟。

必须满足：

```text
Codex 内置 Browser 三个同时可见、可独立操作的标签页
三个不同 origin：`one.localhost:5218`、`two.localhost:5218`、`three.localhost:5218`
三个真实账号
三个不同角色
三个独立 HttpOnly session Cookie、非敏感 hint Cookie 与隔离的 localStorage/sessionStorage；不得注入 Bearer Token
所有游戏动作由可见 DOM 输入和点击完成
每个模拟玩家只读取自己的页面
数据库和 API readback 只作事后审计
```

禁止：

```text
一个页面切换三个账号或三个角色
直接 POST 主决策、谋划、回应、结算或推进接口
脚本替房主调用 Resolve
把数据库状态当成玩家已经看见的内容
统一 orchestrator 读取三份私密响应后替三个玩家做决定
只截房主页面或只验证最终计数
用 /room-game、/trio 或开发控制台代替正式 /game
headless 运行代替最终 MP/SP 证据
Runtime.evaluate 调用 HTMLElement.click()、事件注入或页面内 fetch 代替玩家操作
```

允许 CDP/Playwright 通过可见 locator/坐标点击、真实键盘输入、等待、截图、可访问性树、控制台和网络元数据采集。失败诊断可以 GET 当前玩家自己的投影，但诊断结果不能替代 UI 证据，也不能用于下一步角色决策。Headless 可用于 UT/IT/UI 低层回归，但无资格生成 MP/SP 的 PASS。

角色接管测试遵守另一条不可替代原则：“玩家离开”不等于“角色消失”。`LEAVE_STAGE` 只表示本阶段已布局完成，绝不启动 AI；只有明确 `HANDOFF_TO_AI` 或超过恢复期的持续断线才改变控制器。P0 不允许从 0 真人直接开局，“全员 AI”路线必须先由三个真实用户完成开房、选角、Ready 和 Start。

## 1. 测试分层

| 层级 | 目标 | 是否可替代三浏览器七轮 |
|---|---|---|
| UT | 状态机、Guard、Arbiter、Projector、去重和资产规则 | 否 |
| IT | HTTP、Auth、Supabase、Scheduler、Outbox、SSE | 否 |
| SEC | 对象权限、旧 API 绕过、公私投影、prompt 泄漏 | 否 |
| UI | 正式 `/game` 状态和 UI01—UI08 回归 | 否 |
| MP | 三浏览器七轮真实产品流 | 是最高功能门槛 |
| SP | 三个盲模拟玩家的理解、操控感和决策差异 | 是最高体验门槛 |
| TAKE | 玩家离开、Role Agent 接管、人类回归、已解锁全员托管到结局，以及未解锁暂停/同 Run 恢复 | 否，但是可完成整局且不越过支付边界的 P0 门槛 |
| FI | 超时、断线、房主离线、Worker/AI 故障 | 否，但必须全部通过 |

任何底层测试 PASS 都不能覆盖 MP/SP 失败。

## 2. 环境、账号和运行模式

### 2.1 服务

```text
Web：当前本地正式 Web 服务
API：当前 Nest API
Worker：独立进程优先；本地可同时验证 API 内 worker 兼容模式
Database：manifest 声明且命中非生产 allowlist 的 Supabase 验收项目与隔离 schema；禁止本地 PostgreSQL 16、Docker PostgreSQL、其他替代库及生产项目/schema
AI：现有 DeepSeek live；故障测试另用可控 provider/fault injection
```

三个本轮 `@example.test` 账号必须在创建房间/RunId 之前，通过既有受保护命令获得幂等、可审计的 BONUS 点数，fixture 回执单独留证。禁止伪造 PURCHASED 余额或发起真实付款；局中不得直接改 DB/API。全真人成功路线与 TAKE-008 的第 4 轮固定由 P1 通过正式页面完成一次共享世界解锁；房主已交托的 TAKE-007 则由仍在线的 P2 明确解锁，以证明授权不依赖房主。

执行前记录：

```text
source HEAD SHA
动态 baselineSourceFingerprint（包含 tracked diff 与 in-scope untracked 文件哈希）
dirty worktree 清单与保护声明
Web/API/唯一 Worker PID、端口与启动参数
脱敏 Supabase 验收库 fingerprint（provider/project/host/db/schema）
migration version
feature flags
window timing profile
唯一 attemptId 与按测试路线唯一的 RunId
```

#### 2.1.1 动态基线与 dirty 保护

A00 不绑定一条假定“干净”的固定提交，也不得为了测试执行 `git reset`、`git clean`、`git checkout --`、自动 stash 或覆盖用户文件。执行器必须在任何 build/migration/服务启动之前生成 `baseline-source.json`：

```text
headSha = git rev-parse HEAD
statusZ = git status --porcelain=v1 -z
trackedPatchSha256 = SHA-256(git diff --binary HEAD)
inScopeUntracked = git ls-files --others --exclude-standard 后逐文件记录 path/size/sha256
baselineSourceFingerprint = SHA-256(以上字段的稳定 UTF-8 canonical JSON)
```

source scope 包含本次会影响 API、Web、Prisma、脚本和两份 v1.1 合同的文件；只排除 `node_modules/`、声明过的构建目录、进程临时目录和当前 `docs/auto-execute/evidence/continuous-strategy/<attemptId>/`。被排除的构建产物仍必须另算 `buildArtifactSha256`。删除文件以 `DELETED` 条目参与哈希，不能因文件不存在而漏记。

dirty worktree 可以作为动态基线，但必须完整留证和原样保护。A01—A12 每个阶段开始前重新计算 source fingerprint；除 manifest 预先声明的 evidence/build/runtime 路径外，只要发生 source drift，当前 checkpoint 标记 `SOURCE_DRIFT`、本次最终 verdict 为 `FAIL`。修复代码后必须创建新的 `attemptId` 和新 RunId 重跑，不得把修复前后的证据拼成一次 PASS。

#### 2.1.2 A00 fail-closed 预检

预检必须按下表顺序执行；任一必需项未证明 READY 时，不得创建房间、写 BONUS、启动成功路线或沿用历史证据：

| 项目 | fail-closed 检查 | 不通过时 |
|---|---|---|
| Git/source | `baseline-source.json` 已落盘；dirty/in-scope untracked 全部有 path/sha256；证据目录未混入 source 哈希 | 本地脚本或哈希逻辑错误为 `FAIL`；无法读取用户拥有的源文件为 `EXTERNAL_BLOCKED` |
| Supabase 验收 schema | `SUPABASE_DATABASE_URL` 存在；provider/project/host/db/schema fingerprint 明确命中非生产 allowlist；TLS 远程连接、`prisma migrate status`（或沙箱受限时逐 migration 部署后的独立 `_prisma_migrations` 读回）和事务内临时写入后 rollback 均成功；migration 与代码一致；不得启动/连接本地 PostgreSQL 16 或 Docker PostgreSQL | 生产边界不明、Supabase 外部服务不可达或凭据缺失为 `EXTERNAL_BLOCKED`；migration 漏失/漂移为 `FAIL` |
| DeepSeek live | shell 中存在 `DEEPSEEK_API_KEY`，但不写磁盘；记录脱敏 base URL/model；`pnpm test:ai-live-v4` 对当前模型成功且没有 mock/fallback | key 缺失、配额或外部 provider 故障为 `EXTERNAL_BLOCKED`；代码解析/契约失败为 `FAIL` |
| 端口与标签页绑定 | manifest 先声明 Web/API 端口以及三个获准 origin；启动前端口无无关监听者，启动后 PID/监听端口与 manifest 一致；三个可见 tabId 分别绑定 `one/two/three.localhost`，健康检查命中本次 API 和本次 build | 可换空闲端口则换并重做预检；仍被外部进程/策略占用为 `EXTERNAL_BLOCKED`；错连旧服务、旧 tab 或错误 origin 为 `FAIL` |
| Worker 唯一性 | 主验收显式设置 `STORY_WORKER_EMBEDDED=false`，API 不取任务，且恰有一个独立 Worker PID；变量缺失或取值不是 `true`/`false` 时拒绝启动 | 双模式/零 Worker/错 PID 为 `FAIL`；双 worker 只允许在 IT-WORK-003/008 的独立 RunId 内临时启用并留证 |
| 内置 Browser | 三个 URL 已显式获准 Browse+CDP；同时打开三个可见标签页并分别命中 `one/two/three.localhost:5218`；记录各 tabId、origin、视口、DPR 和权限状态 | 浏览器或桌面环境不可用为 `EXTERNAL_BLOCKED`；退回 headless、复用同一 origin/session、错连旧 tab 或单页切角色为 `FAIL` |
| Email | `NODE_ENV` 非生产、`EMAIL_PROVIDER=file-sink`、`AUTH_MAIL_SINK_FILE` 指向本次 attemptId 的新文件；API readiness 明确返回 file-sink | 外部文件权限/磁盘不可用为 `EXTERNAL_BLOCKED`；错误 provider、复用旧 sink 或生产 fallback 为 `FAIL` |

主验收只使用“独立 Worker”模式。`STORY_WORKER_EMBEDDED=true` 仅在单独兼容性 RunId 验证一次，运行该用例时不得再启动独立 Worker；竞争测试结束后必须回到唯一 Worker 预检并证明没有遗留租约持有者。

A00 的 feature flag 检查只证明配置 schema、默认关闭、显式取值和启动日志可用，不代表 D11 最终收口已经完成。`MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED` 与持久 `StoryRun.engineVersion/strategyVersion` 路由必须在 D02 创建任何房间 Run 前可用；版本在 `POST /rooms` 创建 StoryRun 时冻结，Start 不得改写。D11 只负责关闭 flag 并重启后，既有 waiting/started Run 仍按冻结版本完成、新 Run 回 legacy，以及同版本内容 hash 漂移 fail-fast 的最终回归。若实现仍要等 D11 才具备基础门控，A00/A02 必须 fail-closed。

429 必须按来源分类：本应用 heartbeat/auth/SSE/API 的 429、错误重试风暴和代码未退避一律是预期专项断言或 `FAIL`，绝不能记外部阻塞；只有 DeepSeek 上游明确返回 quota/rate-limit 429，且证据含 provider requestId、脱敏响应头、当前模型和有界重试，才允许 `EXTERNAL_BLOCKED:DEEPSEEK_QUOTA`。错误 key/model/base URL、响应解析、fallback 或本地 fault injection 产生的 429 均为 `FAIL`。

### 2.2 三种计时配置

| 配置 | MAIN | Grace | 用途 |
|---|---:|---:|---|
| `manual-three-page` | 1200 秒 | 900 秒 | 用户自己依次逐屏阅读、截图并操作三个页面、谋划和回应；仅用于验收 |
| `automated-happy-path` | 60 秒 | 30 秒 | 自动七轮成功路线，足够创建和完成 REACTION |
| `automated-timeout` | 15 秒 | 8 秒 | 只测超时、默认结果和自动推进，不断言 REACTION |

正式默认 180/45 秒另做合同测试。每份 `GameProjection` 必须有 `serverNow`，并在刷新/SSE 重连后重新校准倒计时。测试不得通过修改浏览器时间绕过服务端权威截止时间。

角色接管计时单独配置，不与 MAIN/Grace 截止时间混用：

| 配置 | heartbeat | server min write interval | 进入 offline grace | 自动托管 | AI 决策 SLA | AI-only grace |
|---|---:|---:|---:|---:|---:|---:|
| 生产合同 | 15 秒 | 5 秒 | 45 秒无心跳 | 60 秒无心跳 | 槽位开放后 ≤ 5 秒 | 3 秒 |
| 自动 TAKE/FI | 1 秒 | 250 ms | 3 秒无心跳 | 8 秒无心跳 | 槽位开放后 ≤ 5 秒 | 3 秒 |

短断线、显式交托、断线自动托管必须使用不同用例；不得用缩短了的 TAKE/FI 数值假装证明生产阈值。

`AI-only grace=3 秒` 是全部当前 Agent MANEUVER/REACTION 决定进入 `SEALED_ACT | SEALED_FALLBACK | PASS | STALE | NO_OP`、对应 Outbox 均 `status=COMPLETED` 后的静默期，`FAILED`/待重试不计队列清空；它不是从 Grace 打开立即开始的硬截止。静默期内出现新可执行请求必须重置，避免 Agent 的 5 秒 SLA 反而被 3 秒收束截断。若到权威 `graceClosesAt` 仍未清空，必须先用同一事务 fencing 旧租约、经 Guard 密封确定性 fallback、将 RoleAgentDecision 转为 `SEALED_FALLBACK/PASS/STALE/NO_OP`、将 Outbox 转为 `status=COMPLETED` 与对应 outcome，并确认 decision 无 FAILED/PENDING、Outbox 无 FAILED/PENDING/RUNNING，再 CAS 关闭窗口；不得直接忽略 FAILED。

### 2.3 三个浏览器用户

| 玩家 | 角色 | 独立策略 | 决策边界 |
|---|---|---|---|
| P1 | 浙江总督 | 稳局、留证、设程序、控制责任叙事 | 不知道巡抚幕后往来，不替县令交证据 |
| P2 | 浙江巡抚 | 推进改桑、争政绩、抢先奏报 | 不知道县令全部证据渠道，不替总督裁决 |
| P3 | 清流县令 | 保民、保存田契、建立可核验证据链 | 权力较低，不直接命令督抚或皇帝 |

每次决策必须记录：

```text
visibleBasis：当前页面实际可见的依据
chosenAction：选择的行动卡/目标/筹码/补充
playerReason：一句角色内理由
forbiddenKnowledgeCheck：确认没有使用其他浏览器秘密
```

### 2.4 三账号注册、file-sink 验证与 Cookie session

三个账号使用 `attemptId` 生成唯一邮箱，不能复用旧账号的现成 session。每个账号必须在自己 origin 的可见标签页中完成下列可见流程：

```text
打开 /auth → 输入邮箱/密码并提交注册
→ 等待当前 AUTH_MAIL_SINK_FILE 中出现 to=该邮箱、idempotencyKey=本次注册且正文含验证 URL 的唯一新记录
→ harness 只提取该记录的 verification URL，不调用验证 API、不改 DB
→ 在该账号自己的内置 Browser 可见标签页中导航到 verification URL
→ 页面显示验证成功，再通过登录表单登录
→ GET /api/user/me 由同源 Cookie session 识别为该账号
```

file-sink 读取器必须以 `attemptId + email + providerId/idempotencyKey` 过滤，只读本轮新增行，不能把 token 写入截图、console、network transcript、manifest 或模拟玩家上下文。验证链接只能通过浏览器导航消费，禁止 page-context `fetch`、直接 POST verify、写 localStorage Token 或手工注入 Cookie。

登录后权威凭证是 `many_worlds_session` HttpOnly Cookie；`many_worlds_session_hint` 只可作为非敏感 UI 提示，不能决定授权。三浏览器分别断言 Cookie jar 隔离、`/user/me` userId 不同、退出一个账号不会影响另两个。Cookie 的值只记录“存在/HttpOnly/SameSite/作用域”元数据，不落明文。完成三账号验证和登录后，才允许执行 2.1 节定义的开局前 BONUS fixture；fixture 仍必须早于任何房间/RunId 创建。

## 3. 测试证据目录

每次完整执行创建唯一目录：

```text
docs/auto-execute/evidence/continuous-strategy/<attempt-id>/
  acceptance-manifest.json
  acceptance-manifest.sha256
  baseline-source.json
  preflight.json
  environment.json
  accounts-redacted.json
  lobby/
  round-01/ ... round-07/
  takeover/
    control-transitions.json
    role-agent-input-audit.json
    role-agent-actions.json
    reclaim-evidence/
  final/
  api-transcript/
  event-stream/
  database-readback.json
  ai-task-audit.json
  console-errors.json
  network-status.json
  privacy-audit.json
  timing-metrics.json
  simulated-player-report.json
  summary.json
```

每轮目录至少包含：

```text
p1-before-main.png / visible-state.json / decision.json
p1-after-main.png
p1-after-maneuver-or-reaction.png
p1-personal-result.png
p2-* 同组证据
p3-* 同组证据
timeline.json
privacy-matrix.json
public-result.json
```

`visible-state.json` 必须来自当前玩家 DOM/可访问性树；不得直接把完整 API 响应保存成“玩家可见证据”。网络正文可在安全审计目录脱敏保存，但不传给模拟玩家。

### 3.1 acceptance-manifest 选择边界

每次执行只有一个权威 `acceptance-manifest.json`。它至少包含：

```text
schemaVersion, goalId, attemptId, startedAt, finishedAt, verdict
source.branch, source.headSha, source.baselineSourceFingerprint, source.planHash, source.pairedTestPlanHash, source.buildArtifactSha256, source.configFingerprint, source.strategyRegistryHash, source.strategyArtifactHashes
database.provider=supabase, database.projectRefRedacted, database.schema, database.nonProductionAllowlistMatched=true, database.schemaHash, database.migrationDirectoryHash, database.databaseFingerprintRedacted, database.appliedMigrations[]
services[]: kind/pid/port/executableHash/startedAt
browsers[]: player/tabId/origin/viewport/devicePixelRatio/browserRuntimeVersion/permissionSnapshot/visible
routes[]: laneId/runId/accountIdsRedacted/timingProfile/faultProfile
artifacts[]: relativePath/laneId/runId|attemptId/sha256/bytes/createdAt
requiredCheckpointIds: [D00,D01,D02,D02A,D03,D04,D05,D06,D07,D08,D09,D10,D11]
checkpoints[]: checkpointId/status/startedAt/finishedAt/evidenceArtifactPaths
externalBlockers[], gates
```

`requiredCheckpointIds` 是固定的 13 项集合，聚合器在任何 verdict 下都必须断言它与 `checkpoints[].checkpointId` 完全相等；缺失、多余、重复、`SKIPPED`、空状态或用 D02 代替 D02A 均为 `FAIL/CHECKPOINT_SET_MISMATCH`。仅当 `verdict=PASS` 时要求 13 项全部 `status=PASS`。合法 `EXTERNAL_BLOCKED` 允许命中外部依赖的 checkpoint 为 EXTERNAL_BLOCKED、仅因该依赖未执行的下游为 NOT_STARTED，但必须逐项关联 `externalBlockers[]`，且代码 FAIL、SOURCE_DRIFT、NEEDS_USER_COORDINATION 均为 0。

manifest 不允许顶层 `status`。执行中必须是 `finishedAt=null, verdict=null`；终态必须是 `finishedAt!=null, verdict=PASS|FAIL|EXTERNAL_BLOCKED`，任何其他组合都为 `FAIL/MANIFEST_LIFECYCLE_INVALID`。

环境、邮箱验证和开局前 BONUS 证据尚无 room RunId 时，以 `attemptId` 归属；房间创建后必须在同一 manifest 中一次性绑定 laneId→RunId，绑定后不可改写。每个成功、接管、故障和兼容性路线使用不同 RunId，严禁用“最新一局”或时间范围猜测归属。

聚合器必须由命令行接收本次 manifest 的绝对路径，只读取 `routes[]` 明确列出的当前 RunId 和 `artifacts[]` 明确列出的路径；禁止 glob 整个 evidence 目录、读取 `latest`、搜索历史 PASS 或用旧 RunId 补当前缺项。读取前逐项重算 SHA-256；哈希不符、manifest 外证据、缺失证据、重复相对路径、artifact 内嵌 RunId 与 manifest 不一致均为 `FAIL/EVIDENCE_SCOPE_MISMATCH`。

旧执行目录保持只读历史，不复制进新目录。完成后先冻结 artifact index，再生成 canonical `acceptance-manifest.json` 和旁路 `acceptance-manifest.sha256`；最终报告必须同时写明 manifest hash 和每条 lane 的 RunId。任何修复或 source drift 都创建新 attemptId，旧 manifest 永不改成 PASS。

## 4. 单元测试矩阵

| ID | 测试 | 通过条件 |
|---|---|---|
| UT-CONTENT-001 | 内容包数量 | 7 stage、21 role-stage、63 张 MAIN 卡且 63 份 receipt/effect 与 actionKey 1:1、21 MANEUVER 策略、3 固定 REACTION、7 system policy、21 Agent policy、7 公共/21 个人阶段结果和 1+3 终局规则全部存在；各集合缺失/重复均为 0 |
| UT-LOBBY-001 | 角色/玩家生命周期 | POST /rooms 原子创建 StoryRun+4 StoryRole；三次 join/claim 得到 3 个唯一 StoryPlayer；Start 不新增/替换 role/player，只创建 4 RoleControl、首窗和三份 opening projection |
| UT-CONTENT-002 | 内容键引用 | action/fact/asset/target/next/fallback/system key 全部唯一且可解析；孤儿、循环 fallback、跨角色私密引用为 0 |
| UT-CONTENT-003 | 无 AI 演算 | 关闭 DeepSeek 后，内容包仍能确定性演算七阶段规则、资产、影响边和所有 fallback；LLM 不补造状态键 |
| UT-CONTENT-004 | 版本冻结/不可变包 | Run 把 manifest contentVersion 冻结为 `strategyVersion=sangtian_v1_1`；同版本任一字节/hash 改动使 loader fail-fast。新内容只能用新 strategyVersion+registry entry+migration 注册，default 指针只影响新 Run，旧 Run 仍读旧版本 |
| UT-VERSION-001 | 引擎/策略组合 | 只接受 `legacy_v1/legacy_v1` 与 `continuous_strategy_v1_1/sangtian_v1_1`；POST /rooms 创建 Run 时冻结，Start 不改写，未知组合 fail-closed |
| UT-WIN-001 | `PREPARING → MAIN_OPEN` | 只创建一个窗口，时间和配置有效 |
| UT-WIN-002 | 全员 MAIN 完成 | 进入 `INTERACTION_GRACE`，不能跳过 grace |
| UT-WIN-003 | MAIN 超时 | 只为未提交角色创建一个最小维持行动 |
| UT-WIN-004 | 三人 DONE | grace 最短时间后才允许 CLOSING |
| UT-WIN-005 | 双 scheduler | 只有一个 CAS 成功进入 CLOSING |
| UT-WIN-006 | 窗口关闭后提交 | 稳定返回 `WINDOW_CLOSED`，不落 action |
| UT-WIN-007 | participant 独立状态 | 三角色 mainStatus/maneuverStatus/reactionStatus/doneAt 分行并发更新，不覆盖 |
| UT-WIN-008 | CLOSING 原子收口 | 所有 OPEN 请求过期、默认结果落库、之后 REACTION 被拒绝 |
| UT-WIN-009 | 全 AI 静默期 | 当前 Agent 队列清空后才开始 3 秒；期间新请求重置；队列再清空后只有一个 CLOSING |
| UT-WIN-010 | 槽位终态恢复 | Worker 重启后仅凭 participant 持久状态即可区分 MANEUVER SUBMITTED/PASSED/EXPIRED 和 REACTION NOT_OPEN/PENDING/RESPONDED/FALLBACK/EXPIRED，不重复排队 |
| UT-WIN-011 | 终端 checkpoint 分支 | R1—R6 写 `NEXT_WINDOW_OPENED`，R7 只写 `RUN_COMPLETED`；每个 workflow 恰七个 checkpoint，Window 8 永远为 0 |
| UT-WIN-012 | 全 AI 硬截止原子 fallback | graceClosesAt 时 fencing 租约、fallback/PASS、Decision 业务终态、Outbox COMPLETED+outcome 和 CLOSING 同一 closingVersion；失败回滚，成功后 Decision 无 FAILED/PENDING、Outbox 无 FAILED/PENDING/RUNNING、旧 Worker 写入=0 |
| UT-ACT-001 | MAIN 幂等重试 | 返回同一 action，不新增第二条 |
| UT-ACT-002 | 每槽额度 | 同角色第二条 MAIN/MANEUVER/REACTION 被拒绝 |
| UT-ACT-003 | 角色归属 | 用户不能替其他角色行动 |
| UT-ACT-004 | 三 MAIN 并发 | 其他玩家的提交不使自己槽位版本失效，三条都成功 |
| UT-ACT-005 | 截止时 HUMAN/AI/fallback 三方竞争 | 三方都使用同一 MAIN 逻辑槽唯一约束，只有一条 action；败者为 `SLOT_SEALED`/stale/no-op，无双扣资产 |
| UT-SYS-001 | 江南商会 worldActor | 不创建 StoryRole/StoryPlayer/RoleControl/participant，不可 claim/Ready/DONE，不计超时 |
| UT-SYS-002 | 系统行动 | 每阶段确定性且仅一条 SYSTEM_ACTION，重试不重复 |
| UT-CTRL-001 | 控制状态机 | 只允许定义的合法转换；人类⇄AI 权威交接时 epoch 严格递增，presence-only 和已 fenced 的 pending-to-active 保持原 epoch |
| UT-CTRL-002 | 短断线恢复 | 恢复期内重连回 `HUMAN_ACTIVE`，不 enqueue Agent task，不改行动 |
| UT-CTRL-003 | `LEAVE_STAGE` | 仅记录阶段完成，不改 RoleControl，不启动 AI |
| UT-CTRL-004 | 显式交托 | CAS+transition 同事务；仅当前有开放未终态槽时同事务写 Agent outbox，结算态 outbox=0；重试不产生第二个 transition/task |
| UT-CTRL-005 | 人/AI 同槽位竞争 | epoch fencing 和槽位唯一约束保证只有一个密封行动 |
| UT-CTRL-006 | 返回接管 | AI 未密封时立即取回；已密封时保留原 action，从下一安全槽位生效 |
| UT-CTRL-007 | R7 最终化接管 | R7 CLOSING/RESOLVING/PROJECTING 的 reclaim 返回 `FINALIZING` 且不创建 pending/任务/Window 8；发布后返回 `RUN_COMPLETED` 并可查看结果 |
| UT-AGENT-001 | Agent 输入投影 | 只含本角色 brief/goals/facts/assets/traces/cards，不含他人秘密和裁决器内部状态 |
| UT-AGENT-002 | 同轮多 Agent | 共用同一 `openingSnapshotVersion`，不因任务完成顺序看到同轮其他 AI 决策 |
| UT-AGENT-003 | 结构化行动 | action 经与真人相同的 Guard/资产/Arbiter，Agent 不能自行宣告结果 |
| UT-AGENT-004 | provider 失败 | 4500ms 是整个决策的 provider 总预算；快速非法响应在剩余预算允许时 repair 一次，超时/预算耗尽或 repair 失败后使用该角色确定性 fallback，不死锁、不重复 |
| UT-AGENT-005 | Credits 边界 | Role Agent 无支付、解锁、同意条款或修改余额能力 |
| UT-AGENT-006 | 槽位终态 | MAIN 只允许 ACT/FALLBACK；可选 MANEUVER 可 PASS；强制 REACTION 不能 PASS；PASS 只写审计/槽位终态，不伪造 action |
| UT-AGENT-007 | 跨局记忆隔离 | provider 请求无状态，历史/缓存键包含 runId/roleId/policyVersion/snapshotVersion，同 roleKey 不读另一房间事实 |
| UT-AGENT-008 | Policy/Decision JSON Schema | `role_agent_policy_v1` 与 `role_agent_decision_v1` 拒绝额外字段、未知 key/target/fact、错误 taskDedupeKey 及 MAIN/REACTION PASS；一次 repair 后使用服务端 fallback，原始响应/隐藏推理不落库 |
| UT-AGENT-009 | 三角色 provider 并发 | 同批最多三个 `ROLE_AGENT_DECISION` 的 provider 等待重叠执行；非 Agent/结算任务仍单个处理，三个角色均在 5 秒内密封合法 action 或 fallback，完成顺序不改变 opening snapshot 与裁决结果 |
| UT-AGENT-010 | 初始 AI 补位 | 1/2/3 真人开局分别原子生成 2/1/0 个 AI StoryPlayer，三个可玩角色始终恰有三个 RoleControl；真人为 HUMAN_ACTIVE、空缺为 AI_ACTIVE/INITIAL_AI_AGENT，江南商会仍无 RoleControl |
| UT-GUARD-001 | 时代越界 | 互联网、卫星、现代武器被拒并给时代内改写 |
| UT-GUARD-002 | 控制他人 | “命令县令交原件且已交出”被拒或改为请求 |
| UT-GUARD-003 | 宣布结果 | “皇帝必然采信”被拒 |
| UT-GUARD-004 | 合法高风险 | 越级弹劾、销毁自己证据被接受并计算代价 |
| UT-GUARD-005 | 未知事实 | 逐字使用别人的私密事实被拒 |
| UT-ASSET-001 | 唯一原件 | 并发转移只允许一个成功 |
| UT-ASSET-002 | 资产重试 | Worker 重试不重复扣数量或转移 |
| UT-REQ-001 | 多请求同目标 | 只产生一个强制回应槽，其余降级为压力 |
| UT-REQ-002 | 末秒请求 | 距 grace 结束不足 20 秒不新建强制回应 |
| UT-REQ-003 | 回应超时 | 执行保持现状，不替玩家交出/公开/背叛 |
| UT-REQ-004 | DONE 与待回应 | AVAILABLE MANEUVER 可在 DONE 事务转 PASSED；PENDING REACTION 时 DONE 稳定返回 `REACTION_REQUIRED`，不提前收束 |
| UT-ARB-001 | MAIN 同时性 | 网络到达顺序不改变规则结算结果 |
| UT-PROJ-001 | PRIVATE | 只有行动者投影包含完整行动 |
| UT-PROJ-002 | LIMITED | 只有来源和目标含完整交涉 |
| UT-PROJ-003 | OBSERVABLE | 其他角色只有痕迹，不含 method/intent |
| UT-PROJ-004 | PUBLIC | 三名玩家公共事实一致 |
| UT-PROJ-005 | Writer 输入 | 每个 Writer 输入不包含目标角色无权知道的字段 |
| UT-PROJ-006 | HUMAN + AI 混合 MAIN | 未密封 HUMAN 页面与 AI MAIN 都只读同一 opening snapshot，不看同轮已密封 HUMAN/AI action 或缓存痕迹 |
| UT-PROJ-007 | MAIN 前到达的请求 | InteractionRequest 可持久为 PENDING，但目标 MAIN 终态前不投递 UI/不 enqueue Agent REACTION；MAIN 后恰一次释放 |
| UT-DEDUP-001 | 投影重试 | 同一 dedupeKey 只生成一个最终条目 |

## 5. API、数据库和事件流测试矩阵

### 5.1 命令与权限

| ID | 场景 | 通过条件 |
|---|---|---|
| IT-API-001 | 三账号读取同一 `GET game` | 公共状态相容，私人简报/行动卡不同；三份投影的 run 均含相同且冻结的 engineVersion/strategyVersion |
| IT-API-002 | 非成员读取房间 | 403 或 404，不泄露存在性和内容 |
| IT-API-003 | P1 使用 P2 roleId | 403，无落库 |
| IT-API-004 | 旧接口 deny-matrix | 下表的所有敏感路由逐一通过，不能绕过投影 |
| IT-API-005 | 并发三 MAIN | 三条分别落库，不覆盖 |
| IT-API-006 | 双击同 idempotencyKey | 一条 action、同一响应语义 |
| IT-API-007 | 同角色不同 key 重复 MAIN | 409 明确冲突，不能覆盖密封行动 |
| IT-API-008 | 已迁移 windowId | 409 `WINDOW_MOVED`，返回可刷新投影，不静默覆盖 |
| IT-API-009 | 房主调用旧 Resolve | 普通玩家不可用；自动流程不依赖它 |
| IT-API-010 | 江南商会 claim | 新旧选角入口都拒绝，不创建 StoryPlayer/participant/Ready 状态 |
| IT-API-011 | 心跳/短断线 | 只影响当前成员的 presence；3 秒内恢复不产生 AI action |
| IT-API-012 | `handoff-to-ai` 重试 | 只有原 StoryPlayer 可调，重试返回同一 transition/epoch；若首请求因开放槽创建 task，则返回同一 task，否则在结算态持续为 task=0 |
| IT-API-013 | `reclaim` 归属 | 只有原 StoryPlayer 可取回，非所有者和另一房间成员均 403/404 |
| IT-API-014 | stale control epoch | 旧标签页、已交托人类和旧 Agent task 稳定返回/no-op `ROLE_CONTROL_CHANGED`，不落库 |
| IT-API-015 | Agent 内部命令 | 浏览器无法伪造 `actorKind=AI_TAKEOVER`，内部命令也必须通过角色、epoch、window 和 slot 检查 |
| IT-API-016 | 开局后旧 leave-room 入口 | 不删除 RoomMember/StoryPlayer/角色；未明确确认则拒绝，确认后与 handoff 同一幂等事务语义 |
| IT-API-017 | Cookie session 主体 | heartbeat/handoff/reclaim/leave-stage 不接受 hint Cookie、localStorage Token 或他人 Cookie；只接受当前 HttpOnly session 对应成员 |
| IT-API-018 | 心跳限流 | 正常 cadence 成功；同 session 在 min write interval 内突发请求返回 429 `HEARTBEAT_RATE_LIMITED` + `Retry-After`，不新增 transition/Agent task、不滚动延长接管阈值 |
| IT-API-019 | Run 版本冻结 | flag=true 时 POST /rooms 创建连续权谋 Run 即原子写入 `engineVersion=continuous_strategy_v1_1, strategyVersion=sangtian_v1_1`；等待大厅期间关闭 flag并重启后 Start 不改旧 Run，新建房为 legacy；篡改同版本 fixture hash 启动失败 |

#### 5.1.1 心跳与控制端点主体矩阵

`heartbeat/handoff-to-ai/reclaim/leave-stage` 和开局后的 room leave 必须用下列全部主体逐一执行，不能只测原玩家正向路径：

| 主体/状态 | heartbeat | HANDOFF | RECLAIM | LEAVE_STAGE/开局后 leave |
|---|---|---|---|---|
| 匿名 | 401 | 401 | 401 | 401 |
| 非成员 | 403/404 | 403/404 | 403/404 | 403/404 |
| 房内另一成员 | 只能更新自己 presence，不能传 roleId 写他人 | 403 | 403 | 403 |
| 原 StoryPlayer + `HUMAN_ACTIVE` | 成功，不改 epoch | 成功/幂等重试 | 稳定 409，因尚无 AI 控制 | 当前窗口更新；room leave 需明确确认并转 handoff |
| 原 StoryPlayer 的旧 tab + `AI_ACTIVE` | 只更新 presence，绝不自动 reclaim/改 epoch | 409 `ROLE_CONTROL_CHANGED` 或原幂等结果 | 携当前 expected epoch 才可请求 | 409，不覆盖 AI/不删角色 |
| SYSTEM 角色 | 无成员身份可调 | 403/404 | 403/404 | 403/404 |
| 已完成 Run | 可返回已完成存在性但不改控制状态 | 409 `RUN_COMPLETED` | 409 `RUN_COMPLETED` | 409 `RUN_COMPLETED` |

每个拒绝用例都要读回 RoleControl mode/epoch、transition、participant、Agent task 和 PlayerAction，证明全部无副作用。

心跳限流值必须由当前 timing profile 明确注入并写入 environment/manifest，浏览器按服务端公开的 `heartbeatIntervalMs` 发送。限流专项在一个 min write interval 内并发突发 20 次后，除第一条满足间隔的更新外，其余全部为 429，数据库 `lastSeenAt` 的有效写入数不超过 1；随后等待 `Retry-After`，下一次心跳成功。429 属于预期专项断言，不得导致登出、SSE 重连风暴、控制 epoch 变化或误接管。

#### 5.1.2 旧入口 deny-matrix

每类路由必须用匿名、非成员、当前角色成员、房内另一成员四种主体发起请求；admin 行再增加合法管理员主体。不允许用一个“旧 API 已关闭”冒烟测试代替：

| 类别 | 必测路由 | 通过条件 |
|---|---|---|
| 明确公开 | `/`、`health/live/ready`、`auth/wechat-login`、`world-templates[/templateId]` | 仅返回非私密能力，不因传入对象 ID 读敏感数据 |
| 身份/用户私有 | `user/me`、`user/agree-policy`、`my/story-runs`、`notifications`、`feedback/report` | 必须 AuthGuard，只读/写调用者，无默认 mock openid 降级 |
| 直接创建 | `POST v4/story-runs`、`POST story-runs` | 仅能创建调用者 SOLO run，不能绑定/冒充 Room run |
| 旧加入/选角 | `story-runs/:runId/join`、`roles/:roleId/claim` | 对 Room run 关闭或等价经过 Rooms ACL；江南商会必定拒绝 |
| run/state/roles | `story-runs/:runId`、`state`、`roles`、`my-role`、`current-node`、`nodes` | 未授权主体 401/403/404；成员不得得到他人私密 |
| node/actions | `nodes/:nodeId`、`GET/POST actions` | 不泄漏 method/intent，不可绕过槽位、幂等与截止时间 |
| resolve/AI fill | `ai-fill-missing-actions`、`resolve`、`resolution`、`start`、`pause` | 普通成员不能推进；结果按角色 ACL |
| narrative | `narrative-segments`、`generate-chapter`、`chapters/:chapterId`、`share`、`insights` | 房间归属和投影 ACL 生效 |
| v4 direct | `GET v4/story-runs/:runId`、`messages`、`dashboard`、`POST decisions/respond/defer/maneuvers/advance-day/finalize` | 房间 runId 不能借单人路由绕过 |
| admin | `admin/dashboard`、`admin/story-runs[/runId]`、`admin/roles`、`admin/actions`、`admin/resolutions`、`admin/ai-tasks`、`admin/audit-logs`、`admin/event-logs`、`admin/action-guard` | 只有 AdminGuard 主体可用且写审计；其他三类全拒绝 |

每个拒绝结果同时扫描 body、header、错误差异和服务端日志，对象是否存在也不得被侧信道泄漏。

### 5.2 Scheduler、Outbox 和恢复

| ID | 场景 | 通过条件 |
|---|---|---|
| IT-WORK-001 | 全员完成 | 自动 enqueue 一条 resolve task |
| IT-WORK-002 | MAIN 超时 | 最小维持行为 + 自动 enqueue |
| IT-WORK-003 | 双 worker 竞争 | 只有一个租约和一个权威结算 |
| IT-WORK-004 | Resolution 后杀 Worker | 重启补齐缺失投影/发布；R1—R6 补下一窗口，R7 补 `RUN_COMPLETED` 且不创建 Window 8 |
| IT-WORK-005 | Writer timeout | retry/repair；再失败 fallback，窗口不死锁 |
| IT-WORK-006 | 发布后重试 | 不重复 NarrativeEntry、事件、通知和资产 mutation |
| IT-WORK-007 | 交托事务后 Worker 退出 | CAS+transition 必同在；若有开放槽则 outbox 同事务且重启只执行一次，若为结算态则 outbox=0、R1—R6 下一窗才入队、R7 直接完成 |
| IT-WORK-008 | 两个 Agent worker 竞争 | `AI_TAKEOVER:<windowId>:<roleId>:<slot>:<epoch>` 只有一个租约和一条 action |
| IT-WORK-009 | 回归与在途 Agent task | reclaim 成功后旧 epoch 任务即使已调用 provider 也不落库 |
| IT-WORK-010 | 全员 AI 且无 SSE | 已由真人解锁或模板无需解锁时，scheduler/worker 独立完成后续槽位、结算、投影和第 7 轮结局；未解锁时稳定暂停且无 Credits 写入 |
| IT-WORK-011 | Worker 模式唯一开关 | `STORY_WORKER_EMBEDDED=false` 时只有独立 Worker 取租约；`true` 时只有 API 内 worker 取租约；缺失/非法值或两种模式同时活跃均启动失败 |
| IT-WORK-012 | 竞争专项清场 | IT-WORK-003/008 临时第二 Worker 仅处理该独立 RunId；结束后二者关闭并等待租约释放，再以新 RunId 重过唯一 Worker 预检 |

### 5.3 SSE 与补偿

| ID | 场景 | 通过条件 |
|---|---|---|
| IT-SSE-001 | 三成员建立 fetch-stream | 三个独立 HttpOnly Cookie session 通过同源 `credentials: include` 建流；请求无 Authorization Header；匿名/过期 session 为 401，非成员为 403/404 |
| IT-SSE-002 | 每成员连续 60 个投递 | 分页补拉完整，该成员 deliverySequence 稠密不缺 |
| IT-SSE-003 | 同时多事件 | 每成员 deliverySequence 唯一递增，不依赖 createdAt |
| IT-SSE-004 | 断线期间产生四级事件 | 重连后不丢、不重、不乱序 |
| IT-SSE-005 | 客户端收到重复事件 | lastAppliedDeliverySequence 幂等忽略 |
| IT-SSE-006 | 发现 deliverySequence 缺口 | 自动 GET afterDeliverySequence 补齐；全局 StoryEvent 隐私跳号不触发补拉 |
| IT-SSE-007 | 事件延迟 | 本地 P95 ≤ 3 秒 |
| IT-SSE-008 | PRIVATE 夹在 PUBLIC 之间 | 未授权成员仅看到自己稠密投递，无无限重连/补拉 |
| IT-SSE-009 | 控制权变更 | 自己收到精确 reclaim 详情；他人只收到玩家/AI 公开标记，不泄露心跳和私密原因 |
| IT-SSE-010 | cursor 账号/房间隔离 | cursor key 至少包含 roomId + membershipId/userId；退出登录、切账号、切房间后不得复用另一主体的 lastAppliedDeliverySequence |
| IT-SSE-011 | 失败鉴权收束 | 401/403/404 后停止自动重连并显示登录/无权限/不存在状态；不得降级轮询公开或单人接口，不产生重连风暴 |
| IT-SSE-012 | 投影乱序/覆盖倒退 | 服务端同成员 revision 增长时 appliedThrough 单调不降，同 revision payload/hash 相同；客户端丢弃低 revision，也拒绝“更高 revision 但 appliedThrough < 本地 cursor”的投影并补拉/重取，合法应用后才持久化 cursor |

补偿 GET 必须返回 `{ deliveries, nextAfterDeliverySequence, hasMore }` 并循环拉到 `hasMore=false`，不能因默认 page size 小于 60 而截断。fetch-stream/SSE 和补偿 GET 都由浏览器自然携带同源 Cookie；测试不得把 HttpOnly Cookie 读进 JS 再拼 Authorization Header。断线游标只在事件已成功应用或已刷新到覆盖该事件的 projection 后提交；解析失败、渲染失败和网络失败均保留旧 cursor 重试。

### 5.4 DB 独立读回

成功路线必须断言：

```text
StoryRun = 1
StoryRun engineVersion/strategyVersion = continuous_strategy_v1_1/sangtian_v1_1
StoryRole = 3（仅三个可玩角色）
human StoryPlayer = 3
unique human roles = 3
world actors = 1（江南商会，不创建 StoryRole、不可 claim）
ActionWindow = 7，全部 RESOLVED，每节点 1 个
ActionWindowOpeningProjection = 21（每窗口 3 角色，同窗口 snapshotVersion 相同）
ActionWindowParticipant = 21（每窗口三个可玩角色，与当前 HUMAN/AI 控制器无关）
RoleControl = 3（三个 HUMAN_ACTIVE；worldActor 无控制权行）
RoleControlTransition = 0（全真人成功路线）
human MAIN = 21
human MANEUVER = 21（本核心测试规定三人每轮都执行一次）
SYSTEM_ACTION = 7
REACTION = 3（R2:P3、R4:P1、R5:P2）
MAIN actorKind=TIMEOUT_FALLBACK = 0（成功路线）
DirectorResolution = 7
ResolutionWorkflow = 7，全部 COMPLETED
ResolutionCheckpoint = 49；NEXT_WINDOW_OPENED = 6，RUN_COMPLETED = 1
public results = 7
private briefs = 21
personal results = 21
public narrative logical tasks = 7
private narrative logical tasks = 21
final global ending = 1
personal endings = 3
duplicate action/resolution/projection/asset mutation = 0
privacy violations = 0
outbox pending/running/failed = 0
test credit grants = 3，重复 grant = 0
WORLD_UNLOCK spend = 1，重复扣点 = 0
WORLD_UNLOCK payerUserId = P1 且 roomId/runId = 本证据 RunId
```

还必须在 migration 专项 RunId 之外读回一个旧单人局和一个旧多人历史房：二者均为 `engineVersion/strategyVersion=legacy_v1/legacy_v1`，旧 `PlayerAction` 全部为 `actionSlot=MAIN`、`idempotencyKey=legacy:<id>`，新旧唯一约束切换后无丢行、无孤儿 relation、无重复键。

超时、接管和故障路线使用单独 RunId，不污染成功路线 21 MAIN 计数。每个接管 RunId 另外断言：

```text
RoleControl = StoryRole = 3（仅可玩角色），每个角色唯一；worldActor 无二者记录；人类⇄AI 权威交接 epoch 严格递增，presence-only transition 保持 epoch
playable-role MAIN 总数 = 21
HUMAN + AI_TAKEOVER + TIMEOUT_FALLBACK = 21，且每个 role/window 恰好一条
AI action 的 actorUserId = null、actorKind = AI_TAKEOVER、controlEpoch/policyVersion/modelName 可追溯
RoleAgentDecision 总数 = SEALED_ACT + SEALED_FALLBACK + PASS + STALE + NO_OP + FAILED，每项可读回；Outbox task 的 status/outcome 分开统计
SEALED_ACT/SEALED_FALLBACK task 恰对应一条 PlayerAction；PASS 恰对应一个 participant 槽位终态且 PlayerAction=0
STALE/NO_OP task 的 PlayerAction=0 且不越权改 participant；FAILED 不得留为最终未恢复状态
worldActor SYSTEM_ACTION = 7（全部 roleId=null），不得被计入 AI_TAKEOVER
人/AI 同槽位双写 = 0，旧 epoch 写入 = 0，未授权知识 = 0
```

## 6. 正式页面与视觉测试

### 6.1 路由

| ID | 场景 | 通过条件 |
|---|---|---|
| UI-ROUTE-001 | Start Game | 三页都使用 Start/`ROOM_STARTED` 返回的同一权威 `StoryRun.id` 进入 `/game?runId=<same-run-id>`；不由前端猜 ID |
| UI-ROUTE-002 | `/room-game` | 只作兼容重定向，不加载旧页面 |
| UI-ROUTE-003 | `/trio` | 不参与正式验收 |
| UI-ROUTE-004 | 刷新/Continue | 回到同一房间、角色、阶段和私有状态 |
| UI-ROUTE-005 | 大厅可选角色 | 恰好只有总督/巡抚/县令三个真人角色可选；江南商会 worldActor 不出现为角色卡，或仅显示为 disabled 的系统行动者说明 |
| UI-LOBBY-001 | 玩家 Ready | 仅当前玩家选角后 Ready 可用；点击成功后已就绪按钮 disabled/灰化，重复点击幂等，不能替他人 Ready |
| UI-LOBBY-002 | 房主 Start（三真人 D10） | 仅 P1 看见 Start；初始 disabled；本 D10 房间的三名真人全部选角并 Ready 后才 enabled；P2/P3 调 API 为 403，任一已加入真人未选角/未 Ready 时为 `ROOM_NOT_READY` 且无副作用。另以独立低层用例证明 1/2 真人房把空缺角色原子交给 Agent，不得拿该路线替代三真人 UI 成功路线 |
| UI-LOBBY-003 | 三页同步 | 任一角色/Ready 变化 2 秒内出现在三页 roster，并同步房主 Start enabled 状态；江南商会始终不计 Ready |
| UI-LOBBY-004 | Start 后导航 | P1 点击后，三页通过 `ROOM_STARTED` 或补拉在 3 秒内自动进入同一 `/game?runId=<runId>`；该 runId 等于 Start 返回的 `StoryRun.id`，P2/P3 不刷新、不点 Continue |
| UI-ROUTE-006 | 生产构建产物 | `pnpm build:vercel` 后从 `apps/web/dist-vercel` 经生产等价路由启动；`/game` 是正式游戏骨架而非首页，静态资源全部来自本次 build hash |
| UI-ROUTE-007 | 结果深链 | `/game/result?runId=...` 直接打开和刷新均为 2xx，并只装载成员 `ResultProjection` 结果视图 |

#### 6.1.1 构建产物与 boot fail-closed 矩阵

路由门禁必须分别跑“本地正式 Web”与“`pnpm build:vercel` 生产产物”两次。生产 lane 不得直接读取 `apps/web/public/index.html` 冒充产物；必须记录 `apps/web/dist-vercel` 的确定性文件清单/sha256，并通过生产等价 router 发起真实 HTTP 请求：

```text
GET /                              → 首页，包含 story-lobby-root，不冒充游戏
GET /game?runId=<id>               → 2xx，包含 web-game-root + game-bootstrap.js，不包含 home.js/story-lobby-root
GET /game/result?runId=<id>        → 2xx，包含正式结果视图入口
GET /room-game?runId=<id>&x=1      → 301/302/307/308 Location=/game?runId=<id>&x=1，随后进入同一正式游戏
```

`/room-game` 返回 200、rewrite 到 `room-game.html`、丢 query，或 build 脚本用 `home.html` 覆盖 `/game` 入口，均为 `FAIL/PRODUCTION_ROUTE_MISMATCH`。本地通过不能覆盖生产产物失败。

只要 URL 带 `runId`，bootstrap 就必须忽略 hint Cookie 是否存在并执行一次 `credentials: include` 的房间投影探测；禁止在错误时静默启动 SOLO：

| 输入/服务端结果 | 页面结果 | 必须禁止 |
|---|---|---|
| 无 `runId` | 才允许进入既有 SOLO bootstrap；仍遵守单人认证合同 | 探测随机 room 或创建默认多人局 |
| 匿名或仅有 `many_worlds_session_hint`，投影返回 401 | 跳 `/auth?returnTo=<完整编码后的/game URL>`；登录后回原 URL | 进入 SOLO、信任 hint、显示房间私密信息 |
| session 过期，返回 401 | 清理非敏感 hint/本地 cursor，显示登录态过期并走同一 returnTo | 无限 SSE/GET 重试或继续显示缓存私密投影 |
| 有有效 HttpOnly session、hint 缺失，成员投影 200 | 正常启动该成员 RoomStoryStorage | 因没有 hint 而回退 SOLO |
| 已登录但非成员，返回 403 | 无权限页；只给返回 Rooms 动作 | 暴露角色/房间内容、改探测旧 API、回退 SOLO |
| 返回 404 `ROOM_NOT_FOUND` | 房间不存在页；只给返回 Rooms 动作 | 把该 runId 当单人 run、自动创建或加载缓存局 |
| 网络错误、解析失败、429 或 5xx | 可重试错误页，受控退避；保持 fail-closed | 把非 2xx/null 当 404 或加载硬编码/旧缓存 |

上述每格都要做 bootstrap 单测和构建产物浏览器测试，并断言未 import/启动 SOLO storage。401/403/404 页面正文不得通过差异泄露房间是否存在或其私密内容，服务端审计仍可区分真实原因。

### 6.2 正式主游戏状态

| ID | 状态 | 通过条件 |
|---|---|---|
| UI-MP-001 | 私人简报 | 三页角色、头像、地点、目标和私密内容正确，不串号 |
| UI-MP-002 | MAIN | 每页显示该角色专属三张行动卡，不是公共同题 |
| UI-MP-003 | MAIN 已密封 | 2 秒内显示执行回执，不出现大型等待页 |
| UI-MP-004 | 谋划 | 第一名提交时另两人未交，第一名仍可完成谋划 |
| UI-MP-005 | 痕迹 | 只显示角色可观察内容，不暴露真实目的 |
| UI-MP-006 | 回应 | 只有目标玩家出现可操作回应，第三人不见完整内容 |
| UI-MP-007 | 收束 | 无房主 Resolve；自动出现 UI03 推演状态 |
| UI-MP-008 | 结果 | 三页个人结果不同，公共变化一致 |
| UI-MP-009 | 顶栏 | 显示阶段和剩余时间，不公开谁没提交 |
| UI-MP-010 | 角色资源 | 不同角色不再复用总督头像、资源、联系人和筹码 |
| UI-MP-011 | 控制器状态 | 自己看到精确的你在操控/恢复期/AI 托管/接管待生效；他人只见玩家或 AI 代理 |
| UI-MP-012 | 离开控件 | `完成并离开本阶段` 与 `退出本局并交给 AI` 分开；后者需二次确认和明确后果 |
| UI-MP-013 | AI 代理可见 | 交托后 2 秒内其他页看到“AI 代理”，世界不显示等待已退玩家 |
| UI-MP-014 | 返回接管 | 显示 AI 已密封行动、HUMAN/AI 时间线标签和实际接管生效槽位，不覆盖历史 |
| UI-MP-015 | 全员托管 | 已解锁局显示 AI 正在推演或已完成；未解锁局明确显示等待真人解锁；原玩家可返回同一 Run 解锁/接管/查看结果 |
| UI-MP-016 | 第 4 轮解锁门 | `access.state=REQUIRES_UNLOCK` 时只显示正式 Credits 门；真人成员点击一次后三页通过事件变为 UNLOCKED 并继续同一 RunId |
| UI-MP-017 | 个人结局投影 | 三页公共结局一致、`personalEnding/myKeyDecisions/authorizedCrossImpacts` 按成员不同；刷新仍隔离且不读取 raw Chapter |
| UI-MP-018 | 第 7 轮谋划 | R7 MAIN 密封后仍显示并可提交一次 MANEUVER；完成后才进入收束/结果，不受单人 `FINAL_DAY` 禁用逻辑影响 |

#### 6.2.1 Unlock 与 ResultProjection 验收合同

第 4 轮锁定投影必须包含 `access.state/requiredCredits/canCurrentUserUnlock/unlockEndpoint`，并满足：

1. `REQUIRES_UNLOCK` 时状态为 `WAITING_FOR_HUMAN_UNLOCK`，窗口计时未开始，Agent/Worker 不尝试消费 Credits 或绕过。
2. 全真人成功 lane 只由 P1 通过正式页面触发 `POST /api/v4/story-runs/:runId/unlock`，请求带稳定 idempotencyKey；P1 的重复点击/网络重试最终只有一笔 `WORLD_UNLOCK`、一次扣点且 payer=P1。P2/P3 只观察事件后的 UNLOCKED 状态，不在该 RunId 抢解锁。
3. 另建 `UNLOCK-RACE` 独立 RunId，在屏障后让 P1/P2 通过各自正式页面并发点击；允许任一方成为唯一 payer，但只允许一笔 WORLD_UNLOCK、一次扣点，输家返回 alreadyUnlocked/幂等投影。该 RunId 的 payer 断言不得与成功 lane 的 payer=P1 计数混用。
4. 成功响应含 `unlocked/alreadyUnlocked/creditsCharged/payerUserId/access/gameProjection`；三页通过成员事件或补拉进入同一 UNLOCKED projection，不刷新成新房间。
5. 匿名 401、非成员 403/404、Role Agent/内部 Worker 无该工具、余额不足无部分写入；TAKE-013 保持等待真人，真人返回解锁后原 RunId 恢复。

Run 完成前 `GET /api/v4/rooms/:roomId/result` 稳定返回 409 `RESULT_NOT_READY`；完成并发布后返回 `schemaVersion=continuous_result_projection_v1`，至少包含 `roomSummary/run/publicEnding/personalEnding/myKeyDecisions/authorizedCrossImpacts/myControlTimeline/creditsSummary`，其中 run 带冻结的 `engineVersion/strategyVersion`。三账号分别验证：

```text
publicEnding endingKey/factIds 一致
personalEnding roleId/title/body/goalOutcomes/knownFactIds 各自正确且至少引用本角色真实前序 action/fact
P1 响应和 DOM 中不存在 P2/P3 personalEnding、private facts、余额
匿名为 401；非成员与索取他人 roleId 为 403/404；无原始共享 Chapter 全文降级
/game/result 只消费 ResultProjection，刷新、Continue 和直接深链结果一致
```

终局还必须增加真人文案门禁：三页的公共/个人结局正文均至少引用本 Run 的真实玩家可读行动标题，并解释选择到后果的因果链；`endingKey/factIds/knownFactIds` 只作为授权后的机器元数据存在。截图、可访问性树、正文和行动历史中不得出现 `global_`、`personal_`、`state_`、`asset_`、`main_`、`maneuver_`、`reaction_`、`system_`、`internal_` 内部前缀。若任一内部键可见，或“为什么会得到这个结局”只有固定计数模板而没有真实行动与影响，当前 Run 必须记 `FAIL`，修复后使用 fresh RunId 重跑完整七轮；不得用旧结果页刷新后的截图替代 fresh Run 验收。

三页终局还需逐页确认：`myKeyDecisions` 至少展示 2 条 `第 X 轮 + 玩家可读标题 + 本人/AI`；右栏不再出现等待决策、谋划或交给 AI 的进行中控件；世界/地点顶栏完整无截断。三名角色即使统计数字相同，也必须能从具体决策标题看出各自不同的行动链。

### 6.3 UI01—UI08 回归

视觉门禁拆成两个不能互相替代的 lane：

1. `VISUAL-FIXTURE`：固定 `1672×941`、DPR=1、字体、动画关闭，使用版本化、确定性的 `GameProjection/ResultProjection` fixture 和冻结的 `serverNow`，逐一生成 UI01—UI08。fixture 必须经非生产 visual harness 在页面加载前提供，页面仍走正式渲染器；禁止 Runtime.evaluate/DOM mutation/请求拦截在页面启动后改文字、样式或状态。
2. `VISUAL-LIVE-MP`：使用本次三真实账号/RunId 的动态页面，验证关键容器几何、无溢出、可访问性、角色差异和隐私，不要求三个不同角色的动态正文同时匹配同一张像素图。该 lane 的截图仍全部入 manifest，不能代替固定 fixture 的像素门禁。

每个 UI 状态固定一份 fixture 文件和一份 mask JSON。mask 只允许列出 `{x,y,width,height,reason}` 的已批准动态矩形，必须随代码评审提交并计算 SHA-256；运行时不得自动扩大 mask、按 diff 生成 mask 或遮住决策卡、谋划/回应控件、角色身份、私密正文和错误提示。reference、fixture、mask、actual、diff 五者的相对路径和 sha256 都写入 acceptance-manifest。

结构与未遮罩像素门槛：

```text
主要容器、分栏、决策卡、谋划区和回应弹窗几何偏差 ≤ 2 CSS px
按版本化 mask 排除后 SSIM ≥ 0.985
按版本化 mask 排除后 changed-pixel ratio ≤ 1.5%
mask 覆盖面积和区域数必须等于评审文件声明，不能在运行时增加
```

禁止整页参考图、透明热区、第二套 `.room-main-*` 页面骨架或把 live 三角色差异全部遮掉。若 reference/fixture/mask 哈希不符，或现有视觉基线尚未达标，本次为 `FAIL/VISUAL_BASELINE_MISMATCH`，不能因为多人功能通过而改成 PASS。

## 7. 三浏览器成功路线

### 7.1 大厅到正式游戏

内置 Browser 的三个可见标签页依次完成：

```text
三个独立 origin 标签页分别按 2.4 完成 P1/P2/P3 注册、file-sink 邮箱验证和 Cookie 登录
→ 在尚未创建房间/RunId 时执行独立、留证、幂等的 BONUS 测试信用夹具
→ P1 进入嘉靖世界并创建房间
→ 三页验证可选真人角色恰好为总督/巡抚/县令，江南商会不可点击且不计入 Players/Ready
→ P1 选择并锁定浙江总督
→ P1 通过真实邀请入口发送邀请
→ P2/P3 分别在自己的已登录窗口打开邀请并加入
→ P2 选择浙江巡抚
→ P3 选择清流县令
→ 三人分别 Ready
→ 只有 P1 看见可用 Start Game
→ P1 点击 Start Game
→ 三页进入同一正式 /game
→ 第 4 轮固定由 P1 通过正式 UI 解锁共享世界，三页继续同一局
```

不得直接写 Token、Cookie、房间成员、角色或 Ready 状态。BONUS 夹具是唯一允许的局外准备写入，必须发生在创建 RunId 前，且不能被玩家决策上下文读取。每一步截图并记录 URL、可见控件和运行时异常。

MP/SP/TAKE 的 UI_SETUP 和真人行动阶段必须输出自动化 action trace，逐条记录 `player/timestamp/windowPid/locatorOrCoordinate/inputKind/screenshotBefore/screenshotAfter`。允许操作只有：浏览器地址栏导航、可见 locator/坐标鼠标事件、真实键盘按键、滚动、等待和截图；可访问性树/DOM 只读结果可用于定位。

下列行为在最终三浏览器 lane 一经发现即 `FAIL/PROGRAMMATIC_PAGE_INJECTION`：`Runtime.evaluate`/`evaluate` 执行动作或修改状态、`HTMLElement.click()`、`dispatchEvent`、直接 DOM mutation、`Page.addScriptToEvaluateOnNewDocument`、页面内 fetch/XHR、直接调用 app/storage 方法、写 Cookie/localStorage/sessionStorage、伪造时钟、service worker/mock response、request interception 改响应，以及借 DevTools console 提交命令。固定视觉 fixture 只允许在独立 `VISUAL-FIXTURE` lane 由非生产 harness 在加载前提供，绝不能进入 MP/SP/TAKE 的 RunId。

### 7.2 七轮安排

| 轮次 | 必测互动 | 页面操作顺序 | 核心断言 |
|---|---|---|---|
| 1 改桑急令 | 提交后仍可操作 | P1 先 MAIN；P2/P3 保持未提交 5 秒；P1 完成 MANEUVER；再由 P2/P3 MAIN+MANEUVER | P1 无等待页；三方行动改变执行边界 |
| 2 县令密信 | 定向请求与回应 | P1 对 P3 发出交证请求；P3 页面收到并完成本局第 1 次 REACTION（`R2:P3`，只交副本/要求保护）；P2 另行追查 | LIMITED 只向 P1/P3 展示完整内容；P2 只见允许痕迹 |
| 3 粮价失控 | 私密行动和可观察痕迹 | P2 选择 PRIVATE 抢先奏报；P1/P3 分别调查粮仓与粮田 | P1/P3 不见奏报 method/intent，只见驿站或用印痕迹 |
| 4 暗账浮出 | 共享解锁、回应、刷新和资产账本 | P1 从正式游戏门槛点击共享解锁；P3 要求 P1 提供保护才转移证据，P1 完成第 2 次 REACTION（`R4:P1`）；P3 刷新/重开后处理原件 | 只扣一笔 WORLD_UNLOCK；P1 回应改变 P3 可用行动；P3 恢复已用槽与资产，原件不重复转移 |
| 5 相互弹劾 | 房主不参与结算 + 定向辩驳 | P1 对 P2 发出弹劾，P2 完成第 3 次 REACTION（`R5:P2`）；P1 随后最小化/切到后台但保持心跳；P2/P3 完成 | P2 的真实辩驳改变责任归属；无房主按钮和可见页面依赖；三页之后都进入结果/下一轮，RoleControlTransition 仍为 0 |
| 6 京师回批 | 并发和幂等 | 三人并发 MAIN；P2 对同一按钮制造双击；三人继续 MANEUVER | 只有 3 条 MAIN；网络顺序不决定政治胜负；只结算一次 |
| 7 御前裁决 | 第 7 轮谋划 + 三个个人结局 | 三人分别提交符合角色前六轮事实的最终 MAIN 陈述和证据处置；每人 MAIN 密封后仍从页面完成一个 MANEUVER，再 DONE/等待自动收束 | R7 恰有 3 MAIN + 3 MANEUVER；公共结局一致；个人结局不同；每份引用真实前序事实 |

每一轮三名玩家都执行一个 MANEUVER，以证明提交后的连续操作不是只在第一轮存在。成功路线恰好触发 3 次 REACTION，固定为 `R2:P3`、`R4:P1`、`R5:P2`；其他请求只形成普通压力/痕迹，不额外占回应槽。

第 7 轮不是 MANEUVER 例外。浏览器必须在 R7 MAIN 后看到 `availableManeuvers` 非空/可操作并成功密封；前端不得沿用单人 `day >= FINAL_DAY` 禁用分支。UT/UI/MP/DB 四层同时断言 R7 三条 MANEUVER，少一条即整条成功路线 FAIL。

### 7.3 每轮硬断言

1. 三个不同 userId 各有且仅有一条真人 MAIN。
2. 三条 MAIN 的 roleId 与各自登录角色一致。
3. 每人 MAIN 后仍成功执行一条 MANEUVER。
4. 本轮只有一个 ActionWindow、一个 CLOSING 成功者和一个 DirectorResolution。
5. 每轮至少有两条来自不同真人 action 的真实跨玩家影响边；七轮累计每名玩家至少 5 轮看到另一真人造成的直接影响、痕迹、资源变化或回应请求。
6. 所有影响在数据库中有真实 `originActionId`，不能是伪造环境文案。
7. 未授权玩家的响应 JSON、事件流、DOM、历史记录和叙事中均无私密正文。
8. 结果后三页自动进入同一个下一阶段，不需要房主推进。
9. 前端控制台无未处理异常，网络无无限重试。
10. 时间指标进入 `timeline.json`，不能只人工描述“很快”。
11. 第 7 轮三页 MAIN 后仍各有且只有一次可用 MANEUVER，页面、命令回执与 DB 三层一致为 3/3。

### 7.4 角色 Agent 接管路线

每条 TAKE 用例必须使用新房间和新 RunId，且先由内置 Browser 三个 origin 的可见标签页通过真实 UI 完成登录、开房、邀请、选角、Ready、Start。接管后可关闭目标标签页或显式交托，但不允许脚本代替 Role Agent 直接 POST 行动。

`TAKE-001—013` 是 13 个逻辑组、15 个可独立执行的 case；`TAKE-006A/006B` 和 `TAKE-011A/011B` 必须分别拥有不同 RunId、证据和 verdict，聚合器不得只按数字 001—013 计数而漏掉 A/B 分支。

| ID | 路线 | 执行 | 硬断言 |
|---|---|---|---|
| TAKE-001 | 短断线不接管 | P3 在 MAIN_OPEN 时断开 SSE/心跳 2–7 秒并于自动托管阈值前返回 | 可经过 `HUMAN_OFFLINE_GRACE`，最终回 `HUMAN_ACTIVE`；Agent task/action/transition-to-AI 均为 0 |
| TAKE-002 | P3 明确交托 | P3 完成第 2 轮后，在第 3 轮 MAIN 前点击“退出本局并交给 AI”并确认 | P1/P2 不等待 P3；P3 Agent 完成 R3–R7；21 MAIN = 16 HUMAN + 5 AI_TAKEOVER，7 结算/21 个人结果完整 |
| TAKE-003 | 异常退出自动接管 | P2 在第 2 轮未交 MAIN 时关闭其可见标签页，不调用 handoff | 先进 offline grace，自动阈值后恰一次转 `AI_ACTIVE`、恰一个当前槽位 Agent task/action；不因一次心跳丢失重复接管 |
| TAKE-004 | 末秒人/AI 竞争 | 在自动托管 CAS 与人类 MAIN 提交之间放置 barrier，同时释放 | 仅一个 epoch/槽位写入成功；另一方返回 `ROLE_CONTROL_CHANGED`/no-op；无双扣资产 |
| TAKE-005 | AI 行动前回归 | 阻住 Agent provider，原玩家在 action 密封前点击接管 | reclaim CAS 立即转 `HUMAN_ACTIVE`，人类可完成当前未密封槽位；释放后旧 Agent task 无副作用结束 |
| TAKE-006A | AI MAIN 后回归 | 等 AI 密封 MAIN，在 MANEUVER 仍 AVAILABLE 且 Agent 未密封时让原玩家接管 | 页面标记 MAIN 由 AI 代理且不覆盖；reclaim 立即 fences 旧 Agent，真人可完成当前 MANEUVER |
| TAKE-006B | 无安全槽位时回归 | 固定在 R3 RESOLVING 请求 reclaim，并在 R4 窗口开放事务前后注入 Worker 崩溃 | 先进 `HUMAN_RECLAIM_PENDING`；R4 同事务先转 HUMAN 再决定 Agent enqueue；恢复后只有一个控制器，Agent MAIN task=0 |
| TAKE-007 | 房主交托 | P1 在第 2 轮交托并关闭自己的标签页，P2/P3 继续操作；第 4 轮由 P2 在正式 UI 明确解锁 | 房间不换房主也不等 Resolve；P1 Agent 同等行动；WORLD_UNLOCK 恰一笔且 payer=P2；完整进入第 7 轮 |
| TAKE-008 | 全员 AI 到结局 | 第 4 轮开始由 P1 在正式 UI 只解锁一次共享世界，随后三人在 R4 MAIN 前分别明确交托，关闭三个标签页和 SSE | 无浏览器后仍完成 R4–R7；21 MAIN = 9 HUMAN + 12 AI_TAKEOVER；7 结算、21 个人结果、公共/个人结局完整；WORLD_UNLOCK 恰一笔且 payer=P1 |
| TAKE-009 | 多 Agent 隐私与同时性 | 抓取脱敏的 Agent 输入 manifest/snapshotVersion，用特征秘密扫描交叉泄露 | 三个 Agent 同轮使用同一 opening snapshot；每个只含本角色知识；不存储隐藏思维链 |
| TAKE-010 | Agent/Worker 故障 | 依次注入 timeout、illegal JSON、guard reject，并在 Agent task 领取/密封边界杀 Worker | 一次 repair 或确定性 fallback；租约恢复后只有一条 action，窗口不死锁 |
| TAKE-011A | `LEAVE_STAGE` 跨窗口语义 | P3 DONE 后点 `LEAVE_STAGE` 并关闭页面，让当前窗口继续超过自动托管阈值；下窗口打开后在新阈值前返回 | 当前窗口 RoleControl 不转 AI；下窗口的 offline grace 从新 `mainOpenedAt` 开始；返回后继续 HUMAN，Agent action=0 |
| TAKE-011B | 收束期交托 | 固定在 R3 `RESOLVING` 时 handoff | 不改已密封/正结算槽位，当前 Agent task=0；R4 冻结 snapshot 后恰 enqueue 一个新 epoch MAIN task。R7 对应语义由 UT-CTRL-007 覆盖，不等待不存在的下一窗 |
| TAKE-012 | 越权与旧页防线 | P2 尝试 reclaim P3，同时让 P3 交托前旧 tab 提交旧 epoch | 非 owner 403/404；旧 tab 409 `ROLE_CONTROL_CHANGED`；两者均无 action/transition 副作用 |
| TAKE-013 | Agent 不能解锁/花费 | 在共享世界尚未由真人解锁的独立 RunId 将所有可玩角色交托，再让 P1 返回 | Run 确定性进入 `WAITING_FOR_HUMAN_UNLOCK`，Agent task 暂停，Credits/WORLD_UNLOCK 写入为 0；P1 通过正式 UI 解锁后同一 RunId 恢复，不丢窗口/控制状态 |

TAKE-013 用于证明付费边界与恢复，不承担“未解锁时全员 AI 必须自行完成”的验收。P0 不存在 Agent 自行选择的免费绕过；若未来某模板支持免费路径，必须由模板显式配置并另做验收。全员托管的到局可完成性由已通过真人 UI 解锁的 TAKE-008 证明。

接管路线不只验证“Agent 帮忙交了 MAIN”，还必须验证角色之间继续权谋：

1. 每个接管阶段至少有两条来自不同可玩角色 action 的真实跨角色影响边，每条都有 `originActionId/affectedRoleId`；`SYSTEM_ACTION` 不计入。
2. TAKE-002 的 R3–R7 每轮至少一条 P3 Agent action 影响 P1/P2，也至少一条 P1/P2 action 影响被 AI 控制的 P3，证明是双向对局。
3. TAKE-008 的 R4–R7 每轮两条影响边都来自不同 AI_TAKEOVER 角色，三个角色各至少在 3/4 轮受到另一角色的可追溯影响。
4. TAKE-002/008 合计至少密封一条 Agent MANEUVER 和一条 Agent REACTION，其结果改变后续资产、风险、可用行动或责任归属，不接受只有文案变化。
5. TAKE-002 的 R3–R7 逐轮读回三角色 MAIN 决策依据：openingSnapshotVersion 必须相同；P3 Agent 输入不含同轮 P1/P2 已密封行动；P1/P2 在自己 MAIN 前的 DOM 也不含 P3 同轮 Agent 行动或缓存痕迹。

## 8. 盲模拟玩家测试

### 8.1 隔离方式

- 为 P1/P2/P3 分别建立独立模拟玩家进程或独立 agent context。
- 每个模拟玩家输入只包含自己的 screenshot、DOM 可见文本、角色设定和自己的历史记录。
- 中央 orchestrator 只负责轮次调度、证据落盘和是否达到页面条件，不提供行动建议。
- 不向模拟玩家提供完整剧本、其他角色私密响应、DB、API body、未来轮次或预期结局。

### 8.2 每轮五问

每轮结果后，三个玩家分别回答：

```text
1. 我本轮做了什么？
2. 哪个其他玩家的行为改变了我的处境？
3. 我实际看见的世界变化是什么？
4. 我现在最担心什么？
5. 下一轮为什么会发生？
```

每名玩家每轮至少答对 4/5；任一玩家连续两轮低于 4/5，判定信息呈现或连续性失败。

### 8.3 体验门槛

| 指标 | 通过门槛 |
|---|---:|
| 三账号完成率 | 3/3 |
| 七轮完成率 | 3/3 |
| MAIN 后有效后续操作 | 21/21 |
| MAIN 回执 | P95 ≤ 2 秒 |
| MAIN/Grace 全屏硬阻塞 | 0 秒 |
| 可避免空闲 `closingAt - max(lastUsefulActionAt, graceMinClosesAt)` | 正式并发样本 P95 < 2 秒、最大 ≤ 5 秒；人工单人三页模式不计入 |
| 原始 Grace 墙钟时间 | 单独记录，不把强制 20 秒保护期误判为可避免等待 |
| DONE 后离开与恢复 | 100% |
| 事件可见延迟 | P95 ≤ 3 秒 |
| 完整结算 | P95 ≤ 30 秒 |
| 可识别真人影响 | 每名玩家 ≥ 5/7 轮 |
| 五问理解 | 每人平均 ≥ 4/5 |
| 私密信息严重误解/泄漏 | 0 |
| “我的选择改变了局势” | 三人平均 ≥ 4/5 |
| 局后能指出两条他人影响 | 3/3 |
| 愿意换角色重玩 | 至少 2/3 |
| 交托状态对其他页可见 | P95 ≤ 2 秒 |
| 自动托管阈值到 RoleControl 切换 + 首个合法任务入队 | P95 ≤ 5 秒，最大 ≤ 5 秒 |
| AI 可操作槽位提交 | P95 ≤ 5 秒，含 fallback |
| 全 AI 队列清空到 CLOSING | 3 秒静默期，定时误差 ±1 秒；新请求后必须重置 |
| 短断线误接管 | 0 |
| 人/AI 同槽位双写 | 0 |
| 返回玩家能说清 AI 做了什么/何时接管 | 3/3 |
| 已解锁全员交托后无浏览器完整到结局 | 1/1 |
| 未解锁全员交托不花费、真人返回同 Run 恢复 | 1/1 |

## 9. 独立故障路线

故障测试使用新房间/新 RunId，不破坏成功路线计数。

| ID | 故障 | 通过条件 |
|---|---|---|
| FI-001 | P3 不提交 MAIN 直到超时 | 只为 P3 生成最小维持行为，世界自动推进 |
| FI-002 | 房主在 MAIN_OPEN 关闭浏览器 | P2/P3 完成后服务端仍推进 |
| FI-003 | 两个 scheduler 同时扫描 | 一个 CAS 成功，一个无副作用退出 |
| FI-004 | 独立 Worker 在指定 checkpoint 后退出 | 参数化使用 9 个新 RunId：R3 分别在 `RULES_APPLIED`、`PUBLIC_PROJECTED`、三个 `ROLE_PROJECTED:<roleId>`、`PUBLISHED`、`NEXT_WINDOW_OPENED` 后退出；R7 分别在 `PUBLISHED`、`RUN_COMPLETED` 后退出。重启从缺口恢复，终端重入不重复开窗，Window 8=0，规则/资产/投影均不重复 |
| FI-005 | P2 SSE 断开，期间发生四级事件 | 重连补齐，隐私和顺序正确 |
| FI-006 | P3 使用已迁移 windowId | 409 `WINDOW_MOVED`，刷新后继续，不覆盖已密封行动 |
| FI-007 | P1 双击 MAIN/MANEUVER | 每槽一条，回执幂等 |
| FI-008 | 最后 5 秒创建定向请求 | 降级为压力或下轮事件，不制造无法回应的弹窗 |
| FI-009 | Writer/Role Agent timeout 或非法 JSON | repair 或确定性 fallback，窗口不死锁 |
| FI-010 | 恶意行动要求公开别人秘密 | Guard/Projector/Validator 阻止，任何未授权输出中均无秘密 |
| FI-011 | 完整旧 endpoint deny-matrix 绕过 | 匿名/非成员/另一成员对 run/state/roles/node/actions/resolution/segments/chapter/insights/AI fill/resolve/generate/admin 不读取、不推进 |
| FI-012 | 断电式 API/Worker 重启 | 恢复同一窗口、任务和每成员 deliverySequence，无重复发布 |
| FI-013 | 接管 transition 已写、Agent task 未执行时断电 | Outbox 恢复后恰一次执行，不依赖原浏览器重连 |
| FI-014 | Agent provider 返回后、action 密封前杀 Worker | 租约恢复后重用幂等键，只一条 action/资产 mutation |
| FI-015 | 三 Agent 不同顺序返回 | 裁决结果只取决于同一 opening snapshot 和三条密封 action，不取决于 provider 完成顺序 |

### 9.1 Worker checkpoint 故障执行合同

开发阶段新增独立 Worker 启动命令 `pnpm dev:story-worker` 和非生产故障变量 `FAIL_AFTER_CHECKPOINT`。该变量在生产环境启动时必须 fail-fast，不可静默生效。每个 checkpoint 用新 RunId 执行：

```powershell
$env:STORY_WORKER_EMBEDDED = 'false'
$env:FAIL_AFTER_CHECKPOINT = 'PUBLIC_PROJECTED' # 驱动器按 FI-004 参数化替换 9 个 checkpoint/stage/role 组合
$env:FAIL_AFTER_CHECKPOINT_RUN_ID = $runId          # 必须绑定当前 lane，禁止命中同库其他 Run
$worker = Start-Process -FilePath 'pnpm.cmd' -ArgumentList 'dev:story-worker' -PassThru -WindowStyle Hidden
pnpm test:continuous-mp:fault -- --run-id $runId --wait-checkpoint PUBLIC_PROJECTED --worker-pid $worker.Id
Wait-Process -Id $worker.Id -Timeout 60                 # 期望故障点以专用退出码终止该 PID
pnpm test:continuous-mp:fault -- --run-id $runId --wait-lease-expired --verify-partial
Remove-Item Env:FAIL_AFTER_CHECKPOINT
Remove-Item Env:FAIL_AFTER_CHECKPOINT_RUN_ID
$worker2 = Start-Process -FilePath 'pnpm.cmd' -ArgumentList 'dev:story-worker' -PassThru -WindowStyle Hidden
pnpm test:continuous-mp:fault -- --run-id $runId --wait-complete --worker-pid $worker2.Id
```

证据必须包含两个 Worker PID、故障点、退出码、租约到期时间、重启时间、checkpoint 前后读回、最终 action/resolution/projection/asset mutation 去重结果。脚本只轮询任务/租约状态，不用固定 sleep 假定租约已过期。

### 9.2 Role Agent 故障执行合同

新增仅非生产可用的 `FAIL_ROLE_AGENT_AT=TASK_LEASED|PROVIDER_RETURNED|ACTION_SEALED`、`FAIL_ROLE_AGENT_TASK_ID=<当前目标任务>` 和可控 provider 响应；没有任务 ID 栅栏时不得启动故障 Worker。生产启动遇到该变量必须 fail-fast。每个故障点使用新 RunId，记录 `roleId/windowId/slot/controlEpoch/taskDedupeKey`、租约、provider attempt、repair/fallback、新旧 Worker PID 和最终 action。

验证器必须证明：

```text
RoleControl CAS+transition 不会只写一半；当前有开放槽时所需 Agent outbox 同事务，结算态则明确为 0
旧 controlEpoch 的重试任务不落 action
同 role/window/slot 只有一条密封 action
provider 响应顺序不改变同轮可见信息和裁决输入
fallback 不越过 Guard、资产、知识和 Credits 边界
```

### 9.3 故障与接管的连续执行路由

TAKE/FI 不是在成功路线数据库上追加几条 API 调用。每个 lane 都必须在 acceptance-manifest 中预先声明新的 `laneId/runId/timingProfile/faultProfile/expectedFault/targetPid`，并按同一状态机执行：

```text
PRECHECKED
→ UI_SETUP（三个已验证 Cookie 账号用内置 Browser 三 origin 的可见标签页从大厅进入同一 /game）
→ TRIGGER_ARMED（barrier/checkpoint/目标 PID 已留证，但尚未制造故障）
→ TRIGGER_OBSERVED（精确 transition/checkpoint/provider attempt 已出现）
→ RECOVERY_OBSERVED（租约过期、唯一 Worker/Agent 接手或真人 reclaim）
→ DB_AND_UI_VERIFIED（投影、事件、DOM、DB、task/action 去重一致）
→ PASS | FAIL | EXTERNAL_BLOCKED
```

| 路由族 | 唯一触发方式 | 连续性硬门禁 |
|---|---|---|
| 显式交托 TAKE-002/007/008 | 目标 origin 的可见标签页点击正式 `HANDOFF_TO_AI` 并确认，再关闭该 tab | 不留隐藏 tab/SSE/heartbeat；CAS+transition 同事务，有开放槽才同事务写 outbox，结算态为 0；唯一 Worker 继续，其他真人不等待 |
| 异常离线 TAKE-001/003 | 只关闭目标 origin 标签页或使用验收专用网络隔离，不调用 handoff、不终止整个 Browser 运行时 | 短断线不接管；超过阈值仅一次 epoch 转移和一次当前槽任务；心跳限流不能被绕过来延后接管 |
| 真人回归 TAKE-004—006/012 | 通过原账号原 origin 的新可见标签页和正式 reclaim UI，barrier 只控制服务端 checkpoint | 旧 epoch fenced；已密封行动保留，未密封槽只由一个控制器完成 |
| 全员 AI TAKE-008/013 | 三人先真实开局；需解锁的路线先由真人 UI 解锁，随后依次交托并关闭三个 origin 标签页 | worker/scheduler 在浏览器和 SSE 全部为 0 后继续；Agent 不具备 Credits 工具；未解锁时稳定等待真人 |
| Resolution FI-003/004/012 | 只使用 `FAIL_AFTER_CHECKPOINT` 和 manifest 目标 Worker PID | checkpoint 恰被命中后进程以专用码退出；新唯一 Worker 从缺口恢复，无重复 mutation |
| Role Agent FI-009/013—015 | 只使用 `FAIL_ROLE_AGENT_AT + FAIL_ROLE_AGENT_TASK_ID`、可控 provider 和确定性 barrier | task lease/provider/action 三边界分别恢复；同 role/window/slot/epoch 只一条密封 action |

只有竞争专项允许第二 Worker，并且必须把两个 PID、允许处理的 RunId 和结束时间写入 manifest；它不能与成功/TAKE lane 并行。目标玩家只能按 manifest 中的 tabId+origin 精确关闭对应标签页；目标 Worker 只能按 manifest PID 精确停止，禁止按进程名批量杀进程。脚本固定 sleep 不能作为 transition/租约已发生的证据，必须轮询权威 checkpoint 并设置有界超时。

若预期 checkpoint 未命中、杀错 PID、隐藏页面仍发心跳、故障开关泄漏到其他 lane、恢复后出现重复写入或接管计数不符，均为 `FAIL`，不是外部阻塞。若 DeepSeek、已声明的 Supabase 验收项目/连接或桌面环境在已通过预检后发生新的外部中断，可将该 lane 标记 `EXTERNAL_BLOCKED`，但必须封存失败 RunId；外部恢复后用新 RunId 从 UI_SETUP 重跑，不能从半局续证或借其他 lane 补齐。

## 10. 隐私交叉矩阵

每轮把三个玩家的 API 投影、事件流和 DOM 进行事后交叉审计：

| 类型 | 行动者 | 目标 | 第三人 |
|---|---|---|---|
| PRIVATE | 完整行动 + 回执 | 无或仅世界允许痕迹 | 无或仅世界允许痕迹 |
| LIMITED | 完整交涉 | 完整请求/可回应选项 | 无完整内容 |
| OBSERVABLE | 完整行动 + 回执 | 只见可观察痕迹 | 只见各自能力允许的痕迹 |
| PUBLIC | 完整公开行动 | 完整公开内容 | 完整公开内容 |

扫描字段和文本至少包括：

```text
method, intent, objective, fallback
leverageKey, hiddenSecret, privateBrief
unknown fact content, internal role key
prompt, statePatch, model reasoning, provider metadata
```

对 Role Agent 另做“输入前 + 模型调用摘要 + 结构化 action + 投影后”四点审计：

```text
允许：本角色 privateBrief、goals、knownFactIds、ownAssets、visibleTraces、availableActionCards、ownHistory
禁止：他人 privateBrief/完整 action、全量 Director state、未发布的裁决结果、Credits/支付令牌
留存：visibleFactIds、chosenActionKey、shortRationale、policyVersion/modelName、guardDecision
不留存：隐藏思维链、provider 原始内部 reasoning、他人秘密文本
```

另创建两个不同 room/run，在同一角色 `roleKey` 的私人简报中分别植入不同特征秘密。交叉扫描对方 Agent 输入摘要、缓存 key、action 理由和个人结果，跨 run 命中必须为 0；禁止复用 provider conversation/thread id。

任意未授权泄漏直接记为 `FAIL/PRIVACY_LEAK`，不能以“剧情更完整”为理由接受。

## 11. 建议脚本改造

`scripts/e2e/many-worlds-v13-browser-three-player.mjs` 只可作为旧流程定位参考，不能直接复用其 headless/localStorage Bearer/页面内 fetch/Runtime.evaluate 操作实现。新脚本必须重新实现：

1. 最终 MP/SP 固定使用内置 Browser 三个获准 origin 的可见标签页，不保留可让最终验收切回 `--headless=new` 或单一 origin 的开关；headless 另建低层回归命令。
2. 所有 `/room-game` 断言改为 `/game?runId=...`。
3. 删除旧 `[data-action-form]` 和 `[data-resolve]` 流程。
4. 增加按角色读取正式行动卡、提交 MAIN、执行 MANEUVER、处理 REACTION 的页面驱动器；只使用可见 locator/坐标点击与真实键盘输入。
5. 轮换三人的操作顺序，不能每轮固定 `Promise.all` 同时交作业。
6. 删除房主 `Resolve` 点击，等待事件流/页面自动进入收束。
7. 三个玩家每轮分别截图，不再只截房主最终页面。
8. 支付/测试点数准备与核心玩法脚本分层；受保护测试加点只在开局前执行，第 4 轮共享解锁必须点击正式 UI；辅助 API 不能被误计为玩家操作。
9. 失败诊断 GET 只写诊断目录，不向模拟玩家决策上下文暴露。
10. 新增独立 Prisma verifier，浏览器脚本不直接用 DB 决定下一步。
11. 删除所有 Runtime.evaluate 中的 `HTMLElement.click()`、人工 dispatchEvent 和页面内 fetch；自动化程序必须与用户一样经过按钮可用性、聚焦、输入、提交和路由跳转。
12. P1/P2/P3 各由独立盲决策进程读取自己的 screenshot/DOM 并输出 decision.json；中央 orchestrator 只调度页面条件，不合并私密上下文。
13. 新增 TAKE 驱动器：通过可见 UI 区分 `LEAVE_STAGE` 和 `HANDOFF_TO_AI`，可定点关闭单个 origin 标签页，并验证其他页控制器标签。
14. 新增 Role Agent 任务/控制转换审计器；它可事后查看 DB/任务，但不得把他人私密输入传回玩家决策进程。
15. 新增 barrier/fault hooks，确定性重现“人类末秒提交 vs 自动接管”和“reclaim vs Agent 密封”，不使用随机 sleep 碰运气。
16. 全员托管验收在三个标签页关闭后只轮询服务端审计/最终状态，不保持隐藏页面心跳，不替 Agent 提交行动。
17. 新增 A00 fail-closed preflight：动态 source fingerprint、dirty 保护、Supabase 隔离 schema/migration、DeepSeek live、端口、唯一 Worker 和内置 Browser 三 origin 权限全部 READY 后才允许开局。
18. 注册流程读取本次 `AUTH_MAIL_SINK_FILE`，只提取当前邮箱验证 URL，再让对应内置 Browser 标签页导航；登录后使用 HttpOnly Cookie session，SSE/补拉统一 `credentials: include`。
19. `pnpm build:vercel` 后对真实 `dist-vercel` 跑 `/`、`/game`、`/game/result`、`/room-game` 路由和 boot 401/403/404 矩阵；源目录 smoke 不得代替。
20. R7 驱动器不得在 FINAL_DAY 提前跳到结果；三页都必须完成 MAIN→MANEUVER→DONE/自动收束，并与 DB 的 R7 三条 MANEUVER 对齐。
21. 聚合器必须接收本次 acceptance-manifest 绝对路径、逐项校验 hash、仅选 manifest 当前 RunId；任何 `latest`/目录 glob/历史 PASS 回填直接失败。

建议新文件：

```text
scripts/e2e/continuous-strategy-three-player-browser.mjs
scripts/e2e/continuous-strategy-player-agent.mjs
scripts/e2e/continuous-strategy-role-agent-takeover.mjs
scripts/e2e/continuous-strategy-db-verifier.ts
scripts/e2e/continuous-strategy-faults.ts
scripts/e2e/continuous-strategy-control-auditor.ts
scripts/e2e/continuous-strategy-mail-sink-reader.mjs
scripts/acceptance/preflight-continuous-strategy.ps1
scripts/acceptance/continuous-strategy-production-route-smoke.mjs
scripts/acceptance/continuous-strategy-visual-fixture.mjs
scripts/acceptance/continuous-strategy-visual-fixtures/*.json
scripts/acceptance/continuous-strategy-visual-masks/*.json
scripts/acceptance/aggregate-continuous-strategy.mjs
```

## 12. 执行顺序

```text
A00 动态 baseline/dirty 保护 + DB/DeepSeek/端口/唯一 Worker/Email/内置 Browser 三 origin fail-closed 预检
→ A01 UT/类型检查
→ A02 Cookie Auth/file-sink 注册验证/API/IDOR/boot 401-403-404
→ A03 ActionWindow/RoleControl/Scheduler/Outbox
→ A04 Cookie SSE/补拉/cursor 隔离/隐私
→ A05 pnpm build:vercel 产物路由 + 正式 /game 单轮三浏览器纵切
→ A06 三浏览器七轮成功路线
→ A07 TAKE-001—013（13 逻辑组/15 cases）角色 Agent 接管路线
→ A08 盲模拟玩家五问与体验指标
→ A09 独立 DB/AI/隐私/控制转换读回
→ A10 FI-001—015 故障路线
→ A11 单人、Credits、认证、凯撒、UI01—UI08 回归
→ A12 fail-closed 聚合
```

每个失败必须保存 before、错误、最小修复任务、after 和影响面回归。修复后使用新 RunId 重跑完整三浏览器成功路线；旧 RunId 只能作为历史失败证据。

## 13. 最终报告

| 报告 | 必须内容 |
|---|---|
| acceptance manifest | attemptId、manifest SHA-256、动态 source/build/config fingerprint、每条 lane 当前 RunId、逐 artifact hash；证明未读历史证据 |
| 环境报告 | HEAD SHA、dirty/in-scope untracked 清单、服务 PID/端口、唯一 Worker 模式、migration、Supabase project/host/db/schema 脱敏 fingerprint、DeepSeek live、flag、计时配置 |
| 三浏览器大厅报告 | 三个 tabId、三个 origin、三账号 file-sink 验证、host-only Cookie session 隔离、邀请、角色、Ready、Start、同一 roomId |
| 路由/boot 报告 | 本地与 `pnpm build:vercel` 产物 hash；`/game`、`/game/result`、`/room-game`；匿名/401/403/404/5xx fail-closed 矩阵 |
| 七轮时间线 | 每轮三人的 visibleBasis、选择、MAIN/MANEUVER/REACTION、页面状态和时间戳 |
| 隐私报告 | 四级可见度矩阵、API/事件/DOM 交叉扫描、旧接口绕过结果 |
| DB 报告 | 全真人 RunId 的 3 个可玩 StoryRole/3 真人/1 worldActor（无 StoryRole 行）、7 窗口、21 HUMAN MAIN、21 MANEUVER、7 条 roleId=null 的 SYSTEM_ACTION、3 REACTION、7 结算、21 个人结果；接管 RunId 独立列 HUMAN/AI_TAKEOVER/FALLBACK、RoleControl/epoch/task 和去重 |
| Credits 报告 | 三账号测试 grant 幂等；成功 lane 的唯一 payer=P1；独立 UNLOCK-RACE lane 的唯一胜者/输家、一次共享 WORLD_UNLOCK、余额/ledger 读回；无真实付款且计数不混用 |
| Worker/AI 报告 | resolution/writer/Role Agent task、attempt、checkpoint、repair/fallback、延迟、重复副作用 |
| 接管报告 | TAKE-001—013 的 13 逻辑组/15 cases 各自 RunId、可见 UI 起点、presence、RoleControl transition/epoch、Agent 输入隐私、HUMAN/AI action、回归点和最终结局 |
| 模拟玩家报告 | 每轮五问、误解、操控感评分、他人影响识别、重玩意愿 |
| 视觉报告 | UI01—UI08 reference/actual/diff/geometry/metrics |
| 故障报告 | FI-001—015 的注入、恢复和最终 DB 一致性 |
| 聚合报告 | 测试总数、通过/失败/阻塞、修复轮次、剩余 P0、最终 verdict |

## 14. 退出规则

### 14.1 仅允许三种终态

| Verdict | 含义 | 必需证据 |
|---|---|---|
| `PASS` | 本次 acceptance-manifest 中所有必需 lane/门禁均执行且通过，失败、limitation、外部阻塞和未覆盖 P0 为 0 | 完整 manifest hash、当前 RunId 列表、全部 artifact hash 与下列 20 项退出门禁 |
| `FAIL` | 代码、migration、路由、鉴权、测试、隐私、去重、source drift、证据范围或 harness 合同任一失败 | `failure.json` 含 laneId/runId、断言、预期/实际、首个失败 artifact、修复入口；修复后新 attemptId/RunId 重跑 |
| `EXTERNAL_BLOCKED` | 仅限当前代码不可控制的已声明 Supabase 验收项目/连接、DeepSeek 凭据或服务、文件系统或桌面内置 Browser 运行环境等外部条件，在 fail-closed 预检或执行中不可用 | `blocker.json` 含 provider、UTC 时间、脱敏请求/错误、至少三次有界重试、已完成本地验证、恢复条件和从哪个 checkpoint 以新 RunId 重跑 |

`EXTERNAL_BLOCKED` 不是成功、不是 completion，也不能与旧 PASS 合并；端口错配、Cookie/SSE bug、路由 200/rewrite 错误、migration 缺失、测试脚本注入页面、Worker 双开和代码异常全部是 `FAIL`。`REPAIR_REQUIRED` 只可作为执行器内部非终态，持久化本轮结果时必须落为 `FAIL`；禁止 `PASS_WITH_LIMITATION`、`DOCUMENTED_BLOCKER`、`HARD_FAIL` 等第四种最终 verdict。

### 14.2 PASS 全部门禁

只有以下全部成立，最终状态才允许为纯 `PASS`：

1. 内置 Browser 三个获准 origin 的可见标签页从注册/登录完成同一房间的创建、邀请、选角、Ready 和 Start；大厅恰好只有三个真人角色可选，江南商会不可点击/不计 Ready；headless 或单页切角色结果不能替代。
2. 三页都进入唯一正式 `/game`，没有仿制页面、单页切角色或旧 `/room-game`。
3. 七轮全部通过可见 locator/坐标和真实键盘完成 21 MAIN、21 MANEUVER 和恰好 3 REACTION（R2:P3、R4:P1、R5:P2）；R7 明确包含 3 条 MANEUVER；无 evaluate/DOM mutation/脚本注入、`HTMLElement.click()`、事件注入或页面内 fetch。
4. 第一名提交后继续谋划，不出现大型等待页；房主不拥有结算职责。
5. 第 4 轮只通过正式 UI 发生一次共享解锁，三页继续同一房间且未发起真实付款。
6. DB 中 `StoryRun.engineVersion/strategyVersion=continuous_strategy_v1_1/sangtian_v1_1` 且运行中不可变，strategy registry/artifact hash 与 manifest 一致；恰有 3 个可玩 StoryRole、3 个真人 StoryPlayer、模板恰有 1 个不落 StoryRole 行的 worldActor、7 条 roleId=null 的 SYSTEM_ACTION、7 个窗口、7 个唯一结算、7 个公共结果和 21 个个人结果，无重复。
7. 每名玩家至少 5/7 轮受到另一真人选择的可识别影响。
8. 三份私人简报、事件、结果和结局全程隔离，隐私泄漏为 0。
9. 房主离线、玩家超时、按成员 deliverySequence 的 SSE 断线、FI-004 的 9 个 resolution 故障点（含三个角色投影、两个终端重入和 `PUBLISHED@R7 → RUN_COMPLETED`）、三个 Role Agent checkpoint 的 Worker 重启和 AI 失败均可恢复。
10. 三个盲模拟玩家平均每轮五问至少 4/5，操控感平均至少 4/5。
11. manifest 声明的 Supabase 隔离 schema 独立读回与 UI/API/事件证据属于同一 RunId 且完全一致。
12. 完整旧 endpoint deny-matrix 对匿名、非成员、当前成员、另一成员和合法管理员全部符合 ACL，无绕过。
13. 单人游戏、认证、Rooms、Credits、凯撒和 UI01—UI08 回归通过。
14. TAKE-001—013 的 13 逻辑组/15 cases 全部通过：短断线不误接管，中途退出不阻塞其他玩家，人/AI 同槽位双写为 0，旧 epoch 写入为 0。
15. TAKE-008 在 P1 以正式 UI 完成一次共享解锁后，三人全交托并关闭三个标签页/SSE，仍自动完成 R4–R7、7 结算、21 个人结果和三个个人结局。
16. Role Agent 只使用本角色投影，不泄露他人私密/裁决器状态/隐藏思维链，不调用 Credits、支付或解锁。
17. 全真人成功、UNLOCK-RACE、接管和故障 RunId 的计数不混用；各自 UI/API/事件/DB/Agent 证据完全一致，成功 lane 的 payer=P1 不被 race 胜者覆盖。
18. A00 动态 baseline/dirty 保护、Supabase 隔离 schema/migration、DeepSeek live、端口、唯一 Worker、file-sink 和内置 Browser 三 origin 预检全部 READY，执行期间无 source drift。
19. 本地与生产 build 产物的 `/game`、`/game/result`、`/room-game` 及匿名/401/403/404/5xx boot 矩阵全部通过；Cookie session SSE 无 Bearer/localStorage Token。
20. 聚合器只读取本次 acceptance-manifest 列出的当前 RunId/artifact 且所有哈希一致；`requiredCheckpointIds` 与 13 个 `D00,D01,D02,D02A,D03—D11` checkpoint 完全相等并全部 PASS；所有当前 RunId 的失败、阻塞、limitation、隐私泄漏、重复写入和未覆盖 P0 全部为 0。

任一条件不满足，本次终态为 `FAIL`；若且仅若符合 14.1 的外部条件才为 `EXTERNAL_BLOCKED`。继续修复或外部恢复后必须用新 attemptId/RunId 重测。最终不能使用“基本完成”“核心可用”“API 已跑通”、旧 RunId 或 `PASS_WITH_LIMITATION` 代替三个真实玩家完成七轮和角色 Agent 接管完成性的证据。
