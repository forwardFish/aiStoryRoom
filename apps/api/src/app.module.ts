import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { BillingModule } from "./billing/billing.module";
import { CreditsModule } from "./credits/credits.module";
import { MvpCatalogController } from "./mvp-catalog.controller";
import { ReferralsModule } from "./referrals/referrals.module";
import { StoryAccessModule } from "./story-access/story-access.module";
import { StoryController } from "./story.controller";
import { PrismaModule } from "./prisma.module";
import { StoryService } from "./story.service";
import { RoomsController } from "./rooms.controller";
import { RoomsService } from "./rooms.service";
import { WorldsController } from "./worlds.controller";
import { StoryTaskOutboxController } from "./story-task-outbox.controller";
import { StoryTaskOutboxService } from "./story-task-outbox.service";
import { ResultSharingModule } from "./result-sharing/result-sharing.module";
import { ContinuousStrategyModule } from "./continuous-strategy/continuous-strategy.module";
import { PresenceHeartbeatRateLimitGuard } from "./api-transport";

@Module({
  imports: [PrismaModule, AuthModule, CreditsModule, ReferralsModule, BillingModule, ContinuousStrategyModule, StoryAccessModule, ResultSharingModule],
  controllers: [MvpCatalogController, StoryController, RoomsController, WorldsController, StoryTaskOutboxController],
  providers: [
    StoryService,
    StoryTaskOutboxService,
    RoomsService,
    PresenceHeartbeatRateLimitGuard
  ]
})
export class AppModule {}
