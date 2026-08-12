export const PRESSURE_CHAPTER_RUNTIME_ERROR_CODES = Object.freeze({
  CONTEXT_MISMATCH: "PRESSURE_RUNTIME_CONTEXT_MISMATCH",
  DEPENDENCY_RESULT_INVALID: "PRESSURE_RUNTIME_DEPENDENCY_RESULT_INVALID",
} as const);

export type PressureChapterRuntimeErrorCode =
  (typeof PRESSURE_CHAPTER_RUNTIME_ERROR_CODES)[keyof typeof PRESSURE_CHAPTER_RUNTIME_ERROR_CODES];

export class PressureChapterRuntimeError extends Error {
  readonly name = "PressureChapterRuntimeError";

  constructor(
    readonly code: PressureChapterRuntimeErrorCode,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(`${code} at ${path}${detail ? `: ${detail}` : ""}`);
  }
}

export function failPressureChapterRuntime(
  code: PressureChapterRuntimeErrorCode,
  path: string,
  detail?: string,
): never {
  throw new PressureChapterRuntimeError(code, path, detail);
}
