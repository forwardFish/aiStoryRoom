# Live diagnosis and integration corrections

Date: 2026-08-15

Only the smallest failed gate was rerun after each diagnosis. The full real fixture was not repeated without a concrete correction.

## Corrections

1. Local auth mail sink
   - Failure: fixture provision looked under `apps/api/.auth-mail-sink.ndjson` while the runtime file sink writes relative to `process.cwd()`.
   - Correction: resolve the configured sink from `process.cwd()`.
   - Scope: acceptance fixture only.

2. Production chapter-reader receiver
   - Failure: FAST returned `Cannot read properties of undefined (reading 'mapper')`.
   - Cause: `projectCurrent` was detached from its class instance.
   - Correction: invoke `this.chapters.projectCurrent(...)` with its receiver intact.

3. Committed capability authority
   - Failure: FAST omitted `DEFAULT_PASS`; visible decision options intentionally exclude that system action.
   - Correction: bind the current `decisionPointId` to `chapterDescriptor.decisions[].execution.allowedActionTypes` already present in the snapshot.
   - No action code was hardcoded into production projection logic and no SQL was added.

4. M5C observation comparison
   - Failure: the runner required REPLAY/SHADOW/FAST `scenarioDigest` values to be identical, while the M5B contract intentionally includes mode in the digest.
   - Correction: preserve per-mode digest validation and FAST warm-scenario stability; use deep/canonical public projection equality for cross-mode equivalence.

5. Fixture cleanup boundary
   - Failure: fixture `createdAt` was captured after account provisioning, making the guarded cleanup predate check impossible.
   - Correction: capture the cleanup boundary before provisioning starts.
   - Two previously stranded marker-owned test users/runs were then deleted with the existing guarded cleanup helper.

6. N2 opening narrative authority
   - Failure: after a successful N1 submit, FAST readback returned `GAME_READ_SNAPSHOT_PRISMA_AUTHORITY_MISSING:narrativeSource:OBJECT_REQUIRED`.
   - Cause: the aggregate query omitted the legacy N2-N7 opening rule that reads the prior chapter's frozen narrative before the new chapter has a Beat.
   - Correction: add a `previous_frozen_hash` branch inside the existing single aggregate SQL.
   - No new query, narrative generator, fallback text, audience rule, or persistence authority was added.

## Cleanup evidence

- Stranded test users removed: 2.
- Stranded test runs removed: 2.
- Associated Pressure rows removed through the exact marker/run guard.
- Final passing fixture cleanup: PASS.
- Real-user or production data touched: none.
