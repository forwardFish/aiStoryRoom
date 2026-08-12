import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  hashWithoutField,
  isSha256,
  sha256Canonical,
  validateRunRouteSnapshotV1,
  withRunRouteHash,
  type ExpectedPressureRunRouteRegistrationV1,
  type ParticipantModeV1,
  type SeatIdV1,
} from "@ai-story/shared";
import type { PressureChapterRouteRegistrationV1 } from "@ai-story/templates";
import {
  RUN_ROUTER_ERROR_CODES as ERROR,
  failRunRouter,
} from "./errors";
import type {
  CreatePressureRunRouteCommandV1,
  CreatePressureRunRouteResultV1,
  InitialRoleControlTopologyV1,
  PressureChapterRouteRegistryPort,
  PressurePinnedRouteRegistrationV1,
  RunRouteRepositoryPort,
  StoredRouteOperationV1,
  StoredRunRouteDispatchV1,
  StoredRunRouteReaderPort,
  StoredRunRouteRecordV1,
} from "./types";

const ROUTE_RECORD_SCHEMA = "pressure_stored_run_route_v1" as const;
const CONTROL_TOPOLOGY_SCHEMA =
  "pressure_initial_role_control_topology_v1" as const;
const STORED_ROUTE_RECORD_KEYS = [
  "schemaVersion",
  "runId",
  "routeKey",
  "registryVersion",
  "registryHash",
  "handlerKey",
  "resultAdapterKey",
  "presentationSchemaVersion",
  "rendererKey",
  "createRequestFingerprint",
  "snapshot",
  "controlTopology",
  "recordHash",
] as const;
const CONTROL_TOPOLOGY_KEYS = [
  "schemaVersion",
  "controlTopologyVersion",
  "participantMode",
  "seatControls",
  "topologyHash",
] as const;
const SEAT_CONTROL_KEYS = ["seatId", "mode"] as const;

