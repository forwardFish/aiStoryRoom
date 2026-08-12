export type PressureChapterIntegrationErrorCode =
  | "INTEGRATION_INPUT_INVALID"
  | "INTEGRATION_ROUTE_MISMATCH"
  | "INTEGRATION_CONTENT_MISMATCH"
  | "INTEGRATION_AUTHORITY_SOURCE_MISSING"
  | "INTEGRATION_AUTHORITY_SOURCE_MISMATCH"
  | "INTEGRATION_BEAT_CONFLICT"
  | "INTEGRATION_BEAT_REPLAY_MISMATCH"
  | "INTEGRATION_PERSISTENCE_CONFLICT"
  | "INTEGRATION_FINALE_REQUEST_MISMATCH"
  | "INTEGRATION_DECISION_COMMAND_MISMATCH";

export class PressureChapterIntegrationError extends Error {
  constructor(
    readonly code: PressureChapterIntegrationErrorCode,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
    this.name = "PressureChapterIntegrationError";
  }
}

export function failPressureChapterIntegration(
  code: PressureChapterIntegrationErrorCode,
  path: string,
  detail?: string,
): never {
  throw new PressureChapterIntegrationError(code, path, detail);
}
