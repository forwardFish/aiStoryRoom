# Many Worlds：多世界文字游戏页面复用与剧本快速接入设计 v1.2

> 文档定位：平台级产品架构、UI 模板约束、世界配置协议与剧本快速接入规范。  
> 适用范围：Many Worlds Web MVP 以及后续新增历史、职场、悬疑、科幻、关系、危机生存等文字推演世界。  
> 核心目标：新增一个剧本时，原则上只新增配置、文本和图片，不新增页面、不复制组件、不重新设计流程。  
> 前台语言：英文。本文档使用中文说明工程与产品规则。  
> 设计原则：**页面属于 Many Worlds，剧情、角色、背景和任务才属于具体世界。**

---

# 1. 核心结论

Many Worlds 本质上不是“多个独立游戏网站的集合”，而是一套统一的 AI 文字推演平台。

不同世界之间真正变化的内容主要是：

```text
世界背景
角色身份
角色头像
角色目标
资源与风险
世界指标
故事正文
决策选项
主动行动
事件结果
结局内容
背景图片
```

而以下内容几乎完全相同：

```text
注册登录
世界浏览
世界详情
单人 / 多人选择
房间列表
创建房间
加入房间
玩家准备
角色选择
主游戏布局
故事阅读
提交决策
AI 推演状态
结果变化
局势记录
等待其他玩家
结局摘要
重新游玩
```

因此正确架构不是：

```text
一个凯撒页面
一个职场页面
一个悬疑页面
一个科幻页面
```

而是：

```text
一套页面模板
+
多份 World Package
+
运行时数据
```

最终要求：

> 新增世界时，不修改页面布局代码；只添加 World Manifest、角色配置、故事配置、图片资源和英文文案。

---

# 2. 四层复用架构

## 2.1 Platform Shell

平台外壳对所有世界完全固定：

```text
Many Worlds Logo
Global Header
Navigation
Account Menu
World Credits
Page Container
Grid System
Button System
Form System
Modal System
Toast
Loading
Error
Empty State
Room Status
Typography
Color Tokens
Responsive Rules
```

固定品牌视觉：

```text
Page Background     #F8F9FD
Card Background     #FFFFFF
Primary Text        #11183F
Secondary Text      #667085
Primary Purple      #5B45F5
Primary Gradient    #4938F5 → #854DF7
Border              #E5E7F2
Success             #20A66A
Warning             #E79A22
Danger              #E3515B
```

世界不能修改：

```text
主按钮颜色
顶部导航颜色
表单结构
房间状态颜色
全局字体
全局圆角
全局阴影
```

## 2.2 Game UI Contract

所有文字推演世界必须遵守统一游戏界面协议：

```text
WorldHeader
RoleSummary
ObjectiveList
ResourceList
RiskList
WorldMetrics
NarrativeTimeline
DecisionComposer
SimulationState
ChangeSummary
ContactList
ActionComposer
SituationRecord
MultiplayerWaitState
GameResultSummary
```

具体世界只能提供数据，不能重新发明另一套主游戏结构。

## 2.3 World Package

每个世界是一份内容包，例如：

```text
rome-44-bc
succession-room
last-night-shift
blackout-protocol
love-in-parallel
```

每个 World Package 提供：

```text
World Manifest
Role Definitions
Public World Copy
Private Role Copy
World Metrics
Resources
Risks
Contacts
Actions
Story Acts
Decision Prompts
Result Rules
Images
Optional Theme Hints
```

World Package 不包含：

```text
页面 JSX
页面 HTML
独立 CSS
独立按钮样式
独立房间组件
独立结果页布局
```

## 2.4 Run State

Run State 保存某一局实际运行数据：

```text
当前世界
当前房间
当前角色
当前章节
当前轮次
玩家决策
其他角色行动
故事时间线
世界指标
角色资源
关系变化
公开信息
私密信息
任务进度
关键事件
结局状态
```

页面只负责读取 World Package 和 Run State，并渲染通用组件。

