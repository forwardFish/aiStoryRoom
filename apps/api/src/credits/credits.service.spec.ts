import assert from "node:assert/strict";
import test from "node:test";
import { CreditsService } from "./credits.service";

test("personal spending uses Bonus before Purchased and refund restores the exact grants", async () => {
  const grants = [
    { id: "bonus-1", userId: "player-1", kind: "BONUS", remainingAmount: 1, expiresAt: null, createdAt: new Date("2026-01-01") },
    { id: "purchased-1", userId: "player-1", kind: "PURCHASED", remainingAmount: 4, expiresAt: null, createdAt: new Date("2026-01-02") }
  ];
  const ledgers = new Map<string, any>();
  const allocations: any[] = [];
  const wallet = { purchasedBalance: 4, bonusBalance: 1 };
  let ledgerSequence = 0;
  const tx: any = {
    creditLedger: {
      findUnique: async ({ where }: any) => where.idempotencyKey
        ? [...ledgers.values()].find((entry) => entry.idempotencyKey === where.idempotencyKey) || null
        : ledgers.get(where.id) || null,
      findUniqueOrThrow: async ({ where }: any) => {
        const ledger = ledgers.get(where.id);
        if (!ledger) throw new Error("ledger missing");
        return { ...ledger, allocations: allocations.filter((entry) => entry.ledgerId === ledger.id).map((entry) => ({ ...entry, grant: grants.find((grant) => grant.id === entry.grantId) })) };
      },
      create: async ({ data }: any) => {
        const ledger = { id: `ledger-${++ledgerSequence}`, ...data };
        ledgers.set(ledger.id, ledger);
        return ledger;
      }
    },
    creditGrant: {
      findMany: async ({ where }: any) => grants.filter((grant) => grant.userId === where.userId && grant.kind === where.kind && grant.remainingAmount > 0),
      update: async ({ where, data }: any) => {
        const grant = grants.find((entry) => entry.id === where.id)!;
        grant.remainingAmount += Number(data.remainingAmount.increment || 0) - Number(data.remainingAmount.decrement || 0);
        return grant;
      }
    },
    creditSpendAllocation: {
      create: async ({ data }: any) => { allocations.push(data); return data; }
    },
    creditWallet: {
      update: async ({ data }: any) => {
        wallet.purchasedBalance += Number(data.purchasedBalance.increment || 0) - Number(data.purchasedBalance.decrement || 0);
        wallet.bonusBalance += Number(data.bonusBalance.increment || 0) - Number(data.bonusBalance.decrement || 0);
        return wallet;
      }
    }
  };
  const service = new CreditsService({ $transaction: async (operation: any) => operation(tx) } as any);

  const debit = await service.spendCredits({
    userId: "player-1",
    amount: 2,
    reason: "PLAYER_ACTION",
    idempotencyKey: "spend-bonus-before-purchased"
  });

  assert.deepEqual({ bonusDelta: debit.bonusDelta, purchasedDelta: debit.purchasedDelta }, { bonusDelta: -1, purchasedDelta: -1 });
  assert.deepEqual(grants.map((grant) => [grant.id, grant.remainingAmount]), [["bonus-1", 0], ["purchased-1", 3]]);
  assert.deepEqual(wallet, { purchasedBalance: 3, bonusBalance: 0 });
  assert.deepEqual(allocations.map((entry) => [entry.grantId, entry.amount]), [["bonus-1", 1], ["purchased-1", 1]]);

  const refund = await service.refundSpend({
    originalLedgerId: debit.id,
    idempotencyKey: "refund-exact-spend",
    reason: "SYSTEM_REFUND"
  });

  assert.deepEqual({ bonusDelta: refund.bonusDelta, purchasedDelta: refund.purchasedDelta }, { bonusDelta: 1, purchasedDelta: 1 });
  assert.deepEqual(grants.map((grant) => [grant.id, grant.remainingAmount]), [["bonus-1", 1], ["purchased-1", 4]]);
  assert.deepEqual(wallet, { purchasedBalance: 4, bonusBalance: 1 });
});