export class PressureChapterRunRouterService
  implements StoredRunRouteReaderPort
{
  constructor(
    private readonly repository: RunRouteRepositoryPort,
    private readonly registry: PressureChapterRouteRegistryPort,
  ) {}

  async create(
    command: CreatePressureRunRouteCommandV1,
  ): Promise<CreatePressureRunRouteResultV1> {
    const normalized = normalizeCreateCommand(command);
    const createRequestFingerprint = computeCreateRequestFingerprint(normalized);

    // Existing runs are resolved before consulting the live registry. This is
    // the central stored-route invariant: a flag/default change cannot move a run.
    const existing = await this.repository.findByRunId(normalized.runId);
    if (existing) {
      return {
        status: "EXISTING",
        route: this.assertMatchingExisting(existing, createRequestFingerprint),
      };
    }

    const registration = normalized.pinnedRegistration
      ? this.resolvePinnedRegistration(
          normalized.pinnedRegistration,
          normalized.routeKey,
          normalized.participantMode,
        )
      : this.registry.resolveCreate(
          normalized.routeKey,
          normalized.participantMode,
        );
    const controlTopology = buildControlTopology(
      normalized.participantMode,
      normalized.humanSeatIdsAtStart,
      registration.controlTopologyVersion,
    );
    const snapshot = withRunRouteHash({
      schemaVersion: "pressure_run_route_snapshot_v1",
      runId: normalized.runId,
      route: { ...registration.route },
      contentPackageVersion: registration.contentPackageVersion,
      contentPackageSha256: registration.contentPackageSha256,
      orchestrationPackageVersion: registration.orchestrationPackageVersion,
      orchestrationPackageSha256: registration.orchestrationPackageSha256,
      runtimeContractVersion: registration.runtimeContractVersion,
      runtimeContractSha256: registration.runtimeContractSha256,
      testMatrixVersion: registration.testMatrixVersion,
      testMatrixSha256: registration.testMatrixSha256,
      runSeed: normalized.runSeed,
      narrativeProfileVersion: registration.narrativeProfileVersion,
      featureSetVersion: registration.featureSetVersion,
      resultContractRegistryVersion:
        registration.resultContractRegistryVersion,
      participantMode: normalized.participantMode,
      seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
      humanSeatIdsAtStart: [...normalized.humanSeatIdsAtStart],
      controlTopologyVersion: registration.controlTopologyVersion,
      initialRoleControlSnapshotHash: controlTopology.topologyHash,
    });
    validateRunRouteSnapshotV1(snapshot, expectedRegistration(registration));

    const recordBase = {
      schemaVersion: ROUTE_RECORD_SCHEMA,
      runId: normalized.runId,
      routeKey: registration.routeKey,
      registryVersion: this.registry.registryVersion,
      registryHash: this.registry.registryHash,
      handlerKey: registration.handlerKey,
      resultAdapterKey: registration.resultAdapterKey,
      presentationSchemaVersion: registration.presentationSchemaVersion,
      rendererKey: registration.rendererKey,
      createRequestFingerprint,
      snapshot,
      controlTopology,
    };
    const candidate: StoredRunRouteRecordV1 = {
      ...recordBase,
      recordHash: sha256Canonical(recordBase),
    };
    assertStoredRunRouteRecord(candidate);

    const persisted = await this.repository.insertIfAbsent(candidate);
    const route = this.assertMatchingExisting(
      persisted.record,
      createRequestFingerprint,
    );
    return {
      status: persisted.status === "INSERTED" ? "CREATED" : "EXISTING",
      route,
    };
  }

  async readStoredRoute(runId: string): Promise<StoredRunRouteRecordV1> {
    assertNonEmptyString(runId, "runId");
    const stored = await this.repository.findByRunId(runId);
    if (!stored) failRunRouter(ERROR.RUN_ROUTE_NOT_FOUND, "runId", runId);
    return clone(assertStoredRunRouteRecord(stored));
  }

  resolveGame(runId: string): Promise<StoredRunRouteDispatchV1> {
    return this.resolveStored(runId, "GAME");
  }

  resolveAction(runId: string): Promise<StoredRunRouteDispatchV1> {
    return this.resolveStored(runId, "ACTION");
  }

  resolveResult(runId: string): Promise<StoredRunRouteDispatchV1> {
    return this.resolveStored(runId, "RESULT");
  }

  resolveReplay(runId: string): Promise<StoredRunRouteDispatchV1> {
    return this.resolveStored(runId, "REPLAY");
  }

  private async resolveStored(
    runId: string,
    operation: StoredRouteOperationV1,
  ): Promise<StoredRunRouteDispatchV1> {
    const stored = await this.readStoredRoute(runId);
    return {
      schemaVersion: "pressure_stored_route_dispatch_v1",
      operation,
      runId: stored.runId,
      routeKey: stored.routeKey,
      routeHash: stored.snapshot.routeHash,
      route: { ...stored.snapshot.route },
      handlerKey: stored.handlerKey,
      resultAdapterKey: stored.resultAdapterKey,
      presentationSchemaVersion: stored.presentationSchemaVersion,
      rendererKey: stored.rendererKey,
    };
  }

  private assertMatchingExisting(
    record: StoredRunRouteRecordV1,
    createRequestFingerprint: string,
  ): StoredRunRouteRecordV1 {
    const stored = assertStoredRunRouteRecord(record);
    if (stored.createRequestFingerprint !== createRequestFingerprint) {
      failRunRouter(
        ERROR.RUN_CREATE_FINGERPRINT_MISMATCH,
        "createRequestFingerprint",
        `EXPECTED_${stored.createRequestFingerprint}`,
      );
    }
    return clone(stored);
  }

  private resolvePinnedRegistration(
    pinValue: PressurePinnedRouteRegistrationV1,
    routeKey: string | null,
    participantMode: ParticipantModeV1,
  ): PressureChapterRouteRegistrationV1 {
    const pin = validatePressurePinnedRouteRegistrationV1(pinValue);
    if (
      pin.registryVersion !== this.registry.registryVersion ||
      pin.registryHash !== this.registry.registryHash ||
      (routeKey !== null && routeKey !== pin.registration.routeKey)
    ) {
      failRunRouter(
        ERROR.RUN_ROUTE_RECORD_INVALID,
        "command.pinnedRegistration",
        "REGISTRY_OR_ROUTE_KEY_DRIFT",
      );
    }
    const current = this.registry.resolveStored(
      pin.registration.routeKey,
      pin.registration.route,
    );
    if (
      current.status !== "PUBLISHED" ||
      current.createEnabled !== true ||
      !current.participantModes.includes(participantMode) ||
      sha256Canonical(current) !== pin.registrationHash
    ) {
      failRunRouter(
        ERROR.RUN_ROUTE_RECORD_INVALID,
        "command.pinnedRegistration.registration",
        "PINNED_REGISTRATION_DRIFT",
      );
    }
    return clone(current);
  }
}

export function computeCreateRequestFingerprint(
  command: CreatePressureRunRouteCommandV1,
): string {
  const normalized = normalizeCreateCommand(command);
  return sha256Canonical({
    schemaVersion: "pressure_run_route_create_request_v1",
    runId: normalized.runId,
    routeKey: normalized.routeKey,
    participantMode: normalized.participantMode,
    humanSeatIdsAtStart: normalized.humanSeatIdsAtStart,
    runSeed: normalized.runSeed,
    pinnedRegistrationHash: normalized.pinnedRegistration?.pinHash ?? null,
  });
}

