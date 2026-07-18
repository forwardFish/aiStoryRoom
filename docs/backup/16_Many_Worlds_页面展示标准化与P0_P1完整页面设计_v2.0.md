# Many Worlds：页面展示标准化与 P0 / P1 完整页面设计 v2.0

> 文档类型：产品页面设计规范 + 前端实现约束 + 上线闭环页面说明  
> 适用项目：`aiStoryRoom / Many Worlds Web MVP`  
> 前台语言：英文  
> 文档说明语言：中文  
> 版本：v2.0  
> 日期：2026-07-14

---

# 1. 文档目标

当前项目的主要问题不是“缺少功能”，而是：

1. 页面虽然已经实现，但信息层级不稳定。
2. 同一类信息在不同页面重复展示。
3. 页面为了“看起来完整”加入了过多非核心信息。
4. 页面主操作不够突出，用户不知道下一步应该做什么。
5. 世界内容与平台结构混在一起，导致页面像“凯撒专属网站”，而不是可复用的 Many Worlds 平台。
6. 支付、邀请、结果分享等闭环页面，虽然功能存在，但展示方式没有形成统一标准。

本次设计不重做已有玩法，只完成以下目标：

> 每个页面只保留完成当前任务所需的信息。  
> 每个页面只能有一个最明确的主操作。  
> 所有世界共用同一套页面结构。  
> 世界差异只通过图片、角色、文本、指标和运行数据体现。

---

# 2. 产品级页面原则

## 2.1 一个页面只解决一个核心问题

| 页面 | 用户当前唯一核心问题 |
|---|---|
| 首页 | 我可以进入哪些世界？ |
| 登录注册 | 我怎样继续当前操作？ |
| 世界详情 | 这个世界是否值得进入？ |
| Rooms | 我应该加入哪个房间？ |
| 邀请落地页 | 这个邀请是否有效，我怎样加入？ |
| 等候房 | 谁已经进入、我选什么角色、何时开始？ |
| 主游戏页 | 当前发生了什么，我现在怎么决定？ |
| 解锁门槛 | 为什么需要解锁，我应该怎么继续？ |
| Credits | 我需要买多少点数才能回到游戏？ |
| 支付状态页 | 是否已经到账，我怎么回到原房间？ |
| 结果页 | 我的结局是什么，下一步做什么？ |
| 分享页 | 这局公开发生了什么，我是否想体验？ |
| 我的房间 | 我有哪些未完成或已完成的局？ |

如果一个区块不能帮助用户回答当前页面的核心问题，就不应默认展示。

## 2.2 主操作唯一

每个页面只能有一个视觉权重最高的主按钮。

示例：

```text
世界详情：Choose a Role 或 Find a Room
等候房：Start Game
主游戏：Submit Decision / Continue
钱包：Buy Credits
支付成功：Return to Room
结果页：Play Again
邀请页：Sign In to Join
```

其他操作统一使用：

```text
Secondary Button
Text Link
Overflow Menu
```

禁止同一屏出现 3 个以上相同权重的渐变按钮。

## 2.3 信息按“当前需要”逐级展开

页面默认只显示：

```text
当前必须理解的信息
当前必须选择的信息
完成当前任务的操作
```

详细内容通过以下方式展开：

```text
View details
View all
Modal
Drawer
Accordion
Secondary page section
```

## 2.4 平台结构固定，世界内容可替换

平台固定内容：

```text
Global Header
Page Container
Card System
Button System
Tabs
Status Badge
Modal
Toast
Empty State
Error State
Loading State
```

世界可配置内容：

```text
世界名称
世界图片
角色头像
角色 Hook
指标
目标
资源
风险
联系人
故事正文
决策选项
结果
```

移除所有罗马图片、罗马文本后，页面结构仍然必须成立。

---

# 3. 全局视觉与布局标准

## 3.1 颜色

```text
Page Background       #F8F9FD
Card Background       #FFFFFF
Primary Text          #11183F
Secondary Text        #667085
Muted Text            #98A2B3
Primary Purple        #5B45F5
Primary Gradient      #4938F5 → #854DF7
Border                #E5E7F2
Divider               #EEF0F6
Success               #20A66A
Success Background    #EAF8F1
Warning               #E79A22
Warning Background    #FFF5E5
Danger                #E3515B
Danger Background     #FDECEE
Info                   #3B6DF6
Info Background       #EDF3FF
```

世界主题色只能用于：

```text
世界标签
弱背景装饰
局部插图
世界图片
```

不能覆盖全局主按钮、导航、状态色和文字系统。

## 3.2 字体

建议统一使用：

```text
UI Font: Inter
Fallback: system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif
```

字号：

