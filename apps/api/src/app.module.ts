import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
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
import { OpenNovelAdapterController } from "./openovel-adapter/openovel-adapter.controller";
import { OpenNovelAdapterService } from "./openovel-adapter/openovel-adapter.service";
import { OpenNovelMirrorController } from "./openovel-adapter/openovel-mirror.controller";
import { OpenNovelRuntimeClient } from "./openovel-adapter/openovel-runtime.client";
import { OpenNovelSharedController } from "./openovel-adapter/openovel-shared.controller";
import { OpenNovelSharedService } from "./openovel-adapter/openovel-shared.service";
import { IntegritySoloEndingResultService } from "./openovel-adapter/integrity-solo-ending-result.service";
import { OpenNovelTurnReplayClient } from "./openovel-adapter/openovel-turn-replay.client";
import { ReconciledOpenNovelAdapterService } from "./openovel-adapter/reconciled-openovel-adapter.service";
import { SoloEndingResultInterceptor } from "./openovel-adapter/solo-ending-result.interceptor";
import { SoloEndingResultService } from "./openovel-adapter/solo-ending-result.service";

@Module({
  imports: [PrismaModule, AuthModule, CreditsModule, ReferralsModule, BillingModule, ContinuousStrategyModule, StoryAccessModule, ContinuousStoryV2Module, SoloStoryEngineModule, ResultSharingModule],
  controllers: [MvpCatalogController, StoryController, RoomsController, WorldsController, StoryTaskOutboxController, MetricsController, OpenNovelAdapterController, OpenNovelMirrorController, OpenNovelSharedController],
  providers: [
    StoryService,
    StoryTaskOutboxService,
    RoomsService,
    PresenceHeartbeatRateLimitGuard,
    {
      provide: OpenNovelAdapterService,
      useClass: ReconciledOpenNovelAdapterService,
    },
    OpenNovelRuntimeClient,
    OpenNovelTurnReplayClient,
    OpenNovelSharedService,
    {
      provide: SoloEndingResultService,
      useClass: IntegritySoloEndingResultService,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: SoloEndingResultInterceptor,
    },
  ]
})
export class AppModule {}
