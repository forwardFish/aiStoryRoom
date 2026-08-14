# Many Worlds AI 多人连续权谋制：产品与工程改造方案 v1.0

> 适用仓库：`forwardFish/aiStoryRoom`  
> 基准分支：`main`  
> 基准提交：`f678bd596a527e159e0b42938261620b21a47342`  
> 首个落地世界：`《桑田诏：嘉靖财政危局》`  
> 文档目标：可直接交给 Codex 或开发团队拆分任务、修改数据库、实现 API、重构多人游戏页面并完成自动化验收。

---

## 0. 文档结论

当前多人模式的核心流程是：

```text
共享公共节点
→ 每名玩家各提交一次行动
→ 已提交玩家进入等待
→ 所有玩家提交完成
→ 房主手动触发 AI 结算
→ 所有人获得同一轮结果
```

该模式能完成“多人参与”，但无法形成真正的多人权谋体验，主要问题是：

1. 玩家提交后失去操作空间，只能等待其他人。
2. 每名玩家面对的是同一道公共问题，角色差异主要停留在身份文案。
3. 玩家行动、意图和结果过度公开，缺少试探、隐瞒、误判和反制。
4. 房主手动结算让节奏依赖某一个玩家。
5. AI 更像“多人答案汇总器”，不是局势裁决者。
6. 自定义行动虽然开放，但缺少统一的世界观边界校验。

本方案将多人模式改造为：

> **共享时局 + 私人处境 + 密封落子 + 即时反馈 + 连续谋划 + 异步回应 + 自动收束 + 分视角回响。**

内部名称：

# 半同步连续权谋制

它保留世界阶段和统一结算，但不再让玩家感知“轮流交作业”。玩家提交主决策后进入布局阶段，可以继续调查、交涉、使用筹码、布置条件行动或回应他人影响。系统在行动窗口结束后自动收束，不再依赖房主点击结算。

本方案同时明确取消以下设计：

```text
取消玩家选择“托管原则”
取消玩家设置固定“红线”
```

替代方案是：

> 所有行动只受世界观、时代、地点、角色身份、角色权限、现有资源、已知信息和因果条件约束。

玩家可以背叛、公开秘密、消耗唯一筹码、改变立场或进行高风险布局，只要这些行动在世界中真实可行，并愿意承担后果。

系统不得用抽象道德规则限制权谋选择；系统只阻止以下类型的非法行动：

```text
超出世界观
超出时代技术
超出角色物理或制度权限
使用角色不可能知道的信息
直接控制其他玩家角色
直接宣布行动结果
跳过关键因果过程
与当前世界事实严重冲突
```

例如在《嘉靖财政危局》中：

```text
允许：秘密上奏、伪造口径、背叛盟友、公开账簿、扣押证人、转移粮路。
允许但有高代价：越级弹劾、公开抗命、销毁证据、全面查封商会粮仓。
不允许：乘坐宇宙飞船去外太空、使用互联网曝光账簿、调用现代卫星监控杭州。
```

---

# 1. 产品目标与非目标

## 1.1 产品目标

多人模式必须让玩家持续感受到以下四件事。

### 1.1.1 操控感

玩家能够明确控制：

```text
我要改变什么
我要对谁行动
我要用什么方式
我要投入什么筹码
我要公开还是秘密执行
失败后是否有后手
我愿意承担多大风险
```

AI只能裁决行动能否成功、成功到什么程度、产生什么代价，不能擅自改写玩家意图。

### 1.1.2 权谋感

玩家需要围绕以下对象进行布局：

```text
解释权
证据控制权
资源控制权
关系与承诺
公开口径
暗线进度
行动痕迹
条件后手
```

### 1.1.3 多人感

玩家必须感知：

```text
其他角色正在采取行动
他人的行动可能改变我的处境
我看到的未必是全部事实
我的行动会在其他玩家的故事中留下痕迹
多人行动会发生冲突、合作、抢先、抵消和反制
```

### 1.1.4 连续体验

玩家提交主决策后，不进入空白等待页，而是继续进行有价值的操作。

---

## 1.2 非目标

P0 不追求：

```text
完全开放世界
无限制自由输入
无限角色与无限地点
复杂外交条约编辑器
实时语音或自由聊天室
完整军事沙盘
每个行动都调用一次大模型
完全由 AI 决定所有规则
```

P0 的目标是：

> 在固定世界、固定角色、固定阶段和有限资源中，让自由行动真实碰撞，并保持可解释、可测试、可控制成本。

---

# 2. 当前项目基线与可复用能力

当前仓库已经具备以下基础能力，不需要推倒重做：

```text
StoryRun               故事局与当前节点
StoryRole              角色身份、秘密、目标、能力、限制
PlayerAction           玩家行动
DirectorResolution     节点统一结算
CanonFact              权威事实与事实可见性
CharacterMind          角色确认事实、信念和知识边界
StoryThread            长期压力线和状态线
SceneSnapshot          公共/角色私有场景快照
NarrativeEntry         公共/角色私有叙事记录
Notification           私人通知
StoryTaskOutbox         异步结算任务
RoomsService.events    成员级增量事件
SSE eventStream        房间事件推送
ActionGuard            行动越权与知识边界检查
```

现有实现最大的问题不是缺少数据基础，而是这些能力仍然围绕“所有玩家提交一次公共行动后统一结算”组织。

本次改造要完成三件事：

1. 将单次 `PlayerAction` 扩展为主决策、谋划和回应三类行动。
2. 将 `StoryTaskOutbox` 从房主手动触发改为行动窗口自动触发。
3. 将 `CanonFact + CharacterMind + NarrativeEntry` 用于每个玩家不同的私人简报和结果投影。

---

# 3. 核心玩法定义

## 3.1 世界阶段

继续保留《桑田诏》的 7 个世界节点：

```text
第 1 日：改桑急令
第 2 日：县令密信
第 3 日：粮价失控
第 4 日：暗账浮出
第 5 日：相互弹劾
第 6 日：京师回批
第 7 日：御前裁决
```

但“一个节点”不再等于“每人填写一张行动表”。

一个世界阶段包含：

```text
A. 公共时局开启
B. 角色私人简报
C. 玩家密封主决策
D. 即时执行反馈
E. 连续布局阶段
F. 他人影响与回应
G. 自动收束
H. 分视角结果
I. 公共局势推进
```

---

## 3.2 核心循环

```text
读取公共时局
→ 查看自己的私人处境
→ 选择目标、对象、方法与筹码
→ 密封主决策
→ 立即看到命令是否进入世界
→ 继续进行一次谋划
→ 收到可观察痕迹或定向交涉
→ 必要时进行一次回应
→ 时间到或条件满足后自动收束
→ 查看个人剧情结果
→ 查看他人对我的影响
→ 查看我造成的可见影响
→ 查看公共世界变化
→ 进入下一阶段
```

---

## 3.3 每阶段行动额度

P0 建议固定：

```text
主决策 MAIN：1 次，必须提交或由系统执行最小维持行为
主动谋划 MANEUVER：1 次，可选
回应 REACTION：最多 1 次，仅在收到可回应事件时开放
信息阅读：不限次数，不消耗行动额度
```

注意：

