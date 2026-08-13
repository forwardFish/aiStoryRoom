import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runSuite } from './run-suite.mjs';
import { PRESSURE_CHAPTER_SUITES } from './suite-definitions.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pressure-chapter-runner-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

const testStep = (args = ['-e', 'process.exit(0)', '{files}']) => ({
  id: 'fixture-tests',
  executable: process.execPath,
  args,
  cwd: '.',
  globs: ['tests/**/*.test.mjs'],
  minMatches: 1,
});

test('suite registry exposes the thirteen fail-closed harness commands', () => {
  assert.deepEqual(Object.keys(PRESSURE_CHAPTER_SUITES).sort(), [
    'acceptance',
    'api',
    'browser',
    'contracts',
    'db',
    'e2e',
    'fault',
    'legacy',
    'modal-trigger-contract',
    'modal-trigger-live',
    'provider-contract',
    'provider-live',
    'settlement-core',
  ]);
});

test('missing test glob fails before spawning a child', async (t) => {
  const repoRoot = await fixture(t);
  let spawnCount = 0;
  const result = await runSuite({
    suiteName: 'missing',
    suite: { steps: [testStep()] },
    repoRoot,
    spawn: () => {
      spawnCount += 1;
      return { status: 0 };
    },
  });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.phase, 'PREFLIGHT');
  assert.equal(result.issues[0].id, 'MISSING_TESTS');
  assert.equal(spawnCount, 0);
});

test('missing required environment blocks before spawning a child and does not expose values', async (t) => {
  const repoRoot = await fixture(t);
  await mkdir(path.join(repoRoot, 'tests'), { recursive: true });
  await writeFile(path.join(repoRoot, 'tests', 'present.test.mjs'), 'export {};\n');
  let spawnCount = 0;
  const result = await runSuite({
    suiteName: 'environment',
    suite: {
      requiredEnvironment: [{ name: 'PRIVATE_TEST_TOKEN', equals: 'authorized' }],
      steps: [testStep()],
    },
    repoRoot,
    environment: { PRIVATE_TEST_TOKEN: 'secret-value' },
    spawn: () => {
      spawnCount += 1;
      return { status: 0 };
    },
  });
  assert.equal(result.status, 'BLOCKED_BY_ENVIRONMENT');
  assert.equal(result.phase, 'PREFLIGHT');
  assert.equal(result.issues[0].id, 'MISSING_REQUIRED_ENVIRONMENT');
  assert.equal(spawnCount, 0);
  assert.doesNotMatch(JSON.stringify(result), /secret-value/u);
});

test('a missing test remains a hard failure even when environment is also blocked', async (t) => {
  const repoRoot = await fixture(t);
  const result = await runSuite({
    suiteName: 'blocked-and-missing',
    suite: {
      requiredEnvironment: [{ name: 'LIVE_SERVICE_URL', present: true }],
      steps: [testStep()],
    },
    repoRoot,
    environment: {},
  });
  assert.equal(result.status, 'FAIL');
  assert.deepEqual(result.issues.map((issue) => issue.id).sort(), [
    'MISSING_REQUIRED_ENVIRONMENT',
    'MISSING_TESTS',
  ]);
});

test('failing child exit makes the suite fail closed', async (t) => {
  const repoRoot = await fixture(t);
  await mkdir(path.join(repoRoot, 'tests'), { recursive: true });
  await writeFile(path.join(repoRoot, 'tests', 'present.test.mjs'), 'export {};\n');
  const result = await runSuite({
    suiteName: 'child-failure',
    suite: { steps: [testStep(['-e', 'process.exit(7)', '{files}'])] },
    repoRoot,
  });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.phase, 'EXECUTION');
  assert.equal(result.childResults[0].exitCode, 7);
  assert.equal(result.issues[0].id, 'CHILD_PROCESS_FAILED');
});

test('all declared children and matching tests must pass for suite PASS', async (t) => {
  const repoRoot = await fixture(t);
  await mkdir(path.join(repoRoot, 'tests', 'nested'), { recursive: true });
  await writeFile(path.join(repoRoot, 'tests', 'nested', 'present.test.mjs'), 'export {};\n');
  let spawnCount = 0;
  const result = await runSuite({
    suiteName: 'all-pass',
    suite: {
      steps: [
        { id: 'first', executable: process.execPath, args: ['-e', 'process.exit(0)'], cwd: '.' },
        testStep(),
      ],
    },
    repoRoot,
    spawn: () => {
      spawnCount += 1;
      return { status: 0, stdout: '', stderr: '', signal: null };
    },
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.phase, 'COMPLETE');
  assert.equal(spawnCount, 2);
  assert.equal(result.childResults.length, 2);
});
