# M4 Promise 与承诺破裂：实现与测试证据

## 状态

本文件是源码作者交付证据，不声明 Codex 独立验收、远程提交、部署或公共 Supabase migration。

## 实现范围

M4 复用现有 `CommitmentV2` 作为唯一承诺权威，不建立第二套 Promise 数据源。新增结构化字段用于承载三个预设 promise code、确定性条款、状态版本、行动证据和一次性 reveal 事件。

允许的 promise code 仅有：

- `DELIVER_ORIGINAL_LEDGER`
- `DO_NOT_PUBLICLY_BLAME`
- `TESTIFY_FOR_TARGET`

普通聊天不会自动生成 Promise。正式承诺必须绑定已经 `PASS` 的 `CONVERSATION` ActionResolution、明确双方和服务端规则条款。生命周期只消费 canonical action/effect/fact codes，不读取或正则匹配用户文案。

## 权威链路

```text
生产 TurnDecisionCommandV2.simplePromise
→ committed CONVERSATION ActionResolution
→ CommitmentV2 ACTIVE
→ 后续 committed canonical codes
→ FULFILLED / BROKEN / EXPIRED
→ 独立权威证据 fact
→ REVEALED
→ A_EMOTION_M4_PROMISE_REVEAL_COMPILE outbox
→ viewer-safe EventDelivery
→ 右栏“世界局势”
→ document-approved PROMISE_BROKEN modal once
```

`BROKEN` 不等于 `REVEALED`。只有持久化 `CanonFact` 与预设 reveal evidence code 匹配后，才会进入 `REVEALED` 并为承诺接收方生成 delivery。私密承诺不会投递给无关角色。

## 安全边界

- 浏览器不接收 `termsJson`、canonical payload、sourceResolutionId、sourceActionId 或 dedupe key。
- M4 EventDelivery 是服务端 viewer-safe projection；公开 eventId 为 opaque id。
- 只有 active human receiver 获得 delivery；AI/无人目标不能创建正式承诺。
- room/run/user/role/state/projectionVersion 继续复用 M1/M2 fail-closed 边界。
- `CRISIS` priority 300，`PROMISE_BROKEN` priority 200；一次只展示最高优先 modal。
- UI 没有新增中央卡、顶部指标提示、第五个按钮或未批准表单。可见内容只进入右栏“世界局势”和批准弹窗。

## 数据库

提交 migration 源码 `20260810180000_a_emotion_m4_simple_promise`，只扩展已有 `CommitmentV2`：

- preset promise code / related object
- canonical source action
- fulfillment / breach action
- reveal evidence and timestamps
- deterministic lifecycle version
- one-promise-per-issuer/run slot key

禁止在本作者环境连接或迁移公共/生产 Supabase。

## 测试源码

- Shared strict schema：command、terms、viewer-safe lifecycle state。
- Config：默认关闭、M2 依赖、room freeze、exact engine gate。
- Service：canonical-code lifecycle、one-slot idempotency、BROKEN 与 REVEALED 分离、真实隔离 PostgreSQL fixture。
- HTTP：生产 AuthGuard → RoomsController → RoomsService → M4 service；创建/list/reveal/event/modal，第三角色无 delivery。
- DOM：真实 jsdom modal click、durable shown/ack、草稿和焦点恢复；ack stale 时 fail-closed。

数据库测试仅在 `A_EMOTION_M4_TEST_DATABASE_URL` 指向明确隔离测试库时运行；未配置时必须 SKIP，不得使用 mock 代替最终 DB 门禁。

## 作者门禁

最终 Manifest 记录所有实际执行命令、退出码和未运行原因。语法 parser 不等价于 typecheck；未执行的 pnpm、Prisma 和数据库门禁不会声明 PASS。


## 99585c7 精确远程基线重放说明

- `baseRemoteSha`: `99585c7a3fe85321bf2f339baba8aa08f2b2be46`
- `baseRemoteTreeSha`: `a765918caf2c0eecdb79249d45ed0a6873b237af`
- 本阶段逻辑父提交：`7a49b28befc3e8709a14ef10ecba1e6596db491e`
- 已保留 23cd 之后的 Generic Endgame S6、最终故事文本生成、四轮验收和 OpenNovel 终局叙事改动。
- 远程并发重叠的 `package.json`、`apps/web/package.json`、`packages/shared/package.json` 均采用脚本级语义合并；未覆盖 Endgame/OpenNovel 既有门禁。
- 本报告中的运行门禁仅区分原候选作者检查与 Codex 历史证据；本次 99585c7 重放没有冒充新的 Codex 或真实 Supabase 验收。
- UI owner scope：`/game` 唯一新增常驻可见区域仍为右栏标题精确为“世界局势”的模块；只允许文档批准的关键模态。
