# OpenNovel Multiplayer Handoff

## 2026-08-04 current owner rules and acceptance state

- The current source has fresh isolated-Supabase PASS evidence for M09 and M10.
  M09: `openovel-db-concurrency-20260804-011600-m09c2` and
  `openovel-db-fault-20260804-011800-m09f`. M10:
  `openovel-db-three-role-20260804-004532-clean9`.
- M10 proves 12 human actions plus exactly one disconnect-takeover AI action,
  formal sequences `1..13`, synchronized private projections, an interaction
  reply, short-disconnect recovery, takeover/reclaim epoch `1->2->3`, bounded
  provider calls, and zero unfinished blockers.
- Remaining gates are M02 (owner-stabilized Solo dependency), M11 (owner joins
  the real existing `/game` page in three roles), and M12 (final integrated
  rerun after Solo is stable). Multiplayer must not change Solo quality logic
  or add/alter a test-only main-game page.
- ChatGPT Web is advisory only. Reuse the fixed multiplayer project conversation
  `https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a70a95a-4d40-83ee-a50e-38a0b8a8e934`
  only in `聊天` mode when the visible controls show `GPT-5.6 Sol` and `极高`. Do not send a
  model-identity probe. Codex owns implementation, local verification, and the
  final verdict. This rule supersedes every historical browser statement below.
- A single failure signature may be tested at most three times. Each retry must
  use a distinct hypothesis and new evidence; after the third failure, stop and
  repair the underlying layer before any later test.

- Goal: implement and verify the full v1.0 continuous OpenNovel multiplayer slice.
- Branch/worktree: `codex/openovel-multiplayer-v1` at `D:\lyh\agent\agent-frame\aiStoryRoom-openovel-multiplayer`.
- Frozen source: `origin/main` at `d5aff3096f901cc41ed4fd9c5e290855a46f480e`.
- Current phase: M3 Web integration and three-role acceptance.
- Owner override: the same failure signature may be verified at most three
  times. Each attempt must test a distinct hypothesis and add evidence. A third
  failure stops that path and requires an explicit underlying-layer diagnosis
  and repair before any further retest. Generic convergence `MaxRounds` does
  not increase this limit.
- Control pack: created under `docs/auto-execute/openovel-multiplayer/`.
- M00 evidence: baseline, scoped 2.1 MB archive, scan and branch isolation complete.
- ChatGPT Pro conversation A: `https://chatgpt.com/c/6a6f7a12-e380-83ee-a8cb-a73c36385032` (`FAILED_NO_ARTIFACT`). The initial answer and A-1 correction produced no patch, source ZIP, modified-file manifest, or test log; the full failure is recorded in the evidence conversation ledger.
- Batch A shared/API implementation completed and was independently accepted
  after A-6 with no remaining P0/P1. Durable model-call budget enforcement is
  the explicit Runtime B boundary.
- Baseline verification is recorded in `baseline-test-results.md`: continuous
  Story V2 API tests pass, while repository-wide typecheck/build, three Web
  tests, and one obsolete OpenNovel shadow-boundary test fail on frozen source.
- ChatGPT Pro conversation B is active at
  `https://chatgpt.com/c/6a6f99df-5ac8-83e8-b455-8eaf64637baa` using the
  accepted-A runtime source archive SHA-256
  `2a68b7105da5cbb02ea6b868d722b4772d722d051a9be366887a3306a0b99e80`.
- Final B-3 ZIP SHA-256
  `da996040bc6892da9f2d0d30956a1db78ab3514b7543bc9d93cb7e5209e47f7d`
  is integrated. Runtime typecheck/build, the full 141/141 suite, four new
  red-to-green regressions, and ten consecutive rounds of ten high-risk cases
  pass. Independent Runtime and contracts/security reviews both ACCEPT with
  P0=0 and P1=0.
