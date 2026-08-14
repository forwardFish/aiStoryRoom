# ChatGPT Pro 普通 Chat 开发任务书：M4C 最新 main 组合接线移植

> 状态：`READY_FOR_PRO_CHAT`。M4B 冻结基线工件已下载并完成 Codex 独立范围、机械、类型和聚焦测试复核；本任务只把该已验收接线移植到最新 main 集成树，不重新设计 M1-M4。

## 唯一目标

把 `Pressure_GET_game_M4B_frozen_wiring_delivery.zip` 的 10 个 M4B 路径机械/语义移植到准确 `origin/main@a98ef29c43545ebef985176e952fc756b33bcce1`，并与已验收的 I1（M1+M3 latest-main port）、M2、M4A 共存。

冻结 M4B patch 在该集成树上只有一个已定位冲突：

```text
apps/api/src/pressure-chapter/product/product-root.ts:239
```

其余 9 个 M4B 路径可直接应用。不得因此重写 M4B、覆盖最新 `product-root.ts` 或修改 M1-M4A 业务实现。

## 准确输入

- 仓库：`forwardFish/aiStoryRoom`
- 最新基线：`a98ef29c43545ebef985176e952fc756b33bcce1`
- 集成模块：
  - I1 ZIP：`Pressure_GET_game_I1_M1_M3_port_29b3b0ad_I1_CANDIDATE.zip`，86,051 bytes，SHA-256 `068EFDDB7E781DEBF7E91EFE28866C5E7B7666D52203BD4154BB73294B7111FA`；
  - M2 ZIP：53,550 bytes，SHA-256 `8485CDCB02845316CE35BB02F5066F3C6C6DFCB2F8B2E0FE2927569C2F5274F2`；
  - M4A ZIP：18,924 bytes，SHA-256 `EB2786D0E8829AFE0FC23CAB662E51FA71B68C202E5531F78EFAF4C0E5EC5090`；
  - M4B ZIP：48,236 bytes，SHA-256 `DE331CA05D63614452945C580EAE97F41ACA3CF1CC126DD2690350CACDAA2FCF`。
- 目标分支名称仅供报告：`codex/chatgpt-pro-pressure-performance-v2`；Pro 不得 commit/push。

请先复算当前附件，并完整阅读附件根目录 `CHATGPT_PRO_TASK.md`、M4B report/manifest 和相关源码。

## 必须保留的最新 main 行为

`b6f512..a98ef29c` 在 M4B 范围内只有 `product-root.ts` 发生与本移植直接相关的基线变化；必须保留其全部最新内容，尤其：

- 最新 Rooms/Pressure canonical role-seat 映射和 production bridge；
- 最新 Prompt Layer / Supabase production config 调用方式；
- `PressureTurnPresentationServiceV1`、`turnPresentations` 与统一 story/decision turn；
- SQL7 POST、提交后 committed-authority projection、worker ownership 与 operational readiness；
- 原 `PressureChapterGameProjectionV1`、HTTP controller 路由和玩家响应。

不得把冻结 `product-root.ts` 整文件覆盖最新文件。

## 允许修改

仅限原 M4B 的 10 个路径：

- `apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.ts`
- `apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.spec.ts`
- `apps/api/src/pressure-chapter/product/product-root.ts`
- `apps/api/src/pressure-chapter/product/pressure-chapter-product.api.spec.ts`
- `apps/api/src/pressure-chapter/production-config/game-read-mode.ts`
- `apps/api/src/pressure-chapter/production-config/game-read-mode.spec.ts`
- `apps/api/src/pressure-chapter/production-config/index.ts`
- `apps/api/src/pressure-chapter/production/game-read-composition.ts`
- `apps/api/src/pressure-chapter/production/game-read-composition.spec.ts`
- `apps/api/src/pressure-chapter/production/index.ts`

禁止修改：

- M1 decoder、M2 SQL/Reader、M3 Projector、M4A selector；
- `apps/web/**`、公共合同、controller route；
- Prisma schema/migration/业务表；
- Settlement、AI、Narrator、Provider、Prompt、内容包；
- `.env*`、main/release、部署或真实数据。

如果编译确实要求第 11 个生产路径，立即停止并在答复中说明准确原因，不能自行扩大范围。

## 必须保持的 M4B 行为

1. `PRESSURE_GAME_READ_MODE` 缺失/空值为 `REPLAY`，只接受精确 `REPLAY|SHADOW|FAST`，非法值组合阶段 fail-closed。
2. 只有普通 GET 使用 mode-bound `gameRead.reader`；POST、SQL7 replay/committed-authority 继续既有 `gameProjection`。
3. REPLAY：legacy=1，snapshot/projector=0，返回原对象。
4. SHADOW：返回 legacy；candidate MATCH/MISMATCH/ERROR 和 diagnostic sink error 均不改变响应；legacy error 原样传播。
5. FAST：legacy=0，M2=1，M3=1；snapshot/projector error fail-closed，禁止 legacy fallback。
6. `roomId === runId`、subject、cursor/limit/default、capturedAt 精确传递。
7. M2 local authorities 只使用 captured/package-owned 纯操作，不新增数据库 Reader。
8. mode 和诊断不得进入玩家响应；内部 diagnostic 仅固定安全字段。

## 必须测试

只运行一次聚焦门，失败先分类并只重跑最小失败用例：

1. M4B config/composition specs；
2. HTTP facade spec；
3. ProductRoot composition spec；
4. M1/M2/M3/M4A 的受影响聚焦回归；
5. `pnpm --filter @apps/api typecheck`；
6. `git diff --check`；
7. 10 个路径以外零 diff。

当前仓库已知基线阻塞：

- `SANGTIAN_ACTION_RELEASE_ARTIFACT_HASH_MISMATCH`；
- `CONTENT_INVENTORY_HASH_MISMATCH`。

若测试在进入 M4C 逻辑前被上述准确错误阻塞，必须保留原始 expected/actual 和调用栈并标记 `BASELINE_GATE_BLOCKED`；不得修改/归一化内容文件、manifest 或 release artifact 来制造 PASS，也不得把临时 stub 结果冒充官方项目测试。

不得运行真实 Supabase、真实 SHADOW/FAST 流量、Provider、浏览器或部署；这些标 `TESTS_NOT_RUN`。

## 必须交付

最终只交付一个可下载 ZIP：

- `changed-files/`：10 个批准路径；
- `changes.patch`：相对准确 `a98ef29c + I1 + M2 + M4A` 集成树；
- `manifest.json`：输入 hash、每个输出 hash、测试原始结果；
- `report.md`：单点冲突处理、保留的 latest-main 行为、测试、基线门、风险、回滚。

ZIP 不得包含 `.git`、`node_modules`、`.env*`、凭据、连接串、日志、数据库或构建产物。只可声称 `M4C_CANDIDATE`，不得声称 Codex 验收、真实 SQL、SHADOW、性能或玩家流程通过。

## 回滚

移除 M4B/M4C 的 config/composition/facade 注入，恢复普通 GET 直接使用 `gameProjection`；保留未接线的 M1-M4A 模块，默认 REPLAY。