---

# 3. 固定内容、配置内容、运行内容

## 3.1 固定内容

| 模块 | 固定内容 |
|---|---|
| Global Header | Logo、导航、Credits、用户入口 |
| World Card | 图片比例、标题位置、标签位置、按钮位置 |
| World Detail | Hero 布局、Meta、Role Preview、模式选择 |
| Rooms | Tabs、列表列定义、Create / Join 弹窗 |
| Room Waiting | 玩家列表、角色网格、Ready、Start |
| Role Card | 图片、名称、Hook、Tag、状态 |
| Main Game | 顶部指标、左栏、中间叙事、右栏 |
| Narrative | Story、Decision、Simulation、Change、Incoming Event |
| Result | Ending、Role Ending、Key Decisions、Actions |
| Status | Open、Full、Waiting、In Progress、Completed |
| Error | Network、Not Found、Unauthorized、Conflict |

## 3.2 世界配置内容

| 模块 | 可配置内容 |
|---|---|
| World | 名称、简介、标签、人数、时长 |
| Assets | 封面、Hero、缩略图、角色头像 |
| Roles | 名称、公开 Hook、私人目标、资源、风险 |
| Metrics | 指标名称、图标、范围、初始值 |
| Resources | 资源名称、单位、显示方式 |
| Actions | 可接触人物、可用行动、自定义行动 |
| Narrative | 故事正文、决策、结果、事件 |
| Result | 结局标题、摘要、角色结局、关键选择 |
| Copy | 世界专属英文文案 |

## 3.3 运行时内容

```text
当前指标值
当前资源值
当前任务完成度
当前风险
当前可见角色
当前决策
AI 建议
玩家输入
AI 结果
本次变化
其他角色影响
结局结果
```

---

# 4. 字段上限

为了防止新剧本文案撑坏页面，必须限定长度。

```text
World shortTitle          ≤ 28 characters
World fullTitle           ≤ 72 characters
World tagline             ≤ 100 characters
World shortDescription    ≤ 240 characters
Role roleName             ≤ 24 characters
Role publicHook           ≤ 100 characters
Role tag                  ≤ 28 characters
Room roomName             2–32 characters
Main metricCount          3–6
Main objectiveCount       1–4
Main resourceCount        2–6
Main riskCount            1–4
Main contactCount         0–6
Decision options          2–4
Custom input              ≤ 200 characters
Result endingTitle        ≤ 70 characters
Result keyDecisions       3–5
```

---

# 5. 统一的 8 个核心页面

## 5.1 World Lobby

固定布局：

```text
Global Header
Hero
Featured Worlds
World Grid
Solo / Multiplayer Explanation
Credits Entry
Footer
```

动态内容：

```text
World Card Image
World Title
Genre
Hook
Roles
Duration
Playable / Coming Soon
```

页面不得出现单一世界的大面积专属背景。

## 5.2 Login / Sign Up

完全不绑定任何世界。

允许动态提示：

```text
Continue to ROME, 44 BC
Continue to The Last Night Shift
Return to your room
```

但页面背景、布局、表单都不变。

## 5.3 World Details

固定布局：

```text
Back to Worlds
World Copy
World Hero
World Meta
Role Preview
Solo Mode
Multiplayer Mode
Credits
```

动态插槽：

```text
world.shortTitle
world.fullTitle
world.tagline
world.description
world.heroImage
world.roles
world.tags
world.playerCount
world.duration
world.creditCost
```

限制：

- Hero 图片只能出现在固定图片容器。
- 角色头像只能出现在角色卡。
- 不允许世界专属建筑扩展成整页背景。
- 不允许世界专属字体覆盖全页。
- 页面标题统一使用平台字体。

## 5.4 Rooms

Rooms 必须是跨世界通用房间页。

默认结构：

```text
Rooms
All Worlds
Open Rooms
My Rooms
```

Open Rooms 表格字段：

