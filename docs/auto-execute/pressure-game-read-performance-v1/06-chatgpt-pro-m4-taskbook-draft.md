# ChatGPT Pro 普通 Chat 开发任务书草案：M4 REPLAY/SHADOW/FAST 选择器与接线

> 状态：`DRAFT / DO_NOT_SEND_BEFORE_M3_ACCEPTED`。本文件仅供 Codex 预备；M1-M3 未分别独立验收通过前不得发送或实施。即使代码验收通过，真实 FAST 启用仍必须等待项目所有者在 SHADOW 零差异证据后明确批准。

## 背景与单一目标

M1-M3 建立了 viewer-scoped 快照、单 SQL reader 和唯一 Projector 复用入口。M4 的唯一目标是增加一个窄的普通 GET 读路径选择器：

- `REPLAY`：只调用现有 legacy `PressureChapterGameProjectionService.read()`；
- `SHADOW`：返回 legacy 结果，同时执行 FAST candidate 并比较完整 Projection；
- `FAST`：只执行 M2+M3 快照路径，任何无效快照/投影错误均 fail-closed，不静默回退。

默认必须是 `REPLAY`。公开 endpoint、请求、响应和玩家页面不得改变。请实际阅读届时上传的脱敏源码并交付真实代码工件；只给方案、伪代码或口头说明不算交付。

## 发送前由 Codex 补齐的输入基线

- 仓库：`aiStoryRoom`。
- 远程 Git 基线：`origin/main@b6f512442f7e67d6c6d0dcaa2e6449bdd849de44`。
- 目标专用分支：`codex/chatgpt-pro-pressure-performance-v2`。
- M1-M3 独立验收状态及 filtered blob hashes：`<M1_M2_M3_ACCEPTED_EVIDENCE>`。
- M4 源码 ZIP：`<M4_SOURCE_ZIP_NAME>`。
- ZIP 大小：`<M4_SOURCE_ZIP_SIZE>`。
- ZIP SHA-256：`<M4_SOURCE_ZIP_SHA256>`。

如果任一前置模块未标记为独立 `ACCEPTED`，请停止，不得开始 M4。

## 当前架构与唯一权威

- `PressureChapterHttpFacade.getGame()` 当前只调用内部 `PressureChapterHttpGamePort.read()`；公开响应为既有 `PressureChapterGameProjectionV1`。
- `PressureChapterGameProjectionService.read()` 是 legacy REPLAY 读取；M2+M3 组合是 FAST candidate。
- 最终 Projection 规则仍只在既有 Projector；selector 不读取数据库、不投影、不修复快照。
- Product root 目前把同一个 `gameProjection` 同时用于 HTTP game port、decision compiler 和 SQL7 receipt projection。M4 只能替换**普通 GET 的 HTTP game port**；decision compiler、SQL7 post-commit、recovery/audit/repair/replay 依赖必须继续使用原有明确路径。
- PostgreSQL/Supabase 继续是唯一运行时权威；selector 只做路径裁定。

## 本模块职责

1. 定义 `PressureGameReadModeV1 = "REPLAY" | "SHADOW" | "FAST"` 和严格 parser：环境变量缺失/空值默认 `REPLAY`；未知值 fail-closed，禁止误启 FAST。
2. 新增窄 selector，实现普通 GET 所需的 `PressureChapterHttpGamePort.read()`；依赖 legacy reader、M2 snapshot reader、M3 projector、可测试 clock 和窄 shadow diagnostic port。
3. `REPLAY`：只调用 legacy，一次也不得触发 snapshot reader。
4. `SHADOW`：
   - legacy 是唯一返回值；返回对象必须与直接 legacy 调用深度/字节一致；
   - FAST candidate 完整执行并以 `assert.deepEqual` 等价语义或 canonical hash + deep diagnostic 比较所有字段和 `projectionHash`；
   - candidate 抛错或出现差异时，记录稳定的内部 `SHADOW_ERROR`/`SHADOW_MISMATCH` 诊断并把该样本判为未通过，但仍返回 legacy，不向玩家泄漏内部错误；
   - 不自动切 FAST，不写数据库，不把差异静默标记为成功。
