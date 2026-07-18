# Many Worlds 游戏页面数据统一替换清单 v1.0

> 项目：AI Story Room / Many Worlds  
> 日期：2026-07-16  
> 文档性质：只读梳理与统一数据边界说明  
> 当前结论：页面数据处于“JSON/API + 页面硬编码”混合状态。后端剧情行动已经较多来自 JSON，但大厅、世界详情、人数显示、头像、背景、跳转和主游戏外壳仍有大量游戏专属内容写死在页面代码中。
> 配套实施与验收规格：[`18_Many_Worlds_通用游戏内容化_P0_实施与验收规格_v1.0.md`](./18_Many_Worlds_通用游戏内容化_P0_实施与验收规格_v1.0.md)

## 1. 文档目标

本文件梳理所有与游戏展示、游戏人数、角色、图片、房间和运行过程相关的页面与代码入口，明确：

1. 当前页面数据来自哪里。
2. 哪些数据已经来自游戏 JSON 或 API。
3. 哪些数据仍然固定写死。
4. 后续统一时，每个字段应该由哪一层提供。
5. 新游戏在创建之初必须设定哪些内容。

本文件不执行页面修改，只确定统一替换范围，避免后续遗漏游戏大厅、游戏人数、房间人数、AI 补位、主游戏展示和结局等隐蔽分支。

---

## 2. 统一数据源边界

最终应只保留三层游戏数据来源。

### 2.1 `game.json`：游戏静态定义

负责：

- 世界标识、公开地址和别名。
- 游戏状态：可玩、即将上线、隐藏。
- 标题、副标题、简介、分类、标签和时长。
- 游戏大厅封面、详情页 Hero、主游戏背景和主题色。
- Solo / Multiplayer 模式。
- 最少真人数、最多真人数。
- 正常角色总表、角色资料和人物头像。
- worldActor。
- 引擎版本、策略版本和策略注册表路径。
- 地点名称、回合名称和最终裁决名称。

### 2.2 连续策略 JSON：游戏运行内容

负责：

- 阶段定义。
- 每个角色每阶段的私密简报。
- 主决策卡。
- 谋划策略。
- 定向回应。
- AI Agent 策略和兜底行动。
- 世界行动。
- 公共阶段结果。
- 个人阶段结果。
- 公共结局和个人结局。

连续策略内容包包括：

```text
stages.json
role-stage-content.json
system-actions.json
agent-policies.json
maneuver-strategies.json
reaction-scenarios.json
result-rules.json
ending-rules.json
manifest.json
schemas/
```

### 2.3 Run / Projection：当前游戏实时状态

负责：

- 当前 RunId。
- 当前世界和策略版本。
- 当前阶段。
- 当前真人玩家。
- 当前 AI Agent 玩家。
- 角色控制状态。
- Ready 状态。
- 当前行动窗口。
- 已提交行动。
- 实时事件和结果。
- 当前玩家有权看到的私密内容。

页面不应根据 `worldId === "sangtian"` 或 `worldId === "caesar"` 自行拼接游戏内容。

---

## 3. 游戏人数统一定义

以后每个游戏必须从创建时就区分以下人数概念。

| 字段 | 含义 | 标准来源 |
|---|---|---|
| `roleCount` | 正常角色总数 | `game.json.roles.length` 派生 |
| `minHumanPlayers` | 开局所需最少真人数 | `game.json.modes.minHumanPlayers` |
| `maxHumanPlayers` | 一个房间最多允许加入的真人数 | `game.json.modes.maxHumanPlayers` |
| `currentHumanCount` | 当前已经加入的真人数 | Run / Room 实时状态 |
| `aiPlayerCount` | 当前由 AI Agent 控制的正常角色数 | `roleCount - 已占用角色的真人数` |

### 3.1 六角色游戏示例

假设一款游戏有 6 个正常角色：

- 1 个真人进入：1 个真人角色 + 5 个 AI Agent 角色。
- 3 个真人进入：3 个真人角色 + 3 个 AI Agent 角色。
- 6 个真人进入：6 个真人角色 + 0 个 AI Agent 角色。

