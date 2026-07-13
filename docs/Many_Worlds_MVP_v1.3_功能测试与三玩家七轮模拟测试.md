# Many Worlds MVP v1.3 功能测试与三玩家七轮模拟测试

> 文档状态：PLANNED
> 编制日期：2026-07-13
> 主验收世界：《嘉靖财政危局》
> 核心玩家：浙江总督、浙江巡抚、清流县令
> 核心规模：3 个独立账号 × 7 个主轮次 × 每轮 1 次真人行动 = 21 次真人行动
> 测试目标：在一次连续验收中证明平台流程、Supabase 持久化、World Credits、房间与多人状态正确，三名玩家确实相互影响，AI 剧情连续且不越权，真实玩家能从注册登录玩到御前裁决；发现失败立即修复并重跑，直到当前 RunId 全部门禁纯 `PASS`。

## 0. 测试范围和不可替代原则

本测试覆盖：

```text
注册 / 登录 / 忘记密码 / session 恢复
Home / World Details
Rooms / Create / Join by Code / My Rooms
Host 优先选角 / 三人选角 / Ready / Start
《嘉靖财政危局》现有主游戏页面复用
三玩家七轮共同决策与相互影响
AI 连续性上下文 / Planner / Writer / Validator / fallback
断线、刷新、并发、重复提交、AI 超时和恢复
Game Result / 重玩 / 换角色 / 返回世界
5 个新增平台页面视觉与真实交互
Supabase 迁移 / 事务 / 对象隔离 / 独立读回
受控测试加点 / 世界解锁扣点 / 支付合同回归
```

以下结论不得互相替代：

- API 测试通过不等于浏览器完整流程通过。
- 单人《嘉靖财政危局》可玩不等于正式多人房间流程通过。
- `/trio` 脚本通过不等于新增 5 页面和正式 `/rooms/:roomId → /game` 通过。
- 21 次 action 落库不等于三名玩家确实相互影响。
- mock/fallback 通过不等于 live DeepSeek 通过。
- AI 文案流畅不等于事实、角色知识和因果连续性正确。
- 参考图像素接近不等于页面控件真实可用。
- 模拟玩家能完成不等于权限、隐私和数据库不变量正确。
- 支付曾经人工通过不等于本轮 Credits 账本、解锁扣点和幂等回归通过；但本轮禁止再次进行真实付款。

### 0.1 一次性验收与修复循环

本测试文档既是验收清单，也是后续自动执行的收敛合同：

```text
执行全部 P0/P1
→ 汇总当前 RunId 失败
→ 对每个失败实施最小安全修复
→ 重跑目标测试
→ 重跑受影响的 Auth/Room/Game/AI/Credits/Visual 回归
→ 重新执行三玩家七轮
→ 失败数 = 0、阻塞数 = 0、limitation 数 = 0
→ 纯 PASS
```

- `REPAIR_REQUIRED` 和 `PASS_WITH_LIMITATION` 只能是循环中的临时状态，不能作为最终交付。
- 可由代码、迁移、配置、测试账号、受控点数或服务重启解决的问题，不得转交用户后提前停止。
- 仅真实外部授权缺失或第三方持续不可用可形成精确 blocker；blocker 不算验收完成。

## 1. 测试分层

### 1.1 UT：单元测试

覆盖纯函数、Schema、状态迁移、权限、ActionGuard、Context Builder、Validator、资产 manifest 和结果投影。UT 不启动浏览器，不依赖真实模型。

### 1.2 IT：集成/API/数据库测试

覆盖真实 NestJS、Prisma、现有 Supabase PostgreSQL、迁移、事务、并发、幂等、Worker、Outbox、恢复、对象权限、Credits 账本和独立数据库读回。

### 1.3 E2E：浏览器功能测试

从真实 Web 页面操作；允许使用确定性 fixture 和测试邮件箱，但不得直接调用业务 API 替代点击流程。

### 1.4 VT：视觉测试

5 个新增平台页面与新参考图逐图比较；《嘉靖财政危局》现有主游戏页面只做冻结回归，不主动调整。

### 1.5 MP：三玩家七轮协议测试

使用三个独立身份、三个浏览器 context 和三个角色，验证 21 次行动、7 次唯一结算、跨玩家影响、私有投影、通知、AI 任务和结局。

### 1.6 NQ：叙事连续性质量测试

验证 Action Coverage、Fact Grounding、Knowledge Safety、Thread Recall、Prompt Bridge、内部键泄漏、时间地点和角色动机。

### 1.7 SP：模拟玩家测试

模拟玩家只能读取页面可见内容，不看后台字段、不读数据库、不接受主持人解释操作答案。

## 2. 当前基线与本轮重新执行规则

### 2.1 2026-07-13 当前实际结果

| 项目 | 当前结果 | 本轮使用方式 |
|---|---|---|
| `pnpm typecheck` | PASS | 仅为当前静态基线，后续必须重跑 |
| `pnpm lint:config` | PASS；7 天、12 决策、4 类谋划、5 全局结局、6 个人档位 | 单人《嘉靖财政危局》配置基线 |
| Web tests | 17 项中 16 PASS、1 FAIL | 版本冲突刷新提示需修复并回归 |
| API 纯规则断言 | PASS | 不能替代 HTTP/DB 测试 |
| API HTTP/DB 测试 | 一次旧命令因可选本地 `127.0.0.1:55434` 未启动而停止 | 不作为当前 blocker；本轮直接连接现有 Supabase 重跑 HTTP/持久化/读回 |
| 历史三玩家七轮 | 有 3×7×21、DeepSeek 证据 | 只作历史参考，不继承为新流程 PASS |
| Supabase 数据库 | 用户确认已经存在；仓库已支持 `DATABASE_URL`/`SUPABASE_DATABASE_URL` | 作为权威数据库验证，不再列为待建设项 |
| 支付 | 用户已实际测试通过 | 不重复真实支付；只跑签名、幂等、账本和解锁回归 |

### 2.2 新 RunId 规则

每次完整测试创建唯一 `RunId`，并记录：

```text
sourceSha / dirtyWorktreeDigest
supabaseProjectRef(masked) / databaseSchema / migrationVersion
webBuildId / apiBuildId / workerBuildId
browserVersion / viewport / DPR
AI provider / model / promptVersion
worldPackageVersion
testCreditGrantLedgerIds / worldUnlockSpendLedgerIds
paymentRegressionVersion
testStart / testEnd / timezone
```

