# M4B 冻结基线接线独立验收

日期：2026-08-15

状态：`M4B_FROZEN_BASE_CODE_ACCEPTED / LATEST_MAIN_PORT_IN_PROGRESS`。

这不是最新 `main`、真实数据库、功能等价或性能 PASS。M4C 正在把同一接线语义移植到最新组合基线。

## 工件与范围

- Pro 对话：`https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f3b07-943c-83ee-b597-4885f101f69f`
- ZIP：`Pressure_GET_game_M4B_frozen_wiring_delivery.zip`
- 大小：48,236 bytes
- SHA-256：`DE331CA05D63614452945C580EAE97F41ACA3CF1CC126DD2690350CACDAA2FCF`
- `changes.patch` SHA-256：`77DD9DBC88451B295EA76FB6A1CF28FA13F02E82D47604CED7DD199E6D40178C`
- 精确基线：`b6f512442f7e67d6c6d0dcaa2e6449bdd849de44 + M1 + M2 + M3 + M4A`
- 修改 10 个批准后端路径：HTTP facade/spec、ProductRoot/spec、生产模式配置、生产 composition 及各自 index/spec。

没有修改 M1-M4A 冻结实现、数据库/schema/migration、Settlement、Provider、Prompt、内容包或 `apps/web/**`。高特征密钥扫描只命中 spec 中的无效示例值，没有真实凭据。

## 独立机械与代码门

- 在准确 `b6f51244 + M1/M2/M3/M4A` 隔离树中 `git apply --check` 与应用均 PASS；
- 10/10 工件原始 SHA-256、规范化 Git blob 与 manifest 一致；
- `git diff --check`：PASS；
- `pnpm --filter @apps/api typecheck`：PASS；
- 代码审查未发现冻结基线上的生产问题。

生产语义复核：默认模式是 `REPLAY`；普通 GET `/game` 通过注入的 `gameRead`，POST/提交后投影继续使用原 `game`；ProductRoot 只组合既有 M1-M4A 端口；SHADOW diagnostic 仍是内部安全字段；没有改变公开请求/响应。

## 独立聚焦测试

- M4B 配置与 composition：15/15 PASS；
- HTTP facade：20/20 PASS；
- ProductRoot：16/18 PASS，2 个失败均发生在未进入 M4B 断言前的既有 `SANGTIAN_ACTION_RELEASE_ARTIFACT_HASH_MISMATCH`；
- API typecheck：PASS。

Pro 报告中的 155/155 使用了临时运行时 stub 和 LF 规范化，只作为参考，不作为 Codex 正式证据。

## 最新 main 移植边界

M4B 对最新组合树的 10 个路径中，9 个可直接应用；只有 `product-root.ts` 因最新主干演进需要语义移植。M4C 必须保留最新主干 ProductRoot 变化，只移植 M4B 接线，不得整文件覆盖。
