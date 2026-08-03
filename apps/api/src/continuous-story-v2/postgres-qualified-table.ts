import { Prisma } from "@prisma/client";

const POSTGRES_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function postgresSchemaFromDatabaseUrl(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) return "public";
  let schema: string;
  try {
    schema = new URL(databaseUrl).searchParams.get("schema") || "public";
  } catch {
    throw new Error("DATABASE_URL_INVALID");
  }
  if (!POSTGRES_IDENTIFIER.test(schema)) throw new Error("DATABASE_SCHEMA_IDENTIFIER_INVALID");
  return schema;
}

export function qualifiedPostgresTable(table: string, databaseUrl = process.env.DATABASE_URL) {
  if (!POSTGRES_IDENTIFIER.test(table)) throw new Error("DATABASE_TABLE_IDENTIFIER_INVALID");
  const schema = postgresSchemaFromDatabaseUrl(databaseUrl);
  return Prisma.raw(`"${schema}"."${table}"`);
}
