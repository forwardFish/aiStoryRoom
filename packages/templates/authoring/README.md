# 连续策略游戏包编写说明

运行时只读取 JSON。Markdown 仅用于编剧说明和交接，不作为游戏数据源。

## 一款游戏需要提供什么

1. `config/<worldId>/game.json`
   - 世界标题、简介、分类、标签和封面。
   - 真人数量范围：`minHumanPlayers` / `maxHumanPlayers`。
   - 全部正常角色；每个角色都必须同时支持真人和 AI Agent 控制。
   - 角色身份、公开介绍、秘密、个人目标、能力、已知信息、限制和头像。
   - 世界行动来源 `worldActor`。它用于系统事件，不是玩家角色。
   - 引擎版本和内容版本。
2. `config/<worldId>/strategy-registry.json`
   - 默认内容版本。
   - 每个已发布版本的目录和 Manifest 哈希。
3. `config/<worldId>/<strategyVersion>/`
   - `stages.json`
   - `role-stage-content.json`
   - `system-actions.json`
   - `agent-policies.json`
   - `maneuver-strategies.json`
   - `reaction-scenarios.json`
   - `result-rules.json`
   - `ending-rules.json`
   - `manifest.json` 与 schemas
4. `apps/web/public/assets/game/<worldId>/`
   - 背景图。
   - 每个角色的人物头像。
   - 世界事件、资源和状态图标。
   - `asset-manifest.json`。

## 角色与真人/AI 的关系

- `roles.length` 是游戏角色总数。
- `minHumanPlayers` / `maxHumanPlayers` 是房间允许的真人数量，不是角色总数。
- 真人选择角色后，剩余角色由 AI Agent 接管。
- 角色不会因为由 AI 控制就变成“系统角色”；真人与 AI 使用相同身份、目标、知识边界和行动卡。
- 世界自动事件放在 `system-actions.json`，其来源由 `worldActor` 描述，不占角色名额。

例如六角色游戏：

- 1 个真人进入：1 个真人角色 + 5 个 AI Agent 角色。
- 3 个真人进入：3 个真人角色 + 3 个 AI Agent 角色。
- 6 个真人进入：6 个真人角色 + 0 个 AI Agent 角色。

## 固定规则与可替换内容

连续策略 v1 固定：

- 7 个阶段。
- 每个角色每阶段 3 张主决策卡。
- 每个角色每阶段 1 套谋划策略。
- 支持定向回应、AI 接管、阶段公共结果、个人结果和最终结局。

可以替换：

- 角色数量。
- 真人数量范围。
- 全部角色身份、目标、秘密、头像和行动。
- 世界背景、地点、系统事件和所有剧情文本。
- 定向回应出现在哪些阶段、由谁触发、由谁回应。

## 数量计算

假设角色数为 `R`：

- 角色阶段内容：`7 × R`。
- 主决策卡：`7 × R × 3`。
- 谋划策略：`7 × R`。
- Agent 策略：`7 × R`。
- 阶段个人结果：`7 × R`。
- 最终个人结局：`R`。

《桑田诏》当前 `R=6`，分别是浙江总督、浙江巡抚、清流县令、改桑书吏、江南商会会首、司礼监织造使。六个角色都可以由真人或 AI Agent 控制；朝廷与市势是独立的世界行动来源，不占玩家名额。

《凯撒》计划 `R=6`，因此需要 42 份角色阶段内容、126 张主决策卡、42 套谋划/Agent 策略、42 份阶段个人结果和 6 份最终个人结局。

## 发布约束

- `worldId`、`templateId` 和已发布 `strategyVersion` 永久不变。
- 发布后的内容文件不得原地修改；修改剧情必须创建新版本。
- `game.json` 的角色键必须与每个阶段的 `playableRoleKeys` 完全一致。
- 每个头像和背景必须使用 `/assets/` URL，并在发布前验证文件存在。
- 注册表、Manifest、内容哈希和交叉引用必须全部通过后才能把游戏设为 `playable`。
