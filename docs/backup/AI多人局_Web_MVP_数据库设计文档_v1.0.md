# AI 多人局｜数据库与存储设计文档 v1.0

> 文档类型：数据库设计 / 存储架构 / 后端落地方案  
> 适用产品：AI 多人局 Web MVP  
> 首个故事局：《桑田诏：嘉靖财政危局》  
> 当前阶段：Web 单人 MVP → 后端化 → 多人异步  
> 核心结论：**剧本用文本 / JSON；运行中的局势用数据库。实现先简单，方向按数据库设计。**

---

# 0. 本文档解决什么问题

本文档回答三个问题：

1. **现在是否必须上数据库？**
2. **如果上数据库，最小要几张表？**
3. **如何从当前 localStorage / 静态前端平滑迁移到后端数据库，而不是推倒重来？**

最终方案不是一开始做复杂系统，而是：

```text
方向按数据库设计
实现先用轻量存储
接口按后端形态封装
后续平滑迁移 PostgreSQL + Prisma
```

---

# 1. 核心结论

## 1.1 不要一开始做复杂数据库

当前 Web MVP 最重要的是验证玩法：

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

因此，早期不应把精力投入到复杂多表设计。

不建议一开始就做：

```text
StoryMessage
PlayerDecision
RelationshipState
Clue
HiddenThread
MessageDelivery
AiTask
EndingRecord
ContextCard
StoryPlayer
TemplateVersion
```

这会拖慢 MVP。

---

## 1.2 也不要随便写成不可迁移的 localStorage 玩具

当前可以使用 `localStorage` / JSON mock，但数据结构必须提前按未来数据库抽象：

```text
StoryRun = 当前这一局的快照
StoryEvent = 这一局发生过的消息、决策、状态变化、结局事件
```

这样后续迁移数据库时，只需要替换存储层，不需要重写游戏逻辑和页面。

---

## 1.3 推荐最终路线

```text
阶段 0：前端 localStorage，但结构模拟后端
阶段 1：后端化，只建 2 张表：StoryRun + StoryEvent
阶段 2：多人异步，增加 StoryPlayer + MessageDelivery + AiTask
阶段 3：平台化，增加 StoryTemplate + TemplateVersion + 运营后台
```

---

# 2. 剧本和局势的边界

## 2.1 剧本用文本 / JSON

剧本是静态内容，适合放在文件里：

```text
stories/
  sangtian/
    story.json
    roles.json
    days.json
    endings.json
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
```

原因：

```text
1. 好编辑
2. 好版本管理
3. Git 可以记录变化
4. 新增剧本时复制一套配置即可
5. 不需要后台系统也能快速改剧本
```

---

## 2.2 局势用数据库

局势是运行时状态，必须能够被恢复、查询、并发控制。

数据库保存：

```text
这一局是谁创建的
当前第几天
玩家选了什么
已经出现哪些剧情消息
玩家做了哪些决策
世界变量变成多少
人物关系如何变化
隐藏暗线有哪些
最终结局是什么
```

一句话：

> **剧本是模板，局势是玩家实际玩出来的那一局。**

---

# 3. 为什么数据库有意义

数据库不是为了“存文本”，而是为了管理运行时状态。

## 3.1 单人场景的价值

即使单人，也需要数据库解决：

```text
刷新页面恢复进度
跨设备继续游戏
查看历史局
生成结局分享
统计用户玩到第几天流失
分析哪个决策最常选
调试 AI 输出失败
```

---

## 3.2 多人场景的价值

多人异步开始后，数据库价值会非常明显：

```text
谁在这局里
每个人是什么角色
谁能看哪条消息
谁已经读了消息
谁还没有决策
谁的决策会影响别人
AI 推演后如何更新共同状态
玩家不在线时如何保留消息
多人同时提交时如何防止覆盖
```

这部分用文本文件会非常难做。

---

# 4. 最小数据库设计原则

## 4.1 MVP 只需要两张表

第一版后端化只建：

```text
StoryRun
StoryEvent
```

不要急着拆复杂表。

---

## 4.2 使用 JSONB 保存可变状态

不同故事局的变量不同：

```text
桑田诏：
国库银、民心、粮价、改桑进度、皇帝信任

融资前夜：
现金流、估值、控制权、投资人信任

晋升名单公布前：
老板信任、项目进度、背锅风险
```

如果每个变量都单独建字段，平台化会很僵硬。

所以 MVP 用：

```text
stateJson
payloadJson
```

来承载动态结构。

---

## 4.3 事件流 + 当前快照

推荐采用：

```text
StoryRun = 当前局势快照
StoryEvent = 历史因果流水
```

