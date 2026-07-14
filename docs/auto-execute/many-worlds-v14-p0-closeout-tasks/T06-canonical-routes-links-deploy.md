# T06 — Canonical Routes, Homepage Links and Deploy Rewrites

## 0. 任务模板选择

| Field | Value |
|---|---|
| Task Template ID | `TPL-DEPLOY-ENV` |
| 为什么选这个模板 | 路由必须同时覆盖本地服务、构建产物和 Vercel |
| 主验收面 | 规范路由、全站链接、直接访问和 rewrite |
| 覆盖对象 | REQ-ROUTE-001、returnTo、Header/Footer |
| Requirement IDs | `REQ-ROUTE-001`, `REQ-SAFE-001` |
| Route truth | v1.4 full-site route document |

## 1. 目标

Make extensionless routes canonical, remove homepage/Header/Footer dead links, safely recover auth returnTo and align local server, built output and Vercel rewrites.

## 2. 验收标准

- Every canonical route direct-opens or enters the correct auth recovery.
- No `#flow`, generic `#explore`, `/home#help` or user-visible `.html` links remain.
- Unimplemented company/community/language/social controls are removed or non-clicking honest text.
- External/open-redirect returnTo values are rejected.

## 执行命令

```powershell
pnpm build:vercel
pnpm test:many-worlds-pages
rg -n "credits\.html|credits-success\.html|join\.html|#flow|#explore|/home#help" apps/web/public vercel.json
```

## 依赖与续跑门槛

Requires T01 route/link baseline. Resume only after verifying local server and Vercel changes still describe the same canonical table.

## 防停止规则

Do not satisfy link tests by converting controls to inert buttons without honest UI intent. Do not test only navigation from `/`; direct-open dynamic routes in built output.

## 失败修复路由

Local-only mismatch → server routing repair. Build/Vercel mismatch → T06 deploy config repair. Auth/join semantic defect → T04. Payment destination defect → T03.

## 结果 JSON

Write `docs/auto-execute/results/T06.json` with route matrix, link crawl, direct-open statuses, build result and verdict.

## HANDOFF

Write `docs/auto-execute/latest/T06-HANDOFF.md` with canonical routes, redirects, rewrite inventory and any environment blocker.
