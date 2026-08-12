export const PRESSURE_GAME_PROJECTION_ERROR_CODES = Object.freeze({
  ROUTE_NOT_FOUND: "PRESSURE_GAME_ROUTE_NOT_FOUND",
  CHAPTER_NOT_FOUND: "PRESSURE_GAME_CHAPTER_NOT_FOUND",
  VIEWER_NOT_FOUND: "PRESSURE_GAME_VIEWER_NOT_FOUND",
  WORLD_NOT_FOUND: "PRESSURE_GAME_WORLD_NOT_FOUND",
  NARRATIVE_NOT_FOUND: "PRESSURE_GAME_NARRATIVE_NOT_FOUND",
  SCOPE_MISMATCH: "PRESSURE_GAME_SCOPE_MISMATCH",
  INVALID_SOURCE: "PRESSURE_GAME_INVALID_SOURCE",
  CAPABILITY_MISMATCH: "PRESSURE_GAME_CAPABILITY_MISMATCH",
  VIEWER_DATA_UNSAFE: "PRESSURE_GAME_VIEWER_DATA_UNSAFE",
} as const);

export type PressureGameProjectionErrorCodeV1 =
  (typeof PRESSURE_GAME_PROJECTION_ERROR_CODES)[keyof typeof PRESSURE_GAME_PROJECTION_ERROR_CODES];

export class PressureGameProjectionError extends Error {
  readonly name = "PressureGameProjectionError";

  constructor(
    readonly code: PressureGameProjectionErrorCodeV1,
    readonly path: string,
    readonly detail: string | null = null,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
  }
}

export function failPressureGameProjection(
  code: PressureGameProjectionErrorCodeV1,
  path: string,
  detail?: string,
): never {
  throw new PressureGameProjectionError(code, path, detail ?? null);
}
