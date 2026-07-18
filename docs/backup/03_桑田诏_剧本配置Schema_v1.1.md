# 《桑田诏：嘉靖财政危局》｜剧本配置 Schema v1.1

> 文档类型：机器可验证剧本配置规范 / JSON Schema 设计  
> 适用范围：首个 Web 单人 MVP 剧本  
> 依赖基线：《MVP 唯一工程基线 v1.1》  
> 核心目标：**把自然语言剧本编译为可验证、可加载、可测试、可版本化的配置。**

---

## 0. v1.1 修订说明

本版新增“主动谋划”机器配置。主线决策继续由 `decisions.json` 定义；主动谋划由 `maneuvers.json` 和 `leverage.json` 定义。

统一规则：

```text
第 1—6 天每天 2 次谋划机会
第 7 天 0 次谋划机会
谋划可选，未使用不结转
谋划不替代主线决策
```

统一代码术语为 `maneuver`，前台显示为“谋划 / 谋划机会 / 自拟谋划”。

## 1. 推荐目录

```text
packages/templates/src/stories/sangtian/
  story.json
  roles.json
  days.json
  decisions.json
  maneuvers.json
  leverage.json
  endings.json
  context-cards.json
  schemas/
    story.schema.json
    roles.schema.json
    days.schema.json
    decisions.schema.json
    maneuvers.schema.json
    leverage.schema.json
    endings.schema.json
    context-cards.schema.json
  index.ts
```

运行时不直接解析 Markdown。Markdown 继续作为策划文档，JSON 是游戏引擎读取的唯一配置来源。

---

## 2. 全局命名约束

### 2.1 Key 规则

```regex
^[a-z][a-z0-9_]{1,63}$
```

示例：

```text
sangtian
zhejiang_governor
xunfu
d3_1
grain_price
secret_memorial
```

### 2.2 唯一变量键

#### worldState

```text
treasury_silver
public_support
grain_price
mulberry_progress
coastal_morale
emperor_trust
emperor_suspicion
```

#### roleState

```text
governor_authority
promotion_chance
liquidation_risk
cabinet_suspicion
xunfu_hostility
county_trust
merchant_dependency
sili_alertness
merchant_liquidation_risk
official_merchant_risk
xunfu_reputation
evidence_completeness
```

UI 可显示中文名称，但配置和代码只使用英文 key，避免“国库银 / 国库银两”之类的名称漂移。

---

## 3. story.json

### 3.1 示例

```json
{
  "$schema": "./schemas/story.schema.json",
  "schemaVersion": "1.0.0",
  "templateKey": "sangtian",
  "title": "桑田诏：嘉靖财政危局",
  "subtitle": "七日动态权谋故事局",
  "category": "historical_politics",
  "mode": "single",
  "totalDays": 7,
  "decisionsPerDay": 2,
  "decisionDays": [1, 2, 3, 4, 5, 6],
  "maneuverOpportunitiesPerDay": 2,
  "maneuverDays": [1, 2, 3, 4, 5, 6],
  "maneuverCarryOver": false,
  "finalizationDay": 7,
  "defaultPlayerRoleKey": "zhejiang_governor",
  "location": "杭州总督府",
  "hook": "国库缺银，皇帝催银。你必须在七天内稳住浙江，并决定谁来替大明付这笔账。",
  "uiLabels": {
    "mainDecision": "主线决策",
    "maneuver": "主动谋划",
    "maneuverOpportunity": "谋划机会",
    "customManeuver": "自拟谋划",
    "executeManeuver": "执行谋划",
    "leverage": "我的筹码",
    "availableLeverage": "可用筹码"
  },
  "initialState": {
    "worldState": {
      "treasury_silver": 30,
      "public_support": 60,
      "grain_price": 45,
      "mulberry_progress": 20,
      "coastal_morale": 50,
      "emperor_trust": 45,
      "emperor_suspicion": 55
    },
    "roleState": {
      "governor_authority": 60,
      "promotion_chance": 40,
      "liquidation_risk": 45,
      "cabinet_suspicion": 35,
      "xunfu_hostility": 30,
      "county_trust": 50,
      "merchant_dependency": 35,
      "sili_alertness": 30,
      "merchant_liquidation_risk": 35,
      "official_merchant_risk": 20,
      "xunfu_reputation": 30,
      "evidence_completeness": 10
    }
  }
}
```

