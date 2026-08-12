import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  type ParticipantModeV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  PRESSURE_PRODUCTION_ERROR_CODES as ERROR,
  failPressureProduction,
} from "./errors";
import {
  resolvePressureSeatAtEntryBoundaryV1,
  type FinalizedLegacyRoleSeatRegistryV1,
} from "./legacy-role-seat-registry";
import {
  PressureRunShellService,
  type CreatePressureRunShellCommandV1,
  type PressureHumanSeatAssignmentV1,
  type PressureRunShellCandidateV1,
} from "./run-shell";
import {
  PressureStartLifecycleCoordinator,
  type PressureStartCompletedStageV1,
  type PressureStartFailureStageV1,
  type StartPressureRunCommandV1,
  type StartPressureRunResultV1,
} from "./start-lifecycle";

export const PRESSURE_LOBBY_WRITE_CAPABILITY_V1 = Object.freeze({
  schemaVersion: "pressure_lobby_write_capability_v1" as const,
  allowedModels: Object.freeze([
    "StoryRun",
    "StoryRole",
    "StoryPlayer",
    "PressureRunLifecycle",
  ] as const),
  forbiddenLegacyAuthorityModels: Object.freeze([
    "ChapterSandbox",
    "SceneNode",
    "WorldStateSnapshot",
    "NarrativeSegment",
    "NarrativeEntry",
    "ActorThread",
  ] as const),
});

export interface PressureLobbyPersistenceCapabilityV1 {
  schemaVersion: "pressure_lobby_write_capability_v1";
  allowedModels: readonly [
    "StoryRun",
    "StoryRole",
    "StoryPlayer",
    "PressureRunLifecycle",
  ];
  forbiddenLegacyAuthorityModels: readonly [
    "ChapterSandbox",
    "SceneNode",
    "WorldStateSnapshot",
    "NarrativeSegment",
    "NarrativeEntry",
    "ActorThread",
  ];
}

export interface PressureLobbyMemberV1 {
  userId: string;
  joined: boolean;
  selectedSeatId: SeatIdV1 | null;
  ready: boolean;
}

export interface PressureLobbySeatV1 {
  seatId: SeatIdV1;
  roleKey: SeatIdV1;
  roleStatus: "claimed";
  roleIsAiControlled: boolean;
  userId: string | null;
  controllerId: string;
  controllerType: "human" | "ai";
  ready: boolean;
}

export interface PressureLobbyStatusV1 {
  schemaVersion: "pressure_lobby_status_v1";
  runId: string;
  participantMode: ParticipantModeV1;
  ownerUserId: string;
  lifecycle: "WAITING_PLAYERS" | "STARTING" | "PLAYING" | "FAILED";
  engineVersion: typeof PRESSURE_CHAPTER_ROUTE_V1.engineVersion;
  strategyVersion: typeof PRESSURE_CHAPTER_ROUTE_V1.strategyVersion;
  runtimeProfile: typeof PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile;
  members: PressureLobbyMemberV1[];
  seats: PressureLobbySeatV1[];
}

export interface PressureStartStatusV1 {
  schemaVersion: "pressure_start_status_v1";
  runId: string;
  phase: "NOT_STARTED" | "STARTING" | "STARTED" | "FAILED";
  completedStages: PressureStartCompletedStageV1[];
  frozenHumanSeatSetHash: string | null;
  routeHash: string | null;
  genesisHash: string | null;
  seatControlStateHash: string | null;
  n1ChapterHash: string | null;
  lastFailure: {
    failedStage: PressureStartFailureStageV1;
    errorCode: string;
  } | null;
}

export interface PressureLobbyMutationResultV1 {
  status: "UPDATED" | "EXISTING";
  lobby: PressureLobbyStatusV1;
}

export interface JoinPressureLobbyCommandV1 {
  runId: string;
  userId: string;
  idempotencyKey: string;
}

export interface SelectPressureSeatCommandV1 {
  runId: string;
  userId: string;
  /** Canonical roleKey for new runs; legacy values require an accepted registry. */
  roleKey: string;
  humanControllerId: string;
  idempotencyKey: string;
}

export interface SetPressureReadyCommandV1 {
  runId: string;
  userId: string;
  ready: boolean;
  idempotencyKey: string;
}

