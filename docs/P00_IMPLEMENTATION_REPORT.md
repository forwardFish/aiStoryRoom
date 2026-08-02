# P00 实施与独立验收报告

## 结论

P00 Round 3 已在 `main@d5aff3096f901cc41ed4fd9c5e290855a46f480e` 的完整 8-workspace 仓库中返修，并由 Codex 在真实 Windows 新隔离 worktree `D:\tmp\aiStoryRoom-v4-p00-verify-855df14` 对实现提交 `855df1420da9f4dadc401cb08c2b82e887d4e959` 完成独立验收。实现范围仍仅包括可信基线、历史阻断人工分类/查询、脱敏来源索引、两套 OpenNovel workspace 工程门、Evidence 生成幂等门与离线 replay；没有实现 P01—P08。

离线重放结果为 150 个 run 目录、145 个 shadow audit 文件、290 条审计记录、98 条阻断记录；98/98 均有合法人工分类、理由和最小审查依据。Round 2 分类为 `REAL_P0=0`、`FALSE_POSITIVE=12`、`UNCERTAIN=86`。零个 `REAL_P0` 仅表示附件不足以独立证明 Gold true positive，不表示历史运行不存在真实 P0。

## 设计

1. `corpus.mjs` 是唯一 schema/统计实现，校验基线、字段、98/98 完整性并提供稳定排序的过滤与聚合。
2. `corpus-cli.mjs` 支持按 classification、severity、turnId、keyword 联合查询，输出稳定 JSON 或统计。
3. `openovel-test-gate.mjs` 为 app runtime 和 evidence runtime 建立名称明确、目录唯一的非空测试门；非零退出、错误目标、零测试、缺少测试计数或 `No projects matched` 均失败。
4. `pnpm-runner.mjs` 在 Windows 通过 `node + npm_execpath` 启动 pnpm，固定参数数组且 `shell:false`，不再直接 spawn `pnpm.cmd`。
5. `workspace-script-gate.mjs` 在执行前验证 package name 和 requested script；即使 pnpm 对缺失 script 返回 0，也不能形成 PASS。
6. Evidence/Shadow 根命令恢复到真正提供这些 scripts 的 `@ai-story/openovel-runtime`；app runtime 测试门仍指向 `@apps/openovel-runtime`。
7. `replay-audit.mjs` 不运行 provider，验证两套 package name、目录、根命令映射和两组非空 spec，固定报告 `providerCalls: 0`。
8. legacy 隔离测试改为检查真实 import/require specifier `@ai-story/openovel-runtime`，不再把普通文件名片段误判为 package 导入。
9. `.gitattributes` 对 `docs/**/*.txt` 固定 CRLF，使冻结 Evidence source hash 跨平台一致。
10. 98 条记录逐条重审，不再把旧 validator 警告本身当成事实证据；新增四项 `reviewEvidence` 字段。
11. Evidence 生成 JSON/JSONL 固定 LF，并新增真实 build 前后 Git 清洁度门。
12. `package.json` 恢复基线 LF，只保留真实脚本差异。
13. `source-index.mjs` 从 150 条匿名 run 索引重算 150/145/290/98；corpus counts 仅作严格交叉校验，不再作为统计来源。
14. source-index 负例覆盖记录数篡改、重复 runRef、无 audit 却带 hash/records，以及顶层 counts 篡改。

## 修改文件

- `package.json`
- `.gitattributes`
- `p00-historical-blockers.sanitized.json`
- `p00-historical-source-index.sanitized.json`
- `scripts/p00/apply-manual-annotations.mjs`
- `scripts/p00/corpus-cli.mjs`
- `scripts/p00/corpus.mjs`
- `scripts/p00/evidence-clean-gate.mjs`
- `scripts/p00/manual-annotations.mjs`
- `scripts/p00/openovel-test-gate.mjs`
- `scripts/p00/pnpm-runner.mjs`
- `scripts/p00/p00.spec.mjs`
- `scripts/p00/replay-audit.mjs`
- `scripts/p00/source-index.mjs`
- `scripts/p00/workspace-script-gate.mjs`
- `packages/openovel-runtime/tests/context.spec.ts`
- `docs/P00_BASELINE_MANIFEST.md`
- `docs/P00_IMPLEMENTATION_REPORT.md`

没有修改现有运行时源文件，没有删除或弱化测试，没有添加 `skip`、`only`、`todo`，没有吞掉任何子进程退出码。legacy 测试断言只从模糊文件名 substring 改为真实 package specifier 检查。

## 验证证据

所有 pnpm 命令在沙箱中设置可写的 XDG data/cache/state 目录；这些临时目录不提交。

