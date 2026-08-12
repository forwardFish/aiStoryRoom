export const PRESSURE_PROGRESS_OUTBOX_ERROR_CODES = Object.freeze({
  INVALID_CLAIM: "PRESSURE_PROGRESS_OUTBOX_INVALID_CLAIM",
  TASK_TAMPERED: "PRESSURE_PROGRESS_OUTBOX_TASK_TAMPERED",
  TASK_UNSUPPORTED: "PRESSURE_PROGRESS_OUTBOX_TASK_UNSUPPORTED",
  DEPENDENCY_RESULT_INVALID: "PRESSURE_PROGRESS_OUTBOX_DEPENDENCY_RESULT_INVALID",
  INVALID_CONFIGURATION: "PRESSURE_PROGRESS_OUTBOX_INVALID_CONFIGURATION",
} as const);

export type PressureProgressOutboxErrorCode =
  (typeof PRESSURE_PROGRESS_OUTBOX_ERROR_CODES)[keyof typeof PRESSURE_PROGRESS_OUTBOX_ERROR_CODES];

export class PressureProgressOutboxError extends Error {
  constructor(
    public readonly code: PressureProgressOutboxErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "PressureProgressOutboxError";
  }
}

