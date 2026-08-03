# Repair Log

## 2026-08-03 — failure verification limit corrected

- Owner instruction: change the same-error verification limit from five to
  three and find the cause immediately.
- Root cause: the task-specific C2 root-correction document already enforced a
  three-attempt limit, while `00-goal.md` still inherited the generic
  auto-execute five-repair-loop stop condition. This created two competing
  policies.
- Correction: the goal, state, checklist, test matrix, and handoff now define a
  stable failure-signature limit of three attempts. Every attempt requires a
  different hypothesis and new evidence.
- Boundary: generic convergence `MaxRounds 5` remains a total-run setting for
  distinct gaps and cannot authorize a fourth attempt on the same failure.
- Stop behavior: a third failure ends that path immediately. The invalid
  underlying layer must be named and repaired before a new verification is
  allowed.

## 2026-08-03 — real PostgreSQL receipt race stopped after attempt 3

- Failure signature: two independent processes publish the same OpenNovel
  impact receipt at the same time.
- Attempts: (1) missing ignored worktree environment; (2) top-level-await/CJS
  driver mismatch after the isolated schema migrated; (3) both processes ran,
  one committed and one exited on a real PostgreSQL Serializable write
  conflict.
- Stop verdict: the assumption that one Prisma `upsert` transaction alone
  provides API-level concurrent idempotency is invalid. The database prevented
  duplicate rows, but one caller did not receive a successful replay.
- Root repair: extract the production Continuous Story V2 whole-transaction
  retry boundary into `serializable-retry.ts`; the Service and external
  two-process verifier must call the same implementation. Add focused retry
  and fail-fast tests before opening a new real-database verification path.
- Evidence: `docs/auto-execute/evidence/openovel-multiplayer/20260803T004938+0800/test-results/openovel-db-concurrency-20260803-092204/report.json`.

## 2026-08-03 — serializable race root repair verified

- New verification path: after extracting the production whole-transaction
  retry boundary, run the same production helper from two independent
  processes against an isolated real PostgreSQL schema.
- Result: PASS. Both same-key processes returned exit code 0 and the same
  `entryId`; the database contained one receipt for that identity. Independent
  governor and xunfu receipts also committed concurrently at the same world
  sequence without overwriting one another.
- Root-layer conclusion: retrying the entire Serializable transaction is the
  required API idempotency boundary. Retrying only the inner `upsert`, or
  relying on the unique constraint to turn a losing caller into a replay, is
  insufficient.
- Evidence: `docs/auto-execute/evidence/openovel-multiplayer/20260803T004938+0800/test-results/openovel-db-concurrency-20260803-093704/report.json`.

## 2026-08-03 — runtime crash and receipt recovery verified

- Result: PASS against an isolated real PostgreSQL schema and a real Runtime
  HTTP child process. The first process crashed after the impact became
  durable, recovery produced exactly one receipt, replay returned the same
  identity, and a conflicting identity failed closed with
  `OPENOVEL_IMPACT_RECEIPT_IDENTITY_CONFLICT`.
- Evidence: `docs/auto-execute/evidence/openovel-multiplayer/20260803T004938+0800/test-results/openovel-db-fault-20260803-092701/report.json`.

## 2026-08-03 — frozen Solo Part One baseline isolated

- Full API execution reached the existing Solo Part One deterministic suite;
  a focused second verification produced 157/163 passing and six failures.
- Scope proof: every failing Part One runtime, validator, test, and compiled
  story-package file is byte-identical to frozen source commit
  `d5aff3096f901cc41ed4fd9c5e290855a46f480e`. This task changes only the Solo
  projection discriminator fields and repairs a stale credit reservation
  method call.
- Root cause: the frozen compiled story package and assertions disagree over
  `actor.xunfu_clerk` versus `actor.xunfu_aide`, accepted reply-box custody
  choreography, and expanded natural-language synonym sets.
- Decision: do not modify unrelated main-game story assets and do not perform
  a third identical run. Record this as a pre-existing frozen-baseline failure,
  while keeping all OpenNovel multiplayer gates independent and green.

## 2026-08-03 — ChatGPT Pro browser path stopped

- Three attempts ended with the same Codex browser-kernel initialization
  failure: `failed to write kernel assets: 系统找不到指定的路径。 (os error 3)`.
