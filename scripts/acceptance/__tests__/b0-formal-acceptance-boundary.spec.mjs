import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(process.cwd());
const read = (path) => readFileSync(resolve(root, path), "utf8");

const workflow = read(".github/workflows/b0-candidate-real-acceptance.yml");
const driver = read("scripts/acceptance/b0-candidate-real-flow.ts");
const formal = read("scripts/acceptance/b0-formal-supabase-acceptance.sh");
const selfHosted = read("scripts/acceptance/b0-selfhosted-real-acceptance.sh");
const databaseAdmin = read("scripts/acceptance/b0-formal-db-admin.mjs");
const providerProbe = read("scripts/acceptance/b0-formal-provider-probe.mjs");

test("self-hosted acceptance is permanently engineering-only", () => {
  assert.match(selfHosted, /B0_ENGINEERING_SELFHOSTED_ACCEPTANCE/);
  assert.match(selfHosted, /formalC8Eligible["']?: False/);
  assert.doesNotMatch(selfHosted, /"checkpoint"\s*:\s*"B0_C8_/);
  assert.doesNotMatch(selfHosted, /c8\s*=\s*root\.parent/);
  assert.match(workflow, /B0_ACCEPTANCE_TIER:\s*engineering-selfhosted/);
  assert.match(workflow, /finalize-engineering/);
});

test("formal C8 requires real non-production Supabase and DeepSeek provenance", () => {
  assert.match(driver, /ACCEPTANCE_TIER === "formal-c8"/);
  assert.match(driver, /supabase-cloud-nonproduction-random-schema/);
  assert.match(driver, /providerHost !== "api\.deepseek\.com"/);
  assert.match(driver, /Formal C8 cannot use a local PostgreSQL or Supabase container/);
  assert.match(formal, /B0_C8_REAL_NONPRODUCTION_SUPABASE_VALIDATED/);
  assert.doesNotMatch(formal, /B0_ENGINEERING_SELFHOSTED_ACCEPTANCE/);
  assert.match(databaseAdmin, /supabase-cloud-nonproduction-random-schema/);
  assert.match(databaseAdmin, /publicSchemaApplicationWrites:\s*false/);
  assert.match(providerProbe, /deepseek-api-real/);
  assert.match(providerProbe, /https:\/\/api\.deepseek\.com/);
});

test("workflow probes only named non-production environments and fails closed", () => {
  for (const environment of ["ourmanyworlds.com / test", "stellar-encouragement / test", "Preview"]) {
    assert.ok(workflow.includes(environment), `missing non-production environment probe: ${environment}`);
  }
  assert.match(workflow, /formal-c8-credential-blocker\.json/);
  assert.match(formal, /completeCredentialPairFound/);
  assert.match(formal, /containerResultAcceptedAsFormalC8/);
  assert.match(formal, /productionPublicSchemaAccessed/);
  assert.match(workflow, /environment:\s*\n\s*name:\s*\$\{\{ needs\.select-formal-environment\.outputs\.environment \}\}/);
  assert.doesNotMatch(workflow, /^\s+DATABASE_URL:\s*\$\{\{ secrets\.DATABASE_URL \}\}\s*$/m);
  assert.doesNotMatch(workflow, /choose_alias[^\n]*\bDATABASE_URL\b/);
});

test("formal evidence is committed only after exact gates, cleanup, redaction and finalization", () => {
  assert.match(workflow, /b0\/exact-push/);
  assert.match(workflow, /Verify public-schema isolation and drop only the random schema/);
  assert.match(workflow, /Redact and scan formal evidence/);
  assert.match(workflow, /Finalize formal C8 checkpoint/);
  assert.match(workflow, /Commit passing formal C8 runtime evidence as docs only/);
  assert.match(workflow, /grep -Ev '\^docs\/auto-execute\/evidence\/b0\/'/);
});

test("acceptance binds runtime publication proof to its isolated OpenNovel workspace", () => {
  assert.match(driver, /OPENOVEL_WORKSPACE_ROOT:\s*OPENOVEL_RUNTIME_ROOT/);
  assert.match(driver, /join\(OPENOVEL_RUNTIME_ROOT, "b0-narrative-jobs"\)/);
});
