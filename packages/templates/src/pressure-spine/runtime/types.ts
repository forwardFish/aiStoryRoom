import type { PressureCompiledActionCommand } from "./internal-types";

export const PRESSURE_RUNTIME_PHASES = [
  "P0_PROJECTING",
  "PREPARE_OPEN",
  "PREPARE_LOCKED",
  "PREPARE_RESOLVING",
  "COMMIT_OPEN",
  "COMMIT_LOCKED",
  "REACTION_OPEN",
  "SETTLING",
  "FROZEN",
  "PROJECTING",
  "FINALE_COMPUTING",
  "COMPLETED",
  "FAILED_RECOVERABLE",
] as const;

export type PressureRuntimePhase = (typeof PRESSURE_RUNTIME_PHASES)[number];
export type PressureResumePhase = Exclude<PressureRuntimePhase, "FAILED_RECOVERABLE" | "COMPLETED">;

export const PRESSURE_ROOT_EVENT_TYPES = [
  "RUN_INITIALIZED",
  "PHASE_OPENED",
  "ACTION_SEALED",
  "TIME_ADVANCED",
  "DEFAULT_ACTION_APPLIED",
  "REACTION_OPENED",
  "SETTLEMENT_FROZEN",
  "OPENING_PROJECTED",
  "HANDOFF_APPLIED",
  "FINALE_FROZEN",
  "NARRATIVE_PUBLISHED",
  "RECOVERY_COMPLETED",
] as const;

export type PressureRootEventType = (typeof PRESSURE_ROOT_EVENT_TYPES)[number];

export const PRESSURE_WORLD_ACTION_TYPES = [
  "ALLOCATE",
  "SIGN",
  "TRANSFER",
  "SEIZE",
  "DISCLOSE",
  "DISPATCH",
] as const;
export type PressureWorldActionType = (typeof PRESSURE_WORLD_ACTION_TYPES)[number];

export const PRESSURE_ACTION_TYPES = [
  ...PRESSURE_WORLD_ACTION_TYPES,
  "REST",
  "DELAY",
  "NEGOTIATE",
  "INVESTIGATE",
  "PLAN",
  "PASS",
] as const;
export type PressureActionType = (typeof PRESSURE_ACTION_TYPES)[number];

export const PRESSURE_ACTION_SLOTS = ["PREPARE", "COMMIT", "REACTION"] as const;
export type PressureActionSlot = (typeof PRESSURE_ACTION_SLOTS)[number];

export type PressureResourceCommitmentV1 = { resourceId: string; amount: number };
export type PressureActionIntentParametersV1 = {
  targetSeatId?: string | null;
  destinationId?: string | null;
  factIds?: string[];
  signatureId?: string | null;
  disclosureVisibility?: PressureVisibility;
  desiredDisposition?: "HOLD" | "TRANSFER" | "SEIZE" | "UPDATE" | "DESTROY" | null;
};

/**
 * Public client/API command. It intentionally cannot carry state patches,
 * effects, authority grants, action ids or request fingerprints. Those values
 * are derived by the server from the accepted content package and current state.
 */
export type PressureActionIntentCommandV1 = {
  schemaVersion: "pressure_action_intent_v1";
  runId: string;
  nodeId: string;
  slot: PressureActionSlot;
  seatId: string;
  currentActorId: string;
  controlEpoch: number;
  type: PressureActionType;
  intentText: string;
  targetObjectId?: string | null;
  expectedObjectVersionId?: string | null;
  resourceCommitments: PressureResourceCommitmentV1[];
  parameters?: PressureActionIntentParametersV1;
  visibility: PressureVisibility;
  submittedAtEpochMs: number;
  expectedRunVersion: number;
  expectedSnapshotHash: string;
  idempotencyKey: string;
};

export type PressureVisibility = "PUBLIC" | "OBSERVABLE" | "LIMITED" | "PRIVATE" | "PRIVATE_SYSTEM";
export type PressureActionStatus = "SEALED" | "RESOLVED" | "REJECTED";
export type PressureBranchLevel = "LOCKED" | "HIGH" | "MID" | "LOW";
export type PressureKnowledgeProvenance = "PUBLIC" | "SEAT_RECORD" | "TRANSFERRED" | "PRIVATE_ACTOR";