```text
Page Title            36 / 44 / 700
Hero Title            48 / 56 / 700
Section Title         20 / 28 / 700
Card Title            16 / 24 / 600
Body                   14 / 22 / 400
Secondary              13 / 20 / 400
Label                  12 / 18 / 600
Button                 14 / 20 / 600
```

避免在同一个页面同时使用多种标题字体。

## 3.3 页面宽度

```text
Desktop Max Width      1440px
Main Content Width     1280–1360px
Page Horizontal Gap    24–32px
Header Height          72px
Section Vertical Gap   24px
Card Padding           20–24px
Card Radius            16px
Small Radius           10–12px
```

## 3.4 阴影

只保留两级：

```text
Card Shadow:
0 4px 16px rgba(17, 24, 63, 0.05)

Elevated Shadow:
0 12px 32px rgba(17, 24, 63, 0.10)
```

禁止每个小组件都使用阴影。

## 3.5 按钮标准

### Primary Button

```text
背景：紫色渐变
高度：44–48px
圆角：10–12px
文字：白色
每个页面原则上只有 1 个
```

### Secondary Button

```text
背景：白色
边框：#D6D9EA
文字：#11183F 或 #5B45F5
```

### Danger Button

只用于：

```text
Revoke Share
Leave Room
Delete / Remove
```

### Disabled

```text
禁止只降低透明度到几乎看不见
必须保持文字可读
必须取消 hover 和点击反馈
```

## 3.6 状态标签

统一状态：

```text
Open          Green
Waiting       Orange
In Progress   Blue
Completed     Green
Full          Red
Closed        Gray
Expired       Gray
Taken         Red
Available     Green
Selected      Purple
Ready         Green
Not Ready     Orange
```

世界不能添加新的状态颜色。

---

# 4. 全局 Header 标准

所有平台页面使用同一个 Header。

## 4.1 固定结构

```text
Left:
Many Worlds Logo

Center:
Explore Worlds
Rooms
World Credits

Right:
Help
Language
Account Menu
```

## 4.2 显示规则

### 未登录

```text
Explore Worlds
Rooms
World Credits
Help
English
Sign In
```

### 已登录

```text
Explore Worlds
Rooms
World Credits
Help
English
Avatar Menu
```

## 4.3 不显示

```text
My Rooms 作为独立顶级导航
Account 作为独立顶级导航
世界名称作为全局导航项
当前角色作为全局导航项
通知中心（MVP 不做）
```

“My Rooms”属于 Rooms 页面内部的 Tab，而不是独立顶级导航。

---

# 5. 页面总表

| 编号 | 页面 | 路由 | 优先级 | 页面类型 |
|---|---|---|---|---|
| UI-01 | World Lobby | `/` | P0 | 既有页面标准化 |
| UI-02 | Login / Sign Up | `/auth` | P0 | 既有页面标准化 |
| UI-03 | World Details | `/worlds/:worldId` | P0 | 既有页面标准化 |
| UI-04 | Rooms | `/rooms` | P0 | 既有页面标准化 |
| UI-05 | Room Invite Landing | `/join?roomCode=` | P0 | 复用 `join.html` |
| UI-06 | Room Waiting & Role Selection | `/rooms/:roomId` | P0 | 既有页面标准化 |
| UI-07 | Solo Role Selection | `/role-select` | P0 | 复用角色组件 |
| UI-08 | Main Game | `/room-game` | P0 | 保留既有骨架 |
| UI-09 | Room Unlock Paywall | 主游戏内状态 | P0 | 主游戏内状态 |
| UI-10 | World Credits | `/credits` | P0 | 既有页面标准化 |
| UI-11 | Payment Status | `/credits-success` | P0 | 通用状态页 |
| UI-12 | Game Result | `/game/result` | P0 | 既有页面标准化 |
| UI-13 | Share Management Modal | 结果页弹层 | P0 | 弹层 |
| UI-14 | Public Story Recap | `/share/:token` | P0 | 唯一新增页面 |
| UI-15 | My Rooms | `/rooms?tab=my` | P1 | Rooms 内部 Tab |
| UI-16 | Account | `/credits?tab=account` | P1 | Credits 内部 Tab |
| UI-17 | Orders & Activity | `/credits?tab=orders` | P1 | Credits 内部 Tab |
| UI-18 | Help / Legal / Support | `/legal` | P1 | 既有页面标准化 |

---

# 6. UI-01：World Lobby

## 6.1 页面目标

帮助用户快速理解产品，并选择一个世界进入。

## 6.2 页面结构

```text
Global Header
Hero
Featured Worlds
World Grid
Solo / Multiplayer Explanation
World Credits Entry
Footer
```

## 6.3 Hero 必须显示

