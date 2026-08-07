# Dynamic Kernel Selector Lite — REPAIR Handoff

**Date:** 2026-08-07  
**Branch:** `codex/chatgpt-pro-dynamic-kernel-lite`  
**Status:** `REPAIR_IMPLEMENTED_PENDING_EXECUTION`  
**Do not report:** `COMPLETE` or `CANDIDATE_BRANCH_READY`

## 1. Independent-review defects addressed

The repair keeps the frozen Part One Settlement as the sole causal writer and makes the Dynamic layer select, project, recover, and validate an exact authored decision surface.

### Node type contract

- Added package-level `@types/node`.
- Added package TypeScript `types: ["node"]`.
- Updated the frozen pnpm lockfile through pnpm 10.12.1.
- The previously reported `node:async_hooks` TS2307 failure was confirmed fixed by the earlier Templates repair run.

### Kernel obligation coverage

Kernel relevance now unions all structural evidence instead of allowing Requirement metadata to replace the other sources:

```text
Requirement.stateEffects
+ Kernel.stateDependencies
+ Affordance.stateEffects
+ Affordance.statePatch keys
+ successful Settlement Preview changedStatePaths
```

This is world-agnostic and does not introduce story vocabulary, `SEC-P1-02` branching, prose parsing, synonyms, or regex classification.

### Candidate isolation

- A Kernel with no authored options fails only its own evaluation.
- Materialization and Preview failures are recorded on the candidate.
- Other valid Kernels continue through selection.
- Provisional Settlement is isolated from later unrelated malformed Kernels.

### Mutually exclusive runtime paths

The runtime distinguishes:

```text
Primary Dynamic
Floor Continuation
Legacy Fallback
```

A committed WorkingSet and Pair remain authoritative through display, binding, formal Settlement, observe-only Capability actions, finalization, and recovery.

### Floor Continuation

- Missing or exhausted continuation arrays are supplied by a deterministic structural Floor projection.
- Formal continuation Settlement receives the exact current continuation and a deterministic successor required by the frozen engine.
- A committed continuation Pin wins even when `sectionTurnNumber` now points at the next authored continuation.
- Invalid pinned Kernel, Decision Point, or Affordance identities still fail closed.

### Capability + Floor

The public projection helper and the internal production scaffold are now separate:

- `packageForDynamicCapabilityAction` preserves the historical contract and returns the original immutable package for an existing Floor Continuation.
- `packageForDynamicCapabilitySettlement` supplies an isolated successor scaffold only for the internal frozen Settlement pass.
- The capability turn does not complete the Kernel, apply an authored patch, create durable effects, or silently advance the committed Decision Point.

### Legacy Fallback

- A committed fallback Pair can be reconstructed without reapplying the Dynamic diversity gate.
- Non-default committed fallback Affordances remain valid through binding and formal Settlement.
- Trace, Package, Section, State fingerprint, Decision Point, and Pair are checked before use.

### Preview / Commit parity

- Provisional and final causal snapshots must match.
- The next Dynamic WorkingSet is selected from the finalized-state projection in which paid due consequences are represented as `PAID`.
- The committed event stores the selected Kernel, Decision Point, Pair, Outcome hashes, revision, and state fingerprint.

## 2. Regression tests added or strengthened

The branch includes tests for:

- `SEC-P1-02` state-dependent Kernel selection;
- malformed candidate isolation;
- array reversal and 100-run determinism;
- distinct Outcome signatures;
- structured pending-pressure priority;
- Floor continuation formal Settlement;
- public capability package identity for a continuation;
- production capability Settlement on a continuation;
- committed continuation recovery after the authored index advances;
- non-default committed Legacy fallback formal Settlement;
- fallback capability preservation;
- Primary, Continuation, Fallback, and old-event recovery;
- outcome-hash, trace, event, revision, and state-fingerprint tamper rejection;
- free-text equivalence and zero new model calls;
- concurrent Pin / WorkingSet isolation;
- finalization and capability recovery.

## 3. Evidence actually available

An earlier isolated Templates job confirmed:

```text
pnpm install --frozen-lockfile                         PASS
pnpm --filter @ai-story/templates typecheck            PASS
pnpm --filter @ai-story/templates test:runtime-contract PASS
pnpm --filter @ai-story/templates test:story-package   FAIL
pnpm --filter @ai-story/templates build                SKIPPED_AFTER_FAILURE
```

That run predates the latest runtime repairs and cannot be used as evidence for the current branch head.

## 4. Gates still requiring a real executable environment

The following commands must be executed against the final remote SHA and reported with total, pass, fail, skip, todo, exit code, and log path:

```text
pnpm --filter @ai-story/templates typecheck
pnpm --filter @ai-story/templates test:runtime-contract
pnpm --filter @ai-story/templates test:story-package
pnpm --filter @ai-story/templates build
pnpm --filter @apps/openovel-runtime typecheck
pnpm --filter @apps/openovel-runtime test
pnpm --filter @apps/openovel-runtime build
pnpm --filter @apps/api test:solo-story-engine
pnpm --filter @apps/api test:solo-story-engine:legacy-sangtian
pnpm test:story:branch-persistence
pnpm test:story:options
pnpm test:story:convergence
pnpm test:story:v4
```

Until those commands run on the latest SHA, their status is `NOT_RUN_ON_FINAL_SHA`, not PASS.

## 5. Supabase-only formal acceptance

Formal acceptance involving any of the following must connect to the project's existing Supabase environment:

```text
Database
Run
Room
turn commit
state persistence
idempotency
atomic commit
real page flow
```

A local PostgreSQL instance, Mock DB, memory store, or file-only workspace is auxiliary evidence only and cannot produce a product PASS.

Supabase formal gates must not run until every deterministic gate above is green. This repair:

- performs no database migration;
- changes no online configuration;
- accesses no real-user data;
- does not run the Supabase formal gate prematurely.

## 6. Git safety

```text
main modified by this repair: NO
main pushed by this repair: NO
main merged: NO
PR created: NO
deployment performed: NO
database migration performed: NO
online configuration changed: NO
real-user data accessed: NO
```

## 7. Current verdict

```text
REPAIR_IMPLEMENTED_PENDING_EXECUTION
```

Only an independent clean checkout of the final remote SHA, full deterministic green gates, followed by the authorized Supabase formal acceptance and player-quality review, can change the verdict to `CANDIDATE_BRANCH_READY`.
