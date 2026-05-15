# Surface Map

Generated: 2026-05-13T21:55:43

## Product surfaces

- apps/miniprogram: landing/home/roles/room/action/insight/admin pages mapped from docs/UI/2.
- apps/web: validation cabin at http://localhost:5177 using preview API at http://localhost:3001/api.
- preview-api / Nest API: story lifecycle, ActionGuard, chapter, notification, feedback and admin observability endpoints.

## API endpoints used by acceptance

| Method | Path | Purpose | Evidence |
|---|---|---|---|
| GET | /api/health | API health | story E2E / web cabin smoke |
| POST | /api/auth/wechat-login | mock login/session | story E2E |
| GET | /api/world-templates | template list | story E2E / web cabin |
| POST | /api/story-runs | create run | story E2E / web cabin |
| GET | /api/story-runs/:runId | run detail | story E2E |
| GET | /api/story-runs/:runId/state | current node/state | story E2E / web cabin |
| POST | /api/story-runs/:runId/join | join run | story E2E / web cabin |
| GET | /api/story-runs/:runId/roles | roles | story E2E / web cabin |
| POST | /api/story-runs/:runId/roles/:roleId/claim | claim role | story E2E / web cabin |
| POST | /api/nodes/:nodeId/actions | submit guarded action | story E2E / web cabin |
| GET | /api/nodes/:nodeId/actions | list actions | story E2E |
| POST | /api/nodes/:nodeId/resolve | resolve node | story E2E / web cabin |
| GET | /api/nodes/:nodeId/resolution | resolution detail | story E2E |
| POST | /api/story-runs/:runId/generate-chapter | generate chapter | story E2E / web cabin |
| GET | /api/chapters/:chapterId | chapter reader | story E2E |
| POST | /api/chapters/:chapterId/share | share chapter | story E2E |
| GET | /api/notifications | notifications | story E2E |
| POST | /api/feedback/report | feedback/report | story E2E |
| GET | /api/story-runs/:runId/insights | fate/insight panels | contract discovery |
| GET | /api/admin/dashboard | admin dashboard | story E2E |
| GET | /api/admin/story-runs | admin run list | story E2E |
| GET | /api/admin/roles | admin roles | story E2E |
| GET | /api/admin/actions | admin actions | story E2E |
| GET | /api/admin/resolutions | admin resolutions | story E2E |
| GET | /api/admin/ai-tasks | AI task audit | story E2E |
| GET | /api/admin/audit-logs | audit logs | story E2E |
| GET | /api/admin/event-logs | event logs | story E2E |
| GET | /api/admin/action-guard | ActionGuard observability | story E2E |
