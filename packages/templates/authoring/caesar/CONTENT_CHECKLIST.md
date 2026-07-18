# 《凯撒：共和国最后的春天》连续策略内容清单

> 这是编剧与素材准备清单。当前线上 Caesar 仍使用 `legacy_v1`；连续策略内容完成并通过验证前，不修改线上引擎版本。

## 六个正常角色

角色资料已经集中在 `packages/templates/config/caesar/game.json`：

1. `brutus` — Brutus — 头像 `/assets/portrait/1.png`
2. `caesar` — Caesar — 头像 `/assets/portrait/2.png`
3. `cassius` — Cassius — 头像 `/assets/portrait/3.png`
4. `mark_antony` — Mark Antony — 头像 `/assets/portrait/4.png`
5. `decimus` — Decimus — 头像 `/assets/portrait/5.png`
6. `cicero` — Cicero — 头像 `/assets/portrait/6.png`

六个角色都能由真人或 AI Agent 控制。房间可以是 1–6 个真人，未被真人选择的角色由 AI Agent 接管。

## 连续内容目标

- 7 个阶段。
- 42 份角色阶段私密简报。
- 126 张主决策卡。
- 42 套谋划策略。
- 42 套 AI Agent 策略和兜底行动。
- 7 个世界行动；它们属于罗马局势，不占角色名额。
- 定向回应数量由剧本决定，不再固定为三个特定角色。
- 7 份公共阶段结果。
- 42 份个人阶段结果。
- 1 套罗马公共结局规则。
- 6 套角色个人结局规则。

## 切换到连续引擎前必须完成

1. 新建 `config/caesar/strategy-registry.json`。
2. 新建 `config/caesar/continuous-strategy-v1/` 的完整内容与 Schema。
3. 在 `game.json` 中设置：
   - `engineVersion = continuous_strategy_v1_1`
   - `strategyVersion = caesar_v1_0`
   - `strategyRegistryPath = strategy-registry.json`
   - `fixedRules = { stageCount: 7, mainCardsPerRoleStage: 3 }`
4. 设置独立的 `worldActor`，例如罗马民意、元老院程序或共和国局势；它不能与六个角色键重复。
5. 运行注册表、内容包、六角色确定性评估、API 和浏览器验收。