export function buildPressurePinnedRouteRegistrationV1(input: {
  registryVersion: string;
  registryHash: string;
  registration: PressureChapterRouteRegistrationV1;
}): PressurePinnedRouteRegistrationV1 {
  const registration = clone(input.registration);
  const base = {
    schemaVersion: "pressure_pinned_route_registration_v1" as const,
    registryVersion: input.registryVersion,
    registryHash: input.registryHash,
    registration,
    registrationHash: sha256Canonical(registration),
  };
  return validatePressurePinnedRouteRegistrationV1({
    ...base,
    pinHash: sha256Canonical(base),
  });
}

export function validatePressurePinnedRouteRegistrationV1(
  value: PressurePinnedRouteRegistrationV1,
): PressurePinnedRouteRegistrationV1 {
  if (
    !value ||
    typeof value !== "object" ||
    value.schemaVersion !== "pressure_pinned_route_registration_v1" ||
    typeof value.registryVersion !== "string" ||
    !value.registryVersion.trim() ||
    !isSha256(value.registryHash) ||
    !value.registration ||
    typeof value.registration !== "object" ||
    !isSha256(value.registrationHash) ||
    value.registrationHash !== sha256Canonical(value.registration) ||
    !isSha256(value.pinHash) ||
    value.pinHash !== hashWithoutField(
      value as unknown as Record<string, unknown>,
      "pinHash",
    )
  ) {
    failRunRouter(
      ERROR.RUN_ROUTE_RECORD_INVALID,
      "pinnedRegistration",
      "HASH_OR_SHAPE",
    );
  }
  return clone(value);
}

export function assertStoredRunRouteRecord(
  value: StoredRunRouteRecordV1,
): StoredRunRouteRecordV1 {
  if (!value || typeof value !== "object") {
    failRunRouter(ERROR.RUN_ROUTE_RECORD_INVALID, "storedRoute", "OBJECT");
  }
  assertExactKeys(value, STORED_ROUTE_RECORD_KEYS, "storedRoute");
  if (value.schemaVersion !== ROUTE_RECORD_SCHEMA) {
    failRunRouter(
      ERROR.RUN_ROUTE_RECORD_INVALID,
      "storedRoute.schemaVersion",
      `EXPECTED_${ROUTE_RECORD_SCHEMA}`,
    );
  }
  for (const [path, field] of [
    ["storedRoute.runId", value.runId],
    ["storedRoute.routeKey", value.routeKey],
    ["storedRoute.registryVersion", value.registryVersion],
  ] as const) {
    assertNonEmptyString(field, path);
  }
  if (!isSha256(value.registryHash)) {
    failRunRouter(
      ERROR.RUN_ROUTE_RECORD_INVALID,
      "storedRoute.registryHash",
      "SHA256_LOWER_HEX",
    );
  }
  if (!isSha256(value.createRequestFingerprint)) {
    failRunRouter(
      ERROR.RUN_ROUTE_RECORD_INVALID,
      "storedRoute.createRequestFingerprint",
      "SHA256_LOWER_HEX",
    );
  }
  if (!isSha256(value.recordHash)) {
    failRunRouter(
      ERROR.RUN_ROUTE_RECORD_INVALID,
      "storedRoute.recordHash",
      "SHA256_LOWER_HEX",
    );
  }
  const expectedRecordHash = hashWithoutField(
    value as unknown as Record<string, unknown>,
    "recordHash",
  );
  if (value.recordHash !== expectedRecordHash) {
    failRunRouter(
      ERROR.RUN_ROUTE_RECORD_HASH_MISMATCH,
      "storedRoute.recordHash",
      `EXPECTED_${expectedRecordHash}`,
    );
  }

  validateRunRouteSnapshotV1(value.snapshot);
  if (value.snapshot.runId !== value.runId) {
    failRunRouter(
      ERROR.RUN_ROUTE_RECORD_INVALID,
      "storedRoute.snapshot.runId",
      `EXPECTED_${value.runId}`,
    );
  }
  assertInitialRoleControlTopology(
    value.controlTopology,
    value.snapshot.participantMode,
  );
  if (
    value.snapshot.initialRoleControlSnapshotHash !==
      value.controlTopology.topologyHash ||
    value.snapshot.controlTopologyVersion !==
      value.controlTopology.controlTopologyVersion
  ) {
    failRunRouter(
      ERROR.RUN_ROUTE_RECORD_INVALID,
      "storedRoute.controlTopology",
      "SNAPSHOT_TOPOLOGY_MISMATCH",
    );
  }
  const topologyHumans = value.controlTopology.seatControls
    .filter((control) => control.mode === "HUMAN_ACTIVE")
    .map((control) => control.seatId);
  if (
    topologyHumans.length !== value.snapshot.humanSeatIdsAtStart.length ||
    topologyHumans.some(
      (seatId, index) => seatId !== value.snapshot.humanSeatIdsAtStart[index],
    )
  ) {
    failRunRouter(
      ERROR.RUN_ROUTE_RECORD_INVALID,
      "storedRoute.controlTopology.seatControls",
      "HUMAN_SEATS_MISMATCH",
    );
  }
  if (
    value.handlerKey !== "pressure_chapter_v1" ||
    value.resultAdapterKey !== "SangtianPressureResultV1Adapter" ||
    value.presentationSchemaVersion !== "sangtian_pressure_result_v1" ||
    value.rendererKey !== "sangtian_pressure_endgame_v1" ||
    value.presentationSchemaVersion !== value.snapshot.route.resultSchemaVersion
  ) {
    failRunRouter(
      ERROR.RUN_ROUTE_RECORD_INVALID,
      "storedRoute.dispatch",
      "UNSUPPORTED_DISPATCH_COMBINATION",
    );
  }
  return value;
}

