import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const base = (process.env.API_BASE || "http://127.0.0.1:3102/api").replace(/\/$/, "");
const runTag = `credit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const retryTag = `${runTag}_retry`;
const evidencePath = "docs/auto-execute/evidence/many-worlds-v13/world-registry-and-test-credit.json";

async function request(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function registerAndLogin(email: string, nickname: string) {
  const password = "local-pass-123";
  const registered = await request("/v4/auth/register", { method: "POST", body: { email, password, nickname } });
  assert.equal(registered.status, 201, JSON.stringify(registered.payload));
  const verified = await request("/v4/auth/verify", { method: "POST", body: { email, verificationToken: registered.payload.verificationToken } });
  assert.equal(verified.status, 201, JSON.stringify(verified.payload));
  const login = await request("/v4/auth/login", { method: "POST", body: { email, password } });
  assert.equal(login.status, 201, JSON.stringify(login.payload));
  return login.payload.token as string;
}

async function main() {
  const disabledEmail = process.env.TEST_CREDIT_DISABLED_EMAIL;
  if (disabledEmail) {
    const login = await request("/v4/auth/login", { method: "POST", body: { email: disabledEmail, password: "local-pass-123" } });
    assert.equal(login.status, 201, JSON.stringify(login.payload));
    const denied = await request("/v4/credits/test-grant", { method: "POST", token: login.payload.token, body: { runId: "disabled-check", amount: 1 } });
    assert.equal(denied.status, 403, JSON.stringify(denied.payload));
    assert.equal(denied.payload.code || denied.payload.message?.code, "TEST_CREDIT_GRANT_DISABLED");
    const prior = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, "utf8")) : { status: "PASS" };
    const evidence = { ...prior, status: "PASS", testCredit: { ...(prior.testCredit || {}), disabledStatus: denied.status } };
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
    return;
  }
  const registry = await request("/v4/worlds");
  assert.equal(registry.status, 200, JSON.stringify(registry.payload));
  assert.deepEqual(registry.payload.worlds.map((world: { id: string }) => world.id), ["sangtian", "caesar_last_spring"]);
  const caesar = await request("/v4/worlds/caesar_last_spring");
  const caesarAlias = await request("/v4/worlds/caesar");
  const missingWorld = await request("/v4/worlds/not-a-world");
  assert.equal(caesar.status, 200, JSON.stringify(caesar.payload));
  assert.equal(caesarAlias.status, 200, JSON.stringify(caesarAlias.payload));
  assert.equal(caesar.payload.totalDays, 7);
  assert.equal(caesar.payload.roles.length, 6);
  assert.equal(missingWorld.status, 404);

  const testToken = await registerAndLogin(`credit-${runTag}-${retryTag}@example.test`, "credit acceptance");
  const normalToken = await registerAndLogin(`credit-normal-${runTag}@example.invalid`, "normal acceptance");
  const first = await request("/v4/credits/test-grant", { method: "POST", token: testToken, body: { runId: runTag, amount: 900 } });
  assert.equal(first.status, 201, JSON.stringify(first.payload));
  const retry = await request("/v4/credits/test-grant", { method: "POST", token: testToken, body: { runId: runTag, amount: 200 } });
  assert.equal(retry.status, 201, JSON.stringify(retry.payload));
  assert.equal(retry.payload.ledgerId, first.payload.ledgerId, "same idempotency key must return the first ledger");
  assert.deepEqual(retry.payload.balance, first.payload.balance, "retry must not mutate the wallet");
  const limit = await request("/v4/credits/test-grant", { method: "POST", token: testToken, body: { runId: retryTag, amount: 200 } });
  assert.equal(limit.status, 400, JSON.stringify(limit.payload));
  assert.equal(limit.payload.code || limit.payload.message?.code, "TEST_CREDIT_GRANT_LIMIT");
  const ordinary = await request("/v4/credits/test-grant", { method: "POST", token: normalToken, body: { runId: runTag, amount: 1 } });
  assert.equal(ordinary.status, 400, JSON.stringify(ordinary.payload));
  assert.equal(ordinary.payload.code || ordinary.payload.message?.code, "INVALID_TEST_CREDIT_GRANT");
  const ledger = await request("/v4/credits/transactions?pageSize=100", { token: testToken });
  assert.equal(ledger.status, 200, JSON.stringify(ledger.payload));
  const adjustments = ledger.payload.items.filter((item: { reason: string }) => item.reason === "ADMIN_ADJUSTMENT");
  assert.equal(adjustments.length, 1, "only one test-credit ledger may be written for the retried key");

  const concurrentA = `${runTag}_concurrent_a`;
  const concurrentB = `${runTag}_concurrent_b`;
  const concurrentToken = await registerAndLogin(`credit-${concurrentA}-${concurrentB}@example.test`, "credit concurrent acceptance");
  const concurrent = await Promise.all([
    request("/v4/credits/test-grant", { method: "POST", token: concurrentToken, body: { runId: concurrentA, amount: 600 } }),
    request("/v4/credits/test-grant", { method: "POST", token: concurrentToken, body: { runId: concurrentB, amount: 600 } })
  ]);
  assert.deepEqual(concurrent.map((item) => item.status).sort(), [201, 400], JSON.stringify(concurrent));
  const concurrentLedger = await request("/v4/credits/transactions?pageSize=100", { token: concurrentToken });
  const concurrentAdjustments = concurrentLedger.payload.items.filter((item: { reason: string }) => item.reason === "ADMIN_ADJUSTMENT");
  assert.equal(concurrentAdjustments.length, 1, "concurrent cap contenders may create only one ledger");

  const evidence = {
    status: "PASS", runTag, apiBase: base,
    worldRegistry: { ids: registry.payload.worlds.map((world: { id: string }) => world.id), caesarRoles: caesar.payload.roles.length, missingWorldStatus: missingWorld.status },
    testCredit: { first: first.payload, retry: retry.payload, limitStatus: limit.status, ordinaryUserStatus: ordinary.status, adminAdjustmentLedgerCount: adjustments.length, concurrentStatuses: concurrent.map((item) => item.status), concurrentLedgerCount: concurrentAdjustments.length }
  };
  mkdirSync("docs/auto-execute/evidence/many-worlds-v13", { recursive: true });
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