export type PressureKernelErrorCode =
  | "RUNTIME_PROFILE_REQUIRED"
  | "PACKAGE_VERSION_NOT_REGISTERED"
  | "PACKAGE_HASH_MISMATCH"
  | "CONTENT_IMPORT_INVALID"
  | "NODE_PHASE_MISMATCH"
  | "ACTION_SCHEMA_INVALID"
  | "ACTION_SLOT_INVALID"
  | "ACTION_TYPE_INVALID"
  | "ACTION_OPERATION_INVALID"
  | "ACTION_PAYLOAD_CONFLICT"
  | "ACTION_ID_CONFLICT"
  | "ACTION_WINDOW_CLOSED"
  | "ACTION_ALREADY_SEALED"
  | "PREVIEW_REQUIRED"
  | "PREVIEW_STALE"
  | "PREVIEW_TAMPERED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "RUN_VERSION_CONFLICT"
  | "CONTROL_EPOCH_CHANGED"
  | "ROLE_FORBIDDEN"
  | "ACTOR_MISMATCH"
  | "CURRENT_ACTOR_MISMATCH"
  | "TARGET_NOT_REACHABLE"
  | "OBJECT_VERSION_CONFLICT"
  | "OBJECT_NOT_HELD"
  | "OBJECT_NOT_KNOWN"
  | "OBJECT_NEWLY_ACQUIRED_DESTROY_FORBIDDEN"
  | "RESOURCE_INSUFFICIENT"
  | "DEADLINE_EXPIRED"
  | "SIGNATURE_AUTHORITY_REQUIRED"
  | "FREE_TEXT_UNPARSEABLE"
  | "FREE_TEXT_MULTIPLE_INTENTS"
  | "FREE_TEXT_PROMPT_INJECTION"
  | "OUTCOME_OWNERSHIP"
  | "CAUSAL_PROCESS_REQUIRED"
  | "REACTION_NOT_AVAILABLE"
  | "REACTION_ALREADY_USED"
  | "REACTION_RESEAL_LIMIT"
  | "SETTLEMENT_INPUT_INCOMPLETE"
  | "SETTLEMENT_INPUT_DRIFT"
  | "SETTLEMENT_REPLAY_HASH_MISMATCH"
  | "FROZEN_RESULT_HASH_MISMATCH"
  | "ROOT_EVENT_TYPE_INVALID"
  | "RECOVERY_CHECKPOINT_INVALID"
  | "D3_REQUIRED"
  | "PROJECTION_KNOWLEDGE_VIOLATION"
  | "PROJECTION_INPUT_DRIFT"
  | "PROJECTION_INPUT_MISMATCH"
  | "NARRATIVE_FACT_VIOLATION"
  | "RESULT_NOT_READY";

export type SelectorAtom = {
  key?: string;
  expr?: string;
  op?: "==" | "!=" | ">=" | ">" | "<=" | "<" | "IN" | "NOT_IN";
  value?: unknown;
};
export type SelectorRule = SelectorAtom | { all: SelectorRule[] } | { any: SelectorRule[] } | { otherwise: true };

export type PressureContentObjectOutcome = {
  objectId: string;
  versionId: string;
  status: string;
  custodyMode: string;
  custodyRule: string;
  knownBy: string[];
  visibility: PressureVisibility;
  availableFrom: string;
};

export type PressureContentBranch = {
  branchId: string;
  level: PressureBranchLevel;
  frozenResultId: string;
  sceneId?: string;
  transitionSceneId?: string;
  frozenFactIds: string[];
  objectOutcomes: PressureContentObjectOutcome[];
  responsibilityAndEvidenceFreeze: string[];
  trackDeltas: Record<string, number>;
  carryForward: string[];
  knownBy: string[];
  visibility: PressureVisibility;
  raw: Record<string, unknown>;
};

export type PressureContentReaction = {
  trigger: string;
  triggerId: string;
  eligibleSeatIds: string[];
  allowedActionTypes: PressureWorldActionType[];
  windowSeconds: number;
  maxReseals: number;
};

