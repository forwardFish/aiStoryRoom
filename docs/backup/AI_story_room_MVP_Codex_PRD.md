# 多人角色共演 AI 故事局 · MVP Codex 开发执行 PRD

> 版本：MVP-Codex-Ready v1.0  
> 目标：将「多人角色共演 + AI 导演控场 + 自动整理成小说」做成一个可验证市场需求的微信小程序 MVP。  
> 核心验证假设：用户是否愿意在一个固定角色身份里，和熟人一起互动发言，并且因为 AI 把这些发言整理成小说而继续玩、分享、复玩。  
> 开发原则：先跑通 30 分钟熟人局闭环，不做社区、不做路人匹配、不做长周期局、不做复杂付费。

---

# 0. 给 Codex 的总执行指令

你是资深全栈工程师，请根据本文档开发一个 MVP 项目。

请优先完成 P0-A 最小可上线闭环。不要擅自增加产品功能，不要实现 P2 功能，不要把产品做成通用小说生成器或普通聊天室。

本项目必须严格遵守以下原则：

1. 正式局必须至少 2 名真人用户完成角色锁定后才能开局。
2. 不允许任何形式的 AI 陪演正式局。
3. 单人体验只能是非正式试玩，不计入核心数据，不生成正式作品。
4. 所有用户可编辑内容必须过内容安全审核。
5. AI 只是导演和场务，不能替玩家做核心选择，不能剧透未暴露秘密。
6. 单局固定 4 阶段，最长约 30 分钟，到点强制推进。
7. 先实现微信小程序用户端 + 内部 Web 管理后台 + 后端 API + AI 任务队列。
8. 代码必须可运行、可测试、可本地启动、可逐步接入真实微信与大模型服务。

---

# 1. 产品一句话定位

一个微信小程序熟人故事局产品。

用户创建一个规则怪谈房间，邀请 1-3 个好友，每个人锁定一个带秘密的角色，在 AI 导演的控场下通过文字公聊演完 30 分钟剧情，最后 AI 自动生成一篇带角色署名的短篇小说，并支持分享和同模板重开。

---

# 2. MVP 核心闭环

用户进入小程序  
→ 微信登录  
→ 首页 30 秒试演  
→ 创建熟人局  
→ 选择固定模板  
→ 修改局名 / 一句话规则变体  
→ 生成邀请卡片  
→ 邀请好友  
→ 至少 2 名真人进入  
→ 选择并锁定角色  
→ 发起人开局  
→ 4 阶段公聊共演  
→ AI 阶段推进和小说片段整理  
→ 结局投票  
→ AI 生成完整小说  
→ 分享海报 / 导出 TXT  
→ 同模板重开一局

---

# 3. 明确不做范围

MVP 阶段禁止开发：

1. 面向用户的 PC Web、H5 站、独立 App。
2. 公开路人匹配局。
3. 陌生人社交、粉丝、关注、评论、作品广场。
4. AI 正式陪演局、单人正式局。
5. 玩家私聊。
6. 长周期局、1 小时以上局、7 天局。
7. 自定义世界观、自定义角色核心设定、自定义模板。
8. 道具、积分、等级、装扮、抽卡、打赏。
9. 真实付费体系。
10. 版权存证、作品商业授权。
11. AI 托管玩家正式发言。
12. 中途新玩家顶替入局。

---

# 4. 终端与系统组成

## 4.1 微信小程序用户端

负责：

- 微信登录
- 首页 30 秒试演
- 创建熟人局
- 邀请好友
- 角色锁定
- 公聊共演
- AI 阶段推进展示
- 阶段小说片段查看
- 结局投票
- 完结小说查看
- 分享海报
- 我的房间
- 我的作品
- 举报 / 反馈

## 4.2 内部 Web 管理后台

只给内部人员使用。

负责：

- 模板管理
- 角色配置管理
- Prompt 模板管理
- 房间日志查看
- AI 调用日志查看
- 用户行为日志查看
- 内容审核日志查看
- 异常房间干预
- 违规内容下架
- 用户临时封禁 / 解封
- 核心指标看板
- 模板维度数据

## 4.3 后端 API 服务

负责：

- 登录态
- 房间状态机
- 角色锁定并发控制
- 消息入库与广播
- AI 任务创建
- 内容安全审核
- 分享归因
- 埋点采集
- 作品生成与导出
- 后台管理接口

## 4.4 实时通信服务

负责：

- 房间消息实时推送
- 阶段状态同步
- AI 消息广播
- 投票同步
- 断线重连补消息

优先 WebSocket。WebSocket 不稳定时，前端降级为 3 秒轮询。

## 4.5 AI 任务队列

负责异步执行：

- 试演生成
- 阶段小说片段生成
- 完结小说生成
- 角色高光卡生成，P0-B
- 离线剧情摘要，P0-B/P1
- 审核后处理
- 失败兜底

---

# 5. 推荐技术栈

Codex 可以按以下技术栈实现。

## 5.1 Monorepo

建议目录：

```txt
ai-story-room/
  apps/
    miniprogram/      # 微信小程序，Taro React TypeScript
    admin/            # 内部后台，Next.js React TypeScript
    api/              # 后端服务，NestJS 或 Express TypeScript
  packages/
    shared/           # 共享类型、枚举、校验逻辑
    prompts/          # Prompt 模板
    templates/        # 内置故事模板 JSON
  prisma/
    schema.prisma
    seed.ts
  docs/
    PRD.md
    API.md
    DB.md
    TEST_CASES.md
  docker-compose.yml
  package.json
  pnpm-workspace.yaml
  .env.example
```

## 5.2 前端

