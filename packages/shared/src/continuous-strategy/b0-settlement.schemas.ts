export const b0SettlementModes = ["IMMEDIATE", "WINDOWED"] as const;
export type B0SettlementModeV1 = (typeof b0SettlementModes)[number];

export const b0WindowStatuses = [
  "OPEN",
  "LOCKED",
  "SETTLING",
  "COMMITTED",
  "PUBLISHING",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_HARD",
  "ABORTED",
] as const;
export type B0WindowStatusV1 = (typeof b0WindowStatuses)[number];

export const b0BatchStatuses = [
  "PREPARED",
  "RESOLVING",
  "RESOLVED",
  "COMMITTING",
  "COMMITTED",
  "PUBLISHED",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_HARD",
] as const;
export type B0BatchStatusV1 = (typeof b0BatchStatuses)[number];

export const b0IntentStatuses = ["DRAFT", "CONFIRMED", "LOCKED", "RESOLVED", "CANCELLED"] as const;
export type B0IntentStatusV1 = (typeof b0IntentStatuses)[number];

export const b0IntentKinds = ["OBSERVE", "INFLUENCE", "ACT", "HOLD"] as const;
export type B0IntentKindV1 = (typeof b0IntentKinds)[number];

export const b0IntentRelationTypes = ["SUPPORTS", "CONFLICTS", "INDEPENDENT"] as const;
export type B0IntentRelationTypeV1 = (typeof b0IntentRelationTypes)[number];

export const b0OutcomeStatuses = ["SUCCESS", "PARTIAL_SUCCESS", "CONTESTED", "BLOCKED", "FAILED"] as const;
export type B0OutcomeStatusV1 = (typeof b0OutcomeStatuses)[number];

export const b0ErrorCodes = [
  "ROOM_NOT_RUNNING",
  "WINDOW_NOT_FOUND",
  "WINDOW_NOT_OPEN",
  "WINDOW_ALREADY_LOCKED",
  "ACTOR_NOT_EXPECTED",
  "ACTOR_OWNERSHIP_MISMATCH",
  "INTENT_NOT_FOUND",
  "INTENT_SCHEMA_INVALID",
  "INTENT_UNKNOWN_FIELD",
  "INTENT_TARGET_NOT_FOUND",
  "INTENT_TARGET_NOT_ACCESSIBLE",
  "INTENT_KNOWLEDGE_VIOLATION",
  "INTENT_RESOURCE_INSUFFICIENT",
  "INTENT_CAPABILITY_UNAVAILABLE",
  "INTENT_EFFECT_UNSUPPORTED",
  "INTENT_STALE_REVISION",
  "INTENT_ALREADY_LOCKED",
  "INTENT_VALIDATION_FAILED",
  "READY_REQUIRES_CONFIRMED_OR_HOLD",
  "RUN_ID_MISMATCH",
  "WORLD_SEQUENCE_MISMATCH",
  "BATCH_ALREADY_COMMITTED",
  "BATCH_COMMIT_HASH_MISMATCH",
  "RESOLUTION_VALIDATION_FAILED",
  "AUDIENCE_RESOLUTION_FAILED",
  "NARRATIVE_VALIDATION_FAILED",
  "ROOM_RULESET_MISMATCH",
] as const;
export type B0ErrorCodeV1 = (typeof b0ErrorCodes)[number];

export type B0FeatureFlagsV1 = {
  windowedSettlementEnabled: boolean;
  structuredActionPreviewEnabled: boolean;
  typedAudienceV2Enabled: boolean;
  structuredResultEnabled: boolean;
  narrativeAsyncEnabled: boolean;
  reactionWindowEnabled: false;
  structuredCommitmentEnabled: false;
};