这样可以同时满足：

```text
快速打开当前游戏
完整回放历史
最终结局复盘
AI 调试
后续统计分析
```

---

# 5. 核心表 1：StoryRun

## 5.1 作用

`StoryRun` 表示一局正在进行或已经完成的游戏。

一局游戏一条记录。

它保存当前状态快照。

---

## 5.2 Prisma 模型

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

## 5.3 stateJson 结构

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
  "clues": [
    "海防军饷压力",
    "巡抚越级倾向"
  ],
  "hiddenThreads": [
    {
      "id": "thread_001",
      "title": "司礼监注意奏报差异",
      "triggerDay": 5,
      "risk": "中",
      "source": "司礼监",
      "note": "两份浙江奏报口径不一，内廷可能介入查问。"
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

## 5.4 为什么加 version 字段

多人或多标签页操作时，需要防止并发覆盖。

提交决策时可以做乐观锁：

```text
更新 StoryRun
WHERE id = runId AND version = oldVersion
```

成功后：

```text
version + 1
```

如果失败，说明状态已被别人更新，需要重新拉取。

---

# 6. 核心表 2：StoryEvent

## 6.1 作用

`StoryEvent` 记录一局中发生过的所有重要事件。

包括：

```text
剧情消息
玩家决策
状态变化
AI 角色反应
隐藏暗线
日终回响
最终裁决
```

---

## 6.2 Prisma 模型

```prisma
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
  @@index([roleKey])
}
```

---

## 6.3 type 类型

```text
message        剧情消息
decision       玩家决策
state_patch    状态变化
hidden_thread  隐藏暗线
day_end        日终回响
final          最终裁决
system         系统事件
```

---

## 6.4 messageType 类型

当 `type = message` 时使用：

```text
system_narration   系统叙事
role_action        其他角色行动 / AI 角色反应
private_intel      私密情报
decision_prompt    待决策消息
decision_result    决策结果消息
day_end            日终回响
final_judgement    最终裁决
```

---

## 6.5 visibility 类型

```text
public       所有人可见
private      当前玩家可见
role_only    指定角色可见
hidden       系统隐藏，不展示给玩家
```

MVP 单人可以都用：

```text
private
```

多人异步时再严格控制。

---

# 7. StoryEvent 示例

## 7.1 系统叙事消息

```json
{
  "day": 3,
  "type": "message",
  "messageType": "system_narration",
  "roleKey": "zhejiang_governor",
  "visibility": "private",
  "payloadJson": {
    "title": "粮价三日连涨",
    "narrative": "杭州米价三日内上涨两成。粮铺外开始有人排队，百姓口中已经把改桑二字和没粮连在了一起。",
    "speaker": "系统",
    "decisionRequired": false
  }
}
```

---

## 7.2 角色行动消息

```json
{
  "day": 3,
  "type": "message",
  "messageType": "role_action",
  "roleKey": "zhejiang_governor",
  "visibility": "private",
  "payloadJson": {
    "title": "巡抚急奏北上",
    "speaker": "浙江巡抚",
    "narrative": "驿站快马离开杭州府。有人看见巡抚幕僚亲自护送一封急奏北上。奏中不提粮价和拒签田契，只写桑田之政已有成效。",
    "decisionRequired": false
  }
}
```

---

## 7.3 待决策消息

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

## 7.4 玩家决策事件

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

## 7.5 决策结果消息

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

## 7.6 AI 角色反应消息

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

## 7.7 隐藏暗线事件

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

## 7.8 日终回响

```json
{
  "day": 3,
  "type": "day_end",
  "messageType": "day_end",
  "roleKey": "zhejiang_governor",
  "visibility": "private",
  "payloadJson": {
    "title": "第 3 天 · 日终回响",
    "narrative": "今日之后，局势开始分叉。巡抚的奏疏已经在路上，商会的粮仓仍未完全打开，县令送来的暗账只露出一角。你的每一步都开始留下痕迹。",
    "summary": {
      "importantDecisions": [
        "追加密奏"
      ],
      "stateChangeSummary": [
        "皇帝信任 +4",
        "巡抚敌意 +3"
      ],
      "hiddenThreadSummary": [
        "司礼监注意奏报差异"
      ]
    }
  }
}
```

---

# 8. 前端当前阶段如何设计

## 8.1 不直接到处写 localStorage

当前可以继续用 `localStorage`，但必须通过 Storage 抽象。

```ts
interface StoryRunStorage {
  createRun(input: CreateRunInput): Promise<StoryRun>;
  getRun(runId: string): Promise<StoryRun>;
  updateRun(runId: string, patch: Partial<StoryRun>): Promise<StoryRun>;

  listEvents(runId: string): Promise<StoryEvent[]>;
  appendEvent(runId: string, event: StoryEvent): Promise<StoryEvent>;
}
```

第一版：

```ts
class LocalStoryRunStorage implements StoryRunStorage {
  // 内部用 localStorage
}
```

后端版：

```ts
class ApiStoryRunStorage implements StoryRunStorage {
  // 内部用 fetch('/api/v4/...')
}
```

这样页面层不用关心存储方式。

---

## 8.2 前端模块建议

```text
apps/web/public/
  app.js
  styles.css
  story-template.js
  story-engine.js
  story-storage.js
```

如果暂时不拆文件，也至少在 `app.js` 中逻辑分层：

```text
Template Data
Runtime State
StoryEngine
StoryStorage
View Render
Event Binding
```

---

# 9. 后端 API 设计

## 9.1 创建故事局

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

后端流程：

```text
读取剧本模板
创建 StoryRun
初始化 stateJson
生成第 1 天开局消息
写入 StoryEvent
返回 runId
```

返回：

```json
{
  "runId": "run_001",
  "currentDay": 1,
  "totalDays": 7
}
```

---

## 9.2 获取当前局

```http
GET /api/v4/story-runs/:runId
```

返回：

```json
{
  "id": "run_001",
  "templateKey": "sangtian",
  "status": "playing",
  "currentDay": 3,
  "totalDays": 7,
  "selectedRole": "zhejiang_governor",
  "stateJson": {}
}
```

---

## 9.3 获取事件流

```http
GET /api/v4/story-runs/:runId/events
```

可以按角色过滤：

```http
GET /api/v4/story-runs/:runId/events?roleKey=zhejiang_governor
```

返回：

```json
{
  "events": []
}
```

---

## 9.4 获取游戏主页面数据

为了前端方便，可以提供聚合接口：

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

## 9.5 提交决策

```http
POST /api/v4/story-runs/:runId/decisions
```

请求：

```json
{
  "messageEventId": "evt_prompt_003",
  "optionKey": "B",
  "customText": null
}
```

后端流程：

```text
1. 读取 StoryRun
2. 读取对应 decision_prompt 事件
3. 如果是自定义，调用 ActionGuard
4. 计算 statePatch
5. 更新 StoryRun.stateJson
6. 写入 decision 事件
7. 写入 decision_result 消息事件
8. 写入 AI 角色反应消息事件
9. 写入 hidden_thread 事件
10. 返回最新 dashboard
```

返回：

```json
{
  "run": {},
  "newEvents": [],
  "statePatch": {},
  "dashboard": {}
}
```

---

## 9.6 推进到下一天

```http
POST /api/v4/story-runs/:runId/advance-day
```

后端流程：

```text
1. 确认当天没有未处理 decision_prompt
2. 写入 day_end 事件
3. currentDay + 1
4. 检查 hiddenThreads 是否触发
5. 写入新一天 opening messages
6. 写入新一天 decision_prompt
7. 更新 StoryRun.stateJson
8. 返回最新 dashboard
```

---

## 9.7 最终裁决

```http
POST /api/v4/story-runs/:runId/finalize
```

后端流程：

```text
1. 确认 currentDay = 7
2. 读取 StoryRun.stateJson
3. 读取所有 decision 事件
4. 读取 hidden_thread 事件
5. 根据结局规则生成最终结局
6. 写入 final 事件
7. StoryRun.status = finished
```

---

# 10. 服务层设计

## 10.1 StoryRunService

负责：

```text
创建故事局
读取故事局
更新当前天数
更新 stateJson
结束故事局
```

---

## 10.2 StoryEventService

负责：

```text
追加事件
查询事件流
根据 roleKey / visibility 过滤事件
查找当前待决策消息
```

---

## 10.3 StoryEngineService

负责：

```text
根据剧本模板生成当天消息
根据玩家决策计算结果
生成日终回响
生成最终裁决
```

---

## 10.4 ActionGuardService

负责：

```text
校验自定义决策是否合法
判断是否越权
返回 ok / rewrite_needed / blocked
```

---

## 10.5 AiDirectorService

MVP 可以先 mock。

后续接入模型后负责：

```text
生成剧情润色
生成玩家决策结果
生成 AI 角色反应
生成最终结局文本
```

---

# 11. 事务设计

## 11.1 提交决策必须是事务

提交决策时必须保证：

```text
StoryRun 状态更新
decision 事件写入
decision_result 消息写入
AI 角色反应消息写入
hidden_thread 写入
```

要么全部成功，要么全部失败。

伪代码：

```ts
await prisma.$transaction(async (tx) => {
  const run = await tx.storyRun.findUnique({ where: { id: runId } });

  const prompt = await tx.storyEvent.findUnique({ where: { id: messageEventId } });

  const decision = await tx.storyEvent.create({
    data: {
      runId,
      day: run.currentDay,
      type: "decision",
      roleKey,
      payloadJson: decisionPayload
    }
  });

  const nextState = applyPatch(run.stateJson, statePatch);

  await tx.storyRun.update({
    where: {
      id: runId
    },
    data: {
      stateJson: nextState,
      version: { increment: 1 }
    }
  });

  await tx.storyEvent.createMany({
    data: [
      resultMessage,
      reactionMessage,
      hiddenThread
    ]
  });
});
```

---

## 11.2 推进天数也必须是事务

推进天数时必须保证：

```text
日终回响
隐藏暗线触发
新一天开局消息
新一天决策消息
currentDay + 1
```

一起完成。

---

# 12. 多人异步扩展

当进入多人阶段，新增三张表。

## 12.1 StoryPlayer

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

---

## 12.2 MessageDelivery

```prisma
model MessageDelivery {
  id         String   @id @default(cuid())
  eventId    String
  runId      String
  userId     String?
  roleKey    String

  status     String   @default("unread") // unread / read / acted
  deliveredAt DateTime @default(now())
  readAt     DateTime?
  actedAt    DateTime?

  @@index([runId, roleKey])
  @@index([eventId])
}
```

作用：

```text
控制某条消息发给谁
记录谁读了
记录谁已经针对消息行动
```

---

## 12.3 AiTask

```prisma
model AiTask {
  id              String   @id @default(cuid())
  runId           String?
  eventId          String?

  taskType         String   // action_guard / resolve_decision / role_reaction / final_judgement
  status           String   @default("pending") // pending / success / failed

  inputJson        Json
  outputJson       Json?
  rawResponse      String?  @db.Text
  errorMessage     String?  @db.Text

  provider         String?
  modelName        String?
  tokenUsageJson   Json?

  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([runId])
  @@index([taskType, status])
}
```

作用：

```text
记录 AI 输入输出
失败可重试
便于调试
便于成本统计
```

---

# 13. 未来表拆分策略

## 13.1 什么时候拆 StoryMessage / PlayerDecision

当你需要：

```text
复杂统计
后台查看消息
按消息状态查询
多人权限过滤
AI 结果复盘
```

可以把 `StoryEvent` 拆成：

```text
StoryMessage
PlayerDecision
StatePatch
HiddenThread
EndingRecord
```

但 MVP 不拆。

---

## 13.2 什么时候把 StoryTemplate 入库

当你需要：

```text
后台管理剧本
创作者提交剧本
剧本审核
剧本发布
剧本版本回滚
```

再把剧本从文件迁移到数据库。

---

# 14. 推荐目录结构

## 14.1 当前前端阶段

```text
apps/web/public/
  index.html
  app.js
  styles.css
```

短期可以先保持。

---

## 14.2 下一步前端重构

```text
apps/web/public/
  index.html
  styles.css
  story-template.js
  story-engine.js
  story-storage.js
  app.js
```

---

## 14.3 后端阶段

```text
apps/api/src/story-v4/
  story-run.controller.ts
  story-run.service.ts
  story-event.service.ts
  story-engine.service.ts
  action-guard.service.ts
  ai-director.service.ts
  templates/
    sangtian.template.ts
```

---

## 14.4 模板包阶段

```text
packages/templates/src/stories/
  sangtian/
    index.ts
    roles.ts
    days.ts
    endings.ts
```

---

# 15. 最终建议

## 15.1 当前不要直接上复杂数据库

现在最重要的是验证游戏主循环。

继续用轻量存储是可以的。

---

## 15.2 但从现在开始按数据库形态写

数据结构必须保持：

```text
StoryRun
StoryEvent
```

页面和引擎都围绕这两个概念组织。

---

## 15.3 第一版后端只上两张表

```text
StoryRun
StoryEvent
```

足够支持：

```text
单人 Web MVP
恢复进度
消息流
玩家决策
状态变化
最终结局
```

---

## 15.4 多人开始再加三张表

```text
StoryPlayer
MessageDelivery
AiTask
```

足够支持：

```text
多人异步
角色消息权限
AI 调试
失败重试
```

---

# 16. 最重要的一句话

> **剧本可以先用 JSON 文件；局势最终必须进数据库。但数据库第一版只需要 StoryRun + StoryEvent 两张表。**

这样既不会过度设计，也不会把当前代码写成未来无法迁移的 Demo。 