### 3.2 JSON Schema 核心约束

```json
{
  "$id": "story.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "templateKey",
    "title",
    "mode",
    "totalDays",
    "decisionsPerDay",
    "decisionDays",
    "maneuverOpportunitiesPerDay",
    "maneuverDays",
    "maneuverCarryOver",
    "finalizationDay",
    "defaultPlayerRoleKey",
    "initialState"
  ],
  "properties": {
    "schemaVersion": { "type": "string", "pattern": "^1\\.[0-9]+\\.[0-9]+$" },
    "templateKey": { "type": "string", "pattern": "^[a-z][a-z0-9_]{1,63}$" },
    "title": { "type": "string", "minLength": 2, "maxLength": 80 },
    "mode": { "const": "single" },
    "totalDays": { "const": 7 },
    "decisionsPerDay": { "const": 2 },
    "decisionDays": {
      "type": "array",
      "const": [1, 2, 3, 4, 5, 6]
    },
    "maneuverOpportunitiesPerDay": { "const": 2 },
    "maneuverDays": {
      "type": "array",
      "const": [1, 2, 3, 4, 5, 6]
    },
    "maneuverCarryOver": { "const": false },
    "finalizationDay": { "const": 7 },
    "defaultPlayerRoleKey": { "const": "zhejiang_governor" },
    "initialState": { "$ref": "#/$defs/initialState" }
  }
}
```

所有状态值必须为 0—100 的整数。

---

## 4. roles.json

### 4.1 角色对象

```json
{
  "roleKey": "xunfu",
  "name": "浙江巡抚",
  "playableInMvp": false,
  "publicIdentity": "负责实际推进改稻为桑的浙江巡抚",
  "publicGoal": "推进改桑，尽快见银",
  "realGoal": "抢在总督前报功，借新政进入京师",
  "fateQuestion": "你是国策执行者，还是掠夺江南的刀？",
  "fear": ["总督掌握暗账", "商会反咬", "县令公开证据"],
  "desire": ["成为新政功臣", "把责任留给总督府"],
  "misjudgementBias": ["高估内阁对速度的偏好", "低估县令保留副本的可能"],
  "decisionBias": ["xunfu_report_early", "xunfu_blame_governor", "xunfu_cut_merchant"],
  "informationStyle": "只公开对自己有利的信息",
  "defaultActions": ["urge_counties", "report_to_cabinet", "move_records"],
  "triggerThresholds": {
    "xunfu_hostility": 70,
    "evidence_completeness": 60,
    "merchant_liquidation_risk": 65
  }
}
```

### 4.2 必须存在的角色

```text
zhejiang_governor
xunfu
county_magistrate
merchant
sili_jian
cabinet
emperor
```

### 4.3 Schema 约束

- `roleKey` 全局唯一；
- `zhejiang_governor.playableInMvp = true`；
- 其他角色 `playableInMvp = false`；
- 所有非玩家核心角色必须包含 `realGoal / fear / desire / misjudgementBias / decisionBias`；
- `triggerThresholds` 引用的变量必须存在于 story 的变量字典；
- 后台字段不得进入公开角色 API。

---

## 5. days.json

### 5.1 示例

```json
[
  {
    "day": 1,
    "theme": "改桑令下",
    "location": "杭州总督府",
    "openingTitle": "京师急诏抵达浙江",
    "openingNarrative": "朝廷要求浙江改稻为桑。案上同时压着海防欠饷军报。",
    "mainPressure": "朝廷催银，巡抚请命",
    "decisionKeys": ["d1_1", "d1_2"],
    "maneuverKeys": [
      "contact_role",
      "investigate",
      "use_leverage",
      "custom_maneuver"
    ],
    "contactRoleKeys": ["xunfu", "county_magistrate", "merchant"],
    "dayEndTemplateKey": "day_1_end",
    "nextDay": 2
  }
]
```

### 5.2 Schema 约束

