import type {
  ParticipantModeV1,
  RunRouteSnapshotV1,
  SeatIdV1,
} from "@ai-story/shared";
import type {
  PressureChapterParticipantModeV1,
  PressureChapterRegistryRouteV1,
  PressureChapterRouteRegistrationV1,
} from "@ai-story/templates";

export type InitialSeatControlModeV1 = "HUMAN_ACTIVE" | "AI_ACTIVE";

export interface InitialSeatControlV1 {
  seatId: SeatIdV1;
  mode: InitialSeatControlModeV1;
}

export interface InitialRoleControlTopologyV1 {
  schemaVersion: "pressure_initial_role_control_topology_v1";
  controlTopologyVersion: string;
  participantMode: ParticipantModeV1;
  seatControls: InitialSeatControlV1[];
  topologyHash: string;
}

export interface StoredRunRouteRecordV1 {
  schemaVersion: "pressure_stored_run_route_v1";
  runId: string;
  routeKey: string;
  registryVersion: string;
  registryHash: string;
  handlerKey: "pressure_chapter_v1";
  resultAdapterKey: "SangtianPressureResultV1Adapter";
  presentationSchemaVersion: "sangtian_pressure_result_v1";
  rendererKey: "sangtian_pressure_endgame_v1";
  createRequestFingerprint: string;
  snapshot: RunRouteSnapshotV1;
  controlTopology: InitialRoleControlTopologyV1;
  recordHash: string;
}

/**
 * Immutable registration identity selected before a replay target is started.
 * It is not a RunRouteSnapshot hash: the new runSeed and final human-seat set
 * are intentionally added only when the target crosses its start boundary.
 */
export interface PressurePinnedRouteRegistrationV1 {
  schemaVersion: "pressure_pinned_route_registration_v1";
  registryVersion: string;
  registryHash: string;
  registration: PressureChapterRouteRegistrationV1;
  registrationHash: string;
  pinHash: string;
}

export interface CreatePressureRunRouteCommandV1 {
  runId: string;
  routeKey?: string | null;
  participantMode: ParticipantModeV1;
  humanSeatIdsAtStart: readonly string[];
  runSeed: string;
  /** Present only when a server-issued replay intent selected the target. */
  pinnedRegistration?: PressurePinnedRouteRegistrationV1 | null;
}

export interface CreatePressureRunRouteResultV1 {
  status: "CREATED" | "EXISTING";
  route: StoredRunRouteRecordV1;
}

export type StoredRouteOperationV1 =
  | "GAME"
  | "ACTION"
  | "RESULT"
  | "REPLAY";

export interface StoredRunRouteDispatchV1 {
  schemaVersion: "pressure_stored_route_dispatch_v1";
  operation: StoredRouteOperationV1;
  runId: string;
  routeKey: string;
  routeHash: string;
  route: PressureChapterRegistryRouteV1;
  handlerKey: "pressure_chapter_v1";
  resultAdapterKey: "SangtianPressureResultV1Adapter";
  presentationSchemaVersion: "sangtian_pressure_result_v1";
  rendererKey: "sangtian_pressure_endgame_v1";
}

export interface RunRouteRepositoryPort {
  findByRunId(runId: string): Promise<StoredRunRouteRecordV1 | null>;
  insertIfAbsent(
    record: StoredRunRouteRecordV1,
  ): Promise<{
    status: "INSERTED" | "EXISTING";
    record: StoredRunRouteRecordV1;
  }>;
}

/** The concrete templates PressureChapterRouteRegistry satisfies this port. */
export interface PressureChapterRouteRegistryPort {
  readonly registryVersion: string;
  readonly registryHash: string;
  readonly defaultRouteKey: string;
  resolveCreate(
    routeKey: string | null | undefined,
    participantMode: PressureChapterParticipantModeV1,
  ): PressureChapterRouteRegistrationV1;
  resolveStored(
    routeKey: string,
    route: PressureChapterRegistryRouteV1,
  ): PressureChapterRouteRegistrationV1;
}

export interface StoredRunRouteReaderPort {
  readStoredRoute(runId: string): Promise<StoredRunRouteRecordV1>;
}
