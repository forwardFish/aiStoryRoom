import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const command = process.argv[2] || "";
const evidenceRoot = resolve(required("B0_EVIDENCE_ROOT"));
const environmentName = required("B0_ACCEPTANCE_ENVIRONMENT");
const databaseSecretName = required("B0_DATABASE_SECRET_NAME");
const baseUrl = command === "prepare" ? required("B0_FORMAL_DATABASE_URL") : required("DATABASE_URL");
const runId = required("GITHUB_RUN_ID");
const runAttempt = required("GITHUB_RUN_ATTEMPT");
const githubEnv = required("GITHUB_ENV");
const schema = process.env.B0_ACCEPTANCE_SCHEMA || createSchemaName(runId, runAttempt);

const parsedBase = validateFormalSupabaseUrl(baseUrl, environmentName);
const adminUrl = normalizedUrl(parsedBase, "public");
const runtimeUrl = normalizedUrl(parsedBase, schema);

await mkdir(evidenceRoot, { recursive: true });

if (command === "prepare") {
  await prepare();
} else if (command === "verify") {
  await verify();
} else if (command === "cleanup") {
  await cleanup();
} else if (command === "self-check") {
  process.stdout.write("B0_FORMAL_DB_ADMIN_SELF_CHECK_OK\n");
} else {
  throw new Error("Usage: b0-formal-db-admin.mjs {prepare|verify|cleanup|self-check}");
}

async function prepare() {
  mask(baseUrl, adminUrl.toString(), runtimeUrl.toString());
  await appendEnvironment({
    DATABASE_URL: runtimeUrl.toString(),
    MANY_WORLDS_DB_SCHEMA: schema,
    B0_ACCEPTANCE_SCHEMA: schema,
    B0_DATABASE_PROVENANCE: "supabase-cloud-nonproduction-random-schema",
    B0_FORMAL_DATABASE_URL: "",
  });

  const prisma = client(adminUrl.toString());
  try {
    await prisma.$connect();
    const before = await publicSchemaFingerprint(prisma);
    const existing = await schemaExists(prisma, schema);
    if (existing) throw new Error("Random acceptance schema already exists");
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${quotedIdentifier(schema)}`);
    if (!(await schemaExists(prisma, schema))) throw new Error("Random acceptance schema creation was not durable");

    const [server] = await prisma.$queryRawUnsafe(
      "SELECT current_database() AS database_name, current_setting('server_version') AS server_version",
    );
    await writeFile(resolve(evidenceRoot, "public-schema-before.txt"), before.text, "utf8");
    await writeJson(resolve(evidenceRoot, "database-provenance.json"), {
      schemaVersion: 1,
      status: "READY",
      provenance: "supabase-cloud-nonproduction-random-schema",
      acceptanceEnvironment: environmentName,
      databaseSecretName,
      managedHostSha256: sha256(parsedBase.hostname.toLowerCase()),
      managedHostSuffix: managedHostSuffix(parsedBase.hostname),
      connectionMode: parsedBase.hostname.includes("pooler.supabase.com") ? "SUPABASE_POOLER" : "SUPABASE_DIRECT",
      port: parsedBase.port ? Number(parsedBase.port) : 5432,
      databaseNameSha256: sha256(parsedBase.pathname.replace(/^\//, "")),
      serverVersion: String(server?.server_version || ""),
      currentDatabaseSha256: sha256(String(server?.database_name || "")),
      randomSchema: schema,
      randomSchemaSha256: sha256(schema),
      publicSchemaReadOnlyFingerprint: true,
      publicSchemaApplicationWrites: false,
      publicSchemaBeforeSha256: before.sha256,
      publicSchemaBeforeLineCount: before.lineCount,
      supabaseCloudUsed: true,
      selfHostedContainerUsed: false,
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function verify() {
  const prisma = client(adminUrl.toString());
  try {
    await prisma.$connect();
    const beforePath = resolve(evidenceRoot, "public-schema-before.txt");
    const beforeText = await readFile(beforePath, "utf8");
    const current = await publicSchemaFingerprint(prisma);
    if (current.text !== beforeText) throw new Error("Public schema changed while applying random-schema migrations");
    const rows = await prisma.$queryRawUnsafe(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = $1",
      schema,
    );
    const tableCount = Number(rows?.[0]?.count || 0);
    if (tableCount < 1) throw new Error("Random acceptance schema contains no migrated tables");
    await writeJson(resolve(evidenceRoot, "database-migration-readback.json"), {
      schemaVersion: 1,
      status: "PASS",
      randomSchema: schema,
      randomSchemaSha256: sha256(schema),
      migratedTableCount: tableCount,
      publicSchemaUnchangedAfterMigration: true,
      publicSchemaSha256: current.sha256,
      publicSchemaLineCount: current.lineCount,
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function cleanup() {
  const prisma = client(adminUrl.toString());
  let cleanupError = null;
  let beforeText = "";
  let after = { text: "", sha256: "", lineCount: 0 };
  try {
    await prisma.$connect();
    beforeText = await readFile(resolve(evidenceRoot, "public-schema-before.txt"), "utf8");
    after = await publicSchemaFingerprint(prisma);
    if (after.text !== beforeText) cleanupError = new Error("Public schema fingerprint changed during formal C8 acceptance");
  } catch (error) {
    cleanupError = error;
  } finally {
    try {
      if (await schemaExists(prisma, schema)) {
        await prisma.$executeRawUnsafe(`DROP SCHEMA ${quotedIdentifier(schema)} CASCADE`);
      }
      if (await schemaExists(prisma, schema)) throw new Error("Random acceptance schema was not dropped");
    } catch (error) {
      cleanupError ||= error;
    }
    await prisma.$disconnect().catch(() => undefined);
  }

  const publicUnchanged = Boolean(beforeText) && after.text === beforeText;
  await writeFile(resolve(evidenceRoot, "public-schema-after.txt"), after.text, "utf8");
  await writeJson(resolve(evidenceRoot, "schema-cleanup.json"), {
    schemaVersion: 1,
    status: cleanupError ? "FAIL" : "PASS",
    randomSchema: schema,
    randomSchemaSha256: sha256(schema),
    randomSchemaDropped: !cleanupError || !(await schemaExistsWithFreshClient(schema)),
    publicSchemaReadOnlyFingerprint: true,
    publicSchemaApplicationWrites: false,
    publicSchemaUnchanged: publicUnchanged,
    publicSchemaBeforeSha256: sha256(beforeText),
    publicSchemaAfterSha256: after.sha256,
    publicSchemaBeforeLineCount: beforeText ? beforeText.trimEnd().split("\n").filter(Boolean).length : 0,
    publicSchemaAfterLineCount: after.lineCount,
    errorCode: cleanupError ? classifyError(cleanupError) : null,
  });

  const provenancePath = resolve(evidenceRoot, "database-provenance.json");
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  provenance.status = cleanupError ? "FAIL" : "PASS";
  provenance.randomSchemaDropped = !cleanupError;
  provenance.publicSchemaUnchanged = publicUnchanged;
  provenance.publicSchemaAfterSha256 = after.sha256;
  provenance.publicSchemaAfterLineCount = after.lineCount;
  await writeJson(provenancePath, provenance);

  if (cleanupError) throw new Error(`Formal Supabase cleanup failed: ${safeMessage(cleanupError)}`);
}

async function schemaExistsWithFreshClient(schemaName) {
  const prisma = client(adminUrl.toString());
  try {
    await prisma.$connect();
    return await schemaExists(prisma, schemaName);
  } catch {
    return true;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

function client(url) {
  return new PrismaClient({ datasources: { db: { url } } });
}

async function schemaExists(prisma, schemaName) {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT count(*)::int AS count FROM pg_namespace WHERE nspname = $1",
    schemaName,
  );
  return Number(rows?.[0]?.count || 0) > 0;
}

async function publicSchemaFingerprint(prisma) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT line FROM (
      SELECT 'table|' || table_schema || '|' || table_name AS line
        FROM information_schema.tables
       WHERE table_schema = 'public'
      UNION ALL
      SELECT 'column|' || table_schema || '|' || table_name || '|' || column_name || '|' || ordinal_position::text || '|' || data_type
        FROM information_schema.columns
       WHERE table_schema = 'public'
      UNION ALL
      SELECT 'view|' || table_schema || '|' || table_name
        FROM information_schema.views
       WHERE table_schema = 'public'
      UNION ALL
      SELECT 'routine|' || routine_schema || '|' || routine_name || '|' || routine_type
        FROM information_schema.routines
       WHERE routine_schema = 'public'
    ) fingerprint
    ORDER BY line
  `);
  const lines = rows.map((row) => String(row.line));
  const text = lines.length ? `${lines.join("\n")}\n` : "";
  return { text, sha256: sha256(text), lineCount: lines.length };
}

