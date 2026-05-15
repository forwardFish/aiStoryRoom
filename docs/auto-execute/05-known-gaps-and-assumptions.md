# Known Gaps and Assumptions

| Item | Status | Notes |
|---|---|---|
| Docker / local Postgres runtime | DOCUMENTED_BLOCKER | `docker ps` failed because Docker daemon is unavailable in this host session. Preview API and Web cabin are not blocked. |
| Production database | NON_GOAL | No production DB connection was attempted. |
| Real payment | NON_GOAL | No payment integration was added. |
| P1/P2 platform features | NON_GOAL | Work stayed within MVP P0-A. |
| Node module type warning | DEFERRED | API test still uses a direct Node smoke file; warning is not a P0-A functional blocker. |
| Pixel-perfect visual comparison | DEFERRED | Current visual gate indexes references and captures Web cabin screenshot; it does not assert pixel-perfect matching. |
