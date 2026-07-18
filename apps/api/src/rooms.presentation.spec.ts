import assert from "node:assert/strict";
import test from "node:test";
import { getGameDefinition } from "@ai-story/templates";
import { RoomsService } from "./rooms.service";

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
    assert.deepEqual(projection.world, {
      title: definition.catalog.title,
      bannerArtwork: definition.presentation.sceneBackground
    });
    assert.equal(projection.roles[0]?.portrait, firstRole.portrait);
    assert.equal(projection.roles[0]?.roleName, firstRole.roleName);
    assert.equal(projection.roles[0]?.identity, firstRole.identity);
    assert.equal(projection.roles[0]?.publicInfo, firstRole.publicInfo);
    assert.equal(projection.roles[0]?.personalGoal, firstRole.personalGoal);
    assert.equal(projection.players[0]?.roleName, firstRole.roleName);
    assert.equal(projection.roles[0]?.claimedByCurrentUser, true);
  }
});
