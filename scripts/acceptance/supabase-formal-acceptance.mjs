import { createHash } from "node:crypto";

const SUPABASE_HOST_PATTERN = /(?:^|\.)(?:supabase\.co|supabase\.com)$/u;
const ACCEPTANCE_SCHEMA_PATTERN = /^(?:cs|dk|omw)_accept_[a-z0-9_]{4,96}$/u;
const ACCEPTANCE_NAMESPACE_PATTERN = /^omw-dkl-[a-z0-9][a-z0-9-]{5,95}$/u;
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export class SupabaseAcceptanceError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "SupabaseAcceptanceError";
    this.code = code;
    this.details = details;
  }
}

export function isTruthy(value) {
  return TRUE_VALUES.has(String(value || "").trim().toLowerCase());
}

/**
 * Qualify an existing Supabase URL with the already-provisioned acceptance
 * schema. This function never creates, migrates, pushes, resets or seeds a
 * schema. It only prepares the connection string used by Prisma.
 */
export function prepareSupabaseAcceptanceEnvironment(env = process.env) {
  const rawDatabaseUrl = String(
    env.DATABASE_URL || env.SUPABASE_DATABASE_URL || "",
  ).trim();
  if (!rawDatabaseUrl) return "";
  let databaseUrl;
  try {
    databaseUrl = new URL(rawDatabaseUrl);
  } catch {
    return rawDatabaseUrl;
  }
  const schema = String(
    databaseUrl.searchParams.get("schema")
      || env.SUPABASE_ACCEPTANCE_SCHEMA
      || env.MANY_WORLDS_DB_SCHEMA
      || "",
  ).trim().toLowerCase();
  if (schema && !databaseUrl.searchParams.get("schema")) {
    databaseUrl.searchParams.set("schema", schema);
  }
  if (!databaseUrl.searchParams.has("connection_limit")) {
    databaseUrl.searchParams.set("connection_limit", "3");
  }
  const qualified = databaseUrl.toString();
  env.DATABASE_URL = qualified;
  if (!env.SUPABASE_DATABASE_URL) env.SUPABASE_DATABASE_URL = qualified;
  return qualified;
}

/**
 * Classify the evidence before a formal database or browser flow starts.
 * Local PostgreSQL, Docker, Mock DB and in-memory storage remain useful for
 * development but are explicitly auxiliary-only and can never produce a
 * product acceptance verdict.
 */
