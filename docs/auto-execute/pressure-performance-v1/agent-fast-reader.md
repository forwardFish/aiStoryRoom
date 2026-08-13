# Fast Reader 诊断记录

- Agent: `019ff9ac-4381-76c2-bf79-7efd370baa69`
- 方式: 只读架构审计
- 审计时结论: W5 正常读取仍经 `StoryEvent` 全量重放；缺少投影缓存严格解码、shadow compare 和统一提交快照。
- 主要风险: 普通提交的权限、revision、head、fence 与幂等校验分散在多个读取包络中；调查动作仍可能触发完整 `game.read()`。
- 建议测试: cache 字段/hash/revision/head 失配；shadow compare 失配闭锁；跨房间、过期 revision/head/fence、幂等复用。

本轮已据此加入严格投影缓存解码、FAST/SHADOW/REPLAY 选择器，并让普通 chapter/compiler 与 AI convergence snapshot 使用缓存投影。恢复、审计和 Beat 路径仍保留事件重放。统一 `DecisionSubmitSnapshotV1` 与调查动作的剩余读取继续列为未关闭项，不能据此宣称完整规范 PASS。
