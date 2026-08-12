import type {
  ChapterIdV1,
  DecisionActionV1,
  RunRouteSnapshotV1,
  SeatIdV1,
} from "@ai-story/shared";
import type {
  WorkingActionIntentV1,
  WorkingLedgerEventV1,
} from "../working-ledger/contracts";

export interface PressureInteractionAccessV1 {
  routeHash: string;
  runId: string;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  workingRevision: number;
  workingStateHash: string;
  activeDecisionPointId: string | null;
  controlledSeatIds: SeatIdV1[];
  controlEpochBySeat: Partial<Record<SeatIdV1, number>>;
  allowedActionTypes: string[];
  interactableSeatIds: SeatIdV1[];
  visibleEvidenceRefs: string[];
  resourceAvailability: Array<{ resourceId: string; availableAmount: number }>;
}

export interface PressureFormalActionAccessContextV1 {
  decisionPointId: string;
  seatId: SeatIdV1;
  controlEpoch: number;
  actionType: string;
  payloadHash: string;
  idempotencyKey: string;
}

export interface PressureSystemDefaultAccessContextV1 {
  reason: "DEADLINE" | "AI_FAILURE";
  defaultPolicyRef: string;
  defaultPolicyHash: string;
  canonicalActionPayloadHash: string;
}

export interface PressureInteractionAccessPort {
  load(input: {
    subjectId: string;
    runId: string;
    chapterRuntimeId: string;
    actionContext?: PressureFormalActionAccessContextV1;
    systemDefault?: PressureSystemDefaultAccessContextV1;
  }): Promise<PressureInteractionAccessV1>;
}

export interface SubmitFormalInteractionCommandV1 {
  routeSnapshot: RunRouteSnapshotV1;
  subjectId: string;
  action: DecisionActionV1;
  intent: WorkingActionIntentV1;
  inputFingerprint: string;
  authorizationContext?: PressureSystemDefaultAccessContextV1;
}

export interface SubmitFormalInteractionResultV1 {
  status: "ACCEPTED" | "REPLAYED";
  event: WorkingLedgerEventV1;
}

export type ChatVisibilityV1 = "PUBLIC" | "PARTICIPANTS" | "PRIVATE";

export interface SubmitPressureChatCommandV1 {
  routeSnapshot: RunRouteSnapshotV1;
  subjectId: string;
  senderSeatId: SeatIdV1;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  visibility: ChatVisibilityV1;
  targetSeatIds: SeatIdV1[];
  text: string;
  idempotencyKey: string;
  requestFingerprint: string;
}

export interface PressureChatMessageV1 {
  schemaVersion: "pressure_chapter_chat_message_v1";
  messageId: string;
  runId: string;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  senderSeatId: SeatIdV1;
  visibility: ChatVisibilityV1;
  audienceSeatIds: SeatIdV1[];
  text: string;
  idempotencyKey: string;
  requestFingerprint: string;
  messageHash: string;
}

/** Chat storage is deliberately separate from the formal WorkingLedgerPort. */
export interface PressureChatPort {
  findByIdempotencyKey(input: {
    runId: string;
    chapterRuntimeId: string;
    idempotencyKey: string;
  }): Promise<PressureChatMessageV1 | null>;
  appendIfAbsent(message: PressureChatMessageV1): Promise<{
    status: "APPENDED" | "EXISTING";
    message: PressureChatMessageV1;
  }>;
  list(input: {
    runId: string;
    chapterRuntimeId: string;
  }): Promise<PressureChatMessageV1[]>;
}