- “主决策”决定角色本阶段的主要方向。
- “主动谋划”用于调查、交涉、筹码、后手或口径操作。
- “回应”只用于处理其他角色直接施加到自己身上的行动。
- 不允许无限自定义行动，否则 AI 成本和局势复杂度会失控。

---

# 4. 世界观边界系统

## 4.1 设计原则

系统不替玩家设置道德红线，也不要求玩家选择托管原则。

系统唯一需要维护的是：

> 玩家只能做这个世界中可能发生、角色有机会尝试、因果链能够解释的事情。

世界观边界不是“不能做坏事”，而是“不能做这个世界不可能发生的事”。

---

## 4.2 五层边界

### 4.2.1 世界边界 World Boundary

检查行动是否属于当前世界。

《桑田诏》的世界边界包括：

```text
时代：明代嘉靖年间
核心地区：浙江、杭州、辖县、京师通信链
主要制度：皇权、内阁、司礼监、总督、巡抚、县衙、商会、驿站
主要技术：奏疏、驿传、账簿、粮仓、田契、官印、船运、人工侦查
主要矛盾：改桑、粮价、财政、民田、海防、官商关系、责任归属
```

拒绝示例：

```text
驾驶宇宙飞船逃离杭州
通过互联网直播公开暗账
调用卫星查看粮仓
使用现代枪械威胁巡抚
让人工智能分析全部奏疏
```

---

### 4.2.2 角色能力边界 Role Capability Boundary

玩家可以尝试超出日常权限的高风险操作，但必须具备现实路径。

例如浙江总督：

```text
可以直接做：调动总督府幕僚、密奏、调粮、要求复核、召见官员。
可以高风险尝试：截查巡抚奏疏、公开压制巡抚、保护县令对抗地方压力。
不能直接完成：任免内阁大臣、命令皇帝改变国策、瞬间控制全部县衙。
```

系统不能因为“行动大胆”就拒绝，只在行动没有可行路径时要求改写。

---

### 4.2.3 信息边界 Knowledge Boundary

玩家只能使用：

```text
公共事实
角色确认知道的私密事实
角色合理推断出的信念
当前场景中可观察到的痕迹
其他角色明确告诉他的内容
```

玩家不能直接使用其他角色的隐藏秘密。

错误示例：

> 总督直接根据巡抚“与商会有未入册往来”的隐藏秘密公开定罪。

正确改写：

> 总督以驿站登记、田契异常和粮价变化为依据，暗查巡抚幕僚与商会的往来。

---

### 4.2.4 他人控制边界 Other-player Agency Boundary

玩家可以：

```text
命令自己的下属
请求、威胁、诱导、交易、欺骗其他角色
给其他角色制造压力
限制其他角色的资源和选择空间
```

玩家不能直接声明：

```text
巡抚一定答应我的条件
县令立即把原件交给我
商会全部服从我
其他玩家自动背叛盟友
```

正确表达是：

```text
我以保护官位为条件，要求县令交出原件。
我查封一个粮仓，迫使商会重新谈判。
我公开部分证据，向巡抚施加解释压力。
```

---

### 4.2.5 结果所有权边界 Outcome Ownership Boundary

玩家提交的是“尝试”和“意图”，不是最终结果。

拒绝或改写：

```text
我成功让巡抚身败名裂。
我保证京师采信我的奏疏。
我彻底解决粮价问题。
```

接受：

```text
我公开巡抚奏疏中遗漏的粮价数据，试图让京师怀疑其口径。
我追加密奏并附上可核验的田契副本，争取抢回解释权。
我动用官仓平价粮三日，先压住杭州米价。
```

---

## 4.3 边界裁决结果

`WorldBoundaryGuard` 必须返回结构化状态：

```ts
type WorldBoundaryDecision =
  | "ACCEPT"
  | "ACCEPT_WITH_COST"
  | "REWRITE_NEEDED"
  | "REJECT_OUT_OF_WORLD"
  | "REJECT_ROLE_IMPOSSIBLE"
  | "REJECT_UNKNOWN_INFORMATION"
  | "REJECT_CONTROL_OTHER_PLAYER"
  | "REJECT_DECLARE_RESULT";
```

含义：

| 状态 | 处理方式 |
|---|---|
| `ACCEPT` | 直接进入行动系统 |
| `ACCEPT_WITH_COST` | 行动有效，但标记高风险、高成本或高暴露 |
| `REWRITE_NEEDED` | 玩家方向合理，但表达方式无法裁决，系统给出保留原意的改写 |
| `REJECT_OUT_OF_WORLD` | 完全超出时代或世界观，拒绝并解释当前世界可用手段 |
| `REJECT_ROLE_IMPOSSIBLE` | 角色没有任何现实路径完成该动作 |
| `REJECT_UNKNOWN_INFORMATION` | 使用了角色不可能知道的信息 |
| `REJECT_CONTROL_OTHER_PLAYER` | 直接替其他角色决定行动或态度 |
| `REJECT_DECLARE_RESULT` | 玩家直接声明结果，不允许系统裁决 |

---

## 4.4 用户提示文案

### 超出世界观

```text
这个行动超出了《桑田诏》的时代与世界规则。
当前世界中没有现代通信、航天或数字监控能力。
你可以改为：派驿卒追查奏疏、调用幕僚核验账簿，或通过商路和官府渠道收集证据。
```

### 超出角色能力

```text
浙江总督无法直接命令皇帝改变国策，但可以通过密奏、证据和地方执行结果影响御前判断。
请把行动改成角色能够实际尝试的步骤。
```

### 直接控制他人

```text
你可以向清流县令提出条件、施加压力或提供交换，但不能直接决定他是否交出原件。
系统将把对方的回应留给该玩家或角色状态裁决。
```

### 直接宣布结果

```text
你可以描述准备采取的行动和希望达到的目标，结果将由当前证据、资源、其他玩家行动和世界局势共同决定。
```

---

# 5. 玩家操控契约

## 5.1 主决策数据结构

取消 `redLines` 字段，采用以下结构：

```json
{
  "objective": "控制田契证据的流向",
  "targetType": "role",
  "targetRoleId": "role_county_magistrate",
  "method": "要求县令将原件交总督府封存",
  "leverageKeys": ["governor_protection", "review_authority"],
  "visibility": "PRIVATE",
  "riskTolerance": "MEDIUM",
  "fallback": "若县令拒绝，则要求其提交可核验副本",
  "condition": null,
  "freeText": "先由亲信私下接触，不公开留下正式公文"
}
```

---

## 5.2 玩家可以控制的维度

| 字段 | 玩家控制内容 |
|---|---|
| `objective` | 想改变的局势 |
| `targetType` | 人物、证据、地点、资源、口径或事件 |
| `targetRoleId/targetId` | 具体目标 |
| `method` | 实际执行方法 |
| `leverageKeys` | 投入的资源、秘密、承诺或权力 |
| `visibility` | 公开、可观察、定向或私密 |
| `riskTolerance` | 接受的风险水平 |
| `fallback` | 主方案失败后的替代方案 |
| `condition` | 条件行动的触发条件 |
| `freeText` | 对标准字段的补充 |

---

## 5.3 AI 不得改变的内容

