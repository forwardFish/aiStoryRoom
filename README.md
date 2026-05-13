# aiStoryRoom

AI 多人故事局 MVP：微信小程序优先闭环 + NestJS API + PostgreSQL/Prisma 本地数据库。

## 本地启动

```powershell
pnpm install
pnpm docker:up
pnpm db:migrate
pnpm db:seed
pnpm dev:api
pnpm dev:miniprogram
```

API 默认地址：`http://localhost:3001/api`。

## 验收

```powershell
pnpm typecheck
pnpm --filter @apps/miniprogram build:weapp
pnpm test:story:e2e
```

`pnpm test:story:e2e` 会模拟 3 个 mock 用户分别扮演林鹿、陈舟、顾言，跑完午夜便利店 5 个节点并生成章节报告到 `scripts/test-reports/`。

## 当前范围

- 小程序：登录、首页、模式选择、模板选择、创建故事局、邀请大厅、角色选择、角色卡、故事房间、行动提交、AI 结算、章节阅读、分享卡、我的故事局。
- API：mock 微信登录、故事局、角色、节点、行动、结算、章节和分享 token。
- 数据库：PostgreSQL 16 + Prisma schema + seed；Redis 容器已配置，首版 BullMQ 先保留扩展位。
- 后台：本轮暂缓页面实现，保留日志和 admin 扩展数据模型。
