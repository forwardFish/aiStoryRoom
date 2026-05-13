# AI 多人协作小说平台 · 陌生人异步角色协作 MVP Codex 开发执行 PRD

> 版本：MVP-Codex-Ready v2.1  
> 产品方向：陌生人异步多人协作小说平台。  
> 重要修正：不是熟人实时房间；不是规则怪谈产品；不是多元宇宙产品。规则怪谈、多元宇宙、修仙、科幻、都市、悬疑、古风等都只是题材分支。  
> 核心目标：让完全陌生的用户围绕同一部小说，通过「选择角色视角 → 接一段剧情 → AI 改写成统一文风 → 发布入正文 → 他人继续接住 → AI 成章成稿」的方式，共同完成一部更灵活、更有参与感、更有群像生命力的小说。  
> 核心验证假设：用户是否愿意在一个公开故事项目中，选择一个角色视角，提交一段剧情贡献，并因为自己的段落被 AI 写入正文、被别人接住、被章节署名而持续参与、回访、分享、复玩。  
> 开发原则：先跑通「公开故事池 → 30秒读懂前情 → 认领一个可接段落 → AI 改写预览 → 用户确认发布 → 10段成章 → 贡献者署名」的最小闭环；不做熟人房间、不做实时聊天、不做复杂社区、不做长篇开放世界、不做真实付费。

---

## 0. 给 Codex 的总执行指令

你是资深全栈工程师，请根据本文档开发一个 MVP 项目。

请优先完成 P0-A 最小可上线闭环。不要擅自增加产品功能，不要实现 P2 功能，不要把产品做成普通小说站、普通 AI 续写器、普通聊天室、熟人剧本杀、单一规则怪谈或单一多元宇宙产品。

本项目必须严格遵守以下原则：

1. MVP 是「陌生人异步协作小说」，不是熟人实时局。
2. 用户不是邀请熟人进房间，而是在公开故事池中选择一个正在进行的故事项目，接下一段剧情。
3. 用户不是普通读者，而是「角色视角贡献者」；每次贡献都必须绑定一个角色视角。
4. 题材是可配置模板，不是产品主定位。规则怪谈、多元宇宙、修仙、科幻、都市、悬疑、古风等都只是 GenreTemplate。
5. AI 不是替用户写整部小说，而是负责：前情摘要、角色约束、内容审核、段落改写、统一文风、影响反馈、章节整理、成稿收束。
6. 用户输入必须先审核，再进入 AI 改写；AI 改写必须先给用户预览，用户确认后才发布为正式段落。
7. 每个故事必须有边界：默认 10 段生成 1 章，最多 30 段生成 MVP 短篇，避免无限烂尾。
8. 每个正式段落必须记录贡献者、角色视角、前置段落、AI 改写版本和审核状态。
9. 章节和最终作品必须展示贡献署名。
10. 所有用户可编辑内容必须过内容安全审核。
11. 先实现微信小程序用户端 + 内部 Web 管理后台 + 后端 API + AI 任务队列。
12. 所有第三方能力先用 mock adapter，保留真实 adapter 接口。
13. 代码必须可运行、可测试、可本地启动、可逐步接入真实微信与大模型服务。

---

## 1. 产品一句话定位

一个微信小程序里的 AI 多人协作小说平台。

用户进入公开故事池，选择一个正在创作的故事项目，基于前情摘要选择一个角色视角，写一句话或一小段剧情。AI 将用户的原始想法改写成统一文风的小说段落，经用户确认后发布入正文。陌生用户持续接龙，AI 每 10 段整理成章节，最终多人共同完成一部带贡献署名的小说。

推荐对外表达：

> 每个人接一段，AI 把大家写成一部小说。

备用表达：

> 选择一个角色，接下一段剧情；你写想法，AI 写成小说，别人继续接住你的伏笔。

---

## 2. 产品核心体验公式

持续兴趣 = 低门槛参与 + 强故事钩子 + 角色代入 + AI即时增强 + 被别人接住 + 成章奖励 + 回访钩子

对应设计：

1. 低门槛参与：用户不需要会写小说，只需要选择角色和动作，或写一句白话。
2. 强故事钩子：每个故事卡片必须告诉用户「现在发生了什么、为什么轮到你」。
3. 角色代入：每次接段必须绑定角色视角，不允许无身份乱写。
4. AI即时增强：用户白话输入后，AI 改写成小说段落，给用户预览。
5. 被别人接住：当别人接续用户段落或伏笔时，必须提醒用户。
6. 成章奖励：每 10 段生成一章，贡献者署名。
7. 回访钩子：我的参与、我的段落被接、我的故事成章、我的贡献被收录。

---

## 3. MVP 核心闭环

用户进入小程序  
→ 微信登录  
→ 首页看到公开故事池 / 「现在轮到你接」任务流  
→ 点击一个故事卡片  
→ 30 秒读懂前情摘要  
→ 查看当前可接角色视角  
→ 认领一个角色视角和接段机会  
→ 选择动作或自由输入  
→ 内容安全审核  
→ AI 改写成小说段落  
→ 用户预览并确认发布  
→ 段落进入故事正文  
→ 系统反馈「你的段落影响了什么」  
→ 其他用户继续接住  
→ 你收到「有人接住你的段落/伏笔」提醒  
→ 10 段生成一章  
→ AI 整理章节 + 贡献者署名  
→ 用户分享章节 / 继续接下一段 / 回到故事池

---

## 4. 明确不做范围

MVP 阶段禁止开发：