所有报告、截图、日志、API transcript、DB readback 和 AI task 只允许聚合相同 RunId 的产物。

本轮是本地产品功能验收：Web、API、Worker 均可在本地进程运行，持久化使用现有 Supabase，AI 使用现有 DeepSeek。Railway 不参与启动门禁、测试计数或最终功能判定；部署准备可检查，但实际 Railway 部署记为独立 `NOT_RUN`，不算 blocker 或 limitation。

## 3. 环境与前置门禁

### 3.1 环境矩阵

| 环境 | 用途 | AI | 数据库 | 外部副作用 |
|---|---|---|---|---|
| test | UT/纯函数/可回滚故障注入 | deterministic mock | 隔离 schema/事务；必要时临时 PostgreSQL | 无 |
| local app + Supabase | API/浏览器流程和模拟玩家预演 | mock/fallback；授权时 live | 现有 Supabase，RunId 测试数据 | 仅测试账号；不依赖本地 55434 |
| local acceptance | 最终多人/Realtime/Worker/live AI | DeepSeek | 同一现有 Supabase 的明确测试数据边界 | 本地 Web/API/Worker；仅测试账号/测试数据/测试点数 |
| production | 本轮不执行破坏性测试 | 不触碰 | 不触碰 | OUT_OF_SCOPE |

### 3.2 环境启动门禁

计划命令：

```powershell
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed
pnpm typecheck
pnpm lint:config
pnpm --filter @apps/api test
pnpm --filter @apps/web test
pnpm test:api-contract
pnpm test:concurrency
pnpm test:ai-failure
pnpm test:provider-retry
pnpm test:storage-recovery
pnpm test:story:triad
pnpm test:world-credits
```

启动完整流程前必须证明：

- `DATABASE_URL`/`SUPABASE_DATABASE_URL` 已安全指向用户确认的 Supabase；`SELECT 1`、project/schema 指纹和 migration readback 成功，且报告不输出连接串。
- API `/health/live` 与 `/health/ready` 成功。
- Worker heartbeat 更新。
- Web 使用当前 API base，不连接旧进程或旧端口。
- 测试账号和测试房间可清理，不能触碰生产账号。
- `ALLOW_TEST_CREDIT_GRANT=true` 只在非生产验收进程中启用；生产进程、普通 UI 和非测试账号无法加点。

## 4. 证据目录

```text
docs/auto-execute/results/<RunId>/
docs/auto-execute/logs/<RunId>/
docs/auto-execute/api/<RunId>/
docs/auto-execute/db/<RunId>/
docs/auto-execute/ai/<RunId>/
docs/auto-execute/screenshots/<RunId>/<UI-ID>/round-<NN>/
docs/auto-execute/multiplayer/<RunId>/round-<01-07>/
docs/auto-execute/simulated-players/<RunId>/<PLAYER-ID>/
```

每个失败保留 before、错误、修复任务、after 和回归结果，禁止覆盖失败证据。

## 5. 测试夹具

| Fixture ID | 内容 | 用途 |
|---|---|---|
| FX-AUTH-001 | 三个已验证测试账号 + 一个未验证账号 | 登录、角色隔离、session |
| FX-AUTH-002 | 过期/撤销/篡改 Token | AuthGuard |
| FX-WORLD-001 | `sangtian` 完整 package | 核心七轮 |
| FX-WORLD-002 | `caesar_last_spring` package | 第二世界复用 |
| FX-WORLD-003 | Coming Soon 世界 | 不可进入运行态 |
| FX-ROOM-001 | 空的私有《嘉靖财政危局》房间 | Host 锁角 |
| FX-ROOM-002 | 2/3 waiting 房间 | Join/Ready |
| FX-ROOM-003 | full / started / closed 房间 | 负例 |
| FX-ROLE-001 | 浙江总督、浙江巡抚、清流县令 | 三名真人角色 |
| FX-AIROLE-001 | 江南商会、司礼监织造使 | AI 托管角色 |
| FX-MP-001 | 七轮确定性世界压力和三方行动意图 | 3×7 测试 |
| FX-CONC-001 | 两人同时认领浙江巡抚 | 角色唯一性 |
| FX-IDEM-001 | 重复 idempotencyKey、旧 version、双击提交 | 幂等/并发 |
| FX-AI-001 | timeout、非法 JSON、Schema 缺字段、知识越界、内部键泄漏 | repair/fallback |
| FX-REC-001 | Worker 中断、API 重启、浏览器刷新、SSE 断线 | 恢复 |
| FX-RESULT-001 | finished Run、有/无 optional world state | Result |
| FX-ASSET-001 | `docs/UI/web/pic/` 27 张临时素材 manifest | 新平台页资产 |
| FX-CREDIT-001 | 本 RunId 三个 `@example.test` 账号，各 200 BONUS 点数 | 两世界解锁、余额与账本；不足时按成本公式调整，单账号上限 1000 |
| FX-CREDIT-002 | 重复 grant/spend idempotencyKey、余额不足、非测试账号 | Credits 负例与幂等 |
| FX-PAY-001 | 测试签名/非法签名/重复 webhook payload | 支付合同回归，不触发真实付款 |

## 6. 功能测试总矩阵

### 6.1 环境、配置和资产

| ID | 测试点 | 操作 | 通过条件 |
|---|---|---|---|
| FT-ENV-001 | 可复现安装 | frozen lockfile 安装 | 无 lock 漂移，依赖完整 |
| FT-ENV-002 | migration | deploy + seed + readback | 两世界、三账号和 schema 版本一致 |
| FT-ENV-003 | 服务健康 | live/ready/worker heartbeat | Supabase 等依赖真实可用，不只进程存活 |
| FT-ENV-004 | Supabase 权威连接 | 脱敏指纹 + `SELECT 1` + API 写入 + SQL 读回 | 当前项目/schema/migration 一致，不回退到本地文件或 55434 |
| FT-CFG-001 | 桑田诏单人配置 | lint | 7 天、12 主线决策、结局不回归 |
| FT-CFG-002 | 桑田诏多人角色 | lint | 单人仅总督；多人开放总督/巡抚/县令 |
| FT-CFG-003 | 凯撒 package | lint | 6 角色、七幕、资源和引用有效 |
| FT-CFG-004 | 可玩世界清单 | GET worlds | 只有两个正式世界 playable |
| FT-ASSET-001 | 临时素材 manifest | hash/尺寸/语义扫描 | 27 张可索引，无损坏、重复 assetKey |
| FT-ASSET-002 | 平台页临时素材使用 | 扫 network/DOM | 仅通过 assetKey；标记 temporary_user_approved |
| FT-ASSET-003 | 后续替图能力 | 替换一个 manifest target | 页面无需改 HTML/CSS/JS 即更新素材 |
| FT-ASSET-004 | 冻结资产边界 | 扫《嘉靖》主游戏请求 | 不因平台临时素材改写游戏专属资产 |