5. `FAST`：只执行一次 M2 snapshot read 和一次 M3 projection；snapshot 缺失、无效或 projector 失败必须抛出既有内部错误，不调用 legacy fallback。
6. 普通 GET 输入必须机械映射为 M1 request：`roomId = runId`、当前 `subjectId`、cursor/limit、request-scoped `capturedAtMs`。不得扩大 viewer scope。
7. 保留 `readFromCommittedAuthority` 的现有 SQL7 post-commit 行为，直接委托原 `gameProjection`，不得绕到 snapshot SQL。
8. recovery/audit/repair/replay 必须显式保持 REPLAY。尤其 HTTP 幂等 action replay 当前再次调用 `this.game.read()`：如 selector 会接管该调用，必须通过最小内部端口方法（例如可选 `readReplay()`）让该分支明确委托 legacy；不得用隐含 call-stack、全局标志或请求字符串猜测调用目的。
9. Product root 只在 HTTP `game` port 上接 selector；`decisionCompiler`、`PressureSql7ReceiptProjectionAdapterV1` 等继续注入原 `gameProjection`。

## 明确非职责

- selector 不执行 Prisma/query、transaction/write，不导入 M2 Prisma 实现细节以外的数据库 API。
- 不修改 M1 decoder、M2 SQL 或 M3 Projector 规则。
- 不新增 cache、重试、熔断状态机、后台任务、长期双写或自动模式升级。
- 不修改公开 HTTP route、参数、响应字段、状态码或错误文案。
- 不修改 Settlement、Action Guard、AI 策略、Narrator、Provider、Prompt。
- 不修改 `apps/web/**` 或玩家可见页面、文案、导航、轮询。
- 不修复 `SANGTIAN_ACTION_RELEASE_ARTIFACT_HASH_MISMATCH`。
- 不访问真实 Supabase、不运行真实 SHADOW/FAST，不修改线上或本地 `.env`。
- 不 commit、push、创建 PR、部署或迁移。

## 允许修改

- 新增窄 selector 及聚焦测试，优先：
  - `apps/api/src/pressure-chapter/game-projection/game-read-mode-selector.ts`；
  - `apps/api/src/pressure-chapter/game-projection/game-read-mode-selector.spec.ts`。
- 最小修改接线：
  - `apps/api/src/pressure-chapter/product/product-root.ts`；
  - 对应 product composition 聚焦测试。
- 仅为显式 REPLAY 内部调用边界，必要时最小修改：
  - `apps/api/src/pressure-chapter/http/contracts.ts`；
  - `apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.ts`；
  - `apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.spec.ts`。
- 仅在编译需要时最小修改 `apps/api/src/pressure-chapter/game-projection/index.ts`。

不得修改 controller/endpoint、Prisma schema/migration 或 `apps/web/**`。若实现需要更多文件、改变公共合同、数据库或投影权威链，请停止并报告。

## 设计约束

- selector 是纯路径裁定模块：只能通过窄 port 调用 legacy/FAST，不能读取另一个模块的内部表或可变状态。
- mode parser 不得在 selector 内散落 `process.env` 读取；composition 读取一次并注入已解析 mode。
- 缺失 mode 默认 REPLAY；非法 mode 必须启动/组装 fail-closed，不能回退 FAST 或猜测值。
- SHADOW 返回值必须是 legacy 原对象或其严格等价结果；candidate 结果绝不能替换、合并或修补 legacy。
- SHADOW 诊断不得包含 SQL、凭据、Provider raw output、其他席私人字段或完整 payload；只记录 request correlation、mode、相等状态、稳定错误归属和允许的 hash/字段路径摘要。
- FAST 不允许 catch 后调用 legacy；测试必须证明 candidate error 时 legacy call count 为 0。
- 不创建通用 Manager、共享 mutable singleton、永久 shadow cache 或复杂状态机。
- 不允许 `as unknown as`、宽泛 `any`、TypeScript suppression 或字符串比较代替完整等价。

## 必须测试

只运行 M4 聚焦测试、M1-M3 聚焦回归、HTTP facade spec、product composition 聚焦测试和 API typecheck；不运行真实数据库或浏览器。