worldActor 不属于这 6 个角色，不占角色名额，也不计入真人或 AI Agent 玩家数量。

### 3.2 页面人数展示要求

页面不能再用一个 `3 / 6 players` 同时表达真人数和角色总数。建议明确显示：

```text
真人：3 / 6
角色席位：6
AI Agent：3
最低开局真人：1
```

---

## 4. 页面统一替换矩阵

## 4.1 首页 `/`

文件：`apps/web/public/home.js`

### 当前状态

首页游戏列表和轮播完全写死，没有读取游戏注册表。

### 当前硬编码内容

- 游戏标题。
- 游戏简介。
- 分类。
- 封面编号。
- `1–3 roles`、`1–6 roles`。
- 游戏时长。
- 首页轮播顺序。
- 精选游戏状态。
- Solo 默认跳转凯撒。
- Room 默认跳转凯撒。
- 首页角色头像示意图。
- 页脚的 Solo / Room 默认世界链接。

主要证据：

- `apps/web/public/home.js:1-15`
- `apps/web/public/home.js:184-196`
- `apps/web/public/home.js:228-231`

### 统一来源

- 游戏列表：`GET /api/v4/worlds`
- 标题、简介、分类、标签、时长：`game.json.catalog`
- 人数：`game.json.modes` + `roles.length`
- 封面：`catalog.cardCover` / `catalog.heroCover`
- 可玩状态：`game.json.status`
- 跳转：根据 `worldId` 生成

首页的通用营销说明可以继续静态，但游戏标题、图片、人数、状态和跳转必须来自注册表。

---

## 4.2 游戏大厅 `/worlds`

文件：`apps/web/public/worlds.html`

### 当前状态

六张游戏卡全部写死在 HTML 中，没有调用 `/api/v4/worlds`。

### 当前硬编码内容

- 两个可玩游戏。
- 四个 Coming Soon 游戏。
- 游戏标题、简介、分类。
- 背景图。
- 真人/角色人数。
- 游戏时长。
- `Playable` / `Coming Soon` 状态。
- 跳转地址。

主要证据：

- `apps/web/public/worlds.html:18-109`

### 统一来源

- 大厅只保留标题、副标题和卡片容器。
- 所有卡片由 `GET /api/v4/worlds` 返回。
- `status=playable`：整卡可点击。
- `status=coming_soon`：整卡不可点击。
- 人数文案由 `minHumanPlayers`、`maxHumanPlayers`、`roleCount` 生成。
- 第三个游戏加入注册表后，应自动出现在大厅，不再修改 HTML。

### 当前后端基础

后端已经存在动态游戏目录接口：

- `apps/api/src/worlds.controller.ts:50-59`

但大厅尚未消费该接口。

---

## 4.3 世界详情 `/worlds/:worldId`

文件：`apps/web/public/platform.js`

### 当前状态

桑田诏和凯撒分别存在静态专属分支。页面虽然请求世界 API，但只覆盖标题和部分角色名字，其他内容仍来自第一次静态渲染。

### 当前硬编码内容

- `if path === /worlds/sangtian` 分支。
- 凯撒默认分支。
- Hero 标题和介绍。
- 世界地点和类型。
- 人数和时长。
- Hero 背景图。
- 角色卡数量、角色文案和头像。
- Solo / Multiplayer 说明。
- `Starts from 20 World Credits`。
- 按钮 action 名称。
- 桑田和凯撒专属返回地址。

主要证据：

- `apps/web/public/platform.js:231-256`

### 已有动态 API

`GET /api/v4/worlds/:worldId` 已经可以返回：

- 标题、简介、分类和标签。
- 时长。
- Hero 图片。
- 模式。
- 角色资料和头像。
- presentation。
- worldActor。

主要证据：

- `apps/api/src/worlds.controller.ts:24-44`

### 统一要求

世界详情页改为一套通用模板，不再包含桑田/凯撒分支。所有展示字段由世界详情 API 提供。

---

## 4.4 选角页 `/role-select?story=<worldId>`

文件：

- `apps/web/public/role-select.js`
- `apps/api/src/mvp-catalog.ts`

### 已经动态的内容

