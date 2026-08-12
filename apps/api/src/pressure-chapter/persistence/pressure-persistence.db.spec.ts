import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertSafePressureDatabaseScope } from "./database-contract";

const enabled = process.env.PRESSURE_CHAPTER_ALLOW_NON_PRODUCTION_DB_TESTS === "1";

const EXACT_PRESSURE_TABLES = [
  "PressureChapterRuntime",
  "PressureChapterSettlement",
  "PressureDecisionAction",
  "PressureFinaleDecision",
  "PressureGenesisCommit",
  "PressureLegacyTerminalCommit",
  "PressureNarrativeProjection",
  "PressureOutboxTask",
  "PressureReplayCommandReceipt",
  "PressureRunLifecycle",
  "PressureRunRouteSnapshot",
  "PressureSeatControlSnapshot",
] as const;

const RETIRED_PRESSURE_TABLES = [
  "PressureLobbyCommandReceipt",
  "PressureGenesisSnapshot",
  "PressureDecisionPointInstance",
  "PressureDecisionActionRevision",
  "PressureChapterWorkingLedgerEntry",
  "PressureResourceReservation",
  "PressureBeatResolution",
  "PressureFrozenChapterBundle",
  "PressureSeatArcSnapshot",
  "PressureFinaleSeatOutcome",
  "PressureFinaleShadowComparison",
  "PressureNarrativeArtifact",
  "PressureResultArtifact",
  "PressureSeatControlFrozenPolicy",
  "PressureSeatControlSeatSnapshot",
  "PressureSeatControlEvent",
  "PressureSeatControlCommandReceipt",
  "PressureSeatPresenceRecord",
  "PressureSeatDefaultDirective",
  "PressureSeatDecisionProof",
  "PressureSeatPrivateProjection",
] as const;

const REQUIRED_COLUMNS: Readonly<Record<(typeof EXACT_PRESSURE_TABLES)[number], readonly string[]>> = {
  PressureChapterRuntime: [
    "id", "runId", "chapterSequence", "workingRevision", "workingStateJson",
    "decisionStateJson", "ledgerProjectionJson", "lockVersion", "routeHash",
  ],
  PressureChapterSettlement: [
    "id", "runId", "chapterRuntimeId", "chapterSequence", "committedWorldSequence",
    "frozenBundleHash", "commitManifestJson", "commitManifestHash", "commitHash",
  ],
  PressureDecisionAction: [
    "id", "runId", "chapterRuntimeId", "decisionPointId", "seatId", "controlEpoch",
    "expectedWorkingRevision", "currentRevision", "authorityEventHash", "payloadJson",
  ],
  PressureFinaleDecision: [
    "id", "runId", "routeHash", "frozenChapterBundleHashesJson", "decisionJson",
    "commitManifestJson", "semanticOutcomeHash", "commitHash",
  ],
  PressureGenesisCommit: [
    "id", "runId", "genesisHash", "commitManifestJson", "commitManifestHash", "commitHash",
  ],
  PressureLegacyTerminalCommit: [
    "id", "runId", "sourceCommitHash", "commitManifestJson", "commitManifestHash", "commitHash",
  ],
  PressureNarrativeProjection: [
    "id", "runId", "sourceCommitHash", "audienceKind", "audienceKey", "artifactJson",
    "artifactContentHash", "leaseVersion",
  ],
  PressureOutboxTask: [
    "id", "runId", "dedupeKey", "sourceCommitHash", "payloadJson", "payloadHash",
    "leaseVersion", "checkpoint",
  ],
  PressureReplayCommandReceipt: [
    "id", "sourceRunId", "idempotencyKey", "receiptJson", "receiptHash",
  ],
  PressureRunLifecycle: [
    "runId", "participantMode", "lifecycle", "routeFreeze", "stateHash", "version",
  ],
  PressureRunRouteSnapshot: [
    "id", "runId", "routeHash", "routeJson", "participantMode", "runSeed",
  ],
  PressureSeatControlSnapshot: [
    "id", "runId", "stateRevision", "timelineHeadHash", "stateHash", "snapshotJson", "version",
  ],
};

