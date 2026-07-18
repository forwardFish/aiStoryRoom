# AI 多人局｜数据库与存储架构设计文档 v2.0

> 文档类型：数据库设计 / 存储架构 / 后端运行时方案  
> 适用产品：AI 多人局 Web MVP  
> 首个故事局：《桑田诏：嘉靖财政危局》  
> 当前阶段：Web 单人 MVP → 后端化 → 多人异步 → 平台化  
> 参考项目：Feed-Scription/openovel  
> 核心结论：**剧本可以用文本 / JSON；运行中的局势最终要进入数据库。但第一版数据库只需要 StoryRun + StoryEvent，后续再逐步增加 AiTask、StoryPlayer、MessageDelivery、ContextCard。**

---

## 0. 本文档更新说明

v2.0 在 v1.0 的基础上，加入对 `openovel` 的代码分析结论。

`openovel` 的最大启发不是“照抄文件系统”，而是它把一个 AI 互动故事运行时拆成了：

```text
故事工作区
事件日志
当前快照
后台任务账本
上下文卡片
事务恢复机制
前台快速叙事
后台慢速维护
```

这正好对应 AI 多人局后端未来应该具备的核心能力：

```text
StoryRun 当前状态
StoryEvent 事件流水
AiTask 后台任务账本
ContextCard 触发式上下文
数据库事务 / 乐观锁
前台消息生成
后台角色反应 / 隐藏暗线 / 状态维护
```

本文档目标：

```text
1. 继续保持 MVP 简单；
2. 提前确定未来数据库方向；
3. 吸收 openovel 的优秀运行时思想；
4. 避免后续接数据库和多人异步时大规模返工。
```

---

## 1. 最终判断

### 1.1 不要一开始就做复杂数据库

当前最重要的是验证玩法：

```text
剧情消息
↓
玩家决策
↓
状态变化
↓
AI 角色反应
↓
隐藏暗线
↓
第 7 天最终裁决
```

第一阶段不要一开始就做复杂多表系统。

不建议现在就拆成：

```text
StoryMessage
PlayerDecision
RelationshipState
Clue
HiddenThread
EndingRecord
StoryPlayer
MessageDelivery
ContextCard
AiTask
TemplateVersion
```

这些后续都可能需要，但不是第一阶段重点。

---

### 1.2 也不能随便写成 localStorage 玩具

虽然当前可以用 `localStorage` 或 JSON mock，但数据结构必须按未来后端抽象：

```text
StoryRun = 当前这一局的快照
StoryEvent = 这一局发生过的消息、决策、状态变化、隐藏暗线、结局事件
```

这样后续从 `localStorage` 迁移到数据库时，只换存储层，不重写页面和游戏引擎。

---

### 1.3 推荐路线

```text
阶段 0：前端 localStorage，但结构模拟后端
阶段 1：后端化，只建 StoryRun + StoryEvent
阶段 2：AI 推演接入，增加 AiTask
阶段 3：多人异步，增加 StoryPlayer + MessageDelivery
阶段 4：上下文卡片独立化，增加 ContextCard
阶段 5：平台化，增加 StoryTemplate + TemplateVersion + 运营后台
```

一句话：

> **架构先定，存储先轻。**

---

## 2. 从 openovel 借鉴什么

### 2.1 openovel 的存储不是数据库，而是文件工作区

`openovel` 是 local-first Electron 应用。它没有传统 Web 后端数据库，而是将每个故事保存为一个文件工作区。

它的故事目录大致承担了如下职责：

```text
canon/
  scene_log.jsonl
  chapters.md
  chapters.recent.md
  PROVENANCE.md

frontend/
  scene.md
  active-pressures.md
  open-threads.md

director/
  ARC.md
  QUALITY.md
  CHOICE_FEEDBACK.md
  PLAYER_PROFILE.md

memory/
  MEMORY.md

inbox/
  INBOX.md
  MERGED.md

jobs/
  jobs.jsonl

transactions/
  tx_xxx/
    manifest.json
    before/
    after/

context-cards/
```

这些文件和目录本质上承担了数据库职责：