```text
World
Room
Players
Host
Status
Action
```

从某个 World Details 进入时：

```text
/rooms?worldId=<worldId>
```

显示可清除筛选：

```text
Filtered by: ROME, 44 BC   ×
```

世界名称只是筛选条件，不是页面身份。

Create Room 和 Join with Code 继续使用通用弹窗，不新增独立页面。

## 5.5 Room Waiting & Role Selection

固定布局：

```text
Global Header
Compact World Header
Player List
Role Grid
Invite Area
Ready
Start Game
```

世界素材只允许出现在：

```text
World Thumbnail
Role Portraits
Optional Accent Strip
```

禁止整页使用 Roman Forum、会议室、便利店或空间站背景。

统一角色卡：

```text
Portrait
Role Name
Public Hook
Role Tag
Available / Taken / Selected
```

Host 优先选择属于房间逻辑，与世界无关：

```text
Host chooses first
Lock Role
Invite link unlocks
Other players choose remaining roles
Ready
Start Game
```

## 5.6 Solo Role Selection

Solo 和 Multiplayer 必须共享：

```text
<RoleCard />
<RoleGrid />
<RoleDetails />
```

差异只在角色状态：

```text
Solo: available / coming_soon / selected
Multiplayer: available / taken / selected / locked
```

## 5.7 Main Game

固定骨架：

```text
TopStatusBar
RoleSidebar
NarrativeCenter
ActionSidebar
CriticalEventModal
```

### TopStatusBar

不得写死：

```text
Treasury
Public Support
Grain Price
Caesar Authority
```

必须由配置提供 3–6 个指标。

### RoleSidebar

固定区块：

```text
My Role
Fate Question
Objectives
Resources
Leverage
Risks
```

### NarrativeCenter

只允许标准 Entry Type：

```text
story
decision
simulation
change
incoming_event
active_action
multiplayer_wait
system_error
```

### ActionSidebar

固定结构：

```text
Available Actions
Contacts
Current Progress
Leverage
Custom Action
Continue
```

某世界没有联系人或筹码时，只能通过 Feature Flag 隐藏模块，不能重做右栏。

### Background

世界背景只允许出现在 NarrativeCenter 的弱背景或 StoryBlock Header，透明度 4%–12%。

## 5.8 Game Result

固定区块：

```text
World Identity
Session Complete
Ending Title
Ending Summary
Your Role
Your Ending
Key Decisions
Optional Goals
Optional World State
Actions
```

固定操作：

```text
Play Again
Try Another Role
Back to Worlds
```

不允许模板写死：

```text
Laurel
Senate
King
Republic
Board
Mystery
Survivor
```

世界徽章只作为可选资源。

---

# 6. 通用数据协议

```ts
export interface MetricDefinition {
  key: string;
  label: string;
  icon: PlatformIconKey;
  format: "number" | "percent" | "currency" | "fraction" | "text";
  min?: number;
  max?: number;
  initialValue?: number | string;
  visibility: "public" | "role_private";
}
```

```ts
export interface RoleDefinition {
  key: string;
  name: string;
  portraitUrl: string;
  publicHook: string;
  publicObjective: string;
  fateQuestion: string;
  tag?: string;
  objectives: ObjectiveDefinition[];
  resources: ResourceDefinition[];
  leverage: LeverageDefinition[];
  risks: RiskDefinition[];
  playable: boolean;
  supportedModes: Array<"solo" | "multiplayer">;
}
```

```ts
export interface DecisionPrompt {
  id: string;
  prompt: string;
  options: Array<{
    id: string;
    label: string;
    title: string;
  }>;
  customEnabled: boolean;
  customMaxLength: 200;
  submitLabel: "Submit Decision" | "Submit Response" | "Submit Action";
}
```

```ts
export type NarrativeEntryType =
  | "story"
  | "decision"
  | "simulation"
  | "change"
  | "incoming_event"
  | "active_action"
  | "multiplayer_wait"
  | "system_error";
```

