import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  isSha256,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  PRESSURE_LOBBY_WRITE_CAPABILITY_V1,
  type JoinPressureLobbyCommandV1,
  type LeavePressureLobbyCommandV1,
  type PressureLobbyMutationResultV1,
  type PressureLobbyPersistencePortV1,
  type SelectPressureSeatCommandV1,
  type SetPressureReadyCommandV1,
} from "../production/production-bridge";
import { pressureSerializableTransaction } from "../persistence/transaction";
import {
  withPressureRunLifecycleState,
  type EmbeddedPressureLobbyCommandReceiptV1,
  type StoredPressureLobbyStateV1,
} from "./lifecycle-state";
import type { PressureProductionPrismaClient, PressureProductionTransaction } from "./prisma-ports";
import {
  assertLobbyMutable,
  buildPressureLobbyStatus,
  buildPressureStartStatus,
  casPressureLifecycle,
  casPressureStoryRun,
  fence,
  fingerprintMismatch,
  invalid,
  missing,
  readPressureProductionSnapshot,
  type PressureProductionSnapshotV1,
} from "./production-store";

export class PrismaPressureLobbyPersistenceAdapter
implements PressureLobbyPersistencePortV1 {
  readonly capability = PRESSURE_LOBBY_WRITE_CAPABILITY_V1;

  constructor(private readonly prisma: PressureProductionPrismaClient) {}

  async isPressureRun(runIdValue: string): Promise<boolean> {
    const runId = requireText(runIdValue, "runId");
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const lifecycle = await tx.pressureRunLifecycle.findUnique({
        where: { runId },
        select: { runId: true },
      });
      return lifecycle !== null;
    });
  }

  async getLobbyStatus(query: {
    runId: string;
    viewerUserId?: string | null;
  }) {
    const runId = requireText(query.runId, "runId");
    if (query.viewerUserId != null) requireText(query.viewerUserId, "viewerUserId");
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const snapshot = await readPressureProductionSnapshot(tx, runId);
      return snapshot ? buildPressureLobbyStatus(snapshot) : null;
    });
  }

  async getStartStatus(runIdValue: string) {
    const runId = requireText(runIdValue, "runId");
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const snapshot = await readPressureProductionSnapshot(tx, runId);
      return snapshot ? buildPressureStartStatus(snapshot) : null;
    });
  }

  async getRoomProjectionStatus(query: {
    runId: string;
    viewerUserId?: string | null;
  }) {
    const runId = requireText(query.runId, "runId");
    if (query.viewerUserId != null) requireText(query.viewerUserId, "viewerUserId");
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const snapshot = await readPressureProductionSnapshot(tx, runId);
      return snapshot
        ? {
            lobby: buildPressureLobbyStatus(snapshot),
            start: buildPressureStartStatus(snapshot),
          }
        : null;
    });
  }

  async join(commandValue: Readonly<JoinPressureLobbyCommandV1>) {
    const command = normalizeMemberCommand(commandValue);
    const receipt = prepareLobbyCommand("JOIN", command, {
      userId: command.userId,
    });
    return executeLobbyMutation(this.prisma, receipt, async (tx) => {
      const snapshot = await requireSnapshot(tx, command.runId);
      assertLobbyMutable(snapshot);
      const lobby = snapshot.lifecycle.state.lobby;
      if (lobby.joinedUserIds.includes(command.userId)) {
        return { status: "EXISTING" as const, snapshot };
      }
      if (snapshot.lifecycle.state.participantMode !== "MULTIPLAYER") {
        throw fence("A Solo Pressure Run cannot add lobby members", {
          runId: command.runId,
        });
      }
      const nextLobby = {
        ...structuredClone(lobby),
        joinedUserIds: [...lobby.joinedUserIds, command.userId],
      };
      const next = withPressureRunLifecycleState(snapshot.lifecycle, {
        ...snapshot.lifecycle.state,
        lobby: nextLobby,
      });
      await casPressureLifecycle(tx, snapshot.lifecycle, next.data);
      return {
        status: "UPDATED" as const,
        snapshot: await requireSnapshot(tx, command.runId),
      };
    });
  }

  async claimCanonicalSeatReplacingAi(
    commandValue: Readonly<
      Omit<SelectPressureSeatCommandV1, "roleKey"> & { seatId: SeatIdV1 }
    >,
  ) {
    const command = {
      ...normalizeMemberCommand(commandValue),
      seatId: commandValue.seatId,
      humanControllerId: requireText(
        commandValue.humanControllerId,
        "humanControllerId",
      ),
    };
    if (!PRESSURE_CHAPTER_SEAT_IDS_V1.includes(command.seatId)) {
      throw invalid("Pressure seat claim is not canonical");
    }
    const receipt = prepareLobbyCommand("SELECT_ROLE", command, {
      userId: command.userId,
      seatId: command.seatId,
      humanControllerId: command.humanControllerId,
    });
    return executeLobbyMutation(this.prisma, receipt, async (tx) => {
      const snapshot = await requireSnapshot(tx, command.runId);
      assertLobbyMutable(snapshot);
      const lobby = snapshot.lifecycle.state.lobby;
      if (!lobby.joinedUserIds.includes(command.userId)) {
        throw fence("Only a joined Pressure lobby member may claim a seat", {
          runId: command.runId,
          userId: command.userId,
        });
      }
      const current = lobby.selectedSeats.find(
        (selected) => selected.userId === command.userId,
      );
      const target = lobby.selectedSeats.find(
        (selected) => selected.seatId === command.seatId,
      );
      if (target && target.userId !== command.userId) {
        throw fence("The canonical Pressure seat was won by another member", {
          runId: command.runId,
          seatId: command.seatId,
        });
      }
      if (
        current?.seatId === command.seatId &&
        current.humanControllerId === command.humanControllerId
      ) {
        return { status: "EXISTING" as const, snapshot };
      }

      if (current && current.seatId !== command.seatId) {
        await restoreAiSlot(tx, snapshot, current.seatId, command.userId);
      }
      if (!current || current.seatId !== command.seatId) {
        await claimHumanSlot(tx, snapshot, command.seatId, command.userId);
      }

      const nextSelected = lobby.selectedSeats.filter(
        (selected) =>
          selected.userId !== command.userId && selected.seatId !== command.seatId,
      );
      nextSelected.push({
        userId: command.userId,
        seatId: command.seatId,
        humanControllerId: command.humanControllerId,
      });
      nextSelected.sort(
        (left, right) =>
          PRESSURE_CHAPTER_SEAT_IDS_V1.indexOf(left.seatId) -
          PRESSURE_CHAPTER_SEAT_IDS_V1.indexOf(right.seatId),
      );
      const nextLobby = {
        ...structuredClone(lobby),
        selectedSeats: nextSelected,
        readyUserIds: lobby.readyUserIds.filter(
          (userId) => userId !== command.userId,
        ),
      };
      const next = withPressureRunLifecycleState(snapshot.lifecycle, {
        ...snapshot.lifecycle.state,
        lobby: nextLobby,
      });
      await casPressureLifecycle(tx, snapshot.lifecycle, next.data);
      await casPressureStoryRun(tx, snapshot.run, {
        activeHumanCount: nextSelected.length,
        aiPlayerCount: PRESSURE_CHAPTER_SEAT_IDS_V1.length - nextSelected.length,
      });
      return {
        status: "UPDATED" as const,
        snapshot: await requireSnapshot(tx, command.runId),
      };
    });
  }

  async setReady(commandValue: Readonly<SetPressureReadyCommandV1>) {
    const command = {
      ...normalizeMemberCommand(commandValue),
      ready: commandValue.ready,
    };
    if (typeof command.ready !== "boolean") throw invalid("ready must be boolean");
    const receipt = prepareLobbyCommand("SET_READY", command, {
      userId: command.userId,
      ready: command.ready,
    });
    return executeLobbyMutation(this.prisma, receipt, async (tx) => {
      const snapshot = await requireSnapshot(tx, command.runId);
      assertLobbyMutable(snapshot);
      const lobby = snapshot.lifecycle.state.lobby;
      if (
        !lobby.joinedUserIds.includes(command.userId) ||
        !lobby.selectedSeats.some((selected) => selected.userId === command.userId)
      ) {
        throw fence("Only a seated lobby member may change readiness", {
          runId: command.runId,
          userId: command.userId,
        });
      }
      const already = lobby.readyUserIds.includes(command.userId);
      if (already === command.ready) {
        return { status: "EXISTING" as const, snapshot };
      }
      const nextReady = command.ready
        ? [...lobby.readyUserIds, command.userId]
        : lobby.readyUserIds.filter((userId) => userId !== command.userId);
      const next = withPressureRunLifecycleState(snapshot.lifecycle, {
        ...snapshot.lifecycle.state,
        lobby: { ...structuredClone(lobby), readyUserIds: nextReady },
      });
      await casPressureLifecycle(tx, snapshot.lifecycle, next.data);
      return {
        status: "UPDATED" as const,
        snapshot: await requireSnapshot(tx, command.runId),
      };
    });
  }

  async leaveAndRestoreAi(commandValue: Readonly<LeavePressureLobbyCommandV1>) {
    const command = normalizeMemberCommand(commandValue);
    const receipt = prepareLobbyCommand("LEAVE", command, {
      userId: command.userId,
    });
    return executeLobbyMutation(this.prisma, receipt, async (tx) => {
      const snapshot = await requireSnapshot(tx, command.runId);
      assertLobbyMutable(snapshot);
      const lobby = snapshot.lifecycle.state.lobby;
      if (!lobby.joinedUserIds.includes(command.userId)) {
        return { status: "EXISTING" as const, snapshot };
      }
      const selected = lobby.selectedSeats.find(
        (entry) => entry.userId === command.userId,
      );
      if (selected) await restoreAiSlot(tx, snapshot, selected.seatId, command.userId);
      const nextSelected = lobby.selectedSeats.filter(
        (entry) => entry.userId !== command.userId,
      );
      const nextLobby = {
        ...structuredClone(lobby),
        replayTargetIntent: lobby.replayTargetIntent,
        joinedUserIds: lobby.joinedUserIds.filter(
          (userId) => userId !== command.userId,
        ),
        readyUserIds: lobby.readyUserIds.filter(
          (userId) => userId !== command.userId,
        ),
        selectedSeats: nextSelected,
      };
      const next = withPressureRunLifecycleState(snapshot.lifecycle, {
        ...snapshot.lifecycle.state,
        lobby: nextLobby,
      });
      await casPressureLifecycle(tx, snapshot.lifecycle, next.data);
      if (selected) {
        await casPressureStoryRun(tx, snapshot.run, {
          activeHumanCount: nextSelected.length,
          aiPlayerCount: PRESSURE_CHAPTER_SEAT_IDS_V1.length - nextSelected.length,
        });
      }
      return {
        status: "UPDATED" as const,
        snapshot: await requireSnapshot(tx, command.runId),
      };
    });
  }
}

