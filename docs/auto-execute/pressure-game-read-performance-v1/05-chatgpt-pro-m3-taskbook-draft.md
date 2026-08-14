# ChatGPT Pro 普通 Chat 开发任务书草案：M3 复用现有 Projector

> 状态：`DRAFT / DO_NOT_SEND_BEFORE_M2_ACCEPTED`。本文件仅供 Codex 预备；M1、M2 未分别独立验收通过前不得发送、实施或进入 M3 验收。

## 背景与单一目标

M1 已定义并严格解码 `GameReadSnapshotV1`，其 `sources` 承载既有最终 Projector 所需的 authority-bound 输入；M2 负责用一条只读 SQL 取得该快照。M3 的唯一目标是把已验证快照交给**同一个** `PressureChapterGameProjectionService.projectFromResolvedSources()` / `projectResolvedSources()` 权威链，并证明输出与旧 REPLAY `read()` 在固定矩阵中逐字段及 `projectionHash` 完全一致。

本模块不是新 Projector，也不读取数据库、不选择模式、不接 HTTP。请实际阅读届时上传的脱敏源码并交付真实代码工件；只给方案、伪代码或口头说明不算交付。

## 发送前由 Codex 补齐的输入基线

- 仓库：`aiStoryRoom`。
- 远程 Git 基线：`origin/main@b6f512442f7e67d6c6d0dcaa2e6449bdd849de44`。
- 目标专用分支：`codex/chatgpt-pro-pressure-performance-v2`。
- M1 状态及 filtered blob hashes：`<M1_ACCEPTED_EVIDENCE>`。
- M2 状态及 filtered blob hashes：`<M2_ACCEPTED_EVIDENCE>`。
- M3 源码 ZIP：`<M3_SOURCE_ZIP_NAME>`。
- ZIP 大小：`<M3_SOURCE_ZIP_SIZE>`。
- ZIP SHA-256：`<M3_SOURCE_ZIP_SHA256>`。

如果 M1 或 M2 未标记为独立 `ACCEPTED`，请停止，不得开始 M3。

## 当前架构与唯一权威

- `PressureChapterGameProjectionService.projectResolvedSources()` 是最终响应字段、sanitization、capability、narrative、Feed 和 `projectionHash` 的唯一汇合点。
- `projectFromResolvedSources()` 已由 SQL7 post-commit 路径使用；动态章节通过既有 `chapters.projectCurrent()` 把 orchestrator/working/descriptor 权威转换成 `PressureGameChapterSourceV1`，随后调用同一个 `projectResolvedSources()`。
- M1 动态 N1-N7 的 `GameReadDynamicResolvedSourcesV1` 已与现有 `ProjectPressureChapterGameProjectionFromSourcesV1` 同型，不需要 mapper 或第二 Projector。
- M1 P0 的 `GameReadP0ResolvedSourcesV1` 只以 `chapterSource` 取代动态章节的 `chapter`、`workingProjection`、`chapterDescriptor` 三元组；其余 viewer/world/narrative/feed/route 输入与现有方法相同。
- 旧 REPLAY `read()` 必须保持可用且行为不变；恢复、审计、修复和事件回放继续依赖它。

## 本模块职责

1. 为 `PressureChapterGameProjectionService` 提供一个窄入口，接收已验证 `GameReadSnapshotV1`（或其只读 `sources`），不再读取任何 reader/Prisma。
2. 动态 N1-N7 必须继续调用既有 `chapters.projectCurrent()`，再进入同一个 `projectResolvedSources()`。
3. P0 只允许扩宽现有 `projectFromResolvedSources()` 的输入 union：检测已有 `chapterSource` 后直接使用该既有 `PressureGameChapterSourceV1`，再进入同一个 `projectResolvedSources()`；不得创建 P0 专用 Projector。
4. 现有 SQL7 `ProjectPressureChapterGameProjectionFromSourcesV1` 调用方必须源码兼容、行为兼容。
5. 使用相同 service dependencies、相同 decision presentation、相同 sanitizers 和相同 hash 生成，证明 FAST candidate 与 REPLAY output 深度相等。

