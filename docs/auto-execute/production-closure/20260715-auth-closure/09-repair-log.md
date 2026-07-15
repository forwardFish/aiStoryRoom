# 修复日志

## 2026-07-15 A0

- 发现：`pnpm --filter @apps/web test` 在 `browser-smoke.test.mjs` 超时。
- 原因：测试把流式延迟倍率设为 `0`，但 UI 仍按每字符零延迟 timer 逐个调度，十二策测试消耗大量 event-loop tick；入口断言仍指向已迁移的 `app.js`。
- 修复：仅当测试倍率严格为 `0` 时同步完成 stream；生产默认倍率不变。将入口断言改为 `game-bootstrap.js`。
- 证据：Web 测试 30/30 PASS，`browser-smoke` 10/10 PASS。
- 环境：普通 `pnpm db:generate` 因用户正在运行的 `@apps/api dev` 锁定 `query_engine-windows.dll.node` 失败；`PRISMA_GENERATE_NO_ENGINE=1 pnpm db:generate` PASS。未终止用户进程。
