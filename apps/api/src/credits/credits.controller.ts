import { Body, Controller, Get, Inject, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../auth/current-user.decorator";
import { ReferralsService } from "../referrals/referrals.service";
import { CreditsService } from "./credits.service";

@Controller("v4/credits")
@UseGuards(AuthGuard)
export class CreditsController {
  constructor(@Inject(CreditsService) private readonly credits: CreditsService, @Inject(ReferralsService) private readonly referrals: ReferralsService) {}

  @Post("onboarding")
  async onboarding(@CurrentUser() user: AuthenticatedUser, @Body() body: { referralCode?: string; channel?: string }) {
    if (!user.emailVerifiedAt) {
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
