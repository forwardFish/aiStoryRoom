# Many Worlds：MVP 精简产品流程与页面设计 v1.1
## Caesar-first / General Multi-World Version

> 文档用途：
>
> 1. 替代《13_AI多人剧情推演_MVP完整产品流程_缺失8页面_UI交互设计_v1.0》中过度复杂的 8 页面方案。
> 2. 作为 Codex 开发首页到主游戏完整流程的产品规格。
> 3. 作为后续生成独立 UI 设计图和自动化验收的依据。
>
> 重要调整：
>
> - 第一款正式可玩世界改为 **ROME, 44 BC — CAESAR: THE LAST SPRING OF THE REPUBLIC**。
> - Many Worlds 是多世界平台，页面结构不能绑定单一历史剧本。
> - 所有用户可见界面文案必须使用英文。
> - MVP 不追求复杂功能，只保证用户能够完成注册、选世界、选模式、进入房间、选角色、开始游戏和回看结局。
> - 原方案中的“创建房间页、加入房间页、我的游戏页”不再分别做成独立页面。
> - `Create Room`、`Join with Code` 合并到房间列表页中，以弹窗完成。
> - `My Games` 合并为房间列表页中的 `My Rooms` 标签。
>
> 视觉基准：
>
> - 延续当前 Many Worlds 英文首页的国际化视觉。
> - 白色和极浅灰背景。
> - 深海军蓝标题。
> - 紫蓝渐变主按钮。
> - 简洁卡片、轻描边、轻阴影、适度圆角。
> - 世界插画根据剧本变化，平台 UI 结构保持一致。
> - 不使用旧式米黄宣纸、朱红主按钮和只适用于中国历史题材的视觉语言。

---

# 1. 最终结论：MVP 不需要 8 个新增页面

原设计将以下功能拆成了 8 个独立页面：

```text
Login / Sign Up
World Details
Room Hub
Create Room
Join Room
Room Waiting
My Games
Game Result
```

对于当前 MVP 来说过于复杂。

重新合并后，完整产品只需要：

## 已经存在或可以沿用的 3 个页面

```text
01. World Lobby / Home
02. Solo Role Selection
03. Main Game
```

## 需要新增的 5 个独立页面

```text
04. Login / Sign Up
05. World Details
06. Rooms（包含 Open Rooms、My Rooms、Create Room、Join with Code）
07. Room Waiting & Role Selection
08. Game Result
```

最终产品总共 8 个核心页面，但只需要新增 5 个。

---

# 2. 页面合并关系

| 原方案 | 新方案 | 处理方式 |
|---|---|---|
| 登录 / 注册页 | Login / Sign Up | 保留独立页面 |
| 剧本详情页 | World Details | 保留独立页面 |
| 房间大厅页 | Rooms | 保留，但大幅精简 |
| 创建房间页 | Create Room Modal | 合并进 Rooms 页面 |
| 加入房间页 | Join with Code Modal | 合并进 Rooms 页面 |
| 房间等待与准备页 | Room Waiting & Role Selection | 保留独立页面 |
| 我的游戏页 | My Rooms Tab | 合并进 Rooms 页面 |
| 游戏结局页 | Game Result | 保留，但大幅精简 |

因此不会继续设计：

```text
独立 Create Room 页面
独立 Join Room 页面
独立 My Games 页面
```

---

# 3. MVP 完整流程

## 3.1 未登录用户浏览

```text
World Lobby / Home
  ↓
World Details
  ↓
选择 Play Solo 或 Play Multiplayer
  ↓
Login / Sign Up
  ↓
登录后返回原操作
```

## 3.2 单人流程

```text
World Lobby
  ↓
World Details
  ↓ Play Solo
Login / Sign Up（未登录时）
  ↓
Solo Role Selection
  ↓
Main Game
  ↓
Game Result
```

## 3.3 多人流程

```text
World Lobby
  ↓
World Details
  ↓ Play Multiplayer
Login / Sign Up（未登录时）
  ↓
Rooms
  ├─ Join an Open Room
  ├─ Join with Code
  └─ Create Room
          ↓
Room Waiting & Role Selection
          ↓
Main Game
          ↓
Game Result
```

## 3.4 用户回来继续游戏

