# P01 World Runtime Contract implementation report

## Scope and design

This phase implements only the reusable Phase 1 contract, validation, registry, fixtures, and deterministic predicate-state proof. It does not implement Settlement, Narrator, Reviewer, API, persistence, database, or UI behavior.

The public TypeScript contract is in `packages/templates/src/runtime-contract/types.ts`. Runtime validation is in `validation.ts`; deterministic state application is isolated in `state.ts`; registry hashing/loading is in `registry.ts`; world-owned data is isolated in `fixtures.ts`.

Round 4 consolidates cross-cutting semantics instead of adding field-local exceptions:

- `reference.ts` owns entity-kind, actor, policy, capability, and predicate-field reference checks plus actor/capability authorization.
- `access.ts` merges every KnowledgeGrant for a secret and provides the single ACL/projection/secret-visibility decision boundary.
- `event-context.ts` treats event arrays as untrusted input, validates each event before indexing it, and rejects duplicate event IDs.
- `pattern.ts` owns canonical pattern keys, reference validation, matching, overlap, and subsumption algebra.

Round 5 makes `validateInferableEvidence` the sole qualification gate for inferential evidence. Evidence must be PUBLIC, APPLIED, from the same run, and no newer than the inferred event or envelope revision. Envelope construction validates the complete event context before required visibility. INFERABLE visibility identity is a duplicate-free, order-independent event-ID set. Empty serialization shells are rejected because a runtime world must contain an actor, role, policy, capability, and opening projection.

`DurablePredicatePattern` uses a predicate type plus an exact structured constraint map. Empty constraints authorize every validated predicate of that type; populated constraints require field equality. Capability patterns therefore authorize rule effects without prose matching and can be consumed by Phase 2 without changing the contract shape.

`CausalEvent` retains the complete v4.0 event boundary plus `sourceRuleId`, which binds each event predicate to a declared P01 causal rule. `DurableTurnEnvelope` retains the v4.0 identity fields, predicate patterns, unresolved facts, scene entities, four separate event-reference groups, projection actor, and exact three-field narrative seed. Event bodies are deliberately external to the envelope.

## Fail-closed behavior

Validators reject unknown or missing fields, invalid IDs and SemVer, duplicate declaration IDs, dangling or wrong-kind references, invalid state revisions, unauthorized rule effects or event origins, ACL/grant inconsistencies, projection-created facts, secret leakage, malformed visibility evidence, invalid event status/summary invariants, overlapping envelope patterns, and registry path traversal/collisions. Causal reachability uses boolean `all`/`any`/`not` semantics over a deterministic fixpoint.

The two fixtures are independent objects. One uses documents, resources, public/actor-set visibility, two role policies, and three destiny conditions. The other uses evidence, relations, private/relation-based visibility, a different capability set, and different immediate/delayed condition shapes. Both use the same validator and state transition code.

## Compatibility

No production dependency was added. Existing game registry, continuous-strategy, story-package, and both OpenNovel workspaces are not imported or modified by this layer. Story names and world-owned labels exist only in fixture/test data.

## Verification record

The delivery report accompanying the commit records exact commands, exit codes, and test counts. The P01 test file contains 40 non-skipped test groups, preserving all prior cases and adding the six Round 5 adversarial reproductions. Static scanning covers all core runtime-contract files and excludes fixture/test data.

Known baseline issue: the package OpenNovel runtime path-isolation test fails on the fixed baseline as well; it is not modified in P01. No real model, player acceptance, deployment, database migration, PR merge, or production configuration was run.
