import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { CreemWebhookService } from "./creem-webhook.service";

const originalEnvironment = {
  mode: process.env.CREEM_MODE,
  nodeEnv: process.env.NODE_ENV,
  product300: process.env.CREEM_PRODUCT_300_ID
};

before(() => {
  process.env.NODE_ENV = "test";
  process.env.CREEM_MODE = "test";
  process.env.CREEM_PRODUCT_300_ID = "prod_test_300";
});

after(() => {
  if (originalEnvironment.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnvironment.nodeEnv;
  if (originalEnvironment.mode === undefined) delete process.env.CREEM_MODE;
  else process.env.CREEM_MODE = originalEnvironment.mode;
  if (originalEnvironment.product300 === undefined) delete process.env.CREEM_PRODUCT_300_ID;
  else process.env.CREEM_PRODUCT_300_ID = originalEnvironment.product300;
});

function checkoutEvent(overrides: Record<string, unknown> = {}) {
  const object = {
    id: "ch_test_300",
    object: "checkout",
    request_id: "many-worlds-purchase_300",
    status: "completed",
    mode: "test",
    metadata: { purchaseId: "purchase_300", userId: "user_1" },
    product: { id: "prod_test_300", mode: "test" },
    order: {
      id: "ord_test_300",
      product: "prod_test_300",
      transaction: "tran_test_300",
      amount: 799,
      amount_paid: 899,
      currency: "USD",
      status: "paid",
      mode: "test"
    },
    customer: { id: "cust_test", email: "buyer@example.test", mode: "test" },
    ...overrides
  };
  return { id: "evt_checkout_300", eventType: "checkout.completed", object };
}

function refundEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_refund_300",
    eventType: "refund.created",
    object: {
      id: "ref_test_300",
      object: "refund",
      status: "succeeded",
      refund_amount: 899,
      refund_currency: "USD",
      mode: "test",
      transaction: { id: "tran_test_300", order: "ord_test_300", currency: "USD", mode: "test" },
      checkout: { id: "ch_test_300", product: "prod_test_300", mode: "test" },
      order: { id: "ord_test_300", product: "prod_test_300", currency: "USD", status: "paid", mode: "test" },
      ...overrides
    }
  };
}

function createHarness(purchaseOverrides: Record<string, unknown> = {}) {
  const events = new Map<string, any>();
  const calls = {
    transactions: 0,
    grants: [] as any[],
    purchaseUpdates: [] as any[],
    ledgerCreates: [] as any[],
    walletUpdates: [] as any[],
    refundRequestUpdates: [] as any[]
  };
  const purchase: any = {
    id: "purchase_300",
    userId: "user_1",
    packKey: "credits_300",
    creemProductId: "prod_test_300",
    credits: 300,
    expectedAmountCents: 799,
    expectedCurrency: "USD",
    status: "PENDING",
    checkoutId: "ch_test_300",
    orderId: null,
    transactionId: null,
    paidAmountCents: null,
    paidCurrency: null,
    ...purchaseOverrides
  };
  const grant = { id: "grant_300", remainingAmount: 300 };
  const tx: any = {
    paymentWebhookEvent: {
      findUnique: async ({ where }: any) => events.get(where.eventId) || null,
      create: async ({ data }: any) => {
        events.set(data.eventId, data);
        return data;
      }
    },
    creemPurchase: {
      findUnique: async ({ where }: any) => {
        if (where.id) return where.id === purchase.id ? purchase : null;
        if (where.orderId) return where.orderId === purchase.orderId ? purchase : null;
        return null;
      },
      update: async ({ data }: any) => {
        calls.purchaseUpdates.push(data);
        Object.assign(purchase, data);
        return purchase;
      }
    },
    creditGrant: {
      findFirst: async () => grant,
      update: async ({ data }: any) => {
        if (data.remainingAmount?.decrement) grant.remainingAmount -= data.remainingAmount.decrement;
        return grant;
      }
    },
    creditWallet: {
      upsert: async () => ({}),
      update: async ({ data }: any) => {
        calls.walletUpdates.push(data);
        return data;
      }
    },
    creditLedger: {
      aggregate: async () => ({
        _sum: {
          purchasedDelta: calls.ledgerCreates.reduce((sum, row) => sum + Number(row.purchasedDelta || 0), 0),
          debtDelta: calls.ledgerCreates.reduce((sum, row) => sum + Number(row.debtDelta || 0), 0)
        }
      }),
      create: async ({ data }: any) => {
        calls.ledgerCreates.push(data);
        return { id: `ledger_${calls.ledgerCreates.length}`, ...data };
      }
    },
    refundRequest: {
      updateMany: async ({ data }: any) => { calls.refundRequestUpdates.push(data); return { count: 1 }; }
    }
  };
  const prisma: any = {
    paymentWebhookEvent: tx.paymentWebhookEvent,
    $transaction: async (callback: (transaction: any) => Promise<unknown>) => {
      calls.transactions += 1;
      return callback(tx);
    }
  };
  const credits: any = {
    grantCredits: async (input: any) => {
      calls.grants.push(input);
      return { id: "ledger_purchase_300" };
    }
  };
  return { service: new CreemWebhookService(prisma, credits), purchase, events, calls, grant };
}

