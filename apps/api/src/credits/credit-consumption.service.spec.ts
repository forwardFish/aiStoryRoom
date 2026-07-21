import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
import { creditRequestHash } from "./credit-policy";
import { CreditConsumptionService } from "./credit-consumption.service";

function harness(input: { personal?: number; allowance?: number } = {}) {
  let personal = input.personal ?? 5;
  let chargeSequence = 0;
  const charges = new Map<string, any>();
  const allocations: any[] = [];
  const allowance = {
    id: "allowance-1", runId: "run-1", beneficiaryUserId: "player-1", sponsorUserId: "host-1",
    status: "ACTIVE", remainingAmount: input.allowance ?? 0, createdAt: new Date("2026-01-01"), expiresAt: null
  };
  const tx: any = {
    creditCharge: {
      findUnique: async ({ where }: any) => where.idempotencyKey
        ? [...charges.values()].find((charge) => charge.idempotencyKey === where.idempotencyKey) || null
        : charges.get(where.id) || null,
      create: async ({ data }: any) => {
        const charge = { id: `charge-${++chargeSequence}`, ...data };
        charges.set(charge.id, charge);
        return charge;
      },
      update: async ({ where, data }: any) => {
        const current = charges.get(where.id);
        const updated = { ...current, ...data };
        charges.set(where.id, updated);
        return updated;
      }
    },
    runCreditAllowance: {
      findMany: async () => allowance.remainingAmount > 0 && allowance.status === "ACTIVE" ? [{ ...allowance }] : [],
      updateMany: async ({ where, data }: any) => {
        if (allowance.id !== where.id || allowance.status !== where.status || allowance.remainingAmount < where.remainingAmount.gte) return { count: 0 };
        allowance.remainingAmount -= data.remainingAmount.decrement;
        allowance.status = data.status;
        return { count: 1 };
      },
      findUnique: async ({ where }: any) => where.id === allowance.id ? { ...allowance } : null,
      update: async ({ data }: any) => {
        allowance.remainingAmount += data.remainingAmount.increment || 0;
        allowance.status = data.status;
        return { ...allowance };
      },
      aggregate: async () => ({ _sum: { remainingAmount: allowance.status === "ACTIVE" ? allowance.remainingAmount : 0 } })
    },
    creditChargeAllocation: {
      createMany: async ({ data }: any) => { allocations.push(...data); return { count: data.length }; },
      create: async ({ data }: any) => { allocations.push(data); return data; },
      findMany: async ({ where }: any) => allocations.filter((item) => item.chargeId === where.chargeId && item.source === where.source && item.status === where.status),
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const item of allocations) if (item.chargeId === where.chargeId && item.status === where.status) { item.status = data.status; count += 1; }
        return { count };
      }
    }
  };
  const prisma = { ...tx, $transaction: async (operation: (db: any) => Promise<any>) => operation(tx) };
  const credits = {
    getBalance: async () => ({ purchased: 0, bonus: personal, debt: 0, available: personal }),
    spendCredits: async ({ amount }: any) => { personal -= amount; return { id: "debit-1" }; },
    refundSpend: async () => { personal += 1; return { id: "refund-1" }; }
  };
  const service = new CreditConsumptionService(prisma as never, credits as never);
  return { service, charges, allocations, allowance, personal: () => personal };
}

const baseInput = {
  runId: "run-1",
  beneficiaryUserId: "player-1",
  chargeType: "PLAYER_ACTION" as const,
  actionClass: "CUSTOM_ACTION",
  amount: 2,
  idempotencyKey: "player-action:run-1:player-1:action-1",
  requestHash: creditRequestHash({ action: "search" }),
  meteringMode: "ENFORCED" as const
};

test("reservation spends allowance before personal credits and release restores exact sources", async () => {
  const state = harness({ allowance: 1, personal: 5 });
  const reserved = await state.service.reserveCharge(baseInput);
  assert.equal(reserved.kind, "reserved");
  assert.equal(state.allowance.remainingAmount, 0);
  assert.equal(state.personal(), 4);
  assert.deepEqual(state.allocations.map((item) => [item.source, item.amount]), [["RUN_ALLOWANCE", 1], ["PERSONAL_WALLET", 1]]);

  const replay = await state.service.reserveCharge(baseInput);
  assert.equal(replay.kind, "replay");
  assert.equal(state.personal(), 4, "idempotent replay must not spend again");

  await state.service.releaseCharge((reserved as any).charge.id, "QUALITY_REJECTED");
  assert.equal(state.allowance.remainingAmount, 1);
  assert.equal(state.personal(), 5);
  assert.equal((await state.service.findByIdempotencyKey(baseInput.idempotencyKey))?.status, "RELEASED");
});

test("insufficient total credits leave every source unchanged", async () => {
  const state = harness({ allowance: 1, personal: 0 });
  const result = await state.service.reserveCharge(baseInput);
  assert.deepEqual(result, { kind: "insufficient", required: 2, available: 1, runAllowanceAvailable: 1, personalAvailable: 0 });
  assert.equal(state.allowance.remainingAmount, 1);
  assert.equal(state.personal(), 0);
  assert.equal(state.charges.size, 0);
});

test("same idempotency key with a different request hash is rejected", async () => {
  const state = harness({ allowance: 2, personal: 0 });
  await state.service.reserveCharge(baseInput);
  await assert.rejects(
    () => state.service.reserveCharge({ ...baseInput, requestHash: creditRequestHash({ action: "bribe" }) }),
    (error: unknown) => error instanceof ConflictException
  );
});

test("committed charges cannot later be released", async () => {
  const state = harness({ allowance: 2, personal: 0 });
  const reserved = await state.service.reserveCharge(baseInput) as any;
  await state.service.commitCharge(reserved.charge.id);
  await assert.rejects(() => state.service.releaseCharge(reserved.charge.id, "LATE_FAILURE"), /Committed credits cannot be released/);
  assert.equal(state.allowance.remainingAmount, 0);
});

test("OFF and SHADOW provide a no-debit rollback path for new business actions", async () => {
  const off = harness({ allowance: 2, personal: 5 });
  const offResult = await off.service.reserveCharge({ ...baseInput, meteringMode: "OFF" });
  assert.equal(offResult.kind, "off");
  assert.equal(off.allowance.remainingAmount, 2);
  assert.equal(off.personal(), 5);
  assert.equal(off.charges.size, 0);

  const shadow = harness({ allowance: 2, personal: 5 });
  const shadowResult = await shadow.service.reserveCharge({ ...baseInput, meteringMode: "SHADOW" }) as any;
  assert.equal(shadowResult.kind, "shadow");
  assert.equal(shadowResult.charge.status, "SHADOW");
  assert.equal(shadow.allowance.remainingAmount, 2);
  assert.equal(shadow.personal(), 5);
  assert.equal(shadow.charges.size, 1);
  assert.equal((await shadow.service.commitCharge(shadowResult.charge.id)).status, "SHADOW");
  assert.equal((await shadow.service.releaseCharge(shadowResult.charge.id, "ROLLBACK_DRILL")).status, "SHADOW");
});
