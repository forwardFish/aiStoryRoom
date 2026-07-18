import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(resolve(root, ".env"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

if (process.env.PAYMENT_DB_READBACK_ACKNOWLEDGE !== "readonly") {
  throw new Error("Set PAYMENT_DB_READBACK_ACKNOWLEDGE=readonly to run the production payment refund readback");
}
if (process.env.SUPABASE_DATABASE_URL) process.env.DATABASE_URL = process.env.SUPABASE_DATABASE_URL;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL or SUPABASE_DATABASE_URL is required");

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: singleConnectionUrl(process.env.DATABASE_URL) } } });
const artifactFile = resolve(root, "docs/auto-execute/evidence/payment-production-closure/production-refund-db-readback.json");
const requestedTransactionId = String(process.env.PAYMENT_TRANSACTION_ID || "").trim();

try {
  const purchase = await prisma.creemPurchase.findFirst({
    where: requestedTransactionId ? { transactionId: requestedTransactionId } : { status: "REFUNDED" },
    orderBy: { refundedAt: "desc" },
    select: {
      id: true,
      userId: true,
      status: true,
      packKey: true,
      credits: true,
      expectedAmountCents: true,
      paidAmountCents: true,
      expectedCurrency: true,
      paidCurrency: true,
      checkoutId: true,
      orderId: true,
      transactionId: true,
      paidAt: true,
      refundedAt: true
    }
  });
  if (!purchase) throw new Error(requestedTransactionId ? `No purchase found for transaction ${requestedTransactionId}` : "No refunded purchase found");

  const grant = await prisma.creditGrant.findFirst({
    where: { externalRef: purchase.id, kind: "PURCHASED", source: "PURCHASE" },
    select: { originalAmount: true, remainingAmount: true, createdAt: true, updatedAt: true }
  });
  const wallet = await prisma.creditWallet.findUnique({
    where: { userId: purchase.userId },
    select: { purchasedBalance: true, bonusBalance: true, debtBalance: true, version: true }
  });
  const ledgers = await prisma.creditLedger.findMany({
    where: { externalRef: purchase.id, reason: { in: ["PURCHASE", "PURCHASE_REFUND", "DISPUTE"] } },
    orderBy: { createdAt: "asc" },
    select: { reason: true, purchasedDelta: true, bonusDelta: true, debtDelta: true, idempotencyKey: true, createdAt: true }
  });
  const refundEvents = await prisma.paymentWebhookEvent.findMany({
    where: { eventType: "refund.created" },
    orderBy: { processedAt: "desc" },
    select: { eventId: true, eventType: true, status: true, processedAt: true, payloadJson: true }
  });

  const matchingEvents = refundEvents
    .map(safeRefundEvent)
    .filter((event) => event.transactionId === purchase.transactionId);
  const refundLedgers = ledgers.filter((ledger) => ledger.reason === "PURCHASE_REFUND");
  const purchaseLedgers = ledgers.filter((ledger) => ledger.reason === "PURCHASE");
  const netPurchasedDelta = ledgers.reduce((sum, ledger) => sum + ledger.purchasedDelta, 0);
  const event = matchingEvents[0] || null;
  const paidAmountCents = purchase.paidAmountCents || purchase.expectedAmountCents;
  const currency = purchase.paidCurrency || purchase.expectedCurrency;

  const acceptance = {
    purchaseFullyRefunded: purchase.status === "REFUNDED",
    providerRefundSucceeded: event?.refundStatus === "succeeded",
    providerModeIsTest: event?.mode === "test",
    identifiersMatch:
      Boolean(event) &&
      event.checkoutId === purchase.checkoutId &&
      event.orderId === purchase.orderId &&
      event.transactionId === purchase.transactionId,
    amountAndCurrencyMatch: event?.refundAmount === paidAmountCents && event?.currency === currency,
    webhookProcessedExactlyOnce: matchingEvents.length === 1 && event?.status === "PROCESSED",
    refundLedgerWrittenExactlyOnce: refundLedgers.length === 1,
    purchaseLedgerWrittenExactlyOnce: purchaseLedgers.length === 1,
    purchasedCreditsFullyReversed: netPurchasedDelta === 0 && refundLedgers[0]?.purchasedDelta === -purchase.credits,
    purchasedGrantFullyReversed: grant?.originalAmount === purchase.credits && grant?.remainingAmount === 0,
    noRefundDebt: refundLedgers[0]?.debtDelta === 0
  };
  const passed = Object.values(acceptance).every(Boolean);
  const result = {
    status: passed ? "PASS" : "FAIL",
    scope: "Redacted production Creem refund and credit-ledger readback",
    environment: event?.mode || null,
    purchase: {
      purchaseId: purchase.id,
      packKey: purchase.packKey,
      status: purchase.status,
      credits: purchase.credits,
      paidAmountCents,
      currency,
      checkoutId: purchase.checkoutId,
      orderId: purchase.orderId,
      transactionId: purchase.transactionId,
      paidAt: purchase.paidAt?.toISOString() || null,
      refundedAt: purchase.refundedAt?.toISOString() || null
    },
    webhook: event,
    grant,
    wallet,
    ledgers,
    integrity: {
      matchingRefundWebhookCount: matchingEvents.length,
      purchaseLedgerCount: purchaseLedgers.length,
      refundLedgerCount: refundLedgers.length,
      netPurchasedDelta
    },
    acceptance,
    piiRecorded: false,
    secretsRecorded: false,
    checkedAt: new Date().toISOString()
  };

  await mkdir(dirname(artifactFile), { recursive: true });
  await writeFile(artifactFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: result.status, evidence: artifactFile, transactionId: purchase.transactionId, acceptance, piiRecorded: false, secretsRecorded: false }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

function safeRefundEvent(row) {
  const object = row.payloadJson?.object || {};
  return {
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status,
    processedAt: row.processedAt.toISOString(),
    refundStatus: String(object.status || "").toLowerCase() || null,
    refundAmount: numberOrNull(object.refund_amount),
    currency: String(object.refund_currency || object.currency || object.transaction?.currency || object.order?.currency || "").toUpperCase() || null,
    mode: normalizeMode(object.mode || object.transaction?.mode || object.order?.mode || object.checkout?.mode),
    transactionId: providerId(object.transaction),
    orderId: providerId(object.order) || providerId(object.transaction?.order) || String(object.order_id || "") || null,
    checkoutId: providerId(object.checkout) || null
  };
}

function providerId(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return String(value.id || "") || null;
  return null;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (["test", "sandbox", "local"].includes(mode)) return "test";
  if (["live", "production", "prod"].includes(mode)) return "live";
  return null;
}

function singleConnectionUrl(value) {
  const url = new URL(value);
  url.searchParams.set("connection_limit", "1");
  url.searchParams.set("pool_timeout", "20");
  return url.toString();
}
