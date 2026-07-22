export const CLAIM_TYPES = [
  "objective_event",
  "objective_state",
  "character_statement",
  "character_belief",
  "character_intention",
  "rumor",
  "document_claim",
  "narrator_inference",
  "analyst_inference",
  "unknown"
] as const;

export type ClaimType = (typeof CLAIM_TYPES)[number];
export type TruthStatus = "supported" | "unverified" | "contested" | "unknown";
export type RuntimeUse = "player_known" | "world_basis_only" | "forbidden_future";

export interface EvidenceSceneSeed {
  sceneId: string;
  chapterId: string;
  title: string;
  lineStart: number;
  lineEnd: number;
  timeLabel: string;
  locationLabels: string[];
  presentCharacterIds: string[];
}

export interface EvidenceClaimSeed {
  claimId: string;
  chapterId: string;
  sceneId: string;
  type: ClaimType;
  subjectId?: string;
  predicate: string;
  object?: unknown;
  speakerId?: string;
  content: string;
  truthStatus: TruthStatus;
  epistemicStatus: string;
  lineStart: number;
  lineEnd: number;
  knownByCharacterIds: string[];
  visibleToRoleIds: string[];
  runtimeUse: RuntimeUse;
  notes?: string;
}

export interface ContinuitySeed {
  chapterId: string;
  timeAnchor: string;
  activeLocations: string[];
  characterPositions: Array<{ characterId: string; locationId: string }>;
  objectHolders: Array<{ objectId: string; holderId: string }>;
  knownFactsByCharacter: Array<{ characterId: string; claimIds: string[] }>;
  openClaimIds: string[];
  unresolvedQuestions: string[];
  institutionalDecisions: string[];
  causalChanges: string[];
  nextChapterConstraints: string[];
}

export interface EvidenceAuthoring {
  schemaVersion: "evidence_authoring_v1";
  packageId: string;
  packageVersion: string;
  worldId: string;
  source: { path: string; sha256: string; expectedChapterCount: number };
  scenes: EvidenceSceneSeed[];
  claims: EvidenceClaimSeed[];
  continuity: ContinuitySeed[];
}

export interface ChapterIndexEntry {
  chapterId: string;
  ordinal: number;
  title: string;
  lineStart: number;
  lineEnd: number;
}

export interface EvidenceScene extends EvidenceSceneSeed {
  claimIds: string[];
  excerptSha256: string;
}

export interface EvidenceClaim extends Omit<EvidenceClaimSeed, "lineStart" | "lineEnd"> {
  evidence: {
    sourcePath: string;
    sourceSha256: string;
    chapterId: string;
    lineStart: number;
    lineEnd: number;
    excerptSha256: string;
  };
}

export interface EvidencePackage {
  manifest: EvidenceManifest;
  chapterIndex: ChapterIndexEntry[];
  scenes: EvidenceScene[];
  claims: EvidenceClaim[];
  continuity: ContinuitySeed[];
}

export interface EvidenceManifest {
  schemaVersion: "source_evidence_manifest_v1";
  packageId: string;
  packageVersion: string;
  worldId: string;
  compilerVersion: string;
  source: { path: string; sha256: string; lineCount: number; chapterCount: number };
  coverage: { chapterIds: string[]; sceneCount: number; claimCount: number };
  files: Record<string, string>;
}

export interface ValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  itemId?: string;
}

export interface ValidationReport {
  schemaVersion: "source_evidence_validation_v1";
  valid: boolean;
  packageId: string;
  sourceSha256: string;
  checked: Record<string, number | boolean>;
  issues: ValidationIssue[];
}

export type EvidenceReviewStatus = "PENDING" | "APPROVED" | "REJECTED";
export type EvidenceReviewItemKind = "SCENE" | "CLAIM" | "CONTINUITY";

export interface EvidenceReviewItem {
  itemId: string;
  itemKind: EvidenceReviewItemKind;
  sourceHash: string;
  status: EvidenceReviewStatus;
  reviewerId?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  note?: string;
}

export interface EvidenceReviewQueue {
  schemaVersion: "evidence_review_queue_v1";
  packageId: string;
  packageVersion: string;
  sourceSha256: string;
  updatedAt: string;
  items: EvidenceReviewItem[];
}

export interface EvidenceReviewReport {
  valid: boolean;
  approvalComplete: boolean;
  counts: Record<EvidenceReviewStatus, number>;
  issues: ValidationIssue[];
}

export type Priority = "P0" | "P1" | "P2" | "P3";

export interface WorldBibleRuntimeFact {
  factId: string;
  content: string;
  visibility: "PUBLIC" | "ROLE_PRIVATE";
  knownByRoleIds: string[];
  priority: Priority;
  origin: "T0_EVIDENCE" | "T2_DERIVED" | "T3_ADAPTATION";
  sourceClaimIds: string[];
}