```text
顶部导航 My Rooms
  ↓
Rooms?tab=my
  ├─ Waiting → Open Room
  ├─ In Progress → Continue
  └─ Completed → View Result
```

---

# 4. 路由设计

| 页面 | 路由 | 说明 |
|---|---|---|
| World Lobby / Home | `/` | 复用当前首页，不再新增独立大厅 |
| Login / Sign Up | `/auth` | 登录注册 |
| World Details | `/worlds/:worldId` | 世界介绍与模式选择 |
| Solo Role Selection | `/role-select?worldId=<id>` | 已存在，单人使用 |
| Rooms | `/rooms?worldId=<id>&tab=open` | 多人房间选择 |
| My Rooms | `/rooms?tab=my` | 同一个 Rooms 页面中的标签 |
| Room Waiting | `/rooms/:roomId` | 选角色、邀请、准备、开始 |
| Main Game | `/game?runId=<runId>` | 已存在 |
| Game Result | `/game/result?runId=<runId>` | 结局摘要 |

邀请链接：

```text
/join/<inviteCode>
```

不单独渲染一个加入页面，而是重定向到：

```text
/rooms?joinCode=<inviteCode>
```

并自动打开 `Join with Code` 弹窗。

---

# 5. 全局设计原则

## 5.1 平台是多世界平台

Many Worlds 的固定部分：

```text
Logo
Global Navigation
Account
World Credits
Buttons
Cards
Form Controls
Room System
```

根据世界变化的部分：

```text
Cover Art
World Name
Role Portraits
World Description
Genre Tags
Room Background
Game Content
```

例如：

```text
ROME, 44 BC
The Succession Room
The Last Night Shift
Blackout Protocol
Love in Parallel
```

都使用同一套平台结构，只替换世界内容。

## 5.2 所有前台文字使用英文

文档可以用中文说明，但设计稿和开发页面只能出现英文。

顶部导航统一：

```text
Explore Worlds
Rooms
My Rooms
World Credits
Log in
Get started
```

登录后：

```text
Explore Worlds
Rooms
My Rooms
20 World Credits
User Avatar
```

## 5.3 每个页面只有一个核心目标

```text
World Lobby：选择世界
World Details：选择 Solo 或 Multiplayer
Rooms：选择、创建或恢复房间
Room Waiting：选角色并准备
Main Game：做决策
Game Result：查看结局
```

不在一个页面中叠加大量次级功能。

## 5.4 MVP 禁止增加的复杂功能

```text
房间聊天
语音聊天
好友系统
观战
房主等级
用户等级
公开排行榜
复杂筛选
角色能力树
房间审批
房间插件
服务器区域
回合时间复杂配置
游戏开始后加入
角色竞拍
主持人后台
```

---

# 6. 页面 01：World Lobby / Home

## 6.1 是否新增

不新增。

直接复用当前 Many Worlds 首页，并让首页同时承担早期的“世界大厅”功能。

## 6.2 MVP 首页需要保留的内容

首页前期只需要：

```text
Hero
Featured Worlds
World Card Grid
Solo / Multiplayer explanation
Pricing or Credits entry
Footer
```

其他过长营销内容可以保留，但不影响主流程。

核心世界列表区域标题：

```text
Worlds worth stepping into
```

副标题：

```text
Every world begins with a situation already in motion.
Choose a role, make your decisions, and see what changes.
```

## 6.3 前期世界数量

建议只展示 3—5 个世界。

示例：

### 可玩世界

```text
ROME, 44 BC
Caesar trusts you. The conspirators need you.
Rome will judge whatever survives.

1–6 roles
40–60 min
History & Power

[View World]
```

### 预告世界

```text
The Succession Room
The founder is stepping down.
The board is divided.

Coming Soon
```

```text
The Last Night Shift
Five strangers. One shift.
Different truths.

Coming Soon
```

```text
Blackout Protocol
A citywide blackout.
Resources fade fast.

Coming Soon
```

## 6.4 世界卡只显示

```text
Cover Image
Genre
World Title
One-line Hook
Roles
Duration
Playable / Coming Soon
```

不显示：

```text
房间列表
复杂评分
评论
用户热度
排行榜
多个价格套餐
```

## 6.5 点击行为

可玩世界：