AI不得：

```text
把私下行动写成公开行动
把试探写成正式指控
把调查写成已经定罪
把交换写成强制夺取
把保护盟友写成主动背叛
把不使用筹码写成自动消耗筹码
把目标 A 替换成目标 B
```

AI可以：

```text
判定行动失败、部分成功或产生意外后果
增加符合局势的成本和暴露
让其他角色拒绝、反制或误解
让行动留下可观察痕迹
让后手因条件不满足而不触发
```

---

# 6. 角色专属权力系统

角色必须拥有不同的行动语言，不允许所有角色只换名称、共用同一组按钮。

## 6.1 浙江总督

### 核心权力

```text
总督府权威
地方军政节制权
复核权
密奏渠道
赈济和官仓调度
幕僚调查网络
```

### 专属动作

```text
追加密奏
要求复核名册
保护或召见地方官
调动幕僚调查
暂缓部分地方执行
调拨官仓
公开节制巡抚
封存证据
```

### 核心风险

```text
被认为拖延国策
被认为欺瞒皇帝
与巡抚公开失和
海防或财政失衡
保护下属后反被证据牵连
```

---

## 6.2 浙江巡抚

### 核心权力

```text
新政执行权
地方官吏调度
公开奏报渠道
改桑进度口径
地方催办能力
```

### 专属动作

```text
抢先上奏
催办县衙
重排责任
召集商会
公开进度
压缩复核时间
派幕僚解释或灭火
```

### 核心风险

```text
证据链指向幕僚
新政进度与民心冲突
被总督夺走解释权
商会倒戈
抢功变成最终担责
```

---

## 6.3 清流县令

### 核心权力

```text
基层事实
田契和县衙文书
百姓民情
原件与副本控制
执行节奏
地方证人
```

### 专属动作

```text
留存副本
转移原件
拖延或分批执行
保护田户
越级递交证据
组织民情记录
向总督或巡抚交换保护
公开县级数据
```

### 核心风险

```text
成为督抚冲突的替罪羊
原件被夺或灭失
抗命罪名
百姓失控
公开证据后失去保护
```

---

## 6.4 江南商会

### 核心权力

```text
粮仓库存
商路
垫银能力
账簿信息
地方商人网络
市场价格预期
```

### 专属动作

```text
放粮
冻结粮路
垫付银两
转移库存
交换账簿
制造市场口径
向官员提供条件
切割个别商号
```

### 核心风险

```text
成为囤粮替罪羊
账簿牵连官员
被全面查封
押错政治阵营
短期放粮造成长期损失
```

---

# 7. 六类权谋对象

## 7.1 解释权

同一事实允许存在不同公开叙事：

```text
粮价上涨
├─ 商会囤粮
├─ 改桑破坏粮田
├─ 地方执行失控
├─ 总督故意拖延
└─ 巡抚隐瞒民情
```

系统必须记录：

```json
{
  "frameKey": "grain_price_cause",
  "candidates": [
    { "ownerRoleId": "xunfu", "claim": "merchant_hoarding", "support": 42 },
    { "ownerRoleId": "county", "claim": "mulberry_policy_damage", "support": 58 }
  ],
  "currentPublicFrame": "merchant_hoarding"
}
```

---

## 7.2 证据权

证据状态至少包含：

```text
真实性
完整度
原件持有人
副本持有人
已知角色
可证明对象
公开程度
是否经过核验
是否留下转移痕迹
```

示例：

```json
{
  "evidenceKey": "land_contract_ledger",
  "authenticity": 70,
  "completeness": 45,
  "originalHolderRoleId": "county_magistrate",
  "copyHolderRoleIds": ["governor"],
  "knownByRoleIds": ["county_magistrate", "governor"],
  "verification": "PARTIAL",
  "visibility": "PRIVATE",
  "implicates": ["merchant_staff", "xunfu_aide"]
}
```

---

## 7.3 资源控制权

资源不是单纯数值，而是可执行能力：

```text
总督府权威：可用于节制、保护、调查、封存
官仓粮：可用于平价、赈济、换取民心，但影响海防供应
商会库存：可用于放粮、囤积、交易和制造价格预期
奏报渠道：可用于争夺解释权
田契原件：可用于核验、交换、威胁和公开
```

---

## 7.4 承诺与政治债务

承诺不等于抽象“好感度”。

```json
{
  "promiseKey": "protect_county_office",
  "issuerRoleId": "governor",
  "receiverRoleId": "county_magistrate",
  "content": "若县令交出原件，总督将在御前承担复核责任",
  "status": "PENDING",
  "visibility": "LIMITED",
  "createdNodeIndex": 2,
  "dueNodeIndex": 6
}
```

状态：

```text
PENDING
FULFILLED
PARTIALLY_FULFILLED
BROKEN
EXPOSED
VOID
```

---

## 7.5 暗线

`StoryThread` 用于承载持续谋划：

```text
调查巡抚与商会旧约
进度 1/3
当前持有人：浙江总督
可见度：私密
暴露风险：20
下一步：获取驿站经手人证词
```

暗线支持：

```text
继续推进
暂停隐藏
转交盟友
公开部分结果
故意泄露
用于交换
转化为正式证据
```

---

## 7.6 条件后手

玩家可以布置：

```text
如果巡抚抢先上奏，则追加粮价风险密奏。
如果县令交出原件，则立即公开保护其官位。
如果商会拒绝放粮，则先查封一个小粮仓施压。
```

条件后手属于玩家操作，不是系统自动替玩家选择。

```json
{
  "executionMode": "CONDITIONAL",
  "trigger": {
    "eventType": "MEMORIAL_SENT",
    "actorRoleId": "xunfu"
  },
  "command": {
    "method": "追加密奏",
    "objective": "抢回粮价解释权"
  },
  "status": "ARMED"
}
```

---

# 8. 信息可见性与欺骗空间

## 8.1 四级行动可见度

| 级别 | 含义 | 其他玩家看到的内容 |
|---|---|---|
| `PUBLIC` | 公开行动 | 行动者、行动内容、公开理由、公开结果 |
| `OBSERVABLE` | 行动本身隐藏但会留下痕迹 | 只看到线索或异常，不知道完整目的 |
| `LIMITED` | 定向交涉 | 仅行动者和指定目标知道 |
| `PRIVATE` | 私密布局 | 只有行动者知道，直到行动暴露 |

---

## 8.2 事实类型

建议将事实语义扩展为：

```text
CONFIRMED_PUBLIC      已确认公开事实
CONFIRMED_PRIVATE     已确认私密事实
OBSERVABLE_TRACE      可观察痕迹
RUMOR                 传闻
BELIEF                角色推断
FALSE_INFORMATION     被制造或误传的信息
```

P0 可继续使用 `CanonFact.status + visibility` 表达，不一定立即新增 enum，但服务层必须严格区分。

---

## 8.3 通知投影原则

禁止把其他玩家的完整 `method + intent` 广播给所有人。

例如巡抚秘密上奏：

### 巡抚本人

```text
你的奏疏已封缄，并于夜间送往驿站。
当前状态：运送中。
```

### 总督

```text
你的人发现驿站夜间临时增加了一名巡抚衙门的经手人。
一封加急文书已经离开杭州，内容未知。
```

