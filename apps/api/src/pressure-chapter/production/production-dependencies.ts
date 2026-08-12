import {
  PRESSURE_PRODUCTION_ERROR_CODES as ERROR,
  failPressureProduction,
} from "./errors";
import {
  PressureRunShellService,
  SangtianPressureCanonicalRoleCatalogAdapter,
  assertRunShellWriteCapability,
  type PressureCanonicalRoleCatalogPort,
  type PressureRunShellWriterPort,
} from "./run-shell";
import {
  PressureStartLifecycleCoordinator,
  type PressureGenesisInitializerPortV1,
  type PressureGenesisN1HandoffConsumerPortV1,
  type PressureRunRouteCreatorPortV1,
  type PressureSeatControlInitializerPortV1,
  type PressureStartBoundaryPortV1,
} from "./start-lifecycle";
import {
  PressureProductionBridgeService,
  assertLobbyWriteCapability,
  type PressureLobbyPersistencePortV1,
  type PressureProductionBridgeV1,
} from "./production-bridge";
import type { FinalizedLegacyRoleSeatRegistryV1 } from "./legacy-role-seat-registry";

/**
 * Binding checklist for the future Nest module. Missing bindings are fatal;
 * none may be substituted by an in-memory production fallback.
 */
export const PRESSURE_PRODUCTION_DEPENDENCY_CONTRACT_V1 = Object.freeze([
  {
    key: "roleCatalog",
    concreteAdapter: "SangtianPressureCanonicalRoleCatalogAdapter",
    requiredBackends: ["accepted pressure-chapter content package"],
  },
  {
    key: "runShellWriter",
    concreteAdapter: "PrismaPressureRunShellWriterAdapter",
    requiredBackends: [
      "StoryRun",
      "StoryRole",
      "StoryPlayer",
      "PressureRunLifecycle",
    ],
  },
  {
    key: "lobbyPersistence",
    concreteAdapter: "PrismaPressureLobbyPersistenceAdapter",
    requiredBackends: [
      "PressureRunLifecycle lobby/start metadata",
      "StoryRole canonical roleKey",
      "StoryPlayer lobby membership/control slots",
    ],
  },
  {
    key: "startBoundary",
    concreteAdapter: "PrismaPressureStartBoundaryAdapter",
    requiredBackends: ["StoryRun metadata", "StoryRole", "StoryPlayer"],
  },
  {
    key: "routeRouter",
    concreteAdapter: "PressureChapterRunRouterService",
    requiredBackends: [
      "PrismaRunRouteRepository",
      "PressureChapterRouteRegistry",
    ],
  },
  {
    key: "genesis",
    concreteAdapter: "PressureChapterGenesisService",
    requiredBackends: [
      "PrismaGenesisAtomicCommitRepository",
      "accepted P0 GenesisContentPort",
      "stored Pressure route reader",
    ],
  },
  {
    key: "seatControl",
    concreteAdapter: "SeatControlService",
    requiredBackends: [
      "durable SeatControlAuthorityPort",
      "committed Genesis authority reader",
      "frozen SeatControl policy reader",
      "durable presence/default/decision-authority adapters",
    ],
  },
  {
    key: "n1Handoff",
    concreteAdapter: "PrismaGenesisOpenN1HandoffConsumerAdapter",
    requiredBackends: [
      "unique Genesis OPEN_CHAPTER PressureOutboxTask claim/ack",
      "PrismaChapterOrchestratorStateRepository",
      "PressureChapterOrchestratorService",
      "accepted authored content/working-ledger/settlement adapters",
    ],
  },
  {
    key: "legacyRoleRegistry",
    concreteAdapter: "FinalizedLegacyRoleSeatRegistryV1",
    requiredBackends: [
      "accepted source-referenced mapping decision for every legacy alias",
    ],
    condition: "required only when a legacy room roleKey enters Pressure",
  },
] as const);

export interface PressureProductionCompositionInputV1 {
  roleCatalog?: PressureCanonicalRoleCatalogPort;
  runShellWriter: PressureRunShellWriterPort;
  lobbyPersistence: PressureLobbyPersistencePortV1;
  startBoundary: PressureStartBoundaryPortV1;
  routeRouter: PressureRunRouteCreatorPortV1;
  genesis: PressureGenesisInitializerPortV1;
  seatControl: PressureSeatControlInitializerPortV1;
  n1Handoff: PressureGenesisN1HandoffConsumerPortV1;
  legacyRoleRegistry?: FinalizedLegacyRoleSeatRegistryV1 | null;
}

export interface PressureProductionCoreV1 {
  runShell: PressureRunShellService;
  start: PressureStartLifecycleCoordinator;
  bridge: PressureProductionBridgeV1;
}

export function composePressureProductionCoreV1(
  input: PressureProductionCompositionInputV1,
): PressureProductionCoreV1 {
  requireMethod(input, "runShellWriter", "createOnce");
  requireMethod(input, "lobbyPersistence", "isPressureRun");
  requireMethod(input, "lobbyPersistence", "getLobbyStatus");
  requireMethod(input, "lobbyPersistence", "getStartStatus");
  requireMethod(input, "lobbyPersistence", "join");
  requireMethod(input, "lobbyPersistence", "claimCanonicalSeatReplacingAi");
  requireMethod(input, "lobbyPersistence", "setReady");
  requireMethod(input, "lobbyPersistence", "leaveAndRestoreAi");
  requireMethod(input, "startBoundary", "finalizeHumanSeatSet");
  requireMethod(input, "startBoundary", "markStarted");
  requireMethod(input, "startBoundary", "recordFailure");
  requireMethod(input, "routeRouter", "create");
  requireMethod(input, "genesis", "initialize");
  requireMethod(input, "seatControl", "initialize");
  requireMethod(input, "n1Handoff", "openFromGenesisHandoff");
  assertRunShellWriteCapability(input.runShellWriter.capability);
  assertLobbyWriteCapability(input.lobbyPersistence.capability);
  const roleCatalog =
    input.roleCatalog ?? new SangtianPressureCanonicalRoleCatalogAdapter();
  requireMethod({ roleCatalog }, "roleCatalog", "loadCanonicalRoles");

  const runShell = new PressureRunShellService(roleCatalog, input.runShellWriter);
  const start = new PressureStartLifecycleCoordinator(
      input.startBoundary,
      input.routeRouter,
      input.genesis,
      input.seatControl,
      input.n1Handoff,
    );
  return {
    runShell,
    start,
    bridge: new PressureProductionBridgeService(
      runShell,
      input.lobbyPersistence,
      start,
      input.legacyRoleRegistry ?? null,
    ),
  };
}

function requireMethod(
  input: object,
  dependency: string,
  method: string,
): void {
  const value = (input as Record<string, unknown>)[dependency];
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as Record<string, unknown>)[method] !== "function"
  ) {
    failPressureProduction(
      ERROR.PRODUCTION_DEPENDENCY_MISSING,
      `${dependency}.${method}`,
    );
  }
}
