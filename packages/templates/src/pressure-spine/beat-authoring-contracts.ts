export const PRESSURE_CHAPTER_BEAT_PHASES_V1 = Object.freeze([
  "OPENING",
  "DEVELOPMENT",
  "ESCALATION",
  "COMMIT",
] as const);

export const PRESSURE_CHAPTER_ACTION_PHASES_V1 = Object.freeze([
  "PREPARE",
  "COMMIT",
] as const);

export const PRESSURE_AUTHORIAL_MATERIAL_VISIBILITIES_V1 = Object.freeze([
  "PUBLIC",
  "SEAT_PRIVATE",
  "SYSTEM_ONLY",
] as const);

export const PRESSURE_CHAPTER_BEAT_AUTHORING_ERROR_CODES_V1 = Object.freeze({
  CONTRACT_INVALID: "PRESSURE_CHAPTER_BEAT_AUTHORING_CONTRACT_INVALID",
  BEAT_DUPLICATE: "PRESSURE_CHAPTER_BEAT_DUPLICATE",
  DECISION_CONTRACT_DUPLICATE: "PRESSURE_CHAPTER_DECISION_CONTRACT_DUPLICATE",
  ORDINAL_GAP: "PRESSURE_CHAPTER_BEAT_ORDINAL_GAP",
  ENTRY_MISSING: "PRESSURE_CHAPTER_BEAT_ENTRY_MISSING",
  SUCCESSOR_MISSING: "PRESSURE_CHAPTER_BEAT_SUCCESSOR_MISSING",
  SUCCESSOR_NOT_FORWARD: "PRESSURE_CHAPTER_BEAT_SUCCESSOR_NOT_FORWARD",
  UNREACHABLE: "PRESSURE_CHAPTER_BEAT_UNREACHABLE",
  TERMINAL_MISSING: "PRESSURE_CHAPTER_BEAT_TERMINAL_MISSING",
  TERMINAL_HAS_SUCCESSOR: "PRESSURE_CHAPTER_BEAT_TERMINAL_HAS_SUCCESSOR",
  NON_TERMINAL_WITHOUT_SUCCESSOR: "PRESSURE_CHAPTER_BEAT_NON_TERMINAL_WITHOUT_SUCCESSOR",
  REFERENCE_MISSING: "PRESSURE_CHAPTER_BEAT_REFERENCE_MISSING",
  VISIBILITY_INVALID: "PRESSURE_CHAPTER_BEAT_VISIBILITY_INVALID",
  BINDING_MISMATCH: "PRESSURE_CHAPTER_BEAT_BINDING_MISMATCH",
} as const);

export type PressureChapterBeatPhaseV1 =
  (typeof PRESSURE_CHAPTER_BEAT_PHASES_V1)[number];
export type PressureChapterActionPhaseV1 =
  (typeof PRESSURE_CHAPTER_ACTION_PHASES_V1)[number];
export type PressureAuthorialMaterialVisibilityV1 =
  (typeof PRESSURE_AUTHORIAL_MATERIAL_VISIBILITIES_V1)[number];

export interface PressureChapterBeatAuthoringV1 {
  schemaVersion: "pressure_chapter_beat_authoring_v1";
  contentStatus: "REFERENCE" | "READY_FOR_IMPORT";
  chapterId: string;
  title: string;
  entryBeatId: string;
  beats: PressureChapterBeatAuthoringBeatV1[];
  chapterSummary: {
    outcomeFrameRefs: { HIGH: string; MID: string; LOW: string };
    nextChapterId: string | null;
  };
}

export interface PressureChapterBeatAuthoringBeatV1 {
  beatId: string;
  ordinal: number;
  phase: PressureChapterBeatPhaseV1;
  title: string;
  storyPurpose: string;
  sourceMaterialRefs: string[];
  decisionContractRef: string;
  successorBeatIds: string[];
  closesChapter: boolean;
}

/** Narrow immutable view consumed by BeatSubmitPolicyV1. */
export type PressureChapterBeatClosureAuthorityV1 = Readonly<
  Pick<PressureChapterBeatAuthoringBeatV1, "beatId" | "closesChapter">
>;

export interface PressureChapterBeatBindingsV1 {
  schemaVersion: "pressure_chapter_beat_bindings_v1";
  chapterId: string;
  decisionContracts: PressureChapterBeatDecisionBindingV1[];
  chapterSummaryMaterialRefs: string[];
}

export interface PressureChapterBeatDecisionBindingV1 {
  decisionContractRef: string;
  catalogDecisionPointRef: string;
  actionPhase: PressureChapterActionPhaseV1;
  pressure: string;
  advanceCondition: {
    kind: "AUTHORITY_NEXT_DECISION_PIN" | "CHAPTER_SUMMARY_READY";
    successorDecisionContractRefs: string[];
  };
}

export interface PressureAuthorialMaterialReferenceV1 {
  materialRef: string;
  visibility: PressureAuthorialMaterialVisibilityV1;
  authorizedSeatIds: string[];
}

export interface PressureActionCatalogReferenceV1 {
  decisionPointRef: string;
  legalActionRefs: string[];
}

export interface PressureChapterBeatReferenceIndexV1 {
  materials: PressureAuthorialMaterialReferenceV1[];
  decisions: PressureActionCatalogReferenceV1[];
}

export interface ResolvedPressureChapterBeatV1 extends PressureChapterBeatAuthoringBeatV1 {
  catalogDecisionPointRef: string;
  actionPhase: PressureChapterActionPhaseV1;
  pressure: string;
  advanceCondition: PressureChapterBeatDecisionBindingV1["advanceCondition"];
  legalActionRefs: string[];
  sourceMaterials: PressureAuthorialMaterialReferenceV1[];
}

export interface PressureChapterBeatAuthoringPackageV1 {
  schemaVersion: "pressure_chapter_beat_authoring_package_v1";
  contentStatus: PressureChapterBeatAuthoringV1["contentStatus"];
  chapterId: string;
  title: string;
  entryBeatId: string;
  beats: ResolvedPressureChapterBeatV1[];
  chapterSummary: PressureChapterBeatAuthoringV1["chapterSummary"] & {
    materialRefs: PressureAuthorialMaterialReferenceV1[];
  };
  packageHash: string;
}
