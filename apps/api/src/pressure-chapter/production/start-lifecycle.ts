import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  hashWithoutField,
  isSha256,
  sha256Canonical,
  type ParticipantModeV1,
  type SeatIdV1,
} from "@ai-story/shared";
import type {
  CreatePressureRunRouteCommandV1,
  CreatePressureRunRouteResultV1,
} from "../run-router";
import type {
  InitializeGenesisCommandV1,
  InitializeGenesisResultV1,
} from "../genesis";
import type {
  InitializeSeatControlCommandV1,
  SeatControlCommandResultV1,
} from "../seat-control";
import type { ChapterOrchestratorStateV1 } from "../orchestrator/contracts";
import {
  buildGenesisOpenN1OutboxDedupeKeyV1,
  type OpenPressureN1FromGenesisHandoffCommandV1,
  type OpenPressureN1FromGenesisHandoffResultV1,
  type PersistedGenesisN1HandoffV1,
  type RuntimeGenesisN1HandoffPortV1,
} from "../runtime/contracts";
import {
  validateReplayResolvedTargetV1,
  type ReplayResolvedTargetV1,
} from "../replay/ports";
import {
  PRESSURE_PRODUCTION_ERROR_CODES as ERROR,
  PressureProductionError,
  failPressureProduction,
} from "./errors";
import {
  normalizeHumanAssignments,
  type PressureHumanSeatAssignmentV1,
} from "./run-shell";

export interface PressureRunRouteCreatorPortV1 {
  create(
    command: CreatePressureRunRouteCommandV1,
  ): Promise<CreatePressureRunRouteResultV1>;
}

export interface PressureGenesisInitializerPortV1 {
  initialize(
    command: InitializeGenesisCommandV1,
  ): Promise<InitializeGenesisResultV1>;
}

export interface PressureSeatControlInitializerPortV1 {
  initialize(
    command: InitializeSeatControlCommandV1,
  ): Promise<SeatControlCommandResultV1>;
}

export type {
  OpenPressureN1FromGenesisHandoffCommandV1,
  OpenPressureN1FromGenesisHandoffResultV1,
  PersistedGenesisN1HandoffV1,
};

/**
 * Claims the unique durable OPEN_CHAPTER outbox row created by the Genesis
 * transaction, invokes PressureChapterOrchestratorService.start idempotently,
 * then acknowledges that same row. A crash after N1 opens but before ack must
 * replay the same claim and observe the existing N1; it must never enqueue or
 * directly open an independent N1.
 */
export type PressureGenesisN1HandoffConsumerPortV1 =
  RuntimeGenesisN1HandoffPortV1;

export interface StartPressureRunCommandV1 {
  runId: string;
  requestedByUserId: string;
  participantMode: ParticipantModeV1;
  humanAssignments: readonly PressureHumanSeatAssignmentV1[];
  routeKey?: string | null;
  nowMs: number;
}

export interface PressureStartBoundaryRequestV1 {
  schemaVersion: "pressure_start_boundary_request_v1";
  runId: string;
  requestedByUserId: string;
  participantMode: ParticipantModeV1;
  humanAssignments: PressureHumanSeatAssignmentV1[];
  routeKey: string | null;
  requestedAtMs: number;
  requestFingerprint: string;
}

export interface PressureEffectiveStartMaterialV1 {
  schemaVersion: "pressure_effective_start_material_v1";
  startRequestFingerprint: string;
  idempotencyKey: string;
  runSeed: string;
  materialHash: string;
}

export interface FrozenPressureHumanSeatSetV1 {
  schemaVersion: "pressure_frozen_human_seat_set_v1";
  runId: string;
  requestedByUserId: string;
  participantMode: ParticipantModeV1;
  humanAssignments: PressureHumanSeatAssignmentV1[];
  routeKey: string | null;
  replayTargetIntent: ReplayResolvedTargetV1 | null;
  startRequestFingerprint: string;
  effectiveStart: PressureEffectiveStartMaterialV1;
  requestFingerprint: string;
  frozenAtMs: number;
  freezeHash: string;
}

