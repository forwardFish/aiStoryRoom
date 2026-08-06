import {
  Body,
  ConflictException,
  Controller,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../auth/current-user.decorator";
import { OpenNovelAdapterService } from "./openovel-adapter.service";
import { OpenNovelManeuverPreviewService } from "./openovel-maneuver-preview.service";
import type { OpenNovelManeuverCommand } from "./openovel-maneuver";

@UseGuards(AuthGuard)
@Controller("v4/rooms")
export class OpenNovelManeuverController {
  constructor(
    @Inject(OpenNovelManeuverPreviewService) private readonly maneuvers: OpenNovelManeuverPreviewService,
    @Inject(OpenNovelAdapterService) private readonly adapter: OpenNovelAdapterService,
  ) {}

  @Post(":roomId/game/maneuvers/preview")
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param("roomId") roomId: string,
    @Body() body: OpenNovelManeuverCommand,
  ) {
    const result = await this.maneuvers.preview(user, roomId, body);
    return {
      ...result,
      gameProjection: await this.adapter.game(user, roomId),
    };
  }

  @Post(":roomId/game/maneuvers/confirm")
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param("roomId") roomId: string,
    @Body() body: { previewToken?: unknown },
  ) {
    const result: any = await this.maneuvers.confirm(user, roomId, body.previewToken);
    return {
      ...result,
      gameProjection: await this.adapter.game(user, roomId),
    };
  }

  @Post(":roomId/game/maneuvers")
  directSubmitRemoved() {
    throw new ConflictException({
      code: "MANEUVER_PREVIEW_REQUIRED",
      message: "Create a server-authoritative maneuver preview before confirmation.",
    });
  }
}