| 命令 | 最终退出码 | 实际数量/关键输出 |
|---|---:|---|
| `pnpm install --frozen-lockfile` | 0 | `Scope: all 8 workspace projects`; `Already up to date` |
| `pnpm --filter @ai-story/templates build` | 0 | `tsc -p tsconfig.build.json` |
| `pnpm --filter @apps/openovel-runtime typecheck` | 0 | `tsc --noEmit` |
| `pnpm --filter @apps/openovel-runtime test` | 0 | 97 tests，97 pass，0 fail，0 skipped/todo |
| `pnpm --filter @ai-story/openovel-runtime typecheck` | 0 | `tsc --noEmit` |
| `pnpm --filter @ai-story/openovel-runtime test` | 0 | 33 tests，33 pass，0 fail，0 skipped/todo |
| `pnpm test:openovel-runtime` | 0 | app gate：2 files，97 tests |
| `pnpm test:openovel-evidence-runtime` | 0 | evidence gate：2 files，33 tests |
| `pnpm p00:check-evidence-command` | 0 | 无副作用验证 `evidence:build` 确实由 `@ai-story/openovel-runtime` 提供 |
| `pnpm p00:check-evidence-clean` | 0 | 真实执行 `evidence:build`；`EVIDENCE_BUILD_PASS`，生成目录保持 clean |
| `pnpm test:p00` | 0 | 11 tests，11 pass；含四类 source-index 篡改负例 |
| `pnpm p00:replay` | 0 | `providerCalls=0`；从索引重算 150/145/290/98，分类为 0/12/86 |
| `pnpm p00:corpus -- --stats` | 0 | 使用同一索引重算来源统计，不信任 corpus counts |
| `git diff --check d5aff3096f901cc41ed4fd9c5e290855a46f480e` | 0 | 无 trailing whitespace；`package.json` 为 LF |

首次环境诊断也如实保留：

- 首次裸 `pnpm install --frozen-lockfile`：退出码 254，沙箱不可写 `/root/.local`；改用可写 XDG 目录。
- 首次可写目录安装：依赖实际安装完成，但 pnpm 11 的 ignored-build policy 返回退出码 1；随后以 `--ignore-scripts` 完成锁文件安装，再原样运行 `pnpm install --frozen-lockfile`，最终退出码 0。P00 测试不依赖 Prisma/Nest build scripts。
- Round 1 首次 legacy test 在 Linux clone 因证据源 LF 与冻结 CRLF hash 不同产生 30 条连锁失败；加入通用文本 EOL 约束后，同一命令为 33/33。未修改冻结 hash 或证据内容。
- Codex Round 2 Windows 独立验收确认 Round 1 的 Windows runner、双 workspace 门和静默空跑修复通过，同时发现语义标注、package EOL、Evidence 输出 EOL 和全仓基线 blocker 记录问题；这些问题已在后续返修中解决。
- Codex 最终 Windows 独立验收执行了 `pnpm install --frozen-lockfile`（8 workspaces）、templates build、两套 runtime 的 typecheck 和直接测试、两条根测试门、11 条 P00 测试、replay、corpus stats、连续 Evidence clean gate 与 `git diff --check`。结果分别为 app runtime 97/97、evidence runtime 33/33、P00 11/11，`providerCalls=0`，来源索引重算 150/145/290/98、分类 0/12/86；连续运行 Evidence build 后 `EVIDENCE_BUILD_PASS` 且 worktree 保持 clean。
- 上传的安全来源索引原始 SHA-256 与 Git blob SHA-256 均为 `0dd305dde43068dddfa36e6ff897f00c19ea291ebbc40dc88f324a385bfa3c64`。Windows checkout 因 Git EOL 转换产生不同字节哈希，但 checkout JSON、上传 JSON 与 Git blob 的语义数据一致。
- Codex 在最终验收环境执行根 `pnpm typecheck` 与 `pnpm build`，两者退出码均为 1；干净 `main@d5aff309…` 得到同一组 API 类型错误，涉及 `ActorTurnActionAvailabilityV2`、`reserveSoloActionCharge` 和 projection 字段。它们是基线 blocker，不是 P00 回归；当前仓库尚未形成全仓 typecheck/build PASS，P00 不越权修改 API。

## 验证层级

| 层级 | P00 状态 | 说明 |
|---|---|---|
| 工程测试 | 已执行，通过 | 11 条 P00、97 条 app runtime、33 条 evidence runtime，以及 Evidence clean gate |
| Mock/fixture | 已执行，通过 | 历史 corpus、英语 speech-act、错误/零测试 fixture、Windows runner 模拟 |
| 真实模型验证 | 未执行，按阶段禁止 | 未调用 GLM、DeepSeek、Kimi 或其他 provider |
| 真实玩家验收 | 未执行，按阶段禁止 | P00 不把 Mock 或 G00—T05 当作玩家验收 |

## 未执行项与风险

- 已完成真实 Windows 机器上的返修后独立复验；Windows runner、双 workspace 非空门、离线 replay、Evidence clean gate 和差异清洁度均通过。
- 全仓 `pnpm typecheck` 与 `pnpm build` 已由 Codex 独立执行且均因相同基线 API 错误失败；本次实现者未重复修改或修复该 P00 范围外 blocker。
- 86 条 `UNCERTAIN` 明确保留缺少正文、Actor Policy 或 required-result contract 的风险；补充脱敏证据后应逐条复核，不能自动升级为 P0 或误报。
- source counts 150/145/290/98 由 150 条匿名、hash-only source index 逐项计算，并与 corpus counts 和 98 条阻断明细严格交叉验证，不再信任冻结汇总顶层数字。当前安全包不含原始 `.runtime`，因此可以重放脱敏索引，但不能从仓库重新读取原始正文或模型请求。

## 安全边界

没有调用真实模型，没有数据库迁移、部署、线上配置或真实用户数据操作；没有提交 `.runtime`、`.env`、密钥、Token、Cookie、浏览器状态、数据库、`node_modules`、缓存或构建产物。
