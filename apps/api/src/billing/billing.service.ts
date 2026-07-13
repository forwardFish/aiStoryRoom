import { BadRequestException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { CreditsService } from "../credits/credits.service";
import { CreemClient } from "./creem.client";
import { getCreditPacks, type CreditPackKey } from "./credit-pack.config";

@Injectable()
export class BillingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(CreemClient) private readonly creem: CreemClient, @Inject(CreditsService) private readonly credits: CreditsService) {}

  async createCheckout(user: { id: string; email: string | null; emailVerifiedAt: Date | null }, packKey: string) {
    if (!user.emailVerifiedAt) throw new UnauthorizedException({ code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify your email before purchasing" });
    const pack = getCreditPacks()[packKey as CreditPackKey];
    if (!pack) throw new BadRequestException({ code: "UNKNOWN_CREDIT_PACK", message: "Unknown credit pack" });
    const purchase = await this.prisma.creemPurchase.create({
      data: {
        userId: user.id,
        packKey: pack.key,
        creemProductId: pack.productId,
        credits: pack.credits,
        expectedAmountCents: pack.expectedAmountCents,
        expectedCurrency: pack.currency
      }
    });
    const requestId = `many-worlds-${purchase.id}`;
    try {
      const checkout = await this.creem.createCheckout({
        productId: pack.productId,
        successUrl: `${process.env.PUBLIC_WEB_URL || "http://localhost:3000"}/credits-success.html`,
        requestId,
        metadata: { userId: user.id, purchaseId: purchase.id, source: "web-local-test" }
      });
      const updated = await this.prisma.creemPurchase.update({ where: { id: purchase.id }, data: { checkoutId: checkout.id } });
      return { purchaseId: updated.id, checkoutId: checkout.id, checkoutUrl: checkout.checkoutUrl, pack: { key: pack.key, credits: pack.credits, amountCents: pack.expectedAmountCents, currency: pack.currency } };
    } catch (error) {
      await this.prisma.creemPurchase.update({ where: { id: purchase.id }, data: { status: "FAILED" } });
      throw error;
    }
  }

  async getCheckoutStatus(userId: string, checkoutId: string) {
    const purchase = await this.prisma.creemPurchase.findFirst({ where: { userId, checkoutId } });
    if (!purchase) throw new NotFoundException({ code: "CHECKOUT_NOT_FOUND", message: "Checkout not found" });
    return { purchaseId: purchase.id, checkoutId: purchase.checkoutId, status: purchase.status, credits: purchase.credits, balance: await this.credits.getBalance(userId) };
  }
}
