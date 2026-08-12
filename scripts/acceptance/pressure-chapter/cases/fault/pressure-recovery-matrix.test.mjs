import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { skipUnlessEnvironment } from '../../lib/live-fixture.mjs';

const RECOVERY_SPECS = Object.freeze([
  'apps/api/src/pressure-chapter/genesis/genesis.service.spec.ts',
  'apps/api/src/pressure-chapter/orchestrator/chapter-orchestrator.spec.ts',
  'apps/api/src/pressure-chapter/chapter-settlement/chapter-settlement.orchestrator.spec.ts',
  'apps/api/src/pressure-chapter/progress-outbox/progress-outbox.spec.ts',
  'apps/api/src/pressure-chapter/decision-automation/decision-automation.spec.ts',
  'apps/api/src/pressure-chapter/a-emotion-production/a-emotion-production.api.spec.ts',
  'apps/api/src/pressure-chapter/narrative-production/tests/narrative-production.api.spec.ts',
]);

test('Pressure fault matrix executes current crash, lease, replay, and outbox recovery modules', async (t) => {
  if (skipUnlessEnvironment(t, ['PRESSURE_CHAPTER_ALLOW_FAULT_TESTS'])) return;
  assert.equal(process.env.PRESSURE_CHAPTER_ALLOW_FAULT_TESTS, '1');

  for (const relativePath of RECOVERY_SPECS) {
    const absolutePath = path.resolve(process.cwd(), relativePath);
    assert.ok((await stat(absolutePath)).isFile(), `missing current Pressure recovery spec: ${relativePath}`);
    const { NODE_TEST_CONTEXT: _parentTestContext, ...childEnvironment } = process.env;
    const child = spawnSync(process.execPath, [
      '--import',
      'tsx',
      '--test',
      '--test-reporter=tap',
      relativePath,
    ], {
      cwd: process.cwd(),
      env: {
        ...childEnvironment,
        TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json',
      },
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(
      child.error,
      undefined,
      `${relativePath} could not start: ${child.error?.code ?? 'unknown'}`,
    );
    assert.equal(
      child.status,
      0,
      `${relativePath} failed\n${child.stdout ?? ''}\n${child.stderr ?? ''}`,
    );
    assert.match(child.stdout, /# pass [1-9][0-9]*/u, `${relativePath} did not execute a real test`);
    assert.match(
      child.stdout,
      /crash|lease|replay|retry|idempot|outbox/iu,
      `${relativePath} did not expose its recovery boundary in TAP output`,
    );
  }
});
