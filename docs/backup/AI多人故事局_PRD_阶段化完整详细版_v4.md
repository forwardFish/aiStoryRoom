# AI 多人故事局 PRD — 阶段化完整详细版 v4.0

> 文档目标：在一个文档中同时说明「最终版愿景」「MVP 版开发范围」「MVP 后渐进式版本路线」。  
> 产品总原则：**前台像游戏，后台像 GitHub，结果沉淀为故事世界。**  
> 当前开发策略：MVP 不做完整平台，但从第一版开始预留故事世界、角色线、正史、支线、贡献、合并等长期结构。  
> 对外表达：**和朋友一起玩出一章小说。**  
> 长期表达：**一个故事世界，很多人的主角线，AI 把大家的选择合并成正史。**

---

# 0. 总体判断与阶段边界

## 0.1 为什么要分最终版、MVP 版、渐进版

这个产品如果直接做最终版，会过重：故事世界、角色线、分支、正史、贡献审核、社区、收益分成、IP 孵化全部做完，开发周期会很长，且在没有用户验证前容易做偏。

但如果 MVP 做得太轻，只做「用户提交行动 → AI 写一段剧情」，又很容易变成普通 AI 互动小说，不能体现你真正想要的长期方向。

因此本 PRD 采用三层规划：

1. **最终版**：明确长期形态，防止产品方向走偏。
2. **MVP 版**：只做最小可验证闭环，但必须保留「多人命运线」「三个回响」「多 POV 章节」「个人故事卡」这些核心体验。
3. **渐进版**：MVP 成功后逐步向 GitHub 式故事世界共创平台演进。

## 0.2 产品核心公式

```text
AI 多人故事局 =
故事世界
+ 角色命运线
+ 玩家行动
+ AI 导演结算
+ 三个回响
+ 跨角色影响
+ 多 POV 章节
+ 故事世界沉淀
```

长期版本公式：

```text
AI 故事世界共创平台 =
故事世界 Repo
+ 角色线 / 支线 Branch
+ 玩家行动 / 剧情补充 Commit
+ 请求采纳 Pull Request
+ AI 世界观校验 CI
+ 世界主审核 Review
+ 合并正史 Merge
+ 平行世界 Fork
+ 待补完剧情 Issue
```

用户侧不要直接使用 GitHub 术语，而要翻译成普通用户能理解的话：

| GitHub 概念 | 用户侧表达 |
|---|---|
| Repository | 故事世界 |
| Branch | 角色线 / 支线 / 平行故事 |
| Commit | 一次行动 / 一次剧情补充 |
| Pull Request | 请求加入主线 |
| Merge | 采纳为正史 |
| Fork | 开启平行故事 |
| Issue | 待补完剧情 / 世界谜题 |
| Maintainer | 世界主 / 主创 |
| Contributor | 共创者 |
| CI 检查 | AI 世界观校验 |

---

# 1. 最终版：AI 群像故事世界共创平台

## 1.1 最终版定位

**产品名称建议：** AI 群像故事世界共创平台  
**对外一句话：** 一个故事世界，很多人的主角线，AI 把大家的选择合并成正史。  
**产品形态：** 前台像游戏，后台像 GitHub，最终沉淀成可持续生长的故事世界。

最终版不是单纯的 AI 写小说，也不是传统剧本杀，也不是普通互动小说。它是一个允许多人围绕同一个故事世界长期共创的内容平台。

## 1.2 最终版用户角色

### 1.2.1 普通玩家

普通玩家的目标不是写小说，而是：

- 进入一个故事世界；
- 选择一条角色命运线；
- 提交角色行动；
- 看自己的行动如何影响自己、别人和世界；
- 获得属于自己的 POV 章节和个人故事卡。

### 1.2.2 世界主 / 主创

世界主负责创建和管理故事世界，相当于 GitHub 项目的 Maintainer。

核心权限：

- 创建故事世界；
- 设定世界规则；
- 创建角色池；
- 审核支线贡献；
- 决定哪些内容采纳为正史；
- 管理世界章节、角色线、支线、平行故事。

### 1.2.3 共创者

共创者可以围绕世界进行内容贡献：

- 参与故事局；
- 补充角色支线；
- 提交番外；
- 开启平行故事；
- 申请把自己的剧情采纳进正史。

### 1.2.4 读者 / 围观者

读者不一定参与创作，但可以：

- 阅读正史章节；
- 查看角色线；
- 收藏世界；
- 关注角色；
- 参与投票或评论；
- 申请加入某条角色线。

## 1.3 最终版核心模块

### 1.3.1 故事世界模块 StoryWorld

故事世界是产品的核心资产，相当于一个小说项目仓库。

包含：