export interface WorldBibleContextCard {
  cardId: string;
  title: string;
  summary: string;
  tags: string[];
  priority: Exclude<Priority, "P0">;
  groundedFactIds: string[];
  origin: "T0_EVIDENCE" | "T2_DERIVED" | "T3_ADAPTATION";
  sourceClaimIds: string[];
}

export interface WorldBibleAuthoring {
  schemaVersion: "world_bible_authoring_v1";
  worldId: string;
  evidencePackageId: string;
  version: string;
  startPoint: { startPointId: string; sourceCutoffChapterId: string };
  runtimeFacts: WorldBibleRuntimeFact[];
  contextCards: WorldBibleContextCard[];
}

export interface WorldBibleSourceMapEntry {
  targetType: "HISTORICAL_BASELINE" | "EPISTEMIC_RECORD" | "SOURCE_FUTURE" | "RUNTIME_FACT" | "CONTEXT_CARD";
  targetId: string;
  sourceClaimIds: string[];
  sourceHashes: string[];
}

export interface CompiledWorldBible {
  schemaVersion: "compiled_world_bible_v1";
  worldId: string;
  version: string;
  sourceEvidence: { packageId: string; packageVersion: string; sourceSha256: string };
  reviewGate: "APPROVED" | "PENDING" | "MISSING";
  shadowOnly: true;
  startPoint: { startPointId: string; sourceCutoffChapterId: string };
  historicalBaselineClaimIds: string[];
  epistemicClaimIds: string[];
  sourceFutureClaimIds: string[];
  entities: { characterIds: string[]; institutionIds: string[]; locationIds: string[]; objectIds: string[] };
  runtimeFacts: WorldBibleRuntimeFact[];
  contextCards: WorldBibleContextCard[];
  continuity: ContinuitySeed[];
  sourceMap: WorldBibleSourceMapEntry[];
  manifestHash: string;
}

export type ShadowStateLockValue = boolean | "unknown";

export type ShadowDecisionClass =
  | "authority"
  | "responsibility"
  | "evidence_control"
  | "scope_change"
  | "secrecy"
  | "negotiation";

export interface ShadowNarrativeBudget {
  kind: "short_confrontation" | "standard_scene" | "major_event" | "act_closure";
  minChars: number;
  maxChars: number;
  minParagraphs: number;
  maxParagraphs: number;
}

export interface ShadowWriterPlan {
  sceneStart: string;
  recentCanonBridge?: string[];
  sceneBlocking?: string[];
  sceneBeats?: string[];
  actionAlreadyOccurred?: string[];
  visibleRelationships?: string[];
  confirmedFacts: string[];
  unresolvedFacts: string[];
  semanticFactBoundary: string[];
  npcAgenda: {
    publicPosition: string;
    immediateGoal: string;
    leverage: string[];
  };
  dramaticTask: string;
  requiredEndChange: string;
  narrativeCeiling: string;
  decisionEntrances?: Array<{
    actionClass: ShadowDecisionClass;
    targetRefs: string[];
    situation: string;
    wordingFrame?: string;
  }>;
  relevantRuntimeFactIds: string[];
  relevantCardIds: string[];
}

export type CausalArcStage =
  | "DORMANT"
  | "OPEN"
  | "PRESSURED"
  | "ESCALATED"
  | "CRISIS"
  | "RESOLVED"
  | "FAILED"
  | "TRANSFORMED";

export type MaterialChangeCategory =
  | "worldStateChanged"
  | "relationshipChanged"
  | "knowledgeChanged"
  | "responsibilityChanged"
  | "resourceChanged"
  | "commitmentChanged"
  | "threadChanged"
  | "arcChanged"
  | "pendingConsequenceChanged";

export interface MaterialChangeReport extends Record<MaterialChangeCategory, boolean> {
  anyMaterialChange: boolean;
  sources: string[];
}

export interface ShadowCausalArcSeed {
  arcId: string;
  title: string;
  stage: CausalArcStage;
  state: Record<string, number | string | boolean>;
  activeActorRefs: string[];
  openThreadRefs: string[];
  lastMaterialChangeSequence: number;
  sourceClaimIds: string[];
}

export interface ShadowCausalEffectSeed {
  effectId: string;
  arcRef?: string;
  operation: "INC" | "DEC" | "SET" | "TRANSITION" | "ADD_THREAD" | "ADD_PENDING_CONSEQUENCE";
  stateKey?: string;
  value: number | string | boolean;
  category: MaterialChangeCategory;
  summary: string;
  writerVisibleSummary?: string;
}

export interface ShadowCausalRuleSeed {
  ruleId: string;
  when: {
    accepted?: boolean;
    targetId?: string;
  };
  effects: ShadowCausalEffectSeed[];
}

