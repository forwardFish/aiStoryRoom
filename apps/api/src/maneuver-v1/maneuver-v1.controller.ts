import { Body, Controller, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../auth/current-user.decorator";
import { ManeuverV1Service } from "./maneuver-v1.service";

@UseGuards(AuthGuard)
@Controller("v4/rooms/:runId/maneuvers")
export class ManeuverV1Controller {
  constructor(@Inject(ManeuverV1Service) private readonly maneuvers: ManeuverV1Service) {}

  @Post("preview")
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    return this.maneuvers.preview(user, runId, body);
  }

  @Post("commit")
  commit(
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    return this.maneuvers.commit(user, runId, body);
  }
}