```text
平台定位标题
一句简短解释
Explore Worlds
Create a Room
轻量平台插图
```

推荐英文：

```text
One platform. Infinite worlds.
Your choices shape every story.

Explore AI-powered worlds alone or with friends.
Every role has its own goals, secrets, and consequences.
```

## 6.4 Hero 不显示

```text
长篇产品介绍
功能列表
价格表
具体世界角色
新闻公告
用户评价轮播
复杂动画
```

## 6.5 世界卡片必须显示

```text
Card Cover
World Title
1–2 Tags
Roles
Duration
Playable / Coming Soon
View World
```

世界卡片不显示：

```text
完整世界简介
所有角色头像
所有指标
Credits 详细规则
多人房间数量
评价和评分
```

## 6.6 首屏建议

最多展示 6 张世界卡。

MVP 只有一个可玩世界时：

```text
ROME, 44 BC       Playable
The Last Night Shift   Coming Soon
其他世界          Coming Soon
```

Coming Soon 卡片不能出现可点击的 “Play” 按钮。

---

# 7. UI-02：Login / Sign Up

## 7.1 页面目标

完成登录或注册，并返回用户原来的受控操作。

## 7.2 页面结构

```text
Minimal Header
Brand Area
Auth Card
Return Context Notice
Form
Primary Action
Secondary Link
Security Note
```

## 7.3 必须显示

```text
Sign In / Create Account Tab
Email
Password
Confirm Password（仅注册）
Terms Checkbox（仅注册）
Primary Submit
Return Context Notice（存在 returnTo 时）
```

邀请回流示例：

```text
Continue to join Night Council
After signing in, you’ll return to the invited room.
```

支付回流示例：

```text
Sign in to return to Night Council
Your progress and payment context will be preserved.
```

## 7.4 不显示

```text
世界详情
角色列表
用户余额
房间内部数据
测试账号入口
验证码明文
开发环境 Token
```

## 7.5 主操作

```text
Sign In
或
Create Account
```

一个状态只显示一个主按钮。

## 7.6 错误状态

错误提示显示在对应输入框下方，不使用浏览器原生 alert。

```text
Invalid email address
Incorrect email or password
This email is already registered
Your session expired. Please sign in again.
```

---

# 8. UI-03：World Details

## 8.1 页面目标

让用户判断是否进入该世界，并选择单人或多人模式。

## 8.2 页面结构

```text
Back to Worlds
World Copy
World Hero
World Meta
Role Preview
Play Solo
Play Multiplayer
Credit Note
```

## 8.3 Hero 左侧只显示

```text
Category · Tag
Full Title
Tagline
Short Description
Meta Pills
```

建议最多：

```text
标题 2–3 行
Tagline 2 行
描述 3 行
Meta 5 个
```

## 8.4 Hero 右侧

只放固定比例 Hero Image。

```text
Ratio: 2.2:1
不铺满页面
不进入 Header
不作为全页背景
```

## 8.5 Role Preview

每张角色卡只显示：

```text
Portrait
Role Name
Public Hook（最多 2–3 行）
Role Tag（可选）
```

不显示：

```text
隐藏目标
完整资源
完整风险
私人关系
角色结局
```

## 8.6 模式卡

### Play Solo

```text
Choose one role.
AI controls the remaining roles.
```

主操作：

```text
Choose a Role
```

### Play Multiplayer

```text
Create or join a room.
Each player takes a different role.
```

主操作：

```text
Find a Room
```

## 8.7 Credits 展示

只显示一句：

```text
Free to start · Unlock the full world with World Credits
```

不要在世界详情页展示全部套餐。

---

# 9. UI-04：Rooms

## 9.1 页面目标

帮助用户加入公开房间、使用邀请码加入，或创建房间。

## 9.2 页面结构

```text
Page Title
Join with Code
Create Room
Filters
Open Rooms / My Rooms Tabs
Room List
Pagination
```

## 9.3 顶部

```text
Rooms
Join an open room, create your own, or continue a room you already joined.
```

主按钮：

```text
Create Room
```

次按钮：

```text
Join with Code
```

## 9.4 筛选器

MVP 保留：

```text
All Worlds
Any Players
Any Status
Search
```

从世界详情进入时显示：

```text
Filtered by: ROME, 44 BC ×
```

## 9.5 Open Rooms 列表

固定列：

```text
World
Room
Players
Host
Status
Action
```

禁止加入：

```text
房间创建时间
角色列表
Host Credits
当前剧情章节
详细房间描述
```

## 9.6 Action 规则

```text
Open / Waiting       Join
In Progress          View 或 Disabled（按业务权限）
Full                 Full
Completed            View Result（仅有权限用户）
```

## 9.7 My Rooms

不做右侧重复列表 + 独立 My Rooms 页面双重展示。

