import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";

type Tx = Prisma.TransactionClient;
type Db = PrismaService | Tx;

function asJson(value?: Record<string, unknown>): Prisma.InputJsonValue | undefined {
  return value ? JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue : undefined;
}

export interface GrantCreditsInput {
  userId: string;
  kind: "PURCHASED" | "BONUS";
  source: "SIGNUP" | "REFERRAL" | "PURCHASE" | "SYSTEM_REFUND" | "ADMIN";
  amount: number;
  reason: "SIGNUP_BONUS" | "REFERRAL_REWARD" | "PURCHASE" | "SYSTEM_REFUND" | "ADMIN_ADJUSTMENT";
  idempotencyKey: string;
  externalRef?: string;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
  tx?: Tx;
}

export type CreditSpendReason = "WORLD_UNLOCK" | "RUN_CREATE" | "PLAYER_ACTION" | "RUN_SPONSORSHIP";

@Injectable()
export class CreditsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getBalance(userId: string, tx?: Tx) {
    const db = (tx || this.prisma) as any;
    const wallet = await db.creditWallet.upsert({
      where: { userId },
      create: { userId },
      update: {}
    });
    return {
      purchased: wallet.purchasedBalance,
      bonus: wallet.bonusBalance,
      debt: wallet.debtBalance,
      available: wallet.purchasedBalance + wallet.bonusBalance
    };
  }

  async grantCredits(input: GrantCreditsInput) {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new BadRequestException({ code: "INVALID_CREDIT_AMOUNT", message: "Credit amount must be a positive integer" });
    }
    if (input.tx) return this.grantCreditsTx(input, input.tx);
    return this.prisma.$transaction((tx) => this.grantCreditsTx(input, tx));
  }

  private async grantCreditsTx(input: GrantCreditsInput, tx: Tx) {
    const existing = await tx.creditLedger.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;

    await tx.creditWallet.upsert({ where: { userId: input.userId }, create: { userId: input.userId }, update: {} });
    const grant = await tx.creditGrant.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        source: input.source,
        originalAmount: input.amount,
        remainingAmount: input.amount,
        expiresAt: input.expiresAt ?? null,
        idempotencyKey: input.idempotencyKey,
        externalRef: input.externalRef,
        metadataJson: asJson(input.metadata)
      }
    });
    const ledger = await tx.creditLedger.create({
      data: {
        userId: input.userId,
        reason: input.reason,
        purchasedDelta: input.kind === "PURCHASED" ? input.amount : 0,
        bonusDelta: input.kind === "BONUS" ? input.amount : 0,
        idempotencyKey: input.idempotencyKey,
        externalRef: input.externalRef,
        metadataJson: { ...(input.metadata || {}), grantId: grant.id }
      }
    });
    await tx.creditWallet.update({
      where: { userId: input.userId },
      data: {
        purchasedBalance: input.kind === "PURCHASED" ? { increment: input.amount } : undefined,
        bonusBalance: input.kind === "BONUS" ? { increment: input.amount } : undefined,
        version: { increment: 1 }
      }
    });
    return ledger;
  }

  async spendCredits(input: {
    userId: string;
    amount: number;
    reason: CreditSpendReason;
    idempotencyKey: string;
    externalRef?: string;
    metadata?: Record<string, unknown>;
    tx?: Tx;
  }) {
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw new BadRequestException({ code: "INVALID_CREDIT_AMOUNT", message: "Credit amount must be positive" });
    if (input.tx) return this.spendCreditsTx(input, input.tx);
    return this.prisma.$transaction((tx) => this.spendCreditsTx(input, tx), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async spendCreditsTx(input: Parameters<CreditsService["spendCredits"]>[0], tx: Tx) {
    const existing = await tx.creditLedger.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;

    const now = new Date();
    const grants = [
      ...(await tx.creditGrant.findMany({ where: { userId: input.userId, kind: "BONUS", remainingAmount: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }] })),
      ...(await tx.creditGrant.findMany({ where: { userId: input.userId, kind: "PURCHASED", remainingAmount: { gt: 0 } }, orderBy: { createdAt: "asc" } }))
    ];
    const available = grants.reduce((sum, grant) => sum + grant.remainingAmount, 0);
    if (available < input.amount) {
      throw new BadRequestException({ code: "INSUFFICIENT_CREDITS", message: "Not enough World Credits", details: { required: input.amount, available } });
    }

    let remaining = input.amount;
    const allocations: Array<{ grantId: string; amount: number; kind: "BONUS" | "PURCHASED" }> = [];
    for (const grant of grants) {
      if (remaining <= 0) break;
      const amount = Math.min(remaining, grant.remainingAmount);
      allocations.push({ grantId: grant.id, amount, kind: grant.kind });
      remaining -= amount;
    }
    const bonusSpent = allocations.filter((item) => item.kind === "BONUS").reduce((sum, item) => sum + item.amount, 0);
    const purchasedSpent = input.amount - bonusSpent;
    const ledger = await tx.creditLedger.create({
      data: {
        userId: input.userId,
        reason: input.reason,
        purchasedDelta: -purchasedSpent,
        bonusDelta: -bonusSpent,
        idempotencyKey: input.idempotencyKey,
        externalRef: input.externalRef,
        metadataJson: asJson(input.metadata)
      }
    });
    for (const allocation of allocations) {
      await tx.creditGrant.update({ where: { id: allocation.grantId }, data: { remainingAmount: { decrement: allocation.amount } } });
      await tx.creditSpendAllocation.create({ data: { ledgerId: ledger.id, grantId: allocation.grantId, amount: allocation.amount } });
    }
    await tx.creditWallet.update({
      where: { userId: input.userId },
      data: { purchasedBalance: { decrement: purchasedSpent }, bonusBalance: { decrement: bonusSpent }, version: { increment: 1 } }
    });
    return ledger;
  }

  async refundSpend(input: { originalLedgerId: string; idempotencyKey: string; reason: "SYSTEM_REFUND"; externalRef?: string; tx?: Tx }) {
    if (input.tx) return this.refundSpendTx(input, input.tx);
    return this.prisma.$transaction((tx) => this.refundSpendTx(input, tx));
  }

  private async refundSpendTx(input: Parameters<CreditsService["refundSpend"]>[0], tx: Tx) {
      const existing = await tx.creditLedger.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return existing;
      const original = await tx.creditLedger.findUniqueOrThrow({ where: { id: input.originalLedgerId }, include: { allocations: { include: { grant: true } } } });
      let purchased = 0;
      let bonus = 0;
      for (const allocation of original.allocations) {
        await tx.creditGrant.update({ where: { id: allocation.grantId }, data: { remainingAmount: { increment: allocation.amount } } });
        if (allocation.grant.kind === "BONUS") bonus += allocation.amount;
        else purchased += allocation.amount;
      }
      const ledger = await tx.creditLedger.create({
        data: { userId: original.userId, reason: input.reason, purchasedDelta: purchased, bonusDelta: bonus, idempotencyKey: input.idempotencyKey, externalRef: input.externalRef || input.originalLedgerId }
      });
      await tx.creditWallet.update({ where: { userId: original.userId }, data: { purchasedBalance: { increment: purchased }, bonusBalance: { increment: bonus }, version: { increment: 1 } } });
      return ledger;
  }

  async listTransactions(userId: string, page = 1, pageSize = 30) {
    const safePage = Math.max(1, Math.floor(page));
    const safeSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const [ledgers, total, allowanceUsages] = await Promise.all([
      this.prisma.creditLedger.findMany({
        where: { userId },
        include: { allocations: { include: { grant: { select: { id: true, kind: true, source: true, expiresAt: true } } } } },
        orderBy: { createdAt: "desc" },
        skip: (safePage - 1) * safeSize,
        take: safeSize
      }),
      this.prisma.creditLedger.count({ where: { userId } }),
      (this.prisma as any).creditCharge.findMany({
        where: { beneficiaryUserId: userId, allowanceAmount: { gt: 0 }, personalDebitLedgerId: null },
        include: { allocations: true },
        orderBy: { createdAt: "desc" },
        take: safeSize
      })
    ]);
    const ledgerIds = ledgers.map((ledger) => ledger.id);
    const [charges, allowances] = ledgerIds.length ? await Promise.all([
      (this.prisma as any).creditCharge.findMany({
        where: {
          OR: [
            { personalDebitLedgerId: { in: ledgerIds } },
            { personalRefundLedgerId: { in: ledgerIds } }
          ]
        },
        include: { allocations: true }
      }),
      (this.prisma as any).runCreditAllowance.findMany({
        where: { fundingLedgerId: { in: ledgerIds } }
      })
    ]) : [[], []];
    const allowanceIds = allowances.map((allowance: any) => allowance.id);
    const requests = allowanceIds.length
      ? await (this.prisma as any).sponsorshipRequest.findMany({ where: { allowanceId: { in: allowanceIds } } })
      : [];
    const chargeByLedgerId = new Map<string, any>();
    for (const charge of charges) {
      if (charge.personalDebitLedgerId) chargeByLedgerId.set(charge.personalDebitLedgerId, charge);
      if (charge.personalRefundLedgerId) chargeByLedgerId.set(charge.personalRefundLedgerId, charge);
    }
    const allowanceByLedgerId = new Map<string, any>(allowances.map((allowance: any) => [allowance.fundingLedgerId, allowance]));
    const requestByAllowanceId = new Map<string, any>(requests.map((request: any) => [request.allowanceId, request]));
    const items = ledgers.map((ledger) => {
      const charge = chargeByLedgerId.get(ledger.id) || null;
      const allowance = allowanceByLedgerId.get(ledger.id) || null;
      const request = allowance ? requestByAllowanceId.get(allowance.id) || null : null;
      return {
        ...ledger,
        trace: {
          schemaVersion: "credit_trace_v1",
          ledgerId: ledger.id,
          runId: charge?.runId || allowance?.runId || metadataString(ledger.metadataJson, "runId"),
          actionId: charge?.playerActionId || null,
          charge: charge ? publicChargeTrace(charge) : null,
          grantAllocations: ledger.allocations.map((allocation) => ({
            grantId: allocation.grantId,
            amount: allocation.amount,
            kind: allocation.grant.kind,
            source: allocation.grant.source,
            expiresAt: allocation.grant.expiresAt
          })),
          allowance: allowance ? publicAllowanceTrace(allowance) : null,
          sponsorshipRequest: request ? {
            id: request.id,
            status: request.status,
            origin: request.origin,
            allowanceId: request.allowanceId
          } : null
        }
      };
    });
    return {
      items,
      allowanceUsages: allowanceUsages.map((charge: any) => ({
        id: `allowance-usage:${charge.id}`,
        reason: "RUN_ALLOWANCE_USAGE",
        createdAt: charge.createdAt,
        allowanceDelta: charge.status === "RELEASED" ? 0 : -charge.allowanceAmount,
        trace: {
          schemaVersion: "credit_trace_v1",
          runId: charge.runId,
          actionId: charge.playerActionId,
          charge: publicChargeTrace(charge)
        }
      })),
      page: safePage,
      pageSize: safeSize,
      total
    };
  }
}

