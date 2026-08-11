import type {
  PressureActionIntentCommandV1,
  PressureActionSlot,
  PressureActionType,
  PressureKnowledgeProvenance,
  PressureResourceCommitmentV1,
  PressureVisibility,
  PressureWorldActionType,
} from "./types";

export type PressureObjectMutationOperation = "HOLD" | "TRANSFER" | "SEIZE" | "UPDATE" | "DESTROY";

export type PressureObjectMutationIntent = {
  objectId: string;
  expectedVersionId: string;
  operation: PressureObjectMutationOperation;
  toSeatId?: string | null;
  toActorId?: string | null;
  status?: string;
  visibility?: PressureVisibility;
  knownBySeatIds?: string[];
  signatures?: string[];
  seals?: string[];
  routes?: string[];
  claimIds?: string[];
};

export type PressureSelectorContribution = {
  key: string;
  operation: "ADD" | "MAX" | "MIN" | "SET" | "SET_TRUE" | "SET_FALSE";
  value: unknown;
};

export type PressureAuthorityGrant = {
  sourceId: string;
  sourceKind: "PERMISSION" | "CUSTODY";
  allowedActionTypes: PressureActionType[];
  allowedOperations: PressureObjectMutationOperation[];
  targetObjectIds: string[];
  targetObjectKinds: string[];
};

/** Internal, server-authored effect. Never accepted from API/client JSON. */
export type PressureActionEffect = {
  timeDeltaMinutes?: number;
  pressureDelta?: number;
  energyDelta?: number;
  initiativeLost?: boolean;
  selectorContributions?: PressureSelectorContribution[];
  objectMutations?: PressureObjectMutationIntent[];
  knowledgeGrants?: Array<{
    factId: string;
    seatIds: string[];
    provenance: PressureKnowledgeProvenance;
    claimId?: string | null;
    objectId?: string | null;
    objectVersionId?: string | null;
  }>;
  knowledgeRevokes?: Array<{ factId: string; seatIds: string[] }>;
  claimUpdates?: Array<{ claimId: string; status: string; knownBySeatIds: string[] }>;
  responsibilityEntries?: Array<{ responsibilityId: string; seatId: string; kind: string; weight: number }>;
  reactionSignal?: { triggered: boolean; evidenceIds: string[] };
  attemptOutcome?: "FAILED";
  attemptReasonCode?: "OUTCOME_OWNERSHIP" | "CAUSAL_PROCESS_REQUIRED" | "ROLE_FORBIDDEN";
  reseal?: boolean;
  authoredPolicyRef?: string | null;
};

export type PressureCompiledActionCommand = {
  schemaVersion: "pressure_compiled_action_v1";
  actionId: string;
  runId: string;
  nodeId: string;
  slot: PressureActionSlot;
  seatId: string;
  currentActorId: string;
  controlEpoch: number;
  type: PressureActionType;
  intentText: string;
  targetObjectId: string | null;
  expectedObjectVersionId: string | null;
  targetSeatId: string | null;
  resourceCosts: PressureResourceCommitmentV1[];
  visibility: PressureVisibility;
  submittedAtEpochMs: number;
  deadlineEpochMs: number;
  expectedRunVersion: number;
  expectedSnapshotHash: string;
  idempotencyKey: string;
  requestFingerprint: string;
  previewToken?: string;
  policyVersion?: string | null;
  effect: PressureActionEffect;
  authorityGrants: PressureAuthorityGrant[];
  knowledgeFactIds: string[];
  compiledRuleIds: string[];
  isDefault?: boolean;
  defaultPolicyId?: string | null;
  sourceIntent: PressureActionIntentCommandV1;
};

export type PressureCompiledActionPreview = {
  accepted: boolean;
  errorCode: import("./types").PressureKernelErrorCode | null;
  safeMessage: string;
  actionFingerprint: string;
  previewToken: string;
  normalizedIntent: PressureActionIntentCommandV1;
  compiled: PressureCompiledActionCommand;
};

export const INTERNAL_WORLD_ACTIONS = new Set<PressureWorldActionType>([
  "ALLOCATE",
  "SIGN",
  "TRANSFER",
  "SEIZE",
  "DISCLOSE",
  "DISPATCH",
]);
