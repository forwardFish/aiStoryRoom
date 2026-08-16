import type {
  ChapterIdV1,
  ScalarFactValueV1,
  SeatIdV1,
} from "@ai-story/shared";
import type { PublishSangtianPressureChapterRouteInputV1 } from "../content/registry";
import type { PressureChapterRouteRegistrationV1 } from "../../runtime-contract/pressure-chapter-registry";

export type PublishedSangtianRouteConfigurationFromReleaseV1 = Omit<
  PublishSangtianPressureChapterRouteInputV1,
  "package"
>;

export interface SangtianActionEffectWorkingIntentV1 {
  visibility: "PUBLIC" | "PARTICIPANTS" | "PRIVATE";
  targetSeatIds: SeatIdV1[];
  evidenceRefs: string[];
  resourceReservations: Array<{
    reservationKey: string;
    resourceId: string;
    amount: number;
  }>;
  commitmentMutations: Array<{
    commitmentId: string;
    operation: "CREATE" | "FULFILL" | "BREAK" | "CANCEL";
    seatIds: SeatIdV1[];
  }>;
  knowledgeGrants: Array<{
    seatId: SeatIdV1;
    factRefs: string[];
  }>;
  seatArcProgress: Array<{
    seatId: SeatIdV1;
    progressDelta: number;
  }>;
}

export interface CompileSangtianActionBindingInputV1 {
  chapterId: ChapterIdV1;
  decisionPointKey: string;
  seatId: SeatIdV1;
  actionType: string;
}

export interface CompiledSangtianActionBindingV1
extends CompileSangtianActionBindingInputV1 {
  schemaVersion: "sangtian_compiled_action_effect_v1";
  policyVersion: string;
  compilerVersion: string;
  workingIntent: SangtianActionEffectWorkingIntentV1;
  factContributions: Array<{
    factRef: string;
    value: ScalarFactValueV1;
  }>;
  resourcePolicy: "NONE";
  bindingHash: string;
}

export interface ConfirmedSangtianChapterActionV1 {
  actionId: string;
  decisionPointKey: string;
  seatId: SeatIdV1;
  actionType: string;
}

export interface SangtianDefaultTrajectoryEventV1 {
  eventId: string;
  eventType: "APPLY_DEFAULT_TRAJECTORY";
}

export interface CompileSangtianChapterActionEffectsInputV1 {
  chapterId: ChapterIdV1;
  confirmedActions: ConfirmedSangtianChapterActionV1[];
  defaultEvents: SangtianDefaultTrajectoryEventV1[];
}

export interface CompiledSangtianChapterActionEffectsV1 {
  schemaVersion: "sangtian_compiled_chapter_action_effects_v1";
  policyVersion: string;
  compilerVersion: string;
  aggregationVersion: string;
  chapterId: ChapterIdV1;
  aggregationMode: "ACTION_CONTRIBUTIONS" | "DEFAULT_TRAJECTORY_ONCE";
  defaultTrajectoryEventId: string | null;
  confirmedActionIds: string[];
  workingIntents: Array<{
    actionId: string;
    workingIntent: SangtianActionEffectWorkingIntentV1;
  }>;
  settlementFacts: Record<string, ScalarFactValueV1>;
  resourceReservationMutations: [];
  chapterEndResourceDispositions: [];
  compilationHash: string;
}

export type SangtianActionPreferredEntryV1 =
  | "TALK"
  | "INVESTIGATE"
  | "TOKEN"
  | "PLAN"
  | "DEFER";

export interface SangtianActionPresentationV1 {
  actionType: string;
  preferredEntry: SangtianActionPreferredEntryV1;
  label: string;
  description: string;
}

export interface SangtianDefaultPassPresentationV1 {
  preferredEntry: "DEFER";
  label: string;
  description: string;
}

export interface ReadSangtianActionPresentationInputV1 {
  contentPackageVersion: string;
  contentPackageHash: string;
  chapterId: ChapterIdV1;
  decisionPointKey: string;
  actionType: string;
}

export interface SangtianActionEffectPolicyV1 {
  schemaVersion: "sangtian_action_effect_policy_v1";
  policyVersion: string;
  compilerVersion: string;
  aggregationVersion: string;
  runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1";
  sourceBinding: {
    contentPackageVersion: string;
    contentPackageSha256: string;
  };
  policySha256: string;
  [key: string]: unknown;
}