function metadataString(value: Prisma.JsonValue | null, key: string) {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const candidate = (value as Record<string, Prisma.JsonValue>)[key];
  return typeof candidate === "string" ? candidate : null;
}

function publicChargeTrace(charge: any) {
  return {
    id: charge.id,
    type: charge.chargeType,
    actionClass: charge.actionClass,
    status: charge.status,
    amount: charge.amount,
    allowanceAmount: charge.allowanceAmount,
    walletAmount: charge.walletAmount,
    runId: charge.runId,
    playerActionId: charge.playerActionId,
    failureCode: charge.failureCode,
    allocations: Array.isArray(charge.allocations) ? charge.allocations.map((allocation: any) => ({
      id: allocation.id,
      source: allocation.source,
      allowanceId: allocation.allowanceId,
      ledgerId: allocation.ledgerId,
      amount: allocation.amount,
      status: allocation.status
    })) : []
  };
}

function publicAllowanceTrace(allowance: any) {
  return {
    id: allowance.id,
    runId: allowance.runId,
    sponsorUserId: allowance.sponsorUserId,
    beneficiaryUserId: allowance.beneficiaryUserId,
    fundedAmount: allowance.fundedAmount,
    remainingAmount: allowance.remainingAmount,
    status: allowance.status,
    fundingLedgerId: allowance.fundingLedgerId
  };
}
