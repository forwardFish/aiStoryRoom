# Many Worlds v1.4 P0 Closeout Codex Exec Prompts

## Master prompt

Execute `docs/auto-execute/many-worlds-v14-p0-closeout-tasks/T00-omx-auto-execute-orchestrator.md` in `same-session-serial` mode. Preserve unrelated worktree changes. Follow task dependencies and durable handoffs. Implement only the v1.4 P0 payment, invite/reward/poster, canonical route/link and multi-user closeout scope. Use Creem test/sandbox only. Do not claim PASS until A/B/C complete seven rounds, D/E/F referral cases pass, payment branches pass, API/DB readback reconciles and one-to-one visual evidence passes. Use `docs/UI/web/MW-60_PAY-03_确认购买.png` as the confirmed 1486×1058 PAY-03 pixel reference; its existence does not substitute for implementation or actual/diff evidence.

## Resume prompt

Read the latest terminal task result and `docs/auto-execute/latest/Txx-HANDOFF.md`. Verify its evidence paths exist before trusting it. Resume the next dependency-ready task; if a gate is `REPAIR_REQUIRED`, route back to the named repair task. Do not restart completed evidence-backed work and do not reuse old RunIds.

## Final verification prompt

Run T13 only after every dependency is terminal. Independently re-read the route crawl, browser traces, visual summaries, DB reconciliation and security guard. Return pure PASS only if every checkbox in the final acceptance gate is demonstrated by current RunId artifacts.
