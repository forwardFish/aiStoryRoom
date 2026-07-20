import assert from "node:assert/strict";
import test from "node:test";
import { getGameDefinition } from "@ai-story/templates";
import { CONTINUOUS_STORY_ENGINE_VERSION } from "@ai-story/shared";
import { RoomsService, compareSoloProgress, sharedRoomRunIdForRequest, shouldResumeExistingSolo, soloCreationResponse, soloRunIdForRequest } from "./rooms.service";

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
      updatedAt: new Date("2026-07-18T00:00:00.000Z")
    };

    const projection = (service as unknown as { project: (value: unknown, viewerId: string) => any }).project(room, "user-1");
    assert.equal(projection.world.schemaVersion, "game_page_world_v1");
    assert.equal(projection.world.worldId, definition.worldId);
    assert.equal(projection.world.title, definition.catalog.title);
    assert.equal(projection.world.presentation.sceneBackground, definition.presentation.sceneBackground);
    assert.equal(projection.world.presentation.locationLabel, definition.presentation.locationLabel);
    assert.equal(projection.world.roles.length, definition.roles.length);
    assert.equal(projection.world.roles[0]?.portrait, firstRole.portrait);
    assert.equal(projection.world.roles[0]?.gameplayProfile.characterName, firstRole.gameplayProfile?.characterName || firstRole.roleName);
    assert.equal(projection.roles[0]?.portrait, firstRole.portrait);
    assert.equal(projection.roles[0]?.roleName, firstRole.roleName);
    assert.equal(projection.roles[0]?.identity, firstRole.identity);
    assert.equal(projection.roles[0]?.publicInfo, firstRole.publicInfo);
    assert.equal(projection.roles[0]?.personalGoal, firstRole.personalGoal);
    assert.equal(projection.roles[0]?.gameplayProfile.characterName, firstRole.gameplayProfile?.characterName || firstRole.roleName);
    assert.equal(projection.players[0]?.roleName, firstRole.roleName);
    assert.equal(projection.roles[0]?.claimedByCurrentUser, true);
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
  assert.equal(v2StartCalls, 1);
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
