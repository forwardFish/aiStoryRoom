# 认证闭环模块 Goal

## 目标

按 `.omx/plans/aistoryroom-production-functional-closure-plan.md` 的 Phase 1 与 Phase 1.5，实现并验收 AIStoryRoom 的认证闭环：邮箱注册、验证、登录、重发验证、忘记/重置密码，以及 Google 账号直接登录与安全关联。

## 项目与来源

- 项目：`D:\lyh\agent\agent-frame\aiStoryRoom`
- 主方案：`.omx/plans/aistoryroom-production-functional-closure-plan.md`
- 当前代码真源：`apps/api/src/auth/`、`prisma/schema.prisma`、`apps/web/public/platform.js`
- 验收边界：不做一比一视觉复刻；不进入 Creem、邀请奖励、房间、七轮、结果分享模块，除非认证回跳兼容性要求最小修复。

## 成功标准

1. 生产 API 不再回显验证/重置 token；token 只以哈希存库，验证与重置相互隔离、过期、单次使用。
2. 未完成邮箱验证的密码账号不能获得业务会话或访问受保护业务接口；验证成功后可以登录并恢复安全 `returnTo`。
3. Resend 生产适配和非生产 file sink 均可用，缺失生产邮件配置会使 readiness 失败。
4. Google GIS ID Token 在服务端验证 `aud`、`iss`、`exp`、`nonce`，以 `sub` 映射身份，且不静默接管第三方邮箱同名账号。
5. 本地 API/数据库/浏览器测试通过；真实邮件、Google 测试账号和部署环境证据由账号与域名配置完成后补齐。

## 停止条件

仅在需要 Resend API key、DNS、Google Cloud OAuth Client ID、真实 Google 测试账号、Railway/Vercel 配置、生产部署或不可逆数据操作时请求用户配合。普通代码、测试、迁移脚本和本地验证继续自动推进。

## 当前裁决

`ACTIVE — Phase 0 已通过（普通 Prisma generate 受用户运行中的 API Windows 引擎锁定，已记录为环境前置）。`
