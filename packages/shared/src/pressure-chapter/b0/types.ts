import type { CanonicalJsonValue } from "../contracts/canonical";
import type { SealedChapterSettlementInputV1 as PressureSealedChapterSettlementInputV1 } from "../contracts/chapter";
import type { ChapterIdV1, SeatIdV1 } from "../contracts/domain";

export type B0PressureChapterIdV1 = ChapterIdV1;
export type B0PressureChapterSeatIdV1 = SeatIdV1;
export type B0JsonValue = CanonicalJsonValue;

export type B0ChapterSeatParticipationV1 = {
  seatId: B0PressureChapterSeatIdV1;
  requirement: "REQUIRED" | "NOT_REQUIRED";
  completion:
    | "SEALED_ACTIONS"
    | "DEFAULTED"
    | "MIXED_ACTIONS"
    | "NOT_REQUIRED";
  /** Canonical, unique policy refs for every deterministic default in this chapter. */
  defaultCodes: string[];
};

export type B0ChapterResourceSnapshotV1 = {
  resourceId: string;
  quantity: number;
  version: number;
};

export type B0SealedChapterResourceCommitmentV1 = {
  commitmentId: string;
  reservationKey: string;
  resourceId: string;
  amount: number;
  expectedResourceVersion: number;
};

export type B0SealedChapterDecisionActionV1 = {
  actionId: string;
  decisionPointId: string;
  seatId: B0PressureChapterSeatIdV1;
  source: "HUMAN" | "AI" | "DEFAULT";
  actionType: string;
  payload: B0JsonValue;
  resourceCommitments: B0SealedChapterResourceCommitmentV1[];
  evidenceRefs: string[];
};

export type B0ChapterSettlementMaterialV1 = {
  seats: B0ChapterSeatParticipationV1[];
  resources: B0ChapterResourceSnapshotV1[];
  actions: B0SealedChapterDecisionActionV1[];
};

/** Cross-module wire DTO plus B0-only execution material. */
export type B0ChapterSettlementCompileRequestV1 = {
  wireInput: PressureSealedChapterSettlementInputV1;
  settlementMaterial: B0ChapterSettlementMaterialV1;
};

/** Internal B0 model. It is not a second wire representation. */
export type B0ChapterSettlementInputV1 = {
  schemaVersion: "b0_chapter_settlement_input_v1";
  wireInput: PressureSealedChapterSettlementInputV1;
  chapterSequence: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  settlementMaterial: B0ChapterSettlementMaterialV1;
  runChapterFingerprint: string;
  b0InputHash: string;
};

export type B0ChapterSettlementInputDraftV1 = Omit<
  B0ChapterSettlementInputV1,
  "runChapterFingerprint" | "b0InputHash"
>;

export type B0ChapterResourceDispositionV1 = {
  commitmentId: string;
  disposition: "CONSUMED" | "RELEASED";
};

export type B0ChapterWorldMutationV1 = {
  mutationId: string;
  entityType: "ACTOR" | "LOCATION" | "DOCUMENT" | "EVIDENCE" | "INSTITUTION" | "RELATION" | "WORLD";
  entityId: string;
  attribute: string;
  operation: "SET" | "INCREMENT" | "ADD" | "REMOVE";
  value: B0JsonValue;
  originActionIds: string[];
};

export type B0ChapterSeatArcDeltaV1 = {
  seatId: B0PressureChapterSeatIdV1;
  delta: B0JsonValue;
};

export type B0ChapterCausalEdgeV1 = {
  edgeId: string;
  fromActionIds: string[];
  toMutationIds: string[];
  relation: string;
  evidenceRefs: string[];
};

export type B0ChapterPolicyEvaluationV1 = {
  schemaVersion: "b0_chapter_policy_evaluation_v1";
  b0InputHash: string;
  contentPolicyVersion: string;
  contentPolicyHash: string;
  resourceDispositions: B0ChapterResourceDispositionV1[];
  mutations: B0ChapterWorldMutationV1[];
  seatArcDeltas: B0ChapterSeatArcDeltaV1[];
  trackDelta: B0JsonValue;
  carryForward: B0JsonValue;
  causalEdges: B0ChapterCausalEdgeV1[];
  evaluationHash: string;
};

export type B0ChapterPolicyEvaluationDraftV1 = Omit<B0ChapterPolicyEvaluationV1, "evaluationHash">;

export type B0ChapterResourceDeltaV1 = {
  mutationId: string;
  resourceId: string;
  expectedResourceVersion: number;
  baseQuantity: number;
  delta: number;
  committedQuantity: number;
  commitmentIds: string[];
  originActionIds: string[];
};

export type B0ChapterWorldDeltaV1 = {
  schemaVersion: "b0_chapter_world_delta_v1";
  runId: string;
  chapterRuntimeId: string;
  chapterId: B0PressureChapterIdV1;
  wireInputHash: string;
  b0InputHash: string;
  baseWorldSequence: number;
  committedWorldSequence: number;
  resourceDeltas: B0ChapterResourceDeltaV1[];
  mutations: B0ChapterWorldMutationV1[];
  seatArcDeltas: B0ChapterSeatArcDeltaV1[];
  trackDelta: B0JsonValue;
  carryForward: B0JsonValue;
  causalEdges: B0ChapterCausalEdgeV1[];
  worldDeltaHash: string;
};

export type B0ChapterSettlementCommandV1 = {
  schemaVersion: "b0_chapter_settlement_command_v1";
  idempotencyKey: string;
  requestFingerprint: string;
  input: B0ChapterSettlementInputV1;
  evaluation: B0ChapterPolicyEvaluationV1;
};

export type B0ChapterSettlementReceiptV1 = {
  /** Pure deterministic domain receipt; durable commit proof is added by the atomic repository adapter. */
  schemaVersion: "b0_chapter_settlement_receipt_v1";
  status: "SETTLED" | "ALREADY_SETTLED";
  settlementId: string;
  runId: string;
  chapterRuntimeId: string;
  chapterId: B0PressureChapterIdV1;
  idempotencyKey: string;
  requestFingerprint: string;
  runChapterFingerprint: string;
  wireInputHash: string;
  b0InputHash: string;
  evaluationHash: string;
  worldDeltaHash: string;
  baseWorldSequence: number;
  committedWorldSequence: number;
  commitManifestHash: string;
  commitHash: string;
};

export type B0ChapterSettlementResultV1 = {
  worldDelta: Readonly<B0ChapterWorldDeltaV1>;
  receipt: Readonly<B0ChapterSettlementReceiptV1>;
};
