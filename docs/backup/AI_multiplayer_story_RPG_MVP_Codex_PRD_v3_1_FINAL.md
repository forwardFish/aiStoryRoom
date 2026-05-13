# AI 多人故事局 MVP Codex 开发执行 PRD v3.1（轻量群像命运线共演版）

> 版本：MVP-Codex-Ready v3.1  
> 修改依据：基于 v2.1「陌生人异步角色协作小说」文档重构。v2.1 的核心是「公开故事池 → 角色视角接段 → AI 改写 → 10 段成章」。v3.0 改为「角色行动 → AI 导演结算 → 世界状态变化 → 小说章节生成」的可玩闭环。  
> 产品方向：AI 导演驱动的多人故事局 / 轻 RPG 化多人互动小说；内置轻量“多人命运线共演”机制。  
> 核心目标：让用户像玩游戏一样进入角色、做行动、看后果、被剧情钩住，同时让每个玩家感知“我是自己命运线的主角”，最后自动生成一章多 POV 群像小说。  
> 核心验证假设：用户是否愿意因为「角色身份 + 专属开场 + 命运问题 + 行动选择 + AI 结算反馈 + 跨角色影响 + 多 POV 章节成果」而持续参与、分享、复玩。  
> 开发原则：先跑通「创建故事局 → 选择世界模板 → AI 生成章节沙盒和角色命运线 → 玩家提交行动 → AI 导演结算 → 生成三个回响和跨角色影响 → 更新线索/关系/危险等级 → 生成小说片段 → 5 个节点生成多 POV 章节 → 分享/继续下一章」的最小闭环。

---

## 0. 重大产品修正说明

原 v2.1 文档的产品形态偏「陌生人异步接龙写作平台」：用户选择角色视角，提交一段剧情想法，AI 改写后发布成正文，陌生用户继续接段，10 段成章。

本版本做以下关键修正：

| 项目 | v2.1 原方向 | v3.0 新方向 |
|---|---|---|
| 产品本质 | 多人协作小说 / 接龙写作 | AI 多人剧情游戏 / 轻 RPG 互动小说 |
| 用户行为 | 接一段剧情 | 角色行动：探索、询问、隐瞒、协作、冒险、选择 |
| AI 角色 | 改写器、文风统一器 | AI 导演、裁判、状态管理者、小说成文者 |
| 核心爽点 | 我的段落被写入正文 | 我的行动改变剧情，朋友影响我，最后生成小说 |
| 结构方式 | 10 段成章 | 章节沙盒：每章 3-5 个剧情节点，每节点玩家行动一次 |
| 防乱写方式 | AI 改写用户白话 | 行动约束 + 权限判断 + 世界规则锁 + AI 结算结果 |
| 多人方式 | 公开故事池陌生人接龙 | P0 支持 1 人试玩、2-5 人邀请/异步故事局；公开故事池后置 |
| 是否限时 | 认领 10 分钟 | 不用倒计时完局；用行动槽和节点结算控制节奏 |
| 结果产物 | 章节正文 + 贡献署名 | 小说章节 + 角色高光 + 状态变化 + 下一章悬念 + 分享卡 |

### v3.1 一句话

> 和朋友一起进入一个 AI 生成的故事世界；你只需要扮演角色做行动，AI 导演结算后果，并把你们的互动写成小说。

### 对外推荐表达

> **一起玩出一章小说。**

备用表达：

> 选择角色，做出行动，AI 导演把你们的选择写成故事。


### v3.1 核心升级说明

v3.1 不推翻 v3.0 的「AI 多人剧情局」主定位，也不把 MVP 扩张成完整开放世界 RPG。

本版本只在 P0-A 最小闭环中加入 6 个“轻量群像命运线共演”机制：

1. **专属开场**：每个玩家看到自己的第一幕，而不是所有人共用一个开场。
2. **命运问题**：每个角色都有一个贯穿本章的个人命运问题。
3. **三个回响**：每轮结算必须反馈个人回响、他人回响、世界回响。
4. **跨角色影响**：明确提示“我的行动影响了谁 / 谁的行动影响了我”。
5. **多 POV 章节**：最终章节按角色视角分段，每个玩家都有自己的章节段落。
6. **个人故事卡**：章节结束后生成每个玩家的个人主角卡。

因此，v3.1 的产品结构是：

```txt
外层表达：AI 多人故事局
核心体验：角色行动 + AI 导演结算 + 多人影响 + 小说成果
内核机制：轻量多人命运线共演
长期方向：AI 群像命运线共演平台
```

v3.1 仍然坚持：

1. P0 不做完整开放世界。
2. P0 不做复杂地图、装备、等级、战斗。
3. P0 不做公开故事池和创作者市场。
4. P0 不追求无限自由，而追求“可见因果”。
5. P0 的核心体验是：用户清楚感知到“我的选择改变了我、别人和世界”。

---

## 1. 给 Codex 的总执行指令

你是资深全栈工程师，请根据本文档开发一个 MVP 项目。

请优先完成 P0-A 最小可上线闭环。不要擅自增加产品功能，不要实现 P1/P2 功能，不要把产品做成普通小说站、普通 AI 续写器、普通聊天室、传统剧本杀、完整开放世界 RPG、重数值游戏或单一题材产品。

本项目必须严格遵守以下原则：

1. MVP 是「AI 多人剧情游戏 / 轻 RPG 化多人互动小说」，不是单纯多人写作平台。
2. 用户不是来写小说正文，而是来扮演角色、提交行动、观看 AI 导演结算。
3. 用户输入必须是「行动意图」，不是「剧情结果」。用户只能说自己尝试做什么，不能直接宣布成功、杀死、破解、揭开全部真相或操控其他角色。
4. AI 不是单纯续写器，而是导演系统，负责：场景推进、行动合法性判断、结果结算、状态更新、线索/关系/危险等级变化、小说片段生成、章节成文。
5. MVP 不做完整开放世界。采用「章节沙盒」：每章有固定场景、目标、可探索对象、剧情节点和收束条件。
6. MVP 支持无时间限制的异步参与，但必须用「行动槽 + 节点结算」防止故事无限卡住。
7. 每个剧情节点内，每个活跃玩家最多提交一次行动。所有活跃玩家行动完成，或房主点击“推进剧情”，即可触发 AI 结算。
8. 未行动玩家可以跳过，或由 AI 托管为「轻动作」，但 AI 不得替玩家做核心选择。
9. P0 必须支持 1 人试玩。单人模式由 AI 托管其他角色，用于降低冷启动门槛。
10. P0 推荐支持 2-5 人故事局。熟人邀请是核心冷启动方式；公开故事池可作为 P1 扩展。
11. 所有用户内容必须经过内容安全审核；所有 AI 输出也必须经过审核再展示。
12. 所有第三方能力先使用 mock adapter，保留真实 adapter 接口。
13. 代码必须可本地启动、可测试、可接入真实微信小程序和真实大模型服务。

---

## 2. 产品定位

### 2.1 产品不是这些

本产品不是：

1. 普通 AI 小说生成器。
2. 多人在线文档写作。
3. 传统剧本杀。
4. DND 跑团完整规则系统。
5. 开放世界 RPG 游戏。
6. 固定剧情互动小说。
7. 聊天室角色扮演。
8. 单一规则怪谈产品。
9. 单一多元宇宙产品。

### 2.2 产品是这个

本产品是：

> **AI 导演驱动的多人剧情游戏。用户通过角色行动改变剧情，AI 将过程生成小说章节。**

它的本质公式：

```txt
AI 多人故事局 =
世界模板
+ 章节沙盒
+ 角色身份
+ 专属开场
+ 个人秘密
+ 命运问题
+ 行动回合
+ AI 导演结算
+ 三个回响
+ 跨角色影响
+ 世界状态变化
+ 多 POV 小说章节生成
+ 个人故事卡
+ 分享/继续下一章
```

### 2.3 核心体验公式

```txt
好玩 =
低门槛进入
× 明确目标
× 有趣选择
× 即时反馈
× 不确定结果
× 多人影响
× 持续悬念
× 可分享成果
```

任何功能如果不能增强上述 8 项之一，P0 不做。


### 2.4 v3.1 核心体验升级：轻量多人命运线共演

v3.1 在 v3.0 的基础上增加“轻量多人命运线共演”。

这里的“命运线”不是复杂 RPG 长线养成，而是指每个玩家在当前章节内拥有：

1. 自己的专属开场。
2. 自己的个人目标。
3. 自己的隐藏秘密或私密线索。
4. 自己的命运问题。
5. 自己至少一次影响其他角色的机会。
6. 自己至少一次被其他角色影响的反馈。
7. 最终章节中的个人 POV 段落。
8. 章节结束后的个人故事卡。

#### 2.4.1 为什么 MVP 仍然叫“AI 多人故事局”

“AI 群像命运线共演平台”是长期愿景，但不适合作为 MVP 对外主表达。

MVP 阶段用户最容易理解的是：

```txt
和朋友一起玩出一章小说。
选择角色，做出行动，AI 导演把你们的选择写成故事。
```

所以对外仍然叫“AI 多人故事局 / AI 多人剧情局”。

但为了避免产品变成普通多人解谜局，P0 必须内置命运线机制。

#### 2.4.2 用户为什么会感觉自己是主角

用户不是因为“角色多”而觉得自己是主角，而是因为他能连续感知到：

1. 我有专属开场，不是公共开场。
2. 我有命运问题，不只是公共任务。
3. 我知道别人不知道的信息。
4. 我的行动改变了别人。
5. 别人的行动改变了我。
6. 我的故事被写进最终小说。
7. 我拿到了自己的个人故事卡。

#### 2.4.3 谋略感来自什么

MVP 不做复杂策略数值，谋略感主要来自 5 个机制：

1. **信息不对称**：每个玩家有不同私密线索。
2. **目标不完全一致**：玩家可以合作，但不一定完全信任。
3. **跨角色影响**：一个人的行动会改变另一个人的信息、风险或机会。
4. **延迟后果**：本轮行动可以在后续节点产生后果。
5. **公开/私密信息变化**：玩家需要判断哪些信息公开、哪些暂时保留。

#### 2.4.4 v3.1 的核心体验公式

```txt
好玩 =
低门槛进入
× 专属角色开场
× 明确命运问题
× 有趣行动选择
× AI 结算反馈
× 三个回响
× 跨角色影响
× 多 POV 小说成果
× 分享/复玩动机
```

---

## 3. MVP 核心闭环

### 3.1 用户主流程

```txt
用户进入小程序
→ 微信登录
→ 看到「开一局故事」/「加入朋友的故事」/「单人试玩」
→ 选择世界模板：午夜怪谈 / 修仙宗门 / 穿越生存
→ 创建 StoryRun
→ AI 根据模板生成本局章节沙盒、开场事件和角色卡
→ 用户选择角色或接受 AI 分配
→ 进入故事局房间
→ 查看当前剧情、当前目标、自己的角色秘密、可行动作
→ 提交角色行动
→ 内容安全审核
→ 行动合法性检查
→ 等待其他玩家行动，或房主点击推进剧情
→ AI 导演结算当前节点
→ 生成行动结果、公开叙事、线索变化、关系变化、危险等级变化
→ 进入下一剧情节点
→ 3-5 个节点后生成本章小说
→ 展示章节正文、角色高光、关键选择、下一章预告
→ 分享故事卡 / 继续下一章 / 邀请朋友加入
```

### 3.2 产品最小爽点

第一局必须做到：

