# M3 r2 独立验收

验收时间：2026-08-14

## 工件

- ChatGPT Pro 普通 Chat：`https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f10de-5724-83e8-bd46-e28431ca4add`
- ZIP：`Pressure_GET_game_M3_unique_projector_b6f512_M1accepted_r2.zip`
- ZIP 大小：32,413 bytes
- ZIP SHA-256：`D0C16B02FAC99B73BC4D39BE63AB8F6E8678CCEFC52E309C566253DF84B83696`
- patch SHA-256：`9357FA6515836EAD2D6E83C14D5D0C1BA58D2693C8B73E653CDC64B5A067B49A`

## 修改范围

- `apps/api/src/pressure-chapter/game-projection/game-projection.service.ts`
- `apps/api/src/pressure-chapter/game-projection/game-read-snapshot-projector.spec.ts`

玩家可见文件修改列表为空。M3 不读数据库、不接 HTTP、不切换生产模式。

## 修正项

- `chapterSource` 运行时严格锁定为 P0；非 P0 立即 fail-closed。
- N1-N7、六席与 SOLO/TARGETED/SYNC 动态矩阵完整覆盖。
- `feedCursor`、`feedLimit` 在普通和 authority-seeded 读取中均有请求侧透传断言。
- 最终仍只有一个 `projectResolvedSources()` authority 汇聚点，没有第二 projector 或 sanitize 链。

## Codex 独立证据

- 工件 manifest、fileset、secret scan：PASS。
- 在冻结基线 + 已验收 M1 的独立 worktree 上 `git apply --check`：PASS。
- 应用补丁后 2/2 文件与 `changed-files` 一致，`git diff --check`：PASS。
- 聚焦测试：47/47 PASS。
- `pnpm --filter @apps/api typecheck`：PASS。
- 独立 code review：0 issues，`APPROVE`；reviewer 另行复跑 35/35 PASS 和 API typecheck PASS。

## 状态

`M3_ACCEPTED_ON_FROZEN_BASE / LATEST_MAIN_ADAPTATION_OPEN`

本结论证明 M3 r2 在冻结输入树上通过，不代表已兼容后续 `origin/main` 漂移，也不代表 SHADOW、FAST、真实 Supabase 或性能通过。
