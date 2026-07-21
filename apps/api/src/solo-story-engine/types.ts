import { sha256Canonical } from "../continuous-strategy/canonical";

export type IntentSource = "RECOMMENDED" | "TALK" | "INVESTIGATE" | "USE_LEVERAGE" | "CUSTOM";
export type GenerationTriggerType = "OPENING" | "PLAYER_ACTION";
export type ValidationDecision = "ACCEPT" | "ACCEPT_WITH_COST" | "REWRITE_NEEDED" | "REJECTED";
export type AttemptStatus =
  | "QUEUED"
  | "GENERATING"
  | "SUCCEEDED"
  | "FAILED_RETRYABLE"
  | "REJECTED"
  | "SUPERSEDED"
  | "PUBLISHED";

export type RecommendedActionInput = {
  source: "RECOMMENDED";
  decisionId: string;
  label: string;
  targetId: string;
  targetLabel: string;
  actionText: string;
};

export type TalkActionInput = {
  source: "TALK";
  personId: string;
  personName: string;
  prompt: string;
};

export type InvestigateActionInput = {
  source: "INVESTIGATE";
  locationId: string;
  locationName: string;
  task: string;
};

export type UseLeverageActionInput = {
  source: "USE_LEVERAGE";
  leverageKey: string;
  leverageLabel: string;
  targetId: string;
  targetLabel: string;
  task: string;
};

export type CustomActionInput = {
  source: "CUSTOM";
  text: string;
};

export type RawPlayerAction =
  | RecommendedActionInput
  | TalkActionInput
  | InvestigateActionInput
  | UseLeverageActionInput
  | CustomActionInput;

export type PlayerIntent = {
  source: IntentSource;
  targetId: string;
  targetLabel: string;
  objective: string;
  method: string;
  userFacingText: string;
  leverageKeys: string[];
  immutableIntentHash: string;
};

export type StoryRole = {
  roleId: string;
  roleName: string;
  identity: string;
  goal: string;
  permissions: string[];
  knownFactIds: string[];
  heldLeverageKeys: string[];
};

export type StoryFact = {
  factId: string;
  content: string;
  visibility: "PUBLIC" | "ROLE_PRIVATE";
  knownByRoleIds: string[];
  priority: "P0" | "P1" | "P2" | "P3";
};

export type PendingConsequence = {
  consequenceId: string;
  summary: string;
  priority: "P0" | "P1";
  dueLabel: string | null;
};

export type ActivePressure = {
  pressureId: string;
  summary: string;
  priority: "P0" | "P1" | "P2";
};

export type ScriptCard = {
  cardId: string;
  title: string;
  summary: string;
  tags: string[];
  priority: "P1" | "P2" | "P3";
  groundedFactIds: string[];
};

export type RecentCanonEntry = {
  entryId: string;
  narrative: string;
  chronologicalOrder: number;
};

export type StoryScene = {
  sceneId: string;
  title: string;
  timeLabel: string;
  locationLabel: string;
  situation: string;
  mainlineQuestion: string;
  mainlineQuestionIds: string[];
  directedBeat: DirectedBeat | null;
};

export type DirectedBeat = {
  beatId: string;
  summary: string;
};

export type ConfirmedResolution = {
  resolutionId: string;
  legality: "LEGAL";
  actionType: IntentSource | "OPENING";
  accepted: boolean;
  acceptedWithCost: boolean;
  actionStarted: string;
  immediateObservableResult: string[];
  summary: string;
  costSummary: string | null;
  consumedLeverageKeys: string[];
  pendingConsequences: PendingConsequence[];
  factsModelMayStateAsConfirmed: string[];
  factsStillUnknown: string[];
};

export type ValidationIssue = {
  code: string;
  message: string;
};

export type ValidationResult =
  | { ok: true; decision: "ACCEPT" | "ACCEPT_WITH_COST"; issues: ValidationIssue[] }
  | { ok: false; decision: "REWRITE_NEEDED" | "REJECTED"; issues: ValidationIssue[] };

