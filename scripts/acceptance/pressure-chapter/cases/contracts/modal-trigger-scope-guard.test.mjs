import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectGitScope,
  inspectModalTriggerScope,
  MODAL_TRIGGER_BASE_SHA,
} from '../../lib/modal-trigger-scope-guard.mjs';

test('scope guard allows the approved Phase1 UI and unified Pressure chain on exact baseline', () => {
  const scope = collectGitScope(process.cwd(), MODAL_TRIGGER_BASE_SHA);
  assert.deepEqual(inspectModalTriggerScope(scope), []);
});

test('scope guard rejects schema, migration, route, page, role/avatar/world changes', () => {
  const changes = [
    { status: 'M', path: 'prisma/schema.prisma' },
    { status: 'A', path: 'prisma/migrations/20260813_new/migration.sql' },
    { status: 'M', path: 'apps/api/src/rooms.controller.ts' },
    { status: 'A', path: 'apps/web/public/pressure-test.html' },
    { status: 'M', path: 'apps/web/public/app.js' },
    { status: 'M', path: 'packages/templates/config/sangtian/game.json' },
    { status: 'A', path: 'apps/web/public/assets/roles/new-avatar.png' },
  ];
  const patches = new Map([
    ['prisma/schema.prisma', '+model PressureModal {}'],
    ['apps/api/src/rooms.controller.ts', "+@Post(':runId/modal-test')"],
    ['apps/web/public/app.js', "+if (location.pathname === '/pressure-test') renderTest();"],
  ]);
  const codes = new Set(inspectModalTriggerScope({ changes, patches }).map((item) => item.code));
  for (const code of [
    'PRISMA_SCHEMA_OR_MIGRATION_CHANGED', 'NEW_PRISMA_MODEL', 'NEW_API_PATH', 'NEW_PAGE_FILE',
    'NEW_WEB_ROUTE', 'ROLE_AVATAR_OR_WORLD_CHANGED',
  ]) assert.equal(codes.has(code), true, `missing ${code}`);
});

test('test specs under apps remain permitted by the route detector', () => {
  const changes = [{ status: 'A', path: 'apps/api/src/pressure-chapter/modal.api.spec.ts' }];
  const patches = new Map([[changes[0].path, "+@Post(':runId/test-only')"]]);
  assert.deepEqual(inspectModalTriggerScope({ changes, patches }), []);
});
