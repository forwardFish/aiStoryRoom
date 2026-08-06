import process from "node:process";

const CONFIRMATION = "DELETE_ALL_GAME_RUNS";
const GAME_ROOT_TABLE = "StoryRun";
const ISOLATED_TEST_SCHEMA_PATTERNS = Object.freeze([
  /^cs_(?:accept|fault)/,
  /^mw_i18n_/,
  /^openovel_mp_/,
]);

// These tables contain identities, authentication, balances, purchases,
// referrals, or product configuration. The cleanup must abort if a future
// schema change makes TRUNCATE StoryRun CASCADE reach any of them.
const PROTECTED_TABLES = Object.freeze([
  "User",
  "AuthOneTimeToken",
  "AuthIdentity",
  "AuthLoginChallenge",
  "WorldTemplate",
  "CreditWallet",
  "CreditGrant",
  "CreditLedger",
  "CreditSpendAllocation",
  "CreditCharge",
  "CreditChargeAllocation",
  "RunCreditAllowance",
  "SponsorshipRequest",
  "CreemPurchase",
  "RefundRequest",
  "PaymentWebhookEvent",
  "ReferralCode",
  "Referral",
  "ReferralShareEvent",
]);

const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const confirmation = process.argv
  .slice(2)
  .find((arg) => arg.startsWith("--confirm="))
  ?.slice("--confirm=".length);

if (execute && confirmation !== CONFIRMATION) {
  fail(`Execution requires --confirm=${CONFIRMATION}`);
}
if (process.env.NODE_ENV === "production") {
  fail("Refusing to clear game data while NODE_ENV=production.");
}

const databaseUrl = String(
  process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || "",
).trim();
if (!databaseUrl) fail("DATABASE_URL or SUPABASE_DATABASE_URL is required.");

let databaseHost;
try {
  databaseHost = new URL(databaseUrl).hostname.toLowerCase();
} catch {
  fail("The configured database URL is invalid.");
}
if (!databaseHost.includes("supabase")) {
  fail("Refusing to run: the configured database is not a Supabase host.");
}

// Prisma reads DATABASE_URL. Prefer the explicitly supplied Supabase URL when
// both variables are present, matching the API's shared-test database policy.
process.env.DATABASE_URL = databaseUrl;

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

