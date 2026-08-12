export const PRESSURE_CHAPTER_IDS = [
  "N1",
  "N2",
  "N3",
  "N4",
  "N5",
  "N6",
  "N7",
] as const;

export type PressureChapterId = (typeof PRESSURE_CHAPTER_IDS)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type RequirementDependency = {
  dependencyId: string;
  predecessorRequirementId: string;
  successorRequirementId: string;
};

export type DecisionActivation = {
  allSatisfiedRequirementIds?: string[];
  noneSatisfiedRequirementIds?: string[];
  factEquals?: Record<string, JsonValue>;
  minimumCounters?: Record<string, number>;
};

export type DecisionPriority = {
  duePressureCount?: number;
  unmetExitGateCount?: number;
  unmetMustEstablishCount?: number;
  pendingPressureCount?: number;
  activeArcCount?: number;
  availablePressureActorCount?: number;
  recentRequirementContinuityCount?: number;
};

export type SettledReaction = {
  reactionId: string;
  sourceDecisionPointId: string;
  sourceOptionId: string;
  kind: string;
  summary: string;
  audience: "PUBLIC" | "RELATED" | "PRIVATE";
  causalFactIds: string[];
};

export type AuthoredWorkingDelta = {
  setFacts?: Record<string, JsonValue>;
  incrementCounters?: Record<string, number>;
  satisfyRequirementIds?: string[];
  reaction?: Omit<SettledReaction, "reactionId" | "sourceDecisionPointId" | "sourceOptionId">;
};

export type DecisionOptionDefinition = {
  optionId: string;
  sourceOrder: number;
  label: string;
  workingDelta: AuthoredWorkingDelta;
};

export type DecisionPointDefinition = {
  decisionPointId: string;
  kernelId: string;
  chapterId: PressureChapterId;
  sourceOrder: number;
  prompt: string;
  requirementIds: string[];
  activation?: DecisionActivation;
  priority?: DecisionPriority;
  options: DecisionOptionDefinition[];
};

export type PressureChapterDefinition = {
  schemaVersion: "pressure_chapter_definition_v1";
  chapterId: PressureChapterId;
  sequence: number;
  decisionPoints: DecisionPointDefinition[];
  requirementDependencies: RequirementDependency[];
};

export type ChapterWorkingState = {
  schemaVersion: "pressure_chapter_working_state_v1";
  runId: string;
  chapterId: PressureChapterId;
  revision: number;
  facts: Record<string, JsonValue>;
  counters: Record<string, number>;
  satisfiedRequirementIds: string[];
  completedDecisionPointIds: string[];
  settledReactions: SettledReaction[];
  lastBeatId: string | null;
};

export type DecisionEvaluation = {
  decisionPointId: string;
  kernelId: string;
  eligible: boolean;
  score: number;
  tieBreaker: string;
  reasonCodes: string[];
};

export type KernelSelectionTrace = {
  schemaVersion: "pressure_kernel_selection_trace_v1";
  selectorVersion: "pressure_kernel_selector_v1";
  stateRevision: number;
  stateFingerprint: string;
  selectedDecisionPointId: string | null;
  evaluations: DecisionEvaluation[];
};

export type ChapterWorkingSet = {
  schemaVersion: "pressure_chapter_working_set_v1";
  chapterId: PressureChapterId;
  stateRevision: number;
  stateFingerprint: string;
  decisionPoint: DecisionPointDefinition;
  optionIds: string[];
  selection: KernelSelectionTrace;
};

export type DecisionPin = {
  schemaVersion: "pressure_decision_pin_v1";
  chapterId: PressureChapterId;
  stateRevision: number;
  stateFingerprint: string;
  decisionPointId: string;
  kernelId: string;
  optionIds: string[];
};

export type WorkingDelta = {
  schemaVersion: "pressure_working_delta_v1";
  baseRevision: number;
  completeDecisionPointId: string;
  setFacts: Record<string, JsonValue>;
  incrementCounters: Record<string, number>;
  satisfyRequirementIds: string[];
  appendSettledReaction: SettledReaction | null;
};

/**
 * BeatResult intentionally owns only a WorkingDelta. Cross-chapter authority,
 * world sequence and Frozen state do not exist in this contract.
 */
export type BeatResult = {
  schemaVersion: "pressure_beat_result_v1";
  beatId: string;
  chapterId: PressureChapterId;
  decisionPointId: string;
  optionId: string;
  baseRevision: number;
  baseFingerprint: string;
  workingDelta: WorkingDelta;
  resultHash: string;
};

export type BeatCommand = {
  actionId: string;
  expectedRevision: number;
  expectedStateFingerprint: string;
  decisionPointId: string;
  optionId: string;
};

export type BeatTransition = {
  state: ChapterWorkingState;
  currentReaction: SettledReaction | null;
  nextWorkingSet: ChapterWorkingSet | null;
  nextDecisionPin: DecisionPin | null;
};
