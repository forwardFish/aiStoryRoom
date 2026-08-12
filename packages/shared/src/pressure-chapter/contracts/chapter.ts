import {
  hashWithoutField,
  sha256Canonical,
  type CanonicalJsonObject,
} from "./canonical";
import {
  PRESSURE_CHAPTER_CONTRACT_ERROR_CODES as ERROR,
  failPressureContract,
} from "./errors";
import type { RunRouteSnapshotV1 } from "./route";
import {
  CHAPTER_IDS_V1,
  chapterSequence,
  nextChapterId,
  validateCarryForwardV1,
  validateCausalEdgesV1,
  validateChapterIdV1,
  validateDeadlinePolicyV1,
  validateDeterministicDefaultPolicyV1,
  validateDeterministicPredicateV1,
  validateObjectKnowledgeEvidenceResponsibilityDeltaV1,
  validateResourceReservationMutationsV1,
  validateSeatArcDeltasV1,
  validateSeatIdV1,
  validateTrackDeltaV1,
  validateWorkingDeltaV1,
  validateWorldDeltaV1,
  validateWorldStateV1,
  type CausalEdgeV1,
  type CarryForwardV1,
  type ChapterIdV1,
  type DeadlinePolicyV1,
  type DeterministicDefaultPolicyV1,
  type DeterministicPredicateV1,
  type ObjectKnowledgeEvidenceResponsibilityDeltaV1,
  type ResourceReservationMutationV1,
  type SeatArcDeltaV1,
  type SeatIdV1,
  type TrackDeltaV1,
  type WorkingDeltaV1,
  type WorldDeltaV1,
  type WorldStateV1,
} from "./domain";
import {
  assertHashEqual,
  assertOrderedBy,
  assertSelfHash,
  canonicalJsonObject,
  contractArray,
  contractEnum,
  contractInteger,
  contractLiteral,
  contractObject,
  contractSha256,
  contractString,
  contractStringArray,
  exactContractKeys,
  exactRecordKeys,
  type RawContract,
} from "./validation";
import { PRESSURE_CHAPTER_SEAT_IDS_V1 } from "./route";

export interface GenesisSnapshotV1 {
  schemaVersion: "sangtian_genesis_snapshot_v1";
  runId: string;
  nodeId: "P0";
  sequence: 0;
  routeHash: string;
  contentPackageSha256: string;
  orchestrationPackageSha256: string;
  initialWorldState: WorldStateV1;
  genesisHash: string;
}

export interface DecisionPointDefinitionV1 {
  decisionPointKey: string;
  chapterId: ChapterIdV1;
  ordinal: number;
  mode: "SOLO_BEAT" | "TARGETED_INTERACTION" | "SYNC_CONTEST";
  purpose: string;
  requiredSeatIds: SeatIdV1[];
  allowedActionTypes: string[];
  perSeatActionBudget: Partial<Record<SeatIdV1, number>>;
  closeCondition: DeterministicPredicateV1;
  deadlinePolicy: DeadlinePolicyV1 | null;
  absenceDefaultPolicy: DeterministicDefaultPolicyV1;
  aiFailureDefaultPolicy: DeterministicDefaultPolicyV1;
  beatResolutionPolicy: string;
  allowedWorkingDeltaTypes: string[];
  feedbackVisibilityPolicy: string;
  reactionPolicy: {
    enabled: boolean;
    eligibleSeatIds: SeatIdV1[];
    trigger: DeterministicPredicateV1 | null;
    maxDepth: 0 | 1;
  };
}

/** Only confirmed and sealed actions cross into the authoritative ledger. */
export interface DecisionActionV1 {
  schemaVersion: "sangtian_decision_action_v1";
  actionId: string;
  runId: string;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  decisionPointId: string;
  seatId: SeatIdV1;
  actionOrdinal: number;
  actionRevision: number;
  controlEpoch: number;
  expectedWorkingRevision: number;
  status: "SEALED";
  actionType: string;
  payload: CanonicalJsonObject;
  payloadHash: string;
  idempotencyKey: string;
  requestFingerprint: string;
  sealedHash: string;
}