export type B0RoomRulesetV1 = {
  schemaVersion: "b0-room-ruleset-v1";
  rulesetVersion: string;
  settlementMode: B0SettlementModeV1;
  totalWindows: number;
  windowDurationSeconds: number;
  maxHumanPlayers: number;
  maxPrimaryIntentsPerActor: 1;
  readyPolicy: "ALL_READY_OR_DEADLINE";
  missingIntentPolicy: "LAST_CONFIRMED_OR_HOLD";
  supportedRelations: readonly ["SUPPORTS", "CONFLICTS", "INDEPENDENT"];
  reactionDepth: 0;
  playerAuthoredDelayedEffects: "DISABLED" | "NEXT_WINDOW_ONLY";
  structuredCommitmentsEnabled: false;
  allowMidGameJoin: false;
  allowRoleTransfer: false;
  allowHumanToAiTransfer: false;
  aiFillEnabled: true;
  structuredResultRequired: true;
  narrativeFailurePolicy: "CONTINUE_WITH_STRUCTURED_RESULT";
  featureFlags: B0FeatureFlagsV1;
};

export type B0SettlementWindowV1 = {
  schemaVersion: "b0-settlement-window-v1";
  id: string;
  roomId: string;
  runId: string;
  mode: B0SettlementModeV1;
  ordinal: number;
  situationId: string;
  baseWorldSequence: number;
  expectedActorIds: string[];
  readyActorIds: string[];
  openedAt: string;
  locksAt: string | null;
  lockedAt: string | null;
  committedAt: string | null;
  completedAt: string | null;
  status: B0WindowStatusV1;
  lockReason: "ALL_READY" | "DEADLINE" | "IMMEDIATE" | null;
  rulesetVersion: string;
  schemaRevision: 1;
};

export type B0TargetRefV1 = {
  type: "ACTOR" | "GROUP" | "LOCATION" | "RESOURCE" | "PROPOSITION" | "EVIDENCE" | "CAPABILITY";
  id: string;
};

export type B0EffectDirectionV1 =
  | "INCREASE"
  | "DECREASE"
  | "CREATE"
  | "BLOCK"
  | "PROTECT"
  | "REVEAL"
  | "CONCEAL"
  | "MOVE"
  | "TRANSFER"
  | "VERIFY";

export type B0ActionContractV1 = {
  schemaVersion: "b0-action-contract-v1";
  id: string;
  windowId: string;
  roomId: string;
  runId: string;
  actorId: string;
  baseWorldSequence: number;
  revision: number;
  kind: B0IntentKindV1;
  rawPlayerText: string;
  normalizedSummary: string;
  targetRefs: B0TargetRefV1[];
  primaryEffect: {
    effectTypeId: string;
    direction: B0EffectDirectionV1;
    requestedMagnitude: "MINOR" | "MODERATE" | "MAJOR";
  };
  method: { methodTypeId: string; description: string };
  resourceCommitments: Array<{ resourceId: string; amount: number }>;
  evidenceRefs: string[];
  capabilityRefs: string[];
  propositionRefs: string[];
  visibilityIntent: {
    type: "PUBLIC" | "PRIVATE" | "COVERT" | "CONDITIONAL";
    declaredRecipientRefs?: string[];
  };
  reactionPolicy: "NONE" | "IF_PUBLIC" | "IF_OBSERVED";
  requestedTiming: "CURRENT_WINDOW";
  riskTags: string[];
  compilerVersion: string;
  validationVersion: string;
  clientRequestId: string;
  status: B0IntentStatusV1;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  lockedAt: string | null;
};

export type B0SettlementSnapshotV1 = {
  schemaVersion: "b0-settlement-snapshot-v1";
  id: string;
  windowId: string;
  roomId: string;
  runId: string;
  baseWorldSequence: number;
  rulesetVersion: string;
  rulesetHash: string;
  worldState: unknown;
  actorStates: unknown[];
  roleBindings: unknown[];
  knowledgeState: unknown;
  relationshipState: unknown;
  resourceState: unknown;
  activeCapabilities: unknown[];
  dueSystemIntents: unknown[];
  worldStateHash: string;
  roleSetHash: string;
  knowledgeStateHash: string;
  relationshipStateHash: string;
  createdAt: string;
};

export type B0SettlementBatchV1 = {
  schemaVersion: "b0-settlement-batch-v1";
  id: string;
  windowId: string;
  snapshotId: string;
  roomId: string;
  runId: string;
  baseWorldSequence: number;
  lockedIntentIds: string[];
  dueSystemIntentIds: string[];
  status: B0BatchStatusV1;
  attempt: number;
  inputHash: string;
  relationGraphHash: string | null;
  resolutionHash: string | null;
  createdAt: string;
  resolvedAt: string | null;
  committedAt: string | null;
  completedAt: string | null;
};

