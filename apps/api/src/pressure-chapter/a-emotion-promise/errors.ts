export const PRESSURE_SIMPLE_PROMISE_ERROR_CODES_V1 = Object.freeze({
  INPUT_INVALID: "PRESSURE_SIMPLE_PROMISE_INPUT_INVALID",
  CONTEXT_MISMATCH: "PRESSURE_SIMPLE_PROMISE_CONTEXT_MISMATCH",
  ROLE_FORBIDDEN: "PRESSURE_SIMPLE_PROMISE_ROLE_FORBIDDEN",
  TARGET_FORBIDDEN: "PRESSURE_SIMPLE_PROMISE_TARGET_FORBIDDEN",
  SLOT_EXHAUSTED: "PRESSURE_SIMPLE_PROMISE_SLOT_EXHAUSTED",
  ACTION_NOT_AVAILABLE: "PRESSURE_SIMPLE_PROMISE_ACTION_NOT_AVAILABLE",
  IDEMPOTENCY_MISMATCH: "PRESSURE_SIMPLE_PROMISE_IDEMPOTENCY_MISMATCH",
} as const);

export type PressureSimplePromiseErrorCodeV1 =
  (typeof PRESSURE_SIMPLE_PROMISE_ERROR_CODES_V1)[keyof typeof PRESSURE_SIMPLE_PROMISE_ERROR_CODES_V1];

export class PressureSimplePromiseErrorV1 extends Error {
  readonly name = "PressureSimplePromiseErrorV1";

  constructor(
    readonly code: PressureSimplePromiseErrorCodeV1,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
  }
}

export function failPressureSimplePromiseV1(
  code: PressureSimplePromiseErrorCodeV1,
  path: string,
  detail?: string,
): never {
  throw new PressureSimplePromiseErrorV1(code, path, detail);
}

