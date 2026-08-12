export const PRESSURE_PRODUCT_ADAPTER_ERROR_CODES_V1 = Object.freeze({
  AUTHORITY_NOT_FOUND: "PRESSURE_PRODUCT_AUTHORITY_NOT_FOUND",
  AUTHORITY_MISMATCH: "PRESSURE_PRODUCT_AUTHORITY_MISMATCH",
  RECORD_INVALID: "PRESSURE_PRODUCT_RECORD_INVALID",
  UNSUPPORTED_STAGE: "PRESSURE_PRODUCT_UNSUPPORTED_STAGE",
} as const);

export type PressureProductAdapterErrorCodeV1 =
  (typeof PRESSURE_PRODUCT_ADAPTER_ERROR_CODES_V1)[keyof typeof PRESSURE_PRODUCT_ADAPTER_ERROR_CODES_V1];

export class PressureProductAdapterErrorV1 extends Error {
  readonly name = "PressureProductAdapterErrorV1";

  constructor(
    readonly code: PressureProductAdapterErrorCodeV1,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
  }
}

export function failPressureProductAdapterV1(
  code: PressureProductAdapterErrorCodeV1,
  path: string,
  detail?: string,
): never {
  throw new PressureProductAdapterErrorV1(code, path, detail);
}
