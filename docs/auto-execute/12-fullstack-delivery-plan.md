# Full-Stack Delivery Plan

Generated: 05/14/2026 21:32:42

## Inputs

Requirement docs:
- auto-detect from docs/ or user prompt

UI references:
- auto-detect from docs/UI, docs/design/UI, screenshots, or user prompt

Detected frontend roots:
- D:\lyh\agent\agent-frame\aiStoryRoom\apps\web

Detected backend roots:
- D:\lyh\agent\agent-frame\aiStoryRoom\apps\api

## Lane Tasks

| ID | Lane | Task | Target files | Depends on | Verification | Status | Evidence |
|---|---|---|---|---|---|---|---|
| FS-000 | intake | Read AGENTS.md, project structure, PRD, UI references, package/build files | repo root, docs, UI refs | none | intake doc complete | pending | 00-project-intake.md |
| FS-010 | requirements | Extract P0/P1 requirements and map them to acceptance criteria | docs/auto-execute | FS-000 | traceability matrix complete | pending | 02-requirement-traceability-matrix.md |
| FS-020 | frontend | Implement screens/routes/components/states from UI | detected frontend roots | FS-010 | frontend build/test/visual evidence | pending | logs/screenshots |
| FS-030 | backend | Implement APIs/services/data behavior from PRD | detected backend roots | FS-010 | backend build/test/API evidence | pending | logs |
| FS-040 | contract | Align frontend calls with backend routes, payloads, auth, errors | frontend + backend | FS-020, FS-030 | contract/API smoke | pending | 13-frontend-backend-contract-map.md |
| FS-050 | frontend-test | Run frontend-only checks | frontend | FS-020 | lint/typecheck/test/build | pending | logs |
| FS-060 | backend-test | Run backend-only checks | backend | FS-030 | build/test/API | pending | logs |
| FS-070 | integrated-test | Run end-to-end/full-flow checks | full stack | FS-040, FS-050, FS-060 | smoke/E2E/full-flow | pending | FULL_FLOW_ACCEPTANCE.md |
| FS-080 | review | Review diff against PRD/UI/evidence | changed files | FS-070 | code review | pending | 09-code-review.md |
