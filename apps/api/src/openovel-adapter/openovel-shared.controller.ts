import { Body, Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../auth/current-user.decorator";
import { OpenNovelSharedService } from "./openovel-shared.service";

@UseGuards(AuthGuard)
@Controller("v4/openovel/shared-runs")
export class OpenNovelSharedController {
  constructor(@Inject(OpenNovelSharedService) private readonly shared: OpenNovelSharedService) {}

  @Post(":runId/initialize")
  initialize(@CurrentUser() user: AuthenticatedUser, @Param("runId") runId: string) {
    return this.shared.initialize(user, runId);
  }

  @Get(":runId")
  getRun(@CurrentUser() user: AuthenticatedUser, @Param("runId") runId: string) {
    return this.shared.getRun(user, runId);
  }

  @Post(":runId/actions")
  action(
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.shared.submitAction(user, runId, body);
  }

  @Get(":runId/feed")
  feed(@CurrentUser() user: AuthenticatedUser, @Param("runId") runId: string) {
    return this.shared.feed(user, runId);
  }

  @Get(":runId/actions")
  actions(@CurrentUser() user: AuthenticatedUser, @Param("runId") runId: string) {
    return this.shared.actions(user, runId);
  }

  @Get(":runId/projection")
  projection(@CurrentUser() user: AuthenticatedUser, @Param("runId") runId: string) {
    return this.shared.projection(user, runId);
  }

  @Get(":runId/impact")
  impact(@CurrentUser() user: AuthenticatedUser, @Param("runId") runId: string) {
    return this.shared.impact(user, runId);
  }

  @Get(":runId/clues")
  clues(@CurrentUser() user: AuthenticatedUser, @Param("runId") runId: string) {
    return this.shared.clues(user, runId);
  }

  @Get(":runId/destiny-net")
  destinyNet(@CurrentUser() user: AuthenticatedUser, @Param("runId") runId: string) {
    return this.shared.destinyNet(user, runId);
  }
}
