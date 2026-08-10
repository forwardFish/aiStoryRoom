# B0 USER_TEST_READY_HANDOFF

## 1. Frozen user-test candidate

| Field | Value |
|---|---|
| Repository | `forwardFish/aiStoryRoom` |
| Remote branch | `codex/chatgpt-pro-maneuver-evidence-v1` |
| `testableCandidateSha` | `ce371aef55fffa73d8fe3d1ae6d18fb8c48b238b` |
| Candidate commit | `ci(b0): force-add the ignored evidence tree` |
| Freeze readback | `origin/codex/chatgpt-pro-maneuver-evidence-v1 = ce371aef55fffa73d8fe3d1ae6d18fb8c48b238b` |
| Main ancestry baseline | `86da64eea18ab773312f40c7024ace9cb393344a` |
| User-test readiness | `READY_FOR_LOCAL_USER_TEST` |
| Formal C8 state | `EXTERNAL_BLOCKED` |
| Formal candidate readiness | `candidateBranchReady=false` |

The exact product candidate is immutable and must be tested by SHA, not by whatever documentation/evidence commit later becomes the branch tip.

```powershell
git fetch origin codex/chatgpt-pro-maneuver-evidence-v1
git checkout --detach ce371aef55fffa73d8fe3d1ae6d18fb8c48b238b
if ((git rev-parse HEAD).Trim() -ne "ce371aef55fffa73d8fe3d1ae6d18fb8c48b238b") { throw "wrong candidate SHA" }
git status --short
```

Expected final command output: no changed files.

## 2. Remote gates already passed on this exact SHA

### Exact candidate engineering gates

Workflow run: `31352549164` — `B0 Candidate Engineering Gates` — `success`.

Passed jobs:

- frozen `pnpm install`, Prisma generation, root/API/Web/OpenNovel typechecks;
- full API regression;
- full Web regression on Node 24;
- Story V4 contracts and runtime;
- Maneuver acceptance matrix;
- focused B0 contract, batch, multi-role and typed-audience tests;
- API B0 commit, window coordinator, player window, worker/outbox and operations tests;
- causal aggregate;
- Shared, Templates, API, OpenNovel runtime, Web and root builds;
- exact candidate archive and remote-SHA check.

### Core real execution

Workflow run: `31352549166`.

The engineering acceptance job passed against `ce371aef55fffa73d8fe3d1ae6d18fb8c48b238b` using:

- a real Nest API, static Web server, OpenNovel runtime, embedded worker and independent worker;
- three isolated Chromium profiles and six synchronized decision windows;
- desktop viewports and a `390px` narrow viewport;
- official self-hosted Supabase PostgreSQL in a random isolated schema;
- a real OpenAI-compatible Ollama request path with fallback prohibited;
- schema creation, Prisma migration/readback and random-schema cleanup.

Passed execution phases:

1. synchronized window 1 with real narrative;
2. idempotent settlement, publication and outbox replay;
3. narrative failure without settlement rollback, followed by retry;
4. pause: current window completes, successor does not open until resume;
5. deadline: an unconfirmed human becomes `HOLD`;
6. switch from embedded to independent worker;
7. independent-worker settlement;
8. Worker/API crash, lease expiry, AI-draft recovery, correct successor and ending;
9. single-human plus AI action-contract path and safe abort;
10. browser DOM, network, private-information isolation and database readback.

Engineering result: `PASS_ENGINEERING_ONLY`. It is not a substitute for formal C8.

## 3. Local prerequisites

- Git
- Node.js 22
- pnpm 10 (`corepack enable`, then `corepack prepare pnpm@10 --activate` when needed)
- Docker Desktop
- Chrome or Edge with three separate browser profiles or three isolated InPrivate/Incognito contexts

## 4. Local stack setup — PowerShell

### 4.1 Install and infrastructure

```powershell
corepack enable
corepack prepare pnpm@10 --activate
pnpm install --frozen-lockfile
docker compose up -d postgres redis
```

### 4.2 Create the non-production local environment

Create `.env` at the repository root with the following local-only values. Change the three local secrets to any long random strings; do not commit the file.

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

The environment-variable names needed for a real external-provider run are `DEEPSEEK_API_KEY`, `OPENOVEL_API_KEY`, `OPENOVEL_PROVIDER_BASE_URL` and `OPENOVEL_MODEL`. No credential value belongs in Git.