export type PressureStartCompletedStageV1 =
  | "HUMAN_SEATS_FROZEN"
  | "ROUTE_FROZEN"
  | "GENESIS_COMMITTED"
  | "SEAT_CONTROL_INITIALIZED"
  | "N1_OPENED";

export type PressureStartFailureStageV1 =
  | "FINALIZE_HUMAN_SEATS"
  | "FREEZE_ROUTE"
  | "RUN_P0_GENESIS"
  | "INITIALIZE_SEAT_CONTROL"
  | "OPEN_N1"
  | "MARK_STARTED";

export interface PressureStartCompletionV1 {
  schemaVersion: "pressure_start_completion_v1";
  runId: string;
  requestFingerprint: string;
  routeHash: string;
  genesisHash: string;
  seatControlStateHash: string;
  chapterOrchestratorHash: string;
  completedAtMs: number;
  completionHash: string;
}

export interface PressureStartFailureV1 {
  schemaVersion: "pressure_start_failure_v1";
  runId: string;
  requestFingerprint: string;
  failedStage: PressureStartFailureStageV1;
  completedStages: PressureStartCompletedStageV1[];
  errorCode: string;
  failureHash: string;
}

/**
 * This adapter owns only the short lobby/start-boundary writes. It freezes the
 * final human roster before route creation, records success, and makes partial
 * durable progress visible after a failure. finalizeHumanSeatSet must verify
 * the requester is the owner, every candidate is a joined+ready member whose
 * current canonical StoryPlayer slot has the same controller id, no additional
 * human slot exists, and the lobby is still mutable. It then locks lobby
 * mutation and stores the exact frozen record in one short transaction. It
 * must not wrap downstream calls in one outer transaction.
 */
export interface PressureStartBoundaryPortV1 {
  finalizeHumanSeatSet(
    request: Readonly<PressureStartBoundaryRequestV1>,
  ): Promise<{
    status: "FROZEN" | "EXISTING";
    frozen: FrozenPressureHumanSeatSetV1;
  }>;
  markStarted(
    completion: Readonly<PressureStartCompletionV1>,
  ): Promise<{ status: "STARTED" | "EXISTING"; completion: PressureStartCompletionV1 }>;
  recordFailure(failure: Readonly<PressureStartFailureV1>): Promise<void>;
}

export interface StartPressureRunResultV1 {
  status: "STARTED" | "EXISTING";
  frozenHumanSeatSet: FrozenPressureHumanSeatSetV1;
  route: CreatePressureRunRouteResultV1;
  genesis: InitializeGenesisResultV1;
  seatControl: SeatControlCommandResultV1;
  n1Handoff: OpenPressureN1FromGenesisHandoffResultV1;
  chapter: ChapterOrchestratorStateV1;
  completion: PressureStartCompletionV1;
}

export class PressureStartLifecycleError extends PressureProductionError {
  constructor(
    readonly runId: string,
    readonly failedStage: PressureStartFailureStageV1,
    readonly completedStages: readonly PressureStartCompletedStageV1[],
    detail: string,
    options?: ErrorOptions,
  ) {
    super(ERROR.START_FAILED, `${runId}:${failedStage}:${detail}`, options);
    this.name = "PressureStartLifecycleError";
  }
}

/**
 * Required order: final roster -> stored route -> P0 -> SeatControl -> N1.
 * N1 is reached only by consuming Genesis' durable OPEN_CHAPTER handoff.
 * Provider and Narrative ports are intentionally absent from this class.
 */
export class PressureStartLifecycleCoordinator {
  constructor(
    private readonly boundary: PressureStartBoundaryPortV1,
    private readonly routes: PressureRunRouteCreatorPortV1,
    private readonly genesis: PressureGenesisInitializerPortV1,
    private readonly seatControl: PressureSeatControlInitializerPortV1,
    private readonly n1Handoff: PressureGenesisN1HandoffConsumerPortV1,
  ) {}

