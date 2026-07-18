# AI 多人局｜Web MVP 产品需求文档 v4.1（工程基线修订版）

> 文档类型：平台级 PRD / Web MVP 工程需求文档  
> 版本：v4.1（工程基线修订版）  
> 核心方向：从「多人 AI 故事 / 节点制行动结算」升级为「剧情消息驱动的动态决策局」  
> 当前优先级：**Web 端 MVP**  
> 暂停事项：小程序、多人实时同步、创作者生态、复杂命运网、付费系统  
> 首个 MVP 故事局：《桑田诏：嘉靖财政危局》  
> 目标读者：产品、前端、后端、AI 工程、设计、Codex / 开发执行者  
> 核心结论：**这不是一个单游戏，而是一个可扩展的 AI 多人局平台；MVP 只做一个 Web 故事局来验证核心循环。**

---

# 0. 本版文档更新说明
## 0.0 工程基线优先级（v4.1 新增）

本文档受《AI 多人局｜MVP 唯一工程基线 v1.0》约束。出现冲突时，以工程基线为准。当前正式锁定：

```text
Web 单人 MVP
玩家仅控制浙江总督
第 1—6 天每天固定 2 次关键决策，共 12 次
第 7 天仅进行最终裁决
前端继续使用 apps/web，不新建 apps/player-web，不在 MVP 阶段迁移 Next.js
运行态只使用 StoryRun + StoryEvent
StoryMessage / PlayerDecision 暂不拆表，作为 StoryEvent.type 表达
真实 AI 接入后增加 AiTask
规则引擎是状态权威，AI 负责意图理解、角色反应和剧情表达
```

统一接口字段：`templateKey / selectedRoleKey / runId / eventId / version / optionKey / customText`。



## 0.1 本文档融合了哪些内容

本文档融合并重构以下两份需求：

1. `AI多人故事局_PRD_阶段化工程完整增强版_v5.md`
2. `API多人局_平台级产品需求文档_v3.0.md`

保留旧文档中有价值的内容：

- 多人命运线共演
- 专属开场
- 命运问题
- 信息不对称
- 三个回响
- 跨角色影响
- 延迟后果
- 私密线索
- 多 POV 章节
- 个人故事卡
- 后台像 GitHub 的长期共创方向
- ActionGuard 防乱写机制
- AI 导演 / 裁判 / 状态管理者定位

同时根据最新讨论做出关键修改：

- 当前不做小程序，先做 Web MVP
- 当前不做“节点回合制”，改为“天数制剧情消息流”
- 当前不做“所有人提交行动后统一结算”，改为“剧情消息驱动的动态决策”
- 当前主页面中间不是信息面板，而是**剧情消息流 + 当前决策区**
- 左右两边只是信息辅助和决策结果反馈
- 对手 / AI 角色的行动不能以系统日志出现，而要转译成剧情消息
- 玩家可以选 A/B/C，也可以自定义决策
- 玩家决策会改变右侧状态，也会转译为其他角色看到的新剧情消息
- 游戏不是无限聊天，每局用固定天数和每日消息数量控制节奏

---

# 1. 产品最终定位

## 1.1 产品不是一个单游戏

本产品不是只做《桑田诏》一个游戏。

《桑田诏：嘉靖财政危局》只是第一个验证用故事局。

底层要设计成平台：

```text
AI 多人局平台
  ├── 故事局大厅
  ├── 多个故事局模板
  ├── 角色系统
  ├── 剧情消息流系统
  ├── 玩家决策系统
  ├── AI 推演系统
  ├── 世界状态系统
  ├── 人物关系系统
  ├── 把柄 / 线索系统
  ├── 结局生成系统
  └── 后续多人异步系统
```

后续可以扩展：

```text
历史权谋局
商战局
职场晋升局
悬疑局
家族继承局
董事会逼宫局
创业融资局
宗门权力局
宫廷局
战争外交局
```

---

## 1.2 推荐产品表达

### 对用户

> **AI 多人局：每一场都是一个局。你进入角色，在有限天数内做出关键决策，把局推向不同结局。**

### 对开发团队

> **这是一个 Web 端剧情消息驱动的动态决策游戏。核心不是聊天，不是写小说，而是让玩家通过剧情消息做决策，并实时看到世界状态、人物关系和最终命运发生变化。**

### 对投资人 / 外部沟通

> **AI 多人局是一个 AI 驱动的剧情博弈平台。它把历史、商战、职场、悬疑等复杂局势包装成可玩的“局”，用户通过角色决策改变局势，AI 负责推演后果、生成剧情和结局。**

---

# 2. 核心产品形态

## 2.1 一句话定义

> **剧情消息驱动的动态决策游戏。**

