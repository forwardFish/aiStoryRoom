import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const browserEvidencePath = "docs/auto-execute/evidence/many-worlds-v13/browser-three-player-seven-round/result.json";
const evidencePath = "docs/auto-execute/evidence/many-worlds-v13/room-unlock-audit.json";
const browserEvidence = JSON.parse(readFileSync(browserEvidencePath, "utf8"));
const roomId = String(browserEvidence.roomId || "");
const hostEmail = String(browserEvidence.players?.[0]?.email || "");

function configuredSupabaseUrl() {
  const line = readFileSync(".env", "utf8").split(/\r?\n/).find((value) => value.startsWith("SUPABASE_DATABASE_URL="));
  if (!line) throw new Error("SUPABASE_DATABASE_URL is required for the independent room-unlock audit");
  const url = new URL(line.slice("SUPABASE_DATABASE_URL=".length));
  url.searchParams.set("connection_limit", "1");
  return url.toString();
}

async function main() {
  assert.ok(roomId && hostEmail, "browser evidence must identify the host and the formal room");
  const loginResponse = await fetch("http://127.0.0.1:3102/api/v4/auth/login", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: hostEmail, password: "MvpBrowser2026!" })
  });
  const session = await loginResponse.json();
  assert.equal(loginResponse.status, 201, JSON.stringify(session));
  const transactionResponse = await fetch("http://127.0.0.1:3102/api/v4/credits/transactions?pageSize=100", { headers: { authorization: `Bearer ${session.accessToken}` } });
  const transactions = await transactionResponse.json();
  assert.equal(transactionResponse.status, 200, JSON.stringify(transactions));
  const apiUnlockLedgers = transactions.items.filter((item: any) => item.reason === "WORLD_UNLOCK" && item.externalRef === roomId);
  assert.equal(apiUnlockLedgers.length, 1, "the API ledger must contain exactly one unlock charge for this room");
  const charged = Math.abs(Number(apiUnlockLedgers[0].purchasedDelta || 0) + Number(apiUnlockLedgers[0].bonusDelta || 0));
  assert.equal(charged, 100, "the shared-room charge must be exactly 100 World Credits");

  const prisma = new PrismaClient({ datasources: { db: { url: configuredSupabaseUrl() } } });
  try {
    const [unlock, run, ledger] = await Promise.all([
      prisma.worldUnlock.findUnique({ where: { runId: roomId } }),
      prisma.storyRun.findUnique({ where: { id: roomId }, select: { accessLevel: true, freeDecisionsUsed: true, status: true } }),
      prisma.creditLedger.findUnique({ where: { id: apiUnlockLedgers[0].id } })
    ]);
    assert.equal(unlock?.creditsCharged, 100);
    assert.equal(unlock?.debitLedgerId, apiUnlockLedgers[0].id);
    assert.equal(ledger?.reason, "WORLD_UNLOCK");
    assert.equal(run?.accessLevel, "UNLOCKED");
    assert.equal(run?.freeDecisionsUsed, 3, "only the three opening rounds are free");
    assert.equal(run?.status, "chapter_generated");
    const report = { status: "PASS", roomId, apiWorldUnlockLedgerCount: apiUnlockLedgers.length, charged, supabase: { creditsCharged: unlock?.creditsCharged, debitLedgerId: unlock?.debitLedgerId, accessLevel: run?.accessLevel, freeDecisionsUsed: run?.freeDecisionsUsed, status: run?.status } };
    writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : error); process.exitCode = 1; });
