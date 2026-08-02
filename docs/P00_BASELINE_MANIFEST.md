# P00 可信基线清单

## 基线身份

- 仓库：`forwardFish/aiStoryRoom`
- 唯一源码基线：`main@d5aff3096f901cc41ed4fd9c5e290855a46f480e`
- 功能分支：`feat/story-v2-p00-baseline-gates`
- 基线提交标题：`refactor(story): adopt OpenNovel-first durable truth gate`
- 语料：`p00-historical-blockers.sanitized.json`
- Schema：`p00-historical-blocker-corpus-v1`
- 来源索引：`p00-historical-source-index.sanitized.json`
- 来源索引 Schema：`p00-sanitized-source-index-v1`
- 来源索引 SHA-256：`0dd305dde43068dddfa36e6ff897f00c19ea291ebbc40dc88f324a385bfa3c64`

完整基线 SHA 已同时固化在语料、来源索引、离线校验器与本清单中。`pnpm p00:replay` 会交叉验证这些值，而不是信任手写统计。

## 统计口径

来源索引包含 150 条匿名 `runRef`，以及 `hasShadowAudit`、审计文件 SHA-256、审计记录数和阻断记录数。代码通过 `runs.length`、布尔计数和逐项求和重算全部来源统计。corpus 顶层 `counts` 只作为冗余校验值，任何字段与重算结果不一致都会失败。重放器同时验证 `sourceIndex.blockingRecords === corpus.records.length === 98`。

```text
runDirectories: 150
shadowAuditFiles: 145
auditRecords: 290
blockingRecords: 98
```

Round 2 逐条复核后的可重算结果：`REAL_P0=0`、`FALSE_POSITIVE=12`、`UNCERTAIN=86`。这不表示历史运行不存在真实 P0，而是当前脱敏附件没有一条同时保留完整正文、说话者授权策略和 required-result/causal contract，不能依据 validator 的结论性警告建立 Gold REAL_P0。数字由代码重新计算，文档不作为数据源。

## 语料 Schema

每条阻断记录必须包含：

- 唯一 `auditId`（`B001`—`B098`）与单向散列前缀 `sourceRef`；
- `turnId`、`auditFinding.severity`；
- 四组审计警告数组；
- `humanClassification`，只能是 `REAL_P0`、`FALSE_POSITIVE`、`UNCERTAIN`；
- 非空且可审查的 `classificationRationale`；
- `reviewEvidence.excerpt`、`speechAct`、`assertedPredicate`、`expectedPredicateEvidence` 四项最小审查依据。

校验器还检查基线 SHA、schemaVersion、允许分类的稳定顺序、统计字段类型、auditId 唯一性、sourceRef 格式以及 98/98 分类和证据字段覆盖率。

来源索引校验器检查 `runRef` 唯一性和格式、audit SHA-256 完整性、无 audit 条目的 null/零计数约束、`blockingRecordCount <= auditRecordCount`，并严格比较索引 counts、corpus counts 与代码重算结果。索引不含运行名称、路径、正文、请求/响应、Reader Action、用户信息、密钥、Cookie、数据库或浏览器状态。

## 分类标准

- `REAL_P0`：新增关键人物、正式文书、证据或命令；改变持久所有权、状态、位置、公开或销毁状态；泄露秘密；替玩家追加签署、承诺、命令或行动；遗漏本轮必须可见的结果。
- `FALSE_POSITIVE`：普通叙事纹理、明确分词误判、纯风格或措辞问题，没有落成持久因果。
- `UNCERTAIN`：脱敏片段主语不明、低置信度歧义或上下文不足，不能安全判为 P0，也不能确定为明显误判。

人工结论逐条保存在语料中；`scripts/p00/manual-annotations.mjs` 保留同一批审查决策的可追踪来源。它不进入运行时判定，不包含故事专用正则或 worldId 分支。明确纹理、疑问、否定或未核实表达从 P0 中剥离；其余缺正文、Actor Policy 或结算合同的记录保守归为 `UNCERTAIN`。B004 是明确未核实表达；B005 的派员文字是问题，另一数量警告又缺原句，因此整体为 `UNCERTAIN`。

## 包含范围

- 根 workspace 元数据；
- `apps/openovel-runtime/**`；
- `packages/openovel-runtime/**`（完整仓库中的 Evidence/Shadow compiler；上一轮安全压缩包未包含）；
- `packages/shared/**`、`packages/templates/**`；
- `third_party/openovel/**`；
- v4.0 架构文档、历史审计设计、P00 任务说明；
- 脱敏后的 98 条阻断语料。

## 排除范围

- `.git`、本机脏工作区与未提交变更；
- `.runtime`、原始 provider 请求/响应、真实 reader action、真实 run ID；
- `.env*`、密钥、Token、Cookie、浏览器状态；
- 数据库、真实用户数据、线上配置；
- `node_modules`、缓存、构建产物；
- 与 P00 无关且安全导出未包含的 API/Web 等 workspace。

## 重放与查询

```bash
pnpm p00:replay
pnpm p00:corpus -- --stats
pnpm p00:corpus -- --classification REAL_P0 --turn-id T03 --keyword 文书
pnpm p00:corpus -- --severity HIGH --json
```

所有命令只读取仓库 fixture，不访问外部模型或 provider。

## 双 workspace 工程门

完整仓库有两套职责不同、名称不可互换的 OpenNovel workspace：

| 门 | 目录 | package name | 职责 | spec |
|---|---|---|---|---:|
| app runtime | `apps/openovel-runtime` | `@apps/openovel-runtime` | OpenNovel-first 应用运行时 | 2 个文件，97 tests |
| evidence runtime | `packages/openovel-runtime` | `@ai-story/openovel-runtime` | Evidence/Shadow 编译与审计 | 2 个文件，33 tests |

`pnpm test:openovel-runtime` 只运行 app runtime；`pnpm test:openovel-evidence-runtime` 只运行 evidence runtime。八条既有 `openovel:evidence*`、`openovel:world-bible`、`openovel:compare`、`openovel:shadow-*` 根命令继续指向真正提供对应 script 的 evidence runtime，并通过 script-existence wrapper 阻止 pnpm 的静默空跑。

证据源文本统一以通用 `docs/**/*.txt text eol=crlf` 属性检出，使冻结的字节级 source hash 在 Windows 和 Unix worktree 一致。
Evidence 生成目录的 JSON/JSONL 统一为 LF；`pnpm p00:check-evidence-clean` 执行真实 build，并要求该目录在 build 前后均保持 Git clean。