export interface SangtianActionPresentationCatalogV1 {
  schemaVersion: "sangtian_action_presentation_catalog_v1";
  catalogVersion: string;
  runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1";
  locale: "zh-CN";
  sourceBinding: {
    contentPackageVersion: string;
    contentPackageSha256: string;
  };
  defaultPassPresentation: SangtianDefaultPassPresentationV1;
  chapters: Array<{
    chapterId: ChapterIdV1;
    decisions: Array<{
      decisionPointKey: string;
      actions: SangtianActionPresentationV1[];
    }>;
  }>;
  completeness: {
    chapterCount: 7;
    decisionPointCount: 33;
    decisionActionPairCount: 93;
    coverageRule: "EXACT_ACCEPTED_CONTENT_DECISION_ACTION_PAIRS";
  };
  catalogSha256: string;
  [key: string]: unknown;
}

export interface PublishedSangtianActionReleaseV1 {
  releaseRoot: string;
  route: {
    routeKey: "sangtian_pressure_chapter_v1";
    status: "PUBLISHED";
    createEnabled: true;
    contentPackageVersion: string;
    contentPackageSha256: string;
  };
  /** Exact validated registry row embedded in the published release manifest. */
  routeRegistration: PressureChapterRouteRegistrationV1;
  /** Complete input for createPublishedSangtianPressureChapterRegistryV1. */
  routeConfiguration: PublishedSangtianRouteConfigurationFromReleaseV1;
  policy: SangtianActionEffectPolicyV1;
  catalog: SangtianActionPresentationCatalogV1;
  compileActionBinding(
    input: Readonly<CompileSangtianActionBindingInputV1>,
  ): CompiledSangtianActionBindingV1;
  compileChapterActionEffects(
    input: Readonly<CompileSangtianChapterActionEffectsInputV1>,
  ): CompiledSangtianChapterActionEffectsV1;
  readActionPresentation(
    input: Readonly<ReadSangtianActionPresentationInputV1>,
  ): SangtianActionPresentationV1;
}

export interface SangtianAiDecisionPolicyInputV1 {
  schemaVersion: "sangtian_ai_decision_policy_input_v1";
  runId: string;
  routeHash: string;
  runSeed: string;
  contentPackageVersion: string;
  contentPackageSha256: string;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  decisionPointId: string;
  seatId: SeatIdV1;
  eligibleActionTypes: string[];
  inputHash: string;
}

export interface SangtianAiDecisionPolicySelectionV1 {
  schemaVersion: "sangtian_ai_decision_policy_selection_v1";
  policyRef: string;
  policyVersion: string;
  policyHash: string;
  resolvedContentPackageVersion: string;
  resolvedContentPackageSha256: string;
  inputHash: string;
  actionType: string;
  selectionHash: string;
}

export interface SangtianNpcControllerAuthorityV1 {
  mode: "HUMAN_ACTIVE" | "AI_ACTIVE";
  activeControllerId: string;
  controlEpoch: number;
  authorityStateHash: string;
  requiresResolution: boolean;
}

export interface SangtianNpcSeatIdentityV1 {
  identityProfileRef: string;
  identityStateHash: string;
}

export interface SangtianNpcAuthoritativeFactV1 {
  factRef: string;
  state: "ACTIVE" | "INACTIVE";
  value: ScalarFactValueV1;
  tags: string[];
}

export interface SangtianNpcWorkingDeltaV1 {
  deltaRef: string;
  state: "ACTIVE" | "INACTIVE";
  value: ScalarFactValueV1;
  tags: string[];
}

export interface SangtianNpcCommitmentV1 {
  commitmentId: string;
  status: "ACTIVE" | "FULFILLED" | "BROKEN" | "CANCELLED";
  tags: string[];
}

export interface SangtianNpcResourceV1 {
  resourceId: string;
  available: number;
  reserved: number;
  tags: string[];
}

export interface SangtianNpcAuthorityGrantV1 {
  authorityId: string;
  enabled: boolean;
  tags: string[];
}

export interface SangtianNpcCapabilityV1 {
  capabilityId: string;
  enabled: boolean;
  tags: string[];
}

