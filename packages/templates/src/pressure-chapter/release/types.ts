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
  select(
    input: Readonly<SangtianAiDecisionPolicyInputV1>,
  ): SangtianAiDecisionPolicySelectionV1;
}
