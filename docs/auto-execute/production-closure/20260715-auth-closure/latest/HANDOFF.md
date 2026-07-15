# Auth Closure Handoff

- Goal: `TOTAL-AUTH-20260715`; authentication code and local verifier gates are complete, deployment acceptance is pending.
- Schema: additive migration `20260715190000_auth_closure` adds one-time auth tokens, Google identities and nonce-bound login challenges.
- API: `EmailService` is file-sink only outside production; production readiness requires Resend. `GoogleTokenVerifier` validates Google ID-token audience/issuer/expiry/nonce, and `GoogleAuthService` consumes each challenge once.
- Web: `/auth` now loads safe runtime configuration, mounts the official Google button only when `googleWebClientId` exists, and keeps email verification/reset links as the sole delivery path for secrets.
- Passing gates: API typecheck; `pnpm test:api`; web typecheck; web 33/33 tests; Vercel asset build with a dummy public Client ID.
- Deployment state: `https://ourmanyworlds.com/runtime-config.js` is currently 404, and localhost API is an old process. No production browser sign-in was claimed.
- Deployment runbook: `10-deployment-runbook.md` contains exact variable names, readiness checks, redacted evidence requirements, and the real email/Google matrix.
- Next: user configures the exact Railway/Vercel values listed in `blockers.md`; then apply migration/deploy/restart and run actual email + Google browser acceptance with a test account.
