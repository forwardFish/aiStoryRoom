# Total Task

`TOTAL-OPENOVEL-MP-001` converts the approved v1.0 design into code and authoritative evidence.

- Requirements: `01-requirements-summary.md`
- Decomposition: `02-task-decomposition.md`
- Architecture: `03-architecture-plan.md`
- API contracts: `05-api-contract.md`
- Database policy: `06-database-schema.md`
- Acceptance: `07-acceptance-checklist.md`
- Test matrix: `08-test-matrix.md`
- Orchestration: `agent-orchestration.json`
- Current state: `state.json`
- Resume point: `latest/HANDOFF.md`
- Evidence root: `../evidence/openovel-multiplayer/20260803T004938+0800/`

Completion requires M00 through M12. No narrower passing subset is accepted.

## Three-attempt stop rule

- The same failure path may be verified at most three times.
- Each attempt must test a distinct hypothesis and produce new evidence; an unchanged rerun does not count as progress.
- If the third attempt still fails, stop that path and audit the underlying data model, state machine, ordering/idempotency, projection contract, context compiler, or runtime boundary.
- Prompt/model retries and larger test batches are forbidden until the identified root layer has been changed and a new falsifiable hypothesis is recorded.

## Main game page preservation

- Do not add a test-only page, parallel OpenNovel game page, injected replacement panel, or test-only DOM controls.
- The feature and its acceptance journey must use the repository's actual `/game` page, existing narrative/status/Options/free-input/interaction surfaces, and existing rendering lifecycle.
- A main-game-page change is allowed only when a named v1.0 requirement cannot be expressed through an existing component or slot; it must be minimal, visually consistent, and covered by existing-page regression evidence.
- Fixture HTML, a toy server, or a newly created page can support a unit test but can never prove the browser/E2E/player-quality gate.
