# Authentication deployment and real-acceptance runbook

## Preconditions owned by the account administrator

1. Google Web Client has origins for `http://localhost:5177`, `https://ourmanyworlds.com`, and `https://www.ourmanyworlds.com` (plus an explicit staging origin if used). GIS popup mode does not use a redirect URI or client secret.
2. A Resend-owned sending subdomain such as `updates.ourmanyworlds.com` is verified through the exact SPF/DKIM records shown by the Resend dashboard.
3. A Resend `Sending access` key restricted to that domain has been stored directly in Railway. Never put it in Git, a document, a browser screenshot, or an API response.

## Railway production variables

```dotenv
NODE_ENV=production
AUTH_TOKEN_SECRET=<strong-existing-or-new-random-secret>
PUBLIC_WEB_URL=https://ourmanyworlds.com
CORS_ALLOWED_ORIGINS=https://ourmanyworlds.com,https://www.ourmanyworlds.com
EMAIL_PROVIDER=resend
RESEND_API_KEY=<resend-secret>
EMAIL_FROM=Many Worlds <noreply@updates.ourmanyworlds.com>
EMAIL_REPLY_TO=<monitored-support-address>
EMAIL_VERIFY_TTL_MINUTES=30
PASSWORD_RESET_TTL_MINUTES=15
GOOGLE_AUTH_ENABLED=true
GOOGLE_WEB_CLIENT_ID=<Google-Web-Client-ID>
GOOGLE_LOGIN_CHALLENGE_TTL_SECONDS=300
```

## Vercel production variable

```dotenv
PUBLIC_GOOGLE_WEB_CLIENT_ID=<the-same-Google-Web-Client-ID>
```

## Deployment checks

1. Deploy the scoped authentication code. Railway runs `pnpm db:migrate:deploy` before its API process starts.
2. Check `GET https://appsapi-test.up.railway.app/api/health/ready` (or the current API deployment URL). The response must contain `database.ready: true` and `email.ready: true`; it must not disclose any key or token.
3. Check `GET https://ourmanyworlds.com/runtime-config.js`. It must contain a `googleWebClientId` only, never a `client_secret` or Resend key.
4. Open `https://ourmanyworlds.com/auth` in a private browser profile. The official Google button must render, and email login must remain available.

## Real evidence matrix

| ID | Action | Required evidence (redacted) |
|---|---|---|
| AUTH-LIVE-EMAIL-01 | Register a new test inbox from `/auth`. | API response has no token; Resend delivery ID and inbox verification email exist. |
| AUTH-LIVE-EMAIL-02 | Open verification link once, then repeat it. | First reaches safe original return path with a valid session; second is rejected without a second side effect. |
| AUTH-LIVE-EMAIL-03 | Attempt business API with the unverified account before opening the link. | `/v4/credits/balance`, room creation, and checkout are rejected. |
| AUTH-LIVE-EMAIL-04 | Request and use a password-reset email. | New password works; old password and reset-link replay fail. |
| AUTH-LIVE-GOOGLE-01 | Sign in with Google test account A through the official button. | Browser returns to the original invite/room path; `GET /v4/auth/me` succeeds. Do not record credential, nonce, or raw subject. |
| AUTH-LIVE-GOOGLE-02 | Repeat with Google account A and then account B. | A has one local identity/user across repeats; B is distinct. |
| AUTH-LIVE-GOOGLE-03 | Test a pre-existing password account with a non-Gmail/non-Workspace email. | Google login refuses silent merge and requires explicit linking. |
| AUTH-LIVE-GOOGLE-04 | Sign out. | Local token is removed and GIS auto-select is disabled; a stale or unlinked Google identity cannot authorize the API. |

## Evidence storage policy

Record timestamps, redacted delivery IDs, redacted user/identity IDs, HTTP status codes, and screenshots without email addresses or secrets. Never store raw email tokens, Google credentials, nonces, client secrets, Resend API keys, or complete Google subjects.