玩家不是看小说，也不是和 AI 聊天。

玩家看到的是：

```text
剧情消息
↓
局势压力
↓
三个默认决策 + 自定义决策
↓
AI 推演后果
↓
右侧状态变化
↓
新剧情消息
↓
最终裁决
```

---

## 2.2 和旧版“多人 AI 故事”的区别

| 维度 | 旧版多人 AI 故事 | 新版 AI 多人局 |
|---|---|---|
| 用户行为 | 扮演角色提交行动 | 看到剧情压力后做决策 |
| 结构 | 节点 / 回合 / 全员行动后结算 | 天数制 / 剧情消息流 / 按消息决策 |
| 中间页面 | 当前剧情 + 行动表单 | 剧情消息流 + 当前待决策剧情 |
| 对手行动 | 系统记录或行动列表 | 转译成剧情消息推到你面前 |
| AI 角色 | 可能主动参与 | 只作为局势反应者，不抢主导权 |
| 目标 | 生成一章故事 | 推动一个局走向某种结局 |
| 用户感受 | 我参与了故事 | 我进入了一个局，并改变了局势 |
| 节奏控制 | 节点数 | 天数 + 每日消息数 |
| MVP 优先级 | 小程序 + 多人 | Web + 单人 + AI 机器人 |

---

# 3. MVP 范围

## 3.1 当前明确只做 Web

本阶段不做小程序。

暂停：

```text
apps/miniprogram 优先级
Taro 页面优化
微信分享能力
小程序登录闭环
小程序支付
小程序订阅消息
```

优先：

```text
Web 游戏主页面
剧情消息流
玩家决策
AI 推演
右侧状态反馈
单人 7 天闭环
最终结局
```

---

## 3.2 MVP 只做一个故事局

首个故事局：

```text
《桑田诏：嘉靖财政危局》
```

MVP 控制角色：

```text
玩家控制：浙江总督
AI 角色：浙江巡抚、清流县令、江南商会、司礼监、内阁财政派、皇帝
```

MVP 游戏长度：

```text
7 天制
第 7 天御前裁决
```

MVP 单局目标：

```text
玩家能完整玩完 7 天
每天有剧情消息
每个关键消息有决策
决策后状态变化明确
最终生成个人结局 + 全局结局
```

---

## 3.3 MVP 不做什么

本阶段不做：

```text
小程序
多人实时
复杂多人异步
公开故事池
创作者工具
多剧本市场
复杂命运网图谱
大地图探索
装备 / 等级 / 战斗
长篇小说生成
付费系统
社交社区
评论点赞
UGC 剧本编辑器
```

---

# 4. Web MVP 核心体验

## 4.1 玩家真正玩什么

玩家玩的不是剧情选择题，而是：

```text
我是谁？
我现在处在什么局？
别人做了什么？
这件事会不会影响我？
我该压制、交易、密奏、放任，还是借机利用？
我选择之后会改变谁？
我最终会升迁、保命、失势，还是被清算？
```

---

## 4.2 玩家爽点

核心爽点：

```text
1. 我不是旁观者，我是局中人。
2. 别人的行动会变成剧情压力推到我面前。
3. 我可以选系统给的策略，也可以自己写决策。
4. 我的决策会改变右侧状态。
5. 我的决策会变成别人看到的新剧情消息。
6. 每一天都在逼近最终裁决。
7. 最终下场由我一路选择累积而成。
```

---

# 5. 游戏节奏：天数制，而不是回合制

## 5.1 不叫回合，不叫时段

统一叫：

```text
第 1 天
第 2 天
第 3 天
……
第 7 天
```

示例：

```text
第 3 天 / 共 7 天
地点：杭州总督府
距离御前裁决：4 天
今日主题：粮价与奏疏
```

---

## 5.2 每一天的结构

每一天由以下部分组成：

```text
今日开局剧情
↓
剧情消息流
↓
关键剧情消息触发决策
↓
玩家做决策
↓
AI 推演结果
↓
右侧状态变化
↓
可能生成新消息
↓
日终回响
↓
进入下一天
```

---

## 5.3 每日内容限制

为了避免无限聊天：

```text
每一天最多 3-5 条核心剧情消息
第 1—6 天每天固定 2 次关键玩家决策；第 7 天不再新增普通决策
每条关键决策后最多生成：
  1 条自己的结果消息
  1 条影响他人的剧情消息
  1 条隐藏暗线变化
每天必须进入日终回响
第 7 天必须进入最终裁决
```

---

# 6. 剧情消息流系统

这是整个产品的核心。

## 6.1 中间主页面是什么

中间主页面不是：

