# 架构与并行边界

```text
Pressure package (authorial content)
  -> D2 deterministic authority (validation, settlement, ledger, frozen, recovery)
  -> D3 derived orchestration (context projection, 5 AI/NPC, four-beat scene brief, narrator guard/fallback, finale)
  -> D4 viewer-safe projection and existing /game three-column renderer
```

- D2 是唯一可写事实源；D3/D4 不复制 Settlement、custody、knowledge 或胜负。
- D3 `NarrativeSceneBriefV1` 是派生、非权威值；不写入新的 root StoryEvent。
- D4 的 `latestActionFeedback` 来自结构化投影，前端不得从 prose 猜测时间/压力/资源/对象变化。
- D2 未完成时，D3/D4 只对 v1.1.0 冻结合同和确定性 fixtures 开发；最终 PASS 必须替换为真实服务路径。
- 同一批准分支只由 Orchestrator 集成；并行实现者不提交、不推送、不改彼此路径。