---

# 7. World Manifest

```ts
export interface WorldManifest {
  schemaVersion: "1.0";
  id: string;
  slug: string;
  status: "draft" | "playable" | "coming_soon" | "archived";

  copy: {
    shortTitle: string;
    fullTitle: string;
    tagline: string;
    shortDescription: string;
    detailDescription: string;
  };

  classification: {
    category: string;
    tags: string[];
    contentRating?: string;
  };

  gameplay: {
    minPlayers: number;
    maxPlayers: number;
    minHumanPlayers: number;
    durationLabel: string;
    supportsSolo: boolean;
    supportsMultiplayer: boolean;
    customActionMaxLength: 200;
    creditCost: number;
  };

  assets: {
    cardCover: string;
    heroImage: string;
    roomThumbnail: string;
    narrativeBackground?: string;
    resultCover?: string;
    badgeImage?: string;
  };

  theme: {
    accentColor?: string;
    heroOverlay?: "light" | "dark";
  };

  labels?: Partial<WorldLabelDictionary>;
  metrics: MetricDefinition[];
  roles: RoleDefinition[];

  modules: {
    contacts: boolean;
    leverage: boolean;
    risks: boolean;
    objectives: boolean;
    activeActions: boolean;
    situationRecord: boolean;
  };

  room: {
    defaultNamePattern: string;
    hostRolePriority: boolean;
  };

  result: {
    showGoals: boolean;
    showWorldState: boolean;
    maxKeyDecisions: number;
  };
}
```

---

# 8. 有限 Label Dictionary

默认平台词：

```ts
export interface WorldLabelDictionary {
  world: string;
  role: string;
  objectives: string;
  resources: string;
  leverage: string;
  risks: string;
  actions: string;
  contacts: string;
  progress: string;
  customAction: string;
  situationRecord: string;
  whatChanged: string;
}
```

允许替换标题，不允许替换结构。

示例：

```text
历史权谋：Leverage → Political Leverage
职场：Leverage → Influence
悬疑：Leverage → Evidence
生存：Leverage → Supplies
```

---

# 9. Feature Flag 边界

允许：

```text
showContacts
showLeverage
showRisks
showObjectives
showActiveActions
showSituationRecord
showWorldState
showGoals
```

不允许：

```text
customLayoutType
customSidebarComponent
customRoomPage
customResultPage
customDecisionRenderer
```

---

# 10. 图片资产规范

```text
Card Cover
16:9
1280 × 720

Hero Image
2.2:1
1600 × 720

Room Thumbnail
16:9
640 × 360

Role Portrait
4:5
800 × 1000

Narrative Background
16:9
1600 × 900
Low contrast
No embedded text
4%–12% opacity

Result Cover
2.2:1
Optional
```

---

# 11. 目录结构

```text
apps/web/
├─ components/
│  ├─ platform/
│  ├─ worlds/
│  ├─ rooms/
│  ├─ game/
│  └─ results/
├─ pages/
│  ├─ index.tsx
│  ├─ auth.tsx
│  ├─ worlds/[worldId].tsx
│  ├─ rooms/index.tsx
│  ├─ rooms/[roomId].tsx
│  ├─ role-select.tsx
│  ├─ game.tsx
│  └─ game/result.tsx
└─ worlds/
   ├─ registry.ts
   ├─ rome-44-bc/
   │  ├─ manifest.ts
   │  ├─ roles.ts
   │  ├─ story.ts
   │  └─ assets/
   ├─ succession-room/
   └─ last-night-shift/
```

---

# 12. 剧本快速接入流程

```text
1. 创建 worlds/<world-slug>/
2. 填写 Manifest
3. 创建角色配置
4. 配置 3–6 个世界指标
5. 编写故事与决策配置
6. 上传标准化图片
7. 运行配置验证器
8. 自动进入 World Registry
9. 自动出现在首页、详情、房间、选角、游戏和结果页
```

不手动新增页面。

---