- 世界名称；
- 世界一句话钩子；
- 世界类型：悬疑、修仙、都市、科幻、穿越、生存、校园、末日等；
- 世界规则；
- 世界禁忌；
- 主要地点；
- 主要势力；
- 角色池；
- 核心冲突；
- 当前正史章节；
- 角色线；
- 支线；
- 平行故事；
- 未解谜题；
- 世界状态时间线。

### 1.3.2 角色命运线模块 CharacterArc

角色不是简单职业，而是故事世界中的主角线。

每个角色必须包含：

- 公开身份；
- 专属开场；
- 命运问题；
- 个人目标；
- 隐藏秘密；
- 私密线索；
- 与其他角色关系；
- 当前阶段；
- 关键选择记录；
- 影响记录；
- 未解决问题；
- 所属章节和 POV 内容。

示例：

```text
角色：外卖骑手 陈舟
专属开场：你接到一份没有平台记录的订单，收货人是你自己。
命运问题：这份订单是让你送货，还是让你替别人留下？
隐藏秘密：你三年前曾在午夜便利店兼职。
私密线索：你知道便利店后门有一把备用钥匙。
角色阶段：setup → rising → conflict → choice → consequence
```

### 1.3.3 AI 导演模块 DirectorAI

AI 导演不是单纯续写器，而是故事世界的运行引擎。

职责：

1. 理解玩家行动；
2. 判断行动是否合法；
3. 维护世界规则；
4. 更新角色线；
5. 生成三个回响；
6. 产生跨角色影响；
7. 维护公开信息和私密信息边界；
8. 生成下一节点；
9. 将多人行动整理成多 POV 章节；
10. 为世界主提供正史合并建议。

### 1.3.4 正史与分支模块 Canon & Branch

最终版必须支持内容沉淀。

内容状态：

```ts
export type CanonStatus =
  | 'draft'       // 草稿
  | 'candidate'   // 候选正史
  | 'canon'       // 已采纳为正史
  | 'branch'      // 支线/分支
  | 'fork'        // 平行故事
  | 'rejected';   // 未采纳
```

用户体验：

- 你完成了一章，可以提交为候选正史；
- 世界主可以采纳为正史；
- 不被采纳的内容可以成为支线或平行故事；
- 热门支线可以反向影响正史。

### 1.3.5 故事世界主页

最终版必须有世界主页，让故事从“一局”变成“一个世界”。

页面内容：

- 世界简介；
- 正史章节；
- 角色线；
- 支线故事；
- 番外；
- 平行故事；
- 世界规则；
- 主要角色；
- 未解谜题；
- 共创者；
- 热门贡献；
- 继续故事入口。

### 1.3.6 创作者生态

最终版支持：

- 世界主主页；
- 贡献者主页；
- 世界模板市场；
- 高级世界创建工具；
- 付费角色位；
- 私密世界；
- 创作者收益分成；
- 平台抽成；
- 热门世界 IP 孵化。

## 1.4 最终版数据库核心表