- 必须恰好 7 条；
- `day` 必须为 1—7 且不重复；
- 第 1—6 天 `decisionKeys` 必须恰好 2 个；
- 第 7 天 `decisionKeys` 必须为空；
- 第 1—6 天 `maneuverKeys` 必须至少包含 1 种谋划，第 7 天必须为空；
- `contactRoleKeys` 引用的角色必须存在；
- 第 1—6 天必须有 `nextDay = day + 1`；
- 第 7 天不得有 `nextDay`；
- `decisionKeys` 必须在 decisions.json 中存在且 day 一致。

---

## 6. decisions.json

### 6.1 完整决策对象

```json
{
  "decisionKey": "d3_1",
  "day": 3,
  "sequence": 1,
  "title": "处理巡抚急奏",
  "promptTitle": "巡抚急奏北上",
  "promptNarrative": "巡抚奏中只写改桑进度，不提粮价与民怨。若他先定义浙江，你将承担失控责任。",
  "playerRoleKey": "zhejiang_governor",
  "reactionRoleKeys": ["xunfu", "sili_jian", "cabinet"],
  "allowedResources": ["secret_memorial_right", "staff", "governor_authority"],
  "statePatchLimits": {
    "emperor_trust": { "min": -10, "max": 10 },
    "cabinet_suspicion": { "min": -10, "max": 12 },
    "xunfu_hostility": { "min": -5, "max": 15 },
    "sili_alertness": { "min": 0, "max": 12 }
  },
  "options": [
    {
      "optionKey": "A",
      "title": "截留奏疏",
      "description": "追回奏疏，责令不得越级。",
      "gain": "阻止巡抚抢功",
      "risk": "可能被反咬压制国策",
      "statePatch": {
        "governor_authority": 5,
        "xunfu_hostility": 12,
        "cabinet_suspicion": 10,
        "emperor_trust": -2
      },
      "tags": ["confront_xunfu"],
      "fateSeedTemplateKeys": ["seed_intercept_memorial"],
      "possibleNextEventKeys": ["evt_xunfu_accuses_governor"]
    },
    {
      "optionKey": "B",
      "title": "追加密奏",
      "description": "不拦巡抚，另写密奏说明粮价与民心风险。",
      "gain": "保留未来解释权",
      "risk": "可能被内阁定性为越级自保",
      "statePatch": {
        "emperor_trust": 7,
        "emperor_suspicion": 4,
        "cabinet_suspicion": 6,
        "liquidation_risk": -4,
        "sili_alertness": 8
      },
      "tags": ["secret_memorial"],
      "fateSeedTemplateKeys": ["seed_secret_memorial"],
      "possibleNextEventKeys": ["evt_reports_diverge", "evt_sili_notices"]
    },
    {
      "optionKey": "C",
      "title": "放任巡抚",
      "description": "等待巡抚与商会绑定更深。",
      "gain": "未来可能合并清算",
      "risk": "巡抚短期声望上升",
      "statePatch": {
        "xunfu_reputation": 12,
        "governor_authority": -8,
        "mulberry_progress": 5,
        "liquidation_risk": 5
      },
      "tags": ["wait", "empower_xunfu"],
      "fateSeedTemplateKeys": ["seed_allow_xunfu_credit"],
      "possibleNextEventKeys": ["evt_xunfu_gains_cabinet_support"]
    }
  ],
  "customDecision": {
    "enabled": true,
    "maxLength": 500,
    "guardProfile": "zhejiang_governor_v1"
  }
}
```

### 6.2 强制规则

每个决策必须包含：

```text
decisionKey
day
sequence
title
promptTitle
promptNarrative
playerRoleKey
reactionRoleKeys
allowedResources
statePatchLimits
options
customDecision
```

每个预设选项必须包含：

```text
optionKey
title
description
gain
risk
statePatch
tags
fateSeedTemplateKeys
possibleNextEventKeys
```

### 6.3 数量规则

```text
总决策数 = 12
第 1—6 天每天 2 个
每个决策至少 3 个预设选项
optionKey 在同一决策内唯一
```

### 6.4 patch 校验

