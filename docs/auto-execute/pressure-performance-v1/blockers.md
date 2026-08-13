# Blockers and Limitations

## 当前硬门

无代码或功能阻断。数据库访问减少、功能正确性、权威边界和禁改范围均达到本轮要求。

## 明确限制

- 成功性能样本的完整原始 metrics 日志未纳入候选；只保留了去敏汇总记录。
- P3.1 只有真实功能 `PASS_CLEANED` 与定向零重复读取测试，没有真实 SQL 总数。
- 未运行循环压测，不能给出 p50/p95，也不报告时延 SLO PASS。
- Fast Reader 默认保持 `REPLAY`；真实 SHADOW parity 与旧 cache 迁移另立阶段。
- ChatGPT Pro 网页委派没有返回可靠代码或验收产物，不计入交付证据。