test("rejects a signed checkout from the wrong Creem environment before opening a transaction", async () => {
  const { service, calls } = createHarness();
  const event = checkoutEvent({ mode: "live", product: { id: "prod_test_300", mode: "live" }, order: { ...(checkoutEvent().object.order as object), mode: "live" } });
  await assert.rejects(service.process(event), /mode does not match CREEM_MODE/);
  assert.equal(calls.transactions, 0);
});

test("rejects Test webhook processing when NODE_ENV is production or missing", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    for (const nodeEnv of ["production", ""]) {
      process.env.NODE_ENV = nodeEnv;
      const { service, calls } = createHarness();
      await assert.rejects(service.process(checkoutEvent()), /must be live, or Test mode must run/);
      assert.equal(calls.transactions, 0);
    }
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test("recognizes Creem's prod mode as live", async () => {
  const previous = process.env.CREEM_MODE;
  process.env.CREEM_MODE = "live";
  try {
    const { service, calls } = createHarness();
    const base = checkoutEvent();
    const event = checkoutEvent({ mode: "prod", product: { id: "prod_test_300", mode: "prod" }, order: { ...base.object.order, mode: "prod" }, customer: { ...base.object.customer, mode: "prod" } });
    const result: any = await service.process(event);
    assert.equal(result.processed, true);
    assert.equal(calls.grants.length, 1);
  } finally {
    process.env.CREEM_MODE = previous;
  }
});

test("rejects checkout and order states that are not completed and paid", async () => {
  const incomplete = createHarness();
  await assert.rejects(incomplete.service.process(checkoutEvent({ status: "open" })), /checkout is not completed/);
  const unpaid = createHarness();
  const event = checkoutEvent();
  event.object.order.status = "pending";
  await assert.rejects(unpaid.service.process(event), /order is not paid/);
});

test("rejects a checkout ID that is not the ID saved for the local purchase", async () => {
  const { service, calls } = createHarness({ checkoutId: "ch_other" });
  await assert.rejects(service.process(checkoutEvent()), /checkout ID does not match/);
  assert.equal(calls.grants.length, 0);
});

test("rejects product, base amount, or currency mismatches without granting credits", async () => {
  const amount = createHarness();
  const amountEvent = checkoutEvent();
  amountEvent.object.order.amount = 800;
  await assert.rejects(amount.service.process(amountEvent), /amount, currency, or product mismatch/);
  assert.equal(amount.calls.grants.length, 0);

  const currency = createHarness();
  const currencyEvent = checkoutEvent();
  currencyEvent.object.order.currency = "EUR";
  await assert.rejects(currency.service.process(currencyEvent), /amount, currency, or product mismatch/);
  assert.equal(currency.calls.grants.length, 0);

  const product = createHarness();
  const productEvent = checkoutEvent();
  productEvent.object.order.product = "prod_other";
  await assert.rejects(product.service.process(productEvent), /products do not match/);
  assert.equal(product.calls.grants.length, 0);
});

test("accepts a matching Test checkout once and records tax-inclusive paid amount", async () => {
  const { service, purchase, calls } = createHarness();
  const first: any = await service.process(checkoutEvent());
  assert.equal(first.processed, true);
  assert.equal(first.credits, 300);
  assert.equal(purchase.status, "PAID");
  assert.equal(purchase.orderId, "ord_test_300");
  assert.equal(purchase.transactionId, "tran_test_300");
  assert.equal(purchase.paidAmountCents, 899);
  assert.equal(calls.grants.length, 1);

  const replay: any = await service.process(checkoutEvent());
  assert.equal(replay.duplicate, true);
  assert.equal(calls.grants.length, 1);
});

test("rejects an unsuccessful refund or refund identifiers from another purchase", async () => {
  const unsuccessful = createHarness({ status: "PAID", orderId: "ord_test_300", transactionId: "tran_test_300", paidAmountCents: 899, paidCurrency: "USD" });
  await assert.rejects(unsuccessful.service.process(refundEvent({ status: "pending" })), /refund has not succeeded/);

  const wrongCheckout = createHarness({ status: "PAID", orderId: "ord_test_300", transactionId: "tran_test_300", paidAmountCents: 899, paidCurrency: "USD" });
  await assert.rejects(wrongCheckout.service.process(refundEvent({ checkout: { id: "ch_other", product: "prod_test_300", mode: "test" } })), /identifiers do not match/);
  assert.equal(wrongCheckout.calls.ledgerCreates.length, 0);
});

test("reverses matching refund credits once and rejects an amount above the paid total", async () => {
  const valid = createHarness({ status: "PAID", orderId: "ord_test_300", transactionId: "tran_test_300", paidAmountCents: 899, paidCurrency: "USD" });
  const result: any = await valid.service.process(refundEvent());
  assert.equal(result.processed, true);
  assert.equal(result.removable, 300);
  assert.equal(valid.purchase.status, "REFUNDED");
  assert.equal(valid.grant.remainingAmount, 0);
  assert.equal(valid.calls.ledgerCreates[0].purchasedDelta, -300);
  assert.equal(valid.calls.refundRequestUpdates[0].status, "COMPLETED");
  assert.equal(valid.calls.refundRequestUpdates[0].providerRefundId, "ref_test_300");

  const secondEvent = refundEvent({ refund_amount: 100 });
  secondEvent.id = "evt_refund_300_second";
  const second: any = await valid.service.process(secondEvent);
  assert.equal(second.alreadyReversed, true);
  assert.equal(valid.calls.ledgerCreates.length, 1);
  assert.equal(valid.calls.walletUpdates.length, 1);

  const excessive = createHarness({ status: "PAID", orderId: "ord_test_300", transactionId: "tran_test_300", paidAmountCents: 899, paidCurrency: "USD" });
  await assert.rejects(excessive.service.process(refundEvent({ refund_amount: 900 })), /exceeds the paid amount/);
  assert.equal(excessive.calls.ledgerCreates.length, 0);
});

test("accepts Creem's documented refund shape when checkout omits product", async () => {
  const valid = createHarness({ status: "PAID", orderId: "ord_test_300", transactionId: "tran_test_300", paidAmountCents: 899, paidCurrency: "USD" });
  const event = refundEvent({
    checkout: { id: "ch_test_300", request_id: "many-worlds-purchase_300", status: "completed", mode: "test" },
    transaction: { id: "tran_test_300", order: "ord_test_300", amount: 799, amount_paid: 899, currency: "USD", status: "refunded", mode: "test" },
    order: { id: "ord_test_300", product: "prod_test_300", amount: 799, currency: "USD", status: "paid", mode: "test" }
  });

  const result: any = await valid.service.process(event);

  assert.equal(result.processed, true);
  assert.equal(result.removable, 300);
  assert.equal(valid.purchase.status, "REFUNDED");
  assert.equal(valid.grant.remainingAmount, 0);
  assert.equal(valid.calls.ledgerCreates[0].purchasedDelta, -300);
});
