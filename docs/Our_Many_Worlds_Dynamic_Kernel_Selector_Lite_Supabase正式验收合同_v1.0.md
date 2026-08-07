# Our Many Worlds — Dynamic Kernel Selector Lite
## Supabase 正式验收合同

**版本：** v1.0  
**日期：** 2026-08-07  
**开发分支：** `codex/chatgpt-pro-dynamic-kernel-lite`  
**基线：** `main@dc4a7cd10978fc3662edcb6f2cf3445c1393ddb0`

---

# 1. 缺陷与裁决

此前分支 Gate 将纯函数、文件系统运行时和本地集成结果汇总为一个候选状态，但这些证据没有连接项目现有 Supabase，不能证明以下产品合同：

```text
数据库写入
Story Run / Room 创建
回合提交
状态持久化
重复请求幂等
原子提交
刷新恢复
真实页面流程
```

正式裁决：

> 以上任何项目只有在项目现有 Supabase 的既有隔离验收 Schema 中通过，才能记为正式 PASS。本地 PostgreSQL、Docker PostgreSQL、Mock DB、内存 Map 和文件系统 Runtime 只能记为 `AUXILIARY_ONLY`。

纯 TypeScript 类型检查、纯函数单元测试、世界无关性和 Outcome Signature 测试仍可在本地运行，但不能单独产生产品通过结论。

---

# 2. 数据安全边界

正式 Supabase 验收必须同时满足：

```text
FORMAL_ACCEPTANCE=true
DATABASE_TARGET=external
MVP_STORY_STORAGE=prisma
NODE_ENV=test
ACCEPTANCE_ALLOW_SYNTHETIC_WRITES=true
ACCEPTANCE_ALLOW_MIGRATIONS=false
```

数据库必须：

- 是 `*.supabase.co` 或 `*.supabase.com`；
- 匹配批准的 Supabase Project Ref；
- 使用已经存在的 `cs_accept_*`、`dk_accept_*` 或 `omw_accept_*` 隔离 Schema；
- 明确声明该 Schema 只包含验收合成数据；
- 禁止使用 `public` Schema；
- 不执行 migration、`prisma db push`、reset 或 seed；
- 不修改 Supabase、Railway、Vercel 或线上环境配置；
- 不查询、修改或删除真实用户数据。

若隔离 Schema 尚未具备当前 Prisma 所需表，验收结果必须是：

```text
BLOCKED
```

不得在本任务中迁移或补建 Schema。

---

# 3. 合成数据与清理

每次正式验收使用唯一命名空间：

```text
omw-dkl-<workflow-run-id>-<attempt>
```

浏览器注册邮箱必须是：

```text
<namespace>-<purpose>-<timestamp>@example.test
```

现有 V4 数据库 Smoke 使用的邮箱通过精确报告文件名反推出完整地址。

清理只能查询和删除：

1. 本次记录下来的精确合成邮箱；
2. 当前命名空间前缀且以 `@example.test` 结尾的邮箱；
3. 当前命名空间前缀的 Mock OpenID。

额外约束：

```text
最多 25 个匹配用户
任何不满足合成标识的记录都使清理 Fail Closed
删除依赖现有 Cascade
不得扫描或批量删除真实用户
```

---

# 4. 两层证据模型

## 4.1 Auxiliary Gates

工作流：

```text
.github/workflows/dynamic-kernel-lite-gates.yml
```

状态上下文：

```text
dynamic-kernel-lite/auxiliary-gates
```

只证明：

- 类型正确；
- 纯函数与 Runtime Contract 正确；
- Dynamic Selector 稳定；
- 文件系统恢复和 G00—T20 确定性模拟没有代码级回归；
- 模型调用链的辅助测试。

其结构化报告必须包含：

```json
{
  "evidenceClass": "AUXILIARY_ONLY",
  "databaseBacked": false,
  "productAcceptanceEligible": false,
  "formalSupabaseGateRequired": true
}
```

即使全部绿色，也不得声明产品通过。

## 4.2 Supabase Formal Acceptance

工作流：

```text
.github/workflows/dynamic-kernel-lite-supabase-formal.yml
```

状态上下文：

```text
dynamic-kernel-lite/supabase-formal
```

正式覆盖：

1. 通过真实 API 创建合成用户和 Solo OpenNovel Run；
2. 提交一个真实回合；
3. 使用同一 idempotency key 重放；
4. 从 Supabase 读取 StoryRun、PlayerAction、SceneNode 和 EventLog；
5. 确认只持久化一个 PlayerAction、一个 resolved SceneNode 和一个 commit event；
6. 用真实 Chrome 页面完成注册、角色选择、Run 创建、行动提交和继续；
7. 刷新页面后确认 Dynamic Kernel Affordance Surface 不漂移；
8. 再次从 Supabase 验证该页面提交的 Run、回合和原子事件；
9. 清理本次合成用户及其 Cascade 数据。

---

# 5. 新增实现

```text
scripts/acceptance/supabase-formal-acceptance.mjs
scripts/acceptance/verify-supabase-formal-acceptance.mjs
scripts/acceptance/run-dynamic-kernel-lite-supabase.mjs
scripts/acceptance/__tests__/supabase-formal-acceptance.spec.mjs
scripts/acceptance/__tests__/dynamic-kernel-supabase-gate-contract.spec.mjs
scripts/e2e/dynamic-kernel-lite-supabase-browser.mjs
.github/workflows/dynamic-kernel-lite-supabase-formal.yml
```

核心防线：

- Supabase Host／Project Ref／Schema 三重验证；
- 只读连接元数据和 information_schema 预检；
- 缺表时阻断，不迁移；
- 日志自动脱敏数据库 URL 和 API Key；
- 正式 Summary 明确记录是否连接数据库、是否覆盖幂等和原子提交、是否迁移、是否操作真实用户；
- 工作流静态扫描正式 Runner，拒绝 migration、db push、reset 和 seed 命令。

---

# 6. 正式 Summary 必须满足

```json
{
  "status": "PASS",
  "evidenceClass": "FORMAL_SUPABASE",
  "formalAcceptanceEligible": true,
  "databaseProvider": "SUPABASE",
  "databaseBacked": true,
  "runRoomTurnPersistenceCovered": true,
  "idempotencyCovered": true,
  "atomicCommitCovered": true,
  "realPageFlowCovered": true,
  "migrationsExecuted": false,
  "onlineConfigurationModified": false,
  "realUserDataAccessed": false
}
```

还必须存在并通过：

```text
04-supabase-run-turn-idempotency
05-supabase-real-page-flow
cleanupEvidence.status == PASS
```

缺少安全 Secret、隔离 Schema 或 Chrome 时只能是：

```text
BLOCKED
```

不得降级到本地 PostgreSQL 后继续宣称正式通过。

---

# 7. 仍然需要独立执行的证据

代码已经建立正式 Supabase Gate，但当前提交环境没有访问项目 Supabase Secret，也没有被授权修改线上配置。因此本次修复不会声称已经完成正式产品验收。

只有真实 Workflow 或仓库所有者的隔离执行环境产生以下证据后，才能改变状态：

```text
Auxiliary Gate: PASS
Supabase Formal Gate: PASS
Real-model G00—T20: PASS（单独模型质量门）
玩家质量验收: PASS
```

在此之前：

```text
CODE_COMPLETE_PENDING_SUPABASE_FORMAL_EXECUTION
```

不得输出：

```text
CANDIDATE_BRANCH_READY
```
