export const A_EMOTION_CONTRACT_ERROR_CODES = Object.freeze({
  NOT_OBJECT: "A_EMOTION_NOT_OBJECT",
  UNKNOWN_FIELD: "A_EMOTION_UNKNOWN_FIELD",
  MISSING_FIELD: "A_EMOTION_MISSING_FIELD",
  INVALID_FIELD: "A_EMOTION_INVALID_FIELD",
  DUPLICATE_VALUE: "A_EMOTION_DUPLICATE_VALUE",
  HASH_MISMATCH: "A_EMOTION_HASH_MISMATCH",
  DISCLOSURE_VIOLATION: "A_EMOTION_DISCLOSURE_VIOLATION",
  PRESENTATION_VIOLATION: "A_EMOTION_PRESENTATION_VIOLATION",
} as const);

export type AEmotionContractErrorCode =
  (typeof A_EMOTION_CONTRACT_ERROR_CODES)[keyof typeof A_EMOTION_CONTRACT_ERROR_CODES];

export class AEmotionContractError extends Error {
  constructor(
    readonly code: AEmotionContractErrorCode,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
    this.name = "AEmotionContractError";
  }
}

export function failAEmotionContract(
  code: AEmotionContractErrorCode,
  path: string,
  detail?: string,
): never {
  throw new AEmotionContractError(code, path, detail);
}