export interface BeatResolutionV1 {
  schemaVersion: "sangtian_beat_resolution_v1";
  runId: string;
  chapterRuntimeId: string;
  decisionPointId: string;
  baseWorkingRevision: number;
  committedWorkingRevision: number;
  inputWorkingStateHash: string;
  sealedActionIds: string[];
  sealedActionsHash: string;
  resolverVersion: string;
  workingDelta: WorkingDeltaV1;
  reservationMutations: ResourceReservationMutationV1[];
  reactionContextRef: { sourceHash: string } | null;
  nextDecisionContextRef: { sourceHash: string } | null;
  resolutionHash: string;
}

export interface ChapterSettlementInputV1 {
  schemaVersion: "sangtian_chapter_settlement_input_v1";
  runId: string;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  baseWorldSequence: number;
  baseWorldStateHash: string;
  runRouteHash: string;
  previousFrozenHash: string;
  decisionLedgerHash: string;
  finalWorkingStateHash: string;
  sealedDecisionActionIds: string[];
  reservationLedgerHash: string;
  contentPolicyVersion: string;
  contentPolicyHash: string;
  settlementContractVersion: string;
  settlementContractHash: string;
  inputHash: string;
}

export type SealedChapterSettlementInputV1 = Readonly<ChapterSettlementInputV1>;

export interface ChapterSettlementEvaluationV1 {
  schemaVersion: "sangtian_chapter_settlement_evaluation_v1";
  inputHash: string;
  worldDelta: WorldDeltaV1;
  seatArcDeltas: SeatArcDeltaV1[];
  trackDelta: TrackDeltaV1;
  objectKnowledgeEvidenceResponsibilityDelta: ObjectKnowledgeEvidenceResponsibilityDeltaV1;
  causalEdges: CausalEdgeV1[];
  carryForward: CarryForwardV1;
  evaluationHash: string;
}

export interface B0SettlementCommitResultV1 {
  schemaVersion: "b0_settlement_commit_result_v1";
  settlementId: string;
  frozenChapterBundleId: string;
  runId: string;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  inputHash: string;
  evaluationHash: string;
  baseWorldSequence: number;
  committedWorldSequence: number;
  baseWorldStateHash: string;
  committedWorldStateHash: string;
  worldDeltaHash: string;
  commitManifestHash: string;
  bundleHash: string;
  rootEventId: string;
  outboxDedupeKeys: string[];
  commitHash: string;
}

export interface FrozenChapterBundleV1 {
  schemaVersion: "sangtian_frozen_chapter_bundle_v1";
  runId: string;
  chapterId: ChapterIdV1;
  chapterSequence: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  baseWorldSequence: number;
  committedWorldSequence: number;
  previousFrozenHash: string;
  decisionLedgerHash: string;
  finalWorkingStateHash: string;
  settlementPolicyVersion: string;
  worldDelta: WorldDeltaV1;
  committedWorldStateHash: string;
  frozenWorldState: WorldStateV1;
  causalEdges: CausalEdgeV1[];
  carryForward: CarryForwardV1;
  bundleHash: string;
}

export function validateGenesisSnapshotV1(
  value: unknown,
  route?: Pick<
    RunRouteSnapshotV1,
    "runId" | "routeHash" | "contentPackageSha256" | "orchestrationPackageSha256"
  >,
): GenesisSnapshotV1 {
  const genesis = contractObject(value, "genesis");
  exactContractKeys(genesis, [
    "schemaVersion",
    "runId",
    "nodeId",
    "sequence",
    "routeHash",
    "contentPackageSha256",
    "orchestrationPackageSha256",
    "initialWorldState",
    "genesisHash",
  ], "genesis");
  contractLiteral(
    genesis.schemaVersion,
    "sangtian_genesis_snapshot_v1",
    "genesis.schemaVersion",
    ERROR.SCHEMA_VERSION_UNSUPPORTED,
  );
  contractString(genesis.runId, "genesis.runId");
  contractLiteral(genesis.nodeId, "P0", "genesis.nodeId");
  contractLiteral(genesis.sequence, 0, "genesis.sequence", ERROR.CONTRACT_SEQUENCE_MISMATCH);
  for (const field of [
    "routeHash",
    "contentPackageSha256",
    "orchestrationPackageSha256",
  ] as const) {
    contractSha256(genesis[field], `genesis.${field}`);
  }
  const world = validateWorldStateV1(genesis.initialWorldState, "genesis.initialWorldState");
  if (world.worldSequence !== 0) {
    failPressureContract(
      ERROR.CONTRACT_SEQUENCE_MISMATCH,
      "genesis.initialWorldState.worldSequence",
      "EXPECTED_0",
    );
  }
  assertSelfHash(genesis, "genesisHash", "genesis");
  if (route) {
    for (const field of [
      "runId",
      "routeHash",
      "contentPackageSha256",
      "orchestrationPackageSha256",
    ] as const) {
      if (genesis[field] !== route[field]) {
        failPressureContract(
          ERROR.CONTRACT_REFERENCE_MISMATCH,
          `genesis.${field}`,
          `EXPECTED_${route[field]}`,
        );
      }
    }
  }
  return genesis as unknown as GenesisSnapshotV1;
}

