# 03 Surface Map

| Surface ID | Type | Path/name | Purpose | Related reqs | Acceptance check |
|---|---|---|---|---|---|
| S1 | mini route | pages/home/mode/templates/create-run/lobby/roles/role-card/room/action/resolution/chapter/share/my-runs | Main P0 loop | R1-R4 | build + E2E |
| S2 | mini route | pages/insight/index?kind=... | Latest UI/2 auxiliary/status surfaces 21-40 | R2-R5 | build route registered |
| S3 | mini route | pages/admin/index | Admin/ops observability | R6 | build route registered |
| S4 | API | /notifications, /feedback/report, /story-runs/:runId/insights | User-facing P0 support data | R5 | typecheck + E2E |
| S5 | API | /admin/dashboard, /admin/story-runs, /admin/story-runs/:id, /admin/ai-tasks, /admin/audit-logs, /admin/event-logs, /admin/action-guard | Admin observable data | R6 | E2E admin checks |
| S6 | preview API | scripts/preview-api.ts matching API routes | Local no-DB verification | R1-R6 | preview E2E |
