# P00 实施报告

## 结论

P00 Round 1 已在 `main@d5aff3096f901cc41ed4fd9c5e290855a46f480e` 的完整 8-workspace 仓库中返修。实现范围仍仅包括可信基线、历史阻断人工分类/查询、两套 OpenNovel workspace 工程门与离线 replay；没有实现 P01—P08。

离线重放结果为 150 个 run 目录、145 个 shadow audit 文件、290 条审计记录、98 条阻断记录；98/98 均有合法人工分类和理由。分类汇总为 `REAL_P0=76`、`FALSE_POSITIVE=11`、`UNCERTAIN=11`。

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

## 修改文件

- `package.json`
- `.gitattributes`
- `p00-historical-blockers.sanitized.json`
- `scripts/p00/apply-manual-annotations.mjs`
- `scripts/p00/corpus-cli.mjs`
- `scripts/p00/corpus.mjs`
- `scripts/p00/manual-annotations.mjs`
- `scripts/p00/openovel-test-gate.mjs`
- `scripts/p00/pnpm-runner.mjs`
- `scripts/p00/p00.spec.mjs`
- `scripts/p00/replay-audit.mjs`
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
| `pnpm test:p00` | 0 | 9 tests，9 pass；包含 Windows runner、缺失 script、错误 workspace、零测试负例 |
| `pnpm p00:replay` | 0 | `providerCalls=0`；同时报告 app/evidence 两套 workspace 与 2+2 spec |

首次环境诊断也如实保留：

- 首次裸 `pnpm install --frozen-lockfile`：退出码 254，沙箱不可写 `/root/.local`；改用可写 XDG 目录。
- 首次可写目录安装：依赖实际安装完成，但 pnpm 11 的 ignored-build policy 返回退出码 1；随后以 `--ignore-scripts` 完成锁文件安装，再原样运行 `pnpm install --frozen-lockfile`，最终退出码 0。P00 测试不依赖 Prisma/Nest build scripts。
- Round 1 首次 legacy test 在 Linux clone 因证据源 LF 与冻结 CRLF hash 不同产生 30 条连锁失败；加入通用文本 EOL 约束后，同一命令为 33/33。未修改冻结 hash 或证据内容。
- Codex 的 Windows 独立验收在返修前复现了 `spawn EINVAL`、根 Evidence 静默空跑和 legacy 模糊导入断言。本报告只记录本次实现者在完整仓库的返修验证与 Windows runner 模拟回归；当前新提交尚未经过 Codex 的下一轮独立验收。

## 验证层级

| 层级 | P00 状态 | 说明 |
|---|---|---|
| 工程测试 | 已执行，通过 | 9 条 P00、97 条 app runtime、33 条 evidence runtime 测试 |
| Mock/fixture | 已执行，通过 | 历史 corpus、错误/零测试 fixture、Windows runner 模拟 |
| 真实模型验证 | 未执行，按阶段禁止 | 未调用 GLM、DeepSeek、Kimi 或其他 provider |
| 真实玩家验收 | 未执行，按阶段禁止 | P00 不把 Mock 或 G00—T05 当作玩家验收 |

## 未执行项与风险

- 未执行真实 Windows 机器上的返修后复验；已通过可注入 runner 回归证明 Windows 选择 `node + npm_execpath` 且 `shell:false`，仍需 Codex 在 Windows 隔离 worktree 独立复验。
- 未执行生产 `pnpm build`：不在 P00 Round 1 授权范围。
- 人工分类基于脱敏语料。11 条 `UNCERTAIN` 明确保留上下文不足风险，后续审查不应把它们自动升级为 P0。
- source counts 150/145/290 来自生成该脱敏附件时的冻结汇总；当前安全包不含原始 `.runtime`，因此 replay 校验其 schema、一致性与 98 条阻断明细，但不会伪称重新读取原始运行目录。

## 安全边界

没有调用真实模型，没有数据库迁移、部署、线上配置或真实用户数据操作；没有提交 `.runtime`、`.env`、密钥、Token、Cookie、浏览器状态、数据库、`node_modules`、缓存或构建产物。