- `statePatch` 只能引用已声明变量；
- 每个值必须落在 `statePatchLimits` 内；
- 应用后状态统一 clamp 到 0—100；
- AI 候选 patch 超界时由规则引擎裁剪或拒绝；
- AI 不得新增未声明变量。

---

## 7. maneuvers.json

### 7.1 作用

`maneuvers.json` 定义主动谋划的通用入口和剧本允许范围。MVP 支持四类：

```text
contact       人物交谈
investigate   派遣调查
leverage      使用筹码
custom        自拟谋划
```

### 7.2 示例

```json
[
  {
    "maneuverKey": "contact_role",
    "type": "contact",
    "title": "接触人物",
    "cost": 1,
    "availableDays": [1, 2, 3, 4, 5, 6],
    "playerRoleKey": "zhejiang_governor",
    "targetRoleKeys": [
      "xunfu",
      "county_magistrate",
      "merchant",
      "sili_jian"
    ],
    "intentKeys": [
      "probe",
      "request_intel",
      "pressure",
      "trade",
      "custom"
    ],
    "guardProfile": "zhejiang_governor_maneuver_v1",
    "statePatchLimits": {
      "xunfu_hostility": { "min": -8, "max": 10 },
      "county_trust": { "min": -8, "max": 10 },
      "merchant_dependency": { "min": -8, "max": 10 },
      "sili_alertness": { "min": -5, "max": 10 }
    },
    "possibleResultEventKeys": [
      "evt_contact_response",
      "evt_contact_refused"
    ],
    "fateSeedTemplateKeys": []
  },
  {
    "maneuverKey": "investigate",
    "type": "investigate",
    "title": "派遣调查",
    "cost": 1,
    "availableDays": [1, 2, 3, 4, 5, 6],
    "playerRoleKey": "zhejiang_governor",
    "intentKeys": [
      "inspect_courier_registry",
      "inspect_land_contracts",
      "inspect_granaries",
      "follow_merchant_agents",
      "custom"
    ],
    "guardProfile": "zhejiang_governor_maneuver_v1",
    "statePatchLimits": {
      "evidence_completeness": { "min": 0, "max": 12 },
      "liquidation_risk": { "min": 0, "max": 8 }
    },
    "possibleResultEventKeys": [
      "evt_investigation_clue",
      "evt_investigation_exposed"
    ],
    "fateSeedTemplateKeys": [
      "seed_covert_investigation"
    ]
  },
  {
    "maneuverKey": "use_leverage",
    "type": "leverage",
    "title": "使用筹码",
    "cost": 1,
    "availableDays": [1, 2, 3, 4, 5, 6],
    "playerRoleKey": "zhejiang_governor",
    "requiresLeverageKey": true,
    "intentKeys": [
      "pressure",
      "report",
      "exchange",
      "protect",
      "investigate"
    ],
    "guardProfile": "zhejiang_governor_maneuver_v1",
    "statePatchLimits": {},
    "possibleResultEventKeys": [
      "evt_leverage_used"
    ],
    "fateSeedTemplateKeys": []
  },
  {
    "maneuverKey": "custom_maneuver",
    "type": "custom",
    "title": "自拟谋划",
    "cost": 1,
    "availableDays": [1, 2, 3, 4, 5, 6],
    "playerRoleKey": "zhejiang_governor",
    "maxLength": 200,
    "guardProfile": "zhejiang_governor_maneuver_v1",
    "statePatchLimits": {},
    "possibleResultEventKeys": [],
    "fateSeedTemplateKeys": []
  }
]
```

### 7.3 强制规则

- `maneuverKey` 全局唯一；
- `type` 只能为 `contact / investigate / leverage / custom`；
- `cost` 在 MVP 中固定为 1；
- 第 1—6 天每天最多成功执行 2 次；
- 第 7 天不可执行；
- `custom` 的 `maxLength` 为 200；
- 谋划必须经过 ActionGuard 或确定性规则校验；
- 成功谋划必须产生 `maneuver` 和 `maneuver_result` 运行事件；
- 被拒绝的谋划不消耗机会；
- 谋划不得直接解决主线决策或跳过当天阶段。

---

## 8. leverage.json

### 8.1 作用