```text
系统日志
事件卡片堆
后台信息面板
聊天窗口
小说阅读器
```

中间主页面是：

> **剧情消息流 + 当前决策区。**

它应该像一个“正在发生的故事现场”。

玩家在这里看到：

```text
巡抚急奏北上
商会拒绝无条件供粮
县令递来密信
司礼监入浙探查
皇帝起疑
你的密奏被送出
```

这些内容都不是简单日志，而是带剧情感的消息。

---

## 6.2 错误消息写法

错误：

```text
浙江巡抚选择了【越级上奏】。
```

这种太像系统日志，不像游戏。

---

## 6.3 正确消息写法

正确：

```text
【第 3 天 · 午后】

驿站快马离开杭州府。

有人看见浙江巡抚的幕僚亲自护送一封急奏北上。奏中称：浙江改桑已有成效，只待朝廷嘉奖，十日内便可见第一批桑税。

你的幕僚低声提醒：

“大人，若这封奏疏先到内阁，巡抚便是功臣；若之后民怨爆发，您这个总督就是压不住局的人。”

你现在必须判断：是压下去，还是顺势利用？
```

这个消息同时完成：

```text
交代对方行动
制造剧情压力
说明对玩家的威胁
引出玩家决策
```

---

## 6.4 消息类型

### 1. 系统叙事消息

用于推进当天大势。

```text
改桑令已下三日，浙江各县执行不一。
米价连涨，民间怨声渐起。
京师催银的诏令再次传来。
```

字段：

```text
messageType = system_narration
decisionRequired = false
```

---

### 2. 其他角色行动消息

对手或 AI 角色的行动转译成剧情。

```text
【浙江巡抚 · 行动】

巡抚将改桑初成的奏疏送往京师。奏中只写桑田进展，不提粮价与民怨。

此举若成功，将提高巡抚在内阁中的声望，也会削弱你的统筹权威。
```

字段：

```text
messageType = role_action
sourceRole = 浙江巡抚
decisionRequired = possible
```

---

### 3. AI 角色反应消息

AI 角色根据局势触发反应。

```text
【清流县令 · 密信】

县令递来一封私信：

“粮价再涨，民恐不堪。另，巡抚与商会之间似有旧约，尚未取得实据。”
```

字段：

```text
messageType = ai_reaction
sourceRole = 清流县令
visibility = private
```

---

### 4. 私密情报消息

只有当前玩家看到。

```text
【密报】

你的幕僚查到，江南商会昨夜派人入织造局，疑似寻求司礼监保护。
```

字段：

```text
messageType = private_intel
visibility = private
targetRole = 浙江总督
```

---

### 5. 待决策消息

必须推动玩家决策。

```text
【待你决断】

巡抚奏疏已经送出。
如果你不处理，内阁可能只听到巡抚一面之词。

你要如何应对？
```

字段：

```text
messageType = decision_prompt
decisionRequired = true
```

---

### 6. 决策结果消息

玩家决策后的反馈。

```text
【你的决定已生效】

你没有截留巡抚奏疏，而是追加一封密奏入京。

奏中写道：

“浙江可改，然不可躁进。臣非不愿速成，实恐桑田未成而民心先裂。”

结果：
皇帝信任 +4
内阁疑心 +2
巡抚抢功效果被部分抵消
司礼监开始关注浙江奏报差异
```

字段：

```text
messageType = decision_result
sourceRole = 浙江总督
```

---

### 7. 日终回响消息

每天结束时生成。

```text
【第 3 天 · 日终回响】

你追加密奏之后，巡抚急奏的影响被削弱。

但京师同时收到两份口径不同的浙江奏报，司礼监开始注意到浙江内部并不一致。

粮价仍未回落。若明日再不处理，县令可能被迫公开民情。
```

字段：

```text
messageType = day_end
```

---

### 8. 最终裁决消息

第 7 天生成。

```text
【第 7 天 · 御前裁决】

七日之内，浙江未乱，但银也未足。

皇帝看完三路奏报，只问了一句：

“浙江是能臣稳局，还是上下合谋拖延？”

你的结局由此定下。
```

字段：

```text
messageType = final_judgement
```

---

# 7. 玩家决策系统

## 7.1 每条关键消息给 3 个默认选择 + 自定义

示例：

```text
【你要如何应对？】

A. 截留奏疏
派人追上驿站，暂扣巡抚奏疏。
可能收益：阻止巡抚抢功。
可能风险：巡抚反咬你压制国策。

B. 追加密奏
不阻止奏疏，但另写一封密奏给皇帝。
可能收益：保留解释权。
可能风险：内阁怀疑你越级自保。

C. 放任巡抚
让他继续抢功，等待他与商会绑定更深。
可能收益：未来可一并清算。
可能风险：巡抚短期声望上升。

D. 自定义决策
输入你的处理方式。
```

