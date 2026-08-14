import type { SeatIdV1 } from "@ai-story/shared";
import type {
  PressureViewerStoryAclV1,
  PressureViewerStoryClaimV1,
  PressureViewerStoryFactV1,
  PressureViewerStoryMaterialV1,
  PressureViewerStoryMetricV1,
} from "./viewer-story-pack-values";

export interface CompilePressureViewerStoryPackInputV1 {
  runId: string;
  chapterRuntimeId: string;
  chapterId: string;
  beatId: string;
  ordinal: number;
  previousBeatId: string | null;
  viewerSeatId: SeatIdV1;
  authorityRevision: number;
  stateAfterHash: string;
  authorityHash: string;
  facts: PressureViewerStoryFactV1[];
  metrics: PressureViewerStoryMetricV1[];
  allowedClaims: PressureViewerStoryClaimV1[];
  allowedAuthorialFactRefs: string[];
  authorialMaterials: PressureViewerStoryMaterialV1[];
  previousNarrative: {
    sourceCommitHash: string;
    text: string;
    authority: "CONTINUITY_ONLY";
  };
  sealedViewerAction: null | PressureViewerSealedActionV1;
  visibleSeatResults: PressureViewerSeatResultV1[];
  nextDecision: PressureViewerNextDecisionV1;
}

export interface PressureViewerSealedActionV1 {
  runId: string;
  chapterRuntimeId: string;
  sourceBeatId: string;
  authorityRevision: number;
  viewerSeatId: SeatIdV1;
  actionId: string;
  actionType: string;
  summary: string;
}

export type PressureViewerSeatResultV1 = PressureViewerStoryAclV1 & {
  runId: string;
  chapterRuntimeId: string;
  sourceBeatId: string;
  authorityRevision: number;
  sourceSeatId: SeatIdV1;
  actionId: string;
  summary: string;
  resultFactRefs: string[];
};

export interface PressureViewerNextDecisionV1 {
  decisionContractRef: string;
  decisionPointRef: string;
  legalActionRefs: string[];
  catalogActions: PressureViewerCatalogActionV1[];
}

export interface PressureViewerCatalogActionV1 {
  actionRef: string;
  actionType: string;
  label: string;
  description: string;
}
