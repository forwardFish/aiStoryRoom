# ChatGPT Pro 普通 Chat 开发任务书：M1 GameReadSnapshotV1

## 背景与唯一目标

Pressure 普通 `GET /api/v4/rooms/:roomId/game` 当前通过多个 Reader 重建权威来源，诊断参考约为 40 application SQL、80 次协议往返、11 次事务。本轮最终方向是“一次 viewer-scoped PostgreSQL 聚合快照 + 既有内存 Projector”，但当前只允许实现第一个可独立验收模块：`GameReadSnapshotV1` 合同和严格解码。

请实际阅读上传源码并提交真实代码工件。不要只写方案、伪代码或口头说明。

## 源码基线

- 仓库：aiStoryRoom。
- 远程基线：`origin/main@b6f512442f7e67d6c6d0dcaa2e6449bdd849de44`。
- 目标分支由 Codex 本地维护：`codex/chatgpt-pro-pressure-performance-v2`。
- 源码 ZIP 名称、大小和 SHA-256 由 Codex 在上传时补充。

## 当前架构与单一权威

- PostgreSQL/Supabase 是唯一运行时权威。
- 旧普通读取由 `PressureChapterGameProjectionService.read()` 组合 route、viewer、chapter、world、narrative、Feed、capabilities。
- 已有 `PressureChapterGameProjectionService.projectFromResolvedSources()` 是唯一允许的最终投影器；后续模块必须复用它。
- SQL7 提交已有一条聚合 snapshot 的合同/decoder/Prisma 实现，可借鉴严格绑定和 fail-closed 风格，但不能把提交快照直接错误复用成 GET viewer snapshot。
- 恢复、审计、修复、事件回放永远保留 REPLAY。

## 本模块职责

定义一个不可变、viewer-scoped、route-bound、chapter-bound 的 `GameReadSnapshotV1`，以及把单行聚合 SQL 原始结果严格解码为该合同的纯函数。

合同必须能承载后续 `projectFromResolvedSources()` 所需的全部已有权威输入：

- viewer membership、room/run/subject/seat 绑定；
- frozen route snapshot；
- seat/control epoch、submit/reclaim fence 和 viewer private projection；
- chapter orchestrator state、chapter descriptor/definition 绑定；
- `ledgerProjectionJson` 及其 cache hash、route/chapter/revision/head 绑定；
- authoritative world state/metrics 输入；
- viewer-scoped narrative artifact/status；
- viewer-scoped resources、tokens、situation；
- A-Emotion viewer Feed page，包括 cursor、limit、顺序、unread/serverSequence；
- capabilities 所需的既有权威字段，不新增第二套权限规则。

所有 JSON、hash、revision、head、route、run、room、subject、seat、chapterRuntimeId、chapterId、narrative audience、Feed audience 和 fence 必须严格验证；缺失、重复、畸形、跨作用域或 hash 不一致必须 fail-closed。

## 明确非职责

- 不写 Prisma 查询、不访问数据库、不增加缓存。
- 不接 HTTP、不读取环境变量、不实现 REPLAY/SHADOW/FAST selector。
- 不生成最终 `PressureChapterGameProjectionV1`，不复制 Projector 规则。
- 不修改 Settlement、Action Guard、AI 席位策略、Narrator Prompt、Provider。
- 不新增表、列、索引、migration、endpoint 或公开响应字段。
- 不修改 `apps/web/**` 或任何玩家可见内容。
- 不修复当前 `origin/main` 的 `SANGTIAN_ACTION_RELEASE_ARTIFACT_HASH_MISMATCH`；它是范围外启动阻塞。
- 不提交、不推送、不部署、不迁移、不访问真实 Supabase。

## 允许修改

