# P02 Independent Acceptance

Date: 2026-08-03

## Scope

- Accepted base: `34a83801b77d4f3c893aeb50f6473ca7d76f7990`
- Phase: P02 Settlement, Protected Beat, and deterministic fallback foundation
- Verification environment: clean disposable clone under `D:/tmp`
- Real model calls: none
- Main game page changes: none

## Delivery integrity

- Outer ZIP SHA-256: `D01D4BAAFEE404DC29B2628D65A4BFE4E0D34272ABD7250FAF2ACF87E693A098`
- Cumulative patch SHA-256: `AE3AA870FB40991183F7C9A524E121F4A588A8A9C2A4B80B9D9D1B9368CEB9BF`

The outer archive and patch hashes matched the delivery manifest. The delivered
"cumulative" patch was not independently self-contained: it modified
`settlement.round3-adversarial.test.ts` without first creating that supplied
review test from the accepted P01 base. Independent verification restored the
exact earlier review input (SHA-256
`365F2894CD8D2933878EDCD5F6DA15CF22389D6A52B987F248C076F4A9DBBCD5`) before
applying the patch. The repository branch contains the complete final file, so
this packaging defect does not remain in source control.

## Independent results

| Gate | Result |
|---|---:|
| Round-3 bypass regressions plus neutral synthetic world | 4/4 PASS |
| Full P02 settlement suite | 33/33 PASS |
| P01 runtime-contract regression | 40/40 PASS |
| Templates typecheck and build | PASS |
| Shared typecheck and build | PASS |
| OpenNovel app regression | 97/97 PASS |
| OpenNovel package regression | 32/33, known baseline isolation assertion |
| Genericity scan of runtime engine/types/index | PASS |
| `git diff --check` | PASS |

The single package-suite failure is the pre-existing assertion that the package
must not be imported by API or web-player paths. The current application already
imports it from `apps/api/src/app.module.ts`; P02 did not add or change that path.

## P02 contract evidence

- Legacy `EchoRoute.affectedActorIds` is removed and rejected as an unknown
  field, so callers cannot bypass typed audience resolution.
- Every typed audience is intersected with the causal rule's visibility.
- `RELATION_BASED` visibility is fail-closed and uses only the policy owner plus
  actor references structurally present in the current durable predicate.
- Personal, cross-player, and world echoes use distinct causal sources and
  distinct durable predicates; the world echo must be public.
- Immediate and delayed events share the same typed visibility resolver.
- Settlement is deterministic, revision-bound, idempotent, replayable, and
  conflict-safe in the coordinator contract.
- Protected blocks are immutable and source-bound; a deterministic fallback is
  always available after a legal settlement.

## Decision

P02 is accepted for progression to P03. This is an engineering acceptance of
the deterministic settlement foundation, not a claim that the complete v4
narrative pipeline or real-player acceptance is finished.
