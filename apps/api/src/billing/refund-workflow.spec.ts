import assert from "node:assert/strict";
import test from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { BillingService } from "./billing.service";

function createHarness(providerAvailable: boolean) {
  const purchase: any = { id:"purchase_1", userId:"user_1", status:"PAID", transactionId:"tran_1", orderId:"ord_1", paidAt:new Date(), paidAmountCents:899, expectedAmountCents:799, paidCurrency:"USD", expectedCurrency:"USD", credits:300, refundRequest:null };
  const refund: any = { id:"refund_1", purchaseId:purchase.id, userId:purchase.userId, status:"PENDING", reason:"ACCIDENTAL_PURCHASE", requestedAmountCents:899 };
  const prisma: any = {
    creemPurchase: { findFirst: async () => purchase },
    refundRequest: {
      create: async ({ data }: any) => { Object.assign(refund, data); purchase.refundRequest = refund; return refund; },
      findUnique: async () => ({ ...refund, purchase }),
      updateMany: async ({ data }: any) => { Object.assign(refund, data); return { count:1 }; },
      update: async ({ data }: any) => { Object.assign(refund, data); return refund; },
      findMany: async () => []
    }
  };
  const creem: any = {
    getTransaction: async () => ({ id:"tran_1", mode:"test", status:"paid", order:"ord_1", amount_paid:899, currency:"USD" }),
    createRefund: async () => {
      if (!providerAvailable) throw new ServiceUnavailableException({ code:"CREEM_REFUND_API_NOT_AVAILABLE", message:"Unavailable" });
      return { id:"ref_provider_1", status:"submitted", payload:{ id:"ref_provider_1", status:"submitted" } };
    }
  };
  return { service:new BillingService(prisma, creem, {} as any), refund, purchase };
}

test("user refund request is owned, eligible, full amount and idempotent", async () => {
  const { service, purchase } = createHarness(true);
  const first: any = await service.requestRefund("user_1", { purchaseId:"purchase_1", reason:"ACCIDENTAL_PURCHASE", message:"Clicked twice" });
  assert.equal(first.created, true);
  assert.equal(first.refund.requestedAmountCents, 899);
  const second: any = await service.requestRefund("user_1", { purchaseId:"purchase_1", reason:"ACCIDENTAL_PURCHASE" });
  assert.equal(second.created, false);
  assert.equal(second.refund.id, "refund_1");
  assert.equal(purchase.refundRequest.status, "PENDING");
});

test("approval submits once when an approved Creem refund contract is configured", async () => {
  process.env.CREEM_MODE = "test";
  const { service, refund } = createHarness(true);
  const result: any = await service.approveRefund("admin_1", "refund_1", "Approved");
  assert.equal(result.submitted, true);
  assert.equal(result.creditReversalPendingWebhook, true);
  assert.equal(refund.status, "SUBMITTED");
  assert.equal(refund.providerRefundId, "ref_provider_1");
});

test("approval fails safely when Creem has not supplied its refund API contract", async () => {
  process.env.CREEM_MODE = "test";
  const { service, refund } = createHarness(false);
  const result: any = await service.approveRefund("admin_1", "refund_1");
  assert.equal(result.submitted, false);
  assert.equal(result.providerActionRequired, true);
  assert.equal(refund.status, "PROVIDER_ACTION_REQUIRED");
  assert.equal(refund.failureCode, "CREEM_REFUND_API_NOT_AVAILABLE");
});
