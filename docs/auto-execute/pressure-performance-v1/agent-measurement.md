# Pressure Measurement Diagnosis

## Scope

- Worktree only: `D:\tmp\aiStoryRoom-pressure-performance-v1`
- This note is diagnosis/design only.
- Do not edit product code, Prisma schema, migrations, or any file except this note.
- Do not run broad suites. Use one fixed baseline run and one fixed after-run only.

## Findings

### 1. Why Prisma query events may currently emit nothing

- `apps/api/src/prisma.service.ts` registers `this.$on("query", ...)`, but `PrismaClient` is constructed as `super()` with no `log` event config.
- In Prisma, query events are not emitted just because `$on("query")` exists; the client must be created with query logging configured as event emission.
- Result: `apps/api/src/pressure-chapter/observability/pressure-db-metrics.ts` can stay active in `AsyncLocalStorage`, while `applicationSqlStatementCount`, `transactionAttemptCount`, `committedTransactionCount`, and `rolledBackTransactionCount` remain zero or incomplete because no query events ever arrive.
- Separate note: many scripts create their own `new PrismaClient()` instances directly. Even if `PrismaService` is fixed later, those script-local clients still need their own event-mode logging if they are expected to emit per-query metrics.

### 2. Existing observability candidate is usable but incomplete

- HTTP request envelope already exists in `apps/api/src/pressure-chapter/http/errors.ts` via `withPressureDbRequestMetricsV1(...)`.
- Request DB metrics already hash SQL text and count `BEGIN` / `COMMIT` / `ROLLBACK` in `apps/api/src/pressure-chapter/observability/pressure-db-metrics.ts`.
- Decision-stage timing already exists in:
  - `apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.ts`
  - `apps/api/src/pressure-chapter/decision-automation/convergence.service.ts`
  - `apps/api/src/pressure-chapter/observability/decision-convergence-timing.ts`
- Current gap is not the stage timer design. The weak point is query-event delivery and durable collection of one run's stderr evidence.

### 3. How to count SQL / transactions / retries without schema changes

- SQL count:
  - Use Prisma query events.
  - Count every emitted SQL statement as `applicationSqlStatementCount`.
- Transaction count:
  - Continue counting normalized `BEGIN`, `COMMIT`, `ROLLBACK` from emitted SQL text.
  - Report both:
    - `transactionAttemptCount`
    - `committedTransactionCount`
    - `rolledBackTransactionCount`
- Retry count:
  - Do not add schema fields.
  - For the fixed baseline/after-run, compute request-local retry evidence from existing metrics:
    - `transaction_retry_count = transactionAttemptCount - committedTransactionCount` when retries manifest as rolled-back/restarted interactive transactions.
    - Also record convergence conflict counters already produced by the decision path: `headConflictCount`, `w4ConflictCount`, `staleRevisionCount`, `staleEpochCount`, `staleFenceCount`, `stalePolicyCount`.
  - If later code work adds one explicit `retryCount` field to diagnostics memory/log output, that is still schema-free and acceptable, but it is not required for this diagnosis note.
- Protocol-roundtrip approximation:
  - For this repo, the only schema-free exact source currently available is emitted SQL count plus explicit `BEGIN/COMMIT/ROLLBACK`.
  - Report:
    - `application_sql_statement_count`
    - `database_protocol_roundtrip_count_including_begin_commit = applicationSqlStatementCount`
  - Reason: each emitted SQL command is one DB command from Prisma's point of view; the acceptance spec already distinguishes this from the application-level target budget.

## Non-production environment contract

- API startup path is `apps/api/src/main.ts`, which calls `configurePressureSupabaseDatabaseV1(process.env)` before Nest boot.
- Pressure does not trust an arbitrary local `DATABASE_URL`.
- Runtime selection is:
  - prefer `SUPABASE_DATABASE_URL` as the Pressure source of truth
  - allow `DATABASE_URL` only if it is also Supabase and matches the same project ref
  - write the selected Supabase URL back into `process.env.DATABASE_URL`
  - default API `connection_limit=2`
  - worker `connection_limit=1`
- The smallest existing non-production auth+decision harness is:
  - `scripts/acceptance/pressure-chapter/create-local-auth-fixture.mjs`
- That script already enforces:
  - `.env.test`
  - `EMAIL_PROVIDER=file-sink`
  - `PRESSURE_CHAPTER_TEST_SCOPE=non-production`
  - `PRESSURE_CHAPTER_DB_SCOPE=non-production`
  - `PRESSURE_CHAPTER_DATABASE_PROVIDER=supabase`
  - explicit allowlisted Supabase project fingerprint

## Exact measurement plan

### Allowed run shape

- One fixed baseline run before later code changes.
- One fixed after-run after later code changes.
- Same command family, same `.env.test`, same Supabase project, same API port, same fixture flow.
- No `pnpm test:pressure-chapter:*` suite execution for measurement.
- No repeated warm loops, no ad hoc retries, no browser suite, no acceptance suite.