const REQUIRED_UNIQUE_INDEXES = [
  "pc_action_authority_event_key",
  "pc_action_point_seat_ordinal_key",
  "pc_action_run_idempotency_key",
  "pc_chapter_run_id_key",
  "pc_chapter_run_sequence_key",
  "pc_finale_run_key",
  "pc_genesis_commit_run_key",
  "pc_legacy_source_commit_key",
  "pc_narrative_projection_logical_key",
  "pc_outbox_dedupe_key",
  "pc_replay_source_idempotency_key",
  "pc_route_hash_key",
  "pc_route_run_key",
  "pc_seat_snapshot_hash_key",
  "pc_seat_snapshot_run_key",
  "pc_settlement_bundle_hash_key",
  "pc_settlement_chapter_key",
  "pc_settlement_run_sequence_key",
] as const;

test("DB runner fails closed before creating Prisma when scope is absent or ambiguous", () => {
  assert.throws(() => assertSafePressureDatabaseScope({
    databaseUrl: undefined,
    explicitScope: "non-production",
  }), /DATABASE_URL_MISSING/);
  assert.throws(() => assertSafePressureDatabaseScope({
    databaseUrl: "postgresql://localhost/aistory_test",
    explicitScope: undefined,
  }), /MUST_BE_NON_PRODUCTION/);
  assert.throws(() => assertSafePressureDatabaseScope({
    databaseUrl: "postgresql://prod.example.com/aistory",
    explicitScope: "non-production",
  }), /DATABASE_NOT_VISIBLY_NON_PRODUCTION/);
  const projectRef = "pressure-acceptance-ref";
  const allowedSupabaseProjectSha256 = createHash("sha256").update(projectRef).digest("hex");
  assert.equal(assertSafePressureDatabaseScope({
    databaseUrl: `postgresql://postgres.${projectRef}:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`,
    explicitScope: "NON_PRODUCTION",
    allowedSupabaseProjectSha256,
  }).supabaseProjectFingerprint, allowedSupabaseProjectSha256);
  assert.throws(() => assertSafePressureDatabaseScope({
    databaseUrl: `postgresql://postgres.${projectRef}:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`,
    explicitScope: "non-production",
    allowedSupabaseProjectSha256: "0".repeat(64),
  }), /SUPABASE_PROJECT_NOT_ALLOWLISTED/);
});