export interface ShadowNpcReactionSeed {
  npcRef: string;
  knownFacts: string[];
  unknownFacts: string[];
  activeGoals: Array<{ goal: string; weight: number }>;
  threatenedGoals: string[];
  usableLeverageRefs: string[];
  allowedTactics: string[];
  forbiddenOutcomes: string[];
  allowedEventTypes: string[];
  narrativeCeiling: string;
}

export interface ShadowAllowedEventSeed {
  eventType: string;
  status?: "RECORDED_NOT_ACCEPTED";
  actorRefs: string[];
  targetRefs: string[];
  tactic?: string;
  observableSummary: string;
  materialChangeCategories: MaterialChangeCategory[];
  narrativeEvidencePatterns: string[];
}

export interface ShadowDecisionAffordanceSeed {
  affordanceId: string;
  actionClass: ShadowDecisionClass;
  actorRef: string;
  targetRef: string;
  immediateGoal: string;
  requiredCapabilityRefs: string[];
  requiredResourceRefs: string[];
  allowedVisibility: string[];
  constraints: string[];
}

export interface ShadowCausalRuntimeSeed {
  sequence: number;
  arcs: ShadowCausalArcSeed[];
  rules: ShadowCausalRuleSeed[];
  npcReactions: ShadowNpcReactionSeed[];
  eventCatalog: ShadowAllowedEventSeed[];
  requiredEventTypes: string[];
  maxEventDrafts: number;
  allowedStatePaths: string[];
  forbiddenStatePaths: string[];
  decisionAffordances: ShadowDecisionAffordanceSeed[];
  stagnationHistory: {
    turnsWithoutMaterialChange: number;
    repeatedSceneKey?: string;
    repeatedActionClasses: ShadowDecisionClass[];
    consecutiveSameSceneDocumentTurns: number;
    pendingConsequencesDue: string[];
  };
}

export interface CompiledCausalEffect extends ShadowCausalEffectSeed {
  sourceRuleId: string;
}

export interface CompiledNpcReactionEnvelope extends ShadowNpcReactionSeed {
  triggeringActionId: string;
  observedPlayerIntent: string;
}

export interface CompiledAllowedEventEnvelope {
  allowedEventTypes: string[];
  requiredEventTypes: string[];
  allowedActorRefs: string[];
  allowedTargetRefs: string[];
  allowedTactics: string[];
  allowedThreadRefs: string[];
  allowedStatePaths: string[];
  forbiddenStatePaths: string[];
  maxEventDrafts: number;
  eventCatalog: ShadowAllowedEventSeed[];
}

export interface ArcStagnationReport {
  arcId: string;
  turnsWithoutMaterialChange: number;
  repeatedSceneKey?: string;
  repeatedActionClasses: ShadowDecisionClass[];
  pendingConsequencesDue: string[];
  shouldForceProgression: boolean;
  reason: string | null;
}

export interface CompiledCausalTurn {
  schemaVersion: "openovel_causal_turn_v1";
  actionId: string;
  sequence: number;
  arcsBefore: ShadowCausalArcSeed[];
  arcsAfter: ShadowCausalArcSeed[];
  appliedEffects: CompiledCausalEffect[];
  activePressureSummaries: string[];
  npcReactionEnvelopes: CompiledNpcReactionEnvelope[];
  allowedEventEnvelope: CompiledAllowedEventEnvelope;
  decisionAffordances: ShadowDecisionAffordanceSeed[];
  deterministicMaterialChange: MaterialChangeReport;
  stagnationReports: ArcStagnationReport[];
  snapshotHash: string;
  affordanceSnapshotHash: string;
  allowedEventEnvelopeHash: string;
}