export interface LeavePressureLobbyCommandV1 {
  runId: string;
  userId: string;
  idempotencyKey: string;
}

export interface PressureLobbyPersistencePortV1 {
  readonly capability: PressureLobbyPersistenceCapabilityV1;
  isPressureRun(runId: string): Promise<boolean>;
  getLobbyStatus(query: {
    runId: string;
    viewerUserId?: string | null;
  }): Promise<PressureLobbyStatusV1 | null>;
  getStartStatus(runId: string): Promise<PressureStartStatusV1 | null>;
  /**
   * Membership lives in the independent PressureRunLifecycle.lobbyJson. Joining
   * must not insert a seventh, unseated StoryPlayer: the six StoryPlayer rows
   * are canonical controller slots and are changed only by seat claim/leave.
   */
  join(
    command: Readonly<JoinPressureLobbyCommandV1>,
  ): Promise<PressureLobbyMutationResultV1>;
  /**
   * One persistence transaction must: verify waiting/member state; win the
   * target role only if it is AI-controlled or already owned by this user;
   * replace that AI StoryPlayer without violating @@unique(runId, roleId);
   * keep exactly six StoryPlayer controller slots (clear the old slot's user
   * before assigning the target slot to satisfy @@unique(runId, userId));
   * and rematerialize the user's previous seat as an AI controller on a seat
   * change. A concurrent loser must fail, never overwrite the winner.
   */
  claimCanonicalSeatReplacingAi(
    command: Readonly<Omit<SelectPressureSeatCommandV1, "roleKey"> & {
      seatId: SeatIdV1;
    }>,
  ): Promise<PressureLobbyMutationResultV1>;
  setReady(
    command: Readonly<SetPressureReadyCommandV1>,
  ): Promise<PressureLobbyMutationResultV1>;
  /** Atomically removes membership and restores any vacated seat to AI. */
  leaveAndRestoreAi(
    command: Readonly<LeavePressureLobbyCommandV1>,
  ): Promise<PressureLobbyMutationResultV1>;
}

export interface CreatePressureLobbyCommandV1
  extends Omit<
    CreatePressureRunShellCommandV1,
    "participantMode" | "humanAssignments"
  > {
  /** Optional pre-selected humans; an ordinary new lobby supplies none. */
  initialHumanAssignments?: readonly PressureHumanSeatAssignmentV1[];
}

export interface CreatePressureSoloShellCommandV1
  extends Omit<
    CreatePressureRunShellCommandV1,
    "participantMode" | "humanAssignments"
  > {
  roleKey: string;
  humanControllerId: string;
}

export interface GetPressureLobbyStatusQueryV1 {
  runId: string;
  viewerUserId?: string | null;
}

/**
 * Rooms-facing production surface. It is framework-neutral so a Nest factory
 * can inject it directly without importing persistence details into Rooms.
 */
export interface PressureProductionBridgeV1 {
  createLobby(command: Readonly<CreatePressureLobbyCommandV1>): Promise<{
    status: "CREATED" | "EXISTING";
    shell: PressureRunShellCandidateV1;
  }>;
  createSoloShell(command: Readonly<CreatePressureSoloShellCommandV1>): Promise<{
    status: "CREATED" | "EXISTING";
    shell: PressureRunShellCandidateV1;
  }>;
  join(
    command: Readonly<JoinPressureLobbyCommandV1>,
  ): Promise<PressureLobbyMutationResultV1>;
  selectRole(
    command: Readonly<SelectPressureSeatCommandV1>,
  ): Promise<PressureLobbyMutationResultV1>;
  ready(
    command: Readonly<SetPressureReadyCommandV1>,
  ): Promise<PressureLobbyMutationResultV1>;
  leave(
    command: Readonly<LeavePressureLobbyCommandV1>,
  ): Promise<PressureLobbyMutationResultV1>;
  start(
    command: Readonly<StartPressureRunCommandV1>,
  ): Promise<StartPressureRunResultV1>;
  isPressure(runId: string): Promise<boolean>;
  getStatus(
    query: Readonly<GetPressureLobbyStatusQueryV1>,
  ): Promise<PressureLobbyStatusV1 | null>;
  getStartStatus(runId: string): Promise<PressureStartStatusV1 | null>;
}

