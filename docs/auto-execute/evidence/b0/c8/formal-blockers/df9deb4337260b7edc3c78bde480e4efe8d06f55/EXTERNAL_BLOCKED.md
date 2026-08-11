# B0 Formal Managed-Supabase Acceptance — External Blocker

## Exact probe

- branch: `codex/chatgpt-pro-maneuver-evidence-v1`
- formal probe SHA: `df9deb4337260b7edc3c78bde480e4efe8d06f55`
- workflow: `B0 Candidate Engineering and Formal Supabase Acceptance`
- run ID: `31445997490`
- acceptance contract: `PASS`
- formal C8: `NOT EXECUTED`
- commit status: `b0/formal-c8 = failure`
- USER_TEST_READY: `false`
- candidateBranchReady: `false`

## Read-only credential result

The workflow inspected only Secret existence in the three approved non-production GitHub Environments. It did not print or persist values.

| Environment | Accepted managed-Supabase database Secret present | Accepted Provider Secret present | Complete pair |
|---|---:|---:|---:|
| `ourmanyworlds.com / test` | No | No | No |
| `stellar-encouragement / test` | No | No | No |
| `Preview` | No | No | No |

All accepted database aliases were absent in all three Environments:

- `SUPABASE_DATABASE_URL`
- `TEST_DATABASE_URL`
- `SUPABASE_TEST_DATABASE_URL`
- `TEST_SUPABASE_DATABASE_URL`
- `DATABASE_URL_TEST`
- `PREVIEW_DATABASE_URL`
- `STAGING_DATABASE_URL`

All accepted Provider aliases were absent in all three Environments:

- `DEEPSEEK_API_KEY`
- `OPENOVEL_DEEPSEEK_API_KEY`
- `LLM_API_KEY`
- `AI_API_KEY`

## Minimal authorized action

A repository administrator must first receive explicit user authorization, then use the GitHub security UI:

```text
Repository Settings
→ Environments
→ choose exactly one approved non-production Environment
→ Environment secrets
```

In that same Environment, configure:

1. one accepted database Secret whose value points to an existing **managed non-production Supabase PostgreSQL** project and can create/drop a random isolated Schema;
2. one accepted DeepSeek Provider Secret.

Do not place either value in chat, source code, logs, screenshots, attachments or evidence documents. Do not create a new Supabase project or change online configuration without explicit authorization.

## Safe trigger after authorization

Open GitHub Actions run `31445997490` and select **Re-run all jobs**. The rerun uses the same exact SHA and reads the Environment Secrets again.

Formal C8 will execute only after the workflow finds a complete pair in one approved Environment. The run must then prove:

- managed Supabase cloud provenance;
- random Schema creation, migration, seed and readback;
- `public` Schema isolation before and after;
- three roles, three isolated sessions and six synchronized Windows;
- privacy, idempotency, Narrative and Worker behavior;
- pause/resume, deadline, lease and crash recovery;
- AI draft recovery and one correct successor;
- desktop and 390px `/game` operation;
- random Schema deletion and absence readback;
- real DeepSeek traffic with fallback forbidden;
- redaction, artifact hashes, docs-only evidence commit and fresh-clone verification.

Local PostgreSQL, Docker PostgreSQL, self-hosted Supabase/Postgres, Ollama, mock, fixture, stub, deterministic Provider and fallback remain auxiliary diagnostics only and cannot change this blocker to PASS.

## Artifact integrity

- blocker artifact ID: `9084552325`
- artifact ZIP bytes: `785`
- artifact ZIP SHA-256: `50835db550f923d431186e2915099d2c8f4bd6551bed3a946c1217cbc322e77b`
- blocker JSON bytes: `1157`
- blocker JSON SHA-256: `7133fc5c8e1895e9a96e47487797348089b6c2d98529f00263c1b1cef9630313`

No PR, force push, deployment, production database/configuration access or real-user-data operation was performed.
