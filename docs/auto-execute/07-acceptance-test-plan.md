# Acceptance Test Plan

1. Initialize harness with `scripts/acceptance/init-harness.ps1`.
2. Run baseline and full gate with `scripts/acceptance/run-all.ps1 -Mode full`.
3. Validate preview API with `run-api-smoke.ps1`.
4. Validate first-class Web cabin with `run-web-cabin-smoke.ps1`.
5. Validate story flow with `pnpm test:story:e2e` through all three templates.
6. Validate mini program build and UI inventory through frontend/visual gates.
7. Attempt DB E2E only against local Docker Postgres; classify Docker unavailability as DOCUMENTED_BLOCKER.
8. Update final report with PASS/HARD_FAIL/DOCUMENTED_BLOCKER/DEFERRED statuses.
