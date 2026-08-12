export const SANGTIAN_CONTENT_ERROR_CODES_V1 = Object.freeze({
  PACKAGE_INVALID: "SANGTIAN_PRESSURE_CONTENT_PACKAGE_INVALID",
  PACKAGE_HASH_MISMATCH: "SANGTIAN_PRESSURE_CONTENT_PACKAGE_HASH_MISMATCH",
  MANIFEST_HASH_MISMATCH: "SANGTIAN_PRESSURE_CONTENT_MANIFEST_HASH_MISMATCH",
  SOURCE_TRACE_INVALID: "SANGTIAN_PRESSURE_CONTENT_SOURCE_TRACE_INVALID",
  LEGACY_FIXED_WINDOW_FORBIDDEN: "SANGTIAN_PRESSURE_CONTENT_LEGACY_FIXED_WINDOW_FORBIDDEN",
  CHAPTER_INCOMPLETE: "SANGTIAN_PRESSURE_CONTENT_CHAPTER_INCOMPLETE",
  DECISION_POINT_INVALID: "SANGTIAN_PRESSURE_CONTENT_DECISION_POINT_INVALID",
  SETTLEMENT_POLICY_INVALID: "SANGTIAN_PRESSURE_CONTENT_SETTLEMENT_POLICY_INVALID",
  FINALE_RULE_MISMATCH: "SANGTIAN_PRESSURE_CONTENT_FINALE_RULE_MISMATCH",
} as const);

export type SangtianContentErrorCodeV1 =
  (typeof SANGTIAN_CONTENT_ERROR_CODES_V1)[keyof typeof SANGTIAN_CONTENT_ERROR_CODES_V1];

export class SangtianPressureContentErrorV1 extends Error {
  constructor(
    readonly code: SangtianContentErrorCodeV1,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
    this.name = "SangtianPressureContentErrorV1";
  }
}

export function failSangtianContentV1(
  code: SangtianContentErrorCodeV1,
  path: string,
  detail?: string,
): never {
  throw new SangtianPressureContentErrorV1(code, path, detail);
}