统一方式：

```text
Open Rooms Tab
My Rooms Tab
```

右侧可保留最多 3 条“最近房间”，但不能与主列表同时展示完整重复字段。

建议 MVP 直接取消右侧完整 My Rooms 卡片，减少页面拥挤。

---

# 10. UI-05：Room Invite Landing

## 10.1 页面目标

让被邀请用户确认房间有效，并完成登录后自动加入。

## 10.2 页面结构

```text
Global Header
Invite Title
Public Room Summary
Room Features
Primary Action
Secondary Action
State Message
```

## 10.3 必须显示

```text
World Thumbnail
World Name
Room Name
Players / Max Players
Host（可选）
Room Status
Sign In to Join / Join Now
```

## 10.4 不显示

```text
邀请码原始数据库 ID
角色隐藏目标
已加入用户邮箱
房间决策记录
未公开故事内容
World Credits 余额
```

## 10.5 未登录状态

主操作：

```text
Sign In to Join
```

次操作：

```text
Back to Worlds
```

## 10.6 已登录状态

主操作：

```text
Join Room
```

已登录且可自动加入时，按钮显示 Loading：

```text
Joining room…
```

## 10.7 无效状态

### Room Full

```text
This room is full.
Explore other rooms or create your own.
```

### Started

```text
This room has already started.
You can view other open rooms.
```

### Closed / Expired / Revoked

```text
This invite is no longer available.
```

无效状态不展示 Host、人数以外的更多房间数据。

---

# 11. UI-06：Room Waiting & Role Selection

## 11.1 页面目标

完成成员确认、角色选择、Ready 和 Host 开始。

## 11.2 页面结构

```text
Back to Rooms
Compact World Header
Invite Notice
Player List
Role Grid
Bottom Action Bar
```

## 11.3 Compact World Header

只显示：

```text
World Thumbnail
World Name
Room Name
Status
Players
Invite Code
Copy Invite Link
```

不显示：

```text
世界长描述
完整角色介绍
世界指标
房间聊天
世界价格套餐
```

复制按钮文案统一：

```text
Copy Invite Link
```

邀请码本身可以作为辅助文本，但主操作复制的是完整深链。

## 11.4 Player List

每个玩家显示：

```text
Avatar
Display Name
Role / No role selected
Host Tag（如适用）
Ready / Not Ready
```

空位显示：

```text
Open Seat
```

## 11.5 Role Card

只显示：

```text
Portrait
Role Name
Public Hook
Status
```

状态：

```text
Selected
Taken
Available
Locked
```

选中后不弹出完整页面，使用同页轻量详情区或 Drawer。

## 11.6 Bottom Action Bar

普通玩家：

```text
Ready
```

Host：

```text
Ready
Start Game
```

Host 未满足开始条件时：

```text
Start Game disabled
Waiting for all players to be ready.
```

---

# 12. UI-07：Solo Role Selection

## 12.1 页面目标

选择一个可玩角色并开始单人局。

## 12.2 复用原则

必须复用 Room Waiting 页面中的：

```text
RoleCard
RoleGrid
RoleDetails
```

## 12.3 页面结构

```text
Back to World
Compact World Header
Role Grid
Selected Role Details
Start Solo Game
```

## 12.4 必须显示

```text
Role Portrait
Role Name
Public Hook
Public Objective
Playable / Coming Soon
```

只有选中后显示：

```text
Fate Question
Public Objective
Start Game
```

不显示角色完整隐藏目标和秘密。

---

# 13. UI-08：Main Game

## 13.1 页面目标

用户理解当前故事，并完成当前回合的决定。

## 13.2 固定骨架

```text
Global Header
Compact Game Header
TopStatusBar
RoleSidebar
NarrativeCenter
ActionSidebar
CriticalEventModal
```

## 13.3 Compact Game Header

只显示：

```text
World Name
Room Name（多人）
Turn / Max Turns
Current Chapter
World Info
```

不重复展示 Header 中已有的 Rooms、Credits、账号信息。

## 13.4 TopStatusBar

显示 3–6 个世界指标。

每个指标：

```text
Icon
Label
Current Value
Progress / Text
Change Indicator（可选）
```

不要同时显示：

```text
数值
百分比
文字等级
颜色等级
趋势图
```

同一个指标最多采用一种主数值表达 + 一种趋势提示。

## 13.5 左栏 RoleSidebar

固定顺序：

```text
My Role
Fate Question
Objectives
Resources
Leverage
Risks
```

显示规则：

```text
Objectives：最多 4 条
Resources：最多 6 条
Leverage：最多 4 条
Risks：最多 4 条
```

无数据时整个模块隐藏，不显示空白卡片。

