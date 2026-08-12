import type { ParticipantModeV1, SeatIdV1 } from "@ai-story/shared";
import type { InitialRoleControlTopologyV1 } from "../run-router";

export type SeatControlModeV1 = "HUMAN_ACTIVE" | "AI_ACTIVE";
export type SeatControllerKindV1 = "HUMAN" | "AI";
export type SeatPresenceStatusV1 = "ONLINE" | "DISCONNECTED";

export interface SeatControlGenesisAuthorityV1 {
  schemaVersion: "pressure_seat_control_genesis_authority_v1";
  runId: string;
  routeHash: string;
  genesisHash: string;
  genesisAtomicRecordHash: string;
  controlTopology: InitialRoleControlTopologyV1;
}

export interface FrozenSeatControlPolicyV1 {
  schemaVersion: "pressure_frozen_seat_control_policy_v1";
  policyVersion: string;
  disconnectPolicy: "PRESENCE_ADVISORY_ONLY";
  takeoverDeadlinePolicyRef: string;
  takeoverDeadlinePolicyHash: string;
  deterministicDefaultPolicyRef: string;
  deterministicDefaultPolicyHash: string;
  humanReclaimAllowed: boolean;
  policyHash: string;
}

export interface HumanSeatAssignmentV1 {
  seatId: SeatIdV1;
  humanControllerId: string;
}

export interface SeatAuthorityRecordV1 {
  seatId: SeatIdV1;
  mode: SeatControlModeV1;
  originalHumanControllerId: string | null;
  designatedAiControllerId: string;
  activeControllerId: string;
  controlEpoch: number;
  submissionFenceToken: string;
  reclaimFenceToken: string | null;
  lastAuthorityEventHash: string;
}

export interface SeatControlSnapshotV1 {
  schemaVersion: "pressure_seat_control_snapshot_v1";
  runId: string;
  participantMode: ParticipantModeV1;
  routeHash: string;
  genesisHash: string;
  genesisAtomicRecordHash: string;
  initialTopologyHash: string;
  controlTopologyVersion: string;
  frozenPolicy: FrozenSeatControlPolicyV1;
  stateRevision: number;
  timelineLength: number;
  timelineHeadHash: string;
  seatControls: SeatAuthorityRecordV1[];
  initializationInputHash: string;
  stateHash: string;
}

export type SeatControlEventTypeV1 =
  | "CONTROL_INITIALIZED"
  | "EXPLICIT_HANDOFF_TO_AI"
  | "FROZEN_DEADLINE_TAKEOVER"
  | "HUMAN_RECLAIMED";

export interface SeatControlEventV1 {
  schemaVersion: "pressure_seat_control_event_v1";
  runId: string;
  eventSequence: number;
  eventType: SeatControlEventTypeV1;
  seatId: SeatIdV1;
  fromMode: SeatControlModeV1 | null;
  toMode: SeatControlModeV1;
  fromControllerId: string | null;
  toControllerId: string;
  fromControlEpoch: number;
  toControlEpoch: number;
  frozenPolicyHash: string;
  authorizationProofHash: string | null;
  previousEventHash: string;
  eventHash: string;
}

export type SeatControlOperationV1 =
  | "INITIALIZE"
  | "EXPLICIT_HANDOFF"
  | "DEADLINE_TAKEOVER"
  | "HUMAN_RECLAIM";

export interface SeatControlCommandReceiptV1 {
  schemaVersion: "pressure_seat_control_command_receipt_v1";
  operation: SeatControlOperationV1;
  runId: string;
  seatId: SeatIdV1 | null;
  idempotencyKey: string;
  requestFingerprint: string;
  resultingStateRevision: number;
  resultingStateHash: string;
  authorityEventHashes: string[];
  receiptHash: string;
}

export interface CommittedSeatControlCommandV1 {
  snapshot: SeatControlSnapshotV1;
  events: SeatControlEventV1[];
  receipt: SeatControlCommandReceiptV1;
}

export interface InitializeSeatControlCommandV1 {
  runId: string;
  idempotencyKey: string;
  humanAssignments: readonly HumanSeatAssignmentV1[];
}

export interface ExplicitHandoffToAiCommandV1 {
  runId: string;
  seatId: SeatIdV1;
  humanControllerId: string;
  expectedControlEpoch: number;
  expectedSubmissionFenceToken: string;
  idempotencyKey: string;
}

