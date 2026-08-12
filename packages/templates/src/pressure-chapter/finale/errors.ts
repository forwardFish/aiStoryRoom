export const SANGTIAN_FINALE_DOMAIN_ERROR_CODES = Object.freeze({
  POLICY_NOT_CONTENT_OWNED: "SANGTIAN_FINALE_POLICY_NOT_CONTENT_OWNED",
  RULE_CATALOG_MISMATCH: "SANGTIAN_FINALE_RULE_CATALOG_MISMATCH",
  IDEMPOTENCY_KEY_MISMATCH: "SANGTIAN_FINALE_IDEMPOTENCY_KEY_MISMATCH",
  NO_WORLD_OUTCOME: "SANGTIAN_FINALE_NO_WORLD_OUTCOME",
} as const);

export type SangtianFinaleDomainErrorCode =
  (typeof SANGTIAN_FINALE_DOMAIN_ERROR_CODES)[keyof typeof SANGTIAN_FINALE_DOMAIN_ERROR_CODES];

export class SangtianFinaleDomainError extends Error {
  readonly code: SangtianFinaleDomainErrorCode;
  readonly path: string;
  readonly detail: string | undefined;

  constructor(code: SangtianFinaleDomainErrorCode, path: string, detail?: string) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
    this.name = "SangtianFinaleDomainError";
    this.code = code;
    this.path = path;
    this.detail = detail;
  }
}

export function failSangtianFinaleDomain(
  code: SangtianFinaleDomainErrorCode,
  path: string,
  detail?: string,
): never {
  throw new SangtianFinaleDomainError(code, path, detail);
}