- 世界标题和简介。
- 角色名字。
- 角色身份。
- 角色头像路径。
- 个人目标。

### 当前硬编码或半硬编码内容

- 默认世界固定为 `sangtian`。
- 只有 `state.story.id === "caesar"` 才走 `/v4/rooms/solo`。
- 其他世界走旧 `/v4/stories/:id/runs`。
- 角色图标只认识总督、巡抚、县令和商会。
- `fateQuestion`、`rank`、`office`、`traits`、`resources` 仍来自旧目录。
- Caesar 角色展示资料仍有第二份硬编码数组。
- Hero 样式通过图片文件名生成 CSS class。

主要证据：

- `apps/web/public/role-select.js:7-56`
- `apps/web/public/role-select.js:117-180`
- `apps/api/src/mvp-catalog.ts:225-267`

### 统一来源

- 所有注册游戏使用同一个世界详情/选角投影。
- 所有连续策略游戏使用同一个 Solo 创建接口。
- 角色名字、头像、身份、目标、图标和展示资料来自角色配置。
- 删除 `story.id === "caesar"` 和角色键专属判断。

---

## 4.5 房间列表 `/rooms`

文件：`apps/web/public/platform.js`

### 已经动态的内容

- 房间列表。
- 当前玩家数。
- 房间名称。
- 邀请码。
- 房间状态。

### 当前硬编码内容

- 世界标题只区分桑田和凯撒。
- 房间封面按列表 index 循环 `/assets/bg/1–5.png`。
- 世界筛选器只是静态 `All Worlds`。
- 创建房间默认世界是凯撒。
- 分享弹窗固定使用 `/assets/bg/1.png`。

主要证据：

- `apps/web/public/platform.js:374-388`
- `apps/web/public/platform.js:397`

### 统一来源

房间列表项必须获得：

- `worldId`
- `worldTitle`
- `cardCover`
- `roleCount`
- `minHumanPlayers`
- `maxHumanPlayers`
- 当前真人数
- 当前 AI 数
- 当前房间状态

世界筛选器也应由游戏注册表生成。

---

## 4.6 房间等待页 `/rooms/:roomId`

文件：`apps/web/public/platform.js`

### 已经动态的内容

- 玩家列表。
- 角色列表。
- 角色是否可选。
- Ready 状态。
- 最低真人数。
- 是否可以开始。
- AI 补位逻辑。

### 当前硬编码内容

- 初始 HTML 是凯撒 Fixture。
- 世界封面固定 `/assets/bg/1.png`。
- 玩家头像按 index 循环 `/assets/portrait/1–7.png`。
- 角色头像按 index 循环，不读取角色 portrait。
- 完成提示固定 `All seven rounds are complete`。
- 分享弹窗背景固定。
- 房间人数只显示 `players/maxPlayers`，没有区分角色总数和 AI 数。

主要证据：

- `apps/web/public/platform.js:263-265`
- `apps/web/public/platform.js:361`
- `apps/web/public/platform.js:389`

### 房间 API 需要提供的展示信息

- `worldTitle`
- `worldCover`
- `roleCount`
- `currentHumanCount`
- `aiPlayerCount`
- `stageCount`
- `roundLabel`
- 每个角色的 `portrait`
- 当前角色的控制者类型：Human / AI

---

## 4.7 主游戏页 `/game?runId=...`

文件：

- `apps/web/public/continuous-game-view.js`
- `apps/web/public/continuous-game.css`
- `apps/web/public/main-game.css`
- `apps/api/src/continuous-strategy/member-projection.service.ts`
- `packages/shared/src/continuous-strategy/projection.schemas.ts`

### 已经来自策略 JSON 的内容

- 当前阶段标题。
- 公共局势。
- 当前角色私密简报。
- 当前角色个人压力。
- 主决策卡。
- 谋划策略。
- 定向回应。
- AI Agent 策略。
- 公共阶段结果。
- 个人阶段结果。
- 最终公共/个人结局。

主要证据：

- `apps/api/src/continuous-strategy/member-projection.service.ts:143-227`

### 当前硬编码内容

