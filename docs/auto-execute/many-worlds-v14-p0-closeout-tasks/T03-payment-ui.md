# T03 — PAY-01—07 UI and Return-to-Room

## 0. 任务模板选择

| Field | Value |
|---|---|
| Task Template ID | `TPL-FRONTEND-PAGE` |
| 为什么选这个模板 | PAY-01—07 是同一页面家族的多状态实现 |
| 主验收面 | 页面状态、点击跳转、错误恢复和回房间 |
| 覆盖对象 | UI-PAY-01—07、UI-RESULT-01 |
| Requirement IDs | `REQ-PAY-001`—`REQ-PAY-005`, `REQ-RESULT-001` |
| UI IDs | `UI-PAY-01`—`UI-PAY-07`, `UI-RESULT-01` |

## 1. 目标

Build the unlock modal, credits wallet, internal confirmation state and shared status template. Preserve return context, provide all cancel/fail/retry exits and add only the low-weight result Share Recap behavior defined by scope.

## 2. 验收标准

- Every button has one canonical destination and visible pending/error state.
- Paid waits for server truth, invokes idempotent unlock and returns to the same run/round.
- Cancelled/failed can retry or return without false unlock.
- No `.html` product link or fake Share Recap page.

## 执行命令

```powershell
pnpm --filter @ai-story-room/web test
pnpm test:many-worlds-pages
pnpm build:web
```

## 依赖与续跑门槛

Requires T02 PASS. PAY-03 reference is confirmed at 1486×1058; T03 cannot claim final visual PASS until T08 validates the implemented state against it.

## 防停止规则

Do not finish after rendering static screenshots. Exercise real click transitions, refresh, Back/Forward, polling and retry. Do not show paid before API state is PAID.

## 失败修复路由

API/context issue → T02. Page behavior/route issue → repair T03. Material reference mismatch → T09 after T08 measurement.

## 结果 JSON

Write `docs/auto-execute/results/T03.json` with state/route/button coverage, screenshots inventory, console/network status and verdict.

## HANDOFF

Write `docs/auto-execute/latest/T03-HANDOFF.md` with reachable state URLs/fixtures and outstanding visual-source status.