- 小程序：Taro + React + TypeScript
- 后台：Next.js + React + TypeScript
- UI：Tailwind CSS 或 Ant Design Web 后台
- 状态管理：Zustand
- 请求：fetch / axios
- 小程序实时通信：WebSocket + 轮询兜底

## 5.3 后端

- Node.js + TypeScript
- NestJS 优先，Express 也可
- PostgreSQL
- Prisma ORM
- Redis
- BullMQ / 任意 Redis 队列
- WebSocket Gateway
- JWT / session token

## 5.4 第三方服务

- 微信登录：wx.login 获取 code，后端换取 openid/session_key
- 微信内容安全：msg_sec_check / 平台侧内容安全接口
- 微信分享：onShareAppMessage，onShareTimeline 按微信能力适配
- 大模型 API：先做抽象接口，支持 mock provider 和真实 provider
- 对象存储：可选，用于海报图片 / 导出文件

---

# 6. 用户角色与权限

## 6.1 C 端用户

权限：

- 登录小程序
- 试演
- 创建房间
- 邀请好友
- 加入受邀房间
- 锁定角色
- 发送公聊消息
- 投票
- 查看作品
- 分享作品
- 举报反馈

限制：

- 不可修改已锁定角色
- 不可进入未受邀私密局
- 不可中途顶替他人角色
- 不可开单人正式局

## 6.2 发起人

额外权限：

- 创建房间
- 生成邀请卡片
- 解散未开局房间
- 点击立即开局
- 达成阶段提前推进条件后，点击提前推进
- 异常中断后选择恢复或解散房间

## 6.3 内部管理员

权限分层：

- admin：全权限
- operator：模板、内容、违规、房间干预
- developer：日志、AI 调用、异常排查
- viewer：只看数据看板

---

# 7. P0-A 最小可上线功能

## 7.1 用户登录

### 页面

- 登录授权页
- 协议确认弹窗

### 规则

1. 仅支持微信一键登录。
2. 首次登录必须同意：
   - 用户协议
   - 隐私政策
   - 内容合规公约
   - 多人共创版权规则
   - 未成年人保护提示
3. 不强制手机号注册。
4. 付费功能不在 MVP 正式实现，因此实名暂不触发。

### 后端

接口：

```http
POST /api/auth/wechat-login
POST /api/user/agree-policy
GET  /api/user/me
```

---

## 7.2 首页

### 页面结构

首页只保留 4 个核心区块：

1. 30 秒试演卡片
2. 创建熟人局按钮
3. 我的房间
4. 我的作品

### 禁止

- 不做广场
- 不做推荐公开局
- 不做排行榜
- 不做社交信息流

---

## 7.3 30 秒试演

### 目标

降低用户恐惧，让用户先体验“我说一句话，AI 写成小说”。

### 规则

1. 首页试演只用于前置转化。
2. waiting_invite 等待试玩只用于发起人等好友时体验。
3. 试演不计入：
   - 正式开局数
   - 完局率
   - 复玩率
   - 核心正式局指标
4. 试演不生成正式作品。
5. 试演最多 1-2 轮互动。
6. 试演结束必须引导邀请好友。

### 模板

首页试演默认展示：

- 午夜便利店

提供一个按钮：

- 换个场景：切换至废弃学校

### 试演流程

用户选择模板  
→ 展示固定角色  
→ 展示固定开场  
→ 提供 2 条推荐话术 + 自由输入  
→ 用户点击生成  
→ AI 生成 200-300 字小说片段  
→ 展示高亮用户输入  
→ 主按钮：邀请 1 个朋友，继续演完这个故事

---

## 7.4 创建熟人局

### 页面

- 模板选择页
- 房间信息编辑页
- 等待邀请页

### 固定 5 个 MVP 模板

1. 午夜便利店员工守则
2. 废弃学校第七校规
3. 幸福小区住户须知
4. 末班地铁乘客规则
5. 疗养院夜班记录

### 可编辑字段

用户只可编辑：

- 局名：20 字以内
- 一句话规则变体：30 字以内

所有可编辑字段必须先审核，再保存。

### 禁止

- 不开放完整大纲编辑
- 不开放自定义角色
- 不开放自定义规则体系
- 不开放地图、道具、数值

---

## 7.5 邀请分享

### 分享内容

邀请卡片文案格式：

```txt
《{room_title}》还差 {empty_role_count} 个角色开局。
你的身份可能会决定所有人的结局。
```

### 分享方式

1. 微信好友 / 群分享卡片
2. 生成邀请海报
3. 海报保存到相册
4. 朋友圈不承诺一键转发，仅提供海报保存方案

### 分享归因

每次分享生成：

- share_token
- share_user_id
- share_room_id
- share_scene
- share_channel
- invite_card_id

好友打开分享后，所有后续行为绑定 share_token。

### 埋点

- share_click
- poster_generate
- poster_save
- invite_card_open
- room_enter_from_share
- role_lock_from_share
- formal_start_from_share

---

## 7.6 角色锁定

### 角色配置

每个模板固定 4 个角色。

每个角色必须包含：

- role_id
- role_name
- identity
- core_goal
- relationship_to_others
- first_action_hint
- secret_options[4]
- habit_options[4]
- exclusive_clue
- conflict_hook
- ending_influence

### 用户锁定流程

进入房间  
→ 查看剩余角色  
→ 选择角色  
→ 选择 1 个秘密  
→ 选择 1 个习惯  
→ 确认锁定  
→ 不可更换

### 超时规则

- 60 秒：推荐角色
- 120 秒：提醒用户确认
- 180 秒：进入旁观等待区，不占角色位

### 并发规则

