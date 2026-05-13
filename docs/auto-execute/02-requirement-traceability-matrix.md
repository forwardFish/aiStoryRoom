# 02 Requirement Traceability Matrix

| Requirement ID | Requirement description | Source | Priority | Implementation target | Acceptance method | Current status | Evidence |
|---|---|---|---|---|---|---|---|
| R1 | Mock login, templates, run creation, role/fate line selection | 03 sections 2-4 | P0 | API + mini program core pages | E2E + build | implemented | apps/api/src/story.service.ts, apps/miniprogram/src/pages |
| R2 | Action submission and ActionGuard overreach block/rewrite | 03 sections 5-6 | P0 | submitAction, action page, insight page | API E2E invalid action check | implemented | /nodes/:id/actions, pages/insight?actionguard |
| R3 | Mock AI Director resolution with echoes and cross impacts | 03 section 7 | P0 | resolveNode + resolution UI | E2E checks echoes/crossImpacts | implemented | DirectorResolution + resolution page |
| R4 | Chapter generation, multi POV, personal story card, share token | 03 sections 8-11 | P0 | generateChapter + chapter/share UI | E2E final chapter checks | implemented | Chapter enrichers, chapter page |
| R5 | Notifications, report/feedback, audit boundaries | latest UI 23/24 and PRD safety | P0 | notifications/report endpoints and pages | typecheck/build | implemented | /notifications, /feedback/report, insight page |
| R6 | Admin dashboard, story runs, AI logs, content audit logs | user task/admin UI | P0 | API admin endpoints + admin mini/web surfaces | E2E admin endpoint checks | implemented | /admin/* endpoints |
| R7 | UI/2 README matches latest image names | user task | P0 | docs/UI/2/README_UI_FLOW.md | filename list comparison | implemented | README updated |
| R8 | Payment remains out of P0 | user task + PRD | P0 | docs only | docs review | implemented | 20_unlock_next_chapter marked non-P0 |
