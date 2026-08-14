import type { SeatIdV1 } from "@ai-story/shared";
import type { CompilePressureViewerStoryPackInputV1 } from "./viewer-story-pack-input";
import type {
  PressureViewerStoryClaimV1,
  PressureViewerStoryFactV1,
  PressureViewerStoryMaterialV1,
  PressureViewerStoryMetricV1,
} from "./viewer-story-pack-values";

export interface PressureViewerStoryPackV1 {
  schemaVersion: "pressure_viewer_story_pack_v1";
  identity: PressureViewerStoryPackIdentityV1;
  cacheKey: string;
  providerInput: PressureViewerStoryProviderInputV1;
  storyPackHash: string;
}

export interface PressureViewerStoryPackIdentityV1 {
  runId: string;
  chapterRuntimeId: string;
  chapterId: string;
  beatId: string;
  viewerSeatId: SeatIdV1;
  authorityRevision: number;
}

export interface PressureViewerStoryProviderInputV1 {
  ordinal: number;
  previousNarrative: CompilePressureViewerStoryPackInputV1["previousNarrative"];
  previousAction: null | { actionId: string; actionType: string; summary: string };
  authorialMaterials: Array<Pick<PressureViewerStoryMaterialV1,
    "materialRef" | "title" | "text" | "factRefs" | "stopCondition">>;
  visibleSeatResults: Array<{
    sourceSeatId: SeatIdV1;
    actionId: string;
    summary: string;
    resultFactRefs: string[];
  }>;
  authority: {
    stateAfterHash: string;
    facts: Array<Pick<PressureViewerStoryFactV1, "factRef" | "text" | "source">>;
    metrics: Array<Pick<PressureViewerStoryMetricV1, "metricRef" | "label" | "displayValue">>;
    allowedClaims: Array<Pick<PressureViewerStoryClaimV1,
      "kind" | "refId" | "statement" | "required">>;
  };
  nextDecision: CompilePressureViewerStoryPackInputV1["nextDecision"];
  authorityBoundary: {
    settlementAndCatalogAreAuthoritative: true;
    providerCannotCreateFactsMetricsResultsOrActions: true;
  };
}
