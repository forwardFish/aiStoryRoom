import assert from "node:assert/strict";
import test from "node:test";
import { PRESSURE_CHAPTER_ROUTE_V1 } from "@ai-story/shared";
import { RoomsService } from "./rooms.service";

function createService(options: {
  room?: any;
  pressureGateway?: any;
  pressureHttp?: any;
  pressureSeatTransport?: any;
} = {}) {
  const room = options.room ?? {
    id: "pressure-room-1",
    mode: "room",
    title: "Pressure room",
    templateId: "sangtian-template",
    templateKey: "sangtian",
    status: "waiting_players",
    visibility: "public",
    inviteCode: "PRESS1",
    ownerUserId: "user-1",
    engineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
    strategyVersion: PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
    updatedAt: new Date("2026-08-11T00:00:00.000Z"),
    createdAt: new Date("2026-08-11T00:00:00.000Z"),
    players: [],
    roles: [{ id: "pressure-role-cabinet", roleKey: "cabinet_finance" }],
  };
  const prisma = {
    storyRun: {
      findUnique: async () => room,
      findMany: async () => [],
    },
  };
  const service = new RoomsService(
    prisma as never,
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
    {} as never,
    {} as never,
  );
  (service as any).pressureRoomsGateway = options.pressureGateway;
  (service as any).pressureHttp = options.pressureHttp;
  (service as any).pressureSeatTransport = options.pressureSeatTransport;
  return service;
}

test("pressure create, solo, join, select, ready, leave, and start dispatch through rooms-entry gateway with idempotency", async () => {
  const calls: Array<[string, any]> = [];
  const gateway = {
    createLobby: async (command: any) => {
      calls.push(["createLobby", command]);
      return {
        status: "CREATED",
        shell: {
          room: { runId: "pressure-created-1" },
        },
      };
    },
    createSoloShell: async (command: any) => {
      calls.push(["createSoloShell", command]);
      return {
        status: "CREATED",
        shell: {
          room: { runId: "pressure-solo-1" },
        },
      };
    },
    join: async (command: any) => {
      calls.push(["join", command]);
      return { status: "UPDATED" };
    },
    selectRole: async (command: any) => {
      calls.push(["selectRole", command]);
      return { status: "UPDATED" };
    },
    ready: async (command: any) => {
      calls.push(["ready", command]);
      return { status: "UPDATED" };
    },
    leave: async (command: any) => {
      calls.push(["leave", command]);
      return { status: "UPDATED" };
    },
    start: async (command: any) => {
      calls.push(["start", command]);
      return { status: "STARTED" };
    },
    getStatus: async () => ({
      schemaVersion: "pressure_lobby_status_v1",
      runId: "pressure-room-1",
      participantMode: "SOLO",
      ownerUserId: "user-1",
      lifecycle: "WAITING_PLAYERS",
      engineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
      strategyVersion: PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
      runtimeProfile: PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile,
      members: [{ userId: "user-1", joined: true, selectedSeatId: "cabinet_finance", ready: true }],
      seats: [],
    }),
    getStartStatus: async () => null,
  };
  const service = createService({ pressureGateway: gateway });
  (service as any).pressureRoomsGateway = gateway;
  (service as any).get = async (_user: unknown, roomId: string) => ({ id: roomId, roomId });

  await service.create({ id: "user-1" } as never, { worldId: "sangtian", title: "Pressure", idempotencyKey: "create-key-1" });
  await service.createSolo({ id: "user-1" } as never, { worldId: "sangtian", idempotencyKey: "solo-key-1", roleKey: "cabinet_finance" });
  await service.joinByCode({ id: "user-2" } as never, "PRESS1", "join-key-1");
  await service.selectRole({ id: "user-2" } as never, "pressure-room-1", "pressure-role-cabinet", "seat-key-1");
  await service.ready({ id: "user-2" } as never, "pressure-room-1", true, "ready-key-1");
  await service.leave({ id: "user-2" } as never, "pressure-room-1", { idempotencyKey: "leave-key-1" });
  await service.start({ id: "user-1" } as never, "pressure-room-1", { idempotencyKey: "start-key-1" });

  assert.deepEqual(calls.map(([name]) => name), [
    "createLobby",
    "createSoloShell",
    "start",
    "join",
    "selectRole",
    "ready",
    "leave",
    "start",
  ]);
  assert.equal(calls.filter(([name]) => name === "start")[0]![1].runId, "pressure-solo-1");
  assert.equal("runSeed" in calls.find(([name]) => name === "start")![1], false);
  assert.equal(calls.find(([name]) => name === "selectRole")![1].roleKey, "cabinet_finance");
});

