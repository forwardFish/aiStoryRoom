# AI 多人局｜AI 判定与剧情推演系统设计 v1.0

> 适用项目：AI 多人局 / 《桑田诏：嘉靖财政危局》  
> 文档类型：AI 推演引擎 / 判定系统 / 结构化输出规范 / 开发实现说明  
> 核心目标：让玩家每天的选择在未来合理地帮助自己或吞噬自己，并在最终裁决时能清楚解释因果来源。  
> 总原则：**AI 负责推演，系统负责记账；玩家看到的是剧情压力，后台保存的是因果账本。**

---

## 0. 为什么需要这个系统

普通 AI 剧情推演容易出现三个问题：

```text
1. 当下剧情好看，但几天后反噬不清楚。
2. 角色突然做出不符合身份的反应。
3. 最终结局像 AI 编的，不像玩家一步步推出来的。
```

本系统要解决的是：

```text
玩家第 1 天做了一个选择
↓
系统记录这个选择留下的痕迹
↓
第 3 天这个痕迹可能帮他
↓
第 5 天同一个痕迹可能被别人重新定性，反过来伤他
↓
第 7 天最终裁决时，AI 能清楚说明：哪几步救了他，哪几步害了他
```

这不是单纯“剧情生成系统”，而是一个：

```text
权谋因果推演系统
```

---

## 1. 核心设计原则

### 1.1 前台简单，后台复杂

玩家前台只看：

```text
我是谁
我面对什么压力
我手里有什么资源 / 筹码
我现在可以怎么做
选择后世界发生了什么变化
```

玩家不应该一开始看到：

```text
全部隐藏目标
全部触发条件
未来第几天会反噬
谁会拿什么证据咬他
```

这些放在后台。

---

### 1.2 每个选择都留下痕迹

游戏的核心规则：

> **每个选择都会留下痕迹。痕迹在未来可能变成证据、筹码、恩情、罪名或救命稻草。**

例如：

```text
第 1 天：你私下见商会，只听不许。

当下：你获得商会粮银渠道。
第 3 天：粮价上涨时，商会愿意和你谈放粮。
第 4 天：县令知道商会进过总督府，开始不完全信任你。
第 5 天：商会被查时，拿出当日入府记录自保。
第 7 天：皇帝认为你能用商人稳局，但也不可不防。
```

---

### 1.3 AI 不能自由乱写，必须引用因果锚点

任何未来反噬或帮助，都必须能追溯到：

```text
originEventId
originDecisionId
originDay
originAction
```

也就是说，AI 不能凭空说：

```text
县令突然不信任你。
```

必须写成：

```text
县令不信任你，是因为：
第 2 天你要求他把证据先送总督府；
第 3 天你又私下与商会换粮。
这两件事合在一起，让县令怀疑你不是要清弊，而是要控制清弊。
```

---

### 1.4 同一行为可以有多种定性

权谋局不是“行为本身决定结果”，而是“行为如何被不同人重新解释”。

例如：商会放粮。

```text
总督定性：临时平粮，稳住民心。
商会定性：为朝廷分忧，应获保护。
县令定性：官商私下交易。
巡抚定性：巡抚府推动商会配合。
司礼监定性：江南银路可由内廷掌控。
```

因此系统必须记录：

```text
NarrativeFrame / 叙事定性
```

---

## 2. AI 判定系统总架构

```text
玩家决策输入
↓
ActionGuard：合法性校验
↓
DecisionInterpreter：意图解析
↓
DirectorResolver：即时结果推演
↓
FateSeedEngine：生成命运伏笔
↓
EvidenceLedger：记录证据流向
↓
ResponsibilityLedger：记录责任流向
↓
NarrativeFrameEngine：生成多方定性
↓
RoleReactionEngine：生成其他角色反应
↓
StoryEventWriter：写入事件流
↓
DayEndSummarizer：日终摘要
↓
FinalJudge：最终裁决
```

---

## 3. 核心模块说明

## 3.1 ActionGuard：行动合法性裁判

### 作用

判断玩家自定义决策是否：

```text
符合身份
符合时代背景
符合当前资源
不越权
不直接宣布结果
不操控其他角色
不跳过剧情阶段
```

### 输入