## 13.6 中栏 NarrativeCenter

中栏是页面视觉和交互中心。

标准 Entry Type：

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

同一时刻只突出一个主要 Entry。

### Story

```text
Story Title
Story Body
Optional Weak Background
Continue to Decision
```

### Decision

```text
Decision Prompt
2–4 Options
Custom Input（可选）
Submit Decision
```

选项默认不展示预测收益和风险，除非产品规则明确要求。

### Simulation

只显示：

```text
AI is simulating the world…
Your decision is changing the situation.
Loading indicator
```

不显示：

```text
模型名称
内部权重
概率
随机数
Token
Prompt
```

### Change Summary

必须让用户看到可见因果：

```text
Your Impact
World Changes
Impact on Others
Objective Progress
```

建议最多 4 条，不做大面积数据表。

## 13.7 右栏 ActionSidebar

固定顺序：

```text
Available Actions
Contacts
Current Progress
Custom Action
Continue / Next Turn
```

避免同时显示两个“Continue”。

用户当前需要提交决策时，右栏 Continue 隐藏。

## 13.8 多人等待状态

```text
Your action is submitted.
Waiting for 2 other players.
```

可显示：

```text
Ready count
Estimated state description
Leave safely / Return later
```

不显示其他玩家的选择内容。

---

# 14. UI-09：Room Unlock Paywall

## 14.1 页面类型

不是新页面，是主游戏中的阻断状态。

## 14.2 页面目标

解释为什么需要解锁，并让用户选择直接解锁或购买 Credits。

## 14.3 必须显示

```text
Free Act Completed
Current Turn
Credits Required
Available Balance
Who can unlock the room
What happens after unlock
```

推荐英文：

```text
The free chapter is complete.
Unlock this room to continue the story for everyone.
```

说明：

```text
Only one player needs to unlock the room.
All players can continue after the unlock succeeds.
```

## 14.4 操作

余额足够：

```text
Unlock for 100 Credits
```

余额不足：

```text
Get World Credits
```

次操作：

```text
Return to Room
```

## 14.5 不显示

```text
全部套餐
交易流水
订单列表
推荐奖励
账户设置
```

这些内容属于 Credits 页面。

---

# 15. UI-10：World Credits

## 15.1 页面目标

购买足够的 Credits，并清楚知道付款后会回到哪里。

## 15.2 页面结构

```text
Page Title
Account / World Credits / Orders & Activity Tabs
Return Context Banner
Balance Summary
Credit Packages
Recent Activity Preview
Return Context Card
```

## 15.3 Return Context Banner

有 `returnTo` 时必须置顶显示：

```text
You need 20 more World Credits to continue Night Council.
After payment, you’ll return to your room automatically.
```

无 `returnTo` 时不显示此 Banner。

## 15.4 余额卡片

保留：

```text
Purchased Credits
Bonus Credits
Available Now
```

不单独展示 debt，除非 debt > 0。

## 15.5 套餐

MVP 固定 3 档：

```text
Starter       300 Credits     $7.99
Explorer      650 Credits     $14.99
World Circle  1400 Credits    $29.99
```

主推：

```text
Explorer · Most Popular
```

每张套餐卡只显示：

```text
Package Name
Credits
Price
Buy Button
```

不显示复杂换算、节省百分比和每点单价。

## 15.6 Return Context Card

只显示：

```text
World
Room
Credits Needed
Return after payment
```

Host 不属于支付回流必需信息，可不显示。

## 15.7 Recent Activity

页面默认显示最近 5 条：

```text
Date
Type
Credits
Status
Related Room / Order
```

完整流水进入 Orders & Activity Tab。

---

# 16. UI-11：Payment Status

## 16.1 页面目标

告诉用户当前订单状态，并保证可回到原房间。

## 16.2 页面不是“支付成功专页”

必须支持统一状态：

```text
pending
paid
cancelled
failed
not_found
unauthorized
```

## 16.3 通用结构

```text
Status Icon
Status Title
Status Description
Progress / State
Order Summary
Return Context
Primary Action
Secondary Action
Safe Refresh Note
```

## 16.4 Paid

```text
Payment Confirmed
Your World Credits have been added successfully.
```

显示：

```text
Package
Credits Added
Order Code
Payment Status
Updated Balance
Return Room
```

主操作：

```text
Return to Room
```

次操作：

```text
View Wallet
```

## 16.5 Pending

```text
Payment received. Credits are being added.
This usually takes a few seconds.
```

操作：

```text
Continue Waiting
Return to Room
```

不得伪称已到账。

## 16.6 Cancelled

```text
Payment Cancelled
No credits were added and you were not charged.
```

操作：

```text
Try Again
Return to Room
```

## 16.7 Failed

