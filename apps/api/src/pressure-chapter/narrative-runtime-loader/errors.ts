export const PRESSURE_NARRATIVE_RUNTIME_LOADER_ERROR_CODES = Object.freeze({
  PACKAGE_MANIFEST_INVALID: "PRESSURE_NARRATIVE_RUNTIME_LOADER_PACKAGE_MANIFEST_INVALID",
  PACKAGE_EXPORTS_INVALID: "PRESSURE_NARRATIVE_RUNTIME_LOADER_PACKAGE_EXPORTS_INVALID",
  RUNTIME_MODULE_INVALID: "PRESSURE_NARRATIVE_RUNTIME_LOADER_RUNTIME_MODULE_INVALID",
} as const);

export type PressureNarrativeRuntimeLoaderErrorCode =
  (typeof PRESSURE_NARRATIVE_RUNTIME_LOADER_ERROR_CODES)[keyof typeof PRESSURE_NARRATIVE_RUNTIME_LOADER_ERROR_CODES];

export class PressureNarrativeRuntimeLoaderError extends Error {
  constructor(
    public readonly code: PressureNarrativeRuntimeLoaderErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "PressureNarrativeRuntimeLoaderError";
  }
}