type PressureLobbyCommandOperationV1 =
  | "JOIN"
  | "SELECT_ROLE"
  | "SET_READY"
  | "LEAVE";

interface PreparedPressureLobbyCommandV1 {
  runId: string;
  idempotencyKey: string;
  operation: PressureLobbyCommandOperationV1;
  requestFingerprint: string;
}

interface PressureLobbyMutationOutcomeV1 {
  status: "UPDATED" | "EXISTING";
  snapshot: PressureProductionSnapshotV1;
}

function prepareLobbyCommand(
  operation: PressureLobbyCommandOperationV1,
  command: { runId: string; idempotencyKey: string },
  payload: Record<string, unknown>,
): PreparedPressureLobbyCommandV1 {
  return {
    runId: command.runId,
    idempotencyKey: command.idempotencyKey,
    operation,
    requestFingerprint: sha256Canonical({
      schemaVersion: "pressure_lobby_command_request_v1",
      operation,
      runId: command.runId,
      payload,
    }),
  };
}

async function executeLobbyMutation(
  prisma: PressureProductionPrismaClient,
  command: PreparedPressureLobbyCommandV1,
  mutate: (
    tx: PressureProductionTransaction,
  ) => Promise<PressureLobbyMutationOutcomeV1>,
): Promise<PressureLobbyMutationResultV1> {
  return pressureSerializableTransaction(prisma, async (tx) => {
    const before = await requireSnapshot(tx, command.runId);
    const existing = findLobbyCommandReceipt(before, command);
    if (existing) return replayLobbyCommandReceipt(existing, command);

    const outcome = await mutate(tx);
    const result: PressureLobbyMutationResultV1 = {
      status: outcome.status,
      lobby: buildPressureLobbyStatus(outcome.snapshot),
    };
    const lobby = outcome.snapshot.lifecycle.state.lobby as StoredPressureLobbyStateV1;
    const nextLobby: StoredPressureLobbyStateV1 = {
      ...structuredClone(lobby),
      commandReceipts: {
        ...(lobby.commandReceipts ?? {}),
        [command.idempotencyKey]: {
          runId: command.runId,
          idempotencyKey: command.idempotencyKey,
          operation: command.operation,
          requestFingerprint: command.requestFingerprint,
          resultStateHash: outcome.snapshot.lifecycle.row.stateHash,
          responseJson: structuredClone(result),
        },
      },
    };
    const next = withPressureRunLifecycleState(outcome.snapshot.lifecycle, {
      ...outcome.snapshot.lifecycle.state,
      lobby: nextLobby,
    });
    await casPressureLifecycle(tx, outcome.snapshot.lifecycle, next.data);
    return structuredClone(result);
  });
}