```text
Payment Could Not Be Completed
Your balance has not changed.
```

操作：

```text
Try Again
Return to Room
Contact Support
```

## 16.8 Unauthorized / Not Found

不显示订单金额、Credits 和账户余额。

```text
We couldn’t access this order.
```

---

# 17. UI-12：Game Result

## 17.1 页面目标

让用户理解个人结局和世界结局，并选择分享或继续下一局。

## 17.2 页面结构

```text
World Identity
Session Complete
Ending Title
Ending Summary
Your Role
Your Ending
World State
Key Decisions
Goals（可选）
Actions
```

## 17.3 顶部

显示：

```text
World Thumbnail
World Name
Room / Session Name
Session Complete
Duration
Players
```

不显示：

```text
邀请码
Host
Credits
全部玩家邮箱
```

## 17.4 主结局

```text
Ending Title
1 段 Ending Summary
```

## 17.5 三张摘要卡

```text
Your Role
Your Ending
World State
```

如果当前为公开分享场景，则不显示 Your Role。

## 17.6 Key Decisions

显示 3–5 条。

每条采用：

```text
序号
一句话决定
```

不显示内部规则、分数和模型判断过程。

## 17.7 Actions

主操作：

```text
Play Again
```

次操作：

```text
Try Another Role
Share Recap
Invite Next Game
Back to Worlds
```

桌面端建议：

```text
第一行：Play Again / Try Another Role / Back to Worlds
第二行或更多菜单：Share Recap / Invite Next Game
```

避免 5 个同权重按钮横向排列。

---

# 18. UI-13：Share Management Modal

## 18.1 页面目标

创建、复制和撤销公开分享链接。

## 18.2 弹层结构

```text
Share Story Recap
Visibility Options
Public Fields Preview
Generate / Existing Link
Copy
Revoke
```

## 18.3 分享范围

MVP 只保留两个选项：

```text
World Ending Only
World Ending + My Role
```

默认：

```text
World Ending Only
```

## 18.4 必须明确不公开

```text
Hidden objectives
Private actions
Private messages
Email addresses
Invite codes
Other players’ private outcomes
```

## 18.5 已创建状态

显示：

```text
Share Link
Created At
Visibility
Active / Revoked
Copy Link
Revoke Link
```

Revoke 使用 Danger Secondary，不使用主按钮样式。

---

# 19. UI-14：Public Story Recap

## 19.1 页面目标

让未登录用户理解这局公开发生了什么，并进入该世界。

## 19.2 页面结构

```text
Minimal Global Header
Public Hero
Public Ending
Public Key Decisions
World Outcome
Play This World
Explore More Worlds
```

## 19.3 必须显示

```text
Shared Story Recap
World Name
World Public Image
Duration（可选）
Player Count（可选）
Public Ending Title
Public Summary
Public Key Decisions
Public World Outcome
```

## 19.4 不显示

```text
其他角色身份
隐藏目标
私人行动
玩家邮箱
房间邀请码
完整聊天
内部数值
Credits 余额
订单信息
```

## 19.5 CTA

主操作：

```text
Play This World
```

次操作：

```text
Explore More Worlds
```

## 19.6 Token 无效

```text
This story recap is no longer available.
The owner may have revoked the link.
```

操作：

```text
Explore Worlds
```

---

# 20. UI-15：My Rooms

## 20.1 页面归属

My Rooms 是 Rooms 页内部 Tab，不是新的顶级页面和导航。

## 20.2 页面目标

恢复未完成房间，查看已完成结果。

## 20.3 Tabs

```text
In Progress
Waiting
Completed
Closed
```

MVP 可以把 Closed 放入筛选，不单独显示 Tab。

## 20.4 列表字段

### In Progress

```text
World & Room
Your Role
Current Turn
Updated
Continue
```

### Waiting

```text
World & Room
Your Role / No role
Players
Ready State
Invite State
Open Room
Copy Invite
```

### Completed

```text
World & Room
Your Role
Ending Title
Completed At
View Result
Share
Play Again
```

### Closed / Expired

```text
World & Room
Reason
Closed At
Read-only
```

## 20.5 不显示

```text
房间完整故事
全部玩家名单
Credits 详细变化
角色私密目标
```

---

# 21. UI-16：Account Tab

## 21.1 页面归属

复用 Credits 页面容器：

```text
Account
World Credits
Orders & Activity
```

## 21.2 页面结构

```text
Profile
Email Verification
Password
Session / Sign Out
Support Requests
```

## 21.3 必须显示

```text
Display Name
Email
Verification Status
Joined Date
Change Password
Sign Out
```

## 21.4 暂不显示

```text
复杂社交资料
个人简介
公开头像系统
多设备登录管理
二次验证
订阅管理
```

