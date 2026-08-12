export const PRESSURE_LIVE_ADAPTER_ERROR_CODES = Object.freeze({
  CONFIGURATION_REQUIRED: "PRESSURE_LIVE_ADAPTER_CONFIGURATION_REQUIRED",
  AUTHORITY_NOT_FOUND: "PRESSURE_LIVE_ADAPTER_AUTHORITY_NOT_FOUND",
  AUTHORITY_MISMATCH: "PRESSURE_LIVE_ADAPTER_AUTHORITY_MISMATCH",
  AUTHORITY_AMBIGUOUS: "PRESSURE_LIVE_ADAPTER_AUTHORITY_AMBIGUOUS",
  SUBJECT_FORBIDDEN: "PRESSURE_LIVE_ADAPTER_SUBJECT_FORBIDDEN",
  STALE_CONTROL_EPOCH: "PRESSURE_LIVE_ADAPTER_STALE_CONTROL_EPOCH",
  CONTROL_MODE_UNSUPPORTED: "PRESSURE_LIVE_ADAPTER_CONTROL_MODE_UNSUPPORTED",
  PRIVATE_PROJECTION_UNAVAILABLE: "PRESSURE_LIVE_ADAPTER_PRIVATE_PROJECTION_UNAVAILABLE",
  RECORD_INVALID: "PRESSURE_LIVE_ADAPTER_RECORD_INVALID",
} as const);

export type PressureLiveAdapterErrorCodeV1 =
  (typeof PRESSURE_LIVE_ADAPTER_ERROR_CODES)[keyof typeof PRESSURE_LIVE_ADAPTER_ERROR_CODES];

export class PressureLiveAdapterError extends Error {
  constructor(
    readonly code: PressureLiveAdapterErrorCodeV1,
    readonly authority: string,
    readonly detail: string | null = null,
  ) {
    super([code, authority, detail].filter(Boolean).join(":"));
    this.name = "PressureLiveAdapterError";
  }
}

export function failLiveAdapter(
  code: PressureLiveAdapterErrorCodeV1,
  authority: string,
  detail?: string,
): never {
  throw new PressureLiveAdapterError(code, authority, detail ?? null);
}
