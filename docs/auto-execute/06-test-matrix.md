# Test Matrix

Generated: 2026-05-13 21:30:00

| Gate | Command | Status | Evidence |
|---|---|---|---|
| Install | `pnpm install --frozen-lockfile` | PASS | `docs/auto-execute/logs/pnpm-install-frozen-lockfile.log` |
| Typecheck | `pnpm typecheck` | PASS | `docs/auto-execute/logs/frontend-typecheck.log` |
| API unit/smoke | `pnpm --filter @apps/api test` | PASS | `docs/auto-execute/logs/backend-api-test.log` |
| Mini program build | `pnpm --filter @apps/miniprogram build:weapp` | PASS | `docs/auto-execute/logs/frontend-miniprogram-build.log` |
| Preview API smoke | `powershell -ExecutionPolicy Bypass -File .\scripts\acceptance\run-api-smoke.ps1 -Mode full` | PASS | `docs/auto-execute/summaries/api-smoke.md` |
| Web cabin smoke | `powershell -ExecutionPolicy Bypass -File .\scripts\acceptance\run-web-cabin-smoke.ps1 -Mode full` | PASS | `docs/auto-execute/summaries/web-cabin-smoke.md` |
| Visual smoke | `powershell -ExecutionPolicy Bypass -File .\scripts\acceptance\run-visual-smoke.ps1 -Mode full` | PASS | `docs/auto-execute/summaries/visual-smoke.md` |
| Story E2E | `pnpm test:story:e2e` | PASS | `scripts/test-reports/story-e2e-1778678522059.json` |
| Full run-all | `powershell -ExecutionPolicy Bypass -File .\scripts\acceptance\run-all.ps1 -Mode full` | PASS_WITH_LIMITATION | `docs/auto-execute/verification-results.md` |
| Real DB E2E | `powershell -ExecutionPolicy Bypass -File .\scripts\acceptance\run-db-e2e.ps1 -Mode full` | DOCUMENTED_BLOCKER | `docs/auto-execute/summaries/db-e2e.md` |