## 21.5 数据删除和导出

MVP 显示：

```text
Request account deletion
Request data export
```

点击后进入 Contact Support，而不是开发复杂自动化流程。

---

# 22. UI-17：Orders & Activity Tab

## 22.1 页面目标

让用户核对购买、奖励、解锁、退款和争议状态。

## 22.2 字段

```text
Date
Type
Credits Change
Balance After
Status
Related Room / Order
Action
```

类型：

```text
Purchase
Bonus Reward
Room Unlock
Refund
Dispute
Adjustment
```

状态：

```text
Pending
Completed
Failed
Refunded
Disputed
```

## 22.3 详情

点击订单后使用 Drawer 或 Modal 展示：

```text
Order Code
Package
Amount
Credits
Status
Created At
Paid At
Related Room
Contact Support
```

不在列表页直接展示完整订单详情。

---

# 23. UI-18：Help / Legal / Support

## 23.1 页面目标

提供政策、退款和最小支持入口。

## 23.2 页面结构

```text
Help Center
Common Questions
Privacy Policy
Terms of Service
Refund Policy
Contact Support
Service Status
```

## 23.3 Contact Support

最小表单字段：

```text
Issue Type
Email
Order ID / Room ID（可选）
Description
Submit
```

Issue Type：

```text
Payment
Credits
Room Access
Account
Bug
Privacy
Other
```

不做完整工单后台时，可提交到支持邮箱，但页面必须给用户明确成功状态。

---

# 24. 创建房间 Modal

Rooms 页面不新增 Create Room 独立页面。

## 24.1 必须显示

```text
World
Room Name
Visibility
Max Players
Create Room
```

## 24.2 MVP 默认值

```text
Visibility: Public / Invite Only
Max Players: 根据 World Manifest
Room Name: 自动生成，可修改
```

## 24.3 不显示

```text
复杂世界规则
自定义角色
自定义模型
高级 AI 参数
剧情长度设置
世界指标配置
```

---

# 25. Join with Code Modal

## 25.1 必须显示

```text
Room Code
Join Room
```

输入有效后可显示安全摘要：

```text
World
Room Name
Players
Status
```

禁止在验证前显示房间内部信息。

---

# 26. 全局 Loading、Empty、Error 标准

## 26.1 Loading

页面骨架加载：

```text
Header 保持稳定
主体使用 Skeleton
超过 1.5 秒显示说明文字
```

示例：

```text
Loading room…
Checking payment status…
Preparing your story…
```

## 26.2 Empty

必须包含：

```text
简短标题
一句解释
一个主操作
```

示例：

```text
No open rooms yet.
Create the first room for this world.
Create Room
```

## 26.3 Error

禁止展示：

```text
Stack trace
Raw JSON
Database error
HTTP library error
Internal ID
```

错误结构：

```text
Title
User-readable explanation
Retry
Safe destination
Support reference code（可选）
```

---

# 27. 页面信息去重规则

## 27.1 World Name

允许出现：

```text
Header / Compact World Header
页面主标题
列表主字段
```

不要在同一屏的 4 个卡片中重复世界名称。

## 27.2 Room Name

允许出现：

```text
Compact Room Header
Return Context
列表主字段
```

支付页面中只在 Return Context 区显示一次。

## 27.3 Credits

```text
Header：只显示总可用余额
Wallet：显示 purchased / bonus / total
Paywall：显示 required / available
Result：不显示 Credits
Room Waiting：不显示 Credits
```

## 27.4 Role

```text
World Details：只显示公开 Hook
Role Selection：显示公开目标
Main Game：显示完整个人侧栏
Result：显示角色结局
Share：默认不显示私人角色
```

---

# 28. 响应式规则

## 28.1 Desktop ≥ 1200px

按本文档完整布局。

## 28.2 Tablet 768–1199px

```text
Header 收缩
主游戏左栏变 Drawer
右栏变 Drawer
中栏全宽
Rooms 表格改卡片列表
```

## 28.3 Mobile < 768px

MVP 最低要求：

```text
世界浏览可用
邀请加入可用
登录注册可用
房间准备可用
主游戏可阅读和决策
支付回流可用
结果可查看
```

移动端主游戏顺序：

```text
Top Status
Story
Decision
Change Summary
Role Info
Actions
```

不强行保留三栏。

---

# 29. 组件复用清单

