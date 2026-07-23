export type PartOneRuleOperator = "EQ" | "NEQ" | "IN" | "NOT_NULL" | "ANY_PENDING";

export type PartOneStateRule = {
  ruleId: string;
  statePath: string;
  operator: PartOneRuleOperator;
  expectedValue: unknown;
  description: string;
};

export type PartOneSectionContract = {
  schemaVersion: "section-contract-v1";
  sectionId: string;
  partId: "PART-01";
  title: string;
  dramaticPurpose: string;
  targetTurnWindow: { earliest: number; latest: number };
  entryRequirements: PartOneStateRule[];
  requiredRequirementIds: string[];
  activeDecisionKernelIds: string[];
  activeCausalArcIds: string[];
  foregroundActorRefs: string[];
  mustEstablish: PartOneStateRule[];
  requiredMaterialChangeClasses: string[];
  forbiddenEarlyReveals: string[];
  allowedNextSectionIds: string[];
  exitGates: PartOneStateRule[];
  floorObligationIds: string[];
  handoffStatePaths: string[];
};

export type PartOnePendingConsequenceState = {
  consequenceId: string;
  causedByEventId: string;
  ruleAssetId: string;
  summary: string;
  payoffBeat: PartOneConsequencePayoffBeat;
  dueTurn: number;
  priority: "P0" | "P1";
  status: "PENDING" | "DUE" | "PAID" | "DEFERRED_WITH_REASON" | "TRANSFORMED";
};

export type PartOneSceneState = {
  sceneId: string;
  timeLabel: string;
  locationLabel: string;
  presentActorRefs: string[];
  situation: string;
  documentStates?: PartOneSceneDocumentState[];
  objectStates?: PartOneSceneObjectState[];
};

export type PartOneSceneDocumentState = {
  documentRef: string;
  label: string;
  accessState: "NOT_PRESENT" | "SEALED" | "OPENED" | "READ" | "WRITTEN";
  holderRef: string | null;
  continuityNote: string;
};

export type PartOneSceneObjectState = {
  objectRef: string;
  label: string;
  holderRef: string | null;
  contentsState?: "EMPTY" | "UNKNOWN" | "CONTAINS_DOCUMENT";
  closureState?: "CLOSED" | "OPEN" | "UNKNOWN";
  continuityNote: string;
};

export type PartOneConsequencePayoffBeat = {
  beatId: string;
  consequenceId?: string;
  actorRefs: string[];
  action: string;
  requiredTermGroups: string[][];
  resultCeiling: string;
};

export type PartOneAuthoritativeWorldMove = {
  beatId: string;
  sourceType: "DUE_CONSEQUENCE" | "NEXT_DECISION_PRESSURE" | "SECTION_TRANSITION";
  sourceId: string;
  actorRefs: string[];
  action: string;
  requiredTermGroups: string[][];
  resultCeiling: string;
  consequenceId?: string;
};

export type PartOneNarrativePlan = {
  sceneStart: PartOneSceneState;
  sceneEnd: PartOneSceneState;
  presentActorLabels: string[];
  sceneStartActorLabels: string[];
  sceneEndActorLabels: string[];
  transitionAllowed: boolean;
  authorizedActorArrivals: string[];
  authorizedActorDepartures: string[];
  dramaticTask: string;
  actionAlreadyOccurred: string;
  authorizedPlayerSpeech: string[];
  confirmedEffects: string[];
  unresolvedFacts: string[];
  npcAgenda: string[];
  sceneBlocking: string[];
  sceneBeats: Array<{
    beatId: string;
    sourceType: "PLAYER_ACTION" | "CONFIRMED_EFFECT" | "NPC_REACTION" | "WORLD_MOVE";
    action: string;
    requiredTermGroups: string[][];
    resultCeiling?: string;
    mustAppear: boolean;
  }>;
  requiredEndChange: string;
  narrativeCeiling: string[];
};

export type PartOneKnowledgeTransfer = {
  transferId: string;
  topic: string;
  senderRef: string;
  recipientRef: string;
  representativeRef?: string;
  deliveryMode?: "DIRECT" | "IN_PERSON_REPRESENTATIVE" | "COURIER";
  causedByEventId: string;
  status: "SENT" | "DELIVERED" | "BLOCKED";
};