```prisma
model StoryWorld {
  id              String   @id @default(cuid())
  ownerUserId      String
  name            String
  slug            String   @unique
  hook            String
  genre           String
  description     String
  worldRulesJson  Json
  locationsJson   Json
  factionsJson    Json
  status          String   @default("active")
  visibility      String   @default("public")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model CharacterArc {
  id                String   @id @default(cuid())
  worldId            String
  roleName           String
  publicIdentity     String
  personalHook       String
  destinyQuestion    String
  personalGoal       String
  hiddenSecret       String?
  privateCluesJson   Json?
  relationJson       Json?
  arcStage           String   @default("setup")
  keyChoicesJson     Json?
  impactSummaryJson  Json?
  unresolvedJson     Json?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}

model StoryBranch {
  id              String   @id @default(cuid())
  worldId          String
  parentBranchId   String?
  branchType       String   // role_line | side_story | fanfic | fork | alternate_ending
  title            String
  description      String?
  canonStatus      String   @default("branch")
  ownerUserId      String
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

model Contribution {
  id              String   @id @default(cuid())
  worldId          String
  branchId         String?
  contributorId    String
  contributionType String   // action | side_story | world_rule | character_note | chapter_draft
  content          String
  status           String   @default("candidate")
  aiReviewJson     Json?
  createdAt        DateTime @default(now())
}

model MergeRequest {
  id              String   @id @default(cuid())
  worldId          String
  branchId         String
  contributionId   String?
  requesterId      String
  status           String   @default("pending") // pending | accepted | rejected | needs_revision
  aiReviewJson     Json?
  ownerNote        String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

## 1.5 最终版商业模式

最终版可以组合以下商业模式：

1. 单次高级故事局：9.9 - 29.9 元；
2. 月度会员：19.9 - 49.9 元；
3. 世界主 Pro：99 - 299 元/月；
4. 私密世界高级权限；
5. AI 合并额度；
6. 高级章节生成；
7. 高级角色位；
8. 世界模板市场抽成；
9. 热门 IP 分成；
10. 创作者收益分成。

---

# 2. MVP 版：当前必须开发的最小可验证版本

## 2.1 MVP 目标

MVP 不做完整开放世界，不做完整社区，不做完整 GitHub 式分支系统。

MVP 只验证一件事：

> 用户是否愿意进入一个故事世界，选择角色，提交行动，看到 AI 导演结算后果，并在最后获得一章属于大家的多 POV 小说。

MVP 必须让用户感受到：

1. 我不是在写小说；
2. 我是在扮演角色；
3. 我的行动有后果；
4. 我的行动会影响别人；
5. 别人的选择也会影响我；
6. 最终小说里有我的 POV 和个人高光。

## 2.2 MVP 范围边界

### MVP 必须做

1. 微信登录 mock；
2. 首页；
3. 故事模板选择；
4. 创建故事局；
5. 角色选择；
6. 角色卡；
7. 故事局房间；
8. 行动提交；
9. ActionGuard 行动合法性检查；
10. AI 导演结算 mock/adapter；
11. 三个回响；
12. 跨角色影响；
13. 世界状态更新；
14. 节点推进；
15. 多 POV 章节生成；
16. 个人故事卡；
17. 分享页；
18. 我的故事局；
19. 后台基础查看；
20. 埋点和测试。

### MVP 不做

1. 完整开放世界；
2. 公开故事社区；
3. 完整世界模板市场；
4. 完整支线提交审核；
5. 创作者收益分成；
6. 复杂地图；
7. 装备、等级、战斗数值；
8. 长期角色成长；
9. IP 孵化；
10. 真实付费。

## 2.3 MVP 用户流程

```text
用户进入小程序
→ 微信登录 mock
→ 首页看到：开一局故事 / 单人试玩 / 加入朋友故事
→ 选择世界模板：午夜便利店 / 青云宗门 / 穿越荒村
→ 创建 StoryRun
→ 系统生成本局章节沙盒、角色卡、第一节点
→ 用户选择角色
→ 进入角色卡页面
→ 查看专属开场、命运问题、个人目标、隐藏秘密
→ 进入故事局房间
→ 查看当前公共剧情、我的命运问题、我的私密线索、公开线索
→ 提交角色行动
→ ActionGuard 检查
→ 等待其他玩家行动或房主推进
→ AI 导演结算
→ 展示个人回响、他人回响、世界回响
→ 展示我影响了谁、谁影响了我
→ 进入下一节点
→ 3-5 个节点后生成章节
→ 展示多 POV 章节、个人故事卡、下一章钩子
→ 用户分享或继续下一章
```

## 2.4 MVP 首页设计

### 页面目标

让用户 30 秒知道：这是可以玩的，不是写作工具。

### 首页核心文案

```text
和朋友一起玩出一章小说
选择角色，做出行动，AI 导演把你们的选择写成故事。
```

### 首页入口

1. 开一局故事；
2. 单人试玩；
3. 加入朋友的故事；
4. 我正在玩的故事。

### 首页模板卡字段

```ts
export type WorldTemplateCard = {
  templateId: string;
  name: string;
  hook: string;
  genreTags: string[];
  recommendedPlayers: string;
  nodeCount: number;
  estimatedTime: string;
  difficulty: '新手推荐' | '标准' | '进阶';
};
```

### 示例

```text
午夜便利店
凌晨 2:17，一个没有影子的客人走进了便利店。
标签：都市怪谈 / 悬疑 / 轻惊悚
推荐人数：1-3 人
预计：5 个节点生成一章
按钮：进入故事
```

## 2.5 MVP 世界模板

MVP 固定 3 个模板。

### 2.5.1 午夜便利店

类型：都市怪谈 / 悬疑 / 轻惊悚

核心钩子：

```text
凌晨 2:17，便利店自动门打开。
一个穿黑色雨衣的人走进来。
但监控画面里，没有他的影子。
```

角色：

1. 夜班店员 林鹿；
2. 外卖骑手 陈舟；
3. 调查顾客 顾言。

### 2.5.2 青云宗门

类型：修仙 / 宗门 / 群像成长

核心钩子：

```text
青云宗三百年未响的禁地钟声，在无人敲击时响起。
只有少数弟子听见钟声里有人叫自己的名字。
```

角色：

1. 外门弟子；
2. 内门天才；
3. 藏书阁杂役；
4. 可扩展为 AI 托管角色。

### 2.5.3 穿越荒村

类型：穿越 / 生存 / 团队选择

核心钩子：

```text
你们醒来时，发现自己站在一座没有出口的荒村。
村口石碑上刻着一句话：天黑前，必须选出一个留下的人。
```

角色：

1. 清醒者；
2. 失忆者；
3. 怀疑者。

## 2.6 MVP 角色选择页

### 页面目标

不要让用户感觉是在选职业，而是让用户感觉是在选择一条命运线。

页面标题：

```text
你想进入哪条命运线？
```

角色卡字段：

```ts
export type RoleCard = {
  roleId: string;
  roleName: string;
  oneLineIdentity: string;
  personalHook: string;
  destinyQuestion: string;
  publicGoal: string;
  playStyleTags: string[];
  difficulty: '新手推荐' | '标准' | '进阶';
};
```

示例：

```text
外卖骑手 陈舟
身份：深夜接单的外卖员
命运钩子：你接到一份没有平台记录的订单，收货人是你自己。
命运问题：这份订单是让你送货，还是让你替别人留下？
公开目标：送完这单，弄清是谁下的订单。
适合：行动型玩家 / 喜欢冒险 / 喜欢隐藏秘密
```

## 2.7 MVP 角色卡页

角色卡页面必须展示：

1. 角色名；
2. 公开身份；
3. 专属开场；
4. 命运问题；
5. 个人目标；
6. 隐藏秘密；
7. 私密线索；
8. 不能做什么；
9. 推荐行动方式。

示例：

```text
你是：林鹿，午夜便利店夜班店员。