### 6.2 认证

| ID | 测试点 | 通过条件 |
|---|---|---|
| FT-AUTH-001 | 注册 | 合法邮箱、8+ 密码创建账号，重复邮箱 409 |
| FT-AUTH-002 | 验证 | 一次性 token 只成功一次，过期/错误拒绝 |
| FT-AUTH-003 | 登录 | 正确账号返回安全 session；错误凭证统一错误 |
| FT-AUTH-004 | 忘记密码 | reset token 有效期、单次使用、旧密码失效 |
| FT-AUTH-005 | `me` | 返回当前账号，不含 passwordHash/tokenHash |
| FT-AUTH-006 | session expired | Web 显示过期并保存安全 returnTo |
| FT-AUTH-007 | returnTo | 登录后恢复 world/room 动作，非法外部 URL 拒绝 |
| FT-AUTH-008 | 三身份隔离 | 三 context 获取不同 userId/session/storage |
| FT-AUTH-009 | Token 安全 | 篡改、撤销、过期、错误 audience 全部 401 |
| FT-AUTH-010 | 对象权限 | 非成员不能读房间、Run、结果或私有事件 |

### 6.3 World Details 与导航

| ID | 测试点 | 通过条件 |
|---|---|---|
| FT-WORLD-001 | Home → Details | 两个可玩世界进入正确 `worldId` |
| FT-WORLD-002 | 动态内容 | title/hero/meta/roles/credits 来自 package |
| FT-WORLD-003 | 私密字段 | 角色预览不含 hidden goal/secret/ending |
| FT-WORLD-004 | Solo | 未登录去 auth，登录后去动态选角 |
| FT-WORLD-005 | Multiplayer | 未登录去 auth，登录后去带 world filter 的 Rooms |
| FT-WORLD-006 | Coming Soon | 不可建局，按钮无误导 |
| FT-WORLD-007 | 第二世界复用 | 凯撒与桑田诏共用页面/组件，无世界名硬编码 |
| FT-WORLD-008 | 凯撒七幕单人闭环 | 注册/登录→详情→选角→七幕 Game→Result→重玩全部通过 |
| FT-WORLD-009 | 凯撒多人复用 | 创建/加入→选角→Ready→Start→首轮结算通过，不停留在预览或假数据 |

### 6.3A World Credits 与支付回归

测试加点必须使用专用脚本或受保护管理命令，禁止在普通页面增加“免费加点”按钮。调用既有 `CreditsService.grantCredits` 时固定为：

```text
kind=BONUS
source=ADMIN
reason=ADMIN_ADJUSTMENT
idempotencyKey=test-credit:<RunId>:<userId>:acceptance
metadata.runId=<RunId>
metadata.purpose=acceptance
metadata.grantedBy=codex-test-harness
```

| ID | 测试点 | 通过条件 |
|---|---|---|
| FT-CREDIT-001 | 测试加点开关 | 仅 `NODE_ENV !== production` 且 `ALLOW_TEST_CREDIT_GRANT=true` 可执行 |
| FT-CREDIT-002 | 账号白名单 | 只允许本 RunId 创建的 `@example.test` 账号；真实账号拒绝 |
| FT-CREDIT-003 | 金额边界 | 默认 200；可按两世界成本加一次重试储备，单账号累计不超过 1000 |
| FT-CREDIT-004 | grant 幂等 | 相同 RunId/userId/purpose 执行两次只生成一条 grant ledger |
| FT-CREDIT-005 | 余额与读回 | API balance、transaction list 与 Supabase 独立 SQL 读回一致 |
| FT-CREDIT-006 | 世界解锁扣点 | 通过正式 Unlock API 扣点，生成 `WORLD_UNLOCK` ledger 和正确访问权 |
| FT-CREDIT-007 | spend 幂等 | 重复 unlock 不重复扣点；余额不足原子拒绝，无半完成 Run |
| FT-CREDIT-008 | 类型隔离 | 测试点数只能是 BONUS/ADMIN，不能生成 PURCHASED 或虚假支付订单 |
| FT-CREDIT-009 | 生产封闭 | production、普通 Web、非白名单账号均无法调用测试加点入口 |
| FT-PAY-001 | 已验证支付回归 | checkout/webhook 数据合同通过，不发起真实付款 |
| FT-PAY-002 | webhook 安全 | 非法签名拒绝，重复合法事件只处理一次 |
| FT-PAY-003 | 退款/争议合同 | 测试夹具下账本守恒、幂等且不影响其他用户 |

### 6.4 Rooms API 和页面

| ID | 测试点 | 操作 | 通过条件 |
|---|---|---|---|
| FT-ROOM-001 | Open Rooms | 加载列表 | 只显示公开、可加入、未开始房间 |
| FT-ROOM-002 | My Rooms | waiting/in-progress/completed | 显示 Open/Continue/View Result |
| FT-ROOM-003 | 世界筛选 | `worldId=sangtian` | 只显示该世界，可清除 |
| FT-ROOM-004 | Create modal | 创建私有房间 | Host、inviteCode、roomName、maxPlayers 正确 |
| FT-ROOM-005 | Join by code | 输入有效 code | 成为唯一成员，跳转等待页 |
| FT-ROOM-006 | 无效 code | 输入错误 | 稳定错误，不创建成员 |
| FT-ROOM-007 | 满/开始/关闭 | 尝试加入 | 分别明确拒绝，无 DB 写入 |
| FT-ROOM-008 | 已加入 | 再次 Join | 返回幂等成员结果，不重复 |
| FT-ROOM-009 | 自动刷新 | 其他 context 加入/离线 | 列表状态更新，不闪烁重复项 |
| FT-ROOM-010 | Close | Host 关闭 | waiting 房间关闭；非 Host 403 |

### 6.5 等待、选角、Ready 和 Start