```json
{
  "runId": "run_001",
  "day": 3,
  "roleKey": "zhejiang_governor",
  "currentMessage": {},
  "customDecisionText": "我命人直接杀掉巡抚，并伪造成病死。",
  "stateJson": {},
  "availableResources": ["密奏权", "调粮权", "幕僚4人"]
}
```

### 输出

```json
{
  "allowed": false,
  "severity": "blocked",
  "reason": "浙江总督无权私下处死巡抚；该行动越过角色权力边界，也直接宣布了其他角色结果。",
  "rewriteSuggestion": "你可以改为：暗中搜集巡抚与商会往来的证据，再以执行过激、扰动民心为由向朝廷密奏，请求问责。",
  "normalizedDecision": null
}
```

### 可选状态

```text
ok：合法
soft_warn：合法但有明显风险
rewrite_needed：需要用户改写
blocked：禁止执行
```

---

## 3.2 DecisionInterpreter：玩家意图解析器

### 作用

把玩家选择转成结构化语义，方便后续推演。

### 需要识别的内容

```text
玩家表面动作
玩家真实意图
使用的资源
影响对象
公开程度
是否留下证据
是否制造新风险
是否影响未来裁决
```

### 输出示例

玩家输入：

```text
我不截留巡抚奏疏，但另写一封密奏给皇帝，说明浙江粮价已动，改桑不可躁进。
```

结构化结果：

```json
{
  "actionType": "secret_memorial",
  "surfaceAction": "追加密奏，不截留巡抚奏疏",
  "strategicIntent": "保留未来解释权，同时避免公开阻挠国策",
  "usedResources": ["密奏权", "幕僚起草"],
  "targetRoles": ["皇帝", "浙江巡抚", "内阁财政派", "司礼监"],
  "publicVisibility": "hidden_to_local_roles_visible_to_emperor",
  "evidenceCreated": ["总督密奏", "通政司递送记录"],
  "riskTags": ["越级自保", "奏报口径不一", "内阁疑心"],
  "benefitTags": ["保留解释权", "削弱巡抚抢功", "预警民心风险"]
}
```

---

## 3.3 DirectorResolver：即时剧情推演器

### 作用

生成玩家当下能看到的结果。

它只负责“这一刻发生什么”，不负责最终裁决。

### 输出内容

```text
1. 玩家结果消息
2. 明面状态变化
3. 人物关系变化
4. 可见风险提示
5. 影响其他角色的剧情消息
```

### 输出示例

```json
{
  "resultMessage": {
    "title": "你的密奏已送出",
    "narrative": "你没有截留巡抚奏疏，而是让幕僚连夜起草密奏。奏中不指责巡抚，只写浙江可改，然不可躁进。",
    "visibleEcho": {
      "personal": "你为自己留下了未来解释权。",
      "others": "巡抚若得知此事，会意识到你没有拦他，却在京师留了后手。",
      "world": "京师将收到两份口径不同的浙江奏报。"
    }
  },
  "statePatch": {
    "皇帝信任": 4,
    "内阁疑心": 2,
    "巡抚敌意": 3,
    "司礼监警惕": 8
  },
  "visibleHints": [
    "奏报口径开始分裂。",
    "这一步能保留解释权，也可能被内阁视作越级自保。"
  ]
}
```

---

## 3.4 FateSeedEngine：命运伏笔引擎

这是本系统最关键的部分。

### 作用

每次关键选择后，生成“未来可能帮助或吞噬玩家”的隐藏伏笔。

### FateSeed 字段

```json
{
  "id": "seed_day3_secret_memorial",
  "originEventId": "evt_day3_decision_001",
  "originDay": 3,
  "title": "总督密奏",
  "visibleHint": "你没有拦巡抚，却在京师留下了自己的口径。",
  "hiddenMeaning": "总督建立了浙江不可躁进的叙事口径，但也绕开内阁形成越级自保嫌疑。",
  "helpTriggers": [],
  "backfireTriggers": [],
  "status": "dormant",
  "evidenceIds": [],
  "relatedRoles": ["皇帝", "浙江巡抚", "内阁财政派", "司礼监"]
}
```

---

### FateSeed 三种状态