test("pressure role selection accepts canonical keys and rejects unknown role identifiers", async () => {
  const calls: any[] = [];
  const service = createService({
    pressureGateway: {
      selectRole: async (command: any) => { calls.push(command); return { status: "UPDATED" }; },
    },
  });
  (service as any).get = async (_user: unknown, roomId: string) => ({ id: roomId });

  await service.selectRole(
    { id: "user-1" } as never,
    "pressure-room-1",
    "cabinet_finance",
    "canonical-seat-key-1",
  );
  assert.equal(calls[0].roleKey, "cabinet_finance");

  await assert.rejects(
    () => service.selectRole(
      { id: "user-1" } as never,
      "pressure-room-1",
      "unknown-role-id",
      "unknown-seat-key-1",
    ),
    (error: any) => error?.response?.code === "ROLE_NOT_FOUND",
  );
  assert.equal(calls.length, 1);
});

test("pressure game, result, action, chat, replay, and legacy slot routing delegate to pressure HTTP methods", async () => {
  const calls: Array<[string, any[]]> = [];
  const pressureHttp = {
    game: async (...args: any[]) => { calls.push(["game", args]); return { ok: true }; },
    narrativeUpdate: async (...args: any[]) => { calls.push(["narrativeUpdate", args]); return { ok: true }; },
    result: async (...args: any[]) => { calls.push(["result", args]); return { ok: true }; },
    action: async (...args: any[]) => { calls.push(["action", args]); return { ok: true }; },
    chat: async (...args: any[]) => { calls.push(["chat", args]); return { ok: true }; },
    replay: async (...args: any[]) => { calls.push(["replay", args]); return { ok: true }; },
    legacySlot: async (...args: any[]) => { calls.push(["legacySlot", args]); return { ok: true }; },
  };
  const service = createService({ pressureHttp });
  (service as any).pressureHttp = pressureHttp;

  await service.game({ id: "user-1" } as never, "pressure-room-1", "cursor-1", "5");
  await service.pressureNarrativeUpdate({ id: "user-1" } as never, "pressure-room-1", "chapter-runtime-1");
  await service.result({ id: "user-1" } as never, "pressure-room-1");
  await service.submitGameAction({ id: "user-1" } as never, "pressure-room-1", { idempotencyKey: "decision-1" } as any);
  await service.submitPressureChat({ id: "user-1" } as never, "pressure-room-1", { idempotencyKey: "chat-1" });
  await service.replayPressureRoom({ id: "user-1" } as never, "pressure-room-1", { idempotencyKey: "replay-1" });
  await service.submitMain({ id: "user-1" } as never, "pressure-room-1", {} as never);
  await service.submitManeuver({ id: "user-1" } as never, "pressure-room-1", {} as never);
  await service.submitReaction({ id: "user-1" } as never, "pressure-room-1", "event-1", {} as never);

  assert.deepEqual(calls.map(([name]) => name), [
    "game",
    "narrativeUpdate",
    "result",
    "action",
    "chat",
    "replay",
    "legacySlot",
    "legacySlot",
    "legacySlot",
  ]);
});

test("completed pressure game read authorizes through result and returns a terminal navigation envelope", async () => {
  const calls: Array<[string, any[]]> = [];
  const pressureHttp = {
    game: async (...args: any[]) => { calls.push(["game", args]); return { ok: true }; },
    result: async (...args: any[]) => { calls.push(["result", args]); return { ok: true }; },
  };
  const service = createService({
    room: {
      id: "pressure-room-1",
      engineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
      status: "completed",
    },
  });
  (service as any).pressureHttp = pressureHttp;

  const result = await service.game({ id: "user-1" } as never, "pressure-room-1");

  assert.deepEqual(calls, [["result", [{ id: "user-1" }, "pressure-room-1"]]]);
  assert.deepEqual(result, {
    schemaVersion: "pressure_chapter_game_terminal_v1",
    runId: "pressure-room-1",
    resultUrl: "/game/result?runId=pressure-room-1",
  });
});

