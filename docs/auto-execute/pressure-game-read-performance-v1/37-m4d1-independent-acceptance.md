# M4D1 权限检查单 SQL 独立验收

日期：2026-08-15

状态：`M4D1_CODE_ACCEPTED / REAL_DATABASE_NOT_YET_MEASURED`。

该状态证明权限 adapter 已从两个顺序 Prisma 读取收敛为一个参数化 application statement，并通过官方聚焦测试与 API typecheck；真实 Supabase 总访问数、完整 GET 功能等价和延迟仍留到统一验收。

## ChatGPT Pro 交付

- 普通 Chat 对话：`https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f6961-4fe0-83ee-8161-7d16ed0f39a6`
- 输入形式：平台保存的 UTF-8 pasted-text，68,796 bytes；Pro 实测 SHA-256 `B62043E80C9DD7F4E15D543189D0F3040FDFEECFAC15F30B00BC89722E6B6C5B`。发送前内联拼装摘要与平台文本表示不同，未虚构 byte equality。
- 交付 ZIP：`Pressure_GET_game_M4D1_access_single_query_delivery_a98ef29c.zip`
- 大小：16,413 bytes
- SHA-256：`6438FBC2AAB26A2ECAB8CD6D35CAE04BD7205331760EEB0A9F868CFB7520CC35`
- 基线：`main@a98ef29c43545ebef985176e952fc756b33bcce1` 加当前已验收 Pressure GET 组合。

ZIP 的 changed-files、patch、manifest、report 齐全；patch 在当前组合树 clean-apply。机械应用后 3 个目标文件与交付文本一致（忽略 CRLF/LF 表示差异）。

## 实际修改

- `apps/api/src/pressure-chapter/http-production/access.adapter.ts`
- `apps/api/src/pressure-chapter/http-production/ports.ts`
- `apps/api/src/pressure-chapter/http-production/http-production.spec.ts`

`authorize()` 现在只调用一次 `$queryRaw(Prisma.sql)`，同一 statement 绑定：

- 精确 StoryRun id、canonical engine/strategy；
- 精确 PressureRunRouteSnapshot run/schema/engine/strategy/runtime profile；
- 精确 StoryPlayer(runId,userId)、human、active membership。

空输入或 subject/viewer 不一致在 SQL 前返回 null；0 行、多行或任意返回字段不一致均 fail-closed。没有事务、缓存、fallback、route JSON、席位秘密、private projection、schema/migration、endpoint 或页面变化。

## Codex 独立验证

- 官方 `http-production.spec.ts`：7/7 PASS；
- 有效授权断言 1 raw query、0 transaction；
- 无效输入断言 0 SQL；
- 参数化 SQL、0/1/>1 行、run/route/membership 成功与拒绝矩阵全部通过；
- `pnpm --filter @apps/api typecheck`：PASS，TypeScript 脚本真实执行；
- `git diff --check`：PASS；
- changed paths 严格为 3 个后端/测试文件，`apps/web/**`、Prisma schema/migration、M5B、ProductRoot 均未修改。

## 仍未证明

- 真实 PostgreSQL 的 statement count 与 query plan；
- M4D2 合并后的 FAST GET 总 application SQL <= 2；
- REPLAY/SHADOW/FAST 同场景投影等价；
- SQL7 POST + FAST GET 总访问数；
- warm p50/p95 与 `PERF_PASS`。
