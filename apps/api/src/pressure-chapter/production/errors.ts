export const PRESSURE_PRODUCTION_ERROR_CODES = Object.freeze({
  INVALID_COMMAND: "PRESSURE_PRODUCTION_INVALID_COMMAND",
  LEGACY_MAPPING_REQUIRED: "PRESSURE_LEGACY_ROLE_MAPPING_REQUIRED",
  LEGACY_MAPPING_INVALID: "PRESSURE_LEGACY_ROLE_MAPPING_INVALID",
  RUN_SHELL_CAPABILITY_INVALID: "PRESSURE_RUN_SHELL_CAPABILITY_INVALID",
  RUN_SHELL_RESULT_INVALID: "PRESSURE_RUN_SHELL_RESULT_INVALID",
  START_DEPENDENCY_RESULT_INVALID: "PRESSURE_START_DEPENDENCY_RESULT_INVALID",
  START_FAILED: "PRESSURE_START_FAILED",
  START_FAILURE_RECORDING_FAILED: "PRESSURE_START_FAILURE_RECORDING_FAILED",
  PRODUCTION_DEPENDENCY_MISSING: "PRESSURE_PRODUCTION_DEPENDENCY_MISSING",
} as const);

export type PressureProductionErrorCode =
  (typeof PRESSURE_PRODUCTION_ERROR_CODES)[keyof typeof PRESSURE_PRODUCTION_ERROR_CODES];

export class PressureProductionError extends Error {
  constructor(
    readonly code: PressureProductionErrorCode,
    readonly detail: string,
    options?: ErrorOptions,
  ) {
    super(`${code}:${detail}`, options);
    this.name = "PressureProductionError";
  }
}

export function failPressureProduction(
  code: PressureProductionErrorCode,
  detail: string,
  options?: ErrorOptions,
): never {
  throw new PressureProductionError(code, detail, options);
}