export function validateDecisionPointDefinitionV1(
  value: unknown,
): DecisionPointDefinitionV1 {
  const point = contractObject(value, "decisionPoint");
  exactContractKeys(point, [
    "decisionPointKey",
    "chapterId",
    "ordinal",
    "mode",
    "purpose",
    "requiredSeatIds",
    "allowedActionTypes",
    "perSeatActionBudget",
    "closeCondition",
    "deadlinePolicy",
    "absenceDefaultPolicy",
    "aiFailureDefaultPolicy",
    "beatResolutionPolicy",
    "allowedWorkingDeltaTypes",
    "feedbackVisibilityPolicy",
    "reactionPolicy",
  ], "decisionPoint");
  contractString(point.decisionPointKey, "decisionPoint.decisionPointKey");
  validateChapterIdV1(point.chapterId, "decisionPoint.chapterId");
  contractInteger(point.ordinal, "decisionPoint.ordinal", 1);
  const mode = contractEnum(
    point.mode,
    ["SOLO_BEAT", "TARGETED_INTERACTION", "SYNC_CONTEST"] as const,
    "decisionPoint.mode",
  );
  contractString(point.purpose, "decisionPoint.purpose");
  const seats = validateSeatList(point.requiredSeatIds, "decisionPoint.requiredSeatIds", true);
  if (mode === "SOLO_BEAT" && seats.length !== 1) {
    failPressureContract(
      ERROR.CONTRACT_FIELD_INVALID,
      "decisionPoint.requiredSeatIds",
      "SOLO_BEAT_EXACTLY_ONE",
    );
  }
  const allowedActions = contractStringArray(
    point.allowedActionTypes,
    "decisionPoint.allowedActionTypes",
    { nonEmpty: true, sorted: true },
  );
  const budget = exactRecordKeys(
    point.perSeatActionBudget,
    seats,
    "decisionPoint.perSeatActionBudget",
  );
  for (const seatId of seats) {
    contractInteger(budget[seatId], `decisionPoint.perSeatActionBudget.${seatId}`, 1);
  }
  validateDeterministicPredicateV1(point.closeCondition, "decisionPoint.closeCondition");
  if (point.deadlinePolicy !== null) {
    validateDeadlinePolicyV1(point.deadlinePolicy, "decisionPoint.deadlinePolicy");
  }
  const absence = validateDeterministicDefaultPolicyV1(
    point.absenceDefaultPolicy,
    "decisionPoint.absenceDefaultPolicy",
  );
  const aiFailure = validateDeterministicDefaultPolicyV1(
    point.aiFailureDefaultPolicy,
    "decisionPoint.aiFailureDefaultPolicy",
  );
  if (!allowedActions.includes(absence.actionType) || !allowedActions.includes(aiFailure.actionType)) {
    failPressureContract(
      ERROR.CONTRACT_REFERENCE_MISMATCH,
      "decisionPoint.defaultPolicy.actionType",
      "NOT_IN_ALLOWED_ACTION_TYPES",
    );
  }
  contractString(point.beatResolutionPolicy, "decisionPoint.beatResolutionPolicy");
  contractStringArray(
    point.allowedWorkingDeltaTypes,
    "decisionPoint.allowedWorkingDeltaTypes",
    { nonEmpty: true, sorted: true },
  );
  contractString(point.feedbackVisibilityPolicy, "decisionPoint.feedbackVisibilityPolicy");
  validateReactionPolicy(point.reactionPolicy, seats);
  return point as unknown as DecisionPointDefinitionV1;
}