export interface ShadowRuntimeFixture {
  schemaVersion: "openovel_shadow_fixture_v2";
  fixtureId: string;
  evidencePackageId: string;
  sourceCutoffChapterId: string;
  maxTokenEstimate: number;
  role: {
    roleId: string;
    roleName: string;
    characterId: string;
    identity: string;
    goal: string;
    permissions: string[];
    knownFactIds: string[];
    heldLeverageKeys: string[];
  };
  scene: {
    sceneId: string;
    title: string;
    timeLabel: string;
    locationLabel: string;
    situation: string;
    presentCharacterIds: string[];
    visibleRelationships: string[];
    mainlineQuestion: string;
    mainlineQuestionIds: string[];
    directedBeat: null | { beatId: string; summary: string };
  };
  recentCanon: Array<{ entryId: string; narrative: string; chronologicalOrder: number }>;
  pendingConsequences: Array<{ consequenceId: string; summary: string; priority: "P0" | "P1"; dueLabel: string | null }>;
  activePressures: Array<{ pressureId: string; summary: string; priority: "P0" | "P1" | "P2" }>;
  actionResolution: {
    resolutionId: string;
    legality: "LEGAL";
    actionType: "CUSTOM";
    accepted: boolean;
    acceptedWithCost: boolean;
    actionStarted: string;
    immediateObservableResult: string[];
    summary: string;
    costSummary: string | null;
    consumedLeverageKeys: string[];
    pendingConsequences: Array<{ consequenceId: string; summary: string; priority: "P0" | "P1"; dueLabel: string | null }>;
    confirmedEffects: string[];
    unresolvedEffects: string[];
  };
  actionBoundary: {
    stage: "ACTION_ALREADY_LANDED";
    alreadyOccurred: string[];
    firstNewBeat: string;
    mustNotRestage: string[];
    validationPatterns: Array<{ code: string; pattern: string; description: string; firstCharacters?: number; firstParagraphOnly?: boolean }>;
  };
  stateLocks: Record<string, Record<string, ShadowStateLockValue>>;
  stateLockAssertions: Array<{
    code: string;
    fieldPath: string;
    blockedWhen: ShadowStateLockValue[];
    pattern: string;
    description: string;
  }>;
  writerPlan?: ShadowWriterPlan;
  causalRuntime?: ShadowCausalRuntimeSeed;
  narrativeBudget?: ShadowNarrativeBudget;
  npcActionPolicies: Record<string, {
    writerOnlyBehavior: true;
    publicPosition: string;
    immediateGoal: string;
    leverage: string[];
    allowedResponses: string[];
    mustDo: string;
    mustNotDo: string[];
  }>;
  decisionAccess: {
    locationRef: string;
    presentEntityRefs: string[];
    controllableEntityRefs: string[];
    reachableInstitutionRefs: string[];
    availableObjectRefs: string[];
  };
  playerIntent: {
    source: "CUSTOM";
    targetId: string;
    targetLabel: string;
    objective: string;
    method: string;
    userFacingText: string;
    leverageKeys: string[];
    immutableIntentHash: string;
  };
  availableTargets: Array<{ type: "ROLE" | "PERSON" | "LOCATION" | "INSTITUTION" | "EVIDENCE" | "RESOURCE" | "PUBLIC_FRAME"; id: string; label: string }>;
  resources: string[];
  openThreads: string[];
  styleGuide: string[];
  forbiddenDisclosures: string[];
  allowedTimeConstraints: string[];
  allowedQuantitativeClaims: string[];
  currentStateExclusions: Array<{
    code: string;
    description: string;
    pattern: string;
    severity?: "error" | "warning";
    factClass?: "CANON" | "CAUSAL" | "TEXTURE";
  }>;
  narrativeBoundary: {
    turnEndsWhen: string;
    allowedNpcResponseTopics: string[];
    resultNarrativeForbiddenTerms: string[];
    forbiddenCharacterNames: string[];
    forbiddenStoryOutcomeTerms: string[];
  };
  narrativeFrame: {
    frameId: string;
    storyIntent: string;
    requiredBeats: string[];
    requiredNarrativePatterns: Array<{ code: string; pattern: string; message: string }>;
    allowedDescriptiveDetails: string[];
    endingBoundary: string;
    decisionPolicy: {
      minimum: number;
      maximum: number;
      allowedClasses: ShadowDecisionClass[];
      instruction: string;
    };
  };
}

export interface ContextAuditItem {
  id: string;
  section: string;
  priority: Priority;
  tokenEstimate: number;
  required: boolean;
  preserved: boolean;
  trimmedReason?: "TOKEN_BUDGET";
  provenance: string[];
}

export interface CompiledShadowContext {
  schemaVersion: "openovel_context_packet_v2";
  contextPacketId: string;
  snapshotHash: string;
  fixtureId: string;
  roleId: string;
  sourceCutoffChapterId: string;
  renderedWorkingSet: string;
  renderedWriterWorkingSet: string;
  includedEvidenceClaimIds: string[];
  excludedEvidenceClaimIds: Array<{ claimId: string; reason: "ROLE_ACL" | "WORLD_BASIS_ONLY" | "FUTURE_CUTOFF" | "BUDGET" }>;
  allowedReferences: {
    evidenceClaimIds: string[];
    runtimeFactIds: string[];
    cardIds: string[];
    entityRefs: string[];
  };
  serverGrounding: {
    evidenceClaimIds: string[];
    runtimeFactIds: string[];
    cardIds: string[];
    sourceMapHash: string;
  };
  narrativeBudget: ShadowNarrativeBudget;
  causalTurn: CompiledCausalTurn;
  minimalCanonEntryIds: string[];
  forbiddenDisclosures: string[];
  auditItems: ContextAuditItem[];
  tokenEstimate: number;
  playerActionLast: boolean;
  soloTakeoverEligible: false;
}