try {
  const schema = await currentSchema(prisma);
  if (schema !== "public") {
    fail(`Refusing to run: expected the protected product schema public, received ${schema}.`);
  }
  const cascadeTables = await discoverTruncateCascade(prisma, schema);
  if (!cascadeTables.includes(GAME_ROOT_TABLE)) {
    fail(`Game root table ${GAME_ROOT_TABLE} was not found in schema ${schema}.`);
  }

  const protectedOverlap = cascadeTables.filter((table) =>
    PROTECTED_TABLES.includes(table),
  );
  if (protectedOverlap.length) {
    fail(
      `Safety check failed: game cleanup would reach protected tables: ${protectedOverlap.join(", ")}`,
    );
  }

  const isolatedTestSchemas = await discoverIsolatedTestSchemas(prisma);
  const [gameBefore, protectedBefore, sizeBefore, isolatedSchemaStatsBefore] = await Promise.all([
    tableCounts(prisma, cascadeTables),
    tableCounts(prisma, PROTECTED_TABLES),
    databaseSizes(prisma, schema),
    isolatedSchemaStats(prisma, isolatedTestSchemas),
  ]);

  const preview = {
    mode: execute ? "EXECUTE" : "DRY_RUN",
    provider: "supabase",
    schema,
    gameRoot: GAME_ROOT_TABLE,
    cascadeTableCount: cascadeTables.length,
    gameRowsBefore: sumCounts(gameBefore),
    protectedRowsBefore: sumCounts(protectedBefore),
    databaseBytesBefore: sizeBefore.databaseBytes,
    schemaBytesBefore: sizeBefore.schemaBytes,
    isolatedTestSchemaCount: isolatedTestSchemas.length,
    isolatedTestSchemaBytesBefore: sumSchemaBytes(isolatedSchemaStatsBefore),
    isolatedTestSchemas: isolatedSchemaStatsBefore,
    cascadeTables: gameBefore,
  };

  if (!execute) {
    console.log(JSON.stringify(preview, null, 2));
    console.log(
      `Dry run only. Re-run with --execute --confirm=${CONFIRMATION} to delete game data.`,
    );
    process.exitCode = 0;
  } else {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          "SELECT pg_advisory_xact_lock(hashtext('aiStoryRoom.clearSupabaseGameData'))",
        );
        await tx.$executeRawUnsafe(`TRUNCATE TABLE ${quoteIdentifier(GAME_ROOT_TABLE)} CASCADE`);
        for (const testSchema of isolatedTestSchemas) {
          await tx.$executeRawUnsafe(`DROP SCHEMA ${quoteIdentifier(testSchema)} CASCADE`);
        }

        const gameInsideTransaction = await tableCounts(tx, cascadeTables);
        const remaining = Object.entries(gameInsideTransaction).filter(
          ([, count]) => count !== 0,
        );
        if (remaining.length) {
          throw new Error(
            `Game cleanup left rows inside the transaction: ${JSON.stringify(remaining)}`,
          );
        }

        const protectedInsideTransaction = await tableCounts(tx, PROTECTED_TABLES);
        assertCountsUnchanged(protectedBefore, protectedInsideTransaction);
      },
      { timeout: 120_000 },
    );

    const [gameAfter, protectedAfter, sizeAfter] = await Promise.all([
      tableCounts(prisma, cascadeTables),
      tableCounts(prisma, PROTECTED_TABLES),
      databaseSizes(prisma, schema),
    ]);
    assertAllZero(gameAfter);
    assertCountsUnchanged(protectedBefore, protectedAfter);
    const remainingIsolatedSchemas = await discoverIsolatedTestSchemas(prisma);
    if (remainingIsolatedSchemas.length) {
      throw new Error(
        `Isolated test schemas still exist: ${remainingIsolatedSchemas.join(", ")}`,
      );
    }

    console.log(
      JSON.stringify(
        {
          ...preview,
          status: "GAME_DATA_CLEARED",
          gameRowsAfter: sumCounts(gameAfter),
          protectedRowsAfter: sumCounts(protectedAfter),
          databaseBytesAfter: sizeAfter.databaseBytes,
          schemaBytesAfter: sizeAfter.schemaBytes,
          isolatedTestSchemasDropped: isolatedTestSchemas,
          protectedTablesUnchanged: true,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await prisma.$disconnect();
}

async function currentSchema(client) {
  const rows = await client.$queryRawUnsafe(
    "SELECT current_schema() AS schema_name",
  );
  return String(rows[0]?.schema_name || "");
}

async function discoverTruncateCascade(client, schema) {
  const rows = await client.$queryRawUnsafe(
    `WITH RECURSIVE cascade_tables AS (
       SELECT c.oid, c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = $2
       UNION
       SELECT child.oid, child.relname
       FROM cascade_tables parent_table
       JOIN pg_constraint fk
         ON fk.confrelid = parent_table.oid
        AND fk.contype = chr(102)
       JOIN pg_class child ON child.oid = fk.conrelid
       JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
       WHERE child_namespace.nspname = $1
     )
     SELECT DISTINCT relname AS table_name
     FROM cascade_tables
     ORDER BY relname`,
    schema,
    GAME_ROOT_TABLE,
  );
  return rows.map((row) => String(row.table_name));
}

async function discoverIsolatedTestSchemas(client) {
  const rows = await client.$queryRawUnsafe(
    "SELECT nspname AS schema_name FROM pg_namespace ORDER BY nspname",
  );
  return rows
    .map((row) => String(row.schema_name))
    .filter((schema) =>
      ISOLATED_TEST_SCHEMA_PATTERNS.some((pattern) => pattern.test(schema)),
    );
}

async function isolatedSchemaStats(client, schemas) {
  if (!schemas.length) return [];
  const rows = await client.$queryRawUnsafe(
    `SELECT
       schemaname AS schema_name,
       COALESCE(SUM(pg_total_relation_size(relid)), 0)::bigint::text AS total_bytes,
       COALESCE(SUM(n_live_tup), 0)::bigint::text AS estimated_rows
     FROM pg_stat_user_tables
     WHERE schemaname = ANY($1::text[])
     GROUP BY schemaname
     ORDER BY schemaname`,
    schemas,
  );
  const bySchema = new Map(
    rows.map((row) => [
      String(row.schema_name),
      {
        schema: String(row.schema_name),
        totalBytes: Number(row.total_bytes || 0),
        estimatedRows: Number(row.estimated_rows || 0),
      },
    ]),
  );
  return schemas.map(
    (schema) => bySchema.get(schema) || { schema, totalBytes: 0, estimatedRows: 0 },
  );
}

async function tableCounts(client, tables) {
  const counts = {};
  for (const table of tables) {
    const rows = await client.$queryRawUnsafe(
      `SELECT COUNT(*)::bigint::text AS count FROM ${quoteIdentifier(table)}`,
    );
    counts[table] = Number(rows[0]?.count || 0);
  }
  return counts;
}

async function databaseSizes(client, schema) {
  const rows = await client.$queryRawUnsafe(
    `SELECT
       pg_database_size(current_database())::bigint::text AS database_bytes,
       COALESCE(SUM(pg_total_relation_size(c.oid)), 0)::bigint::text AS schema_bytes
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1`,
    schema,
  );
  return {
    databaseBytes: Number(rows[0]?.database_bytes || 0),
    schemaBytes: Number(rows[0]?.schema_bytes || 0),
  };
}

function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function sumCounts(counts) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function sumSchemaBytes(schemas) {
  return schemas.reduce((sum, schema) => sum + schema.totalBytes, 0);
}

function assertAllZero(counts) {
  const remaining = Object.entries(counts).filter(([, count]) => count !== 0);
  if (remaining.length) {
    throw new Error(`Game tables still contain rows: ${JSON.stringify(remaining)}`);
  }
}

function assertCountsUnchanged(before, after) {
  const changed = Object.keys(before)
    .filter((table) => before[table] !== after[table])
    .map((table) => ({ table, before: before[table], after: after[table] }));
  if (changed.length) {
    throw new Error(`Protected table counts changed: ${JSON.stringify(changed)}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
