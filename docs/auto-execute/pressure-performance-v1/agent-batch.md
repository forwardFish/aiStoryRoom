# AI Batch 诊断记录

- Agent: `019ff9ac-4d5e-7ec2-b436-862fa92103e1`
- 方式: 只读架构审计
- 审计时阻断项:
  - 编译后按 seatId 字典序重排，丢失冻结 route 顺序；
  - `batchHash` 生成但提交端不复算；
  - 批量写事务内仍读取并重放整条 Ledger；
  - action batch 与后续 `runtime.resume()` 仍是两个提交边界；
  - durable outbox、direct playable receipt 尚未进入同一权威事务。

本轮已修复前三项：批次固定 route 席位顺序、提交端复算 hash 并拒绝篡改、批量写直接从权威 runtime cache 增量生成和投影事件。后面三项仍是完整规范的开放项，需以本轮真实 after 测量决定是否在剩余时间继续扩展，不能把“AI 五席一事务”等同于端到端原子 PASS。