```text
dormant：已埋下，尚未触发
activated_help：以帮助形式触发
activated_backfire：以反噬形式触发
converted：被玩家主动转化
expired：过期，不再触发
```

---

### 示例：私下见商会

```json
{
  "id": "seed_day1_private_merchant_meeting",
  "originDay": 1,
  "originEventId": "evt_day1_decision_merchant",
  "title": "商会入府",
  "visibleHint": "这场私下会面没有留下文书，但看见的人未必少。",
  "hiddenMeaning": "商会将总督视为潜在保护伞，县令眼线也注意到商会入府。",
  "helpTriggers": [
    {
      "condition": "粮价 >= 60 && 商会依赖 >= 45",
      "effect": "商会愿意放粮谈判。",
      "triggerMessage": "第 1 天你没有拒绝商会，今日粮价上涨时，商会仍愿与你谈。"
    }
  ],
  "backfireTriggers": [
    {
      "condition": "县令信任 <= 50 && 暗账完整度 >= 40",
      "effect": "县令怀疑总督与商会有交易，开始保留证据副本。",
      "triggerMessage": "县令的人早已知道商会入过总督府。今日你再要求证据先送府，他开始犹豫。"
    },
    {
      "condition": "商会清算风险 >= 60",
      "effect": "商会拿出总督府传话记录自保。",
      "triggerMessage": "商会被查时，账房拿出当日入府记录，称自己是替总督府稳粮。"
    }
  ],
  "relatedEvidence": ["merchant_visit_record", "gate_witness", "grain_release_log"]
}
```

---

## 3.5 EvidenceLedger：证据流向账本

### 作用

记录谁掌握了什么证据，证据是否真实、完整、可公开、可伪造、可反咬。

### EvidenceItem 结构

```json
{
  "id": "evidence_day2_land_contract_copy",
  "title": "嘉兴田契副本",
  "type": "land_contract",
  "truthLevel": "partial",
  "completeness": 45,
  "holderRoles": ["清流县令"],
  "knownByRoles": ["清流县令"],
  "suspectedByRoles": ["浙江总督", "浙江巡抚"],
  "canIncriminate": ["江南商会", "浙江巡抚"],
  "canBackfireOn": ["清流县令", "浙江总督"],
  "publicRisk": "若过早公开，可能被反咬为伪造或煽民。",
  "originEventId": "evt_day2_county_letter"
}
```

---

## 3.6 ResponsibilityLedger：责任流向账本

### 作用

权谋局最终不是问“谁好谁坏”，而是问“谁承担责任”。

责任流向记录：一件事出事后，锅最容易落到谁身上。

### ResponsibilityNode 结构

```json
{
  "id": "resp_grain_price_rise_day3",
  "issue": "杭州粮价上涨",
  "possibleResponsibleRoles": [
    {
      "roleKey": "zhejiang_governor",
      "liability": 45,
      "reason": "总督统筹浙江军政，未及时平粮。"
    },
    {
      "roleKey": "xunfu",
      "liability": 55,
      "reason": "巡抚催三县名册，刺激粮价预期。"
    },
    {
      "roleKey": "merchant",
      "liability": 65,
      "reason": "商会疑似囤粮观望。"
    }
  ],
  "currentDominantFrame": "商会囤粮与巡抚催政共同导致粮价上涨",
  "canBeReframedBy": {
    "zhejiang_governor": "地方执行过急，商会趁机控粮",
    "xunfu": "总督府调度迟缓，商会不服统筹",
    "merchant": "商会只是被政策预期裹挟，真正责任在官府催政"
  }
}
```

---

## 3.7 NarrativeFrameEngine：叙事权 / 定性引擎

### 作用

同一事件，不同角色会用不同说法解释。

### NarrativeFrame 结构

```json
{
  "eventId": "evt_day3_merchant_grain_release",
  "eventTitle": "商会放粮",
  "frames": [
    {
      "roleKey": "zhejiang_governor",
      "frame": "临时平粮，稳住民心",
      "visibility": "private"
    },
    {
      "roleKey": "merchant",
      "frame": "商会为朝廷分忧，应获保护",
      "visibility": "private"
    },
    {
      "roleKey": "county_magistrate",
      "frame": "总督府与商会达成交易",
      "visibility": "private"
    },
    {
      "roleKey": "xunfu",
      "frame": "总督抢夺商会资源，暗中布局",
      "visibility": "private"
    },
    {
      "roleKey": "sili_jian",
      "frame": "商会银路可被内廷吸纳",
      "visibility": "hidden"
    }
  ],
  "dominantFrame": "暂未形成统一定性"
}
```