筹码是玩家已经掌握、可用于影响人物或事件的证据、秘密、人情、承诺、权力、关系或特殊情报。

底层统一使用 `leverage`，前台显示名称由剧本 `uiLabels` 决定。

### 8.2 示例

```json
[
  {
    "leverageKey": "land_contract_fragment",
    "title": "田契暗账半页",
    "type": "evidence",
    "initialStatus": "available",
    "visibility": "private",
    "singleUse": false,
    "usableTargetRoleKeys": ["xunfu", "merchant", "emperor"],
    "intentKeys": ["pressure", "investigate", "report", "exchange"],
    "originEventKey": "evt_day2_county_letter"
  },
  {
    "leverageKey": "county_magistrate_letter",
    "title": "清流县令密信",
    "type": "information",
    "initialStatus": "available",
    "visibility": "private",
    "singleUse": false,
    "usableTargetRoleKeys": ["xunfu", "cabinet", "emperor"],
    "intentKeys": ["protect", "report", "investigate"],
    "originEventKey": "evt_day2_county_letter"
  },
  {
    "leverageKey": "coastal_defense_report",
    "title": "海防军报",
    "type": "authority",
    "initialStatus": "available",
    "visibility": "private",
    "singleUse": false,
    "usableTargetRoleKeys": ["cabinet", "emperor"],
    "intentKeys": ["report", "justify", "exchange"],
    "originEventKey": "evt_day1_coastal_report"
  }
]
```

### 8.3 通用筹码类型

```text
evidence
clue
secret
favor
promise
authority
relationship
item
information
```

### 8.4 强制规则

- `leverageKey` 全局唯一；
- 所有目标角色必须存在；
- 所有 `originEventKey` 必须可解析；
- `singleUse=true` 的筹码成功使用后必须变为 `consumed`；
- 不可用、未获得或已消耗的筹码不能提交；
- 每次筹码使用必须写入 `leverage_used` 事件；
- 筹码使用可以影响关系、证据、责任、叙事定性、FateSeed 和后续事件，但不能直接指定结局。

## 9. FateSeed 模板

FateSeed 可放在 `decisions.json` 内引用，也可独立编译到运行时模板。

```json
{
  "fateSeedTemplateKey": "seed_secret_memorial",
  "family": "secret_memorial",
  "title": "总督密奏",
  "visibleHint": "你没有拦巡抚，却在京师留下了自己的口径。",
  "hiddenMeaning": "密奏能证明总督早已预警，也可被内阁定性为越级自保。",
  "helpTriggers": [
    {
      "triggerKey": "secret_memorial_helps",
      "minDay": 5,
      "all": [
        { "stat": "grain_price", "op": ">=", "value": 60 }
      ],
      "effectEventKey": "evt_memorial_proves_warning"
    }
  ],
  "backfireTriggers": [
    {
      "triggerKey": "secret_memorial_backfires",
      "minDay": 5,
      "all": [
        { "stat": "cabinet_suspicion", "op": ">=", "value": 55 }
      ],
      "effectEventKey": "evt_memorial_reframed_as_self_protection"
    }
  ],
  "relatedEvidenceKeys": ["evidence_secret_memorial", "evidence_delivery_record"],
  "relatedRoleKeys": ["xunfu", "cabinet", "sili_jian", "emperor"]
}
```

强制规则：

- 每个 FateSeed 运行态必须有 `originEventId`；
- 模板必须至少有一个 help 或 backfire 方向；
- 触发条件只能引用已声明变量；
- `effectEventKey` 必须存在；
- 不能直接写最终结局。

---

## 10. endings.json

### 8.1 示例

```json
{
  "globalEndings": [
    {
      "endingKey": "clean_governance",
      "title": "国策缓行，清弊得名",
      "priority": 80,
      "conditions": {
        "all": [
          { "stat": "evidence_completeness", "op": ">=", "value": 70 },
          { "stat": "county_trust", "op": ">=", "value": 60 },
          { "stat": "public_support", "op": ">=", "value": 50 },
          { "stat": "emperor_trust", "op": ">=", "value": 55 }
        ]
      },
      "requiredNarrativeFrames": ["corrupt_execution_frame"],
      "narrativeTemplateKey": "ending_clean_governance"
    }
  ],
  "personalEndings": [
    {
      "endingKey": "rank_a_guarded_promotion",
      "rank": "A",
      "title": "明升暗防",
      "conditions": {
        "all": [
          { "stat": "emperor_trust", "op": ">=", "value": 55 },
          { "stat": "liquidation_risk", "op": "<", "value": 65 }
        ]
      },
      "narrativeTemplateKey": "personal_guarded_promotion"
    }
  ]
}
```

