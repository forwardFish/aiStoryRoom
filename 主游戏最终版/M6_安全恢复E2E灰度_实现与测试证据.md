# Our Many Worlds A-Emotion：M6 安全、恢复、E2E 与灰度实现及测试证据

> 阶段：M6 源码候选
> 逻辑父阶段：M5 `feat(a-emotion): add M5 stage milestones`
> 当前性质：产品源码与可执行门禁已经编写；完整依赖、真实非生产 Supabase、三浏览器 E2E 与最终远程验收仍由 Codex 在精确链式树上执行。本文不声明 Codex PASS、远程提交、部署或公共 Supabase migration。

## 1. 范围

M6 只完成 M1—M5 的安全与恢复收口：

- 房间创建时冻结 A-Emotion 能力、规则版本与轮询间隔；
- 旧房间、Solo、其他世界和 malformed snapshot fail-closed；
- Feed、Key Modal、Promise、Milestone 和历史能力可独立关闭；
- 暂停/恢复不删除 canonical event、指标、Promise 或 Milestone；
- Outbox 对过期 lease、deadline、retry budget、dead-letter 和 pause race 进行确定性处理；
- crash-before-commit 由 lease recovery 重试，crash-after-commit 由 dedupe/unique 约束保持幂等；
- viewer-safe delivery 继续校验 room/run/user/role/projectionVersion/stateVersion；
- SSE 不可用时退回房间冻结的有界轮询；
- Feed 网络失败只在右栏“世界局势”显示降级状态，不清空最后一份安全投影，不改中央/顶部/主按钮或表单；
- 三角色、三会话、六窗口浏览器 harness 与真实非生产 Supabase 随机 schema 脚本已提供。

## 2. 权威与安全边界

### 2.1 房间冻结

`StoryRun.stateJson.aEmotionRuleset` 保存严格的：

```text
aEmotionEnabled
situationFeedEnabled
crossImpactCardEnabled
keyModalsEnabled
simplePromiseEnabled
interactionHistoryEnabled
recoveryEnabled
pollIntervalMs
frozenAt
rulesetVersion
```

运行中 M1—M6 gate 优先读取该冻结快照。环境变量仅用于新房间创建，不能改变现有房间规则。

### 2.2 暂停与回滚

- 只有房主可以 pause/resume；
- run version 使用 CAS；
- pause race 在 lease claim 前和执行前各校验一次；
- 因 pause 被重新排队的任务恢复 attempt，不消耗重试预算；
- resume 唤醒 pending A-Emotion tasks；
- rollback 关闭 UI/worker 能力，但保留 `aEmotionM1` 等权威状态和历史。

### 2.3 Delivery

- 暂停或 Feed flag 关闭时，不返回 A-Emotion viewer delivery；
- 普通非 A-Emotion delivery 和游标继续工作；
- HIDDEN/SUSPECTED/CONFIRMED 仍通过既有严格 validator；
- 失败不通过 CSS 隐藏秘密；浏览器从未获得 canonical/private payload。

## 3. Worker 恢复

M6 复用现有 `StoryTaskOutbox`：

```text
PENDING -> RUNNING (lease CAS)
RUNNING + expired lease -> PENDING / DEAD_LETTER
pause-before-claim -> 延后，不增加 attempt
pause-after-claim -> PENDING，attempt -1
retry/deadline exceeded -> FAILED + DEAD_LETTER
COMPLETED -> 永不重放
```

涵盖任务：

```text
INTERACTION_COMPILE_REQUESTED
A_EMOTION_M2_DISCLOSURE_COMPILE
A_EMOTION_M3_CRISIS_COMPILE
A_EMOTION_M4_PROMISE_COMPILE
A_EMOTION_M5_STAGE_MILESTONE_COMPILE
```

任务仍使用既有 `dedupeKey @unique`、leaseOwner、leaseVersion 和事务边界，不新增 M6 数据表。

## 4. Web 恢复

批准的可见改动仍限定于：

```text
右栏唯一模块：世界局势
关键弹窗：CRISIS / PROMISE_BROKEN / STAGE_VICTORY
```

网络/5xx：

- 保留现有 viewer-safe items；
- 在“世界局势”显示“世界局势暂未更新”；
- 保留主决策草稿、工作区草稿、焦点和右栏 scrollTop；
- 网络恢复后按 `eventId + projectionVersion` 合并。

安全/Schema/4xx：

- fail-closed；
- 不打开详情；
- 不伪造 receipt；
- 不把不一致当作网络降级成功。

