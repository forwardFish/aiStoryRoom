import type { TrackIdV1 } from "@ai-story/shared";

/**
 * The API owns the player-facing names of Sangtian's public world metrics.
 * Content labels remain authorial descriptions; clients receive these stable
 * display labels by track identity and never need to reinterpret them.
 */
const SANGTIAN_METRIC_DISPLAY_LABELS_V1: Readonly<Record<TrackIdV1, string>> = Object.freeze({
  fiscal_military: "国库银两",
  civilian_land: "民心",
  evidence_responsibility: "真相进展",
  mulberry_silk: "改桑进度",
  court_imperial_face: "皇帝信任",
});

export function projectPressureMetricDisplayLabelV1(
  trackId: TrackIdV1,
  _authorialLabel: string,
): string {
  return SANGTIAN_METRIC_DISPLAY_LABELS_V1[trackId];
}
