# T04 — Combined Invite, Join and Referral Domain

## 0. 任务模板选择

| Field | Value |
|---|---|
| Task Template ID | `TPL-API-DOMAIN` |
| 为什么选这个模板 | 邀请、绑定、加入、达标和奖励属于同一领域合同 |
| 主验收面 | combined link、认证恢复、资格与奖励幂等 |
| 覆盖对象 | REQ-INV-001—003、API-REF/JOIN/ROOM |
| Requirement IDs | `REQ-INV-001`—`REQ-INV-003`, `REQ-SAFE-001` |
| Contract IDs | `API-REF-01`, `API-REF-02`, `API-JOIN-01`, `API-ROOM-01` |

## 1. 目标

Generate a combined room+ref invite URL, safely persist auth returnTo, bind referral once, join by room code once and qualify only after the defined opening completion.

## 2. 验收标准

- Share event always grants zero.
- D and E each grant 25 once; D repeat, A self-invite and F at cap grant zero.
- Auth returns to `/join`, then automatically joins the correct room.
- Expired/full/closed room errors are explicit and recoverable.

## 执行命令

```powershell
pnpm --filter @ai-story-room/api test
pnpm test:world-credits
pnpm test:many-worlds-pages
```

## 依赖与续跑门槛

Requires T01 PASS and confirmed referral/room schema. Resume only with stable definitions of `opening completed` and the cap.

## 防停止规则

Do not reward copy/share/open. Do not use room inviteCode as referral identity. Do not allow a client endpoint to declare itself qualified without server gameplay evidence.

## 失败修复路由

Referral concurrency/ledger defect → T04. Auth route/redirect defect → T06 plus T04 contract retest. Modal/presentation defect → T05.

## 结果 JSON

Write `docs/auto-execute/results/T04.json` with link samples redacted, bind/join/qualify cases, ledger counts and verdict.

## HANDOFF

Write `docs/auto-execute/latest/T04-HANDOFF.md` with the combinedInviteUrl contract, error codes and T05 integration points.
