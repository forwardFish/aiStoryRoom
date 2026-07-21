import assert from "node:assert/strict";
import test from "node:test";
import { getGameDefinition } from "@ai-story/templates";
import { RoomsService, officialSoloRoleKey } from "./rooms.service";

const service = new RoomsService(
  {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  {} as never, {} as never, {} as never, {} as never, {} as never
);

function roomFixture({ deadlineOffsetMs = 5 * 60 * 1000, readyUserIds = ["host", "guest"] } = {}) {
  const definition = getGameDefinition("sangtian");
  const createdAt = new Date().toISOString();
  const roles = definition.roles.slice(0, 3).map((role, index) => ({
    id: `role-${index + 1}`,
    roleKey: role.roleKey,
    roleName: role.roleName,
    status: "claimed",
    isAiControlled: false
  }));
  const players = ["host", "guest", "late"].map((userId, index) => ({
    id: `player-${index + 1}`,
    userId,
    playerType: "human",
    roleId: `role-${index + 1}`,
    role: roles[index],
    user: { nickname: userId },
    joinedAt: new Date()
  }));
  return {
    id: "room-lobby-policy",
    title: "Shared Story Room",
    templateKey: "sangtian",
    templateId: definition.templateId,
    status: "waiting_players",
    inviteCode: "LOBBY1",
    visibility: "link",
    maxPlayers: 3,
    ownerUserId: "host",
    engineVersion: definition.engine.engineVersion,
    strategyVersion: definition.engine.strategyVersion,
    accessLevel: "free",
    freeDecisionsUsed: 0,
    stateJson: { room: {
      worldId: "sangtian",
      readyUserIds,
      hostRoleLocked: true,
      minPlayers: 2,
      createdAt,
      lobbyDeadlineAt: new Date(Date.now() + deadlineOffsetMs).toISOString(),
      roomExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      waitingRound: 1
    } },
    players,
    roles,
    updatedAt: new Date()
  };
}

test("Solo entry fixes each MVP world to its official role", () => {
  const sangtian = getGameDefinition("sangtian");
  const caesar = getGameDefinition("caesar");
  assert.equal(officialSoloRoleKey("sangtian", sangtian.roles), "zhejiang_governor");
  assert.equal(officialSoloRoleKey("caesar", caesar.roles), "brutus");
});

test("two ready humans may start even when a third joined player is not ready", () => {
  const projection = (service as unknown as { project: (room: unknown, viewerId: string) => any }).project(roomFixture(), "host");
  assert.equal(projection.minPlayers, 2);
  assert.equal(projection.maxPlayers, 3);
  assert.equal(projection.readyHumanCount, 2);
  assert.equal(projection.startEnabled, true);
  assert.equal(projection.canExtendWait, false);
  assert.equal(projection.canPlaySolo, false);
});

test("the host must be one of the ready players before Start is enabled", () => {
  const projection = (service as unknown as { project: (room: unknown, viewerId: string) => any }).project(
    roomFixture({ readyUserIds: ["guest", "late"] }),
    "host"
  );
  assert.equal(projection.readyHumanCount, 2);
  assert.equal(projection.startEnabled, false);
});

test("expired waiting round offers the host Solo or another five-minute wait only below two ready humans", () => {
  const projection = (service as unknown as { project: (room: unknown, viewerId: string) => any }).project(
    roomFixture({ deadlineOffsetMs: -1_000, readyUserIds: ["host"] }),
    "host"
  );
  assert.equal(projection.deadlineReached, true);
  assert.equal(projection.startEnabled, false);
  assert.equal(projection.canExtendWait, true);
  assert.equal(projection.canPlaySolo, true);
});
