# B0 FORMAL SUPABASE ACCEPTANCE HANDOFF

> **USER_TEST_READY 已撤销。** 本文件替代此前基于本地 PostgreSQL、自托管 Supabase/Postgres 容器或 Ollama 工程辅助结果形成的测试交接。那些结果仅可用于工程诊断，不能作为产品功能完成、用户正式测试、C8、C9 或候选分支可交付的依据。

## 1. 当前权威状态

| 字段 | 当前值 |
|---|---|
| Repository | `forwardFish/aiStoryRoom` |
| Remote branch | `codex/chatgpt-pro-maneuver-evidence-v1` |
| 撤销前远程 tip | `9c8297dacfc00d59b58ddd48d15834b2862983c5` |
| Remote main baseline | `86da64eea18ab773312f40c7024ace9cb393344a` |
| 正式托管非生产 Supabase 验收 | `NOT_EXECUTED` |
| USER_TEST_READY | `false` |
| candidateBranchReady | `false` |
| 当前分类 | `EXTERNAL_BLOCKED`，直到 formal C8 在真实托管非生产 Supabase 与真实 Provider 上通过 |

不得再把以下结果写成 USER_TEST_READY、C8/C9 PASS 或产品完成：

- 普通 PostgreSQL；
- Docker PostgreSQL；
- 自托管 `supabase/postgres`；
- SQLite、mock、fixture、stub 或内存数据库；
- Ollama、本地确定性 Provider 或 fallback；
- HTTP 200、工作流存在、截图存在或本地附件存在。

正式用户测试只能以同一精确远程 SHA 上的 `b0/formal-c8 = success`、版本化正式证据和远程 fresh-clone 回读为起点。

## 2. 正式验收唯一允许的数据库与 Provider

正式验收数据库必须是**现有真实托管非生产 Supabase 项目**。工作流必须：

1. 对 `public` Schema 做测试前只读指纹回读；
2. 创建随机隔离 Schema；
3. 只在随机 Schema 内执行 Prisma migration、seed、API/Web/Worker 与六窗口验收；
4. 证明 `public` 未发生应用写入；
5. 删除随机 Schema；
6. 回读证明随机 Schema 已不存在且 `public` 指纹未改变。

正式 Provider 必须是真实外部 Provider；当前工作流要求 DeepSeek，并禁止 deterministic provider 与 fallback。

## 3. 只读探测的 GitHub Environments

工作流只读检查以下明确非生产 Environment，不打印任何凭据值：

- `ourmanyworlds.com / test`
- `stellar-encouragement / test`
- `Preview`

同一个 Environment 中必须同时存在至少一个数据库 Secret 别名和至少一个 Provider Secret 别名。

### 可接受的托管 Supabase 数据库 Secret 名称

- `SUPABASE_DATABASE_URL`
- `TEST_DATABASE_URL`
- `SUPABASE_TEST_DATABASE_URL`
- `TEST_SUPABASE_DATABASE_URL`
- `DATABASE_URL_TEST`
- `PREVIEW_DATABASE_URL`
- `STAGING_DATABASE_URL`

数据库 Secret 的值必须指向真实托管的非生产 Supabase PostgreSQL，并具备创建、使用和删除随机测试 Schema 的权限。不得把 production `public` Schema 配置为测试 Schema。

### 可接受的真实 Provider Secret 名称

- `DEEPSEEK_API_KEY`
- `OPENOVEL_DEEPSEEK_API_KEY`
- `LLM_API_KEY`
- `AI_API_KEY`

Provider Secret 必须能真实调用正式验收指定模型；不得使用本地 Ollama、mock、确定性 provider 或 fallback。

## 4. 安全配置与授权边界

本任务不会创建 Supabase 项目，不会修改 GitHub Environment、Repository Secret 或线上配置，也不会要求在聊天中发送数据库 URL、Token、Cookie、密码或验证码。

如果只读探测仍找不到完整组合，需要仓库管理员在 GitHub 中进入：

```text
Repository Settings
→ Environments
→ 选择上述一个明确非生产 Environment
→ Environment secrets
```

在**同一个 Environment** 内补齐一个数据库 Secret 和一个 Provider Secret。若需要创建新 Supabase 项目、添加或修改 Secret，必须先取得用户明确授权，并在 GitHub/Supabase 的安全配置界面完成；不得把值粘贴到聊天、Git 或证据文件。

## 5. 安全触发方式

本次文档修正会触发：

```text
B0 Candidate Engineering and Formal Supabase Acceptance
```

工作流先检查 Secret 名称和存在性：

- 若完整组合存在，才会在精确远程 SHA 上运行真实托管 Supabase + DeepSeek formal C8；
- 若不完整，必须生成脱敏 blocker，设置 `b0/formal-c8 = failure`，并保持 `candidateBranchReady=false`。

管理员在安全界面补齐 Secret 后，不需要再改产品代码，可在 GitHub Actions 中对本次最新验收运行选择 **Re-run all jobs**。重新运行会在相同精确 SHA 上重新读取 Environment Secrets；通过后才允许生成新的版本化 C8/C9 正式证据链。

## 6. 正式验收覆盖范围

真实托管 Supabase formal C8 必须同时覆盖并全部 PASS：

- 三角色、三隔离浏览器会话、六个同步 Window；
- 同步 maneuver 提交、冻结、结算与唯一 successor；
- 私密信息隔离、Typed Audience 与跨角色隐私；
- Settlement、Commit、Publication、Confirm、Outbox 重放幂等；
- Narrative 成功、失败不回滚及重试；
- embedded Worker 与独立 Worker；
- pause/resume、deadline、lease；
- Worker/API 崩溃恢复、AI draft 恢复和正确 successor；
- 桌面与 390px `/game` 可操作；
- 真实迁移、seed、数据库读回、随机 Schema 清理和 `public` 隔离；
- 真实 Provider 请求、禁止 fallback；
- 脱敏扫描、文件大小、SHA-256、docs-only evidence commit 和精确 SHA fresh-clone 回读。

## 7. 完成条件

只有以下事实同时成立，才能恢复 USER_TEST_READY 或候选交付声明：

```text
b0/formal-c8 = success
真实托管非生产 Supabase 随机 Schema 验收 = PASS
真实 Provider 验收 = PASS
正式 C8/C9 版本化证据已推送
远程 tip 与 finalRemoteSha 一致
testedCodeSha..finalRemoteSha 仅包含允许的证据路径
Linux/Windows fresh-clone 证据哈希一致
candidateBranchReady = true
```

在此之前，唯一准确结论是：

```text
ENGINEERING_AUXILIARY_VERIFIED
FORMAL_SUPABASE_ACCEPTANCE_NOT_EXECUTED_OR_EXTERNAL_BLOCKED
USER_TEST_READY=false
candidateBranchReady=false
```

权限边界保持不变：不创建或操作 PR，不 force push，不修改 `main`/`release`，不部署，不访问生产数据库、生产配置或真实用户数据。