test("non-production Pressure schema readback and Serializable/CAS contract", {
  skip: !enabled,
}, async () => {
  const scope = assertSafePressureDatabaseScope({
    databaseUrl: process.env.DATABASE_URL,
    explicitScope: process.env.PRESSURE_CHAPTER_DB_SCOPE,
    allowedSupabaseProjectSha256: process.env.PRESSURE_CHAPTER_ALLOWED_SUPABASE_PROJECT_SHA256,
  });
  // Construction is intentionally after the guard above. A runner without a
  // safe URL cannot open a socket or spawn a migration child process.
  const prisma = new PrismaClient({
    datasources: { db: { url: scope.databaseUrl } },
  });
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name LIKE 'Pressure%'
      ORDER BY table_name
    `);
    assert.deepEqual(
      rows.map((row) => row.table_name),
      [...EXACT_PRESSURE_TABLES],
      "non-production database must expose exactly the twelve Pressure MVP tables",
    );

    const columnRows = await prisma.$queryRawUnsafe<Array<{
      table_name: string;
      column_name: string;
    }>>(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name LIKE 'Pressure%'
    `);
    const columnsByTable = new Map<string, Set<string>>();
    for (const row of columnRows) {
      const columns = columnsByTable.get(row.table_name) ?? new Set<string>();
      columns.add(row.column_name);
      columnsByTable.set(row.table_name, columns);
    }
    for (const [tableName, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
      const actual = columnsByTable.get(tableName) ?? new Set<string>();
      for (const columnName of requiredColumns) {
        assert.ok(actual.has(columnName), `${tableName}.${columnName} must exist`);
      }
    }
    for (const retiredTable of RETIRED_PRESSURE_TABLES) {
      assert.equal(columnsByTable.has(retiredTable), false, `${retiredTable} must remain retired`);
    }

    const primaryKeys = await prisma.$queryRawUnsafe<Array<{
      table_name: string;
      column_name: string;
    }>>(`
      SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON kcu.constraint_catalog = tc.constraint_catalog
       AND kcu.constraint_schema = tc.constraint_schema
       AND kcu.constraint_name = tc.constraint_name
      WHERE tc.constraint_schema = current_schema()
        AND tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_name LIKE 'Pressure%'
      ORDER BY tc.table_name, kcu.ordinal_position
    `);
    assert.equal(primaryKeys.length, EXACT_PRESSURE_TABLES.length);
    assert.deepEqual(
      primaryKeys.map((row) => row.table_name),
      [...EXACT_PRESSURE_TABLES],
      "every Pressure MVP table must have exactly one single-column primary key",
    );
    assert.ok(primaryKeys.every((row) => row.column_name === "id" || row.column_name === "runId"));

    const uniqueIndexes = await prisma.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename LIKE 'Pressure%'
        AND indexdef LIKE 'CREATE UNIQUE INDEX%'
      ORDER BY indexname
    `);
    const actualUniqueIndexes = new Set(uniqueIndexes.map((row) => row.indexname));
    for (const indexName of REQUIRED_UNIQUE_INDEXES) {
      assert.ok(actualUniqueIndexes.has(indexName), `${indexName} must exist and be UNIQUE`);
    }
    assert.match(
      uniqueIndexes.find((row) => row.indexname === "pc_action_point_seat_ordinal_key")?.indexdef ?? "",
      /\("runId", "decisionPointId", "seatId", "actionOrdinal"\)$/u,
      "decision action ordinals must only be unique within the same run",
    );

    await prisma.$transaction(async (tx) => {
      const isolation = await tx.$queryRawUnsafe<Array<{ level: string }>>(
        "SELECT current_setting('transaction_isolation') AS level",
      );
      assert.equal(isolation[0]?.level, "serializable");
      await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE pressure_w1_contract_probe (
          id TEXT PRIMARY KEY,
          revision INTEGER NOT NULL,
          fingerprint TEXT NOT NULL UNIQUE
        ) ON COMMIT DROP
      `);
      await tx.$executeRawUnsafe(
        "INSERT INTO pressure_w1_contract_probe(id, revision, fingerprint) VALUES ($1, 0, $2)",
        "probe",
        "fingerprint-a",
      );
      const advanced = await tx.$executeRawUnsafe(
        "UPDATE pressure_w1_contract_probe SET revision = 1 WHERE id = $1 AND revision = 0",
        "probe",
      );
      const stale = await tx.$executeRawUnsafe(
        "UPDATE pressure_w1_contract_probe SET revision = 2 WHERE id = $1 AND revision = 0",
        "probe",
      );
      await tx.$executeRawUnsafe(`
        DO $contract$
        BEGIN
          BEGIN
            INSERT INTO pressure_w1_contract_probe(id, revision, fingerprint)
            VALUES ('duplicate-fingerprint', 0, 'fingerprint-a');
            RAISE EXCEPTION 'unique index did not reject duplicate fingerprint';
          EXCEPTION WHEN unique_violation THEN
            NULL;
          END;
        END
        $contract$
      `);
      const probeRows = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
        "SELECT COUNT(*) AS count FROM pressure_w1_contract_probe",
      );
      assert.equal(advanced, 1);
      assert.equal(stale, 0, "stale CAS must not mutate a row");
      assert.equal(probeRows[0]?.count, 1n, "unique-key rejection must leave only the original probe");
    }, { isolationLevel: "Serializable" });

    const cleanup = await prisma.$queryRawUnsafe<Array<{ dropped: boolean }>>(
      "SELECT to_regclass('pg_temp.pressure_w1_contract_probe') IS NULL AS dropped",
    );
    assert.equal(cleanup[0]?.dropped, true, "transaction probe must be dropped on commit");
  } finally {
    await prisma.$disconnect();
  }
});
