# 08 Repair Log

## Repair loop 1

- Failing command: `pnpm typecheck`
- Error: `StoryService.rewriteSuggestion` was referenced before the helper existed.
- Fix: added private `rewriteSuggestion(input)` helper to `apps/api/src/story.service.ts`.
- Re-test: `pnpm typecheck` passed.

## Repair loop 2

- Failing command: first `pnpm test:story:e2e` run.
- Error: preview API process was still serving an older implementation and the ActionGuard invalid action was accepted.
- Fix: added ASCII guard trigger tokens (`CONTROL_ALL`, `FORCE_SUCCESS`, `AUTO_WIN`) to avoid terminal/source encoding ambiguity, patched preview API blocked branch to create audit/event evidence, restarted preview API.
- Re-test: `pnpm test:story:e2e` passed with report `scripts/test-reports/story-e2e-run_001n7qd2.json`.
