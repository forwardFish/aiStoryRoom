# Our Many Worlds：MVP 主动谋划四按钮页面与分阶段开发实施方案 v2.0

> 文档状态：开发执行基线  
> 产品范围：当前 Web 单人 MVP，《桑田诏：嘉靖财政危局》  
> 正式页面：现有 `/game?runId=<runId>` 三栏主游戏页  
> 仓库：`forwardFish/aiStoryRoom`  
> 开发分支：`feat/mvp-four-maneuver-actions`  
> 基线：`main@e60dfd8fc9dda0459edbd37fe6be52ecd8dff1d6`  
> 原始完整方案 SHA-256：`1d9092fcdd053592fbeaeea4043864bdbcbac998595b02da2fe4fabb02de7342`

---

# 1. 产品结论

MVP 正式保留四个平级、独立、简单的主动谋划入口：

```text
人物交谈
派遣调查
使用筹码
自拟谋划
```

玩家心智固定为：

```text
人物交谈：问人，获得一次未知回应。
派遣调查：查事，获得当前剧情预设的固定信息。
使用筹码：出牌，打出一张一次性秘密筹码，使用后永久消失。
自拟谋划：自己想办法，提出当前身份、资源和阶段允许的一项行动。
```

本分支不实现：

```text
AI 行动预演；
第二次确认；
人物接触渠道分类；
调查痕迹—路线—执行者—异步返回；
筹码附加、伏置、应变、冷却、触发脚本；
复杂证据等级、卡牌合成、成功率；
新主游戏路由或前端框架重写；
真人多人主动谋划；
新数据库表。
```

---

# 2. MVP 全局规则

第 1—6 天：每天 2 次主动谋划。  
第 7 天：主动谋划关闭。

```text
成功提交：消耗 1 次；
ActionGuard 拒绝：不消耗；
版本冲突、网络失败、存储 CAS 失败：不消耗；
未使用机会：日终失效，不结转；
进入下一天：恢复为 2 / 2；
每种类型每天最多成功使用 1 次；
总计仍然只能成功使用 2 次。
```

四类动作统一直接提交：

```text
选择或输入
→ 点击明确提交按钮
→ 服务端正式校验
→ 规则引擎结算
→ 必要时调用一次 AI
→ 原子保存
→ 中央剧情区展示未知结果
```

不做：

```text
草稿
→ AI 预演
→ 玩家确认
→ 第二次 AI 调用
```

AI 调用上限：

| 行动 | 正常逻辑 AI 调用 |
|---|---:|
| 人物交谈 | 1 次 |
| 派遣调查 | 0 次 |
| 使用筹码 | 固定效果 0 次；人物特殊回应 1 次 |
| 自拟谋划 | 保留现有 ActionGuard 与确定性 fallback |

---

# 3. `/game` 页面 UI

继续使用现有三栏页面：

```text
左栏：身份、目标、资源、仍未使用的筹码、风险
中央：连续剧情、主线决策、谋划结果、日终和结局
右栏：主动谋划 2 / 2、四张行动卡、当前简化工作区
```

不增加 `/maneuver`，不创建平行主游戏页，不使用测试专用页面。

右栏最终结构：

```text
主动谋划                                  2 / 2
未使用机会将在今日结束时失效

┌────────────────────────────────────┐
│ 人物交谈                       3 人 │
│ 与当前相关人物交谈                  │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ 派遣调查                       1 项 │
│ 调查当前剧情提供的异常              │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ 使用筹码                       2 张 │
│ 打出一张秘密筹码，用后消失          │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ 自拟谋划                            │
│ 自己决定要推进的一件事              │
└────────────────────────────────────┘
```

页面规则：

```text
默认不展开任何工作区；
点击行动卡只展开对应工作区，不提交、不扣次数、不调用 AI；
四张行动卡始终可见；
选择人物、调查项或筹码时不自动提交；
成功后工作区收起，结果进入中央剧情流；
ActionGuard、版本冲突或网络失败时保留草稿；
禁用原因直接显示在行动卡副标题中。
```

