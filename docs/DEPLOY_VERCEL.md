# Vercel 部署与域名接入

## 首页优先发布（当前配置）

当前 Vercel 项目仅发布可直接访问的静态首页和页面资源：根路径、`/home`、`/role-select`、`/game`、`/trio` 都由构建产生的 `apps/web/dist-vercel` 提供。该目录将首页复制为根路径的 `index.html`，本地 `apps/web/public/index.html` 的主游戏入口保持不变。这样不依赖尚未配置的公网 PostgreSQL，即可让 `ourmanyworlds.com` 先展示首页。

`/api/*` 和真实游戏存档不在本次首页发布范围内；它们将在公网 PostgreSQL 16 与生产环境变量完成后，以独立的 API 部署阶段接回。

## 全栈生产结构（后续阶段）

本仓库使用一个 Vercel 项目：根目录为仓库根，静态 Web 从 `apps/web/public` 输出，`/api/*` 由根目录 `api/[...path].ts` 中的 Nest API 函数处理。这样浏览器始终访问同源 API，不需要在前端写死另一个生产 API 域名。

`pnpm build:vercel` 会在构建时把 `docs/UI/web` 中的授权 UI 图片、人物图和图标复制到 Web 静态输出目录。运行时不读取参考整页截图，也不使用截图覆盖层。

## 必须先准备的生产环境变量

在 Vercel Project Settings → Environment Variables 中分别为 Production 和 Preview 设置：

| 变量 | Production | Preview | 说明 |
|---|---|---|---|
| `DATABASE_URL` | 必填 | 必填 | 外网可访问的 PostgreSQL 16 连接串；Vercel 不能访问本机 `127.0.0.1` 数据库。 |
| `MVP_STORY_STORAGE` | `prisma` | `prisma` | 启用真实持久化。 |
| `DEEPSEEK_API_KEY` | 必填 | 可使用独立测试密钥 | 仅保存于 Vercel 密钥环境变量，绝不提交到仓库或前端。 |
| `AI_DIRECTOR_PROVIDER` | `deepseek` | `deepseek` 或测试值 | 生产使用真实 provider。 |

部署前，使用同一份生产数据库连接串在受控环境执行：

```powershell
pnpm db:generate
pnpm db:push
pnpm db:seed
```

不要把本机 `.env` 上传或提交；`.env.example` 只能保留占位符。

## Vercel 项目与域名

1. 先修复本机 Vercel CLI 登录：`vercel login`。当前机器的 CLI 令牌已失效，不能安全地部署到任何账号。
2. 在仓库根执行 `vercel link`，选择或创建 `ai-story-room` 项目，然后运行 `vercel` 创建 Preview。
3. Preview 验证通过后运行 `vercel --prod`。
4. 在 Vercel 的 Project Settings → Domains 中添加 `ourmanyworlds.com` 与 `www.ourmanyworlds.com`。
5. 以 `www.ourmanyworlds.com` 为主域名，并将根域 `ourmanyworlds.com` 配置为重定向到 `www`。
6. 按 `vercel domains inspect` 给出的实际提示配置 DNS。通常主域使用 A 记录，`www` 使用 CNAME；不要猜测或复用其他项目的记录值。

Vercel 目前建议以 `www` 作为主域名，并从根域重定向；自定义域名必须在已链接项目中添加和检查。官方参考：[自定义域名](https://vercel.com/docs/domains/set-up-custom-domain)、[域名重定向](https://vercel.com/docs/domains/working-with-domains/deploying-and-redirecting)。

## 部署后验收

```powershell
vercel domains inspect ourmanyworlds.com
vercel domains inspect www.ourmanyworlds.com
```

随后在生产域名执行：首页进入选角、创建 StoryRun、一次主线决策、一次主动谋划、关键事件响应、刷新恢复，以及三玩家七轮回归。生产数据库必须是独立库，不能使用开发库。
