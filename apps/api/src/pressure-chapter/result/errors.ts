export const PRESSURE_RESULT_READ_ERROR_CODES = Object.freeze({
  RESULT_NOT_FOUND: "RESULT_NOT_FOUND",
  RESULT_NOT_READY: "RESULT_NOT_READY",
  RESULT_ACCESS_DENIED: "RESULT_ACCESS_DENIED",
  RESULT_STORED_RECORD_INVALID: "RESULT_STORED_RECORD_INVALID",
  RESULT_ROUTE_CONTRACT_MISMATCH: "RESULT_ROUTE_CONTRACT_MISMATCH",
  RESULT_REGISTRY_UNAVAILABLE: "RESULT_REGISTRY_UNAVAILABLE",
  RESULT_ADAPTER_UNAVAILABLE: "RESULT_ADAPTER_UNAVAILABLE",
  RESULT_RENDERER_UNAVAILABLE: "RESULT_RENDERER_UNAVAILABLE",
  RESULT_AUDIENCE_VIOLATION: "RESULT_AUDIENCE_VIOLATION",
  REPLAY_ACTION_NOT_ISSUED: "REPLAY_ACTION_NOT_ISSUED",
  REPLAY_ACTION_DISABLED: "REPLAY_ACTION_DISABLED",
  REPLAY_ROLE_NOT_ALLOWED: "REPLAY_ROLE_NOT_ALLOWED",
  REPLAY_TARGET_UNAVAILABLE: "REPLAY_TARGET_UNAVAILABLE",
  REPLAY_RECEIPT_INVALID: "REPLAY_RECEIPT_INVALID",
  IDEMPOTENCY_KEY_REUSED: "IDEMPOTENCY_KEY_REUSED",
} as const);

export type PressureResultReadErrorCode =
  (typeof PRESSURE_RESULT_READ_ERROR_CODES)[keyof typeof PRESSURE_RESULT_READ_ERROR_CODES];

export class PressureResultReadError extends Error {
  constructor(
    readonly code: PressureResultReadErrorCode,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
    this.name = "PressureResultReadError";
  }
}

export function failPressureResultRead(
  code: PressureResultReadErrorCode,
  path: string,
  detail?: string,
): never {
  throw new PressureResultReadError(code, path, detail);
}
