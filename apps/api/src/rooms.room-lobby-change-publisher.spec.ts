import "reflect-metadata";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { PRESSURE_CHAPTER_ROUTE_V1 } from "@ai-story/shared";
import type { AuthenticatedUser } from "./auth/current-user.decorator";
import type {
  RoomLobbyChangeEventV1,
  RoomLobbyChangeReasonV1,
} from "./room-lobby-realtime/room-lobby-change.contract";
import type { RoomLobbyChangePublisherPortV1 } from "./room-lobby-realtime/room-lobby-change.publisher";
import { RoomsService } from "./rooms.service";

const USER: AuthenticatedUser = Object.freeze({
  id: "module-d-host",
  openid: "module-d-host-openid",
  email: "module-d@example.test",
  emailVerifiedAt: new Date("2026-08-16T00:00:00.000Z"),
  nickname: "Module D",
  authMethod: "PASSWORD",
  authIdentityId: null,
});
const ROOM_ID = "room_module_d_changes";
const ROLE_ID = "role-module-d";


test("Module D preserves the current v2 Pressure narrative update surface and existing RoomsService entry points", async () => {
  const source = await readFile(
    join(__dirname, "rooms.service.ts"),
    "utf8",
  );

  assert.match(source, /\n  async pressureNarrativeUpdate\s*\(/);
  for (const method of [
    "create",
    "joinByCode",
    "selectRole",
    "lockHostRole",
    "ready",
    "start",
    "extendWaiting",
    "playSoloFromWaitingRoom",
    "close",
    "game",
    "result",
    "submitGameAction",
    "pressureNarrativeUpdate",
    "leave",
  ]) {
    assert.match(source, new RegExp(`\\n  async ${method}\\s*\\(`));
  }
});

for (const testCase of [
  {
    name: "Pressure create publishes ROOM_CREATED only for CREATED",
    reason: "ROOM_CREATED" as const,
    statuses: ["CREATED", "EXISTING"] as const,
    invoke: async (service: RoomsService) => service.create(USER, {
      worldId: "sangtian",
      idempotencyKey: "create-module-d-0001",
    }),
    entryMethod: "createLobby" as const,
  },
  {
    name: "Pressure join publishes MEMBER_JOINED only for UPDATED",
    reason: "MEMBER_JOINED" as const,
    statuses: ["UPDATED", "EXISTING"] as const,
    invoke: async (service: RoomsService) => service.joinByCode(
      USER,
      "JOIN01",
      "join-module-d-0001",
    ),
    entryMethod: "join" as const,
  },
  {
    name: "Pressure role selection publishes ROLE_CHANGED only for UPDATED",
    reason: "ROLE_CHANGED" as const,
    statuses: ["UPDATED", "EXISTING"] as const,
    invoke: async (service: RoomsService) => service.selectRole(
      USER,
      ROOM_ID,
      ROLE_ID,
      "role-module-d-0001",
    ),
    entryMethod: "selectRole" as const,
  },
  {
    name: "Pressure Ready publishes READY_CHANGED only for UPDATED",
    reason: "READY_CHANGED" as const,
    statuses: ["UPDATED", "EXISTING"] as const,
    invoke: async (service: RoomsService) => service.ready(
      USER,
      ROOM_ID,
      true,
      "ready-module-d-0001",
    ),
    entryMethod: "ready" as const,
  },
  {
    name: "Pressure leave publishes MEMBER_LEFT only for UPDATED",
    reason: "MEMBER_LEFT" as const,
    statuses: ["UPDATED", "EXISTING"] as const,
    invoke: async (service: RoomsService) => service.leave(
      USER,
      ROOM_ID,
      { idempotencyKey: "leave-module-d-0001" },
    ),
    entryMethod: "leave" as const,
  },
  {
    name: "Pressure start publishes GAME_STARTED only for STARTED",
    reason: "GAME_STARTED" as const,
    statuses: ["STARTED", "EXISTING"] as const,
    invoke: async (service: RoomsService) => service.start(USER, ROOM_ID),
    entryMethod: "start" as const,
  },
] as const) {
  test(testCase.name, async () => {
    const state = pressureHarness(testCase.entryMethod, [...testCase.statuses]);

    await testCase.invoke(state.service);
    await testCase.invoke(state.service);
    await settle();

    assert.equal(state.writeCalls, 2);
    assertMinimalEvents(state.events, [testCase.reason]);
  });
}

test("legacy create publishes ROOM_CREATED only after the authoritative room update completes", async () => {
  const events: Readonly<RoomLobbyChangeEventV1>[] = [];
  const order: string[] = [];
  const service = createService({
    prisma: {
      storyRun: {
        async update() {
          order.push("write-committed");
          return { id: ROOM_ID };
        },
      },
    },
    story: {
      async createRun() {
        return { id: ROOM_ID, stateJson: {} };
      },
    },
    publisher: {
      async publish(event) {
        order.push("publish-called");
        events.push(event);
      },
    },
  });
  replaceGet(service);

  await service.create(
    USER,
    { worldId: "caesar", title: "Module D room" },
    { skipPublicIdempotency: true, skipRunCharge: true },
  );
  await settle();

  assert.deepEqual(order, ["write-committed", "publish-called"]);
  assertMinimalEvents(events, ["ROOM_CREATED"]);
});

test("legacy join uses StoryService's authoritative was-new result and suppresses replay notifications", async () => {
  const events: Readonly<RoomLobbyChangeEventV1>[] = [];
  const joinResults = [true, false];
  let writes = 0;
  const room = legacyRoom();
  const service = createService({
    prisma: {
      storyRun: { findUnique: async () => room },
      storyPlayer: {
        count: async () => 1,
        findUnique: async () => null,
      },
    },
    story: {
      async joinRun() {
        writes += 1;
        return { activeHumanCountIncremented: joinResults.shift() ?? false };
      },
    },
    publisher: recordingPublisher(events),
  });
  replaceGet(service);

  await service.joinByCode(USER, "JOIN01", "join-legacy-module-d");
  await service.joinByCode(USER, "JOIN01", "join-legacy-module-d");
  await settle();

  assert.equal(writes, 2);
  assertMinimalEvents(events, ["MEMBER_JOINED"]);
});

test("legacy role, host-lock, Ready, wait-extension, close, and start publish once after an actual write", async () => {
  const cases: Array<{
    reason: RoomLobbyChangeReasonV1;
    invoke: (service: RoomsService, state: ReturnType<typeof mutableLegacyState>) => Promise<unknown>;
  }> = [
    {
      reason: "ROLE_CHANGED",
      invoke: async (service, state) => {
        replaceInitialRoomRead(service, state.room);
        replaceWaitingMember(service, state.room);
        replaceTransaction(service, state);
        replaceClearReady(service, state);
        await service.selectRole(USER, ROOM_ID, ROLE_ID, "role-legacy-module-d");
        await service.selectRole(USER, ROOM_ID, ROLE_ID, "role-legacy-module-d");
      },
    },
    {
      reason: "START_STATE_CHANGED",
      invoke: async (service, state) => {
        replaceWaitingMember(service, state.room);
        await service.lockHostRole(USER, ROOM_ID);
        await service.lockHostRole(USER, ROOM_ID);
      },
    },
    {
      reason: "READY_CHANGED",
      invoke: async (service, state) => {
        replaceInitialRoomRead(service, { id: ROOM_ID, mode: "room", engineVersion: "legacy_v1" });
        replaceWaitingMember(service, state.room);
        await service.ready(USER, ROOM_ID, true, "ready-legacy-module-d");
        await service.ready(USER, ROOM_ID, true, "ready-legacy-module-d");
      },
    },
    {
      reason: "WAITING_EXTENDED",
      invoke: async (service, state) => {
        replacePressureCheck(service, false);
        replaceWaitingMember(service, state.room);
        const expected = state.room.stateJson.room.lobbyDeadlineAt;
        await service.extendWaiting(USER, ROOM_ID, {
          idempotencyKey: "waiting-legacy-module-d",
          expectedLobbyDeadlineAt: expected,
        });
        await assert.rejects(
          service.extendWaiting(USER, ROOM_ID, {
            idempotencyKey: "waiting-legacy-module-d",
          }),
          /waiting round has not ended/i,
        );
      },
    },
    {
      reason: "ROOM_CLOSED",
      invoke: async (service, state) => {
        replacePressureCheck(service, false);
        replaceWaitingMember(service, state.room);
        await service.close(USER, ROOM_ID);
      },
    },
    {
      reason: "GAME_STARTED",
      invoke: async (service, state) => {
        state.room.stateJson.room.hostRoleLocked = true;
        state.room.stateJson.room.readyUserIds = [USER.id, "module-d-guest"];
        state.room.players.push({
          id: "player-guest",
          userId: "module-d-guest",
          playerType: "human",
          roleId: "role-guest",
          role: { id: "role-guest", roleKey: "guest", roleName: "Guest" },
          user: { nickname: "Guest" },
          joinedAt: new Date(),
        });
        replaceInitialRoomRead(service, { engineVersion: "legacy_v1" });
        replaceWaitingMember(service, state.room);
        await service.start(USER, ROOM_ID);
      },
    },
  ];

  for (const testCase of cases) {
    const events: Readonly<RoomLobbyChangeEventV1>[] = [];
    const state = mutableLegacyState();
    const service = createService({
      prisma: state.prisma,
      publisher: recordingPublisher(events),
    });
    replaceGet(service);

    await testCase.invoke(service, state);
    await settle();

    assertMinimalEvents(events, [testCase.reason]);
    assert.equal(state.writeCount >= 1, true);
  }
});

test("a committed write remains successful when CHANGE_PUBLISH fails and is not executed twice", async () => {
  const state = mutableLegacyState();
  let publishCalls = 0;
  const service = createService({
    prisma: state.prisma,
    publisher: {
      async publish() {
        publishCalls += 1;
        throw new Error("fake Realtime failure");
      },
    },
  });
  replaceGet(service, { ok: true });
  replacePressureCheck(service, false);
  replaceWaitingMember(service, state.room);

  const result = await service.close(USER, ROOM_ID);
  await settle();

  assert.deepEqual(result, { ok: true });
  assert.equal(state.writeCount, 1);
  assert.equal(publishCalls, 1);
});

test("a failed authority write emits no invalidation", async () => {
  const events: Readonly<RoomLobbyChangeEventV1>[] = [];
  const room = mutableLegacyState().room;
  const service = createService({
    prisma: {
      storyRun: {
        findUnique: async () => ({ id: ROOM_ID, mode: "room", engineVersion: "legacy_v1" }),
        updateMany: async () => {
          throw new Error("authority write failed");
        },
      },
    },
    publisher: recordingPublisher(events),
  });
  replaceWaitingMember(service, room);
  replaceGet(service);

  await assert.rejects(
    service.ready(USER, ROOM_ID, true, "ready-write-failure"),
    /authority write failed/,
  );
  await settle();
  assert.deepEqual(events, []);
});

test("Ready and Start remain derived from the authoritative room projection", () => {
  const service = createService({});
  const state = mutableLegacyState();
  state.room.stateJson.room.readyUserIds = [USER.id, "module-d-guest"];
  state.room.stateJson.room.hostRoleLocked = true;
  state.room.players.push({
    id: "player-guest",
    userId: "module-d-guest",
    playerType: "human",
    roleId: "role-guest",
    role: { id: "role-guest", roleKey: "guest", roleName: "Guest" },
    user: { nickname: "Guest" },
    joinedAt: new Date(),
  });

  const project = (service as unknown as {
    project(room: unknown, viewerId: string): any;
  }).project.bind(service);
  const host = project(state.room, USER.id);
  const guest = project(state.room, "module-d-guest");

  assert.equal(host.readyHumanCount, 2);
  assert.equal(host.startEnabled, true);
  assert.equal(guest.readyHumanCount, 2);
  assert.equal(guest.startEnabled, false);
});

function pressureHarness(
  method: "createLobby" | "join" | "selectRole" | "ready" | "leave" | "start",
  statuses: string[],
) {
  const events: Readonly<RoomLobbyChangeEventV1>[] = [];
  let writeCalls = 0;
  const room = {
    ...legacyRoom(),
    engineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
    roles: [{ id: ROLE_ID, roleKey: "zhejiang_governor" }],
  };
  const entry = {
    supportsWorld: () => true,
    async createLobby() {
      writeCalls += 1;
      return {
        status: statuses.shift(),
        shell: { room: { runId: ROOM_ID } },
      };
    },
    async join() {
      writeCalls += 1;
      return { status: statuses.shift() };
    },
    async selectRole() {
      writeCalls += 1;
      return { status: statuses.shift() };
    },
    async ready() {
      writeCalls += 1;
      return { status: statuses.shift() };
    },
    async leave() {
      writeCalls += 1;
      return { status: statuses.shift() };
    },
    async start() {
      writeCalls += 1;
      return { status: statuses.shift() };
    },
  };
  const service = createService({
    prisma: {
      storyRun: { findUnique: async () => room },
    },
    publisher: recordingPublisher(events),
  });
  (service as unknown as { getPressureRoomsEntry(): unknown })
    .getPressureRoomsEntry = () => entry;
  (service as unknown as { requirePressureRoomsEntry(): unknown })
    .requirePressureRoomsEntry = () => entry;
  replaceGet(service);

  return {
    service,
    events,
    get writeCalls() {
      return writeCalls;
    },
    method,
  };
}

function createService(options: {
  prisma?: unknown;
  story?: unknown;
  publisher?: RoomLobbyChangePublisherPortV1;
}): RoomsService {
  return new RoomsService(
    (options.prisma ?? {}) as never,
    (options.story ?? {}) as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    undefined,
    undefined,
    undefined,
    undefined,
    options.publisher,
  );
}

function mutableLegacyState() {
  const room = legacyRoom();
  let writeCount = 0;
  const prisma = {
    storyRun: {
      findUnique: async () => room,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        writeCount += 1;
        applyData(room, data);
        return room;
      },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        writeCount += 1;
        applyData(room, data);
        return { count: 1 };
      },
    },
    async $transaction(operation: (tx: unknown) => Promise<unknown>) {
      return operation({
        storyPlayer: {
          findUnique: async () => room.players[0],
          update: async ({ data }: { data: { roleId: string } }) => {
            writeCount += 1;
            room.players[0].roleId = data.roleId;
            return room.players[0];
          },
        },
        storyRole: {
          update: async () => {
            writeCount += 1;
            return {};
          },
          updateMany: async () => {
            writeCount += 1;
            return { count: 1 };
          },
        },
      });
    },
  };
  return {
    room,
    prisma,
    get writeCount() {
      return writeCount;
    },
    incrementWrite() {
      writeCount += 1;
    },
  };
}