### 4.3 Start the local narrative provider

```powershell
docker rm -f omw-ollama 2>$null
docker run -d --name omw-ollama -p 11434:11434 ollama/ollama:0.32.5
docker exec omw-ollama ollama pull qwen2.5:1.5b
```

### 4.4 Apply migrations and seed

```powershell
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed
```

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

Health and entry URLs:

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

The development email provider writes verification messages to `.auth-mail-sink.ndjson`. Print the most recent verification links:

```powershell
node -e "const fs=require('fs');const p='.auth-mail-sink.ndjson';const rows=fs.readFileSync(p,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);for(const m of rows.slice(-3)){const u=(m.text.match(/https?:\/\/\S+/)||[])[0];console.log(m.to+'  '+u)}"
```

Open each account's link in its corresponding browser profile. Verification creates the HttpOnly session cookie and returns the player to the room flow.

## 6. Ten-to-fifteen-minute manual B0 test

Assumption: the stack and three verified accounts are already ready.

1. **Host creates the room.** Profile A opens `/rooms`, selects `Create Room`, chooses `嘉靖财政危局`, and creates the room. Expected: a waiting-room page with an invite code and role cards.
2. **Two players join.** Profiles B and C open `/rooms`, select `Join with Code`, enter the six-character invite code and join. Expected: all three profiles show the same room membership.
3. **Three distinct roles.** Each profile chooses a different role. Each clicks `Ready`; the host clicks `Start Game`. Expected: remaining roles are explicitly assigned to AI and every human enters `/game?runId=<same-room-id>`.
4. **Window synchronization.** All profiles must show `Decision Window`. Expected: the same window ordinal/situation, with role-specific private content.
5. **Submit three maneuvers.** In each profile use the existing maneuver panel, choose/enter a different bounded action, click `Preview`, then `Confirm this plan`, then `Ready`. Expected: Preview does not mutate the world; Confirm locks only that role's revision; Ready contributes to the shared freeze.
6. **Settlement.** After the last required ready action, wait for the embedded Worker. Expected on all profiles: `Plan locked`, followed by `Situation Results` and a narrative result. The next window appears exactly once.
7. **Privacy check.** Compare the three profiles. Expected: each player sees their own `PERSONAL_OUTCOME` and only targeted/public cross-player effects; another role's private plan text or private evidence must not appear.
8. **Idempotency check.** Refresh one profile and repeat the previous Confirm/Ready gesture where the UI permits it. Expected: no duplicate settlement, duplicate result, duplicate narrative or extra world-sequence advance.
9. **Narrow viewport.** In Profile C set DevTools responsive width to `390px`. Expected: the maneuver panel, Preview/Confirm/Ready controls, results and navigation remain operable without horizontal page overflow.
10. **Readback check.** Refresh all three profiles. Expected: the same committed result and successor window are reconstructed from the server/database rather than reset from browser state.

A visible failure is any private-plan leak, two settlements for one window, a missing successor after resume/recovery, an extra successor, non-operable `390px` controls, or a result that disappears after refresh.

## 7. Optional independent-Worker smoke

After completing one embedded-worker window:

1. stop the API;
2. change `STORY_WORKER_EMBEDDED=false` in `.env`;
3. restart `pnpm dev:api`;
4. start a fourth terminal with `pnpm dev:story-worker`;
5. complete another shared window.

Expected: settlement and narrative complete through the independent Worker and remain durable after API or Worker restart. Fault-injection variables are intentionally omitted from this user handoff; the exact-SHA remote acceptance already exercised crash, lease expiry, AI-draft recovery and the immediate correct successor.

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

## 9. Known limitations and items not represented as PASS

- Formal C8 is `EXTERNAL_BLOCKED`: no complete approved pair of a managed non-production Supabase URL and a real provider credential was available in the probed GitHub Environments.
- The self-hosted Supabase/Ollama run is engineering proof only. It must not be relabeled as formal managed-Supabase C8.
- `candidateBranchReady=false` and formal completion markers remain forbidden until formal C8 succeeds.
- There is no deployment in this handoff. A Vercel build-rate-limit status is not a product-test failure and is not used as evidence.
- No PR was created or modified. No force push was used. `main`, `release`, production databases, production configuration and real-user data are outside this test path.