- 当前轮次 `/ 7`。
- 已完成主决策 `/ 3`。
- 剩余轮数按 7 计算。
- 返回地址固定 `/worlds/sangtian`。
- 地点固定“杭州总督府 · 内厅”。
- “御前裁决”。
- “三方角色”。
- 完成布局人数 `/ 3`。
- 等待人数 `/ 3`。
- “三方行动”。
- 头像只认识桑田三个角色。
- 加载和错误页面印章固定“桑田诏”。

主要证据：

- `apps/web/public/continuous-game-view.js:8-10`
- `apps/web/public/continuous-game-view.js:44-45`
- `apps/web/public/continuous-game-view.js:84-105`
- `apps/web/public/continuous-game-view.js:143`
- `apps/web/public/game-bootstrap.js:83-110`

### CSS 硬编码

- 总督、巡抚、县令头像。
- 商会、司礼监头像。
- 桑田主背景。
- 杭州场景图。

主要证据：

- `apps/web/public/main-game.css:222-228`
- `apps/web/public/main-game.css:264-282`

### GameProjection 必须增加的 presentation

```json
{
  "presentation": {
    "worldId": "sangtian",
    "worldTitle": "嘉靖财政危局",
    "worldDetailUrl": "/worlds/sangtian",
    "stageCount": 7,
    "roleCount": 3,
    "roundLabel": "共同回合",
    "finaleLabel": "御前裁决",
    "locationLabel": "杭州总督府 · 内厅",
    "sceneBackground": "/assets/game/sangtian/background.png",
    "accent": "#6545f5",
    "accentSoft": "#f3f0ff",
    "rolePortrait": "/assets/game/sangtian/roles/zhejiang_governor.png"
  }
}
```

当前 `GameProjectionV1` 没有 presentation：

- `packages/shared/src/continuous-strategy/projection.schemas.ts:37-68`

页面应只读取 projection，不自行判断世界 ID。

---

## 4.8 结局页 `/game/result?runId=...`

文件：

- `apps/web/public/continuous-game-view.js`
- `apps/web/public/continuous-game-client.js`
- `packages/shared/src/continuous-strategy/projection.schemas.ts`

### 已经动态的内容

- 公共结局。
- 个人结局。
- 关键行动。
- 跨角色影响。
- 控制权变化。

### 当前缺少的世界展示信息

- 世界标题。
- 世界封面。
- 当前角色头像。
- `finaleLabel`。
- 世界详情返回地址。
- 重新开始地址。
- 当前世界角色列表。

当前 `ResultProjectionV1` 没有 presentation：

- `packages/shared/src/continuous-strategy/projection.schemas.ts:70-80`

### 旧结果实现

`platform.js` 中还保留凯撒静态结果 Fixture 和桑田/凯撒条件分支：

- `apps/web/public/platform.js:272-287`

当前正式 `/game/result` 主要走连续游戏客户端，但旧逻辑仍需明确废弃或清理，避免以后出现第二套结果页。

---

## 5. 旧游戏入口与隐藏分支

## 5.1 `/game` 无 `runId`

文件：

- `apps/web/public/game-bootstrap.js`
- `apps/web/public/app.js`
- `apps/web/public/room-story-storage.js`

### 当前行为

没有 RunId 时直接加载旧 `app.js`，本质是固定桑田诏游戏。

### 固定内容

- 桑田诏名称。
- 杭州总督府。
- 浙江总督。
- 粮价、国库、民心、改桑。
- 巡抚、商会、司礼监。
- 七轮、三人。
- 桑田背景和角色头像。

主要证据：

- `apps/web/public/game-bootstrap.js:16-24`
- `apps/web/public/app.js:579-741`
- `apps/web/public/room-story-storage.js:79-167`

### 必须明确的产品边界

统一时二选一：

1. 无 RunId 时跳转游戏大厅/选角页；或
2. 把旧单人页面也改成注册表驱动。

否则它会一直是隐藏的桑田专属入口。

---

## 5.2 `/trio` 三人 AI 页面

文件：`apps/web/public/trio.js`

### 当前固定内容

- 三名玩家。
- 三个角色。
- 七轮。
- 三人提交计数。
- `ai-trio` 模式。

主要证据：