| ID | 测试点 | 通过条件 |
|---|---|---|
| FT-LOBBY-001 | Host 首选 | Host 未锁角前邀请未开放或受限 |
| FT-LOBBY-002 | Host 锁浙江总督 | roleLockedAt 写入，邀请可复制 |
| FT-LOBBY-003 | 玩家加入 | 玩家列表和 3/5 状态正确 |
| FT-LOBBY-004 | 角色唯一 | 巡抚并发抢占只有一个成功 |
| FT-LOBBY-005 | 多人可玩性 | 总督/巡抚/县令可选；单人规则不改变 |
| FT-LOBBY-006 | Taken/Selected | 三 context 状态一致但 Selected by You 正确 |
| FT-LOBBY-007 | Ready | 每人仅能设置自己；换角色自动取消 Ready |
| FT-LOBBY-008 | Start 门槛 | 人数、角色、Ready、Host lock 全满足才启用 |
| FT-LOBBY-009 | Host 权限 | 非 Host Start 403；Host 只启动一次 |
| FT-LOBBY-010 | AI 填位 | 商会/司礼监未选角色由 AI 控制，不冒充真人 |

### 6.6 正式进入游戏与冻结页面回归

| ID | 测试点 | 通过条件 |
|---|---|---|
| FT-GAME-001 | Start 导航 | 三人进入同一 runId 的 `/game` |
| FT-GAME-002 | 角色投影 | 每人看到自己的角色、目标和可见信息 |
| FT-GAME-003 | 页面冻结 | UI01—UI08 骨架、尺寸、按钮位置和视觉无 material regression |
| FT-GAME-004 | 数据增强边界 | 多人身份/等待/投影不要求页面改版或新游戏布局 |
| FT-GAME-005 | 提交后等待 | 已提交者显示 Waiting；未提交者仍可操作 |
| FT-GAME-006 | 身份不可切换 | 用户不能通过 URL/localStorage 查看他人角色 |
| FT-GAME-007 | finished 只读 | 结束后写请求拒绝，导航 Result |
| FT-GAME-008 | 版本冲突提示 | 冲突后刷新最新状态并明确提示，不覆盖 |

### 6.7 状态机、并发和幂等

| ID | 测试点 | 通过条件 |
|---|---|---|
| FT-STATE-001 | 房间到游戏 | waiting → ready_check → starting → in_progress |
| FT-STATE-002 | 单轮提交 | 每个真人每轮最多一个 accepted action |
| FT-STATE-003 | 结算门槛 | 三人均提交或超时接管后才能 resolve |
| FT-STATE-004 | 唯一结算 | 每轮只有一个 resolution/event sequence |
| FT-STATE-005 | 双击 | 相同 key 返回同结果，不重复 action |
| FT-STATE-006 | 旧 version | 409 + currentVersion，状态不变 |
| FT-STATE-007 | 并发最后提交 | 多 Worker/请求只触发一个 resolve |
| FT-STATE-008 | 七轮推进 | round 1—7 单调，不能跳轮或倒退 |
| FT-STATE-009 | 第七轮结束 | 进入 finished，结果只生成一次 |
| FT-STATE-010 | 事件顺序 | StoryEvent/NarrativeEntry sequence 严格递增 |

### 6.8 ActionGuard 与玩家行动

| ID | 测试点 | 通过条件 |
|---|---|---|
| FT-GUARD-001 | 合法角色行动 | 符合身份、资源、时代、知识，接受 |
| FT-GUARD-002 | 越权 | 县令命令皇帝/巡抚直接改御旨，拒绝并给 rewrite |
| FT-GUARD-003 | 时代越界 | 手机、互联网、现代金融工具，拒绝 |
| FT-GUARD-004 | 未知事实 | 使用角色不知的暗账细节，拒绝或改写为调查 |
| FT-GUARD-005 | 操控他人 | 直接宣布他人服从/认罪，拒绝 |
| FT-GUARD-006 | 资源不足 | 使用未持有筹码，拒绝 |
| FT-GUARD-007 | 输入长度 | 1—200 合法；空白/201 拒绝 |
| FT-GUARD-008 | 拒绝不消耗 | 不写 action、不改 version、不推进 |

### 6.9 连续性上下文和 AI 协议

| ID | 测试点 | 通过条件 |
|---|---|---|
| FT-NAR-001 | World Bible | 时代、官职、七天骨架不可被 AI 改写 |
| FT-NAR-002 | Run Canon | 已确认事实后续不能被否定 |
| FT-NAR-003 | Scene State | 时间、地点、在场人物连续 |
| FT-NAR-004 | Character Minds | 三角色 known/unknown/believed 分离 |
| FT-NAR-005 | Story Threads | 到期线程回收、升级或显式延期 |
| FT-NAR-006 | Recent Window | 承接上一段动作/对话，不无解释跳场 |
| FT-NAR-007 | Planner 只读 | Planner 不能修改 statePatch |
| FT-NAR-008 | Writer grounded | 正文事实都有 factId/sourceEventId |
| FT-NAR-009 | 玩家视角 | 不输出他人隐藏动机和私密完整行动 |
| FT-NAR-010 | LabelDictionary | 玩家文案无内部 roleKey/stateKey |
| FT-NAR-011 | 下一压力 | endHook 能解释下一轮为什么出现 |
| FT-NAR-012 | repair | 硬失败回 Planner、软失败回 Writer，最多 2 次 |
| FT-NAR-013 | fallback | 双失败仍发布可读连续故事并继续 |
| FT-NAR-014 | 重复发布 | 同 sourceEventId 只有一个 published entry |

### 6.10 Worker、Realtime 和恢复

| ID | 测试点 | 通过条件 |
|---|---|---|
| FT-WORK-001 | 202 | 最后行动提交后返回 taskId/resolving |
| FT-WORK-002 | Outbox 原子性 | 状态与任务同事务，不能一有一无 |
| FT-WORK-003 | lease | 同任务只有一个 Worker 持有有效租约 |
| FT-WORK-004 | retry | 超时按 attempt/backoff 重试，不重复 patch |
| FT-WORK-005 | Reconciler | 过期任务被恢复或 fallback |
| FT-RT-001 | 私有频道 | 每人只收到授权投影 |
| FT-RT-002 | 断线补偿 | afterSequence 增量读取补齐缺失事件 |
| FT-REC-001 | 浏览器刷新 | 恢复同一 role/round/submit state |
| FT-REC-002 | API 重启 | Room/Run/sequence/active task 恢复 |
| FT-REC-003 | Worker 重启 | 任务继续且只结算一次 |
| FT-REC-004 | resolving 刷新 | 不重新提交，不静默创建新局 |

