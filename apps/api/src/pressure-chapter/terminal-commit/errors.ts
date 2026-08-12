export const TERMINAL_COMMIT_ERROR_CODES = Object.freeze({
  SOURCE_NOT_FOUND: "PRESSURE_TERMINAL_SOURCE_NOT_FOUND",
  INVALID_TRIGGER: "PRESSURE_TERMINAL_INVALID_TRIGGER",
  N7_REQUIRED: "PRESSURE_TERMINAL_N7_REQUIRED",
  SOURCE_FINGERPRINT_MISMATCH: "PRESSURE_TERMINAL_SOURCE_FINGERPRINT_MISMATCH",
  ALREADY_COMMITTED: "PRESSURE_TERMINAL_ALREADY_COMMITTED",
  IDEMPOTENCY_FINGERPRINT_MISMATCH: "PRESSURE_TERMINAL_IDEMPOTENCY_FINGERPRINT_MISMATCH",
  COMMITTED_RECORD_MISMATCH: "PRESSURE_TERMINAL_COMMITTED_RECORD_MISMATCH",
  ATOMIC_RECORD_INVALID: "PRESSURE_TERMINAL_ATOMIC_RECORD_INVALID",
} as const);

export type TerminalCommitErrorCode =
  (typeof TERMINAL_COMMIT_ERROR_CODES)[keyof typeof TERMINAL_COMMIT_ERROR_CODES];

export class TerminalCommitError extends Error {
  readonly code: TerminalCommitErrorCode;
  readonly path: string;
  readonly detail: string | undefined;

  constructor(code: TerminalCommitErrorCode, path: string, detail?: string) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
    this.name = "TerminalCommitError";
    this.code = code;
    this.path = path;
    this.detail = detail;
  }
}

export function failTerminalCommit(
  code: TerminalCommitErrorCode,
  path: string,
  detail?: string,
): never {
  throw new TerminalCommitError(code, path, detail);
}
