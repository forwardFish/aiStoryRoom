# Our Many Worlds Generic Endgame MVP
# 配置驱动通用终局引擎完整实现、测试与验收方案 v3.0

> 仓库：`forwardFish/aiStoryRoom`
> S0 冻结基线：`3771822db5dada5fc898c7c5b78cc0821a1e825b`
> 唯一分支：`codex/chatgpt-pro-main-game-final-v1`
> 本轮：S0 合同冻结；不实现 S1—S9，不重复已验收的 Stage B。

## 1. S0 目标与正式路径

S0 冻结配置驱动、世界无关的 package 文档，不接入运行时、API、Web 或数据库。正式文件：

```text
packages/shared/schemas/endgame/endgame-package-v1.schema.json
packages/shared/src/endgame/endgame-package-v1.contract.mjs
packages/shared/tests/generic-endgame-package-v1.s0.spec.mjs
packages/templates/config/endgame/examples/sangtian.endgame.example.json
packages/templates/config/endgame/examples/caesar.endgame.example.json
packages/templates/config/endgame/fixtures/neutral-synthetic.endgame.fixture.json
```

后续生产包路径冻结为 `packages/templates/config/<worldId>/endgame.json`；S0 示例不得被当作生产默认包。

## 2. Package 顶层合同

`endgame_package_v1` 是 `additionalProperties:false` 的封闭文档，必填：`schemaVersion/policyId/policyVersion/worldId/profileId/scope/stateVariables/completion/metrics/derivedMetrics/outcomeAxes/combinationOverrides/factTaxonomy/detailCompilation/narrative/validation/presentation/replay`。package 文档禁止 `packageHash` 字段。指标 2—8 个；轴 1—3 条；每轴恰好一个无 `when` 的 fallback；场景恰好一个无 `when` 的 fallback。ID 使用 `^[A-Za-z0-9][A-Za-z0-9._:-]*$`，policyVersion 使用 SemVer。

## 3. Rule DSL 封闭 allowlist

### 3.1 数值表达式

| operator | JSON 形状 | 参数 | 结果 |
|---|---|---:|---|
| metric | `{"metric":"id"}` | 1 | 已注册 base/derived metric |
| state | `{"state":"id"}` | 1 | `stateVariables` 中 NUMBER |
| constant | `{"constant":1}` | 1 | 有限 number |
| add/multiply/average/min/max | `{"add":[Num,...]}` | 1+ | number |
| subtract/divide | `{"subtract":[Num,Num]}` | 2 | number |
| invert | `{"invert":{"value":Num,"min":Num,"max":Num}}` | 3 | `min+max-value` |
| clamp | `{"clamp":{"value":Num,"min":Num,"max":Num}}` | 3 | 闭区间截断 |
| tagCount | `{"tagCount":{"selector":Selector,"tag":"x"}}` | 1 selector+tag | integer |
| factCount | `{"factCount":Selector}` | 1 | integer |

`divide` 分母为 0 必须 fail closed；任何输入或中间结果为 NaN/Infinity 必须失败；invert/clamp 要求有限边界且 `min <= max`。派生指标只可依赖已注册 base/derived metric，拓扑循环（含自环）在 package 校验时失败。最大深度 20，最大节点 500。

### 3.2 布尔表达式

| operator | JSON 形状 | 参数 |
|---|---|---:|
| all/any | `{"all":[Bool,...]}` | 1+ |
| not | `{"not":Bool}` | 1 |
| gt/gte/lt/lte | `{"gte":[Num,Num]}` | 2 |
| eq/neq | `{"eq":[Scalar,Scalar]}` | 2 |
| in | `{"in":[Scalar,{"constant":[Scalar,...]}]}` | 2 |
| factExists | `{"factExists":Selector}` | 1 |
| axisOutcomeIs | `{"axisOutcomeIs":["axisId","outcomeId"]}` | 2 |

Scalar 是 metric、state 或 `{constant: JSON scalar}`。表达式对象必须恰好一个 operator。禁止 `eval`、JavaScript、任意函数、随机数、时间、文件、网络与环境变量。相同输入必须得到相同输出。

## 4. Fact 与 Delayed Event 状态

唯一状态集合：

```text
PENDING / OCCURRED / RESOLVED / CANCELLED / EXPIRED
```

`OCCURRED` 表示已经发生、但不保证已解决；`PENDING` 只能作为未来义务或未解钩子，Narrator 不得写成已经发生；`CANCELLED` 不再制造威胁；`EXPIRED` 表示窗口失效；`TRIGGERED` 从文档、Schema、示例和测试完全删除。Selector 只能使用该集合。

## 5. Narrative 完整合同

`narrative` 全部字段必填，无隐式默认：