- Per owner policy, this path is stopped. The invalid environment assumption
  is that the embedded browser kernel/profile assets are currently writable
  and discoverable. No fourth retry is allowed without an environment change.
- Local Codex implementation and automated verification continue; no claim is
  made that the latest source was reviewed through ChatGPT Pro.

## 2026-08-03 — multiplayer lexical publication gate removed at the correct boundary

- Owner report: multiplayer prose may have the same quality problem as Solo;
  compare `feat/story-v2-p03-remove-lexical-gates` before M11.
- Comparison source: independent worktree
  `D:\tmp\aiStoryRoom-v4-p03-dev`, committed P03 change
  `3641077c8637cb28e4000b58532072c73ee80990`. The worktree has additional
  uncommitted Solo changes; none were copied or modified.
- Finding: yes, the same failure class existed. `OPENOVEL_ROLE_V1` narration
  passed the Runtime and was then scored again by API `reviewStory()`, whose
  literal role, scene, causal-word, action, target, and method overlap rules
  could reject valid paraphrase. This also contradicted the multiplayer source
  plan's instruction not to re-enable old Chinese semantic regular expressions.
- P03 principle adopted: separate surface integrity from story-truth/style
  inference. The role Runtime now hard-rejects only empty/provider-error,
  structured JSON/XML, internal protocol leakage, broken fences, and menu-like
  output. The API retains legacy lexical findings as
  `SHADOW_LEGACY_LEXICAL:*` audit signals instead of a second publication
  authority. Internal engine leakage, rule-summary leakage, truncation, and
  broken punctuation remain hard publication failures.
- Multiplayer-specific authority: Shared World resolution is committed by the
  API before narration; role prose cannot mutate shared truth. This change
  adds no reviewer/repair model call, preserving the documented ordinary-action
  budget of at most three provider calls. Human contradiction/prose quality
  remains a mandatory M11 check and is not claimed from deterministic tests.
- Focused verification: Runtime surface tests 2/2 PASS; Runtime and API
  typechecks PASS; API publication-boundary test PASS.
- Regression verification: Runtime 144/144 PASS; API Continuous Strategy suite
  PASS; repository typecheck and production build PASS.

## 2026-08-03 — M11 stop script avoids recursive evidence traversal

- First stop attempt failed before reaching the live stack because recursive
  `Get-ChildItem` entered a deep, concurrently removed fault-test workspace.
- Repair: use the same shallow attempt/test-results/three-role report search as
  the start script, then resolve only `m11-live/stack.json`.
- Readback: the recorded Runtime, API, and Web processes stopped and ports
  3193, 3192, and 5192 had no listeners.

## 2026-08-03 — automated Chrome login path stopped after attempt 3

- Failure signature: the automation did not reach the real
  `continuous-story-v2-shell` after the product redirected `/game` to login.
- Attempt 1: a regular expression matched `/game` inside the auth page's
  `returnTo` query and falsely considered navigation complete.
- Attempt 2: the script checked the URL before the product's asynchronous
  session probe redirected to auth, so it never filled the login form.
- Attempt 3: the script correctly waited for the auth form, but its Playwright
  Python `wait_for_url` predicate treated the callback value as a parsed URL;
  the API supplies a string, producing `AttributeError`.
- Stop verdict: the browser harness's navigation abstraction is invalid. No
  fourth run is allowed on this path. The predicate is corrected to operate on
  a URL string, but that correction is deliberately not reported as verified.
- New path: owner-participated M11 uses the three actual `/game` origins and
  product login forms. Codex will use database/API readback after those human
  actions; automation cannot substitute for owner sign-off.

## 2026-08-03 — multiplayer performance path stopped after bounded verification

- Scope boundary: this lane exercises only multiplayer `reserveResolution`,
  shared-world sequencing, transaction contention, and database backpressure.
  It does not inspect or modify Solo prompts, Truth Review, publication, or
  prose quality.
- First design, stopped after three attempts: one synthetic room with 100 roles
  was invalid. Attempt 1 exposed an invalid RoleControl reason in the fixture;
  attempt 2 exposed a missing production context field; attempt 3 reached the
  database but exhausted the five-connection pool before all transactions
  acquired a connection. No fourth run was made.
