# T07 — Integration, Contract, Route and Fault Tests

## 0. 任务模板选择

| Field | Value |
|---|---|
| Task Template ID | `TPL-TEST-INTEGRATION` |
| 为什么选这个模板 | 需要跨支付、邀请、路由和故障分支做合同测试 |
| 主验收面 | 单元、集成、路由、链接和故障注入 |
| 覆盖对象 | 全部 P0 Requirement ID 与 API ID |
| Requirement IDs | all P0 requirement IDs |
| Test focus | payment, referral, join, routes, poster, fault injection |

## 1. 目标

Run and extend automated tests that prove every state transition and negative contract before browser visual/E2E work.

## 2. 验收标准

- Unit/integration suites cover double-click, replay, delay, refresh, malicious paid/returnTo, popup/clipboard denial, duplicate/self/cap reward and join retry.
- Link crawl and canonical direct-route test pass locally and in build output.
- Test output has no unexpected skip, unhandled rejection or leaked secret.

## 执行命令

```powershell
pnpm test:world-credits
pnpm test:many-worlds-pages
pnpm test:causal
pnpm test:acceptance
pnpm build:vercel
```

Run additional narrow scripts introduced by T02—T06 and record every exit code.

## 依赖与续跑门槛

Requires T02, T03, T04, T05 and T06 implementation-terminal results. A missing PAY-03 image does not block behavior tests.

## 防停止规则

Do not omit failed branches because the happy path passes. No test may assert only static text when a mutation or redirect is required.

## 失败修复路由

Route each failing assertion to its owning task T02—T06, rerun that focused test, then rerun the full T07 set. Flaky tests are defects until a deterministic cause is recorded.

## 结果 JSON

Write `docs/auto-execute/results/T07.json` with commands, totals, skips, failures, fault cases, build status and verdict.

## HANDOFF

Write `docs/auto-execute/latest/T07-HANDOFF.md` with stable runtime/fixture launch instructions for T08/T10.