export function inspectSupabaseAcceptanceEnvironment(
  env = process.env,
  { requireFormal = true } = {},
) {
  const formal = isTruthy(env.FORMAL_ACCEPTANCE);
  if (requireFormal && !formal) {
    throw new SupabaseAcceptanceError(
      "FORMAL_ACCEPTANCE_NOT_ENABLED",
      "FORMAL_ACCEPTANCE=true is required for product-level acceptance",
    );
  }
  if (!formal) {
    return {
      evidenceClass: "AUXILIARY_ONLY",
      formalAcceptanceEligible: false,
      provider: "UNVERIFIED",
    };
  }

  const rawDatabaseUrl = String(
    env.DATABASE_URL || env.SUPABASE_DATABASE_URL || "",
  ).trim();
  if (!rawDatabaseUrl) {
    throw new SupabaseAcceptanceError(
      "SUPABASE_DATABASE_URL_MISSING",
      "DATABASE_URL or SUPABASE_DATABASE_URL is required",
    );
  }

  let databaseUrl;
  try {
    databaseUrl = new URL(rawDatabaseUrl);
  } catch {
    throw new SupabaseAcceptanceError(
      "SUPABASE_DATABASE_URL_INVALID",
      "the database connection string is not a valid URL",
    );
  }
  if (!new Set(["postgres:", "postgresql:"]).has(databaseUrl.protocol)) {
    throw new SupabaseAcceptanceError(
      "SUPABASE_DATABASE_PROTOCOL_INVALID",
      `expected PostgreSQL, received ${databaseUrl.protocol || "unknown"}`,
    );
  }

  const hostname = databaseUrl.hostname.toLowerCase();
  if (
    !SUPABASE_HOST_PATTERN.test(hostname)
    || hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
  ) {
    throw new SupabaseAcceptanceError(
      "FORMAL_ACCEPTANCE_REQUIRES_SUPABASE",
      "local PostgreSQL, Docker, Mock DB and non-Supabase hosts are auxiliary-only",
      { hostClass: classifyHost(hostname) },
    );
  }

  if (String(env.DATABASE_TARGET || "").trim().toLowerCase() !== "external") {
    throw new SupabaseAcceptanceError(
      "DATABASE_TARGET_NOT_EXTERNAL",
      "DATABASE_TARGET=external is required",
    );
  }
  if (String(env.NODE_ENV || "").trim().toLowerCase() !== "test") {
    throw new SupabaseAcceptanceError(
      "FORMAL_ACCEPTANCE_NODE_ENV_INVALID",
      "NODE_ENV=test is required",
    );
  }
  if (String(env.MVP_STORY_STORAGE || "").trim().toLowerCase() !== "prisma") {
    throw new SupabaseAcceptanceError(
      "FORMAL_ACCEPTANCE_STORAGE_INVALID",
      "MVP_STORY_STORAGE=prisma is required",
    );
  }
  if (!isTruthy(env.ACCEPTANCE_ALLOW_SYNTHETIC_WRITES)) {
    throw new SupabaseAcceptanceError(
      "SYNTHETIC_WRITE_ATTESTATION_MISSING",
      "ACCEPTANCE_ALLOW_SYNTHETIC_WRITES=true is required",
    );
  }
  if (!isTruthy(env.ACCEPTANCE_SUPABASE_SCHEMA_CONFIRMED_SYNTHETIC_ONLY)) {
    throw new SupabaseAcceptanceError(
      "SYNTHETIC_SCHEMA_ATTESTATION_MISSING",
      "the selected Supabase schema must be explicitly attested synthetic-only",
    );
  }
  if (isTruthy(env.ACCEPTANCE_ALLOW_MIGRATIONS)) {
    throw new SupabaseAcceptanceError(
      "DATABASE_MIGRATION_FORBIDDEN",
      "formal acceptance must not migrate, push, reset or seed the database",
    );
  }

  const expectedProjectRef = String(
    env.ACCEPTANCE_SUPABASE_PROJECT_REF || "",
  ).trim().toLowerCase();
  if (!expectedProjectRef) {
    throw new SupabaseAcceptanceError(
      "SUPABASE_PROJECT_REF_ATTESTATION_MISSING",
      "ACCEPTANCE_SUPABASE_PROJECT_REF is required",
    );
  }
  const actualProjectRef = inferProjectRef(databaseUrl, env);
  if (!actualProjectRef) {
    throw new SupabaseAcceptanceError(
      "SUPABASE_PROJECT_REF_UNRESOLVED",
      "project ref could not be derived from the connection or SUPABASE_PROJECT_REF",
    );
  }
  if (actualProjectRef !== expectedProjectRef) {
    throw new SupabaseAcceptanceError(
      "SUPABASE_PROJECT_REF_MISMATCH",
      "the connection is not for the approved acceptance project",
      {
        expectedProjectRefHash: sha256(expectedProjectRef),
        actualProjectRefHash: sha256(actualProjectRef),
      },
    );
  }
  const declaredProjectRef = String(env.SUPABASE_PROJECT_REF || "")
    .trim()
    .toLowerCase();
  if (declaredProjectRef && declaredProjectRef !== expectedProjectRef) {
    throw new SupabaseAcceptanceError(
      "SUPABASE_DECLARED_PROJECT_REF_MISMATCH",
      "SUPABASE_PROJECT_REF differs from the approved acceptance project",
    );
  }

  const schema = String(
    databaseUrl.searchParams.get("schema")
      || env.SUPABASE_ACCEPTANCE_SCHEMA
      || env.MANY_WORLDS_DB_SCHEMA
      || "",
  ).trim().toLowerCase();
  if (!schema || schema === "public" || !ACCEPTANCE_SCHEMA_PATTERN.test(schema)) {
    throw new SupabaseAcceptanceError(
      "SUPABASE_ACCEPTANCE_SCHEMA_INVALID",
      "formal writes require an existing isolated cs_accept_*, dk_accept_* or omw_accept_* schema; public is forbidden",
      { schema: schema || null },
    );
  }

  const namespace = String(env.ACCEPTANCE_DATA_NAMESPACE || "")
    .trim()
    .toLowerCase();
  if (!ACCEPTANCE_NAMESPACE_PATTERN.test(namespace)) {
    throw new SupabaseAcceptanceError(
      "ACCEPTANCE_DATA_NAMESPACE_INVALID",
      "ACCEPTANCE_DATA_NAMESPACE must match omw-dkl-<unique-run-suffix>",
    );
  }

  return {
    evidenceClass: "FORMAL_SUPABASE",
    formalAcceptanceEligible: true,
    provider: "SUPABASE",
    hostClass: classifyHost(hostname),
    projectRefHash: sha256(actualProjectRef),
    schema,
    namespace,
    databaseUrlFingerprint: sha256(
      redactedConnectionIdentity(databaseUrl, schema),
    ),
    migrationsAllowed: false,
    realUserDataAllowed: false,
    syntheticWritesAllowed: true,
  };
}

/**
 * Read only connection metadata and the schema's table catalog. It does not
 * query product rows. Missing tables block the run rather than triggering a
 * migration, because this task is not authorized to alter the database.
 */
