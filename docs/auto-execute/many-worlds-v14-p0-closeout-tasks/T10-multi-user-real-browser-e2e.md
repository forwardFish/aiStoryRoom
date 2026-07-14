# T10 — A/B/C/D/E/F Real-Browser End-to-End

## 0. 任务模板选择

| Field | Value |
|---|---|
| Task Template ID | `TPL-OWNER-E2E` |
| 为什么选这个模板 | 需要用产品所有者视角验证六个真实用户流程 |
| 主验收面 | 可见页面操作、支付、邀请、七轮和结果 |
| 覆盖对象 | A/B/C/D/E/F、全部 P0 流程 |
| Requirement IDs | `REQ-E2E-001`, all payment/invite/route requirements |
| Actors | A Host, B/C core players, D/E/F fresh invitees |

## 1. 目标

Drive the complete product visibly: homepage/auth/world/room, invite channels/poster, D/E/F reward cases, A/B/C seven rounds, round-4 payment branches, return to same room and dynamic results.

## 2. 验收标准

- Six isolated identities; A/B/C separate browser contexts; D/E/F fresh storage/accounts.
- D +25, repeat/self +0, E +25, F-at-cap +0.
- A/B/C produce 21 accepted actions and 7 unique resolutions.
- At round 4, unpaid return, delayed Webhook, successful paid return and failed retry are visibly exercised.
- Console/runtime error count is zero.

## 执行命令

```powershell
pnpm test:simulated-player
```

Use the repository browser harness or extend it to real isolated contexts. API calls are allowed only for post-action readback and deterministic test-provider control.

## 依赖与续跑门槛

Requires T07 PASS and all available visuals terminal through T08/T09. Requires safe local/test database and Creem sandbox or deterministic provider fixture. No production.

## 防停止规则

Do not replace clicks with direct API setup after identity creation. Do not reuse tokens across users. Do not stop after round 3 or payment success; reach all three result pages.

## 失败修复路由

Route earliest failed visible step to T03/T05/T06; contract/data issue to T02/T04; concurrency/gameplay regression to existing room/game owner then rerun from a fresh RunId.

## 结果 JSON

Write `docs/auto-execute/results/T10.json` with identity IDs, browser traces, checkpoints, exact counts, route history, provider mode and verdict.

## HANDOFF

Write `docs/auto-execute/latest/T10-HANDOFF.md` with current RunId entity IDs and readback queries for T11, redacting tokens/secrets.
