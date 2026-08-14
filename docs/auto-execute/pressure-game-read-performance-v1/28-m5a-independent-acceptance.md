# M5A 纯观测合同与离线汇总独立验收

日期：2026-08-15

状态：`M5A_CODE_ACCEPTED / NOT_WIRED`。

这不是 SQL/access reduction、真实 p50/p95 或 `PERF_PASS`。M5A 只提供无副作用合同与离线统计，运行时采集属于 M5B。

## 工件

- Pro 对话：`https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f3fe0-3ae4-83e9-a120-614d96cb01e3`
- ZIP：`Pressure_GET_game_M5A_pure_observation_delivery_a98ef29c.zip`
- 大小：36,354 bytes
- SHA-256：`516C47A6664B224D9100AB84B1FDFE538E207781DDD9F0DD981E3C75F7B43F96`
- 精确输入基线：`a98ef29c43545ebef985176e952fc756b33bcce1`
- 只新增 4 个 `observability/game-read-*` 文件；没有修改任何既有生产文件。

ZIP、manifest、4 个 changed-files 和 patch 的完整性相符；patch 可在最新组合预验收树机械应用。密钥扫描唯一命中为测试中的 `postgresql://private:password@example.invalid/database` 拒绝样本，不是真实连接串。

## 合同结论

- observation 固定 REPLAY/SHADOW/FAST、合法 shadow 状态矩阵、四类 outcome、request/scenario digest、wall time 与数据库 metrics；
- 输出克隆并冻结，不保留原始身份、SQL、异常文本或敏感输入；
- summary 只统计 warm 样本，少于 10 条返回 `INSUFFICIENT_SAMPLES`；
- percentile 固定 nearest-rank，wall time 与 query duration 分开；
- acceptance evidence 使用去敏枚举、哈希身份和自排除 canonical `evidenceHash`，可独立复算与篡改校验。

## Codex 独立门

在 `a98ef29c + I1 + M2 + M4A` 最新组合预验收树中只运行一次 M5A 聚焦门：

- `game-read-observation.spec.ts`：11/11 PASS；
- `pnpm --filter @apps/api typecheck`：PASS；
- `git diff --check`：PASS；
- 生产范围审查：无 HTTP、selector、ProductRoot、数据库、页面或现有 metrics 运行行为变化。

## 开放项

- M5B 只允许做最小 observer/sink 接线，观测失败不得影响玩家响应；
- M5B 必须复用现有 request-local Prisma metrics，不得建立第二 SQL 计数权威；
- M5B 后才执行一次统一功能等价门与一次真实前后采样。
