# Our Many Worlds 测试/生产环境与部署说明

## 1. 采用的标准方案

本项目采用最常见、最容易维护的双环境方案：

| 项目 | 测试环境 | 生产环境 |
|---|---|---|
| Git 分支 | `staging` | `main` |
| Vercel 项目 | `ai-story-room-test` | `ai-story-room-prod` |
| Railway 项目 | `ai-story-room-test` | `ai-story-room-prod` |
| Supabase 项目 | `many-worlds-test` | `many-worlds-prod` |
| Creem | Test Mode | Live Mode |
| Web 域名 | `test.ourmanyworlds.com` | `ourmanyworlds.com` |
| API 域名 | `api-test.ourmanyworlds.com` | `api.ourmanyworlds.com` |

两个环境使用同一套代码，但数据库、密钥、支付产品、Webhook、邮件和 OAuth 客户端全部独立。不要通过修改同一个 Vercel/Railway 项目的变量来回切换测试和生产。

## 2. 环境模板

日常只填写根目录的两个统一文件：

- `.env.test`：测试环境唯一填写入口
- `.env.prd`：生产环境唯一填写入口

两份文件均已被 `.gitignore` 忽略。现有 `.env` 保留为旧的本地配置，不再作为测试/生产部署的唯一真相。

如果现有 `.env` 已确认是测试配置，可以将其中所有同名值安全迁移到 `.env.test`：

```powershell
pnpm env:merge-current-test
```

该命令不会输出密钥值；它只向生产文件复制模型、超时、存储模式等安全通用字段，并为测试/生产分别生成独立的 `AUTH_TOKEN_SECRET`。它不会把测试数据库、支付、Google、邮件或 DeepSeek 密钥复制到生产。

填写后先校验并生成平台专用文件：

```powershell
pnpm env:check:test
pnpm env:check:prd
pnpm env:export:test
pnpm env:export:prd
```

输出位置：

- `deploy/env/generated/test.railway.local`
- `deploy/env/generated/test.vercel.local`
- `deploy/env/generated/prd.railway.local`
- `deploy/env/generated/prd.vercel.local`

生成目录也被 Git 忽略。Railway 文件包含后端运行变量；Vercel 文件只包含 `MANY_WORLDS_API_ORIGIN` 和公开的 Google Client ID，避免把数据库和支付密钥传入 Vercel。

本地运行时应用可以直接读取指定文件：

```powershell
pnpm dev:api:test
pnpm dev:web:test
pnpm worker:test
```

生产文件只用于部署前校验或受控排查，不建议日常在本机启动完整生产进程：

```powershell
pnpm dev:api:prd
pnpm dev:web:prd
pnpm worker:prd
```

仓库内另外保留四个不含真实密钥的分平台示例，供核对字段用途：

- `deploy/env/test.railway.env.example`
- `deploy/env/test.vercel.env.example`
- `deploy/env/production.railway.env.example`
- `deploy/env/production.vercel.env.example`

准备实际变量时复制为 `.local` 文件：

```powershell
Copy-Item deploy/env/test.railway.env.example deploy/env/test.railway.env.local
Copy-Item deploy/env/production.railway.env.example deploy/env/production.railway.env.local
Copy-Item deploy/env/test.vercel.env.example deploy/env/test.vercel.env.local
Copy-Item deploy/env/production.vercel.env.example deploy/env/production.vercel.env.local
```

这些 `.local` 文件已被 `.gitignore` 忽略。真实密钥只保存在密码管理器和平台的环境变量后台，不提交到 Git。

生成 `AUTH_TOKEN_SECRET` 的 PowerShell 命令：

```powershell
$secretBytes = New-Object byte[] 64
[System.Security.Cryptography.RandomNumberGenerator]::Fill($secretBytes)
[Convert]::ToBase64String($secretBytes)
```

测试和生产必须分别生成一次，不得复用。

## 3. 一次性创建测试环境

### 3.1 Supabase Test

1. 创建 `many-worlds-test` 项目。
2. 选择与 Railway 接近的区域。
3. 从 Connect 页面复制 Session Pooler 5432 URL。
4. 将它填入 `test.railway.env.local` 的 `DATABASE_URL`。
5. 只对 Test 数据库运行迁移和测试 seed。

### 3.2 Railway Test

创建 `ai-story-room-test` 项目，连接仓库的 `staging` 分支，并建立两个 Service：

| Service | Build | Start | Pre-deploy |
|---|---|---|---|
| `api` | `pnpm build:api` | `pnpm --filter @apps/api start` | `pnpm db:migrate:deploy` |
| `worker` | `pnpm build:api` | `pnpm --filter @apps/api worker` | 不执行迁移 |

当前根目录 `railway.toml` 是 API 配置。创建 Worker Service 时必须在 Railway 中覆盖 Start Command、清除 Pre-deploy Command，并且不要给 Worker 配置公开域名或 HTTP Healthcheck。

在 Railway Project Settings -> Shared Variables -> Test 项目 Raw Editor 中粘贴完整的 `test.railway.env.local`，然后把 Shared Variables 同时关联到 `api` 和 `worker`。

给 API 添加 `api-test.ourmanyworlds.com`，健康检查路径使用：

```text
/api/health
```

发布后还要检查更严格的 readiness：

