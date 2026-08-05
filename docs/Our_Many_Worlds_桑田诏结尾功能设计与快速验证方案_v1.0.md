# Our Many Worlds《桑田诏》结尾功能设计与快速验证方案 v1.0

## 1. 本任务的唯一目标

本任务只负责《桑田诏》第一部分的结尾功能：

1. 从已经结算完成的权威世界状态生成玩家可见结局；
2. 说明玩家角色的命运和关键世界后果；
3. 提供测试专用快进能力，让开发阶段不必人工玩完全部中间回合就能检查结尾；
4. 保证测试快进不进入正式产品流程，也不修改主游戏页面。

本任务不负责中间 AI 剧情、选项文风、Narrator、Reviewer 或 Prompt。当前默认中间 AI 剧情已经通过；即使测试过程中发现中间正文的小问题，也只记录或跳过，不在本任务修复。

## 2. MVP 结尾验收标准

结尾功能只按以下结果验收：

1. 必须来自第一部分真实的 T20 权威状态；
2. `partCompletionStatus` 必须为 `HANDOFF_READY`；
3. 玩家此前的关键选择必须反映在最终状态和结局中；
4. 必须交代玩家角色的处境与命运；
5. 必须交代证据、粮食与民田、商会、奏报与责任四类关键后果；
6. 结尾出现后运行状态为 `COMPLETED`，不再返回下一项决策；
7. 玩家可见结尾不得泄漏 Predicate、entityId、Reviewer 或内部状态路径；
8. 非关键叙事细节不作为 MVP 阻塞项。
9. 进程重启后必须读取同一份结尾；重复提交 T20 的同一幂等键不得产生第二个 Head、第二份状态或第二次模型调用。

## 3. 权威数据流

```text
玩家关键选择
  → Settlement 结算
  → PartOneState 持久化
  → T20 + HANDOFF_READY
  → SangtianEndingModule
  → EndingPresentation
  → 与 T20 Canon/State 一起提交
  → Public Run 返回结尾并清空 Options
```

结尾模块不根据中文关键词猜结局，也不要求 Narrator 自己总结玩家做过什么。它只读取已经结算的结构化状态：

- `evidence`：县册证据链是否可追索；
- `grain`：最急迫的粮食压力是否得到缓解；
- `land`：灾期民田保护是否仍有效；
- `merchant`：商会取得了什么入口和权利；
- `report`：首报是否离开浙江、附件强度和叙述权如何；
- `responsibility`：总督是否实际承担政治责任。

## 4. 结尾输出合同

玩家可见的 `EndingPresentation` 包含：

- `scope`：当前为 `PART`，只结束第一部分，不宣告整部故事终结；
- `endingKey`：稳定、可统计的结局类型；
- `title`：玩家可读的结局标题；
- `finalSceneNarrative`：T20 已提交的最后场景；
- `protagonistFate`：浙江总督当前保住了什么、失去了什么、将面对什么；
- `aftermath`：证据、民田、粮路与商会、首报与政治责任的直接后果；
- `sourceTurnId`：必须为 `T20`；
- `sourceRevision`：必须为 `20`。

当前已定义的主要结局类型：

| endingKey | 标题 | 核心含义 |
|---|---|---|
| `guarded_people_bore_responsibility` | 守土担责 | 保住百姓和证据，但总督亲自承担问责 |
| `guarded_people_preserved_evidence` | 持证守土 | 保住百姓和证据，同时保留部分政治回旋空间 |
| `evidence_entered_capital` | 孤证入京 | 证据进入京师，但民生保护或地方局势不足 |
| `executed_policy_lost_people` | 奉旨失民 | 保住执行国策的名分，却未挡住失田与粮食危机 |
| `crisis_unresolved` | 危局未决 | 第一部分关键压力仍未形成明确收束 |

## 5. 测试专用快进

入口：

```powershell
pnpm exec tsx scripts/acceptance/sangtian-part-one-ending-preview.mts --real-turns=none
```

脚本完成后会在本次 Run 工作区生成 `ending-player-report.md`。该文件只包含玩家需要阅读的结局标题、最终场景、总督处境、四项直接后果和下一部分交接，不包含内部状态或调试字段。也可以使用 `--report-path=绝对路径` 指定输出位置。

该模式具有以下硬边界：

- `testOnly = true`；
- 使用独立临时工作区；
- 不经过主游戏页面和正式 API；
- 不改变正常产品逐回合玩法；
- 不调用任何大模型；
- 中间回合只进行确定性选择和权威结算；
- 最后读取正式 Ending Module 产生的 T20 结局。

结构快进提供两条已有 Story Package 路线，用于证明结局会随关键选择改变：

```powershell
# 优先保护民田、证据和最急迫灾民
pnpm exec tsx scripts/acceptance/sangtian-part-one-ending-preview.mts --real-turns=none --route=protective

# 优先保持粮路、分散指标并让督抚分担责任
pnpm exec tsx scripts/acceptance/sangtian-part-one-ending-preview.mts --real-turns=none --route=grain-first
```

