import assert from "node:assert/strict";
import test from "node:test";
import { getGameDefinition } from "@ai-story/templates";
import { CONTINUOUS_STORY_ENGINE_VERSION, PRESSURE_CHAPTER_ROUTE_V1, PRESSURE_CHAPTER_SEAT_IDS_V1 } from "@ai-story/shared";
import { RoomsService, compareSoloProgress, maskRoomCreatorLabel, roomTitleForCreate, sharedRoomRunIdForRequest, shouldResumeExistingSolo, soloCreationResponse, soloRunIdForRequest } from "./rooms.service";
import { publicWorldRolePresentation } from "./public-world-role-presentation";

const service = new RoomsService(
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
  {} as never
);

test("room projection uses the standard game definition for both worlds", () => {
  for (const worldId of ["caesar", "sangtian"]) {
    const definition = getGameDefinition(worldId);
    const firstRole = definition.roles[0];
    const publicPresentation = publicWorldRolePresentation(worldId, firstRole.roleKey, {
      name: firstRole.roleName,
      identity: firstRole.identity,
      publicInfo: firstRole.publicInfo,
      portrait: firstRole.portrait,
    });
    const roleId = `${worldId}-role-1`;
    const room = {
      id: `${worldId}-room`,
      title: "Sample room",
      templateKey: worldId,
      templateId: definition.templateId,
      status: "waiting_players",
      inviteCode: "CODE01",
      visibility: "public",
      maxPlayers: definition.roles.length,
      ownerUserId: "user-1",
      engineVersion: definition.engine.engineVersion,
      strategyVersion: definition.engine.strategyVersion,
      accessLevel: "free",
      freeDecisionsUsed: 0,
      stateJson: { room: { worldId, readyUserIds: [], hostRoleLocked: false, minPlayers: 1, createdAt: "2026-07-18T00:00:00.000Z" } },
      players: [{ id: "player-1", userId: "user-1", user: { nickname: "Player" }, playerType: "human", roleId, role: { roleKey: firstRole.roleKey, roleName: "stale database role name" }, joinedAt: new Date("2026-07-18T00:00:00.000Z") }],
      roles: [{ id: roleId, roleKey: firstRole.roleKey, roleName: "stale database role name", identity: "stale database identity", publicInfo: "stale database public info", personalGoal: "stale database goal", status: "claimed", isAiControlled: false }],
      createdAt: new Date("2026-07-18T00:00:00.000Z"),
      updatedAt: new Date("2026-07-18T00:00:00.000Z")
    };

    const projection = (service as unknown as { project: (value: unknown, viewerId: string) => any }).project(room, "user-1");
    assert.equal(projection.world.schemaVersion, "game_page_world_v1");
    assert.equal(projection.world.worldId, definition.worldId);
    assert.equal(projection.world.title, definition.catalog.title);
    assert.equal(projection.world.presentation.sceneBackground, definition.presentation.sceneBackground);
    assert.equal(projection.world.presentation.locationLabel, definition.presentation.locationLabel);
    assert.equal(projection.world.roles.length, definition.roles.length);
    assert.equal(projection.world.roles[0]?.portrait, publicPresentation.portrait);
    assert.equal(projection.world.roles[0]?.roleName, publicPresentation.name);
    assert.equal(projection.world.roles[0]?.identity, publicPresentation.identity);
    assert.equal(projection.world.roles[0]?.publicInfo, publicPresentation.publicInfo);
    assert.equal(
      projection.world.roles[0]?.gameplayProfile.characterName,
      worldId === "sangtian"
        ? publicPresentation.name
        : firstRole.gameplayProfile?.characterName || firstRole.roleName,
    );
    assert.equal(projection.roles[0]?.portrait, firstRole.portrait);
    assert.equal(projection.roles[0]?.roleName, firstRole.roleName);
    assert.equal(projection.roles[0]?.identity, firstRole.identity);
    assert.equal(projection.roles[0]?.publicInfo, firstRole.publicInfo);
    assert.equal(projection.roles[0]?.personalGoal, firstRole.personalGoal);
    assert.equal(projection.roles[0]?.gameplayProfile.characterName, firstRole.gameplayProfile?.characterName || firstRole.roleName);
    assert.equal(projection.players[0]?.roleName, firstRole.roleName);
    assert.equal(projection.roles[0]?.claimedByCurrentUser, true);
    assert.equal(projection.createdAt, "2026-07-18T00:00:00.000Z");
  }
});

