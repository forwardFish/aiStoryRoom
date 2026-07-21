import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { readCreditConsumptionConfig, type CreditMeteringMode } from "../config/credit-consumption.config";
import { PrismaService } from "../prisma.service";
import { CreditsService, type CreditSpendReason } from "./credits.service";
import { operationalMetrics } from "../observability/operational-metrics";

type Tx = Prisma.TransactionClient;

export type ReserveCreditChargeInput = {
  runId?: string | null;
  beneficiaryUserId: string;
  playerActionId?: string | null;
  chargeType: "RUN_CREATE" | "PLAYER_ACTION";
  actionClass: string;
  amount: number;
  idempotencyKey: string;
  requestHash: string;
  metadata?: Record<string, unknown>;
  expiresAt?: Date | null;
  meteringMode?: CreditMeteringMode;
  tx?: Tx;
};

export type ReservedCreditCharge = {
  kind: "reserved" | "shadow" | "replay";
  charge: any;
  required: number;
  availableBefore: number;
};

export type InsufficientCreditCharge = {
  kind: "insufficient";
  required: number;
  available: number;
  runAllowanceAvailable: number;
  personalAvailable: number;
};

export type DisabledCreditCharge = { kind: "off"; required: number; available: null; charge: null };
export type ReserveCreditChargeResult = ReservedCreditCharge | InsufficientCreditCharge | DisabledCreditCharge;

class CreditReservationRaceError extends Error {
  readonly code = "CREDIT_RESERVATION_RACE";
}