export type PressureContentOpeningVariant = {
  openingProjectionId: string;
  predecessorBranchId: string;
  predecessorFrozenResultId: string;
  requiredFrozenFactIds: string[];
  requiredObjectVersionIds: string[];
  publicReferencedObjectVersionIds: string[];
  seatPrivateProjections: Array<{
    seatId: string;
    grantedFrozenFactIds: string[];
    grantedObjectVersionIds: string[];
    currentActorId: string;
  }>;
  publicSceneId?: string;
  raw: Record<string, unknown>;
};

export type PressureContentKnownFact = {
  factId: string;
  provenance: PressureKnowledgeProvenance;
  claimId: string | null;
  objectId: string | null;
  objectVersionId: string | null;
  handoffId: string | null;
  eventId: string | null;
};

export type PressureContentSeat = {
  seatId: string;
  roleKey: string;
  currentActorId: string;
  knownFactIds: string[];
  unknownFactIds: string[];
  knownFacts: PressureContentKnownFact[];
  resources: string[];
  permissions: string[];
  keyLeverageObjectIds: string[];
  defaultPrepare: string;
  defaultCommit: string;
};

export type PressureContentObject = {
  objectId: string;
  kind: string;
  initialCustody: string;
  sourceStatus: string;
};


export type PressureContentDefaultPolicy = {
  defaultPolicyId: string;
  seatId: string;
  currentActorId: string;
  prepareText: string;
  commitText: string;
};

export type PressureContentInputFallback = {
  fallbackId: string;
  inputClass: string;
  actionRealization: string;
  timeDeltaMinutes: number;
  pressureDelta: number;
};

export type PressureContentHandoff = {
  handoffId: string;
  afterNode: string;
  seatId: string;
  fromActorId: string;
  toActorId: string;
  permissionChange: string[];
  inheritIf: string[];
  neverAutoInherit: string[];
};

export type PressureContentNode = {
  nodeId: string;
  sequence: number;
  title: string;
  nextNodeId: string | null;
  initialPressureLevel: number;
  initialTimeUsed: number;
  actionBudget: { preparePerSeat: number; commitPerSeat: number; reactionPerSeat: number };
  contestedObjectIds: string[];
  secondaryObjectIds: string[];
  selectorInputKeys: string[];
  branchEvaluationOrder: PressureBranchLevel[];
  branchSelectors: Partial<Record<PressureBranchLevel, SelectorRule>>;
  defaultInputState: Record<string, unknown>;
  defaultBranchId: string;
  branches: PressureContentBranch[];
  conflictPriorityOrder: string[];
  reaction: PressureContentReaction | null;
  openingVariants: PressureContentOpeningVariant[];
  seats: PressureContentSeat[];
  defaultPolicies: PressureContentDefaultPolicy[];
  inputFallbacks: PressureContentInputFallback[];
};

export type PressureRuntimeContent = {
  schemaVersion: "pressure_runtime_content_v1";
  worldId: string;
  runtimeProfile: string;
  strategyVersion: string;
  packageId: string;
  packageVersion: string;
  packageSha256: string;
  contentTreeSha256: string;
  sourceSha256: string;
  nodeIds: string[];
  seatIds: string[];
  nodes: Record<string, PressureContentNode>;
  objects: Record<string, PressureContentObject>;
  handoffs: PressureContentHandoff[];
  worldTrackIds: string[];
};

export type PressureRuntimeObjectState = {
  objectId: string;
  versionId: string;
  predecessorVersionId: string | null;
  version: number;
  kind: string;
  status: string;
  custodySeatId: string | null;
  custodyActorId: string | null;
  custodyLocationId: string | null;
  custodyMode: string;
  quantity: number;
  signatures: string[];
  seals: string[];
  routes: string[];
  claimIds: string[];
  knownBySeatIds: string[];
  visibility: PressureVisibility;
  acquiredInNodeId: string | null;
  acquiredByActionId: string | null;
  lastMutationActionId: string | null;
};

export type PressureRuntimeSeatState = {
  seatId: string;
  roleKey: string;
  currentActorId: string;
  controlEpoch: number;
  energy: number;
  initiativeLost: boolean;
  permissions: string[];
  knownFactIds: string[];
  knownObjectVersionIds: string[];
  resourceBalances: Record<string, number>;
  reactionUsedAtNodeId: string | null;
};