test("Solo creation derives one stable run id per user idempotency key", () => {
  const first = soloRunIdForRequest("user-1", "solo-create:request-1");
  assert.equal(first, soloRunIdForRequest("user-1", "solo-create:request-1"));
  assert.notEqual(first, soloRunIdForRequest("user-1", "solo-create:request-2"));
  assert.notEqual(first, soloRunIdForRequest("user-2", "solo-create:request-1"));
  assert.match(first, /^solo_[a-f0-9]{32}$/);
});

test("shared room creation uses a separate stable database identity", () => {
  const roomId = sharedRoomRunIdForRequest("user-1", "room-create:request-1");
  assert.equal(roomId, sharedRoomRunIdForRequest("user-1", "room-create:request-1"));
  assert.notEqual(roomId, soloRunIdForRequest("user-1", "room-create:request-1"));
  assert.match(roomId, /^room_[a-f0-9]{32}$/);
});

test("new rooms use product room labels instead of a story-scene title", () => {
  assert.equal(roomTitleForCreate(undefined), "Shared Story Room");
  assert.equal(roomTitleForCreate(""), "Shared Story Room");
  assert.equal(roomTitleForCreate(undefined, "solo"), "Solo Story");
  assert.equal(roomTitleForCreate("  The Senate Decides  "), "The Senate Decides");
  assert.doesNotMatch(roomTitleForCreate(undefined), /没有影子的客人/);
});

