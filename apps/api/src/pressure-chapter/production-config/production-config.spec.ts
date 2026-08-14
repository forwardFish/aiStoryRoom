import assert from "node:assert/strict";
import test from "node:test";
import {
  configurePressureSupabaseDatabaseV1,
  createPressureNarrativeProviderFromEnvV1,
  inspectPressureSupabaseDatabaseV1,
  pressureDatabasePoolOptionsV1,
  PressureProductionConfigurationErrorV1,
  resolvePressureSupabaseDatabaseV1,
} from "./index";

const TEST_REF = "abcdefghijklmnopqrst";
const OTHER_REF = "tsrqponmlkjihgfedcba";

test("development replaces a legacy local URL with the explicitly bound Supabase project", () => {
  const resolved = resolvePressureSupabaseDatabaseV1({
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://postgres@127.0.0.1/local",
    SUPABASE_DATABASE_URL: `postgresql://postgres.${TEST_REF}:secret@aws-0-ap-northeast-1.pooler.supabase.com/postgres`,
    SUPABASE_URL: `https://${TEST_REF}.supabase.co`,
    SUPABASE_PROJECT_REF: TEST_REF,
  });
  const url = new URL(resolved.connectionString);
  assert.equal(url.hostname, "aws-0-ap-northeast-1.pooler.supabase.com");
  assert.equal(url.searchParams.get("connection_limit"), "2");
  assert.deepEqual(
    inspectPressureSupabaseDatabaseV1({
      SUPABASE_DATABASE_URL: resolved.connectionString,
      SUPABASE_PROJECT_REF: TEST_REF,
    }),
    { ready: true, database: "supabase", projectRefMatched: true, reason: null },
  );
});

test("production rejects local, unknown remote Postgres, and cross-project URLs", () => {
  const base = {
    NODE_ENV: "production",
    SUPABASE_DATABASE_URL: `postgresql://postgres.${TEST_REF}:secret@aws-0-ap-northeast-1.pooler.supabase.com/postgres`,
    SUPABASE_PROJECT_REF: TEST_REF,
  };
  for (const [url, code] of [
    ["postgresql://postgres@localhost/app", "PRODUCTION_DATABASE_URL_MUST_BE_SUPABASE"],
    ["postgresql://postgres:secret@postgres.example.test/app", "PRODUCTION_DATABASE_URL_MUST_BE_SUPABASE"],
    [`postgresql://postgres.${OTHER_REF}:secret@aws-0-ap-northeast-1.pooler.supabase.com/postgres`, "DATABASE_URL_PROJECT_REF_MISMATCH"],
  ] as const) {
    assert.throws(
      () => resolvePressureSupabaseDatabaseV1({ ...base, DATABASE_URL: url }),
      (error: unknown) => error instanceof PressureProductionConfigurationErrorV1
        && error.code === code,
    );
  }
});

test("Supabase diagnostics fail closed without disclosing URLs or project refs", () => {
  const readiness = inspectPressureSupabaseDatabaseV1({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://postgres:secret@postgres.example.test/app",
    SUPABASE_DATABASE_URL: `postgresql://postgres.${TEST_REF}:secret@aws-0-ap-northeast-1.pooler.supabase.com/postgres`,
    SUPABASE_PROJECT_REF: TEST_REF,
  });
  assert.equal(readiness.ready, false);
  const serialized = JSON.stringify(readiness);
  assert.doesNotMatch(serialized, /secret|example\.test|abcdefghijklmnopqrst/);
});

test("API and worker can share the Supabase binding with an explicit pool limit", () => {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "development",
    SUPABASE_DATABASE_URL: `postgresql://postgres.${TEST_REF}:secret@aws-0-ap-northeast-1.pooler.supabase.com/postgres`,
    SUPABASE_PROJECT_REF: TEST_REF,
  };
  configurePressureSupabaseDatabaseV1(environment, { connectionLimit: 1, poolTimeoutSeconds: 30 });
  const selected = new URL(environment.DATABASE_URL!);
  assert.equal(selected.searchParams.get("connection_limit"), "1");
  assert.equal(selected.searchParams.get("pool_timeout"), "30");
  assert.throws(
    () => configurePressureSupabaseDatabaseV1(environment, { connectionLimit: 0 }),
    (error: unknown) => error instanceof PressureProductionConfigurationErrorV1
      && error.code === "SUPABASE_CONNECTION_LIMIT_INVALID",
  );
  assert.throws(
    () => configurePressureSupabaseDatabaseV1(environment, { poolTimeoutSeconds: 0 }),
    (error: unknown) => error instanceof PressureProductionConfigurationErrorV1
      && error.code === "SUPABASE_POOL_TIMEOUT_INVALID",
  );
});

test("API and worker pool budgets are explicit, bounded, and independently configurable", () => {
  assert.deepEqual(pressureDatabasePoolOptionsV1({}, "api"), {
    connectionLimit: 5,
    poolTimeoutSeconds: 20,
  });
  assert.deepEqual(pressureDatabasePoolOptionsV1({}, "worker"), {
    connectionLimit: 1,
    poolTimeoutSeconds: 20,
  });
  assert.deepEqual(pressureDatabasePoolOptionsV1({
    PRESSURE_API_DATABASE_CONNECTION_LIMIT: "8",
    PRESSURE_DATABASE_POOL_TIMEOUT_SECONDS: "45",
  }, "api"), {
    connectionLimit: 8,
    poolTimeoutSeconds: 45,
  });
  for (const environment of [
    { PRESSURE_API_DATABASE_CONNECTION_LIMIT: "0" },
    { PRESSURE_API_DATABASE_CONNECTION_LIMIT: "51" },
    { PRESSURE_DATABASE_POOL_TIMEOUT_SECONDS: "121" },
  ]) {
    assert.throws(
      () => pressureDatabasePoolOptionsV1(environment, "api"),
      (error: unknown) => error instanceof PressureProductionConfigurationErrorV1,
    );
  }
});

test("narrative provider is explicit and deterministic fallback is visible", async () => {
  const fallback = createPressureNarrativeProviderFromEnvV1({});
  assert.equal(fallback.provider, null);
  assert.equal(fallback.turnPresentationProvider, null);
  assert.deepEqual(fallback.readiness, {
    ready: true,
    mode: "DETERMINISTIC_FALLBACK_ONLY",
    externalProviderConfigured: false,
    degraded: true,
    provider: "deterministic-fallback",
    model: null,
  });

  const external = createPressureNarrativeProviderFromEnvV1({
    DEEPSEEK_API_KEY: "secret-provider-key",
    DEEPSEEK_MODEL: "deepseek-test",
  }, async () => {
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        sceneText: "A safe line.",
        question: "What now?",
        options: [],
        usedFactRefs: [],
        claims: [],
      }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(external.provider, null);
  assert.equal(external.readiness.mode, "DETERMINISTIC_FALLBACK_ONLY");
  assert.equal(external.readiness.degraded, false);
  assert.ok(external.turnPresentationProvider);
  assert.doesNotMatch(JSON.stringify(external.readiness), /secret-provider-key/);
});