---

## 7.2 自定义决策

玩家可以输入：

```text
我不直接拦截巡抚奏疏，而是命幕僚抄录一份驿站登记，同时暗中联络清流县令，让他整理粮价和田契证据，准备在必要时配合我的密奏。
```

AI 需要判断：

```text
是否符合角色身份
是否符合历史背景
是否符合当前资源
是否越权
是否直接宣布结果
是否操控其他角色
是否破坏主线
```

---

## 7.3 ActionGuard 规则

允许：

```text
我准备派人追上驿站，试图确认巡抚奏疏内容。
```

不允许：

```text
我直接让巡抚认罪，并让皇帝处死他。
```

处理方式：

```text
ok：直接进入推演
soft_warn：提示风险，但允许
rewrite_needed：要求用户改写
blocked：禁止提交
```

---

# 8. AI 角色定位

## 8.1 AI 角色不是主动玩家

AI 角色不应该像真人玩家一样主动抢胜利。

AI 角色是：

> **局势参与者 / 反应器。**

它们行动只来自三种触发：

```text
1. 玩家影响到它
2. 主线事件推着它
3. 变量阈值触发它
```

---

## 8.2 AI 角色触发示例

```text
粮价 > 70
→ 清流县令请求开仓

巡抚声望被压制
→ 巡抚越级上奏

商会清算风险过高
→ 商会投靠司礼监

皇帝疑心 > 75
→ 司礼监入浙探查
```

---

## 8.3 AI 角色默认惯性

每个 AI 角色有默认倾向。

示例：

```text
浙江巡抚：
默认倾向：抢政绩、快推进、向内阁报功
触发压力：被总督压制、民怨扩大、商会切割
反应方式：越级上奏、拉商会、嫁祸县令

清流县令：
默认倾向：保护百姓、查田契、谨慎上报
触发压力：粮价过高、百姓请愿、总督不保护
反应方式：递密信、请开仓、保留账册副本

江南商会：
默认倾向：保现金流、拿政策特权、避免清算
触发压力：被查账、粮价失控、官府逼粮
反应方式：放粮交易、投靠司礼监、转移账册
```

---

# 9. 多人互动机制

## 9.1 对方决策如何变成我的剧情消息

对方玩家不显示为系统日志。

例如巡抚玩家选择：

```text
越级上奏，抢先向内阁报功。
```

总督玩家看到：

```text
【第 3 天 · 午后】

驿站传来消息，巡抚府有急奏北上。

奏中称浙江改桑已有成效，地方民情可控，若朝廷嘉奖及时，十日内便可见银。

你的幕僚提醒：

“大人，巡抚这是要先一步坐实功劳。若日后出事，他也可说自己早已尽力，是总督府压慢了局势。”
```

---

## 9.2 我的决策如何影响对方

总督玩家选择“追加密奏”。

巡抚玩家看到：

```text
【京师回声】

你派出的奏疏已抵达通政司。

但很快有消息传来：总督府也有一封密奏入京。内容未明，只知道其中提到了“粮价”“民心”“不可躁进”。

你的幕僚低声道：

“大人，总督没有拦你，但他在给自己留后手。若日后出事，他可能把你说成操切误国。”

你要如何应对？
```

---

## 9.3 MVP 先不做多人

多人机制先在数据结构和 AI 输出中预留。

MVP 只做：

```text
单人模式
其他角色由 AI 机器人触发反应
```

后续再做：

```text
多人异步消息流
玩家不在线时角色按默认惯性推进
玩家行动转译成他人剧情消息
```

---

# 10. 旧文档优秀能力如何保留

## 10.1 专属开场

每个角色有自己的第一幕。

在《桑田诏》中：

```text
浙江总督：
你刚收到两封文书。一封来自京师，催浙江十日见银；一封来自海防，称军饷再欠，军心难稳。

浙江巡抚：
你已拟好第一批改桑名册，只要送上京师，政绩便在眼前。

清流县令：
一个老农把田契放在你案前，说田还在，人却已经来量过三遍。

江南商会：
所有人都骂商人逐利，可所有人缺银时第一个想到的也是你。
```

---

## 10.2 命运问题

示例：

```text
浙江总督：
你是在保浙江，还是在保自己的官位？

浙江巡抚：
你是国策执行者，还是掠夺江南的刀？

清流县令：
当忠于朝廷和忠于百姓冲突时，你选谁？

江南商会：
你是大明财政的救命钱袋，还是江南百姓的吸血者？
```

---

## 10.3 三个回响

玩家决策后输出：