1. 熟人私密房间。
2. 实时公聊房间。
3. 30 分钟实时完局模式。
4. 邀请好友作为核心开局方式。
5. 永久角色锁定。
6. AI 正式陪演用户角色。
7. 用户自由创建完整世界观。
8. 用户自由创建核心角色设定。
9. 长篇无限连载。
10. 完整宇宙百科 / 世界观百科。
11. 复杂能力数值、战斗系统、装备系统。
12. 陌生人私聊、评论区、关注、粉丝体系。
13. 作品广场推荐算法，P0 只做简单故事池排序。
14. 真实付费体系。
15. 道具、积分、等级、抽卡、打赏。
16. 版权存证、作品商业授权。
17. 原生 App、PC 端 C 用户产品、H5 独立站。

---

## 5. 题材策略：题材是模板分支，不是主定位

### 5.1 主定位

主定位：AI 多人协作小说 / 陌生人异步角色协作小说。

### 5.2 MVP 题材模板

MVP 可内置 5 个题材模板，但它们都只是 StoryTemplate，不是产品主定位。

推荐首批模板：

1. 星门坠落：科幻 / 多元宇宙 / 英雄起源
2. 青云试炼：修仙 / 宗门 / 少年成长
3. 霓虹异能局：都市异能 / 群像 / 阵营冲突
4. 午夜便利店：规则怪谈 / 悬疑 / 生存
5. 长安秘卷：古风 / 悬疑 / 权谋

说明：

- 多元宇宙只是「星门坠落」模板。
- 规则怪谈只是「午夜便利店」模板。
- 后续可扩展：奇幻、武侠、校园、末世、赛博、历史、恋爱、轻喜剧等。

---

## 6. 终端与系统组成

### 6.1 微信小程序用户端

负责：

- 微信登录
- 首页公开故事池
- 故事卡片展示
- 故事详情页
- 30 秒前情摘要
- 当前可接角色视角
- 段落级认领
- 动作选择 / 自由输入
- AI 改写预览
- 用户确认发布
- 故事正文展示
- 章节展示
- 我的参与
- 我的作品
- 我的故事足迹
- 被接住提醒
- 分享章节海报
- 举报 / 反馈

### 6.2 内部 Web 管理后台

只给内部人员使用。

负责：

- 题材模板管理
- 故事项目管理
- 角色视角配置
- 段落审核
- AI 改写日志
- 章节生成日志
- 内容审核日志
- 异常故事干预
- 违规内容下架
- 用户封禁 / 解封
- 核心指标看板
- 模板维度数据

### 6.3 后端 API 服务

负责：

- 登录态
- 公开故事池
- 故事状态机
- 段落级角色认领并发控制
- 用户输入审核
- AI 任务创建
- 改写预览
- 正式发布
- 成章任务
- 站内通知与回访钩子
- 分享归因
- 埋点采集
- 后台管理接口

### 6.4 AI 任务队列

负责异步执行：

- 试写生成
- 前情摘要生成
- 段落改写
- OOC / 人设检查
- 影响反馈生成
- 章节整理
- 故事短篇收束
- 通知文案生成
- 审核后处理
- 失败兜底

---

## 7. 推荐技术栈

### 7.1 Monorepo

```txt
ai-collab-novel/
  apps/
    miniprogram/      # 微信小程序，Taro React TypeScript
    admin/            # 内部后台，Next.js React TypeScript
    api/              # 后端服务，NestJS 或 Express TypeScript
  packages/
    shared/           # 共享类型、枚举、校验逻辑
    prompts/          # Prompt 模板
    templates/        # 题材模板 JSON
  prisma/
    schema.prisma
    seed.ts
  docs/
    MVP_PRD.md
    API.md
    DB.md
    TEST_CASES.md
  docker-compose.yml
  package.json
  pnpm-workspace.yaml
  .env.example
```

### 7.2 前端

- 小程序：Taro + React + TypeScript
- 后台：Next.js + React + TypeScript
- UI：Tailwind CSS 或 Ant Design Web 后台
- 状态管理：Zustand
- 请求：fetch / axios
- 通知：P0 先做站内提醒，微信订阅消息后置

### 7.3 后端

- Node.js + TypeScript
- NestJS 优先，Express 也可
- PostgreSQL
- Prisma ORM
- Redis
- BullMQ / 任意 Redis 队列
- JWT / session token

### 7.4 第三方服务

- 微信登录：wx.login 获取 code，后端换取 openid/session_key
- 微信内容安全：msg_sec_check / 平台侧内容安全接口
- 微信分享：onShareAppMessage，onShareTimeline 按微信能力适配
- 大模型 API：先做抽象接口，支持 mock provider 和真实 provider
- 对象存储：可选，用于海报图片 / 导出文件

---

## 8. 用户角色与权限

### 8.1 C 端用户

权限：

- 登录小程序
- 浏览公开故事池
- 查看故事详情
- 查看 30 秒前情摘要
- 认领一个可接角色视角
- 提交一段接龙意图
- 预览 AI 改写段落
- 确认发布段落
- 查看别人接的段落
- 查看章节
- 关注自己参与过的故事
- 查看我的参与 / 我的故事足迹
- 分享章节或故事
- 举报反馈

限制：

- 不可直接修改已发布的正式段落。
- 不可删除别人段落。
- 不可操控其他角色做核心决定。
- 不可剧透未公开秘密。
- 不可绕过 AI 改写直接入正文。
- 不可永久占有角色。
- 不可创建完全自由世界观，MVP 只能从模板生成故事项目。

### 8.2 内部管理员

权限分层：

- admin：全权限
- operator：模板、内容、违规、故事干预
- developer：日志、AI 调用、异常排查
- viewer：只看数据看板

---

## 9. P0-A 最小可上线功能

### 9.1 用户登录

页面：

- 登录授权页
- 协议确认弹窗

规则：

1. 仅支持微信一键登录。
2. 首次登录必须同意用户协议、隐私政策、内容合规公约、多人协作版权规则、未成年人保护提示。
3. 不强制手机号注册。
4. 付费功能不在 MVP 正式实现，因此实名暂不触发。