---

## 3.8 RoleReactionEngine：角色反应引擎

### 作用

根据角色身份、当前利益、已知信息、误判、风险阈值，生成其他角色反应。

### 角色反应输入

```json
{
  "roleKey": "county_magistrate",
  "knownEvents": ["商会放粮", "商会入总督府"],
  "privateGoal": "查清官商夺田，保护百姓",
  "trustTowardGovernor": 48,
  "currentPressure": ["粮价", "田契异常", "总督与商会接触"],
  "availableActions": ["继续交证据", "保留副本", "公开民情", "越级上报"]
}
```

### 角色反应输出

```json
{
  "chosenAction": "保留副本，只交部分证据给总督",
  "surfaceReason": "证据尚不完整，需继续核实。",
  "hiddenReason": "县令怀疑总督可能利用证据控制商会，而不是彻底清弊。",
  "messageToSelf": {
    "title": "粮价暂缓后的疑心",
    "narrative": "商会放粮之后，民心暂缓。但你的人看见商会会首入过总督府后门。你不知道总督是在稳民心，还是已经与商会达成交易。"
  },
  "eventsCreated": ["evt_county_keeps_copy"],
  "statePatch": {
    "县令信任": -8,
    "暗账完整度": 5
  }
}
```

---

## 3.9 DayEndSummarizer：日终因果摘要

### 作用

每天结束时，不只是总结剧情，还要压缩当天因果，为后续 AI 调用减负。

### 输出结构

```json
{
  "day": 3,
  "publicSummary": "粮价上涨，巡抚急奏北上，总督追加密奏，商会放粮稳市。",
  "playerKeyDecisions": [
    {
      "eventId": "evt_day3_secret_memorial",
      "summary": "总督追加密奏，保留解释权。"
    },
    {
      "eventId": "evt_day3_merchant_deal",
      "summary": "总督私下用商会放粮稳住民心。"
    }
  ],
  "stateChangeSummary": [
    "粮价下降",
    "司礼监警惕上升",
    "县令信任下降",
    "商会依赖上升"
  ],
  "activeFateSeeds": [
    "seed_day3_secret_memorial",
    "seed_day3_merchant_grain_deal"
  ],
  "riskForTomorrow": [
    "县令可能保留副本",
    "巡抚可能向内阁反咬总督拖延",
    "司礼监可能介入银路"
  ]
}
```

---

## 3.10 FinalJudge：最终裁决系统

### 作用

第 7 天根据：

```text
世界状态
关键决策
命运伏笔
证据流向
责任流向
叙事定性
皇帝优先级
```

生成：

```text
全局结局
玩家个人结局
关键三手
吞噬自己的三步
命运债
未来余波
```

---

## 4. 每次玩家决策的完整处理流程

```text
1. 接收玩家选择 / 自定义输入
2. ActionGuard 校验合法性
3. DecisionInterpreter 解析动作语义
4. DirectorResolver 生成即时结果
5. FateSeedEngine 生成 / 更新命运伏笔
6. EvidenceLedger 更新证据流向
7. ResponsibilityLedger 更新责任流向
8. NarrativeFrameEngine 生成多方定性
9. RoleReactionEngine 生成其他角色反应
10. StoryEventWriter 写入事件流
11. Dashboard 更新右侧状态
12. 前台只展示玩家可见内容
```

---

## 5. AI 输出总 JSON Schema

每次决策后 AI 必须输出：