| openovel 文件/目录 | 等价数据库职责 | 我们项目对应设计 |
|---|---|---|
| storyRoot | 一局故事实例 | StoryRun |
| canon/scene_log.jsonl | 事件日志 | StoryEvent |
| chapters.md | 当前已生成正文 | StoryEvent payload / 导出文本 |
| frontend/ | 当前前台上下文摘要 | StoryRun.stateJson.summary / ContextCard |
| director/ARC.md | 故事节奏与伏笔账本 | StoryRun.stateJson.director |
| inbox/INBOX.md | 后台待处理任务 | AiTask / pending events |
| jobs/jobs.jsonl | 后台任务生命周期 | AiTask |
| context-cards/ | 上下文触发卡片 | ContextCard |
| transactions/ | 文件事务与回滚 | DB transaction + version |

---

### 2.2 openovel 的关键思想一：事件日志 + 当前快照

openovel 使用 append-only `scene_log.jsonl` 记录前台回合、后台信号、补丁等事件。读取故事时不读全部历史，而是读取“当前快照 + 最近尾部”。

我们应该采用同样思想：

```text
StoryRun = 当前局势快照，快速打开游戏页面
StoryEvent = append-only 事件流，用于回放、复盘、AI 上下文、最终结局
```

不要把整个游戏只存成一个大 JSON，也不要每次 AI 调用都传完整历史。

正确方式是传：

```text
当前待决策消息
当前 worldState / roleState
最近 N 条事件
重要历史摘要
触发到的 ContextCards
隐藏暗线摘要
```

---

### 2.3 openovel 的关键思想二：写入安全与事务

openovel 对文件使用原子写入：

```text
写临时文件
↓
rename 覆盖目标文件
```

它还做了事务机制：

```text
begin transaction
保存 before snapshot
执行写入
保存 after snapshot
失败标记 error
支持 rollback
```

我们对应到数据库就是：

> **玩家提交决策时必须使用数据库事务。**

一次决策至少会同时产生：

```text
1. decision event
2. decision_result message
3. state patch
4. role reaction message
5. hidden thread
6. StoryRun 当前状态更新
```

这些必须全部成功或全部失败。

---

### 2.4 openovel 的关键思想三：后台任务账本

openovel 的后台任务账本会记录：

```text
started
completed
error
abandoned
```

这对 AI 产品非常重要。

我们对应到数据库应该有：

```text
AiTask
```

它保存：

```text
AI 输入
AI 输出
原始响应
解析结果
错误信息
重试状态
token 成本
模型名称
```

如果没有 AiTask，AI 出错时无法调试。

---

### 2.5 openovel 的关键思想四：Context Card 触发

openovel 不把全部历史塞给模型，而是先根据用户动作和当前上下文确定性匹配 `context-cards`，再把触发到的卡片加入 narrator 上下文。

我们可以复制这个思想：

```text
ContextCard / HiddenThread / ImportantFact
```

例如：

```json
{
  "key": "sili_report_difference",
  "triggers": ["密奏", "奏报", "司礼监"],
  "content": "总督密奏与巡抚急奏口径不一，司礼监可能在第 5 天介入查问。",
  "visibility": "system",
  "priority": 90
}
```

AI 推演时只带触发到的上下文卡片，而不是带完整历史。

---

### 2.6 openovel 的关键思想五：前台快循环 + 后台慢循环

openovel 的玩家输入后，先快速生成前台 narration，然后后台 Storykeeper 再慢慢维护世界状态、记忆、上下文和伏笔。

我们项目也应该分成：

```text
前台快速循环：
玩家提交决策
→ 立即生成结果消息
→ 更新右侧状态
→ 返回页面

后台慢循环：
生成 AI 角色反应
→ 整理隐藏暗线
→ 更新 ContextCard
→ 生成日终摘要
→ 为下一天准备上下文
```

MVP 可以先同步执行。后面接真实 AI 后，建议拆成异步任务。

---

### 2.7 openovel 的关键思想六：AI 输出不能直接改状态

openovel 的 Storykeeper workflow 是：

```text
prepare
buildContext
normalize
apply
fallback
record event
```

我们也应该这样：

```text
AI raw output
↓
normalize
↓
schema validate
↓
apply patch
↓
record StoryEvent / AiTask
```

不要让 AI 直接写数据库。

---

## 3. 我们不要照抄 openovel 的地方

openovel 适合：

```text
本地单人
长篇互动小说
文件可编辑
离线优先
Electron 桌面应用
```

我们适合：

