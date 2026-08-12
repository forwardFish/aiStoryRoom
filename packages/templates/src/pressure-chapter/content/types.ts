import type {
  ChapterIdV1,
  DecisionPointDefinitionV1,
  DeterministicPredicateV1,
  ScalarFactValueV1,
  SeatIdV1,
  TrackIdV1,
} from "@ai-story/shared";

export type SangtianOutcomeBandV1 = "HIGH" | "MID" | "LOW";

export interface SangtianContentSourceTraceV1 {
  path: string;
  gitBlobSha1: string;
}

export interface SangtianPressureChapterManifestV1 {
  schemaVersion: "sangtian_pressure_chapter_manifest_v1";
  packageId: "sangtian_pressure_chapter_v1";
  packageVersion: string;
  runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1";
  sourceCommitSha: string;
  sourcePackageId: string;
  sourcePackageVersion: string;
  sourceStorySha256: string;
  contentFile: "content.json";
  contentSha256: string;
  forbiddenLegacyFields: string[];
  sourceTrace: SangtianContentSourceTraceV1[];
  manifestSha256: string;
}

export interface SangtianSeatContentV1 {
  seatId: SeatIdV1;
  sourceSeatId: string;
  displayName: string;
  institutionalMission: string;
  initialActorId: string;
  persistentObjectRefs: string[];
}

export interface SangtianTrackContentV1 {
  trackId: TrackIdV1;
  sourceTrackId: string;
  name: string;
  low: string;
  mid: string;
  high: string;
  initialValue: number;
}

export interface SangtianObjectContentV1 {
  objectId: string;
  name: string;
  kind: string;
  initialHolderSeatId: SeatIdV1 | null;
  sourceCustody: string;
  sourceStatus: "SOURCE_FACT" | "ADAPTATION_RULE";
}

export interface SangtianInitialKnowledgeV1 {
  seatId: SeatIdV1;
  knownFactRefs: string[];
  secretRefs: string[];
}

export interface SangtianInitialEvidenceV1 {
  evidenceId: string;
  holderSeatIds: SeatIdV1[];
  supportsFactRefs: string[];
  visibilityPolicyRef: string;
}

export interface SangtianInitialResponsibilityV1 {
  responsibilityId: string;
  subjectSeatId: SeatIdV1;
  sourceFactRefs: string[];
  level: number;
}

export interface SangtianGenesisContentV1 {
  nodeId: "P0";
  title: string;
  pressure: string;
  lockedFacts: string[];
  factValues: Record<string, ScalarFactValueV1>;
  resources: Record<string, number>;
  seats: SangtianSeatContentV1[];
  tracks: SangtianTrackContentV1[];
  objects: SangtianObjectContentV1[];
  knowledgeBySeat: SangtianInitialKnowledgeV1[];
  evidence: SangtianInitialEvidenceV1[];
  responsibilities: SangtianInitialResponsibilityV1[];
  sourceRefs: string[];
}

export interface SangtianContentDecisionPointV1 {
  decisionPointKey: string;
  ordinal: number;
  mode: DecisionPointDefinitionV1["mode"];
  purpose: string;
  requiredSeatIds: SeatIdV1[];
  allowedActionTypes: string[];
  perSeatActionBudget: number;
  closeFactRef: string;
  deadlineMs: number | null;
  absenceDefaultRef: string;
  aiFailureDefaultRef: string;
  beatResolutionPolicy: string;
  allowedWorkingDeltaTypes: string[];
  feedbackVisibilityPolicy: string;
  availability: DeterministicPredicateV1 | null;
  reaction: {
    enabled: boolean;
    eligibleSeatIds: SeatIdV1[];
    triggerFactRef: string | null;
  };
  sourceRefs: string[];
}