  async start(
    command: Readonly<StartPressureRunCommandV1>,
  ): Promise<StartPressureRunResultV1> {
    const normalized = normalizeStartCommand(command);
    const request = buildPressureStartBoundaryRequest(normalized);
    const completed: PressureStartCompletedStageV1[] = [];
    let failedStage: PressureStartFailureStageV1 = "FINALIZE_HUMAN_SEATS";
    let failureRequestFingerprint = request.requestFingerprint;

    try {
      const frozenResult = await this.boundary.finalizeHumanSeatSet(request);
      if (frozenResult.status !== "FROZEN" && frozenResult.status !== "EXISTING") {
        invalidDependency("startBoundary.finalizeHumanSeatSet.status");
      }
      const frozen = assertFrozenHumanSeatSet(frozenResult.frozen);
      if (
        frozen.runId !== request.runId ||
        frozen.startRequestFingerprint !== request.requestFingerprint
      ) {
        invalidDependency("startBoundary.finalizeHumanSeatSet.fingerprint");
      }
      failureRequestFingerprint = frozen.requestFingerprint;
      completed.push("HUMAN_SEATS_FROZEN");

      failedStage = "FREEZE_ROUTE";
      const route = await this.routes.create({
        runId: frozen.runId,
        routeKey:
          frozen.replayTargetIntent?.pinnedRegistration.registration.routeKey ??
          frozen.routeKey,
        participantMode: frozen.participantMode,
        humanSeatIdsAtStart: frozen.humanAssignments.map(
          (assignment) => assignment.seatId,
        ),
        runSeed: frozen.effectiveStart.runSeed,
        pinnedRegistration:
          frozen.replayTargetIntent?.pinnedRegistration ?? null,
      });
      assertRouteResult(route, frozen);
      completed.push("ROUTE_FROZEN");

      failedStage = "RUN_P0_GENESIS";
      const genesis = await this.genesis.initialize({
        runId: frozen.runId,
        idempotencyKey: stageIdempotencyKey(frozen, "genesis"),
        requestFingerprint: sha256Canonical({
          schemaVersion: "pressure_start_genesis_request_v1",
          frozenHumanSeatSetHash: frozen.freezeHash,
          routeHash: route.route.snapshot.routeHash,
        }),
      });
      const genesisRefs = assertGenesisResult(
        genesis,
        frozen.runId,
        route.route.snapshot.routeHash,
      );
      completed.push("GENESIS_COMMITTED");

      failedStage = "INITIALIZE_SEAT_CONTROL";
      const seatControl = await this.seatControl.initialize({
        runId: frozen.runId,
        idempotencyKey: stageIdempotencyKey(frozen, "seat-control"),
        humanAssignments: frozen.humanAssignments.map((assignment) => ({
          seatId: assignment.seatId,
          humanControllerId: assignment.humanControllerId,
        })),
      });
      const seatStateHash = assertSeatControlResult(
        seatControl,
        frozen,
        route.route.snapshot.routeHash,
        genesisRefs.genesisHash,
      );
      completed.push("SEAT_CONTROL_INITIALIZED");

      failedStage = "OPEN_N1";
      const expectedOutboxDedupeKey = buildGenesisOpenN1OutboxDedupeKeyV1(
        frozen.runId,
        genesisRefs.genesisCommitHash,
      );
      const persistedHandoff: PersistedGenesisN1HandoffV1 = {
        schemaVersion: "pressure_genesis_n1_handoff_v1",
        taskType: "OPEN_CHAPTER",
        checkpoint: "PERSISTED",
        sourceAuthority: "GENESIS_FROZEN",
        runId: frozen.runId,
        chapterId: "N1",
        genesisHash: genesisRefs.genesisHash,
        sourceCommitHash: genesisRefs.genesisCommitHash,
        outboxDedupeKey: expectedOutboxDedupeKey,
      };
      const n1Handoff = await this.n1Handoff.openFromGenesisHandoff({
        routeSnapshot: route.route.snapshot,
        genesis: genesis.committed,
        handoff: persistedHandoff,
        idempotencyKey: stageIdempotencyKey(frozen, "open-n1"),
        requestFingerprint: sha256Canonical({
          schemaVersion: "pressure_start_open_n1_request_v1",
          frozenHumanSeatSetHash: frozen.freezeHash,
          routeHash: route.route.snapshot.routeHash,
          genesisCommitHash: genesisRefs.genesisCommitHash,
          outboxDedupeKey: expectedOutboxDedupeKey,
        }),
        nowMs: normalized.nowMs,
      });
      assertN1HandoffResult(
        n1Handoff,
        frozen.runId,
        route.route.snapshot.routeHash,
        genesisRefs.genesisCommitHash,
        expectedOutboxDedupeKey,
      );
      const chapter = n1Handoff.chapter;
      assertChapterResult(chapter, frozen.runId, route.route.snapshot.routeHash);
      completed.push("N1_OPENED");

      failedStage = "MARK_STARTED";
      const completion = buildStartCompletion({
        runId: frozen.runId,
        requestFingerprint: frozen.requestFingerprint,
        routeHash: route.route.snapshot.routeHash,
        genesisHash: genesisRefs.genesisHash,
        seatControlStateHash: seatStateHash,
        chapterOrchestratorHash: chapter.orchestratorHash,
        completedAtMs: normalized.nowMs,
      });
      const marked = await this.boundary.markStarted(completion);
      if (marked.status !== "STARTED" && marked.status !== "EXISTING") {
        invalidDependency("startBoundary.markStarted.status");
      }
      const storedCompletion = assertStartCompletion(marked.completion);
      if (
        (marked.status === "STARTED" &&
          storedCompletion.completionHash !== completion.completionHash) ||
        !sameStartCompletionAuthority(storedCompletion, completion)
      ) {
        invalidDependency("startBoundary.markStarted.completion");
      }
      return {
        status: marked.status,
        frozenHumanSeatSet: structuredClone(frozen),
        route: structuredClone(route),
        genesis: structuredClone(genesis),
        seatControl: structuredClone(seatControl),
        n1Handoff: structuredClone(n1Handoff),
        chapter: structuredClone(chapter),
        completion: structuredClone(storedCompletion),
      };
    } catch (cause) {
      const errorCode = readErrorCode(cause);
      const failure = buildStartFailure({
        runId: normalized.runId,
        requestFingerprint: failureRequestFingerprint,
        failedStage,
        completedStages: completed,
        errorCode,
      });
      try {
        await this.boundary.recordFailure(failure);
      } catch (recordingCause) {
        failPressureProduction(
          ERROR.START_FAILURE_RECORDING_FAILED,
          `${normalized.runId}:${failedStage}:${readErrorCode(recordingCause)}`,
          { cause },
        );
      }
      throw new PressureStartLifecycleError(
        normalized.runId,
        failedStage,
        completed,
        errorCode,
        { cause },
      );
    }
  }
}

