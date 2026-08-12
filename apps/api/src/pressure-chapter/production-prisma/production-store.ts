import { PRESSURE_CHAPTER_SEAT_IDS_V1, type SeatIdV1 } from "@ai-story/shared";
import type {
  PressureLobbyStatusV1,
  PressureStartStatusV1,
} from "../production/production-bridge";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "../persistence/errors";
import {
  decodePressureRunLifecycleRow,
  designatedPressureAiControllerId,
  type DecodedPressureRunLifecycleV1,
} from "./lifecycle-state";
import type {
  PressureProductionPlayerRow,
  PressureProductionRoleRow,
  PressureProductionStoryRunRow,
  PressureProductionTransaction,
} from "./prisma-ports";

export interface PressureProductionSnapshotV1 {
  run: PressureProductionStoryRunRow;
  lifecycle: DecodedPressureRunLifecycleV1;
  roles: Map<SeatIdV1, PressureProductionRoleRow>;
  players: Map<SeatIdV1, PressureProductionPlayerRow>;
}

export async function readPressureProductionSnapshot(
  tx: PressureProductionTransaction,
  runId: string,
): Promise<PressureProductionSnapshotV1 | null> {
  const [run, lifecycleRow, roles, players] = await Promise.all([
    tx.storyRun.findUnique({ where: { id: runId }, select: storyRunSelect() }),
    tx.pressureRunLifecycle.findUnique({ where: { runId } }),
    tx.storyRole.findMany({ where: { runId }, select: roleSelect() }),
    tx.storyPlayer.findMany({ where: { runId }, select: playerSelect() }),
  ]);
  if (!run && !lifecycleRow && roles.length === 0 && players.length === 0) return null;
  if (!run || !lifecycleRow) {
    throw invalid("Pressure Run shell is only partially persisted", { runId });
  }
  const lifecycle = decodePressureRunLifecycleRow(lifecycleRow);
  if (
    run.id !== runId ||
    run.engineVersion !== lifecycle.state.engineVersion ||
    run.strategyVersion !== lifecycle.state.strategyVersion ||
    run.templateKey !== lifecycle.shell.room.templateKey ||
    run.ownerUserId !== lifecycle.shell.room.ownerUserId
  ) {
    throw invalid("StoryRun does not match PressureRunLifecycle", { runId });
  }
  const rolesBySeat = canonicalRoleMap(roles, runId);
  const playersBySeat = canonicalPlayerMap(players, rolesBySeat, runId);
  const snapshot = { run, lifecycle, roles: rolesBySeat, players: playersBySeat };
  assertControllerSlots(snapshot);
  return snapshot;
}

export function buildPressureLobbyStatus(
  snapshot: PressureProductionSnapshotV1,
): PressureLobbyStatusV1 {
  const { state } = snapshot.lifecycle;
  const selectedBySeat = new Map(
    state.lobby.selectedSeats.map((selected) => [selected.seatId, selected]),
  );
  const selectedByUser = new Map(
    state.lobby.selectedSeats.map((selected) => [selected.userId, selected]),
  );
  const ready = new Set(state.lobby.readyUserIds);
  return {
    schemaVersion: "pressure_lobby_status_v1",
    runId: snapshot.run.id,
    participantMode: state.participantMode,
    ownerUserId: snapshot.run.ownerUserId,
    lifecycle: state.lifecycle,
    engineVersion: state.engineVersion,
    strategyVersion: state.strategyVersion,
    runtimeProfile: state.runtimeProfile,
    members: state.lobby.joinedUserIds.map((userId) => ({
      userId,
      joined: true,
      selectedSeatId: selectedByUser.get(userId)?.seatId ?? null,
      ready: ready.has(userId),
    })),
    seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
      const role = snapshot.roles.get(seatId)!;
      const player = snapshot.players.get(seatId)!;
      const selected = selectedBySeat.get(seatId);
      const human = player.playerType === "human";
      return {
        seatId,
        roleKey: seatId,
        roleStatus: "claimed" as const,
        roleIsAiControlled: role.isAiControlled,
        userId: player.userId,
        controllerId: human
          ? selected!.humanControllerId
          : designatedPressureAiControllerId(snapshot.run.id, seatId),
        controllerType: human ? ("human" as const) : ("ai" as const),
        ready: player.userId !== null && ready.has(player.userId),
      };
    }),
  };
}

export function buildPressureStartStatus(
  snapshot: PressureProductionSnapshotV1,
): PressureStartStatusV1 {
  const start = snapshot.lifecycle.state.start;
  return {
    schemaVersion: "pressure_start_status_v1",
    runId: snapshot.run.id,
    phase: start.phase,
    completedStages: [...start.completedStages],
    frozenHumanSeatSetHash: start.frozenHumanSeatSet?.freezeHash ?? null,
    routeHash: start.routeHash,
    genesisHash: start.genesisHash,
    seatControlStateHash: start.seatControlStateHash,
    n1ChapterHash: start.n1ChapterHash,
    lastFailure: start.lastFailure
      ? {
          failedStage: start.lastFailure.failedStage,
          errorCode: start.lastFailure.errorCode,
        }
      : null,
  };
}

export async function casPressureLifecycle(
  tx: PressureProductionTransaction,
  decoded: DecodedPressureRunLifecycleV1,
  data: Record<string, unknown>,
): Promise<void> {
  const updated = await tx.pressureRunLifecycle.updateMany({
    where: {
      runId: decoded.row.runId,
      version: decoded.row.version,
      stateHash: decoded.row.stateHash,
    },
    data,
  });
  if (updated.count !== 1) throw new SerializableCasRetryError("lifecycle");
}

