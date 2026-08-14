# M5B 请求级运行观测独立验收

日期：2026-08-15

状态：`M5B_CODE_ACCEPTED`。该状态只证明请求级观测最小接线的代码与离线行为；不代表 `ACCESS_REDUCTION_PASS`、`SQL7_PASS`、真实 Supabase、warm p50/p95 或 `PERF_PASS`。

## ChatGPT Pro 交付

- 普通 Chat 对话：`https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f54af-4b20-83e8-9608-d1011822408d`
- 输入源码包：`Pressure_GET_game_M5B_runtime_observation_source_a98ef29c.zip`
- 输入大小：4,569,180 bytes
- 输入 SHA-256：`0595DB47F9A8A888DF9BD426E33CD5ADDE9F4FE828136E5BEAC60E870A1BEF0B`
- 交付 ZIP：`Pressure_GET_game_M5B_request_observation_delivery_a98ef29c.zip`
- 交付大小：58,177 bytes
- 交付 SHA-256：`2011B35FDBE6AA0E4BC69F2778908F490BFAEC3D26477D356F6EA9EA20C9AD86`
- 准确基线：`main@a98ef29c43545ebef985176e952fc756b33bcce1` 加已验收 I1/M2/M4A/M4C/M5A 组合。

ZIP 根目录、manifest、report、patch 与 6 个 changed-files 齐全；补丁在当前组合树通过 clean apply check。机械应用后，6 个目标文件与交付文件逐文本一致（只忽略 CRLF/LF 表示差异）。

## 实际范围

新增：

- `apps/api/src/pressure-chapter/observability/game-read-runtime-observer.ts`
- `apps/api/src/pressure-chapter/observability/game-read-runtime-observer.spec.ts`

修改：

- `apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.ts`
- `apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.spec.ts`
- `apps/api/src/pressure-chapter/product/product-root.ts`
- `apps/api/src/pressure-chapter/product/pressure-chapter-product.api.spec.ts`

普通 GET `/game` 在既有 `pressureHttpBoundary` 内只包一层 request-local observer；ProductRoot 把同一 observer 实例注入 GET facade 与现有 SHADOW diagnostics。数据库指标仍唯一读取既有 `readPressureDbRequestMetricsV1()`，没有新增 SQL、Prisma hook、事务、网络、endpoint、数据库对象或玩家页面。

## Codex 独立验证

一次组合聚焦运行首先得到 81 项中的 79 PASS；两个 spec 未进入测试逻辑，归因于首条命令没有加载 API decorator tsconfig。只重跑这两个失败文件：

- HTTP facade：21/21 PASS，包括 GET 恰好观测一次、成功值与错误对象身份保持、其他方法不观测。
- ProductRoot：目标树中的 3 项先被已知 Windows CRLF 发布物哈希门阻断；没有修改正式发布物。
- 在隔离验证副本仅把任务书已记录的两份 action-effect compiler 发布物规范为 LF，并生成副本自己的 Prisma Client 后，ProductRoot 19/19 PASS，其中同一 observer 连接 GET 与 SHADOW 的新用例通过。
- 其余已进入断言的 M4A/M4C/M5A/M5B 聚焦门：79/79 PASS。
- 合计实际进入断言的聚焦测试：119/119 PASS。
- `pnpm --filter @apps/api typecheck`：PASS，TypeScript 脚本真实执行。
- `git diff --check`：PASS。
- `apps/web/**`：0 changed files。

隔离副本路径：`D:\tmp\m5b-productroot-verify-2011b35f`。该副本不属于交付，不提交；目标分支的两份发布物、schema、migration 和页面均未修改。

## 仍未证明

- REPLAY/SHADOW/FAST 真实 Supabase 同请求功能等价；
- FAST GET application SQL、协议往返和事务硬门；
- SQL7 POST + FAST GET 总访问数；
- 10 条 warm 样本 p50/p95；
- 玩家正式 `/game` 流程；
- commit、push、merge、deploy 或 migration。

下一模块先完成 M4D1 单 SQL 权限检查；M4D2 只能在读取 M5B 最终接口后设计，并保持 REPLAY/SHADOW 原路径不变。