```text
个人回响：你的密奏给自己留下了解释权。
他人回响：巡抚发现你没有拦他，却开始怀疑你在京师留了后手。
世界回响：京师收到两份口径不同的浙江奏报，皇帝疑心上升。
```

---

## 10.4 跨角色影响

必须提示：

```text
你的追加密奏削弱了巡抚急奏的效果。
你的放粮交易降低了粮价，但让清流县令怀疑你与商会勾结。
你的保护县令行为让商会开始寻求司礼监保护。
```

---

## 10.5 延迟后果

示例：

```text
第 3 天你放任巡抚抢功。
第 5 天巡抚与商会绑定更深，暗账更完整。
第 6 天你可选择一次性反制。
```

---

## 10.6 最终个人故事卡

第 7 天生成：

```text
你的角色：浙江总督

最终下场：小胜

你的关键三手：
1. 第 3 天追加密奏，保留解释权
2. 第 4 天逼商会平粮，暂稳民心
3. 第 6 天放出暗账，反制巡抚

你影响了谁：
巡抚的升迁被你压住。
商会被迫站队。
县令暂时被你保护，但没有真正安全。

你的命运债：
你利用了县令的清名，却没有完全保护他。

你的主角类型：
稳局型权臣 / 借势者 / 不倒翁式能臣
```

---

# 11. 首个故事局：《桑田诏：嘉靖财政危局》

## 11.1 背景

嘉靖朝财政危局，国库缺银，朝廷要求浙江推进改稻为桑，以丝税补财政。

但政策落地牵动：

```text
皇帝
内阁
司礼监
浙江总督
浙江巡抚
清流县令
江南商会
乡绅百姓
海防军务
```

玩家控制：

```text
浙江总督
```

---

## 11.2 玩家目标

```text
稳住浙江
压住巡抚
防止皇帝疑你拖延
避免民乱
保住海防军心
尽可能提高自己的最终下场
```

---

## 11.3 7 天主线

```text
第 1 天：改桑令下
第 2 天：巡抚催政
第 3 天：粮价上涨
第 4 天：暗账浮出
第 5 天：互相弹劾
第 6 天：京师回批
第 7 天：御前裁决
```

---

## 11.4 核心世界变量

```text
国库银
民心
粮价
改桑进度
海防军心
皇帝信任
皇帝疑心
```

---

## 11.5 核心角色变量

浙江总督：

```text
权威
皇帝信任
内阁疑心
清算风险
升迁机会
民间声望
手中把柄
命运债
```

---

## 11.6 AI 角色

```text
浙江巡抚
清流县令
江南商会
司礼监织造使
内阁财政派
皇帝
```

---

# 12. Web 主页面设计

## 12.1 总体布局

```text
┌──────────────────────────────────────────────┐
│ 顶部：桑田诏 / 第3天 / 杭州总督府 / 距裁决4天 │
├──────────────┬───────────────────┬───────────┤
│ 左侧：我的信息 │ 中间：剧情消息流    │ 右侧：状态变化 │
│              │ 当前决策区          │           │
└──────────────┴───────────────────┴───────────┘
```

---

## 12.2 左侧：我的信息

左侧只回答：

```text
我是谁？
我要什么？
我有什么？
我怕什么？
```

内容：

```text
我的身份
我的命运问题
我的目标
我的资源
我的筹码
我的当前风险
```

---

## 12.3 中间：剧情消息流

中间是最重要的区域。

要求：

```text
可滚动
按天分组
消息像剧情，不像日志
当前待决策消息固定显示在底部
历史消息可回看
结果消息自动插入流中
```

---

## 12.4 中间消息卡样式

每条消息包含：

```text
消息类型标签
第几天
标题
正文剧情
说话者 / 来源
是否私密
是否需要决策
```

示例：

```text
【私密 · 第 3 天 · 午后】
标题：巡抚急奏北上

驿站快马离开杭州府……

你的幕僚低声提醒：
“大人，若这封奏疏先到内阁……”

【你要如何应对？】
A / B / C / 自定义
```

---

## 12.5 当前决策区

固定在中间底部。

包含：

```text
当前待决策标题
三个选项
收益 / 风险提示
自定义输入框
提交按钮
暂时观望按钮
```

按钮文案：

```text
确认此策
暂且观望
自拟密令
进入明日
```

---

## 12.6 右侧：状态变化

右侧只显示状态，不抢中间戏份。

内容：

```text
世界状态
人物关系
最新变化
当前风险
命运债
把柄 / 线索
```

---

# 13. Web 前端实现方式

## 13.1 当前唯一前端方案

继续使用现有仓库和现有 Web 应用：

```text
forwardFish/aiStoryRoom
apps/web
```

