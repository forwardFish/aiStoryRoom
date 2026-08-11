import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../auth/current-user.decorator";
import { B0SettlementPipelineService } from "./b0-settlement-pipeline.service";
import { B0WindowPlayerService } from "./b0-window-player.service";

@UseGuards(AuthGuard)
@Controller("v4/rooms")
export class B0WindowPlayerController {
  constructor(
    @Inject(B0WindowPlayerService) private readonly windows: B0WindowPlayerService,
    @Inject(B0SettlementPipelineService) private readonly pipeline: B0SettlementPipelineService,
  ) {}

  @Get(":runId/b0/window")
  async projection(
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
  ) {
    await this.pipeline.ensureRunWindow(runId);
    return this.pipeline.withBoundedPlayerRead(`b0-window:${runId}:${user.id}`, () =>
      this.windows.projection(user, runId));
  }

  @Post(":runId/b0/window/preview")
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    await this.pipeline.ensureRunWindow(runId);
    return this.pipeline.withBoundedPlayerOperation(() => this.windows.preview(user, runId, body));
  }

  @Post(":runId/b0/window/confirm")
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    await this.pipeline.ensureRunWindow(runId);
    return this.pipeline.withBoundedPlayerOperation(() => this.windows.confirm(user, runId, body));
  }

  @Post(":runId/b0/window/ready")
  async ready(
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    await this.pipeline.ensureRunWindow(runId);
    return this.pipeline.withBoundedPlayerOperation(() => this.windows.ready(user, runId, body));
  }

  @Delete(":runId/b0/window/ready")
  async unready(
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    await this.pipeline.ensureRunWindow(runId);
    return this.pipeline.withBoundedPlayerOperation(() => this.windows.unready(user, runId, body));
  }
}