### 县令

```text
县衙听到传闻：京师可能很快收到一份关于改桑进度的奏报。
消息来源尚未核实。
```

### 商会

```text
部分米商开始押注朝廷将继续强推改桑，市场预期发生变化。
```

---

# 9. 行动窗口与无等待设计

## 9.1 实时模式

P0 建议默认：

```text
每阶段 120 秒
```

推荐节奏：

```text
0—35 秒：阅读私人简报并提交主决策
35—90 秒：进行主动谋划或处理交涉
90—120 秒：处理最后回应、查看行动痕迹
120 秒：自动关闭行动窗口并进入收束
```

后台配置：

```ts
const DEFAULT_ACTION_WINDOW_SECONDS = 120;
const MIN_ACTION_WINDOW_SECONDS = 60;
const MAX_ACTION_WINDOW_SECONDS = 300;
```

---

## 9.2 自动收束条件

满足以下任一条件：

```text
A. 行动窗口到期
B. 所有真人玩家已提交主决策，且所有已打开的必要回应已完成
C. 管理员调试接口强制收束
```

正常玩家页面不再提供“房主结算本轮”按钮。

---

## 9.3 玩家提前完成后的页面

禁止显示：

```text
1/3 已提交
等待另外两名玩家
```

应显示：

```text
你的主决策已密封
亲信已经携总督手令前往县衙。
三方局势正在形成，本阶段剩余 01:04。

你仍可：
[人物交涉]
[派遣调查]
[使用筹码]
[布置后手]
```

其他玩家状态只能显示世界内痕迹：

```text
浙江总督：府中正在调动幕僚
浙江巡抚：衙门灯火未熄
清流县令：暂未公开表态
江南商会：粮仓开始调货
```

这些状态不能泄露真实行动。

---

# 10. 超时与离线处理

## 10.1 不设置托管原则

进入游戏时不要求玩家选择：

```text
优先保护自己
优先完成目标
优先保护盟友
……
```

原因：

1. 这会让玩家误以为 AI 可以代替自己做战略选择。
2. 抽象原则在复杂权谋中容易与玩家当前布局冲突。
3. 玩家已经通过角色目标、已提交行动和条件后手表达意图。

---

## 10.2 系统的最小维持行为

当玩家未提交主决策且窗口到期时，系统只能执行“最小维持行为”，不得替玩家完成重大布局。

执行优先级：

```text
1. 执行玩家此前已明确布置且已触发的条件后手
2. 延续已经开始、无新增重大代价的行动
3. 保护角色当前已持有的物品和位置
4. 不公开新增秘密
5. 不主动改变阵营
6. 不主动消耗唯一性筹码
7. 不做不可逆政治承诺
8. 若无合法延续动作，则保持观察或暂不公开表态
```

这里不是玩家可配置的“红线”，而是系统超时兜底边界。

默认行动示例：

```text
浙江总督未及时行动：总督府继续复核现有材料，暂不公开表态。
浙江巡抚未及时行动：巡抚维持既有催办，但不追加新的强制命令。
清流县令未及时行动：县令继续保存现有证据，不主动转移或公开。
江南商会未及时行动：商会维持当前库存安排，不新增放粮或封仓。
```

---

# 11. 他人影响与回应机制

## 11.1 普通影响

无需立即回应，自动进入局势：

```text
巡抚公开催办
→ 县令执行压力上升
```

目标角色收到通知，但世界不中断。

---

## 11.2 可回应影响

对方行动直接要求目标角色决定：

```text
总督要求县令交出田契原件
```

县令可选择：

```text
交出原件
只交副本
要求保护承诺
故意拖延
拒绝并准备越级上告
自定义符合世界观的回应
```

回应窗口：

```text
20—30 秒，且不得延长世界行动窗口。
```

如果未回应，执行“暂缓答复/维持持有状态”，而不是替玩家交出原件。

---

## 11.3 不可由他人强制完成的行为

其他角色不能通过一次行动直接完成：

```text
让玩家角色背叛
让玩家角色公开核心秘密
让玩家角色交出唯一原件
让玩家角色承认重大罪责
让玩家角色改变最终阵营
```

这些可以被施压、诱导或制造条件，但最终动作由目标玩家回应或在世界收束中以“未达成”处理。

---

# 12. 世界阶段状态机

## 12.1 状态定义

```ts
type ActionWindowStatus =
  | "PREPARING"
  | "OPEN"
  | "CLOSING"
  | "RESOLVING"
  | "PROJECTING"
  | "RESOLVED"
  | "FAILED";
```

流程：

```text
PREPARING
  创建公共场景、私人简报、行动额度
  ↓
OPEN
  接收 MAIN / MANEUVER / REACTION
  ↓
CLOSING
  拒绝新主决策，完成已开始的短回应
  ↓
RESOLVING
  碰撞裁决、状态补丁、事实变化
  ↓
PROJECTING
  生成每个角色不同的可见结果
  ↓
RESOLVED
  更新 StoryRun.currentNodeId，开启下一阶段
```

---

## 12.2 幂等要求

必须保证：

```text
同一个 ActionWindow 只能正式收束一次
同一个 PlayerAction 只能结算一次
同一个条件后手只能触发一次
同一个角色结果投影只能生成一个最终版本
StoryTaskOutbox 重试不能重复扣资源或重复创建事实
```

---

# 13. AI 导演分层架构

禁止一个大模型调用直接完成“校验、规则、结算、隐私投影和剧情写作”。

## 13.1 第一层：WorldBoundaryGuard

职责：

```text
检查世界观
检查时代与技术
检查角色能力路径
检查角色已知信息
检查是否控制其他玩家
检查是否直接宣布结果
生成保留玩家意图的改写建议
```

优先使用规则 + 模板元数据，只有模糊语义才调用模型。

---

## 13.2 第二层：ActionNormalizer

将自由文本转为结构化行动：

```json
{
  "objective": "争夺解释权",
  "actionType": "SEND_MEMORIAL",
  "targetType": "INSTITUTION",
  "targetId": "IMPERIAL_COURT",
  "method": "通过密奏附上粮价与田契副本",
  "leverageKeys": ["secret_memorial_channel", "land_contract_copy"],
  "visibility": "PRIVATE",
  "riskLevel": "RISKY",
  "fallback": "若密奏渠道受阻，保留副本等待御前询问"
}
```

---

## 13.3 第三层：CausalArbiter

先由确定性规则计算：

```text
角色是否拥有资源
资源是否已被占用
行动是否先于对手
证据真实性与完整度
行动可见度
关系、承诺和暗线加成
冲突动作是否互相抵消
```

再让模型补充：

```text
符合世界的意外后果
角色反应语义
局势冲突的叙事逻辑
不确定结果的合理解释
```

结构化输出：

```json
{
  "actionResults": [],
  "collisions": [],
  "resourceChanges": [],
  "factChanges": [],
  "evidenceChanges": [],
  "relationshipChanges": [],
  "promiseChanges": [],
  "threadChanges": [],
  "triggeredConditionalActions": [],
  "publicWorldPatch": {},
  "nextHook": ""
}
```

---

## 13.4 第四层：PerspectiveProjector