全局可用条件：

```text
run.currentDay 在 1—6；
run.status === "awaiting_decision"；
存在 activeDecision；
maneuverOpportunitiesRemaining > 0；
页面不在 busy / resolving；
客户端持有最新 version。
```

---

# 4. 人物交谈

## 4.1 使用规则

出现在当前人物列表中的角色即可交谈；未出现的角色当前不能交谈。MVP 不展示在场、召见、传信、中间人、预计回应和暴露风险。

人物卡只显示：

```text
头像；
姓名；
公开身份；
为什么当前值得联系。
```

人物交谈保证：

```text
玩家的话被送达；
目标作出一次具体回应；
规则预设的小幅状态变化被落账；
回应可被后续剧情引用。
```

人物交谈不保证：

```text
目标说真话；
目标接受条件；
目标执行玩家要求；
玩家说法自动成为世界事实。
```

## 4.2 点击流程

```text
点击【人物交谈】
→ 展开当前人物列表
→ 选择一人
→ 输入最多 200 字
→ 点击【发送给某人】
→ 前端必填校验
→ POST /api/v4/story-runs/:runId/maneuvers
→ 服务端校验场景、人物、次数、类型、version、幂等键
→ 规则引擎先确定权威状态补丁和事实边界
→ 一次 AI 调用生成回应；失败使用固定 fallback
→ 原子保存结果、事件、次数和 version
→ 中央剧情区展示回应
→ 人物交谈显示“今日已使用”
```

请求：

```ts
interface ContactManeuverCommand {
  maneuverType: "contact";
  targetRoleKey: string;
  messageText: string;
  version: number;
  idempotencyKey: string;
}
```

人物交谈不得继续复用 `customText`。

AI 只允许返回：

```ts
interface ContactNarrativeCandidate {
  title: string;
  narrative: string;
  replyText: string;
}
```

AI 不得返回或修改状态补丁、关系数值、证据真实性、筹码状态、主线选项和结局。

---

# 5. 派遣调查

## 5.1 使用规则

调查只在剧情配置的环节出现。每个 sceneKey 提供 0—2 项固定调查。玩家不能自由输入“谁是幕后主使”“哪个选项最好”等问题。

调查卡只显示：

```text
调查标题；
一句当前原因；
开始调查按钮。
```

不显示调查路线、执行者、返回时间、风险、成功率、可能查明和不能证明。

## 5.2 点击流程

```text
点击【派遣调查】
→ 展示当前场景固定调查项
→ 只有一项时自动选中，但仍需点击提交
→ 点击【开始调查】
→ 服务端校验 intentKey 是否属于当前场景
→ 立即应用预设 resultText / factKeys / statePatch / traces
→ 写入调查结果和事实事件
→ 扣 1 次谋划
→ 中央剧情区立即展示结果
→ 派遣调查显示“今日已使用”
```

请求：

```ts
interface InvestigationManeuverCommand {
  maneuverType: "investigate";
  intentKey: string;
  version: number;
  idempotencyKey: string;
}
```

调查首版：

```text
事实预设；
结果文案预设；
状态补丁预设；
AI 调用 0 次；
不创建长期任务；
不自动触发通用关键事件；
不调查也不阻塞主线和日终。
```

每项调查必须拥有唯一 `intentKey`、稳定 `factKey` 和独立结果，不能继续统一返回“调查驿站与粮路”。

---

# 6. 使用筹码

## 6.1 筹码定义

筹码是玩家整局有限、私下持有、由玩家选择时机打出、成功使用后永久消失的一次性暗牌。

状态只保留：

```text
AVAILABLE
USED
```

不刷新、不恢复、不合成、不交易、不冷却、不伏置、不自动触发。

首发三张：

```text
land_contract_fragment：田契暗账（半页）
county_letter：清流县令密信
xunfu_merchant_old_pact_rumor：巡抚与商会旧约传闻
```

左栏显示整局所有尚未使用的筹码；右栏只显示当前 sceneKey 允许立即打出的筹码。

