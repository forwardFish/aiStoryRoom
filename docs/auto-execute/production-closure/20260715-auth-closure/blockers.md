# External and environment blockers

| ID | Status | Blocker | Exact resolution |
|---|---|---|---|
| ENV-PRISMA-001 | ACTION_REQUIRED | Local `@apps/api dev` locks Prisma's Windows query-engine DLL, so normal generate/migrate cannot safely replace it. | Stop the local API process before the migration step, or apply `pnpm db:migrate:deploy` in Railway/CI. Do not delete DLLs or kill unrelated user processes. |
| EXT-EMAIL-001 | ACTION_REQUIRED | Production transactional email needs a verified sender and API key. | Create/verify a Resend sending domain, then set Railway `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`, and optional `EMAIL_REPLY_TO`. |
| EXT-GOOGLE-001 | ACTION_REQUIRED | Google OAuth client has been created, but the live API and web build do not yet have its public Client ID. | Set Railway `GOOGLE_AUTH_ENABLED=true`, `GOOGLE_WEB_CLIENT_ID=<your Web client ID>`; set Vercel `PUBLIC_GOOGLE_WEB_CLIENT_ID=<same Web client ID>`; redeploy both. No client secret is used or requested. |
| EXT-GOOGLE-002 | ACTION_REQUIRED | Real browser authorization needs a Google account selected in the Google popup. | After the deployment is live, sign in with a dedicated test Google account in the browser and approve the standard profile/email prompt. |
