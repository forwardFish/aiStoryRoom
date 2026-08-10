export const OPENOVEL_RUNTIME_MODE = "OPENOVEL_V1" as const;

export type SoloRuntimeMode = "LEGACY_DETERMINISTIC" | typeof OPENOVEL_RUNTIME_MODE;

export type ModelMessage = {
  role: "system" | "user";
  content: string;
};

export type ProviderUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ProviderResult = {
  text: string;
  model: string;
  requestId?: string;
  finishReason?: string;
  usage: ProviderUsage;
  latencyMs: number;
};

export type ProviderRequest = {
  profile: "narrator" | "reviewer" | "options" | "storykeeper";
  messages: ModelMessage[];
  temperature: number;
  maxTokens: number;
  json: boolean;
  jsonSchema?: {
    name: string;
    schema: Record<string, unknown>;
  };
  stream: boolean;
  timeoutMs?: number;
  onDelta?: (text: string) => void;
};

export interface OpenNovelProvider {
  generate(request: ProviderRequest): Promise<ProviderResult>;
  describe(): { provider: string; model: string; configured: boolean };
}

export type NarratorSceneProjection = {
  sceneRef?: string;
  timeLabel: string;
  locationLabel: string;
  situation?: string;
  presentActors: Array<{
    actorRef: string;
    displayName: string;
  }>;
  /** Player-visible facts settled for the current scene. */
  observableFacts: string[];
  /**
   * Closed inventory of durable documents and evidence-bearing objects in the
   * current scene. Ordinary paper, ink, furniture and other narrative texture
   * are intentionally outside this inventory.
   */
  keyEntityInventoryIsExhaustive: true;
  documents: Array<{
    label: string;
    accessState: "NOT_PRESENT" | "SEALED" | "OPENED" | "READ" | "WRITTEN";
    holderLabel?: string;
  }>;
  objects: Array<{
    label: string;
    holderLabel?: string;
    contentsState?: "EMPTY" | "UNKNOWN" | "CONTAINS_DOCUMENT";
    closureState?: "CLOSED" | "OPEN" | "UNKNOWN";
  }>;
};

export type PlayerVisibleFallbackSurface = {
  PLAYER_RESULT: string;
  IMMEDIATE_REACTION?: string;
  SCENE_TRANSITION?: string;
  WORLD_PRESSURE: string;
  DECISION_STOP: string;
};

export type ModelCallStage = ProviderRequest["profile"]
  | "coverage-reviewer"
  | "p0-reviewer";

export type OpenNovelOptionEffect = {
  /**
   * Stable server-owned decision point answered by this option. The latest
   * canonical scene stop and every published option must share this ID.
   */
  decisionPointId?: string;
  intent?: string;
  consequence?: string;
  beatContract?: {
    sourceRef?: string;
    objective: string;
    moves: string[];
    requiredAnchorGroups: string[][];
    requiredDurableAnchorGroups?: string[][];
    authorizedPlayerActions?: string[];
    constraints?: string[];
    settledNarrative?: string;
    /**
     * World-agnostic ownership for the already-settled player result.
     * Regular turns let the Narrator express it; only author-reviewed,
     * high-risk actions should request a protected visible surface.
     */
    playerResultExpressionOwner?: "NARRATOR" | "PROTECTED";
    fallbackContinuation?: string;
    playerVisibleFallback?: PlayerVisibleFallbackSurface;
    /**
     * Player-safe scene projection produced from the same settled revision as
     * this beat. It replaces any lagging Storykeeper Scene/Active Characters
     * sections before Narrator runs; IDs remain audit-only and are never
     * rendered into the prompt.
     */
    sceneProjection?: NarratorSceneProjection;
    narrativeSeed?: {
      playerOutcome: string;
      /**
       * Server-authored scene actions that occur after the protected player
       * outcome and before the next decision point. The Narrator renders these
       * moves in order; it does not choose a different continuation.
       */
      continuationMoves?: string[];
      /** Stable authoritative event IDs selected for this foreground beat. */
      sourceEventIds?: string[];
      /** Authoritative events retained backstage for later turns. */
      deferredEventIds?: string[];
      npcOrWorldPressure: string;
      stopCondition: string;
    };
    /**
     * Author-owned continuation plan. This is separate from `moves`, which may
     * also describe the already-protected player action for audit purposes.
     */
    continuationMoves?: string[];
    sceneEvidence?: {
      packetId: string;
      evidenceItems: Array<{
        evidenceId: string;
        evidenceClass: string;
        statement: string;
        sourceClaimIds: string[];
        adaptationDecisionIds: string[];
        useAs: string;
      }>;
      unresolvedFacts: string[];
      specificityBoundary: string;
    };
    stopCondition: string;
  };
  knowledgeBoundary?: {
    sourceRef?: string;
    allowed: string[];
    forbidden: string[];
    subjects?: string[];
  };
  stateHints?: Array<{
    key: string;
    op: "set" | "inc" | "dec" | "flag";
    value: unknown;
    note?: string;
    presentThisTurn?: boolean;
    surfaceAnchor?: string;
  }>;
  risk?: "low" | "medium" | "high";
  difficulty?: string;
  reversible?: boolean;
};

