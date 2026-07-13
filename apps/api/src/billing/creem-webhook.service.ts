import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { CreditsService } from "../credits/credits.service";
import { findPackByProductId } from "./credit-pack.config";

@Injectable()
export class CreemWebhookService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(CreditsService) private readonly credits: CreditsService) {}

  async process(event: any) {
    const eventId = String(event?.id || "");
    const eventType = String(event?.eventType || event?.type || "");
    if (!eventId || !eventType) throw new Error("Malformed Creem event");
    const existing = await this.prisma.paymentWebhookEvent.findUnique({ where: { eventId } });
    if (existing) return { processed: false, duplicate: true, eventId };
    if (eventType === "checkout.completed") return this.processCheckoutCompleted(event);
    if (eventType === "refund.created") return this.processRefund(event);
    if (eventType === "dispute.created") return this.processDispute(event);
    await this.prisma.paymentWebhookEvent.create({ data: { eventId, eventType, status: "IGNORED", payloadJson: event } });
    return { processed: false, ignored: true, eventId };
  }

  private async processCheckoutCompleted(event: any) {
    const checkout = event.object || {};
    const metadata = checkout.metadata || checkout.checkout?.metadata || {};
    const purchaseId = String(metadata.purchaseId || "");
    const userId = String(metadata.userId || "");
    const productId = String(checkout.product?.id || checkout.product || checkout.order?.product || "");
    const orderId = String(checkout.order?.id || checkout.order_id || "");
    const transactionId = checkout.order?.transaction || checkout.transaction_id || null;
    const amount = Number(checkout.order?.amount_paid ?? checkout.order?.amount ?? checkout.amount ?? 0);
    const currency = String(checkout.order?.currency || checkout.currency || "USD").toUpperCase();
    if (!purchaseId || !userId || !productId || !orderId) throw new Error("Checkout event missing required metadata");
    const pack = findPackByProductId(productId);
    if (!pack) throw new Error(`Unknown Creem product: ${productId}`);

    return this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.paymentWebhookEvent.findUnique({ where: { eventId: event.id } });
      if (duplicate) return { processed: false, duplicate: true, eventId: event.id };
      const purchase = await tx.creemPurchase.findUnique({ where: { id: purchaseId } });
      if (!purchase || purchase.userId !== userId) throw new Error("Purchase metadata does not match local purchase");
      if (purchase.creemProductId !== productId || purchase.credits !== pack.credits || purchase.expectedCurrency !== currency || (amount > 0 && purchase.expectedAmountCents !== amount)) {
        throw new Error("Creem purchase amount, currency, or product mismatch");
      }
      if (purchase.status === "PAID") {
        await tx.paymentWebhookEvent.create({ data: { eventId: event.id, eventType: event.eventType, status: "PROCESSED", payloadJson: event } });
        return { processed: false, alreadyPaid: true, eventId: event.id };
      }
      await tx.creemPurchase.update({ where: { id: purchase.id }, data: { status: "PAID", checkoutId: checkout.id, orderId, transactionId, customerId: checkout.customer?.id || null, customerEmail: checkout.customer?.email || null, paidAmountCents: amount || purchase.expectedAmountCents, paidCurrency: currency, paidAt: new Date(), rawJson: event } });
      const ledger = await this.credits.grantCredits({ userId: purchase.userId, kind: "PURCHASED", source: "PURCHASE", amount: purchase.credits, reason: "PURCHASE", idempotencyKey: `creem-purchase:${purchase.id}`, externalRef: purchase.id, metadata: { checkoutId: checkout.id, orderId, productId }, tx });
      await tx.paymentWebhookEvent.create({ data: { eventId: event.id, eventType: event.eventType, status: "PROCESSED", payloadJson: event } });
      return { processed: true, eventId: event.id, purchaseId: purchase.id, ledgerId: ledger.id, credits: purchase.credits };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async processRefund(event: any) {
    return this.reversePurchase(event, "PURCHASE_REFUND");
  }

  private async processDispute(event: any) {
    return this.reversePurchase(event, "DISPUTE");
  }

  private async reversePurchase(event: any, reason: "PURCHASE_REFUND" | "DISPUTE") {
    const object = event.object || {};
    const orderId = String(object.order?.id || object.order_id || object.transaction?.order || "");
    if (!orderId) throw new Error("Refund/dispute event missing order ID");
    return this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.paymentWebhookEvent.findUnique({ where: { eventId: event.id } });
      if (duplicate) return { processed: false, duplicate: true, eventId: event.id };
      const purchase = await tx.creemPurchase.findUnique({ where: { orderId } });
      if (!purchase) throw new Error("Purchase for refund/dispute not found");
      const grant = await tx.creditGrant.findFirst({ where: { externalRef: purchase.id, kind: "PURCHASED", source: "PURCHASE" }, orderBy: { createdAt: "asc" } });
      if (!grant) throw new Error("Purchased credit grant not found");
      const requested = reason === "DISPUTE" ? purchase.credits : Math.min(purchase.credits, Math.ceil((purchase.credits * Number(object.refund_amount || object.amount || purchase.expectedAmountCents)) / Math.max(purchase.paidAmountCents || purchase.expectedAmountCents, 1)));
      const removable = Math.min(grant.remainingAmount, requested);
      const debt = requested - removable;
      const status = reason === "DISPUTE" ? "DISPUTED" : requested >= purchase.credits ? "REFUNDED" : "PARTIALLY_REFUNDED";
      if (removable > 0) await tx.creditGrant.update({ where: { id: grant.id }, data: { remainingAmount: { decrement: removable } } });
      await tx.creditWallet.upsert({ where: { userId: purchase.userId }, create: { userId: purchase.userId }, update: {} });
      await tx.creditWallet.update({ where: { userId: purchase.userId }, data: { purchasedBalance: { decrement: removable }, debtBalance: { increment: debt }, version: { increment: 1 } } });
      const ledger = await tx.creditLedger.create({ data: { userId: purchase.userId, reason, purchasedDelta: -removable, debtDelta: debt, idempotencyKey: `creem-${reason.toLowerCase()}:${event.id}`, externalRef: purchase.id, metadataJson: { requested, removable, debt } } });
      await tx.creemPurchase.update({ where: { id: purchase.id }, data: { status, refundedAt: new Date(), rawJson: event } });
      await tx.paymentWebhookEvent.create({ data: { eventId: event.id, eventType: event.eventType, status: "PROCESSED", payloadJson: event } });
      return { processed: true, eventId: event.id, purchaseId: purchase.id, ledgerId: ledger.id, removable, debt };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
