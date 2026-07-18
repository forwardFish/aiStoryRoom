import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const migrationsRoot = path.join(root, "prisma", "migrations");
const schemaPath = path.join(root, "prisma", "schema.prisma");
const migrationNames = {
  foundation: "20260716120000_foundation_current_schema",
  expand: "20260716130000_continuous_strategy_p0_expand",
  backfill: "20260716131000_continuous_strategy_p0_backfill",
  contract: "20260716132000_continuous_strategy_p0_contract",
  taskContract: "20260716133000_continuous_strategy_task_contract",
  roleControlReasons: "20260716134000_continuous_strategy_role_control_reasons",
  runtimeVocabulary: "20260716135000_continuous_strategy_runtime_vocabulary",
  presenceSessions: "20260716136000_continuous_strategy_presence_sessions",
  reclaimNextWindow: "20260716137000_continuous_strategy_reclaim_next_window",
  worldActorSeparation: "20260716138000_world_actor_not_player_role"
};

const readMigration = (name) => readFile(path.join(migrationsRoot, name, "migration.sql"), "utf8");
const [schema, expand, backfill, contract] = await Promise.all([
  readFile(schemaPath, "utf8"),
  readMigration(migrationNames.expand),
  readMigration(migrationNames.backfill),
  readMigration(migrationNames.contract)
]);