1. parser：undefined/空值 -> `REPLAY`；三个合法值准确解析；大小写或未知值 fail-closed。
2. REPLAY：legacy call count 1；snapshot/projector/diagnostic count 0；返回值逐字节等于 legacy。
3. SHADOW 相等：legacy 1、snapshot 1、projector 1；诊断为 MATCH；返回值严格等于 legacy，不是 candidate。
4. SHADOW 字段差异：诊断包含最小字段/hash 摘要并标记 MISMATCH；HTTP 返回仍为 legacy；不得暴露内部字段给响应。
5. SHADOW candidate 抛错：诊断标记 ERROR；仍返回 legacy；不吞掉诊断、不自动切模式。
6. FAST 正常：legacy 0、snapshot 1、projector 1，返回 candidate。
7. FAST 缺失/无效 snapshot 或 projector 抛错：请求 fail-closed，legacy 0；禁止 fallback。
8. cursor/limit/subject/run 输入完整传给 M2，`roomId === runId`，capturedAtMs 来自注入 clock。
9. `readFromCommittedAuthority` 继续只委托原 gameProjection，M2 call count 0。
10. HTTP 幂等 action replay、recovery/audit/repair/replay 的聚焦测试证明只调用 legacy，不进入 FAST；普通 `getGame()` 才进入 selector。
11. product root 测试证明只把 selector 放到 `httpPorts.game`；decision compiler 和 SQL7 receipt adapter 仍使用原 gameProjection。
12. 公开 HTTP route/request/response 合同快照与修改前一致；无新增字段或玩家文案。
13. 静态检查 selector 无 Prisma/write/projector 规则、无 `process.env`、无 silent FAST fallback。
14. M1-M3 聚焦测试继续通过。
15. `node --import tsx --test apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.spec.ts` 通过。
16. `pnpm --filter @apps/api typecheck` 通过。
17. `git diff --check` 通过。

首次失败先分类到 parser、selector、M1-M3、HTTP wiring 或 composition，只重跑最小失败用例。

## 必须交付

生成一个可下载 ZIP，包含：

- `changed-files/`：M4 所有新增/修改文件，保留仓库相对路径；
- `changes.patch`：相对届时上传的**精确 M1-M3 accepted 输入树**的 unified diff，只含 M4；
- `manifest.json`：每个文件路径、大小、SHA-256，输入 ZIP 名称/大小/SHA-256、前置模块 filtered blob hashes；
- `report.md`：mode parser、调用矩阵、SHADOW 诊断、FAST fail-closed、REPLAY 保留点、实际命令和首次结果、`TESTS_NOT_RUN`、风险与回滚。

ZIP 不得包含 `.git`、`node_modules`、`.env*`、key/token/cookie/password/connection string、构建产物、运行日志、数据库内容或浏览器状态。

## 禁止声称

- 模拟 SHADOW 相等不等于真实 Supabase SHADOW 矩阵通过。
- 编写 FAST 分支不等于授权启用 FAST；真实启用必须等待项目所有者在零差异证据后批准。
- 未实际运行的测试必须标记 `TESTS_NOT_RUN`。
- M4 通过不等于 M5、真实 SQL/往返/事务预算、warm p50/p95、真实玩家页面或整体性能 PASS。
- 不得声称修复主线启动哈希阻塞。

## M4 验收标准

- 默认 REPLAY，非法配置 fail-closed；公开 API/页面不变。
- SHADOW 永远返回 legacy，完整比较 candidate，并产生可归属诊断。
- FAST 正常路径不调用 legacy；失败不静默回退。
- 普通 GET 才可选择 FAST；recovery/audit/repair/replay 和 SQL7 post-commit 继续走其原权威路径。
- 没有第二 Projector、第二数据库权威、缓存或状态机。
- M1-M4 聚焦测试、HTTP/product composition、API typecheck、`git diff --check` 通过。
- Codex 能在精确前置输入树上机械应用 patch，逐文件匹配工件并独立复现测试。

## 玩家参与与启用门

M4 代码验收后仍保持 `REPLAY`。真实非生产 SHADOW 矩阵由 M5 执行；只有 N1-N7、六席、P0、三种模式、narrative/Feed/cursor 等矩阵零字段差异并由项目所有者明确批准，才允许把非生产环境切到 FAST。该批准不包含生产部署。

## 回滚

将配置恢复/保持 `REPLAY` 即可立即停止 FAST/SHADOW；删除 selector 接线和可选内部 `readReplay()` 后，`httpPorts.game` 重新直接指向原 `gameProjection`。不影响 M1-M3 未接入代码。
