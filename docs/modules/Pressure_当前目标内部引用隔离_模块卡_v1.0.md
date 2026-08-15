# Pressure 当前目标内部引用隔离模块卡 v1.0

模块名称：Pressure Viewer-safe Current Goals Projection

用户目标：真实 `/game` 的“当前目标”只显示玩家可读内容，不显示 `P0-SF-*`、`obj.*` 等内部权威引用。

唯一职责：把后端席位处境投影限制为玩家可读文本，并让前端只把真正的目标与风险映射到“当前目标”。

明确不负责：不修改剧情事实、知识权限、角色初始配置、决策、Settlement、数据库、API 路由或页面布局。

输入及其权威来源：已发布桑田内容包中的 `institutionalMission`、`pressure`、`persistentObjectRefs` 和对象 `name`。

输出及其消费者：保持现有 `PressureGameSituationProjectionV1` 字段合同；`goal`、`risk`、`judgment` 均为玩家可读文本，由现有 `/game` Projection 和 Pressure 前端适配器读取。

允许依赖：桑田已发布内容包、当前 viewer 席位、现有 Pressure Game Projection 合同。

禁止依赖：前端硬编码内部 ID 映射、Prompt 猜测、其他席位私密知识、数据库新增字段。

准确生产文件：

- `apps/api/src/pressure-chapter/product-adapters/seat-private-content.adapters.ts`
- `apps/web/public/pressure-main-game-storage-v1.js`

准确测试文件：

- `apps/api/src/pressure-chapter/product-adapters/product-adapters.spec.ts`
- `apps/web/tests/pressure-chapter-game-v1.pressure-chapter.browser.test.mjs`

修改前行为：后端把 `knowledge.knownFactRefs` 拼接进 `situation.judgment`；前端把 `goal`、`risk`、`judgment` 全部渲染为“当前目标”，导致内部 ID 成为第三条目标。

修改后行为：后端从内容包对象名称编译玩家可读的 `judgment`，不再把知识引用暴露在玩家 Projection；前端“当前目标”只显示 `goal` 与 `risk`。

失败归属：内部 ID 出现在 API Projection 归后端 Viewer Projection；非目标字段出现在“当前目标”归前端 Pressure View Adapter。

聚焦测试：

- 浙江巡抚席位的私有 Projection 不含 `P0-SF-*`、`obj.*`；
- `judgment` 使用已发布对象中文名称；
- `/game` 当前目标包含目标与风险，不包含 judgment 或内部引用；
- 保留既有角色、资源、指标和决策映射回归。

真实验收方式：在真实 `/game` 使用浙江巡抚席位，确认“当前目标”只剩两条玩家可读文本，并检查页面没有 `P0-SF-` 或 `obj.`。

玩家参与节点：进入 `/game` 后左栏“当前目标”。

回滚方式：回滚本模块单一提交；不涉及数据迁移或持久化回滚。
