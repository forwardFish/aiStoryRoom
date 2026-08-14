# Remote Main Drift Compatibility Review

## 2026-08-14 latest-head addendum 3

- Latest observed `origin/main`: `709ab9f9`.
- New commits after `29b3b0ad`: `793b165f docs(pressure): add selective modal integration plan` and `709ab9f9 fix(rooms): serialize list projections`.
- These add a plan document and rooms-list projection files/tests; they do not modify the M1/M3 game-projection files.
- I1 keeps `29b3b0ad` as its exact, reproducible Pressure compatibility input. Final integration will absorb the then-current `origin/main` once, preserving all upstream room/page work and avoiding repeated rebases during module development.

## 2026-08-14 latest-head addendum 2

- Latest observed `origin/main`: `29b3b0ad7e5201f3592748c87a0ba78126669347`.
- New commit after `d74e0c55`: `29b3b0ad fix(rooms): map pressure role ids to canonical seats`.
- This commit changes Pressure Prisma snapshot and room routing/seat-mapping tests. Its canonical-seat correction is upstream authority that the GET optimization must preserve.
- The accepted old-baseline M1/M3 files must not overwrite latest main. A separate I1 Pro Chat will port only M1/M3 semantics onto the latest projector authority and explicitly cover all six viewers/canonical seats.

## 2026-08-14 latest-head addendum

- Latest observed `origin/main`: `d74e0c55daf0c62eb3d03ea8ed91a3962fe8e315`.
- New commit after the previously reviewed `5c499602`: `d74e0c55 fix(game): keep solo resources visible on narrow screens`.
- Its changed files are only `apps/web/public/main-game.css` and `apps/web/tests/solo-game-layout.test.mjs`.
- The performance task will use `d74e0c55` as the eventual integration base so the dedicated branch is current with remote main, but it will not edit, stage separately, or reinterpret those upstream player-visible files.
- The backend semantic compatibility findings below remain unchanged: M1/M3/M4B must preserve the unified turn-presentation and authority-draft contracts introduced before `d74e0c55`.

检查时间：2026-08-14 21:27 +08:00

## 当前事实

- 本任务冻结基线：`b6f512442f7e67d6c6d0dcaa2e6449bdd849de44`
- 当前 `origin/main`：`5c499602`
- 当前任务分支相对 `origin/main`：behind 4
- 本任务分支在创建时来自当时准确、最新且干净的远程 main；后续远程推进不改变该历史事实。

## 新增提交分类

| 提交 | 内容 | 与 GET 快照任务关系 |
|---|---|---|
| `cbd5e750` | clean main handoff 规则 | 流程约束；本任务有项目所有者明确专用分支授权，仍不得污染 main |
| `9cb016d9` | 移除页面重复 role goal | 玩家页面范围；本任务禁止吸收或修改玩家页面 |
| `81efe4ca` | authority snapshot timeout 延长 | SQL7 提交快照；不直接修改 GET Reader，但最终回归时需要保留 |
| `5c499602` | generated story/decision turn 统一 | 与 M3/M4 核心文件重叠，必须进入兼容门 |

## `5c499602` 的直接重叠

- `game-projection/game-projection.service.ts`
  - `PressureDecisionPresentationServiceV1` 改为 `PressureTurnPresentationServiceV1`；
  - 字段从 `decisionPresentations` 改为 `turnPresentations`；
  - 唯一 Projector 主体没有被替换，但 M3 patch 上下文会冲突。
- `game-projection/index.ts`
  - 新增导出 `turn-authority-draft`；
  - M1 已修改同一 index，必须合并导出，不能覆盖远程新增权威。
- `product/product-root.ts`
  - ProductRoot 输入和构造参数切换到 Turn Presentation；
  - 后续 M4 接线必须以新接口为准，不能恢复旧 Decision Presentation。

## 兼容门

M2/M3 工件仍先按冻结输入树独立验收。之后必须：

1. 证明 M2 persistence 写集与四个新提交没有语义冲突；
2. 把 M3 的快照入口重新落到 `5c499602` 的唯一 `projectResolvedSources()` 链；
3. 保留 `PressureTurnPresentationServiceV1`、`turn-authority-draft` 和新 ProductRoot 输入；
4. 重跑 M1、M2、M3 聚焦测试与 API typecheck；
5. 检查 staged/changed `apps/web/**` 必须为空；
6. 只有上述通过，才允许生成基于新 main + accepted M1/M2/M3 的 M4/M5 Pro 输入包。

当前结论：`REMOTE_MAIN_DRIFT_IDENTIFIED / COMPATIBILITY_NOT_YET_PROVEN`。