export function computeDecisionActionRequestFingerprint(
  action: Pick<
    DecisionActionV1,
    | "runId"
    | "chapterRuntimeId"
    | "decisionPointId"
    | "seatId"
    | "controlEpoch"
    | "expectedWorkingRevision"
    | "actionOrdinal"
    | "actionRevision"
    | "actionType"
    | "payload"
  >,
): string {
  return sha256Canonical({
    commandType: "SEAL_DECISION_ACTION",
    runId: action.runId,
    chapterRuntimeId: action.chapterRuntimeId,
    decisionPointId: action.decisionPointId,
    seatId: action.seatId,
    controlEpoch: action.controlEpoch,
    expectedWorkingRevision: action.expectedWorkingRevision,
    canonicalPayload: {
      actionOrdinal: action.actionOrdinal,
      actionRevision: action.actionRevision,
      actionType: action.actionType,
      payload: action.payload,
    },
  });
}

export function validateDecisionActionV1(value: unknown): DecisionActionV1 {
  const action = contractObject(value, "decisionAction");
  exactContractKeys(action, [
    "schemaVersion",
    "actionId",
    "runId",
    "chapterRuntimeId",
    "chapterId",
    "decisionPointId",
    "seatId",
    "actionOrdinal",
    "actionRevision",
    "controlEpoch",
    "expectedWorkingRevision",
    "status",
    "actionType",
    "payload",
    "payloadHash",
    "idempotencyKey",
    "requestFingerprint",
    "sealedHash",
  ], "decisionAction");
  contractLiteral(
    action.schemaVersion,
    "sangtian_decision_action_v1",
    "decisionAction.schemaVersion",
    ERROR.SCHEMA_VERSION_UNSUPPORTED,
  );
  for (const field of ["actionId", "runId", "chapterRuntimeId", "decisionPointId", "actionType", "idempotencyKey"] as const) {
    contractString(action[field], `decisionAction.${field}`);
  }
  validateChapterIdV1(action.chapterId, "decisionAction.chapterId");
  validateSeatIdV1(action.seatId, "decisionAction.seatId");
  contractInteger(action.actionOrdinal, "decisionAction.actionOrdinal", 1);
  contractInteger(action.actionRevision, "decisionAction.actionRevision", 1);
  contractInteger(action.controlEpoch, "decisionAction.controlEpoch", 0);
  contractInteger(action.expectedWorkingRevision, "decisionAction.expectedWorkingRevision", 0);
  contractLiteral(action.status, "SEALED", "decisionAction.status");
  const payload = canonicalJsonObject(action.payload, "decisionAction.payload");
  assertHashEqual(
    action.payloadHash,
    sha256Canonical(payload),
    "decisionAction.payloadHash",
    ERROR.CONTRACT_HASH_MISMATCH,
  );
  const typed = action as unknown as DecisionActionV1;
  assertHashEqual(
    action.requestFingerprint,
    computeDecisionActionRequestFingerprint(typed),
    "decisionAction.requestFingerprint",
    ERROR.CONTRACT_FINGERPRINT_MISMATCH,
  );
  assertSelfHash(action, "sealedHash", "decisionAction");
  return typed;
}

export function computeSealedActionsHash(
  actions: ReadonlyArray<Pick<DecisionActionV1, "actionId" | "sealedHash">>,
): string {
  const ordered = [...actions].sort((left, right) =>
    left.actionId < right.actionId ? -1 : left.actionId > right.actionId ? 1 : 0,
  );
  return sha256Canonical(ordered);
}

