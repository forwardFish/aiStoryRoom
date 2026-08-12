export const PRESSURE_SEAT_TRANSPORT_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "PRESSURE_SEAT_TRANSPORT_INVALID_REQUEST",
  SUBJECT_FORBIDDEN: "PRESSURE_SEAT_TRANSPORT_SUBJECT_FORBIDDEN",
  VIEWER_SCOPE_MISMATCH: "PRESSURE_SEAT_TRANSPORT_VIEWER_SCOPE_MISMATCH",
  FEED_SCOPE_MISMATCH: "PRESSURE_SEAT_TRANSPORT_FEED_SCOPE_MISMATCH",
  CURSOR_INVALID: "PRESSURE_SEAT_TRANSPORT_CURSOR_INVALID",
} as const);

export type PressureSeatTransportErrorCodeV1 =
  (typeof PRESSURE_SEAT_TRANSPORT_ERROR_CODES)[keyof typeof PRESSURE_SEAT_TRANSPORT_ERROR_CODES];

export class PressureSeatTransportError extends Error {
  constructor(
    readonly code: PressureSeatTransportErrorCodeV1,
    readonly detail: string | null = null,
  ) {
    super(detail ? `${code}:${detail}` : code);
    this.name = "PressureSeatTransportError";
  }
}

export function failPressureSeatTransport(
  code: PressureSeatTransportErrorCodeV1,
  detail?: string,
): never {
  throw new PressureSeatTransportError(code, detail ?? null);
}