const directories = (await readdir(migrationsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const ordered = Object.values(migrationNames).map((name) => directories.indexOf(name));
assert.ok(ordered.every((index) => index >= 0), "all D02 migration phases must exist");
assert.deepEqual([...ordered].sort((a, b) => a - b), ordered, "migration phases must be foundation -> expand -> backfill -> contract");

const modelBlock = (model) => {
  const match = schema.match(new RegExp(`^model\\s+${model}\\s*\\{([\\s\\S]*?)^\\}`, "m"));
  assert.ok(match, `${model} must exist in prisma/schema.prisma`);
  return match[1];
};

const requiredModels = [
  "ActionWindow",
  "ActionWindowOpeningProjection",
  "ActionWindowParticipant",
  "RoleControl",
  "RoleControlTransition",
  "InteractionRequest",
  "RoleAsset",
  "RoleAssetMutation",
  "StoryEventCursor",
  "EventDeliveryCursor",
  "EventDelivery",
  "RoleAgentPolicy",
  "RoleAgentProjection",
  "RoleAgentDecision",
  "ResolutionWorkflow",
  "ResolutionCheckpoint"
];

for (const model of requiredModels) {
  modelBlock(model);
  assert.ok(expand.includes(`CREATE TABLE "${model}"`), `${model} must be created during expand`);
}

const schemaContracts = {
  CreemPurchase: [
    'orderDisplayCode    String              @unique @default(dbgenerated("(\'MW-\'::text || upper(\\"left\\"(replace((gen_random_uuid())::text, \'-\'::text, \'\'::text), 12)))"))'
  ],
  StoryRun: [
    'engineVersion      String         @default("legacy_v1")',
    'strategyVersion    String         @default("legacy_v1")'
  ],
  PlayerAction: [
    'roleId                     String?',
    'actionSlot                 String?  @default("MAIN")',
    'actorKind                  String?',
    'controlEpoch               Int?     @default(0)',
    'idempotencyKey             String?  @unique',
    'requestHash                String?',
    'sourceInteractionRequestId String?  @unique',
    '@@unique([nodeId, roleId, actionSlot])'
  ],
  StoryEvent: [
    'sequence                Int?',
    'dedupeKey               String?  @unique',
    'audienceType            String?',
    'sourceActionId          String?',
    '@@unique([runId, sequence])'
  ],
  SceneSnapshot: ['dedupeKey            String?  @unique'],
  NarrativeEntry: ['dedupeKey          String?  @unique'],
  StoryTaskOutbox: [
    'nodeId         String',
    'dedupeKey      String    @unique',
    'leaseVersion   Int       @default(0)',
    '@@index([runId, taskType, status])',
    '@@index([leaseOwner, leaseExpiresAt])'
  ],
  RoleAsset: [
    'ownerRoleId String?',
    'ownerActorKey String?',
    '@@index([ownerActorKey, status])'
  ]
};

for (const [model, fragments] of Object.entries(schemaContracts)) {
  const block = modelBlock(model);
  for (const fragment of fragments) {
    assert.ok(block.includes(fragment), `${model} schema contract is missing: ${fragment}`);
  }
}

const expandFragments = [
  'ALTER TABLE "StoryRun"',
  'ADD COLUMN "engineVersion" TEXT',
  'ADD COLUMN "actionSlot" TEXT',
  'ADD COLUMN "sourceInteractionRequestId" TEXT',
  'ADD COLUMN "sequence" INTEGER',
  'ADD COLUMN "leaseVersion" INTEGER NOT NULL DEFAULT 0',
  'CONSTRAINT "RoleAssetMutation_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "PlayerAction"("id") ON DELETE RESTRICT',
  'CONSTRAINT "RoleAssetMutation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "RoleAsset"("id") ON DELETE RESTRICT',
  'CONSTRAINT "ActionWindow_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE',
  'CONSTRAINT "EventDelivery_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "StoryRun"("id") ON DELETE CASCADE',
  'CONSTRAINT "PlayerAction_sourceInteractionRequestId_fkey" FOREIGN KEY ("sourceInteractionRequestId") REFERENCES "InteractionRequest"("id") ON DELETE SET NULL'
];

for (const fragment of expandFragments) {
  assert.ok(expand.includes(fragment), `expand migration is missing: ${fragment}`);
}

const backfillFragments = [
  '"engineVersion" = \'legacy_v1\'',
  '"strategyVersion" = \'legacy_v1\'',
  "CASE WHEN \"userId\" IS NOT NULL THEN 'HUMAN' ELSE 'LEGACY_AI' END",
  "'legacy:' || \"actionType\"",
  "'legacy:' || \"id\"",
  'sha256(',
  '"sealedAt" = COALESCE("sealedAt", "createdAt")',
  "'RESOLVE_LEGACY:' || \"nodeId\"",
  'row_number() OVER',
  'INSERT INTO "StoryEventCursor"',
  "'LEGACY_SCENE_SNAPSHOT:' || \"id\"",
  "'LEGACY_NARRATIVE_ENTRY:' || \"id\""
];

for (const fragment of backfillFragments) {
  assert.ok(backfill.includes(fragment), `backfill migration is missing: ${fragment}`);
}

assert.doesNotMatch(backfill, /INSERT\s+INTO\s+"RoleControl"/i, "legacy runs must not receive fabricated RoleControl rows");

const contractFragments = [
  'DROP CONSTRAINT IF EXISTS "StoryRun_engine_strategy_version_pair_check"',
  'DROP INDEX "PlayerAction_nodeId_roleId_key"',
  'CREATE UNIQUE INDEX "PlayerAction_nodeId_roleId_actionSlot_key"',
  'CREATE UNIQUE INDEX "PlayerAction_idempotencyKey_key"',
  'CREATE UNIQUE INDEX "StoryEvent_runId_sequence_key"',
  'CREATE UNIQUE INDEX "StoryTaskOutbox_dedupeKey_key"',
  'CREATE UNIQUE INDEX "InteractionRequest_nodeId_targetRoleId_open_key"',
  'WHERE "status" = \'OPEN\'',
  'CONSTRAINT "ActionWindow_status_check"',
  'CONSTRAINT "RoleControl_mode_check"',
  'CONSTRAINT "PlayerAction_actor_kind_check"',
  'CONSTRAINT "StoryEvent_audience_type_check"',
  'CONSTRAINT "RoleAgentDecision_status_check"',
  'CONSTRAINT "StoryTaskOutbox_task_type_check"',
  'CONSTRAINT "ResolutionCheckpoint_key_check"'
];

for (const fragment of contractFragments) {
  assert.ok(contract.includes(fragment), `contract migration is missing: ${fragment}`);
}

assert.doesNotMatch(
  contract,
  /ADD\s+CONSTRAINT\s+"StoryRun_engine_strategy_version_pair_check"/i,
  "engine and strategy vocabulary belongs to the game registry, not a database CHECK"
);
assert.doesNotMatch(
  contract,
  /sangtian_v1_1/,
  "the generic contract migration must not hardcode a game-specific strategy version"
);

assert.doesNotMatch(expand, /\b(?:DROP|TRUNCATE)\b/i, "expand must be additive");
assert.doesNotMatch(backfill, /\b(?:DROP|TRUNCATE)\b/i, "backfill must preserve legacy data");
assert.doesNotMatch(`${expand}\n${backfill}\n${contract}`, /prisma\s+(?:db\s+push|migrate\s+resolve)/i, "migrations must not bypass deploy history");

const legacyWriterFields = [
  "actorKind",
  "policyVersion",
  "provider",
  "modelName",
  "actionKey",
  "idempotencyKey",
  "requestHash",
  "sourceInteractionRequestId"
];
for (const field of legacyWriterFields) {
  assert.doesNotMatch(
    contract,
    new RegExp(`ALTER\\s+COLUMN\\s+"${field}"\\s+SET\\s+NOT\\s+NULL`, "i"),
    `${field} must stay nullable until the D02 application writer cut-over`
  );
}
const taskContract = await readMigration(migrationNames.taskContract);
assert.ok(taskContract.includes('DROP INDEX IF EXISTS "StoryTaskOutbox_nodeId_key"'), "task contract must remove node-level uniqueness");
assert.ok(taskContract.includes('ALTER COLUMN "dedupeKey" SET NOT NULL'), "task contract must require the authoritative dedupe key");

const worldActorSeparation = await readMigration(migrationNames.worldActorSeparation);
for (const fragment of [
  'ALTER TABLE "PlayerAction" ALTER COLUMN "roleId" DROP NOT NULL',
  'ALTER TABLE "RoleAsset" ALTER COLUMN "ownerRoleId" DROP NOT NULL',
  'ALTER TABLE "RoleAsset" ADD COLUMN "ownerActorKey" TEXT',
  'CREATE INDEX "RoleAsset_ownerActorKey_status_idx"'
]) {
  assert.ok(worldActorSeparation.includes(fragment), `worldActor migration is missing: ${fragment}`);
}
assert.doesNotMatch(worldActorSeparation, /\b(?:DELETE|TRUNCATE|DROP TABLE)\b/i, "worldActor separation must preserve historical role rows");

console.log(JSON.stringify({
  status: "PASS_STATIC",
  schema: path.relative(root, schemaPath),
  migrations: migrationNames,
  modelsChecked: requiredModels.length,
  checks: {
    orderedExpandBackfillContract: true,
    additiveExpand: true,
    deterministicLegacyBackfill: true,
    postgresChecksAndPartialUnique: true,
    foreignKeysAndDeletePolicies: true,
    legacyWriterCompatibilityPreserved: true,
    worldActorSeparatedFromPlayerRoles: true,
    noDatabaseConnectionRequired: true
  }
}, null, 2));
