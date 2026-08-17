import { Module } from "@nestjs/common";
import { resolveRoomLobbyRealtimeConfigV1 } from "./room-lobby-realtime.config";
import {
  ROOM_LOBBY_REALTIME_METRIC_SINK_V1,
  ROOM_LOBBY_REALTIME_OPERATIONAL_METRIC_SINK_V1,
  RoomLobbyRealtimeMetricsV1,
} from "./room-lobby-realtime.metrics";
import {
  ROOM_LOBBY_REALTIME_CONFIG_V1,
  ROOM_LOBBY_REALTIME_RUNTIME_V1,
  ROOM_LOBBY_REALTIME_TRANSPORT_FACTORY_V1,
  SupabaseRoomLobbyRealtimeService,
  SupabaseRoomLobbyRealtimeTransportFactoryV1,
  type RoomLobbyRealtimeRuntimeV1,
} from "./supabase-room-lobby-realtime.service";

const SYSTEM_RUNTIME: RoomLobbyRealtimeRuntimeV1 = Object.freeze({
  now: () => Date.now(),
  random: () => Math.random(),
  setTimeout(callback: () => void, delayMs: number) {
    const timer = setTimeout(callback, delayMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    return timer;
  },
  clearTimeout(handle: unknown) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
});

@Module({
  providers: [
    {
      provide: ROOM_LOBBY_REALTIME_CONFIG_V1,
      useFactory: () => resolveRoomLobbyRealtimeConfigV1(process.env),
    },
    {
      provide: ROOM_LOBBY_REALTIME_METRIC_SINK_V1,
      useValue: ROOM_LOBBY_REALTIME_OPERATIONAL_METRIC_SINK_V1,
    },
    RoomLobbyRealtimeMetricsV1,
    {
      provide: ROOM_LOBBY_REALTIME_RUNTIME_V1,
      useValue: SYSTEM_RUNTIME,
    },
    {
      provide: ROOM_LOBBY_REALTIME_TRANSPORT_FACTORY_V1,
      useClass: SupabaseRoomLobbyRealtimeTransportFactoryV1,
    },
    SupabaseRoomLobbyRealtimeService,
  ],
  exports: [SupabaseRoomLobbyRealtimeService],
})
export class RoomLobbyRealtimeModule {}