根据 `CharacterMind` 生成每个角色的结果投影：

```text
确认知道的事实
可观察痕迹
定向收到的信息
合理传闻
不能看到的内容
本人行动的真实状态
别人对本人的影响
本人对别人造成的可见影响
```

输出：

```json
{
  "roleId": "role_governor",
  "confirmedFacts": [],
  "observedTraces": [],
  "receivedMessages": [],
  "unknownEventCount": 2,
  "personalResult": "",
  "incomingImpacts": [],
  "outgoingVisibleImpacts": []
}
```

---

## 13.5 第五层：NarrativeWriter

只负责把已裁决结果写成剧情。

不得：

```text
新增未在裁决结果中的核心事实
改变行动结果
泄露其他角色私密行动
替玩家添加重大选择
为了戏剧性破坏世界规则
```

---

# 14. 世界模板扩展

当前 `StoryTemplate` 需要增加世界边界与角色动作词典。

## 14.1 建议类型

```ts
export type WorldBoundaryConfig = {
  era: string;
  locations: string[];
  institutions: string[];
  technologies: string[];
  communicationMethods: string[];
  resourceOntology: string[];
  forbiddenAnachronisms: string[];
  worldRules: string[];
};

export type RoleCapabilityConfig = {
  directActions: string[];
  riskyActions: string[];
  impossibleActions: string[];
  controlledResources: string[];
  reachableTargets: string[];
};

export type StoryTemplateRole = {
  // 保留现有字段
  roleKey: string;
  roleName: string;
  identity: string;
  publicInfo: string;
  hiddenSecret: string;
  personalGoal: string;
  currentState: string;
  abilityText: string;
  arcText: string;
  knownInfo: string[];
  cannotDo: string[];

  capability: RoleCapabilityConfig;
  defaultTimeoutAction: string;
};

export type StoryTemplate = {
  // 保留现有字段
  boundary: WorldBoundaryConfig;
};
```

---

## 14.2 《桑田诏》边界示例

```ts
boundary: {
  era: "明代嘉靖年间",
  locations: ["杭州", "浙江辖县", "总督府", "巡抚衙门", "县衙", "驿站", "粮仓", "商会", "京师"],
  institutions: ["皇帝", "内阁", "司礼监", "总督府", "巡抚衙门", "县衙", "江南商会", "驿传系统"],
  technologies: ["奏疏", "驿传", "账簿", "田契", "官印", "粮仓", "船运", "人工查验"],
  communicationMethods: ["公开公文", "密奏", "书信", "口信", "驿站", "商路传话"],
  resourceOntology: ["官权", "粮食", "银两", "证据", "奏报渠道", "民心", "商路", "官位保护"],
  forbiddenAnachronisms: ["互联网", "卫星", "现代枪械", "飞机", "宇宙飞船", "人工智能", "即时视频通信"],
  worldRules: [
    "皇帝拥有最终制度裁决权，但地方官可通过事实、奏报和执行结果影响判断",
    "信息传播依赖人、文书、驿站和商路，存在延迟、截留和失真",
    "证据必须有来源、持有人和核验过程",
    "玩家只能控制自己的角色与直属可调用资源",
    "行动可以违法、背叛或高风险，但必须有时代内可执行路径"
  ]
}
```

---

# 15. 数据库改造

## 15.1 新增 ActionWindow

```prisma
model ActionWindow {
  id              String   @id @default(cuid())
  runId           String
  nodeId          String   @unique
  status          String   @default("PREPARING")
  opensAt         DateTime
  closesAt        DateTime
  closingAt       DateTime?
  resolvedAt      DateTime?
  version         Int      @default(1)
  configJson      Json
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  run             StoryRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  node            SceneNode @relation(fields: [nodeId], references: [id], onDelete: Cascade)

  @@index([runId, status])
  @@index([closesAt, status])
}
```

需要在 `StoryRun` 和 `SceneNode` 增加 relation。

---

## 15.2 扩展 PlayerAction

```prisma
model PlayerAction {
  // 保留现有字段

  actionSlot       String   @default("MAIN")
  sequence         Int      @default(0)
  executionMode    String   @default("IMMEDIATE")
  visibility       String   @default("PRIVATE")
  objective        String?  @db.Text
  targetRoleId     String?
  leverageJson     Json?
  fallbackJson     Json?
  triggerJson      Json?
  immediateJson    Json?
  resolvedJson     Json?
  expiresAt        DateTime?
  sealedAt         DateTime?
  resolvedAt       DateTime?

  @@unique([nodeId, roleId, actionSlot, sequence])
}
```

移除：

```prisma
@@unique([nodeId, roleId])
```

P0 约束：

```text
MAIN sequence=0，每角色每节点最多 1 条
MANEUVER sequence=0，每角色每节点最多 1 条
REACTION sequence=0，每角色每节点最多 1 条
```

后续如需多次回应，再放开 `sequence`。

---

## 15.3 复用 NarrativeEntry

不新增私人结果表，直接使用：

```text
entryType = "private_brief"
entryType = "immediate_feedback"
entryType = "personal_resolution"
entryType = "observable_trace"
entryType = "incoming_impact"
entryType = "public_resolution"
```

并通过：

```text
roleId
visibility
factKeysJson
threadKeysJson
sourceEventIdsJson
```

控制投影。

---

## 15.4 复用 StoryEvent

建议事件类型：

```text
ACTION_WINDOW_OPENED
MAIN_ACTION_SEALED
MANEUVER_STARTED
OBSERVABLE_TRACE_CREATED
DIRECTED_REQUEST_CREATED
REACTION_REQUIRED
REACTION_SUBMITTED
CONDITIONAL_ACTION_ARMED
CONDITIONAL_ACTION_TRIGGERED
ACTION_WINDOW_CLOSING
RESOLUTION_STARTED
PERSONAL_RESULT_READY
PUBLIC_RESULT_READY
NEXT_NODE_OPENED
```

---

# 16. API 设计

## 16.1 获取游戏投影

```http
GET /api/v4/rooms/:roomId/game
```

返回必须是当前用户私有投影，禁止返回其他玩家完整行动。

```json
{
  "room": {},
  "actionWindow": {
    "status": "OPEN",
    "opensAt": "",
    "closesAt": "",
    "remainingSeconds": 76
  },
  "currentNode": {},
  "privateBrief": {},
  "myActions": [],
  "availableManeuvers": [],
  "pendingReaction": null,
  "observablePlayerStates": [],
  "latestPersonalResult": null,
  "latestPublicResult": null
}
```

---

## 16.2 密封主决策

```http
POST /api/v4/rooms/:roomId/game/actions/main
```

请求：

```json
{
  "objective": "控制田契证据流向",
  "targetType": "role",
  "targetRoleId": "role_county_magistrate",
  "method": "要求县令私下提交原件",
  "leverageKeys": ["governor_protection"],
  "visibility": "PRIVATE",
  "riskTolerance": "MEDIUM",
  "fallback": "若拒绝则只收副本",
  "freeText": "由亲信接触，不发公开公文"
}
```

返回：