export function validateBeatResolutionV1(
  value: unknown,
  sealedActions?: DecisionActionV1[],
): BeatResolutionV1 {
  const beat = contractObject(value, "beatResolution");
  exactContractKeys(beat, [
    "schemaVersion",
    "runId",
    "chapterRuntimeId",
    "decisionPointId",
    "baseWorkingRevision",
    "committedWorkingRevision",
    "inputWorkingStateHash",
    "sealedActionIds",
    "sealedActionsHash",
    "resolverVersion",
    "workingDelta",
    "reservationMutations",
    "reactionContextRef",
    "nextDecisionContextRef",
    "resolutionHash",
  ], "beatResolution");
  contractLiteral(
    beat.schemaVersion,
    "sangtian_beat_resolution_v1",
    "beatResolution.schemaVersion",
    ERROR.SCHEMA_VERSION_UNSUPPORTED,
  );
  for (const field of ["runId", "chapterRuntimeId", "decisionPointId", "resolverVersion"] as const) {
    contractString(beat[field], `beatResolution.${field}`);
  }
  const base = contractInteger(beat.baseWorkingRevision, "beatResolution.baseWorkingRevision", 0);
  const committed = contractInteger(
    beat.committedWorkingRevision,
    "beatResolution.committedWorkingRevision",
    1,
  );
  if (committed !== base + 1) {
    failPressureContract(
      ERROR.CONTRACT_SEQUENCE_MISMATCH,
      "beatResolution.committedWorkingRevision",
      `EXPECTED_${base + 1}`,
    );
  }
  contractSha256(beat.inputWorkingStateHash, "beatResolution.inputWorkingStateHash");
  const ids = contractStringArray(beat.sealedActionIds, "beatResolution.sealedActionIds", {
    nonEmpty: true,
    sorted: true,
  });
  contractSha256(beat.sealedActionsHash, "beatResolution.sealedActionsHash");
  validateWorkingDeltaV1(beat.workingDelta, "beatResolution.workingDelta");
  validateResourceReservationMutationsV1(
    beat.reservationMutations,
    "beatResolution.reservationMutations",
  );
  validateSourceHashRef(beat.reactionContextRef, "beatResolution.reactionContextRef");
  validateSourceHashRef(beat.nextDecisionContextRef, "beatResolution.nextDecisionContextRef");
  if (sealedActions) {
    const validated = sealedActions.map(validateDecisionActionV1);
    const actionIds = validated.map((action) => action.actionId).sort();
    if (JSON.stringify(actionIds) !== JSON.stringify(ids)) {
      failPressureContract(
        ERROR.CONTRACT_REFERENCE_MISMATCH,
        "beatResolution.sealedActionIds",
      );
    }
    assertHashEqual(
      beat.sealedActionsHash,
      computeSealedActionsHash(validated),
      "beatResolution.sealedActionsHash",
      ERROR.CONTRACT_HASH_MISMATCH,
    );
  }
  assertSelfHash(beat, "resolutionHash", "beatResolution");
  return beat as unknown as BeatResolutionV1;
}

export function validateSealedChapterSettlementInputV1(
  value: unknown,
): SealedChapterSettlementInputV1 {
  const input = contractObject(value, "chapterSettlementInput");
  exactContractKeys(input, [
    "schemaVersion",
    "runId",
    "chapterRuntimeId",
    "chapterId",
    "baseWorldSequence",
    "baseWorldStateHash",
    "runRouteHash",
    "previousFrozenHash",
    "decisionLedgerHash",
    "finalWorkingStateHash",
    "sealedDecisionActionIds",
    "reservationLedgerHash",
    "contentPolicyVersion",
    "contentPolicyHash",
    "settlementContractVersion",
    "settlementContractHash",
    "inputHash",
  ], "chapterSettlementInput");
  contractLiteral(
    input.schemaVersion,
    "sangtian_chapter_settlement_input_v1",
    "chapterSettlementInput.schemaVersion",
    ERROR.SCHEMA_VERSION_UNSUPPORTED,
  );
  contractString(input.runId, "chapterSettlementInput.runId");
  contractString(input.chapterRuntimeId, "chapterSettlementInput.chapterRuntimeId");
  const chapterId = validateChapterIdV1(input.chapterId, "chapterSettlementInput.chapterId");
  const baseSequence = contractInteger(
    input.baseWorldSequence,
    "chapterSettlementInput.baseWorldSequence",
    0,
    6,
  );
  if (baseSequence !== chapterSequence(chapterId) - 1) {
    failPressureContract(
      ERROR.CONTRACT_SEQUENCE_MISMATCH,
      "chapterSettlementInput.baseWorldSequence",
      `EXPECTED_${chapterSequence(chapterId) - 1}`,
    );
  }
  for (const field of [
    "baseWorldStateHash",
    "runRouteHash",
    "previousFrozenHash",
    "decisionLedgerHash",
    "finalWorkingStateHash",
    "reservationLedgerHash",
    "contentPolicyHash",
    "settlementContractHash",
  ] as const) {
    contractSha256(input[field], `chapterSettlementInput.${field}`);
  }
  contractStringArray(
    input.sealedDecisionActionIds,
    "chapterSettlementInput.sealedDecisionActionIds",
    { sorted: true },
  );
  contractString(input.contentPolicyVersion, "chapterSettlementInput.contentPolicyVersion");
  contractString(input.settlementContractVersion, "chapterSettlementInput.settlementContractVersion");
  assertSelfHash(input, "inputHash", "chapterSettlementInput");
  return input as unknown as SealedChapterSettlementInputV1;
}

