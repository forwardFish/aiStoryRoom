import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PRESSURE_CHAPTER_ROUTE_V1 } from "@ai-story/shared";
import { findGameDefinition } from "@ai-story/templates";
import type { PressureProductionBridgeV1 } from "../production";
import type {
  PressureRoomsEntryProjectionDepsV1,
  PressureRoomsEntryStoryRunLikeV1,
} from "./contracts";
import { buildPressureRoomProjection, isPressureRoomRow } from "./projection";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;

export class PressureRoomsEntryAdapter {
  constructor(
    private readonly deps: PressureRoomsEntryProjectionDepsV1,
  ) {}

  supportsWorld(worldId: string): boolean {
    const world = findGameDefinition(worldId);
    return Boolean(
      world
      && world.status === "playable"
      && world.engine.engineVersion === PRESSURE_CHAPTER_ROUTE_V1.engineVersion
      && world.engine.strategyVersion === PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
    );
  }

  async createLobby(input: {
    userId: string;
    worldId: string;
    title?: string;
    visibility?: string;
    idempotencyKey?: string;
  }) {
    const world = requirePressureWorld(input.worldId);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey, "create.idempotencyKey");
    return this.deps.gateway.createLobby({
      runId: `room_${hashStable(`${input.userId}\0${idempotencyKey}`)}`,
      templateId: world.templateId,
      ownerUserId: input.userId,
      title: roomTitle(input.title, "shared"),
      inviteCode: inviteCodeFromStable(idempotencyKey),
      visibility: input.visibility === "private" ? "link" : "public",
      idempotencyKey,
    });
  }

  async createSoloShell(input: {
    userId: string;
    worldId: string;
    roleKey?: string;
    idempotencyKey?: string;
  }) {
    const world = requirePressureWorld(input.worldId);
    const roleKey = String(input.roleKey || world.roles[0]?.roleKey || "").trim();
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey, "solo.idempotencyKey");
    return this.deps.gateway.createSoloShell({
      runId: `solo_${hashStable(`${input.userId}\0${idempotencyKey}`)}`,
      templateId: world.templateId,
      ownerUserId: input.userId,
      title: roomTitle(undefined, "solo"),
      inviteCode: inviteCodeFromStable(idempotencyKey),
      visibility: "link",
      roleKey,
      humanControllerId: input.userId,
      idempotencyKey,
    });
  }

  async join(input: {
    runId: string;
    userId: string;
    idempotencyKey?: string;
  }) {
    return this.deps.gateway.join({
      runId: input.runId,
      userId: input.userId,
      idempotencyKey: requireIdempotencyKey(input.idempotencyKey, "join.idempotencyKey"),
    });
  }

  async selectRole(input: {
    runId: string;
    userId: string;
    roleKey: string;
    idempotencyKey?: string;
  }) {
    return this.deps.gateway.selectRole({
      runId: input.runId,
      userId: input.userId,
      roleKey: String(input.roleKey || "").trim(),
      humanControllerId: input.userId,
      idempotencyKey: requireIdempotencyKey(input.idempotencyKey, "select.idempotencyKey"),
    });
  }

  async ready(input: {
    runId: string;
    userId: string;
    ready: boolean;
    idempotencyKey?: string;
  }) {
    return this.deps.gateway.ready({
      runId: input.runId,
      userId: input.userId,
      ready: input.ready,
      idempotencyKey: requireIdempotencyKey(input.idempotencyKey, "ready.idempotencyKey"),
    });
  }

  async leave(input: {
    runId: string;
    userId: string;
    idempotencyKey?: string;
  }) {
    return this.deps.gateway.leave({
      runId: input.runId,
      userId: input.userId,
      idempotencyKey: requireIdempotencyKey(input.idempotencyKey, "leave.idempotencyKey"),
    });
  }

  async start(input: {
    runId: string;
    userId: string;
  }) {
    const lobby = await this.deps.gateway.getStatus({ runId: input.runId, viewerUserId: input.userId });
    if (!lobby) {
      throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    }
    return this.deps.gateway.start({
      runId: input.runId,
      requestedByUserId: input.userId,
      participantMode: lobby.participantMode,
      humanAssignments: lobby.seats
        .filter((seat) => seat.controllerType === "human" && seat.userId)
        .map((seat) => ({
          seatId: seat.seatId,
          userId: seat.userId!,
          humanControllerId: seat.controllerId,
        })),
      nowMs: Date.now(),
    });
  }

  async projectRoom(input: {
    room: PressureRoomsEntryStoryRunLikeV1;
    viewerId?: string;
    requireMembership?: boolean;
  }) {
    const status = await this.deps.gateway.getRoomProjectionStatus({
      runId: input.room.id,
      viewerUserId: input.viewerId ?? null,
    });
    if (!status) throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    const { lobby, start } = status;
    const isMember = lobby.ownerUserId === input.viewerId
      || lobby.members.some((member) => member.userId === input.viewerId);
    if (input.requireMembership && !isMember) {
      throw new ForbiddenException({ code: "ROOM_ACCESS_DENIED", message: "Join this room before viewing its private state" });
    }
    return buildPressureRoomProjection({
      room: input.room,
      lobby,
      start,
      viewerId: input.viewerId,
    });
  }

  isPressureRoomRow(room: Pick<PressureRoomsEntryStoryRunLikeV1, "engineVersion">) {
    return isPressureRoomRow(room);
  }
}

export function assertPressureRoomOrThrow(
  room: Pick<PressureRoomsEntryStoryRunLikeV1, "engineVersion">,
) {
  if (!isPressureRoomRow(room)) {
    throw new ConflictException({
      code: "PRESSURE_ROOM_REQUIRED",
      message: "This endpoint requires a Pressure room",
    });
  }
}

export function rejectPressureLegacyEndpoint(endpoint: string): never {
  throw new ConflictException({
    code: "PRESSURE_LEGACY_ENDPOINT_DISABLED",
    message: `${endpoint} is not supported for Pressure rooms`,
  });
}

function requirePressureWorld(worldId: string) {
  const world = findGameDefinition(worldId);
  if (
    !world
    || world.status !== "playable"
    || world.engine.engineVersion !== PRESSURE_CHAPTER_ROUTE_V1.engineVersion
    || world.engine.strategyVersion !== PRESSURE_CHAPTER_ROUTE_V1.strategyVersion
  ) {
    throw new NotFoundException({ code: "UNKNOWN_WORLD", message: "Unknown world" });
  }
  return world;
}

function requireIdempotencyKey(value: string | undefined, path: string): string {
  const key = String(value || "").trim();
  if (!IDEMPOTENCY_KEY.test(key)) {
    throw new ConflictException({ code: "INVALID_IDEMPOTENCY_KEY", message: `${path} is required` });
  }
  return key;
}

function roomTitle(title: string | undefined, kind: "shared" | "solo"): string {
  const trimmed = String(title || "").trim();
  return (trimmed || (kind === "solo" ? "Solo Story" : "Shared Story Room")).slice(0, 100);
}

function hashStable(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function inviteCodeFromStable(value: string): string {
  return hashStable(`invite\0${value}`).slice(0, 6).toUpperCase();
}

export function isPressureEngineVersion(engineVersion: string): boolean {
  return engineVersion === PRESSURE_CHAPTER_ROUTE_V1.engineVersion;
}