```txt
30 秒知道怎么玩
1 分钟拿到角色
3 分钟提交第一次行动
5 分钟看到 AI 结算反馈
10 分钟出现反转
15 分钟生成一章小说雏形
结束后愿意分享或继续下一章
```

### 3.3 P0 成功判断

P0 不是看文字生成是否漂亮，而是看：

1. 用户是否愿意提交第一次行动。
2. 用户是否理解自己的角色目标。
3. AI 结算是否让用户觉得“我的行动有后果”。
4. 多人之间是否出现影响、协作、怀疑、保护、隐瞒。
5. 章节结果是否值得分享。
6. 用户是否想继续下一章。

---

## 4. P0 产品范围

### 4.1 P0-A 必做

1. 微信登录 mock。
2. 首页：开一局故事、单人试玩、加入故事。
3. 世界模板：午夜便利店、青云宗门、穿越荒村。
4. 创建 StoryRun。
5. AI 生成/读取章节沙盒。
6. 角色选择/分配。
7. 角色卡展示：身份、公开信息、个人目标、隐藏秘密、当前状态。
8. 故事局房间：当前剧情、当前目标、行动入口、线索、关系、玩家状态。
9. 行动提交页：行动类型、对象、方式、目的、风险档位、自定义补充。
10. 行动安全审核。
11. 行动合法性检查。
12. 节点推进：全部行动完成或房主手动推进。
13. AI 导演结算 mock/adapter。
14. 世界状态更新：线索、关系、危险等级、已公开事实、下一节点。
15. 小说片段生成。
16. 章节生成：每章 3-5 个节点，生成 800-1500 字章节。
17. 角色高光和下一章预告。
18. 分享卡/分享页基础版。
19. 我的故事局 / 我的角色 / 我的章节。
20. 后台基础查看：故事局、角色、行动、AI 任务、审核日志。
21. 事件埋点。
22. mock AI provider、mock audit provider、mock 微信 provider。
23. 角色专属开场：每个玩家进入故事后看到自己的第一幕。
24. 角色命运问题：每个角色有一个持续显示的个人命运问题。
25. 三个回响：每轮结算后展示个人回响、他人回响、世界回响。
26. 跨角色影响：明确提示“你的行动影响了谁 / 谁的行动如何影响你”。
27. 多 POV 章节：章节结果按角色视角分段，每个玩家至少有一个 POV 段落。
28. 个人故事卡：章节结束后为每个玩家生成自己的主角卡。
29. 信息权限基础版：支持公开线索、私密线索、指定角色可见线索。
30. 延迟后果基础版：AI 可以创建 delayed_effect，在后续节点触发。

### 4.2 P0-B 可做

1. AI 推荐行动。
2. 房主「让 AI 托管未行动角色」。
3. 更强的行动合法性检测。
4. 角色关系图。
5. 章节分享海报美化。
6. 通知中心：有人继续你的故事、章节生成、朋友加入。
7. 故事局复盘页。
8. 世界模板数据看板。
9. 命运网 Lite：用卡片展示角色、线索、地点、影响关系，不做复杂图谱。
10. AI 辅助创建世界种子 Lite：房主输入一句世界设定，AI 生成世界种子草稿，但不进入公开模板市场。
11. 信息定向分享：玩家可选择把线索只分享给某个角色。
12. 章节个人海报：为每个角色生成可分享的主角卡海报。

### 4.3 P1 后置

1. 公开故事池。
2. 陌生人加入公共故事局。
3. 点赞、收藏、评论。
4. 创作者创建世界种子。
5. 世界模板市场。
6. 付费开高级故事局。
7. 长篇连续章节。
8. 角色长期成长。
9. 用户主页和贡献榜。
10. 更精细的 AI 模型调度。

### 4.4 P2 后置

1. 完整开放世界。
2. 地图系统。
3. 装备/技能/战斗数值系统。
4. 创作者收益分成。
5. IP 孵化。
6. 原生 App。
7. 复杂社区和推荐算法。
8. 多世界联动。

---

## 5. 核心概念定义

### 5.1 WorldTemplate 世界模板

世界模板不是固定剧本，而是一个可生成故事局的「故事种子」。

包含：

1. 世界类型。
2. 基础设定。
3. 世界规则。
4. 禁止越界规则。
5. 角色原型。
6. 行动类型。
7. 线索池。
8. 导演事件卡池。
9. 章节沙盒模板。
10. 文风要求。

### 5.2 StoryRun 故事局

一次具体的游戏实例。

例如：

```txt
故事局：《午夜便利店：没有影子的客人》
玩家：3 人 + 2 个 AI 托管角色
当前章节：第 1 章
当前节点：节点 2 / 5
当前目标：确认黑衣人是否真实存在
危险等级：2/5
```

### 5.3 ChapterSandbox 章节沙盒

每章都是一个有限场景内的高自由度剧情沙盒。

包含：

1. 本章标题。
2. 主场景。
3. 章节目标。
4. 当前核心问题。
5. 可探索地点。
6. 关键 NPC。
7. 初始线索。
8. 可能触发的导演卡。
9. 节点数量。
10. 章节收束条件。

### 5.4 SceneNode 剧情节点

一章由 3-5 个节点组成。

每个节点包含：

1. 节点标题。
2. 当前剧情。
3. 当前目标。
4. 可行动建议。
5. 节点行动槽。
6. 节点推进条件。
7. AI 结算结果。

### 5.5 StoryRole 角色

角色不是传统 RPG 职业，而是小说人物。

角色字段：

1. 身份。
2. 能力/特长。
3. 公开信息。
4. 隐藏秘密。
5. 个人目标。
6. 当前状态。
7. 与其他角色关系。
8. 禁止行为。
9. 角色弧光。

### 5.6 PlayerAction 玩家行动

用户提交的不是正文，而是行动意图。

标准结构：

```txt
行动类型：探索 / 询问 / 隐瞒 / 协作 / 冒险 / 调查 / 对抗 / 选择 / 使用道具 / 自定义
行动对象：地点、物品、NPC、其他玩家角色、自己
行动方式：我准备怎么做
行动目的：我想达成什么
风险档位：保守 / 普通 / 冒险
补充描述：用户自己的白话
```

### 5.7 DirectorResolution AI 导演结算

AI 对一个节点所有玩家行动进行结算，输出：

1. 每个行动的结果：成功、失败、部分成功、付出代价、触发风险。
2. 公开剧情叙事。
3. 私密反馈。
4. 新线索。
5. 关系变化。
6. 危险等级变化。
7. 世界状态 patch。
8. 下一节点剧情钩子。
9. 下一轮推荐行动。

### 5.8 NarrativeSegment 小说片段

AI 导演结算后生成的正式叙事片段。它不是用户直接写的，而是 AI 基于行动和结算生成。


### 5.9 Chapter 章节

每 3-5 个节点生成一章小说，v3.1 不再只生成单一正文，而是生成“多 POV 群像章节”。

包含：

1. 章节标题。
2. 章节摘要。
3. 按角色视角分段的 POV 内容。
4. 群像交汇段。
5. 角色高光。
6. 关键选择。
7. 新增线索。
8. 关系变化。
9. 下一章预告。
10. 贡献玩家列表。
11. 每个玩家的个人故事卡。

### 5.10 CharacterArc 角色命运线

角色命运线是 v3.1 的核心补充。

它不等于长期成长系统，也不是复杂 RPG 数值，而是当前章节内每个玩家的主角感结构。

每个角色必须有：

1. `personalHook`：专属开场。
2. `destinyQuestion`：命运问题。
3. `privateClues`：个人私密线索。
4. `arcStage`：角色弧光阶段。
5. `keyChoices`：关键选择记录。
6. `impactSummary`：该角色已经影响了谁。
7. `unresolvedQuestions`：未解决问题。

示例：

```txt
角色：外卖骑手 陈舟
专属开场：你接到一份没有平台记录的订单，收货人是你自己。
命运问题：这份订单是让你送货，还是让你替别人留下？
私密线索：订单备注里写着“他已经碰了硬币”。
角色阶段：setup
```

### 5.11 Echo 三个回响

每次节点结算后，AI 必须为每个活跃玩家生成三个回响。

```txt
个人回响：你的行动对你自己的影响。
他人回响：你的行动对其他角色造成的影响。
世界回响：你的行动对公共世界状态造成的影响。
```

示例：

```txt
个人回响：你触碰旧硬币后，想起梦里有人说过一句话。
他人回响：外卖骑手的订单备注因为你的动作发生变化。
世界回响：便利店外的雨停了，但街道消失了。
```

三个回响的作用：

1. 让用户看见自己的行动后果。
2. 让用户感知自己不是配角。
3. 让用户理解故事线正在交织。
4. 给下一轮行动提供策略判断依据。

### 5.12 CrossImpact 跨角色影响

跨角色影响是指一个角色的行动改变了另一个角色的信息、风险、机会、关系或故事线。

类型：

1. `clue_change`：改变他人线索。
2. `relation_shift`：改变角色关系。
3. `risk`：给他人带来风险。
4. `opportunity`：给他人创造机会。
5. `delayed_effect`：延迟后果。

示例：

```txt
因为林鹿触碰硬币，陈舟的订单备注刷新为“他已经碰了硬币”。
因为顾言公开旧新闻，便利店老板开始删除监控。
因为陈舟隐瞒兼职经历，顾言对他的怀疑上升。
```

### 5.13 InformationVisibility 信息权限

v3.1 必须区分信息可见性。

```ts
export type InfoVisibility =
  | 'public'         // 所有人可见
  | 'role_private'   // 仅某个角色可见
  | 'shared'         // 指定角色可见
  | 'rumor'          // 模糊公开，不完整
  | 'hidden';        // 系统隐藏
```

信息权限用于制造谋略感。

玩家应该能看到：

1. 我知道的。
2. 大家知道的。
3. 某些人可能知道但没有公开的。
4. 我可以选择公开或继续隐瞒的。

P0-A 只需要支持 `public / role_private / hidden`。
P0-B 再支持 `shared / rumor`。

### 5.14 PersonalStoryCard 个人故事卡

每章结束后，每个玩家都要得到一张个人故事卡。

字段：

1. 角色名。
2. 主角类型。
3. 本章关键选择。
4. 我影响了谁。
5. 谁影响了我。
6. 我的高光时刻。
7. 我的未解问题。
8. 下一章个人钩子。

示例：

```txt
你的角色：外卖骑手 陈舟
主角类型：行动型主角 / 命运订单携带者
本章关键选择：你没有直接送单，而是先拨通了订单电话。
你影响了谁：你让夜班店员第一次意识到，外面也有人知道硬币。
未解问题：为什么收货人会是你自己？
```

### 5.15 FateNet Lite 命运网 Lite

命运网不是复杂图谱系统，P0-B 可做 Lite 版本。

展示内容：

1. 角色卡。
2. 线索卡。
3. 地点卡。
4. 影响卡。
5. 已形成连接。
6. 未确认连接。

示例：

```txt
夜班店员 林鹿
- 旧硬币
- 便利店监控
- 三年前失忆

外卖骑手 陈舟
- 未记录订单
- 收货人是自己
- 曾在便利店兼职

实习记者 顾言
- 十年前旧新闻
- 父亲录音
- 被删除照片

已形成连接：
旧硬币 ↔ 未记录订单
未记录订单 ↔ 十年前旧新闻
父亲录音 ↔ 便利店监控
```

P0-A 不强制做命运网页面，但必须保留数据结构，为 P0-B / P1 扩展。

---

## 6. 没有时间限制，如何不拖死

本产品不采用剧本杀式倒计时完局，但也不能无限等待。

