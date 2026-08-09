import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  assertSupabaseTestDatabaseUrl,
  ensureMainDecisionSurface,
  isSupabaseDatabaseHostname,
  submitObservedMainDecision,
} from "./openovel-maneuver-acceptance-guards.mjs";

test("accepts the project Supabase pooler hostname", () => {
  assert.deepEqual(
    assertSupabaseTestDatabaseUrl(
      "postgresql://test:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
    ),
    {
      protocol: "postgresql:",
      hostname: "aws-0-ap-northeast-1.pooler.supabase.com",
    },
  );
});

test("accepts official Supabase direct database hosts", () => {
  assert.equal(isSupabaseDatabaseHostname("db.project-ref.supabase.co"), true);
  assert.equal(
    assertSupabaseTestDatabaseUrl("postgres://user:secret@db.project-ref.supabase.co:5432/postgres").hostname,
    "db.project-ref.supabase.co",
  );
});

test("rejects local and arbitrary PostgreSQL hosts", () => {
  for (const url of [
    "postgresql://user:secret@localhost:5432/postgres",
    "postgresql://user:secret@127.0.0.1:5432/postgres",
    "postgresql://user:secret@[::1]:5432/postgres",
    "postgresql://user:secret@database.example.com:5432/postgres",
    "postgresql://user:secret@supabase.com.evil.example:5432/postgres",
  ]) {
    assert.throws(() => assertSupabaseTestDatabaseUrl(url), /official Supabase hostname/);
  }
});

test("rejects missing, malformed, and non-PostgreSQL database URLs", () => {
  assert.throws(() => assertSupabaseTestDatabaseUrl(""), /is required/);
  assert.throws(() => assertSupabaseTestDatabaseUrl("not-a-url"), /valid PostgreSQL Supabase URL/);
  assert.throws(
    () => assertSupabaseTestDatabaseUrl("https://db.project-ref.supabase.co/postgres"),
    /postgres or postgresql protocol/,
  );
});

test("opening gate is clicked once before the first main-decision surface is accepted", async () => {
  let clicks = 0;
  let waitCalls = 0;
  const result = await ensureMainDecisionSurface({
    label: "main turn 1",
    inspect: async () => ({ begin: true, submit: false, decisionCount: 0, fatal: "" }),
    clickOpeningGate: async () => { clicks += 1; },
    waitForDecision: async () => {
      waitCalls += 1;
      return { begin: false, submit: true, decisionCount: 3, fatal: "" };
    },
  });

  assert.equal(result.openedFromPrologue, true);
  assert.equal(result.surface.submit, true);
  assert.equal(result.surface.decisionCount, 3);
  assert.equal(clicks, 1);
  assert.equal(waitCalls, 1);
});

test("an existing main-decision surface does not click the opening gate", async () => {
  let clicks = 0;
  let waitCalls = 0;
  const result = await ensureMainDecisionSurface({
    inspect: async () => ({ begin: false, submit: true, decisionCount: 2, fatal: "" }),
    clickOpeningGate: async () => { clicks += 1; },
    waitForDecision: async () => { waitCalls += 1; return null; },
  });

  assert.equal(result.openedFromPrologue, false);
  assert.equal(clicks, 0);
  assert.equal(waitCalls, 0);
});

test("missing opening and decision surfaces fail closed", async () => {
  await assert.rejects(
    ensureMainDecisionSurface({
      label: "main turn 2",
      inspect: async () => ({ begin: false, submit: false, decisionCount: 0, fatal: "" }),
      clickOpeningGate: async () => {},
      waitForDecision: async () => null,
    }),
    /neither #beginStoryBtn nor a complete main-decision surface/,
  );
});

test("opening gate cannot pass without decision inputs and submit control", async () => {
  await assert.rejects(
    ensureMainDecisionSurface({
      label: "main turn 3",
      inspect: async () => ({ begin: true, submit: false, decisionCount: 0, fatal: "" }),
      clickOpeningGate: async () => {},
      waitForDecision: async () => ({ begin: false, submit: true, decisionCount: 0, fatal: "" }),
    }),
    /without decision inputs and #submitDecision/,
  );
});

test("opening gate leads to a real central-decision submission and one authoritative sequence advance", async () => {
  let gateClicks = 0;
  let submitCalls = 0;
  let sequence = 8;
  const result = await submitObservedMainDecision({
    label: "main turn 1",
    inspect: async () => ({ begin: true, submit: false, decisionCount: 0, fatal: "" }),
    clickOpeningGate: async () => { gateClicks += 1; },
    waitForDecision: async () => ({ begin: false, submit: true, decisionCount: 3, fatal: "" }),
    readWorldSequence: async () => sequence,
    submitDecision: async () => { submitCalls += 1; sequence += 1; return true; },
    waitForWorldSequence: async (expected) => sequence === expected ? sequence : false,
  });

  assert.equal(gateClicks, 1);
  assert.equal(submitCalls, 1);
  assert.equal(result.openedFromPrologue, true);
  assert.equal(result.sequenceBefore, 8);
  assert.equal(result.sequenceAfter, 9);
});

test("a decision click that does not advance authoritative state cannot pass", async () => {
  await assert.rejects(
    submitObservedMainDecision({
      label: "main turn 2",
      inspect: async () => ({ begin: false, submit: true, decisionCount: 2, fatal: "" }),
      clickOpeningGate: async () => { throw new Error("must not click gate"); },
      waitForDecision: async () => { throw new Error("must not wait for gate"); },
      readWorldSequence: async () => 4,
      submitDecision: async () => true,
      waitForWorldSequence: async () => 4,
    }),
    /did not advance worldSequence exactly once/,
  );
});

test("acceptance sources guard Supabase before services or Prisma and submit only after a real decision surface", async () => {
  const core = await readFile(new URL("./openovel-maneuver-live-browser-core.mjs", import.meta.url), "utf8");
  const browser = await readFile(new URL("./openovel-maneuver-r2-4-browser.mjs", import.meta.url), "utf8");
  const harness = await readFile(new URL("./openovel-maneuver-r2-4-browser-harness.mjs", import.meta.url), "utf8");

  assert.ok(core.indexOf("assertSupabaseTestDatabaseUrl(DATABASE_URL)") < core.indexOf("const dirs ="));
  assert.ok(browser.indexOf("assertSupabaseTestDatabaseUrl(DATABASE_URL)") < browser.indexOf("new PrismaClient()"));
  assert.match(harness, /submitObservedMainDecision\(\{/);
  assert.match(harness, /decisionCount: document\.querySelectorAll\('input\[name="decision"\]'\)\.length/);
  assert.match(harness, /if \(!option\) throw new Error\('main decision option missing'\)/);
  assert.match(harness, /option\.click\(\)/);
  assert.match(harness, /submit\.click\(\)/);
});

test("opening-gate helper has no fixed-delay escape hatch", () => {
  const source = ensureMainDecisionSurface.toString();
  assert.doesNotMatch(source, /setTimeout|delay\s*\(/);
});