function findLobbyCommandReceipt(
  snapshot: PressureProductionSnapshotV1,
  command: Pick<PreparedPressureLobbyCommandV1, "runId" | "idempotencyKey">,
): EmbeddedPressureLobbyCommandReceiptV1 | null {
  const lobby = snapshot.lifecycle.state.lobby as StoredPressureLobbyStateV1;
  return lobby.commandReceipts?.[command.idempotencyKey] ?? null;
}

function replayLobbyCommandReceipt(
  row: EmbeddedPressureLobbyCommandReceiptV1,
  command: PreparedPressureLobbyCommandV1,
): PressureLobbyMutationResultV1 {
  if (
    row.runId !== command.runId ||
    row.idempotencyKey !== command.idempotencyKey ||
    row.operation !== command.operation ||
    row.requestFingerprint !== command.requestFingerprint
  ) {
    throw fingerprintMismatch(
      "Pressure lobby idempotency key is bound to another command",
      {
        runId: command.runId,
        idempotencyKey: command.idempotencyKey,
        storedOperation: row.operation,
        requestedOperation: command.operation,
      },
    );
  }
  if (!isSha256(row.resultStateHash)) {
    throw invalid("Pressure lobby command receipt state hash is invalid");
  }
  return decodeLobbyMutationResult(row.responseJson, command.runId);
}

