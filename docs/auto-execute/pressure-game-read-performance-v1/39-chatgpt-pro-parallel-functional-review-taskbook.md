# Pressure GET `/game` 并行功能等价性审查任务书

## 背景与目标

这是 Pressure GET `/game` SQL7 式聚合快照优化的独立、只读并行审查。主开发对话正在单独完成 M4D2，因此本任务不得修改或重新实现 M4D2。

唯一目标：审查随附源码包中已经落地的 M1、M2、M3、M4A、M4C、M4D1、M5A、M5B、M5C，确认优化前后的玩家可见功能和安全边界是否保持一致，并找出会阻止真实 REPLAY/SHADOW/FAST 验收的具体缺陷。

## 源码基线

- 仓库：aiStoryRoom
- 基线 commit：`a98ef29c43545ebef985176e952fc756b33bcce1`
- 专用分支：`codex/chatgpt-pro-pressure-performance-v2`
- 随附 ZIP 只含本任务需要的脱敏源码、diff、文档和测试，不含 `.git`、依赖、环境文件或凭据。

## 当前架构与单一权威

- PostgreSQL/Supabase 仍是权威；聚合快照只改变正常 GET `/game` 的读取形状，不得形成第二权威。
- REPLAY 是旧读取语义；SHADOW 比较新旧投影但返回旧结果；FAST 返回聚合快照投影。
- 权限检查必须先于任何快照读取。
- FAST、SHADOW、REPLAY 的公开 Projection 必须规范化后完全一致。
- 观测只能旁路记录 application SQL、协议往返、事务、耗时和结果；失败不得改变 HTTP 业务行为。

## 审查范围

重点审查：

1. `game-read-snapshot*` 合同、严格 decoder、Prisma 聚合 reader、snapshot projector。
2. mode selector 与 production composition/wiring。
3. M4D1 access adapter 是否严格一条 SQL、是否保持跨房间/未授权/重复行 fail-closed。
4. M5A/M5B 观测是否准确区分 application SQL、protocol roundtrip、transaction outcome，是否可能泄漏数据或改变请求结果。
5. M5C runner 是否真的先证明 REPLAY=SHADOW=FAST，再做 cold 1 + warm 10，并只做一次 SQL7 submit + N2 readback；失败是否不会自动重复整套真实场景。
6. 幂等、并发、恢复、过期 revision、空/重复/错误快照、SHADOW mismatch 等失败边界。

## 禁止修改

- 不得修改任何源码、页面、数据库 schema/migration、公开合同、路由、结算规则、剧情内容、配置或 Git 状态。
- 不得修改或建议替换当前 M4D2 的两个文件：
  - `apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.ts`
  - `apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.spec.ts`
- 不得运行真实 Supabase、部署、迁移、提交或推送。
- 不得把静态审查或模拟测试声称为真实环境 PASS。

## 必须交付

只交付一个可下载 UTF-8 Markdown 文件：

`Pressure_GET_game_parallel_functional_review_a98ef29c.md`

内容必须包含：

- `VERDICT`：`NO_BLOCKER_FOUND` 或 `BLOCKER_FOUND`；
- 按严重度排序的具体问题，每项给出准确文件、代码位置/符号、触发条件、影响、最小修正建议；
- 功能等价矩阵：成功、未授权、跨房间、无 route、快照错误、SHADOW mismatch、观测失败、SQL7 submit/readback；
- 对 M5C 是否满足“只执行一次真实场景、不自动重跑整套”的明确结论；
- 尚需 Codex 在真实环境验证的项目；
- 明确声明本任务是只读审查，未修改源码、未运行真实 Supabase。

不要只在聊天中给口头结论，必须提供可下载文件。