- Replacement design: 34 real-shape rooms with at most three roles each, 100
  concurrent calls to the production `reserveResolution` transaction, and
  uniqueness checked as `roomId + appliedWorldSequence`.
- Replacement attempt 1 stopped at the Supabase session-pool hard limit because
  a 30-connection client exceeded the server `pool_size: 15`.
- Replacement attempt 2 used the allowed 15 connections and reached real
  transactions, but a Serializable write conflict exhausted the existing
  deterministic retry loop.
- Root repair before replacement attempt 3: database-conflict retries changed
  from identical linear delays to bounded exponential jitter, with six
  database-only attempts. Unit tests and API typecheck passed.
- Replacement attempt 3 still failed with a Serializable conflict while
  creating the result outbox task. The path is stopped: the current design of
  independent full transactions contending on the same StoryRun and task chain
  does not satisfy the 100-concurrent-simulation gate. Increasing connection
  count or retry count is not an accepted repair.
- Required next architecture: a single authoritative, backpressured shared-world
  reservation entry (queue or atomic reservation protocol) that lets Role
  Workspaces remain parallel while serializing only the short world commit.
  Performance remains FAIL until that architecture is implemented and verified
  through a genuinely different lane.

## 2026-08-03 — commit-entry redesign correctness PASS, performance FAIL

- Implemented a multiplayer-only `MultiplayerWorldCommitEntry`. Reservation
  seals Turn CAS, PlayerAction, DecisionSubmission, entry, Credit attachment,
  and result outbox without allocating a formal `worldSequence` or creating an
  `ActionResolution`. Solo generation and publication logic were not changed.
- Attempt 1 failed because the performance fixture used the unregistered
  `continuous_story_v2` content version. The production path newly reached
  stage assets; the fixture was corrected to real `sangtian_v1_2` and the three
  actual playable role keys.
- Attempt 2 reached formal world commits but exhausted Serializable conflicts
  at the repeated StoryRun/asset path. The commit boundary was changed to
  acquire `StoryRun FOR UPDATE` as the first statement under READ COMMITTED;
  non-stage-advance actions no longer repeat stage asset initialization.
- Attempt 3 completed all correctness assertions: 100 reservation entries,
  zero formal sequences at reservation, 100 committed entries, 100 immutable
  ActionResolutions, and exact per-room sequences `1..N`. No negative parking,
  sequence compression, duplicate, or hole was observed.
- Attempt 3 performance remained FAIL: formal commit min `1988.55ms`, p50
  `4104.36ms`, p95 `7174.99ms`, max `9428.33ms`. Evidence:
  `docs/auto-execute/evidence/openovel-multiplayer/20260803T004938+0800/test-results/openovel-db-performance-20260803-141818/report.json`.
- Stop verdict: row locking now closes correctness, but the multi-ORM-roundtrip
  world mutation cannot meet the remote PostgreSQL `<1s` SLA. No fourth run is
  allowed. The next architecture must move the authoritative mutation into one
  database function/single SQL statement; pool size and retries are not repairs.

## 2026-08-03 - fresh commit-entry concurrency and recovery PASS

- The previous M09 reports were invalidated when the commit-entry protocol
  replaced positive-sequence reservation. A new real-service, isolated
  PostgreSQL harness now runs before the complementary cross-process impact
  receipt lane.
- Concurrency attempt 1 reached successful product mutations but the verifier
  queried a nonexistent `PlayerAction.turnId`; the evidence query was corrected
  to use the production role/idempotency identity. Attempt 2 passed.
- `openovel-db-concurrency-20260803-143823` proves parallel roles allocate
  official sequences `1,2`, commit replay returns the original IDs, same-turn
  double submission creates one durable record set, and a contested asset
  yields one success plus one transactional rejection with no sequence gap.
- The first fault invocation stopped before product execution because port
  `3117` belongs to an unrelated checkout. The owner process was preserved and
  the isolated lane used free port `3127`; this is an environment route change,
  not a retry of a product failure.
- `openovel-db-fault-20260803-144012` proves an expired lease writes no world
  state, a replacement worker recovers and commits the same entry exactly once,
  pre-commit terminal failure opens a replacement turn without sequence change,
  and the runtime-before-DB crash path recovers one receipt while conflicting
  content fails closed. M09 is PASS against the current protocol.

