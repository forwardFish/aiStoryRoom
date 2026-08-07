import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(".");
async function source(path) {
  return readFile(resolve(root, path), "utf8");
}

test("the legacy Dynamic Kernel workflow is explicitly auxiliary-only", async () => {
  const workflow = await source(
    ".github/workflows/dynamic-kernel-lite-gates.yml",
  );
  assert.match(workflow, /Dynamic Kernel Lite Auxiliary Gates/u);
  assert.match(workflow, /AUXILIARY_ONLY/u);
  assert.match(workflow, /productAcceptanceEligible["']?: False/u);
  assert.match(workflow, /formalSupabaseGateRequired["']?: True/u);
  assert.match(workflow, /dynamic-kernel-lite\/auxiliary-gates/u);
  assert.doesNotMatch(workflow, /context="dynamic-kernel-lite\/gates"/u);
});

test("formal acceptance is Supabase-only and cannot execute migration commands", async () => {
  const [workflow, runner, contract, databaseSmoke] = await Promise.all([
    source(".github/workflows/dynamic-kernel-lite-supabase-formal.yml"),
    source("scripts/acceptance/run-dynamic-kernel-lite-supabase.mjs"),
    source("scripts/acceptance/supabase-formal-acceptance.mjs"),
    source("scripts/e2e/v4-database-smoke.ts"),
  ]);
  assert.match(workflow, /dynamic-kernel-lite\/supabase-formal/u);
  assert.match(workflow, /SUPABASE_ACCEPTANCE_DATABASE_URL/u);
  assert.match(workflow, /ACCEPTANCE_SUPABASE_SCHEMA_CONFIRMED_SYNTHETIC_ONLY/u);
  assert.match(runner, /04-supabase-run-turn-idempotency/u);
  assert.match(runner, /05-supabase-real-page-flow/u);
  assert.match(runner, /v4-database-smoke\.ts/u);
  assert.match(runner, /dynamic-kernel-lite-supabase-browser\.mjs/u);
  assert.match(contract, /FORMAL_ACCEPTANCE_REQUIRES_SUPABASE/u);
  assert.match(contract, /DATABASE_MIGRATION_FORBIDDEN/u);
  assert.match(databaseSmoke, /ACCEPTANCE_DATA_NAMESPACE/u);
  assert.match(databaseSmoke, /syntheticEmail: EMAIL/u);
  assert.doesNotMatch(
    `${workflow}\n${runner}`,
    /(?:prisma\s+(?:migrate|db\s+(?:push|seed))|pnpm\s+db:(?:migrate|push|reset|seed))\b/iu,
  );
});

test("formal evidence requires persistence, idempotency, atomic commit, page flow and safe cleanup", async () => {
  const workflow = await source(
    ".github/workflows/dynamic-kernel-lite-supabase-formal.yml",
  );
  for (const required of [
    "databaseBacked",
    "runRoomTurnPersistenceCovered",
    "idempotencyCovered",
    "atomicCommitCovered",
    "realPageFlowCovered",
    "migrationsExecuted",
    "onlineConfigurationModified",
    "realUserDataAccessed",
    "cleanupEvidence",
  ]) {
    assert.ok(workflow.includes(required), `missing formal field: ${required}`);
  }
});