专属开场：
你在收银机里发现一枚不属于今晚账目的旧硬币。
你确定它不属于任何一笔交易。
但昨晚梦里，有人把这枚硬币塞进你的手心。

命运问题：
你到底是被困者，还是下一任守夜人？

隐藏秘密：
你三年前来过这家便利店，但你完全不记得原因。

私密线索：
你梦里听过一句话：不要让外卖员进来。
```

## 2.8 MVP 故事局房间页

这是 MVP 最重要的页面。

必须展示 10 个区域：

1. 当前剧情；
2. 当前目标；
3. 我的角色；
4. 我的命运问题；
5. 我的私密线索；
6. 公开线索；
7. 可疑信息；
8. 可行动作；
9. 我的影响；
10. 玩家状态。

### 页面结构示例

```text
当前剧情：
凌晨 2:17，便利店自动门无声滑开。
黑衣人站在第三排货架前，但监控里空无一人。

当前目标：
确认黑衣人是否真实存在。

我的命运问题：
你到底是被困者，还是下一任守夜人？

我的私密线索：
你梦里听过一句话：不要让外卖员进来。

公开线索：
监控中没有黑衣人的影子。

可行动作：
查看监控回放 / 询问黑衣人 / 检查门口雨水 / 自定义行动

玩家状态：
林鹿：已行动
陈舟：未行动
顾言：已行动
```

## 2.9 MVP 行动提交页

用户输入不是小说正文，而是行动意图。

字段：

```ts
export type SubmitActionInput = {
  runId: string;
  nodeId: string;
  roleId: string;
  actionType:
    | 'explore'
    | 'investigate'
    | 'ask'
    | 'hide'
    | 'share'
    | 'cooperate'
    | 'protect'
    | 'confront'
    | 'risk'
    | 'use_item'
    | 'custom';
  targetType?: 'location' | 'object' | 'npc' | 'player_role' | 'self' | 'unknown';
  targetId?: string;
  targetText?: string;
  method: string;
  intent: string;
  riskLevel: 'safe' | 'normal' | 'risky';
  freeText?: string;
  informationPolicy?: {
    keepPrivate?: boolean;
    revealToPublic?: boolean;
    shareToRoleIds?: string[];
  };
};
```

表单提示：

```text
你不用写小说，只要说明你的角色想做什么。

