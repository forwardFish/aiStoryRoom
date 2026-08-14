# Latest-main M2 + M4A 组合预演

日期：2026-08-15

## 结论

`M2_LATEST_MAIN_COMPATIBLE` 与 `M4A_LATEST_MAIN_COMPATIBLE`。这只是隔离树中的机械组合预演，不代表 M4B 接线、M5、SHADOW、真实数据库访问或整体性能通过。

## 准确环境

- 隔离验证树：`D:\tmp\pressure-get-final-preflight-a98ef29c`
- 基线：`origin/main@a98ef29c43545ebef985176e952fc756b33bcce1`
- 预先存在：M1 的两个新增快照文件；没有把旧基线 `index.ts` 或 M3 service 覆盖到最新 main
- M2 工件：`Pressure_GET_game_M2_PrismaAggregateSnapshotReader_b6f512_M1accepted.zip`
  - size：53,550 bytes
  - SHA-256：`8485CDCB02845316CE35BB02F5066F3C6C6DFCB2F8B2E0FE2927569C2F5274F2`
- M4A 工件：`Pressure_GET_game_M4A_mode_selector_b6f512.zip`
  - size：18,924 bytes
  - SHA-256：`EB2786D0E8829AFE0FC23CAB662E51FA71B68C202E5531F78EFAF4C0E5EC5090`

两个 `changes.patch` 均在该最新 main 基线上通过 `git apply --check` 并机械应用。M2 测试保留先前独立验收确认的一行 Prisma 6.19 兼容修正：`query.sql.join("?")` 改为 `query.strings.join("?")`；生产 Reader 未改。

## 聚焦验证

最终有效测试命令：

```powershell
pnpm exec node --import tsx --test `
  apps/api/src/pressure-chapter/game-projection/game-read-snapshot.spec.ts `
  apps/api/src/pressure-chapter/persistence/game-read-snapshot.prisma-adapter.spec.ts `
  apps/api/src/pressure-chapter/game-projection/game-read-mode-selector.spec.ts
```

结果：

- tests：75
- pass：75
- fail：0
- duration：约 0.91 秒

附加门：

- `pnpm --filter @apps/api typecheck`：PASS
- `git diff --check`：PASS

第一次测试调用把 PowerShell 文件数组传成单个参数，属于命令构造错误；第二、第三次分别暴露验证树尚未安装 `tsx`、尚未构建 workspace 的 `@ai-story/shared` / `@ai-story/templates`，均属于隔离环境准备问题。离线安装、Prisma generate 和两个 workspace build 完成后，只执行一次有效聚焦测试并得到 75/75。没有修改产品代码来迎合这些环境错误。

## 尚未证明

- I1 对最新 turn presentation 权威链的兼容移植；
- M4B 正式 HTTP/ProductRoot composition；
- M5A/M5B 请求级观测；
- REPLAY/SHADOW/FAST 功能等价；
- 真实 PostgreSQL/Supabase SQL、协议往返、事务与延迟；
- 玩家正式 `/game` 流程；
- 最终分支提交或推送。
