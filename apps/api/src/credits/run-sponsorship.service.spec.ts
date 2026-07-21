import assert from "node:assert/strict";
import test from "node:test";
import { RunSponsorshipService } from "./run-sponsorship.service";

const originalEnv = {
  policy: process.env.CREDIT_DEFAULT_POLICY,
  mode: process.env.CREDIT_ACTION_METERING_MODE,
  pack: process.env.CREDIT_RUN_SPONSORSHIP_AMOUNT
};
process.env.CREDIT_DEFAULT_POLICY = "active_action_v1";
process.env.CREDIT_ACTION_METERING_MODE = "ENFORCED";
process.env.CREDIT_RUN_SPONSORSHIP_AMOUNT = "10";

test.after(() => {
  restore("CREDIT_DEFAULT_POLICY", originalEnv.policy);
  restore("CREDIT_ACTION_METERING_MODE", originalEnv.mode);
  restore("CREDIT_RUN_SPONSORSHIP_AMOUNT", originalEnv.pack);
});

function harness() {
  const run = {
    id: "run-1",
    ownerUserId: "host-1",
    status: "playing",
    billingPolicyVersion: "active_action_v1",
    billingPriceJson: {
      currency: "WORLD_CREDITS",
      runCreate: 20,
      standardAction: 1,
      customAction: 2,
      complexAction: 2,
      sponsorshipPack: 10
    }
  };
  const requests = new Map<string, any>();
  const allowances = new Map<string, any>();
  const events: any[] = [];
  const spends: any[] = [];
  let sequence = 0;
  const tx: any = {
    storyRun: { findUnique: async ({ where }: any) => where.id === run.id ? run : null },
    storyPlayer: {
      findFirst: async ({ where }: any) => where.runId === run.id && ["host-1", "player-1"].includes(where.userId)
        ? { id: `player:${where.userId}`, status: "active" }
        : null
    },
    sponsorshipRequest: {
      findUnique: async ({ where }: any) => where.id
        ? requests.get(where.id) || null
        : [...requests.values()].find((entry) => where.idempotencyKey === entry.idempotencyKey || where.automaticPromptKey === entry.automaticPromptKey) || null,
      create: async ({ data }: any) => {
        const value = { id: `request-${++sequence}`, status: "PENDING", createdAt: new Date(), allowanceId: null, ...data };
        requests.set(value.id, value);
        return value;
      },
      update: async ({ where, data }: any) => {
        const value = { ...requests.get(where.id), ...data };
        requests.set(where.id, value);
        return value;
      },
      findMany: async () => [...requests.values()]
    },
    runCreditAllowance: {
      create: async ({ data }: any) => {
        const value = { id: `allowance-${allowances.size + 1}`, status: "ACTIVE", ...data };
        allowances.set(value.id, value);
        return value;
      },
      findUnique: async ({ where }: any) => allowances.get(where.id) || null
    },
    eventLog: { create: async ({ data }: any) => { events.push(data); return data; } }
  };
  const prisma: any = { ...tx, $transaction: async (operation: (db: any) => Promise<any>) => operation(tx) };
  const credits: any = {
    spendCredits: async (input: any) => {
      spends.push(input);
      return { id: `ledger-${spends.length}`, purchasedDelta: -input.amount, bonusDelta: 0 };
    }
  };
  const consumption: any = { availableForRun: async () => ({ available: 0, personalAvailable: 0, runAllowanceAvailable: 0 }) };
  return {
    service: new RunSponsorshipService(prisma, credits, consumption),
    requests,
    allowances,
    events,
    spends
  };
}

test("first insufficient sponsorship prompt is idempotent per run and player", async () => {
  const state = harness();
  const user: any = { id: "player-1", openid: "player-1" };
  const first = await state.service.createRequest(user, "run-1", { idempotencyKey: "sponsor-request-one", origin: "FIRST_INSUFFICIENT" });
  const replay = await state.service.createRequest(user, "run-1", { idempotencyKey: "sponsor-request-two", origin: "FIRST_INSUFFICIENT" });
  assert.equal(replay.id, first.id);
  assert.equal(state.requests.size, 1);
  assert.equal(state.events.filter((entry) => entry.eventName === "sponsorship_requested").length, 1);
});

test("host approval spends exactly 10 and creates run-only allowance without changing beneficiary wallet", async () => {
  const state = harness();
  const request = await state.service.createRequest(
    { id: "player-1", openid: "player-1" } as any,
    "run-1",
    { idempotencyKey: "sponsor-request-approve", origin: "MANUAL" }
  );
  const approved = await state.service.approve({ id: "host-1", openid: "host-1" } as any, "run-1", request.id);
  assert.equal(approved.alreadyApproved, false);
  assert.equal(state.spends.length, 1);
  assert.equal(state.spends[0].userId, "host-1");
  assert.equal(state.spends[0].amount, 10);
  assert.equal(state.spends[0].reason, "RUN_SPONSORSHIP");
  assert.equal(approved.allowance.beneficiaryUserId, "player-1");
  assert.equal(approved.allowance.remainingAmount, 10);

  const replay = await state.service.approve({ id: "host-1", openid: "host-1" } as any, "run-1", request.id);
  assert.equal(replay.alreadyApproved, true);
  assert.equal(state.spends.length, 1, "approval replay must not spend the host twice");
  assert.equal(state.allowances.size, 1);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
