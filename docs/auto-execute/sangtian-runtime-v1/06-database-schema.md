# 存储与数据库边界

- MVP 不新增生产 migration。
- 复用既有 `StoryRun`、`PlayerAction`、`RoleAssetMutation`、`StoryEvent`、`ResolutionWorkflow`/checkpoint 与 AI task/outbox 结构；必要的新合同放在现有 JSON payload 中。
- D2 的纯规则状态不是产品权威存储；必须通过现有 Serializable transaction、账本与恢复链提交。
- `FrozenNodeResult` 写入后不可修改；projection 与 narrative 是派生记录。
- 所有数据库测试只使用本地/测试环境；禁止生产数据库。
