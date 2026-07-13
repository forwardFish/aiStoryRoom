import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const compose = await readFile(join(root, "docker-compose.yml"), "utf8");
const envExample = await readFile(join(root, ".env.example"), "utf8");
assert.match(compose, /archive_mode=on/);
assert.match(compose, /archive_command=cp/);
assert.match(compose, /postgres_wal_archive/);
assert.match(compose, /postgres_backup_data/);
assert.match(compose, /BACKUP_RETENTION_DAYS: 30/);
assert.match(compose, /DATABASE_URL:\s*\$\{DATABASE_URL:-/);
assert.match(envExample, /^DATABASE_TARGET=external\s*$/m, "example env must document external/Supabase deployment");
assert.match(envExample, /^RESTORE_DATABASE_URL=/m, "example env must document an isolated restore target");
assert.match(envExample, /^DEEPSEEK_API_KEY=\s*$/m, "example env must never contain a live key");
for (const file of ["scripts/ops/backup-postgres.ps1", "scripts/ops/restore-smoke.ps1", "scripts/ops/check-wal-archive.ps1", "scripts/acceptance/run-db-ops-acceptance.ps1", "scripts/acceptance/run-local-postgres-ops.ps1"]) {
  const content = await readFile(join(root, file), "utf8");
  assert.match(content, /external|ConnectionString/i, `${file} lacks external PostgreSQL/Supabase mode`);
  assert.ok(content.includes("rpoTargetMinutes") || content.includes("MaxAgeMinutes") || content.includes("rtoTargetSeconds"), `${file} lacks recovery evidence fields`);
}
const result = { schemaVersion: "ops-contract-v1", status: "PASS", backupRetentionDays: 30, walTargetMinutes: 15, rtoTargetHours: 2 };
await import("node:fs/promises").then(({ mkdir, writeFile }) => mkdir(join(root, "docs/auto-execute/results"), { recursive: true }).then(() => writeFile(join(root, "docs/auto-execute/results/ops-contract.json"), `${JSON.stringify(result, null, 2)}\n`)));
console.log(JSON.stringify(result, null, 2));
