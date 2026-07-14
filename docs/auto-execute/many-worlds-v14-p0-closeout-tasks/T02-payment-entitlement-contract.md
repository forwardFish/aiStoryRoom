# T02 — Payment Context, Entitlement and Return Contract

## 0. 任务模板选择

| Field | Value |
|---|---|
| Task Template ID | `TPL-PAYMENT-ENTITLEMENT` |
| 为什么选这个模板 | 支付涉及托管结账、Webhook、入账和权益解锁 |
| 主验收面 | 服务端支付状态、账本与幂等解锁 |
| 覆盖对象 | REQ-PAY-001—005、API-BILL/WEBHOOK/UNLOCK |
| Requirement IDs | `REQ-PAY-001`—`REQ-PAY-005`, `REQ-SAFE-001` |
| Contract IDs | `API-BILL-01`, `API-BILL-02`, `API-WEBHOOK-01`, `API-UNLOCK-01` |

## 1. 目标

Implement server-owned checkout intent/runId/returnTo/order display context, safe status responses and idempotent paid→unlock behavior while preserving signed Webhook as the only purchase entitlement truth.

## 2. 验收标准

- Membership, purchase ownership and internal returnTo are validated.
- Double checkout, Webhook replay, status refresh and unlock retry do not duplicate mutations.
- Success-before-Webhook remains processing.
- Test/sandbox provider only; secrets remain server-side.

## 执行命令

```powershell
pnpm --filter @ai-story-room/api test
pnpm test:world-credits
pnpm test:security
```

Use actual repo scripts found by T01; if a listed script is absent, add or select the narrow equivalent and record it rather than silently skipping.

## 依赖与续跑门槛

Requires T01 PASS and confirmed billing/credits/story-access ownership. Resume from code/tests only if migrations and API DTOs are consistent.

## 防停止规则

Do not accept client `paid=true`, client balance, room title or external returnTo. Do not add an in-app card form. Do not assume Creem provides `cancel_url` without an official contract.

## 失败修复路由

Schema/migration mismatch → repair in T02. Provider fixture gap → add deterministic test adapter. UI-only failure → T03. Duplicate ledger/unlock → remain in T02 until reconciled.

## 结果 JSON

Write `docs/auto-execute/results/T02.json` with test commands, contract cases, idempotency keys/counts, schema changes and verdict.

## HANDOFF

Write `docs/auto-execute/latest/T02-HANDOFF.md` with request/response contracts, status mapping and UI integration instructions for T03.