- `language`：BCP-47 风格标签；
- `pointOfView`：FIRST_PERSON / SECOND_PERSON / THIRD_PERSON_LIMITED / THIRD_PERSON_OMNISCIENT；
- `tone.tags`：1—8 个；
- `pacing`：tempo、sentenceRhythm、transitionStyle；
- `length`：`minChars <= targetChars <= maxChars`，范围 80—5000；
- `paragraphPlan`：paragraphId、purpose、appliesTo、requiredSlots、requiredAxes、allowAtmosphereOnly；
- `worldImagery`：required/preferred/forbidden tags 与每段最大引用数；
- `forbiddenPhrases`：纯 literal，禁止任意正则与代码；
- `scopeConstraints.PART`：`allowLifetimeClosure=false`、`requireUnresolvedHook=true`；
- `scopeConstraints.STORY`：`allowLifetimeClosure=true`；
- `fallback`：固定 `TEMPLATE_ONLY`、白名单 placeholder、PART/STORY 分开的确定性段落模板。

PART package 必须有适用于 PART 的 UNRESOLVED_HOOK 段落；不得把阶段结果写成角色一生结论。Narrator 以后只填充 Blueprint 允许事实，不裁定 completion、metrics、outcomes、visibility 或 hash。

## 6. packageHash 与不可变快照

定义：

```text
packageHash = lowercaseHex(SHA-256(UTF-8(RFC 8785 JCS(validated full package document))))
```

流程：解析原始 JSON → Schema 与引用校验 → 确认无 packageHash → JCS canonicalize → UTF-8 → SHA-256。覆盖完整原始 package 文档，不先填占位 hash，不删除字段后重算，不依赖对象插入顺序。JCS 拒绝 NaN/Infinity、undefined、函数、循环、稀疏数组与非法 Unicode；`-0` 规范化为 `0`。

S1 以后 Run 必须同时冻结 `policyId/policyVersion/packageHash`，并保存 canonical package snapshot 或能按 hash 取回完全相同 UTF-8 bytes 的内容寻址引用。已开始和已完成 Run 永不读取 mutable current package 重算。

S0 示例哈希写入：`docs/auto-execute/evidence/generic-endgame-v3-s0/package-hashes.json`。

## 7. 引用完整性

启动前拒绝：重复/未知 metric、state、derived metric、axis/outcome、slot、scoring profile；派生循环；每轴非唯一 fallback；场景非唯一 fallback；presentation/narrative/validation 引用未知 ID；USE_TEMPLATE 缺模板；未知 tag/status/operator；表达式 arity/type/深度/节点错误；非法 narrative scope。世界词可以出现在世界 JSON，不得进入通用 operator、status、source type、category enum。

## 8. 中性合成世界最小合同

`neutral-synthetic.endgame.fixture.json` 冻结：4 个任意指标、2 条轴、自己的 slot/style/scene、PART narrative 与 replay；不得出现 Sangtian、Zhejiang、governor、imperial、reform、grain、Caesar、senate 等世界词。它只证明 package 合同世界无关，运行时证明留到 S8。

## 9. 测试与退出门

正式 S0 命令：

```bash
node --test packages/shared/tests/generic-endgame-package-v1.s0.spec.mjs
pnpm --filter @ai-story/shared typecheck
pnpm --filter @ai-story/shared build
git diff --check 3771822db5dada5fc898c7c5b78cc0821a1e825b..<S0_SHA>
```

必须 tests >= 92、pass=tests、fail=skip=todo=0、退出码 0。覆盖三合法包、封闭 allowlist、所有 operator、status、Narrative、引用、循环、除零、非有限数、clamp、JCS/hash/snapshot 与负例。`generic-endgame-s0.yml` 必须从精确远程 SHA 新目录 clone，证明 clone HEAD、parent、tracking ref、ls-remote 与 clean status，再运行上述门并上传 artifact。

## 10. S0 不做

不实现 package loader、Run snapshot 持久化、metric trajectory、生产 evaluator、多轴裁定、fact collector、detail compiler、Narrator、Validator、Result API、Web、Sangtian 迁移、第二世界生产接入、E2E 或玩家验收；不修改主游戏页面、Prisma、main、release、部署或线上数据。

## 11. 后续阶段边界

S1 loader/snapshot；S2 metrics/trajectory；S3 DSL runtime/outcomes；S4 facts/details；S5 Narrator/Validator；S6 API/Web；S7 Sangtian production migration；S8 second-world + neutral runtime proof；S9 candidate/player acceptance。任何阶段不得悄悄扩展本 S0 allowlist；新增 operator/status/narrative field 必须升级 Schema/版本与 hash。

## 12. S0 Definition of Done

```text
文档、Schema、两个示例、neutral fixture 同步
AND DSL allowlist/shape/arity/type/error semantics 唯一
AND delayed statuses 唯一且无 TRIGGERED
AND Narrative 合同完整并区分 PART/STORY
AND packageHash 使用 RFC 8785 JCS
AND 引用/循环/负例测试通过
AND 单一 S0 commit 推送批准分支
AND local/tracking/ls-remote 三 SHA 一致
AND 精确远程 SHA 全新 clone 测试通过
AND 所有正式证据路径存在于远程提交
```

通过 S0 只允许报告 `S0_READY_FOR_CODEX`，意为合同可交给 Codex 评审和后续 S1 开发；不表示 Generic Endgame runtime 已实现。