接口：

```http
POST /api/auth/wechat-login
POST /api/user/agree-policy
GET  /api/user/me
```

---

### 9.2 首页：公开故事池 / 现在轮到你接

首页不做传统小说列表，而做「任务型故事池」。

首页模块：

1. 顶部主标语：
   - 选择一个角色，接下一段剧情。
   - 你写想法，AI 写成小说。
2. 新手可接
3. 快成章
4. 正在活跃
5. 我参与过的故事
6. 我的故事足迹

故事卡片必须回答 5 个问题：

1. 发生了什么？
2. 现在轮到谁？
3. 我能做什么？
4. 接完有什么结果？
5. 还差几段有成果？

卡片示例：

```txt
【星门坠落】
第1章 8/10 段

当前钩子：
城市中心的星门裂缝正在扩大，未来通缉令出现了第二个名字。

现在可接：
失忆少女：触碰星门碎片
机械师：破解未来通缉令

接完结果：
还差 2 段生成第 1 章，你的段落可能成为章节转折。

按钮：
接这一段
```

---

### 9.3 故事详情页

页面结构：

1. 故事标题
2. 题材标签
3. 当前章节进度
4. 30 秒前情摘要
5. 当前钩子
6. 当前可接角色视角
7. 已发布正文段落
8. 章节列表
9. 我要接一段按钮

30 秒前情摘要格式：

```txt
你只需要知道 4 件事：

1. 故事背景：{background}
2. 当前危机：{current_crisis}
3. 已知线索：{known_clues}
4. 当前问题：{current_question}
```

---

### 9.4 角色视角认领

规则：

1. 用户不是永久锁角色，而是认领「当前这一段的角色视角」。
2. 认领后获得 10 分钟编辑权。
3. 10 分钟未提交，认领释放。
4. 提交成功后，该段归属于用户。
5. 下一个用户可以继续接同一角色，也可以接其他可接角色。
6. 同一时间同一故事同一角色视角只允许一个用户编辑。
7. 认领必须后端原子操作。

角色视角卡字段：

- role_id
- role_name
- identity
- current_state
- motivation
- known_info
- hidden_info，AI 可见，用户可部分可见
- available_actions
- cannot_do
- suggested_opening_line
- contribution_goal

---

### 9.5 接龙编辑页

P0-A 输入方式：

1. 动作按钮
2. 选择式接法
3. 自由输入

动作按钮：

- 观察
- 询问
- 隐瞒
- 靠近
- 离开
- 使用能力 / 使用特长，具体文案按题材替换
- 求助

自由输入 placeholder：

```txt
你只需要写这个角色想做什么，不用写得像小说。
```

发送按钮：

```txt
让 AI 写成小说段落
```

---

### 9.6 AI 改写预览页

流程：

用户提交原始输入  
→ 内容安全审核  
→ AI 按角色、人设、前情、文风改写  
→ 展示预览  
→ 用户选择发布 / 换一种写法 / 放弃

预览内容必须展示：

1. 用户原始想法
2. AI 改写段落
3. 将被发布到哪个故事 / 章节
4. 可能造成的故事影响

按钮：

- 发布进故事
- 换一种写法
- 返回修改
- 放弃认领

规则：

1. 用户确认前，不进入正文。
2. 用户可最多请求 2 次重新改写。
3. 超过 2 次需返回修改原始输入。
4. 放弃认领后释放当前角色视角。
5. AI 改写失败时使用兜底改写模板。

---

### 9.7 正式发布与影响反馈

用户确认发布后：

1. 段落状态变为 published。
2. 写入 StorySegment。
3. 记录贡献者、角色视角、原始输入、AI 改写版本、审核状态。
4. 更新 StoryProject 当前进度。
5. 触发影响反馈。
6. 如果达到 10 段，触发章节生成任务。

发布成功反馈示例：

```txt
你已接入《星门坠落》第1章。

你的段落触发了：
- 星门碎片开始共鸣
- 机械师获得新的怀疑对象
- 第1章进度：8/10

还差 2 段生成第1章。
有人接住你的段落时，我会提醒你。
```

---

### 9.8 成章机制

规则：

1. 默认 10 个 published 段落生成 1 章。
2. 默认 30 个 published 段落生成一个 MVP 短篇。
3. 每个故事最多 3 章。
4. 章节生成后，AI 整理该 10 段为统一文风章节。
5. 章节必须署名贡献者。
6. 章节生成后，可继续进入下一章，直到故事完成。

章节页展示：

- 章节标题
- 章节正文
- 贡献者列表
- 关键转折
- 角色视角分布
- 下一章钩子
- 分享按钮

---

### 9.9 被别人接住提醒

触发条件：

当新段落的 previous_segment_id 指向用户贡献段落，或 AI 判断新段落承接了用户伏笔时，生成提醒。

提醒文案示例：

```txt
有人接住了你的伏笔。

你留下的“未来通缉令”，被另一位玩家写成了第1章关键转折。
```

P0 实现：先做站内通知，不接微信订阅消息。

---

### 9.10 我的参与 / 我的故事足迹

我的参与展示：

- 我接过的故事
- 我发布的段落
- 被接住次数
- 收录章节
- 我的贡献署名

我的故事足迹展示：

- 已参与故事数
- 已发布段落数
- 被收录章节数
- 被别人接住次数
- 最常接的题材
- 最常选择的角色类型

---

## 10. P0-B 首版增强功能

P0-B 可在 P0-A 跑通后补充：

1. AI 推荐接法。
2. 更精细的 OOC 检测。
3. 角色常驻贡献者标记。
4. 章节分享海报美化。
5. 用户反馈入口增强。
6. 故事关注功能。
7. 站内通知中心增强。
8. 后台人工重写章节标题。
9. 高质量章节润色二次生成。

