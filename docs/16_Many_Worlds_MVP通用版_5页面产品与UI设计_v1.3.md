# Many Worlds：MVP 通用版 5 页面产品与 UI 设计 v1.3

> 文档定位：Many Worlds Web MVP 新增页面设计与通用复用规范。  
> 核心目标：用最少页面打通“选世界 → 登录 → 单人/多人 → 房间 → 游戏 → 结局”流程。  
> 页面范围：**只新增 5 个页面**。  
> 前台语言：全部英文。  
> 复用原则：**页面结构属于 Many Worlds；世界图片、角色、剧情、任务和结局属于具体剧本。**

---

# 0. 本版本修正说明

此前文档把“完整产品中的 8 个核心页面”和“本轮需要新增的页面”混在了一起，导致页面数量和设计复杂度失控。

本版本重新确定：

## 已经存在，直接复用的 3 个页面

```text
1. Home / World Lobby
2. Solo Role Selection
3. Main Game
```

这 3 个页面不在本轮新增设计范围内，只做必要的数据化调整。

## 本轮只新增 5 个页面

```text
1. Login / Sign Up
2. World Details
3. Rooms
4. Room Waiting & Role Selection
5. Game Result
```

因此，本轮最终只需要输出和开发 **5 张新页面设计图**。

---

# 1. MVP 最小完整流程

## 1.1 单人流程

```text
Home
↓
World Details
↓
Login / Sign Up（未登录时）
↓
Solo Role Selection（复用现有页面）
↓
Main Game（复用现有页面）
↓
Game Result
```

## 1.2 多人流程

```text
Home
↓
World Details
↓
Login / Sign Up（未登录时）
↓
Rooms
├─ Join Open Room
├─ Join with Code
└─ Create Room
      ↓
Room Waiting & Role Selection
      ↓
Main Game（复用现有页面）
      ↓
Game Result
```

## 1.3 用户回来继续游戏

```text
Rooms
↓
My Rooms
├─ Waiting → Open Room
├─ In Progress → Continue
└─ Completed → View Result
```

不再新增独立的 `My Games` 页面。

---

# 2. 通用版设计原则

## 2.1 页面不能属于某个剧本

错误：

```text
Caesar Room Page
Caesar Result Page
Caesar Role Page
```

正确：

```text
World Details Template
Rooms Template
Room Waiting Template
Game Result Template
```

凯撒只是其中一份内容数据。

## 2.2 世界只替换内容

每个世界可以替换：

```text
World title
World cover
Hero image
Short description
Genre tags
Role names
Role portraits
Role hooks
World metrics
Objectives
Resources
Risks
Story text
Decision text
Ending text
```

不能替换：

```text
Global Header
Page layout
Button style
Card style
Room status
Role card structure
Result structure
Form structure
```

## 2.3 MVP 优先

每个页面只解决一个问题：

```text
Login：完成认证
World Details：选择 Solo 或 Multiplayer
Rooms：选择、创建或恢复房间
Room Waiting：选角色并准备
Game Result：查看结局和下一步
```

不增加：

```text
聊天室
语音
好友
排行榜
评论
观战
复杂筛选
角色能力树
房间审批
自定义房间规则
世界编辑器
复杂结局图谱
```

---

# 3. 统一平台视觉

平台固定使用：

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

统一规则：

```text
桌面画布：1600 × 1000
内容最大宽度：1440px
顶部导航高度：72px
主卡片圆角：14px
按钮高度：48px
轻描边、轻阴影
```

世界图片只能出现在固定容器中，不能改变整页风格。

---

# 4. 页面 01：Login / Sign Up

## 4.1 路由

```text
/auth
```

## 4.2 页面目标

完成：

```text
Log in
Sign up
Forgot password
Return to previous action
```

## 4.3 页面结构

使用单卡片居中布局，不做复杂品牌展示。

```text
[Many Worlds Logo]

Welcome to Many Worlds

[Log in] [Sign up]

Email address
Password
Remember me
Forgot password?

[Log in]

Terms of Service
Privacy Policy
```

如果用户从某个世界进入：