test("Mine pressure query retains completed runs for result navigation", async () => {
  const service = createService();
  const queries: any[] = [];
  (service as any).prisma.storyRun.findMany = async (query: any) => {
    queries.push(query);
    return [];
  };

  assert.deepEqual(await service.mine({ id: "user-1" } as never), { rooms: [] });
  assert.equal(queries.length, 1);
  assert.deepEqual(
    queries[0].where.status.in,
    ["waiting_players", "playing", "chapter_generated", "completed"],
  );
  assert.deepEqual(queries[0].where.OR, [
    { players: { some: { userId: "user-1" } } },
    {
      engineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
      pressureLifecycle: {
        is: {
          lobbyJson: {
            path: ["joinedUserIds"],
            array_contains: ["user-1"],
          },
        },
      },
    },
  ]);
  assert.equal(queries[0].take, 50, "membership filtering happens before the page limit");
});

test("pressure explicitly fails closed for unsupported legacy waiting, close, and events endpoints", async () => {
  const service = createService();
  for (const action of [
    () => service.extendWaiting({ id: "user-1" } as never, "pressure-room-1", { idempotencyKey: "extend-key-1" }),
    () => service.playSoloFromWaitingRoom({ id: "user-1" } as never, "pressure-room-1", { idempotencyKey: "play-solo-key-1" }),
    () => service.close({ id: "user-1" } as never, "pressure-room-1"),
    () => service.events({ id: "user-1" } as never, "pressure-room-1"),
  ]) {
    await assert.rejects(
      action,
      (error: any) => error?.response?.code === "PRESSURE_LEGACY_ENDPOINT_DISABLED" || error?.code === "PRESSURE_LEGACY_ENDPOINT_DISABLED",
    );
  }
});

test("pressure seat snapshot and legacy presence/control endpoints delegate with subject and explicit fences", async () => {
  const calls: Array<[string, any]> = [];
  const pressureSeatTransport = {
    readSnapshot: async (input: any) => { calls.push(["readSnapshot", input]); return { ok: true }; },
    heartbeat: async (input: any) => { calls.push(["heartbeat", input]); return { ok: true }; },
    handoff: async (input: any) => { calls.push(["handoff", input]); return { ok: true }; },
    reclaim: async (input: any) => { calls.push(["reclaim", input]); return { ok: true }; },
  };
  const service = createService({ pressureSeatTransport });

  await service.pressureSeatSnapshot({ id: "user-1" } as never, "pressure-room-1", "transport-cursor", "12");
  await service.heartbeat({ id: "user-1" } as never, "pressure-room-1", {
    sessionInstanceId: "browser-session",
    heartbeatSequence: 7,
    lastAppliedDeliverySequence: 2,
  });
  await service.handoffToAi({ id: "user-1" } as never, "pressure-room-1", {
    idempotencyKey: "handoff-once",
    expectedControlEpoch: 4,
    expectedSubmissionFenceToken: "a".repeat(64),
  } as any);
  await service.reclaim({ id: "user-1" } as never, "pressure-room-1", {
    idempotencyKey: "reclaim-once",
    expectedControlEpoch: 5,
    expectedReclaimFenceToken: "b".repeat(64),
  } as any);

  assert.deepEqual(calls, [
    ["readSnapshot", { runId: "pressure-room-1", subjectId: "user-1", cursor: "transport-cursor", feedLimit: 12 }],
    ["heartbeat", {
      runId: "pressure-room-1",
      subjectId: "user-1",
      sessionId: "browser-session",
      signalSequence: 7,
      status: "ONLINE",
      idempotencyKey: "browser-session:presence:7:ONLINE",
    }],
    ["handoff", {
      runId: "pressure-room-1",
      subjectId: "user-1",
      expectedControlEpoch: 4,
      expectedSubmissionFenceToken: "a".repeat(64),
      idempotencyKey: "handoff-once",
    }],
    ["reclaim", {
      runId: "pressure-room-1",
      subjectId: "user-1",
      expectedControlEpoch: 5,
      expectedReclaimFenceToken: "b".repeat(64),
      idempotencyKey: "reclaim-once",
    }],
  ]);
});
