# C-2 verified Web findings

先纠正上一条：C-1 源码 UTF-8 是正确的。PowerShell `-Encoding UTF8`、Node `fs.readFileSync(..., 'utf8')`、.NET 严格 UTF-8 三种独立检查均能读取“我的角色”“世界事件”，且不存在 `鎴戠殑`。先前乱码只是 PowerShell 默认编码显示。不要重写正确中文；保留 UTF-8 负测即可。

独立 Web 审查已经定位以下真实问题，请在继续 C-2 时一并修复：

1. **P0 部署回归**：C-1 的 `scripts/deploy/prepare-vercel-web-assets.mjs` 把现有约 85 行的素材复制和 `apps/web/dist-vercel` 生成流程替换成仅写 source runtime-config 的 9 行脚本。`vercel.json` 仍指定 `apps/web/dist-vercel`，Web build 仍是 no-op。必须保留当前仓库完整 deploy 脚本，只在它最终写入 `dist-vercel/runtime-config.js` 时增加 allowlist；现有 `deployment-routes.test.mjs` 必须通过。

2. **P0 live 假门禁**：`scripts/e2e/openovel-mp-live.mjs` opt-in 后只打印一句话，没有请求。不能作为 live；要么实现真实隔离环境请求/旅程，要么明确 NOT RUN，不得 PASS。

3. **P1 自由输入不能提交**：`apps/web/public/app.js` 当前仍在 `options.length === 0` 时禁用 Submit。C-1 只断言 textarea enabled。修复为有 trimmed custom input 时可提交，并断言按钮、点击、请求体。

4. **P1 Role Chrome 会消失**：wrapper 只在 boot/显式 refresh 后挂载；submit/maneuver/handoff/reclaim 直接转发。开场/结果流或根节点重渲染会删除 chrome。把状态面板接入真实 render 生命周期或使用有界、无自触发的 remount 机制；测试 stream tick、submit、control mutation 后只存在一个 chrome。

5. **P1 SSE 文案不真实**：specialized client 只有 1.5 秒 polling + heartbeat，没有 EventSource/SSE 消费。实现真实 SSE 恢复，或把文案与测试改成诚实的 polling recovery，不得声称从 SSE 序列恢复。

6. **P1 Interaction 只能第一条**：当前 storage 总取 `pendingInteractions[0]`，chrome 只显示数量。必须渲染/选择每条安全 interaction，绑定正确 interactionId；只有 TARGET 有 responseOptions，自由输入仍可用。

7. **P1 隐私守卫不是严格安全映射**：黑名单遗漏 privateReasoningSummary、hiddenMeaning/hiddenFacts、otherRoleSecret、modelInput/output、stateDelta 等；又会把合法玩家 prompt 键误杀。不要把整个 pendingImpacts JSON 写进 DOM signature。服务端和客户端都改为显式安全字段映射，signature 只含 id/status/sequence；原始网络响应也需负向扫描。

8. **P1 flag 漂移**：浏览器 allowlist 缺失时当前会静默退回普通 V2。应该 fail closed 显示明确配置错误，或证明后端已对测试房间精确 gate 后只信任 exact engine/runtime；禁止静默降级。

9. **测试仍是假链**：offline Map、静态 fixture server、内嵌 toy HTML browser、源码 regex contract 都不能作为产品 PASS。按上一条要求替换为真实模块/服务/DB/`/game`/三个 Chrome Context；环境不足就 NOT RUN/FAIL。

继续实施已确认的 API impact receipt/乱序/知识投影底层修复，同时修正以上 Web 根问题。不要再保留 C-1 自报 COMPLETE 的假设。