export type ContextSourceItem = {
  itemId: string;
  priority: "P0" | "P1" | "P2" | "P3";
  section:
    | "ACTION_RESOLUTION"
    | "RECENT_CANON"
    | "CURRENT_SCENE"
    | "ROLE_KNOWLEDGE"
    | "RELEVANT_SCRIPT_CARDS"
    | "ACTIVE_PRESSURES"
    | "PENDING_CONSEQUENCE"
    | "THIS_TURN_DIRECTED_BEAT"
    | "PLAYER_ACTION";
  content: unknown;
  tokenEstimate: number;
  mustPreserve: boolean;
};

export type ContextSection<T> = { items: T[]; tokenEstimate: number };

export type CompiledStoryContext = {
  snapshotHash: string;
  triggerType: GenerationTriggerType;
  role: StoryRole;
  actionResolution: ConfirmedResolution;
  sections: {
    recentCanon: ContextSection<RecentCanonEntry>;
    currentScene: ContextSection<StoryScene>;
    roleKnowledge: ContextSection<StoryFact>;
    relevantScriptCards: ContextSection<ScriptCard>;
    activePressures: ContextSection<ActivePressure>;
    pendingConsequences: ContextSection<PendingConsequence>;
    directedBeat: ContextSection<DirectedBeat>;
  };
  included: ContextSourceItem[];
  dropped: Array<{ itemId: string; reason: "ACL_FILTERED" | "BUDGET_EXHAUSTED" | "P0_BUDGET_EXHAUSTED" }>;
  allowedReferences: {
    groundingIds: string[];
    scriptSourceIds: string[];
    storyCardIds: string[];
    canonFactIds: string[];
    mainlineQuestionIds: string[];
    entityRefs: string[];
    assetKeys: string[];
    pendingConsequenceIds: string[];
    directedBeatIds: string[];
  };
  availableTargets: StoryActionTarget[];
  renderedWorkingSet: string;
};

export type StoryActionTarget = {
  type: "ROLE" | "PERSON" | "LOCATION" | "INSTITUTION" | "EVIDENCE" | "RESOURCE" | "PUBLIC_FRAME";
  id: string;
  label: string;
};

export type ContextCompileInput = {
  role: StoryRole;
  scene: StoryScene;
  facts: StoryFact[];
  recentCanon: RecentCanonEntry[];
  pendingConsequences: PendingConsequence[];
  activePressures: ActivePressure[];
  relevantScriptCards: ScriptCard[];
  actionResolution: ConfirmedResolution;
  playerIntent: PlayerIntent | null;
  availableTargets: StoryActionTarget[];
  openingTrigger?: { triggerId: string; summary: string } | null;
  maxTokenEstimate: number;
};

export type ContextCompileResult =
  | { ok: true; context: CompiledStoryContext }
  | {
      ok: false;
      code: "P0_CONTEXT_BUDGET_EXCEEDED" | "CANON_STATE_CONFLICT";
      issues: ValidationIssue[];
      dropped: Array<{ itemId: string; reason: "ACL_FILTERED" | "BUDGET_EXHAUSTED" | "P0_BUDGET_EXHAUSTED" }>;
    };

export type StoryTurnPrompt = {
  systemPrompt: string;
  userPrompt: string;
  outputSchema: Record<string, unknown>;
};

export type StoryTurnTransportRequest = {
  attemptId: string;
  prompt: StoryTurnPrompt;
  context: CompiledStoryContext;
};

export type StoryTurnTransportResponse = {
  rawText: string;
  model: string;
  providerRequestId?: string;
  usage: { inputTokens: number; outputTokens: number };
};

export interface StoryTurnTransport {
  generate(request: StoryTurnTransportRequest): Promise<StoryTurnTransportResponse>;
}

export type StoryDecision = {
  decisionId: string;
  label: string;
  description: string;
  intent: string;
  targetRef: StoryActionTarget;
  method: string;
  leverageKeys: string[];
  visibility: "PRIVATE" | "LIMITED" | "OBSERVABLE" | "PUBLIC";
  riskTolerance: "LOW" | "MEDIUM" | "HIGH";
  distinctAxis: string;
  concreteCost: string;
  expectedCountermove: string;
  groundingIds: string[];
};

