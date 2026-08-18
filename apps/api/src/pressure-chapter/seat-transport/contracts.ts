import type { SeatIdV1 } from "@ai-story/shared";
import type {
  AEmotionFeedPagePortV1,
  PressureGameNarrativeProjectionV1,
} from "../game-projection/contracts";
import type { AEmotionFeedServiceV1 } from "../a-emotion/feed.service";
import type {
  ExplicitHandoffToAiCommandV1,
  ReclaimSeatControlCommandV1,
  RecordSeatPresenceCommandV1,
  SeatControlCommandResultV1,
  SeatPrivateViewV1,
  SeatProjectionViewerV1,
} from "../seat-control/types";
import type { PressureSeatViewerMembershipV1 } from "../seat-control-persistence/membership.prisma-adapter";
import type { StoredRunRouteReaderPort } from "../run-router";

export const PRESSURE_SEAT_TRANSPORT_SNAPSHOT_SCHEMA_V1 =
  "pressure_seat_transport_snapshot_v1" as const;

export interface PressureSeatTransportMembershipPortV1 {
  readSubjectMembership(input: {
    runId: string;
    subjectId: string;
  }): Promise<PressureSeatViewerMembershipV1 | null>;
}

export type PressureSeatTransportRoutePortV1 = Pick<
  StoredRunRouteReaderPort,
  "readStoredRoute"
>;

export interface PressureSeatTransportViewPortV1 {
  project(
    runId: string,
    viewer: SeatProjectionViewerV1,
  ): Promise<SeatPrivateViewV1>;
}

/** Narrowing forbids transport code from invoking deadline/default/Provider work. */
export interface PressureSeatTransportControlPortV1 {
  recordPresence(
    command: RecordSeatPresenceCommandV1,
  ): Promise<{
    status: "APPLIED" | "REPLAYED" | "STALE";
    record: { recordHash: string };
  }>;
  explicitHandoffToAi(
    command: ExplicitHandoffToAiCommandV1,
  ): Promise<SeatControlCommandResultV1>;
  reclaimByHuman(
    command: ReclaimSeatControlCommandV1,
  ): Promise<SeatControlCommandResultV1>;
}

export type PressureSeatTransportFeedPortV1 = Pick<
  AEmotionFeedServiceV1,
  "listAfterSequence"
>;

export interface PressureNarrativePublishedEventV1 {
  schemaVersion: "pressure_narrative_published_event_v1";
  runId: string;
  routeHash: string;
  viewerSeatId: SeatIdV1;
  chapterRuntimeId: string;
  decisionPointId: string;
  workingRevision: number;
  sourceId: string;
  projectionKind: PressureGameNarrativeProjectionV1["projectionKind"];
  status: "PUBLISHED" | "FALLBACK_PUBLISHED";
  deliverySequence: number;
  identityHash: string;
  narrative: PressureGameNarrativeProjectionV1;
  cursor?: string;
}

export interface PressureSeatTransportNarrativePortV1 {
  listAfterSequence(input: Readonly<{
    runId: string;
    viewerSeatId: SeatIdV1;
    afterSequence: number;
    limit: number;
  }>): Promise<Readonly<{
    events: PressureNarrativePublishedEventV1[];
    nextAfterSequence: number;
    currentServerSequence: number;
    hasMore: boolean;
  }>>;
}

export interface PressureSeatTransportSnapshotV1 {
  schemaVersion: typeof PRESSURE_SEAT_TRANSPORT_SNAPSHOT_SCHEMA_V1;
  runId: string;
  routeHash: string;
  viewerSeatId: SeatIdV1;
  seatView: SeatPrivateViewV1;
  feedPage: AEmotionFeedPagePortV1;
  narrativeEvents: PressureNarrativePublishedEventV1[];
  delivery: {
    afterSequence: number;
    nextAfterSequence: number;
    hasMore: boolean;
    currentServerSequence: number;
    narrativeAfterSequence: number;
    narrativeNextAfterSequence: number;
    narrativeCurrentServerSequence: number;
    narrativeHasMore: boolean;
  };
  cursor: string;
  snapshotHash: string;
}

export interface ReadPressureSeatTransportQueryV1 {
  runId: string;
  subjectId: string;
  /** Server-issued transport cursor; its nested feed cursor is never client-authored. */
  cursor?: string | null;
  feedLimit?: number;
}

export interface PressureSeatHeartbeatCommandV1 {
  runId: string;
  subjectId: string;
  sessionId: string;
  signalSequence: number;
  status: "ONLINE" | "DISCONNECTED";
  idempotencyKey: string;
}

export interface PressureSeatHandoffCommandV1 {
  runId: string;
  subjectId: string;
  expectedControlEpoch: number;
  expectedSubmissionFenceToken: string;
  idempotencyKey: string;
  /** Opaque server-issued read cursor; never interpreted as control authority. */
  cursor?: string | null;
}

export interface PressureSeatReclaimCommandV1 {
  runId: string;
  subjectId: string;
  expectedControlEpoch: number;
  expectedReclaimFenceToken: string;
  idempotencyKey: string;
  /** Opaque server-issued read cursor; never interpreted as control authority. */
  cursor?: string | null;
}

export interface PressureSeatHeartbeatResultV1 {
  schemaVersion: "pressure_seat_transport_heartbeat_result_v1";
  runId: string;
  viewerSeatId: SeatIdV1;
  status: "APPLIED" | "REPLAYED" | "STALE";
  recordHash: string;
}

export interface PressureSeatAuthorityMutationResultV1 {
  schemaVersion: "pressure_seat_transport_authority_result_v1";
  operation: "HANDOFF" | "RECLAIM";
  status: SeatControlCommandResultV1["status"];
  snapshot: PressureSeatTransportSnapshotV1;
}

export interface PressureSeatTransportSseEventV1 {
  id: string | null;
  event: "snapshot" | "heartbeat" | "narrative";
  data:
    | PressureSeatTransportSnapshotV1
    | PressureNarrativePublishedEventV1
    | {
        schemaVersion: "pressure_seat_transport_sse_heartbeat_v1";
        runId: string;
        cursor: string | null;
      };
}