```text
View World
→ /worlds/rome-44-bc
```

预告世界：

```text
Coming Soon
→ 不跳转，或打开简单提示
```

---

# 7. 页面 02：Login / Sign Up

## 7.1 路由

```text
/auth
```

## 7.2 页面目标

只完成：

```text
注册
登录
找回密码
登录后返回原路径
```

## 7.3 MVP 页面结构

采用简单两栏结构：

```text
[左侧品牌区]            [右侧表单卡片]

Many Worlds             Log in / Sign up
一句品牌文案             Email
简单插画                 Password
                         Submit
```

左侧不需要复杂功能展示。

## 7.4 英文文案

左侧：

```text
Welcome back to Many Worlds

Your choices, alliances, and actions shape the worlds.
Log in to continue your story.
```

登录卡：

```text
Log in
Sign up

Email address
Password
Remember me
Forgot password?

Log in
```

注册卡：

```text
Create your account

Email address
Password
Confirm password

Create account
```

底部：

```text
By continuing, you agree to our Terms of Service
and Privacy Policy.
```

## 7.5 MVP 不做

```text
Google 登录（除非当前已经完成）
Apple 登录
用户名设置
头像上传
年龄、性别、国家
复杂的新用户引导
```

## 7.6 登录返回

必须支持：

```text
/auth?returnTo=/worlds/rome-44-bc
/auth?returnTo=/rooms?worldId=rome-44-bc
/auth?returnTo=/game?runId=xxx
```

登录成功后回到 `returnTo`。

---

# 8. 页面 03：World Details

## 8.1 路由

```text
/worlds/rome-44-bc
```

## 8.2 页面目标

用户只需要在该页面确认：

```text
这个世界是什么
有哪些角色
玩多久
选择 Solo 还是 Multiplayer
```

不做长篇世界百科。

## 8.3 Caesar 世界英文内容

世界短标题：

```text
ROME, 44 BC
```

完整标题：

```text
CAESAR: THE LAST SPRING OF THE REPUBLIC
```

一句钩子：

```text
Caesar trusts you.
The conspirators need you.
Rome will judge whatever survives.
```

简介：

```text
Caesar has been named dictator for life.

The Senate fears a king.
The legions still adore him.
Every player enters Rome with a different future to protect.

History remembers one outcome.
Your Rome does not have to.
```

元信息：

```text
1–6 Roles
40–60 Minutes
History & Power
Private Objectives
Alternate History
```

## 8.4 页面结构

```text
[Back to worlds]

[左侧世界信息]              [右侧主视觉]

ROME, 44 BC                 World Cover
完整标题
一句钩子
简介
元信息

[角色预览]

[Play Solo]  [Play Multiplayer]
```

## 8.5 角色预览

只显示 6 个公开角色：

```text
Brutus
Caesar trusts you. Rome expects you to stop him.

Caesar
You ended the civil war. Why should the Senate limit you?

Cassius
A republic that cannot act is already dead.

Mark Antony
Save Caesar—or inherit everything he built.

Decimus
Caesar trusts you enough to follow you into danger.

Cicero
Everyone wants your words. No one wants your rules.
```

角色卡只显示：

```text
Portrait
Name
One-line public hook
```

不显示：

```text
私人目标
隐藏秘密
全部资源
完整能力
结局
```

## 8.6 模式选择

### Solo

```text
Play Solo

Choose one role.
AI controls the remaining characters.
Play at your own pace.

[Choose a Role]
```

点击：

```text
未登录 → /auth?returnTo=/role-select?worldId=rome-44-bc
已登录 → /role-select?worldId=rome-44-bc
```

### Multiplayer

```text
Play Multiplayer

Join or create a room.
Each player takes a different role.
Your choices affect every other player.

[Find a Room]
```

点击：

```text
未登录 → /auth?returnTo=/rooms?worldId=rome-44-bc
已登录 → /rooms?worldId=rome-44-bc
```

## 8.7 Credits

页面底部只显示一行：

```text
Starts from 20 World Credits
```

或测试阶段：

```text
Free during MVP testing
```

不做复杂价格解释。

---

# 9. 页面 04：Rooms

## 9.1 路由

```text
/rooms?worldId=rome-44-bc&tab=open
```