export async function casPressureStoryRun(
  tx: PressureProductionTransaction,
  run: PressureProductionStoryRunRow,
  data: Record<string, unknown>,
): Promise<void> {
  const updated = await tx.storyRun.updateMany({
    where: { id: run.id, version: run.version },
    data: { ...data, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw new SerializableCasRetryError("storyRun");
}

export function assertLobbyMutable(snapshot: PressureProductionSnapshotV1): void {
  const state = snapshot.lifecycle.state;
  if (
    state.routeFreeze !== "UNFROZEN" ||
    !(
      state.start.phase === "NOT_STARTED" ||
      (state.start.phase === "FAILED" && !state.start.frozenHumanSeatSet)
    )
  ) {
    throw fence("Pressure lobby is frozen at the start boundary", {
      runId: snapshot.run.id,
      phase: state.start.phase,
      routeFreeze: state.routeFreeze,
    });
  }
}

export function assertControllerSlots(snapshot: PressureProductionSnapshotV1): void {
  const selectedBySeat = new Map(
    snapshot.lifecycle.state.lobby.selectedSeats.map((selected) => [
      selected.seatId,
      selected,
    ]),
  );
  for (const seatId of PRESSURE_CHAPTER_SEAT_IDS_V1) {
    const role = snapshot.roles.get(seatId)!;
    const player = snapshot.players.get(seatId)!;
    const selected = selectedBySeat.get(seatId);
    if (selected) {
      if (
        role.status !== "claimed" ||
        role.isAiControlled ||
        player.userId !== selected.userId ||
        player.playerType !== "human" ||
        player.status !== "active"
      ) {
        throw invalid("Human Pressure controller slot is inconsistent", {
          runId: snapshot.run.id,
          seatId,
        });
      }
    } else if (
      role.status !== "claimed" ||
      !role.isAiControlled ||
      player.userId !== null ||
      player.playerType !== "ai" ||
      player.status !== "active"
    ) {
      throw invalid("AI Pressure controller slot is inconsistent", {
        runId: snapshot.run.id,
        seatId,
      });
    }
  }
}

class SerializableCasRetryError extends Error {
  readonly code = "P2034";

  constructor(scope: string) {
    super(`Pressure production ${scope} CAS lost`);
    this.name = "SerializableCasRetryError";
  }
}

function canonicalRoleMap(
  rows: PressureProductionRoleRow[],
  runId: string,
): Map<SeatIdV1, PressureProductionRoleRow> {
  if (rows.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length) {
    throw invalid("Pressure Run must have exactly six canonical roles", { runId });
  }
  const map = new Map<SeatIdV1, PressureProductionRoleRow>();
  for (const row of rows) {
    if (!PRESSURE_CHAPTER_SEAT_IDS_V1.includes(row.roleKey as SeatIdV1)) {
      throw invalid("Pressure Run contains a non-canonical roleKey", { runId });
    }
    const seatId = row.roleKey as SeatIdV1;
    if (map.has(seatId)) throw invalid("Pressure Run contains duplicate roles", { runId });
    map.set(seatId, row);
  }
  return map;
}

function canonicalPlayerMap(
  rows: PressureProductionPlayerRow[],
  roles: Map<SeatIdV1, PressureProductionRoleRow>,
  runId: string,
): Map<SeatIdV1, PressureProductionPlayerRow> {
  if (rows.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length) {
    throw invalid("Pressure Run must have exactly six controller slots", { runId });
  }
  const seatByRoleId = new Map(
    [...roles.entries()].map(([seatId, role]) => [role.id, seatId]),
  );
  const map = new Map<SeatIdV1, PressureProductionPlayerRow>();
  for (const row of rows) {
    const seatId = row.roleId ? seatByRoleId.get(row.roleId) : undefined;
    if (!seatId || map.has(seatId)) {
      throw invalid("Pressure StoryPlayer is not a unique canonical slot", { runId });
    }
    map.set(seatId, row);
  }
  return map;
}

function storyRunSelect(): Record<string, true> {
  return {
    id: true,
    templateId: true,
    ownerUserId: true,
    title: true,
    mode: true,
    templateKey: true,
    status: true,
    totalDays: true,
    maxPlayers: true,
    activeHumanCount: true,
    aiPlayerCount: true,
    stateJson: true,
    visibility: true,
    inviteCode: true,
    engineVersion: true,
    strategyVersion: true,
    version: true,
  };
}

function roleSelect(): Record<string, true> {
  return {
    id: true,
    runId: true,
    roleKey: true,
    roleName: true,
    identity: true,
    publicInfo: true,
    hiddenSecret: true,
    personalGoal: true,
    currentState: true,
    abilityText: true,
    arcText: true,
    knownInfoJson: true,
    cannotDoJson: true,
    isAiControlled: true,
    status: true,
  };
}

function playerSelect(): Record<string, true> {
  return {
    id: true,
    runId: true,
    userId: true,
    roleId: true,
    playerType: true,
    status: true,
  };
}

export function fingerprintMismatch(
  message: string,
  details: Record<string, unknown> = {},
): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.FINGERPRINT_MISMATCH, message, details);
}

export function fence(
  message: string,
  details: Record<string, unknown> = {},
): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.AUTHORITY_FENCE_MISMATCH, message, details);
}

export function invalid(
  message: string,
  details: Record<string, unknown> = {},
): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.RECORD_INVALID, message, details);
}

export function missing(runId: string): PressurePersistenceError {
  return new PressurePersistenceError(
    ERROR.RECORD_NOT_FOUND,
    "Pressure Run shell was not found",
    { runId },
  );
}
