# B0 USER_TEST_READY_HANDOFF

## 1. Frozen user-test candidate

| Field | Value |
|---|---|
| Repository | `forwardFish/aiStoryRoom` |
| Remote branch | `codex/chatgpt-pro-maneuver-evidence-v1` |
| `testableCandidateSha` | `483911272191964a22d14966163aee5f99968b1d` |
| Candidate commit | `fix(seed): build the shared runtime on a clean checkout` |
| Exact engineering run | `31406011925` |
| Engineering six-window run | `31406011926` |
| Main ancestry baseline | `86da64eea18ab773312f40c7024ace9cb393344a` |
| User-test readiness | `READY_FOR_LOCAL_USER_TEST` |
| Formal C8 state | `EXTERNAL_BLOCKED` |
| Formal candidate readiness | `candidateBranchReady=false` |

Test the immutable product SHA below rather than an evidence or documentation commit that may later become the branch tip.

```powershell
git fetch origin codex/chatgpt-pro-maneuver-evidence-v1
git checkout --detach 483911272191964a22d14966163aee5f99968b1d
if ((git rev-parse HEAD).Trim() -ne "483911272191964a22d14966163aee5f99968b1d") {
  throw "wrong candidate SHA"
}
git status --short
```

Expected final command output: no changed files.

## 2. Remote gates passed on this exact SHA

### Exact engineering gates

Workflow run `31406011925` completed with `b0/exact-push = success`.

Passed jobs include:

- frozen `pnpm install --frozen-lockfile`;
- Prisma client generation;
- root, Shared, Templates, API, OpenNovel Runtime and Web typechecks;
- B0 contract, batch, multi-role and typed-audience tests;
- API B0 commit, window coordinator, player window, Worker/Outbox and operations tests;
- full API regression;
- full Web regression on Node 24;
- Story V4 contracts and runtime;
- Maneuver acceptance matrix;
- Causal aggregate;
- Shared, Templates, API, OpenNovel Runtime, Web and root builds;
- exact candidate archive and remote-SHA verification;
- the clean-clone seed gate described below.

### Clean-clone migration and seed proof

Run `31406011925`, job `93512417453`, checked out the exact candidate SHA into a clean GitHub Actions workspace and used an isolated PostgreSQL 16 service.

The job executed:

```text
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed
```

Results:

```json
{
  "testedCodeSha": "483911272191964a22d14966163aee5f99968b1d",
  "command": "pnpm db:seed",
  "exitCode": 0,
  "seedReadback": {
    "templateCount": 5,
    "userCount": 1,
    "runCount": 1
  },
  "changedFileSecretScan": "PASS"
}
```

`pnpm db:seed` now loads the repository-root `.env` when it exists. On a clean checkout it also builds the Shared runtime only when `packages/shared/dist/index.js` is absent, then seeds the database. No separate manual build command is required.

Proof artifact:

```text
b0-user-test-seed-483911272191964a22d14966163aee5f99968b1d
artifact id: 9069657258
artifact SHA-256: 8f57793675e22549af0ddf7a6523c6287a6905df625a643e1251deccfb6215df
```

### Core real execution

Workflow run `31406011926` completed with:

```text
b0/acceptance-contract = success
b0/engineering-real-acceptance = success
b0/formal-c8 = failure (expected fail-closed external credential blocker)
```

The engineering acceptance used:

- a real Nest API, static Web server and OpenNovel runtime;
- embedded and independent Workers;
- three isolated Chromium sessions and six synchronized decision windows;
- desktop viewports and a `390px` narrow viewport;
- official self-hosted Supabase PostgreSQL in a random isolated engineering schema;
- a real OpenAI-compatible Ollama request path with fallback prohibited;
- schema creation, migrations, database readback and random-schema cleanup.

Covered phases include synchronized maneuver submission, idempotent settlement/publication/outbox replay, Narrative success and failure/retry, privacy isolation, pause/resume, deadline/HOLD, Worker switching, lease expiry, Worker/API crash recovery, AI-draft recovery, the correct immediate successor and ending.

Engineering result: `PASS_ENGINEERING_ONLY`. It is not a substitute for formal managed-Supabase C8.

## 3. Local prerequisites

- Git
- Node.js 22
- pnpm 10
- Docker Desktop
- Chrome or Edge with three isolated profiles or contexts

Enable pnpm when needed:

```powershell
corepack enable
corepack prepare pnpm@10 --activate
```

## 4. Local stack setup — PowerShell

### 4.1 Install and infrastructure

```powershell
pnpm install --frozen-lockfile
docker compose up -d postgres redis
```

### 4.2 Create the local-only `.env`

Create `.env` at the repository root. The values below are local development values; replace the placeholder secrets and never commit the file.

```dotenv
NODE_ENV=development
API_PORT=3001
DATABASE_URL=postgresql://ai_story:ai_story_pwd@127.0.0.1:5432/ai_story_run?schema=public
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
JWT_SECRET=replace-with-a-long-local-secret
AUTH_TOKEN_SECRET=replace-with-a-different-long-local-secret
AUTH_COOKIE_SECURE=false
MVP_STORY_STORAGE=prisma
MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED=true
STORY_WORKER_EMBEDDED=true
CONTINUOUS_TIMING_PROFILE=manual-three-page
ROLE_AGENT_PROVIDER=rules
AI_PROVIDER=mock
AI_CAUSAL_PROVIDER=rules
ENABLE_MOCK_LOGIN=true
ENABLE_MOCK_AI=true
ENABLE_MOCK_AUDIT=true
EMAIL_PROVIDER=file-sink
AUTH_MAIL_SINK_FILE=.auth-mail-sink.ndjson
PUBLIC_WEB_URL=http://localhost:5200
PUBLIC_API_URL=http://localhost:3001
CREDIT_DEFAULT_POLICY=world_unlock_v1
CREDIT_ACTION_METERING_MODE=OFF
OPENOVEL_RUNTIME_URL=http://127.0.0.1:3110
OPENOVEL_INTERNAL_TOKEN=replace-with-a-third-long-local-secret
OPENOVEL_PROVIDER_BASE_URL=http://127.0.0.1:11434/v1
OPENOVEL_API_KEY=local-ollama-non-secret
OPENOVEL_MODEL=qwen2.5:1.5b
OPENOVEL_NARRATOR_MODEL=qwen2.5:1.5b
OPENOVEL_REVIEWER_MODEL=qwen2.5:1.5b
OPENOVEL_OPTIONS_MODEL=qwen2.5:1.5b
OPENOVEL_STORYKEEPER_MODEL=qwen2.5:1.5b
```

