import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  hashWithoutField,
  isSha256,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  assertPressureRunShellCandidate,
  type PressureRunLifecycleStateV1,
  type PressureRunShellCandidateV1,
} from "../production/run-shell";
import { validateReplayResolvedTargetV1 } from "../replay/ports";
import type {
  PressureStartCompletedStageV1,
  PressureStartCompletionV1,
  PressureStartFailureV1,
} from "../production/start-lifecycle";
import { assertFrozenHumanSeatSet } from "../production/start-lifecycle";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "../persistence/errors";
import type { PressureRunLifecycleRow } from "./prisma-ports";

export const PRESSURE_RUN_LIFECYCLE_ROW_SCHEMA_V1 =
  "pressure_run_lifecycle_state_v1" as const;

export type PressureLobbyStateV1 = PressureRunLifecycleStateV1["lobby"];
export type PressureStartStateV1 = PressureRunLifecycleStateV1["start"];

export interface EmbeddedPressureLobbyCommandReceiptV1 {
  runId: string;
  idempotencyKey: string;
  operation: string;
  requestFingerprint: string;
  resultStateHash: string;
  responseJson: unknown;
}

export type StoredPressureLobbyStateV1 = PressureLobbyStateV1 & {
  commandReceipts?: Record<string, EmbeddedPressureLobbyCommandReceiptV1>;
};

export interface DecodedPressureRunLifecycleV1 {
  row: PressureRunLifecycleRow;
  shell: PressureRunShellCandidateV1;
  state: PressureRunLifecycleStateV1;
}

export function buildPressureRunLifecycleCreateData(
  candidateValue: Readonly<PressureRunShellCandidateV1>,
): Record<string, unknown> {
  const candidate = structuredClone(
    assertPressureRunShellCandidate(candidateValue as PressureRunShellCandidateV1),
  );
  const row: PressureRunLifecycleRow = {
    runId: candidate.room.runId,
    schemaVersion: PRESSURE_RUN_LIFECYCLE_ROW_SCHEMA_V1,
    participantMode: candidate.room.participantMode,
    lifecycle: candidate.lifecycle.lifecycle,
    routeFreeze: candidate.lifecycle.routeFreeze,
    requestFingerprint: candidate.requestFingerprint,
    idempotencyKey: candidate.idempotencyKey,
    shellHash: candidate.shellHash,
    shellJson: candidate,
    lobbyJson: structuredClone(candidate.lifecycle.lobby),
    startJson: structuredClone(candidate.lifecycle.start),
    stateHash: candidate.lifecycle.stateHash,
    startRequestFingerprint: null,
    startIdempotencyKey: null,
    startRunSeed: null,
    startMaterialHash: null,
    version: 1,
  };
  if (row.stateHash !== computePressureRunLifecycleRowHash(row)) {
    throw invalid("PressureRunLifecycle initial state hash is invalid", {
      runId: row.runId,
    });
  }
  return structuredClone(row) as unknown as Record<string, unknown>;
}