export function buildPressureStartBoundaryRequest(
  command: Readonly<StartPressureRunCommandV1>,
): PressureStartBoundaryRequestV1 {
  const normalized = normalizeStartCommand(command);
  const base = {
    schemaVersion: "pressure_start_boundary_request_v1" as const,
    runId: normalized.runId,
    requestedByUserId: normalized.requestedByUserId,
    participantMode: normalized.participantMode,
    humanAssignments: [...normalized.humanAssignments],
    routeKey: normalized.routeKey ?? null,
  };
  return {
    ...base,
    requestedAtMs: normalized.nowMs,
    requestFingerprint: sha256Canonical(base),
  };
}

export function assertPressureStartBoundaryRequest(
  value: PressureStartBoundaryRequestV1,
): PressureStartBoundaryRequestV1 {
  if (
    !value ||
    value.schemaVersion !== "pressure_start_boundary_request_v1" ||
    typeof value.runId !== "string" ||
    !value.runId.trim() ||
    typeof value.requestedByUserId !== "string" ||
    !value.requestedByUserId.trim() ||
    (value.participantMode !== "SOLO" && value.participantMode !== "MULTIPLAYER") ||
    (value.routeKey !== null &&
      (typeof value.routeKey !== "string" || !value.routeKey.trim())) ||
    !Number.isSafeInteger(value.requestedAtMs) ||
    value.requestedAtMs < 0 ||
    !isSha256(value.requestFingerprint)
  ) {
    invalidDependency("startBoundary.request");
  }
  const humanAssignments = normalizeHumanAssignments(
    value.participantMode,
    value.humanAssignments,
  );
  if (
    humanAssignments.length !== value.humanAssignments.length ||
    humanAssignments.some(
      (assignment, index) =>
        sha256Canonical(assignment) !==
        sha256Canonical(value.humanAssignments[index]),
    )
  ) {
    invalidDependency("startBoundary.request.humanAssignments");
  }
  const base = {
    schemaVersion: value.schemaVersion,
    runId: value.runId,
    requestedByUserId: value.requestedByUserId,
    participantMode: value.participantMode,
    humanAssignments,
    routeKey: value.routeKey,
  };
  if (sha256Canonical(base) !== value.requestFingerprint) {
    invalidDependency("startBoundary.request.requestFingerprint");
  }
  return value;
}