function decodeLobbyMutationResult(
  value: unknown,
  runId: string,
): PressureLobbyMutationResultV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid("Pressure lobby command receipt response is invalid");
  }
  const result = value as PressureLobbyMutationResultV1;
  if (
    (result.status !== "UPDATED" && result.status !== "EXISTING") ||
    !result.lobby ||
    result.lobby.schemaVersion !== "pressure_lobby_status_v1" ||
    result.lobby.runId !== runId ||
    !Array.isArray(result.lobby.members) ||
    !Array.isArray(result.lobby.seats)
  ) {
    throw invalid("Pressure lobby command receipt response is invalid", { runId });
  }
  return structuredClone(result);
}

async function claimHumanSlot(
  tx: Parameters<typeof readPressureProductionSnapshot>[0],
  snapshot: PressureProductionSnapshotV1,
  seatId: SeatIdV1,
  userId: string,
): Promise<void> {
  const role = snapshot.roles.get(seatId)!;
  const player = snapshot.players.get(seatId)!;
  const claimedPlayer = await tx.storyPlayer.updateMany({
    where: {
      id: player.id,
      runId: snapshot.run.id,
      roleId: role.id,
      userId: null,
      playerType: "ai",
      status: "active",
    },
    data: { userId, playerType: "human", status: "active" },
  });
  if (claimedPlayer.count !== 1) {
    throw fence("Pressure human controller slot claim lost its CAS", {
      runId: snapshot.run.id,
      seatId,
    });
  }
  const claimedRole = await tx.storyRole.updateMany({
    where: {
      id: role.id,
      runId: snapshot.run.id,
      roleKey: seatId,
      isAiControlled: true,
      status: "claimed",
    },
    data: { isAiControlled: false, status: "claimed" },
  });
  if (claimedRole.count !== 1) {
    throw fence("Pressure role claim lost its CAS", {
      runId: snapshot.run.id,
      seatId,
    });
  }
}

async function restoreAiSlot(
  tx: Parameters<typeof readPressureProductionSnapshot>[0],
  snapshot: PressureProductionSnapshotV1,
  seatId: SeatIdV1,
  userId: string,
): Promise<void> {
  const role = snapshot.roles.get(seatId)!;
  const player = snapshot.players.get(seatId)!;
  const restoredPlayer = await tx.storyPlayer.updateMany({
    where: {
      id: player.id,
      runId: snapshot.run.id,
      roleId: role.id,
      userId,
      playerType: "human",
      status: "active",
    },
    data: { userId: null, playerType: "ai", status: "active" },
  });
  if (restoredPlayer.count !== 1) {
    throw fence("Pressure AI controller restoration lost its CAS", {
      runId: snapshot.run.id,
      seatId,
    });
  }
  const restoredRole = await tx.storyRole.updateMany({
    where: {
      id: role.id,
      runId: snapshot.run.id,
      roleKey: seatId,
      isAiControlled: false,
      status: "claimed",
    },
    data: { isAiControlled: true, status: "claimed" },
  });
  if (restoredRole.count !== 1) {
    throw fence("Pressure AI role restoration lost its CAS", {
      runId: snapshot.run.id,
      seatId,
    });
  }
}

async function requireSnapshot(
  tx: Parameters<typeof readPressureProductionSnapshot>[0],
  runId: string,
): Promise<PressureProductionSnapshotV1> {
  const snapshot = await readPressureProductionSnapshot(tx, runId);
  if (!snapshot) throw missing(runId);
  return snapshot;
}

function normalizeMemberCommand<T extends { runId: string; userId: string; idempotencyKey: string }>(
  command: Readonly<T>,
): { runId: string; userId: string; idempotencyKey: string } {
  return {
    runId: requireText(command?.runId, "runId"),
    userId: requireText(command?.userId, "userId"),
    idempotencyKey: requireText(command?.idempotencyKey, "idempotencyKey"),
  };
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw invalid(`${field} must be a non-empty string`);
  }
  return value.trim();
}
