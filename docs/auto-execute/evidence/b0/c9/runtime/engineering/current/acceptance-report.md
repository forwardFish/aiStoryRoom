# B0 C9 Real Acceptance Report

- Status: **PASS**
- Tested code SHA: `14c1e871f75f3c597919f7cbcd1d035851ebf142`
- Acceptance tier: `engineering-selfhosted`
- Started: 2026-08-10T17:40:46.399Z
- Completed: 2026-08-10T17:43:14.880Z
- Database: official self-hosted Supabase PostgreSQL image supabase/postgres:15.14.1.157-mmlb_amd64 in a random isolated engineering schema; the public schema was not used or modified.
- Narrative provider: real local Ollama model qwen2.5:1.5b from image ollama/ollama:0.32.5 over OpenAI-compatible HTTP; deterministic/mock providers and fallback are prohibited.
- Runtime: real Nest API, static Web server, OpenNovel runtime, embedded and independent worker processes.
- Browser: three isolated Chromium profiles, including desktop and 390px narrow viewport.

## Phases

- ✅ window-1-embedded-real-narrative
- ✅ idempotent-settlement-publication-outbox-replay
- ✅ window-2-narrative-failure-does-not-rollback-and-retry
- ✅ window-3-pause-current-completes-next-does-not-open-resume
- ✅ window-4-deadline-unconfirmed-human-becomes-hold
- ✅ switch-to-independent-worker
- ✅ window-5-independent-worker
- ✅ window-6-worker-crash-lease-expiry-recovery-and-ending
- ✅ single-human-ai-action-contract-and-safe-abort
- ✅ browser-dom-network-privacy-and-readback

## Trust boundary

This report records only sanitized identifiers, hashes, counts, status transitions, DOM summaries, network status metadata, and screenshots. Database URLs, provider keys, session cookies, Bearer [REDACTED], and internal shared tokens are excluded and scrubbed from process logs.