用户从顶部点击 `My Rooms`：

```text
/rooms?tab=my
```

两个状态属于同一个页面。

## 9.2 页面目标

完成四件事：

```text
查看可加入房间
查看自己的房间
创建房间
通过邀请码加入
```

## 9.3 页面顶部

```text
Rooms

Join an open room, create your own,
or continue a room you already joined.
```

如果从某个世界进入：

```text
World: ROME, 44 BC
```

右侧按钮：

```text
Join with Code
Create Room
```

## 9.4 标签

只保留两个标签：

```text
Open Rooms
My Rooms
```

不做：

```text
Joined
Waiting
Public
Private
Needs Your Turn
Completed
```

这些状态直接在 `My Rooms` 列表中显示。

## 9.5 Open Rooms

只显示尚未开始且仍可加入的房间。

每行只需要：

```text
Room Name
Players
Host
Status
Action
```

示例：

```text
Night Council
2 / 6
Hosted by Alex
Open
[Join]
```

```text
The Ides Can Be Changed
3 / 6
Hosted by Morgan
Open
[Join]
```

```text
Save the Republic
6 / 6
Hosted by Riley
Full
[Full]
```

不显示正在游戏中的房间。

原因：

```text
MVP 不允许中途加入。
```

## 9.6 My Rooms

显示用户创建或加入的所有房间。

状态只保留：

```text
Waiting
In Progress
Completed
```

示例：

```text
Night Council
ROME, 44 BC
Host
Waiting · 3 / 6
[Open Room]
```

```text
The Ides Can Be Changed
ROME, 44 BC
Role: Brutus
In Progress
[Continue]
```

```text
A New Republic
ROME, 44 BC
Role: Cicero
Completed
[View Result]
```

这样不需要额外的 `My Games` 页面。

---

# 10. Create Room Modal

## 10.1 触发

Rooms 页面点击：

```text
Create Room
```

打开右侧抽屉或中央弹窗。

不进入新页面。

## 10.2 只保留 3 个字段

```text
Room Name
Max Players
Privacy
```

示例：

```text
Create a Room

World
ROME, 44 BC

Room Name
Alex's Rome

Max Players
3 / 4 / 5 / 6

Privacy
Invite Only
Public

[Create Room]
```

## 10.3 默认值

```text
Room Name:
<username>'s Room

Max Players:
6

Privacy:
Invite Only
```

## 10.4 不做的配置

```text
Turn time limit
Allow late join
Voice & chat
Host approval
AI settings
Custom rules
Region
Password
Spectators
```

## 10.5 创建成功

```text
Create Room
→ /rooms/<roomId>
```

---

# 11. 创建者优先选择角色规则

这是多人房间最重要的 MVP 规则之一。

## 11.1 规则定义

```text
房间创建者是 Host。
Host 在邀请其他玩家之前，先选择并锁定一个角色。
Host 锁定角色后，邀请链接才可以使用。
后来加入的玩家只能从剩余角色中选择。
```

## 11.2 流程

```text
Create Room
  ↓
进入 Room Waiting
  ↓
Host chooses a role
  ↓
Lock Role
  ↓
Invite code becomes active
  ↓
Other players join and choose remaining roles
```

## 11.3 前台提示

```text
Host Role Priority

As the room creator, you choose first.
Lock your role to open the room for invitations.
```

主按钮：

```text
Lock Role & Open Room
```

## 11.4 锁定规则

- Host 锁定前不能复制邀请链接。
- Host 锁定后才显示邀请码。
- 第一名其他玩家加入后，Host 不再允许更换角色。
- 其他玩家的角色选择必须以服务端锁定结果为准。
- 同一个角色不能被两人选择。

---

# 12. Join with Code Modal

## 12.1 触发

Rooms 页面点击：

```text
Join with Code
```

打开弹窗。

## 12.2 内容

```text
Join with Code

Invite Code
[ROME-4421]

[Find Room]
```

查询成功：

```text
Night Council
ROME, 44 BC

Host: Alex
Players: 2 / 6
Status: Open

[Join Room]
```

查询失败：

```text
Room not found.
Check the code and try again.
```

## 12.3 邀请深链

访问：

```text
/join/ROME-4421
```

自动：