```text
Continue to ROME, 44 BC
```

如果用户从房间邀请进入：

```text
Log in to join this room
```

## 4.4 登录表单

```text
Email address
Password
Remember me
Forgot password?
Log in
```

## 4.5 注册表单

```text
Email address
Password
Confirm password
Create account
```

## 4.6 必要状态

```text
Invalid email or password
Email already registered
Password must be at least 8 characters
Session expired
Loading
```

## 4.7 MVP 不做

```text
Google login
Apple login
Avatar upload
Nickname setup
Country
Birthday
Onboarding wizard
```

---

# 5. 页面 02：World Details

## 5.1 路由

```text
/worlds/:worldId
```

## 5.2 页面目标

用户只需要确认：

```text
这个世界是什么
有多少角色
大约玩多久
选择 Solo 还是 Multiplayer
```

## 5.3 页面结构

```text
[Back to worlds]

[Left: World Copy]      [Right: Hero Image]

World Title
Tagline
Short Description
Roles / Duration / Genre

[Role Preview]

[Play Solo]    [Play Multiplayer]
```

## 5.4 固定模块

```text
Back to worlds
World Title
Tagline
Short Description
World Meta
Role Preview
Play Solo
Play Multiplayer
Credits
```

## 5.5 动态内容

```text
world.title
world.tagline
world.description
world.heroImage
world.tags
world.roles
world.duration
world.creditCost
```

## 5.6 角色预览

每个角色卡只显示：

```text
Portrait
Name
One-line public hook
```

不显示：

```text
Private objective
Hidden secret
Full resources
Detailed abilities
Ending
```

## 5.7 模式选择

### Solo

```text
Play Solo

Choose one role.
AI controls the remaining characters.

[Choose a Role]
```

### Multiplayer

```text
Play Multiplayer

Join or create a room.
Each player takes a different role.

[Find a Room]
```

## 5.8 页面简化要求

- 不显示长篇世界百科。
- 不显示全部剧情章节。
- 不显示复杂玩法说明。
- 不显示公开评论和评分。
- Hero 只占页面上半部分固定区域。
- 角色卡不超过一行，过多角色使用横向滚动。

---

# 6. 页面 03：Rooms

## 6.1 路由

```text
/rooms
/rooms?worldId=<worldId>
/rooms?tab=my
```

## 6.2 页面目标

完成四件事：

```text
查看可加入房间
查看自己的房间
创建房间
通过邀请码加入
```

## 6.3 页面结构

```text
Rooms

[Open Rooms] [My Rooms]

[All Worlds ▼]

[Room List]

[Join with Code] [Create Room]
```

## 6.4 Open Rooms

列表字段只保留：

```text
World
Room
Players
Status
Action
```

Host 放在 Room 名称下方，不单独占一列。

示例：

```text
ROME, 44 BC
Night Council
Hosted by Alex

3 / 6
Open
[Join]
```

## 6.5 My Rooms

同一页面切换标签：

```text
Waiting
In Progress
Completed
```

对应操作：

```text
Open Room
Continue
View Result
```

不新增独立 `My Games` 页面。

## 6.6 World Filter

只保留一个筛选：

```text
All Worlds ▼
```

从 World Details 进入时显示：

```text
Filtered by: ROME, 44 BC  ×
```

不增加：

```text
Players filter
Status filter
Host filter
Advanced search
Pagination（MVP 可先不做）
```

## 6.7 Create Room Modal

Create Room 不做独立页面。

只保留：

```text
Create a Room

World
Room Name
Max Players
Privacy

[Create Room]
```

Privacy：

```text
Invite Only
Public
```

默认：

```text
Invite Only
```

## 6.8 Join with Code Modal

Join with Code 不做独立页面。

```text
Join with Code

Invite Code
[Enter code]

[Find Room]
```

查找成功：

```text
Room Name
World
Players
Status

[Join Room]
```

## 6.9 必要状态

```text
No open rooms
Room full
Room already started
Invalid invite code
Already joined
Network error
```

---

# 7. 页面 04：Room Waiting & Role Selection

## 7.1 路由

```text
/rooms/:roomId
```