```json
{
  "accepted": true,
  "guardDecision": "ACCEPT",
  "action": {},
  "immediateFeedback": {
    "title": "你的命令已发出",
    "content": "亲信已经携总督手令前往县衙。",
    "costs": [],
    "possibleTraces": []
  },
  "game": {}
}
```

---

## 16.3 提交主动谋划

```http
POST /api/v4/rooms/:roomId/game/actions/maneuver
```

支持：

```text
CONTACT
INVESTIGATE
LEVERAGE
CONDITIONAL
FRAME
CUSTOM
```

---

## 16.4 提交回应

```http
POST /api/v4/rooms/:roomId/game/events/:eventId/reaction
```

必须校验：

```text
事件目标是当前角色
事件仍在回应窗口
当前角色本节点尚未使用回应次数
回应符合世界观和角色能力
```

---

## 16.5 事件流

继续使用：

```http
GET /api/v4/rooms/:roomId/game/events/stream
```

推送：

```text
剩余时间更新不需要每秒推送，可由前端本地倒计时
新私人通知
可观察痕迹
定向交涉
回应请求
行动窗口状态变化
个人结果就绪
公共结果就绪
```

---

## 16.6 移除正常玩家结算 API

当前：

```http
POST /api/v4/rooms/:roomId/game/resolve-async
```

调整为：

```text
不再由普通房主页面调用
保留内部服务调用
可增加管理员调试 endpoint
```

自动收束由 `ActionWindowScheduler` 或现有 worker 扫描到期窗口后调用。

---

# 17. 后端服务拆分

建议新增：

```text
apps/api/src/gameplay/world-boundary-guard.service.ts
apps/api/src/gameplay/action-normalizer.service.ts
apps/api/src/gameplay/action-window.service.ts
apps/api/src/gameplay/immediate-feedback.service.ts
apps/api/src/gameplay/causal-arbiter.service.ts
apps/api/src/gameplay/perspective-projector.service.ts
apps/api/src/gameplay/action-timeout.service.ts
```

## 17.1 WorldBoundaryGuardService

输入：

```text
world template boundary
role capability
CharacterMind
current SceneSnapshot
player draft
```

输出：

```text
decision
reason
matchedRules
normalizedDraft
suggestedRewrite
riskFlags
```

---

## 17.2 ActionWindowService

职责：

```text
为新节点创建行动窗口
计算剩余时间
接收和密封行动
关闭到期窗口
检测是否满足提前收束
创建 StoryTaskOutbox
处理并发与版本冲突
```

---

## 17.3 ImmediateFeedbackService

职责：

```text
确认命令是否进入执行链
扣除立即消耗资源
创建行动痕迹
创建定向交涉事件
创建条件后手
生成当前玩家即时反馈
```

注意：即时反馈不能提前给出最终成功结果。

---

## 17.4 CausalArbiterService

职责：

```text
加载全部密封行动
计算资源与权限
处理先后顺序
处理行动碰撞
处理承诺、证据与暗线
触发条件行动
输出统一结构化状态补丁
```

---

## 17.5 PerspectiveProjectorService

职责：

```text
更新 CanonFact
更新 CharacterMind
生成公共 SceneSnapshot
生成角色私有 SceneSnapshot
创建角色私有 NarrativeEntry
创建公共 NarrativeEntry
创建 Notification
```

---

# 18. 对现有文件的具体修改

## 18.1 `prisma/schema.prisma`

完成：

```text
新增 ActionWindow
扩展 PlayerAction
移除旧唯一约束
增加必要 relation 和 index
```

---

## 18.2 `packages/templates/src/index.ts`

完成：

```text
扩展 StoryTemplate.boundary
扩展 StoryTemplateRole.capability
补充《桑田诏》世界边界
补充四个角色专属动作、资源与超时行为
把公共 actionOptions 改为只提供公共参考，不再作为所有角色唯一动作来源
```

---

## 18.3 `apps/api/src/story.service.ts`

逐步拆出：

```text
guardAction → WorldBoundaryGuardService
guardKnowledgeBoundary → WorldBoundaryGuardService
resolveNode → CausalArbiterService + PerspectiveProjectorService
notifyOtherPlayers → 按 visibility 和 CharacterMind 投影
fillMissingActions → 最小维持行为，不再生成统一 observe 文案
```

保留旧方法用于单人模式或 feature flag 回退。

---

## 18.4 `apps/api/src/rooms.service.ts`

修改：

```text
game() 返回当前玩家私有投影
submitGameAction() 拆成 MAIN / MANEUVER / REACTION
requireResolvableNode() 不再要求房主手动调用
resolveGameNodeAsync() 改为内部方法
事件流增加 ActionWindow 与私人事件
```

删除正常玩家流程中的：

```text
WAITING_FOR_PLAYER_ACTIONS
Only the host can resolve the shared round
```

---

## 18.5 `apps/web/public/room-game.js`

当前简单表单需要替换为状态驱动页面：

```text
PRIVATE_BRIEF
MAIN_ACTION_EDIT
MAIN_ACTION_SEALED
LAYOUT_PHASE
REACTION_REQUIRED
RESOLVING
PERSONAL_RESULT
PUBLIC_RESULT
```

移除：

```text
Action submitted. Waiting for the other players.
Resolve this round
Waiting
X actions submitted 作为主视觉
```

---

## 18.6 `apps/web/public/app.js`

单人《桑田诏》的谋划中枢和结果流已经较完整，可复用：

```text
人物交谈 UI
派遣调查 UI
使用筹码 UI
自拟谋划 UI
流式剧情结果 UI
关键事件回应 UI
```

但多人页面必须接入房间私有投影和事件流，不能直接复制单人状态。

---

# 19. 多人游戏页面设计

## 19.1 顶部

显示：

```text
地点
世界阶段
本阶段剩余时间
主决策状态
谋划剩余次数
世界核心数值
历史回顾
设置
```

不显示具体哪个玩家没有提交。

---

## 19.2 左侧：我的权力基础

```text
我的身份
公开立场
个人目标
隐藏秘密
可用资源
可用筹码
当前承诺
正在推进的暗线
当前风险
```

资源必须可点击查看用途。

示例：

```text
总督府权威 3
可用于：保护官员、节制巡抚、调动幕僚、封存证据
```

---

## 19.3 中间：我的棋局

### 私人简报

```text
公共时局
我额外知道的内容
当前压力
本阶段必须处理的问题
```

### 主决策编辑

```text
目标
对象
方法
筹码
公开程度
风险
失败后手
自定义补充
```

### 密封后

```text
你的命令已发出
即时变化
行动状态
可能留下的痕迹
继续布局入口
```

### 世界收束后

```text
剧情结果
我的行动结果
别人对我的影响
我对别人造成的可见影响
资源/证据/关系变化
公共局势变化
```

---

## 19.4 右侧：谋划中枢

页签：

```text
交涉
调查
筹码
后手
```

固定模块：

```text
正在推进
待我回应
已布置后手
新出现痕迹
```

---

## 19.5 其他角色状态

只显示可观察状态：

```text
巡抚衙门正在加急用印
县衙暂未公开回应
商会粮仓开始调货
总督府有幕僚离府
```

严禁直接显示：

```text
巡抚正在秘密上奏
县令选择只交副本
商会真实目的是什么
```

除非玩家通过调查确认。

---