```json
{
  "guard": {
    "allowed": true,
    "severity": "ok",
    "reason": "",
    "normalizedDecision": ""
  },
  "decisionInterpretation": {
    "actionType": "",
    "surfaceAction": "",
    "strategicIntent": "",
    "usedResources": [],
    "targetRoles": [],
    "publicVisibility": "",
    "evidenceCreated": [],
    "riskTags": [],
    "benefitTags": []
  },
  "immediateResult": {
    "resultMessage": {
      "title": "",
      "narrative": "",
      "visibleEcho": {
        "personal": "",
        "others": "",
        "world": ""
      }
    },
    "statePatch": {},
    "relationshipPatch": [],
    "visibleHints": []
  },
  "fateSeeds": {
    "created": [],
    "updated": [],
    "triggered": []
  },
  "evidenceLedgerUpdates": [],
  "responsibilityLedgerUpdates": [],
  "narrativeFrames": [],
  "roleReactions": [],
  "newStoryEvents": [],
  "dashboardPatch": {
    "latestChanges": [],
    "risks": [],
    "clues": []
  }
}
```

---

## 6. 玩家可见与后台隐藏的边界

### 6.1 玩家可见

```text
剧情消息
当前压力
选项收益 / 风险
结果消息
状态变化
模糊暗线提示
日终回响
最终因果解释
```

### 6.2 玩家不可见

```text
完整 FateSeed 条件
其他角色真实隐藏动机
完整证据流向
责任链权重
未来触发条件
AI 私密推理
未公开角色消息
```

---

## 7. 前台暗线提示规则

后台可以知道具体触发条件，但前台只能模糊提示。

### 错误写法

```text
第 5 天巡抚会用这件事弹劾你。
```

### 正确写法

```text
这一步没有激起明面冲突，但奏报与田契之间的缝隙，已经被人看见了。
```

或：

```text
商会放粮暂缓了粮价，但门房记下了今晚入府的人。
```

---

## 8. 因果回溯消息规则

当伏笔触发时，必须告诉玩家：

```text
这不是随机发生的。
它来自你之前的某个选择。
```

### 模板

```text
【因果回响】

这件事并非凭空而来。

第 X 天，你曾经……
第 Y 天，你又……
这些选择在当时分别有合理理由。

但现在，它们被某个角色重新串联成另一种说法：
“……”

因此，今日出现了新的压力：……
```

---

## 9. 典型决策样例

## 9.1 表面同意，私下查田契

### 当下帮助

```text
避免公开抗旨。
不立刻激怒巡抚。
启动暗账线索。
```

### 未来帮助

```text
第 4 天若拿到田契副本，可反制巡抚与商会。
```

### 未来反噬

```text
如果巡抚发现暗查，可将你定性为“明面奉诏，暗中掣肘”。
```

---

## 9.2 追加密奏

### 当下帮助

```text
保留解释权。
不公开截留巡抚。
给皇帝预警浙江风险。
```

### 未来帮助

```text
如果粮价、暗账、民怨后来坐实，密奏证明你早已预警。
```

### 未来反噬

```text
如果改桑进度低、国库银不足，内阁会说你越级自保、拖延国策。
```

---

## 9.3 私下用商会放粮

### 当下帮助

```text
粮价下降。
民心暂稳。
不用消耗官仓和海防粮。
```

### 未来帮助

```text
商会在后续财政压力中可成为垫银来源。
```

### 未来反噬

```text
县令怀疑官商交易。
商会被查时会拿总督府传话自保。
司礼监可能把商会银路吸走。
```

---

## 9.4 保护县令继续查账

### 当下帮助

```text
暗账完整度上升。
获得清弊路线。
县令愿意继续送信。
```

### 未来帮助

```text
第 6 天可用完整证据切割巡抚和商会。
```

### 未来反噬

```text
巡抚可指控总督利用县令扰乱国策。
如果县令公开民情，局势可能失控。
```

---

## 10. 最终裁决流程

最终裁决不是一次 AI 总结，而是五步判断。

```text
1. 世界结局判断
2. 责任归属判断
3. 叙事权判断
4. 玩家个人命运判断
5. 因果解释生成
```

---

## 10.1 世界结局判断

看：

```text
国库银
民心
粮价
改桑进度
海防军心
皇帝信任
皇帝疑心
司礼监介入
暗账完整度
```

输出：

```text
桑田成，民心裂
国策缓行，清弊得名
商人救国，商人控局
总督稳局，帝心生疑
无人胜利，替罪羊诞生
```

---

## 10.2 责任归属判断

对每个角色生成责任分：