```text
登录校验
→ /rooms?joinCode=ROME-4421
→ 打开 Join with Code 弹窗
```

不额外设计 Join Room 页面。

---

# 13. 页面 05：Room Waiting & Role Selection

## 13.1 路由

```text
/rooms/:roomId
```

## 13.2 页面目标

只完成：

```text
查看玩家
选择角色
复制邀请
Ready
Start Game
```

不做聊天和复杂房间管理。

## 13.3 页面结构

```text
[World / Room Header]

[左侧 Players]           [右侧 Choose Your Role]

[Invite Link]

[Ready]                  [Start Game]
```

建议比例：

```text
Players：30%
Roles：70%
```

## 13.4 房间头部

```text
ROME, 44 BC
Night Council

Waiting for players
3 / 6 players
```

Host 锁定角色后显示：

```text
Invite Code: ROME-4421
[Copy Invite Link]
```

## 13.5 玩家列表

只显示：

```text
Avatar
Display Name
Host label
Selected Role
Ready / Not Ready
```

示例：

```text
Alex Morgan
Host · Brutus
Ready
```

```text
Jordan Lee
Caesar
Ready
```

```text
Taylor Kim
No role selected
Not Ready
```

空位：

```text
Open Seat
```

## 13.6 角色卡

使用 Caesar 的 6 个核心角色：

```text
Brutus
Caesar
Cassius
Mark Antony
Decimus
Cicero
```

角色状态：

```text
Available
Selected by You
Taken
```

卡片只显示：

```text
Portrait
Name
One-line public hook
Status
```

## 13.7 Host 首次进入

Host 先看到：

```text
Choose your role first

As the room creator, you have first choice.
Your invite link will unlock after you lock a role.
```

按钮：

```text
Lock Role & Open Room
```

锁定后才展示邀请码。

## 13.8 普通玩家

普通玩家进入后：

```text
Choose one of the remaining roles.
```

选择后点击：

```text
Ready
```

未选角色时 `Ready` 禁用。

## 13.9 开始条件

Caesar 多人模式支持：

```text
Minimum players: 3
Maximum players: 6
```

未被真人选择的角色由 AI 控制。

开始条件：

```text
至少 3 名玩家
所有已加入玩家都选择了角色
所有已加入玩家都 Ready
```

Host 按钮：

```text
Start Game
```

未满足时：

```text
Start Game（Disabled）
```

提示：

```text
Waiting for all players to be ready.
```

## 13.10 MVP 房主权限

只保留：

```text
Copy Invite Link
Start Game
Close Room
```

不做：

```text
Kick Player
Transfer Host
Change World
Change Rules
Ban User
Approve Join Request
```

## 13.11 Host 离开

游戏开始前：

```text
Close this room?

The room will be closed for all players.
```

MVP 直接关闭房间，不做房主转让。

---

# 14. 页面 06：Solo Role Selection

## 14.1 是否新增

不新增。

沿用已有角色选择页，但内容替换为 Caesar 世界。

## 14.2 单人角色

```text
Brutus
Caesar
Cassius
Mark Antony
Decimus
Cicero
```

MVP 如果仍只完成一个角色：

```text
Brutus：Playable
其他角色：Coming Soon
```

## 14.3 页面英文标题

```text
Choose Your Role
```

世界：

```text
ROME, 44 BC
CAESAR: THE LAST SPRING OF THE REPUBLIC
```

按钮：

```text
Confirm Role & Enter
```

---

# 15. 页面 07：Main Game

## 15.1 是否新增

不新增。

继续使用：

```text
/game?runId=<runId>
```

单人与多人共用同一主游戏框架。

## 15.2 多人额外状态

只增加一个最小状态：

```text
Your decision has been submitted.

Waiting for other players...
2 / 3 submitted
```

不增加复杂多人控制台。

---

# 16. 页面 08：Game Result

## 16.1 路由

```text
/game/result?runId=<runId>
```

## 16.2 页面目标

让用户知道：

```text
世界最后发生了什么
我的角色结局是什么
我做了哪些关键选择
下一步可以做什么
```

## 16.3 MVP 页面只保留 4 个区块

### 1. Ending