export function decodePressureRunLifecycleRow(
  rowValue: PressureRunLifecycleRow,
): DecodedPressureRunLifecycleV1 {
  const row: PressureRunLifecycleRow = {
    ...structuredClone(rowValue),
    startRequestFingerprint: rowValue.startRequestFingerprint ?? null,
    startIdempotencyKey: rowValue.startIdempotencyKey ?? null,
    startRunSeed: rowValue.startRunSeed ?? null,
    startMaterialHash: rowValue.startMaterialHash ?? null,
  };
  if (
    row.schemaVersion !== PRESSURE_RUN_LIFECYCLE_ROW_SCHEMA_V1 ||
    !row.runId?.trim() ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1 ||
    !isSha256(row.requestFingerprint) ||
    !isSha256(row.shellHash) ||
    !isSha256(row.stateHash) ||
    row.stateHash !== computePressureRunLifecycleRowHash(row)
  ) {
    throw invalid("PressureRunLifecycle row header/hash is invalid", {
      runId: row.runId,
    });
  }

  let shell: PressureRunShellCandidateV1;
  try {
    shell = structuredClone(
      assertPressureRunShellCandidate(row.shellJson as PressureRunShellCandidateV1),
    );
  } catch (cause) {
    throw invalid("PressureRunLifecycle shell receipt is invalid", {
      runId: row.runId,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
  if (
    shell.room.runId !== row.runId ||
    shell.room.participantMode !== row.participantMode ||
    shell.requestFingerprint !== row.requestFingerprint ||
    shell.idempotencyKey !== row.idempotencyKey ||
    shell.shellHash !== row.shellHash
  ) {
    throw invalid("PressureRunLifecycle shell receipt is not bound to its row", {
      runId: row.runId,
    });
  }

  const lobby = decodeLobby(row.lobbyJson);
  const start = decodeStart(row.startJson, row.runId);
  assertStartMaterialBinding(row, start);
  const stateBase = {
    schemaVersion: "pressure_run_lifecycle_state_v1" as const,
    engineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
    strategyVersion: PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
    runtimeProfile: PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile,
    participantMode: row.participantMode,
    lifecycle: row.lifecycle,
    routeFreeze: row.routeFreeze,
    canonicalSeatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    lobby,
    start,
  };
  const state = {
    ...stateBase,
    stateHash: row.stateHash,
  } as PressureRunLifecycleStateV1;
  assertLifecycleState(state);
  return { row, shell, state: structuredClone(state) };
}

export function withPressureRunLifecycleState(
  decoded: DecodedPressureRunLifecycleV1,
  next: Pick<
    PressureRunLifecycleStateV1,
    "lifecycle" | "routeFreeze" | "lobby" | "start"
  >,
  startMaterial?: Readonly<{
    startRequestFingerprint: string;
    startIdempotencyKey: string;
    startRunSeed: string;
    startMaterialHash: string;
  }>,
): { nextRow: PressureRunLifecycleRow; data: Record<string, unknown> } {
  const nextRow: PressureRunLifecycleRow = {
    ...structuredClone(decoded.row),
    lifecycle: next.lifecycle,
    routeFreeze: next.routeFreeze,
    lobbyJson: structuredClone(next.lobby),
    startJson: structuredClone(next.start),
    stateHash: "",
    version: decoded.row.version + 1,
    ...(startMaterial ? structuredClone(startMaterial) : {}),
  };
  nextRow.stateHash = computePressureRunLifecycleRowHash(nextRow);
  decodePressureRunLifecycleRow(nextRow);
  return {
    nextRow,
    data: {
      lifecycle: nextRow.lifecycle,
      routeFreeze: nextRow.routeFreeze,
      lobbyJson: structuredClone(nextRow.lobbyJson),
      startJson: structuredClone(nextRow.startJson),
      stateHash: nextRow.stateHash,
      startRequestFingerprint: nextRow.startRequestFingerprint,
      startIdempotencyKey: nextRow.startIdempotencyKey,
      startRunSeed: nextRow.startRunSeed,
      startMaterialHash: nextRow.startMaterialHash,
      version: { increment: 1 },
    },
  };
}

export function computePressureRunLifecycleRowHash(
  row: Pick<
    PressureRunLifecycleRow,
    | "schemaVersion"
    | "participantMode"
    | "lifecycle"
    | "routeFreeze"
    | "lobbyJson"
    | "startJson"
  >,
): string {
  const lobby = structuredClone(row.lobbyJson) as StoredPressureLobbyStateV1;
  // Receipts are operational metadata, not game authority. Excluding them
  // avoids a circular resultStateHash -> stateHash -> receipt dependency.
  delete lobby.commandReceipts;
  return sha256Canonical({
    schemaVersion: row.schemaVersion,
    engineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
    strategyVersion: PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
    runtimeProfile: PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile,
    participantMode: row.participantMode,
    lifecycle: row.lifecycle,
    routeFreeze: row.routeFreeze,
    canonicalSeatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    lobby,
    start: row.startJson,
  });
}

export function designatedPressureAiControllerId(
  runId: string,
  seatId: SeatIdV1,
): string {
  return `pressure-ai:${sha256Canonical({ runId, seatId, kind: "run-shell" }).slice(0, 32)}`;
}

export function pressureRoleSlotId(
  runId: string,
  seatId: SeatIdV1,
): string {
  return `pc_role_${sha256Canonical({
    schemaVersion: "pressure_role_slot_id_v1",
    runId,
    seatId,
  }).slice(0, 32)}`;
}

export function pressurePlayerSlotId(
  runId: string,
  seatId: SeatIdV1,
): string {
  return `pc_player_${sha256Canonical({
    schemaVersion: "pressure_player_slot_id_v1",
    runId,
    seatId,
  }).slice(0, 32)}`;
}

export function assertHashRecord(
  value: unknown,
  schemaVersion: string,
  hashField: "freezeHash" | "completionHash" | "failureHash",
): void {
  const record = asRecord(value);
  if (
    record.schemaVersion !== schemaVersion ||
    typeof record[hashField] !== "string" ||
    !isSha256(record[hashField] as string) ||
    hashWithoutField(record, hashField) !== record[hashField]
  ) {
    throw invalid(`Stored ${schemaVersion} record is invalid`);
  }
}

function decodeLobby(value: unknown): PressureLobbyStateV1 {
  const lobby = structuredClone(value) as StoredPressureLobbyStateV1;
  if (
    !lobby ||
    !Array.isArray(lobby.joinedUserIds) ||
    !Array.isArray(lobby.readyUserIds) ||
    !Array.isArray(lobby.selectedSeats) ||
    lobby.joinedUserIds.some((userId) => !nonEmpty(userId)) ||
    lobby.readyUserIds.some((userId) => !nonEmpty(userId)) ||
    new Set(lobby.joinedUserIds).size !== lobby.joinedUserIds.length ||
    new Set(lobby.readyUserIds).size !== lobby.readyUserIds.length ||
    lobby.readyUserIds.some((userId) => !lobby.joinedUserIds.includes(userId)) ||
    !("replayTargetIntent" in lobby)
  ) {
    throw invalid("PressureRunLifecycle lobby metadata is invalid");
  }
  if (
    lobby.commandReceipts != null
    && (
      typeof lobby.commandReceipts !== "object"
      || Array.isArray(lobby.commandReceipts)
      || Object.entries(lobby.commandReceipts).some(([key, receipt]) =>
        !key.trim()
        || !receipt
        || receipt.runId !== (receipt.responseJson as { lobby?: { runId?: string } })?.lobby?.runId
        || receipt.idempotencyKey !== key
        || !isSha256(receipt.requestFingerprint)
        || !isSha256(receipt.resultStateHash)
      )
    )
  ) {
    throw invalid("PressureRunLifecycle lobby command receipts are invalid");
  }
  if (lobby.replayTargetIntent !== null) {
    validateReplayResolvedTargetV1(
      lobby.replayTargetIntent,
      "PressureRunLifecycle.lobby.replayTargetIntent",
    );
  }
  for (const selected of lobby.selectedSeats) {
    if (
      !selected ||
      !nonEmpty(selected.userId) ||
      !nonEmpty(selected.humanControllerId) ||
      !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(selected.seatId) ||
      !lobby.joinedUserIds.includes(selected.userId)
    ) {
      throw invalid("PressureRunLifecycle selected-seat metadata is invalid");
    }
  }
  if (
    new Set(lobby.selectedSeats.map((selected) => selected.userId)).size !==
      lobby.selectedSeats.length ||
    new Set(lobby.selectedSeats.map((selected) => selected.seatId)).size !==
      lobby.selectedSeats.length ||
    new Set(lobby.selectedSeats.map((selected) => selected.humanControllerId)).size !==
      lobby.selectedSeats.length
  ) {
    throw invalid("PressureRunLifecycle selected seats are not unique");
  }
  return lobby;
}

function decodeStart(value: unknown, runId: string): PressureStartStateV1 {
  const start = structuredClone(value) as PressureStartStateV1;
  if (
    !start ||
    !["NOT_STARTED", "STARTING", "STARTED", "FAILED"].includes(start.phase) ||
    !Array.isArray(start.completedStages) ||
    !isStagePrefix(start.completedStages)
  ) {
    throw invalid("PressureRunLifecycle start metadata is invalid", { runId });
  }
  for (const hash of [
    start.routeHash,
    start.genesisHash,
    start.seatControlStateHash,
    start.n1ChapterHash,
  ]) {
    if (hash !== null && !isSha256(hash)) {
      throw invalid("PressureRunLifecycle start hash is invalid", { runId });
    }
  }
  if (start.frozenHumanSeatSet) {
    try {
      assertFrozenHumanSeatSet(start.frozenHumanSeatSet);
    } catch (cause) {
      throw invalid("Pressure frozen start material is invalid", {
        runId,
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
    if (start.frozenHumanSeatSet.runId !== runId) {
      throw invalid("Frozen human seat set is bound to another Run", { runId });
    }
  }
  if (start.completion) {
    assertHashRecord(
      start.completion,
      "pressure_start_completion_v1",
      "completionHash",
    );
    if (start.completion.runId !== runId) {
      throw invalid("Start completion is bound to another Run", { runId });
    }
  }
  if (start.lastFailure) {
    assertHashRecord(
      start.lastFailure,
      "pressure_start_failure_v1",
      "failureHash",
    );
    if (start.lastFailure.runId !== runId) {
      throw invalid("Start failure is bound to another Run", { runId });
    }
  }
  return start;
}

function assertStartMaterialBinding(
  row: PressureRunLifecycleRow,
  start: PressureStartStateV1,
): void {
  const columns = [
    row.startRequestFingerprint,
    row.startIdempotencyKey,
    row.startRunSeed,
    row.startMaterialHash,
  ];
  if (!start.frozenHumanSeatSet) {
    if (columns.some((value) => value !== null)) {
      throw invalid("Unfrozen Pressure lifecycle has start material columns", {
        runId: row.runId,
      });
    }
    return;
  }
  const material = start.frozenHumanSeatSet.effectiveStart;
  if (
    columns.some((value) => value === null) ||
    row.startRequestFingerprint !== start.frozenHumanSeatSet.startRequestFingerprint ||
    row.startIdempotencyKey !== material.idempotencyKey ||
    row.startRunSeed !== material.runSeed ||
    row.startMaterialHash !== material.materialHash ||
    !isSha256(row.startRequestFingerprint ?? "") ||
    !isSha256(row.startMaterialHash ?? "")
  ) {
    throw invalid("Pressure start material columns do not match the frozen receipt", {
      runId: row.runId,
    });
  }
}

function assertLifecycleState(state: PressureRunLifecycleStateV1): void {
  const hashableState = structuredClone(state) as PressureRunLifecycleStateV1 & {
    lobby: StoredPressureLobbyStateV1;
  };
  delete hashableState.lobby.commandReceipts;
  if (
    state.schemaVersion !== "pressure_run_lifecycle_state_v1" ||
    state.engineVersion !== PRESSURE_CHAPTER_ROUTE_V1.engineVersion ||
    state.strategyVersion !== PRESSURE_CHAPTER_ROUTE_V1.strategyVersion ||
    state.runtimeProfile !== PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile ||
    (state.participantMode !== "SOLO" && state.participantMode !== "MULTIPLAYER") ||
    !["WAITING_PLAYERS", "STARTING", "PLAYING", "FAILED"].includes(
      state.lifecycle,
    ) ||
    !["UNFROZEN", "START_BOUNDARY_FROZEN"].includes(state.routeFreeze) ||
    state.canonicalSeatIds.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length ||
    state.canonicalSeatIds.some(
      (seatId, index) => seatId !== PRESSURE_CHAPTER_SEAT_IDS_V1[index],
    ) ||
    hashWithoutField(
      hashableState as unknown as Record<string, unknown>,
      "stateHash",
    ) !== state.stateHash
  ) {
    throw invalid("PressureRunLifecycle state is invalid");
  }
  const expectedLifecycle = lifecycleForPhase(state.start.phase);
  if (state.lifecycle !== expectedLifecycle) {
    throw invalid("PressureRunLifecycle phase/lifecycle mismatch");
  }
  if (
    state.start.phase === "NOT_STARTED" &&
    state.routeFreeze !== "UNFROZEN"
  ) {
    throw invalid("An unstarted Pressure lobby cannot be frozen");
  }
  if (
    (state.start.phase === "STARTING" || state.start.phase === "STARTED") &&
    (state.routeFreeze !== "START_BOUNDARY_FROZEN" ||
      !state.start.frozenHumanSeatSet)
  ) {
    throw invalid("A started Pressure lifecycle lacks its frozen roster");
  }
}

function lifecycleForPhase(
  phase: PressureStartStateV1["phase"],
): PressureRunLifecycleStateV1["lifecycle"] {
  if (phase === "NOT_STARTED") return "WAITING_PLAYERS";
  if (phase === "STARTING") return "STARTING";
  if (phase === "STARTED") return "PLAYING";
  return "FAILED";
}

const COMPLETED_STAGES: readonly PressureStartCompletedStageV1[] = [
  "HUMAN_SEATS_FROZEN",
  "ROUTE_FROZEN",
  "GENESIS_COMMITTED",
  "SEAT_CONTROL_INITIALIZED",
  "N1_OPENED",
];

function isStagePrefix(stages: readonly PressureStartCompletedStageV1[]): boolean {
  return stages.every((stage, index) => stage === COMPLETED_STAGES[index]);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid("Expected a JSON object");
  }
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function invalid(
  message: string,
  details: Record<string, unknown> = {},
): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.RECORD_INVALID, message, details);
}

export type { PressureStartCompletionV1, PressureStartFailureV1 };