test("public room list exposes masked creator metadata in newest-created order", async () => {
  const rows = [
    {
      id: "new-room",
      createdAt: new Date("2026-08-15T03:38:34.480Z"),
      owner: { nickname: "forward", email: "private@example.com" },
      players: [],
      roles: [],
      maxPlayers: 6,
    },
    {
      id: "old-room",
      createdAt: new Date("2026-08-14T03:38:34.480Z"),
      owner: { nickname: "", email: "reader@example.com" },
      players: [],
      roles: [],
      maxPlayers: 6,
    },
  ];
  let listQuery: any;
  const listService = new RoomsService(
    { storyRun: { findMany: async (query: any) => { listQuery = query; return rows; } } } as never,
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
  (listService as any).projectRooms = async (input: any[]) => input.map((room) => ({ id: room.id, roles: [] }));

  const result = await listService.list();

  assert.deepEqual(listQuery.orderBy, { createdAt: "desc" });
  assert.deepEqual(result.rooms.map((room: any) => room.id), ["new-room", "old-room"]);
  assert.equal(result.rooms[0]?.createdAt, "2026-08-15T03:38:34.480Z");
  assert.equal(result.rooms[0]?.creatorLabel, "forwa****rd");
  assert.equal(result.rooms[1]?.creatorLabel, "reade****er");
  assert.equal(JSON.stringify(result.rooms).includes("private@example.com"), false);
});

test("authenticated room lists keep owned and joined rooms out of Open Rooms", async () => {
  const publicRows = [{
    id: "other-room",
    createdAt: new Date("2026-08-15T04:00:00.000Z"),
    owner: { nickname: "Other Player", email: "other@example.com" },
    players: [],
    roles: [],
    maxPlayers: 6,
  }];
  const mineRows = [
    { id: "owned-room", roles: [] },
    { id: "joined-room", roles: [] },
  ];
  let publicQuery: any;
  let mineQuery: any;
  const listService = new RoomsService(
    {
      storyRun: {
        findMany: async (query: any) => {
          if (query.where.visibility === "public") {
            publicQuery = query;
            return publicRows;
          }
          mineQuery = query;
          return mineRows;
        },
      },
    } as never,
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
  (listService as any).projectRooms = async (input: any[]) => input.map((room) => ({ id: room.id, roles: [] }));

  const result = await listService.list(undefined, { id: "current-user" } as never);

  assert.deepEqual(result.rooms.map((room: any) => room.id), ["other-room"]);
  assert.deepEqual(result.myRooms.map((room: any) => room.id), ["owned-room", "joined-room"]);
  assert.ok(publicQuery.where.NOT.some((clause: any) => clause.ownerUserId === "current-user"));
  assert.ok(publicQuery.where.NOT.some((clause: any) => clause.players?.some?.userId === "current-user"));
  assert.ok(publicQuery.where.NOT.some((clause: any) => clause.pressureLifecycle?.is?.lobbyJson?.array_contains?.[0] === "current-user"));
  assert.ok(mineQuery.where.OR.some((clause: any) => clause.ownerUserId === "current-user"));
  assert.deepEqual(mineQuery.orderBy, { createdAt: "desc" });
});

test("room creator masking never exposes the email domain", () => {
  assert.equal(maskRoomCreatorLabel("forward"), "forwa****rd");
  assert.equal(maskRoomCreatorLabel("reader@example.com"), "reade****er");
  assert.equal(maskRoomCreatorLabel("李明"), "李*");
});

test("Solo creation response exposes every supported run identifier", () => {
  assert.deepEqual(soloCreationResponse("solo-1", { status: "playing", runId: "stale" }), {
    status: "playing",
    id: "solo-1",
    runId: "solo-1",
    roomId: "solo-1"
  });
});

test("Solo continue ranks real story progress ahead of a newer empty run", () => {
  const progressed = {
    id: "solo-progressed",
    worldSequence: 3,
    updatedAt: new Date("2026-07-19T01:00:00.000Z"),
    actorThreads: [{ role: { roleKey: "zhejiang_governor" }, currentStageIndex: 2, currentTurnIndex: 3 }],
    _count: { actionResolutions: 3 }
  };
  const newerButEmpty = {
    id: "solo-empty",
    worldSequence: 0,
    updatedAt: new Date("2026-07-19T07:00:00.000Z"),
    actorThreads: [{ role: { roleKey: "zhejiang_governor" }, currentStageIndex: 1, currentTurnIndex: 1 }],
    _count: { actionResolutions: 0 }
  };
  assert.deepEqual(
    [newerButEmpty, progressed].sort((left, right) => compareSoloProgress(left, right, "zhejiang_governor")),
    [progressed, newerButEmpty]
  );
});

test("Solo create resumes the furthest active first-role story without creating a room", async () => {
  let v2StartCalls = 0;
  const active = {
    id: "solo-progressed",
    ownerUserId: "user-1",
    templateKey: "sangtian",
    maxPlayers: 1,
    status: "playing",
    engineVersion: CONTINUOUS_STORY_ENGINE_VERSION,
    worldSequence: 2,
    updatedAt: new Date("2026-07-19T01:00:00.000Z"),
    players: [{ userId: "user-1", playerType: "human", role: { roleKey: "zhejiang_governor" } }],
    actorThreads: [{ role: { roleKey: "zhejiang_governor" }, currentStageIndex: 2, currentTurnIndex: 2 }],
    _count: { actionResolutions: 2 }
  };
  const prisma = {
    storyRun: {
      findMany: async () => [
        { ...active, id: "solo-newer-empty", worldSequence: 0, updatedAt: new Date("2026-07-19T07:00:00.000Z"), _count: { actionResolutions: 0 } },
        active
      ],
      findUnique: async () => ({ engineVersion: CONTINUOUS_STORY_ENGINE_VERSION })
    }
  };
  const storyV2 = {
    start: async (_user: unknown, runId: string) => {
      v2StartCalls += 1;
      return { status: "playing", gameProjection: { run: { id: runId } } };
    }
  };
  const resumableService = new RoomsService(
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
    storyV2 as never
  );
  (resumableService as unknown as { create: () => never }).create = () => { throw new Error("must not create a duplicate Solo run"); };
  const user = { id: "user-1", openid: "openid-1" } as never;
  const result = await resumableService.createSolo(user, { worldId: "sangtian", roleKey: "zhejiang_governor", idempotencyKey: "solo-create:test-resume" });
  assert.equal(result.id, "solo-progressed");
  assert.equal(result.runId, "solo-progressed");
  assert.equal((result as { resumedExisting?: boolean }).resumedExisting, true);
  assert.equal(v2StartCalls, 0);
});

test("Solo creation only resumes an unfinished run when the caller chose continue", () => {
  assert.equal(shouldResumeExistingSolo({}), true);
  assert.equal(shouldResumeExistingSolo({ resumeExisting: true }), true);
  assert.equal(shouldResumeExistingSolo({ resumeExisting: false }), false);
});

test("playing Story V2 start bypasses the waiting-room guard and delegates idempotently", async () => {
  let delegated = 0;
  const resumableService = new RoomsService(
    { storyRun: { findUnique: async () => ({ engineVersion: CONTINUOUS_STORY_ENGINE_VERSION }) } } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { start: async () => { delegated += 1; return { status: "playing" }; } } as never
  );
  const result = await resumableService.start({ id: "user-1" } as never, "solo-progressed");
  assert.equal(result.status, "playing");
  assert.equal(delegated, 1);
});

test("pressure room projection preserves room compatibility fields and shows joined-unseated members", async () => {
  const pressureService = new RoomsService(
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
    {} as never,
  );
  const lobbyStatus = {
      schemaVersion: "pressure_lobby_status_v1",
      runId: "pressure-room-1",
      participantMode: "MULTIPLAYER",
      ownerUserId: "user-1",
      lifecycle: "WAITING_PLAYERS",
      engineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
      strategyVersion: PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
      runtimeProfile: PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile,
      members: [
        { userId: "user-1", joined: true, selectedSeatId: "cabinet_finance", ready: true },
        { userId: "user-2", joined: true, selectedSeatId: null, ready: false },
      ],
      seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => ({
        seatId,
        roleKey: seatId,
        roleStatus: "claimed" as const,
        roleIsAiControlled: index !== 0,
        userId: index === 0 ? "user-1" : null,
        controllerId: index === 0 ? "user-1" : `ai-${seatId}`,
        controllerType: index === 0 ? "human" as const : "ai" as const,
        ready: index === 0,
      })),
    };
  const startStatus = {
      schemaVersion: "pressure_start_status_v1",
      runId: "pressure-room-1",
      phase: "STARTED",
      completedStages: ["FREEZE_ROUTE"],
      frozenHumanSeatSetHash: "a".repeat(64),
      routeHash: "b".repeat(64),
      genesisHash: null,
      seatControlStateHash: null,
      n1ChapterHash: null,
      lastFailure: null,
    };
  (pressureService as any).pressureRoomsGateway = {
    getRoomProjectionStatus: async () => ({ lobby: lobbyStatus, start: startStatus }),
  };
  const room = {
    id: "pressure-room-1",
    title: "Pressure room",
    templateKey: "sangtian",
    templateId: "sangtian-template",
    status: "waiting_players",
    inviteCode: "PRESS1",
    visibility: "public",
    maxPlayers: 6,
    ownerUserId: "user-1",
    engineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
    strategyVersion: PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
    accessLevel: "free",
    freeDecisionsUsed: 0,
    roles: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({ id: `role-${seatId}`, roleKey: seatId })),
    players: [],
    updatedAt: new Date("2026-08-11T00:00:00.000Z"),
    createdAt: new Date("2026-08-11T00:00:00.000Z"),
  };

  const projection = await (pressureService as unknown as { projectRoom: (room: unknown, viewerId: string, requireMembership?: boolean) => Promise<any> })
    .projectRoom(room, "user-2", true);
  assert.equal(projection.isPressure, true);
  assert.equal(projection.participantMode, "MULTIPLAYER");
  assert.equal(projection.runtimeProfile, PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile);
  assert.equal(projection.lifecycle, "WAITING_PLAYERS");
  assert.equal(projection.routeHash, "b".repeat(64));
  assert.equal(projection.players.some((player: any) => player.userId === "user-2" && player.joinedUnseated === true), true);
  assert.equal(projection.players.some((player: any) => player.userId === "user-1"), false);
  assert.equal(projection.ownerUserId, null);
  assert.deepEqual(projection.readyUserIds, []);
  assert.equal(projection.players.some((player: any) => player.id.includes("user-1") || player.id.includes("user-2")), false);
  assert.equal(projection.readyHumanCount, 1);
  assert.deepEqual(
    projection.roles.map((role: any) => role.roleKey),
    PRESSURE_CHAPTER_SEAT_IDS_V1,
  );
  assert.equal(projection.roles.some((role: any) => role.roleKey === "clerk" || role.roleKey === "xunfu"), false);
  assert.equal(projection.roles.every((role: any) => role.personalGoal === undefined), true);
  assert.equal(projection.roles.every((role: any) => role.knownInfo.length === 0 && role.gameplayProfile === undefined), true);
  assert.equal(projection.world.roles.every((role: any) => !("personalGoal" in role) && !("knownInfo" in role) && !("gameplayProfile" in role)), true);

  const ownerProjection = await (pressureService as unknown as { projectRoom: (room: unknown, viewerId: string, requireMembership?: boolean) => Promise<any> })
    .projectRoom(room, "user-1", true);
  assert.equal(ownerProjection.ownerUserId, "user-1");
  assert.equal(ownerProjection.players.some((player: any) => player.userId === "user-2"), false);
  assert.equal(ownerProjection.roles.find((role: any) => role.roleKey === "cabinet_finance")?.personalGoal.length > 0, true);
  assert.equal(ownerProjection.roles.filter((role: any) => role.roleKey !== "cabinet_finance").every((role: any) => role.personalGoal === undefined), true);
  assert.equal(ownerProjection.world.roles.find((role: any) => role.roleKey === "cabinet_finance")?.personalGoal.length > 0, true);
  assert.equal(ownerProjection.world.roles.filter((role: any) => role.roleKey !== "cabinet_finance").every((role: any) => !("personalGoal" in role)), true);

  await assert.rejects(
    () => (pressureService as unknown as { projectRoom: (room: unknown, viewerId: string, requireMembership?: boolean) => Promise<any> })
      .projectRoom({ ...room, templateKey: "caesar" }, "user-2", true),
    /PRESSURE_ROOM_CATALOG_MISMATCH/,
  );
});