### 6.11 Game Result

| ID | 测试点 | 通过条件 |
|---|---|---|
| FT-RES-001 | 全局结局 | 三人一致，来自第 7 轮权威结果 |
| FT-RES-002 | 个人结局 | 三角色各自正确且不泄露他人隐藏字段 |
| FT-RES-003 | Key Decisions | 最多 3 条，均可追溯真实 sourceEventId |
| FT-RES-004 | 可选模块 | 无数据时 World State/Goals 完全隐藏 |
| FT-RES-005 | Play Again | 新建新 Run，不修改旧 Run |
| FT-RES-006 | Try Another Role | 回到正确世界/模式的选角或房间流 |
| FT-RES-007 | Back to Worlds | 返回 Home/World list，不残留私密状态 |

### 6.12 安全、可访问性、性能和报告

| ID | 测试点 | 通过条件 |
|---|---|---|
| FT-SEC-001 | 私密字段扫描 | API/DOM/日志无 hiddenGoal/privateReasoning/完整私密行动 |
| FT-SEC-002 | XSS | 玩家文本按纯文本显示，不执行 |
| FT-SEC-003 | IDOR | 枚举他人 roomId/runId/result 403/404 |
| FT-SEC-004 | 密钥 | 日志/证据无 API key、JWT secret |
| FT-A11Y-001 | 键盘 | 5 新页和游戏核心流程可 Tab/Enter/Space/Escape |
| FT-A11Y-002 | Modal 焦点 | Create/Join/critical modal 焦点锁定和恢复 |
| FT-A11Y-003 | 语义 | input label、button name、status live region 完整 |
| FT-PERF-001 | 首屏 | 无加载 reference/无用超大素材；临时图片按容器优化 |
| FT-PERF-002 | AI 反馈 | 提交后立即显示 resolving，不假死 |
| FT-PERF-003 | 七轮长局 | 滚动、输入、切换和内存保持可用 |
| FT-REPORT-001 | RunId | 全证据同一源码/环境/RunId |
| FT-REPORT-002 | 失败保留 | fail→repair→rerun 可追踪 |

## 7. 新增 5 页面视觉测试

### 7.1 Visual ID 映射

| Visual ID | Reference | Route/State | Viewport | 核心检查 |
|---|---|---|---|---|
| VT-NEW-001 | `...22_31_44 (1).png` | `/auth` login | 1600×1000 | Header、居中卡片、tabs、表单、条款、return context |
| VT-NEW-002 | `...22_31_44 (2).png` | `/worlds/sangtian` | 1600×1000 | Hero、角色预览、Solo/Multiplayer、meta |
| VT-NEW-003 | `...22_31_47 (3).png` | `/rooms?worldId=sangtian` | 1600×1000 | tabs、filter、列表、My Rooms、两个按钮 |
| VT-NEW-004 | `...22_31_49 (4).png` | `/rooms/:roomId` | 1600×1000 | 玩家列表、角色状态、invite、Ready/Start |
| VT-NEW-005 | `...22_31_50 (5).png` | `/game/result?runId=...` | 1600×1000 | Ending、Role、Key Decisions、Goals、三操作 |

每页每轮输出：

```text
reference.png
actual.png
diff.png
metrics.json
visual-summary.json
dom-snapshot.html
network-assets.json
interaction-trace.json
```

### 7.2 临时素材视觉规则

- 新平台页允许使用 `docs/UI/web/pic/` 中语义接近的临时头像/背景。
- 视觉比较时，素材内容差异可以标记为 `USER_APPROVED_TEMP_ASSET`，但容器尺寸、裁切、圆角、明暗、布局和不变形仍必须通过。
- 临时素材不能解释文本遮挡、错位、低对比、加载失败或错误人物复用。
- 每个临时素材都要有 assetKey 和 replacementStatus，便于用户后续统一替换。

### 7.3 Anti-cheat

产品页面不得：

```text
加载 5 张 reference 图作为 img/background/canvas
使用整页覆盖层
使用透明全页 hitbox
用 screenshot 代替真实控件
```

发现任一项，视觉状态直接 `HARD_FAIL`。

### 7.4 冻结主游戏回归

对《嘉靖财政危局》原首页、选角、UI01—UI08 执行截图/DOM/点击回归：

- 不要求因为本轮平台页而主动追求新的像素修复。
- 任何公共 Header/CSS/API client 改动引入的 material regression 必须修复。
- 允许新增多人数据状态，但不能改变既有页面骨架、主控件位置和核心交互。

## 8. 三玩家七轮核心验收设计

### 8.1 RunId 账号、点数和解锁准备

1. 通过 `/auth` 实际注册并验证三个带 RunId 的独立 `@example.test` 账号，不能直接向 User 表插入来替代注册流程。
2. 注册完成后用受控测试命令各增加默认 200 BONUS 点数，并立即执行第二次相同命令验证幂等。
3. 从 API 和 Supabase SQL 两条路径读回每个账号的 balance、grant ledgerId、kind/source/reason/idempotencyKey。
4. 三个账号分别通过正式 World Details/Unlock 流程解锁《嘉靖财政危局》；若凯撒也需要扣点，同一余额继续走正式解锁。
5. 记录解锁前后余额、spend ledgerId、Story Access/Run 归属；任何余额或账本不一致先修复，不进入七轮。
6. 测试账号、房间、事件和账本都带 RunId；不得修改用户已有账号和已有购买余额。

### 8.2 三个玩家角色

| 玩家 | 角色 | 公开目标 | 测试策略倾向 |
|---|---|---|---|
| P1 | 浙江总督 | 稳定浙江、协调财政/民心/皇权 | 平衡、留证、控制责任叙事 |
| P2 | 浙江巡抚 | 推进改桑、尽快见银、争取政绩 | 激进执行、抢先奏报、压缩阻力 |
| P3 | 清流县令 | 依法执行同时保护民田 | 查账、保民、保存证据、抵抗越权 |

AI 托管：江南商会、司礼监织造使；它们只能依据自身知识、利益和阈值行动。

### 8.3 多人七轮与单人 12 决策的关系

