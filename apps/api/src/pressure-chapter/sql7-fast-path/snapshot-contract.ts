import type {
  ChapterIdV1,
  DecisionActionV1,
  RunRouteSnapshotV1,
  SeatIdV1,
  WorldStateV1,
} from "@ai-story/shared";
import type { ChapterOrchestratorStateV1 } from "../orchestrator/contracts";
import type { StoredRunRouteRecordV1 } from "../run-router";
import type {
  SeatAuthorityRecordV1,
  SeatControlSnapshotV1,
  SeatPresenceRecordV1,
  SeatPrivateProjectionRecordV1,
} from "../seat-control/types";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";

export interface DecisionToNextProjectionSnapshotRequestV1 {
  roomId: string;
  runId: string;
  subjectId: string;
  seatId: SeatIdV1;
  chapterRuntimeId: string;
  decisionPointId: string;
  expectedRouteHash: string;
  expectedWorkingRevision: number;
  expectedControlEpoch: number;
  expectedSubmissionFenceToken: string;
  idempotencyKey: string;
}

export interface DecisionToNextProjectionRuntimeAuthorityV1 {
  id: string;
  runId: string;
  chapterId: ChapterIdV1;
  chapterSequence: number;
  state: "DECISION_POINT_OPEN" | "ACTION_DRAFTING";
  baseWorldSequence: number;
  baseWorldStateHash: string;
  previousFrozenHash: string;
  routeHash: string;
  contentPackageVersion: string;
  contentHash: string;
  orchestrationPackageVersion: string;
  orchestrationHash: string;
  runtimeContractVersion: string;
  runtimeContractHash: string;
  workingRevision: number;
  workingStateHash: string;
  workingState: unknown;
  decisionState: unknown;
  ledgerProjectionCache: unknown;
  closeInputHash: string | null;
  lockVersion: number;
}

export interface DecisionToNextProjectionWorldAuthorityV1 {
  runId: string;
  version: number;
  currentNodeId: string | null;
  worldSequence: number;
  reservedWorldSequence: number;
  state: WorldStateV1;
}

export interface DecisionToNextProjectionViewerAuthorityV1 {
  playerId: string;
  runId: string;
  subjectId: string;
  playerType: "human";
  status: "active";
  roleId: string;
  roleKey: SeatIdV1;
  roleName: string;
}

export interface DecisionToNextProjectionPersistenceFenceV1 {
  orchestratorEventId: string;
  orchestratorDedupeKey: string;
  orchestratorPayload: unknown;
  seatStateRevision: number;
  seatVersion: number;
  seatStateHash: string;
  seatSnapshotJson: unknown;
}

/**
 * Durable rows already visible before the normal first-submit transaction.
 * The planner may project these rows but may not treat them as a second source
 * of gameplay rules.
 */
export interface DecisionToNextProjectionProjectionSeedV1 {
  narrativeProjectionRows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  aEmotionAggregateRows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  viewerDeliveryRows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  aEmotionDeliveryMarkRows: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

/**
 * One immutable authority envelope captured by one application SQL statement.
 * Domain decisions consume the decoded authorities below, never raw Prisma
 * delegates or private tables.
 */
export interface DecisionToNextProjectionSnapshotV1 {
  schemaVersion: "pressure_decision_to_next_projection_snapshot_v1";
  request: DecisionToNextProjectionSnapshotRequestV1;
  storedRoute: StoredRunRouteRecordV1;
  routeSnapshot: RunRouteSnapshotV1;
  world: DecisionToNextProjectionWorldAuthorityV1;
  chapter: ChapterOrchestratorStateV1;
  runtime: DecisionToNextProjectionRuntimeAuthorityV1;
  workingProjection: WorkingLedgerProjectionV1;
  seatAuthority: SeatControlSnapshotV1;
  submitSeat: SeatAuthorityRecordV1;
  viewer: DecisionToNextProjectionViewerAuthorityV1;
  viewerPrivateProjection: SeatPrivateProjectionRecordV1;
  viewerPresence: SeatPresenceRecordV1 | null;
  persistenceFence: DecisionToNextProjectionPersistenceFenceV1;
  existingDecisionActionRows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  projectionSeed: DecisionToNextProjectionProjectionSeedV1;
  capturedAtMs: number;
  snapshotHash: string;
}

/**
 * A durable action observed by the one-statement reader before a first-submit
 * plan is built. A completed settlement can be replayed without writing;
 * partial legacy state is handed back to the existing recovery path.
 */
export interface DecisionToNextProjectionPriorActionSnapshotV1 {
  schemaVersion: "pressure_decision_to_next_projection_prior_action_snapshot_v1";
  request: DecisionToNextProjectionSnapshotRequestV1;
  action: DecisionActionV1;
  settlementCompleted: boolean;
  capturedAtMs: number;
}

export type DecisionToNextProjectionSnapshotCaptureV1 =
  | DecisionToNextProjectionSnapshotV1
  | DecisionToNextProjectionPriorActionSnapshotV1;

export interface DecisionToNextProjectionSnapshotReaderPortV1 {
  capture(
    input: Readonly<DecisionToNextProjectionSnapshotRequestV1 & { capturedAtMs: number }>,
  ): Promise<DecisionToNextProjectionSnapshotCaptureV1 | null>;
}
