# Repair Log

## D2 候选初审（REPAIR_REQUIRED）

- 仅内存 shadow kernel，未接既有权威持久化链。
- 客户端可写内部 effect/statePatch；非法 slot/authority/knowledge audience 可绕过。
- fingerprint/actionId/dedupeKey 身份与幂等缺陷。
- deadline/default/conflict 两套排序与六席 invariant 缺陷。
- custody/version、destroy 与同节点 acquire→destroy 缺陷。
- Frozen 后续可改写且 replay 不复验 hash；恢复只覆盖 phase 字符串。
- D2 提前产生 Finale/COMPLETED；生产自由文本使用故事关键词正则。

修复 bundle 正由 ChatGPT Pro 生成；Codex 将只接收最小完整修复并独立验收。