MVP 阶段明确不做：

```text
不新增 apps/player-web
不迁移 Next.js
不重写 React 架构
不同时维护两套正式 Web 前端
```

理由：当前优先验证 7 天决策、因果回溯、角色反应与最终裁决。技术栈迁移不能提升核心玩法验证质量。只有用户试玩指标达标后，才评估迁移到 Next.js。

## 13.2 当前技术栈

```text
apps/web：现有静态模块化 Web 前端
apps/api：NestJS
TypeScript：后端、共享类型与配置校验
CSS / 原生 ES Modules：当前 Web UI
```

长期可迁移到 Next.js + React + TypeScript，但不进入本 MVP。

## 13.3 页面路由

MVP 页面：

```text
/                  故事局大厅
/role-select?story=sangtian 角色选择页
/game?runId=:runId          正式游戏主页面
（结局在游戏页内展示）
```

可后置：

```text
/templates
/create
/roles
/history
```

---

## 13.4 前端组件

```text
GameLayout
TopGameBar
LeftPlayerPanel
StoryMessageStream
StoryMessageCard
DecisionPanel
DecisionOptionCard
CustomDecisionInput
RightStatePanel
StatusMeter
RelationshipList
RiskList
DayEndSummary
EndingPanel
```

---

# 14. 后端实现方式

## 14.1 当前仓库可复用内容

现有仓库中的以下内容继续保留：

```text
apps/api
prisma
packages/shared
packages/templates
AI provider mock / deepseek 结构
AuditLog
EventLog
StoryRun
StoryRole
RoleRelation
Clue
WorldStateSnapshot
AiTask
```

---

## 14.2 MVP 唯一运行态模型

MVP 只使用：

```text
StoryRun：当前快照
StoryEvent：追加式事件流
```

消息、玩家决策、状态补丁、角色反应、隐藏暗线、因果回溯和最终裁决统一作为 `StoryEvent.type` 表达。

当前不新增独立的 `StoryMessage` 和 `PlayerDecision` 表。接入真实模型后增加 `AiTask` 记录 AI 调用账本；多人异步阶段再增加 `StoryPlayer` 和 `MessageDelivery`。

## 14.3 Prisma 建议

```prisma
model StoryRun {
  id              String       @id @default(cuid())
  templateKey     String
  userId          String?
  mode            String       @default("single")
  status          String       @default("created")
  currentDay      Int          @default(1)
  totalDays       Int          @default(7)
  selectedRoleKey String       @default("zhejiang_governor")
  stateJson       Json
  version         Int          @default(1)
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  events          StoryEvent[]

  @@index([templateKey])
  @@index([userId])
  @@index([status])
}

model StoryEvent {
  id          String   @id @default(cuid())
  runId       String
  run         StoryRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  day         Int
  type        String
  messageType String?
  roleKey     String?
  visibility  String   @default("private")
  payloadJson Json
  createdAt   DateTime @default(now())

  @@index([runId, day, createdAt])
  @@index([runId, type])
  @@index([runId, messageType])
}
```

`stateJson` 保存 worldState、roleState、relationships、risks、clues、fateSeeds、evidenceLedger、responsibilityLedger、narrativeFrames、roleDecisionModels、daySummaries 和 finalJudgementInputs。

## 14.4 新增 API

使用 `/api/v4` 或直接新增现有路径均可。推荐版本化：

```http
POST /api/v4/story-runs
GET  /api/v4/story-runs/:runId
GET  /api/v4/story-runs/:runId/dashboard
GET  /api/v4/story-runs/:runId/messages
POST /api/v4/story-runs/:runId/messages/:eventId/decisions
POST /api/v4/story-runs/:runId/advance-day
POST /api/v4/story-runs/:runId/finalize
```

---

## 14.5 API 说明

### 创建游戏

```http
POST /api/v4/story-runs
```

请求：

```json
{
  "templateKey": "sangtian",
  "mode": "single",
  "selectedRoleKey": "zhejiang_governor"
}
```

返回：

```json
{
  "runId": "run_xxx",
  "currentDay": 1,
  "totalDays": 7
}
```

---

### 获取剧情消息流

```http
GET /api/v4/story-runs/:runId/messages
```

返回：

```json
{
  "messages": []
}
```

---

### 提交决策

```http
POST /api/v4/story-runs/:runId/messages/:eventId/decisions
```

请求：

```json
{
  "optionKey": "B",
  "customText": null
}
```

或：

```json
{
  "optionKey": "CUSTOM",
  "customText": "我不拦奏疏，但命幕僚抄录驿站文书，并让县令整理粮价证据。"
}
```

返回：