export type OpenNovelOption = {
  id: string;
  label: string;
  key?: boolean;
  effect?: OpenNovelOptionEffect;
};

export type BoundOption = {
  id: string;
  label: string;
};

export type CausalDelta = {
  turnId: string;
  source: "bound-option" | "free-text";
  readerAction: string;
  immediateIntent: string;
  protagonistScope: "inquiry-only" | "observation-only" | "bounded-action";
  stopCondition: string;
  allowedKnowledge: string[];
  forbiddenKnowledge: string[];
  knowledgeBoundaryRef?: string;
  evidenceSubjects: string[];
  scenePacket: {
    packetId: string;
    sourceRefs: string[];
    sourceEventIds: string[];
    deferredEventIds: string[];
    presentBeatMoves: string[];
    stopCondition: string;
    visibleFacts: string[];
    dramaticMechanisms: string[];
    approvedAdaptations: string[];
    allowedKnowledge: string[];
    forbiddenKnowledge: string[];
    unresolvedFacts: string[];
    specificityBoundary: string;
    relevantSubjects: string[];
  } | null;
  beatContract: NonNullable<OpenNovelOptionEffect["beatContract"]> | null;
  durableHints: NonNullable<OpenNovelOptionEffect["stateHints"]>;
  requiredNarrativeFacts: string[];
};

export type RunMetadata = {
  runId: string;
  worldId: string;
  roleId: string;
  runtimeMode: typeof OPENOVEL_RUNTIME_MODE;
  storyPackageVersion: string;
  openingVersion: string;
  upstreamCommit: string;
  packageVersion: string;
  createdAt: string;
  updatedAt: string;
  turnNumber: number;
  status: "READY" | "FOREGROUND_RUNNING" | "COMMITTING" | "COMPLETED" | "FAILED";
  lastError?: string;
};

export type SceneEvent = {
  id: string;
  at: string;
  type: string;
  turnId?: string;
  [key: string]: unknown;
};

export type StorySnapshot = {
  metadata: RunMetadata;
  brief: string;
  directorArc: string;
  foregroundGuidance: string;
  durableMemory: string;
  storyMemory: string;
  chapters: string;
  contextChapters: string;
  contextRecentCanon: string;
  recentCanon: string;
  previousOptions: OpenNovelOption[];
  optionsGuidance: string;
};

export type CompiledForegroundContext = {
  foregroundGuidance: string;
  durableMemory: string;
  storyMemory: string;
  recentCanonExcerpt: string;
  report: {
    usedChars: number;
    budgets: Record<string, number>;
    truncated: string[];
    removedPlayerDirectiveClauses: number;
    deduplicatedContextCardSections: number;
  };
};

export type RuntimeWarning = {
  code: string;
  message: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  blocksPlayer: boolean;
  details?: Record<string, string>;
};

export type TurnResult = {
  runId: string;
  turnId: string;
  turnNumber: number;
  narration: string;
  options: OpenNovelOption[];
  framing: string;
  tension: string;
  storyComplete: boolean;
  ending?: EndingPresentation;
  causalDelta: CausalDelta;
  warnings: RuntimeWarning[];
  narrator: ProviderResult;
  optionsProvider?: ProviderResult;
  committedAt: string;
};

export type EndingPresentation = {
  schemaVersion: "openovel_ending_v1";
  scope: "STORY" | "PART";
  endingKey: string;
  title: string;
  finalSceneNarrative: string;
  protagonistFate: string;
  aftermath: string[];
  sourceTurnId: string;
  sourceRevision: number;
  /**
   * Player-safe generic presentation compiled from the same authoritative
   * terminal revision. Older runs may omit it and continue through the
   * legacy result projection.
   */
  genericEndgame?: unknown;
};

export type TurnEvent =
  | { type: "narration.delta"; data: { text: string } }
  | { type: "narration.complete"; data: { narration: string } }
  | { type: "options.complete"; data: { options: OpenNovelOption[]; framing: string; error?: string } }
  | { type: "runtime.warning"; data: RuntimeWarning }
  | { type: "turn.committed"; data: TurnResult };

export type MirrorEvent = {
  kind: "run.created" | "turn.committed" | "runtime.warning";
  runId: string;
  payload: unknown;
};

export type MirrorEnvelope = MirrorEvent & {
  id: string;
  createdAt: string;
};

export interface EventMirror {
  readonly configured?: boolean;
  publish(event: MirrorEvent): Promise<void>;
}

export type StorykeeperInboxItem = {
  id: string;
  turnId: string;
  narrativeOwner?: "COMPOSED" | "NARRATOR" | "FALLBACK" | "PROTECTED_RENDERER";
  action: string;
  narration: string;
  publishedNarration?: string;
  shadowClaims?: unknown[];
  recentCanonBefore?: string;
  selectedEffect: OpenNovelOptionEffect | null;
  causalDelta?: CausalDelta;
  warnings?: RuntimeWarning[];
  createdAt: string;
};