## 7.2 页面目标

只完成：

```text
查看玩家
选择角色
复制邀请
Ready
Start Game
```

## 7.3 页面结构

```text
[Compact World Header]

[Players]          [Choose Your Role]

[Invite Code]

[Ready]            [Start Game]
```

页面不使用整页世界背景。

世界素材只出现在：

```text
World Thumbnail
Role Portraits
```

## 7.4 房间头部

```text
World Thumbnail
World Title
Room Name
Waiting for players
3 / 6 players
Invite Code
Copy
```

## 7.5 玩家列表

每个玩家只显示：

```text
Avatar
Display Name
Host
Selected Role
Ready / Not Ready
```

空位：

```text
Open Seat
```

## 7.6 角色卡

统一结构：

```text
Portrait
Role Name
One-line public hook
Available / Taken / Selected
```

不能写死任何具体角色。

## 7.7 Host 优先选角

创建房间后：

```text
Host chooses first
↓
Host selects a role
↓
Lock Role
↓
Invite code becomes available
↓
Other players join
```

提示：

```text
As the room creator, you choose first.
Lock your role to open the room for invitations.
```

按钮：

```text
Lock Role & Open Room
```

## 7.8 普通玩家流程

```text
Choose Role
↓
Ready
↓
Wait for Host
```

## 7.9 开始条件

```text
至少达到世界配置的 minimum human players
所有真人玩家已选择角色
所有真人玩家已 Ready
角色不能重复
```

未被选择的角色：

```text
由 AI 控制
```

## 7.10 房主功能

MVP 只保留：

```text
Copy Invite Link
Start Game
Close Room
```

不做：

```text
Kick Player
Transfer Host
Change Rules
Approve Join
Room Chat
```

---

# 8. 页面 05：Game Result

## 8.1 路由

```text
/game/result?runId=<runId>
```

## 8.2 页面目标

让用户看到：

```text
世界最终结果
自己的角色结局
关键选择
下一步操作
```

## 8.3 页面结构

```text
[World Thumbnail]
[World Title]
[Session Complete]

Ending Title
Ending Summary

[Your Role + Your Ending]

[Key Decisions]

[Optional World State]

[Play Again] [Try Another Role] [Back to Worlds]
```

## 8.4 MVP 固定模块

```text
Ending Title
Ending Summary
Your Role
Your Ending
Key Decisions
Actions
```

## 8.5 可选模块

只有后端已有数据时才显示：

```text
World State
Goals Completed
```

没有数据则隐藏，不留空卡片。

## 8.6 Key Decisions

最多显示 3 条：

```text
1. Decision summary
2. Decision summary
3. Decision summary
```

## 8.7 固定操作

```text
Play Again
Try Another Role
Back to Worlds
```

## 8.8 MVP 不做

```text
排行榜
玩家排名
复杂关系图
完整因果图
所有隐藏线索
长篇小说下载
评论区
成就系统
```

---

# 9. 现有 3 个页面的最小调整

这 3 个页面不新增，只做必要适配。

## 9.1 Home / World Lobby

只需要保证：

```text
显示 3–5 个世界
可玩世界进入 World Details
Coming Soon 世界不可进入
```

## 9.2 Solo Role Selection

沿用现有页面，只把角色数据改成动态加载：

```text
world.roles
```

统一状态：

```text
Available
Selected
Coming Soon
```

## 9.3 Main Game

沿用现有三栏结构：

```text
TopStatusBar
RoleSidebar
NarrativeCenter
ActionSidebar
```

只将以下内容改成动态配置：

```text
World metrics
Role
Objectives
Resources
Risks
Contacts
Story
Decision
Result
```

多人只增加一个状态：

```text
Your decision has been submitted.
Waiting for other players...
2 / 3 submitted
```

---

# 10. 最小 World Package

每个新世界只需要提供：

