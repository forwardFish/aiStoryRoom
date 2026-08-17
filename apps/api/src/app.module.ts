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
import { OpenNovelAdapterController } from "./openovel-adapter/openovel-adapter.controller";
import { OpenNovelAdapterService } from "./openovel-adapter/openovel-adapter.service";
import { OpenNovelManeuverAwareAdapterService } from "./openovel-adapter/openovel-maneuver-aware-adapter.service";
import { OpenNovelMirrorController } from "./openovel-adapter/openovel-mirror.controller";
import { OpenNovelRuntimeClient } from "./openovel-adapter/openovel-runtime.client";
import { OpenNovelSharedController } from "./openovel-adapter/openovel-shared.controller";
import { OpenNovelSharedService } from "./openovel-adapter/openovel-shared.service";
import { OpenNovelManeuverController } from "./openovel-adapter/openovel-maneuver.controller";
import { OpenNovelManeuverPreviewService } from "./openovel-adapter/openovel-maneuver-preview.service";
import { OpenNovelManeuverService } from "./openovel-adapter/openovel-maneuver.service";
import { installFourManeuverRuntime } from "./mvp-four-maneuver-runtime";
import { installFourManeuverResolution } from "./mvp-four-maneuver-resolution";
import { PressureChapterModule } from "./pressure-chapter/pressure-chapter.module";
import { RoomLobbyWebSocketGateway } from "./room-lobby-realtime/room-lobby-websocket.gateway";
import { RoomLobbyRealtimeModule } from "./room-lobby-realtime/room-lobby-realtime.module";
import { SupabaseRoomLobbyRealtimeService } from "./room-lobby-realtime/supabase-room-lobby-realtime.service";
import {
  ROOM_LOBBY_CHANGE_PUBLISHER_V1,
  SupabaseRoomLobbyChangePublisherV1,
} from "./room-lobby-realtime/room-lobby-change.publisher";

installFourManeuverRuntime();
installFourManeuverResolution();

const ROOM_LOBBY_REALTIME_GATEWAY_BINDING_V1 = Symbol(
  "ROOM_LOBBY_REALTIME_GATEWAY_BINDING_V1",
);

@Module({
  imports: [PrismaModule, AuthModule, CreditsModule, ReferralsModule, BillingModule, ContinuousStrategyModule, StoryAccessModule, ContinuousStoryV2Module, SoloStoryEngineModule, ResultSharingModule, PressureChapterModule.forRoot(), RoomLobbyRealtimeModule],
  controllers: [MvpCatalogController, StoryController, RoomsController, WorldsController, StoryTaskOutboxController, MetricsController, OpenNovelAdapterController, OpenNovelMirrorController, OpenNovelSharedController, OpenNovelManeuverController],
  providers: [
    StoryService,
    StoryTaskOutboxService,
    RoomsService,
    RoomLobbyWebSocketGateway,
    SupabaseRoomLobbyChangePublisherV1,
    {
      provide: ROOM_LOBBY_CHANGE_PUBLISHER_V1,
      useExisting: SupabaseRoomLobbyChangePublisherV1,
    },
    {
      provide: ROOM_LOBBY_REALTIME_GATEWAY_BINDING_V1,
      inject: [
        SupabaseRoomLobbyRealtimeService,
        RoomLobbyWebSocketGateway,
      ],
      useFactory: (
        realtime: SupabaseRoomLobbyRealtimeService,
        gateway: RoomLobbyWebSocketGateway,
      ) => {
        const unregister = realtime.registerLocalForwarder(
          (event) => gateway.forwardInvalidation(event),
        );
        return Object.freeze({ onModuleDestroy: unregister });
      },
    },
    PresenceHeartbeatRateLimitGuard,
    {
      provide: OpenNovelAdapterService,
      useClass: OpenNovelManeuverAwareAdapterService,
    },
    OpenNovelRuntimeClient,
    OpenNovelSharedService,
    OpenNovelManeuverService,
    OpenNovelManeuverPreviewService
  ]
})
export class AppModule {}
