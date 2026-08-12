import type {
  ChapterIdV1,
  DecisionActionV1,
  RunRouteSnapshotV1,
  SeatIdV1,
} from "@ai-story/shared";
import type {
  FormalCommitmentAppliedPayloadV1,
  WorkingLedgerEventV1,
} from "../working-ledger/contracts";

export const PRESSURE_SIMPLE_PROMISE_CODES_V1 = Object.freeze([
  "DELIVER_ORIGINAL_LEDGER",
  "DO_NOT_PUBLICLY_BLAME",
  "TESTIFY_FOR_TARGET",
] as const);

export type PressureSimplePromiseCodeV1 =
  (typeof PRESSURE_SIMPLE_PROMISE_CODES_V1)[number];

export type PressureSimplePromiseVisibilityV1 = "PRIVATE" | "PUBLIC";

export interface CreatePressureSimplePromiseBodyV1 {
  targetRoleId: SeatIdV1;
  promiseCode: PressureSimplePromiseCodeV1;
  visibility: PressureSimplePromiseVisibilityV1;
  clientRequestId: string;
}

export interface CreatePressureSimplePromiseCommandV1 {
  roomId: string;
  subjectId: string;
  body: CreatePressureSimplePromiseBodyV1;
}

/**
 * Server-owned snapshot. No role, decision, fence, revision or prior-promise
 * assertion is accepted from HTTP JSON.
 */
export interface PressureSimplePromiseAccessV1 {
  routeSnapshot: RunRouteSnapshotV1;
  runId: string;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  decisionPointId: string;
  issuerSeatId: SeatIdV1;
  controlEpoch: number;
  expectedWorkingRevision: number;
  nextActionOrdinal: number;
  /** Frozen server-side preset list available from the formal TALK entry. */
  allowedPromiseCodes: PressureSimplePromiseCodeV1[];
  interactableSeatIds: SeatIdV1[];
  existingIssuerPromiseIds: string[];
  /** Previously committed formal actions, used only to replay the exact seal. */
  priorCommitmentActionsByIdempotencyKey?: Map<string, DecisionActionV1>;
  currentPromiseOperation?: "CREATE" | "FULFILL" | "BREAK" | "CANCEL";
  allowedPromiseOperationCodes?: PressurePromiseOperationCodeV1[];
}

export interface PressureSimplePromiseAccessPortV1 {
  load(input: { roomId: string; subjectId: string }): Promise<PressureSimplePromiseAccessV1>;
}

export interface PressureSimplePromiseFormalCommitPortV1 {
  submit(command: {
    routeSnapshot: RunRouteSnapshotV1;
    subjectId: string;
    action: DecisionActionV1;
    mutation: FormalCommitmentAppliedPayloadV1["mutation"];
    audienceSeatIds: SeatIdV1[];
    inputFingerprint: string;
  }): Promise<{
    status: "ACCEPTED" | "REPLAYED";
    event: WorkingLedgerEventV1;
  }>;
}

export interface CreatedPressureSimplePromiseV1 {
  schemaVersion: "pressure_simple_promise_created_v1";
  promiseId: string;
  sourceRoleId: SeatIdV1;
  targetRoleId: SeatIdV1;
  promiseCode: PressureSimplePromiseCodeV1;
  relatedObjectId: "original-grain-ledger";
  visibility: PressureSimplePromiseVisibilityV1;
  createdByActionId: string;
  status: "ACTIVE";
  submitStatus: "ACCEPTED" | "REPLAYED";
}

export const PRESSURE_PROMISE_OPERATION_CODES_V1 = Object.freeze([
  "PROMISE_DELIVER_ORIGINAL_FULFILL",
  "PROMISE_DELIVER_COPY_BREAK",
  "PROMISE_HIDE_OR_DELAY_BREAK",
] as const);

export type PressurePromiseOperationCodeV1 =
  (typeof PRESSURE_PROMISE_OPERATION_CODES_V1)[number];

export interface ApplyPressurePromiseOperationCommandV1 {
  roomId: string;
  subjectId: string;
  promiseId: string;
  operationCode: PressurePromiseOperationCodeV1;
  clientRequestId: string;
}

export interface AppliedPressurePromiseOperationV1 {
  schemaVersion: "pressure_simple_promise_operation_applied_v1";
  promiseId: string;
  operationCode: PressurePromiseOperationCodeV1;
  status: "FULFILLED" | "BROKEN";
  sourceActionId: string;
  submitStatus: "ACCEPTED" | "REPLAYED";
}