export interface FrozenDeadlineTakeoverProofV1 {
  schemaVersion: "pressure_frozen_deadline_takeover_proof_v1";
  runId: string;
  decisionPointId: string;
  seatId: SeatIdV1;
  expectedControlEpoch: number;
  deadlinePolicyRef: string;
  deadlinePolicyHash: string;
  closedWorkingInputHash: string;
  proofHash: string;
}

export interface FrozenDeadlineTakeoverCommandV1 {
  runId: string;
  seatId: SeatIdV1;
  expectedControlEpoch: number;
  expectedStateHash: string;
  proof: FrozenDeadlineTakeoverProofV1;
  idempotencyKey: string;
}

export interface ReclaimSeatControlCommandV1 {
  runId: string;
  seatId: SeatIdV1;
  humanControllerId: string;
  expectedControlEpoch: number;
  expectedReclaimFenceToken: string;
  idempotencyKey: string;
}

export interface SeatControlCommandResultV1 {
  status: "COMMITTED" | "REPLAYED";
  committed: CommittedSeatControlCommandV1;
}

export interface SeatControlTransitionCommitV1 {
  expectedStateRevision: number;
  expectedStateHash: string;
  expectedSeatId: SeatIdV1;
  expectedControlEpoch: number;
  candidate: CommittedSeatControlCommandV1;
}

export type SeatControlInitializePortResultV1 =
  | {
      status: "COMMITTED" | "REPLAYED";
      committed: CommittedSeatControlCommandV1;
    }
  | {
      status: "ALREADY_INITIALIZED";
      current: SeatControlSnapshotV1;
    };

export type SeatControlTransitionPortResultV1 =
  | {
      status: "COMMITTED" | "REPLAYED";
      committed: CommittedSeatControlCommandV1;
    }
  | {
      status: "CONFLICT";
      current: SeatControlSnapshotV1 | null;
    };

/** Persistence must make snapshot, event(s), and receipt one atomic write. */
export interface SeatControlAuthorityPort {
  readSnapshot(runId: string): Promise<SeatControlSnapshotV1 | null>;
  readCommittedCommand(
    runId: string,
    idempotencyKey: string,
  ): Promise<CommittedSeatControlCommandV1 | null>;
  initializeOnce(
    candidate: CommittedSeatControlCommandV1,
  ): Promise<SeatControlInitializePortResultV1>;
  commitTransition(
    command: SeatControlTransitionCommitV1,
  ): Promise<SeatControlTransitionPortResultV1>;
}

/** Adapter reads the already committed sequence=0 Genesis; never live flags. */
export interface SeatControlGenesisAuthorityReaderPort {
  readGenesisAuthority(
    runId: string,
  ): Promise<SeatControlGenesisAuthorityV1 | null>;
}

/** Adapter resolves the policy frozen for this Run, not the current registry. */
export interface FrozenSeatControlPolicyReaderPort {
  readFrozenPolicy(runId: string): Promise<FrozenSeatControlPolicyV1 | null>;
}

export interface RecordSeatPresenceCommandV1 {
  runId: string;
  seatId: SeatIdV1;
  humanControllerId: string;
  sessionId: string;
  signalSequence: number;
  status: SeatPresenceStatusV1;
  idempotencyKey: string;
}

export interface SeatPresenceRecordV1 {
  schemaVersion: "pressure_seat_presence_record_v1";
  runId: string;
  seatId: SeatIdV1;
  humanControllerId: string;
  sessionId: string;
  signalSequence: number;
  status: SeatPresenceStatusV1;
  idempotencyKey: string;
  requestFingerprint: string;
  recordHash: string;
}

export interface SeatPresencePort {
  record(
    record: SeatPresenceRecordV1,
  ): Promise<{
    status: "APPLIED" | "REPLAYED" | "STALE";
    record: SeatPresenceRecordV1;
  }>;
  readForSeat(
    runId: string,
    seatId: SeatIdV1,
    humanControllerId: string,
  ): Promise<SeatPresenceRecordV1 | null>;
}

export type DefaultTriggerV1 = "HUMAN_DEADLINE" | "AI_FAILURE";

