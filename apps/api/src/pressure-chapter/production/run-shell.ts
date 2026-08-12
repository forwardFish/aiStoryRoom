import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  hashWithoutField,
  isSha256,
  sha256Canonical,
  type ParticipantModeV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  loadSangtianPressureChapterPackageV1,
  type SangtianSeatContentV1,
} from "@ai-story/templates";
import {
  validateReplayResolvedTargetV1,
  type ReplayResolvedTargetV1,
} from "../replay/ports";
import {
  PRESSURE_PRODUCTION_ERROR_CODES as ERROR,
  failPressureProduction,
} from "./errors";
import type {
  FrozenPressureHumanSeatSetV1,
  PressureStartCompletedStageV1,
  PressureStartCompletionV1,
  PressureStartFailureV1,
} from "./start-lifecycle";

export const PRESSURE_RUN_SHELL_WRITE_CAPABILITY_V1 = Object.freeze({
  schemaVersion: "pressure_run_shell_write_capability_v1" as const,
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

export interface PressureRunShellWriterCapabilityV1 {
  schemaVersion: "pressure_run_shell_write_capability_v1";
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

export interface PressureHumanSeatAssignmentV1 {
  seatId: SeatIdV1;
  userId: string;
  humanControllerId: string;
}

export interface CreatePressureRunShellCommandV1 {
  runId: string;
  templateId: string;
  ownerUserId: string;
  title: string;
  inviteCode: string;
  visibility: "link" | "public";
  participantMode: ParticipantModeV1;
  humanAssignments: readonly PressureHumanSeatAssignmentV1[];
  idempotencyKey: string;
  /** Server-resolved replay route intent; clients never author this value. */
  replayTargetIntent?: ReplayResolvedTargetV1 | null;
}

export interface PressureCanonicalRoleDefinitionV1 {
  roleKey: SeatIdV1;
  roleName: string;
  identity: string;
  publicInfo: string;
  personalGoal: string;
  currentState: string;
  abilityText: string | null;
  arcText: string | null;
  knownInfo: string[];
  cannotDo: string[];
  sourceSeatId: string;
  initialActorId: string;
  persistentObjectRefs: string[];
}

export interface PressureCanonicalRoleCatalogPort {
  loadCanonicalRoles(): Promise<readonly PressureCanonicalRoleDefinitionV1[]>;
}

export class SangtianPressureCanonicalRoleCatalogAdapter
  implements PressureCanonicalRoleCatalogPort
{
  async loadCanonicalRoles(): Promise<readonly PressureCanonicalRoleDefinitionV1[]> {
    const loaded = loadSangtianPressureChapterPackageV1();
    const genesis = loaded.content.genesis;
    return genesis.seats.map((seat) =>
      roleFromAcceptedContent(
        seat,
        genesis.pressure,
        genesis.knowledgeBySeat.find((knowledge) => knowledge.seatId === seat.seatId)
          ?.knownFactRefs ?? [],
      ),
    );
  }
}

export interface PressureRunShellRoleV1 {
  roleKey: SeatIdV1;
  roleName: string;
  identity: string;
  publicInfo: string;
  hiddenSecret: null;
  personalGoal: string;
  currentState: string;
  abilityText: string | null;
  arcText: string | null;
  knownInfo: string[];
  cannotDo: string[];
  isAiControlled: boolean;
  status: "claimed";
}

export interface PressureRunShellPlayerV1 {
  seatId: SeatIdV1;
  roleKey: SeatIdV1;
  userId: string | null;
  controllerId: string;
  playerType: "human" | "ai";
  status: "active";
}

export interface PressureRunLifecycleStateV1 {
  schemaVersion: "pressure_run_lifecycle_state_v1";
  engineVersion: "pressure_chapter_v1";
  strategyVersion: "sangtian_pressure_chapter_v1_0";
  runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1";
  participantMode: ParticipantModeV1;
  lifecycle: "WAITING_PLAYERS" | "STARTING" | "PLAYING" | "FAILED";
  routeFreeze: "UNFROZEN" | "START_BOUNDARY_FROZEN";
  canonicalSeatIds: SeatIdV1[];
  lobby: {
    joinedUserIds: string[];
    readyUserIds: string[];
    selectedSeats: Array<{
      userId: string;
      seatId: SeatIdV1;
      humanControllerId: string;
    }>;
    replayTargetIntent: ReplayResolvedTargetV1 | null;
  };
  start: {
    phase: "NOT_STARTED" | "STARTING" | "STARTED" | "FAILED";
    completedStages: PressureStartCompletedStageV1[];
    frozenHumanSeatSet: FrozenPressureHumanSeatSetV1 | null;
    completion: PressureStartCompletionV1 | null;
    routeHash: string | null;
    genesisHash: string | null;
    seatControlStateHash: string | null;
    n1ChapterHash: string | null;
    lastFailure: PressureStartFailureV1 | null;
  };
  stateHash: string;
}

export interface PressureRunShellCandidateV1 {
  schemaVersion: "pressure_run_shell_candidate_v1";
  requestFingerprint: string;
  idempotencyKey: string;
  room: {
    runId: string;
    templateId: string;
    templateKey: "sangtian";
    ownerUserId: string;
    title: string;
    inviteCode: string;
    visibility: "link" | "public";
    mode: "room";
    status: "waiting_players";
    participantMode: ParticipantModeV1;
    engineVersion: "pressure_chapter_v1";
    strategyVersion: "sangtian_pressure_chapter_v1_0";
    runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1";
    totalDays: 7;
    maxPlayers: number;
    activeHumanCount: number;
    aiPlayerCount: number;
  };
  /** Exact initial metadata for the independent PressureRunLifecycle row. */
  lifecycle: PressureRunLifecycleStateV1;
  roles: PressureRunShellRoleV1[];
  players: PressureRunShellPlayerV1[];
  shellHash: string;
}

export interface PressureRunShellWriterPort {
  readonly capability: PressureRunShellWriterCapabilityV1;
  createOnce(
    candidate: Readonly<PressureRunShellCandidateV1>,
  ): Promise<{
    status: "CREATED" | "EXISTING";
    shell: PressureRunShellCandidateV1;
  }>;
}

export class PressureRunShellService {
  constructor(
    private readonly roleCatalog: PressureCanonicalRoleCatalogPort,
    private readonly writer: PressureRunShellWriterPort,
  ) {
    assertRunShellWriteCapability(writer.capability);
  }

  async create(
    command: Readonly<CreatePressureRunShellCommandV1>,
  ): Promise<{ status: "CREATED" | "EXISTING"; shell: PressureRunShellCandidateV1 }> {
    return this.createWithRosterPolicy(command, "START_ELIGIBLE");
  }

  /**
   * Creates an open Multiplayer lobby before anybody has to choose a seat.
   * Zero to six pre-selected humans are permitted here; the start coordinator
   * still rejects anything outside the authoritative 2..6 start topology.
   */
  async createLobbyDraft(
    command: Readonly<CreatePressureRunShellCommandV1>,
  ): Promise<{ status: "CREATED" | "EXISTING"; shell: PressureRunShellCandidateV1 }> {
    if (command.participantMode !== "MULTIPLAYER") {
      failPressureProduction(ERROR.INVALID_COMMAND, "lobby-draft:MULTIPLAYER_ONLY");
    }
    return this.createWithRosterPolicy(command, "OPEN_LOBBY");
  }

  private async createWithRosterPolicy(
    command: Readonly<CreatePressureRunShellCommandV1>,
    rosterPolicy: PressureHumanRosterPolicyV1,
  ): Promise<{ status: "CREATED" | "EXISTING"; shell: PressureRunShellCandidateV1 }> {
    const normalized = normalizeShellCommand(command, rosterPolicy);
    const definitions = await this.roleCatalog.loadCanonicalRoles();
    assertCanonicalRoleCatalog(definitions);
    const humanBySeat = new Map(
      normalized.humanAssignments.map((assignment) => [assignment.seatId, assignment]),
    );
    const roles = definitions.map((definition): PressureRunShellRoleV1 => ({
      roleKey: definition.roleKey,
      roleName: definition.roleName,
      identity: definition.identity,
      publicInfo: definition.publicInfo,
      hiddenSecret: null,
      personalGoal: definition.personalGoal,
      currentState: definition.currentState,
      abilityText: definition.abilityText,
      arcText: definition.arcText,
      knownInfo: [...definition.knownInfo],
      cannotDo: [...definition.cannotDo],
      isAiControlled: !humanBySeat.has(definition.roleKey),
      status: "claimed",
    }));
    const players = PRESSURE_CHAPTER_SEAT_IDS_V1.map(
      (seatId): PressureRunShellPlayerV1 => {
        const human = humanBySeat.get(seatId);
        return human
          ? {
              seatId,
              roleKey: seatId,
              userId: human.userId,
              controllerId: human.humanControllerId,
              playerType: "human",
              status: "active",
            }
          : {
              seatId,
              roleKey: seatId,
              userId: null,
              controllerId: designatedAiControllerId(normalized.runId, seatId),
              playerType: "ai",
              status: "active",
            };
      },
    );
    const requestFingerprint = computeRunShellRequestFingerprint(
      normalized,
      rosterPolicy,
    );
    const joinedUserIds = [
      normalized.ownerUserId,
      ...normalized.humanAssignments.map((assignment) => assignment.userId),
    ].filter((userId, index, all) => all.indexOf(userId) === index);
    const stateBase = {
      schemaVersion: "pressure_run_lifecycle_state_v1" as const,
      engineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
      strategyVersion: PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
      runtimeProfile: PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile,
      participantMode: normalized.participantMode,
      lifecycle: "WAITING_PLAYERS" as const,
      routeFreeze: "UNFROZEN" as const,
      canonicalSeatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
      lobby: {
        joinedUserIds,
        readyUserIds:
          normalized.participantMode === "SOLO"
            ? normalized.humanAssignments.map((assignment) => assignment.userId)
            : ([] as string[]),
        selectedSeats: normalized.humanAssignments.map((assignment) => ({
          userId: assignment.userId,
          seatId: assignment.seatId,
          humanControllerId: assignment.humanControllerId,
        })),
        replayTargetIntent: normalized.replayTargetIntent
          ? structuredClone(normalized.replayTargetIntent)
          : null,
      },
      start: {
        phase: "NOT_STARTED" as const,
        completedStages: [] as PressureStartCompletedStageV1[],
        frozenHumanSeatSet: null,
        completion: null,
        routeHash: null,
        genesisHash: null,
        seatControlStateHash: null,
        n1ChapterHash: null,
        lastFailure: null,
      },
    };
    const lifecycle: PressureRunLifecycleStateV1 = {
      ...stateBase,
      stateHash: sha256Canonical(stateBase),
    };
    const base = {
      schemaVersion: "pressure_run_shell_candidate_v1" as const,
      requestFingerprint,
      idempotencyKey: normalized.idempotencyKey,
      room: {
        runId: normalized.runId,
        templateId: normalized.templateId,
        templateKey: "sangtian" as const,
        ownerUserId: normalized.ownerUserId,
        title: normalized.title,
        inviteCode: normalized.inviteCode,
        visibility: normalized.visibility,
        mode: "room" as const,
        status: "waiting_players" as const,
        participantMode: normalized.participantMode,
        engineVersion: PRESSURE_CHAPTER_ROUTE_V1.engineVersion,
        strategyVersion: PRESSURE_CHAPTER_ROUTE_V1.strategyVersion,
        runtimeProfile: PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile,
        totalDays: 7 as const,
        maxPlayers: normalized.participantMode === "SOLO" ? 1 : 6,
        activeHumanCount: normalized.humanAssignments.length,
        aiPlayerCount:
          PRESSURE_CHAPTER_SEAT_IDS_V1.length - normalized.humanAssignments.length,
      },
      lifecycle,
      roles,
      players,
    };
    const candidate: PressureRunShellCandidateV1 = {
      ...base,
      shellHash: sha256Canonical(base),
    };
    const result = await this.writer.createOnce(structuredClone(candidate));
    if (result.status !== "CREATED" && result.status !== "EXISTING") {
      failPressureProduction(ERROR.RUN_SHELL_RESULT_INVALID, "status");
    }
    const shell = assertPressureRunShellCandidate(result.shell);
    if (
      shell.shellHash !== candidate.shellHash ||
      shell.requestFingerprint !== candidate.requestFingerprint
    ) {
      failPressureProduction(
        ERROR.RUN_SHELL_RESULT_INVALID,
        "persisted-shell:fingerprint-mismatch",
      );
    }
    return { status: result.status, shell: structuredClone(shell) };
  }
}

export function computeRunShellRequestFingerprint(
  command: Readonly<CreatePressureRunShellCommandV1>,
  rosterPolicy: PressureHumanRosterPolicyV1 = "START_ELIGIBLE",
): string {
  const normalized = normalizeShellCommand(command, rosterPolicy);
  return sha256Canonical({
    schemaVersion: "pressure_run_shell_create_request_v1",
    rosterPolicy,
    ...normalized,
  });
}

export function assertRunShellWriteCapability(
  value: PressureRunShellWriterCapabilityV1,
): void {
  const expected = PRESSURE_RUN_SHELL_WRITE_CAPABILITY_V1;
  if (
    !value ||
    value.schemaVersion !== expected.schemaVersion ||
    !sameStrings(value.allowedModels, expected.allowedModels) ||
    !sameStrings(
      value.forbiddenLegacyAuthorityModels,
      expected.forbiddenLegacyAuthorityModels,
    )
  ) {
    failPressureProduction(ERROR.RUN_SHELL_CAPABILITY_INVALID, "writer");
  }
}

export function assertPressureRunShellCandidate(
  value: PressureRunShellCandidateV1,
): PressureRunShellCandidateV1 {
  if (
    !value ||
    value.schemaVersion !== "pressure_run_shell_candidate_v1" ||
    !isSha256(value.requestFingerprint) ||
    !isSha256(value.shellHash) ||
    hashWithoutField(value as unknown as Record<string, unknown>, "shellHash") !==
      value.shellHash ||
    value.roles.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length ||
    value.players.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length ||
    value.lifecycle?.schemaVersion !== "pressure_run_lifecycle_state_v1" ||
    value.lifecycle.routeFreeze !== "UNFROZEN" ||
    hashWithoutField(
      value.lifecycle as unknown as Record<string, unknown>,
      "stateHash",
    ) !== value.lifecycle.stateHash ||
    value.roles.some(
      (role, index) => role.roleKey !== PRESSURE_CHAPTER_SEAT_IDS_V1[index],
    ) ||
    value.players.some(
      (player, index) =>
        player.seatId !== PRESSURE_CHAPTER_SEAT_IDS_V1[index] ||
        player.roleKey !== PRESSURE_CHAPTER_SEAT_IDS_V1[index],
    )
  ) {
    failPressureProduction(ERROR.RUN_SHELL_RESULT_INVALID, "shell:SHAPE");
  }
  if (value.lifecycle.lobby.replayTargetIntent !== null) {
    const intent = validateReplayResolvedTargetV1(
      value.lifecycle.lobby.replayTargetIntent,
      "shell.lifecycle.lobby.replayTargetIntent",
    );
    if (intent.participantMode !== value.room.participantMode) {
      failPressureProduction(
        ERROR.RUN_SHELL_RESULT_INVALID,
        "shell:REPLAY_TARGET_PARTICIPANT_MODE",
      );
    }
  }
  return value;
}

function roleFromAcceptedContent(
  seat: SangtianSeatContentV1,
  genesisPressure: string,
  knownInfo: readonly string[],
): PressureCanonicalRoleDefinitionV1 {
  return {
    roleKey: seat.seatId,
    roleName: seat.displayName,
    identity: seat.institutionalMission,
    publicInfo: seat.institutionalMission,
    personalGoal: seat.institutionalMission,
    currentState: genesisPressure,
    abilityText: null,
    arcText: null,
    knownInfo: [...knownInfo],
    cannotDo: [],
    sourceSeatId: seat.sourceSeatId,
    initialActorId: seat.initialActorId,
    persistentObjectRefs: [...seat.persistentObjectRefs],
  };
}

function assertCanonicalRoleCatalog(
  definitions: readonly PressureCanonicalRoleDefinitionV1[],
): void {
  if (
    !Array.isArray(definitions) ||
    definitions.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length ||
    definitions.some(
      (definition, index) =>
        definition.roleKey !== PRESSURE_CHAPTER_SEAT_IDS_V1[index] ||
        !nonEmpty(definition.roleName) ||
        !nonEmpty(definition.identity) ||
        !nonEmpty(definition.sourceSeatId),
    )
  ) {
    failPressureProduction(ERROR.RUN_SHELL_RESULT_INVALID, "role-catalog");
  }
}

function normalizeShellCommand(
  command: Readonly<CreatePressureRunShellCommandV1>,
  rosterPolicy: PressureHumanRosterPolicyV1,
): CreatePressureRunShellCommandV1 {
  if (!command || typeof command !== "object") {
    failPressureProduction(ERROR.INVALID_COMMAND, "shell-command:OBJECT");
  }
  for (const [field, value] of [
    ["runId", command.runId],
    ["templateId", command.templateId],
    ["ownerUserId", command.ownerUserId],
    ["title", command.title],
    ["inviteCode", command.inviteCode],
    ["idempotencyKey", command.idempotencyKey],
  ] as const) {
    if (!nonEmpty(value)) {
      failPressureProduction(ERROR.INVALID_COMMAND, `shell-command:${field}`);
    }
  }
  if (command.visibility !== "link" && command.visibility !== "public") {
    failPressureProduction(ERROR.INVALID_COMMAND, "shell-command:visibility");
  }
  const humanAssignments = normalizeHumanAssignments(
    command.participantMode,
    command.humanAssignments,
    rosterPolicy,
  );
  const replayTargetIntent = command.replayTargetIntent
    ? validateReplayResolvedTargetV1(command.replayTargetIntent)
    : null;
  if (
    replayTargetIntent &&
    replayTargetIntent.participantMode !== command.participantMode
  ) {
    failPressureProduction(
      ERROR.INVALID_COMMAND,
      "shell-command:replayTargetIntent.participantMode",
    );
  }
  if (
    command.participantMode === "SOLO" &&
    humanAssignments[0]?.userId !== command.ownerUserId.trim()
  ) {
    failPressureProduction(
      ERROR.INVALID_COMMAND,
      "human-assignments:SOLO_OWNER_MUST_BE_HUMAN",
    );
  }
  return {
    ...command,
    runId: command.runId.trim(),
    templateId: command.templateId.trim(),
    ownerUserId: command.ownerUserId.trim(),
    title: command.title.trim(),
    inviteCode: command.inviteCode.trim(),
    idempotencyKey: command.idempotencyKey.trim(),
    humanAssignments,
    replayTargetIntent,
  };
}

export function normalizeHumanAssignments(
  participantMode: ParticipantModeV1,
  value: readonly PressureHumanSeatAssignmentV1[],
  rosterPolicy: PressureHumanRosterPolicyV1 = "START_ELIGIBLE",
): PressureHumanSeatAssignmentV1[] {
  if (
    (participantMode !== "SOLO" && participantMode !== "MULTIPLAYER") ||
    !Array.isArray(value)
  ) {
    failPressureProduction(ERROR.INVALID_COMMAND, "human-assignments:SHAPE");
  }
  const normalized = value.map((assignment, index) => {
    if (
      !assignment ||
      !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(assignment.seatId) ||
      !nonEmpty(assignment.userId) ||
      !nonEmpty(assignment.humanControllerId)
    ) {
      failPressureProduction(
        ERROR.INVALID_COMMAND,
        `human-assignments:${index}`,
      );
    }
    return {
      seatId: assignment.seatId,
      userId: assignment.userId.trim(),
      humanControllerId: assignment.humanControllerId.trim(),
    };
  });
  const countValid = participantMode === "SOLO"
    ? normalized.length === 1
    : rosterPolicy === "OPEN_LOBBY"
      ? normalized.length >= 0 && normalized.length <= 6
      : normalized.length >= 2 && normalized.length <= 6;
  if (!countValid) {
    failPressureProduction(
      ERROR.INVALID_COMMAND,
      participantMode === "SOLO"
        ? "human-assignments:SOLO_EXACTLY_ONE"
        : rosterPolicy === "OPEN_LOBBY"
          ? "human-assignments:MULTIPLAYER_LOBBY_ZERO_TO_SIX"
          : "human-assignments:MULTIPLAYER_TWO_TO_SIX",
    );
  }
  if (
    new Set(normalized.map((assignment) => assignment.seatId)).size !==
      normalized.length ||
    new Set(normalized.map((assignment) => assignment.userId)).size !==
      normalized.length ||
    new Set(normalized.map((assignment) => assignment.humanControllerId)).size !==
      normalized.length
  ) {
    failPressureProduction(ERROR.INVALID_COMMAND, "human-assignments:UNIQUE");
  }
  const bySeat = new Map(normalized.map((assignment) => [assignment.seatId, assignment]));
  return PRESSURE_CHAPTER_SEAT_IDS_V1.flatMap((seatId) => {
    const assignment = bySeat.get(seatId);
    return assignment ? [assignment] : [];
  });
}

export type PressureHumanRosterPolicyV1 =
  | "OPEN_LOBBY"
  | "START_ELIGIBLE";

function designatedAiControllerId(runId: string, seatId: SeatIdV1): string {
  return `pressure-ai:${sha256Canonical({ runId, seatId, kind: "run-shell" }).slice(0, 32)}`;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
