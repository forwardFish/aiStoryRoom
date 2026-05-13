# 01 Task Decomposition

| Work ID | Work unit | Type | Target files/areas | Dependency | Acceptance check | Status |
|---|---|---|---|---|---|---|
| W1 | Read required docs and classify gaps | audit | docs, apps, packages, scripts | none | gap list exists | completed |
| W2 | Acceptance pack | docs | docs/auto-execute | W1 | traceability and test matrix exist | completed |
| W3 | Mini program P0 auxiliary/status surfaces | UI | apps/miniprogram/src | W2 | build:weapp passes, routes registered | implemented |
| W4 | Admin observability API | API | apps/api/src, scripts/preview-api.ts | W2 | story E2E queries admin endpoints | implemented |
| W5 | Preview API parity | API/test | scripts/preview-api.ts | W4 | test:story:e2e passes against preview API | implemented |
| W6 | UI README sync | docs | docs/UI/2/README_UI_FLOW.md | W1 | filenames match latest assets | implemented |
| W7 | Final docs/report | docs | README.md, docs/03, docs/AUTO_EXECUTE_DELIVERY_REPORT.md | verification | docs record results | pending verification |
| W8 | Full verification/repair | test/build | pnpm commands | W3-W7 | all commands pass or documented blocker | pending |
