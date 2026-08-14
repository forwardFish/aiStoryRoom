import type { SeatIdV1 } from "@ai-story/shared";

export type PressureViewerStoryVisibilityV1 = "PUBLIC" | "SEAT_PRIVATE" | "SYSTEM_ONLY";
export type PressureViewerStoryAclV1 = {
  visibility: PressureViewerStoryVisibilityV1;
  authorizedSeatIds: SeatIdV1[];
};
export type PressureViewerStoryMaterialV1 = PressureViewerStoryAclV1 & {
  materialRef: string;
  title: string;
  text: string;
  factRefs: string[];
  stopCondition: string | null;
};
export type PressureViewerStoryFactV1 = PressureViewerStoryAclV1 & {
  factRef: string;
  text: string;
  source: "SETTLEMENT" | "WORKING_DELTA" | "STATE_AFTER" | "FROZEN_CHAPTER";
};
export type PressureViewerStoryMetricV1 = PressureViewerStoryAclV1 & {
  metricRef: string;
  label: string;
  displayValue: string;
};
export type PressureViewerStoryClaimV1 = PressureViewerStoryAclV1 & {
  kind: "FACT" | "OUTCOME" | "OBJECT" | "KNOWLEDGE" | "METRIC" | "TEMPORAL";
  refId: string;
  statement: string;
  required: boolean;
};