### 8.2 规则

- 至少 5 类全局结局；
- 至少 5 个个人结局档位可达；
- 必须有一个兜底全局结局和一个兜底个人结局；
- 所有 stat 引用必须有效；
- 结局计算先由规则选候选，再由 AI 生成文案；
- 最终解释必须引用已有关键决策或 `originEventId`。

---

## 11. context-cards.json

```json
[
  {
    "contextCardKey": "sili_report_difference",
    "title": "司礼监注意奏报差异",
    "triggers": ["secret_memorial", "reports_diverge", "sili_jian"],
    "activation": {
      "minDay": 5,
      "any": [
        { "stat": "sili_alertness", "op": ">=", "value": 50 },
        { "stat": "emperor_suspicion", "op": ">=", "value": 65 }
      ]
    },
    "content": "总督密奏与巡抚急奏口径不一，内廷可能介入查问。",
    "visibility": "system",
    "priority": 90,
    "maxUses": 2
  }
]
```

约束：

- key 唯一；
- trigger 不得为空；
- priority 0—100；
- `visibility` 只能为 `system / role_only / public`；
- system 内容不直接返回前台。

---

## 12. 跨文件静态校验

单个 JSON Schema 不能完成全部业务校验，因此构建时必须运行跨文件 lint。

### 10.1 必查项目

1. `templateKey` 与目录一致；
2. 所有 roleKey 存在且唯一；
3. 玩家默认角色存在且可玩；
4. days 恰好 1—7；
5. 前 6 天各 2 个决策，第 7 天 0 个；
6. 总决策恰好 12；
7. 所有 decisionKey 在 days 中被引用一次；
8. 所有变量引用存在；
9. 所有 patch 在允许范围内；
10. 所有 FateSeed 模板存在；
11. 所有 `possibleNextEventKeys` 可解析；
12. 所有结局变量存在；
13. 至少 5 个全局结局和 5 个个人档位可达；
14. 至少存在一条从第 1 天到第 7 天的完整路径；
15. 任何选项都不能让状态机无后续可走；
16. 所有因果回溯模板可追溯 origin；
17. 公开配置不能包含后台私密推理的运行结果；
18. `maneuverOpportunitiesPerDay` 必须为 2，`maneuverCarryOver` 必须为 false；
19. 第 1—6 天必须可执行至少一种谋划，第 7 天不可执行谋划；
20. 所有 maneuverKey、intentKey、targetRoleKey 和 leverageKey 引用有效；
21. 自拟谋划最大长度为 200；
22. 所有筹码 originEventKey 可追溯；
23. 不使用谋划、每天使用 1 次谋划、每天使用 2 次谋划三种路径均可到达第 7 天。

### 10.2 可达性检查

构建脚本至少模拟：

```text
全 A 路径
全 B 路径
全 C 路径
完全不使用谋划
每天固定使用 1 次谋划
每天固定使用 2 次谋划
主线决策与谋划随机组合 × 1000
```

检查：

- 不出现死路；
- 状态始终为 0—100；
- 每条路径都可到达第 7 天；
- 结局规则至少命中一个候选；
- 不同主路径产生不同的状态签名；
- 谋划不会改变 12 次主线决策数量；
- 谋划机会不会跨日累计。

---

## 13. 版本与兼容

```text
schemaVersion: 1.x.x
```

- patch：文案或非破坏性配置调整；
- minor：新增可选字段或新事件类型；
- major：字段重命名、状态含义改变、运行时不兼容。

StoryRun 必须保存创建时的：

```text
templateKey
templateVersion
schemaVersion
```

已开始的 StoryRun 不随模板热更新，避免中途规则改变。