1. 后端必须原子锁定角色。
2. 同一 room_id + role_id 只允许一个 locked_user_id。
3. 并发时，以数据库写入成功者为准。
4. 失败用户提示：该角色刚刚被锁定，请选择其他角色。
5. 锁定后不可释放。
6. 用户退出页面不释放角色。

---

## 7.7 2 人 / 3 人 / 4 人局规则

正式开局要求：

- 至少 2 名真人用户完成角色锁定。
- 最多 4 名真人用户完成角色锁定。
- 未锁定角色不由 AI 扮演。

不同人数规则：

### 2 人局

- 只激活 2 个真人角色。
- 未锁定角色不主动发言。
- 未锁定角色可作为背景人物、缺席人物、线索来源。
- 模板必须配置推荐 2 人角色组合。
- 结局只根据真人投票决定。

### 3 人局

- 激活 3 个真人角色。
- 未锁定角色作为背景线索处理。
- 模板必须配置推荐 3 人角色组合。

### 4 人局

- 完整角色局。
- 所有角色均可触发完整剧情。

模板必须配置：

- recommended_roles_2p
- recommended_roles_3p
- recommended_roles_4p
- absent_role_handling
- player_count_specific_opening

---

## 7.8 公聊互动

### 输入方式 P0-A

只做两层：

1. 快捷动作
2. 自由输入

P0-B 再做 AI 推荐台词。

### 快捷动作

固定：

- 观察
- 质问
- 隐瞒
- 靠近
- 后退
- 求助

点击快捷动作后，使用模板拼接生成一句话，不调用模型。

示例：

```txt
【观察】{role_name}屏住呼吸，仔细看向{current_object}。
【质问】{role_name}看向{target_role}，压低声音问：“你刚才是不是隐瞒了什么？”
```

### 自由输入

placeholder：

```txt
你可以说一句话、做一个动作，或隐瞒一个秘密
```

发送按钮：

```txt
以角色身份发言
```

### 发言冷却

- 单用户 30 秒冷却。
- 阶段投票阶段可允许投票不受冷却影响。

### 撤回规则

- 10 秒内可撤回。
- 已触发阶段总结的消息不可撤回。
- 撤回消息不进入小说、不计入贡献。
- 撤回不回滚阶段事件。
- 撤回后显示：该内容已撤回。

---

## 7.9 消息类型

| 类型 | 说明 | 进入小说 | 全员可见 | 计入贡献 | 可撤回 |
|---|---|---|---|---|---|
| user_dialogue | 玩家角色对话 | 是 | 是 | 是 | 10秒内 |
| user_action | 玩家角色动作 | 是 | 是 | 是 | 10秒内 |
| ai_narration | AI旁白 | 是 | 是 | 否 | 否 |
| ai_event | AI剧情事件 | 是 | 是 | 否 | 否 |
| system_notice | 系统提示 | 否 | 是 | 否 | 否 |
| phase_summary | 阶段小说片段 | 是 | 是 | 否 | 否 |
| vote | 投票消息 | 否 | 是 | 否 | 否 |
| safety_warning | 安全提醒 | 否 | 仅本人 | 否 | 否 |
| role_hint | 角色定向提示 | 否 | 仅本人 | 否 | 否 |
| offline_notice | 暂离提示 | 否 | 是 | 否 | 否 |

---

## 7.10 实时消息同步

### 通信方案

1. 优先 WebSocket。
2. WebSocket 断开后自动重连。
3. 重连失败降级为 3 秒轮询。
4. 所有消息以后端入库为准。
5. 前端不做最终状态判断。

### 幂等规则

1. 前端发送消息必须带 client_message_id。
2. 后端按 user_id + client_message_id 去重。
3. 重复请求返回第一次发送结果。

### 补消息

1. 前端保存 last_message_id。
2. 重连后请求缺失消息。
3. 服务端按入库时间和自增 ID 排序返回。

### 阶段切换规则

1. 阶段切换由服务端定时器控制。
2. 前端只展示倒计时。
3. 阶段切换瞬间的消息，以服务端接收时间归属阶段。
4. 投票以服务端截止时间为准。

---

# 8. 单局状态机

状态枚举：

```ts
type RoomStatus =
  | 'draft'
  | 'waiting_invite'
  | 'role_locking'
  | 'ready_countdown'
  | 'phase_1_abnormal'
  | 'phase_2_clue'
  | 'phase_3_conflict'
  | 'phase_4_vote'
  | 'generating_work'
  | 'completed'
  | 'aborted';
```

## 状态说明

### draft

发起人创建中。

超时：

- 10 分钟未完成创建，自动解散。

### waiting_invite

等待好友进入。

规则：

- 发起人可分享。
- 发起人可进行非正式等待试玩。
- 不足 2 名真人不能开局。
- 10 分钟仍不足 2 人，提示继续邀请 / 重新创建。
- 30 分钟仍不足 2 人，自动解散。

### role_locking

角色锁定中。

规则：

- 进入用户可选角色。
- 锁定后不可更换。
- 用户可退出，房间保留。

### ready_countdown

开局倒计时。

规则：

- 至少 2 名真人锁定角色。
- 发起人点击立即开局。
- 10 分钟未开局自动解散。

### phase_1_abnormal

时长：5 分钟  
最短推进：3 分钟  
目标：至少 2 名真人发言，或全员至少 1 次发言。

### phase_2_clue

时长：8 分钟  
最短推进：4 分钟  
目标：至少触发 1 条关键线索，至少 2 名真人参与互动。

### phase_3_conflict

时长：10 分钟  
最短推进：5 分钟  
目标：至少触发 1 个矛盾事件，或至少 1 个角色秘密被暗示 / 暴露。

### phase_4_vote

时长：7 分钟  
目标：全员投票，或倒计时结束。

### generating_work

最长等待：60 秒。  
超过 60 秒，合并阶段小说片段生成简版作品。

