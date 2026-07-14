# Many Worlds v1.4 P0 Closeout Final Acceptance Gate

只有页面、跳转、支付、邀请、多用户七轮、数据库读回和安全检查全部有本轮证据时，才允许最终通过。

## Pure PASS checklist

- [x] UI-PAY-03 source exists and is readable at 1486×1058.
- [ ] Every P0 visual, including PAY-03, has implementation reference/actual/diff/metrics.
- [ ] Homepage/Header/Footer have no dead, fake or `.html` product links.
- [ ] Every canonical route direct-opens in local and built output.
- [ ] Auth safely restores room, invite, credits and game routes.
- [ ] Payment processing, paid, cancelled, failed and delayed branches are visible and recoverable.
- [ ] Signed test Webhook grants once; unlock spends once; paid returns to the same room/round.
- [ ] Invite modal has reward explanation, progress, channels, copy and dynamic poster.
- [ ] QR opens the real combined link; new user auto-joins after auth.
- [ ] D/E reward 25 each; duplicate, self and F-at-cap reward zero.
- [ ] A/B/C use isolated contexts and complete 21 actions/7 unique resolutions.
- [ ] API/DB readback reconciles all purchase, ledger, referral and gameplay counts.
- [ ] No runtime errors, privacy leak, open redirect, real charge, production write or secret exposure.

## Blocking verdicts

- Any required reference later missing/corrupt: `BLOCKED_BY_MISSING_SOURCE` for the affected visual gate.
- Material visual mismatch or broken route: `REPAIR_REQUIRED`.
- Provider/sandbox unavailable after safe retries: `BLOCKED` with exact external condition.
- Any duplicate financial/reward mutation or privacy/security defect: `FAIL` until repaired and rerun.

Final aggregation must cite current RunId artifacts and must not infer success from task status text.
