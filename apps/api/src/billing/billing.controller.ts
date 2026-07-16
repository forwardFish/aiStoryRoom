import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../auth/current-user.decorator";
import { BillingService } from "./billing.service";
import { BillingAdminGuard } from "./billing-admin.guard";

@Controller("v4/billing")
@UseGuards(AuthGuard)
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Post("checkouts")
  createCheckout(@CurrentUser() user: AuthenticatedUser, @Body() body: { packKey?: string; intent?: string; runId?: string; returnTo?: string }) {
    return this.billing.createCheckout(user, String(body.packKey || ""), body);
  }

  @Get("checkouts/:checkoutId")
  status(@CurrentUser() user: AuthenticatedUser, @Param("checkoutId") checkoutId: string) {
    return this.billing.getCheckoutStatus(user.id, { checkoutId });
  }

  @Get("checkout-status")
  statusByPurchase(@CurrentUser() user: AuthenticatedUser, @Query("purchase_id") purchaseId?: string, @Query("checkout_id") checkoutId?: string) {
    return this.billing.getCheckoutStatus(user.id, { purchaseId, checkoutId });
  }

  @Get("purchases")
  purchases(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.purchaseHistory(user.id);
  }

  @Post("refund-requests")
  requestRefund(@CurrentUser() user: AuthenticatedUser, @Body() body: { purchaseId?: string; reason?: string; message?: string }) {
    return this.billing.requestRefund(user.id, body || {});
  }
}

@Controller("v4/admin/refunds")
@UseGuards(AuthGuard, BillingAdminGuard)
export class BillingAdminController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Get()
  list(@Query("status") status?: string) {
    return this.billing.adminRefundRequests(status);
  }

  @Post(":requestId/approve")
  approve(@CurrentUser() user: AuthenticatedUser, @Param("requestId") requestId: string, @Body() body: { note?: string }) {
    return this.billing.approveRefund(user.id, requestId, body?.note);
  }

  @Post(":requestId/reject")
  reject(@CurrentUser() user: AuthenticatedUser, @Param("requestId") requestId: string, @Body() body: { note?: string }) {
    return this.billing.rejectRefund(user.id, requestId, body?.note);
  }
}
