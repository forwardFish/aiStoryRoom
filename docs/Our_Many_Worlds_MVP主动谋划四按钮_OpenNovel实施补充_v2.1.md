# Our Many Worlds：MVP 主动谋划四按钮 OpenNovel 实施补充 v2.1

> 状态：当前实现与验收合同  
> 适用分支：`feat/mvp-four-maneuver-actions`  
> 适用引擎：正式 Solo `openovel_v1`  
> 正式页面：`/role-select?story=sangtian&start=new` → `/game?runId=<runId>`  
> 基础产品文档：`Our_Many_Worlds_MVP主动谋划四按钮_页面与分阶段开发实施方案_v2.0.md`

## 1. 与 v2.0 的关系

v2.0 对以下产品范围仍然有效：

```text
四个平级入口：人物交谈、派遣调查、使用筹码、自拟谋划；
每日总共 2 次，每类每天最多 1 次；
调查是固定选项、即时、零 AI、可跳过；
筹码是整局有限的一次性暗牌，使用后永久消失；
自拟谋划保留 ActionGuard；
服务端是目标、次数、事实、筹码和状态补丁的唯一权威；
结果进入同一中央剧情流；
不增加接触渠道、调查路线、异步调查、伏置、应变、冷却或卡牌 DSL。
```

本补充只覆盖后来已经由产品所有者和独立验收锁定的 OpenNovel 工程合同。

## 2. “预演”术语的最终定义

v2.0 取消的是：

```text
调用 AI 预测人物会怎样回答；
提前展示调查会发现什么；
提前展示筹码会造成什么结果；
为预演额外增加一次模型调用。
```

当前正式实现保留的是**服务端理解确认卡**：

```text
玩家填写/选择行动；
服务端校验当前场景、目标、次数、筹码、ActionGuard 和 revision；
服务端返回“系统理解为你准备做什么”；
不调用模型；
不展示未知结果；
不写数据库；
不扣次数；
玩家确认后才进行一次正式结算。
```

正式 API：

```text
POST /api/v4/rooms/:runId/game/maneuvers/preview
POST /api/v4/rooms/:runId/game/maneuvers/confirm
```

旧直接提交端点必须 fail-closed 返回 `MANEUVER_PREVIEW_REQUIRED`。

因此，本文档中的 Preview 不是 AI 结果预演，而是一个零副作用、签名、防篡改的服务端确认步骤。

## 3. 正式 OpenNovel 投影合同

`GET /api/v4/rooms/:runId/game` 必须返回：

```text
maneuverVersion；
maneuverPanel；
maneuverState；
leverageHand；
currentTurn.visibleFacts；
evidenceHoldings；
observableTraces。
```

其中：

```text
maneuverPanel：当前场景可立即执行的四类行动；
leverageHand：整局仍未消耗的筹码；
visibleFacts：已确认调查所得且当前角色可见的事实；
evidenceHoldings：已确认调查形成的证据持有；
observableTraces：已确认谋划留下的玩家可见行动痕迹。
```

前端不能自行补人物、调查、筹码、事实、禁用原因或次数。

## 4. 世界包边界

通用 OpenNovel adapter 不得包含《桑田诏》专用：

```text
人物名称；
场景键；
固定回合数；
调查文案；
筹码目录；
中文指标名；
故事专用正则。
```

这些内容必须由 `OpenNovelManeuverPackage` 提供。

正式《桑田诏》包位于：

```text
apps/api/src/world-maneuver-packages/sangtian-maneuver.data.ts
apps/api/src/openovel-adapter/sangtian-openovel-maneuver.package.ts
```

中性第二世界 fixture 必须继续证明通用运行时不依赖中文故事内容。

## 5. 已确认谋划进入后续 Canon

四按钮不能只改变右栏次数和独立 timeline。

正式链路：

```text
Confirm 成功
→ StoryRun.stateJson.openovelManeuver
→ openovel_maneuver_result StoryEvent
→ 中央玩家可见结果流
→ 编译玩家安全的 Confirmed Maneuver Context
→ 通过 API 与 Runtime 共用的内部密钥签名
→ OpenNovel ActionGateway 验签
→ 玩家原始主线行动与服务器上下文分离
→ ContextCompiler 只在下一次主线生成中注入已确认结果
→ 主线提交成功后把 sourceResultIds 标记为已消费
```

约束：

