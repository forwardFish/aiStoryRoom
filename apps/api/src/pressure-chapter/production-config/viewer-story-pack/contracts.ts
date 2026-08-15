import type { SeatIdV1 } from "@ai-story/shared";
import type { ResolvedPressureChapterBeatV1 } from "@ai-story/templates";

export const PRESSURE_VIEWER_STORY_VISIBILITIES_V1 = Object.freeze([
  "PUBLIC",
  "SEAT_PRIVATE",
  "SYSTEM_ONLY",
] as const);

export const PRESSURE_VIEWER_STORY_PACK_ERROR_CODES_V1 = Object.freeze({
  INVALID: "PRESSURE_VIEWER_STORY_PACK_INVALID",
  IDENTITY_MISMATCH: "PRESSURE_VIEWER_STORY_PACK_IDENTITY_MISMATCH",
  SCOPE_VIOLATION: "PRESSURE_VIEWER_STORY_PACK_SCOPE_VIOLATION",
  AUTHORITY_MISMATCH: "PRESSURE_VIEWER_STORY_PACK_AUTHORITY_MISMATCH",
  DECISION_MISMATCH: "PRESSURE_VIEWER_STORY_PACK_DECISION_MISMATCH",
} as const);

export type PressureViewerStoryVisibilityV1 =
  (typeof PRESSURE_VIEWER_STORY_VISIBILITIES_V1)[number];

export interface PressureViewerStoryAclV1 {
  visibility: PressureViewerStoryVisibilityV1;
  authorizedSeatIds: SeatIdV1[];
}

export interface CompilePressureViewerStoryPackInputV1 {
  runId: string;
  routeHash: string;
  chapterRuntimeId: string;
  chapterId: string;
  beatId: string;
  previousBeatId: string | null;
  viewerSeatId: SeatIdV1;
  authorityRevision: number;
  stateAfterHash: string;
  beat: ResolvedPressureChapterBeatV1;
  sealedViewerAction: null | {
    runId: string;
    chapterRuntimeId: string;
    sourceBeatId: string;
    viewerSeatId: SeatIdV1;
    authorityRevision: number;
    actionId: string;
    actionType: string;
    summary: string;
  };
  visibleSeatResults: Array<PressureViewerStoryAclV1 & {
    runId: string;
    chapterRuntimeId: string;
    sourceBeatId: string;
    authorityRevision: number;
    sourceSeatId: SeatIdV1;
    actionId: string;
    summary: string;
    resultFactRefs: string[];
  }>;
  authority: {
    facts: Array<PressureViewerStoryAclV1 & {
      factRef: string;
      text: string;
      source: "SETTLEMENT" | "WORKING_LEDGER" | "CATALOG";
    }>;
    metrics: Array<PressureViewerStoryAclV1 & {
      metricRef: string;
      label: string;
      displayValue: string;
    }>;
    allowedClaims: Array<PressureViewerStoryAclV1 & {
      kind: "FACT" | "METRIC" | "RESULT";
      refId: string;
      statement: string;
      required: boolean;
    }>;
  };
  authorialMaterials: Array<PressureViewerStoryAclV1 & {
    materialRef: string;
    title: string;
    text: string;
    factRefs: string[];
    stopCondition: string | null;
  }>;
  nextDecision: {
    decisionPointRef: string;
    legalActionRefs: string[];
    catalogActions: Array<{
      actionRef: string;
      actionType: string;
      label: string;
      description: string;
      preferredEntry: string;
    }>;
  };
}

export interface PressureViewerStoryPackV1 {
  schemaVersion: "pressure_viewer_story_pack_v1";
  identity: {
    runId: string;
    routeHash: string;
    chapterRuntimeId: string;
    chapterId: string;
    beatId: string;
    previousBeatId: string | null;
    viewerSeatId: SeatIdV1;
    authorityRevision: number;
    stateAfterHash: string;
  };
  previousAction: null | {
    actionId: string;
    actionType: string;
    summary: string;
  };
  visibleSeatResults: Array<{
    sourceSeatId: SeatIdV1;
    actionId: string;
    summary: string;
    resultFactRefs: string[];
  }>;
  authority: {
    facts: Array<{ factRef: string; text: string; source: string }>;
    metrics: Array<{ metricRef: string; label: string; displayValue: string }>;
    allowedClaims: Array<{
      kind: "FACT" | "METRIC" | "RESULT";
      refId: string;
      statement: string;
      required: boolean;
    }>;
  };
  authorialMaterials: Array<{
    materialRef: string;
    title: string;
    text: string;
    factRefs: string[];
    stopCondition: string | null;
  }>;
  decision: {
    decisionContractRef: string;
    decisionPointRef: string;
    legalActionRefs: string[];
    catalogActions: Array<{
      actionRef: string;
      actionType: string;
      label: string;
      description: string;
      preferredEntry: string;
    }>;
  };
  cacheKey: string;
  packHash: string;
}

export class PressureViewerStoryPackCompileErrorV1 extends Error {
  constructor(
    public readonly code: string,
    public readonly path: string,
    public readonly detail: string,
  ) {
    super(`${code}:${path}:${detail}`);
    this.name = "PressureViewerStoryPackCompileErrorV1";
  }
}
