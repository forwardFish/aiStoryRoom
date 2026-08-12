export const PRESSURE_CHAPTER_PRODUCT_ERROR_CODES = Object.freeze({
  PRODUCTION_PORT_MISSING: "PRESSURE_CHAPTER_PRODUCT_PRODUCTION_PORT_MISSING",
  PRODUCTION_PORT_INVALID: "PRESSURE_CHAPTER_PRODUCT_PRODUCTION_PORT_INVALID",
  N1_STARTER_CONFLICT: "PRESSURE_CHAPTER_PRODUCT_N1_STARTER_CONFLICT",
  COMPOSITION_INCOMPLETE: "PRESSURE_CHAPTER_PRODUCT_COMPOSITION_INCOMPLETE",
} as const);

export type PressureChapterProductErrorCode =
  (typeof PRESSURE_CHAPTER_PRODUCT_ERROR_CODES)[keyof typeof PRESSURE_CHAPTER_PRODUCT_ERROR_CODES];

export class PressureChapterProductError extends Error {
  readonly name = "PressureChapterProductError";

  constructor(
    readonly code: PressureChapterProductErrorCode,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
  }
}

export function failPressureChapterProduct(
  code: PressureChapterProductErrorCode,
  path: string,
  detail?: string,
): never {
  throw new PressureChapterProductError(code, path, detail);
}