function legacyRoom(): any {
  const createdAt = new Date(Date.now() - 10 * 60_000);
  return {
    id: ROOM_ID,
    mode: "room",
    title: "Module D room",
    templateKey: "caesar",
    templateId: "caesar-template",
    status: "waiting_players",
    inviteCode: "JOIN01",
    visibility: "public",
    maxPlayers: 3,
    ownerUserId: USER.id,
    engineVersion: "legacy_v1",
    strategyVersion: "legacy_v1",
    accessLevel: "FREE_TRIAL",
    freeDecisionsUsed: 0,
    version: 1,
    stateJson: {
      room: {
        worldId: "caesar",
        readyUserIds: [],
        hostRoleLocked: false,
        minPlayers: 2,
        createdAt: createdAt.toISOString(),
        lobbyDeadlineAt: new Date(Date.now() - 1_000).toISOString(),
        roomExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
        waitingRound: 1,
      },
    },
    players: [{
      id: "player-host",
      userId: USER.id,
      playerType: "human",
      roleId: "role-host",
      role: { id: "role-host", roleKey: "host", roleName: "Host" },
      user: { nickname: "Host" },
      joinedAt: new Date(),
    }],
    roles: [
      { id: "role-host", roleKey: "host", roleName: "Host", status: "claimed", isAiControlled: false },
      { id: ROLE_ID, roleKey: "target", roleName: "Target", status: "available", isAiControlled: false },
      { id: "role-guest", roleKey: "guest", roleName: "Guest", status: "claimed", isAiControlled: false },
    ],
    updatedAt: new Date(),
  };
}