export function buildPressureEffectiveStartMaterial(input: {
  startRequestFingerprint: string;
  idempotencyKey: string;
  runSeed: string;
}): PressureEffectiveStartMaterialV1 {
  const base = {
    schemaVersion: "pressure_effective_start_material_v1" as const,
    startRequestFingerprint: input.startRequestFingerprint,
    idempotencyKey: input.idempotencyKey,
    runSeed: input.runSeed,
  };
  return assertPressureEffectiveStartMaterial({
    ...base,
    materialHash: sha256Canonical(base),
  });
}

export function assertPressureEffectiveStartMaterial(
  value: PressureEffectiveStartMaterialV1,
): PressureEffectiveStartMaterialV1 {
  if (
    !value ||
    value.schemaVersion !== "pressure_effective_start_material_v1" ||
    !isSha256(value.startRequestFingerprint) ||
    typeof value.idempotencyKey !== "string" ||
    !value.idempotencyKey.trim() ||
    typeof value.runSeed !== "string" ||
    !value.runSeed.trim() ||
    !isSha256(value.materialHash) ||
    hashWithoutField(
      value as unknown as Record<string, unknown>,
      "materialHash",
    ) !== value.materialHash
  ) {
    invalidDependency("startBoundary.effectiveStart");
  }
  return value;
}

export function buildFrozenHumanSeatSet(
  requestValue: Readonly<PressureStartBoundaryRequestV1>,
  effectiveStartValue: Readonly<PressureEffectiveStartMaterialV1>,
  replayTargetIntentValue: Readonly<ReplayResolvedTargetV1> | null = null,
): FrozenPressureHumanSeatSetV1 {
  const request = structuredClone(
    assertPressureStartBoundaryRequest(
      requestValue as PressureStartBoundaryRequestV1,
    ),
  );
  const effectiveStart = structuredClone(
    assertPressureEffectiveStartMaterial(
      effectiveStartValue as PressureEffectiveStartMaterialV1,
    ),
  );
  if (effectiveStart.startRequestFingerprint !== request.requestFingerprint) {
    invalidDependency("startBoundary.effectiveStart.startRequestFingerprint");
  }
  const replayTargetIntent = replayTargetIntentValue
    ? validateReplayResolvedTargetV1(replayTargetIntentValue)
    : null;
  if (
    replayTargetIntent &&
    replayTargetIntent.participantMode !== request.participantMode
  ) {
    invalidDependency("startBoundary.replayTargetIntent.participantMode");
  }
  const requestFingerprint = sha256Canonical({
    schemaVersion: "pressure_effective_start_request_v1",
    startRequestFingerprint: request.requestFingerprint,
    startMaterialHash: effectiveStart.materialHash,
    replayTargetDescriptorHash:
      replayTargetIntent?.targetDescriptorHash ?? null,
  });
  const base = {
    schemaVersion: "pressure_frozen_human_seat_set_v1" as const,
    runId: request.runId,
    requestedByUserId: request.requestedByUserId,
    participantMode: request.participantMode,
    humanAssignments: [...request.humanAssignments],
    routeKey: request.routeKey,
    replayTargetIntent,
    startRequestFingerprint: request.requestFingerprint,
    effectiveStart,
    requestFingerprint,
    frozenAtMs: request.requestedAtMs,
  };
  return { ...base, freezeHash: sha256Canonical(base) };
}