```text
https://api-test.ourmanyworlds.com/api/health/ready
```

### 3.3 Vercel Test

1. 创建 `ai-story-room-test` 项目。
2. 连接同一个仓库。
3. Production Branch 设置为 `staging`。
4. Build Command 使用 `pnpm build:vercel`。
5. Output Directory 使用 `apps/web/dist-vercel`。
6. 在 Production 环境中配置 `test.vercel.env.local` 的变量。
7. 绑定 `test.ourmanyworlds.com`。

### 3.4 Creem、Resend、Google Test

- Creem 切到 Test Mode，创建测试产品、测试 API Key 和测试 Webhook。
- Test Webhook URL：`https://api-test.ourmanyworlds.com/api/v4/webhooks/creem`。
- Resend 使用测试专用发送 Key 和测试子域名。
- Google 创建 Test Web Client，授权来源加入 `https://test.ourmanyworlds.com`。

## 4. 一次性创建生产环境

生产环境不能从测试数据库复制用户、订单或支付记录。创建新的空生产资源：

1. 创建 `many-worlds-prod` Supabase 项目。
2. 创建 `ai-story-room-prod` Railway 项目，连接 `main`。
3. 建立与测试相同的 `api` 和 `worker` 两个 Service。
4. 粘贴 `production.railway.env.local`，确认所有值来自生产资源。
5. 只运行 `pnpm db:migrate:deploy`，不要运行 `pnpm db:seed`。
6. 创建 `ai-story-room-prod` Vercel 项目，Production Branch 设置为 `main`。
7. 配置 `production.vercel.env.local`。
8. Creem 切到 Live Mode，重新创建正式产品、Live Key 和 Live Webhook。
9. 配置生产 Resend 域名和 Google Production Web Client。

Production Creem Webhook：

```text
https://api.ourmanyworlds.com/api/v4/webhooks/creem
```

## 5. 日常开发和部署流程

### 发布到测试

```text
feature branch -> Pull Request -> staging
```

合并到 `staging` 后：

1. Railway Test 自动部署 API/Worker。
2. API 在 Test Supabase 执行 migrations。
3. Vercel Test 自动部署 Web。
4. 在 `test.ourmanyworlds.com` 完成验收。

### 发布到生产

测试验收通过后：

```text
staging -> Pull Request -> main
```

合并到 `main` 后：

1. Railway Prod 部署 API，执行 production migrations。
2. Railway Prod 部署 Worker。
3. Vercel Prod 部署 Web。
4. 验证 production readiness、注册、邮件、支付和游戏流程。

建议保护 `main`：禁止直接 push，要求 PR、CI 通过和人工批准。

## 6. 修改环境变量时怎么做

环境变量文件只是人工维护模板，不会被 Vercel/Railway 自动读取。

最常用做法是：

1. 在对应 `.local` 文件中先准备修改。
2. 进入正确的平台项目和环境。
3. Railway 使用 Raw Editor 更新 Shared Variables。
4. Vercel 在 Environment Variables 中更新对应变量。
5. Review 变量差异后重新部署。
6. 重新部署后验证 `/api/health/ready` 和 Web 页面。

任何改动前先确认页面顶部项目名：`-test` 或 `-prod`。不要在一个浏览器标签中同时打开两个项目的变量编辑页。

## 7. 首次正式切换

1. 先使用 Vercel/Railway 临时域名验证完整生产栈。
2. 在 Creem Live 完成一笔真实小额付款，并验证 Webhook、订单和 Credits 入账。
3. 验证注册、邮件验证、登录、密码重置和 Google 登录。
4. 验证三玩家房间和 Worker 结算。
5. 备份 Production Supabase，并恢复到另一个隔离数据库做一次演练。
6. 固定已验收的 Git SHA/Tag。
7. 将 `ourmanyworlds.com` 绑定到 Vercel Prod，将测试站保留在 `test.ourmanyworlds.com`。

回滚时只能回滚 Vercel Prod/Railway Prod 的上一部署，不允许把正式域名重新指向测试数据库或 Creem Test。

## 8. 每次部署后的最小验证

```powershell
Invoke-RestMethod https://api.ourmanyworlds.com/api/health
Invoke-RestMethod https://api.ourmanyworlds.com/api/health/ready
npx vercel ls --yes
```

检查 `/api/health/ready` 返回：

- `ok=true`
- `database.ready=true`
- `email.ready=true`
- `billing.ready=true`
- `version` 与本次发布 Git SHA 一致

支付、退款和 Worker 属于业务闭环，不能只用 health 接口代替真实流程测试。

## 9. 当前上线前必须处理的仓库问题

在正式绑定域名前必须完成：

1. `api/proxy.js` 不得在缺少变量时回退到测试 Railway。
2. `apps/web/public/reset-password.js` 不得写死测试 Railway 地址。
3. Railway Worker 必须使用独立启动命令，并且不能与 API 同时执行 migrations。
4. Production 不得运行 `pnpm db:seed`，当前 seed 包含 mock 用户和 `LOCAL1` 测试房间。
5. Production 不得存在 `ALLOW_TEST_CREDIT_GRANT`、`FAIL_*` 或任何 Test Supabase/Creem Key。

完成以上项目后，生产环境才具备可安全切换的基础。