- `apps/web/public/trio.js:39-46`
- `apps/web/public/trio.js:103-131`

### 必须明确的产品边界

该页面应明确为以下三种状态之一：

- 仅保留为开发测试工具。
- 从公开产品入口删除。
- 另行改造成可配置的模拟器。

它不应继续与标准游戏页面共享“通用游戏已完成”的验收结论。

---

## 6. 非页面但必须同时统一的地方

## 6.1 本地和生产路由

本地服务器目前只明确注册：

```text
/worlds/sangtian
/worlds/caesar
```

证据：

- `apps/web/src/server.mjs:48-49`

Vercel 已使用：

```text
/worlds/:path*
```

证据：

- `vercel.json:38`

本地与生产行为不一致。第三个游戏应通过统一动态路由工作，不能继续逐个增加本地路由。

---

## 6.2 世界目录 API 人数语义

文件：`apps/api/src/worlds.controller.ts`

当前连续游戏返回：

```text
minPlayers = roles.length
```

这会把“最少真人数”错误表示成“角色总数”。

证据：

- `apps/api/src/worlds.controller.ts:11-16`

必须明确返回：

- `roleCount`
- `minHumanPlayers`
- `maxHumanPlayers`

页面不能继续使用含义模糊的 `minPlayers`。

---

## 6.3 房间状态默认值

文件：`apps/api/src/rooms.service.ts`

正常注册游戏创建时已经读取配置，但旧状态/fallback 分支仍多次写死：

```text
minPlayers: 3
```

证据：

- `apps/api/src/rooms.service.ts:179`
- `apps/api/src/rooms.service.ts:195`
- `apps/api/src/rooms.service.ts:425`

统一后 fallback 也必须从当前 Run 的 `GameDefinition` 读取。

---

## 6.4 价格、免费阶段与解锁

当前价格来源不统一：

- 免费阶段数来自环境变量，默认 3。
- 世界解锁价格来自环境变量，默认 100 Credits。
- 世界详情页静态显示 `Starts from 20 World Credits`。

证据：

- `apps/api/src/continuous-strategy/member-projection.service.ts:110-112`
- `apps/api/src/story-access/story-access.service.ts:22-23`
- `apps/web/public/platform.js:250`

### 统一边界

如果不同游戏价格不同，应在游戏配置中增加 `economy`。

如果所有游戏使用统一价格，则页面必须读取平台统一配置，不能在游戏详情页写死 20。

建议统一字段：

```json
{
  "economy": {
    "freeStageCount": 3,
    "unlockCredits": 100,
    "priceLabel": "Starts from 100 World Credits"
  }
}
```

---

## 7. 每个新游戏一开始必须设定的字段

## 7.1 当前 `game.json` 已支持

### 基础身份

- `worldId`
- `publicId`
- `aliases`
- `templateId`
- `status`

### 游戏大厅与详情

- `catalog.title`
- `catalog.subtitle`
- `catalog.description`
- `catalog.genre`
- `catalog.tags`
- `catalog.durationLabel`
- `catalog.cardCover`
- `catalog.heroCover`

### 模式和人数

- `modes.solo`
- `modes.multiplayer`
- `modes.minHumanPlayers`
- `modes.maxHumanPlayers`
- `roles.length` 派生角色总数

### 引擎

- `engine.engineVersion`
- `engine.strategyVersion`
- `engine.strategyRegistryPath`
- `engine.fixedRules.stageCount`
- `engine.fixedRules.mainCardsPerRoleStage`

### 世界事件

- `worldActor.actorKey`
- `worldActor.actorName`
- `worldActor.description`
- `worldActor.portrait`

### 主游戏展示

- `presentation.locationLabel`
- `presentation.roundLabel`
- `presentation.finaleLabel`
- `presentation.sceneBackground`
- `presentation.assetManifest`
- `presentation.accent`
- `presentation.accentSoft`

### 角色

每个角色需要：

- `roleKey`
- `roleName`
- `identity`
- `publicInfo`
- `hiddenSecret`
- `personalGoal`
- `currentState`
- `abilityText`
- `arcText`
- `knownInfo`
- `cannotDo`
- `portrait`
- `canBeHumanControlled`
- `canBeAiControlled`