@Injectable()
export class CreditConsumptionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CreditsService) private readonly credits: CreditsService
  ) {}

  async reserveCharge(input: ReserveCreditChargeInput): Promise<ReserveCreditChargeResult> {
    validateReserveInput(input);
    if (input.tx) return this.reserveChargeTx(input, input.tx);
    return this.retrySerializable((tx) => this.reserveChargeTx(input, tx));
  }

  private async reserveChargeTx(input: ReserveCreditChargeInput, tx: Tx): Promise<ReserveCreditChargeResult> {
    const db = tx as any;
    const existing = await db.creditCharge.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.requestHash !== input.requestHash) {
        throw new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED", message: "The idempotency key was already used with a different credit request" });
      }
      return { kind: "replay", charge: existing, required: existing.amount, availableBefore: existing.amount };
    }

    const mode = input.meteringMode || readCreditConsumptionConfig().meteringMode;
    if (mode === "OFF") return { kind: "off", required: input.amount, available: null, charge: null };
    if (mode === "SHADOW") {
      const charge = await db.creditCharge.create({
        data: chargeData(input, { status: "SHADOW", allowanceAmount: 0, walletAmount: 0 })
      });
      operationalMetrics.charge({
        type: charge.chargeType,
        actionClass: charge.actionClass,
        status: charge.status,
        policy: metricPolicy(charge)
      });
      return { kind: "shadow", charge, required: input.amount, availableBefore: 0 };
    }

    const now = new Date();
    const allowances = input.runId && input.chargeType === "PLAYER_ACTION"
      ? await db.runCreditAllowance.findMany({
        where: {
          runId: input.runId,
          beneficiaryUserId: input.beneficiaryUserId,
          status: "ACTIVE",
          remainingAmount: { gt: 0 },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      })
      : [];
    const runAllowanceAvailable = allowances.reduce((sum: number, allowance: any) => sum + allowance.remainingAmount, 0);
    const personal = await this.credits.getBalance(input.beneficiaryUserId, tx);
    const personalAvailable = personal.available;
    const available = runAllowanceAvailable + personalAvailable;
    if (available < input.amount) {
      operationalMetrics.insufficient(String(input.metadata?.engine || "unknown"), input.actionClass);
      return { kind: "insufficient", required: input.amount, available, runAllowanceAvailable, personalAvailable };
    }

    let remaining = input.amount;
    const allowanceAllocations: Array<{ allowanceId: string; amount: number }> = [];
    for (const allowance of allowances) {
      if (remaining <= 0) break;
      const amount = Math.min(remaining, allowance.remainingAmount);
      const updated = await db.runCreditAllowance.updateMany({
        where: { id: allowance.id, status: "ACTIVE", remainingAmount: { gte: amount } },
        data: {
          remainingAmount: { decrement: amount },
          status: allowance.remainingAmount === amount ? "EXHAUSTED" : "ACTIVE"
        }
      });
      if (updated.count !== 1) throw new CreditReservationRaceError("Allowance changed while reserving credits");
      allowanceAllocations.push({ allowanceId: allowance.id, amount });
      remaining -= amount;
    }

    const reason: CreditSpendReason = input.chargeType === "RUN_CREATE" ? "RUN_CREATE" : "PLAYER_ACTION";
    const debitLedger = remaining > 0
      ? await this.credits.spendCredits({
        userId: input.beneficiaryUserId,
        amount: remaining,
        reason,
        idempotencyKey: `charge-debit:${input.idempotencyKey}`,
        externalRef: input.idempotencyKey,
        metadata: { ...(input.metadata || {}), creditChargeIdempotencyKey: input.idempotencyKey },
        tx
      })
      : null;

    const allowanceAmount = allowanceAllocations.reduce((sum, allocation) => sum + allocation.amount, 0);
    const charge = await db.creditCharge.create({
      data: chargeData(input, {
        status: "RESERVED",
        allowanceAmount,
        walletAmount: remaining,
        personalDebitLedgerId: debitLedger?.id || null
      })
    });
    if (allowanceAllocations.length) {
      await db.creditChargeAllocation.createMany({
        data: allowanceAllocations.map((allocation) => ({
          allocationKey: `${charge.id}:RUN_ALLOWANCE:${allocation.allowanceId}`,
          chargeId: charge.id,
          source: "RUN_ALLOWANCE",
          allowanceId: allocation.allowanceId,
          amount: allocation.amount,
          status: "RESERVED"
        }))
      });
    }
    if (debitLedger) {
      await db.creditChargeAllocation.create({
        data: {
          allocationKey: `${charge.id}:PERSONAL_WALLET:${debitLedger.id}`,
          chargeId: charge.id,
          source: "PERSONAL_WALLET",
          ledgerId: debitLedger.id,
          amount: remaining,
          status: "RESERVED"
        }
      });
    }
    operationalMetrics.charge({
      type: charge.chargeType,
      actionClass: charge.actionClass,
      status: charge.status,
      policy: metricPolicy(charge),
      allowanceAmount: charge.allowanceAmount,
      walletAmount: charge.walletAmount
    });
    return { kind: "reserved", charge, required: input.amount, availableBefore: available };
  }

  async attachPlayerAction(chargeId: string, playerActionId: string, tx?: Tx) {
    const operation = async (db: Tx) => {
      const charge = await (db as any).creditCharge.findUnique({ where: { id: chargeId } });
      if (!charge) throw new NotFoundException({ code: "CREDIT_CHARGE_NOT_FOUND", message: "Credit charge not found" });
      if (charge.playerActionId && charge.playerActionId !== playerActionId) {
        throw new ConflictException({ code: "CREDIT_CHARGE_ACTION_MISMATCH", message: "Credit charge is already linked to another action" });
      }
      return (db as any).creditCharge.update({ where: { id: chargeId }, data: { playerActionId } });
    };
    return tx ? operation(tx) : this.prisma.$transaction(operation);
  }

  async commitCharge(chargeId: string, tx?: Tx) {
    const operation = async (db: Tx) => {
      const charge = await (db as any).creditCharge.findUnique({ where: { id: chargeId } });
      if (!charge) throw new NotFoundException({ code: "CREDIT_CHARGE_NOT_FOUND", message: "Credit charge not found" });
      if (charge.status === "COMMITTED" || charge.status === "SHADOW") return charge;
      if (charge.status === "RELEASED") throw new ConflictException({ code: "CREDIT_CHARGE_ALREADY_RELEASED", message: "Released credits cannot be committed" });
      await (db as any).creditChargeAllocation.updateMany({ where: { chargeId, status: "RESERVED" }, data: { status: "COMMITTED" } });
      const committed = await (db as any).creditCharge.update({ where: { id: chargeId }, data: { status: "COMMITTED", committedAt: new Date(), expiresAt: null } });
      operationalMetrics.charge({
        type: committed.chargeType,
        actionClass: committed.actionClass,
        status: committed.status,
        policy: metricPolicy(committed),
        allowanceAmount: committed.allowanceAmount,
        walletAmount: committed.walletAmount
      });
      return committed;
    };
    return tx ? operation(tx) : this.retrySerializable(operation);
  }

  async releaseCharge(chargeId: string, failureCode: string, tx?: Tx) {
    const operation = async (db: Tx) => {
      const database = db as any;
      const charge = await database.creditCharge.findUnique({ where: { id: chargeId } });
      if (!charge) throw new NotFoundException({ code: "CREDIT_CHARGE_NOT_FOUND", message: "Credit charge not found" });
      if (charge.status === "RELEASED" || charge.status === "SHADOW") return charge;
      if (charge.status === "COMMITTED") throw new ConflictException({ code: "CREDIT_CHARGE_ALREADY_COMMITTED", message: "Committed credits cannot be released" });

      const allowanceAllocations = await database.creditChargeAllocation.findMany({
        where: { chargeId, source: "RUN_ALLOWANCE", status: "RESERVED" }
      });
      for (const allocation of allowanceAllocations) {
        const allowance = await database.runCreditAllowance.findUnique({ where: { id: allocation.allowanceId } });
        if (!allowance) throw new Error(`Missing allowance ${allocation.allowanceId} for charge ${chargeId}`);
        await database.runCreditAllowance.update({
          where: { id: allowance.id },
          data: {
            remainingAmount: { increment: allocation.amount },
            status: allowance.status === "EXPIRED" ? "EXPIRED" : "ACTIVE"
          }
        });
      }

      let refundLedger: any = null;
      if (charge.personalDebitLedgerId) {
        refundLedger = await this.credits.refundSpend({
          originalLedgerId: charge.personalDebitLedgerId,
          idempotencyKey: `charge-release:${charge.id}`,
          reason: "SYSTEM_REFUND",
          externalRef: charge.id,
          tx: db
        });
      }
      await database.creditChargeAllocation.updateMany({ where: { chargeId, status: "RESERVED" }, data: { status: "RELEASED" } });
      const released = await database.creditCharge.update({
        where: { id: chargeId },
        data: {
          status: "RELEASED",
          failureCode,
          personalRefundLedgerId: refundLedger?.id || null,
          releasedAt: new Date(),
          expiresAt: null
        }
      });
      operationalMetrics.charge({
        type: released.chargeType,
        actionClass: released.actionClass,
        status: released.status,
        policy: metricPolicy(released),
        allowanceAmount: released.allowanceAmount,
        walletAmount: released.walletAmount
      });
      operationalMetrics.increment("credit_charge_release_total", { reason: failureCode });
      return released;
    };
    return tx ? operation(tx) : this.retrySerializable(operation);
  }

  async availableForRun(runId: string, userId: string, tx?: Tx) {
    const operation = async (db: Tx) => {
      const now = new Date();
      const allowances = await (db as any).runCreditAllowance.aggregate({
        where: { runId, beneficiaryUserId: userId, status: "ACTIVE", remainingAmount: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        _sum: { remainingAmount: true }
      });
      const personal = await this.credits.getBalance(userId, db);
      const runAllowanceAvailable = Number(allowances._sum.remainingAmount || 0);
      return { available: runAllowanceAvailable + personal.available, runAllowanceAvailable, personalAvailable: personal.available, personal };
    };
    return tx ? operation(tx) : this.prisma.$transaction(operation);
  }

  async findByIdempotencyKey(idempotencyKey: string, tx?: Tx) {
    const db = (tx || this.prisma) as any;
    return db.creditCharge.findUnique({ where: { idempotencyKey }, include: { allocations: true } });
  }

  private async retrySerializable<T>(operation: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000
        });
      } catch (error: any) {
        if (!isRetryableTransactionError(error) || attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1) ** 2));
      }
    }
    throw new Error("unreachable credit transaction retry state");
  }
}