```text
Web
单人起步
未来多人异步
账号 / 历史局 / 分享 / 付费
不同角色看到不同消息
多人并发决策
```

所以不要照抄：

```text
纯文件系统作为线上生产存储
Electron IPC 架构
用户直接编辑工作区文件
超长篇小说式章节积累
```

我们要复制的是它的运行时思想，而不是文件系统形态。

---

## 4. 存储边界：剧本和局势

### 4.1 剧本用文本 / JSON

剧本是静态模板，适合放文件：

```text
stories/
  sangtian/
    story.json
    roles.json
    days.json
    endings.json
    context-cards.json
```

这些内容包括：

```text
故事背景
角色设定
7 天主线
每天开局剧情
默认决策选项
初始世界变量
结局规则
上下文卡片
```

优势：

```text
好编辑
好版本管理
Git 可以记录变化
新剧本复制一套配置即可
不需要后台系统也能快速改
```

---

### 4.2 局势用数据库

局势是玩家实际玩出来的一局，属于运行态。

数据库保存：

```text
这一局是谁创建的
当前第几天
玩家选了什么角色
已经出现哪些剧情消息
玩家做了哪些决策
世界变量是多少
人物关系如何变化
隐藏暗线有哪些
AI 任务是否完成
最终结局是什么
```

一句话：

> **剧本是模板，局势是玩家实际玩出来的那一局。**

---

## 5. MVP 最小数据库：两张表

第一版后端化只建：

```text
StoryRun
StoryEvent
```

不要急着拆复杂表。

---

## 6. 核心表 1：StoryRun

### 6.1 作用

`StoryRun` 表示一局正在进行或已经完成的游戏。

它保存当前状态快照。

---

### 6.2 Prisma 模型

```prisma
model StoryRun {
  id           String   @id @default(cuid())

  templateKey String
  userId       String?
  mode         String   @default("single")   // single / multiplayer
  status       String   @default("playing")  // playing / finished / abandoned

  currentDay   Int      @default(1)
  totalDays    Int      @default(7)
  selectedRole String   @default("zhejiang_governor")

  stateJson    Json
  version      Int      @default(1)

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  events       StoryEvent[]

  @@index([templateKey])
  @@index([userId])
  @@index([status])
  @@index([updatedAt])
}
```

---

### 6.3 stateJson 建议结构

```json
{
  "worldState": {
    "国库银": 30,
    "民心": 60,
    "粮价": 45,
    "改桑进度": 20,
    "海防军心": 50,
    "皇帝信任": 45,
    "皇帝疑心": 55
  },
  "roleState": {
    "总督权威": 60,
    "升迁机会": 40,
    "清算风险": 45,
    "内阁疑心": 35,
    "巡抚敌意": 30,
    "县令信任": 50,
    "商会依赖": 35,
    "司礼监警惕": 30,
    "暗账完整度": 10
  },
  "relationships": [
    {
      "roleKey": "xunfu",
      "name": "浙江巡抚",
      "person": "刘瑾",
      "stance": "敌意",
      "score": 30
    }
  ],
  "clues": ["海防军饷压力", "巡抚越级倾向"],
  "hiddenThreads": [
    {
      "id": "thread_001",
      "title": "司礼监注意奏报差异",
      "triggerDay": 5,
      "risk": "中",
      "source": "司礼监",
      "note": "两份浙江奏报口径不一，内廷可能介入查问。",
      "status": "pending"
    }
  ],
  "contextCards": [
    {
      "key": "sili_report_difference",
      "status": "active"
    }
  ],
  "risks": [
    {
      "name": "粮价失控",
      "level": "中"
    }
  ],
  "latestChanges": [
    "你选择了「追加密奏」",
    "皇帝信任 ↑ 4"
  ],
  "daySummary": {
    "1": "改桑令在浙江官场传开。",
    "2": "三县名册开始流动。"
  }
}
```

---

### 6.4 version 字段

`version` 用于乐观锁，防止多人或多标签页同时提交导致覆盖。

提交决策时：

```sql
UPDATE StoryRun
SET stateJson = nextState, version = version + 1
WHERE id = runId AND version = oldVersion;
```

如果更新数量为 0，说明状态已经变化，前端需要重新拉取。

---

## 7. 核心表 2：StoryEvent

### 7.1 作用

`StoryEvent` 是 append-only 事件流，记录一局中发生过的所有重要事件。