## 6.2 点击流程

```text
点击【使用筹码】
→ 展示当前场景允许且尚未使用的筹码
→ 选择一张
→ 必要时选择合法目标
→ 点击【使用并消耗“筹码名称”】
→ 服务端校验持有权、场景、目标、类型、次数、version 和幂等键
→ 规则引擎确定固定补丁和事实边界
→ FIXED 筹码零 AI；AI_REACTION 筹码一次 AI
→ 在同一个待保存快照内消费筹码、扣次数、写结果、version +1
→ 原子保存
→ 中央剧情区展示结果与“筹码已消耗”
→ 左栏和右栏立即移除该筹码
```

请求：

```ts
interface LeverageManeuverCommand {
  maneuverType: "leverage";
  leverageKey: string;
  targetRoleKey?: string;
  version: number;
  idempotencyKey: string;
}
```

筹码页面不再显示自由文本框。

原子性要求：

```text
不能先消费筹码再生成结果；
不能结果失败但筹码已经消失；
不能重复请求消费两次；
不能两个标签页同时成功使用同一张筹码；
版本冲突不能产生部分写入。
```

---

# 7. 自拟谋划

自拟谋划完整保留，输入上限 200 字。

点击流程：

```text
点击【自拟谋划】
→ 输入一项具体行动
→ 点击【执行谋划】
→ 前端校验非空和长度
→ 服务端执行 ActionGuard
→ 拒绝：显示原因和改写建议，保留原文，不扣次数
→ 接受：规则引擎生成有限结果，扣 1 次谋划
→ 结果进入中央剧情流
→ 自拟谋划显示“今日已使用”
```

继续拒绝：

```text
超越身份或资源；
直接命令独立角色认罪或服从；
直接跳到未来阶段；
直接宣布调查结论；
一次输入包含多个互不相关的主要行动；
超过 200 字。
```

本分支不重建通用自然语言行动编译器。

---

# 8. 服务端投影

前端不得自行定义人物、调查、筹码、目标或禁用原因。

```ts
export type MvpManeuverType =
  | "contact"
  | "investigate"
  | "leverage"
  | "custom";

export interface MvpManeuverPanelProjection {
  sceneKey: string | null;
  enabled: boolean;
  disabledReason: string | null;
  quota: {
    perDay: 2;
    usedToday: number;
    remaining: number;
    usedTypesToday: MvpManeuverType[];
  };
  contact: {
    enabled: boolean;
    usedToday: boolean;
    count: number;
    disabledReason: string | null;
    options: MvpContactOptionProjection[];
  };
  investigate: {
    enabled: boolean;
    usedToday: boolean;
    count: number;
    disabledReason: string | null;
    options: MvpInvestigationOptionProjection[];
  };
  leverage: {
    enabled: boolean;
    usedToday: boolean;
    count: number;
    disabledReason: string | null;
    options: MvpLeverageOptionProjection[];
  };
  custom: {
    enabled: boolean;
    usedToday: boolean;
    disabledReason: string | null;
    maxLength: 200;
  };
}
```

左栏手牌独立投影：

```ts
export interface MvpLeverageHandProjection {
  availableCount: number;
  items: Array<{
    leverageKey: string;
    label: string;
    description: string;
  }>;
}
```

---

# 9. 剧情配置

新增：

```text
apps/api/src/mvp-maneuver-config.ts
```

以当前 `activeDecision.decisionKey` 直接作为 `sceneKey`：

```text
d1_1 ... d6_2
```

配置唯一负责：

```text
当前可交谈人物；
当前固定调查项；
当前允许打出的筹码；
固定规则补丁；
稳定 factKeys；
固定 fallback 文案。
```

禁止继续在 `apps/web/public/app.js` 硬编码人物、调查和筹码。

调查首版矩阵：

