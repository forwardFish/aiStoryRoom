# ChatGPT Pro Batch C-2 correction prompt

C-2 修正：C-1 不能按 COMPLETE 接受。独立源码审计已经复现以下 P0/P1，请继续在当前 C-1 工作区修复并重新交付；不能只解释。

## P0-1：OpenNovel impact 仍未发布到玩家时间线

`apps/api/src/continuous-story-v2/continuous-story-v2.service.ts` 的 OpenNovel 分支在 `runtime.syncImpacts(...)` 后仍只更新 ActorThread/ActorTurn context 并直接返回，没有创建目标角色私有的 `V2_CROSS_IMPACT` 或 `V2_OBSERVABLE_TRACE`。`game()` 的 timeline 只读 NarrativeEntry，所以 sync 后玩家仍看不到“其他行动改变了你的处境”。

修复要求：

- 在持有同一 `ACTOR_IMPACT_V2` lease/fence 的 DB transaction 内，幂等发布目标角色限定的 NarrativeEntry；FULL 使用 `V2_CROSS_IMPACT`，TRACE 使用 `V2_OBSERVABLE_TRACE`。
- dedupe 必须是 `v2-impact:<playerActionId>:<targetRoleId>`（或等价唯一约束），崩溃重试不得重复发布。
- 只能使用已为目标角色裁剪的 `impactSeed`，不得写入完整 action/resultJson/provider/prompt/statePatch。
- 增加 PENDING -> RUNNING/SYNCING -> published CROSS_IMPACT 的真实生命周期测试，以及 crash-after-runtime-before-DB-commit、重试、去重测试。

## P0-2：C-1 pendingImpacts 查询键错误，且 cursor 会吞掉低序列 impact

`enqueueImpactTask()` 把 `StoryTaskOutbox.inputRefId` 写成 `playerActionId`，但 C-1 的 `game()` 用这些值查询 `ActionResolution.id`，因此 `pendingImpactResolutions` 实际为空，pendingImpacts 会被静默丢弃。

此外 ActorThread.lastAppliedSequence 不是 per-impact receipt：角色自己的 seq3 result 也会把 cursor 提升到 3；若 seq2 impact 尚未同步，当前 `lastAppliedSequence > payload.appliedWorldSequence` 会拒绝 seq2，造成永久漏应用。

修复要求：

- Pending 查询必须按 `ActionResolution.playerActionId` 关联，只 select 安全字段；不得投影 resultJson、lastError、inputRefId、原行动内容。
- 状态至少区分 PENDING、SYNCING、RECOVERY_REQUIRED；FAILED 不能消失。
- 以 durable per-impact receipt（幂等 NarrativeEntry 或等价安全 receipt）证明单条 impact 已完成，不能用全局 cursor 代替。
- 角色 result/opening 不能越过同角色更低序列的未完成 impact；实现明确 gate/drain/order，增加“seq2 impact 未完成、seq3 own result 先到”的乱序回归，最终 seq2 必须恰好发布一次。

## P0-3：OBSERVABLE asset/commitment 对无关角色过度公开

C-1 仍使用：

- asset：owner 或 visibility in PUBLIC/OBSERVABLE；
- commitment：issuer/receiver 或 visibility in PUBLIC/OBSERVABLE。

这违反当前 `factAudience()` 的 bounded/fail-closed 规则。没有可靠 scene audience 时，OBSERVABLE 不能自动等于全房间可见。

修复要求：

- asset 默认只允许 owner 或 PUBLIC；
- commitment 默认只允许 issuer、receiver 或 PUBLIC；
- 若要公开 OBSERVABLE，必须有持久化的明确 audience 证据，不能推测。
- 增加第三个无关角色对 OBSERVABLE/LIMITED/PRIVATE asset 和 commitment 的序列化响应负向测试。

## P1：补齐可信玩家状态

- 增加 secret-safe Role Canon/recovery 投影（至少明确生成、重试、影响恢复状态），不要暴露 hash、runtime warning、provider、lastError。
- pending interaction 同时支持 incoming/outgoing direction；只有 target 有 responseOptions。
- OpenNovel 与普通 Continuous V2/Solo 回归必须都通过。

## 交付与验证

- 保留 C-1 已修复的 engineVersion/runtimeMode、`__MANY_WORLDS_RUNTIME__`、allowlist fail-closed、Observer 稳定性、UTF-8、Web 隐私守卫、自由输入和三角色浏览器脚本。
- 不得修改 Runtime、Prisma、lockfile 或依赖。
- 新增 API 合同/乱序/崩溃窗口/隐私负测，必须能在完整仓库执行；不要只做源码字符串检查。
- 重新生成完整源码 ZIP、统一 diff、SHA-256、真实测试矩阵。
- 即使离线 fixture 通过，只要上述三项 P0 或真实 browser 仍未证明，就不得声称最终系统 COMPLETE；明确区分 batch artifact complete 与 repo final acceptance。

请现在直接实施 C-2。
