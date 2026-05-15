# Status Semantics

## PASS
All in-scope requirements, UI structure, contracts, tests, secret guard, and report integrity passed with evidence.

## PASS_WITH_LIMITATION
Core behavior passed, but acceptable limitations remain, such as non-pixel-perfect UI, production not verified, documented blockers, deferred out-of-scope items, or manual review requirements.

## REPAIR_REQUIRED
Open in-scope gaps remain. The agent must read repair-plan.md and next-agent-action.md, edit implementation/tests/evidence, then rerun convergence.

## HARD_FAIL
Build, test, core requirement, core UI, contract, secret, report integrity, or safety boundary failed.

## BLOCKED
Progress is blocked by credentials, environment, production resource, payment, destructive operation, or another non-code authority constraint.

## DOCUMENTED_BLOCKER
A known blocker is recorded with evidence. It is not an automatic code failure, but final verdict cannot be pure PASS.

## DEFERRED
Explicitly outside current scope and must include rationale.

## MANUAL_REVIEW_REQUIRED
Human visual, product, or experience judgment is required. Do not claim fully automated PASS or pixel-perfect UI.

## PRODUCT_DECISION_REQUIRED
PRD, UI, or code behavior conflicts require product decision before pure PASS.