function applyData(target: any, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (
      value
      && typeof value === "object"
      && "increment" in value
    ) {
      target[key] = Number(target[key] ?? 0)
        + Number((value as { increment: number }).increment);
    } else {
      target[key] = structuredClone(value);
    }
  }
}

function replaceGet(service: RoomsService, value: unknown = { id: ROOM_ID }): void {
  (service as unknown as { get(): Promise<unknown> }).get = async () => value;
}

function replaceInitialRoomRead(service: RoomsService, value: unknown): void {
  const prisma = (service as unknown as { prisma: any }).prisma;
  prisma.storyRun ??= {};
  prisma.storyRun.findUnique = async () => value;
}

function replaceWaitingMember(service: RoomsService, room: unknown): void {
  (service as unknown as { requireWaitingMember(): Promise<unknown> })
    .requireWaitingMember = async () => room;
}

function replacePressureCheck(service: RoomsService, result: boolean): void {
  (service as unknown as { rejectIfPressureRoomId(): Promise<void> })
    .rejectIfPressureRoomId = async () => {
      if (result) throw new Error("unexpected Pressure route");
    };
}

function replaceTransaction(
  service: RoomsService,
  state: ReturnType<typeof mutableLegacyState>,
): void {
  (service as unknown as { prisma: any }).prisma.$transaction =
    state.prisma.$transaction;
}

