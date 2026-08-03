# Goal

Implement and independently verify the complete `continuous_openovel_v1` multiplayer vertical slice described by:

`D:\lyh\agent\agent-frame\aiStoryRoom\docs\Our_Many_Worlds_OpenNovel多人共享世界_完整开发与Codex_ChatGPT_Pro协作验收方案_v1.0.md`

## Success criteria

- One authoritative Continuous Story V2 world core and one monotonic `worldSequence` per room.
- Three isolated Role runtimes, ActorThreads, workspaces, POV canons, knowledge projections, and pending impacts.
- Human intent cannot dictate another human role's result; cross-role actions use interaction/contest resolution.
- Human roles survive until an explicit finale; AI roles act only when triggered and within call budgets.
- `OPENOVEL_V1`, `continuous_story_v2`, and existing multiplayer behavior do not regress.
- Unit, contract, integration, concurrency, fault, three-role E2E, browser, security, performance, and final gates have current evidence.
- All work stays on `codex/openovel-multiplayer-v1`; no PR, merge, deployment, production migration, production config, or real-user data operations.

## Out of scope

- Mid-game role takeover or complex owner migration.
- Six-player expansion beyond the generic contract.
- Production deployment or applying migrations to production.
- Claiming scripted/mock provider evidence as live-model evidence.

## Stop conditions

- Credentials, CAPTCHA, OTP, Passkey, 2FA, production access, or destructive data operations are required.
- The same failure signature may be verified at most three times. Every attempt
  must test a different hypothesis and add new evidence. If the third attempt
  still fails, stop that path immediately, identify which underlying state
  machine, ordering/idempotency, projection contract, context compilation, or
  environment assumption is invalid, record the evidence, and repair that
  layer before any further verification.

Final verdict: `PENDING`