### 6.1 节点推进条件

一个 SceneNode 可以在以下条件之一满足时推进：

1. 所有 active human players 已提交行动。
2. 单人模式中，用户已提交行动。
3. 房主点击「推进剧情」。
4. 房主选择「让 AI 托管未行动角色」。
5. 后台运营强制推进。

### 6.2 未行动玩家处理

未行动玩家不会阻塞故事。

可选处理：

1. `skipped`：本节点跳过，不生成核心行动。
2. `ai_minor_action`：AI 只生成轻动作，例如观察、沉默、跟随，不做重大决定。
3. `owner_controlled`：房主可以选择一个建议动作，但 P0 可不做。

### 6.3 行动槽规则

1. 每个节点每个 active 玩家最多 1 个行动。
2. 行动提交后不可随意修改；结算前允许撤回一次。
3. 结算后行动不可修改。
4. 每个节点最少 1 个有效行动即可推进。
5. 多人局建议至少 2 个行动后推进，但不强制。

---

## 7. 防止用户乱写的机制

### 7.1 核心原则

> 玩家只能声明意图，不能宣布结果。

允许：

```txt
我尝试靠近仓库门，蹲下观察门缝里有没有影子。
```

禁止：

```txt
我发现仓库里就是凶手，然后我把他抓住了。
```

### 7.2 四把锁

#### 7.2.1 世界规则锁

每个世界模板有硬规则。

例如午夜怪谈：

1. 异常存在必须遵守规则。
2. 真相必须通过线索逐步揭示。
3. 不允许突然变成超能力大战。
4. 不允许一步揭开全部真相。

例如修仙宗门：

1. 不能凭空突破大境界。
2. 不能无代价复活。
3. 不能随意改写宗门历史。
4. 不能直接召唤毁灭世界级存在。

#### 7.2.2 角色权限锁

玩家只能控制自己的角色。

允许：

```txt
我质问陈舟为什么刚才撒谎。
```

禁止：

```txt
陈舟被我吓得说出全部秘密。
```

#### 7.2.3 剧情阶段锁

每章有阶段：开场异常 → 探索线索 → 冲突升级 → 关键选择 → 悬念收束。

用户不能在第一节点直接写大结局。

#### 7.2.4 事实记忆锁

所有已发生事实写入 WorldStateSnapshot，后续 AI 不得自相矛盾。

例如：

```txt
仓库门已经从里面锁住。
顾言已经获得旧员工证。
林鹿不知道陈舟曾在便利店兼职。
沈眠手机出现过未来照片。
```

### 7.3 行动合法性检查结果

ActionGuard 输出：

```ts
export type ActionGuardResult = {
  allowed: boolean;
  severity: 'ok' | 'soft_warn' | 'rewrite_needed' | 'blocked';
  reason?: string;
  normalizedAction?: NormalizedAction;
  suggestions?: string[];
};
```

处理规则：

1. `ok`：进入审核和 AI 结算。
2. `soft_warn`：允许提交，但提示风险。
3. `rewrite_needed`：要求用户修改，或系统建议改写。
4. `blocked`：禁止提交。

---

## 8. 游戏感设计

### 8.1 不做重数值

P0 不做：

1. 等级。
2. 经验值。
3. 装备强化。
4. 攻击力。
5. 技能树。
6. 战斗回合。
7. 复杂地图。

### 8.2 做轻游戏反馈

P0 做：

1. 当前目标。
2. 行动类型。
3. 风险档位。
4. 线索卡。
5. 关系变化。
6. 危险等级。
7. 角色高光。
8. 下一章预告。

### 8.3 风险档位

```txt
保守：安全，信息少，较少触发危机。
普通：平衡，可能获得线索，也可能触发轻微风险。
冒险：可能获得关键线索，但可能提升危险等级或暴露秘密。
```

### 8.4 行动类型

| 行动类型 | 说明 | 示例 |
|---|---|---|
| 探索 | 查看地点或环境 | 检查仓库门缝 |
| 调查 | 分析线索、物品、记录 | 查看监控回放 |
| 询问 | 对 NPC 或玩家角色提问 | 询问陈舟是否来过这里 |
| 隐瞒 | 保留信息或掩饰异常 | 不公开手机照片 |
| 分享 | 公开线索 | 把旧员工证展示给大家 |
| 协作 | 邀请另一个角色共同行动 | 和顾言一起查看仓库 |
| 保护 | 保护某人或替其承担风险 | 挡在林鹿面前 |
| 对抗 | 阻止、质疑、干扰 | 阻止陈舟离开便利店 |
| 冒险 | 高风险行动 | 直接触碰异常符号 |
| 使用道具 | 使用已获得物品 | 用备用钥匙尝试开门 |
| 自定义 | 玩家自由输入 | 由 ActionGuard 检查 |

---

## 9. P0 题材模板策略

P0 只做 3 个模板，确保质量。

### 9.1 午夜便利店

类型：都市怪谈 / 悬疑 / 短篇高钩子。

优点：场景小、人物少、容易制造悬念、AI 不容易跑偏。

开场钩子：

```txt
凌晨 2:17，便利店自动门打开。
一个穿黑色雨衣的人走了进来。
但监控画面里，没有他的影子。
```

### 9.2 青云宗门

类型：修仙 / 宗门 / 少年成长 / 群像。

优点：中国用户熟悉，角色关系强，适合连续章节。

开场钩子：

```txt
青云宗三百年未响的禁地钟声，在无人敲击时响起。
只有少数弟子听见了钟声里有人叫自己的名字。
```

### 9.3 穿越荒村

类型：穿越 / 生存 / 团队选择。

优点：目标清晰，游戏感强，适合多人分工。

开场钩子：

```txt
你们醒来时，发现自己站在一座没有出口的荒村。
村口石碑上刻着一句话：天黑前，必须选出一个留下的人。
```

---

## 10. 页面设计清单

### 10.1 小程序页面

1. 登录页。
2. 首页。
3. 创建故事局页。
4. 加入故事局页。
5. 世界模板选择页。
6. 故事局等待页。
7. 角色选择页。
8. 角色卡页。
9. 故事局房间页。
10. 行动提交页。
11. 节点结算页。
12. 小说片段页。
13. 章节结果页。
14. 下一章预告页。
15. 我的故事局页。
16. 我的角色页。
17. 我的章节页。
18. 通知页。
19. 分享卡页。
20. 举报反馈页。

### 10.2 后台页面

1. 登录页。
2. Dashboard。
3. 世界模板列表。
4. 世界模板编辑。
5. 故事局列表。
6. 故事局详情。
7. 玩家行动列表。
8. 节点结算日志。
9. 世界状态快照。
10. AI 任务日志。
11. 内容审核日志。
12. 用户行为日志。
13. 故事局暂停/下架。
14. 模板数据看板。

---

## 11. 核心页面详细需求

### 11.1 首页

目标：让用户立刻知道这是可玩的，不是写作工具。

核心文案：

```txt
和朋友一起玩出一章小说
选择角色，做出行动，AI 导演把你们的选择写成故事。
```

入口：

1. 开一局故事。
2. 单人试玩。
3. 加入朋友的故事。
4. 我正在玩的故事。

首页卡片字段：

1. 世界模板名。
2. 一句话钩子。
3. 推荐人数。
4. 预计一章节点数。
5. 风格标签。
6. 开局按钮。

### 11.2 创建故事局页

字段：

1. templateId：世界模板。
2. runMode：single / invite / public_later。
3. maxPlayers：1-5。
4. aiCompanionCount：AI 托管角色数量。
5. tone：悬疑 / 热血 / 轻松 / 诡异 / 成长。
6. chapterLength：short，P0 固定 short。
7. ownerAsPlayer：房主是否参与。

创建后：

1. 创建 StoryRun。
2. 生成或读取本模板第一章 ChapterSandbox。
3. 创建 StoryRoles。
4. 创建第一 SceneNode。
5. 返回故事局等待页。

### 11.3 角色选择页

展示：

1. 角色名。
2. 一句话身份。
3. 公开目标。
4. 操作难度。
5. 推荐标签：新手推荐 / 推进剧情 / 适合隐藏 / 适合探索。

角色详情弹层：

1. 公开信息。
2. 个人目标。
3. 已知信息。
4. 隐藏秘密，选择后才展示。
5. 禁止行为。

规则：

1. 一个 human player 同一 StoryRun 只能选一个角色。
2. 角色可由 AI 托管。
3. AI 托管角色可后续被新玩家接管，P0 可不做。

### 11.4 故事局房间页

这是 MVP 最重要页面。

必须展示 6 个区域：

1. 当前剧情：AI 公共叙事。
2. 当前目标：本节点要解决的问题。
3. 我的角色：身份、目标、秘密入口。
4. 可行动作：推荐行动 + 自定义。
5. 已知线索：公开线索卡。
6. 玩家状态：谁已行动，谁未行动，是否可推进。

房主额外按钮：

1. 推进剧情。
2. 让 AI 托管未行动角色。
3. 暂停故事局。

### 11.5 行动提交页

字段：

```ts
type SubmitActionInput = {
  runId: string;
  nodeId: string;
  roleId: string;
  actionType: ActionType;
  targetType?: 'location' | 'object' | 'npc' | 'player_role' | 'self' | 'unknown';
  targetId?: string;
  targetText?: string;
  method: string;
  intent: string;
  riskLevel: 'safe' | 'normal' | 'risky';
  freeText?: string;
};
```

表单文案：

```txt
你不用写小说，只要说明你的角色想做什么。
```

示例模板：

```txt
我想对【仓库门】做【观察】，方式是【蹲下看门缝】，目的是【确认里面有没有人】，风险选择【普通】。
```

### 11.6 节点结算页

展示：

1. 结算状态：生成中 / 已完成 / 失败重试。
2. 本节点发生了什么。
3. 我的行动结果。
4. 团队获得的新线索。
5. 关系变化。
6. 危险等级变化。
7. 下一节点钩子。
8. 进入下一节点按钮。

### 11.7 章节结果页

展示：

1. 章节标题。
2. 章节正文。
3. 本章高光。
4. 关键选择。
5. 角色表现。
6. 新增线索。
7. 关系变化。
8. 下一章预告。
9. 分享按钮。
10. 继续下一章按钮。

---

## 12. 状态机设计

### 12.1 StoryRunStatus

```ts
export type StoryRunStatus =
  | 'draft'
  | 'waiting_players'
  | 'role_selecting'
  | 'playing'
  | 'resolving_node'
  | 'chapter_generating'
  | 'chapter_completed'
  | 'completed'
  | 'paused'
  | 'blocked';
```

### 12.2 SceneNodeStatus

```ts
export type SceneNodeStatus =
  | 'pending'
  | 'open_for_actions'
  | 'ready_to_resolve'
  | 'resolving'
  | 'resolved'
  | 'skipped'
  | 'blocked';
```

### 12.3 PlayerActionStatus

```ts
export type PlayerActionStatus =
  | 'draft'
  | 'audit_pending'
  | 'guard_checking'
  | 'accepted'
  | 'rewrite_required'
  | 'blocked'
  | 'included_in_resolution'
  | 'cancelled';
```

### 12.4 AiTaskStatus

```ts
export type AiTaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'fallback_used'
  | 'cancelled';
```

### 12.5 AuditStatus

```ts
export type AuditStatus =
  | 'pending'
  | 'passed'
  | 'failed_view_only'
  | 'manual_review'
  | 'blocked';
```

---

## 13. 数据库设计 Prisma Schema

下面是 P0 推荐 schema。Codex 可以按实际框架调整，但字段含义不能缺失。

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

