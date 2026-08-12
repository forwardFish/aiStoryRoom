export const GENESIS_ERROR_CODES = {
  GENESIS_IDEMPOTENCY_FINGERPRINT_MISMATCH:
    "GENESIS_IDEMPOTENCY_FINGERPRINT_MISMATCH",
  GENESIS_ALREADY_COMMITTED: "GENESIS_ALREADY_COMMITTED",
  GENESIS_ATOMIC_RECORD_INVALID: "GENESIS_ATOMIC_RECORD_INVALID",
  GENESIS_ATOMIC_RECORD_HASH_MISMATCH:
    "GENESIS_ATOMIC_RECORD_HASH_MISMATCH",
  GENESIS_RECEIPT_MISMATCH: "GENESIS_RECEIPT_MISMATCH",
  GENESIS_SEQUENCE_INVALID: "GENESIS_SEQUENCE_INVALID",
  GENESIS_ROUTE_MISMATCH: "GENESIS_ROUTE_MISMATCH",
  GENESIS_P0_INVALID: "GENESIS_P0_INVALID",
} as const;

export type GenesisErrorCode =
  (typeof GENESIS_ERROR_CODES)[keyof typeof GENESIS_ERROR_CODES];

export class GenesisError extends Error {
  constructor(
    readonly code: GenesisErrorCode,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
    this.name = "GenesisError";
  }
}

export function failGenesis(
  code: GenesisErrorCode,
  path: string,
  detail?: string,
): never {
  throw new GenesisError(code, path, detail);
}
