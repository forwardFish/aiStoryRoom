# P02 Deterministic Settlement and Rendering Foundation

P02 adds a world-agnostic settlement layer to `packages/templates/src/runtime-contract`. It does not call a model, parse action prose, integrate a database/API, or change the Phase 3 lexical gates.

## Contract

- `PlayerActionIntent` is a strict closed object. Actor, entity, capability, timestamp, revision, confidence, intent flags, and actor-policy ownership are checked before settlement.
- `SettlementPackage` is typed Story Package data. A binding connects one exact intent type and capability to explicit causal rules, three complete echo routes, render policy, protected template, and locale-bound fallback assets.
- Every echo route selects an authorized rule effect by index. Missing personal, cross-player, or world routing rejects the package before play.
- Personal, cross-player, and world routes must select distinct rule/effect sources and distinct durable predicates. The world source must be public.
- Typed audiences are intersected with visibility. Relation-based visibility is fail-closed and limited to the policy owner plus actor references structurally present in the current predicate; it never expands to every durable actor.
- `NarrativeDisposition` is a closed union containing only original, repaired, or fallback outcomes.

## Runtime

`DeterministicSettlementEngine` selects only explicitly bound rules whose structured conditions hold. IDs derive from action/rule positions; no clock, randomness, model, raw-text matching, or world branch participates. Accepted settlement proposes one monotonic revision, validated causal events, an envelope, pending delayed events, protected blocks, and deterministic fallback text.

`InMemorySettlementCoordinator` is the P02 storage seam. It serializes submissions, performs semantic idempotency checks, returns exact replays, rejects key reuse, and returns a recoverable conflict for a stale revision. A failed proposal never replaces its snapshot.

Delayed events remain structured `SCHEDULED` records until their revision/condition is due. Application records `appliedAtRevision`; replay and restart snapshots therefore apply each event at most once. Cancelled and unrelated entries remain untouched.

Round 2 makes the delayed queue a validated aggregate. Every pending record must have an exact ledger event, event IDs are unique, and scheduled rule IDs must exactly match `DurableState.pendingRuleIds`. Visibility deterministically limits delayed recipients for `PUBLIC`, `PRIVATE`, `ACTOR_SET`, and `RELATION_BASED` rules. A due batch applies atomically at one new revision; ghost or conflicting pending records fail before mutation.

Protected blocks cite applied event sources and are locale-bound and immutable. Fallback uses only approved prefixes/templates, settled echo summaries, and the configured next decision point. Narrative pipeline unavailability resolves to `USE_FALLBACK`, never permanent prose rejection.

Protected templates use one closed placeholder grammar: exactly one `{summary}` and no unknown placeholders. Settlement binding selectors are unique, and each binding contains exactly one personal, cross-player, and world route, preventing package order or extra routes from silently changing guaranteed output.

Round 3 replaces static echo recipients with typed audiences: origin actor, other players, all players, explicit actors, or visibility-authorized actors. Audience resolution uses the actual submitting actor and separates causal affected actors from player summary recipients. NPC actors may therefore receive private world effects without receiving player summaries. Snapshots bind to one run on their first accepted event, and every later intent, ledger event, pending event, and coordinator submission must retain that run identity.

## Known limits

- P02 provides an in-memory coordinator only; atomic database/API integration remains P07.
- Conditional delayed events are supported by the runtime type, while supplied P01 delayed fixtures are revision-based.
- Protected block composition and deterministic fallback are foundations for later narrator/reviewer integration; P03-P06 behavior is intentionally absent.
