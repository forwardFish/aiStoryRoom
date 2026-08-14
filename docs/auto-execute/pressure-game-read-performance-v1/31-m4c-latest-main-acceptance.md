# M4C 最新 main 接线独立验收

日期：2026-08-15

状态：`M4C_CODE_ACCEPTED / RUNTIME_NOT_MEASURED`。

## 工件

- Pro 对话：`https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f4b92-0a44-83e8-8db5-b61eac43da9a`
- ZIP：`Pressure_GET_game_M4C_latest_main_port_M4C_CANDIDATE.zip`
- 大小：49,343 bytes
- SHA-256：`FCBC4D22EDD6FFD37323D7E95CF53A3A3461B041137F951211A39477A0FF2CD0`
- 基线：`main@a98ef29c43545ebef985176e952fc756b33bcce1 + I1 + M2 + M4A`
- `changes.patch` SHA-256：`95366579F3B3ED1C101E8C154787F5BE7ED84DCD16C5B5A56A519463CBCCA4EC`

10 个批准路径均已落地。9 个路径沿用冻结 M4B，`product-root.ts` 由 M4C 保留最新主干 `PressureTurnPresentationServiceV1`、provider 和统一 turn 展示链后做最小接线。10/10 文件的 Git 规范化 blob 与 M4C 工件一致；4 个新增文件只有 Windows CRLF 表面字节差异。

## Codex 独立门

- M4B config + composition + HTTP facade：35/35 PASS；
- `pnpm --filter @apps/api typecheck`：PASS；
- `git diff --check`：PASS；
- ProductRoot：16/18 PASS，2 个失败都是未进入 M4C 断言前的既有 `SANGTIAN_ACTION_RELEASE_ARTIFACT_HASH_MISMATCH`；
- 没有 `apps/web/**`、数据库/schema/migration、Settlement、Provider、Prompt 或内容资产变化。

## 边界

M4C 只证明最新主干代码接线与默认 REPLAY 兼容。SHADOW 等价、FAST 真实 SQL/协议/事务和 warm p50/p95 仍未执行；不能声明 `ACCESS_REDUCTION_PASS` 或 `PERF_PASS`。