包括：

```text
剧情消息
玩家决策
状态变化
AI 角色反应
隐藏暗线
上下文卡片触发
日终回响
最终裁决
系统事件
```

---

### 7.2 Prisma 模型

```prisma
model StoryEvent {
  id           String   @id @default(cuid())

  runId        String
  run          StoryRun @relation(fields: [runId], references: [id], onDelete: Cascade)

  day          Int
  type         String
  messageType  String?
  roleKey      String?
  visibility   String   @default("private")

  payloadJson  Json

  createdAt    DateTime @default(now())

  @@index([runId, day, createdAt])
  @@index([runId, type])
  @@index([runId, messageType])
  @@index([roleKey])
}
```

---

### 7.3 type 类型

```text
message             剧情消息
decision            玩家决策
state_patch         状态变化
hidden_thread       隐藏暗线
context_card        上下文卡片触发
ai_task_snapshot    AI 任务摘要
day_end             日终回响
final               最终裁决
system              系统事件
```

---

### 7.4 messageType 类型

```text
system_narration    系统叙事
role_action         角色行动 / AI 角色反应
private_intel       私密情报
decision_prompt     待决策消息
decision_result     决策结果消息
day_end             日终回响
final_judgement     最终裁决
```

---

### 7.5 visibility 类型

```text
public       所有人可见
private      当前玩家可见
role_only    指定角色可见
hidden       系统隐藏，不展示给玩家
```

MVP 单人可以都用 `private`。多人异步时再严格控制。

---

## 8. StoryEvent 事件示例

### 8.1 待决策消息

```json
{
  "day": 3,
  "type": "message",
  "messageType": "decision_prompt",
  "roleKey": "zhejiang_governor",
  "visibility": "private",
  "payloadJson": {
    "title": "如何处理巡抚急奏",
    "narrative": "若这封奏疏先到内阁，巡抚便是功臣；若之后民怨爆发，你这个总督就是压不住局的人。",
    "decisionRequired": true,
    "options": [
      {
        "key": "A",
        "title": "截留奏疏",
        "description": "派人追上驿站，暂扣巡抚奏疏。",
        "gain": "阻止巡抚抢功",
        "risk": "巡抚可反咬你压制国策",
        "patch": {
          "总督权威": 8,
          "巡抚敌意": 15,
          "内阁疑心": 10,
          "清算风险": 6
        }
      },
      {
        "key": "B",
        "title": "追加密奏",
        "description": "不阻止巡抚，但另写密奏给皇帝。",
        "gain": "保留解释权",
        "risk": "司礼监关注奏报差异",
        "patch": {
          "皇帝信任": 4,
          "内阁疑心": 2,
          "巡抚敌意": 3,
          "司礼监警惕": 8
        }
      }
    ]
  }
}
```

---

### 8.2 玩家决策事件

```json
{
  "day": 3,
  "type": "decision",
  "roleKey": "zhejiang_governor",
  "visibility": "hidden",
  "payloadJson": {
    "messageEventId": "evt_prompt_003",
    "optionKey": "B",
    "decisionText": "追加密奏",
    "customText": null,
    "guard": {
      "status": "ok",
      "reason": ""
    },
    "statePatch": {
      "皇帝信任": 4,
      "内阁疑心": 2,
      "巡抚敌意": 3,
      "司礼监警惕": 8
    }
  }
}
```

---

### 8.3 决策结果消息

```json
{
  "day": 3,
  "type": "message",
  "messageType": "decision_result",
  "roleKey": "zhejiang_governor",
  "visibility": "private",
  "payloadJson": {
    "title": "你的决策：追加密奏",
    "narrative": "你没有截留巡抚奏疏，而是让幕僚连夜起草密奏。",
    "echo": {
      "personal": "你为自己留下了未来解释权，但也留下越级自保的痕迹。",
      "others": "巡抚听说总督府另有密奏入京，开始怀疑你在京师留了后手。",
      "world": "皇帝信任 +4，内阁疑心 +2，巡抚敌意 +3，司礼监警惕 +8。"
    }
  }
}
```

---

### 8.4 AI 角色反应消息