export type PartOneState = {
  partId: "PART-01";
  sectionId: string;
  turnNumber: number;
  scene: PartOneSceneState;
  reform: { executionMode: string; scopeStatus: string; progress: string };
  review: { initiationStatus: string; authority: string; procedureStatus: string };
  evidence: { chainStatus: string; primaryCustodianRef: string | null; copyStatus: string; archiveSealStatus: string };
  witness: { accessStatus: string };
  grain: { immediatePressure: string; officialStockStatus: string; reliefChannel: string };
  merchant: { entryStatus: string; grantedRights: string[] };
  land: { riskLevel: string; safeguardStatus: string };
  report: { authorshipMode: string; firstNarrativeController: string; attachmentStrength: string; dispatchStatus: string };
  responsibility: { firstRecordStatus: string; governorExposure: number; xunfuExposure: number };
  relations: { governorXunfu: number };
  knowledgeTransfers: PartOneKnowledgeTransfer[];
  pendingConsequences: PartOnePendingConsequenceState[];
  completedKernelIds?: string[];
  sectionTurnNumber?: number;
  causalArcStages?: Record<string, string>;
  lastCommittedEventId?: string | null;
  partCompletionStatus?: "IN_PROGRESS" | "HANDOFF_READY";
  [key: string]: unknown;
};

export type PartOneAffordanceTemplate = {
  affordanceTemplateId: string;
  title: string;
  actionText: string;
  targetRef: string;
  method: string;
  immediateIntent: string;
  visibleTradeoff: string;
  stateEffects: string[];
  statePatch?: Record<string, unknown>;
  createsPendingConsequence: boolean;
};

export type PartOneContinuationDecisionTemplate = {
  continuationDecisionId: string;
  basedOnDecisionKernelId: string;
  worldPressure: {
    pressureId: string;
    summary: string;
    sourceFloorAssetId: string;
  };
  options: PartOneAffordanceTemplate[];
};

export type PartOneRuntimeAsset = {
  schemaVersion: "runtime-story-asset-v1";
  assetId: string;
  assetType: string;
  partIds: string[];
  sectionIds: string[];
  requirementIds: string[];
  decisionKernelIds: string[];
  causalArcIds: string[];
  actorRefs: string[];
  stateDependencies: string[];
  visibilityRules: Array<{ visibilityClass: string; rule: string }>;
  sourceClaimIds: string[];
  adaptationDecisionIds: string[];
  retrievalTags: string[];
  payload: Record<string, unknown> & {
    options?: PartOneAffordanceTemplate[];
    continuationDecisions?: PartOneContinuationDecisionTemplate[];
    payoffBeats?: Array<Omit<PartOneConsequencePayoffBeat, "consequenceId">>;
    exitGateRules?: PartOneStateRule[];
    targetTurnWindow?: { earliest: number; latest: number };
  };
};

export type PartOneRuntimeIndex = {
  schemaVersion: "runtime-story-index-v1";
  byPart: Record<string, string[]>;
  bySection: Record<string, string[]>;
  byRequirement: Record<string, string[]>;
  byDecisionKernel: Record<string, string[]>;
  byCausalArc: Record<string, string[]>;
  byActor: Record<string, string[]>;
  byLocation: Record<string, string[]>;
  byStateDependency: Record<string, string[]>;
  byRetrievalTag: Record<string, string[]>;
  byVisibilityClass: Record<string, string[]>;
};

export type PartOneNarrativeStyleProfile = {
  schemaVersion: "narrative-style-profile-v1";
  profileId: string;
  version: string;
  pointOfView: string;
  registerRules: string[];
  sceneConstructionRules: string[];
  characterVoiceAnchors: Record<string, string[]>;
  dialogueAndSubtextRules: string[];
  terminologyRules: string[];
  forbiddenModernPhrases: string[];
  forbiddenSystemPhrases: string[];
  forbiddenAiSummaryPatterns: string[];
  narrativeBudget: { minCharacters: number; maxCharacters: number };
  reviewerId: string;
  approvedAt: string;
};

export type PartOneRuntimePackage = {
  schemaVersion: "sangtian-part-one-runtime-package-v1";
  worldId: "sangtian";
  partId: "PART-01";
  perspectiveRoleKey: "zhejiang_governor";
  authoringReleaseVersion: string;
  authoringManifestHash: string;
  authoringManifest: Record<string, unknown> & { immutableHash: string; assetCount: number; decisionKernelCount: number; causalArcCount: number; floorObligationCount: number; requirementCount: number; narrativeScenePatternCount: number };
  evidenceReleaseId: string;
  contentCounts: {
    assets: number;
    requirements: number;
    sections: number;
    decisionKernels: number;
    causalArcs: number;
    floorObligations: number;
    approvedAdaptations: number;
    narrativeScenePatterns: number;
  };
  worldStart: {
    schemaVersion: "sangtian-world-start-v1";
    worldId: "sangtian";
    partId: "PART-01";
    sectionId: string;
    perspectiveRoleKey: "zhejiang_governor";
    sourceTimelinePolicy: Record<string, string>;
    state: PartOneState;
  };
  sections: PartOneSectionContract[];
  requirements: Array<Record<string, unknown> & { requirementId: string; sectionIds: string[]; decisionKernelIds: string[]; runtimeAssetIds: string[] }>;
  approvedAdaptations: Array<Record<string, unknown> & { adaptationDecisionId: string; reviewStatus: string }>;
  styleProfile: PartOneNarrativeStyleProfile;
  assets: PartOneRuntimeAsset[];
  runtimeIndex: PartOneRuntimeIndex;
  immutableHash: string;
};