export type PressureKnowledgeRecord = {
  factId: string;
  provenance: PressureKnowledgeProvenance;
  knownBySeatIds: string[];
  claimId: string | null;
  objectId: string | null;
  objectVersionId: string | null;
  sourceActionIds: string[];
};

export type PressureRootEvent = {
  eventId: string;
  runId: string;
  sequence: number;
  nodeId: string;
  phase: PressureRuntimePhase;
  type: PressureRootEventType;
  visibility: PressureVisibility;
  audienceSeatIds: string[];
  sourceActionIds: string[];
  payload: Record<string, unknown>;
  dedupeKey: string;
  createdAt: string;
};

export type PressureResourceCost = { resourceId: string; amount: number };

export type PressureActionPreview = {
  accepted: boolean;
  errorCode: PressureKernelErrorCode | null;
  safeMessage: string;
  actionFingerprint: string;
  previewToken: string;
  normalizedIntent: PressureActionIntentCommandV1;
};

export type PressureActionResolution = {
  actionId: string;
  status: "APPLIED" | "PARTIAL" | "REJECTED";
  reasonCode: string;
  worldTimeDeltaMinutes: number;
  pressureDelta: number;
  objectVersionIds: string[];
  resourceLedgerEntries: PressureResourceLedgerEntry[];
  selectorPatch: Record<string, unknown>;
  responsibilityEntryIds: string[];
  knowledgeDeltaIds: string[];
};

export type PressureSealedAction = {
  command: PressureCompiledActionCommand;
  sealedAt: string;
  status: PressureActionStatus;
  snapshotHash: string;
  resolvedAt: string | null;
  resolution: PressureActionResolution | null;
};

export type PressureResourceLedgerEntry = {
  entryId: string;
  seatId: string;
  resourceId: string;
  delta: number;
  balanceAfter: number;
  actionId: string;
  status: "APPLIED" | "REJECTED";
};

export type PressureKnowledgeDelta = {
  deltaId: string;
  factId: string;
  grantedToSeatIds: string[];
  revokedFromSeatIds: string[];
  sourceActionIds: string[];
};

export type PressureResponsibilityEntry = {
  responsibilityId: string;
  seatId: string;
  kind: string;
  weight: number;
  sourceActionId: string;
};

export type PressureFrozenObjectOutcome = PressureContentObjectOutcome & {
  custodySeatId: string | null;
  custodyActorId: string | null;
  sourceActionIds: string[];
};

export type FrozenNodeResultV1 = {
  schemaVersion: "pressure_frozen_node_result_v1";
  frozenResultId: string;
  runId: string;
  nodeId: string;
  packageSha256: string;
  runSeed: string;
  inputSnapshotHash: string;
  sealedActionIds: string[];
  rulesInputHash: string;
  branchId: string;
  branchLevel: PressureBranchLevel;
  selectorInputs: Record<string, unknown>;
  frozenFactIds: string[];
  objectOutcomes: PressureFrozenObjectOutcome[];
  knowledgeDeltas: PressureKnowledgeDelta[];
  responsibilityAndEvidenceFreeze: string[];
  trackDeltas: Record<string, number>;
  carryForward: string[];
  openingProjectionRef: string | null;
  worldTimeAfter: number;
  pressureAfter: number;
  eventSequenceFrom: number;
  eventSequenceTo: number;
  contentHash: string;
  frozenAt: string;
};

export type PressureOpeningProjection = {
  schemaVersion: "pressure_opening_projection_v1";
  projectionId: string;
  runId: string;
  nodeId: string;
  predecessorFrozenResultId: string;
  viewerSeatId: string | null;
  publicFactIds: string[];
  privateFactIds: string[];
  objectVersionIds: string[];
  currentActorId: string | null;
  contentHash: string;
};

export type PressureFinaleInput = {
  schemaVersion: "pressure_finale_input_v1";
  runId: string;
  packageSha256: string;
  frozenResultIds: string[];
  fiveTrackState: Record<string, number>;
  responsibilityEntryIds: string[];
  objectVersionIds: string[];
  contentHash: string;
};