```json
{
  "day": 3,
  "type": "message",
  "messageType": "role_action",
  "roleKey": "zhejiang_governor",
  "visibility": "private",
  "payloadJson": {
    "title": "京师回声传入巡抚府",
    "speaker": "浙江巡抚",
    "narrative": "巡抚听说总督府另有密奏入京，内容未明，只知其中提到了民心、粮价、不可躁进。幕僚提醒：总督没有拦你，但他在给自己留后手。"
  }
}
```

---

### 8.5 隐藏暗线事件

```json
{
  "day": 3,
  "type": "hidden_thread",
  "roleKey": "system",
  "visibility": "hidden",
  "payloadJson": {
    "title": "司礼监注意奏报差异",
    "triggerDay": 5,
    "risk": "中",
    "source": "司礼监",
    "note": "两份浙江奏报口径不一，内廷可能介入查问。",
    "status": "pending"
  }
}
```

---

### 8.6 ContextCard 触发事件

```json
{
  "day": 5,
  "type": "context_card",
  "roleKey": "system",
  "visibility": "hidden",
  "payloadJson": {
    "cardKey": "sili_report_difference",
    "triggeredBy": ["密奏", "奏报", "司礼监"],
    "usedFor": "resolve_decision",
    "contentDigest": "总督密奏与巡抚急奏口径不一，司礼监介入查问。",
    "sourceEventIds": ["evt_decision_003", "evt_hidden_thread_003"]
  }
}
```

---

## 9. 第三张表：AiTask

### 9.1 为什么建议尽早加

虽然第一版最小只需要两张表，但只要接入真实 AI，就强烈建议加 `AiTask`。

原因：

```text
AI 输出可能失败
JSON 可能解析失败
状态补丁可能不合法
模型可能 hallucinate
token 成本需要统计
失败后需要重试
```

---

### 9.2 Prisma 模型

```prisma
model AiTask {
  id              String   @id @default(cuid())

  runId           String?
  eventId          String?

  taskType         String
  status           String   @default("pending") // pending / running / success / failed / abandoned

  inputJson        Json
  outputJson       Json?
  rawResponse      String?  @db.Text
  normalizedJson   Json?
  errorMessage     String?  @db.Text

  provider         String?
  modelName        String?
  tokenUsageJson   Json?

  startedAt        DateTime?
  completedAt      DateTime?

  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([runId])
  @@index([eventId])
  @@index([taskType, status])
}
```

---

### 9.3 taskType

```text
action_guard
resolve_decision
role_reaction
background_signal
day_end_summary
final_judgement
context_card_select
```

---

## 10. 第四阶段：多人异步表

多人开始后增加：

```text
StoryPlayer
MessageDelivery
```

---

### 10.1 StoryPlayer

```prisma
model StoryPlayer {
  id        String   @id @default(cuid())

  runId     String
  userId    String
  roleKey   String

  status    String   @default("active") // active / offline / ai_controlled
  joinedAt  DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([runId])
  @@index([userId])
  @@unique([runId, roleKey])
}
```

作用：

```text
记录谁在这局里
记录每个人控制哪个角色
玩家不在线时是否 AI 代管
```

---

### 10.2 MessageDelivery

```prisma
model MessageDelivery {
  id          String   @id @default(cuid())

  eventId     String
  runId       String
  userId      String?
  roleKey     String

  status      String   @default("unread") // unread / read / acted / expired
  deliveredAt DateTime @default(now())
  readAt      DateTime?
  actedAt     DateTime?

  @@index([runId, roleKey])
  @@index([eventId])
  @@index([userId])
}
```

作用：

```text
控制某条消息发给谁
记录谁读了
记录谁已经行动
处理多人异步决策
```

---

## 11. ContextCard 设计

### 11.1 第一版先放文件

```text
stories/sangtian/context-cards.json
```

示例：

```json
[
  {
    "key": "sili_report_difference",
    "title": "司礼监注意奏报差异",
    "triggers": ["密奏", "奏报", "司礼监", "皇帝疑心"],
    "content": "总督密奏与巡抚急奏口径不一，司礼监可能在第 5 天介入查问。",
    "visibility": "system",
    "priority": 90
  }
]
```

---

### 11.2 后续再入库

```prisma
model ContextCard {
  id          String   @id @default(cuid())

  templateKey String?
  runId        String?

  key         String
  title       String
  triggersJson Json
  content     String   @db.Text
  visibility  String   @default("system")
  priority    Int      @default(50)

  status      String   @default("active")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([templateKey])
  @@index([runId])
  @@index([key])
}
```

