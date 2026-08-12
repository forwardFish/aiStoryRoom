export const PRESSURE_NARRATIVE_OUTBOX_ERROR_CODES = Object.freeze({
  OUTBOX_CLAIM_INVALID: "OUTBOX_CLAIM_INVALID",
  OUTBOX_JOB_INVALID: "OUTBOX_JOB_INVALID",
  AUTHORITY_SOURCE_NOT_FOUND: "AUTHORITY_SOURCE_NOT_FOUND",
  AUTHORITY_SOURCE_INVALID: "AUTHORITY_SOURCE_INVALID",
  AUTHORITY_SOURCE_BINDING_MISMATCH: "AUTHORITY_SOURCE_BINDING_MISMATCH",
  AUDIENCE_PROJECTION_VIOLATION: "AUDIENCE_PROJECTION_VIOLATION",
  PROJECTOR_RECEIPT_INVALID: "PROJECTOR_RECEIPT_INVALID",
  PROJECTOR_UNAVAILABLE: "PROJECTOR_UNAVAILABLE",
  STALE_OUTBOX_FENCE: "STALE_OUTBOX_FENCE",
} as const);

export type PressureNarrativeOutboxErrorCode =
  (typeof PRESSURE_NARRATIVE_OUTBOX_ERROR_CODES)[keyof typeof PRESSURE_NARRATIVE_OUTBOX_ERROR_CODES];

export class PressureNarrativeOutboxError extends Error {
  constructor(
    readonly code: PressureNarrativeOutboxErrorCode,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
    this.name = "PressureNarrativeOutboxError";
  }
}

export function failPressureNarrativeOutbox(
  code: PressureNarrativeOutboxErrorCode,
  path: string,
  detail?: string,
): never {
  throw new PressureNarrativeOutboxError(code, path, detail);
}
