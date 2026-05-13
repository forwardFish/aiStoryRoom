# 06 Test Matrix

| Test name | Command | Expected result | Current result | Blocking | Evidence path |
|---|---|---|---|---|---|
| Install | `pnpm install --frozen-lockfile` | succeeds | passed | yes | terminal |
| Typecheck | `pnpm typecheck` | succeeds | passed | yes | terminal |
| API smoke | `pnpm --filter @apps/api test` | succeeds | passed | yes | terminal |
| Mini build | `pnpm --filter @apps/miniprogram build:weapp` | succeeds | passed | yes | apps/miniprogram/dist |
| Preview API | `pnpm dev:preview-api` | server starts on 3001 | passed | yes | .runtime/preview-api.out.log |
| Story E2E | `pnpm test:story:e2e` | completes 5 nodes and admin checks | passed | yes | scripts/test-reports/story-e2e-run_001n7qd2.json |
| DB optional | `pnpm db:generate/db:push/db:seed` | only required if schema changes | not required; no Prisma schema change | no | n/a |