建议的最窄形状（以最终 M1 合同为准，不得机械照抄造成第二合同）：

```ts
async projectFromSnapshot(
  snapshot: Readonly<GameReadSnapshotV1>,
): Promise<PressureChapterGameProjectionV1> {
  return this.projectFromResolvedSources(snapshot.sources);
}
```

同时将既有 `projectFromResolvedSources()` 输入收窄扩宽为 M1 已冻结的 resolved-source union；动态分支保留当前 `chapters.projectCurrent()`，P0 分支使用 `chapterSource`，两者最终都只调用当前 `projectResolvedSources()`。

如果无需新增 `projectFromSnapshot()`、直接传 `snapshot.sources` 更窄，也可以采用，但必须保持调用点清晰、类型安全并由聚焦测试证明。不得把 M1 authority evidence 或 snapshot hash 重新解释成投影规则。

## 明确非职责

- 不读取 Prisma、数据库、repository、reader port 或环境变量。
- 不实现 M2 SQL，不修改 schema/migration。
- 不实现 REPLAY/SHADOW/FAST selector，不修改 HTTP facade/controller/route。
- 不复制 `projectResolvedSources()`、`sanitize*`、`capabilitiesFromCommittedAuthority()`、`assertCapabilitiesMatch()`、Feed/narrative/decision/hash 规则。
- 不新增 parallel projector、P0 projector、FAST projector、万能 mapper/manager 或共享可变状态。
- 不修改 Settlement、Action Guard、AI 策略、Narrator、Provider、Prompt。
- 不修改 `apps/web/**` 或任何玩家可见页面、文案、路由和公开响应合同。
- 不修复 `SANGTIAN_ACTION_RELEASE_ARTIFACT_HASH_MISMATCH`。
- 不访问真实 Supabase，不运行真实玩家流程。
- 不 commit、push、创建 PR、部署或迁移。

## 允许修改

- 最小修改 `apps/api/src/pressure-chapter/game-projection/game-projection.service.ts`。
- 修改或新增本模块聚焦测试：
  - 优先新增 `apps/api/src/pressure-chapter/game-projection/game-read-snapshot-projector.spec.ts`；或
  - 在有充分理由时最小修改 `game-projection.service.spec.ts`。
- 仅在类型编译绝对需要时最小修改：
  - `apps/api/src/pressure-chapter/game-projection/contracts.ts`；
  - `apps/api/src/pressure-chapter/game-projection/index.ts`。

预期无需修改 M1 decoder 或 M2 adapter。若发现必须改变 M1/M2 公共合同、数据库、HTTP、权威链或三个以上既有模块，请停止并报告，不得自行扩展。

## 设计约束

- 一个最终投影权威：无论 REPLAY、SQL7 post-commit 或快照输入，最终都必须经过当前 `projectResolvedSources()`。
- 依赖方向只能是 M3 -> M1 resolved sources -> existing projector；Projector 不得依赖 Prisma/M2 实现细节。
- P0 与动态章节只允许在“如何取得既有 `PressureGameChapterSourceV1`”这一点分支；之后必须合流。
- 不允许通过 JSON stringify/parse、宽泛 cast、`as unknown as`、`any` 或默认值把不兼容输入硬塞进 Projector。
- 不允许在 M3 重算 snapshot hash、route hash、working cache hash、decision pin、Feed page、capabilities 或 narrative status。
- snapshot invalid 应在 M1 fail-closed；M3 只接受已验证对象。Projector 自身既有 fail-closed 规则继续生效。
- 旧 `read()` 代码路径和 reader 调用顺序不修改；本模块不做性能选择。

## 必须测试

只运行 M3 聚焦等价测试、M1/M2 聚焦回归、现有 projection service spec 和 API typecheck；不运行真实数据库或 E2E。