export async function verifySupabaseAcceptanceConnection(
  contract,
  { PrismaClient: PrismaClientOverride } = {},
) {
  if (contract?.evidenceClass !== "FORMAL_SUPABASE") {
    throw new SupabaseAcceptanceError(
      "FORMAL_SUPABASE_CONTRACT_REQUIRED",
      "connection verification requires a formal Supabase contract",
    );
  }
  let PrismaClient = PrismaClientOverride;
  if (!PrismaClient) {
    ({ PrismaClient } = await import("@prisma/client"));
  }
  const prisma = new PrismaClient();
  try {
    const metadataRows = await prisma.$queryRawUnsafe(
      `SELECT current_database()::text AS "databaseName", current_user::text AS "databaseUser", current_schema()::text AS "schemaName"`,
    );
    const metadata = Array.isArray(metadataRows) ? metadataRows[0] : null;
    const actualSchema = String(metadata?.schemaName || "").toLowerCase();
    if (actualSchema !== contract.schema) {
      throw new SupabaseAcceptanceError(
        "SUPABASE_ACTIVE_SCHEMA_MISMATCH",
        "the live connection search_path does not target the approved acceptance schema",
        { expectedSchema: contract.schema, actualSchema },
      );
    }

    const tableRows = await prisma.$queryRawUnsafe(
      `SELECT table_name AS "tableName" FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('User','StoryRun','PlayerAction','SceneNode','EventLog') ORDER BY table_name`,
    );
    const tables = new Set(
      (Array.isArray(tableRows) ? tableRows : [])
        .map((row) => String(row?.tableName || "")),
    );
    const requiredTables = [
      "User",
      "StoryRun",
      "PlayerAction",
      "SceneNode",
      "EventLog",
    ];
    const missingTables = requiredTables.filter((table) => !tables.has(table));
    if (missingTables.length) {
      throw new SupabaseAcceptanceError(
        "SUPABASE_ACCEPTANCE_SCHEMA_NOT_PROVISIONED",
        "the existing acceptance schema is missing required tables; migrations are forbidden in this run",
        { missingTables },
      );
    }

    return {
      ...contract,
      connected: true,
      databaseNameHash: sha256(String(metadata?.databaseName || "")),
      databaseUserHash: sha256(String(metadata?.databaseUser || "")),
      requiredTables,
      verifiedAt: new Date().toISOString(),
    };
  } finally {
    await prisma.$disconnect();
  }
}

export function syntheticEmail(
  purpose,
  stamp = Date.now(),
  env = process.env,
) {
  const namespace = String(env.ACCEPTANCE_DATA_NAMESPACE || "mw-auxiliary")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  const safePurpose = String(purpose || "case")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 30) || "case";
  return `${namespace}-${safePurpose}-${stamp}@example.test`;
}

export function acceptanceEvidenceForReport(env = process.env) {
  if (!isTruthy(env.FORMAL_ACCEPTANCE)) {
    return {
      evidenceClass: "AUXILIARY_ONLY",
      formalAcceptanceEligible: false,
      provider: "UNVERIFIED",
    };
  }
  return inspectSupabaseAcceptanceEnvironment(env);
}

function inferProjectRef(databaseUrl, env) {
  const declared = String(env.SUPABASE_PROJECT_REF || "")
    .trim()
    .toLowerCase();
  const direct = databaseUrl.hostname
    .toLowerCase()
    .match(/^db\.([a-z0-9-]{8,64})\.supabase\.co$/u)?.[1];
  const username = decodeURIComponent(databaseUrl.username || "")
    .toLowerCase();
  const pooled = username.match(/^postgres\.([a-z0-9-]{8,64})$/u)?.[1];
  return direct || pooled || declared || "";
}

function classifyHost(hostname) {
  if (/\.pooler\.supabase\.com$/u.test(hostname)) return "SUPABASE_POOLER";
  if (/^db\.[a-z0-9-]+\.supabase\.co$/u.test(hostname)) return "SUPABASE_DIRECT";
  if (SUPABASE_HOST_PATTERN.test(hostname)) return "SUPABASE_OTHER";
  return "NON_SUPABASE";
}

function redactedConnectionIdentity(databaseUrl, schema) {
  return JSON.stringify({
    protocol: databaseUrl.protocol,
    hostname: databaseUrl.hostname.toLowerCase(),
    port: databaseUrl.port || null,
    database: databaseUrl.pathname.replace(/^\//u, ""),
    schema,
    usernameClass: databaseUrl.username.includes(".")
      ? databaseUrl.username.split(".")[0]
      : databaseUrl.username,
  });
}

function sha256(value) {
  return createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .toUpperCase();
}