```json
{
  "decisionId": "dec_xxx",
  "resultMessage": {},
  "stateChanges": {},
  "newMessages": []
}
```

---

### 获取右侧状态

```http
GET /api/v4/story-runs/:runId/dashboard
```

返回：

```json
{
  "worldState": {},
  "roleState": {},
  "relationships": [],
  "latestChanges": [],
  "risks": [],
  "clues": []
}
```

---

### 推进到明天

```http
POST /api/v4/story-runs/:runId/advance-day
```

返回：

```json
{
  "currentDay": 4,
  "newMessages": []
}
```

---

# 15. AI 推演实现

## 15.1 AI 不是自由写故事

AI 必须输出结构化 JSON。

核心函数：

```text
generateDayMessagesWithDirector
resolveDecisionWithDirector
generateDayEndWithDirector
generateFinalJudgementWithDirector
validateCustomDecisionWithJudge
```

---

## 15.2 生成当天剧情消息

输入：

```json
{
  "storyName": "桑田诏：嘉靖财政危局",
  "day": 3,
  "playerRole": "浙江总督",
  "worldState": {},
  "roleState": {},
  "relationships": [],
  "clues": [],
  "hiddenThreads": [],
  "previousSummary": ""
}
```

输出：

```json
{
  "messages": [
    {
      "messageType": "system_narration",
      "title": "粮价三日连涨",
      "narrative": "改桑令已下三日……",
      "decisionRequired": false
    },
    {
      "messageType": "decision_prompt",
      "title": "巡抚急奏北上",
      "narrative": "驿站快马离开杭州府……",
      "decisionRequired": true,
      "options": []
    }
  ]
}
```

---

## 15.3 决策推演

输入：

```json
{
  "message": {},
  "decision": {},
  "worldState": {},
  "roleState": {},
  "relationships": {},
  "hiddenThreads": {}
}
```

输出：

```json
{
  "resultMessage": {
    "title": "你的密奏已送出",
    "narrative": "你没有截留巡抚奏疏，而是连夜起草密奏……"
  },
  "stateChanges": {
    "皇帝信任": 4,
    "内阁疑心": 2,
    "浙江巡抚_敌意": 3
  },
  "relationshipChanges": [],
  "newClues": [],
  "newMessages": [],
  "hiddenThreads": [],
  "dayCanEnd": false
}
```

---

## 15.4 自定义决策校验

Prompt 要求：

```text
你是 AI 多人局的决策裁判。
你要判断玩家自定义决策是否符合当前角色身份、时代背景、资源边界和剧情阶段。
玩家只能声明自己的行动意图，不能宣布结果，不能操控其他角色，不能跳过剧情，不能凭空获得不存在的权力或证据。
如果不合法，给出可执行改写建议。
```

输出：

```json
{
  "allowed": true,
  "severity": "ok",
  "normalizedDecision": "不拦截巡抚奏疏，但追加密奏，并让县令整理粮价证据。",
  "reason": ""
}
```

---

# 16. 成本控制

## 16.1 MVP 可以先半脚本化

《桑田诏》7 天主线可以先写好骨架：

```text
第 1 天：改桑令下
第 2 天：巡抚催政
第 3 天：粮价上涨
第 4 天：暗账浮出
第 5 天：互相弹劾
第 6 天：京师回批
第 7 天：御前裁决
```

每天的关键消息可模板化，AI 负责根据状态变量润色和调整。

---

## 16.2 模型调用控制

每次玩家决策不要把全量历史都发给 AI。

传：

```text
当前 day
当前 message
玩家角色状态
世界变量
最近 3 条消息摘要
关键历史决策摘要
隐藏暗线摘要
```

---

## 16.3 消息摘要机制

每一天结束后生成：

```text
daySummary
importantDecisions
stateChangeSummary
hiddenThreadSummary
```

后续只传摘要，不传完整消息流。

---

# 17. 实施路线

## 17.1 Sprint 0：文档与仓库整理

任务：

```text
把 v4 PRD 放入 docs/
使用 agent/web-mvp-three-pages 或后续指定开发分支
暂停 miniprogram 开发
确认 apps/web 为唯一正式 MVP 前端
```

---

## 17.2 Sprint 1：静态 Web Demo

目标：

```text
不用 API，先做静态页面，验证中间剧情消息流体验。
```

任务：

```text
搭建 Web 页面
实现三栏布局
实现剧情消息流
实现当前决策区
实现右侧状态变化 mock
实现《桑田诏》第 3 天样例
```

验收：

```text
用户一眼知道：中间是游戏现场
可以看到剧情消息
可以选择 A/B/C
选择后右侧状态变化
```

---

## 17.3 Sprint 2：Mock API