- Next: create a scoped accepted-A+B source archive, start the separate
  ChatGPT Pro conversation C, and implement Web/recovery/visible three-origin
  acceptance without changing accepted A+B boundaries.
- Requirement section 18.2 requires strict A -> B -> C sequencing. Two local
  implementation agents were interrupted after producing only early drafts;
  no B/Runtime or C/Web lane will continue until A is integrated and reviewed.
- Quarantined early Runtime drafts were deleted and replaced by the scoped B
  artifact. Both unaccepted early Web drafts were restored to frozen HEAD before
  preparing the Batch C source, so C begins from accepted A+B only.
- Final verdict: not yet evaluated.

## 2026-08-03 current verification state

- The same-signature limit is now three, not five. The real PostgreSQL receipt
  race stopped on its third failed attempt, exposed the invalid single-upsert
  assumption, and was repaired at the production whole-transaction boundary.
- Post-repair concurrency PASS evidence:
  `docs/auto-execute/evidence/openovel-multiplayer/20260803T004938+0800/test-results/openovel-db-concurrency-20260803-093704/report.json`.
- Crash/recovery/replay/identity-conflict PASS evidence:
  `docs/auto-execute/evidence/openovel-multiplayer/20260803T004938+0800/test-results/openovel-db-fault-20260803-092701/report.json`.
- Runtime is green: typecheck, 141/141 tests, and build all PASS. Web full tests
  PASS; the focused OpenNovel Web suite is 33/33.
- API typecheck and the complete Continuous Strategy suite PASS. The repository
  full API command reaches a pre-existing frozen Solo Part One inconsistency:
  focused evidence is 157/163, and all six failing story-runtime files are
  unchanged from the frozen source SHA. It is isolated rather than repaired by
  changing unrelated main-game content.
- ChatGPT Pro browser access is stopped after three identical Codex browser
  kernel failures (`os error 3`). Latest source has not been reviewed in Pro;
  local implementation and verification continue without claiming otherwise.
- Next: start real API/Runtime/Web services, create an isolated three-account
  run through the existing `/game`, collect automated three-role evidence, run
  independent review, then invite the owner for M11 sign-off.

## 2026-08-03 M10 and Solo/multiplayer boundary update

- Owner clarified that story-generation stability belongs to the Solo chain.
  Multiplayer consumes that stable capability and owns only shared-world,
  role isolation, visibility, cross-impact, interaction, control, concurrency,
  and budget behavior. No Solo Truth Review, prompt, or publication decision
  was copied into this branch.
- The multiplayer-only double gate was removed: an OpenNovel role narration is
  no longer rejected a second time by legacy API literal-overlap scoring.
  Legacy lexical findings remain audit shadow signals; protocol/security
  failures remain hard. Runtime 144/144, API Continuous Strategy, workspace
  typecheck, and production build pass.
- Fresh M10 PASS:
  `docs/auto-execute/evidence/openovel-multiplayer/20260803T004938+0800/test-results/openovel-db-three-role-20260803-124219/report.json`.
  It records 12 human actions, 22 AI-takeover actions, world sequence 1..34,
  76 narrative entries, three synchronized projections, one reclaim credit,
  and zero unfinished blockers.
- The earlier M11 live stack for run `room_badb12f313eafe26cf1dc949819d86d1`
  was intentionally stopped because it contained the pre-redesign API build.
  It must be rebuilt and restarted before owner participation. Automated Chrome navigation was
  stopped after three harness failures and is not claimed as evidence. Owner
  participation is the next genuinely different browser verification path.
- M02 remains open until the owner's stable Solo chain is integrated through
  the shared interface; multiplayer must not repair or fork Solo quality logic.

## 2026-08-03 multiplayer commit-entry redesign

- Reservation now writes `MultiplayerWorldCommitEntry` and no longer allocates
  or exposes a formal sequence. The world commit creates `ActionResolution`
  with the entry ID only after locking the room and applying the authoritative
  mutation. Pre-commit failure releases the action and reopens only that role;
  post-commit failure preserves the immutable sequence and resumes publication.