你只能声明“尝试做什么”，不能直接宣布结果。
```

允许：

```text
我尝试靠近仓库门，蹲下观察门缝里有没有影子。
```

禁止：

```text
我发现仓库里就是凶手，然后我把他抓住了。
```

## 2.10 ActionGuard 行动合法性检查

### 检查目标

1. 玩家是否操控了其他角色；
2. 玩家是否直接宣布结果；
3. 玩家是否跳过剧情阶段；
4. 玩家是否违反世界规则；
5. 玩家是否暴露不应公开的秘密；
6. 玩家是否输入敏感内容。

### 输出结构

```ts
export type ActionGuardResult = {
  allowed: boolean;
  severity: 'ok' | 'soft_warn' | 'rewrite_needed' | 'blocked';
  reason?: string;
  normalizedAction?: SubmitActionInput;
  suggestions?: string[];
};
```

### 处理规则

- `ok`：直接进入结算；
- `soft_warn`：允许提交，但提示风险；
- `rewrite_needed`：要求用户修改；
- `blocked`：禁止提交。

## 2.11 AI 导演结算

AI 每轮结算必须输出：

1. 公共剧情叙事；
2. 每个行动结果；
3. 个人回响；
4. 他人回响；
5. 世界回响；
6. 跨角色影响；
7. 新线索；
8. 关系变化；
9. 危险等级变化；
10. 世界状态 patch；
11. 下一节点钩子。

### 输出结构

```ts
export type ResolveNodeOutput = {
  summary: string;
  publicNarration: string;
  actionResults: Array<{
    actionId: string;
    roleId: string;
    resultType:
      | 'success'
      | 'fail'
      | 'partial_success'
      | 'success_with_cost'
      | 'risk_triggered';
    publicResult: string;
    privateResult?: string;
    gainedClues?: string[];
    exposedFacts?: string[];
  }>;
  echoes: Array<{
    roleId: string;
    personalEcho: string;
    otherEcho?: string;
    worldEcho: string;
    visibleToRoleIds: string[];
  }>;
  crossImpacts: Array<{
    sourceRoleId: string;
    targetRoleId?: string;
    impactType:
      | 'clue_change'
      | 'relation_shift'
      | 'risk'
      | 'opportunity'
      | 'delayed_effect';
    visibility: 'public' | 'source_private' | 'target_private' | 'hidden';
    title: string;
    description: string;
    delayedUntilNode?: number;
  }>;
  clueChanges: Array<{
    operation: 'create' | 'reveal' | 'update';
    clueKey: string;
    title: string;
    description: string;
    visibility: 'public' | 'role_private' | 'hidden';
    ownerRoleId?: string;
  }>;
  relationChanges: Array<{
    fromRoleId: string;
    toRoleId: string;
    relationType: 'trust' | 'suspicion' | 'debt' | 'protect' | 'conflict' | 'secret';
    delta: number;
    publicNote: string;
    hiddenNote?: string;
  }>;
  dangerDelta: number;
  statePatch: Record<string, unknown>;
  newFacts: string[];
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

## 2.12 三个回响展示

每个玩家必须看到本轮行动造成的影响。

示例：

```text
个人回响：
你触碰硬币后，想起梦里有人说过一句话。

他人回响：
外卖骑手的订单备注因为你的动作发生变化。

世界回响：
便利店外的雨停了，但街道消失了。
```

这三项是 MVP 的核心体验，不是附加功能。

## 2.13 节点结算页

必须展示：

1. 本节点发生了什么；
2. 我的行动结果；
3. 个人回响；
4. 他人回响；
5. 世界回响；
6. 我影响了谁；
7. 谁影响了我；
8. 新线索；
9. 关系变化；
10. 危险等级变化；
11. 下一节点钩子。

## 2.14 多 POV 章节生成

章节不是普通单主角小说，而是多角色 POV。

输出结构：

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
  }>;
  highlights: Array<{
    roleId: string;
    text: string;
  }>;
  keyChoices: string[];
  nextHook: string;
};
```

展示示例：

```text
《午夜便利店：第一夜》

