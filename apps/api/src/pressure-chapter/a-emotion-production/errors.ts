export const A_EMOTION_PRODUCTION_ERROR_CODES = Object.freeze({
  OUTBOX_CLAIM_INVALID: "A_EMOTION_OUTBOX_CLAIM_INVALID",
  OUTBOX_JOB_INVALID: "A_EMOTION_OUTBOX_JOB_INVALID",
  AUTHORITY_SOURCE_NOT_FOUND: "A_EMOTION_AUTHORITY_SOURCE_NOT_FOUND",
  AUTHORITY_SOURCE_INVALID: "A_EMOTION_AUTHORITY_SOURCE_INVALID",
  AUTHORITY_BINDING_MISMATCH: "A_EMOTION_AUTHORITY_BINDING_MISMATCH",
  VIEWER_CONTEXT_UNAVAILABLE: "A_EMOTION_VIEWER_CONTEXT_UNAVAILABLE",
  VIEWER_CONTEXT_INVALID: "A_EMOTION_VIEWER_CONTEXT_INVALID",
  PIPELINE_UNAVAILABLE: "A_EMOTION_PIPELINE_UNAVAILABLE",
  PIPELINE_RECEIPT_INVALID: "A_EMOTION_PIPELINE_RECEIPT_INVALID",
  NO_AUTHORIZED_VIEWER_PROJECTION: "A_EMOTION_NO_AUTHORIZED_VIEWER_PROJECTION",
  CONFIG_INVALID: "A_EMOTION_PRODUCTION_CONFIG_INVALID",
} as const);

export type AEmotionProductionErrorCodeV1 =
  (typeof A_EMOTION_PRODUCTION_ERROR_CODES)[keyof typeof A_EMOTION_PRODUCTION_ERROR_CODES];

export class AEmotionProductionError extends Error {
  constructor(
    readonly code: AEmotionProductionErrorCodeV1,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
    this.name = "AEmotionProductionError";
  }
}

export function failAEmotionProduction(
  code: AEmotionProductionErrorCodeV1,
  path: string,
  detail?: string,
): never {
  throw new AEmotionProductionError(code, path, detail);
}