```json
{
  "zhejiang_governor": {
    "merit": 65,
    "liability": 45,
    "keyReasons": ["稳住粮价", "保留密奏解释权", "与商会有交易痕迹"]
  },
  "xunfu": {
    "merit": 50,
    "liability": 70,
    "keyReasons": ["急奏报功", "推动三县名册", "暗账牵连"]
  },
  "merchant": {
    "merit": 45,
    "liability": 75,
    "keyReasons": ["放粮稳市", "提前圈田", "求司礼监保护"]
  }
}
```

---

## 10.3 叙事权判断

判断谁的说法最后被接受。

```json
{
  "dominantNarrative": "浙江可改，但地方执行腐败，需缓行清弊。",
  "acceptedBy": ["皇帝", "部分内阁", "清流县令"],
  "rejectedNarratives": [
    "巡抚：总督拖延国策",
    "商会：商会单纯为朝廷分忧"
  ]
}
```

---

## 10.4 玩家个人命运判断

### 结局档位

```text
S：大胜，东南重臣
A：小胜，明升暗防
B：平局，保命失势
C：小败，罢官归乡
D：大败，问罪清算
E：极败，下狱 / 杀头
```

### 判断逻辑

```text
如果浙江稳住 + 皇帝信任高 + 清算风险低 → 大胜 / 小胜
如果浙江稳住但皇帝疑心高 → 明升暗防
如果浙江未乱但功劳被他人分走 → 保命失势
如果浙江没见银且总督被定性为拖延 → 罢官
如果粮价失控 / 奏报矛盾 / 无替罪羊 → 问罪清算
如果民乱 + 欺君证据 + 清算风险极高 → 下狱 / 杀头
```

---

## 10.5 最终裁决输出 Schema

```json
{
  "globalEnding": {
    "title": "国策缓行，清弊得名",
    "narrative": "暗账入京后，皇帝没有废改桑，但下令浙江暂缓三县急推，重核田亩。"
  },
  "personalEnding": {
    "rank": "A",
    "title": "明升暗防",
    "narrative": "你稳住了浙江，也没有让皇帝觉得你完全拖延。但你使用商会平粮，又让司礼监看到你可用商人控局，因此你被升迁，也被盯防。"
  },
  "keyMovesThatSavedYou": [
    {
      "originEventId": "evt_day3_secret_memorial",
      "text": "第 3 天追加密奏，让皇帝相信你早已预警民心风险。"
    },
    {
      "originEventId": "evt_day4_protect_clerk",
      "text": "第 4 天保护书吏，让暗账证据链得以补全。"
    }
  ],
  "keyMovesThatHurtYou": [
    {
      "originEventId": "evt_day3_merchant_deal",
      "text": "第 3 天私下用商会平粮，稳定了粮价，也留下官商交易痕迹。"
    }
  ],
  "fateDebt": [
    "你利用了县令的清名，却没有完全保护他。",
    "你借商会稳住粮价，也让商会获得了向内廷邀功的机会。"
  ],
  "emperorJudgement": "此人可用，不可纵。",
  "futureAftermath": "你被调任东南军务重臣，名义升迁，实际被内阁与司礼监共同盯防。"
}
```

---

## 11. AI Prompt 模板

## 11.1 ActionGuard Prompt

```text
你是 AI 多人局的行动裁判。

你要判断玩家的自定义决策是否符合：
1. 当前角色身份
2. 当前时代背景
3. 当前资源和权力边界
4. 当前剧情阶段
5. 不能直接宣布结果
6. 不能操控其他角色
7. 不能跳过系统裁决

请输出严格 JSON：
{
  "allowed": boolean,
  "severity": "ok" | "soft_warn" | "rewrite_needed" | "blocked",
  "reason": string,
  "normalizedDecision": string | null,
  "rewriteSuggestion": string | null
}
```

---

## 11.2 DecisionResolver Prompt

```text
你是《桑田诏：嘉靖财政危局》的 AI 权谋导演。

这不是小说续写。
这不是聊天。
这是一个历史财政危机下的多人命运推演局。

你必须根据：
- 当前剧情消息
- 玩家角色身份
- 玩家决策
- 当前世界变量
- 人物关系
- 已激活 FateSeeds
- 证据流向
- 责任流向
- 角色默认惯性

推演本次决策的即时结果、隐藏伏笔、证据变化、责任变化、其他角色反应。

规则：
1. 不得跳到最终结局。
2. 不得让 AI 角色抢主角。
3. 不得公开玩家不可知信息。
4. 每个后果必须有因果来源。
5. 每个新伏笔必须有未来帮助和未来反噬的可能。
6. 输出严格 JSON。
```

