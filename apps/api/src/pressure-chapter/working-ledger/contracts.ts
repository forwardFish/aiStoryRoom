import type {
  BeatResolutionV1,
  ChapterIdV1,
  DecisionActionV1,
  SeatIdV1,
} from "@ai-story/shared";
import type {
  BeatResult,
  ChapterWorkingState,
  DecisionPin,
} from "@ai-story/templates";

export interface WorkingLedgerKeyV1 {
  runId: string;
  chapterRuntimeId: string;
}

export type WorkingVisibilityV1 = "PUBLIC" | "PARTICIPANTS" | "PRIVATE";

export interface WorkingActionIntentV1 {
  visibility: WorkingVisibilityV1;
  targetSeatIds: SeatIdV1[];
  evidenceRefs: string[];
  resourceReservations: Array<{
    reservationKey: string;
    resourceId: string;
    amount: number;
  }>;
  commitmentMutations: Array<{
    commitmentId: string;
    operation: "CREATE" | "FULFILL" | "BREAK" | "CANCEL";
    seatIds: SeatIdV1[];
  }>;
  knowledgeGrants: Array<{
    seatId: SeatIdV1;
    factRefs: string[];
  }>;
  seatArcProgress: Array<{
    seatId: SeatIdV1;
    progressDelta: number;
  }>;
}

export interface WorkingLedgerOpenedPayloadV1 {
  eventType: "WORKING_LEDGER_OPENED";
  routeHash: string;
  chapterDefinitionHash: string;
  initialState: ChapterWorkingState;
  initialStateHash: string;
  nextDecisionPin: DecisionPin | null;
}

export interface FormalActionAcceptedPayloadV1 {
  eventType: "FORMAL_ACTION_ACCEPTED";
  /** Present only for independently progressing Multiplayer human seats. */
  decisionAuthorityMode?: "MULTIPLAYER_SEAT";
  routeHash: string;
  inputFingerprint: string;
  action: DecisionActionV1;
  intent: WorkingActionIntentV1;
  audienceSeatIds: SeatIdV1[];
}

export interface BeatAppliedPayloadV1 {
  eventType: "BEAT_APPLIED";
  routeHash: string;
  commandFingerprint: string;
  actionInputFingerprint: string;
  beatResolution: BeatResolutionV1;
  authoredBeatResult: BeatResult;
  stateAfter: ChapterWorkingState;
  stateAfterHash: string;
  nextDecisionPin: DecisionPin | null;
}

/**
 * A server-sealed preset commitment applied directly to the same Working
 * Ledger. It does not resolve, close, or advance the active Decision Beat.
 */
export interface FormalCommitmentAppliedPayloadV1 {
  eventType: "FORMAL_COMMITMENT_APPLIED";
  routeHash: string;
  inputFingerprint: string;
  action: DecisionActionV1;
  mutation: {
    commitmentId: string;
    operation: "CREATE" | "FULFILL" | "BREAK" | "CANCEL";
    seatIds: SeatIdV1[];
    sourceActionId: string;
  };
  audienceSeatIds: SeatIdV1[];
}

export type WorkingLedgerEventPayloadV1 =
  | WorkingLedgerOpenedPayloadV1
  | FormalActionAcceptedPayloadV1
  | BeatAppliedPayloadV1
  | FormalCommitmentAppliedPayloadV1;

export interface WorkingLedgerEventV1 {
  schemaVersion: "pressure_working_ledger_event_v1";
  runId: string;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  sequence: number;
  previousEventHash: string | null;
  payload: WorkingLedgerEventPayloadV1;
  eventHash: string;
}

export interface WorkingLedgerAppendResultV1 {
  status: "APPENDED" | "HEAD_MISMATCH";
  events: WorkingLedgerEventV1[];
}

/** Persistence boundary. Implementations may use a DB, but the domain never imports it. */
export interface WorkingLedgerPort {
  read(key: WorkingLedgerKeyV1): Promise<WorkingLedgerEventV1[]>;
  append(input: {
    key: WorkingLedgerKeyV1;
    expectedHeadHash: string | null;
    events: WorkingLedgerEventV1[];
  }): Promise<WorkingLedgerAppendResultV1>;
}

export interface AcceptedFormalActionV1 {
  action: DecisionActionV1;
  routeHash: string;
  inputFingerprint: string;
  intent: WorkingActionIntentV1;
  audienceSeatIds: SeatIdV1[];
  eventHash: string;
}

export interface AppliedBeatV1 {
  actionIds: string[];
  commandFingerprint: string;
  actionInputFingerprint: string;
  resolution: BeatResolutionV1;
  eventHash: string;
}

export interface WorkingLedgerProjectionV1 {
  key: WorkingLedgerKeyV1;
  chapterId: ChapterIdV1;
  routeHash: string;
  chapterDefinitionHash: string;
  headHash: string;
  headSequence: number;
  state: ChapterWorkingState;
  stateHash: string;
  nextDecisionPin: DecisionPin | null;
  acceptedActions: Map<string, AcceptedFormalActionV1>;
  actionsByIdempotencyKey: Map<string, AcceptedFormalActionV1>;
  commitmentActionsByIdempotencyKey?: Map<string, {
    action: DecisionActionV1;
    inputFingerprint: string;
    eventHash: string;
    mutation: FormalCommitmentAppliedPayloadV1["mutation"];
  }>;
  appliedBeats: Map<string, AppliedBeatV1>;
  pendingReservations: Map<string, {
    reservationKey: string;
    resourceId: string;
    amount: number;
    seatId: SeatIdV1;
    sourceActionId: string;
    status: "PENDING" | "RESERVED";
  }>;
  commitments: Map<string, {
    commitmentId: string;
    operation: "CREATE" | "FULFILL" | "BREAK" | "CANCEL";
    seatIds: SeatIdV1[];
    sourceActionId: string;
  }>;
  evidenceRefsByAction: Map<string, string[]>;
  knowledgeBySeat: Map<SeatIdV1, string[]>;
  seatArcProgressBySeat: Map<SeatIdV1, number>;
}
