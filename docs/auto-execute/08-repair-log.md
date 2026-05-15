# Repair Log

Generated: 2026-05-13 21:30:00

## Repairs Completed This Round

1. Acceptance harness completed.
   - Added/updated the required `scripts/acceptance/*.ps1` gates.
   - `run-all.ps1` supports `fast`, `gate`, and `full`.
   - `run-web-cabin-smoke.ps1` is ordered before `run-visual-smoke.ps1`.

2. Web validation cabin closed as a P0 surface.
   - Kept `apps/web/public/index.html` and `apps/web/public/app.js`.
   - Verified default API base `http://localhost:3001/api`.
   - Chrome CDP smoke completed login, template load, run creation, 3-player join, actions, ActionGuard, 5-node completion, POV chapter, personal cards, next hook, and debug/API log.

3. Preview API and story E2E closed.
   - Latest report: `scripts/test-reports/story-e2e-1778678522059.json`.
   - Covers `template_midnight_store_001`, `template_qingyun_sect_001`, and `template_wild_village_001`.
   - Each template reached 5 nodes, chapter generation, share token, notifications, feedback/report, and admin observability.

4. ActionGuard contract strengthened and verified.
   - Verified `ok`, `rewrite_needed`, and `blocked`.
   - Verified `status`, `accepted`, `rejected`, `guardStatus`, `matchedRules`, `suggestedRewrite`, and `reason`.

5. `activeHumanCount` / join-run counting verified.
   - Web cabin observed `activeHumanCount=3`.
   - E2E observed `activeHumanCount=3` for all three templates.

6. Visual smoke repaired.
   - Fixed `run-visual-smoke.ps1` file-write contention.
   - Added checks for UI reference inventory, mini program build output, insight/admin source surfaces, and Web cabin screenshot/HTML evidence.

7. Visible placeholder text cleaned up.
   - Replaced P0-facing `??` fallback labels in roles, insight, admin, and API notification/report fallback text.

8. Real DB E2E classified honestly.
   - Docker daemon unavailable; recorded as `DOCUMENTED_BLOCKER`, not PASS.

## Evidence

- Full gate: `docs/auto-execute/verification-results.md`
- Web cabin summary: `docs/auto-execute/summaries/web-cabin-smoke.md`
- Web browser summary: `docs/auto-execute/logs/web-cabin-browser-summary.json`
- Web screenshot: `docs/auto-execute/screenshots/web-cabin-smoke.png`
- Web HTML: `docs/auto-execute/screenshots/web-cabin-smoke.html`
- Visual smoke: `docs/auto-execute/summaries/visual-smoke.md`
- Preview E2E: `scripts/test-reports/story-e2e-1778678522059.json`
- DB blocker: `docs/auto-execute/summaries/db-e2e.md`

## Gap repair planning 2026-05-13 21:51:37

- GAP-REQ-001: Normalize docs/auto-execute/requirement-candidates.json into requirement-target.json with P0/P1/P2 acceptance criteria, surfaces, and evidence expectations.
- GAP-UI-001: Map UI references to routes/screens in ui-target.json.
