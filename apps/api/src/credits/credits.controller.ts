import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Post, Query, UseGuards } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../auth/current-user.decorator";
import { ReferralsService } from "../referrals/referrals.service";
import { PrismaService } from "../prisma.service";
import { CreditsService } from "./credits.service";

@Controller("v4/credits")
@UseGuards(AuthGuard)
export class CreditsController {
  constructor(@Inject(CreditsService) private readonly credits: CreditsService, @Inject(ReferralsService) private readonly referrals: ReferralsService, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Post("test-grant")
  async testGrant(@CurrentUser() user: AuthenticatedUser, @Body() body: { runId?: string; amount?: number }) {
    if (process.env.NODE_ENV === "production" || process.env.ALLOW_TEST_CREDIT_GRANT !== "true") {
      throw new ForbiddenException({ code: "TEST_CREDIT_GRANT_DISABLED", message: "Test credit grants are disabled" });
    }
    const runId = String(body.runId || "").trim();
    const amount = Number(body.amount || 200);
    if (!runId || !user.email?.endsWith("@example.test") || !user.email.includes(runId) || !Number.isInteger(amount) || amount < 1 || amount > 1000) {
      throw new BadRequestException({ code: "INVALID_TEST_CREDIT_GRANT", message: "Invalid test credit grant request" });
    }
    return this.grantTestCredits(user, runId, amount);
  }

  private async grantTestCredits(user: AuthenticatedUser, runId: string, amount: number) {
    const idempotencyKey = `test-credit:${runId}:${user.id}:acceptance`;
    // The cumulative cap and ledger creation are one serializable operation.
    // Retrying a serialization conflict makes two simultaneous test requests
    // deterministically produce one grant and one TEST_CREDIT_GRANT_LIMIT.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const existing = await tx.creditLedger.findUnique({ where: { idempotencyKey } });
          if (existing) return { ledgerId: existing.id, balance: await this.credits.getBalance(user.id, tx) };
          const prior = await tx.creditLedger.aggregate({ where: { userId: user.id, reason: "ADMIN_ADJUSTMENT" }, _sum: { bonusDelta: true } });
          if (Number(prior._sum.bonusDelta || 0) + amount > 1000) throw new BadRequestException({ code: "TEST_CREDIT_GRANT_LIMIT", message: "Test credit grant limit exceeded" });
          const ledger = await this.credits.grantCredits({
            userId: user.id, kind: "BONUS", source: "ADMIN", amount, reason: "ADMIN_ADJUSTMENT", idempotencyKey,
            metadata: { runId, purpose: "acceptance", grantedBy: "codex-test-harness" }, tx
          });
          return { ledgerId: ledger.id, balance: await this.credits.getBalance(user.id, tx) };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error: any) {
        if (error?.code === "P2034" && attempt < 2) continue;
        throw error;
      }
    }
    throw new BadRequestException({ code: "TEST_CREDIT_GRANT_RETRY_EXHAUSTED", message: "Test credit grant could not be serialized" });
  }

  @Post("onboarding")
  async onboarding(@CurrentUser() user: AuthenticatedUser, @Body() body: { referralCode?: string; channel?: string }) {
    if (!user.emailVerifiedAt && user.authMethod !== "GOOGLE") {
      return { bonusGranted: false, reason: "EMAIL_VERIFICATION_REQUIRED", balance: await this.credits.getBalance(user.id) };
    }
    const existing = await this.credits.getBalance(user.id);
    const ledger = await this.credits.grantCredits({
      userId: user.id,
      kind: "BONUS",
      source: "SIGNUP",
      amount: Number(process.env.CREDIT_SIGNUP_BONUS || 50),
      reason: "SIGNUP_BONUS",
      idempotencyKey: `signup-bonus:${user.id}`,
      externalRef: user.id,
      expiresAt: new Date(Date.now() + Number(process.env.CREDIT_BONUS_TTL_DAYS || 90) * 86_400_000)
    });
    if (body.referralCode) {
      await this.referrals.bindReferral({ referredUserId: user.id, referralCode: body.referralCode, channel: body.channel });
    }
    const balance = await this.credits.getBalance(user.id);
    return { bonusGranted: existing.bonus === balance.bonus ? false : true, ledgerId: ledger.id, balance };
  }

  @Get("balance")
  balance(@CurrentUser() user: AuthenticatedUser) {
    return this.credits.getBalance(user.id);
  }

  @Get("transactions")
  transactions(@CurrentUser() user: AuthenticatedUser, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.credits.listTransactions(user.id, Number(page || 1), Number(pageSize || 30));
  }
}
