import { Body, Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../auth/current-user.decorator";
import { BillingService } from "./billing.service";

@Controller("v4/billing")
@UseGuards(AuthGuard)
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Post("checkouts")
  createCheckout(@CurrentUser() user: AuthenticatedUser, @Body() body: { packKey?: string }) {
    return this.billing.createCheckout(user, String(body.packKey || ""));
  }

  @Get("checkouts/:checkoutId")
  status(@CurrentUser() user: AuthenticatedUser, @Param("checkoutId") checkoutId: string) {
    return this.billing.getCheckoutStatus(user.id, checkoutId);
  }
}
