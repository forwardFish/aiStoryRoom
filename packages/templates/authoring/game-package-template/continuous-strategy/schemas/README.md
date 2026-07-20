# Schema 槽位

发布前，把当前连续策略版本使用的 9 个 Schema 放在这里，并将其中写死的 `contentVersion`、`templateKey` 和角色数量约束改成新游戏值：

```text
manifest.schema.json
stages.schema.json
role-stage-content.schema.json
maneuver-strategies.schema.json
reaction-scenarios.schema.json
system-actions.schema.json
agent-policies.schema.json
result-rules.schema.json
ending-rules.schema.json
strategy-registry.schema.json
```

当前完整参考位于：`packages/templates/config/sangtian/continuous-strategy-v1.2/schemas/`。
