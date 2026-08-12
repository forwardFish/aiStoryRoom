export const A_EMOTION_PERSISTENCE_ERROR_CODES = Object.freeze({
  RECORD_INVALID: "A_EMOTION_PERSISTENCE_RECORD_INVALID",
  FINGERPRINT_MISMATCH: "A_EMOTION_PERSISTENCE_FINGERPRINT_MISMATCH",
  DELIVERY_BINDING_MISSING: "A_EMOTION_DELIVERY_BINDING_MISSING",
  DAY_RESOLUTION_REQUIRED: "A_EMOTION_DAY_RESOLUTION_REQUIRED",
  DELIVERY_VERSION_UNSUPPORTED: "A_EMOTION_DELIVERY_VERSION_UNSUPPORTED",
} as const);

export type AEmotionPersistenceErrorCode =
  (typeof A_EMOTION_PERSISTENCE_ERROR_CODES)[keyof typeof A_EMOTION_PERSISTENCE_ERROR_CODES];

export class AEmotionPersistenceError extends Error {
  constructor(
    readonly code: AEmotionPersistenceErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "AEmotionPersistenceError";
  }
}

export function failAEmotionPersistence(
  code: AEmotionPersistenceErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new AEmotionPersistenceError(code, message, details);
}