# 20. 《县令密信》完整多人示例

## 20.1 公共时局

> 县令密信已经送入总督府。巡抚衙门正在询问密信内容，商会也听到了田契异常的风声。

---

## 20.2 浙江总督私人简报

```text
县令把一份田契副本交给了你，但没有说明原件在哪里。
巡抚正在催问密信去向。
如果巡抚先向京师解释，你将失去浙江局势的定义权。
```

落子：

```json
{
  "objective": "掌握证据流向",
  "targetRoleId": "county_magistrate",
  "method": "要求县令私下提交原件",
  "leverageKeys": ["official_protection"],
  "visibility": "LIMITED",
  "fallback": "若拒绝则只收可核验副本"
}
```

即时反馈：

> 总督亲信已经前往县衙。巡抚衙门可能注意到人员调动，但暂时不知道目的。

---

## 20.3 浙江巡抚私人简报

```text
县令绕过巡抚衙门直接联系总督。
你尚不知道密信内容，但幕僚担心其中涉及改桑名册。
```

落子：

```json
{
  "objective": "抢夺解释权",
  "targetType": "institution",
  "method": "提前向京师发送改桑进度奏疏",
  "leverageKeys": ["cabinet_channel"],
  "visibility": "PRIVATE",
  "fallback": "若驿站受查则经商路送出副本"
}
```

即时反馈：

> 奏疏已经封缄并送往驿站。路线可能被总督府查验。

---

## 20.4 清流县令私人简报

```text
总督要求你交出田契原件。
你不确定总督会保护你，还是把你当作督抚冲突的代价。
```

回应：

```json
{
  "objective": "保留谈判能力",
  "method": "只交副本，原件另存",
  "visibility": "LIMITED",
  "fallback": "若总督公开保护，再交出原件"
}
```

即时反馈：

> 副本已经交给总督亲信，原件被转移到县学账房。转移过程可能留下经手人痕迹。

---

## 20.5 江南商会私人简报

```text
田契可能牵出商会粮仓与地方官员的往来。
市场开始猜测官府将查封粮仓。
```

落子：

```json
{
  "objective": "改变公开口径",
  "method": "主动释放一成平价粮",
  "leverageKeys": ["grain_stock"],
  "visibility": "PUBLIC",
  "fallback": "保留主要库存并观察官府反应"
}
```

即时反馈：

> 第一批平价粮已经出仓。米价预期短暂回落，商会也暴露了部分真实库存。

---

## 20.6 行动碰撞

```text
总督获得副本，没有获得原件
巡抚奏疏成功离开杭州
商会通过放粮改变公开口径
县令保留原件和谈判能力
总督府与县衙之间形成一项未公开保护承诺
```

---

## 20.7 分视角结果

### 浙江总督

```text
县令没有完全信任你。
你获得田契副本，但原件仍在他手中。
同时，一封来自巡抚衙门的加急文书已经北上，内容尚未确认。
```

### 浙江巡抚

```text
奏疏成功送出。
但总督府已经接触县令，你的幕僚担心田契问题进入复核链。
```

### 清流县令

```text
总督接受了副本，没有强行夺取原件。
你仍保有谈判能力，但原件转移留下了新的经手风险。
```

### 江南商会

```text
放粮让商会暂时摆脱囤粮指控。
但官府内部正在争夺一份与你们有关的田契证据。
```

### 公共事件

```text
杭州粮价短暂回落，但京师已经收到第一份关于改桑进度的正式奏报。
```

---

# 21. WorldBoundaryGuard 提示词规范

## 21.1 系统提示词

```text
你是 Many Worlds 的世界边界裁判，不是故事作者。

你的任务是判断玩家行动是否能在当前世界、时代、地点、制度、角色能力、已知信息和现有资源中被尝试。

你不能因为行动不道德、背叛、高风险或会造成严重后果而拒绝它。只要世界内存在可执行路径，就应接受并标记成本或风险。

你必须拒绝或要求改写：
1. 超出时代与世界技术的行动；
2. 角色没有任何现实路径完成的行动；
3. 使用角色不可能知道的私密事实；
4. 直接控制其他玩家角色；
5. 直接宣布成功、死亡、胜利或最终结果；
6. 跳过必要因果过程；
7. 与已确认世界事实不可兼容的行动。

你必须尽量保留玩家原始战略意图，给出的改写建议只能改变执行表达，不能替换目标。

只输出符合 JSON Schema 的结果。
```

---

## 21.2 输出 Schema

```json
{
  "decision": "ACCEPT",
  "reason": "",
  "matchedRules": [],
  "riskFlags": [],
  "normalizedAction": {
    "objective": "",
    "targetType": "",
    "targetId": "",
    "method": "",
    "visibility": "PRIVATE",
    "riskLevel": "NORMAL",
    "fallback": ""
  },
  "suggestedRewrite": null
}
```

---

# 22. CausalArbiter 提示词规范

```text
你是 Many Worlds 的因果裁决器，不负责自由创作。

你会收到：
- 已确认世界事实；
- 每个角色的知识边界；
- 每个角色密封行动；
- 资源和证据状态；
- 承诺、暗线与条件后手；
- 行动先后顺序；
- 确定性规则计算结果。

你必须：
1. 保留每名玩家行动的目标、公开程度和投入筹码；
2. 判断行动之间的合作、冲突、抢先、抵消和反制；
3. 任何结果都必须能回溯到行动、资源、证据或世界压力；
4. 不得泄露不应公开的私密行动；
5. 不得新增改变局势的无来源核心事实；
6. 不得让某个玩家的行动自动控制另一玩家；
7. 允许失败、部分成功、成功但有代价和意外后果；
8. 输出结构化状态补丁，不直接生成最终文学叙事。
```

---

# 23. 自动化测试与验收矩阵

## 23.1 世界观边界测试

| 编号 | 输入 | 预期 |
|---|---|---|
| WB-01 | 总督乘宇宙飞船去京师 | `REJECT_OUT_OF_WORLD` |
| WB-02 | 巡抚通过互联网公开账簿 | `REJECT_OUT_OF_WORLD` |
| WB-03 | 县令留存田契副本 | `ACCEPT` |
| WB-04 | 商会冻结部分粮路 | `ACCEPT_WITH_COST` 或 `ACCEPT` |
| WB-05 | 总督保证皇帝采信密奏 | `REJECT_DECLARE_RESULT` |
| WB-06 | 总督以保护官位换县令交证据 | `ACCEPT` |
| WB-07 | 巡抚直接宣布县令背叛总督 | `REJECT_CONTROL_OTHER_PLAYER` |
| WB-08 | 总督使用自己不知道的巡抚隐藏秘密 | `REJECT_UNKNOWN_INFORMATION` |
| WB-09 | 县令公开抗命并承担后果 | `ACCEPT_WITH_COST` |
| WB-10 | 商会销毁自己的账簿 | `ACCEPT_WITH_COST`，不能因“坏”而拒绝 |

---

## 23.2 无等待测试

