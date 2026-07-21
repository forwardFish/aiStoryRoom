import { Body, Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../auth/current-user.decorator";
import { RunSponsorshipService } from "./run-sponsorship.service";

@Controller("v4/story-runs/:runId")
@UseGuards(AuthGuard)
export class RunSponsorshipController {
  constructor(@Inject(RunSponsorshipService) private readonly sponsorships: RunSponsorshipService) {}

  @Get("credit-status")
  creditStatus(@CurrentUser() user: AuthenticatedUser, @Param("runId") runId: string) {
    return this.sponsorships.creditStatus(user, runId);
  }

  @Post("sponsorship-requests")
  createRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
    @Body() body: { idempotencyKey?: string; origin?: "FIRST_INSUFFICIENT" | "MANUAL" }
  ) {
    return this.sponsorships.createRequest(user, runId, body);
  }

  @Get("sponsorship-requests")
  listRequests(@CurrentUser() user: AuthenticatedUser, @Param("runId") runId: string) {
    return this.sponsorships.listForHost(user, runId);
  }

  @Post("sponsorship-requests/:requestId/approve")
  approve(@CurrentUser() user: AuthenticatedUser, @Param("runId") runId: string, @Param("requestId") requestId: string) {
    return this.sponsorships.approve(user, runId, requestId);
  }

  @Post("sponsorship-requests/:requestId/decline")
  decline(@CurrentUser() user: AuthenticatedUser, @Param("runId") runId: string, @Param("requestId") requestId: string) {
    return this.sponsorships.decline(user, runId, requestId);
  }
}
