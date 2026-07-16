import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { CreditsService } from "../credits/credits.service";
import { CreemClient } from "./creem.client";
import { getCreditPacks, type CreditPackKey } from "./credit-pack.config";

export interface CheckoutContextInput {
  intent?: string;
  runId?: string;
  returnTo?: string;
}

interface CheckoutContext {
  intent: "WALLET" | "WORLD_UNLOCK";
  runId: string | null;
  returnTo: string;
  roomTitle?: string;
  round?: number;
  totalRounds?: number;
}

export function getPaymentReturnOrigin(environment: NodeJS.ProcessEnv = process.env) {
  const configured = String(environment.PAYMENT_RETURN_ORIGIN || environment.PUBLIC_WEB_URL || "").trim();
  const candidate = configured || (environment.NODE_ENV === "production" ? "" : "http://localhost:3000");
  if (!candidate) {
    throw new ServiceUnavailableException({ code: "PAYMENT_RETURN_ORIGIN_REQUIRED", message: "Payment return URL is not configured" });
  }
  try {
    const url = new URL(candidate);
    const hasUnexpectedParts = Boolean(url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/"));
    const invalidProtocol = !["http:", "https:"].includes(url.protocol) || (environment.NODE_ENV === "production" && url.protocol !== "https:");
    if (hasUnexpectedParts || invalidProtocol) throw new Error("invalid origin");
    return url.origin;
  } catch {
    throw new ServiceUnavailableException({ code: "PAYMENT_RETURN_ORIGIN_INVALID", message: "Payment return URL must be a valid web origin" });
  }
}

@Injectable()
export class BillingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(CreemClient) private readonly creem: CreemClient, @Inject(CreditsService) private readonly credits: CreditsService) {}

  private async normalizeContext(userId: string, input: CheckoutContextInput): Promise<CheckoutContext> {
    const intent = input.intent === "WORLD_UNLOCK" ? "WORLD_UNLOCK" : "WALLET";
    const runId = String(input.runId || "").trim() || null;
    if (intent === "WORLD_UNLOCK" && !runId) {
      throw new BadRequestException({ code: "RUN_ID_REQUIRED", message: "A room is required to resume this unlock" });
    }
    if (runId) {
      const run = await this.prisma.storyRun.findUnique({ where: { id: runId }, select: { ownerUserId: true, title: true, currentDay: true, totalDays: true, currentNodeId: true } });
      if (!run) throw new NotFoundException({ code: "STORY_RUN_NOT_FOUND", message: "Story run not found" });
      const participant = run.ownerUserId === userId || Boolean(await this.prisma.storyPlayer.findFirst({ where: { runId, userId, status: "active" }, select: { id: true } }));
      if (!participant) throw new UnauthorizedException({ code: "RUN_PARTICIPANT_REQUIRED", message: "Only room participants can resume this unlock" });
      const node = run.currentNodeId ? await this.prisma.sceneNode.findUnique({ where: { id: run.currentNodeId }, select: { nodeIndex: true } }) : null;
      const roomContext = { roomTitle: run.title, round: node?.nodeIndex || run.currentDay, totalRounds: run.totalDays };
      const fallback = `/room-game?runId=${encodeURIComponent(runId)}`;
      const candidate = String(input.returnTo || "").trim();
      try {
        const parsed = new URL(candidate, "https://manyworlds.invalid");
        if (parsed.origin === "https://manyworlds.invalid" && parsed.pathname === "/room-game" && parsed.searchParams.get("runId") === runId) {
          return { intent, runId, returnTo: `${parsed.pathname}${parsed.search}`, ...roomContext };
        }
      } catch {
        // Use the canonical in-product destination below.
      }
      return { intent, runId, returnTo: fallback, ...roomContext };
    }
    const fallback = "/credits";
    const candidate = String(input.returnTo || "").trim();
    if (!candidate) return { intent, runId, returnTo: fallback };
    try {
      const parsed = new URL(candidate, "https://manyworlds.invalid");
      const isInternal = parsed.origin === "https://manyworlds.invalid";
      const validRoomReturn = runId && parsed.pathname === "/room-game" && parsed.searchParams.get("runId") === runId;
      const validWalletReturn = !runId && parsed.pathname === "/credits";
      if (isInternal && (validRoomReturn || validWalletReturn)) {
        return { intent, runId, returnTo: `${parsed.pathname}${parsed.search}` };
      }
    } catch {
      // Fall through to the canonical in-product destination.
    }
    return { intent, runId, returnTo: fallback };
  }

  async createCheckout(user: { id: string; email: string | null; emailVerifiedAt: Date | null; authMethod?: "PASSWORD" | "GOOGLE" }, packKey: string, input: CheckoutContextInput = {}) {
    if (!user.emailVerifiedAt && user.authMethod !== "GOOGLE") throw new UnauthorizedException({ code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify your email before purchasing" });
    const pack = getCreditPacks()[packKey as CreditPackKey];
    if (!pack) throw new BadRequestException({ code: "UNKNOWN_CREDIT_PACK", message: "Unknown credit pack" });
    const checkoutContext = await this.normalizeContext(user.id, input);
    const purchase = await this.prisma.creemPurchase.create({
      data: {
        userId: user.id,
        packKey: pack.key,
        creemProductId: pack.productId,
        credits: pack.credits,
        expectedAmountCents: pack.expectedAmountCents,
        expectedCurrency: pack.currency,
        orderDisplayCode: `MW-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
        checkoutContext: checkoutContext as unknown as Prisma.InputJsonValue
      }
    });
    const requestId = `many-worlds-${purchase.id}`;
    try {
      const paymentReturnOrigin = getPaymentReturnOrigin();
      const checkout = await this.creem.createCheckout({
        productId: pack.productId,
        successUrl: `${paymentReturnOrigin}/credits/status?purchase_id=${encodeURIComponent(purchase.id)}`,
        requestId,
        metadata: { userId: user.id, purchaseId: purchase.id, intent: checkoutContext.intent, runId: checkoutContext.runId || "", source: "web" }
      });
      const updated = await this.prisma.creemPurchase.update({ where: { id: purchase.id }, data: { checkoutId: checkout.id } });
      return { purchaseId: updated.id, checkoutId: checkout.id, checkoutUrl: checkout.checkoutUrl, context: checkoutContext, pack: { key: pack.key, credits: pack.credits, amountCents: pack.expectedAmountCents, currency: pack.currency } };
    } catch (error) {
      await this.prisma.creemPurchase.update({ where: { id: purchase.id }, data: { status: "FAILED" } });
      throw error;
    }
  }

  async getCheckoutStatus(userId: string, lookup: { checkoutId?: string; purchaseId?: string }) {
    const purchaseId = String(lookup.purchaseId || "").trim();
    const checkoutId = String(lookup.checkoutId || "").trim();
    if (!purchaseId && !checkoutId) throw new BadRequestException({ code: "CHECKOUT_LOOKUP_REQUIRED", message: "Checkout lookup is required" });
    const purchase = await this.prisma.creemPurchase.findFirst({ where: { userId, ...(purchaseId ? { id: purchaseId } : { checkoutId }) } });
    if (!purchase) throw new NotFoundException({ code: "CHECKOUT_NOT_FOUND", message: "Checkout not found" });
    return {
      purchaseId: purchase.id,
      checkoutId: purchase.checkoutId,
      orderDisplayCode: purchase.orderDisplayCode,
      status: purchase.status,
      credits: purchase.credits,
      context: purchase.checkoutContext,
      balance: await this.credits.getBalance(userId)
    };
  }

  async purchaseHistory(userId: string) {
    const purchases = await this.prisma.creemPurchase.findMany({
      where: { userId },
      include: { refundRequest: true },
      orderBy: { createdAt: "desc" },
      take: 50
    });
    return {
      purchases: purchases.map((purchase) => ({
        id: purchase.id,
        orderDisplayCode: purchase.orderDisplayCode,
        credits: purchase.credits,
        amountCents: purchase.paidAmountCents || purchase.expectedAmountCents,
        currency: purchase.paidCurrency || purchase.expectedCurrency,
        status: purchase.status,
        paidAt: purchase.paidAt,
        createdAt: purchase.createdAt,
        refund: purchase.refundRequest ? {
          id: purchase.refundRequest.id,
          status: purchase.refundRequest.status,
          reason: purchase.refundRequest.reason,
          requestedAt: purchase.refundRequest.requestedAt,
          reviewedAt: purchase.refundRequest.reviewedAt,
          completedAt: purchase.refundRequest.completedAt,
          adminNote: purchase.refundRequest.adminNote
        } : null
      }))
    };
  }

  async requestRefund(userId: string, input: { purchaseId?: string; reason?: string; message?: string }) {
    const purchaseId = String(input.purchaseId || "").trim();
    const reason = String(input.reason || "").trim().toUpperCase();
    const allowedReasons = new Set(["REQUESTED_BY_CUSTOMER", "DUPLICATE", "ACCIDENTAL_PURCHASE", "TECHNICAL_ISSUE", "OTHER"]);
    if (!purchaseId) throw new BadRequestException({ code: "PURCHASE_ID_REQUIRED", message: "Select a purchase to refund" });
    if (!allowedReasons.has(reason)) throw new BadRequestException({ code: "REFUND_REASON_REQUIRED", message: "Select a valid refund reason" });
    const message = String(input.message || "").trim().slice(0, 1_000) || null;
    const purchase = await this.prisma.creemPurchase.findFirst({ where: { id: purchaseId, userId }, include: { refundRequest: true } });
    if (!purchase) throw new NotFoundException({ code: "PURCHASE_NOT_FOUND", message: "Purchase not found" });
    if (purchase.refundRequest) return { created: false, refund: purchase.refundRequest };
    if (purchase.status !== "PAID" || !purchase.transactionId || !purchase.paidAt) {
      throw new ConflictException({ code: "PURCHASE_NOT_REFUNDABLE", message: "Only a confirmed, paid purchase can be refunded" });
    }
    const windowDays = Math.max(1, Math.min(60, Number(process.env.REFUND_REQUEST_WINDOW_DAYS || 14)));
    if (purchase.paidAt.getTime() + windowDays * 86_400_000 < Date.now()) {
      throw new ConflictException({ code: "REFUND_WINDOW_EXPIRED", message: `Refund requests are available for ${windowDays} days after payment` });
    }
    try {
      const refund = await this.prisma.refundRequest.create({
        data: {
          purchaseId: purchase.id,
          userId,
          reason,
          message,
          requestedAmountCents: purchase.paidAmountCents || purchase.expectedAmountCents
        }
      });
      return { created: true, refund };
    } catch (error: any) {
      if (error?.code !== "P2002") throw error;
      const refund = await this.prisma.refundRequest.findUnique({ where: { purchaseId: purchase.id } });
      if (!refund) throw error;
      return { created: false, refund };
    }
  }

  async adminRefundRequests(status?: string) {
    const normalized = String(status || "").trim().toUpperCase();
    const statuses = new Set(["PENDING", "APPROVED", "PROVIDER_ACTION_REQUIRED", "SUBMITTED", "COMPLETED", "REJECTED", "FAILED"]);
    if (normalized && !statuses.has(normalized)) throw new BadRequestException({ code: "INVALID_REFUND_STATUS", message: "Invalid refund request status" });
    const requests = await this.prisma.refundRequest.findMany({
      where: normalized ? { status: normalized as any } : {},
      include: {
        purchase: { select: { orderDisplayCode: true, transactionId: true, orderId: true, credits: true, paidAmountCents: true, expectedAmountCents: true, paidCurrency: true, expectedCurrency: true, status: true, paidAt: true } },
        requester: { select: { email: true, nickname: true } },
        reviewer: { select: { email: true } }
      },
      orderBy: { requestedAt: "asc" },
      take: 100
    });
    return { requests };
  }

  async approveRefund(reviewerUserId: string, requestId: string, adminNote?: string) {
    const existing = await this.prisma.refundRequest.findUnique({ where: { id: requestId }, include: { purchase: true } });
    if (!existing) throw new NotFoundException({ code: "REFUND_REQUEST_NOT_FOUND", message: "Refund request not found" });
    if (existing.status === "SUBMITTED" || existing.status === "COMPLETED") return { approved: true, refund: existing, alreadySubmitted: true };
    if (existing.status === "REJECTED") throw new ConflictException({ code: "REFUND_ALREADY_REJECTED", message: "Rejected requests cannot be approved" });
    if (existing.purchase.status !== "PAID" || !existing.purchase.transactionId) {
      throw new ConflictException({ code: "PURCHASE_NOT_REFUNDABLE", message: "The purchase is no longer eligible for a provider refund" });
    }
    const claim = await this.prisma.refundRequest.updateMany({
      where: { id: requestId, status: { in: ["PENDING", "FAILED", "PROVIDER_ACTION_REQUIRED"] } },
      data: { status: "APPROVED", reviewerUserId, reviewedAt: new Date(), adminNote: String(adminNote || "").trim().slice(0, 1_000) || null, failureCode: null, failureMessage: null }
    });
    if (claim.count !== 1) {
      const current = await this.prisma.refundRequest.findUnique({ where: { id: requestId } });
      return { approved: current?.status === "APPROVED" || current?.status === "SUBMITTED" || current?.status === "COMPLETED", refund: current, concurrent: true };
    }

    try {
      const transaction = await this.creem.getTransaction(existing.purchase.transactionId);
      const mode = String(transaction.mode || "").toLowerCase();
      const expectedMode = String(process.env.CREEM_MODE || "").toLowerCase();
      const modeMatches = expectedMode === "test" ? ["test", "sandbox"].includes(mode) : ["live", "prod", "production"].includes(mode);
      if (!modeMatches) throw new Error("Creem transaction mode mismatch");
      if (String(transaction.status || "").toLowerCase() !== "paid") throw new Error("Creem transaction is not paid");
      if (String(transaction.order || "") !== String(existing.purchase.orderId || "")) throw new Error("Creem transaction order mismatch");
      const paidAmount = Number(transaction.amount_paid ?? transaction.amount);
      const currency = String(transaction.currency || "").toUpperCase();
      if (paidAmount !== existing.requestedAmountCents || currency !== (existing.purchase.paidCurrency || existing.purchase.expectedCurrency)) {
        throw new Error("Creem transaction amount or currency mismatch");
      }
      const provider = await this.creem.createRefund({
        transactionId: existing.purchase.transactionId,
        amountCents: existing.requestedAmountCents,
        reason: "requested_by_customer",
        requestId: `many-worlds-refund-${existing.id}`
      });
      const refund = await this.prisma.refundRequest.update({
        where: { id: requestId },
        data: { status: "SUBMITTED", providerRefundId: provider.id, providerStatus: provider.status, providerResponseJson: provider.payload as Prisma.InputJsonValue, submittedAt: new Date() }
      });
      return { approved: true, submitted: true, refund, creditReversalPendingWebhook: true };
    } catch (error: any) {
      const response = typeof error?.getResponse === "function" ? error.getResponse() : null;
      const code = String(response?.code || "CREEM_REFUND_SUBMISSION_FAILED");
      const providerUnavailable = code === "CREEM_REFUND_API_NOT_AVAILABLE";
      const refund = await this.prisma.refundRequest.update({
        where: { id: requestId },
        data: {
          status: providerUnavailable ? "PROVIDER_ACTION_REQUIRED" : "FAILED",
          failureCode: code,
          failureMessage: providerUnavailable
            ? "Creem must provide an approved refund API contract before automatic submission can be enabled."
            : "The provider refund could not be submitted safely. Review server logs and retry."
        }
      });
      return { approved: true, submitted: false, providerActionRequired: providerUnavailable, refund };
    }
  }

  async rejectRefund(reviewerUserId: string, requestId: string, adminNote?: string) {
    const note = String(adminNote || "").trim().slice(0, 1_000);
    if (!note) throw new BadRequestException({ code: "ADMIN_NOTE_REQUIRED", message: "Explain why the refund request is rejected" });
    const updated = await this.prisma.refundRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: { status: "REJECTED", reviewerUserId, reviewedAt: new Date(), adminNote: note }
    });
    if (updated.count !== 1) throw new ConflictException({ code: "REFUND_REQUEST_NOT_PENDING", message: "Only pending refund requests can be rejected" });
    return { rejected: true, refund: await this.prisma.refundRequest.findUnique({ where: { id: requestId } }) };
  }
}
