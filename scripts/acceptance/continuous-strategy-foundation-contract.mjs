import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const schemaPath = path.join(root, "prisma", "schema.prisma");
const migrationsRoot = path.join(root, "prisma", "migrations");
const targetMigration = "20260716120000_foundation_current_schema";
const firstExpandMigration = "20260716130000_continuous_strategy_p0_expand";
const targetPath = path.join(migrationsRoot, targetMigration, "migration.sql");
const requiredModels = [
  "CanonFact",
  "CharacterMind",
  "StoryThread",
  "SceneSnapshot",
  "NarrativeEntry",
  "StoryTaskOutbox"
];

const expectedColumns = {
  CanonFact: [
    '"id" TEXT NOT NULL',
    '"runId" TEXT NOT NULL',
    '"sourceNodeId" TEXT',
    '"factKey" TEXT NOT NULL',
    '"content" TEXT NOT NULL',
    '"status" TEXT NOT NULL DEFAULT \'confirmed\'',
    '"visibility" TEXT NOT NULL DEFAULT \'public\'',
    '"sourceEventIdsJson" JSONB NOT NULL',
    '"sourceActionIdsJson" JSONB NOT NULL',
    '"knownByRoleIdsJson" JSONB NOT NULL',
    '"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    '"updatedAt" TIMESTAMP(3) NOT NULL'
  ],
  CharacterMind: [
    '"id" TEXT NOT NULL',
    '"runId" TEXT NOT NULL',
    '"roleId" TEXT NOT NULL',
    '"confirmedFactKeysJson" JSONB NOT NULL',
    '"believedFactKeysJson" JSONB NOT NULL',
    '"activeGoalsJson" JSONB NOT NULL',
    '"knowledgeBoundaryJson" JSONB NOT NULL',
    '"lastNodeId" TEXT',
    '"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    '"updatedAt" TIMESTAMP(3) NOT NULL'
  ],
  StoryThread: [
    '"id" TEXT NOT NULL',
    '"runId" TEXT NOT NULL',
    '"threadKey" TEXT NOT NULL',
    '"title" TEXT NOT NULL',
    '"status" TEXT NOT NULL DEFAULT \'active\'',
    '"tension" INTEGER NOT NULL DEFAULT 1',
    '"deadlineNodeIndex" INTEGER',
    '"sourceFactKeysJson" JSONB NOT NULL',
    '"stateJson" JSONB NOT NULL',
    '"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    '"updatedAt" TIMESTAMP(3) NOT NULL'
  ],
  SceneSnapshot: [
    '"id" TEXT NOT NULL',
    '"runId" TEXT NOT NULL',
    '"nodeId" TEXT',
    '"roleId" TEXT',
    '"scope" TEXT NOT NULL DEFAULT \'public\'',
    '"stateJson" JSONB NOT NULL',
    '"knownFactKeysJson" JSONB NOT NULL',
    '"activeThreadKeysJson" JSONB NOT NULL',
    '"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP'
  ],
  NarrativeEntry: [
    '"id" TEXT NOT NULL',
    '"runId" TEXT NOT NULL',
    '"nodeId" TEXT',
    '"resolutionId" TEXT',
    '"roleId" TEXT',
    '"entryType" TEXT NOT NULL',
    '"visibility" TEXT NOT NULL DEFAULT \'public\'',
    '"content" TEXT NOT NULL',
    '"factKeysJson" JSONB NOT NULL',
    '"threadKeysJson" JSONB NOT NULL',
    '"sourceEventIdsJson" JSONB NOT NULL',
    '"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP'
  ],
  StoryTaskOutbox: [
    '"id" TEXT NOT NULL',
    '"runId" TEXT NOT NULL',
    '"nodeId" TEXT NOT NULL',
    '"taskType" TEXT NOT NULL',
    '"status" TEXT NOT NULL DEFAULT \'pending\'',
    '"attempt" INTEGER NOT NULL DEFAULT 0',
    '"maxAttempts" INTEGER NOT NULL DEFAULT 3',
    '"nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    '"leaseOwner" TEXT',
    '"leaseExpiresAt" TIMESTAMP(3)',
    '"startedAt" TIMESTAMP(3)',
    '"completedAt" TIMESTAMP(3)',
    '"resultJson" JSONB',
    '"lastError" TEXT',
    '"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    '"updatedAt" TIMESTAMP(3) NOT NULL'
  ]
};

