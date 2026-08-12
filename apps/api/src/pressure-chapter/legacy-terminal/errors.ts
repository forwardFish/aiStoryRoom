export const LEGACY_TERMINAL_ERROR_CODES = Object.freeze({
  INVALID_CONTRACT: "LEGACY_TERMINAL_INVALID_CONTRACT",
  HASH_MISMATCH: "LEGACY_TERMINAL_HASH_MISMATCH",
  NOT_READY: "LEGACY_TERMINAL_NOT_READY",
  SOURCE_NOT_FOUND: "LEGACY_TERMINAL_SOURCE_NOT_FOUND",
  STATE_CONFLICT: "LEGACY_TERMINAL_STATE_CONFLICT",
  FINGERPRINT_MISMATCH: "LEGACY_TERMINAL_FINGERPRINT_MISMATCH",
  CREATION_DISABLED: "LEGACY_T20_CREATION_DISABLED",
  SAME_EXPERIENCE_DISABLED: "LEGACY_T20_SAME_EXPERIENCE_DISABLED",
  NARRATIVE_SOURCE_MISMATCH: "LEGACY_NARRATIVE_SOURCE_MISMATCH",
  NARRATIVE_REVISION_STALE: "LEGACY_NARRATIVE_REVISION_STALE",
} as const);

export type LegacyTerminalErrorCode =
  (typeof LEGACY_TERMINAL_ERROR_CODES)[keyof typeof LEGACY_TERMINAL_ERROR_CODES];

export class LegacyTerminalError extends Error {
  readonly code: LegacyTerminalErrorCode;
  readonly detail: string;

  constructor(code: LegacyTerminalErrorCode, detail: string) {
    super(`${code}:${detail}`);
    this.name = "LegacyTerminalError";
    this.code = code;
    this.detail = detail;
  }
}

export function failLegacyTerminal(code: LegacyTerminalErrorCode, detail: string): never {
  throw new LegacyTerminalError(code, detail);
}