export interface SangtianNpcDecisionPolicyInputV1 {
  schemaVersion: "sangtian_npc_decision_policy_input_v1";
  runId: string;
  routeHash: string;
  runSeed: string;
  contentPackageVersion: string;
  contentPackageSha256: string;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  decisionPointId: string;
  seatId: SeatIdV1;
  eligibleActionTypes: string[];
  controllerAuthority: SangtianNpcControllerAuthorityV1;
  seatIdentity: SangtianNpcSeatIdentityV1;
  authoritativeFacts: SangtianNpcAuthoritativeFactV1[];
  chapterWorkingDeltas: SangtianNpcWorkingDeltaV1[];
  commitments: SangtianNpcCommitmentV1[];
  resources: SangtianNpcResourceV1[];
  authorityGrants: SangtianNpcAuthorityGrantV1[];
  capabilities: SangtianNpcCapabilityV1[];
  inputHash: string;
}

export interface SangtianNpcDecisionScoreV1 {
  actionType: string;
  responsibilityTriggered: boolean;
  baseScore: number;
  identityPriority: number;
  pressureMatch: number;
  authorityMatch: number;
  commitmentConsistency: number;
  resourceFitness: number;
  capabilityMatch: number;
  resourceConflictPenalty: number;
  overreachPenalty: number;
  totalScore: number;
}

export type SangtianNpcDecisionResolutionReasonV1 =
  | "SCORED_ACTION"
  | "HUMAN_CONTROLLED"
  | "RESOLUTION_NOT_REQUIRED"
  | "NO_RESPONSIBILITY_TRIGGER"
  | "BELOW_ABSTAIN_THRESHOLD";

/**
 * NPC-aware result contract. It deliberately does not extend or reuse the
 * legacy selection schema, so downstream orchestration can discriminate the
 * richer authority-bound resolution before consuming it.
 */
export interface SangtianNpcDecisionResolutionV1 {
  schemaVersion: "sangtian_npc_decision_resolution_v1";
  policyRef: "sangtian.ai.decision.v1";
  policyVersion: "sangtian-ai-decision-1.0.2";
  policyHash: string;
  resolvedContentPackageVersion: string;
  resolvedContentPackageSha256: string;
  inputHash: string;
  actionType: string;
  identityPolicyRef: "sangtian.npc.identity-decision.v1";
  identityPolicyVersion: "sangtian-npc-identity-decision-1.0.0";
  identityPolicyHash: string;
  identityPolicyArtifactSha256: string;
  resolutionReason: SangtianNpcDecisionResolutionReasonV1;
  scoreBreakdown: SangtianNpcDecisionScoreV1[];
  topScore: number | null;
  tiedActionTypes: string[];
  tieBreakerUsed: boolean;
  tieBreakerHash: string | null;
  providerCallCount: 0;
  resolutionHash: string;
}

export interface SangtianNpcIdentitySeatProfileV1 {
  seatId: SeatIdV1;
  identityProfileRef: string;
  responsibilityTags: string[];
  authorityTags: string[];
  capabilityAffinityTags: string[];
  commitmentAffinityTags: string[];
  resourceStewardshipTags: string[];
  abstainThreshold: number;
}

export interface SangtianNpcActionRuleV1 {
  actionType: string;
  baseScore: number;
  responsibilityTags: string[];
  pressureTags: string[];
  requiredAuthorityAnyOf: string[];
  requiredCapabilityAnyOf: string[];
  commitmentTags: string[];
  resourceRequirements: Array<{
    resourceTags: string[];
    amount: number;
  }>;
}