### Fixed evidence files

- API stderr log for the run
- Fixture JSON written by `create-local-auth-fixture.mjs`
- Optional preflight JSON from `run-suite.mjs e2e --plan`

### Preflight command

Use once before the baseline pair, only to validate env gates without running tests:

```powershell
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Set-Location D:\tmp\aiStoryRoom-pressure-performance-v1
node .\scripts\acceptance\pressure-chapter\run-suite.mjs e2e --plan
```

Expected result: `READY_NOT_RUN` or `BLOCKED_BY_ENVIRONMENT`. Do not continue until all required env markers are present and non-production.

### Shared environment setup

Use this exact PowerShell setup for both baseline and after-run:

```powershell
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Set-Location D:\tmp\aiStoryRoom-pressure-performance-v1

$env:PRESSURE_CHAPTER_DIAGNOSTIC_ERRORS = "1"
$env:PRESSURE_CHAPTER_ALLOW_AUTH_FIXTURE = "1"
$env:PRESSURE_CHAPTER_ALLOW_E2E_TESTS = "1"
$env:PRESSURE_CHAPTER_ALLOW_FIXTURE_CLEANUP = "1"
$env:PRESSURE_CHAPTER_TEST_SCOPE = "non-production"
$env:PRESSURE_CHAPTER_DB_SCOPE = "non-production"
$env:PRESSURE_CHAPTER_DATABASE_PROVIDER = "supabase"

$envFile = ".env.test"
$envMap = @{}
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
  $name, $value = $_ -split '=', 2
  $envMap[$name.Trim()] = $value.Trim()
}
$projectRef = $envMap["SUPABASE_PROJECT_REF"]
$sha256 = [System.BitConverter]::ToString(
  [System.Security.Cryptography.SHA256]::Create().ComputeHash(
    [System.Text.Encoding]::UTF8.GetBytes($projectRef.ToLower())
  )
).Replace("-", "").ToLower()
$env:PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256 = $sha256
```

### Start API once per measurement

Baseline:

```powershell
Set-Location D:\tmp\aiStoryRoom-pressure-performance-v1
pnpm dev:api:test 2>&1 | Tee-Object -FilePath .\scripts\acceptance\generated\pressure-chapter\baseline-api.log
```

After-run:

```powershell
Set-Location D:\tmp\aiStoryRoom-pressure-performance-v1
pnpm dev:api:test 2>&1 | Tee-Object -FilePath .\scripts\acceptance\generated\pressure-chapter\after-api.log
```

Keep the API running in that terminal. Run the smoke command from a second terminal.

### Single fixed baseline command

```powershell
Set-Location D:\tmp\aiStoryRoom-pressure-performance-v1
node .\scripts\acceptance\pressure-chapter\create-local-auth-fixture.mjs smoke --cleanup
```

### Single fixed after-run command

```powershell
Set-Location D:\tmp\aiStoryRoom-pressure-performance-v1
node .\scripts\acceptance\pressure-chapter\create-local-auth-fixture.mjs smoke --cleanup
```

### Evidence to read from the two runs

- From fixture stdout / JSON:
  - `status`
  - `fixturePath`
  - `runIds`
  - `checks`
- From API stderr:
  - `Pressure request DB metrics`
  - `Pressure convergence diagnostics failed` must be absent
  - convergence timing/diagnostic output for the same request
- Required acceptance interpretation:
  - the run must create a real local-auth user against non-production Supabase
  - the run must create a real solo Pressure run
  - the run must submit one real N1 decision
  - the run must read back a changed projection
  - the evidence must come from exactly one baseline request and exactly one after-run request

## Anti-repetition rules

1. Do not run any broad suite for measurement:
   - forbidden: `pnpm test:pressure-chapter:e2e`
   - forbidden: `pnpm test:pressure-chapter:acceptance`
   - forbidden: `pnpm test:acceptance`
2. Do not run 5x, 20x, 30x warm loops during this diagnosis phase.
3. Do not rerun the baseline command because the number looks bad.
4. If baseline fails, stop and classify before any rerun:
   - env gate failure
   - API boot/config failure
   - Prisma connectivity/pooler failure
   - auth fixture failure
   - submit-decision functional failure
   - observability failure
5. If the failure is observability-only, preserve the failed baseline as the only baseline. Do not overwrite it with a second "better" baseline.
6. The after-run is allowed only after a code change phase outside this assignment.
7. Use the same `.env.test` project and same command path for baseline and after-run. No swapping project, route, or harness between the two.

## Decision

- Root cause to address first in implementation phase: Prisma query-event emission is not guaranteed because `PrismaService` does not construct `PrismaClient` with query event logging enabled.
- No schema change is required to count SQL, transactions, and retry evidence.
- The correct minimal evidence path is:
  - optional `run-suite.mjs e2e --plan` preflight
  - one `pnpm dev:api:test`
  - one `create-local-auth-fixture.mjs smoke --cleanup` baseline
  - later, after code changes, one matching after-run
