# OpenNovel-first runtime

This is the isolated `OPENOVEL_V1` runtime described by
`docs/Our_Many_Worlds_桑田诏_OpenNovel_First运行时迁移与验证方案_v2.0.md`.
It is intentionally separate from `apps/api/src/solo-story-engine`.

## Authority and turn order

For this mode the per-run file workspace is the story runtime authority:

```text
reader action
-> append-only scene log
-> context-card activation
-> compact foreground context
-> streamed narrator prose
-> surface-only safety checks
-> optional post-narration choices
-> Canon commit
-> non-blocking mirror
-> asynchronous Storykeeper update
```

The old deterministic Solo engine is not imported and its Chinese semantic
validator never runs on `OPENOVEL_V1` prose. Shadow continuity findings are
warnings with `blocksPlayer: false`.

## Local commands

```powershell
pnpm --filter @apps/openovel-runtime typecheck
pnpm --filter @apps/openovel-runtime test
pnpm --filter @apps/openovel-runtime dev:test
pnpm --filter @apps/openovel-runtime smoke:test -- --turns=3
```

After `dev:test` starts, the player-only local playtest is available at:

```text
http://127.0.0.1:3110/play
```

It creates or restores a real Sangtian `OPENOVEL_V1` run, streams narration,
shows only player-facing option labels, and always keeps free-text action
available. It does not render option effects, Storykeeper state, prompts,
warnings, or model diagnostics. The playtest route is disabled in production
unless `OPENOVEL_PLAYTEST_ENABLED=1`.

For shell-safe Chinese actions, the smoke CLI accepts UTF-8 Base64:

```powershell
$actionText = "继续追问，但不签发文书"
$encodedAction = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($actionText))
pnpm --filter @apps/openovel-runtime smoke:test -- --turns=1 --run-id=my_run "--action-base64=$encodedAction"
```

Runtime files default to `.runtime/openovel-v1/` beneath the process working
directory and are ignored by Git. Override with `OPENOVEL_WORKSPACE_ROOT`.

Provider configuration uses the first available values:

```text
OPENOVEL_API_KEY | SOLO_STORY_API_KEY | DEEPSEEK_API_KEY
OPENOVEL_PROVIDER_BASE_URL | SOLO_STORY_BASE_URL | DEEPSEEK_BASE_URL
OPENOVEL_MODEL | SOLO_STORY_MODEL
```

Narrator defaults to non-thinking streaming at temperature `0.86`; Options use
`0.55`; Storykeeper uses `0.35`.

## Internal HTTP API

```text
POST /internal/openovel/runs
POST /internal/openovel/runs/:runId/actions
GET  /internal/openovel/runs/:runId
GET  /internal/openovel/runs/:runId/jobs
GET  /internal/openovel/health
GET  /internal/openovel/providers
```

Set `OPENOVEL_INTERNAL_TOKEN` in production. The action endpoint streams:

```text
narration.delta
narration.complete
options.complete
runtime.warning
turn.committed
```

Options and Storykeeper failures do not roll back the narration. Public
responses omit hidden option effects.

At startup the service scans existing workspaces, marks interrupted foreground
states retryable without changing Canon, and re-kicks each run's Storykeeper
drain.

## Third-party source

The upstream revision and Apache-2.0 license are recorded under
`third_party/openovel/`. See
`docs/third-party/openovel-attribution.md`.
