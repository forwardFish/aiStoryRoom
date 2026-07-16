import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { CreditsService } from "../credits/credits.service";
import { findPackByProductId } from "./credit-pack.config";

type CreemEnvironment = "test" | "live";

function providerId(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) return String((value as { id?: unknown }).id || "");
  return "";
}

function configuredEnvironment(): CreemEnvironment {
  const configured = String(process.env.CREEM_MODE || "").trim().toLowerCase();
  if (configured === "test" || configured === "live") return configured;
  throw new Error("CREEM_MODE must be explicitly set to test or live");
}

function normalizeProviderEnvironment(value: unknown): CreemEnvironment | null {
  const mode = String(value || "").trim().toLowerCase();
  // Creem documentation currently uses test and sandbox interchangeably in
  // webhook examples; older signed examples use local for the test sandbox.
  if (mode === "test" || mode === "sandbox" || mode === "local") return "test";
  if (mode === "live" || mode === "production" || mode === "prod") return "live";
  return null;
}

function assertProviderEnvironment(object: any, label: string) {
  const rawModes = [object?.mode, object?.order?.mode, object?.checkout?.mode, object?.product?.mode, object?.customer?.mode, object?.transaction?.mode].filter(
    (value) => value !== undefined && value !== null && String(value).trim() !== ""
  );
  if (rawModes.length === 0) throw new Error(`${label} event is missing Creem mode`);
  const expected = configuredEnvironment();
  const actual = rawModes.map(normalizeProviderEnvironment);
  if (actual.some((mode) => mode === null) || actual.some((mode) => mode !== expected)) {
    throw new Error(`${label} event mode does not match CREEM_MODE`);
  }
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

@Injectable()
export class CreemWebhookService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(CreditsService) private readonly credits: CreditsService) {}

  async process(event: any) {
    const eventId = String(event?.id || "");
    const eventType = String(event?.eventType || event?.type || "");
    if (!eventId || !eventType) throw new Error("Malformed Creem event");
    const existing = await this.prisma.paymentWebhookEvent.findUnique({ where: { eventId } });
    if (existing) return { processed: false, duplicate: true, eventId };
    if (eventType === "checkout.completed") return this.processCheckoutCompleted(event, eventType);
    if (eventType === "refund.created") return this.processRefund(event, eventType);
    if (eventType === "dispute.created") return this.processDispute(event, eventType);
    await this.prisma.paymentWebhookEvent.create({ data: { eventId, eventType, status: "IGNORED", payloadJson: event } });
    return { processed: false, ignored: true, eventId };
  }

  private async processCheckoutCompleted(event: any, eventType: string) {
    const checkout = event.object || {};
    assertProviderEnvironment(checkout, "Checkout");
    if (String(checkout.status || "").toLowerCase() !== "completed") throw new Error("Creem checkout is not completed");
    if (String(checkout.order?.status || "").toLowerCase() !== "paid") throw new Error("Creem order is not paid");
    const checkoutId = String(checkout.id || "");
    const metadata = checkout.metadata || checkout.checkout?.metadata || {};
    const purchaseId = String(metadata.purchaseId || "");
    const userId = String(metadata.userId || "");
    const checkoutProductId = providerId(checkout.product);
    const orderProductId = providerId(checkout.order?.product);
    if (checkoutProductId && orderProductId && checkoutProductId !== orderProductId) throw new Error("Creem checkout and order products do not match");
    const productId = checkoutProductId || orderProductId;
    const orderId = String(checkout.order?.id || checkout.order_id || "");
    const transactionId = providerId(checkout.order?.transaction) || providerId(checkout.transaction) || String(checkout.transaction_id || "") || null;
    const orderAmount = positiveInteger(checkout.order?.amount, "Creem order amount");
    const paidAmount = positiveInteger(checkout.order?.amount_paid ?? checkout.order?.amount, "Creem paid amount");
    const currency = String(checkout.order?.currency || checkout.currency || "").toUpperCase();
    const requestId = String(checkout.request_id || checkout.requestId || "");
    if (!checkoutId || !purchaseId || !userId || !productId || !orderId || !transactionId || !currency || !requestId) throw new Error("Checkout event missing required payment data");
    if (requestId !== `many-worlds-${purchaseId}`) throw new Error("Creem checkout request ID does not match local purchase");
    const pack = findPackByProductId(productId);
    if (!pack) throw new Error(`Unknown Creem product: ${productId}`);

    return this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.paymentWebhookEvent.findUnique({ where: { eventId: event.id } });
      if (duplicate) return { processed: false, duplicate: true, eventId: event.id };
      const purchase = await tx.creemPurchase.findUnique({ where: { id: purchaseId } });
      if (!purchase || purchase.userId !== userId) throw new Error("Purchase metadata does not match local purchase");
      if (!purchase.checkoutId || purchase.checkoutId !== checkoutId) throw new Error("Creem checkout ID does not match local purchase");
      if (purchase.creemProductId !== productId || purchase.credits !== pack.credits || purchase.expectedCurrency !== currency || purchase.expectedAmountCents !== orderAmount) {
        throw new Error("Creem purchase amount, currency, or product mismatch");
      }
      if (purchase.status === "PAID") {
        await tx.paymentWebhookEvent.create({ data: { eventId: event.id, eventType, status: "PROCESSED", payloadJson: event } });
        return { processed: false, alreadyPaid: true, eventId: event.id };
      }
      if (purchase.status !== "PENDING") throw new Error("Local purchase is not pending");
      await tx.creemPurchase.update({ where: { id: purchase.id }, data: { status: "PAID", orderId, transactionId, customerId: checkout.customer?.id || null, customerEmail: checkout.customer?.email || null, paidAmountCents: paidAmount, paidCurrency: currency, paidAt: new Date(), rawJson: event } });
      const ledger = await this.credits.grantCredits({ userId: purchase.userId, kind: "PURCHASED", source: "PURCHASE", amount: purchase.credits, reason: "PURCHASE", idempotencyKey: `creem-purchase:${purchase.id}`, externalRef: purchase.id, metadata: { checkoutId, orderId, productId }, tx });
      await tx.paymentWebhookEvent.create({ data: { eventId: event.id, eventType, status: "PROCESSED", payloadJson: event } });
      return { processed: true, eventId: event.id, purchaseId: purchase.id, ledgerId: ledger.id, credits: purchase.credits };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async processRefund(event: any, eventType: string) {
    return this.reversePurchase(event, eventType, "PURCHASE_REFUND");
  }

  private async processDispute(event: any, eventType: string) {
    return this.reversePurchase(event, eventType, "DISPUTE");
  }

  private async reversePurchase(event: any, eventType: string, reason: "PURCHASE_REFUND" | "DISPUTE") {
    const object = event.object || {};
    assertProviderEnvironment(object, reason === "DISPUTE" ? "Dispute" : "Refund");
    if (reason === "PURCHASE_REFUND" && String(object.status || "").toLowerCase() !== "succeeded") throw new Error("Creem refund has not succeeded");
    const orderId = providerId(object.order) || providerId(object.transaction?.order) || String(object.order_id || "");
    const checkoutId = providerId(object.checkout);
    const transactionId = providerId(object.transaction);
    const productId = providerId(object.order?.product) || providerId(object.checkout?.product) || providerId(object.product);
    const currency = String(object.refund_currency || object.currency || object.transaction?.currency || object.order?.currency || "").toUpperCase();
    const reversalAmount = positiveInteger(reason === "DISPUTE" ? object.amount : object.refund_amount, `Creem ${reason === "DISPUTE" ? "dispute" : "refund"} amount`);
    if (!orderId || !checkoutId || !transactionId || !productId || !currency) throw new Error("Refund/dispute event missing required payment data");
    return this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.paymentWebhookEvent.findUnique({ where: { eventId: event.id } });
      if (duplicate) return { processed: false, duplicate: true, eventId: event.id };
      const purchase = await tx.creemPurchase.findUnique({ where: { orderId } });
      if (!purchase) throw new Error("Purchase for refund/dispute not found");
      if (purchase.checkoutId !== checkoutId || purchase.transactionId !== transactionId || purchase.creemProductId !== productId) throw new Error("Refund/dispute identifiers do not match local purchase");
      if ((purchase.paidCurrency || purchase.expectedCurrency) !== currency) throw new Error("Refund/dispute currency does not match local purchase");
      if (purchase.status === "PENDING" || purchase.status === "FAILED") throw new Error("Refund/dispute purchase was never paid");
      const grant = await tx.creditGrant.findFirst({ where: { externalRef: purchase.id, kind: "PURCHASED", source: "PURCHASE" }, orderBy: { createdAt: "asc" } });
      if (!grant) throw new Error("Purchased credit grant not found");
      const paidAmount = purchase.paidAmountCents || purchase.expectedAmountCents;
      if (reversalAmount > paidAmount) throw new Error("Refund/dispute amount exceeds the paid amount");
      const previous = await tx.creditLedger.aggregate({
        where: { externalRef: purchase.id, reason: { in: ["PURCHASE_REFUND", "DISPUTE"] } },
        _sum: { purchasedDelta: true, debtDelta: true }
      });
      const alreadyReversed = Math.max(0, -Number(previous._sum.purchasedDelta || 0) + Number(previous._sum.debtDelta || 0));
      const eventRequested = reason === "DISPUTE" ? purchase.credits : Math.min(purchase.credits, Math.ceil((purchase.credits * reversalAmount) / Math.max(paidAmount, 1)));
      const requested = Math.min(eventRequested, Math.max(0, purchase.credits - alreadyReversed));
      if (requested === 0) {
        await tx.paymentWebhookEvent.create({ data: { eventId: event.id, eventType, status: "PROCESSED", payloadJson: event } });
        return { processed: false, alreadyReversed: true, eventId: event.id, purchaseId: purchase.id };
      }
      const removable = Math.min(grant.remainingAmount, requested);
      const debt = requested - removable;
      const status = reason === "DISPUTE" ? "DISPUTED" : alreadyReversed + requested >= purchase.credits ? "REFUNDED" : "PARTIALLY_REFUNDED";
      if (removable > 0) await tx.creditGrant.update({ where: { id: grant.id }, data: { remainingAmount: { decrement: removable } } });
      await tx.creditWallet.upsert({ where: { userId: purchase.userId }, create: { userId: purchase.userId }, update: {} });
      await tx.creditWallet.update({ where: { userId: purchase.userId }, data: { purchasedBalance: { decrement: removable }, debtBalance: { increment: debt }, version: { increment: 1 } } });
      const ledger = await tx.creditLedger.create({ data: { userId: purchase.userId, reason, purchasedDelta: -removable, debtDelta: debt, idempotencyKey: `creem-${reason.toLowerCase()}:${event.id}`, externalRef: purchase.id, metadataJson: { requested, removable, debt } } });
      await tx.creemPurchase.update({ where: { id: purchase.id }, data: { status, refundedAt: new Date(), rawJson: event } });
      await tx.paymentWebhookEvent.create({ data: { eventId: event.id, eventType, status: "PROCESSED", payloadJson: event } });
      return { processed: true, eventId: event.id, purchaseId: purchase.id, ledgerId: ledger.id, removable, debt };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
