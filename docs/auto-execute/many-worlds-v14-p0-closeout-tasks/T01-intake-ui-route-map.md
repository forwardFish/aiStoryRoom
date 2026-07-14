# T01 — Intake, UI Asset and Route Baseline

## 0. 任务模板选择

| Field | Value |
|---|---|
| Task Template ID | `TPL-INTAKE` |
| 为什么选这个模板 | 开发前需要冻结真源、现状与差距 |
| 主验收面 | UI、资产、路由、API、数据库基线 |
| 覆盖对象 | 全部 UI ID、REQ-VIS-001、REQ-ROUTE-001 |
| Requirement IDs | `REQ-VIS-001`, `REQ-ROUTE-001` |
| UI IDs | all UI IDs in the UI reference map |

## 1. 目标

Re-scan current code, schema, tests, routes, UI files, dimensions and hashes. Produce a fact-based gap matrix without changing product behavior. Verify renamed references and identify whether PAY-03 exists.

## 2. 验收标准

- Every UI path is readable with dimensions/hash.
- Current local/Vercel route matrices and all homepage links are captured.
- Current payment/referral/room APIs and DB models are mapped.
- Dirty worktree ownership and unrelated changes are recorded.

## 执行命令

```powershell
git status --short
Get-ChildItem docs/UI/web -File | Sort-Object Name
rg -n "href=|location.assign|location.href|pageRoutes|rewrites" apps/web vercel.json
rg -n "@Controller|@(Get|Post)\(" apps/api/src --glob "*.controller.ts"
```

## 依赖与续跑门槛

Requires T00 RunId. Resume only if the source snapshot and file hashes still match; otherwise refresh the baseline.

## 防停止规则

Do not infer image semantics from timestamp order. Do not call the product complete because historical evidence exists. Do not edit code during intake.

## 失败修复路由

Unreadable/missing source → T00 blocker. Drift in routes/contracts → update the T01 map and notify T00. Missing PAY-03 → record `BLOCKED_BY_MISSING_SOURCE` for T08, not a made-up UI.

## 结果 JSON

Write `docs/auto-execute/results/T01.json` with source hashes, gaps, routes, asset status and verdict.

## HANDOFF

Write `docs/auto-execute/latest/T01-HANDOFF.md` with exact files safe to edit, discovered blockers and readiness for T02/T04/T06.