function normalizeCreateCommand(
  command: CreatePressureRunRouteCommandV1,
): CreatePressureRunRouteCommandV1 & {
  routeKey: string | null;
  humanSeatIdsAtStart: SeatIdV1[];
  pinnedRegistration: PressurePinnedRouteRegistrationV1 | null;
} {
  if (!command || typeof command !== "object") {
    failRunRouter(ERROR.RUN_ROUTE_RECORD_INVALID, "command", "OBJECT");
  }
  assertNonEmptyString(command.runId, "command.runId");
  assertNonEmptyString(command.runSeed, "command.runSeed");
  if (command.routeKey !== null && command.routeKey !== undefined) {
    assertNonEmptyString(command.routeKey, "command.routeKey");
  }
  if (
    command.participantMode !== "SOLO" &&
    command.participantMode !== "MULTIPLAYER"
  ) {
    failRunRouter(
      ERROR.PARTICIPANT_MODE_INVALID,
      "command.participantMode",
    );
  }
  const humans = normalizeHumanSeats(
    command.participantMode,
    command.humanSeatIdsAtStart,
  );
  const pinnedRegistration = command.pinnedRegistration
    ? validatePressurePinnedRouteRegistrationV1(command.pinnedRegistration)
    : null;
  return {
    ...command,
    routeKey: command.routeKey ?? null,
    humanSeatIdsAtStart: humans,
    pinnedRegistration,
  };
}

function normalizeHumanSeats(
  participantMode: ParticipantModeV1,
  input: readonly string[],
): SeatIdV1[] {
  if (!Array.isArray(input)) {
    failRunRouter(
      ERROR.HUMAN_SEAT_SELECTION_INVALID,
      "command.humanSeatIdsAtStart",
      "ARRAY",
    );
  }
  if (new Set(input).size !== input.length) {
    failRunRouter(
      ERROR.HUMAN_SEAT_SELECTION_INVALID,
      "command.humanSeatIdsAtStart",
      "UNIQUE",
    );
  }
  const unknown = input.find(
    (seatId) =>
      !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(seatId as SeatIdV1),
  );
  if (unknown) {
    failRunRouter(
      ERROR.HUMAN_SEAT_SELECTION_INVALID,
      "command.humanSeatIdsAtStart",
      `UNKNOWN_${unknown}`,
    );
  }
  const validCount =
    participantMode === "SOLO"
      ? input.length === 1
      : input.length >= 2 && input.length <= 6;
  if (!validCount) {
    failRunRouter(
      ERROR.HUMAN_SEAT_SELECTION_INVALID,
      "command.humanSeatIdsAtStart",
      participantMode === "SOLO" ? "EXACTLY_ONE" : "BETWEEN_TWO_AND_SIX",
    );
  }
  const selected = new Set(input);
  return PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatId) =>
    selected.has(seatId),
  );
}

function buildControlTopology(
  participantMode: ParticipantModeV1,
  humanSeatIdsAtStart: readonly SeatIdV1[],
  controlTopologyVersion: string,
): InitialRoleControlTopologyV1 {
  const humanSet = new Set(humanSeatIdsAtStart);
  const base = {
    schemaVersion: CONTROL_TOPOLOGY_SCHEMA,
    controlTopologyVersion,
    participantMode,
    seatControls: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      mode: humanSet.has(seatId)
        ? ("HUMAN_ACTIVE" as const)
        : ("AI_ACTIVE" as const),
    })),
  };
  return { ...base, topologyHash: sha256Canonical(base) };
}