model WorldTemplate {
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

model StoryRun {
  id                String   @id @default(cuid())
  templateId         String
  ownerUserId        String
  title              String
  hook               String
  mode               String   @default("invite") // single | invite | public
  status             String   @default("waiting_players")
  currentChapter     Int      @default(1)
  currentNodeId      String?
  maxPlayers         Int      @default(5)
  activeHumanCount   Int      @default(1)
  aiPlayerCount      Int      @default(0)
  dangerLevel        Int      @default(1)
  maxDangerLevel     Int      @default(5)
  chapterCount       Int      @default(0)
  completedNodeCount Int      @default(0)
  summary            String?
  stateJson          Json
  visibility         String   @default("link") // private | link | public
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}

model StoryPlayer {
  id          String   @id @default(cuid())
  runId       String
  userId      String?
  roleId      String?
  playerType  String   @default("human") // human | ai
  status      String   @default("active")
  joinedAt    DateTime @default(now())
  lastActiveAt DateTime?

  @@unique([runId, userId])
}

model StoryRole {
  id                String   @id @default(cuid())
  runId             String
  roleKey           String
  roleName          String
  identity          String
  publicInfo        String
  hiddenSecret      String?
  personalGoal      String
  currentState      String
  abilityText       String?
  arcText           String?

  // v3.1 轻量命运线字段
  personalHook      String?  // 专属开场
  destinyQuestion   String?  // 命运问题
  privateCluesJson  Json?    // 个人私密线索
  impactSummaryJson Json?    // 这个角色已经造成过哪些影响
  unresolvedJson    Json?    // 未解决问题
  arcStage          String   @default("setup") // setup | rising | conflict | choice | consequence

  knownInfoJson     Json
  cannotDoJson      Json
  isAiControlled    Boolean  @default(false)
  status            String   @default("available") // available | claimed | inactive
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model RoleRelation {
  id             String   @id @default(cuid())
  runId           String
  fromRoleId      String
  toRoleId        String
  relationType    String // trust | suspicion | debt | protect | conflict | secret
  score           Int      @default(0)
  publicNote      String?
  hiddenNote      String?
  updatedByNodeId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([runId, fromRoleId, toRoleId, relationType])
}

model CrossImpact {
  id              String   @id @default(cuid())
  runId            String
  nodeId           String
  sourceRoleId     String
  targetRoleId     String?
  impactType       String   // clue_change | relation_shift | risk | opportunity | delayed_effect
  visibility       String   @default("public") // public | source_private | target_private | hidden
  title            String
  description      String
  delayedUntilNode Int?
  isResolved       Boolean  @default(false)
  createdAt        DateTime @default(now())
}

model ChapterSandbox {
  id             String   @id @default(cuid())
  runId           String
  chapterIndex    Int
  title           String
  mainLocation    String
  chapterGoal     String
  currentQuestion String
  sandboxJson     Json
  status          String   @default("active")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([runId, chapterIndex])
}

model SceneNode {
  id              String   @id @default(cuid())
  runId            String
  chapterIndex     Int
  nodeIndex        Int
  title            String
  publicNarration  String
  nodeGoal         String
  status           String   @default("open_for_actions")
  actionOptionsJson Json
  resolutionId     String?
  openedAt         DateTime @default(now())
  resolvedAt       DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([runId, chapterIndex, nodeIndex])
}

model PlayerAction {
  id             String   @id @default(cuid())
  runId           String
  nodeId          String
  chapterIndex    Int
  userId          String?
  roleId          String
  playerType      String   @default("human")
  actionType      String
  targetType      String?
  targetId        String?
  targetText      String?
  method          String
  intent          String
  riskLevel       String   @default("normal")
  freeText        String?
  normalizedJson  Json?
  guardStatus     String   @default("pending")
  guardReason     String?
  auditStatus     String   @default("pending")
  status          String   @default("draft")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([nodeId, roleId])
}

model DirectorResolution {
  id                  String   @id @default(cuid())
  runId                String
  nodeId               String   @unique
  chapterIndex         Int
  summary              String
  publicNarration      String
  privateResultsJson   Json
  actionResultsJson    Json
  statePatchJson       Json
  clueChangesJson      Json
  relationChangesJson  Json
  dangerBefore         Int
  dangerAfter          Int
  nextNodeHook         String?
  nextOptionsJson      Json?

  // v3.1 轻量命运线共演输出
  echoesJson           Json?    // 个人回响 / 他人回响 / 世界回响
  crossImpactsJson     Json?    // 跨角色影响
  delayedEffectsJson   Json?    // 延迟后果
  personalProgressJson Json?    // 每个角色个人线推进

  auditStatus          String   @default("pending")
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
}

model NarrativeSegment {
  id             String   @id @default(cuid())
  runId           String
  nodeId          String
  resolutionId    String
  chapterIndex    Int
  content         String
  contributorJson Json
  auditStatus     String   @default("pending")
  createdAt       DateTime @default(now())
}

model Clue {
  id              String   @id @default(cuid())
  runId            String
  clueKey          String
  title            String
  description      String
  visibility       String   @default("public") // public | role_private | shared | rumor | hidden
  ownerRoleId      String?
  discoveredNodeId String?
  status           String   @default("active")
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([runId, clueKey])
}

model WorldStateSnapshot {
  id          String   @id @default(cuid())
  runId       String
  nodeId      String?
  chapterIndex Int
  stateJson   Json
  factsJson   Json
  createdAt   DateTime @default(now())
}

model Chapter {
  id              String   @id @default(cuid())
  runId            String
  chapterIndex     Int
  title            String
  content          String
  highlightsJson   Json
  keyChoicesJson   Json
  contributorJson  Json

  // v3.1 多 POV 群像章节
  summary          String?
  povSectionsJson  Json?    // 每个角色视角章节段落
  convergenceJson  Json?    // 群像交汇段
  personalCardsJson Json?   // 每个角色个人故事卡

  nextHook         String?
  auditStatus      String   @default("pending")
  status           String   @default("generated")
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([runId, chapterIndex])
}

model Notification {
  id          String   @id @default(cuid())
  userId      String
  runId       String?
  nodeId      String?
  chapterId   String?
  type        String
  title       String
  content     String
  isRead      Boolean  @default(false)
  createdAt   DateTime @default(now())
}

model AiTask {
  id             String   @id @default(cuid())
  runId           String?
  nodeId          String?
  actionId        String?
  chapterId       String?
  taskType        String
  modelType       String
  promptVersion   String?
  status          String   @default("pending")
  inputJson       Json?
  resultJson      Json?
  inputTokens     Int?
  outputTokens    Int?
  cost            Float?
  errorMessage    String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model AuditLog {
  id          String   @id @default(cuid())
  targetType  String
  targetId    String?
  content     String
  result      String
  riskType    String?
  provider    String   @default("mock")
  createdAt   DateTime @default(now())
}

model EventLog {
  id           String   @id @default(cuid())
  userId       String?
  runId        String?
  nodeId       String?
  actionId     String?
  eventName    String
  source       String?
  shareToken   String?
  payload      Json?
  createdAt    DateTime @default(now())
}

model ShareToken {
  id            String   @id @default(cuid())
  token         String   @unique
  runId         String
  chapterId     String?
  shareUserId   String
  scene         String
  channel       String
  createdAt     DateTime @default(now())
}
```

---

## 14. API 设计

### 14.1 Auth

```http
POST /api/auth/wechat-login
GET  /api/user/me
POST /api/user/agree-policy
```

### 14.2 WorldTemplate

```http
GET  /api/world-templates
GET  /api/world-templates/:templateId
```

### 14.3 StoryRun

```http
POST /api/story-runs
GET  /api/story-runs/:runId
GET  /api/story-runs/:runId/state
GET  /api/my/story-runs
POST /api/story-runs/:runId/join
POST /api/story-runs/:runId/start
POST /api/story-runs/:runId/pause
```

创建 StoryRun 请求：

```json
{
  "templateId": "template_midnight_store_001",
  "mode": "invite",
  "maxPlayers": 5,
  "aiPlayerCount": 2,
  "tone": "悬疑",
  "ownerAsPlayer": true
}
```

### 14.4 Role

```http
GET  /api/story-runs/:runId/roles
POST /api/story-runs/:runId/roles/:roleId/claim
GET  /api/story-runs/:runId/my-role
```


v3.1 补充：

```http
GET  /api/story-runs/:runId/my-arc
GET  /api/story-runs/:runId/roles/:roleId/arc
GET  /api/story-runs/:runId/roles/:roleId/private-clues
```

说明：

1. `my-arc` 返回当前用户角色的命运问题、专属开场、私密线索和个人线进度。
2. `private-clues` 只返回当前角色有权限看到的私密信息。
3. AI 托管角色的隐藏信息不对 human player 直接公开。

### 14.5 SceneNode

```http
GET  /api/story-runs/:runId/current-node
GET  /api/story-runs/:runId/nodes
GET  /api/nodes/:nodeId
POST /api/nodes/:nodeId/resolve
POST /api/nodes/:nodeId/ai-fill-missing-actions
```

### 14.6 PlayerAction

```http
POST /api/nodes/:nodeId/actions
GET  /api/nodes/:nodeId/actions
POST /api/actions/:actionId/cancel
POST /api/actions/:actionId/rewrite
```

提交行动响应：

```json
{
  "actionId": "act_xxx",
  "status": "accepted",
  "guardStatus": "ok",
  "message": "行动已提交，等待本节点结算。"
}
```

### 14.7 Resolution / Chapter

```http
GET  /api/nodes/:nodeId/resolution
GET  /api/story-runs/:runId/narrative-segments
POST /api/story-runs/:runId/generate-chapter
GET  /api/chapters/:chapterId
POST /api/chapters/:chapterId/share
```


v3.1 补充：

```http
GET  /api/nodes/:nodeId/echoes
GET  /api/nodes/:nodeId/cross-impacts
GET  /api/story-runs/:runId/my-impacts
GET  /api/chapters/:chapterId/pov-sections
GET  /api/chapters/:chapterId/personal-cards
```

说明：

1. `echoes` 用于节点结算页展示三个回响。
2. `cross-impacts` 用于展示本节点谁影响了谁。
3. `my-impacts` 用于故事房间展示“我的影响”。
4. `pov-sections` 用于章节结果页按角色视角展示。
5. `personal-cards` 用于生成和查看个人故事卡。

### 14.8 Notification / Event

```http
GET  /api/notifications
POST /api/notifications/:notificationId/read
POST /api/events
```

### 14.9 Admin

```http
GET  /api/admin/story-runs
GET  /api/admin/story-runs/:runId
POST /api/admin/story-runs/:runId/pause
POST /api/admin/story-runs/:runId/block
GET  /api/admin/world-templates
POST /api/admin/world-templates
PUT  /api/admin/world-templates/:templateId
GET  /api/admin/actions
GET  /api/admin/ai-tasks
GET  /api/admin/audit-logs
GET  /api/admin/events
```

---

## 15. 后端服务实现方式

### 15.1 推荐目录

```txt
apps/api/src/
  modules/
    auth/
    users/
    world-templates/
    story-runs/
    roles/
    scene-nodes/
    actions/
    director/
    chapters/
    notifications/
    audit/
    ai/
    events/
    admin/
  common/
    guards/
    decorators/
    errors/
    utils/
  adapters/
    ai/
      ai-provider.interface.ts
      mock-ai-provider.ts
      real-ai-provider.ts
    audit/
      audit-provider.interface.ts
      mock-audit-provider.ts
      wechat-audit-provider.ts
    wechat/
      wechat-auth-provider.ts
```

### 15.2 StoryRunService.createRun

流程：

```txt
1. 校验用户。
2. 读取 WorldTemplate。
3. 创建 StoryRun，status=waiting_players。
4. 根据 template.configJson 创建 StoryRole。
5. 创建 ChapterSandbox 第 1 章。
6. 创建 SceneNode 第 1 节点。
7. 如果 single mode，创建 AI 托管角色。
8. 写入 WorldStateSnapshot 初始状态。
9. 记录 event: story_run_created。
10. 返回 runId。
```

### 15.3 RoleService.claimRole

规则：

1. 每个用户在一个 run 中只能 claim 一个 human role。
2. 已被其他 human claim 的角色不可再选。
3. AI 角色 P0 不允许被接管。
4. claim 后创建 StoryPlayer。
5. 如果达到最小开始条件，StoryRun 可进入 role_selecting/playing。

### 15.4 ActionService.submitAction

流程：

```txt
1. 校验 StoryRun 状态必须 playing。
2. 校验 SceneNode 状态必须 open_for_actions。
3. 校验用户属于 run。
4. 校验用户 roleId 是否匹配。
5. 校验本节点该 role 尚未提交行动。
6. 内容安全审核用户 freeText/method/intent。
7. 调用 ActionGuard 检查世界规则、角色权限、剧情阶段。
8. 如果 blocked，返回禁止原因。
9. 如果 rewrite_needed，返回建议改写。
10. 写入 PlayerAction，status=accepted。
11. 检查节点是否 ready_to_resolve。
12. 记录 event: action_submitted。
```

### 15.5 DirectorService.resolveNode

流程：

```txt
1. 校验 node 未结算。
2. 收集本节点 accepted actions。
3. 对未行动 AI 角色生成 minor action。
4. 加载 WorldStateSnapshot 最新版本。
5. 加载当前 ChapterSandbox。
6. 加载角色、关系、线索。
7. 创建 AiTask: director_resolve_node。
8. 调用 AIProvider.resolveNode。
9. 校验 AI 输出 JSON schema。
10. 审核 publicNarration 和 privateResults。
11. 写入 DirectorResolution。
12. 根据 statePatch 更新 StoryRun.stateJson、dangerLevel、Clue、RoleRelation。
13. 创建 NarrativeSegment。
14. 创建下一 SceneNode，或触发章节生成。
15. 写 WorldStateSnapshot。
16. 记录 event: node_resolved。
17. 给玩家创建通知。
```

### 15.6 ChapterService.generateChapter

触发条件：

1. 当前章达到 configured nodeCount，例如 5 个 resolved nodes。
2. 房主手动收束章节。
3. 后台运营收束。

流程：

```txt
1. 收集本章所有 SceneNode、PlayerAction、DirectorResolution、NarrativeSegment。
2. 创建 AiTask: chapter_generate。
3. 调用 AIProvider.generateChapter。
4. 审核章节正文。
5. 写入 Chapter。
6. 更新 StoryRun.status=chapter_completed。
7. 创建下一章预告。
8. 给参与玩家发通知。
9. 记录 event: chapter_completed。
```

---

## 16. AI Provider 接口

```ts
export interface AiProvider {
  generateRunSeed(input: GenerateRunSeedInput): Promise<GenerateRunSeedOutput>;
  guardAction(input: GuardActionInput): Promise<ActionGuardResult>;
  resolveNode(input: ResolveNodeInput): Promise<ResolveNodeOutput>;
  generateChapter(input: GenerateChapterInput): Promise<GenerateChapterOutput>;
  generateShareCopy(input: GenerateShareCopyInput): Promise<GenerateShareCopyOutput>;
}
```

### 16.1 ResolveNodeInput

```ts
export type ResolveNodeInput = {
  template: WorldTemplateConfig;
  run: {
    id: string;
    title: string;
    currentChapter: number;
    dangerLevel: number;
    stateJson: Record<string, unknown>;
  };
  sandbox: ChapterSandboxDto;
  node: SceneNodeDto;
  roles: StoryRoleDto[];
  relations: RoleRelationDto[];
  clues: ClueDto[];
  actions: PlayerActionDto[];
  facts: string[];
  forbiddenRules: string[];
};
```

### 16.2 ResolveNodeOutput

AI 必须返回严格 JSON：

```ts
export type ResolveNodeOutput = {
  summary: string;
  publicNarration: string;
  actionResults: Array<{
    actionId: string;
    roleId: string;
    resultType: 'success' | 'fail' | 'partial_success' | 'success_with_cost' | 'risk_triggered';
    publicResult: string;
    privateResult?: string;
    gainedClues?: string[];
    exposedFacts?: string[];
  }>;
  clueChanges: Array<{
    operation: 'create' | 'reveal' | 'update';
    clueKey: string;
    title: string;
    description: string;
    visibility: 'public' | 'role_private' | 'shared' | 'rumor' | 'hidden';
    ownerRoleId?: string;
    visibleToRoleIds?: string[];
  }>;
  relationChanges: Array<{
    fromRoleId: string;
    toRoleId: string;
    relationType: 'trust' | 'suspicion' | 'debt' | 'protect' | 'conflict' | 'secret';
    delta: number;
    publicNote: string;
    hiddenNote?: string;
  }>;
  // v3.1：三个回响
  echoes: Array<{
    roleId: string;
    personalEcho: string;
    otherEcho?: string;
    worldEcho: string;
    visibleToRoleIds: string[];
  }>;
  // v3.1：跨角色影响
  crossImpacts: Array<{
    sourceRoleId: string;
    targetRoleId?: string;
    impactType: 'clue_change' | 'relation_shift' | 'risk' | 'opportunity' | 'delayed_effect';
    visibility: 'public' | 'source_private' | 'target_private' | 'hidden';
    title: string;
    description: string;
    delayedUntilNode?: number;
  }>;
  personalProgress: Array<{
    roleId: string;
    arcStage: 'setup' | 'rising' | 'conflict' | 'choice' | 'consequence';
    progressText: string;
    unresolvedQuestion?: string;
  }>;
  dangerDelta: number;
  statePatch: Record<string, unknown>;
  newFacts: string[];
  delayedEffects?: Array<{
    effectKey: string;
    sourceRoleId: string;
    triggerNodeIndex?: number;
    description: string;
  }>;
  nextNode?: {
    title: string;
    publicNarration: string;
    nodeGoal: string;
    actionOptions: Array<{
      actionType: string;
      label: string;
      targetText?: string;
      riskLevel?: 'safe' | 'normal' | 'risky';
    }>;
  };
  chapterShouldEnd: boolean;
  chapterEndReason?: string;
};
```

---

## 17. Prompt 模板

### 17.1 ActionGuard Prompt

```txt
你是 AI 多人故事局的行动裁判。

你的任务：判断玩家提交的行动是否允许进入故事结算。

必须遵守：
1. 玩家只能控制自己的角色。
2. 玩家只能声明意图，不能宣布结果。
3. 玩家不能直接揭开全部真相。
4. 玩家不能违反世界规则。
5. 玩家不能操控其他玩家角色做决定。
6. 玩家不能跳过当前剧情阶段。
7. 玩家不能新增破坏世界观的大设定。

输入包含：世界规则、当前节点、角色卡、已知事实、玩家行动。

输出严格 JSON：
{
  "allowed": boolean,
  "severity": "ok" | "soft_warn" | "rewrite_needed" | "blocked",
  "reason": "简短原因",
  "normalizedAction": {
    "actionType": "...",
    "targetText": "...",
    "method": "...",
    "intent": "...",
    "riskLevel": "safe|normal|risky"
  },
  "suggestions": ["可替代行动1", "可替代行动2"]
}
```

### 17.2 Director Resolve Prompt

```txt
你是 AI 多人故事局的导演和裁判。

你要根据当前剧情节点、玩家行动、世界规则、角色秘密、已知线索，结算本节点。

目标：
1. 保留每个玩家行动的核心意图。
2. 判断行动结果：成功、失败、部分成功、成功但付出代价、触发风险。
3. 更新线索、关系、危险等级和世界状态。
4. 生成 200-500 字公共叙事。
5. 不替玩家做重大决定。
6. 不剧透未公开秘密。
7. 不跳到大结局。
8. 必须留下下一节点可行动钩子。

输出必须是合法 JSON，字段必须符合 ResolveNodeOutput schema。
```


v3.1 群像交织补充规则：

```txt
你是 AI 多人故事局的群像导演。

每次结算必须额外做到：
1. 推进每个活跃玩家的个人线。
2. 至少产生 1 个跨角色影响。
3. 输出每个玩家的三个回响：个人回响、他人回响、世界回响。
4. 不要让某个玩家长期沦为配角。
5. 不要强行将所有玩家拉到同一地点。
6. 所有交织必须来自角色目标、隐藏秘密、线索、地点或世界规则。
7. 可以制造延迟后果，让本轮行动在后续节点产生影响。
8. 必须保留信息权限，不能把私密信息直接公开给所有玩家。
9. 如果某个玩家本轮行动较弱，也要给他至少一个个人线反馈。
10. 如果某个玩家连续 2 个节点没有有效影响，需要通过导演事件给他一个重新进入主线的机会。
```

### 17.3 Chapter Generate Prompt

```txt
你是章节编辑。

你要把本章 3-5 个剧情节点的公共叙事、玩家行动、行动结果、线索变化、关系变化整理成一章小说。

要求：
1. 第三人称。
2. 统一文风。
3. 保留主要玩家行动。
4. 保留本章关键选择和高光。
5. 不新增破坏后续剧情的大设定。
6. 不剧透未公开秘密。
7. 字数 800-1500 字。
8. 结尾必须有下一章悬念。

输出 JSON：
{
  "title": "章节标题",
  "content": "章节正文",
  "highlights": [
    {"roleId":"...", "text":"..."}
  ],
  "keyChoices": ["..."],
  "nextHook": "下一章预告"
}
```


v3.1 多 POV 章节输出 JSON：

```ts
export type GenerateChapterOutput = {
  title: string;
  summary: string;
  povSections: Array<{
    roleId: string;
    title: string;
    content: string;
    keyActionText: string;
  }>;
  convergenceSection: {
    title: string;
    content: string;
  };
  personalCards: Array<{
    roleId: string;
    roleName: string;
    keyChoice: string;
    influencedWho: string;
    protagonistType: string;
    unresolvedQuestion: string;
    nextPersonalHook?: string;
  }>;
  highlights: Array<{
    roleId: string;
    text: string;
  }>;
  keyChoices: string[];
  nextHook: string;
};
```

章节展示结构必须优先使用 POV：

```txt
《午夜便利店：第一夜》
第一节：夜班店员
第二节：外卖骑手
第三节：实习记者
第四节：雨夜交叉
尾声：未送达的订单
```

---

## 18. 世界模板 JSON 结构

```json
{
  "id": "template_midnight_store_001",
  "name": "午夜便利店",
  "genre": "都市怪谈 / 悬疑 / 生存",
  "hook": "凌晨 2:17，一个没有影子的客人走进了便利店。",
  "worldBase": "这是一家开在旧城区的 24 小时便利店。夜班时，店内会出现无法解释的异常，但所有异常都遵守某种规则。",
  "worldRules": [
    "异常必须通过线索逐步揭示",
    "不能一步揭开全部真相",
    "不能把故事突然变成超能力大战",
    "不能出现过度血腥描写"
  ],
  "convergenceRules": [
    "每个角色从不同入口接触同一个世界冲突",
    "每轮至少让一个角色行动影响另一个角色的信息环境",
    "不要强制所有角色同时在同一地点",
    "到第 3 个节点时至少产生一次命运线交叉",
    "到第 5 个节点时形成阶段性收束"
  ],
  "chapterRule": {
    "nodesPerChapter": 5,
    "maxChapters": 3,
    "chapterWordCount": [800, 1500]
  },
  "actionTypes": [
    "explore",
    "investigate",
    "ask",
    "hide",
    "share",
    "cooperate",
    "protect",
    "confront",
    "risk",
    "use_item",
    "custom"
  ],
  "roleSeeds": [
    {
      "roleKey": "night_clerk",
      "roleName": "林鹿",
      "identity": "午夜便利店夜班店员",
      "publicInfo": "你今晚第一次独自值夜班。",
      "personalHook": "你在收银机里发现一枚不属于今晚账目的旧硬币。",
      "destinyQuestion": "你到底是被困者，还是下一任守夜人？",
      "privateClues": ["你梦里听过一句话：不要让外卖员进来。"],
      "hiddenSecret": "你三年前来过这家便利店，但你完全不记得原因。",
      "personalGoal": "弄清黑衣人为什么认识你。",
      "abilityText": "你对店内细节异常敏感。",
      "cannotDo": [
        "不能直接想起三年前全部真相",
        "不能直接命令其他角色离开"
      ],
      "newbieRecommended": true
    },
    {
      "roleKey": "delivery_rider",
      "roleName": "陈舟",
      "identity": "深夜外卖员",
      "publicInfo": "你只是来取一单无人认领的外卖。",
      "hiddenSecret": "你曾在这家便利店兼职，并认识前店长。",
      "personalGoal": "不要让别人知道你和前店长的关系。",
      "abilityText": "你熟悉便利店后门和仓库布局。",
      "cannotDo": [
        "不能一开始公开全部往事",
        "不能操控林鹿的记忆"
      ]
    },
    {
      "roleKey": "investigator_customer",
      "roleName": "顾言",
      "identity": "看似普通的顾客",
      "publicInfo": "你说自己只是进来买水。",
      "hiddenSecret": "你正在调查三年前的失踪案。",
      "personalGoal": "找到旧员工证。",
      "abilityText": "你擅长从细节中发现矛盾。",
      "cannotDo": [
        "不能直接证明案件真相",
        "不能越权审判其他角色"
      ]
    }
  ],
  "chapterSandboxes": [
    {
      "chapterIndex": 1,
      "title": "没有影子的客人",
      "mainLocation": "午夜便利店",
      "chapterGoal": "确认黑衣人是否真实存在。",
      "currentQuestion": "为什么监控里没有黑衣人的影子？",
      "locations": ["收银台", "监控屏幕", "第三排货架", "仓库门", "门外雨棚"],
      "initialClues": [
        {
          "clueKey": "camera_missing_shadow",
          "title": "监控缺失的人影",
          "description": "现实中黑衣人站在店内，但监控画面里没有他。"
        }
      ],
      "openingNode": {
        "title": "自动门打开",
        "publicNarration": "凌晨 2:17，便利店自动门无声滑开。一个穿黑色雨衣的人走进来，站在第三排货架前。监控屏幕里，那里却空无一人。",
        "nodeGoal": "决定如何确认黑衣人是否真实存在。",
        "actionOptions": [
          {"actionType":"investigate", "label":"查看监控回放", "targetText":"监控屏幕", "riskLevel":"normal"},
          {"actionType":"ask", "label":"上前询问黑衣人", "targetText":"黑衣人", "riskLevel":"risky"},
          {"actionType":"explore", "label":"检查门口雨水", "targetText":"门外雨棚", "riskLevel":"safe"},
          {"actionType":"cooperate", "label":"和另一名玩家交换观察", "riskLevel":"normal"}
        ]
      }
    }
  ],
  "directorCards": [
    "新线索出现",
    "角色秘密轻微触发",
    "地点状态变化",
    "危险等级上升",
    "误会产生",
    "隐藏物品出现"
  ],
  "styleGuide": {
    "tone": "悬疑、克制、电影感、轻度惊悚",
    "person": "third_person",
    "paragraphLength": "short",
    "forbidden": [
      "不要过度血腥",
      "不要低俗",
      "不要直接揭示全部真相",
      "不要替玩家角色做重大决定"
    ]
  },
  "fallbackTexts": {
    "nodeResolution": "几人的行动让局势出现了新的变化。一个细节被发现，但真正的答案仍然藏在更深处。",
    "chapter": "这一章中，几位角色的选择共同推动了故事走向，也留下了新的谜团。"
  }
}
```

---

## 19. 内容安全与合规

### 19.1 必审内容

用户侧：

1. 用户昵称。
2. 用户行动 freeText、method、intent。
3. 举报反馈。
4. 分享自定义文案。

AI 侧：

1. 角色卡。
2. 公共叙事。
3. 私密反馈。
4. 章节正文。
5. 分享卡文案。
6. 通知文案。

### 19.2 内容边界

允许：

1. 冒险。
2. 悬疑。
3. 轻度惊悚。
4. 角色冲突。
5. 奇幻想象。
6. 成长和选择。

禁止：

1. 过度血腥。
2. 色情低俗。
3. 现实危险行为指导。
4. 人身攻击和威胁。
5. 违法违规内容。
6. 政治敏感内容。
7. 鼓励自伤、自杀、极端行为的内容。
8. 对未成年人不适宜的成人化内容。

### 19.3 审核失败处理

1. 用户输入审核失败：不进入行动结算。
2. AI 输出审核失败：自动重试一次。
3. 重试仍失败：使用 fallback 文本。
4. 章节审核失败：进入 manual_review，不允许分享。

---

## 20. 事件埋点与指标

### 20.1 核心指标

| 指标 | 内测及格线 | 产品有戏线 |
|---|---:|---:|
| 首页开局点击率 | ≥20% | ≥35% |
| 创建故事局完成率 | ≥40% | ≥60% |
| 角色选择完成率 | ≥50% | ≥75% |
| 第一次行动提交率 | ≥40% | ≥65% |
| 行动通过率 | ≥70% | ≥85% |
| 节点结算查看率 | ≥60% | ≥80% |
| 第一章完成率 | ≥25% | ≥50% |
| 继续下一章率 | ≥10% | ≥25% |
| 分享率 | ≥10% | ≥25% |
| 邀请打开率 | ≥20% | ≥35% |
| 次日回访率 | ≥10% | ≥25% |

### 20.2 事件名称

```txt
app_open
login_success
home_create_run_click
home_single_trial_click
world_template_view
world_template_select
story_run_created
share_token_created
story_run_joined
role_list_view
role_claimed
role_card_view
story_room_view
current_node_view
action_form_open
action_submitted
action_guard_failed
action_guard_passed
node_ready_to_resolve
node_resolve_started
node_resolved
resolution_view
clue_view
relation_change_view
echo_view
cross_impact_view
personal_arc_view
personal_card_view
chapter_generate_started
chapter_completed
chapter_view
next_chapter_click
share_click
share_open
notification_opened
report_submitted
```

### 20.3 正式数据口径

只统计：

1. 非后台测试用户。
2. 审核通过内容。
3. status=resolved 的节点。
4. status=generated/published 的章节。

不统计：

1. 草稿行动。
2. 审核失败行动。
3. AI 失败且未 fallback 的任务。
4. 后台测试故事局。

---

## 21. 技术栈

### 21.1 Monorepo

```txt
ai-story-run/
  apps/
    miniprogram/          # Taro + React + TypeScript 微信小程序
    admin/                # Next.js + React + TypeScript 后台
    api/                  # NestJS + TypeScript 后端
  packages/
    shared/               # 类型、枚举、zod schema
    prompts/              # prompt 模板
    templates/            # 世界模板 JSON
    ui/                   # 可选：共享 UI
  prisma/
    schema.prisma
    seed.ts
  docs/
    PRD_v3.md
    API.md
    DB.md
    TEST_CASES.md
    PROMPTS.md
  docker-compose.yml
  pnpm-workspace.yaml
  package.json
  .env.example
```

### 21.2 后端

1. Node.js + TypeScript。
2. NestJS。
3. PostgreSQL。
4. Prisma ORM。
5. Redis。
6. BullMQ。
7. Zod 校验 AI JSON 输出。
8. JWT/session token。

### 21.3 小程序

1. Taro + React + TypeScript。
2. Zustand。
3. Tailwind / UnoCSS。
4. 请求封装。
5. 小程序分享能力。

### 21.4 后台

1. Next.js。
2. React。
3. TypeScript。
4. Ant Design。
5. 简单数据看板。

### 21.5 第三方 Adapter

1. WeChatAuthProvider：mock + real。
2. AuditProvider：mock + realWeChatAudit。
3. AiProvider：mock + real。
4. SharePosterProvider：mock + real。

---

## 22. AI 成本控制策略

P0 必须控制输出长度。

### 22.1 输出长度

1. 节点公共叙事：200-500 字。
2. 我的行动结果：50-120 字。
3. 下一节点钩子：50-120 字。
4. 章节正文：800-1500 字。

### 22.2 上下文压缩

每次 resolveNode 只携带：

1. 模板核心设定。
2. 当前章节沙盒。
3. 当前节点。
4. 角色卡。
5. 最新 WorldStateSnapshot。
6. 公开线索。
7. 角色关系摘要。
8. 本节点行动。
9. 最近 2 个 NarrativeSegment。

长期历史通过 `stateJson` 和 `factsJson` 保存，不直接塞全部正文。

### 22.3 模型分工

P0 可全部 mock。

真实接入时建议：

1. ActionGuard：便宜模型。
2. NodeResolve：中等模型。
3. ChapterGenerate：高质量模型。
4. Summary/ShareCopy：便宜模型。

---

## 23. 异常兜底

### 23.1 AI 结算失败

处理：

1. AiTask 标记 failed。
2. 重试 1 次。
3. 仍失败使用模板 fallback。
4. 不阻断故事局。

提示：

```txt
AI 导演刚才卡了一下，系统已为你生成备用剧情推进。
```

### 23.2 JSON 解析失败

1. 尝试修复 JSON。
2. 修复失败重试。
3. 重试失败 fallback。

### 23.3 行动审核失败

提示用户修改：

```txt
这个行动暂时不能进入故事。你可以改成“尝试调查/询问/观察”，不要直接宣布结果。
```

### 23.4 节点卡住

房主可以：

1. 推进剧情。
2. 让 AI 托管未行动角色。
3. 暂停故事局。

### 23.5 章节生成失败

1. 使用 NarrativeSegment 拼接简版章节。
2. 标记 fallback_used。
3. 后台可重新生成。

---

## 24. 测试用例

### 24.1 单元测试

1. 创建 StoryRun。
2. 选择角色。
3. 同一用户不能选择多个角色。
4. 同一节点同一角色不能提交两次行动。
5. ActionGuard 阻止操控别人角色。
6. ActionGuard 阻止宣布结果。
7. 节点结算后创建 DirectorResolution。
8. 结算后更新 Clue。
9. 结算后更新 RoleRelation。
10. 达到节点数触发章节生成。
11. AI 失败 fallback。
12. 审核失败阻止展示。
13. 每个角色生成 personalHook 和 destinyQuestion。
14. DirectorResolution 必须返回 echoes。
15. DirectorResolution 必须返回至少 1 个 crossImpact。
16. ChapterGenerate 必须返回 povSections。
17. ChapterGenerate 必须返回 personalCards。
18. 私密线索不能展示给无权限角色。
19. delayed_effect 能在后续节点触发。

### 24.2 E2E 测试

#### 用例 1：单人试玩

```txt
用户登录
→ 选择午夜便利店
→ 创建单人故事局
→ 选择林鹿
→ 提交查看监控行动
→ AI 结算
→ 查看结果
→ 继续 5 个节点
→ 生成第 1 章
```

#### 用例 2：多人邀请局

```txt
房主创建故事局
→ 分享链接
→ 用户 B 加入
→ 用户 A 选择林鹿
→ 用户 B 选择顾言
→ 两人提交行动
→ 房主推进剧情
→ AI 结算
→ 章节生成
```

#### 用例 3：乱写拦截

用户输入：

```txt
我直接发现全部真相，并让陈舟承认他是幕后黑手。
```

预期：

1. ActionGuard 返回 rewrite_needed。
2. 提示不能操控其他角色，不能直接宣布结果。
3. 给出替代建议。

---

## 25. 开发 Sprint 拆分

### Sprint 1：工程骨架与基础数据

目标：项目能启动，有模板、有故事局基础。

任务：

1. 初始化 monorepo。
2. 配置 NestJS API。
3. 配置 Prisma + PostgreSQL。
4. 配置 Redis + BullMQ。
5. 配置 Taro 小程序。
6. 配置 Next.js admin。
7. 实现 shared enums/types。
8. 实现 WorldTemplate schema 和 seed。
9. 实现 User、StoryRun、StoryRole、StoryPlayer。
10. 实现 mock 微信登录。
11. 实现世界模板列表 API。
12. 实现创建 StoryRun API。
13. 实现首页基础 UI。

验收：

1. 本地能启动 api/miniprogram/admin。
2. seed 后有 3 个世界模板。
3. 小程序能看到模板并创建 StoryRun。

### Sprint 2：角色与故事局房间

目标：用户能选角色并进入房间。

任务：

1. 实现 StoryRole 生成/读取。
2. 实现角色选择页。
3. 实现角色卡页。
4. 实现 ChapterSandbox。
5. 实现 SceneNode。
6. 实现故事局房间页。
7. 实现当前剧情、目标、行动选项展示。
8. 实现 StoryRun 状态切换。

验收：

1. 用户能创建故事局。
2. 用户能选择角色。
3. 用户能进入当前节点页面。

### Sprint 3：行动提交与防乱写

目标：用户能提交行动，系统能审核和拦截乱写。

任务：

1. 实现 PlayerAction。
2. 实现行动提交表单。
3. 实现 AuditProvider mock。
4. 实现 ActionGuard mock。
5. 实现 ActionGuard 规则型检查。
6. 实现同一节点同一角色只能行动一次。
7. 实现行动状态展示。
8. 实现节点 ready_to_resolve 判断。

验收：

1. 正常行动可提交。
2. 乱写行动被拦截。
3. 已行动玩家状态正确展示。

### Sprint 4：AI 导演结算

目标：节点可以被 AI 结算，剧情可以推进。

任务：

1. 实现 AiTask。
2. 实现 AiProvider mock。
3. 实现 DirectorService.resolveNode。
4. 实现 DirectorResolution。
5. 实现 NarrativeSegment。
6. 实现 Clue 更新。
7. 实现 RoleRelation 更新。
8. 实现 WorldStateSnapshot。
9. 实现下一 SceneNode 创建。
10. 实现结算页。
11. 实现三个回响 echoesJson。
12. 实现跨角色影响 crossImpactsJson。
13. 实现个人线推进 personalProgressJson。
14. 实现 delayedEffectsJson 基础存储与触发。

验收：

1. 提交行动后能推进节点。
2. 结算后能看到行动结果。
3. 线索、关系、危险等级发生变化。
4. 下一节点能继续玩。

### Sprint 5：章节生成与分享

目标：5 个节点生成一章小说。

任务：

1. 实现 ChapterGenerate。
2. 实现章节正文生成 mock。
3. 实现章节结果页。
4. 实现角色高光。
5. 实现关键选择。
6. 实现多 POV 章节 povSections。
7. 实现个人故事卡 personalCards。
8. 实现下一章预告。
7. 实现分享 token。
8. 实现分享卡基础版。
9. 实现我的故事局/我的章节。

验收：

1. 一个故事局能完整跑完 1 章。
2. 能生成章节正文。
3. 能分享章节。

### Sprint 6：后台、日志与验收

目标：可内测和排查问题。

任务：

1. 后台登录 mock。
2. 故事局列表。
3. 故事局详情。
4. 行动列表。
5. 节点结算日志。
6. AI 任务日志。
7. 审核日志。
8. 事件日志。
9. Dashboard 指标。
10. E2E 测试。

验收：

1. 后台能查看完整故事局链路。
2. 能排查 AI 失败和审核失败。
3. 核心埋点完整。

---

## 26. Codex 启动指令

把下面这段直接发给 Codex：

```txt
请根据 docs/PRD_v3.md 开发「AI 多人故事局」MVP。

产品不是普通 AI 小说生成器，不是多人写作平台，不是传统剧本杀，也不是完整开放世界 RPG。

产品核心是：用户扮演角色提交行动，AI 导演结算后果，更新世界状态，并把过程生成小说章节。

优先完成 P0-A 最小闭环：
1. 初始化 monorepo：apps/miniprogram、apps/admin、apps/api、packages/shared、packages/prompts、packages/templates。
2. 使用 TypeScript 严格模式。
3. 后端使用 NestJS + PostgreSQL + Prisma + Redis + BullMQ。
4. 小程序使用 Taro + React + TypeScript。
5. 后台使用 Next.js + React + TypeScript。
6. 创建 Prisma schema，包含 User、WorldTemplate、StoryRun、StoryPlayer、StoryRole、RoleRelation、ChapterSandbox、SceneNode、PlayerAction、DirectorResolution、NarrativeSegment、Clue、WorldStateSnapshot、Chapter、Notification、AiTask、AuditLog、EventLog、ShareToken。
7. 创建 3 个世界模板 seed：午夜便利店、青云宗门、穿越荒村。
8. 实现 mock 微信登录。
9. 实现首页、创建故事局、角色选择、角色卡、故事局房间、行动提交、节点结算、章节结果。
10. 实现 ActionGuard：玩家只能提交行动意图，不能宣布结果，不能操控其他角色，不能跳过剧情。
11. 实现 AiProvider mock：resolveNode 和 generateChapter 必须能返回可解析 JSON，并能完整跑通一章。
12. 实现 AuditProvider mock，保留真实微信内容安全接口占位。
13. 实现 1 人试玩和 2-5 人邀请故事局。
14. 每章 5 个 SceneNode，5 个节点后生成一章小说。
15. 完成后告诉我如何本地启动、如何 seed、如何跑测试、如何完整跑通「午夜便利店」第一章。

严格禁止：
- 不要做复杂地图、装备、等级、战斗系统。
- 不要做评论、关注、公开故事池推荐算法。
- 不要做真实付费。
- 不要把用户输入直接当小说正文发布。
- 不要让 AI 替玩家做核心选择。
```

---

## 27. 最终验收标准

MVP 通过必须满足：

1. 用户可登录。
2. 用户可创建故事局。
3. 用户可选择世界模板。
4. 用户可选择角色。
5. 用户可查看角色卡。
6. 用户可看到当前剧情和当前目标。
7. 用户可提交结构化行动。
8. 行动必须经过内容审核。
9. 行动必须经过合法性检查。
10. 用户不能直接宣布结果。
11. 用户不能操控其他角色。
12. 节点可被 AI 导演结算。
13. AI 结算可生成行动结果。
14. AI 结算可更新线索、关系、危险等级。
15. AI 结算可生成下一节点。
16. 5 个节点可生成 1 章小说。
17. 章节包含正文、高光、关键选择、下一章预告。
18. 支持单人试玩。
19. 支持多人邀请局。
20. 未行动玩家不会永久阻塞故事。
21. AI 失败有 fallback。
22. 审核失败不会公开展示。
23. 后台可查看故事局、行动、结算、AI 日志、审核日志。
24. 核心埋点能形成漏斗。
25. 产品体验上用户感知是“玩角色”，不是“写小说”。
26. 每个角色必须有专属开场 personalHook。
27. 每个角色必须有命运问题 destinyQuestion。
28. 节点结算必须展示个人回响、他人回响、世界回响。
29. 节点结算必须展示“我影响了谁 / 谁影响了我”。
30. 至少一个节点内必须出现跨角色影响。
31. 多人局中每个玩家至少有一次个人高光。
32. 章节结果必须按 POV 分段展示。
33. 每个玩家必须有个人故事卡。
34. 私密线索不能被错误公开。
35. 用户能感知“我的行动改变了别人或世界”。

---

## 28. 第一版内测脚本

### 28.1 午夜便利店 1 人试玩脚本

目标：验证单人也能玩起来。

步骤：

1. 用户选择「单人试玩」。
2. 选择「午夜便利店」。
3. 系统分配角色「林鹿」。
4. AI 托管陈舟、顾言。
5. 用户提交行动：查看监控回放。
6. AI 结算：监控缺失一分钟。
7. 进入节点 2：仓库门后传来敲击声。
8. 用户提交行动：检查仓库门缝。
9. AI 结算：门缝下没有影子，但有水迹。
10. 跑完 5 个节点。
11. 生成章节《没有影子的客人》。

观察：

1. 用户是否理解玩法。
2. 用户是否期待下一节点。
3. 章节是否有分享欲。

### 28.2 多人邀请脚本

目标：验证熟人多人互动。

步骤：

1. 房主创建「午夜便利店」。
2. 分享给 2 个朋友。
3. 三人分别选择林鹿、陈舟、顾言。
4. 每人提交一次行动。
5. 房主推进剧情。
6. AI 结算关系变化：顾言怀疑陈舟，林鹿信任顾言。
7. 5 个节点后生成章节。

观察：

1. 玩家是否会讨论策略。
2. 是否出现隐瞒、质疑、协作。
3. 是否有人愿意继续下一章。

---

## 29. v3.1 和原 v2.1 / v3.0 文档兼容说明

原文档中可保留的能力：

1. 微信小程序用户端。
2. 内部 Web 管理后台。
3. 后端 API。
4. AI 任务队列。
5. 内容安全审核。
6. 世界/题材模板。
7. 章节生成。
8. 分享归因。
9. 埋点漏斗。
10. mock adapter 优先。

原文档中需要替换的能力：

1. `StoryProject` 改为 `StoryRun`。
2. `RolePerspective` 改为 `StoryRole`。
3. `SegmentClaim` 删除或后置。
4. `StorySegment` 改为 `PlayerAction + DirectorResolution + NarrativeSegment`。
5. 「接龙编辑」改为「行动提交」。
6. 「AI 改写预览」改为「ActionGuard + AI 导演结算」。
7. 「10 段成章」改为「3-5 个 SceneNode 成章」。
8. 「陌生人公开故事池」从 P0 核心降级到 P1。
9. 「被别人接住提醒」改为「朋友继续故事/我的行动被后续剧情承接」。

最终产品判断标准：

> 用户不是觉得“我投稿了一段小说”，而是觉得“我做了一个选择，故事真的变了”。


---

## 30. v3.1 轻量群像命运线共演详细设计

### 30.1 MVP 为什么不直接做“AI 群像命运线共演平台”

MVP 阶段必须控制用户理解成本和开发复杂度。

“AI 群像命运线共演平台”作为长期愿景很强，但对首批用户过于抽象。用户更容易理解：

```txt
和朋友一起玩出一章小说。
```

因此 P0 的表达应该是“AI 多人故事局”，但体验设计上必须体现群像命运线。

### 30.2 P0-A 最小主角感闭环

P0-A 必须保证每个玩家都经历以下闭环：

```txt
看到自己的专属开场
→ 理解自己的命运问题
→ 掌握一条私密线索
→ 提交一个角色行动
→ 看到个人回响
→ 看到自己影响别人或被别人影响
→ 看到世界状态变化
→ 在最终章节中看到自己的 POV
→ 获得个人故事卡
```

如果用户只看到公共剧情和公共目标，就会感觉自己是配角。

### 30.3 三人局体验标准

以《午夜便利店》为例，3 名玩家不应该只是一起解决“黑衣人没有影子”的谜题。

每个人都应该有自己的入口：

```txt
夜班店员：旧硬币和三年前失忆。
外卖骑手：没有平台记录的订单，收货人是自己。
实习记者：父亲留下的旧新闻和失踪案。
```

三条线表面不同，但底层连接同一个世界冲突：

```txt
午夜便利店每到 2:17 会进行一次交换。
硬币、订单、旧新闻，是交换机制的三个入口。
```

### 30.4 跨角色影响示例

#### 示例 1：店员触碰硬币

店员页面：

```txt
个人回响：你触碰旧硬币后，想起梦里有人说过一句话。
世界回响：便利店外的雨声突然停止。
```

外卖骑手页面：

```txt
他人影响：你的订单备注刷新为“他已经碰了硬币，不要让他收下”。
```

实习记者页面：

```txt
他人影响：旧照片里的收银台后，浮现出一个手握硬币的人影。
```

#### 示例 2：记者公开旧新闻

记者页面：

```txt
个人回响：你把父亲旧稿的一部分公开，终于不再独自背负这条线索。
世界回响：旧城区网络开始出现短暂波动。
```

店员页面：

```txt
他人影响：便利店老板突然打电话警告你，不要相信那个记者。
```

外卖骑手页面：

```txt
他人影响：你的导航路线出现旧报社地址。
```

### 30.5 延迟后果示例

第 1 节点：陈舟隐瞒自己曾在便利店兼职。

系统生成 delayed_effect：

```json
{
  "effectKey": "delivery_rider_hidden_part_time_job",
  "sourceRoleId": "delivery_rider",
  "triggerNodeIndex": 3,
  "description": "如果顾言在第 3 节点调查旧员工记录，会发现陈舟曾在便利店兼职，从而导致怀疑上升。"
}
```

第 3 节点触发：

```txt
顾言翻到旧员工表时，看见了陈舟的名字。
关系变化：顾言 → 陈舟，怀疑 +25。
```

### 30.6 命运网 Lite 展示建议

P0-A 可不做复杂可视化，但故事局房间应至少有“我的影响”和“可疑信息”两个模块。

P0-B 可做命运网 Lite：

```txt
角色线：林鹿 / 陈舟 / 顾言
线索线：旧硬币 / 未记录订单 / 旧新闻
地点线：便利店 / 雨夜街道 / 旧报社
影响线：林鹿触碰硬币 → 陈舟订单备注变化
```

实现方式：不需要图数据库，只用 cards + relations JSON 即可。

### 30.7 个人故事卡字段详细说明

```ts
export type PersonalStoryCard = {
  roleId: string;
  roleName: string;
  protagonistType: string;
  keyChoice: string;
  personalHighlight: string;
  influencedRoles: Array<{
    roleId: string;
    roleName: string;
    impactText: string;
  }>;
  influencedByRoles: Array<{
    roleId: string;
    roleName: string;
    impactText: string;
  }>;
  unresolvedQuestion: string;
  nextPersonalHook: string;
};
```

示例：

```json
{
  "roleId": "delivery_rider",
  "roleName": "陈舟",
  "protagonistType": "行动型主角 / 命运订单携带者",
  "keyChoice": "你没有直接送单，而是先拨通了订单电话。",
  "personalHighlight": "你让林鹿第一次意识到，便利店外也有人知道硬币的存在。",
  "influencedRoles": [
    {"roleId":"night_clerk", "roleName":"林鹿", "impactText":"林鹿开始怀疑便利店异常不只发生在店内。"}
  ],
  "influencedByRoles": [
    {"roleId":"investigator_customer", "roleName":"顾言", "impactText":"顾言公开旧新闻后，你的导航路线发生变化。"}
  ],
  "unresolvedQuestion": "为什么收货人会是你自己？",
  "nextPersonalHook": "下一章，你的订单列表里出现了一个已经去世三年的收货人。"
}
```

---

## 31. v3.1 页面交互详细补充

### 31.1 角色选择页：从“选角色”改为“选命运线”

页面标题建议：

```txt
选择你的命运线
```

角色卡展示：

```txt
陈舟｜深夜外卖员
命运钩子：你接到一份没有平台记录的订单，收货人是你自己。
命运问题：这份订单是让你送货，还是让你替别人留下？
公开目标：完成这单，并弄清订单来源。
隐藏玩法：适合隐瞒、调查、冒险。
```

### 31.2 故事局房间页布局建议

优先布局：

```txt
顶部：当前节点标题 + 危险等级 + 玩家行动状态
主区域：当前公共剧情
我的区域：我的角色 / 我的命运问题 / 我的私密线索
行动区域：推荐行动 + 自定义行动
局势区域：公开线索 / 可疑信息 / 我的影响
底部：提交行动 / 推进剧情
```

### 31.3 节点结算页布局建议

```txt
本节点发生了什么
↓
我的行动结果
↓
三个回响
  - 个人回响
  - 他人回响
  - 世界回响
↓
跨角色影响
  - 我影响了谁
  - 谁影响了我
↓
新线索 / 关系变化 / 危险等级变化
↓
下一节点钩子
```

### 31.4 章节结果页布局建议

```txt
章节标题
章节摘要
↓
多 POV 正文
  第一节：林鹿
  第二节：陈舟
  第三节：顾言
  第四节：雨夜交叉
↓
我的故事卡
↓
角色高光
↓
关键选择
↓
下一章预告
↓
分享 / 继续下一章
```

---

## 32. v3.1 最小实现优先级

如果开发资源有限，按以下顺序实现：

### 必须实现

1. `personalHook`
2. `destinyQuestion`
3. `echoesJson`
4. `crossImpactsJson`
5. `povSectionsJson`
6. `personalCardsJson`

### 可以简化实现

1. 命运网：先不做独立页面，只在房间页显示“我的影响”。
2. 延迟后果：先只存 JSON，不做复杂自动调度。
3. 信息定向分享：P0-A 只做 public / private / hidden。
4. AI 世界种子创建：P0-B 再做。

### 暂不实现

1. 完整开放地图。
2. 长期角色成长。
3. 多势力复杂博弈。
4. 创作者市场。
5. 公开故事池。
6. 付费系统。

---

## 33. v3.1 Codex 最终执行指令

把下面这段直接发给 Codex：

```txt
请根据 docs/AI_multiplayer_story_RPG_MVP_Codex_PRD_v3_1.md 开发「AI 多人故事局」MVP。

本项目对外是 AI 多人故事局，不是普通 AI 小说生成器，不是多人写作平台，不是传统剧本杀，也不是完整开放世界 RPG。

本项目 v3.1 的核心升级是：在 P0-A 中加入轻量“多人命运线共演”机制，让每个玩家感知自己是某条故事线的主角。

优先完成 P0-A 最小闭环：
1. 初始化 monorepo：apps/miniprogram、apps/admin、apps/api、packages/shared、packages/prompts、packages/templates。
2. 使用 TypeScript 严格模式。
3. 后端使用 NestJS + PostgreSQL + Prisma + Redis + BullMQ。
4. 小程序使用 Taro + React + TypeScript。
5. 后台使用 Next.js + React + TypeScript。
6. 创建 Prisma schema，包含 v3.0 基础模型，并新增/扩展 v3.1 字段：
   - StoryRole.personalHook
   - StoryRole.destinyQuestion
   - StoryRole.privateCluesJson
   - StoryRole.impactSummaryJson
   - StoryRole.unresolvedJson
   - StoryRole.arcStage
   - DirectorResolution.echoesJson
   - DirectorResolution.crossImpactsJson
   - DirectorResolution.delayedEffectsJson
   - Chapter.povSectionsJson
   - Chapter.personalCardsJson
   - CrossImpact model
7. 创建 3 个世界模板 seed：午夜便利店、青云宗门、穿越荒村。
8. 每个模板 roleSeeds 必须包含 personalHook、destinyQuestion、privateClues。
9. 实现 mock 微信登录。
10. 实现首页、创建故事局、角色选择、角色卡、故事局房间、行动提交、节点结算、章节结果。
11. 角色选择页必须展示“命运钩子”和“命运问题”。
12. 故事局房间页必须展示“我的命运问题”“我的私密线索”“我的影响”。
13. 实现 ActionGuard：玩家只能提交行动意图，不能宣布结果，不能操控其他角色，不能跳过剧情。
14. 实现 AiProvider mock：resolveNode 和 generateChapter 必须能返回可解析 JSON，并能完整跑通一章。
15. resolveNode 必须输出 echoesJson：个人回响、他人回响、世界回响。
16. resolveNode 必须输出 crossImpactsJson：至少 1 个跨角色影响。
17. generateChapter 必须输出 povSectionsJson：多角色 POV 章节。
18. generateChapter 必须输出 personalCardsJson：每个玩家个人故事卡。
19. 实现 AuditProvider mock，保留真实微信内容安全接口占位。
20. 实现 1 人试玩和 2-5 人邀请故事局。
21. 每章 5 个 SceneNode，5 个节点后生成一章多 POV 小说。
22. 完成后告诉我如何本地启动、如何 seed、如何跑测试、如何完整跑通「午夜便利店」第一章。

严格禁止：
- 不要做复杂地图、装备、等级、战斗系统。
- 不要做评论、关注、公开故事池推荐算法。
- 不要做真实付费。
- 不要把用户输入直接当小说正文发布。
- 不要让 AI 替玩家做核心选择。
- 不要把 MVP 做成完整开放世界。
```

---

## 34. v3.1 最终产品判断标准

MVP 不是只看“能不能生成小说”，而是看用户是否感知到：

```txt
我有自己的角色线。
我做的行动产生了后果。
我的选择影响了别人。
别人也影响了我。
最后这章小说里有我的视角和我的高光。
```

如果用户只感觉自己在读 AI 写的公共剧情，则 v3.1 失败。

如果用户玩完后愿意说：

```txt
我想再来一章，看看我的角色后面会怎么样。
```

则 v3.1 成立。

---

## 35. v3.1 与长期版本边界

### v3.1 做什么

1. AI 多人故事局。
2. 章节沙盒。
3. 角色行动。
4. AI 导演结算。
5. 轻量命运线。
6. 三个回响。
7. 跨角色影响。
8. 多 POV 章节。
9. 个人故事卡。

### v3.1 不做什么

1. 完整开放世界。
2. 大地图探索。
3. 长期角色成长。
4. 多势力政治系统。
5. 世界模板市场。
6. 创作者收益分成。
7. 大规模公开故事池。
8. 复杂社区。

### v4 / 长期方向再做什么

1. 创作者创建世界种子。
2. 世界模板市场。
3. 多章节连续剧。
4. 长期角色成长。
5. 命运网完整可视化。
6. 多势力博弈。
7. AI 群像命运线共演平台。