export type B0IntentRelationV1 = {
  schemaVersion: "b0-intent-relation-v1";
  id: string;
  batchId: string;
  leftIntentId: string;
  rightIntentId: string;
  type: B0IntentRelationTypeV1;
  basis:
    | "TARGET_OVERLAP"
    | "PROPOSITION_OPPOSITION"
    | "RESOURCE_CONTENTION"
    | "LOCATION_CONTENTION"
    | "PROTECT_VS_HARM"
    | "REVEAL_VS_CONCEAL"
    | "CAPABILITY_RULE"
    | "WORLD_RULE"
    | "MODEL_ASSISTED";
  confidence: number;
  classifierVersion: string;
  evidenceRefs: string[];
};

export type B0TypedAudienceSpecV1 =
  | { type: "PUBLIC" }
  | { type: "ACTOR_ONLY"; actorRef: string }
  | { type: "DIRECT_TARGETS"; originIntentId: string }
  | { type: "OBSERVERS_OF_TRACE"; traceId: string }
  | { type: "RELATION_PARTICIPANTS"; relationId: string }
  | { type: "ROLE_SET"; roleSetId: string }
  | { type: "CONDITION_BASED"; conditionId: string };

export type B0StateMutationV1 = {
  mutationId: string;
  entityType: "ACTOR" | "LOCATION" | "DOCUMENT" | "EVIDENCE" | "INSTITUTION" | "RESOURCE" | "RELATION" | "WORLD";
  entityId: string;
  attribute: string;
  operation: "SET" | "INCREMENT" | "ADD" | "REMOVE";
  value: unknown;
  originIntentIds: string[];
};

export type B0IntentOutcomeV1 = {
  outcomeId: string;
  intentId: string;
  actorId: string;
  status: B0OutcomeStatusV1;
  summary: string;
  causalEdgeIds: string[];
};

export type B0CausalEdgeV1 = {
  schemaVersion: "b0-causal-edge-v1";
  id: string;
  batchId: string;
  from:
    | { type: "INTENT"; id: string }
    | { type: "RESOURCE"; id: string }
    | { type: "CAPABILITY"; id: string }
    | { type: "WORLD_FACT"; id: string }
    | { type: "RELATIONSHIP"; id: string }
    | { type: "SYSTEM_INTENT"; id: string };
  to:
    | { type: "INTENT_OUTCOME"; id: string }
    | { type: "WORLD_EVENT"; id: string }
    | { type: "TRACE"; id: string }
    | { type: "KNOWLEDGE_GRANT"; id: string }
    | { type: "MUTATION"; id: string };
  relation: "ENABLED" | "SUPPORTED" | "BLOCKED" | "WEAKENED" | "EXPOSED" | "CAUSED" | "LIMITED";
};

export type B0StructuredResultV1 = {
  resultId: string;
  resultKind: "PERSONAL_OUTCOME" | "CROSS_PLAYER_IMPACT" | "WORLD_EVENT" | "OBSERVABLE_TRACE" | "KNOWLEDGE_GRANT";
  originIntentIds: string[];
  originActorIds: string[];
  targetActorIds: string[];
  summary: string;
  durableMutationIds: string[];
  audience: B0TypedAudienceSpecV1;
};

export type B0SettlementResolutionV1 = {
  schemaVersion: "b0-settlement-resolution-v1";
  batchId: string;
  roomId: string;
  runId: string;
  windowId: string;
  baseWorldSequence: number;
  intentRelations: B0IntentRelationV1[];
  conflictGroups: Array<{ conflictGroupId: string; intentIds: string[] }>;
  intentOutcomes: B0IntentOutcomeV1[];
  worldDelta: { mutations: B0StateMutationV1[] };
  structuredResults: B0StructuredResultV1[];
  pendingEffects: Array<{ pendingEffectId: string; sourceIntentId: string; dueWindowOrdinal: number }>;
  causalEdges: B0CausalEdgeV1[];
  resolutionVersion: string;
  resolutionHash: string;
};