---

## 12. 后端 API 设计

### 12.1 创建故事局

```http
POST /api/v4/story-runs
```

请求：

```json
{
  "templateKey": "sangtian",
  "mode": "single",
  "selectedRole": "zhejiang_governor"
}
```

流程：

```text
读取剧本模板
创建 StoryRun
初始化 stateJson
生成第 1 天 opening messages
写入 StoryEvent
返回 runId
```

---

### 12.2 获取游戏主页面数据

```http
GET /api/v4/story-runs/:runId/dashboard
```

返回：

```json
{
  "run": {},
  "messages": [],
  "activeDecision": {},
  "worldState": {},
  "roleState": {},
  "relationships": [],
  "risks": [],
  "clues": [],
  "hiddenThreads": []
}
```

---

### 12.3 提交决策

```http
POST /api/v4/story-runs/:runId/decisions
```

请求：

```json
{
  "messageEventId": "evt_prompt_003",
  "optionKey": "B",
  "customText": null,
  "version": 3
}
```

流程：

```text
1. 开启数据库事务
2. 读取 StoryRun，并检查 version
3. 读取对应 decision_prompt 事件
4. 如果是自定义，调用 ActionGuard
5. 计算或获取 statePatch
6. 更新 StoryRun.stateJson
7. 写入 decision event
8. 写入 decision_result event
9. 写入 role_reaction event
10. 写入 hidden_thread event
11. version + 1
12. 返回最新 dashboard
```

---

### 12.4 推进到下一天

```http
POST /api/v4/story-runs/:runId/advance-day
```

流程：

```text
1. 确认当天没有未处理 decision_prompt
2. 写入 day_end event
3. currentDay + 1
4. 检查 hiddenThreads 是否触发
5. 触发 ContextCards
6. 写入新一天 opening messages
7. 写入新一天 decision_prompt
8. 更新 StoryRun.stateJson
9. 返回最新 dashboard
```

---

### 12.5 最终裁决

```http
POST /api/v4/story-runs/:runId/finalize
```

流程：

```text
1. 确认 currentDay = 7
2. 读取 StoryRun.stateJson
3. 读取所有 decision events
4. 读取 hidden_thread events
5. 触发结局规则
6. 写入 final event
7. StoryRun.status = finished
```

---

## 13. AI 运行时设计

### 13.1 核心 pipeline

参考 openovel 的 Storykeeper 思想，AI 运行时不应直接改数据库。

统一采用：

```text
buildContext
↓
callModel / mock
↓
normalize
↓
validate
↓
applyPatch
↓
recordEvent
```

---

### 13.2 resolveDecisionWithDirector

输入：

```json
{
  "runId": "run_001",
  "currentDay": 3,
  "message": {},
  "decision": {},
  "worldState": {},
  "roleState": {},
  "recentEvents": [],
  "contextCards": []
}
```

输出：

```json
{
  "resultMessage": {},
  "statePatch": {},
  "roleReactions": [],
  "hiddenThreads": [],
  "contextCardsToActivate": [],
  "dayCanEnd": true
}
```

---

### 13.3 ActionGuard

自定义决策必须先判断：

```text
是否符合角色身份
是否符合时代背景
是否拥有当前资源
是否直接宣布结果
是否操控其他角色
是否跳过剧情阶段
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

## 14. 服务层设计

```text
StoryRunService
  createRun
  getRun
  updateState
  finalize

StoryEventService
  appendEvent
  appendEvents
  listEvents
  findActiveDecision
  filterVisibleEvents

StoryEngineService
  generateDayMessages
  resolveDecision
  advanceDay
  finalize

ActionGuardService
  validateCustomDecision

ContextCardService
  selectTriggeredCards
  activateCards
  summarizeCards

AiTaskService
  createTask
  markRunning
  markSuccess
  markFailed
  retryTask
