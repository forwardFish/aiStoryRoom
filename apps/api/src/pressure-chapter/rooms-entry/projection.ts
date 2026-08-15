import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
} from "@ai-story/shared";
import { findGameDefinition } from "@ai-story/templates";
import { gamePageProjection } from "../../game-page-projection";
import { publicWorldRolePresentation } from "../../public-world-role-presentation";
import type { PressureLobbyStatusV1, PressureStartStatusV1 } from "../production";
import type { PressureRoomsEntryStoryRunLikeV1 } from "./contracts";

export function isPressureRoomRow(room: Pick<PressureRoomsEntryStoryRunLikeV1, "engineVersion">): boolean {
  return room.engineVersion === PRESSURE_CHAPTER_ROUTE_V1.engineVersion;
}

export function buildPressureRoomProjection(input: {
  room: PressureRoomsEntryStoryRunLikeV1;
  lobby: PressureLobbyStatusV1;
  start: PressureStartStatusV1 | null;
  viewerId?: string;
}) {
  const { room, lobby, start, viewerId } = input;
  const world = findGameDefinition(room.templateKey);
  if (
    !world
    || world.engine.engineVersion !== PRESSURE_CHAPTER_ROUTE_V1.engineVersion
    || world.engine.strategyVersion !== PRESSURE_CHAPTER_ROUTE_V1.strategyVersion
    || lobby.engineVersion !== PRESSURE_CHAPTER_ROUTE_V1.engineVersion
    || lobby.strategyVersion !== PRESSURE_CHAPTER_ROUTE_V1.strategyVersion
    || lobby.runtimeProfile !== PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile
  ) {
    throw new Error("PRESSURE_ROOM_CATALOG_MISMATCH:route");
  }
  const configuredSeatIds = world.roles.map((role) => role.roleKey);
  const lobbySeatIds = lobby.seats.map((seat) => seat.seatId);
  if (
    configuredSeatIds.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length
    || lobbySeatIds.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length
    || PRESSURE_CHAPTER_SEAT_IDS_V1.some(
      (seatId) => !configuredSeatIds.includes(seatId) || !lobbySeatIds.includes(seatId),
    )
    || new Set(configuredSeatIds).size !== configuredSeatIds.length
    || new Set(lobbySeatIds).size !== lobbySeatIds.length
  ) {
    throw new Error("PRESSURE_ROOM_CATALOG_MISMATCH:seats");
  }
  const viewerSeatId = lobby.seats.find((seat) => seat.userId === viewerId)?.seatId ?? null;
  const rawPageWorld = gamePageProjection(world.worldId, viewerSeatId ?? undefined);
  const pageWorld = {
    ...rawPageWorld,
    roles: rawPageWorld.roles.map((role) => {
      if (role.roleKey === viewerSeatId) return role;
      const {
        personalGoal: _personalGoal,
        knownInfo: _knownInfo,
        gameplayProfile: _gameplayProfile,
        ...publicRole
      } = role;
      return publicRole;
    }),
  };
  const roleDefinitions = new Map(world.roles.map((role) => [role.roleKey, role]));
  const publicRolePresentations = new Map(world.roles.map((role) => [
    role.roleKey,
    publicWorldRolePresentation(world.worldId, role.roleKey, {
      name: role.roleName,
      identity: role.identity,
      publicInfo: role.publicInfo,
      portrait: role.portrait,
    }),
  ]));
  const roleRows = new Map(
    (((room.roles as Array<any> | undefined) ?? [])).map((role) => [role.roleKey, role]),
  );
  const memberByUserId = new Map(lobby.members.map((member) => [member.userId, member]));
  const seatByUserId = new Map(
    lobby.seats.flatMap((seat) => (seat.userId ? [[seat.userId, seat] as const] : [])),
  );
  const readyHumanCount = lobby.members.filter((member) => member.ready).length;
  const requiredHumans = lobby.participantMode === "SOLO" ? 1 : 2;
  const ownerSelectedSeat = seatByUserId.get(room.ownerUserId)?.seatId ?? null;
  const ownerReady = memberByUserId.get(room.ownerUserId)?.ready ?? false;
  const canStart = room.ownerUserId === viewerId
    && lobby.lifecycle === "WAITING_PLAYERS"
    && ownerSelectedSeat !== null
    && ownerReady
    && readyHumanCount >= requiredHumans;

  const memberPlayers = lobby.members.map((member) => {
    const seat = seatByUserId.get(member.userId) ?? null;
    const definition = seat ? roleDefinitions.get(seat.seatId) : null;
    const presentation = seat ? publicRolePresentations.get(seat.seatId) : null;
    const roleRow = seat ? roleRows.get(seat.seatId) : null;
    return {
      // A room projection is a player-facing read model. Internal account IDs
      // are authorization inputs, not participant-directory data. Keep the
      // current viewer's ID for backwards-compatible self matching, while
      // exposing every other participant through a room-local opaque ID.
      id: `pressure-member:${sha256Canonical({
        schemaVersion: "pressure_room_member_pseudonym_v1",
        runId: room.id,
        userId: member.userId,
      }).slice(0, 24)}`,
      userId: member.userId === viewerId ? member.userId : null,
      nickname: member.userId === room.ownerUserId ? "Host" : "Player",
      playerType: "human",
      roleId: roleRow?.id ?? seat?.seatId ?? null,
      roleKey: definition?.roleKey ?? seat?.seatId ?? null,
      roleName: presentation?.name ?? definition?.roleName ?? seat?.seatId ?? null,
      ready: member.ready,
      joinedAt: room.createdAt ?? room.updatedAt,
      joinedUnseated: member.selectedSeatId === null,
    };
  });
  const isTerminal = room.status === "chapter_generated" || room.status === "completed";
  const nextAction = lobby.lifecycle === "WAITING_PLAYERS"
    ? "open"
    : isTerminal
      ? "view_result"
      : "continue";
  return {
    id: room.id,
    title: room.title,
    worldId: room.templateKey,
    world: pageWorld,
    templateId: room.templateId,
    status: room.status,
    nextAction,
    inviteCode: room.inviteCode,
    code: room.inviteCode,
    visibility: room.visibility,
    maxPlayers: lobby.participantMode === "SOLO" ? 1 : PRESSURE_CHAPTER_SEAT_IDS_V1.length,
    minPlayers: requiredHumans,
    ownerUserId: room.ownerUserId === viewerId ? room.ownerUserId : null,
    isHost: room.ownerUserId === viewerId,
    hostRoleLocked: ownerSelectedSeat !== null,
    startEnabled: canStart,
    serverNow: new Date().toISOString(),
    lobbyDeadlineAt: null,
    roomExpiresAt: null,
    waitingRound: null,
    readyHumanCount,
    deadlineReached: false,
    expired: false,
    canExtendWait: false,
    canPlaySolo: false,
    engineVersion: room.engineVersion,
    strategyVersion: room.strategyVersion,
    accessLevel: room.accessLevel ?? undefined,
    freeDecisionsUsed: room.freeDecisionsUsed ?? undefined,
    readyUserIds: lobby.members
      .filter((member) => member.ready && member.userId === viewerId)
      .map((member) => member.userId),
    // A player is a real room member. An unclaimed seat may be AI-controlled
    // later, but that controller must not inflate the lobby participant count.
    players: memberPlayers,
    roles: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
      const definition = roleDefinitions.get(seatId);
      const presentation = publicRolePresentations.get(seatId);
      const roleRow = roleRows.get(seatId);
      const seat = lobby.seats.find((entry) => entry.seatId === seatId)!;
      return {
        id: roleRow?.id ?? seatId,
        roleKey: definition?.roleKey ?? seatId,
        roleName: presentation?.name ?? definition?.roleName ?? seatId,
        identity: presentation?.identity ?? definition?.identity ?? "",
        publicInfo: presentation?.publicInfo ?? definition?.publicInfo ?? "",
        personalGoal: seat.userId === viewerId
          ? definition?.personalGoal ?? ""
          : undefined,
        currentState: definition?.currentState ?? "",
        abilityText: definition?.abilityText ?? "",
        arcText: definition?.arcText ?? "",
        knownInfo: seat.userId === viewerId
          ? definition?.knownInfo ?? []
          : [],
        cannotDo: definition?.cannotDo ?? [],
        portrait: presentation?.portrait ?? definition?.portrait ?? "",
        gameplayProfile: seat.userId === viewerId && definition
          ? rawPageWorld.roles.find((item) => item.roleKey === definition.roleKey)?.gameplayProfile
          : undefined,
        status: seat.userId ? "claimed" : "available",
        humanSelectable: true,
        isAiControlled: seat.controllerType === "ai",
        claimedByCurrentUser: seat.userId === viewerId,
      };
    }),
    updatedAt: room.updatedAt,
    isPressure: true,
    participantMode: lobby.participantMode,
    runtimeProfile: lobby.runtimeProfile,
    lifecycle: lobby.lifecycle,
    routeHash: start?.routeHash ?? null,
  };
}