export const validateChapterSettlementInputV1 = validateSealedChapterSettlementInputV1;

export function validateChapterSettlementEvaluationV1(
  value: unknown,
  inputHash?: string,
): ChapterSettlementEvaluationV1 {
  const evaluation = contractObject(value, "chapterSettlementEvaluation");
  exactContractKeys(evaluation, [
    "schemaVersion",
    "inputHash",
    "worldDelta",
    "seatArcDeltas",
    "trackDelta",
    "objectKnowledgeEvidenceResponsibilityDelta",
    "causalEdges",
    "carryForward",
    "evaluationHash",
  ], "chapterSettlementEvaluation");
  contractLiteral(
    evaluation.schemaVersion,
    "sangtian_chapter_settlement_evaluation_v1",
    "chapterSettlementEvaluation.schemaVersion",
    ERROR.SCHEMA_VERSION_UNSUPPORTED,
  );
  contractSha256(evaluation.inputHash, "chapterSettlementEvaluation.inputHash");
  if (inputHash && evaluation.inputHash !== inputHash) {
    failPressureContract(
      ERROR.CHAPTER_SETTLEMENT_FINGERPRINT_MISMATCH,
      "chapterSettlementEvaluation.inputHash",
      `EXPECTED_${inputHash}`,
    );
  }
  validateWorldDeltaV1(evaluation.worldDelta, "chapterSettlementEvaluation.worldDelta");
  validateSeatArcDeltasV1(evaluation.seatArcDeltas, "chapterSettlementEvaluation.seatArcDeltas");
  validateTrackDeltaV1(evaluation.trackDelta, "chapterSettlementEvaluation.trackDelta");
  validateObjectKnowledgeEvidenceResponsibilityDeltaV1(
    evaluation.objectKnowledgeEvidenceResponsibilityDelta,
    "chapterSettlementEvaluation.objectKnowledgeEvidenceResponsibilityDelta",
  );
  validateCausalEdgesV1(evaluation.causalEdges, "chapterSettlementEvaluation.causalEdges");
  validateCarryForwardV1(evaluation.carryForward, "chapterSettlementEvaluation.carryForward");
  assertSelfHash(evaluation, "evaluationHash", "chapterSettlementEvaluation");
  return evaluation as unknown as ChapterSettlementEvaluationV1;
}

export function validateB0SettlementCommitResultV1(
  value: unknown,
  input?: SealedChapterSettlementInputV1,
  evaluation?: ChapterSettlementEvaluationV1,
): B0SettlementCommitResultV1 {
  const receipt = contractObject(value, "settlementCommitResult");
  exactContractKeys(receipt, [
    "schemaVersion",
    "settlementId",
    "frozenChapterBundleId",
    "runId",
    "chapterRuntimeId",
    "chapterId",
    "inputHash",
    "evaluationHash",
    "baseWorldSequence",
    "committedWorldSequence",
    "baseWorldStateHash",
    "committedWorldStateHash",
    "worldDeltaHash",
    "commitManifestHash",
    "bundleHash",
    "rootEventId",
    "outboxDedupeKeys",
    "commitHash",
  ], "settlementCommitResult");
  contractLiteral(
    receipt.schemaVersion,
    "b0_settlement_commit_result_v1",
    "settlementCommitResult.schemaVersion",
    ERROR.SCHEMA_VERSION_UNSUPPORTED,
  );
  for (const field of [
    "settlementId",
    "frozenChapterBundleId",
    "runId",
    "chapterRuntimeId",
    "rootEventId",
  ] as const) {
    contractString(receipt[field], `settlementCommitResult.${field}`);
  }
  const chapterId = validateChapterIdV1(receipt.chapterId, "settlementCommitResult.chapterId");
  const base = contractInteger(receipt.baseWorldSequence, "settlementCommitResult.baseWorldSequence", 0, 6);
  const committed = contractInteger(
    receipt.committedWorldSequence,
    "settlementCommitResult.committedWorldSequence",
    1,
    7,
  );
  if (base !== chapterSequence(chapterId) - 1 || committed !== base + 1) {
    failPressureContract(ERROR.CONTRACT_SEQUENCE_MISMATCH, "settlementCommitResult.worldSequence");
  }
  for (const field of [
    "inputHash",
    "evaluationHash",
    "baseWorldStateHash",
    "committedWorldStateHash",
    "worldDeltaHash",
    "commitManifestHash",
    "bundleHash",
  ] as const) {
    contractSha256(receipt[field], `settlementCommitResult.${field}`);
  }
  contractStringArray(receipt.outboxDedupeKeys, "settlementCommitResult.outboxDedupeKeys", {
    sorted: true,
  });
  if (input) assertReceiptInput(receipt, input);
  if (evaluation && receipt.evaluationHash !== evaluation.evaluationHash) {
    failPressureContract(
      ERROR.CONTRACT_REFERENCE_MISMATCH,
      "settlementCommitResult.evaluationHash",
    );
  }
  if (evaluation) {
    assertHashEqual(
      receipt.worldDeltaHash,
      sha256Canonical(evaluation.worldDelta),
      "settlementCommitResult.worldDeltaHash",
      ERROR.CONTRACT_HASH_MISMATCH,
    );
  }
  assertSelfHash(receipt, "commitHash", "settlementCommitResult");
  return receipt as unknown as B0SettlementCommitResultV1;
}