### completed

可查看作品、分享、导出、重开。

### aborted

异常中断。  
发起人可恢复或解散。  
24 小时未恢复，自动永久解散。

---

# 9. 阶段投票规则

结局选项固定 2 个。

投票规则：

1. 每名真人用户 1 票。
2. 离线用户可在阶段结束前回来补投。
3. 到点后未投票视为弃权。
4. 多数票决定结局。
5. 2 人局平票：发起人拥有最终选择权。
6. 3 / 4 人局平票：发起人拥有最终选择权。
7. 发起人未在线时，默认选择保守结局。
8. 无人投票时，默认选择保守结局。

---

# 10. AI 导演规则

AI 定位：

- 导演
- 场务
- 记录员
- 氛围推进者

AI 禁止：

1. 替玩家发言。
2. 替玩家做关键选择。
3. 抢主角位。
4. 剧透未暴露秘密。
5. 强行改变用户角色动机。
6. 临时生成大世界观。
7. 开放新角色正式入局。

AI 可以：

1. 发送阶段开场事件。
2. 发送冷场救场事件。
3. 向沉默用户发送 role_hint。
4. 整理阶段小说片段。
5. 整理完结小说。
6. 在结尾回收已暴露伏笔。

---

# 11. AI 秘密暴露规则

1. 未被玩家主动暗示或阶段事件触发前，AI 不得公开角色秘密。
2. 阶段三允许暴露 1 个核心矛盾。
3. 暴露前优先用线索暗示，不直接说破。
4. 完结小说只完整回收已暴露秘密。
5. 未暴露秘密只能写成伏笔，不能写成事实。
6. 私密 role_hint 可以提醒用户自己的秘密，但不可公开给全员。

---

# 12. AI 调用策略

## 12.1 分级

### 0 成本模板拼接

用于：

- 快捷动作
- 阶段开场
- 冷场救场
- 系统提示
- 海报固定文案

### 低成本轻量调用

用于：

- OOC 检测，P0-B
- 简单话术改写，P0-B
- 离线剧情摘要
- 高光事件标记，P0-B

### 高成本大模型调用

用于：

- 30 秒试演生成
- 阶段小说片段生成
- 完结小说生成
- 角色高光卡，P0-B

## 12.2 单局预算

目标：

- 高成本调用目标 7-12 次
- 预警线 20 次
- 禁止线 30 次，超过后自动降级为模板拼接 / 兜底文本

成本目标：

- 内测版 ≤ 1 元 / 局
- 灰度版 ≤ 0.5 元 / 局
- 优化版 ≤ 0.2 元 / 局

## 12.3 超时规则

| 场景 | 超时 |
|---|---|
| 试演 | 10 秒 |
| 阶段小说片段 | 10 秒 |
| 完结小说 | 30 秒 |
| 角色高光卡 | 10 秒 |
| 海报生成 | 2 秒 |
| 内容审核 | 5 秒 |

---

# 13. AI 任务队列

所有 AI 生成必须创建 ai_task。

任务状态：

```ts
type AiTaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'fallback_used';
```

规则：

1. 同一房间同一阶段只允许一个 phase_summary 任务。
2. 同一房间只允许一个 final_work 任务。
3. 任务最多重试 1 次。
4. 超时后进入 fallback_used。
5. 前端通过 WebSocket 或轮询获取任务状态。
6. AI 生成结果必须先审核，再正式展示或入库。
7. AI 失败不能阻断主流程。

---

# 14. AI 上下文管理

## 固定上下文

每次大模型调用必须带：

- 模板世界观
- 本局核心规则
- 角色基础人设
- 当前阶段目标
- 禁止事项
- 已公开线索
- 禁止公开的秘密列表

## 动态上下文

按需携带：

- 最近 20 条公聊消息
- 当前阶段事件
- 已触发线索
- 已暴露秘密
- 玩家关键选择

## 长期摘要

每阶段结束后生成：

- 阶段摘要
- 角色关系变化
- 已触发伏笔
- 未回收伏笔

---

# 15. AI 输出质量验收标准

## 15.1 阶段小说片段

必须满足：

1. 300-500 字。
2. 第三人称小说叙述。
3. 至少保留 2 条用户关键发言或动作。
4. 不剧透未公开秘密。
5. 不新增脱离模板的大设定。
6. 不替玩家做重大决定。
7. 保留当前阶段目标和线索。

## 15.2 完结小说

必须满足：

1. 1000-3000 字。
2. 按 4 阶段结构组织。
3. 每个真人角色至少出现 2 次。
4. 结局必须对应投票结果。
5. 标注关键剧情触发人。
6. 不出现未审核内容。
7. 不出现明显 OOC。
8. 不直接揭露未暴露秘密。
9. 有明确结尾，不烂尾。

---

# 16. 内容安全与合规

## 16.1 必审内容

所有用户可编辑内容都必须审核：

- 局名
- 一句话规则变体
- 用户发言
- 作品标题
- 分享文案
- 海报文本
- 导出 TXT 文件名
- 微信昵称 / 头像展示内容

AI 生成内容也必须审核：

- 试演结果
- 阶段小说片段
- 完结小说
- 角色高光卡
- 分享海报文案

## 16.2 长文本审核

完整小说按 500-800 字分段审核。

任一分段不通过：

- 禁止导出
- 禁止分享
- 可进入人工审核状态

## 16.3 作品状态

```ts
type WorkAuditStatus =
  | 'draft_generated'
  | 'audit_passed'
  | 'audit_failed_view_only'
  | 'manual_review'
  | 'blocked';
```

规则：