export type PressureFinaleResultV1 = {
  schemaVersion: "pressure_finale_result_v1";
  worldOutcomeId: "EAST_SOUTH_COLLAPSE" | "TRUTH_WITH_POLITICAL_SHOCK" | "BALANCED_SURVIVAL" | "FISCAL_ORDER_AT_CIVIL_COST" | "CIVIL_RELIEF_AT_WAR_COST" | "SCAPEGOAT_STABILITY" | "UNRESOLVED_COMPROMISE";
  trackBands: Array<{ trackId: string; value: number; band: "HIGH" | "MID" | "LOW" }>;
  seatVerdicts: Array<{ seatId: string; verdict: "WIN" | "COSTLY_WIN" | "LOSS"; score: number }>;
  causes: Array<{ nodeId: string; branchId: string; branchLevel: PressureBranchLevel; frozenResultId: string }>;
  inputFrozenResultIds: string[];
  contentHash: string;
  frozenAt: string;
};

export type PressureReactionWindowState = {
  nodeId: string;
  openedAtEpochMs: number;
  closesAtEpochMs: number;
  eligibleSeatIds: string[];
  allowedActionTypes: PressureWorldActionType[];
  usedSeatIds: string[];
  resealUsed: boolean;
} | null;

export type PressureRuntimeState = {
  schemaVersion: "pressure_runtime_state_v1";
  runId: string;
  runSeed: string;
  startedAtEpochMs: number;
  runtimeProfile: string;
  strategyVersion: string;
  packageSha256: string;
  contentTreeSha256: string;
  phase: PressureRuntimePhase;
  resumePhase: PressureResumePhase | null;
  nodeId: string;
  nodeSequence: number;
  version: number;
  phaseSnapshotVersion: number;
  worldTimeMinutes: number;
  pressureLevel: number;
  phaseDeadlineEpochMs: number | null;
  inputSnapshotHash: string;
  prepareRulesInputHash: string | null;
  commitSnapshotHash: string | null;
  commitRulesInputHash: string | null;
  selectorState: Record<string, unknown>;
  seats: Record<string, PressureRuntimeSeatState>;
  objects: Record<string, PressureRuntimeObjectState>;
  knowledge: Record<string, PressureKnowledgeRecord>;
  claims: Record<string, { status: string; knownBySeatIds: string[]; sourceActionIds: string[] }>;
  responsibilities: PressureResponsibilityEntry[];
  tracks: Record<string, number>;
  sealedActions: Record<string, PressureSealedAction>;
  actionIdBySeatSlot: Record<string, string>;
  idempotencyResults: Record<string, {
    payloadHash: string;
    actionId: string;
    previewToken: string;
    resultHash: string;
  }>;
  resourceReservations: Record<string, Record<string, number>>;
  resourceLedger: PressureResourceLedgerEntry[];
  knowledgeDeltas: PressureKnowledgeDelta[];
  rootEvents: PressureRootEvent[];
  frozenResults: FrozenNodeResultV1[];
  projectionInputs: Record<string, {
    frozenResultId: string;
    frozenContentHash: string;
    projectionBatchHash: string | null;
    projected: boolean;
  }>;
  projections: Record<string, PressureOpeningProjection>;
  reactionWindow: PressureReactionWindowState;
  checkpoints: Record<string, { checkpointKey: string; inputHash: string; outputHash: string; completedAt: string }>;
  finaleInput: PressureFinaleInput | null;
  finaleResult: PressureFinaleResultV1 | null;
  failure: null | { code: string; message: string; failedAt: string; resumePhase: PressureResumePhase };
};

export type PressureRunInitialization = {
  runId: string;
  runSeed: string;
  startedAtEpochMs: number;
  initialResourceBalance?: number;
};

export type PressureConfirmResult = {
  state: PressureRuntimeState;
  sealedAction: PressureSealedAction;
  replayed: boolean;
};

export type PressureProjectionResult = {
  state: PressureRuntimeState;
  projections: PressureOpeningProjection[];
};

export type PressureSettlementResult = {
  state: PressureRuntimeState;
  frozenResult: FrozenNodeResultV1;
  actionResolutions: PressureActionResolution[];
};

export type PressureMutationResult<T = unknown> = {
  state: PressureRuntimeState;
  value: T;
  replayed: boolean;
};
