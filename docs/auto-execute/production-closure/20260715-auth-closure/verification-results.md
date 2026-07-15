# Authentication verification results

| Date | Command or evidence | Result | Notes |
|---|---|---|---|
| 2026-07-15 | `pnpm db:generate` | BLOCKED_BY_ENVIRONMENT | User-running local API locks the Windows Prisma engine (`EPERM rename`). |
| 2026-07-15 | `PRISMA_GENERATE_NO_ENGINE=1 pnpm db:generate` | PASS | Prisma client generation after additive auth schema. |
| 2026-07-15 | `pnpm --filter @apps/api typecheck` | PASS | Email provider, one-time tokens, Google verifier/challenge/linking, and Google-capable protected sessions compile. |
| 2026-07-15 | `pnpm test:api` | PASS | Email registration/verification/reset/replay assertions; Google nonce/replay/no-unsafe-auto-link assertions; existing story HTTP/catalog tests. |
| 2026-07-15 | `pnpm --filter @apps/web test` | PASS 33/33 | Auth page runtime config, Google button challenge contract, email-only secret handling, and existing UI behavior. |
| 2026-07-15 | `PUBLIC_GOOGLE_WEB_CLIENT_ID=verification-client-id.apps.googleusercontent.com pnpm build:vercel` | PASS | Generated `apps/web/dist-vercel/runtime-config.js` received the public client ID and no client secret. |
| 2026-07-15 | `pnpm test:api` (final local run) | PASS | Covers replacement/expired/replayed verification and reset tokens, rate limiting, file-sink readability, production provider failure, unverified guard denial, Google identity validity and replay/link policy. |
| 2026-07-15 | `pnpm test:config && pnpm test:deploy-config` | PASS | Existing configuration and Railway deployment contracts remain green. |
| 2026-07-15 | `GET https://ourmanyworlds.com/runtime-config.js` | NOT_DEPLOYED | Returned 404; the production web build containing this feature is not deployed yet. |
| 2026-07-15 | local `GET /api/health/ready` | STALE_PROCESS | Existing API process reports the old response shape (no email readiness), confirming it must be restarted after migration/deploy. |

## Code-level verdict

- Email registration, email verification, login, reset, resend, hashed single-use tokens, expiry/replay/replacement/rate-limit controls, and production email readiness checks are implemented and locally verified.
- Google button uses Google Identity Services popup flow; server verifies the ID token audience, issuer, expiry, nonce and subject; only a public Client ID reaches the browser.
- Google challenges are consumed once. A third-party email is never silently linked to an existing password account. Google sessions remain valid only while their linked identity exists. Link/unlink events contain only a local identity ID, never a Google credential or subject; browser sign-out removes the local session and calls GIS `disableAutoSelect`.
- Google accounts are accepted by credits/onboarding and checkout guards without pretending that a non-Google password email was verified.

## Remaining acceptance evidence

Only deployment-dependent evidence remains: apply migration, configure Resend and Google environment values, deploy/restart, then complete actual inbox and Google-account browser flows.