## 2026-08-03 - fresh M10 snapshot-cursor repair PASS

- Attempt 1 failed at sequence 7 with
  `OPENOVEL_ROLE_CONTEXT_SNAPSHOT_INVALID`. The role snapshot had been frozen
  at the action's observed sequence while independent roles advanced before the
  short world commit. Publication incorrectly compared that snapshot with the
  later commit base.
- The repair uses `frozenRoleContext.observedWorldSequence` for commit-entry
  identity validation and preserves `baseWorldSequence` as the legacy fallback.
  The mismatch code is now explicitly non-retryable; this prevents deterministic
  invariant failures from consuming the five-attempt transport retry budget.
- Focused world-first tests pass 22/22, outbox lease contracts pass, and API
  typecheck passes.
- Attempt 2 passed at `openovel-db-three-role-20260803-145039/report.json`:
  12 human actions, 21 AI actions, exact sequences `1..33`, 74 narratives,
  synchronized role projections, interaction reply, takeover/reclaim, and zero
  unfinished blocking tasks. M10 is PASS against the current protocol.

## 2026-08-03 - replacement single-SQL world commit performance PASS

- The historical p95 `7174.99ms` result remains the final evidence for the
  stopped multi-roundtrip architecture; it was not given a fourth retry.
- A genuinely different architecture now freezes a conservative Canon-fact
  commit plan at reservation and executes eligible simple multiplayer world
  commits in one PostgreSQL data-modifying CTE. Lease/entry validation, room
  sequence advance, immutable resolution, Canon insertion, action resolution,
  entry commit, and expiry cleanup share one database statement.
- Complex actions intentionally return to the complete locked transaction.
  This preserves conditional actions, stage changes, interactions, influence,
  target-role changes, and shared-asset conflict rules rather than forcing them
  through a reduced fast path.
- The first architecture run exposed a fixture-only missing `allRoles` context
  before SQL execution. The reservation plan now uses the complete role list
  when present and the acting role as a safe compatibility fallback.
- Current evidence `openovel-db-performance-20260803-150756/report.json` is
  PASS: 60 provider-excluded formal commits have min `90.12ms`, p50
  `106.42ms`, p95 `283.82ms`, and max `313.60ms`, all under the `<1000ms` p95
  gate. The separate 100-concurrent correctness stress commits 100/100 entries
  across 34 three-role room shapes with exact per-room sequences and no
  duplicates or holes.
- Current-head concurrency evidence
  `openovel-db-concurrency-20260803-150641/report.json` also passes, including a
  contested shared-asset case that proves the complex-action fallback remains
  transactional. Current-head fault evidence
  `openovel-db-fault-20260803-151236/report.json` passes as well: expired leases
  write no world state, replacement workers commit once, precommit failure
  opens a replacement turn without a sequence gap, and runtime-before-DB crash
  recovery remains exactly-once.
- Current-head M10 then passed at
  `openovel-db-three-role-20260803-151654/report.json`: 12 human actions, 21
  triggered AI actions, exact official sequence `1..33`, 74 narrative entries,
  synchronized private projections, an interaction reply, takeover/reclaim
  epoch `1->3`, and zero unfinished blockers.

## 2026-08-03 - real SSE performance and recovery PASS

- The earlier Web-only polling finding was not accepted as SSE evidence. The
  production API and specialized client now use the real
  `/v4/rooms/:roomId/events/stream` endpoint with durable delivery cursors;
  polling remains only the bounded recovery path.
- A new isolated transport lane starts the production Nest API, authenticates a
  real member, reads a durable first frame, then reconnects 60 times from the
  applied cursor. `openovel-db-transport-20260803-152651/report.json` passes at
  p95 `448.37ms`, duplicates zero deliveries, and rejects a non-member event
  feed with 403.
- Focused current-source verification also passes the full Role Runtime suite,
  the API Continuous Strategy suite, and 48 Web SSE/game/deployment tests.
  Durable budget tests cover stable 429 and replay; Impact sync uses zero calls.
  Current M10 call counts resolve exactly to three actual provider requests per
  opening/result role phase, without hidden cross-role batching.
