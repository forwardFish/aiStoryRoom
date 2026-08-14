export const PRESSURE_VIEWER_STORY_PACK_ERROR_CODES_V1 = Object.freeze({
  INVALID: "PRESSURE_VIEWER_STORY_PACK_INVALID",
  IDENTITY: "PRESSURE_VIEWER_STORY_PACK_IDENTITY_MISMATCH",
  SCOPE: "PRESSURE_VIEWER_STORY_PACK_SCOPE_VIOLATION",
  REFERENCE: "PRESSURE_VIEWER_STORY_PACK_REFERENCE_MISMATCH",
  CATALOG: "PRESSURE_VIEWER_STORY_PACK_CATALOG_MISMATCH",
} as const);

export type PressureViewerStoryPackErrorKindV1 =
  keyof typeof PRESSURE_VIEWER_STORY_PACK_ERROR_CODES_V1;

export class PressureViewerStoryPackCompileErrorV1 extends Error {
  constructor(readonly code: string, readonly path: string, readonly detail: string) {
    super(`${code}:${path}:${detail}`);
    this.name = "PressureViewerStoryPackCompileErrorV1";
  }
}