两条路线只选择现有合法 Option，并使用同一 Settlement 与 Ending Module；测试脚本不得直接改写最终状态或指定 `endingKey`。

如果以后需要同时抽查一两轮真实模型正文和最终场景，可运行默认模式：

```powershell
pnpm exec tsx --env-file=.env.test scripts/acceptance/sangtian-part-one-ending-preview.mts
```

默认仅让 T01、T02、T20 调用真实模型，其余回合结构快进。该模式用于人工体验抽查，不是本结尾模块的工程依赖。

## 6. 当前结构快进结果

2026-08-05 的无模型结构快进已经得到：

- 最终回合：T20；
- 第一部分状态：`HANDOFF_READY`；
- Run 状态：`COMPLETED`；
- 最终选项：空；
- 结局标题：`守土担责`；
- 证据链：可追索；
- 灾期民田保护：有效；
- 商会入口：仅限附条件的粮食与运力；
- 首报：分路离开浙江；
- 总督责任暴露：8；
- 模型调用：0。

玩家可见结果：

> 首份奏报已经离开浙江。他没有把全部责任推给县令或属吏，问责也因此落到了自己名下。他暂时保住了可追索的证据、民田边界和最急迫的救粮秩序。官位此刻尚未裁定，但他已经失去了继续含混退让的余地。

直接后果：

1. 清流县册仍有可追索的保管链；
2. 灾期民田边界仍在，商会不能把救粮直接变成购田凭据；
3. 救粮渠道已经打开，但商会只取得附条件的粮食与运力入口；
4. 首报已经分路离开浙江，督抚不同叙述随之进入京师政治。

第二条路线的独立结构快进结果：

| 路线 | 结局 | 民田状态 | 粮食状态 | 首报状态 | 模型调用 |
|---|---|---|---|---|---:|
| `protective` | 守土担责 | `ACTIVE` | `RELIEVED_FOR_HUNGRIEST` | `SPLIT` | 0 |
| `grain-first` | 孤证入京 | `DISTRESS_PURCHASE_BANNED` | `SHIFTED_TO_OUTLYING_VILLAGES` | `DISPATCHED` | 0 |

两条路线都达到 T20、`HANDOFF_READY` 和 7/7 结尾验收通过，但 `endingKey`、标题和关键世界状态不同，证明结尾由玩家选择后的 Settlement 状态决定，不是固定文案。

## 7. 失败与降级原则

以下情况必须拒绝生成结尾：

- 不是 T20；
- 状态回合与请求回合不一致；
- `partCompletionStatus` 不是 `HANDOFF_READY`；
- 没有权威 Settlement 状态。

中间 AI 正文失败、文风不足或非关键细节不一致，不属于本任务阻塞项。测试快进会绕开这些问题，直接验证结尾功能。

## 8. 与正常产品的关系

正式产品仍然只能逐回合推进，正常玩家不能调用快进入口。结尾快进脚本位于 `scripts/acceptance`，没有接入 Web、API 路由或主游戏页面。

本任务不修改主游戏页面。后续如要在正式页面展示 `EndingPresentation`，应作为独立 UI 任务，在获得产品页面修改授权后再实施。

## 9. 工程验证

当前专项验证：

```text
结尾单元测试：5/5 PASS
OpenNovel Runtime 类型检查：PASS
无模型 T01—T20 结构快进：PASS
最终结尾验收项：7/7 PASS
```

完整 v4 回归需要在提交前再次执行，并单独记录测试总数、通过数和退出码。

提交前完整回归结果：

```text
v4 合同测试：108/108 PASS
v4 Runtime 测试：222/222 PASS
合计：330/330 PASS
类型检查：PASS
构建：PASS
退出码：0
```

这些结果只证明工程合同和结尾链路通过，不用于评价中间 AI 剧情质量。

结尾持久化专项还必须验证：

- T20 Ending 与最终状态由同一个 Head 拥有；
- 新建 Runtime 实例后读回的 Ending 与提交时完全一致；
- 用相同提交 ID 重放 T20，直接返回原结果；
- Head 数量仍为 20，Narrator 新调用数仍为 0。

## 10. 结尾公开读取合同

完成后的结尾沿用现有 Run 读取接口，不新增页面或结尾专用 API：

```text
GET /internal/openovel/runs/:runId
```

该接口直接返回 Runtime 的公开 Run 视图。第一部分结束后必须满足：

- `status = COMPLETED`；
- `turnNumber = 20`；
- `ending.sourceTurnId = T20`；
- T20 最终行动响应中的 `ending` 与随后 GET 读回的 `ending` 完全一致；
- `ending` 与原子 Head 提交并在重启后保持不变；
- `options = []`，玩家不能在结尾后继续提交新决策；
- 不返回 `worldState`、`causalDelta`、`DurableTurnEnvelope`、内部 Predicate、`narrativeSeed`、Truth Reviewer 结果或置信度。

HTTP 路由直接调用 `runtime.getRun()`，后者读取同一个公开 Run 视图，因此公开读取专项测试以 Runtime 读回为合同依据，不另建一套容易漂移的响应结构。
