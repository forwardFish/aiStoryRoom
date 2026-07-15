import { BadRequestException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
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
      const checkout = await this.creem.createCheckout({
        productId: pack.productId,
        successUrl: `${process.env.PUBLIC_WEB_URL || "http://localhost:3000"}/credits/status?purchase_id=${encodeURIComponent(purchase.id)}`,
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
}