export function assertFrozenHumanSeatSet(
  value: FrozenPressureHumanSeatSetV1,
): FrozenPressureHumanSeatSetV1 {
  if (
    !value ||
    value.schemaVersion !== "pressure_frozen_human_seat_set_v1" ||
    !isSha256(value.startRequestFingerprint) ||
    !isSha256(value.requestFingerprint) ||
    !isSha256(value.freezeHash) ||
    !Number.isSafeInteger(value.frozenAtMs) ||
    value.frozenAtMs < 0 ||
    (value.routeKey !== null &&
      (typeof value.routeKey !== "string" || !value.routeKey.trim())) ||
    hashWithoutField(value as unknown as Record<string, unknown>, "freezeHash") !==
      value.freezeHash
  ) {
    invalidDependency("frozenHumanSeatSet");
  }
  const normalized = normalizeHumanAssignments(
    value.participantMode,
    value.humanAssignments,
  );
  if (
    normalized.length !== value.humanAssignments.length ||
    normalized.some(
      (assignment, index) =>
        sha256Canonical(assignment) !==
        sha256Canonical(value.humanAssignments[index]),
    )
  ) {
    invalidDependency("frozenHumanSeatSet.humanAssignments");
  }
  const effectiveStart = assertPressureEffectiveStartMaterial(
    value.effectiveStart,
  );
  const startRequestFingerprint = sha256Canonical({
    schemaVersion: "pressure_start_boundary_request_v1",
    runId: value.runId,
    requestedByUserId: value.requestedByUserId,
    participantMode: value.participantMode,
    humanAssignments: normalized,
    routeKey: value.routeKey,
  });
  const effectiveRequestFingerprint = sha256Canonical({
    schemaVersion: "pressure_effective_start_request_v1",
    startRequestFingerprint,
    startMaterialHash: effectiveStart.materialHash,
    replayTargetDescriptorHash:
      value.replayTargetIntent?.targetDescriptorHash ?? null,
  });
  if (value.replayTargetIntent !== null) {
    const intent = validateReplayResolvedTargetV1(
      value.replayTargetIntent,
      "frozenHumanSeatSet.replayTargetIntent",
    );
    if (intent.participantMode !== value.participantMode) {
      invalidDependency("frozenHumanSeatSet.replayTargetIntent.participantMode");
    }
  }
  if (
    value.startRequestFingerprint !== startRequestFingerprint ||
    effectiveStart.startRequestFingerprint !== startRequestFingerprint ||
    value.requestFingerprint !== effectiveRequestFingerprint
  ) {
    invalidDependency("frozenHumanSeatSet.requestFingerprint");
  }
  return value;
}

function normalizeStartCommand(
  command: Readonly<StartPressureRunCommandV1>,
): StartPressureRunCommandV1 {
  if (!command || typeof command !== "object") {
    failPressureProduction(ERROR.INVALID_COMMAND, "start-command:OBJECT");
  }
  const raw = command as unknown as Record<string, unknown>;
  if ("runSeed" in raw || "idempotencyKey" in raw) {
    failPressureProduction(
      ERROR.INVALID_COMMAND,
      "start-command:server-owned-material",
    );
  }
  for (const [field, value] of [
    ["runId", command.runId],
    ["requestedByUserId", command.requestedByUserId],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      failPressureProduction(ERROR.INVALID_COMMAND, `start-command:${field}`);
    }
  }
  if (
    command.routeKey !== undefined &&
    command.routeKey !== null &&
    (typeof command.routeKey !== "string" || command.routeKey.trim().length === 0)
  ) {
    failPressureProduction(ERROR.INVALID_COMMAND, "start-command:routeKey");
  }
  if (!Number.isSafeInteger(command.nowMs) || command.nowMs < 0) {
    failPressureProduction(ERROR.INVALID_COMMAND, "start-command:nowMs");
  }
  return {
    runId: command.runId.trim(),
    requestedByUserId: command.requestedByUserId.trim(),
    participantMode: command.participantMode,
    routeKey: command.routeKey?.trim() ?? null,
    humanAssignments: normalizeHumanAssignments(
      command.participantMode,
      command.humanAssignments,
    ),
    nowMs: command.nowMs,
  };
}

