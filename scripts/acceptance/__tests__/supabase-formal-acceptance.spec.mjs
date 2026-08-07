import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectSupabaseAcceptanceEnvironment,
  prepareSupabaseAcceptanceEnvironment,
  syntheticEmail,
} from "../supabase-formal-acceptance.mjs";

const ref = "abcdefghijklmnopqrst";
function baseEnv(overrides = {}) {
  return {
    FORMAL_ACCEPTANCE: "true",
    DATABASE_URL: `postgresql://postgres:secret@db.${ref}.supabase.co:5432/postgres?schema=dk_accept_dynamic_kernel`,
    DATABASE_TARGET: "external",
    NODE_ENV: "test",
    MVP_STORY_STORAGE: "prisma",
    ACCEPTANCE_ALLOW_SYNTHETIC_WRITES: "true",
    ACCEPTANCE_SUPABASE_SCHEMA_CONFIRMED_SYNTHETIC_ONLY: "true",
    ACCEPTANCE_SUPABASE_PROJECT_REF: ref,
    SUPABASE_PROJECT_REF: ref,
    ACCEPTANCE_DATA_NAMESPACE: "omw-dkl-contract-123456",
    ...overrides,
  };
}

test("a separately supplied acceptance schema is added without logging credentials", () => {
  const env = baseEnv({
    DATABASE_URL: `postgresql://postgres:secret@db.${ref}.supabase.co:5432/postgres`,
    SUPABASE_ACCEPTANCE_SCHEMA: "dk_accept_qualified",
  });
  const qualified = prepareSupabaseAcceptanceEnvironment(env);
  const url = new URL(qualified);
  assert.equal(url.searchParams.get("schema"), "dk_accept_qualified");
  assert.equal(url.searchParams.get("connection_limit"), "3");
  assert.equal(
    inspectSupabaseAcceptanceEnvironment(env).schema,
    "dk_accept_qualified",
  );
});

test("direct Supabase connection with an isolated acceptance schema is formal evidence", () => {
  const result = inspectSupabaseAcceptanceEnvironment(baseEnv());
  assert.equal(result.evidenceClass, "FORMAL_SUPABASE");
  assert.equal(result.provider, "SUPABASE");
  assert.equal(result.hostClass, "SUPABASE_DIRECT");
  assert.equal(result.schema, "dk_accept_dynamic_kernel");
  assert.equal(result.realUserDataAllowed, false);
  assert.equal(result.migrationsAllowed, false);
});

test("Supabase pooler resolves the approved project from the username", () => {
  const result = inspectSupabaseAcceptanceEnvironment(baseEnv({
    DATABASE_URL: `postgresql://postgres.${ref}:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?schema=cs_accept_dynamic_kernel`,
  }));
  assert.equal(result.hostClass, "SUPABASE_POOLER");
  assert.equal(result.schema, "cs_accept_dynamic_kernel");
});

test("localhost and generic PostgreSQL cannot pass formal acceptance", () => {
  assert.throws(
    () => inspectSupabaseAcceptanceEnvironment(baseEnv({
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/postgres?schema=dk_accept_local",
    })),
    /FORMAL_ACCEPTANCE_REQUIRES_SUPABASE/u,
  );
});

test("public schema is forbidden even on the approved Supabase project", () => {
  assert.throws(
    () => inspectSupabaseAcceptanceEnvironment(baseEnv({
      DATABASE_URL: `postgresql://postgres:secret@db.${ref}.supabase.co:5432/postgres?schema=public`,
    })),
    /SUPABASE_ACCEPTANCE_SCHEMA_INVALID/u,
  );
});

test("project mismatch and migration intent fail closed", () => {
  assert.throws(
    () => inspectSupabaseAcceptanceEnvironment(baseEnv({
      ACCEPTANCE_SUPABASE_PROJECT_REF: "differentprojectref99",
    })),
    /SUPABASE_PROJECT_REF_MISMATCH/u,
  );
  assert.throws(
    () => inspectSupabaseAcceptanceEnvironment(baseEnv({
      ACCEPTANCE_ALLOW_MIGRATIONS: "true",
    })),
    /DATABASE_MIGRATION_FORBIDDEN/u,
  );
});

test("formal writes require synthetic-only attestations and a unique namespace", () => {
  assert.throws(
    () => inspectSupabaseAcceptanceEnvironment(baseEnv({
      ACCEPTANCE_ALLOW_SYNTHETIC_WRITES: "false",
    })),
    /SYNTHETIC_WRITE_ATTESTATION_MISSING/u,
  );
  assert.throws(
    () => inspectSupabaseAcceptanceEnvironment(baseEnv({
      ACCEPTANCE_SUPABASE_SCHEMA_CONFIRMED_SYNTHETIC_ONLY: "false",
    })),
    /SYNTHETIC_SCHEMA_ATTESTATION_MISSING/u,
  );
  assert.throws(
    () => inspectSupabaseAcceptanceEnvironment(baseEnv({
      ACCEPTANCE_DATA_NAMESPACE: "production",
    })),
    /ACCEPTANCE_DATA_NAMESPACE_INVALID/u,
  );
});

test("non-formal execution is auxiliary and synthetic emails are namespaced", () => {
  const auxiliary = inspectSupabaseAcceptanceEnvironment(
    { FORMAL_ACCEPTANCE: "false" },
    { requireFormal: false },
  );
  assert.equal(auxiliary.evidenceClass, "AUXILIARY_ONLY");
  const email = syntheticEmail("v4-db", 123, baseEnv());
  assert.equal(
    email,
    "omw-dkl-contract-123456-v4-db-123@example.test",
  );
});