第一节：夜班店员
第二节：外卖骑手
第三节：调查顾客
第四节：雨夜交叉
尾声：未送达的订单
```

## 2.15 个人故事卡

每个玩家在章节结束后获得个人故事卡。

字段：

```ts
export type PersonalStoryCard = {
  roleId: string;
  roleName: string;
  protagonistType: string;
  keyChoice: string;
  influencedWho: string;
  influencedByWhom?: string;
  unresolvedQuestion: string;
  shareText: string;
};
```

示例：

```text
你的角色：外卖骑手 陈舟
你的主角类型：行动型主角 / 命运订单携带者
你的关键选择：你没有直接送单，而是先拨通订单电话。
你影响了谁：你让夜班店员第一次意识到，外面也有人知道硬币的存在。
未解问题：为什么收货人会是你自己？
```

## 2.16 MVP 数据库设计

```prisma
model User {
  id             String   @id @default(cuid())
  openid         String   @unique
  nickname       String?
  avatarUrl      String?
  status         String   @default("active")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model WorldTemplate {
  id          String   @id
  name        String
  genre       String
  hook        String
  worldBase   String
  configJson  Json
  status      String   @default("active")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model StoryRun {
  id                String   @id @default(cuid())
  templateId         String
  ownerUserId        String
  title              String
  mode               String   @default("invite")
  status             String   @default("waiting_players")
  currentChapter     Int      @default(1)
  currentNodeId      String?
  maxPlayers         Int      @default(3)
  dangerLevel        Int      @default(1)
  stateJson          Json
  canonStatus        String   @default("draft")
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}

model StoryRole {
  id                String   @id @default(cuid())
  runId              String
  roleKey            String
  roleName           String
  identity           String
  publicInfo         String
  hiddenSecret       String?
  personalGoal       String
  personalHook       String?
  destinyQuestion    String?
  privateCluesJson   Json?
  arcStage           String   @default("setup")
  knownInfoJson      Json
  cannotDoJson       Json
  impactSummaryJson  Json?
  unresolvedJson     Json?
  isAiControlled     Boolean  @default(false)
  status             String   @default("available")
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}

model SceneNode {
  id                String   @id @default(cuid())
  runId              String
  chapterIndex       Int
  nodeIndex          Int
  title              String
  publicNarration    String
  nodeGoal           String
  status             String   @default("open_for_actions")
  actionOptionsJson  Json
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([runId, chapterIndex, nodeIndex])
}

model PlayerAction {
  id             String   @id @default(cuid())
  runId           String
  nodeId          String
  roleId          String
  userId          String?
  actionType      String
  targetType      String?
  targetText      String?
  method          String
  intent          String
  riskLevel       String   @default("normal")
  freeText        String?
  informationJson Json?
  guardStatus     String   @default("pending")
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
  actionResultsJson    Json
  echoesJson           Json
  crossImpactsJson     Json
  clueChangesJson      Json
  relationChangesJson  Json
  dangerBefore         Int
  dangerAfter          Int
  statePatchJson       Json
  nextNodeHook         String?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
}

model Chapter {
  id              String   @id @default(cuid())
  runId            String
  chapterIndex     Int
  title            String
  summary          String
  content          String
  povSectionsJson  Json
  personalCardsJson Json
  highlightsJson   Json
  keyChoicesJson   Json
  nextHook         String?
  canonStatus      String   @default("candidate")
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([runId, chapterIndex])
}
```

## 2.17 MVP API 设计

### Auth

```http
POST /api/auth/wechat-login
GET  /api/user/me
```

### WorldTemplate

```http
GET /api/world-templates
GET /api/world-templates/:templateId
```

### StoryRun

```http
POST /api/story-runs
GET  /api/story-runs/:runId
GET  /api/story-runs/:runId/state
GET  /api/my/story-runs
POST /api/story-runs/:runId/join
POST /api/story-runs/:runId/start
```

### Role

```http
GET  /api/story-runs/:runId/roles
POST /api/story-runs/:runId/roles/:roleId/claim
GET  /api/story-runs/:runId/my-role
```

### SceneNode

```http
GET  /api/story-runs/:runId/current-node
POST /api/nodes/:nodeId/resolve
```

### PlayerAction

```http
POST /api/nodes/:nodeId/actions
GET  /api/nodes/:nodeId/actions
POST /api/actions/:actionId/cancel
```

### Chapter

```http
POST /api/story-runs/:runId/generate-chapter
GET  /api/story-runs/:runId/chapters
GET  /api/chapters/:chapterId
POST /api/chapters/:chapterId/share
```

## 2.18 MVP AI Prompt

### ActionGuard Prompt

```text
你是 AI 多人故事局的行动裁判。

任务：判断玩家提交的行动是否允许进入故事结算。

必须遵守：
1. 玩家只能控制自己的角色。
2. 玩家只能声明意图，不能宣布结果。
3. 玩家不能直接揭开全部真相。
4. 玩家不能违反世界规则。
5. 玩家不能操控其他玩家角色做决定。
6. 玩家不能跳过当前剧情阶段。
7. 玩家不能新增破坏世界观的大设定。

输出严格 JSON：
{
  "allowed": true,
  "severity": "ok",
  "reason": "",
  "normalizedAction": {},
  "suggestions": []
}
```

### Director Resolve Prompt

```text
你是 AI 多人故事局的群像导演和裁判。

你要根据当前剧情节点、玩家行动、世界规则、角色秘密、已知线索，结算本节点。

每次结算必须完成：
1. 保留每个玩家行动的核心意图。
2. 判断行动结果：成功、失败、部分成功、成功但付出代价、触发风险。
3. 推进每个活跃玩家的个人线。
4. 至少产生 1 个跨角色影响。
5. 输出每个玩家的三个回响：个人回响、他人回响、世界回响。
6. 更新线索、关系、危险等级和世界状态。
7. 不要让某个玩家长期沦为配角。
8. 不要把所有玩家强行拉到同一地点。
9. 所有交织必须来自角色目标、秘密、线索或世界规则。
10. 必须保留信息权限，不能把私密信息直接公开给所有玩家。
11. 不替玩家做重大决定。
12. 不跳到大结局。
13. 必须留下下一节点可行动钩子。

输出必须是合法 JSON。
```

### Chapter Generate Prompt

```text
你是章节编辑。

你要把本章 3-5 个剧情节点的公共叙事、玩家行动、行动结果、回响、跨角色影响、线索变化和关系变化整理成一章多 POV 小说。

要求：
1. 第三人称。
2. 统一文风。
3. 保留主要玩家行动。
4. 每个玩家至少有一个 POV 段落。
5. 保留本章关键选择和高光。
6. 不新增破坏后续剧情的大设定。
7. 不剧透未公开秘密。
8. 字数 1000-3000 字。
9. 结尾必须有下一章悬念。
10. 输出个人故事卡。
```

## 2.19 MVP 验证指标

| 指标 | 及格线 | 有戏线 |
|---|---:|---:|
| 首页开局点击率 | 20% | 35%+ |
| 角色选择完成率 | 50% | 75%+ |
| 第一次行动提交率 | 40% | 65%+ |
| 节点结算查看率 | 60% | 80%+ |
| 第一章完成率 | 25% | 50%+ |
| 继续下一章率 | 10% | 25%+ |
| 分享率 | 10% | 25%+ |
| 次日回访率 | 10% | 25%+ |
| 用户主动自由输入比例 | 20% | 40%+ |
| 付费意愿 | 1%-2% | 3%-5%+ |

## 2.20 MVP Sprint 开发计划

### Sprint 1：工程骨架与模板数据

任务：

1. 初始化 monorepo；
2. 配置 API 服务；
3. 配置数据库；
4. 配置小程序；
5. 配置后台；
6. 创建 3 个世界模板 seed；
7. 实现 mock 微信登录；
8. 实现首页模板列表；
9. 实现创建 StoryRun API。

验收：

- 本地可以启动 API 和小程序；
- 用户可以看到 3 个世界模板；
- 用户可以创建故事局。

### Sprint 2：角色选择与角色卡

任务：

1. 创建 StoryRole；
2. 实现角色选择页；
3. 实现角色卡页；
4. 展示专属开场；
5. 展示命运问题；
6. 展示隐藏秘密和私密线索；
7. 实现角色 claim。

验收：

- 用户可以选择角色；
- 用户能看到自己的命运线；
- 同一角色不能被重复选择。

### Sprint 3：故事局房间与行动提交

任务：

1. 实现当前节点读取；
2. 实现故事局房间页；
3. 实现行动提交表单；
4. 实现 ActionGuard mock；
5. 实现行动合法性检查；
6. 实现同一节点同一角色只能提交一次行动；
7. 实现玩家行动状态。

验收：

- 用户能看到当前剧情和目标；
- 用户能提交行动；
- 乱写行动会被拦截；
- 玩家状态正确显示。

### Sprint 4：AI 导演结算与三个回响

任务：

1. 实现 AiProvider mock；
2. 实现 DirectorService.resolveNode；
3. 生成行动结果；
4. 生成个人回响；
5. 生成他人回响；
6. 生成世界回响；
7. 生成跨角色影响；
8. 更新线索、关系、危险等级；
9. 创建下一节点；
10. 实现节点结算页。

验收：

- 用户看到自己的行动结果；
- 用户看到三个回响；
- 用户看到自己影响了谁；
- 故事可以进入下一节点。

### Sprint 5：多 POV 章节与个人故事卡

任务：

1. 收集本章所有节点；
2. 调用 ChapterGenerate；
3. 生成多 POV 章节；
4. 生成角色高光；
5. 生成个人故事卡；
6. 生成下一章钩子；
7. 实现章节结果页；
8. 实现分享卡。

验收：

- 3-5 个节点后生成章节；
- 每个玩家都有 POV；
- 每个玩家都有故事卡；
- 章节可分享。

### Sprint 6：后台、日志、测试与上线准备

任务：

1. 后台查看故事局；
2. 后台查看行动；
3. 后台查看 AI 结算日志；
4. 后台查看审核日志；
5. 实现核心埋点；
6. 实现 E2E 测试；
7. 实现 fallback；
8. 写本地启动文档。

验收：

- 能完整跑通午夜便利店第一章；
- AI 失败有 fallback；
- 后台能排查问题；
- 埋点能形成漏斗。

---

# 3. 渐进版：MVP 后的阶段路线

## 3.1 阶段 1：MVP 增强版

目标：提高第一章完成率和分享率。

新增功能：

1. 更多推荐行动；
2. 更好的故事卡海报；
3. 角色线归档页；
4. 简单故事世界主页；
5. 继续下一章；
6. 更强 AI 托管未行动角色；
7. 结算体验优化。

关键指标：

- 第一章完成率超过 50%；
- 分享率超过 20%；
- 继续下一章率超过 20%。

## 3.2 阶段 2：故事世界主页

目标：让故事不再是一次性故事局，而是可以持续沉淀。

新增功能：

1. 世界简介；
2. 正史章节；
3. 角色线；
4. 未解谜题；
5. 参与者；
6. 继续主线；
7. 开启支线 UI；
8. 生成番外 UI。

开发重点：

- StoryWorld 雏形；
- canonStatus 字段；
- roleLine 归档；
- 世界主页前端。

## 3.3 阶段 3：支线与候选正史

目标：接近 GitHub 式共创结构。

新增功能：

1. 玩家可以提交支线；
2. 支线进入候选状态；
3. AI 进行世界观校验；
4. 世界主可以采纳或拒绝；
5. 采纳后成为正史；
6. 未采纳可成为平行故事。

核心表：

- StoryBranch；
- Contribution；
- MergeRequest。

## 3.4 阶段 4：创作者工具

目标：让世界主可以创建和管理自己的故事世界。

新增功能：

1. AI 辅助创建世界种子；
2. 角色池管理；
3. 世界规则编辑；
4. 支线审核；
5. 数据看板；
6. 私密世界；
7. 付费高级世界。

## 3.5 阶段 5：社区化与平台化

目标：让用户发现、参与和共创更多故事世界。

新增功能：

1. 世界广场；
2. 热门世界榜；
3. 热门角色线；
4. 共创者主页；
5. 评论、收藏、点赞；
6. 世界主收益；
7. 平台抽成。

## 3.6 阶段 6：IP 孵化

目标：从热门世界中筛选可改编 IP。

新增功能：

1. 热门世界数据分析；
2. 角色人气分析；
3. 改编脚本生成；
4. 漫画/短剧分镜；
5. IP 授权管理；
6. 合作方入口。

---

# 4. 内容安全与合规

## 4.1 必审内容

用户侧：

1. 昵称；
2. 行动文本；
3. 支线文本；
4. 举报反馈；
5. 分享文案。

AI 侧：

1. 角色卡；
2. 公共叙事；
3. 私密反馈；
4. 三个回响；
5. 章节正文；
6. 故事卡文案。

## 4.2 禁止内容

1. 过度血腥；
2. 色情低俗；
3. 现实危险行为指导；
4. 人身攻击和威胁；
5. 违法违规内容；
6. 政治敏感内容；
7. 鼓励自伤、自杀、极端行为内容；
8. 对未成年人不适宜的成人化内容。

## 4.3 审核失败处理

1. 用户输入失败：提示修改，不进入结算；
2. AI 输出失败：重试一次；
3. 重试仍失败：使用 fallback；
4. 严重风险：进入后台人工审核。

---

# 5. 最终验收标准

MVP 完成必须满足：

1. 用户可以登录；
2. 用户可以创建故事局；
3. 用户可以选择世界模板；
4. 用户可以选择角色；
5. 用户可以查看专属开场；
6. 用户可以查看命运问题；
7. 用户可以提交结构化行动；
8. ActionGuard 可以拦截乱写；
9. AI 可以结算节点；
10. AI 可以生成三个回响；
11. AI 可以生成跨角色影响；
12. 世界状态可以更新；
13. 3-5 节点可以生成一章；
14. 章节必须是多 POV；
15. 每个玩家有个人故事卡；
16. 章节可以分享；
17. 支持单人试玩；
18. 支持 2-5 人邀请局；
19. 未行动玩家不会永久阻塞；
20. AI 失败有 fallback；
21. 审核失败不会公开展示；
22. 后台可以查看故事局、行动、结算、AI 日志、审核日志；
23. 埋点能形成漏斗；
24. 用户感知是“玩角色”，不是“写小说”。

---

# 6. 总结

## 6.1 最终版

完整形态是：

```text
AI 群像故事世界共创平台
= 前台游戏化体验
+ 后台 GitHub 式故事协作
+ AI 世界观校验
+ AI 正史合并
+ 多人角色线沉淀
+ 创作者生态
```

## 6.2 MVP 版

MVP 只做：

```text
固定世界模板
+ 固定角色
+ 行动提交
+ AI 导演结算
+ 三个回响
+ 跨角色影响
+ 多 POV 章节
+ 个人故事卡
```

## 6.3 渐进版

MVP 通过后，逐步增加：

```text
故事世界主页
→ 角色线归档
→ 继续主线
→ 支线提交
→ 候选正史
→ 世界主审核
→ 世界广场
→ 创作者收益
→ IP 孵化
```

这条路线既能控制 MVP 开发风险，又能保证长期方向不偏离你真正想做的“前台像游戏，后台像 GitHub”的故事世界共创平台。