function assertRouteResult(
  result: CreatePressureRunRouteResultV1,
  frozen: FrozenPressureHumanSeatSetV1,
): void {
  const route = result?.route;
  const expectedHumans = frozen.humanAssignments.map((assignment) => assignment.seatId);
  if (
    (result.status !== "CREATED" && result.status !== "EXISTING") ||
    !route ||
    route.runId !== frozen.runId ||
    route.snapshot.runId !== frozen.runId ||
    route.snapshot.participantMode !== frozen.participantMode ||
    !isSha256(route.snapshot.routeHash) ||
    route.snapshot.humanSeatIdsAtStart.length !== expectedHumans.length ||
    route.snapshot.humanSeatIdsAtStart.some(
      (seatId, index) => seatId !== expectedHumans[index],
    ) ||
    route.controlTopology.seatControls.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length ||
    route.controlTopology.seatControls.some(
      (control, index) => control.seatId !== PRESSURE_CHAPTER_SEAT_IDS_V1[index],
    )
  ) {
    invalidDependency("runRouter.create");
  }
  const pin = frozen.replayTargetIntent?.pinnedRegistration;
  if (pin && !routeResultMatchesPinnedRegistration(route, pin)) {
    invalidDependency("runRouter.create.pinnedRegistration");
  }
}

function routeResultMatchesPinnedRegistration(
  route: CreatePressureRunRouteResultV1["route"],
  pin: NonNullable<FrozenPressureHumanSeatSetV1["replayTargetIntent"]>["pinnedRegistration"],
): boolean {
  const registration = pin.registration;
  const snapshot = route.snapshot;
  return (
    route.registryVersion === pin.registryVersion &&
    route.registryHash === pin.registryHash &&
    route.routeKey === registration.routeKey &&
    route.handlerKey === registration.handlerKey &&
    route.resultAdapterKey === registration.resultAdapterKey &&
    route.presentationSchemaVersion === registration.presentationSchemaVersion &&
    route.rendererKey === registration.rendererKey &&
    sha256Canonical(snapshot.route) === sha256Canonical(registration.route) &&
    snapshot.contentPackageVersion === registration.contentPackageVersion &&
    snapshot.contentPackageSha256 === registration.contentPackageSha256 &&
    snapshot.orchestrationPackageVersion === registration.orchestrationPackageVersion &&
    snapshot.orchestrationPackageSha256 === registration.orchestrationPackageSha256 &&
    snapshot.runtimeContractVersion === registration.runtimeContractVersion &&
    snapshot.runtimeContractSha256 === registration.runtimeContractSha256 &&
    snapshot.testMatrixVersion === registration.testMatrixVersion &&
    snapshot.testMatrixSha256 === registration.testMatrixSha256 &&
    snapshot.narrativeProfileVersion === registration.narrativeProfileVersion &&
    snapshot.featureSetVersion === registration.featureSetVersion &&
    snapshot.resultContractRegistryVersion === registration.resultContractRegistryVersion &&
    snapshot.controlTopologyVersion === registration.controlTopologyVersion
  );
}

function assertGenesisResult(
  result: InitializeGenesisResultV1,
  runId: string,
  routeHash: string,
): {
  genesisHash: string;
  genesisCommitHash: string;
  initialWorldStateHash: string;
} {
  const record = result?.committed?.record;
  if (
    (result.status !== "COMMITTED" && result.status !== "REPLAYED") ||
    !record ||
    record.runId !== runId ||
    record.snapshot.runId !== runId ||
    record.snapshot.routeHash !== routeHash ||
    record.commit.sequence !== 0 ||
    !isSha256(record.snapshot.genesisHash) ||
    !isSha256(record.commit.commitHash) ||
    !isSha256(record.snapshot.initialWorldState.stateHash)
  ) {
    invalidDependency("genesis.initialize");
  }
  return {
    genesisHash: record.snapshot.genesisHash,
    genesisCommitHash: record.commit.commitHash,
    initialWorldStateHash: record.snapshot.initialWorldState.stateHash,
  };
}