const expectedIndexes = {
  CanonFact: [
    'CREATE UNIQUE INDEX "CanonFact_runId_factKey_key" ON "CanonFact"("runId", "factKey");',
    'CREATE INDEX "CanonFact_runId_visibility_status_idx" ON "CanonFact"("runId", "visibility", "status");',
    'CREATE INDEX "CanonFact_sourceNodeId_idx" ON "CanonFact"("sourceNodeId");'
  ],
  CharacterMind: [
    'CREATE UNIQUE INDEX "CharacterMind_roleId_key" ON "CharacterMind"("roleId");',
    'CREATE INDEX "CharacterMind_runId_updatedAt_idx" ON "CharacterMind"("runId", "updatedAt");',
    'CREATE INDEX "CharacterMind_roleId_idx" ON "CharacterMind"("roleId");'
  ],
  StoryThread: [
    'CREATE UNIQUE INDEX "StoryThread_runId_threadKey_key" ON "StoryThread"("runId", "threadKey");',
    'CREATE INDEX "StoryThread_runId_status_idx" ON "StoryThread"("runId", "status");'
  ],
  SceneSnapshot: [
    'CREATE INDEX "SceneSnapshot_runId_scope_createdAt_idx" ON "SceneSnapshot"("runId", "scope", "createdAt");',
    'CREATE INDEX "SceneSnapshot_nodeId_idx" ON "SceneSnapshot"("nodeId");',
    'CREATE INDEX "SceneSnapshot_roleId_idx" ON "SceneSnapshot"("roleId");'
  ],
  NarrativeEntry: [
    'CREATE INDEX "NarrativeEntry_runId_visibility_createdAt_idx" ON "NarrativeEntry"("runId", "visibility", "createdAt");',
    'CREATE INDEX "NarrativeEntry_nodeId_idx" ON "NarrativeEntry"("nodeId");',
    'CREATE INDEX "NarrativeEntry_roleId_idx" ON "NarrativeEntry"("roleId");'
  ],
  StoryTaskOutbox: [
    'CREATE UNIQUE INDEX "StoryTaskOutbox_nodeId_key" ON "StoryTaskOutbox"("nodeId");',
    'CREATE INDEX "StoryTaskOutbox_status_nextRetryAt_idx" ON "StoryTaskOutbox"("status", "nextRetryAt");',
    'CREATE INDEX "StoryTaskOutbox_runId_createdAt_idx" ON "StoryTaskOutbox"("runId", "createdAt");',
    'CREATE INDEX "StoryTaskOutbox_leaseExpiresAt_idx" ON "StoryTaskOutbox"("leaseExpiresAt");'
  ]
};

const expectedForeignKeys = {
  CanonFact: [
    'ALTER TABLE "CanonFact" ADD CONSTRAINT "CanonFact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
    'ALTER TABLE "CanonFact" ADD CONSTRAINT "CanonFact_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "SceneNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;'
  ],
  CharacterMind: [
    'ALTER TABLE "CharacterMind" ADD CONSTRAINT "CharacterMind_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
    'ALTER TABLE "CharacterMind" ADD CONSTRAINT "CharacterMind_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;'
  ],
  StoryThread: [
    'ALTER TABLE "StoryThread" ADD CONSTRAINT "StoryThread_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;'
  ],
  SceneSnapshot: [
    'ALTER TABLE "SceneSnapshot" ADD CONSTRAINT "SceneSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
    'ALTER TABLE "SceneSnapshot" ADD CONSTRAINT "SceneSnapshot_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SceneNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;',
    'ALTER TABLE "SceneSnapshot" ADD CONSTRAINT "SceneSnapshot_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;'
  ],
  NarrativeEntry: [
    'ALTER TABLE "NarrativeEntry" ADD CONSTRAINT "NarrativeEntry_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
    'ALTER TABLE "NarrativeEntry" ADD CONSTRAINT "NarrativeEntry_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SceneNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;',
    'ALTER TABLE "NarrativeEntry" ADD CONSTRAINT "NarrativeEntry_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "DirectorResolution"("id") ON DELETE SET NULL ON UPDATE CASCADE;',
    'ALTER TABLE "NarrativeEntry" ADD CONSTRAINT "NarrativeEntry_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;'
  ],
  StoryTaskOutbox: [
    'ALTER TABLE "StoryTaskOutbox" ADD CONSTRAINT "StoryTaskOutbox_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
    'ALTER TABLE "StoryTaskOutbox" ADD CONSTRAINT "StoryTaskOutbox_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SceneNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;'
  ]
};