- 单人模式继续使用既有第 1—6 天每天 2 次主线决策，共 12 次，第 7 天裁决；不改变。
- 多人模式使用 7 个“每日主轮次”：每一天三名真人各提交一项完整角色行动，系统统一冲突结算一次。
- 第 1—6 天的两个单人压力槽在多人模式中作为同一日 Context/required pressures 输入，不要求每名玩家重复提交两次。
- 第 7 轮三人提交最终立场/自辩/证据处置，生成御前裁决。
- 两种模式共用世界事实、规则变量、结局和连续性领域层，但拥有独立的 round policy。

### 8.4 七轮行动剧本

以下是确定性测试意图，不是唯一正确玩法；模拟玩家可以在不越权的前提下改写文本。

| 轮次 | 世界压力 | P1 浙江总督 | P2 浙江巡抚 | P3 清流县令 | 必测相互影响 |
|---:|---|---|---|---|---|
| 1 | 改桑令、巡抚请命、商会递帖 | 先核田亩、限定期限、保留总督复核权 | 要求立即圈定桑田并公开执行进度 | 提交民田风险清单，请求先核契后动田 | 巡抚推进与县令保民冲突；总督时限同时约束二人 |
| 2 | 县令密信、地方催政 | 建立双人交叉核验，秘密保存副本 | 要求收缴县级底稿并追查泄密 | 通过另一渠道递交田契副本并保护书吏 | 巡抚的收缴行动改变县令证据路径；总督能否保护证人受二人影响 |
| 3 | 粮价上涨、商会控粮 | 有条件开仓并要求商会/巡抚公开经手账 | 把粮价责任归于地方拖延，要求加速改桑换银 | 发布可核验粮价与民田数据，请求暂缓强征 | 三人对粮价责任的叙事互相冲突并改变商会立场 |
| 4 | 暗账浮出、灭证风险 | 封存暗账、建立证据链并限制单方接触 | 主张暗账不完整，争取先控制原件和经手人 | 交出副本但保留来源保护，指认可核验账目 | 谁控制原件/副本影响后续弹劾资格和三方信任 |
| 5 | 互相弹劾、内阁/司礼监介入 | 按事实拆分责任，拒绝无证据全面清洗 | 抢先弹劾县令阻挠国策并质疑总督迟疑 | 反证巡抚越权征田，请求公开复核 | 三份责任叙事直接互相伤害并决定京师先听谁 |
| 6 | 京师回批、最终奏报 | 汇总粮价、田契、暗账和执行结果形成主奏 | 单独密奏执行政绩，淡化暗账责任 | 提交证据目录和民情附奏，要求保留审计链 | 三份奏报互相引用/反驳，决定第 7 轮可用事实 |
| 7 | 御前裁决 | 说明稳局结果、承认责任并提交最终方案 | 为强力执行辩护，争取把失败归因于阻挠 | 为保民与查账辩护，提交证据来源与风险 | 全局结局与三份个人结局必须引用前六轮真实事实 |

### 8.5 每轮硬断言

每轮必须满足：

1. 三个不同 userId 各有且仅有一个 accepted action。
2. action 的 roleId 与登录用户在该 Run 的角色一致。
3. 本轮只有一个权威 `DirectorResolution` / `round_resolved`。
4. `StoryEvent.sequence` 和 `NarrativeEntry.sequence` 严格递增。
5. 至少生成一个公共世界变化和三个角色私有投影。
6. 每名玩家至少看到一项由另一玩家行动引起的变化。
7. 每轮至少有两条带 `sourceActorRoleKey → affectedRoleKey` 的跨玩家影响边。
8. 七轮结束时六个有向角色对（P1→P2、P1→P3、P2→P1、P2→P3、P3→P1、P3→P2）都至少出现一次有效影响。
9. 私密行动原文只对提交者和授权投影可见；他人最多看到合理结果或迹象。
10. AI 托管角色行动有触发条件和 source facts，不能随机抢戏。

### 8.6 全局计数断言

最终数据库至少证明：

```text
human players = 3
unique human roles = 3
rounds = 7
accepted human actions = 21
authoritative resolutions = 7
published public round narratives = 7
published private role projections = 21
final global ending = 1
personal endings = 3
duplicate action/resolution/statePatch = 0
privacy violations = 0
test credit grants = 3
duplicate test credit grants = 0
world unlock spend per account/world = 1
fake purchased credit rows = 0
```

AI 逻辑任务的推荐精确合同：

```text
NarrativePlanner = 7 logical tasks
NarrativeWriter = 21 logical tasks（每轮每角色 1 个隔离 Writer）
```

若实现选择“一次 Writer 返回三个隔离投影”，必须在开发前修改合同并证明输出隔离；最终报告必须声明预期任务数、实际任务数、provider 调用数、fallback 数和重复数，不能用模糊“若干 AI 任务”。

### 8.7 连续性硬断言

全七轮必须满足：

- 至少 4 次跨日因果回收。
- 第 4 轮回收第 1—2 轮至少一个田亩/密信事实。
- 第 5 轮弹劾引用第 3 轮粮价责任或商会选择。
- 第 6 轮奏报引用至少 3 个前序 factId。
- 第 7 轮裁决引用至少 3 个不同轮次的事实，并能回溯 sourceEventId。
- 无时间倒退、无无解释跳地点、无离场角色直接发言。
- 角色不使用其未知事实；错误认知必须标记 believed，不能伪装 confirmed。
- 无内部键、JSON 字段、模型术语、prompt、statePatch 泄漏。
- 下一轮压力由上一轮 story endHook 合理导出。

### 8.8 故障注入轮次

完整成功路线之外，至少执行以下独立故障路线：

| ID | 注入 | 通过条件 |
|---|---|---|
| MP-FAIL-001 | P2 双击提交 | 只落一条 action |
| MP-FAIL-002 | P3 使用旧 version | 409，刷新后可重新提交 |
| MP-FAIL-003 | P1 提交后刷新 | 恢复 Waiting，不重复提交 |
| MP-FAIL-004 | P2 在第 3 轮断线 | 重连补齐事件并继续 |
| MP-FAIL-005 | 最后行动同时触发两个 resolve | 只生成一个 resolution |
| MP-FAIL-006 | 第 4 轮 Planner timeout 一次 | retry 成功，不重复 patch |
| MP-FAIL-007 | 第 5 轮 Writer 知识越界 | Validator 拒绝并 repair/fallback |
| MP-FAIL-008 | Worker 在发布前重启 | Reconciler 恢复，只发布一次 |
| MP-FAIL-009 | Realtime 丢一条消息 | HTTP afterSequence 补偿 |
| MP-FAIL-010 | AI 双失败 | fallback 完成该轮并进入下一轮 |