```

---

## 15. 事务设计

### 15.1 提交决策事务

```ts
await prisma.$transaction(async (tx) => {
  const run = await tx.storyRun.findUnique({ where: { id: runId } });

  if (run.version !== input.version) {
    throw new ConflictError("StoryRun version changed");
  }

  const prompt = await tx.storyEvent.findUnique({
    where: { id: input.messageEventId }
  });

  const guard = await actionGuard.validate(input);

  const result = await storyEngine.resolveDecision({
    run,
    prompt,
    decision: input,
    guard
  });

  const nextState = applyPatch(run.stateJson, result.statePatch);

  await tx.storyRun.update({
    where: { id: runId },
    data: {
      stateJson: nextState,
      version: { increment: 1 }
    }
  });

  await tx.storyEvent.createMany({
    data: [
      result.decisionEvent,
      result.resultMessageEvent,
      ...result.roleReactionEvents,
      ...result.hiddenThreadEvents,
      ...result.contextCardEvents
    ]
  });
});
```

---

### 15.2 推进天数事务

```text
day_end event
hidden_thread triggered events
context_card events
new day opening messages
new decision_prompt
StoryRun.currentDay + 1
StoryRun.version + 1
```

必须在一个事务中完成。

---

## 16. 前端存储抽象

当前前端不要到处直接写 `localStorage`。

先抽象：

```ts
interface StoryStorage {
  createRun(input: CreateRunInput): Promise<StoryRun>;
  getRun(runId: string): Promise<StoryRun>;
  getDashboard(runId: string): Promise<StoryDashboard>;
  submitDecision(input: SubmitDecisionInput): Promise<StoryDashboard>;
  advanceDay(runId: string): Promise<StoryDashboard>;
  finalize(runId: string): Promise<StoryDashboard>;
}
```

第一版：

```text
LocalStoryStorage
```

使用 localStorage。

后端版：

```text
ApiStoryStorage
```

使用 `/api/v4/story-runs/...`。

页面不需要重写。

---

## 17. 推荐目录结构

### 17.1 当前前端阶段

```text
apps/web/public/
  index.html
  styles.css
  app.js
  story-template.js
  story-engine.js
  story-storage.js
```

---

### 17.2 后端阶段

```text
apps/api/src/story-v4/
  story-run.controller.ts
  story-run.service.ts
  story-event.service.ts
  story-engine.service.ts
  action-guard.service.ts
  context-card.service.ts
  ai-task.service.ts
  ai-director.service.ts
  templates/
    sangtian.template.ts
```

---

### 17.3 模板包阶段

```text
packages/templates/src/stories/
  sangtian/
    index.ts
    roles.ts
    days.ts
    endings.ts
    context-cards.ts
```

---

## 18. 开发优先级

### P0：当前立刻做

```text
前端代码重构为 StoryRun / StoryEvent
把 localStorage 封装为 StoryStorage
把《桑田诏》剧本从 UI 代码中抽离为 story-template
保留当前页面功能
```

---

### P1：后端两表

```text
Prisma 增加 StoryRun / StoryEvent
实现 /api/v4/story-runs
实现 dashboard / decisions / advance-day / finalize
前端从 LocalStoryStorage 切换到 ApiStoryStorage
```

---

### P2：AI 调试

```text
增加 AiTask
记录 ActionGuard / resolveDecision / roleReaction / finalJudgement 输入输出
实现失败重试
```

---

### P3：多人异步

```text
增加 StoryPlayer
增加 MessageDelivery
每个角色独立消息流
别人决策转译为你的剧情压力
```

---

### P4：平台化

```text
StoryTemplate 入库
TemplateVersion
后台剧本管理
创作者工作流
```

---

## 19. 最终建议

不要把数据库设计成传统 CRUD。

你的产品是一个**状态化故事运行时**。

第一版数据库只要：

```text
StoryRun 当前快照
StoryEvent 事件流
```

接 AI 后补：

```text
AiTask 后台任务账本
```

多人后补：

```text
StoryPlayer
MessageDelivery
```

平台化后补：

```text
StoryTemplate
TemplateVersion
```

openovel 最值得借鉴的是：

```text
append-only event log
current snapshot
context card trigger
background job ledger
transaction / rollback
foreground fast loop + background slow loop
normalize → validate → apply
```

我们不要照搬它的文件系统，但要把这些思想复制到 Web 后端和数据库设计里。

---

## 20. 一句话总结

> **剧本用 JSON 文件，运行态用 StoryRun + StoryEvent；AI 任务用 AiTask；多人权限用 StoryPlayer + MessageDelivery。整体按 openovel 的“事件日志 + 当前快照 + 后台账本 + 上下文卡片”思想设计，但用数据库实现 Web 多人局。**
