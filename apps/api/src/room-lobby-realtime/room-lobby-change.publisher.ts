import { Inject, Injectable } from "@nestjs/common";
import {
  assertRoomLobbyChangeEventV1,
  createRoomLobbyChangeEventV1,
  type CreateRoomLobbyChangeEventInputV1,
  type RoomLobbyChangeEventFactoryOptionsV1,
  type RoomLobbyChangeEventV1,
  type RoomLobbyChangeReasonV1,
} from "./room-lobby-change.contract";
import {
  SupabaseRoomLobbyRealtimeService,
  type RoomLobbyRealtimePublishResultV1,
} from "./supabase-room-lobby-realtime.service";

export const ROOM_LOBBY_CHANGE_PUBLISHER_V1 = Symbol(
  "ROOM_LOBBY_CHANGE_PUBLISHER_V1",
);
export const ROOM_LOBBY_CHANGE_PUBLISH_FAILURE_CODE_V1 =
  "CHANGE_PUBLISH" as const;

export interface RoomLobbyChangePublisherPortV1 {
  publish(event: Readonly<RoomLobbyChangeEventV1>): Promise<void>;
}

export type RoomLobbyChangePublishFailureKindV1 =
  | "CONTRACT_INVALID"
  | "BUS_REJECTED"
  | "NOT_CONNECTED"
  | "PUBLISH_FAILED"
  | "UNEXPECTED_RESULT";

export type RoomLobbyChangePublishFailureV1 = Readonly<{
  code: typeof ROOM_LOBBY_CHANGE_PUBLISH_FAILURE_CODE_V1;
  kind: RoomLobbyChangePublishFailureKindV1;
  roomId: string;
  reason: RoomLobbyChangeReasonV1;
}>;

export interface PublishRoomLobbyChangeAfterCommitOptionsV1
extends RoomLobbyChangeEventFactoryOptionsV1 {
  readonly onFailure?: (
    failure: RoomLobbyChangePublishFailureV1,
  ) => void;
}

export class RoomLobbyChangePublishErrorV1 extends Error {
  readonly code = ROOM_LOBBY_CHANGE_PUBLISH_FAILURE_CODE_V1;

  constructor(
    readonly kind: Exclude<
      RoomLobbyChangePublishFailureKindV1,
      "CONTRACT_INVALID"
    >,
  ) {
    super(`${ROOM_LOBBY_CHANGE_PUBLISH_FAILURE_CODE_V1}:${kind}`);
    this.name = "RoomLobbyChangePublishErrorV1";
  }
}

@Injectable()
export class NoopRoomLobbyChangePublisherV1
implements RoomLobbyChangePublisherPortV1 {
  async publish(event: Readonly<RoomLobbyChangeEventV1>): Promise<void> {
    assertRoomLobbyChangeEventV1(event);
  }
}

@Injectable()
export class SupabaseRoomLobbyChangePublisherV1
implements RoomLobbyChangePublisherPortV1 {
  constructor(
    @Inject(SupabaseRoomLobbyRealtimeService)
    private readonly realtime: SupabaseRoomLobbyRealtimeService,
  ) {}

  async publish(event: Readonly<RoomLobbyChangeEventV1>): Promise<void> {
    const normalized = assertRoomLobbyChangeEventV1(event);
    let result: RoomLobbyRealtimePublishResultV1;
    try {
      result = await this.realtime.publish(normalized);
    } catch {
      throw new RoomLobbyChangePublishErrorV1("BUS_REJECTED");
    }

    switch (result.status) {
      case "REALTIME_PUBLISHED":
      case "LOCAL_ONLY_DISABLED":
      case "LOCAL_ONLY_DEGRADED":
        return;
      case "LOCAL_ONLY_NOT_CONNECTED":
        throw new RoomLobbyChangePublishErrorV1("NOT_CONNECTED");
      case "LOCAL_ONLY_PUBLISH_FAILED":
        throw new RoomLobbyChangePublishErrorV1("PUBLISH_FAILED");
      default:
        throw new RoomLobbyChangePublishErrorV1("UNEXPECTED_RESULT");
    }
  }
}

/**
 * Runs only after the caller's authoritative lobby write has committed.
 * Notification construction, transport failures, and failure observation are
 * isolated from the already-committed business command and never reject it.
 */
export async function publishRoomLobbyChangeAfterCommitV1(
  publisher: RoomLobbyChangePublisherPortV1,
  input: Readonly<CreateRoomLobbyChangeEventInputV1>,
  options: Readonly<PublishRoomLobbyChangeAfterCommitOptionsV1> = {},
): Promise<boolean> {
  try {
    const event = createRoomLobbyChangeEventV1(input, {
      now: options.now,
      randomId: options.randomId,
    });
    await publisher.publish(event);
    return true;
  } catch (error) {
    const failure = Object.freeze({
      code: ROOM_LOBBY_CHANGE_PUBLISH_FAILURE_CODE_V1,
      kind: failureKind(error),
      roomId: input.roomId,
      reason: input.reason,
    });
    try {
      options.onFailure?.(failure);
    } catch {
      // Failure observers are diagnostics only and cannot affect the command.
    }
    return false;
  }
}

function failureKind(error: unknown): RoomLobbyChangePublishFailureKindV1 {
  if (error instanceof RoomLobbyChangePublishErrorV1) return error.kind;
  if (
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "EVENT_CONTRACT_INVALID"
  ) {
    return "CONTRACT_INVALID";
  }
  return "BUS_REJECTED";
}