const expectedFragments = {
  CanonFact: [
    '"sourceNodeId" TEXT',
    '"sourceEventIdsJson" JSONB NOT NULL',
    '"sourceActionIdsJson" JSONB NOT NULL',
    '"knownByRoleIdsJson" JSONB NOT NULL',
    'CREATE UNIQUE INDEX "CanonFact_runId_factKey_key"',
    'CREATE INDEX "CanonFact_runId_visibility_status_idx"',
    'CONSTRAINT "CanonFact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE',
    'CONSTRAINT "CanonFact_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "SceneNode"("id") ON DELETE SET NULL ON UPDATE CASCADE'
  ],
  CharacterMind: [
    '"roleId" TEXT NOT NULL',
    '"confirmedFactKeysJson" JSONB NOT NULL',
    '"believedFactKeysJson" JSONB NOT NULL',
    '"knowledgeBoundaryJson" JSONB NOT NULL',
    'CREATE UNIQUE INDEX "CharacterMind_roleId_key"',
    'CONSTRAINT "CharacterMind_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE',
    'CONSTRAINT "CharacterMind_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE'
  ],
  StoryThread: [
    '"threadKey" TEXT NOT NULL',
    '"tension" INTEGER NOT NULL DEFAULT 1',
    '"sourceFactKeysJson" JSONB NOT NULL',
    'CREATE UNIQUE INDEX "StoryThread_runId_threadKey_key"',
    'CONSTRAINT "StoryThread_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE'
  ],
  SceneSnapshot: [
    '"nodeId" TEXT',
    '"roleId" TEXT',
    '"scope" TEXT NOT NULL DEFAULT \'public\'',
    '"activeThreadKeysJson" JSONB NOT NULL',
    'CREATE INDEX "SceneSnapshot_runId_scope_createdAt_idx"',
    'CONSTRAINT "SceneSnapshot_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SceneNode"("id") ON DELETE SET NULL ON UPDATE CASCADE',
    'CONSTRAINT "SceneSnapshot_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE SET NULL ON UPDATE CASCADE'
  ],
  NarrativeEntry: [
    '"resolutionId" TEXT',
    '"entryType" TEXT NOT NULL',
    '"sourceEventIdsJson" JSONB NOT NULL',
    'CREATE INDEX "NarrativeEntry_runId_visibility_createdAt_idx"',
    'CONSTRAINT "NarrativeEntry_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "DirectorResolution"("id") ON DELETE SET NULL ON UPDATE CASCADE',
    'CONSTRAINT "NarrativeEntry_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE SET NULL ON UPDATE CASCADE'
  ],
  StoryTaskOutbox: [
    '"nodeId" TEXT NOT NULL',
    '"status" TEXT NOT NULL DEFAULT \'pending\'',
    '"attempt" INTEGER NOT NULL DEFAULT 0',
    '"maxAttempts" INTEGER NOT NULL DEFAULT 3',
    '"nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    'CREATE UNIQUE INDEX "StoryTaskOutbox_nodeId_key"',
    'CREATE INDEX "StoryTaskOutbox_status_nextRetryAt_idx"',
    'CONSTRAINT "StoryTaskOutbox_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SceneNode"("id") ON DELETE CASCADE ON UPDATE CASCADE'
  ]
};

const schema = await readFile(schemaPath, "utf8");
const targetSql = await readFile(targetPath, "utf8");
const migrationDirectories = (await readdir(migrationsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

assert.ok(migrationDirectories.includes(targetMigration), "foundation migration must remain in the immutable migration chain");
assert.ok(
  migrationDirectories.indexOf(targetMigration) < migrationDirectories.indexOf(firstExpandMigration),
  "foundation migration must run before continuous-strategy expand"
);
assert.doesNotMatch(targetSql, /\b(?:DROP|TRUNCATE)\b/i, "foundation migration must be additive");
assert.doesNotMatch(targetSql, /IF\s+(?:NOT\s+)?EXISTS/i, "foundation migration must fail closed on unexpected pre-existing objects");

const allMigrationSql = (await Promise.all(migrationDirectories.map(async (directory) => {
  const sqlPath = path.join(migrationsRoot, directory, "migration.sql");
  return readFile(sqlPath, "utf8");
}))).join("\n");

const results = [];
for (const model of requiredModels) {
  assert.match(schema, new RegExp(`^model\\s+${model}\\s*\\{`, "m"), `${model} must exist in prisma/schema.prisma`);
  const creates = [...allMigrationSql.matchAll(new RegExp(`CREATE TABLE "${model}"`, "g"))];
  assert.equal(creates.length, 1, `${model} must be created by exactly one migration`);
  assert.match(targetSql, new RegExp(`CREATE TABLE "${model}"`), `${model} must be created by the foundation migration`);
  const tableMatch = targetSql.match(new RegExp(`CREATE TABLE "${model}" \\(([\\s\\S]*?)\\n\\);`));
  assert.ok(tableMatch, `${model} table body must be parseable`);
  const actualColumns = tableMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/,$/, ""))
    .filter((line) => line.startsWith('"'));
  assert.deepEqual(actualColumns, expectedColumns[model], `${model} columns/defaults/nullability drifted from the schema contract`);
  for (const fragment of expectedFragments[model]) {
    assert.ok(targetSql.includes(fragment), `${model} is missing SQL contract fragment: ${fragment}`);
  }
  for (const indexSql of expectedIndexes[model]) {
    assert.ok(targetSql.includes(indexSql), `${model} is missing index contract: ${indexSql}`);
  }
  for (const foreignKeySql of expectedForeignKeys[model]) {
    assert.ok(targetSql.includes(foreignKeySql), `${model} is missing foreign-key contract: ${foreignKeySql}`);
  }
  results.push({
    model,
    createCount: creates.length,
    columnsChecked: actualColumns.length,
    indexesChecked: expectedIndexes[model].length,
    foreignKeysChecked: expectedForeignKeys[model].length,
    fragmentsChecked: expectedFragments[model].length
  });
}

console.log(JSON.stringify({
  status: "PASS",
  migration: targetMigration,
  schema: path.relative(root, schemaPath),
  models: results,
  checks: {
    additiveOnly: true,
    failClosedOnPreexistingObjects: true,
    precedesContinuousStrategyExpand: true
  }
}, null, 2));
