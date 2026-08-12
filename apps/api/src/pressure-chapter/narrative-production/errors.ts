export const PRESSURE_NARRATIVE_PRODUCTION_ERROR_CODES = Object.freeze({
  RUNTIME_MODULE_UNAVAILABLE: "PRESSURE_NARRATIVE_RUNTIME_MODULE_UNAVAILABLE",
  RELEASE_PROFILE_INVALID: "PRESSURE_NARRATIVE_RELEASE_PROFILE_INVALID",
  PRODUCTION_CONFIG_INVALID: "PRESSURE_NARRATIVE_PRODUCTION_CONFIG_INVALID",
  PROVIDER_BOUNDARY_VIOLATION: "PRESSURE_NARRATIVE_PROVIDER_BOUNDARY_VIOLATION",
  AUTHORITY_COMPILATION_UNSUPPORTED:
    "PRESSURE_NARRATIVE_AUTHORITY_COMPILATION_UNSUPPORTED",
  AUTHORITY_COMPILATION_INVALID:
    "PRESSURE_NARRATIVE_AUTHORITY_COMPILATION_INVALID",
  OUTBOX_SIGNAL_INVALID: "PRESSURE_NARRATIVE_OUTBOX_SIGNAL_INVALID",
} as const);

export type PressureNarrativeProductionErrorCode =
  (typeof PRESSURE_NARRATIVE_PRODUCTION_ERROR_CODES)[keyof typeof PRESSURE_NARRATIVE_PRODUCTION_ERROR_CODES];

export class PressureNarrativeProductionError extends Error {
  readonly name = "PressureNarrativeProductionError";

  constructor(
    readonly code: PressureNarrativeProductionErrorCode,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
  }
}

export function failPressureNarrativeProduction(
  code: PressureNarrativeProductionErrorCode,
  path: string,
  detail?: string,
): never {
  throw new PressureNarrativeProductionError(code, path, detail);
}
