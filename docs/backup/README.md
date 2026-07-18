# AI 多人局 MVP 工程文档包 v1.0

本包包含 6 份新增执行文档，以及 4 份为解决工程冲突而修订的原文档。

## 最高优先级

1. `01_AI多人局_MVP唯一工程基线_v1.0.md`
2. `02_AI多人局_StoryRun状态机与API契约_v1.0.md`
3. `03_桑田诏_剧本配置Schema_v1.0.md`
4. `04_AI多人局_MVP自动化验收矩阵_v1.0.md`
5. `05_AI多人局_部署日志与AI成本规范_v1.0.md`
6. `06_AI多人局_MVP用户试玩与数据验证方案_v1.0.md`

## 同步修订的原文档

- `07_AI多人局_Web_MVP_产品需求文档_v4.1_工程基线修订版.md`
- `08_AI多人局_数据库与存储架构设计文档_v2.1_工程基线修订版.md`
- `09_AI多人局_游戏玩法说明文档_v2.1_工程基线修订版.md`
- `10_桑田诏_完整故事局剧本_v1.1_工程基线修订版.md`

## 已解决的冲突

- 数据模型统一为 `StoryRun + StoryEvent`；
- `StoryMessage / PlayerDecision` 暂不拆表；
- 前端继续使用 `apps/web`；
- MVP 不迁移 Next.js、不新建 `apps/player-web`；
- 第 1—6 天每天固定 2 次关键决策，共 12 次；
- 规则引擎掌握状态权威，AI 只提供候选叙事与角色反应；
- API 字段统一为 `templateKey / selectedRoleKey / runId / eventId / version`。
