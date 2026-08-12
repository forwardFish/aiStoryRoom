export const PRESSURE_NARRATIVE_ERROR_CODES = Object.freeze({
  JOB_INVALID: "JOB_INVALID",
  AUDIENCE_SOURCE_INVALID: "AUDIENCE_SOURCE_INVALID",
  SOURCE_BINDING_MISMATCH: "SOURCE_BINDING_MISMATCH",
  PROFILE_UNAVAILABLE: "PROFILE_UNAVAILABLE",
  PROJECTION_BUSY: "PROJECTION_BUSY",
  STALE_FENCE: "STALE_FENCE",
  PROVIDER_TIMEOUT: "PROVIDER_TIMEOUT",
  PROVIDER_FAILURE: "PROVIDER_FAILURE",
  PROVIDER_EMPTY: "PROVIDER_EMPTY",
  PROVIDER_OUTPUT_INVALID: "PROVIDER_OUTPUT_INVALID",
  OUTPUT_SURFACE_REJECTED: "OUTPUT_SURFACE_REJECTED",
  TRUTH_GUARD_REJECTED: "TRUTH_GUARD_REJECTED",
  PUBLISH_FAILED: "PUBLISH_FAILED",
  FALLBACK_FAILED: "FALLBACK_FAILED",
  PROJECTION_DEAD_LETTERED: "PROJECTION_DEAD_LETTERED",
} as const);

export type PressureNarrativeErrorCode =
  (typeof PRESSURE_NARRATIVE_ERROR_CODES)[keyof typeof PRESSURE_NARRATIVE_ERROR_CODES];

export class PressureNarrativeError extends Error {
  constructor(
    readonly code: PressureNarrativeErrorCode,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
    this.name = "PressureNarrativeError";
  }
}

export function failPressureNarrative(
  code: PressureNarrativeErrorCode,
  path: string,
  detail?: string,
): never {
  throw new PressureNarrativeError(code, path, detail);
}
