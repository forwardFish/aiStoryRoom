# 07 Acceptance Test Plan

1. Install dependencies with frozen lockfile.
2. Run repo typecheck.
3. Run API smoke assertions.
4. Build Taro WeChat mini program.
5. Start preview API in a background process.
6. Run story E2E against http://localhost:3001/api.
7. Confirm generated E2E report includes 5 nodes, chapter POV/card/share data, ActionGuard blocked case, and admin observability checks.
8. Update final report and git status.