| sceneKey | 调查 |
|---|---|
| d1_1 | 核对首批名册形成时间 |
| d1_2 | 查商会垫粮来源 |
| d2_1 | 核对密信所列地号 |
| d2_2 | 比对三县催报文书 |
| d3_1 | 查验驿站登记 |
| d3_2 | 清点商会可放粮库存 |
| d4_1 | 核对田亩底册装订 |
| d4_2 | 寻找被撤换书吏 |
| d5_1 | 复核浙江见银进度 |
| d5_2 | 查织造使入府前接触记录 |
| d6_1 | 复核最终奏报证据目录 |
| d6_2 | 比对三方最后来函 |

每项调查必须具有唯一 intentKey、resultText、factKeys、statePatch 和 traces。

---

# 10. 运行态与旧存档

```ts
export interface MvpManeuverState {
  maneuverOpportunitiesPerDay: 2;
  maneuversUsedToday: number;
  maneuverOpportunitiesRemaining: number;
  totalManeuversUsed: number;
  usedTypesToday: MvpManeuverType[];
  usedLeverageKeys: string[];
  discoveredFactKeys: string[];
}
```

玩家筹码使用稳定 ID：

```ts
player.leverageKeys = [
  "land_contract_fragment",
  "county_letter",
  "xunfu_merchant_old_pact_rumor"
];
```

日终：剩余次数清零。  
下一天：次数恢复 2 / 2，`usedTypesToday = []`。  
整局保留：`usedLeverageKeys`、`discoveredFactKeys`、`totalManeuversUsed`。

`ensureMvpCausalView()` 必须从旧事件恢复缺失字段，不能给升级前当日已使用过谋划的存档额外机会。

本次不需要 Prisma migration；继续使用 `StoryRun.stateJson + StoryEvent.payloadJson`。

---

# 11. 幂等、并发与原子保存

请求指纹：

```text
sha256(canonicalJson({
  maneuverType,
  targetRoleKey,
  messageText,
  intentKey,
  leverageKey,
  customText
}))
```

规则：

```text
同一 idempotencyKey + 同一指纹：返回原结果；
同一 idempotencyKey + 不同指纹：IDEMPOTENCY_KEY_REUSED；
两个请求使用同一 version：只有一个 CAS 保存成功；
所有失败都不能扣次数、消费筹码或应用 statePatch；
AI 失败使用 fallback，业务动作仍可成功。
```

必须保留：

```text
version 乐观锁；
idempotencyKey；
文件存储临时文件 + rename；
Prisma updateMany CAS；
服务端权威次数与筹码状态。
```

---

# 12. 前端实现范围

重点文件：

```text
apps/web/public/app.js
apps/web/public/api-story-storage.js
apps/web/public/main-game.css
apps/web/public/game-premium.css
apps/web/tests/maneuver-ui.test.mjs
```

前端状态拆为四类独立草稿：

```js
activeManeuverType: null,
maneuverDraft: {
  contact: { targetRoleKey: "", messageText: "" },
  investigate: { intentKey: "" },
  leverage: { leverageKey: "", targetRoleKey: "" },
  custom: { customText: "" }
}
```

`ApiStoryStorage.submitManeuver()` 必须按动作类型显式构造 payload，不再无边界展开 `{ ...input }`。

成功：更新完整服务端投影、收起工作区、播放中央谋划结果。  
错误：保留草稿；版本冲突刷新但不自动重放。

---

# 13. 后端实现范围

重点文件：

```text
apps/api/src/mvp-types.ts
apps/api/src/mvp-causal-runtime.ts
apps/api/src/mvp-maneuver-config.ts
apps/api/src/mvp-narrative-provider.ts
scripts/e2e/mvp-acceptance-matrix.ts
```

核心函数：

```text
projectManeuverPanel(view)
projectLeverageHand(view)
assertManeuverWindowOpen(view)
assertManeuverTypeAvailable(view, type)
buildContactResolutionPlan(...)
buildInvestigationResolutionPlan(...)
buildLeverageResolutionPlan(...)
buildCustomResolutionPlan(...)
resolveManeuverNarrative(...)
```

删除调查成功后统一调用 `enqueueCriticalEvent()` 的逻辑。

