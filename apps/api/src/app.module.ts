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
import { ContinuousStoryV2Module } from "./continuous-story-v2/continuous-story-v2.module";
import { SoloStoryEngineModule } from "./solo-story-engine/solo-story-engine.module";
import { MetricsController } from "./observability/metrics.controller";

@Module({
  imports: [PrismaModule, AuthModule, CreditsModule, ReferralsModule, BillingModule, ContinuousStrategyModule, StoryAccessModule, ContinuousStoryV2Module, SoloStoryEngineModule, ResultSharingModule],
  controllers: [MvpCatalogController, StoryController, RoomsController, WorldsController, StoryTaskOutboxController, MetricsController],
  providers: [
    StoryService,
    StoryTaskOutboxService,
    RoomsService,
    PresenceHeartbeatRateLimitGuard
  ]
})
export class AppModule {}