```text
ROME, 44 BC
Session Complete

A Republic Without a Master

Caesar survived, but accepted limits on his authority.
Rome avoided civil war—for now.
```

### 2. Your Role

```text
Your Role
Brutus

Your Ending
The Reluctant Architect
```

### 3. Key Decisions

最多 3 条：

```text
You demanded limits on Caesar's lifetime authority.
You refused to expand the conspiracy.
You brought the final dispute before the Senate.
```

### 4. Actions

```text
Play Again
Try Another Role
Back to Worlds
```

## 16.4 可选最小数据

如果后端已经有数据，可以增加：

```text
Goals Completed: 2 / 3
World State: Fragile Stability
```

不要增加：

```text
Top 15% of players
复杂影响关系图
多层时间线
隐藏线索全集
下载完整小说
排行榜
```

这些以后再做。

---

# 17. 全局顶部导航

## 未登录

```text
Many Worlds
Explore Worlds
Rooms
How It Works
World Credits

Log in
Get started
```

## 已登录

```text
Many Worlds
Explore Worlds
Rooms
My Rooms
World Credits

User Avatar
```

其中：

```text
Explore Worlds → /
Rooms → /rooms?tab=open
My Rooms → /rooms?tab=my
World Credits → /credits
```

---

# 18. 最小数据结构

## 18.1 World

```ts
export interface WorldSummary {
  id: string;
  title: string;
  fullTitle?: string;
  hook: string;
  coverUrl: string;
  genre: string;
  minPlayers: number;
  maxPlayers: number;
  durationLabel: string;
  status: "playable" | "coming_soon";
}
```

## 18.2 Room

```ts
export interface RoomSummary {
  id: string;
  worldId: string;
  name: string;
  hostUserId: string;
  hostDisplayName: string;
  inviteCode: string;
  privacy: "invite_only" | "public";
  status: "waiting" | "in_progress" | "completed" | "closed";
  currentPlayers: number;
  maxPlayers: number;
}
```

## 18.3 Room Member

```ts
export interface RoomMember {
  userId: string;
  displayName: string;
  isHost: boolean;
  roleKey?: string;
  roleName?: string;
  ready: boolean;
}
```

## 18.4 Role

```ts
export interface PublicRole {
  key: string;
  name: string;
  portraitUrl: string;
  publicHook: string;
  status: "available" | "taken" | "selected";
}
```

---

# 19. 最小后端能力

## 19.1 Authentication

```text
Register
Login
Logout
Get Current User
Restore Session
```

## 19.2 Worlds

```text
List Worlds
Get World Details
List Public Roles
```

## 19.3 Rooms

```text
List Open Rooms
List My Rooms
Create Room
Find Room by Invite Code
Join Room
Get Room
Select Role
Set Ready
Start Room
Close Room
```

## 19.4 Runs

```text
Create Solo Run
Create Multiplayer Run
Get Run
Continue Run
Get Result
```

---

# 20. 关键业务规则

## 20.1 用户必须登录

以下操作必须登录：

```text
Play Solo
Play Multiplayer
Create Room
Join Room
Select Role
Start Game
Open My Rooms
Enter Game
View Private Result
```

## 20.2 房间创建幂等

重复点击 `Create Room`：

```text
只能创建一个房间。
```

## 20.3 加入房间幂等

同一用户重复加入：

```text
返回已有成员记录。
```

## 20.4 角色唯一

```text
roomId + roleKey
```

在等待房间中必须唯一。

## 20.5 Host 优先选择

创建房间以后：

```text
Host 必须先锁定角色。
未锁定前，不开放邀请链接。
```

## 20.6 开始游戏

多人开始必须检查：

```text
当前用户是 Host
房间状态是 waiting
真人玩家数量 ≥ 3
所有真人玩家已选角色
所有真人玩家已 Ready
所有角色没有重复
```

剩余角色：

```text
由 AI 控制。
```

---

# 21. MVP 明确不做

```text
独立 Create Room 页面
独立 Join Room 页面
独立 My Games 页面
公开房间复杂筛选
游戏开始后加入
观战
房间聊天
语音
好友
房主转让
踢人
房间审批
用户等级
世界评分
评论
排行榜
复杂结局分析
完整多主角小说下载
角色能力树
自定义世界编辑器
```

---

# 22. UI 出图清单

