import { Body, Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../auth/current-user.decorator";
import { B0SettlementPipelineService } from "../b0-settlement/b0-settlement-pipeline.service";
import { ManeuverV1Service } from "./maneuver-v1.service";

@UseGuards(AuthGuard)
@Controller("v4/rooms/:runId/maneuvers")
export class ManeuverV1Controller {
  constructor(
    @Inject(ManeuverV1Service) private readonly maneuvers: ManeuverV1Service,
    @Inject(B0SettlementPipelineService) private readonly b0Pipeline: B0SettlementPipelineService,
  ) {}

  @Get("projection")
  async projection(
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
  ) {
    await this.b0Pipeline.ensureRunWindow(runId);
    return this.b0Pipeline.withBoundedPlayerRead(`maneuver-projection:${runId}:${user.id}`, () =>
      this.maneuvers.projection(user, runId));
  }

  @Post("preview")
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    await this.b0Pipeline.ensureRunWindow(runId);
    return this.b0Pipeline.withBoundedPlayerOperation(() => this.maneuvers.preview(user, runId, body));
  }

  @Post("commit")
  async commit(
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    await this.b0Pipeline.ensureRunWindow(runId);
    return this.b0Pipeline.withBoundedPlayerOperation(() => this.maneuvers.commit(user, runId, body));
  }
}
