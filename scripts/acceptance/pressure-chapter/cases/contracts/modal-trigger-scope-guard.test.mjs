import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectGitScope,
  inspectModalTriggerScope,
  MODAL_TRIGGER_BASE_SHA,
} from '../../lib/modal-trigger-scope-guard.mjs';

test('scope guard allows only the approved modal overlay on main@b5', () => {
  const scope = collectGitScope(process.cwd(), MODAL_TRIGGER_BASE_SHA);
  assert.deepEqual(inspectModalTriggerScope(scope), []);
});

test('scope guard rejects every frozen production-scope expansion', () => {
  const changes = [
    { status: 'M', path: 'prisma/schema.prisma' },
    { status: 'A', path: 'prisma/migrations/20260813_new/migration.sql' },
    { status: 'M', path: 'apps/api/src/rooms.controller.ts' },
    { status: 'A', path: 'apps/web/public/pressure-test.html' },
    { status: 'M', path: 'apps/web/public/app.js' },
    { status: 'M', path: 'packages/templates/config/sangtian/game.json' },
    { status: 'A', path: 'apps/web/public/assets/roles/new-avatar.png' },
    { status: 'A', path: 'apps/api/src/pressure-chapter/modal-trigger.worker.ts' },
    { status: 'A', path: 'apps/api/src/pressure-chapter/parallel-authority.ts' },
    { status: 'A', path: 'apps/api/src/pressure-chapter/a-emotion-production/provider-client.ts' },
    { status: 'A', path: 'apps/api/src/pressure-chapter/modal-route-metadata.ts' },
    { status: 'M', path: 'apps/web/public/platform.js' },
  ];
  const patches = new Map([
    ['prisma/schema.prisma', '+model PressureModal {}'],
    ['apps/api/src/rooms.controller.ts', "+@Post(':runId/modal-test')"],
    ['apps/web/public/app.js', "+if (location.pathname === '/pressure-test') renderTest();"],
    ['apps/api/src/pressure-chapter/modal-trigger.worker.ts', '+export class ModalTriggerWorker {}'],
    ['apps/api/src/pressure-chapter/parallel-authority.ts', '+await tx.storyEvent.create({ data });'],
    ['apps/api/src/pressure-chapter/a-emotion-production/provider-client.ts', "+import OpenAI from 'openai';\n+await fetch(endpoint);"],
    ['apps/api/src/pressure-chapter/modal-route-metadata.ts', "+Reflect.defineMetadata(PATH_METADATA, '/modal-test', handler);"],
    ['apps/web/public/platform.js', '+renderUnapprovedPlayerSurface();'],
  ]);
  const codes = new Set(inspectModalTriggerScope({ changes, patches }).map((item) => item.code));
  for (const code of [
    'PRISMA_SCHEMA_OR_MIGRATION_CHANGED', 'NEW_PRISMA_MODEL', 'NEW_API_PATH', 'NEW_PAGE_FILE',
    'NEW_WEB_ROUTE', 'ROLE_AVATAR_OR_WORLD_CHANGED',
    'UNAPPROVED_PLAYER_VISIBLE_PATH', 'NEW_WORKER', 'SECOND_AUTHORITY_WRITER',
    'DETERMINISTIC_AI_PROVIDER_OR_NETWORK',
  ]) assert.equal(codes.has(code), true, `missing ${code}`);
});

test('scope guard player-visible allowlist is exactly the approved existing 03-06 integration surface', () => {
  const approved = [
    'apps/web/public/game-bootstrap.js',
    'apps/web/public/index.html',
    'apps/web/public/pressure-chapter-game-v1.css',
    'apps/web/public/pressure-chapter-game-v1.js',
    'apps/web/public/pressure-chapter-workbench-v1.css',
    'apps/web/public/pressure-chapter-workbench-v1.js',
  ];
  assert.deepEqual(inspectModalTriggerScope({
    changes: approved.map((path) => ({ status: 'M', path })),
    patches: new Map(approved.map((path) => [path, '+approved existing integration'])),
  }), []);
});

test('test specs under apps remain permitted by the route detector', () => {
  const changes = [{ status: 'A', path: 'apps/api/src/pressure-chapter/modal.api.spec.ts' }];
  const patches = new Map([[changes[0].path, "+@Post(':runId/test-only')"]]);
  assert.deepEqual(inspectModalTriggerScope({ changes, patches }), []);
});
