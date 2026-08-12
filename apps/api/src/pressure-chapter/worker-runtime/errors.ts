export const PRESSURE_WORKER_RUNTIME_ERROR_CODES = Object.freeze({
  INVALID_CONFIGURATION: "PRESSURE_WORKER_RUNTIME_INVALID_CONFIGURATION",
  ALREADY_RUNNING: "PRESSURE_WORKER_RUNTIME_ALREADY_RUNNING",
  NOT_RUNNING: "PRESSURE_WORKER_RUNTIME_NOT_RUNNING",
} as const);

export type PressureWorkerRuntimeErrorCode =
  (typeof PRESSURE_WORKER_RUNTIME_ERROR_CODES)[keyof typeof PRESSURE_WORKER_RUNTIME_ERROR_CODES];

export class PressureWorkerRuntimeError extends Error {
  constructor(
    public readonly code: PressureWorkerRuntimeErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "PressureWorkerRuntimeError";
  }
}