## 5. 新增测试与脚本

### 5.1 Shared / Config

- Frozen flags 严格 exact-key；
- capability dependency；
- recovery policy 范围；
- room/run/user/role/version boundary；
- pause/viewer state；
- old/malformed room fail-closed；
- frozen snapshot 不受后续环境变化影响。

### 5.2 Service / HTTP

- deterministic lease recovery 与 dead-letter；
- completed task 不重放；
- legacy room 保留旧恢复；
- pause/resume/version CAS；
- owner 与 member 权限；
- worker pause-before-claim 与 pause-after-claim retry budget；
- 生产 AuthGuard、RoomsController、RoomsService 路径。

### 5.3 Web

- 网络失败保留草稿、焦点和 scrollTop；
- 降级信息只在“世界局势”；
- SSE -> poll fallback；
- refresh 不重叠；
- 20 次刷新仍只有一个 right-rail module，DOM 最多 10 条；
- desktop 与 390px 只采证，不增加未经批准的移动布局。

### 5.4 最终环境脚本

- `scripts/e2e/a-emotion-m6-three-role-harness.mts`
  - 三个真实浏览器上下文与三个不同角色；
  - 同一真实房间和六个场景窗口；
  - `A_EMOTION_M6_SCENARIO_JSON` 提供每个窗口的真实 decision/maneuver 操作，不在 harness 内写世界专用关键词；
  - 真实 `/game` 与生产 HTTP；
  - 网络 JSON 递归扫描 canonical/private/source/dedupe 字段；
  - refresh/reconnect 后草稿、焦点和右栏约束；
  - desktop 验收及 390px evidence-only 检查，不实现未经批准的移动布局。
- `scripts/acceptance/a-emotion-m6-supabase-random-schema.mts`
  - 仅接受显式非生产 Supabase URL；
  - 唯一随机 schema；
  - Prisma db push；
  - M1—M6 DB 门禁；
  - 数据库读回；
  - `finally DROP SCHEMA CASCADE`；
  - schema absence 证明。

## 6. 作者侧实际运行

```text
git diff --check                                      PASS
node --check a-emotion-m1-ui.js                       PASS
node --check continuous-story-v2-client.js            PASS
node --check M6 Web tests                              PASS
Shared M6 focused contract tests                      5/5 PASS
M6 Config focused tests                               5/5 PASS
TypeScript parser on changed TS files                 0 syntax diagnostics
JSON parse                                            PASS
```

上述 TypeScript parser 与 Node experimental type stripping 不是正式仓库 typecheck，也不替代 Codex 的 pnpm/Prisma/Supabase 门禁。

## 7. 未运行

作者环境没有锁定 pnpm runtime、`node_modules`、generated Prisma Client、jsdom、Playwright 或非生产 Supabase URL，因此以下为 `NOT_RUN`：

```text
pnpm install --frozen-lockfile
pnpm db:generate
Shared/API/Web 正式 typecheck
API/Web build
API 全量测试
Web 全量测试
Generic Endgame S1-S6
OpenNovel Runtime
真实非生产 Supabase 随机 schema
三浏览器六窗口 E2E
```

## 8. 禁止声明

```text
CODEX_PASS_CLAIMED=NO
REMOTE_COMMIT_CLAIMED=NO
PUSH_CLAIMED=NO
DEPLOYED=NO
PUBLIC_SUPABASE_MIGRATED=NO
```


## 99585c7 精确远程基线重放说明

- `baseRemoteSha`: `99585c7a3fe85321bf2f339baba8aa08f2b2be46`
- `baseRemoteTreeSha`: `a765918caf2c0eecdb79249d45ed0a6873b237af`
- 本阶段逻辑父提交：`e67f5194209114de420be33525b404df0fbbaeb4`
- 已保留 23cd 之后的 Generic Endgame S6、最终故事文本生成、四轮验收和 OpenNovel 终局叙事改动。
- 远程并发重叠的 `package.json`、`apps/web/package.json`、`packages/shared/package.json` 均采用脚本级语义合并；未覆盖 Endgame/OpenNovel 既有门禁。
- 本报告中的运行门禁仅区分原候选作者检查与 Codex 历史证据；本次 99585c7 重放没有冒充新的 Codex 或真实 Supabase 验收。
- UI owner scope：`/game` 唯一新增常驻可见区域仍为右栏标题精确为“世界局势”的模块；只允许文档批准的关键模态。