1. 动态章节输入调用既有 `chapters.projectCurrent()` 恰好一次，随后调用同一最终投影链；不得调用任何 reader。
2. P0 输入不调用 `chapters.projectCurrent()`，直接使用 M1 已验证 `chapterSource`，随后调用同一最终投影链。
3. 现有 SQL7 dynamic resolved-source 调用继续得到与修改前相同的 projection 和 `projectionHash`。
4. 对同一固定 authority fixture，旧 REPLAY `read()` 与 snapshot projection 执行 `assert.deepEqual`，并额外断言 `projectionHash`、`JSON.stringify` 字节结果一致。
5. 至少覆盖 P0、N1、N2、N7；若 fixture 生成器可低成本扩展，覆盖 N1-N7 全矩阵，不得用 N1 特例实现。
6. 覆盖六席 viewer，证明 seat-scoped viewer、private resources/tokens/situation、narrative audience 和 Feed 不串席。
7. 覆盖 `SOLO`、`TARGETED`、`SYNC` participant/decision mode 的既有合法 fixture。
8. 覆盖 narrative `READY/PENDING/FAILED`（以现有公开行为允许的状态为准）、非空 Feed、cursor page、resources/tokens、decision/capabilities。
9. 任一 route/run/subject/seat/chapter/narrative/feed 源失配继续由现有 Projector/M1 fail-closed；M3 不静默修复。
10. 静态检查生产源码只有一个 `projectResolvedSources()` 实现，没有新增第二套 sanitize/capability/hash/Feed 规则，也没有 Prisma/HTTP/env import。
11. M1 v4 和 M2 聚焦测试继续通过。
12. `node --import tsx --test apps/api/src/pressure-chapter/game-projection/game-projection.service.spec.ts` 通过。
13. `pnpm --filter @apps/api typecheck` 通过。
14. `git diff --check` 通过。

矩阵可以由共享 fixture/table-driven test 一次执行，避免反复运行测试进程。首次失败先分类到 fixture、M1、M3 或 existing Projector，只重跑最小失败用例。

## 必须交付

生成一个可下载 ZIP，包含：

- `changed-files/`：M3 所有新增/修改文件，保留仓库相对路径；
- `changes.patch`：相对届时上传的**精确 M1+M2 accepted 输入树**的 unified diff，只含 M3；
- `manifest.json`：每个文件路径、大小、SHA-256，输入 ZIP 名称/大小/SHA-256、M1/M2 filtered blob hashes；
- `report.md`：唯一 Projector 合流点、P0/dynamic 分支、等价矩阵、实际命令和首次结果、`TESTS_NOT_RUN`、风险与回滚。

ZIP 不得包含 `.git`、`node_modules`、`.env*`、key/token/cookie/password/connection string、构建产物、运行日志、数据库内容或浏览器状态。

## 禁止声称

- 固定 fixture 的深度相等只能证明 M3 覆盖矩阵，不等于真实 SHADOW 全量通过。
- 未实际运行的测试必须标记 `TESTS_NOT_RUN`。
- M3 通过不等于 M4/M5、SHADOW、FAST、真实 SQL 预算、真实 Supabase、warm p50/p95、玩家页面或整体性能 PASS。
- 不得声称修复了主线启动哈希阻塞。

## M3 验收标准

- 修改范围严格在允许文件内。
- 动态/P0 最终只进入一个既有 `projectResolvedSources()`；没有第二 Projector 或重复业务规则。
- 旧 REPLAY `read()`、现有 SQL7 resolved-source 调用行为不变。
- 固定矩阵中 snapshot projection 与 REPLAY 全字段、hash 和字节结果一致。
- M1/M2/M3 聚焦测试、现有 projection spec、API typecheck 和 `git diff --check` 通过。
- Codex 能在精确 M1+M2 accepted 输入树上机械应用 patch，逐文件匹配工件并独立复现测试。

## 回滚

删除新增 snapshot 入口/聚焦测试，并把 `projectFromResolvedSources()` 恢复原签名即可；旧 REPLAY `read()` 和 M1/M2 未接入代码保持不变。