目标：

```text
Web 页面接入后端 mock。
```

任务：

```text
以 StoryRun + StoryEvent 实现运行态
新增 v4 API
实现 demo run
实现 messages/dashboard/decision mock
```

---

## 17.4 Sprint 3：7 天单人闭环

目标：

```text
完整跑完《桑田诏》7 天。
```

任务：

```text
实现 day progression
实现每日消息生成
实现决策提交
实现日终回响
实现最终裁决
```

---

## 17.5 Sprint 4：接入 AI 推演

目标：

```text
把 mock 结果替换为 AI 结构化输出。
```

任务：

```text
新增 director-provider v4 函数
接 DeepSeek / mock
实现 JSON schema 校验
实现 fallback
实现 ActionGuard
```

---

## 17.6 Sprint 5：状态系统增强

任务：

```text
世界变量更新
人物关系更新
把柄系统
隐藏暗线
命运债
最终个人故事卡
```

---

# 18. 验收标准

## 18.1 Web MVP 必须满足

```text
能创建《桑田诏》单人故事局
能进入 Web 游戏主页面
中间显示剧情消息流
关键消息给出 3 个选择 + 自定义输入
玩家选择后生成结果消息
右侧状态发生变化
每天能推进
第 7 天能生成最终裁决
最终有个人结局和全局结局
```

---

## 18.2 体验验收

用户必须感知到：

```text
我不是在读故事
我是在局里做决策
对方的行动变成了剧情压力
我的选择改变了世界状态
我的选择会影响别人的剧情
每一天都逼近最终裁决
```

---

# 19. 未来平台化扩展

MVP 验证后，逐步扩展。

## 19.1 多故事局

```text
桑田诏：历史权谋
融资前夜：商战
晋升名单公布前：职场
午夜便利店：悬疑
青云宗门：宗门权谋
```

## 19.2 多人异步

```text
真人玩家选择不同角色
每人看到自己的消息流
别人决策转译成自己的剧情消息
玩家不在线时按默认惯性推进
```

## 19.3 长期共创

保留旧文档长期方向：

```text
StoryWorld = Repo
CharacterArc = Branch
PlayerDecision = Commit
CandidateStory = Pull Request
CanonEnding = Merge
WorldIssue = Issue
AI Director = Reviewer + CI
```

但这些不进入 MVP。

---

# 20. 给 Codex / 开发的最终执行指令

```text
请在现有 forwardFish/aiStoryRoom 仓库中开发 Web MVP。

不要新建独立仓库。
不要继续优先开发小程序。
不要按旧的 SceneNode 全员行动统一结算作为主体验。
本版本核心是“剧情消息驱动的动态决策游戏”。

优先完成：
1. 继续重构 apps/web；不新增 apps/player-web，不在 MVP 阶段迁移 Next.js。
2. 实现三栏游戏主页面：
   - 左侧：我的身份、目标、资源、筹码、风险
   - 中间：剧情消息流 + 当前决策区
   - 右侧：世界状态、人物关系、最新变化、当前风险
3. 运行态统一使用 StoryRun + StoryEvent；消息和决策分别作为 StoryEvent.type 表达。
4. 新增 v4 API：
   - GET /api/v4/story-runs/:runId/messages
   - POST /api/v4/story-runs/:runId/messages/:eventId/decisions
   - GET /api/v4/story-runs/:runId/dashboard
   - POST /api/v4/story-runs/:runId/advance-day
   - POST /api/v4/story-runs/:runId/finalize
5. 首个故事局只做《桑田诏：嘉靖财政危局》。
6. MVP 只做单人模式：
   - 玩家控制浙江总督
   - 其他角色由 AI 机器人根据局势触发反应
7. 使用 7 天制：
   - 每天 3-5 条剧情消息
   - 第 1—6 天每天固定 2 个关键决策，共 12 个
   - 每条关键消息 3 个选项 + 自定义决策
   - 第 7 天生成最终裁决
8. AI 输出必须结构化 JSON。
9. 自定义决策必须经过 ActionGuard。
10. 每次决策必须更新状态并生成结果消息。
11. 不做小程序、不做多人实时、不做复杂地图、不做付费、不做社区。
```

---

# 21. 最终判断

本产品当前阶段最重要的不是“AI 能不能写出漂亮小说”。

最重要的是验证：

> **用户是否愿意在剧情消息流中不断做决策，并因为看到局势变化而继续玩下去。**

一句话：

> **AI 多人局不是单个游戏，而是一个可扩展的 AI 动态局势推演平台；Web MVP 先用《桑田诏》验证“剧情消息 → 决策 → 状态变化 → 新消息 → 最终裁决”的核心循环。**