| 编号 | 场景 | 预期 |
|---|---|---|
| NW-01 | 玩家 A 提交主决策，B/C 未提交 | A 可继续谋划，不显示大型等待页 |
| NW-02 | A 已使用谋划 | A 仍可查看痕迹、消息和行动状态 |
| NW-03 | 行动窗口到期，C 未提交 | C 执行最小维持行为，世界自动收束 |
| NW-04 | 所有人提前提交且无待回应 | 自动提前收束，无需房主按钮 |
| NW-05 | 房主离线 | 世界仍能自动推进 |

---

## 23.3 信息隔离测试

| 编号 | 场景 | 预期 |
|---|---|---|
| IV-01 | 巡抚提交 PRIVATE 上奏 | 其他玩家看不到 method 和 intent |
| IV-02 | 上奏留下驿站痕迹 | 有调查能力的角色可看到 OBSERVABLE_TRACE |
| IV-03 | 总督向县令定向交涉 | 仅双方看到完整内容 |
| IV-04 | 公开放粮 | 所有角色看到公开行动与公开结果 |
| IV-05 | 县令转移原件 | 未调查角色只看到模糊痕迹或完全未知 |

---

## 23.4 操控感测试

| 编号 | 场景 | 预期 |
|---|---|---|
| AG-01 | 玩家选择私下试探 | AI 不得改写为公开弹劾 |
| AG-02 | 玩家不投入唯一证据 | 系统不得自动消耗 |
| AG-03 | 玩家设置 fallback | 主方案失败后按 fallback 尝试 |
| AG-04 | 玩家设置 PUBLIC | 系统不得把行动降为 PRIVATE |
| AG-05 | 玩家自定义高风险合法行动 | 系统接受并计算代价，不做道德拒绝 |

---

## 23.5 并发与幂等测试

```text
两名玩家同时密封主决策，不覆盖彼此
同一玩家重复提交 MAIN，返回幂等结果或明确冲突
窗口关闭后拒绝新 MAIN
worker 重试不重复创建 DirectorResolution
条件后手重复事件只触发一次
个人结果重复投影不生成重复 NarrativeEntry
SSE 断线重连不泄露其他玩家私密事件
```

---

# 24. 开发实施顺序

## PR-01：数据库与共享类型

```text
新增 ActionWindow
扩展 PlayerAction
增加 migration
扩展共享类型
增加 schema 单元测试
```

验收：

```text
pnpm db:migrate
pnpm typecheck
Prisma Client 可正常生成
旧单人数据可继续读取
```

---

## PR-02：世界模板边界

```text
扩展 StoryTemplate.boundary
扩展角色 capability
补齐《桑田诏》配置
实现静态规则 WorldBoundaryGuard
保留现有 ActionGuard 作为兼容入口
```

---

## PR-03：行动窗口与自动收束

```text
创建 ActionWindowService
节点开启时自动创建窗口
实现 closesAt
实现 worker 扫描和自动 enqueue
移除玩家正常流程中的房主结算依赖
```

---

## PR-04：主决策、谋划、回应 API

```text
MAIN endpoint
MANEUVER endpoint
REACTION endpoint
即时反馈
条件后手
可见度校验
```

---

## PR-05：因果碰撞与分视角投影

```text
CausalArbiter
PerspectiveProjector
按角色创建 NarrativeEntry
更新 CanonFact / CharacterMind / StoryThread
改造通知投影
```

---

## PR-06：多人游戏 UI

```text
私人简报
主决策契约
密封反馈
谋划中枢
待回应事件
行动痕迹
个人结果
公共结果
倒计时和 SSE
```

---

## PR-07：自动化验收

```text
三玩家浏览器 E2E
世界边界矩阵
信息隔离测试
超时推进测试
并发与幂等测试
DeepSeek live smoke
```

---

# 25. Feature Flag 与兼容方案

建议增加：

```text
MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED=true
MULTIPLAYER_ACTION_WINDOW_SECONDS=120
WORLD_BOUNDARY_GUARD_PROVIDER=rules_then_ai
AUTO_RESOLVE_ACTION_WINDOW=true
```

关闭 flag 时继续使用旧模式：

```text
每角色一次行动
房主手动结算
统一结果
```

单人 `MvpStoryEngine` 暂不强制迁移，可以先保持现有 7 天流程。

---

# 26. 监控指标

必须记录：

```text
阶段平均停留时间
主决策提交率
谋划使用率
回应使用率
玩家提交后主动操作次数
行动窗口超时率
最小维持行为触发率
世界观越界率
改写后重新提交成功率
私人行动暴露率
每轮 AI token 成本
结算失败与重试次数
玩家中途退出率
```

最关键的产品指标：

```text
提交主决策后，玩家是否继续进行至少一次有效操作。
```

P0 目标：

```text
≥ 70% 的已提交玩家在收束前继续完成谋划、回应或有效信息操作之一。
```

---

# 27. 最终验收标准 Definition of Done

## 27.1 玩家体验

- [ ] 玩家进入同一公共节点时，看到不同的私人简报。
- [ ] 玩家能自由选择目标、对象、方法、筹码、可见度和后手。
- [ ] 玩家提交后立即获得执行反馈。
- [ ] 玩家提交后仍能继续至少一次有效谋划。
- [ ] 页面不再用“等待另外两名玩家”作为主状态。
- [ ] 房主离线不阻塞正常结算。
- [ ] 玩家能收到他人行动留下的痕迹，但不会看到不该知道的完整意图。
- [ ] 玩家能对直接影响自己的行动进行回应。
- [ ] 每个玩家获得不同的个人结果视角。
- [ ] 公共剧情能够解释多人行动如何碰撞。

## 27.2 世界边界

- [ ] 外太空、互联网、卫星等越界行动会被及时阻止。
- [ ] 系统解释为什么越界，并给出世界内替代手段。
- [ ] 背叛、公开秘密、消耗筹码等世界内高风险行为不会被道德化阻止。
- [ ] 角色不能直接控制其他玩家角色。
- [ ] 玩家不能直接宣布最终结果。
- [ ] AI 不会改变玩家行动的目标和公开程度。

## 27.3 工程质量

- [ ] ActionWindow 自动开启和关闭。
- [ ] 自动结算幂等。
- [ ] SSE 只推送成员可见事件。
- [ ] 私密行动不会出现在其他成员 API 响应中。
- [ ] worker 重试不重复扣资源。
- [ ] 条件后手只触发一次。
- [ ] 原有单人模式不受影响。
- [ ] 三玩家七阶段 E2E 通过。

---

# 28. 最终核心循环

Many Worlds 多人模式最终应固定为：

```text
公共危局
→ 私人处境
→ 密封主决策
→ 世界边界校验
→ 即时执行反馈
→ 连续谋划
→ 他人影响与可选回应
→ 条件后手触发
→ 多人行动碰撞
→ 个人视角回响
→ 公共世界事件
→ 下一阶段
```

对外产品表达：

> **每个玩家掌握不同的权力、秘密、资源和目标，在同一个危局中同时落子。你可以拉拢、隐瞒、交换、背叛、争夺证据、制造口径或布置后手；只要行动符合这个世界的时代、角色和因果规则，系统就允许你尝试，并让所有人的选择在 AI 与规则系统中真实碰撞。**

内部产品判断标准：

> 玩家不是在等待别人完成一轮，而是在等待局势收束的同时继续布置自己的下一步。