For an approved external-provider run, the relevant non-sensitive variable names are `DEEPSEEK_API_KEY`, `OPENOVEL_API_KEY`, `OPENOVEL_PROVIDER_BASE_URL` and `OPENOVEL_MODEL`. Do not commit values.

### 4.3 Start the local narrative provider

```powershell
docker rm -f omw-ollama 2>$null
docker run -d --name omw-ollama -p 11434:11434 ollama/ollama:0.32.5
docker exec omw-ollama ollama pull qwen2.5:1.5b
```

### 4.4 Apply migrations and seed

Run these commands exactly from the repository root:

```powershell
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed
```

`pnpm db:seed` must exit with code `0`. A missing `DATABASE_URL` or missing Shared runtime is a setup failure and should not be ignored.

### 4.5 Start services in three terminals

Terminal A — OpenNovel runtime:

```powershell
$env:PORT="3110"
pnpm --filter @apps/openovel-runtime dev
```

Terminal B — API with embedded Story Worker:

```powershell
pnpm dev:api
```

Terminal C — Web:

```powershell
$env:PORT="5200"
$env:API_PORT="3001"
pnpm dev:web
```

Entry URLs:

- API health: `http://localhost:3001/api/health`
- OpenNovel health: `http://localhost:3110/health`
- account entry: `http://localhost:5200/auth?returnTo=%2Frooms`
- room hall: `http://localhost:5200/rooms`
- Sangtian world: `http://localhost:5200/worlds/sangtian`
- active game: `http://localhost:5200/game?runId=<room-id>`

## 5. Create three isolated local accounts

Open the account entry in three isolated browser profiles. In each profile:

1. select `Sign up`;
2. use a different local email, a password of at least eight characters and a display name;
3. submit the form.

Development verification messages are written to `.auth-mail-sink.ndjson`. Print the newest links:

```powershell
node -e "const fs=require('fs');const p='.auth-mail-sink.ndjson';const rows=fs.readFileSync(p,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);for(const m of rows.slice(-3)){const u=(m.text.match(/https?:\/\/\S+/)||[])[0];console.log(m.to+'  '+u)}"
```

Open each link in its matching browser profile.

## 6. Ten-to-fifteen-minute manual B0 test

1. Profile A creates a `嘉靖财政危局` room from `/rooms`.
2. Profiles B and C join with the invite code.
3. Each profile chooses a distinct role and becomes ready; the host starts the game. Empty roles must be assigned to AI.
4. Confirm all three profiles show the same Decision Window ordinal with role-specific private content.
5. In each profile choose or enter a bounded maneuver, then click `Preview`, `Confirm this plan` and `Ready`.
6. After the final required Ready, confirm one shared settlement, visible structured results, Narrative output and exactly one successor window.
7. Compare profiles: each player may see their own `PERSONAL_OUTCOME` and lawful public/targeted effects, but never another role's private plan text or private evidence.
8. Refresh and retry permitted Confirm/Ready gestures. Confirm there is no duplicate settlement, duplicate Narrative or extra `worldSequence` advance.
9. Set Profile C to `390px` width. Confirm the maneuver panel, Preview/Confirm/Ready controls, results and navigation remain operable without horizontal page overflow.
10. Refresh all profiles. Confirm the committed result and successor are reconstructed from the server/database.

A visible failure includes a private-plan leak, duplicate settlement, missing or duplicate successor, disappearing result after refresh, or non-operable 390px controls.

## 7. Optional independent-Worker smoke

After one embedded-worker window:

1. stop the API;
2. set `STORY_WORKER_EMBEDDED=false` in `.env`;
3. restart `pnpm dev:api`;
4. start `pnpm dev:story-worker` in another terminal;
5. complete another shared window.

Expected: settlement and Narrative complete through the independent Worker and remain durable after API or Worker restart.

## 8. Useful verification commands

```powershell
pnpm typecheck
pnpm --filter @apps/api test:b0-batch
pnpm --filter @apps/api test:b0-window
pnpm --filter @apps/api test:b0-player-window
pnpm --filter @apps/api test:b0-pipeline
pnpm --filter @apps/api test:b0-ops
pnpm --filter @apps/web test:b0-window
pnpm test:maneuver
pnpm test:story:v4
pnpm --filter @apps/api build
pnpm --filter @apps/openovel-runtime build
pnpm --filter @apps/web build
```

## 9. Known limitations and boundaries

- Formal C8 remains `EXTERNAL_BLOCKED`: no complete approved pair of a managed non-production Supabase URL and a real Provider credential was available in the probed GitHub Environments.
- The self-hosted Supabase/Ollama run is engineering proof only and must not be relabeled as formal C8.
- `candidateBranchReady=false` and formal completion markers remain forbidden until formal C8 succeeds.
- No deployment is included.
- No PR was created or modified; no force push was used.
- `main`, `release`, production databases, production configuration and real-user data are outside this test path.