---

## 7.2 当前缺少但页面正在使用的字段

以下字段目前散落在前端或旧目录中，需要决定是加入 `game.json`，还是从现有字段统一派生：

- `defaultRoleKey`
- 角色 `iconKey`
- 角色 `rank`
- 角色 `office`
- 角色 `fateQuestion`
- 角色展示 traits
- 世界详情 CTA 文案
- 世界详情价格文案
- 免费阶段数
- 解锁 Credits
- 房间分享海报背景
- 默认语言
- 游戏大厅排序
- 首页精选状态
- 首页轮播顺序
- Coming Soon 上线说明

可考虑扩展：

```json
{
  "catalog": {
    "featured": true,
    "sortOrder": 10,
    "comingSoonLabel": null
  },
  "modes": {
    "defaultRoleKey": "brutus"
  },
  "economy": {
    "freeStageCount": 3,
    "unlockCredits": 100,
    "priceLabel": "Starts from 100 World Credits"
  }
}
```

---

## 8. 数据归属总表

| 页面字段 | 应由谁提供 |
|---|---|
| 世界标题、简介、分类、标签 | `game.json.catalog` |
| 大厅封面、详情 Hero | `game.json.catalog` |
| 最少/最多真人数 | `game.json.modes` |
| 角色总数 | `game.json.roles.length` |
| AI 数量 | Run 实时计算 |
| 角色身份、目标、头像 | `game.json.roles` |
| 地点、回合名、最终裁决名 | `game.json.presentation` |
| 主游戏背景、主题色 | `game.json.presentation` |
| 当前阶段和主决策卡 | 连续策略 JSON |
| 私密简报和个人压力 | 连续策略 JSON |
| 谋划、回应和 AI 策略 | 连续策略 JSON |
| 公共/个人结果和结局 | 连续策略 JSON |
| 当前真人、Ready、AI 接管 | Room / Run Projection |
| 价格和免费阶段 | 游戏 economy 或平台统一配置 |
| Coming Soon / Playable | `game.json.status` |

---

## 9. 完整影响面

需要统一的用户页面共 8 个：

1. 首页。
2. 游戏大厅。
3. 世界详情。
4. 选角页。
5. 房间列表。
6. 房间等待页。
7. 主游戏页。
8. 结局页。

需要明确保留或废弃的旧入口共 2 个：

1. `/game` 无 RunId 的旧桑田单人入口。
2. `/trio` 三人 AI 测试页面。

必须同步调整的数据/API 契约共 5 类：

1. 世界目录 API。
2. 角色选择投影。
3. 房间投影。
4. GameProjection。
5. ResultProjection。

必须同步统一的基础设施共 3 类：

1. 本地/生产动态路由。
2. 游戏素材目录和 asset manifest。
3. 价格、免费阶段和解锁配置。

---

## 10. 当前判断

### 已确认

- 后端已有唯一游戏注册表。
- `game.json` 已能保存主要世界、模式、人数和角色资料。
- 连续策略运行内容已经可以按世界和策略版本加载。
- 主游戏的阶段、行动和结果数据已经主要来自策略 JSON。
- 房间后端已经支持可变真人数和 AI Agent 补位。

### 尚未统一

- 首页和游戏大厅仍为静态游戏目录。
- 世界详情仍存在桑田/凯撒两套分支。
- 选角页仍依赖旧故事目录和世界判断。
- 房间列表和等待页缺少动态封面、头像和人数语义。
- GameProjection / ResultProjection 没有世界 presentation。
- 主游戏页面仍写死 7 轮、3 角色、杭州和桑田头像。
- 本地服务器未使用通用世界详情路由。
- 价格和免费阶段没有统一数据源。
- 旧 `/game` 和 `/trio` 仍是固定游戏/固定人数入口。

### 结论

当前页面不是完全从 JSON 渲染，而是混合状态。后续统一不能只替换主游戏页，必须同时覆盖首页、游戏大厅、详情、选角、房间、主游戏、结局、路由、投影和人数定义，才能保证第三个游戏只增加配置、剧本和图片，不再修改页面代码。