新的页面出图不再是 8 张新增页面。

只需要重新设计 5 张新增页面：

```text
01. Login / Sign Up
02. World Details — ROME, 44 BC
03. Rooms — Open Rooms
04. Room Waiting & Role Selection
05. Game Result
```

此外保留并修改现有 3 张：

```text
06. World Lobby / Home
07. Solo Role Selection — Caesar
08. Main Game — Caesar
```

总计仍为 8 张核心产品图，但页面体系更简单。

---

# 23. 开发验收标准

## 23.1 World Lobby

- [ ] 首页展示 3—5 个真实世界卡。
- [ ] 只有可玩世界能够进入详情。
- [ ] `ROME, 44 BC` 可以进入世界详情。
- [ ] 首页不展示房间列表。

## 23.2 Authentication

- [ ] 用户可以注册。
- [ ] 用户可以登录。
- [ ] 登录后返回 `returnTo`。
- [ ] 未登录不能创建 Run 或 Room。
- [ ] 登录失效后可以重新登录并返回原页面。

## 23.3 World Details

- [ ] 显示 Caesar 世界介绍。
- [ ] 显示 1—6 Roles 和 40—60 Minutes。
- [ ] 显示 6 个公开角色。
- [ ] `Play Solo` 进入单人选角。
- [ ] `Play Multiplayer` 进入 Rooms。
- [ ] 页面不绑定中国历史视觉。

## 23.4 Rooms

- [ ] `Open Rooms` 只显示等待中且可加入房间。
- [ ] `My Rooms` 显示 Waiting、In Progress、Completed。
- [ ] Create Room 使用弹窗。
- [ ] Join with Code 使用弹窗。
- [ ] 没有独立 Create Room 和 Join Room 页面。
- [ ] 用户可从 My Rooms 恢复游戏。

## 23.5 Room Waiting

- [ ] Host 创建后先选择角色。
- [ ] Host 锁定角色后才可邀请。
- [ ] 后加入用户不能选择 Host 已锁角色。
- [ ] 同一角色不能被多人锁定。
- [ ] 玩家选择角色后可以 Ready。
- [ ] 至少 3 位真人玩家时可开始。
- [ ] 未被选择的角色由 AI 控制。
- [ ] 所有真人玩家 Ready 后 Host 才能开始。

## 23.6 Main Game

- [ ] 单人和多人都进入 `/game`。
- [ ] 多人提交后显示等待其他玩家。
- [ ] 不增加复杂多人控制面板。

## 23.7 Game Result

- [ ] 显示世界结局。
- [ ] 显示玩家角色结局。
- [ ] 显示最多 3 个关键选择。
- [ ] 可以 Play Again。
- [ ] 可以 Try Another Role。
- [ ] 可以 Back to Worlds。
- [ ] 不显示复杂排行榜和关系图。

## 23.8 English UI

- [ ] 所有前台页面为英文。
- [ ] 不出现中文按钮、标题或状态。
- [ ] Caesar 世界使用 `ROME, 44 BC` 作为市场短标题。
- [ ] 平台页面仍可用于其他世界。

---

# 24. 最终 MVP 产品结构

```text
Home / World Lobby
  ↓
World Details
  ↓
Login / Sign Up
  ↓
Choose Mode
  ├─ Solo
  │    ↓
  │  Role Selection
  │    ↓
  │  Main Game
  │
  └─ Multiplayer
       ↓
     Rooms
       ├─ Join Open Room
       ├─ Join with Code
       └─ Create Room
              ↓
       Host Chooses Role First
              ↓
       Other Players Join and Choose
              ↓
       Ready
              ↓
       Start Game
              ↓
       Main Game

Main Game
  ↓
Game Result
  ↓
Play Again / Try Another Role / Back to Worlds
```

最终原则：

> **MVP 的目标不是把房间系统设计得像大型游戏平台，而是让用户可以用最少步骤进入一个世界。**
>
> **选择世界、选择单人或多人、选择角色、开始推演，这四件事必须清晰。**
>
> **Create Room、Join Room 和 My Rooms 必须存在，但不需要分别占用独立页面。**
>
> **房间创建者的唯一早期优势，是在邀请其他玩家之前优先选择并锁定角色。**