export function validateFrozenChapterBundleV1(
  value: unknown,
  previousHash?: string,
): FrozenChapterBundleV1 {
  const bundle = contractObject(value, "frozenChapterBundle");
  exactContractKeys(bundle, [
    "schemaVersion",
    "runId",
    "chapterId",
    "chapterSequence",
    "baseWorldSequence",
    "committedWorldSequence",
    "previousFrozenHash",
    "decisionLedgerHash",
    "finalWorkingStateHash",
    "settlementPolicyVersion",
    "worldDelta",
    "committedWorldStateHash",
    "frozenWorldState",
    "causalEdges",
    "carryForward",
    "bundleHash",
  ], "frozenChapterBundle");
  contractLiteral(
    bundle.schemaVersion,
    "sangtian_frozen_chapter_bundle_v1",
    "frozenChapterBundle.schemaVersion",
    ERROR.SCHEMA_VERSION_UNSUPPORTED,
  );
  contractString(bundle.runId, "frozenChapterBundle.runId");
  const chapterId = validateChapterIdV1(bundle.chapterId, "frozenChapterBundle.chapterId");
  const sequence = contractInteger(bundle.chapterSequence, "frozenChapterBundle.chapterSequence", 1, 7);
  const base = contractInteger(bundle.baseWorldSequence, "frozenChapterBundle.baseWorldSequence", 0, 6);
  const committed = contractInteger(
    bundle.committedWorldSequence,
    "frozenChapterBundle.committedWorldSequence",
    1,
    7,
  );
  if (sequence !== chapterSequence(chapterId) || base !== sequence - 1 || committed !== sequence) {
    failPressureContract(ERROR.CONTRACT_SEQUENCE_MISMATCH, "frozenChapterBundle.sequence");
  }
  for (const field of [
    "previousFrozenHash",
    "decisionLedgerHash",
    "finalWorkingStateHash",
    "committedWorldStateHash",
  ] as const) {
    contractSha256(bundle[field], `frozenChapterBundle.${field}`);
  }
  if (previousHash && bundle.previousFrozenHash !== previousHash) {
    failPressureContract(
      ERROR.CONTRACT_REFERENCE_MISMATCH,
      "frozenChapterBundle.previousFrozenHash",
      `EXPECTED_${previousHash}`,
    );
  }
  contractString(bundle.settlementPolicyVersion, "frozenChapterBundle.settlementPolicyVersion");
  validateWorldDeltaV1(bundle.worldDelta, "frozenChapterBundle.worldDelta");
  const world = validateWorldStateV1(bundle.frozenWorldState, "frozenChapterBundle.frozenWorldState");
  if (world.worldSequence !== committed || world.stateHash !== bundle.committedWorldStateHash) {
    failPressureContract(
      ERROR.CONTRACT_REFERENCE_MISMATCH,
      "frozenChapterBundle.frozenWorldState",
      "COMMITTED_WORLD_MISMATCH",
    );
  }
  validateCausalEdgesV1(bundle.causalEdges, "frozenChapterBundle.causalEdges");
  const carry = validateCarryForwardV1(bundle.carryForward, "frozenChapterBundle.carryForward");
  if (carry.nextChapterId !== nextChapterId(chapterId)) {
    failPressureContract(
      ERROR.CONTRACT_REFERENCE_MISMATCH,
      "frozenChapterBundle.carryForward.nextChapterId",
      `EXPECTED_${nextChapterId(chapterId)}`,
    );
  }
  assertSelfHash(bundle, "bundleHash", "frozenChapterBundle");
  return bundle as unknown as FrozenChapterBundleV1;
}

