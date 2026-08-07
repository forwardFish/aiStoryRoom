# OpenNovel 主动谋划：事件账本与存储权威补充 v2.1

> 适用分支：`feat/mvp-four-maneuver-actions`  
> 适用引擎：`openovel_v1`  
> 上位文档：`Our_Many_Worlds_MVP主动谋划四按钮_OpenNovel实施补充_v2.1.md`

## 1. 事件账本最终决策

正式 OpenNovel 主动谋划每次成功 Confirm 只创建一个权威根事件：

```text
StoryEvent.type = openovel_maneuver_result
StoryEvent.messageType = maneuver_result
```

该事件与以下变化位于同一个 Prisma 事务：

```text
StoryRun.stateJson.openovelManeuver 更新；
StoryRun.version +1；
每日谋划次数扣减；
usedTypesToday 更新；
筹码消费；
调查事实和 traces 写入；
需要模型时创建 AiTask。
```

根事件 payload 必须包含足够的类型化语义：

```text
maneuverType；
decisionForm；
sceneKey；
usageDay；
targetRoleKey；
consumedLeverageKey；
discoveredFactKeys；
traces；
statePatch；
idempotencyKey；
requestFingerprint；
versionBefore / versionAfter；
provider / providerRequestId / providerModelName；
tokenUsage / fallback。
```

## 2. 为什么不为一次动作创建多条权威 StoryEvent

v2.0 曾建议额外创建：

```text
maneuver_submitted；
state_patch；
contact_resolved；
investigation_resolved；
fact_discovered；
leverage_used；
custom_maneuver_resolved。
```

正式 OpenNovel 链不再把这些名称实现为七条独立权威数据库行。原因：

```text
避免同一个动作出现部分事件成功、部分事件失败；
避免幂等重放需要同时核对多条事件；
避免一次动作放大为大量数据库写入；
避免旧状态恢复时多事件顺序不一致；
保留一个可通过 dedupeKey 原子重放的权威根。
```

这些名称仍然是**语义视图**，由根事件确定性派生：

```text
CONVERSATION      → contact_resolved；
INVESTIGATION     → investigation_resolved + fact_discovered；
LEVERAGE          → leverage_used；
CUSTOM_PLAN       → custom_maneuver_resolved；
非空 statePatch   → state_patch。
```

页面时间线、统计、Canon bridge、证据投影和旧状态恢复只能读取权威根事件或其确定性派生，不能创建第二套事实来源。

### 2.1 Canon 消费回执不是第二个谋划结果

当下一次主线 Turn 已经成功把 Confirmed Maneuver Context 写入 Canon 后，产品层创建一个私有系统回执：

```text
StoryEvent.type = openovel_maneuver_context_consumed
StoryEvent.messageType = system
StoryEvent.visibility = private_system
```

回执只保存：

```text
sourceResultIds；
turnNumber。
```

它不代表新的玩家行动，不出现在玩家时间线，不修改剧情事实，也不重复扣次数。它的唯一职责是：

```text
证明哪些 openovel_maneuver_result 已经进入主线 Canon；
在 stateJson 镜像缺失或损坏时恢复 canonConsumedResultIds；
阻止同一谋划结果被后续主线再次注入。
```

因此正式账本关系是：

```text
每次谋划 Confirm：恰好一个 openovel_maneuver_result 根事件；
每次主线消费一批结果：最多一个私有 Canon 消费回执。
```

## 3. 存储权威最终决策

正式产品采用混合权威，而不是把同一功能复制到 Memory/File/Prisma 三套实现：

```text
OpenNovel 文件 workspace：
- 主线 Canon；
- 当前 Runtime revision；
- OpenNovel options；
- 最终 ending；
- Runtime 的恢复与幂等。

PostgreSQL / Prisma：
- 产品 StoryRun；
- 玩家和角色所有权；
- maneuverState 镜像；
- openovel_maneuver_result 账本；
- openovel_maneuver_context_consumed 私有回执；
- AiTask；
- Credits、Session 和产品查询投影。
```

两层通过：

```text
runId；
OpenNovel turnNumber；
StoryRun.version；
签名 Confirmed Maneuver Context；
幂等键和 requestFingerprint。
```

保持一致。

## 4. 文件存储测试的定位

旧 `MvpStoryEngine` 的 Memory/File 测试继续作为旧引擎回归，不再被用来证明正式 `openovel_v1` 产品持久化。

正式候选的持久化验收必须使用：

```text
真实 OpenNovel Runtime 文件 workspace；
真实 PostgreSQL 16；
真实 Prisma schema；
真实 /role-select → /game Run；
API 重启与刷新读回。
```

## 5. 旧状态恢复

如果 `StoryRun.stateJson.openovelManeuver` 缺失或部分损坏：

```text
GET /game 前读取全部 openovel_maneuver_result 根事件；
读取全部 openovel_maneuver_context_consumed 私有回执；
按 result.id 去重；
恢复 results、usedTypesToday、usedLeverageKeys、discoveredFactKeys、metrics 和剩余次数；
从消费回执恢复 canonConsumedResultIds 与最后消费 Turn；
metrics 始终从权威结果完整重算，不保留缺失或幽灵指标；
不增加 StoryRun.version；
不创建新的玩家行动；
不恢复已消耗筹码；
不赠送额外行动机会；
已进入 Canon 的结果不得再次注入。
```

## 6. 完成标准

```text
一次成功 Confirm 恰好一个权威根事件；
根事件与状态、筹码和 AiTask 原子提交；
所有语义事件可以确定性派生；
旧状态可从根事件和私有消费回执恢复；
主线 Canon 只消费已确认且尚未消费的根事件；
Preview、失败和拒绝不创建根事件；
人物回应只接收世界包明确允许的角色资料和事实；
真实模型响应的模型名与 Provider Request ID 可在事件和 AiTask 中追溯；
正式持久化在真实 Runtime workspace + PostgreSQL 上通过重启、并发和幂等验收。
```