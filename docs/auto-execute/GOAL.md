# Auto Execute Goal

## User task summary
Complete AI ????? MVP using acceptance-first delivery, with docs/03-mvp-p0-acceptance-criteria.md as the final local acceptance source.

## Project root
D:\lyh\agent\agent-frame\aiStoryRoom

## Detected project type
Node/TypeScript monorepo: NestJS API, Taro/React WeChat mini program, static web validation/admin cabin, Prisma/PostgreSQL schema, preview in-memory API.

## Execution mode selected
auto-execute-acceptance-first, routed as an autopilot-style end-to-end implementation loop inside this Codex session.

## Required outcomes
- Preserve newest docs/UI/2 image files and update README_UI_FLOW.md to match them.
- Fill P0 mini-program surfaces and state pages for fate line, chapters, notifications, ActionGuard, AI status/error, chapter/POV/card/share, world/relationship/timeline/suspicious panels.
- Fill backend/admin observability for dashboard, story runs, AI logs, audit logs, event logs, ActionGuard status and content audit.
- Keep mock WeChat, mock AI and mock audit with clear API boundaries.
- Run requested verification, then commit and push main.

## Explicit non-goals
No real payment, complex map, equipment, levels, combat, public story pool, production deployment, or production secrets.

## Safety boundaries
Do not delete new docs/UI/2 images. Do not restore old UI images. Do not run destructive git reset/clean. Do not remove valid tests.

## Acceptance criteria
See docs/03-mvp-p0-acceptance-criteria.md and docs/auto-execute/02-requirement-traceability-matrix.md.

## Verification commands
pnpm install --frozen-lockfile; pnpm typecheck; pnpm --filter @apps/api test; pnpm --filter @apps/miniprogram build:weapp; start pnpm dev:preview-api; pnpm test:story:e2e.

## Final report path
docs/AUTO_EXECUTE_DELIVERY_REPORT.md

## Assumptions
Existing uncommitted docs/UI/2 file replacements are user-provided newest UI assets and must be preserved/staged as final asset state.

## Hard stop conditions
Credentials, destructive operations, production deployment/payment, irreversible data deletion, missing critical runtime after three repair loops.
