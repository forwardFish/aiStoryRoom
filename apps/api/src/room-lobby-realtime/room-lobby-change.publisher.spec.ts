import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import {
  createRoomLobbyChangeEventV1,
  type RoomLobbyChangeEventV1,
} from "./room-lobby-change.contract";
import {
  NoopRoomLobbyChangePublisherV1,
  ROOM_LOBBY_CHANGE_PUBLISH_FAILURE_CODE_V1,
  RoomLobbyChangePublishErrorV1,
  SupabaseRoomLobbyChangePublisherV1,
  publishRoomLobbyChangeAfterCommitV1,
} from "./room-lobby-change.publisher";
import type {
  RoomLobbyRealtimePublishResultV1,
  SupabaseRoomLobbyRealtimeService,
} from "./supabase-room-lobby-realtime.service";

const ROOM_ID = "room_module_d_publisher";
const OCCURRED_AT = "2026-08-16T00:00:00.000Z";
const EVENT_ID = "evt_00000000-0000-4000-8000-000000000401";

test("post-commit orchestration publishes exactly the Module A minimal event", async () => {
  const published: Readonly<RoomLobbyChangeEventV1>[] = [];
  const success = await publishRoomLobbyChangeAfterCommitV1(
    {
      async publish(event) {
        published.push(event);
      },
    },
    { roomId: ROOM_ID, reason: "READY_CHANGED" },
    {
      now: () => new Date(OCCURRED_AT),
      randomId: () => "00000000-0000-4000-8000-000000000401",
    },
  );

  assert.equal(success, true);
  assert.deepEqual(published, [{
    type: "room.invalidated",
    schemaVersion: "room_lobby_changed_v1",
    eventId: EVENT_ID,
    roomId: ROOM_ID,
    reason: "READY_CHANGED",
    occurredAt: OCCURRED_AT,
  }]);
  assert.deepEqual(Object.keys(published[0]!), [
    "type",
    "schemaVersion",
    "eventId",
    "roomId",
    "reason",
    "occurredAt",
  ]);
});

test("publisher rejection is attributed to CHANGE_PUBLISH and never rejects the committed command", async () => {
  const failures: unknown[] = [];
  const success = await publishRoomLobbyChangeAfterCommitV1(
    {
      async publish() {
        throw new Error("transport details must not escape");
      },
    },
    { roomId: ROOM_ID, reason: "MEMBER_JOINED" },
    {
      onFailure(failure) {
        failures.push(failure);
        throw new Error("diagnostic observer failure");
      },
    },
  );

  assert.equal(success, false);
  assert.deepEqual(failures, [{
    code: ROOM_LOBBY_CHANGE_PUBLISH_FAILURE_CODE_V1,
    kind: "BUS_REJECTED",
    roomId: ROOM_ID,
    reason: "MEMBER_JOINED",
  }]);
});

test("invalid post-commit input is isolated as CHANGE_PUBLISH contract failure", async () => {
  let publishCalls = 0;
  const failures: unknown[] = [];
  const success = await publishRoomLobbyChangeAfterCommitV1(
    {
      async publish() {
        publishCalls += 1;
      },
    },
    { roomId: " room-invalid ", reason: "ROOM_CREATED" },
    { onFailure: (failure) => failures.push(failure) },
  );

  assert.equal(success, false);
  assert.equal(publishCalls, 0);
  assert.deepEqual(failures, [{
    code: ROOM_LOBBY_CHANGE_PUBLISH_FAILURE_CODE_V1,
    kind: "CONTRACT_INVALID",
    roomId: " room-invalid ",
    reason: "ROOM_CREATED",
  }]);
});

test("Supabase adapter accepts published and explicit local-only degradation statuses", async () => {
  for (const status of [
    "REALTIME_PUBLISHED",
    "LOCAL_ONLY_DISABLED",
    "LOCAL_ONLY_DEGRADED",
  ] as const) {
    const calls: unknown[] = [];
    const adapter = new SupabaseRoomLobbyChangePublisherV1(
      fakeRealtime(status, calls),
    );
    const event = eventValue();

    await adapter.publish(event);

    assert.deepEqual(calls, [event]);
  }
});

test("Supabase adapter maps unavailable publication results to safe CHANGE_PUBLISH failures", async () => {
  const cases = [
    ["LOCAL_ONLY_NOT_CONNECTED", "NOT_CONNECTED"],
    ["LOCAL_ONLY_PUBLISH_FAILED", "PUBLISH_FAILED"],
  ] as const;

  for (const [status, kind] of cases) {
    const adapter = new SupabaseRoomLobbyChangePublisherV1(
      fakeRealtime(status, []),
    );
    await assert.rejects(
      adapter.publish(eventValue()),
      (error: unknown) => {
        assert.equal(error instanceof RoomLobbyChangePublishErrorV1, true);
        assert.equal(
          (error as RoomLobbyChangePublishErrorV1).code,
          ROOM_LOBBY_CHANGE_PUBLISH_FAILURE_CODE_V1,
        );
        assert.equal(
          (error as RoomLobbyChangePublishErrorV1).kind,
          kind,
        );
        return true;
      },
    );
  }
});

test("Noop publisher is an injectable rollback implementation that still validates the contract", async () => {
  const noop = new NoopRoomLobbyChangePublisherV1();
  await noop.publish(eventValue());
  await assert.rejects(
    noop.publish({ ...eventValue(), userId: "private-user" } as never),
    /EVENT_CONTRACT_INVALID/,
  );
});

function eventValue(): Readonly<RoomLobbyChangeEventV1> {
  return createRoomLobbyChangeEventV1({
    eventId: EVENT_ID,
    roomId: ROOM_ID,
    reason: "ROLE_CHANGED",
    occurredAt: OCCURRED_AT,
  });
}

function fakeRealtime(
  status: RoomLobbyRealtimePublishResultV1["status"],
  calls: unknown[],
): SupabaseRoomLobbyRealtimeService {
  return {
    async publish(value: unknown): Promise<RoomLobbyRealtimePublishResultV1> {
      calls.push(value);
      return Object.freeze({
        status,
        localRecipients: 0,
        realtimePublished: status === "REALTIME_PUBLISHED",
      });
    },
  } as unknown as SupabaseRoomLobbyRealtimeService;
}