---

## 11. P1 / P2 后置功能

P1：

1. 评论
2. 点赞
3. 收藏
4. 关注故事更新
5. 用户主页
6. 贡献榜
7. 题材筛选
8. 故事搜索
9. AI 续接建议
10. 投稿创建故事雏形，但需后台审核

P2：

1. 作品广场推荐算法
2. 长篇连载
3. 用户自建世界观
4. 角色长期绑定
5. 作者收益
6. IP孵化
7. 付费精修
8. 版权存证
9. 多故事宇宙联动
10. 原生 App

---

## 12. 故事状态机

### 12.1 StoryProject 状态

```ts
type StoryStatus =
  | 'draft'
  | 'open'
  | 'chapter_generating'
  | 'chapter_completed'
  | 'story_completed'
  | 'paused'
  | 'blocked';
```

- draft：后台创建或模板初始化中。
- open：故事公开可接。
- chapter_generating：达到 10 段，正在生成章节。
- chapter_completed：章节生成完成，可分享，可进入下一章。
- story_completed：达到 30 段或管理员收束，生成 MVP 短篇完成。
- paused：运营暂停，暂不可接。
- blocked：违规下架。

### 12.2 SegmentClaim 状态

```ts
type ClaimStatus =
  | 'claimed'
  | 'expired'
  | 'submitted'
  | 'released';
```

### 12.3 StorySegment 状态

```ts
type SegmentStatus =
  | 'draft_input'
  | 'audit_reviewing'
  | 'ai_rewriting'
  | 'user_confirming'
  | 'published'
  | 'rejected'
  | 'blocked';
```

---

## 13. AI 规则

### 13.1 AI 定位

AI 是：

- 前情摘要员
- 角色守门员
- 文风统一器
- 段落改写器
- 章节编辑
- 成稿整理者
- 回访钩子生成器

### 13.2 AI 禁止

1. 替用户决定角色核心选择。
2. 操控未被当前用户认领的角色做重大决定。
3. 剧透未公开秘密。
4. 随意新增脱离模板的大设定。
5. 把不同题材写混。
6. 把用户白话输入改到完全背离原意。
7. 生成过度血腥、低俗、违法、政治敏感内容。
8. 擅自完结未达到成章条件的故事。

### 13.3 AI 可以

1. 把用户白话改写成小说段落。
2. 补充环境、神态、节奏、内心活动。
3. 对前文伏笔做轻微承接。
4. 生成“这段影响了什么”。
5. 生成 30 秒前情摘要。
6. 整理 10 段为章节。
7. 在章节末尾留下下一章钩子。

---

## 14. AI 改写规则

AI 改写必须：

1. 保留用户原始意图。
2. 使用第三人称小说叙述。
3. 符合当前角色视角。
4. 不操控其他角色做重大决定。
5. 不剧透未公开秘密。
6. 不跳过当前故事阶段。
7. 字数控制在 150-400 字。
8. 为下一位用户留下可接钩子。

---

## 15. AI 上下文管理

每次 AI 改写只携带必要上下文。

固定上下文：

- 题材模板
- 故事世界设定
- 当前章节目标
- 角色视角卡
- 禁止事项
- 文风要求

动态上下文：

- 最近 5-8 个 published 段落
- 当前章节摘要
- 已公开线索
- 已暴露秘密
- 上一个段落
- 当前用户原始输入

长期摘要：

- 已完成章节摘要
- 主要角色关系
- 已触发伏笔
- 未回收伏笔
- 故事主线方向

---

## 16. AI 输出质量验收标准

### 16.1 AI 改写段落

必须满足：

1. 150-400 字。
2. 保留用户核心意图。
3. 使用统一小说文风。
4. 符合角色视角。
5. 不替其他角色做重大决定。
6. 不剧透未公开秘密。
7. 至少留下 1 个可接钩子，除非故事即将收束。
8. 不出现违规内容。
9. 用户读完能理解“我的输入被增强了”。

### 16.2 前情摘要

必须满足：

1. 80-150 字。
2. 新用户 30 秒内看懂。
3. 说明背景、当前危机、已知线索、当前可接点。
4. 不写成长篇设定。

### 16.3 章节生成

必须满足：

1. 基于最近 10 个 published 段落。
2. 章节正文 1200-2500 字。
3. 保留主要贡献者的关键动作。
4. 统一文风。
5. 有明确章节标题。
6. 有章节末尾钩子。
7. 不新增破坏后续接龙的大设定。
8. 展示贡献者署名。

---

## 17. AI 任务队列

所有 AI 生成必须创建 AiTask。

任务状态：

```ts
type AiTaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'fallback_used';
```

任务类型：

```ts
type AiTaskType =
  | 'trial_rewrite'
  | 'summary_context'
  | 'segment_rewrite'
  | 'impact_feedback'
  | 'chapter_generate'
  | 'story_finalize'
  | 'notification_copy';
```

规则：

1. 同一个 segment 只允许一个 segment_rewrite running 任务。
2. 同一个 chapter 只允许一个 chapter_generate running 任务。
3. 任务最多重试 1 次。
4. 超时后进入 fallback_used。
5. 前端通过轮询获取任务状态，P0 不强制 WebSocket。
6. AI 生成结果必须先审核，再正式展示或入库。
7. AI 失败不能阻断主流程。

---

## 18. 内容安全与合规

### 18.1 必审内容

用户侧：

- 用户原始输入
- 用户昵称 / 头像展示信息
- 举报反馈
- 分享自定义文案，如果后续开放

AI 侧：

- AI 改写段落
- 前情摘要
- 章节正文
- 影响反馈
- 站内通知文案
- 分享海报文案

### 18.2 长文本审核

章节正文按 500-800 字分段审核。

