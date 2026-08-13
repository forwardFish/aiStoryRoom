const nodeTest = (globs, minMatches) => ({
  executable: process.execPath,
  args: ['--import', 'tsx', '--test', '{files}'],
  cwd: '.',
  globs,
  minMatches,
});

const typecheck = (packageName) => ({
  executable: 'pnpm',
  args: ['--filter', packageName, 'typecheck'],
  cwd: '.',
});

export const PRESSURE_CHAPTER_SUITES = Object.freeze({
  'modal-trigger-contract': {
    description: 'Environment-free modal trigger oracle, privacy, transaction and static scope guards',
    steps: [{
      id: 'modal-trigger-contract-tests',
      executable: process.execPath,
      args: ['--test', '{files}'],
      cwd: '.',
      globs: ['scripts/acceptance/pressure-chapter/cases/contracts/modal-trigger-*.test.mjs'],
      minMatches: 2,
    }],
  },
  'modal-trigger-live': {
    description: 'Real non-production API and browser closure for the modal trigger chain',
    requiredEnvironment: [
      { name: 'PRESSURE_CHAPTER_ALLOW_MODAL_TRIGGER_TESTS', equals: '1' },
      { name: 'PRESSURE_CHAPTER_TEST_SCOPE', equals: 'non-production' },
      { name: 'PRESSURE_CHAPTER_DB_SCOPE', equals: 'non-production' },
      { name: 'PRESSURE_CHAPTER_DATABASE_PROVIDER', equals: 'supabase' },
      { name: 'DATABASE_URL', present: true },
      { name: 'PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256', matches: '^[0-9a-fA-F]{64}$' },
      { name: 'PRESSURE_CHAPTER_TEST_BASE_URL', present: true },
      { name: 'PRESSURE_MODAL_TRIGGER_LIVE_FIXTURE', present: true },
      { name: 'PRESSURE_MODAL_TRIGGER_PROVIDER_TRACE', present: true },
      { name: 'PRESSURE_CHAPTER_BROWSER_AUTH_FIXTURE', present: true },
      { name: 'PRESSURE_MODAL_TRIGGER_VISUAL_REFERENCE_DIR', present: true },
    ],
    forbiddenEnvironment: [{ name: 'NODE_ENV', equals: 'production' }],
    steps: [
      {
        id: 'modal-trigger-live-api-tests',
        executable: process.execPath,
        args: ['--test', '{files}'],
        cwd: '.',
        globs: [
          'scripts/acceptance/pressure-chapter/cases/e2e/modal-trigger-chain-live.test.mjs',
          'scripts/acceptance/pressure-chapter/cases/e2e/solo-ai-zero-provider-live.test.mjs',
        ],
        minMatches: 2,
      },
      {
        id: 'modal-trigger-fault-db-tests',
        executable: process.execPath,
        args: ['--import', 'tsx', '--test', '{files}'],
        cwd: '.',
        environment: { PRESSURE_CHAPTER_ALLOW_FAULT_TESTS: '1' },
        globs: ['scripts/acceptance/pressure-chapter/cases/fault/modal-ledger-outbox-live.test.mjs'],
        minMatches: 1,
      },
      {
        id: 'modal-trigger-real-browser-tests',
        executable: process.execPath,
        args: ['--test', '{files}'],
        cwd: '.',
        environment: { PRESSURE_CHAPTER_ALLOW_BROWSER_TESTS: '1' },
        globs: ['scripts/acceptance/pressure-chapter/cases/browser/real-multirole-pressure.test.mjs'],
        minMatches: 1,
      },
    ],
  },
  contracts: {
    description: 'Pressure Chapter shared contracts and frozen route registry',
    steps: [
      { id: 'shared-typecheck', ...typecheck('@ai-story/shared') },
      { id: 'templates-typecheck', ...typecheck('@ai-story/templates') },
      {
        id: 'shared-contract-tests',
        ...nodeTest([
          'packages/shared/tests/pressure-chapter-contracts*.spec.ts',
          'packages/shared/tests/pressure-chapter-contracts*.test.ts',
        ], 1),
      },
      {
        id: 'shared-json-schema-tests',
        ...nodeTest([
          'packages/shared/tests/pressure-chapter-json-schemas.spec.ts',
        ], 1),
      },
      {
        id: 'template-registry-tests',
        ...nodeTest([
          'packages/templates/tests/pressure-chapter-registry*.spec.ts',
          'packages/templates/tests/pressure-chapter-registry*.test.ts',
        ], 1),
      },
      {
        id: 'published-game-registry-tests',
        ...nodeTest([
          'packages/templates/tests/game-registry.test.ts',
        ], 1),
      },
      {
        id: 'release-artifact-tests',
        ...nodeTest([
          'packages/templates/tests/pressure-chapter-release-artifacts.test.ts',
        ], 1),
      },
    ],
  },
  api: {
    description: 'Pressure Chapter API contracts and application-service behavior',
    steps: [
      {
        id: 'api-tests',
        environment: { TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json' },
        ...nodeTest([
          'apps/api/src/pressure-chapter/**/*.api.spec.ts',
          'apps/api/src/pressure-chapter/**/*.api.test.ts',
          'apps/api/src/pressure-chapter/**/*.pressure-chapter.e2e.spec.ts',
          'apps/api/src/pressure-chapter/**/*.pressure-chapter.e2e.test.ts',
        ], 1),
      },
      {
        id: 'api-route-and-privacy-tests',
        environment: { TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json' },
        ...nodeTest([
          'apps/api/src/rooms.pressure-routing.spec.ts',
          'apps/api/src/rooms.presentation.spec.ts',
          'apps/api/src/worlds.controller.spec.ts',
          'apps/api/src/mvp-catalog.spec.ts',
        ], 4),
      },
      {
        id: 'web-pressure-contract-tests',
        ...nodeTest([
          'apps/web/tests/pressure-chapter-game-v1.test.mjs',
          'apps/web/tests/pressure-chapter-workbench-v1.test.mjs',
          'apps/web/tests/room-role-selection-view.test.mjs',
        ], 3),
      },
    ],
  },
  'settlement-core': {
    description: 'Deterministic B0, Chapter/Decision/Beat domain and recovery behavior',
    steps: [
      { id: 'shared-typecheck', ...typecheck('@ai-story/shared') },
      { id: 'templates-typecheck', ...typecheck('@ai-story/templates') },
      {
        id: 'b0-tests',
        ...nodeTest([
          'packages/shared/tests/pressure-chapter-b0*.spec.ts',
          'packages/shared/tests/pressure-chapter-b0*.test.ts',
        ], 1),
      },
      {
        id: 'chapter-domain-tests',
        ...nodeTest([
          'packages/templates/tests/pressure-chapter-domain*.spec.ts',
          'packages/templates/tests/pressure-chapter-domain*.test.ts',
        ], 1),
      },
      {
        id: 'chapter-recovery-tests',
        ...nodeTest([
          'packages/templates/tests/pressure-chapter-recovery*.spec.ts',
          'packages/templates/tests/pressure-chapter-recovery*.test.ts',
        ], 1),
      },
    ],
  },
  db: {
    description: 'Pressure Chapter persistence, migration, uniqueness and transaction behavior',
    requiredEnvironment: [
      { name: 'PRESSURE_CHAPTER_ALLOW_NON_PRODUCTION_DB_TESTS', equals: '1' },
      { name: 'PRESSURE_CHAPTER_DB_SCOPE', equals: 'non-production' },
      { name: 'PRESSURE_CHAPTER_DATABASE_PROVIDER', equals: 'supabase' },
      { name: 'DATABASE_URL', present: true },
      { name: 'PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256', matches: '^[0-9a-fA-F]{64}$' },
    ],
    forbiddenEnvironment: [{ name: 'NODE_ENV', equals: 'production' }],
    steps: [{
      id: 'db-tests',
      ...nodeTest([
        'apps/api/src/pressure-chapter/**/*.db.spec.ts',
        'apps/api/src/pressure-chapter/**/*.db.test.ts',
      ], 1),
    }],
  },
  fault: {
    description: 'Pressure Chapter crash, retry, idempotency and outbox recovery matrix',
    requiredEnvironment: [{ name: 'PRESSURE_CHAPTER_ALLOW_FAULT_TESTS', equals: '1' }],
    steps: [{
      id: 'fault-tests',
      environment: { TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json' },
      ...nodeTest([
        'scripts/acceptance/pressure-chapter/cases/fault/**/*.test.mjs',
      ], 1),
    }],
  },
  e2e: {
    description: 'Deterministic P0 through N7 and Finale product flow',
    requiredEnvironment: [
      { name: 'PRESSURE_CHAPTER_ALLOW_E2E_TESTS', equals: '1' },
      { name: 'PRESSURE_CHAPTER_TEST_SCOPE', equals: 'non-production' },
      { name: 'PRESSURE_CHAPTER_DB_SCOPE', equals: 'non-production' },
      { name: 'PRESSURE_CHAPTER_DATABASE_PROVIDER', equals: 'supabase' },
      { name: 'DATABASE_URL', present: true },
      { name: 'PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256', matches: '^[0-9a-fA-F]{64}$' },
      { name: 'PRESSURE_CHAPTER_TEST_BASE_URL', present: true },
      { name: 'PRESSURE_CHAPTER_E2E_AUTH_FIXTURE', present: true },
    ],
    forbiddenEnvironment: [{ name: 'NODE_ENV', equals: 'production' }],
    steps: [{
      id: 'e2e-tests',
      ...nodeTest([
        'scripts/acceptance/pressure-chapter/cases/e2e/**/*.test.mjs',
      ], 1),
    }],
  },
  browser: {
    description: 'Real game-page multi-role browser, privacy and visual evidence',
    requiredEnvironment: [
      { name: 'PRESSURE_CHAPTER_ALLOW_BROWSER_TESTS', equals: '1' },
      { name: 'PRESSURE_CHAPTER_TEST_SCOPE', equals: 'non-production' },
      { name: 'PRESSURE_CHAPTER_TEST_BASE_URL', present: true },
      { name: 'PRESSURE_CHAPTER_BROWSER_AUTH_FIXTURE', present: true },
    ],
    forbiddenEnvironment: [{ name: 'NODE_ENV', equals: 'production' }],
    steps: [{
      id: 'browser-tests',
      ...nodeTest([
        'scripts/acceptance/pressure-chapter/cases/browser/**/*.test.mjs',
      ], 1),
    }],
  },
  legacy: {
    description: 'Completed and incomplete legacy Run read-only compatibility',
    steps: [
      {
        id: 'legacy-tests',
        ...nodeTest([
          'apps/api/src/pressure-chapter/**/*.legacy.spec.ts',
          'apps/api/src/pressure-chapter/**/*.legacy.test.ts',
          'scripts/acceptance/pressure-chapter/cases/legacy/**/*.test.mjs',
        ], 1),
      },
      {
        id: 'source-regression-inventory-tests',
        ...nodeTest([
          'packages/templates/tests/pressure-chapter-release-artifacts.test.ts',
        ], 1),
      },
      {
        id: 'stored-continuous-run-compatibility-tests',
        environment: { TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json' },
        ...nodeTest([
          'apps/api/src/continuous-strategy/content.service.spec.ts',
        ], 1),
      },
    ],
  },
  'provider-contract': {
    description: 'Provider-independent Narrative projection, Truth Guard and fallback contracts',
    steps: [{
      id: 'provider-contract-tests',
      ...nodeTest([
        'apps/openovel-runtime/tests/**/*.pressure-chapter.provider-contract.spec.ts',
        'apps/openovel-runtime/tests/**/*.pressure-chapter.provider-contract.test.ts',
        'scripts/acceptance/pressure-chapter/cases/provider-contract/**/*.test.mjs',
      ], 1),
    }],
  },
  'provider-live': {
    description: 'Explicitly authorized non-production live Provider acceptance',
    requiredEnvironment: [
      { name: 'PRESSURE_CHAPTER_ALLOW_LIVE_PROVIDER_TESTS', equals: '1' },
      { name: 'PRESSURE_CHAPTER_PROVIDER_SCOPE', equals: 'non-production' },
      { oneOf: ['DEEPSEEK_API_KEY', 'OPENOVEL_API_KEY', 'OPENNOVEL_PROVIDER_API_KEY'], present: true },
    ],
    forbiddenEnvironment: [{ name: 'NODE_ENV', equals: 'production' }],
    steps: [{
      id: 'provider-live-tests',
      ...nodeTest([
        'scripts/acceptance/pressure-chapter/cases/provider-live/**/*.test.mjs',
      ], 1),
    }],
  },
  acceptance: {
    description: 'Exact-SHA non-production DB, Provider and browser acceptance closure',
    requiredEnvironment: [
      { name: 'PRESSURE_CHAPTER_ALLOW_ACCEPTANCE_TESTS', equals: '1' },
      { name: 'PRESSURE_CHAPTER_ACCEPTANCE_SHA', matches: '^[0-9a-fA-F]{40}$' },
      { name: 'PRESSURE_CHAPTER_TEST_SCOPE', equals: 'non-production' },
      { name: 'PRESSURE_CHAPTER_DB_SCOPE', equals: 'non-production' },
      { name: 'PRESSURE_CHAPTER_DATABASE_PROVIDER', equals: 'supabase' },
      { name: 'DATABASE_URL', present: true },
      { name: 'PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256', matches: '^[0-9a-fA-F]{64}$' },
      { name: 'PRESSURE_CHAPTER_PROVIDER_SCOPE', equals: 'non-production' },
      { oneOf: ['DEEPSEEK_API_KEY', 'OPENOVEL_API_KEY', 'OPENNOVEL_PROVIDER_API_KEY'], present: true },
      { name: 'PRESSURE_CHAPTER_TEST_BASE_URL', present: true },
      { name: 'PRESSURE_CHAPTER_E2E_AUTH_FIXTURE', present: true },
      { name: 'PRESSURE_CHAPTER_BROWSER_AUTH_FIXTURE', present: true },
    ],
    forbiddenEnvironment: [{ name: 'NODE_ENV', equals: 'production' }],
    steps: [
      {
        id: 'acceptance-provenance-tests',
        ...nodeTest([
          'scripts/acceptance/pressure-chapter/cases/acceptance/**/*.test.mjs',
        ], 1),
      },
      {
        id: 'acceptance-db-tests',
        environment: {
          PRESSURE_CHAPTER_ALLOW_NON_PRODUCTION_DB_TESTS: '1',
          TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json',
        },
        ...nodeTest([
          'apps/api/src/pressure-chapter/**/*.db.spec.ts',
          'apps/api/src/pressure-chapter/**/*.db.test.ts',
        ], 1),
      },
      {
        id: 'acceptance-fault-tests',
        environment: {
          PRESSURE_CHAPTER_ALLOW_FAULT_TESTS: '1',
          TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json',
        },
        ...nodeTest([
          'scripts/acceptance/pressure-chapter/cases/fault/**/*.test.mjs',
        ], 1),
      },
      {
        id: 'acceptance-e2e-tests',
        environment: { PRESSURE_CHAPTER_ALLOW_E2E_TESTS: '1' },
        ...nodeTest([
          'scripts/acceptance/pressure-chapter/cases/e2e/**/*.test.mjs',
        ], 1),
      },
      {
        id: 'acceptance-browser-tests',
        environment: { PRESSURE_CHAPTER_ALLOW_BROWSER_TESTS: '1' },
        ...nodeTest([
          'scripts/acceptance/pressure-chapter/cases/browser/**/*.test.mjs',
        ], 1),
      },
      {
        id: 'acceptance-provider-live-tests',
        environment: { PRESSURE_CHAPTER_ALLOW_LIVE_PROVIDER_TESTS: '1' },
        ...nodeTest([
          'scripts/acceptance/pressure-chapter/cases/provider-live/**/*.test.mjs',
        ], 1),
      },
    ],
  },
});

export function getPressureChapterSuite(name) {
  return PRESSURE_CHAPTER_SUITES[name] ?? null;
}
