# T11 — Independent API and Database Reconciliation

## 0. 任务模板选择

| Field | Value |
|---|---|
| Task Template ID | `TPL-API-DB-E2E` |
| 为什么选这个模板 | 浏览器完成后必须独立核对 API 与数据库真值 |
| 主验收面 | 账本、奖励、房间、行动和结算计数 |
| 覆盖对象 | CreemPurchase、CreditLedger、WorldUnlock、Referral、StoryRun |
| Requirement IDs | `REQ-PAY-004`, `REQ-INV-003`, `REQ-E2E-001` |
| Input | T10 current RunId/entity IDs |

## 1. 目标

Independently read back and reconcile purchase, wallet/ledger, unlock, referral/share, membership, actions and resolutions after browser execution.

## 2. 验收标准

- Purchase grant=1, unlock spend=1, duplicate mutations=0.
- Referral reward ledgers=2,total=50; duplicate/self/capped=0.
- Three core users, 21 accepted human actions, 7 unique resolutions.
- UI-visible balance/progress/round/result match API and DB truth.

## 执行命令

```powershell
pnpm test:world-credits
pnpm test:acceptance
```

Use repo-native Prisma/readback tools or a read-only script. Never print secrets, raw auth tokens or unrelated user rows.

## 依赖与续跑门槛

Requires T10 terminal browser trace with current IDs. If T10 failed before data completion, do not manufacture rows; return to T10/owner task.

## 防停止规则

Do not use UI text as database proof. Do not query only aggregate balance; reconcile individual ledger/source/idempotency keys and per-round action/resolution IDs.

## 失败修复路由

Ledger/unlock mismatch → T02. Referral mismatch → T04. Room/action/resolution mismatch → gameplay owner/T10 rerun. Readback tooling issue → repair T11 without mutating business data.

## 结果 JSON

Write `docs/auto-execute/results/T11.json` with redacted entity IDs, expected/actual counts, reconciliation status and verdict.

## HANDOFF

Write `docs/auto-execute/latest/T11-HANDOFF.md` with reconciled facts and any unresolved mismatch for T12/T13.