export interface FrozenDefaultSourceProofV1 {
  schemaVersion: "pressure_frozen_default_source_proof_v1";
  runId: string;
  decisionPointId: string;
  seatId: SeatIdV1;
  expectedControlEpoch: number;
  trigger: DefaultTriggerV1;
  defaultPolicyRef: string;
  defaultPolicyHash: string;
  canonicalActionPayloadHash: string;
  causeInputHash: string;
  proofHash: string;
}

export interface ResolveSeatDefaultCommandV1 {
  runId: string;
  seatId: SeatIdV1;
  expectedControlEpoch: number;
  expectedStateHash: string;
  sourceProof: FrozenDefaultSourceProofV1;
  idempotencyKey: string;
}

export interface SeatDefaultDirectiveV1 {
  schemaVersion: "pressure_seat_default_directive_v1";
  runId: string;
  decisionPointId: string;
  seatId: SeatIdV1;
  controlEpoch: number;
  trigger: DefaultTriggerV1;
  defaultPolicyRef: string;
  defaultPolicyHash: string;
  canonicalActionPayloadHash: string;
  sourceProofHash: string;
  authorityStateHash: string;
  idempotencyKey: string;
  requestFingerprint: string;
  directiveHash: string;
}

export interface SeatDefaultDirectivePort {
  readCommitted(
    runId: string,
    idempotencyKey: string,
  ): Promise<SeatDefaultDirectiveV1 | null>;
  commitOnce(
    directive: SeatDefaultDirectiveV1,
  ): Promise<{
    status: "COMMITTED" | "REPLAYED";
    directive: SeatDefaultDirectiveV1;
  }>;
}

/**
 * Verifies that proof hashes resolve to the closed DecisionPoint/failure facts
 * stored under the Run's frozen policy. A transport-supplied hash alone is not
 * authority, and Provider/OpenNovel must never implement this port.
 */
export interface SeatControlDecisionAuthorityPort {
  verifyFrozenDeadlineTakeover(input: {
    proof: FrozenDeadlineTakeoverProofV1;
    authorityStateHash: string;
    frozenPolicyHash: string;
  }): Promise<boolean>;
  verifyFrozenDefaultSource(input: {
    proof: FrozenDefaultSourceProofV1;
    authorityStateHash: string;
    frozenPolicyHash: string;
  }): Promise<boolean>;
}

export interface SeatSubmissionAuthorityV1 {
  schemaVersion: "pressure_seat_submission_authority_v1";
  runId: string;
  seatId: SeatIdV1;
  controllerKind: SeatControllerKindV1;
  controlEpoch: number;
  submissionFenceToken: string;
  authorityStateHash: string;
}

export type SeatProjectionViewerV1 =
  | {
      kind: "HUMAN";
      humanControllerId: string;
    }
  | {
      kind: "ACTIVE_SEAT_CONTROLLER";
      seatId: SeatIdV1;
      controllerId: string;
      controlEpoch: number;
      submissionFenceToken: string;
    };

export interface SeatPrivateProjectionRecordV1 {
  schemaVersion: "pressure_seat_private_projection_record_v1";
  runId: string;
  seatId: SeatIdV1;
  sourceAuthorityHash: string;
  projectionVersion: string;
  payload: Record<string, unknown>;
  payloadHash: string;
}

/** Implementations must issue one seat-scoped query; no all-seat private read. */
export interface SeatPrivateProjectionPort {
  readForSeat(input: {
    runId: string;
    seatId: SeatIdV1;
    sourceAuthorityHash: string;
  }): Promise<SeatPrivateProjectionRecordV1>;
}

export interface PublicSeatControlProjectionV1 {
  seatId: SeatIdV1;
  controllerKind: SeatControllerKindV1;
  controlEpoch: number;
}

export interface OwnSeatControlProjectionV1 {
  seatId: SeatIdV1;
  controllerKind: SeatControllerKindV1;
  controlEpoch: number;
  canSubmit: boolean;
  canReclaim: boolean;
  submissionFenceToken: string | null;
  reclaimFenceToken: string | null;
  presence: SeatPresenceStatusV1 | null;
  privateProjectionVersion: string;
  privatePayload: Record<string, unknown>;
  privatePayloadHash: string;
}

export interface SeatPrivateViewV1 {
  schemaVersion: "pressure_seat_private_view_v1";
  runId: string;
  participantMode: ParticipantModeV1;
  publicSeats: PublicSeatControlProjectionV1[];
  ownSeat: OwnSeatControlProjectionV1;
  sourceAuthorityHash: string;
  viewHash: string;
}