export function assertInitialRoleControlTopology(
  topology: InitialRoleControlTopologyV1,
  expectedParticipantMode?: ParticipantModeV1,
): InitialRoleControlTopologyV1 {
  if (
    !topology ||
    typeof topology !== "object" ||
    topology.schemaVersion !== CONTROL_TOPOLOGY_SCHEMA ||
    (topology.participantMode !== "SOLO" &&
      topology.participantMode !== "MULTIPLAYER") ||
    (expectedParticipantMode !== undefined &&
      topology.participantMode !== expectedParticipantMode) ||
    !Array.isArray(topology.seatControls) ||
    topology.seatControls.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length
  ) {
    failRunRouter(
      ERROR.RUN_ROUTE_RECORD_INVALID,
      "storedRoute.controlTopology",
      "SHAPE",
    );
  }
  assertExactKeys(
    topology,
    CONTROL_TOPOLOGY_KEYS,
    "storedRoute.controlTopology",
  );
  assertNonEmptyString(
    topology.controlTopologyVersion,
    "storedRoute.controlTopology.controlTopologyVersion",
  );
  topology.seatControls.forEach((control, index) => {
    assertExactKeys(
      control,
      SEAT_CONTROL_KEYS,
      `storedRoute.controlTopology.seatControls[${index}]`,
    );
    if (
      control.seatId !== PRESSURE_CHAPTER_SEAT_IDS_V1[index] ||
      (control.mode !== "HUMAN_ACTIVE" && control.mode !== "AI_ACTIVE")
    ) {
      failRunRouter(
        ERROR.RUN_ROUTE_RECORD_INVALID,
        `storedRoute.controlTopology.seatControls[${index}]`,
      );
    }
  });
  const humanCount = topology.seatControls.filter(
    (control) => control.mode === "HUMAN_ACTIVE",
  ).length;
  if (
    (topology.participantMode === "SOLO" && humanCount !== 1) ||
    (topology.participantMode === "MULTIPLAYER" &&
      (humanCount < 2 || humanCount > 6))
  ) {
    failRunRouter(
      ERROR.RUN_ROUTE_RECORD_INVALID,
      "storedRoute.controlTopology.seatControls",
      topology.participantMode === "SOLO"
        ? "EXACTLY_ONE_HUMAN"
        : "BETWEEN_TWO_AND_SIX_HUMANS",
    );
  }
  if (!isSha256(topology.topologyHash)) {
    failRunRouter(
      ERROR.RUN_ROUTE_RECORD_INVALID,
      "storedRoute.controlTopology.topologyHash",
      "SHA256_LOWER_HEX",
    );
  }
  const expected = hashWithoutField(
    topology as unknown as Record<string, unknown>,
    "topologyHash",
  );
  if (topology.topologyHash !== expected) {
    failRunRouter(
      ERROR.RUN_ROUTE_RECORD_HASH_MISMATCH,
      "storedRoute.controlTopology.topologyHash",
      `EXPECTED_${expected}`,
    );
  }
  return topology;
}

function expectedRegistration(
  registration: PressureChapterRouteRegistrationV1,
): ExpectedPressureRunRouteRegistrationV1 {
  return {
    route: { ...registration.route },
    contentPackageVersion: registration.contentPackageVersion,
    contentPackageSha256: registration.contentPackageSha256,
    orchestrationPackageVersion: registration.orchestrationPackageVersion,
    orchestrationPackageSha256: registration.orchestrationPackageSha256,
    runtimeContractVersion: registration.runtimeContractVersion,
    runtimeContractSha256: registration.runtimeContractSha256,
    testMatrixVersion: registration.testMatrixVersion,
    testMatrixSha256: registration.testMatrixSha256,
    narrativeProfileVersion: registration.narrativeProfileVersion,
    featureSetVersion: registration.featureSetVersion,
    resultContractRegistryVersion:
      registration.resultContractRegistryVersion,
    controlTopologyVersion: registration.controlTopologyVersion,
  };
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    failRunRouter(ERROR.RUN_ROUTE_RECORD_INVALID, path, "NON_EMPTY_STRING");
  }
}

function assertExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failRunRouter(ERROR.RUN_ROUTE_RECORD_INVALID, path, "OBJECT");
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    failRunRouter(
      ERROR.RUN_ROUTE_RECORD_INVALID,
      path,
      `EXACT_KEYS_${expected.join(",")}`,
    );
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
