# P00 实施报告

## 结论

P00 已在 `main@d5aff3096f901cc41ed4fd9c5e290855a46f480e` 的安全导出上完成。实现范围仅包括可信基线、历史阻断人工分类/查询、根 OpenNovel workspace 修正、非空测试门与离线 replay；没有实现 P01—P08 的 Truth Reviewer、Settlement、Narrator 或多人投影重构。

离线重放结果为 150 个 run 目录、145 个 shadow audit 文件、290 条审计记录、98 条阻断记录；98/98 均有合法人工分类和理由。分类汇总为 `REAL_P0=76`、`FALSE_POSITIVE=11`、`UNCERTAIN=11`。

## 设计

1. `corpus.mjs` 是唯一 schema/统计实现，校验基线、字段、98/98 完整性并提供稳定排序的过滤与聚合。
2. `corpus-cli.mjs` 支持按 classification、severity、turnId、keyword 联合查询，输出稳定 JSON 或统计。
3. `openovel-test-gate.mjs` 先验证真实 package 名和 `tests/*.spec.ts` 非空，再执行 pnpm；非零退出、错误 workspace、零测试、缺少测试计数或 `No projects matched` 均失败。
4. `replay-audit.mjs` 不运行 provider，只交叉验证语料、统计、根脚本、workspace 和测试文件，固定报告 `providerCalls: 0`。
5. `p00.spec.mjs` 对根脚本、错误 workspace、零测试、TAP 测试数量、98/98 schema 和查询确定性做工程测试。

## 修改文件

- `package.json`
- `p00-historical-blockers.sanitized.json`
- `scripts/p00/apply-manual-annotations.mjs`
- `scripts/p00/corpus-cli.mjs`
- `scripts/p00/corpus.mjs`
- `scripts/p00/manual-annotations.mjs`
- `scripts/p00/openovel-test-gate.mjs`
- `scripts/p00/p00.spec.mjs`
- `scripts/p00/replay-audit.mjs`
- `docs/P00_BASELINE_MANIFEST.md`
- `docs/P00_IMPLEMENTATION_REPORT.md`

没有修改现有运行时源文件或测试断言，没有添加 `skip`、`only`、`todo`，没有吞掉任何子进程退出码。

## 验证证据

所有 pnpm 命令在沙箱中设置可写的 XDG data/cache/state 目录；这些临时目录不提交。

| 命令 | 最终退出码 | 实际数量/关键输出 |
|---|---:|---|
| `pnpm install --frozen-lockfile` | 0 | `Scope: all 4 workspace projects`; `Already up to date` |
| `pnpm --filter @ai-story/templates build` | 0 | `tsc -p tsconfig.build.json`；为安全导出补齐未包含的依赖类型产物 |
| `pnpm --filter @apps/openovel-runtime typecheck` | 0 | `tsc --noEmit` |
| `pnpm --filter @apps/openovel-runtime test` | 0 | 97 tests，97 pass，0 fail，0 skipped/todo |
| `pnpm test:openovel-runtime` | 0 | 97 tests；`P00_OPENOVEL_GATE_OK workspace=@apps/openovel-runtime files=2 tests=97` |
| `pnpm test:p00` | 0 | 7 tests，7 pass；包含错误 workspace/零测试失败证明及 98/98 完整性 |
| `pnpm p00:replay` | 0 | `ok=true`、`providerCalls=0`、150/145/290/98、发现 2 个 spec 文件 |

首次环境诊断也如实保留：

- 首次裸 `pnpm install --frozen-lockfile`：退出码 254，沙箱不可写 `/root/.local`；改用可写 XDG 目录。
- 首次可写目录安装：依赖实际安装完成，但 pnpm 11 的 ignored-build policy 返回退出码 1；随后以 `--ignore-scripts` 完成锁文件安装，再原样运行 `pnpm install --frozen-lockfile`，最终退出码 0。P00 测试不依赖 Prisma/Nest build scripts。
- 首次 OpenNovel typecheck：退出码 2，因为安全导出排除了 `packages/templates/dist`；构建该 workspace 后原命令退出码 0，未修改业务类型或弱化检查。

## 验证层级

| 层级 | P00 状态 | 说明 |
|---|---|---|
| 工程测试 | 已执行，通过 | 7 条 P00 测试及 97 条既有 OpenNovel 测试 |
| Mock/fixture | 已执行，通过 | 历史脱敏 corpus、临时错误 workspace 与零测试 fixture |
| 真实模型验证 | 未执行，按阶段禁止 | 未调用 GLM、DeepSeek、Kimi 或其他 provider |
| 真实玩家验收 | 未执行，按阶段禁止 | P00 不把 Mock 或 G00—T05 当作玩家验收 |

## 未执行项与风险

- 未执行根 `pnpm typecheck`：安全导出不含完整应用 workspace；P00 自身与目标 OpenNovel workspace 已独立验证。
- 未执行生产 `pnpm build`：根 build 指向导出中不存在的 `@apps/api`，且可能触发 Prisma/生产构建链；不在 P00 授权范围。
- 人工分类基于脱敏语料。11 条 `UNCERTAIN` 明确保留上下文不足风险，后续审查不应把它们自动升级为 P0。
- source counts 150/145/290 来自生成该脱敏附件时的冻结汇总；当前安全包不含原始 `.runtime`，因此 replay 校验其 schema、一致性与 98 条阻断明细，但不会伪称重新读取原始运行目录。

## 安全边界

没有调用真实模型，没有数据库迁移、部署、线上配置或真实用户数据操作；没有提交 `.runtime`、`.env`、密钥、Token、Cookie、浏览器状态、数据库、`node_modules`、缓存或构建产物。
