import { Controller, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../auth/current-user.decorator";
import { StoryAccessService } from "./story-access.service";

@Controller("v4/story-runs")
@UseGuards(AuthGuard)
export class StoryAccessController {
  constructor(@Inject(StoryAccessService) private readonly access: StoryAccessService) {}

  @Post(":runId/free-decision")
  freeDecision(@CurrentUser() user: AuthenticatedUser, @Param("runId") runId: string) {
    return this.access.freeDecision(user, runId);
  }

  @Post(":runId/unlock")
  unlock(@CurrentUser() user: AuthenticatedUser, @Param("runId") runId: string) {
    return this.access.unlock(user, runId);
  }
}
