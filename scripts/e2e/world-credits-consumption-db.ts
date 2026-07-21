import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { CreditsService } from "../../apps/api/src/credits/credits.service";
import { CreditConsumptionService } from "../../apps/api/src/credits/credit-consumption.service";
import { RunSponsorshipService } from "../../apps/api/src/credits/run-sponsorship.service";
import { creditRequestHash } from "../../apps/api/src/credits/credit-policy";

process.env.CREDIT_DEFAULT_POLICY = "active_action_v1";
process.env.CREDIT_ACTION_METERING_MODE = "ENFORCED";
process.env.CREDIT_RUN_CREATE_COST = "20";
process.env.CREDIT_STANDARD_ACTION_COST = "1";
process.env.CREDIT_CUSTOM_ACTION_COST = "2";
process.env.CREDIT_COMPLEX_ACTION_COST = "2";
process.env.CREDIT_RUN_SPONSORSHIP_AMOUNT = "10";

const prisma = new PrismaClient();
const credits = new CreditsService(prisma as never);
const consumption = new CreditConsumptionService(prisma as never, credits);
const sponsorships = new RunSponsorshipService(prisma as never, credits, consumption);
const tag = `credit_db_${Date.now()}_${randomUUID().slice(0, 8)}`;
const hostId = `${tag}_host`;
const playerId = `${tag}_player`;
const emptyId = `${tag}_empty`;
const mixedId = `${tag}_mixed`;
const runId = `${tag}_run`;
const templateId = `${tag}_template`;

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function main() {
  await prisma.worldTemplate.create({
    data: { id: templateId, name: "Credits DB Test", genre: "test", hook: "test", worldBase: "test", status: "test", configJson: {} }
  });
  await prisma.user.createMany({
    data: [
      { id: hostId, openid: hostId, email: `${hostId}@example.test` },
      { id: playerId, openid: playerId, email: `${playerId}@example.test` },
      { id: emptyId, openid: emptyId, email: `${emptyId}@example.test` },
      { id: mixedId, openid: mixedId, email: `${mixedId}@example.test` }
    ]
  });
  await credits.grantCredits({ userId: hostId, kind: "BONUS", source: "SIGNUP", amount: 50, reason: "SIGNUP_BONUS", idempotencyKey: `${tag}:host:signup` });
  await credits.grantCredits({ userId: playerId, kind: "BONUS", source: "SIGNUP", amount: 1, reason: "SIGNUP_BONUS", idempotencyKey: `${tag}:player:bonus` });
  await credits.grantCredits({ userId: playerId, kind: "PURCHASED", source: "PURCHASE", amount: 4, reason: "PURCHASE", idempotencyKey: `${tag}:player:purchased` });
  await credits.grantCredits({ userId: mixedId, kind: "BONUS", source: "SIGNUP", amount: 1, reason: "SIGNUP_BONUS", idempotencyKey: `${tag}:mixed:bonus` });
  await credits.grantCredits({ userId: mixedId, kind: "PURCHASED", source: "PURCHASE", amount: 4, reason: "PURCHASE", idempotencyKey: `${tag}:mixed:purchased` });

  const runCreate = await consumption.reserveCharge({
    runId,
    beneficiaryUserId: hostId,
    chargeType: "RUN_CREATE",
    actionClass: "RUN_CREATE",
    amount: 20,
    idempotencyKey: `${tag}:run-create`,
    requestHash: creditRequestHash({ runId, kind: "shared" }),
    meteringMode: "ENFORCED"
  });
  expect(runCreate.kind === "reserved", "Run creation must reserve exactly once");
  await prisma.storyRun.create({
    data: {
      id: runId,
      templateId,
      ownerUserId: hostId,
      title: "Credits integration run",
      hook: "test",
      mode: "room",
      templateKey: "credit-test",
      status: "playing",
      stateJson: {},
      inviteCode: `CR${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`,
      billingPolicyVersion: "active_action_v1",
      billingPriceJson: { currency: "WORLD_CREDITS", runCreate: 20, standardAction: 1, customAction: 2, complexAction: 2, sponsorshipPack: 10 }
    }
  });
  await prisma.storyPlayer.createMany({
    data: [
      { runId, userId: hostId, playerType: "human", status: "active" },
      { runId, userId: playerId, playerType: "human", status: "active" },
      { runId, userId: mixedId, playerType: "human", status: "active" }
    ]
  });
  await consumption.commitCharge(runCreate.charge.id);
  expect((await credits.getBalance(hostId)).available === 30, "50 Credits - 20 Run creation must equal 30");

  const request = await sponsorships.createRequest(
    { id: playerId, openid: playerId } as any,
    runId,
    { idempotencyKey: `${tag}:sponsor-request`, origin: "FIRST_INSUFFICIENT" }
  );
  const approved = await sponsorships.approve({ id: hostId, openid: hostId } as any, runId, request.id);
  expect((await credits.getBalance(hostId)).available === 20, "Host approval must spend exactly 10");
  expect((await credits.getBalance(playerId)).available === 5, "Sponsorship must not increase beneficiary personal wallet");
  expect(approved.allowance.remainingAmount === 10, "Sponsorship must create a 10-Credit run allowance");

  const committed = await consumption.reserveCharge({
    runId,
    beneficiaryUserId: playerId,
    chargeType: "PLAYER_ACTION",
    actionClass: "CUSTOM_ACTION",
    amount: 2,
    idempotencyKey: `${tag}:action:committed`,
    requestHash: creditRequestHash({ runId, action: "custom-committed" }),
    meteringMode: "ENFORCED"
  });
  expect(committed.kind === "reserved", "Custom action must reserve");
  await consumption.commitCharge(committed.charge.id);
  const afterCommitted = await consumption.availableForRun(runId, playerId);
  expect(afterCommitted.runAllowanceAvailable === 8 && afterCommitted.personalAvailable === 5, "Custom action must consume allowance before personal Credits");

  const released = await consumption.reserveCharge({
    runId,
    beneficiaryUserId: playerId,
    chargeType: "PLAYER_ACTION",
    actionClass: "STANDARD_ACTION",
    amount: 1,
    idempotencyKey: `${tag}:action:released`,
    requestHash: creditRequestHash({ runId, action: "standard-released" }),
    meteringMode: "ENFORCED"
  });
  expect(released.kind === "reserved", "Standard action must reserve");
  await consumption.releaseCharge(released.charge.id, "QUALITY_REJECTED");
  const afterRelease = await consumption.availableForRun(runId, playerId);
  expect(afterRelease.runAllowanceAvailable === 8 && afterRelease.personalAvailable === 5, "Failed action must restore the exact allowance source");

  const replay = await consumption.reserveCharge({
    runId,
    beneficiaryUserId: playerId,
    chargeType: "PLAYER_ACTION",
    actionClass: "CUSTOM_ACTION",
    amount: 2,
    idempotencyKey: `${tag}:action:committed`,
    requestHash: creditRequestHash({ runId, action: "custom-committed" }),
    meteringMode: "ENFORCED"
  });
  expect(replay.kind === "replay" && replay.charge.id === committed.charge.id, "Action replay must reuse the original charge");

  const insufficient = await consumption.reserveCharge({
    runId,
    beneficiaryUserId: emptyId,
    chargeType: "PLAYER_ACTION",
    actionClass: "STANDARD_ACTION",
    amount: 1,
    idempotencyKey: `${tag}:action:insufficient`,
    requestHash: creditRequestHash({ runId, action: "insufficient" }),
    meteringMode: "ENFORCED"
  });
  expect(insufficient.kind === "insufficient", "Zero-Credit user must fail without partial allocation");

  const mixedInput = {
    runId,
    beneficiaryUserId: mixedId,
    chargeType: "PLAYER_ACTION" as const,
    actionClass: "CUSTOM_ACTION",
    amount: 2,
    idempotencyKey: `${tag}:action:mixed-sources`,
    requestHash: creditRequestHash({ runId, action: "mixed-sources" }),
    meteringMode: "ENFORCED" as const
  };
  const concurrent = await Promise.all([consumption.reserveCharge(mixedInput), consumption.reserveCharge(mixedInput)]);
  const mixedReserved = concurrent.find((entry) => entry.kind === "reserved") as any;
  expect(Boolean(mixedReserved?.charge?.id), "Concurrent identical reservations must create one authoritative charge");
  expect(concurrent.filter((entry) => ["reserved", "replay"].includes(entry.kind)).length === 2, "Concurrent duplicate must resolve as one reservation plus replay");
  const mixedGrantsReserved = await prisma.creditGrant.findMany({ where: { userId: mixedId }, orderBy: { createdAt: "asc" } });
  expect(mixedGrantsReserved.find((grant) => grant.kind === "BONUS")?.remainingAmount === 0, "Personal debit must consume Bonus first");
  expect(mixedGrantsReserved.find((grant) => grant.kind === "PURCHASED")?.remainingAmount === 3, "Personal debit must consume Purchased only after Bonus");
  await consumption.releaseCharge(mixedReserved.charge.id, "INTEGRATION_EXACT_REFUND");
  const mixedGrantsRestored = await prisma.creditGrant.findMany({ where: { userId: mixedId }, orderBy: { createdAt: "asc" } });
  expect(mixedGrantsRestored.find((grant) => grant.kind === "BONUS")?.remainingAmount === 1, "Release must restore the exact Bonus grant");
  expect(mixedGrantsRestored.find((grant) => grant.kind === "PURCHASED")?.remainingAmount === 4, "Release must restore the exact Purchased grant");

  const [otherRunScope, otherBeneficiaryScope] = await Promise.all([
    consumption.availableForRun(`${runId}_other`, playerId),
    consumption.availableForRun(runId, emptyId)
  ]);
  expect(otherRunScope.runAllowanceAvailable === 0, "Run allowance must not cross Run boundaries");
  expect(otherBeneficiaryScope.runAllowanceAvailable === 0, "Run allowance must not cross beneficiary boundaries");

  const [chargeCount, allowance, actionLedger, hostLedger] = await Promise.all([
    prisma.creditCharge.count({ where: { idempotencyKey: { startsWith: tag } } }),
    prisma.runCreditAllowance.findUnique({ where: { id: approved.allowance.id } }),
    prisma.creditLedger.findMany({ where: { userId: playerId, reason: "PLAYER_ACTION" } }),
    prisma.creditLedger.findMany({ where: { userId: hostId, reason: { in: ["RUN_CREATE", "RUN_SPONSORSHIP"] } } })
  ]);
  expect(chargeCount === 4, "Only run-create and the three tested action charges may exist");
  expect(allowance?.remainingAmount === 8, "Run allowance readback must equal 8");
  expect(actionLedger.length === 0, "Allowance-funded action must not create a personal wallet ledger entry");
  expect(hostLedger.length === 2, "Host must have traceable Run creation and sponsorship ledger rows");
  const [hostTransactions, playerTransactions] = await Promise.all([
    credits.listTransactions(hostId, 1, 20),
    credits.listTransactions(playerId, 1, 20)
  ]);
  const tracedRunCreate = hostTransactions.items.find((item: any) => item.reason === "RUN_CREATE") as any;
  const tracedSponsorship = hostTransactions.items.find((item: any) => item.reason === "RUN_SPONSORSHIP") as any;
  expect(tracedRunCreate?.trace?.charge?.id === runCreate.charge.id, "Run creation history must trace Ledger to CreditCharge");
  expect(tracedSponsorship?.trace?.allowance?.id === approved.allowance.id, "Sponsorship history must trace Ledger to Run allowance");
  expect(tracedSponsorship?.trace?.sponsorshipRequest?.id === request.id, "Sponsorship history must trace allowance to request");
  expect(playerTransactions.allowanceUsages.some((item: any) => item.trace?.charge?.id === committed.charge.id && item.allowanceDelta === -2), "Allowance-only action must appear in beneficiary transaction history");

  await sponsorships.expireForRun(runId);
  const expiredAllowance = await prisma.runCreditAllowance.findUnique({ where: { id: approved.allowance.id } });
  const afterRunExpiry = await consumption.availableForRun(runId, playerId);
  expect(expiredAllowance?.status === "EXPIRED", "Run completion cleanup must expire the allowance");
  expect(afterRunExpiry.runAllowanceAvailable === 0, "Expired allowance must not be spendable in its original Run");

  console.log(JSON.stringify({
    status: "PASS",
    runId,
    runCreate: { charged: 20, hostBalanceAfter: 30 },
    sponsorship: { hostCharged: 10, beneficiaryWallet: 5, allowanceFunded: 10 },
    action: { customCommitted: 2, allowanceRemaining: 8, releasedActionNet: 0 },
    personalSourceOrder: { bonusBeforePurchased: true, exactGrantRefund: true },
    scopeIsolation: { run: true, beneficiary: true, expiredAtRunEnd: true },
    idempotentReplay: true,
    insufficientCreatedNoCharge: true,
    transactionTrace: {
      runCreateChargeId: tracedRunCreate.trace.charge.id,
      sponsorshipAllowanceId: tracedSponsorship.trace.allowance.id,
      allowanceOnlyActionVisible: true
    }
  }, null, 2));
}

async function cleanup() {
  await prisma.creditChargeAllocation.deleteMany({ where: { charge: { idempotencyKey: { startsWith: tag } } } });
  await prisma.creditCharge.deleteMany({ where: { idempotencyKey: { startsWith: tag } } });
  await prisma.sponsorshipRequest.deleteMany({ where: { idempotencyKey: { startsWith: tag } } });
  await prisma.runCreditAllowance.deleteMany({ where: { idempotencyKey: { startsWith: `run-sponsor:${runId}:` } } });
  await prisma.storyRun.deleteMany({ where: { id: runId } });
  await prisma.creditLedger.deleteMany({ where: { userId: { in: [hostId, playerId, emptyId, mixedId] } } });
  await prisma.creditGrant.deleteMany({ where: { userId: { in: [hostId, playerId, emptyId, mixedId] } } });
  await prisma.creditWallet.deleteMany({ where: { userId: { in: [hostId, playerId, emptyId, mixedId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [hostId, playerId, emptyId, mixedId] } } });
  await prisma.worldTemplate.deleteMany({ where: { id: templateId } });
}

main()
  .finally(async () => {
    try { await cleanup(); }
    finally { await prisma.$disconnect(); }
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
