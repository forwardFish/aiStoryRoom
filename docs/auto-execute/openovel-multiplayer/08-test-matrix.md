# Test Matrix

| Area | Required proof |
| --- | --- |
| Contracts | types, strict schemas, versioning, adapter routing, auth/errors |
| World | monotonic/unique sequence, idempotency, stale-base behavior |
| Projection | PUBLIC/OBSERVABLE/LIMITED/PRIVATE and secret negative tests |
| Runtime | role paths/locks/canon/options/storykeeper/restart/stale cursor/Solo regression |
| Interaction | request/refusal/conditional/pressure/forced attempt/protection/expiry |
| AI | trigger/no-trigger/human no-call/epoch/candidate/batch isolation/budget |
| Concurrency | cross-role parallelism, same-role duplicate, contested asset, two instances, lease/outbox |
| Faults | narrator/options/storykeeper/agent timeouts, runtime/API/worker restart, mirror/DB/SSE/lease/supersede |
| E2E | three roles, 10-15 events, independent progress, shared truth, distinct POV |
| Browser | three origins/cookies/accounts/roles, screenshots, console/network, no leakage, then owner-participated governor/xunfu/magistrate journey and explicit sign-off |
| Performance | resolution and SSE P95 <1s without model; 100 concurrent sequences unique |

## Failure verification protocol

This protocol applies across every row above and is keyed by a stable failure
signature (test/case, failing assertion or error class, and affected layer):

1. Attempt 1 captures the failure and tests the first root-cause hypothesis.
2. Attempt 2 is allowed only after a code/configuration change or a different
   hypothesis, and must add new evidence.
3. Attempt 3 is the final verification of that failure signature and must also
   add new evidence.
4. If attempt 3 fails, stop the path. Do not rerun, tune prompts, or extend the
   retry count. Record the invalid underlying assumption and repair the state
   machine, ordering/idempotency, projection contract, context compilation, or
   environment layer before creating a new failure signature.

Generic convergence `MaxRounds` values count the whole run across distinct
gaps; they do not override this per-signature three-attempt limit.

Baseline commands and all new `test:openovel-mp:*` commands from the source document must run on the final tested SHA.
