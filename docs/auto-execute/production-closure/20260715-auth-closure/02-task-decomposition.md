# 任务拆解

| ID | Lane | 任务 | 目标文件 | 依赖 | 验证 | 状态 |
|---|---|---|---|---|---|---|
| AUTH-BASE-001 | QA | 修复 Web 测试生命周期/入口断言 | `apps/web/public/app.js`, `apps/web/tests/browser-smoke.test.mjs` | 无 | `pnpm --filter @apps/web test` | PASS |
| AUTH-IMPL-001 | Backend/DB | 新增一次性 token、邮件 provider、认证状态约束 | `prisma`, `apps/api/src/auth`, `apps/api/src/email` | AUTH-BASE-001 | API 单测、typecheck | IN_PROGRESS |
| AUTH-IMPL-002 | Frontend | 注册/验证/重发/重置 UI 和安全回跳 | `apps/web/public/platform.js`, tests | AUTH-IMPL-001 | Web tests/browser | PENDING |
| AUTH-IMPL-003 | Backend/DB | Google challenge、验签、身份关联、令牌声明 | `prisma`, `apps/api/src/auth` | AUTH-IMPL-001 | API tests | PENDING |
| AUTH-IMPL-004 | Frontend | GIS 官方按钮、错误恢复、登出 | `platform.js`, web tests | AUTH-IMPL-003 | browser/DOM tests | PENDING |
| AUTH-VERIFY-001 | Integration | 本地 DB/API/browser 认证闭环 | scripts/tests/evidence | AUTH-IMPL-002..004 | test matrix | PENDING |
| AUTH-EXTERNAL-001 | Manual | Resend/DNS、Google Cloud、staging 真实账号证据 | Railway/Vercel/Google/Resend | AUTH-VERIFY-001 | Phase Gate | PENDING |