export interface SangtianNpcIdentityDecisionPolicyV1 {
  schemaVersion: "sangtian_npc_identity_decision_policy_v1";
  policyRef: "sangtian.npc.identity-decision.v1";
  policyVersion: "sangtian-npc-identity-decision-1.0.0";
  selectorVersion: "sangtian-npc-identity-score-selector-1.0.0";
  runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1";
  sourceBinding: {
    contentPackageVersion: string;
    contentPackageSha256: string;
  };
  legacyBindingPolicy: {
    policyRef: "sangtian.ai.decision.v1";
    policyVersion: "sangtian-ai-decision-1.0.2";
    artifactSha256: string;
    retainedRole: "ELIGIBLE_ACTION_AND_REQUIRED_SEAT_BINDING_ONLY";
    supersededPrimaryAlgorithm:
      "SHA256_CANONICAL_PREFIX_MODULO_RANKED_NON_DEFAULT_V1";
  };
  authorityBoundary: {
    providerCallCount: 0;
    mayCreateActionTypes: false;
    mayCompileWorkingIntent: false;
    maySupplySettlementFacts: false;
  };
  scoring: {
    baseScoreWeight: number;
    identityResponsibilityWeight: number;
    activePressureWeight: number;
    authorityMatchWeight: number;
    capabilityMatchWeight: number;
    activeCommitmentWeight: number;
    brokenCommitmentPenalty: number;
    availableResourceWeight: number;
    resourceConflictPenalty: number;
    overreachPenalty: number;
  };
  seatProfiles: SangtianNpcIdentitySeatProfileV1[];
  actionRules: SangtianNpcActionRuleV1[];
  coverage: {
    chapterCount: 7;
    seatCount: 6;
    actionRuleCount: number;
    chapterRule: "GENERIC_N1_TO_N7_NO_CHAPTER_BRANCHES";
    profileRule: "EXACT_PRESSURE_SIX_SEAT_IDENTITIES";
    actionRuleCoverage: "EXACT_LEGACY_NPC_NON_DEFAULT_ACTION_TYPES";
    decisionReachabilityCoverage:
      "EVERY_PUBLISHED_DECISION_HAS_REQUIRED_SEAT_WITH_REACHABLE_NON_DEFAULT_ACTION";
  };
  policySha256: string;
}

export interface SangtianAiDecisionSeatPolicyV1 {
  seatId: SeatIdV1;
  rankedNonDefaultActionTypes: string[];
}

export interface SangtianAiDecisionBindingPolicyV1 {
  chapterId: ChapterIdV1;
  decisionPointId: string;
  publishedAllowedActionTypes: string[];
  seatPolicies: SangtianAiDecisionSeatPolicyV1[];
}

export interface SangtianAiDecisionPolicyV1 {
  schemaVersion: "sangtian_ai_decision_policy_v1";
  policyRef: "sangtian.ai.decision.v1";
  policyVersion: "sangtian-ai-decision-1.0.2";
  selectorVersion: "sangtian-ai-decision-selector-1.0.0";
  runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1";
  sourceBinding: {
    contentPackageVersion: string;
    contentPackageSha256: string;
  };
  authorityBoundary: {
    acceptedInputFields: readonly string[];
    selectionEntropyFields: readonly [
      "runSeed",
      "chapterId",
      "decisionPointId",
      "seatId",
    ];
    forbiddenInputClasses: readonly [
      "FREE_TEXT",
      "MUTABLE_WORKING_STATE",
      "NARRATIVE_ARTIFACT",
      "PROVIDER_OUTPUT",
      "UI_PROJECTION",
    ];
    mayCreateActionTypes: false;
    mayCompileWorkingIntent: false;
    maySupplySettlementFacts: false;
    contextualHumanOnlyActionTypes: readonly [
      "CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE",
      "INVESTIGATE_LEDGER_SOURCE",
    ];
    unknownBindingPolicy: "FAIL_CLOSED";
    eligibleSetMismatchPolicy: "FAIL_CLOSED";
    noNonDefaultCandidatePolicy: "DEFAULT_PASS_ONLY";
  };
  selectionAlgorithm: {
    kind: "SHA256_CANONICAL_PREFIX_MODULO_RANKED_NON_DEFAULT_V1";
    digestWindow: "FIRST_8_HEX_UINT32_BE";
    rankingSource: "PUBLISHED_POLICY_EXACT_ORDER";
    defaultActionType: "DEFAULT_PASS";
  };
  decisions: SangtianAiDecisionBindingPolicyV1[];
  coverage: {
    chapterCount: 7;
    decisionPointCount: 33;
    applicableSeatBindingCount: 142;
    coverageRule: "EXACT_ACCEPTED_DECISION_REQUIRED_SEAT_BINDINGS";
  };
  policySha256: string;
}

export interface PublishedSangtianAiDecisionPolicyV1 {
  releaseRoot: string;
  artifactSha256: string;
  policy: SangtianAiDecisionPolicyV1;
  identityPolicyArtifactSha256: string;
  identityPolicy: SangtianNpcIdentityDecisionPolicyV1;
  select(
    input: Readonly<SangtianAiDecisionPolicyInputV1>,
  ): SangtianAiDecisionPolicySelectionV1;
  select(
    input: Readonly<SangtianNpcDecisionPolicyInputV1>,
  ): SangtianNpcDecisionResolutionV1;
}