- 新增 `apps/api/src/pressure-chapter/game-projection/game-read-snapshot.ts`。
- 新增 `apps/api/src/pressure-chapter/game-projection/game-read-snapshot.spec.ts`。
- 仅当编译所必需时，最小修改：
  - `apps/api/src/pressure-chapter/game-projection/contracts.ts`
  - `apps/api/src/pressure-chapter/game-projection/index.ts`
  - `apps/api/src/pressure-chapter/game-projection/tsconfig.pc-game-projection.json`
- 如测试需要，可新增该模块内部 fixture 文件；不得修改生产内容 fixture 迎合测试。

如实现需要越过以上文件、公共合同、数据库、路由、权威链或三个以上既有模块，请停止并报告，不得自行扩展。

## 设计要求

- 一个事实一个权威；decoder 只验证和映射，不裁定新的业务规则。
- 合同与 decoder 不 import Prisma、Nest、HTTP、Provider 或页面代码。
- 依赖单向：shared/既有领域合同 -> M1；后续 Prisma adapter -> M1。
- 错误必须归属 M1，具有稳定内部 code/path/detail；不得泄漏原始 SQL、凭据或私人载荷。
- 不允许 `as unknown as` 掩盖不完整输入；不允许宽松默认值补齐缺失权威字段。
- 可复用现有 validators、`validateRunRouteSnapshotV1`、working projection cache decoder 和 SQL7 snapshot 的成熟模式；不要复制同一 hash 规则形成第二权威。
- 保证适用于 P0/N1-N7、六席以及 SOLO/TARGETED/SYNC，不写 N1 特例。

## 必须测试

只运行本模块的最小测试与 API typecheck，不运行真实数据库或全套 E2E：

1. 完整正常 raw row 解码成功，结果深冻结/不可变或至少无引用泄漏。
2. missing/duplicate aggregate row fail-closed。
3. run、room、subject、seat、routeHash、chapterRuntimeId、chapterId 跨作用域失配。
4. route snapshot hash/content/control topology 失配。
5. orchestrator revision、working revision、head sequence/head hash、state hash、ledger cache hash 失配。
6. seat control epoch、fence、private projection audience/hash 失配。
7. narrative source authority、viewer seat、chapter、artifact hash/status 失配。
8. resources/tokens/situation 非法或跨 viewer。
9. Feed room/run/viewer、cursor/limit、顺序、serverSequence、projection hash 非法。
10. capability authority 输入缺失或与 control/phase 不一致时 fail-closed；不得在 decoder 重算最终 capability booleans。
11. 输出不包含 Provider raw output、其他席私人字段、凭据或内部 SQL。
12. API TypeScript typecheck。

如某项无法在 M1 且不越界地验证，请明确列为后续 M2/M3 测试，不要伪造通过。

## 必须交付

请生成一个可下载 ZIP，包含：

- `changed-files/`：所有新增/修改文件，保留仓库相对路径；
- `changes.patch`：相对基线的 unified diff；
- `manifest.json`：每个文件路径、大小、SHA-256；
- `report.md`：设计、权威复用点、错误模型、实际运行命令及结果、未运行测试和风险。

ZIP 内不得包含 `.git`、`node_modules`、`.env*`、key/token/cookie/password/connection string、构建产物、运行日志或浏览器状态。

## 禁止声称

- 未实际运行的测试必须标记 `TESTS_NOT_RUN`。
- 本模块通过不等于 M2-M5、SHADOW、SQL 预算、真实 Supabase、p50/p95、玩家页面或整体性能 PASS。
- 不能声称修复了主线启动哈希阻塞。

## M1 验收标准

- 修改范围严格在允许文件内。
- 合同覆盖后续聚合 GET 所需权威输入，没有第二权威或新业务规则。
- 聚焦测试覆盖主要恶意/错误输入并通过。
- API typecheck 通过。
- `git diff --check` 通过。
- Codex 能在精确基线上机械应用 patch，并独立复现测试。

## 回滚

删除 M1 新文件和最小 export/tsconfig 变更即可；旧 GET 路径和公开响应应完全不受影响。
