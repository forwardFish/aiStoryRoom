# Pressure GET `/game` 最终验收矩阵

更新时间：2026-08-15

本矩阵把正式任务书中的完成条件固定为一次统一验收清单。它不替代任务书，也不把模块候选、ChatGPT Pro 自述或离线测试提升为整体 PASS。

## 1. 固定交付边界

| 项目 | 要求 | 当前证据/状态 |
|---|---|---|
| 开发方式 | 主要业务代码只由网页版 ChatGPT Pro 普通 Chat 模式完成 | M1、M2、M3、M4A 已有 Pro 工件；I1、M4B、M5A 在三个独立普通 Chat 中运行；M5B 待依赖完成后发送 |
| Git | 专用分支 `codex/chatgpt-pro-pressure-performance-v2`；最终只提交、推送该远程分支 | 当前分支正确，尚未提交、推送；不得合并、部署或迁移 |
| 页面边界 | `apps/web/**` 零修改；正式 `/game` 页面、路由和公共响应合同不变 | 最终以 diff 文件清单和合同测试证明 |
| 数据库边界 | 不新增表、列、索引、数据库或 Migration | 最终以 diff 文件清单和 schema/migration 路径检查证明 |
| 单一权威 | PostgreSQL/Supabase 仍是唯一运行时权威；不引入缓存或文件第二权威 | 最终以生产代码审查和 FAST 真实读取证明 |
| 模块边界 | Reader 只读/解码；Projector 唯一；Selector 只编排；Observability 不改变业务结果 | 分模块审查；任何公共合同、数据库、路由或权威链扩张都重新停门 |

## 2. 模块门禁

| 模块 | 必须证明 | 当前状态 | 最终证据 |
|---|---|---|---|
| M1 `GameReadSnapshotV1` | route/chapter/viewer/revision/head/hash/fence/private/feed 严格 fail-closed | `ACCEPTED`（冻结基线 20/20、typecheck、diff check） | I1 在最新 `main` 兼容后的同范围测试 |
| M2 Prisma Aggregate Reader | 参数化单语句聚合；跨 run/seat 隔离；正常路径最多 2 application SQL | `OFFLINE_ACCEPTED_WITH_TEST_CORRECTION`；真实 PostgreSQL 开放 | 生产代码复核、真实 SQL/协议/事务证据 |
| M3 Unique Projector | 不复制 sanitize/capability/hash；P0 与 N1–N7 汇入唯一正式 Projector | `ACCEPTED`（冻结基线 47/47、typecheck、0 review issue） | I1 最新 `main` 兼容测试，保留 turn presentation 权威链 |
| M4A Mode Selector | REPLAY/SHADOW/FAST 纯选择合同 | `OFFLINE_ACCEPTED / NOT_WIRED`（63/63、typecheck） | 统一接线测试 |
| M4B Composition Wiring | 正式 GET 接线；REPLAY 返回旧链；SHADOW 返回旧结果并比较；FAST fail-closed | Pro 开发中 | Pro 工件 hash、独立测试、HTTP/ProductRoot 审查 |
| M5A Pure Observation | 请求级 SQL/协议/事务/阶段耗时的纯合同和汇总，不接运行时 | Pro 开发中 | Pro 工件 hash、聚焦测试、typecheck |
| M5B Runtime Wiring | 请求隔离观测接入正式 GET；不把调试字段返回玩家 | 等待 M4B；禁止提前重叠开发 | Pro 工件 hash、请求级测试、生产代码审查 |

## 3. 一次统一离线功能门

各工件先只重跑自己的最小失败用例。全部机械集成到届时准确的 `origin/main` 后，统一离线门只执行一次：

1. M1–M5 新增/修改的全部聚焦 spec；
2. `game-projection.service.spec.ts`；
3. `decision-presentation.spec.ts`；
4. `pressure-chapter-http.facade.spec.ts` 及 ProductRoot/selector 对应 spec；
5. `pnpm --filter @apps/api typecheck`；
6. `pnpm test:pressure-chapter:final`；
7. `git diff --check`；
8. 变更文件边界、秘密、schema/migration、`apps/web/**` 检查。