export type LoadedPartOneRuntimePackage = {
  package: PartOneRuntimePackage;
  contentHash: string;
  path: string;
};

export type PartOneRuntimeTarget = {
  type: "ROLE" | "PERSON" | "LOCATION" | "INSTITUTION" | "EVIDENCE" | "RESOURCE" | "PUBLIC_FRAME";
  id: string;
  label: string;
};

export type PartOneRuntimeAffordance = PartOneAffordanceTemplate & {
  decisionKernelId: string;
  target: PartOneRuntimeTarget;
};

export type PartOneCommittedEvent = {
  schemaVersion: "sangtian-part-one-event-v1";
  eventId: string;
  turnNumber: number;
  sectionIdBefore: string;
  sectionIdAfter: string;
  actionSource: string;
  decisionKernelId: string | null;
  affordanceTemplateId: string | null;
  actionText: string;
  targetRef: string;
  statePatch: Record<string, unknown>;
  changedStatePaths: string[];
  createdPendingConsequenceIds: string[];
  duePendingConsequenceIds: string[];
  authoritativeObservableFacts: string[];
  authoritativeNpcReactions: Array<{
    reactionEventId: string;
    actorRefs: string[];
    action: string;
    policyAssetId: string;
  }>;
  sceneBefore: PartOneSceneState;
  sceneAfter: PartOneSceneState;
  authoritativeWorldMoves: PartOneAuthoritativeWorldMove[];
  narrativePlan: PartOneNarrativePlan;
  sectionTransitioned: boolean;
};

export type PartOneActionSettlement = {
  beforeState: PartOneState;
  proposedState: PartOneState;
  event: PartOneCommittedEvent;
  appliedAffordance: PartOneRuntimeAffordance | null;
  dueConsequences: PartOnePendingConsequenceState[];
};

export type PartOneTurnProgressReport = {
  schemaVersion: "turn-progress-report-v1";
  runId: string;
  turnNumber: number;
  partId: "PART-01";
  sectionBefore: string;
  sectionAfter: string;
  playerActionId: string;
  consumedAffordanceId: string | null;
  materialChanges: Array<{
    statePath: string;
    before: unknown;
    after: unknown;
    sourceEventId: string;
  }>;
  npcReactionEventIds: string[];
  advancedRequirementIds: string[];
  advancedDecisionKernelIds: string[];
  causalArcTransitions: Array<{
    arcId: string;
    fromStage: string;
    toStage: string;
  }>;
  paidPendingConsequenceIds: string[];
  mainlineContributions: Array<
    "ADVANCE_GATE" | "ESCALATE_PRESSURE" | "REVEAL_EVIDENCE" |
    "CONTEST_EVIDENCE" | "PAY_CONSEQUENCE" | "TRANSFORM_ARC"
  >;
  sectionExitGateDelta: string[];
  hardValidationStatus: "PASS" | "FAIL";
  strength: "STRONG" | "BRIDGE" | "FAIL";
};

export type PartOneRuntimeWorkingSet = {
  packageHash: string;
  authoringManifestHash: string;
  partId: "PART-01";
  section: PartOneSectionContract;
  turnNumber: number;
  stateProjection: Record<string, unknown>;
  openDecisionKernel: PartOneRuntimeAsset;
  decisionAffordances: PartOneRuntimeAffordance[];
  activeCausalArcs: PartOneRuntimeAsset[];
  actorPolicies: PartOneRuntimeAsset[];
  institutionCapabilities: PartOneRuntimeAsset[];
  pendingConsequenceRules: PartOneRuntimeAsset[];
  floorObligations: PartOneRuntimeAsset[];
  narrativeScenePatterns: PartOneRuntimeAsset[];
  nextDecisionPressure: PartOneContinuationDecisionTemplate["worldPressure"] | null;
  styleProfile: PartOneNarrativeStyleProfile;
  forbiddenEarlyReveals: string[];
  retrievalTrace: {
    selectedAssetIds: string[];
    sectionId: string;
    decisionKernelId: string;
    continuationDecisionId: string | null;
    floorObligationId: string | null;
    stateDependencyPaths: string[];
  };
};