- Fresh Continuous Strategy suite PASS and API/script typechecks PASS.
- Fresh real PostgreSQL correctness: 100/100 reservations and 100/100 formal
  commits; every room is exactly `1..N`, with no duplicate/hole/negative
  parking. Evidence: `openovel-db-performance-20260803-141818/report.json`.
- The historical multi-ORM-roundtrip design remains stopped at p95
  `7174.99ms`. It was replaced, not retried, by a conservative single-SQL
  atomic commit for simple multiplayer actions, with complex/contested actions
  falling back to the complete locked transaction.
- Current-head performance PASS evidence is
  `openovel-db-performance-20260803-150756/report.json`: 60 provider-excluded
  formal commits have min `90.12ms`, p50 `106.42ms`, p95 `283.82ms`, and max
  `313.60ms` against `<1000ms`. A separate 100-concurrent stress committed all
  100 entries across 34 three-role room shapes with exact per-room sequences
  and no duplicate or hole.
- Because the core commit protocol changed, prior M09/M10 reports are historical
  only. Fresh concurrency/fault/M10 and a rebuilt M11 stack are required.

## 2026-08-03 fresh M09 commit-entry acceptance

- M09 is current and PASS after the protocol change. Evidence:
  `openovel-db-concurrency-20260803-143823/report.json` and
  `openovel-db-fault-20260803-144012/report.json`.
- The real isolated PostgreSQL readback proves parallel role commits allocate
  exact official sequences `1,2`; replay returns the same resolution IDs;
  same-turn double submit creates one Entry/Action/Submission/Task; and a
  contested shared asset permits one commit while the rejected transaction
  leaves no world-sequence gap.
- An expired lease cannot create an ActionResolution or advance the room. The
  same durable entry is recovered by a replacement worker and commits exactly
  sequence `1`. A terminal pre-commit failure marks the entry failed and opens
  a replacement turn without changing authoritative sequence state.
- The complementary runtime-before-DB crash test still proves recovery,
  idempotent replay, and fail-closed identity conflict. Port `3117` belonged to
  another repository process, so this isolated fault run used free port `3127`
  without stopping or modifying the unrelated process.

## 2026-08-03 fresh post-commit-entry M10

- M10 is current and PASS at
  `openovel-db-three-role-20260803-145039/report.json`.
- Attempt 1 stopped at official sequence 7 because a role context frozen at the
  role's observed sequence was incorrectly compared with the later shared-world
  commit base after other roles advanced. The durable snapshot was valid; the
  validator used the wrong identity cursor.
- The repair validates a commit-entry snapshot against its immutable
  `frozenRoleContext.observedWorldSequence`. Legacy resolutions without that
  field retain the original base-sequence rule. The deterministic mismatch is
  also terminal/non-retryable so it cannot silently consume five identical
  worker attempts. Focused world-first tests are 22/22, outbox lease contracts
  and API typecheck pass.
- Attempt 2 completed 12 human actions and 21 triggered AI actions. Database
  readback is exact official sequence `1..33`, 33 resolutions, 74 narrative
  entries, three synchronized private projections, an interaction response,
  takeover/reclaim epoch `1->3`, and no unfinished blocking tasks.
- ChatGPT Pro web control was retried only through the newly available in-app
  browser entry, but initialization reached the same underlying kernel-assets
  path and failed with the same `os error 3`. That route remains stopped; the
  latest repair has not been reviewed by ChatGPT Pro and must not be described
  as such.

## 2026-08-03 single-SQL world-commit performance PASS

- The stopped application-layer multi-roundtrip design was replaced with one
  PostgreSQL data-modifying CTE statement for eligible simple multiplayer
  actions. The statement validates the durable lease and entry identity,
  advances the authoritative room sequence, writes the immutable resolution
  and Canon facts, resolves the player action, and commits the entry atomically.
