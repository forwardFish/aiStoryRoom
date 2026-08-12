import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import {
  assertNonProductionScope,
  fetchWithTimeout,
  normalizeBaseUrl,
  readJsonFixture,
  requireFixtureString,
  skipUnlessEnvironment,
} from '../../lib/live-fixture.mjs';

test('formal acceptance is bound to one clean SHA, managed Supabase, fixtures, and reachable stack', async (t) => {
  if (skipUnlessEnvironment(t, [
    'PRESSURE_CHAPTER_ALLOW_ACCEPTANCE_TESTS',
    'PRESSURE_CHAPTER_ACCEPTANCE_SHA',
    'PRESSURE_CHAPTER_TEST_SCOPE',
    'PRESSURE_CHAPTER_DB_SCOPE',
    'PRESSURE_CHAPTER_DATABASE_PROVIDER',
    'DATABASE_URL',
    'PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256',
    'PRESSURE_CHAPTER_PROVIDER_SCOPE',
    'PRESSURE_CHAPTER_TEST_BASE_URL',
    'PRESSURE_CHAPTER_E2E_AUTH_FIXTURE',
    'PRESSURE_CHAPTER_BROWSER_AUTH_FIXTURE',
  ])) return;
  assert.equal(process.env.PRESSURE_CHAPTER_ALLOW_ACCEPTANCE_TESTS, '1');
  assertNonProductionScope();
  assert.equal(process.env.PRESSURE_CHAPTER_DATABASE_PROVIDER, 'supabase');
  assert.equal(process.env.PRESSURE_CHAPTER_PROVIDER_SCOPE, 'non-production');

  const expectedSha = process.env.PRESSURE_CHAPTER_ACCEPTANCE_SHA.toLowerCase();
  const actualSha = git(['rev-parse', 'HEAD']).trim().toLowerCase();
  assert.equal(actualSha, expectedSha, 'acceptance checkout does not match PRESSURE_CHAPTER_ACCEPTANCE_SHA');
  assert.equal(
    git(['status', '--porcelain=v1', '--untracked-files=all']).trim(),
    '',
    'formal acceptance requires a clean exact-SHA checkout',
  );

  const databaseContractModule = await import('../../../../../apps/api/src/pressure-chapter/persistence/database-contract.ts');
  const { assertSafePressureDatabaseScope } = databaseContractModule.default ?? databaseContractModule;
  const databaseScope = assertSafePressureDatabaseScope({
    databaseUrl: process.env.DATABASE_URL,
    explicitScope: process.env.PRESSURE_CHAPTER_DB_SCOPE,
    allowedSupabaseProjectSha256: process.env.PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256,
  });
  assert.equal(databaseScope.supabaseProjectFingerprint, process.env.PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256.toLowerCase());

  const e2eFixture = await readJsonFixture(
    process.env.PRESSURE_CHAPTER_E2E_AUTH_FIXTURE,
    'PRESSURE_CHAPTER_E2E_AUTH_FIXTURE',
  );
  requireFixtureString(e2eFixture, 'runId', 'E2E fixture');
  requireFixtureString(e2eFixture, 'cookie', 'E2E fixture');

  const browserFixture = await readJsonFixture(
    process.env.PRESSURE_CHAPTER_BROWSER_AUTH_FIXTURE,
    'PRESSURE_CHAPTER_BROWSER_AUTH_FIXTURE',
  );
  requireFixtureString(browserFixture, 'runId', 'browser fixture');
  assert.ok(Array.isArray(browserFixture.viewers) && browserFixture.viewers.length >= 2, 'browser fixture requires at least two viewers');

  const baseUrl = normalizeBaseUrl(process.env.PRESSURE_CHAPTER_TEST_BASE_URL);
  const readyUrl = new URL('/api/health/ready', `${baseUrl}/`).href;
  const response = await fetchWithTimeout(readyUrl, { headers: { accept: 'application/json' } }, 15_000);
  assert.ok(response.ok, `non-production stack readiness failed with HTTP ${response.status}`);
});

function git(args) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