AI Provider 增加可选 `generateManeuverCandidate()`；调查不得创建 AiTask。

---

# 14. P0—P5 分阶段提交计划

## P0：文档与基线锁定

```text
新增本文件；
确认基线与唯一分支；
不修改源码。
```

提交：

```text
docs(maneuver): lock simplified four-action MVP
```

## P1：服务端配置与权威投影

```text
新增 12 个 sceneKey 配置；
新增投影类型；
新增 usedTypesToday / discoveredFactKeys；
旧存档恢复；
projectManeuverPanel；
日终禁用与下一天重置；
暂不改前端 UI。
```

提交：

```text
feat(maneuver): add scene-driven action projection
```

## P2：固定调查与一次性筹码后端闭环

```text
四类命令分别校验；
调查预设结果和 factKeys；
删除调查通用关键事件；
筹码场景、持有权和目标校验；
一次性原子消费；
每类每天一次；
自拟 ActionGuard 保持。
```

提交：

```text
feat(maneuver): resolve fixed investigations and one-use leverage
```

## P3：四按钮前端 UI 与请求合同

```text
四张纵向行动卡；
默认收起；
服务端投影驱动；
contact 使用 messageText；
调查与筹码无自由文本框；
自拟谋划保留；
硬编码人物、调查、筹码从 app.js 删除。
```

提交：

```text
feat(web): implement simplified four-maneuver flows
```

## P4：人物回应与筹码特殊回应 AI

```text
Provider 增加 generateManeuverCandidate；
人物交谈一次逻辑调用；
AI_REACTION 筹码一次逻辑调用；
调查零 AI；
严格输出校验；
AiTask 与 budget；
fallback。
```

提交：

```text
feat(maneuver-ai): add one-call character responses
```

## P5：真实页面、并发与完整回归

```text
真实 /game 四类完整提交；
每日 2 次和每类一次；
日终清零、下一天重置；
筹码刷新持久化；
双击、并发、version conflict、幂等指纹；
旧存档；
AI fallback；
七天闭环；
主线、关键事件、日终和结局回归。
```

提交：

```text
test(maneuver): complete four-action MVP acceptance
```

---

# 15. 必须执行的测试

阶段性执行目标测试；最终至少执行：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm --filter @apps/api test
pnpm --filter @apps/web test
pnpm test:maneuver
pnpm test:concurrency
pnpm test:ai-failure
pnpm test:config
```

条件允许时执行：

```bash
pnpm test:acceptance
```

不得：

```text
跳过失败测试；
删除现有断言；
用玩具 HTML 代替真实页面；
用内存假路由冒充真实 API 验收；
关闭 version、幂等或存储保护。
```

---

# 16. Definition of Done

```text
真实 /game 保留四按钮；
四按钮由服务端投影驱动；
人物、调查、筹码不再硬编码在 app.js；
人物交谈 messageText 不丢失；
人物交谈最多一次正式逻辑 AI 调用；
调查固定、即时、零 AI、可跳过；
筹码使用后永久消失；
自拟谋划完整保留；
四类动作都不做 AI 预演；
每天总共 2 次，每类每天最多 1 次；
日终剩余次数失效；
失败不扣次数；
版本冲突不产生部分写入；
双击与幂等重放不重复结算；
结果进入中央持续剧情流；
现有主线、关键事件、日终和结局不回归；
文件存储、Prisma 存储和旧存档可工作；
P0—P5 各有独立提交并已推送同一远程分支。
```

---

# 17. 分支与发布限制

本任务唯一开发分支：

```text
feat/mvp-four-maneuver-actions
```

禁止：

```text
修改或推送 main；
修改或推送 release；
force push；
创建指向 main 的 PR；
擅自扩大范围；
覆盖其他任务改动。
```

每完成一个阶段：

```text
运行该阶段测试；
修复失败；
创建一次语义清楚的提交；
推送同一远程分支；
向项目所有者报告阶段 SHA、改动、测试和风险；
得到继续指令后再进入下一阶段。
```