export type SangtianSettlementPredicateV1 =
  | { op: "ALL" | "ANY"; clauses: SangtianSettlementPredicateV1[] }
  | {
      op: "COMPARE";
      factRef: string;
      comparator: "EQ" | "NE" | "GT" | "GTE" | "LT" | "LTE" | "IN";
      value: ScalarFactValueV1 | ScalarFactValueV1[];
    }
  | {
      op: "MIN_COMPARE";
      factRefs: string[];
      comparator: "GT" | "GTE" | "LT" | "LTE";
      value: number;
    }
  | { op: "DEFAULT" };

export interface SangtianChapterSettlementBranchV1 {
  branchId: string;
  outcomeBand: SangtianOutcomeBandV1;
  selector: SangtianSettlementPredicateV1;
  trackDelta: Partial<Record<TrackIdV1, number>>;
  seatArcProgressDelta: number;
  objectRefs: string[];
  evidenceRefs: string[];
  carryForwardRefs: string[];
  sourceRefs: string[];
}

export interface SangtianChapterContentV1 {
  chapterId: ChapterIdV1;
  title: string;
  pressure: string;
  lockedFacts: string[];
  decisionPlan: "STATIC" | "DYNAMIC";
  decisionPoints: SangtianContentDecisionPointV1[];
  closePolicy: {
    exitPredicate: DeterministicPredicateV1;
    settlementPolicyRef: string;
    failureMode: "FAIL_CLOSED";
  };
  settlementPolicy: {
    policyVersion: string;
    evaluationOrder: SangtianOutcomeBandV1[];
    branches: SangtianChapterSettlementBranchV1[];
  };
  sourceRefs: string[];
}

export interface SangtianPressureChapterContentV1 {
  schemaVersion: "sangtian_pressure_chapter_content_v1";
  packageId: "sangtian_pressure_chapter_v1";
  packageVersion: string;
  runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1";
  defaultPolicies: {
    absence: { policyRef: string; actionType: string; payload: Record<string, ScalarFactValueV1> };
    aiFailure: { policyRef: string; actionType: string; payload: Record<string, ScalarFactValueV1> };
  };
  genesis: SangtianGenesisContentV1;
  chapters: SangtianChapterContentV1[];
  finale: {
    policyVersion: "sangtian_content_finale_v1";
    ruleSchemaVersion: "sangtian_five_track_finale_rules_v1";
    worldOutcomeRuleRefs: string[];
    seatVerdictRuleRefs: Record<SeatIdV1, string[]>;
    disclosureRuleRefs: string[];
    sourceRefs: string[];
  };
}

export interface CompiledSangtianChapterContentV1 {
  chapterId: ChapterIdV1;
  decisionPlan: "STATIC" | "DYNAMIC";
  decisionPoints: Array<{
    definition: DecisionPointDefinitionV1;
    availability: DeterministicPredicateV1 | null;
    sourceRefs: string[];
  }>;
  closePolicy: SangtianChapterContentV1["closePolicy"];
  settlementPolicy: SangtianChapterContentV1["settlementPolicy"];
}

export interface LoadedSangtianPressureChapterPackageV1 {
  manifest: SangtianPressureChapterManifestV1;
  content: SangtianPressureChapterContentV1;
  chapters: CompiledSangtianChapterContentV1[];
}

export interface SangtianChapterPolicyMaterialV1 {
  schemaVersion: "sangtian_chapter_policy_material_v1";
  chapterId: ChapterIdV1;
  inputHash: string;
  contentPolicyVersion: string;
  contentPolicyHash: string;
  branchId: string;
  outcomeBand: SangtianOutcomeBandV1;
  factAssignments: Array<{
    factRef: string;
    value: ScalarFactValueV1;
    sourceRefs: string[];
  }>;
  trackDelta: Partial<Record<TrackIdV1, number>>;
  seatArcProgressDelta: number;
  objectRefs: string[];
  evidenceRefs: string[];
  carryForwardRefs: string[];
  sourceRefs: string[];
  materialHash: string;
}