```ts
export interface WorldPackage {
  id: string;
  title: string;
  tagline: string;
  description: string;

  minPlayers: number;
  maxPlayers: number;
  minHumanPlayers: number;
  durationLabel: string;
  creditCost: number;

  assets: {
    cardCover: string;
    heroImage: string;
    roomThumbnail: string;
    narrativeBackground?: string;
  };

  roles: Array<{
    key: string;
    name: string;
    portraitUrl: string;
    publicHook: string;
    playable: boolean;
  }>;

  metrics: Array<{
    key: string;
    label: string;
    icon: string;
    format: "number" | "percent" | "currency" | "text";
  }>;

  modules: {
    contacts: boolean;
    leverage: boolean;
    risks: boolean;
    objectives: boolean;
    activeActions: boolean;
  };
}
```

新增世界时不允许新增页面代码。

---

# 11. 最小 API

```text
POST /api/v4/auth/register
POST /api/v4/auth/login
GET  /api/v4/auth/me

GET  /api/v4/worlds
GET  /api/v4/worlds/:worldId
GET  /api/v4/worlds/:worldId/roles

GET  /api/v4/rooms
GET  /api/v4/rooms/mine
POST /api/v4/rooms
POST /api/v4/rooms/join-by-code
GET  /api/v4/rooms/:roomId
POST /api/v4/rooms/:roomId/role
POST /api/v4/rooms/:roomId/ready
POST /api/v4/rooms/:roomId/start
POST /api/v4/rooms/:roomId/close

GET  /api/v4/runs/:runId/result
```

---

# 12. MVP 明确不做

```text
独立 Create Room 页面
独立 Join Room 页面
独立 My Games 页面
复杂房间筛选
房间聊天
语音
好友
观战
房主转让
踢人
审批加入
开始后加入
排行榜
评论
复杂结局分析
世界编辑器
自定义页面模板
```

---

# 13. 5 张 UI 出图清单

只生成以下 5 张独立页面：

```text
01. Login / Sign Up
02. World Details
03. Rooms
04. Room Waiting & Role Selection
05. Game Result
```

要求：

- 每张图单独输出。
- 全部英文。
- 风格统一。
- 白色 / 浅灰背景。
- 紫蓝品牌色。
- 不使用整页世界背景。
- 页面结构必须能直接替换其他世界内容。
- 不增加文档未定义的功能。

---

# 14. 开发验收标准

## 14.1 页面数量

- [ ] 本轮只新增 5 个页面。
- [ ] Create Room 使用弹窗。
- [ ] Join with Code 使用弹窗。
- [ ] My Rooms 使用 Rooms 页标签。
- [ ] 不新增独立 My Games 页面。

## 14.2 完整流程

- [ ] 用户可以从 Home 进入 World Details。
- [ ] 未登录时进入 Login。
- [ ] Solo 能进入现有 Role Selection。
- [ ] Multiplayer 能进入 Rooms。
- [ ] 用户可以创建或加入房间。
- [ ] Host 可以优先锁定角色。
- [ ] 玩家可以 Ready。
- [ ] Host 可以 Start Game。
- [ ] 游戏结束后进入 Game Result。

## 14.3 通用复用

- [ ] 页面组件中不写死 Caesar。
- [ ] Rooms 可以同时展示不同世界。
- [ ] Role Card 使用通用字段。
- [ ] Game Result 不使用世界专属固定装饰。
- [ ] 新增第二世界不增加页面代码。

## 14.4 MVP 简洁度

- [ ] 每个页面只有一个主要任务。
- [ ] Rooms 只有一个世界筛选。
- [ ] Room Waiting 不包含聊天。
- [ ] Game Result 最多显示 3 个关键选择。
- [ ] 没有排行榜、评论、关系图和复杂设置。

---

# 15. 最终定义

Many Worlds MVP 不是要先做一个大型游戏平台。

第一阶段只需要完成：

```text
用户注册登录
↓
选择一个世界
↓
选择 Solo 或 Multiplayer
↓
选择角色
↓
开始文字推演
↓
查看结局
```

多人模式只需要：

```text
选择房间
创建房间
邀请码加入
Host 优先选角
玩家 Ready
Host Start Game
```

最终原则：

> **功能完整优先于页面丰富。**  
> **页面越少，流程越清晰。**  
> **所有世界共用一套页面，新增剧本只替换内容。**
