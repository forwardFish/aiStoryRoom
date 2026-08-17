# RoomLobby WebSocket 真实环境验收豁免与合并说明 v1.0

- 日期：2026-08-17
- 候选分支：`codex/chatgpt-pro-room-lobby-websocket-v2`
- 合并目标基线：`main @ 06112af26458c2dc415dc7c21240f95a556cded8`
- 授权范围：允许在本地和确定性测试通过后合并代码；不授权部署、迁移、生产配置或宣称生产验收通过。

## 已通过的合并前证据

- Web 大厅、实时客户端和 Upgrade 代理组合测试：54/54 PASS。
- API 认证、事件合同、Gateway、Realtime Bus 和发布端口组合测试：60/60 PASS。
- Ready/Start 权威投影集成测试：1/1 PASS。
- `pnpm --filter @apps/api typecheck`：PASS。
- `pnpm --filter @apps/web typecheck`：PASS。
- `pnpm test:deploy-config`：PASS。
- `pnpm build:api`：PASS。
- 候选提交已经无冲突重放到实时远程 `main`。

## 明确豁免的真实环境验收

以下任务书第 14.4、14.5 项在本次代码合并前标记为 `TESTS_NOT_RUN`：

1. 同一测试 Supabase 上的两个独立 API 进程跨实例传播。
2. 两个隔离浏览器和两个已验证账号的真实 Join、选角、Ready、Start 流程。
3. 强制断开 Socket 后的 30 秒真实页面兜底与网络恢复。

原因：现有非生产配置没有 `SUPABASE_SERVICE_ROLE_KEY`，无法启用服务端私有 Realtime 主题；当前 `main` 的完整 AppModule 启动还会被既有的
`SANGTIAN_ACTION_RELEASE_ARTIFACT_HASH_MISMATCH` 阻塞。本候选未修改对应桑田发布包。

## 豁免边界

- 本豁免只允许代码进入 `main`，不把 `PASS_WITH_LIMITATION` 提升为生产验收 `PASS`。
- 部署到测试或生产环境前，必须补齐服务端 Realtime 凭据并执行任务书第 14.4、14.5 的真实验收。
- 真实验收失败时必须关闭 `ROOM_LOBBY_REALTIME_ENABLED` 或 `ROOM_LOBBY_SOCKET_ENABLED`，保留 30 秒权威 GET 兜底，并停止上线。
- 不得在浏览器、日志、截图或验收报告中公开 Cookie、Token、service-role key 或完整私密房间投影。

## 当前结论

代码合并结论：`PASS_WITH_LIMITATION / MERGE_WAIVER_GRANTED`。

部署和生产上线结论：`NOT_AUTHORIZED / TESTS_NOT_RUN`。