## 9. 叙事质量自动指标

| 指标 | 定义 | 门槛 |
|---|---|---:|
| Action Coverage | 正文明确体现三名玩家行动 | 100% |
| Fact Grounding | 可核验剧情事实有 factId/sourceEventId | 100% |
| Knowledge Safety | 角色使用未知事实 | 0 |
| Internal Key Leakage | 内部键/技术字段泄漏 | 0 |
| Prompt Bridge | 下一轮有上轮剧情原因 | 100% |
| Thread Recall | 到期线程未处理 | 0 |
| Cross-player Visibility | 每人每轮看到至少一项他人影响 | 100% |
| Pair Coverage | 六个有向角色对至少一次影响 | 100% |
| Duplicate Publish | 同 sourceEvent 多个 published entry | 0 |
| Template Repetition | 连续三轮同模板开头/结尾 | 0 |

软质量评分：上下文承接 ≥85、玩家行动体现 ≥90、角色动机一致 ≥85、视角正确 ≥95、下一钩子自然 ≥80，总分低于 85 必须 repair 或 fallback。

## 10. 三玩家模拟玩家测试

### 10.1 执行规则

- 使用三个独立浏览器 context，不共享 cookie/localStorage/sessionStorage。
- 三名模拟玩家只能通过可见 UI 操作；主持人不得直接调用 API 推进。
- 玩家可根据表中“策略倾向”自由改写行动，不得逐字复制后台 patch 或隐藏结果。
- 每一步记录截图、点击、输入、停顿、误解、刷新、错误、恢复和玩家口头理解。
- 若使用 LLM 扮演玩家，输入只能包含该角色当前页面可见信息，不能包含完整剧本或其他角色私密数据。

### 10.2 玩家人物设定

#### SP-P1：谨慎的浙江总督

- 优先稳局、留证和控制责任叙事。
- 不主动知道暗账全貌。
- 在巡抚和县令冲突时尝试设定程序和时限。

#### SP-P2：进取的浙江巡抚

- 优先推进改桑、尽快见银和抢先奏报。
- 会利用总督迟疑和县令阻力争取政治优势。
- 不得凭空知道县令所有证据渠道。

#### SP-P3：保民查账的清流县令

- 优先保护民田、保存田契证据和避免成为替罪羊。
- 权力较低，必须通过文书、证人、密信和上级程序行动。
- 不得直接命令总督、巡抚或皇帝。

### 10.3 首次完整流程场景

| ID | 玩家任务 | 通过标准 |
|---|---|---|
| SP-001 | P1 注册并进入世界详情 | 3 分钟内理解世界和 Solo/Multiplayer |
| SP-002 | P1 创建房间并锁浙江总督 | 无主持人提示完成 |
| SP-003 | P2/P3 通过邀请登录加入 | 登录后回到正确房间，不迷路 |
| SP-004 | 三人选择不同角色 | 理解 Available/Taken/Selected |
| SP-005 | 三人 Ready，P1 Start | 能说出未选角色由 AI 控制 |

### 10.4 七轮体验场景

每轮结束三名玩家分别回答：

```text
我本轮做了什么？
哪一名玩家的行动影响了我？
我看见的世界变化是什么？
我现在最担心什么？
下一轮为什么会发生？
```

每名玩家每轮至少答对 4/5；任一玩家连续两轮低于 4/5，判定连续性/信息呈现失败。

| ID | 场景 | 观察点 | 通过标准 |
|---|---|---|---|
| SP-006 | 第 1 轮提交 | 是否理解多人等待 | 不误以为卡死，不重复提交 |
| SP-007 | 阅读第 1 轮结果 | 是否分清自己/他人/世界影响 | 能指出具体影响来源 |
| SP-008 | 第 2 轮密信 | 是否理解私密信息边界 | 不期待看到他人完整行动 |
| SP-009 | 第 3 轮粮价 | 是否看到前一轮选择的影响 | 能关联至少一个历史事实 |
| SP-010 | 第 4 轮暗账 | 证据来源是否连续 | 能说明原件/副本/持有人差异 |
| SP-011 | 第 5 轮弹劾 | 三方责任叙事是否清楚 | 能说明谁在指控谁以及依据 |
| SP-012 | 第 6 轮奏报 | 历史选择是否被回收 | 能指出至少两个前序决定 |
| SP-013 | 第 7 轮裁决 | 是否认为结局由三方共同造成 | 每人指出至少两条真实因果 |

### 10.5 恢复和返回场景

| ID | 玩家任务 | 通过标准 |
|---|---|---|
| SP-014 | P2 第 3 轮刷新 | 回到同一房间/角色/轮次 |
| SP-015 | P3 提交后离开再回来 | 显示已提交/Waiting，不重复 |
| SP-016 | P1 从 My Rooms Continue | 进入正确 in-progress Run |
| SP-017 | 完成后 View Result | 三人各见正确个人结局 |
| SP-018 | Play Again | 新 Run、旧结果保留 |
| SP-019 | Try Another Role | 回到正确角色/房间流程 |

### 10.6 模拟玩家执行轮次

1. 预演轮：3 个内部模拟玩家，验证脚本、账号和环境，不计产品指标。
2. 核心轮：3 个首次模拟玩家完整走完注册到第 7 轮结果。
3. 故障轮：重复提交、刷新、断线、AI timeout 和 Worker 重启。
4. 修复复测：使用新的玩家或清空学习状态，复测所有 P0 缺陷。
5. 若任何 P0 阻断、隐私泄漏、死局或重复结算，立即停止纯成功路线并进入修复。

## 11. 模拟玩家指标

| 指标 | 通过门槛 |
|---|---:|
| 注册/登录完成率 | 3/3 |
| 邀请回房间成功率 | 2/2 被邀请者 |
| 选角与 Ready 无提示完成 | 3/3 |
| 七轮完成率 | 3/3 |
| 每轮正确识别他人影响 | 每人 ≥6/7 轮 |
| 每轮五问得分 | 每人平均 ≥4/5 |
| 私密信息误解 | 0 个严重误解 |
| 重复提交造成重复结果 | 0 |
| 刷新/断线后恢复 | 100% |
| 结局因果复述 | 每人至少 2 条真实事实 |
| 愿意用另一角色重玩 | 至少 2/3 |