/**
 * Constructor dependencies, in order:
 * 1. PressureRunShellService
 * 2. PressureLobbyPersistencePortV1
 * 3. PressureStartLifecycleCoordinator
 * 4. finalized legacy mapping registry, or null to reject legacy aliases
 */
export class PressureProductionBridgeService implements PressureProductionBridgeV1 {
  constructor(
    private readonly runShell: PressureRunShellService,
    private readonly lobby: PressureLobbyPersistencePortV1,
    private readonly startLifecycle: PressureStartLifecycleCoordinator,
    private readonly legacyRoleRegistry: FinalizedLegacyRoleSeatRegistryV1 | null = null,
  ) {
    assertLobbyWriteCapability(lobby.capability);
  }

  createLobby(command: Readonly<CreatePressureLobbyCommandV1>) {
    return this.runShell.createLobbyDraft({
      ...command,
      participantMode: "MULTIPLAYER",
      humanAssignments: command.initialHumanAssignments ?? [],
    });
  }

  createSoloShell(command: Readonly<CreatePressureSoloShellCommandV1>) {
    const seatId = resolvePressureSeatAtEntryBoundaryV1(
      command.roleKey,
      this.legacyRoleRegistry ?? undefined,
    );
    return this.runShell.create({
      runId: command.runId,
      templateId: command.templateId,
      ownerUserId: command.ownerUserId,
      title: command.title,
      inviteCode: command.inviteCode,
      visibility: command.visibility,
      participantMode: "SOLO",
      humanAssignments: [
        {
          seatId,
          userId: command.ownerUserId,
          humanControllerId: command.humanControllerId,
        },
      ],
      idempotencyKey: command.idempotencyKey,
    });
  }

  async join(command: Readonly<JoinPressureLobbyCommandV1>) {
    const result = await this.lobby.join(normalizeJoinCommand(command));
    return assertLobbyMutationResult(result, command.runId);
  }

  async selectRole(command: Readonly<SelectPressureSeatCommandV1>) {
    const normalized = normalizeSelectSeatCommand(command);
    const seatId = resolvePressureSeatAtEntryBoundaryV1(
      normalized.roleKey,
      this.legacyRoleRegistry ?? undefined,
    );
    const result = await this.lobby.claimCanonicalSeatReplacingAi({
      runId: normalized.runId,
      userId: normalized.userId,
      seatId,
      humanControllerId: normalized.humanControllerId,
      idempotencyKey: normalized.idempotencyKey,
    });
    return assertLobbyMutationResult(result, normalized.runId);
  }

  async ready(command: Readonly<SetPressureReadyCommandV1>) {
    const normalized = normalizeReadyCommand(command);
    const result = await this.lobby.setReady(normalized);
    return assertLobbyMutationResult(result, normalized.runId);
  }

  async leave(command: Readonly<LeavePressureLobbyCommandV1>) {
    const normalized = normalizeJoinCommand(command);
    const result = await this.lobby.leaveAndRestoreAi(normalized);
    return assertLobbyMutationResult(result, normalized.runId);
  }

  start(command: Readonly<StartPressureRunCommandV1>) {
    return this.startLifecycle.start(command);
  }

  async isPressure(runId: string): Promise<boolean> {
    return this.lobby.isPressureRun(requireText("runId", runId));
  }

  async getStatus(query: Readonly<GetPressureLobbyStatusQueryV1>) {
    const runId = requireText("runId", query.runId);
    const viewerUserId = query.viewerUserId == null
      ? null
      : requireText("viewerUserId", query.viewerUserId);
    const status = await this.lobby.getLobbyStatus({ runId, viewerUserId });
    return status ? assertLobbyStatus(status, runId) : null;
  }

  async getStartStatus(runId: string) {
    const normalizedRunId = requireText("runId", runId);
    const status = await this.lobby.getStartStatus(normalizedRunId);
    return status ? assertStartStatus(status, normalizedRunId) : null;
  }
}