# 13. 用第二世界验证复用

## ROME, 44 BC

```text
Metrics:
Caesar's Authority
Senate Legitimacy
Public Support
Legion Loyalty
Civil War Risk
```

## The Last Night Shift

```text
Metrics:
Time Until Dawn
Public Alert
Power Stability
Store Anomaly
Trust
```

两者使用完全一样的：

```text
TopStatusBar
RoleSidebar
NarrativeCenter
ActionSidebar
DecisionComposer
ResultTemplate
Rooms
RoomWaiting
RoleCard
```

如果第二世界需要重新写页面，说明架构复用失败。

---

# 14. API 必须世界无关

错误：

```text
GET /api/caesar/roles
POST /api/caesar/decision
GET /api/last-night-shift/result
```

正确：

```text
GET  /api/v4/worlds
GET  /api/v4/worlds/:worldId
GET  /api/v4/worlds/:worldId/roles
POST /api/v4/worlds/:worldId/runs
GET  /api/v4/runs/:runId
POST /api/v4/runs/:runId/decisions
POST /api/v4/runs/:runId/actions
GET  /api/v4/runs/:runId/result
GET  /api/v4/rooms
POST /api/v4/rooms
POST /api/v4/rooms/:roomId/join
POST /api/v4/rooms/:roomId/role
POST /api/v4/rooms/:roomId/ready
POST /api/v4/rooms/:roomId/start
```

---

# 15. 版本管理

每个世界必须有版本：

```text
rome-44-bc@1.0.0
rome-44-bc@1.1.0
last-night-shift@1.0.0
```

创建 Run 时锁定：

```text
worldId
worldVersion
```

后续更新剧本不能改变正在进行中的局。

---

# 16. 配置验证器

建议实现：

```ts
validateWorldManifest(manifest)
```

检查：

```text
必填字段
角色数量
角色 key 唯一
指标数量 3–6
图片存在
文本长度
支持模式
最小 / 最大人数
默认房间名称
Feature Flag
Result 配置
```

---

# 17. UI 设计审核规则

将具体世界图片和文字全部替换为灰色占位符。

如果页面仍然成立：

```text
复用合格
```

如果移除罗马图片后页面失去结构：

```text
复用不合格
```

---

# 18. 复用验收标准

新增测试世界时：

```text
不新增 Page Component
不复制 Role Card
不复制 Rooms
不复制 Room Waiting
不复制 Main Game
不复制 Game Result
不修改 Global Header
不增加新的主按钮样式
不增加新的房间状态
```

允许：

```text
新增一个 World Package
新增图片
新增角色
新增故事配置
新增结局配置
新增世界指标
```

量化要求：

```text
页面级代码新增：0
通用组件修改：原则上 0
配置与资源占新增内容的 90% 以上
```

---

# 19. Codex 开发优先级

```text
Phase 1
World Registry
World Manifest Schema
World Card
World Details
Shared Role Card
Rooms
Room Waiting
Game Result

Phase 2
Dynamic Metrics
Dynamic Role Sidebar
Dynamic Action Sidebar
Narrative Entry Renderer
Decision Renderer
Result Renderer

Phase 3
ROME, 44 BC World Package

Phase 4
The Last Night Shift 测试包
```

第二个世界成功运行后，才能认为架构真正可复用。

---

# 20. 最终开发定义

Many Worlds 的开发对象不是“凯撒游戏页面”。

真正需要开发的是：

```text
Multi-World Text Simulation Platform
```

凯撒只是第一份 World Package。

后续每个世界都应当像安装内容包一样接入：

```text
manifest
roles
story
assets
result rules
```

而不是重新开发：

```text
home page
room page
role page
game page
result page
```

最终原则：

> **平台提供稳定的容器，剧本提供变化的内容。**  
> **页面结构越稳定，剧本生产速度越快。**  
> **一个新世界的开发任务，应该主要是编写故事、配置角色和生成图片，而不是重新做前端。**