## 12. 判定规则

### 12.1 功能判定

- 任一认证/权限/房间/结算/隐私 P0 失败：`REPAIR_REQUIRED` 或 `HARD_FAIL`。
- 无当前 Supabase 独立读回的写功能不能判完整通过；本地文件或旧本地 PostgreSQL 结果不能替代。
- 注册登录、创建/选择房间、测试点数不足、迁移差异和普通代码缺陷均属于可修复项，不得标为外部 blocker。
- 21 action 不等于 7 resolution；两者必须分别证明。
- 三玩家都看到相同全文且包含私密信息：`HARD_FAIL`。
- 同轮重复 statePatch、resolution 或 NarrativeEntry：`HARD_FAIL`。

### 12.2 AI 判定

- live DeepSeek 未授权或未执行时不能最终 PASS；先检查现有安全环境和部署密钥，确实缺失才记录精确外部 blocker。
- fallback 通过证明可恢复，不证明 live 文案质量。
- 文案好看但 fact/knowledge/sequence 失败，仍为功能失败。
- repair 次数、fallback 原因、token/latency 必须进入 AiTask 证据。

### 12.3 视觉判定

- 临时素材内容差异可按用户授权标记，不影响页面结构验收。
- 缺 actual/diff/metrics/summary 的页面不得纯 PASS。
- reference-as-page、透明热区或整页覆盖直接 `HARD_FAIL`。
- 冻结游戏页出现公共改动导致的 material regression，必须修复。

### 12.4 模拟玩家判定

- 功能测试通过但玩家无法理解他人影响或下一轮原因：体验未完成。
- 玩家能完成但发生隐私泄漏：安全仍失败。
- 主持人需要解释操作答案才能继续：对应场景失败。

### 12.5 blocker 判定

以下都不是 blocker，必须由执行者继续修复：认证页面或 API 缺失、密码规则冲突、returnTo 错误、房间/选角/Ready/Start 未实现、并发冲突、Supabase migration 差异、测试点数不足、AI 输出不合格、视觉偏差和自动测试失败。

只有在完成凭据搜索、连接诊断、配置校验和有限重试后，仍出现以下情况才允许记录本地功能 blocker：运行环境完全没有所需的 Supabase 或 DeepSeek 授权，或对应第三方服务持续不可用。用户已说明这些环境应可用，因此默认先按配置/代码问题排查。Railway 与本地功能验收无关，不能被记录为本轮 blocker。任何 blocker 都必须包含脱敏错误、已尝试动作、最后成功时间和解除所需的唯一外部输入；它不算完成，也不能转换成 `PASS_WITH_LIMITATION`。

## 13. 必须生成的报告

| 报告 | 必须内容 |
|---|---|
| 基线与环境报告 | SHA、dirty digest、服务、Supabase 脱敏指纹、migration、RunId |
| 功能测试报告 | FT 总数、执行/通过/失败/阻塞、命令和日志 |
| Auth/权限报告 | 三账号、Token 负例、IDOR、对象权限 |
| Rooms/并发报告 | create/join/role/ready/start/close、并发和 DB 读回 |
| Credits/支付回归报告 | 三账号 grant/spend ledger、幂等、余额读回、生产封闭、支付合同；不得含真实付款或密钥 |
| 凯撒完整流程报告 | 七幕单人闭环、Result/重玩和多人房间首轮复用 |
| 5 页面视觉报告 | 每页每轮 reference/actual/diff/metrics/deviation/修复 |
| 临时素材报告 | pic assetKey、原文件、hash、使用页面、裁切、替换状态 |
| 冻结游戏页回归报告 | 原页面 DOM/视觉/点击无回归 |
| 三玩家七轮报告 | 3 账号、3 角色、7 轮、21 action、7 resolution、影响边、通知、AI task |
| 叙事连续性报告 | facts、minds、threads、跨日回收、质量指标、泄漏扫描 |
| 故障恢复报告 | 双击、旧 version、断线、API/Worker 重启、AI failure |
| 模拟玩家报告 | 每玩家操作序列、五问、误解、完成率、重玩意愿 |
| Game Result 报告 | 全局/个人结局、关键决策 sourceEventId、操作按钮 |
| 最终聚合报告 | 当前 RunId 的 fail-closed verdict、测试/修复轮次和剩余失败/阻塞/limitation（纯 PASS 时均为 0） |

## 14. 最终退出规则

只有以下全部满足，最终状态才允许为纯 `PASS`：

1. 5 个新增页面真实可用，视觉结构和交互通过。
2. 新页面临时头像/背景全部来自受控 asset manifest，可后续无代码替换。
3. 《嘉靖财政危局》单人现有页面和 7 天/12 决策不回归。
4. 凯撒完成七幕单人 Game/Result/重玩，并通过多人房间到首轮结算复用测试，不存在预览-only 或 limitation。
5. 正式多人流程从注册/登录、房间、选角、Ready、Start 到 Result 全部通过。
6. 三个独立账号分别扮演浙江总督、浙江巡抚、清流县令。
7. 三个测试账号的受控 BONUS 加点、Supabase 账本读回、世界解锁扣点、幂等和生产封闭全部通过；支付合同回归通过且未发生真实付款。
8. 七轮共 21 次真人行动、7 次唯一 resolution、21 个私有角色投影，无重复落账。
9. 每轮每名玩家都能看到至少一项由他人行动造成的影响，六个有向角色对全部覆盖。
10. 第 7 轮结局可追溯前六轮真实事实，至少 4 次跨日因果回收。
11. 无角色知识越界、内部键泄漏、私密信息串号、IDOR、XSS 或密钥泄漏。
12. AI retry/repair/fallback、Worker/Outbox、刷新/断线/重启恢复均有证据。
13. 三名模拟玩家都能独立完成七轮并解释自己的行动、他人影响、世界变化和结局因果。
14. 所有 UI、API、Supabase、AI、Credits 和模拟玩家证据属于同一 RunId，旧 PASS 不参与最终聚合。
15. 当前 RunId 的失败数、阻塞数、limitation 数、未覆盖 P0/P1 数全部为 0。

任一条件不满足，执行状态回到 `REPAIR_REQUIRED` 并继续修复、重测；只有真正的外部 blocker 可以暂停，但不算完成。最终交付状态只允许纯 `PASS`，不能以 `PASS_WITH_LIMITATION`、“基本完成”或“等待后续开发”代替。
