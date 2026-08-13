import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const MODAL_TRIGGER_BASE_SHA = 'b5c3b95afc6b9994332cf6aed7928e9ce5a76ffd';

const approvedPhase1PlayerVisiblePaths = new Set([
  'apps/web/public/game-bootstrap.js',
  'apps/web/public/index.html',
  'apps/web/public/pressure-chapter-game-v1.css',
  'apps/web/public/pressure-chapter-game-v1.js',
  'apps/web/public/pressure-chapter-workbench-v1.css',
  'apps/web/public/pressure-chapter-workbench-v1.js',
]);

const approvedAuthorityWriterPaths = new Set([
  'apps/api/src/pressure-chapter/persistence/working-ledger.prisma-adapter.ts',
  'apps/api/src/pressure-chapter/a-emotion-persistence/prisma-adapters.ts',
]);

const productionTestSuffix = /(?:\.(?:spec|test)\.(?:[cm]?[jt]s|tsx?)|\/tests?\/|\/fixtures?\/)/u;
const worldSurface = /^(?:packages\/templates\/config\/(?:game-registry\.json|[^/]+\/(?:game\.json|roles?(?:\.|\/)|assets\/roles?\/))|apps\/api\/src\/mvp-catalog\.[cm]?[jt]s|apps\/web\/public\/(?:worlds?|role-select)\.[cm]?[jt]s|apps\/web\/public\/assets\/(?:game|roles?|avatars?)\/)/u;
const deterministicAiSurface = /^apps\/api\/src\/pressure-chapter\/(?:a-emotion(?:-[^/]+)?|decision-automation)\//u;
const productionSource = /\.(?:[cm]?[jt]s|tsx?)$/u;

export function inspectModalTriggerScope({ changes, patches = new Map() }) {
  const violations = [];
  for (const change of changes) {
    const file = change.path.replaceAll('\\', '/');
    if (file === 'prisma/schema.prisma' || file.startsWith('prisma/migrations/')) {
      violations.push({ code: 'PRISMA_SCHEMA_OR_MIGRATION_CHANGED', path: file });
    }
    if (worldSurface.test(file)) {
      violations.push({ code: 'ROLE_AVATAR_OR_WORLD_CHANGED', path: file });
    }
    if (change.status === 'A' && /^apps\/web\/(?:src|public)\/.*\.(?:html|htm)$/u.test(file)) {
      violations.push({ code: 'NEW_PAGE_FILE', path: file });
    }
    if (/^apps\/web\/(?:src|public)\//u.test(file)
      && !productionTestSuffix.test(file)
      && !approvedPhase1PlayerVisiblePaths.has(file)) {
      violations.push({ code: 'UNAPPROVED_PLAYER_VISIBLE_PATH', path: file });
    }
    const patch = patches.get(file) ?? '';
    const added = patch.split(/\r?\n/u).filter((line) => line.startsWith('+') && !line.startsWith('+++')).join('\n');
    if (file.startsWith('apps/api/') && !productionTestSuffix.test(file)
      && /@(?:Get|Post|Put|Patch|Delete)\s*\(|\b(?:router|app)\.(?:get|post|put|patch|delete)\s*\(|\b(?:PATH_METADATA|RequestMethod|requestMethod|routePath)\b|Reflect\.defineMetadata\s*\([^\n]*(?:path|method)/u.test(added)) {
      violations.push({ code: 'NEW_API_PATH', path: file });
    }
    if (file === 'prisma/schema.prisma' && /^\+\s*model\s+\w+/mu.test(added)) {
      violations.push({ code: 'NEW_PRISMA_MODEL', path: file });
    }
    if (/^apps\/web\/(?:src|public)\//u.test(file) && !productionTestSuffix.test(file)
      && !approvedPhase1PlayerVisiblePaths.has(file)
      && /^\+.*(?:route\s*[:=]|location\.pathname|pathname\s*===|app\.get\s*\()/mu.test(added)) {
      violations.push({ code: 'NEW_WEB_ROUTE', path: file });
    }
    if (change.status === 'A' && productionSource.test(file) && !productionTestSuffix.test(file)
      && /(?:^|\/)(?:[^/]*worker[^/]*)\.(?:[cm]?[jt]s|tsx?)$/iu.test(file)) {
      violations.push({ code: 'NEW_WORKER', path: file });
    }
    if (change.status === 'A' && file.startsWith('apps/api/') && !productionTestSuffix.test(file)
      && !approvedAuthorityWriterPaths.has(file)
      && /(?:implements\s+WorkingLedgerPort|\bstoryEvent\.create\s*\(|\bpressureDecisionAction\.create\s*\(|\bpressureChapterRuntime\.(?:create|update|updateMany)\s*\()/u.test(added)) {
      violations.push({ code: 'SECOND_AUTHORITY_WRITER', path: file });
    }
    if (deterministicAiSurface.test(file) && !productionTestSuffix.test(file)
      && /(?:from\s+["'](?:openai|axios|undici|node:https?|@aws-sdk\/client-bedrock-runtime)["']|\bfetch\s*\(|\b(?:provider|llm|modelClient)\s*\.\s*(?:invoke|generate|complete|create|request)\s*\()/iu.test(added)) {
      violations.push({ code: 'DETERMINISTIC_AI_PROVIDER_OR_NETWORK', path: file });
    }
  }
  return violations;
}

export function collectGitScope(repoRoot, baseSha = MODAL_TRIGGER_BASE_SHA) {
  git(repoRoot, ['cat-file', '-e', `${baseSha}^{commit}`]);
  const tracked = parseNameStatus(git(repoRoot, ['-c', 'core.quotePath=false', 'diff', '--name-status', '--find-renames', baseSha, '--']));
  const untracked = git(repoRoot, ['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard'])
    .split(/\r?\n/u).filter(Boolean).map((file) => ({ status: 'A', path: file }));
  const changesByPath = new Map([...tracked, ...untracked].map((change) => [change.path, change]));
  const patches = new Map();
  for (const change of changesByPath.values()) {
    if (change.status === 'A' && untracked.some((item) => item.path === change.path) && isTextPatchCandidate(change.path)) {
      const absolute = path.resolve(repoRoot, change.path);
      const content = execFileSync(process.execPath, ['-e', "process.stdout.write(require('fs').readFileSync(process.argv[1], 'utf8'))", absolute], { encoding: 'utf8' });
      patches.set(change.path, content.split(/\r?\n/u).map((line) => `+${line}`).join('\n'));
    } else {
      patches.set(change.path, git(repoRoot, ['diff', '--unified=0', baseSha, '--', change.path]));
    }
  }
  return { baseSha, changes: [...changesByPath.values()], patches };
}

function isTextPatchCandidate(file) {
  return /(?:^|\/)(?:[^/]+\.(?:[cm]?[jt]s|tsx?|json|html?|css|prisma|sql|md|ya?ml)|Dockerfile)$/iu.test(file);
}

function parseNameStatus(output) {
  return output.split(/\r?\n/u).filter(Boolean).map((line) => {
    const fields = line.split('\t');
    const status = fields[0][0];
    return { status, path: status === 'R' || status === 'C' ? fields[2] : fields[1] };
  });
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function main() {
  const repoRoot = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  const scope = collectGitScope(repoRoot);
  const violations = inspectModalTriggerScope(scope);
  const result = {
    schemaVersion: 'pressure_modal_trigger_scope_guard_v1',
    baseSha: scope.baseSha,
    changedPaths: scope.changes.map((change) => change.path).sort(),
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    violations,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (violations.length > 0) process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