function normalizedUrl(source, schemaName) {
  const url = new URL(source.toString());
  for (const name of ["schema", "connection_limit", "sslmode"]) url.searchParams.delete(name);
  url.searchParams.set("sslmode", "require");
  url.searchParams.set("schema", schemaName);
  url.searchParams.set("connection_limit", "3");
  return url;
}

function validateFormalSupabaseUrl(value, acceptanceEnvironment) {
  if (!/(?:test|testing|staging|stage|preview)/i.test(acceptanceEnvironment)) {
    throw new Error("Formal C8 requires an explicitly non-production GitHub environment");
  }
  const url = new URL(value);
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) throw new Error("Formal C8 database URL must use PostgreSQL");
  const host = url.hostname.toLowerCase();
  if (!/(?:^|\.)supabase\.(?:co|com)$/.test(host)) throw new Error("Formal C8 database URL must target a Supabase-managed host");
  if (new Set(["localhost", "127.0.0.1", "::1"]).has(host)) throw new Error("Formal C8 refuses local and container databases");
  if (!url.username || !url.password || !url.pathname.replace(/^\//, "")) throw new Error("Formal C8 database URL is incomplete");
  return url;
}

function createSchemaName(id, attempt) {
  const suffix = createHash("sha256").update(`${id}:${attempt}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 10);
  return `cs_accept_b0_${id}_${attempt}_${suffix}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

function quotedIdentifier(value) {
  if (!/^cs_accept_b0_[a-zA-Z0-9_]{8,}$/.test(value) || value.toLowerCase() === "public") {
    throw new Error("Refusing a non-random or public schema identifier");
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function managedHostSuffix(host) {
  return host.includes("pooler.supabase.com") ? "pooler.supabase.com" : host.endsWith("supabase.co") ? "supabase.co" : "supabase.com";
}

async function appendEnvironment(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value).replaceAll("\n", "")}`).join("\n");
  await appendFile(githubEnv, `${lines}\n`, "utf8");
}

function mask(...values) {
  for (const value of values.filter(Boolean)) process.stdout.write(`::add-mask::${value}\n`);
}

async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function classifyError(error) {
  const text = safeMessage(error);
  const match = text.match(/[A-Z][A-Z0-9_]{4,}/);
  return match?.[0] || "FORMAL_DATABASE_ERROR";
}

function safeMessage(error) {
  return String(error?.message || error)
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[DATABASE_URL_REDACTED]")
    .slice(0, 500);
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