失败先归属为合同、Reader、Projector、Selector、HTTP composition 或 Observability，只重跑失败的最小用例；修正完成后才重跑受影响门，不循环运行真实 fixture。

离线 PASS 仅能证明候选代码和固定 fixture，不等于 SHADOW、数据库访问、延迟或玩家流程 PASS。

## 4. 功能等价硬门

FAST 性能测量前必须先证明：

- N1–N7、六席；
- `HUMAN_ACTIVE` / `AI_ACTIVE`；
- `SOLO_BEAT` / `TARGETED_INTERACTION` / `SYNC_CONTEST`；
- Narrative `PENDING` / `PUBLISHED` / `FALLBACK_PUBLISHED`；
- 有/无 decision、tokens、私人资源；
- Feed 空页、分页、私人 audience；
- route、revision、epoch、fence 变化；
- 章节冻结和终局前状态；
- 最新 `PressureTurnPresentationServiceV1`、`turnPresentations`、统一 story/decision turn 和 canonical seat 映射。

每个 SHADOW 样本必须满足：HTTP 正式响应深相等，且 `projectionHash`、seat、routeHash、chapterRuntimeId、workingRevision、Narrative source、capabilities、资源、tokens、决策选项、Feed audience/cursor/limit 全部一致。任何差异先停 FAST，并修复唯一责任模块；不得忽略字段或修改 REPLAY 迎合 FAST。

## 5. 一次真实前后对比

在 SHADOW 全等后，使用同一 non-production run、同一 viewer、同一 feed cursor/limit、同一 Supabase 区域和连接池，并关闭/隔离 Pressure 后台 worker：

| 场景 | 模式 | 样本用途 | 必须记录 |
|---|---|---|---|
| 普通 GET | REPLAY | 修改前可比基线 | application SQL、protocol roundtrip、tx attempt/commit/rollback/retry、API 总耗时、阶段耗时、响应 hash |
| 同一普通 GET | SHADOW | 功能等价证据 | REPLAY/FAST 深比较结果、两侧 hash、差异路径 |
| 同一普通 GET | FAST | 修改后访问量 | 与 REPLAY 相同指标 |
| N1 提交到首次 N2 GET | SQL7 POST + FAST GET | 完整最短前台链 | POST 与 GET 分段 SQL/往返/事务/耗时 |
| FAST GET warm | FAST | 延迟分布 | 至少 10 个 warm 样本的原始值、p50、p95；失败/超时不得删除 |

若现有 `SANGTIAN_ACTION_RELEASE_ARTIFACT_HASH_MISMATCH` 在数据库访问前继续 fail-closed，只允许报告 `REAL_ENV_BLOCKED`，不得用离线 fixture、历史 SQL7 数据或单次成功样本冒充本次真实 PASS。

## 6. 最终 PASS 条件

| 层级 | PASS 条件 |
|---|---|
| 架构 | PostgreSQL 唯一权威；无第二 Projector/权限规则；无新 schema/migration/endpoint/page；恢复/审计继续 REPLAY |
| 功能 | N1–N7 六席 SHADOW 全等；`projectionHash` 全等；私人 Narrative/resource/token/feed 无泄露；正式合同和页面不变 |
| 数据库访问 | 单次 FAST GET application SQL `<= 2`、protocol roundtrip `<= 4`、transaction `<= 1`；SQL7 POST + FAST GET application SQL `<= 9`、roundtrip `<= 14`；样本无后台污染 |
| 延迟 | 真实报告 FAST GET warm p50/p95、SQL7 提交、首次 N2 权威投影、AI Narrative 等待和玩家总耗时；建议 FAST GET warm p95 `<= 1.5s`、提交到首次权威投影 `<= 6s` |
| 玩家流程 | 正式 `/game?runId=...` 内容与修改前一致；刷新稳定；决策后进入下一章节；不显示内部 hash、Provider、SQL 或错误码 |
| Git | 全部门通过后，才提交并推送 `codex/chatgpt-pro-pressure-performance-v2`；不合并、不部署、不迁移 |

只有以上各层都有当前、直接、可复核证据，才能声明整体完成。任何 `M*_ACCEPTED`、`SQL7_PASS`、`ACCESS_REDUCTION_PASS` 或单次成功都不是整体 `PERF_PASS`。