```text
Preview、失败、拒绝和篡改请求永远不能进入 Canon；
传闻不能升级为事实；
模型不能看到内部 statePatch；
同一结果默认只注入一次；
玩家原始主线行动不能被服务器包装污染；
签名上下文不能显示在玩家章节、行动历史或页面中；
主线失败时结果仍保持待消费，允许下一次安全重试。
```

## 6. 旧状态恢复

`StoryEvent` 是追加式权威账本。

当旧 `stateJson.openovelManeuver` 缺失或不完整时，正式 `/game` 读取前必须从：

```text
StoryEvent.type = openovel_maneuver_result
```

恢复：

```text
results；
usedTypesToday；
usedLeverageKeys；
discoveredFactKeys；
metrics；
剩余谋划次数。
```

恢复是镜像修复：

```text
不增加 StoryRun.version；
不创建新玩家行动；
不重复创建 StoryEvent；
不恢复已经消耗的筹码；
不额外赠送当日次数。
```

## 7. ActionGuard 当前上下文

自拟谋划必须至少使用：

```text
当前角色 identity / ability / cannotDo；
当前世界角色目录；
已确认调查事实；
当前仍持有的筹码；
当前世界包 scene 与 usageDay；
当前主线 Turn。
```

不得再以：

```text
visibleFacts = []；
allFacts = []；
assets = []；
stage = {}；
```

作为正式产品上下文。

## 8. 当前真实验收门

### 工程门

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm --filter @ai-story/shared build
pnpm --filter @apps/api typecheck
pnpm --filter @apps/api test:openovel
pnpm --filter @apps/web test
pnpm --filter @apps/openovel-runtime typecheck
pnpm --filter @apps/openovel-runtime test
pnpm --filter @apps/openovel-runtime build
pnpm --filter @apps/api build
pnpm --filter @apps/web typecheck
pnpm --filter @apps/web build
pnpm test:config
```

每条命令必须报告当前精确 SHA、退出码、total/pass/fail/skip/todo 和日志路径。

### 真实浏览器

必须从真实：

```text
/role-select?story=sangtian&start=new
```

创建全新 Run，并在 `/game` 完成：

```text
人物交谈；
派遣调查；
使用筹码；
刷新后筹码仍消失；
自拟谋划；
ActionGuard 拒绝不扣次数；
日终与次日额度；
主线继续；
已确认谋划在后续主线中被标记为 Canon 已消费。
```

### 真实 PostgreSQL

必须验证：

```text
Preview 零写入；
Confirm 原子提交；
相同 token 重试不重复；
两个动作争抢最后 revision 只有一个成功；
同一筹码争抢只有一个成功；
API 重启后状态一致；
旧 stateJson 可以从 StoryEvent 恢复；
无新表和 migration。
```

### 真实模型

必须通过真实产品链，而不仅是直接调用 Provider：

```text
3 次人物交谈；
2 次 AI_REACTION 筹码；
1 次受控 timeout fallback。
```

每例记录：

```text
runId；sceneKey；maneuverType；targetRoleKey；
模型；Provider Request ID；逻辑调用数；HTTP attempts；
输入/输出 token；耗时；估算成本；
玩家可见结果；AiTask 状态；fallbackReason；
提交前后 version 和谋划次数。
```

## 9. 仍不属于工程 Definition of Done 的人工验证

5—10 名真实玩家的理解度、趣味性和复玩意愿属于上线前产品验证，不能由自动化测试伪造。

工程候选可以先完成，但正式产品验证仍需记录：

```text
玩家是否理解四按钮；
调查是否改变主线判断；
筹码是否制造保留/出牌纠结；
人物回应是否产生继续追问欲望；
ActionGuard 拒绝后是否能成功改写。
```

## 10. 当前 Definition of Done

只有同时满足以下条件才允许标记候选就绪：

```text
四按钮真实接入 openovel_v1；
服务端权威投影；
Preview 零副作用且零模型调用；
Confirm 单次原子落账；
人物交谈/筹码最多一次逻辑模型调用；
调查零模型调用；
一次性筹码持久消费；
ActionGuard 使用真实上下文；
已确认谋划进入下一次主线 Canon；
旧状态可由 StoryEvent 恢复；
真实浏览器、PostgreSQL、模型与完整工程门均有当前 SHA 的 PASS 证据；
main/release 未修改、未推送、未合并。
```