任一分段不通过：

- 禁止分享
- 不进入公开章节
- 进入 manual_review

### 18.3 内容状态

```ts
type AuditStatus =
  | 'pending'
  | 'passed'
  | 'failed_view_only'
  | 'manual_review'
  | 'blocked';
```

### 18.4 未成年人保护与内容边界

允许：

- 冒险
- 成长
- 悬疑
- 轻度惊悚
- 奇幻想象
- 英雄选择
- 角色冲突

禁止：

- 过度血腥
- 色情低俗
- 现实危险行为诱导
- 现实人肉、辱骂、威胁
- 政治敏感内容
- 违法违规内容
- 鼓励自伤、自杀、极端行为的内容

---

## 19. 数据库核心表

以下为最小字段，Codex 可以用 Prisma 实现。

### 19.1 User

```prisma
model User {
  id              String   @id @default(cuid())
  openid          String   @unique
  unionid         String?
  nickname        String?
  avatarUrl       String?
  status          String   @default("active")
  policyAgreedAt  DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### 19.2 GenreTemplate

```prisma
model GenreTemplate {
  id          String   @id
  name        String
  genre       String
  hook        String
  worldBase   String
  status      String   @default("draft")
  configJson  Json
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### 19.3 StoryProject

```prisma
model StoryProject {
  id              String   @id @default(cuid())
  templateId      String
  title           String
  hook            String
  status          String   @default("open")
  currentChapter  Int      @default(1)
  segmentCount    Int      @default(0)
  chapterCount    Int      @default(0)
  maxSegments     Int      @default(30)
  lastSegmentAt   DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### 19.4 RolePerspective

```prisma
model RolePerspective {
  id             String   @id @default(cuid())
  storyId        String
  roleKey        String
  roleName       String
  identity       String
  currentState   String
  motivation     String
  knownInfo      String
  hiddenInfo     String?
  availableJson  Json
  status         String   @default("active")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

### 19.5 SegmentClaim

```prisma
model SegmentClaim {
  id          String   @id @default(cuid())
  storyId     String
  userId      String
  roleId      String
  status      String   @default("claimed")
  expiresAt   DateTime
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### 19.6 StorySegment

```prisma
model StorySegment {
  id               String   @id @default(cuid())
  storyId           String
  chapterIndex      Int
  userId            String
  roleId            String
  previousSegmentId String?
  rawInput          String
  aiText            String?
  status            String   @default("draft_input")
  auditStatus       String   @default("pending")
  impactJson        Json?
  isKeyTurn         Boolean  @default(false)
  publishedAt       DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

### 19.7 Chapter

```prisma
model Chapter {
  id              String   @id @default(cuid())
  storyId          String
  chapterIndex     Int
  title            String
  content          String
  auditStatus      String   @default("pending")
  contributorJson  Json
  nextHook         String?
  status           String   @default("generated")
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([storyId, chapterIndex])
}
```

### 19.8 Notification

```prisma
model Notification {
  id          String   @id @default(cuid())
  userId      String
  storyId     String?
  segmentId   String?
  type        String
  title       String
  content     String
  isRead      Boolean  @default(false)
  createdAt   DateTime @default(now())
}
```

### 19.9 AiTask

```prisma
model AiTask {
  id             String   @id @default(cuid())
  storyId         String?
  segmentId       String?
  chapterId       String?
  taskType        String
  modelType       String
  promptVersion   String?
  status          String   @default("pending")
  inputTokens     Int?
  outputTokens    Int?
  cost            Float?
  errorMessage    String?
  resultJson      Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### 19.10 AuditLog

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

### 19.11 EventLog

```prisma
model EventLog {
  id           String   @id @default(cuid())
  userId       String?
  storyId      String?
  segmentId    String?
  eventName    String
  sessionType  String?
  source       String?
  shareToken   String?
  payload      Json?
  createdAt    DateTime @default(now())
}
```

### 19.12 ShareToken

```prisma
model ShareToken {
  id            String   @id @default(cuid())
  token         String   @unique
  storyId       String
  chapterId     String?
  segmentId     String?
  shareUserId   String
  scene         String
  channel       String
  createdAt     DateTime @default(now())
}
```

---

## 20. 核心 API 清单

### Auth

```http
POST /api/auth/wechat-login
GET  /api/user/me
POST /api/user/agree-policy
```

### Story Feed

```http
GET /api/stories/feed?tab=newbie|near_chapter|active|my
GET /api/stories/:storyId
GET /api/stories/:storyId/context-summary
GET /api/stories/:storyId/segments
GET /api/stories/:storyId/chapters
```

### Role Perspective

```http
GET  /api/stories/:storyId/roles/available
POST /api/stories/:storyId/claims
POST /api/claims/:claimId/release
```

### Segment

```http
POST /api/segments/submit-input
GET  /api/segments/:segmentId/rewrite-preview
POST /api/segments/:segmentId/rewrite-again
POST /api/segments/:segmentId/publish
POST /api/segments/:segmentId/reject
```

### Chapter

```http
POST /api/stories/:storyId/generate-chapter
GET  /api/chapters/:chapterId
POST /api/chapters/:chapterId/share-poster
```

### Notification / My / Event

```http
GET  /api/notifications
POST /api/notifications/:notificationId/read
GET /api/my/segments
GET /api/my/stories
GET /api/my/footprint
POST /api/events
```

### Admin

```http
GET  /api/admin/stories
GET  /api/admin/stories/:storyId
POST /api/admin/stories/:storyId/pause
POST /api/admin/stories/:storyId/resume
POST /api/admin/stories/:storyId/block
GET  /api/admin/templates
POST /api/admin/templates
PUT  /api/admin/templates/:templateId
POST /api/admin/templates/:templateId/online
POST /api/admin/templates/:templateId/offline
GET  /api/admin/segments
POST /api/admin/segments/:segmentId/block
GET  /api/admin/ai-tasks
GET  /api/admin/audit-logs
GET  /api/admin/events
```

---

## 21. 页面清单

### 小程序页面

1. 登录页
2. 首页故事池
3. 故事详情页
4. 前情摘要页 / 弹层
5. 选择角色视角页
6. 接龙编辑页
7. AI 改写预览页
8. 发布成功影响反馈页
9. 故事正文页
10. 章节页
11. 章节生成中页
12. 我的参与页
13. 我的作品 / 章节页
14. 我的故事足迹页
15. 通知页
16. 分享海报页
17. 举报 / 反馈页

### 后台页面

1. 登录页
2. Dashboard
3. 故事项目列表
4. 故事项目详情
5. 段落列表
6. 章节列表
7. 题材模板列表
8. 题材模板编辑
9. AI 任务日志
10. 内容审核日志
11. 用户行为日志
12. 违规用户管理
13. 异常故事干预

---

## 22. 题材模板 JSON 结构

示例：星门坠落只是一个模板，不是主定位。

```json
{
  "id": "template_stargate_001",
  "name": "星门坠落",
  "genre": "科幻 / 多元宇宙 / 英雄起源",
  "hook": "城市中心坠下一道星门，普通人开始听见来自不同世界的声音。",
  "worldBase": "星门坠落后，城市出现空间裂缝，部分人觉醒了与其他世界相关的特殊能力。",
  "storyGoal": "用30段以内写出星门坠落后的第一场群像危机。",
  "chapterRule": {
    "segmentsPerChapter": 10,
    "maxChapters": 3
  },
  "rolePerspectives": [
    {
      "roleKey": "lost_girl",
      "roleName": "失忆少女",
      "identity": "从星门碎片旁醒来的少女",
      "motivation": "找回自己的名字，弄清自己是否是灾难源头",
      "knownInfo": "她能听见不同世界的回声",
      "hiddenInfo": "她梦见过这个世界毁灭后的样子",
      "availableActions": [
        "触碰星门碎片",
        "向机械师求助",
        "隐瞒自己听见的声音",
        "逃离现场"
      ],
      "cannotDo": [
        "不能直接证明自己无辜",
        "不能操控机械师的决定"
      ],
      "suggestedOpeningLine": "她伸出手，指尖触碰到星门碎片。"
    }
  ],
  "openingSummary": {
    "background": "星门坠落在城市中心。",
    "currentCrisis": "裂缝正在扩大，未来通缉令出现。",
    "knownClues": "通缉令上写着一个尚未出现的人名。",
    "currentQuestion": "谁要先触碰星门碎片？"
  },
  "styleGuide": {
    "tone": "燃、悬念、群像、电影感",
    "person": "third_person",
    "forbidden": [
      "不要写成恐怖血腥",
      "不要突然扩大到全宇宙战争",
      "不要替未认领角色做重大决定"
    ]
  },
  "fallbackTexts": {
    "rewrite": "角色做出了一个谨慎的选择，新的线索随之浮现。",
    "chapter": "这一章中，几位陌生人的选择共同改变了故事走向。"
  }
}
```

---

## 23. 模板验收标准

每个题材模板上线前必须满足：

1. 一句话能讲清核心设定。
2. 30 秒前情摘要能让新用户看懂。
3. 至少 3 个可接角色视角。
4. 每个角色视角都有当前处境、动机、已知信息、可选行动。
5. 每个角色视角都有“不能做什么”，防止越界。
6. 每个模板必须有清晰章节目标。
7. 每 10 段能整理成一个章节。
8. 30 段以内能形成一个 MVP 短篇。
9. 每个段落都能留下可接钩子。
10. AI 改写不会过度扩写世界观。
11. 每个模板至少内部跑通 3 个章节测试。
12. 内容安全审核通过。

---

## 24. 模板上线流程

模板状态：

```ts
type TemplateStatus = 'draft' | 'testing' | 'approved' | 'online' | 'offline';
```

流程：

1. 运营填写模板。
2. 产品审核角色视角是否有代入感。
3. 内容安全审核。
4. Prompt 适配测试。
5. 每个模板内部跑 10 段接龙测试。
6. 生成章节质量验收。
7. 上线至故事池。
8. 上线后按模板维度监控数据。

模板维度数据：

- 卡片点击率
- 前情摘要阅读率
- 接龙启动率
- 提交率
- AI 改写确认率
- 成章率
- 被接住率
- 次日回访率
- 分享率
- AI 失败率
- 违规率
- 平均 AI 成本

---

## 25. 核心指标与埋点

### 25.1 核心指标

| 指标 | 内测及格线 | 产品有戏线 |
|---|---:|---:|
| 故事卡点击率 | ≥20% | ≥35% |
| 前情摘要读完率 | ≥50% | ≥70% |
| 接龙启动率 | ≥20% | ≥35% |
| 接龙提交率 | ≥40% | ≥60% |
| AI改写确认率 | ≥50% | ≥70% |
| 发布后继续浏览率 | ≥30% | ≥50% |
| 被接后回访率 | ≥15% | ≥30% |
| 章节完成率 | ≥30% | ≥50% |
| 二次接龙率 | ≥10% | ≥25% |
| 分享率 | ≥10% | ≥25% |

### 25.2 正式数据口径

只统计：

- published 的正式段落
- open 状态故事
- passed 审核内容
- 用户确认发布行为

不统计：

- AI 改写预览但未确认发布
- 审核失败内容
- 用户编辑中草稿
- 后台测试故事，除非明确标注 test=false

### 25.3 关键埋点事件

```txt
app_open
login_success
feed_story_impression
feed_story_click
summary_view
summary_complete
role_perspective_view
claim_started
claim_expired
input_submitted
rewrite_preview_shown
rewrite_regenerate_click
rewrite_confirmed
segment_published
impact_feedback_view
chapter_generating
chapter_completed
segment_continued_by_other
notification_opened
second_contribution_started
share_click
poster_save
story_followed
report_submitted
```

---

## 26. 分享漏斗

漏斗：

```txt
章节完成用户
→ 点击分享
→ 保存/发送海报
→ 好友打开故事
→ 好友查看前情摘要
→ 好友开始接龙
→ 好友确认发布
```

事件：

- share_click
- poster_save
- share_open
- shared_story_summary_view
- shared_user_claim_started
- shared_user_segment_published

每次分享生成 share_token，用于归因。

---

## 27. 异常兜底

### 27.1 AI 改写失败

提示：

```txt
AI 暂时卡住了，正在为你加载备用写法。
```

处理：

- 记录 ai_task failed
- 调用备用改写模板
- 保留用户原始输入
- 不阻断流程

### 27.2 审核失败

处理：

- 用户输入审核失败：禁止进入 AI 改写
- AI 改写审核失败：不展示，重新生成一次
- 章节审核失败：不公开章节，进入人工审核

### 27.3 认领超时

- 8 分钟提醒
- 10 分钟自动释放
- 用户草稿不发布
- 释放角色视角给其他用户

### 27.4 章节生成失败

- 使用 10 段段落拼接生成简版章节
- 标记 fallback_used
- 后台可重新生成

### 27.5 故事异常

- 故事进入 paused
- 后台可恢复 / 下架
- 用户看到“故事暂时维护中”

---

## 28. 内测计划

### 第一轮：10 个故事接龙人工测试

目标：

- 跑通流程
- 找到卡点
- 验证 AI 改写是否有爽感

要求：

- 至少覆盖 3 个题材模板
- 每个故事至少 10 段
- 观察用户是否愿意提交第二段

### 第二轮：50 个故事半开放测试

目标：

- 验证公开故事池
- 验证陌生人是否愿意接龙
- 验证成章率

观察：

- 卡片点击率
- 接龙启动率
- 提交率
- 改写确认率
- 成章率
- 回访率

### 第三轮：200 个故事灰度测试

目标：

- 验证模板质量
- 验证 AI 成本
- 验证内容安全
- 验证分享带新用户

---

## 29. 上线前验收清单

必须全部通过：

1. 5 个题材模板都可创建故事项目。
2. 每个模板至少跑完 10 段。
3. 每个模板至少生成 1 个章节。
4. 用户可查看前情摘要。
5. 用户可认领角色视角。
6. 认领超时可释放。
7. 用户输入可审核。
8. AI 改写可预览。
9. 用户确认后段落可发布。
10. AI 改写失败有兜底。
11. 10 段可触发章节生成。
12. 章节生成失败有兜底。
13. 贡献者署名正确。
14. 被别人接住提醒可生成。
15. 我的参与可查看。
16. 分享海报可生成。
17. 分享归因 token 可追踪。
18. 后台可查看故事、段落、AI日志、审核日志。
19. 核心埋点可形成完整漏斗。
20. 正式数据不包含草稿、审核失败、后台测试数据。

---

## 30. 开发 Sprint 拆分

### Sprint 1：基础骨架

目标：Monorepo、数据库、登录、模板 seed、公开故事池、基础后台。

任务：

1. 初始化项目。
2. 配置 Prisma。
3. 实现 User / GenreTemplate / StoryProject。
4. 实现微信登录 mock。
5. 实现 5 个题材模板 seed。
6. 实现故事池 API。
7. 实现故事详情 API。
8. 实现后台故事列表。

### Sprint 2：接龙核心

目标：角色视角、段落认领、用户输入、AI 改写预览。

任务：

1. 实现 RolePerspective。
2. 实现 SegmentClaim。
3. 实现 StorySegment。
4. 实现认领并发控制。
5. 实现接龙编辑页。
6. 实现提交原始输入。
7. 实现 AI 改写 mock。
8. 实现预览确认发布。

### Sprint 3：AI 与章节生成

目标：AI 任务队列、前情摘要、改写、成章。

任务：

1. 实现 AiTask。
2. 实现 AIProvider mock / real adapter。
3. 实现 context summary。
4. 实现 segment rewrite。
5. 实现 impact feedback。
6. 实现 chapter generate。
7. 实现 fallback。
8. 实现 AI 日志。

### Sprint 4：合规、通知与分享

目标：内容安全、通知、分享归因、海报。

任务：

1. 实现 AuditProvider mock / real adapter。
2. 实现用户输入审核。
3. 实现 AI 输出审核。
4. 实现 Notification。
5. 实现被接住提醒。
6. 实现 ShareToken。
7. 实现章节分享海报。
8. 实现分享漏斗埋点。

### Sprint 5：后台与灰度

目标：后台管理、数据看板、测试、灰度准备。

任务：

1. 实现模板管理。
2. 实现故事管理。
3. 实现段落管理。
4. 实现 AI 任务日志。
5. 实现审核日志。
6. 实现核心指标看板。
7. 编写测试用例。
8. 跑通 5 个模板。

---

## 31. Codex 开发要求

Codex 执行时必须：

1. 先创建项目目录和基础工程。
2. 先实现 P0-A，不要实现 P2。
3. 每个 Sprint 完成后写明完成了什么、如何运行、如何测试、有哪些未完成。
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
14. P0 不做实时聊天，不做熟人房间。

---

## 32. 第一条给 Codex 的启动指令

把下面这段直接发给 Codex：

```text
请根据 docs/MVP_PRD.md 开发「AI 多人协作小说平台」MVP。

这是陌生人异步角色协作小说，不是熟人实时房间，不是单一规则怪谈，不是单一多元宇宙。题材只是模板分支，主产品是“多人共同完成一部小说”。

优先完成 P0-A 最小可上线闭环，不要开发 P2 功能，不要新增产品范围。

第一阶段任务：
1. 初始化 monorepo：apps/miniprogram、apps/admin、apps/api、packages/shared、packages/prompts、packages/templates。
2. 使用 TypeScript。
3. 后端使用 Node.js + NestJS 或 Express，数据库使用 PostgreSQL + Prisma。
4. 小程序端使用 Taro + React + TypeScript。
5. 后台使用 Next.js + React + TypeScript。
6. 创建 Prisma schema，包含 User、GenreTemplate、StoryProject、RolePerspective、SegmentClaim、StorySegment、Chapter、Notification、AiTask、AuditLog、EventLog、ShareToken。
7. 创建 5 个题材模板 seed 数据：星门坠落、青云试炼、霓虹异能局、午夜便利店、长安秘卷。
8. 实现微信登录 mock、首页故事池、故事详情、前情摘要、角色视角认领、原始输入提交、AI 改写 mock、预览确认发布。
9. 所有 AI、微信、内容安全服务先使用 mock adapter，保留真实 adapter 接口。
10. 完成后告诉我如何本地启动、如何跑测试、下一步 Sprint 该做什么。

严格遵守：P0 不做熟人房间，不做实时公聊，不做永久角色锁定；每个正式贡献必须绑定角色视角，并经过 AI 改写预览和用户确认发布。
```

---

## 33. 后续 Codex 继续开发指令

### Sprint 2 指令

```text
继续根据 docs/MVP_PRD.md 开发 Sprint 2：接龙核心。

目标：
1. 实现故事详情页。
2. 实现 30 秒前情摘要展示。
3. 实现当前可接角色视角列表。
4. 实现段落级角色视角认领，认领有效期10分钟。
5. 实现认领并发控制，同一角色视角同一时间只能一个用户编辑。
6. 实现接龙编辑页：动作按钮、选择式接法、自由输入。
7. 实现用户原始输入提交。
8. 实现 AI 改写预览 mock。
9. 实现用户确认发布，发布后段落进入正文。
10. 实现发布成功影响反馈。
11. 实现我的参与基础页面。

不要做实时公聊，不要做熟人房间，不要做私聊，不要做真实付费。
```

### Sprint 3 指令

```text
继续根据 docs/MVP_PRD.md 开发 Sprint 3：AI 与章节生成。

目标：
1. 实现 AiTask 队列。
2. 实现 AIProvider 接口，包含 mockProvider 和 realProvider 占位。
3. 实现前情摘要生成。
4. 实现 segment rewrite：用户白话输入 → AI 小说段落。
5. 实现 AI 改写规则：保留用户意图、第三人称、符合角色视角、不操控其他角色、不剧透。
6. 实现 impact feedback：发布后告诉用户这段影响了什么。
7. 实现 10 段成章：chapter_generate。
8. 实现章节贡献者署名。
9. 实现章节末尾下一段钩子。
10. 实现 AI 失败兜底。
11. 实现 AI 日志与成本统计字段。

所有 AI 调用先使用 mockProvider，mock 文本要能完整跑通流程。
```

### Sprint 4 指令

```text
继续根据 docs/MVP_PRD.md 开发 Sprint 4：合规、通知与分享。

目标：
1. 实现 AuditProvider 接口，包含 mockAuditProvider 和 realWeChatAuditProvider 占位。
2. 所有用户原始输入必须经过 audit service。
3. AI 改写段落展示前必须审核。
4. 章节正文按 500-800 字分段审核。
5. 实现内容状态：pending、passed、failed_view_only、manual_review、blocked。
6. 实现 Notification：有人接住我的段落、我参与的故事成章。
7. 实现 ShareToken 归因。
8. 实现章节分享海报生成。
9. 实现分享漏斗埋点：share_click、poster_save、share_open、shared_story_summary_view、shared_user_claim_started、shared_user_segment_published。
```

### Sprint 5 指令

```text
继续根据 docs/MVP_PRD.md 开发 Sprint 5：后台与验收。

目标：
1. 实现内部 Web 管理后台。
2. 实现故事列表、故事详情、段落列表、章节列表。
3. 实现题材模板管理基础能力。
4. 实现段落下架、故事暂停/恢复/下架。
5. 实现 AI 任务日志、审核日志、用户行为日志。
6. 实现核心数据看板：卡片点击、摘要读完、认领、输入提交、改写确认、发布、成章、回访、分享。
7. 按上线前验收清单补齐测试。
8. 确保 5 个题材模板均可跑通：至少每个模板完成 10 段并生成 1 章。
```

---

## 34. 最终验收标准

MVP 通过标准：

1. 用户可登录。
2. 用户可浏览公开故事池。
3. 用户可查看故事详情。
4. 用户可在 30 秒内读懂前情摘要。
5. 用户可认领一个角色视角。
6. 用户可提交原始输入。
7. 系统可审核用户输入。
8. AI 可生成改写预览。
9. 用户可确认发布。
10. 段落可进入故事正文。
11. 发布后可展示影响反馈。
12. 别人接住用户段落后可生成通知。
13. 每 10 段可生成 1 章。
14. 章节可展示贡献者署名。
15. 用户可查看我的参与。
16. 用户可查看我的故事足迹。
17. 用户可分享章节海报。
18. 内容审核链路生效。
19. AI 失败不阻断流程。
20. 后台可查看故事、段落、章节、AI日志、审核日志。
21. 核心埋点能形成漏斗。
22. 正式数据不包含草稿、审核失败、后台测试数据。
23. 产品中不出现“熟人实时房间”作为主流程。
24. 产品中不把规则怪谈或多元宇宙写成唯一主定位。