function assertN1HandoffResult(
  result: OpenPressureN1FromGenesisHandoffResultV1,
  runId: string,
  routeHash: string,
  sourceCommitHash: string,
  expectedDedupeKey: string,
): void {
  if (
    !result ||
    (result.status !== "OPENED" && result.status !== "REPLAYED") ||
    result.sourceTaskType !== "OPEN_CHAPTER" ||
    result.sourceAuthority !== "GENESIS_FROZEN" ||
    result.outboxStatus !== "ACKNOWLEDGED" ||
    result.sourceCommitHash !== sourceCommitHash ||
    result.sourceDedupeKey !== expectedDedupeKey
  ) {
    invalidDependency("n1Handoff.openFromGenesisHandoff");
  }
  assertChapterResult(result.chapter, runId, routeHash);
}

function assertSeatControlResult(
  result: SeatControlCommandResultV1,
  frozen: FrozenPressureHumanSeatSetV1,
  routeHash: string,
  genesisHash: string,
): string {
  const snapshot = result?.committed?.snapshot;
  const expectedHumans = new Set(
    frozen.humanAssignments.map((assignment) => assignment.seatId),
  );
  if (
    (result.status !== "COMMITTED" && result.status !== "REPLAYED") ||
    !snapshot ||
    snapshot.runId !== frozen.runId ||
    snapshot.routeHash !== routeHash ||
    snapshot.genesisHash !== genesisHash ||
    !isSha256(snapshot.stateHash) ||
    snapshot.seatControls.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length ||
    snapshot.seatControls.some(
      (control, index) =>
        control.seatId !== PRESSURE_CHAPTER_SEAT_IDS_V1[index] ||
        (expectedHumans.has(control.seatId)
          ? control.mode !== "HUMAN_ACTIVE"
          : control.mode !== "AI_ACTIVE"),
    )
  ) {
    invalidDependency("seatControl.initialize");
  }
  return snapshot.stateHash;
}

function assertChapterResult(
  chapter: ChapterOrchestratorStateV1,
  runId: string,
  routeHash: string,
): void {
  if (
    !chapter ||
    chapter.runId !== runId ||
    chapter.routeHash !== routeHash ||
    chapter.currentChapterId !== "N1" ||
    !isSha256(chapter.orchestratorHash)
  ) {
    invalidDependency("chapters.start");
  }
}

function buildStartCompletion(
  input: Omit<PressureStartCompletionV1, "schemaVersion" | "completionHash">,
): PressureStartCompletionV1 {
  const base = {
    schemaVersion: "pressure_start_completion_v1" as const,
    ...input,
  };
  return { ...base, completionHash: sha256Canonical(base) };
}

function assertStartCompletion(
  value: PressureStartCompletionV1,
): PressureStartCompletionV1 {
  if (
    !value ||
    value.schemaVersion !== "pressure_start_completion_v1" ||
    !isSha256(value.completionHash) ||
    hashWithoutField(
      value as unknown as Record<string, unknown>,
      "completionHash",
    ) !== value.completionHash
  ) {
    invalidDependency("startCompletion");
  }
  return value;
}

function sameStartCompletionAuthority(
  left: PressureStartCompletionV1,
  right: PressureStartCompletionV1,
): boolean {
  return (
    left.runId === right.runId &&
    left.requestFingerprint === right.requestFingerprint &&
    left.routeHash === right.routeHash &&
    left.genesisHash === right.genesisHash &&
    left.seatControlStateHash === right.seatControlStateHash &&
    left.chapterOrchestratorHash === right.chapterOrchestratorHash
  );
}

function buildStartFailure(
  input: Omit<PressureStartFailureV1, "schemaVersion" | "failureHash">,
): PressureStartFailureV1 {
  const base = {
    schemaVersion: "pressure_start_failure_v1" as const,
    ...input,
    completedStages: [...input.completedStages],
  };
  return { ...base, failureHash: sha256Canonical(base) };
}

function stageIdempotencyKey(
  frozen: FrozenPressureHumanSeatSetV1,
  stage: "genesis" | "seat-control" | "open-n1",
): string {
  return `pressure-start:${frozen.requestFingerprint.slice(0, 32)}:${stage}`;
}

function invalidDependency(path: string): never {
  return failPressureProduction(ERROR.START_DEPENDENCY_RESULT_INVALID, path);
}

function readErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "").trim();
    if (code) return code;
  }
  if (error instanceof Error && error.name) return error.name;
  return "UNKNOWN_ERROR";
}
