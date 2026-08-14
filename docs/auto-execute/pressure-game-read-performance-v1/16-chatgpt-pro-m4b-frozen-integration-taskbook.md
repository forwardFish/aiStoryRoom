# ChatGPT Pro 普通 Chat 开发任务书：M4B 冻结基线组合接线

> 状态：`READY_FOR_PRO_CHAT`。本任务与 I1 最新 main 兼容移植并行；这里只在冻结的 `b6f51244 + M1/M2/M3/M4A accepted` 输入树上完成组合接线，不承担最终 main 合并。

## 背景与唯一目标

Pressure GET `/game` 已分别形成四个独立模块：

- M1：`GameReadSnapshotV1` 数据合同与 fail-closed decoder；
- M2：单条参数化、只读 PostgreSQL 聚合快照 Reader；
- M3：复用唯一 `GameProjectionService` 规则的 resolved-sources Projector；
- M4A：`REPLAY | SHADOW | FAST` 纯 mode selector。

本任务只负责 M4B：把以上 accepted 模块通过现有 Pressure ProductRoot / production composition / HTTP GET `/game` 窄接线，保持默认 `REPLAY`，并用聚焦测试证明玩家公开响应与旧路径一致。不得修改四个模块的业务实现。

## 精确输入

- 仓库：`forwardFish/aiStoryRoom`。
- Git 基线：`b6f512442f7e67d6c6d0dcaa2e6449bdd849de44`。
- 目标专用分支：`codex/chatgpt-pro-pressure-performance-v2`；你不得 commit 或 push。
- 输入 ZIP：以本对话实际上传文件为准；请先计算并在报告中写出文件名、大小、SHA-256。
- ZIP 产品树已机械叠加 Codex 独立接受的 M1、M2、M3 r2、M4A；M2 测试仅有一处 Prisma 6.19 兼容修正：`query.sql.join("?")` 改为 `query.strings.join("?")`，生产 Reader 未改。

## 当前权威与依赖方向

```text
HTTP GET /game
  -> M4A selector
     REPLAY -> 现有 legacy GameProjectionService.read
     SHADOW -> legacy 返回值 + M2 snapshot -> M3 projector，仅比较/诊断
     FAST   -> M2 snapshot -> M3 projector
```

- PostgreSQL 仍是唯一持久化权威。
- M2 只能执行一次 `$queryRaw`，不得启动事务或额外 DB Reader。
- M3 必须复用现有 `GameProjectionService.projectFromResolvedSources()`，不得形成第二套 projection 规则。
- SHADOW 永远返回 legacy 的原对象/等价公开响应；candidate 失败或 mismatch 不改变玩家响应。
- FAST fail-closed，不能静默回退 legacy，否则 SQL 预算会失真。
- `roomId === runId`、viewer subject、feed cursor/limit 必须原样传递。

## 允许修改

只允许为组合和测试最小修改以下范围：

- `apps/api/src/pressure-chapter/product/product-root.ts`；
- `apps/api/src/pressure-chapter/product/product-root.spec.ts` 或现有对应 composition 测试；
- `apps/api/src/pressure-chapter/production/**` 中现有 Pressure composition 文件及聚焦测试；
- `apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.ts` 及其聚焦测试；
- `apps/api/src/pressure-chapter/game-projection/index.ts`、`persistence/index.ts` 仅限必要 export；
- 新增一个窄的内部配置 parser / no-op shadow diagnostic adapter 及聚焦测试，优先放在 `game-projection/`、`production/` 或 `product/`；
- 如确有需要，可最小修改 Pressure `production-config/**`，但不得修改 `.env*`。

如果需要修改公共 controller 路由、公开 request/response、数据库 schema/migration、M1/M2/M3/M4A 业务实现、Settlement、Provider、Prompt 或页面，请停止并在报告中说明，不要越界。

## 禁止修改

- `apps/web/**` 和任何玩家可见页面、文案、路由、交互；
- Prisma schema、migration、业务表；
- M1 decoder、M2 SQL/Reader、M3 Projector、M4A selector 的生产逻辑；
- 决策提交、Settlement、AI 自动化、Narrator、Provider、Prompt；
- `main`、`release`、部署、线上配置或真实数据。

## 必须实现

1. 用单一内部配置权威解析模式；缺失配置默认 `REPLAY`，非法值启动/组合 fail-closed，不得把 mode 暴露给玩家。
2. 现有 GET `/game` facade 调用 selector，而不是在 controller/页面复制分支。
3. REPLAY 只调用旧 Reader 一次，不调用 M2/M3。
4. SHADOW 先取得 legacy，执行 candidate 并比较，但无论 match/mismatch/candidate error 都返回 legacy；legacy error 原样传播。
5. FAST 只调用 M2 一次和 M3 一次，legacy 调用次数为零。
6. M2 的 local authorities 必须全部来自现有纯内存/package-owned adapters；不得再接数据库 Reader，否则不满足一 SQL。
7. shadow diagnostic 只允许固定安全字段，不记录 runId、subjectId、SQL、Projection、private payload、Provider 内容或凭据；sink 失败不影响玩家响应。
8. 不改变 HTTP status、错误映射、响应字段、字段顺序或 hash 计算。
9. 接线保持依赖单向，ProductRoot 负责 composition；领域规则不得依赖 HTTP/Prisma/config。

## 必须测试

请实际运行一次以下聚焦门；失败后先归属，只重跑失败的最小用例：

1. M1、M2、M3、M4A 聚焦测试全部通过。
2. REPLAY：旧 Reader=1，snapshot/projector=0，公开响应与接线前深度且 canonical/JSON 一致。
3. SHADOW MATCH/MISMATCH/ERROR：始终返回 legacy；只产生去敏诊断；candidate 不泄漏。
4. FAST：legacy=0，snapshot=1，projector=1；错误 fail-closed。
5. cursor/limit/default 值与既有 GET 行为一致。
6. ProductRoot/production composition 不引入额外数据库读或事务。
7. HTTP facade 聚焦回归通过。
8. `pnpm --filter @apps/api typecheck` 通过。
9. `git diff --check` 通过。

不得运行真实 Supabase、浏览器、SHADOW/FAST 真实流量；这些由 Codex 在最终集成后统一执行。未运行项写 `TESTS_NOT_RUN`。

## 必须交付

只交付一个可下载 ZIP，包含：

- `changed-files/`：全部 M4B 文件，保留仓库相对路径；
- `changes.patch`：相对本输入树的 unified diff，只含 M4B；
- `manifest.json`：输入 ZIP 文件名/大小/SHA-256、每个输出文件大小/SHA-256、实际测试结果；
- `report.md`：接线图、配置默认值、REPLAY/SHADOW/FAST 行为、实际命令与首次结果、`TESTS_NOT_RUN`、风险和回滚。

不得包含 `.git`、`node_modules`、`.env*`、构建产物、日志、数据库、浏览器状态、key/token/cookie/password/connection string。

## 禁止声称

- mock 或静态调用次数不是实际 Supabase SQL/roundtrip 证据；
- 单元测试不等于功能等价真实验收；
- 本任务不能声称 `SQL7_PASS`、`ACCESS_REDUCTION_PASS`、warm p50/p95、`PERF_PASS` 或玩家验收通过；
- 不得声称已兼容任务执行期间继续变化的最新 `main`。

## 回滚

移除 M4B composition/config/diagnostic 接线并恢复 GET `/game` 直接调用 legacy Reader；保留 M1-M4A 未接线模块，默认模式恢复 `REPLAY`。
