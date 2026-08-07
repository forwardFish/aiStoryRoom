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
import { B0WindowPlayerService } from "./b0-window-player.service";

@UseGuards(AuthGuard)
@Controller("v4/rooms")
export class B0WindowPlayerController {
  constructor(@Inject(B0WindowPlayerService) private readonly windows: B0WindowPlayerService) {}

  @Get(":runId/b0/window")
  projection(
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
  ) {
    return this.windows.projection(user, runId);
  }

  @Post(":runId/b0/window/preview")
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    return this.windows.preview(user, runId, body);
  }

  @Post(":runId/b0/window/confirm")
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    return this.windows.confirm(user, runId, body);
  }

  @Post(":runId/b0/window/ready")
  ready(
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    return this.windows.ready(user, runId, body);
  }

  @Delete(":runId/b0/window/ready")
  unready(
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    return this.windows.unready(user, runId, body);
  }
}