export type StoryTurnPublishedOutput = {
  schemaVersion: "solo-story-turn-v1";
  resultType: "PUBLISHED_TURN";
  story: {
    title: string;
    resultNarrative: string;
    nextSituationNarrative: string;
  };
  resolution: {
    confirmedResolutionId: string;
    outcome: "APPLIED" | "BLOCKED";
    observableOutcome: string;
  };
  endingState: {
    timeLabel: string;
    locationLabel: string;
    tension: string;
    presentEntityRefs: string[];
    visibleChanges: string[];
    surfacedConsequenceIds: string[];
  };
  decisions: StoryDecision[];
  grounding: {
    usedScriptSourceIds: string[];
    usedStoryCardIds: string[];
    usedCanonFactIds: string[];
    advancedMainlineQuestionIds: string[];
    paidPendingConsequenceIds: string[];
    stagedDirectedBeatId: string | null;
    deferredConsequences: Array<{ consequenceId: string; reason: string; nextDueLabel: string }>;
  };
};

export type StoryTurnClarificationOutput = {
  schemaVersion: "solo-story-turn-v1";
  resultType: "ACTION_NEEDS_CLARIFICATION";
  clarification: {
    reason: string;
    ambiguousFields: Array<"TARGET" | "METHOD" | "OBJECTIVE" | "LEVERAGE">;
    question: string;
  };
};

export type StoryTurnModelOutput = StoryTurnPublishedOutput | StoryTurnClarificationOutput;

export type StoryTurnValidatedOutput = StoryTurnModelOutput;

export type AttemptRecord = {
  attemptId: string;
  generationKey: string;
  providerCallCount: number;
  status: AttemptStatus;
  failureCode: string | null;
};

export type ExecuteSoloStoryTurnInput = {
  attemptId: string;
  role: StoryRole;
  scene: StoryScene;
  facts: StoryFact[];
  recentCanon: RecentCanonEntry[];
  pendingConsequences: PendingConsequence[];
  activePressures: ActivePressure[];
  relevantScriptCards: ScriptCard[];
  availableTargets: StoryActionTarget[];
  rawAction: RawPlayerAction;
  transport: StoryTurnTransport;
  /** Persist the unique provider-call reservation before network I/O. */
  onBeforeProviderCall?: () => Promise<void>;
  maxTokenEstimate?: number;
};

export type ExecuteSoloStoryOpeningInput = Omit<ExecuteSoloStoryTurnInput, "rawAction"> & {
  openingTrigger: { triggerId: string; summary: string };
};

export type ExecuteSoloStorySuccess<TIntent extends PlayerIntent | null> =
  | {
      ok: true;
      attempt: AttemptRecord;
      playerIntent: TIntent;
      actionResolution: ConfirmedResolution;
      context: CompiledStoryContext;
      prompt: StoryTurnPrompt;
      provider: StoryTurnTransportResponse;
      output: StoryTurnValidatedOutput;
    };

export type ExecuteSoloStoryFailure =
  | {
      ok: false;
      attempt: AttemptRecord;
      playerIntent: PlayerIntent | null;
      actionResolution?: ConfirmedResolution;
      context?: CompiledStoryContext;
      prompt?: StoryTurnPrompt;
      provider?: StoryTurnTransportResponse;
      issues: ValidationIssue[];
    };

export type ExecuteSoloStoryTurnResult = ExecuteSoloStorySuccess<PlayerIntent> | ExecuteSoloStoryFailure;
export type ExecuteSoloStoryOpeningResult = ExecuteSoloStorySuccess<null> | ExecuteSoloStoryFailure;

export function buildGenerationKey(input: {
  attemptId: string;
  playerIntentHash: string | null;
  contextSnapshotHash: string | null;
}) {
  return sha256Canonical(input);
}
