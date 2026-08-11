# M3 危险线与 CRISIS：实现与测试证据

## 范围

M3 在 M2 Repair5 之后增加世界无关的 `MetricThresholdRule`、持久 `MetricTransition`、确定性的危险区 crossing、viewer-safe CRISIS Feed 投影和一次性关键弹窗。

## 权威链路

```text
已提交 ActionResolution 中的权威指标变化
→ 同事务 AEmotionMetricTransition
→ 非 DANGER → DANGER 时创建唯一 triggerVersion 与 outbox
→ worker 生成 viewer-safe CRISIS EventDelivery
→ 同事务写 viewer-scoped AEmotionKeyModal
→ /events 返回世界局势和待展示 modal
→ shown / acknowledged 持久化且幂等
```

23→18 触发一次；18→16 不重复；18→25 离开危险；25→18 使用下一个 triggerVersion。没有模型推断阈值、来源或 audience。

## UI 权限

主页面只沿用右栏标题精确为“世界局势”的模块。M3 没有新增顶部提示、中央卡、主按钮或表单改动。唯一新增可见能力是文档允许的 CRISIS 模态，`aria-live=assertive`，关闭后恢复原工作区草稿和焦点；覆盖桌面和 390px。

## 安全

CRISIS viewer projection 不包含 sourceRole、raw action、raw audience、dedupeKey 或 canonical payload。modal/eventId 不透明，room/run/user/role/version 均由服务端会话身份绑定。

## 作者环境

静态语法、Patch apply、diff-check 和范围扫描由 Artifact 生成流程记录。真实隔离 Supabase/PostgreSQL、Nest HTTP、Prisma、完整 typecheck/build 需要 Codex 在可执行环境运行；作者未声称这些门禁通过。


## 99585c7 精确远程基线重放说明

- `baseRemoteSha`: `99585c7a3fe85321bf2f339baba8aa08f2b2be46`
- `baseRemoteTreeSha`: `a765918caf2c0eecdb79249d45ed0a6873b237af`
- 本阶段逻辑父提交：`49a4802182eea2053ee3f163b0e868fcf42fd7e5`
- 已保留 23cd 之后的 Generic Endgame S6、最终故事文本生成、四轮验收和 OpenNovel 终局叙事改动。
- 远程并发重叠的 `package.json`、`apps/web/package.json`、`packages/shared/package.json` 均采用脚本级语义合并；未覆盖 Endgame/OpenNovel 既有门禁。
- 本报告中的运行门禁仅区分原候选作者检查与 Codex 历史证据；本次 99585c7 重放没有冒充新的 Codex 或真实 Supabase 验收。
- UI owner scope：`/game` 唯一新增常驻可见区域仍为右栏标题精确为“世界局势”的模块；只允许文档批准的关键模态。