```text
<GlobalHeader />
<PageContainer />
<PageTitle />
<PrimaryButton />
<SecondaryButton />
<StatusBadge />
<WorldCard />
<WorldIdentity />
<WorldMeta />
<RoleCard />
<RoleGrid />
<RoleDetails />
<RoomList />
<RoomRow />
<PlayerList />
<InviteBlock />
<TopStatusBar />
<RoleSidebar />
<NarrativeEntryRenderer />
<DecisionComposer />
<SimulationState />
<ChangeSummary />
<ActionSidebar />
<UnlockPaywall />
<CreditBalanceCards />
<CreditPackageCard />
<TransactionList />
<PaymentStatus />
<GameResultSummary />
<ShareModal />
<PublicStoryRecap />
<EmptyState />
<ErrorState />
<LoadingState />
```

不得创建：

```text
<CaesarRoomPage />
<CaesarResultPage />
<RomeRoleCard />
<LastNightShiftRoomPage />
```

---

# 30. 路由与页面映射

```text
/                           → World Lobby
/auth                       → Login / Sign Up
/worlds/:worldId            → World Details
/rooms                      → Open Rooms
/rooms?tab=my               → My Rooms
/rooms/:roomId              → Room Waiting & Role Selection
/join?roomCode=             → Room Invite Landing
/role-select                → Solo Role Selection
/room-game?runId=           → Main Game
/credits                    → World Credits
/credits?tab=account        → Account
/credits?tab=orders         → Orders & Activity
/credits-success?checkout=  → Payment Status
/game/result?runId=         → Game Result
/share/:token               → Public Story Recap
/legal                      → Help / Legal / Support
```

所有路由必须支持：

```text
直接打开
浏览器刷新
登录后 returnTo
支付后 returnTo
无权限安全降级
```

---

# 31. P0 页面验收标准

## 31.1 Auth

- 登录 / 注册切换正确。
- returnTo 提示正确。
- 登录后回到白名单地址。
- 不显示测试 Token。

## 31.2 Invite

- 未登录能看到安全摘要。
- 登录后自动加入。
- Full / Started / Closed / Expired 有明确状态。
- 不泄露私密房间数据。

## 31.3 Waiting Room

- Copy Invite Link 复制完整链接。
- 角色状态准确。
- Ready 状态准确。
- Host 才能 Start Game。

## 31.4 Paywall / Credits

- 显示 required、available、return room。
- Checkout 按钮防重复点击。
- 支付后不会困在钱包。

## 31.5 Payment Status

- Pending / Paid / Cancelled / Failed 均可展示。
- Paid 后返回原房间。
- 刷新不会重复加点。
- 非本人订单不泄露数据。

## 31.6 Result / Share

- 结果页显示动态结局。
- 可生成分享链接。
- 可撤销分享链接。
- 公开页不显示私密信息。
- 可再开一局和邀请下一局。

---

# 32. P1 页面验收标准

## 32.1 My Rooms

- 使用真实数据。
- 可恢复进行中房间。
- 可打开等候房并复制邀请。
- 可查看完成结果。
- 已关闭条目只读。

## 32.2 Account

- 昵称和邮箱显示准确。
- 可修改昵称。
- 可重发验证。
- 可修改密码。
- 可退出。

## 32.3 Orders & Activity

- Credits 变化与 Ledger 一致。
- 订单状态与 Webhook 状态一致。
- 可关联到 Room / Order。
- Refund / Dispute 有可理解文案。

---

# 33. Codex 实施顺序

```text
Phase 1：统一 Platform Shell
Global Header
Page Container
Button / Status / Card Tokens
Loading / Error / Empty

Phase 2：P0 邀请闭环
Auth returnTo
Invite Landing
Copy Invite Link
Room Preflight State

Phase 3：P0 支付闭环
Unlock Paywall
Credits Return Context
Payment Status State Machine
Return to Room

Phase 4：P0 结果分享
Result Actions
Share Modal
Public Share Page
Revoke Share

Phase 5：P1 信息恢复
My Rooms
Account Tab
Orders & Activity
Support Entry

Phase 6：第二世界复用验证
The Last Night Shift
不新增页面级组件
```

---

# 34. 最终页面定义

Many Worlds 不应该通过“每个页面展示尽可能多的信息”证明产品完整。

正确方式是：

```text
用户在当前页面，只看到当前步骤需要理解的内容；
用户只有一个明确的下一步；
世界内容在固定容器中变化；
平台结构、状态、按钮和交互始终一致；
邀请、支付、结果和回流不会中断。
```

最终标准：

> 首页负责选世界。  
> 世界详情负责选模式。  
> Rooms 负责选房间。  
> 等候房负责选角色和准备。  
> 主游戏负责理解故事和做决定。  
> 钱包负责买 Credits。  
> 支付状态页负责确认并回流。  
> 结果页负责解释结局和开启下一局。  
> 分享页只负责展示脱敏的公开故事。

当每个页面只完成自己的职责，Many Worlds 才会成为一个清晰、可信、可扩展的多世界 AI 推演平台。
