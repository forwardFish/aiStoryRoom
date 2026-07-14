import { Body, Controller, Get, Inject, Post, Query, Res, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../auth/current-user.decorator";
import { ReferralsService } from "./referrals.service";

@Controller("v4/referrals")
@UseGuards(AuthGuard)
export class ReferralsController {
  constructor(@Inject(ReferralsService) private readonly referrals: ReferralsService) {}

  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.referrals.getSummary(user.id);
  }

  @Post("share-events")
  share(@CurrentUser() user: AuthenticatedUser, @Body() body: { channel?: string; runId?: string }) {
    return this.referrals.recordShareEvent(user.id, body);
  }

  @Post("bind")
  bind(@CurrentUser() user: AuthenticatedUser, @Body() body: { referralCode?: string; channel?: string }) {
    return this.referrals.bindReferral({ referredUserId: user.id, referralCode: String(body.referralCode || ""), channel: body.channel });
  }

  @Get("qr")
  async qr(@CurrentUser() user: AuthenticatedUser, @Query("room") room: string | undefined, @Res() response: any) {
    const { png } = await this.referrals.getInviteQr(user.id, String(room || ""));
    response.setHeader("content-type", "image/png");
    response.setHeader("cache-control", "no-store");
    response.send(png);
  }
}
