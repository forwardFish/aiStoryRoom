import assert from "node:assert/strict";
import test from "node:test";
import type { NarrativeContextV1 } from "@apps/openovel-runtime/pressure-narrative/contracts";
import {
  configurePressureSupabaseDatabaseV1,
  createPressureNarrativeProviderFromEnvV1,
  inspectPressureSupabaseDatabaseV1,
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
  configurePressureSupabaseDatabaseV1(environment, { connectionLimit: 1 });
  const selected = new URL(environment.DATABASE_URL!);
  assert.equal(selected.searchParams.get("connection_limit"), "1");
  assert.throws(
    () => configurePressureSupabaseDatabaseV1(environment, { connectionLimit: 0 }),
    (error: unknown) => error instanceof PressureProductionConfigurationErrorV1
      && error.code === "SUPABASE_CONNECTION_LIMIT_INVALID",
  );
});

test("narrative provider is explicit and deterministic fallback is visible", async () => {
  const fallback = createPressureNarrativeProviderFromEnvV1({});
  assert.equal(fallback.provider, null);
  assert.equal(fallback.decisionPresentationProvider, null);
  assert.deepEqual(fallback.readiness, {
    ready: true,
    mode: "DETERMINISTIC_FALLBACK_ONLY",
    externalProviderConfigured: false,
    degraded: true,
    provider: "deterministic-fallback",
    model: null,
  });

  let request: { url: string; init?: RequestInit } | null = null;
  const external = createPressureNarrativeProviderFromEnvV1({
    DEEPSEEK_API_KEY: "secret-provider-key",
    DEEPSEEK_MODEL: "deepseek-test",
  }, async (input, init) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        text: "A safe line.",
        usedFactRefs: [],
        claims: [],
      }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(external.readiness.mode, "EXTERNAL_PROVIDER");
  assert.ok(external.decisionPresentationProvider);
  assert.doesNotMatch(JSON.stringify(external.readiness), /secret-provider-key/);
  const result = await external.provider!.render(contextFixture());
  assert.deepEqual(result, { text: "A safe line.", usedFactRefs: [], claims: [] });
  assert.equal(request!.url, "https://api.deepseek.com/chat/completions");
  assert.equal((request!.init?.headers as Record<string, string>).authorization, "Bearer secret-provider-key");
});

function contextFixture(): NarrativeContextV1 {
  return {
    schemaVersion: "pressure_narrative_context_v1",
    contextCompilerVersion: "context-v1",
    projectionKind: "GENESIS_NARRATIVE",
    audience: { kind: "PUBLIC", seatId: null },
    sourceId: "genesis-1",
    sourceCommitHash: "a".repeat(64),
    sourceContentHash: "b".repeat(64),
    temporalInstruction: "Only committed facts.",
    facts: [],
    objects: [],
    knowledge: [],
    allowedClaims: [],
    variant: { kind: "GENESIS", stageId: "P0", openingHook: "Opening" },
    contextHash: "c".repeat(64),
  };
}
