import {
  Body,
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

  @Post(":roomId/game/maneuvers")
  async submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param("roomId") roomId: string,
    @Body() body: OpenNovelManeuverCommand,
  ) {
    const result: any = await this.maneuvers.submit(user, roomId, body);
    return {
      ...result,
      gameProjection: await this.adapter.game(user, roomId),
    };
  }
}