export function assertLobbyWriteCapability(
  value: PressureLobbyPersistenceCapabilityV1,
): void {
  const expected = PRESSURE_LOBBY_WRITE_CAPABILITY_V1;
  if (
    !value ||
    value.schemaVersion !== expected.schemaVersion ||
    !sameStrings(value.allowedModels, expected.allowedModels) ||
    !sameStrings(
      value.forbiddenLegacyAuthorityModels,
      expected.forbiddenLegacyAuthorityModels,
    )
  ) {
    failPressureProduction(ERROR.RUN_SHELL_CAPABILITY_INVALID, "lobby-writer");
  }
}

export function assertLobbyStatus(
  value: PressureLobbyStatusV1,
  expectedRunId: string,
): PressureLobbyStatusV1 {
  if (
    !value ||
    value.schemaVersion !== "pressure_lobby_status_v1" ||
    value.runId !== expectedRunId ||
    (value.participantMode !== "SOLO" &&
      value.participantMode !== "MULTIPLAYER") ||
    value.engineVersion !== PRESSURE_CHAPTER_ROUTE_V1.engineVersion ||
    value.strategyVersion !== PRESSURE_CHAPTER_ROUTE_V1.strategyVersion ||
    value.runtimeProfile !== PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile ||
    value.seats.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length ||
    value.seats.some(
      (seat, index) =>
        seat.seatId !== PRESSURE_CHAPTER_SEAT_IDS_V1[index] ||
        seat.roleKey !== PRESSURE_CHAPTER_SEAT_IDS_V1[index] ||
        seat.roleStatus !== "claimed" ||
        seat.roleIsAiControlled !== (seat.controllerType === "ai"),
    )
  ) {
    failPressureProduction(
      ERROR.START_DEPENDENCY_RESULT_INVALID,
      "lobby-status",
    );
  }
  return structuredClone(value);
}

function assertLobbyMutationResult(
  value: PressureLobbyMutationResultV1,
  expectedRunId: string,
): PressureLobbyMutationResultV1 {
  if (!value || (value.status !== "UPDATED" && value.status !== "EXISTING")) {
    failPressureProduction(
      ERROR.START_DEPENDENCY_RESULT_INVALID,
      "lobby-mutation",
    );
  }
  return {
    status: value.status,
    lobby: assertLobbyStatus(value.lobby, expectedRunId),
  };
}

function assertStartStatus(
  value: PressureStartStatusV1,
  expectedRunId: string,
): PressureStartStatusV1 {
  if (
    !value ||
    value.schemaVersion !== "pressure_start_status_v1" ||
    value.runId !== expectedRunId ||
    !["NOT_STARTED", "STARTING", "STARTED", "FAILED"].includes(value.phase) ||
    !Array.isArray(value.completedStages)
  ) {
    failPressureProduction(
      ERROR.START_DEPENDENCY_RESULT_INVALID,
      "start-status",
    );
  }
  return structuredClone(value);
}

function normalizeJoinCommand(
  command: Readonly<JoinPressureLobbyCommandV1>,
): JoinPressureLobbyCommandV1 {
  return {
    runId: requireText("runId", command?.runId),
    userId: requireText("userId", command?.userId),
    idempotencyKey: requireText("idempotencyKey", command?.idempotencyKey),
  };
}

function normalizeSelectSeatCommand(
  command: Readonly<SelectPressureSeatCommandV1>,
): SelectPressureSeatCommandV1 {
  return {
    runId: requireText("runId", command?.runId),
    userId: requireText("userId", command?.userId),
    roleKey: requireText("roleKey", command?.roleKey),
    humanControllerId: requireText(
      "humanControllerId",
      command?.humanControllerId,
    ),
    idempotencyKey: requireText("idempotencyKey", command?.idempotencyKey),
  };
}

function normalizeReadyCommand(
  command: Readonly<SetPressureReadyCommandV1>,
): SetPressureReadyCommandV1 {
  if (typeof command?.ready !== "boolean") {
    failPressureProduction(ERROR.INVALID_COMMAND, "ready:boolean");
  }
  return {
    runId: requireText("runId", command.runId),
    userId: requireText("userId", command.userId),
    ready: command.ready,
    idempotencyKey: requireText("idempotencyKey", command.idempotencyKey),
  };
}

function requireText(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    failPressureProduction(ERROR.INVALID_COMMAND, field);
  }
  return value.trim();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
