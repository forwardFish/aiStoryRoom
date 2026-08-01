# OpenNovel-first runtime

This is the isolated `OPENOVEL_V1` runtime described by
`docs/Our_Many_Worlds_桑田诏_OpenNovel_First运行时迁移与验证方案_v2.0.md`.
It is intentionally separate from `apps/api/src/solo-story-engine`.

## Authority and turn order

For this mode the per-run file workspace is the story runtime authority:

```text
reader action
-> append-only scene log
-> normalize intent + build a short Causal Delta
-> context-card activation
-> compact foreground context
-> streamed narrator prose
-> explicit P0 durable-boundary checks
-> Canon commit
-> asynchronous Storykeeper update for the next turn
-> optional post-narration choices
-> durable, non-blocking mirror outbox
```

The old deterministic Solo engine is not imported and its Chinese semantic
validator never runs on `OPENOVEL_V1` prose. Recent Canon owns current camera
truth (gesture, position, ordinary props and dialogue continuity). The server
keeps durable causality strict only for explicit P0 events: unauthorized new
named actors/evidence/formal documents or orders, key ownership/state changes,
secret leakage, actions taken on the player's behalf, and an explicitly
declared `presentThisTurn` result that the narration omitted. Unsupported
quantities, locations, custody claims, language texture and similar uncertain
findings go to Shadow with `blocksPlayer: false`.

## Local commands

```powershell
pnpm --filter @apps/openovel-runtime typecheck
pnpm --filter @apps/openovel-runtime test
pnpm --filter @apps/openovel-runtime dev:test
pnpm --filter @apps/openovel-runtime smoke:http
pnpm --filter @apps/openovel-runtime smoke:test -- --turns=3
pnpm --filter @apps/openovel-runtime audit:run -- --run-id=<RUN_ID> --target-turns=5
```

`smoke:http` uses a local scripted OpenAI-compatible provider and a disposable
Workspace. It exercises the real HTTP/SSE service from G00 through T03,
including one Options outage, free-text continuation, three Storykeeper
updates, and process restart recovery. It never calls or charges the configured
external model and is an engineering gate only, not player story acceptance.

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

Narrator defaults to non-thinking streaming at temperature `0.86`; evidence-bound
answers are capped while closed-list formal-document turns use `0.1`, so exact
approved clauses remain stable without lowering the creativity of ordinary
scenes. Options use
`0.55`; Storykeeper uses `0.35`.

Options have their own non-streaming deadline (`OPENOVEL_OPTIONS_TIMEOUT_MS`,
default 120 seconds, configurable from 5 to 180 seconds). Canon has already
been committed when the Options call begins, so an Options timeout leaves
`options: []` and free text remains available.

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

## Railway service contract

Deploy this runtime as a third Railway service, separate from the API and
worker. Use `deploy/railway/openovel-runtime.toml` as its service config.

Mount exactly one persistent volume at `/data/openovel-v1` and set:

```text
OPENOVEL_WORKSPACE_ROOT=/data/openovel-v1
OPENOVEL_RUNTIME_HOST=0.0.0.0
OPENOVEL_INTERNAL_TOKEN=<shared secret with API>
```

The service accepts Railway's injected `PORT`. Its unauthenticated liveness
endpoint is `/health`; all story endpoints remain under `/internal/openovel/*`
and require `OPENOVEL_INTERNAL_TOKEN` in production. The API uses
`OPENOVEL_RUNTIME_URL` to reach the service over Railway private networking.

Foreground writes use a renewable file lease at
`story/state/foreground.lock`, so two runtime processes sharing the volume
cannot append the same Run concurrently. Set
`OPENOVEL_FOREGROUND_LEASE_TTL_MS` only when the default 120 seconds is not
long enough for the selected model.

Storykeeper uses a separate renewable lease at
`story/state/storykeeper.lock`; this preserves one Drain Loop per Run across
multiple service processes without blocking foreground narration. Its default
TTL is 600 seconds and can be overridden with
`OPENOVEL_STORYKEEPER_LEASE_TTL_MS`.

When `OPENOVEL_MIRROR_URL` is configured, every product-database mirror event
is appended to `story/state/mirror-queue.jsonl` before delivery. A separate
per-Run mirror lease drains it to the API's private
`/api/internal/openovel/mirror` endpoint. Failed deliveries remain pending and
are retried on the next publish or runtime restart; they never roll back Canon.
Configure the same `OPENOVEL_MIRROR_TOKEN` on both private services.

## Current playable-story acceptance

The current release target is one fresh G00 -> T05 run that remains readable
and playable. Review the visible story and choices as a real player and ask:

```text
Did the previous action receive a concrete response?
Does the prose read like a novel rather than a state report?
Did NPCs or external pressure act independently?
Are the visible choice labels understandable?
Did a real durable-causality P0 occur?
Can the player continue, including through free text?
```

Keep the raw Narrator and Options requests/responses, before/after Canon,
explicit P0 findings, and the short player review. Merkle roots, zero-retry
certification, blind-auditor isolation, and other release-proof machinery are
not gates for this stage.

`audit:run` remains an optional diagnostic that reads one Run Workspace and
reports engineering evidence separately from player review. It must not be
used as a substitute for reading the actual story. To inspect a run:

```powershell
pnpm --filter @apps/openovel-runtime audit:run -- `
  --run-id=<RUN_ID> `
  --target-turns=5 `
  --reviews=<ABSOLUTE_PATH_TO_COMPLETED_REVIEW_JSON> `
  --input-price-per-million=<CURRENT_MODEL_INPUT_PRICE> `
  --output-price-per-million=<CURRENT_MODEL_OUTPUT_PRICE> `
  --currency=CNY `
  --output=<ABSOLUTE_PATH_TO_REPORT_JSON>
```

After G00 -> T05 passes, extend the same frozen model, workspace assets and
runtime behavior toward T20. Pricing is never hard-coded: omit the two price
arguments when the current provider rate is unknown, and the report records
cost as `null`.

## Third-party source

The upstream revision and Apache-2.0 license are recorded under
`third_party/openovel/`. See
`docs/third-party/openovel-attribution.md`.