---

## 11.3 FateSeed Prompt

```text
你是 AI 多人局的命运伏笔引擎。

请从本次玩家决策中提取未来可能帮助或吞噬玩家的因果种子。

每个 FateSeed 必须包含：
- originEventId
- visibleHint：玩家可见的模糊提示
- hiddenMeaning：后台真实含义
- helpTriggers：未来帮助触发条件
- backfireTriggers：未来反噬触发条件
- relatedEvidence：相关证据
- relatedRoles：相关角色

注意：
玩家当下不能看到具体触发条件。
但未来触发时，必须能清楚解释为什么来自本次选择。
```

---

## 11.4 RoleReaction Prompt

```text
你是 AI 多人局的角色反应引擎。

请根据目标角色的：
- 公开身份
- 默认倾向
- 当前已知信息
- 当前误判
- 当前利益
- 当前恐惧
- 与玩家的关系
- 可用行动

生成该角色最合理的反应。

输出时区分：
1. 表面行动
2. 公开理由
3. 隐藏意图
4. 给该角色自己看到的剧情消息
5. 转译给其他角色的剧情压力
6. 对状态和伏笔的影响

不得让角色知道他不该知道的信息。
```

---

## 11.5 FinalJudge Prompt

```text
你是《桑田诏：嘉靖财政危局》的最终裁决系统。

你不是道德审判者。
你模拟的是皇帝、内阁、司礼监、地方民情、证据责任链共同作用后的政治裁决。

你必须根据：
- worldState
- roleState
- keyDecisions
- fateSeeds
- evidenceLedger
- responsibilityLedger
- narrativeFrames
- daySummaries

判断：
1. 全局结局
2. 玩家个人结局
3. 哪几步救了玩家
4. 哪几步害了玩家
5. 命运债
6. 皇帝最终评价
7. 未来余波

每个结论必须引用 originEventId 或关键决策。
不得给出没有因果来源的结局。
输出严格 JSON。
```

---

## 12. 数据库落地建议

第一版仍可用两张表：

```text
StoryRun
StoryEvent
```

但 StoryRun.stateJson 中要增加：

```json
{
  "fateSeeds": [],
  "evidenceLedger": [],
  "responsibilityLedger": [],
  "narrativeFrames": [],
  "daySummaries": {},
  "finalJudgementInputs": {}
}
```

StoryEvent.payloadJson 中增加事件类型：

```text
fate_seed_created
fate_seed_triggered_help
fate_seed_triggered_backfire
evidence_updated
responsibility_updated
narrative_frame_updated
role_reaction
final_judgement
```

后期如果量大，再拆表：

```text
FateSeed
EvidenceItem
ResponsibilityNode
NarrativeFrame
FinalJudgement
```

---

## 13. 开发优先级

### P0：必须先做

```text
ActionGuard
DecisionResolver
FateSeedEngine
DayEndSummarizer
FinalJudge
```

### P1：增强权谋感

```text
EvidenceLedger
ResponsibilityLedger
NarrativeFrameEngine
RoleReactionEngine
```

### P2：多人异步

```text
角色独立消息流
MessageDelivery
别人行动转译成我的剧情压力
玩家不在线时角色默认惯性推进
```

---

## 14. 验收标准

这个 AI 判定系统是否成立，看 5 件事：

```text
1. 玩家第 1 天的选择，第 4 天能被合理触发。
2. 同一个选择既可能帮助，也可能反噬。
3. 每次反噬都能说清楚 originEventId。
4. 角色反应符合身份，不像系统随机安排。
5. 最终结局能解释关键三手、吞噬三手、命运债。
```

如果玩家能说：

```text
原来我第 1 天那一步，后来既救了我，也害了我。
```

这个系统就成功。

---

## 15. 一句话总结

> **AI 剧情推演的核心不是让模型自由写故事，而是让系统每天记录玩家留下的痕迹，再让 AI 在正确的时间把这些痕迹变成机会、罪名、证据、恩情或灾祸。**