- Fast-path eligibility is frozen at reservation. Interactions, conditions,
  stage advances, influence edges, target-role mutations, leverage changes,
  and other complex actions deliberately use the existing full transaction.
- `openovel-db-concurrency-20260803-150641/report.json` passes against this
  current source. It exercises both the fast path and the contested-asset full
  fallback. Current-head fault recovery also passes at
  `openovel-db-fault-20260803-151236/report.json`: expired leases write no world
  state, replacement workers commit once, precommit terminal failure creates no
  sequence gap, and runtime-before-DB recovery remains exactly-once.
- Current-head M10 also passes at
  `openovel-db-three-role-20260803-151654/report.json`: 12 human actions and 21
  triggered AI actions produce exact official sequence `1..33`, 74 role
  narrative entries, synchronized private projections, an interaction reply,
  takeover/reclaim epoch `1->3`, and zero unfinished blockers.

## 2026-08-03 real SSE, budget, and control PASS

- `openovel-db-transport-20260803-152651/report.json` exercises the production
  Nest SSE endpoint over authenticated HTTP against an isolated PostgreSQL
  schema. Sixty reconnect first frames have min `437.57ms`, p50 `440.62ms`,
  p95 `448.37ms`, and max `531.65ms`, below the `<1000ms` requirement.
- The first stream contains the durable member delivery. Reconnect from
  delivery sequence 1 returns the same cursor with zero duplicate deliveries;
  a non-member event feed returns 403. Focused Web tests pass real SSE backfill,
  safe cursor application, draft preservation, and polling recovery after SSE
  failure.
- The current M10 report records 39 actual HTTP calls for each of Narrator,
  Options, and Storykeeper. Those are exactly six role-opening phases plus 33
  resolved-action phases, so every role narrative phase uses three calls and
  Impact synchronization adds zero real-time Narrator calls. The Runtime suite
  independently passes durable precharge, stable 429, replay-without-recall,
  provider-failure charging, and Impact zero-call assertions.
- M10 also proves explicit AI handoff and human reclaim on the same role with
  control epoch `1->3` and one auditable reclaim Credit. The deterministic
  acceptance lane uses rule-triggered AI candidates, so untriggered AI Agent
  provider calls remain zero.

## 2026-08-03 epoch-scoped control review and remote publication checkpoint

- A new in-app browser path is working. In a dedicated ChatGPT chat at
  `https://chatgpt.com/c/6a708348-389c-83ee-a400-2e56b633992b`, the model was
  asked `你是什么模型` before project material and replied `GPT-5.6 Thinking`,
  which satisfies the owner's explicit model gate.
- The verified Web review requested per-control-epoch Agent task identity and
  an immutable Standing Policy snapshot for disconnect takeover. The API now
  stores `StoryTaskOutbox.identityJson`, uses an epoch-scoped dedupe key, freezes
  the transition/reason/policy candidate, and persists decision audit evidence.
- Immediate human reclaim now cancels only pending/running Agent tasks fenced
  to the prior control epoch. The focused control suite passes `13/13` in three
  consecutive local rounds. API Continuous Strategy, API/workspace typecheck,
  Runtime `144/144`, Web `167/167`, and diff validation also pass.
- The old `openovel-db-three-role-20260803-151654` report predates these control
  changes and is historical, not current-head M10 proof. A later M10 attempt
  stopped before room creation with Prisma `P1001` against the remote
  PostgreSQL route. The same-signature count permits one final lightweight
  connectivity check; a third `P1001` must stop that route.
- The repository remote is GitHub (`git@github.com:forwardFish/aiStoryRoom.git`).
  The owner has authorized publishing `codex/openovel-multiplayer-v1` so the
  verified Web Pro session can inspect and run the exact branch. Any Pro commit
  must be pulled by explicit SHA and independently re-tested locally before it
  can be accepted.