function replaceClearReady(
  service: RoomsService,
  state: ReturnType<typeof mutableLegacyState>,
): void {
  (service as unknown as { clearReady(): Promise<void> }).clearReady = async () => {
    state.incrementWrite();
    state.room.stateJson.room.readyUserIds = [];
  };
}

function recordingPublisher(
  events: Readonly<RoomLobbyChangeEventV1>[],
): RoomLobbyChangePublisherPortV1 {
  return {
    async publish(event) {
      events.push(event);
    },
  };
}

function assertMinimalEvents(
  events: readonly Readonly<RoomLobbyChangeEventV1>[],
  reasons: readonly RoomLobbyChangeReasonV1[],
): void {
  assert.deepEqual(events.map((event) => event.reason), reasons);
  for (const event of events) {
    assert.equal(event.type, "room.invalidated");
    assert.equal(event.schemaVersion, "room_lobby_changed_v1");
    assert.equal(event.roomId, ROOM_ID);
    assert.match(event.eventId, /^evt_[A-Za-z0-9._:-]+$/);
    assert.equal(new Date(event.occurredAt).toISOString(), event.occurredAt);
    assert.deepEqual(Object.keys(event), [
      "type",
      "schemaVersion",
      "eventId",
      "roomId",
      "reason",
      "occurredAt",
    ]);
  }
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