function chargeData(input: ReserveCreditChargeInput, state: Record<string, unknown>) {
  return {
    runId: input.runId || null,
    beneficiaryUserId: input.beneficiaryUserId,
    playerActionId: input.playerActionId || null,
    chargeType: input.chargeType,
    actionClass: input.actionClass,
    amount: input.amount,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    expiresAt: input.expiresAt || null,
    metadataJson: input.metadata ? JSON.parse(JSON.stringify(input.metadata)) : undefined,
    ...state
  };
}

function validateReserveInput(input: ReserveCreditChargeInput) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error("CREDIT_CHARGE_AMOUNT_INVALID");
  if (!input.beneficiaryUserId.trim()) throw new Error("CREDIT_CHARGE_BENEFICIARY_REQUIRED");
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 240) throw new Error("CREDIT_CHARGE_IDEMPOTENCY_KEY_INVALID");
  if (!/^[a-f0-9]{64}$/i.test(input.requestHash)) throw new Error("CREDIT_CHARGE_REQUEST_HASH_INVALID");
}

function isRetryableTransactionError(error: any) {
  const message = String(error?.message || error || "");
  return error instanceof CreditReservationRaceError
    || error?.code === "P2034"
    || error?.code === "P2028"
    || error?.code === "P2002"
    || /40P01|40001|deadlock detected|write conflict|unable to start a transaction/i.test(message);
}

function metricPolicy(charge: any) {
  const metadata = charge?.metadataJson && typeof charge.metadataJson === "object" ? charge.metadataJson : {};
  return String(metadata.policyVersion || "active_action_v1");
}