- audit_passed：可查看、可导出、可分享
- audit_failed_view_only：仅自己可查看，不可导出/分享
- manual_review：等待后台审核
- blocked：严重违规，不展示
- AI 生成内容未通过审核，不进入正式作品库，只记录异常日志

## 16.4 处罚机制

- 首次轻微违规：提醒修改
- 3 次违规：禁言 24 小时
- 严重违规：账号封禁
- 用户可提交申诉 / 反馈
- 后台可解除误判

## 16.5 未成年人保护与内容边界

规则怪谈题材允许悬疑和轻度惊悚，但禁止：

- 过度血腥
- 现实危险行为诱导
- 现实人肉、辱骂、威胁
- 低俗内容
- 政治敏感内容
- 违法违规内容

---

# 17. 数据库核心表

以下为最小字段，Codex 可以用 Prisma 实现。

## 17.1 User

```prisma
model User {
  id             String   @id @default(cuid())
  openid         String   @unique
  unionid        String?
  nickname       String?
  avatarUrl      String?
  status         String   @default("active")
  policyAgreedAt DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

## 17.2 StoryTemplate

```prisma
model StoryTemplate {
  id             String   @id
  name           String
  hook           String
  worldBase      String
  status         String   @default("draft")
  minPlayers     Int      @default(2)
  maxPlayers     Int      @default(4)
  configJson      Json
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

## 17.3 Room

```prisma
model Room {
  id             String   @id @default(cuid())
  creatorUserId  String
  templateId      String
  title           String
  ruleVariant     String?
  status          String
  currentPhase    String?
  playerCount     Int      @default(0)
  shareToken      String?
  startedAt       DateTime?
  completedAt     DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

## 17.4 RoomMember

```prisma
model RoomMember {
  id              String   @id @default(cuid())
  roomId          String
  userId          String
  roleId          String?
  isCreator       Boolean  @default(false)
  status          String   @default("joined")
  joinedAt        DateTime @default(now())
  lockedAt        DateTime?
  lastSeenAt      DateTime?
  offlineAt       DateTime?
}
```

## 17.5 RoleInstance

```prisma
model RoleInstance {
  id               String   @id @default(cuid())
  roomId           String
  roleId           String
  lockedUserId     String?
  selectedSecretId String?
  selectedHabitId  String?
  status           String   @default("available")

  @@unique([roomId, roleId])
}
```

## 17.6 Message

```prisma
model Message {
  id              String   @id @default(cuid())
  roomId          String
  userId          String?
  roleId          String?
  clientMessageId String?
  type            String
  content         String
  visibility      String   @default("public")
  phaseId         String?
  isKeyAction     Boolean  @default(false)
  isRevoked       Boolean  @default(false)
  createdAt       DateTime @default(now())

  @@unique([userId, clientMessageId])
}
```

## 17.7 Vote

```prisma
model Vote {
  id        String   @id @default(cuid())
  roomId    String
  userId    String
  optionId  String
  createdAt DateTime @default(now())

  @@unique([roomId, userId])
}
```

## 17.8 Work

```prisma
model Work {
  id            String   @id @default(cuid())
  roomId        String   @unique
  title         String
  content       String
  auditStatus   String   @default("draft_generated")
  exportEnabled Boolean  @default(false)
  shareEnabled  Boolean  @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

## 17.9 AiTask

```prisma
model AiTask {
  id            String   @id @default(cuid())
  roomId        String?
  taskType      String
  modelType     String
  promptVersion String?
  status        String   @default("pending")
  inputTokens   Int?
  outputTokens  Int?
  cost          Float?
  errorMessage  String?
  resultJson    Json?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

## 17.10 AuditLog

```prisma
model AuditLog {
  id          String   @id @default(cuid())
  targetType  String
  targetId    String?
  content     String
  result      String
  riskType    String?
  createdAt   DateTime @default(now())
}
```

## 17.11 EventLog

```prisma
model EventLog {
  id           String   @id @default(cuid())
  userId       String?
  roomId       String?
  eventName    String
  sessionType  String?
  roomType     String?
  shareToken   String?
  payload      Json?
  createdAt    DateTime @default(now())
}
```

## 17.12 ShareToken

```prisma
model ShareToken {
  id            String   @id @default(cuid())
  token         String   @unique
  roomId        String
  shareUserId   String
  scene         String
  channel       String
  createdAt     DateTime @default(now())
}
```

---

# 18. 核心 API 清单

## 18.1 Auth

```http
POST /api/auth/wechat-login
GET  /api/user/me
POST /api/user/agree-policy
```

## 18.2 Trial

```http
POST /api/trial/generate
```

Body:

```json
{
  "templateId": "template_001",
  "input": "我慢慢走向收银台下方的纸条",
  "scene": "home_trial"
}
```

## 18.3 Rooms

```http
POST /api/rooms
GET  /api/rooms/:roomId
POST /api/rooms/:roomId/invite
POST /api/rooms/:roomId/start
POST /api/rooms/:roomId/advance-phase
POST /api/rooms/:roomId/abort
POST /api/rooms/:roomId/recover
GET  /api/rooms/my
```

## 18.4 Roles

```http
GET  /api/rooms/:roomId/roles
POST /api/rooms/:roomId/roles/lock
POST /api/rooms/:roomId/roles/recommend
```

## 18.5 Messages

```http
GET  /api/rooms/:roomId/messages?afterMessageId=
POST /api/rooms/:roomId/messages
POST /api/messages/:messageId/revoke
```

## 18.6 Votes

```http
POST /api/rooms/:roomId/vote
GET  /api/rooms/:roomId/votes
```

## 18.7 Works

```http
GET  /api/works/:workId
POST /api/rooms/:roomId/generate-work
POST /api/works/:workId/export-txt
POST /api/works/:workId/share-poster
GET  /api/works/my
```

## 18.8 Events

```http
POST /api/events
```

## 18.9 Admin

```http
GET  /api/admin/rooms
GET  /api/admin/rooms/:roomId
POST /api/admin/rooms/:roomId/force-abort
POST /api/admin/rooms/:roomId/recover
GET  /api/admin/ai-tasks
GET  /api/admin/audit-logs
POST /api/admin/templates
PUT  /api/admin/templates/:templateId
POST /api/admin/templates/:templateId/online
POST /api/admin/templates/:templateId/offline
```

---

# 19. 页面清单

## 19.1 小程序页面

1. 登录页
2. 首页
3. 试演页 / 试演弹层
4. 模板选择页
5. 创建房间页
6. 等待邀请页
7. 角色选择页
8. 角色秘密 / 习惯选择页
9. 准备开局页
10. 房间公聊页
11. 小说片段页
12. 结局投票页
13. 作品生成页
14. 完结作品页
15. 分享海报页
16. 我的房间页
17. 我的作品页
18. 举报 / 反馈页

## 19.2 后台页面

1. 登录页
2. Dashboard
3. 房间列表
4. 房间详情
5. 模板列表
6. 模板编辑
7. AI 任务日志
8. 内容审核日志
9. 用户行为日志
10. 违规用户管理
11. 异常房间干预

---

# 20. 模板内容结构

模板 JSON 示例：

```json
{
  "id": "template_001",
  "name": "午夜便利店员工守则",
  "hook": "凌晨3点的便利店，规则正在失效，你的选择决定所有人能不能活到天亮",
  "worldBase": "24小时便利店，有一套夜班员工守则，上一任店员一周前失踪。",
  "coreRules": [
    "凌晨3点后，不要回应红衣顾客。",
    "收银台下方出现纸条时，必须先看背面。",
    "监控出现延迟时，不要相信画面里的自己。"
  ],
  "ruleVariants": [
    "第4条规则今天失效了",
    "红衣顾客会提前10分钟出现",
    "监控画面会显示未来3分钟"
  ],
  "roles": [
    {
      "id": "clerk",
      "name": "夜班店员",
      "identity": "刚入职的夜班店员",
      "coreGoal": "活到天亮",
      "firstActionHint": "检查收银台下方的纸条",
      "secretOptions": [
        { "id": "s1", "text": "你昨晚其实见过红衣顾客" },
        { "id": "s2", "text": "你知道第4条规则是假的" }
      ],
      "habitOptions": [
        { "id": "h1", "text": "紧张时摸口袋里的硬币" },
        { "id": "h2", "text": "说谎时会避开别人的眼睛" }
      ]
    }
  ],
  "recommendedRoles": {
    "2p": ["clerk", "guard"],
    "3p": ["clerk", "guard", "sister"],
    "4p": ["clerk", "guard", "customer", "sister"]
  },
  "absentRoleHandling": "未出现角色仅作为背景人物或线索来源，不主动发言。",
  "phases": {
    "phase_1_abnormal": {
      "opening": "凌晨2:58，便利店门铃响了，但监控里没有人。",
      "rescueEvents": ["货架最深处传来一声轻响。"],
      "keyClues": ["收银台下方出现一张新规则纸条。"]
    }
  },
  "endings": [
    { "id": "safe", "title": "遵守规则，等到天亮" },
    { "id": "break", "title": "打破规则，打开大门" }
  ],
  "fallbackTexts": {
    "phaseSummary": "这一阶段，众人在异常的便利店中发现了新的规则线索。",
    "finalWork": "他们最终做出了选择，故事在天亮前迎来了结局。"
  }
}
```

---

# 21. 模板验收标准

每个模板上线前必须满足：

1. 一句话能讲清核心设定。
2. 开场 10 秒内有异常事件。
3. 4 个角色之间有冲突 / 牵连。
4. 每个角色至少有 1 个与主线相关的秘密。
5. 每个角色有第一步可做动作。
6. 4 个阶段都有固定事件、救场事件、线索库。
7. 至少 2 个结局分支。
8. 可在 30 分钟内完结。
9. 支持 2 人 / 3 人 / 4 人局。
10. 每个角色都有专属线索、可触发事件、冲突关系、影响结局的机会。
11. 每个模板至少内部跑通 3 局。
12. 每个模板上线前必须内容审核通过。

---

# 22. 模板上线流程

模板状态：

```ts
type TemplateStatus = 'draft' | 'testing' | 'approved' | 'online' | 'offline';
```

流程：

1. 运营填写模板。
2. 产品审核角色平衡。
3. 内容安全审核。
4. Prompt 适配测试。
5. 每个模板内部跑 3 局。
6. 生成小说质量验收。
7. 上线至小程序模板库。
8. 上线后按模板维度监控数据。

模板维度数据：

- 创建率
- 开局率
- 完局率
- 分享率
- 复玩率
- AI 失败率
- 违规率
- 平均发言数
- 平均 AI 成本

---

# 23. 核心指标与埋点

## 23.1 核心指标

| 指标 | 内测及格线 | 产品有戏线 |
|---|---:|---:|
| 首局启动转化率 | ≥25% | ≥40% |
| 单局至少2人发言率 | ≥80% | ≥95% |
| 单局全员发言率 | ≥60% | ≥80% |
| 完局率 | ≥50% | ≥70% |
| 完结分享率 | ≥15% | ≥30% |
| 7日复玩率 | ≥8% | ≥20% |

## 23.2 正式数据口径

所有核心指标只统计：

- formal_room
- session_type=formal
- 至少 2 名真人锁定角色
- 正式进入 phase_1_abnormal

不统计：

- 首页试演
- waiting_invite 试玩
- 未开局房间
- 单人试玩

## 23.3 复玩率口径

计入复玩必须同时满足：

1. 新局正式开局。
2. 至少 2 名真人。
3. 至少 2 人发言。
4. 不只是点击重开按钮。

## 23.4 埋点字段

所有事件带：

```json
{
  "event_name": "room_started",
  "user_id": "user_x",
  "room_id": "room_x",
  "session_type": "formal",
  "room_type": "formal_room",
  "share_token": "share_x",
  "payload": {}
}
```

---

# 24. 分享漏斗

漏斗：

```txt
完结用户
→ 点击分享
→ 保存/发送海报
→ 好友打开
→ 好友进入房间
→ 好友锁角
→ 好友正式开局
```

事件：

- share_click
- poster_save
- invite_card_open
- room_enter_from_share
- role_lock_from_share
- formal_start_from_share

---

# 25. 异常兜底

## 25.1 AI 生成失败

提示：

```txt
AI导演暂时卡住了，正在为你加载备用内容
```

处理：

- 记录 ai_task failed
- 调用备用文本
- 主流程不中断

## 25.2 内容审核失败

处理：

- 用户输入：禁止发送
- AI 输出：不展示，使用备用文本
- 完整作品：进入 audit_failed_view_only 或 manual_review

## 25.3 用户沉默

- 60 秒：提醒
- 90 秒：role_hint
- 180 秒：暂离处理

## 25.4 房间异常

- 进入 aborted
- 保留历史数据
- 发起人可恢复 / 解散
- 24 小时未恢复自动永久解散

## 25.5 分享失败

- 生成海报
- 提供保存到相册

---

# 26. 内测计划

## 第一轮：10 局人工陪跑

目标：

- 跑通流程
- 找到卡点
- 验证异常兜底

要求：

- 每个模板至少 1 局
- 累计不低于 30 人次

## 第二轮：50 局熟人测试

目标：

- 验证熟人传播
- 验证完局率
- 验证分享率

要求：

- 累计不低于 150 人次
- 陌生用户不超过 10%

## 第三轮：200 局灰度

目标：

- 验证并发
- 验证成本
- 验证复玩
- 验证内容安全

---

# 27. 上线前验收清单

必须全部通过：

1. 5 个模板每个至少跑完 5 局。
2. 每个模板都能 30 分钟内完结。
3. 每个角色至少触发 1 次专属高光事件。
4. AI 生成失败时主流程不中断。
5. 内容安全审核有效。
6. 邀请卡可正常打开房间。
7. 分享海报可正常保存。
8. 断线重连可恢复房间状态。
9. 后台能查看房间日志、AI 日志、违规日志。
10. 核心埋点可形成完整漏斗。
11. 单局 AI 成本在内测目标内。
12. 完结小说质量达到验收标准。
13. 2 人 / 3 人 / 4 人局都能正常完结。
14. 平票规则生效。
15. 角色锁定并发测试通过。
16. 分享归因 token 可追踪。
17. 作品审核失败状态展示正确。
18. 举报反馈可提交到后台。

---

# 28. 开发 Sprint 拆分

## Sprint 1：基础骨架

目标：

- Monorepo
- 数据库
- 登录
- 房间
- 角色锁定
- 基础后台

任务：

1. 初始化项目。
2. 配置 Prisma。
3. 实现 User / Room / RoomMember / RoleInstance。
4. 实现微信登录 mock。
5. 实现模板 seed。
6. 实现创建房间。
7. 实现角色锁定原子更新。
8. 实现后台房间日志。

## Sprint 2：核心互动

目标：

- 公聊
- 消息类型
- WebSocket
- 状态机

任务：

1. 实现 Message 表。
2. 实现发送消息。
3. 实现 WebSocket 广播。
4. 实现断线补消息。
5. 实现阶段定时器。
6. 实现阶段提前推进。
7. 实现投票。

## Sprint 3：AI 与小说生成

目标：

- AI 任务队列
- 试演
- 阶段片段
- 完结小说
- 兜底

任务：

1. 实现 AiTask。
2. 实现 mock AI provider。
3. 实现真实 provider 抽象接口。
4. 实现 trial generate。
5. 实现 phase summary。
6. 实现 final work。
7. 实现 fallback。
8. 实现 AI 日志。

## Sprint 4：合规与分享

目标：

- 内容安全
- 分享海报
- 分享归因
- 导出 TXT

任务：

1. 实现 audit service。
2. 实现 msg_sec_check adapter mock。
3. 实现分享 token。
4. 实现邀请卡片数据。
5. 实现海报生成。
6. 实现导出 TXT。
7. 实现分享漏斗埋点。

## Sprint 5：灰度与验收

目标：

- 数据看板
- 异常干预
- 测试用例
- 内测准备

任务：

1. 实现核心数据看板。
2. 实现异常房间干预。
3. 实现违规内容列表。
4. 编写测试用例。
5. 跑通 5 个模板。
6. 准备灰度部署。

---

# 29. Codex 开发要求

Codex 执行时必须：

1. 先创建项目目录和基础工程。
2. 先实现 P0-A，不要实现 P2。
3. 每个 Sprint 完成后写明：
   - 完成了什么
   - 如何运行
   - 如何测试
   - 有哪些未完成
4. 所有第三方服务先提供 mock adapter。
5. 所有真实密钥走 `.env`。
6. 代码必须 TypeScript 严格模式。
7. 后端必须有基础单元测试。
8. 数据库必须有 seed 数据。
9. 所有状态枚举统一放在 shared 包。
10. 不允许在前端写死核心业务状态。
11. AI provider 必须可替换。
12. 审核 provider 必须可替换。
13. 分享 provider 必须可替换。

---

# 30. 第一条给 Codex 的启动指令

把下面这段直接发给 Codex：

```text
请根据 docs/MVP_PRD.md 开发「多人角色共演 AI 故事局」MVP。

优先完成 P0-A 最小可上线闭环，不要开发 P2 功能，不要新增产品范围。

第一阶段任务：
1. 初始化 monorepo：apps/miniprogram、apps/admin、apps/api、packages/shared、packages/prompts、packages/templates。
2. 使用 TypeScript。
3. 后端使用 Node.js + NestJS 或 Express，数据库使用 PostgreSQL + Prisma。
4. 小程序端使用 Taro + React + TypeScript。
5. 后台使用 Next.js + React + TypeScript。
6. 创建 Prisma schema，包含 User、StoryTemplate、Room、RoomMember、RoleInstance、Message、Vote、Work、AiTask、AuditLog、EventLog、ShareToken。
7. 创建 5 个模板的 seed 数据，先完整实现 template_001「午夜便利店员工守则」。
8. 实现微信登录 mock、房间创建、角色锁定、消息发送、状态机基础逻辑。
9. 所有 AI、微信、内容安全服务先使用 mock adapter，保留真实 adapter 接口。
10. 完成后告诉我如何本地启动、如何跑测试、下一步 Sprint 该做什么。

严格遵守：正式局必须至少 2 名真人用户完成角色锁定，不允许 AI 陪演正式局；单人玩法只能是非正式试玩，不计入正式指标。
```

---

# 31. 第二条给 Codex 的继续开发指令

```text
继续根据 docs/MVP_PRD.md 开发 Sprint 2：核心互动。

目标：
1. 实现房间公聊页。
2. 实现消息类型 user_dialogue、user_action、ai_narration、ai_event、system_notice、phase_summary、vote、role_hint、offline_notice。
3. 实现 WebSocket 消息同步，断开后自动重连，失败降级为轮询。
4. 实现 client_message_id 幂等去重。
5. 实现阶段状态机：phase_1_abnormal、phase_2_clue、phase_3_conflict、phase_4_vote。
6. 实现阶段倒计时、到点自动推进、满足条件提前推进。
7. 实现结局投票和平票规则。
8. 实现用户离线3分钟角色暂离，回归后展示3句剧情摘要。
9. 完成基础测试。

不要做玩家私聊，不要做公开匹配，不要做付费功能。
```

---

# 32. 第三条给 Codex 的 AI 开发指令

```text
继续根据 docs/MVP_PRD.md 开发 Sprint 3：AI 与小说生成。

目标：
1. 实现 AiTask 队列。
2. 实现 AIProvider 接口，包含 mockProvider 和 realProvider 占位。
3. 实现首页 30 秒试演生成。
4. 实现 waiting_invite 等待试玩，最多1-2轮，不计入正式数据。
5. 实现阶段小说片段生成，每阶段结束触发一次。
6. 实现完结小说生成，默认一次生成，失败后合并阶段片段兜底。
7. 实现 AI 上下文组装：固定上下文、动态上下文、长期摘要。
8. 实现 AI 秘密暴露规则，禁止剧透未暴露角色秘密。
9. 实现 AI 输出质量基础校验。
10. 实现 AI 日志与成本统计字段。

所有 AI 调用先使用 mockProvider，mock 文本要能完整跑通流程。
```

---

# 33. 第四条给 Codex 的合规与分享开发指令

```text
继续根据 docs/MVP_PRD.md 开发 Sprint 4：合规与分享。

目标：
1. 实现 AuditProvider 接口，包含 mockAuditProvider 和 realWeChatAuditProvider 占位。
2. 所有用户可编辑内容必须经过 audit service。
3. AI 生成内容展示前必须审核。
4. 完整小说按500-800字分段审核。
5. 实现作品 audit_status：draft_generated、audit_passed、audit_failed_view_only、manual_review、blocked。
6. 实现分享 token 归因。
7. 实现邀请卡片数据接口。
8. 实现分享海报生成，先用 HTML canvas / 后端图片生成 mock。
9. 实现导出 TXT。
10. 实现分享漏斗埋点：share_click、poster_save、invite_card_open、room_enter_from_share、role_lock_from_share、formal_start_from_share。
```

---

# 34. 第五条给 Codex 的后台与验收开发指令

```text
继续根据 docs/MVP_PRD.md 开发 Sprint 5：后台与验收。

目标：
1. 实现内部 Web 管理后台。
2. 实现房间列表、房间详情、消息日志、AI任务日志、审核日志。
3. 实现模板管理基础能力。
4. 实现异常房间强制结束、恢复。
5. 实现违规内容下架和用户临时封禁。
6. 实现核心数据看板：登录、试演、创建、邀请、锁角、开局、互动、完局、分享、重开。
7. 按上线前验收清单补齐测试。
8. 确保5个模板均可跑通流程，至少 template_001 完整可玩。
```

---

# 35. 最终验收标准

MVP 通过标准：

1. 用户可登录。
2. 用户可完成首页试演。
3. 用户可创建熟人房间。
4. 邀请好友可进入房间。
5. 至少 2 名真人可锁定角色。
6. 发起人可开局。
7. 用户可公聊发言。
8. 房间可自动推进 4 阶段。
9. 用户可投票决定结局。
10. 系统可生成阶段小说片段。
11. 系统可生成完结小说。
12. 用户可查看我的作品。
13. 用户可分享海报。
14. 用户可同模板重开。
15. 内容审核链路生效。
16. 断线重连能恢复消息。
17. AI 失败不阻断流程。
18. 后台可查看日志和干预异常房间。
19. 核心埋点能形成漏斗。
20. 正式局数据不包含试玩数据。