export function computeContractHash<T extends Record<string, unknown>>(
  value: T,
  hashField: keyof T & string,
): string {
  return hashWithoutField(value, hashField);
}

function validateSeatList(value: unknown, path: string, nonEmpty = false): SeatIdV1[] {
  const seats = contractArray(value, path).map((seatId, index) =>
    validateSeatIdV1(seatId, `${path}[${index}]`),
  );
  if (nonEmpty && seats.length === 0) {
    failPressureContract(ERROR.CONTRACT_FIELD_INVALID, path, "NON_EMPTY_ARRAY");
  }
  assertOrderedBy(seats, (seatId) => seatId, path, PRESSURE_CHAPTER_SEAT_IDS_V1);
  return seats;
}

function validateReactionPolicy(value: unknown, requiredSeats: SeatIdV1[]): void {
  const reaction = contractObject(value, "decisionPoint.reactionPolicy");
  exactContractKeys(reaction, ["enabled", "eligibleSeatIds", "trigger", "maxDepth"], "decisionPoint.reactionPolicy");
  if (typeof reaction.enabled !== "boolean") {
    failPressureContract(ERROR.CONTRACT_FIELD_INVALID, "decisionPoint.reactionPolicy.enabled", "BOOLEAN");
  }
  const seats = validateSeatList(
    reaction.eligibleSeatIds,
    "decisionPoint.reactionPolicy.eligibleSeatIds",
    reaction.enabled,
  );
  if (seats.some((seatId) => !requiredSeats.includes(seatId))) {
    failPressureContract(
      ERROR.CONTRACT_REFERENCE_MISMATCH,
      "decisionPoint.reactionPolicy.eligibleSeatIds",
      "NOT_REQUIRED_SEAT",
    );
  }
  const maxDepth = contractInteger(reaction.maxDepth, "decisionPoint.reactionPolicy.maxDepth", 0, 1);
  if (reaction.enabled) {
    if (maxDepth !== 1 || reaction.trigger === null) {
      failPressureContract(
        ERROR.CONTRACT_FIELD_INVALID,
        "decisionPoint.reactionPolicy",
        "ENABLED_REQUIRES_TRIGGER_AND_DEPTH_1",
      );
    }
    validateDeterministicPredicateV1(reaction.trigger, "decisionPoint.reactionPolicy.trigger");
  } else if (maxDepth !== 0 || reaction.trigger !== null || seats.length !== 0) {
    failPressureContract(
      ERROR.CONTRACT_FIELD_INVALID,
      "decisionPoint.reactionPolicy",
      "DISABLED_REQUIRES_EMPTY",
    );
  }
}

function validateSourceHashRef(value: unknown, path: string): void {
  if (value === null) return;
  const ref = contractObject(value, path);
  exactContractKeys(ref, ["sourceHash"], path);
  contractSha256(ref.sourceHash, `${path}.sourceHash`);
}

function assertReceiptInput(
  receipt: RawContract,
  input: SealedChapterSettlementInputV1,
): void {
  for (const field of [
    "runId",
    "chapterRuntimeId",
    "chapterId",
    "inputHash",
    "baseWorldSequence",
    "baseWorldStateHash",
  ] as const) {
    if (receipt[field] !== input[field]) {
      failPressureContract(
        ERROR.CONTRACT_REFERENCE_MISMATCH,
        `settlementCommitResult.${field}`,
        `EXPECTED_${input[field]}`,
      );
    }
  }
}

export function orderedChapterIdsV1(): readonly ChapterIdV1[] {
  return CHAPTER_IDS_V1;
}
