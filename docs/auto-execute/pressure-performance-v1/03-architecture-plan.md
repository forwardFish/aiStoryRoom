# 架构计划

```text
HTTP request
  -> DecisionSubmitSnapshotV1 (一次权威读取)
  -> 内存校验与玩家动作编译
  -> AI 并行准备 + 固定席位顺序规范化
  -> CommitPlanV1
  -> 单次短事务：事件链 + runtime CAS + durable outbox
  -> 直接返回下一可玩投影
```

关键约束：快读只服务普通在线决策；恢复、审计、修复和回放继续使用事件重放。任何 shadow 差异立即停用快读。内容缓存按 `contentHash`，决策缓存按 `routeHash`，均只缓存确定性输入/输出，不缓存权威运行时状态。
