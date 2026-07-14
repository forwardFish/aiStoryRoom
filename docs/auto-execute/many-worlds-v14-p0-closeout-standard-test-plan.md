# Many Worlds v1.4 P0 Closeout Standard Test Plan

测试按合同、页面、视觉、多用户、数据库和最终门禁逐层推进，失败必须回到最早归属任务修复。

## Phase 1: static and contract

1. Build/typecheck/lint relevant packages.
2. Unit-test canonical routes, returnTo allowlist, checkout context, status mapping, combined invite URL, reward cap and poster privacy.
3. Integration-test signed test Webhook, replay, unlock replay, referral concurrency and room join retry.

## Phase 2: page and visual

1. Direct-open every canonical route in a clean context.
2. Crawl every homepage/Header/Footer link and button target.
3. Capture each UI reference state at its native viewport.
4. Produce actual/diff/metrics/console-network and repair until thresholds pass.

## Phase 3: real-user branches

1. D invite/auth/join/opening gives first 25.
2. D repeat and A self-invite give zero.
3. E gives second 25; F gives zero at cap.
4. A/B/C complete rounds 1—3.
5. At round 4, run unpaid return, delayed Webhook, paid return and failed retry branches.
6. A/B/C complete rounds 4—7 and open results.

## Phase 4: readback and gate

Read every relevant DB entity, reconcile exact counts, scan secrets/runtime errors, run built-output route smoke and aggregate only current RunId evidence.

## Required fault injection

Double-click checkout; Webhook replay; paid-page refresh; status timeout; malicious paid query; malicious returnTo; popup/clipboard denial; expired room code; QR placeholder; player reconnect; double resolve.
