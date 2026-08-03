# Task Decomposition

| ID | Lane | Owner | Target | Depends | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- |
| M0-01 | Intake | Orchestrator | baseline, branch, archive, secret scan | none | M00 | COMPLETE |
| M1-01 | Contracts | Architect/Builder | shared schemas, engine/runtime modes | M0 | type/schema tests | COMPLETE |
| M1-02 | Adapter | Backend Builder | RoleNarrativeRuntime and adapter routing | M1-01 | adapter/solo regression | COMPLETE_WITH_M2_BUDGET_DEPENDENCY |
| M2-01 | Runtime | Runtime Builder | room/role paths, locks, canon, impacts, recovery | M1 | runtime tests | IN_PROGRESS |
| M3-01 | World integration | Backend Builder | projection, resolution-to-runtime, impacts/outbox | M1,M2 | integration/security | PENDING |
| M4-01 | Interaction | Backend Builder | intent/interaction/contest/protection | M3 | interaction tests | PENDING |
| M5-01 | AI | Backend Builder | trigger/candidates/epoch/budget/batch isolation | M3 | AI/budget tests | PENDING |
| M6-01 | UI | Frontend Builder | canon/impact/interaction/status/free input | M3-M5 | web/browser tests | PENDING |
| M7-01 | Tests | Test Engineer | unit/contract/concurrency/fault/E2E/browser | M1-M6 | M01-M11 | PENDING |
| M7-02 | Review | Reviewer | diff, contracts, security, migration, lockfile | M1-M7 | M12 | PENDING |
| M7-03 | Final | Orchestrator | full rerun, evidence, remote SHA parity | all | final gate | PENDING |

Builders may edit product code only after this control pack exists. Any file-boundary change must be recorded in the repair log.

Batch A was independently accepted after A-6 with no remaining P0/P1. The durable
model-call budget ledger is intentionally carried into M2 because enforcement and
idempotent readback must live in the Role Runtime, not in a process-local API counter.
