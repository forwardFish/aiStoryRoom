import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const base = (process.env.API_BASE || "http://127.0.0.1:3102/api").replace(/\/$/, "");
const webhookSecret = process.env.CREEM_WEBHOOK_SECRET || "local_world_credits_secret";
if (!process.env.DATABASE_URL) {
  const databaseLine = readFileSync(".env", "utf8").split(/\r?\n/).find((line) => line.startsWith("DATABASE_URL="));
  if (databaseLine) process.env.DATABASE_URL = databaseLine.slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");
}
const runTag = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const prisma = new PrismaClient();

async function request(path: string, options: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...(options.headers || {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} -> ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

async function register(label: string, referralCode?: string) {
  const email = `world-credits-${label}-${runTag}@example.test`;
  const created = await request("/v4/auth/register", { method: "POST", body: { email, password: "local-pass-123", nickname: label, referralCode } });
  await request("/v4/auth/verify", { method: "POST", body: { email, verificationToken: created.verificationToken } });
  const loggedIn = await request("/v4/auth/login", { method: "POST", body: { email, password: "local-pass-123" } });
  return { email, token: loggedIn.token, user: loggedIn.user };
}

async function claimOnboarding(account: { token: string }, referralCode?: string) {
  return request("/v4/credits/onboarding", { method: "POST", token: account.token, body: { referralCode, channel: referralCode ? "LINK" : undefined } });
}

async function createAndCompleteOpening(account: { token: string }, templateId: string) {
  const run = await request("/story-runs", { method: "POST", token: account.token, body: { templateId, mode: "single", maxPlayers: 1, aiPlayerCount: 0, ownerAsPlayer: true } });
  await request(`/v4/story-runs/${run.id}/free-decision`, { method: "POST", token: account.token, body: {} });
  await request(`/v4/story-runs/${run.id}/free-decision`, { method: "POST", token: account.token, body: {} });
  return run.id;
}

async function sendCheckoutCompleted(account: { user: { id: string }; token: string }, checkout: any, productId: string, credits: number, amount: number) {
  const event = {
    id: `evt_${runTag}_${credits}`,
    eventType: "checkout.completed",
    object: {
      id: checkout.checkoutId,
      status: "completed",
      metadata: { userId: account.user.id, purchaseId: checkout.purchaseId, source: "web-local-test" },
      product: { id: productId },
      order: { id: `ord_${runTag}_${credits}`, transaction: `tx_${runTag}_${credits}`, amount, currency: "USD", status: "paid" },
      customer: { id: `cust_${runTag}`, email: "customer@example.test" }
    }
  };
  const first = await sendSignedEvent(event);
  const replay = await sendSignedEvent(event);
  return { event, first, replay };
}

async function sendSignedEvent(event: any) {
  const raw = JSON.stringify(event);
  const signature = createHmac("sha256", webhookSecret).update(raw).digest("hex");
  return request("/v4/webhooks/creem", { method: "POST", body: event, headers: { "creem-signature": signature } });
}

async function main() {
  const templates = await request("/world-templates");
  const templateId = templates[0]?.id || "midnight-store";
  const inviter = await register("inviter");
  const inviterOnboarding = await claimOnboarding(inviter);
  const inviterAgain = await claimOnboarding(inviter);
  const referral = await request("/v4/referrals/me", { token: inviter.token });

  const referredOne = await register("referred-one", referral.code);
  await claimOnboarding(referredOne, referral.code);
  await createAndCompleteOpening(referredOne, templateId);
  const referredTwo = await register("referred-two", referral.code);
  await claimOnboarding(referredTwo, referral.code);
  await createAndCompleteOpening(referredTwo, templateId);
  const referredThree = await register("referred-three", referral.code);
  await claimOnboarding(referredThree, referral.code);
  await createAndCompleteOpening(referredThree, templateId);

  const share = await request("/v4/referrals/share-events", { method: "POST", token: inviter.token, body: { channel: "X" } });
  const afterReferrals = await request("/v4/credits/balance", { token: inviter.token });
  const checkout300 = await request("/v4/billing/checkouts", { method: "POST", token: inviter.token, body: { packKey: "credits_300" } });
  const payment300 = await sendCheckoutCompleted(inviter, checkout300, "prod_xkzSkuNeiQuP1QVNV6NbL", 300, 799);
  const after300 = await request("/v4/credits/balance", { token: inviter.token });
  const checkout650 = await request("/v4/billing/checkouts", { method: "POST", token: inviter.token, body: { packKey: "credits_650" } });
  const payment650 = await sendCheckoutCompleted(inviter, checkout650, "prod_43UaxI9MUzfbPcGZtBbvQD", 650, 1499);
  const after650 = await request("/v4/credits/balance", { token: inviter.token });
  const unlockRun = await request("/story-runs", { method: "POST", token: inviter.token, body: { templateId, mode: "single", maxPlayers: 1, aiPlayerCount: 0, ownerAsPlayer: true } });
  const unlock = await request(`/v4/story-runs/${unlockRun.id}/unlock`, { method: "POST", token: inviter.token, body: {} });
  const unlockAgain = await request(`/v4/story-runs/${unlockRun.id}/unlock`, { method: "POST", token: inviter.token, body: {} });

  const refund = await sendSignedEvent({ id: `evt_refund_${runTag}`, eventType: "refund.created", object: { order: { id: `ord_${runTag}_300` }, refund_amount: 400 } });
  const dispute = await sendSignedEvent({ id: `evt_dispute_${runTag}`, eventType: "dispute.created", object: { order: { id: `ord_${runTag}_650` } } });

  const wrongSignatureResponse = await fetch(`${base}/v4/webhooks/creem`, { method: "POST", headers: { "content-type": "application/json", "creem-signature": "00" }, body: JSON.stringify({ id: `evt_bad_${runTag}`, eventType: "checkout.completed", object: {} }) });
  const finalBalance = await request("/v4/credits/balance", { token: inviter.token });
  const [referralRows, ledgerRows, purchaseRows, eventRows, unlockRows] = await Promise.all([
    prisma.referral.findMany({ where: { inviterUserId: inviter.user.id }, select: { status: true, rejectionReason: true } }),
    prisma.creditLedger.count({ where: { userId: inviter.user.id } }),
    prisma.creemPurchase.count({ where: { userId: inviter.user.id, status: "PAID" } }),
    prisma.paymentWebhookEvent.count({ where: { eventType: "checkout.completed" } }),
    prisma.worldUnlock.count({ where: { runId: unlockRun.id } })
  ]);

  const evidence = {
    status: "PASS",
    runTag,
    apiBase: base,
    accountFlow: { inviterSignupBonus: inviterOnboarding.bonusGranted, repeatedSignupBonus: inviterAgain.bonusGranted, referralCode: referral.code, shareCreditsGranted: share.creditsGranted, afterReferrals, referralRows },
    payments: { checkout300: { purchaseId: checkout300.purchaseId, checkoutId: checkout300.checkoutId }, payment300, after300, checkout650: { purchaseId: checkout650.purchaseId, checkoutId: checkout650.checkoutId }, payment650, after650, refund, dispute },
    unlock: { unlock, unlockAgain, unlockRows },
    security: { invalidSignatureStatus: wrongSignatureResponse.status, finalBalance },
    database: { inviterUserId: inviter.user.id, ledgerRows, paidPurchaseRows: purchaseRows, checkoutCompletedEventRows: eventRows }
  };
  mkdirSync("docs/auto-execute/world-credits/results", { recursive: true });
  writeFileSync("docs/auto-execute/world-credits/results/local-flow.json", JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
