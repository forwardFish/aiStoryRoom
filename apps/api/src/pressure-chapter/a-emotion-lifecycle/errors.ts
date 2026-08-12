export const A_EMOTION_LIFECYCLE_ERROR_CODES_V1 = Object.freeze({
  INVALID_AUTHORITY: "A_EMOTION_LIFECYCLE_INVALID_AUTHORITY",
  FORBIDDEN_INPUT: "A_EMOTION_LIFECYCLE_FORBIDDEN_INPUT",
  INVALID_POLICY: "A_EMOTION_LIFECYCLE_INVALID_POLICY",
  INVALID_STATE: "A_EMOTION_LIFECYCLE_INVALID_STATE",
  CONTEXT_MISMATCH: "A_EMOTION_LIFECYCLE_CONTEXT_MISMATCH",
  DISCLOSURE_SKIP_FORBIDDEN: "A_EMOTION_LIFECYCLE_DISCLOSURE_SKIP_FORBIDDEN",
  DISCLOSURE_BASIS_MISSING: "A_EMOTION_LIFECYCLE_DISCLOSURE_BASIS_MISSING",
} as const);

export type AEmotionLifecycleErrorCodeV1 =
  (typeof A_EMOTION_LIFECYCLE_ERROR_CODES_V1)[keyof typeof A_EMOTION_LIFECYCLE_ERROR_CODES_V1];

export class AEmotionLifecycleError extends Error {
  constructor(
    readonly code: AEmotionLifecycleErrorCodeV1,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
    this.name = "AEmotionLifecycleError";
  }
}

export function failAEmotionLifecycle(
  code: AEmotionLifecycleErrorCodeV1,
  path: string,
  detail?: string,
): never {
  throw new AEmotionLifecycleError(code, path, detail);
}
