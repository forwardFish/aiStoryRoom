# Native Subagent Orchestration

Orchestrator `/root` owns contracts, path assignment, integration, Git, gates and final claims.

当前只读映射：

- `parallel_d3_map`：D3 模块与接口落点。
- `parallel_d4_map`：D4 `/game` 与浏览器落点。
- `parallel_test_map`：专项测试与统一门禁落点。
- `parallel_architecture`：并行边界与集成顺序复核。

映射通过后再分配三个互斥写入 lane。所有实现者必须知道并行工作存在，不得撤销他人改动；实现者不提交、不推送，由 Orchestrator 逐路径集成。

已启动实现 lane：

- `d3_builder`：仅新增 `apps/openovel-runtime/src/sangtian-pressure-*.ts` 和 `apps/openovel-runtime/tests/sangtian-pressure-*.spec.ts`；不改 D2、Web、root package。
- `d4_builder`：仅修改 Web 的 pressure UI 模块、`app.js` 最小接线、CSS 和新 Web 测试；不改 API/OpenNovel/D2/root package。
